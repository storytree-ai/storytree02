// cell-ground-geometry.ts — the relaxed-mesh parcel ring → one merged ground buffer.
//
// THE PURE HALF of the `cell-ground` family (ADR-0123's provability firewall): arithmetic
// only, no React and no three.js, so every claim below is provable under bare `node:test`
// rather than only observable in a browser. `ForestWorldCanvas.tsx` hands the result
// straight to a `<bufferGeometry>`.
//
// ⚠⚠ WHY ONE MERGED BUFFER AND NOT ONE MESH PER PARCEL. The reference island carries 164
// parcels. A mesh each would take the shipped canvas from 2 draw calls to 166 — a cost
// regression roughly 80x on the metric `harness/hardware-floor.*` actually sweeps, paid to
// draw ground the classic substrate already drew in ONE instanced call. Parcels are
// arbitrary polygons and cannot share a geometry, so instancing is unavailable; merging is
// what is left. Per-parcel COLOUR survives the merge as a vertex attribute, which is the
// only property of the ground that varies and the one the map reports status with.
//
// ⚠ NORMALS ARE DERIVED FROM THE EMITTED WINDING, NEVER AUTHORED BESIDE IT. `pushTriangle`
// computes each face's geometric normal from the three vertices it is writing, so a
// positions/normals disagreement is unrepresentable rather than merely tested for. What the
// tests then have to check is only the ORDER the vertices are pushed in — which is the thing
// that can actually be got wrong, and whose failure mode (a parcel invisible from above
// under backface culling) looks exactly like the bug this whole module exists to fix.
//
// ⚠ ADOPTION HAS BEGUN AND THIS FILE IS WHERE IT LANDS. The owner authorised it on 2026-08-29
// ("This looks better, stamp it"), settling ADR-0380 D6 / ADR-0406 D2's separate-and-deliberate
// event. Two components of the approved treatment now reach this buffer, both as INPUTS rather
// than as things this module reaches for — which is what keeps every before/after on this arc
// the same function called twice: `relief` (the land's shape, crossed 2026-08-30) and `index`
// (the parcel's ramp ROW, which a banded material selects an authored colour with). Still NOT
// here: the coast clip, the stepped skirt, and the grain octave — the last of which is a
// fragment-stage field and belongs to the material, not to a vertex buffer.

import {
  FLAT_WALL,
  NO_SKIRT,
  ZERO_NORMAL,
  insetPoint,
  outwardNormal,
  rimEdgeCount,
  skirtExtraTriangles,
  skirtLedges,
  type GroundSkirt,
} from './stepped-skirt.js';
import { LAND_SCALE } from './land-per-capability.js';
import type { InstanceDescriptor } from './world-to-3d.js';

/** A linear-space colour triple. ⚠ LINEAR, not sRGB: three converts a hex string through
 *  `THREE.Color` on its way into a material, so a vertex-colour attribute that carried raw
 *  sRGB bytes would draw the same status token visibly lighter than the instanced primitive
 *  path draws it (the retired classic `hex-ground` prism used this route, and the story-tree /
 *  cave-arch primitives still do). The conversion is deliberately NOT transcribed here —
 *  {@link CellGroundGeometryInput} takes a resolver so the canvas can supply three's own. */
export interface LinearRgb {
  r: number;
  g: number;
  b: number;
}

/** How deep a parcel prism sits below the ground plane, in world units. Historically matched
 *  `TILE_HEIGHT`, the classic extruded-hex prism's own depth constant in
 *  `ForestWorldCanvas.tsx` — the two substrates drew ground of the same thickness because they
 *  were the same ground in two representations. `TILE_HEIGHT` was deleted along with the classic
 *  prism (`retire-the-old-land-path`); this value is unchanged and is now the ONLY ground
 *  thickness the shipped canvas draws. */
// ⚠ × LAND_SCALE (`land-per-capability.ts`): the literal is the value judged on the TUNED island;
// the shipped island is LAND_SCALE of it edge to edge, and this stays the same fraction of it.
export const CELL_GROUND_DEPTH = 3 * LAND_SCALE;

/**
 * A PARCEL'S GROUND, AS THE TWO BOUNDARIES A PRISM ACTUALLY NEEDS — which are the same loop
 * until something asks for vertices the parcel's own corners do not supply.
 *
 * ⚠⚠ THE SPLIT EXISTS BECAUSE A TOP FACE AND A WALL MUST AGREE ALONG THE SAME EDGE. The shore
 * band needs vertices between the coastline and the parcel's first interior corner, 8.66 ground
 * units inland (`src/shore-ring.ts` measures the void and explains why it is structural). Adding
 * them to the top face alone would leave the wall spanning the edge straight while the top face
 * bends through the new point — a hairline crack down the shore, at exactly the place this arc is
 * trying to make read. So {@link wall} carries every inserted point too, and its extra cost is two
 * triangles apiece rather than the whole parcel's worth a second ring would cost.
 *
 * ⚠ THE FACES MUST TILE THE WALL RING EXACTLY — same ground, no overlap, no gap. Nothing here
 * enforces it, because the check belongs to whoever builds a decomposition and can say what to do
 * when it fails; `shoreRingFaces` asserts area conservation and falls back to the undivided ring.
 */
export interface GroundFaces {
  /** The boundary the WALLS follow — the parcel's own ring, with any inserted points on the edges
   *  they were inserted into, so the skirt hangs from the very outline the top face ends at. */
  wall: readonly P2[];
  /** The TOP face, as one or more sub-rings whose union is {@link wall}'s interior. One entry is
   *  the undivided parcel, which is what every caller that asks for no decomposition gets. */
  faces: readonly (readonly P2[])[];
}

