// ground-casters.test.ts — what stands on the shipped map, and how big the shadow of it is.
//
// THE TEST THIS FILE IS REALLY FOR is `a wisp casts nothing`. The rest is dimension arithmetic; a
// wisp is the LIVE-WORK signal (ADR-0200 / ADR-0142), so a wisp that cast a shadow would make the
// LAND appear to change every time a session claimed or released a capability — the land asserting
// something about work that never touched it, which is the one direction this surface may not be
// wrong in (ADR-0392 D5 / ADR-0398 D7).

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COVER_CASTS,
  COVER_POOLS,
  DOME_PROFILE,
  ROLE_SILHOUETTE,
  TREE_SHADOW_WIDTH,
  TREE_SHADOW_WIDTH_RUNGS,
  narrowedSilhouette,
  roleSilhouettes,
  caveArchCaster,
  caveMouthHalfWidth,
  groundBounds,
  groundCasters,
  placementCaster,
  placementCasters,
} from './ground-casters.js';
import { profileHalfWidth, profileMaxWidth } from './land-shadow.js';
import { KIT_FOOTPRINTS_2026_08_29, KIT_HEIGHTS_2026_08_29, KIT_ROLES, isDressingRole, type KitPlacement } from './kit-vocabulary.js';
import type { Descriptor3D, InstanceDescriptor } from './world-to-3d.js';

const at = (kind: InstanceDescriptor['kind'], x: number, z: number): InstanceDescriptor => ({
  kind,
  transform: { x, y: 0, z },
  group: kind,
});

// ⚠⚠ THREE STORY-TREE TESTS WERE DELETED HERE (ADR-0508), AND THEY ARE NOT REPLACED BY WEAKER
// ONES. They pinned `STORY_TREE_TRUNK` / `STORY_TREE_CROWN` against the mesh, `storyTreeTop()` at
// 19 units, and `storyTreeCaster` to the crown's cylinder at the descriptor's own ground point.
// All four symbols are gone: `world-to-3d.ts` no longer emits a `story-tree` descriptor, so a test
// of a caster derived from one would construct a subject the map cannot produce, and pass forever
// over nothing. What the retirement is proved by instead is the mapper (`world-to-3d.test.ts`: a
// `tree` node yields a SKIP and no instance), the shipped island end to end
// (`harness/shipped-land-scene.test.ts`: the descriptor stream now casts nothing at all), and the
// shipped canvas's own source (`harness/shipped-baseline.test.ts`: no `<StoryTree>` is mounted).

test('the cave portal’s radius is the 2D prop’s own mouth rule', () => {
  const cave: InstanceDescriptor = { ...at('cave-arch', 5, 5), width: 4 };
  assert.equal(caveMouthHalfWidth(cave), 3.2);
  assert.deepEqual(caveArchCaster(cave), { x: 5, z: 5, radius: 3.2, height: 3.2 });
  // A wider mouth is a bigger occluder, and an ABSENT width takes the same default the mesh does.
  const wide: InstanceDescriptor = { ...at('cave-arch', 0, 0), width: 8 };
  assert.equal(caveMouthHalfWidth(wide), 6.4);
  assert.equal(caveMouthHalfWidth(at('cave-arch', 0, 0)), 3.2);
});

test('THE RULE: a wisp casts nothing, and neither does a trail', () => {
  // `uat-bloom` stands in for the retired classic `hex-ground` as the second non-casting ground
  // reading — `retire-the-old-land-path` dropped `hex-ground` from `InstanceKind` entirely, so a
  // literal of that kind no longer typechecks. The `story-tree` that used to open this set went
  // the same way (ADR-0508) and the CAVE now carries the "something does cast" half.
  const casters = groundCasters([
    { ...at('cave-arch', 0, 0), width: 4 },
    at('wisp-sprite', 10, 10),
    at('trail-strip', 20, 20),
    at('cell-ground', 30, 30),
    at('uat-bloom', 40, 40),
    { kind: 'skipped', sceneKind: 'parcel-blade' },
  ]);
  assert.equal(casters.length, 1);
  assert.equal(casters[0]!.x, 0);
});

