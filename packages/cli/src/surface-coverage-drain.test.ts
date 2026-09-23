import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";

import {
  DEFAULT_SURFACE_COVERAGE_DRAIN_CONFIG as CEILING,
  evaluateSurfaceCoverageDrain,
} from "./surface-coverage-drain.js";
import { classifySurfaceCoverage, loadSurfaceCoverageInputs } from "./surface-coverage-gate.js";

/**
 * The `check:surface-coverage` drain ceiling — a rung ADR-0311 D2 RETIRED. Say what that does and
 * does not mean, because the two are easy to swap. These TESTS still run, inside `pnpm -r test`
 * (the gate's test leg). The RUNG does not: `check:surface-coverage` is in neither the root
 * `package.json` nor `.github/workflows/ci.yml` (verified 2026-08-08), and `surface-coverage-drain.ts`
 * beside this file carries the UNWIRED banner. So what is exercised below is the retired module's own
 * logic plus the 0/0 ceiling pin — the REAL repo's surface counts are enforced by nobody. Declared,
 * with that reasoning, in `gate-order.ts`'s RETIRED_TEST_COMPANIONS.
 *
 * The ceiling as it was designed (`verification-integrity-arc`, ADR-0252 D3, in ADR-0168
 * D4's shape). Pure — the core takes gap lists and a substrate flag, so every level is testable
 * without disk. The red→green pair is each axis breaching ALONE; the guards pin what the ceiling must
 * NOT fire on, since a ceiling that reds on today's honest baseline (or on a substrate failure) would
 * buy silence rather than a drain.
 *
 * TIGHTENED to 0/0 on 2026-07-28, when the orphan worklist's one item (`pnpm ci:affected`) was drained
 * by authoring `process:affected-pr-test-scope`. Both axes now carry ZERO headroom, so the minimal
 * breach on either is a SINGLE gap, and the no-summing property is asserted against an explicit
 * split-ceiling config rather than the shipped pair — at 0/0 every gap breaches, which cannot
 * distinguish independent evaluation from a sum.
 */

const USABLE = { processTierUsable: true } as const;

// ---------------------------------------------------------------------------
// RED — each axis, on its own
// ---------------------------------------------------------------------------

test("RED: the orphan axis breaches alone — ONE un-drained entrypoint reds (R=0), and is named", () => {
  // Since the 2026-07-28 drain of `pnpm ci:affected` the orphan axis carries ZERO headroom, so the
  // minimal breach is a SINGLE orphan — the fail-closed-on-growth posture the tightening bought.
  const v = evaluateSurfaceCoverageDrain({ unresolved: [], orphans: ["pnpm deploy:studio"] }, USABLE);
  assert.equal(v.level, "red");
  assert.equal(v.orphanCount, 1);
  assert.equal(v.breaches.length, 1, "only the orphan axis breached");
  assert.match(v.breaches[0] ?? "", /1 operator-facing entrypoint\(s\) have no process/);
  assert.match(v.breaches[0] ?? "", /R=0/);
  // The breach NAMES the items, so the drain is actionable from the gate output alone.
  assert.match(v.breaches[0] ?? "", /pnpm deploy:studio/);
  assert.equal(v.suppressed, undefined);

  // …and it still names every item when several arrive at once.
  const many = evaluateSurfaceCoverageDrain(
    { unresolved: [], orphans: ["pnpm deploy:studio", "pnpm ship:web"] },
    USABLE,
  );
  assert.equal(many.orphanCount, 2);
  assert.match(many.breaches[0] ?? "", /pnpm deploy:studio; pnpm ship:web/);
});

test("RED: the unresolved axis breaches alone — ONE dangling `surfaces` ref reds (U=0)", () => {
  const v = evaluateSurfaceCoverageDrain(
    { unresolved: ['launch-desktop → "pnpm --filter desktop launch"'], orphans: [] },
    USABLE,
  );
  assert.equal(v.level, "red");
  assert.equal(v.unresolvedCount, 1);
  assert.equal(v.breaches.length, 1, "only the unresolved axis breached");
  assert.match(v.breaches[0] ?? "", /1 named surface\(s\) resolve to no entrypoint/);
  assert.match(v.breaches[0] ?? "", /U=0/);
  assert.match(v.breaches[0] ?? "", /launch-desktop/);
});

