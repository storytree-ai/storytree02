#!/usr/bin/env -S tsx
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { HttpStore, type Store } from "@storytree/storage-protocol";
import {
  createPool,
  closePool,
  PgLibraryStore,
  PgAdrStore,
} from "@storytree/library/store";
import {
  captureCliInvocation,
  captureIdentityOf,
  isTraversalCaptureEnabled,
  resolveAgentDescent,
  resolveTraceIdentity,
  resolveTraversalDir,
} from "@storytree/context-traversal-capture";

import { claimedUnitsRecorderFor } from "./claimed-units-trace.js";
import {
  isShipChildProcess,
  markShipAttempt,
  PgTraversalEventStore,
  shouldStartShip,
  SHIP_CHILD_ENV,
  SHIP_WATCHDOG_MS,
} from "@storytree/context-traversal-capture/store";
import type { TraversalEventStore } from "@storytree/context-traversal-capture/store";
import type {
  CaptureCliInvocationInput,
  TraceIdentity,
} from "@storytree/context-traversal-capture";
import { digestOverlapDeltas, type OverlapDelta } from "@storytree/notice-board";
import { PgClaimStore } from "@storytree/notice-board/store";
import { PgWorkStore, PgAttestationStore } from "@storytree/orchestrator/store";
import { PgUserStore } from "@storytree/studio-members/store";

import type { AdrAllocatorLike } from "./adr.js";
import type { AttestationStoreLike } from "./attest.js";
import { isRawEnvelope, run } from "./commands.js";
import type { RunDeps } from "./commands.js";
import { formatEnvelope, withDeltaFooter, type Envelope } from "./envelope.js";
import { sessionPopulationSince } from "./resteer-session-population.js";
import {
  createClaimUniverseLoader,
  deregisterSpawn,
  deriveIdentity,
  openCorpusStore,
  registerSpawn,
  REPO_MANIFEST_TREE,
  repoRoot,
  resolveStoreDoor,
} from "@storytree/drive";
import type { OpenCorpusStore } from "@storytree/drive";
import type { ClaimLedgerStoreLike, SessionClaimStoreLike } from "@storytree/drive";
import { loadLocalSecrets } from "./secrets.js";
import type { VerdictReaderLike } from "./tree-verdicts.js";
import type { MemberStoreLike } from "./members.js";
import type { WorkLogReaderLike } from "./work-log.js";
import type { UatVerdictStoreLike } from "./uat.js";
import { defaultNodePeekDeps } from "./node-peek.js";

/**
 * The `storytree` CLI entry (ADR-0023). ONLINE-ONLY since ADR-0302 D1/D2: every store below is the
 * live corpus, because there is no longer a second one. The dispatch lives in `run`; this file only
 * wires the store and prints the envelope.
 *
 * THREE store shapes, one source, in this precedence:
 *   `--pg`                       → the Cloud SQL connector WITH the write seams (claims, verdicts,
 *                                  attestations, the ADR allocator). The only writing branch.
 *   `STORYTREE_STORE_URL` set    → the ADR-0259 store door over ordinary HTTPS — the read path for a
 *                                  client that cannot open a Cloud SQL connector at all, which is
 *                                  every remote session (ADR-0258 D2). Read-only by the door's own
 *                                  decision (ADR-0259 D5).
 *   neither                      → the same live store, read-only, opened LAZILY on first use, so a
 *                                  command that reads no corpus (`adr list`, `doctor`, the help
 *                                  surfaces) never dials the connector at all.
 *
 * What used to sit in that third slot was an `InMemoryStore` seeded from the committed corpus. That
 * seed is deleted; the hermetic suites read `@storytree/library/fixture` instead, and nothing in a
 * PRODUCTION path reads a file corpus any more.
 */
