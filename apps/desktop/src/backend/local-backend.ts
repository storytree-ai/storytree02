// Local backend factory — composes the organism drivers into an /api/* request handler that
// replaces the 503 stub in static-server.ts. No `electron` import; headlessly provable by
// node:test against an InMemoryStore seed and a stub build seam (no live SDK, no DB).
//
// THE BOUNDARY CALL (see the story's spec): does NOT import apps/studio/server — that is a
// forbidden surface→surface coupling. Re-composes the SAME organism drivers (orchestrator
// discovery, library reads) the studio server is built from, exactly as devApi.ts does.

import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { writeToForestBroker } from "./forest-readiness.js";
import type {
  BrokerPostFn,
  BrokerCallOptions,
  ForestWrite,
  ForestWriteResult,
} from "./forest-readiness.js";
import { readTreeWithCaps, foldVerdicts } from "./tree-verdicts.js";
import type { WorkHierarchySnapshot } from "@storytree/library";

import {
  HierarchyRuntimeCache,
  announceDesktopHierarchyOrigin,
  selectDesktopHierarchy,
} from "./hierarchy-live.js";

// The raw-TS workspace packages re-export through `.js` specifiers that don't resolve under a
// non-tsx loader; load the runtime VALUES lazily, on first use — the same discipline the rest of this
// module and `tree-verdicts.ts` already follow.
let libraryFoldModule: Promise<typeof import("@storytree/library")> | null = null;
const loadLibraryFold = (): Promise<typeof import("@storytree/library")> =>
  (libraryFoldModule ??= import("@storytree/library"));

/**
 * The process-lifetime runtime cache (ADR-0445 D2) behind the desktop map's hierarchy.
 *
 * MODULE-scoped deliberately: it must outlive a single request but must never outlive the process,
 * which is exactly what separates a legitimate runtime cache from the committed mirror ADR-0302 D1
 * deleted. Nothing writes it to disk and nothing reads it back on boot.
 */
const hierarchyCache = new HierarchyRuntimeCache();

/**
 * Test seam: forget the cached hierarchy, so the next request starts from a cold process.
 *
 * The sibling of `resetDesktopHierarchyAnnouncements` in hierarchy-live.ts, and it exists for a
 * reason the mirror harness makes concrete. `selectDesktopHierarchy` degrades live → CACHE → disk,
 * and the studio has no cache at all (live → disk, ADR-0445 D2 gives the desktop one because its
 * disk copy is the incident rather than a mild degradation). So a probe replaying a LIVE arm and
 * then a DISK arm in one process would compare the studio's disk walk against this cache — two
 * different reads, reported as a divergence in neither. Resetting between arms is what keeps each
 * arm's comparison the one it claims to be, and it means arm ORDER carries no hidden meaning.
 */
export function resetHierarchyCache(): void {
  hierarchyCache.clear();
}
import type { DTVerdict, DTVerdictEvent } from "./tree-verdicts.js";

// The verdict/claim zod schemas live in raw-TS workspace packages whose `.js` re-export
// specifiers don't resolve under a non-tsx loader; load the runtime VALUES lazily, on first use —
// the SAME discipline the orchestrator import below (and the studio's writeBroker.ts) follow, so a
// future bundle of this module never reaches their enums at load time. Type-only imports are erased,
// so forest-readiness's own `import type` of these shapes carries no runtime coupling to them.
let proofProtocolModule: Promise<typeof import("@storytree/proof-protocol")> | null = null;
const loadProofProtocol = (): Promise<typeof import("@storytree/proof-protocol")> =>
  (proofProtocolModule ??= import("@storytree/proof-protocol"));
let noticeBoardModule: Promise<typeof import("@storytree/notice-board")> | null = null;
const loadNoticeBoard = (): Promise<typeof import("@storytree/notice-board")> =>
  (noticeBoardModule ??= import("@storytree/notice-board"));
// The two COMPOSITIONS behind `/api/arcs` and `/api/floor-health` are SHARED code, not
// re-compositions: `loadArcRollups` (the arc → children join, in @storytree/arc since the arc domain
// took its own package) and `loadFloorHealthReading` (the floor-health instrument's one store-reading
// half, in @storytree/drive) — both declared deps of this app precisely so the CLI, the studio server
// and this backend read one join and one reading, and cannot disagree about what an arc contains or
// how the floor is doing (ADR-0267 / ADR-0316). Loaded lazily like the two above — both pull
// `node:`-bearing modules, and nothing on the health/tree path should pay for them.
type DriveModule = typeof import("@storytree/drive");
let driveModule: Promise<DriveModule> | null = null;
const loadDrive = (): Promise<DriveModule> => (driveModule ??= import("@storytree/drive"));
type ArcModule = typeof import("@storytree/arc");
let arcModule: Promise<ArcModule> | null = null;
const loadArc = (): Promise<ArcModule> => (arcModule ??= import("@storytree/arc"));