test("the two axes are INDEPENDENT and never summed — neither's headroom absorbs the other", () => {
  // The no-summing property is asserted against an EXPLICIT config whose axes differ, not against the
  // shipped 0/0 pair: at 0/0 every gap breaches, so today's numbers alone cannot tell "evaluated
  // independently" apart from "summed". Here the orphan axis sits exactly AT a ceiling of 1 while a
  // single dangling ref reds — the at-ceiling orphan list must contribute no breach of its own.
  const SPLIT = { unresolvedCeiling: 0, orphanCeiling: 1 };
  const dangling = evaluateSurfaceCoverageDrain(
    { unresolved: ['p → "storytree wibble"'], orphans: ["pnpm deploy:studio"] },
    USABLE,
    SPLIT,
  );
  assert.equal(dangling.level, "red");
  assert.equal(dangling.breaches.length, 1, "the at-ceiling orphan list contributes no breach");
  assert.match(dangling.breaches[0] ?? "", /resolve to no entrypoint/);

  // …and past that same ceiling the orphan axis reds with a spotless unresolved list.
  const orphaned = evaluateSurfaceCoverageDrain({ unresolved: [], orphans: ["a", "b"] }, USABLE, SPLIT);
  assert.equal(orphaned.level, "red");
  assert.equal(orphaned.breaches.length, 1);
  assert.match(orphaned.breaches[0] ?? "", /have no process/);

  // Both breached ⇒ two SEPARATE breach lines, never one summed count (shipped ceilings).
  const both = evaluateSurfaceCoverageDrain({ unresolved: ["x"], orphans: ["a", "b"] }, USABLE);
  assert.equal(both.breaches.length, 2);
});

// ---------------------------------------------------------------------------
// FALSE-POSITIVE GUARDS — what the ceiling must NOT fire on
// ---------------------------------------------------------------------------

test("GUARD: the drained baseline (0 unresolved, 0 orphans) is OK — the tightened ceiling ships green", () => {
  // After the 2026-07-28 drain the honest baseline IS zero on both axes, so the shipped ceiling must
  // sit quiet on it. A ceiling that red on its own baseline would price the next session toward
  // loosening it rather than holding the line.
  const v = evaluateSurfaceCoverageDrain({ unresolved: [], orphans: [] }, USABLE);
  assert.equal(v.level, "ok");
  assert.deepEqual(v.breaches, []);
  assert.equal(v.suppressed, undefined);
});

test("GUARD: ZERO headroom on both axes — one gap of EITHER kind reds, so the drained list stays drained", () => {
  // The point of tightening: a ceiling above the real count is one free un-drained item of slack. At
  // 0/0 the first regression on either axis fails the gate instead of printing a warning nobody acts on.
  assert.equal(CEILING.unresolvedCeiling, 0);
  assert.equal(CEILING.orphanCeiling, 0);
  assert.equal(evaluateSurfaceCoverageDrain({ unresolved: [], orphans: ["a"] }, USABLE).level, "red");
  assert.equal(evaluateSurfaceCoverageDrain({ unresolved: ["x"], orphans: [] }, USABLE).level, "red");
});

test("GUARD: no WARN BAND was opened beneath the ceiling — a gap is never QUIETER than before bounding", () => {
  // The failure mode this pins: a ceiling that made counts under it print OK would leave the check
  // quieter than before it was bounded. At 0/0 there is no within-ceiling gap at all against a usable
  // tier — every gap escalates to RED, strictly louder than the WARN it printed before. The only
  // surviving WARN with gaps present is the fail-OPEN substrate path below, which the shell prints its
  // "drain ceiling not enforced" line beneath, so WARN prose is never left contradicting the exit code.
  for (const gaps of [
    { unresolved: [], orphans: ["a"] },
    { unresolved: ["x"], orphans: [] },
    { unresolved: ["x"], orphans: ["a"] },
  ]) {
    assert.notEqual(evaluateSurfaceCoverageDrain(gaps, USABLE).level, "ok", "a gap never prints OK");
    assert.equal(evaluateSurfaceCoverageDrain(gaps, USABLE).level, "red");
    const open = evaluateSurfaceCoverageDrain(gaps, { processTierUsable: false });
    assert.equal(open.level, "warn", "the substrate path is the only WARN left, and it is reported");
    assert.notEqual(open.suppressed, undefined);
  }
});

test("GUARD: an unusable process tier SUPPRESSES the breach — fail-open on the substrate", () => {
  // Measured on the authoring checkout: substituting an empty seed took the orphan list 1 → 11. That
  // is a substrate failure wearing a breach's clothes, so it must never red.
  const v = evaluateSurfaceCoverageDrain(
    { unresolved: [], orphans: Array.from({ length: 11 }, (_, i) => `pnpm script-${i}`) },
    { processTierUsable: false },
  );
  assert.equal(v.level, "warn", "a substrate failure never reds the gate");
  assert.notEqual(v.suppressed, undefined, "and it is REPORTED, never silently dropped");
  assert.match(v.suppressed ?? "", /no usable `process` tier/);
  assert.equal(v.breaches.length, 1, "the would-be breach is still computed and carried");
});