test('portals cast, in descriptor order, and every OTHER family is passed over', () => {
  // ⚠ NON-VACUITY ON A ONE-CASE LOOP. `groundCasters` now has a single `if`, so a filter that
  // simply returned everything would still put a caster at 1 and at 3 — the interleaved
  // non-casting families are what separates the real rule from that, and the ORDER is what
  // separates it from a collect-then-sort.
  const casters = groundCasters([
    at('cell-ground', 1, 1),
    { ...at('cave-arch', 2, 2), width: 4 },
    at('uat-bloom', 3, 3),
    { ...at('cave-arch', 4, 4), width: 8 },
  ]);
  assert.deepEqual(
    casters.map((c) => [c.x, c.radius]),
    [
      [2, 3.2],
      [4, 6.4],
    ],
  );
});

test('a descriptor set with nothing standing on it yields no casters, not a fake one', () => {
  assert.deepEqual(groundCasters([]), []);
  assert.deepEqual(groundCasters([at('cell-ground', 0, 0)]), []);
});

test('the ground bounds are the parcels’ own ring extent', () => {
  const cells: InstanceDescriptor[] = [
    { ...at('cell-ground', 0, 0), points: [{ x: -5, y: 0, z: -3 }, { x: 4, y: 0, z: 2 }] },
    { ...at('cell-ground', 0, 0), points: [{ x: 9, y: 0, z: -8 }, { x: 1, y: 0, z: 6 }] },
  ];
  assert.deepEqual(groundBounds(cells), { minX: -5, maxX: 9, minZ: -8, maxZ: 6 });
});

test('bounds over nothing are NULL rather than a degenerate rect', () => {
  // A degenerate rect is the shape that reads as "the shadow just is not showing": a one-texel
  // field every fragment then samples. The caller has to decide not to build one.
  assert.equal(groundBounds([]), null);
  assert.equal(groundBounds([at('cell-ground', 0, 0)]), null, 'a parcel with no ring bounds nothing');
  // But a single ring IS bounds, even a degenerate one — that is a real parcel, not an absent set.
  const one: InstanceDescriptor = { ...at('cell-ground', 0, 0), points: [{ x: 2, y: 0, z: 3 }] };
  assert.deepEqual(groundBounds([one]), { minX: 2, maxX: 2, minZ: 3, maxZ: 3 });
});

test('a mixed descriptor set is read for parcels only when bounding the ground', () => {
  const mixed: Descriptor3D[] = [
    at('cave-arch', 500, 500),
    { ...at('cell-ground', 0, 0), points: [{ x: -1, y: 0, z: -1 }, { x: 1, y: 0, z: 1 }] },
  ];
  const cells = mixed.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
  assert.deepEqual(groundBounds(cells), { minX: -1, maxX: 1, minZ: -1, maxZ: 1 });
});

test('a parcel with NO RING is skipped rather than poisoning the bounds of the ones that have one', () => {
  // ⚠ THE MUTANT THIS EXISTS FOR replaces the `?? []` fallback with a one-element array of
  // rubbish. Asked only about a set of pointless cells, that mutant returns `null` exactly as the
  // real code does — because rubbish has no `.x` and every bound comes out NaN. It separates only
  // when a REAL parcel is in the same set: the real code returns that parcel's rect, the mutant
  // returns null, and an island would render with no shadow field at all.
  const real: InstanceDescriptor = {
    ...at('cell-ground', 0, 0),
    points: [
      { x: -4, y: 0, z: -2 },
      { x: 6, y: 0, z: 3 },
    ],
  };
  const pointless = at('cell-ground', 99, 99);
  assert.deepEqual(groundBounds([pointless, real]), { minX: -4, maxX: 6, minZ: -2, maxZ: 3 });
  assert.deepEqual(groundBounds([real, pointless]), { minX: -4, maxX: 6, minZ: -2, maxZ: 3 });
});

// ---------------------------------------------------------------------------
// the kit's placements, as occluders (2026-09-03)
// ---------------------------------------------------------------------------

const FOOT = KIT_FOOTPRINTS_2026_08_29;
const HEIGHTS = KIT_HEIGHTS_2026_08_29;

