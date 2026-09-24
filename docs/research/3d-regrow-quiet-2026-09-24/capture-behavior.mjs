// Scratch runtime probe for increment 2. Run from its FRESH worktree, under the heavy lock.
// This expects the new active/visibility policy to exist; it does not implement that policy.
// Native rendering stays alive. Only the app's wall clock is controlled.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const base = process.env.LANEK_URL || 'http://127.0.0.1:5209';
const out = path.resolve(process.env.LANEK_QUIET_OUT || '/tmp/laneK-quiet-evidence');
const parkRoute = process.env.LANEK_PARK_ROUTE || '#/asset/adr-0286';
const viewport = { width: 1800, height: 1100 };
const query = '?landMount=1&landMountProps=1&landView=1&act2=intro&sceneExport=1';
const quietWindowMs = Number(process.env.LANEK_QUIET_WINDOW_MS || 1500);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceDigest = () => hash(JSON.stringify(['apps/studio/src', 'packages/forest-world/src', 'packages/forest-world-r3f/src'].flatMap(directory => readdirSync(directory, { recursive: true }).filter(file => /\.(?:tsx?|css)$/.test(file)).map(file => [path.join(directory, file), hash(readFileSync(path.join(directory, file)))])).sort(([a], [b]) => a.localeCompare(b))));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const health = await (await fetch(`${base}/api/health`)).json();
if (health.code?.directory !== process.cwd() || health.code?.head !== head || health.code?.stale || health.store !== 'pg' || health.db !== 'ok') throw Error(`Wrong/stale server or unavailable live corpus: ${JSON.stringify(health)}`);
mkdirSync(out, { recursive: true });
const result = { takenAt: new Date().toISOString(), head, sourceSha256: sourceDigest(), health, query, parkRoute, viewport, quietWindowMs, cases: {}, errors: [], limits: ['Both actual studio consumers share one app cursor: mounted underlay and standalone land panel.', 'Visibility is an explicitly simulated document input while Chromium remains able to paint; it is not physical Electron occlusion.', 'Zero draw claims use actual WebGL renderer counters, not browser-wide paint or frame timing.', 'Manual clock cases establish behavior, not performance or hardware-floor acceptance.'] };
const payloads = new Map();
const pending = new Map();
let frozen = false;
const saveSnapshot = () => writeFileSync('/tmp/laneK-quiet-api-snapshot.json', JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { ...value, body: value.body.toString('base64') }])));
const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });

