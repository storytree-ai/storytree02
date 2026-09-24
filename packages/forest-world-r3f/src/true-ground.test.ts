// true-ground.test.ts — the one-way legacy adapter from a 2D drawing to true ground.
//
// ⚠ IT HAD NO TESTS OF ITS OWN WHILE IT LIVED IN `harness/`, and that was survivable there because
// nothing shipped depended on it. It does now (the studio's land view), so the properties are
// asserted here in its new home rather than inferred from the pictures its callers produce —
// `check:mutation-diff` mutates a project's `src/` only, so a harness exercise of these lines
// would buy nothing.
//
// THE PROPERTY, stated once: this is the INVERSE of `projectGround` about the ORIGIN, applied to
// the ground plane alone. So the sharpest assertion available is a ROUND TRIP against the land's
// own projection — project a known true-ground world down to a drawing with the shared function,
// convert it back with this one, and require the original.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  projectGround,
  type SceneG,
} from '@storytree/forest-world';

import { LAND_AREA_PER_CAPABILITY, sizeIslandsByCapability } from './land-per-capability.js';
import { landStreamFromDrawing, trueGroundFromDrawing } from './true-ground.js';
import { worldTo3D, type Descriptor3D, type InstanceDescriptor } from './world-to-3d.js';

/** A parcel whose ring is the four points given, in the DRAWING's coordinates. */
function drawnCell(ring: readonly (readonly [number, number])[]): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    material: 'healthy',
    island: 'a',
    points: ring.map(([x, z]) => ({ x, y: 0, z })),
  };
}

test('the ROUND TRIP against the land’s own projection is exact', () => {
  // A true-ground square, projected to a drawing by the function the 2D map projects with, then
  // brought back by this one. Anything but the inverse fails here, and it fails for a reason a
  // reader can name rather than against a remembered constant.
  const trueGround: readonly (readonly [number, number])[] = [
    [-30, -40],
    [30, -40],
    [30, 40],
    [-30, 40],
  ];
  const drawing = drawnCell(trueGround.map(([x, z]) => {
    const p = projectGround({ x, y: z });
    return [p.x, p.y] as const;
  }));
  const [recovered] = trueGroundFromDrawing([drawing]);
  assert.ok(recovered !== undefined);
  const got = recovered.points ?? [];
  assert.equal(got.length, trueGround.length);
  for (const [i, [x, z]] of trueGround.entries()) {
    assert.ok(Math.abs(got[i]!.x - x) < 1e-9, `x[${i}] ${got[i]!.x}`);
    assert.ok(Math.abs(got[i]!.z - z) < 1e-9, `z[${i}] ${got[i]!.z}`);
  }
  // ⚠ NON-VACUITY: the drawing really was squashed, or the round trip above proves nothing.
  const drawnDepth = Math.abs((drawing.points![2]!).z - (drawing.points![0]!).z);
  assert.ok(Math.abs(drawnDepth - 80 * groundFlattening(LAND_CAMERA_ELEVATION_DEG)) < 1e-9);
  assert.ok(drawnDepth < 80);
});

test('only ground DEPTH moves — x and the upright axis are untouched', () => {
  const cell = drawnCell([
    [10, 4],
    [70, 4],
    [70, 20],
    [10, 20],
  ]);
  const lifted: InstanceDescriptor = { ...cell, transform: { x: 40, y: 7, z: 12 } };
  const [out] = trueGroundFromDrawing([lifted]);
  assert.ok(out !== undefined);
  assert.equal(out.transform.x, 40);
  assert.equal(out.transform.y, 7, 'y is upright, and un-projecting the GROUND never touches it');
  const factor = 1 / groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  assert.ok(Math.abs(out.transform.z - 12 * factor) < 1e-9);
  for (const [i, p] of (out.points ?? []).entries()) {
    assert.equal(p.x, cell.points![i]!.x);
    assert.ok(Math.abs(p.z - cell.points![i]!.z * factor) < 1e-9);
  }
});