const placed = (role: KitPlacement['role'], x: number, z: number, scale: number): KitPlacement => ({
  role,
  assembly: role === 'bloom' ? 'flower' : role === 'deadTree' ? 'pine-dead' : 'pine-a',
  capId: 'cap-0',
  tint: null,
  at: { x, z },
  // ⚠ A NON-ZERO y, which the caster must NOT read: its height is measured from the land at its
  // own foot, and the placement's y already IS that land.
  y: 4.5,
  yaw: 1,
  scale,
});

test('a placement casts its role’s SILHOUETTE over its half-footprint and height, at its own point — the trees narrowed to the shipped width', () => {
  assert.deepEqual(placementCaster(placed('tree', 30, -6, 1), FOOT, HEIGHTS), {
    x: 30,
    z: -6,
    radius: FOOT.tree / 2,
    height: HEIGHTS.tree,
    profile: narrowedSilhouette(ROLE_SILHOUETTE.tree, TREE_SHADOW_WIDTH),
    pool: true,
  });
  assert.deepEqual(placementCaster(placed('deadTree', 1, 2, 1), FOOT, HEIGHTS), {
    x: 1,
    z: 2,
    radius: FOOT.deadTree / 2,
    height: HEIGHTS.deadTree,
    profile: narrowedSilhouette(ROLE_SILHOUETTE.deadTree, TREE_SHADOW_WIDTH),
    pool: true,
  });
  // The narrowing reaches the stamp: the caster's widest half-width is the crown's × the width,
  // and NOT its radius, which sizes the pool and is untouched.
  const tree = placementCaster(placed('tree', 0, 0, 1), FOOT, HEIGHTS);
  assert.ok(Math.abs(profileMaxWidth(tree.profile!) - TREE_SHADOW_WIDTH) < 1e-12);
  assert.equal(tree.radius, FOOT.tree / 2);
  // An explicit table is honoured — the width ladder's arms pass one per rung.
  const wide = placementCaster(placed('tree', 0, 0, 1), FOOT, HEIGHTS, roleSilhouettes(1));
  assert.deepEqual(wide.profile, ROLE_SILHOUETTE.tree);
  assert.deepEqual(placementCaster(placed('tree', 0, 0, 1), FOOT, HEIGHTS, roleSilhouettes(TREE_SHADOW_WIDTH)), tree);
  assert.deepEqual(placementCaster(placed('bloom', 1, 2, 1), FOOT, HEIGHTS), {
    x: 1,
    z: 2,
    radius: FOOT.bloom / 2,
    height: HEIGHTS.bloom,
    profile: ROLE_SILHOUETTE.bloom,
    pool: true,
  });
  // ⚠ THE PROFILE IS THE ROLE'S, BY IDENTITY — a copy would be a second table that agrees today.
  assert.equal(placementCaster(placed('bush', 0, 0, 4.5), FOOT, HEIGHTS).profile, ROLE_SILHOUETTE.bush);
});

