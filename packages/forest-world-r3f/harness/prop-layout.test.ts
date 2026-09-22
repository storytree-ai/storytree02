// prop-layout.test.ts — the prop siting contract, proved against the REAL island fixture.
//
// The load-bearing check is the RIM. Everything a prop generator does downstream — fence a
// coast, hedge a boundary, keep a scatter off the shore — starts from one closed loop, and a
// loop that is silently PARTIAL is the failure mode this module was written against: it
// comes back well-formed, it renders, and a wall around two-thirds of the island reads as an
// art choice rather than as a bug. So the rim is pinned three ways at once — its point count,
// its edge lengths, and (the one that actually proves it is the OUTER boundary and not some
// interior cycle) its enclosed area against the summed area of all 164 cells.
//
// Everything else here exists so a later edit cannot make a function return something
// degenerate — an empty scatter, a collapsed inset, a NaN point — and have the page still
// draw a plausible island.

import assert from 'node:assert/strict';
import test from 'node:test';

import { groundCellsFrom } from './island-descriptors.js';
import { islandScene } from './island-fixture.js';
import { LAND_RELIEF_AMPLITUDE, landHeight } from './land-definition.js';
import {
  centroidOf,
  deepestPoint,
  distanceToPath,
  grove,
  heightField,
  insetLoop,
  insideLoop,
  layoutCells,
  meander,
  parcelLoop,
  parcelSummaries,
  pathLength,
  pointAt,
  resample,
  rimLoop,
  ring,
  scatter,
  smoothLoop,
  type GPoint,
  type LayoutCell,
} from './prop-layout.js';

const SCENE = islandScene({});
const GROUND = groundCellsFrom(SCENE);
const CELLS = layoutCells(GROUND);
const RIM = rimLoop(CELLS);

// ---------------------------------------------------------------------------
// Local instruments. Deliberately re-implemented rather than imported, so a bug in the
// module cannot cancel itself out against the same bug in its own test.
// ---------------------------------------------------------------------------

/** Enclosed area of a ring, unsigned — the module's cells are mixed-wound, so sign is noise. */
function areaOf(loop: readonly GPoint[]): number {
  let s = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i]!;
    const b = loop[(i + 1) % loop.length]!;
    s += a.x * b.z - b.x * a.z;
  }
  return Math.abs(s) / 2;
}

/** Total absolute turning, and the sharpest single corner, in degrees. */
function turningOf(loop: readonly GPoint[]) {
  let total = 0;
  let max = 0;
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n]!;
    const b = loop[i]!;
    const c = loop[(i + 1) % n]!;
    const e1x = b.x - a.x;
    const e1z = b.z - a.z;
    const e2x = c.x - b.x;
    const e2z = c.z - b.z;
    const ang = Math.abs(Math.atan2(e1x * e2z - e1z * e2x, e1x * e2x + e1z * e2z));
    total += ang;
    if (ang > max) max = ang;
  }
  return { total: (total * 180) / Math.PI, max: (max * 180) / Math.PI };
}

function vkey(p: GPoint): string {
  return `${Math.round(p.x * 1000)},${Math.round(p.z * 1000)}`;
}
function ekey(a: GPoint, b: GPoint): string {
  return vkey(a) < vkey(b) ? `${vkey(a)}|${vkey(b)}` : `${vkey(b)}|${vkey(a)}`;
}
function gap(a: GPoint, b: GPoint): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
function cell(points: GPoint[]): LayoutCell {
  return { points, parcel: undefined, island: undefined, status: 'healthy', cellId: undefined };
}

const ISLAND_AREA = CELLS.reduce((s, c) => s + areaOf(c.points), 0);

// ---------------------------------------------------------------------------
// 0. NON-VACUITY — the fixture is the island these numbers were measured on
// ---------------------------------------------------------------------------

test('NON-VACUITY: the fixture is the measured island — 164 quad cells, 11 parcels', () => {
  // Every band asserted below was measured on THIS island. If the fixture ever changes shape
  // the bands stop meaning what they say, and this is where that is caught — loudly, and
  // before eleven other tests fail in ways that look like regressions in the module.
  assert.equal(CELLS.length, 164, `expected 164 ground cells, got ${CELLS.length}`);
  assert.deepEqual(
    [...new Set(CELLS.map((c) => c.points.length))],
    [4],
    'every cell should be a quad',
  );
  assert.equal(new Set(CELLS.map((c) => c.parcel)).size, 11, 'expected 11 capabilities');
  assert.ok(
    ISLAND_AREA > 24_000 && ISLAND_AREA < 25_000,
    `island area ${ISLAND_AREA.toFixed(1)} is outside the measured ~24,632 square units`,
  );
});

test('layoutCells converts ground y INTO z, once, losing nothing', () => {
  // The y-is-really-z trap, asserted rather than commented. `GroundCell.points[].y` is the
  // depth axis; if this ever stops mapping onto `z` every prop on the island lands on the
  // wrong axis and the picture still looks plausible.
  assert.equal(CELLS.length, GROUND.length);
  for (let i = 0; i < GROUND.length; i++) {
    const src = GROUND[i]!;
    const out = CELLS[i]!;
    assert.equal(out.points.length, src.points.length);
    for (let j = 0; j < src.points.length; j++) {
      assert.equal(out.points[j]!.x, src.points[j]!.x);
      assert.equal(out.points[j]!.z, src.points[j]!.y);
    }
    assert.equal(out.parcel, src.parcel);
    assert.equal(out.status, src.status);
  }
});

// ---------------------------------------------------------------------------
// 1. THE RIM
// ---------------------------------------------------------------------------