async function buildStore(usePg: boolean): Promise<{
  store: Store;
  claims: SessionClaimStoreLike | null;
  ledger: ClaimLedgerStoreLike | null;
  verdicts: VerdictReaderLike | null;
  /** The row-level work-event read (`node log`, ADR-0350 D3); null off --pg. */
  workLog: WorkLogReaderLike | null;
  uatStore: UatVerdictStoreLike | null;
  /** The orchestrator's attempt ledger (ADR-0576 D3); null off --pg. */
  attemptLedger: Store | null;
  attestations: AttestationStoreLike | null;
  /** The studio member directory (ADR-0043) — `storytree members`; null off --pg (no door, no offline form). */
  members: MemberStoreLike | null;
  adr: AdrAllocatorLike | null;
  /**
   * The SHARED context-traversal log (ADR-0484 D1) — `storytree traversal ship`; null off --pg.
   *
   * It rides the pool `--pg` ALREADY opened and never opens one of its own, which is the whole of
   * how ADR-0484 D4's "a bare read must not open a pool it did not already need" is held here: off
   * this branch the seam is simply absent, and the ship verb refuses.
   */
  traversalEvents: TraversalEventStore | null;
  /** The cursor-once overlap-delta pull (ADR-0200 D4); null offline — no footer surface. */
  pullDeltas: ((sessionId: string) => Promise<OverlapDelta[]>) | null;
  close: () => Promise<void>;
}> {
  if (usePg) {
    const { pool, connector } = await createPool();
    // One PgWorkStore over the live pool serves both reads (verdict glyphs, rollup) and the
    // `uat attest` WRITE — it satisfies the read-only VerdictReaderLike and the write-capable
    // UatVerdictStoreLike alike, so the same instance is passed under both seams.
    const work = new PgWorkStore(pool);
    // One PgClaimStore over the live pool serves both claim seams: the declare/done glue
    // (SessionClaimStoreLike, ADR-0142) and the graded ledger verbs (ClaimLedgerStoreLike,
    // ADR-0200 D2 — claim / upgrade / downgrade / release / claims).
    const claimStore = new PgClaimStore(pool);
    return {
      store: new PgLibraryStore(pool),
      // The write-claim store (ADR-0142 claim-at-declare): `noticeboard declare --node` takes the
      // work-time claim (the story wisp) and `done` bulk-releases, over the same pool. Presence is
      // RETIRED (ADR-0200 D7) — the claim ledger is the one session surface.
      claims: claimStore,
      ledger: claimStore,
      // The verdict event log (verdict-glyphs): the tree's glyph column reads events.verdict
      // through the same pool; offline the column is silently absent.
      verdicts: work,
      // The SAME PgWorkStore under a wider seam: `node log` renders whole rows (actor, at, and the
      // optional causal edge), which the glyph-shaped VerdictReaderLike does not carry.
      workLog: work,
      // The per-test UAT write surface (ADR-0082): `uat attest` appends a signed operator-attested
      // verdict to events.verdict through the same work store; offline `uat attest` refuses.
      uatStore: work,
      // The orchestrator's attempt ledger (ADR-0576 D3): `node attempts|grant|adjudicate` read and
      // append raw events through the same PgWorkStore/pool as `uatStore` above; offline the ledger
      // verbs refuse rather than reading or writing nothing.
      attemptLedger: work,
      // The attestation log (ADR-0044): `storytree attest` records/reads events.attestation
      // through the same pool; offline `attest` refuses (writes/reads both need --pg).
      attestations: new PgAttestationStore(pool),
      // The studio member DIRECTORY (ADR-0043): `storytree members` writes through the SAME
      // PgUserStore the studio's /api/users handler uses, so the last-admin guard and the audit
      // append apply identically rather than being re-implemented beside them.
      members: new PgUserStore(pool),
      // The ADR-number allocator (ADR-0050): `storytree adr new` reserves the next number through
      // events.adr_number on the same pool; offline it falls back to max+1 with a loud warning.
      adr: new PgAdrStore(pool),
      // The shared traversal event log (ADR-0484 D1): `storytree traversal ship` drains this
      // machine's local JSONL traces into events.traversal_event over the same pool. Nothing on a
      // command's own path reads this seam — the capture path writes locally and returns.
      traversalEvents: new PgTraversalEventStore(pool),
      // The cursor-once overlap-delta pull (ADR-0200 D4): every --pg command's envelope render
      // piggybacks the deltas that touch this session's own claims — see main() below.
      pullDeltas: (sessionId: string) => claimStore.pullOverlapDeltas(sessionId),
      close: () => closePool(pool, connector),
    };
  }
  // The STORE DOOR (ADR-0259 D1): ordinary HTTPS to the studio's `/api/store`, which is the only
  // shape a remote session can reach — it cannot dial Cloud SQL at all (ADR-0250 / ADR-0258 D2), and
  // ADR-0302 D1/D2 decommit the offline seed below. Read-only by the door's own decision (writes are
  // 403 there, ADR-0259 D5), so every write seam stays null exactly as it does offline, and a write
  // command refuses with its existing "needs --pg" message rather than a confusing 403 from the wire.
  const door = resolveStoreDoor(process.env);
  if (door) {
    return {
      store: new HttpStore(door),
      claims: null,
      ledger: null,
      verdicts: null,
      workLog: null,
      uatStore: null,
      attemptLedger: null,
      attestations: null,
      members: null,
      adr: null,
      traversalEvents: null,
      pullDeltas: null,
      close: async () => {},
    };
  }
  // NO FLAG, NO DOOR — the live store, read-only, and opened LAZILY. The committed seed that used
  // to answer here is GONE (ADR-0302 D1), and the two shapes it could have been replaced by are
  // both wrong: an EMPTY in-memory store would report `no artifact "x"` for artifacts that plainly
  // exist — the exact fail-open ADR-0259's door rule was written against — and a refusal telling
  // the reader to add `--pg` would be a papercut on the most-used verb in the CLI for a flag that,
  // with one corpus left, carries no information about WHERE to read.
  //
  // LAZY IS NOT AN OPTIMISATION, IT IS THE CORRECTNESS CONDITION. `buildStore` runs before dispatch,
  // for EVERY command — including the many that never touch the corpus (`adr list`, `doctor`,
  // `noticeboard`, the help surfaces). Opening the connector eagerly would put a ~7 s Cloud SQL
  // handshake, and a hard dependency on the database, in front of commands that read nothing but
  // disk. It would also make `pnpm -r test` non-hermetic wherever a suite spawns the real binary,
  // which ADR-0302 D3 deliberately prevents. So the pool opens on the FIRST store call and not
  // before, and a command that makes none never dials at all.
  //
  // `--pg` keeps the meaning it always had for WRITES: it is the branch above, the only one that
  // returns the claim / verdict / attestation / ADR-allocator seams. Those stay null here, so
  // `library artifact edit` (and every other write) refuses with its existing "needs --pg" message
  // rather than acquiring write power by accident.
  //
  // Unreachable is a LOUD, named failure carrying the remedy — never a degraded success.
  let opened: OpenCorpusStore | null = null;
  const open = async (): Promise<Store> => {
    opened ??= await openCorpusStore("storytree");
    return opened.store;
  };
  return {
    store: lazyStore(open),
    claims: null,
    ledger: null,
    verdicts: null,
    workLog: null,
    uatStore: null,
    attemptLedger: null,
    attestations: null,
    members: null,
    adr: null,
    traversalEvents: null,
    pullDeltas: null,
    close: async () => {
      if (opened !== null) await opened.close();
    },
  };
}

