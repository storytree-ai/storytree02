// true-footprint.ts — THE PER-ISLAND AFFINE SCALE: every descriptor moved about ITS OWN island's
// centre, with one rule per family.
//
// ⚠⚠ THE UN-PROJECTION THIS FILE WAS BORN FOR IS DELETED (ADR-0546, 2026-09-08). Read that first if
// you are here from an older comment. Between 2026-09-05 and 2026-09-08 this module also carried
// `restoreTrueFootprint` / `stretchAboutIslands`: the mapper received a 2D DRAWING already
// foreshortened at the declared land camera (`LAND_CAMERA_ELEVATION_DEG`, 20°, so a ground depth on
// the page is `sin 20°` = 0.342 of the real one) and un-squashed every island in place. The owner
// chose instead to have the 3D forest STAND ON TRUE GROUND — `worldTo3D` is handed a plan-view
// scene and un-projects nothing — so there is no drawing left to repair, and the repair went with
// it. The file name is the one it has always had; what survives it is the general operation the
// repair was one case of.
//
// WHAT SURVIVES, AND WHY IT IS WORTH A MODULE. `scaleAboutIslands` scales every descriptor about
// its own island's centre by that island's own `(x, z)` pair — the arithmetic is affine about a
// fixed centre, so an island's centre (the mean of its ring vertices) is INVARIANT under it and
// the inverse pair is its exact inverse. `land-per-capability.ts` is the live caller: an island's
// SIZE from a declared land-per-capability ratio is an ISOTROPIC factor that differs per island,
// and it reuses this rather than carrying a second copy of the two rules below.
//
// ⚠ THE WHOLE STREAM, NOT THE CELLS ALONE. The strips dock on the coast, the blooms carry an
// island's centre, a cave stands on the rim — scaling the cells and leaving the rest would put the
// docks in the water and the flowers off their islands. A descriptor that names its island scales
// about that island. A wisp follows the nearest island.
//
// ⚠⚠ A ROAD MOVES WITH AN ISLAND ONLY NEAR THAT ISLAND (lane AA, 2026-09-25). A strip belongs to no
// island, and on a real map it does not even run island to island: the router BUNDLES the network,
// so most strips run junction to junction out in open ground, far from any coast. The retired rule
// attached each END to its nearest island and blended along the strip, displacing a point by
// `(p − centre)·(s − 1)` — a displacement that GROWS with distance from the island. With every public
// island shrunk to 0.55–0.83 of its drawn size, a junction 300 units out was dragged up to a third
// of the way in, so the 3D roads left the routes the drawing (and the SVG's selection lanes, and the
// retired flat map) carries: the owner saw roads appear "only when you click on them", because the
// click lit the drawn route and the 3D road had been bent somewhere else. The rule now is a
// displacement FIELD — a function of position alone, summed over islands, {@link spanShift}:
//   · on or inside an island's drawn reach (its farthest rim vertex) a point moves exactly as the
//     island's own ground does, so a dock lands on the scaled coast;
//   · beyond it the move is the rim's own move on that ray, tapering linearly to ZERO across a band
//     one reach wide (wider for a large growth, so the radial map never folds);
//   · past the band a road is exactly where the drawing put it.
// Because it depends on position alone, two strips meeting at a junction move it identically, so
// the network stays joined without any per-strip bookkeeping.
//
// ⚠ A CAVE'S BEARING IS RE-DERIVED, NOT INHERITED. The bearing is the outward rim NORMAL in the
// ground plane; scale the plane and the rim's tangent turns, so the normal turns with it:
// `n' ∝ (cos b / sx, sin b / sz)`. A portal left at its drawn bearing would face a coast that is no
// longer there. Identity under any isotropic scale, which is the only scale shipped today.
//
// Pure: no React, no three — behind the provability firewall with `world-to-3d.ts`.

import type { Descriptor3D, InstanceDescriptor, Transform3D } from './world-to-3d.js';

/** A ground-plane centre — the mean of an island's ring vertices. */
export interface IslandCentre {
  x: number;
  z: number;
}

/** Each island's ground centre — the mean of its `cell-ground` ring vertices — keyed by island id.
 *  Islands with no ring vertices are absent rather than at the origin. */
