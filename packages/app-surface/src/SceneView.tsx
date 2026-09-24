// SceneView — the studio's thin React MAPPER over the shared scene-graph (ADR-0093,
// strategy C, Unit 2b). It walks the framework-agnostic `SceneNode` tree from
// `@storytree/forest-world` and emits native React `<g>`/`<path>`/`<circle>`/… with
// the STUDIO's own class names + its existing per-node hover/click/focus handlers
// (keyed on the node id) — NOT `innerHTML` + event delegation (the reason the owner
// chose strategy C over B). The geometry + structure are the core's; this file owns
// only the role → studio-class translation and the interactivity.
//
// This IS the map's render now: `readRenderScene` treats everything except an explicit
// `?render=legacy` / `?render=inline` as the scene default, so the old inline render in
// TreeView is the escape hatch, not the canonical path. (The "behind a flag, default off"
// note this replaced was true only for the ADR-0093 rollout.) Visual parity with the
// inline render is operator-attested (ADR-0070), not asserted.

import React from 'react';
import {
  trailFillWidth,
  type BakedPaintNode,
  type SceneKind,
  type SceneNode,
  type SceneStatus,
} from '@storytree/forest-world';
import { resolveSprite, spriteKeyFor, type SpriteStyleSheet } from './sprite-sheet.js';
import {
  collectDefBounds,
  fitSpritePlacement,
  wrapperContentBounds,
  type Bounds,
} from './sprite-sizing.js';
import type { TrailRevealPlan } from './trailReveal.js';
import type { NeighbourHighlightPlan } from './neighbourHighlight.js';
import type { LaneLayout } from './laneLayout.js';
import type {
  SvgIslandAccretionCellReveal,
  SvgIslandAccretionState,
} from './svg-island-accretion.js';
import type { VegetationRender } from './island-vegetation-growth.js';
import type { VegetationRenderLayer } from './vegetation-render.js';
import { organicLayerBox } from './land-camera.js';
import { nativePropTargetRects, type NativePropTargetRenderLayer } from './native-prop-targets.js';

export interface OrganicPoseRenderLayer {
  readonly trackId: string;
  readonly src: string;
  readonly frameIndex: number;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly assetAnchor: { readonly x: number; readonly y: number };
  readonly worldAnchor: { readonly x: number; readonly y: number };
  readonly scale: number;
  readonly depthSlot: 'hero-tree-organic' | 'ground-plant-organic';
  /**
   * OPTIONAL vertical PROJECTION factor in (0,1] — a pure display squash of this layer's rendered
   * box, anchored AT `worldAnchor` (the asset's registered ground contact) so the base stays
   * pinned and only the height compresses. `worldAnchor.y` is an exact fixed point of the
   * transform: the anchor's own offset is scaled by the same factor as the box, so
   * `y + assetAnchor.y * scale * projection === worldAnchor.y` for every value.
   *
   * It is DISPLAY ONLY — track data, registered anchors, frame selection and playback state are
   * untouched, and it is not a camera: a squashed sprite is a comparison stand-in for a lower
   * view angle, not a re-render at one. Absent ⇒ nothing is emitted and the rendered `<image>` is
   * byte-identical to before this field existed.
   */
  readonly projection?: number;
}

export interface NativeIslandGrowthRenderLayer {
  readonly storyId: string;
  readonly worldAnchor: { readonly x: number; readonly y: number };
  readonly radius: { readonly x: number; readonly y: number };
  readonly progress: number;
}

/**
 * The Act 2 intro's whole-forest regrow (ADR-0282 D1) — the SAME connected accretion the single
 * island already plays, applied to every island still growing, plus the two absence sets that let
 * a forest start from nothing.
 *
 * The two lookups are pre-MERGED across every accreting island by the caller so this walk stays
 * O(1) per node: with 45 territories, probing one accretion state per island per cell would be
 * O(islands x cells) on a surface whose measured cost is already rasterisation (ADR-0272).
 *
 * Absent ⇒ every node renders exactly as it did before this field existed.
 */
export interface ForestRegrowRenderLayer {
  /** Stories with no island on the map yet — their coast, ground, flora and hit area are not drawn. */
  readonly hiddenStoryIds: ReadonlySet<string>;
  /**
   * Stories whose PALE COAST HEXES are not drawn yet (ADR-0286) — a strict superset of
   * {@link hiddenStoryIds}: absent islands PLUS the ones still accreting.
   *
   * A separate set because the moat reveals LATER than the island it belongs to. The coast hexes
   * ring an island's FINAL footprint, so showing them the moment accretion starts would draw a
   * pale halo around a single cell — the same "the map already knows what is coming" read, one
   * island at a time. They land with the settled island instead.
   *
   * Only reaches a coast hex the scene ATTRIBUTED to a story (`SceneEmptyHex.owner`); an
   * unattributed moat is untouched, exactly as it was before this field existed.
   */
  readonly hiddenEmptyStoryIds: ReadonlySet<string>;
  /** Trail segments whose two endpoint islands are not both present — roads to nowhere, not drawn. */
  readonly hiddenSegmentIds: ReadonlySet<string>;
  /** storyId → the coast settlement clip for an island still accreting. */
  readonly accretionByStory: ReadonlyMap<string, SvgIslandAccretionState>;
  /** cell IDENTITY (`SceneNodeBase.cellId`) → its reveal scale, merged across every accreting
   *  island. Story-scoped ids, so the merge across islands cannot collide (ADR-0367). */
  readonly cellRevealById: ReadonlyMap<string, SvgIslandAccretionCellReveal>;
}

/** The focus-aware context the walk needs — the studio's per-render interactivity
 *  (the scene itself is focus-agnostic; focus / hover / selection are applied here). */
export interface SceneCtx {
  /** The focus-aware island class (mirrors TreeView's `territoryClass`), by id + folded status. */
  territoryClassById: (id: string, status: SceneStatus) => string;
  /** The ARRIVAL draw-on plan (lib/trailReveal `arrivalGrowPlan`), or null when nothing
   *  is arriving. Trails are ALWAYS drawn now (owner 2026-07-07); a segment growing on an
   *  island arrival wears `is-growing` + its per-segment draw-on mask. Reused type shape;
   *  the plan is now rooted at arriving islands' direct edges, not a clicked focus. */
  reveal: TrailRevealPlan | null;
  /** Statuses the legend has filtered out (a matching tree / plant wears `is-filtered`). */
  hidden: ReadonlySet<string>;
  // NB: no island HOVER handler — hover-driven highlight was removed (owner 2026-07-06,
  // the mousemove recolour was the reported lag). Reveal-on-click was retired too (owner
  // 2026-07-07 — pathways are always drawn); the only focus affordance is the
  // `.is-selected` shore border on the clicked island.
  onSelectStory: (id: string) => void;
  onSelectCap: (storyId: string, capId: string) => void;
  /** Story ids whose islands play the ARRIVAL animation (a story that just appeared in
   *  the tree payload, or the `?arrive=` demo target): their coast/ground/flora form in
   *  stages AND their direct incident trails draw on from the new island (the `reveal`
   *  plan above). Absent/empty ⇒ no arrival classes/masks at all. */
  arrivalIds?: ReadonlySet<string> | null;
  /** The resolved sprite ART STYLE SHEET (sprite-art-sheets spike, default-off `artStyle` world
   *  setting) — PRESENT ⇒ any node whose sprite key {@link resolveSprite} covers renders an `<image>`
   *  instead of recursing into its vector children (see {@link trySprite} below); an uncovered kind
   *  always stays vector, so a sheet may cover only some kinds. `null`/absent (the `vector` default) ⇒
   *  every node renders vector, byte-identical to before this flag existed. */
  spriteSheet?: SpriteStyleSheet | null;
  /** Global sprite size dial (the `artScale` world setting, default 1) — multiplies the DERIVED fit
   *  {@link fitSpritePlacement} computes from the vector body a sprite replaces. Only read when
   *  `spriteSheet` is present. */
  artScale?: number;
  /** The SELECTION highlight plan (ADR-0242, `neighbourHighlightPlan`) — which trail segments sit on
   *  the selected story's OWN one-hop edges. Present ⇒ the trail-fill pass gains a `trail-lit` LANE
   *  drawn over each of those segments, narrower than the road beneath it so a shared trunk still
   *  reads as shared. Null/absent ⇒ no lane at all, byte-identical to before. (The neighbour ISLAND
   *  rings ride `territoryClassById`, which the caller composes from the same plan.) */
  neighbours?: NeighbourHighlightPlan | null;
  /** The laid-out selection lanes (`laneLayout`). PRESENT ⇒ the trail-fill pass draws ONE
   *  lane per route, island to island, in the relation's hue, plus any roundabout islands —
   *  and the per-segment `trail-lit` pass above is skipped entirely. Absent ⇒ the shipped
   *  ADR-0242 per-segment ink lane, byte-identical to before this existed. */
  lanes?: LaneLayout | null;
  /** Which selection motion the lanes carry: `draw` (each route draws on once, the default
   *  the studio ships) or `march` (a looping travelling dash). `none` leaves them still.
   *  Only read when {@link lanes} is present; `prefers-reduced-motion` overrides all three. */
  laneMotion?: 'draw' | 'march' | 'none';
  /** App-native clip growth for one existing SVG island. */
  nativeIslandGrowthLayer?: NativeIslandGrowthRenderLayer | null;
  /** Connected app-native growth over the existing island's real shared-edge cell topology. */
  svgIslandAccretionLayer?: SvgIslandAccretionState | null;
  /** The whole-forest regrow (ADR-0282): absence sets + per-island accretion for many islands
   *  at once. Absent/null ⇒ every node renders byte-identically to before it existed. */
  forestRegrowLayer?: ForestRegrowRenderLayer | null;
  /** PER-OBJECT vegetation growth (ADR-0292): each island's central tree and capability plants as
   *  frames of the two SHARED authored tracks, and each conifer / UAT flower / nameplate rooted at
   *  its own ground anchor on its own beat. Keyed by scene-node IDENTITY — the scene is memoised
   *  once and a conifer has never carried an id. Absent/null ⇒ every node renders byte-identically
   *  to before this arc existed, which is what leaves the website's own mapper untouched. */
  vegetationLayer?: VegetationRenderLayer | null;
  /** Registered organic pose images planted into the canonical world painter order. */
  organicPoseLayers?: readonly OrganicPoseRenderLayer[] | null;
  /** The mounted 3D plants' click targets (`native-prop-targets.ts`), painted after the roads and
   *  before the flora layer — so a 3D crown wins over the ground and roads behind it, while the
   *  nameplates, signposts and wisps in the flora layer stay on top. Absent/null ⇒ nothing drawn. */
  nativePropTargetLayer?: NativePropTargetRenderLayer | null;
  /** INTERNAL (set by `SceneView` itself, never by TreeView): per-scene `baked-def` geometry bounds,
   *  so a `baked-use` hero (the ADR-0227 status trees, the garden cottage/gazebo) sizes from its real
   *  def geometry. Memoized once per scene in the component below. */
  defBounds?: ReadonlyMap<string, Bounds>;
}

