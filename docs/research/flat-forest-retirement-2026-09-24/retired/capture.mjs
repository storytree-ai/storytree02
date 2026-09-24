#!/usr/bin/env node
// Staged before/after for the one-step retirement of the flat forest look (ADR-0608, ADR-0601).
// Adapted from ../coverage-emphasis/capture.mjs: the same frozen-API replay (the LAST arm's API
// bodies are acquired once and replayed byte for byte to every arm), reduced motion, the host's
// own wheel for zoom, and the raw mounted canvas read straight off the renderer. The caller owns
// the servers and the heavy lock; this starts and stops no server and makes no API write.
//
//   node capture.mjs --run --heavy-lock-held --out /tmp/<fresh> \
//     --arm flat=http://127.0.0.1:P1,/abs/main-worktree,?act2=intro \
//     --arm mounted=http://127.0.0.1:P1,/abs/main-worktree,?landMount=1&landMountProps=1&act2=intro \
//     --arm retired=http://127.0.0.1:P2,/abs/branch-worktree,?act2=intro
//
// Per arm it saves the full app at rest (opening framing), zoomed, and zoomed with one island
// selected (the selection lanes and shore rings), plus — for arms that mount the land — the raw
// canvas at each framing. It also counts, in the live DOM, the flat-picture marks that the
// retirement removes, so "the picture is gone" is a number and not a reading of a screenshot.
// Appearance is the owner's verdict, never this script's.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback) => { const i = argv.indexOf(flag); return i < 0 ? fallback : argv[i + 1]; };
if (!has('--run') || !has('--heavy-lock-held')) throw Error('Refusing browser launch without --run --heavy-lock-held');
const arms = argv.flatMap((a, i) => (a === '--arm' ? [argv[i + 1]] : [])).map((spec) => {
  const eq = spec.indexOf('=');
  const name = spec.slice(0, eq);
  const [origin, rawDir, query] = spec.slice(eq + 1).split(',');
  const dir = realpathSync(rawDir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return { name, origin: new URL(origin).origin, dir, query, head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') };
});
if (arms.length < 2) throw Error('Need at least two --arm');
const out = path.resolve(value('--out'));
if (!out.startsWith('/tmp/') || existsSync(out)) throw Error('--out must be a fresh /tmp directory');
const zoomSteps = Number(value('--zoom-steps', '8'));
const anchor = value('--zoom-anchor', '0.6,0.45').split(',').map(Number);
const viewport = { width: 1800, height: 1100 };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(path.join(arms[0].dir, 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');
mkdirSync(out, { recursive: true });
const manifest = { startedAt: new Date().toISOString(), viewport, zoomSteps, anchor, arms: arms.map(({ name, origin, dir, head, query, dirty }) => ({ name, origin, dir, head, query, dirty })), health: {}, captures: {}, errors: [] };
const save = () => writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// The flat picture the retirement removes, by the classes the studio's SVG layer used to draw it.
const FLAT_MARKS = {
  heroTrees: '.world-scene .story-tree, .world-scene use[href^="#veg-hero"], .world-scene image',
  coverageMarks: '.world-scene .parcel-flora, .world-scene .garden-flora',
  uatFlowers: '.world-scene .tall-flower-marker',
  roadPasses: '.world-scene .trail-shadow-pass path, .world-scene .trail-casing-pass path, .world-scene path.trail-fill, .world-scene .trail-ghost-pass path',
  board: '.world-scene .hex-empty',
  paintedGroundCells: '.world-scene .relaxed-land path[class], .world-scene .hex-land [class*="hex-top"]',
  paintedCoast: '.world-scene .coast-fill-group:not(.is-selected):not(.is-upstream):not(.is-downstream) .coast-fill',
};
const KEPT_MARKS = {
  nameplates: '.world-scene .world-plate',
  storyHitRects: '.world-scene .world-story-hit',
  capabilityGround: '.world-scene .parcel',
  nativePlantTargets: '.world-scene g.native-prop-targets > rect',
  selectionLanes: '.world-scene .trail-lane, .world-scene .trail-lit',
  shoreRings: '.world-scene .coast-fill-group.is-selected, .world-scene .coast-fill-group.is-upstream, .world-scene .coast-fill-group.is-downstream',
};

async function health(arm) {
  const body = await (await fetch(`${arm.origin}/api/health`, { cache: 'no-store' })).text();
  const v = JSON.parse(body);
  if (realpathSync(v.code?.directory ?? '/') !== arm.dir || v.code.head !== arm.head || v.code.stale !== false || v.store !== 'pg' || v.db !== 'ok') throw Error(`${arm.name}: wrong/stale host ${body}`);
  return v;
}

const payloads = new Map(); let frozen = false; let browser;
async function open(arm, acquire) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
  let fiber;
  context.on('request', (r) => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(r.url())) fiber = r.url(); });
  await context.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const key = `${url.pathname}${url.search}`;
    try {
      if (req.method() !== 'GET') throw Error(`refused ${req.method()} ${key}`);
      if (!payloads.has(key) && frozen) {
        // A request the frozen map did not make (the selected story's side panel): fetched ONCE from
        // the snapshot source and shared by every arm, and recorded, so no arm sees its own store.
        const res = await fetch(`${arms.at(-1).origin}${key}`, { cache: 'no-store' });
        const headers = Object.fromEntries(res.headers); for (const h of ['content-length', 'content-encoding', 'transfer-encoding']) delete headers[h];
        payloads.set(key, { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
        (manifest.lateRequests ??= []).push(key);
      }
      if (!payloads.has(key)) {
        if (!acquire) throw Error(`uncaptured API request: ${key}`);
        const res = await route.fetch({ timeout: 120_000 }); const body = await res.body();
        const headers = res.headers(); for (const h of ['content-length', 'content-encoding', 'transfer-encoding']) delete headers[h];
        payloads.set(key, { status: res.status(), headers, body });
      }
      const p = payloads.get(key);
      await route.fulfill({ status: p.status, headers: p.headers, body: p.body });
    } catch (e) { manifest.errors.push(`${arm.name}: ${e.message}`); await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => manifest.errors.push(`${arm.name} page: ${e.message}`));
  await page.goto(`${arm.origin}/${arm.query}#/tree`, { waitUntil: 'load', timeout: 180_000 });
  await page.bringToFront();
  await page.waitForFunction(() => document.querySelector('.act2-intro') && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'), null, { timeout: 180_000 });
  const mounted = (await page.locator('[data-testid="land-mount"]').count()) > 0;
  if (mounted) {
    await page.waitForSelector('[data-testid="land-mount"] canvas', { timeout: 180_000 });
    await page.evaluate(async (moduleUrl) => {
      const mod = await import(moduleUrl);
      const canvas = document.querySelector('[data-testid="land-mount"] canvas');
      let root;
      for (let i = 0; i < 600 && !root; i += 1) { const r = mod._roots.get(canvas); if (r?.store?.getState()?.gl) root = r; else await new Promise((res) => setTimeout(res, 50)); }
      if (!root) throw Error('no R3F root');
      window.__laneV = {
        gl: () => { const s = root.store.getState(); const c = s.camera; return { frame: s.gl.info.render.frame, mode: s.frameloop, requested: s.internal.frames, camera: { position: c.position.toArray(), zoom: c.zoom, projectionMatrix: c.projectionMatrix.toArray() } }; },
        pixels: () => { const s = root.store.getState(); s.gl.render(s.scene, s.camera); return s.gl.domElement.toDataURL('image/png'); },
      };
    }, fiber);
  }
  return { context, page, mounted };
}

async function settle(page, mounted) {
  let prev; let same = 0;
  for (let i = 0; i < 240; i += 1) {
    const s = await page.evaluate(() => ({
      gl: window.__laneV?.gl() ?? null,
      host: document.querySelector('.world-camera')?.getAttribute('transform'),
      progress: Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')),
      settled: window.__storytreeMotionSettled?.().settled,
    }));
    const fp = JSON.stringify({ camera: s.gl?.camera ?? null, host: s.host });
    same = fp === prev ? same + 1 : 0; prev = fp;
    const glQuiet = !mounted || (s.gl.mode === 'demand' && s.gl.requested === 0 && s.gl.frame > 0);
    if (same >= 3 && s.settled === true && s.progress === 1 && glQuiet) return s;
    await page.waitForTimeout(150);
  }
  throw Error('did not settle');
}

async function count(page, table) {
  return page.evaluate((t) => Object.fromEntries(Object.entries(t).map(([k, sel]) => [k, document.querySelectorAll(sel).length])), table);
}

async function shoot(page, mounted, arm, label) {
  const s = await settle(page, mounted);
  const cap = { host: s.host, camera: s.gl?.camera ?? null };
  if (mounted) {
    const raw = Buffer.from((await page.evaluate(() => window.__laneV.pixels())).split(',')[1], 'base64');
    cap.rawFile = `${arm.name}-${label}-land-raw.png`; writeFileSync(path.join(out, cap.rawFile), raw); cap.rawSha256 = hash(raw);
  }
  cap.fullFile = `${arm.name}-${label}.png`;
  await page.screenshot({ path: path.join(out, cap.fullFile) });
  cap.flatMarks = await count(page, FLAT_MARKS);
  cap.keptMarks = await count(page, KEPT_MARKS);
  cap.notice = await page.evaluate(() => document.querySelector('.land-view-notice')?.textContent ?? null);
  manifest.captures[`${arm.name}-${label}`] = cap;
  save();
}

async function zoom(page) {
  const box = await page.locator('.world-viewport').boundingBox();
  await page.mouse.move(box.x + box.width * anchor[0], box.y + box.height * anchor[1]);
  for (let i = 0; i < zoomSteps; i += 1) { await page.mouse.wheel(0, -100); await page.waitForTimeout(120); }
}

// Select one island through the host's own route: a real click on its nameplate. The island is the
// one whose nameplate sits nearest the zoom anchor in the FIRST arm (the same corpus and camera in
// every arm), fixed once and reused, so every arm selects the same story.
let chosen = value('--select', null);
async function select(page) {
  if (!chosen) {
    chosen = await page.evaluate((a) => {
      const vp = document.querySelector('.world-viewport').getBoundingClientRect();
      const ax = vp.x + vp.width * a[0]; const ay = vp.y + vp.height * a[1];
      let best = null; let bestD = Infinity;
      for (const g of document.querySelectorAll('.world-scene .hex-flora[data-story-id]')) {
        const r = g.querySelector('.world-plate-bg')?.getBoundingClientRect();
        if (!r || r.width === 0) continue;
        const cx = r.x + r.width / 2; const cy = r.y + r.height / 2;
        if (cx < vp.x || cx > vp.right || cy < vp.y || cy > vp.bottom) continue;
        const d = Math.hypot(cx - ax, cy - ay);
        if (d < bestD) { bestD = d; best = g.getAttribute('data-story-id'); }
      }
      return best;
    }, anchor);
    if (!chosen) throw Error('no nameplate on screen to select');
    manifest.selectStory = chosen;
  }
  const plate = page.locator(`.world-scene .hex-flora[data-story-id="${chosen}"] .world-plate-bg`).first();
  const box = await plate.boundingBox();
  if (!box) throw Error(`no nameplate for ${chosen}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction((id) => document.querySelector(`.world-scene .hex-flora.is-selected[data-story-id="${id}"]`), chosen, { timeout: 30_000 });
}

try {
  for (const arm of arms) manifest.health[arm.name] = await health(arm);
  browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  manifest.browser = browser.version();
  const source = arms.at(-1);
  const warm = await open(source, true); await warm.page.waitForTimeout(1500); await warm.context.close(); frozen = true;
  manifest.snapshot = { source: source.name, frozenAt: new Date().toISOString(), sha256: hash(JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, hash(v.body)]))), storyCount: JSON.parse(payloads.get('/api/tree').body.toString()).stories.length };
  for (const arm of arms) {
    const { context, page, mounted } = await open(arm, false);
    manifest.captures[`${arm.name}-mounted`] = mounted;
    await shoot(page, mounted, arm, 'rest');
    if (zoomSteps) { await zoom(page); await shoot(page, mounted, arm, 'zoom'); }
    await select(page); await shoot(page, mounted, arm, 'zoom-selected');
    await context.close();
  }
  for (const label of ['rest', 'zoom']) {
    const hosts = arms.map((a) => manifest.captures[`${a.name}-${label}`]?.host);
    manifest[`sameHostCamera-${label}`] = hosts.every((h) => h === hosts[0]);
  }
  for (const arm of arms) { const v = await health(arm); if (v.code.head !== arm.head) throw Error(`${arm.name} drifted`); }
  if (manifest.errors.length) throw Error(manifest.errors.join('\n'));
  manifest.status = 'CAPTURED';
} catch (e) { manifest.status = 'FAILED'; manifest.failure = e.stack; process.exitCode = 1; console.error(e.stack); }
finally { if (browser) await browser.close(); manifest.finishedAt = new Date().toISOString(); save(); }
