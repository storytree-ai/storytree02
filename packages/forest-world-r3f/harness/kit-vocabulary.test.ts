import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

import { islandScene, islandCapabilities } from './island-fixture.js';
import { groundCellsFrom } from './island-descriptors.js';
import { LEAF_TINT_TOKEN } from './leaf-tint.js';
import { layoutCells } from './prop-layout.js';
import {
  KIT_ASSEMBLIES,
  KIT_FOOTPRINTS_2026_08_29,
  KIT_ROLES,
  KIT_ROLE_CLASS,
  KIT_ROLE_ASSEMBLIES,
  KIT_ROLE_SIGNAL,
  KIT_ROLE_SIZE,
  POCKETED_SIGNALS,
  VOCABULARY_STATES,
  capabilityFacts,
  clearsObjectFloor,
  dressIslandFromKit,
  dressingCensus,
  dressingOverlaps,
  kitObjectNames,
  stateForm,
} from './kit-vocabulary.js';
import type { KitPlacement, KitRole } from './kit-vocabulary.js';

const ASSET = fileURLToPath(new URL('./assets/dressing-kit.glb', import.meta.url));
const FOOT = KIT_FOOTPRINTS_2026_08_29;

/** The dressing every test below reads, at the frozen footprints. */
function dress(island: Parameters<typeof islandScene>[0] = {}, seed?: number): KitPlacement[] {
  const opts = { scene: islandScene(island), island: island ?? {}, relief: 0, footprint: FOOT };
  return dressIslandFromKit(seed === undefined ? opts : { ...opts, seed });
}

/**
 * The OBJECT names inside a `.glb`, read out of its JSON chunk. A glb is a 12-byte header and a
 * length-prefixed JSON chunk, so this needs no loader and no browser.
 *
 * ⚠ NODES, NOT MESHES, and the difference is not cosmetic. Blender exports a node per OBJECT and
 * names the mesh after the MESH DATA — so `Leafy_Bush_01` arrives as a node named for the object
 * and a mesh named `Plane.054`. `GLTFLoader` sets `Object3D.name` from the node, which is what
 * `kit-scene.ts` keys the vocabulary on, so reading meshes here would be checking the manifest
 * against a different set of names than the loader ever sees.
 */
function glbObjectNames(path: string): string[] {
  const buf = readFileSync(path);
  assert.equal(buf.toString('utf8', 0, 4), 'glTF', `${path} is not a glb`);
  const jsonLength = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString('utf8', 20, 20 + jsonLength)) as {
    nodes?: Array<{ name?: string; mesh?: number }>;
  };
  return (json.nodes ?? []).filter((n) => n.mesh !== undefined).map((n) => n.name ?? '').filter(Boolean);
}

// ------------------------------------------------------------------ the vocabulary itself

test('every role names a signal, and every signal is read off the SCENE', () => {
  // ADR-0463 D5: delegation picks WHICH signal a prop carries, never WHETHER it carries one.
  // A role whose entry did not say where its number comes from would be decoration wearing a
  // signal's name, which ADR-0414 D1 forbids on the surface this vocabulary is authored for.
  //
  // ⚠ AND EVERY ONE IS `SCENE` NOW. The previous vocabulary had two INPUT roles — signals the
  // system computes but this database-less fixture cannot reach, supplied to the dressing in one
  // named place. Both were withdrawn on 2026-08-29, so nothing on this island is demonstrated
  // rather than reported, and this assertion is what stops one creeping back.
  for (const role of KIT_ROLES) {
    const signal = KIT_ROLE_SIGNAL[role];
    assert.ok(signal.length > 20, `${role} has no signal`);
    // ⚠ TWO ADMISSIBLE ANSWERS SINCE 2026-09-03 AND STILL NO THIRD — the expected word is DERIVED
    // from `KIT_ROLE_CLASS`, so this stays a two-place agreement rather than a second literal.
    // `src/kit-vocabulary.test.ts` carries the same claim over the same table; this copy is what
    // the HARNESS fixture's own suite asks, and both must move together.
    assert.match(signal, new RegExp(`^${KIT_ROLE_CLASS[role].toUpperCase()} — `), `${role}'s class and its prose disagree`);
  }
});

