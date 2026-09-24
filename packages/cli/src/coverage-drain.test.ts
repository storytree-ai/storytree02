import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  COVERAGE_NEVER_SUM_NOTE,
  DEFAULT_COVERAGE_DRAIN_CONFIG as CEILING,
  evaluateCoverageDrain,
  formatCoverageTotals,
} from "./coverage-drain.js";
import { classifyGateCoverage, projectCoverageGaps, sweepRealBuildCoverage } from "./coverage-gate.js";

/*
 * LOAD-BEARING — DO NOT DELETE WITH THE UNWIRED ADR-0311 LEFTOVERS.
 *
 * `check:coverage` was retired by ADR-0311 D2 and `coverage-drain.ts` beside this file carries the
 * UNWIRED banner, so this file LOOKS like a leftover. It is not. The `live corpus sweep` test at the
 * bottom runs inside `pnpm -r test` — the gate's test leg, which CI runs too — and is the ONLY
 * surviving enforcement of the contract-coverage ceiling (ADR-0252 D3): it sweeps the real
 * `stories/` tree and asserts the drain verdict is not red, so the uncovered/unbound backlog cannot
 * grow past its ceiling unnoticed.
 *
 * Deleting this file drops that ceiling silently. Declared, with its cost, in `gate-order.ts`'s
 * RETIRED_TEST_COMPANIONS; `gate-order.test.ts` reds if the file or the banner goes. That is not a
 * licence to re-wire the rung — ADR-0311 D5 still governs that, and this is an ordinary test.
 */

/**
 * The `check:coverage` drain ceiling (`verification-integrity-arc`, ADR-0252 D3, in ADR-0168 D4's
 * shape). Pure — the core takes gap lists and what the sweep read, so every level is testable without
 * disk. The red→green pair is each axis breaching ALONE; the guards pin what the ceiling must NOT fire
 * on, since a ceiling that reds on today's honest baseline (or on a broken checkout) would buy silence
 * rather than a drain.
 *
 * The two axes carry DIFFERENT guards on purpose, because the two substrates were measured to fail in
 * opposite directions: an absent `stories/` tree DEFLATES the sweep to a false clean, while an absent
 * test-file tree INFLATES `unbound` to every scanned capability. So `uncovered` is enforced
 * unconditionally and `unbound` is not — the asymmetry is the subject of several assertions below.
 */

const CTX = { specFilesWalked: 281, scanned: 112 } as const;

const contracts = (n: number): string[] => Array.from({ length: n }, (_, i) => `cap-${i}/contract-${i}`);
const caps = (n: number): string[] => Array.from({ length: n }, (_, i) => `cap-${i}`);

// ---------------------------------------------------------------------------
// RED — each axis, on its own
// ---------------------------------------------------------------------------

test("coverage drain: the uncovered axis reds ALONE, one contract past its ceiling", () => {
  const v = evaluateCoverageDrain(
    { uncovered: contracts(CEILING.uncoveredCeiling + 1), unbound: caps(CEILING.unboundCeiling) },
    CTX,
  );
  assert.equal(v.level, "red");
  assert.equal(v.breaches.length, 1, "only the breached axis reports");
  assert.match(v.breaches[0]!, /named by no substantive test/);
  assert.match(v.breaches[0]!, new RegExp(`U=${CEILING.uncoveredCeiling}`));
});

test("coverage drain: the unbound axis reds ALONE, one capability past its ceiling", () => {
  const v = evaluateCoverageDrain(
    { uncovered: contracts(CEILING.uncoveredCeiling), unbound: caps(CEILING.unboundCeiling + 1) },
    CTX,
  );
  assert.equal(v.level, "red");
  assert.equal(v.breaches.length, 1);
  assert.match(v.breaches[0]!, /register a real-build test surface that does not exist/);
  assert.match(v.breaches[0]!, new RegExp(`B=${CEILING.unboundCeiling}`));
});

test("coverage drain: the breach names every offending id, so a RED is actionable without a second run", () => {
  const v = evaluateCoverageDrain({ uncovered: [], unbound: ["a", "b", "c"] }, CTX, {
    uncoveredCeiling: 0,
    unboundCeiling: 0,
  });
  assert.equal(v.level, "red");
  for (const id of ["a", "b", "c"]) assert.match(v.breaches[0]!, new RegExp(id));
});

// ---------------------------------------------------------------------------
// GREEN — the honest baseline, and the axes never summed
// ---------------------------------------------------------------------------

