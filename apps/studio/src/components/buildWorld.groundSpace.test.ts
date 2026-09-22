// The studio map's island layout takes its two geometry decisions ON THE GROUND, not on the screen
// (`studio-island-layout-moves-to-ground-space`, the last increment of `ground-space-truth-arc`;
// ADR-0367 D1's declared camera is what exposed the class).
//
// THE TWO DECISIONS. `buildWorld` chooses the tile the story's own tree stands on, and it seats each
// capability's garden plant on a ring around that tree. Both used to be taken in PROJECTED
// coordinates, where a ground separation running away from the viewer covers only `sin 20° ≈ 0.342`
// of the screen it covers in plan view — so the hero-tile argmin preferred tiles displaced along the
// depth axis, and a "ring" of screen radius `r` squashed by a hand-picked `0.66` was a 1.93x ELLIPSE
// on the land. Each cap spot is its capability's parcel seed (`capToParcel`), so the second one was
// skewing the Voronoi partition that decides which ground each capability owns — and under ADR-0226
// a plant's presence and health report that capability's proof state, so the partition is what every
// plant's claim rests on.
//
// WHY THESE ARE VALUE ASSERTIONS AND NOT A CAMERA SWEEP. The obvious proof — build the world at two
// elevations and assert the layout agrees — is a SELF-COMPARISON: it proves equivariance and nothing
// about the value, and is blind to anything wrong the same way at every elevation (measured on this
// arc's own `substrate-camera.test.ts`, where a diff-scoped mutation run found 17 of 33 mutants
// surviving exactly such a suite). It is also not even expressible end-to-end here: `buildWorld`
// packs its islands so they do not overlap ON SCREEN and snaps that packing to the lattice through
// `pixelToHex`, so the TILE SET is legitimately a function of the camera. So each decision is pinned
// against a value instead, every fixture carries the RETIRED formula replayed on it as a control,
// and the layout the fixture produces carries one deliberate digest.

import { describe, it, expect } from 'vitest';
import {
  hexCenter,
  unprojectGround,
  groundFlattening,
  axialKey,
  pixelToHex,
  HEX_R,
  TILE_SCALE,
  crownRadiusWorld,
  tileUnits,
  PLAN_VIEW_ELEVATION_DEG,
  LAND_CAMERA_ELEVATION_DEG,
  hash,
  rand01,
  type Axial,
  type Pt,
} from '@storytree/forest-world';
import { buildWorld, groundHeroTile, worldToScene } from './TreeView.js';
import type { TreeCapability, TreeStory } from '../types';

// ---------------------------------------------------------------------------------------------
// The RETIRED formulae, replayed as controls. If either of these ever stops disagreeing with the
// shipped answer on the fixture below, the FIXTURE has stopped describing the defect — fix the
// fixture, never the assertion.
// ---------------------------------------------------------------------------------------------

/** The screen-space argmin `groundHeroTile` replaced: nearest-to-centroid on PROJECTED centres. */
function retiredScreenHeroTile(tiles: readonly Axial[]): Axial | undefined {
  const centers = tiles.map((h) => hexCenter(h));
  const centroid: Pt = {
    x: centers.reduce((s, p) => s + p.x, 0) / Math.max(centers.length, 1),
    y: centers.reduce((s, p) => s + p.y, 0) / Math.max(centers.length, 1),
  };
  return [...tiles].sort((a, b) => {
    const ca = hexCenter(a);
    const cb = hexCenter(b);
    return (
      Math.hypot(ca.x - centroid.x, ca.y - centroid.y) -
      Math.hypot(cb.x - centroid.x, cb.y - centroid.y)
    );
  })[0];
}

/** The hand-picked `0.66` top-down squash `groundPolarOffset` replaced. */
function retiredSquashOffset(ang: number, r: number): Pt {
  return { x: Math.cos(ang) * r, y: Math.sin(ang) * r * 0.66 };
}

// ---------------------------------------------------------------------------------------------
// THE HERO TILE
// ---------------------------------------------------------------------------------------------

