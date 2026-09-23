// The gate's RUNNER — the PURE half. Runs every step, records each one, reports per-step.
//
// WHY THIS EXISTS. `pnpm gate` was a single `&&` chain, so the FIRST red aborted it and left every
// later step UNRUN — reported as nothing at all rather than as unverified. Three measured
// consequences, all on this repo, all recorded on `verification-integrity-arc`:
//
//   - 2026-07-29  a mid-gate wall-clock flake in packages/forest-world aborted the chain before the
//                 three corpus checks. Run by hand afterwards, `check:corpus-content` reported
//                 `RED — corpus-content drain ceiling breached: 1 value-drift`: a real landing
//                 blocker the gate run never surfaced.
//   - 2026-08-02  `check:declared` red at link 10 on FOUR uncommitted paths another session had left
//                 in the shared primary checkout. Typecheck, the whole test suite and eleven later
//                 checks never ran; verifying the branch took ~25 minutes of manual re-runs across
//                 three invocations, and all fourteen were green. Per ADR-0245 D5.2 D3 the lobby was
//                 not that session's to clean, so NO in-session action could have produced one green
//                 gate run.
//   - 2026-08-03  `check:verification-decay` red at link ~19 (a breach on main, not the branch's)
//                 meant the six rungs behind it never ran for any session, each invoked by hand.
//
// The failure is silent in the direction that costs most: an aborted chain reports one red and says
// nothing about the rest, while `asset:unrun-check-is-unverified-not-refuted` is explicit that a
// check which COULD NOT RUN is UNVERIFIED, not refuted. Both readings — "the gate failed" and "not
// my problem, skip it" — are available from the same output. Hence FOUR distinct statuses here, and
// neither `not-run` nor `skip` is ever collapsed into a neighbour.
//
// THE INNER HALF IS NOW CLOSED TOO — ADR-0276 increment 4 is complete. This module's first landing
// fixed only the OUTER half of the 2026-07-29 evidence: a flake stopped costing the thirteen steps
// BEHIND `pnpm -r test`, but `pnpm -r` still halted at its first failing package, so a flake in
// `packages/forest-world` still hid `packages/cli`'s suite INSIDE that single step. `GATE_PLAN` now
// declares both expensive legs with `--no-bail`, so every workspace runs and every workspace's
// verdict is reported. That is `pnpm`'s behaviour rather than this module's shape, which is why it
// was correctly held back from the first landing; it lands here beside `skip` because together they
// are the increment's last element — "an aggregate scoreboard naming every red AND EVERY SKIP".
//
// THIS IS STRICTLY STRONGER THAN THE CHAIN IT REPLACES, and that is the property to preserve when
// editing: MORE steps actually execute, no check's own semantics change, no ceiling moves, and any
// red still fails the gate. {@link gateExitCode} is deliberately "green only if EVERY step passed" —
// a `not-run` step can never bank a pass, because a check that cannot fail proves nothing — a gate
// that cannot go red is not a gate, and that is this arc's whole subject.
//
// REPORT-EVERYTHING, WITH NO HARD PRECONDITIONS — a deliberate call, not an omission. The
// alternative design is a plan where some step's failure makes later results MEANINGLESS, so they
// are honestly reported `not-run` rather than executed. Each of the 25 steps was checked against
// that bar and none clears it: every `check:*` reads its own inputs off disk or the live store, and
// the two expensive legs are independent of each other because tests run TRANSPILE-ONLY through tsx,
// so a type error does not stop the suite from producing a real verdict. "Likely to also be red" is
// not the same as "meaningless", and only the latter would justify withholding a step. If a genuine
// precondition ever appears, it belongs in `gate-order.ts` beside the plan as declared data — never
// as an early `return` here.
//
// `not-run` is therefore reachable by three routes, all real: the opt-in fail-fast mode (for the
// inner loop, where the first red is the whole answer); INTERRUPTION via {@link
// RunGateInput.shouldStop}; and a step KILLED BY A SIGNAL mid-flight ({@link
// GateExecution.unverified}). The last two matter because a foreground gate run exceeding the
// harness's fixed tool-call ceiling and being killed with no verdict at all is itself a measured trap
// — `asset:merge-ceremony` step 2 mandates backgrounding for exactly that reason, and this landing
// makes that guidance MORE load-bearing, not less, because a failing run no longer stops early.
//
// Pure: no spawning, no clock of its own, no process access. The caller injects execution and time.

