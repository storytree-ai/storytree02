// map-dressing.test.ts — THE ACCEPTANCE QUESTION IS A COUNT, NOT A PICTURE.
//
// ⚠⚠ The defect this module exists to prevent is INVISIBLE. A map that scatters one story's signed
// UAT criteria over its neighbours' islands draws perfectly ordinary islands wearing perfectly
// ordinary flowers; nothing in the frame says which story signed what. So the tests below assert
// ATTRIBUTION — every bloom on an island belongs to the story that island represents, and the
// map's total equals the number of criteria the scene actually signs.
//
// ⚠⚠ AND THEY DO IT ON A FIXTURE WITH TWO STORIES, which is the whole point: a one-island fixture
// is satisfied by a dressing that ignores attribution entirely, which is exactly the dressing this
// module replaced. The two stories sign DIFFERENT numbers of criteria, so a count that came from
// the wrong island is a different number rather than a coincidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRelaxedCells,
  buildScene,
  hexCenter,
  type SceneInput,
  type SceneParcelInput,
  type SceneStatus,
  type SceneTerritoryInput,
  PRE_ADR0528_TILE,
} from '@storytree/forest-world';

import { SHIPPED_COAST, clipToCoast } from './coast-clip.js';
import { islandPaths, islandRims } from './island-path.js';
import { COVER_DENSITY, COVER_DENSITY_RUNGS, COVER_SIZE, COVER_SIZE_RUNGS } from './cover-dressing.js';
import {
  DRESSING_BEACH,
  DRESSING_WEAR_CEILING,
  RECIPE_ISLAND_AREA,
  beachClear,
  crossingIsRight,
  crossingX,
  dressingExclusion,
  insideRing,
  islandExclusion,
  pathClear,
  straddles,
} from './dressing-ground.js';
import { criteriaByIsland, dressMapFromKit, dressMapWithCover, signedCriteriaByIsland } from './map-dressing.js';
import * as mapDressing from './map-dressing.js';
import { KIT_FOOTPRINTS_2026_08_29, isCriterionRole, isDressingRole, type KitPlacement } from './kit-vocabulary.js';
import * as kitVocabulary from './kit-vocabulary.js';
import { groundDependencyKey, sameGroundDependencies } from './ground-dependency.js';
import { LAND_RELIEF_AMPLITUDE } from './land-relief.js';
import { landHeight } from './land-relief.js';
import { WEAR_FALLOFF, wearOf } from './land-wear.js';
import { shoreField } from './shore-fall.js';
import { wearField } from './trail-wear.js';
import type { GPoint } from './parcel-cells.js';
import { worldTo3D, type CoverageFloraDescriptor, type Descriptor3D, type InstanceDescriptor } from './world-to-3d.js';

const isCapabilityTreeRole = (role: string): boolean => {
  const selector = (kitVocabulary as typeof kitVocabulary & {
    isCapabilityTreeRole?: (candidate: string) => boolean;
  }).isCapabilityTreeRole;
  return selector?.(role) ?? false;
};

const isCoverageRole = (role: string): boolean => {
  const selector = (kitVocabulary as typeof kitVocabulary & {
    isCoverageRole?: (candidate: string) => boolean;
  }).isCoverageRole;
  return selector?.(role) ?? false;
};

/** The fixtures here draw on the TUNED tile (ADR-0528), like the harness island: every number this
 *  file pins was derived on it, and the 3D mapper sizes the islands to the ratio either way. */
const TUNED_LATTICE = { hexR: PRE_ADR0528_TILE.hexR } as const;
const TUNED_TILE = { hexR: PRE_ADR0528_TILE.hexR } as const;

const FOOT = KIT_FOOTPRINTS_2026_08_29;

/** `InstanceDescriptor` still admits every `InstanceKind`, so `kind` alone cannot narrow the
 * union here. The mapper's coverage wrapper has this complete typed payload. */
function isCoverageFloraDescriptor(descriptor: Descriptor3D): descriptor is CoverageFloraDescriptor {
  if (descriptor.kind !== 'coverage-flora'
    || !('capability' in descriptor)
    || !('island' in descriptor)
    || !('theme' in descriptor)
    || !('floraScale' in descriptor)) return false;
  return typeof descriptor.capability === 'string'
    && typeof descriptor.island === 'string'
    && typeof descriptor.material === 'string'
    && typeof descriptor.theme === 'string'
    && typeof descriptor.floraScale === 'number';
}

// ---------------------------------------------------------------------------
// FAIL FAST BEFORE THE EXPENSIVE CALL (`mutation-rung-scores-a-hang-as-unproven` §3, 2026-09-05).
// A mutant that makes the ray cast or the exclusion refuse every point does not fail an assertion
// in the cover's sampler — it makes every prop burn its 400 tries and the scatter grind past the
// mutation rung's per-mutant budget, scored UNPROVEN. So every test that scatters cover opens with
// these microsecond probes; under such a mutant it fails HERE and the grind never starts. The
// hostile fixtures that separate the ray cast from its plausible variants are
// `dressing-ground.test.ts`'s; these are only the cheapest probes each hot-loop mutant fails.
// (Inlined rather than imported from `harness/ground-sanity.ts`: `src/` never imports the harness.)
// ---------------------------------------------------------------------------

const SANITY_SQUARE: readonly GPoint[] = [{ x: 10, z: 10 }, { x: 20, z: 10 }, { x: 20, z: 20 }, { x: 10, z: 20 }];
const SANITY_RIM: InstanceDescriptor = {
  kind: 'cell-ground',
  transform: { x: 100, y: 0, z: 50 },
  group: 'cell-ground',
  material: 'healthy',
  island: 'sanity',
  parcel: 'sanity-cap',
  points: [
    { x: 0, y: 0, z: 0 },
    { x: 200, y: 0, z: 0 },
    { x: 200, y: 0, z: 100 },
    { x: 0, y: 0, z: 100 },
  ],
};

function groundSanity(): void {
  assert.equal(insideRing(SANITY_SQUARE, { x: 15, z: 15 }), true, 'ground-sanity: the ray cast refuses the middle of a square');
  assert.equal(insideRing(SANITY_SQUARE, { x: 25, z: 15 }), false, 'ground-sanity: the ray cast admits a point outside');
  assert.equal(straddles({ x: 0, z: 8 }, { x: 10, z: 2 }, 5), true, 'ground-sanity: straddles');
  assert.equal(crossingX({ x: 100, z: -2 }, { x: 107, z: 5 }, 0), 102, 'ground-sanity: crossingX');
  assert.equal(crossingIsRight(1, 2) && !crossingIsRight(3, 2), true, 'ground-sanity: crossingIsRight');
  assert.equal(beachClear(DRESSING_BEACH) && !beachClear(0), true, 'ground-sanity: beachClear');
  assert.equal(pathClear(100) && !pathClear(0), true, 'ground-sanity: pathClear');
  const ex = dressingExclusion([SANITY_RIM], [[{ x: 20, z: 50 }, { x: 180, z: 50 }]]);
  assert.equal(ex.clear(100, 20), true, 'ground-sanity: the exclusion refuses clear ground');
  assert.equal(ex.clear(DRESSING_BEACH / 2, 50) || ex.clear(100, 50), false, 'ground-sanity: the exclusion admits the beach or the path');
}

// ---------------------------------------------------------------------------
// a TWO-STORY map — the smallest fixture that can catch the defect
// ---------------------------------------------------------------------------

/** Two islands, far enough apart that no cell of one is nearer a seed of the other. */
const TILES_A = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
] as const;
const TILES_B = [
  { q: 9, r: 0 },
  { q: 10, r: 0 },
  { q: 9, r: 1 },
] as const;