/** Role → the studio's base class(es). Composed kinds (status / variant / focus) are
 *  handled in {@link composeClass}; a kind absent here (or mapped to '') renders an
 *  unclassed element (a structural `<g>`, or a child the studio styles via its group). */
const BASE = {
  world: '',
  'empties-layer': 'hex-coast',
  'coast-layer': 'hex-coastland',
  'ground-mesh': 'relaxed-land',
  'ground-hex': 'hex-land',
  // the ADR-0169 trail network: cased passes (shadow/casing/fill + under-island ghosts)
  // + the non-visual per-edge reveal metadata. Per-segment classes compose in
  // composeClass (spur dash, reveal state).
  'trails-layer': 'trail-net',
  'trail-shadow-pass': 'trail-shadow-pass',
  'trail-casing-pass': 'trail-casing-pass',
  'trail-fill-pass': 'trail-fill-pass',
  'trail-ghost-pass': 'trail-ghost-pass',
  'trail-edges': 'trail-edges',
  'trail-edge': 'trail-edge',
  'cave-apron': 'cave-apron',
  'cave-arch': 'cave-arch',
  'cave-rim': 'cave-rim',
  'flora-layer': '',
  'hits-layer': '',
  empty: 'hex-empty',
  'coast-shore': 'coast-fill',
  'cell-wheat': 'relaxed-cell is-wheat',
  'tile-side': 'hex-side',
  'tile-top-wheat': 'hex-top is-wheat',
  shadow: 'flora-shadow',
  trunk: 'story-trunk',
  'crown-lo': 'crown-lo',
  'crown-hi': 'crown-hi',
  bare: 'story-bare',
  litter: 'leaf-litter',
  'sign-blank': 'story-sign sign-blank',
  'sign-pass': 'story-sign sign-witnessed verdict-pass',
  'sign-fail': 'story-sign sign-witnessed verdict-fail',
  'sign-post': '',
  'sign-head': '',
  'flora-hit': 'flora-hit',
  'dead-ground': 'dead-ground',
  'flora-bed': 'flora-bed',
  'flora-dark': 'flora-dark',
  'flora-light': 'flora-light',
  'flora-core': 'flora-core',
  'flora-stem': 'flora-stem',
  'flora-dead-stem': 'flora-dead-stem',
  'flora-dead-head': 'flora-dead-head',
  'flora-dead-twig': 'flora-dead-twig',
  'sapling-trunk': 'sapling-trunk',
  conifer: 'hex-conifer',
  'conifer-snow': 'conifer-snow',
  wisps: '',
  // `wisp` composes its band from `phaseBand` in composeClass (band-red/green/building, ADR-0048
  // §3 v2); the BASE here is just the role class. (A composeClass case overrides this entry.)
  wisp: 'world-wisp',
  'wisp-hit': 'world-wisp-hit',
  'wisp-glow': 'world-wisp-glow',
  'wisp-dot': 'world-wisp-dot',
  // the story-CLAIM wisp (ADR-0138 §5): a DISTINCT class family from the build wisp — never a
  // proof class (the §5 honesty wall; since ADR-0529/0536 retired the verdict bloom the proof
  // vocabulary here is the island's `st-healthy` hue, which no wisp class can reach). `claim-wisp`
  // composes its colour-state in composeClass (state-authoring/proving/supplementing); the parts
  // reuse fixed classes.
  'claim-wisps': '',
  'claim-wisp': 'world-claim-wisp',
  'claim-wisp-hit': 'world-claim-wisp-hit',
  'claim-wisp-glow': 'world-claim-wisp-glow',
  'claim-wisp-dot': 'world-claim-wisp-dot',
  // the claim-GRADE families (ADR-0200 D7): `hover-wisp*` (an exploring claim at rest beside the
  // tree) and `queue-wisp*` (a waiting claim in the visible line) — DISTINCT class families from both
  // the build wisp AND the orbiting claim wisp, never a proof class (the §5 honesty wall). Each
  // composes its colour-state in composeClass exactly like `claim-wisp`; the parts below reuse fixed
  // classes. `departing-wisp*` (a released claim still fading, its own `departing-wisps` layer) is
  // stationary + colourless (a departure carries no colourState) — composeClass gives it a fixed base
  // class; the mapper folds its `ageRatio` to opacity (never a proof class either).
  'hover-wisp': 'world-hover-wisp',
  'hover-wisp-hit': 'world-hover-wisp-hit',
  'hover-wisp-glow': 'world-hover-wisp-glow',
  'hover-wisp-dot': 'world-hover-wisp-dot',
  'queue-wisp': 'world-queue-wisp',
  'queue-wisp-hit': 'world-queue-wisp-hit',
  'queue-wisp-glow': 'world-queue-wisp-glow',
  'queue-wisp-dot': 'world-queue-wisp-dot',
  'departing-wisps': '',
  'departing-wisp': 'world-departing-wisp',
  'departing-wisp-hit': 'world-departing-wisp-hit',
  'departing-wisp-glow': 'world-departing-wisp-glow',
  'departing-wisp-dot': 'world-departing-wisp-dot',
  plate: 'world-plate',
  'plate-bg': 'world-plate-bg',
  'plate-id': 'world-plate-id',
  'plate-sub': 'world-plate-sub',
  hit: 'world-story-hit',
  // the UAT markers (forest-parcels inc 2; tall flowers, grounded-art inc 7): one soft flat flower per
  // criterion scattered around the island (the standing-stones were rejected as noisy/colliding, #832;
  // owner call 2026-07-20). The wrapper kinds (`tall-flower-proven`/`-pending`/`-failing`) compose the
  // shared `.tall-flower-marker` base + their state class in composeClass below. The body child kinds
  // map verbatim; `shadow` reuses the flora-shadow map.
  'tall-flower-stem': 'tall-flower-stem',
  'tall-flower-leaf': 'tall-flower-leaf',
  'tall-flower-petal': 'tall-flower-petal',
  'tall-flower-center': 'tall-flower-center',
  'tall-flower-bud': 'tall-flower-bud',
  'tall-flower-glow': 'tall-flower-glow',
  // the cosy-island GARDEN's flat decorative accents (grounded-art inc 11) — lavender + grass tufts,
  // colour CSS-side like the tall-flower family (ADR-0093 §4). Decorative, no verdict.
  'garden-lavender-stem': 'garden-lavender-stem',
  'garden-lavender-head': 'garden-lavender-head',
  'garden-grass-blade': 'garden-grass-blade',
  // ADR-0218: the fenced baked-art family. `baked-defs` is the definition layer (rendered as
  // `<defs>`, non-rendering — no class); `baked-art` is a placement `<use>` (a stable hook, no colour
  // of its own — the paint is inside the referenced def).
  'baked-defs': '',
  'baked-art': 'baked-art',
} as const satisfies Partial<Record<SceneKind, string>>;

/**
 * One baked paint node (ADR-0218) as a native SVG element with RESOLVED paint inline. This is the one
 * place the studio mapper stamps `fill`/`stroke` from the scene rather than from a class, because a
 * bake's colour is material × N·L, not a category — the fenced exception. Mirrors the factory's own
 * SVG printer (`render-svg.ts`) element-for-element so a stone on the map and one on a contact sheet
 * cannot drift.
 */
function bakedEl(n: BakedPaintNode, key: React.Key): React.JSX.Element {
  const op = n.opacity !== undefined ? { opacity: n.opacity } : {};
  if (n.el === 'ellipse') {
    return React.createElement('ellipse', { key, cx: n.cx, cy: n.cy, rx: n.rx, ry: n.ry, fill: n.fill, ...op });
  }
  if (n.el === 'polygon') {
    return React.createElement('polygon', {
      key,
      points: n.points,
      fill: n.fill,
      stroke: n.stroke,
      strokeWidth: n.strokeWidth,
      strokeLinejoin: 'round',
      ...op,
    });
  }
  // path: a pierced wall (even-odd, filled) or a split fragment's inherited outline (unfilled,
  // round-capped so a short run does not read as a tick) — the render-svg.ts split.
  if (n.fillRule === 'evenodd') {
    return React.createElement('path', {
      key,
      d: n.d,
      fillRule: 'evenodd',
      fill: n.fill,
      stroke: n.stroke,
      strokeWidth: n.strokeWidth,
      strokeLinejoin: 'round',
      ...op,
    });
  }
  return React.createElement('path', {
    key,
    d: n.d,
    fill: 'none',
    stroke: n.stroke,
    strokeWidth: n.strokeWidth,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
    ...op,
  });
}

