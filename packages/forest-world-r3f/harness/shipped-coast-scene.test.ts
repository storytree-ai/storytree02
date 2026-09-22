// shipped-coast-scene.test.ts — the coast comparison's own arithmetic, without a GPU.
//
// ⚠ THIS FILE IS WHERE THE REAL ISLAND IS ASSERTED, and that is a division of labour rather than a
// duplication. `src/coast-clip.test.ts` proves the module against a four-parcel block it can reason
// about by hand; the fixture the product actually draws lives in `harness/`, so a `src/` test
// cannot see it. Everything below is about THAT island and the thirty-five-island forest built from
// it — the numbers the evidence quotes.
//
// ⚠⚠ AND THE PREMISE IS TESTED, NOT ASSUMED. The first tests are that the control really is the
// raw hex-union silhouette and that its coast really does fold. Without them, every "the cap keeps
// every parcel simple" assertion below is satisfied by a map that never needed a cap.
//
// ⚠ NO SCENE IS BUILT HERE. `buildCoastScene` needs a WebGL context; every claim below is about
// `coastPlan` and `clipToCoast`, which are pure arithmetic over descriptors — the cheap witness and
// the right one, for the reason the shadow page's own tests give (`check:mutation-diff` runs the
// covering tests once per mutant against a timeout, and scores a slow one as unproven).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COAST_MODES,
  clipToCoast,
  coastCapping,
  coastCurve,
  isSimpleRing,
  rimLoops,
  vertexKey,
  type CoastMode,
  type CoastPoint,
} from '../src/coast-clip.js';
import { LAND_SCALE } from '../src/land-per-capability.js';
import { scaleAboutIslands } from '../src/true-footprint.js';
import { worldTo3D, type InstanceDescriptor } from '../src/world-to-3d.js';
import { islandScene } from './island-fixture.js';
import {
  ALL_COAST_ARMS,
  COAST_ARMS,
  REFERENCE_ARM,
  coastPlan,
  type CoastPlan,
} from './shipped-coast-scene.js';
import { crowdCells, crowdSize } from './shipped-crowd-scene.js';
import { drawnParcels, shippedParcels } from './shipped-land-scene.js';

/**
 * THE CAMERA AT WHICH THE DRAWN RIBBON'S COAST ACTUALLY FOLDS — a REGIME, not the shipped camera's
 * value, and pinned here as a LITERAL deliberately never derived from `LAND_CAMERA_ELEVATION_DEG`.
 *
 * Measured 2026-09-05 at 20° (`sin 20° = 0.342`): the drawn ribbon's z-depth is foreshortened
 * enough that the coast's concave notches cross when offset by `coastCurve` — see `THE PREMISE`
 * below. The shipped camera moved to 50° under ADR-0593 D1 (`sin 50° = 0.766`); at that
 * foreshortening the SAME notches no longer cross, so the shipped camera no longer reaches this
 * regime (`the SHIPPED camera … no longer folds`, further down).
 *
 * The fold-cap MECHANISM this file proves (`coastCapping` / the rim-vertex cap) is real, correct,
 * live code guarding a case that can still occur — a sufficiently foreshortened camera, or a
 * sufficiently convoluted coast — so these tests pin the REGIME that exercises it rather than
 * inheriting whichever elevation happens to ship today. Losing that coverage because today's
 * camera doesn't trip it would leave working code wholly unwitnessed, and would silently re-open
 * the moment anyone lowered the camera again.
 */
const FOLD_REGIME_ELEVATION_DEG = 20;

/**
 * The island the studio actually ships, as the mapper emits it — built LAZILY.
 *
 * ⚠ LAZY FOR THE SAME MEASURED REASON {@link forestCells} IS, one rung down. `check:mutation-diff`
 * re-imports this module once PER MUTANT, and a module-scope `shippedParcels()` is paid on every
 * one of those imports whether or not the mutant's covering test ever touches the island. The
 * witnesses are the rung's own cost, and §10 of the playbook is to make them cheap.
 */
let island: InstanceDescriptor[] | null = null;
function shippedIsland(): InstanceDescriptor[] {
  island ??= shippedParcels();
  return island;
}

