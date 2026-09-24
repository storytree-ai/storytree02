import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLAN_VIEW_ELEVATION_DEG } from './camera.js';
import type { Pt } from './hex.js';
import { routeTrails } from './routing.js';
import { buildScene, type SceneInput, type SceneNode } from './scene.js';
import { composePublicGroundScene } from './public-ground-scene-input.js';

function children(node: SceneNode): SceneNode[] {
  return node.el === 'g' ? node.children : [];
}

function allByKind(node: SceneNode, kind: string): SceneNode[] {
  const found: SceneNode[] = [];
  const visit = (current: SceneNode): void => {
    if (current.kind === kind) found.push(current);
    for (const child of children(current)) visit(child);
  };
  visit(node);
  return found;
}

function close(actual: number, expected: number, message: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${message}: ${actual} != ${expected}`);
}

function signedArea(poly: readonly Pt[]): number {
  return poly.reduce((sum, point, index) => {
    const next = poly[(index + 1) % poly.length]!;
    return sum + point.x * next.y - next.x * point.y;
  }, 0) / 2;
}

function contains(poly: readonly Pt[], point: Pt): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if ((a.y > point.y) !== (b.y > point.y)
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function assertAttributedGround(input: SceneInput): void {
  const ground = allByKind(buildScene(input), 'ground');
  for (const [owner, territory] of input.territories.entries()) {
    const islandGround = ground.find((node) => node.id === territory.id);
    assert.ok(islandGround, `${territory.id} has its own ground group`);
    const parcels = allByKind(islandGround, 'parcel');
    assert.deepEqual(parcels.map(({ id, status }) => ({ id, status })),
      territory.parcels!.map(({ capId, status }) => ({ id: capId, status })));
    const owned = input.relaxedCells!.filter((cell) => cell.owner === owner);
    for (const parcel of territory.parcels!) {
      const matches = parcels.filter((node) => node.id === parcel.capId);
      assert.equal(matches.length, 1, `${parcel.capId} has one attributed parcel`);
      assert.ok(allByKind(matches[0]!, 'cell').length > 0, `${parcel.capId} has non-empty ground`);
      assert.ok(owned.some((cell) => contains(cell.poly, parcel.seed)),
        `${parcel.capId}'s seed lies on its owning island's mesh`);
    }
  }
}

const facts = {
  offset: { x: 400, y: 300 },
  width: 1600,
  height: 1200,
  islands: [
    {
      id: 'root',
      status: 'healthy',
      dependsOn: [],
      centre: { x: -220, y: 40 },
      rings: 1,
      groundRadius: 70,
      treeSpot: { x: -220, y: 38 },
      labelY: 124,
      plate: { w: 120, h: 30, rx: 6, idY: 14, subY: 26, idText: 'root', subText: 'healthy', title: 'Root' },
      treeTitle: 'Root forest',
      capabilities: [
        { id: 'root#zero', status: 'healthy', dependsOn: [], testCount: 0 },
        { id: 'root#positive', status: 'building', dependsOn: [], testCount: 3 },
        { id: 'root#unreported', status: 'proposed', dependsOn: [] },
      ],
      uatLegs: [
        { state: 'proven', presentationKey: 'root:0' },
        { state: 'pending', presentationKey: 'root:1' },
        { state: 'failing', presentationKey: 'root:2' },
      ],
    },
    {
      id: 'grove',
      status: 'mapped',
      dependsOn: ['root', 'missing-story'],
      centre: { x: 30, y: -120 },
      rings: 2,
      groundRadius: 105,
      treeSpot: { x: 30, y: -124 },
      labelY: -5,
      plate: { w: 130, h: 30, rx: 6, idY: 14, subY: 26, idText: 'grove', subText: 'mapped', title: 'Grove' },
      treeTitle: 'Grove forest',
      capabilities: [
        { id: 'grove#first', status: 'mapped', dependsOn: ['root#positive'], testCount: 2 },
        { id: 'grove#second', status: 'unhealthy', dependsOn: ['missing#cap'], testCount: 1 },
      ],
      uatLegs: [],
    },
    {
      id: 'canopy',
      status: 'unknown',
      dependsOn: ['grove'],
      centre: { x: 280, y: 120 },
      rings: 1,
      groundRadius: 66,
      treeSpot: { x: 280, y: 116 },
      labelY: 202,
      plate: { w: 120, h: 30, rx: 6, idY: 14, subY: 26, idText: 'canopy', subText: 'unknown', title: 'Canopy' },
      treeTitle: 'Canopy forest',
      capabilities: [{ id: 'canopy#only', status: 'unknown', dependsOn: ['grove#first'], testCount: 1 }],
    },
  ],
} as const;

test('public-ground-scene-is-coherent-and-deterministic: published ground facts compose as one plan-view scene', () => {
  const first = composePublicGroundScene(facts);
  const second = composePublicGroundScene(facts);

  assert.deepEqual(first, second);
  assert.equal(first.cameraElevationDeg, PLAN_VIEW_ELEVATION_DEG);
  assert.deepEqual(first.offset, facts.offset);
  assert.equal(first.relaxedCells === null, false, 'the public composition supplies the shared relaxed mesh');
  assert.deepEqual(first.drawTiles, []);
  assert.deepEqual(first.wheatSets, []);
  assert.deepEqual(first.empties, []);
  for (const [owner, island] of first.territories.entries()) {
    const source = facts.islands[owner]!;
    assert.equal(island.anchorSpace, 'ground');
    assert.equal(island.screenRadius, island.groundRadius);
    assert.equal(island.status, source.status);
    assert.equal(island.caps, source.capabilities.length);
    assert.deepEqual(island.decor, []);
    assert.deepEqual(island.plants, []);
    assert.deepEqual(island.wisps, []);
    assert.deepEqual(island.claims, []);
    assert.equal(island.coastGroundLoops.length, 1, 'a complete ring disc has one exterior coast');
    const coast = island.coastGroundLoops[0]!;
    assert.ok(signedArea(coast) > 0, 'the canonical clockwise ground boundary keeps its winding');
    const cells = first.relaxedCells!.filter((cell) => cell.owner === owner);
    assert.ok(cells.length > 0);
    const points = cells.flatMap((cell) => cell.poly);
    const xs = points.map((p) => p.x - source.centre.x);
    const ys = points.map((p) => p.y - source.centre.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    close(Math.min(...xs) + Math.max(...xs), 0, 'mesh remains centered on the supplied x');
    close(Math.min(...ys) + Math.max(...ys), 0, 'mesh remains centered on the supplied y');
    // These are the area and extent of a complete axial hex disc. They observe
    // the supplied scalar topology without rebuilding its cells or coast.
    close(width / height, Math.sqrt(3) * (2 * source.rings + 1) / (3 * source.rings + 2),
      'the disc has the plan-view aspect ratio');
    const area = cells.reduce((sum, cell) => sum + Math.abs(signedArea(cell.poly)), 0);
    const tileCount = 1 + 3 * source.rings * (source.rings + 1);
    close(area / (width * width), tileCount * Math.sqrt(3) / (2 * (2 * source.rings + 1) ** 2),
      'the mesh fills exactly the supplied rings');
    const coastRadii = coast.map((p) => Math.hypot(p.x - source.centre.x, p.y - source.centre.y));
    close(Math.max(...coastRadii), source.groundRadius, 'the coast fits the supplied ground radius');
    assert.ok(points.every((point) => contains(coast, point)), 'the coast surrounds the owning mesh');
  }

  const scale = 0.017;
  const shift = { x: 17, y: -43 };
  const moved = composePublicGroundScene({
    ...facts,
    islands: facts.islands.map((island) => ({
      ...island,
      centre: { x: island.centre.x * scale + shift.x, y: island.centre.y * scale + shift.y },
      groundRadius: island.groundRadius * scale,
      treeSpot: { x: island.treeSpot.x * scale + shift.x, y: island.treeSpot.y * scale + shift.y },
      labelY: island.labelY * scale + shift.y,
    })),
  });
  const firstPoints = first.relaxedCells!.flatMap((cell) => cell.poly)
    .concat(first.territories.flatMap((t) => t.coastGroundLoops.flat()), first.territories.flatMap((t) => t.parcels!.map((p) => p.seed)));
  const movedPoints = moved.relaxedCells!.flatMap((cell) => cell.poly)
    .concat(moved.territories.flatMap((t) => t.coastGroundLoops.flat()), moved.territories.flatMap((t) => t.parcels!.map((p) => p.seed)));
  assert.equal(movedPoints.length, firstPoints.length, 'a change of ground basis preserves topology');
  for (const [index, point] of firstPoints.entries()) {
    close(movedPoints[index]!.x, point.x * scale + shift.x, 'mesh, coast and parcel x share one basis');
    close(movedPoints[index]!.y, point.y * scale + shift.y, 'mesh, coast and parcel y share one basis');
  }

  const changedRings = composePublicGroundScene({
    ...facts,
    islands: facts.islands.map((island, index) => index === 0 ? { ...island, rings: island.rings + 1 } : island),
  });
  for (const scene of [first, changedRings]) {
    assert.deepEqual(scene.offset, facts.offset);
    assert.equal(scene.width, facts.width);
    assert.equal(scene.height, facts.height);
    for (const [index, source] of facts.islands.entries()) {
      const territory = scene.territories[index]!;
      assert.deepEqual(territory.centroid, source.centre);
      assert.equal(territory.groundRadius, source.groundRadius);
      assert.deepEqual(territory.treeSpot, source.treeSpot);
      assert.equal(territory.labelY, source.labelY);
      assert.deepEqual(territory.plate, source.plate);
      assert.equal(territory.treeTitle, source.treeTitle);
    }
  }
  assert.notDeepEqual(
    changedRings.relaxedCells!.filter((cell) => cell.owner === 0).map((cell) => cell.poly),
    first.relaxedCells!.filter((cell) => cell.owner === 0).map((cell) => cell.poly),
    'supplied ring topology changes the island mesh at a fixed centre, radius and capability count',
  );
  assert.notDeepEqual(
    changedRings.territories[0]!.coastGroundLoops,
    first.territories[0]!.coastGroundLoops,
    'supplied ring topology changes the island coast at a fixed centre, radius and capability count',
  );
});

test('public-ground-scene-preserves-published-capability-ground: every published capability remains an ordered attributed parcel', () => {
  const input = composePublicGroundScene(facts);
  assertAttributedGround(input);

  for (const [owner, source] of facts.islands.entries()) {
    const territory = input.territories[owner]!;
    assert.deepEqual(
      territory.parcels?.map(({ capId, status }) => ({ capId, status })),
      source.capabilities.map(({ id, status }) => ({ capId: id, status })),
    );
  }

  // A single canonical hex has fewer coarse cells than these capabilities.
  // Increasing density must create interior ground without moving its footprint.
  const base = { ...facts.islands[0], rings: 0, groundRadius: 0.125 };
  const sparse = composePublicGroundScene({ ...facts, islands: [{ ...base, capabilities: [] }] });
  assert.equal(sparse.territories[0]!.parcels!.length, 0);
  assert.ok(sparse.relaxedCells!.length > 6,
    'canonical merged-and-subdivided ground is finer than the alternate six-sector hex fan');
  for (const count of [13, 49]) {
    const crowded = composePublicGroundScene({
      ...facts,
      islands: [{ ...base, capabilities: Array.from({ length: count }, (_, i) => ({
        id: `crowded#${i}`, status: i % 2 ? 'building' : 'healthy', dependsOn: [],
      } as const)) }],
    });
    const territory = crowded.territories[0]!;
    assert.ok(crowded.relaxedCells!.length >= count, 'subdivision has enough cells for every capability');
    assert.equal(territory.parcels!.length, count);
    assert.deepEqual(territory.parcels!.map((p) => p.capId), Array.from({ length: count }, (_, i) => `crowded#${i}`));
    assert.deepEqual(territory.coastGroundLoops, sparse.territories[0]!.coastGroundLoops);
    assert.deepEqual(territory.centroid, base.centre);
    assert.equal(territory.groundRadius, base.groundRadius);
    assert.deepEqual(territory.treeSpot, base.treeSpot);
    assert.equal(territory.labelY, base.labelY);
    assertAttributedGround(crowded);
  }
});

