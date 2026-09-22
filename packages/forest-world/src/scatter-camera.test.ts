// WHAT THE ISLAND CARRIES DOES NOT DEPEND ON THE CAMERA IT IS SEEN FROM (ADR-0367 D1).
//
// ADR-0367 D1 gave the land a declared camera, and `hexCenter` / `hexCorners` / `pixelToHex` /
// `hexPath` started projecting the ground through it: a ground-plane displacement away from the
// camera now covers `sin 50° ≈ 0.766` of the screen it used to (`sin 20° ≈ 0.342` at the original
// ADR-0367 D1 camera; the value moved under ADR-0593). `camera.test.ts` fences that projection.
// This suite fences the half the projection LEFT BEHIND.
//
// Everything scattered ON the land — the UAT flowers, the garden heroes, the stepping-stone walk, the
// lavender and grass accents — is placed by rejection sampling that measures distances against those
// projected polygons. Those measurements were ISOTROPIC SCREEN PIXELS, and the polar samples that fed
// them carried a hand-picked `0.7` y-squash inherited from the wisp orbit, older than the camera and
// unrelated to it. So the marks were being tested in one space against geometry drawn in another, and
// the failure has one direction: `groundGap >= hypot` always, so an isotropic screen keep-out never
// admits a placement the ground would reject — it OVER-enforces. A 15 px spacing floor is a ~20
// ground-unit floor on a cell 77% as tall (was ~44 ground units on a cell 34% as tall at the
// original 20° camera — flatter cameras inflate the defect more). Downstream that shows up two
// ways. A bounded rejection sampler starves on a tight or concave island and relocates the mark
// onto a cell centroid; and the stone walk, whose count is a leg length divided by a spacing, loses
// stones outright because the leg was measured on screen while the spacing was a ground fraction.
// Measured on the fixture below before this suite existed, AT THE ORIGINAL 20° CAMERA: 9 stones in
// plan view against 7 at the declared camera, every UAT flower on a
// DIFFERENT ground spot at every elevation, and every garden hero likewise.
//
// THE INVARIANT, and why it is the right one. A mark belongs to the GROUND. The island in ground
// space is exactly the same island at every camera, so the same marks must be placed, at the same
// ground spots, and only their SCREEN positions may move — foreshortened by the same `sin θ` the
// lattice took. That statement is independent of taste, of the value of the constant, and of any
// number in this file.
//
// THE FIXTURE IS A SYMMETRIC HEX DISC, which is what makes the invariant expressible at all: its
// centroid is the origin and its widest tile pair lies on the q axis, so the `radius` and `centroid`
// a surface derives from projected tile centres come out IDENTICAL at every elevation. Only the
// projection changes between the runs below, never the ground island.
//
// THE NAMEPLATE BAND WAS PARKED OUT OF RANGE, AND IT IS NOT ANY MORE (ADR-0545). The paragraph that
// stood here said `y < labelY - 14` was "a SCREEN constraint and stays one — the plate is screen
// art, drawn at a fixed pixel size — so it is legitimately elevation-dependent", and parked the
// plate 4000 units south so it could never bind. That exemption was the LAST MEMBER of the very bug
// class this file exists to fence, wearing a reason. The plate having no world position is a fact
// about the plate, not a licence for a GROUND placement to ask a screen question: whatever a flower
// is or is not allowed to sit under, the answer may not change with the angle the island is seen
// from. So the plate is an anchor now — a ground baseline the caller hands over, projected once with
// the centroid and the tree — its clearance is a ground distance, and the band is IN RANGE below,
// binding, and held to the same invariant as every other keep-out here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  projectGround,
} from './camera.js';
import { HEX_R, hexCenter, hexCorners, type Axial, type Pt } from './hex.js';
import { hash, rand01 } from './rng.js';
import { routeTrails } from './routing.js';
import type { RelaxedCell } from './substrate.js';
import {
  SHIPPED_TILE_ART,
  buildScene,
  placeGardenHeroes,
  type GardenHeroId,
  type SceneGardenHero,
  type SceneInput,
  type SceneNode,
  type SceneTerritoryInput,
} from './scene.js';

