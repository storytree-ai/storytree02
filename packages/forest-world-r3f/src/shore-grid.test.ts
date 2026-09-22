import assert from 'node:assert/strict';
import test from 'node:test';

import type { CoastPoint } from './coast-clip.js';
import {
  buildEdgeGrid,
  COARSEN_FACTOR,
  COARSEN_STEPS,
  MAX_GRID_BUCKETS,
  buildSegmentGrid,
  cellIndex,
  edgeBounds,
  edgeGridFarField,
  nearestOnSegments,
  ringEdges,
  spanOf,
  type CoastEdge,
  type EdgeGrid,
  type NearestSample,
} from './shore-grid.js';
import { shoreField } from './shore-fall.js';

/** A brute-force distance to the nearest point of any ring, capped — the definition the grid is an
 *  optimisation OF. Deliberately the slowest possible spelling: no pruning, no index, nothing that
 *  could share a bug with the thing under test. */
function bruteDistance(rings: readonly (readonly CoastPoint[])[], x: number, z: number, width: number): number {
  let best = width;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const lenSq = ex * ex + ez * ez;
      const raw = lenSq === 0 ? 0 : ((x - a.x) * ex + (z - a.z) * ez) / lenSq;
      const t = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      const d = Math.hypot(x - (a.x + ex * t), z - (a.z + ez * t));
      if (d < best) best = d;
    }
  }
  return best;
}

const SQUARE: CoastPoint[] = [
  { x: 0, z: 0 },
  { x: 40, z: 0 },
  { x: 40, z: 40 },
  { x: 0, z: 40 },
];

test('the far-field argument holds only while the cell is at least the query width', () => {
  // The short-circuit's whole soundness. A cell SMALLER than the width would leave a point's 3x3
  // block narrower than the cap, so an edge just outside the block could still be nearer than
  // `width` — and the empty-neighbourhood answer would be a wrong distance rather than the cap.
  assert.equal(edgeGridFarField(10, 10), true);
  assert.equal(edgeGridFarField(11, 10), true);
  assert.equal(edgeGridFarField(9.99, 10), false);
  // And the builder honours it: the grid it returns uses the width as its cell.
  assert.equal(buildEdgeGrid([SQUARE], 7).cell, 7);
});

test('the cell index FLOORS — a ceiling would shift every edge one cell over', () => {
  assert.equal(cellIndex(0, 0, 10), 0);
  assert.equal(cellIndex(9.99, 0, 10), 0);
  assert.equal(cellIndex(10, 0, 10), 1);
  // ⚠ NEGATIVE ORDINATES TOO. Ground coordinates straddle the origin, and `Math.trunc` — the
  // plausible substitute — collapses [-10, 0) and [0, 10) onto the same cell, silently merging the
  // two sides of the axis and hiding half a coast from the other half.
  assert.equal(cellIndex(-0.01, 0, 10), -1);
  assert.equal(cellIndex(-10, 0, 10), -1);
});

test('cellIndex divides the offset from the origin by the cell, with a non-zero origin', () => {
  // min 3, cell 4, v 11: (11 - 3) / 4 = 2. The two arithmetic slips a reader could make are both
  // visible here and BOTH invisible at an origin of zero, which is all the floor test above uses:
  // multiplying by the cell instead of dividing gives 32, and adding the origin instead of
  // subtracting it gives floor(14 / 4) = 3.
  assert.equal(cellIndex(11, 3, 4), 2);
  assert.equal(cellIndex(3, 3, 4), 0);
  assert.equal(cellIndex(2.99, 3, 4), -1);
  assert.equal(cellIndex(19, 3, 4), 4);
  // ⚠ `check:mutation-diff` can still report the `* cell` mutant of this line as UNPROVEN, and
  // that is a TIMEOUT, not a missing witness. Every shore-grid mutant is STATIC — module-scope
  // fixtures in `wear-atlas.test.ts` and `shore-atlas.test.ts` build a grid at import — so each
  // mutant runs the WHOLE suite, and under `* cell` the shipped-map harness legs build grids
  // with cell² (~100x) more cells per axis and blow the per-mutant budget before any verdict,
  // this one included, can be named. This test kills the mutant in under a millisecond; it
  // cannot make a hung suite report which test did.
});

