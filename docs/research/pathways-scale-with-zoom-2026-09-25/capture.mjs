#!/usr/bin/env node
// Pathways must not thicken as you zoom out (owner, 2026-09-25) — measure BOTH road layers at three
// zooms on the real forest, and photograph the same place at each. Adapted from
// ../flat-forest-retirement-2026-09-24/retired/capture.mjs: a frozen API snapshot replayed byte for
// byte (saved to disk so a later arm replays the SAME forest), reduced motion, the host's own wheel
// for zoom around one fixed anchor, and the raw mounted canvas read straight off the renderer. The
// caller owns the server and the heavy lock; this starts and stops no server and makes no API write.
//
//   node capture.mjs --run --heavy-lock-held --out /tmp/<fresh> --arm before=http://127.0.0.1:P,/abs/worktree \
//     [--snapshot-save /tmp/snap.json | --snapshot-load /tmp/snap.json]
//
// Per zoom (rest = the studio's opening view, in = 8 wheel notches in, out = wheeled out to the
// zoom-out floor) it records:
//   - the SVG camera scale and the 3D camera zoom (CSS px per ground unit — they must agree);
//   - each 3D road ribbon's declared width and whether it is in WORLD units or SCREEN pixels;
//   - the 3D roads' MEASURED on-screen width: pixels that change when the ribbons are hidden,
//     divided by the ribbons' projected on-screen length (both over the visible frame);
//   - the SVG layer's road-lane widths on screen (stroke width x the element's screen scale);
//   - the median island width on screen (the story hit rects), and each road width AS A RATIO of it.
// A road that scales with the land keeps the ratio constant across the three zooms.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const value = (flag, fallback) => { const i = argv.indexOf(flag); return i < 0 ? fallback : argv[i + 1]; };
if (!has('--run') || !has('--heavy-lock-held')) throw Error('Refusing browser launch without --run --heavy-lock-held');
const arms = argv.flatMap((a, i) => (a === '--arm' ? [argv[i + 1]] : [])).map((spec) => {
  const eq = spec.indexOf('=');
  const name = spec.slice(0, eq);
  const [origin, rawDir, query = ''] = spec.slice(eq + 1).split(',');
  const dir = realpathSync(rawDir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return { name, origin: new URL(origin).origin, dir, query, head: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain') };
});
if (arms.length < 1) throw Error('Need at least one --arm');
const out = path.resolve(value('--out'));
if (!out.startsWith('/tmp/') || existsSync(out)) throw Error('--out must be a fresh /tmp directory');
const anchor = value('--zoom-anchor', '0.5,0.5').split(',').map(Number);
const viewport = { width: 1800, height: 1100 };
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(path.join(arms[0].dir, 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');
mkdirSync(out, { recursive: true });
const manifest = { startedAt: new Date().toISOString(), viewport, anchor, arms: arms.map(({ name, origin, dir, head, query, dirty }) => ({ name, origin, dir, head, query, dirty })), health: {}, captures: {}, errors: [] };
const save = () => writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

async function health(arm) {
  const body = await (await fetch(`${arm.origin}/api/health`, { cache: 'no-store' })).text();
  const v = JSON.parse(body);
  if (realpathSync(v.code?.directory ?? '/') !== arm.dir || v.code.head !== arm.head || v.code.stale !== false || v.store !== 'pg' || v.db !== 'ok') throw Error(`${arm.name}: wrong/stale host ${body}`);
  return v;
}

const payloads = new Map(); let frozen = false; let browser;
const loadFrom = value('--snapshot-load', null);
if (loadFrom) {
  for (const [k, p] of JSON.parse(readFileSync(loadFrom, 'utf8'))) payloads.set(k, { ...p, body: Buffer.from(p.body, 'base64') });
  frozen = true;
}
async function open(arm, acquire) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
  let fiber;
  context.on('request', (r) => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(r.url())) fiber = r.url(); });
  await context.route('**/api/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const key = `${url.pathname}${url.search}`;
    try {
      if (req.method() !== 'GET') throw Error(`refused ${req.method()} ${key}`);
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
  await page.waitForFunction(() => document.querySelector('.world-camera') && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'), null, { timeout: 180_000 });
  await page.waitForSelector('[data-testid="land-mount"] canvas', { timeout: 180_000 });
  await page.evaluate(async (moduleUrl) => {
    const mod = await import(moduleUrl);
    const canvas = document.querySelector('[data-testid="land-mount"] canvas');
    let root;
    for (let i = 0; i < 600 && !root; i += 1) { const r = mod._roots.get(canvas); if (r?.store?.getState()?.gl) root = r; else await new Promise((res) => setTimeout(res, 50)); }
    if (!root) throw Error('no R3F root');
    const state = () => root.store.getState();
    const ribbons = () => { const found = []; state().scene.traverse((o) => { if (o.isLine2 || o.material?.isLineMaterial) found.push(o); }); return found; };
    const grab = (hide) => {
      const s = state(); const rs = ribbons();
      const was = rs.map((r) => r.visible);
      if (hide) for (const r of rs) r.visible = false;
      s.gl.render(s.scene, s.camera);
      const c = s.gl.domElement; const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
      const ctx = cv.getContext('2d'); ctx.drawImage(c, 0, 0);
      rs.forEach((r, i) => { r.visible = was[i]; });
      return { data: ctx.getImageData(0, 0, c.width, c.height).data, w: c.width, h: c.height };
    };
    window.__laneZ = {
      gl: () => { const s = state(); const c = s.camera; return { frame: s.gl.info.render.frame, mode: s.frameloop, requested: s.internal.frames, camera: { position: c.position.toArray(), zoom: c.zoom } }; },
      pixels: () => { const s = state(); s.gl.render(s.scene, s.camera); return s.gl.domElement.toDataURL('image/png'); },
      roads3d: () => {
        const s = state(); const rs = ribbons();
        const on = grab(false); const off = grab(true);
        let changed = 0;
        for (let i = 0; i < on.data.length; i += 4) {
          const d = Math.abs(on.data[i] - off.data[i]) + Math.abs(on.data[i + 1] - off.data[i + 1]) + Math.abs(on.data[i + 2] - off.data[i + 2]);
          if (d > 24) changed += 1;
        }
        // Projected on-screen length of every ribbon, clipped to the frame (canvas px).
        const cssW = s.size.width; const cssH = s.size.height; const dpr = on.w / cssW;
        const inFrame = (p) => p.x >= 0 && p.x <= on.w && p.y >= 0 && p.y <= on.h;
        let length = 0;
        for (const r of rs) {
          const start = r.geometry.attributes.instanceStart; const end = r.geometry.attributes.instanceEnd;
          if (!start || !end) continue;
          for (let k = 0; k < start.count; k += 1) {
            const a = s.camera.position.clone().set(start.getX(k), start.getY(k), start.getZ(k)).applyMatrix4(r.matrixWorld).project(s.camera);
            const b = s.camera.position.clone().set(end.getX(k), end.getY(k), end.getZ(k)).applyMatrix4(r.matrixWorld).project(s.camera);
            const A = { x: (a.x + 1) / 2 * on.w, y: (1 - a.y) / 2 * on.h }; const B = { x: (b.x + 1) / 2 * on.w, y: (1 - b.y) / 2 * on.h };
            if (inFrame(A) && inFrame(B)) length += Math.hypot(B.x - A.x, B.y - A.y);
          }
        }
        const widths = rs.map((r) => r.material.linewidth);
        return {
          count: rs.length,
          worldUnits: [...new Set(rs.map((r) => Boolean(r.material.worldUnits)))],
          declaredWidth: { min: Math.min(...widths), max: Math.max(...widths) },
          changedPixels: changed, projectedLength: length, dpr,
          measuredWidthPx: length > 0 ? changed / length / dpr : null,
        };
      },
    };
  }, fiber);
  return { context, page };
}

async function settle(page) {
  let prev; let same = 0;
  for (let i = 0; i < 240; i += 1) {
    const s = await page.evaluate(() => ({
      gl: window.__laneZ?.gl() ?? null,
      host: document.querySelector('.world-camera')?.getAttribute('transform'),
      settled: window.__storytreeMotionSettled?.().settled,
    }));
    const fp = JSON.stringify({ camera: s.gl?.camera ?? null, host: s.host });
    same = fp === prev ? same + 1 : 0; prev = fp;
    const glQuiet = s.gl.mode === 'demand' && s.gl.requested === 0 && s.gl.frame > 0;
    if (same >= 3 && s.settled !== false && glQuiet) return s;
    await page.waitForTimeout(150);
  }
  throw Error('did not settle');
}

// The SVG layer's side: island width on screen, and every road/lane stroke's on-screen width.
async function svgSide(page) {
  return page.evaluate(() => {
    const median = (xs) => { const a = [...xs].sort((p, q) => p - q); return a.length ? a[Math.floor(a.length / 2)] : null; };
    const vp = document.querySelector('.world-viewport').getBoundingClientRect();
    const visible = (r) => r.width > 0 && r.right > vp.x && r.x < vp.right && r.bottom > vp.y && r.y < vp.bottom;
    const islands = [...document.querySelectorAll('.world-scene .world-story-hit')].map((e) => e.getBoundingClientRect()).filter(visible).map((r) => r.width);
    const strokes = (sel) => [...document.querySelectorAll(sel)].map((e) => {
      const m = e.getScreenCTM(); const sw = parseFloat(getComputedStyle(e).strokeWidth);
      return m && Number.isFinite(sw) ? sw * Math.hypot(m.a, m.b) : null;
    }).filter((x) => x !== null);
    const lanes = strokes('.world-scene .trail-lane, .world-scene .trail-lit');
    const cam = document.querySelector('.world-camera').getScreenCTM();
    return { svgScale: cam ? Math.hypot(cam.a, cam.b) : null, islandWidthPx: median(islands), islandsInView: islands.length, laneCount: lanes.length, laneWidthPx: lanes.length ? { min: Math.min(...lanes), median: median(lanes), max: Math.max(...lanes) } : null };
  });
}

async function shoot(page, arm, label) {
  const s = await settle(page);
  const cap = { host: s.host, camera: s.gl.camera, svg: await svgSide(page), roads3d: await page.evaluate(() => window.__laneZ.roads3d()) };
  const island = cap.svg.islandWidthPx;
  cap.ratios = {
    road3dToIsland: island && cap.roads3d.measuredWidthPx ? cap.roads3d.measuredWidthPx / island : null,
    lanesToIsland: island && cap.svg.laneWidthPx ? cap.svg.laneWidthPx.median / island : null,
  };
  const raw = Buffer.from((await page.evaluate(() => window.__laneZ.pixels())).split(',')[1], 'base64');
  cap.rawFile = `${arm.name}-${label}-land-raw.png`; writeFileSync(path.join(out, cap.rawFile), raw); cap.rawSha256 = hash(raw);
  cap.fullFile = `${arm.name}-${label}.png`;
  await page.screenshot({ path: path.join(out, cap.fullFile) });
  manifest.captures[`${arm.name}-${label}`] = cap;
  save();
}

async function wheel(page, notches) {
  const box = await page.locator('.world-viewport').boundingBox();
  await page.mouse.move(box.x + box.width * anchor[0], box.y + box.height * anchor[1]);
  for (let i = 0; i < Math.abs(notches); i += 1) { await page.mouse.wheel(0, notches < 0 ? 100 : -100); await page.waitForTimeout(120); }
}

// Select one island (a real nameplate click) so the SVG layer draws its road lanes.
async function selectNearest(page) {
  const id = await page.evaluate((a) => {
    const vp = document.querySelector('.world-viewport').getBoundingClientRect();
    const ax = vp.x + vp.width * a[0]; const ay = vp.y + vp.height * a[1];
    let best = null; let bestD = Infinity;
    for (const g of document.querySelectorAll('.world-scene .hex-flora[data-story-id]')) {
      const r = g.querySelector('.world-plate-bg')?.getBoundingClientRect();
      if (!r || r.width === 0) continue;
      const d = Math.hypot(r.x + r.width / 2 - ax, r.y + r.height / 2 - ay);
      if (d < bestD) { bestD = d; best = { id: g.getAttribute('data-story-id'), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }
    }
    return best;
  }, anchor);
  if (!id) throw Error('no nameplate to select');
  await page.mouse.click(id.x, id.y);
  await page.waitForFunction((sid) => document.querySelector(`.world-scene .hex-flora.is-selected[data-story-id="${sid}"]`), id.id, { timeout: 30_000 });
  return id.id;
}

try {
  for (const arm of arms) manifest.health[arm.name] = await health(arm);
  browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  manifest.browser = browser.version();
  if (!frozen) { const warm = await open(arms[0], true); await warm.page.waitForTimeout(1500); await warm.context.close(); frozen = true; }
  const tree = JSON.parse(payloads.get('/api/tree').body.toString());
  manifest.snapshot = {
    loadedFrom: loadFrom, storyCount: tree.stories.length,
    sha256: hash(JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, hash(v.body)]))),
    storiesWithVerdict: tree.stories.filter((s) => s.verdict).length,
  };
  if (manifest.snapshot.storiesWithVerdict === 0) throw Error('proof-less snapshot — refusing');
  const saveTo = value('--snapshot-save', null);
  if (saveTo) writeFileSync(saveTo, JSON.stringify([...payloads].map(([k, p]) => [k, { status: p.status, headers: p.headers, body: p.body.toString('base64') }])));
  for (const arm of arms) {
    const { context, page } = await open(arm, false);
    manifest.selected = await selectNearest(page);
    await shoot(page, arm, 'rest');
    await wheel(page, 8); await shoot(page, arm, 'in');
    await wheel(page, -30); await shoot(page, arm, 'out');
    await context.close();
  }
  if (manifest.errors.length) throw Error(manifest.errors.join('\n'));
  manifest.status = 'CAPTURED';
} catch (e) { manifest.status = 'FAILED'; manifest.failure = e.stack; process.exitCode = 1; console.error(e.stack); }
finally { if (browser) await browser.close(); manifest.finishedAt = new Date().toISOString(); save(); }
