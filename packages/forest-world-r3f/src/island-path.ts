// island-path.ts — THE CANVAS-SIDE CONNECTOR: where the dependency trail crosses the land.
//
// ⚠⚠ ADR-0463 D1: the dependency trail crosses the land, and its on-land run IS the worn path.
// The shared 2D router is untouched — trails dock ON the coast and stop — so the crossing is made
// HERE, on the canvas side, from what the router already emits: a `trail-strip` ends within reach
// of an island's rim, that end is the trail's DOCK on that island, and the worn path is what joins
// the island's docks across its interior. Nothing here changes where a trail goes at sea; it only
// says where the walker went once ashore.
//
// ⚠ THE SHAPE IS THE RECIPE'S `path_polyline()` (`build_land.py:411-439`): coast -> interior ->
// coast, two landings, three interior control points pulled toward the island's centre, four
// Chaikin passes with the endpoints kept. The recipe hard-codes its landings at -160 and +25
// degrees and its control points as absolute offsets from the centroid; here the landings are
// wherever the trails actually dock, and the control points are DERIVED from each pair — points
// along the chord, pulled toward the centroid so the path bows through the interior, and jittered
// perpendicular to the chord by a per-island seed so the crossing is not a straight line.
//
// ⚠ EVERY POINT STAYS IN THE (x, z) BASIS THE CLIPPED CELLS USE — projected scene px, read as
// `(x, 0, z)`. Nothing here unprojects, and nothing here reads a descriptor's `transform`: the rim
// comes from the cells' rings and the docks from the strips' `points`, both already in that basis.
//
// ⚠ IT READS THE CLIPPED DESCRIPTORS, for the reason `shoreField` states at length: after
// `clipToCoast` the boundary of the mesh IS the coast, so a dock snapped onto the mesh's rim is a
// dock on the water's edge. Handed the pre-clip parcels the docks would sit on the hex silhouette,
// a beach's width inland of the sea, and the path would start in the sand rather than at it.

