/**
 * THE IN-BUILD REPAIR SUPPORT (ADR-0581 D4; the mechanism is ADR-0582): what the spine needs to hand a
 * failed check back to the worker who can fix it, inside the same build, and observe again.
 *
 * `proveUnit` (`prove-it-gate.ts`) owns the loop and every transition; `repairPhase`
 * (`phase-machine.ts`) declares the backward edges. This module holds the pieces the loop consults:
 *
 *  - the BUDGET that bounds it (ADR-0582 D6) — time alone, never a repair count, asked before every
 *    repair and asynchronous so a budget that holds a spent build for the orchestrator's peek can wait
 *    inside it (ADR-0581 D2);
 *  - the BRIEF each repairing worker receives (D7) — every slice is a fresh session with no memory of
 *    the build, so a repair brief is the phase's original brief plus a section saying what failed;
 *  - the TYPECHECK ROUTER (D3) — a red package typecheck goes to whoever owns the files it names;
 *  - the SET-ASIDE (D4) — a test revised after IMPLEMENT is re-observed red against the source the
 *    build began from, so the implementation is put aside for that one observation and restored.
 *
 * Nothing here observes red or green and nothing here signs: the spine does both, in `proveUnit`.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";

import type { AuthoringPhase, WorkerTimeBudget } from "@storytree/agent";

import type { Phase, RepairOwner } from "./phase-machine.js";

/** One process result the spine observed — a proof run or the package typecheck. */
export interface ProcessOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

// ---------------------------------------------------------------------------
// The budget (ADR-0582 D6)
// ---------------------------------------------------------------------------

/**
 * Whether another repair may start: yes, or no with the plain reason the build ends with.
 *
 * The `ok` branch carries an `extension` when THIS answer was bought by the orchestrator (ADR-0592
 * D5) — the budget was spent, the build held, and a decision arrived granting more time. It rides the
 * decision rather than being read off the budget afterwards so the spine records it at the moment it
 * was granted, in the same place it records repairs, and a budget that never holds needs no new
 * method.
 */
export type RepairDecision =
  | { readonly ok: true; readonly extension?: ExtensionRecord }
  | { readonly ok: false; readonly reason: string };

/**
 * One granted extension, as the build envelope lists it (ADR-0592 D5).
 *
 * It is NOT an attempt, and that needs no mechanism here: `node-build.ts` appends the inner-loop
 * `attempt` event immediately BEFORE the walk (ADR-0576 D5) and an extension is granted inside it, so
 * no extension can reach the ledger at all. What this record buys is the VISIBILITY — a build that ran
 * three hours on a two-hour budget says who bought the third and why.
 */
export interface ExtensionRecord {
  /** Elapsed milliseconds when the hold fired — which is at or past the budget it was holding on. */
  readonly heldAfterMs: number;
  /** The budget being extended, before this grant. */
  readonly fromBudgetMs: number;
  /** The budget after it, so a reader never has to add up a chain of grants to know the clock. */
  readonly toBudgetMs: number;
  /** Why the orchestrator bought the time, in its own words. */
  readonly reason: string;
}

/** What a held build tells the orchestrator it is waiting for (ADR-0592 D4). */
export interface HoldNotice {
  /** The budget that is spent, in milliseconds. */
  readonly budgetMs: number;
  /** How much of the build's wall clock has actually gone — at or past {@link budgetMs}. */
  readonly elapsedMs: number;
  /** How long the build will wait before stopping itself (ADR-0592 D3). */
  readonly graceMs: number;
  /** Epoch milliseconds the hold began, so a reader can say how long is left of the grace. */
  readonly heldAt: number;
  /** Every extension already granted in this build, oldest first. */
  readonly extensions: readonly ExtensionRecord[];
}

/** The orchestrator's answer to a hold: buy more time, or stop the build now. */
export type HoldDecision =
  | { readonly kind: "extend"; readonly minutes: number; readonly reason: string }
  | { readonly kind: "stop"; readonly reason: string };

