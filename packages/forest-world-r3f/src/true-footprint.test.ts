// true-footprint.test.ts — the per-island affine scale, held without a GPU.
//
// What has to hold: every descriptor moves about ITS OWN island's centre by that island's own
// factors and no other island's; each island's centre is INVARIANT, so a forest's layout holds
// still under it; a ribbon between two islands lands on both scaled coasts with no step in
// between; a cave's bearing turns with the rim; and the operation is exactly invertible.
//
// ⚠ THE Z-ONLY STRETCH IS NOW A FIXTURE HERE, NOT AN EXPORT. `stretchAboutIslands` and
// `restoreTrueFootprint` were deleted with the drawing they repaired (ADR-0546 D1 — the 3D forest
// stands on true ground, so `worldTo3D` un-projects nothing). Their coverage is kept, expressed
// through the general operation that survives them: a z-only stretch is the pair `{ x: 1, z: s }`,
// and holding it here is what keeps the ribbon-blending and bearing rules — the reason
// `land-per-capability.ts` reuses this module rather than copying it — under test at all.
//
// The check that the shipped mapper's route agrees with the scene's own plan-view route — an
// independent implementation of the same arithmetic — needs the harness's fixture island and lives
// in `harness/true-footprint-routes.test.ts` (src never imports the harness: `scope-fence.test.ts`).

import assert from 'node:assert/strict';
import test from 'node:test';

import { islandCentres, islandReaches, nearestCentre, scaleAboutIslands, scaledBearing, type GroundShift } from './true-footprint.js';
import type { Descriptor3D, InstanceDescriptor } from './world-to-3d.js';

/** The z-only stretch the module used to export: the same plane scaled along z alone. */
function stretchAboutIslands<T extends Descriptor3D>(descriptors: readonly T[], factor: number): T[] {
  return scaleAboutIslands(descriptors, () => ({ x: 1, z: factor }));
}

/** The cave bearing after that z-only stretch — the `{ x: 1, z: factor }` case of {@link scaledBearing}. */
function stretchedBearing(bearing: number, factor: number): number {
  return scaledBearing(bearing, { x: 1, z: factor });
}

/** A square island of side `side` centred at (cx, cz), one cell, named `id`. */
function square(id: string, cx: number, cz: number, side = 20): InstanceDescriptor {
  const h = side / 2;
  return {
    kind: 'cell-ground',
    transform: { x: cx, y: 0, z: cz },
    group: 'cell-ground',
    material: 'healthy',
    island: id,
    parcel: `${id}/p`,
    points: [
      { x: cx - h, y: 0, z: cz - h },
      { x: cx + h, y: 0, z: cz - h },
      { x: cx + h, y: 0, z: cz + h },
      { x: cx - h, y: 0, z: cz + h },
    ],
  };
}

/** A ground-plane extent: width along x, depth along z. */
interface Extent {
  w: number;
  d: number;
}

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

test('islandCentres is the mean of each island’s ring vertices; nearestCentre picks by distance', () => {
  const ds = [square('a', 0, 0), square('b', 100, 50)];
  const c = islandCentres(ds);
  assert.equal(c.size, 2);
  assert.deepEqual(c.get('a'), { x: 0, z: 0 });
  assert.deepEqual(c.get('b'), { x: 100, z: 50 });
  assert.deepEqual(nearestCentre(c, 10, 5), { x: 0, z: 0 });
  assert.deepEqual(nearestCentre(c, 80, 40), { x: 100, z: 50 });
  assert.equal(nearestCentre(new Map(), 0, 0), null);
  // A cell with no island id contributes to no centre; a skip contributes nothing.
  const { island: _dropped, ...anon } = square('x', 5, 5);
  void _dropped;
  assert.equal(islandCentres([anon, { kind: 'skipped', sceneKind: 'tree' }]).size, 0);
});

