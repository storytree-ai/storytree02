// kit-mesh.test.ts — the bought kit's browser half, proved without a browser.
//
// ⚠⚠ WHY IT CAN BE PROVED HERE AT ALL. Everything downstream of the parse is arithmetic over
// geometry: which axis a role is scaled by, what footprint that leaves on the ground, which
// material a tinted crown wears, and how many meshes a dressing merges into. `three` and
// `mergeGeometries` both run headless; only IMAGE DECODING does not. So the loader's own texture
// half is proved by its REFUSAL (below) and by the delivered-pixel guard on a real GPU, and
// everything else is proved here — where `check:mutation-diff` can see it, which a test in
// `harness/` could not.
//
// ⚠ THE KIT IS SYNTHESISED, deliberately. A fixture built from the committed asset would make
// every assertion below a fact about one export rather than about the arithmetic, and the numbers
// would move the next time the kit is re-exported.

import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { decodeKitAsset } from './kit-asset.js';
import {
  KIT_TEXTURE_SLOTS,
  LEAF_MATERIALS,
  assembleParts,
  assertKitComplete,
  collectKitPrimitive,
  collectLeafMeans,
  decodedLeafMean,
  declaredObjectName,
  geometryTriangles,
  kitFromScene,
  kitMeshes,
  loadEmbeddedKit,
  materialTextures,
  newKitCollector,
  parseKit,
  placementExtent,
  placementScale,
  prepareKitMaterial,
  roleFootprints,
  roleHeights,
  textureGpuBytes,
  tintedMaterial,
} from './kit-mesh.js';
import type { KitAssemblyGeometry, KitObject, LoadedKit } from './kit-mesh.js';
import {
  KIT_ASSEMBLIES,
  KIT_ROLES,
  KIT_ROLE_ASSEMBLIES,
  KIT_ROLE_SIZE,
  KIT_ROLE_TILT,
  kitObjectNames,
} from './kit-vocabulary.js';
import type { KitAssembly, KitPlacement, KitRole } from './kit-vocabulary.js';
import { leafTintGainFor } from './leaf-tint.js';
import type { DecodedMap, TexelCanvas } from './map-texels.js';
import { RAW_COLOUR_SPACE } from './texture-convention.js';
import type { Rgb } from './texture-convention.js';

/** A box of a named size wearing a named material — enough for every measurement below. */
function part(name: string, materialName: string, w: number, h: number, d: number): KitObject {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.computeBoundingBox();
  const material = new THREE.MeshStandardMaterial({ name: materialName });
  material.name = materialName;
  return { name, geometry, material, materialName };
}

/**
 * An assembly RECENTRED THE WAY THE LOADER RECENTRES ONE — x and z on the joint centre, base at
 * y = 0.
 *
 * ⚠ THE RECENTRING IS PART OF THE FIXTURE'S FAITHFULNESS, not tidiness. `three`'s box geometry
 * straddles the origin, so an un-recentred fixture would sink every prop half its own height into
 * the land and the assertions below would be written around that — quietly encoding a bug as the
 * expected behaviour. The loader does exactly this translate for the whole assembly at once,
 * because recentring each object on its own base drops a pine's crown 18% of its height into the
 * trunk.
 */
function assembly(w: number, h: number, d: number, materialName = 'Pine_Branches'): KitAssemblyGeometry {
  const objects = [
    part('Trunk', 'Pine_Trunks', w * 0.3, h, d * 0.3),
    part('Leaves', materialName, w, h * 0.8, d),
  ];
  for (const o of objects) {
    o.geometry.translate(0, h / 2, 0);
    o.geometry.computeBoundingBox();
  }
  return { objects, names: ['Trunk', 'Leaves'], height: h, width: Math.max(w, d) };
}

/** A kit whose assemblies have DIFFERENT proportions, so a scale read off the wrong one shows. */
function kitFixture(): LoadedKit {
  const assemblies = new Map<KitAssembly, KitAssemblyGeometry>([
    ['pine-a', assembly(3, 12, 3)],
    // ⚠ WIDER AND SHORTER than pine-a, so `roleFootprints`' "widest arm wins" is a real choice
    // rather than a tie: at the tree role's 18 units of height this one is the wider of the two.
    ['pine-b', assembly(5, 10, 4)],
    ['pine-dead', assembly(2, 9, 2, 'Pine_Trunks')],
    ['flower', assembly(1.5, 2, 1.5)],
    // ⚠ THE GROUND-COVER ARMS ARE DELIBERATELY UNEQUAL IN PROPORTION, not merely in size. Every
    // arm of a WIDTH-sized role scales to the SAME width, so the footprint is a tie by
    // construction and only the HEIGHT can tell the arms apart — a fixture whose bushes were
    // similar shapes would let `roleHeights`' "tallest arm wins" pass on a tie.
    ['plant-a', assembly(2, 1, 2)],
    ['plant-b', assembly(1.5, 1.2, 1.5)],
    ['tuft-a', assembly(1.2, 1, 1.2)],
    ['tuft-b', assembly(1, 1.1, 1)],
    ['tuft-c', assembly(1.4, 0.8, 1.4)],
    ['flower-white', assembly(1.2, 0.8, 1.2)],
  ]);
  return {
    assemblies,
    materials: ['Pine_Branches', 'Pine_Trunks'],
    leafMeans: new Map([['Pine_Branches', { r: 70, g: 90, b: 69 }]]),
    triangles: 0,
    wireBytes: 0,
    textures: [],
    gpuBytes: 0,
  };
}

const KIT = kitFixture();

