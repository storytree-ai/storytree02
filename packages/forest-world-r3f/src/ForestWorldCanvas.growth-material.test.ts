import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import {
  GROWTH_ANCHOR_ATTRIBUTE,
  GROWTH_SLOT_ATTRIBUTE,
  cloneGrowthMaterial,
  createGrowthTexture,
  installGroundGrowth,
  setGrowthTexture,
} from './ForestWorldCanvas.growth-material.js';
import { installPropLighting } from './prop-lighting.js';

/** Node's reporter serializes an entire Three shader/texture on `assert.match`/`assert.equal`
 * failure. Under Stryker that can lose the terminal `(fail)` line and therefore the killer's
 * attribution. Keep the predicates identical while making the failure payload one short name. */
function assertShaderMatch(shader: string, pattern: RegExp, name: string): void {
  assert.equal(pattern.test(shader), true, name);
}

function assertSame(actual: unknown, expected: unknown, name: string): void {
  assert.ok(actual === expected, name);
}

test('the stable float table uploads only changed app presentation values', () => {
  const growth = createGrowthTexture(3);
  assert.deepEqual([...growth.values], [1, 1, 1]);
  assert.equal(growth.texture.version, 1, 'Three uploads only a texture with a positive version on its first bind');
  assert.equal(setGrowthTexture(growth, [0, 0.5, 1]), true);
  assert.deepEqual([...growth.values], [0, 0.5, 1]);
  const unchangedVersion = growth.texture.version;
  assert.equal(setGrowthTexture(growth, [0, 0.5, 1]), false);
  assert.equal(growth.texture.version, unchangedVersion, 'a same-value sample does not request a redraw');
  assert.equal(growth.texture.minFilter, THREE.NearestFilter);
  assert.equal(growth.texture.magFilter, THREE.NearestFilter);
  assert.equal(growth.texture.wrapS, THREE.ClampToEdgeWrapping);
  assert.equal(growth.texture.wrapT, THREE.ClampToEdgeWrapping);
  assert.equal(growth.texture.generateMipmaps, false);
  assert.equal(GROWTH_SLOT_ATTRIBUTE, 'aRegrowSlot');
  assert.equal(GROWTH_ANCHOR_ATTRIBUTE, 'aRegrowAnchor');
  const changedVersion = growth.texture.version;
  assert.equal(createGrowthTexture(0).width, 1);
  assert.equal(setGrowthTexture(growth, [0]), true);
  assert.deepEqual([...growth.values], [0, 1, 1]);
  assert.ok(growth.texture.version > changedVersion, 'a changed table requests a fresh GPU upload');
});

test('ground growth has island attributes, discards exactly zero, and keeps the full position path exact', () => {
  const growth = createGrowthTexture(2);
  const material = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: 'void main() {\n gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);\n}',
    fragmentShader: 'void main() {\n gl_FragColor = vec4(1.0);\n}',
  });
  installGroundGrowth(material, growth);
  assert.match(material.vertexShader, new RegExp(`attribute float ${GROWTH_SLOT_ATTRIBUTE}`));
  assert.match(material.vertexShader, new RegExp(`attribute vec3 ${GROWTH_ANCHOR_ATTRIBUTE}`));
  assert.match(material.vertexShader, /stRegrowProgress == 1\.0 \? position/);
  assert.match(material.vertexShader, /texture2D\(uRegrowProgress,/);
  assert.match(material.vertexShader, /\(aRegrowSlot \+ 0\.5\) \/ uRegrowProgressWidth/);
  assert.match(material.vertexShader, /gl_Position = projectionMatrix \* modelViewMatrix \* vec4\(stRegrowPosition, 1\.0\);/);
  assert.match(material.fragmentShader, /vRegrowProgress <= 0\.0\) discard/);
  assert.equal(material.uniforms.uRegrowProgress?.value, growth.texture);
  assert.equal(material.uniforms.uRegrowProgressWidth?.value, 2);
  assert.ok(material.version > 0, 'the patched ground shader recompiles');
});

