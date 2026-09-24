// world-to-3d.ts — ADR-0123 THIRD forest-world mapper: pure deterministic mapping
// from the @storytree/forest-world semantic scene graph to typed 3D instance
// descriptors. No React, no three.js — node:test-provable (the provability firewall).
//
// The mapper consumes the SEMANTIC LAYER (SceneKind / status / position), never the
// 2D SVG primitives. It supplies its own 3D geometry family for each core kind:
//   cell        → cell-ground       (extruded parcel prism, the RELAXED-MESH substrate)
//   cell-wheat  → cell-ground       (ditto — wheat is a 2D look, not a different ground)
//   tree        → (SKIPPED)         (the 3D map stands the kit's capability trees, not one hero tree — ADR-0508)
//   trail-fill  → trail-strip       (routed ribbon strip on the ground plane, ADR-0169 §4)
//   trail-ghost → trail-ghost-strip (the under-island run — surfaces may skip it)
//   cave        → cave-arch         (the forced-route portal prop at the rim bearing)
//   wisp        → wisp-sprite       (GPU point / sprite)
//   tall-flower-proven
//               → uat-bloom         (ONE UAT criterion of the owning STORY, SIGNED)
//   tall-flower-pending
//               → uat-bud           (ditto, NOT YET SIGNED — an unopened flower, ADR-0600 D1)
//   tall-flower-failing
//               → uat-wilt          (ditto, WITNESSED FAILING)
//
// Only the trail FILL pass carries geometry into 3D — the shadow/casing passes are
// the 2D cased look, which the ribbon supplies itself; they skip explicitly.
//
// All other SceneKinds yield { kind: 'skipped', sceneKind } — explicit, never a
// throw, never a silent drop. Total coverage is the invariant — EXCEPT for `tile`,
// which is not a "kind this mapper has never heard of" but the one it refuses on
// purpose; see the next paragraph.
//
// ⚠⚠ THE `tile` (CLASSIC extruded-hex) SUBSTRATE IS RETIRED, NOT SKIPPED.
// `@storytree/forest-world` can still emit ground in one of two shapes (`scene.ts:658`):
// the CLASSIC extruded-hex island (`tile` groups, used when `relaxedCells` is null) and
// the RELAXED MESH the studio actually ships (`cell` / `cell-wheat` paths, one per
// parcel). Between ADR-0123 and 2026-08-28 this mapper had a case for the first only, so
// for an island of the shape the product draws it emitted NO GROUND AT ALL — 164 cells
// fell through to the default skip and the shipped canvas rendered one story tree over
// empty space. That was measured, pinned and pictured by
// `adopt-the-land-into-the-shipped-map-arc-inc-01` (PR #1679,
// `docs/research/chapter2-shipped-baseline-2026-08-28/`), and the `cell` case above
// closed it — the mesh substrate has drawn ground ever since.
//
// The `tile` case itself was retired later, once the map's shipped file stopped
// drawing it at all (`retire-the-old-land-path`, `adopt-the-land-into-the-shipped-map-
// arc`'s end-state item 6: "the old path goes, it is not left beside the new one — a
// flag nobody flips is not adoption"). A silent `{ kind: 'skipped', sceneKind: 'tile' }`
// would have been the WRONG shape for that retirement: a scene built with
// `relaxedCells: null` would draw NO GROUND AT ALL again, exactly the 2026-08-28 defect,
// only this time with no signal anywhere that anything had gone wrong. So a `tile` group
// REFUSES outright (see `walkNode`'s `case 'tile'`) — a caller that still builds a
// classic scene finds out immediately, at the mapper, rather than downstream on an
// island with no ground.
//
// ⚠⚠ THE `tree` (PLACEHOLDER STORY TREE) FAMILY IS RETIRED TOO, AND IT SKIPS RATHER
// THAN REFUSES — the OPPOSITE call from `tile` above, on the same question, and the
// difference is what a scene carrying the kind now MEANS. A `tile` group means a caller
// built the wrong substrate, so every scene carrying one is a fault to report. A `tree`
// group means an ORDINARY, CURRENT scene: the 2D maps still draw their hero tree from it
// (`.story-tree .crown-lo circle`, ADR-0226's crown token), and the semantic scene the 3D
// mapper reads is the SAME scene they read. Refusing here would refuse every island on
// the map. So the mapper records the kind it saw and draws nothing, which is exactly what
// `{ kind: 'skipped' }` is for, and what it already does for the 1,088 other objects the
// semantic scene stands on this ground.
//
// WHY IT DRAWS NOTHING (owner, 2026-09-03, ADR-0508): "under this new look the center
// tree will no longer be a thing, each island will be a small grove or forest". The
// hand-built cone-on-a-cylinder predates the bought kit; since ADR-0475 D2 the LAND
// carries the story's own state uniformly across the island, so the cone was a second
// copy of a signal the ground already reports, and it was the one object on the map that
// was not from the pack. What stands in its place is the kit vocabulary's one tree per
// capability (`kit-vocabulary.ts`) — the grove that briefly joined them was retired by
// ADR-0518 on 2026-09-05.
//
// ⚠ THE SEAM IS HERE ON PURPOSE — the mesh could equally have been dropped at the canvas.
// It is retired at the MAPPER because every downstream reader of what stands on the map
// reaches it through this function: the shipped canvas's `<StoryTree>`, the occlusion
// field's `groundCasters`, and — through `shippedCasters()` → `crowdCasters()` — every
// comparison page in `harness/`. Stopping the emission moves all of them at once and
// leaves no second list to keep in step, which is the failure
// `comparison-baseline-moves-under-the-page` names: a page reporting a scene the map no
// longer draws. An emitted-but-undrawn `InstanceDescriptor` would have been exactly that
// second list, since an instance descriptor IS the claim "something stands here".
//
// ⚠⚠ THE SCENE THIS MAPPER READS IS A TRUE-GROUND SURFACE, NOT A DRAWING (ADR-0546, 2026-09-08).
// Hand it a scene built at PLAN VIEW (`PLAN_VIEW_ELEVATION_DEG`) and every (x, y) it walks is
// already a true ground coordinate, so the walk lays it straight onto the ground plane —
// SVG (x, y) → 3D (x, 0, z) — and nothing is un-projected. `buildScene` returns exactly that when
// its caller hands over ground anchors (`SceneTerritoryInput.anchorSpace: 'ground'`) and asks for
// plan view; the studio's packer does.
//
// ⚠ IT USED TO REPAIR A DRAWING INSTEAD, AND THAT IS THE THING THAT WENT. Between 2026-09-05 and
// 2026-09-08 the mapper was handed a scene projected at the declared land camera (20°, so a ground
// depth on the page is `sin 20°` = 0.342 of the real one) and un-squashed each island IN PLACE
// through `restoreTrueFootprint`, holding the layout still (ADR-0517 D1). The owner chose to build
// on true ground instead (ADR-0546 D1): the repair is deleted, and with the whole layout un-squashed
// rather than each island alone, the 3D forest's outline goes from roughly square to a corridor
// about three times deeper than it is wide — measured on the real 14-island layout, 382 × 359
// becomes 382 × 1050, while an island's own footprint (31.7 × 33.5) and the gap to its nearest
// neighbour (+6%) are essentially unmoved. He took that shape SIGHT-UNSEEN and declined the
// comparison page that was offered as its own option; a session that dislikes the picture raises a
// FRESH question about the forest's spacing and does not reverse this on its own judgement
// (ADR-0546 D3).
//
// ⚠ FEEDING IT A DRAWING IS NOW A SQUASHED ISLAND, SILENTLY. There is no elevation argument left
// to get wrong — and no repair left to rescue a caller that hands over the declared camera's
// projection anyway. Measured on the frozen 35-island export: an island 33.1 × 38.5 through the old
// repair reads 56.5 × 22.5 fed straight through. The two committed comparison pages that stand on
// scenes exported BEFORE this landing say so at their own readers (`shipped-spacing-scene.ts`,
// `shipped-island-floor-scene.ts`); every other page builds its scene live and asks for plan view.
//
// ⚠ NOTHING A VISITOR OR AN OPERATOR SEES CHANGES, AND THAT IS PROVED RATHER THAN BELIEVED. This
// function is not on the 2D map's path at all — the studio's SVG painter reads `buildScene`
// directly — and no product surface mounts the 3D canvas. `projection-equivariance.test.ts` is the
// standing fence: a layout that emits true ground and is flattened at draw time draws the identical
// picture.
//
// ⚠ `cell-ground` IS DELIBERATELY THE SAME FIDELITY the retired classic prism was — a
// flat prism wearing the parcel's folded status colour. It is the representation the
// mapper always intended to draw, arriving in the shape the product now emits it. It is
// NOT the land treatment `adopt-the-land-into-the-shipped-map-arc` is carrying toward
// this surface: no relief, no grain, no coast smoothing, no stepped skirt, no terrain.
// Adoption stays a separate, deliberate event (ADR-0380 D6 / ADR-0406 D2) with the
// ADR-0418 D4 replacement check as its precondition — do not graft the treatment in here.

