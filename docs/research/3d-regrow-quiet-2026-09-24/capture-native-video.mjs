// Optional native video. Run from the final unit's fresh worktree UNDER the heavy lock.
// Never run alongside the cost probe: Playwright recording has overhead, and this is not timing
// evidence. No app clock replacement, no source patch, no camera steering, no video editing.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(path.resolve('apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const base = process.env.LANEK_URL || 'http://127.0.0.1:5209';
const out = path.resolve(process.env.LANEK_VIDEO_OUT || '/tmp/laneK-video-evidence');
const query = '?landMount=1&landMountProps=1&act2=intro&sceneExport=1';
const viewport = { width: 1800, height: 1100 };
const requestedSeconds = 23;
const snapshotPath = '/tmp/laneK-video-api-snapshot.json';
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceDigest = () => hash(JSON.stringify(['apps/studio/src', 'packages/forest-world/src', 'packages/forest-world-r3f/src'].flatMap(directory => readdirSync(directory, { recursive: true }).filter(file => /\.(?:tsx?|css)$/.test(file)).map(file => [path.join(directory, file), hash(readFileSync(path.join(directory, file)))])).sort(([a], [b]) => a.localeCompare(b))));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const health = await (await fetch(`${base}/api/health`)).json();
if (health.code?.directory !== process.cwd() || health.code?.head !== head || health.code?.stale || health.store !== 'pg' || health.db !== 'ok') throw Error(`Wrong/stale server or unavailable live store: ${JSON.stringify(health)}`);
mkdirSync(out, { recursive: true });
const result = {
  capturedAt: new Date().toISOString(), head, health, sourceSha256: sourceDigest(), query, viewport,
  requestedSeconds,
  method: 'Unmodified native app clock, native Chromium rendering, real mounted studio and ordinary intro camera. One live API snapshot warmed before recording, then frozen. Playwright records the fresh recorded page from creation through close, including any opening load frames.',
  limits: ['Recording adds overhead: this is appearance footage, never GPU cost, FPS or load-time evidence.', 'The intro camera naturally pulls back with the app cursor; no fit view or manual camera change is used.', 'Cursor start means first diagnostic cursor observed in the clip, not the initial blank/loading frame.', 'A 23-second excerpt may end before settlement; the JSON records the actual end cursor rather than claiming completion.', 'Playwright encodes native browser frames; no frame stepping, synthetic interpolation, time compression or video editing is applied.'],
  errors: [],
};
const payloads = new Map(); const pending = new Map(); let frozen = false;
const saveSnapshot = () => writeFileSync(snapshotPath, JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { ...value, body: value.body.toString('base64') }])));
const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
const contexts = [];
let watchdog;

async function contextFor(name, recording) {
  const contextOptions = { viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' };
  if (recording) contextOptions.recordVideo = { dir: path.join(out, 'raw'), size: viewport };
  const context = await browser.newContext(contextOptions);
  contexts.push(context);
  const modules = new Set();
  context.on('request', request => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(request.url())) modules.add(request.url()); });
  await context.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const url = new URL(route.request().url()); const key = `${url.pathname}${url.search}`;
    try {
      if (!payloads.has(key)) {
        if (frozen) throw Error(`Uncaptured API path during recorded replay: ${key}`);
        if (!pending.has(key)) pending.set(key, (async () => { const response = await route.fetch(); payloads.set(key, { status: response.status(), headers: response.headers(), body: await response.body() }); saveSnapshot(); })());
        await pending.get(key);
      }
      await route.fulfill(payloads.get(key));
    } catch (error) { result.errors.push(`${name} API: ${error.message}`); await route.abort(); }
  });
  await context.addInitScript(() => {
    window.__laneKVideoSamples = [];
    const attach = () => {
      const control = document.querySelector('.act2-intro');
      if (!control) return false;
      const sample = () => {
        const progress = Number(control.getAttribute('data-act2-progress'));
        const previous = window.__laneKVideoSamples.at(-1);
        if (previous?.progress === progress) return;
        window.__laneKVideoSamples.push({ msFromNavigation: performance.now(), progress, readout: control.querySelector('.act2-intro-readout')?.textContent, visibility: document.visibilityState, viewport: [innerWidth, innerHeight] });
      };
      sample();
      new MutationObserver(sample).observe(control, { attributes: true, attributeFilter: ['data-act2-progress'] });
      return true;
    };
    const watch = () => {
      if (attach()) return;
      const observer = new MutationObserver(() => { if (attach()) observer.disconnect(); });
      observer.observe(document.documentElement, { childList: true, subtree: true });
    };
    if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch, { once: true });
  });
  return { context, modules };
}