test('THE MIXED-WINDING TRAP: a DIRECTED rim walk cannot close, which is why nothing here uses direction', () => {
  // This is the measurement the module's header rests on, kept executable so the paragraph
  // can never quietly become false. The fixture's cells are wound BOTH ways — nothing
  // normalises them — so following `points[i] -> points[i+1]` along rim edges is following a
  // coin flip, and the walk strands.
  let positive = 0;
  let negative = 0;
  for (const c of CELLS) {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const a = c.points[i]!;
      const b = c.points[(i + 1) % 4]!;
      s += a.x * b.z - b.x * a.z;
    }
    if (s > 0) positive += 1;
    else negative += 1;
  }
  assert.equal(positive, 68, `expected 68 positively-wound cells, got ${positive}`);
  assert.equal(negative, 96, `expected 96 negatively-wound cells, got ${negative}`);

  const count = new Map<string, number>();
  for (const c of CELLS) {
    for (let i = 0; i < 4; i++) {
      const k = ekey(c.points[i]!, c.points[(i + 1) % 4]!);
      count.set(k, (count.get(k) ?? 0) + 1);
    }
  }
  const successor = new Map<string, string>();
  for (const c of CELLS) {
    for (let i = 0; i < 4; i++) {
      const a = c.points[i]!;
      const b = c.points[(i + 1) % 4]!;
      if (count.get(ekey(a, b)) === 1) successor.set(vkey(a), vkey(b));
    }
  }
  let longest = 0;
  for (const start of RIM.map(vkey)) {
    const seen = new Set<string>();
    let current = start;
    let steps = 0;
    for (;;) {
      if (seen.has(current)) break;
      seen.add(current);
      const next = successor.get(current);
      if (next === undefined) break;
      current = next;
      steps += 1;
    }
    if (steps > longest) longest = steps;
  }
  assert.ok(
    longest < RIM.length,
    `the naive DIRECTED walk managed ${longest} of ${RIM.length} rim vertices — if it now ` +
      'closes, the fixture normalised its winding and the header is describing a trap that ' +
      'no longer exists',
  );
  assert.equal(longest, 29, `measured: the directed walk strands after 29 steps, got ${longest}`);
});

test('rimLoop is ONE closed loop of exactly 52 points, each edge 13.4-13.8 units', () => {
  assert.equal(RIM.length, 52, `expected 52 rim points, got ${RIM.length}`);
  assert.equal(
    new Set(RIM.map(vkey)).size,
    52,
    'the rim revisited a vertex — that would be a pinch, and the island rim has none',
  );

  const gaps = RIM.map((p, i) => gap(p, RIM[(i + 1) % RIM.length]!));
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  // Re-measured under ADR-0593 D1 (land camera 20 -> 50 degrees): 13.4402 to 13.5762 — inside
  // the same band this asserted at 20 degrees (13.4083 to 13.7419), which is expected rather
  // than coincidental: the rim lives in TRUE-GROUND space (un-projected out of the drawing), so
  // it is nominally camera-independent, and the residual movement is quantization noise from the
  // scene's own SVG serialization at fixed decimal precision (`toFixed(1)`, `app-surface`'s
  // painter), amplified on the way back out by `1 / sin(land camera)`. That amplifier SHRANK
  // (2.92x at 20 degrees, 1.31x at 50 degrees), so the new noise floor is if anything tighter,
  // and the band below still holds with room. The band is what proves the loop CLOSES: a walk
  // that jumped across the island to a stranded fragment would show up here as a huge segment,
  // and one that doubled back would show up as a tiny one.
  assert.ok(min > 13.4 && max < 13.8, `rim edge lengths ran ${min.toFixed(4)}..${max.toFixed(4)}`);
  const perimeter = pathLength(RIM, true);
  // Re-measured for the same reason: 701.548, down from 702.013 at the retired 20-degree camera
  // — a 0.07% move, consistent with the same shrinking quantization amplifier above rather than
  // any change to the rim's shape (RIM.length above is still exactly 52).
  assert.ok(
    Math.abs(perimeter - 701.548) < 0.01,
    `rim perimeter ${perimeter.toFixed(3)}, measured 701.548`,
  );
});

test('rimLoop encloses the WHOLE island — its area equals the summed cell area', () => {
  // THE CHECK THAT PROVES IT IS THE OUTER BOUNDARY. Point count and edge lengths would all
  // still pass on an interior cycle, or on the boundary of a large fragment. Area cannot:
  // it can only match the sum of all 164 cells if the loop encloses all 164 cells.
  const rimArea = areaOf(RIM);
  const relative = Math.abs(rimArea - ISLAND_AREA) / ISLAND_AREA;
  assert.ok(
    relative < 0.001,
    `rim area ${rimArea.toFixed(3)} vs summed cell area ${ISLAND_AREA.toFixed(3)} — ` +
      `${(relative * 100).toFixed(4)}% apart, over the 0.1% bar`,
  );
  // Measured, it agrees to floating-point noise (~4e-16) rather than merely to 0.1%.
  assert.ok(relative < 1e-12, `measured agreement is exact; got ${relative.toExponential(2)}`);
});

test('rimLoop THROWS on a boundary that is not a single loop — a HOLE', () => {
  // Remove a cell none of whose edges is on the rim: the region gains an interior hole, so
  // its boundary becomes two loops. Returning either one silently would fence off part of
  // the island, which is exactly the failure this module exists to make impossible.
  const shared = new Map<string, number>();
  for (const c of CELLS) {
    for (let i = 0; i < 4; i++) {
      const k = ekey(c.points[i]!, c.points[(i + 1) % 4]!);
      shared.set(k, (shared.get(k) ?? 0) + 1);
    }
  }
  const interior = CELLS.findIndex((c) =>
    c.points.every((p, i) => shared.get(ekey(p, c.points[(i + 1) % 4]!)) === 2),
  );
  assert.ok(interior >= 0, 'no fully-interior cell to remove — the doctored case is vacuous');

  assert.throws(
    () => rimLoop(CELLS.filter((_, i) => i !== interior)),
    /more than one loop/,
    'a holed island must not return a partial rim',
  );
});

