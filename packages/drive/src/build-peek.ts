/**
 * THE PEEK — is this build working, or is it stuck? (ADR-0588, `orchestrator-peeks-and-extends-a-spent-budget`)
 *
 * ## The question, and why nothing answered it
 *
 * ADR-0584 put both workers on a wall clock and ADR-0581 D2 says the orchestrator peeks at expiry
 * and decides whether to extend. A fixed timer cannot tell slow-but-healthy work from a wedged
 * worker; the orchestrator can, if it can see what the worker is doing. It could not.
 *
 * And the read it would reach for ACTIVELY MISLEADS. `storytree node attempts` folds the inner-loop
 * ledger, whose `attempt` row is appended immediately BEFORE the gate walk (ADR-0576 D5) and cleared
 * only by a later `signed-pass`. So a build that is genuinely mid-walk reads IDENTICALLY to one that
 * already failed and stopped: both show one more unsigned attempt and one more consecutive failure.
 * That is not an absence — it is an answer that looks like an answer and is wrong half the time, and
 * ADR-0588 D4 makes fixing it the measure of whether this worked. {@link attemptPolicyPeekCaveat} is
 * that fix, and it lives here rather than in the ledger because the ledger genuinely has no
 * in-progress state to give: the peek is what makes its fold READABLE, not what changes its meaning.
 *
 * ## What this is a fold OVER, and what it refuses to be
 *
 * D1: **a peek is a READ over what a build already writes. It adds no per-slice persistence.** The
 * tempting fix for the gaps below is to stream the leaf's tool calls, feedback runs and touched
 * files to the store as they happen. That is refused, and the third reason is the one to hold onto:
 * Codex's phase is a single non-interactive call with no mid-call visibility of any kind, so a
 * streamed trail would exist for Claude and not for Codex — and a peek whose content depends on
 * which leaf is running is worse than one whose content does not. If widening the `PhaseAuthor` seam
 * so an observability read can see inside a slice starts to look necessary, that is D1 being
 * reopened: supersede it deliberately or stop.
 *
 * D2: what the peek shows is **the JOIN nothing performs today** — process liveness against the
 * phase trail. Neither half answers the question alone. The spawn registry knows a process is alive
 * but nothing about what it is doing; the appended phase marks know what phase was entered and when
 * but nothing about whether anyone is still in it.
 *
 * ## PURE BY INJECTION
 *
 * Neither the registry nor the store is read in here. {@link foldBuildPeek} takes classified spawn
 * records and phase marks and returns the state; the CLI supplies both. So every state below —
 * including the ones that need a dead store or a crashed process — is unit-tested with no processes,
 * no disk and no database.
 */

import { DEFAULT_BUILD_BUDGET_MS } from "@storytree/orchestrator";

import type { ClassifiedSpawn, SpawnState } from "./spawn-registry.js";

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * One appended `building` mark, as the work log recorded it.
 *
 * Structural and NARROW on purpose: `packages/cli`'s `WorkLogEntry` satisfies it, so the CLI hands
 * `foldWorkLog`'s output straight in — but the drive never imports the CLI (the package's hard
 * invariant), and nothing here depends on a row shape that is not spelled out at this boundary.
 *
 * `phase` and `runId` are optional because they are optional on the wire: every pre-ADR-0048
 * `building` row carries no phase, and a mark with no run cannot be attributed to one.
 */
export interface PeekPhaseMark {
  readonly seq: number;
  readonly at: string;
  readonly event: "proposed" | "building" | "retired";
  readonly runId?: string;
  readonly phase?: string;
}

/**
 * What the registered argv of a `--real` build says about itself.
 *
 * `timeBudgetMs` is `undefined` when the operator passed no `--time-budget`, which is NOT the same
 * as unknown: the flag's ABSENCE is itself a record that the build ran on the spine's default. Only
 * a build with no registry record at all has an unknown budget, and D5 exists to keep those two
 * apart.
 */
export interface RegisteredBuild {
  readonly unitId: string;
  readonly route: "node" | "story";
  readonly timeBudgetMs: number | undefined;
}

// ---------------------------------------------------------------------------
// Parsing a registered invocation
// ---------------------------------------------------------------------------

