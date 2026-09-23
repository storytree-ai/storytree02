import type { ForestRegrowPresentation, ForestRegrowSegmentGrowth } from './ForestWorldCanvas.regrow.js';
import type { InstanceDescriptor, Transform3D } from './world-to-3d.js';

export interface IslandGrowthLayout {
  readonly islandId: string;
  readonly slot: number;
  readonly anchor: Transform3D;
}

interface IslandBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y: number;
}

/** Derive stable, per-island growth anchors from the ground vertices themselves. */
export function islandGrowthLayout(cells: readonly InstanceDescriptor[]): ReadonlyMap<string, IslandGrowthLayout> {
  const boundsByIsland = new Map<string, IslandBounds>();

  for (const cell of cells) {
    if (cell.kind !== 'cell-ground' || cell.island === undefined || cell.points === undefined) continue;

    for (const point of cell.points) {
      const existing = boundsByIsland.get(cell.island);
      if (existing === undefined) {
        boundsByIsland.set(cell.island, {
          minX: point.x,
          maxX: point.x,
          minZ: point.z,
          maxZ: point.z,
          y: point.y,
        });
      } else {
        existing.minX = Math.min(existing.minX, point.x);
        existing.maxX = Math.max(existing.maxX, point.x);
        existing.minZ = Math.min(existing.minZ, point.z);
        existing.maxZ = Math.max(existing.maxZ, point.z);
      }
    }
  }

  const layout = new Map<string, IslandGrowthLayout>();
  for (const [slot, islandId] of [...boundsByIsland.keys()].sort().entries()) {
    const bounds = boundsByIsland.get(islandId)!;
    layout.set(islandId, {
      islandId,
      slot,
      anchor: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: bounds.y,
        z: (bounds.minZ + bounds.maxZ) / 2,
      },
    });
  }
  return layout;
}

/** Project app-owned regrowth state without introducing a renderer clock. */
export function islandGrowthProgress(
  layout: IslandGrowthLayout,
  presentation: ForestRegrowPresentation | null,
): number {
  if (presentation === null) return 1;
  if (presentation.hiddenIslandIds.has(layout.islandId)) return 0;
  return presentation.growingIslandProgressById.get(layout.islandId) ?? 1;
}

function distance(left: Transform3D, right: Transform3D): number {
  return Math.hypot(right.x - left.x, right.y - left.y, right.z - left.z);
}

function prefixAt(points: readonly Transform3D[], fraction: number): readonly Transform3D[] {
  const total = points.slice(1).reduce((sum, point, index) => sum + distance(points[index]!, point), 0);
  if (total === 0) return [points[0]!];

  const target = fraction * total;
  const result: Transform3D[] = [points[0]!];
  let travelled = 0;
  for (const [offset, end] of points.slice(1).entries()) {
    const start = points[offset]!;
    const length = distance(start, end);
    if (travelled + length >= target) {
      if (travelled + length === target) result.push(end);
      else {
        const ratio = (target - travelled) / length;
        result.push({
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio,
          z: start.z + (end.z - start.z) * ratio,
        });
      }
      return result;
    }
    result.push(end);
    travelled += length;
  }
  return result;
}

/** Clip a real trail strip to the physical front represented by the app cursor. */
export function regrowTrailPoints(
  strip: InstanceDescriptor,
  presentation: ForestRegrowPresentation | null,
): readonly Transform3D[] | undefined {
  const points = strip.points;
  if (presentation === null || points === undefined) return points;
  // A readonly lookup can accept a missing key: the source collections contain only string IDs,
  // so undefined naturally misses. Widen only the lookup domain, without copying or mutating data.
  const hidden: ReadonlySet<string | undefined> = presentation.hiddenSegmentIds;
  const fronts: ReadonlyMap<string | undefined, Pick<ForestRegrowSegmentGrowth, 'drawn' | 'fromEnd'>> =
    presentation.drawingSegmentProgressById;
  if (hidden.has(strip.segment)) return [];

  const drawing = fronts.get(strip.segment);
  if (drawing === undefined || drawing.drawn >= 1) return points;
  if (drawing.drawn <= 0) return [];
  if (!drawing.fromEnd) return prefixAt(points, drawing.drawn);

  return [...prefixAt([...points].reverse(), drawing.drawn)].reverse();
}