test('rimLoop THROWS on two disjoint cells', () => {
  assert.throws(
    () => rimLoop([CELLS[0]!, CELLS[100]!]),
    /more than one loop/,
    'two islands are not one loop',
  );
});

test('rimLoop THROWS on a boundary too short to close', () => {
  assert.throws(() => rimLoop([]), /at least 3/);
});

test('A PINCH resolves into ONE circuit rather than throwing — two blobs on one corner', () => {
  // MEASURED ON THE REAL FIXTURE, NOT INVENTED: `cap-1` and `cap-5` are each two groups of
  // cells meeting at a single vertex, so four boundary edges arrive there. An earlier draft
  // demanded degree 2 everywhere and threw on 2 of the island's 11 capabilities, leaving
  // them unfenceable. The synthetic pair below is the same shape, small enough to check by
  // hand: two 10x10 squares touching at the origin, deliberately wound OPPOSITE ways so the
  // resolution cannot be leaning on winding.
  const a = cell([
    { x: -10, z: -10 },
    { x: 0, z: -10 },
    { x: 0, z: 0 },
    { x: -10, z: 0 },
  ]);
  const b = cell(
    [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
      { x: 0, z: 10 },
    ].reverse(),
  );
  const loop = rimLoop([a, b]);
  assert.equal(loop.length, 8, 'both squares belong to the circuit, so all 8 edges are walked');
  assert.ok(Math.abs(areaOf(loop) - 200) < 1e-9, `enclosed area ${areaOf(loop)}, expected 200`);
  const corner = loop.filter((p) => vkey(p) === '0,0');
  assert.equal(corner.length, 2, 'the pinch corner is passed through exactly twice');
});

// ---------------------------------------------------------------------------
// 2. PARCELS
// ---------------------------------------------------------------------------

const SUMMARIES = parcelSummaries(CELLS);

test('parcelSummaries returns 11 entries, sorted by id, whose areas tile the island', () => {
  assert.equal(SUMMARIES.length, 11, `expected 11 parcels, got ${SUMMARIES.length}`);
  const ids = SUMMARIES.map((s) => s.parcel);
  assert.deepEqual(
    ids,
    [...ids].sort(),
    'parcels must come back sorted by id — a Map\'s insertion order depends on cell order, ' +
      'so props sited "on the third parcel" would move when the substrate reshuffles',
  );
  // Lexical, not numeric: cap-10 sorts between cap-1 and cap-2. That is deliberate — the
  // only requirement is that the order is a property of the DATA, and a locale-aware or
  // numeric collation is one more thing to keep in step with nothing.
  assert.equal(ids[1], 'cap-1');
  assert.equal(ids[2], 'cap-10');

  const total = SUMMARIES.reduce((s, p) => s + p.area, 0);
  assert.ok(
    Math.abs(total - ISLAND_AREA) / ISLAND_AREA < 1e-9,
    `parcel areas sum to ${total.toFixed(4)}, island is ${ISLAND_AREA.toFixed(4)} — every ` +
      'cell belongs to exactly one capability on this fixture, so they must agree exactly',
  );
  for (const s of SUMMARIES) {
    assert.equal(s.status, 'healthy', `${s.parcel} status`);
    assert.ok(s.cells.length > 0 && s.area > 0, `${s.parcel} is empty`);
  }
});

test("every parcel yields a loop, and its centroid sits inside its OWN parcel's loop", () => {
  for (const s of SUMMARIES) {
    const loop = parcelLoop(CELLS, s.parcel);
    assert.ok(loop.length >= 8, `${s.parcel} loop has only ${loop.length} points`);
    assert.ok(
      insideLoop(loop, s.centroid),
      `${s.parcel}: its area-weighted centroid fell OUTSIDE its own outline. On a mixed-wound ` +
        'island that is what a signed-area weighting does — the cancellation drags the centroid ' +
        'off the parcel entirely.',
    );
    assert.ok(
      Math.abs(areaOf(loop) - s.area) / s.area < 1e-9,
      `${s.parcel}: outline encloses ${areaOf(loop).toFixed(2)} but its cells sum to ${s.area.toFixed(2)}`,
    );
  }
  // The two pinched capabilities, named so the case stays covered if the fixture is ever
  // reshaped and they stop being the pinched ones.
  //
  // The counts moved from 30 / 20 when the substrate stopped interning vertices in SCREEN space
  // (`substrate-interning-moves-to-ground-space`): the mesh is now built on the ground and projected
  // once, so its jitter is seeded off ground coordinates rather than projected ones and the interior
  // vertices sit where the pre-camera mesh put them. A pinched parcel's outline follows those
  // vertices, so its point count follows too. Nothing structural moved -- the enclosed area still
  // matches the parcel's cells exactly (asserted above), and both are still pinched.
  //
  // They moved AGAIN, 28 -> 16 and 18 -> 12, under ADR-0593 D1 (land camera 20 -> 50 degrees) —
  // and for a THIRD, related reason. `chainBoundary`'s vertex/edge index (`vertexKey`/`edgeKey`
  // above, rounded to 1e-3 ground units) is what decides whether two cells' nominally-shared
  // corner is recognised as ONE point (the edge between them is interior and cancels) or as two
  // near-duplicate points a fraction of a unit apart (each half then reads as its own boundary
  // edge). The rim lives in TRUE-GROUND space, recovered by dividing the drawing's
  // already-quantized (`toFixed(1)`) coordinates by `sin(land camera)` — an amplifier that
  // SHRANK from 2.92x at 20 degrees to 1.31x at 50 degrees (see the rim edge-length comment
  // above), so the sub-millimetre noise reaching these vertices shrank with it. Fewer corners
  // now straddle the 1e-3 rounding boundary, so more of a pinched parcel's nominally-shared
  // corners are recognised as shared — which is fewer distinct points on its outline, never
  // more. The enclosed area still matches the parcel's cells exactly (asserted above, still
  // true), and both are still pinched.
  assert.equal(parcelLoop(CELLS, 'cap-1').length, 16);
  assert.equal(parcelLoop(CELLS, 'cap-5').length, 12);
});