export function islandCentres(descriptors: readonly Descriptor3D[]): Map<string, IslandCentre> {
  const sums = new Map<string, { x: number; z: number; n: number }>();
  for (const d of descriptors) {
    if (d.kind !== 'cell-ground' || d.island === undefined) continue;
    const acc = sums.get(d.island) ?? { x: 0, z: 0, n: 0 };
    for (const p of d.points ?? []) {
      acc.x += p.x;
      acc.z += p.z;
      acc.n += 1;
    }
    sums.set(d.island, acc);
  }
  const out = new Map<string, IslandCentre>();
  for (const [id, acc] of sums) if (acc.n > 0) out.set(id, { x: acc.x / acc.n, z: acc.z / acc.n });
  return out;
}

/** The centre nearest a ground point, or null when there are no islands at all. */
export function nearestCentre(centres: ReadonlyMap<string, IslandCentre>, x: number, z: number): IslandCentre | null {
  let best: IslandCentre | null = null;
  let bestDist = Infinity;
  for (const c of centres.values()) {
    const dist = Math.hypot(x - c.x, z - c.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  return best;
}

/** A per-island scale: the factor applied along x and along z about the island's centre. */
export interface IslandScale {
  x: number;
  z: number;
}

/** The cave bearing after the plane is scaled by `(sx, sz)`: the rim's TANGENT scales with the
 *  plane, so its NORMAL `(cos b, sin b)` becomes `(cos b / sx, sin b / sz)`, renormalised by
 *  `atan2`. Identity under any isotropic scale, and the z-stretch case above at `sx = 1`. */
export function scaledBearing(bearing: number, scale: IslandScale): number {
  return Math.atan2(Math.sin(bearing) / scale.z, Math.cos(bearing) / scale.x);
}

/** The families whose points are a ribbon between two islands rather than one island's own. */
const SPANNING: ReadonlySet<string> = new Set(['trail-strip', 'trail-ghost-strip']);


/**
 * THE GENERAL OPERATION: scale every descriptor about its island's centre by that island's own
 * `(x, z)` factors, y untouched. `scaleFor` is asked once per island centre and may answer a
 * different pair per island — which is what a per-island SIZE needs and a global stretch does not.
 * The per-family rules are the header's: a descriptor naming its island scales about it, a wisp
 * follows the nearest island, a ribbon moves by the position field {@link spanShift} (with an island
 * near its shore, not at all in open ground), and a cave's bearing turns with its rim. A stream with no islands is
 * returned as-is; skipped descriptors pass through untouched.
 */
export function scaleAboutIslands<T extends Descriptor3D>(
  descriptors: readonly T[],
  scaleFor: (island: string, centre: IslandCentre) => IslandScale,
): T[] {
  const centres = islandCentres(descriptors);
  if (centres.size === 0) return [...descriptors];
  const scales = new Map<string, IslandScale>();
  for (const [id, c] of centres) {
    const s = scaleFor(id, c);
    if (!Number.isFinite(s.x) || s.x <= 0 || !Number.isFinite(s.z) || s.z <= 0) {
      throw new Error(`true-footprint: island "${id}" was given a scale of (${s.x}, ${s.z}); both must be positive finite numbers`);
    }
    scales.set(id, s);
  }
  const reaches = islandReaches(descriptors, centres);
  const ownIsland = (d: InstanceDescriptor, at: Transform3D): [IslandCentre, IslandScale] => {
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — `Map.get(undefined)` is
    // `undefined` too; the guard is for the type, not for the value.
    const own = d.island === undefined ? undefined : centres.get(d.island);
    const id = own !== undefined ? (d.island as string) : nearestIsland(centres, at.x, at.z);
    return [centres.get(id) as IslandCentre, scales.get(id) as IslandScale];
  };
  return descriptors.map((d): T => {
    if (d.kind === 'skipped') return d;
    if (SPANNING.has(d.kind) && d.points !== undefined && d.points.length > 0) {
      return { ...d, ...scaleSpan(d, d.points, centres, scales, reaches) };
    }
    const [c, s] = ownIsland(d, d.transform);
    const about = (p: Transform3D): Transform3D => ({ ...p, x: c.x + (p.x - c.x) * s.x, z: c.z + (p.z - c.z) * s.z });
    const moved: InstanceDescriptor = { ...d, transform: about(d.transform) };
    if (d.points !== undefined) moved.points = d.points.map(about);
    if (d.bearing !== undefined) moved.bearing = scaledBearing(d.bearing, s);
    return moved as T;
  });
}

/** The id of the island whose centre is nearest a ground point. The caller holds `centres.size > 0`. */
function nearestIsland(centres: ReadonlyMap<string, IslandCentre>, x: number, z: number): string {
  // Every finite distance beats the initial Infinity, so the first island is the running best and
  // a tie keeps the FIRST — the same rule `nearestCentre` holds — with no placeholder id to return
  // by mistake.
  let best: string | undefined;
  let bestDist = Infinity;
  for (const [id, c] of centres) {
    const dist = Math.hypot(x - c.x, z - c.z);
    if (dist < bestDist) {
      bestDist = dist;
      best = id;
    }
  }
  return best as string;
}

/** A move on the ground plane: how far a point goes along x and along z. */
export interface GroundShift {
  dx: number;
  dz: number;
}

/** How far an island's own ground reaches from its centre — its farthest ring vertex — keyed by id.
 *  Read off the same cells {@link islandCentres} reads, so every centre has a reach. */
export function islandReaches(
  descriptors: readonly Descriptor3D[],
  centres: ReadonlyMap<string, IslandCentre>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const d of descriptors) {
    if (d.kind !== 'cell-ground') continue;
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — a cell with no island finds no
    // centre, and the guard below skips it just the same; this one narrows the type.
    if (d.island === undefined) continue;
    const c = centres.get(d.island);
    if (c === undefined) continue;
    let reach = out.get(d.island) ?? 0;
    for (const p of d.points ?? []) reach = Math.max(reach, Math.hypot(p.x - c.x, p.z - c.z));
    out.set(d.island, reach);
  }
  return out;
}

/**
 * THE ROAD DISPLACEMENT FIELD — how far a point on a road moves when every island is scaled about
 * its own centre. A function of POSITION ALONE (see the header), summed over islands:
 *
 *  - within an island's reach `R` (distance `r ≤ R`): `(p − c)·(s − 1)`, exactly the ground's move;
 *  - in the band `R < r < R + W`: the rim's move on the same ray, `(p − c)·(s − 1)·R/r`, scaled by
 *    `1 − (r − R)/W`, so it is continuous at both edges;
 *  - beyond `R + W`: nothing.
 *
 * `W` is `R·max(1, 2·|s − 1|)`: along a ray the moved radius is `r + (s − 1)·R·(1 − (r − R)/W)`,
 * whose slope `1 − (s − 1)·R/W` stays at or above ½ for any growth — no fold — and a shrink can
 * never fold it at all.
 */
export function spanShift(
  p: Pick<Transform3D, 'x' | 'z'>,
  centres: ReadonlyMap<string, IslandCentre>,
  scales: ReadonlyMap<string, IslandScale>,
  reaches: ReadonlyMap<string, number>,
): GroundShift {
  let dx = 0;
  let dz = 0;
  for (const [id, c] of centres) {
    const s = scales.get(id) as IslandScale;
    const reach = reaches.get(id) as number;
    const ox = p.x - c.x;
    const oz = p.z - c.z;
    const r = Math.hypot(ox, oz);
    let w: number;
    // Stryker disable next-line EqualityOperator: EQUIVALENT — the field is continuous at the rim:
    // at `r = reach` the band's weight `(reach / r)·(1 − 0)` is exactly 1 as well.
    if (r <= reach) w = 1;
    else {
      const band = reach * Math.max(1, 2 * Math.max(Math.abs(s.x - 1), Math.abs(s.z - 1)));
      // Stryker disable next-line EqualityOperator: EQUIVALENT — continuous at the band's outer edge:
      // at `r = reach + band` the weight `(reach / r)·(1 − 1)` is exactly 0 either way.
      if (r >= reach + band) continue;
      w = (reach / r) * (1 - (r - reach) / band);
    }
    dx += ox * (s.x - 1) * w;
    dz += oz * (s.z - 1) * w;
  }
  return { dx, dz };
}

/** A ribbon's displacement: every point moved by the position field {@link spanShift}; the anchor
 *  by the mean of the points' shifts. Returns the new transform and points. */
function scaleSpan(
  d: InstanceDescriptor,
  points: readonly Transform3D[],
  centres: ReadonlyMap<string, IslandCentre>,
  scales: ReadonlyMap<string, IslandScale>,
  reaches: ReadonlyMap<string, number>,
): Pick<InstanceDescriptor, 'transform' | 'points'> {
  const shifts = points.map((p) => spanShift(p, centres, scales, reaches));
  const moved = points.map((p, i) => ({ ...p, x: p.x + shifts[i]!.dx, z: p.z + shifts[i]!.dz }));
  const meanX = shifts.reduce((s, v) => s + v.dx, 0) / shifts.length;
  const meanZ = shifts.reduce((s, v) => s + v.dz, 0) / shifts.length;
  return { transform: { ...d.transform, x: d.transform.x + meanX, z: d.transform.z + meanZ }, points: moved };
}