const STORY_A = 'atlas';
const STORY_B = 'beacon';

/** `signed` criteria proven, then `failing` witnessed failing, and the rest pending — so a bloom
 *  count is not the criteria count, which is exactly the distinction ADR-0600 turned into three
 *  drawn forms rather than one drawn and two absent.
 *
 *  ⚠ `failing` DEFAULTS TO ZERO AND ONE TEST BELOW FLIPS IT. The live corpus holds no failing
 *  criterion today, so a fixture that could not produce one would leave the whole `uat-wilt` path
 *  — the mapper's case, the count, the placement — standing on a value that is permanently zero,
 *  which is a path nothing proves rather than a path nothing needs. */
function criteria(prefix: string, total: number, signed: number, failing = 0) {
  return Array.from({ length: total }, (_, i) => ({
    id: `${prefix}-uat-${i}`,
    state: (i < signed ? 'proven' : i < signed + failing ? 'failing' : 'pending') as
      | 'proven'
      | 'pending'
      | 'failing',
  }));
}

function territory(
  id: string,
  tiles: readonly { q: number; r: number }[],
  caps: readonly string[],
  uat: { total: number; signed: number; failing?: number },
  status: SceneStatus = 'healthy',
): SceneTerritoryInput {
  const centres = tiles.map((h) => hexCenter(h, TUNED_LATTICE));
  const cx = centres.reduce((s, c) => s + c.x, 0) / centres.length;
  const cy = centres.reduce((s, c) => s + c.y, 0) / centres.length;
  const parcels: SceneParcelInput[] = caps.map((capId, i) => ({
    capId,
    status,
    testCount: 3,
    theme: 'meadow',
    seed: hexCenter(tiles[i % tiles.length]!, TUNED_LATTICE),
  }));
  return {
    id,
    status,
    caps: parcels.length,
    centroid: { x: cx, y: cy },
    groundRadius: 70,
    screenRadius: 24,
    treeSpot: { x: cx, y: cy - 6 },
    labelY: cy + 46,
    coastGroundLoops: [],
    decor: [],
    plants: [],
    treeTitle: id,
    wisps: [],
    parcels,
    uatCriteria: criteria(id, uat.total, uat.signed, uat.failing ?? 0),
    plate: { w: 120, h: 33, rx: 7, idY: 14, subY: 27, idText: id, subText: id, title: id },
  };
}

/**
 * MEMOISED, and it is a `check:mutation-diff` requirement rather than an optimisation.
 *
 * ⚠⚠ THE RUNG'S VERDICT MOVES WITH THE SUITE'S WALL CLOCK. Stryker runs the covering tests once per
 * mutant against a per-mutant timeout; an assertion that kills a mutant in 20 ms on a quiet box
 * kills nothing at all on a loaded CI runner that never reaches it, and the mutant comes back
 * `Timeout` — which the rung scores UNPROVEN with the same "no test named" line an attribution gap
 * produces. Measured on this branch: five CI runs of an unchanged local-green tree reported 2, 2, 2,
 * 6 and then 31 unproven mutants — a MOVING set, which is the tell (`mutation-rung-scores-a-hang-as-unproven`
 * §9), and the 31-run followed a change that made the suite slower rather than any change to the
 * subject.
 *
 * `buildRelaxedCells` + `buildScene` + `worldTo3D` over two islands is most of this file's cost and
 * it is PURE, so the same arguments may return the same array. ⚠ Callers must not mutate it.
 */
const MAPS = new Map<string, Descriptor3D[]>();

/** The two-story map's descriptors — the shipped relaxed-MESH substrate, the one the studio emits. */
function twoStoryMap(
  a: { total: number; signed: number; failing?: number } = { total: 6, signed: 4 },
  b: { total: number; signed: number; failing?: number } = { total: 5, signed: 2 },
): Descriptor3D[] {
  const key = `${a.total}/${a.signed}/${a.failing ?? 0}|${b.total}/${b.signed}/${b.failing ?? 0}`;
  const cached = MAPS.get(key);
  if (cached) return cached;
  const drawTiles = [
    ...TILES_A.map((h) => ({ h, owner: 0 })),
    ...TILES_B.map((h) => ({ h, owner: 1 })),
  ];
  const wheatSets = [new Set<string>(), new Set<string>()];
  const input: SceneInput = {
    offset: { x: 0, y: 0 },
    width: 1600,
    height: 900,
    empties: [],
    relaxedCells: buildRelaxedCells(drawTiles, wheatSets, 'mesh', TUNED_LATTICE),
    drawTiles,
    wheatSets,
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: [
      territory(STORY_A, TILES_A, ['atlas-parse', 'atlas-store'], a),
      territory(STORY_B, TILES_B, ['beacon-emit'], b),
    ],
    vegetation: {},
    tile: TUNED_TILE,
  };
  const built = worldTo3D(buildScene(input));
  MAPS.set(key, built);
  return built;
}

const dress = (descriptors: readonly Descriptor3D[]) =>
  dressMapFromKit(descriptors, { relief: LAND_RELIEF_AMPLITUDE, footprint: FOOT });

/**
 * THE SIGNATURE COUNT, ASSERTED AS A WHOLE MAP — a cheap witness repeated across the tests below.
 *
 * ⚠⚠ IT IS REPEATED ON PURPOSE, and the reason is the rung rather than the reader. The line it
 * witnesses is `if (d.kind !== 'uat-bloom') continue` — the filter that keeps GROUND out of a count
 * of SIGNATURES. Mutate it either way and every cell-ground descriptor becomes a signature, so this
 * map goes from a handful to hundreds. Both mutants are killed by any one of these calls; CI's Bun
 * reporter could name NO killing test for either, twice, while every other mutant on the branch
 * resolved at least one. A mutant killed by many independent tests survives that reporter's
 * name-resolution gaps; a mutant killed by one does not.
 */
const assertSignatures = (map: readonly Descriptor3D[], want: Record<string, number>): void => {
  assert.deepEqual(Object.fromEntries(signedCriteriaByIsland(map)), want);
};

// ---------------------------------------------------------------------------
// the fixture is honest before anything is asserted about the dressing
// ---------------------------------------------------------------------------

test('NON-VACUITY: the fixture really is two islands, with cells and signatures on each', () => {
  groundSanity();
  // ⚠ A fixture that quietly produced ONE island — or no ground — would let every attribution
  // assertion below pass while proving nothing, which is exactly the shape the whole-map dressing
  // survived for a month.
  const map = twoStoryMap();
  const islands = new Set(
    map.filter((d) => d.kind === 'cell-ground').map((d) => (d.kind === 'skipped' ? '' : d.island)),
  );
  assert.deepEqual([...islands].sort(), [STORY_A, STORY_B], 'two islands, both named');
  for (const story of [STORY_A, STORY_B]) {
    const cells = map.filter((d) => d.kind === 'cell-ground' && d.island === story);
    assert.ok(cells.length > 3, `${story} drew only ${cells.length} cells`);
  }
  // ⚠ The same ground the count must NOT include. Asserting both here is what makes this a
  // non-vacuity check for the filter as well as for the fixture.
  assertSignatures(map, { [STORY_A]: 4, [STORY_B]: 2 });
});

// ---------------------------------------------------------------------------
// the count
// ---------------------------------------------------------------------------