/**
 * A {@link Store} that opens its backing store on the first call and not before.
 *
 * Every method just forwards, so this adds no behaviour of its own — including errors: an
 * unreachable store throws `openCorpusStore`'s full remedy message out of whichever call first
 * needed it, which is the command that actually wanted the corpus rather than the process start.
 */
function lazyStore(open: () => Promise<Store>): Store {
  return {
    upsertDoc: async (input) => (await open()).upsertDoc(input),
    patchDoc: async (input) => (await open()).patchDoc(input),
    getDoc: async (id) => (await open()).getDoc(id),
    queryDocs: async (filter) => (await open()).queryDocs(filter),
    deleteDoc: async (id, opts) => (await open()).deleteDoc(id, opts),
    appendEvent: async (e) => (await open()).appendEvent(e),
    readEvents: async (filter) => (await open()).readEvents(filter),
  };
}

/** Time budget for the delta footer's store read — a slow DB never stalls the command's output. */
const DELTA_FOOTER_TIMEOUT_MS = 3_000;

/**
 * Piggyback the cursor-once overlap deltas on the envelope this command already renders
 * (ADR-0200 D4 — deltas ride outputs the agent already reads; never a schedule). FAIL-SILENT by
 * contract: no worktree identity (the lobby, CI), a delta-read error, or a slow DB (time-boxed)
 * all return the envelope UNCHANGED — a courtesy footer never fails or stalls a command.
 */
