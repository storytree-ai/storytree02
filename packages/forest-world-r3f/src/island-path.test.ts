// island-path.test.ts — the canvas-side connector: docks off strip ends, and the worn paths that
// join them across each island.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { SceneG } from '@storytree/forest-world';

import { SHIPPED_COAST, clipToCoast, type CoastPoint, vertexKey } from './coast-clip.js';
import { LAND_SCALE } from './land-per-capability.js';
import { SAND_SHIPPED_BEACH_WIDTH } from './land-sand.js';
import {
  DOCK_REACH,
  PATH_CHAIKIN_PASSES,
  PATH_CONTROL_FRACTIONS,
  PATH_JITTER,
  PATH_PULL,
  PATH_WAYPOINT_FRACTION,
  bearingFrom,
  rimGrid,
  byBearingFrom,
  chaikinOpen,
  controlPoint,
  crossingControls,
  dockOnRim,
  isDockableStrip,
  islandDocks,
  islandPaths,
  islandRims,
  islandSeed,
  pathsBetween,
  perpendicularUnit,
  rimCentroid,
  seededUnit,
  stripEndpoints,
  waypointToward,
} from './island-path.js';
import { landStreamFromDrawing } from './true-ground.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** One square island, `size` units on a side, with a ring. */
function island(id: string, x: number, z: number, size: number): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    group: 'cell-ground',
    island: id,
    transform: { x: x + size / 2, y: 0, z: z + size / 2 },
    points: [
      { x, y: 0, z },
      { x: x + size, y: 0, z },
      { x: x + size, y: 0, z: z + size },
      { x, y: 0, z: z + size },
    ],
  };
}

/** A visible trail strip from `from` to `to`, as the mapper emits one. */
function strip(from: CoastPoint, to: CoastPoint, extra: Partial<InstanceDescriptor> = {}): InstanceDescriptor {
  return {
    kind: 'trail-strip',
    group: 'trail-strip',
    transform: { x: (from.x + to.x) / 2, y: 0, z: (from.z + to.z) / 2 },
    points: [
      { x: from.x, y: 0, z: from.z },
      { x: (from.x + to.x) / 2, y: 0, z: (from.z + to.z) / 2 },
      { x: to.x, y: 0, z: to.z },
    ],
    width: 3,
    usage: 1,
    hidden: false,
    edges: [],
    ...extra,
  };
}

const A = island('isle-a', 0, 0, 40);
const B = island('isle-b', 400, 0, 40);
const CELLS = [A, B];
/** Ends two units OFF isle-a's west and east edges — docks at (0, 20) and (40, 20). */
const WEST = strip({ x: -40, z: 20 }, { x: -2, z: 20 });
const EAST = strip({ x: 80, z: 20 }, { x: 42, z: 20 });
/** Ends two units off isle-b's north edge — a dock at (420, 0). */
const B_NORTH = strip({ x: 420, z: -40 }, { x: 420, z: -2 });

const near = (p: CoastPoint, q: CoastPoint, eps = 1e-9): boolean =>
  Math.abs(p.x - q.x) < eps && Math.abs(p.z - q.z) < eps;

// ---------------------------------------------------------------------------
// The constants
// ---------------------------------------------------------------------------

// ⚠ RENAMED with its assertion (ADR-0596 D2): this was "the dock reach is 1.5x the shipped beach"
// until 2026-09-23, when the real map showed 1.5 refusing 12 of 52 genuine landings. A test whose
// name says 1.5 while it asserts 4 is the stale-prose failure this repo reds a gate for elsewhere.
test('the dock reach is 4x the shipped beach, and the recipe`s shape constants are pinned', () => {
  assert.equal(DOCK_REACH, 4 * SAND_SHIPPED_BEACH_WIDTH);
  // × LAND_SCALE (`land-per-capability.ts`): 36 = 4 × the 9-unit beach judged on the TUNED
  // island; the shipped beach is 9 × LAND_SCALE, and the reach follows it.
  assert.equal(DOCK_REACH, 36 * LAND_SCALE);
  assert.equal(PATH_CHAIKIN_PASSES, 4);
  assert.equal(PATH_PULL, 0.6);
  // × LAND_SCALE: the 7-unit jitter judged on the tuned island, the same fraction of the shipped one.
  assert.equal(PATH_JITTER, 7 * LAND_SCALE);
  assert.equal(PATH_WAYPOINT_FRACTION, 0.5);
  assert.deepEqual([...PATH_CONTROL_FRACTIONS], [0.25, 0.5, 0.75]);
});

// ---------------------------------------------------------------------------
// Rims and centroids
// ---------------------------------------------------------------------------

