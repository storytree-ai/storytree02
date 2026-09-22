// true-surface-equivalence.test.ts — THE MAPPER IS TRANSPARENT TO THE SCENE'S CAMERA, and that is
// what the deleted un-projection leaves behind.
//
// ⚠⚠ THE QUESTION THIS FILE WAS BUILT FOR IS ANSWERED AND THE ANSWER IS SPENT. It asked ADR-0527
// D5's question — *does mapping a TRUE surface land where un-projecting the drawing lands?* — and
// answered it with no exception recorded: 174 descriptors, the same kinds, every height identical,
// the worst-placed descriptor 0.348 units across a ninety-degree camera swing. On that evidence
// ADR-0546 D1 chose to build the 3D forest on true ground, and `restoreTrueFootprint` /
// `stretchAboutIslands` were deleted. **There is no longer a second arm to compare against**: the
// mapper cannot un-project a drawing, so the old measurement is unbuildable rather than merely
// stale, and re-deriving it is impossible by construction.
//
// WHAT THE FILE HOLDS NOW, AND WHY IT IS THE SAME PROPERTY ONE STEP EARLIER. With the repair gone,
// `worldTo3D` adds nothing to its input, so ALL of the difference between the same island built at
// two cameras is `buildScene`'s single projection: `projectGround` scales ground depth by
// `sin(elevation)` ABOUT THE DRAWING'S ORIGIN. So the plan-view arm must be the declared-camera arm
// with z divided by `sin(land camera)` — one global scalar, no island centres, nothing per-family.
// If the mapper ever starts adding geometry of its own again, this is the test that reds.
//
// ⚠ AND IT IS THE DELETION'S OWN RED→GREEN. Before ADR-0546 the two arms had the SAME depth (135.0
// each — the repair made the drawing true) and this relation failed by a factor of `1 / sin(land
// camera)` (2.92 at the land camera's original 20 degrees). After it, the drawn island is the
// squashed ribbon the page actually carries and the plan-view island is the recipe's own hex
// cluster (233.8 x 135.0), which is `1 / sin(land camera)` deeper. ADR-0593 D1 moved the land
// camera 20 -> 50 degrees, which un-squashes the drawing (233.8 x 46.2 -> 233.8 x 103.4) without
// touching the plan-view arm (still 233.8 x 135.0, since `PLAN_VIEW_ELEVATION_DEG` did not move)
// or the relation itself, which is re-asserted below at whatever `LAND_CAMERA_ELEVATION_DEG` is
// live rather than restated as a 20-degree literal.
//
// ⚠ THE AGREEMENT IS TIGHTER THAN THE ONE THE DELETION REPLACED — 0.079 units against 0.348 (it
// was 0.128 at the retired 20-degree camera; the one-decimal rounding is amplified by the same
// SHRINKING `1 / sin(land camera)` multiplier discussed at `TOLERANCE` below, so the noise floor
// tightened again), and the reason the comparison is worth keeping: the old figure was the
// RELAXED SUBSTRATE's own residue across a ninety-degree swing plus the repair's per-island
// arithmetic, where this is the drawing's one-decimal rounding carried through one
// multiplication. Nothing was tuned to get it.
//
// ⚠ NARROWED, NEVER ASSERTED, AND THE ORIGINAL FILE'S HARDEST-WON LESSON. A first draft of the
// measurement declared a structural `{ kind, x?, y?, z? }` and reached the mapper's output through
// `as unknown as`. Every descriptor's position lives on `transform`, so `x`/`y`/`z` were `undefined`
// on all 174, `?? 0` turned each into zero, and the equivalence compared ZERO AGAINST ZERO and
// passed — with a conclusion ("exact agreement") that was the opposite of the truth. `pnpm lint`'s
// no-chained-type-assertions rule is what caught it; nothing else would have.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LAND_CAMERA_ELEVATION_DEG, PLAN_VIEW_ELEVATION_DEG, groundFlattening } from '@storytree/forest-world';

import { islandScene } from './island-fixture.js';
import { worldTo3D, type Descriptor3D, type InstanceDescriptor } from '../src/world-to-3d.js';

/** One arm: build the island at a camera and map it. The mapper is told nothing about the camera —
 *  it has nothing to do with one any more.
 *
 *  `landAreaPerCapability: null` leaves every island at the size the drawing gave it. It is not a
 *  tidiness: the ratio scales each island by a factor derived from its OWN area, which differs
 *  between the arms, so leaving it on would hide the projection behind a per-arm resize. */
function arm(elevationDeg: number): Descriptor3D[] {
  return worldTo3D(islandScene({ cameraElevationDeg: elevationDeg }), { landAreaPerCapability: null });
}

/**
 * The DRAWN descriptors of one arm, narrowed through the union's own discriminant — see the
 * header's last paragraph for why this is never an assertion.
 */
function drawn(descriptors: readonly Descriptor3D[]): InstanceDescriptor[] {
  return descriptors.filter((d): d is InstanceDescriptor => d.kind !== 'skipped');
}

function extent(ds: readonly InstanceDescriptor[], axis: 'x' | 'z'): number {
  const v = ds.flatMap((d) => (d.points ?? [d.transform]).map((p) => p[axis]));
  return Math.max(...v) - Math.min(...v);
}

