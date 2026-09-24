import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  DEFAULT_TEST_TIMING_DRAIN_CONFIG as CEILING,
  evaluateTestTimingDrain,
} from "./test-timing-drain.js";
import {
  SANCTIONED_WALL_CLOCK,
  classifyTestTiming,
  loadTestTimingInputs,
} from "./test-timing-gate.js";

/*
 * LOAD-BEARING — DO NOT DELETE WITH THE UNWIRED ADR-0311 LEFTOVERS.
 *
 * `check:test-timing` was retired by ADR-0311 D2 and `test-timing-drain.ts` beside this file carries
 * the UNWIRED banner, so this file LOOKS like a leftover. It is not. Its BASELINE test at the bottom
 * runs inside `pnpm -r test` — the gate's test leg, which CI runs too — and is the ONLY surviving
 * enforcement of ADR-0276's no-wall-clock-in-tests rule: it sweeps every gate-tier workspace's test
 * files for `performance.now` / `process.hrtime` behind an anti-vacuity floor and asserts the
 * unsanctioned list is empty. A new timing call anywhere in the repo reds through HERE.
 *
 * Deleting this file drops that invariant silently. Declared, with its cost, in
 * `gate-order.ts`'s RETIRED_TEST_COMPANIONS; `gate-order.test.ts` reds if the file or the banner
 * goes. That is not a licence to re-wire the rung — ADR-0311 D5 still governs that, and this is an
 * ordinary test, never a gate step.
 */

/**
 * The `check:test-timing` drain ceiling (ADR-0276 D3, in ADR-0252 D3 / ADR-0168 D4's shape). Pure —
 * the core takes gap lists and a substrate flag, so every level is testable without disk. The
 * red→green pair is each axis breaching ALONE; the guards pin what the ceiling must NOT fire on,
 * since a ceiling that reds on today's honest baseline would buy silence rather than a drain.
 *
 * Both axes ship at ZERO because increment 1 (PR #1049) did the drain first — the single measured
 * assertion in the suite went behind `STORYTREE_PERF=1` before this fence was written — so the
 * minimal breach on either axis is a SINGLE gap, and the no-summing property is asserted against an
 * explicit split-ceiling config rather than the shipped pair (at 0/0 every gap breaches, which
 * cannot distinguish independent evaluation from a sum).
 */

const USABLE = { populationUsable: true } as const;

// ---------------------------------------------------------------------------
// RED — each axis, on its own
// ---------------------------------------------------------------------------

test("RED: the unsanctioned axis breaches alone — ONE new wall-clock call reds (U=0), and is named", () => {
  const v = evaluateTestTimingDrain(
    { unsanctioned: ["packages/x/src/x.test.ts:12 — performance.now"], ungatedSanctioned: [] },
    USABLE,
  );
  assert.equal(v.level, "red");
  assert.equal(v.unsanctionedCount, 1);
  assert.equal(v.breaches.length, 1, "only the unsanctioned axis breached");
  assert.match(v.breaches[0] ?? "", /1 wall-clock occurrence\(s\) in unsanctioned gate-tier test file/);
  assert.match(v.breaches[0] ?? "", /U=0/);
  // The breach NAMES the site, so the fix is possible from gate output alone.
  assert.match(v.breaches[0] ?? "", /packages\/x\/src\/x\.test\.ts:12/);
  assert.equal(v.suppressed, undefined);

  // …and it still names every site when several arrive at once.
  const many = evaluateTestTimingDrain(
    { unsanctioned: ["a.test.ts:1 — performance.now", "b.test.ts:2 — process.hrtime"], ungatedSanctioned: [] },
    USABLE,
  );
  assert.equal(many.unsanctionedCount, 2);
  assert.match(many.breaches[0] ?? "", /a\.test\.ts:1 — performance\.now; b\.test\.ts:2 — process\.hrtime/);
});

test("RED: the sanctioned-upkeep axis breaches alone — the survivor off its env gate reds (G=0)", () => {
  const v = evaluateTestTimingDrain(
    {
      unsanctioned: [],
      ungatedSanctioned: ["packages/forest-world/src/routing.test.ts no longer guards on STORYTREE_PERF"],
    },
    USABLE,
  );
  assert.equal(v.level, "red");
  assert.equal(v.ungatedSanctionedCount, 1);
  assert.equal(v.breaches.length, 1, "only the sanctioned-upkeep axis breached");
  assert.match(v.breaches[0] ?? "", /1 sanctioned file\(s\) no longer earn the exemption/);
  assert.match(v.breaches[0] ?? "", /G=0/);
  assert.match(v.breaches[0] ?? "", /routing\.test\.ts/);
});