test('⚠⚠ every ground z is stretched about ITS island’s centre, x and y untouched, the points too — and the centre does not move', () => {
  const s = 2.5;
  const ds = [square('a', 0, 0), square('b', 100, 50, 10)];
  const out = stretchAboutIslands(ds, s);
  assert.equal(out.length, 2);
  for (const [i, d] of out.entries()) {
    const b = ds[i]!;
    const cz = islandCentres(ds).get(b.island!)!.z;
    assert.equal(d.transform.x, b.transform.x);
    assert.equal(d.transform.y, b.transform.y);
    assert.ok(Math.abs(d.transform.z - cz - (b.transform.z - cz) * s) < 1e-9);
    for (const [j, p] of (d.points ?? []).entries()) {
      const q = b.points![j]!;
      assert.equal(p.x, q.x);
      assert.ok(Math.abs(p.z - cz - (q.z - cz) * s) < 1e-9);
    }
  }
  // The centres are invariant: a's stays at 0, b's stays at 50 — the layout holds still.
  const after = islandCentres(out);
  assert.deepEqual(after.get('a'), { x: 0, z: 0 });
  assert.ok(Math.abs(after.get('b')!.z - 50) < 1e-9);
  // Each island's depth grew by exactly s; their spacing did not.
  assert.ok(Math.abs(depthOf([out[0]!]).d - 20 * s) < 1e-9);
  assert.ok(Math.abs(depthOf([out[1]!]).d - 10 * s) < 1e-9);
  // The input is not mutated.
  assert.equal(ds[0]!.points![0]!.z, -10);
  // The whole stream's depth grew by LESS than s: only the islands stretch, not the water.
  const before = depthOf(ds).d;
  const now = depthOf(out).d;
  assert.ok(now > before && now < before * s, `${before} → ${now}`);
});

test('a bloom and a cave stretch about their own island; a wisp follows the nearest island', () => {
  const ds: InstanceDescriptor[] = [
    square('a', 0, 0),
    square('b', 100, 0),
    { kind: 'uat-bloom', transform: { x: 3, y: 0, z: 4 }, group: 'uat-bloom', material: 'healthy', island: 'a' },
    { kind: 'cave-arch', transform: { x: 90, y: 0, z: -8 }, group: 'cave-arch', material: 'healthy', island: 'b', bearing: 0.3 },
    { kind: 'wisp-sprite', transform: { x: 95, y: 0, z: 6 }, group: 'wisp-sprite' },
  ];
  const out = stretchAboutIslands(ds, 3);
  assert.ok(Math.abs(out[2]!.transform.z - 12) < 1e-9, 'the bloom: 4 about a’s centre 0');
  assert.ok(Math.abs(out[3]!.transform.z - -24) < 1e-9, 'the cave: -8 about b’s centre 0');
  assert.ok(Math.abs(out[4]!.transform.z - 18) < 1e-9, 'the wisp: nearest island b, 6 about 0');
  assert.equal(out[4]!.transform.x, 95);
  assert.ok(Math.abs(out[3]!.bearing! - stretchedBearing(0.3, 3)) < 1e-12, 'the cave’s bearing turned with the rim');
  assert.equal(out[2]!.bearing, undefined, 'no bearing invented');
});

test('⚠ a cave’s bearing turns with the stretched rim — n′ ∝ (s·cos b, sin b) — and is identity at 1', () => {
  assert.equal(stretchedBearing(0.7, 1), Math.atan2(Math.sin(0.7), Math.cos(0.7)));
  assert.ok(Math.abs(stretchedBearing(0.7, 1) - 0.7) < 1e-12);
  // Along x the normal does not turn at all; along z neither.
  assert.ok(Math.abs(stretchedBearing(0, 3)) < 1e-12);
  assert.ok(Math.abs(stretchedBearing(Math.PI / 2, 3) - Math.PI / 2) < 1e-12);
  // A 45° normal on a plane stretched 3× along z leans toward x: atan2(sin 45, 3 cos 45) = atan(1/3).
  assert.ok(Math.abs(stretchedBearing(Math.PI / 4, 3) - Math.atan(1 / 3)) < 1e-12);
  // Derived from the geometry, not from the function: the rim tangent (-sin b, cos b) stretched to
  // (-sin b, s·cos b) is perpendicular to the returned normal.
  for (const b of [0.2, 1.1, 2.4, -0.9]) {
    const n = stretchedBearing(b, 2.9238);
    const dot = -Math.sin(b) * Math.cos(n) + 2.9238 * Math.cos(b) * Math.sin(n);
    assert.ok(Math.abs(dot) < 1e-12, `bearing ${b}: tangent·normal = ${dot}`);
  }
});

/** The road displacement field, DERIVED here from its definition (true-footprint.ts header) and
 *  never read back off the module: within an island's reach the ground's own move, in the band past
 *  it the rim's move on the same ray tapered linearly to zero, beyond the band nothing — summed. */
