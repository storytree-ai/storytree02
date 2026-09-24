// The thick-local backend SIDECAR (ADR-0119 §1). Run as a child Node process under `tsx`
// (`ELECTRON_RUN_AS_NODE=1 --import tsx`) spawned by electron/main.ts — NOT bundled into the CJS
// main, because esbuild silently empties `import.meta.url` / `import.meta.resolve("tsx")` under CJS
// (the corpus paths + the build path break). As a raw-TS sidecar, `import.meta.url` is real, the
// drivers run in their native habitat, and the studio dist server PROXIES `/api/*` here.
//
// THE BOUNDARY (ADR-0119 / the story's "Local-backend boundary call"): this RE-COMPOSES the organism
// drivers exactly as apps/studio/server/devApi.ts does — it does NOT import apps/studio/server (a
// forbidden surface→surface coupling). It mounts the studio's BOOT read set so the frontend renders:
//   - boot-read-routes (me/docs/comments) — the read router proven by boot-read-routes.test.ts
//   - chat-sse-mount   (POST /api/chat → SSE) — the chat-sse-mount dispatcher (read/propose only, ADR-0091)
//   - local-backend     (health/tree/assets [+ build, disabled here]) — the local-backend-boot factory
// READ/PROPOSE loop (ADR-0119 §2 + the chat-SSE increment): the chat surface is now mounted (orient +
// propose via startChatStream); the build-trigger / adopt outer-loop paths are still later increments.

import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  createPool,
  closePool,
  PgLibraryStore,
  PgCommentStore,
  PgWorkHierarchyStore,
  renderStoredDoc,
} from "@storytree/library/store";
import { supersededDecisionNumbers } from "@storytree/library";
import { DEPARTURE_WINDOW_MS, foldDepartures } from "@storytree/notice-board";
import { PgClaimStore } from "@storytree/notice-board/store";
import { SIGNING_EVENT_KIND } from "@storytree/proof-protocol";
import { loadLocalSecrets } from "@storytree/drive/secrets";
import {
  createOrientationRunner,
  deriveIdentity,
  buildInspectDeps,
  ensureLiveDb,
} from "@storytree/drive";
import type { InspectSurfaceDeps } from "@storytree/drive";

import { createAdvisoryReader } from "../src/backend/advisory.js";
import { createAttestationsMount } from "../src/backend/attestations-route.js";
import {
  IN_FLIGHT_CLAIMS_SQL,
  claimRowsToActivity,
  type DesktopClaimRow,
} from "../src/backend/claim-activity.js";
import { createCodeStampProbe, gitHead } from "../src/apply/code-stamp.js";
import { createRuntimeStatusProbe, fetchOriginBestEffort } from "../src/apply/runtime-status.js";
import { RUNTIME_ROOT_ENV } from "../src/apply/runtime-root.js";
import { createLocalBackend } from "../src/backend/local-backend.js";
import type { ForestWriter, LocalBackendBackend } from "../src/backend/local-backend.js";
import { writeToForestBroker } from "../src/backend/forest-readiness.js";
import type { BrokerPostFn } from "../src/backend/forest-readiness.js";
import {
  describeLaunchRefusal,
  ensureLaunchPreconditions,
} from "../src/backend/launch-preconditions.js";
import { createBootReadRoutes } from "../src/backend/boot-read-routes.js";
import { guardHttpRequest } from "../src/backend/loopback-guard.js";
import { createChatSseMount } from "../src/backend/chat-sse-mount.js";
import { createTraversalRoutes, primeTraversalRoutes } from "../src/backend/traversal-routes.js";
import { createChatResetMount } from "../src/backend/chat-reset-route.js";
import { createUatAttestMount } from "../src/backend/uat-attest-route.js";
import type { ChatSseMountDeps } from "../src/backend/chat-sse-mount.js";
import { resolveOrchestratorMaxTurns } from "../src/backend/orchestrator-turns.js";
import { CredentialBroker } from "../src/credential/broker.js";
import { CREDENTIAL_ENV_VAR } from "../src/credential/kinds.js";
import { NapiKeychain } from "../src/keychain/napi-adapter.js";
import { PgAttestationStore } from "@storytree/orchestrator/store";

// ---------- repo paths (real `import.meta.url`, the reason this is a sidecar) ----------

// ADR-0181: the desktop serves a pinned-`main` runtime worktree. electron/main.ts resolves that
// worktree (fail-closed: it must exist and be on `main`) and passes its root as STORYTREE_DESKTOP_RUNTIME,
// so the sidecar reads the live stories/ + docs/ from THERE — the merged, CI-proven `main` — instead of
// whatever checkout the shell launched from. Falls back to self-relative (electron → apps/desktop → apps
// → repo root) when unset — the dev-convenience path (a developer iterating on the shell, ADR-0113 §7).
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = (process.env[RUNTIME_ROOT_ENV] ?? "").trim() || resolve(here, "..", "..", "..");
const storiesDir = resolve(repoRoot, "stories");
const docsDir = resolve(repoRoot, "docs");

// The Rail-2 trigger signal (ADR-0164 Phase 1 + the build-stamp increment): `startedAt` is the commit
// the RUNNING BUILD was produced at — the SHA `build:electron` stamps into `dist/build-stamp.json`
// (preferred), falling back to the git-HEAD the sidecar STARTED on for an un-stamped older build. Each
// /api/health re-reads HEAD; `head !== startedAt` means the running build is BEHIND the checkout (a merged
// fix landed, OR the app launched on an un-rebuilt checkout — the tsx sidecar reads fresh but the served
// dist/electron bundle does not, the silent case the plain HEAD-at-spawn signal missed), which the shared
// StoreBanner turns into the "rebuild & relaunch" affordance. Advisory: null (no `code` field) when git
// can't answer. Re-composed here, not imported from apps/studio/server (a forbidden surface, ADR-0100).
const buildStampPath = resolve(here, "..", "dist", "build-stamp.json");
const codeStampProbe = createCodeStampProbe(repoRoot, buildStampPath);

