// cover-dressing.test.ts — the ground-cover pass, proved where it lives.
//
// ⚠ IN `src/` FOR THE MUTATION RUNG'S SAKE, like `dressing-ground.test.ts` and
// `kit-vocabulary.test.ts`: `check:mutation-diff` mutates a project's `src/` only, and a `src/`
// module proved from `harness/` buys it nothing.
//
// ⚠⚠ WHAT THIS FILE IS ACTUALLY DEFENDING, and it is not the picture. The picture is the owner's
// (ADR-0503 D1: judged by the LOOK, off a rendered ladder). What can be proved here — and what
// would do real harm if it broke — is that scenery STAYS scenery: that no capability's state can
// reach a cover prop, that the criterion marker keeps its colour and its size to itself, that
// nothing grows on an island the arc's gate does not admit, and that two builds of one island are
// the same island. Those are claims about the arithmetic and about the tables, so they are provable
// without a GPU, which is the whole reason the placement is pure.

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COVER_COUNT_CAP,
  COVER_DENSITY,
  COVER_DENSITY_RUNGS,
  COVER_RECIPE_DENSITY,
  COVER_RECIPE_COUNTS,
  COVER_ROLES,
  COVER_SIZE,
  COVER_SIZE_RUNGS,
  COVER_TRIES,
  boxShare,
  coverAreaShare,
  coverAssembly,
  coverCount,
  coverEligible,
  coverPoint,
  coverScale,
  coverYaw,
  dressCover,
  type CoverDressingOptions,
} from './cover-dressing.js';
import {
  DRESSING_BEACH,
  RECIPE_ISLAND_AREA,
  beachClear,
  cellAt,
  cellsArea,
  crossingIsRight,
  crossingX,
  dressingEligible,
  dressingExclusion,
  insideRing,
  pathClear,
  straddles,
  type DressingExclusion,
} from './dressing-ground.js';
import { islandSeed } from './island-path.js';
import {
  COVER_CAP_ID,
  COVER_SCALE,
  DRESSING_ROLES,
  KIT_ASSEMBLIES,
  KIT_FOOTPRINTS_2026_08_29,
  KIT_ROLE_ASSEMBLIES,
  KIT_ROLE_SIZE,
  VOCABULARY_STATES,
  capabilityFactsFrom,
  dressIslandFromKit,
  dressingOverlaps,
  isCoverPlacement,
  isDressingRole,
  propStream,
  samplePoint,
  stateForm,
  type KitPlacement,
} from './kit-vocabulary.js';
import { indices } from './land-shadow.js';
import { landHeight } from './land-relief.js';
import type { GPoint, LayoutCell } from './parcel-cells.js';
import type { InstanceDescriptor } from './world-to-3d.js';

const FOOT = KIT_FOOTPRINTS_2026_08_29;

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
// a built island — the same hostile shape `dressing-ground.test.ts` uses
// ---------------------------------------------------------------------------
//
// ⚠ FOUR DIFFERENT EDGE NUMBERS AND AN ORIGIN NOWHERE NEAR ZERO, for the reason that fixture
// states: an island centred on the origin makes `max - min` and `max + min` coincide, so a sign
// error in a bound is invisible through it.

const CELL_W = 34;
const CELL_D = 26;
const ORIGIN_X = 140;
const ORIGIN_Z = -70;

function parcel(capId: string, status: string, row: number, cols: number): LayoutCell[] {
  return Array.from({ length: cols }, (_, c) => {
    const x0 = ORIGIN_X + c * CELL_W;
    const z0 = ORIGIN_Z + row * CELL_D;
    return {
      points: [
        { x: x0, z: z0 },
        { x: x0 + CELL_W, z: z0 },
        { x: x0 + CELL_W, z: z0 + CELL_D },
        { x: x0, z: z0 + CELL_D },
      ],
      parcel: capId,
      island: 'built',
      status,
      cellId: `${capId}-${row}-${c}`,
    } satisfies LayoutCell;
  });
}

function island(states: readonly string[], cols = 4): LayoutCell[] {
  return states.flatMap((status, row) => parcel(`cap-${row}`, status, row, cols));
}

/** Four healthy parcels, four cells each: 136 x 104 units, 14,144 sq units. */
const HEALTHY = island(['healthy', 'healthy', 'healthy', 'healthy']);

const ALLOW: DressingExclusion = { clear: () => true };
const REFUSE: DressingExclusion = { clear: () => false };

function coverOn(
  cells: readonly LayoutCell[] = HEALTHY,
  over: {
    island?: string;
    exclusion?: DressingExclusion;
    relief?: number;
    density?: number;
    size?: number;
    recipeIslandArea?: number;
  } = {},
): KitPlacement[] {
  // ANNOTATED local, then guarded assignments — `anti-slop/no-conditional-empty-object-spread`,
  // and `exactOptionalPropertyTypes` refuses an explicit `undefined` on either optional knob.
  const opts: CoverDressingOptions = {
    island: over.island ?? 'built',
    cells,
    relief: over.relief ?? 0,
    exclusion: over.exclusion ?? ALLOW,
  };
  if (over.density !== undefined) opts.density = over.density;
  if (over.size !== undefined) opts.size = over.size;
  if (over.recipeIslandArea !== undefined) opts.recipeIslandArea = over.recipeIslandArea;
  return dressCover(opts);
}