/** The declared camera plus a sweep either side, matching `camera.test.ts`'s range. */
const SWEEP = [PLAN_VIEW_ELEVATION_DEG, 60, 45, 30, 26.565, LAND_CAMERA_ELEVATION_DEG, 12] as const;

/** Screen coordinates are emitted `toFixed(1)`, so a recovered position carries up to 0.05 px of
 *  rounding at each end. 0.15 px is comfortably inside that and far below any placement difference —
 *  the pre-camera rule misses by tens of pixels, as the teeth controls below show. */
const ROUNDING = 0.15;

// ---------- the fixture: ONE ground island, seen from several cameras ----------

function discTiles(rings: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let r = -rings; r <= rings; r++) if (Math.abs(q + r) <= rings) out.push({ q, r });
  }
  return out;
}

interface Island {
  cells: RelaxedCell[];
  centroid: Pt;
  radius: number;
  treeSpot: Pt;
}

/** The same 19-tile ground island, projected at `elevationDeg` exactly the way a surface projects it
 *  (`hexCenter` for the anchors, `hexCorners` for the cell rings), with the `centroid` / `radius` a
 *  surface derives from those projected anchors. Both come out elevation-INDEPENDENT here, which is
 *  the property the symmetric disc buys. */
function island(elevationDeg: number, rings = 2): Island {
  const centres = discTiles(rings).map((h) => hexCenter(h, { elevationDeg }));
  const cx = centres.reduce((s, p) => s + p.x, 0) / centres.length;
  const cy = centres.reduce((s, p) => s + p.y, 0) / centres.length;
  return {
    cells: centres.map((c, i) => ({
      owner: 0,
      poly: hexCorners(c.x, c.y, HEX_R, elevationDeg),
      variant: i % 3,
      wheat: i % 5 === 0,
    })),
    centroid: { x: cx, y: cy },
    radius: Math.max(0, ...centres.map((p) => Math.hypot(p.x - cx, p.y - cy))) + HEX_R,
    treeSpot: { x: cx, y: cy },
  };
}

const CRITERIA = Array.from({ length: 8 }, (_, i) => ({
  id: `crit-${i}`,
  state: (['proven', 'pending', 'failing'] as const)[i % 3]!,
}));

const hero = (width: number, height: number): SceneGardenHero => ({ width, height, nodes: [] });
const HEROES = {
  cottage: hero(40, 34),
  gazebo: hero(30, 30),
  'autumn-tree': hero(56, 70),
  'stepping-stone': hero(12, 4),
} satisfies Record<GardenHeroId, SceneGardenHero>;

/** Where the nameplate's GROUND baseline sits, as a fraction of the island's ground radius.
 *
 *  The scatter draws candidates over `0.30–0.80 · R` of ground, so a baseline at `0.45 · R` cuts
 *  through the disc and the band DECIDES draws rather than sitting slack — which is the only way
 *  this suite can say anything about it. `plateBindsOnThisFixture` below asserts that it does,
 *  because a keep-out that never fires is a keep-out this file is not testing. */
const PLATE_AT = 0.45;

function territory(isl: Island, plate: 'in-range' | 'parked' = 'in-range'): SceneTerritoryInput {
  return {
    id: 'studio',
    status: 'healthy',
    caps: 3,
    // ⚠ THE TAG COSTS THIS FIXTURE NOTHING AND BUYS THE PLATE. The disc is symmetric about the
    // origin, so its centroid and tree spot are (0, 0) in BOTH spaces and projecting them is the
    // identity; `plants` and `decor` are empty and there are no parcels. So the only field the tag
    // actually moves is `labelY` — which is the field under test, and which has no honest ground
    // reading without it.
    anchorSpace: 'ground',
    centroid: isl.centroid,
    // The symmetric-disc fixture's `radius` is elevation-INVARIANT by construction (see `island()`'s
    // doc comment), so it stands in for both spaces here without weakening this suite's invariant.
    groundRadius: isl.radius,
    screenRadius: isl.radius,
    treeSpot: isl.treeSpot,
    // A GROUND baseline, projected by `buildScene` with the rest. `parked` keeps the pre-ADR-0545
    // shape for the falsifier below, which needs an arm where the band cannot be what differs.
    labelY:
      plate === 'parked' ? isl.centroid.y + 4000 : isl.centroid.y + PLATE_AT * isl.radius,
    coastGroundLoops: [],
    decor: [],
    plants: [],
    treeTitle: 'studio',
    wisps: [],
    uatCriteria: CRITERIA,
    plate: { w: 120, h: 30, rx: 7, idY: 13, subY: 25, idText: 's', subText: 's', title: 's' },
  };
}