// The pinned-`main` runtime-worktree status (ADR-0181 Decision 3 — version visibility): which branch the
// runtime worktree is on (expected `main`) + how many commits it is BEHIND `origin/main` as of the last
// fetch. Rides every /api/health answer so the desktop can surface "running <sha> — N behind main".
// Advisory: null fields when git can't answer (the code-stamp contract), never a throw.
const runtimeStatusProbe = createRuntimeStatusProbe(repoRoot);

// PINNED = this sidecar serves a pinned-`main` runtime worktree (ADR-0181), set by electron/main.ts only
// when `resolveRuntimeRoot` chose the runtime source (not the dev-convenience launch fallback). It gates
// the launch update-check `git fetch` below and stamps health.runtime.pinned, so the "N behind main —
// rebuild & relaunch" banner (which offers the ff-only PULL) shows for the installed app and never nags a
// developer whose working checkout is legitimately behind `origin/main`.
const pinnedRuntime = process.env["STORYTREE_DESKTOP_RUNTIME_PINNED"] === "1";

// ---------- session identity (ADR-0033) for the chat spawn surface ----------
//
// The spawn claim (ADR-0138 §2) stamps a real holder so a refusal names who holds a story. The
// canonical identity is the worktree name + HEAD branch (deriveIdentity, the same key the terminal
// session declares). A member's desktop checkout is usually a plain clone (not a `.claude/worktrees/*`
// worktree), so deriveIdentity returns null there — we fall back to a desktop-scoped id off the repo
// basename, still carrying the live HEAD branch. null only when git itself is unreachable (then the
// spawn surface fails closed and the chat mounts propose-only).
function deriveChatIdentity(root: string): { sessionId: string; branch: string } | null {
  const runGit = (args: string[]): string =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).toString().trim();
  const viaWorktree = deriveIdentity(runGit);
  if (viaWorktree !== null) return viaWorktree;
  try {
    const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]);
    const top = runGit(["rev-parse", "--show-toplevel"]);
    const base = top.split(/[/\\]/).filter((p) => p.length > 0).pop() ?? "";
    if (branch.length === 0 || base.length === 0) return null;
    return { sessionId: `desktop-${base}`, branch };
  } catch {
    return null;
  }
}

// ---------- verdict / activity overlay drivers (ADR-0119 deferred overlay) ----------
//
// Re-composed from apps/studio/server's PgBackend reads (libraryBackend.ts) — the SAME raw SQL over
// events.verdict / events.work_event — so the desktop forest paints the SAME proof-health / wisp
// layers as the hosted studio. (The self-reported PRESENCE overlay retired with ADR-0200 D7 — the
// claim ledger is the one coordination surface.) NOT an import of
// apps/studio/server (the surface boundary, ADR-0100). This is the operator-attested GLUE the desktop
// story assigns to electron/backend-entry.ts (the sidecar wiring is attested, not a CI capability); the
// CI-proven core is the tree-verdicts.ts fold, exercised through these seams by stubs. Each read is
// ADVISORY (ADR-0033): null on ANY failure (stopped DB, missing table, timeout), never a throw, so a
// down DB leaves the tree under-claiming rather than hanging /api/tree. Failures are LOGGED (once
// per failing streak, src/backend/advisory.ts) so a silently-stale overlay is distinguishable from
// a genuinely empty one in the sidecar's stderr (inherited by the Electron main).

const ADVISORY_TIMEOUT_MS = 4_000;
// The in-flight-build TTL (ADR-0048 §2) — mirrors apps/studio/src/types `BUILD_IN_FLIGHT_TTL_MS`
// (studio-local, not importable across the surface boundary); a dangling/hard-killed build clears in
// minutes rather than orbiting forever.
const IN_FLIGHT_TTL_MS = 20 * 60 * 1_000;
const GATE_PHASES: ReadonlySet<string> = new Set([
  "AUTHOR_TEST",
  "CONFIRM_RED",
  "IMPLEMENT",
  "CONFIRM_GREEN",
  "GATE",
]);
// The three ADR-0138 §5 subagent colour-states — guards the advisory `doc->>'colourState'` read so a
// malformed value (or the §5-forbidden "green"/"bloom") can never reach the build wisp's role tint.
const COLOUR_STATES: ReadonlySet<string> = new Set(["authoring", "proving", "supplementing"]);
// (The claim stale-reclaim window moved to src/backend/claim-activity.ts with the fold that uses it.)

// Race an advisory read against a short timeout; null on ANY failure (the PgBackend pattern),
// each failure logged once per streak to stderr (the CI-proven core, src/backend/advisory.ts).
const advisory = createAdvisoryReader({ timeoutMs: ADVISORY_TIMEOUT_MS });

const toIso = (at: Date | string): string =>
  at instanceof Date ? at.toISOString() : new Date(at).toISOString();

// ---------- listen / shutdown ----------

/** Bind the server to an ephemeral 127.0.0.1 port and print the ONE handshake line main.ts parses. */
async function announce(server: import("node:http").Server): Promise<number> {
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  const { port } = server.address() as AddressInfo;
  // The ONE line main.ts parses off stdout — everything else logs to stderr so it can't be mistaken
  // for the handshake.
  process.stdout.write(`STORYTREE_BACKEND_PORT=${port}\n`);
  return port;
}

