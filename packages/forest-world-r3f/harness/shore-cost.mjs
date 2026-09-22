// shore-cost.mjs — THE LAND VIEW'S SHORE WALK, ON THE CPU, WITHOUT A BROWSER.
//
// ⚠⚠ WHY A SECOND INSTRUMENT AT ALL, when `apps/studio/scripts/measure-land-view.mjs` already
// reports `shore-grid.ts`'s share of the land view's load. That one is the VERDICT instrument: it
// drives the real studio through a production build and attributes real page CPU through source
// maps, and it costs a build, a server and several minutes per arm. It is the right thing to
// decide on and the wrong thing to iterate with. This one answers the narrower question — what
// does the shore walk cost over the real forest's own texels, and how much of that work cannot
// change a byte — in seconds, from the committed scene export, with no GPU and no page.
//
// ⚠ ITS NUMBERS ARE NOT THE STUDIO'S AND MUST NOT BE QUOTED AS THEM. Node's JIT is not Chrome's,
// nothing here pays React, and the committed export is the forest as it stood on 2026-09-08.
//
// ⚠⚠ AND THE HEADLINE IS A RATIO BETWEEN TWO ARMS IN ONE PROCESS, NOT A WALL CLOCK, BECAUSE THIS
// BOX IS SHARED. Three sessions run concurrently on it, so a figure taken before a change and a
// figure taken after it are two different machines: measured 2026-09-23, an untouched stage moved
// 227 -> 312 ms between two runs of this file while its own code was byte-identical. The two arms
// below are therefore INTERLEAVED round-robin in ONE process over the SAME texels — the same
// remedy `harness/frame-budget.ts` records for the same box's thermal drift — so whatever else the
// machine is doing lands on both arms and cancels in the ratio.
//
// THE ARMS. Both run the SHIPPED `nearestOnSegments`; what differs is the grid handed to it.
//   · `mask` — the grid as `buildSegmentGrid` returns it, whose `far()` answers from the
//     precomputed near-cell mask in one array read.
//   · `scan` — the SAME grid with `far()` forced to false, which is exactly the path the walk took
//     before `shore-walk-short-circuits-through-the-mask`: every point, near or far, pays the
//     nine-cell `candidates` neighbourhood scan, and the far ones fall out of the
//     `candidates.length === 0` branch inside the walk.
// So the ratio is the cost of the short circuit and of nothing else. The `scan` arm is a control
// built from the shipped grid rather than a second implementation that could drift from it.
//
//   flock /tmp/storytree-heavy.lock pnpm --filter @storytree/forest-world-r3f measure-shore-cost
//
// Env: ST_SHORE_REPEATS (default 3) — repeats per arm, interleaved, reported with their spread.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

import { SHIPPED_COAST, clipToCoast, coastalIsland, rimLoops } from '../src/coast-clip.ts';
import { shippedGroundBuild } from '../src/ForestWorldCanvas.tsx';
import { groundCasters } from '../src/ground-casters.ts';
import { SAND_FIELD_WIDTH, bucketByIsland, encodeShore } from '../src/shore-atlas.ts';
import { buildEdgeGrid, nearestOnSegments } from '../src/shore-grid.ts';
import { armStream } from './shipped-spacing-scene.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES = join(HERE, '..', '..', '..', 'docs', 'research', 'chapter2-real-forest-2026-09-08', 'scenes');
const REPEATS = Number(process.env['ST_SHORE_REPEATS'] ?? 3);

const manifest = JSON.parse(readFileSync(join(SCENES, 'manifest.json'), 'utf8'));
const record = manifest.arms[0];
const file = JSON.parse(readFileSync(join(SCENES, record.file), 'utf8'));

const stream = armStreamOf({ record, file });
const cells = stream.filter((d) => d.kind === 'cell-ground');
const strips = stream.filter((d) => d.kind === 'trail-strip');
const casters = groundCasters(stream);
const clipped = clipToCoast(cells, SHIPPED_COAST);

const build = shippedGroundBuild(cells, casters, strips);
if (build.field === null) {
  console.error('REFUSED: the committed export bounds no ground — there is no atlas to pack over');
  process.exit(1);
}
const field = build.field;

console.log(`forest        ${cells.length} parcels, ${new Set(cells.map((d) => d.island)).size} islands`);
console.log(`atlas         ${field.w} x ${field.h} over ${field.tiles.length} tiles, gres ${field.gres}`);
console.log(`load          ${readFileSync('/proc/loadavg', 'utf8').trim().split(' ').slice(0, 3).join(' ')}   <- this box is shared; the ratio below is what survives that`);

// ---------------------------------------------------------------- the grids, once

const byIsland = bucketByIsland(clipped);
/** One grid per tile, built ONCE and reused by both arms — the build is not what is being
 *  measured, and rebuilding it per repeat would put the bucketing on the walk's ledger. */
const tiles = field.tiles.map((tile) => {
  const own = byIsland.get(tile.island) ?? clipped;
  const rings = [];
  for (const d of own) {
    if (coastalIsland(d) === null) continue;
    rings.push(d.points.map((p) => ({ x: p.x, z: p.z })));
  }
  return { tile, grid: buildEdgeGrid(rimLoops(rings), SAND_FIELD_WIDTH) };
});