/**
 * How a held build announces itself and learns the decision (ADR-0592 D4).
 *
 * An INTERFACE here rather than the file implementation for the usual reason and one more: the file
 * channel lives in `packages/drive`, which depends on this package and not the other way round, so the
 * concrete channel could not be named here even if it wanted to be. Every state of the hold — a
 * decision that arrives, one that never does, a channel that throws — is therefore unit-tested with no
 * disk and no clock.
 */
export interface HoldChannel {
  /** Announce the hold. A throw here is swallowed by the caller: an unannounced hold still waits. */
  open(notice: HoldNotice): Promise<void>;
  /** The decision if one has arrived, else `undefined`. Polled until the grace runs out. */
  poll(): Promise<HoldDecision | undefined>;
  /** Take the announcement down, however the hold ended. Never throws out of the budget. */
  close(): Promise<void>;
}

/**
 * The build's budget, as the repair loop sees it. The spine asks it before EVERY repair and starts
 * none once it says no, so the loop terminates whatever the workers do. Asynchronous on purpose: when
 * the budget runs out, ADR-0581 D2 has the build HOLD while the orchestrator peeks and decides whether
 * to extend it, and that decision is awaited here rather than in a second seam.
 */
export interface RepairBudget {
  mayRepair(): Promise<RepairDecision>;
}

/**
 * The build's ONE budget, whole (ADR-0584 D1). Two contracts on one object, because a build has one
 * wall clock and not two: the repair loop polls it between rounds through {@link RepairBudget}, and a
 * running worker slice reads its remaining time through `WorkerTimeBudget` — the seam declared in
 * `@storytree/agent`, which imports no other storytree package and so cannot be handed this type.
 *
 * Extending BOTH is the point: the compiler, not a comment, is what holds the spine's clock to the
 * shape a worker was built to read. A worker never owns this object and never resets it.
 */
export interface BuildBudget extends RepairBudget, WorkerTimeBudget {}

/** The owner's figure (ADR-0581 D2): two hours of wall clock per build. */
export const DEFAULT_BUILD_BUDGET_MS = 2 * 60 * 60 * 1000;

/** `<n> min` — the budget's own unit, rounded down so an unspent minute never reads as spent. */
function minutes(ms: number): string {
  return `${Math.floor(ms / 60_000)} min`;
}

/** How long a held build waits for its orchestrator before stopping itself (ADR-0592 D3). */
export const DEFAULT_HOLD_GRACE_MS = 10 * 60 * 1000;

/** How often a held build looks for its decision. Injectable, so no test spends real time holding. */
const HOLD_POLL_MS = 2_000;

/** The refusal a spent clock reports, in the wording every budget shares. `suffix` says what else happened. */
function spentReason(budgetMs: number, elapsedMs: number, suffix: string): string {
  return (
    `the build's time budget of ${minutes(budgetMs)} is spent (${minutes(elapsedMs)} elapsed), ` + suffix
  );
}

/**
 * The clock every build budget is measured on: one reading, `elapsedMs`, that both the repair loop's
 * poll and a running worker slice's remaining-time read derive from — so they can never disagree about
 * how much of the build is gone.
 *
 * `budgetMs` is a READING rather than a stored number because ADR-0592 D2 has the hold raise it in
 * place: the worker's abort deadline, Codex's spawn bound and the feedback-run cap all read the same
 * object, so an extension reaches every one of them without anything being told about it.
 */
function budgetClock(opts: { budgetMs?: number; now?: () => number }) {
  const now = opts.now ?? Date.now;
  let budgetMs = opts.budgetMs ?? DEFAULT_BUILD_BUDGET_MS;
  const startedAt = now();
  return {
    now,
    elapsedMs: () => now() - startedAt,
    current: () => budgetMs,
    extendBy: (ms: number) => {
      budgetMs += ms;
    },
  };
}