test("coverage drain: the shipped ceiling is GREEN at exactly the baseline it was measured on", () => {
  const v = evaluateCoverageDrain(
    { uncovered: contracts(CEILING.uncoveredCeiling), unbound: caps(CEILING.unboundCeiling) },
    CTX,
  );
  assert.equal(v.level, "warn", "a backlog within its ceiling still WARNs — it is never silent");
  assert.deepEqual(v.breaches, []);
});

test("coverage drain: the axes are NEVER summed — the measured concurrent case that a sum is blind to", () => {
  // Measured 2026-07-28: one session drains two uncovered contracts by authoring vouching tests while
  // another MOVES a test file without updating the spec that binds it. The summed contract total holds
  // at 121 and the capability count FALLS 41 -> 40, so a ceiling on either summed projection sees
  // nothing — while a proof surface has disappeared.
  // PINNED to the ceiling in force on the day this was measured (U=119), NOT to the shipped constant.
  // The shipped ceiling has since tightened to 112 (ADR-0353 repaired a binding fault, crediting seven
  // contracts to tests that already passed), and re-reading this historical pair through today's
  // tighter ceiling would red `before` and destroy the very contrast the case exists to show. What is
  // under test here is the SUM-BLINDNESS property, which is a fact about the shape of the two axes and
  // is independent of where either ceiling happens to sit.
  const AT_MEASUREMENT = { uncoveredCeiling: 119, unboundCeiling: 1 };
  const before = { uncovered: contracts(119), unbound: caps(1) };
  const after = { uncovered: contracts(117), unbound: caps(2) };
  assert.equal(before.uncovered.length + before.unbound.length * 2, 121, "the summed projection is unchanged...");
  assert.equal(after.uncovered.length + after.unbound.length * 2, 121, "...at exactly 121");

  assert.equal(evaluateCoverageDrain(before, CTX, AT_MEASUREMENT).level, "warn");
  const v = evaluateCoverageDrain(after, CTX, AT_MEASUREMENT);
  assert.equal(v.level, "red", "the split pair catches what the sum cannot");
  assert.equal(v.uncoveredCount, 117, "and it caught it while the authoring backlog IMPROVED");
});

test("coverage drain: a fully clean sweep over a real population certifies ok", () => {
  const v = evaluateCoverageDrain({ uncovered: [], unbound: [] }, CTX);
  assert.equal(v.level, "ok");
  assert.equal(v.unverified, undefined);
});

// ---------------------------------------------------------------------------
// The substrate guards — asymmetric, because the directions were measured to differ
// ---------------------------------------------------------------------------

test("coverage drain: the uncovered axis is enforced even on a partial sweep — its count is a LOWER bound", () => {
  // Measured: every substrate deficiency drives `uncovered` toward zero (missing files route wholly to
  // `unbound`), so nothing can manufacture this breach and it is never suppressed.
  const v = evaluateCoverageDrain(
    { uncovered: contracts(CEILING.uncoveredCeiling + 1), unbound: [] },
    { specFilesWalked: 3, scanned: 2 },
  );
  assert.equal(v.level, "red");
  assert.equal(v.suppressed, undefined);
});

test("coverage drain: an unbound breach over EVERY scanned capability is reported but NOT enforced", () => {
  // Measured: an absent test-file tree took `unbound` from 1 to 112 of 112 scanned. That is a checkout
  // fault wearing a breach's clothes.
  const v = evaluateCoverageDrain({ uncovered: [], unbound: caps(112) }, { specFilesWalked: 281, scanned: 112 });
  assert.equal(v.level, "warn", "a substrate failure never reds the gate");
  assert.equal(v.breaches.length, 1, "the breach is still COMPUTED and reported (no silent caps)");
  assert.match(v.suppressed ?? "", /measures the checkout rather than the bindings/);
});

test("coverage drain: a PARTIAL unbound breach is enforced — suppression is all-or-nothing by measurement", () => {
  const v = evaluateCoverageDrain({ uncovered: [], unbound: caps(111) }, { specFilesWalked: 281, scanned: 112 });
  assert.equal(v.level, "red");
  assert.equal(v.suppressed, undefined);
});