test("the two axes are INDEPENDENT and never summed — neither's headroom absorbs the other", () => {
  // Asserted against an EXPLICIT config whose axes differ, not the shipped 0/0 pair: at 0/0 every gap
  // breaches, so today's numbers alone cannot tell "evaluated independently" from "summed".
  const SPLIT = { unsanctionedCeiling: 1, ungatedSanctionedCeiling: 0 };
  const ungated = evaluateTestTimingDrain(
    { unsanctioned: ["a.test.ts:1 — performance.now"], ungatedSanctioned: ["survivor lost its gate"] },
    USABLE,
    SPLIT,
  );
  assert.equal(ungated.level, "red");
  assert.equal(ungated.breaches.length, 1, "the at-ceiling unsanctioned list contributes no breach");
  assert.match(ungated.breaches[0] ?? "", /no longer earn the exemption/);

  // …and past that same ceiling the unsanctioned axis reds with a spotless allow-list.
  const spilled = evaluateTestTimingDrain(
    { unsanctioned: ["a.test.ts:1 — x", "b.test.ts:2 — y"], ungatedSanctioned: [] },
    USABLE,
    SPLIT,
  );
  assert.equal(spilled.level, "red");
  assert.equal(spilled.breaches.length, 1);
  assert.match(spilled.breaches[0] ?? "", /unsanctioned gate-tier test file/);

  // Both breached ⇒ two SEPARATE breach lines, never one summed count (shipped ceilings).
  const both = evaluateTestTimingDrain(
    { unsanctioned: ["a.test.ts:1 — x"], ungatedSanctioned: ["b lost its gate"] },
    USABLE,
  );
  assert.equal(both.breaches.length, 2);
});

// ---------------------------------------------------------------------------
// FALSE-POSITIVE GUARDS — what the ceiling must NOT fire on
// ---------------------------------------------------------------------------

test("GUARD: the drained baseline (no gaps on either axis) is OK — the ceiling ships green", () => {
  // Increment 1 drained the one real occurrence before this fence was authored, so the honest
  // baseline IS zero. A ceiling that red on its own baseline would price the next session toward
  // loosening it rather than holding the line.
  const v = evaluateTestTimingDrain({ unsanctioned: [], ungatedSanctioned: [] }, USABLE);
  assert.equal(v.level, "ok");
  assert.deepEqual(v.breaches, []);
  assert.equal(v.suppressed, undefined);
});

test("GUARD: ZERO headroom on both axes — one gap of EITHER kind reds, so the drained list stays drained", () => {
  assert.equal(CEILING.unsanctionedCeiling, 0);
  assert.equal(CEILING.ungatedSanctionedCeiling, 0);
  assert.equal(evaluateTestTimingDrain({ unsanctioned: ["a"], ungatedSanctioned: [] }, USABLE).level, "red");
  assert.equal(evaluateTestTimingDrain({ unsanctioned: [], ungatedSanctioned: ["b"] }, USABLE).level, "red");
});

test("GUARD: no WARN BAND beneath the ceiling — a gap is never QUIETER than an unbounded check", () => {
  for (const gaps of [
    { unsanctioned: ["a"], ungatedSanctioned: [] },
    { unsanctioned: [], ungatedSanctioned: ["b"] },
    { unsanctioned: ["a"], ungatedSanctioned: ["b"] },
  ]) {
    assert.equal(evaluateTestTimingDrain(gaps, USABLE).level, "red", "a gap never prints OK");
    const open = evaluateTestTimingDrain(gaps, { populationUsable: false });
    assert.equal(open.level, "warn", "the substrate path is the only WARN left, and it is reported");
    assert.notEqual(open.suppressed, undefined);
  }
});

// ---------------------------------------------------------------------------
// The substrate guard — here it must suppress the PASS, not just the breach
// ---------------------------------------------------------------------------