const fmt = (n: number): string => n.toFixed(1);

function withFilter(base: string, status: SceneStatus | undefined, ctx: SceneCtx): string {
  const s = status ?? 'unknown';
  return `${base} st-${s}${ctx.hidden.has(s) ? ' is-filtered' : ''}`;
}

/** ` arrive-island` on an arriving island's per-island groups (coast / ground / flora /
 *  tiles) — the CSS keyframes stage its formation. */
function arriveIsland(id: string, ctx: SceneCtx): string {
  return ctx.arrivalIds?.has(id) ? ' arrive-island' : '';
}

/** The draw-on suffix for a trail-segment path: trails are ALWAYS drawn now (owner
 *  2026-07-07); a segment growing on an island ARRIVAL wears `is-growing` so its mask
 *  owns the draw-on. Absent an arrival, every trail simply paints. */
function revealClass(node: SceneNode, ctx: SceneCtx): string {
  const seg = node.id ? ctx.reveal?.byId.get(node.id) : undefined;
  return seg ? ' is-growing' : '';
}

/** The full className for a node — the studio's class for the role, plus the folded
 *  status / variant and the focus-aware island/trail classes (mirroring TreeView). */
function composeClass(node: SceneNode, ctx: SceneCtx): string {
  const k = node.kind;
  if (!k) return '';
  const id = node.id ?? '';
  const status = node.status ?? 'unknown';
  switch (k) {
    case 'world':
      // no world-root focus dim any more — trails are always drawn, so there is no
      // click-reveal to settle the rest of the world beneath (owner 2026-07-07).
      return '';
    case 'territory':
      return `hex-flora ${ctx.territoryClassById(id, status)}${arriveIsland(id, ctx)}`;
    case 'coast':
      return `coast-fill-group ${ctx.territoryClassById(id, status)}${arriveIsland(id, ctx)}`;
    case 'ground':
      return `relaxed-tile ${ctx.territoryClassById(id, status)}${arriveIsland(id, ctx)}`;
    case 'tile':
      return `hex-tile ${ctx.territoryClassById(id, status)}${arriveIsland(id, ctx)}`;
    case 'trail-shadow':
    case 'trail-casing':
    case 'trail-ghost':
      return `${k}${revealClass(node, ctx)}`;
    case 'trail-fill':
      // a spur (usage 1) draws a dashed footpath fill; the reveal mask grows it safely
      // (a mask stroke, never a dash-offset on the dashed stroke itself).
      return `trail-fill${node.spur ? ' is-spur' : ''}${revealClass(node, ctx)}`;
    case 'cave':
      // the cave arch wears the island's shadow/side-wall hue family, keyed by the
      // folded island status the core stamped on the group (ADR-0169 §2).
      return `world-cave st-${status}`;
    case 'tree':
      return withFilter('story-tree', node.status, ctx);
    case 'flora':
      return withFilter('garden-flora', node.status, ctx);
    case 'cell': {
      // A parcels-present island (forest-parcels inc 1) now sets a PER-CELL status — each ground cell
      // tinted by its assigned capability — so fold it through as `st-<status>` (ZERO new ground CSS:
      // the existing per-status cell tint carries the colour). A plain (non-parcel) cell carries no
      // status → the class is unchanged `relaxed-cell v-N`.
      const cellBase = `relaxed-cell v-${node.variant ?? 0}`;
      return node.status ? `${cellBase} st-${node.status}` : cellBase;
    }
    case 'tile-top':
      return `hex-top v-${node.variant ?? 0}`;
    case 'conifer-body':
      return `conifer-body c-${node.variant ?? 0}`;
    case 'wisp':
      // ADR-0048 §3 v2: the wisp wears its live red→green band (the core already folded the gate
      // phase → phaseBand). Default to the neutral teal `building` band when none is known. ADR-0138
      // §5: when the work-event also stamped a subagent role, add a `role-<colourState>` tint
      // ALONGSIDE the band (advisory, back-compat — absent → the plain band look, unchanged).
      return `world-wisp band-${node.phaseBand ?? 'building'}${
        node.colourState ? ` role-${node.colourState}` : ''
      }`;
    case 'claim-wisp':
      // ADR-0138 §5: a claim wisp is its OWN class family, coloured by what the orchestrator is doing
      // on the claimed story. NEVER a proof class — a claim is not a proof (the honesty wall,
      // asserted in SceneView.test.tsx). `colourState` is always present on a claim wisp.
      // ADR-0212: when a build is live on this story, its red→green band rides the SAME body as a
      // `band-*` class ALONGSIDE the state class — the merged build wisp. The band is a MOTION
      // channel in CSS (never a hue), so it cannot push the body toward a proven green.
      return `world-claim-wisp state-${node.colourState ?? 'supplementing'}${
        node.phaseBand ? ` band-${node.phaseBand}` : ''
      }`;
    case 'hover-wisp':
      // ADR-0200 D7: the exploring-grade family — a DISTINCT class from claim-wisp/queue-wisp, same
      // colour-state composition, same honesty wall (never a proof class). Carries no band: window
      // shopping is by definition not building (ADR-0212 folds the band onto the work stage only).
      return `world-hover-wisp state-${node.colourState ?? 'supplementing'}`;
    case 'queue-wisp':
      // ADR-0200 D7: the waiting-grade family — a DISTINCT class from claim-wisp/hover-wisp, same
      // colour-state composition, same honesty wall (never a proof class).
      return `world-queue-wisp state-${node.colourState ?? 'supplementing'}`;
    case 'parcel':
      // forest-parcels inc 1: the transparent per-capability ground group (id=capId, title for hover).
      // It carries the cap's folded status so a group-level rule can key on it; the visible tint lives
      // on the cells inside (also `st-<status>`). Same-named base class + `st-<status>` (frozen vocab).
      return `parcel st-${status}`;
    case 'parcel-flora':
      // one placed flora item: its theme (meadow/woodland/heath → `theme-<t>`) + the cap's status +
      // `is-filtered` when the legend has hidden that status — `withFilter` composes the same suffix
      // `flora` gets, so a legend-filtered capability's land stops reading as unfiltered on the shipped
      // map (shipped-map-render-path-drops-three-delivered-behaviours defect 2). The colour itself
      // stays CSS-side (a parallel lane owns the parcel colour block) — the mapper only names the class
      // the theme + filter select.
      return withFilter(`parcel-flora theme-${node.theme ?? 'meadow'}`, node.status, ctx);
    case 'parcel-blade':
    case 'parcel-shrub':
    case 'parcel-stem':
    case 'parcel-flower':
      // the generic flora marks — same-named class + the `v-<n>` facet suffix (exactly like cells).
      return `${k} v-${node.variant ?? 0}`;
    case 'tall-flower-proven':
    case 'tall-flower-pending':
    case 'tall-flower-failing':
      // forest-parcels inc 2 (tall flowers, grounded-art inc 7): the marker wrapper — the shared
      // `.tall-flower-marker` base (pointer-events: none, the markers are display-only) + its state
      // class, the composite the CSS keys the petal/centre/glow colour off
      // (`.tall-flower-proven .tall-flower-petal`, etc.).
      return `tall-flower-marker ${k}`;
    default: {
      const base = BASE[k] ?? '';
      return node.accent && base ? `${base} flora-dead-accent` : base;
    }
  }
}

/**
 * The attribute bag a scene element accumulates before `React.createElement` stamps it onto an SVG
 * node — the presentation attributes React already names, plus every `data-*` stamp this renderer
 * writes.
 *
 * Named rather than `Record<string, unknown>` (anti-slop `no-known-value-widening`). The `data-*`
 * stamps are not decoration: `apps/desktop/e2e/node-click.e2e.mjs` selects through
 * `[data-story-id]`, the accretion and vegetation frames are read back by the scene tests, and the
 * lane stamps drive the trail CSS. Under an open dictionary a typo'd key was a silently missing
 * attribute that only an e2e run could catch; here it is a compile error at the assignment.
 */
interface SceneElementProps extends React.SVGProps<SVGElement> {
  'data-cap-id'?: string;
  'data-depth-slot'?: string | number;
  'data-edges'?: string | number;
  'data-from'?: string;
  'data-id'?: string;
  'data-island'?: string;
  'data-island-accretion-cell'?: string | number;
  'data-island-accretion-coast'?: string | number;
  'data-island-accretion-coast-cell'?: string | number;
  'data-island-accretion-order'?: string | number;
  'data-island-accretion-progress'?: string | number;
  'data-island-accretion-scale'?: string | number;
  'data-island-accretion-wave'?: string | number;
  'data-lane'?: string;
  'data-native-island-progress'?: string | number;
  'data-native-island-story'?: string;
  'data-organic-frame'?: string | number;
  'data-organic-track'?: string;
  'data-segments'?: string | number;
  'data-spur'?: string | number | boolean;
  'data-story-id'?: string;
  'data-to'?: string;
  'data-usage'?: string | number;
  'data-veg-frame'?: string | number;
  'data-veg-grown'?: string | number;
  'data-veg-track'?: string;
  'data-world-anchor-x'?: string | number;
  'data-world-anchor-y'?: string | number;
}

/** The studio's per-node handlers (it binds React handlers directly — no delegation):
 *  an island group hovers + selects its story; a plant selects its capability. */
