import React from 'react';
import type { SceneNode } from '@storytree/forest-world';
import {
  SceneView,
  type ForestRegrowRenderLayer,
  type NativeIslandGrowthRenderLayer,
  type OrganicPoseRenderLayer,
  type SceneCtx,
} from './SceneView.js';
import type { SpriteStyleSheet } from './sprite-sheet.js';
import type { TrailRevealPlan } from './trailReveal.js';
import type { NeighbourHighlightPlan } from './neighbourHighlight.js';
import type { LaneLayout } from './laneLayout.js';
import type { SvgIslandAccretionState } from './svg-island-accretion.js';
import type { VegetationRenderLayer } from './vegetation-render.js';
import type { NativePropTargetRenderLayer } from './native-prop-targets.js';

export interface WorldPresentationModel {
  readonly scene: SceneNode;
  readonly selectedStoryId: string | null;
  readonly emphasizedStoryIds: readonly string[];
  readonly hiddenStatuses: readonly string[];
  readonly arrivalIds: readonly string[];
  readonly reveal: TrailRevealPlan | null;
  /** The ADR-0242 one-hop selection highlight: the lit trail segments + the immediate
   *  upstream / downstream islands. Null ⇒ nothing selected, no lane and no rings. */
  readonly neighbours: NeighbourHighlightPlan | null;
  /** The laid-out selection lanes (`laneLayout`). Present ⇒ the lit lane is drawn ONE PATH
   *  PER ROUTE in the relation's hue instead of per segment. Null ⇒ the per-segment ink lane. */
  readonly lanes: LaneLayout | null;
  /** Which selection motion the lanes carry (world setting `selectionMotion`). */
  readonly laneMotion: 'draw' | 'march' | 'none';
  readonly spriteSheet: SpriteStyleSheet | null;
  readonly artScale: number;
  readonly nativeIslandGrowthLayer?: NativeIslandGrowthRenderLayer | null;
  readonly svgIslandAccretionLayer?: SvgIslandAccretionState | null;
  /** The Act 2 whole-forest regrow (ADR-0282): which islands and roads exist yet, and the
   *  accretion state of every island still growing. Absent ⇒ the settled forest, unchanged. */
  readonly forestRegrowLayer?: ForestRegrowRenderLayer | null;
  /** Per-object vegetation growth (ADR-0292): each island's tree and plants as frames of the two
   *  SHARED authored tracks, and its conifers / UAT flowers / nameplate rooted at their own ground
   *  anchors. Absent ⇒ the pre-arc render, unchanged. */
  readonly vegetationLayer?: VegetationRenderLayer | null;
  readonly organicPoseLayers?: readonly OrganicPoseRenderLayer[] | null;
  readonly nativePropTargetLayer?: NativePropTargetRenderLayer | null;
}

export interface WorldPresentationModelInput {
  readonly scene: SceneNode;
  readonly selectedStoryId?: string | null;
  readonly emphasizedStoryIds?: readonly string[];
  readonly hiddenStatuses?: readonly string[];
  readonly arrivalIds?: readonly string[];
  readonly reveal?: TrailRevealPlan | null;
  readonly neighbours?: NeighbourHighlightPlan | null;
  readonly lanes?: LaneLayout | null;
  readonly laneMotion?: 'draw' | 'march' | 'none';
  readonly spriteSheet?: SpriteStyleSheet | null;
  readonly artScale?: number;
  readonly nativeIslandGrowthLayer?: NativeIslandGrowthRenderLayer | null;
  readonly svgIslandAccretionLayer?: SvgIslandAccretionState | null;
  readonly forestRegrowLayer?: ForestRegrowRenderLayer | null;
  readonly vegetationLayer?: VegetationRenderLayer | null;
  readonly organicPoseLayers?: readonly OrganicPoseRenderLayer[] | null;
  readonly nativePropTargetLayer?: NativePropTargetRenderLayer | null;
}

export interface WorldPresentationEvents {
  readonly onSelectStory?: (storyId: string) => void;
  readonly onSelectCapability?: (storyId: string, capabilityId: string) => void;
}

function sortedUnique<T extends string>(values: readonly T[] | undefined): readonly T[] {
  return [...new Set(values ?? [])].sort();
}

/** The WRITABLE draft of {@link WorldPresentationModel}'s five optional render layers. The model's
 *  own fields are `readonly`, so a layer that may or may not be present is collected here first and
 *  spread into the model literal; assignability at that spread is what keeps the two in step. */
interface WorldPresentationLayerDraft {
  nativeIslandGrowthLayer?: NativeIslandGrowthRenderLayer | null;
  svgIslandAccretionLayer?: SvgIslandAccretionState | null;
  forestRegrowLayer?: ForestRegrowRenderLayer | null;
  vegetationLayer?: VegetationRenderLayer | null;
  organicPoseLayers?: readonly OrganicPoseRenderLayer[] | null;
  nativePropTargetLayer?: NativePropTargetRenderLayer | null;
}

