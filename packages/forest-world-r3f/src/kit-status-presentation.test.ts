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
    assemblies: new Map([['plant-a', assembly]]), materials: [], leafMeans: new Map([
      ['Pine_Forest_Foliage', { r: 50, g: 100, b: 50 }],
    ]), triangles: 0, wireBytes: 0, textures: [], gpuBytes: 0,
  };
}

function placement(capId: string, role: KitPlacement['role'] = 'coverageFlora'): KitPlacement {
  return {
    capId, role, assembly: 'plant-a', tint: null, at: { x: 0, z: 0 }, y: 0, yaw: 0, scale: 1,
  };
}

test('native-status-presentation-dims-only-attributed-capability-props: hidden status dims only its matching tree and coverage flora', () => {
  const hiddenTree = placement('cap-hidden', 'tree');
  const hiddenFlora = placement('cap-hidden', 'coverageFlora');
  const healthyTree = placement('cap-healthy', 'tree');
  const unknownTree = placement('cap-unknown', 'tree');
  const cover = placement('cover', 'bush');
  const bloom = placement('story', 'bloom');
  const bud = placement('story', 'bud');
  const wilt = placement('story', 'wilt');
  const placements = [hiddenTree, hiddenFlora, healthyTree, unknownTree, cover, bloom, bud, wilt];
  const islands = new Map<KitPlacement, string>(placements.map((item) => [item, item === unknownTree ? 'missing' : 'island-a']));

  const presentation = deriveKitStatusPresentation({
    placements,
    islandByPlacement: islands,
    foldedStatusByIslandCapability: new Map([
      ['island-a::cap-hidden', 'unhealthy'],
      ['island-a::cap-healthy', 'healthy'],
    ]),
    hiddenStatuses: new Set(['unhealthy']),
  });

  assert.equal(presentation.alphaByPlacement.get(hiddenTree), 0.12);
  assert.equal(presentation.alphaByPlacement.get(hiddenFlora), 0.12);
  for (const item of [healthyTree, unknownTree, cover, bloom, bud, wilt]) {
    assert.equal(presentation.alphaByPlacement.get(item), 1, `${item.role}/${item.capId} changed presentation`);
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

test('native-status-presentation-keeps-dimmed-cutouts-and-existing-hooks: dimmed delivered foliage keeps authored cutout, lighting, and growth hooks without mutating its source', () => {
  const source = new THREE.MeshStandardMaterial({ name: 'Pine_Forest_Foliage', transparent: true });
  source.name = 'Pine_Forest_Foliage';
  prepareKitMaterial(source);
  const dimmed = presentationMaterial(source, 0.12);
  const growth = cloneGrowthMaterial(dimmed, createGrowthTexture(1));
  const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: THREE.ShaderLib.standard.vertexShader, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  growth.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);

  assert.equal(source.opacity, 1, 'the shared kit material remains full alpha');
  assert.equal(dimmed.opacity, 0.12);
  assert.equal(dimmed.transparent, false);
  assert.equal(dimmed.depthWrite, true);
  assert.equal(dimmed.alphaTest, 0.06, 'the authored 0.5 cutout is scaled by the dimmed alpha');
  assert.match(shader.fragmentShader, /uPropIndirectScale/, 'prop lighting hook survives the status clone');
  assert.match(shader.fragmentShader, /vRegrowProgress <= 0\.0\) discard/, 'regrow zero-growth discard survives the status clone');
  assert.match(growth.customProgramCacheKey(), /storytree-regrow-growth-v1/, 'growth cache identity survives the status clone');
});
