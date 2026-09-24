import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import { cloneGrowthMaterial, createGrowthTexture } from './ForestWorldCanvas.growth-material.js';
import { kitMeshes, prepareKitMaterial } from './kit-mesh.js';
import type { KitAssemblyGeometry, KitObject, LoadedKit } from './kit-mesh.js';
import type { KitPlacement } from './kit-vocabulary.js';
import {
  deriveKitStatusPresentation,
  presentationMaterial,
} from './kit-status-presentation.js';

function object(material: THREE.MeshStandardMaterial): KitObject {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  geometry.computeBoundingBox();
  return { name: 'fixture', geometry, material, materialName: material.name };
}

function kit(): LoadedKit {
  const foliage = new THREE.MeshStandardMaterial({ name: 'Pine_Forest_Foliage', transparent: true });
  foliage.name = 'Pine_Forest_Foliage';
  prepareKitMaterial(foliage);
  const trunk = new THREE.MeshStandardMaterial({ name: 'Pine_Trunks' });
  trunk.name = 'Pine_Trunks';
  const assembly: KitAssemblyGeometry = {
    objects: [object(trunk), object(foliage)], names: ['fixture'], height: 1, width: 1,
  };
  return {
    assemblies: new Map([
      ['plant-a', assembly], ['pine-a', assembly], ['pine-dead', assembly], ['flower', assembly], ['tuft-a', assembly],
    ]), materials: [], leafMeans: new Map([
      ['Pine_Forest_Foliage', { r: 50, g: 100, b: 50 }],
    ]), triangles: 0, wireBytes: 0, textures: [], gpuBytes: 0,
  };
}

function placement(capId: string, role: KitPlacement['role'] = 'coverageFlora'): KitPlacement {
  return {
    capId, role,
    assembly: role === 'tree' ? 'pine-a' : role === 'deadTree' ? 'pine-dead'
      : role === 'bloom' || role === 'bud' || role === 'wilt' || role === 'flowerPatch' ? 'flower'
      : role === 'tuft' ? 'tuft-a' : 'plant-a',
    tint: null, at: { x: 0, z: 0 }, y: 0, yaw: 0, scale: 1,
  };
}

test('native-status-presentation-dims-only-attributed-capability-props: hidden status dims only its matching tree and coverage flora', () => {
  const hiddenTree = placement('cap-hidden', 'tree');
  const hiddenDeadTree = placement('cap-dead', 'deadTree');
  const hiddenFlora = placement('cap-hidden', 'coverageFlora');
  // Same capability id and untinted material on a different island: tint cannot supply status.
  const healthyTree = placement('cap-hidden', 'tree');
  const unknownTree = placement('cap-unknown', 'tree');
  const unattributedTree = placement('cap-shadow', 'tree');
  // Every excluded role deliberately matches a hidden capability; a missing map entry would
  // leave these full even if the role fence were broken.
  const cover = placement('cap-hidden', 'bush');
  const tuft = placement('cap-hidden', 'tuft');
  const flowerPatch = placement('cap-hidden', 'flowerPatch');
  const bloom = placement('cap-hidden', 'bloom');
  const bud = placement('cap-hidden', 'bud');
  const wilt = placement('cap-hidden', 'wilt');
  const placements = [hiddenTree, hiddenDeadTree, hiddenFlora, healthyTree, unknownTree, unattributedTree, cover, tuft, flowerPatch, bloom, bud, wilt];
  const islands = new Map<KitPlacement, string>(placements
    .filter((item) => item !== unattributedTree)
    .map((item) => [item, item === healthyTree ? 'island-b' : 'island-a']));

  const presentation = deriveKitStatusPresentation({
    placements,
    islandByPlacement: islands,
    foldedStatusByIslandCapability: new Map([
      ['island-a::cap-hidden', 'unhealthy'],
      ['island-a::cap-dead', 'unhealthy'],
      ['island-b::cap-hidden', 'healthy'],
      // A literal island named "undefined" must never impersonate absent attribution.
      ['undefined::cap-shadow', 'unhealthy'],
    ]),
    hiddenStatuses: new Set(['unhealthy']),
  });

  assert.equal(presentation.alphaByPlacement.get(hiddenTree), 0.12);
  assert.equal(presentation.alphaByPlacement.get(hiddenDeadTree), 0.12);
  assert.equal(presentation.alphaByPlacement.get(hiddenFlora), 0.12);
  for (const item of [healthyTree, unknownTree, unattributedTree, cover, tuft, flowerPatch, bloom, bud, wilt]) {
    assert.equal(presentation.alphaByPlacement.get(item), 1, `${item.role}/${item.capId} changed presentation`);
  }
  // The sidecar reaches real merged kit materials, not just a number returned by the helper.
  const meshes = kitMeshes(kit(), placements, undefined, presentation.alphaByPlacement);
  assert.equal(meshes.length, 4, 'three dimmed props and nine full props share two material buckets each');
  for (const mesh of meshes) {
    const material = mesh.material as THREE.MeshStandardMaterial;
    assert.equal(mesh.geometry.getAttribute('position').count, material.opacity === 0.12 ? 3 * 24 : 9 * 24);
  }
});