test('rimCentroid is the plain vertex mean, over every loop', () => {
  assert.deepEqual(rimCentroid([[{ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 40, z: 40 }, { x: 0, z: 40 }]]), { x: 20, z: 20 });
  // Uneven vertex density pulls it — the recipe's mean, not the area centroid.
  assert.deepEqual(rimCentroid([[{ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 30, z: 60 }]]), { x: 10, z: 20 });
  // Two loops are one population.
  assert.deepEqual(rimCentroid([[{ x: 0, z: 0 }], [{ x: 10, z: 20 }]]), { x: 5, z: 10 });
  assert.deepEqual(rimCentroid([]), { x: 0, z: 0 });
});

test('islandRims buckets by island, chains each rim, and skips an island with no loop', () => {
  const rims = islandRims(CELLS);
  assert.deepEqual(rims.map((r) => r.island), ['isle-a', 'isle-b']);
  assert.equal(rims[0]!.loops.length, 1);
  assert.equal(rims[0]!.loops[0]!.length, 4);
  assert.deepEqual(rims[0]!.centroid, { x: 20, z: 20 });
  assert.deepEqual(rims[1]!.centroid, { x: 420, z: 20 });
  // A ringless cell bounds no coast: its island has no rim to dock on.
  const ringless: InstanceDescriptor = { kind: 'cell-ground', group: 'cell-ground', island: 'ghost', transform: { x: 0, y: 0, z: 0 } };
  assert.deepEqual(islandRims([ringless]).map((r) => r.island), []);
  // An unhomed cell has no coast to dock on — `coastalIsland` refuses it, exactly as `shoreField`
  // does — so it appears under no island rather than under the empty string.
  const { island: _dropped, ...homeless } = island('x', 0, 0, 10);
  assert.deepEqual(islandRims([homeless]).map((r) => r.island), []);
});

// ---------------------------------------------------------------------------
// Strip ends and docking
// ---------------------------------------------------------------------------

test('stripEndpoints reads the first and last of the polyline, in the (x, z) basis', () => {
  assert.deepEqual(stripEndpoints(WEST), [{ x: -40, z: 20 }, { x: -2, z: 20 }]);
  const one: InstanceDescriptor = { ...WEST, points: [{ x: 3, y: 9, z: 4 }] };
  assert.deepEqual(stripEndpoints(one), [{ x: 3, z: 4 }], 'a single vertex is one end, not two');
  const { points: _none, ...bare } = WEST;
  assert.deepEqual(stripEndpoints(bare), []);
  assert.deepEqual(stripEndpoints({ ...WEST, points: [] }), []);
});

test('only a VISIBLE trail-strip docks — hidden and ghost strips are not trails ashore', () => {
  assert.equal(isDockableStrip(WEST), true);
  assert.equal(isDockableStrip({ ...WEST, hidden: true }), false);
  assert.equal(isDockableStrip({ ...WEST, kind: 'trail-ghost-strip' }), false);
  const { hidden: _h, ...unflagged } = WEST;
  assert.equal(isDockableStrip(unflagged), true, 'an absent hidden flag is a visible strip');
  // And islandDocks honours it: a hidden copy of WEST contributes no dock.
  const docks = islandDocks(CELLS, [{ ...WEST, hidden: true }, { ...EAST, kind: 'trail-ghost-strip' }]);
  assert.deepEqual(docks.get('isle-a'), []);
});

test('dockOnRim snaps an end within reach onto the nearest rim point, and refuses one past it', () => {
  const grid = rimGrid(islandRims(CELLS)[0]!);
  assert.deepEqual(dockOnRim(grid, { x: -2, z: 20 }), { x: 0, z: 20 });
  // An end INSIDE the island still docks — to the nearest rim point.
  assert.deepEqual(dockOnRim(grid, { x: 5, z: 20 }), { x: 0, z: 20 });
  // An end diagonally off a corner snaps to the corner.
  const corner = dockOnRim(grid, { x: -3, z: -4 })!;
  assert.ok(near(corner, { x: 0, z: 0 }), `snapped to ${corner.x},${corner.z}`);
  // At exactly the reach, and past it: not a dock. (The walk caps at the reach, so exactly-at
  // reads as capped; a strict comparison is what keeps that end off the island.)
  assert.equal(dockOnRim(grid, { x: -DOCK_REACH, z: 20 }), null);
  assert.equal(dockOnRim(grid, { x: -30, z: 20 }), null);
  // Just inside the reach: a dock.
  assert.deepEqual(dockOnRim(grid, { x: -(DOCK_REACH - 0.01), z: 20 }), { x: 0, z: 20 });
  // And ON the rim: the point itself, with no NaN from a zero gradient.
  assert.deepEqual(dockOnRim(grid, { x: 0, z: 20 }), { x: 0, z: 20 });
});