test('the withdrawn signals are recorded rather than forgotten', () => {
  // "Pocketed, not deleted" is a decision (ADR-0475 D3), and a decision nobody can find is an
  // absence. Both entries name the signal that would bring the prop back.
  assert.deepEqual(Object.keys(POCKETED_SIGNALS).sort(), ['log', 'rock']);
  for (const [prop, signal] of Object.entries(POCKETED_SIGNALS)) {
    assert.ok(signal.length > 20, `${prop} was pocketed without saying what it carried`);
  }
  // And nothing pocketed may still be a role — that would be the withdrawal half-applied.
  for (const role of KIT_ROLES) assert.ok(!(role in POCKETED_SIGNALS), `${role} is both live and pocketed`);
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

test('THE ASSET CARRIES EVERY OBJECT THE VOCABULARY DECLARES', () => {
  // ⚠ The floor that stops a quietly emptier island. Every count and placement is per assembly
  // FOUND, so an asset that lost an object would draw fewer props and nothing else would say
  // so. The manifest is hand-authored upstream of the export, so this is a two-place mismatch.
  const inAsset = new Set(glbObjectNames(ASSET));
  const missing = kitObjectNames().filter((n) => !inAsset.has(n));
  assert.deepEqual(missing, [], `the committed kit is missing: ${missing.join(', ')}`);
});

test('the asset carries nothing the vocabulary does not use — a paid-for byte draws something', () => {
  // The payload scales with DISTINCT objects, not with how many are placed, so an object nobody
  // places is pure wire cost. This is the direction the manifest check above cannot see, and it
  // is what forced the 2026-08-29 re-export: withdrawing the rocks and logs from the vocabulary
  // without dropping them from the asset would have shipped 189 KB that draws nothing.
  const declared = new Set(kitObjectNames());
  const unused = glbObjectNames(ASSET).filter((n) => !declared.has(n));
  assert.deepEqual(unused, [], `the kit ships objects nothing places: ${unused.join(', ')}`);
});

// ------------------------------------------------------------------ what a state grows

test('the vocabulary covers all six states, and only unknown grows nothing', () => {
  assert.deepEqual(stateForm('healthy'), { role: 'tree', tint: null });
  assert.deepEqual(stateForm('mapped'), { role: 'tree', tint: 'mapped' });
  assert.deepEqual(stateForm('proposed'), { role: 'tree', tint: 'proposed' });
  assert.deepEqual(stateForm('building'), { role: 'tree', tint: 'building' });
  assert.deepEqual(stateForm('unhealthy'), { role: 'deadTree', tint: null });
  // ⚠ An island that drew a confident tree for a capability whose state is UNKNOWN would be the
  // art asserting a proof state the work does not hold — the one way this arc can do real harm
  // (ADR-0392 D5 / ADR-0398 D7).
  assert.equal(stateForm('unknown'), null);
  // Fail closed on anything the vocabulary has never heard of, for the same reason.
  assert.equal(stateForm('retired'), null);
  assert.equal(stateForm(''), null);
});

test('proposed and building are ONE token under two keys, exactly as ADR-0462 holds them', () => {
  // Five prop forms cover six states only because these two share. Two equal literals would
  // agree today and drift the first time somebody retuned one of them.
  assert.equal(LEAF_TINT_TOKEN.get('proposed'), LEAF_TINT_TOKEN.get('building'));
  assert.equal(stateForm('proposed')?.role, stateForm('building')?.role);
});

test('every tint a state asks for is a tint that is declared', () => {
  // The two-place check between the vocabulary and the tint table. A state whose form names a
  // tint nothing declares would throw at load — better here, without a GPU.
  for (const state of VOCABULARY_STATES) {
    const form = stateForm(state);
    if (!form?.tint) continue;
    assert.ok(LEAF_TINT_TOKEN.has(form.tint), `${state} asks for an undeclared tint`);
  }
  // And nothing is declared that no state can reach — an unreachable tint reads as coverage.
  for (const state of LEAF_TINT_TOKEN.keys()) {
    assert.equal(stateForm(state)?.tint, state, `the tint for ${state} is unreachable`);
  }
});

test('every role clears the object floor except the bloom, which is recorded as under it', () => {
  assert.equal(clearsObjectFloor('tree'), true);
  assert.equal(clearsObjectFloor('deadTree'), true);
  // A criterion marker is deliberately below the floor at the overview: the procedural flower
  // markers do not clear it either, and making one tree-sized so that it would is the art
  // asserting an importance the signal does not have.
  assert.equal(clearsObjectFloor('bloom'), false);
  assert.equal(KIT_ROLE_SIZE.bloom.axis, 'width');
});

// ------------------------------------------------------------------ the dressing

test("the facts come off the fixture's own capability list", () => {
  const facts = capabilityFacts({});
  assert.equal(facts.length, 11);
  assert.deepEqual(
    facts.map((f) => f.status),
    islandCapabilities({}).map((c) => String(c.status)),
    'the statuses drifted from the list the scene is built from',
  );
});

test('ONE object per capability, whatever its contract count', () => {
  // The whole of the owner's density answer, as an assertion: `CAP_TESTS` runs 14 down to 2 and
  // every parcel grows exactly one thing. The previous vocabulary grew one pine per contract,
  // so this is the test that would have failed then.
  const placements = dress();
  for (const fact of capabilityFacts({})) {
    const own = placements.filter((p) => p.capId === fact.capId);
    assert.equal(own.length, 1, `${fact.capId} grew ${own.length} objects`);
  }
});

test('a state reaches the island as a species and a leaf tint', () => {
  const island = {
    oddOnesOut: [
      { index: 0, status: 'unhealthy' as const },
      { index: 1, status: 'proposed' as const },
      { index: 2, status: 'mapped' as const },
      { index: 3, status: 'unknown' as const },
    ],
  };
  const placements = dress(island);
  const of = (capId: string): KitPlacement | undefined => placements.find((p) => p.capId === capId);

  assert.equal(of('cap-0')?.role, 'deadTree');
  assert.equal(of('cap-0')?.tint, null, 'a bare dead trunk was given leaves to tint');
  assert.equal(of('cap-1')?.role, 'tree');
  assert.equal(of('cap-1')?.tint, 'proposed');
  assert.equal(of('cap-2')?.tint, 'mapped');
  assert.equal(of('cap-3'), undefined, 'an unknown capability was dressed with something');
  // A healthy capability wears the kit's own needles — the arm the owner approved.
  assert.equal(of('cap-4')?.role, 'tree');
  assert.equal(of('cap-4')?.tint, null);
});

test('an unknown capability is left bare rather than dressed with something reassuring', () => {
  const island = { oddOneOut: { index: 2, status: 'unknown' as const } };
  assert.deepEqual(dress(island).filter((p) => p.capId === 'cap-2'), []);
});

test('one bloom per SIGNED criterion, and none at all when the criteria are suppressed', () => {
  assert.equal(dress().filter((p) => p.role === 'bloom').length, 10);

  const mixed = { criteriaStates: ['failing' as const, 'pending' as const] };
  assert.equal(dress(mixed).filter((p) => p.role === 'bloom').length, 8, 'an unsigned criterion bloomed');

  assert.equal(dress({ flowers: false }).filter((p) => p.role === 'bloom').length, 0);
});

test('A STORY THAT IS NOT PROVEN DOES NOT BLOOM — the fixture default follows the island', () => {
  // ⚠⚠ Measured on the 2026-08-29 crowd before this was fixed: all 35 islands drew ten blooms
  // each, INCLUDING the `unknown` one and the `unhealthy` one, because the fixture defaulted
  // every criterion to `proven` whatever the island was. That is the picture asserting the owner
  // signed ten criteria on a story nobody has checked — the one way this arc can do real harm
  // (ADR-0392 D5), arriving through the fixture rather than through the vocabulary. A story's
  // status IS its own signed UAT verdict (ADR-0033 d.4), so the two cannot disagree.
  assert.equal(dress({ status: 'healthy' }).filter((p) => p.role === 'bloom').length, 10);
  for (const status of ['unknown', 'unhealthy', 'proposed', 'building', 'mapped'] as const) {
    assert.equal(
      dress({ status }).filter((p) => p.role === 'bloom').length,
      0,
      `an ${status} story bloomed`,
    );
  }
  // And an explicit `criteriaStates` still overrides — the labelled deviation is unchanged.
  const forced = { status: 'unknown' as const, criteriaStates: ['proven' as const] };
  assert.equal(dress(forced).filter((p) => p.role === 'bloom').length, 1);
});

test('the dressing is deterministic — two builds of one island are identical', () => {
  // `Math.random` is forbidden on this surface (ADR-0380 D6 fence 2). Two islands that differed
  // in WHICH props were drawn would present that difference as the direction.
  assert.deepEqual(dress(), dress());
  assert.notDeepEqual(dress(), dress({}, 12), 'the seed does nothing, so the scatter is not seeded');
});

test('the census names each tinted arm separately', () => {
  const island = { oddOnesOut: [{ index: 0, status: 'mapped' as const }] };
  const census = dressingCensus(dress(island));
  assert.equal(census['tree:mapped'], 1);
  assert.equal(census['tree'], 10);
  assert.equal(census['bloom'], 10);
});

// ------------------------------------------------------------------ THE PLACEMENT

test('NO TWO PROPS OVERLAP on the dressed island', () => {
  // ⚠⚠ THE DEFECT THE OWNER REPORTED: "the rocks are appearing where the trees are". Measured on
  // this same island on 2026-08-29 before the fix, at these same footprints, 26 of the 2,926 prop
  // pairs overlapped — seven rock-on-tree, SIX TREE ON TREE — and the worst put a rock 8.57
  // ground units inside a pine. The cause was that the dressing scattered one ROLE at a time and
  // kept its minimum-gap rejection inside that one call, so no prop was ever tested against a
  // prop of another role.
  const island = {
    oddOnesOut: [
      { index: 4, status: 'unhealthy' as const },
      { index: 7, status: 'building' as const },
      { index: 9, status: 'unknown' as const },
    ],
  };
  const overlaps = dressingOverlaps(dress(island), FOOT);
  assert.deepEqual(
    overlaps,
    [],
    `props overlap: ${overlaps.map((o) => `${o.a}/${o.b} by ${(-o.gap).toFixed(2)}`).join(', ')}`,
  );
});

test('the whole-healthy island is clear too, and so is every single-state island', () => {
  // The mixed island is one arrangement. A state that put every capability in the same form
  // packs them differently, and the crowd draws exactly those.
  for (const status of ['healthy', 'mapped', 'proposed', 'building', 'unhealthy'] as const) {
    const overlaps = dressingOverlaps(dress({ status }), FOOT);
    assert.deepEqual(overlaps, [], `an all-${status} island overlaps ${overlaps.length} pairs`);
  }
});

test('THE OVERLAP DETECTOR CAN FIRE — it is not a check that passes on everything', () => {
  // ⚠ Without this the assertion above is satisfied by a detector that never returns anything,
  // which is the commonest fault class in this repo. Two trees at the same point must be found,
  // and two a hair further apart than their footprints must not.
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
  // A tree straddling a boundary belongs to neither capability, and the map's whole claim is
  // that a capability's state is read off ITS OWN ground.
  const placements = dress();
  const cells = layoutCells(groundCellsFrom(islandScene()));
  const byParcel = new Map<string, typeof cells>();
  for (const cell of cells) {
    if (!cell.parcel) continue;
    const list = byParcel.get(cell.parcel);
    if (list) list.push(cell);
    else byParcel.set(cell.parcel, [cell]);
  }

  const inQuad = (pts: readonly { x: number; z: number }[], p: { x: number; z: number }): boolean => {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i]!;
      const b = pts[j]!;
      if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) {
        inside = !inside;
      }
    }
    return inside;
  };

  for (const placement of placements) {
    if (placement.capId === 'story') continue;
    const parcelCells = byParcel.get(placement.capId) ?? [];
    assert.ok(
      parcelCells.some((cell) => inQuad(cell.points, placement.at)),
      `a ${placement.role} for ${placement.capId} stands outside its parcel`,
    );
  }
});

