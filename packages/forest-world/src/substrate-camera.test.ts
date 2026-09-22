// THE MESH'S CELL DECOMPOSITION DOES NOT DEPEND ON THE CAMERA IT IS SEEN FROM (ADR-0367 D1).
//
// `scatter-camera.test.ts` fences everything scattered ON the land. This fences the land itself —
// the relaxed substrate's own interior, which is where per-capability status tint lives, and which
// therefore decides WHICH CAPABILITY OWNS WHICH GROUND. Increment:
// `substrate-interning-moves-to-ground-space` on `ground-space-truth-arc`.
//
// WHAT WAS WRONG. `substrate.ts` built the whole mesh on PROJECTED coordinates, and `VKEY` decided
// vertex IDENTITY — "are these two vertices the same point?" — by rounding them to 0.1 px. Under the
// declared camera the ground's depth axis is compressed by `sin θ` — `≈0.766` at the current 50°
// camera (ADR-0593), so a bucket 0.1 px tall on screen is `≈0.131` units tall on the ground: the
// tolerance is looser across depth than across width by `1 / sin θ`, `≈1.305×` today (it was
// `≈0.342` / `≈0.292` units / nearly 3× looser at the original 20° camera this suite was first
// written against), and every seed derived from that key was a function of the camera.
//
// ⚠ WHAT IT COST, MEASURED — and NOT what the increment predicted, so do not carry the old claim
// forward. The increment cites PR #1344's "50 → 52 cells". That is NOT reproducible: comparing this
// file against its own previous revision over symmetric discs of 7 to 61 tiles and 480 irregular
// grown blobs, in all three modes, the cell count is IDENTICAL every time. Lattice vertices sit units
// apart, so a 0.292-unit bucket never merged two distinct ground points — it only ever absorbed
// floating-point noise on shared corners, which is what it was for.
//
// WHAT WAS LIVE IS THE JITTER SEED. `relaxVerts` seeds each vertex's displacement off `VKEY`, so a
// key computed from a projected coordinate put every vertex's GROUND position downstream of the
// camera: 79.2% of vertex positions move between the old rule and this one, by up to 11.4 px. Counts,
// owners, wheat and the parcel partition are untouched; what changes is that the island's interior is
// now the LAND's texture rather than one the projection re-rolled.
//
// THE INVARIANT, and why it is the right one. The island in GROUND space is the same island at every
// camera. So the mesh built over it must have the same cells, in the same order, at the same ground
// positions, at every elevation — and only their SCREEN positions may move, foreshortened by the same
// `sin θ` the lattice took. That statement is independent of taste, of the value of the tolerance,
// and of every number in this file.
//
// ⚠ THE TEETH. A camera sweep is precisely the shape of test that can pass while measuring nothing:
// if the inputs did not really differ between the runs, any implementation passes. So two controls
// sit below the invariant. (a) pins that the cells DO foreshorten on screen between the elevations
// compared. (b) pins the DEFECT — that the key the OLD rule used really did move with the camera,
// and that a screen bucket really is looser on the depth axis than a ground one. If the projection
// ever stopped mattering, those go red before the invariant could go quietly vacuous.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  projectGround,
  unprojectGround,
} from './camera.js';
import { HEX_R, type Axial, type Pt } from './hex.js';
import { hash } from './rng.js';
import {
  MESH_TUNING,
  buildRelaxedCells,
  type DrawTile,
  type RelaxedCell,
  type SubstrateMode,
} from './substrate.js';

/** The declared camera plus a sweep either side, matching `camera.test.ts`'s range. */
const SWEEP = [PLAN_VIEW_ELEVATION_DEG, 60, 45, 30, 26.565, LAND_CAMERA_ELEVATION_DEG, 12] as const;

/** Unprojecting divides by `sin θ`, so error grows as the camera lowers; 1e-6 is far below any
 *  real placement difference (the defect moves whole cells) and far above the arithmetic. */
const TOLERANCE = 1e-6;

function discTiles(rings: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = -rings; r <= rings; r++) if (Math.abs(q + r) <= rings) out.push({ q, r });
  }
  return out;
}

/** A two-territory fixture: a 19-tile disc and a 7-tile neighbour, so ownership is exercised too. */
const TILES: DrawTile[] = [
  ...discTiles(2).map((h) => ({ h, owner: 0 })),
  ...discTiles(1).map((h) => ({ h: { q: h.q + 6, r: h.r }, owner: 1 })),
];
const WHEAT: ReadonlySet<string>[] = [new Set(['0,0', '1,-1', '-1,1']), new Set(['6,0'])];