/**
 * The two readings a WORKER takes off a budget (`WorkerTimeBudget`), both derived from the clock LIVE.
 *
 * ⚠ `budgetMs` is declared here as a GETTER and this object is never spread into another. A spread
 * copies a getter's value at the moment of the spread and leaves a plain number behind, so an earlier
 * draft — `{ ...view, mayRepair() {…} }` — handed the workers a budget frozen at construction: every
 * extension was granted, recorded and reported, and moved nothing. A worker's next slice would then
 * refuse itself on the original clock while the envelope claimed it had been given another hour. Caught
 * by the test that asserts the worker's view moves (ADR-0592 D2), which is the only place it is visible.
 */
function workerView(clock: { current: () => number; elapsedMs: () => number }): Omit<BuildBudget, "mayRepair"> {
  return {
    get budgetMs(): number {
      return clock.current();
    },
    remainingMs(): number {
      return clock.current() - clock.elapsedMs();
    },
  };
}

/**
 * A wall-clock budget measured from its own construction — which the real resolver does immediately
 * before the walk — that refuses a repair once `budgetMs` has elapsed, and reports the same clock's
 * remaining time to a running worker slice.
 *
 * It NEVER HOLDS: a spent clock ends the build here. {@link holdingBudget} is the one that holds, and
 * this stays the budget for every caller that wires no channel to be held for — which is also what
 * `--hold-grace 0` selects (ADR-0592 D3).
 */
export function wallClockBudget(opts: { budgetMs?: number; now?: () => number } = {}): BuildBudget {
  const clock = budgetClock(opts);
  // Object.assign, never a spread: the spread would copy `budgetMs` out of its getter (see
  // {@link workerView}). Harmless for THIS budget, which never moves, and kept identical to the holding
  // one so the trap cannot be reintroduced by copying the simpler sibling.
  return Object.assign(workerView(clock), {
    mayRepair(): Promise<RepairDecision> {
      const elapsed = clock.elapsedMs();
      return Promise.resolve<RepairDecision>(
        elapsed < clock.current()
          ? { ok: true }
          : {
              ok: false,
              reason: spentReason(clock.current(), elapsed, `so no repair was started (ADR-0581 D2)`),
            },
      );
    },
  });
}

/**
 * THE HOLD (ADR-0592). The same wall clock, except that a spent budget HOLDS the build at the repair
 * boundary instead of ending it: it announces itself on `channel`, waits up to `graceMs` for the
 * orchestrator to answer, and then extends the build or stops it.
 *
 * ## Why here, and not in the worker
 *
 * The clock is enforced at two places (ADR-0592 D1). Inside a running slice the worker reads
 * `remainingMs()` itself and is aborted by it; between slices the spine asks `mayRepair()`. Only the
 * second can hold, because holding the first means suspending a live model call — which Codex's single
 * non-interactive call per phase cannot do at all, and a hold that behaves differently per runtime is
 * worse than no hold (ADR-0588 D1's symmetry argument, one level down).
 *
 * So a slice already running when the clock expires is still stopped by its own deadline exactly as
 * ADR-0584 built it. What holds is the BUILD, before the next slice is handed out — which is why the
 * hold arrives up to one slice late, and never on the minute.
 *
 * ## Why every expired build reaches this
 *
 * A spent clock means a worker did not finish; a worker that did not finish leaves a check that fails;
 * and a failed check in a real build is routed by `repairOrEnd`, which asks this. The walk's care to
 * fall through rather than discard an exhausted slice (ADR-0020) is what carries an expired build here
 * rather than ending it where the slice stopped. The one exception is deliberate and is D7's: a failure
 * with no owner or no backward edge ends BEFORE this is asked, because an extension buys time for a
 * worker to act and there is no worker to act.
 *
 * ## The bound that makes a hold admissible
 *
 * A held build waits `graceMs` and not one millisecond longer, and its expiry is a stop. The owner's
 * standing rule is against building states that invite waiting, so the hold is admitted only with a
 * bound that cannot be waived. `graceMs <= 0` skips the hold entirely and behaves exactly as
 * {@link wallClockBudget} does.
 *
 * Nothing the channel does can hang the build or crash it: `open` and `close` failures are swallowed
 * (an unannounced hold still waits out its grace and still stops), and a `poll` that throws is read as
 * "no decision yet", so a channel that is broken for the whole grace ends the build the same way an
 * absent orchestrator does.
 */
