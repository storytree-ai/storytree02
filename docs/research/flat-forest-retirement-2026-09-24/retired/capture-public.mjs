// Stage the flat forest look's retirement on the public forests (ADR-0608 D4/D5, ADR-0601): the SAME
// published snapshot, built twice — BEFORE (the website's main: the 3D land under an SVG that still
// carries the flat picture, hidden by CSS once the land draws) and AFTER (the branch whose SVG no
// longer carries the flat picture at all) — served locally and captured in Chromium on this box's
// GPU. Adapted from ../../public-land-mount-2026-09-24/capture.mjs: both sides now wait for the land,
// and a third pass per side runs with WebGL 2 disabled, which is what a browser without a modern
// stack sees (D5: the message and the names, never a flat map). Run only under the heavy lock:
//   node capture-public.mjs --before <built dist> --after <built dist> --out <dir> --heavy-lock-held
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? null : process.argv[i + 1]; };
if (!process.argv.includes('--heavy-lock-held')) throw Error('refusing: run under /tmp/storytree-heavy.lock with --heavy-lock-held');
const sides = { before: arg('before'), after: arg('after') };
const out = path.resolve(arg('out'));
const repo = path.resolve(new URL('.', import.meta.url).pathname, '../../../..');
mkdirSync(out, { recursive: true });
const require = createRequire(path.join(repo, 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png' };
function serve(dir) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      let p = path.join(dir, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (existsSync(p) && statSync(p).isDirectory()) p = path.join(p, 'index.html');
      if (!existsSync(p)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] ?? 'application/octet-stream' });
      res.end(readFileSync(p));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const receipt = { capturedAt: new Date().toISOString(), viewport: '1600x1000', sides: {}, shots: [] };

const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
receipt.browser = browser.version();
try {
  for (const [side, dir] of Object.entries(sides)) {
    const server = await serve(dir);
    const base = `http://127.0.0.1:${server.address().port}`;
    const landJson = path.join(dir, 'forest-land.json');
    receipt.sides[side] = { dist: dir, hasLand: existsSync(landJson), landBytes: existsSync(landJson) ? statSync(landJson).size : 0 };
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const webgl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); return c ? c.getParameter(c.VERSION) : null; });

    // /forest/ — the settled poster
    await page.goto(`${base}/forest/`, { waitUntil: 'networkidle' });
    const posterState = true
      ? await page.waitForFunction(() => document.querySelector('.forest-map')?.dataset.landState ?? null, null, { timeout: 90000 }).then(async (h) => {
          await page.waitForFunction(() => ['drawn', 'failed', 'unsupported'].includes(document.querySelector('.forest-map')?.dataset.landState ?? ''), null, { timeout: 90000 });
          return page.evaluate(() => document.querySelector('.forest-map').dataset.landState);
        })
      : 'none';
    await page.waitForTimeout(3000);
    const poster = path.join(out, `forest-poster-${side}.png`);
    await page.locator('.forest-map').screenshot({ path: poster });
    receipt.shots.push({ side, surface: '/forest/', state: posterState, file: path.basename(poster), sha256: sha(poster) });

    // / — the entry forest, reached through the storm's own skip
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('.storm-skip');
    await page.waitForSelector('#storm-land-canvas svg', { state: 'visible', timeout: 30000 });
    const t0 = Date.now();
    if (true) {
      await page.waitForTimeout(1000);
      const mid = path.join(out, `entry-growing-${side}.png`);
      await page.screenshot({ path: mid });
      receipt.shots.push({ side, surface: '/ (growing, ~1 s)', file: path.basename(mid), sha256: sha(mid) });
      // frame pacing while the land grows: rAF intervals over 2 s
      receipt.sides[side].growthFrames = await page.evaluate(() => new Promise((resolve) => {
        const ts = []; const end = performance.now() + 2000;
        const tick = (t) => { ts.push(t); if (t < end) requestAnimationFrame(tick); else {
          const d = ts.slice(1).map((x, i) => x - ts[i]).sort((a, b) => a - b);
          resolve({ frames: d.length, medianMs: d[Math.floor(d.length / 2)], p95Ms: d[Math.floor(d.length * 0.95)], maxMs: d[d.length - 1] });
        } };
        requestAnimationFrame(tick);
      }));
    }
    await page.waitForTimeout(Math.max(0, 14000 - (Date.now() - t0)));
    const entryState = await page.evaluate(() => document.querySelector('#storm-land-canvas')?.dataset.landState ?? 'none');
    const entry = path.join(out, `entry-settled-${side}.png`);
    await page.screenshot({ path: entry });
    receipt.shots.push({ side, surface: '/ (settled)', state: entryState, file: path.basename(entry), sha256: sha(entry) });

    // a ROAM click on the foundation island still answers under the land
    // a visible island's own hit target, clear of the key and the stamp — ROAM reads pointerdown/up
    const at = await page.evaluate(() => {
      for (const el of document.querySelectorAll('#storm-land-canvas .tw-hit')) {
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x > 520 && x < 1400 && y > 200 && y < 700) {
          const top = document.elementFromPoint(x, y);
          return { x, y, id: el.getAttribute('data-id'), top: top ? `${top.tagName}.${top.getAttribute('class') ?? ''}` : null };
        }
      }
      return null;
    });
    let roam = null;
    if (at !== null) {
      // the keyboard route ROAM answers (a focused hit + Enter), which needs no pointer geometry
      await page.focus(`#storm-land-canvas .tw-hit[data-id="${at.id}"]`);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(800);
      roam = await page.evaluate((at) => ({ at, open: document.querySelector('#storm-land')?.classList.contains('roam-open') ?? false, selected: document.querySelectorAll('#storm-land-canvas .roam-selected').length }), at);
      const sel = path.join(out, `entry-selected-${side}.png`);
      await page.screenshot({ path: sel });
      receipt.shots.push({ side, surface: '/ (ROAM selection)', file: path.basename(sel), sha256: sha(sel), roam });
    }
    receipt.sides[side].webgl2 = webgl;
    receipt.sides[side].errors = errors;
    await page.close();
    server.close();
  }
  // D5 — a browser without a modern stack: WebGL 2 disabled at launch. Both surfaces, both sides.
  const bare = await chromium.launch({ headless: true, args: ['--disable-webgl2'] });
  try {
    for (const [side, dir] of Object.entries(sides)) {
      const server = await serve(dir);
      const base = `http://127.0.0.1:${server.address().port}`;
      const page = await bare.newPage({ viewport: { width: 1600, height: 1000 } });
      const webgl2 = await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2')));
      await page.goto(`${base}/forest/`, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => ['drawn', 'failed', 'unsupported'].includes(document.querySelector('.forest-map')?.dataset.landState ?? ''), null, { timeout: 60000 });
      const state = await page.evaluate(() => ({ land: document.querySelector('.forest-map').dataset.landState, message: document.querySelector('.forest-map .forest-land-status')?.textContent ?? null }));
      const shot = path.join(out, `forest-poster-no-webgl2-${side}.png`);
      await page.locator('.forest-map').screenshot({ path: shot });
      receipt.shots.push({ side, surface: '/forest/ (no WebGL 2)', webgl2, state, file: path.basename(shot), sha256: sha(shot) });
      await page.close();
      server.close();
    }
  } finally {
    await bare.close();
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