test('islandDocks buckets every strip end to ITS island, snapped, deduplicated, and lists every island', () => {
  const docks = islandDocks(CELLS, [WEST, EAST, B_NORTH]);
  assert.deepEqual([...docks.keys()], ['isle-a', 'isle-b'], 'every rimmed island is present');
  assert.deepEqual(docks.get('isle-a'), [{ x: 0, z: 20 }, { x: 40, z: 20 }]);
  assert.deepEqual(docks.get('isle-b'), [{ x: 420, z: 0 }]);
  // The OFFSHORE ends (40 units out) docked nowhere — only the landward ends count.
  // Two strips arriving at one landing are ONE dock.
  const twice = islandDocks(CELLS, [WEST, strip({ x: -40, z: 60 }, { x: -1, z: 20.04 })]);
  assert.deepEqual(twice.get('isle-a'), [{ x: 0, z: 20 }]);
  // A strip ending far from every island docks nowhere.
  const nowhere = islandDocks(CELLS, [strip({ x: 200, z: 200 }, { x: 200, z: 100 })]);
  assert.deepEqual(nowhere.get('isle-a'), []);
  assert.deepEqual(nowhere.get('isle-b'), []);
  // No strips: every island present, every list empty.
  assert.deepEqual([...islandDocks(CELLS, []).values()], [[], []]);
});

test('fld-a-routed-junction-is-never-a-dock: a shared in-reach end is excluded while a terminal peer docks', () => {
  const rim = [island('junction-rim', 0, 0, 100)];
  // The two strips meet at the same end WELL inside the reach. Moving that end outside the reach
  // would let the current distance-only rule pass, so the third strip is a terminal at the same
  // three-unit offset and must remain the sole landing.
  const shared = { x: -3, z: 50 };
  const docks = islandDocks(rim, [
    strip({ x: -80, z: 30 }, shared),
    strip({ x: -80, z: 70 }, shared),
    strip({ x: 180, z: 50 }, { x: 103, z: 50 }),
  ]);
  assert.deepEqual(docks.get('junction-rim'), [{ x: 100, z: 50 }]);
});

test('fld-a-routed-junction-is-never-a-dock: a GHOST run sharing a landing cannot un-dock it', () => {
  // ⚠ THE JUNCTION RULE READS DOCKABLE STRIPS ONLY, and that guard is load-bearing rather than
  // tidy: an under-island ghost run (ADR-0504 D3) legitimately shares its rim crossing with the
  // visible trail it dives beneath. Counted alongside the visible strips, that coincidence would
  // read as a junction and silently REMOVE a real landing — a ghost the canvas never draws
  // deleting a path it has no business touching. `check:mutation-diff` found this span unguarded
  // by any test; this is the input that separates the two behaviours.
  const rim = [island('ghosted-rim', 0, 0, 100)];
  const landing = { x: 103, z: 50 };
  const visible = strip({ x: 180, z: 50 }, landing);
  const ghost = strip({ x: 40, z: 50 }, landing, { kind: 'trail-ghost-strip', hidden: true });
  assert.deepEqual(islandDocks(rim, [visible, ghost]).get('ghosted-rim'), [{ x: 100, z: 50 }]);
  // A visible peer at the SAME position is a junction, so the fixture is not simply too lenient.
  const peer = strip({ x: 40, z: 50 }, landing);
  assert.deepEqual(islandDocks(rim, [visible, peer]).get('ghosted-rim'), []);
});