/**
 * What `buildScene` actually hands `placeGardenHeroes`: the territory AFTER `anchorsToScreen`, every
 * anchor projected ONCE at the scene's camera.
 *
 * The two tests that call the export directly have to do that projection themselves. Handing it the
 * `ground`-tagged fixture instead would feed a ground baseline to a function whose entire contract
 * is screen space — the exact mistake this file fences, committed by the fence.
 */
function projectedTerritory(isl: Island, elevationDeg: number): SceneTerritoryInput {
  const t = territory(isl);
  const p = (q: Pt): Pt => projectGround(q, elevationDeg);
  return {
    ...t,
    anchorSpace: 'screen',
    centroid: p(t.centroid),
    treeSpot: p(t.treeSpot),
    labelY: p({ x: 0, y: t.labelY }).y,
  };
}

function sceneAt(
  elevationDeg: number,
  withGarden: boolean,
  plate: 'in-range' | 'parked' = 'in-range',
): SceneInput {
  const isl = island(elevationDeg);
  const input: SceneInput = {
    offset: { x: 0, y: 0 },
    width: 900,
    height: 900,
    empties: [],
    relaxedCells: isl.cells,
    drawTiles: [],
    wheatSets: [],
    trails: routeTrails([{ id: 'studio', x: isl.centroid.x, y: isl.centroid.y, r: isl.radius }], [], 'scatter'),
    territories: [territory(isl, plate)],
    cameraElevationDeg: elevationDeg,
  };
  // No garden ⇒ `garden` stays ABSENT, which is the non-garden composition.
  if (withGarden) input.garden = { islandId: 'studio', heroes: HEROES };
  return input;
}

// ---------- reading placements back out of the built scene ----------

const TRANSLATE = /translate\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)/;

