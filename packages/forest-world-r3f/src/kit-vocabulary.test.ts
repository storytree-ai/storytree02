// kit-vocabulary.test.ts — the bought kit's vocabulary and placement, proved where they now live.
//
// ⚠⚠ WHY THIS FILE EXISTS RATHER THAN THE HARNESS'S SUITE COVERING IT. `check:mutation-diff`
// mutates a project's `src/` only, so a `src/` module's tests in `harness/` buy the rung NOTHING —
// the relief crossing learned that with 3 survivors and 4 uncovered lines, the sharpest of which
// could have emptied the wave table and delivered a perfectly flat land in silence. So the tests
// that are about THIS MODULE'S ARITHMETIC live here, and the ones that are about the harness
// fixture — its capability list, its criteria, its unprojected cells — stayed with the fixture.
//
// ⚠ THE ISLAND HERE IS BUILT, NOT LOADED, and that is deliberate rather than a convenience. The
// crossed placement takes cells and facts as ARGUMENTS precisely so it does not need a scene; a
// test that reached for one would be proving the adapter instead of the thing.

import assert from 'node:assert/strict';
import test from 'node:test';

// ⚠ THE SIZE LADDER LIVES IN `cover-dressing.ts`, and the bound below is read against it from
// here on purpose: the flower patch's declared WIDTH is derived backwards from the ladder's
// boldest rung, so the two modules have to be checked together or the derivation is a comment.
import { COVER_SIZE_RUNGS } from './cover-dressing.js';
import { decodeKitAsset } from './kit-asset.js';
import {
  FOOTPRINT_TOLERANCE,
  KIT_ASSEMBLIES,
  KIT_FOOTPRINTS_2026_08_29,
  KIT_HEIGHTS_2026_08_29,
  KIT_ROLES,
  KIT_ROLE_ASSEMBLIES,
  KIT_ROLE_CLASS,
  KIT_ROLE_SIGNAL,
  KIT_ROLE_SIZE,
  MIN_PROP_HEIGHT,
  MIN_PROP_WIDTH,
  POCKETED_SIGNALS,
  RENDER_ELEV_DEG,
  VOCABULARY_STATES,
  bestCandidate,
  candidatePoints,
  capabilityFactsFrom,
  clearanceFactor,
  BUD_MAX_SHARE_OF_BLOOM,
  BUD_MIN_MULTIPLE_OF_COVER_FLOWER,
  COVER_SCALE,
  CRITERION_ROLES,
  DRESSING_ROLES,
  FLOWER_PATCH_MAX_SHARE_OF_BLOOM,
  KIT_ROLE_TILT,
  SCENE_ROLES,
  isCriterionRole,
  clearsObjectFloor,
  isDressingRole,
  deliveredHeightPx,
  deliveredRolePx,
  dressIslandFromKit,
  dressingCensus,
  dressingOverlaps,
  footprintDriftOf,
  heightDriftOf,
  kitObjectNames,
  pairClearance,
  propRadius,
  roleDrift,
  sizeClearsObjectFloor,
  propStream,
  stateForm,
  sumOfRadii,
  tintedStates,
  worstClearance,
} from './kit-vocabulary.js';
import type { CapabilityFacts, KitAssembly, KitPlacement, KitRole } from './kit-vocabulary.js';
import { LEAF_TINT_TOKEN } from './leaf-tint.js';
import { landHeight } from './land-relief.js';
import { cellsByParcel } from './parcel-cells.js';
import type { GPoint, LayoutCell } from './parcel-cells.js';

const FOOT = KIT_FOOTPRINTS_2026_08_29;

// ---------------------------------------------------------------------------
// a built island — hostile on purpose
// ---------------------------------------------------------------------------
//
// ⚠ FOUR DIFFERENT EDGE NUMBERS AND AN ORIGIN NOWHERE NEAR ZERO. A fixture centred on the origin
// makes `max - min` and `max + min` coincide on both axes, so a clamp or a bound that read the
// wrong one survives every assertion. This one is at x ∈ [140, …] and z ∈ [-70, …] with unequal
// cell spans, so no two spans agree and no sign error is invisible.

const CELL_W = 34;
const CELL_D = 26;
const ORIGIN_X = 140;
const ORIGIN_Z = -70;

/** One parcel as a strip of `cols` quadrilateral cells, laid left to right in its own row. */
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
      island: undefined,
      status,
      cellId: `${capId}-${c}`,
    } satisfies LayoutCell;
  });
}

/** An island of `states.length` capabilities, one parcel-row each. The rows are wide enough that
 *  a tree (footprint 10.13) has somewhere to stand that is not on top of its neighbour. */
function island(states: readonly string[], cols = 4): LayoutCell[] {
  return states.flatMap((status, row) => parcel(`cap-${row}`, status, row, cols));
}

const ALL_HEALTHY = island(Array.from({ length: 6 }, () => 'healthy'));

function dress(
  cells: readonly LayoutCell[],
  over: {
    blooms?: number;
    buds?: number;
    wilts?: number;
    relief?: number;
    seed?: number;
    footprint?: Record<KitRole, number>;
  } = {},
): KitPlacement[] {
  const opts = {
    cells,
    facts: capabilityFactsFrom(cells),
    blooms: over.blooms ?? 0,
    buds: over.buds ?? 0,
    wilts: over.wilts ?? 0,
    relief: over.relief ?? 0,
    footprint: over.footprint ?? FOOT,
  };
  return dressIslandFromKit(over.seed === undefined ? opts : { ...opts, seed: over.seed });
}

/** The OBJECT names inside the embedded kit, read out of its JSON chunk — a glb is a 12-byte
 *  header and a length-prefixed JSON chunk, so this needs no loader and no browser.
 *
 *  ⚠ NODES, NOT MESHES. Blender exports a node per OBJECT and names the mesh after the MESH
 *  DATA, so an object arrives as a node named for the object and a mesh named `Plane.054`.
 *  `GLTFLoader` sets `Object3D.name` from the node, which is what the kit loader keys the
 *  vocabulary on — reading meshes here would check the manifest against names the loader never
 *  sees. */
function kitObjectsInAsset(): string[] {
  const buf = new Uint8Array(decodeKitAsset());
  const view = new DataView(buf.buffer);
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + jsonLength))) as {
    nodes?: Array<{ name?: string; mesh?: number }>;
  };
  return (json.nodes ?? [])
    .filter((n) => n.mesh !== undefined)
    .map((n) => n.name ?? '')
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// the vocabulary itself
// ---------------------------------------------------------------------------

test('every role is a SCENE signal or is declared DRESSING, and its prose says which', () => {
  // ADR-0463 D5: delegation picks WHICH signal a prop carries, never WHETHER it carries one. A
  // role whose entry did not say where its number comes from would be decoration wearing a
  // signal's name — which ADR-0414 D1 forbids outright on the surface this now ships to.
  //
  // ⚠⚠ SINCE 2026-09-03 THERE ARE TWO ADMISSIBLE ANSWERS AND STILL NO THIRD. Ground cover crossed
  // (ADR-0507's dressing), and the honest widening of "every entry is a signal" is "every entry is
  // a signal OR is declared dressing" — never a role that is silently neither. The expected word
  // is DERIVED from `KIT_ROLE_CLASS` rather than restated here, so this is a two-place agreement
  // between the classification and the prose: reclassify a role in one place only and it reds.
  for (const role of KIT_ROLES) {
    const signal = KIT_ROLE_SIGNAL[role];
    assert.ok(signal.length > 20, `${role} has no signal`);
    const expected = KIT_ROLE_CLASS[role].toUpperCase();
    assert.match(
      signal,
      new RegExp(`^${expected} — `),
      `${role} is classified ${KIT_ROLE_CLASS[role]} but its prose does not open with ${expected}`,
    );
  }
});

test('the two kinds of role partition the vocabulary — no role is both, none is neither', () => {
  // ⚠ THE PARTITION IS THE CLAIM, not the counts. A role that fell out of both lists would draw
  // and report nothing, and a role in both would be scenery the map also read a state off.
  assert.deepEqual([...SCENE_ROLES, ...DRESSING_ROLES].sort(), [...KIT_ROLES].sort());
  for (const role of SCENE_ROLES) assert.ok(!DRESSING_ROLES.includes(role), `${role} is both kinds`);
  // ⚠ FIVE SINCE ADR-0600, not three: an unsigned criterion and a failing one report as much as a
  // signed one does, so all three criterion forms are `scene` roles.
  assert.deepEqual([...SCENE_ROLES], ['tree', 'deadTree', 'bloom', 'bud', 'wilt']);
  assert.deepEqual([...DRESSING_ROLES], ['bush', 'tuft', 'flowerPatch']);
});

test('⚠ NO DRESSING ROLE HAS A ROUTE FROM A STATE — scenery can never report a capability', () => {
  // The one thing the dressing roles are NOT exempt from. `stateForm` is the only door from a
  // capability's status to a role, so this is the whole surface: if no state reaches a dressing
  // role, no capability's state can ever be drawn as ground cover, and an island cannot come to
  // report a proof state through its scenery.
  for (const state of [...VOCABULARY_STATES, 'retired', 'drift', '']) {
    const form = stateForm(state);
    if (form === null) continue;
    assert.ok(!isDressingRole(form.role), `${state} reaches the dressing role ${form.role}`);
  }
});