test('a degenerate grid answers "nothing near" rather than dividing by zero', () => {
  assert.deepEqual([...buildEdgeGrid([], 5).candidates(0, 0)], []);
  // A zero width would make the cell arithmetic divide by zero and hand every query NaN cells —
  // which reads as "no candidates" and would silently erase the coast.
  const zero = buildEdgeGrid([SQUARE], 0);
  assert.ok(zero.cell > 0, 'a zero width must not become a zero cell');
});

test('⚠ AN EDGE IS BUCKETED INTO EVERY CELL IT CROSSES, not just its endpoints`', () => {
  // ⚠⚠ THE FAILURE THIS PREVENTS IS A MISSED COASTLINE. A 40-unit edge across a 5-unit grid spans
  // eight cells; bucketed only by its endpoints, a point beside its MIDDLE finds an empty
  // neighbourhood and is told it is far inland — sand missing from exactly the water's edge, and
  // no error anywhere.
  const grid = buildEdgeGrid([SQUARE], 5);
  // Beside the middle of the bottom edge, just outside the square.
  const mid = grid.candidates(20, -1);
  assert.ok(mid.length > 0, 'a point beside an edge`s middle found no candidate edge');
  // And it really is that edge: the nearest distance from here is ~1.
  assert.ok(bruteDistance([SQUARE], 20, -1, 5) < 1.5);
});

test('⚠⚠ THE GRID IS EXACT — it agrees with a brute-force walk at every probe', () => {
  // ⚠ THIS IS THE CLAIM THE WHOLE OPTIMISATION RESTS ON, and it is the one a speed-up most easily
  // breaks: a faster field that is quietly wrong produces a plausible beach in the wrong place,
  // and every downstream measurement inherits it. `shoreField` now walks only the grid's
  // candidates, so this compares its answers against the definition over a dense sweep.
  const width = 9.9;
  const rings = [SQUARE];
  const reader = shoreField(
    [
      {
        kind: 'cell-ground',
        group: 'cell-ground',
        island: 'sq',
        transform: { x: 20, y: 0, z: 20 },
        points: SQUARE.map((p) => ({ x: p.x, y: 0, z: p.z })),
      },
    ],
    width,
  );
  let compared = 0;
  let sawBand = 0;
  let sawCap = 0;
  for (let x = -15; x <= 55; x += 0.7) {
    for (let z = -15; z <= 55; z += 0.7) {
      const expected = bruteDistance(rings, x, z, width);
      const got = reader.sample(x, z).distance;
      assert.ok(
        Math.abs(got - expected) < 1e-9,
        `at (${x.toFixed(1)}, ${z.toFixed(1)}) the grid said ${got} and the walk said ${expected}`,
      );
      compared += 1;
      if (expected > 0 && expected < width) sawBand += 1;
      if (expected === width) sawCap += 1;
    }
  }
  // ⚠ AND THE SWEEP MUST HAVE EXERCISED BOTH REGIMES, or it compared two constants. The band is
  // where the walk runs; the cap is where the short-circuit answers without touching an edge.
  assert.ok(compared > 9000, `only ${compared} probes — the sweep is too sparse to mean much`);
  assert.ok(sawBand > 500, `only ${sawBand} probes landed in the band the walk actually resolves`);
  assert.ok(sawCap > 500, `only ${sawCap} probes hit the capped far field the short-circuit serves`);
});

