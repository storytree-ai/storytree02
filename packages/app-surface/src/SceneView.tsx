// SceneView — the studio's thin React MAPPER over the shared scene-graph (ADR-0093, strategy C). It
// walks the framework-agnostic `SceneNode` tree from `@storytree/forest-world` and emits native React
// SVG elements with the STUDIO's own class names and its per-node click handlers (keyed on the node
// id) — NOT `innerHTML` + event delegation.
//
// ⚠⚠ SINCE ADR-0608 THIS IS THE MAP'S INTERACTION LAYER, NOT ITS PICTURE. The mounted 3D land draws
// the forest — ground, coast, trees, coverage plants, UAT flowers, roads — from the SAME scene this
// file walks. What this layer still draws is what a member acts through or reads: nameplates and
// their status words, the session wisps, the per-story hit regions and the per-capability ground hit
// geometry, the 3D plants' click targets, the cave route marks, and the selection feedback (the lit
// one-hop lanes and the shore rings of the selected island and its neighbours). The flat picture —
// painted island fills, hex tiles and the empty board, hero trees, flat vegetation and flower marks,
// flat roads, and the sprite / growth-track / accretion animation of them — was REMOVED (ADR-0608 D2,
// D3), not hidden: those scene kinds are skipped here and their paint paths no longer exist.
//
// The scene itself is unchanged: the 3D mapper reads the very same kinds this walk now skips, so the
// skip is a statement about which layer draws a kind, never about what the scene contains.

import React from 'react';
import { trailFillWidth, type SceneKind, type SceneNode } from '@storytree/forest-world';
import type { NeighbourHighlightPlan } from './neighbourHighlight.js';
import type { LaneLayout } from './laneLayout.js';
import { nativePropTargetRects, type NativePropTargetRenderLayer } from './native-prop-targets.js';

/**
 * The Act 2 intro's whole-forest regrow (ADR-0282 D1) as this layer sees it: which stories and roads
 * are not on the map yet. The growth itself is drawn by the 3D layer on the same app-owned cursor;
 * this layer only withholds the nameplates, hit regions and lanes of islands that have not arrived.
 *
 * Absent ⇒ every node renders as it does on a settled map.
 */
export interface ForestRegrowRenderLayer {
  /** Stories with no island on the map yet — their nameplate, wisps and hit regions are not drawn. */
  readonly hiddenStoryIds: ReadonlySet<string>;
  /** Trail segments whose two endpoint islands are not both present — not drawn. */
  readonly hiddenSegmentIds: ReadonlySet<string>;
}

/** The focus-aware context the walk needs — the studio's per-render interactivity
 *  (the scene itself is focus-agnostic; focus / hover / selection are applied here). */
export interface SceneCtx {
  /** The focus-aware island class (mirrors TreeView's `territoryClass`), by id + folded status. */
  territoryClassById: (id: string, status: string) => string;
  /** Statuses the legend has filtered out (their native plant targets are marked filtered). */
  hidden: ReadonlySet<string>;
  onSelectStory: (id: string) => void;
  onSelectCap: (storyId: string, capId: string) => void;
  /** Story ids whose islands play the ARRIVAL reveal (a story that just appeared in the tree payload,
   *  or the `?arrive=` demo target): their nameplate group wears `arrive-island`. */
  arrivalIds?: ReadonlySet<string> | null;
  /** The SELECTION highlight plan (ADR-0242, `neighbourHighlightPlan`) — which trail segments sit on
   *  the selected story's OWN one-hop edges. Used only when no {@link lanes} layout is present. */
  neighbours?: NeighbourHighlightPlan | null;
  /** The laid-out selection lanes (`laneLayout`): ONE lane per route, island to island, in the
   *  relation's hue, plus any roundabout islands. */
  lanes?: LaneLayout | null;
  /** Which selection motion the lanes carry: `draw` (the default), `march`, or `none`. */
  laneMotion?: 'draw' | 'march' | 'none';
  /** The whole-forest regrow's absence sets. Absent/null ⇒ nothing is withheld. */
  forestRegrowLayer?: ForestRegrowRenderLayer | null;
  /** The mounted 3D plants' click targets (`native-prop-targets.ts`), painted after the ground hit
   *  geometry and before the nameplate layer — so a 3D crown wins over the ground behind it, while
   *  the nameplates and wisps stay on top. Absent/null ⇒ nothing drawn. */
  nativePropTargetLayer?: NativePropTargetRenderLayer | null;
}

