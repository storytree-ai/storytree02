// export-map-room.mjs — THE OWNER'S LOOK FOR ADR-0598: how much room the map gives its own labels.
//
// Run the studio on a port of your own (never 5173 — a sibling worktree may own it; the memory
// `strictport-vite-collision-measures-a-siblings-worktree` is exactly this), then from `apps/studio`:
//
//   ST_STUDIO_URL=http://127.0.0.1:<port> node --import tsx scripts/export-map-room.mjs
//
// ⚠ EVERY ARM IS THE SAME BUILD, and that is the point rather than a convenience. ADR-0598's two
// changes are both reachable as URL dials — `?spacing=<ratio>` is ADR-0521's rung and
// `?plateRoom=<factor>` is the nameplate clearance, whose 0 is the pre-ADR-0598 map exactly — so the
// BEFORE arm here is rendered by the same server, from the same corpus, seconds apart from the after.
// The precedent sheet (`docs/research/packer-ground-space-2026-09-23/`) had to run two builds to say
// the same thing, and a comparison whose arms come from two builds can always be asked what ELSE
// moved between them.
//
// ⚠ THE FOUR ARMS ARE A LADDER AND A DECOMPOSITION AT ONCE. `before` is today's map; `room-only`
// turns on ONLY the label clearance, so whatever separates it from `before` is the overlap fix and
// nothing else; `shipped` adds the re-derived gap; `wider` is the scale-back rung above it. Reading
// them in that order says which change bought which part of the difference, which a before/after
// pair cannot.
//
// ⚠ FAIL CLOSED ON A HALF-LOADED MAP, and warm up on a DISTINCT url first — the corpus streams in
// and the resting frame is computed once on mount, so the first arm of a cold run reports a resting
// scale no other arm does, and a same-url navigation is a hash change that never remounts.
//
// ⚠ COMMIT NOTHING WHILE THIS RUNS. The studio banners a checkout that moved under it (`/api/health`
// stamps HEAD at server start), so a commit mid-run paints a yellow banner across every capture
// taken afterwards. Sequence: finish the code, commit, RESTART the server, then capture.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

import { ISLAND_SPACING_RATIO } from '@storytree/forest-layout';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..', '..');
const URL_ = process.env['ST_STUDIO_URL'] ?? '';
const OUT = process.env['ST_ROOM_OUT'] ?? join(REPO, 'docs', 'research', 'map-room-2026-09-23');
/** The same buffer `export-real-forest.mjs` and the 3D harness use, so the pictures are comparable. */
const VIEWPORT = { width: 2560, height: 1600 };
const MIN_ISLANDS = Number(process.env['ST_ROOM_MIN_ISLANDS'] ?? 30);

const fail = (m) => { console.error(`export-map-room: ${m}`); process.exit(1); };

if (!URL_) fail('set ST_STUDIO_URL to a running studio on the live store');
if (/:5173(\/|$)/.test(URL_)) fail("ST_STUDIO_URL points at 5173, the studio's default port — a sibling worktree may own it. Start your own on another port.");

const health = await (await fetch(`${URL_}/api/health`)).json().catch((e) => fail(`no /api/health at ${URL_}: ${e}`));
if (!health || typeof health.code?.directory !== 'string') fail(`/api/health carries no code.directory — is ${URL_} a studio?`);
if (resolve(health.code.directory) !== REPO) fail(`the studio at ${URL_} runs from ${health.code.directory}, not this worktree (${REPO}) — its packer is someone else's`);
if (health.store !== 'pg' || health.db !== 'ok') fail(`the studio at ${URL_} is not on the live store (store=${health.store}, db=${health.db}) — the layout would be of a fixture, not the corpus`);
if (health.code.stale) fail('the studio reports a STALE checkout — it was started on a different commit. Restart it before capturing.');

const ARMS = [
  { id: 'before', query: 'spacing=0.1&plateRoom=0', caption: 'the map as it stands on main: the 2026-09-06 gap, no label clearance' },
  { id: 'room-only', query: 'spacing=0.1', caption: 'the label clearance alone, at the old gap — the overlap fix on its own' },
  { id: 'shipped', query: '', caption: `the landing: clearance + the re-derived gap (${ISLAND_SPACING_RATIO})` },
  { id: 'wider', query: 'spacing=1.5', caption: 'one rung wider, if the shipped one still reads tight' },
];
const VIEWS = [
  { id: 'fit', query: 'restingView=fit' },
  { id: 'resting', query: '' },
];

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