import { type CoastPoint, coastalIsland, rimLoops, vertexKey } from './coast-clip.js';
import { LAND_SCALE } from './land-per-capability.js';
import { SAND_SHIPPED_BEACH_WIDTH } from './land-sand.js';
import { indices } from './land-shadow.js';
import { bucketByIsland } from './shore-atlas.js';
import { buildSegmentGrid, nearestOnSegments, ringEdges, type EdgeGrid } from './shore-grid.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/**
 * HOW FAR FROM AN ISLAND'S RIM A STRIP ENDPOINT MAY SIT AND STILL COUNT AS THAT ISLAND'S DOCK,
 * in ground units — four times the shipped beach width, and since ADR-0596 it is a SANITY BOUND
 * rather than the thing that decides what a dock is.
 *
 * A strip docks on the 2D map's coast. The 3D ground ends on a coast built by the SAME machinery
 * (`coast-clip.ts` imports `smoothCoast` rather than transcribing it), but the clip is CAPPED so
 * no parcel crosses itself — and, more importantly, the shared router models each island as an
 * obstacle DISC and docks on THAT rim rather than on the lobed coast polygon. Both effects leave a
 * real landing sitting some way off the mesh rim, out to sea.
 *
 * ⚠ THE MULTIPLIER IS MEASURED NOW, NOT REASONED (ADR-0596). On the committed real-forest export
 * the 52 TERMINAL strip ends sit a median of 3.63 ground units off the nearest rim and reach 9.56
 * at worst; four beaches (13.57 at today's `LAND_SCALE`) clears that maximum by 42%. The previous
 * 1.5 was reasoned from the clip cap alone, and it silently fell to 5.09 when the beach was
 * rescaled by `LAND_SCALE` — refusing 12 of the 52 real landings and leaving 7 of 35 islands with
 * no path at all, with every test in this package green.
 *
 * ⚠ IT IS NO LONGER WHAT KEEPS A JUNCTION OUT, and that is why widening it is safe. The old
 * argument — that the reach is an order of magnitude under the gap between any two islands — still
 * holds for the wrong-ISLAND case, but on the real map the nearest routed JUNCTION sits 7.60 units
 * off a rim, INSIDE this reach. {@link islandDocks} excludes junctions structurally instead, so no
 * choice of reach can admit one.
 */
export const DOCK_REACH = 4 * SAND_SHIPPED_BEACH_WIDTH;

/** The recipe's own smoothing: four Chaikin passes, endpoints kept (`build_land.py:430-438`). */
export const PATH_CHAIKIN_PASSES = 4;

/**
 * HOW FAR EACH INTERIOR CONTROL POINT IS PULLED FROM THE CHORD TOWARD THE CENTROID, as a fraction
 * of the way there. The recipe's three control points sit within ~34 units of the centroid on a
 * 234-unit island whose landings are ~110 units from it — roughly 0.6 of the way in — and the
 * pull is what makes a path between two docks on the SAME side of an island bow through the
 * village rather than skirt the beach.
 */
export const PATH_PULL = 0.6;

/** The perpendicular jitter on each control point, in ground units — the recipe's own offsets
 *  are 6.5, -7.0 and 4.0 from a straight line through the island, so about this much. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const PATH_JITTER = 7 * LAND_SCALE;

/** Where the ONE-dock path's interior waypoint sits between the dock and the centroid. */
export const PATH_WAYPOINT_FRACTION = 0.5;

/** Chord fractions of the three interior control points — the recipe's coast -> interior -> coast
 *  has three between its two landings; quarter, half, three-quarters is the even spacing. */
export const PATH_CONTROL_FRACTIONS: readonly number[] = [0.25, 0.5, 0.75];

/** One island's coast, as the connector reads it: its rim loop(s) and their centroid. */
export interface IslandRim {
  island: string;
  loops: readonly (readonly CoastPoint[])[];
  centroid: CoastPoint;
}

/**
 * THE CENTROID THE RECIPE USES: the plain mean of the coast polygon's vertices
 * (`P[:, 0].mean(), P[:, 1].mean()` at `:414`), over every loop of the island. Not the area
 * centroid — a coast with more vertices on one side pulls it that way, which is what the recipe
 * did and what the paths were tuned against.
 */
export function rimCentroid(loops: readonly (readonly CoastPoint[])[]): CoastPoint {
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const loop of loops) {
    for (const p of loop) {
      sx += p.x;
      sz += p.z;
      n += 1;
    }
  }
  // A rimless island has no centroid to speak of; the origin is returned rather than NaN so a
  // later `atan2` still produces a number. No caller reaches it with a rim of zero vertices —
  // `islandRims` skips islands whose rings chain to no loop.
  if (n === 0) return { x: 0, z: 0 };
  return { x: sx / n, z: sz / n };
}

/**
 * EVERY ISLAND'S RIM, from the clipped cells — bucketed by island the way `shore-atlas.ts` does,
 * then chained to loops by `rimLoops` exactly as `shoreField` chains them. An island whose cells
 * bound no loop (fewer than three ring vertices anywhere) has no coast to dock on and is left out.
 */
export function islandRims(cells: readonly InstanceDescriptor[]): IslandRim[] {
  const out: IslandRim[] = [];
  for (const [island, own] of bucketByIsland(cells)) {
    const rings: CoastPoint[][] = [];
    for (const d of own) {
      if (coastalIsland(d) === null) continue;
      rings.push(d.points!.map((p) => ({ x: p.x, z: p.z })));
    }
    const loops = rimLoops(rings);
    if (loops.length === 0) continue;
    out.push({ island, loops, centroid: rimCentroid(loops) });
  }
  return out;
}

/** A strip's two ends, as ground points — the first and last of its `points`. One point when the
 *  strip is a single vertex, none when it carries no polyline at all. */