import type { GateStep } from "./gate-order.js";

/**
 * A step's outcome. FOUR values, and the two that are neither pass nor fail are the point: `not-run`
 * and `skip` are both UNVERIFIED — neither is a pass (nothing was checked) and neither is a fail
 * (nothing was found wanting).
 *
 * `not-run` and `skip` are the same EPISTEMIC class and different CAUSES, which is why they are not
 * one value. `not-run` means the runner never asked; `skip` means the step was asked, answered "I
 * have no inputs", and verified nothing. A reader needs to tell those apart to know whether re-running
 * would help.
 */
export type GateStepStatus = "pass" | "fail" | "not-run" | "skip";

/**
 * The exit code a step uses to declare "I ran, and I verified NOTHING" — the gate's opt-in skip
 * protocol (ADR-0276 increment 4, "an aggregate scoreboard naming every red AND EVERY SKIP").
 *
 * WHY AN EXIT CODE AND NOT OUTPUT SCRAPING. The checks already print `SKIP` to stdout, and reading
 * that would be the cheapest change. It is also the exact trap PR #1133 hit one layer up:
 * `check-verification-decay.ts` scraped `pnpm check:x` out of the `gate` script's TEXT and went
 * silently BLIND the moment the chain it was reading was replaced. A surface that another surface
 * parses without either declaring the dependency is an invisible consumer. An exit code is a contract
 * the step OPTS INTO and the compiler can point at.
 *
 * WHY 3. 0 is pass and 1 is the conventional failure both `process.exit(1)` and an uncaught throw
 * produce; 2 is what a shell reports for misuse and what several tools use for "bad arguments". 3 is
 * the first value no path here already means, so a step cannot land on it by accident — which matters,
 * because a step that accidentally reported SKIP would be a failure the gate stopped counting.
 *
 * A SKIP DOES NOT RED THE GATE ({@link gateExitCode}) — deliberately, and it is the one place this
 * module tolerates an unverified step in a green run. Some checks legitimately have no inputs in some
 * environments (`check:web-grounding` without the `web/` submodule locally), and redding those runs
 * would train sessions to ignore the gate. What was missing was never the exit code; it was that
 * PASS was printed over it, so opting out and verifying were indistinguishable. This makes the skip
 * VISIBLE without making it BLOCKING.
 */
export const GATE_SKIP_EXIT_CODE = 3;

/**
 * The exit code a PARTIAL run uses for "every step I SELECTED passed — and I was not a whole gate"
 * (the re-run surface, `gate-rerun.ts`).
 *
 * WHY A PARTIAL RUN NEEDS ITS OWN CODE. A partial re-run must never exit 0 — that is the design
 * constraint the whole re-run surface is fenced by, and {@link gateExitCode} enforces it. But without
 * a second non-zero value the two outcomes a session actually re-runs to tell apart — "the flake
 * cleared" and "the step is genuinely red" — would both be 1, i.e. indistinguishable. That is this
 * module's own defect one layer along: a verdict collapsing two states a reader needs separated.
 *
 * WHY 4. 0 is a whole-gate pass, 1 is failure, 2 is shell misuse, 3 is {@link GATE_SKIP_EXIT_CODE}.
 * 4 is the first value no path here already means.
 *
 * IT IS NOT A GREEN, AND NOTHING READS IT AS ONE. It is non-zero, so `scripts/gate-bg.sh`'s sentinel
 * (and through it `storytree dispatch`), every `&&` chain and every caller reading only the exit code
 * still sees "not green" — deliberately. (`scripts/gate-bg.mjs` no longer reads the gate's status at
 * all: it detaches the run and returns, so what carries the 4 is the `.exit` file the shell writes.)
 * CI never runs a partial gate, so no CI step can observe it; the trap recorded against the skip
 * protocol (exit 3 is a contract with `gate-run.ts`, while `.github/workflows/ci.yml` reads ANY
 * non-zero as a hard red) does not reach here, and must not be re-opened by wiring `--only` into CI.
 */
export const GATE_PARTIAL_EXIT_CODE = 4;

/**
 * The note a {@link RunGateInput.skipIsFailure} run attaches to a step that declared a skip — so the
 * summary says WHY a step that "only skipped" is red, instead of printing a bare exit 3 as a failure.
 */
export const REFUSED_SKIP_NOTE =
  "declared a SKIP (exit 3), which a CI run does not accept — CI supplies every input a " +
  "skip-capable check needs, so a skip there means an input never arrived";

