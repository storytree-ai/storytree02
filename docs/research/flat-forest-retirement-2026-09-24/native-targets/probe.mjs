#!/usr/bin/env node
// Native plant targets — actual-camera probe (laneO, 2026-09-24).
//
// Asks three questions of ONE running studio (never starts or stops it; the caller holds the heavy
// lock and owns the server):
//   1. REGISTRATION OF ELEVATED POINTS. Does the host SVG's own screen transform, applied to the
//      envelope projection (x, z*sin(e) - y*cos(e)), put an ELEVATED 3D point where the ACTUAL
//      registered three.js camera puts it? Sampled over the real plant targets' own crowns and roots.
//   2. REAL PLANT PIXELS. For the tallest native targets: a ray from the actual camera through a
//      pixel near the target's crown — does it strike geometry STANDING above the ground (not the
//      ground itself), and does the host hit-test at that pixel return that capability's target?
//   3. THE HOST ROUTE. A real mouse click at one crown pixel selects that capability through the
//      host (URL + the selected capability card).
// Question 2 and 3 run with the FLAT plant picture made pointer-inert (a diagnostic stylesheet
// scoped to the flat picture's own classes), because the flat look still paints above the targets
// until the one-step retirement removes it. The baseline (no diagnostic) hit-test result is also
// recorded, unmodified. No product code, clock or camera is changed; the only camera input is the
// host's own wheel.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
for (const key of ['url', 'dir', 'head', 'pid', 'out']) if (!args.get(key)) throw Error(`required --${key}`);
const dir = realpathSync(args.get('dir'));
const head = args.get('head');
const pid = Number(args.get('pid'));
const origin = new URL(args.get('url')).origin;
const out = path.resolve(args.get('out'));
if (existsSync(out)) throw Error(`output exists: ${out}`);
mkdirSync(out, { recursive: true });
if (execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== head) throw Error('HEAD mismatch');
const save = (name, value) => writeFileSync(path.join(out, name), `${JSON.stringify(value, null, 2)}\n`);

const healthBody = await (await fetch(`${origin}/api/health`, { cache: 'no-store' })).json();
if (healthBody.pid !== pid || realpathSync(healthBody.code?.directory ?? '/') !== dir || healthBody.code?.head !== head || healthBody.code?.stale !== false || healthBody.store !== 'pg' || healthBody.db !== 'ok') {
  throw Error(`wrong or unhealthy server: ${JSON.stringify(healthBody)}`);
}

