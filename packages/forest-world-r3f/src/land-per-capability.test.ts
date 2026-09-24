// land-per-capability.test.ts — the island's size from a declared ratio, held without a GPU.
//
// What has to hold: the constant carries its provenance in arithmetic (the recipe's own density
// agrees with the rung the owner's nicer picture gave, in the true basis); every island's scaled
// area is EXACTLY its capability count times the ratio; the scale is isotropic and about the
// island's own centre, so the layout holds still; an island with nothing to derive a size from is
// left as drawn; the mapper applies the shipped ratio by default and a `null` leaves the drawing's
// size; and the tuned reference is the fixture island the constants were judged on.

import assert from 'node:assert/strict';
import test from 'node:test';

import { HEX_R, LAND_AREA_PER_CAPABILITY as ENGINE_RATIO, PRE_ADR0528_TILE } from '@storytree/forest-world';

import { RECIPE_ISLAND_AREA } from './dressing-ground.js';
import {
  HEX_TILE_AREA,
  LAND_AREA_PER_CAPABILITY,
  LAND_FLOOR_CAPABILITIES,
  LAND_AREA_PER_CAPABILITY_RUNGS,
  LAND_SCALE,
  MAX_LAND_FACTOR,
  TUNED_FIXTURE,
  TUNED_LAND_AREA_PER_CAPABILITY,
  islandLand,
  islandSizeInversions,
  landRatioFactor,
  ringArea,
  sizeIslandsByCapability,
} from './land-per-capability.js';
import { islandCentres } from './true-footprint.js';
import type { Descriptor3D, InstanceDescriptor } from './world-to-3d.js';

/** A square cell of side `side` centred at (cx, cz) on island `island`, in parcel `parcel`. */
function cell(island: string, parcel: string | undefined, cx: number, cz: number, side = 20): InstanceDescriptor {
  const h = side / 2;
  const d: InstanceDescriptor = {
    kind: 'cell-ground',
    transform: { x: cx, y: 0, z: cz },
    group: 'cell-ground',
    material: 'healthy',
    island,
    points: [
      { x: cx - h, y: 0, z: cz - h },
      { x: cx + h, y: 0, z: cz - h },
      { x: cx + h, y: 0, z: cz + h },
      { x: cx - h, y: 0, z: cz + h },
    ],
  };
  if (parcel !== undefined) d.parcel = parcel;
  return d;
}

const asInstance = (d: Descriptor3D): d is InstanceDescriptor => d.kind !== 'skipped';

