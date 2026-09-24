// ⚠ UNWIRED — part of retired `check:test-timing`, which ADR-0311 D2 removed from the gate on
// 2026-08-05. This module is the ceilings and their evidence; its entrypoint
// `check-test-timing.ts` is invoked by nothing, and it is reached only from there and from its
// own tests — so those tests stay GREEN while it enforces NOTHING. Kept deliberately (ADR-0311
// D5), not forgotten; re-wiring needs fresh production-catch evidence AND an ADR, never just the
// wiring.
// Tombstone: the retired check's own `retired:` declaration (ADR-0606 D6), held by `gate-order.test.ts`.
//
// What follows is retained as written — read it as what this DID, not as current gate policy.
//
// The test-timing drain ceiling — the PURE, IO-free core of `check:test-timing`.
//
// ADR-0276 D3 asked for "a fail-closed `check:test-timing` in the gate + CI — the drain-ceiling
// pattern (ADR-0252 D3) over wall-clock measurement in gate-tier test files (`performance.now` /
// `process.hrtime`), ceiling = the one sanctioned env-gated survivor (routing), any new file blocked
// with the remedy named". This is that ceiling. The sweep that feeds it lives in
// `test-timing-gate.ts`; the thin `check-test-timing.ts` sets the exit code.
//
// THE MEASURED DEFECT, as inputs → wrong outcome. Not an argument: the class was inventoried across
// all 24 gate-tier workspaces on 2026-07-31 (ADR-0276 Context) and its cost was counted.
//
//   PR #1010  (07-29)  routing 'under 2s'  ->  4737 ms loaded, 6185 ms ISOLATED   red, innocent
//   overnight (07-31)  routing 'under 2s'  ->  3795 ms                            red, innocent
//   quiet box (07-31)  routing 'under 2s'  ->   386 ms                            green
//
// Same code, same assertion, 16× spread — the bound measured CPU starvation of a box shared with 5–6
// concurrent sessions. 3 of 4 overnight gate runs on DOCS-ONLY diffs went red on this class, each
// costing a 9–42 min re-run plus ~8 min proving innocence, and across its whole life it caught zero
// real regressions. Increment 1 put the bound behind `STORYTREE_PERF=1`. ADR-0276's Consequences
// then named exactly what was left: "Until increment 3 lands, nothing but review stops a NEW
// wall-clock assertion entering; the window is accepted as small (days, not weeks)." It opened
// 2026-07-31; this closes it.
//
// TWO INDEPENDENT AXES, each redding on its own and NEVER summed (the `check:friction-drain` /
// `check:surface-coverage` shape). They mean different things and neither subsumes the other.
//
//   - UNSANCTIONED — a wall-clock API in a gate-tier test file that is not the sanctioned survivor.
//     The class ADR-0276 fences; what a NEW test file trips.
//   - UNGATED SANCTIONED — the survivor stopped earning its exemption: its `process.env.STORYTREE_PERF`
//     guard is gone, or the allow-list names a file that no longer exists. Without this axis the
//     allow-list is a blanket pardon — deleting one `if` line would restore the exact flake
//     increment 1 removed while the unsanctioned count sat honestly at zero, and a dead entry would
//     silently pardon any future file at that path.
//
// A count-only ceiling over their SUM would let either hide inside the other's headroom. At 0/0
// that is moot arithmetically but not structurally: the axes are reported and remedied differently
// (write the test another way vs. restore the gate / drop the entry), so they stay separate lines.
//
// FAIL-CLOSED ON THE GAPS, FAIL-OPEN ON THE SUBSTRATE — ADR-0168 D4's posture. Here the substrate
// risk runs the OPPOSITE way from `check:surface-coverage`, and that is worth stating plainly: an
// empty seed there turns a healthy repo RED, while a broken walk here turns a breached repo GREEN.
// A vacuous sweep — zero gate-tier workspaces, or zero test files — cannot conclude "clean", so it
// is reported as UNVERIFIED and never counted as a pass. The anti-vacuity floor is pinned where it
// belongs, in `test-timing-drain.test.ts`'s BASELINE test against the real repo (474 test files
// across 24 workspaces on 2026-08-03) — the same place `surface-coverage-drain.test.ts` pins its
// process count. A ceiling cannot police its own inputs; the suite can.
//
// IT GATES THE PATTERN ONLY. No count here decides whether a routine is fast enough — that judgement
// moves to the opt-in tier where it means something (`STORYTREE_PERF=1 pnpm --filter
// @storytree/forest-world test`). A breach is discharged by writing the test another way, never by
// raising a number (ADR-0252 D3: a ceiling's remedy is a drain, never a raise).
//
// PURE by construction: no `node:` import, no filesystem, no clock — which for THIS gate is not a
// stylistic preference. A wall-clock fence that itself measured wall-clock time would be the joke
// version of the defect it exists to remove.