/** A deterministic stream that yields the values it is handed, then zeros — so a draw's ARITHMETIC
 *  can be asserted rather than only its range. */
function scripted(values: readonly number[]): () => number {
  let i = 0;
  return () => values[i++] ?? 0;
}

// ---------------------------------------------------------------------------
// the recipe's own numbers
// ---------------------------------------------------------------------------

test('the counts and the tries are the recipe’s, transcribed and not tuned', () => {
  groundSanity();
  // `build_land.py:1036`, `forest: under=70, grass=120, flower=26`; `:1052`, `range(400)`.
  assert.deepEqual(COVER_RECIPE_COUNTS, { bush: 70, tuft: 120, flowerPatch: 26 });
  assert.equal(COVER_TRIES, 400);
});

test('the placement order is the recipe’s scatter order, and it covers the vocabulary exactly', () => {
  groundSanity();
  // ⚠ TWO CLAIMS AND THEY ARE DIFFERENT. The ORDER is the recipe's (`:1087-1089`, undergrowth then
  // grass then flowers) and is stated in this module; the SET must be the vocabulary's dressing
  // roles, or a role added to one and not the other is a role that silently never grows — the
  // failure `an-expectation-derived-from-its-subject-cannot-fail` warns about, in the direction
  // where the expectation is derived from the WRONG subject.
  assert.deepEqual([...COVER_ROLES], ['bush', 'tuft', 'flowerPatch']);
  assert.deepEqual([...COVER_ROLES].sort(), [...DRESSING_ROLES].sort());
  for (const role of COVER_ROLES) assert.ok(isDressingRole(role), `${role} is placed here but is not dressing`);
  assert.deepEqual(Object.keys(COVER_RECIPE_COUNTS).sort(), [...COVER_ROLES].sort());
});

test('the shipped rung is one of the rendered rungs, and the ladder is what a scale-back moves along', () => {
  groundSanity();
  // ⚠ THE POINT OF THE LADDER (ADR-0503 D1): the owner answers a sheet with a RUNG, so the shipped
  // pick must be one of the rungs he was shown. A pick outside the ladder is a number nobody has
  // seen a picture of.
  assert.ok(COVER_SIZE_RUNGS.includes(COVER_SIZE as (typeof COVER_SIZE_RUNGS)[number]));
  // ⚠⚠ SIZE WAS LADDERED FIRST, AND THAT WAS A MEASURED CHOICE RATHER THAN A TASTE. The literal
  // port of `build_land.py`'s counts AND sizes was rendered on 2026-09-03 and was invisible:
  // doubling the COUNT moved 743 px past 20/255 on an island where the canopy moved 194,440,
  // because every prop was about eight delivered pixels of dark green on dark-green ground. The
  // cause is that this map's island is 2.49x the recipe's and its pines 4.50x the recipe's, so the
  // counts crossed scaled and the sizes crossed literal. The size rung settled at 4.5; the COUNT is
  // laddered on top of it now (ADR-0518 D2, the test below), one knob per page.
  assert.equal(COVER_SIZE, 4.5, 'the settled size rung — the count ladder is rendered at this size');
  assert.equal(COVER_SIZE_RUNGS[0], 1, 'rung 1 must be the literal port, so the sheet shows why it is not shipped');
});

test('⚠⚠ THE COUNT LADDER (ADR-0518 D2): the shipped rung is a rendered rung, rung 1 is the recipe, and the ladder rises', () => {
  groundSanity();
  // With the grove gone the cover is what carries the island, and the owner scales it along rungs
  // he has been shown (ADR-0503 D1). The shipped pick must therefore be ON the ladder, and rung 1
  // must still be `build_land.py`'s own scatter so the sheet's bottom rung is the literal recipe.
  assert.ok(COVER_DENSITY_RUNGS.includes(COVER_DENSITY as (typeof COVER_DENSITY_RUNGS)[number]));
  assert.ok(COVER_DENSITY_RUNGS.includes(COVER_RECIPE_DENSITY as (typeof COVER_DENSITY_RUNGS)[number]), 'the recipe’s own count is a rung');
  assert.equal(COVER_RECIPE_DENSITY, 1, 'rung 1 IS the recipe’s own count');
  assert.deepEqual([...COVER_DENSITY_RUNGS], [0.5, 1, 2, 3]);
  for (const [i, rung] of COVER_DENSITY_RUNGS.entries()) {
    if (i > 0) assert.ok(rung > COVER_DENSITY_RUNGS[i - 1]!, 'the ladder must rise');
  }
  // ⚠ THE PICK IS BELOW THE RECIPE'S COUNT SINCE THE LAND-PER-CAPABILITY RATIO (2026-09-05): the
  // island shrank seven-fold in area under props 4.5× the recipe's relative size, so the recipe's
  // own count carpets the ground and the story's state stops reading (ADR-0489 D3's outcome test).
  // It was x3 on the oversized island; the re-judgement is on the land-ratio sheet.
  assert.equal(COVER_DENSITY, 0.5);
  assert.ok(COVER_DENSITY < COVER_RECIPE_DENSITY, 'the shipped count is thinned from the recipe’s on the correctly-sized island');
  // And the two knobs are two constants: a scale-back on either is bought without the other.
  assert.notEqual(COVER_DENSITY, COVER_SIZE);
});