export function stripEndpoints(strip: InstanceDescriptor): CoastPoint[] {
  const pts = strip.points;
  if (pts === undefined || pts.length === 0) return [];
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  const ends: CoastPoint[] = [{ x: first.x, z: first.z }];
  if (pts.length > 1) ends.push({ x: last.x, z: last.z });
  return ends;
}

/** Is this descriptor a trail the connector should read? Only a VISIBLE `trail-strip`: the
 *  under-island ghost run is a different kind and is `hidden` besides, and a hidden strip that
 *  somehow arrived as the visible kind is still not a trail a walker took ashore. */
export function isDockableStrip(d: InstanceDescriptor): boolean {
  return d.kind === 'trail-strip' && d.hidden !== true;
}

/** The nearest island an end reaches and where on its rim it lands — ONE value, because the two
 *  are only ever known together (see the note inside {@link islandDocks}). */
interface NearestDock {
  island: string;
  dock: CoastPoint;
}

/** Where a strip's end lands on this island's rim, or `null` when it is out of reach. The snap
 *  is the nearest point of the rim, read back off the walk's own distance and gradient. */
export function dockOnRim(grid: EdgeGrid, end: CoastPoint, reach: number = DOCK_REACH): CoastPoint | null {
  const s = nearestOnSegments(grid, end.x, end.z, reach);
  // Capped means "at least `reach` away" — not this island's dock. Strict, because the cap
  // returns exactly `reach` and an end exactly that far off is not ashore.
  if (s.distance >= reach) return null;
  return { x: end.x - s.gx * s.distance, z: end.z - s.gz * s.distance };
}

/**
 * EACH ISLAND'S DOCKS: every visible strip end within {@link DOCK_REACH} of its rim, snapped onto
 * the rim's nearest point. Keyed by island id; every island with a rim is present, docks or not,
 * so a caller can tell "no trail reaches this island" from "this island was never looked at".
 *
 * ⚠ AN END IS ASSIGNED TO THE NEAREST ISLAND ONLY. Two islands within one reach of each other do
 * not occur on a map whose islands do not touch (the coast clip's own suite holds that), so this
 * is stated rather than relied on: a dock belongs to one shore.
 *
 * ⚠⚠ ONLY TERMINAL ENDS DOCK (ADR-0596 D1). A position shared by two or more visible strips is a
 * routed JUNCTION — where several edges funnel onto one trunk in open water — not a landing, and it
 * is excluded before the rim search whatever its distance. On the real map 51 of the 103 distinct
 * end positions are junctions, and they are NOT separable by distance: the furthest terminal end is
 * 9.56 units off a rim and the nearest junction 7.60. Coincidence uses `vertexKey` (a tenth of a
 * unit), the same quantisation the surviving docks are deduplicated by, so one rule of coincidence
 * serves both.
 *
 * ⚠ DOCKS ARE STILL DEDUPLICATED BY POSITION after that. Two terminal ends a hair apart are one
 * dock; left as two they would be "joined" by a path of zero length that the smoothing turns into a
 * knot.
 */
export function islandDocks(
  cells: readonly InstanceDescriptor[],
  strips: readonly InstanceDescriptor[],
): Map<string, CoastPoint[]> {
  const { docks } = discoverDocks(cells, strips);
  const out = new Map<string, CoastPoint[]>();
  for (const [island, found] of docks) out.set(island, [...found.values()]);
  return out;
}

/** The shared dock decision, including the accepted endpoint assignments the visible strip
 * projection consumes. Keeping that assignment here means the ribbon never makes a second,
 * subtly different decision about terminals, named rims, reach, or snapping. */