test('a cave’s BEARING turns with its rim, rather than riding through unchanged', () => {
  const cave: InstanceDescriptor = {
    kind: 'cave-arch',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cave-arch',
    island: 'a',
    bearing: Math.PI / 4,
    width: 8,
  };
  const [out] = trueGroundFromDrawing([cave]);
  assert.ok(out !== undefined);
  // Stretching z about the origin swings a 45° rim normal TOWARD the x axis: the normal is
  // `(cos b, sin b / factor)` where `factor = 1 / sin(land camera)` — ~1.31 at the declared 50°
  // (ADR-0593; it was ~2.92 at the retired 20°) — so the angle shrinks either way. Derived, not
  // recalled, and re-derived below from the live constant rather than restated as a literal.
  const factor = 1 / groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  const want = Math.atan2(Math.sin(Math.PI / 4) / factor, Math.cos(Math.PI / 4));
  assert.ok(Math.abs((out.bearing ?? 0) - want) < 1e-9, `bearing ${out.bearing}`);
  assert.ok((out.bearing ?? 0) < Math.PI / 4, 'the rim turned, and in the direction the stretch implies');
});

test('a bearing-less or point-like descriptor gains neither a bearing nor a ring', () => {
  const wisp: InstanceDescriptor = {
    kind: 'wisp-sprite',
    transform: { x: 3, y: 0, z: 9 },
    group: 'wisp-sprite',
  };
  const [out] = trueGroundFromDrawing([wisp]);
  assert.ok(out !== undefined);
  assert.equal(out.bearing, undefined);
  assert.equal(out.points, undefined);
});

test('a skipped record passes through untouched — it is an audit row, not a drawable', () => {
  const skipped: Descriptor3D = { kind: 'skipped', sceneKind: 'tree' };
  assert.deepEqual(trueGroundFromDrawing([skipped]), [skipped]);
});

test('PLAN VIEW is the identity — a scene already on true ground converts to itself', () => {
  const cell = drawnCell([
    [-5, -5],
    [5, -5],
    [5, 5],
    [-5, 5],
  ]);
  assert.deepEqual(trueGroundFromDrawing([cell], PLAN_VIEW_ELEVATION_DEG), [cell]);
});

test('an edge-on elevation REFUSES rather than returning an infinite world', () => {
  const cell = drawnCell([
    [0, 0],
    [1, 0],
    [1, 1],
  ]);
  // At 0° the ground plane projects to a line: there is no scale that undoes it, and silently
  // returning Infinity would put every island at the same place with no signal anywhere.
  assert.throws(() => trueGroundFromDrawing([cell], 0), /not a scale/);
});

test('an elevation BELOW THE HORIZON refuses too — a negative scale is a mirrored forest', () => {
  const cell = drawnCell([
    [0, 0],
    [1, 0],
    [1, 1],
  ]);
  // ⚠ A DIFFERENT FAILURE FROM EDGE-ON, and the one a finiteness check alone lets through: at the
  // negated declared elevation (-50°, ADR-0593; it was -20° at the retired camera) the factor is a
  // perfectly finite ~-1.31, so the descriptors come back looking entirely ordinary with the whole
  // forest flipped front-to-back. Nothing downstream could tell.
  assert.ok(Number.isFinite(1 / groundFlattening(-LAND_CAMERA_ELEVATION_DEG)));
  assert.ok(1 / groundFlattening(-LAND_CAMERA_ELEVATION_DEG) < 0);
  assert.throws(() => trueGroundFromDrawing([cell], -LAND_CAMERA_ELEVATION_DEG), /not a scale/);
});

test('the input is not mutated — the caller keeps its drawing', () => {
  const cell = drawnCell([
    [0, 10],
    [1, 10],
    [1, 20],
  ]);
  const before = JSON.parse(JSON.stringify(cell)) as unknown;
  trueGroundFromDrawing([cell]);
  assert.deepEqual(JSON.parse(JSON.stringify(cell)) as unknown, before);
});

// ---------------------------------------------------------------------------
// `landStreamFromDrawing` — the three-step pipeline, and the ORDER that is its whole point
// ---------------------------------------------------------------------------

/** A one-parcel island's scene graph as the 2D map emits it: a `ground` group carrying the island
 *  id, a `parcel` group carrying the capability id, and the parcel's own closed ring. Coordinates
 *  are the DRAWING's — already foreshortened, exactly as `buildScene` leaves them. */
function drawnIsland(island: string, capability: string, halfWidth: number, halfDepth: number): SceneG {
  const s = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  const ring = [
    [-halfWidth, -halfDepth * s],
    [halfWidth, -halfDepth * s],
    [halfWidth, halfDepth * s],
    [-halfWidth, halfDepth * s],
  ];
  return {
    el: 'g',
    kind: 'ground',
    id: island,
    status: 'healthy',
    children: [
      {
        el: 'g',
        kind: 'parcel',
        id: capability,
        children: [{ el: 'path', kind: 'cell', d: `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z` }],
      },
    ],
  };
}