/**
 * Read a spawn record's verbatim `command` as a `--real` build, or answer `null`.
 *
 * The registry stores `storytree ${argv.join(" ")}` for every CLI invocation (`main.ts`), so the
 * flags the orchestrator launched with are recoverable from it — including the budget D5 requires.
 * Other registrars write labels rather than argv (`pnpm gate`, `studio dev server (vite) on :5173`),
 * and those must answer `null` rather than be coaxed into a shape they never had.
 *
 * `--real` IS REQUIRED. A `--dry-run` or `--live` walk writes phase marks too, but it is not the
 * thing an orchestrator peeks at and it runs on no wall clock (ADR-0584 leaves `--max-turns` as the
 * brake there), so reporting elapsed against a budget it does not have would be the exact
 * wrong-denominator error D5 names, one level up.
 */
export function parseRegisteredBuild(command: string): RegisteredBuild | null {
  // ONE mechanism, deliberately. An earlier draft was `.trim().split(/\s+/).filter(t => t.length > 0)`
  // — three guards for one job, and the mutation rung showed why that is worse than it looks: the
  // filter made both siblings unkillable, because a stray empty token it swallowed could no longer
  // change any answer. `\s+` alone is load bearing (a double space would otherwise split an empty
  // token INTO the middle of the argv and break the verb-pair lookup), the leading empty token a
  // leading space produces is harmless because the lookup is positional-by-search rather than by
  // index, and there is nothing left that cannot be observed.
  const tokens = command.split(/\s+/);
  // `storytree node build <id> …` — the shape registered by `main.ts`. The leading word is whatever
  // the registrar wrote; only the verb pair and the id are load bearing.
  const verbAt = tokens.findIndex(
    (t, i) => (t === "node" || t === "story") && tokens[i + 1] === "build",
  );
  if (verbAt === -1) return null;
  const route = tokens[verbAt] === "story" ? "story" : "node";
  const unitId = tokens[verbAt + 2];
  if (unitId === undefined || unitId.startsWith("-")) return null;
  if (!tokens.includes("--real")) return null;
  return { unitId, route, timeBudgetMs: readTimeBudgetMs(tokens) };
}

/**
 * `--time-budget <minutes>` out of a registered argv, in milliseconds.
 *
 * Deliberately TOLERANT where `chooseTimeBudgetMs` is strict, and the difference is the direction of
 * the read: that function judges what an operator just typed and refuses what cannot bound a build,
 * whereas this one reads back a command that ALREADY RAN. A figure the launcher would have refused
 * never became a build, so a value that does not parse here means the record is not telling us the
 * budget — `undefined`, which the fold then reports as the default rather than inventing a number.
 */