import {
  LAND_CAMERA_ELEVATION_DEG,
  trailFillWidth,
  type MarkerState,
  type Pt,
  type SceneG,
  type SceneNode,
  type ScenePath,
} from '@storytree/forest-world';

import { LAND_AREA_PER_CAPABILITY, sizeIslandsByCapability } from './land-per-capability.js';

// ---------------------------------------------------------------------------
// Descriptor types — the provability-firewall output contract
// ---------------------------------------------------------------------------

/** A 3D world-space position. Coordinate convention: SVG x → 3D x (east),
 *  SVG y → 3D z (depth/south), 3D y is up — and the scene's own coordinates are already TRUE
 *  ground distances rather than the page's foreshortened ones, because the scene was built at plan
 *  view (ADR-0546 D1; see the header). */
export interface Transform3D {
  x: number;
  y: number;
  z: number;
}

/** The 3D mesh family a mapped scene node belongs to. */
export type InstanceKind =
  | 'cell-ground'
  | 'trail-strip'
  | 'trail-ghost-strip'
  | 'cave-arch'
  | 'wisp-sprite'
  | 'coverage-flora'
  | 'uat-bloom'
  | 'uat-bud'
  | 'uat-wilt';

/**
 * WHICH DESCRIPTOR EACH UAT MARKER WRAPPER BECOMES — the whole of ADR-0600 D1 as a table.
 *
 * ⚠⚠ EVERY CRITERION IS DRAWN, AND THE ABSENCE OF A DESCRIPTOR NOW MEANS EXACTLY ONE THING: NO
 * CRITERION (ADR-0600 D2). Until 2026-09-23 only the `proven` wrapper mapped and the other two
 * fell to the default skip, on the reasoning that a bloom is the claim "the owner SIGNED this" so
 * emitting one for an unsigned criterion would assert a signature nobody gave (ADR-0392 D5 /
 * ADR-0398 D7). That reasoning was right about the criterion and wrong about the ISLAND: counted
 * across the real corpus it left 35 of 104 criteria undrawn, nine islands reading as carrying no
 * acceptance work at all and three reading as FULLY PROVEN while holding unsigned criteria
 * (`docs/research/chapter2-uat-silence-2026-09-23/`). The fence is kept and moved: an unsigned
 * criterion gets its own descriptor kind, so no consumer of `uat-bloom` can ever see one.
 *
 * ⚠ THE KEY TYPE IS DERIVED FROM THE CORE'S OWN `MarkerState`, NOT RESTATED. A fourth marker state
 * added to `@storytree/forest-world` reds THIS package's typecheck — which is the only guard that
 * can catch the failure this table exists to end, because the failure is a criterion reaching the
 * map with nothing drawn and nothing anywhere saying so.
 */