test('fld-every-terminal-trail-end-docks-on-the-real-map: every terminal landing in the shipped stream docks on clipped ground', () => {
  const source = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../docs/research/chapter2-real-forest-2026-09-08/scenes/shipped.json', import.meta.url)), 'utf8'),
  ) as { scene: SceneG };
  const stream = landStreamFromDrawing(source.scene);
  const cells = clipToCoast(stream.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground'), SHIPPED_COAST);
  const strips = stream.filter((d): d is InstanceDescriptor => d.kind === 'trail-strip' && d.hidden !== true);
  const ends = new Map<string, CoastPoint[]>();
  for (const strip of strips) {
    for (const end of stripEndpoints(strip)) {
      const key = vertexKey(end);
      ends.set(key, [...(ends.get(key) ?? []), end]);
    }
  }
  const terminals = [...ends.values()].filter((samePosition) => samePosition.length === 1);
  assert.equal(terminals.length, 52, 'the committed export must retain the measured terminal population');

  // ⚠ THE INVENTORY IS ASSERTED TOO (ADR-0596 D5), because losing a SEGMENT and losing a LANDING
  // look identical in a dock count: fewer strips means fewer terminal ends, and both sides of the
  // equality above fall together. These three numbers are what the mapping is supposed to carry
  // through from the routed network, and the export's own manifest records the same 90/103.
  assert.equal(strips.length, 103, 'the shipped export routes 103 visible trail segments');
  assert.equal(
    strips.filter((s) => s.segment !== undefined && (s.edges ?? []).length > 0).length,
    103,
    'every segment keeps its stable id and at least one from->to edge key',
  );
  const edgeKeys = new Set(strips.flatMap((s) => s.edges ?? []));
  assert.equal(edgeKeys.size, 90, 'the 90 routed depends_on edges all survive the mapping');

  const docks = islandDocks(cells, strips);
  const dockCount = [...docks.values()].reduce((count, found) => count + found.length, 0);
  assert.equal(dockCount, terminals.length, 'every terminal landing must reach the clipped map rim');
  // ⚠ AND THE LANDINGS ARE SPREAD, not piled onto a few shores. Before ADR-0596 seven of these
  // islands formed no dock and therefore wore no path at all — the defect a total count alone
  // cannot see, since 52 docks on 28 islands satisfies the equality above just as well.
  assert.equal(docks.size, 35, 'the export carries 35 islands with a rim');
  // ⚠ ONE ISLAND IS STILL SHORT, AND IT IS A DIFFERENT DEFECT — pinned here rather than asserted
  // away. `uat-detail-studio`'s only terminal landing sits 5.29 units off its own rim and 4.43 off
  // `studio-cloud`'s, so the nearest-island rule hands the dock to a shore the trail's edge keys
  // (`uat-criterion-detail->uat-detail-studio`, `studio->uat-detail-studio`) never name. ADR-0504's
  // docstring premise — that two islands are never within one reach of the same end — is false on
  // the real map. Closing it is this lane's next unit; until then the exact shortfall is recorded
  // so it cannot grow unnoticed.
  assert.deepEqual(
    [...docks.entries()].filter(([, found]) => found.length === 0).map(([island]) => island),
    ['uat-detail-studio'],
    'exactly one island is left dockless, by the nearest-island rule rather than by the network',
  );
});

test('islandDocks assigns an end within reach of TWO islands to the NEARER one, on either axis', () => {
  // Two islands one reach apart never occur on the shipped map, which is exactly why this has to
  // be a fixture: the nearest-island search inside `islandDocks` is otherwise never exercised
  // with more than one candidate, and its distance arithmetic could be anything. WEST is
  // [0,40]x[0,40] and EAST is [44,84]x[0,40] — a 4-unit channel, under DOCK_REACH (13.5 ×
  // LAND_SCALE ≈ 5.09, `land-per-capability.ts`), so an end in the channel is within reach of BOTH
  // rims. The far end of every strip is 160 units out.
  // ⚠ THE FIXTURE IS RE-SIZED TO THE SHIPPED REACH, NOT SCALED: its integer coordinates are what
  // let the docks below be asserted EXACTLY (`deepEqual`), and a 10-unit channel against a 5.09
  // reach would leave every end in reach of ONE rim only — the nearer-of-two search unexercised,
  // the test still green. The premise is asserted so it cannot die silently again.
  assert.ok(4 < DOCK_REACH && 3 < DOCK_REACH, `a 4-unit channel is not under the reach ${DOCK_REACH}`);
  const channel = [island('west', 0, 0, 40), island('east', 44, 0, 40)];
  // (43, 20): 3 off WEST's east edge, 1 off EAST's west edge — EAST's dock, at (44, 20). A
  // distance that SUMMED the x ordinates would score WEST 83 and EAST 87 and hand it to WEST.
  const nearerEast = islandDocks(channel, [strip({ x: 42, z: 200 }, { x: 43, z: 20 })]);
  assert.deepEqual(nearerEast.get('east'), [{ x: 44, z: 20 }]);
  assert.deepEqual(nearerEast.get('west'), []);
  // (41, 20): 1 off WEST, 3 off EAST — WEST's dock, at (40, 20). WEST is the FIRST rim, so a
  // search that let every later in-reach candidate overwrite the best would hand this to EAST.
  const nearerWest = islandDocks(channel, [strip({ x: 42, z: 200 }, { x: 41, z: 20 })]);
  assert.deepEqual(nearerWest.get('west'), [{ x: 40, z: 20 }]);
  assert.deepEqual(nearerWest.get('east'), []);
  // The same on the OTHER axis: NORTH is [0,40]x[0,40], SOUTH is [0,40]x[44,84]; (20, 43) is 3
  // off NORTH's south edge and 1 off SOUTH's north edge — SOUTH's dock, at (20, 44). A distance
  // that summed the z ordinates would score NORTH 83 and SOUTH 87.
  const stacked = [island('north', 0, 0, 40), island('south', 0, 44, 40)];
  const nearerSouth = islandDocks(stacked, [strip({ x: 200, z: 42 }, { x: 20, z: 43 })]);
  assert.deepEqual(nearerSouth.get('south'), [{ x: 20, z: 44 }]);
  assert.deepEqual(nearerSouth.get('north'), []);
  // Out of reach of both: no dock anywhere, and every island still listed.
  const none = islandDocks(channel, [strip({ x: 42, z: 200 }, { x: 42, z: 100 })]);
  assert.deepEqual([...none.entries()], [['west', []], ['east', []]]);
});

