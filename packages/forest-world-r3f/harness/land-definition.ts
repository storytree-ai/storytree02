// land-definition.ts — the LAND's own interior definition: a continuous ground relief
// field, and the classification that says which cell edges are worth drawing.
// Pure, browser-free, node:test-provable.
//
// WHY THIS EXISTS. The 2026-08-19 island render was the first BARE island this arc had
// ever drawn, and it showed something no dressed render could: the land is a SINGLE FLAT
// GREEN FIELD. No seams, no variation, no texture. That is not a bug — it is what three
// separately-correct owner directives COMPOSE to (flat green ground, mesh seams removed,
// one surface rather than three hash-picked variants). The consequence is the problem:
// every scrap of the island's visual interest then rests on vegetation marks a handful of
// pixels across, which is very likely why four vegetation passes in a row failed to
// satisfy. The vegetation was being asked to do the land's job as well as its own.
//
// THE FENCE THIS WORKS INSIDE, AND IT IS THE WHOLE DESIGN CONSTRAINT. Two specific
// treatments are REFUSED, both rejected by the owner looking at them (2026-08-16): the
// per-cell mesh seam, and the three hash-picked colour variants. The stated reason is the
// one that generalises — "in 3d its very noisy and doesnt make space for shadows which is
// one of the bigger wins of going 3d". So the test a treatment has to pass is not "is
// there more detail" but "does this make ROOM for shadow, or compete with it".
//
// That test is what picks everything below. Both mechanisms here are LIGHTING operations
// on geometry the land already has — a surface normal that varies, and an edge that turns
// down. Neither paints a mark; neither introduces a frequency of its own. A shadow landing
// on this land darkens the same rungs by the same ladder, so it composes with what is here
// instead of fighting a second pattern for the same pixels.
//
// THE PALETTE IS UNTOUCHED BY CONSTRUCTION, WHICH IS WHY THIS IS SAFE TO DO AT ALL. This
// module moves POSITIONS and NORMALS and never names a colour. The banded material still
// emits `token * bandShade(lambert)` and nothing else, so every pixel this makes possible
// was already an authored `(token x level)` entry. Relief is FREE in palette terms on the
// live path — which is emphatically NOT true of the author-time compositor path, where
// PR #1389 bought micro-relief for +619 palette entries. Those are two different renderers
// with two different closure arguments, and the amplitude/palette curve for the compositor
// is still owed by `ground-displacement-amplitude-swept-for-land-texture`. Nothing here
// prices that; nothing here should be read as having priced it.
//
// SEMANTICS DO NOT MOVE (ADR-0367 D5). The relief field is a function of POSITION ONLY —
// not of status, not of test count, not of capability identity — so it asserts nothing
// about any unit's proof state. The parcel bevel draws a boundary that the scene graph
// already carries (`kind: 'parcel'`, the hover/delegation hook) and that the island already
// asserts with colour whenever two neighbouring capabilities differ in status. Making an
// existing boundary legible is not a new assertion.

/** A ground point, in ground space (x east, y south — the caller maps y to 3D z). */
export interface GroundPoint {
  x: number;
  y: number;
}

// ---------------------------------------------------------------------------
// 1. THE RELIEF FIELD — ADOPTED, AND NOW LIVES IN `src/`
// ---------------------------------------------------------------------------
//
// ⚠ IT MOVED RATHER THAN BEING COPIED, and this re-export is what keeps that true. The
// relief field crossed onto the SHIPPED side on 2026-08-30 (`src/land-relief.ts`), because
// the owner authorised adoption on 2026-08-29 — "This looks better, stamp it". Every symbol
// below is the same function object the shipped canvas draws with, so the harness and the
// product can no longer disagree about what the land's shape is. Twenty-odd harness modules
// import these from here and none of them had to change.
//
// The reasoning that used to live here — why three sine waves, why none may go below the
// 16.5-unit mean cell pitch, why the field is continuous, why the normal is analytic and
// per-vertex — moved with the code and is in `src/land-relief.ts`.
export {
  LAND_RELIEF_AMPLITUDE,
  landGradient,
  landHeight,
  landHeightRange,
  landNormal,
  type LandGradientResult,
  type LandNormalResult,
} from '../src/land-relief.js';


