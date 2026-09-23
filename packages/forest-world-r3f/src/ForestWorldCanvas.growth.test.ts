// ForestWorldCanvas.growth.test.ts — the pure delivery seam applies the app-owned cursor to
// renderer descriptors while keeping the expensive ground's content cache independent of it.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type GroundVisibleDescriptor = {
  readonly id: string;
  readonly islandId: string;
  readonly kind: 'ground' | 'island' | 'pathway';
  readonly ground: string;
};

type RegrowCursor = {
  readonly progress: number;
  readonly settled: boolean;
  readonly absentIslandIds: ReadonlySet<string>;
  readonly growingIslandProgressById: ReadonlyMap<string, number>;
  readonly hiddenPathwayIds: ReadonlySet<string>;
  readonly drawingPathwayProgressById: ReadonlyMap<string, { readonly drawn: number; readonly fromEnd: boolean }>;
};

type Growth = {
  readonly ground: object;
  readonly islandProgressById: ReadonlyMap<string, number>;
  readonly visiblePathwayProgressById: ReadonlyMap<string, { readonly drawn: number; readonly fromEnd: boolean }>;
};

type ForestWorldGrowth = (
  descriptors: readonly GroundVisibleDescriptor[],
  cursor: RegrowCursor | null,
) => Growth;

const sourcePath = fileURLToPath(new URL('./ForestWorldCanvas.growth.ts', import.meta.url));
const sourceUrl = new URL('./ForestWorldCanvas.growth.ts', import.meta.url).href;

async function loadGrowthModule(): Promise<{ readonly forestWorldCanvasGrowth?: unknown }> {
  // The source is deliberately absent for CONFIRM_RED. Guarding the dynamic import makes that
  // absence the assertion below, rather than an un-attributable module-resolution failure.
  return existsSync(sourcePath) ? import(sourceUrl) : {};
}

function descriptors(): GroundVisibleDescriptor[] {
  return [
    { id: 'ground-a', islandId: 'island-a', kind: 'ground', ground: 'healthy' },
    { id: 'island-a', islandId: 'island-a', kind: 'island', ground: 'healthy' },
    { id: 'path-a', islandId: 'island-a', kind: 'pathway', ground: 'healthy' },
    { id: 'ground-b', islandId: 'island-b', kind: 'ground', ground: 'mapped' },
    { id: 'island-b', islandId: 'island-b', kind: 'island', ground: 'mapped' },
    { id: 'path-b', islandId: 'island-b', kind: 'pathway', ground: 'mapped' },
  ];
}

async function growth(): Promise<ForestWorldGrowth> {
  const loaded = await loadGrowthModule();
  assert.equal(typeof loaded.forestWorldCanvasGrowth, 'function');
  return loaded.forestWorldCanvasGrowth as ForestWorldGrowth;
}

test('fcd-ground-cache-compares-content-without-serializing: equal fresh descriptor content reuses the exact ground input', async () => {
  const compose = await growth();
  const input = descriptors();
  const first = compose(input, null);
  const equalFresh = compose(descriptors(), null);

  assert.deepEqual(first.ground, { descriptors: input });
  assert.equal(equalFresh.ground, first.ground);
});

test('fcd-ground-cache-compares-content-without-serializing: a longer equal-prefix input replaces the cached ground', async () => {
  const compose = await growth();
  const input = descriptors();
  const first = compose(input, null);
  const longer = [...input, { id: 'ground-c', islandId: 'island-c', kind: 'ground' as const, ground: 'mapped' }];
  const result = compose(longer, null);

  assert.notEqual(result.ground, first.ground);
  assert.deepEqual(result.ground, { descriptors: longer });
});

test('fcd-ground-cache-short-circuits-on-first-change: each descriptor identity field distinguishes the cached ground', async () => {
  const compose = await growth();
  const changes: Partial<GroundVisibleDescriptor>[] = [
    { id: 'other-ground' },
    { islandId: 'other-island' },
    { kind: 'island' },
  ];
  for (const change of changes) {
    const input = descriptors();
    const first = compose(input, null);
    const changed = descriptors();
    changed[0] = { ...changed[0]!, ...change };
    const result = compose(changed, null);

    assert.notEqual(result.ground, first.ground, `changing ${Object.keys(change)[0]} invalidates the cache`);
    assert.deepEqual(result.ground, { descriptors: changed });
  }
});

test('fcd-ground-cache-compares-content-without-serializing: sparse arrays on either side are cache misses', async () => {
  const compose = await growth();
  const dense = descriptors();
  const sparse = descriptors();
  delete sparse[0];

  const first = compose(dense, null);
  const withHole = compose(sparse, null);
  assert.notEqual(withHole.ground, first.ground);
  assert.deepEqual(withHole.ground, { descriptors: sparse });

  const restored = compose(descriptors(), null);
  assert.notEqual(restored.ground, withHole.ground);
  assert.deepEqual(restored.ground, { descriptors: dense });
});

test('fcd-ground-cache-short-circuits-on-first-change: the first ground-visible change replaces the cached ground input', async () => {
  const compose = await growth();
  const first = compose(descriptors(), null);
  const changed = descriptors();
  changed[0] = { ...changed[0]!, ground: 'unhealthy' };

  assert.notEqual(compose(changed, null).ground, first.ground);
});

test('fcd-regrow-cursor-projects-without-a-second-clock: structural cursor progress is presented verbatim', async () => {
  const compose = await growth();
  const result = compose(descriptors(), {
    progress: 0.375,
    settled: false,
    absentIslandIds: new Set(['island-b']),
    growingIslandProgressById: new Map([['island-a', 0.625]]),
    hiddenPathwayIds: new Set(['path-b']),
    drawingPathwayProgressById: new Map([['path-a', { drawn: 0.75, fromEnd: true }]]),
  });

  assert.deepEqual(result.islandProgressById, new Map([['island-a', 0.625]]));
});

test('fcd-regrow-progress-uses-explicit-island-identity: only the named growing island receives its local progress', async () => {
  const compose = await growth();
  const result = compose(descriptors(), {
    progress: 0.5,
    settled: false,
    absentIslandIds: new Set(),
    growingIslandProgressById: new Map([['island-b', 0.4]]),
    hiddenPathwayIds: new Set(),
    drawingPathwayProgressById: new Map(),
  });

  assert.deepEqual(result.islandProgressById, new Map([['island-b', 0.4]]));
  assert.equal(result.islandProgressById.has('island-a'), false);
});

test('fcd-regrow-pathways-clip-at-physical-fronts: hidden pathways are absent and drawing pathways preserve their physical front', async () => {
  const compose = await growth();
  const result = compose(descriptors(), {
    progress: 0.5,
    settled: false,
    absentIslandIds: new Set(),
    growingIslandProgressById: new Map(),
    hiddenPathwayIds: new Set(['path-b']),
    drawingPathwayProgressById: new Map([['path-a', { drawn: 0.25, fromEnd: true }]]),
  });

  assert.deepEqual(result.visiblePathwayProgressById, new Map([['path-a', { drawn: 0.25, fromEnd: true }]]));
  assert.equal(result.visiblePathwayProgressById.has('path-b'), false);
});