test('parcelLoop refuses a parcel that does not exist', () => {
  assert.throws(() => parcelLoop(CELLS, 'cap-nope'), /no cells belong/);
});

test('centroidOf weights by |area| — the island centroid lands near the origin', () => {
  const c = centroidOf(CELLS);
  // The fixture is a 13-hex island centred on the origin, so a correct centroid is close to
  // it. A signed-area weighting would cancel 96 of the 164 cells against the other 68 and
  // throw the answer somewhere off the coast; this band is what catches that.
  assert.ok(
    Math.hypot(c.x, c.z) < 12,
    `island centroid ${JSON.stringify(c)} is ${Math.hypot(c.x, c.z).toFixed(1)} units from ` +
      'the origin — a sign-cancelling weighting is the usual cause',
  );
  assert.ok(insideLoop(RIM, c), 'the island centroid is not even on the island');
});

// ---------------------------------------------------------------------------
// 3. LOOP OPERATIONS
// ---------------------------------------------------------------------------

test('insetLoop(rim, 6) lands strictly inside the rim, ~6 units in everywhere', () => {
  const inset = insetLoop(RIM, 6);
  assert.equal(inset.length, RIM.length);
  const distances: number[] = [];
  for (const p of inset) {
    assert.ok(insideLoop(RIM, p), `inset point ${JSON.stringify(p)} escaped the rim`);
    distances.push(distanceToPath(RIM, p, true));
  }
  const min = Math.min(...distances);
  const max = Math.max(...distances);
  // Measured: min is exactly 6, max 6.93209. The excess is the miter at the rim's sharpest
  // corner (60.11 degrees, so 1/cos(30.06) = 1.1554x) and is correct, not slack — the vertex
  // has to sit further from its own two edges to be 6 from both.
  assert.ok(min >= 6 - 1e-9, `closest inset point is only ${min.toFixed(5)} from the rim`);
  assert.ok(max <= 6 * 1.16, `furthest inset point is ${max.toFixed(5)}, over the 1.1554x miter`);
  assert.ok(areaOf(inset) < areaOf(RIM), 'the inset must enclose less than the rim');
});

test('insetLoop scales linearly and never inverts, at 2 / 6 / 12 units', () => {
  for (const d of [2, 6, 12]) {
    const inset = insetLoop(RIM, d);
    const distances = inset.map((p) => distanceToPath(RIM, p, true));
    assert.ok(Math.min(...distances) >= d - 1e-9, `d=${d} min ${Math.min(...distances)}`);
    assert.ok(Math.max(...distances) / d <= 1.16, `d=${d} ratio ${Math.max(...distances) / d}`);
    assert.ok(inset.every((p) => insideLoop(RIM, p)), `d=${d} escaped the rim`);
  }
});

test('resample makes an UNEVENLY sampled polyline uniform', () => {
  // The input is deliberately pathological: sampled on t^2.5, so its own segments run from
  // 0.011 to 6.15 units — a 540x spread.
  const uneven: GPoint[] = [];
  for (let i = 0; i <= 40; i++) {
    const t = Math.pow(i / 40, 2.5);
    uneven.push({ x: t * 100, z: Math.sin(t * Math.PI * 1.5) * 12 });
  }
  const inputGaps = uneven.slice(1).map((p, i) => gap(uneven[i]!, p));
  assert.ok(
    Math.max(...inputGaps) / Math.min(...inputGaps) > 100,
    'NON-VACUITY: the input must actually be uneven, or this proves nothing',
  );

  const out = resample(uneven, 3);
  assert.equal(out.length, 37, `expected 37 samples at a 3-unit pitch, got ${out.length}`);
  const step = pathLength(uneven) / (out.length - 1);
  const gaps = out.slice(1).map((p, i) => gap(out[i]!, p));
  const min = Math.min(...gaps);
  const max = Math.max(...gaps);
  // Measured: 2.98456 to 2.98736 against a 2.98736 step — a 0.09% spread, all of it the
  // chord-versus-arc deficit where the curve turns between two samples.
  assert.ok(max <= step + 1e-9, `a gap of ${max} exceeded the ${step} step`);
  assert.ok(
    min / step > 0.998,
    `spacing ran ${min.toFixed(5)}..${max.toFixed(5)} against a ${step.toFixed(5)} step`,
  );
  // Ends pinned exactly, so a resampled path still welds to whatever it was cut from.
  assert.deepEqual(out[0], uneven[0]);
  assert.deepEqual(out[out.length - 1], uneven[uneven.length - 1]);
});