/** The same island as the 2D map DRAWS it — the projected ribbon the 3D ground plane was until
 *  ADR-0517 D1 — AT THE FOLD REGIME ({@link FOLD_REGIME_ELEVATION_DEG}), not at whatever camera
 *  ships today. The fold cap's premise lives here: see `THE PREMISE` below.
 *
 *  ⚠ NOT `drawnParcels()` — that function follows the SHIPPED camera
 *  (`LAND_CAMERA_ELEVATION_DEG`, 50° since ADR-0593 D1) by design, because its other reader
 *  (`shipped-crowd-scene.ts`) needs the real map's own spacing. This function instead builds the
 *  ribbon directly through `islandScene`/`worldTo3D`, pinning `cameraElevationDeg` to the fold
 *  regime, so the historical fold-cap assertions below keep testing the geometry they were written
 *  against rather than silently follow the shipped camera wherever it later moves.
 *
 *  ⚠ READ AT LAND_SCALE (`land-per-capability.ts`), and the reason is the coast clip's own: since
 *  the ratio sizes every island, `coastCurve` outsets by `jitteredOutset × LAND_SCALE` (the 2D
 *  map's 7-unit outset at the size the ground is), so the ribbon at its DRAWN size would get a
 *  beach 0.377 of the fraction the 2D map draws and the premise below would be asked of a picture
 *  nobody draws. Scaling the ribbon by the same factor about its centre makes it a SIMILAR figure
 *  to the 2D map's ribbon-with-outset, and similarity preserves whether an offset folds — so the
 *  premise, and the capping counts pinned below, are exactly the 2D map's. Measured 2026-09-05:
 *  the unscaled ribbon reports `{ bound: 0, least: 1 }` on every arm; at LAND_SCALE it reports
 *  the pins verbatim. */
let drawn: InstanceDescriptor[] | null = null;
function drawnIsland(): InstanceDescriptor[] {
  drawn ??= scaleAboutIslands(
    worldTo3D(islandScene({ cameraElevationDeg: FOLD_REGIME_ELEVATION_DEG }), {
      landAreaPerCapability: null,
    }).filter((d): d is InstanceDescriptor => d.kind === 'cell-ground'),
    () => ({ x: LAND_SCALE, z: LAND_SCALE }),
  );
  return drawn;
}

/** The same ribbon, but at the camera the product actually SHIPS — `drawnParcels()` unmodified,
 *  which follows `LAND_CAMERA_ELEVATION_DEG` (50° since ADR-0593 D1). Named separately from
 *  {@link drawnIsland} so a call site can never confuse the fold regime with the shipped fact —
 *  the one new assertion below (`the SHIPPED camera … no longer folds`) is what this is for. */
let shippedDrawn: InstanceDescriptor[] | null = null;
function shippedDrawnIsland(): InstanceDescriptor[] {
  shippedDrawn ??= scaleAboutIslands(drawnParcels(), () => ({ x: LAND_SCALE, z: LAND_SCALE }));
  return shippedDrawn;
}

/**
 * `coastPlan` memoised per `(fixture, arm)`.
 *
 * ⚠ THE CACHE IS KEYED ON THE FIXTURE'S IDENTITY, NOT ITS CONTENT, and that is safe here for one
 * reason worth stating: every fixture below is a memoised singleton, so identity IS content. A
 * future caller passing a freshly-built array gets a fresh entry rather than a wrong one — the
 * failure mode is a miss, never a stale hit.
 *
 * WHY AT ALL: `coastPlan` runs a full clip, and `coastCapping` runs a second one inside it. The
 * tests below ask for the same `(island, arm)` plan a dozen times over. Under the mutation rung
 * that dozen is multiplied by the mutant count.
 */
const PLANS = new Map<readonly InstanceDescriptor[], Map<CoastMode, CoastPlan>>();
function planOf(cells: readonly InstanceDescriptor[], mode: CoastMode): CoastPlan {
  let byArm = PLANS.get(cells);
  if (byArm === undefined) {
    byArm = new Map();
    PLANS.set(cells, byArm);
  }
  let plan = byArm.get(mode);
  if (plan === undefined) {
    plan = coastPlan(cells, mode);
    byArm.set(mode, plan);
  }
  return plan;
}
/**
 * THE THIRTY-FIVE-ISLAND FOREST — built LAZILY and used by exactly ONE test.
 *
 * ⚠⚠ EVERY OTHER MULTI-ISLAND CLAIM RUNS ON {@link twoIslands} INSTEAD, and that is a
 * mutation-rung requirement measured rather than guessed. `check:mutation-diff` re-runs the
 * covering tests once PER MUTANT against a timeout, and a mutant that breaks `edgeKey` turns
 * `rimLoops` on a 5,740-parcel fixture into a quadratic chase over 46,000 forged boundary segments.
 * Six mutants came back as TIMEOUTS — real detections the rung cannot attribute to any test,
 * because no test failed: the suite simply ground. The claims below need MORE THAN ONE island, not
 * thirty-five, so they get two; only the thirty-five-coasts finding is genuinely about thirty-five.
 */