function discoverDocks(
  cells: readonly InstanceDescriptor[],
  strips: readonly InstanceDescriptor[],
) {
  const rims = islandRims(cells);
  const grids = rims.map(rimGrid);
  const docks = new Map<string, Map<string, CoastPoint>>();
  const assignments = new Map<InstanceDescriptor, Map<string, CoastPoint>>();
  for (const rim of rims) docks.set(rim.island, new Map());
  const ends = new Map<string, CoastPoint[]>();
  for (const strip of strips) {
    if (!isDockableStrip(strip)) continue;
    for (const end of stripEndpoints(strip)) {
      const key = vertexKey(end);
      ends.set(key, [...(ends.get(key) ?? []), end]);
    }
  }
  for (const strip of strips) {
    if (!isDockableStrip(strip)) continue;
    // A routed strip carries the dependency ids it represents. When it names islands, its
    // terminal may only land on one of those shores: proximity resolves a genuine choice, but
    // must not invent a path on an unrelated nearer island. Unnamed synthetic strips retain the
    // historical nearest-rim behaviour.
    // ⚠ `split` ALWAYS YIELDS DEFINED PARTS, so this destructures nothing and guards nothing —
    // written as a flat spread rather than `[from, to]` plus two `!== undefined` checks, which
    // `check:mutation-diff` correctly reported as two survivors that no input can kill.
    const namedIslands = new Set((strip.edges ?? []).flatMap((edge) => edge.split('->')));
    for (const end of stripEndpoints(strip)) {
      if (ends.get(vertexKey(end))!.length !== 1) continue;
      // ⚠ ONE `nearest`, NOT A SEPARATE island AND dock. They were two nullables, assigned only
      // ever together, and `check:mutation-diff` reported the second null check as three
      // survivors — `||` to `&&`, and either side to `false` — every one of them EQUIVALENT,
      // because the state they would have told apart (one set, the other null) is one no input
      // can produce. Collapsed to a single value so that state is unrepresentable rather than
      // merely unreached; the one remaining null check is the out-of-reach case, which the
      // "docks nowhere" test observes.
      let nearest: NearestDock | null = null;
      let best = Infinity;
      for (const i of indices(rims.length)) {
        if (namedIslands.size > 0 && !namedIslands.has(rims[i]!.island)) continue;
        const dock = dockOnRim(grids[i]!, end);
        if (dock === null) continue;
        const d = Math.hypot(dock.x - end.x, dock.z - end.z);
        if (d >= best) continue;
        best = d;
        nearest = { island: rims[i]!.island, dock };
      }
      if (nearest === null) continue;
      const found = docks.get(nearest.island)!;
      // First arrival keeps the landing; a later end a hair away is the same dock.
      if (!found.has(vertexKey(nearest.dock))) found.set(vertexKey(nearest.dock), nearest.dock);
      const assigned = assignments.get(strip) ?? new Map<string, CoastPoint>();
      assigned.set(vertexKey(end), nearest.dock);
      assignments.set(strip, assigned);
    }
  }
  return { docks, assignments };
}

/**
 * THE RENDERED TRAILS' SHORE DOCKS. Each accepted terminal is replaced with the same snapped
 * position the worn path consumes; the input descriptor stream stays untouched.
 */
export function dockedTrailStrips(
  cells: readonly InstanceDescriptor[],
  strips: readonly InstanceDescriptor[],
): readonly InstanceDescriptor[] {
  const { assignments } = discoverDocks(cells, strips);
  return strips.map((strip) => {
    const assigned = assignments.get(strip);
    if (assigned === undefined) return strip;
    // Assignments are created only while visiting stripEndpoints: absent or empty points emit
    // no endpoint and cannot reach here. Extra points guards were equivalent mutation survivors.
    const points = strip.points!;
    const last = points.length - 1;
    return {
      ...strip,
      points: points.map((point, index) => {
        if (index !== 0 && index !== last) return point;
        const dock = assigned.get(vertexKey({ x: point.x, z: point.z }));
        return dock === undefined ? point : { ...point, x: dock.x, z: dock.z };
      }),
    };
  });
}

/** The segment index over one island's rim, at dock reach — so the far-field short-circuit's
 *  proof holds for the dock query exactly as it does for the shore's. */
export function rimGrid(rim: IslandRim): EdgeGrid {
  return buildSegmentGrid(ringEdges(rim.loops), DOCK_REACH);
}