test('THE SIZE RUNG REALLY REACHES THE PROP — a bolder rung stands the same props, wider', () => {
  groundSanity();
  // ⚠ THE CLAIM THE INVISIBILITY FINDING TURNS ON: the rung has to arrive at the placement's own
  // `scale`, or the sheet renders five identical arms and the owner is asked to pick between them.
  // Asserted as a per-prop ratio rather than as a mean, because a mean is satisfied by a rung that
  // reached SOME props.
  const lean = coverOn(HEALTHY, { size: 1 });
  const bold = coverOn(HEALTHY, { size: COVER_SIZE });
  assert.ok(lean.length > 0 && lean.length === bold.length, 'the size rung must not change WHAT stands');
  for (const [i, p] of lean.entries()) {
    const b = bold[i]!;
    assert.equal(b.role, p.role, 'the rung reordered the scatter');
    assert.equal(b.assembly, p.assembly, 'the rung changed which shape was drawn');
    assert.deepEqual(b.at, p.at, 'the rung moved the prop');
    assert.ok(
      Math.abs(b.scale / p.scale - COVER_SIZE) < 1e-9,
      `prop ${i} scaled by ${(b.scale / p.scale).toFixed(4)} rather than by the rung ${COVER_SIZE}`,
    );
  }
  // And the default IS the shipped pick — a default that quietly stood rung 1 would make every arm
  // of the comparison page a lie about what ships.
  assert.deepEqual(coverOn(HEALTHY), bold);
});

// ---------------------------------------------------------------------------
// how many
// ---------------------------------------------------------------------------

test('an island of the RECIPE’S OWN area wears the recipe’s own counts at rung 1', () => {
  groundSanity();
  // ⚠ THE ANCHOR THE WHOLE SCALING RESTS ON, asserted rather than assumed: the proportion is to
  // `RECIPE_ISLAND_AREA` — the ground the recipe scattered over, in this basis, by import — so an
  // island of exactly that area asks for exactly what `build_land.py` sprinkled.
  const recipeIsland = [
    {
      points: [
        { x: 0, z: 0 },
        { x: RECIPE_ISLAND_AREA, z: 0 },
        { x: RECIPE_ISLAND_AREA, z: 1 },
        { x: 0, z: 1 },
      ],
      parcel: 'cap-0',
      island: 'recipe',
      status: 'healthy',
      cellId: 'c',
    } satisfies LayoutCell,
  ];
  assert.equal(cellsArea(recipeIsland), RECIPE_ISLAND_AREA);
  assert.equal(coverAreaShare(recipeIsland), 1);
  for (const role of COVER_ROLES) {
    assert.equal(coverCount(role, recipeIsland, 1), COVER_RECIPE_COUNTS[role as 'bush']);
  }
});

test('the count scales with AREA and with the rung, and rounds rather than truncating', () => {
  groundSanity();
  const share = coverAreaShare(HEALTHY);
  assert.equal(share, cellsArea(HEALTHY) / RECIPE_ISLAND_AREA);
  // ⚠ THE DECLARED RUNGS AND ONE OFF THE LADDER: the arithmetic has to scale for any multiple,
  // not only for the arms somebody renders.
  for (const rung of [...COVER_DENSITY_RUNGS, 7]) {
    for (const role of COVER_ROLES) {
      assert.equal(
        coverCount(role, HEALTHY, rung),
        Math.round(COVER_RECIPE_COUNTS[role as 'bush'] * rung * share),
      );
    }
  }
  // ⚠ A ROUNDED COUNT, NOT A FLOOR. `Math.floor` and `Math.round` agree on most inputs, so a
  // fixture that did not land between two integers would let the mutant through: 26 flowers on
  // 0.9 of a recipe island is 23.4, which floors to 23 and rounds to 23 — while 70 bushes on the
  // same island is 63.0. The one that separates them is asserted directly.
  assert.equal(Math.round(26 * 0.98), 25);
  const almost = [
    {
      points: [
        { x: 0, z: 0 },
        { x: RECIPE_ISLAND_AREA * 0.98, z: 0 },
        { x: RECIPE_ISLAND_AREA * 0.98, z: 1 },
        { x: 0, z: 1 },
      ],
      parcel: 'cap-0',
      island: 'r',
      status: 'healthy',
      cellId: 'c',
    } satisfies LayoutCell,
  ];
  assert.equal(coverCount('flowerPatch', almost, 1), 25, 'the count truncates instead of rounding');
});