test("coverage drain: suppressing the unbound axis does NOT suppress a co-occurring uncovered breach", () => {
  const v = evaluateCoverageDrain(
    { uncovered: contracts(CEILING.uncoveredCeiling + 1), unbound: caps(5) },
    { specFilesWalked: 281, scanned: 5 },
  );
  assert.equal(v.level, "red", "the axis the substrate cannot inflate still reds");
  assert.equal(v.breaches.length, 2, "both are reported");
  assert.notEqual(v.suppressed, undefined);
});

test("coverage drain: a sweep that scanned NOTHING is never certified ok", () => {
  // Measured: an absent `stories/` tree and an empty one both reach scanned=0, where the check prints
  // `OK — ... (nothing to check)` and exits 0. The clean result is not evidence.
  const v = evaluateCoverageDrain({ uncovered: [], unbound: [] }, { specFilesWalked: 0, scanned: 0 });
  assert.equal(v.level, "warn");
  assert.match(v.unverified ?? "", /nothing was scanned \(0 spec file\(s\) walked/);
});

test("coverage drain: withholding ok never converts into a breach", () => {
  const v = evaluateCoverageDrain({ uncovered: [], unbound: [] }, { specFilesWalked: 0, scanned: 0 });
  assert.deepEqual(v.breaches, []);
  assert.notEqual(v.level, "red");
});

// ---------------------------------------------------------------------------
// The ceiling against the REAL corpus — the baseline is a fact on disk, not a fixture
// ---------------------------------------------------------------------------

test("coverage drain: the live corpus sweep is GREEN at the shipped ceiling", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const { units, specFilesWalked } = sweepRealBuildCoverage(path.join(repoRoot, "stories"), repoRoot);
  const { uncovered, unbound, scanned } = projectCoverageGaps(classifyGateCoverage(units));
  const v = evaluateCoverageDrain({ uncovered, unbound }, { specFilesWalked, scanned });

  // BOTH TOTALS, SEPARATELY, WITH THE APERTURE THEY WERE MEASURED OVER
  // (`gate-checks-name-the-remedy-that-works`, gate-self-report-honesty-arc).
  //
  // The ceiling is defined in terms of two numbers, and this — the only surviving enforcement of it
  // since ADR-0311 D2 retired the `check:coverage` rung — named NEITHER. A session that reds here
  // learned only which axis breached, so establishing where it stood meant hand-rolling a sweep
  // script, which has three separate traps that report a FALSE CLEAN (`specFilesWalked=0 scanned=0
  // uncovered=0` reads exactly like a drained backlog). The verdict has carried `uncoveredCount`,
  // `unboundCount` and both ceilings all along; not printing them was the whole defect.
  //
  // THE APERTURE IS PART OF THE NUMBER, not decoration: `uncovered` is a strict LOWER bound whose
  // value falls as the substrate degrades (a missing test-file tree routes every capability to
  // `unbound` instead), so `uncovered=0` means "nothing was scanned" just as readily as "nothing is
  // uncovered". Stating what was walked is what separates those two.
  // The sentence comes from the MODULE, not from a copy here, and so does the never-sum note — they
  // are the same bytes `storytree coverage --totals` prints (`coverage-totals-verb`). Two readers of
  // one ceiling that phrased it independently could drift into disagreeing about what the numbers
  // are, which is the failure mode this whole arc is about, one level down.
  const totals = formatCoverageTotals(v, { specFilesWalked, scanned });

  assert.notEqual(
    v.level,
    "red",
    `the corpus breached its own ceiling — ${totals}.\n` +
      `${COVERAGE_NEVER_SUM_NOTE}\n` +
      `breached: ${v.breaches.join(" | ")}. Drain it (author a test naming the contract, ` +
      "split/retire it, or repair the binding) — do NOT raise the ceiling (ADR-0252 D3).",
  );
});

test("coverage totals: the printed sentence carries both axes, both ceilings AND the aperture", () => {
  // The aperture is what separates "nothing is uncovered" from "nothing was scanned" — `uncovered` is
  // a strict LOWER bound that FALLS as the substrate degrades, so counts without it are unreadable.
  const line = formatCoverageTotals(
    evaluateCoverageDrain({ uncovered: ["a/b", "c/d"], unbound: ["e"] }, CTX),
    CTX,
  );
  assert.match(line, /uncovered=2\/103/);
  assert.match(line, /unbound=1\/1/);
  assert.match(line, /measured over 281 spec file\(s\) walked, 112 capability\(ies\) scanned/);
  // No summed figure anywhere: 2 + 1 = 3 must not appear as a total.
  assert.doesNotMatch(line, /\btotal\b/i);
});