test('public-ground-scene-keeps-public-coverage-truth: zero, positive and omitted coverage stay distinct in the real scene', () => {
  const input = composePublicGroundScene(facts);
  const root = input.territories[0]!;
  assert.deepEqual(root.parcels?.map((parcel) => parcel.testCount), [0, 3, undefined]);
  assert.equal(Object.hasOwn(root.parcels![0]!, 'testCount'), true);
  assert.equal(Object.hasOwn(root.parcels![1]!, 'testCount'), true);
  assert.equal(Object.hasOwn(root.parcels![2]!, 'testCount'), false, 'unreported coverage remains absent');

  const scene = buildScene(input);
  const parcels = allByKind(scene, 'parcel');
  const flora = allByKind(scene, 'parcel-flora');
  for (const capId of ['root#zero', 'root#positive', 'root#unreported']) {
    assert.ok(parcels.some((parcel) => parcel.id === capId), `${capId} keeps parcel ground`);
  }
  assert.ok(flora.some((item) => item.id === 'root#zero'), 'explicit zero retains baseline parcel flora');
  assert.ok(flora.some((item) => item.id === 'root#positive'), 'positive coverage retains normal parcel flora');
  assert.equal(flora.some((item) => item.id === 'root#unreported'), false, 'unreported coverage emits no parcel flora');
});