/**
 * A four-tile hook, chosen because BOTH argmins are strict on it (no tie decides the answer) and
 * they pick different tiles. Verified by hand on the pre-ADR-0528 tile (`HEX_R = 27`,
 * `HEX_W = 46.765…`) — the table is in those units, and the assertions below are written in
 * multiples of `HEX_R` / `HEX_W` so they hold on the DERIVED tile (ADR-0528: `HEX_R ≈ 11.06`),
 * since every coordinate here is homogeneous in the radius:
 *
 *   tile      ground centre         ground gap    screen centre          screen gap
 *   (0,0)     (  0.00,   0.00)         264.29     (  0.00,   0.00)          254.41
 *   (5,0)     (233.83,   0.00)         111.53     (233.83,   0.00)       →   85.52   ← screen picks
 *   (5,4)     (327.36, 162.00)      →  101.25     (327.36, 124.10)            95.88
 *   (5,7)     (397.51, 283.50)         233.53     (397.51, 217.17)           205.66
 *      ↑ ground picks
 *
 * (5,4) is genuinely the middle of the hook. (5,0) only LOOKS nearest, because the camera flattens
 * the depth axis the hook runs along — which is the whole defect, in four tiles.
 *
 * ⚠ RE-CHOSEN under ADR-0593 D1 (20° → 50°, 2026-09-22). The original hook — `(0,0),(1,0),(1,1),
 * (1,2)` — discriminated at the old 20° camera (`1/sin 20° ≈ 2.92`) but STOPPED at the shipped 50°
 * one: the depth axis is squashed only `1/sin 50° ≈ 1.31×` now, too mild for a one-tile `q` offset
 * to out-weigh a one-tile `r` offset any more, so both argmins converged on `(1,0)` and the CONTROL
 * that proves the two disagree verified nothing. `q` was widened from 1 to 5 tiles (the `r` axis
 * needs a much bigger `q` separation to still lose the argmin race at the weaker squash) and `r`
 * was correspondingly deepened (0/4/7 rather than 0/1/2) so the ground/screen margins stay a
 * comparable size to the retired hook's (~10.3-at-27 either way, against the original ~10.68).
 */
/** The table above is at radius 27; a length in it divides by this to read on the current tile. */
const TABLE_R = 27;
const onTile = (lengthAtR27: number): number => (lengthAtR27 / TABLE_R) * HEX_R;
const HOOK: Axial[] = [
  { q: 0, r: 0 },
  { q: 5, r: 0 },
  { q: 5, r: 4 },
  { q: 5, r: 7 },
];

describe('groundHeroTile — the story tree stands where the GROUND says the middle is', () => {
  it('picks the ground-nearest tile, not the projection-nearest one', () => {
    expect(groundHeroTile(HOOK)).toEqual({ q: 5, r: 4 });
  });

  it('CONTROL: the retired screen argmin picks a DIFFERENT tile on this same fixture', () => {
    // The fixture must still exhibit the defect, or the assertion above verifies nothing.
    expect(retiredScreenHeroTile(HOOK)).toEqual({ q: 5, r: 0 });
    expect(retiredScreenHeroTile(HOOK)).not.toEqual(groundHeroTile(HOOK));
  });

  it('CONTROL: the fixture really is foreshortened — the camera is declared and active', () => {
    // A sweep over an unchanged picture passes with any implementation. Pin that this lattice
    // genuinely projects: the hook's deepest tile loses `1 - sin 50° ≈ 23%` of its ground depth on
    // screen (a MILD loss next to the retired camera's ~66% — see the fixture note above).
    const deep = HOOK[3]!;
    const ground = hexCenter(deep, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
    const screen = hexCenter(deep);
    expect(ground.y).toBeCloseTo(onTile(283.5), 6); // 7 × 1.5 · HEX_R
    expect(screen.y).toBeCloseTo(onTile(283.5) * groundFlattening(LAND_CAMERA_ELEVATION_DEG), 6);
    expect(screen.x).toBeCloseTo(ground.x, 6); // the across-screen axis is untouched
  });

  it('pins the winning ground gap, so a drifted fixture is caught rather than absorbed', () => {
    const centers = HOOK.map((h) => hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }));
    const centroid = {
      x: centers.reduce((s, p) => s + p.x, 0) / centers.length,
      y: centers.reduce((s, p) => s + p.y, 0) / centers.length,
    };
    const gaps = centers.map((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y)).sort((a, b) => a - b);
    expect(gaps[0]).toBeCloseTo(onTile(101.25), 2);
    expect(gaps[1]).toBeCloseTo(onTile(111.53), 2); // a 10.28-at-27 margin — no tie is deciding this
  });

  it('breaks an exact tie toward the earliest tile in input order (the retired sort was stable)', () => {
    // Three mutually adjacent tiles put every centre the same distance from the centroid.
    const equilateral: Axial[] = [
      { q: 0, r: 0 },
      { q: 0, r: 1 },
      { q: 1, r: 0 },
    ];
    expect(groundHeroTile(equilateral)).toEqual({ q: 0, r: 0 });
    expect(groundHeroTile([...equilateral].reverse())).toEqual({ q: 1, r: 0 });
  });

  it('returns undefined for an empty tile set (buildWorld falls back to the island seed)', () => {
    expect(groundHeroTile([])).toBeUndefined();
  });

  it('is a function of the TILE SET alone — translating an island cannot change which tile wins', () => {
    // Not a camera sweep: a pure-translation control. `hexCenter` is affine in (q, r), so shifting
    // every tile shifts the centroid with it; a hero tile that moved under translation would mean
    // the argmin had picked up a dependence on absolute position.
    const shifted = HOOK.map((h) => ({ q: h.q - 3, r: h.r + 2 }));
    expect(groundHeroTile(shifted)).toEqual({ q: 5 - 3, r: 4 + 2 });
  });
});

