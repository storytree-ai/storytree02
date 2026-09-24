#!/usr/bin/env node
// The interaction layer survived the flat look's retirement (ADR-0608 D2) — asked of ONE running
// studio in real Chromium on the real forest. Never starts or stops a server; the caller holds the
// heavy lock and owns the server.
//
//   node interaction.mjs --run --heavy-lock-held --url http://127.0.0.1:P --dir /abs/worktree --out /tmp/<fresh>
//
// Each check is observed through the host's own route, never by calling app code:
//   1. focus      — Tab reaches the map viewport (it is the focusable, named map surface);
//   2. keyboard   — ArrowLeft/ArrowUp pan the host camera (the `.world-camera` transform moves);
//   3. nameplate  — a real click on a nameplate selects its story (panel + `is-selected` + lanes);
//   4. plant      — a real click on a 3D plant's crown pixel selects that capability (URL `cap=`);
//   5. legend     — fading a status marks its plant targets `is-filtered` and dims nothing else;
//   6. wisps      — every session wisp the corpus carries is still drawn, with its hit target;
//   7. reduced motion — under `prefers-reduced-motion` the map settles grown with no regrow.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const value = (flag) => { const i = argv.indexOf(flag); return i < 0 ? null : argv[i + 1]; };
if (!argv.includes('--run') || !argv.includes('--heavy-lock-held')) throw Error('Refusing browser launch without --run --heavy-lock-held');
const origin = new URL(value('--url')).origin;
const dir = realpathSync(value('--dir'));
const out = path.resolve(value('--out'));
if (!out.startsWith('/tmp/') || existsSync(out)) throw Error('--out must be a fresh /tmp directory');
mkdirSync(out, { recursive: true });
const head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const health = await (await fetch(`${origin}/api/health`, { cache: 'no-store' })).json();
if (realpathSync(health.code?.directory ?? '/') !== dir || health.code.head !== head || health.code.stale !== false || health.db !== 'ok') throw Error(`wrong/stale server ${JSON.stringify(health)}`);
const require = createRequire(path.join(dir, 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const receipt = { startedAt: new Date().toISOString(), origin, dir, head, checks: {}, errors: [] };
const save = () => writeFileSync(path.join(out, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
receipt.browser = browser.version();
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await context.newPage();
  page.on('pageerror', (e) => receipt.errors.push(`page: ${e.message}`));
  await page.goto(`${origin}/#/tree`, { waitUntil: 'load', timeout: 180_000 });
  await page.waitForSelector('[data-testid="land-mount"] canvas', { timeout: 180_000 });
  await page.waitForFunction(() => window.__storytreeMotionSettled?.().settled === true, null, { timeout: 180_000 });
  await page.waitForFunction(() => document.querySelectorAll('svg.world-scene g.native-prop-targets > rect').length > 0, null, { timeout: 180_000 });

  // 7. reduced motion: already settled grown — every island's nameplate is present, no regrow in flight.
  receipt.checks.reducedMotion = await page.evaluate(() => ({ settled: window.__storytreeMotionSettled?.().settled, nameplates: document.querySelectorAll('.world-scene .world-plate').length, regrowing: document.querySelector('.world-scene')?.classList.contains('act2-regrowing') ?? null }));

  // 1. focus: Tab until the viewport holds focus.
  let focused = null;
  for (let i = 0; i < 40 && !focused; i += 1) {
    await page.keyboard.press('Tab');
    focused = await page.evaluate(() => (document.activeElement?.classList.contains('world-viewport') ? document.activeElement.getAttribute('aria-label') : null));
  }
  receipt.checks.focus = { reachedByTab: focused !== null, ariaLabel: focused };

  // 2. keyboard pan.
  const cam = () => page.evaluate(() => document.querySelector('.world-camera')?.getAttribute('transform'));
  await page.locator('.world-viewport').focus();
  const before = await cam();
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(300);
  const afterPan = await cam();
  receipt.checks.keyboard = { before, after: afterPan, moved: before !== afterPan };

  // 6. wisps: every family present in the DOM with a hit target.
  receipt.checks.wisps = await page.evaluate(() => {
    const n = (s) => document.querySelectorAll(`.world-scene ${s}`).length;
    return { claim: n('.world-claim-wisp'), claimHit: n('.world-claim-wisp-hit'), hover: n('.world-hover-wisp'), queue: n('.world-queue-wisp'), departing: n('.world-departing-wisp'), build: n('.world-wisp') };
  });

  // 3. nameplate click selects the story.
  const plate = await page.evaluate(() => {
    const vp = document.querySelector('.world-viewport').getBoundingClientRect();
    for (const g of document.querySelectorAll('.world-scene .hex-flora[data-story-id]')) {
      const r = g.querySelector('.world-plate-bg')?.getBoundingClientRect();
      if (!r || r.width === 0) continue;
      const x = r.x + r.width / 2; const y = r.y + r.height / 2;
      if (x > vp.x + 100 && x < vp.right - 500 && y > vp.y + 100 && y < vp.bottom - 100) return { id: g.getAttribute('data-story-id'), x, y };
    }
    return null;
  });
  await page.mouse.click(plate.x, plate.y);
  await page.waitForTimeout(600);
  receipt.checks.nameplate = { ...plate, ...(await page.evaluate((id) => ({ selected: Boolean(document.querySelector(`.world-scene .hex-flora.is-selected[data-story-id="${id}"]`)), lanes: document.querySelectorAll('.world-scene .trail-lane').length, rings: document.querySelectorAll('.world-scene .coast-fill-group.is-selected').length, hash: location.hash }), plate.id)) };
  await page.keyboard.press('Escape');

  // 4. a real click at a plant target's centre selects that capability.
  const plant = await page.evaluate(() => {
    const vp = document.querySelector('.world-viewport').getBoundingClientRect();
    const rects = [...document.querySelectorAll('.world-scene g.native-prop-targets > rect')];
    for (const r of rects.reverse()) {
      const b = r.getBoundingClientRect();
      const x = b.x + b.width / 2; const y = b.y + b.height * 0.35;
      if (b.width < 6 || x < vp.x + 60 || x > vp.right - 500 || y < vp.y + 60 || y > vp.bottom - 60) continue;
      const top = document.elementFromPoint(x, y)?.closest('[data-cap-id]');
      if (top === r) return { x, y, cap: r.getAttribute('data-cap-id'), story: r.getAttribute('data-story-id') };
    }
    return null;
  });
  if (plant) {
    await page.mouse.click(plant.x, plant.y);
    await page.waitForTimeout(600);
    receipt.checks.plant = { ...plant, hash: await page.evaluate(() => location.hash) };
    receipt.checks.plant.selected = receipt.checks.plant.hash.includes(encodeURIComponent(plant.cap)) || receipt.checks.plant.hash.includes(plant.cap);
  } else receipt.checks.plant = { found: false };
  await page.keyboard.press('Escape');

  // 5. legend: fade `healthy`, count filtered plant targets, restore.
  const legend = page.locator('details.panel-legend');
  if (!(await legend.evaluate((e) => e.open))) await legend.locator('summary').click();
  const chip = page.locator('button.legend-chip').filter({ hasText: /^story status$/ }).first();
  if ((await chip.getAttribute('aria-expanded')) !== 'true') await chip.click();
  const count = () => page.evaluate(() => ({ targets: document.querySelectorAll('.world-scene g.native-prop-targets > rect').length, filtered: document.querySelectorAll('.world-scene g.native-prop-targets > rect.is-filtered').length }));
  const shown = await count();
  await page.locator('button[title="fade healthy"]').click();
  await page.locator('button[title="show healthy"]').waitFor();
  await page.waitForTimeout(400);
  const faded = await count();
  await page.screenshot({ path: path.join(out, 'legend-healthy-faded.png') });
  await page.locator('button[title="show healthy"]').click();
  await page.waitForTimeout(400);
  receipt.checks.legend = { shown, faded, restored: await count() };
  await context.close();
  receipt.status = receipt.errors.length ? 'ERRORS' : 'DONE';
} catch (e) { receipt.status = 'FAILED'; receipt.failure = e.stack; process.exitCode = 1; console.error(e.stack); }
finally { await browser.close(); receipt.finishedAt = new Date().toISOString(); save(); }