/**
 * The scene kinds the 3D layer draws and this layer therefore skips outright (ADR-0608 D2). Each is
 * the WHOLE of a picture: no handler, no identity a member reads, nothing an interaction reaches.
 * Their per-story twins that DO carry interaction — the ground groups and their capability parcels —
 * are not here; they render below as unpainted hit geometry.
 */
const RETIRED_PICTURE_KINDS: ReadonlySet<string> = new Set<SceneKind>([
  // the empty board between islands, and the baked hero-tree / garden definitions
  'empties-layer',
  'baked-defs',
  // the road passes (the lit lanes ride the fill pass and are rendered on their own, below)
  'trail-shadow-pass',
  'trail-casing-pass',
  'trail-ghost-pass',
  // the island's standing picture: hero trees, capability plants, coverage marks, conifers, UAT flowers
  'tree',
  'baked-art',
  'flora',
  'parcel-flora',
  'conifer',
  'tall-flower-proven',
  'tall-flower-pending',
  'tall-flower-failing',
]);

/** Role → the studio's base class(es) for every kind this layer still draws. Composed kinds are
 *  handled in {@link composeClass}. */
const BASE = {
  world: '',
  'coast-layer': 'hex-coastland',
  'ground-mesh': 'relaxed-land',
  'ground-hex': 'hex-land',
  'trails-layer': 'trail-net',
  'trail-fill-pass': 'trail-fill-pass',
  'trail-edges': 'trail-edges',
  'trail-edge': 'trail-edge',
  'cave-apron': 'cave-apron',
  'cave-arch': 'cave-arch',
  'cave-rim': 'cave-rim',
  'flora-layer': '',
  'hits-layer': '',
  'coast-shore': 'coast-fill',
  wisps: '',
  wisp: 'world-wisp',
  'wisp-hit': 'world-wisp-hit',
  'wisp-glow': 'world-wisp-glow',
  'wisp-dot': 'world-wisp-dot',
  // the story-CLAIM wisp (ADR-0138 §5) and the claim-GRADE families (ADR-0200 D7): DISTINCT class
  // families from the build wisp, never a proof class (the §5 honesty wall).
  'claim-wisps': '',
  'claim-wisp': 'world-claim-wisp',
  'claim-wisp-hit': 'world-claim-wisp-hit',
  'claim-wisp-glow': 'world-claim-wisp-glow',
  'claim-wisp-dot': 'world-claim-wisp-dot',
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
} as const satisfies Partial<Record<SceneKind, string>>;

/** True when the interaction layer names a base class for this kind. */
function hasBaseClass(k: SceneKind): k is keyof typeof BASE {
  return k in BASE;
}

const fmt = (n: number): string => n.toFixed(1);

/** ` arrive-island` on an arriving island's nameplate group — the CSS stages its reveal. */
function arriveIsland(id: string, ctx: SceneCtx): string {
  return ctx.arrivalIds?.has(id) ? ' arrive-island' : '';
}

/** The full className for a node — the studio's class for the role, plus the focus-aware island
 *  classes (mirroring TreeView). */
function composeClass(node: SceneNode, ctx: SceneCtx): string {
  const k = node.kind;
  if (!k) return '';
  const id = node.id ?? '';
  const status = node.status ?? 'unknown';
  switch (k) {
    case 'world':
      return '';
    case 'territory':
      return `hex-flora ${ctx.territoryClassById(id, status)}${arriveIsland(id, ctx)}`;
    case 'coast':
      return `coast-fill-group ${ctx.territoryClassById(id, status)}`;
    case 'ground':
      return `relaxed-tile ${ctx.territoryClassById(id, status)}`;
    case 'tile':
      return `hex-tile ${ctx.territoryClassById(id, status)}`;
    case 'cave':
      // the cave arch wears the island's shadow/side-wall hue family, keyed by the folded island
      // status the core stamped on the group (ADR-0169 §2).
      return `world-cave st-${status}`;
    case 'parcel':
      // the per-capability ground group (forest-parcels inc 1): unpainted, carrying the capability's
      // folded status so a group-level rule can key on it.
      return `parcel st-${status}`;
    case 'wisp':
      // ADR-0048 §3 v2: the wisp wears its live red→green band; ADR-0138 §5 adds a role tint.
      return `world-wisp band-${node.phaseBand ?? 'building'}${
        node.colourState ? ` role-${node.colourState}` : ''
      }`;
    case 'claim-wisp':
      // ADR-0138 §5 / ADR-0212: a claim wisp is its OWN class family, never a proof class.
      return `world-claim-wisp state-${node.colourState ?? 'supplementing'}${
        node.phaseBand ? ` band-${node.phaseBand}` : ''
      }`;
    case 'hover-wisp':
      return `world-hover-wisp state-${node.colourState ?? 'supplementing'}`;
    case 'queue-wisp':
      return `world-queue-wisp state-${node.colourState ?? 'supplementing'}`;
    default:
      return hasBaseClass(k) ? BASE[k] : '';
  }
}