// ---------------------------------------------------------------------------------------------
// THE CAPABILITY RING
// ---------------------------------------------------------------------------------------------

// `groundPolarOffset`'s own assertions moved to `packages/forest-world/src/camera.test.ts` with the
// function (ADR-0537 D1): the studio held a deliberate LOCAL copy of that arithmetic to avoid an
// engine sync, and the decision killed the copy, so the one surviving definition is the one under
// test. What stays here is what this file is actually about — that the ring the garden lays out is
// a GROUND circle, witnessed through the layout rather than through the offset function.


const cap = (id: string): TreeCapability => ({
  id,
  title: id,
  outcome: '',
  status: 'mapped',
  proofMode: 'red-green',
  dependsOn: [],
  testCount: 3,
});

/**
 * A nineteen-capability island — a nineteen-tile territory since ADR-0528 (one tile per capability;
 * it was eight capabilities on ten tiles before the `+ 2` went), two full hex rings, so the whole
 * ring circle below lies on owned land and no plant is walked inward by the keep-IN loop: every cap
 * spot is the ring's own answer rather than the walk's. `crownRadius(19) = min(32, 18 + 41.8) = 32`
 * in the tree's own frame, i.e. `32 · TREE_SCALE` on the ground, so `ringR = min(32 · TREE_SCALE +
 * tileUnits(18), groundRadius − HEX_R·0.55) = 50 · TILE_SCALE`, and each plant's own radius wobbles
 * ±5 · TILE_SCALE around it — `RING_R` / `RING_WOBBLE` below.
 */
const RING_CAPS = 19;
const RING_R = Math.min(crownRadiusWorld(RING_CAPS) + tileUnits(18), 50 * TILE_SCALE);
const RING_WOBBLE = tileUnits(5);
const RING_FIXTURE: TreeStory = {
  id: 'ring-fixture',
  title: 'ring-fixture',
  outcome: '',
  status: 'mapped',
  proofMode: 'UAT',
  uatWitness: 'machine',
  dependsOn: [],
  consumedBy: [],
  capabilities: Array.from({ length: RING_CAPS }, (_, j) => cap(`ring-fixture-c${j}`)),
};

/** Every capability's offset from the story tree, measured back on the GROUND PLANE. */
function capGroundOffsets(): { r: number; screenR: number }[] {
  const world = buildWorld([RING_FIXTURE], { buildings: false });
  const t = world.territories[0]!;
  return t.caps.map((c) => {
    const dx = c.x - t.treeSpot.x;
    const dy = c.y - t.treeSpot.y;
    const g = unprojectGround({ x: dx, y: dy });
    return { r: Math.hypot(g.x, g.y), screenR: Math.hypot(dx, dy) };
  });
}

