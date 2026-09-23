// cell-ground-geometry.test.ts — the claims the merged ground buffer rests on.
//
// ⚠ THE ONE THAT MATTERS IS THE WINDING. A parcel whose top face is wound the wrong way is
// INVISIBLE FROM ABOVE under backface culling — which is indistinguishable, on the only surface
// that draws this, from the bug the whole increment exists to fix. It cannot be settled by
// argument: the relaxed mesh's rings come out of a Voronoi relaxation clipped to an island
// boundary, with no guaranteed orientation and no guaranteed convexity. So every claim here is
// checked against the emitted buffer itself, and the fixtures deliberately include a ring handed
// in each orientation and one that is not convex.

import test from 'node:test';
import assert from 'node:assert/strict';

import { LAND_SCALE } from './land-per-capability.js';
import {
  CELL_GROUND_DEPTH,
  cellGroundGeometry,
  cellGroundTriangles,
  groundFaceTriangles,
  normalisedRing,
  pointInTriangle,
  signedRingArea2,
  signedTriangleArea2,
  triangulateRing,
  FLAT_GROUND,
  ZERO_ORIGIN,
  type AtlasOrigin,
  type GroundRelief,
  type LinearRgb,
} from './cell-ground-geometry.js';
import { landNormal, landRelief } from './land-relief.js';
import { worldTo3D, type Descriptor3D, type InstanceDescriptor } from './world-to-3d.js';

const WHITE: LinearRgb = { r: 1, g: 1, b: 1 };
const resolveWhite = (): LinearRgb => WHITE;

/** A `cell-ground` descriptor over a ring given as [x, z] pairs. */
function cellOf(ring: readonly (readonly [number, number])[], material?: string): InstanceDescriptor {
  const points = ring.map(([x, z]) => ({ x, y: 0, z }));
  const d: InstanceDescriptor = {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    points,
  };
  if (material !== undefined) d.material = material;
  return d;
}

/** A unit square, counter-clockwise in the (x, z) plane. */
const SQUARE_CCW = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
] as const;

/** The same square, handed the other way round. */
const SQUARE_CW = [...SQUARE_CCW].reverse();

/** An L-shape: NOT convex, and chosen because its CENTROID FALLS OUTSIDE IT — (13.3, 13.3) lands
 *  in the notch. That is what makes it a real test rather than a decorative one: a centroid fan
 *  emits inverted triangles here, and a centroid-based outward test picks the wrong side of two
 *  of its six walls. Both mistakes were made and both were caught by this fixture. */
const L_SHAPE = [
  [0, 0],
  [0, 30],
  [10, 30],
  [10, 10],
  [30, 10],
  [30, 0],
] as const;

/** Read triangle `i` out of a non-indexed buffer as three [x, y, z] vertices. */
function triangleAt(positions: Float32Array, i: number) {
  const o = i * 9;
  return [0, 1, 2].map((v) => ({
    x: positions[o + v * 3]!,
    y: positions[o + v * 3 + 1]!,
    z: positions[o + v * 3 + 2]!,
  }));
}

/** The geometric normal of a triangle, from its vertices — computed HERE independently of the
 *  builder so that agreeing with the builder's stored normals is evidence rather than tautology. */
function normalOf(t: ReturnType<typeof triangleAt>) {
  const [a, b, c] = t as [(typeof t)[0], (typeof t)[0], (typeof t)[0]];
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.z - a.z;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.z - a.z;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return { x: nx / len, y: ny / len, z: nz / len };
}

test('a ring of n vertices costs 3n-2 triangles — a triangulated top plus two per wall', () => {
  // n-2 is what ANY simple polygon triangulates to, convex or not; 2n is the wall.
  assert.equal(cellGroundTriangles(4), 4 * 3 - 2);
  assert.equal(cellGroundTriangles(6), 6 * 3 - 2);
  // Below three there is no area to bound, so there is nothing to draw.
  assert.equal(cellGroundTriangles(2), 0);
  assert.equal(cellGroundTriangles(0), 0);
});

test('⚠⚠ A DIVIDED TOP IS COUNTED FROM ITS FACES AND ITS WALL SEPARATELY', () => {
  // THE BUFFER IS SIZED FROM THIS. A decomposition that divided the top without lengthening the
  // wall would draw a crack; one counted with the wrong arithmetic would size the buffer for a mesh
  // the writer does not produce. Both halves are asked for here, on the same call.
  //
  // A six-vertex wall divided into a four-vertex band and a four-vertex core: 2 + 2 top triangles,
  // and 12 wall triangles for the six edges.
  assert.equal(groundFaceTriangles(6, [4, 4]), 2 + 2 + 12);
  // The undivided parcel is the one-face case, and `cellGroundTriangles` IS that case.
  assert.equal(groundFaceTriangles(6, [6]), cellGroundTriangles(6));
  assert.equal(groundFaceTriangles(4, [4]), 4 * 3 - 2);
  // ⚠ A SUB-FACE THAT BOUNDS NO AREA CONTRIBUTES NOTHING, and must not contribute a NEGATIVE.
  // `triangulateRing` emits nothing for a ring of fewer than three vertices; an unguarded
  // `length - 2` would take two triangles OFF the count for each one and under-size the buffer the
  // caller then writes into.
  assert.equal(groundFaceTriangles(4, [4, 2]), groundFaceTriangles(4, [4]));
  assert.equal(groundFaceTriangles(4, [4, 1]), groundFaceTriangles(4, [4]));
  assert.equal(groundFaceTriangles(4, [4, 0]), groundFaceTriangles(4, [4]));
  // A face of exactly three IS a triangle and contributes one.
  assert.equal(groundFaceTriangles(4, [4, 3]), groundFaceTriangles(4, [4]) + 1);
  // A wall that bounds no area is no parcel at all, whatever faces are claimed for it.
  assert.equal(groundFaceTriangles(2, [4, 4]), 0);
  assert.equal(groundFaceTriangles(0, []), 0);
});

test('the buffer is non-indexed and self-consistent: 3 vertices and 9 floats per triangle', () => {
  const geo = cellGroundGeometry({ cells: [cellOf(SQUARE_CCW)], resolve: resolveWhite });
  assert.equal(geo.cells, 1);
  assert.equal(geo.triangles, 10);
  assert.equal(geo.positions.length, 10 * 9);
  assert.equal(geo.normals.length, 10 * 9);
  assert.equal(geo.colors.length, 10 * 9);
});

test('EVERY top face points +Y, whichever way the ring was handed in', () => {
  // ⚠ The three arms are the point of this test. `worldTo3D` passes the scene's ring through
  // untouched — winding is settled HERE and nowhere else — so the builder is held to producing an
  // upward top face under both handednesses and for a ring that is not convex.
  for (const [label, ring] of [
    ['ccw', SQUARE_CCW],
    ['cw', SQUARE_CW],
    ['non-convex L', L_SHAPE],
  ] as const) {
    const geo = cellGroundGeometry({ cells: [cellOf(ring)], resolve: resolveWhite });
    const tops = [];
    for (let i = 0; i < geo.triangles; i += 1) {
      const t = triangleAt(geo.positions, i);
      if (t.every((v) => v.y === 0)) tops.push(normalOf(t));
    }
    assert.equal(tops.length, ring.length - 2, `${label}: a simple polygon triangulates to n-2`);
    for (const n of tops) {
      assert.ok(
        Math.abs(n.y) > 0.999,
        `${label}: a top face must be horizontal, got normal.y=${n.y}`,
      );
    }
    // All of them agree, and they agree on UP — a fan half of which faced down would still
    // satisfy a per-triangle |y| check.
    const ups = tops.filter((n) => n.y > 0).length;
    assert.equal(ups, tops.length, `${label}: ${tops.length - ups} top faces point DOWN`);
  }
});

