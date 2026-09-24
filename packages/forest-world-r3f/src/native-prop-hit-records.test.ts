import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { GroundInput } from './ground-dependency.js';
import {
  KIT_FOOTPRINTS_2026_08_29,
  KIT_HEIGHTS_2026_08_29,
  type KitPlacement,
} from './kit-vocabulary.js';
import { deriveNativePropHitRecords } from './native-prop-hit-records.js';

const placement = (
  role: KitPlacement['role'],
  capId: string,
  x: number,
  z: number,
  y: number,
  scale: number,
): KitPlacement => ({
  role,
  assembly: role === 'deadTree' ? 'pine-dead' : role === 'bloom' || role === 'bud' || role === 'wilt' ? 'flower' : 'pine-a',
  capId,
  // Deliberately null for both forms of capability tree: identity and folded status must come
  // from the supplied semantic lookup, never a reverse-read of a material colour.
  tint: null,
  at: { x, z },
  y,
  yaw: 0.25,
  scale,
});

const tree = placement('tree', 'cap-tree', 11, -7, 2.5, 1);
const deadTree = placement('deadTree', 'cap-dead', -4, 19, -1.25, 1);
const coverage = placement('coverageFlora', 'cap-coverage', 31, 13, 4.75, 0.6);
const bush = placement('bush', 'cover', 2, 3, 0, 0.8);
const bloom = placement('bloom', 'uat', 5, 8, 1, 1);
const islandless = placement('tree', 'cap-islandless', 20, 20, 0, 1);
const statusless = placement('tree', 'cap-statusless', 25, 25, 0, 1);

const islandByPlacement = new Map<KitPlacement, string>([
  [tree, 'story-alpha'],
  [deadTree, 'story-beta'],
  [coverage, 'story-alpha'],
  [bush, 'story-alpha'],
  [bloom, 'story-alpha'],
  [statusless, 'story-beta'],
]);

const input: GroundInput = {
  revision: 17,
  cells: [],
  strips: [],
  placements: [tree, deadTree, coverage, bush, bloom, islandless, statusless],
  islandByPlacement,
  growthLayout: new Map(),
  casters: [],
};

const semanticByPlacement = new Map<KitPlacement, string>([
  [tree, 'healthy'],
  [deadTree, 'unhealthy'],
  [coverage, 'building'],
  [bush, 'healthy'],
  [bloom, 'healthy'],
  [islandless, 'healthy'],
]);

test('native-semantic-hit-records-carry-attributed-prop-identity-status-and-extent: eligible native placements retain their real provenance, root, relief, and scaled frozen dimensions', () => {
  const records = deriveNativePropHitRecords(input, semanticByPlacement);

  assert.deepEqual(records, [
    {
      storyId: 'story-alpha',
      capabilityId: 'cap-tree',
      status: 'healthy',
      root: { x: 11, z: -7 },
      relief: 2.5,
      footprint: KIT_FOOTPRINTS_2026_08_29.tree,
      height: KIT_HEIGHTS_2026_08_29.tree,
    },
    {
      storyId: 'story-beta',
      capabilityId: 'cap-dead',
      status: 'unhealthy',
      root: { x: -4, z: 19 },
      relief: -1.25,
      footprint: KIT_FOOTPRINTS_2026_08_29.deadTree,
      height: KIT_HEIGHTS_2026_08_29.deadTree,
    },
    {
      storyId: 'story-alpha',
      capabilityId: 'cap-coverage',
      status: 'building',
      root: { x: 31, z: 13 },
      relief: 4.75,
      footprint: KIT_FOOTPRINTS_2026_08_29.coverageFlora * 0.6,
      height: KIT_HEIGHTS_2026_08_29.coverageFlora * 0.6,
    },
  ]);
  assert.ok(records.every(Object.isFrozen), 'semantic records are immutable snapshots');
  assert.ok(records.every((record) => Object.isFrozen(record.root)), 'a record cannot expose a mutable placement root');
});

test('native-semantic-hit-records-never-invent-decorative-uat-or-missing-semantics: decorative, UAT, islandless, and statusless placements have no guessed hit record', () => {
  const records = deriveNativePropHitRecords(input, semanticByPlacement);

  assert.deepEqual(
    records.map((record) => record.capabilityId),
    ['cap-tree', 'cap-dead', 'cap-coverage'],
  );
});

test('native-semantic-hit-records-preserve-canonical-ground-inputs: deriving records leaves canonical placements, provenance, and casters untouched', () => {
  const placementsBefore = structuredClone(input.placements);
  const provenanceBefore = [...input.islandByPlacement.entries()].map(([entry, storyId]) => [input.placements.indexOf(entry), storyId]);
  const castersBefore = structuredClone(input.casters);

  deriveNativePropHitRecords(input, semanticByPlacement);

  assert.deepEqual(input.placements, placementsBefore);
  assert.deepEqual(
    [...input.islandByPlacement.entries()].map(([entry, storyId]) => [input.placements.indexOf(entry), storyId]),
    provenanceBefore,
  );
  assert.deepEqual(input.casters, castersBefore);
});
