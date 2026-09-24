#!/usr/bin/env node
// Per-frame registration probe for panning the studio's default map (laneY, 2026-09-25).
//
// The owner: "theres flicker as you pan around the map, feels like the screen is shaking". This
// drives the same gestures he would — real mouse DRAGS, wheel notches, arrow keys — on the
// production studio bundle against one frozen live-corpus API snapshot, in a HEADED, GPU-backed
// Chromium, and records what every PAINTED frame showed:
//
//   * the SVG layer's camera — `<g class="world-camera">`'s transform plus `.world-pan-layer`'s
//     compositor translate;
//   * the camera the LAND was last DRAWN with — read from outside the app, by wrapping the WebGL2
//     context's own calls: the `projectionMatrix` / `modelViewMatrix` uniforms current at each
//     draw of the ground mesh (the largest indexed draw of the first rendered frame, whose model
//     matrix is static), so no product code carries a probe;
//   * whether the canvas was cleared/resized without being redrawn (a blank frame).
//
// A frame is sampled in a task posted from `requestAnimationFrame`, i.e. after that frame's
// callbacks and rendering update — the state the compositor presented.
//
// Each layer's screen mapping at frame n is compared against its OWN mapping at the settled first
// frame (both are similarities — scale + translation). Registered layers move identically, so the
// mismatch is the largest distance, over the viewport's corners and centre, between where the land
// put a point and where the SVG layer put it. Arms differ ONLY in the static bundle served.
//
//   (under the heavy lock, with the display awake — a DPMS-off monitor throttles headed Chromium
//   to 1 fps: `xset -dpms; xset dpms force on; node pan-probe.mjs …; xset +dpms`)
//   node pan-probe.mjs --run --heavy-lock-held --api http://127.0.0.1:8791 --out /tmp/<fresh> \
//     --arm before=/tmp/before-dist --arm after=/abs/apps/studio/dist
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const value = (f, d) => { const i = argv.indexOf(f); return i < 0 ? d : argv[i + 1]; };
if (!has('--run') || !has('--heavy-lock-held')) throw Error('Refusing browser launch without --run --heavy-lock-held');
const api = new URL(value('--api')).origin;
const arms = argv.flatMap((a, i) => (a === '--arm' ? [argv[i + 1]] : [])).map((s) => {
  const [name, dir] = s.split('=');
  return { name, dir: path.resolve(dir) };
});
const out = path.resolve(value('--out'));
if (!out.startsWith('/tmp/') || existsSync(out)) throw Error('--out must be a fresh /tmp directory');
mkdirSync(out, { recursive: true });
const viewport = { width: 1600, height: 1000 };
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '../../../apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const hash = (b) => createHash('sha256').update(b).digest('hex');
const report = { startedAt: new Date().toISOString(), viewport, api, arms, errors: [], results: {} };
const save = () => writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