test('islandDocks breaks an EXACT tie between two islands in favour of the FIRST rim', () => {
  // (45, 20) is exactly 5 from WEST's east edge and exactly 5 from EAST's west edge. The search
  // rejects a candidate at `d >= best`, so an equal LATER candidate never replaces the first;
  // rejecting only at `d > best` would hand the tie to EAST.
  // The premise a tie needs: 5 is still under DOCK_REACH (13.5 × LAND_SCALE ≈ 5.09), so the end is
  // within reach of BOTH rims. Asserted, because a reach under 5 would leave the tie untested.
  assert.ok(5 < DOCK_REACH, `a 5-unit tie is out of the reach ${DOCK_REACH}`);
  const channel = [island('west', 0, 0, 40), island('east', 50, 0, 40)];
  const tied = islandDocks(channel, [strip({ x: 45, z: 200 }, { x: 45, z: 20 })]);
  assert.deepEqual(tied.get('west'), [{ x: 40, z: 20 }]);
  assert.deepEqual(tied.get('east'), []);
  // The premise: the tie really is EXACT in floating point (axis-aligned edges, parameter 0.5),
  // so the assertion above is about the comparison and not about a rounding accident.
  const rims = islandRims(channel);
  const west = dockOnRim(rimGrid(rims[0]!), { x: 45, z: 20 })!;
  const east = dockOnRim(rimGrid(rims[1]!), { x: 45, z: 20 })!;
  assert.deepEqual(west, { x: 40, z: 20 });
  assert.deepEqual(east, { x: 50, z: 20 });
  assert.equal(Math.hypot(west.x - 45, west.z - 20), 5);
  assert.equal(Math.hypot(east.x - 45, east.z - 20), 5);
});

// ---------------------------------------------------------------------------
// The three path shapes
// ---------------------------------------------------------------------------

test('0 docks -> no path; 1 dock -> dock -> waypoint -> centroid, smoothed', () => {
  // The empty case has NO guard of its own (`pathsBetween` says why): this assertion is what
  // pins it, so it stays even though nothing in the function names it.
  assert.deepEqual(pathsBetween([], { x: 20, z: 20 }, 1), []);
  const paths = pathsBetween([{ x: 0, z: 20 }], { x: 20, z: 20 }, islandSeed('isle-a'));
  assert.equal(paths.length, 1);
  const path = paths[0]!;
  // Three control points, four passes: 3 -> 6 -> 12 -> 24 -> 48.
  assert.equal(path.length, 48);
  assert.deepEqual(path[0], { x: 0, z: 20 }, 'starts ON the dock');
  assert.deepEqual(path[path.length - 1], { x: 20, z: 20 }, 'ends AT the centroid');
  // And it is not the radial line: the waypoint carried a sideways nudge.
  assert.ok(path.some((p) => Math.abs(p.z - 20) > 0.5), 'the way in is a straight radial line');
});

test('2 docks -> ONE crossing, coast -> interior -> coast, ordered by bearing from the centroid', () => {
  const paths = pathsBetween([{ x: 0, z: 20 }, { x: 40, z: 20 }], { x: 20, z: 20 }, islandSeed('isle-a'));
  assert.equal(paths.length, 1);
  const path = paths[0]!;
  // Five control points, four passes: 5 -> 10 -> 20 -> 40 -> 80.
  assert.equal(path.length, 80);
  // Bearing from (20,20): (40,20) is 0 rad, (0,20) is pi — so the crossing runs east to west.
  assert.deepEqual(path[0], { x: 40, z: 20 });
  assert.deepEqual(path[79], { x: 0, z: 20 });
  // It bows through the interior and never leaves the island: every point inside the square.
  for (const p of path) {
    assert.ok(p.x >= 0 && p.x <= 40 && p.z >= 0 && p.z <= 40, `(${p.x}, ${p.z}) left the island`);
  }
  // And it is NOT the straight chord: the jitter moved it off z = 20 somewhere.
  assert.ok(path.some((p) => Math.abs(p.z - 20) > 1), 'the crossing is a straight chord');
});