// ---------------------------------------------------------------------------
// 2. THE EDGE CLASSIFICATION — which seams are worth drawing at all
// ---------------------------------------------------------------------------
//
// THE PARCEL BOUNDARY IS THE ONE EDGE THAT CARRIES INFORMATION. A seam between two cells
// of the SAME capability asserts nothing at all: it is an artefact of how the substrate
// happened to decompose a hex, and drawing it was the noise the owner removed. A boundary
// between two DIFFERENT capabilities is real structure the island already owns and, on an
// all-healthy island, currently draws invisibly — every neighbour agrees, so the colour
// that would distinguish them is the same colour.
//
// So definition goes THERE and nowhere else. That is the difference between definition and
// noise, stated as geometry rather than as taste.

/** What a cell edge is, and therefore whether it gets drawn. */
export type EdgeRole =
  /** Shared with another cell of the SAME parcel. Asserts nothing; drawn as nothing. */
  | 'interior'
  /** Shared with a cell of a DIFFERENT parcel. The boundary that carries information. */
  | 'parcel'
  /** Shared with no cell at all — the island's outer edge. */
  | 'rim';

/**
 * THE RIM IS BEVELLED TOO, AND THAT IS A CONSTRUCTION REQUIREMENT RATHER THAN AN ART
 * CHOICE — worth stating, because it looks like scope creep and is not.
 *
 * A parcel's boundary is a closed loop, and where a parcel reaches the island's outer edge
 * that loop runs along the rim. Insetting only the `parcel` stretch of the loop would leave
 * the top face insetted on one side of a corner and not the other, opening a wedge-shaped
 * hole exactly where a capability meets the shore. Bevelling the whole loop keeps the
 * corner mitred and the surface closed.
 *
 * What falls out of it is that the island's outer edge gains a 1.6-unit chamfer above the
 * existing wall skirt, so the land rounds over into its own cliff instead of ending in a
 * knife edge. That is an improvement, and it is deliberately NOT a coast: the coast/rim
 * SHELL is `blender-island-shell-render`'s to design, and nothing here draws one, prices
 * one, or forecloses one.
 */
export const RIM_IS_BEVELLED_FOR_CLOSURE = true;

/** The minimum a cell needs for this module to place it. Structurally a subset of
 *  `GroundCell`, declared here so the pure half never has to import the descriptor
 *  module's SVG-extraction machinery to be tested. */
export interface PlaceableCell {
  points: GroundPoint[];
  /** The owning capability's id, when the scene wrapped the cell in a `parcel` group. */
  parcel?: string | undefined;
}

/**
 * The bevel's horizontal width, in ground units.
 *
 * PICKED AGAINST THE DELIVERED SIZE, WHICH IS THE ONLY SIZE THAT COUNTS (ADR-0392 D3 item
 * 7). The island delivers at 2 px per ground unit, so 1.6 units is about 3 px across the
 * east-west axis and about 2.5 px north-south after the 50-degree camera foreshortens it.
 * Below roughly 1 unit the bevel stops resolving and becomes an aliasing shimmer; much
 * above 2 it stops reading as an edge and starts reading as a slope, which would put a
 * second pattern at the same scale as the relief and set the two competing.
 */
export const PARCEL_BEVEL_WIDTH = 1.6;

/**
 * How far the bevel turns DOWN over that width, in ground units.
 *
 * 1.15 over 1.6 is a 36-degree face. That is deliberately steep enough to leave the flat
 * ground's rung: tilted toward the light it clears the ~9 degrees that reaches rung 1.0,
 * and tilted away it clears the ~11 degrees that reaches rung 0.8. So the two sides of a
 * boundary read as a lit face and a shaded face — a groove, in the same lighting language
 * as everything else here, rather than a drawn line. A shallower bevel quantises back onto
 * the ground's own rung and delivers exactly nothing, which is the failure mode worth
 * naming: an invisible treatment costs the same to build as a visible one.
 */
export const PARCEL_BEVEL_DROP = 1.15;

