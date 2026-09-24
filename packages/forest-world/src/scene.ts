// scene.ts — the framework-agnostic SCENE-GRAPH (ADR-0093, strategy C). The
// defining layer of the shared render core: a pure `buildScene(input)` that turns
// the structural per-island drawable data into a tree of typed *drawables* — `g`
// groups + resolved primitive shapes (`path`/`circle`/`ellipse`/`polygon`/`rect`/
// `text`). Both surfaces render FROM this through a thin per-surface mapper (the
// studio → React; the website → SVG strings).
//
// The boundary (ADR-0093 §4): the scene carries RESOLVED GEOMETRY plus an
// app-neutral semantic `kind` / `variant` / ALREADY-FOLDED visual `status`, and
// `data-id`/`data-from`/`data-to` hooks for the delegation surface — but **no app
// class strings, no live data, no React**. Each mapper owns the kind → class(es)
// translation and the behaviour (the studio binds per-node React handlers; the
// website uses `data-id` event delegation). Status arrives folded by the surface
// (the studio's `worldStatus.ts` provenStatus, etc.) — the data→visual-status fold
// never enters the core.
//
// Geometry is replicated FROM the studio's canonical drawables (TreeView.tsx:
// StoryTree / GardenPlant / DecorTree / IslandGround / the signpost
// / the wisp orbit / the nameplate) — the studio wins where it diverges from the
// website's pure render (the seed of this extraction). Coordinates are formatted to
// one decimal place; the studio's inline JSX mixed raw + toFixed, so the mapper's
// output is VISUALLY identical (sub-pixel), not byte-identical — visual parity is
// operator-attested (ADR-0070), determinism + shape correctness is red-green here.

import { hash, rand01 } from './rng.js';
import {
  LAND_CAMERA_ELEVATION_DEG,
  groundPolarOffset,
  groundRadiusToScreenHalfHeight,
  projectGround,
  unprojectGround,
  uprightForeshortening,
} from './camera.js';
import {
  type Axial,
  type Pt,
  HEX_R,
  TILE_DEPTH_WORLD,
  axialKey,
  hexCenter,
  hexPath,
  polyPath,
  PRE_ADR0528_TILE,
} from './hex.js';
import { FLORA_ART_RUNG, PLATE_ART_RUNG, TRAIL_ART_RUNG, TREE_ART_RUNG, crownRadius } from './sizing.js';
import {
  type TrailCave,
  type TrailNetwork,
  type TrailSegment,
  trailFillWidth,
} from './routing.js';
import { smoothLoopPath } from './coast.js';
import type { DrawTile, RelaxedCell } from './substrate.js';

// ---------------------------------------------------------------------------
// The scene-graph IR
// ---------------------------------------------------------------------------

/** The visual status a drawable WEARS, already folded by the surface (the proof /
 *  live-data fold stays out of the core — ADR-0093 §4). */
export type SceneStatus =
  | 'healthy'
  | 'mapped'
  | 'proposed'
  | 'building'
  | 'unhealthy'
  | 'unknown';

/**
 * An app-neutral SEMANTIC role for a node — each mapper translates it to its own
 * class(es) (the studio's `story-tree`/`crown-lo`/…, the website's `tw-*`). The
 * core never names an app's classes; it names the ROLE the shape plays.
 */
export type SceneKind =
  // structural layers
  | 'world'
  | 'empties-layer'
  | 'coast-layer'
  | 'ground-mesh'
  | 'ground-hex'
  | 'trails-layer'
  | 'flora-layer'
  | 'hits-layer'
  // coast / ground
  | 'empty'
  | 'coast'
  | 'coast-shore'
  | 'ground'
  | 'cell'
  | 'cell-wheat'
  | 'tile'
  | 'tile-side'
  | 'tile-top'
  | 'tile-top-wheat'
  // the trail network (ADR-0169 §2) — full cased passes over shared segments, so a
  // merged trunk reads as ONE trail (the cartographic casing rule), plus the
  // non-visual per-edge reveal metadata and the cave-portal prop.
  | 'trail-shadow-pass'
  | 'trail-casing-pass'
  | 'trail-fill-pass'
  | 'trail-ghost-pass'
  | 'trail-shadow'
  | 'trail-casing'
  | 'trail-fill'
  | 'trail-ghost'
  | 'trail-edges'
  | 'trail-edge'
  | 'cave'
  | 'cave-apron'
  | 'cave-arch'
  | 'cave-rim'
  // a whole island's flora group
  | 'territory'
  // the central story tree
  | 'tree'
  | 'shadow'
  | 'trunk'
  | 'crown-lo'
  | 'crown-hi'
  | 'bare'
  | 'litter'
  // the human-witness signpost
  | 'sign-blank'
  | 'sign-pass'
  | 'sign-fail'
  | 'sign-post'
  | 'sign-head'
  // the UAT markers (forest-parcels inc 2; stones → tall flowers, grounded-art inc 7). The story's UAT
  // criteria as TALL-FLOWER markers scattered deterministically around the island. The owner rejected
  // the standing-stones as noisy/colliding (#832) and directed a cosy stand-in (2026-07-20): one soft,
  // flat flower per criterion, its STATE read from FORM — a bloomed daisy = proven, a closed bud =
  // pending, a wilted nodding head = failing (the `sign-blank/pass/fail` precedent). The WRAPPER kind
  // encodes the state + carries the criterion id; the body marks come from the `tallFlowerMarks` painter
  // on the child kinds below (+ the shared `shadow`). Colour stays CSS-side (ADR-0093 §4). No group
  // kind: each flower is its own y-sorted drawable inside the territory, so painter depth interleaves
  // with the tree + flora.
  | 'tall-flower-proven'
  | 'tall-flower-pending'
  | 'tall-flower-failing'
  | 'tall-flower-stem'
  | 'tall-flower-leaf'
  | 'tall-flower-petal'
  | 'tall-flower-center'
  | 'tall-flower-bud'
  | 'tall-flower-glow'
  // the cosy-island GARDEN's flat decorative accents (grounded-art inc 11 unit 3) — a lavender bed and
  // grass tufts in the attested tall-flower FLAT style (no isometric shading; colour is CSS-class,
  // ADR-0093 §4). Decorative only — they carry no verdict. R3F auto-skips them (the mapper's default).
  | 'garden-lavender-stem'
  | 'garden-lavender-head'
  | 'garden-grass-blade'
  // baked art in the shared scene (ADR-0218) — the fenced paint-carrying family, KEPT as dormant
  // reusable machinery. `baked-defs` is the once-per-scene definition LAYER (a mapper renders it into
  // `<defs>`, non-rendering); `baked-art` is a placement `<use>` referencing a def. The UAT-marker
  // stone that once produced these retired with the tall-flower markers (grounded-art inc 7); the
  // family stays wired through the mapper for a future baked object type (see `SceneInput.bakedStone`).
  | 'baked-defs'
  | 'baked-art'
  // a capability as garden flora
  | 'flora'
  | 'flora-hit'
  | 'dead-ground'
  | 'flora-bed'
  | 'flora-dark'
  | 'flora-light'
  | 'flora-core'
  | 'flora-stem'
  | 'flora-dead-stem'
  | 'flora-dead-head'
  | 'flora-dead-twig'
  | 'sapling-trunk'
  // conifer decor
  | 'conifer'
  | 'conifer-body'
  | 'conifer-snow'
  // capability PARCELS (forest-parcels inc 1) — a capability rendered as a parcel of the island's
  // existing relaxed-cell ground, tinted by the cap's status and surfaced by a `SurfaceTheme`. The
  // ground cells stay the existing `cell`/`cell-wheat` kinds (per-cell `status` now set) so no new
  // ground CSS is needed; `parcel` is a transparent identity/delegation `<g>` (carries the capId).
  // The flora marks are a small GENERIC vocabulary shared across themes — the theme reaches the
  // mapper via the node's `theme` field (a `theme-<t>` class), the parcel's status via `status`; the
  // colour itself stays CSS-side (ADR-0093 §4). `variant` distinguishes facets within a kind.
  | 'parcel' // per-capability ground group (transparent — cells inside carry the visible tint)
  | 'parcel-flora' // one placed flora item (a grass tuft / tree / shrub), positioned by transform
  | 'parcel-blade' // a grass blade / tussock / young sprout stroke
  | 'parcel-shrub' // a foliage blob — bush dome / tree crown
  | 'parcel-stem' // a woody stem / trunk / bare twig
  | 'parcel-flower' // a small accent disc — flower petal (variant 0) / core or berry (variant 1) / dead fleck
  // the in-flight build wisp orbit
  | 'wisps'
  | 'wisp'
  | 'wisp-hit'
  | 'wisp-glow'
  | 'wisp-dot'
  // the story-CLAIM wisp orbit (ADR-0138 §5) — a session is working this story.
  // A DISTINCT drawable family from the build wisp: it carries a `colourState`
  // (authoring / proving / supplementing) and never a proof mark, so the §5 honesty
  // wall holds at the kind level. Since ADR-0529/0536 retired the verdict bloom there
  // is NO per-landing proof drawable in this vocabulary at all, so the wall now holds
  // BY CONSTRUCTION: a claim cannot be mistaken for a proof because no kind here is a
  // proof. What still carries proof is the island's status hue and the legend's proof
  // row — neither of which a coordination drawable can reach.
  | 'claim-wisps'
  | 'claim-wisp'
  | 'claim-wisp-hit'
  | 'claim-wisp-glow'
  | 'claim-wisp-dot'
  // the claim-GRADE drawable families (ADR-0200 D7) — which geometry a claim's grade selects.
  // `hover-wisp*`: an exploring claim window-shopping BESIDE the story tree — a small local orbit
  //   around a per-key rest spot (ADR-0212 reversed ADR-0200 D7's stationary rule; it carries a
  //   `phase` and the rest spot lives on a PARENT `g` so the mapper's rotate can't replace it).
  // `queue-wisp*`: a waiting claim in the visible queue line (index-placed in input order, stationary).
  // `departing-wisp*` (under the `departing-wisps` layer): a released claim fading out (`ageRatio`).
  // ALL are coordination drawables behind the same ADR-0138 §5 honesty wall as `claim-wisp*`
  // — a claim (or its departure) is not a proof. With the verdict bloom retired the wall is
  // structural rather than a rule to keep: this vocabulary has no proof drawable to borrow.
  | 'hover-wisp'
  | 'hover-wisp-hit'
  | 'hover-wisp-glow'
  | 'hover-wisp-dot'
  | 'queue-wisp'
  | 'queue-wisp-hit'
  | 'queue-wisp-glow'
  | 'queue-wisp-dot'
  | 'departing-wisps'
  | 'departing-wisp'
  | 'departing-wisp-hit'
  | 'departing-wisp-glow'
  | 'departing-wisp-dot'
  // the nameplate
  | 'plate'
  | 'plate-bg'
  | 'plate-id'
  | 'plate-sub'
  // the delegation hit area (website)
  | 'hit';

/** The fields every drawable may carry — all optional, set only where the node
 *  needs it (so the mapper translates exactly what's present). */
export interface SceneNodeBase {
  /** The semantic role; absent on a structural-only `<g>` or an unclassed child. */
  kind?: SceneKind;
  /** A numeric variant suffix the mapper formats per role (cell `v-N`, conifer `c-N`). */
  variant?: number;
  /** The folded visual status; the mapper appends its `st-<status>` etc. */
  status?: SceneStatus;
  /** `data-id` — the unit this node belongs to (focus / hover / delegation). */
  id?: string;
  /** A land cell's SHAPE-FREE identity (ADR-0367) — see {@link landCellId}. Carried on the
   *  `cell`/`cell-wheat` paths of a relaxed-substrate island's ground, and on nothing else. NON-VISUAL
   *  and NOT a `data-*` hook: it exists so the per-cell accretion reveal can be indexed by WHICH cell
   *  this is instead of by the bytes of its own `d` string. */
  cellId?: string;
  /** `data-from` — a trail edge's source story. */
  from?: string;
  /** `data-to` — a trail edge's target story. */
  to?: string;
  /** `data-usage` — distinct edges routed through a trail segment (drives width). */
  usage?: number;
  /** `data-edges` — comma-joined `from->to` keys through a trail segment / cave portal. */
  edges?: string;
  /** `data-spur` — a usage-1 trail fill (the mapper dashes it; a trunk stays solid). */
  spur?: boolean;
  /** `data-segments` — an edge's ordered segment chain, `id:F,id2:R,…` (F/R = orientation),
   *  so a surface drives reveal-on-focus without re-walking the graph (ADR-0169 §3). */
  segments?: string;
  /** `data-island` — the island a cave portal sits on. */
  island?: string;
  /** A `<title>` tooltip child (surface vocabulary, folded in by the surface). */
  title?: string;
  /** A `transform` attribute (already-formatted). */
  transform?: string;
  /** A resolved opacity. */
  opacity?: number;
  /** A resolved `stroke-width` (the dead-flora strokes). */
  strokeWidth?: number;
  /** An additive accent modifier (a node that wears a second semantic class). */
  accent?: boolean;
  /** A capability parcel's SURFACE THEME (forest-parcels inc 1) — the mapper appends its
   *  `theme-<t>` class so meadow / woodland / heath flora read as distinct country. Carried on the
   *  `parcel-flora` item group; the colour itself stays CSS-side (ADR-0093 §4). */
  theme?: SurfaceTheme;
  /** The absolute ground-space pivot for a coverage-flora item's tile-art scale. Carried only by
   *  `parcel-flora`, so consumers need not reverse-engineer the SVG pivot transform. */
  groundAnchor?: Pt;
  /** The tile-art scale applied about {@link groundAnchor}. Carried only by `parcel-flora`. */
  floraScale?: number;
  /** A wisp's orbit phase in degrees (the mapper drives the rotation from it). */
  phase?: number;
  /** A wisp's red→green BAND, folded from the live prove-it-gate phase (ADR-0048 §3 v2): `red`
   *  while authoring/confirming the failing test, `green` on the green observation/gate, `building`
   *  while implementing (and when no phase is known). A SEPARATE field from the orbit `phase`
   *  (location ⟂ form); the mapper appends its `band-<phaseBand>` class. */
  phaseBand?: WispPhaseBand;
  /** A story-CLAIM wisp's subagent colour-state (ADR-0138 §5) — what the orchestrator is doing on
   *  the claimed story: `authoring` (story-author), `proving` (red→green leaf), `supplementing`
   *  (glue). Carried on a `claim-wisp` node; the mapper appends its `state-<colourState>` class.
   *  GUARANTEED never to be a PROOF signal (the honesty wall) — a claim is not a proof. ALSO carried
   *  on a BUILD `wisp` when the live work-event stamped one (advisory role tint, additive to
   *  `phaseBand`). A SEPARATE field from `phase` (the orbit rotation) — location ⟂ form. */
  colourState?: ClaimColourState;
  /** A departing claim wisp's progress through the departure window, 0..1 (ADR-0200 D7) — the
   *  surface computes it; the mapper turns it into the fade (the opacity curve is mapper/CSS-side,
   *  the later operator-attested LOOK stage). Carried on a `departing-wisp` node. */
  ageRatio?: number;
}

/** The wisp's three visual bands (ADR-0048 §3 v2) — the mapper's `band-red`/`band-green`/
 *  `band-building` class suffix. */
export type WispPhaseBand = 'red' | 'green' | 'building';

/** The three ADR-0138 §5 subagent colour-states a story-CLAIM wisp wears — what the orchestrator is
 *  doing on the claimed story. DUPLICATED as the core's OWN input vocabulary (the scene-graph is a
 *  foundational root that depends on nothing — ADR-0093 §Open call 2), mirroring `@storytree/drive`'s
 *  `subagentColourState` output. GUARANTEED never a PROOF signal: a claim is a coordination signal,
 *  never a proof. Since ADR-0529/0536 retired the verdict bloom the only proof signal left on the map
 *  is the island's proven-green STATUS hue, which a claim drawable cannot reach — so the wall holds by
 *  construction rather than by rule. The mapper appends its `state-<colourState>` class. */
export type ClaimColourState = 'authoring' | 'proving' | 'supplementing';

/** The three claim GRADES a story claim wears (ADR-0200 D2 / D7) — which drawable family the claim
 *  renders as: `exploring` hovers at rest beside the tree, `waiting` queues in the visible line,
 *  `work` orbits (today's claim wisp). DUPLICATED as the core's OWN input vocabulary (the
 *  scene-graph is a foundational root that depends on nothing — ADR-0093 §Open call 2), mirroring
 *  `@storytree/notice-board`'s `ClaimGrade` exactly as `ClaimColourState` mirrors the drive's. An
 *  ABSENT grade IS the work claim (the D2 back-compat default), so every pre-grade surface keeps
 *  today's orbit unchanged. */
export type ClaimGrade = 'exploring' | 'waiting' | 'work';

/** A capability parcel's SURFACE THEME (forest-parcels inc 1) — which per-theme surface function
 *  (`SURFACES[theme]`) paints its patch of ground + flora. DUPLICATED as the core's OWN input
 *  vocabulary (the scene-graph is a foundational root that depends on nothing — ADR-0093 §Open
 *  call 2), mirroring the surface swarm's theme set (meadow / woodland / heath) rather than importing
 *  it. The surface fold folds each capability's real theme into this. */
export type SurfaceTheme = 'meadow' | 'woodland' | 'heath';

/** A UAT criterion's proof state on the island's markers (forest-parcels inc 2; tall flowers,
 *  grounded-art inc 7) — how the criterion's flower reads BY FORM: `proven` is a bloomed daisy,
 *  `pending` a closed bud, `failing` a wilted nodding head. DUPLICATED as the core's OWN input
 *  vocabulary (the scene-graph is a foundational root that depends on nothing — ADR-0093 §Open call 2),
 *  mirroring the surface's folded per-criterion proof state rather than importing the proof machinery.
 *  Encoded in the marker WRAPPER's kind (`tall-flower-proven`/`-pending`/`-failing`), never as live data. */
export type MarkerState = 'proven' | 'pending' | 'failing';

/** The prove-it-gate's phases (ADR-0020 §1), DUPLICATED as the core's OWN input vocabulary — the
 *  scene-graph is a foundational root that depends on nothing (ADR-0093 §Open call 2), so it mirrors
 *  the union rather than importing the orchestrator or proof-protocol. The surface folds its live
 *  build phase into this when it has one. */
export type BuildPhase =
  | 'AUTHOR_TEST'
  | 'CONFIRM_RED'
  | 'IMPLEMENT'
  | 'CONFIRM_GREEN'
  | 'GATE';

/** Fold a gate phase → the wisp's red→green band (ADR-0048 §3 v2). `red` while the failing test is
 *  authored/confirmed, `green` once the implementation is observed green / at the gate, `building`
 *  while implementing — and the neutral default when no phase is known (a pre-ADR-0048 mark). */
export function wispBand(phase: BuildPhase | undefined): WispPhaseBand {
  switch (phase) {
    case 'AUTHOR_TEST':
    case 'CONFIRM_RED':
      return 'red';
    case 'CONFIRM_GREEN':
    case 'GATE':
      return 'green';
    case 'IMPLEMENT':
    default:
      return 'building';
  }
}

export interface SceneG extends SceneNodeBase {
  el: 'g';
  children: SceneNode[];
}
export interface ScenePath extends SceneNodeBase {
  el: 'path';
  d: string;
}
export interface SceneCircle extends SceneNodeBase {
  el: 'circle';
  cx: number;
  cy: number;
  r: number;
}
export interface SceneEllipse extends SceneNodeBase {
  el: 'ellipse';
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}
export interface ScenePolygon extends SceneNodeBase {
  el: 'polygon';
  points: string;
}
export interface SceneRect extends SceneNodeBase {
  el: 'rect';
  x: number;
  y: number;
  width: number;
  height: number;
  rx: number;
}
export interface SceneText extends SceneNodeBase {
  el: 'text';
  x: number;
  y: number;
  text: string;
  anchor: 'start' | 'middle' | 'end';
}

/**
 * A resolved-paint baked drawable (ADR-0218) — the procedural-architecture factory's `BakedNode`
 * vocabulary, DUPLICATED here because the scene-graph is a foundational root that depends on nothing
 * (ADR-0093 §Open call 2), exactly as it duplicates `ClaimGrade` / `SurfaceTheme` / the gate phases.
 *
 * THIS IS THE ONE SHAPE IN THE SCENE-GRAPH THAT CARRIES PAINT. It exists because a bake's fill is its
 * material colour modulated by N·L, so two facets of one solid differ and no CSS class can name them —
 * the exact case ADR-0093 §4's colour-is-class rule cannot cover, and the fenced exception ADR-0218
 * opens. It is confined to a `baked-def`'s `nodes`; `SceneNodeBase` stays colour-free.
 */
export type BakedPaintNode =
  | { el: 'polygon'; points: string; fill: string; stroke: string; strokeWidth: number; opacity?: number }
  | { el: 'path'; d: string; fill: string; stroke: string; strokeWidth: number; opacity?: number; fillRule?: 'evenodd' }
  | { el: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; opacity?: number };

/** A baked-art DEFINITION (ADR-0218): the paint-carrying drawable list, defined ONCE in the scene's
 *  `baked-defs` layer and referenced by every `SceneBakedUse`. Define-once-reference-many is the
 *  node-cost contract (ADR-0069): one def, N cheap uses, instead of the solid inlined per placement. */
export interface SceneBakedDef extends SceneNodeBase {
  el: 'baked-def';
  /** the id a `baked-use` references; the mapper stamps it as the SVG element `id` */
  defId: string;
  /** the resolved drawables, already in painter order — paint them in sequence */
  nodes: BakedPaintNode[];
}

/** A baked-art PLACEMENT (ADR-0218): a paint-FREE `<use>` of a `baked-def`. Carries only the ordinary
 *  semantic fields (its own `transform`, the marker `id` on its wrapper) — never colour. */
export interface SceneBakedUse extends SceneNodeBase {
  el: 'baked-use';
  defId: string;
}

export type SceneNode =
  | SceneG
  | ScenePath
  | SceneCircle
  | SceneEllipse
  | ScenePolygon
  | SceneRect
  | SceneText
  | SceneBakedDef
  | SceneBakedUse;

// ---------------------------------------------------------------------------
// The structural INPUT contract (ADR-0093 design fork → option b)
// ---------------------------------------------------------------------------
//
// `buildScene` takes its OWN minimal structural contract — NOT any surface's world
// type — so the core stays a foundational root that depends on nothing (the studio
// adapts its `HexWorld` into this; the website adapts its world). `buildWorld`
// itself stays surface-side: it is entangled with studio CHROME (solar layout,
// building stamps, bookshelf consumers) that must not enter the core, so option (a)
// (move `buildWorld` in) would drag the chrome with it. Option (b) keeps the
// boundary clean — the core owns the LOOK (shapes + hash-derived variants/jitter +
// layout of a drawable), the surface folds its data + chrome into this contract.

/** The routed `depends_on` trail network (ADR-0169) — `routeTrails`' output verbatim:
 *  shared segments (a trunk renders once), per-edge ordered segment chains (titles ride
 *  the edges), and forced cave portals. The surface routes; the core renders. */
export type SceneTrailsInput = TrailNetwork;

/** A capability rendered as garden flora — its id (the core derives the variant +
 *  jitter), folded status, position and tooltip. */
export interface ScenePlantInput {
  id: string;
  status: SceneStatus;
  x: number;
  y: number;
  title: string;
}

/** A capability rendered as a PARCEL of the island's ground (forest-parcels inc 1) — its id (the
 *  delegation/hover hook + the deterministic flora seed), its folded `status` (the per-cell ground
 *  tint), its `testCount` (drives the flora DENSITY, not the parcel's area — island size stays keyed
 *  to the caps count), the `theme` that surfaces it, and a `seed` position. The island's EXISTING
 *  relaxed substrate cells are sub-partitioned among the parcels by equal-weight Voronoi over the
 *  `seed` points (nearest seed wins); a parcel owns the cells nearest its seed. */
export interface SceneParcelInput {
  capId: string;
  status: SceneStatus;
  /** The capability's published test-criteria count — the flora density knob (0 ⇒ bare ground).
   *  Absent means coverage is unreported: retain the parcel ground but emit no flora. */
  testCount?: number;
  theme: SurfaceTheme;
  /** The parcel's Voronoi seed point, in island/map space (the same space `relaxedCells[].poly` is in). */
  seed: Pt;
}

/** One island's drawable data — geometry the surface computed (centroid / treeSpot
 *  / coast / decor seeds), folded status, and the surface's folded marks (signpost
 *  presence, in-flight wisps) + nameplate box & text. */