function placement(over: Partial<KitPlacement> = {}): KitPlacement {
  return {
    role: 'tree',
    assembly: 'pine-a',
    capId: 'cap-0',
    tint: null,
    at: { x: 0, z: 0 },
    y: 0,
    yaw: 0,
    scale: 1,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// scale and footprint
// ---------------------------------------------------------------------------

test('a role is scaled by the axis it DECLARES, not always by its height', () => {
  // ⚠ Scaling a wide flat prop by its height multiplies its footprint by the same factor, so the
  // bloom is sized by WIDTH. A `placementScale` that always read height would put a marker on the
  // island several times the size the vocabulary asked for, and every overlap check would pass —
  // they all use the declared footprint, not the delivered one.
  assert.equal(KIT_ROLE_SIZE.tree.axis, 'height');
  assert.equal(placementScale(KIT, placement()), KIT_ROLE_SIZE.tree.units / 12);

  assert.equal(KIT_ROLE_SIZE.bloom.axis, 'width');
  const bloom = placement({ role: 'bloom', assembly: 'flower' });
  assert.equal(placementScale(KIT, bloom), KIT_ROLE_SIZE.bloom.units / 1.5);
});

test('the delivered extent is the assembly’s own proportions at that scale', () => {
  const extent = placementExtent(KIT, placement());
  const scale = KIT_ROLE_SIZE.tree.units / 12;
  assert.equal(extent.height, 12 * scale);
  assert.equal(extent.width, 3 * scale);
  // A height-sized role delivers exactly the height it asked for; its width falls out.
  assert.equal(extent.height, KIT_ROLE_SIZE.tree.units);
  assert.notEqual(extent.width, KIT_ROLE_SIZE.tree.units, 'the fixture is square, so it proves nothing');
});

test('a role’s footprint is its WIDEST arm, so the clearance is enough for either', () => {
  // ⚠ A role whose footprint came off the FIRST arm would leave the other one overlapping its
  // neighbours — and only on the islands where the alternation happened to land it there, which
  // is the kind of defect that looks like bad luck.
  const foot = roleFootprints(KIT);
  const arms = KIT_ROLE_ASSEMBLIES.tree.map((name) => {
    const a = KIT.assemblies.get(name)!;
    return (a.width * KIT_ROLE_SIZE.tree.units) / a.height;
  });
  assert.equal(foot.tree, Math.max(...arms));
  assert.ok(Math.max(...arms) > Math.min(...arms), 'the two arms are the same width — no choice made');
  // Every role gets one, and a bloom's is its declared width exactly (it is sized by width).
  for (const role of KIT_ROLES) assert.ok(foot[role] > 0, `${role} has no footprint`);
  assert.ok(Math.abs(foot.bloom - KIT_ROLE_SIZE.bloom.units) < 1e-9);
});

test('a missing assembly is refused rather than skipped', () => {
  // Every count and placement is per assembly FOUND, so an asset that lost one would draw a
  // quietly emptier island. The refusals name the assembly.
  const thin = { ...KIT, assemblies: new Map(KIT.assemblies) };
  thin.assemblies.delete('pine-b');
  assert.throws(() => roleFootprints(thin), /pine-b/);
  assert.throws(() => placementScale(thin, placement({ assembly: 'pine-b' })), /pine-b/);
});

test('an assembly with no extent on its sizing axis is refused, not divided by zero', () => {
  // A zero there produces `Infinity` and a prop that is silently absent from the frame rather
  // than an error anyone sees.
  const flat = { ...KIT, assemblies: new Map(KIT.assemblies) };
  flat.assemblies.set('pine-a', { ...assembly(3, 12, 3), height: 0 });
  assert.throws(() => placementScale(flat, placement()), /height/);
  assert.throws(() => roleFootprints(flat), /height/);
});

// ---------------------------------------------------------------------------
// the tint
// ---------------------------------------------------------------------------

test('an untinted placement wears the kit’s OWN material, not a clone of it', () => {
  // ⚠ Identity, not equality. A clone per placement would trade the merge this module exists to
  // do for one draw call per tree on a renderer measured draw-call bound.
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const leaves = KIT.assemblies.get('pine-a')!.objects[1]!;
  assert.equal(tintedMaterial(KIT, leaves.material, leaves.materialName, null, cache), leaves.material);
  assert.equal(cache.size, 0, 'an untinted placement filled the tint cache');
});

test('only LEAF materials are tinted — a dead trunk’s branches keep the kit’s own colour', () => {
  // ⚠⚠ THE TRAP THIS CLOSES. The kit gives the dead pine BOTH `Pine_Trunks` and `Pine_Branches`:
  // its dead branches wear the same material as a live crown's needles. Tinting by MATERIAL alone
  // would paint a dead tree's branches yellow for a state it does not hold. The tint is a property
  // of the PLACEMENT and this set only says which of its parts the tint reaches.
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const trunk = KIT.assemblies.get('pine-a')!.objects[0]!;
  assert.equal(LEAF_MATERIALS.has('Pine_Trunks'), false);
  assert.equal(tintedMaterial(KIT, trunk.material, 'Pine_Trunks', 'proposed', cache), trunk.material);
});

test('a tinted crown wears the gain the arithmetic asks for, and ONE clone per (material, tint)', () => {
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const leaves = KIT.assemblies.get('pine-a')!.objects[1]!;
  const first = tintedMaterial(KIT, leaves.material, 'Pine_Branches', 'proposed', cache);
  const again = tintedMaterial(KIT, leaves.material, 'Pine_Branches', 'proposed', cache);
  assert.notEqual(first, leaves.material, 'the tint mutated the kit’s own material');
  assert.equal(first, again, 'a second placement of the same tint made a second clone');
  assert.equal(cache.size, 1);

  const gain = leafTintGainFor('proposed', KIT.leafMeans.get('Pine_Branches')!)!;
  assert.ok(Math.abs(first.color.r - gain.r) < 1e-9);
  assert.ok(Math.abs(first.color.g - gain.g) < 1e-9);
  assert.ok(Math.abs(first.color.b - gain.b) < 1e-9);

  // A DIFFERENT tint is a different clone — one bucket per tint, which is what stops a yellow
  // crown and a brown one being merged into whichever arrived first.
  const mapped = tintedMaterial(KIT, leaves.material, 'Pine_Branches', 'mapped', cache);
  assert.notEqual(mapped, first);
  assert.equal(cache.size, 2);
});

test('a state with no declared tint is refused rather than drawn untinted', () => {
  // A placement asking for a tint the vocabulary does not name is asking the crown to carry a
  // state nothing declares. Falling back to the kit's green would report it as proven.
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const leaves = KIT.assemblies.get('pine-a')!.objects[1]!;
  assert.throws(
    () => tintedMaterial(KIT, leaves.material, 'Pine_Branches', 'healthy', cache),
    (e: Error) => {
      assert.match(e.message, /the state healthy has no declared leaf tint/);
      // The half that says what the refusal is protecting: a crown carrying a state nothing names.
      assert.match(e.message, /asking the crown to carry a state the vocabulary does not name/);
      return true;
    },
  );
});

test('a tinted clone is marked for re-upload — three compiles a program per material', () => {
  // Without `needsUpdate` the clone can render with the program the base material already compiled,
  // which is the untinted one: a yellow crown drawn green, with nothing anywhere saying so.
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const leaves = KIT.assemblies.get('pine-a')!.objects[1]!;
  const tinted = tintedMaterial(KIT, leaves.material, 'Pine_Branches', 'proposed', cache);
  // ⚠ `needsUpdate` is a write-only setter that bumps `version`; reading it back answers undefined.
  assert.ok(tinted.version > 0, 'the tinted clone was never marked for re-upload');
  assert.equal(leaves.material.version, 0, 'the kit’s own material was marked instead');
});

test('a leaf material with no recorded mean is refused — a tint has nothing to rotate', () => {
  const blind = { ...KIT, leafMeans: new Map() };
  const cache = new Map<string, THREE.MeshStandardMaterial>();
  const leaves = KIT.assemblies.get('pine-a')!.objects[1]!;
  assert.throws(
    () => tintedMaterial(blind, leaves.material, 'Pine_Branches', 'proposed', cache),
    /no base-colour mean/,
  );
});

// ---------------------------------------------------------------------------
// the merge
// ---------------------------------------------------------------------------

test('a dressing merges to ONE mesh per (material, tint), however many props there are', () => {
  // `hardware-floor.mjs` measured this renderer draw-call bound, so the merge is the whole reason
  // a bought island costs less than the procedural one it replaces.
  const many = Array.from({ length: 12 }, (_, i) =>
    placement({ capId: `cap-${i}`, at: { x: i * 20, z: 0 } }),
  );
  const meshes = kitMeshes(KIT, many);
  assert.equal(meshes.length, 2, `12 untinted pines merged into ${meshes.length} meshes`);

  // ⚠⚠ AND ALL TWELVE ARE IN THERE. "Two meshes" is also what a merge that kept only the LAST prop
  // per bucket produces — an island with one tree on it, drawn with no error anywhere. The vertex
  // count is what tells the two apart.
  const one = kitMeshes(KIT, [placement()]);
  for (const [i, m] of meshes.entries()) {
    assert.equal(
      m.geometry.getAttribute('position').count,
      one[i]!.geometry.getAttribute('position').count * 12,
      'the merged mesh does not carry all twelve props',
    );
    // ⚠ AND IT IS ONE DRAW CALL, NOT TWELVE. `mergeGeometries(parts, true)` produces a group per
    // source, and three issues a draw call per group — the same picture at the cost the merge
    // exists to avoid, on a renderer measured draw-call bound.
    assert.equal(m.geometry.groups.length, 0, 'the merge kept a group per prop');
  }
});

test('the merged SOURCES are disposed — a re-mounted island strands no buffer per prop', () => {
  // ⚠ `mergeGeometries` COPIES its inputs, so the clones this makes are garbage the moment it
  // returns. The canvas re-mounts per navigation; a dressing that left them behind would strand one
  // buffer per prop per visit.
  const disposed: THREE.BufferGeometry[] = [];
  const real = THREE.BufferGeometry.prototype.dispose;
  THREE.BufferGeometry.prototype.dispose = function patched(this: THREE.BufferGeometry): void {
    disposed.push(this);
    real.call(this);
  };
  try {
    const meshes = kitMeshes(KIT, [placement(), placement({ capId: 'b', at: { x: 60, z: 0 } })]);
    // Two placements of a two-part assembly: four source clones, none of them a returned mesh.
    assert.equal(disposed.length, 4);
    for (const m of meshes) assert.ok(!disposed.includes(m.geometry), 'a delivered mesh was disposed');
  } finally {
    THREE.BufferGeometry.prototype.dispose = real;
  }
});

test('geometries that cannot merge are REFUSED, not drawn one draw call per prop', () => {
  // ⚠⚠ `mergeGeometries` answers `null` when its inputs disagree about their attribute set — it
  // does not throw. Pushing on would leave the dressing to be drawn some other way, or silently
  // absent; either way the merge this module exists for did not happen and nothing said so.
  const odd = { ...KIT, assemblies: new Map(KIT.assemblies) };
  const mismatched = assembly(3, 12, 3);
  // Both parts wear ONE material name, so they land in one bucket — and one of them carries an
  // attribute the other does not.
  mismatched.objects[0]!.materialName = 'Pine_Trunks';
  mismatched.objects[1]!.materialName = 'Pine_Trunks';
  const count = mismatched.objects[1]!.geometry.getAttribute('position').count;
  mismatched.objects[1]!.geometry.setAttribute(
    'uv2',
    new THREE.BufferAttribute(new Float32Array(count * 2), 2),
  );
  odd.assemblies.set('pine-a', mismatched);

  assert.throws(() => kitMeshes(odd, [placement()]), (e: Error) => {
    assert.match(e.message, /could not merge the 2 geometries wearing Pine_Trunks/);
    assert.match(e.message, /they do not share an attribute set/);
    assert.match(e.message, /one draw call per prop on a draw-call-bound renderer/);
    return true;
  });
});

test('⚠ the TINT is part of the merge key — two states never share one mesh', () => {
  // ⚠⚠ A merged mesh wears ONE material. Merging a yellow-crowned tree with a green one by
  // material alone would paint both whichever arrived first: an island reporting a state that
  // half its capabilities do not hold, drawn with no error anywhere.
  const mixed = [
    placement({ capId: 'a' }),
    placement({ capId: 'b', tint: 'proposed', at: { x: 40, z: 0 } }),
    placement({ capId: 'c', tint: 'mapped', at: { x: 80, z: 0 } }),
  ];
  const meshes = kitMeshes(KIT, mixed);
  // trunks (one bucket) + three distinct leaf buckets: untinted, proposed, mapped.
  assert.equal(meshes.length, 4);
  const colours = meshes.map((m) => (m.material as THREE.MeshStandardMaterial).color.getHex());
  assert.equal(new Set(colours).size, 3, 'two tints delivered the same colour');
});

test('the placement’s transform reaches the merged vertices, and the kit is not mutated', () => {
  const before = KIT.assemblies.get('pine-a')!.objects[0]!.geometry.getAttribute('position').array[0];
  const far = kitMeshes(KIT, [placement({ at: { x: 500, z: -300 }, y: 7 })]);
  const box = new THREE.Box3().setFromBufferAttribute(
    far[0]!.geometry.getAttribute('position') as THREE.BufferAttribute,
  );
  assert.ok(box.min.x > 400 && box.max.x < 600, `merged geometry sits at x ${box.min.x}..${box.max.x}`);
  assert.ok(box.min.z > -400 && box.max.z < -200);
  assert.ok(box.min.y >= 7 - 1e-6, 'the placement’s ground height did not reach the vertices');
  assert.equal(
    KIT.assemblies.get('pine-a')!.objects[0]!.geometry.getAttribute('position').array[0],
    before,
    'building a dressing mutated the kit itself',
  );
});

test('yaw really rotates — two placements differing only in yaw are different geometry', () => {
  const a = kitMeshes(KIT, [placement({ yaw: 0 })])[0]!;
  const b = kitMeshes(KIT, [placement({ yaw: Math.PI / 4 })])[0]!;
  const boxOf = (m: THREE.Mesh): THREE.Box3 =>
    new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position') as THREE.BufferAttribute);
  assert.ok(Math.abs(boxOf(a).max.x - boxOf(b).max.x) > 1e-6, 'the yaw reached no vertex');
});

test('⚠⚠ A WILT REALLY NODS — the role\'s tilt reaches the vertices, and only the wilt\'s does', () => {
  // ⚠⚠ THE ONE LEVER THAT TELLS A FAILING CRITERION FROM A SIGNED ONE (ADR-0600). The kit has one
  // flower mesh on a material shared with the ground cover, so neither colour nor shape is
  // available; if the tilt did not reach the geometry the two would be drawn IDENTICALLY, and the
  // map would report a criterion that failed as one the owner had signed. Nothing in a frame says
  // otherwise, so it is asked of the vertices.
  const boxOf = (m: THREE.Mesh): THREE.Box3 =>
    new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position') as THREE.BufferAttribute);
  const upright = boxOf(kitMeshes(KIT, [placement({ role: 'bloom', assembly: 'flower' })])[0]!);
  const nodding = boxOf(kitMeshes(KIT, [placement({ role: 'wilt', assembly: 'flower' })])[0]!);

  // Same object at the same declared width, so a difference can only be the attitude.
  assert.equal(KIT_ROLE_SIZE.wilt.units, KIT_ROLE_SIZE.bloom.units);
  assert.equal(KIT_ROLE_TILT.wilt > 0, true);
  assert.ok(
    nodding.max.y < upright.max.y - 1e-6,
    `a nodding flower reaches ${nodding.max.y} and an upright one ${upright.max.y} — the tilt reached no vertex`,
  );

  // ⚠ AND THE BUD DOES NOT NOD. D3: an unsigned criterion is NOT YET, never WENT WRONG, so the one
  // form that must not borrow the failing vocabulary is asserted not to.
  const bud = boxOf(kitMeshes(KIT, [placement({ role: 'bud', assembly: 'flower' })])[0]!);
  const scale = KIT_ROLE_SIZE.bud.units / KIT_ROLE_SIZE.bloom.units;
  assert.ok(
    Math.abs(bud.max.y - upright.max.y * scale) < 1e-6,
    'the bud is leaning — it must be the bloom scaled and nothing else',
  );
  // ...and it IS narrower, which is the lever it uses instead.
  assert.ok(bud.max.x < upright.max.x - 1e-6, 'the bud is not narrower than the bloom');
});

test('an empty dressing is no meshes, not one empty one', () => {
  assert.deepEqual(kitMeshes(KIT, []), []);
});

test('a placement naming an assembly the kit does not hold is refused, in its OWN words', () => {
  // ⚠ `placementScale` refuses the same missing assembly one line later. Two identical messages
  // are two floors no test can tell apart, which reads as one redundant guard rather than as the
  // independent pair they are.
  const thin = { ...KIT, assemblies: new Map(KIT.assemblies) };
  thin.assemblies.delete('pine-a');
  assert.throws(() => kitMeshes(thin, [placement()]), /this dressing names the assembly pine-a/);
});

// ---------------------------------------------------------------------------
// the loader's own floors
// ---------------------------------------------------------------------------

test('the loader refuses a kit whose leaf material carries no base-colour map', async () => {
  // ⚠ THIS IS THE HEADLESS CASE AND IT IS WORTH ASSERTING RATHER THAN SKIPPING. `three` parses
  // the glb's GEOMETRY here perfectly well; what node cannot do is DECODE its images. So this run
  // reaches exactly the state a real browser would reach if the kit were re-exported without its
  // foliage texture — and the loader must refuse it, because the alternative is a crown silently
  // wearing its state token as a flat colour instead of the asset it was bought for. The message
  // names the material, so the failure says what to fix.
  //
  // The parse's texture half is proved on a real GPU by the delivered-pixel colour guard; this is
  // the half that can be proved without one, and it is the fail-closed half.
  await assert.rejects(
    parseKit(decodeKitAsset(), 'the embedded kit'),
    /in the embedded kit the leaf material Pine_Branches carries no base-colour/,
  );
});

test('the shipped loader reads the EMBEDDED bytes, and says which asset it read', async () => {
  // ⚠ THE SHIPPED PATH HAS NO URL TO FETCH — the web sync carries `.ts` and `.tsx` only, so a
  // module reaching for `/assets/dressing-kit.glb` works in the harness and 404s in the public
  // engine copy. The refusal naming `src/kit-asset.ts` is what says WHICH of the two loaders ran.
  await assert.rejects(loadEmbeddedKit(), /in the embedded kit \(src\/kit-asset\.ts\)/);
});

test('the loader names its source in a refusal', async () => {
  // A refusal that did not say WHICH asset failed is unactionable once there is more than one.
  await assert.rejects(parseKit(decodeKitAsset(), 'a-named-source'), (e: Error) => {
    assert.match(e.message, /Pine_Branches/);
    return true;
  });
});

// ---------------------------------------------------------------------------
// the load, split so a node test can reach it
// ---------------------------------------------------------------------------
//
// ⚠⚠ WHY THESE ARE SEPARATE FUNCTIONS AT ALL. `parseKit` needs a browser only to DECODE an image;
// walking the scene graph, resolving which declared object a primitive belongs to, recentring an
// assembly on its joint footprint, the manifest floor and the GPU-byte arithmetic are none of them
// browser-bound. Left inside the load they were 101 mutants nothing could reach and
// `check:mutation-diff` said so — the same finding that pulled `texelMeans` out of the canvas read
// in `map-texels.ts`. The remedy is not a better browser fixture: the subject was never the browser.

/** A material carrying named texture slots of a given size — enough to measure a kit's payload. */
function texturedMaterial(
  name: string,
  slots: Partial<Record<(typeof KIT_TEXTURE_SLOTS)[number], { width: number; height: number } | null>>,
): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ name });
  material.name = name;
  for (const [slot, size] of Object.entries(slots)) {
    const texture = new THREE.Texture();
    if (size) texture.image = size;
    material[slot as 'map'] = texture;
  }
  return material;
}