/** The x/z extent of a set of descriptors' rings. */
function extent(ds: readonly InstanceDescriptor[]) {
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

test('⚠⚠ the constant carries its provenance: the approved render’s own density, in the TRUE basis, is the 318 rung — and the shipped pick is a rung of the declared ladder', () => {
  // Thirteen stands of 4–8 pines, mean six, on the recipe island as this map places it (true basis).
  const recipePines = 13 * 6;
  // `RECIPE_ISLAND_AREA` is the recipe island THROUGH the shipped mapper (× LAND_SCALE²); its
  // density is read on the island AS DRAWN, which is where the recipe's own 78 pines stood.
  assert.equal(RECIPE_ISLAND_AREA, TUNED_FIXTURE.capabilities * LAND_AREA_PER_CAPABILITY, 'the recipe island through the shipped mapper, exactly');
  const recipeDrawnArea = RECIPE_ISLAND_AREA / (LAND_SCALE * LAND_SCALE);
  assert.ok(Math.abs(recipeDrawnArea - 24631.8) / 24631.8 < 0.001, `${recipeDrawnArea} — the drawn island, to the coast's 0.04%`);
  const recipeDensity = recipeDrawnArea / recipePines;
  assert.ok(Math.abs(recipeDensity - 318) / 318 < 0.02, `the recipe stands a pine on ${recipeDensity.toFixed(1)} units²; the rung is 318`);
  // The increment's 108 is the same recipe read through the drawing's foreshortening (the squashed
  // basis, 8,424.6): stated so nobody promotes it to a second approved density.
  const squashedDensity = 8424.6 / recipePines;
  assert.ok(Math.abs(squashedDensity - 108) < 1, `${squashedDensity.toFixed(1)}`);
  assert.deepEqual([...LAND_AREA_PER_CAPABILITY_RUNGS], [318, 200, 108]);
  assert.ok((LAND_AREA_PER_CAPABILITY_RUNGS as readonly number[]).includes(LAND_AREA_PER_CAPABILITY), 'the shipped pick is a rendered rung');
  for (let i = 1; i < LAND_AREA_PER_CAPABILITY_RUNGS.length; i += 1) {
    assert.ok(LAND_AREA_PER_CAPABILITY_RUNGS[i]! < LAND_AREA_PER_CAPABILITY_RUNGS[i - 1]!, 'the ladder descends — each rung is less land per tree');
  }
});

test('the tuned reference is the fixture island: thirteen regular hexes of the PRE-ADR-0528 tile over eleven capabilities, ≈ 2,238.4 units² each — and LAND_SCALE is the edge-to-edge factor to the shipped rung', () => {
  // ⚠ The basis is FROZEN on the tile the constants were tuned on, not the engine's live tile: the
  // engine's HEX_R follows the ratio since ADR-0528 (≈ 11.06), and had this read it, LAND_SCALE
  // would have jumped to ~0.93 and every band on the shipped island with it.
  assert.equal(PRE_ADR0528_TILE.hexR, 27);
  assert.ok(HEX_R < PRE_ADR0528_TILE.hexR, `the engine's tile (${HEX_R}) is derived and smaller than the tuned one`);
  assert.equal(LAND_AREA_PER_CAPABILITY, ENGINE_RATIO, 'one ratio, declared in the engine and re-exported here');
  assert.ok(Math.abs(HEX_TILE_AREA - 1894.0) < 0.01, `${HEX_TILE_AREA}`);
  assert.deepEqual(TUNED_FIXTURE, { tiles: 13, capabilities: 11 });
  assert.ok(Math.abs(TUNED_LAND_AREA_PER_CAPABILITY - 2238.36) < 0.01, `${TUNED_LAND_AREA_PER_CAPABILITY}`);
  // Thirteen hexes IS the recipe island in this map's placement units (ADR-0517's consequences).
  assert.ok(Math.abs(HEX_TILE_AREA * 13 - 24631.8) / 24631.8 < 0.001, 'thirteen ideal hexes are the drawn recipe island to 0.04%');
  assert.ok(Math.abs(LAND_SCALE - Math.sqrt(LAND_AREA_PER_CAPABILITY / TUNED_LAND_AREA_PER_CAPABILITY)) < 1e-12);
  assert.ok(LAND_SCALE > 0 && LAND_SCALE < 1, `the shipped island is smaller than the tuned one, edge to edge: ${LAND_SCALE}`);
  assert.ok(Math.abs(LAND_SCALE - 0.3769) < 5e-4, `${LAND_SCALE}`);
});

test('ringArea is the shoelace, absolute, and zero under three points', () => {
  assert.equal(ringArea([]), 0);
  assert.equal(ringArea([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]), 0);
  const square = cell('i', 'p', 5, 5, 4).points!;
  assert.equal(ringArea(square), 16);
  assert.equal(ringArea([...square].reverse()), 16, 'winding does not sign it');
  const tri = [{ x: 0, y: 0, z: 0 }, { x: 4, y: 0, z: 0 }, { x: 0, y: 0, z: 3 }];
  assert.equal(ringArea(tri), 6);
});

test('islandLand counts DISTINCT parcels per island and sums the rings’ areas; a cell naming no parcel adds land and no capability', () => {
  const stream = [
    cell('a', 'a/p1', 0, 0),
    cell('a', 'a/p1', 20, 0),
    cell('a', 'a/p2', 40, 0),
    cell('a', undefined, 60, 0),
    cell('b', 'b/p1', 500, 0, 10),
    { kind: 'skipped', sceneKind: 'x' } as Descriptor3D,
    { kind: 'uat-bloom', transform: { x: 0, y: 0, z: 0 }, group: 'g', island: 'a' } as InstanceDescriptor,
  ];
  const land = islandLand(stream);
  assert.deepEqual([...land.keys()], ['a', 'b']);
  assert.deepEqual(land.get('a'), { island: 'a', capabilities: 2, area: 1600 });
  assert.deepEqual(land.get('b'), { island: 'b', capabilities: 1, area: 100 });
  const none = cell('c', undefined, 0, 0);
  assert.deepEqual(islandLand([none]).get('c'), { island: 'c', capabilities: 0, area: 400 });
  // ⚠ ONLY CELLS COUNT. A ribbon with a ring's worth of points and a stray `parcel` on island `a`
  // adds neither land nor a capability — the island's size is a reading of its ground alone.
  const ribbon: InstanceDescriptor = {
    kind: 'trail-strip',
    transform: { x: 0, y: 0, z: 0 },
    group: 'g',
    island: 'a',
    parcel: 'a/not-a-parcel',
    points: cell('a', 'a/p9', 100, 100, 40).points!,
  };
  assert.deepEqual(islandLand([...stream, ribbon]).get('a'), { island: 'a', capabilities: 2, area: 1600 });
  // A cell that lost its ring still names its capability and adds no land.
  const ringless = { ...cell('d', 'd/p', 0, 0) };
  delete ringless.points;
  assert.deepEqual(islandLand([ringless]).get('d'), { island: 'd', capabilities: 1, area: 0 });
  assert.equal(islandLand([]).size, 0);
  const noIsland = { ...cell('x', 'x/p', 0, 0) };
  delete noIsland.island;
  assert.equal(islandLand([noIsland]).size, 0, 'a cell on no island contributes to no island');
});

test('landRatioFactor: √(capabilities × ratio / area), so the scaled area is exactly capabilities × ratio; no land to derive from ⇒ 1; a bad ratio refuses', () => {
  const land = { island: 'a', capabilities: 4, area: 1600 };
  assert.equal(landRatioFactor(land, 400), 1, 'already at the ratio');
  assert.equal(landRatioFactor(land, 100), 0.5);
  assert.equal(landRatioFactor(land, 1600), 2);
  const f = landRatioFactor(land, 318);
  assert.ok(Math.abs(f * f * 1600 - 4 * 318) < 1e-9);
  assert.equal(landRatioFactor({ island: 'a', capabilities: 3, area: 0 }, 318), 1);
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.throws(() => landRatioFactor(land, bad), /positive finite number/);
  }
  // ⚠ A FACTOR PAST 100× EITHER WAY IS REFUSED AS ARITHMETIC, not drawn: the same 1600-unit²
  // island asked for 10,000,000 per capability, or for 0.01, is not a size.
  assert.ok(Math.abs(landRatioFactor(land, 1600 * 99 * 99 / 4) - 99) < 1e-9, 'ninety-nine times is still a size');
  // The cap is inclusive: EXACTLY a hundred times, either way, is still a size.
  assert.equal(landRatioFactor(land, (1600 * 100 * 100) / 4), 100);
  assert.equal(landRatioFactor(land, 1600 / (4 * 100 * 100)), 0.01);
  assert.throws(() => landRatioFactor(land, 1600 * 101 * 101 / 4), /past 100× either way/);
  assert.throws(() => landRatioFactor(land, 1600 / (4 * 101 * 101)), /past 100× either way/);
  assert.equal(MAX_LAND_FACTOR, 100);
});