describe('the capability ring is a CIRCLE on the ground', () => {
  it('seats every plant at the SAME ground radius, within its own wobble', () => {
    const rs = capGroundOffsets().map((o) => o.r);
    expect(rs).toHaveLength(RING_CAPS);
    // The value, not merely the shape: `ringR` is RING_R here and the per-plant wobble is
    // ±RING_WOBBLE, so a ground radius outside this band means either the squash is back or
    // `ringR` read the wrong radius. Under the retired formula these ran from 45 to 106 (at 27).
    for (const r of rs) {
      expect(r).toBeGreaterThanOrEqual(RING_R - RING_WOBBLE - 1e-6);
      expect(r).toBeLessThanOrEqual(RING_R + RING_WOBBLE + 1e-6);
    }
    expect(Math.max(...rs) - Math.min(...rs)).toBeLessThanOrEqual(2 * RING_WOBBLE + 1e-6);
  });

  it('CONTROL: the retired squash, replayed on this fixture, breaks that band', () => {
    // Same angles and same radii, differing only in how the offset reaches the screen.
    const ARC = (Math.PI * 4) / 3;
    const n = RING_FIXTURE.capabilities.length;
    const ringR = RING_R;
    const retired = RING_FIXTURE.capabilities.map((c, j) => {
      const slot = -Math.PI / 6 + ((j + 0.5) / n) * ARC;
      const angle = slot + (rand01(hash(`${RING_FIXTURE.id}:${c.id}:a`)) - 0.5) * (ARC / n) * 0.5;
      const rr = ringR + (rand01(hash(`${RING_FIXTURE.id}:${c.id}:r`)) - 0.5) * 2 * RING_WOBBLE;
      const g = unprojectGround(retiredSquashOffset(angle, rr));
      return Math.hypot(g.x, g.y);
    });
    // The DIRECTION this band breaks in FLIPPED under ADR-0593 D1 (20° → 50°) — the finding, not a
    // bug in this control. `retiredSquashOffset` bakes in the hand-picked `0.66` and this test
    // un-projects it back out through `unprojectGround`, i.e. divides by `sin θ`: at the original
    // 20° camera `0.66 / sin 20° ≈ 1.93` OVER-reached, pushing radii past the TOP of the band
    // (`max > RING_R + RING_WOBBLE`, the old assertion here); at the shipped 50° camera
    // `0.66 / sin 50° ≈ 0.86` UNDER-reaches instead, pulling radii under the BOTTOM
    // (`min < RING_R - RING_WOBBLE`). Either way the band breaks, so assert it on whichever side —
    // never just the side that happened to be true when this was written.
    const low = RING_R - RING_WOBBLE;
    const high = RING_R + RING_WOBBLE;
    const max = Math.max(...retired);
    const min = Math.min(...retired);
    expect(max > high || min < low).toBe(true);
    expect(max - min).toBeGreaterThan(2 * RING_WOBBLE);
  });

  it('CONTROL: the ring is deliberately NOT a circle on the SCREEN — the camera is doing work', () => {
    // Camera-agnostic, not a magic number recalibrated per elevation: the fixture's own per-plant
    // wobble is the most an ellipse ratio could read WITHOUT any camera at all — a ground circle of
    // radius `RING_R` with each point independently jittered by up to `±RING_WOBBLE` can, by chance,
    // read as an ellipse up to `(RING_R + RING_WOBBLE) / (RING_R - RING_WOBBLE)` on the ground alone.
    // The measured SCREEN ratio must clear that bound, or the ellipse is unexplained without the
    // camera doing work — which is what a flat threshold (this used to read a bare `1.8`, picked for
    // the 2.92× squash at the retired 20° camera) stops proving the moment the elevation moves again,
    // exactly as it did under ADR-0593 D1's move to 50° (2.92× → 1.31×, `1.8` no longer clears it).
    const wobbleOnlyBound = (RING_R + RING_WOBBLE) / (RING_R - RING_WOBBLE);
    const screenRs = capGroundOffsets().map((o) => o.screenR);
    const measured = Math.max(...screenRs) / Math.min(...screenRs);
    expect(measured).toBeGreaterThan(wobbleOnlyBound);
  });

  it('SNAPSHOT: the layout this fixture produces', () => {
    // Deliberate, and next to the properties above rather than instead of them: nobody eyeballs
    // this ring, and moving it moves the per-capability PARCEL PARTITION downstream (each spot is
    // that capability's Voronoi seed). WHEN THIS GOES RED: establish what moved and say so in the
    // landing — the studio's accretion wave and forest-world-r3f's parcel outlines both read from
    // this partition — and only THEN re-record. Never re-record reflexively.
    const world = buildWorld([RING_FIXTURE], { buildings: false });
    const t = world.territories[0]!;
    const digest = [
      `tree ${t.treeSpot.x.toFixed(2)},${t.treeSpot.y.toFixed(2)}`,
      ...t.caps.map((c) => `${c.cap.id.slice(-2)} ${c.x.toFixed(2)},${c.y.toFixed(2)}`),
    ].join(' | ');
    // Re-recorded 2026-09-06 (ADR-0528): the LATTICE moved (HEX_R 27 → ≈ 11.06, derived from the
    // land ratio), the QUOTA moved (one tile per capability, the `+ 2` retired), and this fixture
    // itself grew from eight to nineteen capabilities so its ring still lies on owned land. Every
    // coordinate below is therefore in the new tile's units; nothing about the ring rule changed.
    //
    // Re-recorded 2026-09-22 (ADR-0593 D1, 20° → 50°). ESTABLISHED before re-recording, not assumed:
    // this is NOT a pure depth re-projection (the tree's `x` moved from 0.00 to 9.58, which a camera
    // that only scales `y` cannot do on its own) — the TILE SET itself changed. `buildWorld` seeds
    // an island by snapping a SCREEN-space point to the lattice through `pixelToHex`
    // (`packages/forest-layout/src/pack.ts`, the `seeds` line — a `elevationDeg`-dependent snap, and
    // its default is the module's own `LAND_CAMERA_ELEVATION_DEG`), so the SAME screen seed lands on
    // a DIFFERENT hex once that constant moves, and the whole island grows outward from there —
    // exactly the "the TILE SET is legitimately a function of the camera" this file's own header
    // warns about. `groundHeroTile` itself is untouched (it is camera-independent by construction,
    // reading only `PLAN_VIEW_ELEVATION_DEG`) — it picked a different tile only because it was
    // handed a different tile SET, the same mechanism the `groundHeroTile` CONTROL above shows in
    // miniature on the four-tile hook. Confirms the failure-3 hypothesis rather than an unexplained
    // move, so this is safe to re-record.
    expect(digest).toBe(
      'tree 9.58,-63.56 | c0 27.02,-68.91 | c1 30.77,-66.88 | c2 29.76,-62.67 | c3 30.90,-60.36' +
        ' | c4 27.58,-55.84 | c5 26.24,-53.47 | c6 21.94,-51.69 | c7 19.22,-49.84 | c8 14.43,-49.71' +
        ' | c9 8.49,-47.81 | 10 3.88,-47.92 | 11 0.57,-50.52 | 12 -3.00,-51.04 | 13 -5.03,-53.29' +
        ' | 14 -10.19,-55.67 | 15 -11.44,-59.38 | 16 -9.08,-63.64 | 17 -11.84,-66.24 | 18 -10.95,-69.73',
    );
  });
});

