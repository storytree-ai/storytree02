import type { GroundInput } from './ground-dependency.js';
import {
  KIT_FOOTPRINTS_2026_08_29,
  KIT_HEIGHTS_2026_08_29,
  type KitPlacement,
} from './kit-vocabulary.js';

/** A semantic identity anchored to one eligible native prop placement. */
export interface NativePropHitRecord {
  readonly storyId: string;
  readonly capabilityId: string;
  readonly status: string;
  readonly root: Readonly<{ x: number; z: number }>;
  readonly relief: number;
  readonly footprint: number;
  readonly height: number;
}

function isEligiblePlacement(placement: KitPlacement): boolean {
  return (
    placement.role === 'tree' ||
    placement.role === 'deadTree' ||
    placement.role === 'coverageFlora'
  );
}

/**
 * Derives semantic hit targets without changing the canonical ground inputs they describe.
 */
export function deriveNativePropHitRecords(
  input: GroundInput,
  semanticByPlacement: ReadonlyMap<KitPlacement, string>,
): readonly NativePropHitRecord[] {
  const records: NativePropHitRecord[] = [];

  for (const placement of input.placements) {
    if (!isEligiblePlacement(placement)) continue;

    const storyId = input.islandByPlacement.get(placement);
    const status = semanticByPlacement.get(placement);
    if (storyId === undefined || status === undefined) continue;

    records.push(
      Object.freeze({
        storyId,
        capabilityId: placement.capId,
        status,
        root: Object.freeze({ ...placement.at }),
        relief: placement.y,
        footprint: KIT_FOOTPRINTS_2026_08_29[placement.role] * placement.scale,
        height: KIT_HEIGHTS_2026_08_29[placement.role] * placement.scale,
      }),
    );
  }

  return Object.freeze(records);
}