async function open(name, reducedMotion = 'no-preference') {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion });
  const modules = new Set();
  context.on('request', request => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(request.url())) modules.add(request.url()); });
  await context.addInitScript(() => {
    let now = 0; let next = 1; const callbacks = new Map();
    const idle = timestamp => { if (timestamp < now) throw Error('Clock must be monotonic'); now = timestamp; return { now, pending: callbacks.size }; };
    window.__laneKClock = {
      now: () => now,
      requestFrame: callback => { const id = next++; callbacks.set(id, callback); return id; },
      cancelFrame: id => callbacks.delete(id),
      idle,
      sample: timestamp => { idle(timestamp); const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(callback => callback(now)); return { now, delivered: batch.length, pending: callbacks.size }; },
      read: () => ({ now, pending: callbacks.size }),
    };
  });
  await context.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const url = new URL(route.request().url()); const key = `${url.pathname}${url.search}`;
    try {
      if (!payloads.has(key)) {
        if (frozen) throw Error(`Uncaptured API request after snapshot freeze: ${key}`);
        if (!pending.has(key)) pending.set(key, (async () => { const response = await route.fetch(); payloads.set(key, { status: response.status(), headers: response.headers(), body: await response.body() }); saveSnapshot(); })());
        await pending.get(key);
      }
      await route.fulfill(payloads.get(key));
    } catch (error) { result.errors.push(`${name} API: ${error.message}`); await route.abort(); }
  });
  let clockPatches = 0;
  await context.route('**/src/components/act2Intro.ts*', async route => {
    const response = await route.fetch(); const source = await response.text();
    const pattern = /const BROWSER_CLOCK(?:\s*:\s*Act2IntroClock)?\s*=\s*\{[\s\S]*?\n\};/g; const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1 || !matches[0][0].includes('window.requestAnimationFrame(callback)') || !matches[0][0].includes('performance.now()')) throw Error('App-clock source replacement does not match');
    clockPatches += 1;
    await route.fulfill({ response, body: source.replace(pattern, 'const BROWSER_CLOCK = window.__laneKClock;') });
  });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(`${name}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(`${name} console: ${message.text()}`); });
  await page.goto(`${base}/${query}#/tree`, { waitUntil: 'load', timeout: 180_000 });
  await page.bringToFront();
  for (const kind of ['land-mount', 'land-view']) await page.waitForSelector(`[data-testid="${kind}"] canvas`, { timeout: 180_000 });
  await page.waitForFunction(() => window.__storytreeSceneExport && document.querySelector('.act2-intro') && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'), null, { timeout: 180_000 });
  if (clockPatches !== 1 || modules.size !== 1) throw Error(`Unexpected instrumentation: clock=${clockPatches}, modules=${JSON.stringify([...modules])}`);
  await page.evaluate(async moduleUrl => {
    const module = await import(moduleUrl);
    const roots = {};
    for (const kind of ['land-mount', 'land-view']) {
      const canvas = document.querySelector(`[data-testid="${kind}"] canvas`);
      let root;
      for (let attempt = 0; attempt < 600; attempt += 1) { root = module._roots.get(canvas); if (root?.store?.getState()?.gl) break; await new Promise(resolve => setTimeout(resolve, 50)); }
      if (!root?.store?.getState()?.gl) throw Error(`No ready renderer for ${kind}`);
      roots[kind] = root;
    }
    window.__laneKRead = () => {
      const bridge = window.__storytreeSceneExport;
      const statuses = [];
      const walk = node => { if (['territory', 'parcel'].includes(node.kind)) statuses.push({ kind: node.kind, id: node.id, status: node.status }); for (const child of node.children ?? []) walk(child); };
      if (bridge) walk(bridge.scene);
      const canvases = {};
      for (const [kind, root] of Object.entries(roots)) {
        const state = root.store.getState(); const gl = state.gl.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info');
        canvases[kind] = { frame: state.gl.info.render.frame, mode: state.frameloop, requested: state.internal.frames, camera: { position: state.camera.position.toArray(), quaternion: state.camera.quaternion.toArray(), zoom: state.camera.zoom, near: state.camera.near, far: state.camera.far }, size: { width: state.gl.domElement.width, height: state.gl.domElement.height }, renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), regrow: document.querySelector(`[data-testid="${kind}"] [data-regrow-active]`)?.getAttribute('data-regrow-active') ?? null };
      }
      return { progress: Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')), readout: document.querySelector('.act2-intro-readout')?.textContent, clock: window.__laneKClock.read(), parked: document.querySelector('.tree-route')?.getAttribute('data-parked'), hidden: document.hidden, visibility: document.visibilityState, viewport: [innerWidth, innerHeight], camera: document.querySelector('.world-camera')?.getAttribute('transform'), compositor: document.querySelector('.world-pan-layer')?.style.transform, data: bridge ? { world: bridge.world, trails: bridge.trails, statuses } : null, canvases };
    };
    window.__laneKPixels = () => Object.fromEntries(Object.entries(roots).map(([kind, root]) => { const state = root.store.getState(); state.gl.render(state.scene, state.camera); return [kind, state.gl.domElement.toDataURL('image/png')]; }));
    window.__laneKInvalidate = () => Object.values(roots).forEach(root => root.store.getState().invalidate());
  }, [...modules][0]);
  return { context, page, name };
}

async function read(page) { return page.evaluate(() => window.__laneKRead()); }
async function nativeFrames(page) { await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); }
async function mode(page, expected) { await page.waitForFunction(wanted => Object.values(window.__laneKRead().canvases).every(canvas => canvas.mode === wanted), expected, { timeout: 10_000 }); }
async function drain(page) {
  await page.waitForFunction(() => window.__storytreeMotionSettled?.().worldArrived && window.__storytreeMotionSettled().activeStructuralAnimations === 0, null, { timeout: 60_000 });
  await nativeFrames(page);
  let previous = ''; let same = 0;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    await page.waitForTimeout(100); const state = await read(page);
    const fingerprint = JSON.stringify({ camera: state.camera, compositor: state.compositor, canvases: state.canvases });
    same = previous === fingerprint ? same + 1 : 0; previous = fingerprint;
    if (same >= 2) return state;
  }
  throw Error('Canvas failed to become quiet while the app clock was held');
}
async function sample(page, time, allowSettledIdle = false) {
  const tick = await page.evaluate(timestamp => window.__laneKClock.sample(timestamp), time);
  await nativeFrames(page);
  const state = await read(page);
  // A settled cursor intentionally leaves no callback queued. That is admissible only when the
  // mounted app has already read back its settled state; before then, a missing callback is a gap.
  if (!tick.delivered && !(allowSettledIdle && state.progress === 1)) throw Error(`No app callback accepted timestamp ${time}`);
  return state;
}
async function idle(page, time) { return page.evaluate(timestamp => window.__laneKClock.idle(timestamp), time); }
async function park(page) {
  await page.evaluate(route => { location.hash = route; }, parkRoute);
  await page.waitForSelector('.tree-route[data-parked="true"]', { state: 'attached' });
  await mode(page, 'never'); await nativeFrames(page); await page.waitForTimeout(150);
}
async function returnToTree(page) {
  await page.evaluate(() => { location.hash = '#/tree'; });
  await page.waitForSelector('.tree-route:not([data-parked="true"])');
  // Deliberately do not deliver a clock callback here. The caller's next `sample()` is the
  // observed wall-clock catch-up; draining first would wait forever at the parked cursor.
  await mode(page, 'demand'); await nativeFrames(page);
}
async function hidden(page, value) {
  await page.evaluate(isHidden => {
    if (isHidden) {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    } else { delete document.hidden; delete document.visibilityState; }
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
  await mode(page, value ? 'never' : 'demand'); await nativeFrames(page); await page.waitForTimeout(150);
}
async function quiet(page, label, action) {
  const before = await read(page);
  if (action) await action();
  await page.waitForTimeout(quietWindowMs);
  const after = await read(page);
  const deltas = Object.fromEntries(Object.keys(before.canvases).map(kind => [kind, after.canvases[kind].frame - before.canvases[kind].frame]));
  result.cases[label] = { before, after, deltas, observedNativeMs: quietWindowMs };
  if (Object.values(deltas).some(delta => delta !== 0)) throw Error(`${label}: unexpected WebGL frames ${JSON.stringify(deltas)}`);
  console.log(`${label}: zero WebGL frames on both actual consumers`);
}
async function snapshot(page, label) {
  await drain(page);
  const state = await read(page);
  if (state.hidden || state.visibility !== 'visible' || state.viewport[0] !== viewport.width || state.viewport[1] !== viewport.height) throw Error(`${label}: screenshot surface hidden or incorrectly sized`);
  const pixels = await page.evaluate(() => window.__laneKPixels());
  const hashes = {};
  for (const [kind, value] of Object.entries(pixels)) { const bytes = Buffer.from(value.split(',')[1], 'base64'); hashes[kind] = hash(bytes); writeFileSync(path.join(out, `${label}-${kind}.png`), bytes); }
  await page.screenshot({ path: path.join(out, `${label}.png`) });
  return { ...state, dataSha256: hash(JSON.stringify(state.data)), pngSha256: hashes };
}
function sameState(label, subject, twin) {
  for (const key of ['progress', 'camera', 'compositor', 'dataSha256']) if (JSON.stringify(subject[key]) !== JSON.stringify(twin[key])) throw Error(`${label}: states differ in ${key}`);
  for (const kind of ['land-mount', 'land-view']) {
    if (JSON.stringify(subject.canvases[kind].camera) !== JSON.stringify(twin.canvases[kind].camera)) throw Error(`${label}: ${kind} camera mismatch`);
    if (subject.pngSha256[kind] !== twin.pngSha256[kind]) throw Error(`${label}: ${kind} canvas pixels differ`);
  }
  result.cases[label] = { subject, twin, exactCanvasPngMatch: true };
  console.log(`${label}: cursor, actual cameras, data and both raw canvas PNGs match`);
}
async function pair(name) {
  const a = await open(`${name}-subject`); const b = await open(`${name}-twin`);
  for (const item of [a, b]) { await mode(item.page, 'demand'); await drain(item.page); }
  return [a, b];
}
async function closePair(items) { for (const item of items) await item.context.close(); }

try {
  // Warm every route needed later before freezing the one data snapshot. The warm-up does not
  // count as any runtime verdict and does not require the new policy yet.
  const warm = await open('snapshot-warmup', 'reduce');
  await warm.page.evaluate(route => { location.hash = route; }, parkRoute);
  await warm.page.waitForSelector('.tree-route[data-parked="true"]', { state: 'attached' });
  await warm.page.waitForTimeout(1500);
  await warm.context.close();
  frozen = true; saveSnapshot(); result.snapshotSha256 = hash(readFileSync('/tmp/laneK-quiet-api-snapshot.json')); result.snapshotPaths = [...payloads.keys()].sort();

  const navigation = await pair('navigation');
  const [subject, twin] = navigation;
  const calibrated = await sample(subject.page, 1000);
  if (!(calibrated.progress > 0 && calibrated.progress < 0.1)) throw Error('Cannot calibrate the live app schedule');
  const duration = 1000 / calibrated.progress; result.estimatedRunDurationMs = duration;
  const t = fraction => duration * fraction;
  await sample(subject.page, t(0.15)); await sample(twin.page, t(0.15));
  await park(subject.page);
  await quiet(subject.page, 'parked-intermediate-quiet', async () => { await idle(subject.page, t(0.5)); await subject.page.evaluate(() => window.__laneKInvalidate()); });
  await sample(twin.page, t(0.5)); await returnToTree(subject.page); await sample(subject.page, t(0.5));
  const returned = await snapshot(subject.page, 'navigation-return-middle'); const continuous = await snapshot(twin.page, 'navigation-continuous-middle');
  if (!(returned.progress > 0.15 && returned.progress < 1)) throw Error('Return jumped to an endpoint instead of the intermediate wall-clock position');
  sameState('navigation-intermediate-catch-up', returned, continuous);
  await park(subject.page);
  await quiet(subject.page, 'parked-completion-quiet', async () => { await idle(subject.page, t(1.1)); await subject.page.evaluate(() => window.__laneKInvalidate()); });
  await sample(twin.page, t(1.1)); await returnToTree(subject.page); await sample(subject.page, t(1.1), true);
  const settled = await snapshot(subject.page, 'navigation-return-settled'); const baseline = await snapshot(twin.page, 'continuous-settled');
  if (settled.progress !== 1) throw Error('Unwatched navigation did not complete');
  sameState('navigation-completed-catch-up', settled, baseline);
  await drain(subject.page); await quiet(subject.page, 'settled-visible-quiet');
  await closePair(navigation);

  const occlusion = await pair('visibility'); const [occluded, visible] = occlusion;
  await sample(occluded.page, t(0.15)); await sample(visible.page, t(0.15));
  await hidden(occluded.page, true);
  await quiet(occluded.page, 'hidden-content-change-quiet', async () => { await sample(occluded.page, t(0.35)); await occluded.page.evaluate(() => window.__laneKInvalidate()); });
  await idle(occluded.page, t(0.5)); await sample(visible.page, t(0.5));
  await hidden(occluded.page, false); await sample(occluded.page, t(0.5));
  sameState('occlusion-intermediate-catch-up', await snapshot(occluded.page, 'occlusion-return-middle'), await snapshot(visible.page, 'occlusion-continuous-middle'));
  await hidden(occluded.page, true);
  await quiet(occluded.page, 'hidden-completion-quiet', async () => { await idle(occluded.page, t(1.1)); await occluded.page.evaluate(() => window.__laneKInvalidate()); });
  await sample(visible.page, t(1.1)); await hidden(occluded.page, false); await sample(occluded.page, t(1.1), true);
  sameState('occlusion-completed-catch-up', await snapshot(occluded.page, 'occlusion-return-settled'), await snapshot(visible.page, 'occlusion-continuous-settled'));
  await closePair(occlusion);

  const reduced = await open('reduced-at-entry', 'reduce'); await mode(reduced.page, 'demand');
  const reducedEntry = await snapshot(reduced.page, 'reduced-at-entry');
  if (reducedEntry.progress !== 1) throw Error('Reduced motion at entry did not settle');
  sameState('reduced-motion-at-entry', reducedEntry, baseline);
  await drain(reduced.page); await quiet(reduced.page, 'reduced-entry-quiet'); await reduced.context.close();
  const switched = await open('reduced-mid-run'); await mode(switched.page, 'demand'); await sample(switched.page, t(0.15));
  await switched.page.emulateMedia({ reducedMotion: 'reduce' });
  await switched.page.waitForFunction(() => Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')) === 1);
  sameState('reduced-motion-mid-run', await snapshot(switched.page, 'reduced-mid-run'), baseline);
  await drain(switched.page); await quiet(switched.page, 'reduced-mid-run-quiet'); await switched.context.close();

  result.sourceSha256After = sourceDigest();
  if (result.sourceSha256 !== result.sourceSha256After || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head) throw Error('Source or HEAD changed during runtime proof');
  result.healthAfter = await (await fetch(`${base}/api/health`)).json();
  if (result.healthAfter.code?.directory !== process.cwd() || result.healthAfter.code?.head !== head || result.healthAfter.code?.stale || result.healthAfter.store !== 'pg' || result.healthAfter.db !== 'ok') throw Error(`Server changed or became stale during runtime proof: ${JSON.stringify(result.healthAfter)}`);
  if (result.errors.length) throw Error(result.errors.join('\n'));
  result.verdict = 'PASS';
  writeFileSync(path.join(out, 'measurements.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Runtime evidence written to ${out}`);
} catch (error) {
  result.verdict = 'FAIL'; result.failure = error.stack;
  writeFileSync(path.join(out, 'measurements.json'), `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally { await browser.close(); }