async function attachDeltaFooter(
  env: Envelope,
  pullDeltas: ((sessionId: string) => Promise<OverlapDelta[]>) | null,
): Promise<Envelope> {
  if (pullDeltas === null) return env;
  try {
    const identity = deriveIdentity();
    if (identity === null) return env;
    const timeout = new Promise<OverlapDelta[]>((resolve) => {
      setTimeout(() => resolve([]), DELTA_FOOTER_TIMEOUT_MS).unref();
    });
    const deltas = await Promise.race([pullDeltas(identity.sessionId).catch(() => []), timeout]);
    return withDeltaFooter(env, digestOverlapDeltas(deltas));
  } catch {
    return env; // fail-silent — the footer is a courtesy, the command's envelope is the payload
  }
}

/**
 * Ambient, metadata-only capture of this invocation's allowlisted READS (ADR-0235 / ADR-0241).
 *
 * FAIL-SILENT and ADDITIVE by contract, exactly like {@link attachDeltaFooter} above: it runs after
 * the envelope has already been written and the exit code already set, so nothing here can alter
 * what the command produced. It is SYNCHRONOUS and never awaits a network or DB path — `main` runs
 * on EVERY invocation, including the gate's own internal calls (ADR-0162 startup budget).
 *
 * Identity resolves in {@link resolveInvocationIdentities} and is passed in. A null identity
 * captures nothing — silently, since an uninstrumented run is a normal outcome, not an error. It
 * resolves in `main` rather than here because the offer-id plan (ADR-0260 D3) needs the same answer
 * BEFORE the render; it is still exactly ONE derivation per invocation.
 */
interface InvocationIdentities {
  /**
   * The WORKTREE identity — the spawn registry's key and the delta footer's session (`storytree
   * own`, ADR-0200 D4). Slot-grained on purpose: those two ask "which worktree is running this?",
   * which is exactly what a slot answers.
   */
  readonly registry: { sessionId: string; branch: string } | null;
  /**
   * The TRACE identity — one context WINDOW, or null to capture nothing
   * (`linked-session-context-arc-inc-30`). Deliberately NOT the registry identity above: a slot is
   * pooled across the parent session, its subagents, and every later session handed the same slot,
   * so keying a trace by it reports many windows' reads as one session's.
   *
   * It also carries WHICH AGENT HARNESS this process runs under and WHICH MACHINE it runs on — both
   * DETECTED here, from the process itself, and never declared. The machine is `os.hostname()`: the
   * box, not the "host" harness the older traversal vocabulary means by that word.
   */
  readonly trace: TraceIdentity | null;
}

/**
 * Resolve BOTH identities from ONE `deriveIdentity()` call.
 *
 * One call is a budget constraint, not tidiness: `deriveIdentity()` shells out to git, `main` runs
 * on every invocation including the gate's own internal calls, and ADR-0162's startup budget is
 * what that pays for. Deriving once and deriving twice would be indistinguishable in behaviour and
 * measurably different in cost.
 */
