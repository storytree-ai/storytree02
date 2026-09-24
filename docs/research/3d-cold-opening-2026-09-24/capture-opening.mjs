// The studio's mounted 3D map, opened cold on a PRODUCTION build. Run from the repo root of the
// worktree that built `apps/studio/dist`, UNDER /tmp/storytree-heavy.lock, with the production
// server (`pnpm --filter studio serve`) on LANES_URL.
//
//   LANES_MODE=video  → one native recording of the opening (appearance evidence, never timing)
//   LANES_MODE=timing → LANES_REPEATS fresh contexts, cache disabled, no recording (timing evidence)
//   LANES_LABEL       → before | after (names the outputs)
//
// One live /api snapshot is captured on first use and REPLAYED FROZEN for every later run (both
// labels), so before and after see the same corpus. The app clock is never replaced; nothing is
// stepped. What is observed is written as timestamps from navigation start (performance.now()).
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const base = process.env.LANES_URL || 'http://127.0.0.1:5391';
const mode = process.env.LANES_MODE || 'timing';
const label = process.env.LANES_LABEL || 'unlabelled';
const repeats = Number(process.env.LANES_REPEATS || 3);
const out = path.resolve(process.env.LANES_OUT || '/tmp/laneS-evidence');
const snapshotPath = process.env.LANES_SNAPSHOT || '/tmp/laneS-api-snapshot.json';
const query = '?landMount=1&landMountProps=1&act2=intro';
const viewport = { width: 1800, height: 1100 };
const recordSeconds = Number(process.env.LANES_SECONDS || 40);
const hash = (value) => createHash('sha256').update(value).digest('hex');
mkdirSync(out, { recursive: true });

// Which build is being served: the served index.html must be the one on disk, and its hash names it.
const distIndex = readFileSync('apps/studio/dist/index.html', 'utf8');
const servedIndex = await (await fetch(`${base}/`)).text();
if (servedIndex !== distIndex) throw Error('The server is not serving this worktree\'s apps/studio/dist');
const distAssets = readdirSync('apps/studio/dist/assets').filter((f) => f.endsWith('.js')).sort();
const build = {
  indexSha256: hash(distIndex),
  assetsSha256: hash(JSON.stringify(distAssets.map((f) => [f, hash(readFileSync(path.join('apps/studio/dist/assets', f)))]))),
};

const payloads = new Map();
let frozen = existsSync(snapshotPath);
if (frozen) {
  for (const [key, value] of JSON.parse(readFileSync(snapshotPath, 'utf8'))) payloads.set(key, { ...value, body: Buffer.from(value.body, 'base64') });
}
const saveSnapshot = () => writeFileSync(snapshotPath, JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, { ...v, body: v.body.toString('base64') }])));

const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });

async function openContext(name, recording) {
  const options = { viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' };
  if (recording) options.recordVideo = { dir: path.join(out, 'raw'), size: viewport };
  const context = await browser.newContext(options);
  const errors = [];
  await context.route('**/api/**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const url = new URL(route.request().url());
    const key = `${url.pathname}${url.search}`;
    try {
      if (!payloads.has(key)) {
        if (frozen) throw Error(`uncaptured API path during frozen replay: ${key}`);
        const response = await route.fetch();
        payloads.set(key, { status: response.status(), headers: response.headers(), body: await response.body() });
      }
      await route.fulfill(payloads.get(key));
    } catch (error) { errors.push(`${name} API: ${error.message}`); await route.abort(); }
  });
  await context.addInitScript(() => {
    const log = (window.__laneS = { events: [], longTasks: [], gaps: [], progress: [], frames: [] });
    const now = () => performance.now();
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) log.longTasks.push({ start: e.startTime, duration: e.duration });
      }).observe({ type: 'longtask', buffered: true });
    } catch { /* longtask unsupported */ }
    let last = null;
    const frame = (t) => {
      if (last !== null && t - last > 150) log.gaps.push({ from: last, to: t, ms: t - last });
      last = t;
      if (log.frames.length < 6000) log.frames.push(t);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    const seen = new Map();
    const note = (kind, value) => {
      if (seen.get(kind) === value) return;
      seen.set(kind, value);
      log.events.push({ t: now(), kind, value });
    };
    const scan = () => {
      const land = document.querySelector('[data-testid="land-mount"]');
      if (land) note('land', `${land.getAttribute('data-state')}/${land.getAttribute('data-canvas') ?? '-'}`);
      const notice = document.querySelector('[data-testid="land-view-notice"]');
      note('notice', notice ? notice.textContent.trim() : null);
      note('canvas', document.querySelector('[data-testid="land-mount"] canvas') ? 'present' : 'absent');
      const control = document.querySelector('.act2-intro');
      if (control) {
        const p = Number(control.getAttribute('data-act2-progress'));
        const prev = log.progress.at(-1);
        if (!prev || prev.p !== p) log.progress.push({ t: now(), p, readout: control.querySelector('.act2-intro-readout')?.textContent ?? null });
      }
      note('islandsInSvg', String(document.querySelectorAll('svg.world-scene [data-story-id]').length > 0));
    };
    const start = () => {
      scan();
      new MutationObserver(scan).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'data-canvas', 'data-act2-progress'] });
    };
    if (document.documentElement) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  });
  return { context, errors };
}