/** How far a bevel may eat into a cell before the cell is judged too small to carry one:
 *  the inset polygon must keep this fraction of its original area, and its orientation. */
const MIN_INSET_AREA_FRACTION = 0.35;

/** Cell walls: how far the island's rim is extruded downward, in ground units. Small — the
 *  land is a relaxed mesh of flat parcels, not a stack of blocks (ADR-0367 D5's interior
 *  fork settled on flat per-cell fills plus rim pieces). Authored, and unchanged by this
 *  work: the island's thickness is the coast increment's to revisit. */
export const LAND_CELL_DEPTH = 2.2;

/**
 * Where the rim wall's foot sits, given where its top sits.
 *
 * THIS IS A ONE-LINE FUNCTION BECAUSE THE BUG IT FIXES IS ONE CHARACTER AWAY AND SILENT.
 * The wall used to run from y = 0 down to a CONSTANT y = -LAND_CELL_DEPTH. On a flat plane
 * those are the same thing. Once the coast rises and falls they are not: the relief field
 * reaches further than the wall is deep, so a rim point can sit BELOW the fixed floor, and
 * the wall there renders upside down — a band of wall standing UP out of the land. Measured
 * on the island fixture at the authored amplitude: 30 of the rim's 104 endpoints, nearly a
 * third of the coast.
 *
 * Hanging the wall a constant depth below whatever the rim is doing keeps the authored
 * thickness everywhere and leaves the island's underside undulating, where nobody at a
 * 50-degree camera can see it. The function exists so the invariant is provable in a node
 * test — the renderer that builds the wall imports three and cannot be.
 */
export function wallFootY(topY: number, depth = LAND_CELL_DEPTH): number {
  return topY - depth;
}

/** The plan for one island: what each edge is, and where each vertex sits once the bevel
 *  has pulled the parcel's outline in. */
export interface LandDefinitionPlan {
  /** What edge `edgeIndex` of cell `cellIndex` is (`points[i]` to `points[i+1]`). */
  edgeRole(cellIndex: number, edgeIndex: number): EdgeRole;
  /** Where vertex `vertexIndex` of cell `cellIndex` sits after the bevel inset. Returns the
   *  vertex unchanged when it touches no boundary edge of its own parcel. */
  insetPoint(cellIndex: number, vertexIndex: number): GroundPoint;
  /** CELL-EDGE counts by role — the instrument, so a test asserts on measured structure
   *  rather than on the prose above. A `parcel` edge is counted once per side, so this is
   *  the number of edges DRAWN, not the number of distinct boundaries. */
  readonly counts: Record<EdgeRole, number>;
}

/** Vertex identity for the interned substrate. The relaxed mesh interns its vertices, so
 *  shared corners are already bit-equal; rounding to 1e-3 of a ground unit absorbs the
 *  unprojection's floating-point tail without ever merging two genuinely distinct corners
 *  (the closest authored vertices are ~1.5 units apart). */