/** Triangles in ONE parcel prism: its top face, however it is divided, plus two per wall quad.
 *
 *  ⚠ THE WALL COUNT IS DRIVEN BY THE WALL RING AND THE TOP COUNT BY THE FACES, which is the
 *  whole reason this takes two arguments rather than one length. A decomposition that divided the
 *  top without lengthening the wall would be counted correctly here and would draw a crack.
 *
 *  ⚠ THERE IS NO BOTTOM CAP, and that is a decision rather than an oversight. The map is
 *  viewed from above, the parcels tile the island with no gaps, and a cap would cost another
 *  `ringLength` triangles per parcel to draw a face nothing can see. The classic
 *  `cylinderGeometry` prism DOES carry one, because three generates it and the shipped file
 *  does not ask it not to — so the two substrates differ by exactly this, and
 *  `shipped-baseline.ts` records both rather than pretending they match. */
export function groundFaceTriangles(
  wallLength: number,
  faceLengths: readonly number[],
): number {
  if (wallLength < 3) return 0;
  let top = 0;
  for (const n of faceLengths) {
    // ⚠ A SUB-FACE OF FEWER THAN THREE VERTICES BOUNDS NO AREA AND CONTRIBUTES NOTHING. It is not
    // an error — `triangulateRing` emits nothing for one — and the guard is here so the arithmetic
    // cannot go NEGATIVE on one, which would under-size the buffer the caller then writes into.
    if (n >= 3) top += n - 2;
  }
  return top + wallLength * 2;
}

/** Triangles in ONE UNDIVIDED parcel prism of `ringLength` vertices: a triangulated top face
 *  (`ringLength - 2`, the count ANY simple polygon triangulates to) plus two per wall quad.
 *
 *  ⚠ EXPRESSED THROUGH {@link groundFaceTriangles} RATHER THAN BESIDE IT. The undivided parcel is
 *  the decomposition with one face, so writing `3n - 2` here a second time would be a second
 *  arithmetic that could disagree with the first — and the disagreement would show up as a buffer
 *  sized for a different mesh than the one written into it. */
export function cellGroundTriangles(ringLength: number): number {
  return groundFaceTriangles(ringLength, [ringLength]);
}

/** Everything {@link cellGroundGeometry} needs. Named rather than a positional list because
 *  the resolver's contract (LINEAR, not sRGB) is the one thing a caller gets wrong. */
