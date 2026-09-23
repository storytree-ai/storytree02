// packWorld — the RULES the relocation golden cannot see.
//
// `relocation.test.ts` compares the whole map against a frozen capture, which is the strongest
// oracle this package has and catches any change to a branch the fixture's fourteen stories reach.
// It is blind in exactly one way: a rule the fixture's corpus never exercises is a rule it cannot
// witness, and a rule whose two readings agree on that corpus is one it cannot separate. This file
// is the other half — small, purpose-built corpora that put each such rule under load, and
// assertions on the RULE rather than on the number the code happens to produce.
//
// Every corpus here is built for one question. That is deliberate: a fixture grown to serve several
// stops describing any of them, and the frozen golden's corpus cannot grow at all without
// invalidating the capture that makes it a proof.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AXIAL_DIRS,
  HEX_R,
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  axialKey,
  estRadius,
  groundFlattening,
  groundRadiusToScreenHalfHeight,
  hash,
  hexCenter,
  pixelToHex,
  rand01,
  storyTreeReach,
  tileQuota,
  tileUnits,
} from '@storytree/forest-world';

import { packWorld, type LayoutStory } from './pack.js';
import { ISLAND_SPACING_RATIO, PRE_ADR0521_SPACING, gapBetween, loneSwing } from './spacing.js';

