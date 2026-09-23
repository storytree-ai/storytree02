// Real mounted forest, one live API snapshot, and the application's own clock.
// Run from the repository root UNDER /tmp/storytree-heavy.lock. This is appearance evidence,
// never a renderer-timing or owner-acceptance verdict. No repository source is changed.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(path.resolve('apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const base = process.env.LANEK_URL || 'http://127.0.0.1:5209';
const out = path.dirname(fileURLToPath(import.meta.url));
const snapshotPath = '/tmp/laneK-api-snapshot.json';
const framesPath = '/tmp/laneK-regrow-preview';
const viewport = { width: 1800, height: 1100 };
const query = '?landMount=1&landMountProps=1&act2=intro&sceneExport=1';
const hash = (value) => createHash('sha256').update(value).digest('hex');
const sourceDigest = () => hash(JSON.stringify(['apps/studio/src', 'packages/forest-world/src', 'packages/forest-world-r3f/src'].flatMap(directory => readdirSync(directory, { recursive: true }).filter(file => /\.(?:tsx?|css)$/.test(file)).map(file => [path.join(directory, file), hash(readFileSync(path.join(directory, file)))])).sort(([a], [b]) => a.localeCompare(b))));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const health = await (await fetch(`${base}/api/health`)).json();
if (health.code?.directory !== process.cwd() || health.code?.head !== head || health.code?.stale || health.store !== 'pg' || health.db !== 'ok') {
  throw Error(`Refusing wrong/stale server or unavailable live corpus: ${JSON.stringify(health)}`);
}

// Always acquire a FRESH snapshot for this run. Neither the snapshot nor profile/session payloads
// are committed. A second arm may only replay requests the first arm already observed.
const payloads = new Map();
const pending = new Map();
let snapshotFrozen = false;
const saveSnapshot = () => writeFileSync(snapshotPath, JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { ...value, body: value.body.toString('base64') }])));
const result = { takenAt: new Date().toISOString(), health, head, query, viewport, sourceSha256: sourceDigest(), clock: 'Injected app clock only; native renderer rAF and ResizeObserver remain live.', arms: {}, errors: [] };
mkdirSync(out, { recursive: true });
mkdirSync(framesPath, { recursive: true });
const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });

async function openArm(arm) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  const patches = { clock: 0, control: 0 };
  const moduleRequests = [];
  context.on('request', request => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(request.url())) moduleRequests.push(request.url()); });
  await context.addInitScript(() => {
    let now = 0;
    let next = 1;
    const frames = new Map();
    window.__laneKClock = {
      now: () => now,
      requestFrame: callback => { const id = next++; frames.set(id, callback); return id; },
      cancelFrame: id => frames.delete(id),
      sample: timestamp => {
        if (timestamp < now) throw Error('Clock samples must be monotonic');
        now = timestamp;
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach(callback => callback(now));
        return { now, delivered: callbacks.length, pending: frames.size };
      },
      read: () => ({ now, pending: frames.size }),
    };
  });
  await context.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const url = new URL(route.request().url());
    const key = `${url.pathname}${url.search}`;
    try {
      if (!payloads.has(key)) {
        if (snapshotFrozen) throw Error(`Control requested data missing from the frozen snapshot: ${key}`);
        if (!pending.has(key)) pending.set(key, (async () => {
          const response = await route.fetch();
          payloads.set(key, { status: response.status(), headers: response.headers(), body: await response.body() });
          saveSnapshot();
        })());
        await pending.get(key);
      }
      await route.fulfill(payloads.get(key));
    } catch (error) {
      result.errors.push(`${arm} API: ${error.message}`);
      await route.abort();
    }
  });
  await context.route('**/src/components/act2Intro.ts*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const pattern = /const BROWSER_CLOCK = \{[\s\S]*?\n\};/g;
    const matches = [...source.matchAll(pattern)];
    if (matches.length !== 1 || !matches[0][0].includes('window.requestAnimationFrame(callback)') || !matches[0][0].includes('performance.now()')) throw Error('The served app-clock replacement no longer matches exactly');
    patches.clock += 1;
    await route.fulfill({ response, body: source.replace(pattern, 'const BROWSER_CLOCK = window.__laneKClock;') });
  });
  if (arm === 'control') await context.route('**/src/components/LandViewMount.tsx*', async route => {
    const response = await route.fetch();
    const source = await response.text();
    const needle = 'const regrow = useMemo(() => forestRegrowPresentation(regrowCursor), [regrowCursor]);';
    if (source.split(needle).length !== 2) throw Error('The mounted control replacement no longer matches exactly');
    patches.control += 1;
    await route.fulfill({ response, body: source.replace(needle, 'const regrow = useMemo(() => null, [regrowCursor]);') });
  });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(`${arm}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(`${arm} console: ${message.text()}`); });
  await page.goto(`${base}/${query}#/tree`, { waitUntil: 'load', timeout: 180_000 });
  await page.bringToFront();
  await page.waitForSelector('[data-testid="land-mount"][data-state="drawn"] canvas', { timeout: 180_000 });
  await page.waitForFunction(() => window.__storytreeSceneExport && document.querySelector('.act2-intro') && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'), null, { timeout: 180_000 });
  // Read the ACTUAL mounted R3F root, including its camera, draw count and scene. This imports the
  // already-loaded browser module; it neither installs another renderer nor alters production code.
  if (new Set(moduleRequests).size !== 1) throw Error(`Cannot identify one loaded R3F module: ${JSON.stringify(moduleRequests)}`);
  await page.evaluate(async moduleUrl => {
    const module = await import(moduleUrl);
    const canvas = document.querySelector('[data-testid="land-mount"] canvas');
    let root;
    for (let attempt = 0; attempt < 400; attempt += 1) {
      root = module._roots.get(canvas);
      if (root?.store?.getState()?.gl) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!root?.store?.getState()?.gl) throw Error(`The mounted canvas has no ready R3F store: ${JSON.stringify({ rootCount: module._roots.size, roots: [...module._roots].map(([element, value]) => ({ element: element?.tagName, connected: element?.isConnected, same: element === canvas, keys: Object.keys(value) })) })}`);
    const gl = root.store.getState().gl.getContext();
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const gpu = { renderer, vendor: String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)), software: /swiftshader|llvmpipe|software/i.test(renderer), timerQuery: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2')) };
    window.__laneKCanvasPixels = () => {
      const state = root.store.getState();
      // A deliberate harness render, never included in a quiet-frame or timing observation.
      // Read synchronously before WebGL clears its non-preserved drawing buffer.
      state.gl.render(state.scene, state.camera);
      return state.gl.domElement.toDataURL('image/png');
    };
    window.__laneKReadThree = () => {
      const state = root.store.getState();
      const meshes = [];
      state.scene.traverse(object => { if (object.isMesh) meshes.push({ name: object.name, visible: object.visible, instances: object.count ?? null }); });
      return { camera: { zoom: state.camera.zoom, position: state.camera.position.toArray(), quaternion: state.camera.quaternion.toArray(), near: state.camera.near, far: state.camera.far }, size: state.size, frameloop: state.frameloop, frame: state.gl.info.render.frame, drawCalls: state.gl.info.render.calls, meshes, gpu };
    };
  }, moduleRequests[0]);
  if (patches.clock !== 1 || patches.control !== (arm === 'control' ? 1 : 0)) throw Error(`Unexpected patch count: ${JSON.stringify(patches)}`);
  result.arms[arm] = { patches, views: {} };
  await settleNative(page);
  return { context, page, arm };
}