test('props ride the relief rather than floating over it', () => {
  const flat = dress();
  const hillyOpts = { scene: islandScene(), island: {}, relief: 6, footprint: FOOT };
  const hilly = dressIslandFromKit(hillyOpts);
  assert.equal(flat.length, hilly.length, 'the relief changed WHICH props are drawn');
  assert.ok(flat.every((p) => p.y === 0), 'a flat island lifted a prop off the ground');
  assert.ok(hilly.some((p) => p.y !== 0), 'the relief field did not reach the props at all');
  // The horizontal placement must not move with the relief, or the two arms of any
  // relief comparison would differ in two things at once.
  assert.deepEqual(
    flat.map((p) => [p.at.x, p.at.z]),
    hilly.map((p) => [p.at.x, p.at.z]),
  );
});

test('a wider footprint pushes the props apart rather than being ignored', () => {
  // The footprint is an ARGUMENT, so a placement that ignored it would look correct in every
  // test above — they all pass the same table. Widening it must move the arrangement.
  //
  // ⚠ DOUBLING NO LONGER DOES, under ADR-0593 D1 (land camera 20 -> 50 degrees) — re-measured, not
  // guessed, and it is a real property of the current geometry rather than a flake. `bestCandidate`
  // scores each of 96 fixed candidate points by its worst clearance against everything already
  // placed (`distance - (radius + occupant.radius)`), and picks the argmax; doubling every role's
  // footprint scales `radius` (and so `need`) uniformly, which shifts every candidate's score by
  // the same amount for a GIVEN occupant set and therefore does not always change the argmax. At
  // the retired 20-degree camera this fixture's cells were squashed enough that a 2x widening
  // reliably crossed that argmax somewhere in 21 placements (measured: 3-5 of them moved, swept
  // across 20/30/90 degrees for comparison). At the live 50-degree camera the true-ground cells are
  // far LESS squashed (ADR-0593 D2's whole trade), so there is more slack around each candidate's
  // optimum and 2x — even up to 3.5x — now lands on a genuine 0-diff coincidence for this seed and
  // fixture (swept 1.5x through 3.8x: 0 diffs until just past 3.8x, then 6-7 diffs from 4x on,
  // stable through 8x). So the widening here is 5x, chosen with margin past that measured
  // threshold rather than tuned to the minimum that happens to pass — the qualitative claim ("a
  // widened footprint moves the arrangement") is what is being proved, and 5x proves it robustly
  // rather than by coincidence the way 2x now would.
  const wide = Object.fromEntries(KIT_ROLES.map((r) => [r, FOOT[r] * 5])) as Record<KitRole, number>;
  const narrow = dress();
  const spread = dressIslandFromKit({
    scene: islandScene(),
    island: {},
    relief: 0,
    footprint: wide,
  });
  assert.notDeepEqual(
    narrow.map((p) => [p.at.x, p.at.z]),
    spread.map((p) => [p.at.x, p.at.z]),
    'the footprint reached no placement decision at all',
  );
});