test('3+ docks -> each CONSECUTIVE pair by bearing is joined, n-1 crossings', () => {
  const docks: CoastPoint[] = [{ x: 20, z: 0 }, { x: 0, z: 20 }, { x: 40, z: 20 }, { x: 20, z: 40 }];
  const paths = pathsBetween(docks, { x: 20, z: 20 }, 99);
  assert.equal(paths.length, 3);
  // Bearings from (20,20): (40,20) 0, (20,40) pi/2, (0,20) pi, (20,0) -pi/2 — ascending order is
  // (20,0), (40,20), (20,40), (0,20).
  assert.deepEqual(paths[0]![0], { x: 20, z: 0 });
  assert.deepEqual(paths[0]![79], { x: 40, z: 20 });
  assert.deepEqual(paths[1]![0], { x: 40, z: 20 });
  assert.deepEqual(paths[1]![79], { x: 20, z: 40 });
  assert.deepEqual(paths[2]![0], { x: 20, z: 40 });
  assert.deepEqual(paths[2]![79], { x: 0, z: 20 });
});

test('⚠ THE CONSERVATION LAW: every path starts and ends on a dock or the centroid', () => {
  const strips = [WEST, EAST, B_NORTH, strip({ x: 20, z: 80 }, { x: 20, z: 42 })];
  const docks = islandDocks(CELLS, strips);
  const paths = islandPaths(CELLS, strips);
  const rims = new Map(islandRims(CELLS).map((r) => [r.island, r.centroid]));
  let checked = 0;
  for (const [id, own] of paths) {
    const allowed = [...docks.get(id)!, rims.get(id)!];
    for (const path of own) {
      const first = path[0]!;
      const last = path[path.length - 1]!;
      assert.ok(allowed.some((p) => near(p, first)), `${id}: a path starts at (${first.x}, ${first.z})`);
      assert.ok(allowed.some((p) => near(p, last)), `${id}: a path ends at (${last.x}, ${last.z})`);
      checked += 1;
    }
  }
  // isle-a has three docks -> two crossings; isle-b has one -> one path in.
  assert.equal(checked, 3, 'the fixture was meant to exercise both shapes');
  assert.equal(paths.get('isle-a')!.length, 2);
  assert.equal(paths.get('isle-b')!.length, 1);
});

test('islandPaths is DETERMINISTIC, and different islands wear different crossings', () => {
  const strips = [WEST, EAST];
  assert.deepEqual(islandPaths(CELLS, strips), islandPaths(CELLS, strips));
  // The same two docks on an island with a different id: same endpoints, different interior.
  const a = pathsBetween([{ x: 0, z: 20 }, { x: 40, z: 20 }], { x: 20, z: 20 }, islandSeed('isle-a'))[0]!;
  const b = pathsBetween([{ x: 0, z: 20 }, { x: 40, z: 20 }], { x: 20, z: 20 }, islandSeed('isle-b'))[0]!;
  assert.deepEqual(a[0], b[0]);
  assert.deepEqual(a[79], b[79]);
  assert.notDeepEqual(a[40], b[40], 'two islands wore the identical crossing — the seed is not per island');
  // An island with no docks has an EMPTY path list, present in the map.
  assert.deepEqual(islandPaths(CELLS, [WEST]).get('isle-b'), []);
});

// ---------------------------------------------------------------------------
// The arithmetic, pinned
// ---------------------------------------------------------------------------

test('chaikinOpen keeps both endpoints, doubles the count per pass, and cuts at 1/4 and 3/4', () => {
  const line: CoastPoint[] = [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 10, z: 10 }];
  assert.deepEqual(chaikinOpen(line, 1), [
    { x: 0, z: 0 },
    { x: 2.5, z: 0 },
    { x: 7.5, z: 0 },
    { x: 10, z: 2.5 },
    { x: 10, z: 7.5 },
    { x: 10, z: 10 },
  ]);
  assert.equal(chaikinOpen(line, 4).length, 48);
  assert.deepEqual(chaikinOpen(line, 4)[0], { x: 0, z: 0 });
  assert.deepEqual(chaikinOpen(line, 4)[47], { x: 10, z: 10 });
  assert.deepEqual(chaikinOpen(line, 0), line);
  // A two-point line IS cut — one segment, its quarter points inserted.
  assert.deepEqual(chaikinOpen([{ x: 0, z: 0 }, { x: 40, z: 0 }], 1), [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 30, z: 0 },
    { x: 40, z: 0 },
  ]);
  // Fewer than two points cannot be cut and come back as they are.
  assert.deepEqual(chaikinOpen([{ x: 3, z: 4 }], 4), [{ x: 3, z: 4 }]);
  assert.deepEqual(chaikinOpen([], 4), []);
});