const MODES: SubstrateMode[] = ['mesh', 'relaxed-hex', 'relaxed-quad'];

function build(mode: SubstrateMode, elevationDeg: number): RelaxedCell[] {
  return buildRelaxedCells(TILES, WHEAT, mode, {}, { elevationDeg });
}

for (const mode of MODES) {
  test(`${mode}: the same ground island decomposes into the same cells at every camera`, () => {
    const reference = build(mode, PLAN_VIEW_ELEVATION_DEG);
    assert.ok(reference.length > 0, 'the fixture produced no cells');

    for (const elevationDeg of SWEEP) {
      const got = build(mode, elevationDeg);
      assert.equal(
        got.length,
        reference.length,
        `${mode} at ${elevationDeg}°: ${got.length} cells against ${reference.length} in plan view. ` +
          'The mesh re-decomposed because the camera moved — which is the defect, not a rounding ' +
          'difference: a cell count is an integer and the ground island did not change.',
      );

      for (let i = 0; i < got.length; i++) {
        const a = got[i] as RelaxedCell;
        const b = reference[i] as RelaxedCell;
        assert.equal(a.owner, b.owner, `${mode} at ${elevationDeg}°: cell ${i} changed owner`);
        assert.equal(a.variant, b.variant, `${mode} at ${elevationDeg}°: cell ${i} changed variant`);
        assert.equal(a.wheat, b.wheat, `${mode} at ${elevationDeg}°: cell ${i} changed wheat`);
        assert.equal(
          a.poly.length,
          b.poly.length,
          `${mode} at ${elevationDeg}°: cell ${i} changed vertex count`,
        );
        for (let v = 0; v < a.poly.length; v++) {
          const ga = unprojectGround(a.poly[v] as Pt, elevationDeg);
          const gb = unprojectGround(b.poly[v] as Pt, PLAN_VIEW_ELEVATION_DEG);
          assert.ok(
            Math.abs(ga.x - gb.x) < TOLERANCE && Math.abs(ga.y - gb.y) < TOLERANCE,
            `${mode} at ${elevationDeg}°: cell ${i} vertex ${v} sits at a different GROUND spot — ` +
              `(${ga.x.toFixed(4)}, ${ga.y.toFixed(4)}) against ` +
              `(${gb.x.toFixed(4)}, ${gb.y.toFixed(4)}). Only the SCREEN position may move.`,
          );
        }
      }
    }
  });
}

test('TEETH (a) — the cells really do foreshorten, so the sweep is not comparing identical runs', () => {
  const plan = build('mesh', PLAN_VIEW_ELEVATION_DEG);
  const angled = build('mesh', LAND_CAMERA_ELEVATION_DEG);
  const heightOf = (cells: RelaxedCell[]): number => {
    const ys = cells.flatMap((c) => c.poly.map((p) => p.y));
    return Math.max(...ys) - Math.min(...ys);
  };
  const widthOf = (cells: RelaxedCell[]): number => {
    const xs = cells.flatMap((c) => c.poly.map((p) => p.x));
    return Math.max(...xs) - Math.min(...xs);
  };
  const f = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  const planH = heightOf(plan);
  const angledH = heightOf(angled);
  assert.ok(planH > 0, 'the plan-view fixture has no vertical extent');
  assert.ok(
    Math.abs(angledH / planH - f) < 0.02,
    `the mesh did not foreshorten as the camera declares: ${angledH.toFixed(2)} / ${planH.toFixed(2)} = ` +
      `${(angledH / planH).toFixed(4)}, expected sin(20°) = ${f.toFixed(4)}. If the two runs are not ` +
      'genuinely different pictures, the invariance test above proves nothing.',
  );
  assert.ok(
    Math.abs(widthOf(angled) - widthOf(plan)) < TOLERANCE,
    'the WIDTH must not move — only the depth axis foreshortens',
  );
});