/** The area a closed ring encloses on the ground plane (the shoelace, absolute). */
function ringArea(points: readonly { x: number; z: number }[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return Math.abs(sum) / 2;
}

test('the pipeline sizes the TRUE island, not the squashed one — the order is the substance', () => {
  const scene: SceneG = {
    el: 'g',
    children: [drawnIsland('alpha', 'cap-a', 40, 60)],
  };
  const stream = landStreamFromDrawing(scene);
  const cells = stream.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
  assert.equal(cells.length, 1);
  const area = ringArea((cells[0]!.points ?? []).map((p) => ({ x: p.x, z: p.z })));
  // ONE capability, so the island is sized to exactly one ratio's worth of land.
  assert.ok(
    Math.abs(area - LAND_AREA_PER_CAPABILITY) / LAND_AREA_PER_CAPABILITY < 1e-9,
    `sized to ${area} units², wanted ${LAND_AREA_PER_CAPABILITY}`,
  );
  // ⚠ THE SEPARATION, stated so the assertion above cannot be satisfied by the wrong order. Sizing
  // BEFORE the un-projection measures the drawing's squashed area, so the island comes out
  // `1 / sin(land camera)` too large — a plausible forest, and never an error. At the declared 50°
  // (ADR-0593) that factor is `1 / sin 50°` ≈ 1.3054 — smaller than the retired 20°'s ≈ 2.9238
  // (raising the camera un-squashes the drawing, so the wrong order has less room to be wrong in),
  // but still a real, order-of-magnitude-distinguishable-from-noise inflation. 1.25 sits with
  // margin below the true 1.3054 so a rounding wobble in the geometry can't trip the bound.
  const squashedOrderArea = LAND_AREA_PER_CAPABILITY / groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  assert.ok(squashedOrderArea / LAND_AREA_PER_CAPABILITY > 1.25, 'the two orders are far apart');
  // And the SUT's actual (correctly-ordered) area must clear the same 25%-of-a-ratio's-worth gap
  // from the wrong-order answer — margin below the true ≈0.3054×LAND_AREA_PER_CAPABILITY gap.
  assert.ok(
    Math.abs(area - squashedOrderArea) > LAND_AREA_PER_CAPABILITY * 0.25,
    'and this is not that one',
  );
});

test('the pipeline sizes ONCE, and a RIBBON is where sizing twice shows', () => {
  // ⚠ WHY THIS FIXTURE AND NOT A SIMPLER ONE. `landAreaPerCapability: null` tells the mapper to
  // leave the islands at the drawing's size, so the sizing runs afterwards, on true ground. Asked
  // for the shipped ratio instead, the mapper sizes the DRAWING and the pipeline then sizes again —
  // and over CELLS ALONE the two orders agree to 2.3e-13 (measured), because each pass re-derives
  // the target area from whatever it finds and scales each island about its OWN centre. A
  // cells-only assertion therefore cannot separate them, which is what makes this fixture the
  // cheapest one that can.
  //
  // A RIBBON can. A trail belongs to no island: near an island's shore it moves as the island's
  // ground does, tapering to nothing out in open ground (`spanShift`, true-footprint.ts) — and a
  // taper computed twice, over geometry the first pass already moved, is not the taper once.
  const s = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  // Two islands of DIFFERENT size and capability count, so their factors differ. Ground
  // footprints: `a` 80 x 120 over one capability, `b` 180 x 180 over four. Each island's cells are
  // drawn as one rectangle per capability.
  const island = (id: string, caps: readonly string[], cx: number, cz: number, hw: number, hd: number): SceneG => ({
    el: 'g',
    kind: 'ground',
    id,
    status: 'healthy',
    children: caps.map((c, i) => {
      const x0 = cx - hw + (i * 2 * hw) / caps.length;
      const x1 = cx - hw + ((i + 1) * 2 * hw) / caps.length;
      const ring = [[x0, (cz - hd) * s], [x1, (cz - hd) * s], [x1, (cz + hd) * s], [x0, (cz + hd) * s]];
      return {
        el: 'g' as const,
        kind: 'parcel',
        id: c,
        children: [{ el: 'path' as const, kind: 'cell', d: `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z` }],
      };
    }),
  });
  const scene: SceneG = {
    el: 'g',
    children: [
      island('a', ['ca'], 0, 0, 40, 60),
      island('b', ['cb', 'cc', 'cd', 'ce'], 400, 900, 90, 90),
      // A three-point ribbon from a's centre to b's centre, drawn in the DRAWING's squashed space;
      // its middle point sits just off a's shore, inside the band where the road follows the island.
      { el: 'path', kind: 'trail-fill', id: 'seg1', edges: 'a->b', d: `M 0 0 L 60 ${90 * s} L 400 ${900 * s}` },
    ],
  };

  const ribbon = landStreamFromDrawing(scene).find((d): d is InstanceDescriptor => d.kind === 'trail-strip');
  assert.ok(ribbon !== undefined, 'the fixture carries a ribbon, or this proves nothing');
  const pts = ribbon.points ?? [];
  assert.equal(pts.length, 3);

  // THE DERIVATION, from the fixture and the shared ratio — never from a run. Un-projected, the
  // ribbon runs (0, 0) → (60, 90) → (400, 900) on true ground, and each island scales about its
  // own centre by `√(capabilities · ratio / area)`.
  const fa = Math.sqrt(LAND_AREA_PER_CAPABILITY / (80 * 120));
  const fb = Math.sqrt((4 * LAND_AREA_PER_CAPABILITY) / (180 * 180));
  assert.ok(Math.abs(fa - fb) > 0.01, 'the two islands really do scale differently');
  // The ENDS sit exactly on their islands' centres, so scaling about those centres leaves them put.
  assert.ok(Math.abs(pts[0]!.x) < 1e-9 && Math.abs(pts[0]!.z) < 1e-9);
  assert.ok(Math.abs(pts[2]!.x - 400) < 1e-9 && Math.abs(pts[2]!.z - 900) < 1e-9);
  // The MIDDLE point is past a's reach (its farthest corner, √(40² + 60²)) and inside the band, so
  // it moves by a's rim move on its ray, tapered; b is ~880 away and contributes nothing.
  const reach = Math.hypot(40, 60);
  const r = Math.hypot(60, 90);
  const band = reach * Math.max(1, 2 * Math.abs(fa - 1));
  assert.ok(r > reach && r < reach + band, 'the middle point is in the band, or the taper is not exercised');
  const w = (reach / r) * (1 - (r - reach) / band);
  const midX = 60 + 60 * (fa - 1) * w;
  const midZ = 90 + 90 * (fa - 1) * w;
  assert.ok(Math.abs(pts[1]!.x - midX) < 1e-6, `mid x ${pts[1]!.x} wanted ${midX}`);
  assert.ok(Math.abs(pts[1]!.z - midZ) < 1e-6, `mid z ${pts[1]!.z} wanted ${midZ}`);
  // ⚠ THE SEPARATION: sizing the drawing in the mapper and then sizing again lands this point
  // elsewhere — which is the whole reason the mapper is asked to leave the islands alone.
  const twice = sizeIslandsByCapability(
    trueGroundFromDrawing(worldTo3D(scene)),
    LAND_AREA_PER_CAPABILITY,
  ).find((d): d is InstanceDescriptor => d.kind === 'trail-strip');
  const tp = twice!.points![1]!;
  assert.ok(Math.hypot(pts[1]!.x - tp.x, pts[1]!.z - tp.z) > 0.5, `and this is not the twice-sized answer (${tp.x}, ${tp.z})`);
});

test('the pipeline stands the island UPRIGHT — the drawing’s squash is gone by the end', () => {
  const scene: SceneG = { el: 'g', children: [drawnIsland('alpha', 'cap-a', 50, 50)] };
  const cells = landStreamFromDrawing(scene).filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
  const ring = cells[0]!.points ?? [];
  const width = Math.max(...ring.map((p) => p.x)) - Math.min(...ring.map((p) => p.x));
  const depth = Math.max(...ring.map((p) => p.z)) - Math.min(...ring.map((p) => p.z));
  // A square island drawn at the declared 50° (ADR-0593) is a ~1.31:1 letterbox on the page (it
  // was a 2.92:1 letterbox at the retired 20° — less squashed at the steeper camera, but still
  // squashed); on true ground it is square again either way. The scaling is isotropic, so the
  // RATIO is what the un-projection is judged on, and that judgement is camera-agnostic.
  assert.ok(Math.abs(width / depth - 1) < 1e-9, `${width} x ${depth}`);
});
