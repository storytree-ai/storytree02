// shore-cost.mjs — THE LAND VIEW'S GROUND BUILD, ON THE CPU, WITHOUT A BROWSER.
//
// ⚠⚠ WHY A SECOND INSTRUMENT AT ALL, when `apps/studio/scripts/measure-land-view.mjs` already
// reports `shore-grid.ts`'s share of the load. That one is the VERDICT instrument: it drives the
// real studio through a production build and attributes real page CPU through source maps, and it
// costs a build, a server and several minutes per arm. It is the right thing to decide on and the
// wrong thing to iterate with. This one answers the narrower question — how long does ONE
// `buildAtlasShore` over the real forest take, and where inside it does the time go — in seconds,
// from the committed scene export, with no GPU and no page.
//
// ⚠ ITS NUMBERS ARE NOT THE STUDIO'S AND MUST NOT BE QUOTED AS THEM. Node's JIT is not Chrome's,
// nothing here pays React, and the committed export is the forest as it stood on 2026-09-08. What
// it is good for is a RATIO between two arms measured back to back on the same box, which is what
// a structural change to the shore build needs.
//
//   flock /tmp/storytree-heavy.lock pnpm --filter @storytree/forest-world-r3f measure-shore-cost
//
// Env: ST_SHORE_RUNS (default 3) — repeats per arm, reported with their spread.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { SHIPPED_COAST, clipToCoast } from '../src/coast-clip.ts';
import { shippedGroundBuild } from '../src/ForestWorldCanvas.tsx';
import { groundCasters } from '../src/ground-casters.ts';
import { shoreField } from '../src/shore-fall.ts';
import { SAND_FIELD_WIDTH, bucketByIsland, encodeShore } from '../src/shore-atlas.ts';

import { armStream } from './shipped-spacing-scene.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES = join(HERE, '..', '..', '..', 'docs', 'research', 'chapter2-real-forest-2026-09-08', 'scenes');
const RUNS = Number(process.env['ST_SHORE_RUNS'] ?? 3);

const manifest = JSON.parse(readFileSync(join(SCENES, 'manifest.json'), 'utf8'));
const record = manifest.arms[0];
const file = JSON.parse(readFileSync(join(SCENES, record.file), 'utf8'));
const arm = { record, file };

const stream = armStream(arm);
const cells = stream.filter((d) => d.kind === 'cell-ground');
const strips = stream.filter((d) => d.kind === 'trail-strip');
const casters = groundCasters(stream);

console.log(`forest        ${cells.length} parcels, ${new Set(cells.map((d) => d.island)).size} islands, ${casters.length} casters`);

/** One arm's repeats, reported with their spread — a single sample off this box has published a
 *  physical impossibility before (`harness/frame-budget.ts`), so nothing here prints one. */
const time = (what, fn) => {
  const samples = [];
  for (let run = 0; run < RUNS; run += 1) {
    const t = performance.now();
    fn();
    samples.push(performance.now() - t);
  }
  const sorted = [...samples].sort((a, b) => a - b);
  console.log(
    `${what.padEnd(22)} median ${sorted[Math.floor(sorted.length / 2)].toFixed(0).padStart(5)} ms   ` +
      `spread ${(sorted[sorted.length - 1] - sorted[0]).toFixed(0).padStart(4)} ms   (${samples.map((s) => s.toFixed(0)).join(', ')})`,
  );
};

const probe = shippedGroundBuild(cells, casters, strips);
if (probe.field === null) {
  console.error('REFUSED: the committed export bounds no ground — there is no atlas to pack over');
  process.exit(1);
}
console.log(
  `occlusion     ${probe.field.w} x ${probe.field.h} = ${probe.field.w * probe.field.h} texels ` +
    `over ${probe.field.tiles.length} tiles, gres ${probe.field.gres}`,
);

const clipped = clipToCoast(cells, SHIPPED_COAST);
const cellsByIsland = bucketByIsland(clipped);

time('clip + occlusion', () => shippedGroundBuild(cells, casters, strips));
time('shore (the subject)', () => shippedGroundBuild(cells, casters, strips).shore());
time('wear', () => shippedGroundBuild(cells, casters, strips).wear());

// ---------------------------------------------------------------- the no-op census
//
// ⚠ WHY THIS NUMBER AND NOT ANOTHER. `buildAtlasShore` FILLS the atlas with 255 before it packs a
// tile, because 255 is "far inland" — the byte that makes an unwritten texel deliver what the
// ground drew before the layer existed. So every texel whose sample encodes to 255 is written
// with the value it already had: a NO-OP that still paid a full neighbourhood scan. Their share is
// the ceiling on what any "skip what cannot change the atlas" change could ever buy, and it is
// measured here rather than reasoned about because the answer depends on the shape of the real
// forest's islands and not on anything a reader can derive.
let noop = 0;
let real = 0;
for (const tile of probe.field.tiles) {
  const own = cellsByIsland.get(tile.island) ?? clipped;
  const reader = shoreField(own, SAND_FIELD_WIDTH);
  for (let j = 0; j < tile.h; j += 1) {
    const z = tile.bounds.minZ + j / probe.field.gres;
    for (let i = 0; i < tile.w; i += 1) {
      if (encodeShore(reader.sample(tile.bounds.minX + i / probe.field.gres, z).distance) === 255) noop += 1;
      else real += 1;
    }
  }
}
console.log(
  `shore atlas    ${noop} of ${noop + real} texels encode to 255 (${((100 * noop) / (noop + real)).toFixed(1)}%) — ` +
    'written with the byte the atlas was already filled with',
);