/**
 * The library document store BOTH store-backed reads reach through — the arc rollup (`/api/arcs`) and
 * the floor-health reading (`/api/floor-health`). DRIVE'S OWN `Store` type, reached structurally so
 * this module needs no `@storytree/storage-protocol` import: that package is drive's declared dep and
 * not desktop's, and pnpm's strict isolation will not resolve it from here. The same route
 * `chat-sse-mount.ts`'s `ChatCorpusStore` takes, for the same reason.
 *
 * Derived from the arc join because that is the WIDER of the two requirements — `loadArcRollups` wants
 * the whole `Store`, `loadFloorHealthReading` only `queryDocs`/`readEvents` — so one seam satisfies
 * both and the desktop keeps ONE document store rather than two spellings of it. That mirrors the
 * studio, where `handleArcs` and `handleFloorHealth` both read `backend.docStore`.
 */
type LibraryDocStore = Parameters<ArcModule["loadArcRollups"]>[0]["store"];

// ---------- minimal HTTP helpers (local copies — not imported from studio) ----------

class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody<T>(req: IncomingMessage): Promise<T> {
  const raw = await readBody(req);
  if (!raw.trim()) return {} as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new HttpError(400, "invalid JSON body");
  }
}

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// ---------- types ----------

/**
 * The read seam injected into the local backend factory. Satisfies every route this module
 * serves; the test passes a stub, production wires @storytree/library + @storytree/store.
 */