test('coverCount REFUSES a role the recipe declares no count for, rather than standing zero of it', () => {
  groundSanity();
  // ⚠ THE DIRECTION OF THE FAILURE IS THE POINT. Reading a missing count as 0 would make a role
  // added to the vocabulary and forgotten here grow NOTHING, silently, on every island forever —
  // a picture with a hole in it and no message anywhere. The refusal names the role and the three
  // the recipe does declare.
  for (const role of ['tree', 'deadTree', 'bloom'] as const) {
    assert.throws(
      () => coverCount(role, HEALTHY),
      (e: Error) => {
        assert.match(e.message, new RegExp(`${role} is not a ground-cover role`));
        assert.match(e.message, /the recipe declares a count for the three dressing roles only/);
        // ⚠ THE ROLES ARE NAMED AS A READABLE LIST, not as a run-on. Asserting each name
        // individually passes on `bushtuftflowerPatch` — every substring is still present — and
        // the whole value of naming the alternatives is that a reader can read them.
        assert.ok(
          e.message.includes(COVER_ROLES.join(', ')),
          `the refusal lists the roles as "${e.message}" rather than "${COVER_ROLES.join(', ')}"`,
        );
        return true;
      },
      `${role} was given a ground-cover count`,
    );
  }
  // NON-VACUITY: the three that ARE cover roles answer a number rather than throwing.
  for (const role of COVER_ROLES) assert.ok(coverCount(role, HEALTHY) > 0);
});

test('⚠ coverPoint SKIPS a degenerate cell and a point outside every parcel, and keeps trying', () => {
  groundSanity();
  // Two refusals inside one loop, and each has to be exercised on its own or a mutant that deletes
  // either passes on the other's fixture.
  //
  // (a) A DEGENERATE CELL — fewer than three points, so there is no quad to sample inside.
  //     `samplePoint` consumes its four draws BEFORE it can refuse (that ordering is its own
  //     documented rule), so the stream stays aligned and the next try is a real one.
  const degenerate: LayoutCell[] = [
    { points: [{ x: 0, z: 0 }, { x: 1, z: 0 }], parcel: 'cap-0', island: 'd', status: 'healthy', cellId: 'bad' },
  ];
  assert.equal(coverPoint(degenerate, propStream(3), ALLOW), null, 'a degenerate cell yielded a point');

  // (b) A POINT OUTSIDE EVERY PARCEL — `cellAt`'s refusal, and it is a DIFFERENT question from the
  //     exclusion's: the exclusion knows about the beach and the worn path, `cellAt` knows about
  //     the island's own edge. A fixture where the exclusion says yes to everything isolates it.
  //
  //     ⚠⚠ IT NEEDS A CONCAVE CELL, AND THAT IS NOT A CONTRIVANCE — it is this map's coast. On a
  //     CONVEX quad `samplePoint` and `cellAt` can never disagree, because the sampling patch IS
  //     the ring; the branch is reachable exactly when the patch spanned by the cell's first four
  //     points reaches outside its own ring, which is what a notch or a fold does
  //     (`a-fill-hides-a-fold-a-mesh-exposes`: the coast the studio draws folds twice on the
  //     shipped island). Measured on this fixture: 110 of 400 sampled points land outside it.
  const notched: LayoutCell[] = [
    {
      points: [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
        { x: 6, z: 10 },
        { x: 6, z: 2 },
        { x: 4, z: 2 },
        { x: 4, z: 10 },
        { x: 0, z: 10 },
      ],
      parcel: 'cap-0',
      island: 'notched',
      status: 'healthy',
      cellId: 'notched-0',
    },
  ];
  // NON-VACUITY FIRST: the fixture really does put points in the slot, so a test that then finds
  // every returned point inside is testing the guard rather than an arithmetic that never strays.
  let strayed = 0;
  for (const seed of indices(400)) {
    const p = samplePoint(notched, propStream(seed));
    if (p !== null && cellAt(notched, p) === null) strayed += 1;
  }
  assert.ok(strayed > 0, 'the notched fixture never samples into its own slot — the guard is untested');
  // AND THE GUARD HOLDS: every point `coverPoint` hands back is inside the cell it came from.
  // Without the refusal, a bush grows in the notch — on land the island does not have.
  for (const seed of indices(200)) {
    const p = coverPoint(notched, propStream(seed), ALLOW);
    if (p === null) continue;
    assert.notEqual(cellAt(notched, p), null, `coverPoint returned (${p.x}, ${p.z}), which is off the parcel`);
  }

  // (c) THE EXCLUSION'S OWN REFUSAL, kept here beside the other two so all three routes to `null`
  //     are in one place: a point inside a parcel that the beach or the path rejects.
  assert.equal(coverPoint(HEALTHY, propStream(9), REFUSE), null);
});

test('the density argument really reaches the scatter — a bolder rung stands more', () => {
  groundSanity();
  const one = coverOn(HEALTHY, { density: 1 }).length;
  const three = coverOn(HEALTHY, { density: 3 }).length;
  assert.ok(three > one, `rung 3 stood ${three} against rung 1's ${one}`);
  // The default is the shipped pick, not rung 1 — a default that quietly stood the sparsest rung
  // would make every arm of the comparison page a lie about what ships.
  assert.equal(coverOn(HEALTHY).length, coverOn(HEALTHY, { density: COVER_DENSITY }).length);
});

