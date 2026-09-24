import React from 'react';
import type { SceneNode } from '@storytree/forest-world';
import { SceneView, type ForestRegrowRenderLayer, type SceneCtx } from './SceneView.js';
import type { NeighbourHighlightPlan } from './neighbourHighlight.js';
import type { LaneLayout } from './laneLayout.js';
import type { NativePropTargetRenderLayer } from './native-prop-targets.js';

export interface WorldPresentationModel {
  readonly scene: SceneNode;
  readonly selectedStoryId: string | null;
  readonly emphasizedStoryIds: readonly string[];
  readonly hiddenStatuses: readonly string[];
  readonly arrivalIds: readonly string[];
  readonly neighbours: NeighbourHighlightPlan | null;
  readonly lanes: LaneLayout | null;
  readonly laneMotion: 'draw' | 'march' | 'none';
  readonly forestRegrowLayer?: ForestRegrowRenderLayer | null;
  readonly nativePropTargetLayer?: NativePropTargetRenderLayer | null;
}

export interface WorldPresentationModelInput {
  readonly scene: SceneNode;
  readonly selectedStoryId?: string | null;
  readonly emphasizedStoryIds?: readonly string[];
  readonly hiddenStatuses?: readonly string[];
  readonly arrivalIds?: readonly string[];
  readonly neighbours?: NeighbourHighlightPlan | null;
  readonly lanes?: LaneLayout | null;
  readonly laneMotion?: 'draw' | 'march' | 'none';
  readonly forestRegrowLayer?: ForestRegrowRenderLayer | null;
  readonly nativePropTargetLayer?: NativePropTargetRenderLayer | null;
}

export interface WorldPresentationEvents {
  readonly onSelectStory?: (storyId: string) => void;
  readonly onSelectCapability?: (storyId: string, capabilityId: string) => void;
}

function sortedUnique<T extends string>(values: readonly T[] | undefined): readonly T[] {
  return [...new Set(values ?? [])].sort();
}

/** The WRITABLE draft of {@link WorldPresentationModel}'s optional render layers. The model's own
 *  fields are `readonly`, so a layer that may or may not be present is collected here first and
 *  spread into the model literal; assignability at that spread is what keeps the two in step. */
interface WorldPresentationLayerDraft {
  forestRegrowLayer?: ForestRegrowRenderLayer | null;
  nativePropTargetLayer?: NativePropTargetRenderLayer | null;
}

/** Normalize a plain presentation input without consulting time, stores, or live authority. */
export function normalizeWorldPresentationModel(
  input: WorldPresentationModelInput,
): WorldPresentationModel {
  const layers: WorldPresentationLayerDraft = {};
  if (input.forestRegrowLayer !== undefined) {
    layers.forestRegrowLayer = input.forestRegrowLayer;
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
    neighbours: input.neighbours ?? null,
    lanes: input.lanes ?? null,
    laneMotion: input.laneMotion ?? 'draw',
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
        if (model.neighbours?.upstream.has(id)) classes.push('is-upstream');
        if (model.neighbours?.downstream.has(id)) classes.push('is-downstream');
        if (emphasized.has(id)) classes.push('is-hub', 'is-emphasized');
        return classes.join(' ');
      },
      neighbours: model.neighbours,
      lanes: model.lanes,
      laneMotion: model.laneMotion,
      hidden: new Set(model.hiddenStatuses),
      arrivalIds: new Set(model.arrivalIds),
      onSelectStory: events?.onSelectStory ?? NOOP_SELECT_STORY,
      onSelectCap: events?.onSelectCapability ?? NOOP_SELECT_CAPABILITY,
    };
    if (model.forestRegrowLayer !== undefined) {
      next.forestRegrowLayer = model.forestRegrowLayer;
    }
    if (model.nativePropTargetLayer !== undefined) {
      next.nativePropTargetLayer = model.nativePropTargetLayer;
    }
    return next;
  }, [model, events]);

  return <SceneView scene={model.scene} ctx={ctx} />;
}
