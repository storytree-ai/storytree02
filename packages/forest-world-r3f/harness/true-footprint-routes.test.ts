// true-footprint-routes.test.ts — WHERE THE REAL FIXTURE ISLAND'S TRUE FOOTPRINT COMES FROM, now
// that the mapper does not supply it.
//
// ⚠⚠ THE TWO ROUTES BECAME ONE (ADR-0546 D1, 2026-09-08). This file used to hold that the mapper's
// DEFAULT output — the drawing, un-projected per island by `restoreTrueFootprint` — was the same
// island the scene itself builds at plan view, two implementations of one unprojection agreeing to
// the drawing's own rounding. The repair is deleted and the 3D forest stands on true ground, so
// there is exactly one route left: the scene is built at plan view and the mapper lays it down as
// written. What this file holds is therefore the OTHER half of the same fact — that the fixture
// island's true footprint IS the recipe's own hex cluster, and that a scene handed over at the
// declared camera is the squashed drawing the mapper will now lay down unrepaired.
//
// It lives in the harness because it needs the fixture (`scope-fence.test.ts`: src never imports
// the harness). `src/true-footprint.test.ts` holds the per-island scale's arithmetic on synthetic
// islands.

import assert from 'node:assert/strict';
import test from 'node:test';

import { PLAN_VIEW_ELEVATION_DEG, groundFlattening } from '@storytree/forest-world';

import { RECIPE_ISLAND_AREA, cellsArea } from '../src/dressing-ground.js';
import { LAND_AREA_PER_CAPABILITY, LAND_SCALE, TUNED_FIXTURE } from '../src/land-per-capability.js';
import { parcelCellsFrom } from '../src/parcel-cells.js';
import { islandCentres } from '../src/true-footprint.js';
import { worldTo3D, type Descriptor3D, type InstanceDescriptor } from '../src/world-to-3d.js';
import { islandScene } from './island-fixture.js';

/** A ground-plane extent: width along x, depth along z. */
interface Extent {
  w: number;
  d: number;
}

const cells = (ds: readonly Descriptor3D[]): InstanceDescriptor[] =>
  ds.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');

function depthOf(ds: readonly InstanceDescriptor[]): Extent {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of ds) {
    for (const p of c.points ?? []) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  return { w: maxX - minX, d: maxZ - minZ };
}