function fieldShift(
  p: { x: number; z: number },
  islands: readonly { c: { x: number; z: number }; reach: number; s: { x: number; z: number } }[],
): GroundShift {
  let dx = 0;
  let dz = 0;
  for (const { c, reach, s } of islands) {
    const r = Math.hypot(p.x - c.x, p.z - c.z);
    const band = reach * Math.max(1, 2 * Math.max(Math.abs(s.x - 1), Math.abs(s.z - 1)));
    const w = r <= reach ? 1 : r >= reach + band ? 0 : (reach / r) * (1 - (r - reach) / band);
    dx += (p.x - c.x) * (s.x - 1) * w;
    dz += (p.z - c.z) * (s.z - 1) * w;
  }
  return { dx, dz };
}

test('⚠⚠ a ribbon between two islands lands on BOTH stretched coasts, follows the position field between, and never folds', () => {
  // ⚠ AWAY FROM z = 0 AND WITH x VARYING, NON-UNIFORMLY. Islands on z = 0 make `p.z - c.z` and
  // `p.z + c.z` the same number, and points on one x hide an x term.
  const ds: InstanceDescriptor[] = [square('a', 0, 40), square('b', 0, 140)];
  // A strip from a's south coast (z = 50) to b's north coast (z = 130), five points, wandering in x.
  const raw = [
    { x: 0, z: 50 },
    { x: 12, z: 70 },
    { x: 12, z: 90 },
    { x: -5, z: 110 },
    { x: 0, z: 130 },
  ];
  const pts = raw.map((p) => ({ x: p.x, y: 0, z: p.z }));
  const strip: InstanceDescriptor = { kind: 'trail-strip', transform: { x: 0, y: 0, z: 90 }, group: 'trail-strip', points: pts };
  const s = 3;
  const out = stretchAboutIslands([...ds, strip], s);
  const moved = out[2]!;
  // a's coast moved to 40 + 10·3 = 70; b's coast to 140 - 10·3 = 110.
  assert.ok(Math.abs(moved.points![0]!.z - 70) < 1e-9, 'the first end sits on a’s stretched coast');
  assert.ok(Math.abs(moved.points![4]!.z - 110) < 1e-9, 'the last end sits on b’s stretched coast');
  const reach = Math.hypot(10, 10);
  const islands = [
    { c: { x: 0, z: 40 }, reach, s: { x: 1, z: s } },
    { c: { x: 0, z: 140 }, reach, s: { x: 1, z: s } },
  ];
  for (const [i, p] of raw.entries()) {
    const want = p.z + fieldShift(p, islands).dz;
    assert.ok(Math.abs(moved.points![i]!.z - want) < 1e-9, `point ${i}: ${moved.points![i]!.z} against ${want}`);
    assert.equal(moved.points![i]!.x, p.x, 'x never moves');
  }
  // Monotone in between: no fold, no jump — even under a threefold growth.
  for (let i = 1; i < 5; i += 1) assert.ok(moved.points![i]!.z > moved.points![i - 1]!.z, `point ${i} steps back`);
  // The anchor moved by the mean of the points' shifts.
  const meanShift = moved.points!.reduce((acc, p, i) => acc + (p.z - pts[i]!.z), 0) / 5;
  assert.ok(Math.abs(moved.transform.z - (90 + meanShift)) < 1e-9);
  assert.equal(moved.transform.x, 0);
  // A ghost strip is a ribbon too.
  const ghost: InstanceDescriptor = { ...strip, kind: 'trail-ghost-strip', group: 'trail-ghost-strip' };
  const g = stretchAboutIslands([...ds, ghost], s)[2]!;
  assert.deepEqual(g.points, moved.points);
  // A strip with NO points, or an empty list, is a point-like thing: nearest island, no field.
  const bare: InstanceDescriptor = { kind: 'trail-strip', transform: { x: 0, y: 0, z: 56 }, group: 'trail-strip' };
  assert.equal(stretchAboutIslands([...ds, bare], s)[2]!.transform.z, 88);
  assert.equal(stretchAboutIslands([...ds, { ...bare, points: [] }], s)[2]!.transform.z, 88);
  // A ribbon wholly inside one island's reach stretches about that island exactly.
  const dock: InstanceDescriptor = {
    kind: 'trail-strip',
    transform: { x: 0, y: 0, z: 36 },
    group: 'trail-strip',
    points: [{ x: 0, y: 0, z: 32 }, { x: 0, y: 0, z: 36 }, { x: 0, y: 0, z: 40 }],
  };
  const d2 = stretchAboutIslands([...ds, dock], s)[2]!;
  assert.deepEqual(d2.points!.map((p) => p.z), [16, 28, 40]);
  assert.ok(Math.abs(d2.transform.z - 28) < 1e-9);
});