/** What one executed step reported. */
export interface GateExecution {
  /** The process exit code; `null` when the step could not be spawned at all. */
  readonly exitCode: number | null;
  /** Free text for the summary — a spawn error, typically. */
  readonly note?: string;
  /**
   * The step started but produced NO verdict — killed by a signal, typically. It is `not-run`
   * (unverified), never `fail`: nothing was found wanting, the answer simply never arrived. Reporting
   * a killed step as a failure is the same dishonesty as reporting a skipped one as absent.
   */
  readonly unverified?: boolean;
}

export interface GateStepResult {
  readonly command: string;
  readonly status: GateStepStatus;
  /** `null` for a step that never ran, and for one that could not be spawned. */
  readonly exitCode: number | null;
  readonly durationMs: number;
  readonly note?: string;
}

export interface RunGateInput {
  readonly steps: readonly GateStep[];
  /**
   * Run one step and report its exit code. Injected, so tests drive the runner with stubs.
   *
   * ASYNC-CAPABLE SINCE THE LIVENESS SIGNAL (`shared-box-session-ownership-arc` end state 4). The real
   * executor used `spawnSync`, which BLOCKS the runner's event loop for the whole step — so the gate
   * could not emit a heartbeat while a step was running, no timer could fire, and there was nothing to
   * hook. Awaiting the step here is what makes a liveness signal possible at all; the walk itself is
   * still strictly sequential, because steps share a working tree and a live DB.
   */
  readonly execute: (step: GateStep, index: number) => GateExecution | Promise<GateExecution>;
  /**
   * Opt-in fail-fast for the inner loop (default false — run every step). The steps after the first
   * failure are reported `not-run`, which is exactly what they are; they are never omitted, because
   * an absent row is the ambiguity this whole module removes.
   */
  readonly failFast?: boolean;
  /**
   * A step's {@link GATE_SKIP_EXIT_CODE} counts as a FAILURE, not a skip (default false). Set by
   * `pnpm gate --ci` (ADR-0606 D3), and it reproduces what CI always did rather than adding a rule:
   * a plain workflow step read ANY non-zero exit as a failure, and a check whose skip CI accepts
   * never exits 3 there — it withholds the code and exits 0 (`skipDisposition`, `mutation-diff.ts`).
   * So the only exit 3 CI can see is a skip CI did NOT sanction: a browser that never installed, a
   * `web/` clone that never happened — the vacuous-green shape the old workflow comments warned of.
   */
  readonly skipIsFailure?: boolean;
  /** Checked before each step; `true` stops the walk and reports the remainder `not-run`. */
  readonly shouldStop?: () => boolean;
  /**
   * Steps this run deliberately does NOT execute, keyed command → the reason for its `not-run` row
   * (the re-run surface, `gate-rerun.ts`). The step still gets a row, still in plan order — the
   * selection changes what RAN, never what is REPORTED.
   *
   * DELIBERATELY NOT A FILTER ON `steps`. Dropping unselected steps from the array would satisfy the
   * runner just as well and would destroy the two properties this module exists for: every planned
   * step gets exactly one row, and `gate-run.ts` can re-judge the ordering invariant over the plan it
   * is actually about to walk. A partial run that quietly shortened the plan would report a complete
   * table over an incomplete gate — the exact shape of dishonesty being fixed.
   */
  readonly unselected?: ReadonlyMap<string, string>;
  readonly onStepStart?: (step: GateStep, index: number, total: number) => void;
  readonly onStepDone?: (result: GateStepResult, index: number, total: number) => void;
  /** Injected clock (default `Date.now`) so durations are reportable without a real timer in tests. */
  readonly now?: () => number;
}

/**
 * Run the plan and return ONE result per step, in plan order — always `steps.length` of them, so a
 * caller can never mistake an absent row for a passing one.
 */