export interface SceneTerritoryInput {
  id: string;
  /** The folded visual status (provenStatus); drives every island hue. */
  status: SceneStatus;
  /** Capability count — the core derives crown size + young/withered from it + status. */
  caps: number;
  centroid: Pt;
  /** The island's GROUND-plane radius — an isotropic map-space magnitude, camera-independent. Feed
   *  this to anything that treats the value as a ground distance BEFORE the camera sees it:
   *  {@link groundPolarOffset}'s `r`, a threshold compared against {@link groundGap}'s output, a
   *  march stepped in ground units and projected per step. Never feed it to raw screen arithmetic —
   *  it is not what is actually drawn on screen (`screenRadius` is).
   *
   *  THE SEAM USED TO CARRY ONE `radius` FIELD FOR BOTH SPACES (`scene-territory-radius-states-its-
   *  space`). `scene.ts` read it as ground; `TreeView.tsx` fed the SCREEN-projected magnitude a
   *  territory's tiles come out to (`hexCenter`'s default camera, ADR-0367 D1) — camera-dependent,
   *  and for a non-disc island strictly SMALLER than the true ground radius (measured: ~0.65–0.89x
   *  for ordinary story shapes, approaching `sin 20° ≈ 0.342x` in the pure north–south limit, since
   *  only the projected y-extent is foreshortened and the ratio depends on how much of the island's
   *  spread runs along r vs q). Every ground-side reader was therefore silently under-scaled. Split
   *  into two named fields so that mismatch is a TYPE ERROR the next time, not a quiet 11–66%
   *  shortfall. */
  groundRadius: number;
  /** The island's already-SCREEN-projected radius — px at the declared land camera, exactly the
   *  magnitude a territory's projected tile centres come out to. Feed this ONLY to raw screen-space
   *  arithmetic that is never projected again (an orbit ring's `translate`, the click-hit rect's
   *  bounds). Passing this to a ground-space function (`groundPolarOffset`, a `groundGap` threshold)
   *  is the exact bug `groundRadius` exists to make unrepresentable. */
  screenRadius: number;
  treeSpot: Pt;
  /**
   * WHICH SPACE THIS ISLAND'S ANCHORS ARRIVED IN (ADR-0527 D1) — `centroid`, `treeSpot`, each
   * `plants` spot, each `decor` seed and each `parcels` seed. ABSENT ⇒ `screen`, i.e. exactly
   * today's contract, so a caller that has not moved is byte-for-byte unchanged and has to learn
   * nothing.
   *
   * `ground` means the caller handed over the PRE-CAMERA positions and this file projects them,
   * once, at the camera the scene is being built at. That is what lets a caller ask for a
   * PLAN-VIEW scene and get one: until this existed the anchors were frozen at whatever camera
   * the caller happened to build them at, so a plan-view request returned a scene at two cameras
   * at once — the lattice, coast and substrate un-flattened while the tree, the plants and the
   * nameplate stayed foreshortened. `SceneInput.cameraElevationDeg` used to say *"it never
   * re-projects the geometry, which the surface has already done"*; for the anchors, that
   * sentence is retired here.
   *
   * ⚠ IT IS A TAG, NOT A SECOND SET OF GROUND TWINS, and that is deliberate. `groundRadius` /
   * `screenRadius` had to be twins because both magnitudes are wanted at once. Only ONE anchor
   * position is ever wanted, so a tag says which space it is in and then DELETES ITSELF when the
   * last caller converts — where a twin has to be carried by everyone forever.
   *
   * ⚠ `labelY` IS COVERED, AND SINCE ADR-0545 IT IS AN ANCHOR LIKE THE REST. It used to be
   * excluded here on the ground that all four of its consumers were declared screen art, so there
   * was "no ground reading to gain". Two of them were not screen art: `clearsPlate` in
   * {@link buildUatMarkers} and in `placeGardenHeroes` are GROUND PLACEMENT decisions that happened
   * to be measured against a screen y, which is the last member of the bug class
   * `scatter-camera.test.ts` exists to fence. The nameplate is a world object now: a `ground`
   * island hands over the plate's GROUND baseline and this file projects it, once, with every other
   * anchor — so the two keep-outs ask the ground, and the plate follows the camera the way the
   * island under it does. `groundRadius` / `screenRadius` are still not covered — they already
   * state their own space in their names.
   *
   * WHO HAS NOT MOVED, and why it is not an oversight: the public website builds its own island
   * inputs and AUTHORS its anchors in screen space by hand — a tree spot nudged `- 6` whose own
   * source comment says it does not decide whether that means pixels or ground units, and a plant
   * ring on a hand-picked `0.85` ellipse where the camera's own ratio is `sin 20° ≈ 0.342`. Those
   * are a LOOK, not a projection, so no un-projection reproduces them and converting that caller
   * changes a live public page. It keeps handing `screen`, and the remainder is visible HERE
   * rather than only in an arc nobody opened.
   */
  anchorSpace?: 'screen' | 'ground';
  /** The nameplate baseline (also the delegation hit's bottom), in the space
   *  {@link SceneTerritoryInput.anchorSpace} names — a GROUND y under `ground`, a screen y under
   *  `screen` (the absent-tag default, so an unconverted caller is byte-for-byte unchanged). */
  labelY: number;
  /** The smoothed coastline as closed loops in the GROUND plane — the island's sand fill AND its
   *  water moat (one curve, filled then stroked). ADR-0527 D1: the surface hands over COORDINATES
   *  and the drawing is made here, at the camera the scene is being built at. It used to be a
   *  `d` string the caller had already projected and smoothed, which made it the one island input
   *  that was a finished DRAWING — and a drawing cannot be re-projected, so the coast could not
   *  follow a camera the caller had not already applied. Projecting then smoothing is what the
   *  caller did and is what happens here: `smoothLoopPath` builds its curve from midpoints and is
   *  therefore linear in its input points, so the two orders draw the same coast. */
  coastGroundLoops: Pt[][];
  /** Conifer-clump seeds; the core expands each into 2–3 deterministic conifers.
   *  RETIRED for a parcels-present island (the parcel flora replaces the decorative conifers). */
  decor: { x: number; y: number; seed: number }[];
  plants: ScenePlantInput[];
  /** Capability PARCELS (forest-parcels inc 1). When PRESENT (and the island has relaxed substrate
   *  cells), the island's existing cells are sub-partitioned among these capabilities by equal-weight
   *  Voronoi over each parcel's `seed`, each cell tinted by its assigned cap's `status`, and each
   *  parcel's flora emitted through its `theme`'s surface function with density ∝ `testCount` — and
   *  the decorative conifers (`decor`) + the one-plant-per-cap ring (`plants`) are RETIRED for this
   *  island. OPTIONAL and back-compat: absent ⇒ today's ground + conifers + plant ring render
   *  byte-for-byte (the public website omits it entirely). */
  parcels?: SceneParcelInput[];
  /** The crown tooltip (surface vocabulary). */
  treeTitle: string;
  /** Present only for a human-witness story; `outcome` null = a blank (unsigned) seal. */
  signpost?: { outcome: 'pass' | 'fail' | null };
  /** The UAT markers (forest-parcels inc 2; tall flowers, grounded-art inc 7). When PRESENT and
   *  non-empty, the island grows ONE tall-flower marker per criterion, SCATTERED deterministically
   *  around the island (each spot is id-seeded with keep-outs for the tree well, the signpost, the
   *  nameplate band, and other flowers, and a keep-IN to the island's substrate land cells so no flower
   *  drifts into the water). Each criterion's `state` is encoded in its wrapper KIND
   *  (`tall-flower-proven`/`-pending`/`-failing`) and its `id` carried as the node id (the
   *  hover/delegation hook). The human-witness `signpost` seal is RETAINED unconditionally — the markers
   *  never replace it. OPTIONAL and back-compat: ABSENT ⇒ today's island renders BYTE-FOR-BYTE (the
   *  public website fold never sends it and must be unchanged). */
  uatCriteria?: { id: string; state: MarkerState }[];
  /** In-flight build wisps, folded from live builds (the core derives each orbit
   *  ROTATION from the runId — geometry, like the crown jitter). The optional
   *  `phase` is the live prove-it-gate phase the surface folds in (ADR-0048 §3 v2)
   *  — the core maps it to the wisp's red→green band. The optional `colourState`
   *  (ADR-0138 §5) is the live subagent role the work-event stamped — an additive
   *  role tint on the build wisp (absent → existing `phaseBand` look, unchanged).
   *  Empty when nothing builds. */
  wisps: { runId: string; title: string; phase?: BuildPhase; colourState?: ClaimColourState }[];
  /** In-flight story CLAIMS, folded from the live `events.node_claim` layer (ADR-0138 §5). One
   *  orbiting claim wisp per claim — a session is working this story (coordination), coloured by what
   *  the orchestrator is doing (`colourState`). The core derives the orbit ROTATION from `key` (a
   *  stable id — sessionId or unitId — geometry, like the build wisp's runId). DISTINCT from `wisps`
   *  from every proof signal: a claim is never a proof (the §5 honesty wall). OPTIONAL and back-compat: a
   *  surface with no live-claim concept (the public website, which has no sessions) omits it entirely,
   *  so the claim layer is inert there — `buildClaimWisps` returns null and the render is unchanged.
   *  Absent/empty when nothing is claimed. The optional `grade` (ADR-0200 D2/D7) selects the
   *  drawable family — `exploring` hovers, `waiting` queues, `work` orbits; ABSENT means `work`
   *  (the D2 back-compat default: every pre-grade surface keeps today's orbit byte-for-byte).
   *  WAITING ORDER CONTRACT: waiters are placed by their INDEX in input order, so the surface sends
   *  them ordered by `claimedAt` (the queue order the claim ledger already keeps). */
  /*  The optional `phase` (ADR-0212) is the LIVE prove-it-gate phase of a build THIS CLAIM'S OWN
   *  SESSION is running; the core maps it to the body's red→green band. That band is the one signal
   *  the retired build-wisp layer (ADR-0048) carried which the claim body did not, and folding it
   *  here is what merged the two layers into the one-wisp-per-session lifecycle.
   *
   *  THE SURFACE'S OBLIGATION, which the core CANNOT CHECK (ADR-0326): supply a phase only from a
   *  build joined at the CLAIMED UNIT — the build whose `unitId` equals this claim's `unitId`. By the
   *  time claims reach the core they are one flat per-territory list, so the core cannot tell a
   *  story's own claim from its members', nor which session each belongs to. A surface that joins at
   *  the STORY instead paints one session's build phase onto another session's body: a member build
   *  and a story-grain claim land in the same territory while belonging to different actors, and two
   *  work claims on disjoint capabilities of one story are legitimate (ADR-0270 D1), so "one work
   *  claim per territory" is false. ADR-0212 first wrote that story-grain join down HERE as sound,
   *  arguing from the ADR-0200 D2 mutex — but the mutex is per UNIT ID, and the premise it leaned on
   *  no longer holds. Stated as an obligation rather than re-derived, because the argument belongs
   *  with the surface that performs the join; carrying it in the core is how it went stale unseen.
   *
   *  ABSENT ⇒ no band, and every pre-ADR-0212 surface renders BYTE-FOR-BYTE unchanged. Ignored on the
   *  `exploring`/`waiting` grades — only work builds. */
  claims?: {
    key: string;
    title: string;
    colourState: ClaimColourState;
    grade?: ClaimGrade;
    phase?: BuildPhase;
  }[];
  /** Recently-RELEASED story claims still fading out (ADR-0200 D7) — the departure drawable. The
   *  surface folds which departures sit inside the window and computes each `ageRatio` (0..1 — how
   *  far through the departure window); the core places a stationary `departing-wisp` whose
   *  geometry drifts upward with age (the "leaving" translation), and carries `ageRatio` on the
   *  node for the mapper's fade (the curve itself is the mapper/CSS's job — the later
   *  operator-attested LOOK stage). OPTIONAL and back-compat exactly like `claims`: a surface with
   *  no claim concept (the public website) omits it entirely and the render is unchanged. */
  departures?: { key: string; title: string; ageRatio: number }[];
  /** The nameplate box (surface chrome: the studio's `nameplateLayout`, the web's
   *  own sizing) + the text the surface chose. */
  plate: {
    w: number;
    h: number;
    rx: number;
    idY: number;
    subY: number;
    idText: string;
    subText: string;
    title: string;
  };
}

/**
 * One pale coast hex, optionally ATTRIBUTED to the territory whose land it grew out of (its
 * index in `territories`, the same index every other `owner` here keys on).
 *
 * Why attribution exists at all: the coast is derived from the UNION of all claimed land, so it
 * is naturally one global moat with no owner. That was fine while it only ever drew the settled
 * forest — but the Act 2 regrow (ADR-0282) hides an island until it forms, and an unattributed
 * moat kept drawing the WHOLE forest's silhouette from frame one, pre-announcing every island
 * before it existed (ADR-0286). Naming the island each coast hex belongs to is what lets a
 * per-story hide reach it.
 *
 * OPTIONAL on purpose: absent ⇒ the hex renders exactly as it did before this field existed, with
 * no id on its node and nothing per-story to key on. Every caller that does not attribute its
 * coast (the website fold, every test fixture) is byte-identical.
 */
export interface SceneEmptyHex extends Axial {
  readonly owner?: number;
}

/** The whole scene's structural input. `territories` is in OWNER order — the same
 *  index `relaxedCells[].owner` / `drawTiles[].owner` / `wheatSets[i]` key on. */
export interface SceneInput {
  offset: Pt;
  width: number;
  height: number;
  /** Pale coast tiles (1–2 rings beyond claimed land), each optionally ATTRIBUTED to the
   *  territory whose land it grew out of ({@link SceneEmptyHex}). */
  empties: SceneEmptyHex[];
  /** Mesh substrate cells; `null` ⇒ the classic extruded-hex ground (`drawTiles`). */
  relaxedCells: RelaxedCell[] | null;
  /** Claimed tiles + owning-territory index (used when `relaxedCells` is null). */
  drawTiles: DrawTile[];
  /** Per-territory wheat key-sets (used when `relaxedCells` is null). */
  wheatSets: ReadonlySet<string>[];
  trails: SceneTrailsInput;
  territories: SceneTerritoryInput[];
  /** DORMANT ADR-0218 seam hook. The baked standing-stone once rode here (fed a `baked-defs` layer that
   *  every UAT marker's `baked-art` `<use>` referenced), but the stone-in-scene instance retired with
   *  the tall-flower markers (grounded-art inc 7) — `buildScene` no longer reads this field, so supplying
   *  it is a no-op. The field + the baked-art types/kinds/mapper handling are KEPT as reusable machinery
   *  (owner call: keep the seam) for a FUTURE baked object type; that type re-lights the emission in
   *  `buildScene`. `width`/`height` are the baked box (a future consumer scales the solid to its envelope). */
  bakedStone?: { nodes: BakedPaintNode[]; width: number; height: number };
  /** The cosy-island GARDEN composition (grounded-art inc 11, ADR-0221 / re-lit ADR-0218). PRESENT ⇒
   *  the island named by `garden.islandId` composes as the concept garden — the four heroes placed
   *  through the baked-art seam, decorative flora suppressed, the `autumn-tree` hero as its central
   *  tree. OPTIONAL and back-compat: ABSENT ⇒ every island renders BYTE-FOR-BYTE (the same lock as
   *  `parcels`/`uatCriteria`; the public website fold never sends it). */
  garden?: SceneGardenInput;
  /** The unified world-art vegetation vocabulary (grounded-art, ADR-0226). PRESENT ⇒ every island's
   *  living surface reads as ONE language, studio-side: grass = a capability's tests (the decorative
   *  wildflower / anemone / heather-bell accents retired, so a flower means UAT and only UAT), the UAT
   *  criteria as SMALL flowers folded into the grass (form-reads-verdict), an unhealthy capability's
   *  grass reads as dead grass (the existing status wilt), and the human-witness signpost retired.
   *  OPTIONAL and back-compat: ABSENT ⇒ every island renders BYTE-FOR-BYTE (the same absence lock as
   *  `parcels`/`uatCriteria`/`garden`; the public website fold never sends it, so its render is
   *  unchanged). The garden composition (`garden`) is a SEPARATE flag and takes precedence on its
   *  island — the vegetation vocabulary governs the non-garden islands. */
  vegetation?: SceneVegetationInput;
  /**
   * The CAMERA the surface projected this scene's ground geometry at, in degrees above the ground
   * plane (ADR-0367 D1). ABSENT ⇒ {@link LAND_CAMERA_ELEVATION_DEG}, the one the land's own coordinate
   * mapping uses — so every existing caller is byte-for-byte unchanged and no surface has to learn a
   * new field.
   *
   * It exists because the placements the scene performs — the UAT-flower scatter, the garden heroes,
   * the stone walk, the accents — measure distances against those projected polygons, and a distance
   * meaning "how far apart on the ground" cannot be read off the screen without knowing the angle.
   * Supplying it lets a caller (and the proof) ask what the SAME GROUND island looks like at another
   * camera. Passing an elevation here that disagrees with the one the ground COORDINATES were built
   * at (`hexCenter`/`hexCorners`/`buildRelaxedCells` all take the same option) is a scene at two
   * cameras at once, so thread one elevation through all of them.
   *
   * ⚠⚠ THIS FIELD USED TO SAY *"it never re-projects the geometry, which the surface has already
   * done"*, AND THAT SENTENCE IS RETIRED IN TWO STEPS, BOTH RECORDED HERE. ADR-0527 D1 retired it
   * for the ANCHORS: a `ground` {@link SceneTerritoryInput.anchorSpace} hands over PRE-camera
   * positions and this file projects them, once, at the camera it is being built at — which is what
   * lets a caller ask for a genuine plan-view scene instead of one at two cameras. ADR-0546 D1
   * retired what was left of its PURPOSE: `worldTo3D` no longer un-projects the drawing it is
   * handed, so `PLAN_VIEW_ELEVATION_DEG` is not an instrument's curiosity any more but **what the
   * 3D map asks for** — the scene is where the true ground now comes from, and a 3D caller that
   * omits this field gets the squashed drawing laid straight onto the ground plane.
   */
  cameraElevationDeg?: number;
  /** The tile the scene is drawn on (ADR-0528): the lattice radius the surface laid its tiles out
   *  with. ABSENT ⇒ the shipped, derived `HEX_R`, which is what every product surface draws on. An
   *  instrument that lays a scene out on another radius (the r3f harness fixture, on the tuned
   *  tile) states it here so the props, keep-outs and strokes re-base with the lattice. */
  tile?: { hexR: number; rungs?: ArtRungs };
}

/** DORMANT: the scene-graph's def id the baked standing-stone once used (ADR-0218). No longer emitted
 *  (the stone-in-scene instance retired with the tall-flower markers, grounded-art inc 7); KEPT exported
 *  as the seam's documented def-id pattern for a future baked object type. */
export const BAKED_STONE_DEF = 'baked-standing-stone';

// ---------------------------------------------------------------------------
// the cosy-island GARDEN composition (grounded-art inc 11, ADR-0221 / re-lit ADR-0218)
// ---------------------------------------------------------------------------
//
// The first LIVE consumer of ADR-0218's fenced baked-art seam. When `SceneInput.garden` is present, the
// named exemplar island composes as the concept garden (docs/research/grounded-art-concept): the four
// inc-10 heroes (cottage, gazebo, autumn-tree, stepping-stone) placed as `baked-use` references to
// `baked-def`s the surface folds from procedural-architecture's `kit.json` `heroes`, with the island's
// decorative flora (conifers / capability plants / parcel flora / the 1:1 UAT-flower scatter) SUPPRESSED
// and the `autumn-tree` hero standing as the central tree (ADR-0221, studio flag path only). ABSENT ⇒
// every island renders BYTE-FOR-BYTE — the same absence lock as `parcels`/`uatCriteria`; the public
// website fold never sends it.

/** The four cosy-island hero ids, keyed to `kit.json`'s `heroes` array. */
export type GardenHeroId = 'cottage' | 'gazebo' | 'autumn-tree' | 'stepping-stone';

/** A baked hero's resolved-paint drawables + its baked box, folded by the SURFACE from
 *  procedural-architecture's `kit.json` `heroes` (the core imports nothing new — the def data is
 *  opaque surface-supplied data, unlike `coastGroundLoops`, which is coordinates). One `baked-def` is emitted per hero
 *  (define-once, ADR-0069) and referenced by every placement `baked-use`. `width`/`height` are the
 *  baked box, so a placement scales the solid to a target on-island envelope. */
export interface SceneGardenHero {
  nodes: BakedPaintNode[];
  width: number;
  height: number;
}

/** The garden composition input (grounded-art inc 11, ADR-0221). PRESENT ⇒ the island whose id is
 *  `islandId` composes as the concept garden (heroes placed, flora suppressed, `autumn-tree` hero as
 *  the central tree). ABSENT ⇒ every island renders byte-for-byte (the public website never sends it). */
export interface SceneGardenInput {
  /** which territory id composes as a garden — the studio exemplar island (`studio`). */
  islandId: string;
  /** the four heroes' baked defs, keyed by their `kit.json` id. */
  heroes: Record<GardenHeroId, SceneGardenHero>;
}

/** The tree-spread's per-status colourways, keyed by status (ADR-0227). The `autumn-tree` hero baked
 *  once per status with only its crown recoloured — so a non-garden island's central tree carries its
 *  story's status hue rather than one fixed autumn brown. `Partial` because the surface may supply a
 *  subset; a missing status falls back to `unknown` (which the surface always supplies). */
export type SceneVegHeroTrees = Partial<Record<SceneStatus, SceneGardenHero>>;

/** The unified vegetation-vocabulary input (grounded-art, ADR-0226). PRESENT ⇒ every non-garden island
 *  renders the unified vocabulary (grass = a capability's tests, small flowers = the story's UAT, dead
 *  grass = an unhealthy capability, the human-witness signpost retired). ABSENT ⇒ byte-for-byte, exactly
 *  like `garden`. Its presence alone flips the vocabulary; the optional `heroTrees` carries the tree-spread. */
export interface SceneVegetationInput {
  /** The tree-spread (ADR-0226 decision 1, amends ADR-0221; per-status colourways added by ADR-0227):
   *  the baked `autumn-tree` hero, folded by the SURFACE from `kit.json`'s `heroTreeVariants` (one bake
   *  per status, only the crown recoloured). When PRESENT, a non-garden island's procedural central tree
   *  (`buildTree`) is replaced by a `<use>` of the colourway for the ISLAND'S STATUS — restoring the
   *  per-status crown hue (green=healthy, red=unhealthy, amber=proposed, brown=mapped) the procedural
   *  tree carried through CSS, now on the authored hero silhouette (define-once / reference-many). ABSENT
   *  ⇒ the procedural tree stays (the vocabulary's grass/flowers still apply). */
  heroTrees?: SceneVegHeroTrees;
}

// ---------------------------------------------------------------------------
// node factories — terse, drop-undefined construction
// ---------------------------------------------------------------------------

const f = (n: number): string => n.toFixed(1);

// ---------------------------------------------------------------------------
// THE TILE IS AN INPUT OF THE DRAWING (ADR-0528)
// ---------------------------------------------------------------------------
//
// Every prop, keep-out, offset and stroke in this file was authored in ground units against the
// radius-27 tile. The shipped lattice is DERIVED now (`HEX_R` ≈ 11.06, one hex per capability), so
// the drawing re-bases those lengths by the ratio of the tile it is drawn on to the tile they were
// authored on — and it takes that tile from `SceneInput.tile` rather than from a module constant,
// because one scene is NOT drawn on the shipped tile: the r3f harness fixture is the island every
// 3D ground constant was tuned on and is drawn on the tuned tile (`PRE_ADR0528_TILE.hexR`), where
// the re-basing factor is exactly 1 and the drawing is byte-for-byte what it was.
//
// The per-family ART RUNGS (`TREE_ART_RUNG` …, `sizing.ts`) multiply the tile factor: they are the
// 2D art pass's dials (ADR-0528 D2), picked on rendered ladders, and they apply on every tile.

/** The tile a scene is drawn on, resolved once per `buildScene` and threaded to every builder. */
export interface TileArt {
  /** The lattice radius the scene is drawn on. */
  readonly hexR: number;
  /** `hexR / 27` — the factor a ground-unit length authored on the tuned tile multiplies by. */
  readonly scale: number;
  /** A length authored on the tuned tile, on this tile. */
  units(authoredOnTunedTile: number): number;
  /** The story tree's drawing scale on this tile (`scale × TREE_ART_RUNG`). */
  readonly tree: number;
  /** The nameplate's drawing scale on this tile. */
  readonly plate: number;
  /** The parcel flora's drawing scale on this tile. */
  readonly flora: number;
  /** What the 2D drawing strokes a trail at, as a factor on the ONE width rule. */
  readonly trailStroke: number;
  /** The floor on how close two UAT flowers may stand ON THE GROUND (15 on the tuned tile). */
  readonly markerSpacing: number;
  /** The GROUND radius around the story tree's base no UAT flower stands inside (36 on the tuned tile). */
  readonly markerTreeWell: number;
  /** The window-shopping orbit radius (ADR-0212 channel 1; 9 on the tuned tile). */
  readonly hoverOrbitR: number;
}

/** The per-family art rungs a scene may state (ADR-0528 D2) — each a factor on the shipped rung
 *  (`sizing.ts`), so `1` on every key is the shipped drawing. An instrument's dial: the studio reads
 *  `?treeRung=` … off its URL into these so a ladder can be captured from the running map. */
export interface ArtRungs {
  tree?: number;
  plate?: number;
  flora?: number;
  trail?: number;
}

export function tileArt(hexR: number = HEX_R, rungs: ArtRungs = {}): TileArt {
  const scale = hexR / PRE_ADR0528_TILE.hexR;
  const units = (n: number): number => n * scale;
  return {
    hexR,
    scale,
    units,
    // Stryker disable next-line ArithmeticOperator: EQUIVALENT WHILE THE RUNG SHIPS AT 1 — the four
    // art rungs are the owner's dials (ADR-0528 D2) and every one of them is 1 today, so `× rung`
    // and `÷ rung` compute the same number and no test can separate them. This is the ONE shape of
    // equivalence here that expires: ship a rung off 1 and the mutant becomes killable, so the
    // landing that moves one owes this line its test rather than this comment.
    tree: scale * TREE_ART_RUNG * (rungs.tree ?? 1),
    // Stryker disable next-line ArithmeticOperator: EQUIVALENT WHILE PLATE_ART_RUNG IS 1 — see `tree`.
    plate: scale * PLATE_ART_RUNG * (rungs.plate ?? 1),
    // Stryker disable next-line ArithmeticOperator: EQUIVALENT WHILE FLORA_ART_RUNG IS 1 — see `tree`.
    flora: scale * FLORA_ART_RUNG * (rungs.flora ?? 1),
    // Stryker disable next-line ArithmeticOperator: EQUIVALENT WHILE TRAIL_ART_RUNG IS 1 — see `tree`.
    trailStroke: scale * TRAIL_ART_RUNG * (rungs.trail ?? 1),
    markerSpacing: units(15),
    markerTreeWell: units(36),
    hoverOrbitR: units(9),
  };
}

/** The shipped tile's art — what every builder draws with when a caller states no tile. */
export const SHIPPED_TILE_ART: TileArt = tileArt();
const EMPTY_KEYS: ReadonlySet<string> = new Set();

function g(children: SceneNode[], a: SceneNodeBase = {}): SceneG {
  return { el: 'g', children, ...a };
}
function path(d: string, a: SceneNodeBase = {}): ScenePath {
  return { el: 'path', d, ...a };
}
function circle(cx: number, cy: number, r: number, a: SceneNodeBase = {}): SceneCircle {
  return { el: 'circle', cx, cy, r, ...a };
}
function ellipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  a: SceneNodeBase = {},
): SceneEllipse {
  return { el: 'ellipse', cx, cy, rx, ry, ...a };
}
function polygon(points: string, a: SceneNodeBase = {}): ScenePolygon {
  return { el: 'polygon', points, ...a };
}
function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  rx: number,
  a: SceneNodeBase = {},
): SceneRect {
  return { el: 'rect', x, y, width, height, rx, ...a };
}
function text(
  x: number,
  y: number,
  content: string,
  anchor: 'start' | 'middle' | 'end',
  a: SceneNodeBase = {},
): SceneText {
  return { el: 'text', x, y, text: content, anchor, ...a };
}

// ---------------------------------------------------------------------------
// the central story tree (StoryTree)
// ---------------------------------------------------------------------------

/** The central story tree — living canopy / withered skeleton / not-yet-full young
 *  form, with the crown blobs deterministically jittered by the story id. Includes
 *  the human-witness signpost as a child (matching the studio's `story-tree` group). */
