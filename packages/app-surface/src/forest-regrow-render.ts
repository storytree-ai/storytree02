// forest-regrow-render — turn a `ForestRegrowState` into the render layer the scene walk reads.
//
// Split from `forest-regrow.ts` on purpose: that module is the ORDER and the CLOCK; this one is the
// bridge to the SVG interaction layer. Since ADR-0608 the 3D layer draws the growth itself — the
// islands forming, the roads travelling — on the same app-owned cursor, so all this layer needs is
// which islands and roads have not arrived yet: their nameplates, hit regions and lanes are withheld
// until they do. (The flat island accretion and the per-segment road draw-on masks that used to be
// derived here were retired with the flat picture.)

import type { ForestRegrowRenderLayer } from './SceneView.js';
import type { ForestRegrowState } from './forest-regrow.js';

/**
 * A cheap signature of everything {@link forestRegrowRenderLayer} would put in the layer, so the
 * caller can hold ONE layer object across frames that would paint an identical picture (a forest-map
 * frame's cost is rasterisation, ADR-0272, and an unchanged layer is what keeps `SceneView`'s memo
 * bail-out intact).
 *
 * The two hidden sets are summarised by SIZE, which is exact here rather than a shortcut: within one
 * plan both sets shrink monotonically as the cursor advances (an island or a road that has appeared
 * never disappears), so for a given plan the size determines the set.
 */
export function forestRegrowLayerSignature(state: ForestRegrowState): string {
  return `${state.absentStoryIds.size}|${state.hiddenSegmentIds.size}`;
}

/** The absence sets the scene walk reads for one cursor state. */
export function forestRegrowRenderLayer(state: ForestRegrowState): ForestRegrowRenderLayer {
  return {
    hiddenStoryIds: state.absentStoryIds,
    hiddenSegmentIds: state.hiddenSegmentIds,
  };
}
