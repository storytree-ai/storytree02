// Stage the public roads fix (lane AA, 2026-09-25; ADR-0601 "keep showing me them"): the SAME
// published snapshot built three ways — FLAT (website 9016b43, before the 3D land), NOW (website
// 1552148, what is deployed: the 3D land with the island-sizing rule that bent the roads) and FIXED
// (this branch: roads move with an island only near its shore) — served locally and captured in
// Chromium on this box's GPU, in a visible window. Per arm: the /forest/ poster, the settled entry
// forest, and the entry forest with every road's DRAWN route outlined in red (the route a click
// lights) so the 3D roads can be read against it.
//   node stage.mjs --flat <dist> --now <dist> --fixed <dist> --out <dir> --heavy-lock-held
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? null : process.argv[i + 1]; };
if (!process.argv.includes('--heavy-lock-held')) throw Error('refusing: run under /tmp/storytree-heavy.lock with --heavy-lock-held');
const arms = { flat: arg('flat'), now: arg('now'), fixed: arg('fixed') };
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
const receipt = { capturedAt: new Date().toISOString(), viewport: '1600x1000', arms: {}, shots: [] };

// Settled = the land drew (or, on the flat arm, there is no land) and no growth is running.
async function settle(page, host) {
  await page.waitForFunction((h) => {
    const el = document.querySelector(h);
    if (!el) return false;
    const state = el.dataset.landState;
    if (state === undefined) return true;
    if (state !== 'drawn') return false;
    const growth = el.querySelector('.forest-land-layer')?.dataset.growth;
    return growth === undefined || growth === 'settled';
  }, host, { timeout: 120000 });
  await page.waitForTimeout(2500);
}
const OUTLINE = (host) => `${host} path.tw-trail-fill{visibility:visible!important;display:inline!important;opacity:.85!important;stroke:#d11!important;stroke-width:1.1px!important;stroke-dasharray:none!important;fill:none!important}`;

const browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
receipt.browser = browser.version();
try {
  for (const [arm, dir] of Object.entries(arms)) {
    const server = await serve(dir);
    const base = `http://127.0.0.1:${server.address().port}`;
    const land = path.join(dir, 'forest-land.json');
    receipt.arms[arm] = { dist: dir, hasLand: existsSync(land), landSha256: existsSync(land) ? sha(land) : null };
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    receipt.arms[arm].renderer = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c?.getExtension('WEBGL_debug_renderer_info'); return c ? c.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : c.RENDERER) : null; });

    await page.goto(`${base}/forest/`, { waitUntil: 'networkidle' });
    await settle(page, '.forest-map');
    const poster = path.join(out, `forest-poster-${arm}.png`);
    await page.locator('.forest-map').screenshot({ path: poster });
    receipt.shots.push({ arm, surface: '/forest/', file: path.basename(poster), sha256: sha(poster) });

    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('.storm-skip');
    await page.waitForSelector('#storm-land-canvas svg', { state: 'visible', timeout: 30000 });
    await settle(page, '#storm-land-canvas');
    await page.waitForTimeout(12000); // past TELL's hand-back, as the owner saw it
    const entry = path.join(out, `entry-settled-${arm}.png`);
    await page.screenshot({ path: entry });
    receipt.shots.push({ arm, surface: '/ (settled)', file: path.basename(entry), sha256: sha(entry) });

    await page.addStyleTag({ content: OUTLINE('#storm-land-canvas') });
    await page.waitForTimeout(400);
    const outlined = path.join(out, `entry-drawn-routes-${arm}.png`);
    await page.screenshot({ path: outlined });
    receipt.shots.push({ arm, surface: '/ (settled, drawn routes outlined red)', file: path.basename(outlined), sha256: sha(outlined) });
    receipt.arms[arm].errors = errors;
    await page.close();
    server.close();
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify(receipt, null, 2));