/** The tunable ceiling constants — one per axis, never summed. */
export interface TestTimingDrainConfig {
  /** Wall-clock occurrences in unsanctioned gate-tier test files. Strictly above this reds. */
  unsanctionedCeiling: number;
  /** Sanctioned entries that no longer earn their exemption. Strictly above this reds. */
  ungatedSanctionedCeiling: number;
}

/**
 * THE CEILINGS, both BASELINED on a real sweep rather than picked in advance, and both at ZERO —
 * the sweep of 2026-08-03 found the repo already clean on both axes (474 test files, 24 gate-tier
 * workspaces, exactly one wall-clock file and it is the sanctioned, still-env-gated survivor).
 *
 * Shipping a ceiling at exactly what a real run found means it ships GREEN on an honest baseline (a
 * breach is strictly `>`), so it can only ever be TIGHTENED — WITHIN A FIXED MEASUREMENT APERTURE
 * (ADR-0269, which amends ADR-0252 D3). Widening what the sweep SCANS is the one legitimate upward
 * move, under ADR-0269's evidence bar; absorbing an un-drained timing assertion is not, and stays
 * forbidden.
 *
 * ZERO IS AVAILABLE HERE ONLY BECAUSE INCREMENT 1 ALREADY DID THE DRAIN. This is the wanted order:
 * `check:surface-coverage` shipped its orphan axis at 1 because a real backlog existed that day, and
 * had to be tightened to 0 the day after. Increment 1 (PR #1049) put the single measured assertion
 * behind `STORYTREE_PERF=1` before this fence was written, so there is no backlog to admit and no
 * headroom to leave. The next unsanctioned occurrence, of either kind, reds the gate on its first
 * appearance. That is the fail-closed-on-growth design, not an oversight.
 *
 * NO WARN BAND WAS OPENED BENEATH THE CEILING. At 0/0 every gap escalates to RED against a usable
 * population, so `formatTestTiming`'s WARN lines always print with the RED block beneath them — a
 * reader is never left with WARN prose the exit code contradicts. WARN survives only on the
 * fail-OPEN substrate path, where the shell prints its "drain ceiling not enforced" line directly
 * beneath. Softening a check beneath its ceiling is the named gaming failure mode on
 * `process:verification-decay-detection`.
 */
export const DEFAULT_TEST_TIMING_DRAIN_CONFIG: TestTimingDrainConfig = {
  unsanctionedCeiling: 0,
  ungatedSanctionedCeiling: 0,
};

/**
 * The minimal projection of the sweep the ceiling needs — deliberately decoupled from
 * `TestTimingReport` so this core (and its test) stay free of the gate's types. The caller renders
 * each gap to the string a breach names it by.
 */
export interface TestTimingGaps {
  /** (a) unsanctioned wall-clock occurrences, already rendered (`<file>:<line> — <api>`). */
  unsanctioned: readonly string[];
  /** (b) sanctioned entries that lost their env gate or their file, already rendered. */
  ungatedSanctioned: readonly string[];
}