test('controlPoint: chord point, pulled toward the centroid, then jittered across the chord', () => {
  // a=(0,0), b=(40,0), centroid (20,20), f=0.25: chord point (10,0); pulled 0.6 of the way to
  // the centroid: (16, 12); then 2 units along n=(0,1): (16, 14).
  assert.deepEqual(controlPoint({ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 20, z: 20 }, 0.25, { x: 0, z: 1 }, 2), { x: 16, z: 14 });
  // f=0.75 lands on the other side of the chord's middle.
  assert.deepEqual(controlPoint({ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 20, z: 20 }, 0.75, { x: 0, z: 1 }, 0), { x: 24, z: 12 });
  // A negative jitter goes the other way along n.
  assert.deepEqual(controlPoint({ x: 0, z: 0 }, { x: 40, z: 0 }, { x: 20, z: 20 }, 0.5, { x: 0, z: 1 }, -3), { x: 20, z: 9 });
});

test('crossingControls: three points, each within PATH_JITTER of its pulled chord point', () => {
  const a = { x: 0, z: 20 };
  const b = { x: 40, z: 20 };
  const c = { x: 20, z: 20 };
  const ctrl = crossingControls(a, b, c, islandSeed('isle-a'), 0);
  assert.equal(ctrl.length, 3);
  const n = perpendicularUnit(a, b);
  ctrl.forEach((p, k) => {
    const f = PATH_CONTROL_FRACTIONS[k]!;
    const unjittered = controlPoint(a, b, c, f, n, 0);
    const off = Math.hypot(p.x - unjittered.x, p.z - unjittered.z);
    assert.ok(off <= PATH_JITTER, `control ${k} is ${off} off its chord point`);
    // And it IS jittered by exactly the seeded amount, so the seed reaches the point.
    const expected = controlPoint(a, b, c, f, n, PATH_JITTER * seededUnit(islandSeed('isle-a'), k));
    assert.deepEqual(p, expected);
  });
  // A second pair on the same island draws the NEXT three seeded values, not the same three.
  const second = crossingControls(a, b, c, islandSeed('isle-a'), 1);
  assert.notDeepEqual(second, ctrl);
  assert.deepEqual(second[0], controlPoint(a, b, c, 0.25, n, PATH_JITTER * seededUnit(islandSeed('isle-a'), 3)));
});

test('waypointToward sits halfway in, nudged by the seed`s first draw', () => {
  const dock = { x: 0, z: 20 };
  const c = { x: 20, z: 20 };
  const w = waypointToward(dock, c, islandSeed('isle-a'));
  const n = perpendicularUnit(dock, c);
  const j = PATH_JITTER * seededUnit(islandSeed('isle-a'), 0);
  assert.deepEqual(w, { x: 10 + n.x * j, z: 20 + n.z * j });
  assert.ok(Math.abs(w.z - 20) > 0.5, 'the nudge must actually move it off the radial');
});

test('waypointToward: the literal point for a dock at (10, 4), a centroid at (30, 24), seed 7', () => {
  // The fixture above has the dock on the centroid's own z and n.x = -0, so every z-blend and
  // every x-nudge slip is invisible there. Here nothing cancels. Halfway in is (20, 14); across
  // the chord is n = (-1, 1) / sqrt2; the seed's first draw is 0.9274821188300848 (pinned
  // below), so the nudge is j = 7 * 0.92748... = 6.492374831810594 TUNED units along n, and the
  // point is (20 - j / sqrt2, 14 + j / sqrt2) = (15.409197730421859, 18.59080226957814) there.
  // × LAND_SCALE (`land-per-capability.ts`): PATH_JITTER is 7 × LAND_SCALE, so the LITERAL nudge
  // is 6.492374831810594 × LAND_SCALE — the pinned magnitude stays the pin, scaled once.
  const dock = { x: 10, z: 4 };
  const c = { x: 30, z: 24 };
  const w = waypointToward(dock, c, 7);
  const tunedNudge = 6.492374831810594 * LAND_SCALE;
  assert.ok(
    near(w, { x: 20 - tunedNudge / Math.SQRT2, z: 14 + tunedNudge / Math.SQRT2 }, 1e-12),
    `got (${w.x}, ${w.z})`,
  );
  // Taking the nudge back off leaves the halfway point — in BOTH axes, so a sign or an operator
  // slip in either ordinate's blend, or in the nudge's own sign or scale, lands somewhere else
  // (each of those is off by at least a tenth of a unit; the tolerance here is 1e-9).
  const j = PATH_JITTER * seededUnit(7, 0);
  const n = perpendicularUnit(dock, c);
  assert.ok(near({ x: w.x - n.x * j, z: w.z - n.z * j }, { x: 20, z: 14 }), `un-nudged (${w.x - n.x * j}, ${w.z - n.z * j})`);
  // The premises: the draw the literal was computed from, and that the nudge is neither zero nor
  // of unit size — the two magnitudes at which scaling by `/ j` would coincide with `* j`.
  assert.equal(seededUnit(7, 0), 0.9274821188300848);
  assert.ok(Math.abs(j) > 1 && n.x !== 0, `j = ${j}, n.x = ${n.x}`);
});

