// export-spacing-scenes.mjs — walk the ADR-0521 spacing ladder through the RUNNING studio and export,
// per rung, the scene graph the 2D map actually built, so the 3D comparison page renders the REAL
// forest as this map lays it out rather than a synthetic crowd.
//
// Run the studio on a port of your own (never 5173 — a sibling worktree may own it; the memory
// `strictport-vite-collision-measures-a-siblings-worktree` is exactly this), then from `apps/studio`:
//
//   ST_STUDIO_URL=http://127.0.0.1:<port> node scripts/export-spacing-scenes.mjs
//
// It writes, for the control and every rung of `ISLAND_SPACING_RUNGS`:
//   docs/research/chapter2-forest-spacing-2026-09-06/scenes/<arm>.json    the scene graph (pruned to
//                                       what the 3D mapper reads — `pruneSceneForMapper`) + layout bookkeeping
//   docs/research/chapter2-forest-spacing-2026-09-06/scenes/manifest.json which arms, from which corpus, when
//   docs/research/chapter2-forest-spacing-2026-09-06/2d-<arm>-<view>.png  the 2D studio map itself
//
// ⚠ IT READS THE DELIVERED SCENE OFF THE PAGE, never a re-derivation. The bridge (`?sceneExport=1`,
// `src/lib/sceneExport.ts`) parks the exact `buildScene(worldToScene(buildWorld(...)))` the map drew
// on `window`, so what the 3D page renders is byte-for-byte the 2D map's own layout at that rung —
// same live corpus, same fold, same vegetation. A driver that rebuilt the world in Node would be a
// second layout that could drift from the shipped one, and TreeView cannot be imported under Node
// anyway (it pulls the whole studio behind it).
//
// ⚠ FAIL CLOSED ON A HALF-LOADED MAP — the corpus streams in and the world is rebuilt as it does, so
// an early read exports a forest that is not there yet. Same discipline as `capture-resting-view.mjs`:
// wait for the app's real motion-settled signal, refuse below an island floor, then read.
//
// ⚠ THE SERVER MUST BE THIS WORKTREE'S. `/api/health` stamps the directory the server runs from; the
// export refuses a server that is not this checkout, because the scenes would carry a sibling's
// packer and the ladder would judge someone else's code.
//
// Ordinary composition screenshots belong to `pnpm storytree forest capture`; this script remains
// for the spacing ladder's exact scene exports, 2D metrics, and trail-survival checks.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import {
  ISLAND_SPACING_RATIO,
  ISLAND_SPACING_RUNGS,
  PRE_ADR0521_SPACING,
  SPACING_CONTROL_ARM,
  spacingArmId,
} from '@storytree/forest-layout';
import { pruneSceneForMapper } from '../src/lib/sceneExport.ts';
import { waitForForestMotionAndCamera, waitForStableForest } from './lib/forest-capture-runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const URL_ = process.env['ST_STUDIO_URL'] ?? '';
const EVIDENCE_OUT = process.env['ST_SPACING_EVIDENCE_OUT'] ?? join(REPO, 'docs', 'research', 'chapter2-forest-spacing-2026-09-06');
// The scenes sit BESIDE the evidence, not in the harness: they are the layout per rung, which is
// evidence too, and the harness reaches them through its fenced `/reference/` route.
const SCENES_OUT = process.env['ST_SPACING_SCENES_OUT'] ?? join(EVIDENCE_OUT, 'scenes');
const VIEWPORT = { width: 1600, height: 1000 };
const MIN_ISLANDS = Number(process.env['ST_SPACING_MIN_ISLANDS'] ?? 30);

const fail = (why) => {
  console.error(`REFUSED: ${why}`);
  process.exit(1);
};

if (!URL_) fail('set ST_STUDIO_URL to the studio you started on a port of your own (e.g. http://127.0.0.1:5391)');
if (/:5173(\/|$)/.test(URL_)) fail('ST_STUDIO_URL points at 5173, the studio\'s default port — a sibling worktree may own it. Start your own on another port.');