let forest: InstanceDescriptor[] | null = null;
function forestCells(): InstanceDescriptor[] {
  forest ??= crowdCells(crowdSize('forest'));
  return forest;
}

/** The shipped island and a copy of it 600 units east, wearing its own story id — enough to ask
 *  every "does one island's coast reach another's" question at 1/17th the cost of the forest. */
let pair: InstanceDescriptor[] | null = null;
function twoIslands(base: InstanceDescriptor[] = shippedIsland()): InstanceDescriptor[] {
  if (base !== shippedIsland()) return pairOf(base);
  pair ??= pairOf(base);
  return pair;
}

function pairOf(base: InstanceDescriptor[]): InstanceDescriptor[] {
  return [
    ...base,
    ...base.map((c) => {
      const moved: InstanceDescriptor = {
        ...c,
        island: 'story-east',
        transform: { ...c.transform, x: c.transform.x + 600 },
      };
      if (c.parcel !== undefined) moved.parcel = `story-east/${c.parcel}`;
      if (c.points !== undefined) moved.points = c.points.map((p) => ({ ...p, x: p.x + 600 }));
      return moved;
    }),
  ];
}

function ringsOf(cells: readonly InstanceDescriptor[]): CoastPoint[][] {
  return cells.map((c) => (c.points ?? []).map((p) => ({ x: p.x, z: p.z })));
}

// ---------------------------------------------------------------------------
// The premise
// ---------------------------------------------------------------------------

test('the shipped island ends in ONE rim loop of 52 vertices', () => {
  const loops = rimLoops(ringsOf(shippedIsland()));
  assert.equal(shippedIsland().length, 164);
  assert.equal(loops.length, 1);
  assert.equal(loops[0]!.length, 52);
});

test('⚠ THE PREMISE: the coast the 2D map draws SELF-INTERSECTS — and on the true footprint it no longer does', () => {
  // `coast.ts` says the offset "can never self-intersect" because only the outset MAGNITUDE is
  // perturbed, along the normal. On the island AS THE 2D MAP DRAWS IT — the projected ribbon,
  // 234 × 46, which was also the 3D ground plane until 2026-09-05 — it crosses itself twice. The
  // 2D panel draws that loop as an SVG fill and the nonzero rule hides it; a triangulated ground
  // cannot, which is the whole reason `coastDisplacement` carries a fold cap.
  // (× LAND_SCALE: the ribbon is read at 88 × 17 with the clip's LAND_SCALE outset — the similar
  // figure of the 2D map's 234 × 46 with its 7-unit outset; see `drawnIsland`.)
  const drawnRim = rimLoops(ringsOf(drawnIsland()))[0]!;
  assert.equal(isSimpleRing(drawnRim), true, 'the raw hex silhouette should be simple');
  const drawnCurve = coastCurve(drawnRim, 'context-traversal-capture');
  assert.equal(isSimpleRing(drawnCurve.outset), false, 'the drawn outset coast should fold — the cap exists for this');
  assert.equal(isSimpleRing(drawnCurve.smooth), false);
  // ⚠ SINCE ADR-0517 D1 THE 3D GROUND IS THE TRUE FOOTPRINT (234 × 135), and on it the SAME
  // offset does not fold: the ribbon folded because its concave notches were three times tighter
  // in z than the outset wave. Measured 2026-09-05, corrected in place. The cap stays — it is a
  // guard on a rule that CAN fold, held by the drawn island above — and the shipped island simply
  // never trips it (`the fold cap binds …` below).
  const rim = rimLoops(ringsOf(shippedIsland()))[0]!;
  assert.equal(isSimpleRing(rim), true);
  const curve = coastCurve(rim, 'context-traversal-capture');
  assert.equal(isSimpleRing(curve.outset), true, 'the true footprint’s outset coast is simple');
  assert.equal(isSimpleRing(curve.smooth), true);
});

test('the SHIPPED camera (50°, ADR-0593 D1) no longer reaches the fold regime', () => {
  // THE FACT THAT MAKES THE PIN ABOVE HONEST RATHER THAN A DODGE. The fold-cap mechanism is real
  // and still worth guarding (see `FOLD_REGIME_ELEVATION_DEG`'s doc comment), but the camera this
  // studio actually ships no longer trips it: at `LAND_CAMERA_ELEVATION_DEG` (50°, `sin 50° =
  // 0.766`) the drawn ribbon is close enough to its true shape that the notches which crossed at
  // 20° (`sin 20° = 0.342`) no longer do. This is a MECHANICAL check of that drift, not a note —
  // if the shipped camera is ever lowered back into the fold regime, this assertion goes false and
  // says so, which is exactly the re-read the regime pin above is standing in for.
  const shippedDrawnRim = rimLoops(ringsOf(shippedDrawnIsland()))[0]!;
  assert.equal(isSimpleRing(shippedDrawnRim), true, 'the raw hex silhouette should still be simple');
  const shippedDrawnCurve = coastCurve(shippedDrawnRim, 'context-traversal-capture');
  assert.equal(
    isSimpleRing(shippedDrawnCurve.outset),
    true,
    'the shipped camera should no longer fold the drawn ribbon — if this is false, the shipped camera dropped back into the fold regime and FOLD_REGIME_ELEVATION_DEG needs a re-read',
  );
  assert.equal(isSimpleRing(shippedDrawnCurve.smooth), true);
});