/**
 * THE WORN PATHS OF EVERY ISLAND — what `wearField` is built from.
 *
 *  - no docks  -> no path. An island no trail reaches has nobody walking across it.
 *  - one dock  -> ONE path, dock -> interior waypoint -> centroid: the way into the village.
 *  - two+ docks -> the docks ordered by bearing from the centroid, and each CONSECUTIVE pair
 *                  joined coast -> interior -> coast through three control points pulled toward
 *                  the centroid — the recipe's `path_polyline` shape — so a walker who came
 *                  ashore anywhere can reach any other landing without a straight chord.
 *
 * Every path is Chaikin-smoothed {@link PATH_CHAIKIN_PASSES} times with its endpoints kept, so
 * each starts exactly on a dock and ends exactly on a dock or the centroid.
 *
 * ⚠ DETERMINISTIC. The only randomness is the control-point jitter, seeded from the island's id
 * ({@link islandSeed}), so two builds of one map wear the same path and a committed picture is a
 * picture of the map rather than of one particular shuffle.
 */
export function islandPaths(
  cells: readonly InstanceDescriptor[],
  strips: readonly InstanceDescriptor[],
): Map<string, CoastPoint[][]> {
  const centroids = new Map<string, CoastPoint>();
  for (const rim of islandRims(cells)) centroids.set(rim.island, rim.centroid);
  const out = new Map<string, CoastPoint[][]>();
  for (const [island, docks] of islandDocks(cells, strips)) {
    out.set(island, pathsBetween(docks, centroids.get(island)!, islandSeed(island)));
  }
  return out;
}

/** The paths one island's docks imply — {@link islandPaths}'s per-island rule, exported so the
 *  three shapes can be asserted on a bare dock list. */
export function pathsBetween(docks: readonly CoastPoint[], centroid: CoastPoint, seed: number): CoastPoint[][] {
  // ⚠ DELIBERATELY NO EMPTY-DOCKS GUARD. One was written and `check:mutation-diff` reported it as
  // a survivor, which is what dead code looks like from outside: with no docks the sort below is
  // empty, `indices(-1)` is empty, the crossings loop runs zero times, and the empty list falls
  // out — exactly what the guard returned. The test pins the empty case, so the behaviour stays
  // without the branch (the same finding, and the same remedy, as `buildSegmentGrid`'s).
  if (docks.length === 1) {
    const dock = docks[0]!;
    return [chaikinOpen([dock, waypointToward(dock, centroid, seed), centroid], PATH_CHAIKIN_PASSES)];
  }
  const ordered = [...docks].sort(byBearingFrom(centroid));
  const paths: CoastPoint[][] = [];
  for (const k of indices(ordered.length - 1)) {
    const a = ordered[k]!;
    const b = ordered[k + 1]!;
    paths.push(chaikinOpen([a, ...crossingControls(a, b, centroid, seed, k), b], PATH_CHAIKIN_PASSES));
  }
  return paths;
}

/** The single-dock path's interior point: partway from the dock to the centroid, nudged sideways
 *  by the seed so the way in is not a radial line. */
export function waypointToward(dock: CoastPoint, centroid: CoastPoint, seed: number): CoastPoint {
  const mx = dock.x + (centroid.x - dock.x) * PATH_WAYPOINT_FRACTION;
  const mz = dock.z + (centroid.z - dock.z) * PATH_WAYPOINT_FRACTION;
  const n = perpendicularUnit(dock, centroid);
  const j = PATH_JITTER * seededUnit(seed, 0);
  return { x: mx + n.x * j, z: mz + n.z * j };
}

/**
 * THE THREE INTERIOR CONTROL POINTS of a crossing from dock `a` to dock `b`: points along the
 * chord at {@link PATH_CONTROL_FRACTIONS}, each pulled {@link PATH_PULL} of the way toward the
 * centroid and then jittered {@link PATH_JITTER} units at most across the chord. `pair` keys the
 * jitter so two crossings on one island do not share a shape.
 */