test("GUARD: an empty scan can never bank a CLEAN pass — the false green this gate must not print", () => {
  // This is where `check:test-timing` differs from `check:surface-coverage`, and the difference is
  // the whole reason the guard is two-sided. There, an unusable substrate fakes a BREACH (an empty
  // seed made every entrypoint an orphan), so suppressing the breach is enough. HERE a broken walk
  // fakes a CLEAN SWEEP — zero files scanned yields zero findings — and silently banking that as a
  // pass would leave the fence installed, green, and measuring nothing.
  const v = evaluateTestTimingDrain({ unsanctioned: [], ungatedSanctioned: [] }, { populationUsable: false });
  assert.notEqual(v.level, "ok", "no findings over no files is not a pass");
  assert.equal(v.level, "warn");
  assert.match(v.suppressed ?? "", /found no gate-tier test files/);
});

test("GUARD: an unusable population SUPPRESSES a breach and REPORTS it — never silently dropped", () => {
  const v = evaluateTestTimingDrain(
    { unsanctioned: Array.from({ length: 9 }, (_, i) => `f${i}.test.ts:1 — x`), ungatedSanctioned: [] },
    { populationUsable: false },
  );
  assert.equal(v.level, "warn", "a substrate failure never reds the gate");
  assert.notEqual(v.suppressed, undefined);
  assert.equal(v.breaches.length, 1, "the would-be breach is still computed and carried");
  // The SAME gaps over a usable population are enforced — the flag is the only difference.
  assert.equal(
    evaluateTestTimingDrain({ unsanctioned: ["f0.test.ts:1 — x"], ungatedSanctioned: [] }, USABLE).level,
    "red",
  );
});

// ---------------------------------------------------------------------------
// The baseline, pinned against the REAL repo
// ---------------------------------------------------------------------------

test("BASELINE: the real repo sweep is CLEAN at 0/0 — one sanctioned, env-gated survivor and nothing else", () => {
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const inputs = loadTestTimingInputs({ repoRoot });
  const report = classifyTestTiming(inputs);

  // ANTI-VACUITY FLOOR. The ceiling cannot police its own inputs: a walk that found nothing would
  // report a spotless sweep, so the population is pinned HERE, where the suite can see it. Measured
  // 2026-08-03: 474 test files across 24 gate-tier workspaces. The floors sit deliberately below
  // those counts — this must not red when a workspace is legitimately added or retired; it exists to
  // catch a walk that broke, not to freeze the suite's size.
  assert.ok(
    report.scannedWorkspaces >= 20,
    `the walk must find the gate-tier workspaces (found ${report.scannedWorkspaces})`,
  );
  assert.ok(
    report.scannedFiles >= 300,
    `the walk must find the gate-tier test files (found ${report.scannedFiles})`,
  );

  const v = evaluateTestTimingDrain(
    {
      unsanctioned: report.unsanctioned.map((h) => `${h.file}:${h.line} — ${h.api}`),
      ungatedSanctioned: report.ungatedSanctioned,
    },
    { populationUsable: report.scannedFiles > 0 && report.scannedWorkspaces > 0 },
  );
  assert.notEqual(
    v.level,
    "red",
    `the drain ceiling must not red on the committed repo: ${v.breaches.join(" | ")}`,
  );
  assert.equal(
    v.level,
    "ok",
    "the baseline is CLEAN, not merely within ceilings — increment 1 drained it before this fence",
  );
  assert.deepEqual(
    report.unsanctioned,
    [],
    `no gate-tier test file may measure wall-clock time (ADR-0276): ${report.unsanctioned
      .map((h) => `${h.file}:${h.line}`)
      .join(", ")}`,
  );

  // The drain itself, pinned: the survivor still MEASURES (so the number cannot rot unnoticed) and
  // still guards its assertion, which is exactly what earns the exemption. Deleting either re-reds
  // here as well as at the gate.
  assert.ok(report.sanctionedHits > 0, "the sanctioned survivor still takes its measurement");
  assert.deepEqual(report.ungatedSanctioned, [], "the survivor still guards on STORYTREE_PERF");
  assert.equal(SANCTIONED_WALL_CLOCK.length, 1, "exactly one permanent exemption exists");

  // And the self-referential proof that makes all of the above trustworthy: this sweep scanned the
  // two `test-timing-*.test.ts` files, which between them hold more occurrences of the fenced
  // pattern (as string fixtures) than the rest of the repo combined. They pass because the masker
  // distinguishes a mention from a call — the property the whole fence rests on.
  const ownFiles = inputs.files.filter((f) => f.file.includes("test-timing-"));
  assert.equal(ownFiles.length, 2, `the sweep must include its own tests (found ${ownFiles.length})`);
  assert.ok(
    ownFiles.every((f) => f.source.includes("performance.now")),
    "…and those tests do carry the pattern as fixtures",
  );
});