test('⚠ the grid is exact on a MANY-EDGED ring too, not just on a square', () => {
  // The square has four long edges; a real coast after the clip has hundreds of short ones, which
  // is the case the bucketing actually has to survive — an edge shorter than a cell, many of them
  // per bucket, and a boundary that curves through every cell it touches.
  //
  // ⚠ THE FIXTURE IS BUILT HERE RATHER THAN IMPORTED FROM `harness/`. `src/` is MIRRORED into the
  // public site by `pnpm sync:web-engine`, which copies nothing from `harness/` — so a src module
  // reaching across that line dangles in the published tree. `harness/scope-fence.test.ts` fences
  // it, and it caught this test's first version importing `shippedParcels`.
  const ring: CoastPoint[] = Array.from({ length: 240 }, (_, i) => {
    const a = (i / 240) * Math.PI * 2;
    // A wobbling radius, so the boundary is not a circle the grid could get right by symmetry.
    const r = 60 + 9 * Math.sin(a * 5) + 4 * Math.cos(a * 11);
    return { x: r * Math.cos(a), z: r * Math.sin(a) };
  });
  const width = 9.9;
  const reader = shoreField(
    [
      {
        kind: 'cell-ground',
        group: 'cell-ground',
        island: 'blob',
        transform: { x: 0, y: 0, z: 0 },
        points: ring.map((p) => ({ x: p.x, y: 0, z: p.z })),
      },
    ],
    width,
  );
  let compared = 0;
  let sawBand = 0;
  for (let x = -85; x <= 85; x += 1.7) {
    for (let z = -85; z <= 85; z += 1.7) {
      const expected = bruteDistance([ring], x, z, width);
      const got = reader.sample(x, z).distance;
      assert.ok(
        Math.abs(got - expected) < 1e-9,
        `many-edged ring: at (${x.toFixed(1)}, ${z.toFixed(1)}) grid ${got} vs walk ${expected}`,
      );
      compared += 1;
      if (expected > 0 && expected < width) sawBand += 1;
    }
  }
  assert.ok(compared > 9000, `only ${compared} probes on the many-edged ring`);
  assert.ok(sawBand > 500, `only ${sawBand} probes landed in the ring's band`);
});

test('⚠⚠ THE CONTRACT: the grid never OMITS an edge that could win', () => {
  // ⚠ THIS IS WHAT THE GRID PROMISES, AND IT IS THE ONLY THING IT PROMISES. Everything else about
  // it is a cost decision: a broken bound, a collapsed axis or a duplicated bucket makes the walk
  // test MORE edges and returns the identical distance, which is why `check:mutation-diff` reports
  // those internals as survivors and why they genuinely are equivalent. What is NOT equivalent is
  // dropping a candidate — that returns a WRONG distance, and it is invisible in any single
  // sample because the answer stays plausible.
  //
  // So this asserts the contract directly rather than through a distance: for every probe, every
  // edge whose true distance is under the cap must be among the candidates.
  const width = 9.9;
  // ⚠ OFF-ORIGIN AND ASYMMETRIC, because a fixture centred on the origin cannot distinguish a
  // min/max swap from a correct bound — both collapse to something symmetric that still works.
  const ring: CoastPoint[] = Array.from({ length: 90 }, (_, i) => {
    const a = (i / 90) * Math.PI * 2;
    return { x: 137 + (48 + 11 * Math.sin(a * 3)) * Math.cos(a), z: -64 + (29 + 6 * Math.cos(a * 4)) * Math.sin(a) };
  });
  const grid = buildEdgeGrid([ring], width);
  let probes = 0;
  let omissionsPossible = 0;
  for (let x = 60; x <= 215; x += 2.3) {
    for (let z = -110; z <= -18; z += 2.3) {
      const got = new Set(grid.candidates(x, z));
      for (let n = 0; n < grid.edges.length; n += 1) {
        const e = grid.edges[n]!;
        const d = bruteDistance([[{ x: e.ax, z: e.az }, { x: e.bx, z: e.bz }]], x, z, Infinity);
        // A degenerate "ring" of two points has one real edge and one zero-length return leg; the
        // brute helper walks both, so the distance above is that single segment's.
        if (d < width) {
          assert.ok(got.has(n), `edge ${n} is ${d.toFixed(2)} away at (${x.toFixed(1)}, ${z.toFixed(1)}) but was not offered`);
          omissionsPossible += 1;
        }
      }
      probes += 1;
    }
  }
  assert.ok(probes > 2000, `only ${probes} probes`);
  // ⚠ AND THE SWEEP MUST ACTUALLY HAVE HAD SOMETHING TO OMIT. With no in-range edge anywhere the
  // assertion above is vacuous and would pass against a grid that offers nothing at all.
  assert.ok(omissionsPossible > 2000, `only ${omissionsPossible} in-range edges were ever checked`);
});