/** The arms: the control (the pre-ADR-0521 absolute gaps, via the legacy triple) then each rung. */
const ARMS = [
  {
    id: SPACING_CONTROL_ARM,
    query: `rankGap=${PRE_ADR0521_SPACING.rankGap}&islandGap=${PRE_ADR0521_SPACING.islandGap}&rankSwing=${PRE_ADR0521_SPACING.rankSwing}`,
    spacing: { legacy: { ...PRE_ADR0521_SPACING } },
  },
  ...ISLAND_SPACING_RUNGS.map((ratio) => ({ id: spacingArmId(ratio), query: `spacing=${ratio}`, spacing: { ratio } })),
];
/** The two 2D views captured per arm: the whole forest fitted, and the designed resting view the map opens on. */
const VIEWS = [
  { id: 'fit', query: 'restingView=fit' },
  { id: 'resting', query: '' },
];

mkdirSync(SCENES_OUT, { recursive: true });
mkdirSync(EVIDENCE_OUT, { recursive: true });

// ---- the server is this worktree's
const health = await (await fetch(`${URL_}/api/health`)).json().catch((e) => fail(`no /api/health at ${URL_}: ${e}`));
if (!health || typeof health.code?.directory !== 'string') fail(`/api/health carries no code.directory — is ${URL_} a studio?`);
if (resolve(health.code.directory) !== REPO) {
  fail(`the studio at ${URL_} runs from ${health.code.directory}, not this worktree (${REPO}) — its packer is someone else's`);
}
if (health.store !== 'pg' || health.db !== 'ok') {
  fail(`the studio at ${URL_} is not on the live store (store=${health.store}, db=${health.db}) — the layout would be of a fixture, not the corpus`);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

/** Load one arm+view, wait for the corpus to settle, read the bridge and the delivered camera. */
async function capture(arm, view) {
  const url = `${URL_}/?${arm.query}${view.query ? `&${view.query}` : ''}&sceneExport=1#/tree`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
  try {
    await waitForStableForest(page, {
      label: `${arm.id}/${view.id}`,
      minIslands: MIN_ISLANDS,
      timeout: 90_000,
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  // Scene export is a distinct artifact-readiness condition; do not infer it from camera motion.
  await page.waitForFunction(() => window.__storytreeSceneExport !== undefined, null, { timeout: 60_000 });
  const cameraAttestation = await waitForForestMotionAndCamera(page, { timeout: 90_000 });
  if (!cameraAttestation.settled) fail(`${arm.id}/${view.id}: the camera moved after scene export became ready`);
  const read = await page.evaluate(() => {
    const b = window.__storytreeSceneExport;
    const byId = new Map();
    for (const el of document.querySelectorAll('[data-story-id]')) {
      const id = el.getAttribute('data-story-id');
      const r = el.getBoundingClientRect();
      const prev = byId.get(id);
      if (!prev || r.width * r.height > prev.w * prev.h) byId.set(id, { id, w: r.width, h: r.height, x: r.x, y: r.y });
    }
    return {
      bridge: JSON.stringify(b),
      islands2d: [...byId.values()],
    };
  });
  const png = join(EVIDENCE_OUT, `2d-${arm.id}-${view.id}.png`);
  await page.screenshot({ path: png });
  return { ...read, camera: cameraAttestation.camera, png };
}

const manifest = {
  generatedAt: new Date().toISOString(),
  studio: { url: URL_, head: health.code.head, branch: health.code.branch },
  shippedRatio: ISLAND_SPACING_RATIO,
  rungs: [...ISLAND_SPACING_RUNGS],
  control: SPACING_CONTROL_ARM,
  arms: [],
};
const twoD = [];

for (const arm of ARMS) {
  let bridgeJson = null;
  for (const view of VIEWS) {
    const r = await capture(arm, view);
    if (pageErrors.length) fail(`the page reported errors on ${arm.id}/${view.id}:\n  ${pageErrors.join('\n  ')}`);
    const bridge = JSON.parse(r.bridge);
    if (view.id === 'fit') {
      bridgeJson = bridge;
      // Pruned to what the mapper reads — the 2D grass, shrubs, plates and coast are drawn by nothing
      // in 3D and were four fifths of the bytes. The bookkeeping rides alongside untouched.
      const slim = { ...bridge, scene: pruneSceneForMapper(bridge.scene) };
      writeFileSync(join(SCENES_OUT, `${arm.id}.json`), JSON.stringify(slim));
      bridgeJson.slimBytes = JSON.stringify(slim).length;
    } else if (bridgeJson) {
      // the two views must be the SAME layout — the camera is the only thing the view flag changes
      const a = JSON.stringify(bridgeJson.world.islands);
      const b = JSON.stringify(bridge.world.islands);
      if (a !== b) fail(`${arm.id}: the fitted and resting views laid the forest out differently — the view flag moved the layout`);
    }
    const xs = r.islands2d.map((i) => i.x);
    const ys = r.islands2d.map((i) => i.y);
    const x2 = r.islands2d.map((i) => i.x + i.w);
    const y2 = r.islands2d.map((i) => i.y + i.h);
    twoD.push({
      arm: arm.id,
      view: view.id,
      islands: r.islands2d.length,
      scale: r.camera.scale,
      contentExtentPx: r.islands2d.length ? { w: Math.max(...x2) - Math.min(...xs), h: Math.max(...y2) - Math.min(...ys) } : null,
      medianIslandWidthPx: r.islands2d.length ? [...r.islands2d.map((i) => i.w)].sort((p, q) => p - q)[Math.floor(r.islands2d.length / 2)] : null,
      png: r.png,
    });
    console.log(`${arm.id.padEnd(14)} ${view.id.padEnd(8)} islands ${r.islands2d.length}  scale ${r.camera.scale}  → ${r.png}`);
  }
  manifest.arms.push({
    id: arm.id,
    spacing: arm.spacing,
    file: `${arm.id}.json`,
    islands: bridgeJson.world.islands.length,
    world: { width: bridgeJson.world.width, height: bridgeJson.world.height },
    trails: bridgeJson.trails,
    bytes: bridgeJson.slimBytes,
  });
}

writeFileSync(join(SCENES_OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(EVIDENCE_OUT, '2d-metrics.json'), `${JSON.stringify({ generatedAt: manifest.generatedAt, rows: twoD }, null, 2)}\n`);
await browser.close();

// ---- the trails survived (ADR-0520's consequence list, item 1) — verified, not assumed
const control = manifest.arms.find((a) => a.id === SPACING_CONTROL_ARM);
for (const a of manifest.arms) {
  if (a.trails.edges !== control.trails.edges) fail(`${a.id}: ${a.trails.edges} edges routed against the control's ${control.trails.edges} — an edge was lost in the re-layout`);
  if (a.trails.dropped.length !== control.trails.dropped.length) {
    fail(`${a.id}: ${a.trails.dropped.length} dropped edges against the control's ${control.trails.dropped.length}: ${JSON.stringify(a.trails.dropped)}`);
  }
  if (a.islands !== control.islands) fail(`${a.id}: ${a.islands} islands against the control's ${control.islands}`);
}
console.log(
  `\nexported ${manifest.arms.length} arms (${manifest.arms.map((a) => `${a.id} ${(a.bytes / 1024).toFixed(0)} KB`).join(', ')})\n` +
    `trails: every arm routes ${control.trails.edges} edges with ${control.trails.dropped.length} dropped — the network survived every re-layout\n` +
    `→ ${SCENES_OUT}\n→ ${EVIDENCE_OUT}`,
);