test('public-ground-scene-preserves-public-uat-state: local presentation keys become deterministic state-matched markers', () => {
  const input = composePublicGroundScene(facts);
  const root = input.territories[0]!;
  const grove = input.territories[1]!;
  assert.deepEqual(root.uatCriteria, [
    { id: 'root:0', state: 'proven' },
    { id: 'root:1', state: 'pending' },
    { id: 'root:2', state: 'failing' },
  ]);
  assert.equal(grove.uatCriteria, undefined);
  assert.equal(Object.hasOwn(grove, 'uatCriteria'), false, 'empty legs do not manufacture a marker field');
  assert.equal(Object.hasOwn(input.territories[2]!, 'uatCriteria'), false, 'omitted legs remain omitted');
  assert.ok(root.uatCriteria?.every((criterion) => !criterion.id.startsWith('uatc_')));

  const markers = allByKind(buildScene(input), 'tall-flower-proven')
    .concat(allByKind(buildScene(input), 'tall-flower-pending'), allByKind(buildScene(input), 'tall-flower-failing'));
  assert.deepEqual(
    markers.map((marker) => ({ id: marker.id, kind: marker.kind })).sort((a, b) => a.id!.localeCompare(b.id!)),
    [
      { id: 'root:0', kind: 'tall-flower-proven' },
      { id: 'root:1', kind: 'tall-flower-pending' },
      { id: 'root:2', kind: 'tall-flower-failing' },
    ],
  );
});