test('⚠⚠ THE FLOOR: an island holding NO capability is sized as ONE — the owner’s "no capabilities should just be 1 hex which should be the minimum" — and a floor of 0 is the rule as it stood', () => {
  assert.equal(LAND_FLOOR_CAPABILITIES, 1);
  const none = { island: 'bare', capabilities: 0, area: 1600 };
  // Sized as one: √(1 × 400 / 1600) = 0.5, so the scaled area is exactly one capability's worth.
  assert.equal(landRatioFactor(none, 400), 0.5);
  assert.equal(landRatioFactor(none, 400, LAND_FLOOR_CAPABILITIES), 0.5, 'the default IS the shipped floor');
  assert.equal(landRatioFactor(none, 400, 1), 0.5);
  // The floor is a floor: an island holding MORE than it is unchanged by it.
  const four = { island: 'a', capabilities: 4, area: 1600 };
  assert.equal(landRatioFactor(four, 100, 1), 0.5);
  assert.equal(landRatioFactor(four, 100, 0), 0.5);
  assert.equal(landRatioFactor(four, 100, 4), 0.5, 'a floor equal to the count is the count');
  // A floor ABOVE the count lifts it: a one-capability island floored at 2 is sized as two.
  assert.equal(landRatioFactor({ island: 'a', capabilities: 1, area: 1600 }, 200, 2), 0.5);
  // ⚠ ZERO IS THE MAP AS IT STOOD — the comparison page's control: nothing to count, left as drawn.
  assert.equal(landRatioFactor(none, 400, 0), 1);
  // No land is still no reading, whatever the floor.
  assert.equal(landRatioFactor({ island: 'a', capabilities: 0, area: 0 }, 318), 1);
  assert.equal(landRatioFactor({ island: 'a', capabilities: 0, area: 0 }, 318, 0), 1);
  // A garbage floor refuses rather than sizing an island as minus-one capabilities.
  for (const bad of [-1, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
    assert.throws(() => landRatioFactor(none, 400, bad), /non-negative finite number of capabilities/);
  }
  // And the floor is well inside the refusal: a three-tile zero-capability island of today's
  // drawing (≈ 5,682 units²) sized to 318 is a factor of 0.237, nowhere near 1/100.
  const drawnToday = 3 * HEX_TILE_AREA;
  const f = landRatioFactor({ island: 'website', capabilities: 0, area: drawnToday }, LAND_AREA_PER_CAPABILITY);
  assert.ok(Math.abs(f - Math.sqrt(LAND_AREA_PER_CAPABILITY / drawnToday)) < 1e-12, `${f}`);
  assert.ok(f > 1 / MAX_LAND_FACTOR && f < 1);
});

test('⚠⚠ THE INVARIANT THE FLOOR EXISTS FOR: on today’s drawing, no island with fewer capabilities is drawn larger than one with more — and without the floor, the zero-capability island outsizes everything up to six', () => {
  // Today's 2D drawing gives a story `max(3, capabilities + 2)` tiles of the radius-27 lattice —
  // the drawing the mapper receives until ADR-0528's tile lands. One square cell per island of that
  // area, at capability counts spanning the real corpus (0 … 26).
  const counts = [0, 1, 2, 3, 4, 6, 7, 11, 16, 26];
  const drawn = counts.flatMap((caps, i) => {
    const area = Math.max(3, caps + 2) * HEX_TILE_AREA;
    const side = Math.sqrt(area);
    const cells = [cell(`isle-${caps}`, undefined, i * 1000, 0, side)];
    // `caps` distinct parcels, each a tiny cell so the area is the big cell's to within a rounding.
    for (let k = 0; k < caps; k += 1) cells.push(cell(`isle-${caps}`, `isle-${caps}/p${k}`, i * 1000, 0, 1e-3));
    return cells;
  });
  const drawnLand = islandLand(drawn);
  assert.equal(drawnLand.get('isle-0')!.capabilities, 0);
  assert.equal(drawnLand.get('isle-26')!.capabilities, 26);
  // AS DRAWN the zero-capability island is the size of a one-capability one (both three tiles) —
  // the drawing's own floor.
  assert.ok(Math.abs(drawnLand.get('isle-0')!.area - drawnLand.get('isle-1')!.area) < 1e-6);

  // THE RULE AS IT STOOD (floor 0): the zero-capability island is left at three tiles while every
  // other shrinks to its ratio — it is larger than every island up to six capabilities.
  const before = islandLand(sizeIslandsByCapability(drawn, LAND_AREA_PER_CAPABILITY, 0));
  assert.ok(Math.abs(before.get('isle-0')!.area - 3 * HEX_TILE_AREA) < 1e-6, 'left as drawn');
  const inverted = islandSizeInversions(before.values());
  assert.deepEqual(
    inverted.map((p) => [p.smaller.capabilities, p.larger.capabilities]),
    [[0, 1], [0, 2], [0, 3], [0, 4], [0, 6], [0, 7], [0, 11], [0, 16]],
    'the zero-capability island outsizes everything up to sixteen capabilities',
  );
  assert.ok(before.get('isle-0')!.area / before.get('isle-1')!.area > 17, `${before.get('isle-0')!.area / before.get('isle-1')!.area}× the one-capability island`);

  // WITH THE FLOOR: every island is exactly max(1, capabilities) × the ratio, so the areas are
  // non-decreasing in capability count and the zero-capability island EQUALS the one-capability one.
  const after = islandLand(sizeIslandsByCapability(drawn, LAND_AREA_PER_CAPABILITY));
  assert.deepEqual(islandSizeInversions(after.values()), []);
  for (const caps of counts) {
    assert.ok(Math.abs(after.get(`isle-${caps}`)!.area - Math.max(LAND_FLOOR_CAPABILITIES, caps) * LAND_AREA_PER_CAPABILITY) < 1e-6, `${caps}`);
  }
  assert.ok(Math.abs(after.get('isle-0')!.area - after.get('isle-1')!.area) < 1e-6);
  const sorted = counts.map((caps) => after.get(`isle-${caps}`)!.area);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i]! >= sorted[i - 1]! - 1e-6);
  // ⚠ ADR-0528 (the tile follows the ratio, one hex per capability, `max(1, caps)` tiles) is what
  // makes the 2D drawing itself obey this; the mapper obeys it today on either drawing, because the
  // floor is written in the ratio's terms rather than in today's tile. On a one-hex-per-capability
  // drawing every factor is ~1 and the invariant still holds exactly.
  const derivedTile = counts.flatMap((caps, i) => {
    const area = Math.max(1, caps) * LAND_AREA_PER_CAPABILITY;
    const side = Math.sqrt(area);
    const cells = [cell(`isle-${caps}`, undefined, i * 1000, 0, side)];
    for (let k = 0; k < caps; k += 1) cells.push(cell(`isle-${caps}`, `isle-${caps}/p${k}`, i * 1000, 0, 1e-3));
    return cells;
  });
  const onDerived = islandLand(sizeIslandsByCapability(derivedTile, LAND_AREA_PER_CAPABILITY));
  assert.deepEqual(islandSizeInversions(onDerived.values()), []);
  assert.ok(Math.abs(onDerived.get('isle-0')!.area - LAND_AREA_PER_CAPABILITY) < 1e-6);
});