test("GUARD: the substrate flag suppresses ONLY when there is a breach, and never masks a real one", () => {
  // No breach ⇒ nothing to suppress, so the field stays absent even with an unusable tier.
  const quiet = evaluateSurfaceCoverageDrain({ unresolved: [], orphans: [] }, { processTierUsable: false });
  assert.equal(quiet.suppressed, undefined);
  assert.equal(quiet.level, "ok");
  // The SAME gaps against a usable tier are enforced — the flag is the only difference.
  const gaps = { unresolved: [], orphans: ["a", "b", "c"] };
  assert.equal(evaluateSurfaceCoverageDrain(gaps, { processTierUsable: false }).level, "warn");
  assert.equal(evaluateSurfaceCoverageDrain(gaps, USABLE).level, "red");
});

// ---------------------------------------------------------------------------
// The baseline, pinned against the REAL repo
// ---------------------------------------------------------------------------

test("BASELINE: a sweep over the real entrypoints sits within both ceilings", async () => {
  // THIS TEST NO LONGER PINS THE REAL REPO'S 0/0, AND THAT IS THE HONEST STATE — say so rather than
  // let the title imply otherwise. It read the committed seed's process tier; ADR-0302 D1 deleted
  // that file, and ADR-0302 D3 keeps `STORYTREE_DB_USER` out of `pnpm -r test`, so a hermetic test
  // cannot see the real tier at all. AND THE REAL-REPO 0/0 BASELINE IS NOW ENFORCED BY NOTHING —
  // an earlier revision of this comment said it had moved to the `check:surface-coverage` RUNG,
  // "which reads live and runs in BOTH `pnpm gate` and CI", and that it "moved rather than lapsed".
  // ADR-0311 D2 retired that rung: verified 2026-08-08, `check:surface-coverage` appears in neither
  // the root `package.json` nor `.github/workflows/ci.yml`. The enforcement LAPSED. Restoring it
  // needs fresh production-catch evidence and an ADR (ADR-0311 D5), never merely the wiring.
  //
  // What survives here is the wiring: the real entrypoint set, joined to a store's process tier,
  // evaluated by the real ceiling — the path that must not throw or mis-shape before the rung can
  // mean anything.
  const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const store = new InMemoryStore();
  await loadFixtureCorpus(store);
  const report = classifySurfaceCoverage(
    await loadSurfaceCoverageInputs({
      store,
      packageJsonPath: path.join(repoRoot, "package.json"),
    }),
  );
  const v = evaluateSurfaceCoverageDrain(
    {
      unresolved: report.unresolved.map((u) => `${u.processId} → "${u.ref}"`),
      orphans: report.orphans,
    },
    { processTierUsable: report.processCount > 0 },
  );

  // The whole path runs and produces a decidable verdict over REAL entrypoints. It will be `red`
  // here — 13 fixture artifacts cannot name the repo's ~11 operator-facing launchers, and pretending
  // otherwise would need a fixture that duplicated the corpus, which is the coupling this all
  // exists to remove. What is asserted is what a hermetic test can honestly assert: the sweep
  // COMPUTES rather than throws or suppresses, and every breach it reports NAMES its items, which is
  // what makes the rung's output actionable.
  assert.ok(["ok", "red"].includes(v.level), `expected a decided verdict, got ${v.level}`);
  assert.equal(v.suppressed, undefined, "a populated process tier must not suppress the ceiling");
  for (const b of v.breaches) assert.match(b, /: .+/, `a breach must name its items: ${b}`);
  // The ceiling pair itself is still pinned here, and that is the part of the baseline that DID stay
  // hermetic: 0/0 means the ceiling can only ever be tightened, and a session that loosened it to
  // silence a red would fail this line without needing any corpus at all.
  assert.equal(CEILING.unresolvedCeiling, 0, "the unresolved ceiling must not be loosened");
  assert.equal(CEILING.orphanCeiling, 0, "the orphan ceiling must not be loosened");
  // The real repo's counts against those ceilings — "the committed tree carries a CLEAN bijection,
  // and the ADR-0195 process is what keeps `pnpm ci:affected` non-orphan" — are asserted NOWHERE.
  // They were `check:surface-coverage`'s job; ADR-0311 D2 retired it, so what is pinned above is the
  // ceiling pair, not the corpus it was measured against. Read this test's green as "the retired
  // module still computes", never as "the bijection is still clean".
});