export const UAT_MARKER_DESCRIPTOR = {
  'tall-flower-proven': 'uat-bloom',
  'tall-flower-pending': 'uat-bud',
  'tall-flower-failing': 'uat-wilt',
} as const satisfies Record<`tall-flower-${MarkerState}`, InstanceKind>;

/** The marker wrapper kinds this mapper draws — the table's keys, so the two cannot disagree. */
export const UAT_MARKER_KINDS = Object.keys(UAT_MARKER_DESCRIPTOR) as Array<
  keyof typeof UAT_MARKER_DESCRIPTOR
>;

/** Every descriptor kind a UAT criterion can become — the table's values, deduped. */
export const UAT_CRITERION_KINDS: readonly InstanceKind[] = [
  ...new Set(Object.values(UAT_MARKER_DESCRIPTOR)),
];

/** Is this descriptor one acceptance criterion, whatever state it is in? */
export function isUatCriterion(d: Descriptor3D): d is InstanceDescriptor {
  return (UAT_CRITERION_KINDS as readonly string[]).includes(d.kind);
}

/** An instance descriptor: maps one core-family scene node to a 3D mesh instance.
 *  The discriminating `kind` is always an InstanceKind (never 'skipped'). */
export interface InstanceDescriptor {
  kind: InstanceKind;
  /** The world-space 3D transform for this instance. */
  transform: Transform3D;
  /** The instancing group — all descriptors with the same group share a mesh + material
   *  family (maps to an `<Instances>` group in the R3F canvas). */
  group: string;
  /** The material variant, derived from the territory's folded SceneStatus (e.g.
   *  'healthy' / 'unhealthy' / 'proposed'). Set for status-bearing families (cell-ground,
   *  cave-arch, and all three UAT marker kinds); absent on families that don't carry a territory
   *  status. */
  material?: string;
  /** A ground-plane polyline: the family's own path as 3D points, in path order.
   *  On a `trail-strip` / `trail-ghost-strip` it is the segment's smoothed centreline —
   *  the ribbon the canvas lays on the ground; curve control points join the polyline
   *  (the pathPoints approximation). On a `cell-ground` it is the parcel's CLOSED RING,
   *  each vertex once and no repeated first point (`polyPath` closes with `Z`, which
   *  carries no coordinates). Absent on point-like families (uat-bloom / wisp-sprite /
   *  cave-arch, the UAT markers), whose geometry is a primitive at `transform`. */
  points?: Transform3D[];
  /** Ribbon / portal-mouth width in world px. Trail strips: `trailFillWidth(usage)` —
   *  the ONE width rule every surface shares; cave-arch: the portal mouth width. */
  width?: number;
  /** Distinct edges routed through this trail segment (what `width` derives from). */
  usage?: number;
  /** True on an under-island ghost run (`trail-ghost-strip`) — surfaces may skip it. */
  hidden?: boolean;
  /** The stable trail segment id (`trail-strip` / `trail-ghost-strip`). */
  segment?: string;
  /** The `from->to` edge keys through this trail segment / cave portal — the
   *  reveal-by-focus metadata (ADR-0169 §3/§4): a surface filters strips to a focused
   *  island's incident edges without re-walking the graph. */
  edges?: string[];
  /** The cave portal's outward rim normal, radians in the SVG plane (`cave-arch` only).
   *  Under the x→east / y→depth convention, apply as a rotation of -bearing about +Y. */
  bearing?: number;
  /** THE OWNING STORY'S ISLAND ID — which island this instance belongs to.
   *
   *  Set on every family that belongs to exactly ONE island: `cell-ground`
   *  and the UAT markers inherit it from the enclosing island-level group; `cave-arch`
   *  carries its own (`node.island`, the portal's home island — the portal sits on a rim and is
   *  reached through the trails layer, not through a territory group). Absent on `trail-strip` /
   *  `trail-ghost-strip` / `wisp-sprite`: a trail spans two islands and belongs to neither, and
   *  nothing has needed a wisp's.
   *
   *  ⚠ IT IS WHAT MAKES A PER-STORY CLAIM DRAWABLE AT ALL. A UAT bloom is one SIGNED criterion of
   *  one STORY (ADR-0226 D4), so it is a claim about proof state and is bound by the same fence as
   *  the land's colour (ADR-0392 D5 / ADR-0398 D7). Without this field a consumer holding the
   *  whole map's descriptors can only scatter every story's signatures over every story's island —
   *  the map asserting a signature on work nobody signed, which is worse than drawing none. That is
   *  why both shipped call sites passed `blooms: 0` until this field existed.
   *
   *  ⚠ ONLY EVER TAKEN FROM A GROUP THAT SAYS IT IS AN ISLAND — `kind` one of `ground` (the
   *  relaxed-mesh substrate's per-territory ground group), `territory` (the island's flora group,
   *  where the UAT markers live) or `tile` (the classic substrate, where a tile IS a territory).
   *  The core stamps `id: t.id` on all three (`scene.ts:3149` / `:3249` / `:3275`). Every OTHER
   *  `<g>` on an island carries an `id` for its own reasons — a parcel, a trail edge, a hit target
   *  — and inheriting one of those would attribute a story's signatures to a capability while
   *  producing a perfectly ordinary-looking island. Same rule, same reason, as `parcel` below. */
  island?: string;
  /** The UAT criterion this marker stands for (`uat-bloom` / `uat-bud` / `uat-wilt`) — the
   *  criterion id the core carried on the marker wrapper. Absent when the scene stamped none. A
   *  consumer that counts criteria per island can dedupe on it rather than trusting arrival
   *  order. */
  criterion?: string;
  /** THE OWNING CAPABILITY'S ID (`cell-ground` only) — which capability's parcel this
   *  cell belongs to.
   *
   *  ⚠ IT IS NOT DERIVABLE FROM ANYTHING ELSE ON THE DESCRIPTOR, which is why it is carried.
   *  `material` is the FOLDED status, so two capabilities in the same state are one value; the
   *  ring is geometry. Without this field a consumer can draw the ground and cannot say which
   *  capability any part of it reports on — so ADR-0475's ONE OBJECT PER CAPABILITY is not
   *  expressible, and neither is anything else that has to be counted per capability.
   *
   *  ⚠ ONLY EVER TAKEN FROM A GROUP THAT SAYS IT IS A PARCEL (`kind === 'parcel'`), never from
   *  any other `<g id=…>` — every group on an island carries an `id` for its own reasons (a
   *  territory, a trail edge, a hit target), and inheriting one of those would partition the
   *  land along lines that are not capability boundaries while looking entirely plausible. That
   *  rule is `groundCellsFrom`'s (`harness/island-descriptors.ts`) and is restated rather than
   *  re-derived; the two now read the same identity off the same place.
   *
   *  ABSENT on a substrate that has no parcel groups (the classic extruded-hex island, where a
   *  tile IS a territory) and on every non-`cell-ground` family. Absent is a real answer here —
   *  a consumer that needs per-capability identity must handle its absence rather than invent
   *  one. */
  parcel?: string;
}