export interface CellGroundGeometryInput {
  /** The `cell-ground` descriptors, each carrying its parcel ring in `points`. */
  cells: readonly InstanceDescriptor[];
  /** Status variant → LINEAR colour. The canvas supplies `new THREE.Color(hex)` so the sRGB
   *  transfer function is three's own rather than a transcription of it. */
  resolve: (material: string | undefined) => LinearRgb;
  /** Status variant → its RAMP ROW, an index into a material's authored `(token x level)` table.
   *
   *  ⚠ OPTIONAL, AND ITS ABSENCE MEANS AN EMPTY {@link CellGroundGeometry.statuses}, so a caller
   *  that predates it gets the buffer it always got. Supplying it is what a BANDED material
   *  needs and a smooth one does not: `resolve` hands the GPU a colour to light continuously,
   *  while this hands it a ROW to select a finished, already-rounded authored colour out of.
   *
   *  ⚠ THE TWO ARE NOT ALTERNATIVE SPELLINGS OF ONE THING, and the reason is measured rather
   *  than stylistic. A shader given a colour has to MULTIPLY it by the rung's level, and the
   *  GPU's float-to-unorm8 conversion resolves an exact half DOWN where `Math.round` takes it
   *  UP — which delivered 929 px of `#c2ad5e` against the authored `#c2ad5f` the first time
   *  this package tried it (see `bandLevelIndex` in `shade-ladder.ts`). THREE of this map's own
   *  authored products land on exactly that knife edge — `#d8c069`'s blue at 0.9 (94.5) and
   *  `#9ca3af`'s at 0.9 (157.5) and 0.78 (136.5) — so the arithmetic is done ONCE in TypeScript
   *  and the GPU is handed a row and a rung to look up. `banded-ground-material.test.ts`
   *  ENUMERATES that class rather than sampling it. */
  index?: ((material: string | undefined) => number) | undefined;
  /** Prism depth below the ground plane. Defaults to {@link CELL_GROUND_DEPTH}. */
  depth?: number;
  /** The ground's RELIEF — how high the land stands at a point, and which way it faces there.
   *
   *  ⚠ OPTIONAL, AND OMITTING IT IS THE FLAT GROUND VERBATIM. That is what makes the shipped
   *  map's before/after a controlled comparison rather than a claim: the same function, the
   *  same parcels, the same colours, differing in exactly this one input. `ForestWorldCanvas`
   *  passes {@link landRelief} unconditionally — there is no flag on the shipped surface, and
   *  a flag nobody flips is not adoption (the arc's end-state item 6).
   *
   *  ⚠ THE NORMAL IS SUPPLIED, NOT DERIVED, AND ONLY FOR THE TOP FACE. Everything else in this
   *  module takes its normal from the winding of the very vertices being written, which makes a
   *  positions/normals disagreement unrepresentable. That guard is kept for the walls. The top
   *  face gives it up deliberately: a face normal would quantise each triangle whole and the
   *  land would read as a mosaic of hard facets — the rejected per-cell noise arriving by
   *  another route — where an interpolated ANALYTIC vertex normal puts the shading gradient
   *  where the surface actually turns. `landNormal` has `y = 1/hypot(dx,1,dz)`, which is
   *  positive for every finite gradient, so an upward-facing top face stays unrepresentable
   *  too: this trades one guarantee for the same guarantee reached a different way. */
  relief?: GroundRelief | undefined;
  /** Island id → where that island's tile sits in a packed occlusion atlas, in UV.
   *
   *  ⚠ OPTIONAL, AND ITS ABSENCE MEANS AN EMPTY {@link CellGroundGeometry.atlasOrigins}, so a
   *  caller that predates it gets the buffers it always got — the same shape as `index` above and
   *  for the same reason: a zero-filled origin buffer would say every island reads the atlas's
   *  top-left corner, which is a real texel, and the map would wear one island's shadow
   *  everywhere while looking like it was working.
   *
   *  ⚠ IT IS A CONSTANT PER ISLAND, NOT A SPATIAL SIGNAL, which is the whole reason it may ride
   *  on the mesh at all. `src/land-shadow.ts` rejected a per-vertex SHADOW attribute because the
   *  shadow carries features finer than a parcel and interpolating it smears them; an atlas
   *  origin is identical at all three vertices of every triangle on its island, so the
   *  interpolator returns it exactly — the argument `banded-ground-material.ts` already makes
   *  about the ramp row. */
  atlasOrigin?: ((island: string | undefined) => AtlasOrigin) | undefined;
  /** Island id → the discrete slot the material uses to identify that island. Like the atlas
   *  origin, this is constant for every vertex emitted from one parcel. */
  islandSlot?: ((island: string | undefined) => number) | undefined;
  /** THE STEPPED CLIFF SKIRT — the sixth and last component of the approved land treatment.
   *
   *  ⚠ OPTIONAL, AND OMITTING IT IS THE SINGLE-QUAD WALL VERBATIM — the same argument
   *  {@link CellGroundGeometryInput.relief} makes, and for the same reason: the before/after is
   *  this function called twice over the same parcels, differing in exactly this one input, rather
   *  than a comparison between two implementations. `stepped-skirt.test.ts` pins that a one-ledge
   *  skirt and no skirt at all emit byte-identical buffers, so the control arm on the comparison
   *  page is the shipped map rather than a reconstruction of it.
   *
   *  ⚠ IT IS THE ONE INPUT THAT WRITES A ROW AND A COLOUR THIS FUNCTION DID NOT GET FROM THE
   *  PARCEL, which is exactly what the owner settled on 2026-09-01 and nothing else here may do.
   *  See `src/stepped-skirt.ts` for the settlement and the outcome test that replaced the
   *  every-colour-reports rule. */
  skirt?: GroundSkirt | undefined;
  /** How to DIVIDE a parcel's top face, and which boundary its wall then follows.
   *
   *  ⚠ OPTIONAL, AND ITS ABSENCE IS THE UNDIVIDED PARCEL VERBATIM — the same shape `relief` and
   *  `index` take, and for the same reason: the before/after on this arc has to be the same
   *  function called twice, differing in one input. A caller that supplies none gets the buffer it
   *  always got, byte for byte.
   *
   *  ⚠ IT RETURNS A WALL RING AS WELL AS FACES, and the wall is the half a caller forgets. See
   *  {@link GroundFaces}: a top face divided along an edge the wall does not know about draws a
   *  hairline crack there.
   *
   *  ⚠ THE FACES ARE TRUSTED. This module does not check that they tile the wall ring — it
   *  cannot say what to do when they do not, and a decomposition that fails the check has a
   *  meaningful fallback (its own undivided ring) that only its author knows how to reach. */
  decompose?: ((cell: InstanceDescriptor) => GroundFaces) | undefined;
}

/** Where an island's tile begins in a packed occlusion atlas, in UV. A structural pair rather
 *  than an import from `shadow-atlas.ts`, for the same reason {@link GroundRelief} is an
 *  interface rather than a direct import of the relief field: this module stays arithmetic a
 *  test can drive with values of its own choosing. */
export interface AtlasOrigin {
  u: number;
  v: number;
}

/** The ground's shape, as the two functions a mesh needs: a height and a unit normal, both of
 *  POSITION ONLY. `src/land-relief.ts` supplies the pair the shipped map draws with, and the
 *  seam is an interface rather than a direct import so this module stays arithmetic a test can
 *  drive with a field of its own choosing — including the constant-zero one that proves the
 *  flat path is the relief path's own special case. */
export interface GroundRelief {
  height: (x: number, z: number) => number;
  normal: (x: number, z: number) => { x: number; y: number; z: number };
}

/** The FLAT ground, as a relief field — what a caller supplying none gets, written out rather
 *  than branched around so there is exactly one code path through the builder. The old flat
 *  behaviour is now a special case of the general one rather than a sibling of it, which is
 *  what lets the before/after comparison be the same function twice. */
export const FLAT_GROUND: GroundRelief = {
  height: () => 0,
  normal: () => ({ x: 0, y: 1, z: 0 }),
};

/** The origin a ring gets when the caller asked for no atlas — a value that only ever reaches a
 *  zero-length buffer. Named rather than an inline literal so the two facts about it stay in one
 *  place: it is written nowhere, and it is not a claim that (0, 0) is unshadowed. */
export const ZERO_ORIGIN: AtlasOrigin = { u: 0, v: 0 };