function anchorOf(node: SceneNode): Pt | null {
  const m = node.transform ? TRANSLATE.exec(node.transform) : null;
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** Every placed thing in the scene, keyed by the id it carries, so two runs are compared mark by
 *  mark rather than by painter order. Markers key on their criterion id, stones and heroes on their
 *  `baked-use` id, and the two accent families on a synthetic key naming the family + its ordinal
 *  (they carry no id of their own). */
function placements(input: SceneInput) {
  const markers = new Map<string, Pt>();
  const stones = new Map<string, Pt>();
  const heroes = new Map<string, Pt>();
  const accents = new Map<string, Pt>();
  const childKinds = (n: SceneNode): string[] =>
    n.el === 'g' ? n.children.map((c) => String(c.kind ?? '')) : [];

  const walk = (node: SceneNode): void => {
    const kind = String(node.kind ?? '');
    const at = anchorOf(node);
    if (at) {
      if (kind.startsWith('tall-flower-')) markers.set(String(node.id ?? ''), at);
      else if (node.el === 'baked-use') {
        const id = String(node.id ?? '');
        if (id.startsWith('garden-walk') || id.startsWith('garden-step')) stones.set(id, at);
        else heroes.set(id, at);
      } else if (!kind) {
        const kinds = childKinds(node);
        if (kinds.includes('garden-grass-blade')) accents.set(`grass-${accents.size}`, at);
        else if (kinds.includes('garden-lavender-stem')) accents.set(`lavender-${accents.size}`, at);
      }
    }
    // `baked-def` children are DEFINITIONS, not placements — never walk into them.
    if (node.el === 'g') for (const c of node.children) walk(c);
  };
  walk(buildScene(input));
  return { markers, stones, heroes, accents };
}

/**
 * The one assertion this suite makes, in one place: the SAME set of marks, each at the SAME ground
 * spot, at every elevation in the sweep.
 *
 * "The same ground spot" is checked as the projection rather than by unprojecting: screen x carries no
 * camera term at all, so it must come back byte-identical, and screen y must be the plan-view value
 * times this elevation's flattening. Checking it that way also pins the DIRECTION of the change — a
 * mark that failed to foreshorten would pass an unprojected comparison against its own elevation.
 */
function assertGroundInvariant(family: string, byElevation: Map<number, Map<string, Pt>>): void {
  const plan = byElevation.get(PLAN_VIEW_ELEVATION_DEG)!;
  assert.ok(plan.size > 0, `${family}: the plan-view run placed nothing — the invariant would be vacuous`);
  for (const [deg, got] of byElevation) {
    assert.deepEqual(
      [...got.keys()].sort(),
      [...plan.keys()].sort(),
      `${family}: a ${deg} deg camera placed a DIFFERENT set of marks than the plan view ` +
        `(${got.size} vs ${plan.size}) — the island's ground did not change, so the marks must not`,
    );
    const f = groundFlattening(deg);
    for (const [id, p] of got) {
      const want = plan.get(id)!;
      assert.ok(
        Math.abs(p.x - want.x) < ROUNDING,
        `${family}/${id}: screen x moved from ${want.x} to ${p.x} at ${deg} deg — the q axis does not foreshorten`,
      );
      assert.ok(
        Math.abs(p.y - want.y * f) < ROUNDING,
        `${family}/${id}: at ${deg} deg the mark sits at screen y ${p.y}, but its ground y ` +
          `${want.y} projects to ${(want.y * f).toFixed(2)} — it is on a different patch of ground`,
      );
    }
  }
}

function sweep(withGarden: boolean): Map<number, ReturnType<typeof placements>> {
  const out = new Map<number, ReturnType<typeof placements>>();
  for (const deg of SWEEP) out.set(deg, placements(sceneAt(deg, withGarden)));
  return out;
}

const byFamily = (
  runs: Map<number, ReturnType<typeof placements>>,
  pick: (r: ReturnType<typeof placements>) => Map<string, Pt>,
): Map<number, Map<string, Pt>> => new Map([...runs].map(([deg, r]) => [deg, pick(r)]));

// ---------- site 1: the UAT-flower scatter (`buildUatMarkers`) ----------

test('every UAT criterion places, and places on the same GROUND spot, at every camera', () => {
  const runs = sweep(false);
  const markers = byFamily(runs, (r) => r.markers);
  for (const [deg, m] of markers) {
    assert.equal(
      m.size,
      CRITERIA.length,
      `${deg} deg: ${m.size} of ${CRITERIA.length} criteria placed — a criterion must never be lost to the camera`,
    );
  }
  assertGroundInvariant('uat-marker', markers);
});

test('the UAT scatter assertion has TEETH: the marks DO foreshorten on screen', () => {
  // Without this control the invariant above would also hold for a scatter that ignored the camera
  // entirely and drew every mark at its plan-view screen position — which is the bug, not the fix.
  const plan = placements(sceneAt(PLAN_VIEW_ELEVATION_DEG, false)).markers;
  const land = placements(sceneAt(LAND_CAMERA_ELEVATION_DEG, false)).markers;
  const spanOf = (m: Map<string, Pt>): number => {
    const ys = [...m.values()].map((p) => p.y);
    return Math.max(...ys) - Math.min(...ys);
  };
  const planSpan = spanOf(plan);
  assert.ok(planSpan > 1, 'the plan-view scatter must actually spread in y for this control to mean anything');
  const ratio = spanOf(land) / planSpan;
  const want = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  assert.ok(
    Math.abs(ratio - want) < 0.02,
    `the scatter's screen y-span shrank by ${ratio.toFixed(3)} at the declared camera; the ground it ` +
      `covers foreshortens by ${want.toFixed(3)}, so anything else means the marks are not on the ground`,
  );
});

test('the UAT scatter assertion has TEETH: the PRE-CAMERA rule is camera-DEPENDENT on this island', () => {
  // The falsifier. The pre-camera sampler — isotropic screen distances, the inherited 0.7 y-squash —
  // reproduced here off the REAL seed stream and run over the SAME ground island at two cameras. If it
  // happened to be elevation-invariant too, the property under test would be discriminating nothing
  // and the suite above could pass without the fix.
  //
  // MEASURED, not assumed, and it corrects a plausible-sounding story: the isotropic screen metric
  // never ADMITS a placement the ground metric would reject, because dividing a y-delta by `sin θ` can
  // only make a gap larger — `groundGap >= hypot` always. It fails the other way, by OVER-enforcing:
  // at the declared camera a `hypot > 15` screen test is a `> 15 / sin 50° ≈ 19.6` ground test, so the
  // sampler is silently asking for ~1.3x the room its own constants name (ADR-0593 shrank this from
  // ~2.9x at the original 20° camera, where `1 / sin 20° ≈ 2.92`), which is what exhausts the draws
  // on a tight or concave island and relocates the mark onto a cell centroid. On the roomy convex
  // disc below it does NOT exhaust them — so this control asserts the mechanism (different ground,
  // inflated keep-out) rather than a starvation this fixture does not exhibit.
  const preCamera = (elevationDeg: number): string[] => {
    const isl = island(elevationDeg);
    const t = territory(isl);
    const f = groundFlattening(elevationDeg);
    const inCell = (x: number, y: number): boolean =>
      isl.cells.some((c) => {
        let inside = false;
        for (let i = 0, j = c.poly.length - 1; i < c.poly.length; j = i++) {
          const a = c.poly[i]!;
          const b = c.poly[j]!;
          if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
        }
        return inside;
      });
    const placed: Pt[] = [];
    for (const c of CRITERIA) {
      // The real seed stream (`hash`/`rand01` off the same key the scatter uses), so what differs
      // between this and the shipped placement is the SPACE the distances are measured in and nothing
      // else. A hand-rolled stream here would make this a different sampler rather than the old one.
      const k = hash(`studio:marker:${c.id}`);
      let x = t.centroid.x;
      let y = t.centroid.y;
      let settled = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const ang = rand01(k + attempt * 2) * Math.PI * 2;
        const rr = (0.3 + rand01(k + attempt * 2 + 1) * 0.5) * t.screenRadius;
        x = t.centroid.x + Math.cos(ang) * rr;
        y = t.centroid.y + Math.sin(ang) * rr * 0.7; // the inherited squash
        const clearsTree = Math.hypot(x - t.treeSpot.x, y - t.treeSpot.y) > 36; // isotropic SCREEN
        const clearsSpacing = placed.every((p) => Math.hypot(x - p.x, y - p.y) > 15); // isotropic SCREEN
        if (clearsTree && clearsSpacing && inCell(x, y)) {
          settled = true;
          break;
        }
      }
      void settled; // the roomy fixture always settles; the starvation case is a tight island
      placed.push({ x, y });
    }
    return placed.map((p) => `${p.x.toFixed(1)},${(p.y / f).toFixed(1)}`);
  };
  assert.notDeepEqual(
    preCamera(LAND_CAMERA_ELEVATION_DEG),
    preCamera(PLAN_VIEW_ELEVATION_DEG),
    'the pre-camera sampler must be camera-dependent — if it were not, this suite would be proving nothing',
  );
  // The inflation, stated on the two metrics themselves so it cannot depend on which samples happened
  // to win: a purely north–south pair 15 SCREEN pixels apart at the declared camera stands this far
  // apart on the ground. That ratio IS the defect's magnitude — `1 / sin 50° ≈ 1.305`, so the
  // threshold below is `1.3`, just under the exact value the way `2.9` sat just under `1 / sin 20°`.
  const demanded = 15 / groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  assert.ok(
    demanded > 15 * 1.3,
    `a 15 px screen keep-out only demands ${demanded.toFixed(1)} ground units at the declared camera — ` +
      'if that inflation were small, measuring in the wrong space would not lose marks and this suite ' +
      'would be fencing nothing',
  );
});

