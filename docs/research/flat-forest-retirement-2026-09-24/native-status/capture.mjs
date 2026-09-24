#!/usr/bin/env node
// Disposable static capture, adapted from docs/research/3d-regrow-quiet-2026-09-24/capture-behavior.mjs.
// Diagnostic extension is syntax-checked only. Root owns servers and the heavy lock. No product edits or API writes.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const help = `Static real-consumer comparison (requires existing servers; never starts/stops them).
node capture.mjs --run --heavy-lock-held \\
  --before-url http://127.0.0.1:PORT --before-dir /absolute/tree --before-head FULL_SHA --before-pid PID \\
  --after-url http://127.0.0.1:PORT --after-dir /absolute/tree --after-head FULL_SHA --after-pid PID \\
  [--out /tmp/new-output-dir] [--viewport 1800x1100] [--zoom-steps 8] [--zoom-anchor 0.6,0.45]
All URL/path/HEAD inputs are explicit. --zoom-steps 0 captures rest only.
--heavy-lock-held declares the caller holds /tmp/storytree-heavy.lock for this process's lifetime.
No behavior/performance or owner-appearance verdict is produced.`;
if (process.argv.includes('--help')) { console.log(help); process.exit(0); }
const flags = new Set(['run', 'heavy-lock-held']);
const allowed = new Set(['before-url', 'before-dir', 'before-head', 'before-pid', 'after-url', 'after-dir', 'after-head', 'after-pid', 'out', 'viewport', 'zoom-steps', 'zoom-anchor']);
const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i].replace(/^--/, '');
  if (!process.argv[i].startsWith('--') || (!flags.has(key) && !allowed.has(key))) throw Error(`Unknown argument ${process.argv[i]}`);
  if (args.has(key)) throw Error(`Repeated argument --${key}`);
  if (flags.has(key)) args.set(key, true);
  else { const value = process.argv[++i]; if (!value || value.startsWith('--')) throw Error(`Missing value for --${key}`); args.set(key, value); }
}
if (!args.has('run') || !args.has('heavy-lock-held')) throw Error(`Refusing browser launch without explicit --run --heavy-lock-held.\n${help}`);
const required = key => { const value = args.get(key); if (!value) throw Error(`Required --${key}`); return value; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const git = (dir, ...argv) => execFileSync('git', ['-C', dir, ...argv], { encoding: 'utf8' }).trim();
const sides = ['before', 'after'].map(name => {
  const rawDir = required(`${name}-dir`);
  if (!path.isAbsolute(rawDir)) throw Error(`${name} directory must be absolute`);
  const dir = realpathSync(rawDir); const head = required(`${name}-head`);
  if (!/^[a-f0-9]{40}$/.test(head)) throw Error(`${name} HEAD must be its explicit full SHA`);
  const url = new URL(required(`${name}-url`));
  if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) throw Error(`${name} URL must be the server origin only`);
  if (git(dir, 'rev-parse', 'HEAD') !== head) throw Error(`${name} checkout HEAD does not match input`);
  const pid = Number(required(`${name}-pid`));
  if (!Number.isInteger(pid) || pid < 1) throw Error(`${name} requires the exact owned server PID`);
  return { name, dir, head, pid, origin: url.origin };
});
if (sides[0].origin === sides[1].origin || sides[0].dir === sides[1].dir) throw Error('Before and after must name distinct servers and trees');
const out = path.resolve(args.get('out') ?? `/tmp/laneK-retire-native-status-capture/run-${new Date().toISOString().replace(/[:.]/g, '-')}`);
if (!out.startsWith('/tmp/')) throw Error('This disposable runner writes only beneath /tmp');
if (existsSync(out)) throw Error(`Output already exists; use a fresh directory: ${out}`);
const dimensions = /^(\d+)x(\d+)$/.exec(args.get('viewport') ?? '1800x1100');
if (!dimensions) throw Error('Invalid --viewport');
const viewport = { width: Number(dimensions[1]), height: Number(dimensions[2]) };
if (viewport.width < 800 || viewport.height < 600) throw Error('Viewport must be at least 800x600');
const zoomSteps = Number(args.get('zoom-steps') ?? 8);
const anchor = String(args.get('zoom-anchor') ?? '0.6,0.45').split(',').map(Number);
if (!Number.isInteger(zoomSteps) || zoomSteps < 0 || zoomSteps > 30 || anchor.length !== 2 || anchor.some(n => !Number.isFinite(n) || n <= 0 || n >= 1)) throw Error('Invalid zoom steps/anchor');
const query = '?landMount=1&landMountProps=1&landView=1&act2=intro&sceneExport=1';
const consumers = ['land-mount', 'land-view'];
const diagnosticSelector = '.world-scene .parcel-flora';
const diagnosticCss = `${diagnosticSelector} { opacity: 0 !important; }`;
const sourceRoots = ['apps/studio/src', 'apps/studio/server', 'packages/app-surface/src', 'packages/forest-world/src', 'packages/forest-world-r3f/src', 'packages/forest-layout/src'];
const expectedModules = ['apps/studio/src/components/TreeView.tsx', 'apps/studio/src/components/LandViewMount.tsx', 'packages/forest-world-r3f/src/ForestWorldCanvas.tsx', 'packages/forest-world-r3f/src/world-to-3d.ts', 'packages/forest-world-r3f/src/kit-mesh.ts'];
const afterOnlyModules = ['packages/forest-world-r3f/src/kit-status-presentation.ts'];
const require = createRequire(path.join(sides[1].dir, 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const requireRenderer = createRequire(path.join(sides[1].dir, 'packages/forest-world-r3f/package.json'));
const { Matrix4 } = requireRenderer('three');
const projectionCoefficientTolerance = 1e-10;
const cameraSourceCause = [
  'Both builds include the repaired coverage mapper. The native status sidecar changes material presentation and registered canvas pointer eligibility; it has no camera or placement authority.',
  'This comparison requires exact actual camera records for both the mounted and standalone consumers, together with unchanged canvas, host and stable live data.',
  'Mounted orthographic X/Y/W view-projection coefficients are additionally checked with the renderer package Three Matrix4 implementation at tolerance 1e-10. Complete depth and framing values remain in the receipts.',
];
const executable = chromium.executablePath();
if (!existsSync(executable)) throw Error(`Installed Chromium missing: ${executable}`);
mkdirSync(out, { recursive: true, mode: 0o700 });
const save = (name, value) => writeFileSync(path.join(out, name), json(value), { mode: 0o600 });
const manifest = {
  status: 'RUNNING', startedAt: new Date().toISOString(), inputs: { sides, query, viewport, zoomSteps, anchor },
  browser: { playwright: require('@playwright/test/package.json').version, executable },
  cameraComparisonPolicy: { method: 'actual Three Matrix4 projectionMatrix * inverse(matrixWorld), comparing X/Y/W rows', coefficientTolerance: projectionCoefficientTolerance, matrixLibrary: requireRenderer.resolve('three'), mounted: 'exact actual camera equality plus XY projection and unchanged canvas/host/data; full depth values retained', standalone: 'exact actual camera equality required; controlled static framing', priorFailure: 'Earlier mapper comparison runs are separate evidence and are not rewritten', sourceCause: cameraSourceCause },
  instrument: { reducedMotion: 'reduce', deviceScaleFactor: 1, apiSource: 'after host only, then frozen exact-body replay', cssChanges: [], clockChanges: [], cameraChanges: 'only real host wheel input', heavyLock: 'caller-declared held' },
  limits: [
    'Ordinary full screenshots preserve the SVG overlay and native coverage flora; double presentation is expected until retirement.',
    'An AFTER-only real legend toggle follows ordinary captures, fades healthy status and restores it. No CSS diagnosis runs in this status comparison. Target identity and host accessibility remain measured; native screen-space hit envelopes are a separate remaining unit.',
    'Raw land-mount PNGs compare the actual mounted 3D canvas with exact camera records and equal orthographic XYW view-projection coefficients within the explicit 1e-10 tolerance, plus unchanged canvas, host and stable data.',
    'Camera depth position, near/far and complete raw matrices remain in the receipts and comparisons. Exact camera equality does not establish clipping sufficiency or pixel identity; those are separate observations.',
    'Both the LEFT mounted view and RIGHT standalone panel must preserve their actual framing. Status legend toggles are measured on the mounted consumer; the standalone raw canvas must remain unchanged during the toggle.',
    'Both consumers are enabled together by the stated query; this is not the ordinary single-panel opening composition.',
    'Static reduced-motion appearance evidence only: no growth, quiet-render, performance or hardware-floor verdict.',
    'The API snapshot is a frozen set acquired in one warm-up window, not a database transaction snapshot. Browser health bodies also replay after-host bytes; independently fetched health receipts prove each real server identity.',
    'Live session wisps and other elapsed-time decorations may differ despite identical API bodies; exact scene exports are retained.',
    'Raw PNG extraction explicitly renders each existing scene with its actual camera once, then reads its canvas. No camera or renderer clock is changed.',
    'Diagnostic clock checks observe the settled app cursor/readout and regrow state, plus unchanged browser timing-function identities. They do not freeze wall time or expose the app clock internals.',
    'Diagnostic data equality covers the frozen API inputs and exported world/trails/tile/spacing. Full drawable scene hashes are recorded separately because live elapsed-time decorations can change.',
    'CAPTURED means instrument checks passed. Appearance remains for the owner to judge.',
  ], identities: {}, contexts: {}, captures: {}, comparisons: {}, errors: [],
};
save('manifest.json', manifest);

function sourceIdentity(side) {
  const files = sourceRoots.flatMap(root => readdirSync(path.join(side.dir, root), { recursive: true })
    .filter(file => /\.(?:[cm]?[jt]sx?|css|json)$/.test(file))
    .map(file => { const relative = path.join(root, file); return { path: relative, sha256: hash(readFileSync(path.join(side.dir, relative))) }; }))
    .sort((a, b) => a.path.localeCompare(b.path));
  for (const relative of ['apps/studio/vite.config.ts', 'apps/studio/package.json', 'packages/forest-world-r3f/package.json', 'pnpm-lock.yaml']) files.push({ path: relative, sha256: hash(readFileSync(path.join(side.dir, relative))) });
  return { head: git(side.dir, 'rev-parse', 'HEAD'), status: git(side.dir, 'status', '--short'), sourceSha256: hash(JSON.stringify(files)), files };
}
async function health(side) {
  const response = await fetch(`${side.origin}/api/health`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw Error(`${side.name} health HTTP ${response.status}`);
  const body = await response.text(); const value = JSON.parse(body);
  if (value.pid !== side.pid || !value.code?.directory || realpathSync(value.code.directory) !== side.dir || value.code.head !== side.head || value.code.stale !== false || value.store !== 'pg' || value.db !== 'ok') throw Error(`${side.name} wrong/stale/unavailable host: ${body}`);
  return { capturedAt: new Date().toISOString(), url: response.url, bodySha256: hash(body), value };
}
function servedLocalPath(side, url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  if (pathname.startsWith('/src/')) return path.join(side.dir, 'apps/studio', pathname.slice(1));
  if (pathname.startsWith('/@fs/')) return path.resolve('/', pathname.slice(5));
  return null;
}

const payloads = new Map(); const acquiring = new Map(); let frozen = false; let browser;
function assertNoErrors() { if (manifest.errors.length) throw Error(manifest.errors.join('\n')); }
async function open(side, label, acquire = false) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const record = manifest.contexts[label] = { side: side.name, acquire, apiRequests: [], sourceReceipts: [], consoleWarnings: [], httpFailures: [] };
  const pendingSources = new Set(); const fiberModules = new Set();
  context.on('request', request => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(request.url())) fiberModules.add(request.url()); });
  context.on('response', response => {
    const localPath = servedLocalPath(side, response.url());
    if (!localPath || !/\.[jt]sx?$/.test(localPath)) return;
    const relative = path.relative(side.dir, localPath);
    if (![...expectedModules, ...(side.name === 'after' ? afterOnlyModules : [])].includes(relative)) return;
    const task = (async () => {
      const bytes = await response.body(); const text = bytes.toString();
      const match = /sourceMappingURL=data:application\/json(?:;charset=[^;,]+)?;base64,([^\s]+)/.exec(text);
      if (!response.ok() || !match) throw Error(`${label}: missing successful served-source map for ${relative}`);
      const map = JSON.parse(Buffer.from(match[1], 'base64').toString());
      const disk = readFileSync(localPath, 'utf8');
      if (!map.sourcesContent?.includes(disk)) throw Error(`${label}: served source differs from ${localPath}`);
      const file = `${label}-served-${path.basename(relative)}.txt`;
      writeFileSync(path.join(out, file), bytes, { mode: 0o600 });
      record.sourceReceipts.push({ url: response.url(), file, localPath, relative, servedSha256: hash(bytes), localSha256: hash(disk), sourceMapMatchesDisk: true });
    })().catch(error => manifest.errors.push(error.message));
    pendingSources.add(task); task.finally(() => pendingSources.delete(task));
  });
  await context.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const key = `${url.pathname}${url.search}`;
    try {
      if (url.origin !== side.origin || request.method() !== 'GET') throw Error(`Refused ${request.method()} ${request.url()}`);
      if (!payloads.has(key)) {
        if (!acquire || frozen || side.name !== 'after') throw Error(`Uncaptured API request after freeze: ${key}`);
        if (!acquiring.has(key)) acquiring.set(key, (async () => {
          const response = await route.fetch({ timeout: 120_000 }); const body = await response.body();
          if (!response.ok()) throw Error(`Live API ${key}: HTTP ${response.status()}`);
          const headers = response.headers();
          for (const field of ['content-length', 'content-encoding', 'transfer-encoding']) delete headers[field];
          payloads.set(key, { status: response.status(), headers, body, acquiredAt: new Date().toISOString(), sourceUrl: response.url(), sha256: hash(body) });
        })());
        await acquiring.get(key);
      }
      const value = payloads.get(key);
      record.apiRequests.push({ key, sha256: value.sha256, at: new Date().toISOString() });
      await route.fulfill({ status: value.status, headers: value.headers, body: value.body });
    } catch (error) { manifest.errors.push(`${label} API: ${error.message}`); await route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', error => manifest.errors.push(`${label} page: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') manifest.errors.push(`${label} console: ${message.text()}`); else if (message.type() === 'warning') record.consoleWarnings.push(message.text()); });
  page.on('response', response => { if (response.status() >= 400) record.httpFailures.push({ url: response.url(), status: response.status() }); });
  await page.goto(`${side.origin}/${query}#/tree`, { waitUntil: 'load', timeout: 180_000 });
  await page.bringToFront();
  for (const kind of consumers) await page.waitForSelector(`[data-testid="${kind}"] canvas`, { timeout: 180_000 });
  await page.waitForFunction(() => window.__storytreeSceneExport && document.querySelector('.act2-intro') && !document.querySelector('.tree-wrap[data-cache-provisional="true"]'), null, { timeout: 180_000 });
  if (fiberModules.size !== 1) throw Error(`${label}: expected one actual loaded R3F module: ${JSON.stringify([...fiberModules])}`);
  record.fiberModule = [...fiberModules][0];
  await page.evaluate(async ({ moduleUrl, consumers }) => {
    const module = await import(moduleUrl); const roots = {};
    for (const kind of consumers) {
      const canvas = document.querySelector(`[data-testid="${kind}"] canvas`);
      for (let i = 0; i < 600; i += 1) {
        const root = module._roots.get(canvas);
        if (root?.store?.getState()?.gl) { roots[kind] = root; break; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      if (!roots[kind]) throw Error(`No actual R3F store for ${kind}`);
    }
    const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const css = element => { const s = getComputedStyle(element); return { transform: s.transform, transformOrigin: s.transformOrigin, opacity: s.opacity, display: s.display, visibility: s.visibility, position: s.position, zIndex: s.zIndex, pointerEvents: s.pointerEvents }; };
    window.__coverageCaptureRead = () => {
      const svg = document.querySelector('svg.world-scene'); const camera = document.querySelector('.world-camera'); const pan = document.querySelector('.world-pan-layer'); const frame = document.querySelector('.world-viewport');
      const counts = Object.fromEntries(['.parcel', '.world-cave', '.trail-fill', '.parcel-blade', '.parcel-flora', '.parcel-shrub', '.story-tree', '.world-plate-bg', '[data-edges]'].map(selector => [selector, svg.querySelectorAll(selector).length]));
      const coverageCss = [...svg.querySelectorAll('.parcel-flora')].slice(0, 8).map(element => ({ class: element.getAttribute('class'), css: css(element), rect: rect(element) }));
      const canvases = {};
      for (const [kind, root] of Object.entries(roots)) {
        const state = root.store.getState(); const gl = state.gl.getContext(); const ext = gl.getExtension('WEBGL_debug_renderer_info'); const c = state.camera;
        canvases[kind] = { frame: state.gl.info.render.frame, mode: state.frameloop, requested: state.internal.frames, camera: { type: c.type, position: c.position.toArray(), quaternion: c.quaternion.toArray(), zoom: c.zoom, near: c.near, far: c.far, left: c.left, right: c.right, top: c.top, bottom: c.bottom, projectionMatrix: c.projectionMatrix.toArray(), matrixWorld: c.matrixWorld.toArray() }, canvas: { width: state.gl.domElement.width, height: state.gl.domElement.height, rect: rect(state.gl.domElement), css: css(state.gl.domElement) }, renderer: String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)), renderInfo: { calls: state.gl.info.render.calls, triangles: state.gl.info.render.triangles }, regrow: document.querySelector(`[data-testid="${kind}"] [data-regrow-active]`)?.getAttribute('data-regrow-active') ?? null };
      }
      return { url: location.href, progress: Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')), readout: document.querySelector('.act2-intro-readout')?.textContent, settled: window.__storytreeMotionSettled?.(), hidden: document.hidden, visibility: document.visibilityState, viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, parked: document.querySelector('.tree-route')?.getAttribute('data-parked'), host: { svgRect: rect(svg), frameRect: rect(frame), cameraAttribute: camera.getAttribute('transform'), cameraCss: css(camera), cameraCTM: (() => { const m = camera.getScreenCTM(); return m ? [m.a, m.b, m.c, m.d, m.e, m.f] : null; })(), compositor: css(pan), svg: css(svg), mount: css(document.querySelector('[data-testid="land-mount"]')) }, counts, coverageCss, canvases };
    };
    window.__coverageCapturePixels = () => Object.fromEntries(Object.entries(roots).map(([kind, root]) => { const state = root.store.getState(); state.gl.render(state.scene, state.camera); return [kind, state.gl.domElement.toDataURL('image/png')]; }));
    window.__coverageCaptureObjects = () => Object.fromEntries(Object.entries(roots).map(([kind, root]) => {
      const objects = []; root.store.getState().scene.traverse(object => { if (!object.isMesh && !object.name) return; objects.push({ name: object.name, type: object.type, visible: object.visible, userData: object.userData, matrixWorld: object.matrixWorld.toArray(), instanceCount: object.count ?? null, vertices: object.geometry?.attributes?.position?.count ?? null, geometryId: object.geometry?.uuid ?? null, growthAttributes: Boolean(object.geometry?.attributes?.aRegrowSlot), materials: (Array.isArray(object.material) ? object.material : object.material ? [object.material] : []).map(m => ({ type: m.type, name: m.name, opacity: m.opacity, alphaTest: m.alphaTest, transparent: m.transparent, depthWrite: m.depthWrite, cacheKey: m.customProgramCacheKey() })) }); }); return [kind, objects];
    }));
  }, { moduleUrl: record.fiberModule, consumers });
  await settle(page, label);
  await Promise.all([...pendingSources]);
  for (const relative of [...expectedModules, ...(side.name === 'after' ? afterOnlyModules : [])]) if (!record.sourceReceipts.some(entry => entry.relative === relative)) throw Error(`${label}: no verified loaded source receipt for ${relative}`);
  if (record.httpFailures.length) throw Error(`${label}: HTTP failures ${JSON.stringify(record.httpFailures)}`);
  assertNoErrors();
  return { page, context, record };
}