test('islandSizeInversions names every pair drawn the wrong way round, and nothing else', () => {
  const a = { island: 'a', capabilities: 1, area: 100 };
  const b = { island: 'b', capabilities: 2, area: 50 };
  const c = { island: 'c', capabilities: 3, area: 300 };
  const d = { island: 'd', capabilities: 3, area: 200 };
  assert.deepEqual(islandSizeInversions([a, b, c, d]), [{ smaller: a, larger: b }]);
  // Equal capability counts are never an inversion (c and d), nor is an equal area (the floor's
  // own case), nor a difference inside the tolerance.
  assert.deepEqual(islandSizeInversions([{ island: 'x', capabilities: 0, area: 318 }, { island: 'y', capabilities: 1, area: 318 }]), []);
  assert.deepEqual(islandSizeInversions([{ island: 'x', capabilities: 0, area: 318 + 1e-9 }, { island: 'y', capabilities: 1, area: 318 }]), []);
  assert.equal(islandSizeInversions([{ island: 'x', capabilities: 0, area: 318 + 1e-3 }, { island: 'y', capabilities: 1, area: 318 }]).length, 1);
  assert.equal(islandSizeInversions([{ island: 'x', capabilities: 0, area: 318 + 1e-3 }, { island: 'y', capabilities: 1, area: 318 }], 1e-2).length, 0, 'the tolerance is the caller’s');
  // EXACTLY at the tolerance is equal, not inverted: the comparison is strict, so the floor's own
  // case — two areas a tolerance apart — never reads as an inversion.
  assert.deepEqual(islandSizeInversions([{ island: 'x', capabilities: 0, area: 319 }, { island: 'y', capabilities: 1, area: 318 }], 1), []);
  assert.equal(islandSizeInversions([{ island: 'x', capabilities: 0, area: 319.5 }, { island: 'y', capabilities: 1, area: 318 }], 1).length, 1);
  assert.deepEqual(islandSizeInversions([]), []);
  assert.deepEqual(islandSizeInversions([a]), []);
  // Order: by the smaller island first, in input order — so a report is stable.
  const e = { island: 'e', capabilities: 0, area: 1000 };
  assert.deepEqual(islandSizeInversions([e, a, b]).map((p) => `${p.smaller.island}>${p.larger.island}`), ['e>a', 'e>b', 'a>b']);
});