async function load(page, modules, budgetMs) {
  const deadline = Date.now() + budgetMs;
  const timeout = () => Math.max(1, deadline - Date.now());
  await page.goto(`${base}/${query}#/tree`, { waitUntil: 'domcontentloaded', timeout: timeout() });
  await page.bringToFront();
  await page.waitForSelector('[data-testid="land-mount"] canvas', { timeout: timeout() });
  await page.waitForFunction(() => window.__storytreeSceneExport && document.querySelector('.act2-intro') && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'), null, { timeout: timeout() });
  if (modules.size !== 1) throw Error(`Cannot identify one loaded R3F module: ${JSON.stringify([...modules])}`);
  await page.evaluate(async ({ moduleUrl, budgetMs }) => {
    const module = await import(moduleUrl);
    const canvas = document.querySelector('[data-testid="land-mount"] canvas');
    const end = performance.now() + budgetMs;
    let root;
    do {
      root = module._roots.get(canvas);
      if (root?.store?.getState()?.gl) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    } while (performance.now() < end);
    if (!root?.store?.getState()?.gl) throw Error('Actual R3F renderer did not become ready within the excerpt');
    const gl = root.store.getState().gl.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const identity = { renderer, vendor: String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)), software: /swiftshader|llvmpipe|software/i.test(renderer) };
    if (identity.software || !/RTX\s*2060/i.test(renderer)) throw Error(`Expected the actual RTX 2060, got ${renderer}`);
    window.__laneKVideoRead = () => {
      const state = root.store.getState(); const bridge = window.__storytreeSceneExport;
      return { msFromNavigation: performance.now(), identity, visibility: document.visibilityState, viewport: [innerWidth, innerHeight], progress: Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')), readout: document.querySelector('.act2-intro-readout')?.textContent, mount: document.querySelector('[data-testid="land-mount"]')?.getAttribute('data-state'), regrow: document.querySelector('[data-testid="land-mount"] [data-regrow-active]')?.getAttribute('data-regrow-active') ?? null, camera: { svg: document.querySelector('.world-camera')?.getAttribute('transform'), compositor: document.querySelector('.world-pan-layer')?.style.transform, zoom: state.camera.zoom, position: state.camera.position.toArray(), quaternion: state.camera.quaternion.toArray() }, canvas: { width: canvas.width, height: canvas.height }, nativeWebGLFrames: state.gl.info.render.frame, world: bridge?.world, trails: bridge?.trails };
    };
  }, { moduleUrl: [...modules][0], budgetMs: timeout() });
  const state = await page.evaluate(() => window.__laneKVideoRead());
  if (state.visibility !== 'visible' || state.viewport[0] !== viewport.width || state.viewport[1] !== viewport.height || state.canvas.width <= 0 || state.canvas.height <= 0) throw Error('Recorded surface is hidden or has wrong dimensions');
  return state;
}

function durationOf(file) {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const ffmpeg = readdirSync(cache).filter(name => name.startsWith('ffmpeg-')).map(name => path.join(cache, name, 'ffmpeg-linux')).find(file => existsSync(file));
  if (!ffmpeg) return { seconds: null, reason: 'No bundled ffmpeg metadata reader found' };
  // Metadata read only; no output/transcode/edit. With no output argument ffmpeg exits 1 normally.
  const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024 });
  const match = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(`${probe.stderr ?? ''}\n${probe.stdout ?? ''}`);
  return match ? { seconds: Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]), method: 'Read WebM container duration with bundled ffmpeg; no editing' } : { seconds: null, reason: probe.error?.message || 'WebM duration absent from container metadata' };
}