async function read(page) { return page.evaluate(() => window.__coverageCaptureRead()); }
async function settle(page, label) {
  await page.waitForFunction(() => window.__storytreeMotionSettled?.().settled === true && Number(document.querySelector('.act2-intro')?.getAttribute('data-act2-progress')) === 1, null, { timeout: 180_000 });
  let previous; let unchanged = 0;
  for (let i = 0; i < 120; i += 1) {
    const state = await read(page);
    if (state.hidden || state.visibility !== 'visible' || state.viewport[0] !== viewport.width || state.viewport[1] !== viewport.height || state.dpr !== 1) throw Error(`${label}: hidden or wrongly sized capture surface`);
    for (const canvas of Object.values(state.canvases)) if (/swiftshader|llvmpipe|softpipe|software/i.test(canvas.renderer)) throw Error(`${label}: software renderer ${canvas.renderer}`);
    const fingerprint = JSON.stringify({ host: state.host, cameras: Object.fromEntries(Object.entries(state.canvases).map(([kind, c]) => [kind, { camera: c.camera, canvas: c.canvas, mode: c.mode }])) });
    unchanged = fingerprint === previous ? unchanged + 1 : 0; previous = fingerprint;
    if (unchanged >= 3 && Object.values(state.canvases).every(c => c.frame > 0 && c.canvas.width > 0 && c.canvas.height > 0 && c.mode === 'demand' && c.requested === 0)) { assertNoErrors(); return; }
    await page.waitForTimeout(150);
  }
  throw Error(`${label}: actual camera/layout/render demand did not settle`);
}
async function capture(page, side, framing) {
  const label = `${side.name}-${framing}`;
  await settle(page, label);
  const state = await read(page);
  const data = await page.evaluate(() => window.__storytreeSceneExport);
  if (!data.world?.islands?.length) throw Error(`${label}: empty exported live world`);
  const stableData = { world: data.world, trails: data.trails, tile: data.tile, spacing: data.spacing };
  const pixels = await page.evaluate(() => window.__coverageCapturePixels());
  const files = {};
  for (const [kind, value] of Object.entries(pixels)) {
    const bytes = Buffer.from(value.split(',')[1], 'base64'); const file = `${label}-${kind}-raw.png`;
    if (bytes.length < 1000) throw Error(`${label}: empty ${kind} PNG`);
    writeFileSync(path.join(out, file), bytes); files[kind] = { file, sha256: hash(bytes) };
  }
  const screenshot = `${label}-full.png`;
  console.log(`${label} element counts BEFORE screenshot: ${JSON.stringify(state.counts)}`);
  await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
  const after = await read(page);
  if (JSON.stringify(state.host) !== JSON.stringify(after.host) || JSON.stringify(Object.values(state.canvases).map(c => c.camera)) !== JSON.stringify(Object.values(after.canvases).map(c => c.camera))) throw Error(`${label}: camera moved during extraction`);
  save(`${label}-scene.json`, data);
  save(`${label}-objects.json`, await page.evaluate(() => window.__coverageCaptureObjects()));
  const receipt = { ...state, side: side.name, framing, fullScreenshot: { file: screenshot, sha256: hash(readFileSync(path.join(out, screenshot))) }, rawCanvases: files, sceneFile: `${label}-scene.json`, sceneSha256: hash(json(data)), stableDataSha256: hash(json(stableData)), objectsFile: `${label}-objects.json` };
  save(`${label}-receipt.json`, receipt); manifest.captures[label] = receipt;
  return receipt;
}
async function diagnostic(page, side, framing) {
  if (side.name !== 'after') throw Error('SVG-hiding diagnosis is AFTER-only');
  const label = `${side.name}-${framing}-svg-coverage-hidden-diagnostic`;
  const receipt = { purpose: 'Temporary harness diagnosis; not product styling, retirement or an appearance verdict', side: side.name, framing, selector: diagnosticSelector, cssText: diagnosticCss, stages: {}, checks: {} };
  manifest.diagnostic = receipt;
  await settle(page, label);
  await page.evaluate(selector => {
    if (window.__coverageDiagnosticGuard) throw Error('Diagnostic guard already present');
    const targets = [...document.querySelectorAll(selector)];
    if (!targets.length) throw Error('No SVG coverage targets for diagnosis');
    window.__coverageDiagnosticGuard = { targets, opacities: targets.map(element => getComputedStyle(element).opacity), performanceNow: performance.now, dateNow: Date.now, requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame };
  }, diagnosticSelector);
  async function stage(name) {
    const state = await read(page);
    const detail = await page.evaluate(selector => {
      const guard = window.__coverageDiagnosticGuard;
      const targets = [...document.querySelectorAll(selector)];
      const styles = targets.map(element => {
        let effectiveOpacity = 1;
        for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) effectiveOpacity *= Number(getComputedStyle(ancestor).opacity);
        return { opacity: getComputedStyle(element).opacity, effectiveOpacity };
      });
      const data = window.__storytreeSceneExport;
      return {
        styles, data: { world: data.world, trails: data.trails, tile: data.tile, spacing: data.spacing }, scene: data.scene,
        sameTargets: targets.length === guard.targets.length && targets.every((target, index) => target === guard.targets[index]),
        timingFunctionsUnchanged: performance.now === guard.performanceNow && Date.now === guard.dateNow && window.requestAnimationFrame === guard.requestAnimationFrame && window.cancelAnimationFrame === guard.cancelAnimationFrame,
      };
    }, diagnosticSelector);
    const pixels = await page.evaluate(() => window.__coverageCapturePixels());
    const value = {
      appPresentation: { progress: state.progress, readout: state.readout, settled: state.settled, regrow: Object.fromEntries(Object.entries(state.canvases).map(([kind, canvas]) => [kind, canvas.regrow])) },
      view: { host: state.host, hidden: state.hidden, visibility: state.visibility, parked: state.parked, viewport: state.viewport, dpr: state.dpr, counts: state.counts, canvases: Object.fromEntries(Object.entries(state.canvases).map(([kind, canvas]) => [kind, { camera: canvas.camera, canvas: canvas.canvas, mode: canvas.mode }])) },
      stableDataSha256: hash(json(detail.data)), sceneSha256: hash(json(detail.scene)),
      nativeRawSha256: Object.fromEntries(Object.entries(pixels).map(([kind, value]) => [kind, hash(Buffer.from(value.split(',')[1], 'base64'))])),
      coverageStyles: { count: detail.styles.length, sha256: hash(json(detail.styles)), allOwnOpacityZero: detail.styles.every(style => Number(style.opacity) === 0), allEffectiveOpacityZero: detail.styles.every(style => style.effectiveOpacity === 0), sample: detail.styles.slice(0, 8) },
      sameTargets: detail.sameTargets, timingFunctionsUnchanged: detail.timingFunctionsUnchanged,
    };
    receipt.stages[name] = value;
    return value;
  }
  function unchanged(baseline, current, phase) {
    const checks = {
      sameSettledAppCursor: baseline.appPresentation.progress === 1 && JSON.stringify(baseline.appPresentation) === JSON.stringify(current.appPresentation),
      sameCameraAndComposition: JSON.stringify(baseline.view) === JSON.stringify(current.view),
      sameStableLiveData: baseline.stableDataSha256 === current.stableDataSha256,
      exactNativeRawCanvases: JSON.stringify(baseline.nativeRawSha256) === JSON.stringify(current.nativeRawSha256),
      sameCoverageTargets: current.sameTargets, timingFunctionsUnchanged: current.timingFunctionsUnchanged,
    };
    receipt.checks[phase] = checks;
    if (Object.values(checks).some(value => !value)) throw Error(`${label} ${phase}: ${JSON.stringify(checks)}`);
  }
  let style; let baseline;
  try {
    baseline = await stage('beforeStyle');
    const ordinary = manifest.captures[`${side.name}-${framing}`];
    receipt.checks.matchesOrdinaryCapture = consumers.every(kind => baseline.nativeRawSha256[kind] === ordinary.rawCanvases[kind].sha256) && baseline.stableDataSha256 === ordinary.stableDataSha256;
    if (!receipt.checks.matchesOrdinaryCapture) throw Error(`${label}: native pixels or data drifted after the ordinary capture`);
    style = await page.addStyleTag({ content: diagnosticCss });
    manifest.instrument.cssChanges.push({ side: side.name, framing, selector: diagnosticSelector, cssText: diagnosticCss, purpose: receipt.purpose, removedAndRestored: false });
    receipt.injectedStyleText = await style.evaluate(element => element.textContent);
    if (receipt.injectedStyleText !== diagnosticCss) throw Error(`${label}: unexpected injected diagnostic styling`);
    await page.waitForFunction(selector => [...document.querySelectorAll(selector)].every(element => Number(getComputedStyle(element).opacity) === 0), diagnosticSelector);
    const hidden = await stage('styleApplied');
    unchanged(baseline, hidden, 'styleApplied');
    if (!hidden.coverageStyles.allOwnOpacityZero || !hidden.coverageStyles.allEffectiveOpacityZero) throw Error(`${label}: SVG coverage is not effectively transparent`);
    const screenshot = `${label}-full.png`;
    await page.screenshot({ path: path.join(out, screenshot), fullPage: true });
    receipt.fullScreenshot = { file: screenshot, sha256: hash(readFileSync(path.join(out, screenshot))) };
    const afterShot = await stage('afterScreenshot');
    unchanged(baseline, afterShot, 'afterScreenshot');
    if (!afterShot.coverageStyles.allEffectiveOpacityZero) throw Error(`${label}: SVG coverage became visible during capture`);
  } finally {
    try {
      if (style) await style.evaluate(element => element.remove());
      await page.waitForFunction(() => {
        const guard = window.__coverageDiagnosticGuard;
        return guard.targets.every((element, index) => getComputedStyle(element).opacity === guard.opacities[index]);
      });
      const restored = await stage('styleRemoved');
      if (baseline) {
        unchanged(baseline, restored, 'styleRemoved');
        receipt.checks.coverageStyleRestored = baseline.coverageStyles.sha256 === restored.coverageStyles.sha256;
        if (!receipt.checks.coverageStyleRestored) throw Error(`${label}: coverage styling failed restoration`);
      }
      receipt.checks.styleNodeRemoved = !style || await style.evaluate(element => !element.isConnected);
      if (!receipt.checks.styleNodeRemoved) throw Error(`${label}: diagnostic style remains connected`);
      if (style) manifest.instrument.cssChanges.at(-1).removedAndRestored = true;
    } finally {
      await page.evaluate(() => { delete window.__coverageDiagnosticGuard; });
      save(`${label}-receipt.json`, receipt);
    }
  }
}
async function zoom(page, side) {
  const before = await read(page);
  const target = await page.evaluate(([ax, ay]) => {
    const frame = document.querySelector('.world-viewport'); const r = frame.getBoundingClientRect(); const x = r.left + r.width * ax; const y = r.top + r.height * ay; const hit = document.elementFromPoint(x, y);
    if (!hit || !frame.contains(hit)) throw Error('Requested zoom anchor does not hit the real map; choose --zoom-anchor within its visible area');
    const story = hit.closest('[data-story-id]'); const capability = hit.closest('[data-cap-id]');
    return { x, y, tag: hit.tagName, class: hit.getAttribute('class'), semanticHit: { storyId: story?.getAttribute('data-story-id') ?? null, capabilityId: capability?.getAttribute('data-cap-id') ?? null, validation: story || capability ? 'existing semantic hit target' : 'map surface only; no semantic target at this exact point' }, path: [...(function* () { for (let n = hit; n; n = n.parentElement) yield `${n.tagName}.${n.getAttribute('class') ?? ''}`; })()] };
  }, anchor);
  await page.mouse.move(target.x, target.y);
  for (let i = 0; i < zoomSteps; i += 1) { await page.mouse.wheel(0, -100); await page.waitForTimeout(120); }
  await settle(page, `${side.name}-zoom`);
  const after = await read(page);
  if (!(after.canvases['land-mount'].camera.zoom > before.canvases['land-mount'].camera.zoom) || after.host.cameraAttribute === before.host.cameraAttribute) throw Error(`${side.name}: wheel did not change both actual host and mounted cameras`);
  manifest.contexts[side.name].zoomInput = { target, events: zoomSteps, deltaY: -100, beforeHost: before.host, afterHost: after.host };
}
function cameraProjection(camera, label) {
  if (camera?.type !== 'OrthographicCamera') throw Error(`${label}: expected actual OrthographicCamera`);
  const finiteArray = (value, length, field) => {
    if (!Array.isArray(value) || value.length !== length || value.some(number => typeof number !== 'number' || !Number.isFinite(number))) throw Error(`${label}: invalid ${field}`);
  };
  finiteArray(camera.position, 3, 'position'); finiteArray(camera.quaternion, 4, 'quaternion');
  finiteArray(camera.projectionMatrix, 16, 'projectionMatrix'); finiteArray(camera.matrixWorld, 16, 'matrixWorld');
  for (const field of ['zoom', 'near', 'far', 'left', 'right', 'top', 'bottom']) if (typeof camera[field] !== 'number' || !Number.isFinite(camera[field])) throw Error(`${label}: invalid ${field}`);
  if (!(camera.zoom > 0 && camera.far > camera.near && camera.right > camera.left && camera.top > camera.bottom)) throw Error(`${label}: invalid orthographic bounds/zoom`);
  for (const [field, values] of [['projectionMatrix', camera.projectionMatrix], ['matrixWorld', camera.matrixWorld]]) {
    if ([3, 7, 11].some(index => Math.abs(values[index]) > projectionCoefficientTolerance) || Math.abs(values[15] - 1) > projectionCoefficientTolerance) throw Error(`${label}: ${field} is not orthographic/affine`);
  }
  const projection = new Matrix4().fromArray(camera.projectionMatrix);
  const world = new Matrix4().fromArray(camera.matrixWorld);
  for (const [field, matrix] of [['projectionMatrix', projection], ['matrixWorld', world]]) {
    const determinant = matrix.determinant();
    if (!Number.isFinite(determinant) || determinant === 0) throw Error(`${label}: singular/nonfinite ${field}`);
  }
  // Copies only: these are serialized receipts, and no browser camera is touched.
  const viewProjectionMatrix = projection.clone().multiply(world.clone().invert()).toArray();
  finiteArray(viewProjectionMatrix, 16, 'viewProjectionMatrix');
  const rows = Object.fromEntries([['x', 0], ['y', 1], ['w', 3]].map(([name, row]) => [name, [0, 1, 2, 3].map(column => viewProjectionMatrix[column * 4 + row])]));
  if (rows.w.some((value, index) => Math.abs(value - (index === 3 ? 1 : 0)) > projectionCoefficientTolerance)) throw Error(`${label}: nonconstant orthographic W row`);
  return { rawCamera: camera, viewProjectionMatrix, rows };
}
function compareCamera(before, after, label) {
  const a = cameraProjection(before, `${label} before`); const b = cameraProjection(after, `${label} after`);
  const coefficientDeltas = Object.fromEntries(['x', 'y', 'w'].map(row => [row, a.rows[row].map((value, column) => b.rows[row][column] - value)]));
  const maxAbsCoefficientDelta = Math.max(...Object.values(coefficientDeltas).flat().map(Math.abs));
  if (!Number.isFinite(maxAbsCoefficientDelta)) throw Error(`${label}: nonfinite projection delta`);
  return {
    exactCameraEqual: JSON.stringify(before) === JSON.stringify(after),
    equivalentXYW: maxAbsCoefficientDelta <= projectionCoefficientTolerance,
    coefficientTolerance: projectionCoefficientTolerance, maxAbsCoefficientDelta, coefficientDeltas,
    positionDelta: before.position.map((value, index) => after.position[index] - value),
    before: a, after: b,
  };
}
function canvasGeometryAndPaintStyle(canvas) {
  const { pointerEvents, ...css } = canvas.css;
  return { ...canvas, css };
}