function handlersFor(
  node: SceneNode,
  ctx: SceneCtx,
  storyId: string | undefined,
) {
  switch (node.kind) {
    case 'territory':
    case 'ground':
    case 'tile':
    // The generous per-story hit rect (`hit`) shares the island's hover+select: a click anywhere in
    // a story's region (crown, a gap between crown blobs, the moat margin around the island, or the
    // nameplate) selects it — restoring node-click at the zoomed-out contain fit (ADR #486).
    case 'hit': {
      const id = node.id ?? storyId;
      if (!id) return {};
      return {
        onClick: () => ctx.onSelectStory(id),
      } satisfies Record<string, unknown>;
    }
    case 'flora':
    // The shipped map's per-capability ground group (forest-parcels inc 1): carries the SAME capId a
    // `flora` node would, so it gets the SAME capability-select route
    // (shipped-map-render-path-drops-three-delivered-behaviours defect 3 — `parcel` retires `flora` on
    // a parcels island, but only `flora` wired `onSelectCap`, leaving the shipped map's only
    // capability-select route attached to a drawable it no longer draws).
    case 'parcel': {
      const capId = node.id;
      if (!capId || !storyId) return {};
      return {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          ctx.onSelectCap(storyId, capId);
        },
      } satisfies Record<string, unknown>;
    }
    default:
      return {};
  }
}

/**
 * Move the core's `hits-layer` (which `buildScene` appends LAST — painted on top, for the website's
 * delegation surface) to just behind the coast/ground/flora — directly after the empty moat. The
 * studio binds per-node React handlers instead, so its generous per-story hit rects must sit at the
 * BACK: there they catch a click on a story's crown / a gap between its crown blobs / the moat margin
 * around its island / its nameplate and SELECT the story (restoring node-click at the zoomed-out
 * `fit:'contain'` framing, #486), while the island tiles and the per-capability plants layered on top
 * still win their own clicks (the tiles re-select the same story; a plant selects its capability).
 */
function hitsLayerToBack(children: readonly SceneNode[]): readonly SceneNode[] {
  const hitsIdx = children.findIndex((c) => c.kind === 'hits-layer');
  if (hitsIdx < 0) return children;
  const out = [...children];
  const [hits] = out.splice(hitsIdx, 1);
  if (hits) out.splice(out.findIndex((c) => c.kind === 'empties-layer') + 1, 0, hits);
  return out;
}

/** The OPTIONAL projection stamp on an organic pose `<image>`. Absent ⇒ no attribute is emitted at
 *  all, which is what {@link OrganicPoseRenderLayer.projection} being absent has always meant. */
interface OrganicProjectionAttribute {
  'data-organic-projection'?: string;
}

function organicPoseImage(layer: OrganicPoseRenderLayer): React.ReactNode {
  // Anchored AT the ground socket (see `OrganicPoseRenderLayer.projection`): the anchor offset is
  // squashed by the same factor as the box, so the root contact never moves as the factor changes.
  // The arithmetic lives in `./land-camera.js` so the land-camera composition suite can assert
  // against the placement this renderer actually uses rather than against a copy of it.
  const { x, y, width, height } = organicLayerBox(layer);
  const projection: OrganicProjectionAttribute = {};
  if (layer.projection !== undefined) {
    projection['data-organic-projection'] = layer.projection.toFixed(2);
  }
  return React.createElement('image', {
    key: `__organic-pose-${layer.trackId}`,
    href: layer.src,
    x: fmt(x),
    y: fmt(y),
    width: fmt(width),
    height: fmt(height),
    preserveAspectRatio: 'none',
    imageRendering: 'pixelated',
    pointerEvents: 'none',
    'aria-hidden': true,
    'data-depth-slot': layer.depthSlot,
    'data-organic-track': layer.trackId,
    'data-organic-frame': String(layer.frameIndex),
    'data-world-anchor-x': fmt(layer.worldAnchor.x),
    'data-world-anchor-y': fmt(layer.worldAnchor.y),
    ...projection,
  });
}

/**
 * The semantic descendants a shared-track swap must NOT discard.
 *
 * `flora-hit` is a capability plant's generous click target — losing it would make plants selectable
 * only where their pixels are.
 *
 * ⚠ THE PROOF ENTRY IS GONE, AND ITS GUARANTEE RE-POINTED RATHER THAN DIED (ADR-0536 D6). This set
 * used to carry `bloom-anchor` under the rule "renderer choice may change artwork, it must never
 * erase proof semantics". ADR-0529 retired the verdict bloom, so that rule has no subject HERE: there
 * is no longer a per-landing proof mark composed onto a story tree for a track swap to discard. The
 * standing proof semantics a swap must not erase are the island's proven-green STATUS hue and the
 * legend's proof row — neither of which is a descendant of a swapped wrapper, so neither is reachable
 * by this mechanism at all. If a per-landing proof mark is ever drawn again it belongs back in here.
 */
const VEGETATION_PRESERVED_KINDS: ReadonlySet<string> = new Set(['flora-hit']);

function collectVegetationPreserved(node: SceneNode, out: SceneNode[]): void {
  if (node.el !== 'g') return;
  for (const child of node.children) {
    if (child.kind !== undefined && VEGETATION_PRESERVED_KINDS.has(child.kind)) out.push(child);
    else collectVegetationPreserved(child, out);
  }
}

/**
 * One frame of a shared growth track, drawn in the LOCAL coordinates of its object's ground anchor
 * (ADR-0292 D2/D4). The placement already pins the asset's registered ground contact to (0, 0), which
 * is the spot the scene put the object at — so a growing tree rises out of the ground rather than
 * expanding about its own middle, with no CSS `transform-origin` involved.
 *
 * `st-<status>` rides the IMAGE, not the wrapper: the per-status hue is a D3 variation channel the
 * stylesheet applies to this element alone, and putting it here keeps it off the `<g>` whose class is
 * already the island's own focus/filter composition.
 */
function vegetationTrackImage(
  render: Extract<VegetationRender, { kind: 'track' }>,
  key: React.Key,
): React.JSX.Element {
  const place = render.placement;
  const props: SceneElementProps = {
    key,
    href: place.src,
    x: fmt(place.x),
    y: fmt(place.y),
    width: fmt(place.width),
    height: fmt(place.height),
    preserveAspectRatio: 'none',
    imageRendering: 'pixelated',
    // HITTABLE, deliberately — and NOT `pointer-events: none` like the decorative organic-pose layer
    // this borrowed its shape from. An SVG `<g>` receives a pointer event only through a child that
    // was itself hit, so an inert image would leave the wrapper's handlers unreachable everywhere the
    // artwork covers. Worse, TreeView's Electron-safe selection is a COORDINATE hit-test
    // (`elementFromPoint(...).closest('[data-story-id]')`, the pointer-capture-retarget fix): an inert
    // tree lets that probe fall straight through the canopy to bare `<svg>` and select nothing. Caught
    // by `apps/desktop/e2e/node-click.e2e.mjs`, which is the wall built for exactly this bug class.
    // The vector bodies this replaces were all hittable; this restores that, it does not add reach.
    'aria-hidden': true,
    className: `veg-track veg-track-${render.role}${render.status ? ` st-${render.status}` : ''}`,
    'data-veg-track': place.trackId,
    'data-veg-frame': String(place.frameIndex),
    'data-veg-grown': render.grown.toFixed(4),
  };
  // Mirrored about the ground anchor (which the placement already made the local origin), so the
  // seeded flip cannot move where the tree stands.
  if (place.flipped) props.transform = 'scale(-1 1)';
  return React.createElement('image', props);
}

/**
 * A tree or capability plant rendered as its shared track's current frame.
 *
 * The wrapper survives verbatim — its class, its placement transform, its click handlers, its title,
 * its `data-*` stamps — because the track replaces the object's PIXELS, never its identity on the
 * map. That is also why this wins over {@link trySprite}: the sprite sheet is a default-off art-style
 * spike, while the shared track is the decided art for these two roles (ADR-0292 D2/D4); a sheet may
 * still cover every other kind.
 */
function vegetationTrackNode(
  node: SceneNode,
  key: React.Key,
  storyId: string | undefined,
  ctx: SceneCtx,
  render: Extract<VegetationRender, { kind: 'track' }>,
): React.JSX.Element {
  const props: SceneElementProps = { key, ...handlersFor(node, ctx, storyId) };
  const cls = composeClass(node, ctx);
  if (cls) props.className = cls;
  if (node.transform) props.transform = node.transform;
  if (node.kind === 'flora') {
    if (node.id) props['data-cap-id'] = node.id;
    if (storyId) props['data-story-id'] = storyId;
  } else if (storyId) {
    props['data-story-id'] = storyId;
  }
  const kids: React.ReactNode[] = [];
  if (node.title) kids.push(React.createElement('title', { key: '__title' }, node.title));
  const preserved: SceneNode[] = [];
  collectVegetationPreserved(node, preserved);
  kids.push(
    React.createElement(
      'g',
      { key: '__pop-motion-inner', className: 'pop-motion-inner' },
      ...preserved.map((child, index) => renderNode(child, `__preserved-${index}`, storyId, ctx)),
      vegetationTrackImage(render, '__veg-track'),
    ),
  );
  return React.createElement('g', props, ...kids);
}