test('⚠ the recipe-area option really reaches the count — a control at a PREVIOUS island size wears the count it wore, and the default is the shipped basis', () => {
  groundSanity();
  // Halving the recipe island doubles every count; the default is `RECIPE_ISLAND_AREA` exactly.
  const shipped = coverOn(HEALTHY, { density: 1 }).length;
  const explicit = coverOn(HEALTHY, { density: 1, recipeIslandArea: RECIPE_ISLAND_AREA }).length;
  const halved = coverOn(HEALTHY, { density: 1, recipeIslandArea: RECIPE_ISLAND_AREA / 2 }).length;
  assert.equal(explicit, shipped, 'the default IS the shipped basis');
  assert.ok(halved >= 2 * shipped - COVER_ROLES.length && halved <= 2 * shipped + COVER_ROLES.length, `${halved} against twice ${shipped} (rounding per role)`);
  assert.ok(halved > shipped, 'the option reached the scatter');
});

test('⚠ a runaway COUNT is refused past an absolute cap — an inverted recipe basis cannot hang the tab', () => {
  groundSanity();
  // The healthy fixture at rung 1 wears a few hundred; asked for a million times that the COUNT
  // refuses in a microsecond, naming the role and the basis, rather than materialising anything.
  assert.throws(() => coverCount('bush', HEALTHY, 1e6), /past 20000 — the recipe basis has inverted/);
  assert.throws(
    () => coverCount('bush', HEALTHY, 1, RECIPE_ISLAND_AREA / 1e6),
    (e: unknown) => e instanceof Error && /^cover-dressing: \d+ bush on one island/.test(e.message),
  );
  // And the refusal reaches the scatter through `dressCover` — at a count a materialised carpet
  // could still finish, so a guard that has gone quiet is a failure here and not a hang.
  const share = coverAreaShare(HEALTHY);
  const justOver = (COVER_COUNT_CAP + 1) / (70 * share);
  assert.throws(() => coverOn(HEALTHY, { density: justOver }), /past 20000/);
  // The cap is INCLUSIVE: exactly the cap is a count, one more is a refusal.
  const cellsArea = share * RECIPE_ISLAND_AREA;
  assert.equal(coverCount('bush', HEALTHY, COVER_COUNT_CAP / 70, cellsArea), COVER_COUNT_CAP);
  assert.throws(() => coverCount('bush', HEALTHY, (COVER_COUNT_CAP + 1) / 70, cellsArea), /past 20000/);
  assert.equal(COVER_COUNT_CAP, 20_000);
  // And the cap is generous for what the map draws: the densest rendered rung on the test island
  // is the recipe's arithmetic, an order of magnitude under it.
  const top = Math.max(...COVER_DENSITY_RUNGS);
  assert.equal(coverCount('tuft', HEALTHY, top), Math.round(120 * top * coverAreaShare(HEALTHY)));
  assert.ok(coverCount('tuft', HEALTHY, top) < COVER_COUNT_CAP / 5, `${coverCount('tuft', HEALTHY, top)}`);
});

test('a runaway area is REFUSED rather than materialised — the count is an array, not a loop bound', () => {
  groundSanity();
  // ⚠⚠ THE GUARD'S REAL SUBJECT is a hang, not a wrong picture: `indices(n)` materialises the
  // count, so a corrupted area produces a wedged tab with no message — and `check:mutation-diff`
  // scores a hang as UNPROVEN, credited to nobody. The condition is geometrically unreachable from
  // a well-formed island, so the fixture has to be one whose CELLS overlap wildly.
  const stacked = Array.from({ length: 400 }, (_, i) => ({
    points: [
      { x: 0, z: 0 },
      { x: 2000, z: 0 },
      { x: 2000, z: 2000 },
      { x: 0, z: 2000 },
    ],
    parcel: `cap-${i}`,
    island: 'stacked',
    status: 'healthy',
    cellId: `c-${i}`,
  })) satisfies LayoutCell[];
  assert.ok(coverAreaShare([stacked[0]!]) > 0, 'one such cell alone is admissible');
  assert.throws(() => coverAreaShare(stacked), /arithmetic fault in the area/);
  assert.throws(() => coverCount('bush', stacked), /arithmetic fault in the area/);
  // ⚠ THE WORDING IS PINNED, NOT JUST THE FACT OF THROWING. This message is the whole value of the
  // guard: it fires on a state a reader will believe is a large island, and if it says nothing
  // about WHY (a materialised count, so the alternative is a hung tab rather than a wrong picture)
  // it has told them to relax the ceiling. An emptied string still throws and still matches
  // nothing — which is exactly what a bare `assert.throws` cannot see.
  const why = ((): string => {
    try {
      coverAreaShare(stacked);
    } catch (e) {
      return (e as Error).message;
    }
    throw new Error('the runaway fixture did not throw at all');
  })();
  assert.match(why, /cover-dressing: an island asking for .+ recipe-islands of ground cover/);
  assert.match(why, /on a bounding box that could hold at most/);
  assert.match(why, /the count is materialised, so this would hang rather than draw/);

  // ⚠ AND THE CEILING IS THE BOUNDING BOX, so it can never sit BELOW an honest share however
  // large the island — a guard that refused a real fifty-capability story would be worse than none.
  assert.ok(boxShare(HEALTHY) >= coverAreaShare(HEALTHY), 'the box is smaller than the area it bounds');
  assert.ok(boxShare(stacked) < 400 * boxShare([stacked[0]!]) * 1.0001, 'the ceiling scaled with the fault');
});

test('an island bounding nothing wears nothing, rather than dividing by zero', () => {
  groundSanity();
  assert.equal(coverAreaShare([]), 0);
  assert.deepEqual(coverOn([]), []);
});