export interface LocalBackendBackend {
  listAssets: () => Promise<unknown[]>;
  /**
   * The store's `/api/health` envelope. `code` is the OPTIONAL git-HEAD stamp (ADR-0164 Phase 1): the
   * HEAD the sidecar started on vs the checkout's HEAD now. `stale: true` means the checkout moved
   * under the running app — the shared StoreBanner turns it into the "rebuild & relaunch" affordance.
   * `runtime` is the OPTIONAL pinned-`main` runtime worktree status (ADR-0181 Decision 3): the branch it
   * is on (expected `main`), how many commits it is BEHIND `origin/main`, and `pinned` — whether this is
   * the installed pinned-runtime app (true) or the dev launch fallback (false). `branch`/`behind` are
   * absent when git can't answer; `pinned` gates the "N behind main — rebuild" update banner so it never
   * nags a developer's working checkout. The whole `runtime` object is omitted when git answers neither.
   */
  health: () => Promise<{
    db: "ok" | "unreachable" | "n/a";
    code?: { startedAt: string; head: string; stale: boolean };
    runtime?: { branch: string | null; behind: number | null; pinned?: boolean };
  }>;
  inFlightBuilds: () => Promise<unknown[] | null>;
  latestVerdicts: () => Promise<unknown>;
  /**
   * The stored WORK-HIERARCHY projection (ADR-0445 D1) — the QUESTION half of the map's join.
   *
   * This is the seam that closes the incident. The installed desktop app is the surface where the
   * skew actually bit: it ships a copy of `stories/**` frozen at the commit it was built from, reads
   * the verdict database perfectly, and finds no verdict matching any criterion re-worded since —
   * because a verdict binds by `criterionId` + `revisionId` (ADR-0253). It asked an outdated question
   * and got an honest answer, so it painted yellow until somebody rebuilt it.
   *
   * Optional like {@link verdictEvents}: a narrow stub may omit it. `null` is a first-class answer.
   */
  workHierarchy?: () => Promise<WorkHierarchySnapshot | null>;
  /** Optional — absent on the json backend; the handler falls back gracefully when missing. */
  verdictEvents?: () => Promise<unknown>;
  /**
   * In-flight story CLAIMS (ADR-0138) — the coordination wisp layer, sibling to {@link inFlightBuilds}.
   * Optional like {@link verdictEvents}: a narrow stub may omit it, and `/api/activity` falls back to
   * `null` (advisory absence). Production wires it (electron/backend-entry.ts) to fold events.node_claim.
   */
  inFlightClaims?: () => Promise<unknown[] | null>;
  /**
   * Recent claim DEPARTURES (ADR-0200 D7 — wisp-out legibility): claims released inside the departure
   * window, so a session that just left reads as a fading wisp rather than vanishing indistinguishably
   * from a lost claim. The third layer on the `/api/activity` wire, beside {@link inFlightBuilds} and
   * {@link inFlightClaims}, and optional exactly like them: a narrow stub may omit it and the route
   * answers `departures: null` (advisory absence). Production wires it (electron/backend-entry.ts) over
   * PgClaimStore.recentDepartures + the pure `foldDepartures`.
   */
  inFlightDepartures?: () => Promise<unknown[] | null>;
  /**
   * EVERY STANDING claim row, all units, all grades, STALE ONES INCLUDED (ADR-0200 D7 — the session
   * dock's claims-grouped-by-session view; unfiltered since ADR-0535 D1): the raw claim docs from
   * events.node_claim (PgClaimStore.listAllClaims — staleness is MARKED by the shared fold
   * downstream, never dropped in SQL, so this surface cannot be handed an absence the CLI board
   * marks as a stale row). Distinct from {@link inFlightClaims} (which folds each row to a map-wisp
   * activity, grade and all): this stays the raw shape so the `/api/claims` handler folds it through the pure
   * `groupClaimsBySession`. Optional like {@link inFlightClaims}: a narrow stub may omit it, and
   * `/api/claims` falls back to `{ sessions: null }` (advisory absence, never an over-claim). Production
   * wires it (electron/backend-entry.ts) over PgClaimStore.listAllClaims.
   */
  sessionClaims?: () => Promise<unknown[] | null>;
  /**
   * The library DOCUMENT STORE — the SAME `Store` the CLI drives under `--pg`, and the seam behind
   * BOTH store-backed reads: the arc rollup at `GET /api/arcs` (ADR-0267 / ADR-0314, handed straight
   * to `@storytree/arc`'s `loadArcRollups`) and the factory-floor reading at `GET /api/floor-health` (ADR-0316,
   * handed to drive's `loadFloorHealthReading`). One seam, so the desktop, the studio,
   * `storytree arc show` and `storytree factory health` cannot disagree about what an arc contains or
   * how the floor is doing. Optional exactly like {@link sessionClaims}: a narrow stub may omit it,
   * and production wires it (electron/backend-entry.ts) to the live `PgLibraryStore`.
   *
   * ITS ABSENCE IS NOT THE SAME ADVISORY NULL the overlay seams above carry, and both routes treat
   * it differently on purpose. "This backend has no document store" and "the store is here and
   * holds no arcs / a quiet floor" are DIFFERENT facts — preserving that distinction is the whole
   * reason `/api/arcs` answers `{ arcs: null }` rather than `{ arcs: [] }`, and `/api/floor-health`
   * answers `{ reading: null }` rather than a reading with no `loudest`, when the seam is missing.
   */
  docStore?: () => Promise<LibraryDocStore | null>;
}

/**
 * The build seam injected into the local backend factory; the test passes a stub that returns
 * `isBuildable: false` to pin the 404 path. Optional — when absent, /api/build → 404.
 *
 * NOTHING WIRES IT. This was documented as wired over the real `routedBuildRunner` in production, and
 * that was never true of this seam: `electron/backend-entry.ts` composes the local backend without a
 * `build` key, so `/api/build` here has always answered 404 outside its own test. ADR-0404 then retired
 * the desktop's REAL build mount (`createBuildRouteMount`, deleted 2026-08-22) — a different seam from
 * this one, which the ADR does not name — and ADR-0422 deleted `routedBuildRunner` itself, so the
 * runner this was once said to be wired over no longer exists at all.
 *
 * KEEPING IT IS A DECISION, NOT AN OVERSIGHT (ADR-0422 D3, taken explicitly so nobody has to infer it
 * from silence). The branch is inert rather than a live dispatch surface, and it stays because the
 * capability `local-backend-boot` declares a contract over it
 * (`lb-build-route-reaches-the-injected-runner`): removing it would edit a healthy story's contract set
 * for no functional gain. If it is ever removed, that is a `local-backend-boot` work-hierarchy decision
 * on its own merits — never a mechanical consequence of ADR-0404 or ADR-0422.
 */
export interface LocalBackendBuild {
  isBuildable: (unitId: string) => Promise<boolean>;
  runner: (unitId: string, sink: (line: string) => void) => Promise<{ ok: boolean; body: string }>;
}

/**
 * All dependencies injected into {@link createLocalBackend}. The factory is a plain function
 * over this injected port set so the test passes doubles and no live SDK/DB is touched.
 */