// ---------------------------------------------------------------------------------------------
// THE CONSEQUENCE — a parcel seed that stands on somebody else's ground
// ---------------------------------------------------------------------------------------------

/** A synthetic story set with the shape the real map has, deterministic per `worldSeed`. */
function synthWorld(worldSeed: number, n: number): TreeStory[] {
  const out: TreeStory[] = [];
  for (let i = 0; i < n; i++) {
    const id = `w${worldSeed}-s${i}`;
    const capCount = 1 + (hash(`${id}:caps`) % 8);
    const deps: string[] = [];
    if (i > 0) deps.push(`w${worldSeed}-s${hash(`${id}:d1`) % i}`);
    out.push({
      id,
      title: id,
      outcome: '',
      status: 'mapped',
      proofMode: 'UAT',
      uatWitness: 'machine',
      dependsOn: deps,
      consumedBy: [],
      capabilities: Array.from({ length: capCount }, (_, j) => cap(`${id}-c${j}`)),
    });
  }
  return out;
}

describe('buildWorld actually TAKES the ground answer', () => {
  it('every island\'s tree stands on the ground-nearest tile, and on some islands that differs', () => {
    // The helper's own value pins above prove the ground answer is right; this proves `buildWorld`
    // is the thing asking for it. The second assertion is what keeps the first non-vacuous: if the
    // sweep contained no island where the two answers differ, a `buildWorld` still running the
    // retired argmin would satisfy this test.
    let islands = 0;
    let differsFromRetired = 0;
    for (let w = 0; w < 5; w++) {
      for (const t of buildWorld(synthWorld(w, 40), { buildings: false }).territories) {
        islands++;
        const ground = groundHeroTile(t.tiles);
        expect(ground).toBeDefined();
        const seat = hexCenter(ground!);
        expect(t.treeSpot.x).toBeCloseTo(seat.x, 9);
        expect(t.treeSpot.y).toBeCloseTo(seat.y, 9);
        if (axialKey(retiredScreenHeroTile(t.tiles)!) !== axialKey(ground!)) differsFromRetired++;
      }
    }
    expect(islands).toBe(200);
    // Measured on this branch: 14.00% over 1,600 synthetic islands, 5 of the shipped corpus's 35.
    expect(differsFromRetired).toBeGreaterThan(islands * 0.05);
  });
});