test('⚠⚠ sizeIslandsByCapability: every island’s area becomes capabilities × ratio, isotropically, about its OWN centre — the centres (the layout) do not move', () => {
  // Island a: 3 parcels, 4 cells (1600 units²) around (30, 0). Island b: 1 parcel, 1 cell of 400
  // around (500, 300). At a ratio of 100: a → 300 units² (factor √(300/1600) = 0.433), b → 100
  // (factor 0.5). Different factors per island, from the same ratio.
  const a = [cell('a', 'a/p1', 0, 0), cell('a', 'a/p1', 20, 0), cell('a', 'a/p2', 40, 0), cell('a', 'a/p3', 60, 0)];
  const b = [cell('b', 'b/p1', 500, 300)];
  const before = [...a, ...b];
  const after = sizeIslandsByCapability(before, 100);
  const landAfter = islandLand(after);
  assert.ok(Math.abs(landAfter.get('a')!.area - 300) < 1e-9, `${landAfter.get('a')!.area}`);
  assert.ok(Math.abs(landAfter.get('b')!.area - 100) < 1e-9, `${landAfter.get('b')!.area}`);
  // Isotropic: a's extent was 80 × 20; both shrink by the same factor.
  const ea = extent(after.filter((d) => d.island === 'a'));
  const fa = Math.sqrt(300 / 1600);
  assert.ok(Math.abs(ea.w - 80 * fa) < 1e-9 && Math.abs(ea.d - 20 * fa) < 1e-9, `${ea.w} × ${ea.d}`);
  // The centres are invariant.
  const cBefore = islandCentres(before);
  const cAfter = islandCentres(after);
  for (const id of ['a', 'b']) {
    assert.ok(Math.abs(cBefore.get(id)!.x - cAfter.get(id)!.x) < 1e-9);
    assert.ok(Math.abs(cBefore.get(id)!.z - cAfter.get(id)!.z) < 1e-9);
  }
  // The transform moves with the ring: the cell at (60, 0) sits 30 from a's centre; scaled, 30·fa.
  const far = after.find((d) => d.parcel === 'a/p3')!;
  assert.ok(Math.abs(far.transform.x - (30 + 30 * fa)) < 1e-9);
  // y is never touched, and the input is not mutated.
  assert.ok(after.every((d) => d.transform.y === 0));
  assert.deepEqual(before[0], a[0]);
  assert.equal(extent(a).w, 80);
});