export async function runGate(input: RunGateInput): Promise<GateStepResult[]> {
  const { steps, execute } = input;
  const failFast = input.failFast ?? false;
  const now = input.now ?? Date.now;
  const total = steps.length;
  const results: GateStepResult[] = [];

  let stopped: string | undefined;
  for (const [index, step] of steps.entries()) {
    // The selection is checked FIRST and never sets `stopped`: "you did not ask for this one" is both
    // the truer reason and independent of an interruption, and an unselected step must not make the
    // walk look interrupted for the steps behind it.
    const notSelected = input.unselected?.get(step.command);
    if (notSelected !== undefined) {
      const result: GateStepResult = {
        command: step.command,
        status: "not-run",
        exitCode: null,
        durationMs: 0,
        note: notSelected,
      };
      results.push(result);
      input.onStepDone?.(result, index, total);
      continue;
    }

    if (stopped === undefined && input.shouldStop?.() === true) stopped = "interrupted";

    if (stopped !== undefined) {
      const result: GateStepResult = {
        command: step.command,
        status: "not-run",
        exitCode: null,
        durationMs: 0,
        note: stopped,
      };
      results.push(result);
      input.onStepDone?.(result, index, total);
      continue;
    }

    input.onStepStart?.(step, index, total);
    const started = now();
    const exec = await execute(step, index);
    const durationMs = now() - started;
    const declaredSkip = exec.exitCode === GATE_SKIP_EXIT_CODE;
    const status: GateStepStatus =
      exec.unverified === true
        ? "not-run"
        : exec.exitCode === 0
          ? "pass"
          : declaredSkip && input.skipIsFailure !== true
            ? "skip"
            : "fail";
    const stepResult: Omit<GateStepResult, "note"> = {
      command: step.command,
      status,
      exitCode: status === "not-run" ? null : exec.exitCode,
      durationMs,
    };
    const notes = [
      ...(exec.note !== undefined ? [exec.note] : []),
      // Only a skip this run REFUSED carries the note; an ordinary red never does.
      ...(status === "fail" && declaredSkip ? [REFUSED_SKIP_NOTE] : []),
    ];
    const result: GateStepResult =
      notes.length > 0 ? { ...stepResult, note: notes.join("; ") } : stepResult;
    results.push(result);
    input.onStepDone?.(result, index, total);

    // A step that was killed answers for the whole walk: whatever stopped it is still in force.
    if (status === "not-run") stopped = "interrupted";
    else if (status === "fail" && failFast) stopped = "skipped after an earlier failure (--fail-fast)";
  }

  return results;
}

export interface GateTally {
  readonly pass: number;
  readonly fail: number;
  readonly notRun: number;
  readonly skip: number;
}

export function tallyGate(results: readonly GateStepResult[]): GateTally {
  return {
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    notRun: results.filter((r) => r.status === "not-run").length,
    skip: results.filter((r) => r.status === "skip").length,
  };
}

/**
 * A run that deliberately executed only PART of the plan — the re-run surface's context, resolved by
 * `gate-rerun.ts` and passed to the two reporting functions here so neither can accidentally phrase a
 * partial run as a whole one.
 */
export interface PartialRun {
  /** The commands this run selected for execution. */
  readonly selected: ReadonlySet<string>;
  /** One line naming what this run covers and what it does not. */
  readonly notice: string;
}

/**
 * The gate's exit code. GREEN ONLY IF EVERY STEP PASSED OR DECLARED A SKIP — a `not-run` step is
 * unverified with nobody having asked, and that is not green. An empty result set is likewise
 * non-zero: a run that proved nothing has not earned a pass.
 *
 * THE SKIP CARVE-OUT IS NARROW AND IS NOT A HOLE. A step reaches `skip` only by exiting the reserved
 * {@link GATE_SKIP_EXIT_CODE} — an explicit, opt-in declaration on a path its own author wrote,
 * never a default and never inferred. `not-run` gets no such carve-out precisely because nothing
 * declared it. The honesty this buys is in the REPORT ({@link renderGateSummary}), which names every
 * skipped step and says in terms that green with skips is narrower than green: the defect being fixed
 * was that PASS was printed over an opt-out, not that the exit code was 0.
 *
 * A PARTIAL RUN CAN NEVER REACH 0, AND THAT IS THE RE-RUN SURFACE'S WHOLE FENCE. Given a
 * {@link PartialRun} the verdict is judged over the SELECTED steps only — the unselected ones are
 * `not-run` and prove nothing — and the best available answer is {@link GATE_PARTIAL_EXIT_CODE},
 * never 0. A partial run that selected nothing, or whose own selected step was killed, is 1: it did
 * not even earn the partial code.
 */
export function gateExitCode(results: readonly GateStepResult[], partial?: PartialRun): number {
  if (results.length === 0) return 1;
  if (partial !== undefined) {
    const selected = results.filter((r) => partial.selected.has(r.command));
    if (selected.length === 0) return 1;
    return selected.every((r) => r.status === "pass" || r.status === "skip")
      ? GATE_PARTIAL_EXIT_CODE
      : 1;
  }
  return results.every((r) => r.status === "pass" || r.status === "skip") ? 0 : 1;
}