/** A skip record: a scene node with no core 3D mapping. Never a throw, never a silent
 *  drop — the total-coverage guarantee. */
export interface SkippedDescriptor {
  kind: 'skipped';
  /** The original SceneKind, retained for audit / debugging. */
  sceneKind: string;
}

/** A core coverage-flora wrapper transported into the 3D descriptor layer. */
export interface CoverageFloraDescriptor extends Omit<InstanceDescriptor, 'kind' | 'group' | 'material' | 'island'> {
  kind: 'coverage-flora';
  group: 'coverage-flora';
  capability: string;
  island: string;
  material: string;
  theme: string;
  floraScale: number;
}

/** The discriminated union returned by `worldTo3D`. Discriminant: `kind`. */
export type Descriptor3D = InstanceDescriptor | CoverageFloraDescriptor | SkippedDescriptor;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Parse a `translate(x y)` string (the format buildScene emits for transforms).
 *  Returns { x: 0, y: 0 } when the string is absent or unrecognised. */
function parseTranslate(t: string): Pt {
  const m = /translate\(\s*([-\d.]+)\s+([-\d.]+)/.exec(t);
  if (!m) return { x: 0, y: 0 };
  return { x: parseFloat(m[1]!), y: parseFloat(m[2]!) };
}

/** All coordinate pairs in a path `d` string, in path order. The core emits M/L
 *  polylines (`hexPath` / `polyPath`) and M+C trail splines (`routeTrails` `d`s), so
 *  pairing the numeric stream recovers the vertices. On a curve command the control
 *  points join the polyline — spike-fidelity approximation, deterministic and total. */
function pathPoints(d: string): Pt[] {
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums) return [];
  const pts: Pt[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: parseFloat(nums[i]!), y: parseFloat(nums[i + 1]!) });
  }
  return pts;
}

/** The mean of a point set — the exact centre of a regular polygon's vertices
 *  (the hex tile centre), the midpoint-ish anchor of a trail polyline. */
function centroidOf(pts: Pt[]): Pt {
  if (pts.length === 0) return { x: 0, y: 0 };
  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / pts.length, y: sy / pts.length };
}

/** The first direct child path wearing one of `kinds` (where the core bakes a
 *  family's geometry: the tile's `tile-top`, the cave's `cave-arch` half-disc). */
function childPath(node: SceneG, ...kinds: string[]): ScenePath | null {
  for (const child of node.children) {
    if (child.el === 'path' && child.kind !== undefined && kinds.includes(child.kind)) {
      return child;
    }
  }
  return null;
}

/** Parse the `rotate(deg)` term of a transform string (the cave prop's rim bearing),
 *  returned in RADIANS. 0 when the term is absent. */