/**
 * The attribute bag a scene element accumulates before `React.createElement` stamps it onto an SVG
 * node. Named rather than `Record<string, unknown>` (anti-slop `no-known-value-widening`): the
 * `data-*` stamps are what `apps/desktop/e2e/node-click.e2e.mjs` and the coordinate hit-test select
 * through, so a typo'd key is a compile error rather than a silently missing attribute.
 */
interface SceneElementProps extends React.SVGProps<SVGElement> {
  'data-cap-id'?: string;
  'data-edges'?: string | number;
  'data-from'?: string;
  'data-id'?: string;
  'data-island'?: string;
  'data-lane'?: string;
  'data-segments'?: string | number;
  'data-story-id'?: string;
  'data-to'?: string;
}

/** The studio's per-node handlers (it binds React handlers directly — no delegation): an island's
 *  ground or hit region selects its story; a capability's ground parcel selects its capability. */
function handlersFor(node: SceneNode, ctx: SceneCtx, storyId: string | undefined) {
  switch (node.kind) {
    case 'territory':
    case 'ground':
    case 'tile':
    // The generous per-story hit rect (`hit`) shares the island's select: a click anywhere in a
    // story's region selects it (ADR #486).
    case 'hit': {
      const id = node.id ?? storyId;
      if (!id) return {};
      return { onClick: () => ctx.onSelectStory(id) } satisfies Record<string, unknown>;
    }
    // The per-capability ground group carries the capability id and routes to the capability select
    // (shipped-map-render-path-drops-three-delivered-behaviours defect 3).
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
 * Move the core's `hits-layer` (which `buildScene` appends LAST, for the website's delegation surface)
 * to the back, directly after the ground hit geometry: there its generous per-story rects catch a
 * click on a gap or the nameplate margin and SELECT the story (#486), while the capability ground,
 * the 3D plant targets and the nameplates layered on top still win their own clicks.
 */
function hitsLayerToBack(children: readonly SceneNode[]): readonly SceneNode[] {
  const hitsIdx = children.findIndex((c) => c.kind === 'hits-layer');
  if (hitsIdx < 0) return children;
  const out = [...children];
  const [hits] = out.splice(hitsIdx, 1);
  const groundIdx = out.findIndex((c) => c.kind === 'ground-mesh' || c.kind === 'ground-hex');
  if (hits) out.splice(groundIdx < 0 ? 0 : groundIdx, 0, hits);
  return out;
}

/** The per-story layer groups a regrow makes absent together — an island is all of it or none. */
const REGROW_STORY_LAYER_KINDS: ReadonlySet<string> = new Set(['coast', 'ground', 'territory', 'hit']);

/** True when this node belongs to a story (or a road) the regrow has not reached yet. Absence is a
 *  SKIP, not a hiding class: an island that is not on the map yet costs no DOM. */
function regrowHides(node: SceneNode, layer: ForestRegrowRenderLayer): boolean {
  if (node.id === undefined || node.kind === undefined) return false;
  return REGROW_STORY_LAYER_KINDS.has(node.kind) && layer.hiddenStoryIds.has(node.id);
}

/** True when the island's shore should ring — it is the selection, or one of its one-hop neighbours
 *  (ADR-0242). Read off the same focus-aware class the rest of the island wears, so the ring and the
 *  nameplate highlight can never disagree about what is selected. */
function ringsShore(cls: string): boolean {
  return /\bis-(selected|upstream|downstream)\b/.test(cls);
}

/** The lit lane is ONE EDGE WIDE — capped at the width of a usage-1 road — and never more
 *  than this fraction of the road it rides, so even a spur keeps a rim. */
const LIT_LANE_CAP = trailFillWidth(1);
const LIT_LANE_FRACTION = 0.8;

/**
 * The lane width for a segment of the given usage. ALWAYS narrower than `trailFillWidth(usage)`, and
 * capped at a single-edge road's width, so on a trunk a lane reads as one edge's worth of traffic.
 */
export function litLaneWidth(usage: number): number {
  return Math.min(LIT_LANE_CAP, trailFillWidth(usage) * LIT_LANE_FRACTION);
}

/**
 * The factor the drawing strokes a road at, read off the road itself (ADR-0528): the scene's
 * `trail-fill` stroke is `trailFillWidth(usage) × TileArt.trailStroke`, and the lane follows that road.
 */
function roadStrokeFactor(child: SceneNode): number {
  const usage = child.usage ?? 1;
  const rule = trailFillWidth(usage);
  return child.strokeWidth !== undefined && rule > 0 ? child.strokeWidth / rule : 1;
}

/**
 * The ADR-0242 lit-lane overlay: one `trail-lit` path per segment the selection's own edges run
 * through. The road beneath it is the 3D layer's; the lane is selection feedback and stays here.
 * Empty when nothing is selected.
 */
function litLaneNodes(children: readonly SceneNode[], ctx: SceneCtx): React.JSX.Element[] {
  // A laid-out layout supersedes the per-segment pass entirely (see litRouteLanes).
  if (ctx.lanes && ctx.lanes.lanes.length > 0) return litRouteLanes(ctx);
  const plan = ctx.neighbours;
  if (!plan || plan.litSegments.size === 0) return [];
  const lanes: React.JSX.Element[] = [];
  for (const child of children) {
    if (child.el !== 'path' || !child.id || !plan.litSegments.has(child.id)) continue;
    if (ctx.forestRegrowLayer?.hiddenSegmentIds.has(child.id)) continue;
    lanes.push(
      React.createElement('path', {
        key: `lit-${child.id}`,
        className: 'trail-lit',
        d: child.d,
        'data-id': child.id,
        strokeWidth: litLaneWidth(child.usage ?? 1) * roadStrokeFactor(child),
      } satisfies SceneElementProps),
    );
  }
  return lanes;
}

/** World units a lane's draw-on covers per second, calibrated against the live forest (a one-hop
 *  route runs ~200–3700 units). */
const LANE_DRAW_SPEED = 3400;
/** Seconds a lane takes to draw on — its own length at a fixed speed, clamped at both ends. */
export function laneDrawSeconds(length: number): number {
  return Math.max(0.28, Math.min(1.2, 0.15 + length / LANE_DRAW_SPEED));
}

/**
 * The lanes of a laid-out selection: ONE path per route, island to island, plus a roundabout island
 * under each junction the layout named. `.is-drawing` opts each lane into the one-shot growth;
 * `prefers-reduced-motion` kills it regardless (CSS).
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
      props.pathLength = 1;
      props.style = { ['--lane-draw' as string]: `${laneDrawSeconds(lane.length).toFixed(2)}s` };
    }
    out.push(React.createElement('path', props));
  }
  return out;
}

/** How a node's subtree is drawn. `hit` = unpainted hit geometry (the island ground: a member clicks
 *  a capability's land, but the 3D layer paints it); `ring` = the selection's shore stroke only. */
type Mode = 'draw' | 'hit' | 'ring';

function renderNode(
  node: SceneNode,
  key: React.Key,
  storyId: string | undefined,
  ctx: SceneCtx,
  mode: Mode = 'draw',
): React.JSX.Element | null {
  if (ctx.forestRegrowLayer && regrowHides(node, ctx.forestRegrowLayer)) return null;
  if (node.kind !== undefined && RETIRED_PICTURE_KINDS.has(node.kind)) return null;
  if (node.el === 'baked-def' || node.el === 'baked-use') return null;

  const cls = composeClass(node, ctx);
  // The shore: only a ringed island's coast is drawn at all, and only as its stroke.
  if (node.kind === 'coast' && !ringsShore(cls)) return null;
  const childMode: Mode =
    node.kind === 'ground-mesh' || node.kind === 'ground-hex' ? 'hit' : node.kind === 'coast' ? 'ring' : mode;

  const props: SceneElementProps = { key, ...handlersFor(node, ctx, storyId) };
  if ((node.el === 'g' || mode !== 'hit') && cls) props.className = cls;
  // The ring is a stroke round the shore, never the shore's fill — inline, because the shared
  // `.coast-fill` rule (still painting the Shared Islands panel) would outrank an attribute.
  if (mode === 'ring' && node.el !== 'g') props.style = { fill: 'none' };
  if (node.transform) props.transform = node.transform;
  if (mode === 'draw') {
    if (node.opacity != null) props.opacity = node.opacity;
    if (node.strokeWidth != null) props.strokeWidth = node.strokeWidth;
  }
  // Unpainted hit geometry: present for the pointer and the coordinate hit-test, drawing nothing.
  if (mode === 'hit' && node.el !== 'g') props.fill = 'transparent';

  if (node.kind === 'trail-edge') {
    // the non-visual per-edge metadata (from/to/ordered segment chain) — edge identity stays in the DOM.
    if (node.id) props['data-id'] = node.id;
    if (node.from) props['data-from'] = node.from;
    if (node.to) props['data-to'] = node.to;
    if (node.segments) props['data-segments'] = node.segments;
  } else if (node.kind === 'cave') {
    if (node.island) props['data-island'] = node.island;
    if (node.edges) props['data-edges'] = node.edges;
  }
  if (
    node.kind === 'wisp-hit' ||
    node.kind === 'claim-wisp-hit' ||
    node.kind === 'hover-wisp-hit' ||
    node.kind === 'queue-wisp-hit' ||
    node.kind === 'departing-wisp-hit' ||
    node.kind === 'hit'
  )
    props.fill = 'transparent';
  // ADR-0200 D7: a departing claim's fade is DATA (ageRatio) turned into opacity.
  if (node.kind === 'departing-wisp' && node.ageRatio != null) {
    props.opacity = Number((1 - node.ageRatio).toFixed(2));
  }
  // Stamp ids into the DOM so TreeView can select by COORDINATE hit-test (robust where the bubbled
  // `click` is not — Electron retargets a captured click).
  if (node.kind === 'territory' || node.kind === 'ground' || node.kind === 'tile' || node.kind === 'hit') {
    if (node.id) props['data-story-id'] = node.id;
  } else if (node.kind === 'parcel') {
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
  // Every orbiting wisp family rotates by its `phase` (ADR-0212). SPEED is the motion channel: a
  // claim body with a live build band orbits at 6s, an idle claim at 9s, window shopping at 14s.
  if (
    (node.kind === 'wisp' || node.kind === 'claim-wisp' || node.kind === 'hover-wisp') &&
    node.phase != null
  ) {
    const dur =
      node.kind === 'hover-wisp' ? '14s' : node.kind === 'claim-wisp' ? (node.phaseBand ? '6s' : '9s') : '6s';
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
    // `ground` carries the island's own id the SAME way `territory` does, so its `parcel` children
    // reach `handlersFor` with the story they belong to.
    const childStory = node.kind === 'territory' || node.kind === 'ground' ? node.id : storyId;
    if (node.kind === 'trail-fill-pass') {
      // The road fills are the 3D layer's; only the selection's lit lanes ride on this pass.
      kids.push(...litLaneNodes(node.children, ctx));
    } else {
      const children = node.kind === 'world' ? hitsLayerToBack(node.children) : node.children;
      children.forEach((c, i) => {
        const el = renderNode(c, i, childStory, ctx, childMode);
        if (el) kids.push(el);
        if (node.kind === 'world' && c.kind === 'trails-layer' && ctx.nativePropTargetLayer) {
          kids.push(nativePropTargetGroup(ctx.nativePropTargetLayer, ctx));
        }
      });
    }
  } else if (node.el === 'text') {
    kids.push(node.text);
  }

  return React.createElement(node.el, props, ...kids);
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
 * Render a scene tree as React SVG. The root is the core's offset `world` group; the caller supplies
 * the `<svg>` shell + `<defs>` and layers any studio-only chrome ON TOP.
 *
 * `React.memo` is LOAD-BEARING (ADR-0069, kept by ADR-0272): a pan re-renders TreeView, and as long as
 * the caller hands `scene` and `ctx` STABLE identities the O(nodes) walk is skipped.
 */
export const SceneView = React.memo(function SceneView({
  scene,
  ctx,
}: {
  scene: SceneNode;
  ctx: SceneCtx;
}): React.JSX.Element {
  return renderNode(scene, 'scene', undefined, ctx) ?? <g />;
});