export function crossingControls(
  a: CoastPoint,
  b: CoastPoint,
  centroid: CoastPoint,
  seed: number,
  pair: number,
): CoastPoint[] {
  const n = perpendicularUnit(a, b);
  const out: CoastPoint[] = [];
  for (const k of indices(PATH_CONTROL_FRACTIONS.length)) {
    const j = PATH_JITTER * seededUnit(seed, pair * PATH_CONTROL_FRACTIONS.length + k);
    out.push(controlPoint(a, b, centroid, PATH_CONTROL_FRACTIONS[k]!, n, j));
  }
  return out;
}

/** One control point: the chord point at fraction `f`, pulled {@link PATH_PULL} toward the
 *  centroid, then moved `jitter` units along the chord's perpendicular `n`. Named rather than an
 *  inline callback so each arithmetic step is a value a test can assert directly. */
export function controlPoint(
  a: CoastPoint,
  b: CoastPoint,
  centroid: CoastPoint,
  f: number,
  n: CoastPoint,
  jitter: number,
): CoastPoint {
  const mx = a.x + (b.x - a.x) * f;
  const mz = a.z + (b.z - a.z) * f;
  const px = mx + (centroid.x - mx) * PATH_PULL;
  const pz = mz + (centroid.z - mz) * PATH_PULL;
  return { x: px + n.x * jitter, z: pz + n.z * jitter };
}

/** The unit vector across the line from `a` to `b` — zero when the two coincide, so a degenerate
 *  chord takes no jitter rather than a NaN. */
export function perpendicularUnit(a: CoastPoint, b: CoastPoint): CoastPoint {
  const ex = b.x - a.x;
  const ez = b.z - a.z;
  const len = Math.hypot(ex, ez);
  if (len === 0) return { x: 0, z: 0 };
  return { x: -ez / len, z: ex / len };
}

/** Order points by their bearing from a centre — `atan2(dz, dx)`, ascending. Named rather than an
 *  inline arrow so the comparison is a value a test can assert directly. */
export function byBearingFrom(centre: CoastPoint): (a: CoastPoint, b: CoastPoint) => number {
  return (a, b) => bearingFrom(centre, a) - bearingFrom(centre, b);
}

/** The bearing of `p` from `centre`, in radians in (-pi, pi] — the recipe's `arctan2(dy, dx)`. */
export function bearingFrom(centre: CoastPoint, p: CoastPoint): number {
  return Math.atan2(p.z - centre.z, p.x - centre.x);
}

/**
 * CHAIKIN'S CORNER CUT ON AN OPEN POLYLINE, endpoints kept — the recipe's own loop at
 * `build_land.py:430-438`, verbatim in shape: each pass keeps the first point, replaces every
 * segment by its 1/4 and 3/4 points, and keeps the last. An `n`-point line becomes `2n` points
 * per pass, so five control points are eighty after four.
 */
export function chaikinOpen(points: readonly CoastPoint[], passes: number): CoastPoint[] {
  let pts: CoastPoint[] = [...points];
  for (const _pass of indices(passes)) {
    if (pts.length < 2) return pts;
    const next: CoastPoint[] = [pts[0]!];
    for (const i of indices(pts.length - 1)) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(pts[pts.length - 1]!);
    pts = next;
  }
  return pts;
}

/** A 32-bit seed from an island id — FNV-1a over its code points. The same id always yields the
 *  same seed, which is all the jitter needs; it is not a hash anything else reads. */
export function islandSeed(id: string): number {
  let h = 0x811c9dc5;
  for (const ch of id) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The `k`th value in [-1, 1) drawn from a seed — a one-round integer mix, so successive `k` are
 *  uncorrelated rather than a drifting sequence. */
export function seededUnit(seed: number, k: number): number {
  let x = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b) >>> 0;
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35) >>> 0;
  x ^= x >>> 16;
  return (x >>> 0) / 2147483648 - 1;
}