function resolveInvocationIdentities(): InvocationIdentities {
  try {
    const derived = deriveIdentity();
    const override = process.env["STORYTREE_SESSION_ID"];
    const registry =
      override !== undefined && override.trim().length > 0
        ? { sessionId: override, branch: derived?.branch ?? "" }
        : derived === null
          ? null
          : { sessionId: derived.sessionId, branch: derived.branch };
    return {
      registry,
      // Stryker disable next-line ObjectLiteral,OptionalChaining,LogicalOperator: NO COVERAGE BY
      // DESIGN — this is the composition root's one wire from the process into the pure resolver, and
      // `main.ts` has no in-process suite (it opens real stores). Both ends ARE tested: the
      // precedence, the harness detection and the host normalisation in `session-identity.test.ts`,
      // and this wiring END TO END by the spawned-CLI legs of `terminal-capture.uat.test.ts`, which
      // the mutation runner excludes by design (`isSpawnUatTest`). The only new operand is the host;
      // the slot expression beside it predates this change and was simply never on a changed line.
      trace: resolveTraceIdentity({ env: process.env, slot: derived?.sessionId ?? null, host: os.hostname() }),
    };
  } catch {
    return { registry: null, trace: null };
  }
}

/**
 * Register this invocation in the spawn registry, and hand back the de-registration
 * (`shared-box-session-ownership-arc` inc 1).
 *
 * WHY EVERY INVOCATION AND NOT JUST THE LONG ONES. The registry has to be able to answer "what am I
 * still running?" for the command that HUNG, and which command that will be is not knowable when it
 * starts. A `library artifact edit --pg` is the cheap one that hangs — measured on this box — and it
 * is also the one whose late commit silently reverts a field another session already corrected. So
 * the registration is unconditional and the cost is kept to what it must be: one `mkdir -p` and one
 * small `writeFileSync` at start, one `unlink` at exit, and NO extra `git` call — the identity is the
 * one `main` already derived for capture (ADR-0162's startup budget).
 *
 * FAIL-SILENT and ADDITIVE, like the delta footer and the traversal capture beside it: a `null`
 * identity (the primary checkout, CI) registers nothing, and a registry write that throws leaves the
 * command untouched and simply uninventoried — the state every run was in before this existed.
 *
 * ⚠ THE DETACHED TELEMETRY SHIPPER IS THE ONE DELIBERATE EXCEPTION (ADR-0484 D4). It runs in this
 * worktree and would therefore register under this session's identity — and `storytree own` is what
 * the closing leg asks before a session may call itself inert, where a LIVE row means "you are still
 * running something". The shipper is ambient telemetry the session did not start and cannot be asked
 * to wait for, so counting it would make every session's closing check answer BUSY for a process
 * nobody is holding. It is bounded by its own watchdog instead.
 */
function registerThisInvocation(
  argv: readonly string[],
  identity: { sessionId: string; branch: string } | null,
): () => void {
  if (identity === null) return () => {};
  if (isShipChildProcess(process.env)) return () => {};
  try {
    const filePath = registerSpawn({
      sessionId: identity.sessionId,
      branch: identity.branch,
      pid: process.pid,
      command: `storytree ${argv.join(" ")}`,
      cwd: process.cwd(),
      startedAt: new Date().toISOString(),
    });
    if (filePath === null) return () => {};
    return () => {
      deregisterSpawn(filePath);
    };
  } catch {
    return () => {};
  }
}