test('the NAMEPLATE BAND has TEETH: it binds on this fixture, and the SCREEN band it replaced was camera-dependent', () => {
  // ⚠ THE WHOLE POINT OF UN-PARKING THE PLATE. Bringing the band into range proves nothing unless it
  // actually DECIDES draws — a keep-out that never fires would let the invariant above pass with the
  // band computed any way at all, which is how it came to be exempt in the first place.
  //
  // Both halves are measured off the REAL seed stream at the REAL constants, so the only thing that
  // differs between this and the shipped scatter is the SPACE the band is measured in.
  const isl = island(LAND_CAMERA_ELEVATION_DEG);
  const t = territory(isl);
  const ART = SHIPPED_TILE_ART;

  /** Every candidate the sampler would draw for one criterion, in GROUND coordinates. */
  const candidates = (criterionId: string): Pt[] => {
    const k = hash(`studio:marker:${criterionId}`);
    return Array.from({ length: 20 }, (_, attempt) => {
      const ang = rand01(k + attempt * 2) * Math.PI * 2;
      const rr = (0.3 + rand01(k + attempt * 2 + 1) * 0.5) * t.groundRadius;
      return { x: t.centroid.x + Math.cos(ang) * rr, y: t.centroid.y + Math.sin(ang) * rr };
    });
  };

  // (a) THE BAND BINDS. Some candidate this fixture draws falls south of the plate's ground line, so
  //     the band is what rejected it rather than sitting slack 4000 units away.
  const cut = t.labelY - ART.units(14);
  const rejected = CRITERIA.flatMap((c) => candidates(c.id)).filter((p) => p.y >= cut);
  assert.ok(
    rejected.length > 0,
    `the plate at ground y ${t.labelY.toFixed(1)} rejected none of the 20x${CRITERIA.length} candidates — ` +
      'the band is slack on this fixture and the invariant above is not testing it',
  );

  // (b) AND THE RULE IT REPLACED READ THE CAMERA. The pre-ADR-0545 band compared a projected
  //     candidate against an UNPROJECTED baseline, so the ground line it drew moved with the angle:
  //     the same ground y passes at one elevation and fails at another. Stated on the rule itself
  //     rather than on which samples happened to win, so it cannot go quiet if the fixture shifts.
  const screenBandGroundCut = (deg: number): number =>
    // what `y < labelY - units(14)` meant on the ground, once both sides are read in ground terms
    (t.labelY * groundFlattening(deg) - ART.units(14)) / groundFlattening(deg);
  const atDeclared = screenBandGroundCut(LAND_CAMERA_ELEVATION_DEG);
  const atPlan = screenBandGroundCut(PLAN_VIEW_ELEVATION_DEG);
  // The gap is exact, not a guess: `screenBandGroundCut` subtracts a fixed SCREEN offset before
  // dividing back by `sin θ`, so the two cuts differ by exactly `units(14) · |1/sin θ − 1|`. At the
  // declared 50° camera `1/sin 50° ≈ 1.305`, so the gap is `≈0.305 · units(14)` — far smaller than
  // the `≈1.924 · units(14)` it was at the original 20° camera (`1/sin 20° ≈ 2.924`), because the
  // flatter camera used to do the over-enforcing. `0.3` sits just under the exact 0.305, the same
  // margin-below-derivation the `1.3` / `2.9` thresholds above use.
  assert.ok(
    Math.abs(atDeclared - atPlan) > ART.units(14) * 0.3,
    `the screen band drew the same ground line at both cameras (${atDeclared.toFixed(1)} vs ` +
      `${atPlan.toFixed(1)}) — if it did, replacing it would have been a rename`,
  );
  // And the direction, which is the half a magnitude alone cannot give: the screen band was STRICTER
  // the flatter the camera, so it is the low elevations that lost markers off their ground spots.
  assert.ok(atDeclared < atPlan, 'the screen band must tighten as the camera drops');
});