export function holdingBudget(opts: {
  readonly channel: HoldChannel;
  readonly budgetMs?: number;
  readonly graceMs?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly pollMs?: number;
}): BuildBudget {
  const clock = budgetClock(opts);
  const graceMs = opts.graceMs ?? DEFAULT_HOLD_GRACE_MS;
  const pollMs = opts.pollMs ?? HOLD_POLL_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const extensions: ExtensionRecord[] = [];

  /** Swallow a channel failure: a broken channel must never be a way for a build to crash or hang. */
  const quietly = async (run: () => Promise<void>): Promise<void> => {
    try {
      await run();
    } catch {
      /* an unannounced or un-closed hold still waits out its grace and still stops */
    }
  };

  const hold = async (elapsed: number): Promise<RepairDecision> => {
    const heldAt = clock.now();
    await quietly(() =>
      opts.channel.open({
        budgetMs: clock.current(),
        elapsedMs: elapsed,
        graceMs,
        heldAt,
        extensions: [...extensions],
      }),
    );
    try {
      for (;;) {
        const decision = await opts.channel.poll().catch(() => undefined);
        if (decision !== undefined) {
          if (decision.kind === "stop") {
            return {
              ok: false,
              reason: spentReason(
                clock.current(),
                elapsed,
                `and the orchestrator stopped the build rather than extend it: ${decision.reason} (ADR-0592 D3)`,
              ),
            };
          }
          const fromBudgetMs = clock.current();
          clock.extendBy(decision.minutes * 60_000);
          const extension: ExtensionRecord = {
            heldAfterMs: elapsed,
            fromBudgetMs,
            toBudgetMs: clock.current(),
            reason: decision.reason,
          };
          extensions.push(extension);
          return { ok: true, extension };
        }
        // Checked AFTER the poll, so a decision already waiting when the grace runs out is still
        // honoured: the orchestrator answered in time and the build should not lose it to a race.
        if (clock.now() - heldAt >= graceMs) {
          return {
            ok: false,
            reason: spentReason(
              clock.current(),
              elapsed,
              `and the build HELD ${minutes(graceMs)} for the orchestrator to extend it or stop it ` +
                `(storytree node extend). No decision arrived, so the build stops unsigned rather than ` +
                `wait longer (ADR-0592 D3)`,
            ),
          };
        }
        await sleep(pollMs);
      }
    } finally {
      await quietly(() => opts.channel.close());
    }
  };

  return Object.assign(workerView(clock), {
    async mayRepair(): Promise<RepairDecision> {
      const elapsed = clock.elapsedMs();
      if (elapsed < clock.current()) return { ok: true };
      if (graceMs <= 0) {
        return {
          ok: false,
          reason: spentReason(clock.current(), elapsed, `so no repair was started (ADR-0581 D2)`),
        };
      }
      return hold(elapsed);
    },
  });
}

// ---------------------------------------------------------------------------
// What the loop records, and what it is given
// ---------------------------------------------------------------------------

/**
 * The check a repair answers (ADR-0582 D3):
 *  - `no-red` — CONFIRM_RED observed no red: the test passed before its implementation exists;
 *  - `red-per-test` — CONFIRM_RED's per-test review refused (ADR-0573 C1–C7);
 *  - `no-green` — CONFIRM_GREEN observed no green;
 *  - `green-per-test` — CONFIRM_GREEN's per-test review refused;
 *  - `escalation` — a failed CONFIRM_GREEN while an IMPLEMENT escalation stands (ADR-0569 D3): the
 *    test-writer's in-build revision;
 *  - `typecheck` — GATE's package typecheck was red.
 */
export type RepairCheck =
  | "no-red"
  | "red-per-test"
  | "no-green"
  | "green-per-test"
  | "escalation"
  | "typecheck"
  /** ADR-0585: a test that existed before the build was changed with no stated reason. */
  | "test-changes";