test('an empty edge set and a populated one take different paths, and both answer', () => {
  // The empty-edges branch returns a grid that offers nothing; flipping its condition would send
  // an EMPTY set down the bounds arithmetic (Infinity bounds, NaN cells) and a POPULATED one down
  // the trivial return — which offers no candidates and erases every coast.
  assert.equal(buildEdgeGrid([], 5).edges.length, 0);
  assert.deepEqual([...buildEdgeGrid([], 5).candidates(0, 0)], []);
  const real = buildEdgeGrid([SQUARE], 5);
  assert.equal(real.edges.length, 4);
  assert.ok(real.candidates(20, -1).length > 0, 'a populated grid must still offer its edges');
});

test('edgeBounds returns the true box, and each corner comes from the right extreme', () => {
  // ⚠ ASYMMETRIC AND OFF-ORIGIN ON BOTH AXES, so a min/max swap or an axis mix-up is visible.
  // Inside `buildEdgeGrid` none of that is visible at all: a collapsed axis still returns exact
  // distances (every query finds every edge) and only the build TIME changes.
  const b = edgeBounds([
    { ax: -12, az: 40, bx: 5, bz: 41 },
    { ax: 3, az: -7, bx: 88, bz: 2 },
  ]);
  assert.deepEqual(b, { minX: -12, minZ: -7, maxX: 88, maxZ: 41 });
  // Each endpoint of an edge counts, not just the first.
  assert.deepEqual(edgeBounds([{ ax: 0, az: 0, bx: -3, bz: -4 }]), {
    minX: -3, minZ: -4, maxX: 0, maxZ: 0,
  });
  assert.deepEqual(edgeBounds([{ ax: -3, az: -4, bx: 0, bz: 0 }]), {
    minX: -3, minZ: -4, maxX: 0, maxZ: 0,
  });
});

// ---------------------------------------------------------------------------
// The split: ring flattener + segment indexer + the extracted walk
// ---------------------------------------------------------------------------

test('ringEdges flattens every ring with its CLOSING chord, in order', () => {
  // ⚠ THE CLOSING CHORD IS THE WHOLE DIFFERENCE from an open polyline's edges: a ring's last
  // edge runs from its final vertex back to its first, and dropping it leaves one side of every
  // island without a coast. Asserted as the exact list, so an off-by-one at either end is a
  // different array rather than a plausible one.
  assert.deepEqual(ringEdges([SQUARE]), [
    { ax: 0, az: 0, bx: 40, bz: 0 },
    { ax: 40, az: 0, bx: 40, bz: 40 },
    { ax: 40, az: 40, bx: 0, bz: 40 },
    { ax: 0, az: 40, bx: 0, bz: 0 },
  ]);
  // Two rings concatenate in order; a two-point "ring" yields its edge and the return leg.
  const two: CoastPoint[] = [{ x: 5, z: 6 }, { x: 9, z: 6 }];
  assert.deepEqual(ringEdges([two, SQUARE]).slice(0, 2), [
    { ax: 5, az: 6, bx: 9, bz: 6 },
    { ax: 9, az: 6, bx: 5, bz: 6 },
  ]);
  assert.equal(ringEdges([two, SQUARE]).length, 6);
  assert.deepEqual(ringEdges([]), []);
});

test('buildEdgeGrid IS buildSegmentGrid over ringEdges — same edges, same candidates', () => {
  // The refactor's regression fence: the split must not change what the ring form answers.
  const width = 5;
  const viaRings = buildEdgeGrid([SQUARE], width);
  const viaEdges = buildSegmentGrid(ringEdges([SQUARE]), width);
  assert.deepEqual(viaRings.edges, viaEdges.edges);
  assert.equal(viaRings.cell, viaEdges.cell);
  for (const [x, z] of [[20, -1], [-3, 20], [41, 39], [20, 20], [100, 100]] as const) {
    assert.deepEqual([...viaRings.candidates(x, z)].sort(), [...viaEdges.candidates(x, z)].sort());
  }
});

test('buildSegmentGrid indexes an OPEN edge set with no closing chord of its own', () => {
  // A single edge from (0,0) to (40,0). A RING of the same two points would index TWO edges (the
  // edge and its return leg); the segment form indexes exactly what it was handed.
  const open: CoastEdge[] = [{ ax: 0, az: 0, bx: 40, bz: 0 }];
  const grid = buildSegmentGrid(open, 5);
  assert.equal(grid.edges.length, 1, 'one edge in, one edge indexed — no chord was added');
  assert.ok(grid.candidates(20, -1).length > 0);
  assert.deepEqual([...grid.candidates(20, 30)], [], 'six cells away, nothing is offered');
});

