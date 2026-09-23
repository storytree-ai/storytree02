// Scratch instrument: actual studio consumers, native app clock, real RTX GPU timer queries.
// Run from the NEW worktree under /tmp/storytree-heavy.lock. No product source is changed.
// Driver-requested renders below measure GPU cost; they are NOT quiet-frame observations.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const require = createRequire(path.resolve('apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const base = process.env.LANEK_URL || 'http://127.0.0.1:5209';
const out = path.resolve(process.env.LANEK_COST_OUT || '/tmp/laneK-cost-evidence');
const viewport = { width: 1800, height: 1100 };
const attempts = 7;
const rendersPerBatch = 10;
const hash = value => createHash('sha256').update(value).digest('hex');
const sourceDigest = () => hash(JSON.stringify(['apps/studio/src', 'packages/forest-world/src', 'packages/forest-world-r3f/src'].flatMap(directory => readdirSync(directory, { recursive: true }).filter(file => /\.(?:tsx?|css)$/.test(file)).map(file => [path.join(directory, file), hash(readFileSync(path.join(directory, file)))])).sort(([a], [b]) => a.localeCompare(b))));
const median = xs => { const s = [...xs].sort((a, b) => a - b); const middle = Math.floor(s.length / 2); return s.length % 2 ? s[middle] : (s[middle - 1] + s[middle]) / 2; };
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const health = await (await fetch(`${base}/api/health`)).json();
if (health.code?.directory !== process.cwd() || health.code?.head !== head || health.code?.stale || health.store !== 'pg' || health.db !== 'ok') throw Error(`Wrong/stale server or unavailable live store: ${JSON.stringify(health)}`);
mkdirSync(out, { recursive: true });
const result = {
  takenAt: new Date().toISOString(), head, health, sourceSha256: sourceDigest(), viewport, attempts, rendersPerBatch,
  method: {
    clock: 'Unmodified native app clock and native renderer animation frames. No clock injection.',
    gpu: 'EXT_disjoint_timer_query_webgl2 TIME_ELAPSED_EXT around batches of actual renderer.render(scene, camera), divided by 10. No CPU submission-time or gl.finish fallback.',
    integrity: 'Borrowed from packages/forest-world-r3f/harness/frame-cost.ts: discard disjoint/unavailable samples; require at least 3 accepted AND a majority of attempts; reject software, hidden pages and absent extension.',
    load: 'Fresh browser context with HTTP cache disabled; actual development-server modules and live or frozen-snapshot API data. Server/process/OS and GPU driver/shader caches are not reset. First observed populated native renderer followed by a native repaint is an observation bound, not an exact first-present hardware timestamp.',
    settledCost: 'Warmed settled scene at each real consumer\'s unchanged opening camera. Mounted and standalone are separate product compositions/canvas sizes, not an equivalent-work A/B.',
    scope: 'GPU render component and descriptive development load observations. Excludes app CPU update/compositor cost from GPU time; does not infer FPS or satisfy the Adreno hardware floor.',
  }, cases: {}, errors: [],
};
const payloads = new Map();
const pending = new Map();
let frozen = false;
const snapshotPath = '/tmp/laneK-cost-api-snapshot.json';
const saveSnapshot = () => writeFileSync(snapshotPath, JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { ...value, body: value.body.toString('base64') }])));
const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
const contexts = [];