async function captureInvocation(
  argv: readonly string[],
  ok: boolean,
  store: Store,
  trace: TraceIdentity | null,
  observedResultIds: readonly string[] | undefined,
): Promise<void> {
  try {
    // An `agents <name>` essentials render resolves the agent's floor refs BY EXPLICIT ID, so each
    // one is a genuine within-process descent (ADR-0235 clause 2). Resolving needs an async store
    // read, and `captureCliInvocation` is contractually synchronous — so it happens here, inside the
    // existing try/catch and before `close()`. Every other dispatch shape resolves to [].
    //
    // Resolved against this invocation's argv exactly as the shell handed it over. Until ADR-0464 D1
    // there was a second, PRE-STRIPPED argv here, because a read answering an offer carried a
    // `--from-offer` flag the observer's allowlist would have refused. With no flag to carry there is
    // one argv again, and the two-argv seam that existed only to serve it is gone.
    const agentRefIds = await resolveAgentDescent(argv, store);
    const capture: CaptureCliInvocationInput = {
      argv,
      ok,
      // WHO is capturing, and what every line it writes will say about that: the session id, what
      // that id NAMES (its grade), the worktree slot beside it, and the harness and machine that
      // wrote it. `captureIdentityOf` owns which of those are stamped and which stay ABSENT — a
      // decision made there, where a test can reach it, rather than by a branch here, where none can.
      ...captureIdentityOf(trace),
      agentRefIds,
      // What a SEARCH-shaped read returned (ADR-0484 D3). The command computed it; the observer is
      // pure and could only get it by running the ranking a second time. Passed through as-is,
      // `undefined` included — the absent-vs-empty decision belongs where every other capture
      // attribute makes it, in the composition that writes the line.
      resultNodeIds: observedResultIds,
    };
    captureCliInvocation(capture);
    // The event is now DURABLE LOCALLY. Everything after this point is out of band: the ship is a
    // detached process this command does not wait for, and does not learn the outcome of
    // (ADR-0484 D4). Inside the same try/catch, on the same never-break-a-command rule.
    startTraversalShip(trace?.sessionId ?? null);
  } catch {
    // Telemetry never breaks a command — the envelope is the payload, and a trace that could not be
    // written must not reach the caller's control flow, exit code, or envelope (ADR-0241 D3).
    // "A courtesy" is withdrawn as too weak (ADR-0484 D4): what stands is that it never BLOCKS.
  }
}

/**
 * Start the out-of-band ship, if this invocation is the one that should (ADR-0484 D4).
 *
 * THE COMMAND DOES NOT WAIT. This spawns a DETACHED, unref'd process and returns; the event is
 * already durable in this machine's local trace, so losing the spawn loses nothing but latency. It
 * is the difference between "the log lives in Postgres" and "someone remembers to run a command".
 *
 * THE DECISION IS NOT HERE. `shouldStartShip` owns the five rules and is pure, testable and beside
 * the ship path it governs; what is left here is the one line that cannot be exercised without
 * starting a real process against a real database. That split is deliberate — a test of this
 * function would have to spawn, and a suite that spawns a `--pg` child reaches the live store.
 *
 * FAIL-SILENT throughout, on the capture path's own contract (ADR-0241 D3): a spawn that cannot
 * start leaves the backlog where it is, which `storytree traversal backlog` will report.
 */
function startTraversalShip(sessionId: string | null): void {
  try {
    const dir = resolveTraversalDir();
    const now = new Date();
    const start = shouldStartShip({
      sessionId,
      env: process.env,
      dir,
      now,
      captureEnabled: isTraversalCaptureEnabled(),
    });
    if (!start) return;
    // Marked BEFORE the spawn: a shipper that then hangs must not leave the machine unthrottled.
    markShipAttempt(dir, now);
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("../launch.mjs", import.meta.url)), "traversal", "ship", "--pg"],
      {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, [SHIP_CHILD_ENV]: "1" },
      },
    );
    child.unref();
  } catch {
    // Telemetry never breaks a command. An unstartable shipper is a backlog, not an error.
  }
}

/**
 * The CLI's async entry. Exported so the direct launcher (`packages/cli/launch.mjs`, ADR-0162
 * inc 2) can register the tsx loader in-process and call this WITHOUT re-spawning a second node
 * through pnpm — the launcher's `import.meta.url` is the launcher, not this file, so the
 * entry-guard below never fires under it. Still self-runs under `tsx src/main.ts` (the fallback).
 */
