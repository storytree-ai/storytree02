// The studio's ONE /api/* route table (ADR-0042 / studio-cloud `serve-mode`):
// every handler and the central dispatch+error mapping live here, consumed by
// BOTH fronts — the Vite dev plugin (devApi.ts, the open localhost posture) and
// the standalone hosted server (serve.ts, the guarded posture). No endpoint is
// ever defined twice; hosted behaviour differs only by the injected ApiPolicy.
//
//   1. Serves the canonical docs corpus live from <repo>/docs (read-only).
//   2. Persists comments + guidance assets through the LibraryBackend seam
//      (libraryBackend.ts): Cloud SQL Postgres by default, json files offline.
//   3. Reads the story tree live from <repo>/stories, enriched with verdicts +
//      claim activity when the live store answers (advisory; self-reported presence
//      retired by the ADR-0200 D7 retirement sweep — the claim ledger is the one
//      coordination + observability machinery).
//
// SIGNPOST — the data/*.json files are a PRE-DB stopgap, not the system of record:
//   • the Library's STRUCTURED SOURCE is the live store (ADR-0302 D1).
//   • The offline JsonBackend serves a GITIGNORED apps/studio/data/assets.runtime.json, SEEDED on
//     first read by deriving the corpus from the library's committed FIXTURE corpus
//     (`@storytree/library/fixture`) + the library templates (ADR-0210 — the committed, generated
//     assets.json was retired; nothing hand-edits or commits this runtime store). That seed was
//     `apps/studio/data/knowledge.json` until ADR-0302 D1 deleted the file; see the `assetsFile`
//     comment below and `libraryBackend.ts`'s `#loadSeedUnits`, which say the same thing.
//   • The Library is ALSO migrated into the shared Cloud SQL Postgres store
//     (packages/library/store) — the pg backend is the default (oq-studio-store-default → B).

import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
  FoldedWorkHierarchy,
  ReliabilityGate,
  ResolvedWitnessKind,
  UatTestCriterion,
} from '@storytree/library';
// A RUNTIME import, so it must survive the vite config-load trap: vite.config.ts loads devApi.ts →
// this file through Node's plain ESM loader, where the root barrel's `./schema.js`-style specifiers
// do not resolve (only the .ts files exist). Hence the dedicated `/repo-root` LEAF subpath — that
// module imports nothing at all, so Node loads it directly. Do NOT collapse this to
// `@storytree/library`: `pnpm gate` does not run `vite build`, so only CI Build catches the break.
import { REPO_ROOT_ENV, resolveRepoRoot } from '@storytree/library/repo-root';
import type { Attestation, EvidenceRef, StoredAttestation, Verdict } from '@storytree/proof-protocol';
// Type-only (fully erased under verbatimModuleSyntax — no runtime import, so it never hits the
// vite config-load trap the lazy `loadOrchestrator()` below avoids): the sign-time trust guard's
// shapes, so `buildUatVerdict` can take the real `checkUatProof` as a precisely-typed injection.
import type { UatProofCheck, UatProofResult } from '@storytree/orchestrator';
import type { ResolvedAccess, UserRole } from '@storytree/studio-members';
import type {
  AssetCategory,
  Comment,
  CommentAnchor,
  DocMeta,
  TreeCapability,
  TreePayload,
  TreeStory,
  UatCriterionSummary,
  WorkStatus,
} from '../src/types';
// The canonical rendered-category list, imported rather than restated — see ASSET_CATEGORIES below.
import { ASSET_CATEGORIES as RENDERED_ASSET_CATEGORIES } from '../src/types';
import {
  AssetConflictError,
  type LibraryBackend,
  type AssetInput,
  type CommentPatch,
  type HealthProbe,
  type StudioStore,
} from './libraryBackend';
import { HttpError, sendJson, sendJsonValidated } from './httpUtil';
import { memoizeCorpusWalk } from './corpusMemo';
import { selectHierarchy, announceHierarchyOrigin } from './hierarchySource';
import { handleDb } from './dbControl';
import { handleDbWake, type DbWaker } from './dbWake';
import type { CodeStamp } from './codeStamp';
import type { InviteMailer } from './inviteMailer';
// writeBroker.ts is config-load-safe (it type-imports the raw-TS zod packages and loads their runtime
// values lazily), so it can be statically imported here without pulling proof-protocol's enums.js into
// vite's config-load graph — the same way libraryBackend.ts is statically imported.
import { handleWriteBroker, type WriteBrokerBackend } from './writeBroker';
// The ADR-0259 store door: the narrow `Store` seam served over ordinary HTTPS, so a client with no
// Cloud SQL connector (a remote session) can still READ the library. Read-only by decision — see
// storeDoorApi.ts. Config-load-safe: it type-imports the store seam and pulls the wire contract's
// route table, which is a plain object literal with no zod/`node:` runtime graph behind it.
import { handleStoreDoor, STORE_DOOR_BASE_PATH } from './storeDoorApi';
// The context-traversal replay read route (`traversal-panel-arc`). Config-load-safe the same way
// writeBroker.ts is: it type-imports the two traversal packages (fully erased) and pulls their runtime
// values lazily inside the handler, so their `node:`/zod graph never enters vite's config-load path.
import { handleTraversal } from './traversalApi';
// The context-window meter's read route (ADR-0452 D1/D2). Config-load-safe the same way: it
// type-imports `@storytree/context-traversal-transcript` (fully erased) and pulls the runtime value
// lazily inside the handler. See contextWindowsApi.ts.
import { handleContextWindows } from './contextWindowsApi';
import { handleSuggestionDecision, type SuggestionDecisionBackend } from './suggestionApi';
import { handleSuggestionCreate, type SuggestionCreateBackend } from './suggestionCreateApi';
// The shared block model (ADR-0140): the SAME deterministic split/splice the Review-mode client
// keys its threads by — pure, browser-safe, imported the way server code already imports ../src.
import { applySuggestionToBody } from '../src/lib/blocks';
import {
  handleReviewFeed,
  type ReviewFeedCommentStore,
  type ReviewFeedSuggestionStore,
} from './reviewFeedApi';

/**
 * Categories that RENDER but may not be WRITTEN through this door. `proposal` is the only member:
 * ADR-0298 retired the kind (deferred work is an `increment` on its arc), so historical rows must
 * still render while nothing new may be created.
 */
const NOT_WRITABLE: readonly AssetCategory[] = ['proposal'];

/**
 * The write allowlist, DERIVED from the one canonical category list rather than restated here.
 *
 * It used to be a second hand-maintained array, and that duplication is a landed defect with a name:
 * `friction-studio-kind-blind` (2026-07-06) — a kind added to the schema but not to this array is
 * invisible in the UI and 400s on write, with `pnpm gate` green throughout. Typing it
 * `AssetCategory[]` made every MEMBER valid and said nothing about the array being COMPLETE, which is
 * the half that bit. It recurred verbatim for `resteer` (ADR-0515, 2026-09-05); deriving it is what
 * stops there being a third time.
 */
const ASSET_CATEGORIES: readonly AssetCategory[] = RENDERED_ASSET_CATEGORIES.filter(
  (category) => !NOT_WRITABLE.includes(category),
);

export interface Paths {
  repoRoot: string;
  docsDir: string;
  storiesDir: string;
  dataDir: string;
  commentsFile: string;
  /** The offline JsonBackend's GITIGNORED runtime assets store, seeded from knowledgeFile (ADR-0210). */
  assetsFile: string;
  usersFile: string;
  attestationsFile: string;
}

/**
 * Resolve every repo path the API serves from, given the studio app root.
 *
 * The repo root is a PARAMETER (ADR-0246, `foreign-project-forest-arc` inc 1): an explicit
 * `repoRootOverride` wins, then `STORYTREE_REPO_ROOT`, then the studio-root derivation this used to
 * do unconditionally. That is the seam a forest for a project that is NOT storytree needs — `docs/`
 * and `stories/` belong to the project being described, while `dataDir` deliberately stays anchored
 * to `studioRoot` — it holds the offline runtime store and comments, which belong to the app rather
 * than to the user's repo (ADR-0244 D3; the Library corpus itself now lives in the store).
 */
export function resolveStudioPaths(studioRoot: string, repoRootOverride?: string): Paths {
  const { root: repoRoot } = resolveRepoRoot({
    explicit: repoRootOverride,
    env: process.env[REPO_ROOT_ENV],
    derived: path.resolve(studioRoot, '..', '..'),
  });
  const dataDir = path.join(studioRoot, 'data');
  return {
    repoRoot,
    docsDir: path.join(repoRoot, 'docs'),
    storiesDir: path.join(repoRoot, 'stories'),
    dataDir,
    commentsFile: path.join(dataDir, 'comments.json'),
    // ADR-0210: the offline store is a gitignored RUNTIME file, seeded on first read from the
    // library's committed fixture corpus (deriveOfflineAssets) — not the retired generated
    // assets.json, and since ADR-0302 D1 not the deleted knowledge.json either.
    assetsFile: path.join(dataDir, 'assets.runtime.json'),
    usersFile: path.join(dataDir, 'users.json'),
    attestationsFile: path.join(dataDir, 'attestations.json'),
  };
}

// ---------- small http helpers ----------

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

// ---------- docs (read-only, live from <repo>/docs) ----------