describe('every capability parcel seed stands on its OWN island', () => {
  it('across a 200-island sweep, no cap spot resolves to foreign soil or open water', () => {
    // Not a restatement of the ring's shape: this is the CONSEQUENCE the ellipse had. The retired
    // ring over-reached the island's own projected height by roughly two, so the keep-IN walk ran
    // on 49.01% of plants and still left 3.41% of them off their island — a Voronoi seed outside
    // the land it is meant to partition. Measured on this branch: 15.00% walk, 0.00% escape.
    let caps = 0;
    let escaped = 0;
    let walkedOrWorse = 0;
    for (let w = 0; w < 5; w++) {
      const world = buildWorld(synthWorld(w, 40), { buildings: false });
      const owner = new Map<string, number>();
      world.drawTiles.forEach((d) => owner.set(axialKey(d.h), d.owner));
      world.territories.forEach((t, ti) => {
        for (const c of t.caps) {
          caps++;
          if (owner.get(axialKey(pixelToHex({ x: c.x, y: c.y }))) !== ti) escaped++;
          const g = unprojectGround({ x: c.x - t.treeSpot.x, y: c.y - t.treeSpot.y });
          // A walked plant is pulled inward in 25% steps, so its ground radius drops below the
          // ring band. Counting them keeps the walk's load visible rather than merely bounded.
          if (Math.hypot(g.x, g.y) < t.groundRadius * 0.2) walkedOrWorse++;
        }
      });
    }
    expect(caps).toBeGreaterThan(800);
    expect(escaped).toBe(0);
    // A regression that pushed plants back off the island would show here first, as a walk load
    // climbing back toward the retired formula's 49%.
    expect(walkedOrWorse / caps).toBeLessThan(0.05);
  });
});

// ---------------------------------------------------------------------------------------------
// `HEX_R` is referenced in the fixture's own arithmetic above; keep the import honest.
// ---------------------------------------------------------------------------------------------
describe('fixture arithmetic', () => {
  it('states the constants the ring band above is derived from', () => {
    // ADR-0528: the tile is DERIVED — one hex per capability, sized so a drawn island is its land.
    expect(HEX_R).toBeCloseTo(Math.sqrt(318 / ((3 * Math.sqrt(3)) / 2)), 9);
    expect(TILE_SCALE).toBeCloseTo(HEX_R / 27, 9);
    const world = buildWorld([RING_FIXTURE], { buildings: false });
    const t = world.territories[0]!;
    expect(t.tiles).toHaveLength(RING_CAPS); // one tile per capability
    // the island is roomy enough that the crown rule, not the shore, sets the ring
    expect(t.groundRadius - HEX_R * 0.55).toBeGreaterThan(RING_R);
    expect(RING_R).toBeCloseTo(50 * TILE_SCALE, 6);
  });
});