test('the nameplate band DECIDES placements — moving the plate moves the marks it stands in front of', () => {
  // ⚠ THE TEETH THE INVARIANT CANNOT GROW ITSELF, and the mutation rung is what named the gap. A band
  // that always returns TRUE is camera-independent too, so every assertion above passes with the
  // keep-out deleted. The only statement that separates the two is a DIFFERENCE: hold the island, the
  // criteria and the seed stream fixed, move nothing but the plate's ground line, and the marks it
  // stands in front of must go somewhere else.
  //
  // It also fences the SIGN. A band that added its clearance instead of subtracting it would sit
  // further south than the plate — a keep-out that keeps nothing out — and would collapse onto the
  // parked arm here.
  const inRange = placements(sceneAt(LAND_CAMERA_ELEVATION_DEG, false, 'in-range')).markers;
  const parked = placements(sceneAt(LAND_CAMERA_ELEVATION_DEG, false, 'parked')).markers;
  assert.deepEqual(
    [...inRange.keys()].sort(),
    [...parked.keys()].sort(),
    'both arms must place the same criteria — the band relocates a mark, it never loses one',
  );
  const moved = [...inRange].filter(([id, p]) => {
    const q = parked.get(id)!;
    return Math.hypot(p.x - q.x, p.y - q.y) > 1;
  });
  assert.ok(
    moved.length > 0,
    'the plate at ' +
      `${PLATE_AT} x R placed every marker exactly where a plate 4000 units away did — the band is ` +
      'deciding nothing, so nothing above is testing it',
  );
});