test('THE CRITERION MARKER STAYS THE ONLY RED FLOWER, AND THE ONLY ONE AT ITS SIZE', () => {
  // ⚠⚠ THE ROW'S ONE MUST-STAY-DISTINCT, held as a property of the TABLES rather than of a
  // picture — a placement can be moved, a table cannot be moved by accident.
  //
  // (a) COLOUR: the bloom is the kit's `Red_Flower_01` and nothing else in the vocabulary names a
  //     red flower at all, so no scattering can put a second red flower on the map.
  const covered = DRESSING_ROLES.flatMap((r) => KIT_ROLE_ASSEMBLIES[r]).flatMap((a) => [...KIT_ASSEMBLIES[a]]);
  assert.deepEqual(
    covered.filter((n) => /red/i.test(n)),
    [],
    'a ground-cover role draws a red flower — the criterion marker is no longer the only one',
  );
  assert.deepEqual([...KIT_ASSEMBLIES.flower], ['Red_Flower_01']);

  // (b) SIZE, read at the ground cover's LOUDEST — which since 2026-09-04 means AT THE BOLDEST
  //     RUNG OF THE SIZE LADDER, not at the declared width and not at the shipped rung. The widest
  //     patch that can ever be drawn is `units x COVER_SCALE.max x max(COVER_SIZE_RUNGS)`, and it
  //     must be under half the bloom's own width.
  //
  //     ⚠⚠ ASSERTING IT AT THE SHIPPED RUNG WOULD BE A GREEN CHECK THAT VERIFIED NOTHING. A
  //     scale-back must not be what makes the map honest: the owner may answer the sheet with any
  //     rung, so the bound has to hold at the loudest one the ladder can reach, and adding a
  //     bolder rung has to fail HERE rather than be discovered on a render. `KIT_ROLE_SIZE`'s
  //     `flowerPatch` width is derived backwards from exactly this arithmetic.
  const boldest = Math.max(...COVER_SIZE_RUNGS);
  const limit = KIT_ROLE_SIZE.bloom.units * FLOWER_PATCH_MAX_SHARE_OF_BLOOM;
  for (const rung of COVER_SIZE_RUNGS) {
    const widestAtRung = KIT_ROLE_SIZE.flowerPatch.units * COVER_SCALE.flowerPatch.max * rung;
    assert.ok(
      widestAtRung < limit,
      `at rung ${rung} the widest flower patch is ${widestAtRung.toFixed(3)} units against the bloom's half-width ${limit}`,
    );
  }
  // And the bound BINDS: the boldest rung must be close enough to the limit that the assertion
  // above could actually fail — a bound with an order of magnitude of slack is one nobody derived.
  const widest = KIT_ROLE_SIZE.flowerPatch.units * COVER_SCALE.flowerPatch.max * boldest;
  assert.ok(
    widest > limit * 0.8,
    `the flower-patch width is ${widest.toFixed(3)} against a limit of ${limit} — the bound is not what sized it`,
  );
  assert.equal(KIT_ROLE_SIZE.flowerPatch.axis, 'width', 'a flat prop sized by height blows up its footprint');
});

test('the withdrawn signals are recorded rather than forgotten', () => {
  assert.deepEqual(Object.keys(POCKETED_SIGNALS).sort(), ['log', 'rock']);
  for (const [prop, signal] of Object.entries(POCKETED_SIGNALS)) {
    assert.ok(signal.length > 20, `${prop} was pocketed without saying what it carried`);
  }
  for (const role of KIT_ROLES) {
    assert.ok(!(role in POCKETED_SIGNALS), `${role} is both live and pocketed`);
  }
});

test('every role names at least one assembly, and every assembly at least one kit object', () => {
  for (const role of KIT_ROLES) {
    const assemblies = KIT_ROLE_ASSEMBLIES[role];
    assert.ok(assemblies.length > 0, `${role} has no assembly to draw`);
    for (const assembly of assemblies) {
      assert.ok(KIT_ASSEMBLIES[assembly].length > 0, `${assembly} names no kit object`);
    }
  }
});

test('THE EMBEDDED ASSET CARRIES EVERY OBJECT THE VOCABULARY DECLARES', () => {
  // ⚠ The floor that stops a quietly emptier island. Every placement is per assembly FOUND, so an
  // asset that lost an object would draw fewer props and nothing else would say so. The manifest
  // is hand-authored upstream of the export, so this is a genuine two-place mismatch — and it now
  // asks the EMBEDDED bytes, which is what the shipped canvas will actually parse.
  const inAsset = new Set(kitObjectsInAsset());
  const missing = kitObjectNames().filter((n) => !inAsset.has(n));
  assert.deepEqual(missing, [], `the embedded kit is missing: ${missing.join(', ')}`);
});

test('the asset carries nothing the vocabulary does not use — a paid-for byte draws something', () => {
  // The payload scales with DISTINCT objects, not with how many are placed, so an object nobody
  // places is pure wire cost — and now wire cost in a `.ts` module that crosses into the public
  // engine copy. This is the direction the manifest check above cannot see.
  const declared = new Set(kitObjectNames());
  const unused = kitObjectsInAsset().filter((n) => !declared.has(n));
  assert.deepEqual(unused, [], `the kit ships objects nothing places: ${unused.join(', ')}`);
});

test('the vocabulary covers all six states, and only unknown grows nothing', () => {
  assert.deepEqual(stateForm('healthy'), { role: 'tree', tint: null });
  assert.deepEqual(stateForm('mapped'), { role: 'tree', tint: 'mapped' });
  assert.deepEqual(stateForm('proposed'), { role: 'tree', tint: 'proposed' });
  assert.deepEqual(stateForm('building'), { role: 'tree', tint: 'building' });
  assert.deepEqual(stateForm('unhealthy'), { role: 'deadTree', tint: null });
  // ⚠ An island that drew a confident tree for a capability whose state is UNKNOWN would be the
  // art asserting a proof state the work does not hold — the one way this arc can do real harm
  // (ADR-0392 D5 / ADR-0398 D7), and now on the map that ships.
  assert.equal(stateForm('unknown'), null);
  assert.equal(stateForm('retired'), null);
  assert.equal(stateForm(''), null);
});

test('proposed and building are ONE token under two keys, exactly as ADR-0462 holds them', () => {
  assert.equal(LEAF_TINT_TOKEN.get('proposed'), LEAF_TINT_TOKEN.get('building'));
  assert.equal(stateForm('proposed')?.role, stateForm('building')?.role);
});

test('every tint a state asks for is declared, and every declared tint is reachable', () => {
  for (const state of VOCABULARY_STATES) {
    const form = stateForm(state);
    if (!form?.tint) continue;
    assert.ok(LEAF_TINT_TOKEN.has(form.tint), `${state} asks for an undeclared tint`);
  }
  for (const state of LEAF_TINT_TOKEN.keys()) {
    assert.equal(stateForm(state)?.tint, state, `the tint for ${state} is unreachable`);
  }
  assert.deepEqual(tintedStates().sort(), ['building', 'mapped', 'proposed']);
});

test('the object floor is a claim about SIGNALS, and the ground cover is honestly under it', () => {
  assert.equal(clearsObjectFloor('tree'), true);
  assert.equal(clearsObjectFloor('deadTree'), true);
  // A criterion marker is deliberately below the floor at the overview: the procedural flower
  // markers do not clear it either, and making one tree-sized so that it would is the art
  // asserting an importance the signal does not have.
  assert.equal(clearsObjectFloor('bloom'), false);
  assert.equal(KIT_ROLE_SIZE.bloom.axis, 'width');

  // ⚠⚠ AND EVERY DRESSING ROLE IS UNDER IT BY CONSTRUCTION, which is what ground cover IS. This
  // asserts the direction rather than exempting them silently: a dressing role that CLEARED the
  // floor would be a bush as wide as a pine's canopy, which is the 8.2-unit flower of 2026-08-29
  // wearing a different name. The floor's own guarantee is unweakened — it still binds every
  // role that reports something, and `SCENE_ROLES` is where that is now read.
  for (const role of DRESSING_ROLES) {
    assert.equal(clearsObjectFloor(role), false, `${role} is scenery sized like a signal`);
    assert.equal(KIT_ROLE_SIZE[role].axis, 'width', `${role} is a flat prop and must be sized by width`);
    assert.ok(KIT_ROLE_SIZE[role].units < MIN_PROP_WIDTH / 2, `${role} is not ground cover at that size`);
  }
});

test('the object floor is read on the axis the role is SIZED by, not always the height', () => {
  // ⚠ Height foreshortens at the render elevation and width does not, so one floor for both would
  // be wrong for one of them. Asserting the two floors are different numbers AND that each role
  // is judged against its own is what stops the pair collapsing into one.
  assert.notEqual(MIN_PROP_HEIGHT, MIN_PROP_WIDTH);
  assert.equal(KIT_ROLE_SIZE.tree.axis, 'height');
  assert.ok(deliveredRolePx('tree', 1) < KIT_ROLE_SIZE.tree.units, 'height did not foreshorten');
  assert.equal(deliveredRolePx('bloom', 1), KIT_ROLE_SIZE.bloom.units, 'width foreshortened');
  assert.equal(deliveredHeightPx(10, 2), 20 * Math.cos((RENDER_ELEV_DEG * Math.PI) / 180));
});

// ---------------------------------------------------------------------------
// reading the facts off the map's own parcels
// ---------------------------------------------------------------------------

test('each capability is counted once, with its own parcel’s status', () => {
  const cells = island(['healthy', 'unhealthy', 'proposed']);
  assert.deepEqual(capabilityFactsFrom(cells), [
    { capId: 'cap-0', status: 'healthy' },
    { capId: 'cap-1', status: 'unhealthy' },
    { capId: 'cap-2', status: 'proposed' },
  ] satisfies CapabilityFacts[]);
});

test('⚠ a cell with no parcel belongs to no capability, and is not a capability of its own', () => {
  // The classic extruded-hex substrate carries no parcel groups at all, so every cell arrives
  // this way. Inventing a capability for them would put objects on a map asserting work that no
  // parcel names; dropping the cells instead would shrink the ground a whole-story bloom may
  // stand on. Neither: they are ground with no capability.
  const cells: LayoutCell[] = [
    ...island(['healthy']),
    ...parcel('cap-x', 'healthy', 3, 2).map((c) => ({ ...c, parcel: undefined })),
  ];
  assert.deepEqual(capabilityFactsFrom(cells), [{ capId: 'cap-0', status: 'healthy' }]);
  assert.equal(cellsByParcel(cells).size, 1);
  assert.equal(cells.filter((c) => c.parcel === undefined).length, 2, 'the fixture lost its point');
});