// ---------------------------------------------------------------------------
// THE ANCHORS LEAVE IN THE GROUND PLANE — ADR-0527 D1, and the map does not move.
//
// The layout now hands `buildScene` the PRE-CAMERA anchors and tags them `anchorSpace: 'ground'`;
// the core projects them once, at the camera it is asked for. That is what makes a plan-view scene
// a real one — before it, a caller asking for plan view got an un-flattened lattice under a tree,
// a plant ring and a nameplate still frozen at the declared camera.
//
// ⚠ THESE ARE VALUE ASSERTIONS AGAINST THE SCREEN ANCHOR THAT SHIPPED, deliberately, and for the
// reason this file's own header gives: a two-camera self-comparison proves equivariance and nothing
// about the value. What has to be true for the map not to move is that projecting the ground anchor
// lands ON the screen anchor the studio has always drawn — so that is what is asserted, against the
// value, not against another build.
describe('the island anchors leave the layout in the ground plane', () => {
  const project = (p: Pt): Pt => ({
    x: p.x,
    y: p.y * groundFlattening(LAND_CAMERA_ELEVATION_DEG),
  });

  it('projects the ground anchors exactly onto the screen ones the map already drew', () => {
    let islands = 0;
    let capSpots = 0;
    // A y of 0 is its own projection at every camera, so an anchor set that happened to sit on the
    // axis would satisfy this test without the projection doing anything. Count the ones that are
    // genuinely off-axis and require them, or the assertion is decoration.
    let offAxis = 0;
    for (let w = 0; w < 5; w++) {
      for (const t of buildWorld(synthWorld(w, 40), { buildings: false }).territories) {
        islands++;
        const c = project(t.groundCentroid);
        expect(c.x).toBeCloseTo(t.centroid.x, 9);
        expect(c.y).toBeCloseTo(t.centroid.y, 9);
        const tree = project(t.groundTreeSpot);
        expect(tree.x).toBeCloseTo(t.treeSpot.x, 9);
        expect(tree.y).toBeCloseTo(t.treeSpot.y, 9);
        if (Math.abs(t.groundTreeSpot.y) > 1) offAxis++;
        for (const spot of t.caps) {
          capSpots++;
          const p = project(spot.groundSpot);
          // The keep-IN walk runs in screen space and its TEST is the screen point, so the ground
          // twin is the original offset shrunk by 0.75 per step taken. If that bookkeeping ever
          // drifts from the walk, this is where it shows — as a plant sitting somewhere else.
          expect(p.x).toBeCloseTo(spot.x, 9);
          expect(p.y).toBeCloseTo(spot.y, 9);
        }
      }
    }
    expect(islands).toBeGreaterThan(50);
    expect(capSpots).toBeGreaterThan(100);
    expect(offAxis).toBeGreaterThan(islands / 4);
  });

  it('the ground anchors are NOT the screen ones — the tag is carrying real work', () => {
    // The companion the assertion above cannot make about itself. If `groundTreeSpot` were simply
    // `treeSpot`, every `toBeCloseTo` above would still pass on any island sitting near y = 0, and
    // the whole change would be a rename. This requires the two to genuinely differ, by the
    // camera's own ratio, on the islands where there is something to foreshorten.
    const world = buildWorld(synthWorld(0, 40), { buildings: false });
    const moved = world.territories.filter(
      (t) => Math.abs(t.groundTreeSpot.y - t.treeSpot.y) > 1,
    );
    expect(moved.length).toBeGreaterThan(world.territories.length / 4);
    for (const t of moved) {
      expect(t.treeSpot.y / t.groundTreeSpot.y).toBeCloseTo(
        groundFlattening(LAND_CAMERA_ELEVATION_DEG),
        6,
      );
    }
  });

  it('states the tag, so the core knows to project rather than guessing', () => {
    // An untagged island is read as `screen` — today's contract — so omitting this would draw the
    // ground anchors as if they were already projected: every island's tree, plants and parcels
    // seated at `1 / sin 20°` of their depth. Silent, and spelt `Pt` on both sides.
    const world = buildWorld([RING_FIXTURE], { buildings: false });
    const scene = worldToScene(world, null, new Date(), new Map());
    expect(scene.territories.length).toBeGreaterThan(0);
    for (const t of scene.territories) expect(t.anchorSpace).toBe('ground');
  });
});