const caps = (prefix: string, n: number, dependsOn: readonly string[] = []) =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}-${i + 1}`, dependsOn: i === 0 ? dependsOn : [] }));

const story = (id: string, n: number, dependsOn: readonly string[] = [], capDeps: readonly string[] = []): LayoutStory => ({
  id,
  dependsOn,
  capabilities: caps(id, n, capDeps),
});

// ---------------------------------------------------------------------------------------------
// The OPTIONS argument is genuinely optional — every read of it is guarded
// ---------------------------------------------------------------------------------------------

test('packWorld takes no options at all, and that is the same as taking empty ones', () => {
  const stories = [story('root', 3), story('leaf', 2, ['root'])];

  // Called with NOTHING. Each `opts?.…` read below is the only thing standing between this call
  // and a TypeError, so a suite that always passes an object cannot tell the guard from its absence.
  const bare = packWorld(stories);
  assert.equal(bare.territories.length, 2);

  const empty = packWorld(stories, {});
  assert.deepEqual(JSON.parse(JSON.stringify(bare)), JSON.parse(JSON.stringify(empty)));

  // …and the four defaults it falls back to are the SHIPPED ones, not merely "something".
  const explicit = packWorld(stories, {
    plantsScatter: false,
    spacing: { ratio: ISLAND_SPACING_RATIO },
    carriedIcons: new Map(),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(bare)), JSON.parse(JSON.stringify(explicit)));
  assert.ok(bare.territories.every((t) => t.stamps.length === 0), 'no icons carried by default');
});

// ---------------------------------------------------------------------------------------------
// A forest with NO roads — the branch that returns an empty network without running the router
// ---------------------------------------------------------------------------------------------

test('a corpus with no edges yields the empty trail network, fully formed', () => {
  const stories = [story('alpha', 2), story('beta', 3), story('gamma', 1)];
  const world = packWorld(stories);

  // The SHAPE is the assertion, not just "no segments": the short-circuit builds this object by
  // hand, so each of its four fields must be a real empty array a consumer can iterate. A caller
  // reading `trails.dropped.length` must not meet `undefined` on the very map that drops nothing.
  assert.deepEqual(world.trails, { segments: [], edges: [], caves: [], dropped: [] });
  for (const k of ['segments', 'edges', 'caves', 'dropped'] as const) {
    assert.ok(Array.isArray(world.trails[k]), `${k} must be an array`);
    assert.equal(world.trails[k].length, 0, `${k} must be empty`);
  }

  // And the islands are still laid out — no edges is a forest, not an error.
  assert.deepEqual(world.territories.map((t) => t.story.id).sort(), ['alpha', 'beta', 'gamma']);
});

// ---------------------------------------------------------------------------------------------
// The ROW TIE-BREAK — two islands whose dependency barycentres are identical
// ---------------------------------------------------------------------------------------------

test('two islands with the SAME barycentre order by the id hash, not by input order', () => {
  // Both dependents hang off the one root, so `baryOf` gives them the identical number and the
  // comparator falls through to `(hash(a) % 997) - (hash(b) % 997)`. Without that fallthrough the
  // row order would be whatever the input happened to be, which is the thing being pinned.
  //
  // ⚠ SIBLING QUOTA IS 3, NOT 2 (ADR-0593 D1). This fixture pins a TIE, and the tie itself is
  // structural — both siblings depend on nothing but `root`, so `baryOf` gives them the identical
  // number at any quota. But at quota 2 the two seeds' hex-snapped positions land `hexDist` 3 apart
  // (measured), one short of the pair's growth floor of 4, so the eastward nudge-apart pass fires.
  // That pass walks seeds by ARRAY INDEX (`for (i) for (j>i)`) and always nudges the
  // higher-indexed one — so which of the two hash-tied islands got nudged, and therefore where it
  // landed, silently became a function of INPUT ORDER instead of the id hash this test exists to
  // pin.
  //
  // ⚠ WHAT TRIGGERED IT IS NOW HISTORY, and it was a symptom of the defect
  // `the-packer-decides-in-ground-space-not-through-the-camera` has since fixed rather than of the
  // camera move itself: the snap ran the seeds' GROUND y through `pixelToHex`, which divides by
  // `groundFlattening(elevationDeg) = sin elevationDeg`, so the row spacing that cleared the floor
  // by a full hex under `sin 20° = 0.342` compressed under `sin 50° = 0.766`. The snap no longer
  // reads a camera at all — it is taken at plan view, where that factor is 1 — so no future camera
  // decision can squeeze this fixture again. Quota 3 lands the pair exactly on the floor
  // (`hexDist` 4 of 4, measured) rather than short of it, so the nudge never fires and the test
  // observes the RULE again rather than the nudge pass's own index bias. A fixture whose tie the
  // packer's own geometry now collides away is a fixture that has stopped exercising the property,
  // not a property that stopped holding — so the fix is the fixture's room, not the rule.
  const stories = [story('root', 4), story('sibling-one', 3, ['root']), story('sibling-two', 3, ['root'])];
  const world = packWorld(stories);

  const rank1 = world.territories.filter((t) => t.story.id !== 'root');
  assert.equal(rank1.length, 2);
  const [left, right] = [...rank1].sort((a, b) => a.centroid.x - b.centroid.x);
  assert.ok(left && right);

  // The RULE: the smaller `hash(id) % 997` sits to the left. Asserted against `hash` itself rather
  // than against the ids this corpus happens to produce, so it survives a rename of either story.
  assert.ok(
    hash(left.story.id) % 997 < hash(right.story.id) % 997,
    `expected ${left.story.id} (${hash(left.story.id) % 997}) left of ${right.story.id} (${hash(right.story.id) % 997})`,
  );

  // …and reversing the input does not reverse the map: the tie-break is a function of the ids.
  const reversed = packWorld([stories[0]!, stories[2]!, stories[1]!]);
  const order = (w: typeof world) =>
    w.territories.filter((t) => t.story.id !== 'root').sort((a, b) => a.centroid.x - b.centroid.x).map((t) => t.story.id);
  assert.deepEqual(order(reversed), order(world));
});

// ---------------------------------------------------------------------------------------------
// The LONE-ISLAND SWING — and the foundation row's exemption from it
// ---------------------------------------------------------------------------------------------

test('a lone island swings off-centre — except on the foundation row, which never swings', () => {
  // One story per rank, three ranks. Ranks 1 and 2 are each a lone island and swing to alternating
  // sides; rank 0 is ALSO alone and must NOT swing, because the whole forest is centred on it.
  const stories = [story('base', 3), story('mid', 3, ['base']), story('top', 3, ['mid'])];
  const world = packWorld(stories);
  const at = (id: string) => world.territories.find((t) => t.story.id === id)!;

  const swing = loneSwing(estRadius(tileQuota(3)), ISLAND_SPACING_RATIO);
  const jitter = 30; // the seed's own ±, plus one lattice snap

  assert.ok(
    Math.abs(at('base').centroid.x) < swing + jitter,
    `the foundation row must stay centred, saw x=${at('base').centroid.x} against a swing of ${swing}`,
  );
  // Ranks 1 and 2 swing to OPPOSITE sides — the alternation is what keeps the roads diagonal
  // instead of stacking every one of them into a single vertical corridor.
  assert.ok(at('mid').centroid.x > 0, `rank 1 swings positive, saw ${at('mid').centroid.x}`);
  assert.ok(at('top').centroid.x < 0, `rank 2 swings negative, saw ${at('top').centroid.x}`);
});

// ---------------------------------------------------------------------------------------------
// The STAMP FAN — sides alternate, and each PAIR of stamps steps further out
// ---------------------------------------------------------------------------------------------

test('carried icons fan to alternating sides and step outward every second icon', () => {
  // THREE icons, which the golden's corpus cannot reach: its busiest island carries two, and with
  // only two the side alternation and the per-tier radius step are both indistinguishable from
  // constants. The third icon is what separates them.
  // The host is large on purpose: the fan walks each stamp INWARD until it stands on owned
  // land, so on a small island the walk claws a tier-1 stamp back past its tier-0 neighbour and the
  // step this test is about is hidden by a keep-out it has nothing to do with (measured: at twelve
  // capabilities the fourth stamp lands at 15.1 against the second's 20.1).
  const stories = [story('host', 25), story('other', 2, ['host'])];
  const world = packWorld(stories, {
    carriedIcons: new Map([['host', ['ic-a', 'ic-b', 'ic-c', 'ic-d']]]),
  });
  const host = world.territories.find((t) => t.story.id === 'host')!;
  assert.deepEqual(host.stamps.map((s) => s.icon), ['ic-a', 'ic-b', 'ic-c', 'ic-d']);

  const dx = host.stamps.map((s) => s.spot.x - host.treeSpot.x);
  // Sides alternate: even index left of the trunk, odd index right.
  assert.ok(dx[0]! < 0 && dx[2]! < 0, `even icons sit left, saw ${dx[0]} and ${dx[2]}`);
  assert.ok(dx[1]! > 0 && dx[3]! > 0, `odd icons sit right, saw ${dx[1]} and ${dx[3]}`);
  // Each side-PAIR steps further from the trunk, so a third and fourth icon never land on the
  // first two — the tier is `floor(index / 2)` and it must actually widen the offset.
  // …by a step of EXACTLY one tier's worth. "Further out" alone is too weak a claim: a step of a
  // few hundredths of a unit also satisfies it while putting the third icon on top of the first.
  const STEP_X = tileUnits(26);
  assert.ok(
    Math.abs(Math.abs(dx[2]!) - Math.abs(dx[0]!) - STEP_X) < 1e-6,
    `tier 1 steps out by ${STEP_X}, saw ${Math.abs(dx[2]!) - Math.abs(dx[0]!)}`,
  );
  assert.ok(
    Math.abs(Math.abs(dx[3]!) - Math.abs(dx[1]!) - STEP_X) < 1e-6,
    `tier 1 steps out by ${STEP_X}, saw ${Math.abs(dx[3]!) - Math.abs(dx[1]!)}`,
  );
  // …and each tier sits LOWER by its own step, a touch further in front of the trunk base.
  const dy = host.stamps.map((s) => s.spot.y - host.treeSpot.y);
  const STEP_Y = groundRadiusToScreenHalfHeight(tileUnits(6)) / groundRadiusToScreenHalfHeight(1);
  assert.ok(Math.abs(dy[2]! - dy[0]! - STEP_Y) < 1e-6, `tier 1 sits ${STEP_Y} lower, saw ${dy[2]! - dy[0]!}`);
  assert.ok(Math.abs(dy[3]! - dy[1]! - STEP_Y) < 1e-6, `tier 1 sits ${STEP_Y} lower, saw ${dy[3]! - dy[1]!}`);
});

// ---------------------------------------------------------------------------------------------
// THE MOAT — no two islands' tiles may ever touch (ADR-0528 D5)
// ---------------------------------------------------------------------------------------------

test('however tightly packed, no two islands hold adjacent tiles', () => {
  // ⚠ THIS CORPUS IS NOT DECORATIVE — IT WAS SEARCHED FOR, and most crowded forests will not do.
  // The moat has TWO belts: the seed growth FLOOR (`ringsOf + ringsOf + 1 + MOAT_HEXES`), and the
  // grower's own refusal to claim a hex adjacent to foreign soil. On nearly every corpus the floor
  // alone already holds the invariant, which leaves the refusal redundant and therefore
  // unwitnessable — a 240-arrangement sweep run with the refusal REMOVED found adjacent tiles in
  // only a handful. This is one of them, at the tightest rung: without the refusal, THREE pairs of
  // these islands touch. Ten islands, quotas from 1 to 14, three roots.
  //
  // ⚠ AND IT IS SENSITIVE TO THE IDS, not just the shape — every jitter here is hashed from the
  // story id, so renaming `i0` re-rolls the whole layout and the crowding evaporates. An earlier
  // draft of this test lost its teeth exactly that way. If it ever stops binding, re-run the search
  // rather than nudging the quotas.
  const stories = [
    story('i0', 12),
    story('i1', 5),
    story('i2', 1),
    story('i3', 12, ['i0']),
    story('i4', 13, ['i1']),
    story('i5', 7, ['i2']),
    story('i6', 1, ['i0']),
    story('i7', 11, ['i1']),
    story('i8', 14, ['i2']),
    story('i9', 7, ['i0']),
  ];
  const world = packWorld(stories, { spacing: { ratio: 0 } });

  const owner = new Map<string, number>();
  world.territories.forEach((t, i) => {
    for (const h of t.tiles) owner.set(axialKey(h), i);
  });
  assert.ok(owner.size >= 70, `expected a crowded forest, saw ${owner.size} tiles`);

  let touching = 0;
  for (const [key, mine] of owner) {
    const parts = key.split(',');
    const h = { q: Number(parts[0]), r: Number(parts[1]) };
    for (const d of AXIAL_DIRS) {
      const theirs = owner.get(axialKey({ q: h.q + d.q, r: h.r + d.r }));
      if (theirs !== undefined && theirs !== mine) touching += 1;
    }
  }
  // ONE hex of water is the smallest separation the lattice can express, and the 3D map needs it:
  // an island is drawn a little larger than its tiles, so two islands whose TILES touch overlap in
  // 3D. This is the invariant the grower's `foreignAdjacent` refusal exists to hold.
  assert.equal(touching, 0, `${touching} adjacent tile pair(s) across island boundaries`);

  // Every island still got its full quota — the moat must cost water, never land.
  for (const t of world.territories) {
    assert.equal(t.tiles.length, tileQuota(t.story.capabilities.length), `${t.story.id} short of quota`);
  }
});

// ---------------------------------------------------------------------------------------------
// THE FRAME — the top edge clears the tallest thing in the world, whichever it is
// ---------------------------------------------------------------------------------------------

test('the frame clears the topmost tile by its PROJECTED half-height, not its ground radius', () => {
  // ONE very large island. At the 20° this camera sat at through ADR-0367 D1, that was what it
  // took to make the top edge TILE-bound at all: on an ordinary corpus the story tree always
  // reached higher than the coast, so the tile term never bound and the branch was unwitnessable
  // without a corpus this large (measured then: three one-capability islands gave a tile top of
  // -83.25 against a tree top of -96.20; two hundred capabilities inverted it to -242.17 against
  // -222.07).
  //
  // ⚠ AT 50° (ADR-0593 D1) THE TILE TERM NOW BINDS AT EVERY SIZE MEASURED, three capabilities
  // included (-84.75 vs -60.50) — the projected half-height that sizes the tile term scales by
  // `sin 50° / sin 20° = 2.24`, while the story-tree reach that sizes the other term is camera-
  // independent, so raising the camera closed the gap the small corpus used to lose by. 200 stays:
  // it is still the more decisively tile-bound corpus (-313.58 vs -205.64, a wider margin than any
  // smaller size), and this test is not the place to relitigate the corpus size now that a smaller
  // one would also do.
  const world = packWorld([story('huge', 200)]);

  const centres = [
    ...world.drawTiles.map((t) => hexCenter(t.h)),
    ...world.empties.map((e) => hexCenter(e)),
  ];
  const halfHeight = groundRadiusToScreenHalfHeight(HEX_R);
  const tileTop = Math.min(...centres.map((p) => p.y)) - halfHeight;
  const treeTop = Math.min(
    ...world.territories.map((t) => t.treeSpot.y - storyTreeReach(t.story.capabilities.length)),
  );
  assert.ok(tileTop < treeTop, `this corpus must be tile-bound at the top (${tileTop} vs ${treeTop})`);

  // A cell's PROJECTED half-height is what it actually occupies on screen; its ground radius
  // (`HEX_R`) is larger still. Using the ground radius would open the frame; using the wrong SIGN
  // would crop the top by twice the half-height.
  //
  // ⚠ THE BOUND IS `< HEX_R`, NOT A FRACTION OF IT (ADR-0593 D1). It used to be `< HEX_R / 2`,
  // which held at the 20° this camera sat at through ADR-0367 D1 (`sin 20° = 0.342`, comfortably
  // under half) but breaks at 50° (`sin 50° = 0.766`, over half) — a margin sized to one angle, not
  // to the property this line tests. The property is that ANY camera strictly between 0° and 90°
  // foreshortens (`sin θ < 1`), which is exactly what a bug using the ground radius directly (ratio
  // 1) would violate regardless of which angle is shipped — so the bound below is the general claim
  // rather than a threshold re-tuned every time the angle moves. At 50° the ground radius is about
  // 1.3× the projected half-height (`1 / sin 50° ≈ 1.305`), down from ~2.9× at 20°.
  assert.ok(halfHeight < HEX_R, `the camera must foreshorten (${halfHeight} vs ${HEX_R})`);

  // `offset.y` is what places the world in the frame, so the topmost tile's own top edge lands
  // exactly one MARGIN below the frame's top — and that margin is the SAME whichever quantity was
  // topmost, which is what makes it a rule rather than a fudge for this corpus.
  const marginAbove = tileTop + world.offset.y;
  assert.ok(marginAbove > 0, `the top edge must sit inside the frame, saw ${marginAbove}`);

  // ⚠ THE SECOND WORLD NEEDS AN EXPLICIT, LOWER CAMERA NOW (ADR-0593 D1) — a bare call no longer
  // reaches the tree-bound branch AT ALL. `storyTreeReach`'s `cos θ` term shrinks and
  // `groundRadiusToScreenHalfHeight`'s `sin θ` term grows in the SAME direction as the camera
  // rises, so at 50° the tile term now wins for EVERY capability count measured, one included
  // (measured: `story('a',1),story('b',1,['a'])` gives a tile top of -110.18 against a tree top of
  // only -95.49 — tile-bound, where it used to be the small-corpus, tree-bound control). There is
  // no capability count that recovers it at 50° — `crownRadius` caps at 32 while the tile term
  // keeps growing with `sqrt(quota)`, so raising `n` only widens the tile term's lead. The fix is
  // not a bigger fixture, it is a DIFFERENT CAMERA for this one comparison: `elevationDeg` is a
  // real, supported per-call override (`the-two-layers-share-one-elevation`), and the claim under
  // test — that the SAME margin constant places the frame regardless of which term is topmost — is
  // about that constant, not about any one camera, so exercising it at a different angle than the
  // first world is a stronger witness, not a weaker one.
  const TREE_BOUND_DEMO_ELEVATION_DEG = 20;
  const treeBoundWorld = packWorld([story('a', 1), story('b', 1, ['a'])], {
    elevationDeg: TREE_BOUND_DEMO_ELEVATION_DEG,
  });
  const treeTopThere = Math.min(
    ...treeBoundWorld.territories.map(
      (t) => t.treeSpot.y - storyTreeReach(t.story.capabilities.length, TREE_BOUND_DEMO_ELEVATION_DEG),
    ),
  );
  assert.ok(
    Math.abs(marginAbove - (treeTopThere + treeBoundWorld.offset.y)) < 1e-9,
    `the same margin must sit above whichever quantity is topmost: ${marginAbove} vs ${treeTopThere + treeBoundWorld.offset.y}`,
  );
});

// ---------------------------------------------------------------------------------------------
// THE GAP RULE reaches the map — a wider ratio actually separates two neighbours
// ---------------------------------------------------------------------------------------------

test('the derived gap widens the forest, and the legacy triple overrides it', () => {
  const stories = [story('l', 4), story('r', 4), story('up', 2, ['l', 'r'])];
  const tight = packWorld(stories, { spacing: { ratio: 0 } });
  const loose = packWorld(stories, { spacing: { ratio: 1.5 } });
  assert.ok(loose.width > tight.width, `a wider ratio must widen the map, ${loose.width} vs ${tight.width}`);

  // `legacy` WINS over `ratio` when both are given — a control arm that silently took the ratio
  // would be comparing the ladder against one of its own rungs.
  const legacyOnly = packWorld(stories, { spacing: { legacy: { rankGap: 40, islandGap: 60, rankSwing: 140 } } });
  const legacyPlusRatio = packWorld(stories, {
    spacing: { ratio: 1.5, legacy: { rankGap: 40, islandGap: 60, rankSwing: 140 } },
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(legacyPlusRatio)),
    JSON.parse(JSON.stringify(legacyOnly)),
    'the legacy triple must ignore the ratio beside it',
  );
  // And the gap rule is the one in `spacing.ts`, not a second copy: two same-size neighbours are
  // separated by `ratio × radius`, which is what makes the ladder a dial rather than a guess.
  assert.equal(gapBetween(estRadius(tileQuota(4)), estRadius(tileQuota(4)), 0), 0);
});

// ---------------------------------------------------------------------------------------------
// THE ROAD'S OWN LABEL — a derived edge names every capability pair that implies it
// ---------------------------------------------------------------------------------------------

test("a road implied by SEVERAL capability edges lists them all, comma-separated", () => {
  // A story-level road can be implied by more than one capability dependency, and the road's title
  // is where that trace survives. With one implied pair the separator is unused, so a corpus that
  // never doubles up cannot tell `', '` from `''` — and a title reading "a → xb → y" instead of
  // "a → x, b → y" is a tooltip nobody can parse.
  const provider: LayoutStory = {
    id: 'provider',
    dependsOn: [],
    capabilities: [{ id: 'p-one', dependsOn: [] }, { id: 'p-two', dependsOn: [] }],
  };
  const consumer: LayoutStory = {
    id: 'consumer',
    dependsOn: [],
    capabilities: [
      { id: 'c-one', dependsOn: ['p-one'] },
      { id: 'c-two', dependsOn: ['p-two'] },
    ],
  };
  const world = packWorld([provider, consumer]);

  const edge = world.trails.edges.find((e) => e.from === 'provider' && e.to === 'consumer');
  assert.ok(edge, `expected a derived road, saw ${JSON.stringify(world.trails.edges.map((e) => [e.from, e.to]))}`);
  assert.equal(edge.title, 'consumer depends on provider (via c-one → p-one, c-two → p-two)');
  // Belt and braces on the separator itself, so the assertion above cannot be satisfied by a title
  // that happens to run the two pairs together.
  assert.ok(edge.title.includes('p-one, c-two'), `the via list must be comma-separated: ${edge.title}`);
});

// ---------------------------------------------------------------------------------------------
// THE NAMEPLATE'S TWO BASELINES — a screen drawing and the ground line it stands on
// ---------------------------------------------------------------------------------------------

test('label-baselines-are-twins: groundLabelY projects onto labelY at the declared camera', () => {
  // ADR-0545 gave the nameplate a GROUND baseline so the marker scatter and the garden could ask
  // "is this spot in front of the plate?" on the ground instead of on the screen. `labelY` stays
  // beside it because this package's own React renderer draws at the declared camera and wants
  // screen — the same two-consumers arrangement as `radius` / `groundRadius`.
  //
  // The two are computed INDEPENDENTLY (one from projected tile centres, one from plan-view ones),
  // which is what makes this assertion worth making: it is the only thing standing between the
  // studio's plate and a silent 3x drop, and a twin nobody checks is how two spaces get mixed.
  const world = packWorld([story('alpha', 6), story('beta', 3, ['alpha'])]);
  assert.ok(world.territories.length >= 2, 'the corpus must lay out both islands');

  for (const t of world.territories) {
    assert.ok(
      Math.abs(groundRadiusToScreenHalfHeight(t.groundLabelY) - t.labelY) < 1e-9,
      `${t.story.id}: the ground baseline ${t.groundLabelY.toFixed(4)} projects to ` +
        `${groundRadiusToScreenHalfHeight(t.groundLabelY).toFixed(4)}, but the plate is drawn at ` +
        `${t.labelY.toFixed(4)} — the twins have drifted`,
    );
    // And they are genuinely two numbers rather than one aliased twice: the ground line is FARTHER
    // from the horizon than its own projection by the camera's foreshortening, so a copy-paste that
    // returned `labelY` for both fails here even though the assertion above would still pass in plan
    // view. Stated on the MAGNITUDE, because an island north of the world origin carries a negative
    // baseline and "further south" is not the same claim as "further from zero" there.
    assert.ok(Math.abs(t.labelY) > 1, `${t.story.id}: a baseline at zero would make the next line vacuous`);
    assert.ok(
      Math.abs(t.groundLabelY) > Math.abs(t.labelY),
      `${t.story.id}: the ground baseline (${t.groundLabelY.toFixed(2)}) must be farther out than ` +
        `its projection (${t.labelY.toFixed(2)}) at any camera below plan view`,
    );
    // The plate stands SOUTH of the island's own southernmost tile centre, on the ground — which is
    // what "in front of the island" means once it is a ground question rather than a screen one.
    const southmost = Math.max(
      ...t.tiles.map((h) => hexCenter(h, { elevationDeg: 90 }).y),
      t.groundCentroid.y,
    );
    assert.ok(
      t.groundLabelY > southmost + HEX_R,
      `${t.story.id}: the plate at ${t.groundLabelY.toFixed(2)} sits inside the island, whose ` +
        `southern ground edge is ${(southmost + HEX_R).toFixed(2)}`,
    );
  }
});

// ---------------------------------------------------------------------------------------------
// THE CAMERA IS AN OPTION — ADR-0527 D1 item 1
//
// ⚠ THE TWO HALVES ARE ASSERTED SEPARATELY BECAUSE THEY CAN FAIL SEPARATELY, and only one of them
// is visible to a caller. A threading that moved nothing would pass every "byte-unchanged" check
// ever written and deliver no second arm; a threading that moved the GROUND twins would deliver an
// arm and quietly re-decide which capability owns which soil.
// ---------------------------------------------------------------------------------------------

/** A corpus with enough islands to put every emission site under load — per-territory centres, the
 *  tree spot, the garden ring, the nameplate baseline and the scene bounds. */
const cameraCorpus = (): LayoutStory[] => [
  story('alpha', 5),
  story('beta', 3, ['alpha']),
  story('gamma', 7, ['alpha']),
  story('delta', 2, ['beta']),
];

test('the DEFAULT camera is byte-identical to the bare call — every current caller is unmoved', () => {
  const bare = packWorld(cameraCorpus());
  const declared = packWorld(cameraCorpus(), { elevationDeg: LAND_CAMERA_ELEVATION_DEG });
  // The WHOLE world, not a field of it: the option reaches five emission sites and a per-field
  // check would pass while a sixth moved.
  assert.deepEqual(declared, bare);
});

test('the SCREEN half is the GROUND half re-projected at the camera that was asked for', () => {
  // ⚠ REWRITTEN AT ADR-0593 D1, AND THE REASON IS WORTH KEEPING. This used to pack the corpus
  // TWICE — once bare, once at plan view — and compare the two worlds field by field. While the
  // seed snap read a camera the two packs claimed DIFFERENT TILES, so that comparison stopped
  // being about projection at all. `the-packer-decides-in-ground-space-not-through-the-camera` has
  // since fixed the snap and the two-pack comparison is live again below — but this test stays in
  // its within-one-pack form, which is strictly stronger and does not depend on that repair.
  //
  // The claim is made WITHIN one pack: it holds the tiles fixed by
  // construction and pins the exact relation at EVERY camera rather than at one pair of them. A
  // threading that scaled both axes, or the wrong one, or that quietly read the shipped constant
  // instead of the argument, fails here on the first elevation that is not the shipped one.
  for (const elevationDeg of [PLAN_VIEW_ELEVATION_DEG, LAND_CAMERA_ELEVATION_DEG, 20, 35]) {
    const world = packWorld(cameraCorpus(), { elevationDeg });
    const flat = groundFlattening(elevationDeg);
    for (const t of world.territories) {
      // x is UNTOUCHED by any camera — the q axis runs across the screen.
      assert.equal(t.treeSpot.x, t.groundTreeSpot.x, `${t.story.id} at ${elevationDeg}deg: x moved`);
      assert.equal(t.centroid.x, t.groundCentroid.x, `${t.story.id} at ${elevationDeg}deg: centroid x moved`);
      // …and y is the projection EXACTLY, not merely "smaller": `hexCenter` scales y through
      // `groundFlattening`, so the drawn spot is the ground twin times sin of the asked-for angle.
      assert.ok(
        Math.abs(t.treeSpot.y - t.groundTreeSpot.y * flat) < 1e-9,
        `${t.story.id} at ${elevationDeg}deg: ${t.treeSpot.y} vs ${t.groundTreeSpot.y * flat}`,
      );
      assert.ok(
        Math.abs(t.centroid.y - t.groundCentroid.y * flat) < 1e-9,
        `${t.story.id} at ${elevationDeg}deg: ${t.centroid.y} vs ${t.groundCentroid.y * flat}`,
      );
    }
  }
  // Non-vacuity: the set above must actually contain a foreshortening camera AND the plan view, or
  // every assertion could be satisfied by a packer that ignored the option entirely.
  assert.ok(groundFlattening(LAND_CAMERA_ELEVATION_DEG) < 0.9, 'the shipped camera must foreshorten');
  assert.equal(groundFlattening(PLAN_VIEW_ELEVATION_DEG), 1);
});

test('the GROUND twins are measured at PLAN VIEW, never at the draw camera — re-projected, not re-decided', () => {
  // The other half of ADR-0527 D1 item 1, and the half a caller cannot see: whatever camera the
  // drawing is at, the ground-space twins must be the island's own tiles measured with no camera
  // at all. Asserted by RE-DERIVING them from `t.tiles` rather than by comparing two packs, so it
  // is independent of which tiles got claimed.
  for (const elevationDeg of [PLAN_VIEW_ELEVATION_DEG, LAND_CAMERA_ELEVATION_DEG, 20]) {
    const world = packWorld(cameraCorpus(), { elevationDeg });
    for (const t of world.territories) {
      const groundCentres = t.tiles.map((h) => hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }));
      const mean = {
        x: groundCentres.reduce((a, c) => a + c.x, 0) / groundCentres.length,
        y: groundCentres.reduce((a, c) => a + c.y, 0) / groundCentres.length,
      };
      assert.ok(
        Math.abs(t.groundCentroid.x - mean.x) < 1e-9 && Math.abs(t.groundCentroid.y - mean.y) < 1e-9,
        `${t.story.id} at ${elevationDeg}deg: the ground centroid is not its tiles at plan view`,
      );
      // the ground tree spot is one of the island's OWN tiles, measured with no camera
      assert.ok(
        t.tiles.some((h) => {
          const c = hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
          return Math.abs(c.x - t.groundTreeSpot.x) < 1e-9 && Math.abs(c.y - t.groundTreeSpot.y) < 1e-9;
        }),
        `${t.story.id} at ${elevationDeg}deg: the ground tree spot is not a tile centre at plan view`,
      );
    }
  }
});

test('a carried STAMP is seated against the camera that was ASKED FOR, not the shipped one', () => {
  // ⚠ WRITTEN TO KILL A SURVIVING MUTANT, and the mutant is worth naming: `check:mutation-diff`
  // reported that deleting the `{ elevationDeg }` argument from the stamp-ownership `pixelToHex`
  // walk changed no test's verdict. Nothing proved that forward, so nothing would have noticed it
  // being dropped again.
  //
  // WHAT THE WALK DOES. A carried icon (ADR-0102) is seated beside the story tree and then nudged
  // back toward the trunk until it stands on soil this island actually owns — `owner.get(axialKey(
  // pixelToHex({x: bx, y: by})))`. `bx`/`by` are SCREEN coordinates at whatever camera the call
  // resolved, so the lookup must un-map them at THAT camera. Reading the module default instead
  // asks "which hex is this point at the SHIPPED angle" about a point that was never at it.
  //
  // WHY IT NEEDS A NON-SHIPPED CAMERA TO SEE. At the shipped elevation the argument and the module
  // default are the same number, so a bare call and a threaded one are indistinguishable — which
  // is exactly why the bug survived. The assertion is the walk's own postcondition, checked at an
  // elevation that is deliberately NOT the shipped one.
  const elevationDeg = 20;
  assert.notEqual(
    elevationDeg,
    LAND_CAMERA_ELEVATION_DEG,
    'this test is vacuous unless it asks for a camera the module default is not — re-pick it',
  );
  // ⚠ SMALL ISLANDS ON PURPOSE. The walk starts a stamp beside the trunk and nudges it inward, so
  // on a large island the seat is deep inside owned land and BOTH cameras resolve it to soil this
  // story owns — the lookup is wrong and the outcome is right, which is a mutant nobody can catch.
  // A one-capability island is a handful of tiles across, so mis-reading the stamp's row by
  // `sin 50 / sin 20` puts it off the island and the wrong camera becomes observable.
  const stampCorpus = (): LayoutStory[] => [story('alpha', 1), story('beta', 1, ['alpha']), story('gamma', 1, ['alpha'])];
  const carriedIcons = new Map<string, readonly string[]>([
    ['alpha', ['beta', 'gamma']],
    ['beta', ['gamma']],
    ['gamma', ['beta']],
  ]);
  const world = packWorld(stampCorpus(), { elevationDeg, carriedIcons });

  // Which hex each territory owns, keyed the same way the packer keys it.
  const ownerOf = new Map<string, number>();
  for (const t of world.drawTiles) ownerOf.set(`${t.h.q},${t.h.r}`, t.owner);

  let seated = 0;
  for (const [i, t] of world.territories.entries()) {
    for (const stamp of t.stamps) {
      // The spot is screen space at `elevationDeg`, so un-map it at `elevationDeg`.
      const h = pixelToHex(stamp.spot, { elevationDeg });
      assert.equal(
        ownerOf.get(`${h.q},${h.r}`),
        i,
        `${t.story.id} seats "${stamp.icon}" at ${stamp.spot.x.toFixed(2)},${stamp.spot.y.toFixed(2)}, ` +
          `which un-maps at ${elevationDeg}deg to ${h.q},${h.r} — soil this island does not own. ` +
          'The ownership walk resolved the point at a DIFFERENT camera from the one it was placed at.',
      );
      seated += 1;
    }
  }
  // Non-vacuity: a corpus that carried no icons would satisfy every assertion above by having none.
  assert.ok(seated >= 4, `the fixture must actually seat stamps for this to mean anything, got ${seated}`);

  // ⚠ AND A COORDINATE PIN, BECAUSE THE POSTCONDITION ABOVE PROVABLY CANNOT CATCH THIS ALONE.
  // Measured while writing this test: with the `{ elevationDeg }` argument deleted — so the walk
  // resolves ownership at the SHIPPED camera while the point is placed at the asked-for one —
  // every assertion above still passes, at 5, 10, 15 and 20 degrees. The walk nudges a stamp
  // inward until its (wrongly-lookedup) hex is owned, and the seat it stops at is still owned when
  // re-checked correctly, so "is it on soil" is satisfied either way. What the bug DOES change is
  // WHERE the walk stopped, and only a coordinate sees that.
  //
  // So this is a deliberate regression pin, not a derivation: the numbers are a record of the
  // current seating at a pinned camera, and their job is to move when the walk's arithmetic does.
  // `relocation.golden.json` catches the same class across the whole map, but it lives in another
  // file and `check:mutation-diff`'s per-test coverage does not attribute it to this line — so
  // without this pin the forward on that line is unwitnessed by the rung that asks.
  // WHEN THIS GOES RED: find what moved the stamp walk and say so; re-record only after that.
  //
  // ⚠ RE-RECORDED ONCE, 2026-09-23, and here is what moved it — the walk's own arithmetic is
  // untouched. `the-packer-decides-in-ground-space-not-through-the-camera` changed the BASIS the
  // seed snap quantises at (a camera → plan view), so this three-island corpus grows onto
  // different tiles and every stamp is seated on different soil. The previous record was
  // `alpha:beta 2.11,-26.97 | alpha:gamma 17.05,-26.97 | beta:gamma 11.69,-66.70 |
  // gamma:beta -26.63,-66.70`. Note the y magnitudes roughly HALVE, which is the fix visible in
  // one number: the old snap divided ground y by `sin 20° = 0.342` before rounding, stretching the
  // layout ~2.9x down the rank axis, and the seating rows followed it down.
  //
  // ⚠ RE-RECORDED AGAIN, 2026-09-23 (ADR-0598 D2), and again the walk's arithmetic is untouched.
  // The island spacing ratio was re-derived 0.1 → 1 — the gaps the old value named had never
  // actually been seen, because the seed-snap defect above was inflating every one of them by
  // 1.31x — so `beta` and `gamma` sit a full island-radius further from `alpha` and grow onto
  // different tiles. The previous record was `alpha:beta -7.47,-9.95 | alpha:gamma 7.47,-9.95 |
  // beta:gamma 11.69,-21.30 | gamma:beta -26.63,-21.30`. Note `alpha`'s OWN two stamps do not move
  // at all: it is the foundation row, nothing is packed below it, and a rank gap can only move the
  // ranks above — which is the change's signature and what says the walk itself did not move.
  // ⚠ The nameplate clearance ADR-0598 also added is NOT what moved this: this corpus passes no
  // `chrome`, so it takes none. Measured both ways before re-recording.
  const digest = world.territories
    .flatMap((t) => t.stamps.map((st) => `${t.story.id}:${st.icon} ${st.spot.x.toFixed(2)},${st.spot.y.toFixed(2)}`))
    .join(' | ');
  assert.equal(
    digest,
    'alpha:beta -7.47,-9.95 | alpha:gamma 7.47,-9.95 | beta:gamma 21.27,-26.97 | gamma:beta -36.21,-26.97',
  );
});