test('a kit material is put into alpha TEST, double sided, and the raw colour convention', () => {
  // ⚠ `alphaTest` and `transparent` are mutually exclusive in three: leaving `transparent` on
  // keeps a stand of cut-out leaf cards in the sorted transparent pass, which is the classic
  // sorting failure this correction exists for.
  const foliage = texturedMaterial('Pine_Branches', { map: { width: 4, height: 4 } });
  foliage.transparent = true;
  foliage.depthWrite = false;
  // ⚠ THE MAP STARTS IN THE WRONG SPACE ON PURPOSE. `three` gives a bare texture
  // `NoColorSpace`, which is what the raw convention wants — so a fixture that never set it would
  // pass whether or not the convention ran at all. A bought base-colour map arrives sRGB-tagged,
  // and decoded that way it renders about 3.5x dark on a surface that is not colour-managed.
  foliage.map!.colorSpace = THREE.SRGBColorSpace;
  prepareKitMaterial(foliage);
  assert.equal(foliage.transparent, false);
  assert.equal(foliage.alphaTest, 0.5);
  assert.equal(foliage.depthWrite, true);
  assert.equal(foliage.side, THREE.DoubleSide);
  // The base-colour map is moved into this surface's raw convention — the reason a bought texture
  // does not render ~3.5x dark on a renderer that is not colour-managed.
  assert.equal(foliage.map!.colorSpace, RAW_COLOUR_SPACE);
  assert.notEqual(THREE.SRGBColorSpace, RAW_COLOUR_SPACE, 'the fixture started in the target space');
  // ⚠ `needsUpdate` IS A WRITE-ONLY SETTER in three — it bumps `version`, and reading it back
  // answers `undefined`. The version is the observable, and a re-tag without it leaves the GPU
  // holding the texture it already decoded in the space this convention just moved it out of.
  assert.ok(foliage.map!.version > 0, 'the texture was re-tagged without being re-uploaded');

  // ⚠ AND AN OPAQUE MATERIAL IS LEFT ALONE ON THAT AXIS. Setting an alpha test on solid trunk bark
  // would punch holes in it wherever the map's alpha happened to be low.
  const bark = texturedMaterial('Pine_Trunks', { map: { width: 4, height: 4 } });
  bark.transparent = false;
  prepareKitMaterial(bark);
  assert.equal(bark.alphaTest, 0);
  assert.equal(bark.side, THREE.DoubleSide, 'the side is set for every material, not only cut-outs');
});