test('native-status-presentation-does-not-change-ground-or-casters: presentation is an immutable sidecar and leaves input streams intact', () => {
  const target = placement('cap-hidden', 'tree');
  const control = placement('cover', 'tuft');
  const placements = [target, control];
  const islands = new Map<KitPlacement, string>([[target, 'island-a'], [control, 'island-a']]);
  const originalPlacements = structuredClone(placements);
  const originalIslands = new Map(islands);
  const casters = [{ source: target }, { source: control }];
  const originalCasters = structuredClone(casters);

  const presentation = deriveKitStatusPresentation({
    placements, islandByPlacement: islands,
    foldedStatusByIslandCapability: new Map([['island-a::cap-hidden', 'unhealthy']]),
    hiddenStatuses: new Set(['unhealthy']),
  });

  assert.notEqual(presentation.alphaByPlacement, islands, 'the presentation must not reuse attribution as mutable state');
  assert.deepEqual(placements, originalPlacements);
  assert.deepEqual([...islands], [...originalIslands]);
  assert.deepEqual(casters, originalCasters, 'presentation never edits the caster input');
  assert.equal(deriveKitStatusPresentation({
    placements, islandByPlacement: islands, foldedStatusByIslandCapability: new Map(), hiddenStatuses: new Set(['unhealthy']),
  }).alphaByPlacement.get(target), 1, 'an empty status stream still returns full presentation for every placement');
});

test('native-status-presentation-batches-delivered-materials-by-alpha: actual kitMeshes keeps equal presentation parts merged while retaining every prop', () => {
  const source = kit();
  const dimmedA = placement('cap-a');
  const dimmedB = placement('cap-b');
  const full = placement('cap-c');
  const alphaByPlacement = new Map<KitPlacement, number>([[dimmedA, 0.12], [dimmedB, 0.12], [full, 1]]);
  const meshes = kitMeshes(source, [dimmedA, dimmedB, full], undefined, alphaByPlacement);
  const foliage = meshes.filter((mesh) => (mesh.material as THREE.MeshStandardMaterial).name === 'Pine_Forest_Foliage');
  assert.equal(foliage.length, 2, 'three foliage props form full and dimmed material buckets, never one mesh per prop');
  assert.deepEqual(foliage.map((mesh) => mesh.geometry.getAttribute('position').count).sort((a, b) => a - b), [24, 48]);
  assert.deepEqual(foliage.map((mesh) => (mesh.material as THREE.MeshStandardMaterial).opacity).sort(), [0.12, 1]);
});