const require = createRequire(path.join(dir, 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const viewport = { width: 1800, height: 1100 };
const browser = await chromium.launch({ headless: true, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
const errors = [];
const receipt = { startedAt: new Date().toISOString(), server: { origin, dir, head, pid, health: healthBody }, viewport, errors };
try {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const fiber = new Set();
  context.on('request', (r) => { if (/\/@react-three_fiber\.js(?:\?|$)/.test(r.url())) fiber.add(r.url()); });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`page: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  await page.goto(`${origin}/?landMount=1&landMountProps=1#/tree`, { waitUntil: 'load', timeout: 180_000 });
  await page.bringToFront();
  await page.waitForSelector('[data-testid="land-mount"] canvas', { timeout: 180_000 });
  await page.waitForFunction(() => window.__storytreeMotionSettled?.().settled === true, null, { timeout: 180_000 });
  await page.waitForFunction(() => document.querySelectorAll('svg.world-scene g.native-prop-targets > rect').length > 0, null, { timeout: 180_000 });
  // Zoom with the host's own wheel so plants are large enough to aim at.
  await page.mouse.move(viewport.width * 0.55, viewport.height * 0.5);
  for (let i = 0; i < Number(args.get('zoom-steps') ?? 9); i += 1) { await page.mouse.wheel(0, -100); await page.waitForTimeout(150); }
  await page.waitForTimeout(2500);
  if (fiber.size !== 1) throw Error(`expected one R3F module, saw ${JSON.stringify([...fiber])}`);

  const measure = async (label) => page.evaluate(async ({ moduleUrl, label }) => {
    const mod = await import(moduleUrl);
    const canvas = document.querySelector('[data-testid="land-mount"] canvas');
    const root = mod._roots.get(canvas);
    const state = root.store.getState();
    state.gl.render(state.scene, state.camera);
    const cam = state.camera;
    const V3 = cam.position.constructor;
    const V2 = state.pointer.constructor;
    const cRect = canvas.getBoundingClientRect();
    const toScreen = (x, y, z) => { const v = new V3(x, y, z).project(cam); return { x: cRect.left + (v.x + 1) / 2 * cRect.width, y: cRect.top + (1 - v.y) / 2 * cRect.height }; };
    const world = document.querySelector('svg.world-scene g.world-camera');
    const ctm = world.getScreenCTM();
    const svgToScreen = (x, y) => ({ x: ctm.a * x + ctm.c * y + ctm.e, y: ctm.b * x + ctm.d * y + ctm.f });
    const worldGroup = world.querySelector(':scope > g');
    const off = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(worldGroup.getAttribute('transform'));
    const origin = { x: Number(off[1]), y: Number(off[2]) };
    const elev = 50 * Math.PI / 180;
    const ground = Math.sin(elev); const upright = Math.cos(elev);
    const rects = [...document.querySelectorAll('svg.world-scene g.native-prop-targets > rect')];
    const inView = rects.map((r) => ({ r, b: r.getBoundingClientRect() }))
      .filter(({ b }) => b.left > 0 && b.right < innerWidth && b.top > 0 && b.bottom < innerHeight);

    // Q1 — elevated points through both transforms, sampled on a grid across the visible frame.
    const registration = [];
    for (let i = 0; i < 25; i += 1) {
      const sx = cRect.left + cRect.width * (0.1 + 0.8 * ((i % 5) / 4));
      const sy = cRect.top + cRect.height * (0.1 + 0.8 * (Math.floor(i / 5) / 4));
      // Invert the host camera for the ground point under (sx, sy), then raise it.
      const inv = ctm.inverse();
      const dx = inv.a * sx + inv.c * sy + inv.e; const dy = inv.b * sx + inv.d * sy + inv.f;
      for (const height of [0, 5, 12, 25]) {
        const z = dy / ground; // a ground point at relief 0
        const three = toScreen(dx, height, z);
        const svg = svgToScreen(dx, z * ground - height * upright);
        registration.push({ height, dx: three.x - svg.x, dy: three.y - svg.y });
      }
    }
    const maxErr = registration.reduce((m, p) => Math.max(m, Math.abs(p.dx), Math.abs(p.dy)), 0);

    // Q2 — aim near the crown of the tallest visible targets and ray-cast with the actual camera.
    const tallest = [...inView].sort((a, b) => b.b.height - a.b.height).slice(0, 40);
    const meshes = [];
    state.scene.traverse((o) => { if (o.isMesh && o.visible) meshes.push(o); });
    const samples = tallest.map(({ r, b }) => {
      const px = b.left + b.width / 2; const py = b.top + b.height * 0.2;
      state.raycaster.setFromCamera(new V2(((px - cRect.left) / cRect.width) * 2 - 1, -(((py - cRect.top) / cRect.height) * 2 - 1)), cam);
      const hits = state.raycaster.intersectObjects(meshes, false);
      const first = hits[0] ?? null;
      let groundY = null;
      if (first) {
        state.raycaster.set(new V3(first.point.x, 10_000, first.point.z), new V3(0, -1, 0));
        const down = state.raycaster.intersectObjects(meshes, false);
        groundY = down.length ? down[down.length - 1].point.y : null;
      }
      const hitEl = document.elementFromPoint(px, py);
      const target = hitEl?.closest('[data-cap-id]');
      return {
        cap: r.getAttribute('data-cap-id'), story: r.getAttribute('data-story-id'),
        pixel: { x: Math.round(px), y: Math.round(py) }, rectScreenHeight: Math.round(b.height),
        standing: first !== null && groundY !== null ? first.point.y - groundY : null,
        hostHit: { tag: hitEl?.tagName ?? null, cls: hitEl?.getAttribute('class') ?? null, cap: target?.getAttribute('data-cap-id') ?? null, story: target?.getAttribute('data-story-id') ?? null },
      };
    });
    return {
      label, origin, targetCount: rects.length, inViewCount: inView.length,
      camera: { type: cam.type, zoom: cam.zoom, position: cam.position.toArray() },
      hostCTM: [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f],
      registration: { samples: registration.length, maxAbsErrorPx: maxErr },
      samples,
    };
  }, { moduleUrl: [...fiber][0], label });

  const baseline = await measure('baseline-flat-picture-present');
  await page.screenshot({ path: path.join(out, 'zoom-baseline.png') });
  // Diagnostic: make the FLAT plant picture pointer-inert (it is what the retirement removes),
  // and outline the native targets so the picture shows where they are.
  await page.addStyleTag({ content: `
    .world-scene .parcel-flora, .world-scene .story-tree, .world-scene .veg-track, .world-scene .flora,
    .world-scene .conifer, .world-scene .parcel, .world-scene .relaxed-tile, .world-scene .hex-coastland,
    .world-scene .ground-mesh, .world-scene .hit { pointer-events: none !important; }
    .world-scene .native-prop-target { stroke: #ff2da0; stroke-width: 0.35; }` });
  await page.waitForTimeout(400);
  const diagnostic = await measure('diagnostic-flat-picture-pointer-inert');
  await page.screenshot({ path: path.join(out, 'zoom-targets-outlined.png') });
  const agree = diagnostic.samples.filter((s) => s.standing !== null && s.standing > 1 && s.hostHit.cap === s.cap);
  // Q3 — one real click at a crown pixel that both the ray and the hit-test agree on.
  const pick = agree[0] ?? null;
  let click = null;
  if (pick) {
    await page.mouse.click(pick.pixel.x, pick.pixel.y);
    await page.waitForTimeout(1200);
    click = await page.evaluate(() => ({ hash: location.hash, selectedCard: document.querySelector('.tree-card.is-selected > title')?.textContent ?? null, selectedCardId: document.querySelector('.tree-card.is-selected')?.getAttribute('data-cap-id') ?? null }));
    click.expected = { story: pick.story, cap: pick.cap, pixel: pick.pixel };
    await page.screenshot({ path: path.join(out, 'after-crown-click.png') });
  }
  Object.assign(receipt, {
    baseline, diagnostic, click,
    summary: {
      registrationMaxAbsErrorPx: diagnostic.registration.maxAbsErrorPx,
      crownSamples: diagnostic.samples.length,
      crownSamplesStriking3dGeometryAboveGround: diagnostic.samples.filter((s) => s.standing !== null && s.standing > 1).length,
      crownSamplesHostHitSameCapability: diagnostic.samples.filter((s) => s.hostHit.cap === s.cap).length,
      bothAgree: agree.length,
      baselineHostHitSameCapability: baseline.samples.filter((s) => s.hostHit.cap === s.cap).length,
    },
  });
} finally {
  receipt.finishedAt = new Date().toISOString();
  save('receipt.json', receipt);
  await browser.close();
}
console.log(JSON.stringify(receipt.summary ?? { errors }, null, 2));
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
