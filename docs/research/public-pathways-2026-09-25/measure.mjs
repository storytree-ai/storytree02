// Which public roads does the 3D land actually DRAW? (lane AA, 2026-09-25)
//
// The owner, looking at the live site: "seems to have hidden pathways that dont show up unless you
// click on them". This counts it rather than eyeballing it. Every road segment the published
// drawing carries is still serialised into the page's SVG (as `path.tw-trail-fill`, kept for TELL's
// lens and ROAM's hit strokes, invisible). The 3D land is registered to that SVG's camera, so a
// road the land draws sits under its SVG path. For each segment we sample points along the SVG path
// in SCREEN space, hide every SVG mark, screenshot the land alone, and ask whether the pixels under
// the path are road-coloured (the ribbon's #b0a48e) rather than water/paper or island ground.
//
//   node measure.mjs --url <base> --out <dir> [--tag <name>] --heavy-lock-held
//
// Writes <tag>-<surface>.json (per-segment coverage + per-edge verdict) and a land-only PNG.
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? null : process.argv[i + 1]; };
if (!process.argv.includes('--heavy-lock-held')) throw Error('refusing: run under /tmp/storytree-heavy.lock with --heavy-lock-held');
const base = arg('url').replace(/\/$/, '');
const out = path.resolve(arg('out'));
const tag = arg('tag') ?? 'run';
const repo = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
mkdirSync(out, { recursive: true });
const require = createRequire(path.join(repo, 'apps/studio/package.json'));
const { chromium } = require('@playwright/test');
const { PNG } = require(require.resolve('pngjs', { paths: [path.join(repo, 'node_modules/.pnpm/pngjs@7.0.0/node_modules')] }));

const ROAD = [0xb0, 0xa4, 0x8e];
const near = (p, c, tol) => Math.abs(p[0] - c[0]) <= tol && Math.abs(p[1] - c[1]) <= tol && Math.abs(p[2] - c[2]) <= tol;

