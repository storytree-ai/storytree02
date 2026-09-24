#!/usr/bin/env node
// Ground-share measurement over one capture.mjs run: what fraction of the islands' ground each arm's
// coverage marks cover, at each framing.
//
//   node measure.mjs <capture-out-dir> <3d-arm> [<3d-arm> ...]
//
// ISLAND GROUND is the flat arm's raw mounted canvas wherever it is painted (alpha > 0) — the flat
// arm draws no 3D coverage plants, so this is the land, its pines, cover and paths, and nothing of
// the thing being measured.
// FLAT MARKS are the pixels, inside that ground, that change when the SVG coverage marks are hidden
// in the flat arm's full-app screenshot (the raw canvas mapped to screen by its bounding rect).
// 3D PLANTS are the pixels, inside that ground, where a 3D arm's raw canvas differs from the flat
// arm's raw canvas: the plants AND their baked ground shadows, since both are what the plant adds.
// A pixel "differs" when its summed |ΔRGB| exceeds THRESHOLD. The status split is by the flat arm's
// own ground pixel: YELLOW-ish (R ≥ 0.9·G and R > B + 40) against the rest — a colour proxy for the
// in-progress band, stated as a proxy, not a status read.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const [dir, ...armNames] = process.argv.slice(2);
const require = createRequire(path.resolve('packages/art-authoring/package.json'));
const { PNG } = require('pngjs');
const THRESHOLD = 24;
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const png = (file) => PNG.sync.read(readFileSync(path.join(dir, file)));
const delta = (a, i, b, j) => Math.abs(a[i] - b[j]) + Math.abs(a[i + 1] - b[j + 1]) + Math.abs(a[i + 2] - b[j + 2]);
const differs = (a, i, b, j) => delta(a, i, b, j) > THRESHOLD;
// INK: the mean summed |ΔRGB| per ground pixel — how much the marks change the ground's look, so a
// few dark plants and many pale tufts are compared by contrast as well as by area.
const ink = {};

const result = { threshold: THRESHOLD, framings: {} };
for (const label of ['rest', 'zoom']) {
  const flat = manifest.captures[`flat-${label}`];
  if (!flat) continue;
  const raw = png(flat.rawFile); const full = png(flat.fullFile); const hidden = png(flat.hiddenFile);
  const { x: ox, y: oy } = flat.canvasRect;
  const arms = armNames.map((name) => ({ name, raw: png(manifest.captures[`${name}-${label}`].rawFile) }));
  const counts = { ground: { all: 0, yellow: 0, green: 0 }, flat: { all: 0, yellow: 0, green: 0 } };
  for (const a of arms) counts[a.name] = { all: 0, yellow: 0, green: 0 };
  for (let y = 0; y < raw.height; y += 1) {
    for (let x = 0; x < raw.width; x += 1) {
      const i = (y * raw.width + x) * 4;
      if (raw.data[i + 3] === 0) continue;
      const [r, g, b] = [raw.data[i], raw.data[i + 1], raw.data[i + 2]];
      const band = r >= 0.9 * g && r > b + 40 ? 'yellow' : 'green';
      counts.ground.all += 1; counts.ground[band] += 1;
      const sx = Math.round(x + ox); const sy = Math.round(y + oy);
      if (sx >= 0 && sy >= 0 && sx < full.width && sy < full.height) {
        const j = (sy * full.width + sx) * 4;
        if (differs(full.data, j, hidden.data, j)) { counts.flat.all += 1; counts.flat[band] += 1; }
        ink.flat = (ink.flat ?? 0) + delta(full.data, j, hidden.data, j);
      }
      for (const a of arms) {
        ink[a.name] = (ink[a.name] ?? 0) + delta(a.raw.data, i, raw.data, i);
        if (differs(a.raw.data, i, raw.data, i)) { counts[a.name].all += 1; counts[a.name][band] += 1; }
      }
    }
  }
  const share = Object.fromEntries(Object.entries(counts).filter(([k]) => k !== 'ground').map(([k, c]) => [k, Object.fromEntries(Object.entries(c).map(([band, n]) => [band, +(n / Math.max(1, counts.ground[band])).toFixed(4)]))]));
  const inkPerGroundPixel = Object.fromEntries(Object.entries(ink).map(([k, v]) => [k, +(v / counts.ground.all).toFixed(2)]));
  for (const k of Object.keys(ink)) delete ink[k];
  const { ground, ...covered } = counts;
  result.framings[label] = { groundPixels: ground, coveredPixels: covered, shareOfGround: share, inkPerGroundPixel };
}
console.log(JSON.stringify(result, null, 2));