// ── the in-page instrument ───────────────────────────────────────────────────────────────────────
const INSTRUMENT = () => {
  const P = WebGL2RenderingContext.prototype;
  const names = new WeakMap();
  const progState = new WeakMap();
  let current = null;
  const st = { draws: 0, clears: 0, refKey: null, byKey: new Map(), firstFrameMax: null, canvasSizes: 0 };
  window.__panProbe = st;
  const gul = P.getUniformLocation;
  P.getUniformLocation = function (prog, name) {
    const loc = gul.call(this, prog, name);
    if (loc) names.set(loc, name);
    return loc;
  };
  const up = P.useProgram;
  P.useProgram = function (prog) { current = prog; if (prog && !progState.has(prog)) progState.set(prog, {}); return up.call(this, prog); };
  const um = P.uniformMatrix4fv;
  P.uniformMatrix4fv = function (loc, tr, data, ...rest) {
    const n = loc && names.get(loc);
    if ((n === 'projectionMatrix' || n === 'modelViewMatrix') && current) progState.get(current)[n] = Float64Array.from(data.subarray ? data.subarray(0, 16) : data.slice(0, 16));
    return um.call(this, loc, tr, data, ...rest);
  };
  const cl = P.clear;
  P.clear = function (...a) { st.clears += 1; return cl.apply(this, a); };
  const noteDraw = (count, instances) => {
    st.draws += 1;
    const s = current && progState.get(current);
    if (!s || !s.projectionMatrix || !s.modelViewMatrix) return;
    const key = `${count}x${instances}`;
    st.byKey.set(key, { p: s.projectionMatrix, mv: s.modelViewMatrix, draw: st.draws });
    if (!st.refKey && (!st.firstFrameMax || count * instances > st.firstFrameMax.n)) st.firstFrameMax = { key, n: count * instances };
  };
  for (const m of ['drawElements', 'drawArrays']) {
    const f = P[m];
    P[m] = function (...a) { noteDraw(m === 'drawElements' ? a[1] : a[2], 1); return f.apply(this, a); };
  }
  for (const m of ['drawElementsInstanced', 'drawArraysInstanced']) {
    const f = P[m];
    P[m] = function (...a) { noteDraw(m === 'drawElementsInstanced' ? a[1] : a[2], a[a.length - 1]); return f.apply(this, a); };
  }
  // ── the frame sampler ──
  const samples = [];
  window.__panSamples = samples;
  window.__panRecording = false;
  const ch = new MessageChannel();
  let lastTs = 0; let lastDraws = 0; let lastClears = 0; let lastCanvas = '';
  const mul = (a, b) => { const r = new Float64Array(16); for (let c = 0; c < 4; c++) for (let rI = 0; rI < 4; rI++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + rI] * b[c * 4 + k]; r[c * 4 + rI] = s; } return r; };
  const proj = (m, x, y, z) => { const X = m[0] * x + m[4] * y + m[8] * z + m[12]; const Y = m[1] * x + m[5] * y + m[9] * z + m[13]; const W = m[3] * x + m[7] * y + m[11] * z + m[15]; return [X / W, Y / W]; };
  ch.port1.onmessage = () => {
    if (!window.__panRecording) return;
    const g = document.querySelector('.world-camera');
    const layer = document.querySelector('.world-pan-layer');
    const canvas = document.querySelector('[data-testid="land-mount"] canvas');
    const mount = document.querySelector('[data-testid="land-mount"]');
    const tr = g?.getAttribute('transform') ?? '';
    const m = /translate\(([-\d.e]+)[ ,]+([-\d.e]+)\)\s*scale\(([-\d.e]+)\)/.exec(tr);
    const lt = layer?.style.transform ?? '';
    const lm = /translate3d\(([-\d.e]+)px,\s*([-\d.e]+)px/.exec(lt);
    const pan = lm ? [Number(lm[1]), Number(lm[2])] : [0, 0];
    const ref = st.refKey && st.byKey.get(st.refKey);
    let land = null;
    if (ref && canvas) {
      const pm = mul(ref.p, ref.mv);
      const w = canvas.clientWidth; const h = canvas.clientHeight;
      const toCss = ([nx, ny]) => [(nx + 1) / 2 * w + pan[0], (1 - ny) / 2 * h + pan[1]];
      land = { a: toCss(proj(pm, 0, 0, 0)), b: toCss(proj(pm, 100, 0, 100)) };
    }
    const cs = canvas ? `${canvas.width}x${canvas.height}` : 'none';
    samples.push({
      t: performance.now(), rafTs: lastTs,
      svg: m ? { tx: Number(m[1]) + pan[0], ty: Number(m[2]) + pan[1], s: Number(m[3]) } : null,
      pan, land,
      draws: st.draws - lastDraws, clears: st.clears - lastClears,
      canvasChanged: cs !== lastCanvas, canvas: cs,
      mountState: mount?.getAttribute('data-state') ?? null, mountCanvas: mount?.getAttribute('data-canvas') ?? null,
      svgVisible: g ? getComputedStyle(g).visibility : null,
      willChange: layer?.style.willChange ?? '',
    });
    lastDraws = st.draws; lastClears = st.clears; lastCanvas = cs;
  };
  const tick = (ts) => { lastTs = ts; ch.port2.postMessage(0); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};

// ── frozen API snapshot + static bundle per arm ─────────────────────────────────────────────────
const payloads = new Map(); let frozen = false;
const MIME = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2', '.wasm': 'application/wasm', '.bin': 'application/octet-stream' };
async function open(browser, arm, acquire, video) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: 'block', ...(video ? { recordVideo: { dir: out, size: viewport } } : {}) });
  await context.addInitScript(INSTRUMENT);
  await context.route('**/*', async (route) => {
    const req = route.request(); const url = new URL(req.url());
    try {
      if (url.pathname.startsWith('/api/')) {
        const key = `${url.pathname}${url.search}`;
        if (req.method() !== 'GET') throw Error(`refused ${req.method()} ${key}`);
        if (!payloads.has(key)) {
          if (!acquire && frozen) (report.lateRequests ??= []).push(`${arm.name}:${key}`);
          const res = await fetch(`${api}${key}`, { cache: 'no-store' });
          const headers = Object.fromEntries(res.headers); for (const h of ['content-length', 'content-encoding', 'transfer-encoding']) delete headers[h];
          payloads.set(key, { status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
        }
        const p = payloads.get(key);
        return route.fulfill({ status: p.status, headers: p.headers, body: p.body });
      }
      let file = path.join(arm.dir, decodeURIComponent(url.pathname));
      if (!file.startsWith(arm.dir) || !existsSync(file) || statSync(file).isDirectory()) file = path.join(arm.dir, 'index.html');
      return route.fulfill({ status: 200, contentType: MIME[path.extname(file)] ?? 'application/octet-stream', body: readFileSync(file) });
    } catch (e) { report.errors.push(`${arm.name}: ${e.message}`); return route.abort(); }
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => report.errors.push(`${arm.name} page: ${e.message}`));
  await page.goto(`http://studio.local/#/tree`, { waitUntil: 'load', timeout: 180_000 });
  await page.bringToFront();
  await page.waitForFunction(() => document.querySelector('[data-testid="land-mount"]')?.getAttribute('data-canvas') === 'ready', null, { timeout: 240_000 });
  // The opening growth plays first; wait for it and the canvas's demand loop to go quiet.
  await page.waitForFunction(() => window.__storytreeMotionSettled?.().settled === true, null, { timeout: 240_000 });
  await page.waitForTimeout(1500);
  await page.evaluate(() => { const st = window.__panProbe; st.refKey = st.firstFrameMax?.key ?? null; });
  return { context, page };
}

// ── the gestures ─────────────────────────────────────────────────────────────────────────────────
async function drag(page, from, to, steps) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(from[0] + (to[0] - from[0]) * i / steps, from[1] + (to[1] - from[1]) * i / steps);
    await page.waitForTimeout(16);
  }
  await page.mouse.up();
}
async function scenario(page) {
  const box = await page.locator('.world-viewport').boundingBox();
  const cx = box.x + box.width / 2; const cy = box.y + box.height / 2;
  const phases = [];
  const mark = async (name) => phases.push({ name, t: await page.evaluate(() => performance.now()) });
  await mark('drag');
  for (const [dx, dy] of [[-300, -120], [260, 180], [-200, 90], [240, -150], [-180, -60], [120, 200]]) {
    await drag(page, [cx, cy], [cx + dx, cy + dy], 30);
    await page.waitForTimeout(350);
  }
  await mark('wheel');
  await page.mouse.move(cx + 120, cy - 40);
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, -100); await page.waitForTimeout(90); }
  for (let i = 0; i < 6; i++) { await page.mouse.wheel(0, 100); await page.waitForTimeout(90); }
  await page.waitForTimeout(350);
  await mark('keys');
  await page.locator('.world-viewport').focus();
  for (const k of ['ArrowLeft', 'ArrowLeft', 'ArrowUp', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowRight', 'ArrowDown']) {
    await page.keyboard.press(k); await page.waitForTimeout(120);
  }
  await page.waitForTimeout(350);
  await mark('end');
  return phases;
}

