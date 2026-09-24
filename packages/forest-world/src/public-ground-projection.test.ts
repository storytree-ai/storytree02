import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  projectGround,
} from './camera.js';
import { composePublicGroundScene, type PublicGroundFacts } from './public-ground-scene-input.js';
import { projectPublicGroundScene } from './public-ground-projection.js';
import { projectTrailNetwork, type TrailSegment } from './routing.js';
import { buildScene, type SceneNode } from './scene.js';

function island(
  id: string,
  x: number,
  y: number,
  groundRadius: number,
  dependsOn: readonly string[] = [],
) {
  return {
    id,
    status: 'healthy' as const,
    dependsOn,
    centre: { x, y },
    rings: 1,
    groundRadius,
    treeSpot: { x, y: y - 4 },
    labelY: y + groundRadius + 18,
    plate: { w: 120, h: 30, rx: 6, idY: 14, subY: 26, idText: id, subText: 'healthy', title: `${id} title` },
    treeTitle: `${id} forest`,
    capabilities: [{ id: `${id}#cap`, status: 'healthy' as const, dependsOn: [], testCount: 2 }],
  };
}

const facts: PublicGroundFacts = {
  offset: { x: 180, y: 240 },
  width: 1400,
  height: 1000,
  islands: [
    island('A', 0, 0, 30),
    island('B', 600, 0, 30, ['A']),
    ...Array.from({ length: 8 }, (_, index) => {
      const bearing = (Math.PI / 4) * index;
      return island(`ring${index}`, 150 * Math.cos(bearing), 150 * Math.sin(bearing), 60);
    }),
  ],
};

function children(node: SceneNode): readonly SceneNode[] {
  return node.el === 'g' ? node.children : [];
}

function nodesOfKind(node: SceneNode, kind: string): SceneNode[] {
  const found: SceneNode[] = [];
  const visit = (current: SceneNode): void => {
    if (current.kind === kind) found.push(current);
    for (const child of children(current)) visit(child);
  };
  visit(node);
  return found;
}

test('public-ground-projection-preserves-the-immutable-plan: repeated projection is fresh and deterministic without changing the plan', () => {
  const plan = composePublicGroundScene(facts);
  const before = structuredClone(plan);

  const first = projectPublicGroundScene(plan);
  const second = projectPublicGroundScene(plan);

  assert.deepEqual(plan, before, 'projection does not mutate the immutable 90° plan');
  assert.equal(plan.cameraElevationDeg, PLAN_VIEW_ELEVATION_DEG);
  assert.notEqual(first, plan, 'projection returns a fresh scene');
  assert.deepEqual(first, second, 'the same plan produces one deterministic projected scene');
  assert.equal(first.cameraElevationDeg, LAND_CAMERA_ELEVATION_DEG);
});

test('public-ground-projection-keeps-one-projected-frame-and-ground-basis: frame, mesh and tagged anchors use the canonical 50° projection', () => {
  const plan = composePublicGroundScene(facts);
  const projected = projectPublicGroundScene(plan);
  const flattening = groundFlattening(LAND_CAMERA_ELEVATION_DEG);

  assert.deepEqual(projected.offset, projectGround(plan.offset, LAND_CAMERA_ELEVATION_DEG));
  assert.equal(projected.width, plan.width);
  assert.equal(projected.height, plan.height * flattening);
  assert.deepEqual(
    projected.relaxedCells,
    plan.relaxedCells!.map((cell) => ({ ...cell, poly: cell.poly.map((point) => projectGround(point, LAND_CAMERA_ELEVATION_DEG)) })),
  );
  for (const [index, territory] of projected.territories.entries()) {
    const source = plan.territories[index]!;
    assert.equal(territory.screenRadius, source.groundRadius * flattening);
    assert.equal(territory.anchorSpace, 'ground');
    assert.deepEqual(territory.coastGroundLoops, source.coastGroundLoops, 'coasts remain ground loops for buildScene');
    assert.deepEqual(territory.plate, source.plate, 'upright plate dimensions remain literal');
    assert.equal(territory.treeTitle, source.treeTitle);
    assert.deepEqual(territory.parcels, source.parcels, 'parcel, coverage and UAT facts survive unchanged');
  }
});

test('public-ground-projection-keeps-one-projected-frame-and-ground-basis: a plan without relaxed cells stays without them', () => {
  const plan = { ...composePublicGroundScene(facts), relaxedCells: null };
  const projected = projectPublicGroundScene(plan);

  assert.equal(projected.relaxedCells, null, 'the tile fallback is carried, never fabricated into a mesh');
  assert.equal(projected.cameraElevationDeg, LAND_CAMERA_ELEVATION_DEG);
});

test('public-ground-projection-reprojects-the-canonical-route-network: paths and cave bearings are projected while route facts survive', () => {
  const plan = composePublicGroundScene(facts);
  const projected = projectPublicGroundScene(plan);
  const direct = projectTrailNetwork(
    plan.trails,
    plan.territories.map(({ id, centroid, groundRadius }) => ({ id, x: centroid.x, y: centroid.y, r: groundRadius })),
    LAND_CAMERA_ELEVATION_DEG,
  );

  assert.ok(plan.trails.caves.length >= 2, 'the real fixture includes the forced cave-bearing route');
  assert.deepEqual(projected.trails, direct);
  assert.deepEqual(projected.trails.edges, plan.trails.edges);
  assert.deepEqual(projected.trails.dropped, plan.trails.dropped);
  assert.deepEqual(projected.trails.segments.map(({ id, usage, hidden }: TrailSegment) => ({ id, usage, hidden })),
    plan.trails.segments.map(({ id, usage, hidden }) => ({ id, usage, hidden })));
});

test('public-ground-projection-builds-one-coherent-drawing: one real scene fold agrees with the projected public facts', () => {
  const plan = composePublicGroundScene(facts);
  const projected = projectPublicGroundScene(plan);
  const drawing = buildScene(projected);
  const firstTerritory = projected.territories[0]!;

  const ground = nodesOfKind(drawing, 'ground').find((node) => node.id === firstTerritory.id);
  assert.ok(ground, 'the drawing retains the public island identity');
  assert.ok(nodesOfKind(ground, 'cell').length > 0, 'the projected relaxed substrate draws');
  assert.ok(nodesOfKind(drawing, 'trail-fill').length > 0, 'the projected canonical trails draw');
  assert.ok(nodesOfKind(drawing, 'cave').length > 0, 'the projected cave portals draw');
  assert.ok(nodesOfKind(drawing, 'parcel').some((node) => node.id === 'A#cap'), 'public parcel identity survives the fold');
  const projectedTreeSpot = projectGround(firstTerritory.treeSpot, LAND_CAMERA_ELEVATION_DEG);
  // test-updated (new behaviour): a ground-tagged tree anchor reaches buildScene in ground coordinates and is projected once during the fold.
  assert.ok(
    nodesOfKind(drawing, 'tree').some((node) =>
      node.title === firstTerritory.treeTitle &&
      node.transform?.startsWith(
        `translate(${projectedTreeSpot.x.toFixed(1)} ${projectedTreeSpot.y.toFixed(1)})`,
      ),
    ),
    'ground-tagged anchors normalise once in buildScene using its emitted coordinate precision',
  );
});