/**
 * Write this frame's rooted growth onto a node, in whichever of the two forms its own placement
 * allows (see `VegetationRootMode`).
 *
 * With a placement transform, SVG's left-to-right composition does the work for free: `translate(x y)
 * [scale(s)] scale(g)` already scales about the ground anchor the scene put the object at. Without
 * one — the ADR-0226 parcel marks, which draw in island coordinates — a bare `scale(g)` would scale
 * about the WORLD ORIGIN and fling the mark in from the corner of the map, so the growth is written
 * as the `translate(p) scale(g) translate(-p)` triple instead, exactly as the land-cell accretion
 * above already does it.
 *
 * Either way there is no `transform-box`, no `transform-origin` and no stylesheet involved: the
 * rooted origin ADR-0292 D1 asks for is geometry, not CSS, so it cannot acquire a second clock.
 */
function vegetationRootedTransform(
  node: SceneNode,
  scale: number,
  origin: { readonly x: number; readonly y: number } | null,
): string {
  const s = scale.toFixed(4);
  const local = origin
    ? `translate(${fmt(origin.x)} ${fmt(origin.y)}) scale(${s}) translate(${fmt(-origin.x)} ${fmt(-origin.y)})`
    : `scale(${s})`;
  return node.transform ? `${node.transform} ${local}` : local;
}

/** The nameplate's settle: translate ONLY, never a scale (ADR-0292 D1 — a label that scales reads as
 *  a thing growing out of the soil, which it is not). */
function vegetationSettleTransform(node: SceneNode, dy: number): string {
  const local = `translate(0 ${dy.toFixed(2)})`;
  return node.transform ? `${node.transform} ${local}` : local;
}