test('the status comes off the parcel, not off the island — six states reach six forms', () => {
  const cells = island(['healthy', 'mapped', 'proposed', 'building', 'unhealthy', 'unknown']);
  const placements = dress(cells);
  const of = (capId: string): KitPlacement | undefined => placements.find((p) => p.capId === capId);
  assert.equal(of('cap-0')?.tint, null, "a healthy capability wears the kit's own needles");
  assert.equal(of('cap-1')?.tint, 'mapped');
  assert.equal(of('cap-2')?.tint, 'proposed');
  assert.equal(of('cap-3')?.tint, 'building');
  assert.equal(of('cap-4')?.role, 'deadTree');
  assert.equal(of('cap-4')?.tint, null, 'a bare dead trunk was given leaves to tint');
  assert.equal(of('cap-5'), undefined, 'an unknown capability was dressed with something');
});

// ---------------------------------------------------------------------------
// the dressing
// ---------------------------------------------------------------------------

test('ONE object per capability, whatever its parcel holds', () => {
  // The whole of the owner's density answer, as an assertion (ADR-0475 D1). The previous
  // vocabulary grew one pine per contract proven, so this is the test that would have failed then
  // — and the parcels here deliberately differ in cell count, which under the old rule mattered.
  const cells = [
    ...parcel('cap-0', 'healthy', 0, 6),
    ...parcel('cap-1', 'healthy', 1, 2),
    ...parcel('cap-2', 'mapped', 2, 4),
  ];
  const placements = dress(cells);
  for (const fact of capabilityFactsFrom(cells)) {
    const own = placements.filter((p) => p.capId === fact.capId);
    assert.equal(own.length, 1, `${fact.capId} grew ${own.length} objects`);
  }
});

test('the two pine assemblies alternate — eleven capabilities are not eleven identical trees', () => {
  const placements = dress(island(Array.from({ length: 6 }, () => 'healthy')));
  const used = new Set(placements.map((p) => p.assembly));
  assert.ok(used.size > 1, `every tree is the same silhouette (${[...used].join(', ')})`);
});

test('one bloom per SIGNED criterion, and none when there are none', () => {
  assert.equal(dress(ALL_HEALTHY, { blooms: 4 }).filter((p) => p.role === 'bloom').length, 4);
  assert.equal(dress(ALL_HEALTHY, { blooms: 0 }).filter((p) => p.role === 'bloom').length, 0);
  // ⚠ Fail closed on a nonsense count rather than throwing or looping: a negative bloom count is
  // a caller's arithmetic error, and an island that refused to draw at all over one would take
  // the whole map down for a criterion tally.
  assert.equal(dress(ALL_HEALTHY, { blooms: -3 }).filter((p) => p.role === 'bloom').length, 0);
});

test('a bloom belongs to the STORY and stands anywhere on the island', () => {
  // ADR-0226 D4: one flower per criterion the owner signed, and the criteria are the STORY's.
  // Filing them under a capability would be the map asserting who owns a signature.
  const blooms = dress(ALL_HEALTHY, { blooms: 5 }).filter((p) => p.role === 'bloom');
  assert.equal(blooms.length, 5);
  for (const b of blooms) {
    assert.equal(b.capId, 'story');
    assert.equal(b.tint, null);
  }
});

test('the dressing is deterministic, and the seed really reaches the scatter', () => {
  // `Math.random` is forbidden on this surface (ADR-0380 D6 fence 2): two islands differing in
  // WHICH props were drawn would present that difference as the direction.
  assert.deepEqual(dress(ALL_HEALTHY, { blooms: 3 }), dress(ALL_HEALTHY, { blooms: 3 }));
  assert.notDeepEqual(
    dress(ALL_HEALTHY, { blooms: 3 }),
    dress(ALL_HEALTHY, { blooms: 3, seed: 12 }),
    'the seed does nothing, so the scatter is not seeded',
  );
});

test('the census names each tinted arm separately', () => {
  const census = dressingCensus(dress(island(['healthy', 'healthy', 'mapped']), { blooms: 2 }));
  assert.equal(census['tree:mapped'], 1);
  assert.equal(census['tree'], 2);
  assert.equal(census['bloom'], 2);
});

test('a capability with no cells grows nothing rather than standing at the origin', () => {
  // The facts and the cells are separate arguments now, so they can disagree — and the honest
  // answer to "this capability has no ground" is no object, never one placed at (0, 0).
  const cells = island(['healthy']);
  const placements = dressIslandFromKit({
    cells,
    facts: [
      { capId: 'cap-0', status: 'healthy' },
      { capId: 'cap-ghost', status: 'healthy' },
    ],
    blooms: 0,
    buds: 0,
    wilts: 0,
    relief: 0,
    footprint: FOOT,
  });
  assert.deepEqual(placements.map((p) => p.capId), ['cap-0']);
});

// ---------------------------------------------------------------------------
// THE PLACEMENT
// ---------------------------------------------------------------------------

test('NO TWO PROPS OVERLAP on a dressed island', () => {
  // ⚠⚠ THE DEFECT THE OWNER REPORTED: "the rocks are appearing where the trees are". Measured on
  // the harness island on 2026-08-29 before the fix, 26 of 2,926 prop pairs overlapped — seven
  // rock-on-tree, SIX TREE ON TREE — the worst putting a rock 8.57 ground units inside a pine.
  // The cause was scattering one ROLE at a time with the gap rejection inside that one call, so
  // no prop was ever tested against a prop of another role.
  const cells = island(['healthy', 'unhealthy', 'building', 'unknown', 'mapped', 'proposed']);
  const overlaps = dressingOverlaps(dress(cells, { blooms: 6 }), FOOT);
  assert.deepEqual(
    overlaps,
    [],
    `props overlap: ${overlaps.map((o) => `${o.a}/${o.b} by ${(-o.gap).toFixed(2)}`).join(', ')}`,
  );
});

test('every single-state island is clear too', () => {
  for (const status of ['healthy', 'mapped', 'proposed', 'building', 'unhealthy'] as const) {
    const cells = island(Array.from({ length: 6 }, () => status));
    const overlaps = dressingOverlaps(dress(cells, { blooms: 6 }), FOOT);
    assert.deepEqual(overlaps, [], `an all-${status} island overlaps ${overlaps.length} pairs`);
  }
});

test('THE OVERLAP DETECTOR CAN FIRE — it is not a check that passes on everything', () => {
  // ⚠ Without this the two assertions above are satisfied by a detector that never returns
  // anything, which is the commonest fault class in this repo.
  const at = (x: number, z: number): KitPlacement => ({
    role: 'tree',
    assembly: 'pine-a',
    capId: `c${x}`,
    tint: null,
    at: { x, z },
    y: 0,
    yaw: 0,
    scale: 1,
  });
  assert.equal(dressingOverlaps([at(0, 0), at(0, 0)], FOOT).length, 1);
  assert.equal(dressingOverlaps([at(0, 0), at(FOOT.tree * 0.999, 0)], FOOT).length, 1);
  assert.equal(dressingOverlaps([at(0, 0), at(FOOT.tree * 1.001, 0)], FOOT).length, 0);
  // And it reports HOW FAR inside, not merely that something is.
  assert.equal(dressingOverlaps([at(0, 0), at(0, 0)], FOOT)[0]?.gap, -FOOT.tree);
});