test('ground installation refuses each moved shader anchor rather than claiming an incomplete patch', () => {
  const growth = createGrowthTexture(1);
  const material = (vertexShader: string, fragmentShader: string) => new THREE.ShaderMaterial({ uniforms: {}, vertexShader, fragmentShader });
  assert.throws(() => installGroundGrowth(material('main', 'void main() {}'), growth), /ground vertex shader has no void main/);
  assert.throws(() => installGroundGrowth(material('void main() {}', 'void main() {}'), growth), /ground position has no gl_Position/);
  assert.throws(() => installGroundGrowth(material('void main() { gl_Position = projectionMatrix \* modelViewMatrix \* vec4\(position, 1.0\); }', 'main'), growth), /ground fragment shader has no void main/);
});

test('a cloned kit material preserves the source hook and cache key with the clone as its receiver', () => {
  const growth = createGrowthTexture(1);
  const source = new THREE.MeshStandardMaterial();
  installPropLighting(source);
  const inheritedHook = source.onBeforeCompile;
  let hookReceiver: unknown;
  source.onBeforeCompile = function patchedSource(shader, renderer) {
    hookReceiver = this;
    inheritedHook.call(this, shader, renderer);
  };
  source.customProgramCacheKey = function sourceCacheKey() { return this === source ? 'source' : 'clone'; };
  const clone = cloneGrowthMaterial(source, growth);
  const shader = {
    uniforms: {} as Record<string, { value: unknown }>,
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  clone.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
  assertSame(hookReceiver, clone, 'source hook receives the growth clone');
  assert.equal(clone.customProgramCacheKey(), 'clone|storytree-regrow-growth-v1');
  assertShaderMatch(shader.fragmentShader, /uPropIndirectScale/, 'preserves prop lighting');
  assertShaderMatch(shader.vertexShader, new RegExp(GROWTH_ANCHOR_ATTRIBUTE), 'declares the shared growth anchor');
  assertShaderMatch(shader.vertexShader, /#include <common>\nattribute float aRegrowSlot;/, 'injects the kit slot declaration');
  assertShaderMatch(shader.fragmentShader, /#include <common>\nvarying float vRegrowProgress;/, 'injects the kit progress varying');
  assertShaderMatch(shader.fragmentShader, /vRegrowProgress <= 0\.0\) discard/, 'discards only zero progress');
  assertShaderMatch(shader.vertexShader, /transformed = stRegrowProgress == 1\.0 \? transformed : mix\(aRegrowAnchor, transformed, stRegrowProgress\);/, 'keeps the full-growth position exact');
  assertShaderMatch(shader.fragmentShader, /#include <clipping_planes_fragment>\nif \(vRegrowProgress <= 0\.0\) discard;/, 'injects discard after clipping');
  assertSame(shader.uniforms.uRegrowProgress?.value, growth.texture, 'wires the shared progress texture');
  assert.equal(shader.uniforms.uRegrowProgressWidth?.value, 1);
  assert.ok(clone.version > 0, 'the cloned material recompiles with its growth hook');
});

test('kit installation refuses moved common, begin-position, and clipping anchors', () => {
  const growth = createGrowthTexture(1);
  const compile = (vertexShader: string, fragmentShader: string) => {
    const clone = cloneGrowthMaterial(new THREE.MeshStandardMaterial(), growth);
    clone.onBeforeCompile({ uniforms: {}, vertexShader, fragmentShader } as never, {} as THREE.WebGLRenderer);
  };
  assert.throws(() => compile('main', THREE.ShaderLib.standard.fragmentShader), /kit vertex shader has no #include <common>/);
  assert.throws(() => compile('#include <common>', THREE.ShaderLib.standard.fragmentShader), /kit position has no #include <begin_vertex>/);
  assert.throws(() => compile(THREE.ShaderLib.standard.vertexShader, 'main'), /kit fragment shader has no #include <common>/);
  assert.throws(
    () => compile(THREE.ShaderLib.standard.vertexShader, THREE.ShaderLib.standard.fragmentShader.replace('#include <clipping_planes_fragment>', '')),
    /regrow growth material: kit discard has no #include <clipping_planes_fragment> anchor/,
  );
});