test('a material’s textures are recorded per SLOT, and a slot that never decoded is skipped', () => {
  const material = texturedMaterial('Pine_Branches', {
    map: { width: 1024, height: 512 },
    normalMap: { width: 256, height: 256 },
    // An undecoded slot: three carries the texture, its image is not there.
    roughnessMap: null,
  });
  const records = materialTextures(material);
  assert.deepEqual(
    records.map(([, r]) => r),
    [
      { name: 'map:Pine_Branches', width: 1024, height: 512 },
      { name: 'normalMap:Pine_Branches', width: 256, height: 256 },
    ],
  );
  // ⚠ KEYED ON THE TEXTURE'S OWN UUID, not on the slot. Two slots sharing one image are one
  // texture on the GPU, and counting it twice would over-report the payload by its own size.
  assert.deepEqual(
    records.map(([uuid]) => uuid),
    [material.map!.uuid, material.normalMap!.uuid],
  );
  assert.equal(materialTextures(new THREE.MeshStandardMaterial()).length, 0);
});

test('a decoded image with no dimensions is recorded as zero rather than as NaN', () => {
  // `undefined * 4` is NaN, and a NaN in the payload total makes every reported byte count NaN —
  // a number that says nothing, printed where a reader expects a size.
  const material = texturedMaterial('Pine_Trunks', {});
  const texture = new THREE.Texture();
  texture.image = {};
  material.map = texture;
  assert.deepEqual(materialTextures(material)[0]![1], {
    name: 'map:Pine_Trunks',
    width: 0,
    height: 0,
  });
});