test('the GROUND half does NOT move with the camera — the layout is re-projected, never re-decided', () => {
  // ⚠ RESTORED BY `the-packer-decides-in-ground-space-not-through-the-camera`, replacing the
  // `⚠ KNOWN VIOLATION (ADR-0593)` test that stood here while the defect was live. Read the next
  // test before this one: on its own THIS ONE IS NOT ENOUGH, and its earlier incarnation is the
  // house's own worked example of a green that verified nothing.
  //
  // WHAT IT PROVES. Asking for a different camera must re-PROJECT the map, never re-DECIDE it
  // (ADR-0527 D1, ADR-0546 D1): the tiles each story grew onto, the ground twins measured from
  // them, and which capability owns which soil are all the same at every elevation.
  //
  // WHAT IT CANNOT PROVE, WHICH IS WHY IT ONCE PASSED VACUOUSLY. It varies the ARGUMENT, so it is
  // blind to any site that ignores the argument — including the one that ignored it by reading a
  // fixed WRONG constant, which is exactly what the seed snap did. Two arms snapped at the same
  // wrong basis agree with each other perfectly. So this test separates "camera-independent" from
  // "camera-dependent" and nothing more; `the seed snap is taken in GROUND space` below is what
  // separates "camera-independent" from "camera-independent AND in the right space".
  const shipped = packWorld(cameraCorpus());
  const plan = packWorld(cameraCorpus(), { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
  const steep = packWorld(cameraCorpus(), { elevationDeg: 20 });
  for (const other of [plan, steep]) {
    for (const [i, t] of other.territories.entries()) {
      const was = shipped.territories[i];
      assert.ok(was !== undefined);
      // Which tiles the story grew onto, and where they sit on the land.
      assert.deepEqual(t.tiles, was.tiles);
      assert.deepEqual(t.groundSeed, was.groundSeed);
      assert.deepEqual(t.groundTreeSpot, was.groundTreeSpot);
      assert.deepEqual(t.groundCentroid, was.groundCentroid);
      assert.equal(t.groundRadius, was.groundRadius);
      // And which capability owns which soil — the thing a camera must never decide.
      assert.deepEqual(
        t.caps.map((c) => [c.cap.id, c.groundSpot] as const),
        was.caps.map((c) => [c.cap.id, c.groundSpot] as const),
      );
    }
    // The coast leaves this packer in ground space (ADR-0527 D1), so it is camera-free by
    // construction — asserted rather than assumed, since "by construction" is what the bare
    // `hexCenter` sites also claimed to be.
    assert.deepEqual(other.empties, shipped.empties);
  }
  // Non-vacuity: the arms must actually ask for different cameras, or every deepEqual above is
  // comparing a pack with itself.
  assert.notEqual(PLAN_VIEW_ELEVATION_DEG, LAND_CAMERA_ELEVATION_DEG);
  assert.notEqual(20, LAND_CAMERA_ELEVATION_DEG);
});

test('the seed snap is taken in GROUND space — the basis is plan view, not any camera', () => {
  // ⚠ THIS IS THE TEST THE OLD ONE COULD NOT BE, and the distinction is the whole unit
  // (`the-packer-decides-in-ground-space-not-through-the-camera`). Every island's seed is placed
  // by `spacing.ts`'s row and gap arithmetic, which carries no camera term — it is GROUND space —
  // and then quantised onto the hex lattice with `pixelToHex`, which reads its argument as SCREEN
  // and divides `y` by `sin(elevation)` to recover ground. Hand it a ground point at elevation θ
  // and the layout is STRETCHED vertically by `1 / sin θ` before it is rounded. Only plan view,
  // where that factor is exactly 1, leaves the point where the spacing math put it.
  //
  // WHY IT CAN SEE WHAT THE COMPARISON ABOVE CANNOT. It does not compare two packs; it compares
  // ONE pack against `Territory.groundSeed`, the pre-snap point the packer now publishes for
  // exactly this purpose. A wrong constant is therefore just as visible as a wrong argument — the
  // failure mode that hid the defect for as long as it lived.
  //
  // ⚠ ON `y` ALONE, AND ON PURPOSE. `pixelToHex` reads the camera in one place only, the division
  // that recovers the row, so `y` is precisely where a wrong basis shows. `x` is the wrong channel
  // twice over: the growth floor nudges a crowded seed EAST (`q + 1`), which moves `x` by a full
  // hex and `y` by nothing, so `x` carries slack that has nothing to do with the camera.
  //
  // ⚠ CALIBRATED BY FAULT-SEEDING, so the green is read at its true strength — and the result is
  // the reason this test exists rather than being folded into the one above. Two mutants were
  // seeded into the snap and the whole suite re-run:
  //    A — `{ elevationDeg }` (the argument, i.e. the state this file pinned as a KNOWN VIOLATION):
  //        caught by BOTH this test and `the GROUND half does NOT move with the camera`.
  //    B — the argument deleted, so `pixelToHex` takes its own `LAND_CAMERA_ELEVATION_DEG` default
  //        (the ORIGINAL defect's exact shape): caught by THIS TEST ALONE. The comparison test is
  //        structurally blind to it, because both of its arms snap at the same wrong constant and
  //        therefore agree — which is how the defect survived its own covering test for as long as
  //        it did.
  const rowPitch = 1.5 * HEX_R; // hexCenter: y = 1.5 * R * r * flattening — one lattice row.
  // THE BAR IS ONE ROW, and it is derived rather than chosen: the only thing that may separate a
  // seed tile's plan-view centre from the point that was snapped is the lattice's own cube
  // rounding. Measured on this corpus the worst separation is 0.63 rows, so 1.0 leaves margin
  // without admitting a whole row of drift.
  const bar = rowPitch;

  for (const elevationDeg of [PLAN_VIEW_ELEVATION_DEG, LAND_CAMERA_ELEVATION_DEG, 20, 35]) {
    const world = packWorld(cameraCorpus(), { elevationDeg });
    for (const t of world.territories) {
      // `tiles[0]` IS the snapped seed — the packer seeds `tilesByStory` with it before growing.
      const seedTile = t.tiles[0];
      assert.ok(seedTile !== undefined, `${t.story.id} has no tiles`);
      const recovered = hexCenter(seedTile, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
      const off = Math.abs(recovered.y - t.groundSeed.y);
      assert.ok(
        off < bar,
        `${t.story.id} at ${elevationDeg}deg: its seed tile sits ${(off / rowPitch).toFixed(2)} lattice rows ` +
          `from the ground point the spacing math placed (${t.groundSeed.y.toFixed(2)} vs ${recovered.y.toFixed(2)}). ` +
          'The seed snap is reading a camera instead of plan view, so the camera is deciding which ' +
          'tiles this story grows onto.',
      );
    }
  }

  // ⚠ NON-VACUITY, COMPUTED RATHER THAN ASSERTED. The bar above is only meaningful if a wrong
  // basis would actually breach it on THIS corpus — a forest packed tightly around the origin
  // would satisfy the assertion at every elevation and prove nothing. So derive, from the seeds
  // themselves, what each wrong basis would cost and check it clears the bar with room.
  const seeds = packWorld(cameraCorpus()).territories.map((t) => t.groundSeed);
  for (const wrong of [LAND_CAMERA_ELEVATION_DEG, 20]) {
    // Snapping a ground point as if it were screen at `wrong` recovers `y / sin(wrong)`.
    const stretch = 1 / groundFlattening(wrong) - 1;
    const worst = Math.max(...seeds.map((s) => Math.abs(s.y) * stretch));
    assert.ok(
      worst > 3 * bar,
      `a ${wrong}deg basis would displace this corpus by only ${(worst / rowPitch).toFixed(2)} rows, ` +
        `which the ${(bar / rowPitch).toFixed(2)}-row bar cannot catch — the corpus needs deeper ranks`,
    );
  }
  // …and the bar must not be so wide that it admits the smallest wrong basis anyway.
  assert.ok(groundFlattening(LAND_CAMERA_ELEVATION_DEG) < 1, 'the shipped camera must foreshorten');
  assert.equal(groundFlattening(PLAN_VIEW_ELEVATION_DEG), 1);
});

// ---------------------------------------------------------------------------------------------
// THE KEEP-IN WALK IS A CORRECTION, NOT A ROUTINE — it must not fire on a spot already on soil
//
// ⚠ WHY THIS IS ASSERTED AS A SPREAD RATHER THAN AS A STEP COUNT: `steps` is internal, and the
// walk's own postcondition ("the spot ends up on owned soil") is satisfied by a walk that fired
// four times as well as by one that never fired — so it cannot separate them. What CAN is the
// walk's arithmetic: each step leaves the offset at 75% of itself (`p += (anchor - p) * 0.25`), so
// a garden walked its full four steps sits at 0.75^4 = 31.6% of its ring radius, bunched around
// the trunk. The bar below is derived from that factor, not chosen: measured on this corpus the
// shipped gardens reach 48.4%-77.2% of their island's ground radius, and a fully-walked one would
// reach 15.3%-24.4%. 40% sits between the two with margin on both sides.
//
// It is the assertion that holds the walk's CONDITION honest — both the ownership test and the
// point handed to `pixelToHex`. Break either and every capability walks the full four steps.
// ---------------------------------------------------------------------------------------------

test('a garden REACHES OUT across its island — the keep-in walk corrects the few, never pulls in the many', () => {
  const world = packWorld(cameraCorpus());
  // ⚠ ONE STEP OF THE WALK, spelled out, so the bar below is arithmetic rather than a number
  // somebody liked. Four of them is what a garden that walked every time would be left with.
  const perStep = 0.75;
  const fullyWalked = perStep ** 4;
  assert.ok(fullyWalked < 0.32, `four steps must collapse the ring for this bar to separate, got ${fullyWalked}`);

  for (const t of world.territories) {
    const reaches = t.caps.map((c) =>
      Math.hypot(c.groundSpot.x - t.groundTreeSpot.x, c.groundSpot.y - t.groundTreeSpot.y),
    );
    assert.ok(reaches.length > 0, `${t.story.id} must have capabilities for this to mean anything`);
    const ratio = Math.max(...reaches) / t.groundRadius;
    assert.ok(
      ratio > 0.4,
      `${t.story.id}: its garden reaches only ${(ratio * 100).toFixed(1)}% of the island's ground radius — ` +
        `a garden walked all four steps would sit near ${(fullyWalked * 100).toFixed(1)}%, so the keep-in walk ` +
        'is firing on spots that were already on owned soil',
    );
  }
});

// ---------------------------------------------------------------------------------------------
// THE NAMEPLATE CLEARANCE (ADR-0598 D2) — the layout leaves room for chrome it cannot see
// ---------------------------------------------------------------------------------------------
//
// The owner's complaint was two faults in one picture: the map read squished, and nameplates sat on
// top of neighbouring islands. The second is NOT a spacing rung — a gap that is a FRACTION of island
// size shrinks with the island while a plate does not, so on the real forest the smallest islands
// were handed about a twentieth of what their own plate needs. The packer cannot work the amount out
// (it is chrome-free by construction), so it takes it as ground distances and holds them as floors.

/** A chain of one-capability stories, one per rank — the shape the clearance is FOR. Small islands
 *  are what separate the two rules: at this size the ratio's gap is a couple of ground units and the
 *  plate band is tens, so the floor is the only thing standing. On big islands the two agree and no
 *  corpus could tell them apart. */
const chainCorpus = (): LayoutStory[] => [
  story('root', 1),
  story('mid', 1, ['root']),
  story('leaf', 1, ['mid']),
];

const chromeOf = (rowBand: number, halfWidth: number, ids: readonly string[]) => ({
  rowBand,
  plateHalfWidth: new Map(ids.map((id) => [id, halfWidth])),
});

/** A corpus with TWO islands sharing a rank, so the IN-ROW half of the clearance is reachable at
 *  all. `chainCorpus` above puts every story on its own rank, where `gapAfter` has no next island
 *  and the in-row rule is never called — which the mutation rung caught: a mutant that inverted the
 *  in-row scale survived every assertion written against the chain. */
const rowCorpus = (): LayoutStory[] => [
  story('below', 1),
  story('left', 1, ['below']),
  story('right', 1, ['below']),
];

test('NO chrome and a chrome scaled to ZERO are the same map — the control arm is composable', () => {
  const ids = rowCorpus().map((s) => s.id);
  const none = packWorld(rowCorpus());
  const zeroed = packWorld(rowCorpus(), { chrome: { ...chromeOf(500, 500, ids), scale: 0 } });
  assert.deepEqual(
    JSON.parse(JSON.stringify(zeroed)),
    JSON.parse(JSON.stringify(none)),
    'a clearance scaled to 0 must reproduce the map that was never given one — otherwise a ' +
      'comparison page cannot stand its control arm from inside a single run',
  );
  // Non-vacuity: the same clearance at full scale HAS to move the map, or the line above is free —
  // and it must move BOTH ways, since this corpus has a row to widen as well as ranks to separate.
  const full = packWorld(rowCorpus(), { chrome: chromeOf(500, 500, ids) });
  assert.notDeepEqual(JSON.parse(JSON.stringify(full)), JSON.parse(JSON.stringify(none)));
  const xOf = (w: typeof full, id: string) => w.territories.find((t) => t.story.id === id)?.groundSeed.x ?? NaN;
  assert.ok(
    Math.abs(xOf(full, 'left') - xOf(full, 'right')) > Math.abs(xOf(none, 'left') - xOf(none, 'right')),
    'the in-row half of the clearance must actually widen a row — without a corpus that HAS a row, ' +
      'every assertion here is about the rank gap and the in-row rule is unwitnessed',
  );
});

test('with NO clearance the rank pitch is EXACTLY the ratio\'s gap — a zero band reserves nothing', () => {
  // ⚠ THE MUTATION RUNG IS WHY THIS IS ARITHMETIC RATHER THAN A COMPARISON. `reserve` adds the seed
  // jitter to the band, guarded by `band > 0` so that a zero clearance stays exactly zero. Relaxing
  // that guard to `true` survived every comparison test here, and had to: a map with no chrome and a
  // map with a zeroed chrome both take the same wrong branch, so they still agree with each other.
  // Only the row pitch itself can tell, so this recomputes it.
  const r = estRadius(tileQuota(1));
  // The jitter is deterministic per story id — the same `hash`/`rand01` stream the packer uses — so
  // the pitch can be recovered exactly rather than bounded.
  const jitterY = (id: string) => (rand01(hash(id) + 1) - 0.5) * tileUnits(30);
  // ⚠ RATIO 0 IS THE ARM THAT SEPARATES THE BRANCH, and the shipped rung alone CANNOT. Re-seeded to
  // establish it: at the shipped ratio the gap the fraction asks for (≈23) already exceeds the
  // jitter a broken guard would add (≈12), so `Math.max` picks the fraction either way and the
  // mutant is invisible. At ratio 0 the fraction asks for nothing, and a reserve that fires on a
  // zero band is the whole pitch.
  for (const ratio of [0, ISLAND_SPACING_RATIO]) {
    const world = packWorld(chainCorpus(), { spacing: { ratio } });
    const seedOf = new Map(world.territories.map((t) => [t.story.id, t.groundSeed]));
    for (const [below, above] of [['root', 'mid'], ['mid', 'leaf']] as const) {
      const pitch =
        Math.abs((seedOf.get(above)?.y ?? 0) - (seedOf.get(below)?.y ?? 0)) - jitterY(below) + jitterY(above);
      const asked = 2 * r + gapBetween(r, r, ratio);
      assert.ok(
        Math.abs(pitch - asked) < 1e-9,
        `at ratio ${ratio} the rank pitch was ${pitch}, and the ratio alone asks for ${asked}`,
      );
    }
  }
});

test('the declared row band survives the seed jitter — a reserved gap that the wobble eats is not a gap', () => {
  const ids = chainCorpus().map((s) => s.id);
  const band = 400; // far above anything the ratio asks of three one-tile islands
  const world = packWorld(chainCorpus(), { chrome: chromeOf(band, 0, ids) });
  const seedOf = new Map(world.territories.map((t) => [t.story.id, t.groundSeed]));
  const r = estRadius(tileQuota(1));

  // `groundSeed` is where the row/gap arithmetic put the island INCLUDING its jitter and before the
  // lattice quantised it — which is the right place to read this, because the jitter is exactly what
  // a reservation has to survive. Measured on the real forest before the reserve existed: the band
  // held on average and a plate still landed on a neighbour, and WHICH plate moved with the rung
  // rather than with the spacing — the signature of a lottery, not of a gap that is too small.
  for (const [below, above] of [['root', 'mid'], ['mid', 'leaf']] as const) {
    const gap = Math.abs((seedOf.get(above)?.y ?? 0) - (seedOf.get(below)?.y ?? 0)) - 2 * r;
    assert.ok(
      gap >= band,
      `${below} → ${above} was left ${gap.toFixed(2)} of water where ${band} was declared`,
    );
  }
});

test('the row band does NOT move with the camera the map is ASKED for — a clearance is not a re-decision', () => {
  // ⚠ THE INVARIANT THE WHOLE INJECTED SHAPE EXISTS TO PROTECT (ADR-0527 D1 / ADR-0546 D1). A plate
  // is fixed-size SCREEN chrome, so the GROUND it needs genuinely depends on a camera — and that is
  // the one dependency the packer may not have. Keeping the conversion on the caller's side means
  // the packer only ever sees a ground number, so asking the map for a second camera re-PROJECTS it
  // and cannot re-DECIDE it. This is the test that says so rather than the comment.
  const ids = chainCorpus().map((s) => s.id);
  const chrome = chromeOf(400, 60, ids);
  const at20 = packWorld(chainCorpus(), { chrome, elevationDeg: 20 });
  const at70 = packWorld(chainCorpus(), { chrome, elevationDeg: 70 });
  assert.notEqual(20, 70);
  for (const t of at20.territories) {
    const other = at70.territories.find((o) => o.story.id === t.story.id);
    assert.deepEqual(other?.tiles, t.tiles, `${t.story.id} grew onto different tiles at another camera`);
    assert.deepEqual(other?.groundSeed, t.groundSeed, `${t.story.id}'s ground seed moved with the camera`);
  }
  // …and the SCREEN half must still move, or the two arms are equal for the boring reason.
  assert.notDeepEqual(at70.territories[0]?.centroid, at20.territories[0]?.centroid);
});

test('the legacy control arm REFUSES the clearance — it stands a map that never had one', () => {
  const ids = chainCorpus().map((s) => s.id);
  const bare = packWorld(chainCorpus(), { spacing: { legacy: PRE_ADR0521_SPACING } });
  const dressed = packWorld(chainCorpus(), {
    spacing: { legacy: PRE_ADR0521_SPACING },
    chrome: chromeOf(500, 500, ids),
  });
  assert.deepEqual(
    JSON.parse(JSON.stringify(dressed)),
    JSON.parse(JSON.stringify(bare)),
    'the pre-ADR-0521 control arm took no nameplate clearance, so one handed to it must be ignored',
  );
});