/** The drawing writes its path coordinates to ONE decimal, so BOTH x and z carry up to ±0.05 of
 *  rounding — x untouched by the projection, z multiplied by `1 / sin(land camera)` on the way
 *  back to the ground plane (50 degrees since ADR-0593 D1; it was 20 before). The nearest-twin
 *  match below is a Euclidean distance over both axes at once, so the bound has to be the
 *  Euclidean SUM of the two roundings — `hypot(0.05, 0.05 / sin(land camera))` — not the z term
 *  alone.
 *
 *  ⚠ THAT DISTINCTION USED TO BE INVISIBLE. At the retired 20-degree camera the z term
 *  (~0.1462) so dominated the x term (0.05) that the z-only bound and the correct hypot bound
 *  (~0.1545) were both comfortably above the measured worst case (~0.128) — either formula
 *  passed. Raising the camera to 50 degrees shrinks the z term to ~0.0653, close enough to the
 *  untouched x term that dropping x is no longer safe: the z-only bound is BELOW the measured
 *  worst case (~0.079), and only the hypot form (~0.0822) still holds. Derived, never chosen: a
 *  tolerance tighter than the rounding fails on noise, and one looser than a cell (>= 8.66 units
 *  across) would accept a different island. */
const TOLERANCE = Math.hypot(0.05, 0.05 / groundFlattening());

test('⚠⚠ THE MAPPER UN-PROJECTS NOTHING (ADR-0546 D1): the plan-view arm IS the drawing with z divided by sin(land camera)', () => {
  const trueGround = drawn(arm(PLAN_VIEW_ELEVATION_DEG));
  const drawing = drawn(arm(LAND_CAMERA_ELEVATION_DEG));

  assert.equal(trueGround.length, 174, 'the fixture draws 174 descriptors');
  assert.equal(drawing.length, trueGround.length, 'and both arms draw the same number');

  const kinds = (ds: readonly InstanceDescriptor[]): string => [...ds.map((d) => d.kind)].sort().join(',');
  assert.equal(kinds(trueGround), kinds(drawing), 'and the same kinds, in the same multiset');

  // Re-derived under ADR-0593 D1 (land camera 20 -> 50 degrees): TOLERANCE ~= 0.0822, down from
  // ~0.1545 at the retired 20 degrees (see the derivation comment above for why the x term now
  // matters). Still well inside a cell (>= 8.66 units across).
  assert.ok(TOLERANCE > 0.08 && TOLERANCE < 0.085, `tolerance ${TOLERANCE}`);

  // Matched WITHIN KIND and best-first: a mixed population and an in-order greedy walk each inflate
  // a defect on their own, and together they once turned 0.348 units into a reported 62.
  const s = groundFlattening();
  const candidates = new Map<string, Array<{ x: number; z: number }>>();
  for (const d of drawing) {
    const at = candidates.get(d.kind) ?? [];
    at.push({ x: d.transform.x, z: d.transform.z / s });
    candidates.set(d.kind, at);
  }
  let worst = 0;
  for (const d of trueGround) {
    let best = Infinity;
    for (const c of candidates.get(d.kind) ?? []) {
      best = Math.min(best, Math.hypot(d.transform.x - c.x, d.transform.z - c.z));
    }
    worst = Math.max(worst, best);
    assert.ok(best < TOLERANCE, `a ${d.kind} has no twin within ${TOLERANCE.toFixed(3)} (nearest ${best.toFixed(3)})`);
  }
  // Not vacuous: the two arms are genuinely different streams, not one array compared with itself.
  assert.ok(worst > 0, 'the arms agree to the BIT, which would mean one is the other');

  // Height is untouched by a ground-plane projection, so it must be identical rather than close —
  // and it is the axis that would move first if a projection were ever applied to the wrong one.
  for (const i of trueGround.keys()) {
    assert.equal(trueGround[i]!.transform.y, drawing[i]!.transform.y, `height at ${i}`);
  }
});

test('⚠⚠ THE DELETION IS VISIBLE IN THE EXTENTS: the drawing is the squashed ribbon, the plan-view scene the recipe’s own cluster', () => {
  const cells = (ds: readonly Descriptor3D[]): InstanceDescriptor[] =>
    ds.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
  const trueGround = cells(arm(PLAN_VIEW_ELEVATION_DEG));
  const drawing = cells(arm(LAND_CAMERA_ELEVATION_DEG));

  // x is untouched by a ground projection, so both arms are the same island across the page.
  assert.ok(Math.abs(extent(trueGround, 'x') - extent(drawing, 'x')) < 1e-9, 'the width is the projection’s fixed axis');
  assert.ok(Math.abs(extent(trueGround, 'x') - 233.8) < 0.5, `width ${extent(trueGround, 'x')}`);

  // ⚠ THE RED→GREEN. Until ADR-0546 the mapper repaired the drawing, so BOTH depths were 135.0 and
  // this assertion could not distinguish them. It now reads the un-repaired drawing: 103.4, up
  // from 46.2 at the retired 20-degree camera (ADR-0593 D1 raised it to 50) — the true-ground
  // depth (135.0) is unchanged because `PLAN_VIEW_ELEVATION_DEG` never moved, but the DRAWING is
  // far less squashed at 50 degrees, so it sits much closer to the true depth than it used to:
  // 46.2 / 135.0 ~= 0.342 = sin(20 deg) then, 103.4 / 135.0 ~= 0.766 = sin(50 deg) now.
  assert.ok(Math.abs(extent(trueGround, 'z') - 135.0) < 0.5, `true depth ${extent(trueGround, 'z')}`);
  assert.ok(Math.abs(extent(drawing, 'z') - 103.4) < 0.5, `drawn depth ${extent(drawing, 'z')}`);
  assert.ok(
    Math.abs(extent(drawing, 'z') / groundFlattening() - extent(trueGround, 'z')) < TOLERANCE,
    'the depth differs by exactly the projection',
  );
});