test('⚠ a ratio equal to an island’s own density leaves it byte-identical; the default ratio is the shipped constant; an island with no parcels is sized as ONE beside its neighbour — and a floor of 0 leaves it as drawn', () => {
  const a = [cell('a', 'a/p1', 0, 0), cell('a', 'a/p2', 20, 0)];
  const same = sizeIslandsByCapability(a, 400);
  assert.deepEqual(same, a);
  const explicit = sizeIslandsByCapability(a, LAND_AREA_PER_CAPABILITY);
  assert.ok(Math.abs(islandLand(explicit).get('a')!.area - 2 * LAND_AREA_PER_CAPABILITY) < 1e-9);
  // There is NO default ratio here — the one caller that means "the shipped one" says so (`worldTo3D`),
  // and `world-to-3d.test.ts` holds that its default IS the shipped constant.
  const mixed = [cell('bare', undefined, 0, 0), cell('b', 'b/p', 300, 0)];
  const out = sizeIslandsByCapability(mixed, 100);
  // The bare island: 400 units² drawn, sized as ONE capability → 100, about its own centre (0, 0).
  assert.ok(Math.abs(islandLand(out).get('bare')!.area - 100) < 1e-9, 'one capability’s worth');
  assert.equal(islandLand(out).get('bare')!.capabilities, 0, 'it still holds none — the size is the floor’s, not a counted capability');
  assert.deepEqual(out[0]!.transform, { x: 0, y: 0, z: 0 }, 'about its own centre');
  assert.deepEqual(out[0]!.points![0], { x: -5, y: 0, z: -5 });
  assert.ok(Math.abs(islandLand(out).get('b')!.area - 100) < 1e-9);
  // The default floor IS the shipped one; 0 is the map as it stood — the bare island left as drawn.
  assert.deepEqual(sizeIslandsByCapability(mixed, 100, LAND_FLOOR_CAPABILITIES), out);
  const before = sizeIslandsByCapability(mixed, 100, 0);
  assert.deepEqual(before[0], mixed[0], 'floor 0: no capability, no reading, no change');
  assert.ok(Math.abs(islandLand(before).get('b')!.area - 100) < 1e-9, 'its neighbour scales either way');
  assert.deepEqual(sizeIslandsByCapability([], 100), []);
});