test('resample closes a loop with no short seam segment', () => {
  const out = resample(RIM, 8, true);
  assert.equal(out.length, 88, `expected 88 samples around the rim at 8 units, got ${out.length}`);
  const step = pathLength(RIM, true) / out.length;
  const gaps = out.map((p, i) => gap(p, out[(i + 1) % out.length]!));
  // No segment may EXCEED the step — that is what says the seam was not left over. The
  // shortfall (measured floor 0.866 of the step) is the chord across the rim's 60-degree
  // corners, which is geometry, not a remainder.
  assert.ok(Math.max(...gaps) <= step + 1e-9, `a segment of ${Math.max(...gaps)} exceeded ${step}`);
  assert.ok(Math.min(...gaps) / step > 0.86, `shortest segment ${Math.min(...gaps) / step} of step`);
  assert.ok(out.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
});

test('resample survives degenerate input rather than returning something unloopable', () => {
  assert.deepEqual(resample([], 5), []);
  assert.equal(resample([{ x: 1, z: 2 }], 5).length, 2);
  assert.equal(resample([{ x: 1, z: 2 }, { x: 1, z: 2 }], 5).length, 2);
  assert.equal(resample(RIM, 0, true).length, 2, 'a zero pitch cannot loop forever');
});

test('smoothLoop rounds the corners off without eating the island', () => {
  const raw = turningOf(RIM);
  // Re-measured under ADR-0593 D1 (land camera 20 -> 50 degrees): the rim's sharpest corner
  // moved from 60.111 to 60.457 degrees — a 0.6% move, the same quantization-noise effect
  // documented at the rim edge-length assertion above (the true-ground vertices are recovered
  // by an un-projection whose amplifier shrank from 2.92x to 1.31x), not a change of shape: RIM
  // is still exactly 52 points and this is still its one sharpest corner.
  assert.ok(
    Math.abs(raw.max - 60.457) < 0.01,
    `the rim's sharpest corner measures 60.457 degrees, got ${raw.max.toFixed(3)}`,
  );

  const once = smoothLoop(RIM, 1, true);
  const twice = smoothLoop(RIM, 2, true);
  assert.equal(once.length, 104);
  assert.equal(twice.length, 208);

  const t1 = turningOf(once);
  const t2 = turningOf(twice);

  // WHAT FALLS is the sharpest corner: 60.457 -> 30.335 -> 16.276 degrees, roughly halving
  // each round (re-measured with the rim above; the halving PROPERTY is camera-independent,
  // only the starting corner moved). That is the measure of "reads as a coast rather than as
  // a board".
  assert.ok(Math.abs(t1.max - 30.335) < 0.01, `one round: max corner ${t1.max.toFixed(3)}`);
  assert.ok(Math.abs(t2.max - 16.276) < 0.01, `two rounds: max corner ${t2.max.toFixed(3)}`);
  assert.ok(t1.max < raw.max / 1.9 && t2.max < t1.max / 1.8, 'each round must halve the worst corner');

  // WHAT DOES NOT MOVE is the total turning — Chaikin splits each corner into two whose
  // turns sum to the original. Anyone reaching for total turning as a smoothness metric
  // would measure exactly nothing, so it is pinned here as the counter-example. This property
  // is camera-agnostic by construction (Chaikin conserves total turning for ANY input loop),
  // so it is asserted as an internal identity rather than against a re-based literal.
  assert.ok(
    Math.abs(t1.total - raw.total) < 1e-9 && Math.abs(t2.total - raw.total) < 1e-9,
    `total turning moved: ${raw.total} -> ${t1.total} -> ${t2.total}`,
  );

  // AND THE AREA COST, re-measured: 99.880% retained after one round, 99.851% after two (was
  // 99.883% / 99.853% at the retired 20-degree camera — the same small quantization move, not
  // a change in how much Chaikin shaves off).
  const rimArea = areaOf(RIM);
  const f1 = areaOf(once) / rimArea;
  const f2 = areaOf(twice) / rimArea;
  assert.ok(Math.abs(f1 - 0.99880) < 1e-4, `one round retained ${f1.toFixed(6)} of the area`);
  assert.ok(Math.abs(f2 - 0.99851) < 1e-4, `two rounds retained ${f2.toFixed(6)} of the area`);
  assert.ok(f2 < f1 && f1 < 1, 'Chaikin only ever shrinks');
});

test('smoothLoop on an OPEN path keeps its endpoints', () => {
  const open = [
    { x: 0, z: 0 },
    { x: 10, z: 8 },
    { x: 20, z: -4 },
    { x: 30, z: 0 },
  ];
  const out = smoothLoop(open, 2, false);
  assert.deepEqual(out[0], open[0]);
  assert.deepEqual(out[out.length - 1], open[open.length - 1]);
  assert.ok(out.length > open.length);
  assert.deepEqual(smoothLoop(RIM, 0, true), RIM, 'zero rounds is the identity');
});

// ---------------------------------------------------------------------------
// 4. MEASUREMENT HELPERS
// ---------------------------------------------------------------------------

test('pathLength / pointAt walk the loop consistently', () => {
  const total = pathLength(RIM, true);
  // Same re-measured perimeter as the rim edge-length assertion above (701.548, down from
  // 702.013 at the retired 20-degree land camera) — restated here rather than imported so
  // this test does not depend on assertion order in the other one.
  assert.ok(Math.abs(total - 701.548) < 0.01);
  assert.equal(pathLength([{ x: 0, z: 0 }], true), 0);

  const start = pointAt(RIM, 0, true);
  assert.deepEqual(start.point, RIM[0]);
  assert.ok(Math.abs(Math.hypot(start.dir.x, start.dir.z) - 1) < 1e-12, 'dir must be unit length');

  // A half-way point really is half the arc length along.
  const half = pointAt(RIM, 0.5, true);
  let walked = 0;
  for (let i = 0; i < RIM.length; i++) {
    const a = RIM[i]!;
    const b = RIM[(i + 1) % RIM.length]!;
    const seg = gap(a, b);
    if (walked + seg >= total / 2) {
      const into = total / 2 - walked;
      const expect = { x: a.x + ((b.x - a.x) * into) / seg, z: a.z + ((b.z - a.z) * into) / seg };
      assert.ok(gap(half.point, expect) < 1e-9, 'pointAt(0.5) is not at half the arc length');
      break;
    }
    walked += seg;
  }

  // t is CLAMPED, never wrapped: an overshoot must not teleport back to the start.
  const open = RIM.slice(0, 5);
  assert.deepEqual(pointAt(open, 1.4, false).point, open[open.length - 1]);
  assert.deepEqual(pointAt(open, -3, false).point, open[0]);
});

test('insideLoop handles a non-convex ring by even-odd crossing', () => {
  // An L, which a convexity-assuming test would get wrong in the notch.
  const ell = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 4 },
    { x: 4, z: 4 },
    { x: 4, z: 10 },
    { x: 0, z: 10 },
  ];
  assert.equal(insideLoop(ell, { x: 2, z: 2 }), true);
  assert.equal(insideLoop(ell, { x: 8, z: 2 }), true);
  assert.equal(insideLoop(ell, { x: 8, z: 8 }), false, 'the notch is outside');
  assert.equal(insideLoop(ell, { x: 20, z: 20 }), false);
  // And reversing the ring cannot change the answer — the rim's walk direction depends on
  // which cell the substrate emitted first.
  const reversed = [...ell].reverse();
  for (const p of [
    { x: 2, z: 2 },
    { x: 8, z: 8 },
    { x: 20, z: 20 },
  ]) {
    assert.equal(insideLoop(reversed, p), insideLoop(ell, p), 'winding changed the answer');
  }
});