const GLYPH = {
  pass: "PASS   ",
  fail: "FAIL   ",
  "not-run": "NOT RUN",
  skip: "SKIP   ",
} satisfies Record<GateStepStatus, string>;

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, "0")}s`;
}

/**
 * The per-step summary table. Every step appears, with its own status — the whole point being that a
 * reader can tell a step that FAILED from a step that NEVER RAN without reconstructing the plan.
 */
export function renderGateSummary(
  results: readonly GateStepResult[],
  partial?: PartialRun,
): string[] {
  const tally = tallyGate(results);
  const width = Math.max(0, ...results.map((r) => r.command.length));
  const lines = ["", "=== gate summary ===", ""];

  for (const r of results) {
    // A KILLED step is `not-run` but did burn wall clock; hiding that would lose the one signal that
    // separates it from a step that was never reached.
    const timing =
      r.status === "not-run" && r.durationMs === 0 ? "" : `  ${formatDuration(r.durationMs)}`;
    const code = r.status === "fail" && r.exitCode !== null ? `  (exit ${r.exitCode})` : "";
    const note = r.note !== undefined ? `  — ${r.note}` : "";
    lines.push(`  ${GLYPH[r.status]}  ${r.command.padEnd(width)}${timing}${code}${note}`);
  }

  lines.push(
    "",
    `  ${tally.pass} passed, ${tally.fail} failed, ${tally.skip} skipped, ${tally.notRun} not run  ` +
      `(of ${results.length})`,
  );

  if (tally.fail > 0) {
    lines.push("", "  FAILED:");
    for (const r of results.filter((x) => x.status === "fail")) lines.push(`    ${r.command}`);
  }
  if (tally.notRun > 0) {
    lines.push(
      "",
      "  NOT RUN is UNVERIFIED, not passed — these steps were never executed, so they found",
      "  nothing and proved nothing. Re-run them before treating the gate as answered:",
    );
    for (const r of results.filter((x) => x.status === "not-run")) lines.push(`    ${r.command}`);
  }
  if (tally.skip > 0) {
    lines.push(
      "",
      "  SKIP is UNVERIFIED too — these steps RAN and declared they had nothing to check, so",
      "  they proved nothing about this branch. They do not red the gate; they do narrow what",
      "  green means. Supply their missing inputs to actually verify them:",
    );
    for (const r of results.filter((x) => x.status === "skip")) lines.push(`    ${r.command}`);
  }

  // A PARTIAL RUN GETS ITS OWN VERDICT VOCABULARY, and the reason is that the honest whole-gate word
  // for it — RED — would be actively misleading. A session re-running one flaked step and reading
  // `GATE RED` would conclude something failed, when what happened is that nine steps were never
  // asked. So the partial verdict states the arithmetic instead of borrowing a word: how many ran, how
  // many did not, whether the ones that ran passed, and that none of it gates anything.
  if (partial !== undefined) {
    const selected = results.filter((r) => partial.selected.has(r.command));
    const failed = selected.filter((r) => r.status === "fail");
    const unverified = selected.filter((r) => r.status === "not-run");
    lines.push(
      "",
      `  PARTIAL RUN — NOT A GATE VERDICT. ${selected.length} of ${results.length} planned step(s) ` +
        `executed; ${results.length - selected.length} were not.`,
      `  ${partial.notice}`,
    );
    if (failed.length > 0) {
      lines.push(`  ${failed.length} of the executed step(s) FAILED — see FAILED above.`);
    } else if (unverified.length > 0) {
      lines.push(
        `  ${unverified.length} of the executed step(s) produced NO verdict (killed or interrupted).`,
      );
    } else {
      lines.push(
        `  Every executed step passed or declared a skip. That says nothing about the ` +
          `${results.length - selected.length} step(s) above that did not run.`,
      );
    }
    lines.push("  Run `pnpm gate` over the whole plan for a verdict that gates.", "");
    return lines;
  }

  const green = gateExitCode(results) === 0;
  lines.push(
    "",
    green && tally.skip > 0
      ? `  GATE GREEN, NARROWED — every step ran, but ${tally.skip} verified nothing (see SKIP above).`
      : green
        ? "  GATE GREEN — every step ran and passed."
        : "  GATE RED — the gate is green only when every step ran and passed or declared a skip.",
    "",
  );
  return lines;
}