async function openCase(name, query, testId) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'no-preference' });
  contexts.push(context);
  const modules = new Set();
  context.on('request', request => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(request.url())) modules.add(request.url()); });
  await context.addInitScript(() => {
    const load = window.__laneKLoad = { paint: [], longTasks: [], observerSupported: { paint: false, longtask: false } };
    for (const type of ['paint', 'longtask']) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      load.observerSupported[type] = true;
      new PerformanceObserver(list => {
        const target = type === 'paint' ? load.paint : load.longTasks;
        for (const entry of list.getEntries()) target.push({ name: entry.name, startTime: entry.startTime, duration: entry.duration });
      }).observe({ type, buffered: true });
    }
  });
  await context.route('**/api/**', async route => {
    if (route.request().method() !== 'GET') return route.continue();
    const url = new URL(route.request().url()); const key = `${url.pathname}${url.search}`;
    try {
      if (!payloads.has(key)) {
        if (frozen) throw Error(`A new API path appeared after snapshot freeze: ${key}`);
        if (!pending.has(key)) pending.set(key, (async () => { const response = await route.fetch(); payloads.set(key, { status: response.status(), headers: response.headers(), body: await response.body() }); saveSnapshot(); })());
        await pending.get(key);
      }
      await route.fulfill(payloads.get(key));
    } catch (error) { result.errors.push(`${name} API: ${error.message}`); await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => result.errors.push(`${name}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') result.errors.push(`${name} console: ${message.text()}`); });
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  const requestedAt = new Date().toISOString();
  await page.goto(`${base}/${query}#/tree`, { waitUntil: 'domcontentloaded', timeout: 180_000 });
  await page.bringToFront();
  await page.waitForSelector(`[data-testid="${testId}"] canvas`, { timeout: 180_000 });
  const hostObservedMs = await page.evaluate(() => performance.now());
  // The module request happens before its Canvas exists, so it is safe to require one URL now.
  if (modules.size !== 1) throw Error(`Cannot identify one loaded R3F module for ${name}: ${JSON.stringify([...modules])}`);
  await page.evaluate(async ({ moduleUrl, testId }) => {
    const module = await import(moduleUrl);
    const canvas = document.querySelector(`[data-testid="${testId}"] canvas`);
    let root;
    for (let attempt = 0; attempt < 1200; attempt += 1) {
      root = module._roots.get(canvas);
      if (root?.store?.getState()?.gl) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    if (!root?.store?.getState()?.gl) throw Error('No ready actual R3F renderer');
    const store = root.store;
    const gl = store.getState().gl.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) throw Error('A WebGL2 GPU query context is required');
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    const vendor = String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR));
    const timer = gl.getExtension('EXT_disjoint_timer_query_webgl2');
    const identity = { renderer, vendor, software: /swiftshader|llvmpipe|software/i.test(renderer), timerQuery: Boolean(timer), webglVersion: gl.getParameter(gl.VERSION), display: ':0 or inherited DISPLAY' };
    if (identity.software || !/RTX\s*2060/i.test(renderer)) throw Error(`Expected this machine's actual RTX 2060: ${renderer}`);
    if (!timer) throw Error('No EXT_disjoint_timer_query_webgl2; GPU cost is unverified');
    const read = () => {
      const state = store.getState();
      const sceneObjects = { meshes: 0, instances: 0, meshVertices: 0 };
      state.scene.traverse(object => { if (object.isMesh) { sceneObjects.meshes += 1; sceneObjects.instances += object.isInstancedMesh ? object.count : 1; sceneObjects.meshVertices += object.geometry?.attributes?.position?.count ?? 0; } });
      const bridge = window.__storytreeSceneExport;
      return { identity, nowMs: performance.now(), hidden: document.hidden, visibility: document.visibilityState, viewport: [innerWidth, innerHeight], progress: Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')), camera: { zoom: state.camera.zoom, position: state.camera.position.toArray(), quaternion: state.camera.quaternion.toArray(), near: state.camera.near, far: state.camera.far }, canvas: { width: canvas.width, height: canvas.height, rect: canvas.getBoundingClientRect().toJSON(), dpr: state.viewport.dpr }, frameloop: state.frameloop, frames: state.gl.info.render.frame, calls: state.gl.info.render.calls, triangles: state.gl.info.render.triangles, geometries: state.gl.info.memory.geometries, textures: state.gl.info.memory.textures, sceneObjects, world: bridge?.world ?? null, trails: bridge?.trails ?? null };
    };
    window.__laneKCost = {
      read,
      warm: async () => {
        if (document.hidden || document.visibilityState !== 'visible') throw Error('Cannot warm a hidden surface');
        const state = store.getState();
        for (let frame = 0; frame < 20; frame += 1) state.gl.render(state.scene, state.camera);
        gl.flush();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      },
      snapshot: () => { const state = store.getState(); state.gl.render(state.scene, state.camera); return canvas.toDataURL('image/png'); },
      batch: async count => {
        const before = read();
        if (before.hidden || before.visibility !== 'visible') throw Error('Cannot time a hidden surface');
        if (before.progress !== 1) throw Error('Settled GPU cost requires the app to be settled');
        if (gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY)) throw Error('Another GPU timer query is already active');
        const query = gl.createQuery();
        if (!query) throw Error('Could not allocate a GPU timer query');
        let disjoint = Boolean(gl.getParameter(timer.GPU_DISJOINT_EXT));
        let available = false; let elapsedNs = null;
        const state = store.getState();
        try {
          gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          for (let frame = 0; frame < count; frame += 1) state.gl.render(state.scene, state.camera);
          gl.endQuery(timer.TIME_ELAPSED_EXT); gl.flush();
          for (let poll = 0; poll < 600; poll += 1) {
            disjoint = Boolean(gl.getParameter(timer.GPU_DISJOINT_EXT)) || disjoint;
            available = gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) === true;
            if (available) { elapsedNs = Number(gl.getQueryParameter(query, gl.QUERY_RESULT)); break; }
            await new Promise(resolve => requestAnimationFrame(resolve));
          }
          disjoint = Boolean(gl.getParameter(timer.GPU_DISJOINT_EXT)) || disjoint;
        } finally { gl.deleteQuery(query); }
        const after = read();
        if (after.hidden || after.visibility !== 'visible') throw Error('The page became hidden during GPU measurement');
        if (JSON.stringify(before.camera) !== JSON.stringify(after.camera) || before.progress !== after.progress || JSON.stringify(before.canvas) !== JSON.stringify(after.canvas)) throw Error('Camera/canvas/cursor changed inside a GPU batch');
        return { renders: count, available, disjoint, gpuMsPerFrame: elapsedNs === null ? null : elapsedNs / count / 1e6, before, after };
      },
    };
    window.__laneKLoad.rootObservedMs = performance.now();
  }, { moduleUrl: [...modules][0], testId });
  await page.waitForFunction(() => {
    const state = window.__laneKCost.read();
    return state.frames > 0 && state.calls > 0 && state.sceneObjects.meshes > 0 && state.sceneObjects.meshVertices > 0;
  }, null, { timeout: 180_000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const firstPopulatedPaintObserved = await page.evaluate(() => ({ observedMs: performance.now(), state: window.__laneKCost.read() }));
  await page.waitForFunction(() => window.__storytreeSceneExport && window.__storytreeMotionSettled?.().settled && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'), null, { timeout: 180_000 });
  await settle(page);
  const load = await page.evaluate(() => ({ ...window.__laneKLoad, settledObservedMs: performance.now(), navigation: performance.getEntriesByType('navigation').map(entry => ({ domContentLoadedEventEnd: entry.domContentLoadedEventEnd, loadEventEnd: entry.loadEventEnd, responseStart: entry.responseStart, responseEnd: entry.responseEnd })) }));
  const opening = await page.evaluate(() => window.__laneKCost.read());
  if (opening.hidden || opening.visibility !== 'visible' || opening.viewport[0] !== viewport.width || opening.viewport[1] !== viewport.height || opening.progress !== 1) throw Error(`${name}: invalid settled opening state`);
  const canvasPng = await page.evaluate(() => window.__laneKCost.snapshot());
  writeFileSync(path.join(out, `${name}-settled-canvas.png`), Buffer.from(canvasPng.split(',')[1], 'base64'));
  await page.screenshot({ path: path.join(out, `${name}-opening.png`) });
  result.cases[name] = { query, testId, requestedAt, apiSource: name === 'mounted' ? 'First GET per path captured from live PostgreSQL-backed dev API, then replayed' : 'Same captured API bodies replayed; this is not a second live data load', load: { ...load, hostObservedMs, firstPopulatedPaintObserved }, opening, dataSha256: hash(JSON.stringify({ world: opening.world, trails: opening.trails })), samples: [] };
  return { name, page, context };
}

async function settle(page) {
  await page.bringToFront();
  let previous = ''; let same = 0;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    await page.waitForTimeout(100);
    const state = await page.evaluate(() => window.__laneKCost.read());
    // Frame count is deliberately excluded: this instrument is not the quiet-loop proof.
    const fingerprint = JSON.stringify({ camera: state.camera, canvas: state.canvas, progress: state.progress, objects: state.sceneObjects, geometries: state.geometries, textures: state.textures });
    same = previous === fingerprint ? same + 1 : 0; previous = fingerprint;
    if (same >= 3) return;
  }
  throw Error('The actual opening camera/assets did not settle');
}

function summarize(samples) {
  const accepted = samples.filter(sample => !sample.disjoint && sample.available && Number.isFinite(sample.gpuMsPerFrame));
  const values = accepted.map(sample => sample.gpuMsPerFrame);
  const sound = accepted.length >= 3 && accepted.length * 2 > samples.length;
  return { integrity: sound ? 'SOUND' : 'UNVERIFIED', attempted: samples.length, accepted: accepted.length, discardedDisjoint: samples.filter(sample => sample.disjoint).length, discardedUnavailable: samples.filter(sample => !sample.disjoint && (!sample.available || !Number.isFinite(sample.gpuMsPerFrame))).length, acceptedGpuMsPerFrame: values, medianGpuMsPerFrame: sound ? median(values) : null, spreadGpuMs: sound ? Math.max(...values) - Math.min(...values) : null, minimumGpuMs: sound ? Math.min(...values) : null, maximumGpuMs: sound ? Math.max(...values) : null };
}

try {
  const mounted = await openCase('mounted', '?landMount=1&landMountProps=1&act2=intro&sceneExport=1', 'land-mount');
  frozen = true; saveSnapshot(); result.snapshotSha256 = hash(readFileSync(snapshotPath)); result.snapshotPaths = [...payloads.keys()].sort();
  const standalone = await openCase('standalone', '?landView=1&act2=intro&sceneExport=1', 'land-view');
  if (result.cases.mounted.dataSha256 !== result.cases.standalone.dataSha256) throw Error('The real consumers received different forest data/layout');
  const arms = [mounted, standalone];
  for (const arm of arms) { await arm.page.bringToFront(); await settle(arm.page); await arm.page.evaluate(() => window.__laneKCost.warm()); }
  for (let repeat = 0; repeat < attempts; repeat += 1) {
    // Alternate order to avoid giving one arm every first/last reading during GPU warm-up drift.
    for (const arm of repeat % 2 ? [...arms].reverse() : arms) {
      await arm.page.bringToFront(); await settle(arm.page);
      const sample = await arm.page.evaluate(count => window.__laneKCost.batch(count), rendersPerBatch);
      const opening = result.cases[arm.name].opening;
      if (JSON.stringify(sample.before.camera) !== JSON.stringify(opening.camera) || JSON.stringify(sample.before.canvas) !== JSON.stringify(opening.canvas)) throw Error(`${arm.name}: this batch differs from the real opening camera/canvas`);
      result.cases[arm.name].samples.push({ repeat, ...sample });
      console.log(`${arm.name} repeat ${repeat + 1}: ${sample.gpuMsPerFrame ?? 'unavailable'} GPU ms/render; disjoint=${sample.disjoint}`);
    }
  }
  for (const arm of arms) {
    const row = result.cases[arm.name]; row.summary = summarize(row.samples);
    if (row.summary.integrity !== 'SOUND') throw Error(`${arm.name}: GPU sample integrity is UNVERIFIED (${row.summary.accepted}/${row.summary.attempted} accepted)`);
  }
  result.sourceSha256After = sourceDigest();
  if (result.sourceSha256After !== result.sourceSha256 || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head) throw Error('Source or HEAD changed during the measurement');
  if (result.errors.length) throw Error(result.errors.join('\n'));
  result.integrity = 'SOUND';
  writeFileSync(path.join(out, 'measurements.json'), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    '# laneK — actual studio canvas cost', '',
    'These are warmed GPU render costs on the actual RTX 2060, at each real consumer\'s unchanged opening camera. They are not app frame rate, CPU update cost, production load promises, quiet-frame evidence or the Adreno acceptance floor.', '',
    '| Consumer | Canvas | Accepted / attempted | Median GPU ms/render | Full spread ms |',
    '| --- | --- | ---: | ---: | ---: |',
    ...arms.map(({ name }) => { const row = result.cases[name]; return `| ${name} | ${row.opening.canvas.width}×${row.opening.canvas.height} | ${row.summary.accepted}/${row.summary.attempted} | ${row.summary.medianGpuMsPerFrame.toFixed(3)} | ${row.summary.spreadGpuMs.toFixed(3)} |`; }), '',
    'The two consumers use different product compositions and canvas sizes; their rows are descriptions, not an equal-work comparison. Seven interleaved batches of ten actual scene renders use EXT_disjoint_timer_query_webgl2. Disjoint/unavailable results are excluded; at least three and a majority must survive.', '',
    '| Cold browser context, dev server | First observed populated renderer + native repaint (ms from navigation) | App settled observed (ms) | API path |',
    '| --- | ---: | ---: | --- |',
    ...arms.map(({ name }) => { const row = result.cases[name]; return `| ${name} | ${row.load.firstPopulatedPaintObserved.observedMs.toFixed(1)} | ${row.load.settledObservedMs.toFixed(1)} | ${name === 'mounted' ? 'Live snapshot acquisition' : 'Frozen snapshot replay'} |`; }), '',
    'Browser HTTP caches are disabled and contexts are fresh. The development server, OS, filesystem and GPU driver/shader caches are not reset. The first-populated value is an observation bound followed by native repaint, not an exact hardware first-present timestamp. Settled time includes the real app intro; long-task and browser-paint observations are in measurements.json.', '',
    `HEAD: ${head}`, `Source SHA-256 (unchanged throughout): ${result.sourceSha256}`, `API snapshot SHA-256: ${result.snapshotSha256}`, '',
  ];
  writeFileSync(path.join(out, 'report.md'), lines.join('\n'));
  console.log(`SOUND GPU measurement written to ${out}; no product performance acceptance verdict inferred.`);
} catch (error) {
  result.integrity = 'UNVERIFIED'; result.failure = error.stack;
  for (const row of Object.values(result.cases)) row.summary = summarize(row.samples);
  writeFileSync(path.join(out, 'measurements.json'), `${JSON.stringify(result, null, 2)}\n`);
  throw error;
} finally { for (const context of contexts) await context.close(); await browser.close(); }