test('the garden HERO band decides placements too — the same difference, at the other site', () => {
  // `placeGardenHeroes` has its own band at a wider clearance, and its own mutants. Same shape as the
  // marker test above: the only thing that differs between the arms is where the plate stands.
  const inRange = placements(sceneAt(LAND_CAMERA_ELEVATION_DEG, true, 'in-range')).heroes;
  const parked = placements(sceneAt(LAND_CAMERA_ELEVATION_DEG, true, 'parked')).heroes;
  assert.ok(inRange.size > 0, 'the garden must place heroes for this to compare anything');
  assert.deepEqual([...inRange.keys()].sort(), [...parked.keys()].sort(), 'the same heroes either way');
  const moved = [...inRange].filter(([id, p]) => {
    const q = parked.get(id)!;
    return Math.hypot(p.x - q.x, p.y - q.y) > 1;
  });
  assert.ok(
    moved.length > 0,
    'a hero stood in the same spot whether the plate was in front of it or 4000 units away — the ' +
      "garden's own band is deciding nothing",
  );
});

// ---------- site 2: the garden heroes (`placeGardenHeroes`, exported) ----------

test('placeGardenHeroes puts a hero on the same GROUND spot at every camera', () => {
  const ids: GardenHeroId[] = ['cottage', 'gazebo'];
  const halfW = new Map<GardenHeroId, number>([
    ['cottage', 12],
    ['gazebo', 9],
  ]);
  const byDeg = new Map<number, Map<string, Pt>>();
  for (const deg of SWEEP) {
    const isl = island(deg);
    const spots = placeGardenHeroes(projectedTerritory(isl, deg), ids, halfW, isl.cells, 16, deg);
    assert.equal(spots.size, ids.length, `${deg} deg: a hero was dropped`);
    byDeg.set(deg, new Map([...spots].map(([id, p]) => [id, p])));
  }
  assertGroundInvariant('garden-hero', byDeg);
});