test('⚠ the whole stream follows the island: a bloom scales about its own island, a ribbon between two islands lands on both scaled coasts, and a cave keeps its bearing under the isotropic scale', () => {
  // Island a at (50, 30): one cell of 1600 units² → at 400 its factor is 0.5. Island b at (250, 30):
  // one cell of 400 units² → at 400 its factor is 1 (already at the ratio). Nothing sits at the
  // origin, so a shift computed against the wrong centre — or added where it should be subtracted —
  // is a number a test can see.
  const a = cell('a', 'a/p', 50, 30, 40);
  const b = cell('b', 'b/p', 250, 30, 20);
  const bloom: InstanceDescriptor = { kind: 'uat-bloom', transform: { x: 60, y: 0, z: 40 }, group: 'g', island: 'a' };
  const cave: InstanceDescriptor = { kind: 'cave-arch', transform: { x: 70, y: 0, z: 30 }, group: 'g', island: 'a', bearing: 0.7 };
  const strip: InstanceDescriptor = {
    kind: 'trail-strip',
    transform: { x: 155, y: 0, z: 30 },
    group: 'g',
    points: [
      { x: 70, y: 0, z: 30 },
      { x: 155, y: 0, z: 30 },
      { x: 240, y: 0, z: 30 },
    ],
  };
  const out = sizeIslandsByCapability([a, b, bloom, cave, strip], 400).filter(asInstance);
  const [, , bloomOut, caveOut, stripOut] = out as [InstanceDescriptor, InstanceDescriptor, InstanceDescriptor, InstanceDescriptor, InstanceDescriptor];
  assert.deepEqual(bloomOut.transform, { x: 55, y: 0, z: 35 });
  assert.deepEqual(caveOut.transform, { x: 60, y: 0, z: 30 });
  assert.ok(Math.abs((caveOut.bearing as number) - 0.7) < 1e-12, 'isotropic: the rim normal does not turn');
  // a's coast at x = 70 is now at 60 (20 from a's centre, halved); b's coast at x = 240 stays (factor 1).
  // The midpoint at 155 is 105 from a — past a's reach (20√2) and its band (one reach) — so it is
  // open ground and stays exactly where the drawing put it.
  assert.ok(Math.abs(stripOut.points![0]!.x - 60) < 1e-9);
  assert.ok(Math.abs(stripOut.points![2]!.x - 240) < 1e-9);
  assert.equal(stripOut.points![1]!.x, 155, `the midpoint: ${stripOut.points![1]!.x}`);
  assert.ok(stripOut.points!.every((q) => q.z === 30), 'nothing moved along z');
  // The ribbon's transform moves by the MEAN of its points' shifts: (−10 + 0 + 0) / 3.
  assert.ok(Math.abs(stripOut.transform.x - (155 - 10 / 3)) < 1e-9, `${stripOut.transform.x}`);
  assert.equal(stripOut.transform.z, 30);
});