// ---------------------------------------------------------------- the no-op census
//
// ⚠ WHY THIS NUMBER AND NOT ANOTHER. `buildAtlasShore` FILLS the atlas with 255 before it packs a
// tile, because 255 is "far inland" — the byte that makes an unwritten texel deliver what the
// ground drew before the layer existed. So every texel whose sample encodes to 255 is written with
// the value it already had: a NO-OP that still paid for its answer. Their share is the ceiling on
// what any "skip what cannot change the atlas" change could ever buy, and it is measured here
// rather than reasoned about because it depends on the shape of the real forest's islands.
let noop = 0;
let all = 0;
for (const { tile, grid } of tiles) {
  for (let j = 0; j < tile.h; j += 1) {
    const z = tile.bounds.minZ + j / field.gres;
    for (let i = 0; i < tile.w; i += 1) {
      const d = nearestOnSegments(grid, tile.bounds.minX + i / field.gres, z, SAND_FIELD_WIDTH).distance;
      if (encodeShore(d) === 255) noop += 1;
      all += 1;
    }
  }
}
console.log(
  `\nno-op census  ${noop} of ${all} shore texels encode to 255 (${((100 * noop) / all).toFixed(1)}%) — ` +
    'written with the byte the atlas was already filled with',
);
// ⚠ AND THE SHARE THE SHORT CIRCUIT CAN ACTUALLY REACH IS SMALLER THAN THAT, which is worth
// printing beside it rather than letting a reader treat the census as the headroom. A texel
// encodes to 255 whenever its distance reaches the cap; the short circuit fires only where the
// 3x3 cell neighbourhood is EMPTY, which is a strictly stronger condition — everything between
// the two is a texel that pays the full walk to arrive at 255 anyway.
let farCount = 0;
for (const { tile, grid } of tiles) {
  for (let j = 0; j < tile.h; j += 1) {
    const z = tile.bounds.minZ + j / field.gres;
    for (let i = 0; i < tile.w; i += 1) {
      if (grid.far(tile.bounds.minX + i / field.gres, z)) farCount += 1;
    }
  }
}
console.log(
  `short circuit ${farCount} of ${all} (${((100 * farCount) / all).toFixed(1)}%) are proved far by the mask — ` +
    'the share the walk can skip, which is the smaller number and the honest headroom',
);

// ---------------------------------------------------------------- the interleaved A/B

/** The whole shore walk over every tile's texels, through one grid view per tile. */
const walk = (view) => {
  let sink = 0;
  for (const { tile, grid } of tiles) {
    const g = view(grid);
    for (let j = 0; j < tile.h; j += 1) {
      const z = tile.bounds.minZ + j / field.gres;
      for (let i = 0; i < tile.w; i += 1) {
        sink += nearestOnSegments(g, tile.bounds.minX + i / field.gres, z, SAND_FIELD_WIDTH).distance;
      }
    }
  }
  return sink;
};

// ⚠ BOTH ARMS ARE A SPREAD COPY, and the one that needs no copy takes one anyway. `nearestOnSegments`
// is ONE call site: handing it the raw grid in one arm and a spread copy in the other makes that
// site polymorphic, V8 deoptimises the property loads for BOTH arms, and the deopt lands on the
// arm being measured. Two copies of the same shape keep the site monomorphic and the arms
// comparable — the confound is real and it compresses the difference toward zero, i.e. toward
// reporting that a change bought nothing.
const ARMS = [
  { id: 'mask', view: (grid) => ({ ...grid }) },
  // ⚠ THE CONTROL IS THE SHIPPED GRID WITH ONE ANSWER OVERRIDDEN, never a second implementation.
  // An A/B whose arms are secretly the same scene reports "no measurable difference" with the calm
  // authority of a real measurement (`harness/hardware-floor.ts` records paying for exactly that),
  // and an A/B whose control is a transcription reports the transcription's cost. Forcing `far` to
  // false is the smallest edit that puts the walk back on its pre-change path.
  { id: 'scan', view: (grid) => ({ ...grid, far: () => false }) },
];

const samples = new Map(ARMS.map((a) => [a.id, []]));
let sink = 0;
for (let r = 0; r < REPEATS; r += 1) {
  for (const arm of ARMS) {
    const t = performance.now();
    sink += walk(arm.view);
    samples.get(arm.id).push(performance.now() - t);
  }
}

console.log(`\nthe walk over every shore texel, ${REPEATS} interleaved repeats per arm`);
const medians = new Map();
for (const arm of ARMS) {
  const s = [...samples.get(arm.id)].sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  medians.set(arm.id, median);
  console.log(
    `  ${arm.id.padEnd(5)} median ${median.toFixed(0).padStart(5)} ms   spread ${(s[s.length - 1] - s[0]).toFixed(0).padStart(4)} ms   ` +
      `(${samples.get(arm.id).map((x) => x.toFixed(0)).join(', ')})`,
  );
}
const before = medians.get('scan');
const after = medians.get('mask');
const noise = Math.max(...ARMS.map((a) => Math.max(...samples.get(a.id)) - Math.min(...samples.get(a.id))));
const delta = before - after;
console.log(
  `\n  the short circuit is worth ${delta.toFixed(0)} ms of ${before.toFixed(0)} — ${((100 * delta) / before).toFixed(1)}% off the walk`,
);
// ⚠ WITHHELD RATHER THAN PRINTED BESIDE ITS OWN NOISE FLOOR. A delta smaller than the wider arm's
// own spread is a number a reader will quote, and quoting it is not careless — it was right there.
if (delta <= noise) {
  console.log(`  ⚠ UNVERIFIED — that delta does not clear the noise floor (${noise.toFixed(0)} ms). Re-run on a quieter box.`);
}
if (sink === Infinity) console.log('unreachable');

/** The committed 2D drawing, un-projected and sized exactly as `shipped-spacing-scene.ts` does it —
 *  imported rather than transcribed so this page cannot drift into a second pipeline. */
function armStreamOf(arm) {
  return armStream(arm);
}
