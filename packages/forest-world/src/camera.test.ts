// The land's DECLARED CAMERA (ADR-0367 D1) — red-green on the one fact this increment brings
// into existence.
//
// BEFORE this suite the land had no camera at all. `hexCenter` mapped axial coordinates to pixels
// with no y-scale, no elevation and no projection matrix, and every stage downstream — the relaxed
// substrate mesh, the coast, the scene builders — worked in that same untransformed space. The
// hero-tree sprite, meanwhile, is authored at an explicitly declared camera: `ELEV_DEG = 20.0` in
// `docs/research/chapter2-code-only-art-2026-08-01/blender-hero-v1/blender_tree.py`, projecting
// world to screen as `sy = p[1]*sin(EL) + (p[2]-TZ)*cos(EL)`. So ground depth foreshortens by
// sin(elevation) and upright height by cos(elevation) — and the land applied NEITHER.
//
// ADR-0367 D1: the land gets a declared camera, it is the SAME one the hero tree declares, it is
// expressed ONCE as a named constant carrying an angle in degrees, and both the land's coordinate
// mapping and the object sprites read that one value. These tests fence that: the land side here,
// the land/sprite composition in `@storytree/app-surface`'s `land-camera-composition.test.ts`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  uprightForeshortening,
  projectGround,
  groundPolarOffset,
  unprojectGround,
  groundRadiusToScreenHalfHeight,
  spriteUprightScale,
} from './camera.js';
import {
  HEX_R,
  HEX_W,
  TILE_DEPTH,
  TILE_DEPTH_WORLD,
  AXIAL_DIRS,
  hexCenter,
  hexCorners,
  pixelToHex,
  type Axial,
  type Pt,
} from './hex.js';

const RAD = Math.PI / 180;

/**
 * The declared value, plus a sweep either side of it — the range every invariant below holds
 * over. 26.565 is the classic 2:1 dimetric angle and 30 the classic isometric one; they are here
 * because "across the range of the constant" has to mean the angles the land could plausibly be
 * re-declared at, not a numerical neighbourhood of 20.
 */
const SWEEP = [12, 15, 20, 26.565, 30, 45, 60] as const;

/** Ray-cast point-in-polygon; polygons here are convex, but the cast needs no convexity. */
function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const straddles = a.y > p.y !== b.y > p.y;
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------- the constant itself ----------

test('the land declares ONE camera elevation, in degrees, above the ground plane', () => {
  assert.ok(
    Number.isFinite(LAND_CAMERA_ELEVATION_DEG),
    'the land camera must be a finite angle in degrees',
  );
  assert.ok(
    LAND_CAMERA_ELEVATION_DEG > 0 && LAND_CAMERA_ELEVATION_DEG < PLAN_VIEW_ELEVATION_DEG,
    `a land camera at ${LAND_CAMERA_ELEVATION_DEG} deg is not an angled view: 0 is edge-on and ` +
      `${PLAN_VIEW_ELEVATION_DEG} is the plan view the land used to be drawn in`,
  );
});

test("the land's projection is DERIVED from the declared elevation, never a second literal", () => {
  // If either of these ever stops being sin/cos of the ONE constant, the land has grown a second
  // camera — which is exactly the state ADR-0367 D1 was written to end.
  assert.equal(groundFlattening(), Math.sin(LAND_CAMERA_ELEVATION_DEG * RAD));
  assert.equal(uprightForeshortening(), Math.cos(LAND_CAMERA_ELEVATION_DEG * RAD));
  for (const deg of SWEEP) {
    assert.equal(groundFlattening(deg), Math.sin(deg * RAD), `groundFlattening(${deg})`);
    assert.equal(uprightForeshortening(deg), Math.cos(deg * RAD), `uprightForeshortening(${deg})`);
  }
});

test('the plan view is the elevation the land used to be drawn at, and it is the identity', () => {
  assert.equal(groundFlattening(PLAN_VIEW_ELEVATION_DEG), 1);
  assert.deepEqual(projectGround({ x: 3, y: 7 }, PLAN_VIEW_ELEVATION_DEG), { x: 3, y: 7 });
});

// ---------- the land's coordinate mapping reads it ----------

test('hexCenter reads the declared camera: ground depth foreshortens, screen x does not', () => {
  // The lattice pitch is a GROUND-plane quantity, so the r axis carries the flattening and the q
  // axis does not. Pinned against the constant, not against 0.342, so re-declaring the camera
  // moves the assertion with the code.
  assert.equal(hexCenter({ q: 0, r: 1 }).y, 1.5 * HEX_R * groundFlattening());
  assert.equal(hexCenter({ q: 1, r: 0 }).x, HEX_W);
  assert.equal(hexCenter({ q: 1, r: 0 }).y, 0);

  // ...and at the plan-view limit it is byte-for-byte the pre-camera mapping.
  assert.equal(hexCenter({ q: 0, r: 1 }, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }).y, 1.5 * HEX_R);
  assert.equal(hexCenter({ q: 2, r: 3 }, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }).y, 1.5 * HEX_R * 3);
});