function nativeIslandClipId(layer: NativeIslandGrowthRenderLayer): string {
  return `organic-pose-native-island-${layer.storyId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;
}

function nativeIslandClip(layer: NativeIslandGrowthRenderLayer): React.ReactNode {
  const progress = Math.max(0, Math.min(1, layer.progress));
  return React.createElement(
    'defs',
    { key: '__organic-native-island-defs' },
    React.createElement(
      'clipPath',
      {
        id: nativeIslandClipId(layer),
        clipPathUnits: 'userSpaceOnUse',
      },
      React.createElement('ellipse', {
        cx: fmt(layer.worldAnchor.x),
        cy: fmt(layer.worldAnchor.y),
        rx: fmt(Math.max(0.01, layer.radius.x * progress)),
        ry: fmt(Math.max(0.01, layer.radius.y * progress)),
        'data-native-island-progress': progress.toFixed(4),
      }),
    ),
  );
}

function svgIslandAccretionClipId(layer: SvgIslandAccretionState): string {
  return `svg-island-accretion-${layer.storyId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`;
}

function svgIslandAccretionClip(layer: SvgIslandAccretionState): React.ReactNode | null {
  if (layer.mature) return null;
  return React.createElement(
    'defs',
    { key: '__svg-island-accretion-defs' },
    React.createElement(
      'clipPath',
      {
        id: svgIslandAccretionClipId(layer),
        clipPathUnits: 'userSpaceOnUse',
      },
      ...layer.coastReveals.map((reveal) =>
        React.createElement('circle', {
          key: reveal.key,
          cx: fmt(reveal.centre.x),
          cy: fmt(reveal.centre.y),
          r: fmt(reveal.radius * reveal.scale),
          'data-island-accretion-coast-cell': reveal.key,
          'data-island-accretion-scale': reveal.scale.toFixed(4),
        }),
      ),
    ),
  );
}

/** One `<defs>` carrying a coast clip for every island still accreting in a forest regrow. */
function forestRegrowAccretionDefs(layer: ForestRegrowRenderLayer): React.ReactNode | null {
  const growing = [...layer.accretionByStory.values()].filter((state) => !state.mature);
  if (growing.length === 0) return null;
  return React.createElement(
    'defs',
    { key: '__forest-regrow-accretion-defs' },
    ...growing.map((state) =>
      React.createElement(
        'clipPath',
        {
          key: state.storyId,
          id: svgIslandAccretionClipId(state),
          clipPathUnits: 'userSpaceOnUse',
        },
        ...state.coastReveals.map((reveal) =>
          React.createElement('circle', {
            key: reveal.key,
            cx: fmt(reveal.centre.x),
            cy: fmt(reveal.centre.y),
            r: fmt(reveal.radius * reveal.scale),
            'data-island-accretion-coast-cell': reveal.key,
            'data-island-accretion-scale': reveal.scale.toFixed(4),
          }),
        ),
      ),
    ),
  );
}

/** The per-story layer groups a regrow makes absent together — an island is all of it or none. */
const REGROW_STORY_LAYER_KINDS: ReadonlySet<string> = new Set([
  'coast',
  'ground',
  'territory',
  'hit',
]);

/** The four painter passes that draw a named trail segment (see the same split in trailReveal). */
const REGROW_TRAIL_SEGMENT_KINDS: ReadonlySet<string> = new Set([
  'trail-shadow',
  'trail-casing',
  'trail-fill',
  'trail-ghost',
]);

/**
 * True when this node belongs to a story (or a road) the regrow has not reached yet.
 *
 * Absence is a SKIP, not a `display:none` class: an island that is not on the map yet costs no
 * DOM and no paint, which is what keeps the opening of the intro — where almost nothing has
 * landed — cheaper than the settled forest rather than the same price.
 */
function regrowHides(node: SceneNode, layer: ForestRegrowRenderLayer): boolean {
  if (node.id === undefined || node.kind === undefined) return false;
  if (REGROW_STORY_LAYER_KINDS.has(node.kind)) return layer.hiddenStoryIds.has(node.id);
  if (REGROW_TRAIL_SEGMENT_KINDS.has(node.kind)) return layer.hiddenSegmentIds.has(node.id);
  // ADR-0286: the pale coast, per island, on its own later schedule. An `empty` node only carries
  // an id when the scene attributed it, so an unattributed moat never matches and never hides.
  if (node.kind === 'empty') return layer.hiddenEmptyStoryIds.has(node.id);
  return false;
}

/**
 * The coast settlement clip for an accreting island — from the single-island semantic player or
 * from the many-island forest regrow. Both play the SAME Experiment 6 accretion; they differ only
 * in how many islands are in flight, so they resolve through one seam here rather than two
 * parallel render paths that could drift.
 */
function accretionCoastFor(node: SceneNode, ctx: SceneCtx): SvgIslandAccretionState | null {
  if (node.kind !== 'coast' || node.id === undefined) return null;
  const single = ctx.svgIslandAccretionLayer;
  if (single && !single.mature && single.storyId === node.id) return single;
  const many = ctx.forestRegrowLayer?.accretionByStory.get(node.id);
  return many && !many.mature ? many : null;
}

/**
 * The per-cell reveal for an accreting land cell, from either accretion source.
 *
 * Looked up by the cell's IDENTITY, never by its `d` string (ADR-0367). The byte key made the reveal
 * a hostage of the emitted geometry: reprint a polygon at a different precision — let alone angle the
 * land or swap the lattice — and the lookup missed in silence, leaving the cell un-transformed and the
 * failure looking like an easing bug. A cell with no identity resolves nothing, which is the honest
 * answer: the scene stamps one on every land cell it emits.
 */
function accretionCellFor(node: SceneNode, ctx: SceneCtx): SvgIslandAccretionCellReveal | null {
  if (node.el !== 'path' || (node.kind !== 'cell' && node.kind !== 'cell-wheat')) return null;
  const cellId = node.cellId;
  if (cellId === undefined) return null;
  const single = ctx.svgIslandAccretionLayer;
  if (single && !single.mature) {
    const reveal = single.cellById.get(cellId);
    if (reveal) return reveal;
  }
  return ctx.forestRegrowLayer?.cellRevealById.get(cellId) ?? null;
}

// ---------------------------------------------------------------------------
// the sprite art-style render mode (sprite-art-sheets spike, default-off)
// ---------------------------------------------------------------------------
//
// Every per-type factory (`buildTree`/`buildPlant`/`buildConifer`/the tall-flower marker/
// `gardenHeroUse`/`vegHeroTreeUse`) returns exactly ONE wrapper node whose own `transform` is its
// ground anchor. `resolveSprite` is a per-node lookup keyed by that wrapper's SEMANTIC kind (+ its
// folded status, when it carries one) — a hit swaps the wrapper for a single `<image>` positioned by
// `spritePlacement`, WITHOUT recursing into the wrapper's vector children (the sprite replaces the
// whole object, ADR sprite-art-sheets design rule 1); a miss falls through to today's vector render
// unchanged, so a sheet covering only SOME kinds still works everywhere else.

/**
 * The semantic descendants a sprite swap must NOT discard — a wrapper's ARTWORK, never the semantic
 * descendants the scene composed onto it for reasons the sprite sheet knows nothing about.
 * `sign-blank`/`sign-pass`/`sign-fail` is the PERSISTENT human-witness signpost (`buildSignpost`) —
 * the one with real verification weight, since it distinguishes an unwitnessed island from a
 * witnessed one at rest. `buildTree` splices it in as a direct sibling child alongside the
 * trunk/crown geometry a sprite swap discards (shipped-map-render-path-drops-three-delivered-
 * behaviours defect 1 — a human-witnessed proof and an unwitnessed one looked identical on the
 * shipped map, because only the transient bloom was preserved).
 *
 * ⚠ THE TRANSIENT PROOF ENTRY IS GONE, AND ITS GUARANTEE RE-POINTED RATHER THAN DIED (ADR-0536 D6).
 * `bloom-anchor` stood here — the transient signed-PASS bloom — under "renderer choice may change
 * artwork, it must never erase proof semantics". ADR-0529 retired that drawable, so there is no
 * per-landing proof mark for a sprite swap to erase. The standing proof semantics are the island's
 * proven-green STATUS hue and the legend's proof row; a sprite swap replaces a wrapper's ARTWORK and
 * touches neither, so the guarantee is now kept by construction rather than by this list. The
 * PERSISTENT witness seal below is what still needs the list, and that is unchanged.
 */
const PRESERVED_SPRITE_DESCENDANT_KINDS: ReadonlySet<string> = new Set([
  'sign-blank',
  'sign-pass',
  'sign-fail',
]);

/**
 * Collect the preserved descendants a sprite swap must not drop (a shallow per-`g` walk, stopping at
 * the first preserved kind found along each branch — none of {@link PRESERVED_SPRITE_DESCENDANT_KINDS}
 * ever nests another) so the caller can render them ALONGSIDE the sprite `<image>` instead of silently
 * dropping them.
 */
function collectPreservedDescendants(node: SceneNode, out: SceneNode[]): void {
  if (node.el !== 'g') return;
  for (const child of node.children) {
    if (child.kind !== undefined && PRESERVED_SPRITE_DESCENDANT_KINDS.has(child.kind)) {
      out.push(child);
    } else {
      collectPreservedDescendants(child, out);
    }
  }
}

/**
 * Render `node` as a sprite `<image>` when `ctx.spriteSheet` covers its key — `null` when there is no
 * sheet, no usable key, or the sheet doesn't cover this node (the caller falls through to vector). The
 * image is positioned by {@link spritePlacement} and carries the wrapper's OWN `transform` untouched
 * (the object's existing ground anchor / scale), so nothing about WHERE the object sits changes — only
 * what draws there. Interactivity (the click handlers + delegation `data-*` hooks a vector `flora` node
 * would carry) is preserved so a sprite-swapped capability plant stays clickable. Text/tooltips/a11y
 * stay in the DOM: a `title` rides along as an accessible `<title>` child of the `<image>`, exactly as
 * the vector path does. Semantic descendants the replaced node owned (the human-witness signpost) are
 * preserved as vector siblings of the image — see {@link collectPreservedDescendants}; renderer choice
 * may change artwork, it must never erase witness semantics.
 */
function trySprite(
  node: SceneNode,
  key: React.Key,
  storyId: string | undefined,
  ctx: SceneCtx,
  veg?: VegetationRender | undefined,
): React.JSX.Element | null {
  const sheet = ctx.spriteSheet;
  if (!sheet) return null;
  const sk = spriteKeyFor(node);
  if (!sk) return null;
  const def = resolveSprite(sheet, sk.kind, sk.status);
  if (!def) return null;
  // DERIVED sizing (owner verdict 2026-07-23 "way too big"): fit the sprite into the content box of
  // the vector body it replaces — sprites inherit the scene's data-driven size semantics (sapling vs
  // hero, per-island veg scale) instead of stamping at the manifest's native box. `artScale` is the
  // world-settings taste dial; an unmeasurable body falls back to the native box.
  const place = fitSpritePlacement(def, wrapperContentBounds(node, ctx.defBounds), ctx.artScale ?? 1);
  const props: SceneElementProps = {
    key,
    href: def.href,
    x: fmt(place.x),
    y: fmt(place.y),
    width: fmt(place.width),
    height: fmt(place.height),
    ...handlersFor(node, ctx, storyId),
  };
  if (node.transform) props.transform = node.transform;
  // ADR-0292: per-object growth has to survive the sprite swap. The Storybook sheet is the shipped
  // default, so on the real map the UAT flowers (and anything else the sheet covers) arrive here
  // rather than through the generic path below — and a sprite that ignored the rooted transform would
  // simply not grow. Applied to the SAME element the placement rides, so the root stays pinned.
  if (veg?.kind === 'rooted') {
    props.transform = vegetationRootedTransform(node, veg.scale, veg.origin);
    props.opacity = Number(veg.opacity.toFixed(3));
    props['data-veg-grown'] = veg.grown.toFixed(4);
  } else if (veg?.kind === 'settle') {
    props.transform = vegetationSettleTransform(node, veg.dy);
    props.opacity = Number(veg.opacity.toFixed(3));
    props['data-veg-grown'] = veg.grown.toFixed(4);
  }
  // The sprite replaces the wrapper's pixels, not its semantic DOM identity. Keep the same class hooks
  // the vector wrapper carried (`story-tree`, `baked-art`, etc.) so coordinate hit-testing and downstream
  // interaction tooling still recognise the object after a default sheet is enabled.
  const cls = composeClass(node, ctx);
  if (cls) props.className = cls;
  if (node.kind === 'flora') {
    if (node.id) props['data-cap-id'] = node.id;
    if (storyId) props['data-story-id'] = storyId;
  } else if (storyId) {
    // TreeView's Electron-safe jittered-click path resolves the release coordinate through this stamp.
    // A clean click still bubbles to the enclosing territory handler; both routes must survive the swap.
    props['data-story-id'] = storyId;
  }
  const kids: React.ReactNode[] = [];
  if (node.title) kids.push(React.createElement('title', { key: '__title' }, node.title));
  const image = React.createElement('image', props, ...kids);

  const preserved: SceneNode[] = [];
  collectPreservedDescendants(node, preserved);
  if (preserved.length === 0) return image;
  return React.createElement(
    React.Fragment,
    { key },
    image,
    ...preserved.map((preservedNode, index) =>
      renderNode(preservedNode, `__preserved-${index}`, storyId, ctx),
    ),
  );
}

/** The lit lane is ONE EDGE WIDE — capped at the width of a usage-1 road — and never more
 *  than this fraction of the road it rides, so even a spur keeps a rim. */
const LIT_LANE_CAP = trailFillWidth(1);
const LIT_LANE_FRACTION = 0.8;

/**
 * The lane width for a segment of the given usage. ALWAYS narrower than
 * `trailFillWidth(usage)`, which is what keeps the merge honest — but the interesting half
 * is the CAP: a lane never grows past the width of a single-edge road, so on a trunk it
 * reads as exactly what it is, one edge's worth of traffic inside a road that carries many.
 * Live trunks on the real forest run to ~11 units wide; a constant inset off that leaves a
 * hairline rim and the lane just reads as a recolour, which is what the cap fixes. A
 * usage-1 spur — a road that really is the selection's alone — is lit nearly edge to edge.
 */
export function litLaneWidth(usage: number): number {
  return Math.min(LIT_LANE_CAP, trailFillWidth(usage) * LIT_LANE_FRACTION);
}

/**
 * The factor the 2D drawing strokes a road at, read off the road itself (ADR-0528): the scene's
 * `trail-fill` stroke is `trailFillWidth(usage) × TileArt.trailStroke`, and the lane rides that
 * road, so it must wear the same factor — the lane rule above is stated in the ONE width rule's own
 * units and would otherwise draw WIDER than the road it lights on the derived tile.
 */
function roadStrokeFactor(child: SceneNode): number {
  const usage = child.usage ?? 1;
  const rule = trailFillWidth(usage);
  return child.strokeWidth !== undefined && rule > 0 ? child.strokeWidth / rule : 1;
}

/**
 * The ADR-0242 lit-lane overlay for the trail-fill pass: one extra `trail-lit` path per
 * segment the selection's own edges run through, drawn AFTER every fill so the lanes sit
 * on top of the whole road network rather than under a later trunk. A lane inherits the
 * arrival draw-on mask when its segment is growing, so an arriving island's new lit road
 * still draws on rather than snapping in. Empty (no extra nodes at all) when nothing is
 * selected — the pass is then byte-identical to before this existed.
 */
function litLaneNodes(children: readonly SceneNode[], ctx: SceneCtx): React.JSX.Element[] {
  // A laid-out layout supersedes the per-segment pass entirely (see litRouteLanes).
  if (ctx.lanes && ctx.lanes.lanes.length > 0) return litRouteLanes(ctx);
  const plan = ctx.neighbours;
  if (!plan || plan.litSegments.size === 0) return [];
  const lanes: React.JSX.Element[] = [];
  for (const child of children) {
    if (child.el !== 'path' || !child.id || !plan.litSegments.has(child.id)) continue;
    const props: SceneElementProps = {
      key: `lit-${child.id}`,
      className: 'trail-lit',
      d: child.d,
      'data-id': child.id,
      strokeWidth: litLaneWidth(child.usage ?? 1) * roadStrokeFactor(child),
    };
    if (ctx.reveal?.byId.get(child.id)) props.mask = `url(#trail-m-${child.id})`;
    lanes.push(React.createElement('path', props));
  }
  return lanes;
}

/** World units a lane's draw-on covers per second. Calibrated against the LIVE forest, where
 *  a one-hop route runs roughly 200–3700 units (median ~2500): fast enough that a long haul
 *  still lands inside a second, slow enough that the travel is legible rather than a flash.
 *  Getting this wrong is not cosmetic — a speed tuned for a small map pins every route to
 *  the ceiling clamp, which silently un-does the one-speed property this exists for. */
const LANE_DRAW_SPEED = 3400;
/** Seconds a lane takes to draw on — its own length at a fixed speed, so a short spur really
 *  is quicker than a long haul instead of every route taking the same time. Clamped at both
 *  ends so a stub still registers and the longest route stays brisk. */
export function laneDrawSeconds(length: number): number {
  return Math.max(0.28, Math.min(1.2, 0.15 + length / LANE_DRAW_SPEED));
}

/**
 * The lanes of a laid-out selection: ONE path per route, island to island, plus a roundabout
 * island under each junction the layout named.
 *
 * Why this replaces the per-segment pass rather than extending it: a segment is an artefact
 * of the routing merge and invisible to a reader, so a lane drawn per segment shows its
 * seams — the offset steps sideways at a junction, and a per-segment draw-on appears to
 * start fresh at every one instead of travelling from an island. Both were reported. A route
 * is one path, so it has no seams to show.
 *
 * `.is-drawing` opts each lane into the one-shot growth (its own duration, via a custom
 * property so the CSS owns the curve); the class is absent when the caller wants the quiet
 * resting state, and `prefers-reduced-motion` kills it regardless.
 */
function litRouteLanes(ctx: SceneCtx): React.JSX.Element[] {
  const layout = ctx.lanes;
  if (!layout) return [];
  const out: React.JSX.Element[] = [];
  for (const hub of layout.hubs) {
    out.push(
      React.createElement('circle', {
        key: `hub-${hub.x.toFixed(1)}-${hub.y.toFixed(1)}`,
        className: 'trail-lane-hub',
        cx: hub.x,
        cy: hub.y,
        r: Number((hub.r * 0.45).toFixed(2)),
      }),
    );
  }
  for (const lane of layout.lanes) {
    const props: SceneElementProps = {
      key: `lane-${lane.key}`,
      className: `trail-lane dir-${lane.dir}${ctx.laneMotion === 'march' ? ' is-marching' : ''}${
        ctx.laneMotion === 'draw' ? ' is-drawing' : ''
      }`,
      d: lane.d,
      'data-lane': lane.key,
      strokeWidth: lane.width,
    };
    if (ctx.laneMotion === 'draw') {
      // normalise the run so the growth is length-agnostic (no dash PERIOD to outrun a short
      // route), and hand the CSS this lane's own duration so all lanes travel at one speed
      props.pathLength = 1;
      props.style = { ['--lane-draw' as string]: `${laneDrawSeconds(lane.length).toFixed(2)}s` };
    }
    out.push(React.createElement('path', props));
  }
  return out;
}

function renderNode(
  node: SceneNode,
  key: React.Key,
  storyId: string | undefined,
  ctx: SceneCtx,
): React.JSX.Element | null {
  // Checked FIRST, ahead of the sprite swap: a story the regrow has not reached yet must not draw
  // a sprite either.
  if (ctx.forestRegrowLayer && regrowHides(node, ctx.forestRegrowLayer)) return null;
  // ADR-0292: a tree or a capability plant IS a frame of its shared track now, so this is resolved
  // ahead of the sprite swap and ahead of the baked-art path — the shipped central tree arrives here
  // as a `baked-use` (`vegHeroTreeUse`), and rendering it as a `<use>` first would draw the object
  // twice.
  const veg = ctx.vegetationLayer?.byNode.get(node);
  if (veg?.kind === 'track') return vegetationTrackNode(node, key, storyId, ctx, veg);
  if (ctx.spriteSheet) {
    const sprite = trySprite(node, key, storyId, ctx, veg);
    if (sprite) return sprite;
  }
  // ADR-0218: the fenced baked-art family renders outside the generic path. A `baked-def` becomes the
  // referenced `<g id>` holding the resolved-paint drawables; a `baked-use` becomes a `<use>` of it.
  if (node.el === 'baked-def') {
    return React.createElement('g', { key, id: node.defId }, ...node.nodes.map((n, i) => bakedEl(n, i)));
  }
  if (node.el === 'baked-use') {
    const useProps: SceneElementProps = { key, href: `#${node.defId}` };
    if (node.transform) useProps.transform = node.transform;
    const useCls = composeClass(node, ctx);
    if (useCls) useProps.className = useCls;
    return React.createElement('use', useProps);
  }

  const props: SceneElementProps = { key, ...handlersFor(node, ctx, storyId) };
  const cls = composeClass(node, ctx);
  if (cls) props.className = cls;
  if (node.transform) props.transform = node.transform;
  if (node.opacity != null) props.opacity = node.opacity;
  if (node.strokeWidth != null) props.strokeWidth = node.strokeWidth;
  // ADR-0292 D1: the vector half of per-object growth. A conifer / UAT flower / parcel-flora sprouts
  // from its own ground anchor; the nameplate only slides. Both are absent from the layer once they
  // are at rest, so a settled island's DOM carries nothing this arc added (D6) — no leftover
  // `scale(1)`, and therefore nothing for a later frame to have to re-write.
  if (veg?.kind === 'rooted') {
    props.transform = vegetationRootedTransform(node, veg.scale, veg.origin);
    props.opacity = Number(((node.opacity ?? 1) * veg.opacity).toFixed(3));
    props['data-veg-grown'] = veg.grown.toFixed(4);
  } else if (veg?.kind === 'settle') {
    props.transform = vegetationSettleTransform(node, veg.dy);
    props.opacity = Number(((node.opacity ?? 1) * veg.opacity).toFixed(3));
    props['data-veg-grown'] = veg.grown.toFixed(4);
  }
  const nativeIsland = ctx.nativeIslandGrowthLayer;
  if (
    nativeIsland &&
    (node.kind === 'coast' || node.kind === 'ground') &&
    node.id === nativeIsland.storyId
  ) {
    props.clipPath = `url(#${nativeIslandClipId(nativeIsland)})`;
    props['data-native-island-story'] = nativeIsland.storyId;
    props['data-native-island-progress'] = nativeIsland.progress.toFixed(4);
  }
  // The connected Experiment 6 accretion — the island's coast surfaces behind a growing clip while
  // its land cells scale up in adjacency waves. One island (the semantic player) or many at once
  // (the Act 2 forest regrow) resolve through the same pair of seams, so the two never drift.
  const coastAccretion = accretionCoastFor(node, ctx);
  if (coastAccretion) {
    props.clipPath = `url(#${svgIslandAccretionClipId(coastAccretion)})`;
    props['data-island-accretion-coast'] = coastAccretion.storyId;
    props['data-island-accretion-progress'] = coastAccretion.progress.toFixed(4);
  } else {
    const reveal = accretionCellFor(node, ctx);
    if (reveal) {
      const local = [
        `translate(${fmt(reveal.centroid.x)} ${fmt(reveal.centroid.y)})`,
        `scale(${reveal.scale.toFixed(4)})`,
        `translate(${fmt(-reveal.centroid.x)} ${fmt(-reveal.centroid.y)})`,
      ].join(' ');
      props.transform = node.transform ? `${node.transform} ${local}` : local;
      props['data-island-accretion-cell'] = reveal.key;
      props['data-island-accretion-wave'] = String(reveal.wave);
      props['data-island-accretion-order'] = String(reveal.order);
      props['data-island-accretion-scale'] = reveal.scale.toFixed(4);
    }
  }
  // Trail-segment paths (ADR-0169): stamp the reveal hooks into the DOM
  // (data-id/usage/edges/spur) and, when the focus plan names the segment, attach its
  // per-segment growth mask + step the stroke width from the REVEALED edge count (§3
  // multi-reveal width step-up — only the revealed edges are visible, so the width
  // reflects what the reveal shows, not the global usage).
  if (
    node.kind === 'trail-shadow' ||
    node.kind === 'trail-casing' ||
    node.kind === 'trail-fill' ||
    node.kind === 'trail-ghost'
  ) {
    if (node.id) props['data-id'] = node.id;
    if (node.usage != null) props['data-usage'] = node.usage;
    if (node.edges) props['data-edges'] = node.edges;
    if (node.spur) props['data-spur'] = 'true';
    const seg = node.id ? ctx.reveal?.byId.get(node.id) : undefined;
    if (seg) {
      props.mask = `url(#trail-m-${node.id})`;
      const widen =
        node.kind === 'trail-shadow' ? 5 : node.kind === 'trail-casing' ? 2.5 : 0;
      props.strokeWidth = trailFillWidth(seg.revealedUsage) + widen;
    }
  } else if (node.kind === 'trail-edge') {
    // the non-visual per-edge reveal metadata (from/to/ordered segment chain).
    if (node.from) props['data-from'] = node.from;
    if (node.to) props['data-to'] = node.to;
    if (node.segments) props['data-segments'] = node.segments;
  } else if (node.kind === 'cave') {
    if (node.island) props['data-island'] = node.island;
    if (node.edges) props['data-edges'] = node.edges;
  }
  if (
    node.kind === 'flora-hit' ||
    node.kind === 'wisp-hit' ||
    node.kind === 'claim-wisp-hit' ||
    node.kind === 'hover-wisp-hit' ||
    node.kind === 'queue-wisp-hit' ||
    node.kind === 'departing-wisp-hit' ||
    node.kind === 'hit'
  )
    props.fill = 'transparent';
  // ADR-0200 D7: a departing claim's fade is DATA (ageRatio, the core's job to place; the mapper's job
  // to turn it into opacity — deterministic, testable, never a CSS-only illusion). `1 - ageRatio`: a
  // just-released wisp (ageRatio 0) starts fully visible and fades to transparent as it ages out.
  if (node.kind === 'departing-wisp' && node.ageRatio != null) {
    props.opacity = Number((1 - node.ageRatio).toFixed(2));
  }
  // Stamp ids into the DOM so TreeView can select by COORDINATE hit-test (robust where the bubbled
  // `click` event is not — Electron retargets a captured click; a moved click can target a non-leaf
  // common ancestor). The per-node onClick above still drives the clean case.
  if (node.kind === 'territory' || node.kind === 'ground' || node.kind === 'tile' || node.kind === 'hit') {
    if (node.id) props['data-story-id'] = node.id;
  } else if (node.kind === 'flora') {
    if (node.id) props['data-cap-id'] = node.id;
    if (storyId) props['data-story-id'] = storyId;
  }

  switch (node.el) {
    case 'circle':
      props.cx = fmt(node.cx);
      props.cy = fmt(node.cy);
      props.r = fmt(node.r);
      break;
    case 'ellipse':
      props.cx = fmt(node.cx);
      props.cy = fmt(node.cy);
      props.rx = fmt(node.rx);
      props.ry = fmt(node.ry);
      break;
    case 'rect':
      props.x = fmt(node.x);
      props.y = fmt(node.y);
      props.width = fmt(node.width);
      props.height = fmt(node.height);
      props.rx = fmt(node.rx);
      break;
    case 'path':
      props.d = node.d;
      break;
    case 'polygon':
      props.points = node.points;
      break;
    case 'text':
      props.x = fmt(node.x);
      props.y = fmt(node.y);
      props.textAnchor = node.anchor;
      break;
    case 'g':
      break;
  }

  const kids: React.ReactNode[] = [];
  if (node.title) kids.push(React.createElement('title', { key: '__title' }, node.title));
  // Every orbiting wisp family rotates by its `phase` (geometry, seeded by runId / claim key). Since
  // ADR-0212 that includes `hover-wisp` — window shopping now spins on a small local orbit (which
  // REVERSES ADR-0200 D7's stationary rule on purpose; a future reader finding a spinning hover wisp
  // should land on ADR-0212, not file a bug). The legacy `wisp` kind stays until increment 3.
  //
  // ⚠ The rotate REPLACES the `transform` attribute on the node it animates, which is why the core
  // never puts a rest-spot translate on a rotated node — the hover family's rest spot lives on its
  // PARENT `g` and its orbit radius on a CHILD `g`. Flatten that nesting and the dot sweeps the
  // island centroid instead of its own rest spot.
  //
  // SPEED is the ADR-0212 motion channel: a claim body with a live build band orbits at the build
  // wisp's old 6s (active), an idle-claimed body keeps the calmer 9s, and window shopping drifts
  // slowest of all — so stage and activity read apart in motion as well as position.
  if (
    (node.kind === 'wisp' || node.kind === 'claim-wisp' || node.kind === 'hover-wisp') &&
    node.phase != null
  ) {
    const dur =
      node.kind === 'hover-wisp'
        ? '14s'
        : node.kind === 'claim-wisp'
          ? node.phaseBand
            ? '6s'
            : '9s'
          : '6s';
    kids.push(
      React.createElement('animateTransform', {
        key: '__spin',
        attributeName: 'transform',
        type: 'rotate',
        from: `${fmt(node.phase)} 0 0`,
        to: `${fmt(node.phase + 360)} 0 0`,
        dur,
        repeatCount: 'indefinite',
      }),
    );
  }
  if (node.el === 'g') {
    // `ground` carries the island's own id (`buildGround`) the SAME way `territory` does, but sits in
    // a SEPARATE top-level layer (`ground-mesh`, never nested under a `territory` group) — so without
    // this, a `parcel` node (a `ground` child, forest-parcels inc 1) reached `handlersFor` with
    // `storyId` still `undefined` and its `onSelectCap` handler was a permanent no-op regardless of the
    // capId it carried (shipped-map-render-path-drops-three-delivered-behaviours defect 3).
    const childStory = node.kind === 'territory' || node.kind === 'ground' ? node.id : storyId;
    // At the world root, sink the hit layer to the back so its rects catch clicks without covering
    // the island tiles / plants on top (see hitsLayerToBack).
    const children = node.kind === 'world' ? hitsLayerToBack(node.children) : node.children;
    const rendered: React.ReactNode[] = [];
    if (node.kind === 'world' && ctx.nativeIslandGrowthLayer) {
      rendered.push(nativeIslandClip(ctx.nativeIslandGrowthLayer));
    }
    if (node.kind === 'world' && ctx.svgIslandAccretionLayer) {
      rendered.push(svgIslandAccretionClip(ctx.svgIslandAccretionLayer));
    }
    if (node.kind === 'world' && ctx.forestRegrowLayer) {
      const defs = forestRegrowAccretionDefs(ctx.forestRegrowLayer);
      if (defs) rendered.push(defs);
    }
    children.forEach((c, i) => {
      const el = renderNode(c, i, childStory, ctx);
      if (el) rendered.push(el);
      if (node.kind === 'world' && c.kind === 'trails-layer' && ctx.organicPoseLayers) {
        rendered.push(...ctx.organicPoseLayers.map(organicPoseImage));
      }
      if (node.kind === 'world' && c.kind === 'trails-layer' && ctx.nativePropTargetLayer) {
        rendered.push(nativePropTargetGroup(ctx.nativePropTargetLayer, ctx));
      }
    });
    if (node.kind === 'tree' || node.kind === 'flora' || node.kind === 'plate') {
      // Motion-safe inner wrapper (semantic-growth.css `arrive-pop`): `tree`/`flora`/`plate` are
      // the mapper-POSITIONED wrappers above — the `if (node.transform) props.transform =
      // node.transform;` line above already stamped this node's own SVG placement `transform`
      // (its ground/root anchor). A CSS `arrive-pop` sweep must never bind to THIS class directly
      // (the full `transform` shorthand would replace that placement attribute for the sweep's
      // duration): binding the scale sweep to this dedicated INNER `<g class="pop-motion-inner">`
      // instead keeps the outer placement wrapper's transform attribute completely static while
      // the sweep still scales everything the outer wrapper draws. Named WITHOUT "arrive" so it
      // never collides with the unrelated island-arrival `.arrive-island` staging class (a plain
      // `[class*="arrive"]` selector elsewhere must still find zero matches on a steady-state
      // board with no island arriving).
      kids.push(
        React.createElement('g', { key: '__pop-motion-inner', className: 'pop-motion-inner' }, ...rendered),
      );
    } else {
      kids.push(...rendered);
    }
    // ADR-0242: the selection's lit lanes ride on top of the finished fill pass.
    if (node.kind === 'trail-fill-pass') kids.push(...litLaneNodes(children, ctx));
  } else if (node.el === 'text') {
    kids.push(node.text);
  }

  // The baked-art DEFINITION layer is a non-rendering `<defs>` (its children are referenced by
  // `<use>`, ADR-0218); every other node keeps its own element name.
  const elName = node.el === 'g' && node.kind === 'baked-defs' ? 'defs' : node.el;
  return React.createElement(elName, props, ...kids);
}

/**
 * The native plants' targets as transparent, HITTABLE rects: `fill="transparent"` is painted for
 * `pointer-events: visiblePainted`, so each one is found by the host's coordinate hit-test and by a
 * clean click alike. Each carries the ids that hit-test reads, and its own click selects the
 * capability through the same `onSelectCap` route a parcel uses.
 */
function nativePropTargetGroup(layer: NativePropTargetRenderLayer, ctx: SceneCtx): React.ReactNode {
  const rects = nativePropTargetRects(layer, {
    hiddenStoryIds: ctx.forestRegrowLayer?.hiddenStoryIds ?? null,
    hiddenStatuses: ctx.hidden,
  });
  return React.createElement(
    'g',
    { key: '__native-prop-targets', className: 'native-prop-targets', 'aria-hidden': true },
    ...rects.map((rect) =>
      React.createElement('rect', {
        key: rect.key,
        className: rect.className,
        x: fmt(rect.x),
        y: fmt(rect.y),
        width: fmt(rect.width),
        height: fmt(rect.height),
        fill: 'transparent',
        'data-story-id': rect.storyId,
        'data-cap-id': rect.capabilityId,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          ctx.onSelectCap(rect.storyId, rect.capabilityId);
        },
      }),
    ),
  );
}