test('⚠⚠ a road in OPEN GROUND stays exactly where the drawing put it, and a junction two strips share moves identically in both', () => {
  // The public map's bug (2026-09-25): the router bundles the network, so strips run junction to
  // junction far from any coast, and the retired rule dragged those junctions toward the nearest
  // shrinking island by (p − c)·(s − 1) — a third of the way in at the public map's factors — so
  // the 3D roads left the routes the SVG's selection lanes light on a click.
  const a = square('a', 0, 0); // reach 10√2 ≈ 14.1; shrinks to 0.6, so its band is one reach wide
  const b = square('b', 300, 0);
  const trunk: InstanceDescriptor = {
    kind: 'trail-strip',
    transform: { x: 150, y: 0, z: 0 },
    group: 'g',
    // from a's coast out to a junction at (150, 60), far from both islands
    points: [{ x: 10, y: 0, z: 0 }, { x: 80, y: 0, z: 40 }, { x: 150, y: 0, z: 60 }],
  };
  const branch: InstanceDescriptor = {
    kind: 'trail-strip',
    transform: { x: 225, y: 0, z: 30 },
    group: 'g',
    // from that same junction on to b's coast
    points: [{ x: 150, y: 0, z: 60 }, { x: 290, y: 0, z: 0 }],
  };
  const out = scaleAboutIslands([a, b, trunk, branch], () => ({ x: 0.6, z: 0.6 }));
  const [, , t, br] = out as [InstanceDescriptor, InstanceDescriptor, InstanceDescriptor, InstanceDescriptor];
  // the docks land on the scaled coasts
  assert.deepEqual([t.points![0]!.x, t.points![0]!.z], [6, 0]);
  assert.ok(Math.abs(br.points![1]!.x - 294) < 1e-9 && br.points![1]!.z === 0);
  // open ground: not moved AT ALL (the retired rule moved (80, 40) to (69.9, 34.9) and the junction
  // to (120, 48) — 32 units off the drawn route)
  assert.deepEqual([t.points![1]!.x, t.points![1]!.z], [80, 40]);
  assert.deepEqual([t.points![2]!.x, t.points![2]!.z], [150, 60]);
  // the junction is one point in both strips
  assert.deepEqual(t.points![2], br.points![0]);
});

test('⚠ islandCentres reads CELLS ONLY, and only cells with vertices; nearestCentre keeps the first of two equidistant centres', () => {
  // A bloom carrying an island id AND points is not ground and contributes to no centre.
  const impostor: InstanceDescriptor = {
    kind: 'uat-bloom',
    transform: { x: 500, y: 0, z: 500 },
    group: 'uat-bloom',
    island: 'a',
    points: [{ x: 500, y: 0, z: 500 }],
  };
  assert.deepEqual(islandCentres([square('a', 0, 0), impostor]).get('a'), { x: 0, z: 0 });
  // A cell with an island id and NO ring contributes nothing — the island is absent, not at NaN.
  const { points: _ring, ...ringless } = square('r', 5, 5);
  void _ring;
  assert.equal(islandCentres([ringless]).size, 0);
  assert.equal(islandCentres([{ ...ringless, points: [] }]).size, 0);
  // Two centres at the same distance: the first inserted wins, deterministically.
  const c = islandCentres([square('a', -10, 0), square('b', 10, 0)]);
  assert.deepEqual(nearestCentre(c, 0, 0), { x: -10, z: 0 });
});

test('⚠ a descriptor that NAMES its island stretches about it even when another island is nearer; an unknown island id falls back to the nearest', () => {
  // ⚠ b sits at a DIFFERENT z from a, or "about a" and "about b" would be the same number and
  // the own-island branch could be deleted unnoticed (`check:mutation-diff`, 2026-09-05).
  const ds: InstanceDescriptor[] = [
    square('a', 0, 0),
    square('b', 100, 30),
    // A bloom of island a standing right beside b.
    { kind: 'uat-bloom', transform: { x: 95, y: 0, z: 34 }, group: 'uat-bloom', material: 'healthy', island: 'a' },
    // A cave claiming an island the stream does not carry.
    { kind: 'cave-arch', transform: { x: 95, y: 0, z: 34 }, group: 'cave-arch', material: 'healthy', island: 'ghost', bearing: 0 },
    // A wisp names no island at all.
    { kind: 'wisp-sprite', transform: { x: 95, y: 0, z: 34 }, group: 'wisp-sprite' },
  ];
  const out = stretchAboutIslands(ds, 3);
  assert.ok(Math.abs(out[2]!.transform.z - 34 * 3) < 1e-9, 'the bloom stretched about a (its own, z 0), not b (the nearest, z 30)');
  assert.ok(Math.abs(out[3]!.transform.z - (30 + 4 * 3)) < 1e-9, 'the cave fell back to the nearest island — b');
  assert.ok(Math.abs(out[4]!.transform.z - (30 + 4 * 3)) < 1e-9, 'the wisp follows the nearest island — b');
  // And a big island beside a tiny one: the big ring's corners are nearer the tiny island than
  // their own centre, and still stretch about their own — a ring is never blended like a ribbon.
  const big = square('big', 0, 0, 100);
  const tiny = square('tiny', 60, 0, 4);
  const [bigOut] = stretchAboutIslands([big, tiny], 3);
  assert.deepEqual(bigOut!.points!.map((p) => p.z), [-150, -150, 150, 150]);
});

