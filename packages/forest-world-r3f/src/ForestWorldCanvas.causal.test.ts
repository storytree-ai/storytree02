// ForestWorldCanvas.causal.test.ts — causal presentation helpers for the mounted forest.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import type { ForestRegrowPresentation } from './ForestWorldCanvas.regrow.js';
import type { InstanceDescriptor, Transform3D } from './world-to-3d.js';

type IslandGrowthLayout = {
  readonly islandId: string;
  readonly slot: number;
  readonly anchor: Transform3D;
};

type CausalModule = {
  readonly islandGrowthLayout?: unknown;
  readonly islandGrowthProgress?: unknown;
  readonly regrowTrailPoints?: unknown;
};

type IslandGrowthLayoutFn = (cells: readonly InstanceDescriptor[]) => ReadonlyMap<string, IslandGrowthLayout>;
type IslandGrowthProgressFn = (layout: IslandGrowthLayout, presentation: ForestRegrowPresentation | null) => number;
type RegrowTrailPointsFn = (
  strip: InstanceDescriptor,
  presentation: ForestRegrowPresentation | null,
) => readonly Transform3D[] | undefined;

const sourcePath = fileURLToPath(new URL('./ForestWorldCanvas.causal.ts', import.meta.url));
const sourceUrl = new URL('./ForestWorldCanvas.causal.ts', import.meta.url).href;

async function loadCausalModule(): Promise<CausalModule> {
  // The implementation is deliberately absent during CONFIRM_RED. Guarding this import turns
  // that absence into the named assertions below instead of a module-resolution failure.
  return existsSync(sourcePath) ? import(sourceUrl) : {};
}

async function causal(): Promise<{
  islandGrowthLayout: IslandGrowthLayoutFn;
  islandGrowthProgress: IslandGrowthProgressFn;
  regrowTrailPoints: RegrowTrailPointsFn;
}> {
  const loaded = await loadCausalModule();
  assert.equal(typeof loaded.islandGrowthLayout, 'function');
  assert.equal(typeof loaded.islandGrowthProgress, 'function');
  assert.equal(typeof loaded.regrowTrailPoints, 'function');
  return loaded as {
    islandGrowthLayout: IslandGrowthLayoutFn;
    islandGrowthProgress: IslandGrowthProgressFn;
    regrowTrailPoints: RegrowTrailPointsFn;
  };
}

function cell(island: string, points: Transform3D[]): InstanceDescriptor {
  return {
    kind: 'cell-ground',
    group: 'cell-ground',
    island,
    transform: points[0] ?? { x: 0, y: 0, z: 0 },
    points,
  };
}

function strip(segment: string | undefined, points: Transform3D[]): InstanceDescriptor {
  return {
    kind: 'trail-strip',
    group: 'trail-strip',
    transform: points[0] ?? { x: 0, y: 0, z: 0 },
    ...(segment === undefined ? {} : { segment }),
    points,
  };
}

function presentation(overrides: Partial<ForestRegrowPresentation> = {}): ForestRegrowPresentation {
  return {
    progress: 0.5,
    hiddenIslandIds: new Set(),
    growingIslandProgressById: new Map(),
    hiddenSegmentIds: new Set(),
    drawingSegmentProgressById: new Map(),
    ...overrides,
  };
}

function groundCells(): InstanceDescriptor[] {
  return [
    cell('island-b', [{ x: 10, y: 2, z: 0 }, { x: 14, y: 2, z: 4 }]),
    { kind: 'trail-strip', group: 'trail-strip', transform: { x: 99, y: 0, z: 99 }, points: [] },
    cell('island-a', [{ x: -4, y: 2, z: -2 }, { x: 0, y: 2, z: 2 }]),
    cell('island-a', [{ x: 2, y: 2, z: -4 }, { x: 6, y: 2, z: 6 }]),
  ];
}