/** Normalize a plain presentation input without consulting time, stores, or live authority. */
export function normalizeWorldPresentationModel(
  input: WorldPresentationModelInput,
): WorldPresentationModel {
  // The five render layers are OPTIONAL and `readonly` on the model, so they are drafted in one
  // writable bag and assigned only when the input carries them — an absent layer stays ABSENT,
  // exactly as the conditional spreads this replaced. The bag is spread at the same textual
  // position those spreads held, so key insertion order is unchanged.
  const layers: WorldPresentationLayerDraft = {};
  if (input.nativeIslandGrowthLayer !== undefined) {
    layers.nativeIslandGrowthLayer = input.nativeIslandGrowthLayer;
  }
  if (input.svgIslandAccretionLayer !== undefined) {
    layers.svgIslandAccretionLayer = input.svgIslandAccretionLayer;
  }
  if (input.forestRegrowLayer !== undefined) {
    layers.forestRegrowLayer = input.forestRegrowLayer;
  }
  if (input.vegetationLayer !== undefined) {
    layers.vegetationLayer = input.vegetationLayer;
  }
  if (input.organicPoseLayers !== undefined) {
    layers.organicPoseLayers = input.organicPoseLayers;
  }
  if (input.nativePropTargetLayer !== undefined) {
    layers.nativePropTargetLayer = input.nativePropTargetLayer;
  }
  return {
    scene: input.scene,
    selectedStoryId: input.selectedStoryId ?? null,
    emphasizedStoryIds: sortedUnique(input.emphasizedStoryIds),
    hiddenStatuses: sortedUnique(input.hiddenStatuses),
    arrivalIds: sortedUnique(input.arrivalIds),
    reveal: input.reveal ?? null,
    neighbours: input.neighbours ?? null,
    lanes: input.lanes ?? null,
    laneMotion: input.laneMotion ?? 'draw',
    spriteSheet: input.spriteSheet ?? null,
    artScale: input.artScale ?? 1,
    ...layers,
  };
}

const NOOP_SELECT_STORY = (): void => {};
const NOOP_SELECT_CAPABILITY = (): void => {};

export function WorldSceneView({
  model,
  events,
}: {
  readonly model: WorldPresentationModel;
  readonly events?: WorldPresentationEvents;
}): React.JSX.Element {
  const ctx = React.useMemo<SceneCtx>(() => {
    const emphasized = new Set(model.emphasizedStoryIds);

    const next: SceneCtx = {
      territoryClassById: (id, status) => {
        const classes = ['hex-territory', `st-${status}`];
        if (id === model.selectedStoryId) classes.push('is-selected');
        // ADR-0242: the immediate neighbours ring their own shore, by direction — `is-upstream`
        // is a story the selection stands on, `is-downstream` one that stands on it. A story on
        // both sides of a cycle honestly wears both.
        if (model.neighbours?.upstream.has(id)) classes.push('is-upstream');
        if (model.neighbours?.downstream.has(id)) classes.push('is-downstream');
        if (emphasized.has(id)) classes.push('is-hub', 'is-emphasized');
        return classes.join(' ');
      },
      reveal: model.reveal,
      neighbours: model.neighbours,
      lanes: model.lanes,
      laneMotion: model.laneMotion,
      hidden: new Set(model.hiddenStatuses),
      arrivalIds: new Set(model.arrivalIds),
      onSelectStory: events?.onSelectStory ?? NOOP_SELECT_STORY,
      onSelectCap: events?.onSelectCapability ?? NOOP_SELECT_CAPABILITY,
      spriteSheet: model.spriteSheet,
      artScale: model.artScale,
    };
    if (model.nativeIslandGrowthLayer !== undefined) {
      next.nativeIslandGrowthLayer = model.nativeIslandGrowthLayer;
    }
    if (model.svgIslandAccretionLayer !== undefined) {
      next.svgIslandAccretionLayer = model.svgIslandAccretionLayer;
    }
    if (model.forestRegrowLayer !== undefined) {
      next.forestRegrowLayer = model.forestRegrowLayer;
    }
    if (model.vegetationLayer !== undefined) {
      next.vegetationLayer = model.vegetationLayer;
    }
    if (model.organicPoseLayers !== undefined) {
      next.organicPoseLayers = model.organicPoseLayers;
    }
    if (model.nativePropTargetLayer !== undefined) {
      next.nativePropTargetLayer = model.nativePropTargetLayer;
    }
    return next;
  }, [model, events]);

  return <SceneView scene={model.scene} ctx={ctx} />;
}