/** One merged, non-indexed ground buffer: three floats per vertex, three vertices per
 *  triangle, flat-shaded (each face's three vertices share that face's own normal). */
export interface CellGroundGeometry {
  positions: Float32Array;
  normals: Float32Array;
  /** Per-vertex LINEAR colour — the parcel's folded status, surviving the merge. */
  colors: Float32Array;
  /** Per-vertex RAMP ROW — the same parcel status as {@link colors}, in the form a banded
   *  material selects with. ONE float per vertex, not three: it is a row number.
   *
   *  ⚠ EMPTY when the caller supplied no `index`, rather than absent or zero-filled. Empty is
   *  the honest report — a zero-filled buffer would say every parcel is row 0, which is a real
   *  status, and a material handed it would paint the whole island one colour while looking
   *  like it was working. */
  statuses: Float32Array;
  /** Per-vertex ATLAS ORIGIN — the UV corner of the owning island's tile in a packed occlusion
   *  atlas. TWO floats per vertex, and {@link CellGroundGeometry.statuses}'s argument for being
   *  empty rather than zero-filled applies here verbatim: (0, 0) is a real corner of a real
   *  atlas. */
  atlasOrigins: Float32Array;
  /** Per-vertex discrete island identity. Empty when no island-slot resolver was supplied. */
  islandSlots: Float32Array;
  /** Parcels actually built (rings of fewer than three vertices bound no area and are dropped). */
  cells: number;
  /** Triangles in the merged buffer — the authored count `harness/baseline-measure.mjs`
   *  holds the browser's own GL tally to. */
  triangles: number;
}

// ⚠ THERE IS NO EARLY RETURN FOR AN EMPTY INPUT, and adding one back would be dead code. A scene
// with no relaxed cells is the CLASSIC substrate — an ordinary island, not an error — and the
// general path already answers it exactly: zero triangles, three zero-length buffers. An
// `if (rings.length === 0) return …` guard sat here until a mutation sweep showed it could be
// deleted without any test noticing, which is what an unreachable branch looks like from outside.

/** A 3D point in the merged buffer's own terms. Exported for the same reason {@link P2} is: it is
 *  the type the module's own primitives are stated in, and `stepped-skirt.ts` states a ledge's
 *  face direction in it rather than declaring a second three-number shape beside this one. */
export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** A ring vertex flattened to the ground plane. Exported because the module's primitives below
 *  are exported: they are the substance of this file, not its plumbing, and the whole
 *  orientation convention everything else rests on is only checkable if they can be called. */
export interface P2 {
  x: number;
  z: number;
}

/** Twice the SIGNED shoelace area of a triangle in the (x, z) plane. Its SIGN is the winding,
 *  and under the mapper's x→east / y→depth convention a NEGATIVE value is the one whose face
 *  normal points +Y (up). Everything about orientation in this module reduces to that sentence. */
export function signedTriangleArea2(a: P2, b: P2, c: P2): number {
  return a.x * b.z - b.x * a.z + (b.x * c.z - c.x * b.z) + (c.x * a.z - a.x * c.z);
}

/** Twice the signed shoelace area of a whole ring — the same sign convention as {@link area2}. */
export function signedRingArea2(pts: readonly P2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.z - q.x * p.z;
  }
  return s;
}

/** The ring in the module's ONE orientation: negative shoelace, i.e. the winding whose top face
 *  points +Y. Every downstream claim — the triangulation's facing, and the wall's `(-dz, 0, dx)`
 *  outward normal — is stated against this convention and holds only because of it. */
export function normalisedRing(pts: readonly P2[]): readonly P2[] {
  return signedRingArea2(pts) > 0 ? pts.slice().reverse() : pts;
}

/** Is `p` inside triangle `abc` (edges inclusive), for a triangle known to be wound negative? */
export function pointInTriangle(p: P2, a: P2, b: P2, c: P2): boolean {
  return signedTriangleArea2(a, b, p) <= 0 && signedTriangleArea2(b, c, p) <= 0 && signedTriangleArea2(c, a, p) <= 0;
}

/**
 * Triangulate a ring into upward-facing triangles by EAR CLIPPING.
 *
 * ⚠⚠ A CENTROID FAN IS NOT SAFE HERE, and this is the whole reason the algorithm is this one.
 * A fan is only correct when the polygon is star-shaped about the point fanned from, and the
 * relaxed mesh's parcels are not guaranteed to be: a Voronoi cell IS convex, but the cells are
 * CLIPPED to the island's hex-union boundary, which is not. On an L-shaped parcel the centroid
 * lands in the notch — outside the parcel — and the fan emits triangles wound the opposite way,
 * which draw as an inside-out parcel that vanishes from above under backface culling. That was
 * not reasoned about; it was caught by the `non-convex L` fixture in this module's tests, which
 * is kept precisely so nobody simplifies this back to a fan.
 *
 * Ear clipping makes no convexity assumption at all. The ring is normalised to the negative
 * (upward) winding first, so every emitted triangle inherits it and the caller never has to ask
 * which way round the scene handed the parcel in.
 */