test('triangles are counted off the INDEX when there is one, and off positions when there is not', () => {
  // ⚠ An indexed geometry's position count is its VERTEX count, which is smaller than three per
  // triangle wherever vertices are shared — reading it instead would under-report a merged
  // island's triangles by whatever the export happened to weld.
  const indexed = new THREE.BoxGeometry(1, 1, 1);
  assert.ok(indexed.getIndex(), 'the fixture geometry is not indexed — it proves nothing');
  assert.equal(geometryTriangles(indexed), indexed.getIndex()!.count / 3);
  assert.equal(geometryTriangles(indexed), 12);

  const soup = indexed.toNonIndexed();
  assert.equal(soup.getIndex(), null);
  assert.equal(geometryTriangles(soup), 12);
  assert.notEqual(indexed.getAttribute('position').count, soup.getAttribute('position').count);
});

test('a primitive resolves to the DECLARED object it belongs to — own name, parent, then stripped', () => {
  // ⚠⚠ THE TRAP. A kit object wearing two materials is exported as ONE node with TWO primitives,
  // which `GLTFLoader` turns into a Group whose children are `<object>_0`, `<object>_1`. Keying on
  // the mesh's own name loses the object entirely — a quietly incomplete island.
  const declared = new Set(['Pine_Trunk_01', 'Pine_Leaves_01']);
  // Inference, not an annotation — `anti-slop/no-known-value-widening`.
  const under = (name: string) => ({ name });
  assert.equal(declaredObjectName('Pine_Trunk_01', under('Scene'), declared), 'Pine_Trunk_01');
  assert.equal(declaredObjectName('Pine_Trunk_01_0', under('Pine_Trunk_01'), declared), 'Pine_Trunk_01');
  // ⚠⚠ AND THE PARENT CLAUSE HAS TO DO REAL WORK, so the primitive's own name must NOT strip down
  // to its parent's. Blender names a multi-material node's children after the MESH DATA, not after
  // the object — `Plane.054_0` under `Pine_Leaves_01` — and stripping that gives a name the
  // manifest has never heard of, which is a kit object silently absent from every island.
  assert.equal(declaredObjectName('Plane054_0', under('Pine_Leaves_01'), declared), 'Pine_Leaves_01');
  // Its OWN name wins over the parent's, so a declared child of a declared group stays itself.
  assert.equal(declaredObjectName('Pine_Leaves_01', under('Pine_Trunk_01'), declared), 'Pine_Leaves_01');
  // ⚠ NO PARENT AT ALL is the case a placeholder string used to stand in for — and four of the
  // kit's six objects are scene-root nodes, so it is the ordinary case rather than a defensive one.
  assert.equal(declaredObjectName('Plane054_0', null, declared), 'Plane054');
  assert.equal(declaredObjectName('Pine_Leaves_01', null, declared), 'Pine_Leaves_01');
  // Neither declared: strip a TRAILING `_<digits>` and nothing else.
  assert.equal(declaredObjectName('Rock_07_1', under('Scene'), declared), 'Rock_07');
  assert.equal(declaredObjectName('Leaves_v2_final', null, declared), 'Leaves_v2_final');
  // ⚠⚠ THE DECLARED SET IS WHAT PROTECTS A NAME THAT ENDS IN DIGITS, AND NOTHING ELSE.
  // `Pine_Trunk_No_Leaves_01` is a real kit object whose tail is indistinguishable from a
  // primitive index — so the two clauses above are load-bearing rather than a convenience: asked
  // about it undeclared, the strip runs and answers a name the kit does not contain.
  const dead = 'Pine_Trunk_No_Leaves_01';
  assert.equal(declaredObjectName(dead, null, new Set([dead])), dead);
  assert.equal(declaredObjectName(dead, null, declared), 'Pine_Trunk_No_Leaves');
  // Only the tail, and only digits: an index in the MIDDLE of a name is left alone.
  assert.equal(declaredObjectName('Pine_01_Trunk', null, declared), 'Pine_01_Trunk');
  assert.equal(declaredObjectName('Trunk_0a', null, declared), 'Trunk_0a');
});