async function measure(page, host, surface) {
  // settle: the land drew, and the growth (if any) finished
  await page.waitForFunction((h) => document.querySelector(h)?.dataset.landState === 'drawn', host, { timeout: 120000 });
  await page.waitForFunction((h) => {
    const l = document.querySelector(`${h} .forest-land-layer`);
    return !l || !l.dataset.growth || l.dataset.growth === 'settled';
  }, host, { timeout: 120000 });
  await page.waitForTimeout(2500);
  const samples = await page.evaluate((h) => {
    const svg = document.querySelector(`${h} svg`);
    const out = [];
    for (const p of svg.querySelectorAll('path.tw-trail-fill')) {
      const len = p.getTotalLength();
      const m = p.getScreenCTM();
      const pts = [];
      const n = Math.max(6, Math.min(40, Math.round(len / 3)));
      for (let i = 1; i < n; i++) {
        const q = p.getPointAtLength((len * i) / n);
        pts.push({ x: m.a * q.x + m.c * q.y + m.e, y: m.b * q.x + m.d * q.y + m.f });
      }
      out.push({ id: p.dataset.id, edges: (p.dataset.edges ?? '').split(',').filter(Boolean), usage: Number(p.dataset.usage), pts });
    }
    // hide every SVG mark so the screenshot is the land alone
    svg.style.visibility = 'hidden';
    for (const el of document.querySelectorAll('.forest-legend, .forest-stamp, .storm-skip, .storm-line, header, nav')) el.style.visibility = 'hidden';
    return { segs: out, dpr: window.devicePixelRatio };
  }, host);
  await page.waitForTimeout(500);
  const file = path.join(out, `${tag}-${surface}-land-only.png`);
  await page.screenshot({ path: file });
  const png = PNG.sync.read(readFileSync(file));
  const px = (x, y) => {
    const X = Math.round(x * samples.dpr), Y = Math.round(y * samples.dpr);
    if (X < 0 || Y < 0 || X >= png.width || Y >= png.height) return null;
    const i = (Y * png.width + X) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2]];
  };
  const segs = samples.segs.map((s) => {
    let on = 0, seen = 0;
    for (const q of s.pts) {
      // a 5x5 neighbourhood: the ribbon is a few px wide and registration is sub-pixel, not exact
      let hit = false, inside = false;
      for (let dx = -2; dx <= 2 && !hit; dx++) for (let dy = -2; dy <= 2 && !hit; dy++) {
        const c = px(q.x + dx, q.y + dy);
        if (c) { inside = true; if (near(c, ROAD, 18)) hit = true; }
      }
      if (inside) { seen++; if (hit) on++; }
    }
    return { id: s.id, usage: s.usage, edges: s.edges, samples: seen, drawn: seen ? on / seen : null, pts: s.pts.map((q) => [Math.round(q.x), Math.round(q.y)]) };
  });
  await page.evaluate((h) => { document.querySelector(`${h} svg`).style.visibility = ''; }, host);
  // per EDGE: an edge is broken if any segment on its route is (mostly) undrawn
  const edgeRoute = new Map();
  for (const s of segs) for (const e of s.edges) { if (!edgeRoute.has(e)) edgeRoute.set(e, []); edgeRoute.get(e).push(s); }
  const edges = [...edgeRoute].map(([e, ss]) => {
    const visible = ss.filter((s) => s.drawn !== null);
    const worst = visible.length ? Math.min(...visible.map((s) => s.drawn)) : null;
    return { edge: e, segments: ss.length, onScreen: visible.length, worstSegment: worst, missing: visible.filter((s) => s.drawn < 0.5).map((s) => s.id) };
  });
  const result = {
    surface, segments: segs.length,
    segmentsOnScreen: segs.filter((s) => s.drawn !== null).length,
    segmentsUndrawn: segs.filter((s) => s.drawn !== null && s.drawn < 0.5).map((s) => ({ id: s.id, drawn: +s.drawn.toFixed(2), usage: s.usage, edges: s.edges })),
    edges: edges.length,
    edgesBroken: edges.filter((e) => e.missing.length > 0).map((e) => e.edge),
    segs,
  };
  writeFileSync(path.join(out, `${tag}-${surface}.json`), JSON.stringify(result, null, 2) + '\n');
  return result;
}

const browser = await chromium.launch({ headless: false, env: { ...process.env, DISPLAY: process.env.DISPLAY || ':0' }, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] });
const summary = { base, tag, capturedAt: new Date().toISOString(), browser: browser.version(), surfaces: {} };
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  summary.webgl = await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl2'); const d = c?.getExtension('WEBGL_debug_renderer_info'); return c ? c.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : c.RENDERER) : null; });
  await page.goto(`${base}/forest/`, { waitUntil: 'networkidle' });
  const f = await measure(page, '.forest-map', 'forest');
  summary.surfaces.forest = { segments: f.segments, onScreen: f.segmentsOnScreen, undrawn: f.segmentsUndrawn.length, edges: f.edges, edgesBroken: f.edgesBroken.length };
  await page.screenshot({ path: path.join(out, `${tag}-forest.png`) });

  await page.goto(`${base}/`, { waitUntil: 'networkidle' });
  await page.click('.storm-skip');
  await page.waitForSelector('#storm-land-canvas svg', { state: 'visible', timeout: 30000 });
  const e = await measure(page, '#storm-land-canvas', 'entry');
  summary.surfaces.entry = { segments: e.segments, onScreen: e.segmentsOnScreen, undrawn: e.segmentsUndrawn.length, edges: e.edges, edgesBroken: e.edgesBroken.length };
  await page.screenshot({ path: path.join(out, `${tag}-entry.png`) });
} finally {
  await browser.close();
}
writeFileSync(path.join(out, `${tag}-summary.json`), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