test('⚠⚠ THE TREE’S SHADOW IS NARROWED TO A RUNG OF THE WIDTH LADDER (the owner: "a triangle for what the tree casts … too large"); the bloom and the cover keep their read forms', () => {
  assert.ok(TREE_SHADOW_WIDTH_RUNGS.includes(TREE_SHADOW_WIDTH), 'the shipped width is not a rung the owner was shown');
  assert.deepEqual([...TREE_SHADOW_WIDTH_RUNGS], [1, 0.8, 0.65, 0.5]);
  assert.equal(TREE_SHADOW_WIDTH_RUNGS[0], 1, 'the first rung is the shadow as it shipped after PR #1841');
  for (let i = 1; i < TREE_SHADOW_WIDTH_RUNGS.length; i += 1) assert.ok(TREE_SHADOW_WIDTH_RUNGS[i]! < TREE_SHADOW_WIDTH_RUNGS[i - 1]!, 'the ladder descends');
  assert.ok(TREE_SHADOW_WIDTH < 1 && TREE_SHADOW_WIDTH > 0, `the pick (${TREE_SHADOW_WIDTH}) is a narrowing, and still a shadow`);
  // narrowedSilhouette scales every RADIUS and no HEIGHT — the same form, narrower.
  assert.deepEqual(narrowedSilhouette([[0, 0.08], [0.25, 1], [1, 0.04]], 0.5), [[0, 0.04], [0.25, 0.5], [1, 0.02]]);
  assert.deepEqual(narrowedSilhouette(ROLE_SILHOUETTE.tree, 1), ROLE_SILHOUETTE.tree);
  assert.deepEqual(narrowedSilhouette([], 0.5), []);
  assert.ok(Math.abs(profileHalfWidth(narrowedSilhouette(ROLE_SILHOUETTE.tree, 0.5), 0.25) - 0.5) < 1e-12);
  assert.ok(Math.abs(profileHalfWidth(narrowedSilhouette(ROLE_SILHOUETTE.tree, 0.5), 0.6) - profileHalfWidth(ROLE_SILHOUETTE.tree, 0.6) * 0.5) < 1e-12);
  // roleSilhouettes: the two tree roles narrowed to the width, EVERY other role its read form by
  // identity — the owner named the tree's triangle, and a narrowed bloom would be a second change.
  const shipped = roleSilhouettes();
  assert.deepEqual(shipped, roleSilhouettes(TREE_SHADOW_WIDTH), 'the default IS the shipped width');
  assert.deepEqual(shipped.tree, narrowedSilhouette(ROLE_SILHOUETTE.tree, TREE_SHADOW_WIDTH));
  assert.deepEqual(shipped.deadTree, narrowedSilhouette(ROLE_SILHOUETTE.deadTree, TREE_SHADOW_WIDTH));
  for (const role of KIT_ROLES) {
    if (role === 'tree' || role === 'deadTree') continue;
    assert.equal(shipped[role], ROLE_SILHOUETTE[role], `${role} is not its read form by identity`);
  }
  assert.deepEqual(Object.keys(shipped).sort(), [...KIT_ROLES].sort(), 'every role has a silhouette');
  const half = roleSilhouettes(0.5);
  assert.ok(Math.abs(profileMaxWidth(half.tree) - 0.5) < 1e-12);
  assert.ok(Math.abs(profileMaxWidth(half.deadTree) - 0.5) < 1e-12);
  assert.equal(profileMaxWidth(half.bloom), profileMaxWidth(ROLE_SILHOUETTE.bloom));
  // And the trunk narrows with the crown — the whole profile is one form.
  assert.ok(Math.abs(profileHalfWidth(half.tree, 0.05) - 0.04) < 1e-12);
  // The list builder hands one table to every placement: a rung passed there reaches every tree.
  const list = [placed('tree', 1, 1, 1), placed('bloom', 2, 2, 1), placed('deadTree', 3, 3, 1)];
  const narrow = placementCasters(list, FOOT, HEIGHTS, true, roleSilhouettes(0.5));
  assert.deepEqual(narrow, list.map((p) => placementCaster(p, FOOT, HEIGHTS, roleSilhouettes(0.5))));
  assert.ok(Math.abs(profileMaxWidth(narrow[0]!.profile!) - 0.5) < 1e-12);
  assert.equal(narrow[1]!.profile, ROLE_SILHOUETTE.bloom);
  assert.deepEqual(placementCasters(list, FOOT, HEIGHTS), placementCasters(list, FOOT, HEIGHTS, true, roleSilhouettes()));
});

test('the placement’s scale reaches BOTH the radius and the height of its caster', () => {
  // ⚠ The kit scales uniformly, so a placement at 0.6 is 0.6 as wide as it is tall. A caster
  // that scaled one and not the other would throw a shadow the wrong size for its crown. (No
  // shipped `tree` stands below 1 since ADR-0518; the arithmetic still has to hold for any scale.)
  const half = placementCaster(placed('tree', 0, 0, 0.5), FOOT, HEIGHTS);
  assert.equal(half.radius, FOOT.tree / 4);
  assert.equal(half.height, HEIGHTS.tree / 2);
  const scaled = placementCaster(placed('tree', 0, 0, 0.6), FOOT, HEIGHTS);
  assert.ok(Math.abs(scaled.radius - (FOOT.tree / 2) * 0.6) < 1e-12);
  assert.ok(Math.abs(scaled.height - 18 * 0.6) < 1e-12);
});

