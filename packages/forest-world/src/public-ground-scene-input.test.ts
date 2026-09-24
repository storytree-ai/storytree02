import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PLAN_VIEW_ELEVATION_DEG } from './camera.js';
import { buildScene, type SceneNode } from './scene.js';
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
  for (const island of first.territories) {
    assert.equal(island.anchorSpace, 'ground');
    assert.equal(island.screenRadius, island.groundRadius);
    assert.ok(first.relaxedCells!.some((cell) => cell.owner === first.territories.indexOf(island)));
    assert.ok(island.coastGroundLoops.length > 0);
  }
});

test('public-ground-scene-preserves-published-capability-ground: every published capability remains an ordered attributed parcel', () => {
  const input = composePublicGroundScene(facts);

  for (const [owner, source] of facts.islands.entries()) {
    const territory = input.territories[owner]!;
    assert.deepEqual(
      territory.parcels?.map(({ capId, status }) => ({ capId, status })),
      source.capabilities.map(({ id, status }) => ({ capId: id, status })),
    );
    const ground = allByKind(buildScene(input), 'parcel');
    for (const capability of source.capabilities) {
      assert.ok(
        ground.some((parcel) => parcel.id === capability.id && allByKind(parcel, 'cell').length > 0),
        `${capability.id} owns non-empty ground on ${source.id}`,
      );
    }
  }
});

test('public-ground-scene-keeps-public-coverage-truth: zero, positive and omitted coverage stay distinct in the real scene', () => {
  const input = composePublicGroundScene(facts);
  const root = input.territories[0]!;
  assert.deepEqual(root.parcels?.map((parcel) => parcel.testCount), [0, 3, undefined]);

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
});