test('the control is the map with no coast at all', () => {
  const plan = planOf(shippedIsland(), REFERENCE_ARM);
  assert.equal(plan.capRim, 0);
  assert.equal(plan.capBound, 0);
  assert.equal(plan.foldedParcels, 0);
  assert.deepEqual(clipToCoast(shippedIsland(), REFERENCE_ARM), shippedIsland());
});

// ---------------------------------------------------------------------------
// The claim the map's honesty rests on
// ---------------------------------------------------------------------------

test('⚠⚠ NO PARCEL FOLDS, on any arm, on the island OR the forest', () => {
  // A folded parcel paints one capability's status colour over ground belonging to another. This
  // is the assertion the driver's first refusal reads, and it is the reason the cap exists.
  for (const arm of ALL_COAST_ARMS) {
    assert.equal(planOf(shippedIsland(), arm).foldedParcels, 0, `${arm} folded a parcel on one island`);
    assert.equal(planOf(twoIslands(), arm).foldedParcels, 0, `${arm} folded a parcel beside a neighbour`);
  }
});

test('the fold cap binds on a handful of rim vertices of the DRAWN island, and on none of the true footprint’s', () => {
  // Pinned rather than bounded: the cap is a visible notch in the shore, so a change that made it
  // bind on twice as many vertices is a change to the picture and has to be looked at. The drawn
  // ribbon is where it binds; on the shipped true footprint (ADR-0517 D1) every rim vertex keeps
  // its full outset — `least: 1` — measured 2026-09-05.
  assert.deepEqual(coastCapping(drawnIsland(), 'outset'), { rim: 52, bound: 4, least: 0.7 });
  assert.deepEqual(coastCapping(drawnIsland(), 'project'), { rim: 52, bound: 2, least: 0.9 });
  assert.deepEqual(coastCapping(drawnIsland(), 'subdivide'), { rim: 52, bound: 3, least: 0.6 });
  for (const arm of ['outset', 'project', 'subdivide'] as const) {
    assert.deepEqual(coastCapping(shippedIsland(), arm), { rim: 52, bound: 0, least: 1 }, `${arm} on the true footprint`);
  }
});

test('EVERY island is capped, not just the first', () => {
  // On the drawn ribbon, where the cap binds — see above.
  const cap = coastCapping(twoIslands(drawnIsland()), 'outset');
  assert.equal(cap.rim, 52 * 2, 'both islands should report a rim');
  assert.ok(cap.bound > 0, 'the cap should bind somewhere');
  // And each island is capped on its OWN terms. Counting is not enough to say so — two different
  // waves can happen to bind the same NUMBER of vertices, and here they do — so the claim is made
  // against the coasts themselves: the same geometry under two story ids lands in two places.
  const clipped = clipToCoast(twoIslands(), 'outset');
  const relative = (island: string, dx: number): string =>
    clipped
      .filter((c) => c.island === island)
      .map((c) => (c.points ?? []).map((p) => vertexKey({ x: p.x - dx, z: p.z })).join(';'))
      .join('|');
  assert.notEqual(
    relative('context-traversal-capture', 0),
    relative('story-east', 600),
    'the two islands wear the SAME coast — one seed reached both',
  );
});

// ---------------------------------------------------------------------------
// What each arm costs
// ---------------------------------------------------------------------------

test('the free arms are free — no triangle, no ring vertex', () => {
  const control = planOf(shippedIsland(), REFERENCE_ARM);
  for (const arm of ['outset', 'project'] as const) {
    const plan = planOf(shippedIsland(), arm);
    assert.equal(plan.triangles, control.triangles, arm);
    assert.equal(plan.ringVertices, control.ringVertices, arm);
    assert.equal(plan.attributeBytes, control.attributeBytes, arm);
  }
});