function deriveTitle(markdown: string, filename: string): string {
  const m = markdown.match(/^#\s+(.+?)\s*$/m);
  return m && m[1] ? m[1] : filename.replace(/\.md$/, '');
}

/** Drop a leading YAML frontmatter block (ADR-0037 structured status) — readers get prose. */
function stripFrontmatter(markdown: string): string {
  if (!markdown.startsWith('---\n')) return markdown;
  const end = markdown.indexOf('\n---', 4);
  if (end === -1) return markdown;
  return markdown.slice(end + 4).replace(/^\s*\n/, '');
}



/**
 * The first prose sentence after the H1 title — the one-line description shown
 * on Library ADR cards. Skips the title, ATX headings, and short metadata values
 * (ADRs lead with Status/Date), then takes the first sentence of the first block
 * that actually reads as prose (i.e. has sentence punctuation). Empty if none.
 */
function deriveExcerpt(markdown: string): string {
  const body = markdown.replace(/^#\s+.*$/m, ''); // drop the H1 title line
  for (const block of body.split(/\n\s*\n/)) {
    const b = block.trim();
    if (!b || b.startsWith('#')) continue; // blank line or a heading
    const plain = b.replace(/\s+/g, ' ').replace(/[*_`>]/g, '').trim();
    const m = plain.match(/^(.+?[.;])(\s|$)/);
    if (!m || !m[1]) continue; // not a sentence (e.g. "accepted", a bare date)
    const s = m[1].trim();
    return s.length > 200 ? s.slice(0, 197).trimEnd() + '…' : s;
  }
  return '';
}

/**
 * Every `.md` under `docsDir`, as `DocMeta[]`. Returns `[]` when the dir does not exist.
 *
 * ★ IT NO LONGER PRODUCES A `Decisions` GROUP (ADR-0403 dec 1). Decisions are ordinary Library
 * artifacts of kind `adr` — the Library surface already serves all of them, with their structured
 * state, their comments and the whole artifact envelope — so this walker is back to being exactly
 * what its name says: the `docs/` tree. The ADR-specific machinery it carried (a frontmatter status
 * read, the load-bearing + lineage wire-signal fold, and the number→id map that resolved lineage
 * edges to `doc:` pointers) is DELETED rather than left unreachable: `docs/decisions/` does not
 * exist, so that code could only ever have looked live.
 */
export async function listDocs(docsDir: string): Promise<DocMeta[]> {
  const out: DocMeta[] = [];
  async function walk(dir: string): Promise<void> {
    if (!existsSync(dir)) return;
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full);
      } else if (ent.isFile() && ent.name.endsWith('.md')) {
        const relId = path.relative(docsDir, full).split(path.sep).join('/');
        const content = stripFrontmatter(await fs.readFile(full, 'utf8'));
        out.push({
          id: relId,
          title: deriveTitle(content, ent.name),
          group: 'Reference',
          excerpt: deriveExcerpt(content),
        });
      }
    }
  }
  await walk(docsDir);
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Resolve `id` under `baseDir`, refusing traversal that escapes it (a `..` that climbs out, or an
 * absolute id). Returns the absolute resolved path, or null on escape. The ONE containment rule
 * shared by {@link safeDocPath} (docs) and {@link uatContextForStory} (stories): `path.join` /
 * `path.resolve` COLLAPSE `..` segments, so an id like `../../x` would otherwise reach outside the
 * base — this asserts the resolved path stays within it. Exported for the traversal unit test.
 *
 * THE TWO ARMS ANSWER ON DIFFERENT PLATFORMS, which is why `flavour` is injectable. Posix has ONE
 * filesystem root, so `path.relative` can always express an escape as a `..`-prefixed relpath and
 * `isAbsolute(rel)` is unreachable — on the hosted (Linux) studio the second arm is dead code.
 * Win32 has MANY roots: an id on another drive (`D:\secret.md`) or a UNC share resolves to a relpath
 * that is absolute and does NOT start with `..`, so there the second arm is the ONLY thing refusing
 * it — and the desktop backend, which reproduces this rule, ships on Windows. Defaulting to the
 * ambient `path` keeps every caller unchanged; the parameter exists so the test can prove BOTH arms
 * on ONE platform's CI. Without it the win32 arm was provable only on a Windows runner, and the
 * assertion standing in for it asserted Node's own behaviour rather than this function's — measured
 * 2026-08-30: deleting `isAbsolute` left the whole studio suite green.
 */
export function containedPath(
  baseDir: string,
  id: string,
  flavour: path.PlatformPath = path,
): string | null {
  const resolved = flavour.resolve(baseDir, id);
  const rel = flavour.relative(baseDir, resolved);
  if (rel.startsWith('..') || flavour.isAbsolute(rel)) return null;
  return resolved;
}

/**
 * Resolve a requested doc id to an absolute path, refusing traversal + a non-`.md` target.
 * Exported for the traversal unit test, like {@link containedPath}: the `.md` refusal is this
 * function's own contribution — {@link containedPath} does not make it — so a test that only drives
 * the containment rule leaves it unproved, which is the state it was in until 2026-08-30.
 */
export function safeDocPath(docsDir: string, id: string): string | null {
  const resolved = containedPath(docsDir, id);
  if (!resolved || !resolved.endsWith('.md')) return null;
  return resolved;
}

// ---------- validation ----------

function asString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/** A flat string→string record (drops non-string values); `{}` for anything that isn't an object. */
function asStringRecord(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out satisfies Record<string, string>;
}

function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Normalise an incoming comment anchor (topic / section / block). */
function readAnchor(raw: Record<string, unknown>): CommentAnchor {
  const kindRaw = asString(raw.kind);
  const headingSlug = asString(raw.headingSlug).trim() || null;
  const quote = typeof raw.quote === 'string' && raw.quote.length > 0 ? raw.quote : null;
  const blockId = asString(raw.blockId).trim() || null;
  let kind: CommentAnchor['kind'] = 'topic';
  // Block anchor (ADR-0140): carry the handle through — the store boundary's
  // normalizeCommentAnchor is the canonical wall and keeps kind:'block' + blockId.
  // The old kind:'text' is retired (remove-text-selection-anchoring): a legacy text
  // anchor now degrades to 'topic' (its span fields ride inert; the store strips them).
  if (kindRaw === 'block' && blockId) kind = 'block';
  else if (kindRaw === 'section' && headingSlug) kind = 'section';
  const anchor: CommentAnchor = {
    kind,
    headingSlug,
    headingText: asString(raw.headingText).trim() || null,
    quote,
    prefix: typeof raw.prefix === 'string' ? raw.prefix : null,
    suffix: typeof raw.suffix === 'string' ? raw.suffix : null,
    startOffset: asNumberOrNull(raw.startOffset),
    color: asString(raw.color).trim() || null,
  };
  if (kind === 'block' && blockId !== null) anchor.blockId = blockId;
  return anchor;
}

// ---------- guarded-mode policy seam (ADR-0042) ----------

/**
 * Comment write scoping for hosted mode (studio-cloud `guest-scope`): the
 * author is STAMPED from the verified identity (the client field is ignored —
 * authorship cannot be forged), and `ownOnly` callers may only PATCH/DELETE
 * comments they authored. `null` scope = the open dev posture (client-supplied
 * author, no ownership wall).
 */
export interface CommentScope {
  author: string;
  ownOnly: boolean;
}

/**
 * The caller's membership, as `GET /api/me` reports it to the SPA (ADR-0043):
 * who they are, their role, and whether they're a member at all (so the client can
 * render the app or the request-access wall). `storeUnreachable` is the degraded
 * signal when membership couldn't be resolved because the live store was down.
 */
export interface MeInfo {
  email: string | null;
  role: 'admin' | 'builder' | 'member' | null;
  status: 'invited' | 'active' | null;
  member: boolean;
  storeUnreachable?: boolean;
  /**
   * Whether this caller may wake the idle-stopped DB from the hosted studio (studio-cloud
   * `hosted-db-wake`, ADR-0049) — drives the StoreBanner's "Wake the database" button. Seed admins
   * (degraded mode) or resolved admins (normal mode); false for the open dev posture (local uses
   * the gcloud Start DB button instead).
   */
  canWakeDb?: boolean;
}

/** The open dev posture's `/api/me` — no policy means full local access (the studio works offline). */
export const DEV_ME: MeInfo = { email: null, role: 'admin', status: 'active', member: true, canWakeDb: false };

/**
 * What the hosted server injects per request. `gate` runs before dispatch and
 * refuses by throwing HttpError (401 identity-less, 403 non-member / out-of-scope
 * write, 503 store-down); `me` answers `GET /api/me`; absent policy = the open dev
 * posture.
 */
export interface ApiPolicy {
  gate(method: string, pathname: string): void;
  commentScope: CommentScope | null;
  me: MeInfo;
  /**
   * The resolved members access for the caller (ADR-0117): threaded so the write-broker handler can
   * read the role off the SAME ResolvedAccess the gate authorized from, rather than a lossy MeInfo
   * reconstruction. `null` = no identity / non-member / membership unresolved (degraded).
   */
  access: ResolvedAccess | null;
}

// ---------- route handlers ----------

export async function handleComments(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  // NARROWED TO WHAT IT ACTUALLY REACHES — the four comment verbs, and nothing else on the backend.
  // Declaring the whole `LibraryBackend` forced every caller that is not a live backend (the mirror
  // probe, above all) to reach it through an `as unknown as` chain, which the house TypeScript
  // standard refuses and which discards the very evidence a reader wants. Same `Pick` shape
  // `handleClaims` and `handleActivity` already use.
  backend: Pick<
    LibraryBackend,
    'listComments' | 'createComment' | 'updateComment' | 'deleteComment'
  >,
  scope: CommentScope | null = null,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    const topicId = url.searchParams.get('topicId');
    const topicKind = url.searchParams.get('topicKind');
    interface FilterShape { topicId?: string; topicKind?: 'doc' | 'asset' }

    const filter: FilterShape = {};
    if (topicId) filter.topicId = topicId;
    if (topicKind === 'doc' || topicKind === 'asset') filter.topicKind = topicKind;
    return sendJson(res, 200, await backend.listComments(filter));
  }

  if (method === 'POST') {
    const input = await readJsonBody<Record<string, unknown>>(req);
    const body = asString(input.body).trim();
    const topicId = asString(input.topicId).trim();
    const topicKind = asString(input.topicKind);
    if (!body) throw new HttpError(400, 'comment body is required');
    if (!topicId) throw new HttpError(400, 'topicId is required');
    if (topicKind !== 'doc' && topicKind !== 'asset') {
      throw new HttpError(400, 'topicKind must be "doc" or "asset"');
    }
    const comment: Comment = {
      id: randomUUID(),
      topicKind,
      topicId,
      anchor: readAnchor((input.anchor ?? {}) as Record<string, unknown>),
      body,
      // Hosted mode stamps the verified identity; dev keeps the client field.
      author: scope ? scope.author : asString(input.author).trim() || 'operator',
      createdAt: new Date().toISOString(),
      resolved: false,
      resolvedAt: null,
    };
    return sendJson(res, 201, await backend.createComment(comment));
  }

  if (method === 'PATCH') {
    const id = url.searchParams.get('id') ?? '';
    await ensureCommentOwnership(backend, id, scope);
    const raw = await readJsonBody<Record<string, unknown>>(req);
    const patch: CommentPatch = {};
    if (typeof raw.body === 'string' && raw.body.trim()) patch.body = raw.body.trim();
    if (typeof raw.resolved === 'boolean') patch.resolved = raw.resolved;
    const next = await backend.updateComment(id, patch);
    if (!next) throw new HttpError(404, 'comment not found');
    return sendJson(res, 200, next);
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id') ?? '';
    await ensureCommentOwnership(backend, id, scope);
    if (!(await backend.deleteComment(id))) throw new HttpError(404, 'comment not found');
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(405, `method ${method} not allowed`);
}

/**
 * The own-comments-only wall: an `ownOnly` caller may not move another author's
 * comment. A missing comment falls through (the backend call answers the 404),
 * so ownership never leaks existence.
 */
async function ensureCommentOwnership(
  // Narrowed with its caller (`handleComments`) to the one verb it reaches — it reads the comment
  // list to check authorship and touches nothing else on the backend.
  backend: Pick<LibraryBackend, 'listComments'>,
  id: string,
  scope: CommentScope | null,
): Promise<void> {
  if (!scope?.ownOnly || !id) return;
  const target = (await backend.listComments({})).find((c) => c.id === id);
  if (target && target.author !== scope.author) {
    throw new HttpError(403, 'read + comment scope — you can only edit your own comments');
  }
}

function isValidSlug(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

function readAssetInput(input: Record<string, unknown>): AssetInput {
  const id = asString(input.id).trim();
  const category = asString(input.category) as AssetCategory;
  const title = asString(input.title).trim();
  const description = asString(input.description).trim();
  const body = asString(input.body).trim();
  const fields = asStringRecord(input.fields);
  const hasFields = Object.keys(fields).length > 0;
  if (!isValidSlug(id)) throw new HttpError(400, 'id must be a kebab-case slug (a-z, 0-9, hyphens)');
  if (!ASSET_CATEGORIES.includes(category)) throw new HttpError(400, 'invalid category');
  if (!title) throw new HttpError(400, 'title is required');
  if (!description) throw new HttpError(400, 'description is required');
  // A structured unit carries per-kind `fields` (the body is a derived render); a body-only unit
  // (template / adr) must carry a body. The per-field structural validation runs at the store's
  // zod write boundary (mapped to 400 in handleAssets).
  if (!hasFields && !body) throw new HttpError(400, 'body is required');
  const provenance = asString(input.provenance).trim();
  const asset: AssetInput = {
    id,
    category,
    title,
    description,
    body,
  };
  if (provenance) asset.provenance = provenance;
  if (hasFields) asset.fields = fields;
  return asset;
}

/** Map a store write-boundary error to an HTTP status: a zod failure is a 400, a conflict a 409. */
function assetWriteError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof AssetConflictError) return new HttpError(409, err.message);
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'ZodError') {
    return new HttpError(400, `structured doc failed validation: ${err instanceof Error ? err.message : String(err)}`);
  }
  return new HttpError(500, err instanceof Error ? err.message : String(err));
}

// pg error codes / syscall codes that mean "the DB isn't there", not "your request was bad":
// admin shutdown/crash (57P0x), connection-does-not-exist / can't-connect (08xxx), and the
// usual socket-level failures from a stopped Cloud SQL instance.
const PG_CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  '57P01',
  '57P02',
  '57P03',
  '08006',
  '08001',
]);

/**
 * Whether an UNRECOGNISED error (not HttpError / ZodError / AssetConflictError — those carry
 * their own status) looks like a pg connection failure. Mapped to 503 in the central catch so
 * the UI can tell "DB is down, press Start" apart from a genuine server bug (500).
 */
export function isConnectionError(err: unknown): boolean {
  if (err instanceof HttpError || err instanceof AssetConflictError) return false;
  if (isLastAdminError(err)) return false;
  if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'ZodError') return false;
  const code = err && typeof err === 'object' ? (err as { code?: unknown }).code : undefined;
  if (typeof code === 'string' && PG_CONNECTION_CODES.has(code)) return true;
  const message = err instanceof Error ? err.message : '';
  return /connect|terminat|timeout/i.test(message);
}

/**
 * A last-admin guard violation, identified by `name` alone (`LastAdminError`) so neither
 * the route layer nor the JSON backend needs to import the store's class — the pg store
 * throws the real class, the JSON backend throws a tagged Error, both read the same here.
 */
function isLastAdminError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'LastAdminError';
}

const DB_UNREACHABLE_MESSAGE =
  'live store unreachable — start the DB (pnpm db:up or the Start DB button)';

export async function handleAssets(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  backend: LibraryBackend,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    return sendJson(res, 200, await backend.listAssets());
  }

  if (method === 'POST') {
    const input = readAssetInput(await readJsonBody<Record<string, unknown>>(req));
    try {
      return sendJson(res, 201, await backend.createAsset(input));
    } catch (err) {
      throw assetWriteError(err);
    }
  }

  if (method === 'PATCH') {
    const id = url.searchParams.get('id') ?? '';
    // The id is fixed by the path; the body supplies the new category/title/description/body/fields/refs.
    const input = readAssetInput({
      ...(await readJsonBody<Record<string, unknown>>(req)),
      id,
    });
    let next;
    try {
      next = await backend.updateAsset(id, input);
    } catch (err) {
      throw assetWriteError(err);
    }
    if (!next) throw new HttpError(404, 'asset not found');
    return sendJson(res, 200, next);
  }

  if (method === 'DELETE') {
    const id = url.searchParams.get('id') ?? '';
    if (!(await backend.deleteAsset(id))) throw new HttpError(404, 'asset not found');
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(405, `method ${method} not allowed`);
}

// ---------- users (admin-only, ADR-0043 invite-ui) ----------
//
// The gate (createMembersPolicy) restricts /api/users to admins; these handlers carry the CRUD.
// invitedBy + the audit actor come from the verified caller (ctx.policy.me.email). The last-admin
// guard lives at the store's write boundary — a violation throws a name-tagged LastAdminError that
// the central catch maps to 409. Email is normalised locally (trim + lowercase) for lookups; the
// store re-validates through @storytree/core's zod schema on every write.

function normalizeEmailInput(raw: string): string {
  return raw.trim().toLowerCase();
}

// Reads USER_ROLES rather than restating it. The literal union here was `'admin' | 'member'`, which
// silently made the Members panel unable to grant `builder` — a role the schema has had since the
// `builder-role` capability landed its compute half, and the exact role `stories/desktop` leg 8's
// journey needs ("the owner's in-app `builder` grant opens the brokered write path"). Nothing caught
// it because there was no second surface to disagree: `storytree members` is that surface now, and
// deriving the check from the enum is what stops the two drifting apart again.
function asRole(v: unknown, roles: readonly string[]): UserRole | null {
  return typeof v === 'string' && roles.includes(v) ? (v as UserRole) : null;
}

export async function handleUsers(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  backend: Pick<LibraryBackend, 'listUsers' | 'getUser' | 'upsertUser' | 'removeUser'>,
  caller: string | null,
  mailer: InviteMailer | null = null,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    return sendJson(res, 200, await backend.listUsers());
  }

  // One lazy load for both write arms (see loadStudioMembers): the role set is the SCHEMA's, never a
  // literal union restated here — restating it is what silently made `builder` ungrantable.
  const { USER_ROLES } = await loadStudioMembers();

  if (method === 'POST') {
    // Invite: write an `invited` row, then email the invitee the studio link (best-effort — the row
    // is already authoritative; a mail failure is reported, not a 500). Activation still happens on
    // the invitee's first request (resolveMembersAccess). A duplicate email is a 409, not a silent
    // overwrite. The `notify` field tells the admin whether the email actually went out.
    const input = await readJsonBody<Record<string, unknown>>(req);
    const email = normalizeEmailInput(asString(input.email));
    const role = asRole(input.role, USER_ROLES);
    if (!email || !email.includes('@')) throw new HttpError(400, 'a valid email is required');
    if (!role) throw new HttpError(400, `role must be one of: ${USER_ROLES.join(', ')}`);
    if (await backend.getUser(email)) throw new HttpError(409, `${email} is already in the directory`);
    const now = new Date().toISOString();
    const created = await backend.upsertUser(
      { email, role, status: 'invited', invitedBy: caller, createdAt: now, lastSeenAt: now },
      caller ?? 'admin',
    );
    const notify = mailer
      ? await mailer.send(email, role, caller)
      : { status: 'skipped' as const, detail: 'email notifications are not configured' };
    return sendJson(res, 201, { ...created, notify });
  }

  if (method === 'PATCH') {
    // Re-role. Spread the existing row so status/invitedBy/createdAt survive; the guard refuses a
    // downgrade of the last admin (→ 409).
    const input = await readJsonBody<Record<string, unknown>>(req);
    const email = normalizeEmailInput(asString(input.email));
    const role = asRole(input.role, USER_ROLES);
    if (!email) throw new HttpError(400, 'a valid email is required');
    if (!role) throw new HttpError(400, `role must be one of: ${USER_ROLES.join(', ')}`);
    const existing = await backend.getUser(email);
    if (!existing) throw new HttpError(404, 'user not found');
    const updated = await backend.upsertUser({ ...existing, role }, caller ?? 'admin');
    return sendJson(res, 200, updated);
  }

  if (method === 'DELETE') {
    // Remove. History is retained (comment authorship stays attributed); the last admin can't go.
    const email = normalizeEmailInput(url.searchParams.get('email') ?? '');
    if (!email) throw new HttpError(400, 'email query param is required');
    if (!(await backend.removeUser(email, caller ?? 'admin'))) throw new HttpError(404, 'user not found');
    return sendJson(res, 200, { ok: true });
  }

  throw new HttpError(405, `method ${method} not allowed`);
}

// ---------- per-UAT-test attestations (ADR-0044 attestation-surface) ----------
//
// GET /api/attestations?storyId=<id> — the story's UAT test criteria (parsed from its `## UAT Test Criteria`
// prose via the orchestrator's loadNodeSpec, the SAME source as the CLI tree column) joined with
// their latest human/machine marks. Member-readable. POST /api/attestations — an admin records a
// DIRECT human attestation (signer stamped from the verified caller, no agent relay — the higher-
// rigor in-UI signature, ADR-0044 d.4); admin-only by the gate's method rule. A vouch, never a
// gate verdict (d.2): this writes events.attestation only and the world island hue is untouched.

/**
 * A story's UAT legs + the facts the ADR-0106 witness resolution needs (its reliability gates, to
 * route a `machine` leg, and its status, for the "no `either` at rest" guard) via loadNodeSpec (lazy
 * orchestrator); `null` for a missing/odd spec.
 */
export async function uatContextForStory(
  storiesDir: string,
  storyId: string,
): Promise<{ tests: UatTestCriterion[]; gates: ReliabilityGate[]; status: string } | null> {
  // `storyId` comes from the GET /api/attestations query string (member-readable). Refuse an id that
  // escapes the stories root — the SAME containment guard `safeDocPath` uses — before `path.join`
  // collapses a `../…` out of the root. Bounded to files named `story.md`, but an unchecked `..`
  // would still be a filesystem existence oracle + limited structured (UAT) disclosure. A rejected id
  // reads as a missing story (null), never an oracle.
  const storyDir = containedPath(storiesDir, storyId);
  if (!storyDir) return null;
  const file = path.join(storyDir, 'story.md');
  if (!existsSync(file)) return null;
  const { loadNodeSpec } = await loadOrchestrator();
  try {
    const spec = loadNodeSpec(file);
    return { tests: spec.uatTestCriteria, gates: spec.reliabilityGates, status: spec.status };
  } catch {
    return null;
  }
}

/** A story's UAT test units; `[]` for a missing/odd spec (handleUatAttest's narrower need). */
async function uatTestCriteriaForStory(storiesDir: string, storyId: string): Promise<UatTestCriterion[]> {
  return (await uatContextForStory(storiesDir, storyId))?.tests ?? [];
}

/** The classifier seam {@link resolveUatRowWitnesses} injects — the library's witness-resolution core. */
export interface UatWitnessResolver {
  resolvedWitnessOf: (
    leg: Pick<UatTestCriterion, 'witness'>,
    gates: readonly Pick<ReliabilityGate, 'id' | 'kind'>[],
  ) => ResolvedWitnessKind;
  unresolvedUatLegs: <T extends Pick<UatTestCriterion, 'witness'>>(legs: readonly T[]) => T[];
}

/** A UAT leg with its DECLARED witness replaced by the RESOLVED binary one (ADR-0106 d.5). */
export type ResolvedUatLeg = Omit<UatTestCriterion, 'witness'> & { witness: ResolvedWitnessKind };

export interface ResolveUatRowWitnessesResult { tests: ResolvedUatLeg[]; unresolvedWitnesses: string[] }

/** One row of GET /api/attestations: a resolved leg + its vouch marks, proven state and detail pointer. */
interface UatAttestationRow extends ResolvedUatLeg {
  human?: StoredAttestation;
  machine?: StoredAttestation;
  /** Latest SIGNED verdict outcome (ADR-0082); absent when no verdict stream answered. */
  proven?: 'pass' | 'fail';
  /** ADR-0209 D7 Library detail pointer; absent when the leg carries no `(detail: …)` tag. */
  detailArtifactId?: string;
}

/** The GET /api/attestations response body. */
interface UatAttestationsResponse {
  storyId: string;
  tests: UatAttestationRow[];
  storyUat?: 'healthy' | 'unhealthy' | null;
  unresolvedWitnesses?: string[];
}

/**
 * PURE (ADR-0106 d.5/d.1): resolve each UAT leg's declared witness into the BINARY one the owner
 * surface reads, and compute the "no `either` at rest" guard. The classifier is INJECTED (the library's
 * `resolvedWitnessOf` / `unresolvedUatLegs`, fed by the lazy orchestrator) so the studio is held to the
 * SAME rule the adopt pass uses — the binary can never fork — and the helper stays a unit testable
 * without the HTTP handler. Returns the legs with their resolved witness, plus the ids of any leg still
 * `either` on an ADOPTED story (past `mapped`); a still-`mapped` (pre-adopt) story may hold undecided
 * legs (adopt is what prompts the decision), so the guard does not fire for it.
 */
export function resolveUatRowWitnesses(
  tests: readonly UatTestCriterion[],
  gates: readonly Pick<ReliabilityGate, 'id' | 'kind'>[],
  status: string,
  resolver: UatWitnessResolver,
): ResolveUatRowWitnessesResult {
  const resolved = tests.map((t) => ({ ...t, witness: resolver.resolvedWitnessOf(t, gates) }));
  const adopted = status !== '' && status !== 'mapped' && status !== 'retired';
  const unresolvedWitnesses = adopted
    ? resolver.unresolvedUatLegs(tests).map((t) => t.criterionId)
    : [];
  return { tests: resolved, unresolvedWitnesses };
}

export async function handleAttestations(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: {
    paths: Paths;
    backend: Pick<LibraryBackend, 'listAttestations' | 'recordAttestation' | 'verdictEvents'>;
  },
  caller: string | null,
): Promise<void> {
  const method = req.method ?? 'GET';

  if (method === 'GET') {
    const storyId = (url.searchParams.get('storyId') ?? '').trim();
    if (!storyId) throw new HttpError(400, 'storyId query param is required');
    const [storyCtx, marks, events] = await Promise.all([
      uatContextForStory(ctx.paths.storiesDir, storyId),
      ctx.backend.listAttestations(storyId),
      // The per-test SIGNED-verdict stream (ADR-0082) for the PROVEN state — advisory, same contract
      // as /api/tree's: `null` for the json backend / a down DB (the proven column then silently
      // absent), absent on a partial mock (the `?.()`).
      ctx.backend.verdictEvents?.() ?? Promise.resolve(null),
    ]);
    const tests = storyCtx?.tests ?? [];
    // ADR-0106: resolve each leg's declared witness into the BINARY one the owner surface reads (the
    // word `either` never reaches the UI), and compute the "no `either` at rest" guard — through the
    // SAME classifier the adopt pass uses (the lazy orchestrator re-exports it), so the binary can't fork.
    const { resolvedWitnessOf, unresolvedUatLegs } = await loadOrchestrator();
    const { tests: resolvedTests, unresolvedWitnesses } = resolveUatRowWitnesses(
      tests,
      storyCtx?.gates ?? [],
      storyCtx?.status ?? '',
      { resolvedWitnessOf, unresolvedUatLegs },
    );
    // The PROVEN state (ADR-0082) is the latest SIGNED verdict in events.verdict — a REAL gate
    // verdict, DELIBERATELY DISTINCT from the vouch marks (`human`/`machine`). It greens the story
    // crown via the AND-roll-up; the vouch never does. Derived through the SAME `rollupStatus` /
    // `rollupStoryUat` compute the CLI tree + the crown roll-up use, so the studio can't drift from it.
    let provenOf:
      | ((criterion: Pick<UatTestCriterion, 'criterionId' | 'revisionId'>) =>
          | 'pass'
          | 'fail'
          | undefined)
      | null = null;
    let storyUat: 'healthy' | 'unhealthy' | null | undefined;
    if (events) {
      const { rollupCriterionStatus, rollupStoryUat } = await loadOrchestrator();
      provenOf = (criterion) => {
        const status = rollupCriterionStatus(criterion, events);
        return status === 'healthy' ? 'pass' : status === 'unhealthy' ? 'fail' : undefined;
      };
      storyUat = storyUatRollup(rollupStoryUat(tests, events));
    }
    // ADR-0209 D7: attach optional Library detail pointers from `(detail: …)` tags so the Studio
    // row can open the detail artifact. Parsed via `@storytree/uat-criterion` (same grammar as the
    // offline port); legs without a pointer stay pointer-less.
    const detailByCriterionId = new Map<string, string>();
    const storyDir = containedPath(ctx.paths.storiesDir, storyId);
    if (storyDir) {
      const storyFile = path.join(storyDir, 'story.md');
      if (existsSync(storyFile)) {
        try {
          const { parseCriterionPointers } = await import('@storytree/uat-criterion');
          const body = await fs.readFile(storyFile, 'utf8');
          for (const binding of parseCriterionPointers(storyId, body)) {
            detailByCriterionId.set(binding.criterion.criterionId, binding.detailArtifactId);
          }
        } catch {
          // Malformed detail tags must not blank the attestations panel — omit pointers.
        }
      }
    }
    const rows = resolvedTests.map((t) => {
      const proven = provenOf?.(t);
      const detailArtifactId = detailByCriterionId.get(t.criterionId);
      const row: UatAttestationRow = {
        ...t,
        ...(marks[t.criterionId] ?? {}),
      };
      if (proven) row.proven = proven;
      if (detailArtifactId !== undefined) row.detailArtifactId = detailArtifactId;
      return row;
    });
    const payload: UatAttestationsResponse = {
      storyId,
      tests: rows,
    };
    if (storyUat !== undefined) payload.storyUat = storyUat;
    if (unresolvedWitnesses.length > 0) payload.unresolvedWitnesses = unresolvedWitnesses;
    return sendJson(res, 200, payload);
  }

  if (method === 'POST') {
    const input = await readJsonBody<Record<string, unknown>>(req);
    const storyId = asString(input.storyId).trim();
    const criterionId = asString(input.criterionId).trim();
    if (!storyId || !criterionId) {
      throw new HttpError(400, 'storyId and criterionId are required');
    }
    const criterion = (await uatTestCriteriaForStory(ctx.paths.storiesDir, storyId)).find(
      (candidate) => candidate.criterionId === criterionId,
    );
    if (!criterion) {
      throw new HttpError(400, `no current UAT criterion "${criterionId}" in story "${storyId}"`);
    }
    const outcome = input.outcome === 'fail' ? 'fail' : 'pass';
    const note = asString(input.note).trim();
    // Hosted mode stamps the verified admin as the signer (can't be forged); dev keeps the client
    // field (open localhost posture). An in-UI signature is a DIRECT human vouch — no relayedBy.
    const signer = caller ?? (asString(input.signer).trim() || 'operator');
    const doc: Attestation = {
      testId: criterion.criterionId,
      criterionId: criterion.criterionId,
      revisionId: criterion.revisionId,
      outcome,
      witness: 'human',
      signer,
      at: new Date().toISOString(),
    };
    if (note) doc.note = note;
    try {
      return sendJson(res, 201, await ctx.backend.recordAttestation(doc, signer));
    } catch (err) {
      if (err && typeof err === 'object' && (err as { name?: unknown }).name === 'ZodError') {
        throw new HttpError(400, `attestation failed validation: ${err instanceof Error ? err.message : String(err)}`);
      }
      throw err;
    }
  }

  throw new HttpError(405, `method ${method} not allowed`);
}

// ---------- per-UAT-test operator-attested VERDICT (ADR-0082 — the studio "I saw it work" button) ----------
//
// POST /api/uat/attest signs a REAL `operator-attested` verdict into events.verdict — the studio
// admin's in-UI signature (ADR-0044 §4 deferred, generalized by ADR-0082 to a real green path). This
// is NOT the lower-rigor events.attestation vouch that POST /api/attestations writes: it is the same
// signed gate verdict the CLI `uat attest` and a build produce, so it greens the story crown via
// `rollupStoryUat`. Three honesty walls, all enforced here BEFORE the write, none bypassable:
//  - the signer is the VERIFIED caller (the IAP identity), never a client-supplied field — a verdict's
//    signer cannot be forged;
//  - the sign-time trust guard `checkUatProof` (ADR-0082 d.2) refuses a machine-witness test (a click
//    cannot stand in for a machine proof) and any agent/`sandbox:` self-attestation;
//  - the verdict pins the commit the studio is SERVING and must PERSIST — a verdict that does not
//    land in the live store greens nothing (the json backend refuses, like the CLI's `--pg`).
// Admin-only by the dispatch gate's method rule (POST, not /api/comments).

/**
 * Narrow `rollupStoryUat`'s broad `Status` return to the wire's 3-state story-UAT roll-up. The
 * compute only ever yields healthy/unhealthy/null at runtime (ADR-0082 d.3), but its declared type is
 * the full status enum; mapping anything-not-green-or-withered to `null` also IS the under-claim
 * default — the world never over-claims a crown the per-test verdicts don't support.
 */
function storyUatRollup(rolled: string | null): 'healthy' | 'unhealthy' | null {
  return rolled === 'healthy' || rolled === 'unhealthy' ? rolled : null;
}

/** The POST /api/uat/attest response body — the saved verdict echoed, plus the fresh story roll-up. */
interface UatAttestResponse {
  verdict: Pick<Verdict, 'unitId' | 'criterionId' | 'revisionId' | 'outcome' | 'signer' | 'at'>;
  storyUat?: 'healthy' | 'unhealthy' | null;
}

/** The fields the verdict builder needs about the test + the observation being signed. */
export interface UatVerdictInput {
  test: Pick<UatTestCriterion, 'criterionId' | 'revisionId' | 'witness'>;
  outcome: 'pass' | 'fail';
  /** The resolved (verified) operator identity — never client-supplied. */
  signer: string;
  /** The commit the studio is serving (what the operator observed) — pins the verdict. */
  commitSha: string;
  note?: string;
  /** ISO sign time (injected so the builder is a pure unit). */
  at: string;
}

/**
 * PURE (ADR-0082): run the sign-time trust guard, then build the `operator-attested` {@link Verdict}
 * for a UAT test. `check` is injected (the real `checkUatProof`, fed by the test so the studio is held
 * to the SAME honesty compute as the CLI / the spine) — a `machine`-witness test or an agent/`sandbox:`
 * signer is REFUSED here, before any verdict exists. Returns the verdict to persist, or the refusal
 * reason. No I/O, no clock, no store — the HTTP handler wraps it with those.
 */
export function buildUatVerdict(
  input: UatVerdictInput,
  check: (c: UatProofCheck) => UatProofResult,
): { ok: true; verdict: Verdict } | { ok: false; reason: string } {
  const signer = input.signer.trim();
  const guard = check({ witness: input.test.witness, verdict: { proofMode: 'operator-attested', signer } });
  if (!guard.ok) return { ok: false, reason: guard.reason };
  const note = input.note?.trim();
  const attestEvidence: EvidenceRef = { kind: 'operator-attested', ref: signer };
  if (note) attestEvidence.note = note;
  const verdict: Verdict = {
    unitId: input.test.criterionId,
    criterionId: input.test.criterionId,
    revisionId: input.test.revisionId,
    proofMode: 'operator-attested',
    outcome: input.outcome,
    commitSha: input.commitSha,
    signer,
    runId: `studio-uat-attest:${input.at}`,
    outputVersion: 'v1',
    evidence: [attestEvidence],
    at: input.at,
  };
  return { ok: true, verdict };
}

/**
 * POST /api/uat/attest — sign an operator-attested UAT verdict (see the section header for the three
 * honesty walls). `caller` is the verified IAP identity (the signer; the open dev posture has none →
 * the conventional `operator`); `commitSha` is the studio's serving commit (refused if unresolvable).
 */
export async function handleUatAttest(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: {
    paths: Paths;
    backend: Pick<LibraryBackend, 'signUatVerdict' | 'verdictEvents'>;
    /**
     * ISO sign time. Defaults to the wall clock; INJECTED by `uatAttestMirrorProbe.ts` for the same
     * reason `buildUatVerdict` already takes `at` — the conformance harness compares this composed
     * verdict against the desktop's, and the two probes are separate processes at different moments,
     * so a wall-clock read here is nondeterminism ACROSS the payloads being compared (the trap
     * `floor-health-fixtures` records). Not a policy seam: nothing in production passes it.
     */
    now?: () => string;
  },
  caller: string | null,
  commitSha: string | null,
): Promise<void> {
  if ((req.method ?? 'GET') !== 'POST') throw new HttpError(405, 'method not allowed');
  const input = await readJsonBody<Record<string, unknown>>(req);
  const storyId = asString(input.storyId).trim();
  const criterionId = asString(input.criterionId).trim();
  if (!storyId || !criterionId) {
    throw new HttpError(400, 'storyId and criterionId are required');
  }
  const outcome = input.outcome === 'fail' ? 'fail' : 'pass';
  const note = asString(input.note).trim();

  // The test must be a real DECLARED unit — its witness drives the trust guard. A typo'd id never
  // signs a verdict against nothing (the CLI `uat attest` posture).
  const tests = await uatTestCriteriaForStory(ctx.paths.storiesDir, storyId);
  const test = tests.find((t) => t.criterionId === criterionId);
  if (!test) {
    throw new HttpError(
      400,
      tests.length === 0
        ? `no UAT criterion "${criterionId}" — story "${storyId}" declares no UAT test criteria (or its spec did not load)`
        : `no UAT criterion "${criterionId}" in story "${storyId}"; declared: ${tests.map((t) => t.criterionId).join(', ')}`,
    );
  }

  // HONESTY WALL: the signer is the VERIFIED caller — NEVER `input.signer` (a verdict's signer is not
  // forgeable). The open dev posture (no policy → no caller) stamps the conventional local operator,
  // exactly like handleComments / handleAttestations.
  const signer = caller ?? 'operator';

  // HONESTY WALL: the verdict pins the commit the studio is serving. Unresolvable (no git HEAD and no
  // deploy stamp) → refuse — a verdict must pin a real commit (fail-closed).
  if (!commitSha) {
    throw new HttpError(
      422,
      "could not resolve the studio's serving commit to pin the verdict (no git HEAD / STORYTREE_STUDIO_COMMIT)",
    );
  }

  // HONESTY WALL: the sign-time trust guard (checkUatProof) — refuse a machine-witness test / an
  // agent self-attestation BEFORE any write. The compute is the orchestrator's single source.
  const { checkUatProof, rollupStoryUat } = await loadOrchestrator();
  const verdictInput: UatVerdictInput = { test, outcome, signer, commitSha, at: (ctx.now ?? (() => new Date().toISOString()))() };
  if (note) verdictInput.note = note;
  const built = buildUatVerdict(verdictInput, checkUatProof);
  if (!built.ok) throw new HttpError(422, `refused — ${built.reason}`);

  // HONESTY WALL: the write must persist (a verdict that evaporates greens nothing). The json backend
  // has no events.verdict — refuse, mirroring the CLI's `--pg`-only `uat attest`.
  if (!ctx.backend.signUatVerdict) {
    throw new HttpError(503, 'signing a UAT verdict needs the live store (pg) — bring the DB up (pnpm db:up)');
  }
  const saved = await ctx.backend.signUatVerdict(built.verdict, signer);

  // Echo the story's fresh UAT roll-up so the UI can confirm whether this signature greened the crown
  // (ADR-0082 d.3 — the AND over every declared per-test verdict). Best-effort: absent if the backend
  // has no verdict-event read.
  const events = (await ctx.backend.verdictEvents?.()) ?? null;
  const storyUat = events ? storyUatRollup(rollupStoryUat(tests, events)) : undefined;
  const body: UatAttestResponse = {
    verdict: {
      unitId: saved.unitId,
      criterionId: test.criterionId,
      revisionId: test.revisionId,
      outcome: saved.outcome,
      signer: saved.signer,
      at: saved.at,
    },
  };
  if (storyUat !== undefined) body.storyUat = storyUat;
  sendJson(res, 201, body);
}

// ---------- story tree (read-only, live from <repo>/stories) ----------
//
// Mirrors the CLI `storytree tree` discovery contract (packages/cli/src/tree.ts):
// a story is a stories/<dir> with a story.md; capabilities come from the story
// frontmatter's `capabilities` list, each at <dir>/<capId>.md. Load failures are
// tolerated per node — the view renders what it can, with the reason attached —
// because one malformed spec must not blank the whole tree.
//
// @storytree/orchestrator (loadNodeSpec) is loaded LAZILY on first /api/tree hit,
// NOT statically: this module is reached at Vite config-load / `vite build` time,
// where the loader has no tsx transform and cannot resolve the orchestrator's raw-TS
// `.js` re-export specifiers (ERR_MODULE_NOT_FOUND) — the same trap, and the same
// fix, as PgBackend's dynamic import of the store `./store` subpaths in libraryBackend.ts.

type OrchestratorModule = typeof import('@storytree/orchestrator');
type LoadNodeSpec = OrchestratorModule['loadNodeSpec'];

let orchestratorModulePromise: Promise<OrchestratorModule> | null = null;

function loadOrchestrator(): Promise<OrchestratorModule> {
  return (orchestratorModulePromise ??= import('@storytree/orchestrator'));
}

// @storytree/library is browser-safe (pure zod) but raw-TS like the others — its `.js` specifiers
// don't resolve under vite's config-load, so it is loaded lazily on first use too. Loaded at request
type LibraryModule = typeof import('@storytree/library');
// @storytree/studio-members is pure zod and browser-safe, but raw-TS like the others: its barrel
// re-exports `./users.js`, which Node's ESM resolver cannot resolve during vite's CONFIG-LOAD (no
// tsx there). `asRole` needs USER_ROLES as a VALUE — deriving the role check from the schema instead
// of restating it is ADR-0439 D3 — so it is loaded lazily, at request time, past config-load. A
// top-level value import here reds `pnpm -r build` and `e2e-desktop` while typecheck and test both
// stay GREEN, which is exactly how this trap keeps getting re-hit.
type StudioMembersModule = typeof import('@storytree/studio-members');
let studioMembersModulePromise: Promise<StudioMembersModule> | null = null;
function loadStudioMembers(): Promise<StudioMembersModule> {
  return (studioMembersModulePromise ??= import('@storytree/studio-members'));
}

let libraryModulePromise: Promise<LibraryModule> | null = null;
function loadLibrary(): Promise<LibraryModule> {
  return (libraryModulePromise ??= import('@storytree/library'));
}

// @storytree/notice-board is browser-safe (pure zod) but raw-TS too — same config-load trap, same
// fix: loaded lazily on first use (handleClaims' groupClaimsBySession fold, ADR-0200 D7).
type NoticeBoardModule = typeof import('@storytree/notice-board');
let noticeBoardModulePromise: Promise<NoticeBoardModule> | null = null;
function loadNoticeBoard(): Promise<NoticeBoardModule> {
  return (noticeBoardModulePromise ??= import('@storytree/notice-board'));
}

// @storytree/drive's ROOT barrel re-exports the build drivers, which import @storytree/library — so
// it hits the SAME vite config-load trap as the two above and is loaded lazily on first use, past
// config-load. (This note used to add that a `@storytree/drive/build-worker` SUBPATH was imported
// statically at the top of this file and was safe as a leaf-shaped entry. There is no such import:
// ADR-0404 removed the studio's build routes and ADR-0422 deleted the subpath itself. Corrected in
// place, ADR-0422 D5 — the lazy-load rule for the root barrel is what survives and is unchanged.)
type DriveModule = typeof import('@storytree/drive');
let driveModulePromise: Promise<DriveModule> | null = null;
function loadDrive(): Promise<DriveModule> {
  return (driveModulePromise ??= import('@storytree/drive'));
}

// @storytree/arc — the arc rollup's home since `arc-tier-extraction-arc` gave the arc domain its own
// package. It re-exports drive, so it hits the same config-load trap and is loaded the same lazy way.
// This is the derived arc → children join the CLI's `arc show` renders, shared rather than
// re-implemented (ADR-0267); the package moved, the sharing did not.
type ArcModule = typeof import('@storytree/arc');
let arcModulePromise: Promise<ArcModule> | null = null;
function loadArc(): Promise<ArcModule> {
  return (arcModulePromise ??= import('@storytree/arc'));
}

const isWorkStatus = (s: string): s is WorkStatus =>
  ['proposed', 'building', 'healthy', 'unhealthy', 'mapped', 'retired'].includes(s);

// Returns the view node (a missing/malformed spec file becomes an `error` node, never a throw).
function loadTreeCapability(
  loadNodeSpec: LoadNodeSpec,
  storyDir: string,
  capId: string,
): TreeCapability {
  const node: TreeCapability = {
    id: capId,
    title: capId,
    outcome: '',
    status: null,
    proofMode: '',
    dependsOn: [],
    testCount: 0,
  };
  const file = path.join(storyDir, `${capId}.md`);
  if (!existsSync(file)) return { ...node, error: 'spec file missing' };
  try {
    const spec = loadNodeSpec(file);
    return {
      ...node,
      title: spec.title,
      outcome: spec.outcome,
      status: isWorkStatus(spec.status) ? spec.status : null,
      proofMode: spec.proofMode,
      dependsOn: spec.dependsOn,
      // The declared leaf-contract count (the spec's `## Contracts` section, parsed via
      // `parseContracts` — already folded into `spec.contracts` by `loadNodeSpec`).
      testCount: spec.contracts.length,
    };
  } catch (err) {
    return { ...node, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function readTree(
  storiesDir: string,
): Promise<{
  payload: TreePayload;
  uatTestCriteriaByStory: Map<
    string,
    ({ criterionId: string; revisionId: string } | { id: string })[]
  >;
  uatCriteriaByStory: Map<string, { criterionId: string; revisionId: string }[]>;
  coverageByStory: Map<string, { id: string; covers?: readonly string[] }[]>;
}> {
  const stories: TreeStory[] = [];
  // The per-story OWN-PROOF obligations — the UNION of the WITNESSABLE per-test UAT test criteria (ADR-0082;
  // would-be legs filtered out per ADR-0097) AND the `## Reliability Gates` (ADR-0085, the brownfield
  // obligation set) — collected as the specs load so the /api/tree handler can roll each story's
  // per-obligation verdicts up into its crown without re-reading every spec. Keyed by `{ id }` only.
  const uatTestCriteriaByStory = new Map<
    string,
    ({ criterionId: string; revisionId: string } | { id: string })[]
  >();
  // The story's WITNESSABLE UAT test criteria ALONE (forest-parcels inc-2 marker walk) — the SAME
  // would-be filter as above, but deliberately NOT unioned with `## Reliability Gates`: the crown's
  // green obligation set and the `TreeStory.uatCriteria` summary are different obligations (ADR-0085
  // gates are a brownfield adoption mechanism, not a UAT criterion). Feeds `applyUatCriteria`.
  const uatCriteriaByStory = new Map<string, { criterionId: string; revisionId: string }[]>();
  // ADR-0097: per-story capability COVERAGE — the reliability gates (with their `(covers:)` lists), so
  // a brownfield cap with no driven verdict greens via an adopted gate that declares it covered.
  const coverageByStory = new Map<string, { id: string; covers?: readonly string[] }[]>();
  if (!existsSync(storiesDir))
    return { payload: { stories }, uatTestCriteriaByStory, uatCriteriaByStory, coverageByStory };
  const { loadNodeSpec, effectiveUatWitness } = await loadOrchestrator();
  // ADR-0436: loaded lazily, past vite's config-load (`loadLibrary` above) — a top-level VALUE import
  // of `@storytree/library` breaks `vite build`'s config load (studio-vite-config-load-trap).
  const { activeReliabilityGates, crownObligations } = await loadLibrary();
  for (const ent of await fs.readdir(storiesDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(storiesDir, ent.name);
    const storyFile = path.join(dir, 'story.md');
    if (!existsSync(storyFile)) continue;
    const story: TreeStory = {
      id: ent.name,
      title: ent.name,
      outcome: '',
      status: null,
      proofMode: '',
      // The fail-closed witness default (ADR-0040) — holds even when the spec fails to load.
      uatWitness: 'human',
      dependsOn: [],
      consumedBy: [],
      decisions: [],
      capabilities: [],
    };
    try {
      const spec = loadNodeSpec(storyFile);
      story.title = spec.title;
      story.outcome = spec.outcome;
      story.status = isWorkStatus(spec.status) ? spec.status : null;
      story.proofMode = spec.proofMode;
      story.uatWitness = effectiveUatWitness(spec.uatWitness);
      story.dependsOn = spec.dependsOn;
      story.consumedBy = spec.consumedBy;
      // ADR-0037 §2 / ADR-0097 Layer 2: the story's deciding ADR numbers — the "Relevant ADRs" the
      // panel links to the Decisions-group Library docs (plumbed through; previously unwired).
      story.decisions = spec.decisions;
      // Studio render hint (ADR-0076): `render: building` ⇒ drawn as a de-connected building.
      story.building = spec.render === 'building';
      story.capabilities = spec.capabilities.map((capId) => {
        return loadTreeCapability(loadNodeSpec, dir, capId);
      });
      // ADR-0085 + ADR-0097 + ADR-0436 + ADR-0443 D2: the CROWN rolls up the SIGNABLE, witnessable UAT
      // criteria + the still-active reliability gates — all three obligation drops in `crownObligations`
      // (the library's one definition), so this server, the CLI tree and the desktop backend cannot
      // apply different sets. `witnessableUat` below is a DISPLAY list and keeps the would-be filter
      // ALONE: an unsignable leg stops being a crown obligation but stays a visible journey step, which
      // is the whole basis of ADR-0443's honesty ("the gap stays visible in each step's own text").
      const witnessableUat = spec.uatTestCriteria.filter((t) => !t.wouldBe);
      // ADR-0436: a gate RETIRED IN PLACE keeps its ordinal but leaves the obligation union — and
      // leaves the coverage set below with it, or a withdrawn gate would still green a capability.
      const liveGates = activeReliabilityGates(spec.reliabilityGates);
      const ownObligations = crownObligations(spec.uatTestCriteria, spec.reliabilityGates);
      // ADR-0443 D2/D3: ALWAYS recorded, even when empty. Gating on a non-empty set here would skip
      // the crown for exactly the stories D2 unblocks — the ones whose every obligation is unsignable
      // — and leave them grey forever, which is the defect rather than the fix.
      uatTestCriteriaByStory.set(ent.name, ownObligations);
      // forest-parcels inc-2: the story's UAT test criteria ALONE (never the reliability gates) — the
      // marker walk summary membership. Set even when empty-of-gates, mirroring `ownObligations` above.
      if (witnessableUat.length > 0) {
        uatCriteriaByStory.set(
          ent.name,
          witnessableUat.map((t) => ({
            criterionId: t.criterionId,
            revisionId: t.revisionId,
          })),
        );
      }
      // The reliability gates double as per-cap coverage (ADR-0097): id + the caps each `(covers:)`.
      if (liveGates.length > 0) {
        coverageByStory.set(
          ent.name,
          liveGates.map((g) => ({ id: g.id, covers: g.covers })),
        );
      }
    } catch (err) {
      story.error = err instanceof Error ? err.message : String(err);
    }
    stories.push(story);
  }
  return { payload: { stories }, uatTestCriteriaByStory, uatCriteriaByStory, coverageByStory };
}

/**
 * The four-part tree read the `/api/tree` handler consumes, named once because TWO functions now
 * produce it — {@link readTree} off disk and {@link foldedToTreeWalk} off the live projection
 * (ADR-0445 D1). An anonymous shape repeated at both would let the two drift apart silently.
 */
interface TreeWalk {
  payload: TreePayload;
  uatTestCriteriaByStory: Map<
    string,
    ({ criterionId: string; revisionId: string } | { id: string })[]
  >;
  uatCriteriaByStory: Map<string, { criterionId: string; revisionId: string }[]>;
  coverageByStory: Map<string, { id: string; covers?: readonly string[] }[]>;
}

/**
 * Adapt the live fold (ADR-0445 D1) into exactly what {@link readTree} returns.
 *
 * The two differ in one way that matters at this boundary and in no other: the fold's nodes are
 * `readonly`, and the `/api/tree` handler MUTATES its payload in place as it enriches each story with
 * verdicts, builds and claims. So the arrays and nodes are rebuilt as mutable here rather than cast —
 * a cast would compile and then throw at the first enrichment write in a frozen-object runtime, and
 * discarding type evidence that wide is what the house standard refuses.
 *
 * The FIELDS are a straight copy: agreement between the two readers is proven by
 * `hierarchyLiveRead.test.ts`, which drives one tree through both and compares field for field. If a
 * field is ever added to `TreeStory`, that test is what fails — not this function, which would
 * quietly carry a default.
 */
function foldedToTreeWalk(folded: FoldedWorkHierarchy): TreeWalk {
  const stories: TreeStory[] = folded.stories.map((s) => {
    const story: TreeStory = {
      id: s.id,
      title: s.title,
      outcome: s.outcome,
      // The projection validates through the library's `Status` enum, so this narrows rather than
      // sanitises — but it is the SAME guard the disk path applies, and keeping the two identical is
      // what stops one reader accepting a status the other would drop.
      status: s.status !== null && isWorkStatus(s.status) ? s.status : null,
      proofMode: s.proofMode,
      uatWitness: s.uatWitness,
      dependsOn: [...s.dependsOn],
      consumedBy: [...s.consumedBy],
      decisions: [...s.decisions],
      building: s.building,
      capabilities: s.capabilities.map((c) => {
        const cap: TreeCapability = {
          id: c.id,
          title: c.title,
          outcome: c.outcome,
          status: c.status !== null && isWorkStatus(c.status) ? c.status : null,
          proofMode: c.proofMode,
          dependsOn: [...c.dependsOn],
          testCount: c.testCount,
        };
        if (c.error !== undefined) cap.error = c.error;
        return cap;
      }),
    };
    if (s.error !== undefined) story.error = s.error;
    return story;
  });
  return {
    payload: { stories },
    uatTestCriteriaByStory: new Map(
      [...folded.uatTestCriteriaByStory].map(([id, obligations]) => [id, [...obligations]]),
    ),
    uatCriteriaByStory: new Map(
      [...folded.uatCriteriaByStory].map(([id, criteria]) => [id, [...criteria]]),
    ),
    coverageByStory: new Map(
      [...folded.coverageByStory].map(([id, gates]) => [id, [...gates]]),
    ),
  };
}

/**
 * Apply the story-green crown roll-up (ADR-0083 Fork A, refining ADR-0082, narrowed by ADR-0443) to
 * the tree payload. A story's crown is set from `rollupStoryGreen` — both necessary clauses over the
 * non-vacuity floor: (a) every UNDERTAKEN capability is proven `healthy`, (b) every signable
 * own-proof obligation is signed, and (c) at least one of them was actually discharged.
 * Capabilities-green is a NECESSARY condition (the capabilities-green dependency rule), so the crown
 * is NEVER its own unit-id verdict and NEVER a green while any undertaken capability is red/unproven:
 * healthy ⇒ a pass crown, unhealthy ⇒ a fail crown (a red plant or an obligation regression),
 * unproven ⇒ NO verdict (the crown under-claims to `mapped`, never a stale green). A story with zero
 * undertaken capabilities satisfies the capability clause vacuously.
 *
 * ADR-0443 D2 changed WHICH stories are reached: a story with no obligations left is no longer
 * skipped, because "every obligation this story declares is unsignable" is precisely the state D2
 * unblocks — skipping it would leave the 9 stories the decision names grey forever. Only a story with
 * NOTHING to read (no obligations and no capabilities) is passed over, so a legacy story's own-unit
 * verdict is left standing rather than deleted.
 *
 * `rollup` is injected so this stays unit-testable without the lazy orchestrator. Mutates `stories`
 * in place.
 */
export function applyUatCrowns(
  stories: TreeStory[],
  uatTestCriteriaByStory: ReadonlyMap<
    string,
    readonly ({ criterionId: string; revisionId: string } | { id: string })[]
  >,
  coverageByStory: ReadonlyMap<string, readonly { id: string; covers?: readonly string[] }[]>,
  events: ReadonlyArray<{ kind: string; seq: number; doc: unknown }>,
  resolve: (input: {
    storyId: string;
    declaration: {
      capabilities: readonly { id: string; status?: WorkStatus | undefined }[];
      obligations: readonly ({ criterionId: string; revisionId: string } | { id: string })[];
    };
    events: ReadonlyArray<{ kind: string; seq: number; doc: unknown }>;
    coverage?: readonly { id: string; covers?: readonly string[] }[];
    unresolvedHealthIssue?: boolean;
  }) => { status: string | null },
): void {
  for (const story of stories) {
    const tests = uatTestCriteriaByStory.get(story.id) ?? [];
    const capabilityIds = story.capabilities.map((c) => c.id);
    // ADR-0443 D1: the clause reads each capability's AUTHORED status beside its id. `status` is
    // still the authored value at this point in the pipeline — proof is folded into the hue
    // client-side by `provenStatus`, and `applyCapCoverage` only ever sets `verdict`, never `status`.
    const capabilities = story.capabilities.map((c) => ({
      id: c.id,
      status: c.status ?? undefined,
    }));
    // ADR-0097: a brownfield cap with no driven verdict greens via an adopted gate that `(covers:)` it.
    const coverage = coverageByStory.get(story.id) ?? [];
    const rolled = resolve({
      storyId: story.id,
      declaration: { capabilities, obligations: tests },
      events,
      coverage,
      unresolvedHealthIssue: story.error !== undefined,
    }).status;
    if (rolled === 'healthy' || rolled === 'unhealthy') {
      // The crown's timestamp spans BOTH clauses — a cap-driven wither shows the capability's verdict
      // time, not just the UAT's (the union of the per-test ids and the capability ids).
      const at = latestVerdictAt(
        events,
        new Set([
          ...tests.map((t) => ('criterionId' in t ? t.criterionId : t.id)),
          ...capabilityIds,
          story.id,
        ]),
      );
      story.verdict = { outcome: rolled === 'healthy' ? 'pass' : 'fail', at: at ?? '' };
    } else {
      // unproven: drop any own-unit verdict so the world never paints a crown the proof doesn't
      // support (provenStatus then under-claims an authored `healthy` to `mapped`).
      delete story.verdict;
    }
  }
}

/**
 * Populate each story's {@link TreeStory.uatCriteria} — the marker walk summary (forest-parcels
 * inc-2): one entry per WITNESSABLE UAT test criterion (`uatCriteriaByStory`, would-be legs already
 * filtered out, `## Reliability Gates` deliberately NOT included — see the map's construction comment
 * in {@link readTree}). Each entry's `state` is derived from the SAME per-test SIGNED-verdict source
 * `applyUatCrowns` and the attestations route's `provenOf` use (`rollupStatus`): a signed pass ⇒
 * `'proven'`, a signed fail ⇒ `'failing'`, no signed verdict OR the live store can't answer (`events ===
 * null`, the json backend / a down DB) ⇒ `'pending'` — silently, never throws, never fabricates a state
 * the proof doesn't back. `rollup` is injected (the real `rollupStatus`) so this stays unit-testable
 * without the lazy orchestrator; omit it (or pass `events: null`) to exercise the advisory-absent path.
 * ALWAYS sets `uatCriteria` for every story reached here — `[]` for a story with no witnessable UAT test
 * criteria — so the field is never silently missing on the wire. Mutates `stories` in place.
 */
export function applyUatCriteria(
  stories: TreeStory[],
  uatCriteriaByStory: ReadonlyMap<
    string,
    readonly { criterionId: string; revisionId: string }[]
  >,
  events: ReadonlyArray<{ kind: string; seq: number; doc: unknown }> | null,
  rollup?: (
    criterion: { criterionId: string; revisionId: string },
    events: ReadonlyArray<{ kind: string; seq: number; doc: unknown }>,
  ) => string | null,
): void {
  for (const story of stories) {
    const tests = uatCriteriaByStory.get(story.id) ?? [];
    story.uatCriteria = tests.map((t): UatCriterionSummary => {
      const status = events && rollup ? rollup(t, events) : null;
      const state: UatCriterionSummary['state'] =
        status === 'healthy' ? 'proven' : status === 'unhealthy' ? 'failing' : 'pending';
      return { id: t.criterionId, state };
    });
  }
}

/**
 * Apply ADR-0097 per-capability COVERAGE to the tree payload (owner decision 2026-06-25, Option A): a
 * brownfield capability with no own driven verdict renders the SAME green as an own-driven cap when a
 * healthy reliability gate `(covers:)` it — so the world's plants tell the same story as the crown
 * ({@link applyUatCrowns}), never a green crown floating over brown plants (ADR-0097 §5: *"a brownfield
 * capability greens via the adopted gate that covers it."*). It synthesizes the covered cap's `verdict`
 * — a `pass` stamped with the covering gate's verdict time — so the SHARED `provenStatus` fold paints
 * the hue: coverage greens through a SIGNED verdict (the gate's), never authored `status:` paint, so
 * ADR-0040's anti-hand-painting wall holds. The cap fold is the orchestrator's `rollupCapStatus`, the
 * SAME compute `rollupStoryGreen`'s capability clause uses, so crown and plant can never diverge.
 *
 * Conservative + additive: it NEVER touches a cap that already carries its own signed verdict —
 * coverage only SUPPLIES green to an otherwise-unproven brownfield cap, never overrides a cap's own
 * proof or its own signed regression (a red plant stays red). `capRollup` is injected so this stays
 * unit-testable without the lazy orchestrator. Mutates `stories` in place.
 */
export function applyCapCoverage(
  stories: TreeStory[],
  coverageByStory: ReadonlyMap<string, readonly { id: string; covers?: readonly string[] }[]>,
  events: ReadonlyArray<{ kind: string; seq: number; doc: unknown }>,
  capRollup: (
    capId: string,
    events: ReadonlyArray<{ kind: string; seq: number; doc: unknown }>,
    coverage?: readonly { id: string; covers?: readonly string[] }[],
  ) => string | null,
): void {
  for (const story of stories) {
    const coverage = coverageByStory.get(story.id);
    if (!coverage || coverage.length === 0) continue;
    for (const cap of story.capabilities) {
      // A cap with its OWN signed verdict already wears the right hue (incl. a regression) — leave it.
      if (cap.verdict) continue;
      if (capRollup(cap.id, events, coverage) === 'healthy') {
        const at = latestVerdictAt(events, coveringGateIds(coverage, cap.id));
        cap.verdict = { outcome: 'pass', at: at ?? '' };
      }
    }
  }
}


/** The ids of the gates that `(covers:)` a capability — the covered cap's synthetic verdict draws its `at` from these. */
function coveringGateIds(
  coverage: readonly { id: string; covers?: readonly string[] }[],
  capId: string,
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const gate of coverage) {
    if (gate.covers?.includes(capId)) ids.add(gate.id);
  }
  return ids;
}

/** The latest `at` among the verdict events for a story's per-test ids (ISO strings sort lexically). */
function latestVerdictAt(
  events: ReadonlyArray<{ doc: unknown }>,
  testIds: ReadonlySet<string>,
): string | undefined {
  let latest: string | undefined;
  for (const e of events) {
    const doc = e.doc as { unitId?: unknown; at?: unknown } | null;
    if (
      doc !== null &&
      typeof doc.unitId === 'string' &&
      testIds.has(doc.unitId) &&
      typeof doc.at === 'string' &&
      (latest === undefined || doc.at > latest)
    ) {
      latest = doc.at;
    }
  }
  return latest;
}

/** Everything GET /api/health needs, injectable so the integration test can stub each leg. */
/** The GET /api/health response body: the store id, the probe fields, the code stamp and the serving pid. */
interface HealthResponse extends HealthProbe {
  store: StudioStore;
  code?: CodeStamp;
  pid: number;
}

export interface HealthDeps {
  store: StudioStore;
  /** backend.health() — contractually non-throwing ({db:'n/a'} for json). */
  health: () => Promise<HealthProbe>;
  /** The code-stamp probe (codeStamp.ts) — contractually non-throwing, null = no stamp. */
  codeStamp: () => Promise<CodeStamp | null>;
}

/**
 * GET /api/health — must NEVER 500: it is what the UI leans on when the DB is down. Beyond
 * the store probe (+ the pg schema-skew pair) it carries the code stamp: server-start HEAD
 * vs the checkout's HEAD now, so the UI can say "the checkout moved under this server —
 * restart it" instead of letting new endpoints 404 silently (the /api/presence incident).
 * The stamp is omitted (not an error) when git can't answer; a probe rejection is belt-and-
 * braces flattened to the same absence. Exported for the integration test (the dbControl.ts
 * pattern).
 *
 * It also stamps `pid` — the OS process id of the process answering. Without it a readiness
 * probe can only observe "something on this port is healthy" and is read as "MY server is
 * healthy"; the two diverge exactly when a sibling session already holds the port, which is
 * the normal state of this shared dev box (measured 2026-08-02: a 200 + the right 45-story
 * /api/tree shape from a FOREIGN server while this session's own listen() had died on
 * EADDRINUSE). `scripts/studio.mjs` compares this against the pid it spawned, so a port
 * collision is reported instead of silently measured. TWO LIMITS, by construction:
 *   - A pid identifies a process on THIS machine, so the comparison is meaningful only for a
 *     LOCALHOST launcher. The field is emitted unconditionally (one code path, no environment
 *     guess that could fail OPEN on the very check it feeds) but the hosted Cloud Run response
 *     carries a pid nobody can compare — nothing reads it there, and nothing should.
 *   - It identifies a foreign LISTENER, never a foreign BUILD: the same session restarting a
 *     stale build under its own pid still measures the wrong code. That is `code`'s job above.
 */
export async function handleHealth(
  req: IncomingMessage,
  res: ServerResponse,
  deps: HealthDeps,
): Promise<void> {
  if ((req.method ?? 'GET') !== 'GET') throw new HttpError(405, 'method not allowed');
  const [health, code] = await Promise.all([
    deps.health(),
    deps.codeStamp().catch(() => null),
  ]);
  // `pid` after the spread so a future HealthProbe field can never shadow the identity stamp; the
  // guarded `code` assignment lands after it too, so a probe field can never shadow the stamp either.
  const payload: HealthResponse = { store: deps.store, ...health, pid: process.pid };
  if (code) payload.code = code;
  sendJson(res, 200, payload);
}

/**
 * GET /api/activity — the map-activity layer (ADR-0048 builds + ADR-0138 story claims + ADR-0200 D7
 * claim DEPARTURES), polled cheaply by the world without re-walking stories/. All three reads are
 * contractually non-throwing: a down DB / json backend answers 200 `{builds: null, claims: null,
 * departures: null}` (advisory absence, never a 503), so the only error path is the 405 method guard.
 * A claim carries `kind: "claim"` (the §5 honesty wall) so the renderer paints it VISIBLY DISTINCT
 * from a proven-green bloom — a claim is never a proof — plus its GRADE (geometry from grade, colour
 * from intent, ADR-0200 D2/D7). `departures` is the wisp-out legibility wire (ADR-0200 D7, unparking
 * friction-released-build-wisp-reads-as-lost-claim): a claim released inside the window renders as a
 * departure instead of vanishing indistinguishably from a lost claim. `inFlightClaims` and
 * `inFlightDepartures` are OPTIONAL (a narrow mock may omit either → `null`). Exported for the
 * integration test (the handleClaims pattern).
 */
export async function handleActivity(
  req: IncomingMessage,
  res: ServerResponse,
  backend: Pick<LibraryBackend, 'inFlightBuilds' | 'inFlightClaims' | 'inFlightDepartures'>,
): Promise<void> {
  if ((req.method ?? 'GET') !== 'GET') throw new HttpError(405, 'method not allowed');
  // Builds, claims and departures ride the SAME wire; run in parallel so a down DB costs one
  // timeout budget.
  const [builds, claims, departures] = await Promise.all([
    backend.inFlightBuilds(),
    backend.inFlightClaims?.() ?? Promise.resolve(null),
    backend.inFlightDepartures?.() ?? Promise.resolve(null),
  ]);
  sendJson(res, 200, { builds, claims, departures });
}

/**
 * GET /api/claims — the claim-ledger DOCK view (ADR-0200 D7): every live claim row folded by
 * session through the pure `groupClaimsBySession` (packages/notice-board/src/claim.ts — the ONE
 * grouping every ledger view, board and dock alike, shares) so the studio session dock can render
 * "who's doing what, grouped by session" instead of raw claim rows. `sessionClaims()` is
 * contractually non-throwing like `latestVerdicts()`: a down DB / json backend answers 200
 * `{sessions: null}` (advisory absence, never a 503) — the only error path is the 405 method
 * guard. Sibling to /api/activity, but its OWN endpoint (not folded onto /api/activity's wire)
 * since the dock fetches it only while open, not on the world's poll cadence. Exported for the
 * integration test (the handleActivity pattern).
 */
/**
 * `GET /api/arcs` → `{ arcs: ArcRollupSummary[] }` · `GET /api/arcs/<id>` → one full `ArcRollup`.
 *
 * The studio's arc read (ADR-0267). Every value here comes from `deriveArcRollup` in
 * `@storytree/arc` — the SAME join `storytree arc show` renders — so the map surface and the CLI
 * can never disagree about what an arc contains. This handler adds routing, the method check, and
 * the honest store-absent answer; it derives nothing of its own.
 *
 * THE LIST AND THE ONE-ARC READ SERVE DIFFERENT WIDTHS OF THE SAME JOIN, and that is the decision.
 * The list carries only what the lane strip draws (`loadArcRollupSummaries` — see
 * `ArcRollupSummary` in @storytree/arc for the measurement); the per-id read carries the WHOLE
 * rollup, because the briefing panel renders an arc's `intent`, its questions' `stakes` and every
 * increment's outcome prose, and it renders them for exactly one arc at a time. Shipping that prose
 * 76 times on a 30 s poll to draw green and grey bars was 1,364,425 bytes; the lane rows are
 * 226,836, and one arc's whole rollup is 5-90 KB.
 *
 * The narrowing is a PROJECTION of the rollup, not a second join — it happens in @storytree/arc, so
 * the desktop mirror reaches the same one and the two payloads cannot fork.
 *
 * Read-only by decision, not by omission: ADR-0267 D6 ships no write path this round ("no in-surface
 * answering of questions, no comment affordance, no edit"), so a non-GET is refused rather than
 * quietly ignored. Two-way is a named, deferred follow-on.
 *
 * Arcs and plans are LIVE-canonical (ADR-0023 / ADR-0183 D2), so a backend with no document store —
 * the offline json one — genuinely has no arcs to serve. That returns `arcs: null` rather than an
 * empty list, because "the store isn't here" and "there are no arcs" are different facts and a
 * surface built to restore context must not blur them into a confident empty state.
 */
export async function handleArcs(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: { paths: Paths; backend: Pick<LibraryBackend, 'docStore'> },
): Promise<void> {
  if ((req.method ?? 'GET') !== 'GET') {
    throw new HttpError(405, 'method not allowed — the arc surface is read-only this round (ADR-0267 D6)');
  }
  const store = await (ctx.backend.docStore?.() ?? Promise.resolve(null));
  const rest = url.pathname.slice('/api/arcs'.length).replace(/^\//, '');
  const id = rest === '' ? null : decodeURIComponent(rest);
  if (store === null) {
    if (id !== null) throw new HttpError(503, 'the arc view needs the live store — arcs are live-canonical (ADR-0183)');
    sendJson(res, 200, { arcs: null });
    return;
  }
  const { loadArcRollup, loadArcRollupSummaries } = await loadArc();
  const deps = {
    store,
    storiesDir: ctx.paths.storiesDir,
  };
  if (id === null) {
    sendJson(res, 200, { arcs: await loadArcRollupSummaries(deps) });
    return;
  }
  const rollup = await loadArcRollup(deps, id);
  if (rollup === null) throw new HttpError(404, `no arc "${id}"`);
  sendJson(res, 200, rollup);
}

/**
 * `GET /api/floor-health` → `{ reading: FloorHealthReading | null }`.
 *
 * The factory-floor health reading behind ADR-0314 D7's strip — the instrument ADR-0316 D1–D4 built
 * on `factory-floor-health-arc`, whose D5 names that strip its first committed CONSUMER. Composed
 * exactly the way `/api/arcs` is: every figure comes from `loadFloorHealthReading` in
 * `@storytree/drive` — the SAME composition `storytree factory health` prints under "THE READING" —
 * so the map and the CLI can never disagree about the floor. This handler adds routing, the method
 * check and the honest store-absent answer; it computes nothing of its own.
 *
 * IT SETS NO THRESHOLD, deliberately. ADR-0316 D4 keeps the instrument to MEASURING, so what crosses
 * this wire is the figure and its provenance; the band that reads it decides loud from quiet
 * (`LOUD_AT_RECURRENCES` in apps/studio/src/components/FloorHealthLamp.tsx). A server that decided
 * loudness would put the one undecided call in the one place a reader cannot see it.
 *
 * `reading: null` is the offline json backend, which holds no friction tier to read — the same
 * advisory contract `/api/arcs` uses, and a DIFFERENT fact from a quiet floor. The strip renders the
 * two differently, because a missing instrument presented as "all clear" is the failure mode this
 * whole band exists to avoid.
 *
 * Read-only like the rest of this round (ADR-0267 D6 / ADR-0314 D9); report-only by ADR-0316 D1 —
 * nothing here routes, discharges or adjudicates anything.
 */
export async function handleFloorHealth(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: { backend: Pick<LibraryBackend, 'docStore'> },
): Promise<void> {
  if ((req.method ?? 'GET') !== 'GET') {
    throw new HttpError(405, 'method not allowed — the floor-health band reports, it does not adjudicate (ADR-0316 D4)');
  }
  const store = await (ctx.backend.docStore?.() ?? Promise.resolve(null));
  if (store === null) {
    sendJson(res, 200, { reading: null });
    return;
  }
  const { loadFloorHealthReading } = await loadDrive();
  sendJson(res, 200, { reading: await loadFloorHealthReading(store) });
}

export async function handleClaims(
  req: IncomingMessage,
  res: ServerResponse,
  backend: Pick<LibraryBackend, 'sessionClaims'>,
): Promise<void> {
  if ((req.method ?? 'GET') !== 'GET') throw new HttpError(405, 'method not allowed');
  const claims = await (backend.sessionClaims?.() ?? Promise.resolve(null));
  if (claims === null) {
    sendJson(res, 200, { sessions: null });
    return;
  }
  const { groupClaimsBySession } = await loadNoticeBoard();
  sendJson(res, 200, { sessions: groupClaimsBySession(claims, new Date()) });
}



async function handleDocs(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  paths: Paths,
): Promise<void> {
  if (url.pathname === '/api/docs') {
    // map-server-memo (ADR-0240 stage 3): the walk is memoized by the docs corpus's on-disk
    // fingerprint; the sender adds the no-cache/ETag validator pair over the actual response bytes.
    const { value } = await memoizeCorpusWalk(paths.docsDir, () => listDocs(paths.docsDir));
    return sendJsonValidated(req, res, 200, value);
  }
  if (url.pathname === '/api/docs/content') {
    const id = url.searchParams.get('id') ?? '';
    const file = safeDocPath(paths.docsDir, id);
    if (!file || !existsSync(file)) throw new HttpError(404, 'doc not found');
    const markdown = stripFrontmatter(await fs.readFile(file, 'utf8'));
    return sendJson(res, 200, { id, title: deriveTitle(markdown, path.basename(file)), markdown });
  }
  throw new HttpError(404, 'not found');
}

// ---------- write-broker (ADR-0117 — a builder's brokered write into the shared forest) ----------
//
// POST /api/write-broker persists a builder's LOCALLY-SIGNED verdict through the store seam
// (writeBroker.ts) — the precondition for the operator-attested "invite a builder → their local
// build blooms via the broker" walk (ADR-0070). The handler holds no signing key and NEVER re-signs
// (ADR-0091/ADR-0117 d.3): it validates shape + attribution (signer ≡ caller), then persists the
// verdict UNCHANGED — the spine's signature/anchor survive byte-for-byte (PgWorkStore writes
// `doc: verdict` as-is; the `actor` is a separate audit field, never the verdict's signer).
// The brokered PRESENCE write type is RETIRED (ADR-0200 D7 — the claim ledger is the one
// coordination machinery); the handler refuses it as an unknown discriminator. The LibraryBackend
// verdict write is OPTIONAL (the json backend has none), so this adapter refuses with 503 when the
// live store isn't behind the backend, mirroring handleUatAttest.

/**
 * Adapt the studio's {@link LibraryBackend} to the handler's required {@link WriteBrokerBackend} seam:
 * delegate to the backend's optional verdict write, refusing with 503 when it is absent
 * (the json backend has no events.verdict). The 503 fires only AFTER the handler's
 * authorization + shape + attribution walls pass, so a refused/forged write never reaches here.
 */
function writeBrokerBackend(backend: LibraryBackend): WriteBrokerBackend {
  return {
    async signUatVerdict(verdict, actor) {
      if (!backend.signUatVerdict) {
        throw new HttpError(503, 'persisting a brokered verdict needs the live store (pg) — bring the DB up (pnpm db:up)');
      }
      return backend.signUatVerdict(verdict, actor);
    },
  };
}

// ---------- suggestion decision (ADR-0140 — accept/reject through the store's atomic transition) ----------
//
// POST /api/suggestions/decision runs cap 3's handleSuggestionDecision over the live suggestion
// store. The gate (member-suggest-write-policy) already refused every non-admin caller, so the
// handler assumes an authorized decider. Like writeBrokerBackend, the LibraryBackend suggestion
// seam is OPTIONAL (json backend has no events.suggestion), so this adapter refuses with 503 when
// the live store isn't behind the backend.

/** The suggestion record as cap 3's seam reads it (its local SuggestionRecord, via the seam's types). */
type FetchedSuggestion = NonNullable<Awaited<ReturnType<SuggestionDecisionBackend['getSuggestion']>>>;

/**
 * Adapt the studio's {@link LibraryBackend} to cap 3's {@link SuggestionDecisionBackend} seam.
 *
 * Seam impedance, made explicit: the handler transitions the record ITSELF and hands the closed
 * result to `saveSuggestion`, while the store's one write path is the atomic
 * `transitionSuggestion` (event append + projection upsert, re-checking open-ness). So save maps
 * the already-transitioned record BACK onto the store transition — deriving the action from the
 * record's status — and a lost race (someone else decided between the handler's read and this
 * write) surfaces as the store's closed-suggestion error, mapped to 409 like the handler's own.
 *
 * ACCEPT IS WIRED for `asset` topics (ADR-0140 caps 7/8 — the block model landed in
 * ../src/lib/blocks): `applyToAsset` reads the CURRENT asset, locates the target block by its
 * content-hash handle, verifies the recorded `original` still matches (the drift witness), and
 * persists the spliced body through the SAME admin asset-write path the editor uses
 * (`backend.updateAsset`, every other field preserved). A failed locate/verify throws 409 —
 * BEFORE the status transition persists (cap 3's handler applies before it saves), so a
 * suggestion is never marked accepted without its content applied and stays open for a re-try
 * against the current text. Two honesty walls remain LOUD:
 *  - a `doc` suggestion refuses 501 — docs are files on disk, not writable through this backend;
 *  - a STRUCTURED asset (per-kind `fields` — the body is a DERIVED render, option C) refuses 409
 *    rather than splicing a render the next field-edit would clobber (or lossily collapsing the
 *    structure into a body, which the admin editor never does).
 * Reject — which never touches the doc — is unchanged.
 *
 * The seam's `applyToAsset(topicId, proposed, block)` doesn't carry the record's `original` /
 * `topicKind`, so this per-request adapter remembers the record its own `getSuggestion` answered
 * (the handler always reads before it applies) and takes the drift witness from there.
 */
function suggestionDecisionBackend(backend: LibraryBackend): SuggestionDecisionBackend {
  const needsPg = (): HttpError =>
    new HttpError(503, 'deciding a suggestion needs the live store (pg) — bring the DB up (pnpm db:up)');
  let fetched: FetchedSuggestion | null = null;
  return {
    async getSuggestion(id) {
      if (!backend.getSuggestion) throw needsPg();
      fetched = await backend.getSuggestion(id);
      return fetched;
    },
    async saveSuggestion(s) {
      if (!backend.transitionSuggestion) throw needsPg();
      if (s.status === 'open') {
        throw new Error('saveSuggestion called with an open suggestion — the handler transitions before saving');
      }
      const action = s.status === 'accepted' ? 'accept' : 'reject';
      let updated;
      try {
        updated = await backend.transitionSuggestion(
          s.id,
          action,
          s.decidedBy ?? 'unknown',
          s.decidedAt ?? new Date().toISOString(),
        );
      } catch (err) {
        // The store's closed-suggestion guard fired: someone decided between the handler's read and
        // this write. The same wall the handler maps for its own transition — answer 409, not 500.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Cannot decide a closed suggestion')) throw new HttpError(409, msg);
        throw err;
      }
      if (!updated) throw new HttpError(404, `suggestion "${s.id}" not found`);
      return updated;
    },
    async applyToAsset(topicId, proposed, block) {
      // The record this request's getSuggestion answered — the handler's order (read → apply →
      // save) guarantees it; the guard is defence in depth against a re-ordered caller.
      const s = fetched;
      if (!s || s.topicId !== topicId || s.block !== block) {
        throw new HttpError(
          500,
          'applyToAsset called without the suggestion being read first — the decision handler reads before it applies',
        );
      }
      if (s.topicKind === 'doc') {
        // The narrowed honesty wall: docs are FILES on disk (served read-only from <repo>/docs),
        // not writable through this backend — accepting one stays a LOUD 501, before any transition
        // persists (never accepted-without-applied).
        throw new HttpError(
          501,
          'accepting a doc suggestion is not wired — docs are files on disk (read-only through this ' +
            'backend); the suggestion stays open, and no suggestion is ever marked accepted without ' +
            'its content applied',
        );
      }
      const asset = (await backend.listAssets()).find((a) => a.id === topicId);
      if (!asset) {
        throw new HttpError(404, `asset "${topicId}" not found — cannot apply the suggestion; it stays open`);
      }
      if (asset.fields && Object.keys(asset.fields).length > 0) {
        // A structured unit's body is a DERIVED render of its per-kind fields (option C) — a body
        // splice cannot honestly represent the edit (persisting it would either be clobbered by the
        // next field edit or lossily collapse the structure). Refuse; the suggestion stays open.
        throw new HttpError(
          409,
          `cannot apply — "${topicId}" is a structured unit whose body is a derived render of its ` +
            'fields; edit the fields in the asset editor instead. The suggestion stays open.',
        );
      }
      const result = applySuggestionToBody(asset.body, {
        blockId: block,
        original: s.original,
        proposed,
      });
      if (!result.ok) {
        throw new HttpError(
          409,
          result.reason === 'block-not-found'
            ? `cannot apply — block "${block}" no longer exists in "${topicId}" (block-not-found); ` +
              'the suggestion stays open and nothing was changed'
            : `cannot apply — the block's current text has drifted from the suggestion's recorded ` +
              `original (original-drifted); the suggestion stays open and nothing was changed`,
        );
      }
      // Persist through the SAME admin asset-write path the editor uses — every field except the
      // body preserved from the current asset (updateAsset re-validates at the store's boundary).
      const patch: AssetInput = {
        id: asset.id,
        category: asset.category,
        title: asset.title,
        description: asset.description,
        body: result.body,
      };
      if (asset.provenance) patch.provenance = asset.provenance;
      const updated = await backend.updateAsset(topicId, patch);
      if (!updated) {
        throw new HttpError(404, `asset "${topicId}" vanished mid-apply — the suggestion stays open`);
      }
    },
  };
}

// ---------- suggestion create (ADR-0140 caps 7/8 — the member proposal write) ----------
//
// POST /api/suggestions (exact path — the cap 4 gate opens exactly this to members) runs
// handleSuggestionCreate over the live suggestion store. The author is stamped from the verified
// caller inside the handler; this adapter only carries the persistence seam, refusing 503 when
// the backend has no suggestion store (json), like the decision route's needsPg.

/** Adapt the backend's optional suggestion-create to the create handler's seam (503 when absent). */
function suggestionCreateBackend(backend: LibraryBackend): SuggestionCreateBackend {
  return {
    async createSuggestion(s) {
      if (!backend.createSuggestion) {
        throw new HttpError(503, 'creating a suggestion needs the live store (pg) — bring the DB up (pnpm db:up)');
      }
      // The author IS the audit actor — a proposal is attributed.
      return backend.createSuggestion(s, s.author);
    },
  };
}

// ---------- review feed (ADR-0140 — one poll returns a topic's comments + suggestions) ----------
//
// GET /api/review/feed?topicId=<id> runs cap 5's handleReviewFeed over the backend's comment +
// suggestion reads, so the Review surface refreshes on the existing 30s visibility-gated poll.
// The feed is an ADVISORY read (the activeSessions / latestVerdicts discipline): each source
// degrades to an empty list — the suggestion seam is OPTIONAL (json backend omits it → null store
// → empty suggestions inside the handler), and a read failure (a down DB) is swallowed to an
// empty list here rather than bubbling to the central 503 — the Review surface shows no feed
// rather than erroring mid-poll.

/** Adapt the backend's comment read to the feed's seam, swallowing failures to empty (advisory). */
function reviewFeedCommentStore(backend: LibraryBackend): ReviewFeedCommentStore {
  return {
    async listComments(filter) {
      try {
        return await backend.listComments(filter);
      } catch {
        return []; // advisory: a down DB reads as an empty source, never a throw
      }
    },
  };
}

/** The feed's suggestion seam, or `null` when the backend has no suggestion read (json). */
function reviewFeedSuggestionStore(backend: LibraryBackend): ReviewFeedSuggestionStore | null {
  const list = backend.listSuggestions?.bind(backend);
  if (!list) return null;
  return {
    async list(filter) {
      try {
        return await list(filter);
      } catch {
        return []; // advisory: a down DB reads as an empty source, never a throw
      }
    },
  };
}

/**
 * The `/api/tree` refusal when the live store served the hierarchy but its proof could not be read.
 * The desktop's tree route answers the same words — the two surfaces are held to one another by the
 * `tree-fixtures` conformance arm that exercises this case.
 */
export const TREE_PROOF_UNREAD =
  'the live store served the work hierarchy but its signed verdicts could not be read — refusing to paint a map without its proof';

/** A proof read that did not answer: the verdict map, or the event stream on a backend that has one. */
function proofUnread(
  backend: Pick<LibraryBackend, 'verdictEvents'>,
  verdicts: unknown,
  verdictEvents: unknown,
): boolean {
  return verdicts === null || (backend.verdictEvents !== undefined && verdictEvents === null);
}

/**
 * THE forest map read — the studio's fold, in one callable place.
 *
 * Extracted from the `/api/tree` route so it has a SECOND consumer that is not an HTTP client:
 * the public website's forest snapshot exporter (`forestSnapshot.ts`, ADR-0453 D7). That decision
 * requires the published snapshot to be an EXPORT OF AN EXISTING READER'S OUTPUT rather than a new
 * computation over the store, because authored `status` is uniform in this corpus (every live story
 * reads `proposed`) and the green a reader sees is COMPUTED here from signed verdicts. A website
 * that folded the store itself would be a third reader, drifting from the studio and the CLI
 * invisibly — which has already happened once between the two readers that exist.
 *
 * The route is now a two-liner over this; nothing about the read moved or changed.
 */
export async function buildTreePayload(
  ctx: Pick<ApiContext, 'paths' | 'backend'>,
): Promise<TreePayload> {
  // map-server-memo (ADR-0240 stage 3): the FILE WALK alone is memoized by the stories corpus's
  // on-disk fingerprint. The live enrichment below (verdicts, in-flight builds, open questions)
  // is recomputed on EVERY request — nothing about the corpus on disk says whether a verdict was
  // signed a second ago, so a file fingerprint can never be its freshness authority. The clone
  // `memoizeCorpusWalk` hands back is mutated in place below; that mutation can never reach what
  // is stored, so a later unchanged-corpus request is never served yesterday's live proof state.
  // ADR-0445 D1: the QUESTION comes from the live store when it can answer, so it sits on the
  // same clock as the PROOF enriched in below. The disk walk stays as the announced fallback —
  // `selectHierarchy` cannot reach it without saying why, which is what keeps this from becoming
  // the silently-preferred stale copy ADR-0302 D1 deleted.
  const { foldWorkHierarchy } = await loadLibrary();
  const selection = await selectHierarchy({
    live: ctx.backend.workHierarchy?.bind(ctx.backend),
    fold: (snapshot) => foldedToTreeWalk(foldWorkHierarchy(snapshot)),
    disk: async () =>
      (await memoizeCorpusWalk(ctx.paths.storiesDir, () => readTree(ctx.paths.storiesDir)))
        .value,
  });
  announceHierarchyOrigin(selection);
  const { payload, uatTestCriteriaByStory, uatCriteriaByStory, coverageByStory } =
    selection.read;
  // Advisory enrichments (ADR-0048): no call ever throws — null
  // (json store / DB down) just means the tree renders without that layer.
  // Run in parallel so a down DB costs one 4s budget, not three. `builds`
  // seeds the in-flight wisp layer so the world paints it on first load
  // (the poll then keeps it fresh). `verdictEvents` feeds the per-test UAT
  // crown roll-up (ADR-0082); absent on a backend that doesn't implement it
  // (the json store / a partial mock). The `sessions` presence weave is
  // RETIRED (ADR-0200 D7) — claim activity rides /api/activity + /api/claims.
  //
  // The asset list was a FOURTH leg, read ONLY to feed the ADR-0107 open-question green-gate its
  // `references`. That gate is retired with the citation tier (ADR-0477 D1), so the read went with
  // it rather than being left fetching a list nothing folds.
  const readProof = () =>
    Promise.all([
      ctx.backend.latestVerdicts(),
      ctx.backend.verdictEvents?.() ?? Promise.resolve(null),
    ]);
  let [[verdicts, verdictEvents], builds] = await Promise.all([
    readProof(),
    ctx.backend.inFlightBuilds(),
  ]);
  // The advisory contract above is for a store that CANNOT answer. When the live store just served
  // the hierarchy, a null proof read is a failed read (a timeout, a dropped pooled connection), not
  // an absence — and every island would paint its authored status, which is how the whole map read
  // `proposed` on 2026-09-24. Re-read once; if the proof still cannot be read, refuse rather than
  // serve a proof-less map as current. The client keeps its last painted map, marked provisional
  // (ADR-0445 D3), or shows the error on a cold load.
  if (selection.origin === 'live' && proofUnread(ctx.backend, verdicts, verdictEvents)) {
    [verdicts, verdictEvents] = await readProof();
    if (proofUnread(ctx.backend, verdicts, verdictEvents)) {
      throw new HttpError(503, TREE_PROOF_UNREAD);
    }
  }
  if (verdicts) {
    for (const story of payload.stories) {
      const sv = verdicts[story.id];
      if (sv) story.verdict = sv; // a capability/legacy story's OWN unit verdict, never a roll-up
      for (const cap of story.capabilities) {
        const cv = verdicts[cap.id];
        if (cv) cap.verdict = cv;
      }
    }
  }
  // forest-parcels inc-2 (the marker walk): the story's WITNESSABLE UAT test criteria summary —
  // ALWAYS set (even with no verdict events / a down DB, when every entry reads 'pending'), so the
  // field is never silently missing on the wire. `rollupStatus` is the SAME per-test proof read
  // `applyUatCrowns` / the attestations route's `provenOf` use.
  const { rollupCriterionStatus } = await loadOrchestrator();
  applyUatCriteria(
    payload.stories,
    uatCriteriaByStory,
    verdictEvents,
    rollupCriterionStatus,
  );
  // ADR-0083 Fork A (refining ADR-0082): a story that declares per-test UAT test criteria greens from the
  // AND of (all capabilities proven healthy) AND (the per-test UAT roll-up) — overriding any
  // own-unit verdict set above. Skipped when the backend has no verdict events (json / down DB)
  // and otherwise resolves every story, including the pre-baseline empty case, through one fold.
  if (verdictEvents) {
    const { resolveStoryHealth, rollupCapStatus } = await loadOrchestrator();
    // ADR-0097 §5 / owner Option A (2026-06-25): a covered brownfield plant greens the same as the
    // crown counts it — run BEFORE the crown so the world's plants and crown agree. Independent of
    // per-test UAT existing (a cap greens via its gate's coverage alone).
    applyCapCoverage(payload.stories, coverageByStory, verdictEvents, rollupCapStatus);
    applyUatCrowns(payload.stories, uatTestCriteriaByStory, coverageByStory, verdictEvents, resolveStoryHealth);
  } else {
    const unhealthyStories = payload.stories.filter((story) => story.error !== undefined);
    if (unhealthyStories.length > 0) {
      const { resolveStoryHealth } = await loadOrchestrator();
      applyUatCrowns(unhealthyStories, uatTestCriteriaByStory, coverageByStory, [], resolveStoryHealth);
    }
  }
  if (builds && builds.length > 0) payload.builds = builds;
  return payload;
}
// ---------- the dispatch ----------

/** Everything one front (dev plugin / hosted server) wires into the route table. */
export interface ApiContext {
  paths: Paths;
  backend: LibraryBackend;
  store: StudioStore;
  codeStamp: () => Promise<CodeStamp | null>;
  /**
   * /api/db/* shells out to gcloud with the OPERATOR's ambient ADC — sound only
   * on the operator's own localhost dev server (dbControl.ts). The hosted server
   * sets false and the endpoints answer 403 (ADR-0042 d.3).
   */
  allowDbControl: boolean;
  /**
   * Hosted-native DB wake (studio-cloud `hosted-db-wake`, ADR-0049): the keyless Cloud SQL Admin
   * REST waker (dbWake.ts). Unlike `/api/db/*` (gcloud, operator's machine), this works IN the
   * container, so it is served regardless of `allowDbControl`. Absent (the dev plugin) → 404.
   */
  dbWake?: DbWaker | undefined;
  /** Hosted-mode policy (gate + comment scoping); absent = the open dev posture. */
  policy?: ApiPolicy | undefined;
  /** Invite-email sender for POST /api/users; absent = no email (the invite still writes its row). */
  invites?: InviteMailer | undefined;
}

/**
 * The one /api/* dispatch: routes, policy gate, and the central error mapping
 * (HttpError → its status; pg-connection failure → 503 with the Start-DB remedy;
 * anything else → 500). Never throws — every outcome is an HTTP answer.
 */
export async function handleApiRequest(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ApiContext,
): Promise<void> {
  try {
    ctx.policy?.gate(req.method ?? 'GET', url.pathname);
    if (url.pathname === '/api/me') {
      // The caller's membership/role (ADR-0043) — the one endpoint a non-member
      // may reach, so the SPA can render the request-access wall. Open dev posture (no
      // policy) reports full local access.
      if ((req.method ?? 'GET') !== 'GET') throw new HttpError(405, 'method not allowed');
      sendJson(res, 200, ctx.policy ? ctx.policy.me : DEV_ME);
    } else if (url.pathname === '/api/health') {
      await handleHealth(req, res, {
        store: ctx.store,
        health: () => ctx.backend.health(),
        codeStamp: ctx.codeStamp,
      });
    } else if (url.pathname === '/api/db/wake') {
      // Hosted-native wake (ADR-0049): keyless Cloud SQL Admin REST, so it works in the container
      // — served REGARDLESS of allowDbControl (the gcloud `/api/db/*` premise below doesn't hold
      // hosted). The policy gate already authorized it (seed admin in degraded mode / admin in
      // normal mode); absent waker (dev plugin) → 404 inside the handler.
      await handleDbWake(req, res, ctx.dbWake ?? null);
    } else if (url.pathname.startsWith('/api/db/')) {
      if (!ctx.allowDbControl) {
        throw new HttpError(403, 'db control is not served in hosted mode (ADR-0042)');
      }
      await handleDb(req, res, url);
    } else if (url.pathname.startsWith('/api/docs')) {
      await handleDocs(req, res, url, ctx.paths);
    } else if (url.pathname === '/api/tree') {
      if ((req.method ?? 'GET') !== 'GET') throw new HttpError(405, 'method not allowed');
      sendJsonValidated(req, res, 200, await buildTreePayload(ctx));
    } else if (url.pathname === '/api/activity') {
      await handleActivity(req, res, ctx.backend);
    } else if (url.pathname === '/api/arcs' || url.pathname.startsWith('/api/arcs/')) {
      await handleArcs(req, res, url, ctx);
    } else if (url.pathname === '/api/floor-health') {
      await handleFloorHealth(req, res, ctx);
    } else if (url.pathname === '/api/claims') {
      await handleClaims(req, res, ctx.backend);
    } else if (url.pathname === '/api/traversal' || url.pathname === '/api/traversal/sessions') {
      // `traversal-panel-arc`: one session's replayed context traversal, read from this machine's
      // LOCAL JSONL trace dir (ADR-0241). Member-readable by the gate's GET rule and read-only by
      // decision. Local by the owner's 2026-08-10 call — the hosted container holds no operator
      // traces, so hosted answers an honest empty list rather than inventing one. See traversalApi.ts.
      await handleTraversal(req, res, url, ctx.backend);
    } else if (url.pathname === '/api/context-windows') {
      // ADR-0452 D1/D2 as repointed by ADR-0456 D2 — ONE host window's occupancy series, read
      // straight from the ambient host transcripts rather than from ingested traces (only 2 of 697
      // local traces carry occupancy at all, so a trace-backed bar would be blank). It is what the
      // traversal replay panel's own occupancy bar plots at its playhead. `?session=<windowId>` is
      // REQUIRED: the machine-wide list mode retired with the standalone Context tab (ADR-0456 D1).
      // Member-readable by the gate's GET rule and read-only by decision. Local for the same reason
      // the traversal route is: the hosted container holds no operator transcripts, so it answers an
      // honest absence. See contextWindowsApi.ts.
      await handleContextWindows(req, res, url);
    } else if (url.pathname.startsWith(`${STORE_DOOR_BASE_PATH}/`)) {
      // ADR-0259 D1 — the store door: the raw `Store` seam over HTTPS, for a client that cannot open
      // a Cloud SQL connector. READ-ONLY (writes 403 by name — ADR-0259 D5's gate is not lifted), and
      // authorized by the policy gate above exactly like every other route: a GET is member-permitted,
      // an identity-less caller already 401'd. The `Store` implementation is the SAME PgLibraryStore
      // the CLI drives under `--pg`, so the door cannot drift from what a local session reads.
      await handleStoreDoor(req, res, url, ctx.backend);
    } else if (url.pathname === '/api/comments') {
      await handleComments(req, res, url, ctx.backend, ctx.policy?.commentScope ?? null);
    } else if (url.pathname === '/api/assets') {
      await handleAssets(req, res, url, ctx.backend);
    } else if (url.pathname === '/api/users') {
      // Admin-gated by the policy; the caller (invitedBy + audit actor) is the verified identity.
      // The invite mailer (when configured) emails the invitee on POST — see handleUsers.
      await handleUsers(req, res, url, ctx.backend, ctx.policy?.me.email ?? null, ctx.invites ?? null);
    } else if (url.pathname === '/api/attestations') {
      // GET is member-readable; POST is admin-only by the gate's method rule. The signer is the
      // verified caller (stamped, can't be forged); the open dev posture has no caller (null).
      await handleAttestations(req, res, url, ctx, ctx.policy?.me.email ?? null);
    } else if (url.pathname === '/api/uat/attest') {
      // The studio "I saw it work" in-UI signature (ADR-0082): mints a REAL operator-attested verdict
      // in events.verdict (NOT the events.attestation vouch). Admin-only by the gate's method rule
      // (POST, not /api/comments). The signer is the verified caller; the commit is the one the studio
      // is serving (codeStamp's start HEAD) or a deploy-time STORYTREE_STUDIO_COMMIT — refused if neither.
      const stamp = await ctx.codeStamp();
      const commitSha = process.env['STORYTREE_STUDIO_COMMIT'] ?? stamp?.startedAt ?? null;
      await handleUatAttest(req, res, ctx, ctx.policy?.me.email ?? null, commitSha);
    } else if (url.pathname === '/api/write-broker') {
      // ADR-0117: a remote builder's local build spine POSTs its locally-signed verdict here so
      // the build blooms in the shared forest (ADR-0070). The policy gate already enforced
      // builder-or-admin scope; the handler re-checks (defence in depth via mayBrokerWrite), enforces
      // the attribution wall (signer ≡ caller), and persists the verdict UNCHANGED (no re-sign). The
      // caller + resolved access ride the SAME policy the gate authorized from. Hosted-only: the open
      // dev posture has no policy → no caller → 401.
      await handleWriteBroker(req, res, {
        backend: writeBrokerBackend(ctx.backend),
        caller: ctx.policy?.me.email ?? null,
        access: ctx.policy?.access ?? null,
      });
    } else if (url.pathname === '/api/review/feed') {
      // ADR-0140 cap 5: one topic's comments + suggestions in one response, for the Review
      // surface's existing 30s poll. Member-readable (a GET passes the policy gate); both
      // sources are advisory — absent seam or a down DB reads as empty, never a throw.
      if ((req.method ?? 'GET') !== 'GET') throw new HttpError(405, 'method not allowed');
      await handleReviewFeed(req, res, url, {
        commentStore: reviewFeedCommentStore(ctx.backend),
        suggestionStore: reviewFeedSuggestionStore(ctx.backend),
      });
    } else if (url.pathname === '/api/suggestions') {
      // ADR-0140 caps 7/8: member suggestion-CREATE. The policy gate already permits a member
      // POST at exactly this path (cap 4's member-permitted write set — the decision sub-path
      // stays admin-only); the handler stamps the author from the verified identity (a body
      // author is never trusted) and answers 405 for any non-POST. json backend (no suggestion
      // seam) → 503 via the adapter, like the decision route.
      await handleSuggestionCreate(req, res, {
        backend: suggestionCreateBackend(ctx.backend),
        caller: ctx.policy?.me.email ?? null,
      });
    } else if (url.pathname === '/api/suggestions/decision') {
      // ADR-0140: the suggestion accept/reject decision. The policy gate already enforced the
      // member-suggest write policy (deciding is admin-only; a member POST 403'd before reaching
      // here), so the handler runs as cap 3 proved it: 404 unknown id, 409 already-closed, reject
      // transitions the record, accept APPLIES the proposed block splice to the asset BEFORE the
      // transition persists (409 on block-not-found / original-drifted, 501 for doc topics — see
      // suggestionDecisionBackend — never accepted-without-applied).
      if ((req.method ?? 'GET') !== 'POST') throw new HttpError(405, 'method not allowed');
      await handleSuggestionDecision(req, res, {
        backend: suggestionDecisionBackend(ctx.backend),
        caller: ctx.policy?.me.email ?? null,
      });
    } else {
      throw new HttpError(404, 'unknown endpoint');
    }
  } catch (err) {
    if (err instanceof HttpError) {
      sendJson(res, err.status, { error: err.message, ...(err.details ?? {}) });
    } else if (isLastAdminError(err)) {
      // A last-admin guard violation from either backend (its `name` is the only tag) → 409.
      sendJson(res, 409, { error: err instanceof Error ? err.message : String(err) });
    } else if (isConnectionError(err)) {
      // A pg connection failure surfacing here means the live store is down, not a
      // bug — answer 503 with the remedy so the UI can offer the Start DB button.
      sendJson(res, 503, { error: DB_UNREACHABLE_MESSAGE });
    } else {
      sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
