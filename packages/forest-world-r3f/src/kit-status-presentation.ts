import * as THREE from 'three';

import type { KitPlacement } from './kit-vocabulary.js';

export interface KitStatusPresentationInput {
  readonly placements: readonly KitPlacement[];
  readonly islandByPlacement: ReadonlyMap<KitPlacement, string>;
  readonly foldedStatusByIslandCapability: ReadonlyMap<string, string>;
  readonly hiddenStatuses: ReadonlySet<string>;
}

export interface KitStatusPresentation {
  readonly alphaByPlacement: ReadonlyMap<KitPlacement, number>;
}

/** Presentation is deliberately a sidecar: placement and its attribution remain canonical input. */
export function deriveKitStatusPresentation(input: KitStatusPresentationInput): KitStatusPresentation {
  const alphaByPlacement = new Map<KitPlacement, number>();
  for (const placement of input.placements) {
    const island = input.islandByPlacement.get(placement);
    const status = island === undefined ? undefined : input.foldedStatusByIslandCapability.get(`${island}::${placement.capId}`);
    const isAttributedFlora = placement.role === 'tree' || placement.role === 'deadTree' || placement.role === 'coverageFlora';
    alphaByPlacement.set(placement, isAttributedFlora && status !== undefined && input.hiddenStatuses.has(status) ? 0.12 : 1);
  }
  return { alphaByPlacement };
}

/**
 * Make the delivered dimmed route a material clone rather than changing shared kit material.
 * Opacity and its cutout threshold scale together, retaining the authored alpha-test shape.
 */
export function presentationMaterial(
  source: THREE.MeshStandardMaterial,
  alpha: number,
): THREE.MeshStandardMaterial {
  if (alpha === 1) return source;
  const material = source.clone();
  const sourceHook = source.onBeforeCompile;
  const sourceKey = source.customProgramCacheKey;
  material.opacity = source.opacity * alpha;
  material.alphaTest = source.alphaTest * alpha;
  material.transparent = false;
  material.depthWrite = true;
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    sourceHook.call(this, shader, renderer);
  };
  material.customProgramCacheKey = function customProgramCacheKey() {
    return `${sourceKey.call(this)}|storytree-kit-status-alpha-${alpha}`;
  };
  material.needsUpdate = true;
  return material;
}
