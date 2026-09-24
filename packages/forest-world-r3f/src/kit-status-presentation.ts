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
  // A missing lookup is not a hidden status. This read-only view permits asking the set about
  // undefined without a redundant guard; the supplied Set<string> cannot contain that value.
  const hiddenStatuses: ReadonlySet<string | undefined> = input.hiddenStatuses;
  for (const placement of input.placements) {
    const island = input.islandByPlacement.get(placement);
    const status = island === undefined ? undefined : input.foldedStatusByIslandCapability.get(`${island}::${placement.capId}`);
    const isAttributedFlora = placement.role === 'tree' || placement.role === 'deadTree' || placement.role === 'coverageFlora';
    alphaByPlacement.set(placement, isAttributedFlora && hiddenStatuses.has(status) ? 0.12 : 1);
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
  // The opaque route forces fragment alpha to 1 and disables normal blending. A legend
  // fade must enter the transparent pass; the scaled alpha test still keeps its cutout.
  material.transparent = true;
  material.depthWrite = true;
  material.onBeforeCompile = function onBeforeCompile(shader, renderer) {
    sourceHook.call(this, shader, renderer);
  };
  material.customProgramCacheKey = function customProgramCacheKey() {
    return `${sourceKey.call(this)}|storytree-kit-status-alpha-${alpha}`;
  };
  // This is a fresh, never-uploaded clone; its first renderer use compiles the installed hooks.
  return material;
}
