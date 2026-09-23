/**
 * Renderer-facing view of the app-owned forest regrow cursor.  This module deliberately has no
 * clock: it only projects the cursor chosen by the application into the values drawing consumes.
 */
export interface ForestRegrowCursor {
  readonly progress: number;
  readonly settled: boolean;
  readonly absentStoryIds: ReadonlySet<string>;
  readonly growing: readonly ForestRegrowIslandGrowth[];
  readonly hiddenSegmentIds: ReadonlySet<string>;
  readonly drawingSegments: readonly ForestRegrowSegmentGrowth[];
}

export interface ForestRegrowIslandGrowth {
  readonly storyId: string;
  readonly progress: number;
}

export interface ForestRegrowSegmentGrowth {
  readonly id: string;
  readonly drawn: number;
  readonly fromEnd: boolean;
}

export interface ForestRegrowPresentation {
  readonly progress: number;
  readonly hiddenIslandIds: ReadonlySet<string>;
  readonly growingIslandProgressById: ReadonlyMap<string, number>;
  readonly hiddenSegmentIds: ReadonlySet<string>;
  readonly drawingSegmentProgressById: ReadonlyMap<string, {
    readonly drawn: number;
    readonly fromEnd: boolean;
  }>;
}

/** Project one non-terminal app cursor into renderer presentation without advancing it. */
export function forestRegrowPresentation(cursor: ForestRegrowCursor | null): ForestRegrowPresentation | null {
  if (cursor === null || cursor.settled) return null;

  return {
    progress: cursor.progress,
    hiddenIslandIds: cursor.absentStoryIds,
    growingIslandProgressById: new Map(cursor.growing.map(({ storyId, progress }) => [storyId, progress])),
    hiddenSegmentIds: cursor.hiddenSegmentIds,
    drawingSegmentProgressById: new Map(
      cursor.drawingSegments.map(({ id, drawn, fromEnd }) => [id, { drawn, fromEnd }]),
    ),
  };
}