export async function main(): Promise<void> {
  // The root `pnpm storytree` script forwards args after a literal `--`, which pnpm passes
  // through verbatim; drop it so parseArgs doesn't read it as the end-of-options marker
  // (which would demote every forwarded flag, e.g. --dry-run/--check, to a positional).
  const raw = process.argv.slice(2);
  const argv = raw[0] === "--" ? raw.slice(1) : raw;
  // THE DETACHED SHIPPER BOUNDS ITSELF. It has no parent watching it and no terminal to notice it,
  // so a `createPool` that hangs against a stopped instance would leave an invisible process
  // burning on a shared box — the shape `storytree own` exists to make findable, and which this one
  // is deliberately absent from. `unref()` so the deadline never keeps a healthy run alive.
  if (isShipChildProcess(process.env)) {
    setTimeout(() => process.exit(0), SHIP_WATCHDOG_MS).unref();
  }
  // Hydrate credentials (CLAUDE_CODE_OAUTH_TOKEN / STORYTREE_DB_USER) from
  // ~/.storytree/secrets.json when the env doesn't already carry them — env always wins
  // (CURSOR_API_KEY hydration retired with the Cursor leaf — ADR-0198).
  loadLocalSecrets();
  // ADR-0464 D1 REMOVED A WHOLE PRE-RENDER STEP HERE, and it is worth saying what it was, because the
  // shape it created is the kind that grows back. ADR-0260 D3 made the offer's identity travel in
  // ARGV, so the render had to know a visit id BEFORE it printed: an id was pre-minted here and handed
  // to both halves — `run` printed follow-up commands carrying `candidate-set:<visitId>`, and
  // `captureCliInvocation` recorded the offer under that very id. Nothing prints an offer now, so
  // there is no id to agree about, no pre-mint, and no `--from-offer` to strip out of argv before the
  // observer's allowlist sees it.
  //
  // What that leaves is simply the identity resolution the rest of the entry point already needed.
  // ADR-0241 **D2**'s opt-out-clean envelope is unaffected and in fact easier to hold: with nothing
  // printed conditionally on capture being enabled, an opted-out run's envelope is byte-identical to a
  // captured one for free, rather than by two call sites agreeing to stay silent together.
  const { registry: identity, trace } = resolveInvocationIdentities();
  // `shared-box-session-ownership-arc` inc 1 — this invocation becomes visible to `storytree own`
  // for as long as it runs. Registered BEFORE the store is built, because a `--pg` command that
  // hangs on the connector handshake is precisely the one a session needs to be able to find.
  const deregister = registerThisInvocation(argv, identity);
  const usePg = argv.includes("--pg");
  const {
    store,
    claims,
    ledger,
    verdicts,
    workLog,
    uatStore,
    attemptLedger,
    attestations,
    members,
    adr,
    traversalEvents,
    pullDeltas,
    close,
  } = await buildStore(usePg);
  try {
    // Writes only persist against the live --pg store; the offline copy is read-only-by-convention.
    const actor = process.env["STORYTREE_ACTOR"];
    // `RunDeps`' optional fields are readonly, so each one that is present is added by rebuilding
    // the bag rather than by assigning into it. Absent stays ABSENT — never `undefined`.
    let deps: RunDeps = {
      store,
      writable: usePg,
      presence: { claims, ledger },
      verdicts,
      workLog,
      uatStore,
      attemptLedger,
      attestations,
      members,
      adr,
      traversalEvents,
      // The peek's two seams — this machine's spawn registry and the liveness probe (ADR-0588).
      // Supplied HERE and only here, like the re-steer denominator below, because this is the one
      // place that knows it is a real invocation on a real box. It deliberately does NOT follow
      // `usePg`: its subject is the filesystem, not the live store, which is what lets a peek still
      // answer when the database is unreachable. Without it the D4 fence on `node attempts` simply
      // does not fire — so `node-peek-dispatch.test.ts` pins this line rather than trusting it.
      nodePeek: defaultNodePeekDeps(),
      // The re-steer denominator (`follow-the-research-arc`, increment
      // `resteer-session-denominator`) — supplied HERE and only here, because this is the one place
      // that knows it is running against a real checkout rather than a test double. A THUNK, so the
      // git spawn happens for `resteer list` alone and every other command pays nothing; and it
      // returns null rather than throwing when git cannot answer, which the report renders as the
      // rate being not computable.
      // Stryker disable next-line ArrowFunction: NO COVERAGE BY DESIGN — this is the composition
      // root's single wire to the real git reader. Its two ends ARE tested (the reader in
      // `resteer-session-population.test.ts`, the dispatcher hand-off in the same file's
      // `resteer list: the dispatcher hands the population through` case); only this one-line
      // binding is not, and covering it would mean booting the CLI against the machine's own
      // history — the non-determinism the thunk exists to keep out of the suite.
      sessionPopulation: () => sessionPopulationSince(),
      // WHERE A DECLARE'S CLAIMED UNITS ARE RECORDED (ADR-0541 D2) — supplied HERE and only here,
      // because this is the one place that is genuinely the operator's CLI rather than a caller
      // driving `run` with fixtures. `commands.ts` deliberately has no default for this: it is the
      // only write that dispatch performs into the operator's HOME, and a default put a test's
      // `noticeboard-cli` / `tree-view` / `inc-a` / `cap-a` onto a live session's record on
      // 2026-09-07 — a mutation run of the same tests then overwrote that session's declared origin.
      recordClaimedUnits: claimedUnitsRecorderFor(trace),
    };
    // The claim NAMESPACE (ADR-0310 D2) — supplied HERE and only here, because this is the one
    // place that knows the store is the live corpus rather than a test double. A memoised loader,
    // invoked lazily by the claim-taking verbs alone, so a command that takes no claim never
    // reads it; and only under --pg, since every one of those verbs already refuses without it.
    if (usePg) {
      deps = {
        ...deps,
        claimUniverse: createClaimUniverseLoader({
          storiesDir: path.join(repoRoot(), "stories"),
          library: store,
          // The declared subtree map (ADR-0317 D2/D3) — the third source. Unreadable here means
          // the whole check stands down, never that a subtree claim starts being refused.
          manifestPath: path.join(repoRoot(), REPO_MANIFEST_TREE),
        }),
      };
    }
    if (actor !== undefined) deps = { ...deps, actor };
    const env = await run(argv, deps);
    if (isRawEnvelope(env)) {
      // `library artifact <id> --raw <field>` — the ONE deliberate exception to the envelope
      // convention: the field's exact stored bytes ALONE. No `formatEnvelope` (it strips trailing
      // whitespace and appends its own newline) and no delta footer (it appends to `body`) — either
      // one would defeat piping the value to a file, which is the whole point of the read.
      process.stdout.write(env.raw);
      process.exitCode = 0;
    } else {
      // ADR-0200 D4: the cursor-once delta footer rides the render the agent already reads.
      process.stdout.write(formatEnvelope(await attachDeltaFooter(env, pullDeltas)));
      // `ok` maps to 0/1 for every command whose exit code is its OWN. `exitCode` is the narrow
      // exception for a command REPORTING ANOTHER PROCESS'S status (`dispatch --wait`), where
      // collapsing to 0/1 would destroy the gate's reserved 3 (SKIP) and 4 (PARTIAL RUN).
      process.exitCode = env.exitCode ?? (env.ok ? 0 : 1);
    }
    await captureInvocation(argv, env.ok, store, trace, env.observedResultIds);
  } finally {
    await close();
    // LAST, and outside every other concern: the record must survive until the command genuinely
    // stops doing work. `close()` above is the pool teardown that has itself been observed to hang
    // after a `--pg` write commits — the exact shape a session needs `storytree own` to show it.
    deregister();
  }
}

const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