test('subdivide spends exactly the curve — four points per rim vertex, once', () => {
  const control = planOf(shippedIsland(), REFERENCE_ARM);
  const plan = planOf(shippedIsland(), 'subdivide');
  const rim = rimLoops(ringsOf(shippedIsland()))[0]!.length;
  assert.equal(plan.ringVertices - control.ringVertices, rim * 4);
  // Every parcel prism is `ringLength * 3 - 2` triangles, so the extra vertices cost three each.
  assert.equal(plan.triangles - control.triangles, rim * 4 * 3);
});

test('every arm GROWS the island, and the three grow it by different amounts', () => {
  const areas = new Map(COAST_MODES.map((m) => [m, planOf(shippedIsland(), m).groundArea]));
  const control = areas.get(REFERENCE_ARM)!;
  for (const arm of COAST_ARMS) {
    assert.ok(areas.get(arm)! > control, `${arm} added no land`);
  }
  assert.equal(new Set([...areas.values()].map((a) => a.toFixed(3))).size, COAST_MODES.length);
});

// ---------------------------------------------------------------------------
// The forest's own finding
// ---------------------------------------------------------------------------

test('⚠ thirty-five copies of ONE island wear thirty-five DIFFERENT coasts', () => {
  // The wave is seeded on the island id and `crowdCells` re-stamps that per copy, so the forest
  // stops being a tiled repetition of one silhouette at the moment the coast lands. Before the
  // clip every island is the same shape translated; after it, none of them are.
  // ⚠ THE ORIGIN IS TAKEN FROM A MAP BUILT IN ONE PASS, never re-found per cell. The obvious
  // `clipped.find(d => d.island === island)` inside the loop is quadratic over 5,740 descriptors —
  // 33 million comparisons on the healthy path, and the single largest reason this file's mutants
  // were coming back as timeouts rather than as verdicts.
  const shapeOf = (cells: readonly InstanceDescriptor[], mode: CoastMode): Set<string> => {
    const clipped = clipToCoast(cells, mode);
    const origin = new Map<string, InstanceDescriptor>();
    for (const c of clipped) {
      if (c.island !== undefined && !origin.has(c.island)) origin.set(c.island, c);
    }
    const byIsland = new Map<string, string[]>();
    for (const c of clipped) {
      const island = c.island;
      if (island === undefined) continue;
      const at = origin.get(island)!;
      const rel = (c.points ?? [])
        .map((p) => vertexKey({ x: p.x - at.transform.x, z: p.z - at.transform.z }))
        .join(';');
      const list = byIsland.get(island);
      if (list) list.push(rel);
      else byIsland.set(island, [rel]);
    }
    return new Set([...byIsland.values()].map((r) => r.join('|')));
  };
  assert.equal(shapeOf(forestCells(), REFERENCE_ARM).size, 1, 'before the clip the forest is one shape');
  assert.equal(shapeOf(forestCells(), 'outset').size, 35, 'after it, thirty-five');
});

test('a coast never reaches into a neighbouring island', () => {
  // The beach is capped well inside the inter-island gap by `jitteredOutset`'s own amplitude, and
  // the fold cap only ever shortens it — so no island's ground may end up inside another's bounds.
  // ⚠ Asked of the PAIR rather than the forest: the question is "does one island's coast reach its
  // neighbour", and two islands is the smallest fixture in which that question exists.
  const boxes = (cells: readonly InstanceDescriptor[]): Map<string, [number, number, number, number]> => {
    const out = new Map<string, [number, number, number, number]>();
    for (const c of cells) {
      const island = c.island;
      if (island === undefined) continue;
      const found = out.get(island) ?? [Infinity, -Infinity, Infinity, -Infinity];
      for (const p of c.points ?? []) {
        found[0] = Math.min(found[0], p.x);
        found[1] = Math.max(found[1], p.x);
        found[2] = Math.min(found[2], p.z);
        found[3] = Math.max(found[3], p.z);
      }
      out.set(island, found);
    }
    return out;
  };
  const before = boxes(twoIslands());
  for (const arm of COAST_ARMS) {
    const after = boxes(clipToCoast(twoIslands(), arm));
    const ids = [...after.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = after.get(ids[i]!)!;
        const b = after.get(ids[j]!)!;
        const overlaps = a[0] <= b[1] && b[0] <= a[1] && a[2] <= b[3] && b[2] <= a[3];
        const overlappedBefore = (() => {
          const p = before.get(ids[i]!)!;
          const q = before.get(ids[j]!)!;
          return p[0] <= q[1] && q[0] <= p[1] && p[2] <= q[3] && q[2] <= p[3];
        })();
        assert.equal(
          overlaps,
          overlappedBefore,
          `${arm}: ${ids[i]} and ${ids[j]} changed whether their bounds overlap`,
        );
      }
    }
  }
});