test('TEETH (b) — the key the old rule used really was camera-dependent, and the new one is not', () => {
  // THE DEFECT, PINNED WHERE IT ACTUALLY LIVED. The old `VKEY` rounded the PROJECTED coordinate, so
  // it answered "which vertex is this?" differently at different cameras — and `relaxVerts` seeds
  // each vertex's jitter off that answer (`jx:` / `jm:`). Measured against the previous revision:
  // 79.2% of vertex positions move between the two rules, by up to 11.4 px.
  //
  // ⚠ NOT what the increment predicted, and worth stating so the wrong claim is not carried
  // forward: the CELL COUNT never differed — identical over discs of 7 to 61 tiles and 480 grown
  // blobs, in all three modes. The 0.292-unit ground bucket the projection opened up never merged
  // two distinct lattice vertices, because they sit units apart. So the merge hazard was real but
  // never fired; the jitter reseed is what was live.
  const cells = build('mesh', PLAN_VIEW_ELEVATION_DEG);
  const groundVerts = cells.flatMap((c) => c.poly);
  assert.ok(groundVerts.length > 0, 'the fixture produced no vertices');

  const screenKey = (p: Pt, elevationDeg: number): string => {
    const q = projectGround(p, elevationDeg);
    return `${Math.round(q.x * 10)},${Math.round(q.y * 10)}`;
  };
  const groundKey = (p: Pt): string => `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;

  let screenKeyMoved = 0;
  for (const v of groundVerts) {
    if (screenKey(v, LAND_CAMERA_ELEVATION_DEG) !== screenKey(v, PLAN_VIEW_ELEVATION_DEG)) {
      screenKeyMoved += 1;
    }
    assert.equal(
      groundKey(v),
      groundKey(v),
      'the ground key is a function of the ground alone — this cannot fail, and that is the point',
    );
  }
  assert.ok(
    screenKeyMoved > groundVerts.length * 0.5,
    `only ${screenKeyMoved} of ${groundVerts.length} vertices changed their SCREEN key between plan ` +
      'view and the declared camera. The old rule keyed on that value, so if it barely moves, this ' +
      'suite can no longer tell the fix from what it replaced.',
  );

  // And the anisotropy itself, as arithmetic on two real points rather than as prose. The old screen
  // key merges two points whenever their DEPTH gap `g` satisfies `g · sin θ · 10` rounding to the
  // same integer as 0, i.e. `g < 0.05 / sin θ`; the ground key keeps them apart once `g` rounds to a
  // DIFFERENT integer than 0, i.e. `g > 0.05`. ADR-0593's 50° camera still opens a window between
  // those two bounds — `0.05 < g < 0.05 / sin 50° ≈ 0.0653` — just a narrower one than the original
  // 20° camera's `0.05 < g < 0.05 / sin 20° ≈ 0.1462`, because the anisotropy itself shrank from
  // `1 / sin 20° ≈ 2.924×` to `1 / sin 50° ≈ 1.305×`. `g = 0.06` sits inside the new window: ONE
  // point to the screen key at the declared camera (`0.06 × sin 50° ≈ 0.046` px, still inside a
  // 0.1-px bucket) and TWO to the ground key (`0.06` rounds past its own 0.05-unit half-bucket).
  // That is the merge hazard the old tolerance opened; it never fired on the real lattice — see the
  // header — but it is what "the tolerance was looser on one axis" means, checkable rather than
  // asserted, at whatever elevation the land camera currently declares.
  const a: Pt = { x: 0, y: 0 };
  const b: Pt = { x: 0, y: 0.06 };
  assert.equal(
    screenKey(a, LAND_CAMERA_ELEVATION_DEG),
    screenKey(b, LAND_CAMERA_ELEVATION_DEG),
    'the screen key must merge these two — 0.06 ground units is well under half a 0.1-px bucket at sin(50°)',
  );
  assert.notEqual(groundKey(a), groundKey(b), 'the ground key must keep them apart');
});

// ── WHAT A CAMERA SWEEP STRUCTURALLY CANNOT SEE ──────────────────────────────
//
// Everything above compares the mesh against ITSELF at another elevation, so it is blind by
// construction to any change that is wrong at EVERY camera equally — a flipped jitter sign, a
// mis-keyed cell, the wrong builder for a mode. The diff-scoped mutation rung named exactly that
// gap on this branch (`check:mutation-diff`, ADR-0458): 14 mutants inside these changed lines
// survived the sweep untouched. These are the assertions that close it. They are not decoration
// added to satisfy a counter — each one states a property the sweep cannot state.

test('each mode routes to its OWN builder — the three decompositions differ', () => {
  // `buildRelaxedCells` dispatches on `mode`, and a sweep that builds each mode and compares it to
  // itself passes with any dispatch at all, including one that returns the same builder for all
  // three. The three paths produce very different cell densities over the same tiles, which is the
  // property that makes the dispatch observable.
  const counts = new Map(MODES.map((m) => [m, build(m, PLAN_VIEW_ELEVATION_DEG).length]));
  const mesh = counts.get('mesh') as number;
  const quad = counts.get('relaxed-quad') as number;
  const hex = counts.get('relaxed-hex') as number;
  assert.ok(hex > 0 && quad > 0 && mesh > 0, `a mode produced no cells: ${[...counts].join(', ')}`);
  // relaxed-hex is one cell per tile; relaxed-quad fans each tile into 6; mesh subdivides further.
  assert.equal(hex, TILES.length, 'relaxed-hex is one cell per claimed tile');
  assert.ok(quad > hex, `relaxed-quad (${quad}) must be denser than relaxed-hex (${hex})`);
  assert.ok(mesh > quad, `mesh (${mesh}) must be denser than relaxed-quad (${quad})`);
});

test('the jitter displaces interior vertices, isotropically and within its own budget', () => {
  // `jitter: 0` is the control: with no displacement budget every vertex sits exactly where the
  // lattice put it, so any movement in the default build is the jitter and nothing else.
  const still = buildRelaxedCells(TILES, WHEAT, 'mesh', { jitter: 0, iters: 0, relax: 0 }, {
    elevationDeg: PLAN_VIEW_ELEVATION_DEG,
  });
  const moved = buildRelaxedCells(TILES, WHEAT, 'mesh', { iters: 0, relax: 0 }, {
    elevationDeg: PLAN_VIEW_ELEVATION_DEG,
  });
  assert.equal(moved.length, still.length, 'the jitter must not change the decomposition');

  let maxDx = 0;
  let maxDy = 0;
  let anyMoved = false;
  for (let i = 0; i < moved.length; i++) {
    const a = moved[i] as RelaxedCell;
    const b = still[i] as RelaxedCell;
    for (let v = 0; v < a.poly.length; v++) {
      const dx = Math.abs((a.poly[v] as Pt).x - (b.poly[v] as Pt).x);
      const dy = Math.abs((a.poly[v] as Pt).y - (b.poly[v] as Pt).y);
      if (dx > 1e-9 || dy > 1e-9) anyMoved = true;
      maxDx = Math.max(maxDx, dx);
      maxDy = Math.max(maxDy, dy);
    }
  }
  assert.ok(anyMoved, 'the default tuning jittered nothing at all');

  // The budget: `jitterMag = HEX_R * t.jitter`, and a displacement is `(cos·mag, sin·mag)`, so
  // NEITHER axis may exceed it. A y term divided by the magnitude instead of multiplied by it
  // collapses; one multiplied twice overshoots. Both are outside this bound.
  const budget = HEX_R * (MESH_TUNING.jitter as number) + 1e-9;
  assert.ok(maxDx <= budget, `x displacement ${maxDx.toFixed(3)} exceeds the budget ${budget.toFixed(3)}`);
  assert.ok(maxDy <= budget, `y displacement ${maxDy.toFixed(3)} exceeds the budget ${budget.toFixed(3)}`);

  // ISOTROPIC ON THE GROUND — the whole reason the explicit `sin` term could be deleted. The two
  // axes must reach comparable extents; a y term carrying the camera's flattening would come in at
  // ~34% of x, and one carrying it twice at ~12%.
  assert.ok(
    maxDy / maxDx > 0.75 && maxDy / maxDx < 1.34,
    `the jitter is not isotropic on the ground: max dy/dx = ${(maxDy / maxDx).toFixed(3)}. ` +
      'On the ground plane the displacement is a circle, not an ellipse — if this is ~0.34 the ' +
      "camera's flattening has leaked back in.",
  );
});

test('wheat covers the share of the island its own hexes cover — the cell keeps its hex key', () => {
  // Each mesh cell resolves its owning HEX by keying its centroid through `pixelToHex` in GROUND
  // space, and that key decides whether the cell is wheat. The camera sweep cannot see a mis-key: a
  // cell keyed to the wrong hex is keyed to the SAME wrong hex at every elevation. What a mis-key
  // DOES move is how much of the island ends up wheat, because a displaced key lands on hexes
  // nobody tinted.
  //
  // The expected share is arithmetic on the fixture, not a recorded number: 4 of the 26 claimed
  // tiles are wheat, and `wheatScatter` keeps ~72% of a wheat hex's cells, so ~11% of cells are
  // wheat. A key read at the declared camera instead of on the ground scales the row axis by
  // 1/sin(20 deg) ~ 2.9 and lands most cells on untinted hexes; a centroid multiplied by its vertex
  // count instead of divided by it lands them off the island entirely. Both collapse this toward 0.
  const cells = build('mesh', PLAN_VIEW_ELEVATION_DEG);
  const wheatHexes = WHEAT.reduce((n, set) => n + set.size, 0);
  const expected = (wheatHexes / TILES.length) * 0.72;
  const share = cells.filter((c) => c.wheat).length / cells.length;
  assert.ok(
    share > expected * 0.6 && share < expected * 1.4,
    `wheat covers ${(share * 100).toFixed(1)}% of the cells; ${wheatHexes} of ${TILES.length} tiles ` +
      `are wheat and the scatter keeps ~72%, so ~${(expected * 100).toFixed(1)}% was expected. A ` +
      'share near zero means the cells resolved to hexes nobody tinted.',
  );
  assert.ok(cells.some((c) => !c.wheat), 'every cell is wheat — the scatter did nothing');
});

test('the default camera IS the declared camera — an omitted option is not a different mesh', () => {
  // Every real caller omits the options argument entirely (`buildRelaxedCells(tiles, wheat, 'mesh')`),
  // so the sweep above — which always passes one — never exercises the path the app actually takes.
  const declared = build('mesh', LAND_CAMERA_ELEVATION_DEG);
  const defaulted = buildRelaxedCells(TILES, WHEAT, 'mesh');
  assert.equal(defaulted.length, declared.length, 'the default build has a different cell count');
  for (let i = 0; i < declared.length; i++) {
    const a = defaulted[i] as RelaxedCell;
    const b = declared[i] as RelaxedCell;
    assert.equal(a.wheat, b.wheat, `cell ${i} differs in wheat between the default and 20 degrees`);
    for (let v = 0; v < a.poly.length; v++) {
      assert.ok(
        Math.abs((a.poly[v] as Pt).x - (b.poly[v] as Pt).x) < TOLERANCE &&
          Math.abs((a.poly[v] as Pt).y - (b.poly[v] as Pt).y) < TOLERANCE,
        `cell ${i} vertex ${v} moved between the default build and an explicit ` +
          `LAND_CAMERA_ELEVATION_DEG. The default must BE the declared camera.`,
      );
    }
  }
});

test('THE MESH IS A FIXED ARTIFACT — if this digest moves, the land moved, and it must be said out loud', () => {
  // ⚠ THIS IS A SNAPSHOT, DELIBERATELY, and it is the only one here. Everything else in this file
  // states a PROPERTY, and a property-only suite is blind to any change that is wrong at every
  // camera equally — a flipped jitter sign is the exact case, since the jitter angle is uniform on
  // [0, 2pi) and negating one component maps the distribution onto itself. The diff-scoped mutation
  // rung named that mutant on this branch and nothing property-shaped could kill it.
  //
  // It is worth pinning for a reason beyond the mutant: NOBODY EYEBALLS THIS MESH. When it moved on
  // this branch it surfaced two repos away, as an accretion-wave partition in `apps/studio` and a
  // parcel-outline point count in `forest-world-r3f` — both real, both loud, and both a long way
  // from the line that caused them. This is the same alarm at the source.
  //
  // WHEN IT GOES RED: do not re-record it reflexively. Establish WHAT moved and why, say so in the
  // landing, then update it. A mesh change with a reason is ordinary; a mesh change nobody noticed
  // is what this exists to prevent.
  const cells = build('mesh', PLAN_VIEW_ELEVATION_DEG);
  const digest = hash(
    cells
      .map(
        (c) =>
          `${c.owner}:${c.variant}:${c.wheat ? 1 : 0}:` +
          c.poly.map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';'),
      )
      .join('|'),
  );
  assert.equal(cells.length, 326, 'the fixture no longer decomposes into 326 cells');
  assert.equal(
    digest,
    // Re-recorded 2026-09-06 (ADR-0528): the LATTICE moved — HEX_R is derived from the land ratio
    // (27 → ≈ 11.06), so every cell's coordinates scaled with it. The fixture still decomposes into
    // the same 326 cells; only their size changed. Was 4012762627.
    1938404724,
    'the ground mesh this fixture produces has changed. That is not automatically wrong — but it ' +
      'is never invisible: name what moved and why in the landing, then re-record it here.',
  );
});