try {
  // Warm the real map once to acquire ONE fresh snapshot before any accepted footage is made.
  const warm = await contextFor('snapshot-warmup', false);
  const warmPage = await warm.context.newPage();
  warmPage.on('pageerror', error => result.errors.push(`warmup: ${error.message}`));
  warmPage.on('console', message => { if (message.type() === 'error') result.errors.push(`warmup console: ${message.text()}`); });
  await load(warmPage, warm.modules, 180_000);
  await warmPage.waitForFunction(() => window.__storytreeMotionSettled?.().settled, null, { timeout: 120_000 });
  await warm.context.close();
  frozen = true; saveSnapshot(); result.snapshotSha256 = hash(readFileSync(snapshotPath)); result.snapshotPaths = [...payloads.keys()].sort();

  const recording = await contextFor('recording', true);
  const recordingBegan = performance.now();
  const page = await recording.context.newPage(); const video = page.video();
  if (!video) throw Error('Playwright did not create a native video recorder');
  page.on('pageerror', error => result.errors.push(`recording: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(`recording console: ${message.text()}`); });
  // A separate close bound prevents a slow/blocked page from silently producing a long video.
  // It never turns that failure into accepted footage.
  watchdog = setTimeout(() => { result.errors.push('Recording exceeded its 25-second close bound'); void recording.context.close().catch(error => result.errors.push(`Recorder close: ${error.message}`)); }, 25_000);
  result.firstReady = await load(page, recording.modules, Math.max(1, requestedSeconds * 1000 - (performance.now() - recordingBegan)));
  const remaining = requestedSeconds * 1000 - (performance.now() - recordingBegan);
  if (remaining <= 0) throw Error('The real mounted map did not become ready within the requested excerpt');
  await page.waitForTimeout(remaining);
  result.end = await page.evaluate(() => window.__laneKVideoRead());
  const cursorSamples = await page.evaluate(() => window.__laneKVideoSamples);
  result.cursorStart = cursorSamples[0] ?? null;
  result.cursorEnd = cursorSamples.at(-1) ?? null;
  result.cursorSampleCount = cursorSamples.length;
  writeFileSync(path.join(out, 'cursor-samples.json'), `${JSON.stringify(cursorSamples, null, 2)}\n`);
  result.observedRecordingWallMs = performance.now() - recordingBegan;
  if (!result.cursorStart || !result.cursorEnd || !(result.cursorEnd.progress > result.cursorStart.progress)) throw Error('The excerpt did not observe native cursor growth');
  if (result.end.visibility !== 'visible' || cursorSamples.some(sample => sample.visibility !== 'visible' || sample.viewport[0] !== viewport.width || sample.viewport[1] !== viewport.height)) throw Error('The recording became hidden or changed viewport');
  result.cursorRewinds = cursorSamples.flatMap((sample, index, all) => index > 0 && sample.progress < all[index - 1].progress ? [{ before: all[index - 1], after: sample, beforeMountedReady: sample.msFromNavigation < result.firstReady.msFromNavigation }] : []);
  for (const state of [result.firstReady, result.end]) {
    state.dataSha256 = hash(JSON.stringify({ world: state.world, trails: state.trails }));
    state.forest = { islands: state.world?.islands.length, edges: state.trails?.edges, segments: state.trails?.segments, droppedRoutes: state.trails?.dropped.length };
    delete state.world; delete state.trails;
  }
  if (result.firstReady.dataSha256 !== result.end.dataSha256) throw Error('Forest data/layout changed during the fixed-snapshot excerpt');
  await recording.context.close(); clearTimeout(watchdog); watchdog = undefined;
  const videoPath = path.join(out, 'mounted-native-intro.webm');
  await video.saveAs(videoPath);
  await video.delete();
  result.video = { file: path.basename(videoPath), sha256: hash(readFileSync(videoPath)), duration: durationOf(videoPath) };
  if (result.video.duration.seconds === null || result.video.duration.seconds < 20 || result.video.duration.seconds > 25) throw Error(`Native WebM duration is outside the requested 20–25 seconds: ${JSON.stringify(result.video.duration)}`);
  result.sourceSha256After = sourceDigest();
  if (result.sourceSha256 !== result.sourceSha256After || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head) throw Error('Source or HEAD changed during native video capture');
  if (result.errors.length) throw Error(result.errors.join('\n'));
  result.accepted = true;
  writeFileSync(path.join(out, 'identity.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`${videoPath}: ${result.video.duration.seconds}s native excerpt; actual observed cursor ${result.cursorStart.progress} → ${result.cursorEnd.progress}. Appearance only, no timing verdict.`);
} catch (error) {
  result.accepted = false; result.failure = error.stack;
  writeFileSync(path.join(out, 'identity.json'), `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally {
  if (watchdog) clearTimeout(watchdog);
  for (const context of contexts) await context.close();
  await browser.close();
}
