// Stage the public-forest truth fixes (ADR-0601): ONE published snapshot, three builds of the
// website — FLAT (web main before the 3D land), DEPLOYED (web main as live now), FIXED (this
// change) — served locally and captured in Chromium on this box's GPU. Run only under the heavy lock:
//   node capture.mjs --arm flat=<dist> --arm deployed=<dist> --arm fixed=<dist> --out <dir> --heavy-lock-held
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

if (!process.argv.includes('--heavy-lock-held')) throw Error('refusing: run under /tmp/storytree-heavy.lock with --heavy-lock-held');
const arms = [];
for (let i = 0; i < process.argv.length; i++) if (process.argv[i] === '--arm') { const [k, v] = process.argv[i + 1].split('='); arms.push([k, v]); }
const out = path.resolve(process.argv[process.argv.indexOf('--out') + 1]);
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

// Every visible nameplate that overlaps a piece of page text, measured in screen px.
const overlapsInPage = () => {
  const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  const text = [...document.querySelectorAll('.tell-line, .tell-figure.is-on, .storm-land-stamp, .storm-land-key')].filter((e) => { const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && e.getBoundingClientRect().width > 0; });
  // The cleared holes, read back off the mask the page is actually wearing (`prose-clearing.ts`).
  const frame = document.querySelector('#storm-land-canvas');
  const mask = frame?.classList.contains('has-prose-clearing') ? decodeURIComponent(frame.style.getPropertyValue('--prose-clear-mask')) : '';
  const fr = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const holes = [...mask.matchAll(/M(-?\d+) (-?\d+)h(\d+)v(\d+)/g)].map((m) => ({ l: fr.left + +m[1], t: fr.top + +m[2], r: fr.left + +m[1] + +m[3], b: fr.top + +m[2] + +m[4] }));
  const inHole = (a) => holes.some((h) => a.l >= h.l && a.r <= h.r && a.t >= h.t && a.b <= h.b);
  const hits = [];
  for (const p of document.querySelectorAll('#storm-land-canvas .tw-plate')) {
    const pr = R(p); if (pr.w === 0 || pr.b < 0 || pr.t > innerHeight || pr.r < 0 || pr.l > innerWidth) continue;
    for (const t of text) {
      // A line of prose is measured to its glyphs — its box runs the column's full width.
      const rects = t.classList.contains('tell-line') ? (() => { const r = document.createRange(); r.selectNodeContents(t); return [...r.getClientRects()].map((b) => ({ l: b.left, t: b.top, r: b.right, b: b.bottom })); })() : [R(t)];
      for (const tr of rects) {
      if (!hit(pr, tr)) continue;
      // Where the plate meets the text, is the map cleared (masked out) there?
      const meet = { l: Math.max(pr.l, tr.l), t: Math.max(pr.t, tr.t), r: Math.min(pr.r, tr.r), b: Math.min(pr.b, tr.b) };
      // TELL's column is measured to its glyphs, so a plate beside a short line meets the column's
      // box but no word: test the plate against the glyph boxes the mask was cut from.
      hits.push({ plate: p.querySelector('.ttl')?.textContent, under: t.className, cleared: inHole(meet) });
      }
    }
  }
  return { beat: document.querySelector('.tell-layer')?.dataset.tellBeat ?? null, holes: holes.length, hits };
};

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
receipt.browser = browser.version();
try {
  for (const [arm, dir] of arms) {
    const server = await serve(dir);
    const base = `http://127.0.0.1:${server.address().port}`;
    const hasLand = existsSync(path.join(dir, 'forest-land.json'));
    receipt.arms[arm] = { dist: dir, hasLand, errors: [] };
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => receipt.arms[arm].errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') receipt.arms[arm].errors.push(m.text()); });
    const shot = async (file, surface, extra = {}, opts = {}) => {
      const p = path.join(out, file);
      if (opts.locator) await page.locator(opts.locator).screenshot({ path: p }); else await page.screenshot({ path: p, ...(opts.clip ? { clip: opts.clip } : {}) });
      receipt.shots.push({ arm, surface, file, sha256: sha(p), ...extra });
    };
    const landSettled = (sel) => hasLand
      ? page.waitForFunction((s) => ['drawn', 'failed', 'unsupported'].includes(document.querySelector(s)?.dataset.landState ?? ''), sel, { timeout: 90000 }).then(() => page.evaluate((s) => document.querySelector(s).dataset.landState, sel))
      : Promise.resolve('none');

    // /forest/ — the settled poster, whole and a close crop of the middle of the map
    await page.goto(`${base}/forest/`, { waitUntil: 'networkidle' });
    const posterState = await landSettled('.forest-map');
    await page.waitForTimeout(3000);
    await shot(`forest-poster-${arm}.png`, '/forest/', { land: posterState }, { locator: '.forest-map' });
    const nb = await page.evaluate(() => { const el = [...document.querySelectorAll('.forest-map .tw-plate .ttl')].find((e) => e.textContent === 'notice-board'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top }; });
    await page.evaluate((y) => window.scrollTo(0, Math.max(0, y - 500)), nb.y + (await page.evaluate(() => scrollY)));
    await page.waitForTimeout(800);
    const nb2 = await page.evaluate(() => { const el = [...document.querySelectorAll('.forest-map .tw-plate .ttl')].find((e) => e.textContent === 'notice-board'); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top }; });
    await shot(`forest-poster-crop-${arm}.png`, '/forest/ (crop around notice-board)', {}, { clip: { x: Math.max(0, nb2.x - 420), y: Math.max(0, nb2.y - 330), width: 840, height: 420 } });

    // / — the entry forest, reached through the storm's own skip
    await page.goto(`${base}/`, { waitUntil: 'networkidle' });
    await page.click('.storm-skip');
    await page.waitForSelector('#storm-land-canvas svg', { state: 'visible', timeout: 30000 });
    const t0 = Date.now();
    await page.waitForTimeout(1000);
    await shot(`entry-growing-${arm}.png`, '/ (growing, ~1 s after skip)');
    await page.waitForTimeout(Math.max(0, 14000 - (Date.now() - t0)));
    const entryState = await page.evaluate(() => document.querySelector('#storm-land-canvas')?.dataset.landState ?? 'none');
    const settled = await page.evaluate(overlapsInPage);
    await shot(`entry-settled-${arm}.png`, '/ (settled, ~14 s after skip)', { land: entryState, overlaps: settled });

    // Every TELL beat, sampled once a second: which nameplates sit under page text at any point.
    const beats = {};
    for (let i = 0; i < 70; i++) {
      const o = await page.evaluate(overlapsInPage);
      if (o.beat === null) break;
      const k = o.beat;
      beats[k] ??= new Set();
      for (const h of o.hits) beats[k].add(`${h.plate} under ${h.under}${h.cleared ? ' (cleared)' : ' (VISIBLE)'}`);
      if (k === 'proven' && !receipt.shots.some((s) => s.arm === arm && s.surface.startsWith('/ (TELL proven'))) {
        await page.waitForTimeout(1500);
        await shot(`entry-tell-proven-${arm}.png`, '/ (TELL proven beat)');
      }
      await page.waitForTimeout(1000);
    }
    receipt.arms[arm].tellOverlaps = Object.fromEntries(Object.entries(beats).map(([k, v]) => [k, [...v]]));

    // The click route after TELL: the map is locked while the prose plays (owner, 2026-09-01), so
    // a click is tested once TELL has handed the map back — via its own skip if it is still up.
    await page.evaluate(() => document.querySelector('.tell-skip')?.click());
    await page.waitForTimeout(1500);
    const at = await page.evaluate(() => {
      for (const el of document.querySelectorAll('#storm-land-canvas .tw-hit')) {
        const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (x > 560 && x < 1400 && y > 200 && y < 700) return { x, y, id: el.getAttribute('data-id') };
      }
      return null;
    });
    if (at) {
      await page.mouse.click(at.x, at.y);
      await page.waitForTimeout(1000);
      const roam = await page.evaluate(() => { const p = document.querySelector('.roam-panel'); return { panelOpen: !!p && !p.hidden && p.getBoundingClientRect().width > 0, locked: document.querySelector('#storm-land')?.className ?? '' }; });
      receipt.arms[arm].clickAfterTell = { ...at, ...roam };
      await shot(`entry-click-${arm}.png`, '/ (island clicked after TELL)', { click: receipt.arms[arm].clickAfterTell });
    }
    await page.close();
    server.close();
  }
} finally {
  await browser.close();
}
writeFileSync(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ arms: receipt.arms, overlaps: receipt.shots.filter((s) => s.overlaps).map((s) => ({ arm: s.arm, ...s.overlaps })) }, null, 1));