test('each story signs its OWN criteria — the count is per island, and the two differ', () => {
  groundSanity();
  const signed = signedCriteriaByIsland(twoStoryMap({ total: 6, signed: 4 }, { total: 5, signed: 2 }));
  assert.equal(signed.get(STORY_A), 4, 'atlas signed four of its six');
  assert.equal(signed.get(STORY_B), 2, 'beacon signed two of its five');
  assert.equal(signed.size, 2, 'and no third island appeared');
});

test('an UNSIGNED criterion is not counted — the map may not invent a signature', () => {
  groundSanity();
  // ADR-0392 D5 / ADR-0398 D7: a unit reads as the state it holds and as no other. The scene
  // carries all eleven criteria either way; only the four PROVEN ones are signatures.
  const none = signedCriteriaByIsland(twoStoryMap({ total: 6, signed: 0 }, { total: 5, signed: 0 }));
  assert.equal(none.size, 0, 'nothing signed anywhere, so nothing counted anywhere');
  const all = signedCriteriaByIsland(twoStoryMap({ total: 6, signed: 6 }, { total: 5, signed: 5 }));
  assert.equal(all.get(STORY_A), 6);
  assert.equal(all.get(STORY_B), 5);
});

test('⚠⚠ EVERY BLOOM STANDS ON THE ISLAND OF THE STORY THAT SIGNED IT', () => {
  groundSanity();
  // ⚠⚠ THE ASSERTION THIS MODULE EXISTS FOR. Nothing in a rendered frame says which story a
  // flower belongs to, so this is asked of the geometry: a bloom placed for atlas must land inside
  // atlas's own ground, and atlas's ground and beacon's do not overlap.
  const map = twoStoryMap({ total: 6, signed: 4 }, { total: 5, signed: 2 });
  assertSignatures(map, { [STORY_A]: 4, [STORY_B]: 2 });
  const placements = dress(map);
  const blooms = placements.filter((p) => p.role === 'bloom');
  assert.equal(blooms.length, 6, 'four signatures on atlas and two on beacon');

  const boundsOf = (story: string) => {
    const xs = map
      .filter((d) => d.kind === 'cell-ground' && d.island === story)
      .flatMap((d) => (d.kind === 'skipped' ? [] : (d.points ?? []).map((p) => p.x)));
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const a = boundsOf(STORY_A);
  const b = boundsOf(STORY_B);
  assert.ok(a.max < b.min, 'the fixture keeps the two islands disjoint in x');

  // Four blooms in atlas's span, two in beacon's, and none in the gap between them.
  const inA = blooms.filter((p) => p.at.x >= a.min && p.at.x <= a.max);
  const inB = blooms.filter((p) => p.at.x >= b.min && p.at.x <= b.max);
  assert.equal(inA.length, 4, `atlas signed four; ${inA.length} flowers stand on it`);
  assert.equal(inB.length, 2, `beacon signed two; ${inB.length} flowers stand on it`);
  assert.equal(inA.length + inB.length, blooms.length, 'no bloom stands off both islands');
});

test('a story that signed NOTHING grows no OPEN flower, even beside one that signed everything', () => {
  groundSanity();
  // ⚠ THE FAILURE THAT MOTIVATED THE UNIT, stated as a test: under the whole-map dressing, six
  // signatures held by atlas were scattered over every cell on the map, so beacon — which had
  // signed nothing — grew flowers. The picture asserted a signature nobody gave.
  //
  // ⚠ THE TITLE SAID "GROWS NOTHING" UNTIL 2026-09-23, and correcting it is not a weakening. Under
  // ADR-0600 beacon grows FIVE BUDS, because it holds five criteria nobody has signed and the map
  // now says so. What may never cross the water is a SIGNATURE, and that is what this asserts —
  // the fence is unchanged and its subject is narrower than the old wording implied.
  const map = twoStoryMap({ total: 6, signed: 6 }, { total: 5, signed: 0 });
  assertSignatures(map, { [STORY_A]: 6 });
  const placements = dress(map);
  const blooms = placements.filter((p) => p.role === 'bloom');
  assert.equal(blooms.length, 6);
  const bXs = map
    .filter((d) => d.kind === 'cell-ground' && d.island === STORY_B)
    .flatMap((d) => (d.kind === 'skipped' ? [] : (d.points ?? []).map((p) => p.x)));
  const bMin = Math.min(...bXs);
  for (const bloom of blooms) {
    assert.ok(bloom.at.x < bMin, `a bloom stood on the story that signed nothing (x=${bloom.at.x})`);
  }
  // And the five it DOES grow are buds, all of them on its own side of the water.
  const buds = placements.filter((p) => p.role === 'bud');
  assert.equal(buds.length, 5, 'beacon holds five unsigned criteria and draws five');
  for (const bud of buds) assert.ok(bud.at.x >= bMin, `a bud crossed onto the story that holds none`);
});

// ---------------------------------------------------------------------------
// ADR-0600 — the count is the CRITERION count, per island
// ---------------------------------------------------------------------------

test('⚠⚠ AN ISLAND\'S FLOWER COUNT IS ITS CRITERION COUNT — and each island gets its OWN', () => {
  groundSanity();
  // ⚠⚠ THE WHOLE-MAP HALF OF ADR-0600 D2. The defect it closes is invisible in a picture: an
  // island drawing four flowers over six criteria looks exactly like an island with four criteria,
  // and reads as FULLY PROVEN. So the property is asserted as a total per island, in both roles,
  // rather than as "buds appear somewhere".
  const map = twoStoryMap({ total: 6, signed: 4 }, { total: 5, signed: 2 });
  const placements = dress(map);
  const criteria = placements.filter((p) => isCriterionRole(p.role));
  assert.equal(criteria.length, 11, 'six criteria on atlas and five on beacon, all drawn');
  assert.equal(placements.filter((p) => p.role === 'bloom').length, 6, 'the four + two signed');
  assert.equal(placements.filter((p) => p.role === 'bud').length, 5, 'the two + three unsigned');

  // ⚠ AND PER ISLAND, which is the claim a whole-map total cannot make: eleven flowers could be
  // eleven on one island.
  const boundsOf = (story: string) => {
    const xs = map
      .filter((d) => d.kind === 'cell-ground' && d.island === story)
      .flatMap((d) => (d.kind === 'skipped' ? [] : (d.points ?? []).map((p) => p.x)));
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const a = boundsOf(STORY_A);
  const b = boundsOf(STORY_B);
  assert.ok(a.max < b.min, 'the fixture keeps the two islands disjoint in x');
  const within = (bounds: { min: number; max: number }) =>
    criteria.filter((p) => p.at.x >= bounds.min && p.at.x <= bounds.max);
  assert.equal(within(a).length, 6, 'atlas holds six criteria, so it stands six flowers');
  assert.equal(within(b).length, 5, 'beacon holds five criteria, so it stands five flowers');
  assert.equal(within(a).filter((p) => p.role === 'bloom').length, 4, 'four of atlas\'s six are open');
  assert.equal(within(b).filter((p) => p.role === 'bloom').length, 2, 'two of beacon\'s five are open');
});

test('⚠ SIGNING A CRITERION OPENS ITS FLOWER — it does not ADD one', () => {
  groundSanity();
  // The property a member reads progress off (ADR-0600 D1): the island's flower count holds still
  // while the mix moves. A map that ADDED a flower on signing would be the old behaviour wearing a
  // bud, and the count alone would not catch it — this compares the SAME island at two signature
  // levels.
  const none = dress(twoStoryMap({ total: 6, signed: 0 }, { total: 5, signed: 0 }));
  const some = dress(twoStoryMap({ total: 6, signed: 4 }, { total: 5, signed: 2 }));
  const all = dress(twoStoryMap({ total: 6, signed: 6 }, { total: 5, signed: 5 }));
  const total = (ps: readonly KitPlacement[]) => ps.filter((p) => isCriterionRole(p.role)).length;
  assert.equal(total(none), 11);
  assert.equal(total(some), 11);
  assert.equal(total(all), 11);
  const open = (ps: readonly KitPlacement[]) => ps.filter((p) => p.role === 'bloom').length;
  assert.deepEqual([open(none), open(some), open(all)], [0, 6, 11], 'only the MIX moves');
});

test('⚠ criteriaByIsland answers for ONE state at a time, and a bud is never a signature', () => {
  groundSanity();
  const map = twoStoryMap({ total: 6, signed: 4 }, { total: 5, signed: 2 });
  assert.deepEqual(Object.fromEntries(criteriaByIsland(map, 'uat-bloom')), { [STORY_A]: 4, [STORY_B]: 2 });
  assert.deepEqual(Object.fromEntries(criteriaByIsland(map, 'uat-bud')), { [STORY_A]: 2, [STORY_B]: 3 });
  // Nothing on THIS fixture is failing, and an empty answer is the honest one rather than a hole.
  assert.equal(criteriaByIsland(map, 'uat-wilt').size, 0);
  // ⚠ AND THE OLD NAME STILL MEANS SIGNATURES — the whole reason the states are separate kinds.
  assert.deepEqual(
    Object.fromEntries(signedCriteriaByIsland(map)),
    Object.fromEntries(criteriaByIsland(map, 'uat-bloom')),
  );
});

test('⚠⚠ A FAILING CRITERION IS DRAWN TOO, on its own island, and is NEVER counted as a signature', () => {
  groundSanity();
  // ⚠⚠ THE STATE THE LIVE CORPUS HAS NO INSTANCE OF, and therefore the one a fixture has to
  // manufacture or leave unproven. Everything about it runs on a permanent zero otherwise: the
  // mapper's case, the count, the placement, the role. A criterion the owner watched FAIL reading
  // as one he signed is the worst misreport on this map, and it is reachable the moment the corpus
  // holds one.
  const map = twoStoryMap({ total: 6, signed: 2, failing: 3 }, { total: 5, signed: 0, failing: 1 });
  assert.deepEqual(Object.fromEntries(criteriaByIsland(map, 'uat-bloom')), { [STORY_A]: 2 });
  assert.deepEqual(Object.fromEntries(criteriaByIsland(map, 'uat-wilt')), { [STORY_A]: 3, [STORY_B]: 1 });
  assert.deepEqual(Object.fromEntries(criteriaByIsland(map, 'uat-bud')), { [STORY_A]: 1, [STORY_B]: 4 });
  // ⚠ THE FENCE: four failing criteria, and `signedCriteriaByIsland` still reports only the two
  // signed ones. Beacon signed nothing, so it appears in NO signature count at all.
  assert.deepEqual(Object.fromEntries(signedCriteriaByIsland(map)), { [STORY_A]: 2 });

  const placements = dress(map);
  assert.equal(placements.filter((p) => p.role === 'wilt').length, 4, 'four failing criteria, four nodding flowers');
  assert.equal(placements.filter((p) => p.role === 'bloom').length, 2);
  assert.equal(placements.filter((p) => p.role === 'bud').length, 5);
  assert.equal(placements.filter((p) => isCriterionRole(p.role)).length, 11, 'eleven criteria, eleven flowers');

  // And each island's wilts stand on its own ground — a failing criterion is a per-story claim
  // exactly as a signature is.
  const boundsOf = (story: string) => {
    const xs = map
      .filter((d) => d.kind === 'cell-ground' && d.island === story)
      .flatMap((d) => (d.kind === 'skipped' ? [] : (d.points ?? []).map((p) => p.x)));
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const a = boundsOf(STORY_A);
  const b = boundsOf(STORY_B);
  const wilts = placements.filter((p) => p.role === 'wilt');
  assert.equal(wilts.filter((p) => p.at.x >= a.min && p.at.x <= a.max).length, 3);
  assert.equal(wilts.filter((p) => p.at.x >= b.min && p.at.x <= b.max).length, 1);
});

test('the map still grows ONE object per capability, on the capability’s own parcel', () => {
  groundSanity();
  // Per-island dressing must not cost the ADR-0475 vocabulary anything: three capabilities across
  // two islands are still three trees, each carrying its own capId.
  const map = twoStoryMap();
  assertSignatures(map, { [STORY_A]: 4, [STORY_B]: 2 });
  const placements = dress(map);
  // test-updated (new behaviour): "the map still grows ONE object per capability, on the capability’s own parcel" excludes coverage flora because it is scene content, not a capability tree.
  // ⚠ `isCapabilityTreeRole`, NOT `!isCriterionRole`. This census once used the latter after its
  // criterion-form repair; coverage adds a third scene class, so only the dedicated selector may
  // count capability trees.
  const caps = placements.filter((p) => isCapabilityTreeRole(p.role)).map((p) => p.capId);
  assert.deepEqual([...caps].sort(), ['atlas-parse', 'atlas-store', 'beacon-emit']);
});

// ---------------------------------------------------------------------------
// the absences, which are the fail-CLOSED direction
// ---------------------------------------------------------------------------

test('a bloom the substrate could not attribute is DROPPED, never spread', () => {
  groundSanity();
  // A signature with no island is one that could be drawn anywhere; refusing to count it means
  // such a story grows nothing, never that every story grows its neighbour's.
  const orphan: Descriptor3D[] = [
    { kind: 'uat-bloom', transform: { x: 0, y: 0, z: 0 }, group: 'uat-bloom', criterion: 'x' },
    { kind: 'uat-bloom', transform: { x: 1, y: 0, z: 0 }, group: 'uat-bloom', island: 'home', criterion: 'y' },
  ];
  const signed = signedCriteriaByIsland(orphan);
  assert.deepEqual([...signed], [['home', 1]], 'only the attributed signature counted');
});

test('the same criterion twice is ONE signature; unstamped markers are counted individually', () => {
  groundSanity();
  // ⚠⚠ THE SHAPE OF THIS FIXTURE IS ARITHMETIC, NOT TASTE — 4 named of which 2 are distinct, and
  // 2 unnamed, so the honest answer is 4. Every nearby fixture is satisfied by a reader that has
  // the two branches CONFUSED, and `check:mutation-diff` found each of them in turn:
  //   · with 1 unnamed, treating an unnamed marker as a named one gives {a, b, undefined} = 3,
  //     which is what 2 distinct + 1 unnamed also gives;
  //   · with 3 named and 2 unnamed, SWAPPING the branches gives 3 + 1 = 4, and so does 2 + 2.
  // Here the four readings separate: correct 4, branches swapped 5, unnamed treated as named 3,
  // named treated as unnamed 6.
  const doubled: Descriptor3D[] = [
    { kind: 'uat-bloom', transform: { x: 0, y: 0, z: 0 }, group: 'uat-bloom', island: 'home', criterion: 'a' },
    { kind: 'uat-bloom', transform: { x: 1, y: 0, z: 0 }, group: 'uat-bloom', island: 'home', criterion: 'a' },
    { kind: 'uat-bloom', transform: { x: 2, y: 0, z: 0 }, group: 'uat-bloom', island: 'home', criterion: 'a' },
    { kind: 'uat-bloom', transform: { x: 3, y: 0, z: 0 }, group: 'uat-bloom', island: 'home', criterion: 'b' },
    // No id at all: a distinct marker the core simply did not stamp. Folding these onto one absent
    // key would UNDER-report, which is the opposite error from the one this module guards.
    { kind: 'uat-bloom', transform: { x: 4, y: 0, z: 0 }, group: 'uat-bloom', island: 'home' },
    { kind: 'uat-bloom', transform: { x: 5, y: 0, z: 0 }, group: 'uat-bloom', island: 'home' },
  ];
  assert.equal(signedCriteriaByIsland(doubled).get('home'), 4, 'two distinct named + two unnamed');
});

test('cells the substrate cannot attribute still grow their capabilities’ trees, and no blooms', () => {
  groundSanity();
  // The classic extruded-hex substrate and hand-built fragments carry no island group. Dropping
  // those cells would shrink the map; growing a per-STORY claim on them would attribute it to a
  // story that does not exist. So: trees yes, blooms no.
  const ring = [
    { x: 0, y: 0, z: 0 },
    { x: 40, y: 0, z: 0 },
    { x: 40, y: 0, z: 40 },
    { x: 0, y: 0, z: 40 },
  ];
  const unattributed: Descriptor3D[] = [
    {
      kind: 'cell-ground',
      transform: { x: 20, y: 0, z: 20 },
      group: 'cell-ground',
      material: 'healthy',
      points: ring,
      parcel: 'lonely-cap',
    },
    { kind: 'uat-bloom', transform: { x: 20, y: 0, z: 20 }, group: 'uat-bloom', criterion: 'c' },
  ];
  const placements = dress(unattributed);
  assert.equal(placements.filter((p) => p.role === 'bloom').length, 0, 'no unattributed bloom');
  assert.deepEqual(
    placements.filter((p) => p.role !== 'bloom').map((p) => p.capId),
    ['lonely-cap'],
    'the capability still owns a tree',
  );
});

test('an island is dressed against its OWN occupancy — it looks the same alone as in a crowd', () => {
  groundSanity();
  // ⚠ A PROPERTY THE WHOLE-MAP CALL DID NOT HAVE. One `dressIslandFromKit` over every cell shares
  // one occupancy list, so adding a second island could move the FIRST island's props. Per-island
  // calls make an island's dressing a function of that island alone — which is what lets a
  // single-island instrument picture what the crowd will draw.
  const alone = dress(twoStoryMap({ total: 6, signed: 4 }, { total: 0, signed: 0 })).filter(
    (p) => p.capId.startsWith('atlas') || p.capId === 'story',
  );
  const crowded = dress(twoStoryMap({ total: 6, signed: 4 }, { total: 5, signed: 5 })).filter(
    (p) => p.capId.startsWith('atlas') || p.capId === 'story',
  );
  // `story` placements exist on both islands, so compare only those inside atlas's own span.
  const map = twoStoryMap();
  const aMax = Math.max(
    ...map
      .filter((d) => d.kind === 'cell-ground' && d.island === STORY_A)
      .flatMap((d) => (d.kind === 'skipped' ? [] : (d.points ?? []).map((p) => p.x))),
  );
  assert.deepEqual(
    crowded.filter((p) => p.at.x <= aMax),
    alone.filter((p) => p.at.x <= aMax),
    'beacon’s signatures moved atlas’s props',
  );
});

test('the dressing is deterministic — the same map dresses identically twice', () => {
  groundSanity();
  assertSignatures(twoStoryMap(), { [STORY_A]: 4, [STORY_B]: 2 });
  assert.deepEqual(dress(twoStoryMap()), dress(twoStoryMap()));
});

test('cfn-every-coverage-descriptor-becomes-one-grounded-native-placement: the real multi-island descriptor stream keeps each coverage plant attributable and grounded', () => {
  const descriptors = twoStoryMap();
  const coverage = descriptors.filter(isCoverageFloraDescriptor);
  assert.ok(coverage.length > 1, 'the real mapper fixture supplies coverage flora on more than one island');
  assert.ok(new Set(coverage.map((descriptor) => descriptor.island)).size > 1, 'coverage is genuinely multi-island');

  const placements = dress(descriptors).filter(
    (placement) => placement.role === ('coverageFlora' as unknown as typeof placement.role),
  );
  assert.equal(placements.length, coverage.length, 'every descriptor becomes exactly one native placement');
  assert.deepEqual(
    placements.map((placement) => ({
      capId: placement.capId,
      at: placement.at,
      y: placement.y,
      scale: placement.scale,
    })),
    coverage.map((descriptor) => ({
      capId: descriptor.capability,
      at: { x: descriptor.transform.x, z: descriptor.transform.z },
      y: landHeight(descriptor.transform.x, descriptor.transform.z, LAND_RELIEF_AMPLITUDE),
      scale: descriptor.floraScale / 0.4,
    })),
    'the one placement keeps its capability, grounded anchor, and serialized-source scale in descriptor order',
  );
});

test('cfn-coverage-is-an-explicit-scene-class-not-a-capability-tree-or-cover: coverage has its own scene selector', () => {
  const vocabulary = kitVocabulary as typeof kitVocabulary & {
    isCoverageRole?: (role: string) => boolean;
    isCapabilityTreeRole?: (role: string) => boolean;
  };
  assert.equal(typeof vocabulary.isCoverageRole, 'function', 'the vocabulary declares coverage as an explicit scene class');
  assert.equal(typeof vocabulary.isCapabilityTreeRole, 'function', 'the capability census has a selector distinct from all scene roles');
  if (typeof vocabulary.isCoverageRole !== 'function' || typeof vocabulary.isCapabilityTreeRole !== 'function') return;
  assert.equal(vocabulary.isCoverageRole('coverageFlora'), true);
  assert.equal(vocabulary.isCapabilityTreeRole('coverageFlora'), false, 'coverage is never counted as a capability tree');
  assert.equal(vocabulary.isDressingRole('coverageFlora' as never), false, 'coverage is scene content, not decorative cover');
});

test('cfn-coverage-foliage-carries-theme-and-status-without-unbatching: all theme × folded-status routes resolve to their emitted foliage token', () => {
  const tokens = {
    meadow: ['#89b56b', '#9fa88f', '#9fa88f', '#eccb6d', '#a08355', '#b0afa2'],
    woodland: ['#89b56b', '#8fa091', '#bfab5c', '#c7ac4e', '#7c5b40', '#b1b0a7'],
    heath: ['#89b56b', '#b3b7a8', '#d5cc9c', '#f2bb4e', '#a08c62', '#b6b3a6'],
  } as const;
  const statuses = ['healthy', 'mapped', 'proposed', 'building', 'unhealthy', 'unknown'] as const;
  const descriptors: Descriptor3D[] = Object.entries(tokens).flatMap(([theme], themeIndex) =>
    statuses.map((material, statusIndex) => ({
      kind: 'coverage-flora' as const,
      group: 'coverage-flora' as const,
      capability: `${theme}-${material}`,
      island: `island-${theme}`,
      material,
      theme,
      floraScale: 0.4,
      transform: { x: themeIndex * 100 + statusIndex * 10, y: 0, z: statusIndex * 10 },
    })),
  );
  const placements = dress(descriptors).filter(
    (placement) => placement.role === ('coverageFlora' as unknown as typeof placement.role),
  );
  assert.equal(placements.length, 18, 'all status/theme pairs are native placements');
  assert.deepEqual(placements.map((placement) => placement.tint), Object.values(tokens).flat(), 'every pair uses its emitted foliage token');
  assert.equal(placements[0]?.tint, placements[6]?.tint, 'healthy themes share the intentional foliage material bucket');
  assert.notEqual(placements[0]?.tint, placements[1]?.tint, 'a distinct emitted token remains a distinct bucket');
});

test('cfn-coverage-semantic-changes-rebuild-the-shared-ground-input: every consumed coverage descriptor field invalidates the shared ground cache', () => {
  const base: CoverageFloraDescriptor = {
    kind: 'coverage-flora', group: 'coverage-flora', capability: 'cap-a', island: 'island-a', material: 'healthy', theme: 'meadow', floraScale: 0.4,
    transform: { x: 10, y: 0, z: 20 },
  };
  const changes: readonly Partial<Extract<Descriptor3D, { kind: 'coverage-flora' }>>[] = [
    { transform: { x: 11, y: 0, z: 20 } },
    { capability: 'cap-b' },
    { island: 'island-b' },
    { material: 'unhealthy' },
    { theme: 'woodland' },
    { floraScale: 0.8 },
  ];
  for (const change of changes) {
    const changedStream: CoverageFloraDescriptor[] = [{ ...base, ...change }];
    assert.equal(sameGroundDependencies([base], changedStream), false, `coverage change ${JSON.stringify(change)} invalidates cache equality`);
    assert.notEqual(groundDependencyKey([base]), groundDependencyKey(changedStream), `coverage change ${JSON.stringify(change)} changes the cache key`);
  }
  const groupChanged = { ...base, group: 'coverage-flora-alt' } as unknown as Descriptor3D;
  assert.equal(sameGroundDependencies([base], [groupChanged]), false, 'coverage group invalidates cache equality');
  assert.notEqual(groundDependencyKey([base]), groundDependencyKey([groupChanged]), 'coverage group changes the cache key');
});

test('fld-every-dressed-placement-keeps-its-island: the companion result preserves each exact placement’s producing island', () => {
  groundSanity();
  // Namespace access is deliberate: until the companion exists this is an ASSERTION red, rather
  // than a named import stopping the test module before the contract can run.
  const dressWithAttribution = (
    mapDressing as typeof mapDressing & {
      dressMapWithCoverAttribution?: (
        descriptors: readonly Descriptor3D[],
        opts: Parameters<typeof dressMapWithCover>[1],
      ) => { placements: KitPlacement[]; islandByPlacement: ReadonlyMap<KitPlacement, string> };
    }
  ).dressMapWithCoverAttribution;
  assert.equal(typeof dressWithAttribution, 'function', 'map dressing exposes its placement-attribution companion');
  if (typeof dressWithAttribution !== 'function') return;

  // Two attributed islands hold every criterion state and healthy cover. A third, islandless
  // capability separates the fail-closed absence from a map that simply attributes every prop.
  const descriptors: Descriptor3D[] = [
    ...twoStoryMap({ total: 6, signed: 2, failing: 2 }, { total: 5, signed: 1, failing: 1 }),
    {
      kind: 'cell-ground',
      transform: { x: 900, y: 0, z: 20 },
      group: 'cell-ground',
      material: 'healthy',
      parcel: 'unattributed-capability',
      points: [
        { x: 880, y: 0, z: 0 },
        { x: 920, y: 0, z: 0 },
        { x: 920, y: 0, z: 40 },
        { x: 880, y: 0, z: 40 },
      ],
    },
  ];
  const opts = { relief: LAND_RELIEF_AMPLITUDE, footprint: FOOT };
  const attributed = dressWithAttribution(descriptors, opts);
  const legacy = dressMapWithCover(descriptors, opts);

  // Attribution changes no placement algorithm: the public wrapper stays byte-for-byte equal in
  // order and transforms, so delivery can opt in without retuning art or cover.
  assert.deepEqual(attributed.placements, legacy);

  const boundsOf = (island: string) => {
    const xs = descriptors
      .filter((d) => d.kind === 'cell-ground' && d.island === island)
      .flatMap((d) => (d.kind === 'skipped' ? [] : (d.points ?? []).map((p) => p.x)));
    return { min: Math.min(...xs), max: Math.max(...xs) };
  };
  const bounds = new Map([[STORY_A, boundsOf(STORY_A)], [STORY_B, boundsOf(STORY_B)]]);
  const islandless = attributed.placements.filter((p) => p.capId === 'unattributed-capability');
  assert.equal(islandless.length, 1, 'the fixture’s islandless capability still receives its tree');
  assert.equal(attributed.islandByPlacement.has(islandless[0]!), false, 'an islandless placement is not attributed');
  assert.equal(
    attributed.islandByPlacement.size,
    attributed.placements.length - islandless.length,
    'every and only island-made placement is attributed',
  );

  for (const [placement, island] of attributed.islandByPlacement) {
    assert.ok(attributed.placements.includes(placement), 'the map key is the exact returned placement object');
    const range = bounds.get(island);
    if (!range) assert.fail(`the placement claims an island the fixture did not produce: ${island}`);
    assert.ok(
      placement.at.x >= range.min && placement.at.x <= range.max,
      `a ${placement.role} at ${placement.at.x} is attributed to ${island} but stands off its ground`,
    );
  }
});

test('GROUND IS NOT A SIGNATURE — a map of nothing but cells signs nothing', () => {
  groundSanity();
  // ⚠ The filter's own claim, stated with no bloom in the stream at all: a `cell-ground` carries an
  // island and no criterion, so a reader that let ground through would report one signature per
  // cell — a story asserted to hold 164 signed criteria because its land has 164 parcels.
  const ground = twoStoryMap({ total: 6, signed: 0 }, { total: 5, signed: 0 });
  assert.ok(
    ground.filter((d) => d.kind === 'cell-ground').length > 10,
    'the fixture must carry ground for this to say anything',
  );
  assert.equal(ground.filter((d) => d.kind === 'uat-bloom').length, 0, 'and no signature at all');
  assertSignatures(ground, {});
});

// ---------------------------------------------------------------------------
// THE GROUND COVER — the second layer, and the one the CANVAS actually stands
// ---------------------------------------------------------------------------
//
// ⚠ A BIGGER FIXTURE FOR THIS HALF: seven hexes per island rather than three, so the island holds
// a carpet worth counting once the beach band has taken its share. The two islands are far apart
// in x, as above, and their STATUSES are the fixture's parameter — which is the whole question.
//
// ⚠⚠ THIS HALF USED TO BE THE GROVE'S (2026-09-03 → 2026-09-05). `dressMapWithGroves` stood
// thirteen stands of dressing pines per recipe-island on every healthy island, and ADR-0518
// retired the role: a tree on the map means exactly one capability now. The tests below hold that
// as a property of the whole map's placement list — no `tree` stands that a capability did not put
// there — and the beach-and-path test the grove carried now binds the cover.

const RING_A = [
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
] as const;
const RING_B = RING_A.map((h) => ({ q: h.q + 14, r: h.r }));

const BIG_MAPS = new Map<string, Descriptor3D[]>();

/** Two seven-hex islands, each of the status asked for, each signing every criterion it holds.
 *  Memoised for the same mutation-rung reason `twoStoryMap` is. */
function bigMap(aStatus: SceneStatus = 'healthy', bStatus: SceneStatus = 'healthy'): Descriptor3D[] {
  const key = `${aStatus}|${bStatus}`;
  const cached = BIG_MAPS.get(key);
  if (cached) return cached;
  const drawTiles = [...RING_A.map((h) => ({ h, owner: 0 })), ...RING_B.map((h) => ({ h, owner: 1 }))];
  const wheatSets = [new Set<string>(), new Set<string>()];
  const input: SceneInput = {
    offset: { x: 0, y: 0 },
    width: 1600,
    height: 900,
    empties: [],
    relaxedCells: buildRelaxedCells(drawTiles, wheatSets, 'mesh', TUNED_LATTICE),
    drawTiles,
    wheatSets,
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: [
      territory(STORY_A, RING_A, ['atlas-parse', 'atlas-store', 'atlas-sign'], { total: 3, signed: 3 }, aStatus),
      territory(STORY_B, RING_B, ['beacon-emit', 'beacon-ack'], { total: 2, signed: 2 }, bStatus),
    ],
    vegetation: {},
    tile: TUNED_TILE,
  };
  const built = worldTo3D(buildScene(input));
  BIG_MAPS.set(key, built);
  return built;
}

const groundOf = (map: readonly Descriptor3D[], story: string): InstanceDescriptor[] =>
  map.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground' && d.island === story);

const spanOf = (map: readonly Descriptor3D[], story: string) => {
  const xs = groundOf(map, story).flatMap((d) => (d.points ?? []).map((p) => p.x));
  return { min: Math.min(...xs), max: Math.max(...xs) };
};

const dressCovered = (
  descriptors: readonly Descriptor3D[],
  over: { coverSize?: number; coverDensity?: number; recipeIslandArea?: number } = {},
) => {
  // ANNOTATED then guarded — `exactOptionalPropertyTypes` refuses an explicit `undefined`.
  const opts: Parameters<typeof dressMapWithCover>[1] = { relief: LAND_RELIEF_AMPLITUDE, footprint: FOOT };
  if (over.coverSize !== undefined) opts.coverSize = over.coverSize;
  if (over.coverDensity !== undefined) opts.coverDensity = over.coverDensity;
  if (over.recipeIslandArea !== undefined) opts.recipeIslandArea = over.recipeIslandArea;
  return dressMapWithCover(descriptors, opts);
};

test('⚠ `recipeIslandArea` reaches the cover layer and nothing else: the default is the shipped basis, a halved basis doubles the cover, and no tree or bloom moves', () => {
  groundSanity();
  const map = twoStoryMap();
  const shipped = dressCovered(map);
  const explicit = dressCovered(map, { recipeIslandArea: RECIPE_ISLAND_AREA });
  const halved = dressCovered(map, { recipeIslandArea: RECIPE_ISLAND_AREA / 2 });
  assert.deepEqual(explicit, shipped, 'the default IS `RECIPE_ISLAND_AREA`');
  const coverOf = (ps: readonly KitPlacement[]) => ps.filter((p) => isDressingRole(p.role)).length;
  assert.ok(coverOf(halved) > coverOf(shipped) * 1.9, `${coverOf(halved)} against ${coverOf(shipped)}`);
  assert.deepEqual(
    halved.filter((p) => !isDressingRole(p.role)),
    shipped.filter((p) => !isDressingRole(p.role)),
    'everything that reports stands exactly where it stood',
  );
});

const isTree = (p: { role: string }): boolean => p.role === 'tree' || p.role === 'deadTree';

test('⚠⚠ ONE TREE PER CAPABILITY AND NOTHING ELSE TREE-SHAPED (ADR-0518 D1) — on the whole map, both layers', () => {
  groundSanity();
  // The fixture: atlas holds three capabilities, beacon two — five trees, each wearing the capId
  // of the capability that put it there, at scale 1, on its own island. On BOTH entry points: the
  // cover layer may add bushes, tufts and flowers, and may not add a tree.
  const map = bigMap('healthy', 'healthy');
  for (const placements of [dress(map), dressCovered(map)]) {
    const trees = placements.filter(isTree);
    assert.equal(trees.length, 5, 'five capabilities, five trees');
    assert.deepEqual(
      trees.map((t) => t.capId).sort(),
      ['atlas-parse', 'atlas-sign', 'atlas-store', 'beacon-ack', 'beacon-emit'],
    );
    for (const t of trees) assert.equal(t.scale, 1, `a tree at scale ${t.scale} — nothing tree-shaped stands below the role`);
    // test-updated (new behaviour): "⚠⚠ ONE TREE PER CAPABILITY AND NOTHING ELSE TREE-SHAPED (ADR-0518 D1) — on the whole map, both layers" admits native coverage flora as a third scene class, not cover.
    // Every other placement is a criterion, dressing role, or explicit coverage scene role.
    for (const p of placements) {
      assert.ok(
        isTree(p) || isCriterionRole(p.role) || isDressingRole(p.role) || isCoverageRole(p.role),
        `${p.role} is neither a capability tree, criterion, declared dressing, nor coverage`,
      );
    }
  }
  // NON-VACUITY: the covered map DID add something, and none of it is a tree.
  assert.ok(dressCovered(map).length > dress(map).length, 'the cover layer stood nothing');
});

test('⚠⚠ THE TWO ENTRY POINTS ARE STRICTLY NESTED — cover is the vocabulary plus cover, and the vocabulary is untouched', () => {
  groundSanity();
  // The claim the canvas rests on: standing the top layer cannot MOVE anything the layer below
  // placed. If it could, a scale-back on the cover — an owner's LOOK decision, made off a picture
  // — would silently re-place every signal on the map, invisibly in any picture of one arm.
  const map = bigMap('healthy', 'proposed');
  const vocabulary = dress(map);
  const covered = dressCovered(map);
  assert.deepEqual(covered.filter((p) => !isDressingRole(p.role)), vocabulary, 'the cover moved what stands under it');
  const cover = covered.filter((p) => isDressingRole(p.role));
  assert.ok(cover.length > 0, 'the healthy island wears no ground cover at all');
  assert.equal(vocabulary.filter((p) => isDressingRole(p.role)).length, 0, 'dressMapFromKit grew ground cover');
});

test('the ground cover grows on the HEALTHY island only — unknown, unhealthy, mapped, building, proposed wear nothing', () => {
  groundSanity();
  const map = bigMap('healthy', 'proposed');
  const cover = dressCovered(map).filter((p) => isDressingRole(p.role));
  const a = spanOf(map, STORY_A);
  const b = spanOf(map, STORY_B);
  assert.ok(a.max < b.min, 'the fixture keeps the two islands disjoint in x');
  for (const c of cover) assert.ok(c.at.x >= a.min && c.at.x <= a.max, `a cover prop off the healthy island at x=${c.at.x}`);
  assert.equal(cover.filter((c) => c.at.x >= b.min).length, 0, 'the proposed island wears ground cover');
  for (const status of ['unknown', 'unhealthy', 'mapped', 'building', 'proposed'] as const) {
    assert.equal(dressCovered(bigMap(status, status)).filter((p) => isDressingRole(p.role)).length, 0, `${status} grew ground cover`);
  }
  // NON-VACUITY: both healthy, both wear — and two islands of one shape are not one carpet twice,
  // because the seed is the island's id.
  const both = bigMap('healthy', 'healthy');
  const carpets = dressCovered(both).filter((p) => isDressingRole(p.role));
  const inA = carpets.filter((c) => c.at.x <= spanOf(both, STORY_A).max);
  const inB = carpets.filter((c) => c.at.x >= spanOf(both, STORY_B).min);
  assert.ok(inA.length > 0 && inB.length > 0, `${inA.length} on atlas, ${inB.length} on beacon`);
  assert.equal(inA.length + inB.length, carpets.length, 'a cover prop in the sea between them');
  assert.notDeepEqual(
    inA.map((c) => Number((c.at.x - spanOf(both, STORY_A).min).toFixed(3))),
    inB.map((c) => Number((c.at.x - spanOf(both, STORY_B).min).toFixed(3))),
  );
});

test('⚠⚠ THE COVER KEEPS OFF THE BEACH AND THE PATH, judged by the ground’s OWN distance fields', () => {
  groundSanity();
  const map = bigMap('healthy', 'proposed');
  // A trail strip arriving from the east and ending ON the healthy island's clipped rim — its
  // easternmost rim vertex — so the connector docks it there and wears a path to the centroid.
  const clippedA = clipToCoast(groundOf(map, STORY_A), SHIPPED_COAST);
  const rim = islandRims(clippedA).find((r) => r.island === STORY_A);
  assert.ok(rim !== undefined, 'the healthy island has no rim');
  let landing = rim.loops[0]![0]!;
  for (const loop of rim.loops) for (const p of loop) if (p.x > landing.x) landing = p;
  const offshore = { x: landing.x + 40, z: landing.z };
  const strip: InstanceDescriptor = {
    kind: 'trail-strip',
    transform: { x: (landing.x + offshore.x) / 2, y: 0, z: landing.z },
    group: 'trail-strip',
    points: [
      { x: offshore.x, y: 0, z: offshore.z },
      { x: (landing.x + offshore.x) / 2, y: 0, z: landing.z },
      { x: landing.x, y: 0, z: landing.z },
    ],
    width: 3,
    usage: 1,
    hidden: false,
    edges: [],
    segment: `${STORY_A}/east`,
  };
  const withStrip = [...map, strip];
  const paths = [...islandPaths(clippedA, [strip]).values()].flat();
  assert.ok(paths.length === 1 && paths[0]!.length > 2, 'the strip docked nowhere — the fixture proves nothing');

  const cover = dressCovered(withStrip).filter((p) => isDressingRole(p.role));
  assert.ok(cover.length > 0);
  const wear = wearField(paths, WEAR_FALLOFF);
  const shore = shoreField(clippedA, DRESSING_BEACH);
  for (const c of cover) {
    assert.ok(wearOf(wear.sample(c.at.x, c.at.z).distance) < DRESSING_WEAR_CEILING, `a cover prop on the path at ${c.at.x}, ${c.at.z}`);
    assert.ok(shore.sample(c.at.x, c.at.z).distance >= DRESSING_BEACH, `a cover prop on the beach at ${c.at.x}, ${c.at.z}`);
  }
  // ⚠ NON-VACUITY: the exclusion the dressing honoured CAN refuse — a point on the path, the
  // landing itself (which sits on the coast), the centroid the one-dock path ends at — and every
  // cover prop passes it.
  const ex = islandExclusion(withStrip, STORY_A);
  const onPath = paths[0]![Math.floor(paths[0]!.length / 2)]!;
  assert.equal(ex.clear(onPath.x, onPath.z), false, 'the path’s middle is clear — the path never reached the exclusion');
  assert.equal(ex.clear(landing.x, landing.z), false, 'the coast is clear — the beach never reached the exclusion');
  assert.equal(ex.clear(rim.centroid.x, rim.centroid.z), false, 'the one-dock path ends at the centroid');
  for (const c of cover) assert.equal(ex.clear(c.at.x, c.at.z), true);
  // And WITHOUT the strip the centroid is clear, which is what shows the refusal came from the dock.
  assert.equal(islandExclusion(map, STORY_A).clear(rim.centroid.x, rim.centroid.z), true);
  // ⚠ AND THE PATH REACHES THE PICTURE: the cover re-samples a refused point (the recipe's own
  // `range(400)`), so the count holds and the CARPET moves — the same island without the strip
  // stands its props elsewhere.
  const without = dressCovered(map).filter((p) => isDressingRole(p.role));
  assert.equal(cover.length, without.length, 'a refused point is re-sampled, never dropped, on an island this size');
  assert.notDeepEqual(cover.map((c) => c.at), without.map((c) => c.at), 'the path moved no prop — the exclusion never reached the scatter');
});

test('⚠ THE COUNT RUNG REACHES THE MAP (ADR-0518 D2) — a denser rung stands more cover and moves nothing that reports', () => {
  groundSanity();
  // The seam the one-tree-per-capability page's whole ladder rides on: `dressMapWithCover` could
  // accept `coverDensity` and drop it on the floor, and every arm of the sheet would render the
  // shipped rung under four different captions.
  const map = bigMap('healthy', 'healthy');
  const counts = COVER_DENSITY_RUNGS.map((rung) => dressCovered(map, { coverDensity: rung }).filter((p) => isDressingRole(p.role)).length);
  for (const [i, n] of counts.entries()) {
    if (i > 0) assert.ok(n > counts[i - 1]!, `rung ${COVER_DENSITY_RUNGS[i]} stands ${n} against rung ${COVER_DENSITY_RUNGS[i - 1]}'s ${counts[i - 1]}`);
  }
  // Roughly proportional: the recipe's scatter repeated, minus the props the exclusion drops.
  assert.ok(counts[1]! > counts[0]! * 1.7 && counts[1]! < counts[0]! * 2.3, `rung 2 is ${counts[1]} against rung 1's ${counts[0]}`);
  for (const rung of COVER_DENSITY_RUNGS) {
    assert.deepEqual(
      dressCovered(map, { coverDensity: rung }).filter((p) => !isDressingRole(p.role)),
      dress(map),
      `rung ${rung} moved the vocabulary`,
    );
  }
  // And the OMITTED rung is the shipped pick: the canvas passes no `coverDensity`.
  assert.deepEqual(dressCovered(map), dressCovered(map, { coverDensity: COVER_DENSITY }));
  assert.notDeepEqual(dressCovered(map), dressCovered(map, { coverDensity: COVER_DENSITY + 1 }));
});

test('⚠ THE SIZE RUNG REACHES THE MAP — a bolder rung stands the same cover, wider, and moves nothing else', () => {
  groundSanity();
  // The seam this asserts is the one the comparison page's whole ladder rides on. `dressMapWithCover`
  // could accept `coverSize` and drop it on the floor, and every arm of the sheet would render the
  // shipped rung under five different captions — a page that looks like a ladder and is five copies
  // of one picture. Asserted per prop rather than as a mean.
  const map = bigMap('healthy', 'healthy');
  const lean = dressCovered(map, { coverSize: 1 }).filter((p) => isDressingRole(p.role));
  const bold = dressCovered(map, { coverSize: COVER_SIZE }).filter((p) => isDressingRole(p.role));
  assert.ok(lean.length > 0 && lean.length === bold.length, 'the rung changed WHAT stands');
  for (const [i, p] of lean.entries()) {
    const b = bold[i]!;
    assert.equal(b.role, p.role);
    assert.deepEqual(b.at, p.at, 'the rung moved a prop');
    assert.ok(Math.abs(b.scale / p.scale - COVER_SIZE) < 1e-9, `prop ${i} scaled by ${b.scale / p.scale}`);
  }
  // The scene roles are untouched by the cover's rung — a bolder carpet must not move a tree.
  assert.deepEqual(
    dressCovered(map, { coverSize: 1 }).filter((p) => !isDressingRole(p.role)),
    dressCovered(map, { coverSize: COVER_SIZE }).filter((p) => !isDressingRole(p.role)),
  );
  // And the OMITTED rung is the shipped pick, never rung 1: the canvas passes no `coverSize`.
  assert.deepEqual(dressCovered(map), dressCovered(map, { coverSize: COVER_SIZE }));
  for (const rung of COVER_SIZE_RUNGS) assert.ok(dressCovered(map, { coverSize: rung }).length === dressCovered(map).length);
});

test('the covered dressing is deterministic — the same map dresses identically twice', () => {
  groundSanity();
  const map = bigMap('healthy', 'healthy');
  assert.deepEqual(dressCovered(map), dressCovered(map));
});