test('distanceToPath measures to the nearest SEGMENT, not the nearest vertex', () => {
  const line = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ];
  assert.ok(Math.abs(distanceToPath(line, { x: 5, z: 3 }) - 3) < 1e-12);
  // Off the end, the answer is the endpoint distance — the projection is clamped.
  assert.ok(Math.abs(distanceToPath(line, { x: 14, z: 0 }) - 4) < 1e-12);
  // Closed adds the return segment.
  const tri = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 0, z: 10 },
  ];
  assert.ok(distanceToPath(tri, { x: -2, z: 5 }, true) < distanceToPath(tri, { x: -2, z: 5 }, false));
});

test('deepestPoint sits well inside the rim — further in than any random interior sample', () => {
  const deep = deepestPoint(RIM);
  assert.ok(insideLoop(RIM, deep), 'the deepest point is not on the island');
  const deepDistance = distanceToPath(RIM, deep, true);
  // Measured 58.86 units from the coast on a 233.8 x 135.1 island — comfortably inside.
  assert.ok(
    deepDistance > 50,
    `deepest point is only ${deepDistance.toFixed(2)} units from the rim`,
  );

  // The comparison that makes the name honest. 200 deterministic interior samples: their
  // mean clearance is 23.7 and the LUCKIEST reaches 56.9, so the deepest point beats every
  // one of them. A `deepestPoint` that had quietly degraded to "some interior point" would
  // fail here rather than passing on a technicality.
  const probes = scatter({ loop: RIM, count: 200, seed: 11 });
  assert.ok(probes.length > 150, `only ${probes.length} probe points — the comparison is weak`);
  const best = Math.max(...probes.map((p) => distanceToPath(RIM, p, true)));
  assert.ok(
    deepDistance > best,
    `deepest point (${deepDistance.toFixed(3)}) is no better than the luckiest of ` +
      `${probes.length} random interior samples (${best.toFixed(3)})`,
  );

  assert.deepEqual(deepestPoint(RIM), deep, 'deepestPoint must be deterministic');
  for (const s of SUMMARIES) {
    const loop = parcelLoop(CELLS, s.parcel);
    const p = deepestPoint(loop);
    assert.ok(insideLoop(loop, p), `${s.parcel}: deepest point fell outside its own parcel`);
    assert.ok(distanceToPath(loop, p, true) > 10, `${s.parcel}: deepest point hugs the boundary`);
  }
});

// ---------------------------------------------------------------------------
// 5. SCATTER AND ROUTE
// ---------------------------------------------------------------------------

test('scatter is deterministic, and respects minGap / edgeGap / the loop', () => {
  const opts = { loop: RIM, count: 60, seed: 7, minGap: 9, edgeGap: 8 } as const;
  const first = scatter(opts);
  assert.equal(first.length, 60, `asked for 60, got ${first.length}`);
  assert.deepEqual(scatter(opts), first, 'the same seed must give the same scatter');
  assert.notDeepEqual(
    scatter({ ...opts, seed: 8 }),
    first,
    'NON-VACUITY: a different seed must give a different scatter, or the seed is ignored',
  );

  for (const p of first) {
    assert.ok(insideLoop(RIM, p), `${JSON.stringify(p)} is off the island`);
    assert.ok(
      distanceToPath(RIM, p, true) >= 8,
      `${JSON.stringify(p)} is only ${distanceToPath(RIM, p, true).toFixed(3)} from the rim`,
    );
  }
  for (let i = 0; i < first.length; i++) {
    for (let j = i + 1; j < first.length; j++) {
      assert.ok(gap(first[i]!, first[j]!) >= 9, `two points ${gap(first[i]!, first[j]!)} apart`);
    }
  }
});

test('scatter keeps clear of an `avoid` polyline', () => {
  const route = meander({ x: -95, z: -30 }, { x: 95, z: 30 }, { seed: 3, sway: 6 });
  const points = scatter({
    loop: RIM,
    count: 80,
    seed: 7,
    minGap: 6,
    edgeGap: 6,
    avoid: [route],
    avoidGap: 14,
  });
  assert.ok(points.length > 40, `only ${points.length} points survived the avoid fence`);
  for (const p of points) {
    assert.ok(
      distanceToPath(route, p, false) >= 14,
      `a point landed ${distanceToPath(route, p, false).toFixed(3)} from the route`,
    );
  }
});

test('an UNSATISFIABLE scatter returns fewer points rather than hanging', () => {
  // The failure this bound exists for is a harness page that never paints, which is
  // indistinguishable from one that crashed and costs far more to diagnose than a thin
  // scatter. 5000 points at a 25-unit spacing does not fit on a 24,632-unit island; the
  // budget runs out and the answer is the 26 it managed.
  const started = Date.now();
  const got = scatter({ loop: RIM, count: 5000, seed: 7, minGap: 25, edgeGap: 10 });
  assert.ok(got.length > 0 && got.length < 5000, `got ${got.length} of 5000`);
  assert.ok(Date.now() - started < 20_000, 'the bounded budget did not bound anything');

  // And an outright impossible constraint returns nothing at all, without complaint.
  assert.deepEqual(scatter({ loop: RIM, count: 10, seed: 7, edgeGap: 500 }), []);
  assert.deepEqual(scatter({ loop: RIM, count: 0 }), []);
  assert.deepEqual(scatter({ loop: RIM.slice(0, 2), count: 5 }), []);
});