export function triangulateRing(ring: readonly P2[]): [P2, P2, P2][] {
  const pts = normalisedRing(ring);
  const out: [P2, P2, P2][] = [];
  // ⚠ NOT a copy. `rest` is only ever REASSIGNED, never mutated in place, so aliasing `pts` here
  // cannot reach the caller's ring — and a defensive `.slice()` would be an allocation no test
  // could ever justify.
  let rest: readonly P2[] = pts;

  // ⚠⚠ THE PASS COUNT IS KNOWN BEFORE THE LOOP STARTS, AND THAT IS THE POINT OF THIS SHAPE.
  // Written the obvious way — `while (rest.length > 3)` with a `clipped` flag and a `break` —
  // termination is DISCOVERED by the body rather than guaranteed by the loop, and six separate
  // mutations of that body (dropping the splice, pinning the flag, emptying the block) turn it
  // into an infinite loop. A mutation sweep reported all six as TIMEOUTS: real detections, but
  // detections the rung cannot attribute to any test, because no test failed — the suite simply
  // hung. Counting the passes up front converts every one of them into an ordinary wrong answer
  // that area conservation catches, which is a far better thing to be held by than a stopwatch.
  //
  // The bound is `pts` itself, iterated for its LENGTH alone — its values are never read. n is a
  // safe ceiling rather than an exact count: clipping stops on its own once fewer than three
  // vertices remain (no corner of a two-vertex ring is an ear), so the last few passes are no-ops
  // and the fan below emits whatever the clipping did not.
  for (const _unused of pts) {
    const ear = earIndex(rest);
    // No ear: the ring is degenerate (collinear or repeated vertices), or it is down to its last
    // two vertices. Stop and let the fan below emit what is left — for a degenerate ring that is
    // zero-area and therefore harmless.
    // ⚠ `null`, not `-1`. A numeric sentinel invites `return -1` → `return +1`, which reads as a
    // VALID index, silently turns "no ear here" into "clip vertex 1", and produces a plausible
    // wrong triangulation of a degenerate ring rather than an obvious failure.
    if (ear === null) break;
    const a = rest[(ear + rest.length - 1) % rest.length]!;
    const b = rest[ear]!;
    const c = rest[(ear + 1) % rest.length]!;
    out.push([a, b, c]);
    rest = [...rest.slice(0, ear), ...rest.slice(ear + 1)];
  }

  // Whatever survived the clipping, as a fan from its first vertex. On a well-formed ring the
  // clipping has already consumed everything and this emits nothing.
  // ⚠ Driven by the array rather than by a counter: `for (let i = …; i += 1)` invites `i -= 1`,
  // which does not produce a wrong answer — it produces an INFINITE LOOP, and a suite that hangs
  // is a detection no rung can attribute to a test.
  // ⚠ THE TWO `!== undefined` GUARDS BELOW CAN NEVER BE FALSE, and they are here only because
  // `noUncheckedIndexedAccess` types an index access as possibly-undefined. `tail` is empty
  // unless `rest.length >= 3`, so `rest[0]` exists whenever the callback runs at all; and `i`
  // ranges over `tail` (length `rest.length - 2`), so `i + 2` tops out at `rest.length - 1`.
  // Both are marked EQUIVALENT rather than tested for, because the branch a test would have to
  // reach does not exist — asserting on it would mean weakening the types to manufacture it.
  const tail = rest.slice(1, -1);
  const first = rest[0];
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — `tail` is non-empty only when
  // `rest.length >= 3`, so `rest[0]` is always defined by the time this runs.
  if (first !== undefined) {
    tail.forEach((v, i) => {
      const next = rest[i + 2];
      // Stryker disable next-line ConditionalExpression: EQUIVALENT — `i` indexes `tail`, whose
      // length is `rest.length - 2`, so `i + 2` never exceeds `rest.length - 1`.
      if (next !== undefined) out.push([first, v, next]);
    });
  }
  return out;
}

/** The index of a vertex of `rest` that is an ear, or -1 if the ring has none.
 *
 *  An ear is a corner that is CONVEX (for the module's negative winding, a strictly negative
 *  turn — which is why a collinear corner is not one) and whose triangle SWALLOWS no other vertex
 *  of the ring. The second condition is what makes ear clipping safe on a shape a fan is not:
 *  without it a corner across a notch looks locally convex and its triangle covers ground the
 *  polygon does not.
 *
 *  Returns `null` when the ring has no ear at all. */
function earIndex(rest: readonly P2[]): number | null {
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[(i + rest.length - 1) % rest.length]!;
    const b = rest[i]!;
    const c = rest[(i + 1) % rest.length]!;
    if (signedTriangleArea2(a, b, c) >= 0) continue;
    let contains = false;
    for (let j = 0; j < rest.length; j += 1) {
      if (j === i || j === (i + rest.length - 1) % rest.length || j === (i + 1) % rest.length) continue;
      if (pointInTriangle(rest[j]!, a, b, c)) {
        contains = true;
        break;
      }
    }
    if (!contains) return i;
  }
  return null;
}

/**
 * Build the merged ground buffer for a set of `cell-ground` descriptors.
 *
 * Per parcel: an ear-clipped top face at y = 0, then a wall quad per ring edge falling to
 * y = -depth. Winding is settled ONCE, here — `worldTo3D` passes the scene's ring on untouched
 * — so there is no second normalisation anywhere to disagree with this one.
 */