function vertexKey(p: GroundPoint): string {
  return `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
}

function edgeKey(a: GroundPoint, b: GroundPoint): string {
  const ka = vertexKey(a);
  const kb = vertexKey(b);
  return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
}

/** A cell with no `parcel` is its own kind of neighbour: two unparcelled cells share an
 *  interior seam, and an unparcelled cell beside a parcelled one is a real boundary.
 *
 *  ⚠ THE NUL IS WRITTEN AS AN ESCAPE, NOT AS A RAW BYTE. It was a raw 0x00 here until 2026-09-22.
 *  The escape is the SAME string at runtime — both are NUL + "none", verified char code by char
 *  code — so only the representation changes; nothing about the sentinel's behaviour does.
 *
 *  ⚠ THE REASON IS THAT A RAW BYTE IS UNREADABLE, and the near-miss is worth recording rather than
 *  the scare. A raw NUL in the first 8000 bytes of a blob makes git classify the whole file as
 *  BINARY and hide every diff of it thereafter; this one sat at byte 11,905, beyond that window,
 *  so the file escaped that consequence BY POSITION ALONE and diffs kept rendering. What did not
 *  escape is that no reader showed the byte: `grep` could not even list this file, because it
 *  treats a NUL-bearing file as binary — which is why `check:control-bytes` scans bytes rather
 *  than shelling out to grep, and why it refuses the raw form here. */
const NO_PARCEL = '\u0000none';

/** Twice the signed area of a polygon — sign carries the winding, magnitude the area. */
export function signedArea2(points: readonly GroundPoint[]): number {
  let s = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

/** Does this cell survive its parcel's inset — same winding, and enough area left to be a
 *  surface rather than a crease? */
function insetSurvives(
  points: readonly GroundPoint[],
  byVertex: ReadonlyMap<string, GroundPoint>,
): boolean {
  const before = signedArea2(points);
  const moved = points.map((p) => {
    const off = byVertex.get(vertexKey(p));
    return off ? { x: p.x + off.x, y: p.y + off.y } : p;
  });
  const after = signedArea2(moved);
  if (before === 0) return true;
  if (Math.sign(after) !== Math.sign(before)) return false;
  return Math.abs(after) / Math.abs(before) >= MIN_INSET_AREA_FRACTION;
}

function centroid(points: readonly GroundPoint[]): GroundPoint {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / points.length, y: y / points.length };
}

/**
 * Classify every edge of every cell, and compute the bevel inset for every vertex.
 *
 * THE INSET IS KEYED BY (PARCEL, VERTEX), NOT BY (CELL, VERTEX), AND THAT IS WHAT KEEPS
 * THE GROUND WATERTIGHT. A boundary vertex is usually shared by several cells of the same
 * parcel, only one of which owns the boundary edge through it. If each cell computed its
 * own inset the neighbours would disagree and tear a crack open along the inside of every
 * boundary — a crack that would look like a rendering artefact and get chased as one.
 * Keying by parcel makes every cell of that parcel move the shared vertex identically, so
 * the parcel's interior stays a single connected surface and only its OUTLINE moves.
 */
export function planLandDefinition(
  cells: readonly PlaceableCell[],
  bevelWidth = PARCEL_BEVEL_WIDTH,
): LandDefinitionPlan {
  const parcelOf = (i: number): string => cells[i]?.parcel ?? NO_PARCEL;

  // Pass 1 — which cells touch each edge.
  const incident = new Map<string, { cell: number; edge: number }[]>();
  cells.forEach((cell, ci) => {
    for (let ei = 0; ei < cell.points.length; ei++) {
      const a = cell.points[ei]!;
      const b = cell.points[(ei + 1) % cell.points.length]!;
      const key = edgeKey(a, b);
      const list = incident.get(key) ?? [];
      list.push({ cell: ci, edge: ei });
      incident.set(key, list);
    }
  });

  // Pass 2 — the role of each edge, and (for boundary edges) the inward direction each
  // owning parcel bevels in.
  const roles: EdgeRole[][] = cells.map((c) => c.points.map(() => 'interior' as EdgeRole));
  const counts = { interior: 0, parcel: 0, rim: 0 } satisfies Record<EdgeRole, number>;
  /** parcel -> vertexKey -> accumulated inward direction. */
  const pull = new Map<string, Map<string, { x: number; y: number }>>();

  const centroids = cells.map((c) => centroid(c.points));

  for (const [, list] of incident) {
    const parcels = new Set(list.map((e) => parcelOf(e.cell)));
    // One incident cell => the island's outer edge. Two or more cells that do not all
    // agree on a parcel => a capability boundary. Otherwise an interior seam.
    const role: EdgeRole = list.length === 1 ? 'rim' : parcels.size > 1 ? 'parcel' : 'interior';
    for (const { cell, edge } of list) roles[cell]![edge] = role;
    counts[role] += list.length;
    if (role === 'interior') continue;

    for (const { cell, edge } of list) {
      const pts = cells[cell]!.points;
      const a = pts[edge]!;
      const b = pts[(edge + 1) % pts.length]!;
      // The inward direction for THIS cell: the edge's perpendicular, oriented toward the
      // cell's own centroid. Derived rather than assumed, because SVG (x, y) maps to 3D
      // (x, z) and flips handedness, so "the left-hand perpendicular" is not reliably the
      // inward one — the same trap that culled every top face on the first island render.
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey) || 1;
      let nx = -ey / len;
      let ny = ex / len;
      const c = centroids[cell]!;
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      if (nx * (c.x - mx) + ny * (c.y - my) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const key = parcelOf(cell);
      const byVertex = pull.get(key) ?? new Map<string, { x: number; y: number }>();
      for (const v of [a, b]) {
        const vk = vertexKey(v);
        const acc = byVertex.get(vk) ?? { x: 0, y: 0 };
        acc.x += nx;
        acc.y += ny;
        byVertex.set(vk, acc);
      }
      pull.set(key, byVertex);
    }
  }

  // Pass 3 — normalise each accumulated pull into an offset of exactly `bevelWidth`. Two
  // boundary edges meeting at a corner contribute two directions; their sum bisects the
  // corner, which is the direction a mitred inset travels.
  //
  // The bisector is scaled to `bevelWidth` rather than to `bevelWidth / sin(half-angle)`,
  // which is the exact mitre. The exact form blows up at a sharp corner and shoots the
  // vertex clean across the parcel; this one UNDER-cuts there instead. That costs a little
  // parallelism on the inset outline and cannot self-intersect — and the bevel faces still
  // meet exactly, because both of a corner's faces end on the SAME inset vertex whatever
  // its distance.
  const offsets = new Map<string, Map<string, GroundPoint>>();
  for (const [parcel, byVertex] of pull) {
    const out = new Map<string, GroundPoint>();
    for (const [vk, acc] of byVertex) {
      const len = Math.hypot(acc.x, acc.y);
      // A vertex whose inward pulls cancel exactly (a straight-through boundary sampled
      // from both sides) has no bisector to travel along; leaving it in place is the only
      // answer that cannot invent a direction.
      if (len < 1e-6) continue;
      out.set(vk, { x: (acc.x / len) * bevelWidth, y: (acc.y / len) * bevelWidth });
    }
    offsets.set(parcel, out);
  }

  // Pass 4 — THE DEGENERACY GUARD, APPLIED PER PARCEL RATHER THAN PER CELL, because the
  // per-cell version would be the bug it was meant to prevent. A fixed inset is a fixed
  // fraction of a big cell and a huge fraction of a sliver, and a sliver whose vertices
  // are pulled past one another turns inside out — a cell that renders with reversed
  // winding and vanishes under front-face culling, which is exactly how the first island
  // render lost its entire ground and read as an art problem.
  //
  // Backing the whole PARCEL off keeps every shared vertex moving identically, so the
  // parcel's interior stays one connected surface. Backing off a single CELL would move a
  // vertex its neighbours did not, and tear a crack open along the inside of the boundary.
  const cellsOfParcel = new Map<string, number[]>();
  cells.forEach((_, ci) => {
    const key = parcelOf(ci);
    const list = cellsOfParcel.get(key) ?? [];
    list.push(ci);
    cellsOfParcel.set(key, list);
  });

  for (const [parcel, byVertex] of offsets) {
    if (!byVertex.size) continue;
    const members = cellsOfParcel.get(parcel) ?? [];
    // Halve until every cell survives, then give up and take no bevel at all on this
    // parcel — a parcel with no definition is honest; a parcel turned inside out is not.
    for (let attempt = 0; attempt < 5; attempt++) {
      if (members.every((ci) => insetSurvives(cells[ci]!.points, byVertex))) break;
      const last = attempt === 4;
      for (const [vk, off] of byVertex) {
        if (last) byVertex.delete(vk);
        else byVertex.set(vk, { x: off.x / 2, y: off.y / 2 });
      }
    }
  }

  return {
    edgeRole: (cellIndex, edgeIndex) => roles[cellIndex]?.[edgeIndex] ?? 'interior',
    insetPoint: (cellIndex, vertexIndex) => {
      const p = cells[cellIndex]?.points[vertexIndex];
      if (!p) return { x: 0, y: 0 };
      const off = offsets.get(parcelOf(cellIndex))?.get(vertexKey(p));
      return off ? { x: p.x + off.x, y: p.y + off.y } : p;
    },
    counts,
  };
}