// ---------------------------------------------------------------------------
// the gate: green islands and nowhere else
// ---------------------------------------------------------------------------

test('⚠ ONLY A WHOLLY HEALTHY ISLAND WEARS COVER — the arc’s standing gate, by IMPORT', () => {
  groundSanity();
  // ADR-0492 D1 scopes every added layer on this arc to islands whose every cell is `healthy`.
  // ⚠ THE ARC'S ONE GATE, asserted as identity rather than as agreement: two copies of one gate
  // are two gates that agree today, and the day they diverge one layer grows on an island the
  // other refuses and the map reports a state through its scenery.
  assert.equal(coverEligible, dressingEligible);
  assert.equal(coverEligible(HEALTHY), true);
  for (const other of ['unknown', 'mapped', 'proposed', 'building', 'unhealthy', 'retired']) {
    assert.deepEqual(coverOn(island([other])), [], `${other} wore ground cover`);
  }
  // A MIXED island fails CLOSED — three healthy parcels and one that is not grows nothing at all.
  assert.deepEqual(coverOn(island(['healthy', 'healthy', 'healthy', 'mapped'])), []);
  // And a cell the substrate could not attribute is not island ground: an island of unattributed
  // cells wears nothing even when every one of them is healthy.
  const unattributed = HEALTHY.map((c) => ({ ...c, parcel: undefined }) satisfies LayoutCell);
  assert.equal(coverEligible(unattributed), true, 'the fixture must pass the STATUS gate');
  assert.deepEqual(coverOn(unattributed), [], 'cover grew on ground the map does not attribute');
});

test('nothing stands where the exclusion refuses — the beach band and the worn path', () => {
  groundSanity();
  assert.deepEqual(coverOn(HEALTHY, { exclusion: REFUSE }), []);
  // ⚠ AND IT IS CONSULTED PER POINT, not once per island: an exclusion that admits half the island
  // must stand a positive number of props and put every one of them on the admitted half.
  const half: DressingExclusion = { clear: (x) => x < ORIGIN_X + 2 * CELL_W };
  const placed = coverOn(HEALTHY, { exclusion: half });
  assert.ok(placed.length > 0, 'a half-open island stood nothing');
  for (const p of placed) assert.ok(p.at.x < ORIGIN_X + 2 * CELL_W, `a prop stood at x=${p.at.x}`);
});

test('a prop the exclusion never admits is DROPPED, and the rest still stand', () => {
  groundSanity();
  // The recipe's own answer (`rand_point` returns `None`, `sprinkle` skips) and it is honest here
  // for the reason it is dishonest for a capability's tree: ground cover reports no unit of work.
  // ⚠ A NARROW STRIP rather than a total refusal, so the drop is PARTIAL — a total refusal is
  // already covered above and cannot tell "drops the prop" from "drops the island".
  const strip: DressingExclusion = { clear: (x, z) => x < ORIGIN_X + 1 && z < ORIGIN_Z + 1 };
  const placed = coverOn(HEALTHY, { exclusion: strip });
  assert.ok(placed.length < coverOn(HEALTHY).length, 'the strip dropped nothing');
  assert.doesNotThrow(() => coverOn(HEALTHY, { exclusion: strip }));
});

test('coverPoint gives a prop up after the recipe’s own number of tries', () => {
  groundSanity();
  let asked = 0;
  const counting: DressingExclusion = {
    clear: () => {
      asked += 1;
      return false;
    },
  };
  const rand = propStream(7);
  assert.equal(coverPoint(HEALTHY, rand, counting), null);
  assert.equal(asked, COVER_TRIES, `the point was offered ${asked} times, not ${COVER_TRIES}`);
});

// ---------------------------------------------------------------------------
// the draws
// ---------------------------------------------------------------------------

test('a prop’s scale is its role’s own renormalised recipe range, and the ends are reachable', () => {
  groundSanity();
  for (const role of COVER_ROLES) {
    const range = COVER_SCALE[role as 'bush'];
    // ⚠ AT RUNG 1, which is `build_land.py` transcribed — the range is a property of the RECIPE,
    // and the size rung is a separate multiplication asserted immediately below. Reading the range
    // at the shipped rung would make this test restate `COVER_SIZE` in three places.
    assert.equal(coverScale(role, scripted([0]), 1), range.min, `${role} cannot reach its floor`);
    assert.ok(coverScale(role, scripted([0.999999]), 1) < range.max, `${role} exceeded its ceiling`);
    assert.equal(coverScale(role, scripted([0.5]), 1), (range.min + range.max) / 2);
    // ⚠ THE RUNG MULTIPLIES THE WHOLE RANGE, both ends — a rung applied to the floor alone would
    // widen the spread rather than scale the prop, and every prop would still get bigger.
    for (const rung of COVER_SIZE_RUNGS) {
      assert.equal(coverScale(role, scripted([0]), rung), range.min * rung, `${role} floor at rung ${rung}`);
      assert.equal(coverScale(role, scripted([1]), rung), range.max * rung, `${role} ceiling at rung ${rung}`);
    }
    // The omitted argument is the SHIPPED rung, never rung 1: a default of 1 would make the
    // canvas quietly stand the arm the sheet exists to reject.
    assert.equal(coverScale(role, scripted([0.5])), ((range.min + range.max) / 2) * COVER_SIZE);
  }
  // ⚠ THE RANGES ARE NOT INTERCHANGEABLE — a mutant reading one role's range for another's has to
  // fail, so the three must differ from one another.
  assert.notDeepEqual(COVER_SCALE.bush, COVER_SCALE.tuft);
  assert.notDeepEqual(COVER_SCALE.tuft, COVER_SCALE.flowerPatch);
  assert.throws(() => coverScale('tree', scripted([0])), /declares no scale range/);
});