test('every prop stands inside the parcel whose state put it there', () => {
  // A tree straddling a boundary belongs to neither capability, and the map's whole claim is that
  // a capability's state is read off ITS OWN ground.
  const cells = island(['healthy', 'unhealthy', 'mapped', 'proposed'], 5);
  const byParcel = cellsByParcel(cells);
  const inQuad = (pts: readonly { x: number; z: number }[], p: { x: number; z: number }): boolean => {
    let inside = false;
    for (const [i, a] of pts.entries()) {
      const b = pts[(i + pts.length - 1) % pts.length]!;
      if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  };
  for (const placement of dress(cells)) {
    if (placement.capId === 'story') continue;
    const parcelCells = byParcel.get(placement.capId) ?? [];
    assert.ok(
      parcelCells.some((cell) => inQuad(cell.points, placement.at)),
      `a ${placement.role} for ${placement.capId} stands outside its parcel`,
    );
  }
});

test('props ride the relief rather than floating over it', () => {
  const flat = dress(ALL_HEALTHY, { blooms: 3 });
  const hilly = dress(ALL_HEALTHY, { blooms: 3, relief: 6 });
  assert.equal(flat.length, hilly.length, 'the relief changed WHICH props are drawn');
  assert.ok(flat.every((p) => p.y === 0), 'a flat island lifted a prop off the ground');
  assert.ok(hilly.some((p) => p.y !== 0), 'the relief field did not reach the props at all');
  // The horizontal placement must not move with the relief, or the two arms of any relief
  // comparison would differ in two things at once.
  assert.deepEqual(flat.map((p) => [p.at.x, p.at.z]), hilly.map((p) => [p.at.x, p.at.z]));
  // And the height is the LAND'S OWN field at that point, not some other lift.
  for (const p of hilly) assert.equal(p.y, landHeight(p.at.x, p.at.z, 6));
});

test('⚠ the relief AMPLITUDE reaches the props — not just "some relief"', () => {
  // A placement that lifted by a hardcoded field would pass the test above. These two amplitudes
  // must give different heights at the same points, and in proportion, because `landHeight` is
  // exactly linear in its amplitude.
  const low = dress(ALL_HEALTHY, { relief: 2 });
  const high = dress(ALL_HEALTHY, { relief: 6 });
  assert.deepEqual(low.map((p) => [p.at.x, p.at.z]), high.map((p) => [p.at.x, p.at.z]));
  const moved = low.filter((p, i) => Math.abs(p.y - high[i]!.y) > 1e-9);
  assert.ok(moved.length > 0, 'the amplitude reached no prop');
  for (const [i, p] of low.entries()) {
    assert.ok(Math.abs(high[i]!.y - p.y * 3) < 1e-9, 'the lift is not linear in the amplitude');
  }
});

test('a wider footprint pushes the props apart rather than being ignored', () => {
  // The footprint is an ARGUMENT, so a placement that ignored it would look correct in every test
  // above — they all pass the same table. Widening it must move the arrangement.
  //
  // ⚠⚠ AND THE ISLAND HAS TO BE CROWDED FOR THIS TO ASK ANYTHING, which is a property of the
  // search worth writing down rather than a fixture detail. The candidate chosen maximises
  // `distance − (radius + other.radius)`; when ONE neighbour dominates, scaling every radius
  // subtracts the same constant from every candidate and the argmax does not move. So on a roomy
  // island the footprint genuinely changes nothing, and a fixture like that would report "the
  // footprint is ignored" for a placement that honours it perfectly. Two capabilities on two
  // small parcels with ten blooms competing for the same ground is where it bites.
  const tight = island(['healthy', 'mapped'], 2);
  // ⚠ EVERY ROLE SCALED, not the three the placement happens to stand. A partial table would
  // typecheck only while the vocabulary held those three, and would then silently stop widening
  // whichever role was added next.
  const wide = Object.fromEntries(
    KIT_ROLES.map((r) => [r, FOOT[r] * 2.5]),
  ) as Record<KitRole, number>;
  assert.notDeepEqual(
    dress(tight, { blooms: 10 }).map((p) => [p.at.x, p.at.z]),
    dress(tight, { blooms: 10, footprint: wide }).map((p) => [p.at.x, p.at.z]),
    'the footprint reached no placement decision at all',
  );
});

test('a prop is pulled off the edges its cell shares with a neighbour', () => {
  // A tree sitting exactly on a boundary reads as belonging to neither parcel. The candidate
  // sampler pulls every point toward its cell's centroid for that reason, and the pull has to be
  // real: with none, a bilinear sample would reach the corners.
  const cells = parcel('cap-0', 'healthy', 0, 3);
  const [placed] = dress(cells);
  assert.ok(placed, 'the parcel grew nothing');
  const xs = cells.flatMap((c) => c.points.map((p) => p.x));
  const zs = cells.flatMap((c) => c.points.map((p) => p.z));
  const margin = 0.5;
  assert.ok(placed.at.x > Math.min(...xs) + margin && placed.at.x < Math.max(...xs) - margin);
  assert.ok(placed.at.z > Math.min(...zs) + margin && placed.at.z < Math.max(...zs) - margin);
});

test('a degenerate cell is stepped over rather than sampled', () => {
  // A ring of fewer than three vertices bounds no area, so a bilinear sample of it is a point on
  // a line. `worldTo3D` already refuses to emit one, but the placement takes cells from any
  // caller and must not depend on that.
  const cells: LayoutCell[] = [
    {
      points: [{ x: 200, z: 0 }, { x: 201, z: 0 }],
      parcel: 'cap-0',
      island: undefined,
      status: 'healthy',
      cellId: 'd',
    },
    ...parcel('cap-0', 'healthy', 0, 2),
  ];
  const placements = dress(cells);
  assert.equal(placements.length, 1);
  assert.ok(placements[0]!.at.x >= ORIGIN_X, 'the placement came off the degenerate cell');
});

// ---------------------------------------------------------------------------
// the placement's own arithmetic, asserted where it lives
// ---------------------------------------------------------------------------
//
// ⚠⚠ WHY THESE ARE EXPORTED AT ALL. The stream, the candidate sampler and the best-candidate
// search were private, so the only thing any assertion could see was where a prop ended up — and
// where a prop ends up is stable under a great many wrong arithmetics, because the search's argmax
// does not move when every candidate shifts by the same amount. `check:mutation-diff` charged
// forty-odd mutants to code no test could address. The subject of these assertions was never the
// finished island.

/** The vocabulary's own golden-angle yaw for the i-th prop of a run. */
const goldenYaw = (i: number): number => (i * 2.399963) % (Math.PI * 2);

test('the placement stream is a deterministic LCG — same seed, same numbers, in [0, 1)', () => {
  // ⚠ `Math.random` is forbidden on this surface (ADR-0380 D6 fence 2): a scatter that moved
  // between runs would present that movement as the direction. The constants are Numerical
  // Recipes' LCG and are asserted as ARITHMETIC rather than against a recorded sequence, so a
  // fixture cannot agree with a mutated multiplier by having been recorded from it.
  const first = propStream(7);
  let s = 7 | 0 || 1;
  for (const _ of Array.from({ length: 5 })) {
    void _;
    s = (s * 1664525 + 1013904223) | 0;
    assert.equal(first(), ((s >>> 8) & 0xffffff) / 0x1000000);
  }

  const a = propStream(11);
  const b = propStream(11);
  const c = propStream(12);
  const runA = Array.from({ length: 8 }, () => a());
  assert.deepEqual(Array.from({ length: 8 }, () => b()), runA, 'the stream is not deterministic');
  assert.notDeepEqual(Array.from({ length: 8 }, () => c()), runA, 'the seed does not reach it');
  for (const n of runA) assert.ok(n >= 0 && n < 1, `${n} is outside [0, 1)`);

  // ⚠ SEED 0 IS THE DEGENERATE ONE and is mapped to 1: an LCG at zero times any multiplier is
  // still zero plus the increment, which is a fixed point for the low bits and a visibly poorer
  // stream. `|| 1` is what stops a caller's honest `seed: 0` producing it.
  assert.deepEqual(
    Array.from({ length: 4 }, propStream(0)),
    Array.from({ length: 4 }, propStream(1)),
  );
});

test('candidates land INSIDE their cell, pulled off the edges it shares with a neighbour', () => {
  // ⚠ A tree straddling a parcel boundary reads as belonging to neither, so the bilinear sample is
  // pulled toward the cell's own centroid — between 18% and 30% of the way, jittered so a row of
  // cells does not put every prop at the same relative spot.
  const cells = parcel('cap-0', 'healthy', 0, 1);
  const cell = cells[0]!;
  const pts = candidatePoints(cells, 64, 5);
  assert.equal(pts.length, 64);

  const cx = cell.points.reduce((n, p) => n + p.x, 0) / 4;
  const cz = cell.points.reduce((n, p) => n + p.z, 0) / 4;
  const x0 = ORIGIN_X;
  const z0 = ORIGIN_Z;
  for (const p of pts) {
    assert.ok(p.x > x0 && p.x < x0 + CELL_W, `${p.x} is outside the cell in x`);
    assert.ok(p.z > z0 && p.z < z0 + CELL_D, `${p.z} is outside the cell in z`);
    // The pull is toward the CENTROID, so every sample is strictly inside the inset box.
    assert.ok(Math.abs(p.x - cx) <= (CELL_W / 2) * (1 - 0.18) + 1e-9, `${p.x} was not pulled in`);
    assert.ok(Math.abs(p.z - cz) <= (CELL_D / 2) * (1 - 0.18) + 1e-9, `${p.z} was not pulled in`);
  }
  // NON-VACUITY: the cell is WIDER than it is deep, so the samples must spread further in x than
  // in z — a sampler that had swapped its two axes would satisfy every bound above.
  const spread = (ns: readonly number[]): number => Math.max(...ns) - Math.min(...ns);
  assert.ok(
    spread(pts.map((q) => q.x)) > spread(pts.map((q) => q.z)),
    'the samples spread the same either way — the axes may be swapped',
  );
});

test('a candidate is the cell’s own BILINEAR sample, at the pull the jitter asked for', () => {
  // ⚠⚠ THE ARITHMETIC ITSELF, against a cell whose four corners are all different — a rectangle
  // would let a sampler that interpolated the wrong pair of corners produce the same point.
  const skew: LayoutCell = {
    points: [
      { x: 100, z: 200 },
      { x: 140, z: 210 },
      { x: 150, z: 260 },
      { x: 90, z: 240 },
    ],
    parcel: 'cap-0',
    island: undefined,
    status: 'healthy',
    cellId: 'skew',
  };
  const rand = propStream(3);
  // ⚠ THE CELL IS PICKED FIRST and consumes the stream before `u` does; a replay that started at
  // `u` would compare against the wrong three numbers and look like an arithmetic error.
  rand();
  const u = rand();
  const v = rand();
  const jitter = rand();
  const [a, b, c, d] = skew.points as [GPoint, GPoint, GPoint, GPoint];
  const top = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
  const bot = { x: d.x + (c.x - d.x) * u, z: d.z + (c.z - d.z) * u };
  const raw = { x: top.x + (bot.x - top.x) * v, z: top.z + (bot.z - top.z) * v };
  const cx = skew.points.reduce((n, p) => n + p.x, 0) / 4;
  const cz = skew.points.reduce((n, p) => n + p.z, 0) / 4;
  const pull = 0.18 + jitter * 0.12;

  // The first candidate of a one-cell set consumes the stream in exactly this order.
  const [first] = candidatePoints([skew], 1, 3);
  assert.ok(Math.abs(first!.x - (raw.x + (cx - raw.x) * pull)) < 1e-12, `x ${first!.x}`);
  assert.ok(Math.abs(first!.z - (raw.z + (cz - raw.z) * pull)) < 1e-12, `z ${first!.z}`);
});

test('a TRIANGULAR cell closes on its first vertex rather than sampling undefined', () => {
  // The substrate emits quadrilaterals, but `parcelCellsFrom` keeps any ring of three or more —
  // and a missing fourth corner read as `undefined` puts a prop at NaN, which draws nowhere.
  const tri: LayoutCell = {
    points: [
      { x: 10, z: 10 },
      { x: 30, z: 12 },
      { x: 20, z: 34 },
    ],
    parcel: 'cap-0',
    island: undefined,
    status: 'healthy',
    cellId: 'tri',
  };
  const pts = candidatePoints([tri], 16, 2);
  assert.equal(pts.length, 16);
  for (const p of pts) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z), 'a candidate is NaN');
});

test('a cell with fewer than three corners is stepped over, and so are no cells and no count', () => {
  const degenerate: LayoutCell = {
    points: [
      { x: 0, z: 0 },
      { x: 1, z: 0 },
    ],
    parcel: 'cap-0',
    island: undefined,
    status: 'healthy',
    cellId: 'line',
  };
  // ⚠ SKIPPED, NOT SAMPLED: a bilinear read of two points is a point on a line, which would put a
  // prop on the seam between two parcels.
  assert.deepEqual(candidatePoints([degenerate], 8, 1), []);
  assert.deepEqual(candidatePoints([], 8, 1), []);
  assert.deepEqual(candidatePoints(parcel('cap-0', 'healthy', 0, 1), 0, 1), []);
  assert.deepEqual(candidatePoints(parcel('cap-0', 'healthy', 0, 1), -3, 1), []);
  // NON-VACUITY: the same cells with a positive count do sample.
  assert.equal(candidatePoints(parcel('cap-0', 'healthy', 0, 1), 3, 1).length, 3);
});