test('⚠⚠ nearestOnSegments agrees with the brute-force walk at every probe, both regimes', () => {
  // The extracted walk, held to the definition directly rather than only through `shoreField`.
  // ⚠ AN OFF-ORIGIN, MANY-EDGED, OPEN edge set, so the gradient's sign and the clamp at BOTH
  // ends of every segment are exercised — and open, so that the brute twin below (which walks
  // the edge list as given) is not quietly comparing two closed shapes.
  const pts: CoastPoint[] = Array.from({ length: 60 }, (_, i) => ({
    x: 30 + i * 1.7,
    z: -20 + 11 * Math.sin(i * 0.37) + 3 * Math.cos(i * 1.3),
  }));
  const edges: CoastEdge[] = [];
  for (let i = 0; i + 1 < pts.length; i += 1) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    edges.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  const cap = 6.5;
  const grid = buildSegmentGrid(edges, cap);
  let compared = 0;
  let sawBand = 0;
  let sawCap = 0;
  for (let x = 15; x <= 145; x += 0.9) {
    for (let z = -45; z <= 5; z += 0.9) {
      const got = nearestOnSegments(grid, x, z, cap);
      const expected = bruteOpen(edges, x, z, cap);
      assert.ok(
        Math.abs(got.distance - expected.distance) < 1e-9,
        `at (${x}, ${z}) the walk said ${got.distance} and the twin said ${expected.distance}`,
      );
      // The gradient is a UNIT vector away from the nearest point, or zero when capped / on it.
      assert.ok(Math.abs(got.gx - expected.gx) < 1e-9 && Math.abs(got.gz - expected.gz) < 1e-9,
        `at (${x}, ${z}) gradient (${got.gx}, ${got.gz}) vs (${expected.gx}, ${expected.gz})`);
      compared += 1;
      if (got.distance > 0 && got.distance < cap) sawBand += 1;
      if (got.distance === cap) sawCap += 1;
    }
  }
  assert.ok(compared > 7000, `only ${compared} probes`);
  assert.ok(sawBand > 1500, `only ${sawBand} probes in the band`);
  assert.ok(sawCap > 1500, `only ${sawCap} probes in the capped far field`);
  // And the on-edge case, where the gradient is undefined and must come back as ZERO rather than
  // NaN: probe a vertex exactly.
  const v = pts[7]!;
  const on = nearestOnSegments(grid, v.x, v.z, cap);
  assert.deepEqual(on, { distance: 0, gx: 0, gz: 0 });
});

test('nearestOnSegments caps at the cap it is HANDED, with a zero gradient there', () => {
  const grid = buildSegmentGrid(ringEdges([SQUARE]), 5);
  // Inside the square, 20 units from every side: capped at the grid's own width.
  assert.deepEqual(nearestOnSegments(grid, 20, 20, 5), { distance: 5, gx: 0, gz: 0 });
  // A point 3 units off the bottom edge with a cap of 5 measures 3, gradient straight out.
  const s = nearestOnSegments(grid, 20, -3, 5);
  assert.equal(s.distance, 3);
  assert.equal(s.gx, 0);
  assert.equal(s.gz, -1);
  // A smaller cap than the grid's cell is still exact — the neighbourhood is only wider than
  // needed — and caps there.
  assert.equal(nearestOnSegments(grid, 20, -3, 2).distance, 2);
});

/** The definition `nearestOnSegments` is an optimisation OF, over an OPEN edge list: every edge
 *  as given, no chord, no index, the slowest honest spelling. Returns the gradient too, computed
 *  from the nearest point rather than from anything the walk exposes. */