async function settle(url, label) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
  await page.waitForSelector('g.world-camera', { timeout: 90_000 });
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 160 && stable < 4; i += 1) {
    await page.waitForTimeout(500);
    const n = await page.evaluate(
      () => new Set([...document.querySelectorAll('[data-story-id]')].map((e) => e.getAttribute('data-story-id'))).size,
    );
    stable = n === last && n > 0 ? stable + 1 : 0;
    last = n;
  }
  if (last < MIN_ISLANDS) fail(`${label}: only ${last} islands settled (floor ${MIN_ISLANDS}) — the map never finished loading`);
  // ⚠ AND WAIT FOR THE PROVISIONAL-CACHE BADGE TO CLEAR (ADR-0240 D3's "cached paint is never
  // cached truth"). The map paints from the last visit's persisted entry while it revalidates, and
  // says so in a pill across the top. The island count is STABLE the whole time — it is the same
  // forest — so the settle loop above cannot see it, and the first arm of a cold run is captured
  // with a warning banner no later arm has. That is a comparison sheet whose arms differ by
  // something other than the thing being compared, which is the one failure a sheet must not have.
  await page.waitForFunction(
    () => document.querySelector(".tree-wrap[data-cache-provisional='true']") === null,
    null,
    { timeout: 60_000 },
  ).catch(() => fail(`${label}: the provisional-cache badge never cleared — the revalidation failed, so every later arm would be captured against a map this one is not`));
  return last;
}

async function capture(arm, view) {
  const q = [arm.query, view.query, 'sceneExport=1'].filter(Boolean).join('&');
  const islands = await settle(`${URL_}/?${q}#/tree`, `${arm.id}/${view.id}`);
  await page.waitForFunction(() => window.__storytreeSceneExport !== undefined, null, { timeout: 60_000 });
  await page.waitForTimeout(1000);
  const read = await page.evaluate(() => {
    const b = window.__storytreeSceneExport;
    const g = document.querySelector('g.world-camera');
    const t = g?.getAttribute('transform') ?? '';
    const m = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)\s*scale\(([-\d.]+)\)/.exec(t);
    const box = document.querySelector('g.world-camera')?.getBBox?.() ?? null;
    return {
      world: b?.world ? { width: b.world.width, height: b.world.height } : null,
      trails: b?.trails ? { edges: b.trails.edges, dropped: b.trails.dropped.length } : null,
      camera: { scale: m ? +m[3] : null },
      drawn: box ? { w: Math.round(box.width * (m ? +m[3] : 1)), h: Math.round(box.height * (m ? +m[3] : 1)) } : null,
    };
  });
  const png = join(OUT, `2d-${arm.id}-${view.id}.png`);
  await page.screenshot({ path: png });
  return { ...read, islands, png };
}

// The warm-up, on a url NO arm below uses — a same-url navigation is a hash change and keeps the
// warm-up's own resting frame, which is how the first arm of a run ends up the odd one out.
await settle(`${URL_}/?warmup=1#/tree`, 'warm-up');

const manifest = {
  generatedAt: new Date().toISOString(),
  studio: { url: URL_, head: health.code.head, branch: health.code.branch },
  shippedRatio: ISLAND_SPACING_RATIO,
  viewport: VIEWPORT,
  arms: [],
};
for (const arm of ARMS) {
  const row = { id: arm.id, query: arm.query, caption: arm.caption, views: {} };
  for (const view of VIEWS) {
    const r = await capture(arm, view);
    row.views[view.id] = {
      islands: r.islands,
      world: r.world,
      trails: r.trails,
      cameraScale: r.camera.scale,
      drawnPx: r.drawn,
      png: r.png.slice(REPO.length + 1),
    };
    console.log(`${arm.id.padEnd(10)} ${view.id.padEnd(8)} islands ${r.islands}  world ${r.world?.width?.toFixed(0)}x${r.world?.height?.toFixed(0)}  zoom ${r.camera.scale}  trails ${r.trails?.edges}/${r.trails?.dropped} dropped  → ${r.png}`);
  }
  manifest.arms.push(row);
}
if (pageErrors.length) fail(`the page threw during the run: ${pageErrors.join(' | ')}`);
writeFileSync(join(OUT, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await browser.close();
console.log(`\nmanifest → ${join(OUT, 'manifest.json')}`);