function parseRotate(t: string): number {
  const m = /rotate\(\s*([-\d.]+)/.exec(t);
  if (!m) return 0;
  return (parseFloat(m[1]!) * Math.PI) / 180;
}

/**
 * THE GROUP KINDS THAT MAY NAME AN ISLAND — the only places `InstanceDescriptor.island` is ever
 * read from.
 *
 * ⚠ A NAMED SET RATHER THAN A CONDITION SPELLED AT EACH SITE, because the failure mode of getting
 * it wrong is silent: every `<g>` on an island carries an `id`, so widening this by one kind
 * partitions the map along lines that are not story boundaries and draws a perfectly ordinary
 * picture. `ground` is the relaxed-mesh substrate's per-territory ground group, `territory` the
 * island's flora group (the story tree and the UAT markers) — and the core stamps the SAME `t.id`
 * on both.
 *
 * ⚠ `tile` WAS THE THIRD MEMBER, FOR THE NOW-RETIRED CLASSIC SUBSTRATE'S OWN HEX-AS-TERRITORY
 * GROUP. It is gone rather than merely unreachable: `walkNode`'s `case 'tile'` refuses before this
 * set is ever consulted for a tile node's OWN island, so a stale `'tile'` entry here would be a
 * membership nothing can any longer exercise — the kind of dead entry a later reader trusts by
 * accident. `harness/island-descriptors.ts` mirrors this set deliberately (two readers agreeing is
 * the assertion) and dropped `'tile'` in the same landing.
 *
 * ⚠ TYPED `string | undefined` SO THE LOOKUP NEEDS NO GUARD. An anonymous `<g>` carries no kind at
 * all, and a `kind !== undefined &&` in front of `.has(kind)` is a TYPE guard with no runtime
 * meaning — a Set of strings answers `false` for `undefined` on its own. `check:mutation-diff`
 * reads such a guard exactly right: it can be replaced by `true` and no test can notice.
 */
const ISLAND_GROUP_KINDS: ReadonlySet<string | undefined> = new Set(['ground', 'territory']);

/** Split a comma-joined `data-edges` value into edge keys ('' → []). */
function edgeKeys(edges: string | undefined): string[] {
  return (edges ?? '').split(',').filter((e) => e.length > 0);
}

/** Recursively walk a scene node, emitting descriptors into `out`.
 *  `parentXY` carries the accumulated 2D translation from ancestor `<g>` nodes;
 *  it is used to position wisp-sprites at their territory's centroid (the centroid
 *  lives on the `wisps` group's translate, one level above the individual `wisp`).
 *
 *  ⚠ `parentStatus` carries the nearest enclosing group's folded SceneStatus down, and it
 *  is REQUIRED rather than a convenience: on the relaxed-mesh substrate a plain parcel
 *  `cell` carries NO status of its own — the core puts it on the `<g kind="ground"
 *  status=…>` one level up (`scene.ts:3252` vs `:3254`). Read the cell alone and every
 *  parcel on the shipped map draws as `unknown`, which is a map that has stopped reporting
 *  (ADR-0392 D5 / ADR-0398 D7) rather than one that merely looks wrong. The parcels-present
 *  shape DOES stamp per-cell status (`scene.ts:1718`, per-capability rather than
 *  per-territory) and must WIN over the inherited value — hence `node.status ?? parentStatus`
 *  at every level, never the other way round.
 *
 *  ⚠ `parentParcel` carries the OWNING CAPABILITY'S ID down the same way, and it is taken ONLY
 *  from a group whose own `kind` is `parcel`. Every other `<g>` on an island carries an `id`
 *  for its own reasons, so reading `node.id` generally would partition the land along lines
 *  that are not capability boundaries — and it would do it invisibly, because the resulting
 *  picture is a perfectly ordinary island. Unlike status there is no per-cell restatement to
 *  prefer: a `cell` path carries no parcel of its own, so the inherited value is the only
 *  value.
 *
 *  ⚠ `parentIsland` carries the OWNING STORY'S ISLAND ID down by the same rule, taken ONLY from a
 *  group whose own `kind` is one of {@link ISLAND_GROUP_KINDS}. Two kinds rather than one because
 *  the core stamps `id: t.id` on both: the ground group the cells hang under, and the territory
 *  group the story tree and the UAT markers hang under. (A third kind, the classic substrate's
 *  tile — where a tile IS a territory — was retired with the substrate itself; see
 *  {@link ISLAND_GROUP_KINDS}'s own comment.) The two never disagree — both read the same `t.id`
 *  off the same territory — so a descriptor's island is the same value whichever it inherited
 *  from. Reading `node.id` generally instead would attribute a STORY's signed criteria to a
 *  capability's parcel, and the resulting island would look entirely ordinary. */
function walkNode(
  node: SceneNode,
  out: Descriptor3D[],
  parentXY: Pt,
  parentStatus?: string,
  parentParcel?: string,
  parentIsland?: string,
): void {
  const kind = node.kind;
  const status = node.status ?? parentStatus;
  const parcel = kind === 'parcel' ? node.id ?? parentParcel : parentParcel;
  const island = ISLAND_GROUP_KINDS.has(kind) ? node.id ?? parentIsland : parentIsland;

  // Leaf nodes (path / circle / ellipse / polygon / rect / text) carry no children.
  // The trail FILL pass is the ribbon geometry source (ADR-0169 §4) — one strip per
  // visible segment; the ghost pass yields the under-island run as its own kind so a
  // surface can skip it. The shadow/casing passes (the 2D cased look) skip explicitly:
  // the 3D ribbon supplies its own look. All other kinded leaves skip.
  if (node.el !== 'g') {
    if (node.el === 'path' && (kind === 'trail-fill' || kind === 'trail-ghost')) {
      const pts = pathPoints(node.d);
      const mid = centroidOf(pts);
      const usage = node.usage ?? 1;
      const stripKind = kind === 'trail-fill' ? 'trail-strip' : 'trail-ghost-strip';
      // ANNOTATED local, then one guarded assignment — the shape
      // `anti-slop/no-conditional-empty-object-spread` requires.
      const strip: InstanceDescriptor = {
        kind: stripKind,
        transform: { x: parentXY.x + mid.x, y: 0, z: parentXY.y + mid.y },
        group: stripKind,
        points: pts.map((p) => ({ x: parentXY.x + p.x, y: 0, z: parentXY.y + p.y })),
        width: trailFillWidth(usage),
        usage,
        hidden: kind === 'trail-ghost',
        edges: edgeKeys(node.edges),
      };
      if (node.id !== undefined) strip.segment = node.id;
      out.push(strip);
      return;
    }
    // The RELAXED-MESH ground: one closed parcel ring per cell (`polyPath`, `scene.ts:3252`).
    // `cell-wheat` is the SAME ground wearing a 2D wheat look — the retired classic case used
    // to fold its own `tile-top-wheat` into one `hex-ground` the same way, so folding here keeps
    // the wheat look as the SAME drawable rather than inventing a third one this surface has no
    // idea what to do with.
    if (node.el === 'path' && (kind === 'cell' || kind === 'cell-wheat')) {
      const ring = pathPoints(node.d).map((p) => ({ x: parentXY.x + p.x, y: 0, z: parentXY.y + p.y }));
      // A ring of fewer than three vertices bounds no area. Skipping rather than emitting a
      // degenerate parcel keeps `cell-ground` a family a consumer can always build a face from.
      if (ring.length < 3) {
        out.push({ kind: 'skipped', sceneKind: kind });
        return;
      }
      const c = centroidOf(ring.map((p) => ({ x: p.x, y: p.z })));
      // ⚠ THE RING IS PASSED ON IN THE SCENE'S OWN ORDER, winding included. A Voronoi relaxation
      // clipped to an island boundary guarantees neither a handedness nor convexity, and the
      // mapper deliberately does NOT normalise either: `cell-ground-geometry.ts` must be robust to
      // both anyway (it is exported on its own), and normalising in two places is how the two come
      // to disagree about which way is up. Winding is settled once, where it is tested.
      // ANNOTATED local, then one guarded assignment — the shape
      // `anti-slop/no-conditional-empty-object-spread` requires. `parcel` is left OFF rather
      // than set to a placeholder when the substrate has no parcel groups: a consumer must be
      // able to tell "this cell belongs to capability X" from "this substrate does not say".
      const cellDescriptor: InstanceDescriptor = {
        kind: 'cell-ground',
        transform: { x: c.x, y: 0, z: c.y },
        group: 'cell-ground',
        material: status ?? 'unknown',
        points: ring,
      };
      if (parcel !== undefined) cellDescriptor.parcel = parcel;
      if (island !== undefined) cellDescriptor.island = island;
      out.push(cellDescriptor);
      return;
    }
    if (kind) out.push({ kind: 'skipped', sceneKind: kind });
    return;
  }

  // Accumulate this node's translation so children (especially wisp-sprites) can
  // inherit the centroid position from their enclosing `wisps` group.
  const myXY = node.transform ? parseTranslate(node.transform) : { x: 0, y: 0 };
  const childXY = { x: parentXY.x + myXY.x, y: parentXY.y + myXY.y };

  // Emit a descriptor for this node.
  switch (kind) {
    case 'tile': {
      // ⚠⚠ THE RETIRED CLASSIC SUBSTRATE — A REFUSAL, NOT A SKIP. This is the earliest honest
      // point the mapper can tell a classic scene apart from a mesh one: `SceneG` carries no
      // top-level "which substrate" marker of its own (`relaxedCells` lives on the CORE's
      // `SceneInput`, one layer up, never on the scene graph this function walks), so a `tile`
      // group met during the walk is the first and only place the distinction is visible here.
      //
      // A silent `{ kind: 'skipped', sceneKind: 'tile' }` would be the WRONG shape for this
      // retirement: every OTHER unrecognised kind degrades to a skip because drawing nothing for
      // a kind the mapper does not yet understand is honest, but a `tile` group is a kind this
      // mapper understands perfectly well and used to draw — skipping it would silently
      // reproduce the exact 2026-08-28 defect this package exists to keep fixed (a shipped island
      // with no ground at all), only now with no record anywhere that anything had gone wrong.
      // Refusing loudly is what end-state item 6 means by "the old path goes, it is not left
      // beside the new one": a caller that still builds a classic scene finds out immediately,
      // at the mapper, rather than downstream on an island with no ground.
      throw new Error(
        'world-to-3d: the 3D map draws the relaxed-mesh land only — the classic extruded-hex ' +
          'ground was retired (adopt-the-land-into-the-shipped-map-arc, retire-the-old-land-path); ' +
          'build the scene with relaxedCells, not drawTiles',
      );
    }

    // Stryker disable next-line StringLiteral: EQUIVALENT for the mutant generated, stated
    // precisely rather than claimed in general. Stryker rewrites this label to `case ""`, and a
    // node whose `kind` is `'tree'` then matches no case and falls to `default:` — which runs
    // `if (kind) out.push({ kind: 'skipped', sceneKind: kind })` and, `'tree'` being truthy,
    // produces a BYTE-IDENTICAL descriptor. The mutant is separable only by a node whose `kind` is
    // the empty string: the mutated `case ""` would emit `sceneKind: ""` where the real code falls
    // to `default` and its `if (kind)` guard emits nothing. `kind` is `node.kind` (`SceneKind |
    // undefined`, `world-to-3d.ts:334`), so `""` is not a value the type admits and no fixture can
    // construct one without lying about the scene.
    //
    // ⚠ THE CASE IS KEPT RATHER THAN DELETED, and its being equivalent is the reason to say so
    // here rather than to fold it into `default`. It carries MEANING that its output cannot: a
    // `tree` group is a core kind this mapper understands and DELIBERATELY draws nothing for,
    // which is a different statement from `default`'s "a kind nobody has taught this mapper yet",
    // even where the two agree byte for byte. That is the same distinction `case 'tile'` makes one
    // branch above, and the place a reader will look for the retirement.
    case 'tree':
      // ⚠⚠ THE PLACEHOLDER STORY TREE IS RETIRED FROM THE 3D MAP — A SKIP, NOT A REFUSAL, and
      // not a `story-tree` instance either. Until 2026-09-04 this case emitted one, and the
      // shipped canvas drew a cylinder trunk under a cone crown at every island's centre. The
      // owner retired it (ADR-0508): "under this new look the center tree will no longer be a
      // thing, each island will be a small grove or forest". What stands in its place is the kit
      // vocabulary's one tree per capability — the grove itself was retired by ADR-0518.
      //
      // ⚠ IT SKIPS RATHER THAN REFUSING, which is the opposite call from `case 'tile'` above and
      // the difference is what a scene carrying the kind means. A `tile` group means the caller
      // built the wrong substrate — a fault, on every scene carrying one. A `tree` group means an
      // ordinary current scene: the 2D maps still draw their own hero tree from it and read the
      // SAME semantic scene, so refusing here would refuse every island. Recording the kind and
      // drawing nothing is what `skipped` is for, and is already what this mapper does for the
      // 1,088 other objects the semantic scene stands on this ground.
      //
      // ⚠ AND IT IS A SKIP RATHER THAN AN UNDRAWN INSTANCE, which is the seam decision. An
      // `InstanceDescriptor` is the claim "something stands here" — `groundCasters` darkens the
      // ground beneath one, `harness/main.tsx` counts them, and `shippedCasters()` hands them to
      // every comparison page. Emitting one nothing draws would leave a second list to keep in
      // step with the canvas, which is `comparison-baseline-moves-under-the-page` exactly.
      out.push({ kind: 'skipped', sceneKind: kind });
      break;

    case 'parcel-flora': {
      // Coverage flora is semantic transport, not SVG recovery: the core carries the capability,
      // absolute ground anchor, theme, status, and scale on the wrapper itself. A malformed
      // wrapper is visible to callers as a skip rather than guessed from its drawing transform.
      if (
        node.id === undefined ||
        node.status === undefined ||
        node.theme === undefined ||
        node.groundAnchor === undefined ||
        node.floraScale === undefined ||
        island === undefined
      ) {
        out.push({ kind: 'skipped', sceneKind: kind });
        break;
      }
      out.push({
        kind: 'coverage-flora',
        transform: { x: node.groundAnchor.x, y: 0, z: node.groundAnchor.y },
        group: 'coverage-flora',
        capability: node.id,
        island,
        material: node.status,
        theme: node.theme,
        floraScale: node.floraScale,
      });
      break;
    }

    case 'tall-flower-proven':
    case 'tall-flower-pending':
    case 'tall-flower-failing': {
      // ONE UAT CRITERION OF THE OWNING STORY → one descriptor, ALWAYS (ADR-0226 D4, one flower
      // per criterion, the verdict read from the FORM; ADR-0600 D1, every criterion is drawn and
      // signing changes the flower's STATE rather than its existence). The marker wrapper carries
      // a `translate(x y) scale(s)` which is folded into childXY; the scale is the 2D marker's own
      // drawing size and means nothing to a 3D consumer, which stands its own prop here.
      //
      // ⚠⚠ THE THREE STATES ARE THREE KINDS, NOT ONE KIND CARRYING A FIELD, and the direction of
      // that choice is the point. `uat-bloom` still means exactly "the owner SIGNED this", so
      // every consumer that already filters on it — `signedCriteriaByIsland`, the harness counts —
      // stays true with no edit and CANNOT come to over-report a signature by forgetting a state
      // filter. A single kind with a `state` field would have made the safe reading the one you
      // have to remember, which is the failure mode ADR-0392 D5 / ADR-0398 D7 fence.
      //
      // ⚠ THE KIND COMES FROM {@link UAT_MARKER_DESCRIPTOR}, never from a literal here, so the
      // switch cannot drift from the table the typecheck holds exhaustive.
      const marker: InstanceDescriptor = {
        kind: UAT_MARKER_DESCRIPTOR[kind],
        transform: { x: childXY.x, y: 0, z: childXY.y },
        group: UAT_MARKER_DESCRIPTOR[kind],
        material: status ?? 'unknown',
      };
      if (island !== undefined) marker.island = island;
      if (node.id !== undefined) marker.criterion = node.id;
      out.push(marker);
      break;
    }

    case 'cave': {
      // A forced-route cave portal → a rim-mounted arch prop (ADR-0169 §2/§4). The
      // group's translate positions it (already folded into childXY); its rotate is
      // the outward rim normal in the SVG plane. The mouth width is recovered from
      // the baked arch half-disc (`M 0 -hw A hw …`, hw = width·1.6/2), round-tripping
      // the core's 0.1-rounding (±0.07 world px — placement fidelity, not survey data).
      // Material = the island's folded status (the shadow/side-wall hue family).
      const bearing = node.transform ? parseRotate(node.transform) : 0;
      const arch = childPath(node, 'cave-arch');
      const nums = arch ? arch.d.match(/-?\d+(?:\.\d+)?/g) : null;
      const hw = nums && nums[1] !== undefined ? Math.abs(parseFloat(nums[1])) : 0;
      // ANNOTATED local, then one guarded assignment — the shape
      // `anti-slop/no-conditional-empty-object-spread` requires.
      const archDescriptor: InstanceDescriptor = {
        kind: 'cave-arch',
        transform: { x: childXY.x, y: 0, z: childXY.y },
        group: 'cave-arch',
        material: status ?? 'unknown',
        bearing,
        width: (hw * 2) / 1.6,
        edges: edgeKeys(node.edges),
      };
      if (node.island !== undefined) archDescriptor.island = node.island;
      out.push(archDescriptor);
      break;
    }

    case 'wisp':
      // An individual in-flight build wisp → wisp-sprite GPU point.
      // `parentXY` (= childXY since wisp carries no own translate) holds the
      // centroid position inherited from the enclosing `wisps` group's translate.
      out.push({
        kind: 'wisp-sprite',
        transform: { x: childXY.x, y: 0, z: childXY.y },
        group: 'wisp-sprite',
      });
      break;

    default:
      // Non-core / structural node → explicit skip. Nodes with no kind at all
      // (anonymous <g> wrappers) produce no output; the `if (kind)` guard handles that.
      if (kind) out.push({ kind: 'skipped', sceneKind: kind });
      break;
  }

  // Always recurse into children so every descendant gets its own descriptor
  // (core descendants emit instances; non-core descendants emit skips).
  for (const child of node.children) {
    walkNode(child, out, childXY, status, parcel, island);
  }
}

// ---------------------------------------------------------------------------
// The public mapping function
// ---------------------------------------------------------------------------

/**
 * Maps a `buildScene` output (the @storytree/forest-world semantic scene graph) to
 * a flat array of typed 3D instance descriptors — the ADR-0123 provability firewall.
 *
 * Core kind families emit `InstanceDescriptor` objects, each POSITIONED from the
 * real World geometry (the faithfulness contract): the parcel's own ring centroid
 * (`polyPath`), the trail segment's routed polyline
 * (carried as `points` + a centroid anchor, width from the ONE `trailFillWidth` rule),
 * the cave's rim translate+rotate, the wisp's territory centroid:
 * - `cell` / `cell-wheat`
 *                 → `cell-ground`       (parcel prism; material = territory SceneStatus)
 * - `tree`        → SKIPPED             (the placeholder story tree is retired from the 3D map —
 *                                        ADR-0508; each island stands its capability trees instead,
 *                                        and the 2D maps keep drawing their own hero tree from the same node)
 * - `trail-fill`  → `trail-strip`       (ground-plane ribbon; usage/edges/segment metadata)
 * - `trail-ghost` → `trail-ghost-strip` (the under-island run — surfaces may skip it)
 * - `cave`        → `cave-arch`         (rim portal prop; bearing = rotation about Y)
 * - `wisp`        → `wisp-sprite`       (GPU sprite / point)
 * - `tall-flower-proven`
 *                 → `uat-bloom`         (one SIGNED UAT criterion of the owning story)
 * - `tall-flower-pending`
 *                 → `uat-bud`           (one UNSIGNED criterion — an unopened flower, ADR-0600 D1)
 * - `tall-flower-failing`
 *                 → `uat-wilt`          (one criterion witnessed FAILING)
 *
 * `tile` REFUSES rather than mapping (see `walkNode`'s `case 'tile'`) — the classic
 * extruded-hex substrate was retired (`retire-the-old-land-path`), and the shipped map draws
 * the relaxed mesh only.
 *
 * Every descriptor's ground z is a TRUE ground depth because the SCENE's already is: the walk maps
 * (x, y) to (x, 0, z) and un-projects nothing (ADR-0546 D1 — see the header). Build the scene at
 * `PLAN_VIEW_ELEVATION_DEG`; a scene projected at the declared land camera is a drawing, and this
 * function will lay its squashed ground down as written.
 *
 * Every family that belongs to exactly one island carries that island's id
 * (`InstanceDescriptor.island`), taken only from a `ground` / `territory` group. It is
 * what lets a consumer holding the WHOLE map's descriptors keep one story's claims on one story's
 * island; without it a per-story count is a misreport waiting to be drawn.
 *
 * Trail strips are REVEAL METADATA carriers (ADR-0169 §3/§4): every strip lists the
 * `from->to` edge keys routed through it, so a surface filters to a focused island's
 * incident edges — the descriptor layer never decides visibility; default-hidden is
 * the surface's call.
 *
 * Every other SceneKind — EXCEPT the retired `tile` — emits a `SkippedDescriptor` object
 * rather than a throw or a silent drop (total-coverage invariant). `tile` is the one
 * deliberate exception: it is a kind this mapper understands and used to draw, so a skip
 * there would silently reproduce the classic-substrate ground gap this package exists to
 * keep fixed. Refusing it loudly is what makes the retirement adoption rather than a flag
 * nobody flips. The result is otherwise deterministic: the same scene graph always
 * produces a byte-identical descriptor array (or the same refusal).
 */
export function worldTo3D(scene: SceneG, opts: WorldTo3DOptions = {}): Descriptor3D[] {
  const out: Descriptor3D[] = [];
  walkNode(scene, out, { x: 0, y: 0 });
  const ratio = opts.landAreaPerCapability;
  if (ratio === null) return out;
  return sizeIslandsByCapability(out, ratio === undefined ? LAND_AREA_PER_CAPABILITY : ratio);
}

/** What the mapper needs to know about the scene beyond the scene itself. */
export interface WorldTo3DOptions {
  /** The land each island is sized to, in ground units² per capability
   *  (`land-per-capability.ts`). Omitted is the shipped `LAND_AREA_PER_CAPABILITY`. A number is a
   *  ladder rung — the comparison page's arms pass one each. `null` leaves every island AT THE
   *  SIZE THE DRAWING GAVE IT, which is an INSTRUMENT'S option and not a map's: it is what a
   *  "before this landing" control arm stands on, and what the crowd layout sizes its frame from,
   *  because the real map's spacing is the drawing's. The shipped canvas never passes it. */
  landAreaPerCapability?: number | null;
}