test('every SCENE placement casts, in placement order, and none is dropped', () => {
  const list = [placed('tree', 1, 1, 1), placed('bloom', 2, 2, 1), placed('tree', 3, 3, 0.7)];
  const casters = placementCasters(list, FOOT, HEIGHTS);
  assert.equal(casters.length, list.length);
  assert.deepEqual(
    casters,
    list.map((p) => placementCaster(p, FOOT, HEIGHTS)),
  );
  assert.deepEqual(casters.map((c) => c.x), [1, 2, 3]);
  assert.deepEqual(placementCasters([], FOOT, HEIGHTS), []);
});

test('⚠⚠ GROUND COVER CASTS — since 2026-09-06, by `COVER_CASTS` — and `coverCasts: false` is the field as it stood before', () => {
  // The reversal `ground-casters.ts`'s `COVER_CASTS` argues, asserted at the line that enforces
  // it. BOTH halves have to be here: cover alone would pass on a function that kept everything,
  // scene props alone on one that kept nothing, and the `false` branch is what every comparison
  // page's control arm is built from.
  assert.equal(COVER_CASTS, true, 'the shipped decision is that the cover casts');
  const scene = [placed('tree', 1, 1, 1), placed('bloom', 2, 2, 1)];
  const cover = [placed('bush', 3, 3, 4.5), placed('tuft', 4, 4, 4.5), placed('flowerPatch', 5, 5, 4.5)];
  const mixed = [scene[0]!, cover[0]!, scene[1]!, cover[1]!, cover[2]!];

  // The default is the shipped decision: every placement casts, in placement order.
  assert.deepEqual(
    placementCasters(mixed, FOOT, HEIGHTS),
    mixed.map((p) => placementCaster(p, FOOT, HEIGHTS)),
  );
  assert.equal(placementCasters(cover, FOOT, HEIGHTS).length, 3, 'ground cover stopped casting');
  // And every cover caster wears a DOME, never a cylinder or a tree's cone — and POOLS NOTHING
  // (`COVER_POOLS`): its sun shadow, no ambient halo. Scene casters pool.
  assert.equal(COVER_POOLS, false);
  for (const c of placementCasters(cover, FOOT, HEIGHTS)) {
    assert.deepEqual(c.profile, DOME_PROFILE());
    assert.equal(c.pool, false);
  }
  for (const c of placementCasters(scene, FOOT, HEIGHTS)) assert.equal(c.pool, true);

  // The control: dressing roles dropped, and the ORDER of the survivors is the scene props' own —
  // a drop that reordered the list would put a shadow under the wrong tree.
  assert.deepEqual(placementCasters(cover, FOOT, HEIGHTS, false), [], 'the control cast from cover');
  assert.deepEqual(
    placementCasters(mixed, FOOT, HEIGHTS, false),
    scene.map((p) => placementCaster(p, FOOT, HEIGHTS)),
  );

  // ⚠ IT IS A ROLE-CLASS TEST AND NOT A SIZE ONE. A threshold on the footprint would drop the
  // BLOOM (4 units) while keeping a boldest-rung BUSH (1.05 x 4.5 = 4.7 units) — the exact
  // inversion of what is wanted. Asserted by putting the two on either side of that number.
  const bigBush = placed('bush', 9, 9, 4.5);
  const bloom = placed('bloom', 8, 8, 1);
  assert.ok(
    FOOT.bush * bigBush.scale > FOOT.bloom * bloom.scale,
    'the fixture no longer separates the class test from a size test',
  );
  assert.deepEqual(placementCasters([bigBush, bloom], FOOT, HEIGHTS, false), [placementCaster(bloom, FOOT, HEIGHTS)]);
});

// ---------------------------------------------------------------------------
// the silhouettes (2026-09-06)
// ---------------------------------------------------------------------------

test('every role has a profile that starts at its foot, ends at its tip, ascends in height and never widens past its radius', () => {
  for (const role of KIT_ROLES) {
    const profile = ROLE_SILHOUETTE[role];
    assert.ok(profile.length >= 2, `${role} has no profile`);
    assert.equal(profile[0]![0], 0, `${role} does not start at its foot`);
    assert.equal(profile[profile.length - 1]![0], 1, `${role} does not end at its tip`);
    for (let k = 1; k < profile.length; k += 1) {
      assert.ok(profile[k]![0] >= profile[k - 1]![0], `${role} descends at ${k}`);
    }
    for (const [h, r] of profile) {
      assert.ok(h >= 0 && h <= 1 && r >= 0 && r <= 1, `${role} leaves the unit box at ${h},${r}`);
    }
    assert.equal(profileMaxWidth(profile), 1, `${role} never reaches its own radius`);
  }
});

