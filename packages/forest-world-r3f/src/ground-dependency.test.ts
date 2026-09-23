// ground-dependency.test.ts — THE GROUND IS REBUILT WHEN THE GROUND CHANGED, AND NOT OTHERWISE.
//
// ⚠⚠ THE DEFECT THIS FILE EXISTS TO PREVENT IS A NULL ONE, which is why it is written as a COUNT.
// The bug being cured is not a wrong picture — it is the RIGHT picture, computed again, about every
// thirty seconds, for about 2 s of frozen main thread each time
// (`docs/research/land-view-performance-2026-09-15/`). Nothing a screenshot can see is wrong before
// or after, so the only honest assertion is how many times the ground was derived. `GroundInput`'s
// `revision` is that count, and every test below reads it.
//
// ⚠⚠ AND THE OPPOSITE MISTAKE IS THE EXPENSIVE ONE. A cache that never invalidates is a map that
// stops reporting: the land's colour IS a capability's proof state (ADR-0392 D5 / ADR-0398 D7), so a
// ground held stale past a status change is the map asserting a proof state that is no longer true.
// So the count is asserted in BOTH directions — the "must not rebuild" tests and the "must rebuild"
// tests are the same weight, and the totality test below makes the second set exhaustive over
// `InstanceDescriptor` rather than over whatever a reader thought to list.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRelaxedCells,
  buildScene,
  hexCenter,
  PRE_ADR0528_TILE,
  type SceneInput,
  type SceneParcelInput,
  type SceneStatus,
  type SceneTerritoryInput,
} from '@storytree/forest-world';

import {
  GROUND_BLIND_KINDS,
  createGroundInputCache,
  groundDependencyKey,
  groundInput,
  type GroundInputOptions,
} from './ground-dependency.js';
import * as groundDependency from './ground-dependency.js';
import { groundCasters, placementCasters } from './ground-casters.js';
import { KIT_FOOTPRINTS_2026_08_29, KIT_HEIGHTS_2026_08_29, isDressingRole } from './kit-vocabulary.js';
import { LAND_RELIEF_AMPLITUDE } from './land-relief.js';
import { dressMapWithCover } from './map-dressing.js';
import { islandGrowthLayout } from './ForestWorldCanvas.causal.js';
import { worldTo3D, type Descriptor3D, type InstanceDescriptor } from './world-to-3d.js';

const TUNED = { hexR: PRE_ADR0528_TILE.hexR } as const;

const OPTS: GroundInputOptions = {
  relief: LAND_RELIEF_AMPLITUDE,
  footprint: KIT_FOOTPRINTS_2026_08_29,
  height: KIT_HEIGHTS_2026_08_29,
};

// ---------------------------------------------------------------------------
// the fixture — a real two-island map, built through the shipped path
// ---------------------------------------------------------------------------

const TILES_A = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }] as const;
const TILES_B = [{ q: 9, r: 0 }, { q: 10, r: 0 }, { q: 9, r: 1 }] as const;

function criteria(prefix: string, total: number, signed: number) {
  return Array.from({ length: total }, (_, i) => ({
    id: `${prefix}-uat-${i}`,
    state: (i < signed ? 'proven' : 'pending') as 'proven' | 'pending',
  }));
}