// ── analysis ─────────────────────────────────────────────────────────────────────────────────────
function analyse(samples, phases) {
  const valid = samples.filter((s) => s.svg && s.land);
  if (!valid.length) return { error: 'no samples carried both layers' };
  const base = valid[0];
  const pts = [[0, 0], [viewport.width, 0], [0, viewport.height], [viewport.width, viewport.height], [viewport.width / 2, viewport.height / 2]];
  const sim = (a0, b0, a1, b1) => { const k = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]) / Math.hypot(b0[0] - a0[0], b0[1] - a0[1]); return { k, tx: a1[0] - k * a0[0], ty: a1[1] - k * a0[1] }; };
  const frames = valid.map((s, i) => {
    const L = sim(base.land.a, base.land.b, s.land.a, s.land.b);
    const k = s.svg.s / base.svg.s; const S = { k, tx: s.svg.tx - k * base.svg.tx, ty: s.svg.ty - k * base.svg.ty };
    let err = 0;
    for (const [x, y] of pts) err = Math.max(err, Math.hypot((L.k * x + L.tx) - (S.k * x + S.tx), (L.k * y + L.ty) - (S.k * y + S.ty)));
    const phase = [...phases].reverse().find((p) => p.t <= s.t)?.name ?? 'pre';
    return { i, t: +(s.t - base.t).toFixed(1), phase, mismatchPx: +err.toFixed(2), dt: i ? +(s.rafTs - valid[i - 1].rafTs).toFixed(1) : 0, draws: s.draws, clears: s.clears, blank: s.clears > 0 && s.draws === 0, canvasChanged: i > 0 && s.canvasChanged, mountState: s.mountState, willChange: s.willChange };
  });
  const byPhase = {};
  for (const f of frames) {
    const b = (byPhase[f.phase] ??= { frames: 0, mismatched: 0, maxMismatchPx: 0, blank: 0, canvasChanged: 0, longFrames: 0 });
    b.frames++; if (f.mismatchPx > 0.5) b.mismatched++; b.maxMismatchPx = Math.max(b.maxMismatchPx, f.mismatchPx);
    if (f.blank) b.blank++; if (f.canvasChanged) b.canvasChanged++; if (f.dt > 50) b.longFrames++;
  }
  const total = frames.reduce((a, f) => ({ frames: a.frames + 1, mismatched: a.mismatched + (f.mismatchPx > 0.5 ? 1 : 0), maxMismatchPx: Math.max(a.maxMismatchPx, f.mismatchPx), blank: a.blank + (f.blank ? 1 : 0), longFrames: a.longFrames + (f.dt > 50 ? 1 : 0) }), { frames: 0, mismatched: 0, maxMismatchPx: 0, blank: 0, longFrames: 0 });
  return { total, byPhase, samplesWithoutBothLayers: samples.length - valid.length, frames };
}