test('the search takes the candidate whose WORST clearance is largest', () => {
  // ⚠⚠ THIS IS THE DEFECT THE OWNER REPORTED, AS ARITHMETIC. The old dressing scattered one role
  // at a time and its rejection lived inside that call, so a rock was never tested against a tree.
  // The clearance is `distance − (own radius + theirs)`, minimised over everything standing.
  const occupied = [
    { x: 0, z: 0, radius: 2 },
    { x: 30, z: 0, radius: 8 },
  ];
  const candidates = [
    { x: 10, z: 0 }, // 10 − (1+2) = 7 from the first, 20 − (1+8) = 11 from the second → 7
    { x: 16, z: 0 }, // 16 − 3 = 13, 14 − 9 = 5 → 5
    { x: 12, z: 0 }, // 12 − 3 = 9, 18 − 9 = 9 → 9  ← the widest worst case
  ];
  assert.deepEqual(bestCandidate(candidates, 1, occupied), { x: 12, z: 0 });

  // ⚠ THE OTHER RADIUS IS ADDED, NOT SUBTRACTED, and the two occupants have DIFFERENT radii — with
  // equal ones the sign error is a constant shift and the argmax does not move.
  assert.deepEqual(bestCandidate(candidates, 6, occupied), { x: 12, z: 0 });

  // With nothing standing yet every clearance is infinite, so the FIRST candidate wins — which is
  // what makes a dressing's first prop the sampler's first point.
  assert.deepEqual(bestCandidate(candidates, 1, []), { x: 10, z: 0 });
  // A tie keeps the earlier candidate: strictly-greater, not greater-or-equal.
  assert.deepEqual(bestCandidate([{ x: 5, z: 0 }, { x: -5, z: 0 }], 1, [{ x: 0, z: 0, radius: 1 }]), {
    x: 5,
    z: 0,
  });
  assert.equal(bestCandidate([], 1, occupied), null);
});

// ---------------------------------------------------------------------------
// what the dressing composes out of them
// ---------------------------------------------------------------------------

test('a placement IS the search’s own answer over that parcel’s candidates', () => {
  // ⚠ THE COMPOSITION, not the primitives — those are asserted above, and this holds that
  // `dressIslandFromKit` feeds them the seed, the candidate count and the radius it says it does.
  // A radius of `footprint` rather than `footprint / 2`, a seed that ignored the capability's
  // index, or an occupancy list that started non-empty all move this point.
  const cells = island(['healthy', 'healthy']);
  const placements = dress(cells);
  const byParcel = cellsByParcel(cells);

  const firstExpected = bestCandidate(
    candidatePoints(byParcel.get('cap-0')!, 96, 11 + 0 * 97),
    FOOT.tree / 2,
    [],
  );
  assert.deepEqual(placements[0]!.at, firstExpected);

  const secondExpected = bestCandidate(
    candidatePoints(byParcel.get('cap-1')!, 96, 11 + 1 * 97),
    FOOT.tree / 2,
    [{ x: placements[0]!.at.x, z: placements[0]!.at.z, radius: FOOT.tree / 2 }],
  );
  assert.deepEqual(placements[1]!.at, secondExpected);
});

test('the default seed is 11, and it is a default rather than a constant', () => {
  const cells = island(['healthy', 'mapped']);
  assert.deepEqual(dress(cells), dress(cells, { seed: 11 }));
  assert.notDeepEqual(dress(cells), dress(cells, { seed: 12 }));
});

test('each capability’s yaw is the golden-angle turn for its own index', () => {
  // ⚠ A yaw derived from the index is what stops eleven pines facing the same way, which reads as
  // a repeated stamp rather than as a forest. It is asserted as the sequence rather than as
  // "they differ", because two props differing is satisfied by any wrong turn.
  const placements = dress(island(['healthy', 'mapped', 'building', 'unhealthy']));
  assert.equal(placements.length, 4);
  placements.forEach((p, i) => assert.ok(Math.abs(p.yaw - goldenYaw(i)) < 1e-12, `yaw ${i}`));
  assert.ok(placements[1]!.yaw > 0, 'the second prop was not turned at all');
});

test('the two pine arms alternate BY INDEX — not "both appear somewhere"', () => {
  // A set of two assemblies is satisfied by an index that lands out of range half the time, which
  // is exactly what `fi * choices.length` does: every other capability gets `undefined`.
  const placements = dress(island(Array.from({ length: 5 }, () => 'healthy')));
  assert.deepEqual(
    placements.map((p) => p.assembly),
    ['pine-a', 'pine-b', 'pine-a', 'pine-b', 'pine-a'],
  );
});

test('the blooms take the golden angle and their own seed run, off the WHOLE island', () => {
  const placements = dress(ALL_HEALTHY, { blooms: 3 });
  const blooms = placements.filter((p) => p.role === 'bloom');
  assert.equal(blooms.length, 3);
  blooms.forEach((p, i) => assert.ok(Math.abs(p.yaw - goldenYaw(i)) < 1e-12, `bloom yaw ${i}`));

  const all = ALL_HEALTHY.filter((c) => c.parcel !== undefined);
  const occupied = placements
    .filter((p) => p.role !== 'bloom')
    .map((p) => ({ x: p.at.x, z: p.at.z, radius: FOOT.tree / 2 }));
  assert.deepEqual(
    blooms[0]!.at,
    bestCandidate(candidatePoints(all, 96, 11 + 7717 + 0 * 131), FOOT.bloom / 2, occupied),
  );
  // ⚠ THE SEED MOVES PER BLOOM, AND IT MOVES BY `+ i * 131`. Asserting only that two blooms differ
  // is satisfied by any per-bloom seed at all, including one that walks the wrong way.
  const occupiedThen = [
    ...occupied,
    { x: blooms[0]!.at.x, z: blooms[0]!.at.z, radius: FOOT.bloom / 2 },
  ];
  assert.deepEqual(
    blooms[1]!.at,
    bestCandidate(candidatePoints(all, 96, 11 + 7717 + 131), FOOT.bloom / 2, occupiedThen),
  );
  assert.notDeepEqual(blooms[0]!.at, blooms[1]!.at);
  assert.notDeepEqual(blooms[1]!.at, blooms[2]!.at);

  // ⚠ A BLOOM BELONGS TO THE STORY, and says so: it is the one placement whose `capId` names no
  // capability, which is what stops a criterion marker being read as one capability's own signal.
  for (const b of blooms) {
    assert.equal(b.capId, 'story');
    // ⚠ AND THE BLOOM'S OWN ASSEMBLY. `flower` is the only arm its role serves, so a bloom naming
    // anything else is a placement the kit cannot draw — `kitMeshes` refuses it, which turns a
    // signed criterion into a crashed canvas rather than a missing marker.
    assert.equal(b.assembly, 'flower');
    assert.equal(b.tint, null);
  }
  assert.deepEqual(KIT_ROLE_ASSEMBLIES.bloom, ['flower']);
  assert.equal(new Set(placements.filter((p) => p.role !== 'bloom').map((p) => p.capId)).size, 6);
});

test('⚠ a bloom never stands on ground that belongs to no capability', () => {
  // ⚠⚠ A bloom is a claim about the STORY, so it may stand anywhere a capability's parcel is —
  // but a cell carrying no parcel is not part of any capability's ground, and the substrate emits
  // some. A scatter over every cell would put a signed criterion on land the map does not
  // attribute, which reads as a criterion belonging to something the island does not show.
  const orphan: LayoutCell = {
    points: [
      { x: 900, z: 900 },
      { x: 940, z: 900 },
      { x: 940, z: 930 },
      { x: 900, z: 930 },
    ],
    parcel: undefined,
    island: undefined,
    status: 'healthy',
    cellId: 'orphan',
  };
  const placements = dress([...island(['healthy']), orphan], { blooms: 4 });
  const blooms = placements.filter((p) => p.role === 'bloom');
  assert.equal(blooms.length, 4);
  for (const b of blooms) {
    assert.ok(b.at.x < 800, `a bloom stood on the unattributed cell at ${b.at.x}`);
  }
});

test('a capability whose cells are ALL degenerate grows nothing, rather than standing at NaN', () => {
  // ⚠ `bestCandidate` answers `null` when the sampler found nowhere to stand, and the placement
  // must drop the prop rather than push it: `y` is read off the relief AT the point, so a null
  // point is a crash on a good day and an island-wide NaN on a bad one.
  const flat: LayoutCell[] = [0, 1].map((c) => ({
    points: [
      { x: 400 + c, z: 400 },
      { x: 401 + c, z: 400 },
    ],
    parcel: 'cap-flat',
    island: undefined,
    status: 'healthy',
    cellId: `flat-${c}`,
  }));
  const placements = dressIslandFromKit({
    cells: flat,
    facts: [{ capId: 'cap-flat', status: 'healthy' }],
    blooms: 0,
    buds: 0,
    wilts: 0,
    relief: 0,
    footprint: FOOT,
  });
  assert.deepEqual(placements, []);
});

test('⚠ the radius the placement keeps is the radius the detector measures against', () => {
  // ⚠⚠ WHY THIS IS A TWO-PLACE CLAIM RATHER THAN A GEOMETRIC ONE. `bestCandidate` scores
  // `distance − (own radius + theirs)`, so scaling EVERY radius by a constant subtracts the same
  // amount from every candidate and the argmax does not move: a radius twice too big places
  // identically, and "nothing overlaps" is satisfied by any radius at least as large as the true
  // one. Neither the placement nor the overlap count can see the number. What CAN be held is that
  // both callers read the same one — the clearance a prop is given is the clearance it is judged
  // by — and the detector's own arithmetic is pinned against exact gaps below.
  assert.equal(propRadius(FOOT, 'tree'), FOOT.tree / 2);
  assert.equal(propRadius(FOOT, 'bloom'), FOOT.bloom / 2);
  assert.equal(propRadius(FOOT, 'deadTree'), FOOT.deadTree / 2);

  // The placement's own occupancy: a second capability's tree is placed against the first at
  // exactly this radius, so a dressing IS the search run with these numbers.
  const cells = island(['healthy', 'healthy']);
  const placements = dress(cells);
  const byParcel = cellsByParcel(cells);
  assert.deepEqual(
    placements[1]!.at,
    bestCandidate(
      candidatePoints(byParcel.get('cap-1')!, 96, 11 + 97),
      propRadius(FOOT, 'tree'),
      [{ x: placements[0]!.at.x, z: placements[0]!.at.z, radius: propRadius(FOOT, 'tree') }],
    ),
  );
});