test('a stream with no islands, or a stretch of 1, comes back unchanged; a bad factor refuses; skips pass through', () => {
  const wisp: InstanceDescriptor = { kind: 'wisp-sprite', transform: { x: 1, y: 0, z: 2 }, group: 'wisp-sprite' };
  assert.deepEqual(stretchAboutIslands([wisp], 3), [wisp]);
  const ds: Descriptor3D[] = [square('a', 0, 0), { kind: 'skipped', sceneKind: 'tree' }];
  assert.deepEqual(stretchAboutIslands(ds, 1), ds);
  assert.deepEqual(stretchAboutIslands(ds, 3)[1], { kind: 'skipped', sceneKind: 'tree' });
  assert.throws(() => stretchAboutIslands(ds, 0), /positive finite/);
  assert.throws(() => stretchAboutIslands(ds, Number.NaN), /positive finite/);
  assert.throws(() => stretchAboutIslands(ds, -2), /positive finite/);
});

test('⚠ the stretch is exactly invertible: stretching by s then by 1/s is the identity to the bit of a centre', () => {
  const ds = [square('a', 3, -7), square('b', 120, 40, 14)];
  const back = stretchAboutIslands(stretchAboutIslands(ds, 2.9238), 1 / 2.9238);
  for (const [i, d] of back.entries()) {
    for (const [j, p] of (d.points ?? []).entries()) {
      assert.ok(Math.abs(p.z - ds[i]!.points![j]!.z) < 1e-9);
    }
  }
});

// ---------------------------------------------------------------- the general scale

test('⚠ scaleAboutIslands REFUSES a scale that is not a positive finite pair, naming the island and the pair; zero is refused, not only negatives', () => {
  const isle = square('a', 0, 0);
  for (const bad of [
    { x: 0, z: 1 },
    { x: 1, z: 0 },
    { x: -1, z: 1 },
    { x: 1, z: -0.5 },
    { x: Number.NaN, z: 1 },
    { x: 1, z: Number.POSITIVE_INFINITY },
  ]) {
    assert.throws(
      () => scaleAboutIslands([isle], () => bad),
      (e: unknown) => e instanceof Error && e.message === `true-footprint: island "a" was given a scale of (${bad.x}, ${bad.z}); both must be positive finite numbers`,
      `(${bad.x}, ${bad.z}) was accepted`,
    );
  }
  // And a positive pair on each axis is applied on each axis, about the island's centre.
  const [out] = scaleAboutIslands([square('a', 10, 20)], () => ({ x: 2, z: 0.5 })) as [InstanceDescriptor];
  const e = depthOf([out]);
  assert.ok(Math.abs(e.w - 40) < 1e-9 && Math.abs(e.d - 10) < 1e-9, `${e.w} × ${e.d}`);
  assert.deepEqual(out.transform, { x: 10, y: 0, z: 20 });
  assert.deepEqual(scaleAboutIslands([], () => ({ x: 2, z: 2 })), []);
});