/** Reap cleanly when the Electron main kills us on quit: run `cleanup` once, then exit. */
function installShutdown(
  server: import("node:http").Server,
  cleanup: () => Promise<void>,
): void {
  let closing = false;
  const shutdown = (signal: string): void => {
    if (closing) return;
    closing = true;
    console.error(`[backend-entry] ${signal} — shutting down`);
    server.close(() => {
      void cleanup().finally(() => process.exit(0));
    });
    // Belt-and-braces: never hang the parent's quit on a stuck socket.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

// ---------- authenticated broker IPC (sidecar → Electron main) ----------

interface MainBrokerResponse {
  type: "broker:response";
  requestId: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

let brokerRequestSeq = 0;
const brokerRequests = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timeout: NodeJS.Timeout }
>();

process.on("message", (message: unknown) => {
  if (typeof message !== "object" || message === null) return;
  const response = message as Partial<MainBrokerResponse>;
  if (response.type !== "broker:response" || typeof response.requestId !== "string") return;
  const pending = brokerRequests.get(response.requestId);
  if (pending === undefined) return;
  brokerRequests.delete(response.requestId);
  clearTimeout(pending.timeout);
  if (response.ok) pending.resolve(response.value);
  else pending.reject(new Error(response.error ?? "Electron broker bridge refused the request"));
});

function requestElectronMain<T>(
  request: { type: "broker:identity" } | { type: "broker:post"; path: string; body: unknown },
): Promise<T> {
  if (typeof process.send !== "function" || !process.connected) {
    return Promise.reject(new Error("Electron broker IPC is unavailable; UAT verdict was not written"));
  }
  const requestId = `broker-${Date.now().toString(36)}-${++brokerRequestSeq}`;
  return new Promise<T>((resolveRequest, rejectRequest) => {
    const timeout = setTimeout(() => {
      brokerRequests.delete(requestId);
      rejectRequest(new Error("Electron broker IPC timed out; UAT verdict was not written"));
    }, 130_000);
    brokerRequests.set(requestId, {
      resolve: (value) => resolveRequest(value as T),
      reject: rejectRequest,
      timeout,
    });
    process.send?.({ ...request, requestId }, (error) => {
      if (error === null) return;
      const pending = brokerRequests.get(requestId);
      if (pending === undefined) return;
      brokerRequests.delete(requestId);
      clearTimeout(pending.timeout);
      rejectRequest(error);
    });
  });
}

const mainBrokerPost: BrokerPostFn = (path, body) =>
  requestElectronMain<{ status: number; body: unknown }>({ type: "broker:post", path, body });

const brokeredForestWriter: ForestWriter = {
  write: (write) => writeToForestBroker(mainBrokerPost, write, { timeoutMs: 125_000 }),
};

// `readJsonObject` MOVED with the only route that called it — see
// ../src/backend/uat-attest-route.ts. Left as a pointer rather than deleted silently: a body
// reader declared here reads as a route still parsing its request in this file.

function currentGitState() {
  const commitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();
  const porcelain = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  return { commitSha, clean: porcelain.trim() === "" };
}

// The `GET /api/attestations` wire envelope moved with the mount it belongs to — see
// `UatTestsEnvelope` in ../src/backend/attestations-route.ts. Left as a pointer rather than deleted
// silently: a type declared beside a route reads as that route still living here.

// ---------- main ----------

async function main(): Promise<void> {
  // Launch update-check (ADR-0181 / ADR-0164): when serving a pinned-`main` runtime worktree, kick off a
  // single best-effort `git fetch origin` so runtime-status reads a TRUTHFUL behind-`main` count at
  // launch and the update banner can fire (the count is otherwise "as of the last fetch"). Fire-and-forget
  // — never awaited (it runs concurrently with the slow DB boot below, so it costs no startup latency) and
  // never rejects (fetchOriginBestEffort swallows offline/no-origin failures), so a network hiccup can
  // neither block nor crash startup. A ONE-TIME launch fetch, not a per-poll hit (ADR-0181).
  if (pinnedRuntime) {
    console.error("[backend-entry] checking origin/main for updates (git fetch)…");
    void fetchOriginBestEffort(repoRoot).then(() =>
      console.error("[backend-entry] update check complete (behind-main count refreshed)"),
    );
  }

  // Record which credential env vars the operator EXPLICITLY set, BEFORE any hydration runs — the
  // precedence anchor for the build path (explicit env > keychain > secrets file, the secrets.ts
  // posture): once loadLocalSecrets fills the file tier below, "explicit" and "file-hydrated" are
  // indistinguishable in process.env, so the distinction must be captured here.
  const explicitCredentialEnv: ReadonlySet<string> = new Set(
    Object.values(CREDENTIAL_ENV_VAR).filter((name) => (process.env[name] ?? "").trim() !== ""),
  );

  const preconditions = await ensureLaunchPreconditions({
    probeGitRepo: async () => (await gitHead(repoRoot)) !== null,
    ensureDb: async () => {
      // Fill STORYTREE_DB_USER before the DB preflight authenticates. The git probe above remains the
      // first launch precondition, so a non-checkout never wakes the database.
      loadLocalSecrets();
      return ensureLiveDb((message) => console.error(`[backend-entry] ${message}`));
    },
    log: (message) => console.error(`[backend-entry] ${message}`),
  });
  if (!preconditions.ok) throw new Error(describeLaunchRefusal(preconditions));

  const { pool, connector } = await createPool();
  const library = new PgLibraryStore(pool);
  const comments = new PgCommentStore(pool);
  const attestations = new PgAttestationStore(pool);
  // The ledger read behind the session dock's GET /api/claims view (ADR-0200 D7) — the SAME store the
  // CLI board reads, and since ADR-0535 D1 the same UNFILTERED read (`listAllClaims`): staleness is
  // marked by the shared fold, never dropped in SQL. Separate instance from the PgClaimStore
  // built inside the spawn-surface block below (that one adapts the narrow claim/bumpHeartbeat seam).
  const claimLedger = new PgClaimStore(pool);

  // The RAW signed-verdict event stream (events.verdict ORDER BY seq) shaped as `{ kind: 'signing',
  // seq, doc }` — shared by the backend's advisory overlay read below AND the orientation runner's
  // verdict reader (which wants the throw-on-failure form; drive's readVerdictEvents catches it).
  const readVerdictEventRows = async (): Promise<{ kind: string; seq: number; doc: unknown }[]> => {
    const res = await pool.query(`SELECT seq, doc FROM events.verdict ORDER BY seq`);
    return res.rows.map((raw) => {
      const row = raw as { seq: string | number; doc: unknown };
      return { kind: SIGNING_EVENT_KIND, seq: Number(row.seq), doc: row.doc };
    });
  };

  // The read backend the local-backend factory dispatches (the pg-backed shape, mirroring devApi.ts's
  // PgBackend reads). The verdict/activity overlays are WIRED (ADR-0119 deferred overlay)
  // — the SAME SQL the studio's PgBackend runs — so the desktop forest paints proof-health and
  // in-flight wisps identically to the hosted studio. (Self-reported presence retired, ADR-0200 D7 —
  // the session dock reads the claim ledger via /api/claims.)
  const backend: LocalBackendBackend = {
    listAssets: async () => {
      const docs = await library.queryDocs();
      // `superseded` is derived from the whole decision set's edges (ADR-0609 D3); the listing holds it.
      const context = { supersededDecisions: supersededDecisionNumbers(docs) };
      return docs.map((d) => renderStoredDoc(d, context));
    },
    health: async () => {
      // The code stamp + runtime status ride every health answer (both the ok + unreachable DB
      // branches) — the "checkout moved" / "behind main" signals are independent of DB state. Advisory:
      // the code stamp is undefined when git can't answer; the runtime status is omitted only when BOTH
      // its fields are null (a partial answer still rides, an honest under-report).
      const code = (await codeStampProbe()) ?? undefined;
      const rs = await runtimeStatusProbe();
      // Stamp `pinned` so the renderer shows the "N behind main — rebuild & relaunch" update banner only
      // for the installed pinned-runtime app (where the rebuild PULLS), never the dev launch fallback.
      const runtime =
        rs.branch !== null || rs.behind !== null ? { ...rs, pinned: pinnedRuntime } : undefined;
      let db: "ok" | "unreachable";
      try {
        await pool.query("select 1");
        db = "ok";
      } catch {
        db = "unreachable";
      }
      const envelope: Awaited<ReturnType<LocalBackendBackend["health"]>> = { db };
      if (code !== undefined) envelope.code = code;
      if (runtime !== undefined) envelope.runtime = runtime;
      return envelope;
    },
    // Latest signed verdict per unit (events.verdict DISTINCT ON unit_id) — the per-unit map the tree's
    // own-verdict layer attaches directly (story/cap `.verdict`).
    latestVerdicts: async () =>
      advisory("latest-verdicts", async () => {
        const res = await pool.query(
          `SELECT DISTINCT ON (unit_id) unit_id, outcome, at
             FROM events.verdict
            ORDER BY unit_id, seq DESC`,
        );
        const out: Record<string, { outcome: "pass" | "fail"; at: string }> = {};
        for (const raw of res.rows) {
          const row = raw as { unit_id: string; outcome: string; at: Date | string };
          if (row.outcome !== "pass" && row.outcome !== "fail") continue;
          out[row.unit_id] = { outcome: row.outcome, at: toIso(row.at) };
        }
        return out;
      }),
    // The RAW signed-verdict event stream — what the per-test crown roll-up
    // (rollupStoryGreen/rollupCapStatus) reads; advisory here (null on any failure).
    verdictEvents: async () => advisory("verdict-events", readVerdictEventRows),
    // The stored WORK-HIERARCHY projection (ADR-0445 D1) — the QUESTION half of the map's join, so it
    // shares a clock with the verdicts above instead of coming from the frozen `stories/**` copy that
    // ships inside this app. This is the wire that closes the incident: an installed app at an older
    // commit now asks TODAY's question, and a criterion re-worded since it was built stops reading as
    // unproven. Advisory like its neighbours — `null` on any failure, and the caller then degrades to
    // its runtime cache (never silently to disk).
    // NOT wrapped in `advisory(...)`, deliberately. That helper nulls on ANY failure, which would
    // collapse "the store holds no projection" (run the loader) into "the read failed" (look at the
    // store) — opposite remedies reported as one answer. `selectDesktopHierarchy` catches the throw
    // and states the real reason, so the tree still renders either way.
    workHierarchy: () => new PgWorkHierarchyStore(pool).readSnapshot(),
    // In-flight builds (ADR-0048): the latest `building` work-event per unit whose run has NOT yet
    // produced a signed verdict, TTL-filtered + phase-surfaced in JS — the orbiting-wisp layer. Mirrors
    // the studio PgBackend's inFlightBuilds query + its rowsToBuildActivity fold (re-composed here).
    inFlightBuilds: async () =>
      advisory("in-flight-builds", async () => {
        const res = await pool.query(
          // ADR-0138 §5: `doc->>'colourState'` rides alongside `phase` — the live subagent role tint
          // (advisory; null on a pre-ADR-0138 mark). Mirrors the studio PgBackend.inFlightBuilds SQL.
          `WITH latest_building AS (
             SELECT DISTINCT ON (unit_id)
               unit_id, tier, doc->>'runId' AS run_id, doc->>'phase' AS phase,
               doc->>'colourState' AS colour_state, at
             FROM events.work_event
             WHERE type = 'building'
             ORDER BY unit_id, seq DESC
           )
           SELECT lb.unit_id, lb.tier, lb.run_id, lb.phase, lb.colour_state, lb.at
             FROM latest_building lb
            WHERE lb.run_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM events.verdict v
                 WHERE v.unit_id = lb.unit_id AND v.run_id = lb.run_id
              )`,
        );
        const now = Date.now();
        const out: {
          unitId: string;
          tier: string;
          runId: string;
          at: string;
          phase?: string;
          colourState?: string;
        }[] = [];
        for (const raw of res.rows) {
          const row = raw as {
            unit_id: string;
            tier: string;
            run_id: string;
            phase: string | null;
            colour_state: string | null;
            at: Date | string;
          };
          const at = toIso(row.at);
          if (now - new Date(at).getTime() >= IN_FLIGHT_TTL_MS) continue; // past the TTL — cleared
          const phase = row.phase != null && GATE_PHASES.has(row.phase) ? row.phase : undefined;
          const colourState =
            row.colour_state != null && COLOUR_STATES.has(row.colour_state) ? row.colour_state : undefined;
          const build: (typeof out)[number] = {
            unitId: row.unit_id,
            tier: row.tier,
            runId: row.run_id,
            at,
          };
          if (phase !== undefined) build.phase = phase;
          if (colourState !== undefined) build.colourState = colourState;
          out.push(build);
        }
        return out;
      }),
    // In-flight story CLAIMS (ADR-0138 / ADR-0200 D7): every live events.node_claim row folded into a
    // claimed-but-not-proven map activity (`kind: "claim"`) — the coordination wisp layer, sibling to
    // inFlightBuilds. The PK is COMPOSITE `(unit_id, session_id)` under the graded ledger (ADR-0200 D2 —
    // shared exploring/waiting rows coexist with the one work row), so a unit may fold to several wisps
    // (one per session); still no DISTINCT ON — each live row IS current state. The SQL + the fold (stale
    // drop, §5 `kind: "claim"`, grade normalisation) are the pure src/backend/claim-activity.ts module,
    // red-green in claim-activity.test.ts — the studio's inFlightClaims + claimsToActivity re-composed
    // there rather than imported (the surface boundary). Keeping BOTH halves in that one module is what
    // stops the SELECT drifting from the reader again: it shipped without `grade`, so every claim reached
    // the map grade-less and the frontend's `?? 'work'` default made hovers/queues orbit the whole island.
    // claim-wisp-cold-start (FIX 2b): the CLAIMS read alone gets a softer per-read budget — a larger
    // timeout + one retry — so a just-taken claim survives a DB cold-start that exceeds the shared 4s
    // (the fresh wisp is not silently dropped). The other four reads keep the shared 4s so /api/tree
    // never waits longer for them. Still advisory: a genuinely down DB nulls promptly (bounded retry).
    inFlightClaims: async () =>
      advisory(
        "in-flight-claims",
        async () => {
          const res = await pool.query(IN_FLIGHT_CLAIMS_SQL);
          return claimRowsToActivity(res.rows as DesktopClaimRow[], new Date());
        },
        { timeoutMs: 15_000, retryOnce: true },
      ),
    // EVERY live claim row (ADR-0200 D7 — the session dock's claims-grouped-by-session view): the raw
    // ClaimDocT[] from events.node_claim via PgClaimStore.listLiveClaims (staleness-filtered in SQL),
    // which the /api/claims handler folds through the pure groupClaimsBySession. Advisory (null on any
    // failure), the SAME contract as activeSessions — mirrors the studio PgBackend.sessionClaims
    // (re-composed here, the surface boundary — no apps/studio/server import, ADR-0100).
    // Recent claim DEPARTURES (ADR-0200 D7 — wisp-out legibility): the window-bounded `released` read
    // over events.claim_event, folded by the pure `foldDepartures`. A released claim renders as "someone
    // just left" for DEPARTURE_WINDOW_MS instead of vanishing indistinguishably from a lost/stale claim
    // (the friction-released-build-wisp-reads-as-lost-claim item). Mirrors the studio
    // PgBackend.inFlightDepartures — the store's already-tested SQL + the shared fold, no hand-rolled
    // query. Advisory like every read here: a courtesy layer, silently absent when the store can't answer.
    inFlightDepartures: async () =>
      advisory("in-flight-departures", async () =>
        foldDepartures(await claimLedger.recentDepartures(DEPARTURE_WINDOW_MS), new Date()),
      ),
    // EVERY STANDING claim row, stale ones INCLUDED (ADR-0535 D1) — `listAllClaims()`, the read the
    // CLI board already took, so the dock cannot be handed an absence the command line marks as a
    // stale row. Changed in lockstep with the studio's PgBackend.sessionClaims: the mirror-
    // conformance row for /api/claims injects at THIS seam, so a one-sided swap would leave the two
    // surfaces answering the same question from different row sets while the harness stayed green.
    sessionClaims: async () => advisory("session-claims", async () => claimLedger.listAllClaims()),
    // The library DOCUMENT STORE behind GET /api/arcs (ADR-0267 / ADR-0314) — the live PgLibraryStore
    // built above, handed straight to drive's arc rollup. Mirrors the studio PgBackend.docStore
    // (re-composed here, the surface boundary — no apps/studio/server import, ADR-0100), and it is the
    // SAME `Store` the CLI drives under `--pg`, so the desktop arc lens, the hosted studio and
    // `storytree arc show` all read one join.
    //
    // DELIBERATELY NOT WRAPPED IN `advisory`, unlike every read above it. Those return a VALUE and
    // null-on-failure is an honest under-claim; this returns the STORE ITSELF, and `null` here means
    // something else entirely — "this backend has no document store" (the offline json posture), which
    // the route answers with `{ arcs: null }` / 503. Nulling it on a transient DB blip would tell the
    // owner their machine has no store at all rather than surfacing the failure.
    docStore: async () => library,
  };

  // The THREE dispatchers the Electron main mounts in sequence (ADR-0119 §2 + the chat-SSE increment):
  // the boot-read router first (me/docs/comments), then the chat-SSE mount (POST /api/chat), then the
  // local-backend handler (health/tree/assets + its own 404 fall-through). Each returns false for paths
  // it does not own, so the chain resolves to the first dispatcher that claims the request.
  const bootRoutes = createBootReadRoutes({
    docsDir,
    listComments: async (filter) => {
      interface FShape { topicId?: string; topicKind?: "doc" | "asset" }

      const f: FShape = {};
      if (filter?.topicId) f.topicId = filter.topicId;
      if (filter?.topicKind === "doc" || filter?.topicKind === "asset") f.topicKind = filter.topicKind;
      return comments.list(f);
    },
  });

  // The chat surface (chat-sse-mount, ADR-0108 Phase 2 / ADR-0091 read-propose-only): POST /api/chat
  // starts a live session-orchestrator session via startChatStream and streams its done/error/refused
  // events as SSE. No queryFn → the real SDK query() (CLAUDE_CODE_OAUTH_TOKEN hydrated by loadLocalSecrets
  // above); the mount loads the seed corpus internally to render the session-orchestrator prompt.
  //
  // THE ORIENTATION SEAM (closing the old boundary fork): the session's read-only orientation tools
  // (tree/library/noticeboard) dispatch through @storytree/drive's createOrientationRunner — the
  // drive-resident composition of the SAME three read commands the terminal CLI serves (the CLI's
  // run() itself stays in @storytree/cli, which this sidecar may not import; ADR-0112) — composed
  // here over the LIVE stores: the pg library store (dashboard) and the stories/ dir + signed-verdict
  // log (tree). (The presence store is no longer wired — self-reported presence retired, ADR-0200 D7;
  // the noticeboard view renders offline-silently, the claim ledger is the coordination read.) The
  // verdict read
  // shares readVerdictEventRows with the forest overlays; a down DB throws inside the reader and the
  // tree renders with the proof columns silently absent (the offline-silent contract),
  // never a hung tool. Attestation vouch-marks are not wired here (no attestation read in this
  // sidecar yet) — that column is silently absent, an honest under-claim. READ/PROPOSE only either
  // way: the runner carries no write verb (the Phase-2 wall, ADR-0091).
  const orientationRunner = createOrientationRunner({
    store: library,
    storiesDir,
    verdicts: { readEvents: readVerdictEventRows },
  });

  // ---------- /api/uat/attest (POST — local human proof, persisted through IAP broker) ----------
  //
  // EXTRACTED, not re-implemented: the whole mount moved verbatim to
  // apps/desktop/src/backend/uat-attest-route.ts and is COMPOSED here over this process's live
  // seams. It was an inline closure in this function, so nothing outside a booted Electron backend
  // could call it — which is why `check:mirror-conformance` had no way to compare the highest-stakes
  // WRITE in the system against the studio's `POST /api/uat/attest` that it is a hand-written copy
  // of (ADR-0495 / `unscored-guards-arc`). The `attestations-route.ts` extraction one increment
  // earlier had exactly this shape, for exactly this reason.
  const uatAttestMount = createUatAttestMount({
    storiesDir,
    // The broker identity, asked of the Electron main process — never a request field.
    resolveSigner: () => requestElectronMain<string>({ type: "broker:identity" }),
    gitState: currentGitState,
    agentIdentity: () => deriveChatIdentity(repoRoot)?.sessionId ?? null,
    forestWriter: brokeredForestWriter,
    now: () => new Date().toISOString(),
  });

  // ---------- /api/attestations (GET — member-readable UAT test list) ----------
  //
  // Re-composed from @storytree/orchestrator — no apps/studio/server import (ADR-0100 boundary).
  // Serves the same payload the studio's GET /api/attestations produces: a story's UAT test criteria
  // with their per-test attestation marks and proven state (from signed verdicts). Used by the
  // shared UatTestCriteriaSection component when a story node is clicked. Advisory (null on any DB
  // failure) — returns `{ storyId, tests: [] }` gracefully rather than crashing.
  // OPERATOR-ATTESTED GLUE (ADR-0070): the CI-proven cores are the orchestrator functions and
  // PgAttestationStore this wiring threads together; this route wiring is proven transitively.
  // EXTRACTED, not re-implemented: the whole composition moved verbatim to
  // apps/desktop/src/backend/attestations-route.ts and is COMPOSED here over this process's live
  // seams. It was an inline closure in this function, so nothing outside a booted Electron backend
  // could call it — which is why `check:mirror-conformance` had no way to compare it against the
  // studio payload it is a hand-written copy of, and why `mirror-pair-drift` had been naming the
  // pair as unobserved since its sweep widened to `apps/desktop/electron`. The module's header
  // carries the boundary call and the two divergences the row's first run measured.
  const attestationsMount = createAttestationsMount({
    storiesDir,
    readAttestationEvents: () => attestations.readEvents(),
    // Advisory, same contract as /api/tree's: null on any failure, so the two proof-derived fields
    // go ABSENT rather than negative.
    readVerdictEvents: () => advisory("attestations-verdicts", readVerdictEventRows),
  });

  // ---------- the chat SPAWN surface: RETIRED, composed nowhere (ADR-0175) ----------
  //
  // ADR-0137 Phase 3 composed the real spawn deps here and threaded them into the chat mount, so the
  // desktop session-orchestrator gained SPAWN power: `spawn_story_author` to bring a story in and
  // `spawn_builder` to drive a change red→green, each behind the claim gate, over the live pg library
  // store, the live claim store, the ADR-0033 session identity, and the routed BuildContext.
  // ADR-0175 retires all of it — the same split that took the landing surface below: the SSE
  // transport, dock, continuity and read-only inspect surface are RE-AIMED under the `app-guide`
  // concierge, while "the spawn and landing surfaces (which drove story work) do not belong to a help
  // agent and retire with the interactive orchestrator" (ADR-0174). The stories/**-only reconcile
  // deferred the code half to a separate thin PR (stories/headless-orchestrator/story.md); this is
  // its spawn slice — the modules themselves are deleted, not merely unwired.
  //
  // `spawn_glue_worker`, the third tool that once sat on that server, was already retired ahead of
  // the other two as ADR-0175's stated ONE exception (amending ADR-0160): the embedded terminal
  // makes glue edits natively, so the actuator's whole reason for being was gone.
  //
  // It had no reachable caller either: `ChatDock` — the only mount of `ChatPanel`, itself the only
  // caller of POST /api/chat — is imported by nothing in the production tree (`TerminalDock` took its
  // dock slot under ADR-0174), and `storytree orchestrate` passes no spawn deps. Nothing re-composes
  // it: see the negative guard at apps/desktop/src/backend/spawn-surface-retired.test.ts.
  //
  // The session identity below is still derived — the INSPECT surface's degrade-quiet arm keys on it.
  const identity = deriveChatIdentity(repoRoot);
  let inspect: InspectSurfaceDeps | undefined;
  if (identity === null) {
    console.error(
      "[backend-entry] no session identity (git unreachable) — chat mounts read/propose only, no inspect surface",
    );
  } else {
    // ---------- the chat LANDING surface: RETIRED, composed nowhere (ADR-0175) ----------
    //
    // ADR-0152 composed a merge-ceremony surface here (run the gate; commit → push → open a NON-DRAFT
    // PR CI auto-merges) to bring this sidecar to parity with the terminal session-orchestrator.
    // ADR-0174 then retired the in-app INTERACTIVE orchestrator for an embedded terminal running real
    // Claude Code, and ADR-0175 split what remained: the SSE transport, dock, continuity and the
    // read-only inspect surface are RE-AIMED under the `app-guide` concierge, while "the spawn and
    // landing surfaces (which drove story work) do not belong to a help agent and retire with the
    // interactive orchestrator". The stories/**-only reconcile deferred the code half to a separate
    // thin PR (stories/headless-orchestrator/story.md); this is its landing slice — the modules
    // themselves are deleted, not merely unwired.
    //
    // AND THE SHAPE IS NOW DOCTRINALLY DEAD TOO (ADR-0163 D3 Gap B1 / ADR-0271). The retired
    // `open_landing_pr` did more than open a PR: on a confirmed already-merged branch it minted a
    // fresh-branch slug here, cut `claude/<slug>`, and re-lit the wisp so the session could keep
    // working — Gap B1's shipped remedy (PR #608) over ADR-0142's post-merge leg. ADR-0271 (amending
    // ADR-0142) ended that: a session's working life ENDS where its PR merges, and new work re-enters
    // through a fresh SESSION, not a fresh branch. Because this sidecar renders the SAME
    // `session-orchestrator` agent the terminal does, leaving the tool wired held a live
    // self-contradiction inside one session. Nothing re-composes it: see the negative guard at
    // apps/desktop/src/backend/landing-surface-retired.test.ts.

    // ---------- the chat INSPECT surface (ADR-0173 — the read-only CI/git inspection surface) ----------
    //
    // Compose the REAL inspect deps and thread them into the chat mount so the desktop
    // session-orchestrator gains DIAGNOSIS — read a failing-job log (`gh run view --log-failed`), an
    // arbitrary PR's checks (`gh pr checks` / `gh pr view`), and the read-only git verbs
    // (`git status`/`log`/`ls-tree`/`rev-parse`/`show`) — so a blind chat can root-cause a red pipeline
    // itself instead of theorising and escalating a confident-but-wrong fix (the PR #650 stale-pin
    // misdiagnosis ADR-0173 was decided on). buildInspectDeps composes over the SAME repo cwd the
    // spawn deps derive; OMIT `exec` so the real, TIME-BOXED `child_process` spawn runs
    // (@storytree/drive's defaultInspectExec — git/gh pass through, a 60s wall so a slow gh can't hang
    // the turn).
    //
    // OBSERVATION ONLY (ADR-0173 invariant 1 / 4): the chat still carries `tools: []`; the inspect
    // verbs are named READS, never a raw Bash. `git_inspect` refuses any non-read verb before shelling,
    // and the id-taking tools refuse a flag-like id — so no mutating `gh`/`git` command is reachable.
    // No merge/push/sync/pin. It signs nothing (the spine signs, CI is the independent gate).
    //
    // OPERATOR-ATTESTED GLUE (like the build path above): the CI-proven core is
    // buildInspectDeps (packages/drive/src/inspect-deps.test.ts, over an injected exec seam) and the
    // mount's inspect forwarding (chat-sse-mount.test.ts, over a double); this file composes the real
    // pieces. FAIL-CLOSED / DEGRADE-QUIET: a blank cwd is refused by buildInspectDeps before any deps
    // are built (typed { ok:false }); on refusal the chat mounts WITHOUT the inspect surface — the
    // inspect power is additive, its absence never breaks the read/propose chat.
    const inspectComposed = buildInspectDeps({ cwd: repoRoot });
    if (inspectComposed.ok) {
      inspect = inspectComposed.deps;
      console.error(
        `[backend-entry] inspect surface composed — chat can read CI logs + PR checks + git (repo ${repoRoot})`,
      );
    } else {
      console.error(
        `[backend-entry] inspect surface NOT composed (chat stays read/propose only): ${inspectComposed.error}`,
      );
    }
  }
  // The orchestrator SESSION turn cap (ADR-0151): UNBOUNDED by default — the desktop chat is the
  // human-watched session-orchestrator loop, so a fixed cap that false-fails a healthy long
  // orient/propose costs more than it protects. resolveOrchestratorMaxTurns returns undefined unless
  // the operator RE-imposes a cap via STORYTREE_ORCHESTRATOR_MAX_TURNS (a bounded/debug run); undefined
  // → no maxTurns forwarded → the SDK runs unbounded. It is the only per-session brake left here: the
  // chat-spawned story-author's own ceiling retired with the spawn surface (ADR-0175), and the
  // inner-loop builder leaf keeps the generic 16-turn brake in its own runner (ADR-0130 unchanged).
  const orchestratorMaxTurns = resolveOrchestratorMaxTurns(process.env.STORYTREE_ORCHESTRATOR_MAX_TURNS);
  const chatMountDeps: ChatSseMountDeps = { runner: orientationRunner };
  if (inspect !== undefined) chatMountDeps.inspect = inspect;
  if (orchestratorMaxTurns !== undefined) chatMountDeps.maxTurns = orchestratorMaxTurns;
  const chatMount = createChatSseMount(chatMountDeps);
  // GLUE (ADR-0158): mount the reset dispatcher beside its sibling. The capability
  // `backend-chat-reset-route` is proven as a dispatcher FACTORY (verdict @ 5445a18, coverage 2/2);
  // neither of its contracts covers the wiring, so this line is un-asserted connective code — but
  // without it the route 404s and the outcome's "recoverable without restarting the app" is not
  // actually delivered. It takes no deps and must sit BEFORE localHandler's 404 fall-through.
  const chatResetMount = createChatResetMount();

  // The context-traversal replay panel's three local-file reads (`traversal-panel-arc`, increment
  // `desktop-serves-the-traversal-routes`): GET /api/traversal, /api/traversal/sessions and
  // /api/context-windows. The Traversal tab ships in the same compiled studio bundle this backend
  // serves, and until this mount existed all three fell through to localHandler's catch-all
  // `unknown endpoint` — the tab was mounted and broken on the surface the owner actually drives.
  // The trace dir and transcript root stay ambient (`STORYTREE_TRAVERSAL_DIR` /
  // `STORYTREE_TRANSCRIPT_DIR` overriding); the CORPUS is not, so the document store is injected —
  // the sessions index resolves each session's recorded unit to the ARC it belongs to (ADR-0541 D1),
  // and the studio's copy of this route reads `backend.docStore` at the same seam. It must sit
  // BEFORE localHandler's 404 fall-through.
  const traversalRoutes = createTraversalRoutes({ docStore: backend.docStore });
  // Pull the three traversal packages and build the trace index NOW, while the window is still
  // opening, rather than on the first request an operator makes — the studio's own `primeTraversalIndex`
  // move, and the same measured reason: the lazy imports are most of a cold read's ~6 s.
  // Fire-and-forget; it swallows its own faults.
  void primeTraversalRoutes();

  const localHandler = createLocalBackend({ storiesDir, docsDir, backend, store: "pg" });

  // The auth / CSRF / DNS-rebinding wall (loopback-guard, ADR-0119 §1 hardening). The sidecar binds an
  // ephemeral 127.0.0.1 port, which stops LAN reach but is NOT an auth boundary: any web page the user
  // visits can port-scan localhost and fire a CORS-simple POST at a side-effecting route (POST /api/chat
  // starts an autonomous session-orchestrator; POST /api/uat/attest mutates). So EVERY
  // state-mutating request must be same-origin (loopback Origin), loopback-Host (defeats DNS rebinding),
  // AND carry the per-launch secret the trusted static-server proxy injects (STORYTREE_SIDECAR_TOKEN) —
  // a request reaching this port by any path other than our proxy is refused. Read-only GET/HEAD stay
  // lenient. The token is empty only in a mis-spawn (main always sets it); then Origin/Host still gate.
  const sidecarToken = (process.env.STORYTREE_SIDECAR_TOKEN ?? "").trim() || undefined;

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      try {
        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
        const guard = guardHttpRequest(req, { expectedToken: sidecarToken });
        if (!guard.ok) {
          res.statusCode = guard.status;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify({ error: guard.reason }));
          return;
        }
        if (await bootRoutes(req, res, pathname)) return;
        if (await chatMount(req, res, pathname)) return;
        if (await chatResetMount(req, res, pathname)) return;
        if (await traversalRoutes(req, res, pathname)) return;
        if (await uatAttestMount(req, res, pathname)) return;
        if (await attestationsMount(req, res, pathname)) return;
        await localHandler(req, res);
      } catch (err) {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
      }
    })();
  });

  const port = await announce(server);
  console.error(`[backend-entry] thick-local backend listening on 127.0.0.1:${port} (repo ${repoRoot})`);

  installShutdown(server, async () => {
    await closePool(pool, connector);
  });
}

main().catch((err: unknown) => {
  console.error(`[backend-entry] failed to start: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
