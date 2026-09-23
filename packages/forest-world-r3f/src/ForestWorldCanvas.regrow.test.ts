// ForestWorldCanvas.regrow.test.ts — the delivery seam projects the app-owned
// regrow cursor without creating a renderer-side schedule or clock.

import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

type Presentation = {
  readonly progress: number;
  readonly hiddenIslandIds: ReadonlySet<string>;
  readonly growingIslandProgressById: ReadonlyMap<string, number>;
  readonly hiddenSegmentIds: ReadonlySet<string>;
  readonly drawingSegmentProgressById: ReadonlyMap<string, { readonly drawn: number; readonly fromEnd: boolean }>;
};

type RegrowPresentation = (cursor: unknown) => Presentation | null;

const sourcePath = fileURLToPath(new URL('./ForestWorldCanvas.regrow.ts', import.meta.url));
const sourceUrl = new URL('./ForestWorldCanvas.regrow.ts', import.meta.url).href;

async function loadRegrowModule(): Promise<{ readonly forestRegrowPresentation?: unknown }> {
  // The source does not exist for this test's first observation. Guarding the import makes that
  // absence an assertion red below, rather than a Bun module-resolution failure before a test runs.
  return existsSync(sourcePath) ? import(sourceUrl) : {};
}

test('fcd-regrow-cursor-projects-without-a-second-clock: exports the cursor presentation adapter', async () => {
  const loaded = await loadRegrowModule();

  assert.equal(typeof loaded.forestRegrowPresentation, 'function');
});

test('fcd-regrow-cursor-projects-without-a-second-clock: projects structural cursor state verbatim and clears terminal cursors', async () => {
  const loaded = await loadRegrowModule();
  assert.equal(typeof loaded.forestRegrowPresentation, 'function');
  const forestRegrowPresentation = loaded.forestRegrowPresentation as RegrowPresentation;

  const presentation = forestRegrowPresentation({
    progress: 0.375,
    settled: false,
    landedStoryIds: new Set(['island-settled']),
    growing: [{ storyId: 'island-growing', progress: 0.625 }],
    presentStoryIds: new Set(['island-settled', 'island-growing']),
    absentStoryIds: new Set(['island-absent']),
    hiddenSegmentIds: new Set(['segment-hidden']),
    drawingSegments: [{ id: 'segment-drawing', drawn: 0.75, fromEnd: true }],
    arrivalStoryIds: ['island-growing'],
  });

  assert.ok(presentation !== null);
  assert.equal(presentation.progress, 0.375);
  assert.deepEqual(presentation.hiddenIslandIds, new Set(['island-absent']));
  assert.deepEqual(presentation.growingIslandProgressById, new Map([['island-growing', 0.625]]));
  assert.deepEqual(presentation.hiddenSegmentIds, new Set(['segment-hidden']));
  assert.deepEqual(
    presentation.drawingSegmentProgressById,
    new Map([['segment-drawing', { drawn: 0.75, fromEnd: true }]]),
  );

  assert.equal(forestRegrowPresentation(null), null);
  assert.equal(
    forestRegrowPresentation({
      progress: 1,
      settled: true,
      landedStoryIds: new Set(['island-settled']),
      growing: [],
      presentStoryIds: new Set(['island-settled']),
      absentStoryIds: new Set(),
      hiddenSegmentIds: new Set(),
      drawingSegments: [],
      arrivalStoryIds: [],
    }),
    null,
  );
});