function bruteOpen(edges: readonly CoastEdge[], x: number, z: number, cap: number): NearestSample {
  let best = cap;
  let px = 0;
  let pz = 0;
  for (const e of edges) {
    const ex = e.bx - e.ax;
    const ez = e.bz - e.az;
    const lenSq = ex * ex + ez * ez;
    const raw = lenSq === 0 ? 0 : ((x - e.ax) * ex + (z - e.az) * ez) / lenSq;
    const t = Math.max(0, Math.min(1, raw));
    const qx = e.ax + ex * t;
    const qz = e.az + ez * t;
    const d = Math.hypot(x - qx, z - qz);
    if (d < best) {
      best = d;
      px = qx;
      pz = qz;
    }
  }
  if (best === cap || best === 0) return { distance: best, gx: 0, gz: 0 };
  return { distance: best, gx: (x - px) / best, gz: (z - pz) / best };
}

test('spanOf is INCLUSIVE at both ends, and empty when the range inverts', () => {
  // The bucketing writes an edge into every cell of its box, so an off-by-one at EITHER end drops
  // a cell — and a dropped cell is a candidate never offered, which is the one failure mode the
  // grid may not have.
  assert.deepEqual([...spanOf(2, 5)], [2, 3, 4, 5]);
  assert.deepEqual([...spanOf(0, 0)], [0]);
  assert.deepEqual([...spanOf(-2, 1)], [-2, -1, 0, 1]);
  // An inverted range is empty rather than enormous — `Math.max(0, ...)` is what stops a negative
  // length becoming a thrown RangeError deep inside a build.
  assert.deepEqual([...spanOf(3, 1)], []);
});

// ---------------------------------------------------------------- the bucket cap

test('⚠⚠ a grid that would need more than MAX_GRID_BUCKETS COARSENS its cell to fit — the far-field proof holds, the walk still finds the coast, and the cell is never refined', () => {
  // ⚠ JUST OVER THE CAP, NOT ABSURDLY OVER IT: one column over. A non-zero origin, so the extent
  // is a difference and not a sum. Before the land-per-capability ratio this REFUSED; since the
  // bands shrank by LAND_SCALE under a forest whose extent did not, the honest answer is a coarser
  // cell (`edgeGridFarField` holds for any cell >= width), and the refusal is kept for the case
  // coarsening cannot reach — an inverted index.
  const over: CoastEdge[] = [{ ax: 10, az: 20, bx: 522.5, bz: 531.5 }];
  const coarse = buildSegmentGrid(over, 1);
  assert.ok(coarse.cell > 1, `the cell coarsened: ${coarse.cell}`);
  assert.equal(coarse.cell, COARSEN_FACTOR, 'one quarter step is enough for one column over');
  assert.ok(edgeGridFarField(coarse.cell, 1));
  assert.ok(coarse.nx * coarse.nz <= MAX_GRID_BUCKETS, `${coarse.nx} x ${coarse.nz}`);
  // The dimensions are re-derived from the coarsened cell: floor(extent / cell) + 1 on each axis.
  assert.equal(coarse.nx, Math.floor(512.5 / COARSEN_FACTOR) + 1);
  assert.equal(coarse.nz, Math.floor(511.5 / COARSEN_FACTOR) + 1);
  // The coarsened grid still answers: a point beside the chord's middle sees the edge. (A diagonal
  // chord's bounding box is the whole grid, so its edge is bucketed everywhere — the far-field
  // emptiness is held on the short-edge fixtures above, not here.)
  assert.deepEqual([...coarse.candidates(266, 276)], [0]);
  // EXACTLY the cap needs no coarsening — the cap is strict, so 512 x 512 = 262144 builds as is.
  const exact: CoastEdge[] = [{ ax: 10, az: 20, bx: 521.5, bz: 531.5 }];
  assert.equal(buildSegmentGrid(exact, 1).cell, 1);
  // The forest's own case: the sand's cell (2.64 units since LAND_SCALE) over a 2,290 x 3,545
  // extent wants 1.17 M buckets and settles four quarter-steps up, under the cap, cell ≈ 6.44.
  const forest: CoastEdge[] = [{ ax: 0, az: 0, bx: 2289.7, bz: 3545.4 }];
  const settled = buildSegmentGrid(forest, 2.6384359697243656);
  assert.ok(Math.abs(settled.cell - 2.6384359697243656 * COARSEN_FACTOR ** 4) < 1e-9, `${settled.cell}`);
  assert.ok(settled.nx * settled.nz <= MAX_GRID_BUCKETS && settled.nx * settled.nz > MAX_GRID_BUCKETS / COARSEN_FACTOR ** 2, `${settled.nx * settled.nz}`);
  // An island-sized extent at the path's 3-unit cell is a few thousand buckets, two orders under it.
  const island: CoastEdge[] = [{ ax: 0, az: 0, bx: 234, bz: 46 }];
  assert.equal(buildSegmentGrid(island, 3).cell, 3);
  assert.equal(MAX_GRID_BUCKETS, 262144);
  assert.equal(COARSEN_STEPS, 64);
});