/** A scene node: a mesh of the given size, at the given offset, wearing the given material. */
function node(
  name: string,
  material: THREE.Material,
  size: readonly [number, number, number] = [2, 2, 2],
  at: readonly [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.name = name;
  mesh.position.set(...at);
  return mesh;
}

test('the scene pass reads only textured MESHES, and bakes each one through its world matrix', () => {
  const declared = new Set(['Pine_Trunk_01']);
  const found = newKitCollector();

  const group = new THREE.Group();
  group.name = 'Pine_Trunk_01';
  group.position.set(100, 0, -50);
  // ⚠ NAMED AFTER ITS MESH DATA, NOT AFTER THE OBJECT — which is what Blender exports. A child
  // called `Pine_Trunk_01_0` would strip down to its parent's name anyway, so it could not tell
  // the parent clause from the fallback.
  const primitive = node('Plane054_0', texturedMaterial('Pine_Trunks', {}), [2, 6, 2]);
  group.add(primitive);
  group.updateMatrixWorld(true);
  group.traverse((o) => collectKitPrimitive(o, declared, found));

  // ⚠ THE GROUP ITSELF IS NOT A MESH and contributes nothing; its child does, under the group's
  // NAME, at the group's position.
  assert.deepEqual([...found.objects.keys()], ['Pine_Trunk_01']);
  assert.equal(found.objects.get('Pine_Trunk_01')!.length, 1);
  assert.equal(found.triangles, 12);
  assert.deepEqual([...found.materials], ['Pine_Trunks']);
  // ⚠ THE MATERIAL IS PUT INTO THIS SURFACE'S CONVENTION ON THE WAY IN. A kit read without that
  // step draws a stand of cut-out leaf cards in the sorted transparent pass and its base-colour
  // maps about 3.5x dark — both of which look like art direction rather than a missing call.
  assert.equal((primitive.material as THREE.MeshStandardMaterial).side, THREE.DoubleSide);
  const box = found.objects.get('Pine_Trunk_01')![0]!.geometry.boundingBox!;
  assert.ok(Math.abs(box.min.x - 99) < 1e-9, `the node transform did not reach the vertices: ${box.min.x}`);
  assert.ok(Math.abs(box.max.z - -49) < 1e-9);

  // A mesh wearing something that is not a standard material is stepped over — the kit's own
  // objects all wear one, and anything else in the file is not part of the vocabulary.
  const odd = node('Pine_Trunk_01', new THREE.MeshBasicMaterial());
  collectKitPrimitive(odd, declared, found);
  assert.equal(found.objects.get('Pine_Trunk_01')!.length, 1, 'a non-standard material was read in');
  assert.equal(found.triangles, 12);

  // ⚠⚠ AND SOMETHING THAT IS NOT A MESH AT ALL BUT DOES CARRY GEOMETRY AND A STANDARD MATERIAL.
  // glTF has POINTS and LINES primitive modes, which `GLTFLoader` turns into `THREE.Points` and
  // `THREE.LineSegments` — both of which answer `.geometry` and `.material` perfectly well. A read
  // that only checked the MATERIAL would fold a debug polyline into a tree's own geometry.
  const points = new THREE.Points(new THREE.BoxGeometry(2, 2, 2), texturedMaterial('Pine_Trunks', {}));
  points.name = 'Pine_Trunk_01';
  collectKitPrimitive(points, declared, found);
  assert.equal(found.objects.get('Pine_Trunk_01')!.length, 1, 'a Points node was read in as a mesh');
  assert.equal(found.triangles, 12);
});

test('a primitive with no parent at all resolves on its own name, rather than throwing', () => {
  // ⚠ A ROOT-LEVEL MESH HAS NO PARENT UNTIL IT IS ADDED TO SOMETHING, and four of the kit's six
  // objects are root-level nodes. Reading `obj.parent.name` unguarded turns the whole load into a
  // TypeError deep inside a traverse, naming nothing.
  const declared = new Set(['Pine_Trunk_01', 'Pine_Leaves_01']);
  const found = newKitCollector();
  const orphan = node('Pine_Trunk_01', texturedMaterial('Pine_Trunks', {}));
  orphan.updateMatrixWorld(true);
  assert.equal(orphan.parent, null, 'the fixture has a parent — it proves nothing');
  assert.ok(
    kitObjectNames().filter((n) => !n.includes('No_Leaves')).length >= 4,
    'the kit no longer has root-level objects — this case may have stopped being the ordinary one',
  );
  collectKitPrimitive(orphan, declared, found);
  assert.deepEqual([...found.objects.keys()], ['Pine_Trunk_01']);

  // And an UNdeclared parentless primitive falls through to the strip, not to an empty name.
  const stray = node('Plane054_2', texturedMaterial('Pine_Trunks', {}));
  stray.updateMatrixWorld(true);
  collectKitPrimitive(stray, declared, found);
  assert.deepEqual([...found.objects.keys()], ['Pine_Trunk_01', 'Plane054']);
});

test('⚠ two primitives of ONE object are a LIST under one key, not one overwriting the other', () => {
  // The dead pine wears both `Pine_Trunks` and `Pine_Branches`, so it exports as two primitives.
  // A map of name -> object would keep whichever arrived last and the tree would lose half itself.
  const declared = new Set(['Pine_Trunk_No_Leaves_01']);
  const found = newKitCollector();
  const group = new THREE.Group();
  group.name = 'Pine_Trunk_No_Leaves_01';
  group.add(node('Pine_Trunk_No_Leaves_01_0', texturedMaterial('Pine_Trunks', {})));
  group.add(node('Pine_Trunk_No_Leaves_01_1', texturedMaterial('Pine_Branches', {})));
  group.updateMatrixWorld(true);
  group.traverse((o) => collectKitPrimitive(o, declared, found));

  const parts = found.objects.get('Pine_Trunk_No_Leaves_01')!;
  assert.equal(parts.length, 2);
  assert.deepEqual(parts.map((p) => p.materialName).sort(), ['Pine_Branches', 'Pine_Trunks']);
  assert.equal(found.triangles, 24, 'the second primitive’s triangles were lost');
});

test('the manifest floor names every declared object the asset failed to deliver', () => {
  // ⚠ Every count and placement downstream is per assembly FOUND, so an asset that lost an object
  // would draw a quietly emptier island. The refusal names what is missing so it is actionable.
  const objects = new Map<string, unknown>([['Pine_Trunk_01', 1]]);
  assert.throws(
    () => assertKitComplete(['Pine_Trunk_01', 'Pine_Leaves_01', 'Red_Flower_01'], objects, 'a-source'),
    (e: Error) => {
      assert.match(e.message, /a-source/);
      assert.match(e.message, /Pine_Leaves_01, Red_Flower_01/);
      assert.doesNotMatch(e.message, /Pine_Trunk_01,/);
      assert.match(e.message, /under-reporting the work/);
      // What to DO about it, which is the half a bare "missing X" would drop: the asset may be
      // wrong, or the vocabulary may be.
      assert.match(e.message, /Re-export the kit, or correct KIT_ASSEMBLIES/);
      return true;
    },
  );
  assert.equal(assertKitComplete(['Pine_Trunk_01'], objects, 'a-source'), undefined);
  assert.equal(assertKitComplete([], new Map(), 'a-source'), undefined);
});

test('an assembly is recentred on its JOINT footprint with its base at y = 0', () => {
  // ⚠⚠ ONE BOX FOR THE WHOLE ASSEMBLY. Recentring each object on its OWN base drops a pine's crown
  // 18% of the tree's height into its trunk — the crown's own base is not the tree's.
  // ⚠⚠ THE ASSEMBLY DOES NOT START ON THE GROUND. Blender exports the kit's objects around their
  // own origins, so a fixture already sitting at y = 0 makes `-box.min.y` and `+box.min.y` the same
  // translate and the assembly's height `max - min` and `max + min` the same number — a recentring
  // that never moves anything, proving nothing about either.
  const trunk = part('Trunk', 'Pine_Trunks', 2, 10, 2);
  trunk.geometry.translate(20, 9, -8);
  trunk.geometry.computeBoundingBox();
  const crown = part('Crown', 'Pine_Branches', 6, 6, 6);
  crown.geometry.translate(21, 16, -8);
  crown.geometry.computeBoundingBox();
  assert.ok(trunk.geometry.boundingBox!.min.y > 0, 'the fixture already stands on the ground');

  const built = assembleParts([trunk, crown], ['Trunk', 'Crown']);
  const joint = new THREE.Box3();
  for (const p of built.objects) joint.union(p.geometry.boundingBox!);

  // x and z on the joint centre, base at y = 0 — and the crown keeps its offset from the trunk.
  assert.ok(Math.abs(joint.min.y) < 1e-9, `the base sits at ${joint.min.y}, not 0`);
  assert.ok(Math.abs(joint.min.x + joint.max.x) < 1e-9, 'x is not centred on the joint box');
  assert.ok(Math.abs(joint.min.z + joint.max.z) < 1e-9, 'z is not centred on the joint box');
  assert.ok(built.objects[1]!.geometry.boundingBox!.min.y > 0, 'the crown was dropped to the ground');

  // The measurements are the JOINT box's own extents, and the width is the WIDER horizontal axis.
  // Trunk spans y 4..14, crown 13..19 — so the assembly is 15 tall and its base was 4 off the floor.
  assert.equal(built.height, 19 - 4);
  assert.equal(built.width, 24 - 18);
  assert.deepEqual(built.names, ['Trunk', 'Crown']);

  // ⚠ NON-VACUITY ON `Math.max`: a deeper-than-wide assembly takes its depth instead.
  const deep = part('Deep', 'Pine_Trunks', 2, 4, 9);
  deep.geometry.computeBoundingBox();
  assert.equal(assembleParts([deep], ['Deep']).width, 9);
});

test('the GPU payload is 4 bytes a texel with the mip chain, summed over the textures', () => {
  // 4/3 is the full mip chain over the base level; dropping it under-reports every island's VRAM
  // by a quarter, and multiplying instead of adding it is a different number that looks fine.
  assert.equal(textureGpuBytes([]), 0);
  assert.equal(
    textureGpuBytes([{ name: 'a', width: 1024, height: 512 }]),
    Math.round(1024 * 512 * 4 * (4 / 3)),
  );
  assert.equal(
    textureGpuBytes([
      { name: 'a', width: 1024, height: 512 },
      { name: 'b', width: 256, height: 128 },
    ]),
    Math.round(1024 * 512 * 4 * (4 / 3)) + Math.round(256 * 128 * 4 * (4 / 3)),
  );
  // ⚠ WIDTH TIMES HEIGHT, NOT DIVIDED: a non-square texture is the case that tells them apart.
  assert.equal(textureGpuBytes([{ name: 'a', width: 8, height: 2 }]), Math.round(8 * 2 * 4 * (4 / 3)));
  assert.notEqual(textureGpuBytes([{ name: 'a', width: 8, height: 2 }]), Math.round((8 / 2) * 4 * (4 / 3)));
});

/** A part whose material carries a base-colour map with the given decoded stand-in. */
function leafPart(materialName: string, image: unknown): KitObject {
  const p = part('Leaves', materialName, 1, 1, 1);
  if (image !== null) {
    const texture = new THREE.Texture();
    texture.image = image;
    p.material.map = texture;
  }
  return p;
}

test('a leaf material’s mean is read ONCE, off the asset, and only for LEAF materials', () => {
  // ⚠ A tint rotates the map onto a token's chromaticity at the MAP's own luminance, so the mean
  // has to come from the asset. Reading it per part instead of once would decode a 1024x1024
  // foliage map for every tree on the island.
  const reads: unknown[] = [];
  const meanOf = (image: DecodedMap): Rgb => {
    reads.push(image);
    return { r: 70, g: 90, b: 69 };
  };
  const means = collectLeafMeans(
    [
      [leafPart('Pine_Trunks', { id: 'bark' }), leafPart('Pine_Branches', { id: 'foliage-a' })],
      [leafPart('Pine_Branches', { id: 'foliage-b' })],
    ],
    'a-source',
    meanOf,
  );
  assert.deepEqual([...means.keys()], ['Pine_Branches']);
  assert.deepEqual(means.get('Pine_Branches'), { r: 70, g: 90, b: 69 });
  assert.deepEqual(reads, [{ id: 'foliage-a' }], 'the mean was read more than once, or off the bark');
});

test('a leaf material with no decoded map is refused, and so is a kit carrying none at all', () => {
  // ⚠ The alternative is a crown silently wearing its state token as a FLAT colour instead of the
  // asset it was bought for — which reads as a deliberate art direction, not as a fault.
  const meanOf = (): Rgb => ({ r: 1, g: 1, b: 1 });
  assert.throws(
    () => collectLeafMeans([[leafPart('Pine_Branches', null)]], 'a-source', meanOf),
    (e: Error) => {
      assert.match(e.message, /in a-source the leaf material Pine_Branches carries no base-colour/);
      assert.match(e.message, /a state tint has nothing to rotate/);
      assert.match(e.message, /silently wear the token as a flat colour instead of the asset/);
      return true;
    },
  );
  // A kit with no leaf material anywhere is the other half, and it says what it costs: every
  // tinted state would fall back to the kit's own green and report every capability as proven.
  assert.throws(
    () => collectLeafMeans([[leafPart('Pine_Trunks', { id: 'bark' })]], 'a-source', meanOf),
    (e: Error) => {
      assert.match(e.message, /a-source carries none of the declared leaf materials/);
      assert.match(e.message, /\[Pine_Branches\]/);
      assert.match(e.message, /every tinted state would fall back to the kit's own green/);
      assert.match(e.message, /every capability as proven/);
      return true;
    },
  );

  // ⚠ THE MISSING SET IS A LIST, AND IT IS JOINED. `LEAF_MATERIALS` has one member today, so the
  // separator is unreachable through it — and a message that ran two material names together
  // would be discovered the day a second leaf material is declared, in a refusal nobody can read.
  assert.throws(
    () =>
      collectLeafMeans(
        [[leafPart('Pine_Trunks', { id: 'bark' })]],
        'a-source',
        meanOf,
        new Set(['Pine_Branches', 'Birch_Leaves']),
      ),
    /\[Pine_Branches, Birch_Leaves\]/,
  );
});

test('the default mean reader averages the map’s own solid texels', () => {
  // ⚠ The reader is a SEAM because decoding an image needs a browser — but the canvas comes
  // through it, so the default's own arithmetic is provable here rather than only on a GPU.
  const part1 = leafPart('Pine_Branches', { width: 2, height: 1 });
  const data = Uint8ClampedArray.from([10, 20, 30, 255, 30, 60, 90, 255]);
  const canvas: TexelCanvas = {
    width: -1,
    height: -1,
    getContext: () => ({
      drawImage: () => undefined,
      getImageData: () => ({ data }),
    }),
  };
  const mean = decodedLeafMean(part1.material.map!.image as DecodedMap, () => canvas);
  assert.deepEqual(mean, { r: 20, g: 40, b: 60 });
});

/** A whole scene the vocabulary declares every object of — a kit, synthesised. */
function fixtureScene(): THREE.Group {
  const scene = new THREE.Group();
  const foliage = texturedMaterial('Pine_Branches', { map: { width: 8, height: 8 } });
  foliage.map!.image = { width: 8, height: 8 };
  // ⚠ REVERSED, SO THE MATERIAL LIST ARRIVES OUT OF ORDER. `kitObjectNames()` is sorted and its
  // first entries are the leafy ones, so reading the objects forward inserts `Pine_Branches` first
  // and the material list comes out sorted whether anything sorts it or not.
  for (const name of [...kitObjectNames()].reverse()) {
    const leafy = name.includes('Leaves') && !name.includes('No_Leaves');
    scene.add(node(name, leafy ? foliage : texturedMaterial('Pine_Trunks', {}), [2, 4, 2], [0, 2, 0]));
  }
  scene.updateMatrixWorld(true);
  return scene;
}

test('the whole load, over a synthesised scene: assemblies, materials, triangles and payload', () => {
  // ⚠ THE RETURN ITSELF IS AN ASSERTION SUBJECT. Every field here was unreachable while the load
  // was one browser-bound function — including `wireBytes`, which is the number a payload report
  // prints, and the SORT on `materials`, which is what makes a report's list stable between runs.
  const kit = kitFromScene(fixtureScene(), 162_748, 'a-source', () => ({ r: 70, g: 90, b: 69 }));

  assert.deepEqual(
    [...kit.assemblies.keys()].sort(),
    ['flower', 'flower-white', 'pine-a', 'pine-b', 'pine-dead', 'plant-a', 'plant-b', 'tuft-a', 'tuft-b', 'tuft-c'],
  );
  assert.deepEqual(kit.assemblies.get('pine-a')!.names, ['Pine_Trunk_01', 'Pine_Leaves_01']);
  assert.equal(kit.assemblies.get('pine-a')!.objects.length, 2);
  assert.equal(kit.assemblies.get('pine-dead')!.objects.length, 1);
  assert.deepEqual(kit.materials, ['Pine_Branches', 'Pine_Trunks'], 'the material list is not sorted');
  assert.equal(kit.triangles, kitObjectNames().length * 12);
  assert.equal(kit.wireBytes, 162_748);
  assert.deepEqual(kit.textures, [{ name: 'map:Pine_Branches', width: 8, height: 8 }]);
  assert.equal(kit.gpuBytes, Math.round(8 * 8 * 4 * (4 / 3)));
  assert.deepEqual([...kit.leafMeans.keys()], ['Pine_Branches']);

  // Every assembly is recentred, so a placement stands ON the ground rather than half through it.
  for (const [name, built] of kit.assemblies) {
    const box = new THREE.Box3();
    for (const p of built.objects) box.union(p.geometry.boundingBox!);
    assert.ok(Math.abs(box.min.y) < 1e-9, `${name} does not stand at y = 0`);
    assert.equal(built.height, 4);
  }
});

test('a scene missing a declared object is refused by the load, naming it', () => {
  const thin = fixtureScene();
  const gone = thin.children.find((c) => c.name === 'Red_Flower_01')!;
  thin.remove(gone);
  assert.throws(
    () => kitFromScene(thin, 0, 'a-source', () => ({ r: 1, g: 1, b: 1 })),
    /missing objects the vocabulary declares: Red_Flower_01/,
  );
});

test('⚠ resolving the scene graph cannot move a RECENTRED assembly on this asset', () => {
  // ⚠⚠ THIS IS THE PREMISE THE `Stryker disable` ON `updateMatrixWorld` RESTS ON, PINNED RATHER
  // THAN ASSERTED IN A COMMENT — and it is a fact about the ASSET, not about the code. Every part
  // of each declared assembly sits under ONE node transform, and `assembleParts` recentres on the
  // joint box, so a translation common to all of them is subtracted straight back out. Resolving
  // the graph or not therefore delivers the same `LoadedKit` for this kit, and no test can kill a
  // mutant in that call.
  //
  // The CALL is still required and is NOT equivalent in general: glTF keeps a node transform
  // separate from its mesh, so a kit whose crown and trunk hung off different nodes — or a scaled
  // node — would come out proportioned by an accident of how it was authored. If a re-export ever
  // does that, this fails and the annotation stops being true in the same run.
  //
  // ⚠ IT READS THE CONTAINER'S OWN JSON RATHER THAN LOADING IT. A `GLTFLoader` import here would
  // put this file on `texture-convention.test.ts`'s sweep of "modules that reach for a texture
  // loader", and carving test files out of that sweep is exactly the list-shaped opt-out its own
  // header refuses.
  const bytes = new Uint8Array(decodeKitAsset());
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength))) as {
    nodes?: Array<{
      name?: string;
      mesh?: number;
      children?: number[];
      translation?: number[];
      scale?: number[];
      matrix?: number[];
    }>;
  };
  const nodes = gltf.nodes ?? [];

  // Every declared object's own node, and the world offset it sits at. The kit's objects are all
  // scene-root nodes, so a node's own translation IS its world one — asserted rather than assumed.
  const childOf = new Set(nodes.flatMap((n) => n.children ?? []));
  const at = new Map<string, string>();
  for (const [index, n] of nodes.entries()) {
    if (n.mesh === undefined || !n.name) continue;
    assert.ok(!childOf.has(index), `${n.name} is nested — its world transform is not its own`);
    assert.equal(n.matrix, undefined, `${n.name} carries a raw matrix, not a TRS`);
    assert.deepEqual(n.scale ?? [1, 1, 1], [1, 1, 1], `${n.name} is scaled — recentring cannot undo that`);
    at.set(n.name, JSON.stringify(n.translation ?? [0, 0, 0]));
  }

  let checked = 0;
  for (const names of Object.values(KIT_ASSEMBLIES)) {
    const places = (names as readonly string[]).map((n) => {
      const where = at.get(n);
      assert.ok(where, `the asset holds no node named ${n}`);
      return where;
    });
    for (const where of places) {
      assert.equal(where, places[0], 'an assembly’s parts hang off DIFFERENT node transforms');
      checked += 1;
    }
  }
  assert.equal(checked, kitObjectNames().length, `only ${checked} objects checked`);
  // NON-VACUITY: the transforms are not all the same one, so "equal within an assembly" is a real
  // constraint rather than a fact about a kit authored at the origin.
  assert.ok(new Set(at.values()).size > 1, 'every object sits at the same place — nothing is proved');
});