test('native-status-presentation-batches-delivered-materials-by-alpha: absent alpha keeps full materials and bark batching across foliage tints', () => {
  const source = kit();
  const parts = source.assemblies.get('plant-a')!.objects;
  const bark = parts[0]!.material;
  const foliage = parts[1]!.material;
  const meshes = kitMeshes(source, [
    { ...placement('cap-a'), tint: '#89b56b' },
    { ...placement('cap-b'), tint: '#89b56b' },
    { ...placement('cap-c'), tint: '#a08355' },
    placement('cover', 'bush'),
  ]);

  assert.equal(meshes.length, 4, 'one shared bark bucket, two foliage tints, and the untouched atlas');
  const barkMesh = meshes.find((mesh) => mesh.material === bark)!;
  assert.ok(barkMesh, 'full-alpha bark must retain the exact shared material');
  assert.equal(barkMesh.geometry.getAttribute('position').count, 4 * 24);
  const foliageMeshes = meshes.filter((mesh) => mesh !== barkMesh);
  assert.equal(foliageMeshes.filter((mesh) => mesh.material === foliage).length, 1);
  assert.deepEqual(foliageMeshes.map((mesh) => mesh.geometry.getAttribute('position').count).sort((a, b) => a - b), [24, 24, 48]);
  assert.equal(new Set(foliageMeshes.map((mesh) => mesh.material)).size, 3);
  for (const mesh of meshes) assert.equal((mesh.material as THREE.MeshStandardMaterial).opacity, 1);
  assert.equal(presentationMaterial(foliage, 1), foliage, 'the explicit full-alpha route also keeps exact identity');
});

test('native-status-presentation-batches-delivered-materials-by-alpha: each dimmed bucket owns one material and merged buffers while the kit remains shared', () => {
  const created: THREE.MeshStandardMaterial[] = [];
  class TrackedMaterial extends THREE.MeshStandardMaterial {
    override clone(): this {
      const clone = super.clone();
      created.push(clone);
      return clone;
    }
  }
  const source = kit();
  const parts = source.assemblies.get('plant-a')!.objects;
  for (const part of parts) {
    part.material = new TrackedMaterial().copy(part.material);
    prepareKitMaterial(part.material);
  }
  const sourceMaterials = new Set(parts.map((part) => part.material));
  const sourceGeometries = new Set(parts.map((part) => part.geometry));
  const sourceBefore = parts.map((part) => ({
    opacity: part.material.opacity,
    alphaTest: part.material.alphaTest,
    version: part.material.version,
    hook: part.material.onBeforeCompile,
    key: part.material.customProgramCacheKey,
    positions: [...part.geometry.getAttribute('position').array],
  }));
  const disposedSource: unknown[] = [];
  for (const material of sourceMaterials) material.addEventListener('dispose', () => disposedSource.push(material));
  for (const geometry of sourceGeometries) geometry.addEventListener('dispose', () => disposedSource.push(geometry));
  const dimmedA = placement('cap-a');
  const dimmedB = placement('cap-b');
  const full = placement('cap-c');
  const transformed: THREE.BufferGeometry[] = [];
  const disposedTransformed: THREE.BufferGeometry[] = [];
  const meshes = kitMeshes(source, [dimmedA, dimmedB, full], (_placement, geometry) => {
    transformed.push(geometry);
    geometry.addEventListener('dispose', () => disposedTransformed.push(geometry));
  }, new Map([[dimmedA, 0.12], [dimmedB, 0.12], [full, 1]]));

  assert.equal(transformed.length, 6, 'each placement contributes both actual assembly parts');
  assert.deepEqual(new Set(disposedTransformed), new Set(transformed), 'temporary transformed parts are released after merging');
  assert.equal(created.length, 2, 'repeated dimmed placements allocate one material for each of the two buckets');
  const ownedMaterials = new Set(meshes.map((mesh) => mesh.material as THREE.MeshStandardMaterial)
    .filter((material) => !sourceMaterials.has(material)));
  assert.deepEqual(ownedMaterials, new Set(created), 'every created status material reaches a delivered mesh');
  for (const mesh of meshes) {
    assert.ok(!sourceGeometries.has(mesh.geometry), 'a delivered mesh must not borrow mutable kit geometry');
    assert.ok(!transformed.includes(mesh.geometry), 'merged output must outlive its disposed input parts');
  }

  const disposedOwnedMaterials: THREE.MeshStandardMaterial[] = [];
  const disposedOutput: THREE.BufferGeometry[] = [];
  for (const material of ownedMaterials) {
    material.addEventListener('dispose', () => disposedOwnedMaterials.push(material));
    material.dispose();
  }
  for (const mesh of meshes) {
    mesh.geometry.addEventListener('dispose', () => disposedOutput.push(mesh.geometry));
    mesh.geometry.dispose();
  }
  assert.deepEqual(new Set(disposedOwnedMaterials), ownedMaterials);
  assert.deepEqual(new Set(disposedOutput), new Set(meshes.map((mesh) => mesh.geometry)));
  assert.deepEqual(disposedSource, [], 'releasing the output must not release the shared kit');
  assert.deepEqual(parts.map((part) => ({
    opacity: part.material.opacity,
    alphaTest: part.material.alphaTest,
    version: part.material.version,
    hook: part.material.onBeforeCompile,
    key: part.material.customProgramCacheKey,
    positions: [...part.geometry.getAttribute('position').array],
  })), sourceBefore, 'delivery and cleanup leave the shared materials and geometry untouched');
});