test('⚠ a wisp EQUIDISTANT from two islands follows the FIRST — the tie rule nearestCentre already holds', () => {
  const a = square('a', 0, 0);
  const b = square('b', 100, 0);
  const wisp: InstanceDescriptor = { kind: 'wisp-sprite', transform: { x: 50, y: 0, z: 0 }, group: 'g' };
  // a scales by 2 about (0, 0) — the wisp at 50 goes to 100; b by 0.5 about (100, 0) — it would go to 75.
  const out = scaleAboutIslands([a, b, wisp], (id) => (id === 'a' ? { x: 2, z: 2 } : { x: 0.5, z: 0.5 }));
  assert.deepEqual(out[2]!.transform, { x: 100, y: 0, z: 0 });
  // Listed the other way round, b is first and wins the tie.
  const swapped = scaleAboutIslands([b, a, wisp], (id) => (id === 'a' ? { x: 2, z: 2 } : { x: 0.5, z: 0.5 }));
  assert.deepEqual(swapped[2]!.transform, { x: 75, y: 0, z: 0 });
});

test('⚠ a ribbon under an x-scale: each end follows its own island along x, the points between follow the field, and the transform moves by the mean shift', () => {
  const a = square('a', 0, 0); // scaled ×3 along x about (0, 0)
  const b = square('b', 200, 0); // scaled ×½ along x about (200, 0)
  const strip: InstanceDescriptor = {
    kind: 'trail-strip',
    transform: { x: 105, y: 0, z: 7 },
    group: 'g',
    points: [
      { x: 10, y: 0, z: 7 },
      { x: 40, y: 0, z: 7 },
      { x: 105, y: 0, z: 7 },
      { x: 190, y: 0, z: 7 },
    ],
  };
  const out = scaleAboutIslands([a, b, strip], (id) => (id === 'a' ? { x: 3, z: 1 } : { x: 0.5, z: 1 }));
  const s = out[2]!;
  const reach = Math.hypot(10, 10);
  const islands = [
    { c: { x: 0, z: 0 }, reach, s: { x: 3, z: 1 } },
    { c: { x: 200, z: 0 }, reach, s: { x: 0.5, z: 1 } },
  ];
  // First end, inside a's reach: 10 × 3 = 30. Last end, inside b's: 200 − 10 × ½ = 195. The point
  // at 40 is in a's band (a's growth widens it to four reaches) and moves; the one at 105 is past
  // every band and does not.
  const want = strip.points!.map((p) => p.x + fieldShift(p, islands).dx);
  assert.ok(Math.abs(want[0]! - 30) < 1e-9 && Math.abs(want[3]! - 195) < 1e-9);
  assert.ok(want[1]! > 40 && want[2] === 105, `${want}`);
  s.points!.forEach((p, i) => assert.ok(Math.abs(p.x - want[i]!) < 1e-9, `point ${i}: ${p.x} against ${want[i]}`));
  assert.ok(s.points!.every((p) => p.z === 7));
  const meanShift = want.reduce((acc, x, i) => acc + (x - strip.points![i]!.x), 0) / 4;
  assert.ok(Math.abs(s.transform.x - (105 + meanShift)) < 1e-9, `${s.transform.x}`);
  assert.equal(s.transform.z, 7);
});

test('scaledBearing: the rim normal turns with an anisotropic scale and not with an isotropic one; the z-stretch is the special case', () => {
  assert.ok(Math.abs(scaledBearing(0.7, { x: 2, z: 2 }) - 0.7) < 1e-12);
  assert.ok(Math.abs(scaledBearing(0.7, { x: 1, z: 3 }) - stretchedBearing(0.7, 3)) < 1e-12);
  assert.ok(Math.abs(scaledBearing(0.7, { x: 3, z: 1 }) - Math.atan2(Math.sin(0.7), Math.cos(0.7) / 3)) < 1e-12);
});

test('islandReaches reads each island\'s CELLS only: a bloom carrying the island id and far points is not ground, an island with no centre is skipped, and a pointless cell reaches nothing', () => {
  const a = square('a', 0, 0); // farthest corner at 10√2
  const impostor: InstanceDescriptor = {
    kind: 'uat-bloom',
    transform: { x: 500, y: 0, z: 500 },
    group: 'uat-bloom',
    island: 'a',
    points: [{ x: 500, y: 0, z: 500 }],
  };
  const stray = square('ghost', 900, 900); // a cell of an island the caller has no centre for
  const bare: InstanceDescriptor = { kind: 'cell-ground', transform: { x: 50, y: 0, z: 0 }, group: 'cell-ground', island: 'b' };
  const reaches = islandReaches([a, impostor, stray, bare], new Map([['a', { x: 0, z: 0 }], ['b', { x: 50, z: 0 }]]));
  assert.ok(Math.abs((reaches.get('a') as number) - Math.hypot(10, 10)) < 1e-12, `${reaches.get('a')}`);
  assert.equal(reaches.has('ghost'), false);
  assert.equal(reaches.get('b'), 0);
});