test('meander is deterministic, hits its endpoints EXACTLY, and stays within `sway`', () => {
  const from = { x: 0, z: 0 };
  const to = { x: 100, z: 0 };
  const route = meander(from, to, { seed: 5, sway: 4 });
  assert.equal(route.length, 13, 'the default is 12 steps, so 13 points');
  assert.deepEqual(route[0], from, 'the start must be exactly `from` — routes weld at endpoints');
  assert.deepEqual(route[route.length - 1], to, 'the end must be exactly `to`');
  assert.deepEqual(meander(from, to, { seed: 5, sway: 4 }), route, 'same seed, same route');
  assert.notDeepEqual(meander(from, to, { seed: 6, sway: 4 }), route, 'NON-VACUITY: seed matters');

  // The route runs along z = 0, so |z| IS the lateral offset. `sway` is a maximum, not a
  // scale factor — the two weights inside sum to 1 precisely so this holds.
  const lateral = Math.max(...route.map((p) => Math.abs(p.z)));
  assert.ok(lateral <= 4 + 1e-12, `strayed ${lateral.toFixed(4)} units against a sway of 4`);
  assert.ok(lateral > 0.5, 'NON-VACUITY: a route that never strays is not a meander');

  // It must actually be longer than the straight line it replaces.
  assert.ok(pathLength(route) > gap(from, to), 'a meander that is straight is not a meander');

  // Degenerate: from === to has no perpendicular, and must not produce NaN.
  const nowhere = meander({ x: 5, z: 5 }, { x: 5, z: 5 }, { seed: 2 });
  assert.deepEqual(nowhere[0], { x: 5, z: 5 });
  assert.deepEqual(nowhere[nowhere.length - 1], { x: 5, z: 5 });
  assert.ok(nowhere.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z)));
});

test('ring is a closed regular polygon of the requested radius', () => {
  const r = ring({ x: 3, z: -4 }, 10);
  assert.equal(r.length, 24, 'the default resolution is 24 sides');
  for (const p of r) {
    assert.ok(Math.abs(Math.hypot(p.x - 3, p.z + 4) - 10) < 1e-9, 'a vertex left the radius');
  }
  // The closing point is NOT repeated, so the circumference is a `closed` path length. A
  // 24-gon inscribes 99.7% of its circle, which is the 62.65 measured here against 62.83.
  const perimeter = pathLength(r, true);
  assert.ok(Math.abs(perimeter - 62.6526) < 1e-3, `perimeter ${perimeter.toFixed(4)}`);
  assert.equal(ring({ x: 0, z: 0 }, 5, 2).length, 3, 'fewer than 3 sides is not a ring');
  // `phase` rotates it, so a plaza can be aligned to a boundary rather than to the axes.
  const rotated = ring({ x: 0, z: 0 }, 10, 4, Math.PI / 4);
  assert.ok(Math.abs(rotated[0]!.x - Math.SQRT1_2 * 10) < 1e-9);
});

// ---------------------------------------------------------------------------
// 6. THE RELIEF FIELD, AND THE BLANKET NaN SWEEP
// ---------------------------------------------------------------------------

test('heightField binds the amplitude and nothing else', () => {
  const at = heightField();
  for (const [x, z] of [
    [0, 0],
    [42.5, -17.25],
    [-116.9, 67.54],
  ] as const) {
    assert.equal(at(x, z), landHeight(x, z, LAND_RELIEF_AMPLITUDE));
  }
  const flat = heightField(0);
  assert.equal(flat(42.5, -17.25), 0, 'a zero amplitude is a flat field');
  const doubled = heightField(LAND_RELIEF_AMPLITUDE * 2);
  assert.ok(Math.abs(doubled(42.5, -17.25) - 2 * at(42.5, -17.25)) < 1e-12);
});

test('NO NaN ESCAPES — every function, over the real island and over degenerate input', () => {
  // A single NaN coordinate propagates silently: the prop is placed at a position three.js
  // will happily accept, the mesh vanishes or explodes to infinity, and nothing names the
  // module it came from. So the sweep is blanket rather than per-function.
  const route = meander({ x: -95, z: -30 }, { x: 95, z: 30 }, { seed: 3, sway: 6 });
  const degenerate: GPoint[] = [
    { x: 1, z: 1 },
    { x: 1, z: 1 },
    { x: 1, z: 1 },
  ];

  const groups: (readonly GPoint[])[] = [
    RIM,
    insetLoop(RIM, 6),
    insetLoop(RIM, 0),
    insetLoop(degenerate, 3),
    smoothLoop(RIM, 3, true),
    smoothLoop(degenerate, 2, true),
    resample(RIM, 8, true),
    resample(degenerate, 4, true),
    route,
    meander({ x: 0, z: 0 }, { x: 0, z: 0 }),
    ring({ x: 0, z: 0 }, 12),
    ring({ x: 0, z: 0 }, 0),
    scatter({ loop: RIM, count: 40, seed: 3, minGap: 5, edgeGap: 5 }),
    [deepestPoint(RIM)],
    [deepestPoint(degenerate)],
    [centroidOf(CELLS)],
    [centroidOf([])],
    [pointAt(RIM, 0.37, true).point, pointAt(RIM, 0.37, true).dir],
    ...SUMMARIES.map((s) => parcelLoop(CELLS, s.parcel)),
    ...SUMMARIES.map((s) => [s.centroid, deepestPoint(parcelLoop(CELLS, s.parcel))]),
  ];

  let checked = 0;
  for (const group of groups) {
    for (const p of group) {
      assert.ok(
        Number.isFinite(p.x) && Number.isFinite(p.z),
        `a non-finite point escaped: ${JSON.stringify(p)}`,
      );
      checked += 1;
    }
  }
  assert.ok(checked > 800, `NON-VACUITY: only ${checked} points swept`);

  // And the scalars.
  for (const n of [
    pathLength(RIM, true),
    pathLength([], true),
    distanceToPath(RIM, { x: 0, z: 0 }, true),
    ...SUMMARIES.map((s) => s.area),
  ]) {
    assert.ok(Number.isFinite(n), `a non-finite scalar escaped: ${n}`);
  }
});