function readTimeBudgetMs(tokens: readonly string[]): number | undefined {
  // Scanned as PAIRS rather than via `indexOf` plus an `=== -1` guard. The sentinel form read
  // `tokens[at + 1]` with `at` of -1 as its failure mode, which `Number(...)` then swallowed into
  // the same `undefined` — so the guard protected against nothing observable and the rung reported
  // it as unkillable. Here every branch changes an answer some argv can produce.
  for (const [i, token] of tokens.entries()) {
    if (token !== "--time-budget") continue;
    const minutes = Number(tokens[i + 1]);
    return Number.isFinite(minutes) && minutes > 0 ? minutes * 60_000 : undefined;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// The peeked state
// ---------------------------------------------------------------------------

/**
 * The three states ADR-0588 D2 separates, and the third is REPORTED AS ITSELF.
 *
 * - `running` — a registered process on this machine is running this unit's `--real` build and the
 *   liveness probe says it is alive. Positive evidence.
 * - `ended` — positive evidence that it stopped: a record whose process is gone and which was never
 *   de-registered, i.e. the build was killed or it crashed.
 * - `unknown` — no positive evidence either way. Never collapsed into either of the others, because
 *   the commonest cause of it — a build that finished cleanly and removed its own record — is
 *   indistinguishable from a build running on ANOTHER machine, whose registry this one cannot see.
 */
export type BuildLiveness = "running" | "ended" | "unknown";

/** One registered `--real` build of the peeked unit, with what the liveness probe saw. */
export interface PeekedProcess {
  readonly pid: number;
  readonly sessionId: string;
  readonly branch: string;
  readonly cwd: string;
  readonly command: string;
  readonly state: SpawnState;
  readonly ageMs: number | null;
  readonly build: RegisteredBuild;
}

/** One phase entry, as the append-only trail recorded it. */
export interface PeekedPhase {
  readonly phase: string;
  readonly at: string;
  readonly seq: number;
}

/**
 * The phase trail of ONE run.
 *
 * `reentered` counts phases the trail entered more than once. The marks APPEND (a fresh row per
 * transition), so a repeated phase is durable evidence that the walk went backwards — which since
 * ADR-0582 is what an in-build repair looks like from outside. It is reported as what it is, a
 * re-entry count, and never asserted to BE a repair count: the trail records transitions, and
 * nothing in it names why one happened.
 */
export interface PeekedRun {
  readonly runId: string;
  readonly marks: readonly PeekedPhase[];
  readonly latest: PeekedPhase | undefined;
  readonly startedAt: string;
  readonly reentered: readonly { readonly phase: string; readonly times: number }[];
}

/**
 * The budget elapsed time is read AGAINST (D5) — recovered from the registered argv, never assumed.
 *
 * A peek that showed elapsed against a two-hour default while the build was launched with thirty
 * minutes would be wrong in the direction that matters: it would report room that does not exist.
 * So `source` is part of the answer. `"flag"` is what the operator typed; `"default"` is a record
 * that carries no flag, which is a POSITIVE reading that the build ran on `DEFAULT_BUILD_BUDGET_MS`;
 * and with no record there is no budget to report and none is invented.
 */
export type PeekBudget =
  | { readonly known: true; readonly ms: number; readonly source: "flag" | "default" }
  | { readonly known: false; readonly why: string };

/**
 * How much of the wall clock is gone, and WHAT THAT NUMBER IS MEASURED FROM.
 *
 * `"process"` is the registered start time — the honest reading, since it is the same clock the
 * budget bounds. `"first-mark"` is the first phase mark of the run, reached only when no record
 * exists, and it is a LOWER BOUND: everything before the first phase (resolution, the worktree
 * build, the replica) is not in it. The source rides on the value so no reader can mistake the
 * second for the first.
 */
export type PeekElapsed =
  | { readonly known: true; readonly ms: number; readonly source: "process" | "first-mark" }
  | { readonly known: false; readonly why: string };

/** Everything the peek can honestly say about one unit. */
export interface BuildPeek {
  readonly unitId: string;
  readonly liveness: BuildLiveness;
  /** Why that state, in words — the evidence, never a restatement of the word. */
  readonly livenessReason: string;
  /**
   * The live process, when there is one — the SAME record `livenessReason` names, carried rather
   * than re-found.
   *
   * The invariant is `running !== null` exactly when `liveness === "running"`, and it exists so no
   * consumer has to re-derive one from the other. An earlier draft had the fence check the state
   * and then search `processes` again for the live row, which left it holding an `undefined` case
   * that the fold can never produce — a branch protecting against nothing, and one the mutation rung
   * duly reported as unkillable.
   */
  readonly running: PeekedProcess | null;
  readonly processes: readonly PeekedProcess[];
  readonly run: PeekedRun | null;
  readonly budget: PeekBudget;
  readonly elapsed: PeekElapsed;
  /**
   * Whether the phase trail was READ at all. `false` means the store was unreachable, which is a
   * different fact from a unit with no marks, and the render must never let the two look alike: the
   * registry half works with no database and is worth having on its own.
   */
  readonly storeRead: boolean;
}

export interface BuildPeekInput {
  readonly unitId: string;
  /** Every registered spawn on this machine, across every session — the peeked build may be any session's. */
  readonly spawns: readonly ClassifiedSpawn[];
  /** This unit's work log, or `null` when the store was not read. */
  readonly marks: readonly PeekPhaseMark[] | null;
  readonly nowMs: number;
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

/** The join: process liveness against the phase trail (D2). Pure — both inputs arrive as arguments. */
export function foldBuildPeek(input: BuildPeekInput): BuildPeek {
  const processes = matchProcesses(input.unitId, input.spawns);
  const run = input.marks === null ? null : latestRun(input.marks);
  const { liveness, livenessReason, running } = judgeLiveness(processes);
  const budget = judgeBudget(processes);
  return {
    unitId: input.unitId,
    liveness,
    livenessReason,
    running,
    processes,
    run,
    budget,
    elapsed: judgeElapsed(processes, run, input.nowMs),
    storeRead: input.marks !== null,
  };
}

/**
 * The registered `--real` builds of this unit.
 *
 * ⚠ MATCHED ON THE ID IN THE ARGV, which for `story build` is the STORY's. A chain member therefore
 * matches nothing even while it is genuinely being built — the same story-versus-member keying the
 * ledger already has (ADR-0576 D7). Named in the render rather than papered over.
 */
function matchProcesses(
  unitId: string,
  spawns: readonly ClassifiedSpawn[],
): readonly PeekedProcess[] {
  const matched: PeekedProcess[] = [];
  for (const spawn of spawns) {
    const build = parseRegisteredBuild(spawn.record.command);
    if (build === null || build.unitId !== unitId) continue;
    matched.push({
      pid: spawn.record.pid,
      sessionId: spawn.record.sessionId,
      branch: spawn.record.branch,
      cwd: spawn.record.cwd,
      command: spawn.record.command,
      state: spawn.state,
      ageMs: spawn.ageMs,
      build,
    });
  }
  // NEWEST FIRST — smallest age first, since a record's age is how long ago it started. With several
  // records for one unit (a crashed attempt beside a live one), the row a reader wants first is the
  // one that is happening now. A record with no parseable start time sorts last rather than first:
  // it is the one that can say least, so it is not what should head the list.
  return matched.sort((a, b) => (a.ageMs ?? Number.POSITIVE_INFINITY) - (b.ageMs ?? Number.POSITIVE_INFINITY));
}

/**
 * A state and the evidence for it, always together.
 *
 * Named rather than written inline at the return: with no build step and raw TypeScript exported,
 * the declaration site is this repo's only API-surface document (`docs/typescript-standard.md`,
 * remedy 3). It also says the thing the pair exists to enforce — a state is never produced without
 * the reason that earned it, so no caller can render the word `UNKNOWN` with nothing behind it.
 */
interface LivenessJudgement {
  readonly liveness: BuildLiveness;
  readonly livenessReason: string;
  readonly running: PeekedProcess | null;
}

/**
 * Which of the three states the evidence supports, IN THIS ORDER.
 *
 * `live` outranks the rest because several records for one unit is the ordinary shape — a crashed
 * earlier attempt sits beside the build that is running now, and the running one is the answer. A
 * probe that could not tell outranks a leak for the opposite reason: it is not evidence of an
 * ending, and reading it as one is the confident-false-terminal the spawn registry itself refuses.
 */
function judgeLiveness(processes: readonly PeekedProcess[]): LivenessJudgement {
  const live = processes.find((p) => p.state === "live");
  if (live !== undefined) {
    return {
      liveness: "running",
      livenessReason: `pid ${live.pid} is alive on this machine, running \`${live.command}\` (session ${live.sessionId}).`,
      running: live,
    };
  }
  const unsure = processes.find((p) => p.state === "unknown");
  if (unsure !== undefined) {
    return {
      liveness: "unknown",
      livenessReason: `a record for pid ${unsure.pid} exists, but the liveness probe could not tell whether that process is running. A probe that could not answer is not one that said no.`,
      running: null,
    };
  }
  // WHATEVER IS LEFT IS LEAKED. Not a re-scan: the two returns above have already taken every
  // `live` and every `unknown` row, so a third predicate here would be true of everything it saw —
  // which is precisely why the rung could not kill it. The remaining rows are the leaked ones by
  // elimination, and saying so is both the simpler code and the honest one.
  const leaked = processes[0];
  if (leaked !== undefined) {
    return {
      liveness: "ended",
      livenessReason: `pid ${leaked.pid}'s record survives but the process is gone, and it never de-registered — so that build was killed or it crashed rather than finishing.`,
      running: null,
    };
  }
  return {
    liveness: "unknown",
    livenessReason:
      "no registered `--real` build of this unit is on this machine. That is three different things at once and this read cannot separate them: the build FINISHED and removed its own record; it is running on ANOTHER machine, whose registry is not visible from here; or it was launched from the primary checkout, which derives no session identity and so registers nothing at all.",
    running: null,
  };
}

/** The budget, recovered from the registered argv (D5) or reported unknown. Never assumed. */
function judgeBudget(processes: readonly PeekedProcess[]): PeekBudget {
  // The LIVE record first, then any record: a running build's own launch flags are what "how much
  // room is left" has to be measured against, and an older crashed attempt may have had others.
  const source = processes.find((p) => p.state === "live") ?? processes[0];
  if (source === undefined) {
    return {
      known: false,
      why: "no registry record names this build, so the budget it was launched with is not recoverable. It is NOT assumed to be the two-hour default: a peek reporting room that does not exist is wrong in the direction that matters (ADR-0588 D5).",
    };
  }
  const flagged = source.build.timeBudgetMs;
  return flagged === undefined
    ? { known: true, ms: DEFAULT_BUILD_BUDGET_MS, source: "default" }
    : { known: true, ms: flagged, source: "flag" };
}

/** Elapsed wall clock, carrying what it was measured from. */
function judgeElapsed(
  processes: readonly PeekedProcess[],
  run: PeekedRun | null,
  nowMs: number,
): PeekElapsed {
  const source = processes.find((p) => p.state === "live") ?? processes[0];
  if (source !== undefined && source.ageMs !== null) {
    return { known: true, ms: source.ageMs, source: "process" };
  }
  if (run !== null) {
    const started = Date.parse(run.startedAt);
    if (!Number.isNaN(started)) {
      return { known: true, ms: Math.max(0, nowMs - started), source: "first-mark" };
    }
  }
  return {
    known: false,
    why: "neither a registry record nor a dated phase mark is available, so nothing anchors the clock.",
  };
}

/**
 * The LATEST run's phase trail.
 *
 * "Latest" is by the highest `seq` that carries a run id — the append-only order, never a timestamp
 * comparison, because seq is the store's own total order and `at` is a wall clock that several
 * writers can disagree about. Marks with no run id are dropped: a mark that names no run cannot be
 * attributed to one, and folding it into whichever run happens to be latest would invent an entry.
 */
/** A `building` mark that names its run — what the trail is actually built from. */
type RunBearingMark = PeekPhaseMark & { readonly runId: string };

function latestRun(marks: readonly PeekPhaseMark[]): PeekedRun | null {
  // TYPED as run-bearing rather than filtered and then re-checked. `filter` does not narrow, so the
  // earlier form needed an `if (runId === undefined) return null` that the filter had already made
  // unreachable — a second guard on a question the first one settled.
  const building: readonly RunBearingMark[] = marks.flatMap((m) =>
    m.event === "building" && m.runId !== undefined ? [{ ...m, runId: m.runId }] : [],
  );
  if (building.length === 0) return null;
  // Stryker disable next-line EqualityOperator: EQUIVALENT — `seq` is the event store's own total order and is unique per row, so `>` and `>=` can differ only on two marks sharing a seq, which the store cannot produce; on a tie either answer is equally correct
  const newest = building.reduce((a, b) => (b.seq > a.seq ? b : a));
  const runId = newest.runId;
  const ofRun = building.filter((m) => m.runId === runId).sort((a, b) => a.seq - b.seq);
  const phases: PeekedPhase[] = [];
  for (const m of ofRun) {
    if (m.phase === undefined) continue;
    phases.push({ phase: m.phase, at: m.at, seq: m.seq });
  }
  const counts = new Map<string, number>();
  for (const p of phases) counts.set(p.phase, (counts.get(p.phase) ?? 0) + 1);
  const reentered = [...counts.entries()]
    .filter(([, times]) => times > 1)
    .map(([phase, times]) => ({ phase, times }));
  // The run STARTED at its first mark of any kind — including the phase-less opening `building` row,
  // which is written before resolution even runs and is therefore the earliest thing the store has.
  //
  // SEEDED WITH `newest`, which makes this total rather than optional: `ofRun` is `building` filtered
  // to `newest`'s own run, so it always contains at least `newest`. The earlier `ofRun[0]` forced an
  // `undefined` branch that no input could reach, and an unreachable branch is not a safety net — it
  // is a claim that something can happen, made in code, that is false.
  // Stryker disable next-line EqualityOperator: EQUIVALENT — same unique-`seq` argument as the reduce above, at the other end of the trail
  const first = ofRun.reduce((a, b) => (b.seq < a.seq ? b : a), newest);
  return {
    runId,
    marks: phases,
    latest: phases.at(-1),
    startedAt: first.at,
    reentered,
  };
}

// ---------------------------------------------------------------------------
// The blind spots (D3)
// ---------------------------------------------------------------------------

/**
 * What the peek CANNOT show, and why — printed every time, never on request.
 *
 * D3: an observability read that silently omits what it cannot see teaches its reader to over-trust
 * it, which is the failure this arc's founding audit found everywhere else — a signal that looks
 * like an answer. Two of the four things ADR-0581 D2 asked a peek for are in here, and they are
 * absent because D1 refused to buy them with per-slice persistence, not because anyone forgot.
 */
export const BUILD_PEEK_BLIND_SPOTS: readonly string[] = [
  "the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)",
  "its feedback runs (`run_proof` / `run_typecheck` and what `worker-can-run-the-existing-tests` adds) — those are never persisted anywhere; only the final build envelope renders them",
  "the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree",
  "any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census",
  "a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all",
  "a chain member under `story build` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)",
];

// ---------------------------------------------------------------------------
// The disagreement fence (D4)
// ---------------------------------------------------------------------------

/**
 * The line `node attempts` owes a run the peek calls RUNNING (ADR-0588 D4).
 *
 * The ledger's `attempt` row is appended BEFORE the walk, so an unsigned attempt and an incremented
 * consecutive-failure count are exactly what a healthy mid-walk build looks like. Where both reads
 * are available they must never disagree, and the repair is a LINE rather than new machinery: the
 * ledger keeps its meaning — it folds the attempt policy and genuinely has no in-progress state —
 * and this says, beside it, that the run it just counted may still be going.
 *
 * FIRES ON `running` ALONE, and that is the whole design. `unknown` is the ordinary state of every
 * build that has finished, so a caveat there would print on nearly every read and stop being read at
 * all — a warning that fires always is a warning that warns about nothing.
 */
export function attemptPolicyPeekCaveat(peek: BuildPeek): readonly string[] {
  // ONE guard, reading the carried process rather than the state word plus a second search. The
  // two can never disagree, and there is no "running but no live row" arm left to be unreachable.
  const live = peek.running;
  if (live === null) return [];
  const where = `as pid ${live.pid} (session ${live.sessionId})`;
  const phase =
    peek.run?.latest === undefined
      ? "no phase mark has been read for it"
      : `its latest phase mark is ${peek.run.latest.phase}, entered ${peek.run.latest.at}`;
  return [
    "",
    `⚠ A \`--real\` build of "${peek.unitId}" is RUNNING right now, ${where} — ${phase}.`,
    "",
    "So the unsigned attempt counted above may be THAT BUILD IN FLIGHT rather than a failure. The",
    "ledger appends its `attempt` row before the walk starts (ADR-0576 D5) and clears it only on a",
    "later signed pass, which is why a mid-walk build and a failed one read identically here. The",
    "attempt policy is not wrong — it has no in-progress state to give — but do not spend a decision",
    "point on this count until the run ends.",
    "",
    `  storytree node peek ${peek.unitId} --pg`,
  ];
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

/** `4530000` → `1h 15m`. Coarse on purpose: this is a wall clock, not a stopwatch. */
export function formatDurationMs(ms: number): string {
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${minutes}m`;
}

/** The peek as an operator reads it — the state, the evidence, the trail, and the blind spots. */
export function renderBuildPeek(peek: BuildPeek): string {
  const lines: string[] = [];
  const word =
    peek.liveness === "running" ? "RUNNING" : peek.liveness === "ended" ? "ENDED" : "UNKNOWN";
  lines.push(`${word} — "${peek.unitId}"`, "", `  ${peek.livenessReason}`, "");

  lines.push(...renderClock(peek), "");
  lines.push(...renderTrail(peek), "");

  if (peek.processes.length > 0) {
    lines.push("Registered build process(es) on this machine:");
    for (const p of peek.processes) {
      const age = p.ageMs === null ? "age unknown" : `started ${formatDurationMs(p.ageMs)} ago`;
      lines.push(`  ${p.state.padEnd(7)} pid ${p.pid}  ${age}  session ${p.sessionId}  ${p.branch}`);
      lines.push(`          ${p.command}`);
    }
    lines.push("");
  }

  lines.push("WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:");
  for (const spot of BUILD_PEEK_BLIND_SPOTS) lines.push(`  · ${spot}`);
  return lines.join("\n");
}

/** Elapsed against the budget, each carrying where it came from. */
function renderClock(peek: BuildPeek): readonly string[] {
  const lines: string[] = ["Wall clock:"];
  if (!peek.elapsed.known) {
    lines.push(`  elapsed: not known — ${peek.elapsed.why}`);
  } else {
    const anchor =
      peek.elapsed.source === "process"
        ? "measured from the registered process start — the same clock the budget bounds"
        : "measured from the run's FIRST PHASE MARK, so it is a LOWER BOUND: resolution, the worktree and the replica are all before it";
    lines.push(`  elapsed: ${formatDurationMs(peek.elapsed.ms)} (${anchor})`);
  }
  if (!peek.budget.known) {
    lines.push(`  budget:  not known — ${peek.budget.why}`);
    return lines;
  }
  const how =
    peek.budget.source === "flag"
      ? "as launched, from `--time-budget` in the registered argv"
      : "the spine's default — the registered argv carries no `--time-budget`";
  lines.push(`  budget:  ${formatDurationMs(peek.budget.ms)} (${how})`);
  if (peek.elapsed.known) {
    const left = peek.budget.ms - peek.elapsed.ms;
    lines.push(
      left <= 0
        ? `  left:    NONE — the budget is spent by ${formatDurationMs(-left)}.`
        : `  left:    ${formatDurationMs(left)}`,
    );
  }
  return lines;
}

/** The phase trail, or the reason there is none. */
function renderTrail(peek: BuildPeek): readonly string[] {
  if (!peek.storeRead) {
    return [
      "Phase trail: NOT READ — this ran without the live store, so only the process half above is",
      "  answered. That is deliberate rather than a degradation: a peek that still says something",
      "  useful when the store is unreachable is worth more than one that refuses. Rerun with --pg",
      "  for the phase the worker is actually in.",
    ];
  }
  const run = peek.run;
  if (run === null) {
    return [
      "Phase trail: no `building` mark for this unit is in the store.",
      "  A dry run proves nothing and persists nothing (ADR-0060), and a `--real` build without",
      "  `--store pg` writes no marks either — so this is not evidence the unit was never built.",
    ];
  }
  const lines: string[] = [`Phase trail — run ${run.runId}, started ${run.startedAt}:`];
  // ONE guard. `latest` is the last of `marks`, so "no latest" and "no marks" are the same fact
  // asked twice — and asking twice left the second check unkillable, since nothing could make the
  // two disagree. Branching on `latest` is the version that also narrows the type it goes on to use.
  const latest = run.latest;
  if (latest === undefined) {
    lines.push("  the run is marked but no phase has been stamped yet — it has not entered the walk.");
    return lines;
  }
  for (const m of run.marks) lines.push(`  ${m.at}  ${m.phase}`);
  lines.push("", `  now in: ${latest.phase}, entered ${latest.at}`);
  if (run.reentered.length > 0) {
    const named = run.reentered.map((r) => `${r.phase} x${r.times}`).join(", ");
    lines.push(
      "",
      `  RE-ENTERED: ${named}. The marks append, so the walk went backwards — which since ADR-0582`,
      "  is what an in-build repair looks like from outside. The trail records transitions and never",
      "  says why one happened, so this is a re-entry count and not a repair count.",
    );
  }
  return lines;
}