export function cellGroundGeometry(input: CellGroundGeometryInput): CellGroundGeometry {
  const depth = input.depth ?? CELL_GROUND_DEPTH;
  const relief = input.relief ?? FLAT_GROUND;
  /** A ring vertex raised onto the field. */
  const lift = (p: P2): P3 => ({ x: p.x, y: relief.height(p.x, p.z), z: p.z });
  /** The field's unit normal there — analytic, so it is the surface's own answer rather than a
   *  finite difference over whatever step someone happened to pick. */
  const facing = (p: P2): P3 => relief.normal(p.x, p.z);
  // ⚠ Mapped from the descriptors THEMSELVES, never re-indexed alongside a parallel array: an
  // index lookup here would be a second way to get the material wrong, and the parcel's colour is
  // what the map reports a capability's state with.
  // ⚠ THE DECOMPOSITION IS RESOLVED ONCE PER PARCEL, HERE, and carried — never asked for again
  // further down. It is the one input on this list that is expensive (the shore ring bisects the
  // distance field along every edge that crosses the band), and asking twice would also let the
  // sizing pass and the writing pass disagree about how many triangles a parcel has, which is the
  // one way this buffer can overrun.
  const rings = input.cells.flatMap((c) => {
    if (c.points === undefined || c.points.length < 3) return [];
    const ring: P2[] = c.points.map((p) => ({ x: p.x, z: p.z }));
    const divided = input.decompose?.(c);
    return [
      {
        wall: divided?.wall ?? ring,
        faces: divided?.faces ?? [ring],
        material: c.material,
        island: c.island,
      },
    ];
  });

  // ⚠ THE SKIRT'S LEDGES ARE RESOLVED ONCE, NOT PER EDGE. `skirtLedges` is a pure function of the
  // row count, so calling it inside the wall loop would rebuild the same six-element profile for
  // every one of the island's ~350 edges. It is also what the SIZING loop below counts against, so
  // hoisting it makes "the buffer was sized for the profile that was written" true by construction.
  // ⚠ THE ABSENCE IS A VALUE, NOT A NULL CHECK. `NO_SKIRT` marks no edge as rim, so every branch
  // below is reached with a real skirt and there is nothing to test for — which is what removes the
  // second `skirt !== undefined` the mutation rung found could never fire.
  const skirt = input.skirt ?? NO_SKIRT;
  const ledges = skirtLedges(skirt.rows);
  let triangles = 0;
  for (const r of rings) {
    triangles += groundFaceTriangles(
      r.wall.length,
      r.faces.map((f) => f.length),
    );
    // ⚠⚠ THE SKIRT COUNTS OFF THE WALL RING, WHICH IS THE DECOMPOSITION'S OUTPUT AND NOT THE
    // PARCEL'S OWN OUTLINE — and that is the whole reason the two components compose instead of
    // fighting. `decompose` may INSERT points along a rim edge (the shore ring does, inside the
    // band), and every edge it inserts is still an edge of the island's outline, so it is still a
    // cliff edge. Counting off the parcel's raw ring would size the buffer for fewer ledges than
    // the fill loop below then writes, and a merged buffer that overruns is not a visible defect
    // — it is a `RangeError` on a typed array, or silently dropped triangles.
    //
    // ⚠ COUNTED WITH THE RING UN-NORMALISED, WHICH IS SAFE BECAUSE `isRim` IS ORIENTATION-BLIND.
    // The fill loop asks the same question of the NORMALISED ring, and `edgeKey` sorts an edge's
    // two endpoints, so a seam traversed one way here and the other way there is ONE edge either
    // way. The two loops therefore cannot disagree about how many edges are rim.
    triangles += skirtExtraTriangles(rimEdgeCount(r.wall, skirt.isRim), skirt.rows);
  }

  const positions = new Float32Array(triangles * 9);
  const normals = new Float32Array(triangles * 9);
  const colors = new Float32Array(triangles * 9);
  // ⚠ ONE float per VERTEX, where the three above carry three. It is a row number, not a colour,
  // and sizing it like a colour would silently leave two thirds of it as zeros — row 0, a real
  // status — which is the failure mode that looks exactly like working code.
  const statuses = input.index === undefined ? new Float32Array(0) : new Float32Array(triangles * 3);
  // ⚠ TWO floats per VERTEX, where the row above carries one and the colour carries three. Sized
  // off the same `triangles * 3` vertex count, so the three buffers cannot disagree about how
  // many vertices there are.
  const atlasOrigins =
    input.atlasOrigin === undefined ? new Float32Array(0) : new Float32Array(triangles * 6);
  const islandSlots =
    input.islandSlot === undefined ? new Float32Array(0) : new Float32Array(triangles * 3);
  let w = 0;

  /** Write one triangle with an EXPLICIT normal per vertex — the top face's route, because the
   *  relief's normal is analytic and belongs to the point rather than to the facet.
   *
   *  ⚠ The colour is a PARAMETER rather than a mutable variable this closure reads. It was the
   *  latter until a mutation sweep showed its initial value could be anything at all without a
   *  test noticing — true, because every parcel overwrites it first, which is exactly the
   *  argument for not having one. */
  const pushTriangleWithNormals = (
    vertices: readonly [P3, P3, P3],
    vertexNormals: readonly [P3, P3, P3],
    colour: LinearRgb,
    row: number,
    origin: AtlasOrigin,
    islandSlot: number,
  ): void => {
    for (let i = 0; i < 3; i += 1) {
      const p = vertices[i]!;
      const n = vertexNormals[i]!;
      positions[w] = p.x;
      positions[w + 1] = p.y;
      positions[w + 2] = p.z;
      normals[w] = n.x;
      normals[w + 1] = n.y;
      normals[w + 2] = n.z;
      colors[w] = colour.r;
      colors[w + 1] = colour.g;
      colors[w + 2] = colour.b;
      // ⚠ THE ROW IS WRITTEN HERE, BESIDE THE COLOUR, RATHER THAN AS A SPAN AFTERWARDS. The span
      // form — remember `w` before the parcel, fill up to `w` after — was the first shape and it
      // was UNPROVABLE: because parcels are written in order, an off-by-one at either end is
      // immediately overwritten by the next parcel, so both boundary mutants survived the whole
      // suite. Writing it per vertex removes the arithmetic that could be off by one at all, and
      // makes "the row and the colour describe the same parcel" true by construction rather than
      // by two pieces of bookkeeping agreeing.
      //
      // With no `index` resolver `statuses` is zero-length and every one of these is a silent
      // no-op on a typed array — which is the honest outcome: the caller asked for no rows.
      statuses[w / 3] = row;
      // Same shape, same argument: written PER VERTEX beside the row rather than as a span
      // afterwards, so there is no boundary arithmetic to be off by one in. With no
      // `atlasOrigin` resolver the buffer is zero-length and both writes are silent no-ops on a
      // typed array — the honest outcome, because the caller asked for no origins.
      atlasOrigins[(w / 3) * 2] = origin.u;
      atlasOrigins[(w / 3) * 2 + 1] = origin.v;
      islandSlots[w / 3] = islandSlot;
      w += 3;
    }
  };

  /** Write one triangle, deriving its normal from the very vertices being written — the WALLS'
   *  route, and the reason a positions/normals disagreement stays unrepresentable there. */
  const pushTriangle = (
    a: P3,
    b: P3,
    c: P3,
    colour: LinearRgb,
    row: number,
    origin: AtlasOrigin,
    islandSlot: number,
  ): void => {
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const uz = b.z - a.z;
    const vx = c.x - a.x;
    // ⚠ THIS USED TO CARRY A `Stryker disable … EQUIVALENT` ANNOTATION AND NO LONGER MAY. The
    // argument was that every face reaching here is either a top (a.y = c.y = 0) or a wall whose
    // `a` and `c` share a height, so `-` and `+` differ only by a scale the normalisation below
    // removes. Relief falsifies both halves: tops leave this function entirely now, and a wall's
    // corners stand at whatever heights the field gives them. A stale equivalence claim is worse
    // than no claim — it suppresses a mutant that a test can and does now kill.
    const vy = c.y - a.y;
    const vz = c.z - a.z;
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 0) {
      nx /= len;
      ny /= len;
      nz /= len;
    }
    const n: P3 = { x: nx, y: ny, z: nz };
    pushTriangleWithNormals([a, b, c], [n, n, n], colour, row, origin, islandSlot);
  };

  for (const ring of rings) {
    const colour = input.resolve(ring.material);
    // ⚠ RESOLVED FROM THE DESCRIPTOR'S OWN MATERIAL, exactly as the colour beside it is, and
    // 0 when the caller asked for no rows — a value that reaches only a zero-length array.
    const row = input.index?.(ring.material) ?? 0;
    // ⚠ RESOLVED FROM THE DESCRIPTOR'S OWN ISLAND, exactly as the row beside it is resolved from
    // its own material, and ZERO_ORIGIN when the caller asked for no origins — a value that
    // reaches only a zero-length array.
    const origin = input.atlasOrigin?.(ring.island) ?? ZERO_ORIGIN;
    const islandSlot = input.islandSlot?.(ring.island) ?? 0;
    const pts = normalisedRing(ring.wall);
    const n = pts.length;

    // The top face, standing on the relief field. `lift` and `facing` are the identity for a
    // caller that supplies none, so this line is the flat ground verbatim when relief is absent.
    //
    // ⚠ EACH SUB-FACE IS TRIANGULATED ON ITS OWN, and `triangulateRing` normalises each one, so a
    // decomposition handed in wound either way emits upward-facing triangles. Undivided, this loop
    // runs once over the parcel's own ring — the line it was before a decomposition existed.
    for (const face of ring.faces) {
      for (const [a, b, c] of triangulateRing(face)) {
        pushTriangleWithNormals(
          [lift(a), lift(b), lift(c)],
          [facing(a), facing(b), facing(c)],
          colour,
          row,
          origin,
          islandSlot,
        );
      }
    }

    // The walls. ⚠ THE OUTWARD DIRECTION IS READ OFF THE RING'S OWN WINDING, not off the parcel's
    // centroid: with `pts` normalised, edge A→B faces `(-dz, 0, dx)` and that is a LOCAL fact
    // about the edge. A centroid test would be wrong for exactly the parcels ear clipping exists
    // for — on an L-shaped parcel the centroid sits in the notch, outside the shape, so "away
    // from the centre" points INTO the parcel along the notch edges.
    //
    // ⚠ THE UNDERSIDE FOLLOWS THE RELIEF RATHER THAN STAYING FLAT, and that is a correctness
    // requirement, not a preference. The field reaches ±4.22 units at the authored amplitude
    // while the prism is 3 deep, so a bottom pinned at `-depth` would sit ABOVE the top face
    // wherever the land dips — every wall there inside out, and the parcel gone from above.
    // A constant-thickness slab kept the two substrates telling the same story while both
    // shipped: the classic hex prism was `TILE_HEIGHT` thick and this is `CELL_GROUND_DEPTH`
    // thick, everywhere, at the SAME value. The prism is retired (`retire-the-old-land-path`);
    // the constant-thickness slab is not — it is still what makes THIS shape correct on its own.
    //
    // ⚠⚠ AND THE WALL IS NOW A LADDER OF LEDGES RATHER THAN ONE QUAD — the sixth component of the
    // approved treatment (`src/stepped-skirt.ts`). With no skirt the ladder has ONE rung at inset
    // 0 and full drop, which is the quad this loop always emitted, arithmetic included; the
    // stepped cliff is the general case and the flat wall is its special case, exactly as the flat
    // ground became a special case of the relief field above.
    for (let i = 0; i < n; i += 1) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      const top = lift(a);
      const topNext = lift(b);
      // ⚠ ONLY THE RIM IS CUT. Every parcel walls every edge and all but the rim are buried; six
      // inset ledges on a buried seam would pull two neighbours apart along the seam they share.
      const rim = skirt.isRim(a, b);
      const rungs = rim ? ledges : FLAT_WALL;
      // A zero normal for an uncut edge, so an inset of 0 is `p - 0 * 0` and the emitted vertex is
      // the ring's own coordinate to the bit — which is what makes the no-skirt buffer identical
      // rather than merely equal to within a rounding.
      const outward = rim ? outwardNormal(a, b) : ZERO_NORMAL;
      let upper = top;
      let upperNext = topNext;
      // ⚠ `entries()` RATHER THAN A COUNTER, for the reason `stepped-skirt.ts`'s `indices` gives:
      // a mutated counter does not fail, it HANGS, and the rung scores a hang as UNPROVEN.
      for (const [li, ledge] of rungs.entries()) {
        const ia = insetPoint(a, outward, ledge.inset);
        const ib = insetPoint(b, outward, ledge.inset);
        // ⚠ THE LEDGE HANGS FROM ITS OWN RING VERTEX'S HEIGHT, NOT FROM THE RELIEF AT THE INSET
        // POINT. The prism is constant-thickness on purpose (see the note above), and sampling
        // the field at the cut-back position would make the cliff's foot wander relative to the
        // top face — so the bottom ledge would no longer sit exactly `depth` under the ground and
        // the two substrates would stop being the same ground in two representations.
        const lower: P3 = { x: ia.x, y: top.y - depth * ledge.drop, z: ia.z };
        const lowerNext: P3 = { x: ib.x, y: topNext.y - depth * ledge.drop, z: ib.z };
        // ⚠ THE ROCK IS SELECTED BY LEDGE INDEX, AND `soilLedges` IS THE OWNER'S OPTION B. Ledges
        // above the boundary keep the parcel's own status tint; everything below wears the rock.
        // At `soilLedges: 0` the whole cliff is rock (his option A) and at `rows: 1` the single
        // ledge is always soil, so a caller that asked for no skirt can never deliver one.
        // ⚠ `rim &&` IS LOAD-BEARING, NOT BELT-AND-BRACES. A buried seam takes the one-rung flat
        // wall, and at `soilLedges: 0` its single ledge would otherwise satisfy `li >= 0` and every
        // interior wall in the island would be painted rock. Invisible, and still wrong: the colour
        // buffer is what the comparison arms are built from, so it would move a measurement.
        //
        // ⚠ AND THERE IS NO `skirt !== undefined` HERE, WHICH THERE WAS. `rim` is already false
        // whenever the skirt is absent, so the extra check could never fire — mutating it to `true`
        // changed nothing and SURVIVED the mutation rung. `NO_SKIRT` carries the absence instead.
        // ⚠⚠ AND WHICH ROCK IS THE LADDER'S OWN ANSWER, NOT A SECOND ART DECISION. A ledge whose
        // face falls BELOW `SHADE_LEVELS[0]` is one the quantiser has saturated — it is delivered
        // at the darkest rung however much darker its true lighting is — so a token is the only
        // lever left on it, and that is exactly the set the shaded rock carries. Measured over 36
        // rim azimuths: all three DOWN-facing ledges are saturated at every azimuth, and the
        // UP-facing ones at 19, 17 and 15 of 36. A one-token cliff hands `oneRock` the same rock
        // twice, so this selection still runs and its two answers agree — which is what keeps the
        // pre-adoption map on this very code path rather than on a branch beside it.
        //
        // ⚠ THE NORMAL IS THE LEDGE'S IDEALISED ONE, PER QUAD, never the winding-derived normal
        // `pushTriangle` writes per triangle. Those two disagree wherever the relief tilts the
        // ring edge, and a quad whose two triangles picked different ROCKS would split along its
        // own diagonal — a tear rather than a facet.
        const rock = rim && li >= skirt.soilLedges;
        // ⚠ NO `rock &&` HERE, AND IT WAS WRITTEN WITH ONE. A hand-seeded mutant deleting that
        // guard SURVIVED the whole suite, which is what an equivalent guard looks like from
        // outside — and it is equivalent by construction: `pick` is read only through the two
        // `rock ? … : …` expressions below, so a buried seam computing `shaded` cannot deliver a
        // rock however the rule answers. This is the same finding, and the same removal, that
        // `skirtLedges`'s absent row guard and the absent `skirt !== undefined` check already
        // record. What IS load-bearing is `rim &&` on the line above; that stays.
        const shaded = skirt.isShaded(ledge, outward, depth);
        const pick = shaded ? skirt.shaded : skirt.lit;
        const ledgeColour = rock ? pick.colour : colour;
        const ledgeRow = rock ? pick.row : row;
        pushTriangle(upperNext, upper, lowerNext, ledgeColour, ledgeRow, origin, islandSlot);
        pushTriangle(lowerNext, upper, lower, ledgeColour, ledgeRow, origin, islandSlot);
        upper = lower;
        upperNext = lowerNext;
      }
    }
  }

  return {
    positions,
    normals,
    colors,
    statuses,
    atlasOrigins,
    islandSlots,
    cells: rings.length,
    triangles,
  };
}