test('a dressed island has no overlapping pair at the footprint it was dressed with', () => {
  const crowded = island(Array.from({ length: 4 }, () => 'healthy'), 2);
  assert.deepEqual(dressingOverlaps(dress(crowded, { blooms: 6 }), FOOT), []);
});

// ---------------------------------------------------------------------------
// the detector, and the tables a report prints
// ---------------------------------------------------------------------------

test('an overlap is named by role and capability, measured, and reported WORST FIRST', () => {
  // ⚠ Away from the origin on both axes: `a.x - b.x` and `a.x + b.x` coincide for a pair
  // straddling zero, which is how a sign error survives a tidy fixture.
  const p = (role: KitRole, capId: string, x: number): KitPlacement => ({
    role,
    assembly: role === 'bloom' ? 'flower' : 'pine-a',
    capId,
    tint: null,
    at: { x: 300 + x, z: -200 },
    y: 0,
    yaw: 0,
    scale: 1,
  });
  // ⚠⚠ A FOOTPRINT WHOSE HALVES SUM EXACTLY, and gaps whose INSERTION order is neither ascending
  // nor descending. A comparator that returns the same sign for every pair does not leave an array
  // alone — it reverses it — so a fixture whose pairs happen to arrive in descending order is
  // sorted correctly by an arithmetic that compares nothing.
  const exact = { ...FOOT, tree: 8, deadTree: 6, bloom: 4 };
  const overlaps = dressingOverlaps(
    [p('tree', 'a', 0), p('tree', 'b', 1), p('tree', 'c', 7), p('tree', 'd', 7.5)],
    exact,
  );
  assert.deepEqual(
    overlaps.map((o) => [o.a, o.b, Number(o.gap.toFixed(6))]),
    [
      ['tree:c', 'tree:d', -7.5],
      ['tree:a', 'tree:b', -7],
      ['tree:b', 'tree:c', -2],
      ['tree:b', 'tree:d', -1.5],
      ['tree:a', 'tree:c', -1],
      ['tree:a', 'tree:d', -0.5],
    ],
    'the overlaps are not worst-first, or are not named by role and capability',
  );

  // ⚠ TOUCHING IS NOT OVERLAPPING. Two props exactly their own footprints apart have a gap of
  // zero, and reporting that would make the detector fire on a placement that did its job.
  // `10.13 / 2 + 10.13 / 2` is 5e-15 short of `10.13`, so the DECLARED numbers cannot express a
  // true touch at all — a fixture built on them measures the float, not the rule.
  assert.deepEqual(dressingOverlaps([p('tree', 'a', 0), p('tree', 'b', 8)], exact), []);
  assert.equal(dressingOverlaps([p('tree', 'a', 0), p('tree', 'b', 7.9)], exact).length, 1);

  // A mixed pair takes half of EACH footprint, so the two roles' clearances are not interchangeable.
  assert.equal(dressingOverlaps([p('tree', 'a', 0), p('bloom', 'story', 6)], exact).length, 0);
  assert.equal(dressingOverlaps([p('tree', 'a', 0), p('bloom', 'story', 5.9)], exact).length, 1);
  assert.deepEqual(dressingOverlaps([p('tree', 'a', 0)], exact), []);
  assert.deepEqual(dressingOverlaps([], exact), []);
});

test('the vocabulary’s six states are the map’s six, in the order a report prints them', () => {
  assert.deepEqual(VOCABULARY_STATES, [
    'healthy',
    'mapped',
    'proposed',
    'building',
    'unhealthy',
    'unknown',
  ]);
});

test('the TINTED states are exactly the three a crown rotates for', () => {
  // ⚠ `healthy` and `unhealthy` draw an UNTINTED form — the kit's own needles, and a bare dead
  // trunk — and `unknown` draws NO form at all, so it has no tint to ask about. A list that
  // included any of them would have a report claiming a tint that no crown wears.
  assert.deepEqual(tintedStates(), ['mapped', 'proposed', 'building']);
  assert.equal(stateForm('healthy')?.tint, null);
  assert.equal(stateForm('unhealthy')?.tint, null);
  assert.equal(stateForm('unknown'), null);

  // ⚠⚠ THE TWO-PLACE CHECK LIVES HERE, and that is the point: as a second filter inside
  // `tintedStates` it made the first one redundant, so the function agreed with the tint table by
  // construction and could not disagree with it however wrong either got.
  for (const s of tintedStates()) assert.ok(LEAF_TINT_TOKEN.has(s), `${s} has no declared tint`);
  for (const s of LEAF_TINT_TOKEN.keys()) {
    assert.ok(tintedStates().includes(s), `${s} declares a tint no form asks for`);
  }
});

test('the declared object manifest is deduped AND sorted, so a report’s list is stable', () => {
  // Two assemblies can name one object, and a manifest that changed order between runs would
  // make every diff of a payload report unreadable.
  const names = kitObjectNames();
  assert.deepEqual(names, [...names].sort());
  assert.deepEqual(names, [...new Set(names)]);
  assert.ok(names.length > 1, 'the manifest has too few names to be ordered at all');
});

test('a role’s delivered pixels are read on the axis it is SIZED by', () => {
  // ⚠ Width does not foreshorten at this camera and height does, by cos(50°). A bloom sized by
  // width delivers its full width; a tree sized by height delivers less than its own units.
  assert.equal(deliveredRolePx('bloom', 3), KIT_ROLE_SIZE.bloom.units * 3);
  assert.equal(deliveredRolePx('tree', 3), deliveredHeightPx(KIT_ROLE_SIZE.tree.units, 3));
  assert.ok(deliveredRolePx('tree', 1) < KIT_ROLE_SIZE.tree.units, 'height did not foreshorten');
  assert.ok(deliveredRolePx('bloom', 2) > deliveredRolePx('bloom', 1), 'the zoom does not reach it');
});

test('the object floor is read against the size’s OWN axis, at its own threshold', () => {
  // ⚠⚠ THE THREE DECLARED ROLES CANNOT SHOW THIS FORK — 18, 15 and 4 units all fall the same side
  // of both thresholds, so a predicate reading the WRONG axis answers correctly for every role the
  // vocabulary has. The discriminating sizes are the ones BETWEEN the two thresholds, which is
  // exactly the band the fork exists for: width does not foreshorten at this camera and height
  // does, by cos(50°).
  assert.ok(MIN_PROP_WIDTH < MIN_PROP_HEIGHT, 'the two thresholds are not distinguishable');
  const between = (MIN_PROP_WIDTH + MIN_PROP_HEIGHT) / 2;
  assert.equal(sizeClearsObjectFloor({ axis: 'width', units: between }), true);
  assert.equal(sizeClearsObjectFloor({ axis: 'height', units: between }), false);
  // Inclusive at each threshold, and a hair under it is not.
  assert.equal(sizeClearsObjectFloor({ axis: 'width', units: MIN_PROP_WIDTH }), true);
  assert.equal(sizeClearsObjectFloor({ axis: 'width', units: MIN_PROP_WIDTH - 1e-9 }), false);
  assert.equal(sizeClearsObjectFloor({ axis: 'height', units: MIN_PROP_HEIGHT }), true);
  assert.equal(sizeClearsObjectFloor({ axis: 'height', units: MIN_PROP_HEIGHT - 1e-9 }), false);

  // And each role is that predicate over its OWN declared size.
  for (const role of KIT_ROLES) {
    assert.equal(clearsObjectFloor(role), sizeClearsObjectFloor(KIT_ROLE_SIZE[role]), role);
  }
  assert.equal(clearsObjectFloor('tree'), true);
  assert.equal(clearsObjectFloor('bloom'), false);
});

// ---------------------------------------------------------------------------
// the occupancy rule, the frozen heights and the drift checks (2026-09-03; the grove's
// relaxation retired 2026-09-05, ADR-0518)
// ---------------------------------------------------------------------------

/** A placement away from the origin on both axes, so a sign error cannot cancel. */
const stood = (role: KitRole, capId: string, x: number, scale = 1): KitPlacement => ({
  role,
  assembly: role === 'bloom' ? 'flower' : role === 'deadTree' ? 'pine-dead' : 'pine-a',
  capId,
  tint: null,
  at: { x: 300 + x, z: -200 },
  y: 0,
  yaw: 0,
  scale,
});

test('⚠⚠ NO DRESSING ROLE SHARES THE TREE ROLE’S FORM AT ANY SCALE (ADR-0518 D3) — a property of the tables', () => {
  // ADR-0507 D5's reading guarantee used to be a SCALE BAND: grove pines at 0.55–0.80 of the tree
  // role kept the capability's own tree tallest on its parcel. It held in the geometry and failed
  // against the owner, who read the grove as capabilities. With the grove gone the guarantee
  // reduces to a fact about the vocabulary, held here where a picture cannot hide it:
  // (a) no dressing role is served by an assembly that serves a tree role;
  const treeAssemblies = new Set<string>([...KIT_ROLE_ASSEMBLIES.tree, ...KIT_ROLE_ASSEMBLIES.deadTree]);
  for (const role of DRESSING_ROLES) {
    for (const assembly of KIT_ROLE_ASSEMBLIES[role]) {
      assert.ok(!treeAssemblies.has(assembly), `${role} is drawn as ${assembly}, a tree assembly`);
    }
  }
  // (b) no kit object a dressing role draws is a pine part at all — the kit names its trees;
  const dressingObjects = DRESSING_ROLES.flatMap((r) => KIT_ROLE_ASSEMBLIES[r]).flatMap((a) => [...KIT_ASSEMBLIES[a]]);
  const treeObjects = new Set<string>([...treeAssemblies].flatMap((a) => [...KIT_ASSEMBLIES[a as KitAssembly]]));
  for (const name of dressingObjects) {
    assert.ok(!treeObjects.has(name), `${name} is a tree object drawn as dressing`);
    assert.doesNotMatch(name, /pine|tree|trunk/i, `${name} is tree-shaped by the kit's own name`);
  }
  // (c) the SIGNAL table says so in prose the reader sees: the tree entry is the one-per-capability
  //     claim with no qualifier, and no dressing entry mentions a pine or a tree.
  assert.match(KIT_ROLE_SIGNAL.tree, /one tree per capability/);
  for (const role of DRESSING_ROLES) assert.doesNotMatch(KIT_ROLE_SIGNAL[role], /pine|\btree\b/i, `${role}'s prose admits a tree`);
  // (d) and NOTHING in the vocabulary can stand a `tree` role below its size: the placement's
  //     scale is 1 by statement in `dressIslandFromKit`, and the only other placer is the cover,
  //     which places dressing roles only (`cover-dressing.test.ts`). NON-VACUITY for (a)–(b): the
  //     tree roles DO have assemblies and objects, so the disjointness is between two non-empty sets.
  assert.ok(treeAssemblies.size >= 2 && treeObjects.size >= 3 && dressingObjects.length >= 3);
});