test('a prop’s yaw is a full turn, and its assembly is chosen from its role’s own shapes', () => {
  groundSanity();
  assert.equal(coverYaw(scripted([0])), 0);
  assert.equal(coverYaw(scripted([0.25])), Math.PI / 2);
  assert.ok(coverYaw(scripted([0.999999])) < Math.PI * 2);
  // ⚠ BOTH BUSH SHAPES MUST BE REACHABLE, which is the whole reason there are two: 70 undergrowth
  // props of one silhouette per island is the "eleven identical trees" defect at five times the
  // count. Asserting only that the first is chosen would pass on an arithmetic that never
  // reached the second.
  assert.equal(coverAssembly('bush', scripted([0])), 'plant-a');
  assert.equal(coverAssembly('bush', scripted([0.99])), 'plant-b');
  assert.deepEqual(
    [0, 0.4, 0.7].map((r) => coverAssembly('tuft', scripted([r]))),
    ['tuft-a', 'tuft-b', 'tuft-c'],
  );
});

test('EVERY SHAPE THE VOCABULARY OFFERS IS ACTUALLY REACHED on one island', () => {
  groundSanity();
  // ⚠ THE END-TO-END VERSION OF THE ABOVE, and it catches what the unit assertions cannot: a
  // scatter that drew its assembly from a stream position that never varies would satisfy every
  // arithmetic test above and still stand one shape per role on a real island.
  const placed = coverOn(HEALTHY, { density: 3 });
  for (const role of COVER_ROLES) {
    const used = new Set(placed.filter((p) => p.role === role).map((p) => p.assembly));
    assert.deepEqual([...used].sort(), [...KIT_ROLE_ASSEMBLIES[role]].sort(), `${role} did not use every shape`);
  }
});

// ---------------------------------------------------------------------------
// what a cover prop IS
// ---------------------------------------------------------------------------

test('⚠⚠ NOTHING GROUND COVER STANDS REPORTS ANYTHING', () => {
  groundSanity();
  const placed = coverOn(HEALTHY);
  assert.ok(placed.length > 0, 'the fixture stood nothing to check');
  for (const p of placed) {
    assert.ok(isDressingRole(p.role), `${p.role} is not a dressing role`);
    assert.ok(isCoverPlacement(p), 'a cover prop is not recognised as one');
    // A tint is a capability's state worn on a crown. Cover holds no capability.
    assert.equal(p.tint, null, 'a cover prop wears a state’s tint');
    assert.equal(p.capId, COVER_CAP_ID, 'a cover prop claims a capability’s id');
    // ⚠ AND THE ID IS A REAL, NON-EMPTY MARKER. An emptied literal still satisfies "every cover
    // prop wears the same capId" — every one of them would wear `''`, which is also what a
    // placement carrying no capability at all looks like in a census row or a debug dump. The
    // point of the id is to be DISTINGUISHABLE from that and from any capability's own.
    assert.equal(COVER_CAP_ID, 'cover');
    assert.ok(p.capId.length > 0, 'a cover prop is indistinguishable from one with no capability');
  }
  // ⚠ AND THE DOOR IS SHUT UPSTREAM TOO: `stateForm` is the only route from a status to a role, and
  // no status the vocabulary or the store can produce reaches a dressing role. Belt and braces on
  // purpose — this one holds even if a future placement pass forgets the rule.
  for (const state of [...VOCABULARY_STATES, 'retired', 'drift', 'archived', '']) {
    const form = stateForm(state);
    if (form !== null) assert.ok(!isDressingRole(form.role), `${state} reaches ${form.role}`);
  }
});

test('⚠⚠ THE CRITERION MARKER KEEPS ITS COLOUR AND ITS SIZE — measured on what is actually placed', () => {
  groundSanity();
  // The table-level claim lives in `kit-vocabulary.test.ts`; this is the same claim asked of the
  // props a real island actually stands, which is what a reader of a picture would check.
  const placed = coverOn(HEALTHY, { density: 3 });
  const flowers = placed.filter((p) => p.role === 'flowerPatch');
  assert.ok(flowers.length > 0, 'the fixture stood no flowers to check');
  for (const p of flowers) {
    for (const object of KIT_ASSEMBLIES[p.assembly]) {
      assert.doesNotMatch(object, /red/i, `a ground-cover flower draws ${object}`);
    }
    const delivered = KIT_ROLE_SIZE.flowerPatch.units * p.scale;
    assert.ok(
      delivered < KIT_ROLE_SIZE.bloom.units / 2,
      `a flower patch delivered ${delivered.toFixed(3)} units against the marker's ${KIT_ROLE_SIZE.bloom.units}`,
    );
  }
});