test('the hero placement has TEETH: the same call at the WRONG camera moves the hero off its ground spot', () => {
  // `placeGardenHeroes` takes the elevation its geometry was projected at. Hand it the island at the
  // declared camera but tell it the land is flat — the pre-camera state exactly — and it must place
  // somewhere else. If it did not, the parameter would be decorative.
  const ids: GardenHeroId[] = ['cottage', 'gazebo'];
  const halfW = new Map<GardenHeroId, number>([
    ['cottage', 12],
    ['gazebo', 9],
  ]);
  const isl = island(LAND_CAMERA_ELEVATION_DEG);
  const t = projectedTerritory(isl, LAND_CAMERA_ELEVATION_DEG);
  const honest = placeGardenHeroes(t, ids, halfW, isl.cells, 16, LAND_CAMERA_ELEVATION_DEG);
  const blind = placeGardenHeroes(t, ids, halfW, isl.cells, 16, PLAN_VIEW_ELEVATION_DEG);
  const moved = ids.filter((id) => {
    const a = honest.get(id)!;
    const b = blind.get(id)!;
    return Math.hypot(a.x - b.x, a.y - b.y) > 1;
  });
  assert.ok(
    moved.length > 0,
    'a placement told the land is flat when it is angled must land somewhere else — otherwise the camera is not being read',
  );
});

// ---------- sites 3 + 4 and the stone walk: the whole garden composition ----------

test('the garden lays the same NUMBER of stepping stones, on the same ground, at every camera', () => {
  // This is the site that LOST marks rather than moving them: the stone count is a leg length divided
  // by a spacing, and the leg was measured in screen pixels while the spacing was a ground fraction.
  const runs = sweep(true);
  const stones = byFamily(runs, (r) => r.stones);
  const counts = [...stones].map(([deg, s]) => `${deg}:${s.size}`);
  const first = stones.get(PLAN_VIEW_ELEVATION_DEG)!.size;
  for (const [deg, s] of stones) {
    assert.equal(
      s.size,
      first,
      `the stone walk laid ${s.size} stones at ${deg} deg and ${first} in plan view (${counts.join(' ')}) — ` +
        `a path's length is a property of the island, not of the camera`,
    );
  }
  assert.ok(first >= 4, `only ${first} stones in the fixture walk — too few for the count to mean anything`);
  assertGroundInvariant('stone', stones);
});

test('the garden heroes and both accent families hold their ground spots at every camera', () => {
  // The heroes cover `footprintOnLand` (site 2) and `islandLandfall` (site 3) — the landfall feeds the
  // walk's first waypoint, so a landfall that moved would move every stone with it. The accents cover
  // `towardLand` (site 4): its walk back toward the centroid is a FRACTION of a segment, which
  // commutes with the affine projection, so it needed no camera term — this is the assertion that
  // proves that claim instead of asserting it in a comment.
  const runs = sweep(true);
  assertGroundInvariant('garden-hero', byFamily(runs, (r) => r.heroes));
  assertGroundInvariant('accent', byFamily(runs, (r) => r.accents));
});

test('the whole-scene invariant has TEETH: an island at a camera the scene is not told about drifts', () => {
  // The vacuity control for the two tests above: project the ground FLAT but declare the angled
  // camera. That is the mismatch the increment removes, wearing the opposite sign, and every
  // placement must land somewhere the honest run does not.
  const flat = island(PLAN_VIEW_ELEVATION_DEG);
  const mismatched: SceneInput = {
    ...sceneAt(PLAN_VIEW_ELEVATION_DEG, true),
    territories: [territory(flat)],
    relaxedCells: flat.cells,
    cameraElevationDeg: LAND_CAMERA_ELEVATION_DEG,
  };
  const honest = placements(sceneAt(PLAN_VIEW_ELEVATION_DEG, true));
  const lied = placements(mismatched);
  const differs =
    [...honest.markers].some(([id, p]) => {
      const q = lied.markers.get(id);
      return !q || Math.hypot(p.x - q.x, p.y - q.y) > 1;
    }) || honest.stones.size !== lied.stones.size;
  assert.ok(
    differs,
    'a scene whose declared camera disagrees with its geometry must place differently — if it did not, ' +
      'nothing in this suite would be reading the camera at all',
  );
});