/**
 * Render a scene tree as React SVG. The root is the core's offset `world` group; the
 * caller supplies the `<svg>` shell + `<defs>` and layers any studio-only chrome
 * (solar spokes, the Shared-Islands panel, building stamps) ON TOP.
 *
 * `React.memo` is LOAD-BEARING (ADR-0069, kept explicitly by ADR-0272 / memory
 * `studio-map-svg-scaling-wall`): a pointermove pans by updating the camera state on the parent, which
 * re-renders TreeView. The scene subtree does not depend on the camera, so as long as the caller hands
 * `scene` and `ctx` STABLE identities across a pan (TreeView memoises both), memo bails out here and the
 * ~O(nodes) React walk is skipped. Keep this wrapped — it is real work and still required.
 *
 * What it is NOT is the pan lag the owner feels. That attribution was carried here for a year and
 * ADR-0272 measured it away: a gesture frame costs 283 ms WITH the React walk against 275 ms for the
 * bare `<g>` attribute write, so this walk is ~3% of the frame. The other ~99.8% is rasterisation —
 * writing `transform` on an SVG `<g>` invalidates the paint artifact for the whole subtree, and an SVG
 * child gets no composited layer, so all ~14k paths re-raster every frame. The remedy is ADR-0272
 * decision 2 (pan rides a compositor-only CSS transform on an HTML wrapper, committed back to the `<g>`
 * on release), not this memo. Skipping this walk is worth its ~3%; do not read it as the fix.
 */
export const SceneView = React.memo(function SceneView({
  scene,
  ctx,
}: {
  scene: SceneNode;
  ctx: SceneCtx;
}): React.JSX.Element {
  // Sprite mode only: precompute every `baked-def`'s geometry bounds once per scene so trySprite can
  // size a `baked-use` hero from its real def (see sprite-sizing.ts). Inert (null) in vector mode.
  const defBounds = React.useMemo(
    () => (ctx.spriteSheet ? collectDefBounds(scene) : null),
    [scene, ctx.spriteSheet],
  );
  const walkCtx = defBounds ? { ...ctx, defBounds } : ctx;
  // The scene root (the `world` group) always renders — only the hit layer is skipped.
  return renderNode(scene, 'scene', undefined, walkCtx) ?? <g />;
});