test('public-ground-scene-routes-only-canonical-public-edges: canonical published edges route and unknown references do not fabricate roads', () => {
  const input = composePublicGroundScene(facts);
  assert.deepEqual(
    input.trails.edges.map(({ from, to }) => ({ from, to })).sort((a, b) => `${a.from}:${a.to}`.localeCompare(`${b.from}:${b.to}`)),
    [
      { from: 'grove', to: 'canopy' },
      { from: 'root', to: 'grove' },
    ],
  );
  assert.equal(input.trails.edges.some((edge) => edge.from === 'missing-story' || edge.to === 'missing-story'), false);
  assert.equal(input.trails.edges.some((edge) => edge.from === 'missing' || edge.to === 'missing'), false);
  assert.deepEqual(input.trails.dropped, [], 'a routable canonical fixture retains the router drop signal without inventing one');
  const routed = routeTrails([
    { id: 'root', x: -220, y: 40, r: 70 },
    { id: 'grove', x: 30, y: -120, r: 105 },
    { id: 'canopy', x: 280, y: 120, r: 66 },
  ], [{ from: 'root', to: 'grove' }, { from: 'grove', to: 'canopy' }], 'public-ground-scene');
  assert.deepEqual(input.trails, routed, 'the canonical network, including its drop signal, passes through unchanged');
  const derivedOnly = composePublicGroundScene({
    ...facts,
    islands: facts.islands.map((island) => ({ ...island, dependsOn: ['missing-story'] })),
  });
  assert.deepEqual(derivedOnly.trails, routed, 'published capability dependencies retain their canonical owner routes');
  assert.deepEqual(composePublicGroundScene({ ...facts, islands: [] }).trails,
    { segments: [], edges: [], caves: [], dropped: [] });
});