function compare(framing) {
  const a = manifest.captures[`before-${framing}`]; const b = manifest.captures[`after-${framing}`];
  const mounted = compareCamera(a.canvases['land-mount'].camera, b.canvases['land-mount'].camera, `${framing} mounted`);
  const standalone = compareCamera(a.canvases['land-view'].camera, b.canvases['land-view'].camera, `${framing} standalone`);
  const checks = {
    sameStableLiveLayout: a.stableDataSha256 === b.stableDataSha256,
    sameHostCameraAndComputedComposition: JSON.stringify(a.host) === JSON.stringify(b.host),
    sameCanvasBuffersRectsAndPaintStyles: consumers.every(kind => JSON.stringify(canvasGeometryAndPaintStyle(a.canvases[kind].canvas)) === JSON.stringify(canvasGeometryAndPaintStyle(b.canvases[kind].canvas))),
    exactIntendedMountedPointerDelivery: a.canvases['land-mount'].canvas.css.pointerEvents === 'auto' && b.canvases['land-mount'].canvas.css.pointerEvents === 'none',
    standalonePointerStyleUnchanged: a.canvases['land-view'].canvas.css.pointerEvents === b.canvases['land-view'].canvas.css.pointerEvents,
    fullAlphaNativePixelsExact: consumers.every(kind => a.rawCanvases[kind].sha256 === b.rawCanvases[kind].sha256),
    sameMountedOrthographicXYWProjection: mounted.equivalentXYW,
    exactActualCamerasForStatusOnlyChange: consumers.every(kind => JSON.stringify(a.canvases[kind].camera) === JSON.stringify(b.canvases[kind].camera)),
  };
  manifest.comparisons[framing] = {
    pointerDelivery: { before: a.canvases['land-mount'].canvas.css.pointerEvents, after: b.canvases['land-mount'].canvas.css.pointerEvents, scope: 'Only the intended registered-canvas pointer eligibility changes; raw computed values remain in receipts. Geometry, paint styles and exact actual cameras remain guarded.' },
    checks, exactAllCameraRecordsEqual: consumers.every(kind => JSON.stringify(a.canvases[kind].camera) === JSON.stringify(b.canvases[kind].camera)),
    mounted: { ...mounted, scope: 'controlled mounted framing; exact camera records and XYW equivalence required' },
    standalone: { ...standalone, scope: 'controlled standalone framing; exact camera records required', controlledAppearancePair: true },
    fullAppScope: 'Both panels retain exact actual cameras; the LEFT mounted view receives host legend presentation and the RIGHT standalone is the unchanged control.',
    exactSceneExportMatch: a.sceneSha256 === b.sceneSha256,
    elementDeltas: Object.fromEntries(Object.entries(a.counts).map(([key, value]) => [key, b.counts[key] - value])),
  };
  if (Object.values(checks).some(value => !value)) throw Error(`${framing} comparison identity/mounted-projection mismatch: ${JSON.stringify(checks)}`);
}