test('⚠ `updateMatrixWorld`’s FORCE argument cannot change a matrix on this asset', () => {
  // ⚠⚠ THIS IS THE PREMISE THE `Stryker disable` ON THAT LINE RESTS ON, PINNED RATHER THAN
  // ASSERTED IN A COMMENT. `Object3D.updateMatrixWorld(force)` recomputes a node's world matrix
  // when its own matrix is dirty OR when `force` is set — and a node with `matrixAutoUpdate` on
  // dirties itself on every call, so `force` only ever reaches nodes that have turned it off.
  // `GLTFLoader` turns it off on nothing. If a re-export or a loader change ever did, this fails
  // and the annotation stops being true in the same run.
  //
  // The CALL still matters and is not equivalent: glTF keeps a node transform separate from its
  // mesh, and every world matrix is identity until something resolves the graph.
  const gltf = new THREE.Group();
  const scene = fixtureScene();
  gltf.add(scene);
  let nodes = 0;
  gltf.traverse((o) => {
    nodes += 1;
    assert.equal(o.matrixAutoUpdate, true, `${o.name || o.type} has turned matrixAutoUpdate off`);
  });
  assert.ok(nodes > 1, 'the fixture has no nodes to check');
});

// ---------------------------------------------------------------------------
// the placement's own scale, and the measured heights (2026-09-03)
// ---------------------------------------------------------------------------