test('⚠ the refusal survives for what coarsening cannot reach: an extent the bound cannot tile is refused before it allocates, naming the steps', () => {
  // ⚠ A refusal that had been deleted would HANG the test instead of failing it — which the
  // mutation rung scores as unproven rather than killed. 1.25^64 ≈ 1.6 million, so a chord of
  // 2^18 × 2 million units at cell 1 is still over the cap after every step and refuses in a
  // microsecond; a healthy map never gets within six orders of magnitude of it.
  // A non-zero origin, so the extent in the message is a difference and not a sum.
  const impossible: CoastEdge[] = [{ ax: 10, az: 20, bx: 10 + 2 ** 18 * 2e6, bz: 20 + 2 ** 18 * 2e6 }];
  assert.throws(
    () => buildSegmentGrid(impossible, 1),
    (e: unknown) =>
      e instanceof Error &&
      e.message.startsWith('shore-grid: a ') &&
      e.message.includes(` over a ${(2 ** 18 * 2e6).toFixed(1)} x ${(2 ** 18 * 2e6).toFixed(1)} extent at cell ${COARSEN_FACTOR ** 64}`) &&
      e.message.endsWith('exceeds 262144 after 64 coarsening steps — the cell arithmetic has inverted'),
  );
});

test('⚠ the UN-PROJECTED forest fits the cap — so the grid is NOT what stands between the layout and a true spacing', () => {
  // ADR-0527's remaining projection work (`the-un-projection-is-deleted-and-the-packer-hands-over-
  // ground`, item 3) inherited a blocker from `true-footprint.ts`: un-projecting the whole stream
  // rather than each island about its own centre made the thirty-five-island crowd 10,235 units
  // deep, and shore-grid REFUSED that extent — 478,401 buckets against the 262,144 cap. On that
  // record the forest's spacing was made a PRECONDITION of deleting the repair.
  //
  // ⚠ THAT REFUSAL WAS REAL WHEN IT WAS MEASURED AND CANNOT HAPPEN NOW, and the difference is this
  // module, not that one. `buildSegmentGrid` did not coarsen then; it does since ADR-0520, when the
  // land-per-capability ratio shrank the sand's cell from 7 to 2.6 units over an unchanged forest
  // and asked for 1.17 M buckets. A cell that grows to fit keeps the far-field proof
  // (`cell >= width`) while bucketing more edges per cell than the walk needs — so an extent the
  // width cannot tile is TILED COARSER rather than refused.
  //
  // This pins the consequence, so nobody re-derives the blocker from the older comment: the
  // un-projected crowd is an ordinary extent for this grid, a few quarter-steps up, nowhere near
  // the refusal.
  //
  // ⚠⚠ AND THE LOOK THAT WAS LEFT HAS SINCE BEEN GIVEN — ADR-0546 (2026-09-08). This comment used
  // to end "what remains between the layout and a true spacing is therefore a LOOK", and the owner
  // took it: the 3D forest stands on true ground, `restoreTrueFootprint` is deleted, and the
  // corridor is landed rather than hypothetical. Nothing in THIS test changes — the extent it pins
  // is the one the deletion produces — but it is no longer describing a possibility. The landed
  // extent is measured on the real committed forest in
  // `harness/shipped-spacing-scene.test.ts`, which src cannot import (`scope-fence.test.ts`).
  const SAND_CELL = 2.6384359697243656;
  const unprojected: CoastEdge[] = [{ ax: 0, az: 0, bx: 2289.7, bz: 10235 }];
  const grid = buildSegmentGrid(unprojected, SAND_CELL);
  assert.ok(grid.nx * grid.nz <= MAX_GRID_BUCKETS, `${grid.nx} x ${grid.nz} = ${grid.nx * grid.nz}`);
  assert.ok(grid.cell >= SAND_CELL, 'coarsened, never refined — the far-field proof needs cell >= width');
  assert.ok(edgeGridFarField(grid.cell, SAND_CELL));
  // And it is not scraping the bound: the steps it actually takes are few, so the honest reading is
  // "an ordinary extent" rather than "it just fits". Asserted as a ceiling on the STEPS rather than
  // on the bucket count, because the count is what the cap already bounds — the number that says
  // whether there is headroom is how much coarsening it took to get there.
  const steps = Math.round(Math.log(grid.cell / SAND_CELL) / Math.log(COARSEN_FACTOR));
  assert.ok(steps <= 8, `the un-projected crowd settles in ${steps} quarter-steps, not near the 64 bound`);
  // The projected crowd is the same shape, fewer steps — stated beside it so the comparison the
  // blocker rested on is visible in one place rather than inferred across two files.
  const projected = buildSegmentGrid([{ ax: 0, az: 0, bx: 2289.7, bz: 3545.4 }], SAND_CELL);
  assert.ok(projected.cell <= grid.cell, 'a deeper forest needs at least as coarse a cell, never finer');
});