test('cover sits ON the land, at the relief the ground is built at', () => {
  groundSanity();
  const flat = coverOn(HEALTHY, { relief: 0 });
  // ⚠ `===` RATHER THAN `assert.equal`, and the reason is signed zero: at relief 0 the height
  // field returns `-0` wherever its wave sum is negative-zero, and `assert.equal` distinguishes
  // the two while nothing about the picture does. What is being claimed is "no height", and
  // `-0 === 0` says exactly that.
  for (const p of flat) assert.ok(p.y === 0, `a prop floats at y=${p.y} over flat land`);
  const hilly = coverOn(HEALTHY, { relief: 3 });
  for (const p of hilly) assert.equal(p.y, landHeight(p.at.x, p.at.z, 3));
  assert.ok(
    hilly.some((p) => p.y !== 0),
    'the relief argument reached no placement — every prop is still at y = 0',
  );
});

// ---------------------------------------------------------------------------
// determinism, and what the cover may NOT move
// ---------------------------------------------------------------------------

test('two builds of one island are the same carpet, and two islands are two carpets', () => {
  groundSanity();
  assert.deepEqual(coverOn(HEALTHY), coverOn(HEALTHY));
  const other = coverOn(HEALTHY, { island: 'elsewhere' });
  assert.equal(other.length, coverOn(HEALTHY).length, 'the fixture changed size, not only seed');
  assert.notDeepEqual(
    other.map((p) => [p.at.x, p.at.z]),
    coverOn(HEALTHY).map((p) => [p.at.x, p.at.z]),
    'two islands of one shape grew the same carpet — the seed never reached the scatter',
  );
});

test('⚠ THE COVER’S SEED IS ITS OWN KEY, not the bare island seed', () => {
  groundSanity();
  // The key was chosen when the retired grove consumed the bare island seed, so the cover's stream
  // did not open on the draws the grove opened on (the first bush under the first stand's centre,
  // on every island, forever). The grove is gone; the key stays, because moving it would
  // re-scatter every carpet on the map for no reason a picture could show. Asserted at the source
  // rather than through pictures, because two pictures differ for many reasons.
  assert.notEqual(islandSeed('built|cover'), islandSeed('built'));
  const rand = propStream(islandSeed('built'));
  const first = rand();
  const coverRand = propStream(islandSeed('built|cover'));
  assert.notEqual(coverRand(), first, 'the two layers open on the same draw');
});

test('⚠⚠ ADDING THE COVER CANNOT MOVE A SINGLE THING THAT REPORTS', () => {
  groundSanity();
  // THE LOAD-BEARING PROPERTY OF THE WHOLE LAYER, and the reason the cover keeps no occupancy and
  // is placed LAST. If a bush could push a capability's pine, then scaling the cover rung — an
  // owner's LOOK decision, made off a picture — would silently re-place every signal on the map.
  const standing = dressIslandFromKit({
    cells: HEALTHY,
    facts: capabilityFactsFrom(HEALTHY),
    blooms: 3,
    buds: 0,
    wilts: 0,
    relief: 0,
    footprint: FOOT,
  });
  for (const rung of COVER_DENSITY_RUNGS) {
    const cover = coverOn(HEALTHY, { density: rung });
    assert.ok(cover.length > 0, `rung ${rung} stood nothing`);
    // Nothing in the cover pass takes the standing list at all, so this is a structural fact
    // rather than a coincidence — and asserting it end to end is what makes the structure a claim.
    assert.deepEqual(
      dressIslandFromKit({ cells: HEALTHY, facts: capabilityFactsFrom(HEALTHY), blooms: 3, buds: 0, wilts: 0, relief: 0, footprint: FOOT }),
      standing,
    );
  }
});

test('⚠ THE DETECTOR DOES NOT REPORT A BUSH AT A PINE’S FOOT — a carpet cannot overlap', () => {
  groundSanity();
  // The recipe imposes NO clearance on ground cover (`build_land.py:1082-1090` tests `inside` and
  // `wear` and nothing else), and `clearanceFactor` states the same from the detector's side. So
  // the whole dressed island — capability trees, blooms and cover together — reports zero
  // overlaps, and it does so with the cover at the BOLDEST rung the ladder declares.
  const standing = dressIslandFromKit({
    cells: HEALTHY,
    facts: capabilityFactsFrom(HEALTHY),
    blooms: 3,
    buds: 0,
    wilts: 0,
    relief: 0,
    footprint: FOOT,
  });
  const all = [...standing, ...coverOn(HEALTHY, { density: Math.max(...COVER_DENSITY_RUNGS) })];
  assert.deepEqual(dressingOverlaps(all, FOOT), [], 'the detector reported the ground cover as defects');
  // ⚠ AND IT IS STILL A DETECTOR THAT CAN FIRE. Two capability pines stacked on one point is the
  // control: an arithmetic that had stopped measuring anything would report this as clean too.
  const stacked: KitPlacement[] = [
    { ...standing[0]!, at: { x: 200, z: 0 } },
    { ...standing[1]!, at: { x: 200, z: 0 } },
  ];
  assert.equal(dressingOverlaps(stacked, FOOT).length, 1, 'the detector has stopped firing at all');
});