async function settleNative(page) {
  await page.waitForFunction(() => {
    const state = window.__storytreeMotionSettled?.();
    return state?.worldArrived && state.activeStructuralAnimations === 0;
  }, null, { timeout: 120_000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  // Let the demand canvas finish drawing. This is a witness wait, not a duration measurement.
  let previous = '';
  let equal = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.waitForTimeout(150);
    const state = await page.evaluate(() => JSON.stringify({ camera: document.querySelector('.world-camera')?.getAttribute('transform'), pan: document.querySelector('.world-pan-layer')?.style.transform, three: window.__laneKReadThree() }));
    equal = state === previous ? equal + 1 : 0;
    previous = state;
    if (equal >= 2) return;
  }
  throw Error('The native camera/canvas did not hold still while the app clock was held');
}

async function sample(page, timestamp) {
  const tick = await page.evaluate(time => window.__laneKClock.sample(time), timestamp);
  if (tick.delivered === 0) throw Error(`No app-clock frame consumed sample ${timestamp}`);
  await settleNative(page);
  return Number(await page.locator('.act2-intro').getAttribute('data-act2-progress'));
}

async function capture({ page, arm }, name, previewFile) {
  await settleNative(page);
  const reading = await page.evaluate(() => {
    const bridge = window.__storytreeSceneExport;
    const statuses = [];
    const walk = node => { if (['territory', 'parcel'].includes(node.kind)) statuses.push({ kind: node.kind, id: node.id, status: node.status }); for (const child of node.children ?? []) walk(child); };
    walk(bridge.scene);
    const mount = document.querySelector('[data-testid="land-mount"]');
    const canvas = mount.querySelector('canvas');
    return {
      visibility: document.visibilityState, viewport: { width: innerWidth, height: innerHeight },
      camera: document.querySelector('.world-camera')?.getAttribute('transform'),
      compositor: document.querySelector('.world-pan-layer')?.style.transform,
      canvasSize: { width: canvas.width, height: canvas.height, rect: canvas.getBoundingClientRect().toJSON() },
      mount: mount.dataset.state, regrowActive: mount.querySelector('[data-regrow-active]')?.getAttribute('data-regrow-active') ?? null,
      progress: Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')),
      readout: document.querySelector('.act2-intro-readout')?.textContent,
      clock: window.__laneKClock.read(), motion: window.__storytreeMotionSettled?.(), three: window.__laneKReadThree(),
      world: bridge.world, trails: bridge.trails, statuses,
      labels: [...document.querySelectorAll('.world-plate')].map(element => element.textContent),
      paint: { board: getComputedStyle(document.querySelector('.hex-coast')).opacity, heroOpacities: [...document.querySelectorAll('.world-scene image.veg-track-tree')].map(element => getComputedStyle(element).opacity) },
    };
  });
  if (reading.visibility !== 'visible' || reading.viewport.width !== viewport.width || reading.viewport.height !== viewport.height || reading.canvasSize.width <= 0 || reading.canvasSize.height <= 0) throw Error('Capture surface is hidden or has no layout');
  if (reading.three.frameloop !== 'demand') throw Error('Mounted canvas is not demand-driven');
  if (reading.progress < 1 && reading.regrowActive !== (arm === 'active' ? 'true' : null)) throw Error(`Control not effective at ${name}: ${reading.regrowActive}`);
  if (reading.progress === 1 && reading.regrowActive !== null) throw Error('Settled canvas still carries an active regrow presentation');
  reading.dataSha256 = hash(JSON.stringify({ world: reading.world, trails: reading.trails, statuses: reading.statuses, labels: reading.labels }));
  const file = `${arm}-${name}.png`;
  const canvasPixels = await page.evaluate(() => window.__laneKCanvasPixels());
  writeFileSync(path.join(out, `${arm}-${name}-canvas.png`), Buffer.from(canvasPixels.split(',')[1], 'base64'));
  await page.screenshot({ path: previewFile || path.join(out, file) });
  reading.file = previewFile ? path.basename(previewFile) : file;
  result.arms[arm].views[name] = reading;
  console.log(`${arm} ${name}: cursor=${reading.progress}, app ms=${reading.clock.now}, camera=${reading.camera}, regrow=${reading.regrowActive}`);
  return reading;
}

async function diagnoseCoverage({ page }, name) {
  const before = await page.evaluate(() => ({ camera: document.querySelector('.world-camera')?.getAttribute('transform'), progress: document.querySelector('.act2-intro')?.getAttribute('data-act2-progress'), flora: [...document.querySelectorAll('.world-scene .parcel-flora')].map(element => ({ cap: element.closest('[data-cap-id]')?.getAttribute('data-cap-id'), opacity: getComputedStyle(element).opacity, rect: element.getBoundingClientRect().toJSON() })).filter(item => item.rect.x < innerWidth && item.rect.y < innerHeight && item.rect.right > 0 && item.rect.bottom > 0) }));
  const style = await page.addStyleTag({ content: '.world-scene .parcel-flora { opacity: 0 !important; }' });
  const changed = await page.evaluate(() => [...document.querySelectorAll('.world-scene .parcel-flora')].every(element => getComputedStyle(element).opacity === '0'));
  if (!changed || before.flora.length === 0) throw Error('SVG coverage diagnostic was ineffective');
  await page.screenshot({ path: path.join(out, `active-${name}-no-svg-coverage.png`) });
  await style.evaluate(element => element.remove());
  const after = await page.evaluate(() => ({ camera: document.querySelector('.world-camera')?.getAttribute('transform'), progress: document.querySelector('.act2-intro')?.getAttribute('data-act2-progress') }));
  if (before.camera !== after.camera || before.progress !== after.progress) throw Error('Coverage diagnostic changed the camera or app cursor');
  result.arms.active.views[name].coverageDiagnostic = before;
}

try {
  const active = await openArm('active');
  const initial = Number(await active.page.locator('.act2-intro').getAttribute('data-act2-progress'));
  if (initial !== 0) throw Error(`The fresh manual-clock run did not start at zero: ${initial}`);
  await capture(active, 'start');
  const calibrationProgress = await sample(active.page, 1000);
  if (!(calibrationProgress > 0 && calibrationProgress < 0.1)) throw Error(`Cannot calibrate this live plan from 1 second: ${calibrationProgress}`);
  // The diagnostic cursor is rounded to four decimals, so duration here is explicitly an ESTIMATE
  // used only to choose attractive sample instants. All captions use the app's actual readout.
  const estimatedDurationMs = 1000 / calibrationProgress;
  result.estimatedRunDurationMs = estimatedDurationMs;
  const samples = [['early', 0.15], ['middle', 0.5], ['late', 0.8], ['settled', 1.05]].map(([name, fraction]) => [name, estimatedDurationMs * fraction]);
  result.samples = samples;
  for (const [name, timestamp] of samples) {
    await sample(active.page, timestamp); await capture(active, name);
    if (['early', 'middle'].includes(name)) await diagnoseCoverage(active, name);
  }
  if (result.arms.active.views.settled.progress !== 1) throw Error('The last sample did not settle the forest');
  await active.context.close();
  snapshotFrozen = true;
  saveSnapshot();
  result.snapshotSha256 = hash(readFileSync(snapshotPath));
  result.snapshotRequestPaths = [...payloads.keys()].sort();

  const control = await openArm('control');
  await capture(control, 'start');
  await sample(control.page, 1000);
  for (const [name, timestamp] of samples) { await sample(control.page, timestamp); await capture(control, name); }
  await control.context.close();
  for (const [name, a] of Object.entries(result.arms.active.views)) {
    const b = result.arms.control.views[name];
    for (const key of ['progress', 'camera', 'compositor', 'dataSha256', 'canvasSize']) if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) throw Error(`Active/control ${name} differ in ${key}`);
    if (JSON.stringify(a.three.camera) !== JSON.stringify(b.three.camera)) throw Error(`Actual WebGL cameras differ at ${name}`);
  }
  result.pairedControls = 'All five samples have identical app cursors, SVG/compositor cameras, actual WebGL cameras, canvas dimensions, world layout, story/parcel status values, labels and routed edges.';
  result.sourceSha256After = sourceDigest();
  if (result.sourceSha256After !== result.sourceSha256 || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head) throw Error('Product source or HEAD changed during capture; reject the comparison');
  if (result.errors.length) throw Error(result.errors.join('\n'));
  writeFileSync(path.join(out, 'measurements.json'), `${JSON.stringify(result, null, 2)}\n`);
  execFileSync('python3', [path.join(out, 'compose.py')], { stdio: 'inherit' });
} catch (error) {
  result.failure = error.stack;
  writeFileSync('/tmp/laneK-capture-failure.json', `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally {
  await browser.close();
}
