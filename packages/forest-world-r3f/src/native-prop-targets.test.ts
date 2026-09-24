import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GroundInput } from './ground-dependency.js';
import type { KitPlacement } from './kit-vocabulary.js';
import { deriveNativePropHitRecords } from './native-prop-hit-records.js';
import { projectNativePropHitEnvelope } from './native-prop-hit-projection.js';
import { nativePropTargets } from './native-prop-targets.js';

const ELEVATION_DEG = 50;

const placement = (role: KitPlacement['role'], capId: string, x: number, z: number, y: number): KitPlacement => ({
  role,
  assembly: 'pine-a',
  capId,
  tint: null,
  at: { x, z },
  y,
  yaw: 0,
  scale: 1,
});

// Placement order is deliberately NOT depth order: the nearest plant comes first.
const near = placement('tree', 'cap-near', 10, 40, 1);
const far = placement('coverageFlora', 'cap-far', 12, -30, 2);
const middle = placement('deadTree', 'cap-middle', -5, 5, 0);
const cover = placement('bush', 'cover', 0, 0, 0);
const islandless = placement('tree', 'cap-islandless', 3, 3, 0);
const statusless = placement('tree', 'cap-statusless', 4, 4, 0);
// Two plants at one depth: their paint order must follow placement order.
const tieA = placement('coverageFlora', 'cap-tie-a', -20, 10, 0);
const tieB = placement('coverageFlora', 'cap-tie-b', 20, 10, 0);

const ground: GroundInput = {
  revision: 1,
  cells: [],
  strips: [],
  placements: [near, far, middle, cover, islandless, statusless, tieA, tieB],
  islandByPlacement: new Map<KitPlacement, string>([
    [near, 'story-a'],
    [far, 'story-b'],
    [middle, 'story-a'],
    [cover, 'story-a'],
    [statusless, 'story-b'],
    [tieA, 'story-c'],
    [tieB, 'story-c'],
  ]),
  growthLayout: new Map(),
  casters: [],
};

const folded = new Map<string, string>([
  ['story-a::cap-near', 'healthy'],
  ['story-b::cap-far', 'building'],
  ['story-a::cap-middle', 'unhealthy'],
  ['story-a::cover', 'healthy'],
  ['story-c::cap-tie-a', 'healthy'],
  ['story-c::cap-tie-b', 'healthy'],
  // A status keyed to the wrong island must not attach to the plant.
  ['story-a::cap-far', 'unhealthy'],
]);

test('native plant targets are the projected envelopes of the attributed plants, back to front', () => {
  const targets = nativePropTargets(ground, folded, ELEVATION_DEG);

  assert.deepEqual(
    targets.map((t) => t.capabilityId),
    ['cap-far', 'cap-middle', 'cap-tie-a', 'cap-tie-b', 'cap-near'],
    'far to near; equal depths keep placement order; cover, islandless and statusless plants are not targets',
  );
  for (let i = 1; i < targets.length; i += 1) {
    assert.ok(targets[i - 1]!.root.y <= targets[i]!.root.y, 'each target is no nearer than the one painted after it');
  }
  assert.ok(Object.isFrozen(targets), 'the target list is immutable');
});

test('native plant targets carry the status folded for their OWN island and capability', () => {
  const byCap = new Map(nativePropTargets(ground, folded, ELEVATION_DEG).map((t) => [t.capabilityId, t]));

  assert.equal(byCap.get('cap-far')?.status, 'building');
  assert.equal(byCap.get('cap-far')?.storyId, 'story-b');
  assert.equal(byCap.get('cap-middle')?.status, 'unhealthy');
  assert.equal(byCap.get('cap-near')?.status, 'healthy');
});

test('each target is exactly the signed projection of its own record at the supplied elevation', () => {
  const statusByPlacement = new Map<KitPlacement, string>([
    [near, 'healthy'],
    [far, 'building'],
    [middle, 'unhealthy'],
    [tieA, 'healthy'],
    [tieB, 'healthy'],
  ]);
  const expected = deriveNativePropHitRecords(ground, statusByPlacement).map((r) =>
    projectNativePropHitEnvelope(r, 37),
  );
  const actual = nativePropTargets(ground, folded, 37);

  for (const target of actual) {
    const match = expected.find((e) => e.capabilityId === target.capabilityId);
    assert.deepEqual(target, match, `${target.capabilityId}: projected once, at 37 degrees`);
  }
  assert.equal(actual.length, expected.length);
});

test('a crown stands above its root on the host drawing', () => {
  for (const target of nativePropTargets(ground, folded, ELEVATION_DEG)) {
    assert.ok(target.crown.y < target.root.y, `${target.capabilityId}: the crown is drawn above the root`);
    assert.ok(target.bounds.minY <= target.crown.y, `${target.capabilityId}: the target reaches the crown`);
    assert.ok(target.bounds.maxY >= target.root.y, `${target.capabilityId}: the target reaches the root`);
  }
});