test('a lower camera flattens the land strictly more: hexCenter.y is monotone in the elevation', () => {
  const h: Axial = { q: 0, r: 4 };
  for (let i = 1; i < SWEEP.length; i++) {
    const lo = SWEEP[i - 1]!;
    const hi = SWEEP[i]!;
    assert.ok(
      hexCenter(h, { elevationDeg: lo }).y < hexCenter(h, { elevationDeg: hi }).y,
      `expected the land to flatten as the camera drops: y(${lo}) < y(${hi})`,
    );
  }
});

test('pixelToHex inverts hexCenter at the same camera, across the sweep', () => {
  // The land's forward and inverse mappings must read the SAME value: an inverse still dividing by
  // a plan-view pitch would mis-key every hit target on the map.
  for (const deg of [...SWEEP, PLAN_VIEW_ELEVATION_DEG]) {
    for (let q = -4; q <= 4; q++) {
      for (let r = -4; r <= 4; r++) {
        const h: Axial = { q, r };
        assert.deepEqual(
          pixelToHex(hexCenter(h, { elevationDeg: deg }), { elevationDeg: deg }),
          h,
          `round-trip failed at ${q},${r} under a ${deg} deg camera`,
        );
      }
    }
  }
});

test('projectGround / unprojectGround are inverses at the same camera', () => {
  for (const deg of SWEEP) {
    const p = { x: -17.5, y: 42.25 };
    const back = unprojectGround(projectGround(p, deg), deg);
    assert.ok(Math.abs(back.x - p.x) < 1e-9 && Math.abs(back.y - p.y) < 1e-9);
  }
});

// ---------- the cells project as ground polygons, and the lattice still closes ----------

test('hexCorners project onto the camera ground ellipse, not a circle', () => {
  for (const deg of SWEEP) {
    const f = groundFlattening(deg);
    for (const c of hexCorners(10, 20, HEX_R, deg)) {
      const nx = (c.x - 10) / HEX_R;
      const ny = (c.y - 20) / (HEX_R * f);
      assert.ok(
        Math.abs(Math.hypot(nx, ny) - 1) < 1e-9,
        `corner (${c.x}, ${c.y}) is off the ${deg} deg ground ellipse`,
      );
    }
  }
  // At the plan view the ellipse is the circle the pre-camera code drew.
  for (const c of hexCorners(10, 20, HEX_R, PLAN_VIEW_ELEVATION_DEG)) {
    assert.ok(Math.abs(Math.hypot(c.x - 10, c.y - 20) - HEX_R) < 1e-9);
  }
});

test('the projected lattice still CLOSES: neighbouring cells share their edge corners exactly', () => {
  // This is what separates a ground PROJECTION from an arbitrary vertical squash: the same affine
  // map applied to the pitch and to the corner offsets keeps every shared edge shared, so the
  // relaxed substrate mesh and the territory boundary still weld. Tear this and the island grows
  // seams no test downstream would name.
  for (const deg of SWEEP) {
    for (let q = -2; q <= 2; q++) {
      for (let r = -2; r <= 2; r++) {
        const h: Axial = { q, r };
        const hc = hexCenter(h, { elevationDeg: deg });
        const mine = hexCorners(hc.x, hc.y, HEX_R, deg);
        AXIAL_DIRS.forEach((d, e) => {
          const n: Axial = { q: q + d.q, r: r + d.r };
          const nc = hexCenter(n, { elevationDeg: deg });
          const theirs = hexCorners(nc.x, nc.y, HEX_R, deg);
          // My edge e runs corner e -> e+1; the neighbour across it draws the same two points as
          // its own corners e+3 and e+4 (the opposite edge), reversed.
          const a = mine[e]!;
          const b = mine[(e + 1) % 6]!;
          const a2 = theirs[(e + 4) % 6]!;
          const b2 = theirs[(e + 3) % 6]!;
          assert.ok(
            Math.hypot(a.x - a2.x, a.y - a2.y) < 1e-9,
            `${deg} deg: cell ${q},${r} edge ${e} corner A does not meet its neighbour`,
          );
          assert.ok(
            Math.hypot(b.x - b2.x, b.y - b2.y) < 1e-9,
            `${deg} deg: cell ${q},${r} edge ${e} corner B does not meet its neighbour`,
          );
        });
      }
    }
  }
});