test('⚠⚠ THE FIXTURE ISLAND’S TRUE FOOTPRINT IS THE RECIPE’S OWN HEX CLUSTER — and the drawing the mapper is handed at the declared camera is the squashed ribbon, laid down unrepaired', () => {
  // ⚠ BOTH ARMS ARE READ WITH `landAreaPerCapability: null` — at the size the DRAWING gives the
  // island. This test is about the FOOTPRINT, and the land-per-capability ratio the mapper applies
  // by default (`land-per-capability.ts`) is a separate seam with its own tests
  // (`src/land-per-capability.test.ts`). Left on, it would resize each arm by a factor derived from
  // that arm's OWN area and hide the projection behind the resize.
  const unsized = { landAreaPerCapability: null } as const;
  const trueGround = cells(worldTo3D(islandScene({ cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG }), unsized));
  const drawing = cells(worldTo3D(islandScene(), unsized));
  assert.equal(trueGround.length, drawing.length, 'the same number of cells');
  assert.ok(trueGround.length > 100, `a real decomposition (${trueGround.length} cells)`);

  // The recipe's own hex cluster, ~234 x ~135 — the figure `build_land.py`'s render was stamped at,
  // and the thing ADR-0517 D1 was opened to recover. It is the SCENE that carries it now.
  const shape = depthOf(trueGround);
  assert.ok(shape.w > 220 && shape.w < 250, `width ${shape.w}`);
  assert.ok(shape.d > 125 && shape.d < 145, `depth ${shape.d}`);

  // ⚠ THE RED→GREEN OF THE DELETION. Until 2026-09-08 this arm went through the repair and came
  // back at ~135 too; the mapper now lays the drawing down as written, so it is the squashed ribbon
  // the 2D page actually carries — the same width, a fraction of the depth. Under ADR-0593 D1 (land
  // camera 20 -> 50 degrees) that fraction grew: 46.2 (≈ sin 20° of 135) at the retired camera, now
  // 103.4 (≈ sin 50° of 135) — still squashed relative to the true 135, but far less so.
  const drawn = depthOf(drawing);
  assert.ok(Math.abs(drawn.w - shape.w) < 1e-9, 'width untouched — x is the projection’s fixed axis');
  assert.ok(drawn.d > 95 && drawn.d < 110, `drawn depth ${drawn.d}`);

  // ⚠ AND THE TWO DIFFER BY EXACTLY THE PROJECTION, TO THE DRAWING'S OWN ROUNDING AND NO CLOSER —
  // a bound that is derived, not chosen. The scene writes its path coordinates to ONE decimal, so
  // each arm carries up to ±0.05 on the coordinate it rounds, and dividing the drawn z by
  // sin(land camera) multiplies its share by `1 / sin(land camera)`. At the live 50-degree camera
  // that is ~1.3054 (it was ~2.9238 at the retired 20 degrees — raising the camera shrinks the
  // amplifier, so the tolerance TIGHTENED from ~0.1962 to ~0.1153). A tolerance tighter than that
  // fails on noise; one looser than a cell (>= 8.66 units across) would accept a different island.
  const rounding = 0.05;
  const tolerance = rounding * (1 + 1 / groundFlattening());
  assert.ok(tolerance > 0.1 && tolerance < 0.13, `tolerance ${tolerance}`);
  assert.ok(
    Math.abs(drawn.d / groundFlattening() - shape.d) < tolerance,
    `${drawn.d} / sin(land camera) against ${shape.d}`,
  );

  // Cell for cell, not only edge to edge: every plan-view cell has a twin in the drawing whose ring
  // matches once the drawn z is divided by the projection. Read RELATIVE TO THE ISLAND'S CENTRE —
  // the projection is about the drawing's origin, so the two arms sit at different offsets and the
  // comparison must not count the translation.
  const recentre = (ds: InstanceDescriptor[], stretch: number): InstanceDescriptor[] => {
    const scaled = ds.map((d) => ({
      ...d,
      transform: { ...d.transform, z: d.transform.z * stretch },
      points: (d.points ?? []).map((p) => ({ ...p, z: p.z * stretch })),
    }));
    const c = [...islandCentres(scaled).values()][0]!;
    return scaled.map((d) => ({
      ...d,
      transform: { ...d.transform, x: d.transform.x - c.x, z: d.transform.z - c.z },
      points: (d.points ?? []).map((p) => ({ ...p, x: p.x - c.x, z: p.z - c.z })),
    }));
  };
  const plan = recentre(trueGround, 1);
  const shipped = recentre(drawing, 1 / groundFlattening());
  const centroid = (d: InstanceDescriptor) => {
    const pts = d.points ?? [];
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, z: pts.reduce((s, p) => s + p.z, 0) / pts.length };
  };
  let worstVertex = 0;
  for (const a of plan) {
    const ca = centroid(a);
    let best: InstanceDescriptor | null = null;
    let bestDist = Infinity;
    for (const b of shipped) {
      const cb = centroid(b);
      const dist = Math.hypot(ca.x - cb.x, ca.z - cb.z);
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    assert.ok(best !== null && bestDist < tolerance, `a plan-view cell has no twin within ${tolerance} (nearest ${bestDist})`);
    assert.equal(best.points?.length, a.points?.length, 'the twin has the same ring');
    for (const p of a.points ?? []) {
      let nearest = Infinity;
      for (const q of best.points ?? []) nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.z - q.z));
      worstVertex = Math.max(worstVertex, nearest);
    }
  }
  assert.ok(worstVertex < tolerance, `worst vertex deviation ${worstVertex} against ${tolerance}`);
  // Not vacuous: the agreement is far tighter than the thing it distinguishes — a cell of the drawn
  // mesh is >= 8.66 units across — and not to the bit, which would mean one arm IS the other.
  assert.ok(worstVertex > 0);
});