test('clearanceFactor is ZERO for any pair that includes ground cover, and 1 for every pair that reports', () => {
  // ⚠ THERE IS NO THIRD ANSWER. The grove's 0.45 between two of its own members went with the
  // grove (ADR-0518); every pair of objects that report something keeps the full sum, whatever
  // their capIds, so an object standing inside another's clearance is always the defect.
  assert.equal(clearanceFactor(stood('tree', 'cap-0', 0), stood('tree', 'cap-1', 5)), 1);
  assert.equal(clearanceFactor(stood('tree', 'cap-0', 0), stood('tree', 'cap-0', 5)), 1, 'the same capId relaxes nothing');
  assert.equal(clearanceFactor(stood('tree', 'grove', 0), stood('tree', 'grove', 5)), 1, 'a capId named grove is just a capId now');
  assert.equal(clearanceFactor(stood('bloom', 'story', 0), stood('tree', 'cap-0', 5)), 1);
  assert.equal(clearanceFactor(stood('deadTree', 'cap-0', 0), stood('bloom', 'story', 5)), 1);
  for (const role of DRESSING_ROLES) {
    assert.equal(clearanceFactor(stood(role, 'cover', 0), stood('tree', 'cap-0', 5)), 0, `${role} keeps a clearance from a tree`);
    assert.equal(clearanceFactor(stood('tree', 'cap-0', 0), stood(role, 'cover', 5)), 0, 'either order');
    assert.equal(clearanceFactor(stood(role, 'cover', 0), stood(role, 'cover', 5)), 0);
  }
});

test('pairClearance is the two role radii summed, NEVER relaxed between objects that report, and NEVER scaled', () => {
  assert.equal(pairClearance(stood('tree', 'cap-0', 0), stood('tree', 'cap-1', 0), FOOT), FOOT.tree);
  assert.equal(pairClearance(stood('tree', 'cap-0', 0), stood('bloom', 'story', 0), FOOT), FOOT.tree / 2 + FOOT.bloom / 2);
  assert.equal(pairClearance(stood('deadTree', 'cap-0', 0), stood('bloom', 'story', 0), FOOT), FOOT.deadTree / 2 + FOOT.bloom / 2);
  // ⚠ The scale does not enter: a pine drawn at half its height keeps the ROLE's clearance from a
  // full-size neighbour, which is what keeps that neighbour readable.
  assert.equal(pairClearance(stood('tree', 'cap-0', 0, 0.5), stood('tree', 'cap-1', 0, 0.5), FOOT), FOOT.tree);
  assert.equal(pairClearance(stood('tree', 'cap-0', 0, 0.55), stood('tree', 'cap-1', 0), FOOT), FOOT.tree);
  assert.equal(pairClearance(stood('bush', 'cover', 0), stood('tree', 'cap-0', 0), FOOT), 0);
});

test('THE DETECTOR FIRES BETWEEN ANY TWO OBJECTS THAT REPORT, inside the full footprint, and never on cover', () => {
  const t = (capId: string, x: number): KitPlacement => stood('tree', capId, x);
  assert.deepEqual(dressingOverlaps([t('cap-0', 0), t('cap-1', FOOT.tree * 1.01)], FOOT), []);
  const inside = dressingOverlaps([t('cap-0', 0), t('cap-1', FOOT.tree * 0.9)], FOOT);
  assert.equal(inside.length, 1, 'two capability pines inside each other’s footprint went undetected');
  assert.ok(Math.abs(inside[0]!.gap - (FOOT.tree * 0.9 - FOOT.tree)) < 1e-9);
  assert.equal(inside[0]!.a, 'tree:cap-0');
  assert.equal(inside[0]!.b, 'tree:cap-1');
  // ⚠ And two pines that would have been grove members under the retired rule — same capId, at
  // 0.5 of a footprint — are an overlap now: there is no relaxed clearance left to apply.
  assert.equal(dressingOverlaps([t('grove', 0), t('grove', FOOT.tree * 0.5)], FOOT).length, 1);
  const bloomNeed = FOOT.tree / 2 + FOOT.bloom / 2;
  assert.equal(dressingOverlaps([stood('bloom', 'story', 0), t('cap-0', bloomNeed * 0.9)], FOOT).length, 1);
  assert.equal(dressingOverlaps([stood('bloom', 'story', 0), t('cap-0', bloomNeed * 1.01)], FOOT).length, 0);
  // Cover at a pine's foot is not a defect — the recipe's own rule, applied by the detector.
  assert.deepEqual(dressingOverlaps([t('cap-0', 0), stood('bush', 'cover', 0), stood('tuft', 'cover', 1)], FOOT), []);
});

test('the census counts every tree as a capability’s — there is no separate key for anything tree-shaped', () => {
  const census = dressingCensus([
    stood('tree', 'cap-0', 0),
    stood('tree', 'cap-1', 20),
    stood('tree', 'cap-2', 40),
    stood('bloom', 'story', 60),
    stood('bush', 'cover', 80),
  ]);
  assert.deepEqual(census, { tree: 3, bloom: 1, bush: 1 });
  // A tinted tree is counted under its tint — the state it reports.
  assert.deepEqual(dressingCensus([{ ...stood('tree', 'cap-0', 0), tint: 'mapped' }]), { 'tree:mapped': 1 });
});

test('the frozen HEIGHTS: the height-sized roles are their declared sizes, the bloom is measured', () => {
  assert.equal(KIT_HEIGHTS_2026_08_29.tree, KIT_ROLE_SIZE.tree.units);
  assert.equal(KIT_HEIGHTS_2026_08_29.deadTree, KIT_ROLE_SIZE.deadTree.units);
  assert.equal(KIT_ROLE_SIZE.bloom.axis, 'width', 'the one role whose height has to be measured');
  // `Red_Flower_01` is 0.980 wide and 0.599 tall in the export, so at 4 units wide it is 2.445 tall.
  assert.ok(Math.abs(KIT_HEIGHTS_2026_08_29.bloom - (KIT_ROLE_SIZE.bloom.units * 0.599) / 0.98) < 1e-3);
  assert.equal(KIT_HEIGHTS_2026_08_29.bloom, 2.445);
  assert.ok(KIT_HEIGHTS_2026_08_29.bloom < MIN_PROP_HEIGHT, 'a flower is under the height floor — it is sized by width');
  for (const role of KIT_ROLES) assert.ok(KIT_HEIGHTS_2026_08_29[role] > 0, `${role} has no height`);
});

test('the drift checks name the role and both numbers past the tolerance, and nothing within it', () => {
  assert.deepEqual(footprintDriftOf(FOOT), []);
  assert.deepEqual(heightDriftOf(KIT_HEIGHTS_2026_08_29), []);
  const lines = footprintDriftOf({ ...FOOT, tree: FOOT.tree * 1.02 });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /^tree: /);
  assert.match(lines[0]!, /footprint/);
  assert.ok(lines[0]!.includes(String(FOOT.tree)), 'the frozen number');
  assert.ok(lines[0]!.includes((FOOT.tree * 1.02).toFixed(3)), 'the measured number');
  // ⚠ THE LINE MUST SAY WHAT TO DO, and it is asserted because it is the WHOLE point of the check:
  // this fires in the shipped canvas's console (`ForestWorldCanvas`), where nothing refuses the run
  // — a reader who is told only that two numbers differ does not know that every placement and
  // every shadow on the map was already computed against the frozen one.
  assert.ok(
    lines[0]!.includes('every placement was computed against the frozen number'),
    'the drift line does not say why it matters',
  );
  assert.ok(lines[0]!.endsWith('re-measure and update the literal'), 'the drift line does not say what to do');
  assert.equal(footprintDriftOf({ ...FOOT, bloom: FOOT.bloom * 0.98 }).length, 1, 'a LOW drift counts too');
  assert.deepEqual(footprintDriftOf({ ...FOOT, deadTree: FOOT.deadTree * 1.009 }), [], 'inside the tolerance');
  assert.equal(
    footprintDriftOf({ ...FOOT, tree: FOOT.tree * 2, deadTree: FOOT.deadTree * 2, bloom: FOOT.bloom * 2 }).length,
    3,
    'a table drifting on three roles must name three, one line each',
  );
  assert.equal(
    footprintDriftOf(Object.fromEntries(KIT_ROLES.map((r) => [r, FOOT[r] * 2])) as Record<KitRole, number>).length,
    KIT_ROLES.length,
    'every role must be compared — a drift check blind to the dressing roles is three holes in it',
  );
  const heights = heightDriftOf({ ...KIT_HEIGHTS_2026_08_29, bloom: 3 });
  assert.equal(heights.length, 1);
  assert.match(heights[0]!, /^bloom: .*height/);
  assert.equal(FOOTPRINT_TOLERANCE, 0.01);
  // The generic reads the DECLARED table it is handed rather than a fixed one.
  assert.deepEqual(roleDrift(FOOT, FOOT, 'x'), []);
  assert.equal(roleDrift(FOOT, KIT_HEIGHTS_2026_08_29, 'x').length, KIT_ROLES.length);
});