test('controlPoint: literal points for a chord with all-positive, non-symmetric ends', () => {
  // a = (10, 4), b = (50, 28), centroid (40, 30), f = 0.25 — chosen so nothing cancels: a's
  // ordinates are non-zero (so b - a and b + a differ), the chord has a z extent (so the z blend
  // has a value to get wrong), and n = (0.6, -0.8) has a non-zero x (so the jitter's x sign is
  // visible). Chord point: (10 + 40 * 0.25, 4 + 24 * 0.25) = (20, 10). Pulled 0.6 of the way to
  // the centroid: (20 + 20 * 0.6, 10 + 20 * 0.6) = (32, 22). Then 5 along n: (35, 18). Every
  // product here is exact in floating point, so these are equalities, not tolerances.
  const a = { x: 10, z: 4 };
  const b = { x: 50, z: 28 };
  const c = { x: 40, z: 30 };
  const n = { x: 0.6, z: -0.8 };
  assert.deepEqual(controlPoint(a, b, c, 0.25, n, 0), { x: 32, z: 22 });
  const p = controlPoint(a, b, c, 0.25, n, 5);
  assert.deepEqual(p, { x: 35, z: 18 });
  // Taking the jitter back off lands EXACTLY on the pulled chord point in BOTH axes.
  assert.deepEqual({ x: p.x - n.x * 5, z: p.z - n.z * 5 }, { x: 32, z: 22 });
});

test('perpendicularUnit is a unit vector across the chord, and zero for a degenerate chord', () => {
  assert.deepEqual(perpendicularUnit({ x: 0, z: 0 }, { x: 40, z: 0 }), { x: -0, z: 1 });
  const p = perpendicularUnit({ x: 1, z: 1 }, { x: 4, z: 5 });
  assert.ok(Math.abs(Math.hypot(p.x, p.z) - 1) < 1e-12);
  assert.ok(Math.abs(p.x * 3 + p.z * 4) < 1e-12, 'not perpendicular to the chord');
  assert.deepEqual(perpendicularUnit({ x: 2, z: 3 }, { x: 2, z: 3 }), { x: 0, z: 0 });
});

test('bearingFrom is atan2(dz, dx), and byBearingFrom sorts ascending by it', () => {
  const c = { x: 20, z: 20 };
  assert.equal(bearingFrom(c, { x: 40, z: 20 }), 0);
  assert.equal(bearingFrom(c, { x: 20, z: 40 }), Math.PI / 2);
  assert.equal(bearingFrom(c, { x: 0, z: 20 }), Math.PI);
  assert.equal(bearingFrom(c, { x: 20, z: 0 }), -Math.PI / 2);
  const sorted = [{ x: 0, z: 20 }, { x: 40, z: 20 }, { x: 20, z: 0 }, { x: 20, z: 40 }].sort(byBearingFrom(c));
  assert.deepEqual(sorted, [{ x: 20, z: 0 }, { x: 40, z: 20 }, { x: 20, z: 40 }, { x: 0, z: 20 }]);
  assert.ok(byBearingFrom(c)({ x: 40, z: 20 }, { x: 20, z: 40 }) < 0);
});

test('islandSeed is FNV-1a over the id, pinned; seededUnit stays in [-1, 1) and is pinned', () => {
  assert.equal(islandSeed(''), 2166136261, 'the FNV offset basis on an empty id');
  assert.equal(islandSeed('a'), 3826002220);
  assert.equal(islandSeed('isle-a'), 2830540860);
  assert.notEqual(islandSeed('isle-a'), islandSeed('isle-b'));
  assert.deepEqual(
    [0, 1, 2].map((k) => seededUnit(7, k)),
    [0.9274821188300848, 0.3517137449234724, -0.21776574337854981],
  );
  let lo = 1;
  let hi = -1;
  for (let k = 0; k < 5000; k += 1) {
    const u = seededUnit(12345, k);
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
  }
  assert.ok(lo >= -1 && hi < 1, `range [${lo}, ${hi}]`);
  assert.ok(lo < -0.9 && hi > 0.9, 'the draws should cover the interval, not cluster');
});