test('⚠⚠ RECIPE_ISLAND_AREA IS THE FIXTURE ISLAND’S OWN AREA THROUGH THE SHIPPED MAPPER — re-derived, in the true-footprint basis', () => {
  // The constant claims to be "the ground the recipe's thirteen stands were scattered over, in
  // this map's placement units". This is the check that it IS: the fixture island (the recipe's
  // own thirteen hexes) through `worldTo3D` and `parcelCellsFrom`, summed by the same `cellsArea`
  // the stand count divides by.
  //
  // ⚠ THREE BASES, and the constant is the FIRST:
  //   1. THROUGH THE SHIPPED MAPPER (default options) — the island sized by the land-per-capability
  //      ratio (`land-per-capability.ts`): `capabilities × LAND_AREA_PER_CAPABILITY`, 11 × 318 =
  //      3,498 units² exactly, since the mapper scales each island so that its area IS that product.
  //      This is the basis the constant is declared in (`RECIPE_ISLAND_AREA = 24631.8 * LAND_SCALE²`).
  //   2. THE TRUE FOOTPRINT AS DRAWN (`landAreaPerCapability: null`) — 24,625.1 units², the
  //      thirteen hexes at the size the plan-view scene gives them. ⚠ IT MOVED BY 6.7 UNITS² ON
  //      2026-09-08 AND THE MOVE IS THE DELETION'S, NOT A DRIFT: this used to be 24,631.8, read off
  //      the drawing UN-PROJECTED, where each coordinate's ±0.05 of one-decimal rounding was
  //      multiplied by 1/sin 20° = 2.9238. Read off a plan-view scene the rounding is carried once,
  //      so the residue over thirteen IDEAL hexes (24,622.0) falls from ~9.8 units² to ~3.1. The new
  //      figure is the CLOSER of the two to the recipe's own geometry.
  //   3. THE SQUASHED RIBBON (the scene at the DECLARED camera, unsized) — 18,850.1 at the live
  //      50-degree camera (ADR-0593 D1; it was 8,424.6 at the retired 20 degrees); the true
  //      footprint is exactly `1 / sin(land camera)` (~1.3054 now, ~2.9238 before) times that. It
  //      is what the mapper now lays down for a caller that hands over a drawing (ADR-0546 D1),
  //      which is why it stays pinned — to whatever the live camera makes it, not to a literal
  //      camera value.
  //
  // ⚠ WHICH SCENE CARRIES WHICH BASIS MOVED ON 2026-09-08 AND THE NUMBERS DID NOT. Bases 2 and 3
  // used to be selected by an argument to the MAPPER; they are selected by the camera the SCENE is
  // built at now. Basis 1's area is unchanged either way — the ratio normalises an island to
  // `capabilities × LAND_AREA_PER_CAPABILITY` whatever shape it arrives in — so the constant this
  // test exists for is untouched by the deletion.
  const area = cellsArea(parcelCellsFrom(worldTo3D(islandScene({ cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG }))));
  // The ratio's own promise, held on the real island: the sized area is the product, exactly.
  assert.ok(
    Math.abs(area - TUNED_FIXTURE.capabilities * LAND_AREA_PER_CAPABILITY) < 1e-6,
    `sized area ${area} is not capabilities × ratio (${TUNED_FIXTURE.capabilities * LAND_AREA_PER_CAPABILITY})`,
  );
  const drawnTrue = cellsArea(
    parcelCellsFrom(worldTo3D(islandScene({ cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG }), { landAreaPerCapability: null })),
  );
  assert.ok(Math.abs(drawnTrue - 24625.1) < 0.05, `drawn true-footprint area ${drawnTrue}`);
  const drawn = cellsArea(parcelCellsFrom(worldTo3D(islandScene(), { landAreaPerCapability: null })));
  // Re-measured under ADR-0593 D1 (land camera 20 -> 50 degrees): 18,850.1, up from 8,424.6 at the
  // retired 20 degrees — `drawnTrue` is unaffected (basis 2 is built at `PLAN_VIEW_ELEVATION_DEG`,
  // which did not move), so the ratio below is what actually carries the camera's move.
  assert.ok(Math.abs(drawn - 18850.1) < 0.05, `drawn area ${drawn} — the old basis`);
  // ⚠ TO THE DRAWING'S ROUNDING, NOT TO THE BIT, AND THAT LOOSENING IS ADR-0546 D1's. The two used
  // to be the SAME scene, one of them stretched by the mapper, so the ratio was the stretch exactly.
  // They are two separate builds now — one at plan view, one at the land camera — each rounding its
  // own coordinates to a decimal, so they agree to about 1 part in 3,500 and no closer.
  assert.ok(Math.abs(drawnTrue / drawn - 1 / groundFlattening()) < 1e-3, `${drawnTrue / drawn} against ${1 / groundFlattening()}`);
  // And the sized island against the drawn one is LAND_SCALE² to the drawing's own rounding: the
  // global factor is `√(318 / (13 ideal hex tiles / 11))`, the per-island one `√(11 × 318 / the
  // drawn 24,625.1)`, and the two differ only by the ~3 units² the drawing's one-decimal
  // coordinates add over thirteen ideal hexes (24,622.0).
  assert.ok(Math.abs(area / drawnTrue - LAND_SCALE * LAND_SCALE) < 1e-3, `sized / drawn ${area / drawnTrue} vs LAND_SCALE² ${LAND_SCALE * LAND_SCALE}`);
  // THE CONSTANT ITSELF, last, so a red here names only the constant: it must be the fixture's
  // area through the shipped mapper (basis 1) to the same 0.05 the old basis was held to.
  assert.ok(Math.abs(area - RECIPE_ISLAND_AREA) < 0.05, `fixture area ${area} against the constant ${RECIPE_ISLAND_AREA}`);
});
