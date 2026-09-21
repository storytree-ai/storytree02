/**
 * The build's time budget, as a WORKER sees it (ADR-0581 D2: time, not turns, is the runaway brake).
 *
 * One budget covers a whole build — both authoring phases and every in-build repair — and the spine
 * holds the single object. A worker never owns it and never resets it: it asks how much is left, and
 * stops when that reaches zero. The orchestrator sets the budget when it launches the build; two
 * hours is only the default.
 *
 * Why an interface here rather than the concrete clock: `@storytree/agent` imports no other storytree
 * package, and the concrete budget lives with the spine, which also asks it whether another in-build
 * repair may start (`RepairBudget.mayRepair()`, ADR-0582 D6). One object, two contracts — the spine's
 * poll between rounds, and this remaining-time read inside a running slice.
 */

import type { AuthoringPhase } from "./phase-author.js";

/** What a worker may ask about the build's budget. Satisfied structurally by the spine's own clock. */
export interface WorkerTimeBudget {
  /**
   * Milliseconds left of the build's budget. Zero or less means spent: a slice that has not started
   * must not start, and a slice that is running is stopped.
   */
  remainingMs(): number;
  /** The whole budget, so a stop can name it in the plain reason it reports. */
  readonly budgetMs: number;
}

/**
 * The clock a worker's own bounds run on. Injectable for one reason: a bound RELEASED when the slice
 * settles leaves no trace in anything the slice returns, so only a test holding the clock can hold
 * that release to account — the same reason `CodexBoundClock` exists.
 */
export interface WorkerBoundClock {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  /**
   * Takes `undefined` so a caller can release a deadline it may never have armed without a
   * `!== undefined` guard around a no-op — a guard nothing can falsify, and so nothing can test.
   */
  clearTimeout(handle: ReturnType<typeof setTimeout> | undefined): void;
  /**
   * The current instant in milliseconds — what a helper's duration is measured with (ADR-0589 D3).
   *
   * It lives on THIS interface, beside the deadline, rather than on a clock of its own, because the
   * two readings answer the same question about the same slice: how much of the build's budget went
   * where. A helper timed on a second clock could report eleven minutes inside a slice the deadline
   * says ran for nine, and nothing in the envelope would show which reading was wrong. One object
   * also means one injection: a test that controls the deadline controls the durations too.
   */
  now(): number;
}

/** Minutes, floored, so an unspent minute never reads as spent. The unit every stop reports in. */
export function budgetMinutes(ms: number): string {
  return `${Math.floor(ms / 60_000)} min`;
}

/**
 * The plain reason a budget stop reports, in ONE wording for both runtimes (ADR-0581 D2: "it fails
 * closed with a plain reason, e.g. `time budget of 120 min spent at IMPLEMENT`"). It names the phase
 * because that is what a reader needs first: which half of the build ran out of time.
 */
export function budgetSpentError(phase: AuthoringPhase, budgetMs: number): string {
  return `the build's time budget of ${budgetMinutes(budgetMs)} is spent at ${phase}`;
}

/**
 * The per-slice FEEDBACK-RUN cap (ADR-0587), which mirrors the turn ceiling's shape exactly
 * (ADR-0584 D5): an explicit value always wins; otherwise a budgeted build is UNCAPPED and an
 * unbudgeted one keeps the old default.
 *
 * Why uncapped rather than merely generous: a run cap protects neither the evidence (the spine
 * observes red and green itself, out of band) nor the outside world (a feedback run spawns a
 * command the spine composed). All it ever bounded was a runaway, and the build's wall clock now
 * bounds that — while charging the time honestly, since feedback time is build time (ADR-0581 D3).
 * Five was the figure that made `run_tests` unusable: running the existing tests twice and the
 * unit's own proof three times spends the whole allowance before anything has been fixed.
 *
 * Takes the BUDGET rather than a boolean so the two call sites are pass-throughs with no test of
 * their own to get wrong — the decision is here, where one test reaches it.
 */
export function feedbackRunCap(explicit: number | undefined, budget: WorkerTimeBudget | undefined): number {
  if (explicit !== undefined) return explicit;
  return budget === undefined ? DEFAULT_FEEDBACK_RUNS_WITHOUT_A_BUDGET : Number.POSITIVE_INFINITY;
}

/** The pre-ADR-0587 cap, still the bound for any caller that wires no time budget. */
export const DEFAULT_FEEDBACK_RUNS_WITHOUT_A_BUDGET = 5;

/**
 * True when the budget has nothing left. Read before a slice starts AND after one is stopped: a
 * budget of zero or less is spent whatever else is true, which is what makes a zero budget a refusal
 * rather than an unbounded run.
 */
export function budgetIsSpent(budget: WorkerTimeBudget): boolean {
  return budget.remainingMs() <= 0;
}
