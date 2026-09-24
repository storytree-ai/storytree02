import { groundFlattening, uprightForeshortening } from '@storytree/forest-world';

import type { NativePropHitRecord } from './native-prop-hit-records.js';

export interface NativePropHitEnvelope {
  readonly storyId: string;
  readonly capabilityId: string;
  readonly status: string;
  readonly root: Readonly<{ x: number; y: number }>;
  readonly crown: Readonly<{ x: number; y: number }>;
  readonly bounds: Readonly<{
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  }>;
}

/** Projects one immutable native prop record into drawing-world hit bounds. */
export function projectNativePropHitEnvelope(
  record: NativePropHitRecord,
  elevationDeg: number,
): NativePropHitEnvelope {
  const ground = groundFlattening(elevationDeg);
  const upright = uprightForeshortening(elevationDeg);
  const root = Object.freeze({
    x: record.root.x,
    y: record.root.z * ground - record.relief * upright,
  });
  const crown = Object.freeze({
    x: root.x,
    y: root.y - record.height * upright,
  });
  const halfPlanSpan = (Math.SQRT2 * record.footprint) / 2;

  return Object.freeze({
    storyId: record.storyId,
    capabilityId: record.capabilityId,
    status: record.status,
    root,
    crown,
    bounds: Object.freeze({
      minX: root.x - halfPlanSpan,
      maxX: root.x + halfPlanSpan,
      minY: Math.min(crown.y, root.y - halfPlanSpan * ground),
      maxY: Math.max(root.y, root.y + halfPlanSpan * ground),
    }),
  });
}