test('the placement’s own scale multiplies the role scale — the geometry, the extent, all of it', () => {
  assert.equal(placementScale(KIT, placement({ scale: 0.5 })), (KIT_ROLE_SIZE.tree.units / 12) * 0.5);
  assert.equal(placementScale(KIT, placement()), KIT_ROLE_SIZE.tree.units / 12, 'scale 1 is the role scale');
  const half = placementExtent(KIT, placement({ scale: 0.5 }));
  const full = placementExtent(KIT, placement());
  assert.equal(half.height, full.height / 2);
  assert.equal(half.width, full.width / 2);
  // And the delivered vertices halve with it — the scale reaches the mesh, not only the arithmetic.
  const boxOf = (m: THREE.Mesh): THREE.Box3 =>
    new THREE.Box3().setFromBufferAttribute(m.geometry.getAttribute('position') as THREE.BufferAttribute);
  const tall = boxOf(kitMeshes(KIT, [placement()])[0]!);
  const short = boxOf(kitMeshes(KIT, [placement({ scale: 0.5 })])[0]!);
  assert.ok(Math.abs(short.max.y - tall.max.y / 2) < 1e-9, `${short.max.y} against ${tall.max.y}`);
  assert.ok(Math.abs(short.max.x - tall.max.x / 2) < 1e-9, 'the width scales too — the kit is uniform');
});

test('a role’s HEIGHT is measured at its role scale, tallest arm winning, and the bloom’s is its proportions’', () => {
  const h = roleHeights(KIT);
  assert.equal(h.tree, KIT_ROLE_SIZE.tree.units, 'a height-sized role delivers its declared height exactly');
  assert.equal(h.deadTree, KIT_ROLE_SIZE.deadTree.units);
  // The bloom is sized by WIDTH: the fixture flower is 2 tall over 1.5 wide, so at 4 wide it is 5.333.
  assert.ok(Math.abs(h.bloom - (2 * KIT_ROLE_SIZE.bloom.units) / 1.5) < 1e-9);
  assert.notEqual(h.bloom, KIT_ROLE_SIZE.bloom.units, 'a width-sized role’s height is not its width');
  const thin = { ...KIT, assemblies: new Map(KIT.assemblies) };
  thin.assemblies.delete('pine-b');
  assert.throws(() => roleHeights(thin), /pine-b/);
  const flat = { ...KIT, assemblies: new Map(KIT.assemblies) };
  flat.assemblies.set('pine-a', { ...assembly(3, 12, 3), height: 0 });
  assert.throws(() => roleHeights(flat), /height/);
});