export interface LocalBackendDeps {
  /** Absolute path to the repo's `stories/` dir — passed to orchestrator discovery. */
  storiesDir: string;
  /**
   * Absolute path to the repo's `docs/` dir, passed through from `electron/backend-entry.ts`.
   *
   * NOT read on any route in THIS module — the consumer is `boot-read-routes.ts`, which walks it for
   * `GET /api/docs` / `GET /api/docs/<id>`. This comment used to say `<docsDir>/decisions` was what
   * `/api/arcs` scanned for the frontmatter `arc:` stamps joining ADRs to their arc, and that was
   * wrong twice over (corrected in place, ADR-0422 D5): `/api/arcs` reads `backend.docStore` and has
   * never touched `docsDir`, and ADR-0403 then moved decisions into the live store, so
   * `docs/decisions/` does not exist at all. The route itself is unaffected — it was only the comment
   * that described a scan nothing performs.
   */
  docsDir: string;
  /** The read backend (in-memory seed for CI, pg-backed for production). */
  backend: LocalBackendBackend;
  /** The store kind echoed by /api/health — "json" | "pg". */
  store: string;
  /** Build seam; omit for read-only deployments. */
  build?: LocalBackendBuild;
  /**
   * Forest-write seam — the desktop persists its locally-signed verdict to the SHARED
   * forest THROUGH THE BROKER (ADR-0117), never a direct Cloud SQL connection. Omit to leave the
   * forest-write route disabled (→ 404). Production wires {@link createBrokerForestWriter} over the
   * configured studio broker URL.
   */
  forestWrite?: ForestWriter;
}

// ---------- tree read + verdict overlay (re-composes the studio's GET /api/tree, ADR-0119 overlay) ----------

/** The `/api/tree` refusal — the studio's words exactly (`TREE_PROOF_UNREAD` in apiRouter.ts), held
 * equal by the `tree-fixtures` conformance arm that exercises a live hierarchy with unreadable proof. */
const TREE_PROOF_UNREAD =
  "the live store served the work hierarchy but its signed verdicts could not be read — refusing to paint a map without its proof";

/**
 * Build the verdict-enriched `/api/tree` payload: read the authored tree with FULL capabilities, then
 * fold in the signed-verdict overlay (the studio tree-handler's enrichment, re-composed in
 * `tree-verdicts.ts`) so the desktop forest paints proof-health like the hosted studio — green from a
 * signed `verdict.outcome === 'pass'`, not the authored-status brown the bare tree fell back to.
 *
 * Every overlay leg is advisory (ADR-0033): a `null` source (the json backend / a down DB) leaves the
 * authored hue — the tree UNDER-claims, never over-claims, and never throws. Seeds `builds` on first
 * load (the `/api/activity` poll then keeps it fresh) — parity with the studio handler. The
 * self-reported `sessions` weave retired with presence (ADR-0200 D7 — the claim ledger is the one
 * coordination surface). The verdict pg SQL lives behind `deps.backend` (electron/backend-entry.ts);
 * this module stays pg-free (the desktop's brokered-only write boundary, ADR-0117).
 */
async function buildTreePayload(deps: LocalBackendDeps): Promise<Record<string, unknown>> {
  // ADR-0445 D1: the QUESTION comes from the live store when it can answer, so it shares a clock with
  // the PROOF folded in below. The frozen `stories/**` copy that ships inside this app is LAST, and
  // is only reachable through a branch that says why — it is the incident, not a neutral fallback.
  const { foldWorkHierarchy } = await loadLibraryFold();
  const selection = await selectDesktopHierarchy({
    live: deps.backend.workHierarchy?.bind(deps.backend),
    fold: foldWorkHierarchy,
    cache: hierarchyCache,
    disk: () => readTreeWithCaps(deps.storiesDir),
  });
  announceDesktopHierarchyOrigin(selection);
  const { stories, uatTestCriteriaByStory, uatCriteriaByStory, coverageByStory } = selection.read;
  // Run the advisory reads in parallel so a down DB costs one timeout budget, not three.
  // The asset list used to be a fourth leg, read ONLY to feed the ADR-0107 open-question green-gate
  // its `references`; that gate is retired with the citation tier (ADR-0477 D1), so the read went
  // with it rather than being left fetching a list nothing folds.
  const readProof = () =>
    Promise.all([
      deps.backend.latestVerdicts() as Promise<Record<string, DTVerdict> | null>,
      (deps.backend.verdictEvents?.() ?? Promise.resolve(null)) as Promise<readonly DTVerdictEvent[] | null>,
    ]);
  let [[latestVerdicts, verdictEvents], builds] = await Promise.all([
    readProof(),
    deps.backend.inFlightBuilds(),
  ]);
  // The studio's rule, re-composed (its `buildTreePayload`): when the LIVE store just served the
  // hierarchy, a null proof read is a failed read, not an absence, and folding it would paint every
  // island its authored status as if current. Re-read once, then refuse. A cache/disk origin keeps
  // the advisory under-claim above.
  const proofUnread = () =>
    latestVerdicts === null || (deps.backend.verdictEvents !== undefined && verdictEvents === null);
  if (selection.origin === "live" && proofUnread()) {
    [latestVerdicts, verdictEvents] = await readProof();
    if (proofUnread()) throw new HttpError(503, TREE_PROOF_UNREAD);
  }
  await foldVerdicts(
    stories,
    uatTestCriteriaByStory,
    coverageByStory,
    {
      latestVerdicts,
      verdictEvents,
    },
    uatCriteriaByStory,
  );
  // One expression rather than an accumulator: `builds` is either present or the key is absent,
  // which is what the two literals say directly.
  return builds && builds.length > 0 ? { stories, builds } : { stories };
}