test('fcd-ground-cache-compares-content-without-serializing: equal fresh ground cells derive equal island layouts', async () => {
  const { islandGrowthLayout } = await causal();

  const first = islandGrowthLayout(groundCells());
  const equalFresh = islandGrowthLayout(groundCells());

  assert.deepEqual(equalFresh, first);
  assert.deepEqual([...first.values()], [
    { islandId: 'island-a', slot: 0, anchor: { x: 1, y: 2, z: 1 } },
    { islandId: 'island-b', slot: 1, anchor: { x: 12, y: 2, z: 2 } },
  ]);
});

test('fcd-ground-cache-short-circuits-on-first-change: a changed first cell vertex changes only that island anchor', async () => {
  const { islandGrowthLayout } = await causal();
  const original = groundCells();
  const changed = groundCells();
  changed[0] = cell('island-b', [{ x: 20, y: 2, z: 0 }, { x: 14, y: 2, z: 4 }]);

  const before = islandGrowthLayout(original);
  const after = islandGrowthLayout(changed);

  assert.deepEqual(before.get('island-a'), after.get('island-a'));
  assert.deepEqual(after.get('island-b'), { islandId: 'island-b', slot: 1, anchor: { x: 17, y: 2, z: 2 } });
});

test('fcd-regrow-cursor-projects-without-a-second-clock: null, hidden, named growth, and settled presentation project without time', async () => {
  const { islandGrowthLayout, islandGrowthProgress } = await causal();
  const layout = islandGrowthLayout(groundCells()).get('island-a');
  assert.ok(layout !== undefined);

  assert.equal(islandGrowthProgress(layout, null), 1);
  assert.equal(islandGrowthProgress(layout, presentation({ hiddenIslandIds: new Set(['island-a']) })), 0);
  assert.equal(islandGrowthProgress(layout, presentation({ growingIslandProgressById: new Map([['island-a', 0.375]]) })), 0.375);
  assert.equal(islandGrowthProgress(layout, presentation()), 1);
});

test('fcd-regrow-progress-uses-explicit-island-identity: hidden identity wins over contradictory local progress', async () => {
  const { islandGrowthLayout, islandGrowthProgress } = await causal();
  const layouts = islandGrowthLayout(groundCells());
  const islandA = layouts.get('island-a');
  const islandB = layouts.get('island-b');
  assert.ok(islandA !== undefined);
  assert.ok(islandB !== undefined);
  const state = presentation({
    hiddenIslandIds: new Set(['island-a']),
    growingIslandProgressById: new Map([['island-a', 0.8], ['island-b', 0.25]]),
  });

  assert.equal(islandGrowthProgress(islandA, state), 0);
  assert.equal(islandGrowthProgress(islandB, state), 0.25);
});

test('fcd-regrow-pathways-clip-at-physical-fronts: strips retain physical prefixes and suffixes without mutating their source', async () => {
  const { regrowTrailPoints } = await causal();
  const sourcePoints = [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }];
  const trail = strip('trail-a', sourcePoints);
  const hidden = strip('trail-hidden', sourcePoints);
  const unnamed = strip(undefined, sourcePoints);
  const state = presentation({
    hiddenSegmentIds: new Set(['trail-hidden']),
    drawingSegmentProgressById: new Map([
      ['trail-a', { drawn: 0.5, fromEnd: false }],
      ['trail-reverse', { drawn: 0.5, fromEnd: true }],
      ['trail-empty', { drawn: 0, fromEnd: false }],
      ['trail-full', { drawn: 1, fromEnd: false }],
    ]),
  });

  assert.deepEqual(regrowTrailPoints(trail, state), [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 0.5 }]);
  assert.deepEqual(regrowTrailPoints(strip('trail-reverse', sourcePoints), state), [{ x: 3, y: 0, z: 0.5 }, { x: 3, y: 0, z: 4 }]);
  assert.deepEqual(regrowTrailPoints(hidden, state), []);
  assert.deepEqual(regrowTrailPoints(strip('trail-empty', sourcePoints), state), []);
  assert.equal(regrowTrailPoints(strip('trail-full', sourcePoints), state), sourcePoints);
  assert.equal(regrowTrailPoints(trail, null), sourcePoints);
  assert.equal(regrowTrailPoints(unnamed, state), sourcePoints);
  assert.deepEqual(sourcePoints, [{ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }]);
});
