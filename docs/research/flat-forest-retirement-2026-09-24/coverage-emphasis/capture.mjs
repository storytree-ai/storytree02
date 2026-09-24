#!/usr/bin/env node
// Three-arm static capture for the coverage-plant emphasis correction, adapted from
// ../coverage-anchor/capture.mjs (same frozen-API replay, reduced motion, real host wheel zoom,
// raw mounted-canvas extraction). Root owns the servers and the heavy lock; this never starts or
// stops a server and makes no API write.
//
//   node capture.mjs --run --heavy-lock-held --out /tmp/<fresh> \
//     --arm flat=http://127.0.0.1:P1,/abs/worktree \
//     --arm w8=http://127.0.0.1:P2,/abs/worktree \
//     --arm corrected=http://127.0.0.1:P3,/abs/worktree [--zoom-steps 8] [--zoom-anchor 0.6,0.45]
//
// The LAST arm is the snapshot source: its API bodies are acquired once and replayed byte for byte
// to every arm. Each arm is verified against /api/health (served directory, HEAD, not stale, pg).
// Per arm and framing it saves: the raw mounted canvas, the full app, and the full app with the
// SVG coverage marks (`.world-scene .parcel-flora`) at opacity 0. The two 3D arms also save the
// zoomed legend-dimmed state (healthy faded). Appearance is the owner's verdict, not this script's.
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
  const [name, rest] = spec.split('=');
  const [origin, rawDir] = rest.split(',');
  const dir = realpathSync(rawDir);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
  return { name, origin: new URL(origin).origin, dir, head: git('rev-parse', 'HEAD'), diff: git('diff', 'HEAD') };
});
if (arms.length < 2) throw Error('Need at least two --arm');
const out = path.resolve(value('--out'));
if (!out.startsWith('/tmp/') || existsSync(out)) throw Error('--out must be a fresh /tmp directory');
const zoomSteps = Number(value('--zoom-steps', '8'));
const anchor = value('--zoom-anchor', '0.6,0.45').split(',').map(Number);
const viewport = { width: 1800, height: 1100 };
// The ordinary opening composition: the mounted 3D land under the SVG overlay, one panel.
const query = '?landMount=1&landMountProps=1&act2=intro&sceneExport=1';
const hideFlat = '.world-scene .parcel-flora { opacity: 0 !important; }';
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(path.join(arms[0].dir, 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');
mkdirSync(out, { recursive: true });
const manifest = { startedAt: new Date().toISOString(), query, viewport, zoomSteps, anchor, arms: arms.map(({ name, origin, dir, head, diff }) => ({ name, origin, dir, head, scratchDiffSha256: hash(diff), scratchDiff: diff })), health: {}, captures: {}, errors: [] };
const save = () => writeFileSync(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

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
      if (!payloads.has(key)) {
        if (!acquire || frozen) throw Error(`uncaptured API request after freeze: ${key}`);
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
  await page.goto(`${arm.origin}/${query}#/tree`, { waitUntil: 'load', timeout: 180_000 });
  await page.bringToFront();
  await page.waitForSelector('[data-testid="land-mount"] canvas', { timeout: 180_000 });
  await page.waitForFunction(() => window.__storytreeSceneExport && document.querySelector('.act2-intro') && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'), null, { timeout: 180_000 });
  await page.evaluate(async (moduleUrl) => {
    const mod = await import(moduleUrl);
    const canvas = document.querySelector('[data-testid="land-mount"] canvas');
    let root;
    for (let i = 0; i < 600 && !root; i += 1) { const r = mod._roots.get(canvas); if (r?.store?.getState()?.gl) root = r; else await new Promise((res) => setTimeout(res, 50)); }
    if (!root) throw Error('no R3F root');
    window.__laneQ = {
      state: () => { const s = root.store.getState(); const c = s.camera; return { frame: s.gl.info.render.frame, mode: s.frameloop, requested: s.internal.frames, camera: { position: c.position.toArray(), zoom: c.zoom, projectionMatrix: c.projectionMatrix.toArray(), matrixWorld: c.matrixWorld.toArray() }, host: document.querySelector('.world-camera')?.getAttribute('transform'), progress: Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')), settled: window.__storytreeMotionSettled?.().settled }; },
      pixels: () => { const s = root.store.getState(); s.gl.render(s.scene, s.camera); return s.gl.domElement.toDataURL('image/png'); },
    };
  }, fiber);
  return { context, page };
}

async function settle(page) {
  let prev; let same = 0;
  for (let i = 0; i < 200; i += 1) {
    const s = await page.evaluate(() => window.__laneQ.state());
    const fp = JSON.stringify({ camera: s.camera, host: s.host });
    same = fp === prev ? same + 1 : 0; prev = fp;
    if (same >= 3 && s.settled === true && s.progress === 1 && s.mode === 'demand' && s.requested === 0 && s.frame > 0) return s;
    await page.waitForTimeout(150);
  }
  throw Error('did not settle');
}

async function shoot(page, arm, label) {
  const s = await settle(page);
  const raw = Buffer.from((await page.evaluate(() => window.__laneQ.pixels())).split(',')[1], 'base64');
  const rawFile = `${arm.name}-${label}-land-mount-raw.png`; writeFileSync(path.join(out, rawFile), raw);
  const fullFile = `${arm.name}-${label}-full.png`; await page.screenshot({ path: path.join(out, fullFile) });
  const style = await page.addStyleTag({ content: hideFlat });
  await page.waitForFunction(() => [...document.querySelectorAll('.world-scene .parcel-flora')].every((e) => getComputedStyle(e).opacity === '0'));
  const hiddenFile = `${arm.name}-${label}-flat-hidden-full.png`; await page.screenshot({ path: path.join(out, hiddenFile) });
  await style.evaluate((e) => e.remove());
  const after = await settle(page);
  if (JSON.stringify(after.camera) !== JSON.stringify(s.camera)) throw Error(`${arm.name} ${label}: camera moved`);
  const flatCount = await page.evaluate(() => document.querySelectorAll('.world-scene .parcel-flora').length);
  const canvasRect = await page.evaluate(() => { const r = document.querySelector('[data-testid="land-mount"] canvas').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; });
  manifest.captures[`${arm.name}-${label}`] = { canvasRect, rawFile, rawSha256: hash(raw), fullFile, hiddenFile, camera: s.camera, host: s.host, flatMarkCount: flatCount };
  save();
}

async function zoom(page) {
  const box = await page.locator('.world-viewport').boundingBox();
  await page.mouse.move(box.x + box.width * anchor[0], box.y + box.height * anchor[1]);
  for (let i = 0; i < zoomSteps; i += 1) { await page.mouse.wheel(0, -100); await page.waitForTimeout(120); }
}

async function dimHealthy(page) {
  const legend = page.locator('details.panel-legend');
  if (!(await legend.evaluate((e) => e.open))) await legend.locator('summary').click();
  const chip = page.locator('button.legend-chip').filter({ hasText: /^(story trees|story status)$/ }).first();
  if ((await chip.getAttribute('aria-expanded')) !== 'true') await chip.click();
  await page.locator('button[title="fade healthy"]').click();
  await page.locator('button[title="show healthy"]').waitFor();
  // Collapse the drawer again so the full-app picture is framed like the others.
  await legend.locator('summary').click();
}

try {
  for (const arm of arms) manifest.health[arm.name] = await health(arm);
  browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  manifest.browser = browser.version();
  const source = arms.at(-1);
  const warm = await open(source, true); await warm.page.waitForTimeout(1500); await warm.context.close(); frozen = true;
  manifest.snapshot = { source: source.name, frozenAt: new Date().toISOString(), sha256: hash(JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, hash(v.body)]))), storyCount: JSON.parse(payloads.get('/api/tree').body.toString()).stories.length };
  for (const arm of arms) {
    const { context, page } = await open(arm, false);
    await shoot(page, arm, 'rest');
    if (zoomSteps) { await zoom(page); await shoot(page, arm, 'zoom'); }
    if (arm.name !== 'flat') { await dimHealthy(page); await shoot(page, arm, 'zoom-legend-dimmed'); }
    await context.close();
  }
  for (const label of ['rest', 'zoom']) {
    const cams = arms.map((a) => JSON.stringify(manifest.captures[`${a.name}-${label}`]?.camera));
    manifest[`sameMountedCamera-${label}`] = cams.every((c) => c === cams[0]);
  }
  for (const arm of arms) { const v = await health(arm); if (v.code.head !== arm.head) throw Error(`${arm.name} drifted`); }
  if (manifest.errors.length) throw Error(manifest.errors.join('\n'));
  manifest.status = 'CAPTURED';
} catch (e) { manifest.status = 'FAILED'; manifest.failure = e.stack; process.exitCode = 1; console.error(e.stack); }
finally { if (browser) await browser.close(); manifest.finishedAt = new Date().toISOString(); save(); }