export function buildTree(
  t: SceneTerritoryInput,
  unifiedVeg = false,
  art: TileArt = SHIPPED_TILE_ART,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): SceneG {
  const st = t.status;
  const caps = t.caps;
  const withered = st === 'unhealthy';
  // `proposed` hasn't earned full growth; a claimed-but-empty story (0 caps) wears
  // the SAME small form (owner 2026-06-21 — the sapling stage folded in).
  const young = !withered && (st === 'proposed' || caps === 0);
  const R = crownRadius(caps) * (young ? 0.62 : 1);
  const cy = -1.65 * R;

  const trunkD =
    `M -3.6 0 C -3.2 ${f(0.3 * cy)}, -2.4 ${f(0.65 * cy)}, -2.2 ${f(cy)} ` +
    `L 2.2 ${f(cy)} C 2.4 ${f(0.65 * cy)}, 3.2 ${f(0.3 * cy)}, 3.6 0 Q 0 2.4 -3.6 0 Z`;

  // The story tree's ground contact shadow. Its semi-minor axis is now DERIVED from the declared
  // land camera (ADR-0367 D1) rather than hand-set: it is a ground circle of radius 0.78R seen
  // through the same camera the tree sprite is authored at. It was `R * 0.2`, a ratio of 0.256 =>
  // an implied 14.9° camera — the one real outlier in the land's own shadow census (the other seven
  // fixed ellipses imply 17.5°–23.6°, mean 19.2°), and the mark sitting directly beneath the hero
  // tree, i.e. exactly the mismatch the round-3 lab's squash dial was absorbing.
  const shadowGroundR = R * 0.78;
  const children: SceneNode[] = [
    ellipse(2, 2, shadowGroundR, groundRadiusToScreenHalfHeight(shadowGroundR, elevationDeg), { kind: 'shadow' }),
  ];

  if (withered) {
    const bareBranches = [
      `M 0 ${f(-1.65 * R)} C 2 ${f(-2.07 * R)}, 1 ${f(-2.36 * R)}, ${f(0.21 * R)} ${f(-2.64 * R)}`,
      `M ${f(0.12 * R)} ${f(-2.29 * R)} L ${f(0.32 * R)} ${f(-2.43 * R)}`,
      `M -4 ${f(-1.79 * R)} C -9 ${f(-2.07 * R)}, -8 ${f(-2.25 * R)}, ${f(-0.46 * R)} ${f(-2.43 * R)}`,
      `M ${f(-0.31 * R)} ${f(-2.14 * R)} L ${f(-0.5 * R)} ${f(-2.18 * R)}`,
    ];
    children.push(
      path(trunkD, { kind: 'trunk' }),
      g([circle(0, cy + 0.15 * R, 0.78 * R), circle(-0.62 * R, cy + 0.36 * R, 0.49 * R)], {
        kind: 'crown-lo',
      }),
      g([circle(-0.21 * R, cy - 0.14 * R, 0.32 * R)], { kind: 'crown-hi', opacity: 0.7 }),
      g(
        bareBranches.map((d) => path(d)),
        { kind: 'bare' },
      ),
      ...([
        [-14, -2],
        [-6, 1],
        [8, -1],
        [16, -4],
      ] as const).map(([lx, ly]) => circle(lx, ly, 1.3, { kind: 'litter' })),
    );
  } else {
    const jb = (i: number, bcx: number, bcy: number, br: number): SceneCircle => {
      const k = hash(`${t.id}:crown:${i}`);
      return circle(
        bcx + (rand01(k) - 0.5) * 0.12 * R,
        bcy + (rand01(k + 1) - 0.5) * 0.1 * R,
        br * (0.94 + rand01(k + 2) * 0.12),
      );
    };
    const base = [
      circle(0, cy, R), // the central blob is never jittered
      jb(1, -0.62 * R, cy + 0.3 * R, 0.62 * R),
      jb(2, 0.62 * R, cy + 0.3 * R, 0.62 * R),
      jb(3, -0.4 * R, cy - 0.52 * R, 0.55 * R),
      jb(4, 0.42 * R, cy - 0.5 * R, 0.57 * R),
    ];
    const highlights = [
      jb(5, -0.15 * R, cy - 0.3 * R, 0.6 * R),
      jb(6, -0.55 * R, cy - 0.05 * R, 0.38 * R),
      jb(7, 0.3 * R, cy - 0.55 * R, 0.36 * R),
    ];
    children.push(
      path(trunkD, { kind: 'trunk' }),
      g(base, { kind: 'crown-lo' }),
      g(highlights, { kind: 'crown-hi' }),
    );
  }

  // The human-witness signpost is RETIRED under the unified vegetation vocabulary (ADR-0226 decision 5)
  // — redundant with the (now small) UAT flowers. Flag OFF ⇒ it renders as today
  // (byte-for-byte; the public website never sends `vegetation`).
  if (t.signpost && !unifiedVeg) children.push(buildSignpost(t.signpost, R));

  // The tree is authored in its own frame (`crownRadius`) and scaled onto the tile here (ADR-0528
  // D2, `TREE_SCALE`) — the trunk, litter and signpost inside scale with it.
  return g(children, {
    kind: 'tree',
    status: st,
    title: t.treeTitle,
    transform: `translate(${f(t.treeSpot.x)} ${f(t.treeSpot.y)}) scale(${f(art.tree)})`,
  });
}

/** The human-witness signpost — a dashed-blank seal until the UAT verdict is
 *  signed, a filled seal (echoing the verdict's hue) after. The studio shows the
 *  state via the group class; the post + head shapes are the shared geometry. */
function buildSignpost(s: { outcome: 'pass' | 'fail' | null }, R: number): SceneG {
  const kind: SceneKind =
    s.outcome === null ? 'sign-blank' : s.outcome === 'pass' ? 'sign-pass' : 'sign-fail';
  return g(
    [
      ellipse(0.6, 0.8, 4, 1.6, { kind: 'shadow' }),
      rect(-1.3, -15, 2.6, 15, 1.1, { kind: 'sign-post' }),
      circle(0, -18, 6.5, { kind: 'sign-head' }),
    ],
    { kind, transform: `translate(${f(R * 0.7 + 9)} 0)` },
  );
}

// ---------------------------------------------------------------------------
// the UAT markers (forest-parcels inc 2; stones → tall flowers, grounded-art inc 7)
// ---------------------------------------------------------------------------
//
// A uatCriteria-present island grows ONE tall-flower marker per criterion, SCATTERED deterministically
// around the island. The standing-stones the placement first carried (owner call 2026-07-18) were
// rejected as noisy/colliding (#832) and replaced with a cosy stand-in (owner call 2026-07-20): a soft
// flat flower whose FORM reads the verdict. Each spot is id-seeded with keep-outs for the tree well
// (which also covers the signpost beside it), the nameplate band, and the other flowers — and a keep-IN
// to the island's substrate land cells (no flower in the water); every flower is its OWN y-sorted
// drawable so it interleaves honestly with the tree + flora in painter order. The human-witness signpost
// seal is RETAINED. Everything is seeded from the story id via the existing `hash`/`rand01` helpers —
// same input ⇒ byte-identical output.

/** THE MARKER-BODY PAINTER (grounded-art inc 7, superseding the ADR-0208 standing-stone splice seam):
 *  a soft, flat, colour-class-driven TALL FLOWER — the cosy stand-in the owner directed after rejecting
 *  the baked standing-stones as "messy and noisy rather than cosy" (#832, 2026-07-20). One flower per
 *  UAT criterion; the verdict is read from its FORM, not a glow: a bloomed daisy = proven, a closed bud
 *  = pending, a wilted nodding head = failing (the `sign-blank/pass/fail` precedent). Contract
 *  `(state, k) => SceneNode[]` — marks positioned with the flower's BASE at (0,0), growing UP in −y; `k`
 *  is a hash seed for deterministic jitter (`rand01(k + i)`, never Math.random), so a cluster reads
 *  natural not cloned (lean, height, petal count, rotation all seeded). The wrapper's KIND carries the
 *  state; the body child kinds map to CSS classes, colour stays CSS-side (ADR-0093 §4). Sibling in
 *  spirit of buildPlant — flat pastel fills, NO isometric shading — matching the island's
 *  existing flat look and the cosy-island concept (`docs/research/grounded-art-concept`). */
function tallFlowerMarks(state: MarkerState, k: number, small = false): SceneNode[] {
  const jx = (n: number): number => rand01(k + n) - 0.5; // per-marker jitter in [-0.5, 0.5)
  const j01 = (n: number): number => rand01(k + n); // per-marker roll in [0, 1)

  // `small` = the unified vegetation vocabulary (ADR-0226 decision 4): a low meadow flower folded into
  // the grass — ~12–16u local × the 0.6 wrapper ≈ 8u on the map, so it stands just proud of the grass
  // tufts rather than towering like the historical 36–44u stalk. Every proportion scales down together.
  // The rand-draw SEQUENCE is identical either way (only the CONSTANTS differ), so determinism holds;
  // the tall (`!small`) branch preserves the pre-ADR-0226 values verbatim, so flag-off is byte-for-byte.
  const height = small ? 12 + j01(0) * 4 : 36 + j01(0) * 8;
  const lean = jx(1) * (small ? 3 : 7); // the whole stalk leans a touch off true vertical (base planted)

  // the upright head anchor; failing nods it over + sinks it (a wilted, bowed head).
  const upX = lean;
  const upY = -height;
  const nodSide = jx(2) < 0 ? -1 : 1;
  const failing = state === 'failing';
  const headX = failing ? upX + nodSide * (small ? 2.6 : 6.5) : upX;
  const headY = failing ? upY + (small ? 2.8 : 7) : upY;

  // the stalk: a gentle cubic from the planted base up to the head. Failing arcs OVER — the second
  // control point pulls above the sunken head so the tip bows down, reading as a wilted stem.
  const stemD = failing
    ? `M 0 0 C ${f(lean * 0.5)} ${f(-height * 0.5)}, ${f(upX)} ${f(upY - (small ? 2 : 5))}, ${f(headX)} ${f(headY)}`
    : `M 0 0 C ${f(lean * 0.5 + jx(3) * (small ? 0.8 : 2))} ${f(-height * 0.4)}, ${f(upX * 0.85)} ${f(-height * 0.78)}, ${f(headX)} ${f(headY)}`;

  const marks: SceneNode[] = [
    // a soft flat ground shadow (reuses the shared `shadow` kind the flora already map to `.flora-shadow`).
    small ? ellipse(0.2, 0.3, 2.3, 0.8, { kind: 'shadow' }) : ellipse(0.4, 0.6, 5.2, 1.7, { kind: 'shadow' }),
    path(stemD, { kind: 'tall-flower-stem', strokeWidth: small ? 1.1 : 2.2 }),
  ];

  // two small leaves along the stalk, alternating sides, angled up-and-out — seeded so they vary.
  const firstSide = jx(4) < 0 ? -1 : 1;
  ([
    [0.34, firstSide],
    [0.6, -firstSide],
  ] as const).forEach(([t, side], i) => {
    const ly = -height * t;
    const lx = lean * t;
    marks.push(
      ellipse(lx + side * (small ? 1.4 : 3.4), ly, (small ? 1.7 : 4.0) + jx(10 + i) * (small ? 0.4 : 0.9), small ? 0.8 : 1.8, {
        kind: 'tall-flower-leaf',
        transform: `rotate(${f(side * (34 + jx(12 + i) * 12))} ${f(lx)} ${f(ly)})`,
      }),
    );
  });

  if (state === 'proven') {
    // a soft warm glow behind the flower head — proven ONLY, low opacity, calm (no sparks: the owner's noise
    // complaint). Drawn first so the petals sit crisp on top.
    marks.push(
      circle(headX, headY, small ? 4.2 : 10.5, { kind: 'tall-flower-glow', opacity: 0.1 }),
      circle(headX, headY, small ? 2.7 : 6.8, { kind: 'tall-flower-glow', opacity: 0.16 }),
    );
    // soft petals radiating around the centre disc — a daisy (the concept's flower). Each petal is a
    // slender elongated ellipse rooted at the head centre and rotated into place; count + angle + length
    // are seeded so no two flowers are identical.
    const petals = (small ? 6 : 7) + (j01(5) > 0.5 ? 1 : 0);
    for (let i = 0; i < petals; i++) {
      const ang = (i / petals) * 360 + jx(20 + i) * 10;
      const plen = (small ? 2.6 : 6.8) + jx(30 + i) * (small ? 0.5 : 1.1);
      marks.push(
        ellipse(headX, headY - plen, small ? 0.85 : 2.15, plen, {
          kind: 'tall-flower-petal',
          transform: `rotate(${f(ang)} ${f(headX)} ${f(headY)})`,
        }),
      );
    }
    marks.push(circle(headX, headY, small ? 1.35 : 3.4, { kind: 'tall-flower-center' }));
  } else if (failing) {
    // a wilted, nodding head: petals all droop into the lower arc, sitting low + to one side on the
    // bowed stem — the muted colour resolves CSS-side. No glow (dormant/failing is not a bloom).
    const petals = small ? 5 : 6;
    for (let i = 0; i < petals; i++) {
      const ang = 112 + (i / (petals - 1)) * 136 + jx(20 + i) * 12; // 112–248°: hangs down + out
      const plen = (small ? 2.3 : 5.8) + jx(30 + i) * (small ? 0.45 : 1.0);
      marks.push(
        ellipse(headX, headY - plen, small ? 0.78 : 1.95, plen, {
          kind: 'tall-flower-petal',
          transform: `rotate(${f(ang)} ${f(headX)} ${f(headY)})`,
        }),
      );
    }
    marks.push(circle(headX, headY, small ? 1.15 : 2.9, { kind: 'tall-flower-center' }));
  } else {
    // pending: a closed teardrop bud — calm, unopened; awaiting UAT reads as the ABSENCE of a flower
    // (the honesty wall, ADR-0529: a bud is never open — only a signed pass opens it).
    const bx = headX;
    const by = headY;
    const budD = small
      ? `M ${f(bx)} ${f(by - 4.1)} ` +
        `C ${f(bx - 1.45)} ${f(by - 2.9)}, ${f(bx - 1.4)} ${f(by - 0.6)}, ${f(bx)} ${f(by)} ` +
        `C ${f(bx + 1.4)} ${f(by - 0.6)}, ${f(bx + 1.45)} ${f(by - 2.9)}, ${f(bx)} ${f(by - 4.1)} Z`
      : `M ${f(bx)} ${f(by - 10.5)} ` +
        `C ${f(bx - 3.7)} ${f(by - 7.5)}, ${f(bx - 3.5)} ${f(by - 1.5)}, ${f(bx)} ${f(by)} ` +
        `C ${f(bx + 3.5)} ${f(by - 1.5)}, ${f(bx + 3.7)} ${f(by - 7.5)}, ${f(bx)} ${f(by - 10.5)} Z`;
    marks.push(path(budD, { kind: 'tall-flower-bud' }));
  }

  return marks;
}

/** The flower's wrapper scale — kept at the stone's 0.6 so the scatter keep-outs (tree well, spacing,
 *  nameplate band) still hold against the same footprint they were tuned for. The whole marker scales
 *  at the WRAPPER (translate + scale — CSS only ever animates the glow-circle CHILDREN, so the wrapper
 *  transform is never clobbered). */
const MARKER_SCALE = 0.6;

/** The unified vegetation vocabulary's SMALL-flower wrapper scale (ADR-0226 promotion). The small flower
 *  read a touch too small at the 0.6 footprint (owner look verdict 2026-07-22), so the vocabulary scatter
 *  wears a larger wrapper — a low meadow flower that reads clearly against the grass without towering
 *  like the tall (`!small`) markers. Placement + keep-outs are unchanged (they key on the wrapper POINT,
 *  not its size); only the tall flag-off path keeps the historical 0.6. */
const MARKER_SCALE_SMALL = 1.0;