// ---------- factory ----------

/**
 * Create the /api/* request handler for the local (Electron) backend.
 *
 * ROUTE TABLE — minimal-to-journey (ADR-0113 "minimal first"): mounts only what the
 * thick-client journey needs. Desktop-irrelevant hosted concerns (IAP / members / invites /
 * db-control / db-wake) are NOT ported.
 *
 * - GET  /api/health   — store + db probe envelope + the answering process's `pid` (NEVER 503)
 * - GET  /api/tree     — the story tree from real orchestrator discovery over `storiesDir`, ENRICHED
 *                        with the signed-verdict overlay so islands/plants paint proof-health (ADR-0119
 *                        deferred overlay) — green from a signed pass, not authored brown
 * - GET  /api/activity — the map-activity wisp layer: in-flight builds (ADR-0048) + story claims
 *                        (ADR-0138), `{ builds, claims }` — both advisory
 * - GET  /api/claims   — the claim-ledger DOCK view (ADR-0200 D7), `{ sessions }` — live claim rows
 *                        grouped by session (advisory: `{ sessions: null }` when the seam/DB is silent)
 * - GET  /api/arcs     — the ARC SURFACE's rollups (ADR-0267 / ADR-0314), `{ arcs }`; `/api/arcs/<id>`
 *                        serves one. Read-only by decision (405 on a write, ADR-0267 D6 / ADR-0314 D9)
 * - GET  /api/floor-health — the FACTORY-FLOOR reading behind ADR-0314 D7's strip (ADR-0316),
 *                        `{ reading }`; `null` when this backend has no document store
 * - GET  /api/assets   — library assets from the injected `backend`
 * - POST /api/build    — dispatch a build intent via the injected `build` seam (404 when absent)
 * - *    /api/*        — 404 with an error body
 */