async function statusProbe(page, side, framing) {
  const probe = manifest.statusProbe = { status: 'RUNNING', statusName: 'healthy', framing };
  const targetKeys = () => page.evaluate(() => [...document.querySelectorAll('svg.world-scene [data-story-id]')].map(e => [e.getAttribute('data-story-id'), e.getAttribute('data-cap-id')]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
  const objects = () => page.evaluate(() => window.__coverageCaptureObjects());
  const cameras = receipt => Object.fromEntries(consumers.map(kind => [kind, { camera: receipt.canvases[kind].camera, canvas: receipt.canvases[kind].canvas }]));
  const ground = rows => rows['land-mount'].filter(o => o.materials.some(m => m.type === 'ShaderMaterial')).map(o => ({ geometryId: o.geometryId, matrixWorld: o.matrixWorld, vertices: o.vertices }));
  let toggled = false;
  try {
    const legend = page.locator('details.panel-legend');
    if (await legend.count() !== 1) throw Error('Status probe: expected the actual Legend drawer');
    if (!await legend.evaluate(element => element.open)) await legend.locator('summary').click();
    const chip = page.locator('button.legend-chip').filter({ hasText: /^(story trees|story status)$/ }).first();
    if (await chip.count() !== 1) throw Error('Status probe: no real tree/status legend chip');
    if (await chip.getAttribute('aria-expanded') !== 'true') await chip.click();
    const fade = page.locator('button[title="fade healthy"]');
    if (await fade.count() !== 1) throw Error('Status probe: expected one real fade-healthy button from live corpus');
    const baseline = await capture(page, side, `${framing}-legend-visible`);
    probe.baselineLabel = `after-${framing}-legend-visible`;
    probe.beforeObjects = await objects(); probe.beforeTargets = await targetKeys();
    if (!ground(probe.beforeObjects).length) throw Error('Status probe: no actual ground ShaderMaterial geometry to compare');
    if (!probe.beforeTargets.length) throw Error('Status probe: no retained story targets');
    await fade.click(); toggled = true;
    const shown = page.locator('button[title="show healthy"]');
    await shown.waitFor();
    if (await shown.getAttribute('aria-pressed') !== 'true') throw Error('Status probe: real legend failed to report hidden state');
    const dimmed = await capture(page, side, `${framing}-legend-dimmed`);
    probe.dimmedLabel = `after-${framing}-legend-dimmed`;
    probe.afterObjects = await objects(); probe.afterTargets = await targetKeys();
    const props = probe.afterObjects['land-mount'].filter(o => o.growthAttributes && o.materials.some(m => m.type === 'MeshStandardMaterial'));
    const dimmedMaterials = props.flatMap(o => o.materials).filter(m => m.opacity < 1);
    probe.checks = {
      exactActualCameraAndCanvas: JSON.stringify(cameras(baseline)) === JSON.stringify(cameras(dimmed)),
      sameHostCameraAndComposition: JSON.stringify(baseline.host) === JSON.stringify(dimmed.host),
      sameStableData: baseline.stableDataSha256 === dimmed.stableDataSha256,
      sameRetainedTargetIdentities: JSON.stringify(probe.beforeTargets) === JSON.stringify(probe.afterTargets),
      sameGroundGeometryObjects: JSON.stringify(ground(probe.beforeObjects)) === JSON.stringify(ground(probe.afterObjects)),
      dimmedMaterialDelivered: dimmedMaterials.length > 0 && dimmedMaterials.every(m => Math.abs(m.opacity - 0.12) < 1e-12 && m.transparent === true && m.depthWrite === true),
      nativeMountedPixelsChanged: baseline.rawCanvases['land-mount'].sha256 !== dimmed.rawCanvases['land-mount'].sha256,
      standalonePixelsUnchanged: baseline.rawCanvases['land-view'].sha256 === dimmed.rawCanvases['land-view'].sha256,
    };
    probe.interaction = await page.evaluate(() => {
      const frame = document.querySelector('.world-viewport'); const mount = document.querySelector('[data-testid="land-mount"]');
      const canvas = mount.querySelector('canvas');
      return { tabIndex: frame.getAttribute('tabindex'), label: frame.getAttribute('aria-label'), mountAriaHidden: mount.getAttribute('aria-hidden'), mountPointerEvents: getComputedStyle(mount).pointerEvents, canvasPointerEvents: getComputedStyle(canvas).pointerEvents };
    });
    probe.checks.hostKeepsAccessibleInertComposition = probe.interaction.tabIndex === '0' && Boolean(probe.interaction.label) && probe.interaction.mountAriaHidden === 'true' && probe.interaction.mountPointerEvents === 'none' && probe.interaction.canvasPointerEvents === 'none';
    const failed = Object.entries(probe.checks).filter(([, ok]) => !ok).map(([key]) => key);
    if (failed.length) throw Error(`Status probe checks failed: ${failed.join(', ')}`);
    probe.status = 'CAPTURED';
  } catch (error) { probe.status = 'FAILED'; probe.failure = error.stack; throw error; }
  finally {
    if (toggled) {
      await page.locator('button[title="show healthy"]').click();
      const restored = await capture(page, side, `${framing}-legend-restored`);
      const baseline = manifest.captures[probe.baselineLabel];
      probe.restoredTargets = await targetKeys();
      probe.restoration = { exactCamerasAndCanvas: JSON.stringify(cameras(baseline)) === JSON.stringify(cameras(restored)), rawCanvasesExact: consumers.every(kind => baseline.rawCanvases[kind].sha256 === restored.rawCanvases[kind].sha256), sameRetainedTargetIdentities: JSON.stringify(probe.beforeTargets) === JSON.stringify(probe.restoredTargets), sameStableData: baseline.stableDataSha256 === restored.stableDataSha256 };
      if (!Object.values(probe.restoration).every(Boolean)) { probe.status = 'FAILED'; save('status-probe.json', probe); throw Error('Status probe restoration did not restore exact actual cameras and native pixels'); }
    }
    save('status-probe.json', probe);
  }
}

async function pointerProbe(page, side) {
  const before=await capture(page,side,'pointer-before');
  const probe=await page.evaluate(() => {
    const viewport=document.querySelector('.world-viewport'); const mount=document.querySelector('[data-testid="land-mount"]'); const canvas=mount.querySelector('canvas');
    const r=viewport.getBoundingClientRect();
    const identify=e=>({tag:e.tagName,cls:e.getAttribute('class'),story:e.getAttribute('data-story-id'),cap:e.getAttribute('data-cap-id'),native:mount.contains(e)});
    const samples=[];
    for(let yi=1;yi<10;yi++) for(let xi=1;xi<10;xi++) {
      const x=r.left+r.width*xi/10,y=r.top+r.height*yi/10;
      const stack=document.elementsFromPoint(x,y),top=document.elementFromPoint(x,y);
      samples.push({x,y,top:top?identify(top):null,stack:stack.map(identify),canvasEligible:stack.includes(canvas),nativeOnTop:top?mount.contains(top):false,bareSvg:top?.matches('svg.world-scene')===true});
    }
    const point=samples.find(s=>s.bareSvg); if(!point) throw Error('No actual bare-SVG background point for nondestructive click');
    window.__pointerDiagnosisEvents=[];
    for(const [name,element] of [['viewport',viewport],['canvas',canvas]]) for(const type of ['pointerdown','pointerup','click']) {
      const listener=event=>window.__pointerDiagnosisEvents.push({listener:name,type,target:identify(event.target),path:event.composedPath().filter(x=>x instanceof Element).map(identify)});
      element.addEventListener(type,listener,{capture:true,once:true});
    }
    return {url:location.href,point,samples,interaction:{tabIndex:viewport.getAttribute('tabindex'),label:viewport.getAttribute('aria-label'),mountAriaHidden:mount.getAttribute('aria-hidden'),mountPointerEvents:getComputedStyle(mount).pointerEvents,canvasPointerEvents:getComputedStyle(canvas).pointerEvents}};
  });
  await page.mouse.click(probe.point.x,probe.point.y);
  probe.events=await page.evaluate(()=>window.__pointerDiagnosisEvents);
  probe.afterUrl=page.url();
  const after=await capture(page,side,'pointer-after');
  probe.receipts={sameActualCameras:consumers.every(k=>JSON.stringify(before.canvases[k].camera)===JSON.stringify(after.canvases[k].camera)),sameNativePixels:consumers.every(k=>before.rawCanvases[k].sha256===after.rawCanvases[k].sha256),sameStableData:before.stableDataSha256===after.stableDataSha256,sameUrl:probe.url===probe.afterUrl};
  probe.outcome={samples:probe.samples.length,canvasEligibleSamples:probe.samples.filter(s=>s.canvasEligible).length,nativeTopSamples:probe.samples.filter(s=>s.nativeOnTop).length,actualViewportClicks:probe.events.filter(e=>e.listener==='viewport'&&e.type==='click').length,actualCanvasClicks:probe.events.filter(e=>e.listener==='canvas'&&e.type==='click').length};
  probe.scope='Actual hit eligibility and one real bare-background click after status restoration; no CSS, camera or clock interventions. Earlier baseline diagnosis found eligibility beneath SVG without interception.';
  probe.checks={ noNativeCanvasEligibility:probe.outcome.canvasEligibleSamples===0, noNativeTopTargets:probe.outcome.nativeTopSamples===0, actualHostClickPreserved:probe.outcome.actualViewportClicks===1 && probe.outcome.actualCanvasClicks===0, ...probe.receipts };
  manifest.pointerProbe={outcome:probe.outcome,checks:probe.checks,scope:probe.scope};
  save('pointer-probe.json',probe);
  if(!Object.values(probe.checks).every(Boolean)) throw Error('Pointer delivery checks failed: '+JSON.stringify(probe.checks));
}

function html() {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const figure = (title, file) => `<figure><figcaption>${escape(title)}</figcaption><a href="${escape(file)}"><img src="${escape(file)}" alt="${escape(title)}"></a></figure>`;
  const rows = Object.keys(manifest.comparisons).map(framing => {
    const comparison = manifest.comparisons[framing];
    const ordinary = ['full', ...consumers].map(kind => {
      const title = kind === 'full' ? 'Full app — both actual cameras preserved' : kind === 'land-mount' ? 'Raw mounted 3D canvas — matched XY projection' : 'Standalone 3D canvas — actual camera preserved';
      const explanation = kind === 'full' ? 'Both panels preserve their actual camera records and canvas geometry. The left mounted view receives host legend status presentation; the right standalone panel is the unchanged control.' : kind === 'land-mount' ? 'Actual camera records match exactly, and orthographic X/Y/W view-projection rows match within 1e-10 per coefficient. Complete depth and framing records are retained; pixel equality is a separate measured check.' : 'Both builds include the same repaired mapper. Exact actual standalone camera records are required, and the legend toggle must leave this canvas unchanged.';
      return `<h3>${escape(title)}</h3><p>${escape(explanation)}</p><div class="pair">${sides.map(side => {
        const receipt = manifest.captures[`${side.name}-${framing}`];
        const scope = kind === 'full' ? 'both panels controlled framing' : kind === 'land-view' ? 'standalone exact camera' : 'mounted exact camera and matched XY projection';
        return figure(`${side.name} · ${side.head.slice(0, 12)} · ${framing} · ${scope}`, kind === 'full' ? receipt.fullScreenshot.file : receipt.rawCanvases[kind].file);
      }).join('')}</div>`;
    }).join('');
    const diagnostic = manifest.diagnostic?.framing === framing ? `<h3>AFTER-only harness diagnosis — temporary SVG coverage opacity 0</h3><p>Both pictures below are AFTER. The raw mounted canvas is unchanged byte for byte while only <code>${escape(diagnosticSelector)}</code> is temporarily hidden in the full app. SAME-AFTER exact cameras and native pixel guards remain enforced for both consumers. This is not product styling, retirement or an appearance pass. The diagnostic style was removed and restoration checked.</p><div class="pair">${figure(`AFTER raw mounted canvas · ${framing}`, manifest.captures[`after-${framing}`].rawCanvases['land-mount'].file)}${figure(`AFTER diagnostic full app · SVG coverage temporarily hidden · ${framing}`, manifest.diagnostic.fullScreenshot.file)}</div>` : '';
    return `<section><h2>${escape(framing)}</h2><p>Mounted XYW maximum coefficient delta: <code>${escape(comparison.mounted.maxAbsCoefficientDelta)}</code> (limit <code>1e-10</code>). Mounted exact camera equality: <code>${escape(comparison.mounted.exactCameraEqual)}</code>. Standalone XYW delta: <code>${escape(comparison.standalone.maxAbsCoefficientDelta)}</code>; position delta: <code>${escape(JSON.stringify(comparison.standalone.positionDelta))}</code> ; standalone exact camera equality: <code>${escape(comparison.standalone.exactCameraEqual)}</code>.</p><p>Element deltas: <code>${escape(JSON.stringify(comparison.elementDeltas))}</code></p>${ordinary}${diagnostic}</section>`;
  }).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Native legend status — before / after</title><style>body{margin:24px;background:#171b20;color:#e7e4dc;font:16px system-ui}a{color:#a4cced}.pair{display:grid;grid-template-columns:1fr 1fr;gap:16px}figure{margin:0}img{display:block;width:100%;background:repeating-conic-gradient(#39404a 0% 25%,#292f37 0% 50%) 50%/20px 20px}figcaption{padding:8px 0}section{margin:40px 0}code{overflow-wrap:anywhere}@media(max-width:800px){.pair{grid-template-columns:1fr}}</style><h1>Native legend status — before / after</h1><p>Static reduced-motion capture of the actual mounted map. One fresh after-host API snapshot was replayed unchanged to both builds. Within every full-app image, both actual camera records are preserved exactly; the LEFT mounted view receives legend presentation while the RIGHT standalone panel is the control. Ordinary images retain shipped styling. Raw mounted canvases isolate native 3D props. A separate AFTER-only real legend interaction fades healthy status and restores it after the ordinary captures. The registered native canvas now explicitly opts out of pointer hit testing; its previous eligibility beneath SVG did not intercept the measured baseline click. Actual element stacks and a real background click verify the corrected delivery. No camera or clock was replaced.</p><p><a href="manifest.json">Complete identity, raw cameras, depth bounds, projection rows/deltas and data receipts</a>. Appearance awaits owner review. Earlier mapper comparisons are separate evidence and are not rewritten.</p><h2>Camera and source controls</h2><ul>${cameraSourceCause.map(cause => `<li>${escape(cause)}</li>`).join('')}</ul>${rows}${manifest.statusProbe ? `<h2>Actual legend toggle, AFTER build</h2><p>The host legend fades healthy capability props while keeping the canonical ground and SVG targets. This is browser behavior evidence, not an owner appearance verdict.</p><p><a href="status-probe.json">Material, camera, target and restoration receipts</a></p><div class="pair">${figure('Legend visible: native props at full alpha', manifest.captures[manifest.statusProbe.baselineLabel].rawCanvases['land-mount'].file)}${figure('Legend healthy status faded: actual native canvas', manifest.captures[manifest.statusProbe.dimmedLabel].rawCanvases['land-mount'].file)}</div>` : ''}<h2>Actual host pointer delivery</h2><p><a href="pointer-probe.json">Element hit stacks, real click propagation and unchanged camera/pixel/data receipts</a>. Registered native elements must be absent from hit testing while the host receives the click. This does not prove the separately inventoried native capability selection targets.</p><h2>Limits</h2><ul>${manifest.limits.map(limit => `<li>${escape(limit)}</li>`).join('')}</ul></html>`;
}

try {
  for (const side of sides) { const source = sourceIdentity(side); if (source.status) throw Error(`${side.name}: capture requires a committed-clean source checkout: ${source.status}`); const live = await health(side); manifest.identities[side.name] = { before: { source, health: live } }; }
  browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
  manifest.browser.version = browser.version();
  const warm = await open(sides[1], 'snapshot-warmup', true);
  await warm.page.waitForTimeout(1500); await Promise.all([...acquiring.values()]); assertNoErrors();
  await warm.context.close(); frozen = true;
  const tree = payloads.get('/api/tree');
  if (!tree || !JSON.parse(tree.body.toString()).stories?.length) throw Error('Fresh after-host API snapshot has no stories');
  const snapshot = [...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => [key, { ...value, body: value.body.toString('base64') }]);
  save('api-snapshot.private.json', snapshot);
  manifest.snapshot = { source: sides[1], file: 'api-snapshot.private.json', frozenAt: new Date().toISOString(), sha256: hash(readFileSync(path.join(out, 'api-snapshot.private.json'))), paths: snapshot.map(([key, value]) => ({ key, sha256: value.sha256, acquiredAt: value.acquiredAt })), storyCount: JSON.parse(tree.body.toString()).stories.length };
  for (const side of sides) {
    const opened = await open(side, side.name);
    await capture(opened.page, side, 'rest');
    if (zoomSteps) { await zoom(opened.page, side); await capture(opened.page, side, 'zoom'); }
    if (side.name === 'after') { await statusProbe(opened.page, side, zoomSteps ? 'zoom' : 'rest'); await pointerProbe(opened.page, side); }
    await opened.context.close();
  }
  compare('rest'); if (zoomSteps) compare('zoom');
  for (const side of sides) {
    const source = sourceIdentity(side); const live = await health(side);
    manifest.identities[side.name].after = { source, health: live };
    const original = manifest.identities[side.name].before.source;
    if (source.head !== side.head || source.sourceSha256 !== original.sourceSha256 || source.status !== original.status) throw Error(`${side.name}: checkout/source drift during capture`);
  }
  assertNoErrors(); manifest.status = 'CAPTURED'; manifest.finishedAt = new Date().toISOString();
  writeFileSync(path.join(out, 'comparison.html'), html());
  console.log(`Static evidence ready for review: ${out}/comparison.html`);
} catch (error) {
  manifest.status = 'FAILED'; manifest.failure = error.stack; process.exitCode = 1; console.error(error.stack);
} finally {
  for (const side of sides) {
    try {
      const source = sourceIdentity(side);
      const original = manifest.identities[side.name]?.before?.source;
      manifest.identities[side.name] ??= {};
      manifest.identities[side.name].finalSource = source;
      if (original && (source.head !== side.head || source.sourceSha256 !== original.sourceSha256 || source.status !== original.status)) { manifest.status = 'FAILED'; manifest.errors.push(`${side.name}: checkout/source drift by final receipt`); process.exitCode = 1; }
    } catch (error) { manifest.status = 'FAILED'; manifest.errors.push(`final source receipt: ${error.message}`); process.exitCode = 1; }
  }
  if (browser) await browser.close();
  save('manifest.json', manifest);
}