let browser;
try {
  const health = await (await fetch(`${api}/api/health`, { cache: 'no-store' })).json();
  if (health.store !== 'pg' || health.db !== 'ok') throw Error(`api not healthy: ${JSON.stringify(health)}`);
  browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--disable-features=CalculateNativeWinOcclusion', `--window-size=${viewport.width},${viewport.height + 120}`] });
  report.browser = browser.version();
  { const warm = await open(browser, arms.at(-1), true, false); await warm.context.close(); frozen = true; }
  report.snapshot = { frozenAt: new Date().toISOString(), sha256: hash(JSON.stringify([...payloads].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, hash(v.body)]))), stories: JSON.parse(payloads.get('/api/tree').body.toString()).stories.length };
  for (const arm of arms) {
    const { context, page } = await open(browser, arm, false, true);
    report.results[arm.name] = { gl: await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; }) };
    await page.evaluate(() => { window.__panRecording = true; });
    await page.waitForTimeout(300);
    const phases = await scenario(page);
    await page.evaluate(() => { window.__panRecording = false; });
    const samples = await page.evaluate(() => window.__panSamples);
    Object.assign(report.results[arm.name], { refKey: await page.evaluate(() => window.__panProbe.refKey), phases, ...analyse(samples, phases) });
    const video = page.video();
    await context.close();
    if (video) { const p = await video.path(); renameSync(p, path.join(out, `${arm.name}.webm`)); report.results[arm.name].video = `${arm.name}.webm`; }
    save();
  }
  if (report.errors.length) throw Error(report.errors.join('\n'));
  report.status = 'CAPTURED';
} catch (e) { report.status = 'FAILED'; report.failure = e.stack; process.exitCode = 1; console.error(e.stack); }
finally {
  if (browser) await browser.close();
  report.finishedAt = new Date().toISOString();
  const brief = Object.fromEntries(Object.entries(report.results).map(([k, v]) => [k, { total: v.total, byPhase: v.byPhase, refKey: v.refKey, gl: v.gl }]));
  console.log(JSON.stringify({ status: report.status, snapshot: report.snapshot, brief }, null, 2));
  save();
}