test("a cell's projected vertical half-extent is its ground radius through the camera", () => {
  // The number the nameplate baseline and the scene bounds must use. They added a bare HEX_R,
  // which is the ground-plane radius and only equals the on-screen half-height in plan view.
  for (const deg of SWEEP) {
    assert.equal(groundRadiusToScreenHalfHeight(HEX_R, deg), HEX_R * groundFlattening(deg));
    const hc = hexCenter({ q: 0, r: 0 }, { elevationDeg: deg });
    const ys = hexCorners(hc.x, hc.y, HEX_R, deg).map((p) => p.y);
    assert.ok(
      Math.abs(Math.max(...ys) - groundRadiusToScreenHalfHeight(HEX_R, deg)) < 1e-9,
      `${deg} deg: the projected cell's lowest corner is not its projected half-extent`,
    );
  }
});

// ---------- the tile extrusion is UPRIGHT, so it foreshortens by cos ----------

test('TILE_DEPTH is the tile extrusion projected through the declared camera', () => {
  // An extrusion below a claimed tile is a world HEIGHT, not a ground distance, so it carries
  // cos(elevation) where the lattice carries sin(elevation). Keeping the world depth named
  // separately is what lets the two paint sites keep reading one already-projected number.
  assert.equal(TILE_DEPTH, TILE_DEPTH_WORLD * uprightForeshortening());
  // Straight down, an upright extrusion is edge-on and contributes no screen offset. Stated as a
  // bound because cos(pi/2) is 6.1e-17 rather than a hard zero in IEEE doubles.
  assert.ok(Math.abs(TILE_DEPTH_WORLD * uprightForeshortening(PLAN_VIEW_ELEVATION_DEG)) < 1e-12);
});

// ---------- the composition property, in land terms ----------

test('a ground contact anchored to a cell lands ON that cell, across the sweep', () => {
  // Proof assertion 2, land half: the anchor and the cell polygon must be computed at the SAME
  // declared camera. The sprite half (the rendered contact row) is fenced in app-surface.
  for (const deg of SWEEP) {
    for (let q = -3; q <= 3; q++) {
      for (let r = -3; r <= 3; r++) {
        const h: Axial = { q, r };
        const contact = hexCenter(h, { elevationDeg: deg });
        const hc = hexCenter(h, { elevationDeg: deg });
        const cell = hexCorners(hc.x, hc.y, HEX_R, deg);
        assert.ok(
          pointInPolygon(contact, cell),
          `${deg} deg: contact for cell ${q},${r} fell off its own cell`,
        );
      }
    }
  }
});

test('the contact assertion has TEETH: an anchor at a different camera falls off the cell', () => {
  // Without this control the test above would pass vacuously for any mapping whatsoever. A cell
  // drawn at the declared camera with its anchor still placed by the pre-camera (plan-view)
  // mapping is exactly today's mismatch, and it must be caught.
  const h: Axial = { q: 0, r: 3 };
  const hc = hexCenter(h, { elevationDeg: LAND_CAMERA_ELEVATION_DEG });
  const cell = hexCorners(hc.x, hc.y, HEX_R, LAND_CAMERA_ELEVATION_DEG);
  const planViewAnchor = hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
  assert.ok(
    !pointInPolygon(planViewAnchor, cell),
    'a plan-view anchor on an angled cell should NOT be judged planted',
  );
});

// ---------- the sprite reconciliation, derived from the same value ----------

test('a sprite authored at the land camera needs NO vertical reconciliation', () => {
  // This is what retires the lab squash dial as the reconciliation MECHANISM: once the ground is
  // drawn at the camera the sprite was rendered at, the correction is exactly 1.
  assert.equal(spriteUprightScale(LAND_CAMERA_ELEVATION_DEG), 1);
});

test('a sprite authored at a DIFFERENT camera reports a correction, and it moves with the land', () => {
  // The correction is a warning that the sprite needs re-rendering, not a fix — it can only
  // reconcile upright height, never the sprite's own ground footprint. It must still be a
  // function of the land constant, so re-declaring the land camera moves it.
  const seen = new Set<number>();
  for (const deg of SWEEP) {
    const s = spriteUprightScale(LAND_CAMERA_ELEVATION_DEG, deg);
    assert.equal(s, uprightForeshortening(deg) / uprightForeshortening(LAND_CAMERA_ELEVATION_DEG));
    seen.add(s);
  }
  assert.equal(seen.size, SWEEP.length, 'the correction must move as the land camera moves');
  assert.ok(spriteUprightScale(LAND_CAMERA_ELEVATION_DEG, 30) !== 1);
});