/** The context the ceiling is evaluated from: whether the sweep saw a population at all. */
export interface TestTimingDrainContext {
  /**
   * Whether the sweep scanned a usable population. False suppresses every breach AND forbids a
   * clean verdict: a walk that found no gate-tier test files proves nothing about the suite, and
   * "no findings" from an empty scan is the false green this gate exists to prevent.
   */
  populationUsable: boolean;
}

/** The computed verdict — `level: "red"` drives a non-zero exit, so landing needs a drain. */
export interface TestTimingDrainVerdict {
  /** `ok` (clean over a real population) · `warn` (gaps within ceilings, or unverified) · `red`. */
  level: "ok" | "warn" | "red";
  unsanctionedCount: number;
  ungatedSanctionedCount: number;
  /** Ceiling breaches, one per breached AXIS. Non-empty iff `level === "red"` — unless suppressed. */
  breaches: string[];
  /**
   * Why the verdict is not enforceable. Set whenever the population is unusable — both when a
   * breach is being suppressed and when a would-be CLEAN sweep cannot be trusted, so an empty scan
   * is reported as unverified rather than banked as a pass.
   */
  suppressed?: string;
  config: TestTimingDrainConfig;
}

/**
 * Evaluate the test-timing drain ceiling over one sweep's gap lists. Pure — inject whether the
 * scanned population was usable.
 *
 * The two axes are evaluated INDEPENDENTLY and never summed: `unsanctioned > U`, or
 * `ungatedSanctioned > G`, ⇒ `red`. A verdict computed over an UNUSABLE population — a walk that
 * found no gate-tier test files — is reported and suppressed, in BOTH directions: a breach is not
 * enforced, and a clean sweep is not banked as `ok`.
 */
export function evaluateTestTimingDrain(
  gaps: TestTimingGaps,
  ctx: TestTimingDrainContext,
  config: TestTimingDrainConfig = DEFAULT_TEST_TIMING_DRAIN_CONFIG,
): TestTimingDrainVerdict {
  const unsanctionedCount = gaps.unsanctioned.length;
  const ungatedSanctionedCount = gaps.ungatedSanctioned.length;

  const breaches: string[] = [];

  // Axis A — the fenced class: wall-clock measurement in a gate-tier test file nothing sanctions.
  if (unsanctionedCount > config.unsanctionedCeiling) {
    breaches.push(
      `${unsanctionedCount} wall-clock occurrence(s) in unsanctioned gate-tier test file(s), past ` +
        `the ceiling (U=${config.unsanctionedCeiling}): ${gaps.unsanctioned.join("; ")}`,
    );
  }

  // Axis B — the exemption's own upkeep. INDEPENDENT of axis A, never summed with it: a survivor
  // that lost its env gate is not discharged by the rest of the suite being clean.
  if (ungatedSanctionedCount > config.ungatedSanctionedCeiling) {
    breaches.push(
      `${ungatedSanctionedCount} sanctioned file(s) no longer earn the exemption, past the ceiling ` +
        `(G=${config.ungatedSanctionedCeiling}): ${gaps.ungatedSanctioned.join("; ")}`,
    );
  }

  // The substrate guard, computed first so a breach is REPORTED even when it cannot be enforced —
  // and so a vacuous CLEAN sweep is reported as unverified rather than passing silently.
  const suppressed = ctx.populationUsable
    ? undefined
    : "the sweep found no gate-tier test files, so this measures the walk, not the suite";

  const enforced = breaches.length > 0 && suppressed === undefined;
  const level: TestTimingDrainVerdict["level"] = enforced
    ? "red"
    : suppressed !== undefined || unsanctionedCount > 0 || ungatedSanctionedCount > 0
      ? "warn"
      : "ok";

  const verdict: TestTimingDrainVerdict = {
    level,
    unsanctionedCount,
    ungatedSanctionedCount,
    breaches,
    config,
  };
  if (suppressed !== undefined) verdict.suppressed = suppressed;
  return verdict;
}
