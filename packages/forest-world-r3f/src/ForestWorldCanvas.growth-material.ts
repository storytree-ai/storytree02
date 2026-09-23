// GPU-side application of the app-owned regrow cursor.  The table is a texture rather
// than a uniform array so the number of islands is not a shader-source limit.
import * as THREE from 'three';

export const GROWTH_SLOT_ATTRIBUTE = 'aRegrowSlot';
export const GROWTH_ANCHOR_ATTRIBUTE = 'aRegrowAnchor';

export interface GrowthTexture {
  readonly texture: THREE.DataTexture;
  readonly values: Float32Array;
  readonly width: number;
}

export function createGrowthTexture(slotCount: number): GrowthTexture {
  const width = Math.max(1, slotCount);
  const values = new Float32Array(width);
  values.fill(1);
  const texture = new THREE.DataTexture(values, width, 1, THREE.RedFormat, THREE.FloatType);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return { texture, values, width };
}

/** Update the existing GPU table; omitted entries deliberately stay full-grown. */
export function setGrowthTexture(target: GrowthTexture, progressBySlot: readonly number[]): boolean {
  let changed = false;
  target.values.forEach((_current, slot) => {
    const next = progressBySlot[slot] ?? 1;
    if (target.values[slot] !== next) {
      target.values[slot] = next;
      changed = true;
    }
  });
  if (changed) target.texture.needsUpdate = true;
  return changed;
}

function patchOnce(source: string, anchor: string, replacement: string, label: string): string {
  if (!source.includes(anchor)) throw new Error(`regrow growth material: ${label} has no ${anchor} anchor`);
  return source.replace(anchor, replacement);
}

const declarations = () => `attribute float ${GROWTH_SLOT_ATTRIBUTE};
attribute vec3 ${GROWTH_ANCHOR_ATTRIBUTE};
uniform sampler2D uRegrowProgress;
uniform float uRegrowProgressWidth;
varying float vRegrowProgress;`;

const sample = () => `float stRegrowProgress = texture2D(uRegrowProgress,
  vec2((${GROWTH_SLOT_ATTRIBUTE} + 0.5) / uRegrowProgressWidth, 0.5)).r;
vRegrowProgress = stRegrowProgress;`;

/** Patch the owned ground shader. Fields still sample original coordinates; only its raster
 * position moves, so the stable atlas and status data travel with their island. */
export function installGroundGrowth(material: THREE.ShaderMaterial, growth: GrowthTexture): void {
  material.uniforms.uRegrowProgress = { value: growth.texture };
  material.uniforms.uRegrowProgressWidth = { value: growth.width };
  material.vertexShader = patchOnce(material.vertexShader, 'void main() {', `${declarations()}
void main() {
  ${sample()}
  vec3 stRegrowPosition = stRegrowProgress == 1.0 ? position : mix(${GROWTH_ANCHOR_ATTRIBUTE}, position, stRegrowProgress);`, 'ground vertex shader');
  material.vertexShader = patchOnce(material.vertexShader,
    'gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
    'gl_Position = projectionMatrix * modelViewMatrix * vec4(stRegrowPosition, 1.0);', 'ground position');
  material.fragmentShader = patchOnce(material.fragmentShader, 'void main() {', `varying float vRegrowProgress;
void main() {
  if (vRegrowProgress <= 0.0) discard;`, 'ground fragment shader');
  material.needsUpdate = true;
}

/** Clone before patching because kit source materials are shared by every canvas.  Three does not
 * copy `onBeforeCompile`, so deliberately carry the source hook across and call it with the clone
 * as `this`; this preserves the prop-lighting patch and its cache contract. */
export function cloneGrowthMaterial(source: THREE.MeshStandardMaterial, growth: GrowthTexture): THREE.MeshStandardMaterial {
  const material = source.clone();
  const sourceHook = source.onBeforeCompile;
  const sourceKey = source.customProgramCacheKey;
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    sourceHook.call(this, shader, renderer);
    shader.uniforms.uRegrowProgress = { value: growth.texture };
    shader.uniforms.uRegrowProgressWidth = { value: growth.width };
    shader.vertexShader = patchOnce(shader.vertexShader, '#include <common>', `#include <common>
${declarations()}`, 'kit vertex shader');
    shader.vertexShader = patchOnce(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>
${sample()}
transformed = stRegrowProgress == 1.0 ? transformed : mix(${GROWTH_ANCHOR_ATTRIBUTE}, transformed, stRegrowProgress);`, 'kit position');
    shader.fragmentShader = patchOnce(shader.fragmentShader, '#include <common>', `#include <common>
varying float vRegrowProgress;`, 'kit fragment shader');
    shader.fragmentShader = patchOnce(shader.fragmentShader, '#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
if (vRegrowProgress <= 0.0) discard;`, 'kit discard');
  };
  material.customProgramCacheKey = function customProgramCacheKey() {
    return `${sourceKey.call(this)}|storytree-regrow-growth-v1`;
  };
  material.needsUpdate = true;
  return material;
}