function territory(
  id: string,
  tiles: readonly { q: number; r: number }[],
  caps: readonly string[],
  uat: { total: number; signed: number },
  status: SceneStatus,
  wisps: readonly string[],
): SceneTerritoryInput {
  const centres = tiles.map((h) => hexCenter(h, TUNED));
  const cx = centres.reduce((s, c) => s + c.x, 0) / centres.length;
  const cy = centres.reduce((s, c) => s + c.y, 0) / centres.length;
  const parcels: SceneParcelInput[] = caps.map((capId, i) => ({
    capId,
    status,
    testCount: 3,
    theme: 'meadow',
    seed: hexCenter(tiles[i % tiles.length]!, TUNED),
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
    wisps: wisps.map((runId) => ({ runId, title: runId })),
    parcels,
    uatCriteria: criteria(id, uat.total, uat.signed),
    plate: { w: 120, h: 33, rx: 7, idY: 14, subY: 27, idText: id, subText: id, title: id },
  };
}

interface MapShape {
  /** `atlas`'s folded status — the thing the map REPORTS, so a change here must rebuild. */
  readonly statusA?: SceneStatus;
  /** How many of `atlas`'s criteria are signed — a bloom count, which stands on the ground. */
  readonly signedA?: number;
  /** In-flight build wisps on `atlas` — the LIVE signal, which must NOT rebuild. */
  readonly wispsA?: readonly string[];
}

/**
 * THE MAP, BUILT FRESH EVERY CALL, and NOT memoised — which is the opposite of the neighbouring
 * fixtures' choice and is load-bearing here. The whole subject of this file is whether two
 * SEPARATELY BUILT streams of the same content are treated as one ground, so a fixture that handed
 * back the same array twice would make every "does not rebuild" test below pass on array identity
 * and prove nothing at all.
 */
function forest(shape: MapShape = {}): Descriptor3D[] {
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
    relaxedCells: buildRelaxedCells(drawTiles, wheatSets, 'mesh', TUNED),
    drawTiles,
    wheatSets,
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: [
      territory(
        'atlas',
        TILES_A,
        ['atlas-parse', 'atlas-store'],
        { total: 6, signed: shape.signedA ?? 4 },
        shape.statusA ?? 'healthy',
        shape.wispsA ?? [],
      ),
      territory('beacon', TILES_B, ['beacon-emit'], { total: 5, signed: 2 }, 'healthy', []),
    ],
    vegetation: {},
    tile: TUNED,
  };
  return worldTo3D(buildScene(input));
}

const countKind = (map: readonly Descriptor3D[], kind: string) =>
  map.filter((d) => d.kind === kind).length;

// ---------------------------------------------------------------------------
// the fixture is honest before anything is asserted about the caching
// ---------------------------------------------------------------------------

test('NON-VACUITY: the fixture is a real two-island forest that really carries wisps', () => {
  const plain = forest();
  const live = forest({ wispsA: ['run-1', 'run-2'] });

  // ⚠ A fixture with no ground would let every "does not rebuild" assertion below pass over an
  // empty key, and a fixture with no WISPS would let the exclusion pass because there was nothing
  // to exclude — which is the exact shape that makes a cache test vacuous.
  assert.ok(countKind(plain, 'cell-ground') > 0, 'the fixture draws ground');
  assert.ok(countKind(plain, 'uat-bloom') > 0, 'the fixture signs criteria');
  assert.equal(countKind(plain, 'wisp-sprite'), 0, 'the quiet arm carries no wisp');
  assert.equal(countKind(live, 'wisp-sprite'), 2, 'the live arm carries both wisps');
  assert.equal(
    new Set(plain.filter((d) => d.kind === 'cell-ground').map((d) => (d.kind === 'skipped' ? '' : d.island))).size,
    2,
    'the fixture really is two islands',
  );

  const built = groundInput(plain, OPTS, 0);
  assert.ok(built.cells.length > 0, 'the ground input carries parcels');
  assert.ok(built.placements.length > 0, 'the ground input stands objects on them');
  assert.ok(built.casters.length > 0, 'and those objects cast');
});

// ---------------------------------------------------------------------------
// MUST NOT REBUILD — the whole cure
// ---------------------------------------------------------------------------

test('a scene rebuilt with the same content is the same ground — the poll that changes nothing', () => {
  const cache = createGroundInputCache(OPTS);
  const first = cache(forest());
  const again = cache(forest());
  const third = cache(forest());

  assert.equal(first.revision, 0);
  assert.equal(again.revision, 0, 'the second stream rebuilt the ground');
  assert.equal(third.revision, 0, 'the third stream rebuilt the ground');
  assert.equal(again, first, 'React keys on identity, so the object itself must be the same one');
  assert.equal(third, first);
});

test('fcd-ground-cache-compares-content-without-serializing: an equal fresh stream reuses the warmed ground without String conversion', () => {
  // Build both streams before replacing String: fixture construction is deliberately outside the
  // observation, so the count belongs only to the cache's equal-content comparison.
  const warmedStream = forest();
  const equalFreshStream = forest();
  const cache = createGroundInputCache(OPTS);
  const warmed = cache(warmedStream);
  const originalString = globalThis.String;
  let conversions = 0;

  try {
    globalThis.String = ((value?: unknown) => {
      conversions += 1;
      return originalString(value);
    }) as StringConstructor;

    const reused = cache(equalFreshStream);
    assert.equal(reused, warmed, 'equal fresh content must reuse the exact warmed GroundInput');
    assert.equal(conversions, 0, 'comparing equal ground dependencies serialized descriptor fields');
  } finally {
    globalThis.String = originalString;
  }
});

test('fcd-ground-cache-short-circuits-on-first-change: the first ground-visible mismatch decides before trailing fields are read', () => {
  type GroundDependencyModule = typeof groundDependency & {
    readonly sameGroundDependencies?: (left: readonly Descriptor3D[], right: readonly Descriptor3D[]) => boolean;
  };
  const sameGroundDependencies = (groundDependency as GroundDependencyModule).sameGroundDependencies;

  // This is intentionally an assertion red, rather than an import failure: the eventual export is
  // an observation seam for the exact comparator the cache uses.
  assert.equal(typeof sameGroundDependencies, 'function', 'the cache must expose its dependency comparator');
  if (typeof sameGroundDependencies !== 'function') return;

  const caveAt = (x: number): InstanceDescriptor => ({
    kind: 'cave-arch',
    transform: { x, y: 0, z: 0 },
    group: 'cave-arch',
  });
  let groupReads = 0;
  const observedTrailGhost: InstanceDescriptor = {
    kind: 'trail-ghost-strip',
    transform: { x: 4, y: 0, z: 0 },
    get group() {
      groupReads += 1;
      return 'trail-ghost-strip';
    },
  };
  const plainTrailGhost: InstanceDescriptor = {
    kind: 'trail-ghost-strip',
    transform: { x: 4, y: 0, z: 0 },
    group: 'trail-ghost-strip',
  };

  assert.equal(
    sameGroundDependencies([caveAt(0), observedTrailGhost], [caveAt(0), plainTrailGhost]),
    true,
    'equal streams are equal',
  );
  assert.ok(groupReads > 0, 'the equal control proves the comparator reads the trailing descriptor');

  groupReads = 0;
  assert.equal(
    sameGroundDependencies([caveAt(0), observedTrailGhost], [caveAt(1), plainTrailGhost]),
    false,
    'the first cave position mismatch makes the streams unequal',
  );
  assert.equal(groupReads, 0, 'the comparator read a trailing descriptor after the first mismatch');
});

test('a wisp arriving, moving or leaving is not a ground change', () => {
  const cache = createGroundInputCache(OPTS);
  const quiet = cache(forest());
  assert.equal(cache(forest({ wispsA: ['run-1'] })).revision, 0, 'a wisp arriving rebuilt the ground');
  assert.equal(cache(forest({ wispsA: ['run-2'] })).revision, 0, 'a wisp moving rebuilt the ground');
  assert.equal(cache(forest({ wispsA: ['run-1', 'run-2'] })).revision, 0, 'a second wisp rebuilt the ground');
  assert.equal(cache(forest()).revision, 0, 'the wisps leaving rebuilt the ground');
  assert.equal(cache(forest({ wispsA: ['run-3'] })), quiet, 'and it is still the same object');
});

test('THE EXCLUSION IS JUSTIFIED, not assumed: the real ground readers ignore a wisp', () => {
  // ⚠⚠ THIS IS THE TEST THAT MAKES THE EXCLUSION HONEST. `LIVE_KINDS` is a claim about what the
  // ground chain reads, and a claim about someone else's module rots silently. So rather than trust
  // it, drive the ACTUAL readers — the dressing and the casters — with and without the wisps and
  // refuse any difference. If a reader ever starts consuming a wisp, this fails here, on the
  // sentence that would otherwise have gone quietly wrong.
  const quiet = forest();
  const live = forest({ wispsA: ['run-1', 'run-2'] });
  assert.equal(countKind(live, 'wisp-sprite'), 2, 'non-vacuity: there are wisps to ignore');

  const dressOf = (m: readonly Descriptor3D[]) =>
    dressMapWithCover(m, { relief: OPTS.relief, footprint: OPTS.footprint });
  assert.deepEqual(dressOf(live), dressOf(quiet), 'the kit dressing read a wisp');
  assert.deepEqual(groundCasters(live), groundCasters(quiet), 'a wisp cast a shadow on the ground');
});

test('the cached ground is the one an uncached derivation would have produced', () => {
  // A cache that returns something OTHER than the real answer would pass every count above and
  // draw the wrong map. The revision is the only field allowed to differ.
  const cache = createGroundInputCache(OPTS);
  const map = forest({ wispsA: ['run-1'] });
  assert.deepEqual(cache(map), groundInput(map, OPTS, 0));

  const changed = forest({ statusA: 'unhealthy' });
  assert.deepEqual(cache(changed), groundInput(changed, OPTS, 1));
});

// ---------------------------------------------------------------------------
// MUST REBUILD — the direction a cache gets wrong
// ---------------------------------------------------------------------------

test('a capability going unhealthy rebuilds the ground — the map may not report a stale state', () => {
  const cache = createGroundInputCache(OPTS);
  const healthy = cache(forest());
  const ill = cache(forest({ statusA: 'unhealthy' }));
  assert.equal(ill.revision, 1, 'a status change did not rebuild the ground');
  assert.notEqual(ill, healthy);
  assert.equal(cache(forest()).revision, 2, 'going back did not rebuild it either — one slot, not a map');
});

test('a criterion being signed rebuilds the ground — a bloom stands on it and casts', () => {
  const cache = createGroundInputCache(OPTS);
  cache(forest({ signedA: 4 }));
  assert.equal(cache(forest({ signedA: 5 })).revision, 1, 'a new signature did not rebuild the ground');
});

// ---------------------------------------------------------------------------
// ONE PLACEMENT, TWO READERS — the rule this derivation inherited when it moved
// ---------------------------------------------------------------------------

test('ONE PLACEMENT, TWO READERS: the casters are made from the same list KitProps draws', () => {
  // ⚠⚠ INHERITED FROM `harness/shipped-baseline.test.ts` ON 2026-09-15, and DRIVEN rather than
  // parsed. Until 2026-09-03 `KitProps` computed its own placement from the LOADED kit — after the
  // ground was built — so no kit object reached the occlusion field and every pine and bloom
  // floated over a ground shaded by the story tree alone. The remedy is structural: ONE placement,
  // made synchronously off the FROZEN footprints, spread into the casters AND handed to `KitProps`.
  // A derivation that made it twice would have a tree and its shadow as two lists that agree today.
  //
  // ⚠ IT IS A BEHAVIOUR BECAUSE IT HAS TO BE: `check:mutation-diff` instruments this module, so a
  // source parse over it would read Stryker's rewritten text and fail every run. That is a real
  // constraint on where such a claim may live, not a preference.
  const map = forest({ wispsA: ['run-1'] });
  const built = groundInput(map, OPTS, 0);

  assert.deepEqual(
    built.placements,
    dressMapWithCover(map, { relief: OPTS.relief, footprint: OPTS.footprint }),
    'the placement is made once, from the FROZEN footprints, off the whole descriptor stream',
  );
  assert.deepEqual(
    built.casters,
    [
      ...groundCasters(map),
      ...placementCasters(built.placements, OPTS.footprint, OPTS.height),
    ],
    'the ground’s casters are the descriptor families UNIONED with one caster per placement',
  );
  assert.deepEqual(
    built.growthLayout,
    islandGrowthLayout(built.cells),
    'the immutable ground build carries the same stable slots and anchors delivery reads',
  );
  assert.equal(
    built.islandByPlacement.size,
    built.placements.length,
    'every map placement retains the exact producing island through delivery; no geometry inference is needed',
  );
  for (const placement of built.placements) {
    assert.ok(built.islandByPlacement.has(placement), 'the sidecar is keyed by the exact returned placement object');
  }
  // ⚠ THE COVERED DRESSING, NOT THE VOCABULARY ALONE. `dressMapFromKit` would pass the shape of
  // every assertion above while quietly reverting every healthy island's ground cover.
  assert.ok(
    built.placements.some((p) => isDressingRole(p.role)),
    'the derivation must stand the COVERED dressing — ground cover, not the vocabulary alone',
  );
});

// ---------------------------------------------------------------------------
// TOTALITY — every field of the descriptor, held by the compiler
// ---------------------------------------------------------------------------

/** A fully-populated descriptor: every optional present, so a mutation of any one of them is a
 *  mutation of a value the digest actually saw. */
const FULL: Required<InstanceDescriptor> = {
  kind: 'trail-strip',
  transform: { x: 1, y: 2, z: 3 },
  group: 'trail-strip',
  material: 'healthy',
  points: [{ x: 4, y: 5, z: 6 }, { x: 7, y: 8, z: 9 }],
  width: 10,
  usage: 2,
  hidden: false,
  segment: 'seg-1',
  edges: ['a->b', 'b->c'],
  bearing: 0.5,
  island: 'atlas',
  criterion: 'atlas-uat-0',
  parcel: 'atlas-parse',
};

/**
 * ONE DIFFERENT VALUE PER FIELD — and the type is what makes this exhaustive.
 *
 * ⚠⚠ `Record<keyof InstanceDescriptor, …>` is the mechanism, not the documentation. Add a field to
 * `InstanceDescriptor` and this object stops compiling until someone states how to change it; forget
 * to digest that field and the loop below fails. Without the total record this test would only ever
 * cover the fields whoever wrote it happened to think of — which is precisely how a ground goes
 * stale about one thing while every test stays green.
 */
const OTHER = {
  kind: { kind: 'trail-ghost-strip' },
  transform: { transform: { x: 1, y: 2, z: 3.5 } },
  group: { group: 'trail-ghost-strip' },
  material: { material: 'unhealthy' },
  points: { points: [{ x: 4, y: 5, z: 6 }, { x: 7, y: 8, z: 9.5 }] },
  width: { width: 11 },
  usage: { usage: 3 },
  hidden: { hidden: true },
  segment: { segment: 'seg-2' },
  edges: { edges: ['a->b', 'b->d'] },
  bearing: { bearing: 0.75 },
  island: { island: 'beacon' },
  criterion: { criterion: 'atlas-uat-1' },
  parcel: { parcel: 'atlas-store' },
  // ⚠ `satisfies`, NOT AN ANNOTATION (`anti-slop/no-known-value-widening`). It buys the same
  // exhaustiveness — a missing key still fails to compile — without widening the value away.
} satisfies Record<keyof InstanceDescriptor, Partial<InstanceDescriptor>>;

test('TOTALITY: every field of a descriptor is in the key', () => {
  const base = groundDependencyKey([FULL]);
  for (const [field, patch] of Object.entries(OTHER)) {
    assert.notEqual(
      groundDependencyKey([{ ...FULL, ...patch }]),
      base,
      `changing \`${field}\` did not change the ground key — the ground stops noticing it`,
    );
  }
  assert.equal(
    Object.keys(OTHER).length,
    Object.keys(FULL).length,
    'the mutation table and the descriptor disagree about how many fields there are',
  );
});

test('an absent field is not an empty one — asserted per field kind, not once for all of them', () => {
  // ⚠ ONE ASSERTION PER OPTIONAL SHAPE, and that is what makes this test able to fail. Written as a
  // single descriptor carrying every empty at once, it stayed green while the STRING branch was
  // broken, because the point list alone still told the two apart. Absence and emptiness are
  // different grounds in each of the three shapes, so each is asked separately.
  const base: InstanceDescriptor = { kind: 'cave-arch', transform: { x: 0, y: 0, z: 0 }, group: 'g' };
  const key = (d: InstanceDescriptor) => groundDependencyKey([d]);
  assert.notEqual(key({ ...base, material: '' }), key(base), 'an empty string is not an absent string');
  assert.notEqual(key({ ...base, points: [] }), key(base), 'an empty ring is not an absent ring');
  assert.notEqual(key({ ...base, edges: [] }), key(base), 'an empty edge list is not an absent one');
});

test('a field whose VALUE spells "undefined" is not an absent field', () => {
  // ⚠ NOT A CURIOSITY. `island`, `parcel` and `criterion` carry AUTHORED ids — a capability id is
  // whatever a story-author typed — so the literal text is reachable, and a digest that wrote the
  // word for absence would call a parcel named `undefined` the same ground as no parcel at all.
  const base: InstanceDescriptor = { kind: 'cell-ground', transform: { x: 0, y: 0, z: 0 }, group: 'g' };
  assert.notEqual(
    groundDependencyKey([{ ...base, parcel: 'undefined' }]),
    groundDependencyKey([base]),
  );
});

test('the key of nothing is nothing, and one drawable descriptor is one record', () => {
  // The shape of the key itself, so it cannot quietly acquire a constant prefix or lose the record
  // boundary that separates two descriptors.
  const a: InstanceDescriptor = { kind: 'cell-ground', transform: { x: 0, y: 0, z: 0 }, group: 'g' };
  const b: InstanceDescriptor = { ...a, island: 'beacon' };
  assert.equal(groundDependencyKey([]), '');
  assert.equal(groundDependencyKey([a]).split('\u0002').length, 1);
  assert.equal(groundDependencyKey([a, b]).split('\u0002').length, 2);
  // And the families it is blind to take no record either.
  const wisp: InstanceDescriptor = { kind: 'wisp-sprite', transform: { x: 0, y: 0, z: 0 }, group: 'w' };
  assert.equal(groundDependencyKey([a, wisp, { kind: 'skipped', sceneKind: 'tree' }]).split('\u0002').length, 1);
});

test('the digest cannot be fooled by moving a character across a boundary', () => {
  // ⚠ SEPARATORS ARE LOAD-BEARING, and a digest that joins on nothing is a digest that calls two
  // different grounds equal. Each pair below differs ONLY in where one string ends and the next
  // begins — which is exactly what a missing separator erases.
  const at = (group: string, material: string): InstanceDescriptor => ({
    kind: 'cell-ground',
    transform: { x: 0, y: 0, z: 0 },
    group,
    material,
  });
  assert.notEqual(groundDependencyKey([at('ab', 'c')]), groundDependencyKey([at('a', 'bc')]), 'field boundary');

  const one: InstanceDescriptor = { kind: 'cell-ground', transform: { x: 0, y: 0, z: 0 }, group: 'ab' };
  const two: InstanceDescriptor = { kind: 'cell-ground', transform: { x: 0, y: 0, z: 0 }, group: 'a' };
  const three: InstanceDescriptor = { kind: 'cell-ground', transform: { x: 0, y: 0, z: 0 }, group: 'b' };
  assert.notEqual(groundDependencyKey([one]), groundDependencyKey([two, three]), 'record boundary');

  // A string list's own boundary, twice over: the LENGTH prefix (two edges, or one edge with a
  // comma in it) and the separator BETWEEN them (two lists of the same length whose contents only
  // differ in where one entry ends — which the prefix alone cannot tell apart).
  const edged = (edges: string[]): InstanceDescriptor => ({ ...one, kind: 'trail-strip', edges });
  assert.notEqual(groundDependencyKey([edged(['a', 'b'])]), groundDependencyKey([edged(['a,b'])]), 'list length');
  assert.notEqual(groundDependencyKey([edged(['a', 'bc'])]), groundDependencyKey([edged(['ab', 'c'])]), 'list boundary');

  // And a ring's own: two rings of the SAME length differing only in where one number ends.
  const ringed = (points: { x: number; y: number; z: number }[]): InstanceDescriptor => ({ ...one, points });
  assert.notEqual(
    groundDependencyKey([ringed([{ x: 1, y: 23, z: 4 }])]),
    groundDependencyKey([ringed([{ x: 12, y: 3, z: 4 }])]),
    'ring boundary',
  );
  assert.notEqual(
    groundDependencyKey([ringed([{ x: 1, y: 2, z: 3 }])]),
    groundDependencyKey([ringed([{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }])]),
    'ring length',
  );
});

test('order is part of the key, because the dressing groups in first-seen order', () => {
  const a: InstanceDescriptor = { kind: 'cell-ground', transform: { x: 0, y: 0, z: 0 }, group: 'g', island: 'atlas' };
  const b: InstanceDescriptor = { ...a, island: 'beacon' };
  assert.notEqual(groundDependencyKey([a, b]), groundDependencyKey([b, a]));
});

test('a skip record is out of the key — a wisp is four scene nodes and three of them skip', () => {
  // ⚠ THE COUNTER-INTUITIVE ONE, and the reason it is asserted rather than assumed. A skip is an
  // audit marker nothing draws, so keeping it in the digest looks free — and it is not: `wisp-hit`,
  // `wisp-glow` and `wisp-dot` all skip, so a digest holding skips moves every time a session claims
  // or releases a capability, which is precisely the rebuild this module exists to stop.
  assert.equal(
    groundDependencyKey([{ kind: 'skipped', sceneKind: 'tree' }]),
    groundDependencyKey([{ kind: 'skipped', sceneKind: 'wisp-dot' }]),
  );
  assert.equal(groundDependencyKey([{ kind: 'skipped', sceneKind: 'tree' }]), groundDependencyKey([]));
});

test('the live families are excluded from the key, and they are named rather than counted', () => {
  assert.deepEqual([...GROUND_BLIND_KINDS], ['wisp-sprite']);
  const wisp: InstanceDescriptor = { kind: 'wisp-sprite', transform: { x: 0, y: 0, z: 0 }, group: 'wisp-sprite' };
  const moved: InstanceDescriptor = { ...wisp, transform: { x: 99, y: 0, z: 0 } };
  assert.equal(groundDependencyKey([wisp]), groundDependencyKey([moved]));
  assert.equal(groundDependencyKey([wisp]), groundDependencyKey([]));
});

test('a drawable family LEAVING the stream is still a ground change', () => {
  // The exclusions must not be read as "anything that disappears is fine": a cave portal that stops
  // being drawn is ground that stops being darkened, and it must rebuild.
  const cave: InstanceDescriptor = { kind: 'cave-arch', transform: { x: 0, y: 0, z: 0 }, group: 'cave-arch' };
  assert.notEqual(groundDependencyKey([cave]), groundDependencyKey([]));
  assert.notEqual(groundDependencyKey([cave]), groundDependencyKey([{ kind: 'skipped', sceneKind: 'cave' }]));
});

// ---------------------------------------------------------------------------
// THE CACHE COMPARES WITHOUT THE KEY — and must still mean exactly what the key means
// ---------------------------------------------------------------------------

test('the cache comparator agrees with the ground key on every pair the key tells apart, both ways round', () => {
  // ⚠⚠ THE KEY IS THE ORACLE, AND THAT IS WHY THIS TEST CAN FAIL. The cache no longer builds the key:
  // it compares descriptors field by field (`sameGroundDependencies`), so every rule the key's own
  // tests pin above — totality, absent versus empty, NaN, list and ring boundaries, order, skips,
  // wisps — is now a rule this second comparison has to keep separately. A field it forgot, or a
  // branch that answered wrongly, would serve a stale ground with every key test still green. So
  // each pair below is asked of BOTH, and they must agree.
  const same = groundDependency.sameGroundDependencies;
  const plain: InstanceDescriptor = { kind: 'cave-arch', transform: { x: 0, y: 0, z: 0 }, group: 'g' };
  const at = (x: number, y: number, z: number): InstanceDescriptor => ({ ...plain, transform: { x, y, z } });
  const ringed = (points: { x: number; y: number; z: number }[]): InstanceDescriptor => ({ ...plain, points });
  const edged = (edges: string[]): InstanceDescriptor => ({ ...plain, kind: 'trail-strip', edges });
  const cell = (island: string): InstanceDescriptor => ({ kind: 'cell-ground', transform: { x: 0, y: 0, z: 0 }, group: 'g', island });
  const wisp: InstanceDescriptor = { kind: 'wisp-sprite', transform: { x: 0, y: 0, z: 0 }, group: 'wisp-sprite' };
  const skip = (sceneKind: string): Descriptor3D => ({ kind: 'skipped', sceneKind });

  const pairs: [string, readonly Descriptor3D[], readonly Descriptor3D[]][] = [
    ...Object.entries(OTHER).map(
      ([field, patch]): [string, readonly Descriptor3D[], readonly Descriptor3D[]] => [
        `\`${field}\` alone`,
        [FULL],
        [{ ...FULL, ...patch }],
      ],
    ),
    ['a fully-populated copy', [FULL], [structuredClone(FULL)]],
    ['position x alone', [at(0, 0, 0)], [at(1, 0, 0)]],
    ['position y alone', [at(0, 0, 0)], [at(0, 1, 0)]],
    ['an empty string against an absent one', [plain], [{ ...plain, material: '' }]],
    ['an empty ring against an absent one', [plain], [{ ...plain, points: [] }]],
    ['an empty edge list against an absent one', [plain], [{ ...plain, edges: [] }]],
    ['a zero width against an absent one', [plain], [{ ...plain, width: 0 }]],
    ['a parcel spelled "undefined"', [plain], [{ ...plain, parcel: 'undefined' }]],
    ['two NaN positions', [at(Number.NaN, 0, 0)], [at(Number.NaN, 0, 0)]],
    ['a NaN position against zero', [at(Number.NaN, 0, 0)], [at(0, 0, 0)]],
    ['two NaN widths', [{ ...plain, width: Number.NaN }], [{ ...plain, width: Number.NaN }]],
    ['a NaN width against an absent one', [{ ...plain, width: Number.NaN }], [plain]],
    ['two rings holding NaN', [ringed([{ x: Number.NaN, y: 1, z: 2 }])], [ringed([{ x: Number.NaN, y: 1, z: 2 }])]],
    ['a ring point differing in x alone', [ringed([{ x: 1, y: 2, z: 3 }])], [ringed([{ x: 9, y: 2, z: 3 }])]],
    ['a ring point differing in y alone', [ringed([{ x: 1, y: 2, z: 3 }])], [ringed([{ x: 1, y: 9, z: 3 }])]],
    ['a ring point differing in z alone', [ringed([{ x: 1, y: 2, z: 3 }])], [ringed([{ x: 1, y: 2, z: 9 }])]],
    ['a ring one point longer', [ringed([{ x: 1, y: 2, z: 3 }])], [ringed([{ x: 1, y: 2, z: 3 }, { x: 1, y: 2, z: 3 }])]],
    ['a ring differing only at its last point', [ringed([{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }])], [ringed([{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 7 }])]],
    ['two equal rings built separately', [ringed([{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }])], [ringed([{ x: 1, y: 2, z: 3 }, { x: 4, y: 5, z: 6 }])]],
    ['an edge list one entry longer', [edged(['a', 'b'])], [edged(['a,b'])]],
    ['an edge list that is a prefix of the other', [edged(['a'])], [edged(['a', 'b'])]],
    ['an edge moved across a boundary', [edged(['a', 'bc'])], [edged(['ab', 'c'])]],
    ['an edge list differing only at its last entry', [edged(['a', 'b'])], [edged(['a', 'c'])]],
    ['two equal edge lists built separately', [edged(['a', 'b'])], [edged(['a', 'b'])]],
    ['two empty streams', [], []],
    ['a drawable against nothing', [plain], []],
    ['one record against two', [cell('atlas')], [cell('atlas'), cell('beacon')]],
    ['the same two records in the other order', [cell('atlas'), cell('beacon')], [cell('beacon'), cell('atlas')]],
    ['two skips of different scene kinds', [skip('tree')], [skip('wisp-dot')]],
    ['a skip against nothing', [cell('atlas'), skip('tree')], [cell('atlas')]],
    ['a drawable against a skip in its place', [plain], [skip('cave')]],
    ['a wisp that moved', [wisp], [{ ...wisp, transform: { x: 99, y: 0, z: 0 } }]],
    ['a wisp against nothing', [cell('atlas'), wisp], [cell('atlas')]],
    ['the real forest, rebuilt', forest(), forest()],
    ['the real forest, with wisps arriving', forest(), forest({ wispsA: ['run-1', 'run-2'] })],
    ['the real forest, with a criterion signed', forest(), forest({ signedA: 5 })],
  ];

  for (const [name, left, right] of pairs) {
    const expected = groundDependencyKey(left) === groundDependencyKey(right);
    assert.equal(same(left, right), expected, `${name}: the comparator disagrees with the ground key`);
    assert.equal(same(right, left), expected, `${name}, reversed: the comparator disagrees with the ground key`);
  }
  // NON-VACUITY: the table holds both answers, so a comparator that always said one of them fails it.
  const answers = new Set(pairs.map(([, left, right]) => groundDependencyKey(left) === groundDependencyKey(right)));
  assert.equal(answers.size, 2, 'the pair table must hold equal AND unequal streams');
});

test('a descriptor edited in place after the cache saw it is still a ground change', () => {
  // ⚠ THE CACHE HOLDS A COPY, NOT THE CALLER'S OBJECTS. Holding the objects it was handed, an edit made
  // to one of them in place would change both sides of the comparison at once, and the next call
  // would be served the stale ground. Each nested part a descriptor carries is edited on its own.
  const edits: [string, (d: InstanceDescriptor) => void][] = [
    ['its position', (d) => { d.transform.x += 1; }],
    ['a point of its ring', (d) => { d.points![0]!.x += 1; }],
    ['an entry of its edge list', (d) => { d.edges![0] = 'z->y'; }],
  ];
  for (const [part, edit] of edits) {
    const strip = structuredClone(FULL);
    const stream: Descriptor3D[] = [...forest(), strip];
    const cache = createGroundInputCache(OPTS);
    const first = cache(stream);
    edit(strip);
    const next = cache(stream);
    assert.notEqual(next, first, `${part}, edited in place, came back as the stale ground`);
    assert.equal(next.revision, first.revision + 1, `${part}, edited in place, must rebuild exactly once`);
  }
});
