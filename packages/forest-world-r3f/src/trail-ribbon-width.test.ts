// trail-ribbon-width.test.ts — a road scales with the land: never thicker as you zoom out.

import assert from 'node:assert/strict';
import test from 'node:test';

import { trailFillWidth } from '@storytree/forest-world';

import {
  RIBBON_GROUND_SCALE,
  RIBBON_MIN_SCREEN_PX,
  scaleRibbonWithZoom,
  trailRibbonScreenWidth,
} from './trail-ribbon-width.js';

// The three zooms measured on the live forest, 2026-09-25 (CSS px per ground unit): 8 wheel notches
// in, the studio's opening view, and wheeled out to the zoom-out floor.
const ZOOMED_IN = 4.228;
const OPENING = 1.972;
const ZOOMED_OUT = 0.28;
// An island is drawn in ground units, so its on-screen width is proportional to the zoom.
const ISLAND_GROUND = 60.3;

test('a road keeps the same share of an island at every zoom above the floor', () => {
  // The defect: the old ribbon drew `width` SCREEN px at every zoom, so its share of an island grew
  // 15x from zoomed in to zoomed out. This reds on that rule (`(w) => w`).
  for (const usage of [2, 4, 9]) {
    const w = trailFillWidth(usage);
    const shares = [ZOOMED_IN, OPENING, ZOOMED_OUT]
      .filter((z) => w * RIBBON_GROUND_SCALE * z >= RIBBON_MIN_SCREEN_PX)
      .map((z) => trailRibbonScreenWidth(w, z) / (ISLAND_GROUND * z));
    assert.ok(shares.length >= 2, `usage ${usage}: at least two zooms above the floor`);
    for (const s of shares) assert.ok(Math.abs(s - shares[0]!) < 1e-12, `usage ${usage}: share ${s} vs ${shares[0]}`);
  }
});

test('a road is never thicker on screen, nor a larger share of an island, as you zoom out', () => {
  for (const usage of [1, 2, 4, 9]) {
    const w = trailFillWidth(usage);
    let prevPx = Infinity;
    let prevShare = 0;
    for (let z = 6; z >= 0.05; z *= 0.9) {
      const px = trailRibbonScreenWidth(w, z);
      assert.ok(px <= prevPx + 1e-12, `usage ${usage} at zoom ${z}: ${px}px after ${prevPx}px`);
      prevPx = px;
      // Above the floor the share is flat; at the floor it may only grow because the island
      // shrinks under a road that has stopped shrinking — never because the road grew.
      const share = px / (ISLAND_GROUND * z);
      if (px > RIBBON_MIN_SCREEN_PX) assert.ok(share <= prevShare + 1e-12 || prevShare === 0);
      prevShare = share;
    }
  }
});

test('the opening view keeps the width the owner approved (within 2%)', () => {
  // The approved picture drew `width` screen px; at the opening zoom the rule must draw the same.
  for (const usage of [1, 2, 4, 9]) {
    const w = trailFillWidth(usage);
    const ratio = trailRibbonScreenWidth(w, OPENING) / w;
    assert.ok(Math.abs(ratio - 1) < 0.02, `usage ${usage}: ${ratio}`);
  }
});

test('a road never vanishes: the floor holds, and a zoom that projects nothing keeps it', () => {
  assert.equal(trailRibbonScreenWidth(trailFillWidth(1), 0.01), RIBBON_MIN_SCREEN_PX);
  for (const z of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(trailRibbonScreenWidth(3, z), RIBBON_MIN_SCREEN_PX);
  }
  assert.equal(trailRibbonScreenWidth(0, OPENING), RIBBON_MIN_SCREEN_PX);
  // Zoomed right out, the heaviest measured trunk still reads above the floor.
  assert.ok(trailRibbonScreenWidth(12.44, ZOOMED_OUT) > RIBBON_MIN_SCREEN_PX);
});

test('the installed hook sets the drawn width from the camera of THAT draw, after the line\'s own hook', () => {
  const calls: string[] = [];
  class FakeLine {
    material = { linewidth: 3 };
    onBeforeRender(): void {
      calls.push('own');
    }
  }
  const line = new FakeLine();
  const w = trailFillWidth(4);
  const undo = scaleRibbonWithZoom(line, w);
  const draw = (camera: unknown): number => {
    (line.onBeforeRender as (r: unknown, s: unknown, c: unknown) => void)(null, null, camera);
    return line.material.linewidth;
  };
  const ortho = (zoom: number) => ({ isOrthographicCamera: true, zoom });
  // The old ribbon drew `w` px whatever the zoom; this one follows the zoom of each draw.
  const opening = draw(ortho(OPENING));
  const zoomedOut = draw(ortho(ZOOMED_OUT));
  const zoomedIn = draw(ortho(ZOOMED_IN));
  assert.equal(zoomedIn, trailRibbonScreenWidth(w, ZOOMED_IN));
  assert.ok(zoomedOut < opening && opening < zoomedIn, `${zoomedOut} < ${opening} < ${zoomedIn}`);
  assert.deepEqual(calls, ['own', 'own', 'own']);
  // A perspective camera has no zoom in this sense: the width is left as it was.
  line.material.linewidth = 7;
  assert.equal(draw({ isPerspectiveCamera: true, zoom: 1 }), 7);
  undo();
  assert.equal(Object.prototype.hasOwnProperty.call(line, 'onBeforeRender'), false);
  assert.equal(draw(ortho(ZOOMED_OUT)), 7);
});
