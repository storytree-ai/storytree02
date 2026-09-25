// capture-resting-view.mjs — the FITTED vs DESIGNED resting frame, measured off the shipped map.
//
// Run the studio (`pnpm studio:up`), then from `apps/studio`:  node scripts/capture-resting-view.mjs
//
// ⚠ IT READS THE DELIVERED CAMERA OFF THE DOM, never off the module that computed it. The number
// reported is the `scale(...)` the browser is actually drawing the map with, and the island sizes
// are `getBoundingClientRect()` on the rendered territories — so a change that computes a beautiful
// scale and fails to apply it is a FALL, not a pass. This is the same discipline
// `harness/projection-probe.ts` adopted after the shipped map's scale was once reported off a
// hand-copied transcription of the framing code rather than off the wire.
//
// The two arms differ ONLY in the `?restingView=fit` query param, so the same build, the same
// corpus and the same paint produce both pictures and the comparison isolates the framing.
// Ordinary composition screenshots belong to `pnpm storytree forest capture`; this historical
// instrument remains because it compares fitted/designed framing and reports rendered island metrics.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

import { waitForStableForest } from './lib/forest-capture-runtime.mjs';

const OUT = process.env.RESTING_VIEW_OUT ?? '../../docs/research/resting-view-2026-08-28';
mkdirSync(OUT, { recursive: true });
const VIEWPORT = { width: 1600, height: 900 };
/** Refuse to report a framing measured on fewer islands than this. The live corpus is 35; the floor
 *  sits below it so a story landing or retiring does not red the instrument, and far above the 9
 *  that a mid-load capture produced. */
const MIN_ISLANDS = Number(process.env.RESTING_VIEW_MIN_ISLANDS ?? 30);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
page.on('console', (m) => { if (m.type() === 'error') console.error('  page error:', m.text().slice(0, 200)); });

/** Read the shipped camera transform straight off the DOM — the delivered scale, not a recomputation.
 *  `<g class="world-camera" transform="translate(tx ty) scale(s)">` is what the map actually draws with. */
async function measure(url, name) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 90_000 });
  // ⚠ FAIL CLOSED ON A HALF-LOADED MAP. The shared capture runtime waits for the app's real motion
  // signal after two animation frames, reads the delivered camera, and checks the live-corpus floor.
  const settled = await waitForStableForest(page, {
    label: name,
    minIslands: MIN_ISLANDS,
    timeout: 90_000,
  });
  const data = await page.evaluate(() => {
    // every island's drawn bounding box, in CSS px, as the browser lays it out
    // One entry per island: the OUTERMOST element carrying each story id, measured by the browser's
    // own layout. Several nested nodes carry `data-story-id`, so taking the largest box per id is
    // what makes this the island rather than one parcel inside it.
    const byId = new Map();
    for (const el of document.querySelectorAll('[data-story-id]')) {
      const id = el.getAttribute('data-story-id');
      const r = el.getBoundingClientRect();
      const prev = byId.get(id);
      if (!prev || r.width * r.height > prev.w * prev.h) {
        byId.set(id, { id, w: r.width, h: r.height, x: r.x, y: r.y });
      }
    }
    const islands = [...byId.values()];
    return { islands };
  });
  await page.screenshot({ path: `${OUT}/${name}.png` });
  return {
    ...data,
    transform: settled.camera.transform,
    tx: settled.camera.tx,
    ty: settled.camera.ty,
    scale: settled.camera.scale,
  };
}

const base = 'http://localhost:5173/#/';
const results = {};
results.fitted = await measure(`http://localhost:5173/?restingView=fit#/`, 'studio-fitted');
results.designed = await measure(base, 'studio-designed');
await browser.close();

for (const [k, v] of Object.entries(results)) {
  const n = v.islands.length;
  const ws = v.islands.map((i) => i.w).filter((w) => w > 0).sort((a, b) => a - b);
  const med = ws.length ? ws[Math.floor(ws.length / 2)] : null;
  const onScreen = v.islands.filter((i) => i.x + i.w > 0 && i.x < VIEWPORT.width && i.y + i.h > 0 && i.y < VIEWPORT.height);
  const xs = v.islands.flatMap((i) => [i.x, i.x + i.w]);
  const ys = v.islands.flatMap((i) => [i.y, i.y + i.h]);
  const drawnW = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const drawnH = ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
  console.log(`${k}: scale=${v.scale}  islands=${n}  medianIslandPx=${med?.toFixed(1)}  ` +
    `visible=${onScreen.length}/${n}  islandSpan=${drawnW.toFixed(0)}x${drawnH.toFixed(0)}  ` +
    `frameFill=${((Math.min(drawnW, VIEWPORT.width) * Math.min(drawnH, VIEWPORT.height)) / (VIEWPORT.width * VIEWPORT.height) * 100).toFixed(0)}%`);
}
console.log(JSON.stringify({ fittedScale: results.fitted.scale, designedScale: results.designed.scale, ratio: results.designed.scale / results.fitted.scale }, null, 2));