/** Ray-cast point-in-polygon over a substrate cell ring. */
function pointInPoly(x: number, y: number, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

// ---------------------------------------------------------------------------
// PLACING THINGS ON THE GROUND, NOW THAT THE GROUND HAS A CAMERA (ADR-0367 D1)
// ---------------------------------------------------------------------------
//
// Every scatter below asks two questions of a candidate spot: *is it on the island* (a
// point-in-polygon against `RelaxedCell.poly`) and *is it far enough from the tree / the plate / the
// spots already taken*. The polygons are GROUND polygons seen through the declared camera, so their
// vertical extent is only `sin θ` of their ground extent — but the distances were measured
// ISOTROPICALLY IN SCREEN PIXELS, and the polar samples were offset with a hand-picked `0.7`
// y-squash that predates the camera entirely.
//
// Mixing the two fails in ONE direction, which is worth knowing because the plausible story is the
// other one: a ground gap is never SMALLER than the screen gap it projects to, so an isotropic screen
// keep-out never admits a placement the ground would reject — it OVER-enforces. A keep-out that used
// to consume 15 px of a full-height cell demands ~44 ground units once the cell is 34% as tall. So a
// bounded rejection sampler starves on a tight or concave island and relocates the mark onto a cell
// centroid, and a count derived by dividing a length by a spacing — the stone walk — simply loses
// marks, because the length was measured on screen and the spacing on the ground.
//
// THE RULE. A distance that means "how far apart ON THE GROUND" is measured on the ground; an offset
// that means "this far across the ground" is a ground offset PROJECTED. Both go through the camera
// module's own verbs so there is exactly one convention and no second constant. What deliberately
// STAYS in screen space is named where it is used: the painter-order half of the stone occlusion
// test, which is a question about who is DRAWN over whom rather than about where a thing stands.
//
// ⚠ THE NAMEPLATE BAND USED TO BE NAMED HERE AS THE OTHER SURVIVING SCREEN READING, AND IT IS NOT
// ONE ANY MORE (ADR-0545). `y < labelY - 14` was a GROUND PLACEMENT decision measured on the screen,
// on the excuse that the plate had no world position — so a different camera accepted a different
// candidate and the markers landed on different ground, which is exactly the fault this section
// names. The plate is an anchor now ({@link SceneTerritoryInput.anchorSpace}): a `ground` island
// hands over its GROUND baseline, `anchorsToScreen` projects it with the rest, and the band's own
// clearance is a ground distance projected through the camera verb like every other keep-out here.
// Nothing about what the plate LOOKS like moved; what moved is what the placement rule consults.
//
// The number every one of them has to be independent of is the camera itself: the same island in
// GROUND space must place the same marks at the same ground spots at any elevation, and only their
// screen positions may move. That is what `scatter-camera.test.ts` fences.

/**
 * The distance between two SCREEN points, measured on the GROUND PLANE they both stand on.
 *
 * This is the number every "how far apart" keep-out below wants. It equals `Math.hypot` only in plan
 * view, which is why the isotropic form was correct before the land had a camera and wrong the
 * moment it got one.
 */
function groundGap(a: Pt, b: Pt, elevationDeg: number): number {
  const d = unprojectGround({ x: a.x - b.x, y: a.y - b.y }, elevationDeg);
  // ground-space: `d` is the separation already unprojected onto the ground plane, so the isotropic
  // hypot is the ground distance. This function IS the repo's answer to the class the rung guards.
  return Math.hypot(d.x, d.y);
}

// `groundPolarOffset` used to be defined here, privately. It is now the shared export in
// `camera.ts` beside `projectGround` (ADR-0537): the studio layout held a deliberate copy of the
// same two lines because reaching into this package owed an engine sync, and that toll is no
// longer allowed to draw the boundary. Same arithmetic, one definition, imported above.

// The floor on how close two UAT flowers may stand ON THE GROUND (the historical `> 15`) and the
// GROUND radius around the story tree's base no flower is planted inside (the historical `> 36`, which
// also covers the signpost) are `TileArt.markerSpacing` / `markerTreeWell` — the same values on the
// tuned tile, re-based on the tile the scene is drawn on (ADR-0528).

/** The island's UAT markers as INDIVIDUAL y-sorted drawables — one tall flower per criterion,
 *  scattered deterministically (owner call 2026-07-18: no path). Each flower is its own painter
 *  entry so it interleaves honestly with the tree + flora by depth. Placement: per-criterion
 *  id-seeded polar samples inside the island (GROUND radius 0.30–0.80·R, projected through the
 *  declared land camera — see {@link groundPolarOffset}), re-drawn up to 20 times to clear the tree
 *  well (which also covers the signpost beside it), the nameplate band, other flowers — and, when the
 *  island's relaxed substrate cells are provided, to land ON the island (the keep-IN, owner feedback
 *  2026-07-18: the radius-only scatter drifted markers into the water on concave hex clusters).
 *  Deterministic rejection sampling: same input ⇒ the same spots. Exhausting the draws SNAPS to the
 *  nearest free land-cell centroid (never the water) when cells are known, else keeps the last
 *  sample — every criterion ALWAYS renders.
 *  Empty/absent `uatCriteria` ⇒ nothing (the byte-for-byte absence path — the public website
 *  never sends it).
 *
 *  THE KEEP-OUTS ARE GROUND DISTANCES (ADR-0367 D1). The spacing floor and the tree well both ask
 *  "how far apart on the ground", so both are measured with {@link groundGap} rather than a raw
 *  screen `hypot`. Measured isotropically in screen pixels against foreshortened cells they demanded
 *  ~3x the ground they were tuned for, which starves the 20 draws on a tight or concave island and
 *  relocates marks onto cell centroids — several onto the SAME one. THE NAMEPLATE BAND IS A GROUND
 *  QUESTION TOO NOW (ADR-0545): its clearance is a ground distance projected at the scene's camera,
 *  against a plate baseline the caller anchored on the ground — so all FOUR keep-outs mean what they
 *  say, and the same island places the same marks on the same ground at any elevation. */
function buildUatMarkers(
  t: SceneTerritoryInput,
  ownerCells: RelaxedCell[] | null,
  small = false,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
  art: TileArt = SHIPPED_TILE_ART,
): Array<{ y: number; node: SceneG }> {
  const criteria = t.uatCriteria ?? [];
  if (!criteria.length) return [];
  const land = ownerCells && ownerCells.length ? ownerCells : null;
  const onLand = (x: number, y: number): boolean =>
    !land || land.some((c) => pointInPoly(x, y, c.poly));
  const clearsSpacing = (placed: Pt[], x: number, y: number): boolean =>
    // Stryker disable next-line EqualityOperator: EQUIVALENT — a ground gap is a continuous
    // measurement, so `>` and `>=` differ only on an exact float tie, which no fixture can author.
    placed.every((p) => groundGap({ x, y }, p, elevationDeg) > art.markerSpacing);
  const placed: Pt[] = [];
  const out: Array<{ y: number; node: SceneG }> = [];
  criteria.forEach((c) => {
    const k = hash(`${t.id}:marker:${c.id}`);
    let x = t.centroid.x;
    let y = t.centroid.y;
    let settled = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const ang = rand01(k + attempt * 2) * Math.PI * 2;
      const rr = (0.3 + rand01(k + attempt * 2 + 1) * 0.5) * t.groundRadius;
      const off = groundPolarOffset(ang, rr, elevationDeg);
      x = t.centroid.x + off.x;
      y = t.centroid.y + off.y;
      // Stryker disable next-line EqualityOperator: EQUIVALENT — continuous gap, no authorable tie.
      const clearsTree = groundGap({ x, y }, t.treeSpot, elevationDeg) > art.markerTreeWell;
      // The plate's clearance is a GROUND distance, so it foreshortens with everything else it is
      // compared against (ADR-0545). Left as a raw `art.units(14)` against a projected baseline it
      // would still read the camera — a 14-unit screen gap is a 41-unit ground gap at the declared
      // elevation — and the marker would land on different ground at every angle.
      // ⚠ ONE LINE ON PURPOSE: `Stryker disable next-line` binds to the NEXT LINE, so wrapping this
      // expression detaches the exemption from the comparison and reinstates a mutant that cannot
      // be killed. Measured, on this landing.
      // Stryker disable next-line EqualityOperator: EQUIVALENT — continuous y, no authorable tie.
      const clearsPlate = y < t.labelY - groundRadiusToScreenHalfHeight(art.units(14), elevationDeg);
      if (clearsTree && clearsPlate && clearsSpacing(placed, x, y) && onLand(x, y)) {
        settled = true;
        break;
      }
    }
    if (!settled && land) {
      // A hard-to-fit (concave) island exhausted its draws: snap to the nearest land-cell
      // centroid that keeps the stone spacing (nearest of all when every cell is crowded).
      // "Nearest" is nearest ACROSS THE GROUND — a screen-space sort would prefer a cell that is
      // merely further into the distance over one that is genuinely closer.
      const spots = land
        .map((cell) => cellCentroid(cell.poly))
        .sort(
          (a, b) =>
            groundGap(a, { x, y }, elevationDeg) - groundGap(b, { x, y }, elevationDeg),
        );
      const free = spots.find((p) => clearsSpacing(placed, p.x, p.y)) ?? spots[0]!;
      x = free.x;
      y = free.y;
    }
    placed.push({ x, y });
    const kind: SceneKind =
      c.state === 'proven'
        ? 'tall-flower-proven'
        : c.state === 'failing'
          ? 'tall-flower-failing'
          : 'tall-flower-pending';
    out.push({
      y,
      node: g(tallFlowerMarks(c.state, k, small), {
        kind,
        id: c.id,
        // the flower's own drawing scale, re-based onto the derived tile (ADR-0528)
        transform: `translate(${f(x)} ${f(y)}) scale(${f((small ? MARKER_SCALE_SMALL : MARKER_SCALE) * art.scale)})`,
      }),
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// a capability as garden flora (GardenPlant)
// ---------------------------------------------------------------------------

/** A capability as a flower bed / berry bush / sapling (hash-picked variant),
 *  tinted by its folded status; `unhealthy` withers it to the matching dead
 *  silhouette. */
export function buildPlant(p: ScenePlantInput, art: TileArt = SHIPPED_TILE_ART): SceneG {
  const variant = hash(`${p.id}:variant`) % 3;
  const dead = p.status === 'unhealthy';
  const children: SceneNode[] = [circle(0, 0, 9.5, { kind: 'flora-hit' })];
  if (dead) children.push(ellipse(0, 0.5, 8, 3.2, { kind: 'dead-ground' }));
  children.push(ellipse(1, 1, dead ? 6 : 8, dead ? 2.2 : 2.6, { kind: 'shadow' }));
  children.push(buildPlantBody(dead, variant));
  return g(children, {
    kind: 'flora',
    status: p.status,
    // The capability id — the data hook each mapper keys interactivity on (the studio
    // wires onSelectCap from it; the website uses it as data-id for delegation).
    id: p.id,
    title: p.title,
    // drawn in its own frame, scaled onto the derived tile (ADR-0528)
    transform: `translate(${f(p.x)} ${f(p.y)}) scale(${f(art.scale)})`,
  });
}

/** The variant-specific flora body, wrapped in a plain `<g>` (matching the studio's
 *  `body` group). Six silhouettes: dead flower-bed / dead bush / dead sapling, and
 *  the living flower-bed / berry-bush / sapling. */
function buildPlantBody(dead: boolean, variant: number): SceneG {
  if (dead && variant === 0) {
    return g([
      ellipse(0, 0.4, 8.5, 3, { kind: 'flora-bed', opacity: 0.7 }),
      path('M 0.5 0 C 0.6 -6 0.4 -10 2.6 -11.4 C 4.4 -12.4 5.8 -10.8 5.6 -9.2', {
        kind: 'flora-dead-stem',
        strokeWidth: 1.2,
      }),
      circle(5.6, -8.2, 1.7, { kind: 'flora-dead-head', accent: true }),
      path('M -3.5 0 C -4 -5 -4.5 -8.5 -2.5 -10 C -1 -11 0.5 -10 0.8 -8.4', {
        kind: 'flora-dead-stem',
        strokeWidth: 1.1,
      }),
      circle(0.8, -7.6, 1.4, { kind: 'flora-dead-head' }),
      path('M 4.2 0 L 4.8 -5.2 L 7.6 -7.4', { kind: 'flora-dead-stem', strokeWidth: 1.1 }),
      circle(-7, -0.5, 1, { kind: 'litter' }),
      circle(2.5, 1.2, 1, { kind: 'litter' }),
      circle(6.5, 0.2, 1, { kind: 'litter' }),
    ]);
  }
  if (dead && variant === 1) {
    return g([
      path(
        'M 0 0 L -1 -4.5 M -1 -4.5 L -5 -8.5 M -1 -4.5 L 1.5 -9.5 M 1.5 -9.5 L 4.5 -11.5 M 1.5 -9.5 L 0.5 -12.5 M 0 -2.5 L 4 -6',
        { kind: 'flora-dead-twig', strokeWidth: 1.1 },
      ),
      circle(-4.5, -8, 1.1, { kind: 'litter', accent: true }),
      circle(4, -11, 1.1, { kind: 'litter' }),
      circle(-2.5, 0.8, 1, { kind: 'litter' }),
    ]);
  }
  if (dead) {
    return g([
      path('M 0 0 C 0.4 -5 1.5 -9 3.5 -13 M 2 -8.5 L -1.5 -12 M 3 -11 L 6 -13.5', {
        kind: 'flora-dead-twig',
        strokeWidth: 1.4,
      }),
      circle(-3, 0.8, 1, { kind: 'litter' }),
      circle(1.5, 1.4, 1, { kind: 'litter' }),
      circle(5, 0.4, 1, { kind: 'litter', accent: true }),
    ]);
  }
  if (variant === 0) {
    const petals = [0, 1, 2, 3, 4].map((k) => {
      const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
      return circle(0.2 + Math.cos(a) * 2.3, -13 + Math.sin(a) * 2.3, 1.5, { kind: 'flora-light' });
    });
    return g([
      ellipse(0, 0.4, 8.5, 3, { kind: 'flora-bed' }),
      path('M -1 0 Q -7 -3 -9 -7 Q -4.5 -5.5 -1 0 Z', { kind: 'flora-dark' }),
      path('M 1.5 0 Q 7.5 -2.5 9 -6 Q 5 -5 1.5 0 Z', { kind: 'flora-dark' }),
      path('M -4 0 C -4.4 -4 -4.8 -7 -5.2 -10', { kind: 'flora-stem' }),
      path('M 0 0 C 0.2 -5 0.3 -9 0.2 -13', { kind: 'flora-stem' }),
      path('M 4 0 C 4.5 -4 5 -6.5 5.6 -9', { kind: 'flora-stem' }),
      circle(-5.2, -10, 2.6, { kind: 'flora-light' }),
      circle(5.6, -9, 2.3, { kind: 'flora-light' }),
      ...petals,
      circle(0.2, -13, 1.3, { kind: 'flora-core' }),
    ]);
  }
  if (variant === 1) {
    return g([
      polygon('0,-12.5 5.5,-10.5 8.5,-5.5 7,-1 0,0.8 -7,-1 -8.5,-5.5 -5.5,-10.5', {
        kind: 'flora-dark',
      }),
      polygon('-1,-12.5 4.5,-10.8 6,-7 0.5,-5.6 -4.8,-7.4 -4.6,-10.6', { kind: 'flora-light' }),
      circle(-3.5, -4.5, 1.5, { kind: 'flora-core' }),
      circle(2, -7.5, 1.5, { kind: 'flora-core' }),
      circle(4.5, -3.5, 1.4, { kind: 'flora-core' }),
    ]);
  }
  return g([
    path('M -1.2 0 C -1 -4 -0.8 -7 -0.6 -9.5 L 0.9 -9.5 C 1 -7 1.2 -4 1.4 0 Z', {
      kind: 'sapling-trunk',
    }),
    polygon('0,-18.5 5.4,-15.4 6.6,-10.2 3.4,-7.2 -3.4,-7.2 -6.6,-10.2 -5.4,-15.4', {
      kind: 'flora-dark',
    }),
    polygon('-0.6,-18.3 3.8,-15.8 3.4,-12 -1.6,-11.4 -4.4,-14.2', { kind: 'flora-light' }),
  ]);
}

// ---------------------------------------------------------------------------
// conifer decor (DecorTree)
// ---------------------------------------------------------------------------

/** A small leaning conifer with a snow cap — deliberately small so the central
 *  story tree dominates the island. The colour band (`c-N`) comes from the seed. */
export function buildConifer(x: number, y: number, h: number, seed: number, art: TileArt = SHIPPED_TILE_ART): SceneG {
  const lean = (rand01(seed) - 0.5) * 2;
  const w = h * 0.42;
  return g(
    [
      ellipse(1, 1, w * 0.9, 2.4, { kind: 'shadow' }),
      path(`M ${f(lean)} ${f(-h)} L ${f(w)} 0 L ${f(-w)} 0 Z`, {
        kind: 'conifer-body',
        variant: seed % 3,
      }),
      path(
        `M ${f(lean)} ${f(-h)} L ${f(lean + w * 0.45)} ${f(-h * 0.45)} L ${f(lean - w * 0.45)} ${f(-h * 0.45)} Z`,
        { kind: 'conifer-snow' },
      ),
    ],
    // drawn at its authored height, scaled onto the derived tile (ADR-0528)
    { kind: 'conifer', transform: `translate(${f(x)} ${f(y)}) scale(${f(art.scale)})` },
  );
}

// ---------------------------------------------------------------------------
// the in-flight build wisps (the harness orbit)
// ---------------------------------------------------------------------------

/** The orbiting build-harness layer: a wisp orbits a story while a leaf agent is
 *  mechanically building one of its units. Live-data driven (the surface folds
 *  which builds are in-flight); the core derives each orbit phase from the runId
 *  and lays the glow/dot/hit at the orbit radius. The mapper drives the rotation
 *  (the studio's SMIL `animateTransform`, the website's CSS) from `phase`. */
function buildWisps(t: SceneTerritoryInput, art: TileArt): SceneG | null {
  if (!t.wisps.length) return null;
  const orbitR = t.screenRadius * 0.72 + art.units(10);
  const wisps = t.wisps.map((w) => {
    const phase = rand01(hash(w.runId)) * 360;
    // `phase` is the orbit ROTATION (geometry); `phaseBand` is the red→green build state
    // (ADR-0048 §3 v2); `colourState` is the optional live subagent-role tint the work-event
    // stamped (ADR-0138 §5) — three independent fields (location ⟂ form).
    //
    // ANNOTATED local, then one guarded assignment for the optional — the shape
    // `anti-slop/no-conditional-empty-object-spread` requires. The annotation is LOAD-BEARING: an
    // un-annotated literal infers a type WITHOUT `colourState`, the later write stops compiling, and
    // (had it compiled) the literal would no longer be fresh at the `g()` call, so excess-property
    // checking would disappear with nothing going red.
    const wispAttrs: SceneNodeBase = {
      kind: 'wisp',
      title: w.title,
      phase,
      phaseBand: wispBand(w.phase),
    };
    if (w.colourState) wispAttrs.colourState = w.colourState;
    return g(
      [
        g(
          [
            circle(0, 0, 12, { kind: 'wisp-hit' }),
            circle(0, 0, 6.5, { kind: 'wisp-glow' }),
            circle(0, 0, 2.8, { kind: 'wisp-dot' }),
          ],
          { transform: `translate(${f(orbitR)} 0) scale(${f(art.scale)})` },
        ),
      ],
      wispAttrs,
    );
  });
  return g(wisps, { kind: 'wisps', transform: `translate(${f(t.centroid.x)} ${f(t.centroid.y)})` });
}

// ---------------------------------------------------------------------------
// the story-CLAIM wisps (the coordination orbit, ADR-0138 §5)
// ---------------------------------------------------------------------------

/** The orbiting story-CLAIM layer: a wisp orbits a story while a SESSION is working it (someone is
 *  here — the coordination signal, distinct from "a proof is being driven"). Live-data driven (the
 *  surface folds which stories are claimed); the core derives each orbit phase from the claim `key`
 *  and lays the glow/dot/hit at the orbit radius. The mapper drives the rotation from `phase`.
 *
 *  §5 honesty wall (non-negotiable): a claim wisp is a DISTINCT drawable family (`claim-wisp*` kinds)
 *  carrying a `colourState` that is NEVER a proof signal — only a signed verdict greens the island
 *  (ADR-0529/0536 retired the per-landing bloom, so the status hue is the whole proof vocabulary).
 *  A claimed-but-not-proven story can therefore never render as a proven-green one.
 *  Orbits a touch wider than the build wisp so the two layers read as distinct when both are present. */
// The window-shopping orbit radius (ADR-0212 channel 1) is `TileArt.hoverOrbitR`: small and LOCAL —
// deliberately far tighter than the work stage's whole-island orbit, so the two stages read apart on
// position alone.

function buildClaimWisps(t: SceneTerritoryInput, art: TileArt): SceneG | null {
  // `claims` is OPTIONAL (a surface with no live-claim concept omits it) — absent/empty ⇒ no layer.
  const claims = t.claims ?? [];
  if (!claims.length) return null;
  const orbitR = t.screenRadius * 0.72 + art.units(22);
  // the hover rest spot is anchored above the story tree (the layer's frame is the centroid).
  const treeDx = t.treeSpot.x - t.centroid.x;
  const treeDy = t.treeSpot.y - t.centroid.y;
  let queueIndex = 0;
  const wisps = claims.map((c) => {
    // ADR-0200 D2: an ABSENT grade IS the work claim — every pre-grade surface keeps today's orbit.
    const grade = c.grade ?? 'work';
    if (grade === 'exploring') {
      // WINDOW SHOPPING (ADR-0200 D7, position channel restated by ADR-0212): a session is
      // reading/planning here — a SMALL LOCAL ORBIT beside/above the story tree, with a per-key
      // jitter on the rest spot so several hoverers never stack exactly. ADR-0212 REVERSES
      // ADR-0200 D7's "stationary by construction": window shopping now carries its own orbit
      // `phase`, so position alone separates it from the whole-island work orbit (a spinning hover
      // wisp is the DECISION — see ADR-0212 Consequences, not a regression).
      //
      // THREE nesting levels, and the split is load-bearing: an SVG `animateTransform` rotate
      // REPLACES the `transform` attribute on the node it animates, so the rest spot and the
      // rotation can never share one `g` — the dot would sweep the centroid instead of its rest
      // spot. Outer g = the rest spot; middle g = the kind-bearing node the mapper rotates;
      // innermost g = the small orbit radius.
      const k = hash(c.key);
      const hx = treeDx + (rand01(k + 1) - 0.5) * art.units(18);
      const hy = treeDy - (orbitR + art.units(12)) + (rand01(k + 2) - 0.5) * art.units(10);
      const phase = rand01(k) * 360;
      return g(
        [
          g(
            [
              g(
                [
                  circle(0, 0, 12, { kind: 'hover-wisp-hit' }),
                  circle(0, 0, 6.5, { kind: 'hover-wisp-glow' }),
                  circle(0, 0, 2.8, { kind: 'hover-wisp-dot' }),
                ],
                { transform: `translate(${f(art.hoverOrbitR)} 0) scale(${f(art.scale)})` },
              ),
            ],
            // `title` carries the claim's intent prose; NEVER a proof signal (the §5 wall).
            { kind: 'hover-wisp', title: c.title, phase, colourState: c.colourState },
          ),
        ],
        { transform: `translate(${f(hx)} ${f(hy)})` },
      );
    }
    if (grade === 'waiting') {
      // QUEUED (ADR-0200 D7): a visible ordered line anchored just outside the orbit ring — each
      // waiter placed by its queue INDEX in INPUT order (the surface sends waiters ordered by
      // claimedAt — deterministic from array order, never hash-random) and stationary (no `phase`).
      const qx = orbitR + art.units(14) + queueIndex * art.units(16);
      queueIndex += 1;
      return g(
        [
          g(
            [
              circle(0, 0, 12, { kind: 'queue-wisp-hit' }),
              circle(0, 0, 6.5, { kind: 'queue-wisp-glow' }),
              circle(0, 0, 2.8, { kind: 'queue-wisp-dot' }),
            ],
            { transform: `translate(${f(qx)} 0) scale(${f(art.scale)})` },
          ),
        ],
        // NEVER carries a proof signal (the §5 wall).
        { kind: 'queue-wisp', title: c.title, colourState: c.colourState },
      );
    }
    // WORK — today's orbiting claim wisp, unchanged (the ADR-0200 D2 regression lock).
    const phase = rand01(hash(c.key)) * 360;
    // `phase` is the orbit ROTATION (geometry); `colourState` is the subagent role (form) — two
    // independent fields (location ⟂ form). NEVER carries a proof signal (the §5 wall).
    // `phaseBand` (ADR-0212) is the live build state folded onto this ONE body, replacing the
    // separate orbiting build wisp: colour stays INTENT (`colourState`, never green), the band is
    // the build phase. Absent when no build runs on this story — back-compat byte-for-byte, which
    // the guarded assignment preserves exactly as the conditional spread did.
    const claimAttrs: SceneNodeBase = {
      kind: 'claim-wisp',
      title: c.title,
      phase,
      colourState: c.colourState,
    };
    if (c.phase) claimAttrs.phaseBand = wispBand(c.phase);
    return g(
      [
        g(
          [
            circle(0, 0, 12, { kind: 'claim-wisp-hit' }),
            circle(0, 0, 6.5, { kind: 'claim-wisp-glow' }),
            circle(0, 0, 2.8, { kind: 'claim-wisp-dot' }),
          ],
          { transform: `translate(${f(orbitR)} 0) scale(${f(art.scale)})` },
        ),
      ],
      claimAttrs,
    );
  });
  return g(wisps, {
    kind: 'claim-wisps',
    transform: `translate(${f(t.centroid.x)} ${f(t.centroid.y)})`,
  });
}

/** The DEPARTURE layer (ADR-0200 D7): a recently-released claim fading out — a stationary
 *  `departing-wisp` per departure, resting where the hover family rests and drifting UPWARD
 *  proportional to `ageRatio` (the "leaving" translation, encoded deterministically in geometry).
 *  `ageRatio` (0..1, surface-computed) rides the node for the mapper's fade — the curve itself is
 *  the mapper/CSS's job (the later operator-attested LOOK stage). Same §5 honesty wall as the claim
 *  families: a departure is a coordination trace, never a proof signal. Absent/empty ⇒
 *  no layer (the website back-compat mirror of `buildClaimWisps`). */
function buildDepartingWisps(t: SceneTerritoryInput, art: TileArt): SceneG | null {
  const departures = t.departures ?? [];
  if (!departures.length) return null;
  const orbitR = t.screenRadius * 0.72 + art.units(22);
  const treeDx = t.treeSpot.x - t.centroid.x;
  const treeDy = t.treeSpot.y - t.centroid.y;
  const wisps = departures.map((d) => {
    const k = hash(d.key);
    const x = treeDx + (rand01(k + 1) - 0.5) * art.units(18);
    const y = treeDy - (orbitR + art.units(12)) - d.ageRatio * art.units(24);
    return g(
      [
        g(
          [
            circle(0, 0, 12, { kind: 'departing-wisp-hit' }),
            circle(0, 0, 6.5, { kind: 'departing-wisp-glow' }),
            circle(0, 0, 2.8, { kind: 'departing-wisp-dot' }),
          ],
          { transform: `translate(${f(x)} ${f(y)}) scale(${f(art.scale)})` },
        ),
      ],
      // stationary (no `phase`); `ageRatio` is the mapper's fade input. NEVER a proof signal.
      { kind: 'departing-wisp', title: d.title, ageRatio: d.ageRatio },
    );
  });
  return g(wisps, {
    kind: 'departing-wisps',
    transform: `translate(${f(t.centroid.x)} ${f(t.centroid.y)})`,
  });
}

// ---------------------------------------------------------------------------
// the nameplate (world-plate)
// ---------------------------------------------------------------------------

/**
 * THE NAMEPLATE'S DRAWING SCALE — the 2D art pass's rung for the plate (ADR-0528 D2). The plate box
 * (`nameplateLayout`, studio-side) and its CSS text sizes are authored in the plate's own frame; this
 * scales that frame onto the derived tile. At `TILE_SCALE` the plate keeps the exact on-screen size it
 * had at the designed resting view. ⚠ The 2D map is a WORKING tool — the plate is what an operator
 * reads a story's id and state off — so this is the rung the increment's sheet judges hardest, at the
 * working zoom rather than the fitted one.
 */
export const PLATE_SCALE = SHIPPED_TILE_ART.plate;

function buildPlate(t: SceneTerritoryInput, art: TileArt): SceneG {
  const p = t.plate;
  return g(
    [
      rect(0, 0, p.w, p.h, p.rx, { kind: 'plate-bg' }),
      text(p.w / 2, p.idY, p.idText, 'middle', { kind: 'plate-id' }),
      text(p.w / 2, p.subY, p.subText, 'middle', { kind: 'plate-sub' }),
    ],
    {
      kind: 'plate',
      title: p.title,
      // centred on the island in ground units, then the plate's own frame scaled onto the tile
      transform: `translate(${f(t.centroid.x - (p.w * art.plate) / 2)} ${f(t.labelY)}) scale(${f(art.plate)})`,
    },
  );
}

// ---------------------------------------------------------------------------
// capability PARCELS — the land IS the capability (forest-parcels inc 1)
// ---------------------------------------------------------------------------
//
// A parcels-present island sub-partitions its EXISTING relaxed substrate cells among its
// capabilities (equal-weight Voronoi over each parcel's seed), tints each cell by its assigned cap's
// status, and surfaces each parcel through its theme's `SurfaceFn`. THE SPLICE SEAM below (`SurfaceFn`
// + the `SURFACES` registry) is the contract a designer swarm plugs into (ADR-0208): each theme
// returns `{ ground, flora }` from the parcel's cells / status / testCount / a seeded rand. The three
// functions ported here are the INITIAL in-repo implementations — designer-refined ones splice over
// them later (the seam's shape + the kinds vocabulary are frozen; the craft is not). Everything is
// deterministic (a seeded rand stream, no Math.random).

/** One ground cell handed to a `SurfaceFn`: the resolved polygon + its centroid (the flora anchor).
 *  The spike's `{ poly, cx, cy }`; its `boundary` flag drove a per-cell hem stroke that would need
 *  NEW ground CSS, so it is dropped here — the ground reuses the existing `st-<status>` cell CSS. */
export interface ParcelCell {
  poly: Pt[];
  cx: number;
  cy: number;
}

/** One placed flora item a `SurfaceFn` emits — the spike's `{ y, svg }`, with `svg` now a SceneNode.
 *  `y` is the item's painter-anchor (the island y-sorts flora with the tree so southern art overlaps
 *  northern). */
export interface ParcelFloraMark {
  y: number;
  node: SceneNode;
}

/** The nodes ONE flora sub-painter draws, plus the painter-anchor they y-sort at — what each
 *  surface's internal `fern` / `shrub` / `sapling` / `grassTuft` / `bellCluster` / `flower` helper
 *  hands back before {@link ParcelFloraMark} wraps it into a single node.
 *
 *  Named rather than written inline at each of the seven helpers because
 *  `anti-slop/no-known-value-widening` reads a repeated anonymous return annotation as discarded
 *  type evidence, and inc-08's refactor panel settled the fork 3-0 the other way from deleting it:
 *  with no build step and raw TypeScript exported, the declaration site is the only API-surface
 *  document there is. `marks` is plural and `node` singular on purpose — a helper may draw several
 *  nodes for one anchor. */
interface FloraMarkGroup {
  y: number;
  marks: SceneNode[];
}


/** THE SPLICE SEAM (ADR-0208): a per-theme surface painter. Frozen contract
 *  `(cells, status, testCount, rand) => { ground, flora }` — turns a capability parcel's cells into
 *  its tinted ground cell nodes + its placed flora marks. `rand` is a seeded STATEFUL stream (the
 *  core seeds it per parcel), so a `SurfaceFn` MUST stay deterministic — draw only from `rand`, never
 *  Math.random. A designer swarm ships refined implementations that splice into `SURFACES`. */
export type SurfaceFn = (
  cells: ParcelCell[],
  status: SceneStatus,
  testCount: number,
  rand: () => number,
  /** The unified vegetation vocabulary (ADR-0226 decision 2): when true, the theme's DECORATIVE bloom
   *  tier is retired (the meadow wildflower, the woodland anemone, the heath heather-bells) so a
   *  flower on an island means one thing — a UAT criterion. The grass / fern / shrub / mound BULK and
   *  the status accents (sprouts / wilt / building-sparks) stay. Absent/false ⇒ today's surface
   *  byte-for-byte. */
  unifiedVeg?: boolean,
  /** The tile the parcel is drawn on (ADR-0528) — the drift-bed spread and every mark's drawing scale
   *  re-base on it. Absent ⇒ the shipped tile. Trailing and optional, so the frozen seam's callers
   *  and every existing surface are unchanged in shape. */
  art?: TileArt,
) => ParcelSurface;

/** A seeded mulberry32 STREAM `() => number` (a `SurfaceFn` draws many values). Mirrors the spike's
 *  `mulberry32(hash(seed))`; `rand01` in rng.ts is a single-STEP variant, so the stream lives here.
 *  Browser-safe, deterministic. */
function streamRand(seed: string): () => number {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The shared parcel GROUND: every cell reused as the existing `cell` kind carrying the parcel's
 *  folded status (so `st-<status>` colours it — ZERO new ground CSS) + a rand tone variant. */
function parcelGround(cells: ParcelCell[], status: SceneStatus, rand: () => number): SceneNode[] {
  return cells.map((c) =>
    path(polyPath(c.poly), { kind: 'cell', variant: Math.floor(rand() * 3), status }),
  );
}

// --- the three DESIGNER-AUTHORED theme surfaces (ADR-0208 splice) ------------------
//
// Ported faithfully from the designer swarm's `meadow.js` / `woodland.js` / `heath.js` (SVG-string
// medium → SceneNode). The designers' own GROUND passes + `cell.boundary` hems are DROPPED — the
// core's `parcelGround` owns the per-cell status-tinted ground (zero new ground CSS); only each
// theme's FLORA vocabulary is ported, verbatim in geometry / density / status-composition / placement.
// Every designer mark family maps onto the frozen generic kinds (`parcel-blade` / `parcel-shrub` /
// `parcel-stem` / `parcel-flower` + shared `shadow`); cel-shading faces and within-tier colour
// rotation ride `variant` (v0 light face, v1 dark face, v2+ rotation — a distinct sub-look like the
// woodland sapling canopy takes its own variants, never a new kind); COLOUR itself stays CSS-side
// (`apps/studio/src/index.css`, keyed `.parcel-flora.theme-<t>.st-<status>` × mark × `.v-<n>`). Each
// function consumes `rand` in the DESIGNER's exact order, so it stays pure + deterministic (the
// scene determinism test enforces identical output for identical input).

/** Wrap a theme's absolute-coord marks as one placed `parcel-flora` item at painter-anchor `y`. The
 *  capId is stamped later (in `buildTerritorySurface`, where the parcel identity is known). */
/**
 * THE PARCEL FLORA'S DRAWING SCALE (ADR-0528 D2) — the designer surfaces (`meadow.js` / `woodland.js`
 * / `heath.js`) draw their marks in ABSOLUTE coordinates around each drift-bed spot, at sizes judged
 * against the radius-27 tile; the marks are ported verbatim and are not re-authored. Each item is
 * therefore scaled ABOUT ITS OWN SPOT: `translate(p) scale(s) translate(-p)` leaves the spot where the
 * drift placed it (so containment and painter order are untouched) and shrinks the mark around it.
 */
export const FLORA_SCALE = SHIPPED_TILE_ART.flora;

function parcelFloraItem(
  theme: SurfaceTheme,
  status: SceneStatus,
  y: number,
  marks: SceneNode[],
  /** The drift-bed spot the marks were drawn around — the pivot the item scales about. */
  pivot: Pt,
  art: TileArt,
  opacity?: number,
): ParcelFloraMark {
  // ANNOTATED local, then one guarded assignment — the shape
  // `anti-slop/no-conditional-empty-object-spread` requires. The annotation is load-bearing: without
  // it the inferred type has no `opacity` and the write below stops compiling.
  const attrs: SceneNodeBase = {
    kind: 'parcel-flora',
    theme,
    status,
    // The semantic values are the same one-decimal values serialized into the canonical SVG
    // pivot-scale-pivot transform, so consumers see exactly the drawable's positioned anchor.
    groundAnchor: { x: Number(f(pivot.x)), y: Number(f(pivot.y)) },
    floraScale: Number(f(art.flora)),
    transform: `translate(${f(pivot.x)} ${f(pivot.y)}) scale(${f(art.flora)}) translate(${f(-pivot.x)} ${f(-pivot.y)})`,
  };
  if (opacity != null) attrs.opacity = opacity;
  return { y, node: g(marks, attrs) };
}

/** How many times a drift placement is resampled before it gives up and plants on its anchor.
 *
 *  REJECT-AND-RESAMPLE, not clamp, and the difference is the MASSING. Pulling an escaped point back
 *  toward its anchor (the `towardLand` ladder this file uses for the island keep-in) would pile every
 *  rejected placement onto the parcel's boundary, which is a visible line of plants where there was
 *  open lawn. Redrawing keeps the distribution exactly what it was — sqrt-uniform inside the bed —
 *  merely conditioned on landing in the parcel, so the 2026-07-18 massing decision survives the fix
 *  rather than being traded against it.
 *
 *  WHY 12. The measured escape rate runs 5.6% on a bare parcel to 22.2% on the largest bed the
 *  density budget builds (tests = 20, spread = 18), so twelve independent redraws exhaust with
 *  probability 0.222^12 ≈ 1e-8 on the worst REAL parcel. It is a bound, not a tuning knob: the value
 *  only decides how a pathological parcel — one small cell under a large bed — degrades, and any
 *  value large enough to make that probability negligible behaves identically on real ground.
 *
 *  THE FALLBACK IS PROVABLY INSIDE. An anchor is a cell's own vertex-mean centroid, and the mesh's
 *  cells are convex, so the anchor lies in the cell it came from and therefore in the parcel:
 *  measured 0 of 12,150 anchors outside their parcel across all three substrate modes. That is what
 *  makes exhaustion safe to give up on — the escape hatch cannot itself escape. */
export const DRIFT_CONTAINMENT_TRIES = 12;

/** DRIFTS & CLEARINGS (the owner-directed vegetation refinement, 2026-07-18): every theme spends
 *  its density budget inside 1–2 seeded drift BEDS per parcel instead of an even all-cells
 *  scatter — massed vegetation with open lawn between reads as a garden, not static. The drift's
 *  AREA grows with the test count (spread = 7 + tests·0.55; two beds once tests ≥ 7), so density
 *  stays legible as "how big is the bed" while the counts themselves are untouched. Deterministic:
 *  anchors and every placement draw only from the parcel's seeded `rand`. The y-radius wears the
 *  same top-down squash the wisp orbit uses.
 *
 *  ⚠ EVERY PLACEMENT IS CONTAINED BY THE PARCEL THAT TINTS IT
 *  (`driftspot-plants-stand-on-the-ground-that-tinted-them`). `buildTerritorySurface` stamps every
 *  mark this positions with its parcel's `capId`, and the ground under it wears that capability's
 *  STATUS. A placement that drifted over the boundary therefore carried capability A's proof state
 *  while standing on capability B's ground — ADR-0226 makes the vegetation MEAN something and
 *  ADR-0367 D5 puts semantic state above the art, so that is a false claim, not a wobble. There was
 *  no containment test of any kind: measured, 10.21% of 90,800 placements landed off their parcel,
 *  rising from 5.55% on a bare parcel to 22.18% on the largest bed the density budget builds.
 *  `drift-containment.test.ts` holds it at zero and re-measures the massing either side.
 *
 *  ⚠ EXPORTED FOR THAT PROOF, and it has a precondition: `cells` must be NON-EMPTY. All three
 *  `SurfaceFn`s return early on an empty parcel before they ever call this. */
export function driftSpot(cells: ParcelCell[], tests: number, rand: () => number, art: TileArt = SHIPPED_TILE_ART): () => Pt {
  const anchors: Pt[] = [];
  const n = tests >= 7 ? 2 : 1;
  for (let d = 0; d < n; d++) {
    const c = cells[Math.floor(rand() * cells.length)]!;
    anchors.push({ x: c.cx, y: c.cy });
  }
  const spread = art.units(7 + Math.max(0, tests) * 0.55); // a bed's radius, authored on the tuned tile
  // THE CONTAINMENT TEST. `cells` is exactly the parcel's own share of the island's mesh, so this
  // asks the only question that makes the tint true: is this plant standing on the capability that
  // coloured it? The polygons are GROUND polygons seen through the declared camera, and
  // point-in-polygon is affine-invariant — a point is inside a polygon in projected coordinates iff
  // it is inside in ground coordinates — so this needs no unprojection and cannot depend on the
  // camera. (The `* 0.6` squash below is a different question, and deliberately not answered here —
  // it is a second site of this arc's fault class and needs its own owner-scoped increment.)
  const onParcel = (x: number, y: number): boolean => cells.some((c) => pointInPoly(x, y, c.poly));
  return (): Pt => {
    const a = anchors[Math.floor(rand() * anchors.length)]!;
    for (let t = 0; t < DRIFT_CONTAINMENT_TRIES; t++) {
      const ang = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * spread;
      const ox = Math.cos(ang) * rr;
      const oy = Math.sin(ang) * rr * 0.6; // the top-down squash the wisp orbit wears
      // Stryker disable next-line ArithmeticOperator: EQUIVALENT — `ang` is uniform on [0, 2π), so
      // negating either component of the offset maps the placement distribution exactly onto itself.
      // No property of the bed can separate `+` from `-` here, and one that appeared to would be
      // measuring the seed rather than the geometry. `substrate.ts`'s jitter carries the same
      // symmetry, and `substrate-camera.test.ts` records the same limit for the same reason.
      const p: Pt = { x: a.x + ox, y: a.y + oy };
      if (onParcel(p.x, p.y)) return p;
    }
    return { x: a.x, y: a.y };
  };
}

/** MEADOW (meadow.js) — long-grass tufts are the density bulk, healthy ground crowned with 4-petal
 *  wildflowers (ONE species — the colour rotation retired with the drift refinement; hue is CSS's),
 *  amber sprouts while proposed/building, fallen twigs + wilt-red flecks when unhealthy. Budget is
 *  planted in drift beds (`driftSpot`), per-item ground shadows retired — the marks sit in massed
 *  beds, not as individually-shadowed objects. grass → `parcel-blade`, shrub → `parcel-shrub`,
 *  flower/bud/fleck → `parcel-flower`, flower-stem/sprout-stem/twig/wilt → `parcel-stem`. */
function meadowSurface(
  cells: ParcelCell[],
  status: SceneStatus,
  tests: number,
  rand: () => number,
  unifiedVeg = false,
  art: TileArt = SHIPPED_TILE_ART,
): ParcelSurface {
  const ground = parcelGround(cells, status, rand);
  const flora: ParcelFloraMark[] = [];
  if (!cells.length) return { ground, flora };

  const item = (y: number, marks: SceneNode[], pivot: Pt): ParcelFloraMark =>
    parcelFloraItem('meadow', status, y, marks, pivot, art);

  // density budget (verbatim): grass is the ramp bulk; shrubs a "grown" mark only where standing bulk
  // grows (healthy/building/unhealthy); flowers a healthy (mapped-rare) accent — but the decorative
  // wildflower tier is RETIRED under the unified vegetation vocabulary (ADR-0226 decision 2: the meadow
  // reads as PURE GRASS, so a "flower" means a UAT criterion and nothing else).
  const shrubEligible = status === 'healthy' || status === 'building' || status === 'unhealthy';
  let grassCount: number;
  let shrubCount: number;
  let flowerCount: number;
  if (tests <= 0) {
    grassCount = Math.min(2, cells.length);
    shrubCount = 0;
    flowerCount = 0;
  } else {
    grassCount = Math.round(2 + tests * 1.9);
    shrubCount = shrubEligible ? Math.round(tests / 2.6) : 0;
    flowerCount = unifiedVeg
      ? 0
      : status === 'healthy'
        ? Math.round(Math.max(0, tests - 1) * 0.7)
        : status === 'mapped'
          ? tests >= 8
            ? 1
            : 0
          : 0;
  }
  if (status === 'unhealthy') shrubCount = Math.round(shrubCount * 0.7);
  if (status === 'unknown') grassCount = Math.round(grassCount * 0.6);
  if (status === 'mapped' || status === 'proposed') grassCount = Math.round(grassCount * 0.85);
  const lushBlade = (status === 'healthy' || status === 'building') && tests >= 6;

  // the drift beds: the whole budget plants inside them (open lawn is part of the drawing)
  const spot = driftSpot(cells, tests, rand, art);

  // mark: long grass tuft — 3-4 filled two-face blades (dark back-face v1 under a narrower light
  // front-face v0).
  const grassTuft = (x: number, y: number): SceneNode[] => {
    const n = status === 'unknown' ? 2 : lushBlade && rand() < 0.55 ? 4 : 3;
    const marks: SceneNode[] = [];
    for (let b = 0; b < n; b++) {
      const bx = x + (b - (n - 1) / 2) * 2.0 + (rand() - 0.5) * 0.7;
      const lean = (rand() - 0.5) * 3.4;
      const h = (status === 'unknown' ? 2.6 : 3.4) + rand() * 2.4;
      const tipx = bx + lean;
      const tipy = y - h;
      const midx = bx + lean * 0.45;
      const midy = y - h * 0.55;
      marks.push(
        path(
          `M ${f(bx - 0.75)} ${f(y)} Q ${f(midx - 0.5)} ${f(midy)} ${f(tipx)} ${f(tipy)} Q ${f(midx + 0.75)} ${f(midy)} ${f(bx + 0.75)} ${f(y)} Z`,
          { kind: 'parcel-blade', variant: 1 },
        ),
      );
      marks.push(
        path(
          `M ${f(bx - 0.28)} ${f(y)} Q ${f(midx - 0.16)} ${f(midy)} ${f(tipx)} ${f(tipy)} Q ${f(midx + 0.35)} ${f(midy)} ${f(bx + 0.45)} ${f(y)} Z`,
          { kind: 'parcel-blade', variant: 0 },
        ),
      );
    }
    return marks;
  };

  // mark: small shrub — 3 dark under-lobes (v1) set a bushy silhouette, 2 light crown lobes (v0), a
  // dark berry only when unhealthy (the healthy red-berry accent retired with the quiet palette).
  const shrub = (x: number, y: number): SceneNode[] => {
    const s = 1.1 + rand() * 0.4;
    const marks: SceneNode[] = [];
    const lobes: readonly (readonly [number, number, number])[] = [
      [-2.3, 0.9, 1.9],
      [2.1, 1.1, 2.0],
      [0.2, -0.6, 2.5],
    ];
    for (const [lx0, ly0, lr0] of lobes) {
      const lx = lx0 * s + (rand() - 0.5) * 0.8;
      const ly = ly0 * s + (rand() - 0.5) * 0.5;
      const lr = lr0 * s;
      marks.push(ellipse(x + lx, y + ly, lr, lr * 0.78, { kind: 'parcel-shrub', variant: 1 }));
    }
    marks.push(ellipse(x - 1.3 * s, y - 1.2 * s, 1.9 * s, 1.35 * s, { kind: 'parcel-shrub', variant: 0 }));
    marks.push(
      ellipse(x + 0.9 * s, y - 0.9 * s, 1.3 * s, 0.95 * s, { kind: 'parcel-shrub', variant: 0, opacity: 0.9 }),
    );
    if (status === 'unhealthy' && rand() < 0.7) {
      marks.push(circle(x + (rand() - 0.5) * 3.4 * s, y - rand() * 1.4 * s, 0.65 * s, { kind: 'parcel-flower', variant: 3 }));
    }
    return marks;
  };

  // mark: flower — stem (parcel-stem v1) + 4-petal blossom (ONE species: petal v0 — the island
  // agrees on a flower; the old 0/4/5/6 hue rotation read as confetti) + core (v1) + a speck (v2).
  const flower = (x: number, y: number): SceneNode[] => {
    const petalV = 0;
    const top = y - 4.6 - rand() * 1.6;
    const marks: SceneNode[] = [];
    marks.push(path(`M ${f(x)} ${f(y)} L ${f(x)} ${f(top + 1.0)}`, { kind: 'parcel-stem', variant: 1, strokeWidth: 0.9 }));
    for (const [dx, dy] of [[-1.4, 0], [1.4, 0], [0, -1.4], [0, 1.4]] as const) {
      marks.push(circle(x + dx, top + dy, 1.35, { kind: 'parcel-flower', variant: petalV }));
    }
    marks.push(circle(x, top, 1.05, { kind: 'parcel-flower', variant: 1 }));
    marks.push(circle(x - 0.3, top - 0.3, 0.4, { kind: 'parcel-flower', variant: 2 }));
    return marks;
  };

  // mark: sprout (proposed = muted straw bud, building = amber active bud) — stem (parcel-stem v1) +
  // bud (dark v1 / light v0 / highlight v2) + two seed-leaves (parcel-stem v0).
  const sprout = (x: number, y: number): SceneNode[] => {
    const h = 3.4 + rand() * 2.0;
    const lean = (rand() - 0.5) * 2.0;
    const tipx = x + lean;
    const tipy = y - h;
    const marks: SceneNode[] = [];
    marks.push(path(`M ${f(x)} ${f(y)} Q ${f(x + lean * 0.4)} ${f(y - h * 0.55)} ${f(tipx)} ${f(tipy)}`, { kind: 'parcel-stem', variant: 1, strokeWidth: 1.0 }));
    marks.push(circle(tipx, tipy - 0.9, 1.45, { kind: 'parcel-flower', variant: 1 }));
    marks.push(circle(tipx - 0.35, tipy - 1.25, 0.8, { kind: 'parcel-flower', variant: 0 }));
    marks.push(circle(tipx - 0.55, tipy - 1.45, 0.32, { kind: 'parcel-flower', variant: 2 }));
    marks.push(path(`M ${f(x - 0.35)} ${f(y - 0.5)} Q ${f(x - 1.55)} ${f(y - 1.05)} ${f(x - 2.0)} ${f(y - 2.0)}`, { kind: 'parcel-stem', variant: 0, strokeWidth: 0.65, opacity: 0.85 }));
    marks.push(path(`M ${f(x + 0.35)} ${f(y - 0.6)} Q ${f(x + 1.4)} ${f(y - 1.0)} ${f(x + 1.8)} ${f(y - 1.8)}`, { kind: 'parcel-stem', variant: 0, strokeWidth: 0.55, opacity: 0.7 }));
    return marks;
  };

  // mark: unhealthy fallen twig (parcel-stem v0 + bright fleck v0) OR a drooping wilt stem (parcel-stem
  // v1 + dark fleck v1 + bright fleck v0).
  const wilt = (x: number, y: number): SceneNode[] => {
    if (rand() < 0.5) {
      const cw = 3.2 + rand() * 2.0;
      return [
        path(`M ${f(x - cw)} ${f(y)} L ${f(x - cw * 0.3)} ${f(y + 0.8)} L ${f(x + cw * 0.35)} ${f(y - 0.6)} L ${f(x + cw)} ${f(y + 0.6)}`, { kind: 'parcel-stem', variant: 0, strokeWidth: 1.0, opacity: 0.85 }),
        circle(x + cw * 0.35, y - 1.3, 0.7, { kind: 'parcel-flower', variant: 0 }),
      ];
    }
    const dir = rand() < 0.5 ? -1 : 1;
    const th = 3.6 + rand() * 1.6;
    return [
      path(`M ${f(x)} ${f(y)} Q ${f(x + dir * 0.5)} ${f(y - th)} ${f(x + dir * 2.3)} ${f(y - th + 1.6)}`, { kind: 'parcel-stem', variant: 1, strokeWidth: 1.0 }),
      circle(x + dir * 2.3, y - th + 1.6, 1.05, { kind: 'parcel-flower', variant: 1 }),
      circle(x + dir * 1.9, y - th + 1.3, 0.5, { kind: 'parcel-flower', variant: 0 }),
    ];
  };

  // assembly (counts verbatim): shrubs first (grass reads over them), then the grass bulk, then
  // the status-specific accent layer — all planted inside the drift beds.
  for (let k = 0; k < shrubCount; k++) {
    const ps = spot();
    flora.push(item(ps.y + art.units(1), shrub(ps.x, ps.y), ps));
  }
  for (let k = 0; k < grassCount; k++) {
    const pg = spot();
    const marks = grassTuft(pg.x, pg.y);
    if (status === 'unhealthy' && rand() < 0.4) marks.push(...wilt(pg.x + 3, pg.y));
    flora.push(item(pg.y, marks, pg));
  }
  if (status === 'healthy' || (status === 'mapped' && flowerCount)) {
    for (let k = 0; k < flowerCount; k++) {
      const pf = spot();
      flora.push(item(pf.y, flower(pf.x, pf.y), pf));
    }
  }
  if (status === 'proposed' || status === 'building') {
    const sproutCount = tests <= 0 ? 0 : Math.max(1, Math.round(tests * (status === 'building' ? 0.6 : 0.45)));
    for (let k = 0; k < sproutCount; k++) {
      const psp = spot();
      flora.push(item(psp.y, sprout(psp.x, psp.y), psp));
    }
  }
  if (status === 'unhealthy') {
    const wiltCount = tests <= 0 ? 0 : Math.max(1, Math.round(tests * 0.4));
    for (let k = 0; k < wiltCount; k++) {
      const pw = spot();
      flora.push(item(pw.y, wilt(pw.x, pw.y), pw));
    }
  }
  return { ground, flora };
}

/** WOODLAND (woodland.js) — a fern-frond understory (density bulk) with leafy undershrubs, anemone
 *  blooms, and a BONUS sapling canopy at high density; withered twigs + red flecks when unhealthy.
 *  fern → `parcel-blade`; undershrub → `parcel-shrub` (v0/v1); sapling CROWN → `parcel-shrub`
 *  (v2/v3 — the distinct canopy sub-look on its own variants, per the frozen vocab); flower →
 *  `parcel-flower`; flower-stem/trunk/twig → `parcel-stem` (twig v0 / flower-stem v1 / trunk v2). */
function woodlandSurface(
  cells: ParcelCell[],
  status: SceneStatus,
  tests: number,
  rand: () => number,
  unifiedVeg = false,
  art: TileArt = SHIPPED_TILE_ART,
): ParcelSurface {
  const ground = parcelGround(cells, status, rand);
  const flora: ParcelFloraMark[] = [];
  if (!cells.length) return { ground, flora };

  const item = (y: number, marks: SceneNode[], pivot: Pt): ParcelFloraMark =>
    parcelFloraItem('woodland', status, y, marks, pivot, art);
  const fleck = (x: number, y: number): SceneNode => circle(x, y, 0.8, { kind: 'parcel-flower', variant: 0 });
  const distressed = status === 'unhealthy';

  const bladePath = (
    x: number,
    y: number,
    tipx: number,
    tipy: number,
    midx: number,
    midy: number,
    bw: number,
  ): string =>
    `M${f(x - bw * 0.5)} ${f(y)} Q${f(midx - bw * 0.4)} ${f(midy)} ${f(tipx)} ${f(tipy)} Q${f(midx + bw * 0.4)} ${f(midy)} ${f(x + bw * 0.5)} ${f(y)} Z`;

  // the drift beds: the whole budget plants inside them (the old spread-maximising pick retired —
  // massing is the point now).
  const spot = driftSpot(cells, tests, rand, art);

  // mark: fern tuft — each blade a dark back-half (v1) under a narrower light front-half (v0).
  const fern = (x: number, y: number): FloraMarkGroup => {
    const s = 1.05 + rand() * 0.4;
    if (distressed) {
      const marks: SceneNode[] = [];
      marks.push(
        path(
          `M${f(x - 1.2 * s)} ${f(y)} L${f(x - 2.3 * s)} ${f(y - 3 * s)} M${f(x + 0.6 * s)} ${f(y)} L${f(x + 1.9 * s)} ${f(y - 3.4 * s)} M${f(x - 0.3 * s)} ${f(y)} L${f(x)} ${f(y - 3.9 * s)}`,
          { kind: 'parcel-stem', variant: 0, strokeWidth: 0.9 },
        ),
      );
      marks.push(fleck(x + 1.9 * s, y - 3.6 * s));
      return { y, marks };
    }
    const n = 3 + Math.floor(rand() * 2);
    const marks: SceneNode[] = [];
    for (let b = 0; b < n; b++) {
      const t = n === 1 ? 0.5 : b / (n - 1);
      const lean = (t - 0.5) * 5.6 * s;
      const h = 5.2 * s * (0.82 + rand() * 0.34);
      const tipx = x + lean;
      const tipy = y - h;
      const midx = x + lean * 0.55;
      const midy = y - h * 0.6;
      const bw = 2.0 * s;
      marks.push(path(bladePath(x, y, tipx, tipy, midx, midy, bw), { kind: 'parcel-blade', variant: 1 }));
      const lTipx = x + lean * 0.92 - bw * 0.16;
      const lTipy = y - h * 0.86;
      const lMidx = x + lean * 0.5 - bw * 0.12;
      const lMidy = y - h * 0.5;
      marks.push(path(bladePath(x, y, lTipx, lTipy, lMidx, lMidy, bw * 0.52), { kind: 'parcel-blade', variant: 0 }));
    }
    return { y, marks };
  };

  // mark: undershrub — side lump + main dome (dark v1) + upper-left highlight lobe (light v0).
  const shrub = (x: number, y: number): FloraMarkGroup => {
    const s = 0.85 + rand() * 0.35;
    if (distressed) {
      const marks: SceneNode[] = [];
      marks.push(
        path(
          `M${f(x - 1.6 * s)} ${f(y)} L${f(x - 3.0 * s)} ${f(y - 3.6 * s)} M${f(x + 1.0 * s)} ${f(y)} L${f(x + 2.6 * s)} ${f(y - 4.2 * s)} M${f(x - 0.2 * s)} ${f(y)} L${f(x + 0.2 * s)} ${f(y - 4.8 * s)}`,
          { kind: 'parcel-stem', variant: 0, strokeWidth: 1 },
        ),
      );
      marks.push(fleck(x - 3.0 * s, y - 3.8 * s), fleck(x + 2.6 * s, y - 4.4 * s));
      return { y, marks };
    }
    const marks: SceneNode[] = [];
    const lumpSide = rand() < 0.5 ? -1 : 1;
    marks.push(ellipse(x + lumpSide * 2.6 * s, y + 0.7 * s, 2.3 * s, 1.7 * s, { kind: 'parcel-shrub', variant: 1 }));
    marks.push(ellipse(x, y, 3.8 * s, 2.7 * s, { kind: 'parcel-shrub', variant: 1 }));
    marks.push(ellipse(x - 1.3 * s, y - 1.0 * s, 2.1 * s, 1.4 * s, { kind: 'parcel-shrub', variant: 0 }));
    return { y: y + 2.5 * s, marks };
  };

  // mark: anemone bloom — stem (parcel-stem v1) + shadow petals (v1) + lit petals (v0) + core (v2).
  const flower = (x: number, y: number): FloraMarkGroup | null => {
    if (distressed) return null;
    const stemH = 3.4 + rand() * 1.4;
    const top = y - stemH;
    const marks: SceneNode[] = [];
    marks.push(path(`M${f(x)} ${f(y)} Q${f(x + 0.4)} ${f(y - stemH * 0.6)} ${f(x)} ${f(top)}`, { kind: 'parcel-stem', variant: 1, strokeWidth: 0.6 }));
    const petals = 5;
    for (let pass = 0; pass < 2; pass++) {
      const ox = pass === 0 ? 0.5 : -0.15;
      const oy = pass === 0 ? 0.4 : -0.2;
      const variant = pass === 0 ? 1 : 0;
      for (let pt = 0; pt < petals; pt++) {
        const ang = (pt / petals) * Math.PI * 2 + rand() * 0.2;
        const px = x + ox + Math.cos(ang) * 1.5;
        const py = top + oy + Math.sin(ang) * 1.5;
        marks.push(circle(px, py, 1.0, { kind: 'parcel-flower', variant }));
      }
    }
    marks.push(circle(x, top, 0.75, { kind: 'parcel-flower', variant: 2 }));
    return { y, marks };
  };

  // mark: sapling — trunk (parcel-stem v2) + crown facet pair on its OWN variants (dark v3 / light v2).
  const sapling = (x: number, y: number): FloraMarkGroup => {
    const s = 0.8 + rand() * 0.3;
    if (distressed) {
      const marks: SceneNode[] = [];
      marks.push(
        path(
          `M${f(x)} ${f(y)} L${f(x)} ${f(y - 9 * s)} M${f(x)} ${f(y - 4.5 * s)} L${f(x - 3.2 * s)} ${f(y - 8 * s)} M${f(x)} ${f(y - 6 * s)} L${f(x + 2.8 * s)} ${f(y - 9.5 * s)}`,
          { kind: 'parcel-stem', variant: 0, strokeWidth: 1.1 },
        ),
      );
      marks.push(fleck(x - 3.2 * s, y - 8.4 * s), fleck(x + 2.8 * s, y - 10 * s), fleck(x + 0.4 * s, y - 9.6 * s));
      return { y, marks };
    }
    const r = 4.4 * s;
    const trunkH = 4.4 * s;
    const cy0 = y - trunkH - r * 0.8;
    const marks: SceneNode[] = [];
    marks.push(path(`M${f(x)} ${f(y)} L${f(x)} ${f(y - trunkH - 1)}`, { kind: 'parcel-stem', variant: 2, strokeWidth: 1.4 }));
    marks.push(circle(x, cy0, r, { kind: 'parcel-shrub', variant: 3 }));
    marks.push(circle(x - r * 0.3, cy0 - r * 0.3, r * 0.75, { kind: 'parcel-shrub', variant: 2 }));
    return { y, marks };
  };

  // density: three tiers always present past 0, saplings a bonus top layer. The anemone bloom tier is
  // RETIRED under the unified vegetation vocabulary (ADR-0226 decision 2: a flower means UAT, not
  // decoration); ferns + shrubs stay as the understory bulk.
  const nFerns = tests <= 0 ? 1 : Math.min(cells.length, 2 + Math.round(tests * 0.85));
  const nShrubs = tests <= 0 ? 0 : Math.max(1, Math.round(tests * 0.45));
  const nFlowers = unifiedVeg ? 0 : tests < 2 ? 0 : Math.max(1, Math.round(tests * 0.32));
  const nSaplings = Math.floor(tests / 4);

  for (let i = 0; i < nFerns; i++) {
    const p = spot();
    const m = fern(p.x, p.y);
    flora.push(item(m.y, m.marks, p));
  }
  for (let i = 0; i < nShrubs; i++) {
    const p = spot();
    const m = shrub(p.x, p.y);
    flora.push(item(m.y, m.marks, p));
  }
  for (let i = 0; i < nFlowers; i++) {
    const p = spot();
    const m = flower(p.x, p.y);
    if (m) flora.push(item(m.y, m.marks, p));
  }
  for (let i = 0; i < nSaplings; i++) {
    const p = spot();
    const m = sapling(p.x, p.y);
    flora.push(item(m.y, m.marks, p));
  }
  return { ground, flora };
}

/** The per-status heath config (heath.js `heathStatusConfig`, colour-stripped) — the density/opacity
 *  knobs + whether each tier fires. Bell palette SIZES drive the healthy 2-colour bell rotation. */
interface HeathConf {
  scale: number;
  opacity: number;
  twiggy: boolean;
  spark: boolean;
  flowerBoost: number;
  altShrubChance: number;
  bloomChance: number;
  bellLight: number;
  bellDark: number;
}
function heathConf(status: SceneStatus): HeathConf {
  switch (status) {
    case 'healthy':
      return { scale: 1.0, opacity: 1, twiggy: false, spark: false, flowerBoost: 1, altShrubChance: 0.35, bloomChance: 0.4, bellLight: 2, bellDark: 2 };
    case 'mapped':
      return { scale: 0.82, opacity: 0.72, twiggy: false, spark: false, flowerBoost: 0.3, altShrubChance: 0, bloomChance: 0.05, bellLight: 1, bellDark: 1 };
    case 'proposed':
      return { scale: 0.8, opacity: 0.78, twiggy: false, spark: false, flowerBoost: 0.4, altShrubChance: 0, bloomChance: 0.1, bellLight: 1, bellDark: 1 };
    case 'building':
      return { scale: 0.96, opacity: 1, twiggy: false, spark: true, flowerBoost: 0.85, altShrubChance: 0, bloomChance: 0.3, bellLight: 1, bellDark: 1 };
    case 'unhealthy':
      return { scale: 0.92, opacity: 0.92, twiggy: true, spark: false, flowerBoost: 0.2, altShrubChance: 0, bloomChance: 0, bellLight: 1, bellDark: 1 };
    case 'unknown':
    default:
      return { scale: 0.68, opacity: 0.6, twiggy: false, spark: false, flowerBoost: 0, altShrubChance: 0, bloomChance: 0, bellLight: 0, bellDark: 0 };
  }
}

/** HEATH (heath.js) — quilted moor turf grows wiry grass tufts (bulk), heather/gorse scrub mounds (the
 *  density driver, two-face domes with a healthy gorse-olive alt lobe), and heather-bell racemes;
 *  distressed statuses go to bare twigs. tests drives every tier, status only recolours/mutes (a group
 *  opacity carries the mute). grass → `parcel-blade` (STROKED); mound → `parcel-shrub` (body v1 / hi v0,
 *  gorse alt v3/v2); bell/spark/fleck → `parcel-flower`; raceme-stem/twig → `parcel-stem`. */
function heathSurface(
  cells: ParcelCell[],
  status: SceneStatus,
  tests: number,
  rand: () => number,
  unifiedVeg = false,
  art: TileArt = SHIPPED_TILE_ART,
): ParcelSurface {
  const ground = parcelGround(cells, status, rand);
  const flora: ParcelFloraMark[] = [];
  const conf = heathConf(status);
  if (!cells.length) return { ground, flora };

  // The heather-BELLS (on the mounds + as racemes) are RETIRED under the unified vegetation vocabulary
  // (ADR-0226 decision 2: a flower means UAT, not decoration); the heather MOUNDS stay as the density
  // bulk. `bloomChance` gates the bells-on-mound tier, `flowerClusters` (below) the raceme tier — both
  // fall to zero under the flag. Absent/false ⇒ today's heath byte-for-byte.
  const bloomChance = unifiedVeg ? 0 : conf.bloomChance;

  const item = (y: number, marks: SceneNode[], pivot: Pt): ParcelFloraMark =>
    parcelFloraItem('heath', status, y, marks, pivot, art, conf.opacity < 1 ? conf.opacity : undefined);
  // bell face variants: light index 0/1 → v0/v4, dark index 0/1 → v1/v5 (the healthy 2-colour rotation).
  const bellLightV = (idx: number): number => (idx === 1 ? 4 : 0);
  const bellDarkV = (idx: number): number => (idx === 1 ? 5 : 1);

  // one clean two-face domed lobe: a body-tone mound + an offset highlight cap.
  const mound = (cx: number, cy: number, s: number, bodyV: number, hiV: number): SceneNode[] => [
    ellipse(cx, cy, 3.3 * s, 2.7 * s, { kind: 'parcel-shrub', variant: bodyV }),
    ellipse(cx - 1.15 * s, cy - 1.05 * s, 1.85 * s, 1.5 * s, { kind: 'parcel-shrub', variant: hiV }),
  ];
  // a couple of small bells sitting on a mound's crown (bloom-in-flower).
  const bloomOnMound = (cx: number, cy: number, s: number): SceneNode[] => {
    if (!conf.bellLight) return [];
    const out: SceneNode[] = [];
    const n = 1 + Math.floor(rand() * 2);
    for (let bi = 0; bi < n; bi++) {
      const bx = cx + (rand() * 2 - 1) * 1.8 * s;
      const by = cy - 2.1 * s - rand() * 0.8 * s;
      const dv = bellDarkV(Math.floor(rand() * conf.bellDark));
      const lv = bellLightV(Math.floor(rand() * conf.bellLight));
      out.push(ellipse(bx, by, 0.75 * s, 1.0 * s, { kind: 'parcel-flower', variant: dv }));
      out.push(ellipse(bx - 0.3 * s, by - 0.25 * s, 0.55 * s, 0.75 * s, { kind: 'parcel-flower', variant: lv }));
    }
    return out;
  };

  // tier 1: long wiry moor-grass tufts (stroked blades, grassA dark v1 / grassB light v0 alternating).
  const grassTuft = (x: number, y: number): FloraMarkGroup => {
    const s = conf.scale * (0.85 + rand() * 0.35);
    const n = 3 + Math.floor(rand() * 3);
    const marks: SceneNode[] = [];
    for (let i = 0; i < n; i++) {
      const dx = (i - (n - 1) / 2) * 1.15 * s;
      const h = (3.2 + rand() * 2.6) * s;
      const bend = dx * 1.1 + (rand() * 1.4 - 0.7) * s;
      const variant = i % 2 === 0 ? 1 : 0;
      marks.push(
        path(
          `M${f(x + dx)} ${f(y)} Q${f(x + dx + bend * 0.5)} ${f(y - h * 0.62)} ${f(x + dx + bend)} ${f(y - h)}`,
          { kind: 'parcel-blade', variant, strokeWidth: 0.7 * s },
        ),
      );
    }
    return { y, marks };
  };

  // tier 2: heather/gorse scrub mounds (density driver). A hero is a clump (companion + main mound);
  // distressed goes to bare wiry twigs + dead flecks.
  const shrub = (x: number, y: number, hero: boolean): FloraMarkGroup => {
    const s = conf.scale * (hero ? 1.05 + rand() * 0.25 : 0.75 + rand() * 0.28);
    const useAlt = conf.altShrubChance > 0 && rand() < conf.altShrubChance;
    const bodyV = useAlt ? 3 : 1;
    const hiV = useAlt ? 2 : 0;
    const marks: SceneNode[] = [];

    if (conf.twiggy) {
      const tn = 3 + Math.floor(rand() * 2);
      for (let w = 0; w < tn; w++) {
        const wx = x + (w - (tn - 1) / 2) * 2.1 * s + (rand() * 1.4 - 0.7);
        const wh = (3.4 + rand() * 2.0) * s;
        const lean = (w - (tn - 1) / 2) * 1.3 + (rand() - 0.5);
        marks.push(
          path(`M${f(wx)} ${f(y + 1.0 * s)} q${f(lean)} ${f(-wh * 0.6)} ${f(lean * 1.7)} ${f(-wh)}`, {
            kind: 'parcel-stem',
            variant: 0,
            strokeWidth: 0.55 * s,
          }),
        );
      }
      const fn = 2 + Math.floor(rand() * 2);
      for (let d = 0; d < fn; d++) {
        marks.push(circle(x + (rand() * 2 - 1) * 3.4 * s, y - rand() * 3.4 * s, 0.6 * s, { kind: 'parcel-flower', variant: 0 }));
      }
      return { y: y + 2.7 * s, marks };
    }

    if (hero) {
      const side = rand() < 0.5 ? -1 : 1;
      const altCompanion = conf.altShrubChance > 0 && rand() < 0.6;
      const cBodyV = altCompanion ? 3 : bodyV;
      const cHiV = altCompanion ? 2 : hiV;
      marks.push(...mound(x + side * 3.1 * s, y + 0.75 * s, s * 0.6, cBodyV, cHiV));
    }
    marks.push(...mound(x, y, s, bodyV, hiV));

    if (bloomChance && rand() < bloomChance) {
      marks.push(...bloomOnMound(x, y, s));
    }
    if (conf.spark) {
      const sk = 1 + Math.floor(rand() * 2);
      for (let k = 0; k < sk; k++) {
        marks.push(circle(x + (rand() * 2 - 1) * 2.6 * s, y - 1.4 * s - rand() * 1.6 * s, 0.5 * s, { kind: 'parcel-flower', variant: 6 }));
      }
    }
    return { y: y + 3.0 * s, marks };
  };

  // tier 3: heather-bell raceme — a stem (parcel-stem v0) up which bells (dark back v1/v5, light face
  // v0/v4, tiny core v2) climb.
  const bellCluster = (x: number, y: number): FloraMarkGroup => {
    if (!conf.bellLight) return { y, marks: [] };
    const s = conf.scale * (1.0 + rand() * 0.3);
    const n = 3 + Math.floor(rand() * 3);
    const topY = y - (2.4 + n * 1.15) * s;
    const marks: SceneNode[] = [];
    marks.push(
      path(`M${f(x)} ${f(y)} Q${f(x + 0.5 * s)} ${f((y + topY) / 2)} ${f(x + 0.3 * s)} ${f(topY)}`, {
        kind: 'parcel-stem',
        variant: 0,
        strokeWidth: 0.65 * s,
      }),
    );
    for (let i = 0; i < n; i++) {
      const bx = x + 0.3 * s + (i % 2 === 0 ? -1 : 1) * 1.0 * s;
      const by = y - (2.0 + i * 1.15) * s;
      const dv = bellDarkV(Math.floor(rand() * conf.bellDark));
      const lv = bellLightV(Math.floor(rand() * conf.bellLight));
      marks.push(ellipse(bx, by, 1.0 * s, 1.35 * s, { kind: 'parcel-flower', variant: dv }));
      marks.push(ellipse(bx - 0.35 * s, by - 0.3 * s, 0.75 * s, 1.02 * s, { kind: 'parcel-flower', variant: lv }));
      marks.push(circle(bx - 0.3 * s, by + 0.55 * s, 0.32 * s, { kind: 'parcel-flower', variant: 2 }));
    }
    return { y, marks };
  };

  // the drift beds: the whole budget plants inside them (the all-cells spread retired).
  const next = driftSpot(cells, tests, rand, art);

  // density budget: tests drives every tier, status only recolours/mutes.
  const t = Math.max(0, tests | 0);
  const grassCount = cells.length ? Math.min(cells.length, t === 0 ? 4 : 4 + Math.round(t * 1.3)) : 0;
  const shrubCount = Math.round(t * 0.75);
  const flowerClusters = unifiedVeg ? 0 : t < 2 ? 0 : Math.round((t - 1) * 0.3 * conf.flowerBoost);

  for (let i = 0; i < grassCount; i++) {
    const p = next();
    const m = grassTuft(p.x, p.y);
    flora.push(item(m.y, m.marks, p));
  }
  for (let i = 0; i < shrubCount; i++) {
    const p = next();
    const m = shrub(p.x, p.y, i < 2);
    flora.push(item(m.y, m.marks, p));
  }
  for (let i = 0; i < flowerClusters; i++) {
    const p = next();
    const m = bellCluster(p.x, p.y);
    flora.push(item(m.y, m.marks, p));
  }
  return { ground, flora };
}

/** THE SURFACE REGISTRY (ADR-0208) — the splice point: theme → its `SurfaceFn`. These are the
 *  designer-authored surfaces (meadow / woodland / heath), spliced over the initial in-repo ports
 *  behind the frozen seam (the `SurfaceFn` shape + the kinds vocabulary are frozen; the craft is not). */
export const SURFACES = {
  meadow: meadowSurface,
  woodland: woodlandSurface,
  heath: heathSurface,
} as const satisfies Record<SurfaceTheme, SurfaceFn>;

// --- Voronoi assignment + the once-computed per-territory surface ---

function cellCentroid(poly: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of poly) {
    x += p.x;
    y += p.y;
  }
  const n = poly.length || 1;
  return { x: x / n, y: y / n };
}

/** The equal-weight VORONOI assignment: a cell → the nearest parcel seed (ties → lowest index). */
function nearestParcel(centroid: Pt, seeds: readonly Pt[]): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < seeds.length; i++) {
    const s = seeds[i]!;
    const d = (centroid.x - s.x) ** 2 + (centroid.y - s.y) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Tinted ground cells plus placed flora — the shape BOTH surface layers speak in.
 *
 *  {@link SurfaceFn} returns it for ONE parcel; {@link buildTerritorySurface} returns it for a whole
 *  island, having merged its parcels' contributions. One interface for both because the shape was
 *  always identical and was written out twice: the seam's own type spelled it inline, and each of
 *  the three theme surfaces repeated the annotation. `anti-slop/no-known-value-widening` reads a
 *  repeated anonymous return annotation as discarded type evidence; naming it changes nothing about
 *  the frozen ADR-0208 contract, whose SHAPE is what is frozen. */
export interface ParcelSurface {
  ground: SceneNode[];
  flora: ParcelFloraMark[];
}
/** One parcels-present island's full surface, computed ONCE (buildScene threads the `ground` to
 *  `buildGround` and the `flora` to `buildTerritoryFlora`). Each parcel's ground cells are wrapped in
 *  a transparent `parcel` group carrying the capId (the hover/delegation hook). Returns null when the
 *  island has no parcels or no substrate cells (the feature needs the relaxed mesh), so every caller
 *  falls back to today's render. */
function buildTerritorySurface(
  t: SceneTerritoryInput,
  ownerCells: RelaxedCell[],
  unifiedVeg = false,
  art: TileArt = SHIPPED_TILE_ART,
): ParcelSurface | null {
  const parcels = t.parcels;
  if (!parcels || !parcels.length || !ownerCells.length) return null;
  const seeds = parcels.map((p) => p.seed);
  const groups: ParcelCell[][] = parcels.map(() => []);
  for (const c of ownerCells) {
    const cen = cellCentroid(c.poly);
    const idx = nearestParcel(cen, seeds);
    groups[idx]!.push({ poly: c.poly, cx: cen.x, cy: cen.y });
  }
  // ⚠ NO CAPABILITY STARVES (ADR-0528). An island is drawn on ONE hex per capability now, so two
  // capability seeds can share a hex and the Voronoi above can hand every cell of that hex to one of
  // them — the other has no ground, no colour, and in 3D no tree (measured on the tile ladder: one
  // rung stood 202 trees against the control's 203). A parcel that would starve takes the cell
  // nearest its seed from whichever parcel holds two or more, in parcel order, so the repair is
  // deterministic and reaches only the islands where a parcel actually starved; every other
  // partition is byte-for-byte what the Voronoi gave it. It cannot run dry while there are at least
  // as many cells as parcels, which the mesh guarantees (several cells per hex).
  /** The cell nearest `seed` in any group that can SPARE one (holds two or more), as the group it
   *  sits in and its index there — or null when no group can spare a cell, which is the only way the
   *  repair declines. Returning the pair rather than filling two pre-seeded locals is deliberate: a
   *  sentinel initialiser is dead by construction here (both locals are written together, and the
   *  guard that reads them tests the sentinel), so it can be neither exercised nor observed. */
  const nearestSpare = (seed: Pt): { from: number; at: number } | null => {
    let found: { from: number; at: number } | null = null;
    let bd = Infinity;
    groups.forEach((cells, j) => {
      if (cells.length < 2) return;
      cells.forEach((cell, k) => {
        const d = (cell.cx - seed.x) ** 2 + (cell.cy - seed.y) ** 2;
        // Stryker disable next-line EqualityOperator: EQUIVALENT — `<=` differs only when two cells
        // sit at exactly the same distance from the seed, and the mesh never places two centroids there.
        if (d < bd) {
          bd = d;
          found = { from: j, at: k };
        }
      });
    });
    return found;
  };
  parcels.forEach((_parcel, i) => {
    if (groups[i]!.length > 0) return;
    const spare = nearestSpare(seeds[i]!);
    if (!spare) return;
    groups[i]!.push(groups[spare.from]!.splice(spare.at, 1)[0]!);
  });
  const ground: SceneNode[] = [];
  const flora: ParcelFloraMark[] = [];
  parcels.forEach((parcel, i) => {
    const cells = groups[i]!;
    if (!cells.length) return;
    const rand = streamRand(`parcel:${t.id}:${parcel.capId}`);
    // An unreported count still owns and tints its ground, but is not coverage data we may render.
    // Surface painters need a numeric density to construct that ground, so use zero solely for their
    // ground pass and suppress their flora output below.
    const out = SURFACES[parcel.theme](cells, parcel.status, parcel.testCount ?? 0, rand, unifiedVeg, art);
    ground.push(
      g(out.ground, { kind: 'parcel', id: parcel.capId, status: parcel.status, title: parcel.capId }),
    );
    // Stamp each flora item with its capId (the SurfaceFn is capId-agnostic, so attribution — the
    // hover-flora → capability hook — is added here, where the parcel identity is known).
    for (const fm of (parcel.testCount ?? 0) > 0 ? out.flora : []) {
      fm.node.id = parcel.capId;
      flora.push(fm);
    }
  });
  return { ground, flora };
}

// ---------------------------------------------------------------------------
// the cosy-island GARDEN — hero placement + the re-lit ADR-0218 baked-art seam (grounded-art inc 11)
// ---------------------------------------------------------------------------

/** The scene-graph def id a garden hero's `baked-use` references (ADR-0218 define-once). */
const gardenDefId = (id: GardenHeroId): string => `garden-hero-${id}`;

/** The heroes the garden emits a `baked-def` for (define-once) — kept in sync with what
 *  `buildGardenArt` places, so no def is an orphan `<use>`-less `<defs>` entry. `stepping-stone` is
 *  the garden PATH (unit 2 — one def, N cheap `<use>` stones threading the heroes to the landfall). */
const GARDEN_DEFINED_HEROES: GardenHeroId[] = ['autumn-tree', 'cottage', 'gazebo', 'stepping-stone'];

/** A hero's on-island target HEIGHT in map units, as a multiple of the island's crown radius so it
 *  scales with the story like the procedural tree it stands beside. Tuned against the concept render. */
const GARDEN_HERO_TARGET = {
  'autumn-tree': 2.6, // the central tree — matches the ~2.65·R procedural tree it replaces (ADR-0221)
  cottage: 1.7,
  gazebo: 1.5,
  'stepping-stone': 0.28, // small flat path stones — enough of them read as a path, not a few slabs
} as const satisfies Record<GardenHeroId, number>;

/** The island-size FIT bound (grounded-art inc 11 unit 2 — the owner's "buildings dont fully land within
 *  the island" fix). `crownRadius` saturates at 32 regardless of tile quota, so on a SMALL island the
 *  crown-scaled hero footprint spills past the shore. These caps hold a hero's scaled footprint inside
 *  the island: the scaled base HALF-WIDTH stays within `HALF·radius`, and the scaled HEIGHT within
 *  `HEIGHT·radius` so a hero never towers off a tiny island. On a big island (studio) the caps are slack
 *  and the crown-based target wins — the concept proportions are preserved where there is room. */
const GARDEN_FIT_HALF_FRAC = 0.42; // scaled base half-width ≤ 0.42·radius (full width ≤ 0.84·radius)
const GARDEN_FIT_HEIGHT_FRAC = 1.25; // scaled height ≤ 1.25·radius (a standing object may rise a little above)

/** The lawn gap a free garden hero's PLACEMENT POINT keeps beyond the fitted tree canopy, as a fraction of
 *  the tree's fitted footprint half-width (grounded-art inc 12 — the small-island collision fix). It sets
 *  the canopy keep-out `treeHalfW·(1+GAP)` ({@link treeKeepOut}): the anti-merge bound that keeps a building
 *  from sitting inside the trunk. See {@link placeGardenHeroes} for how the sampler layers the historical
 *  `radius·0.5` spread on top of it while the fallback uses only this canopy bound (which is what leaves the
 *  attested studio composition unchanged). */
const GARDEN_TREE_GAP = 0.15;

/** The fitted scale for one hero on island `t`: the crown-based target height, CAPPED so the scaled
 *  footprint (base half-width and height) stays inside the island (see the FIT constants). Independent
 *  of the placement point, so a caller can derive the footprint half-width before it places the hero. */
export function fittedHeroScale(id: GardenHeroId, hero: SceneGardenHero, t: SceneTerritoryInput, art: TileArt = SHIPPED_TILE_ART): number {
  const sTarget = (crownRadius(t.caps) * art.tree * GARDEN_HERO_TARGET[id]) / hero.height;
  // A SIZE cap, not a ground displacement: `s` scales the hero's local def units directly into a
  // screen `scale()` transform with no further camera projection, so the bound it must stay inside
  // is how big the fitted footprint reads ON SCREEN — `screenRadius`, matching what is actually drawn
  // (`scene-territory-radius-states-its-space`).
  const sCapW = (2 * GARDEN_FIT_HALF_FRAC * t.screenRadius) / hero.width;
  const sCapH = (GARDEN_FIT_HEIGHT_FRAC * t.screenRadius) / hero.height;
  return Math.min(sTarget, sCapW, sCapH);
}

/** The tree CANOPY keep-out (grounded-art inc 12): how far a free hero's placement point must sit from the
 *  tree spot so its base clears the fitted canopy + a small lawn gap — i.e. so it never merges into the
 *  trunk. Radius-independent: it scales with the tree's ACTUAL fitted footprint, so a small island (where
 *  the fitted tree fills the island) pushes buildings out just as a large one does. The sampler additionally
 *  keeps its historical `radius·0.5` spread (`max(radius·0.5, …)`), so on a big island heroes still spread
 *  wide; the FALLBACK uses only THIS canopy keep-out — lenient enough to leave the attested studio spot
 *  (a fallback pick nestled just inside `radius·0.5` but well clear of the canopy) exactly where it is,
 *  while still evicting a building that merged into the trunk on a small island. Exported for the unit test. */
export function treeKeepOut(treeFitHalfW: number): number {
  return treeFitHalfW * (1 + GARDEN_TREE_GAP);
}

/** Place ONE garden hero as a paint-free `baked-use` of its def at scale `s`, translated to (x, y): the
 *  hero's base sits at (x, y) and the solid rises in −y (the bake is centred on x=0, standing on y=0 —
 *  no flip). Kind `baked-art` is the existing ADR-0218 placement kind — the studio/website mappers
 *  already render it; R3F already skips it. `s` is the {@link fittedHeroScale} the caller computed. */
function gardenHeroUse(
  id: GardenHeroId,
  x: number,
  y: number,
  s: number,
  nodeId?: string,
): SceneBakedUse {
  return {
    el: 'baked-use',
    defId: gardenDefId(id),
    kind: 'baked-art',
    id: nodeId ?? `garden-${id}`,
    transform: `translate(${f(x)} ${f(y)}) scale(${f(s)})`,
  };
}

/** Deterministically place the free-standing garden heroes (cottage, gazebo) around the island — the
 *  same id-seeded rejection sampling the UAT-flower scatter uses: keep-outs for the tree, the nameplate
 *  band and spacing from each other, and a keep-IN to the island's land cells (no hero in the water).
 *  Same input ⇒ the same spots; exhausting the draws snaps to the nearest free land-cell centroid.
 *
 *  `treeFitHalfW` is the FITTED half-width of the central autumn-tree hero (grounded-art inc 12): the tree
 *  keep-out scales to the tree's actual fitted footprint (via {@link treeKeepOut}), so on a small island —
 *  where the fitted tree fills the island — a building no longer merges into the trunk. The fallback branch
 *  now honours that canopy keep-out too (it used to drop it entirely, which is how the exhausted-draws snap
 *  landed a gazebo on the trunk). Exported for the placement unit test.
 *
 *  THE KEEP-OUTS ARE GROUND DISTANCES (ADR-0367 D1), for the same reason the UAT scatter's are: the
 *  tree well and the hero-to-hero spread both ask "how far apart on the ground", so they read
 *  `t.groundRadius` (`scene-territory-radius-states-its-space`). `footprintOnLand` needs NO camera
 *  term — it spans the base HORIZONTALLY (`x ± hw`
 *  at one y) and the q axis does not foreshorten, so the three probes it casts are already the right
 *  three points. That is why this site moved its heroes without ever losing one. */
export function placeGardenHeroes(
  t: SceneTerritoryInput,
  ids: GardenHeroId[],
  halfW: Map<GardenHeroId, number>,
  land: RelaxedCell[] | null,
  treeFitHalfW: number,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
  art: TileArt = SHIPPED_TILE_ART,
): Map<GardenHeroId, Pt> {
  const onLand = (x: number, y: number): boolean =>
    !land || land.some((c) => pointInPoly(x, y, c.poly));
  // The WHOLE base footprint on land, not just the base point (grounded-art inc 11 unit 2 — the owner's
  // "buildings dont fully land within the island" fix). The base spans [x−hw, x+hw] at y, so both ends
  // AND the midpoint must sit on owned land before a spot is accepted. A HORIZONTAL span: the camera
  // foreshortens the r axis, never the q axis, so this needs no projection term.
  const footprintOnLand = (x: number, y: number, hw: number): boolean =>
    onLand(x, y) && onLand(x - hw, y) && onLand(x + hw, y);
  // The tree keep-outs (grounded-art inc 12). The CANOPY keep-out scales to the fitted tree footprint
  // ({@link treeKeepOut}): a placement point outside it clears the canopy + a small lawn gap, so a building
  // never merges into the trunk — even on a small island where the fitted tree fills the island. The
  // SAMPLER additionally keeps the historical `radius·0.5` spread (the `max`), so a big island still
  // spreads its heroes wide, byte-for-byte as before. The FALLBACK uses ONLY the canopy keep-out — the true
  // anti-merge bound, lenient enough to LEAVE a nestled-but-clear studio fallback spot exactly where the
  // owner attested it (inside `radius·0.5` yet well clear of the canopy), while still evicting a building
  // that snapped onto the trunk. Independent of which hero — it is the tree's footprint, not the pair's,
  // that must not be sat inside (a building may still nestle under the canopy EDGE, matching the concept).
  const canopyKeepOut = treeKeepOut(treeFitHalfW);
  const samplerKeepOut = Math.max(t.groundRadius * 0.5, canopyKeepOut);
  const dTree = (x: number, y: number): number => groundGap({ x, y }, t.treeSpot, elevationDeg);
  const clearsCanopy = (x: number, y: number): boolean => dTree(x, y) > canopyKeepOut;
  const clearsTreeSampler = (x: number, y: number): boolean => dTree(x, y) > samplerKeepOut;
  const placed: Pt[] = [];
  const out = new Map<GardenHeroId, Pt>();
  for (const id of ids) {
    const hw = halfW.get(id) ?? 0;
    const k = hash(`${t.id}:garden:${id}`);
    let x = t.centroid.x;
    let y = t.centroid.y;
    let settled = false;
    // Placed nearer the interior than the marker scatter (0.28–0.62·R vs 0.42–0.82) so a fitted
    // footprint clears the shore; the footprint check is the hard guarantee, this just seeds it well.
    for (let attempt = 0; attempt < 48; attempt++) {
      const ang = rand01(k + attempt * 2) * Math.PI * 2;
      const rr = (0.28 + rand01(k + attempt * 2 + 1) * 0.34) * t.groundRadius;
      const off = groundPolarOffset(ang, rr, elevationDeg); // a GROUND disc, projected
      x = t.centroid.x + off.x;
      y = t.centroid.y + off.y;
      // A GROUND clearance against a ground-anchored plate baseline — the same correction the marker
      // scatter takes, and for the same reason (ADR-0545): this is where a hero STANDS, not what is
      // drawn over what. One line for the reason its sibling above gives.
      // Stryker disable next-line EqualityOperator: EQUIVALENT — continuous y, no authorable tie.
      const clearsPlate = y < t.labelY - groundRadiusToScreenHalfHeight(art.units(18), elevationDeg);
      const clearsOthers = placed.every((p) => groundGap({ x, y }, p, elevationDeg) > t.groundRadius * 0.55);
      if (clearsTreeSampler(x, y) && clearsPlate && clearsOthers && footprintOnLand(x, y, hw)) {
        settled = true;
        break;
      }
    }
    if (!settled && land) {
      // Snap to the land-cell centroid that clears the CANOPY and the others and whose whole footprint
      // fits; then relax the footprint, then the canopy, then the others (a tiny island can't always do
      // better). The canopy keep-out is honoured FIRST here — dropping it entirely is what let the
      // exhausted-draws snap land a building on the trunk (grounded-art inc 12).
      const spots = land
        .map((cell) => cellCentroid(cell.poly))
        .sort(
          (a, b) =>
            groundGap(a, { x, y }, elevationDeg) - groundGap(b, { x, y }, elevationDeg),
        );
      const clearsPlaced = (p: Pt): boolean =>
        placed.every((q) => groundGap(p, q, elevationDeg) > t.groundRadius * 0.5);
      const free =
        spots.find((p) => clearsCanopy(p.x, p.y) && clearsPlaced(p) && footprintOnLand(p.x, p.y, hw)) ??
        spots.find((p) => clearsCanopy(p.x, p.y) && clearsPlaced(p)) ??
        spots.find(clearsPlaced) ??
        spots[0]!;
      x = free.x;
      y = free.y;
    }
    placed.push({ x, y });
    out.set(id, { x, y });
  }
  return out;
}

/** The island's downward-shore LANDFALL (grounded-art inc 11 unit 2) — where the garden's stone path
 *  docks so it reads continuous with the inter-island trail. The concept's path exits at the island's
 *  bottom (toward the nameplate, the direction trails leave). March DOWN from the centroid and keep the
 *  furthest point still on owned land, so the dock sits on the shore, not in the water.
 *
 *  THE MARCH IS IN GROUND UNITS (ADR-0367 D1), projected per step. Its RESULT never needed
 *  unprojecting — the projection is monotone in y, so the furthest on-land screen point down a
 *  vertical ray IS the furthest on-land ground point — but the STEP needs a genuine ground radius
 *  (`t.groundRadius`, `scene-territory-radius-states-its-space`): stepping `d ·` the SCREEN-projected
 *  magnitude instead walked a fraction of the intended ground distance per step, so the whole
 *  0.2–1.05 sweep could stop well short of the shore it was written to reach. Stepping on the ground
 *  and projecting each probe keeps one resolution at every elevation. */
function islandLandfall(
  t: SceneTerritoryInput,
  land: RelaxedCell[] | null,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): Pt {
  const onLand = (x: number, y: number): boolean =>
    !land || land.some((c) => pointInPoly(x, y, c.poly));
  const down = (d: number): Pt => ({
    x: t.centroid.x,
    y: t.centroid.y + projectGround({ x: 0, y: d * t.groundRadius }, elevationDeg).y,
  });
  let best: Pt = down(0.2);
  for (let d = 0.2; d <= 1.05; d += 0.05) {
    const p = down(d);
    if (onLand(p.x, p.y)) best = p;
  }
  return best;
}

interface StonePathOpts {
  /** stone-centre spacing multiplier — <1 lays a TIGHTER, more continuous walkway; >1 a sparser trail. */
  spacingMul?: number;
  /** seeded-meander multiplier — 0 is a straight, deliberate walk; 1 is the loose garden wander. */
  wobbleMul?: number;
  /** an occlusion keep-out (the tree crown): a stone that would be HIDDEN behind the canopy is DROPPED, so
   *  no stone is buried under the tree (grounded-art inc 12 — the owner's footpath ask). Only stones NORTH
   *  of the tree base (smaller y) and within `r` are hidden — the y-sort paints the tree over them; a stone
   *  SOUTH of the base draws in FRONT of the tree, so it is always kept (it reads on the lawn, not buried). */
  skipNear?: { c: Pt; r: number };
  /** id-namespace so two paths' stones don't collide (`garden-<tag>-<leg>-<i>`). */
  tag: string;
  /** The camera the waypoints are projected at — the walk is laid on the GROUND and projected through
   *  it (ADR-0367 D1). Defaults to the declared land camera. */
  elevationDeg?: number;
  /** The tile the island is drawn on (ADR-0528). */
  art?: TileArt;
}

/** The deterministic stepping-stone garden PATH (grounded-art inc 11 unit 2, footpath refined inc 12) — a
 *  seeded walk of small `stepping-stone` `baked-use`s threading the `waypoints`, one cheap `<use>` per stone
 *  off the ONE shared def. Purely ADDITIVE: `buildTrails` and the segment/casing system are untouched — these
 *  stones are garden art on the island, not trail segments. Seeded jitter gives a natural meander (never
 *  `Math.random`). Each stone is y-sorted so it interleaves in depth. `opts` tunes density / meander per
 *  path and drops any stone buried under the tree crown (the `skipNear` occlusion filter).
 *
 *  THE WALK IS LAID ON THE GROUND AND PROJECTED (ADR-0367 D1) — this is the site that was LOSING
 *  STONES, not merely moving them. `spacing` is a ground distance (a fraction of `t.groundRadius`,
 *  floored by the stone's own footprint width), but the leg it was divided into was measured in
 *  SCREEN pixels; a mostly north–south leg projects to ~34% of its ground length at the declared
 *  camera, so `round(usable / spacing)` returned roughly a third of the stones and the front-door
 *  walk thinned out to a few slabs. Unprojecting the waypoints, walking in ground units and projecting
 *  each stone makes the stone COUNT a property of the island rather than of the camera, and lays them
 *  at even GROUND spacing — which is what reads as a path in perspective.
 *
 *  THE SPACING FLOOR HAD A SEPARATE, LATER DEFECT (`scene-territory-radius-states-its-space`): the
 *  waypoint-leg fix above landed while `t.radius` itself still carried the territory's SCREEN-
 *  projected magnitude, not a true ground radius, so `t.radius * 0.06` under-scaled the spacing floor
 *  by the same camera factor it had just eliminated from the leg length — stones laid measurably
 *  closer together than the intended ground spacing. Reading `t.groundRadius` here fixes it. */
function buildStonePath(
  t: SceneTerritoryInput,
  hero: SceneGardenHero,
  waypoints: Pt[],
  opts: StonePathOpts,
): Array<{ y: number; node: SceneNode }> {
  const elevationDeg = opts.elevationDeg ?? LAND_CAMERA_ELEVATION_DEG;
  const s = fittedHeroScale('stepping-stone', hero, t, opts.art);
  const stoneW = s * hero.width; // scaled footprint width (a ground x extent — no camera term)
  const spacingMul = opts.spacingMul ?? 1;
  const wobbleMul = opts.wobbleMul ?? 1;
  const spacing = Math.max(stoneW * 1.05, t.groundRadius * 0.06) * spacingMul; // stone-centre GROUND gap
  // The occlusion filter, split by what each half actually asks. The NORTH/SOUTH half is a
  // painter-order question — is the tree drawn over this stone — and y-sort order is a screen fact, so
  // it stays a screen comparison. The RADIUS half asks whether the stone sits inside the tree's
  // fitted footprint, and `skipNear.r` is that footprint's half-width (the same `treeFitHalfW` the
  // hero keep-out treats as a ground bound), so it is measured on the ground.
  const buried = (p: Pt): boolean =>
    !!opts.skipNear &&
    p.y < opts.skipNear.c.y &&
    groundGap(p, opts.skipNear.c, elevationDeg) < opts.skipNear.r;
  const out: Array<{ y: number; node: SceneNode }> = [];
  for (let leg = 0; leg + 1 < waypoints.length; leg++) {
    // Onto the ground plane the waypoints stand on, so every length below is a ground length.
    const a = unprojectGround(waypoints[leg]!, elevationDeg);
    const b = unprojectGround(waypoints[leg + 1]!, elevationDeg);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    // ground-space: `a`/`b` are the leg's waypoints unprojected two lines above, so the leg length
    // that meters the stone spacing is a ground length and does not shorten as the camera lowers.
    const len = Math.hypot(dx, dy);
    if (len < 1e-3) continue;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy; // unit perpendicular, for the seeded meander
    const py = ux;
    // Interior stones only — leave a margin at each waypoint so a stone doesn't sit under a hero base.
    const margin = Math.min(stoneW * 0.8, len * 0.2);
    const usable = len - 2 * margin;
    if (usable <= 0) continue;
    const n = Math.max(1, Math.round(usable / spacing));
    for (let i = 0; i <= n; i++) {
      const dist = margin + (usable * i) / n;
      const k = hash(`${t.id}:${opts.tag}:${leg}:${i}`);
      const wob = (rand01(k) - 0.5) * spacing * 0.35 * wobbleMul; // seeded meander
      const p = projectGround(
        { x: a.x + ux * dist + px * wob, y: a.y + uy * dist + py * wob },
        elevationDeg,
      );
      if (buried(p)) continue; // never bury a stone under the tree crown (occlusion)
      out.push({
        y: p.y,
        node: gardenHeroUse('stepping-stone', p.x, p.y, s, `garden-${opts.tag}-${leg}-${i}`),
      });
    }
  }
  return out;
}

/** A midpoint for a stone leg that BOWS around the tree crown instead of crossing it (grounded-art inc 12).
 *  If the straight leg's midpoint already clears the crown it is kept; otherwise it is pushed radially out
 *  from the tree spot to just past the crown, so the light secondary path skirts the tree rather than
 *  vanishing beneath it. Deterministic; a degenerate near-centre midpoint bows perpendicular to the leg.
 *
 *  Computed on the GROUND PLANE and projected back (ADR-0367 D1): `crownR` is the tree's fitted
 *  footprint half-width, so "just past the crown" is a ground displacement. Bowed in screen space the
 *  detour would push the midpoint ~3x too far north-south, which is how a leg meant to skirt the crown
 *  ends up leaving the island. The MIDPOINT itself needs no correction — an average commutes with the
 *  affine projection — but it is taken on the ground here anyway so the whole bow reads in one space. */
function detourAroundTree(
  a: Pt,
  b: Pt,
  tree: Pt,
  crownR: number,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
): Pt {
  const ag = unprojectGround(a, elevationDeg);
  const bg = unprojectGround(b, elevationDeg);
  const treeG = unprojectGround(tree, elevationDeg);
  const mid: Pt = { x: (ag.x + bg.x) / 2, y: (ag.y + bg.y) / 2 };
  const dx = mid.x - treeG.x;
  const dy = mid.y - treeG.y;
  // ground-space: `mid` and `treeG` are both on the ground plane, and `crownR` it is compared
  // against is the crown's ground footprint half-width — both sides of the test in one space.
  const d = Math.hypot(dx, dy);
  const want = crownR * 1.3; // clear the crown with a small lawn gap
  if (d >= want) return projectGround(mid, elevationDeg);
  if (d < 1e-3) {
    // midpoint sits on the trunk — bow perpendicular to the leg (deterministic side: +perp).
    const lx = bg.x - ag.x, ly = bg.y - ag.y;
    // ground-space: `ag`/`bg` are unprojected, and this length only normalises the leg direction to
    // a unit ground vector before `want` (a ground radius) scales it.
    const ll = Math.hypot(lx, ly) || 1;
    return projectGround(
      { x: treeG.x + (-ly / ll) * want, y: treeG.y + (lx / ll) * want },
      elevationDeg,
    );
  }
  return projectGround(
    { x: treeG.x + (dx / d) * want, y: treeG.y + (dy / d) * want },
    elevationDeg,
  );
}

/** Pull a point onto owned land: if it is already on land keep it; otherwise walk it back toward the
 *  island centroid until it lands (a garden accent never sits in the water).
 *
 *  DELIBERATELY CAMERA-FREE, and that is a result rather than an oversight (ADR-0367 D1). Every other
 *  placement here had to learn the camera because it measured an absolute distance; this one walks a
 *  RELATIVE fraction `tt` of the way from the centroid to the point, and a fraction along a segment
 *  commutes with the affine ground projection — `project(c + (p−c)·tt) = project(c) + (project(p) −
 *  project(c))·tt` — so the screen walk visits exactly the projections of the ground points the ground
 *  walk would have visited, and it lands on the same ground spot at every elevation. Adding an
 *  unprojection here would change nothing except the arithmetic. What DID need fixing is the point
 *  handed IN: the callers computed it with a screen-space offset, so `towardLand` was faithfully
 *  relocating the wrong point. `scatter-camera.test.ts` proves the commuting property rather than
 *  taking this comment's word for it. */
function towardLand(p: Pt, centroid: Pt, land: RelaxedCell[] | null): Pt {
  const onLand = (x: number, y: number): boolean => !land || land.some((c) => pointInPoly(x, y, c.poly));
  if (onLand(p.x, p.y)) return p;
  for (let tt = 0.7; tt >= 0; tt -= 0.15) {
    const q: Pt = { x: centroid.x + (p.x - centroid.x) * tt, y: centroid.y + (p.y - centroid.y) * tt };
    if (onLand(q.x, q.y)) return q;
  }
  return centroid;
}

/** A flat LAVENDER clump (grounded-art inc 11 unit 3) — a few upright stems each topped with a short
 *  bud spike, in the concept's dusty muted purple. Base at (0,0), growing UP in −y; seeded so no two
 *  clumps clone. Decorative (carries no verdict), in the attested flat tall-flower style (colour CSS-side). */
function lavenderMarks(k: number): SceneNode[] {
  const marks: SceneNode[] = [ellipse(0.3, 0.6, 6, 1.8, { kind: 'shadow' })];
  const stems = 4 + Math.floor(rand01(k) * 3);
  for (let i = 0; i < stems; i++) {
    const dx = (rand01(k + i * 5 + 1) - 0.5) * 11;
    const h = 13 + rand01(k + i * 5 + 2) * 8;
    const lean = (rand01(k + i * 5 + 3) - 0.5) * 4;
    const topX = dx + lean;
    marks.push(
      path(`M ${f(dx)} 0 C ${f(dx + lean * 0.5)} ${f(-h * 0.5)}, ${f(topX)} ${f(-h * 0.8)}, ${f(topX)} ${f(-h)}`, {
        kind: 'garden-lavender-stem',
        strokeWidth: 1.3,
      }),
    );
    for (let b = 0; b < 4; b++) marks.push(ellipse(topX, -h + b * 2.6, 1.7, 2.3, { kind: 'garden-lavender-head' }));
  }
  return marks;
}

/** A flat GRASS tuft (grounded-art inc 11 unit 3) — a handful of thin arching blades, seeded. Base at
 *  (0,0), UP in −y; the concept's cosy filler between the hero objects. Decorative, no verdict. */
function grassMarks(k: number): SceneNode[] {
  const marks: SceneNode[] = [ellipse(0.3, 0.5, 5, 1.5, { kind: 'shadow' })];
  const blades = 5 + Math.floor(rand01(k) * 3);
  for (let i = 0; i < blades; i++) {
    const dx = (rand01(k + i * 3 + 1) - 0.5) * 9;
    const h = 9 + rand01(k + i * 3 + 2) * 8;
    const lean = (rand01(k + i * 3 + 3) - 0.5) * 9;
    marks.push(
      path(`M ${f(dx)} 0 Q ${f(dx + lean * 0.5)} ${f(-h * 0.6)}, ${f(dx + lean)} ${f(-h)}`, {
        kind: 'garden-grass-blade',
        strokeWidth: 1.5,
      }),
    );
  }
  return marks;
}


/** The garden island's art drawables (grounded-art inc 11) — the `autumn-tree` hero at the tree spot
 *  (ADR-0221, replacing the procedural tree) and the cottage + gazebo placed around the island. Each is
 *  a y-sorted `baked-use` so it interleaves in painter order with anything else on the island. The caller
 *  SUPPRESSES the decorative flora. The unified vegetation vocabulary applies here too (ADR-0226
 *  promotion): the UAT criteria render as the same small-flower scatter every island speaks, and the
 *  human-witness signpost is retired (redundant with the UAT flowers). */
function buildGardenArt(
  t: SceneTerritoryInput,
  garden: SceneGardenInput,
  ownerCells: RelaxedCell[] | null,
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
  art: TileArt = SHIPPED_TILE_ART,
): Array<{ y: number; node: SceneNode }> {
  const land = ownerCells && ownerCells.length ? ownerCells : null;
  const crownR = crownRadius(t.caps) * art.tree;
  const out: Array<{ y: number; node: SceneNode }> = [];

  // the autumn-tree hero AS the central tree (ADR-0221) — at the story's tree spot, FITTED to the island
  // so its footprint lands within the shore on a small island (unit 2).
  const treeScale = fittedHeroScale('autumn-tree', garden.heroes['autumn-tree'], t, art);
  // its fitted footprint half-width feeds the free heroes' tree keep-out (grounded-art inc 12), so a
  // building never merges into the trunk on a small island where the tree fills the island.
  const treeHalfW = (treeScale * garden.heroes['autumn-tree'].width) / 2;
  out.push({
    y: t.treeSpot.y,
    node: gardenHeroUse('autumn-tree', t.treeSpot.x, t.treeSpot.y, treeScale),
  });
  // the human-witness signpost is RETIRED here too (ADR-0226 decision 5 — the unified vocabulary; the
  // the UAT flowers carry the story-level UAT state).
  // the free-standing garden heroes — cottage + gazebo: each FITTED to the island, then placed so the
  // whole fitted footprint sits on owned land (unit 2 — the owner's "fully land within the island" fix).
  const freeIds: GardenHeroId[] = ['cottage', 'gazebo'];
  const scales = new Map<GardenHeroId, number>(
    freeIds.map((id) => [id, fittedHeroScale(id, garden.heroes[id], t, art)]),
  );
  const halfW = new Map<GardenHeroId, number>(
    freeIds.map((id) => [id, (scales.get(id)! * garden.heroes[id].width) / 2]),
  );
  const spots = placeGardenHeroes(t, freeIds, halfW, land, treeHalfW, elevationDeg, art);
  for (const [id, p] of spots) {
    out.push({ y: p.y, node: gardenHeroUse(id, p.x, p.y, scales.get(id)!) });
  }
  // the stepping-stone garden PATH (unit 2; footpath refined inc 12). The concept reads as ONE clear paved
  // front-door WALK from the shore landfall up to the cottage door, with the rest of the garden lighter and
  // NO stones buried under the tree crown. So the path is TWO tiers, both dropping any stone that would sit
  // under the fitted canopy (`skipNear`): a PRIMARY walk (landfall → cottage) laid tight + nearly straight
  // (a deliberate front-door path that docks at the island's inter-island trail), and a LIGHT secondary
  // trail (cottage → gazebo) laid sparse and bowed AROUND the tree crown (`detourAroundTree`) rather than
  // threading through the tree spot — which is what buried stones under the canopy before.
  const landfall = islandLandfall(t, land, elevationDeg);
  const cottage = spots.get('cottage');
  const gazebo = spots.get('gazebo');
  const crown = { c: { x: t.treeSpot.x, y: t.treeSpot.y }, r: treeHalfW };
  const stone = garden.heroes['stepping-stone'];
  if (cottage) {
    // the prominent front-door WALK — tight spacing + a calm meander reads as a laid path, not a scatter.
    out.push(...buildStonePath(t, stone, [landfall, cottage], { spacingMul: 0.72, wobbleMul: 0.45, skipNear: crown, tag: 'walk', elevationDeg, art }));
  }
  if (cottage && gazebo) {
    // a LIGHT trail on to the gazebo — sparse, skirting the tree crown so no stone hides beneath it.
    const detour = detourAroundTree(cottage, gazebo, crown.c, treeHalfW, elevationDeg);
    out.push(...buildStonePath(t, stone, [cottage, detour, gazebo], { spacingMul: 1.5, wobbleMul: 0.8, skipNear: crown, tag: 'step', elevationDeg, art }));
  }

  // flat decorative accents + the UAT verdict: a lavender clump beside the cottage, and a couple of grass
  // tufts in the open — flat, seeded, clamped to owned land. This is the cosy garden read the concept has.
  // The UAT criteria render as the SAME unified small-flower scatter every other island uses (ADR-0226
  // promotion, owner look verdict 2026-07-22 — the garden node showed no visible UAT flowers because its
  // massed bud-bed read as a subtle clump; the 1:1 small-flower scatter is the one vocabulary the whole
  // map now speaks). The scatter keeps out of the hero tree well + spaces itself + lands on owned cells.
  // Both accent offsets are GROUND displacements (`crownR` is a ground radius, `rr` a fraction of the
  // island's GROUND radius — `t.groundRadius`, `scene-territory-radius-states-its-space`), so both
  // are projected through the declared camera before `towardLand` clamps them onto owned land —
  // otherwise the clamp is faithfully relocating the wrong point.
  const cen = t.centroid;
  const accentScale = crownR / 26;
  if (cottage) {
    const beside = projectGround({ x: -crownR * 0.85, y: crownR * 0.4 }, elevationDeg);
    const a = towardLand({ x: cottage.x + beside.x, y: cottage.y + beside.y }, cen, land);
    out.push({ y: a.y, node: g(lavenderMarks(hash(`${t.id}:lavender`)), { transform: `translate(${f(a.x)} ${f(a.y)}) scale(${f(accentScale)})` }) });
  }
  out.push(...buildUatMarkers(t, land, true, elevationDeg, art));
  for (let i = 0; i < 3; i++) {
    const k = hash(`${t.id}:grass:${i}`);
    const ang = rand01(k) * Math.PI * 2;
    const rr = (0.4 + rand01(k + 1) * 0.32) * t.groundRadius;
    const off = groundPolarOffset(ang, rr, elevationDeg);
    const gp = towardLand({ x: cen.x + off.x, y: cen.y + off.y }, cen, land);
    out.push({ y: gp.y, node: g(grassMarks(k), { transform: `translate(${f(gp.x)} ${f(gp.y)}) scale(${f(accentScale)})` }) });
  }
  return out;
}

/** The garden's baked-art DEFINITIONS layer (grounded-art inc 11, re-lighting ADR-0218's dormant seam):
 *  one `baked-def` per hero the garden USES, define-once. Emitted into the scene so a mapper renders a
 *  `<defs>` block every placement `baked-use` references. Only USED heroes are defined — no orphan defs. */
function buildGardenDefs(garden: SceneGardenInput): SceneG {
  const defs: SceneBakedDef[] = GARDEN_DEFINED_HEROES.map((id) => ({
    el: 'baked-def',
    defId: gardenDefId(id),
    nodes: garden.heroes[id].nodes,
  }));
  return g(defs, { kind: 'baked-defs' });
}

/** The scene-graph def-id for a tree-spread `autumn-tree` colourway (ADR-0227, amends ADR-0226/0221) —
 *  one per status (`veg-hero-autumn-tree-healthy`, `…-unhealthy`, …). Distinct from the garden's
 *  `garden-hero-autumn-tree` so the two features stay independent — the tree-spread applies to EVERY
 *  non-garden island, the garden to its one exemplar. */
function vegHeroTreeDefId(status: SceneStatus): string {
  return `veg-hero-autumn-tree-${status}`;
}

/** The status whose colourway a given island actually uses: its own status when a variant is supplied,
 *  else the `unknown` fallback (which the surface always supplies). Keeps every `<use>` pointing at a def
 *  the defs layer emitted. */
function resolvedTreeStatus(heroTrees: SceneVegHeroTrees, status: SceneStatus): SceneStatus {
  return heroTrees[status] ? status : 'unknown';
}

/** Place the tree-spread's `autumn-tree` colourway as the central tree of a non-garden island (ADR-0227)
 *  — a paint-free `baked-use` at the island's tree spot, referencing the def for the ISLAND'S STATUS so
 *  the crown carries the status hue the procedural tree carried (green=healthy, brown=mapped, …), restored
 *  on the authored silhouette. FITTED to the island exactly like a garden hero (`fittedHeroScale`); every
 *  colourway shares one box, so the fit is status-independent. Define-once / reference-many: one def per
 *  status, N cheap `<use>`s. Kind `baked-art` is the existing ADR-0218 placement kind — the studio/website
 *  mappers already render it and R3F already skips it, so there is zero new mapper/R3F code. */
function vegHeroTreeUse(heroTrees: SceneVegHeroTrees, t: SceneTerritoryInput, art: TileArt): SceneBakedUse {
  const status = resolvedTreeStatus(heroTrees, t.status);
  const hero = heroTrees[status];
  const s = hero ? fittedHeroScale('autumn-tree', hero, t, art) : 1;
  return {
    el: 'baked-use',
    defId: vegHeroTreeDefId(status),
    kind: 'baked-art',
    id: `veg-tree-${t.id}`,
    transform: `translate(${f(t.treeSpot.x)} ${f(t.treeSpot.y)}) scale(${f(s)})`,
  };
}

/** The tree-spread's baked-art DEFINITIONS layer (ADR-0227): one `autumn-tree` colourway def per STATUS
 *  actually used by the islands on this map (define-once / reference-many, ADR-0069 — never more defs than
 *  distinct statuses present, so the node floor stays proportional). Referenced by each island's
 *  `vegHeroTreeUse`. Emitted only when the surface supplies `vegetation.heroTrees`; absent ⇒ the procedural
 *  tree stays and no defs layer is emitted. */
function buildVegetationDefs(heroTrees: SceneVegHeroTrees, statuses: Iterable<SceneStatus>): SceneG {
  const seen = new Set<SceneStatus>();
  const defs: SceneNode[] = [];
  for (const st of statuses) {
    const status = resolvedTreeStatus(heroTrees, st);
    if (seen.has(status)) continue;
    seen.add(status);
    const hero = heroTrees[status];
    if (hero) defs.push({ el: 'baked-def', defId: vegHeroTreeDefId(status), nodes: hero.nodes });
  }
  return g(defs, { kind: 'baked-defs' });
}

// ---------------------------------------------------------------------------
// a whole island's flora layer (TerritoryFlora)
// ---------------------------------------------------------------------------

/** One island's flora group: conifers (expanded from the decor seeds), capability
 *  plants, and the central tree — all y-sorted so southern art overlaps northern —
 *  then the nameplate and the wisp orbit.
 *
 *  When `parcelFlora` is provided (a parcels-present island, forest-parcels inc 1), the decorative
 *  conifers (`decor`) and the one-plant-per-cap ring (`plants`) are RETIRED — the parcel surface
 *  flora replaces them, y-sorted into the same list as the tree so the interleave with the canopy
 *  still holds. Absent ⇒ today's conifer + plant render is byte-for-byte unchanged. */
export function buildTerritoryFlora(
  t: SceneTerritoryInput,
  parcelFlora?: ParcelFloraMark[] | null,
  ownerCells?: RelaxedCell[] | null,
  garden?: SceneGardenInput | null,
  vegetation?: SceneVegetationInput | null,
  /** The camera the island's geometry is projected at (ADR-0367 D1) — the placements below measure
   *  ground distances through it. Defaults to the declared land camera. */
  elevationDeg: number = LAND_CAMERA_ELEVATION_DEG,
  /** The tile the island is drawn on (ADR-0528). Defaults to the shipped tile. */
  art: TileArt = SHIPPED_TILE_ART,
): SceneG {
  const drawables: { y: number; node: SceneNode }[] = [];
  // The unified vegetation vocabulary (ADR-0226) governs the NON-garden path only — the garden
  // composition (below) is its own attested look. Present ⇒ small UAT flowers + the retired signpost
  // (and, once UNIT 2 lands, the hero central tree); absent ⇒ byte-for-byte.
  const unifiedVeg = !!vegetation;

  if (garden) {
    // the cosy-island GARDEN (grounded-art inc 11, ADR-0221): the four heroes ARE this island's art.
    // The decorative flora (conifers / capability plants / parcel flora), the procedural central tree,
    // and the 1:1 UAT-flower scatter are ALL suppressed — the heroes replace them; the `autumn-tree`
    // hero stands as the central tree. The nameplate + session wisps/claims still layer on below.
    drawables.push(...buildGardenArt(t, garden, ownerCells ?? null, elevationDeg, art));
  } else {
    if (parcelFlora) {
      // parcels-present: the parcel surface flora IS the island's flora (conifers + plant ring retired).
      for (const fm of parcelFlora) drawables.push({ y: fm.y, node: fm.node });
    } else {
      for (const d of t.decor) {
        const count = 2 + (d.seed % 2);
        for (let i = 0; i < count; i++) {
          const a = rand01(d.seed + i * 7) * Math.PI * 2;
          const rr = rand01(d.seed + i * 13) * HEX_R * 0.55;
          const x = d.x + Math.cos(a) * rr;
          const y = d.y + Math.sin(a) * rr * 0.8 + art.units(4);
          drawables.push({ y, node: buildConifer(x, y, 7 + rand01(d.seed + i) * 4, d.seed + i, art) });
        }
      }
      for (const plant of t.plants) drawables.push({ y: plant.y, node: buildPlant(plant, art) });
    }
    // The central tree. Under the tree-spread (ADR-0226 decision 1, amends ADR-0221; per-status
    // colourways, ADR-0227), a supplied `vegetation.heroTrees` replaces the procedural `buildTree` with a
    // `<use>` of the `autumn-tree` colourway for THIS island's status — define-once / reference-many, so
    // the whole map reads as one authored world AND each tree still carries its status hue (the loss the
    // owner flagged in the uniform-brown promotion). The island keeps its grass / flora / UAT markers;
    // ONLY the tree becomes the hero. Absent `heroTrees` ⇒ the procedural tree (grass/flowers still
    // apply, and flag-off is byte-for-byte).
    if (vegetation?.heroTrees) {
      drawables.push({ y: t.treeSpot.y, node: vegHeroTreeUse(vegetation.heroTrees, t, art) });
    } else {
      drawables.push({ y: t.treeSpot.y, node: buildTree(t, unifiedVeg, art, elevationDeg) });
    }
    // the UAT markers (forest-parcels inc 2; tall flowers, grounded-art inc 7; small flowers folded into
    // the grass, ADR-0226) — each scattered flower is its OWN y-sorted drawable so it interleaves with the
    // tree + flora by depth. Under the vocabulary flag they render SMALL (a low meadow flower, not a tall
    // scatter). The island's substrate cells (when known) are the scatter's keep-in. Absent/empty
    // uatCriteria ⇒ nothing (the lock).
    drawables.push(...buildUatMarkers(t, ownerCells ?? null, unifiedVeg, elevationDeg, art));
  }
  drawables.sort((a, b) => a.y - b.y);

  const children: SceneNode[] = drawables.map((d) => d.node);
  children.push(buildPlate(t, art));
  const wisps = buildWisps(t, art);
  if (wisps) children.push(wisps);
  // ADR-0138 §5: the story-claim orbit ("a session is here") — a DISTINCT drawable family from the
  // build wisp, never a proof signal. Layered after the build wisps so when both run the claim reads outside.
  const claimWisps = buildClaimWisps(t, art);
  if (claimWisps) children.push(claimWisps);
  // ADR-0200 D7: the departure layer ("a session just left") — after the claim layer, same
  // absent/empty ⇒ nothing rule, same §5 honesty wall (never a proof signal).
  const departingWisps = buildDepartingWisps(t, art);
  if (departingWisps) children.push(departingWisps);

  return g(children, { kind: 'territory', status: t.status, id: t.id });
}

// ---------------------------------------------------------------------------
// the static layers (coast / ground / trails / empties / hits)
// ---------------------------------------------------------------------------

function isG(n: SceneG | null): n is SceneG {
  return n !== null;
}

function buildEmpties(input: SceneInput, art: TileArt, elevationDeg: number): SceneG {
  return g(
    input.empties.map((h) => {
      const c = hexCenter(h, { elevationDeg, hexR: art.hexR });
      // ADR-0286: a coast hex carries the id of the island it grew out of, when the caller
      // attributed it — that id is the only handle a per-story hide has on this layer. An
      // unattributed hex (or an owner index no territory answers to) stays id-less, exactly as
      // every coast hex was before attribution existed.
      const id = h.owner === undefined ? undefined : input.territories[h.owner]?.id;
      return path(hexPath(c.x, c.y, art.hexR - art.units(0.6), elevationDeg), id === undefined ? { kind: 'empty' } : { kind: 'empty', id });
    }),
    { kind: 'empties-layer' },
  );
}

function buildCoast(input: SceneInput, elevationDeg: number): SceneG {
  const groups = input.territories
    .map((t): SceneG | null =>
      t.coastGroundLoops.length
        ? g(
            t.coastGroundLoops.map((loop) =>
              path(smoothLoopPath(loop.map((p) => projectGround(p, elevationDeg))), { kind: 'coast-shore' }),
            ),
            { kind: 'coast', status: t.status, id: t.id },
          )
        : null,
    )
    .filter(isG);
  return g(groups, { kind: 'coast-layer' });
}

/**
 * A land cell's SHAPE-FREE identity: `<storyId>/cell-<n>`, where `n` is the cell's ordinal in its own
 * island's ground group at emission time.
 *
 * ADR-0367 gives the land a camera and then Blender-rendered art, so the emitted cell geometry is
 * about to move. The accretion reveal used to be indexed by the cell's literal `d` string — the key
 * WAS the geometry, down to `polyPath`'s one decimal place — so any change to how a polygon is
 * printed silently dropped the reveal for every cell that moved: the lookup missed, the cell rendered
 * un-transformed, and the symptom read as an easing bug. This is the addressing that replaces it.
 *
 * Why the ordinal and not something drawn from the geometry: the cell HAS no other durable handle.
 * `RelaxedCell` carries only `owner` / `poly` / `variant` / `wheat`, and every candidate derived from
 * the mesh (a vertex-id tuple, a centroid, a hashed polygon) is the shape again by another name. The
 * ordinal is derived from EMISSION ORDER, which is deterministic from the layout data (`buildScene`
 * is pure and its determinism is already red-green) and completely independent of where the vertices
 * land — so it survives a precision change, a projection, and an angled camera. It does NOT survive
 * the interior being re-latticed into a different number of cells, and nothing could: those are
 * different cells, not the same cells relocated.
 *
 * The story prefix is load-bearing, not decoration: `forestRegrowRenderLayer` flattens every in-flight
 * island's reveals into ONE map, so a bare per-island ordinal would make one island's nth cell shadow
 * another's. The `d` string was globally unique only because two islands never sit at the same
 * coordinates.
 */
export function landCellId(storyId: string, index: number): string {
  return `${storyId}/cell-${index.toString().padStart(3, '0')}`;
}

/**
 * Stamp every land cell inside ONE island's ground nodes with its {@link landCellId}, in emission
 * order. Walked rather than assigned at each `path(...)` call site because the parcels-present ground
 * nests its cells one level deeper (inside per-capability `parcel` groups) — one walk here keeps a
 * single per-island counter across both shapes, and keys the cells in exactly the depth-first order
 * the accretion collector re-walks them in.
 */
function stampLandCellIds(nodes: readonly SceneNode[], storyId: string): void {
  let next = 0;
  const walk = (node: SceneNode): void => {
    if (node.el === 'path' && (node.kind === 'cell' || node.kind === 'cell-wheat')) {
      node.cellId = landCellId(storyId, next);
      next += 1;
      return;
    }
    if (node.el === 'g') for (const child of node.children) walk(child);
  };
  for (const node of nodes) walk(node);
}

function buildGround(input: SceneInput, surfaces: (ParcelSurface | null)[], elevationDeg: number): SceneG {
  if (input.relaxedCells) {
    const cells = input.relaxedCells;
    const groups = input.territories
      .map((t, owner): SceneG | null => {
        const owned = cells.filter((c) => c.owner === owner);
        if (!owned.length) return null;
        const surf = surfaces[owner];
        if (surf) {
          // parcels-present: the per-parcel, per-cell status-tinted ground replaces the plain cells
          // (the per-territory status tint that keyed today's ground moves down to per-cell cap status).
          stampLandCellIds(surf.ground, t.id);
          return g(surf.ground, { kind: 'ground', status: t.status, id: t.id });
        }
        const plain = owned.map((c) =>
          path(polyPath(c.poly), c.wheat ? { kind: 'cell-wheat' } : { kind: 'cell', variant: c.variant }),
        );
        stampLandCellIds(plain, t.id);
        return g(plain, { kind: 'ground', status: t.status, id: t.id });
      })
      .filter(isG);
    return g(groups, { kind: 'ground-mesh' });
  }
  // classic extruded-hex ground — each tile is its own group (the studio's hex-land).
  const tiles = input.drawTiles
    .map(({ h, owner }): SceneG | null => {
      const t = input.territories[owner];
      if (!t) return null;
      const c = hexCenter(h, { elevationDeg });
      const key = axialKey(h);
      const wheat = (input.wheatSets[owner] ?? EMPTY_KEYS).has(key);
      // The extrusion is an UPRIGHT world height, so it carries cos θ where the lattice carries
      // sin θ (ADR-0367 D1) — the module-level `TILE_DEPTH` is that same product at the DECLARED
      // camera, and reading it here is what pinned this family to a second copy of the camera.
      const tileDepth = TILE_DEPTH_WORLD * uprightForeshortening(elevationDeg);
      return g(
        [
          path(hexPath(c.x, c.y + tileDepth, HEX_R, elevationDeg), { kind: 'tile-side' }),
          path(
            hexPath(c.x, c.y, HEX_R, elevationDeg),
            wheat ? { kind: 'tile-top-wheat' } : { kind: 'tile-top', variant: hash(`tile:${key}`) % 3 },
          ),
        ],
        { kind: 'tile', status: t.status, id: t.id },
      );
    })
    .filter(isG);
  return g(tiles, { kind: 'ground-hex' });
}

/**
 * THE 2D TRAIL'S STROKE SCALE — the 2D art pass's rung for the trails (ADR-0528 D2). `trailFillWidth`
 * is the ONE width rule every surface shares, in ground units, and the 3D mapper reads it DIRECTLY
 * (`world-to-3d.ts`) for its ribbon — so it must not move, or the 3D island's own trails would.
 * What the 2D drawing strokes is that width times this factor: at `TILE_SCALE` the trail keeps the
 * exact on-screen width it had at the designed resting view; at 1 the 2D trail is as wide relative
 * to its island as the 3D ribbon is. The cave portal (`buildCave`) is NOT scaled: the mapper recovers
 * its mouth width from the drawn arch, so its geometry is the 3D contract.
 */
export const TRAIL_STROKE_SCALE = SHIPPED_TILE_ART.trailStroke;

/** One trail-segment path node — the segment id + `data-usage`/`data-edges` hooks, and
 *  the per-pass stroke width derived from the ONE width rule (`trailFillWidth`). */
function trailSegPath(
  s: TrailSegment,
  kind: SceneKind,
  widen: number,
  edgesOf: (id: string) => string,
  markSpur: boolean,
  art: TileArt,
): ScenePath {
  // ANNOTATED local, then one guarded assignment — the shape
  // `anti-slop/no-conditional-empty-object-spread` requires.
  const attrs: SceneNodeBase = {
    kind,
    id: s.id,
    usage: s.usage,
    edges: edgesOf(s.id),
    strokeWidth: trailFillWidth(s.usage) * art.trailStroke + art.units(widen),
  };
  // a spur (one edge) is a dashed footpath; a trunk (≥2) a solid road (ADR-0169 §2)
  if (markSpur && s.usage === 1) attrs.spur = true;
  return path(s.d, attrs);
}

/** The trail network as FULL cased passes (ADR-0169 §2): every visible segment drawn
 *  once per pass — shadow, then casing, then fill, then the under-island ghost runs —
 *  never interleaved per path, so merged trunks read as one trail (the cartographic
 *  casing rule). Ends with the non-visual per-edge reveal metadata (`trail-edges`).
 *  Default-hidden is the SURFACE's concern (§3): the core emits everything. */
export function buildTrails(input: SceneInput, art: TileArt = tileArt(input.tile?.hexR, input.tile?.rungs)): SceneG {
  const net = input.trails;
  // Per-segment `from->to` keys, folded from the edge chains (a segment doesn't carry
  // them); edge-input order, first appearance wins — deterministic.
  const segEdges = new Map<string, string[]>();
  for (const e of net.edges) {
    const key = `${e.from}->${e.to}`;
    for (const ref of e.segments) {
      const list = segEdges.get(ref.id);
      if (!list) segEdges.set(ref.id, [key]);
      else if (!list.includes(key)) list.push(key);
    }
  }
  const edgesOf = (id: string): string => (segEdges.get(id) ?? []).join(',');
  const visible = net.segments.filter((s) => !s.hidden);
  const hidden = net.segments.filter((s) => s.hidden);
  return g(
    [
      g(visible.map((s) => trailSegPath(s, 'trail-shadow', 5, edgesOf, false, art)), { kind: 'trail-shadow-pass' }),
      g(visible.map((s) => trailSegPath(s, 'trail-casing', 2.5, edgesOf, false, art)), { kind: 'trail-casing-pass' }),
      g(visible.map((s) => trailSegPath(s, 'trail-fill', 0, edgesOf, true, art)), { kind: 'trail-fill-pass' }),
      g(hidden.map((s) => trailSegPath(s, 'trail-ghost', 0, edgesOf, false, art)), { kind: 'trail-ghost-pass' }),
      g(
        net.edges.map((e) => {
          // ANNOTATED local, then one guarded assignment — the shape
          // `anti-slop/no-conditional-empty-object-spread` requires.
          const attrs: SceneNodeBase = {
            kind: 'trail-edge',
            from: e.from,
            to: e.to,
            segments: e.segments.map((r) => `${r.id}:${r.reversed ? 'R' : 'F'}`).join(','),
          };
          if (e.title !== undefined) attrs.title = e.title;
          return g([], attrs);
        }),
        { kind: 'trail-edges' },
      ),
    ],
    { kind: 'trails-layer' },
  );
}

/** A cave portal prop (ADR-0169 §2) — where a forced route disappears under an island.
 *  Local frame after the group transform: +x is the outward rim normal (the bearing),
 *  so the flat side of the arch lies against the island wall (the local y axis) and the
 *  mouth bulges outward toward the arriving trail. Hue is the mapper's: `cave-arch` is
 *  the near-black of the island's shadow/side-wall family, keyed by the folded island
 *  `status` carried here (the same kind+status derivation every island hue uses);
 *  `cave-rim` the lit upper edge; `cave-apron` a multiply-darkened trampled patch. */
function buildCave(c: TrailCave, status: SceneStatus): SceneG {
  const hw = (c.width * 1.6) / 2; // arch mouth half-width, sized from the trail width
  const deg = (c.bearing * 180) / Math.PI;
  return g(
    [
      ellipse(hw * 0.5, 0, hw * 1.3, hw * 0.64, { kind: 'cave-apron' }),
      // flat-bottomed arch: a half-disc closed along the y-axis chord (the rim wall)
      path(`M 0 ${f(-hw)} A ${f(hw)} ${f(hw)} 0 0 1 0 ${f(hw)} Z`, { kind: 'cave-arch' }),
      // the lit rim arc on the upper edge of the mouth
      path(`M 0 ${f(-hw)} A ${f(hw)} ${f(hw)} 0 0 1 ${f(hw)} 0`, {
        kind: 'cave-rim',
        strokeWidth: 1.5,
      }),
    ],
    {
      kind: 'cave',
      status,
      island: c.islandId,
      edges: c.edgeIds.join(','),
      transform: `translate(${f(c.x)} ${f(c.y)}) rotate(${f(deg)})`,
    },
  );
}

/** Every cave portal, status-folded from its island's territory (an island with no
 *  territory — a decor-only obstacle — wears `unknown`). */
function buildCaves(input: SceneInput): SceneG[] {
  const statusOf = new Map(input.territories.map((t) => [t.id, t.status]));
  return input.trails.caves.map((c) => buildCave(c, statusOf.get(c.islandId) ?? 'unknown'));
}

function buildHits(input: SceneInput, art: TileArt): SceneG {
  return g(
    input.territories.map((t) => {
      const crownR = crownRadius(t.caps);
      const top = t.treeSpot.y - (2.7 * crownR + 16) * art.tree;
      const hgt = t.labelY + t.plate.h * art.plate - top;
      return rect(t.centroid.x - t.screenRadius, top, t.screenRadius * 2, hgt, art.units(14), {
        kind: 'hit',
        id: t.id,
        title: t.plate.title,
      });
    }),
    { kind: 'hits-layer' },
  );
}

// ---------------------------------------------------------------------------
// buildScene — the whole drawable tree
// ---------------------------------------------------------------------------

/**
 * The whole forest world as a framework-agnostic drawable tree (ADR-0093). The
 * root is the offset group; its children are the layers in canonical studio order:
 * pale coast, the smoothed coastland, the ground (mesh or hex), the `depends_on`
 * trail network (above ground, below flora — ADR-0169), the per-island flora with
 * the cave-portal props appended (above flora, so an arch occludes the trail
 * disappearing under its island), and the delegation hit areas. Each surface walks
 * this and maps roles → its own classes + behaviour; the surface owns its own
 * `<svg>` shell + `<defs>`, plus any surface-only chrome (the studio's solar
 * spokes / Shared-Islands panel / building stamps; the website's hit delegation)
 * layered on top.
 */
/**
 * Project a `ground`-tagged island's anchors into the scene's own screen space, ONCE, on the way in
 * ({@link SceneTerritoryInput.anchorSpace}). A `screen` island — the absent-tag default — is
 * returned as it arrived, by identity, so an unconverted caller cannot be charged for a field it
 * never set.
 *
 * ⚠ WHY THE BOUNDARY AND NOT THE ~30 CONSUMER SITES. It is the same shape `substrate.ts` and
 * `routing.ts` already use and the reason the layout commutes with the projection at all: build in
 * ground space, call `projectGround` exactly once on the way out. Pushing the projection down to
 * each consumer would instead hand GROUND points to `groundGap`, which un-projects the difference
 * of two SCREEN points — so it would silently un-project twice, with both spaces spelt `Pt` and no
 * type error anywhere. Normalising here means every consumer below keeps the screen contract it was
 * written against and stays correct by construction.
 *
 * `labelY` USED TO BE deliberately absent from this list, on the ground that it was screen art under
 * either tag. It is here now (ADR-0545): two of its four consumers — the marker scatter's and the
 * garden's `clearsPlate` — are ground placements, and a placement measured against an unprojected
 * baseline reads the camera whatever else it does. It rides the same one-projection-on-the-way-in
 * rule as the rest, so both keep-outs keep the screen contract they were written against.
 */
function anchorsToScreen(t: SceneTerritoryInput, elevationDeg: number): SceneTerritoryInput {
  if ((t.anchorSpace ?? 'screen') === 'screen') return t;
  const p = (q: Pt): Pt => projectGround(q, elevationDeg);
  const projected: SceneTerritoryInput = {
    ...t,
    centroid: p(t.centroid),
    treeSpot: p(t.treeSpot),
    labelY: p({ x: 0, y: t.labelY }).y,
    plants: t.plants.map((pl) => ({ ...pl, ...p({ x: pl.x, y: pl.y }) })),
    decor: t.decor.map((d) => ({ ...d, ...p({ x: d.x, y: d.y }) })),
    anchorSpace: 'screen' as const,
  };
  // The parcel seeds ride the tag too: they are Voronoi seeds matched against `relaxedCells`, which
  // the caller hands over ALREADY projected, so a ground seed has to reach that same space or every
  // island's ground partition shifts under its own flora. Assigned rather than conditionally spread,
  // so an island with NO parcels keeps the field absent — the core's own back-compat semantics read
  // absent and empty differently (absent ⇒ conifers + the plant ring).
  if (t.parcels) projected.parcels = t.parcels.map((pc) => ({ ...pc, seed: p(pc.seed) }));
  return projected;
}

export function buildScene(rawInput: SceneInput): SceneG {
  // Normalise the island anchors into this scene's screen space before anything reads them
  // (ADR-0527 D1) — see {@link anchorsToScreen} for why it happens here and not per consumer.
  const input: SceneInput = {
    ...rawInput,
    territories: rawInput.territories.map((t) =>
      anchorsToScreen(t, rawInput.cameraElevationDeg ?? LAND_CAMERA_ELEVATION_DEG),
    ),
  };
  // Compute each parcels-present island's surface ONCE (forest-parcels inc 1) — the ground threads to
  // `buildGround`, the flora to `buildTerritoryFlora`. Null (no parcels / no mesh cells) ⇒ today's
  // render on both seams, byte-for-byte.
  const cells = input.relaxedCells;
  // Each territory's substrate cells, computed once — the parcel surface AND the UAT-marker
  // keep-in both read them.
  const ownerCells: (RelaxedCell[] | null)[] = input.territories.map((_, owner) =>
    cells ? cells.filter((c) => c.owner === owner) : null,
  );
  // The unified vegetation vocabulary (ADR-0226) — present ⇒ the surfaces retire their decorative bloom
  // tier and the flora path renders the small-flower / retired-signpost vocabulary. ABSENT ⇒ every
  // island renders byte-for-byte (the absence lock; the public website never sends it).
  const vegetation = input.vegetation ?? null;
  const unifiedVeg = !!vegetation;
  // The camera the surface projected the ground geometry at (ADR-0367 D1). Absent ⇒ the declared land
  // camera, which is what every shipped surface uses — so this is a proof/inspection seam, not a
  // second camera.
  const elevationDeg = input.cameraElevationDeg ?? LAND_CAMERA_ELEVATION_DEG;
  // The tile the scene is drawn on (ADR-0528) — absent ⇒ the shipped, derived tile.
  const art = tileArt(input.tile?.hexR, input.tile?.rungs);
  const surfaces: (ParcelSurface | null)[] = input.territories.map((t, i) => {
    const own = ownerCells[i];
    return own ? buildTerritorySurface(t, own, unifiedVeg, art) : null;
  });
  // ADR-0218's fenced baked-art seam is RE-LIT here (grounded-art inc 11, ADR-0221): when `input.garden`
  // is present, its heroes' `baked-def`s are emitted once into a `baked-defs` layer that every hero
  // placement `baked-use` (in `buildGardenArt`) references. ABSENT ⇒ no defs layer, and every island
  // renders byte-for-byte (the same absence lock as `parcels`/`uatCriteria`; the public website never
  // sends `garden`). The heroes compose ONLY onto the island named by `garden.islandId`.
  const garden = input.garden ?? null;
  const layers: SceneNode[] = [
    ...(garden ? [buildGardenDefs(garden)] : []),
    // ADR-0226 decision 1 (the tree-spread) + ADR-0227 (per-status colourways): one `autumn-tree` def per
    // STATUS present on the map, emitted when the surface supplies `vegetation.heroTrees`, referenced by
    // every non-garden island's central-tree `<use>`. Absent ⇒ no defs layer, and every island's tree
    // renders as the procedural `buildTree` byte-for-byte.
    ...(vegetation?.heroTrees ? [buildVegetationDefs(vegetation.heroTrees, input.territories.map((t) => t.status))] : []),
    buildEmpties(input, art, elevationDeg),
    buildCoast(input, elevationDeg),
    buildGround(input, surfaces, elevationDeg),
    buildTrails(input, art),
    g(
      [
        ...input.territories.map((t, i) =>
          buildTerritoryFlora(
            t,
            surfaces[i]?.flora ?? null,
            ownerCells[i] ?? null,
            garden && garden.islandId === t.id ? garden : null,
            vegetation,
            elevationDeg,
            art,
          ),
        ),
        ...buildCaves(input),
      ],
      { kind: 'flora-layer' },
    ),
    buildHits(input, art),
  ];
  return g(layers, {
    kind: 'world',
    transform: `translate(${f(input.offset.x)} ${f(input.offset.y)})`,
  });
}