// ---------------------------------------------------------------------------
// GROVE — the clumped scatter the canopy is planted with
// ---------------------------------------------------------------------------
//
// The whole reason `grove` exists rather than a second call to `scatter` is that ISLANDERS
// packs its trees into stands and leaves the ground between them EMPTY, and a uniform scatter
// of the same count reads as a green rash instead. That claim has to be a number, or the next
// edit can quietly turn the grove back into a scatter and every test here still passes.

/** Mean distance from each point to its nearest neighbour. */
function meanNearest(points: readonly GPoint[]): number {
  let total = 0;
  for (const a of points) {
    let best = Infinity;
    for (const b of points) {
      if (a === b) continue;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < best) best = d;
    }
    total += best;
  }
  return total / points.length;
}

/** How far the EMPTIEST ground is from the nearest point — sampled on a grid inside the loop,
 *  reported at the 90th percentile so one awkward corner cannot carry the answer. */
function emptinessP90(loop: readonly GPoint[], points: readonly GPoint[]): number {
  const xs: number[] = [];
  for (let x = -110; x <= 110; x += 4) {
    for (let z = -60; z <= 60; z += 4) {
      const p = { x, z };
      if (!insideLoop(loop, p)) continue;
      let best = Infinity;
      for (const q of points) {
        const d = Math.hypot(q.x - p.x, q.z - p.z);
        if (d < best) best = d;
      }
      xs.push(best);
    }
  }
  xs.sort((a, b) => a - b);
  return xs[Math.floor(xs.length * 0.9)] ?? 0;
}

test('GROVE IS CLUMPED AND SCATTER IS NOT — the difference, as two numbers', () => {
  const loop = insetLoop(RIM, 8);
  const grouped = grove({
    loop,
    clusters: 6,
    perCluster: [5, 9],
    spread: 18,
    minGap: 8,
    edgeGap: 3,
    seed: 5,
  });
  assert.ok(grouped.length >= 24, `only ${grouped.length} trees planted`);
  const spread = scatter({ loop, count: grouped.length, minGap: 8, edgeGap: 3, seed: 5 });
  assert.equal(spread.length, grouped.length, 'the comparison is not like-for-like');

  // CLOSER TOGETHER: a stand's members sit nearer each other than the same number of points
  // spread evenly over the same plot. This is the "trees come in stands" half.
  const nnGrove = meanNearest(grouped);
  const nnScatter = meanNearest(spread);
  assert.ok(
    nnGrove < nnScatter * 0.8,
    `grove mean nearest ${nnGrove.toFixed(1)} vs scatter ${nnScatter.toFixed(1)} — not clumped`,
  );

  // AND THE GROUND BETWEEN THEM IS EMPTIER, which is the half that actually shows in the
  // picture: the composition is as much the bare ground as the trees.
  const emptyGrove = emptinessP90(loop, grouped);
  const emptyScatter = emptinessP90(loop, spread);
  assert.ok(
    emptyGrove > emptyScatter * 1.25,
    `grove leaves ${emptyGrove.toFixed(1)} units of open ground vs scatter's ` +
      `${emptyScatter.toFixed(1)} — the stands are not leaving gaps`,
  );
});

test('grove honours the island, the gaps and the avoid-paths it is given', () => {
  const loop = insetLoop(RIM, 8);
  const path = resample(insetLoop(RIM, 30), 6, true);
  const trees = grove({
    loop,
    clusters: 6,
    perCluster: [4, 8],
    spread: 20,
    minGap: 9,
    edgeGap: 4,
    avoid: [path],
    avoidGap: 12,
    seed: 3,
  });
  assert.ok(trees.length > 10);
  for (const t of trees) {
    assert.ok(insideLoop(loop, t), `a tree at ${t.x},${t.z} is off the island`);
    assert.ok(distanceToPath(loop, t, true) >= 4 - 1e-6, 'a tree stands on the rim');
    assert.ok(distanceToPath(path, t, false) >= 12 - 1e-6, 'a tree grows through the path');
  }
  for (let i = 0; i < trees.length; i++) {
    for (let j = i + 1; j < trees.length; j++) {
      const d = Math.hypot(trees[i]!.x - trees[j]!.x, trees[i]!.z - trees[j]!.z);
      assert.ok(d >= 9 - 1e-6, `two trees ${d.toFixed(2)} units apart`);
    }
  }
});

test('grove is deterministic, and a different seed plants a different wood', () => {
  const loop = insetLoop(RIM, 8);
  const opts = { loop, clusters: 5, perCluster: [4, 7] as const, spread: 16, minGap: 8 };
  assert.deepEqual(grove({ ...opts, seed: 12 }), grove({ ...opts, seed: 12 }));
  assert.notDeepEqual(grove({ ...opts, seed: 12 }), grove({ ...opts, seed: 13 }));
});

test('grove REFUSES rather than hangs when the request has no solution', () => {
  const loop = insetLoop(RIM, 8);
  // Two hundred trees nine units apart inside one 6-unit stand is unsatisfiable. The contract
  // is FEWER POINTS, returned promptly — a harness page that hangs is indistinguishable from
  // one that crashed, and costs more to diagnose.
  const trees = grove({
    loop,
    clusters: 2,
    perCluster: [200, 200],
    spread: 6,
    minGap: 9,
    seed: 1,
  });
  assert.ok(trees.length < 20, `${trees.length} trees fitted where far fewer can`);
  assert.equal(grove({ loop, clusters: 0, perCluster: [5, 5], spread: 10, minGap: 4 }).length, 0);
});