/** One repair, as the build envelope lists it (ADR-0582 D8). */
export interface RepairRecord {
  /** Where the check failed. */
  readonly failedAt: Phase;
  readonly check: RepairCheck;
  /** Which worker it went to: `AUTHOR_TEST` is the test-writer, `IMPLEMENT` the code-writer. */
  readonly to: AuthoringPhase;
  /** One line saying what failed. */
  readonly detail: string;
}

/**
 * What a real build supplies for repairs (`ProveSpec.repair`). Absent, the walk ends at the first failed
 * check exactly as it always has; that is every dry-run and live-smoke walk (ADR-0582 D9).
 */
export interface RepairPolicy {
  /** The build's budget, asked before every repair (D6). */
  readonly budget: RepairBudget;
  /**
   * Put aside what IMPLEMENT has written, so a revised test is re-observed red against the source the
   * build began from (D4). Resolves to the restore, which puts the implementation back byte for byte.
   */
  setAsideImplementation(): Promise<() => Promise<void>>;
  /** Who owns a red package typecheck, from the files it names; `undefined` when it names none (D3). */
  routeTypecheck(output: ProcessOutput): RepairOwner | undefined;
  /**
   * A fingerprint of everything the workers have written in the workspace, taken around a REPAIR slice
   * (D6). A slice that leaves it identical wrote nothing, and a repair that wrote nothing is refused —
   * handing the same check back again could only observe the same thing. Optional: without it a build
   * has only its budget, which is two hours of a stuck worker.
   */
  scopeFingerprint?: () => Promise<string | undefined>;
}

// ---------------------------------------------------------------------------
// The briefs (ADR-0582 D7)
// ---------------------------------------------------------------------------

/** Per-stream character cap on an observation carried into a brief — ADR-0571 D4's bound. */
export const REPAIR_STREAM_CHARS = 8_000;

/**
 * Tail-keep one stream at `max` characters, naming the omitted count when cut. Failures print last, so
 * the tail is the end a worker needs; a stream at or under the cap is returned exactly.
 */
export function clipTail(value: string, max: number = REPAIR_STREAM_CHARS): string {
  if (value.length <= max) return value;
  return `(kept the last ${max} characters; ${value.length - max} omitted)\n${value.slice(-max)}`;
}

/** One observation, labelled: its exit code, then each stream tail-kept. */
export function renderObservation(label: string, obs: ProcessOutput): string {
  return (
    `${label}, exit ${obs.exitCode === null ? "none (killed or timed out)" : String(obs.exitCode)}:\n` +
    `--- stdout ---\n${clipTail(obs.stdout) || "(empty)"}\n` +
    `--- stderr ---\n${clipTail(obs.stderr) || "(empty)"}`
  );
}

/**
 * The code-writer's view of the red it implements against (ADR-0582 D7): the spine's latest CONFIRM_RED
 * observation. Without it the worker spent a feedback run just to learn why its test fails. Empty when
 * the observation carried no process result (an executor that spawned nothing).
 */
export function redObservationSection(obs: ProcessOutput | undefined): string {
  if (obs === undefined) return "";
  return (
    `\n\n${renderObservation(
      "The spine's CONFIRM_RED observation of the test you implement against — why it is red now",
      obs,
    )}`
  );
}

/** What went wrong, as a repair brief says it. */
export interface RepairCause {
  readonly failedAt: Phase;
  readonly check: RepairCheck;
  /** The refusal, in the words the walk would return it with. */
  readonly reason: string;
  /** The observation behind the refusal, when there was one. */
  readonly observation?: ProcessOutput | undefined;
  /** The IMPLEMENT escalation the code-writer raised, for an in-build revision. */
  readonly escalation?: { readonly statement: string; readonly assertion: string } | undefined;
}

function escalationBlock(escalation: RepairCause["escalation"]): string {
  if (escalation === undefined) return "";
  return (
    `\n\nThe code-writer escalated that this test cannot be satisfied as written (\`unsatisfiable-test\`).\n` +
    `Statement, verbatim:\n${escalation.statement}\n\nAssertion, verbatim:\n${escalation.assertion}`
  );
}