test('THE FORMS: a pine is a cone over a thin trunk, a bloom a thread with a head over its rosette, the cover a dome', () => {
  const tree = ROLE_SILHOUETTE.tree;
  // Thin at the foot (the trunk), widest low, a point at the tip — the reference's cone.
  assert.ok(profileHalfWidth(tree, 0.05) < 0.15, 'the trunk is not thin');
  assert.equal(profileHalfWidth(tree, 0.25), 1, 'the crown is not widest at a quarter height');
  assert.ok(profileHalfWidth(tree, 0.6) < profileHalfWidth(tree, 0.4), 'the crown does not taper');
  assert.ok(profileHalfWidth(tree, 1) < 0.1, 'the tip is not a point');
  const bloom = ROLE_SILHOUETTE.bloom;
  assert.equal(profileHalfWidth(bloom, 0.05), 1, 'the rosette is not the footprint');
  assert.ok(profileHalfWidth(bloom, 0.5) < 0.1, 'the stem is not a thread');
  assert.ok(profileHalfWidth(bloom, 0.85) > profileHalfWidth(bloom, 0.5), 'there is no head');
  for (const role of KIT_ROLES.filter(isDressingRole)) {
    const dome = ROLE_SILHOUETTE[role];
    assert.equal(profileHalfWidth(dome, 0), 1, `${role} is not full width at the foot`);
    assert.ok(profileHalfWidth(dome, 0.5) > 0.8, `${role} is not round`);
    assert.equal(profileHalfWidth(dome, 1), 0, `${role} has a flat top`);
  }
});

test('DOME_PROFILE is the quarter circle, sampled, and a fresh array each call', () => {
  const a = DOME_PROFILE();
  const b = DOME_PROFILE();
  assert.notEqual(a, b, 'two roles would alias one array');
  assert.deepEqual(a, b);
  assert.equal(a.length, 5);
  for (const [t, r] of a) assert.ok(Math.abs(r - Math.sqrt(1 - t * t)) < 1e-12);
});


test('native coverage keeps its own hidden dome through tree narrowing and placement casting', () => {
  const profile = ROLE_SILHOUETTE.coverageFlora;
  assert.deepEqual(profile, DOME_PROFILE(), 'coverage casts the low dome');
  for (const role of ['bush', 'tuft', 'flowerPatch'] as const) {
    assert.notEqual(profile, ROLE_SILHOUETTE[role], 'the native profile cannot alias a dressing role');
  }

  for (const table of [ROLE_SILHOUETTE, roleSilhouettes(), roleSilhouettes(0.5), roleSilhouettes(1)]) {
    assert.equal(table.coverageFlora, profile, 'tree narrowing retains the native profile by identity');
    assert.deepEqual(Object.getOwnPropertyDescriptor(table, 'coverageFlora'), {
      value: profile,
      enumerable: false,
      writable: false,
      configurable: false,
    }, 'coverage stays directly readable without joining the legacy enumerable role table');
    assert.deepEqual(Object.keys(table).sort(), [...KIT_ROLES].sort());
    assert.deepEqual(Object.getOwnPropertyNames(table).sort(), [...KIT_ROLES, 'coverageFlora'].sort());
  }

  const coverage = { ...placed('coverageFlora', 6, -7, 0.5), assembly: 'plant-a' } satisfies KitPlacement;
  const caster = placementCaster(coverage, FOOT, HEIGHTS, roleSilhouettes(0.5));
  assert.deepEqual(caster, {
    x: 6,
    z: -7,
    radius: FOOT.coverageFlora / 4,
    height: HEIGHTS.coverageFlora / 2,
    profile,
    pool: true,
  });
  assert.equal(caster.profile, profile, 'the placement consumes the same native silhouette');
  assert.deepEqual(
    placementCasters([placed('bush', 0, 0, 1), coverage], FOOT, HEIGHTS, false),
    [caster],
    'turning decorative cover off retains the native coverage caster',
  );
});