export function createLocalBackend(
  deps: LocalBackendDeps,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (!url.pathname.startsWith("/api/")) {
        throw new HttpError(404, "not found");
      }

      if (url.pathname === "/api/health") {
        if ((req.method ?? "GET") !== "GET") throw new HttpError(405, "method not allowed");
        const health = await deps.backend.health();
        // `pid` mirrors the studio's handleHealth (apiRouter.ts): the OS process id of the
        // process answering, so a launcher can tell ITS sidecar from a foreign listener that
        // already holds the port rather than measuring one as the other. Re-composed here
        // rather than imported (the house rule for mirrored routes), which is exactly why it
        // has to be added deliberately — a mirror silently lacks whatever the studio gained.
        // Nothing in the desktop app compares it yet; it keeps the two envelopes one shape.
        sendJson(res, 200, { store: deps.store, ...health, pid: process.pid });
      } else if (url.pathname === "/api/tree") {
        if ((req.method ?? "GET") !== "GET") throw new HttpError(405, "method not allowed");
        sendJson(res, 200, await buildTreePayload(deps));
      } else if (url.pathname === "/api/activity") {
        // The map-activity wisp layer, polled by the world — `{ builds, claims, departures }` (each
        // advisory: null when the backend can't answer). Builds (ADR-0048), story claims (ADR-0138) and
        // claim departures (ADR-0200 D7) ride the SAME wire; a claim carries `kind: "claim"` (the §5
        // honesty wall) so it renders distinct from a proven-green bloom, and a departure is a
        // coordination trace, never a proof either. Mirrors the studio's GET /api/activity
        // (handleActivity) — all three keys, so a released claim fades out here as it does there rather
        // than vanishing indistinguishably from a lost one. Run in parallel: a down DB costs one budget.
        if ((req.method ?? "GET") !== "GET") throw new HttpError(405, "method not allowed");
        const [builds, claims, departures] = await Promise.all([
          deps.backend.inFlightBuilds(),
          deps.backend.inFlightClaims?.() ?? Promise.resolve(null),
          deps.backend.inFlightDepartures?.() ?? Promise.resolve(null),
        ]);
        sendJson(res, 200, { builds, claims, departures });
      } else if (url.pathname === "/api/claims") {
        // The claim-ledger DOCK view (ADR-0200 D7): every live claim row folded by session through the
        // pure `groupClaimsBySession` so the desktop session dock renders "who's doing what, grouped by
        // session" — the SAME shape the studio's GET /api/claims produces (handleClaims), re-composed
        // here (no apps/studio/server import, ADR-0100). Sibling to /api/activity, but its
        // OWN endpoint (the dock fetches it only while open, not on the world's poll cadence). Advisory:
        // `sessionClaims` absent / a down DB → 200 `{ sessions: null }`, never a 503; the only error path
        // is the 405 method guard. `groupClaimsBySession` rides the existing `loadNoticeBoard` lazy loader
        // (browser-safe zod, no `node:`/`pg` import), so this module stays bundle-safe.
        if ((req.method ?? "GET") !== "GET") throw new HttpError(405, "method not allowed");
        const claims = (await (deps.backend.sessionClaims?.() ?? Promise.resolve(null))) as
          | unknown[]
          | null;
        if (claims === null) {
          sendJson(res, 200, { sessions: null });
        } else {
          const { groupClaimsBySession } = await loadNoticeBoard();
          sendJson(res, 200, {
            sessions: groupClaimsBySession(
              claims as Parameters<typeof groupClaimsBySession>[0],
              new Date(),
            ),
          });
        }
      } else if (url.pathname === "/api/arcs" || url.pathname.startsWith("/api/arcs/")) {
        // The ARC SURFACE's read (ADR-0267 / ADR-0314): `{ arcs: ArcRollupSummary[] }` for the list,
        // one full `ArcRollup` for `/api/arcs/<id>`. Re-composes the studio's handleArcs
        // (apiRouter.ts) — no apps/studio/server import (ADR-0100 / ADR-0176) — but the COMPUTE is
        // genuinely shared: `@storytree/arc`'s `loadArcRollup`/`loadArcRollupSummaries` is the same
        // join `storytree arc show` renders, so nothing is derived here and the three surfaces
        // cannot disagree about an arc's contents.
        //
        // THE TWO READS SERVE DIFFERENT WIDTHS OF THAT ONE JOIN, and the NARROWING is shared code
        // too — `loadArcRollupSummaries` is `loadArcRollups` projected through `summariseArcRollup`
        // in @storytree/arc, never a field list re-picked here. The list drops the narrative prose
        // no lane draws — measured 2026-08-20 against the live store, that took it from 1,364,425
        // bytes over 76 arcs to 226,836 — while the per-id read keeps the whole rollup, because the
        // briefing panel renders one arc's `intent`, its questions' `stakes` and every increment's
        // outcome prose. A desktop copy that re-picked the fields would be exactly the ENVELOPE
        // drift the MIRRORS row below exists to catch, so it does not re-pick them.
        //
        // WHY THE DESKTOP NEEDS IT AT ALL: the Electron app loads the COMPILED STUDIO BUNDLE against
        // this backend, so it already ships the arc lens the studio gained — a lens that 404'd here
        // and rendered the honest-but-empty "Arcs aren't available here" notice, leaving the thick
        // client with no arc orientation while the studio showed the whole portfolio.
        //
        // THREE BEHAVIOURS ARE THE STUDIO'S, VERBATIM, and each is a decision rather than an
        // accident: a non-GET is a typed 405 because the surface is read-only BY DECISION (ADR-0267
        // D6 / ADR-0314 D9), not by omission; no document store answers 200 `{ arcs: null }` for the
        // list and 503 for a single id, because "the store isn't here" and "there are no arcs" are
        // different facts and a surface built to RESTORE context must not blur them into a confident
        // empty state (`apps/studio/src/lib/arcRollups.ts` keeps all four states apart downstream);
        // and an unknown id is a 404 rather than an empty shell.
        if ((req.method ?? "GET") !== "GET") {
          throw new HttpError(
            405,
            "method not allowed — the arc surface is read-only this round (ADR-0267 D6)",
          );
        }
        const store = await (deps.backend.docStore?.() ?? Promise.resolve(null));
        const rest = url.pathname.slice("/api/arcs".length).replace(/^\//, "");
        const id = rest === "" ? null : decodeURIComponent(rest);
        if (store === null) {
          if (id !== null) {
            throw new HttpError(
              503,
              "the arc view needs the live store — arcs are live-canonical (ADR-0183)",
            );
          }
          sendJson(res, 200, { arcs: null });
        } else {
          const { loadArcRollup, loadArcRollupSummaries } = await loadArc();
          const arcDeps = {
            store,
            storiesDir: deps.storiesDir,
          };
          if (id === null) {
            sendJson(res, 200, { arcs: await loadArcRollupSummaries(arcDeps) });
          } else {
            const rollup = await loadArcRollup(arcDeps, id);
            if (rollup === null) throw new HttpError(404, `no arc "${id}"`);
            sendJson(res, 200, rollup);
          }
        }
      } else if (url.pathname === "/api/floor-health") {
        // The FACTORY-FLOOR HEALTH reading behind ADR-0314 D7's strip (the instrument ADR-0316 D1–D4
        // built on `factory-floor-health-arc`, whose D5 names that strip its first committed
        // CONSUMER). Re-composes the studio's handleFloorHealth (apiRouter.ts) — no
        // apps/studio/server import (ADR-0100 / ADR-0176) — while the COMPUTE is genuinely shared:
        // drive's `loadFloorHealthReading` is the same composition `storytree factory health` prints
        // under "THE READING", so nothing is derived here and the surfaces cannot disagree about the
        // floor. This branch adds routing, the method check and the honest store-absent answer only.
        //
        // WHY THE DESKTOP NEEDS IT AT ALL — the same gap `/api/arcs` had, found the same way. The
        // Electron app loads the COMPILED STUDIO BUNDLE against this backend, so it already ships the
        // band #1228 wired; without this route the fetch 404'd and the band rendered `declined` —
        // "the floor-health read didn't answer here" (apps/studio/src/lib/floorHealth.ts). That was
        // HONEST rather than broken, by design, but it is not the reading, and this is a surface the
        // owner actually uses.
        //
        // IT SETS NO THRESHOLD, deliberately — ADR-0316 D4 keeps the instrument to MEASURING, so what
        // crosses this wire is the figure and its provenance; the band that reads it decides loud from
        // quiet (`LOUD_AT_RECURRENCES` in apps/studio/src/components/FloorHealthLamp.tsx). A mirror
        // that decided loudness would put the one undecided call somewhere no reader can see it, and
        // would make the two surfaces disagree about the same floor.
        //
        // `reading: null` IS THE STORE-ABSENT ANSWER, not a quiet floor — the same advisory contract
        // `/api/arcs` carries, and the strip renders the two differently, because a missing instrument
        // presented as "all clear" is the failure mode the whole band exists to avoid.
        if ((req.method ?? "GET") !== "GET") {
          throw new HttpError(
            405,
            "method not allowed — the floor-health band reports, it does not adjudicate (ADR-0316 D4)",
          );
        }
        const store = await (deps.backend.docStore?.() ?? Promise.resolve(null));
        if (store === null) {
          sendJson(res, 200, { reading: null });
        } else {
          const { loadFloorHealthReading } = await loadDrive();
          sendJson(res, 200, { reading: await loadFloorHealthReading(store) });
        }
      } else if (url.pathname === "/api/assets") {
        if ((req.method ?? "GET") !== "GET") throw new HttpError(405, "method not allowed");
        const assets = await deps.backend.listAssets();
        sendJson(res, 200, assets);
      } else if (url.pathname === "/api/build") {
        if (deps.build === undefined) throw new HttpError(404, "build is not enabled");
        const method = req.method ?? "GET";
        if (method !== "POST") throw new HttpError(405, `method ${method} not allowed`);
        const input = await readJsonBody<Record<string, unknown>>(req);
        const unitId = asString(input["unitId"]).trim();
        if (!unitId) throw new HttpError(400, "unitId is required");
        if (!(await deps.build.isBuildable(unitId))) {
          throw new HttpError(404, `no buildable node "${unitId}"`);
        }
        // The build runner is fire-and-forget (the client polls for progress via future GET).
        // For now, return 202 with a stable envelope; the runner is wired but not yet polled.
        void deps.build.runner(unitId, () => undefined);
        sendJson(res, 202, { runId: unitId });
      } else if (url.pathname === "/api/forest/write") {
        // Persist a locally-signed verdict to the SHARED forest THROUGH THE BROKER
        // (ADR-0117) — the desktop's forest-write path is brokered, never a direct DB connection.
        if (deps.forestWrite === undefined) throw new HttpError(404, "forest write is not enabled");
        const method = req.method ?? "GET";
        if (method !== "POST") throw new HttpError(405, `method ${method} not allowed`);
        const input = await readJsonBody<Record<string, unknown>>(req);
        const write = await parseForestWrite(input);
        const result = await deps.forestWrite.write(write);
        if (result.persisted) {
          // The broker validated shape + attribution and persisted under its service-account identity.
          sendJson(res, 201, { ok: true, body: result.body });
        } else {
          // Fail-closed, never forged: surface the broker's refusal status (or 502 when the broker
          // was unreachable / timed out) with the member-actionable guidance.
          sendJson(res, result.status ?? 502, { ok: false, error: result.guidance });
        }
      } else {
        throw new HttpError(404, "unknown endpoint");
      }
    } catch (err) {
      if (err instanceof HttpError) {
        sendJson(res, err.status, { error: err.message });
      } else {
        sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  };
}

// ---------- forest-write wiring (brokered, never a direct DB connection — ADR-0117) ----------

/**
 * Validate an incoming `{ type, payload }` forest-write request into a typed {@link ForestWrite}.
 *
 * Throws {@link HttpError}(400) on an unknown type or a payload that fails its protocol shape — the
 * desktop fast-fails malformed local input before the network hop; the broker re-validates as the
 * authority (ADR-0117 d.3). The zod schemas are lazy-loaded (the raw-TS `.js` re-export discipline).
 * `verdict` is the ONLY write type — brokered presence retired with self-reported presence
 * (ADR-0200 D7; the claim ledger is the one coordination surface).
 */
async function parseForestWrite(input: Record<string, unknown>): Promise<ForestWrite> {
  const type = input["type"];
  if (type === "verdict") {
    const { Verdict } = await loadProofProtocol();
    const parsed = Verdict.safeParse(input["payload"]);
    if (!parsed.success) throw new HttpError(400, `invalid verdict shape: ${parsed.error.message}`);
    return { type: "verdict", payload: parsed.data };
  }
  throw new HttpError(400, `unknown forest write type "${String(type)}"`);
}

/**
 * Production {@link BrokerPostFn}: a real `fetch` POST to the configured studio broker base URL.
 *
 * Opens NO DB connection and imports NO `apps/studio/server` source — the cross-surface edge is an
 * HTTP edge only (ADR-0117 d.1 / ADR-0100). Returns the broker's status + parsed JSON body so the
 * write client can map it to a persisted / not-persisted result.
 */
/**
 * A broker response body: the parsed JSON when it parses, the RAW TEXT when it does not.
 *
 * No return annotation, deliberately (anti-slop `no-known-value-widening`): inference reproduces
 * `unknown` here exactly. The `as unknown` keeps `any` from leaking out of `JSON.parse`.
 */
function parseJsonOrText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export function createFetchBrokerPost(brokerBaseUrl: string): BrokerPostFn {
  const base = brokerBaseUrl.replace(/\/+$/, "");
  return async (apiPath, body) => {
    const res = await fetch(`${base}${apiPath}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const parsed: unknown = text === "" ? null : parseJsonOrText(text);
    return { status: res.status, body: parsed };
  };
}

/**
 * The desktop's forest-write seam: persist a locally-signed verdict to the shared forest
 * THROUGH THE BROKER (ADR-0117) — never a direct Cloud SQL connection.
 */
export interface ForestWriter {
  write: (write: ForestWrite) => Promise<ForestWriteResult>;
}

/**
 * Production {@link ForestWriter}: brokered over a real `fetch` {@link BrokerPostFn} pointed at the
 * configured studio broker URL. This is the desktop's ONLY forest-write path — there is no direct
 * `@storytree/store` / `PgWorkStore` connector in the desktop write path (ADR-0117 d.1/d.5).
 */
export function createBrokerForestWriter(
  brokerBaseUrl: string,
  options?: BrokerCallOptions,
): ForestWriter {
  const brokerPost = createFetchBrokerPost(brokerBaseUrl);
  return { write: (w) => writeToForestBroker(brokerPost, w, options) };
}