function observationBlock(obs: ProcessOutput | undefined, failedAt: Phase): string {
  if (obs === undefined) return "";
  const label =
    failedAt === "GATE" ? "The package typecheck's output" : `The spine's ${failedAt} observation behind that refusal`;
  return `\n\n${renderObservation(label, obs)}`;
}

/**
 * How an objection reaches the spine (ADR-0582 D7): only the `escalate` tool records one. Shared by
 * every code-writer brief the loop writes.
 */
const ESCALATE_BY_TOOL =
  `If you conclude the test cannot be satisfied as written — including an EXISTING test your change ` +
  `legitimately needs updated — raise it with the \`escalate\` tool, quoting the assertion: the spine hands it ` +
  `to the test-writer in this same build. An objection written only in prose is not recorded, and the spine ` +
  `reads it as a failed implementation.`;

/**
 * The section a TEST-WRITER repair appends to the original AUTHOR_TEST brief. `implementationPresent`
 * says whether IMPLEMENT has run in this build, which is when the spine sets the implementation aside
 * for the red re-observation (ADR-0582 D4).
 */
export function testRepairSection(repairNumber: number, cause: RepairCause, implementationPresent: boolean): string {
  const implementation = implementationPresent
    ? ` The code-writer's implementation is on disk too. It is not yours to edit: the spine sets it aside ` +
      `to observe your revised test RED against the source this build began from, then restores it for the ` +
      `code-writer to resume.`
    : "";
  return (
    `\n\n---\n\nIN-BUILD REPAIR ${repairNumber} (ADR-0581 D4). A check in this build failed, and the spine is ` +
    `handing the TEST back to you in the SAME build. This is a repair, not a new attempt: nothing from earlier ` +
    `in the build was discarded, and your test file is on disk as it was left.${implementation}\n\n` +
    `What failed, at ${cause.failedAt}:\n${cause.reason}` +
    escalationBlock(cause.escalation) +
    observationBlock(cause.observation, cause.failedAt) +
    `\n\nWhat to do: revise the test so the check passes, then stop — the spine observes the red again itself. ` +
    `A test of something this unit must newly do must FAIL against the source this build began from. Change a ` +
    `test that existed before this build only where your revision genuinely needs it. A test that can only ` +
    `pass before its implementation exists is a guard-rail, which only the story's contract can declare ` +
    `(ADR-0572): raise it with the \`escalate\` tool rather than contorting it into a failure. If you conclude ` +
    `the contract cannot be tested as specified, raise that with the \`escalate\` tool too.`
  );
}

/**
 * The section a CODE-WRITER repair appends to the IMPLEMENT brief. `revision` is present when the check
 * failed right after a test revision (ADR-0582 D4): the revised test was re-observed red against the
 * source the build began from — the red observation above this section — and the restored
 * implementation does not satisfy it yet, so the code-writer is told why the test it knew changed.
 */
export function codeRepairSection(repairNumber: number, cause: RepairCause, revision?: RepairCause): string {
  const revised =
    revision === undefined
      ? ""
      : `\n\nThe test-writer revised the test in this build, because of what failed at ${revision.failedAt}:\n` +
        `${revision.reason}` +
        escalationBlock(revision.escalation) +
        `\n\nThe spine re-observed the revised test RED against the source this build began from — the red ` +
        `observation above — and restored your implementation, which does not satisfy it yet.`;
  return (
    `\n\n---\n\nIN-BUILD REPAIR ${repairNumber} (ADR-0581 D4). A check in this build failed, and the spine is ` +
    `handing the IMPLEMENTATION back to you in the SAME build. This is a repair, not a new attempt: your ` +
    `implementation is on disk as it was left, and the test is frozen — writes to it are refused.` +
    revised +
    `\n\nWhat failed, at ${cause.failedAt}:\n${cause.reason}` +
    observationBlock(cause.observation, cause.failedAt) +
    `\n\nWhat to do: fix the implementation so the check passes, then stop — the spine observes again itself. ` +
    ESCALATE_BY_TOOL
  );
}


// ---------------------------------------------------------------------------
// The typecheck router (ADR-0582 D3)
// ---------------------------------------------------------------------------