test('native-status-presentation-keeps-dimmed-cutouts-and-existing-hooks: dimmed delivered foliage keeps authored cutout, lighting, and growth hooks without mutating its source', () => {
  const loaded = kit();
  const source = loaded.assemblies.get('plant-a')!.objects[1]!.material;
  const sourceVersion = source.version;
  const sourceKey = source.customProgramCacheKey();
  const sourceHook = source.onBeforeCompile;
  const dimmedPlacement = placement('cap-a');
  const delivered = kitMeshes(loaded, [dimmedPlacement], undefined, new Map([[dimmedPlacement, 0.12]]));
  const dimmed = delivered.find((mesh) => (mesh.material as THREE.MeshStandardMaterial).name === 'Pine_Forest_Foliage')!.material as THREE.MeshStandardMaterial;
  const growthTexture = createGrowthTexture(2);
  const growth = cloneGrowthMaterial(dimmed, growthTexture);
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  growth.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);

  assert.equal(source.opacity, 1, 'the shared kit material remains full alpha');
  assert.equal(source.alphaTest, 0.5);
  assert.equal(source.version, sourceVersion);
  assert.equal(source.onBeforeCompile, sourceHook);
  assert.equal(source.customProgramCacheKey(), sourceKey);
  assert.equal(dimmed.opacity, 0.12);
  assert.equal(dimmed.transparent, false);
  assert.equal(dimmed.depthWrite, true);
  assert.equal(dimmed.alphaTest, 0.06, 'the authored 0.5 cutout is scaled by the dimmed alpha');
  for (const texelAlpha of [0, 0.49, 0.5, 1]) {
    assert.equal(texelAlpha * dimmed.opacity >= dimmed.alphaTest, texelAlpha >= 0.5, 'dimmed cutouts keep the authored silhouette');
  }
  assert.equal(dimmed.customProgramCacheKey(), `${sourceKey}|storytree-kit-status-alpha-0.12`);
  assert.equal(growth.customProgramCacheKey(), `${sourceKey}|storytree-kit-status-alpha-0.12|storytree-regrow-growth-v1`);
  const otherAlpha = presentationMaterial(source, 0.24);
  assert.notEqual(otherAlpha.customProgramCacheKey(), dimmed.customProgramCacheKey(), 'distinct presentations must not alias shader cache identities');
  assert.match(shader.fragmentShader, /uPropIndirectScale/, 'prop lighting hook survives the status clone');
  assert.equal(shader.uniforms.uRegrowProgress!.value, growthTexture.texture);
  assert.equal(shader.uniforms.uRegrowProgressWidth!.value, 2);
  assert.match(shader.vertexShader, /attribute float aRegrowSlot;/);
  assert.match(shader.vertexShader, /attribute vec3 aRegrowAnchor;/);
  assert.match(shader.fragmentShader, /vRegrowProgress <= 0\.0\) discard/, 'regrow zero-growth discard survives the status clone');
  growth.dispose();
  growthTexture.texture.dispose();
  otherAlpha.dispose();
  for (const mesh of delivered) {
    mesh.geometry.dispose();
    (mesh.material as THREE.MeshStandardMaterial).dispose();
  }
});