test('the search takes a declared need, and its default is the two radii summed', () => {
  assert.equal(sumOfRadii(3, { x: 0, z: 0, radius: 4 }), 7);
  const occupied = [
    { x: 0, z: 0, radius: 2 },
    { x: 30, z: 0, radius: 8 },
  ];
  // The worst clearance of one point: min(10 − 3, 20 − 9) = 7 by the default need.
  assert.equal(worstClearance({ x: 10, z: 0 }, 1, occupied), 7);
  // A declared need that charges ten times the occupant's radius: min(10 − 20, 20 − 80) = −60.
  const tenfold = (_radius: number, o: { radius: number }): number => o.radius * 10;
  assert.equal(worstClearance({ x: 10, z: 0 }, 1, occupied, tenfold), -60);
  assert.equal(worstClearance({ x: 10, z: 0 }, 1, []), Infinity, 'nothing standing: no bound at all');
  // And the search reads it: under the default the widest worst case is x=12; under the tenfold
  // need the gaps are −60 / −66 / −62, so the first candidate wins.
  const candidates = [
    { x: 10, z: 0 },
    { x: 16, z: 0 },
    { x: 12, z: 0 },
  ];
  assert.deepEqual(bestCandidate(candidates, 1, occupied), { x: 12, z: 0 });
  assert.deepEqual(bestCandidate(candidates, 1, occupied, tenfold), { x: 10, z: 0 });
});

test('every object the vocabulary stands is at scale 1 — nothing that reports is ever drawn smaller', () => {
  const placements = dress(island(['healthy', 'mapped', 'unhealthy', 'proposed']), { blooms: 3 });
  assert.ok(placements.length >= 7);
  for (const p of placements) assert.equal(p.scale, 1, `${p.role}:${p.capId} is at scale ${p.scale}`);
});

// ---------------------------------------------------------------------------
// ADR-0600 — every UAT criterion is drawn, and signing changes its FORM
// ---------------------------------------------------------------------------

test('⚠⚠ AN ISLAND STANDS ONE FLOWER PER CRITERION, not one per SIGNATURE', () => {
  // ⚠⚠ THE PLACEMENT HALF OF ADR-0600 D1. Until 2026-09-23 `dressIslandFromKit` took a single
  // `blooms` count, so an island holding five unsigned criteria stood NO flower and read as a
  // story with no acceptance criteria at all — measured over the live corpus, nine islands did
  // exactly that and three more drew only their signed subset with nothing saying the count was
  // partial (`docs/research/chapter2-uat-silence-2026-09-23/`).
  const placements = dress(ALL_HEALTHY, { blooms: 2, buds: 3, wilts: 1 });
  const criteria = placements.filter((p) => isCriterionRole(p.role));
  assert.equal(criteria.length, 6, 'six criteria, six flowers — the count is the CRITERION count');
  assert.deepEqual(
    [criteria.filter((p) => p.role === 'bloom').length, criteria.filter((p) => p.role === 'bud').length, criteria.filter((p) => p.role === 'wilt').length],
    [2, 3, 1],
    'each state stands its own number',
  );
  // Every one of them belongs to the STORY rather than to any capability, as the signed ones
  // always did — a criterion is a claim about the island, not about a parcel.
  for (const p of criteria) assert.equal(p.capId, 'story');

  // ⚠ AND NONE OF THEM IS STACKED ON ANOTHER. Three states placed from one seed stream is one
  // scatter; the detector is what says so, and it is the same detector the signed-only placement
  // was already held to.
  assert.deepEqual(dressingOverlaps(placements, FOOT), []);

  // ⚠ A ZERO IN ONE STATE IS NOT A ZERO IN THE OTHERS — the arm that would pass if the three
  // counts were secretly one.
  assert.equal(dress(ALL_HEALTHY, { blooms: 0, buds: 4, wilts: 0 }).filter((p) => p.role === 'bud').length, 4);
  assert.equal(dress(ALL_HEALTHY, { blooms: 0, buds: 4, wilts: 0 }).filter((p) => p.role === 'bloom').length, 0);
  assert.equal(dress(ALL_HEALTHY, { blooms: 0, buds: 0, wilts: 0 }).filter((p) => isCriterionRole(p.role)).length, 0);
});

test('⚠ THE THREE CRITERION FORMS ARE ONE OBJECT AT TWO SIZES AND TWO ATTITUDES', () => {
  // The committed kit has ONE flower mesh reachable by a criterion marker and it wears a material
  // shared with the grass and the ground cover, so neither a second shape nor a per-state tint is
  // available (`KIT_ROLE_ASSEMBLIES`'s note). What the three forms use instead is stated here so a
  // reader meets the constraint rather than inferring a preference.
  for (const role of CRITERION_ROLES) {
    assert.deepEqual([...KIT_ROLE_ASSEMBLIES[role]], ['flower'], `${role} does not stand the flower`);
    assert.equal(KIT_ROLE_CLASS[role], 'scene', `${role} must report something`);
  }
  assert.deepEqual([...CRITERION_ROLES], ['bloom', 'bud', 'wilt']);
  assert.ok(CRITERION_ROLES.every((r) => SCENE_ROLES.includes(r)), 'a criterion role is not scenery');
  assert.ok(!CRITERION_ROLES.some((r) => DRESSING_ROLES.includes(r)));
  for (const role of KIT_ROLES) assert.equal(isCriterionRole(role), CRITERION_ROLES.includes(role), role);

  // ⚠⚠ EACH PAIR IS TOLD APART BY EXACTLY ONE LEVER, and both are asserted because a table edit
  // that collapsed either one would draw two states identically with nothing failing.
  assert.notEqual(KIT_ROLE_SIZE.bud.units, KIT_ROLE_SIZE.bloom.units, 'a bud is the bloom, NARROWER');
  assert.equal(KIT_ROLE_SIZE.wilt.units, KIT_ROLE_SIZE.bloom.units, 'a failing criterion is not a smaller claim');
  assert.notEqual(KIT_ROLE_TILT.wilt, KIT_ROLE_TILT.bloom, 'a wilt is the bloom, NODDING');
  assert.equal(KIT_ROLE_TILT.bud, 0, 'a bud stands up — it is NOT YET, never WENT WRONG (ADR-0600 D3)');

  // Everything else on the map stands upright; the lean is the wilt's and nothing else's.
  for (const role of KIT_ROLES) {
    if (role !== 'wilt') assert.equal(KIT_ROLE_TILT[role], 0, `${role} leans`);
  }
  assert.ok(KIT_ROLE_TILT.wilt > 0 && KIT_ROLE_TILT.wilt < Math.PI / 2, 'a wilt nods; it does not lie down');
});

test('⚠⚠ THE BUD SITS INSIDE BOTH OF ITS BOUNDS — narrower than the bloom, wider than the ground cover', () => {
  // ⚠⚠ TWO DIFFERENT CONFUSIONS, AND EACH HAS ITS OWN BOUND BECAUSE THEY PULL OPPOSITE WAYS. Too
  // wide and "how many have opened" is unreadable; too narrow and a criterion nobody has signed is
  // indistinguishable from the scenery. Both are computed from the tables rather than restated, so
  // an edit to ANY of the four — the bud's width, the bloom's, the cover flower's, the cover's
  // scale spread — is what fails here.
  const bloom = KIT_ROLE_SIZE.bloom.units;
  const bud = KIT_ROLE_SIZE.bud.units;
  assert.ok(bud <= bloom * BUD_MAX_SHARE_OF_BLOOM, `a bud of ${bud} is not clearly narrower than a bloom of ${bloom}`);

  // The cover flower at the SHIPPED rung, which is also the boldest the ladder reaches — the same
  // arithmetic `FLOWER_PATCH_MAX_SHARE_OF_BLOOM` is derived through, read off the same tables.
  const boldestCoverFlower = KIT_ROLE_SIZE.flowerPatch.units * COVER_SCALE.flowerPatch.max * Math.max(...COVER_SIZE_RUNGS);
  assert.ok(
    bud >= boldestCoverFlower * BUD_MIN_MULTIPLE_OF_COVER_FLOWER,
    `a bud of ${bud} is not clearly wider than the widest cover flower of ${boldestCoverFlower.toFixed(3)}`,
  );

  // ⚠ AND THE BLOOM'S OWN HALF-WIDTH GUARANTEE IS UNTOUCHED. The bud is held to the weaker bound
  // above and is NOT held to this one — widening it to cover the bud would force the bud to the
  // bloom's own width and destroy the signal it exists to carry.
  assert.ok(boldestCoverFlower <= bloom * FLOWER_PATCH_MAX_SHARE_OF_BLOOM);
  assert.ok(
    boldestCoverFlower > bud * FLOWER_PATCH_MAX_SHARE_OF_BLOOM,
    'the bud now clears the half-width bound too, so this test no longer says anything — re-read ADR-0600',
  );

  // What separates a bud from a cover flower in the end is the ASSET, not the size: one is the
  // kit's red flower and the other its white one, and they can never be the same object.
  assert.notDeepEqual([...KIT_ROLE_ASSEMBLIES.bud], [...KIT_ROLE_ASSEMBLIES.flowerPatch]);
  assert.deepEqual([...KIT_ASSEMBLIES[KIT_ROLE_ASSEMBLIES.bud[0]!]], ['Red_Flower_01']);
  assert.deepEqual([...KIT_ASSEMBLIES[KIT_ROLE_ASSEMBLIES.flowerPatch[0]!]], ['White_Flower_01']);
});

test('⚠ THE CENSUS TELLS THE THREE CRITERION STATES APART — an island reports what it is waiting on', () => {
  // `dressingCensus` keys on the role, so the three states are three rows without any edit. That is
  // what makes "five criteria, one opened" READABLE off a dressed island rather than only visible
  // in the picture.
  const census = dressingCensus(dress(ALL_HEALTHY, { blooms: 1, buds: 4, wilts: 2 }));
  assert.equal(census['bloom'], 1);
  assert.equal(census['bud'], 4);
  assert.equal(census['wilt'], 2);
});