/**
 * Every file a TypeScript diagnostic names, in both of tsc's formats: `file(line,col): error TSnnnn`
 * (piped output) and `file:line:col - error TSnnnn` (pretty). A wrapper's line prefix (pnpm's
 * `<pkg> typecheck: `) is skipped, because the path is the run of non-space characters ending at the
 * position.
 */
const DIAGNOSTIC = /(\S+?\.[cm]?[jt]sx?)(?:\(\d+,\d+\):|:\d+:\d+ -) error TS\d+/g;

/** Every file the typecheck output names in a diagnostic, in order of first appearance. */
export function diagnosticFiles(output: ProcessOutput): string[] {
  const files: string[] = [];
  for (const stream of [output.stdout, output.stderr]) {
    for (const match of stream.matchAll(DIAGNOSTIC)) {
      const file = match[1];
      if (file !== undefined && !files.includes(file)) files.push(file);
    }
  }
  return files;
}

/** Every proper ancestor directory of a repo-relative path, nearest first (`a/b/c.ts` → `a/b`, `a`). */
function ancestorDirs(relPath: string): string[] {
  const dirs: string[] = [];
  let dir = path.posix.dirname(relPath);
  while (dir !== "." && dir !== "/" && dir !== "") {
    dirs.push(dir);
    dir = path.posix.dirname(dir);
  }
  return dirs;
}

/** What {@link routeTypecheckByFile} knows about the build. */
export interface TypecheckRouting {
  /** The test-writer's write scope, over repo-relative paths. */
  readonly isTestPath: (relPath: string) => boolean;
  /**
   * Repo-relative files the unit declares (its test and source files). tsc names files relative to the
   * package it checks, so a diagnostic path is also tried under every ancestor directory of these.
   */
  readonly anchors: readonly string[];
  /** The worktree root, to make an absolute diagnostic path repo-relative. */
  readonly worktreeRoot: string;
}

/**
 * Who owns a red package typecheck (ADR-0582 D3): `test` when EVERY file its diagnostics name is in the
 * test-writer's scope, `code` when any is not, and `undefined` when it names no file at all — a timeout
 * or a crash has no worker to go to. A heuristic, stated as one: a test-file error caused by the
 * implementation's types reaches the test-writer, whose revision is still re-observed red against the
 * base and green against the implementation.
 */