function summarise(log) {
  const firstEvent = (kind, pred) => log.events.find((e) => e.kind === kind && pred(e.value))?.t ?? null;
  const ready = firstEvent('land', (v) => v === 'drawn/ready');
  const cursorStart = log.progress.find((s) => s.p > 0)?.t ?? null;
  const settled = log.progress.find((s) => s.p >= 1)?.t ?? null;
  const at = (t) => (t === null ? null : log.progress.filter((s) => s.t <= t).at(-1)?.p ?? 0);
  const totalLong = log.longTasks.reduce((a, e) => a + e.duration, 0);
  const largest = log.longTasks.reduce((a, e) => Math.max(a, e.duration), 0);
  const gapsAfterReady = ready === null ? [] : log.gaps.filter((g) => g.to > ready);
  // The first frame the browser delivered after the land reported ready — the earliest moment a
  // populated 3D frame can have been presented.
  const firstFrameAfterReady = ready === null ? null : log.frames.find((t) => t > ready) ?? null;
  return {
    landReadyMs: ready,
    cursorFirstMovedMs: cursorStart,
    cursorAtLandReady: at(ready),
    settledMs: settled,
    longTasks: { count: log.longTasks.length, totalMs: Math.round(totalLong), largestMs: Math.round(largest) },
    freezesOver150msAfterLandReady: gapsAfterReady.map((g) => ({ fromMs: Math.round(g.from), toMs: Math.round(g.to), ms: Math.round(g.ms), cursorBefore: at(g.from), cursorAfter: at(g.to + 50) })),
    firstFrameAfterLandReadyMs: firstFrameAfterReady === null ? null : Math.round(firstFrameAfterReady),
  };
}

async function openOnce(name, recording, budgetMs) {
  const { context, errors } = await openContext(name, recording);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name}: ${e.message}`));
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const began = Date.now();
  await page.goto(`${base}/${query}#/tree`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__laneS.progress.some((s) => s.p >= 1), null, { timeout: budgetMs, polling: 250 }).catch((e) => errors.push(`${name}: never settled: ${e.message}`));
  const remaining = budgetMs - (Date.now() - began);
  if (recording && remaining > 0) await page.waitForTimeout(remaining);
  const log = await page.evaluate(() => {
    const gl = document.querySelector('[data-testid="land-mount"] canvas')?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return { ...window.__laneS, renderer: gl && dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : null, visibility: document.visibilityState, win: [innerWidth, innerHeight] };
  });
  const video = recording ? page.video() : null;
  await context.close();
  return { log, errors, video };
}

const result = { capturedAt: new Date().toISOString(), label, mode, base, query, viewport, build, snapshotWasFrozen: frozen, runs: [] };
try {
  if (!frozen) {
    const warm = await openOnce('snapshot-warmup', false, 180_000);
    if (warm.errors.length) throw Error(warm.errors.join('\n'));
    frozen = true;
    saveSnapshot();
  }
  result.snapshotSha256 = hash(readFileSync(snapshotPath));
  if (mode === 'video') {
    const run = await openOnce('recording', true, recordSeconds * 1000);
    const file = path.join(out, `opening-${label}.webm`);
    await run.video.saveAs(file);
    await run.video.delete();
    result.runs.push({ summary: summarise(run.log), renderer: run.log.renderer, visibility: run.log.visibility, win: run.log.win, errors: run.errors, progress: run.log.progress, events: run.log.events, gaps: run.log.gaps, longTasks: run.log.longTasks });
    result.video = { file: path.basename(file), sha256: hash(readFileSync(file)) };
  } else {
    for (let i = 0; i < repeats; i += 1) {
      const run = await openOnce(`timing-${i}`, false, 120_000);
      result.runs.push({ summary: summarise(run.log), renderer: run.log.renderer, visibility: run.log.visibility, errors: run.errors, events: run.log.events, gaps: run.log.gaps, longTasks: run.log.longTasks });
    }
  }
  const bad = result.runs.find((r) => r.visibility !== 'visible' || !/RTX\s*2060/i.test(r.renderer ?? '') || r.errors.length);
  result.accepted = !bad;
  if (bad) result.rejection = { visibility: bad.visibility, renderer: bad.renderer, errors: bad.errors };
} finally {
  writeFileSync(path.join(out, `${mode}-${label}.json`), `${JSON.stringify(result, null, 2)}\n`);
  await browser.close();
}
console.log(JSON.stringify(result.runs.map((r) => r.summary), null, 1));
if (!result.accepted) process.exit(1);
