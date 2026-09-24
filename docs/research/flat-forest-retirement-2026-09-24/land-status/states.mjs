#!/usr/bin/env node
// Mounted 3D map — loading / unsupported / failed states in real Chromium (laneO, 2026-09-24).
// Never starts or stops a server; the caller holds the heavy lock. Each scenario is a fresh browser
// context on the real studio against the live store, `?landMount=1&landMountProps=1`, at rest.
//   ready       — control: the map draws, no notice.
//   loading     — the renderer module is held back 6 s: the notice must be visible meanwhile, then go.
//   unsupported — Chromium launched with WebGL 2 disabled (--disable-webgl2): an alert naming it,
//                 and the renderer module is never requested.
//   chunk-fails — the renderer module request is aborted: an alert, never a silent blank.
//   context-lost— after ready, the page's own WebGL context is lost (WEBGL_lose_context): an alert.
// With --before-url, the unsupported scenario is also captured on a BEFORE build (control).
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
for (const key of ['url', 'dir', 'head', 'pid', 'out']) if (!args.get(key)) throw Error(`required --${key}`);
const out = path.resolve(args.get('out'));
if (existsSync(out)) throw Error(`output exists: ${out}`);
mkdirSync(out, { recursive: true });
const save = (name, value) => writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);

async function verify(origin, dir, head, pid) {
  const h = await (await fetch(`${origin}/api/health`, { cache: 'no-store' })).json();
  if (execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head) throw Error(`HEAD mismatch ${dir}`);
  if (h.pid !== pid || realpathSync(h.code?.directory ?? '/') !== realpathSync(dir) || h.code?.head !== head || h.code?.stale !== false || h.store !== 'pg' || h.db !== 'ok') throw Error(`wrong server ${origin}: ${JSON.stringify(h)}`);
  return h;
}
const after = { origin: new URL(args.get('url')).origin, dir: args.get('dir'), head: args.get('head'), pid: Number(args.get('pid')) };
after.health = await verify(after.origin, after.dir, after.head, after.pid);
let before = null;
if (args.get('before-url')) {
  before = { origin: new URL(args.get('before-url')).origin, dir: args.get('before-dir'), head: args.get('before-head'), pid: Number(args.get('before-pid')) };
  before.health = await verify(before.origin, before.dir, before.head, before.pid);
}

const require = createRequire(path.join(realpathSync(after.dir), 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const viewport = { width: 1600, height: 1000 };
const gpuArgs = ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'];
const RENDERER = /forest-world-r3f\/src\/ForestWorldCanvas\.tsx/;
const receipt = { startedAt: new Date().toISOString(), after, before, viewport, scenarios: {} };

async function scenario(name, server, { launchArgs = [], route = null, afterReady = null } = {}) {
  const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: [...gpuArgs, ...launchArgs] });
  const rec = receipt.scenarios[name] = { server: server.origin, head: server.head, launchArgs, errors: [], rendererRequests: 0, timeline: [] };
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
    context.on('request', (r) => { if (RENDERER.test(r.url())) rec.rendererRequests += 1; });
    if (route) await context.route(RENDERER, route);
    const page = await context.newPage();
    page.on('pageerror', (e) => rec.errors.push(`page: ${e.message}`));
    const read = () => page.evaluate(() => {
      const n = document.querySelector('[data-testid="land-view-notice"]');
      const m = document.querySelector('[data-testid="land-mount"]');
      return {
        t: Math.round(performance.now()),
        notice: n ? { role: n.getAttribute('role'), text: n.textContent, insideAriaHidden: Boolean(n.closest('[aria-hidden="true"]')), visible: n.getBoundingClientRect().height > 0 } : null,
        mount: m ? { state: m.getAttribute('data-state'), canvas: m.getAttribute('data-canvas'), hasCanvas: Boolean(m.querySelector('canvas')) } : null,
        webgl2Api: typeof WebGL2RenderingContext !== 'undefined',
      };
    });
    await page.goto(`${server.origin}/?landMount=1&landMountProps=1#/tree`, { waitUntil: 'load', timeout: 180_000 });
    await page.bringToFront();
    await page.waitForSelector('svg.world-scene', { timeout: 180_000 });
    return { page, read, rec, browser };
  } catch (e) { await browser.close(); throw e; }
}
const shot = (page, file) => page.screenshot({ path: path.join(out, file) });
const until = async (page, fn, arg, ms = 120_000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 100 });

// ready — control
{
  const { page, read, rec, browser } = await scenario('ready', after);
  await until(page, () => document.querySelector('[data-testid="land-mount"]')?.getAttribute('data-canvas') === 'ready');
  await page.waitForTimeout(3000);
  rec.final = await read(); await shot(page, 'after-ready.png'); await browser.close();
}
// loading — hold the renderer module back
{
  let release; const held = new Promise((r) => { release = r; });
  const { page, read, rec, browser } = await scenario('loading', after, { route: async (route) => { await held; await route.continue(); } });
  await until(page, () => document.querySelector('[data-testid="land-view-notice"]')?.getAttribute('role') === 'status');
  rec.during = await read(); await shot(page, 'after-loading.png');
  release();
  await until(page, () => document.querySelector('[data-testid="land-mount"]')?.getAttribute('data-canvas') === 'ready');
  rec.final = await read(); await browser.close();
}
// unsupported — a real Chromium with WebGL 2 disabled
{
  const { page, read, rec, browser } = await scenario('unsupported', after, { launchArgs: ['--disable-webgl2'] });
  await until(page, () => document.querySelector('[data-testid="land-view-notice"]')?.getAttribute('role') === 'alert');
  await page.waitForTimeout(3000);
  rec.final = await read(); await shot(page, 'after-unsupported.png'); await browser.close();
}
if (before) {
  const { page, read, rec, browser } = await scenario('before-unsupported', before, { launchArgs: ['--disable-webgl2'] });
  await until(page, () => document.querySelector('[data-testid="land-mount"]')?.getAttribute('data-state') !== null);
  await page.waitForTimeout(12_000);
  rec.final = await read(); await shot(page, 'before-unsupported.png'); await browser.close();
}
// chunk-fails — the renderer module never arrives
{
  const { page, read, rec, browser } = await scenario('chunk-fails', after, { route: (route) => route.abort('failed') });
  await until(page, () => document.querySelector('[data-testid="land-view-notice"]')?.getAttribute('role') === 'alert');
  rec.final = await read(); await shot(page, 'after-chunk-fails.png'); await browser.close();
}
// context-lost — the browser takes the graphics context away after the map drew
{
  const { page, read, rec, browser } = await scenario('context-lost', after);
  await until(page, () => document.querySelector('[data-testid="land-mount"]')?.getAttribute('data-canvas') === 'ready');
  rec.beforeLoss = await read();
  await page.evaluate(() => document.querySelector('[data-testid="land-mount"] canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
  await until(page, () => document.querySelector('[data-testid="land-view-notice"]')?.getAttribute('role') === 'alert');
  rec.final = await read(); await shot(page, 'after-context-lost.png'); await browser.close();
}
receipt.finishedAt = new Date().toISOString();
save('receipt.json', receipt);
console.log(JSON.stringify(Object.fromEntries(Object.entries(receipt.scenarios).map(([k, v]) => [k, { final: v.final, during: v.during ?? undefined, rendererRequests: v.rendererRequests, errors: v.errors.length }])), null, 2));