test('shore-far-field-is-one-lookup: the padded near mask agrees with the neighbourhood walk everywhere', () => {
  // A rectangular, OPEN edge set makes the index's extent unambiguous while leaving a 3-by-3-cell
  // interior that cannot contain a near answer. It is deliberately several cells wide: a one-cell
  // fixture could make a mask that only describes the boundary look correct.
  const cap = 2;
  const edges: CoastEdge[] = [
    { ax: 0, az: 0, bx: 12, bz: 0 },
    { ax: 12, az: 0, bx: 12, bz: 12 },
    { ax: 12, az: 12, bx: 0, bz: 12 },
    { ax: 0, az: 12, bx: 0, bz: 0 },
  ];
  const grid = buildSegmentGrid(edges, cap) as EdgeGrid & {
    readonly nearMask: Uint8Array;
    far(x: number, z: number): boolean;
  };

  // The first two assertions make a missing public surface an ASSERTION red, rather than allowing
  // an undefined property access to disguise the regression as a loading failure.
  assert.ok('nearMask' in grid, 'the grid exposes its precomputed near-cell mask');
  assert.ok('far' in grid, 'the grid answers whether a point is beyond the near field');
  assert.equal(grid.nearMask.length, (grid.nx + 2) * (grid.nz + 2));

  // The mask has one padded cell around the grid, hence the +1 offset for a grid cell. The bottom
  // edge occupies the middle bottom cell; the centre is three cells from every edge.
  const maskAt = (i: number, j: number) => grid.nearMask[(j + 1) * (grid.nx + 2) + i + 1]!;
  assert.ok(maskAt(3, 0) !== 0, 'a cell adjacent to an edge is marked near');
  assert.equal(maskAt(3, 3), 0, 'a cell three cells from every edge is marked far');

  let probes = 0;
  for (let x = -6.13; x <= 18; x += 0.73) {
    for (let z = -6.13; z <= 18; z += 0.73) {
      // This covers one cell beyond the grid and points genuinely outside it, on every side.
      assert.equal(grid.far(x, z), grid.candidates(x, z).length === 0, `far disagrees at (${x}, ${z})`);
      const got = nearestOnSegments(grid, x, z, cap);
      const expected = bruteOpen(edges, x, z, cap);
      assert.ok(Math.abs(got.distance - expected.distance) < 1e-9, `distance differs at (${x}, ${z})`);
      assert.ok(
        Math.abs(got.gx - expected.gx) < 1e-9 && Math.abs(got.gz - expected.gz) < 1e-9,
        `gradient differs at (${x}, ${z}): (${got.gx}, ${got.gz}) vs (${expected.gx}, ${expected.gz})`,
      );
      probes += 1;
    }
  }
  assert.ok(probes > 1000, `only ${probes} expanded-grid probes`);

  const empty = buildSegmentGrid([], cap) as typeof grid;
  assert.equal(empty.far(100, -100), true, 'an empty grid is always far');
  assert.deepEqual(nearestOnSegments(empty, 100, -100, cap), { distance: cap, gx: 0, gz: 0 });
});
