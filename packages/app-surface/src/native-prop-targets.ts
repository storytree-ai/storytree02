// native-prop-targets.ts — the native (3D) plants' click targets, as the host map's own SVG marks.
//
// ⚠ ONE PICKING AUTHORITY. The mounted 3D canvas is inert; it hands the host a list of projected
// envelopes and nothing else. This module turns that list into rects in the host's own `world`
// group, stamped with the same `data-story-id` / `data-cap-id` the host's coordinate hit-test reads,
// so a click on a 3D crown selects its capability through the route every other mark already uses.
//
// ⚠ THE EXISTING GROWTH VISIBILITY, NOT A SECOND ONE. While the forest regrows, a story the regrow
// has not reached draws no island, no flora and no hit area (`ForestRegrowRenderLayer.hiddenStoryIds`)
// — so it gets no native target either. The legend's hidden statuses do NOT remove a target; they
// mark it `is-filtered`, exactly as they mark a filtered SVG plant.

/** One native plant's hit envelope in SCENE-ROOT drawing coordinates (the host camera's space). */
export interface NativePropTarget {
  readonly storyId: string;
  readonly capabilityId: string;
  readonly status: string;
  readonly bounds: Readonly<{ minX: number; maxX: number; minY: number; maxY: number }>;
}

/**
 * The layer the host hands the scene walk. `origin` is the scene's own `world` translation: the
 * envelopes are in scene-root space, and the walk renders them INSIDE that translated group, so
 * each rect is shifted back by it once.
 */
export interface NativePropTargetRenderLayer {
  readonly origin: Readonly<{ x: number; y: number }>;
  /** Back to front — the order the canvas supplied, which is the order they must paint. */
  readonly targets: readonly NativePropTarget[];
}

/** One target as the walk draws it, in the `world` group's local space. */
export interface NativePropTargetRect {
  readonly key: string;
  readonly storyId: string;
  readonly capabilityId: string;
  readonly className: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The rects to draw, in paint order, honouring the regrow's hidden stories and the legend. */
export function nativePropTargetRects(
  layer: NativePropTargetRenderLayer,
  visibility: {
    readonly hiddenStoryIds: ReadonlySet<string> | null;
    readonly hiddenStatuses: ReadonlySet<string>;
  },
): readonly NativePropTargetRect[] {
  const rects: NativePropTargetRect[] = [];
  layer.targets.forEach((target, index) => {
    if (visibility.hiddenStoryIds?.has(target.storyId) === true) return;
    const filtered = visibility.hiddenStatuses.has(target.status) ? ' is-filtered' : '';
    rects.push({
      key: `${target.storyId}::${target.capabilityId}::${index}`,
      storyId: target.storyId,
      capabilityId: target.capabilityId,
      className: `native-prop-target st-${target.status}${filtered}`,
      x: target.bounds.minX - layer.origin.x,
      y: target.bounds.minY - layer.origin.y,
      width: target.bounds.maxX - target.bounds.minX,
      height: target.bounds.maxY - target.bounds.minY,
    });
  });
  return rects;
}
