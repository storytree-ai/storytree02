#!/usr/bin/env node
// Pathways at three zooms on the PUBLIC website's entry forest (the one surface there with a zoom):
// the same built site before and after the road width rule, served locally and captured in Chromium
// on this box's GPU. The storm's own skip reaches the forest; the site's own wheel zooms it about the
// centre of the map, so every row is the same place. Adapted from
// ../flat-forest-retirement-2026-09-24/retired/capture-public.mjs. Run only under the heavy lock:
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
const repo = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
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
const viewport = { width: 1600, height: 1000 };
const receipt = { capturedAt: new Date().toISOString(), viewport, sides: {}, shots: [] };
const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
receipt.browser = browser.version();
// CSS px per ground unit on the entry forest: the svg's width over its viewBox width ('meet').
const scaleOf = (page) => page.evaluate(() => {
  const svg = document.querySelector('#storm-land-canvas svg');
  const r = svg.getBoundingClientRect(); const vb = svg.viewBox.baseVal;
  return { scale: Math.min(r.width / vb.width, r.height / vb.height), viewBox: [vb.x, vb.y, vb.width, vb.height].map((n) => Number(n.toFixed(2))) };
});
try {
  for (const [side, dir] of Object.entries(sides)) {
    const server = await serve(dir);
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await browser.newPage({ viewport });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('.storm-skip');
    await page.waitForSelector('#storm-land-canvas svg', { state: 'visible', timeout: 30000 });
    await page.waitForTimeout(14000);
    receipt.sides[side] = { dist: dir, landState: await page.evaluate(() => document.querySelector('#storm-land-canvas')?.dataset.landState ?? document.querySelector('[data-land-state]')?.dataset.landState ?? 'none'), errors };
    const shoot = async (label) => {
      await page.waitForTimeout(1500);
      const file = path.join(out, `public-${side}-${label}.png`);
      await page.screenshot({ path: file });
      receipt.shots.push({ side, label, file: path.basename(file), sha256: sha(file), ...(await scaleOf(page)) });
    };
    const wheel = async (notches) => {
      const box = await page.locator('#storm-land-canvas svg').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      for (let i = 0; i < Math.abs(notches); i += 1) { await page.mouse.wheel(0, notches < 0 ? 100 : -100); await page.waitForTimeout(80); }
    };
    await shoot('rest');
    // The entry forest's wheel steps its story until the reader takes the map; its own "skip to the
    // map" button hands the map over, and only then does the wheel zoom (never in past the opening).
    await page.getByText('skip to the map', { exact: false }).first().click();
    await page.waitForTimeout(2500);
    await shoot('map');
    await wheel(-30); await shoot('out');
    await page.close();
    server.close();
  }
} finally {
  await browser.close();
  writeFileSync(path.join(out, 'public-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
}