// ---------------------------------------------------------------------------------------------
// groundPolarOffset — the polar spelling of `projectGround`, and the SECOND definition's grave.
//
// It lived twice: privately in `scene.ts`, and as a deliberate local copy in the studio's
// `TreeView.tsx` whose own comment named the reason — reaching into this package owed an engine
// sync and a web pin bump for two lines of arithmetic. ADR-0537 ruled the toll may not draw that
// boundary; the copy is gone and these assertions come with it, from
// `apps/studio/src/components/buildWorld.groundSpace.test.ts`, so the one surviving definition is
// the one under test.
// ---------------------------------------------------------------------------------------------

test('groundPolarOffset leaves the across-screen axis alone and foreshortens depth by sin θ', () => {
  const sin = groundFlattening(LAND_CAMERA_ELEVATION_DEG); // 0.3420201…

  // Literal values, not a round trip through the function's own inverse.
  assert.deepEqual(groundPolarOffset(0, 100), { x: 100, y: 0 });

  const south = groundPolarOffset(Math.PI / 2, 100);
  assert.ok(Math.abs(south.x) < 1e-9);
  assert.ok(Math.abs(south.y - 76.6044443) < 1e-6, `south.y=${south.y}`); // 100 · sin 50°, NOT 100 · 0.66

  const west = groundPolarOffset(Math.PI, 100);
  assert.ok(Math.abs(west.x + 100) < 1e-9);
  assert.ok(Math.abs(west.y) < 1e-9);

  const north = groundPolarOffset(-Math.PI / 2, 100);
  assert.ok(Math.abs(north.y + 76.6044443) < 1e-6); // the sign survives

  const se = groundPolarOffset(Math.PI / 4, 100);
  assert.ok(Math.abs(se.x - 70.7106781) < 1e-6);
  assert.ok(Math.abs(se.y - 70.7106781 * sin) < 1e-6);
});

test('CONTROL: the retired 0.66 squash disagrees by the measured 0.86x on the depth axis', () => {
  // The hand-picked top-down squash the studio layout used before the land had a camera. At 20°
  // this ratio was 1.9297 (the retired squash OVER-reached the true projection); at the ADR-0593
  // 50° camera sin θ has grown past 0.66, so the same fixed squash now UNDER-reaches instead — the
  // control's whole point is that the two numbers disagree, and they still do, on the other side.
  const retiredY = Math.sin(Math.PI / 2) * 100 * 0.66;
  const fixed = groundPolarOffset(Math.PI / 2, 100);
  assert.ok(Math.abs(retiredY - 66) < 1e-9);
  assert.ok(Math.abs(retiredY / fixed.y - 0.8616) < 1e-4, `ratio=${retiredY / fixed.y}`); // 0.66 / sin 50°
});

test('a ground circle projects to a screen ellipse of the camera own aspect', () => {
  const sin = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  const rs = [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
    const o = groundPolarOffset((k / 8) * Math.PI * 2, 60);
    return Math.hypot(o.x, o.y);
  });
  assert.ok(Math.abs(Math.max(...rs) - 60) < 1e-6); // across the screen: untouched
  assert.ok(Math.abs(Math.min(...rs) - 60 * sin) < 1e-6); // into the depth: sin θ
});

test('groundPolarOffset moves with the camera it is asked for, and is exactly polar in plan view', () => {
  // The elevation is a PARAMETER, not a baked constant: in plan view the projection is the
  // identity, so the offset is the bare polar vector — which is what makes the default the only
  // place the land camera enters.
  const plan = groundPolarOffset(Math.PI / 3, 42, PLAN_VIEW_ELEVATION_DEG);
  assert.ok(Math.abs(plan.x - Math.cos(Math.PI / 3) * 42) < 1e-9);
  assert.ok(Math.abs(plan.y - Math.sin(Math.PI / 3) * 42) < 1e-9);

  // And it agrees with `projectGround` by construction, at every elevation, not just the default.
  for (const deg of [5, 20, 45, 70, 90]) {
    const o = groundPolarOffset(1.234, 77, deg);
    const p = projectGround({ x: Math.cos(1.234) * 77, y: Math.sin(1.234) * 77 }, deg);
    assert.deepEqual(o, p);
  }
});

test('groundPolarOffset is LINEAR in r, which is what lets a layout state one spot in two spaces', () => {
  // The studio garden walks a plant inward in SCREEN space and re-derives its ground twin by
  // scaling the ground reach — sound only because projecting is linear in the radius.
  for (const ang of [0, 0.7, 2.1, -1.3]) {
    const unit = groundPolarOffset(ang, 1);
    const scaled = groundPolarOffset(ang, 13.5);
    assert.ok(Math.abs(scaled.x - unit.x * 13.5) < 1e-9);
    assert.ok(Math.abs(scaled.y - unit.y * 13.5) < 1e-9);
  }
});