test('the stored normals are the emitted geometry’s own, not authored beside it', () => {
  const geo = cellGroundGeometry({ cells: [cellOf(L_SHAPE)], resolve: resolveWhite });
  for (let i = 0; i < geo.triangles; i += 1) {
    const expected = normalOf(triangleAt(geo.positions, i));
    for (let v = 0; v < 3; v += 1) {
      const o = i * 9 + v * 3;
      assert.ok(Math.abs(geo.normals[o]! - expected.x) < 1e-5, `tri ${i} vtx ${v} normal.x`);
      assert.ok(Math.abs(geo.normals[o + 1]! - expected.y) < 1e-5, `tri ${i} vtx ${v} normal.y`);
      assert.ok(Math.abs(geo.normals[o + 2]! - expected.z) < 1e-5, `tri ${i} vtx ${v} normal.z`);
    }
  }
});

/** Ray-casting point-in-polygon in the (x, z) plane. Used instead of a centroid comparison
 *  because the centroid test is exactly what this module stopped relying on: for the non-convex
 *  L the centroid sits in the notch, OUTSIDE the shape, so "away from the centre" points INTO
 *  the parcel along two of its six edges — a test written that way would have demanded the bug. */
function insidePolygon(px: number, pz: number, ring: readonly (readonly [number, number])[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, zi] = ring[i]!;
    const [xj, zj] = ring[j]!;
    if (zi > pz !== zj > pz && px < ((xj - xi) * (pz - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

test('every wall faces OUT OF the parcel, including on a non-convex ring', () => {
  for (const [label, ring] of [
    ['ccw square', SQUARE_CCW],
    ['cw square', SQUARE_CW],
    ['non-convex L', L_SHAPE],
  ] as const) {
    const geo = cellGroundGeometry({ cells: [cellOf(ring)], resolve: resolveWhite });
    let walls = 0;
    for (let i = 0; i < geo.triangles; i += 1) {
      const t = triangleAt(geo.positions, i);
      if (t.every((v) => v.y === 0)) continue; // a top face
      walls += 1;
      const n = normalOf(t);
      assert.ok(Math.abs(n.y) < 1e-6, `${label} wall ${i} must be vertical, got normal.y=${n.y}`);
      // Step a short way along the face normal from the wall's own midpoint. Outward means the
      // step lands OUTSIDE the parcel AND the mirrored step lands inside — checking both is what
      // rules out a midpoint that was already outside for some unrelated reason.
      const mx = (t[0]!.x + t[1]!.x + t[2]!.x) / 3;
      const mz = (t[0]!.z + t[1]!.z + t[2]!.z) / 3;
      const eps = 0.05;
      assert.equal(
        insidePolygon(mx + n.x * eps, mz + n.z * eps, ring),
        false,
        `${label} wall ${i} normal points INTO the parcel`,
      );
      assert.equal(
        insidePolygon(mx - n.x * eps, mz - n.z * eps, ring),
        true,
        `${label} wall ${i}: the mirrored step is not inside either — the probe is unsound`,
      );
    }
    assert.equal(walls, ring.length * 2, `${label}: two wall triangles per ring edge`);
  }
});

test('CELL_GROUND_DEPTH is the tuned 3 units × LAND_SCALE — the prism thins with the island', () => {
  assert.equal(CELL_GROUND_DEPTH, 3 * LAND_SCALE);
  assert.ok(CELL_GROUND_DEPTH > 1 && CELL_GROUND_DEPTH < 3);
});

test('walls fall exactly CELL_GROUND_DEPTH below the ground plane, and the top sits at y=0', () => {
  const geo = cellGroundGeometry({ cells: [cellOf(SQUARE_CCW)], resolve: resolveWhite });
  const ys = new Set<number>();
  for (let i = 0; i < geo.positions.length; i += 3) ys.add(geo.positions[i + 1]!);
  // `Math.fround` because the buffer is a Float32Array and the depth is `3 * LAND_SCALE`
  // (`land-per-capability.ts`) — no longer a float32-exact integer. The claim is unchanged: the
  // walls sit at exactly the depth the buffer can hold, and nothing else.
  assert.deepEqual([...ys].sort((a, b) => a - b), [Math.fround(-CELL_GROUND_DEPTH), 0]);
});

test('per-parcel colour survives the merge — every vertex of a parcel wears its own status', () => {
  const red: LinearRgb = { r: 1, g: 0, b: 0 };
  const blue: LinearRgb = { r: 0, g: 0, b: 1 };
  const resolve = (m: string | undefined): LinearRgb => (m === 'healthy' ? red : blue);
  const geo = cellGroundGeometry({
    cells: [cellOf(SQUARE_CCW, 'healthy'), cellOf(L_SHAPE, 'unhealthy')],
    resolve,
  });
  assert.equal(geo.cells, 2);
  const first = cellGroundTriangles(SQUARE_CCW.length) * 9;
  for (let i = 0; i < first; i += 3) {
    assert.equal(geo.colors[i], 1, `parcel 1 vertex ${i / 3} is not red`);
    assert.equal(geo.colors[i + 2], 0);
  }
  for (let i = first; i < geo.colors.length; i += 3) {
    assert.equal(geo.colors[i], 0, `parcel 2 vertex ${i / 3} is not blue`);
    assert.equal(geo.colors[i + 2], 1);
  }
});

test('no cells is an empty buffer, not a throw — the classic substrate is an ordinary island', () => {
  const geo = cellGroundGeometry({ cells: [], resolve: resolveWhite });
  assert.equal(geo.triangles, 0);
  assert.equal(geo.cells, 0);
  assert.equal(geo.positions.length, 0);
});

test('a degenerate ring is dropped rather than emitted as a parcel bounding no area', () => {
  const geo = cellGroundGeometry({
    cells: [cellOf([[0, 0], [1, 1]]), cellOf(SQUARE_CCW)],
    resolve: resolveWhite,
  });
  assert.equal(geo.cells, 1);
  assert.equal(geo.triangles, cellGroundTriangles(4));
});

// ---------------------------------------------------------------------------
// End to end: the mapper's winding normalisation and the builder agree
// ---------------------------------------------------------------------------

/** A minimal relaxed-mesh scene: a ground group carrying its status, with plain cells under it
 *  carrying NONE — the exact shape `scene.ts:3252` emits, which is what makes the status
 *  inheritance load-bearing rather than defensive. */
function meshGroundScene(rings: readonly (readonly (readonly [number, number])[])[], status: string) {
  const polyPath = (r: readonly (readonly [number, number])[]) =>
    r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z';
  return {
    el: 'g' as const,
    kind: 'ground-mesh',
    children: [
      {
        el: 'g' as const,
        kind: 'ground',
        status,
        children: rings.map((r) => ({ el: 'path' as const, kind: 'cell', d: polyPath(r) })),
      },
    ],
  };
}

test('the mapper hands the builder rings it can always fan upward', () => {
  // Both handednesses go in; every top face must still come out pointing up.
  const scene = meshGroundScene([SQUARE_CCW, SQUARE_CW, L_SHAPE], 'healthy');
  const ds: Descriptor3D[] = worldTo3D(scene as never);
  const cells = ds.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
  assert.equal(cells.length, 3);
  const geo = cellGroundGeometry({ cells, resolve: resolveWhite });
  for (let i = 0; i < geo.triangles; i += 1) {
    const t = triangleAt(geo.positions, i);
    if (!t.every((v) => v.y === 0)) continue;
    assert.ok(normalOf(t).y > 0.999, `triangle ${i} is a top face pointing down`);
  }
});

// ---------------------------------------------------------------------------
// The primitives — the orientation convention everything above rests on
// ---------------------------------------------------------------------------
//
// ⚠ WHY THESE EXIST AT ALL. The tests above check the buffer's OUTPUT SHAPE, and a mutation
// sweep over the changed lines found 78 surviving mutants inside the triangulation: on a square
// and an L, many arithmetic variants of the shoelace and many wrong ear-selection rules still
// produce the right NUMBER of triangles, all facing up, with walls on the outside. Shape is
// necessary and nowhere near sufficient. What discriminates is AREA CONSERVATION — a
// triangulation that loses, duplicates or inverts a piece cannot sum back to the polygon it came
// from — plus containment, which is what catches an ear taken at a reflex corner.

const P = (x: number, z: number) => ({ x, z });

/** A regular n-gon of radius r, wound one way; `-r` flips it. */
function ngon(n: number, r: number) {
  return Array.from({ length: n }, (_, i) => P(Math.cos((i / n) * Math.PI * 2) * r, Math.sin((i / n) * Math.PI * 2) * r));
}

/** A comb — the nastiest shape here: five deep notches, so ear selection cannot be naive and the
 *  centroid is comfortably outside the polygon. */
const COMB = (() => {
  const pts = [P(0, 0), P(0, 100)];
  for (let i = 0; i < 5; i += 1) {
    const x0 = 20 * i + 10;
    pts.push(P(x0, 100), P(x0, 25), P(x0 + 8, 25), P(x0 + 8, 100));
  }
  pts.push(P(110, 100), P(110, 0));
  return pts;
})();

const ringOf = (r: readonly (readonly [number, number])[]) => r.map(([x, z]) => P(x, z));
const SQ = ringOf(SQUARE_CCW);
const L = ringOf(L_SHAPE);

test('signedTriangleArea2 IS twice the area, and its sign IS the winding', () => {
  // A right triangle of legs 3 and 4: area 6, so |area2| = 12. Both windings, magnitude equal.
  const a = P(0, 0);
  const b = P(3, 0);
  const c = P(0, 4);
  assert.equal(Math.abs(signedTriangleArea2(a, b, c)), 12);
  assert.equal(signedTriangleArea2(a, b, c), -signedTriangleArea2(a, c, b));
  // NEGATIVE is the upward winding — the sentence the whole module rests on, pinned against the
  // buffer rather than restated: the first top face the builder emits for this ring points +Y.
  const geo = cellGroundGeometry({ cells: [cellOf(SQUARE_CCW)], resolve: resolveWhite });
  const firstTop = triangleAt(geo.positions, 0);
  assert.ok(normalOf(firstTop).y > 0.999);
  assert.ok(
    signedTriangleArea2(
      P(firstTop[0]!.x, firstTop[0]!.z),
      P(firstTop[1]!.x, firstTop[1]!.z),
      P(firstTop[2]!.x, firstTop[2]!.z),
    ) < 0,
  );
  // Collinear points bound nothing.
  assert.equal(signedTriangleArea2(P(0, 0), P(1, 1), P(2, 2)), 0);
  // Translation invariant — it is an area, not a position.
  const shift = (p: ReturnType<typeof P>) => P(p.x + 137, p.z - 91);
  assert.equal(signedTriangleArea2(a, b, c), signedTriangleArea2(shift(a), shift(b), shift(c)));
});

test('signedRingArea2 IS twice the polygon area, and reversing the ring negates it', () => {
  assert.equal(Math.abs(signedRingArea2(SQ)), 200); // a 10x10 square
  assert.equal(signedRingArea2([...SQ].reverse()), -signedRingArea2(SQ));
  // The L: 10x30 arm plus a 20x10 foot = 300 + 200 = 500, so |area2| = 1000.
  assert.equal(Math.abs(signedRingArea2(L)), 1000);
  // It agrees with the triangle form on a triangle, which is what makes them one convention.
  const tri = [P(0, 0), P(3, 0), P(0, 4)];
  assert.equal(signedRingArea2(tri), signedTriangleArea2(tri[0]!, tri[1]!, tri[2]!));
});

test('normalisedRing lands on the negative winding, is idempotent, and only ever reverses', () => {
  for (const ring of [SQ, [...SQ].reverse(), L, [...L].reverse(), COMB, [...COMB].reverse()]) {
    const n = normalisedRing(ring);
    assert.ok(signedRingArea2(n) < 0, 'not on the negative winding');
    assert.deepEqual(normalisedRing(n), n, 'not idempotent');
    // The same vertices, in the same cyclic order or its reverse — never resorted or dropped.
    assert.equal(n.length, ring.length);
    const same = n.every((p, i) => p === ring[i]);
    const reversed = n.every((p, i) => p === ring[ring.length - 1 - i]);
    assert.ok(same || reversed, 'normalisedRing did something other than reverse');
  }
});

test('pointInTriangle answers inside / outside / on the boundary', () => {
  // Wound NEGATIVE, which is the orientation the predicate is written against.
  const t = normalisedRing([P(0, 0), P(10, 0), P(0, 10)]);
  const [a, b, c] = [t[0]!, t[1]!, t[2]!];
  assert.equal(pointInTriangle(P(1, 1), a, b, c), true, 'an interior point');
  assert.equal(pointInTriangle(P(9, 9), a, b, c), false, 'beyond the hypotenuse');
  assert.equal(pointInTriangle(P(-1, 5), a, b, c), false, 'outside an edge');
  assert.equal(pointInTriangle(P(5, 5), a, b, c), true, 'ON the hypotenuse — edges are inclusive');
  assert.equal(pointInTriangle(a, a, b, c), true, 'a vertex is not outside its own triangle');
});

// ---------------------------------------------------------------------------
// triangulateRing — area conservation is the assertion that discriminates
// ---------------------------------------------------------------------------

/** A regular five-point star: ten vertices, FIVE deep reflex corners. ⚠ It is here because it is
 *  the shape that discriminates the ear test's convexity guard — remove the guard and three of its
 *  eight pieces come out inverted, while the area still conserves and the count is still n-2. The
 *  square, the L and the comb all survive that mutation unchanged. Found by search rather than by
 *  intuition, after the guard was reported as an unkilled mutant. */
const STAR = Array.from({ length: 10 }, (_, i) => {
  const a = (i / 10) * Math.PI * 2;
  const r = i % 2 ? 14 : 50;
  return P(Math.round(Math.cos(a) * r * 100) / 100, Math.round(Math.sin(a) * r * 100) / 100);
});

/** A concave ring carrying a vertex exactly on the midpoint of one of its edges — the T-junction
 *  a parcel gets when a neighbour subdivides an edge they share. ⚠ It discriminates the OTHER
 *  half of the ear test: relax `>= 0` to `> 0` and this collinear corner is taken as an ear,
 *  emitting a zero-area piece. The plain T-junction hexagon does NOT catch that (its collinear
 *  corner is never reached as an apex), which is why this shape exists as well. */
const COLLINEAR_ON_CONCAVE = [
  P(10, 0),
  P(22, 37),
  P(-10, 17),
  P(-37, 0),
  P(-7, -12),
  P(5, -9),
  P(7.5, -4.5),
];

const SHAPES: readonly (readonly [string, readonly { x: number; z: number }[]])[] = [
  ['5-point star (5 reflex corners)', STAR],
  ['5-point star reversed', [...STAR].reverse()],
  ['collinear vertex on a concave ring', COLLINEAR_ON_CONCAVE],
  ['collinear on concave, reversed', [...COLLINEAR_ON_CONCAVE].reverse()],
  ['square', SQ],
  ['square reversed', [...SQ].reverse()],
  ['non-convex L', L],
  ['non-convex L reversed', [...L].reverse()],
  ['comb (5 notches)', COMB],
  ['comb reversed', [...COMB].reverse()],
  ['triangle', [P(0, 0), P(10, 0), P(5, 8)]],
  ['24-gon', ngon(24, 40)],
  ['24-gon reversed', [...ngon(24, 40)].reverse()],
];

test('triangulateRing CONSERVES AREA — the pieces sum back to the polygon', () => {
  // ⚠ THIS IS THE LOAD-BEARING TEST OF THE MODULE. A triangulation that drops a piece, emits one
  // twice, inverts one, or takes an ear across a notch cannot sum back to the ring it came from.
  // Every other property here (count, winding, containment) is satisfiable by a wrong answer.
  for (const [label, ring] of SHAPES) {
    const tris = triangulateRing(ring);
    assert.equal(tris.length, ring.length - 2, `${label}: expected n-2 triangles`);
    let sum = 0;
    for (const [a, b, c] of tris) {
      const s = signedTriangleArea2(a, b, c);
      assert.ok(s < 0, `${label}: a piece is wound the wrong way (or is degenerate)`);
      sum += s;
    }
    assert.ok(
      Math.abs(Math.abs(sum) - Math.abs(signedRingArea2(ring))) < 1e-6,
      `${label}: pieces sum to ${Math.abs(sum)}, the ring is ${Math.abs(signedRingArea2(ring))}`,
    );
  }
});

test('every piece lies INSIDE the polygon — no ear taken across a notch', () => {
  // ⚠ Area conservation alone does not catch this on every shape: a piece taken outside the
  // polygon and a compensating overlap can still sum correctly. The comb is the shape where a
  // naive ear rule actually reaches across a notch, so its centroid test is the one that bites.
  for (const [label, ring] of SHAPES) {
    for (const [a, b, c] of triangulateRing(ring)) {
      const cx = (a.x + b.x + c.x) / 3;
      const cz = (a.z + b.z + c.z) / 3;
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
        const pi = ring[i]!;
        const pj = ring[j]!;
        if (pi.z > cz !== pj.z > cz && cx < ((pj.x - pi.x) * (cz - pi.z)) / (pj.z - pi.z) + pi.x) inside = !inside;
      }
      assert.ok(inside, `${label}: a piece's centroid (${cx}, ${cz}) is outside the polygon`);
    }
  }
});

test('no piece swallows another ring vertex — the ear test is doing its job', () => {
  for (const [label, ring] of SHAPES) {
    const pts = normalisedRing(ring);
    for (const [a, b, c] of triangulateRing(ring)) {
      for (const p of pts) {
        if (p === a || p === b || p === c) continue;
        const strictlyInside =
          signedTriangleArea2(a, b, p) < 0 && signedTriangleArea2(b, c, p) < 0 && signedTriangleArea2(c, a, p) < 0;
        assert.equal(strictlyInside, false, `${label}: a piece contains a ring vertex`);
      }
    }
  }
});

test('a degenerate ring terminates and bounds no area, rather than looping forever', () => {
  // ⚠ The guard in `triangulateRing` exists for this and nothing else, so it needs a case that
  // reaches it. Every vertex here is collinear: no corner is ever an ear, so the ear loop finds
  // nothing to clip on any pass and must fall out rather than spin.
  const collinear = [P(0, 0), P(1, 0), P(2, 0), P(3, 0), P(4, 0)];
  const tris = triangulateRing(collinear);
  for (const [a, b, c] of tris) assert.equal(signedTriangleArea2(a, b, c), 0);
  assert.equal(signedRingArea2(collinear), 0);
});

test('the buffer’s top faces ARE triangulateRing’s output, ring for ring', () => {
  // Ties the primitive to the thing that ships: the same pieces, the same count, the same area.
  for (const [label, ring] of SHAPES) {
    const cells = [cellOf(ring.map((p) => [p.x, p.z] as const))];
    const geo = cellGroundGeometry({ cells, resolve: resolveWhite });
    const tops = [];
    for (let i = 0; i < geo.triangles; i += 1) {
      const t = triangleAt(geo.positions, i);
      if (t.every((v) => v.y === 0)) tops.push(t);
    }
    const expected = triangulateRing(ring);
    assert.equal(tops.length, expected.length, `${label}: top-face count`);
    const areaOf = (ts: readonly { x: number; z: number }[][]) =>
      ts.reduce((s, t) => s + Math.abs(signedTriangleArea2(P(t[0]!.x, t[0]!.z), P(t[1]!.x, t[1]!.z), P(t[2]!.x, t[2]!.z))), 0);
    // ⚠ A RELATIVE tolerance, and it has to be. `positions` is a Float32Array — about seven
    // significant digits — so on the 24-gon (area ~4,900) an absolute 1e-6 bound is tighter than
    // the storage the numbers came out of, and the test fails on the round trip rather than on
    // anything about the triangulation.
    const got = areaOf(tops);
    const want = areaOf(expected.map((t) => [...t]));
    assert.ok(
      Math.abs(got - want) <= Math.max(1e-4, want * 1e-5),
      `${label}: the buffer's top area is ${got}, the triangulation's is ${want}`,
    );
  }
});

// ---------------------------------------------------------------------------
// The boundary cases a mutation sweep asked for
// ---------------------------------------------------------------------------
//
// ⚠ EVERY TEST BELOW EXISTS BECAUSE A SURVIVING MUTANT NAMED IT. They are the cases the shapes
// above cannot reach: a ring whose area is exactly zero, a point exactly ON an edge, a corner
// exactly collinear, an input array the caller still owns. Each is a real thing a Voronoi parcel
// clipped to a hex boundary can hand in — a T-junction puts a vertex exactly on a neighbour's
// edge — so none of this is testing for the test's sake.

test('normalisedRing does NOT mutate the array it was given', () => {
  // ⚠ `pts.slice().reverse()` — drop the `slice()` and the RETURN VALUE is identical while the
  // CALLER'S array is reversed underneath it. Nothing about the output can see that, which is
  // exactly why it survived until this test existed. `cellGroundGeometry` reuses the descriptor's
  // `points` for the walls after triangulating, so the aliasing would be live.
  const original = [P(0, 0), P(10, 0), P(10, 10), P(0, 10)];
  const copy = original.map((p) => P(p.x, p.z));
  normalisedRing(original);
  assert.deepEqual(original, copy, 'normalisedRing reversed its input in place');
});

test('normalisedRing leaves a ring it need not touch ALONE, by reference', () => {
  // ⚠ `> 0` vs `>= 0` differ on exactly one input: a ring of zero area. Both answers are equally
  // correct about the winding of something that has none, so the only observable difference is
  // whether an untouched ring is handed back as ITSELF or as a fresh reversed copy. Pinning the
  // reference is what makes that difference visible at all.
  const zeroArea = [P(0, 0), P(1, 0), P(2, 0), P(3, 0)];
  assert.equal(signedRingArea2(zeroArea), 0);
  assert.equal(normalisedRing(zeroArea), zeroArea, 'a zero-area ring was needlessly copied');
  const alreadyNegative = normalisedRing(SQ);
  assert.equal(normalisedRing(alreadyNegative), alreadyNegative);
});

test('pointInTriangle is inclusive on ALL THREE edges, not just one', () => {
  // ⚠ Three separate `<= 0` terms, and a test that only probes one edge leaves the other two
  // free to become `< 0`. A parcel vertex landing exactly on a neighbour's edge is the ordinary
  // T-junction case, so each term is probed on its own edge.
  const t = normalisedRing([P(0, 0), P(12, 0), P(0, 12)]);
  const [a, b, c] = [t[0]!, t[1]!, t[2]!];
  const mid = (p: typeof a, q: typeof a) => P((p.x + q.x) / 2, (p.z + q.z) / 2);
  assert.equal(pointInTriangle(mid(a, b), a, b, c), true, 'on edge ab');
  assert.equal(pointInTriangle(mid(b, c), a, b, c), true, 'on edge bc');
  assert.equal(pointInTriangle(mid(c, a), a, b, c), true, 'on edge ca');
  // ⚠ And a point just OUTSIDE each edge in turn. Three separate terms means three separate ways
  // to be wrong, and a probe that is outside two edges at once leaves the third term free to be
  // anything — including a constant `true`. Each point below violates exactly ONE term.
  const outsideOf = (p: typeof a, q: typeof a) => {
    const m = mid(p, q);
    // Step along the outward normal of edge pq for a NEGATIVE-wound triangle: (-dz, dx).
    const dx = q.x - p.x;
    const dz = q.z - p.z;
    const len = Math.hypot(dx, dz);
    return P(m.x + (-dz / len) * 0.1, m.z + (dx / len) * 0.1);
  };
  assert.equal(pointInTriangle(outsideOf(a, b), a, b, c), false, 'just outside edge ab only');
  assert.equal(pointInTriangle(outsideOf(b, c), a, b, c), false, 'just outside edge bc only');
  assert.equal(pointInTriangle(outsideOf(c, a), a, b, c), false, 'just outside edge ca only');
  // ⚠ A DEGENERATE triangle: the predicate is three half-plane tests, so it collapses to "is p on
  // the line". A point OFF the line is outside; a point ON it comes back true even beyond the
  // segment's ends. That is a real limit of the predicate and it is stated rather than asserted
  // away — `triangulateRing` never asks it about a degenerate triangle, because the ear test
  // rejects a collinear corner before this is reached.
  assert.equal(pointInTriangle(P(5, 0), P(0, 0), P(1, 1), P(2, 2)), false, 'off the line');
  assert.equal(pointInTriangle(P(5, 5), P(0, 0), P(1, 1), P(2, 2)), true, 'on the line, past the end');
});

/** A hexagon with an extra vertex sitting exactly on the midpoint of one edge — the T-junction a
 *  parcel gets when a neighbour subdivides the edge they share. Its extra corner is COLLINEAR. */
const T_JUNCTION = [P(0, 0), P(0, 60), P(30, 90), P(60, 60), P(60, 30), P(60, 0), P(30, 0)];

test('a COLLINEAR corner is never taken as an ear — no zero-area piece reaches the buffer', () => {
  // ⚠ `>= 0` vs `> 0` on the ear test differ on exactly a collinear corner: with `> 0` such a
  // corner is accepted and emitted as a zero-area triangle. The area still conserves and the
  // count is still n-2, so only a STRICT check on each piece's area catches it.
  assert.equal(signedTriangleArea2(P(60, 60), P(60, 30), P(60, 0)), 0, 'the fixture has no collinear corner');
  const tris = triangulateRing(T_JUNCTION);
  assert.equal(tris.length, T_JUNCTION.length - 2);
  for (const [a, b, c] of tris) {
    assert.ok(signedTriangleArea2(a, b, c) < 0, 'a zero-area or inverted piece was emitted');
  }
  const sum = tris.reduce((s, [a, b, c]) => s + signedTriangleArea2(a, b, c), 0);
  assert.ok(Math.abs(Math.abs(sum) - Math.abs(signedRingArea2(T_JUNCTION))) < 1e-6);
});

test('a fully collinear ring TERMINATES — the loop is total without an iteration guard', () => {
  // ⚠ This is the assertion that replaced a dead `n*n+4` pass counter. No corner is ever an ear,
  // so the ear loop finds nothing on its first pass and must fall out of `if (!clipped) break`
  // rather than spin. If this test ever hangs, that break is what broke.
  const collinear = Array.from({ length: 12 }, (_, i) => P(i, 0));
  const tris = triangulateRing(collinear);
  assert.equal(tris.length, collinear.length - 2);
  for (const [a, b, c] of tris) assert.equal(signedTriangleArea2(a, b, c), 0);
});

test('a parcel with NO material resolves through the resolver like any other', () => {
  // ⚠ `input.cells[i]?.material` — the optional chain. A descriptor list is never sparse here, so
  // dropping the `?.` changes nothing observable; what IS observable is that an absent material
  // reaches the resolver as `undefined` rather than being skipped or defaulted behind its back.
  const seen: (string | undefined)[] = [];
  cellGroundGeometry({
    cells: [cellOf(SQUARE_CCW), cellOf(SQUARE_CCW, 'healthy')],
    resolve: (m) => {
      seen.push(m);
      return WHITE;
    },
  });
  assert.deepEqual(seen, [undefined, 'healthy']);
});

test('the normal is NORMALISED, and a degenerate face gets a zero normal rather than NaN', () => {
  // ⚠ `Math.hypot(...) > 0` guards the divide. Without it a zero-area face divides by zero and
  // writes NaN into the buffer, which three propagates into the lighting as a black hole rather
  // than as an error. A fully collinear ring is the case that produces one.
  const collinear = [
    [0, 0],
    [10, 0],
    [20, 0],
    [30, 0],
  ] as const;
  const geo = cellGroundGeometry({ cells: [cellOf(collinear)], resolve: resolveWhite });
  for (let i = 0; i < geo.normals.length; i += 1) {
    assert.ok(Number.isFinite(geo.normals[i]!), `normal component ${i} is not finite`);
  }
  // And on a real parcel every normal is unit length — the divide actually happened.
  const real = cellGroundGeometry({ cells: [cellOf(L_SHAPE)], resolve: resolveWhite });
  for (let i = 0; i < real.triangles; i += 1) {
    const o = i * 9;
    const len = Math.hypot(real.normals[o]!, real.normals[o + 1]!, real.normals[o + 2]!);
    assert.ok(Math.abs(len - 1) < 1e-5, `face ${i} normal has length ${len}`);
  }
});

test('a custom depth reaches the walls, and the top stays on the ground plane', () => {
  const geo = cellGroundGeometry({ cells: [cellOf(SQUARE_CCW)], resolve: resolveWhite, depth: 7 });
  const ys = new Set<number>();
  for (let i = 0; i < geo.positions.length; i += 3) ys.add(geo.positions[i + 1]!);
  assert.deepEqual([...ys].sort((a, b) => a - b), [-7, 0]);
});

test('a MALFORMED ring still yields exactly n-2 pieces — the buffer is sized before it is filled', () => {
  // ⚠ THIS IS A BUFFER-SIZING INVARIANT, not a claim that the answer is meaningful. `positions`
  // is allocated up front from `cellGroundTriangles(n)`, so a ring that produced FEWER pieces
  // would leave zeroed floats at the tail — degenerate triangles collapsed at the world origin,
  // drawn, and attributable to nothing. A relaxed parcel should never be malformed, which is
  // exactly why nothing else here would notice if it were.
  //
  // The exact pieces are pinned because the fallback fan is otherwise unreachable: on a
  // well-formed ring the ear loop consumes everything and the fan emits nothing at all. These
  // three rings are the only inputs in this file that exercise it.
  const cases = [
    { label: 'bowtie (self-intersecting)', ring: [P(0, 0), P(10, 10), P(10, 0), P(0, 10)], areas: [-100, 100] },
    {
      label: 'a spike doubling back along an edge',
      ring: [P(0, 0), P(10, 0), P(5, 0), P(10, 10), P(0, 10)],
      areas: [-100, -50, 0],
    },
    { label: 'a repeated vertex', ring: [P(0, 0), P(0, 10), P(0, 10), P(10, 10), P(10, 0)], areas: [-100, 0, -100] },
  ];
  for (const { label, ring, areas } of cases) {
    const tris = triangulateRing(ring);
    assert.equal(tris.length, ring.length - 2, `${label}: wrong piece count — the buffer would not fill`);
    // And the geometry is DETERMINISTIC, pinned piece by piece: the fan's choice of vertices is
    // what a mutation of it changes, and a count alone cannot see that.
    assert.deepEqual(
      tris.map(([a, b, c]) => signedTriangleArea2(a, b, c)),
      areas,
      `${label}: the pieces changed`,
    );
  }
  // The buffer really is exactly filled — no zeroed tail.
  const geo = cellGroundGeometry({
    cells: [cellOf([[0, 0], [10, 10], [10, 0], [0, 10]])],
    resolve: resolveWhite,
  });
  assert.equal(geo.triangles, cellGroundTriangles(4));
  assert.equal(geo.positions.length, geo.triangles * 9);
});

test('a descriptor with NO ring at all is dropped, and does not become an empty parcel', () => {
  // ⚠ `c.points !== undefined && c.points.length >= 3` — two conditions, and forcing either one
  // true admits a descriptor with no ring, which then indexes `undefined` inside the
  // triangulation. Both arms are probed here because a single fixture only ever exercises one.
  const noPoints: InstanceDescriptor = {
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    material: 'healthy',
  };
  const geo = cellGroundGeometry({ cells: [noPoints, cellOf(SQUARE_CCW)], resolve: resolveWhite });
  assert.equal(geo.cells, 1, 'a ringless descriptor was counted as a parcel');
  assert.equal(geo.triangles, cellGroundTriangles(4));
});

/* ── THE RELIEF FIELD ON THE SHIPPED GROUND ────────────────────────────────────────────────
   `adopt-the-land-into-the-shipped-map-arc` / `put-the-treatment-on-the-shipped-map`. The owner
   authorised adoption on 2026-08-29 ("This looks better, stamp it") and the first component
   across is the land's own relief. Every claim below is read off the BUFFER, because each
   failure mode here is invisible in the source: a parcel that vanishes from above, a seam that
   tears open between two parcels, or a surface lit for a shape it does not have.
   ────────────────────────────────────────────────────────────────────────────────────────── */

/** A relief field with a big, fast slope — deliberately far more aggressive than the shipped
 *  one, because a fixture at the real amplitude would be asserting against displacements small
 *  enough to survive most of the mutations these tests exist to catch. */
const RAMP: GroundRelief = {
  height: (x, z) => x * 0.5 + z * 0.25,
  normal: () => {
    const len = Math.hypot(-0.5, 1, -0.25);
    return { x: -0.5 / len, y: 1 / len, z: -0.25 / len };
  },
};

/** Every vertex's y, in buffer order. */
function vertexHeights(positions: Float32Array): number[] {
  const out: number[] = [];
  for (let i = 1; i < positions.length; i += 3) out.push(positions[i]!);
  return out;
}

test('FLAT_GROUND is the flat ground verbatim — the old behaviour is the new one as a special case', () => {
  // The control that makes every comparison below a controlled one, and the reason the owner's
  // before/after picture is honest: if supplying the identity field changed a single byte, "the
  // same function with and without relief" would be measuring two different builders.
  const cells = [cellOf(SQUARE_CCW), cellOf(L_SHAPE)];
  const bare = cellGroundGeometry({ cells, resolve: resolveWhite });
  const flat = cellGroundGeometry({ cells, resolve: resolveWhite, relief: FLAT_GROUND });
  assert.deepEqual([...flat.positions], [...bare.positions]);
  assert.deepEqual([...flat.normals], [...bare.normals]);
  assert.deepEqual([...flat.colors], [...bare.colors]);
  assert.equal(flat.triangles, bare.triangles);
});

test('the top face STANDS ON the field — every vertex at exactly the height there', () => {
  const geo = cellGroundGeometry({ cells: [cellOf(SQUARE_CCW)], resolve: resolveWhite, relief: RAMP });
  // Read the top face off the buffer rather than trusting an offset: a top vertex is one sitting
  // at its own field height, and the walls carry a second copy exactly `depth` lower.
  let onTheField = 0;
  for (let v = 0; v < geo.positions.length / 3; v += 1) {
    const x = geo.positions[v * 3]!;
    const y = geo.positions[v * 3 + 1]!;
    const z = geo.positions[v * 3 + 2]!;
    const h = RAMP.height(x, z);
    assert.ok(
      Math.abs(y - h) < 1e-4 || Math.abs(y - (h - CELL_GROUND_DEPTH)) < 1e-4,
      `vertex at (${x}, ${z}) stands at y=${y}, neither on the field (${h}) nor depth below it`,
    );
    if (Math.abs(y - h) < 1e-4) onTheField += 1;
  }
  // NON-VACUITY: the loop above is satisfied by an empty buffer, and by one that is entirely
  // underside. A square parcel emits 2 top triangles (6 vertices, all on the field) and 4 wall
  // quads; each quad is written as `(topNext, top, botNext)` and `(botNext, top, bot)`, so 3 of
  // its 6 vertices are upper corners standing on the field too.
  assert.equal(onTheField, 6 + 4 * 3, 'top-face vertices, plus every wall quad upper corners');
});

test('the ground really moved — a relief field displaces the buffer it is given', () => {
  // The control for the test above, which a builder ignoring `relief` entirely would also pass
  // on any field that happened to be zero at every vertex it was asked about.
  const cells = [cellOf(SQUARE_CCW)];
  const flat = cellGroundGeometry({ cells, resolve: resolveWhite });
  const relieved = cellGroundGeometry({ cells, resolve: resolveWhite, relief: RAMP });
  assert.notDeepEqual([...relieved.positions], [...flat.positions]);
  assert.notDeepEqual([...relieved.normals], [...flat.normals]);
  assert.ok(
    Math.max(...vertexHeights(relieved.positions)) > Math.max(...vertexHeights(flat.positions)),
  );
});

test('the top face wears the field ANALYTIC normal, never the facet one', () => {
  // ⚠ THE WHOLE LOOK RESTS ON THIS. A face normal would quantise each triangle whole and the land
  // would read as a mosaic of hard facets — the per-cell noise the owner removed in 2026-08-16,
  // arriving by another route. A planar ramp cannot test it, because there the analytic normal
  // and the facet normal agree; this fixture is a CURVED field, where they cannot.
  const bumpy: GroundRelief = {
    height: (x, z) => Math.sin(x * 0.3) * 3 + Math.cos(z * 0.21) * 2,
    normal: (x, z) => {
      const dx = Math.cos(x * 0.3) * 0.9;
      const dz = -Math.sin(z * 0.21) * 0.42;
      const len = Math.hypot(dx, 1, dz);
      return { x: -dx / len, y: 1 / len, z: -dz / len };
    },
  };
  const ring = [
    [0, 0],
    [0, 12],
    [12, 12],
    [12, 0],
  ] as const;
  const geo = cellGroundGeometry({ cells: [cellOf(ring)], resolve: resolveWhite, relief: bumpy });
  // ⚠ A TOP FACE IS A TRIANGLE ALL THREE OF WHOSE VERTICES STAND ON THE FIELD, never a vertex
  // that happens to. A wall quad's UPPER corners stand on the field too and correctly wear the
  // wall's own horizontal normal — filtering by vertex height alone sweeps those in and fails a
  // module that is behaving exactly as designed.
  const onField = (v: number): boolean =>
    Math.abs(geo.positions[v * 3 + 1]! - bumpy.height(geo.positions[v * 3]!, geo.positions[v * 3 + 2]!)) < 1e-4;
  let tilted = 0;
  let topFaces = 0;
  for (let t = 0; t < geo.triangles; t += 1) {
    const vs = [t * 3, t * 3 + 1, t * 3 + 2];
    if (!vs.every(onField)) continue;
    topFaces += 1;
    for (const v of vs) {
      const x = geo.positions[v * 3]!;
      const z = geo.positions[v * 3 + 2]!;
      const n = bumpy.normal(x, z);
      assert.ok(Math.abs(geo.normals[v * 3]! - n.x) < 1e-5, `normal.x at (${x}, ${z})`);
      assert.ok(Math.abs(geo.normals[v * 3 + 1]! - n.y) < 1e-5, `normal.y at (${x}, ${z})`);
      assert.ok(Math.abs(geo.normals[v * 3 + 2]! - n.z) < 1e-5, `normal.z at (${x}, ${z})`);
      if (Math.abs(n.x) > 1e-3 || Math.abs(n.z) > 1e-3) tilted += 1;
    }
  }
  // NON-VACUITY, both halves. On a flat field every normal is (0,1,0) and the assertions above
  // are met by a builder that never read the field at all; and a filter that matched no triangle
  // would assert nothing whatsoever.
  assert.equal(topFaces, 2, 'a quad parcel has exactly two top-face triangles');
  assert.ok(tilted >= 5, `only ${tilted} top vertices carry a tilted normal — the field is not being read`);
});

test('NO TOP FACE CAN EVER FACE DOWN — what stands in for the derived normal', () => {
  // Everything else in this module takes a face's normal from the winding of the very vertices
  // being written, which makes a positions/normals disagreement unrepresentable. The top face
  // gives that up in order to carry an analytic normal, and this is the guarantee that replaces
  // it: `landNormal` is `y = 1/hypot(dx, 1, dz)`, positive for every finite gradient, so no
  // parcel can be lit as though seen from underneath however violent the land gets.
  const violent: GroundRelief = {
    height: (x, z) => x * 40 - z * 33,
    normal: (x, z) => landNormal(x, z, 500),
  };
  const geo = cellGroundGeometry({
    cells: [cellOf(SQUARE_CCW), cellOf(L_SHAPE)],
    resolve: resolveWhite,
    relief: violent,
  });
  for (let v = 0; v < geo.normals.length / 3; v += 1) {
    const ny = geo.normals[v * 3 + 1]!;
    // A wall's normal is horizontal (ny = 0); a top face's must never point below the horizon.
    assert.ok(ny >= 0, `vertex ${v} faces downward (ny = ${ny})`);
  }
  assert.ok(geo.triangles > 0);
});

test('the underside FOLLOWS the relief — the slab keeps its thickness everywhere', () => {
  // ⚠ NOT COSMETIC. The shipped field reaches ±4.22 units and the prism is 3 deep — both on the
  // tuned island; the shipped one scales both by LAND_SCALE, so the ratio holds — so a bottom
  // pinned at `-depth` would sit ABOVE the top face wherever the land dips: every wall there
  // inside out and the parcel gone from above — the exact defect this substrate was added to
  // fix, reintroduced by the treatment meant to improve it.
  const dip: GroundRelief = { height: () => -9, normal: () => ({ x: 0, y: 1, z: 0 }) };
  const geo = cellGroundGeometry({ cells: [cellOf(SQUARE_CCW)], resolve: resolveWhite, relief: dip });
  const ys = [...new Set(vertexHeights(geo.positions).map((y) => Math.round(y * 1e4) / 1e4))];
  // The expectation is rounded exactly as the buffer's heights are: the depth is `3 * LAND_SCALE`
  // (`land-per-capability.ts`), so `-9 - depth` is no longer a four-decimal number.
  assert.deepEqual(ys.sort((a, b) => a - b), [Math.round((-9 - CELL_GROUND_DEPTH) * 1e4) / 1e4, -9]);
});

test('a shared boundary vertex gets ONE height — the seam cannot tear open', () => {
  // The property that makes a CONTINUOUS field watertight for free, and the reason the field may
  // not be per-parcel: the relaxed substrate interns its vertices, so 185 of the shipped island's
  // 191 distinct ring vertices belong to more than one parcel. Two parcels sharing a coordinate
  // must stand at the same height there, or the ground splits open along the seam.
  const left = cellOf([
    [0, 0],
    [0, 10],
    [10, 10],
    [10, 0],
  ]);
  const right = cellOf([
    [10, 0],
    [10, 10],
    [20, 10],
    [20, 0],
  ]);
  const geo = cellGroundGeometry({ cells: [left, right], resolve: resolveWhite, relief: RAMP });
  const seam = new Map<string, Set<number>>();
  for (let v = 0; v < geo.positions.length / 3; v += 1) {
    const x = geo.positions[v * 3]!;
    const y = geo.positions[v * 3 + 1]!;
    const z = geo.positions[v * 3 + 2]!;
    if (Math.abs(x - 10) > 1e-4) continue;
    const at = seam.get(`${z}`) ?? new Set<number>();
    at.add(Math.round(y * 1e3));
    seam.set(`${z}`, at);
  }
  assert.ok(seam.size >= 2, 'the two parcels must actually share boundary vertices');
  for (const [z, ys] of seam) {
    assert.equal(ys.size, 2, `the seam at z=${z} carries ${ys.size} heights, not one top and one bottom`);
  }
});

test('the shipped relief pairs a height with the normal OF THAT height', () => {
  // ⚠ A SURFACE LIT FOR A SHAPE IT DOES NOT HAVE is the one failure here that looks like art
  // rather than like a bug. `landHeight` and `landNormal` each take an amplitude and each
  // default it, so a caller passing one and not the other gets normals belonging to a different
  // land; `landRelief` binds it once for both. Checked as a GRADIENT rather than by
  // transcription: the normal has to be perpendicular to the surface the height function
  // actually describes, which is a claim about the pair rather than about either half.
  for (const [x, z] of [
    [0, 0],
    [37, -12],
    [-88, 41],
    [201, 19],
  ] as const) {
    const h = 1e-3;
    const dx = (landRelief.height(x + h, z) - landRelief.height(x - h, z)) / (2 * h);
    const dz = (landRelief.height(x, z + h) - landRelief.height(x, z - h)) / (2 * h);
    const n = landRelief.normal(x, z);
    // The surface tangents are (1, dx, 0) and (0, dz, 1); a true normal is orthogonal to both.
    assert.ok(Math.abs(n.x + n.y * dx) < 1e-6, `normal not perpendicular along x at (${x}, ${z})`);
    assert.ok(Math.abs(n.y * dz + n.z) < 1e-6, `normal not perpendicular along z at (${x}, ${z})`);
    assert.ok(Math.abs(Math.hypot(n.x, n.y, n.z) - 1) < 1e-9, 'the normal must be a unit vector');
  }
});

test('relief costs no triangles — the ground stands up for free', () => {
  // The arc's end-state item 2 asks what the treatment COSTS. This component's answer is
  // structural rather than measured: it moves vertices the buffer already emits, so the triangle
  // count, the draw call and the attribute channels are all untouched.
  const cells = [cellOf(SQUARE_CCW), cellOf(L_SHAPE), cellOf(SQUARE_CW)];
  const flat = cellGroundGeometry({ cells, resolve: resolveWhite });
  const relieved = cellGroundGeometry({ cells, resolve: resolveWhite, relief: landRelief });
  assert.equal(relieved.triangles, flat.triangles);
  assert.equal(relieved.cells, flat.cells);
  assert.equal(relieved.positions.length, flat.positions.length);
  assert.equal(relieved.normals.length, flat.normals.length);
  assert.equal(relieved.colors.length, flat.colors.length);
});

test('relief moves no COLOUR — the map still reports exactly what it did', () => {
  // ⚠ ADR-0392 D5 / ADR-0398 D7: a prettier map that misreports is a REGRESSION, and it is the
  // one way this arc can do real harm. The relief field is a function of POSITION ONLY, so a
  // parcel's status colour must come out byte-identical with and without it. This is the
  // assertion that says the art change asserted nothing.
  const cells = [
    cellOf(SQUARE_CCW, 'healthy'),
    cellOf(L_SHAPE, 'unhealthy'),
    cellOf(SQUARE_CW, 'unknown'),
  ];
  const resolve = (m: string | undefined): LinearRgb => {
    if (m === 'healthy') return { r: 0.1, g: 0.9, b: 0.2 };
    if (m === 'unhealthy') return { r: 0.4, g: 0.1, b: 0.1 };
    return { r: 0.5, g: 0.5, b: 0.6 };
  };
  const flat = cellGroundGeometry({ cells, resolve });
  const relieved = cellGroundGeometry({ cells, resolve, relief: landRelief });
  assert.deepEqual([...relieved.colors], [...flat.colors]);
});

test('NO `index` resolver means an EMPTY statuses buffer — not a zero-filled one', () => {
  // ⚠ The distinction is the whole point. A zero-filled buffer says "every parcel is row 0",
  // and row 0 is a REAL status, so a banded material handed it would paint the entire island
  // one state and look exactly like working code. Empty is unusable and therefore honest.
  const built = cellGroundGeometry({ cells: [cellOf(SQUARE_CCW, 'healthy')], resolve: resolveWhite });
  assert.equal(built.statuses.length, 0);
  assert.ok(built.colors.length > 0, 'the colour attribute is unaffected by the new one');
});

test('the status row is ONE float per vertex, and every vertex of a parcel carries its own', () => {
  const cells = [
    cellOf(SQUARE_CCW, 'healthy'),
    cellOf(L_SHAPE, 'unhealthy'),
    cellOf(SQUARE_CW, 'unknown'),
  ];
  const rows = new Map([
    ['healthy', 0],
    ['unhealthy', 4],
    ['unknown', 5],
  ]);
  const index = (m: string | undefined): number => rows.get(m ?? 'unknown') ?? 5;
  const built = cellGroundGeometry({ cells, resolve: resolveWhite, index });

  // ONE per vertex, not three: it is a row number, and sizing it like a colour would leave two
  // thirds of it as zeros — which is row 0, a real status, on two thirds of every parcel.
  assert.equal(built.statuses.length, built.triangles * 3);
  assert.equal(built.colors.length, built.triangles * 9);

  // Each parcel's own vertices, contiguous and complete. The counts come from the module's own
  // published formula rather than from a hand-count, so a change to the wall topology moves both.
  let at = 0;
  for (const [ring, material] of [
    [SQUARE_CCW, 'healthy'],
    [L_SHAPE, 'unhealthy'],
    [SQUARE_CW, 'unknown'],
  ] as const) {
    const vertices = cellGroundTriangles(ring.length) * 3;
    for (let v = at; v < at + vertices; v += 1) {
      assert.equal(built.statuses[v], rows.get(material), `vertex ${v} of the ${material} parcel`);
    }
    at += vertices;
  }
  assert.equal(at, built.statuses.length, 'every vertex belongs to some parcel');
});

test('the row and the COLOUR agree parcel for parcel — two attributes, one status', () => {
  // The failure this catches is an off-by-one between the two writers: the colour written per
  // TRIANGLE-vertex and the row written over a [start, end) span. If those spans ever disagreed,
  // one parcel would wear another parcel's status colour under a banded material while looking
  // correct under a smooth one — visible only on the surface that ships.
  const cells = [cellOf(SQUARE_CCW, 'a'), cellOf(L_SHAPE, 'b'), cellOf(ngon(7, 5).map((p) => [p.x, p.z] as const), 'c')];
  const tint = new Map<string, LinearRgb>([
    ['a', { r: 1, g: 0, b: 0 }],
    ['b', { r: 0, g: 1, b: 0 }],
    ['c', { r: 0, g: 0, b: 1 }],
  ]);
  const order = ['a', 'b', 'c'];
  const built = cellGroundGeometry({
    cells,
    resolve: (m) => tint.get(m ?? 'a')!,
    index: (m) => order.indexOf(m ?? 'a'),
    relief: landRelief,
  });
  for (let v = 0; v < built.statuses.length; v += 1) {
    const row = built.statuses[v]!;
    const want = tint.get(order[row]!)!;
    assert.deepEqual(
      [built.colors[v * 3], built.colors[v * 3 + 1], built.colors[v * 3 + 2]],
      [want.r, want.g, want.b],
      `vertex ${v} carries row ${row} but not row ${row}'s colour`,
    );
  }
});

test('relief moves no ROW either — the field is position-only, so it cannot restate a status', () => {
  const cells = [cellOf(SQUARE_CCW, 'healthy'), cellOf(L_SHAPE, 'unknown')];
  const index = (m: string | undefined): number => (m === 'healthy' ? 0 : 5);
  const flat = cellGroundGeometry({ cells, resolve: resolveWhite, index });
  const relieved = cellGroundGeometry({ cells, resolve: resolveWhite, index, relief: landRelief });
  assert.deepEqual([...relieved.statuses], [...flat.statuses]);
  assert.ok(flat.statuses.length > 0, 'NON-VACUITY: there are rows for the relief to have moved');
});


// ---------------------------------------------------------------------------------------------
// THE ATLAS ORIGIN — the per-vertex half of a PACKED occlusion field.
//
// ⚠ IT IS A CONSTANT PER ISLAND, WHICH IS THE ONLY REASON IT MAY RIDE ON THE MESH. `land-shadow.ts`
// rejected a per-vertex SHADOW because a shadow carries features finer than a parcel; an origin is
// identical at every vertex of every triangle on its island, so the interpolator returns it
// exactly. These tests hold that literally — not "close", the same float.

/** A `cell-ground` on a named island. */
function islandCell(
  island: string,
  ring: readonly (readonly [number, number])[],
): InstanceDescriptor {
  return { ...cellOf(ring), island };
}

const SQUARE_A: readonly (readonly [number, number])[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];
const SQUARE_B: readonly (readonly [number, number])[] = [
  [100, 0],
  [110, 0],
  [110, 10],
  [100, 10],
];

test('NO atlas resolver means an EMPTY origin buffer, never a zero-filled one', () => {
  const geo = cellGroundGeometry({ cells: [islandCell('a', SQUARE_A)], resolve: resolveWhite });
  assert.equal(geo.atlasOrigins.length, 0);
  // The argument for empty rather than zero-filled, stated as the thing it prevents: (0, 0) is a
  // real corner of a real atlas, so a zero-filled buffer would draw every island through one tile.
  assert.ok(geo.triangles > 0, 'and the buffer really was built, so this is not a vacuous zero');
});

test('an atlas resolver fills TWO floats per vertex, and the buffer sizes agree', () => {
  const geo = cellGroundGeometry({
    cells: [islandCell('a', SQUARE_A)],
    resolve: resolveWhite,
    atlasOrigin: () => ({ u: 0.25, v: 0.5 }),
  });
  assert.equal(geo.atlasOrigins.length, geo.triangles * 6);
  assert.equal(geo.positions.length, geo.triangles * 9);
  for (let v = 0; v < geo.triangles * 3; v += 1) {
    assert.equal(geo.atlasOrigins[v * 2], 0.25, `vertex ${v} lost its u`);
    assert.equal(geo.atlasOrigins[v * 2 + 1], 0.5, `vertex ${v} lost its v`);
  }
});

test('⚠⚠ EVERY VERTEX OF AN ISLAND CARRIES ITS OWN ISLAND’S ORIGIN — tops and walls alike', () => {
  // ⚠ EXACT BINARY FRACTIONS, so the assertions below may be `equal` rather than `close to`.
  // The buffer is a Float32Array; 0.1 comes back as 0.10000000149011612 and an approximate
  // comparison is a weaker claim than this test can afford — the failure it has to catch is a
  // vertex carrying the WRONG island's origin, which differs by far more than a rounding.
  const originA: AtlasOrigin = { u: 0.125, v: 0.25 };
  const originB: AtlasOrigin = { u: 0.75, v: 0.5 };
  // A FUNCTION rather than a dictionary, and the reason is the resolver's own contract: it takes
  // `string | undefined`, so a lookup table would have to be widened to an open dictionary — which
  // discards the two keys this test knows about, and is what `no-known-value-widening` refuses.
  const originFor = (island: string | undefined): AtlasOrigin =>
    island === 'a' ? originA : island === 'b' ? originB : { u: -1, v: -1 };
  const origins = { a: originA, b: originB };
  const geo = cellGroundGeometry({
    cells: [islandCell('a', SQUARE_A), islandCell('b', SQUARE_B)],
    resolve: resolveWhite,
    relief: landRelief,
    atlasOrigin: originFor,
  });
  // Read the origin back through the POSITION rather than through the write order: a vertex at
  // x >= 100 is on island b, whatever order the builder happened to emit the parcels in. That is
  // what makes this a claim about the delivered buffer instead of about the loop that filled it.
  let onA = 0;
  let onB = 0;
  for (let v = 0; v < geo.triangles * 3; v += 1) {
    const x = geo.positions[v * 3]!;
    const want = x >= 100 ? origins['b']! : origins['a']!;
    assert.equal(geo.atlasOrigins[v * 2], want.u, `vertex ${v} at x=${x} has the wrong u`);
    assert.equal(geo.atlasOrigins[v * 2 + 1], want.v, `vertex ${v} at x=${x} has the wrong v`);
    if (x >= 100) onB += 1;
    else onA += 1;
  }
  assert.ok(onA > 0 && onB > 0, 'both islands must have contributed vertices');
});

test('r3f-ground-vertices-carry-explicit-island-slots: every merged vertex retains its island slot', () => {
  // Atlas UVs say WHERE an island's texture starts, but they cannot be the ground's identity:
  // packing may move an island without changing which vertices belong to it. The merged buffer
  // therefore needs a discrete, one-float slot beside every vertex, including the prism walls.
  const input = {
    cells: [islandCell('a', SQUARE_A), islandCell('b', SQUARE_B)],
    resolve: resolveWhite,
  };
  Reflect.set(input, 'islandSlot', (island: string | undefined) => (island === 'a' ? 3 : 17));
  const geo = cellGroundGeometry(input);
  const slots = Reflect.get(geo, 'islandSlots');

  assert.ok(slots instanceof Float32Array, 'the merged geometry exposes one explicit island slot per vertex');
  assert.equal(slots.length, geo.triangles * 3, 'one island slot per merged vertex');
  for (let v = 0; v < geo.triangles * 3; v += 1) {
    const x = geo.positions[v * 3]!;
    assert.equal(slots[v], x >= 100 ? 17 : 3, `vertex ${v} at x=${x} lost its island identity`);
  }
});

test('a cell with NO island reaches the resolver as undefined, not as some other island', () => {
  const seen: (string | undefined)[] = [];
  cellGroundGeometry({
    cells: [cellOf(SQUARE_A), islandCell('b', SQUARE_B)],
    resolve: resolveWhite,
    atlasOrigin: (island) => {
      seen.push(island);
      return { u: 0, v: 0 };
    },
  });
  assert.deepEqual(seen, [undefined, 'b']);
});

test('the ZERO origin is a value that reaches nothing — it is not a claim about (0, 0)', () => {
  assert.deepEqual(ZERO_ORIGIN, { u: 0, v: 0 });
  const geo = cellGroundGeometry({ cells: [islandCell('a', SQUARE_A)], resolve: resolveWhite });
  assert.equal(geo.atlasOrigins.length, 0, 'so the default never lands in a buffer anyone reads');
});