export function routeTypecheckByFile(output: ProcessOutput, routing: TypecheckRouting): RepairOwner | undefined {
  const files = diagnosticFiles(output);
  if (files.length === 0) return undefined;
  const prefixes = [...new Set(routing.anchors.flatMap((anchor) => ancestorDirs(anchor.replace(/\\/g, "/"))))];
  const isTestFile = (file: string): boolean => {
    let rel = file.replace(/\\/g, "/");
    if (path.isAbsolute(file)) {
      rel = path.relative(routing.worktreeRoot, file).replace(/\\/g, "/");
    }
    rel = rel.replace(/^\.\//, "");
    return routing.isTestPath(rel) || prefixes.some((prefix) => routing.isTestPath(`${prefix}/${rel}`));
  };
  return files.every(isTestFile) ? "test" : "code";
}

// ---------------------------------------------------------------------------
// The set-aside (ADR-0582 D4)
// ---------------------------------------------------------------------------

/** Run git in `cwd`, resolving its raw stdout; rejects on a non-zero exit. Injectable for tests. */
export type GitRunner = (args: readonly string[], cwd: string) => Promise<Buffer>;

/**
 * The REAL git runner the set-aside falls through to when no fake is injected — the one that runs in
 * production. Exported so a test can name and drive it: with it unexported, every set-aside test was
 * evidence about a fake, and this implementation was reached by nothing (`unproven-seam-default`).
 */
export const runGitBuffer: GitRunner = (args, cwd) =>
  new Promise<Buffer>((resolve, reject) => {
    execFile(
      "git",
      [...args],
      { cwd, encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
      (error, stdout) => {
        if (error === null) {
          resolve(stdout);
          return;
        }
        reject(new Error(`git ${args.join(" ")} failed: ${error.message}`, { cause: error }));
      },
    );
  });

/** NUL-separated git output → its non-empty records. */
function nulRecords(out: Buffer): string[] {
  return out
    .toString()
    .split("\0")
    .filter((record) => record.length > 0);
}

/** What {@link setAsideImplementation} puts aside, and how to put it back. */
export interface SetAside {
  /** The implementation files put aside, repo-relative and sorted. */
  readonly files: readonly string[];
  /** Put every file back exactly as it was before the set-aside — its bytes, or its absence. */
  restore(): Promise<void>;
}

/**
 * Put aside what IMPLEMENT wrote (ADR-0582 D4): every path in the implementation's scope that differs
 * from `baseSha` — modified, added or deleted, committed or not, untracked included — is returned to its
 * content at `baseSha`, or removed where `baseSha` lacks it. Ignored files are left alone (a build never
 * authors them). The index is never touched, so the spine's own scoped commit sees the working tree
 * exactly as the workers left it once {@link SetAside.restore} has run.
 */
export async function setAsideImplementation(args: {
  readonly worktreeRoot: string;
  readonly baseSha: string;
  readonly isImplementationPath: (relPath: string) => boolean;
  readonly git?: GitRunner;
}): Promise<SetAside> {
  const git = args.git ?? runGitBuffer;
  const root = args.worktreeRoot;
  const changed = nulRecords(await git(["diff", "--name-only", "-z", "--no-renames", args.baseSha], root));
  const untracked = nulRecords(await git(["ls-files", "--others", "--exclude-standard", "-z"], root));
  const files = [...new Set([...changed, ...untracked])]
    .map((p) => p.replace(/\\/g, "/"))
    .filter((p) => args.isImplementationPath(p))
    .sort();

  const saved = new Map<string, Buffer | null>();
  for (const file of files) {
    saved.set(file, await readFile(path.join(root, file)).catch(() => null));
  }
  for (const file of files) {
    const atBase = await git(["show", `${args.baseSha}:${file}`], root).catch(() => null);
    await writeOrRemove(path.join(root, file), atBase);
  }
  return {
    files,
    async restore(): Promise<void> {
      for (const [file, content] of saved) {
        await writeOrRemove(path.join(root, file), content);
      }
    },
  };
}

/**
 * A fingerprint of everything authored in the worktree so far (ADR-0582 D6): the content of every
 * tracked change against HEAD, plus every untracked file's path and bytes. Content, never status — a
 * file that is already dirty stays dirty while its content changes, so a status line cannot see a
 * rewrite — and nothing time-varying, so two slices that wrote the same bytes fingerprint alike.
 * Ignored files are excluded: a build never authors them, and build output would churn the value.
 *
 * `undefined` when git cannot answer — a workspace that is no repository at all (the synthetic
 * workspaces offline tests drive), or any git failure. UNKNOWN, never "nothing was written": the
 * refusal it feeds fires only on positive evidence that two reads are the same.
 */
export async function worktreeScopeFingerprint(args: {
  readonly worktreeRoot: string;
  readonly git?: GitRunner;
}): Promise<string | undefined> {
  const git = args.git ?? runGitBuffer;
  const root = args.worktreeRoot;
  try {
    const parts: Buffer[] = [await git(["diff", "HEAD", "--no-color", "--no-ext-diff", "--no-renames"], root)];
    for (const file of nulRecords(await git(["ls-files", "--others", "--exclude-standard", "-z"], root)).sort()) {
      parts.push(Buffer.from(`\0${file}\0`), await readFile(path.join(root, file)).catch(() => Buffer.alloc(0)));
    }
    return createHash("sha256").update(Buffer.concat(parts)).digest("hex");
  } catch {
    return undefined;
  }
}

/** Write `content` to `target` (creating its directory), or remove `target` when `content` is null. */
async function writeOrRemove(target: string, content: Buffer | null): Promise<void> {
  if (content === null) {
    await rm(target, { force: true });
    return;
  }
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}
