// SemanticGrowthDemo — the query-gated Studio witness stage for the public
// `SemanticGrowthWorldView` player (semantic-growth-studio-demo,
// stories/app-surface/semantic-growth-studio-demo.md).
//
// Mounted ONLY behind the exact `?semanticGrowth=demo` query flag — TreeView.tsx gates the
// mount before any other Studio state, so the clean route and any other value never even
// construct this module's fixture. This is a WITNESS STAGE, not a product controller: the five
// frames below stage the map's real growth vocabulary —
//   1. empty          — no claimed land, no story.
//   2. land           — the plot is claimed ("mapped" ground); no story markers yet.
//   3. proposed       — a pale `proposed` story stands on it, with its real capability parcels.
//   4. claimed        — a real claim/presence wisp (a session working it); status stays
//                        `proposed` — a claim is never a proof.
//   5. healthy        — the settled `healthy` status.
//
// THE WALK LOST A FRAME, DELIBERATELY (ADR-0536). Between `claimed` and `healthy` there used to be
// a `signed-proof` frame: a story still marked `proposed` carrying the verdict bloom, staging the
// proposition that proof and authored status are separate things. ADR-0529 retired the bloom, which
// was the only thing that frame had to draw — without it the frame rendered identically to
// `proposed`. ADR-0536 chose to DROP it rather than invent a replacement marker (declined) or let it
// show the green early (declined — that makes it identical to `healthy`). The proposition survives
// in the legend's proof row and the story prose.
//
// Every frame is folded through the SAME real Studio world pipeline TreeView.tsx uses for the
// live map: deterministic representative story/capability data enters `buildWorld`, its real
// draw tiles enter `buildRelaxedCells`, and `worldToScene` (carrying the same permanent
// vegetation input) feeds `buildScene` — never a hand-authored scene-input shape, coast path, or
// hand-filled empty geometry array. No fetch, no store read, no subscription, no mutation, no
// clock-driven advance, and no Chapter 2 narration/pacing: the public `SemanticGrowthWorldView`
// owns the player, its Back/Next/Replay controls, its own reduced-motion handling, and (via its
// co-located stylesheet) the entrance/orbit motion itself — this file never copies any of
// that machinery, nor authors a transform/keyframe/animation selector of its own. It only
// supplies the fixture and reuses the sprite sheet + art scale TreeView already resolved.

import {
  buildScene,
  type SceneG,
  type SceneKind,
  type SceneNode,
  type SceneVegetationInput,
} from '@storytree/forest-world';
import { useMemo, useState } from 'react';
import {
  arrivalGrowPlan,
  CHAPTER2_ORGANIC_POSE_TO_POSE_REGISTRY,
  CHAPTER2_ROUND3_LAB_ELEVATION_DEG,
  CHAPTER2_ROUND3_TREE_CANDIDATES,
  chapter2Round3TreeCandidate,
  spriteUprightReconciliation,
  neighbourHighlightPlan,
  laneLayout,
  normalizeWorldPresentationModel,
  SemanticGrowthWorldView,
  type Chapter2HeroTreeCandidate,
  type Chapter2HeroTreeCandidateId,
  type OrganicPoseTrack,
  type SemanticGrowthFrame,
  type SemanticGrowthOrganicPoseLayer,
  type SemanticGrowthSvgIslandAccretion,
  type TrailRevealPlan,
} from '@storytree/app-surface';
import { buildWorld, buildRelaxedCells, worldToScene, type HexWorld } from './TreeView.js';
import type {
  BuildActivity,
  ClaimActivity,
  DepartedClaim,
  TreeCapability,
  TreeStory,
  TreeVerdict,
  WorkStatus,
} from '../types.js';
import type { SpriteStyleSheet } from '../lib/sprite-sheet.js';

/** A writable draft of a frozen contract shape: build it field-by-field, then hand it over by a
 *  CHECKED assignment to the readonly type (never a cast).
 *
 *  ⚠ Always go through a NON-GENERIC alias hop like `OrganicPoseLayerDraft` below — annotating a
 *  binding with `Mutable<Something>` DIRECTLY fires `anti-slop/no-known-value-widening`, because
 *  that rule's classifier resolves a same-file GENERIC alias through `resolvesToDictionary`, which
 *  any mapped type satisfies. The extra hop routes through `classifyAliasBroadTarget` instead,
 *  which correctly finds `keyof T` is not a broad key. Measured, not assumed. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** The writable draft of {@link SemanticGrowthOrganicPoseLayer} — see the hop note above. */
type OrganicPoseLayerDraft = Mutable<SemanticGrowthOrganicPoseLayer>;

/** The fixture's one representative story id + its two capability ids — enough for the real
 *  pipeline to grow a multi-tile territory with more than one capability parcel. */
const DEMO_STORY_ID = 'semantic-growth-demo';
const DEMO_CAP_ALPHA_ID = 'semantic-growth-demo-cap-alpha';
const DEMO_CAP_BETA_ID = 'semantic-growth-demo-cap-beta';

/** The fixed COMPANION witness territory (H — sgsd-companion-witness-territory): a second story
 *  composed through the exact same real pipeline, byte-stable across all five frames. It never
 *  narrates the primary's health walk (no claim, no verdict) — it exists only so the demo
 *  ALSO exercises the renderer's no-parcel `buildTerritoryFlora` path (a real procedural
 *  `story-tree` + capability `garden-flora`), which the primary's parcels-present territory never
 *  takes. */
const COMPANION_STORY_ID = 'semantic-growth-demo-companion';
const COMPANION_CAP_ID = 'semantic-growth-demo-companion-cap';
const ORGANIC_TREE_SCALE = 0.34;
const ORGANIC_PLANT_SCALE = 0.3;

/** A fixed instant, never `Date.now()`, so the walk stays byte-identical across every
 *  render/re-mount. */
const NOW = new Date('2026-01-01T00:00:00.000Z');

function demoCapability(id: string, testCount: number, status: WorkStatus): TreeCapability {
  return {
    id,
    title: id,
    outcome: `${id} — a representative capability for the semantic-growth witness`,
    status,
    proofMode: 'contract',
    dependsOn: [],
    testCount,
  };
}

/** One representative story, varied only by the lifecycle facts a real `/api/tree` payload
 *  would vary over time (status + verdict) — its id/capabilities stay fixed so `buildWorld`
 *  grows the exact same territory every time it's called. */
function demoStory(status: WorkStatus, verdict?: TreeVerdict): TreeStory {
  const capStatus: WorkStatus = status === 'healthy' ? 'healthy' : 'proposed';
  const story: TreeStory = {
    id: DEMO_STORY_ID,
    title: 'Semantic growth witness',
    outcome: 'stages the semantic-growth vocabulary through the real Studio world pipeline',
    status,
    proofMode: 'UAT',
    uatWitness: 'machine',
    // sgsd-primary-selection-reuses-drawn-route-lanes: a real `depends_on` edge onto the fixed
    // companion, so the composed world's REAL trail network (`buildWorld` -> `storyEdges` ->
    // `routeTrails`) actually routes a road between the two territories — never an invented
    // lane. The companion is the dependency (`from`), the primary the dependent (`to`); the
    // companion never narrates the primary's health walk regardless of this edge.
    dependsOn: [COMPANION_STORY_ID],
    consumedBy: [],
    capabilities: [
      demoCapability(DEMO_CAP_ALPHA_ID, 6, capStatus),
      demoCapability(DEMO_CAP_BETA_ID, 5, capStatus),
    ],
  };
  if (verdict) story.verdict = verdict;
  return story;
}

/** The fixed companion story, identical on every call — never varied by frame (the primary is the
 *  only story whose status/verdict/claims change across the walk). One capability is enough for
 *  the real pipeline to grow its own tree + capability plant. */
const COMPANION_STORY: TreeStory = {
  id: COMPANION_STORY_ID,
  title: 'Semantic growth companion',
  outcome: 'a fixed witness territory carried alongside the primary story’s five-state walk',
  status: 'healthy',
  proofMode: 'UAT',
  uatWitness: 'machine',
  dependsOn: [],
  consumedBy: [],
  capabilities: [demoCapability(COMPANION_CAP_ID, 4, 'healthy')],
};

/** The unified vegetation vocabulary, PRESENT but with no fetched tree colourway (the demo
 *  performs no fetch) — the same resting shape `useVegetation` in TreeView.tsx starts every
 *  session at, before its hero-tree colourways resolve. */
const VEGETATION: SceneVegetationInput = {};

const NO_BUILDS: Map<string, BuildActivity[]> = new Map();
const NO_CLAIMS: Map<string, ClaimActivity[]> = new Map();
const NO_DEPARTURES: Map<string, DepartedClaim[]> = new Map();

/**
 * Recursively drop drawables of the given `kind` from a built scene (and its descendants), scoped
 * to the territory whose id is `scopeId` — SOURCE-LOCAL / id-scoped, never a bare `(node, kind)`
 * global strip (that would remove every territory it finds, including the companion's own
 * identity group, which the H proof forbids).
 *
 * Two real uses fold through this one helper:
 *  - `stripKind(scene, 'territory', primaryId)` drops the primary's WHOLE identity group (tree +
 *    nameplate + parcel flora + claim/departure wisps) wherever it sits in the tree — the only way
 *    to stage claimed ground with no story identity yet (the `land` frame) is to grow the real
 *    per-territory scene through the normal pipeline and then remove that one identity group,
 *    never by hand-deriving the ground geometry or copying forest-world's internals.
 *  - `stripKind(scene, 'plate', COMPANION_STORY_ID)` drops only the nameplate NESTED inside the
 *    companion's own `territory` group (once inside that group every `plate` descendant is
 *    scoped-matched) — the companion is witness context, never a narrated nameplate, on every
 *    frame.
 */
function stripKind(node: SceneNode, kind: SceneKind, scopeId: string, inScope = false): SceneNode {
  if (node.el !== 'g') return node;
  const hereInScope = inScope || (node.kind === 'territory' && node.id === scopeId);
  return {
    ...node,
    children: node.children
      .filter((c) => !(c.kind === kind && (c.id === scopeId || hereInScope)))
      .map((c) => stripKind(c, kind, scopeId, hereInScope)),
  };
}

/**
 * Drop only the primary's real GROUND wrapper's `data-story-id`/`hex-territory[data-story-id]`
 * identity tag — never removing the node or any of its real substrate/parcel/parcel-flora content
 * — so the one real ground group a `land`-onward frame keeps visible never double-counts as a
 * second clickable "territory" alongside the primary's own `territory` identity group (forest-
 * world's shared `ground`/`territory`/`coast` kinds all fold through the SAME
 * `hex-territory st-<status>` class + `data-story-id` stamp, ADR-0093 §4 — one story reads as one
 * territory everywhere else on the map because there both groups always share ONE fate; the demo's
 * `land` frame is the one place that deliberately keeps the ground while stripping the identity, so
 * it alone must undo the extra count without touching real content). Source-local, id-scoped —
 * never a global class/attribute rewrite, never touching app-surface/SceneView.
 */
function clearGroundIdentity(node: SceneNode, primaryId: string): SceneNode {
  if (node.el !== 'g') return node;
  const children = node.children.map((c) => clearGroundIdentity(c, primaryId));
  if (node.kind === 'ground' && node.id === primaryId) {
    const { id: _primaryGroundId, ...rest } = node;
    return { ...rest, children };
  }
  return { ...node, children };
}

/**
 * Retire only the primary territory's app-drawn organic material for the pose experiment.
 * Coast, ground, parcels, hit geometry, plate, proof and presence remain the real SVG scene.
 */
function withoutPrimaryVectorOrganic(
  node: SceneNode,
  inPrimaryTerritory = false,
): SceneNode {
  if (node.el !== 'g') return node;
  const inPrimary =
    inPrimaryTerritory || (node.kind === 'territory' && node.id === DEMO_STORY_ID);
  return {
    ...node,
    children: node.children
      .filter(
        (child) =>
          !(
            inPrimary &&
            (child.kind === 'tree' ||
              child.kind === 'flora' ||
              child.kind === 'parcel-flora' ||
              child.kind === 'baked-art')
          ),
      )
      .map((child) => withoutPrimaryVectorOrganic(child, inPrimary)),
  };
}

/** The claim/presence wisp for the `claimed` frame — coordination, never a proof (the ADR-0138
 *  §5 honesty wall the core itself enforces): the story's own status stays `proposed`, and this
 *  claim carries no proof identity of its own. */
const DEMO_CLAIM: ClaimActivity = {
  unitId: DEMO_STORY_ID,
  kind: 'claim',
  sessionId: 'semantic-growth-demo-session',
  branch: 'claude/demo-real',
  intent: 'real',
  grade: 'work',
  at: NOW.toISOString(),
};

/**
 * Fold the fixture into the five ordered growth frames the public player requires (`FRAME_KEYS`
 * in `SemanticGrowthWorldView.tsx`). Deliberately NOT run at this module's own top level: this
 * file and TreeView.tsx import each other (TreeView.tsx mounts this component; this component
 * composes through TreeView's exported `buildWorld`/`buildRelaxedCells`/`worldToScene`), so
 * calling into `buildWorld` while either module is still mid-evaluation would reach one of
 * TreeView's own not-yet-initialized module-scope constants. Called lazily (see {@link frames}),
 * well after the whole module graph has finished loading — every real call below still happens
 * exactly once, the static fixture is still frozen the first time it's needed, never rebuilt
 * per render.
 */
function buildFrames(
  preservePrimaryGroundIdentity = false,
): readonly SemanticGrowthFrame[] {
  // ONE composed, real world every frame reuses — the primary AND the fixed companion both enter
  // `buildWorld` together (H — sgsd-composed-through-real-studio-world-pipeline /
  // sgsd-companion-witness-territory), so the tiles, coastline, and capability layout below are
  // the SAME real geometry across every frame; only the primary story object's status/verdict/
  // claims vary per frame — the companion's story object never changes.
  // The primary enters FIRST (index 0) so every real per-territory layer (coast/ground/territory)
  // draws the primary before the companion — the DOM-order fact the "claimed"/"healthy"
  // regression floor above relies on (`flagged.querySelector('.hex-territory')`, unscoped, must
  // resolve to the PRIMARY's own status, never the companion's fixed `healthy` one).
  const baseWorld: HexWorld = buildWorld([demoStory('proposed'), COMPANION_STORY], {
    buildings: false,
  });
  const companionIndex = baseWorld.territories.findIndex((t) => t.story.id === COMPANION_STORY_ID);
  const primary = baseWorld.territories.find((t) => t.story.id === DEMO_STORY_ID);
  if (!primary) throw new Error('Semantic growth fixture requires its primary planted parcel.');
  const plant = primary.caps[0];
  if (!plant) throw new Error('Semantic growth fixture requires its bounded plant socket.');
  organicPoseSocketsCache = {
    tree: Object.freeze({ x: primary.treeSpot.x, y: primary.treeSpot.y }),
    plant: Object.freeze({ x: plant.x, y: plant.y }),
    island: Object.freeze({
      storyId: DEMO_STORY_ID,
      worldAnchor: Object.freeze({
        x: primary.centroid.x,
        y: primary.centroid.y,
      }),
      radius: Object.freeze({
        x: primary.radius * 1.32,
        y: primary.radius * 0.96,
      }),
    }),
  };

  // sgsd-primary-selection-reuses-drawn-route-lanes: the primary's one-hop selection plan +
  // laid-out lane, derived from the composed world's REAL trail network with the SAME shared
  // helpers the live map uses — never a demo-local path, segment renderer, or CSS animation.
  // Computed once (the network is fixed across every frame); threaded onto only the frames
  // where the primary's own identity narrates (see {@link narrativeModel} below).
  const neighbourPlan = neighbourHighlightPlan(baseWorld.trails, DEMO_STORY_ID);
  const primaryLanes = laneLayout(baseWorld.trails, neighbourPlan, {
    hand: 'auto',
    roundabouts: true,
  });

  // The ADR-0169 ARRIVAL draw-on, over the same composed world's REAL trail network: the primary
  // is the island that ARRIVES in this walk, so its direct incident road grows outward from it
  // rather than snapping in already drawn. The live map has always had this beat
  // (`TreeView.tsx` calls the same shared selector); the witness never wired it, which is why no
  // Chapter 2 mock has ever shown a path growing.
  //
  // Set on the `proposed` frame ONLY (see the frame list below). `reveal` is a per-frame field on
  // the DISCRETE five-key cursor, not the organic layer's continuous progress axis, and the mask
  // animation fires on MOUNT — so putting the plan on the one arrival frame plays the beat
  // exactly once, at the arrival, while every later frame (no plan ⇒ no mask) simply paints the
  // trail fully drawn. `empty`/`land` carry no primary identity yet, so they stay off it too.
  const arrivalPlan = arrivalGrowPlan(baseWorld.trails, new Set([DEMO_STORY_ID]));

  const rawRelaxedCells = buildRelaxedCells(baseWorld, 'mesh', {});
  // The SOLE allowed filtering (H): deterministic removal of the real `buildRelaxedCells` output
  // OWNED by the fixed companion territory — never a hand-authored replacement — so the companion
  // owns zero substrate cells and the renderer's existing NO-PARCEL `buildTerritoryFlora` path
  // takes over for it (a real procedural `story-tree` + capability `garden-flora`). Every
  // primary-owned cell is retained untouched.
  const relaxedCells = rawRelaxedCells.filter((c) => c.owner !== companionIndex);

  // Swap the composed world's PRIMARY territory onto a differently-lifecycled story object without
  // touching any of its already-grown geometry (tiles/centroid/coastline/capability spots), or the
  // companion's — exactly the fact a live `/api/tree` re-poll would vary over time for the primary
  // only, while the companion sits byte-stable as witness context.
  const worldWithPrimaryStory = (story: TreeStory): HexWorld => ({
    ...baseWorld,
    territories: baseWorld.territories.map((t) => (t.story.id === DEMO_STORY_ID ? { ...t, story } : t)),
  });

  const sceneForStory = (story: TreeStory, claims: readonly ClaimActivity[] = []): SceneG => {
    const claimsByStory: Map<string, ClaimActivity[]> = claims.length
      ? new Map([[DEMO_STORY_ID, [...claims]]])
      : NO_CLAIMS;
    return buildScene(
      worldToScene(
        worldWithPrimaryStory(story),
        relaxedCells,
        NOW,
        NO_BUILDS,
        claimsByStory,
        NO_DEPARTURES,
        null,
        null,
        VEGETATION,
      ),
    );
  };

  // The companion is witness context, never a narrated nameplate — its `plate` is stripped by id
  // on every single frame (source-local, id-scoped; see {@link stripKind}).
  const withoutCompanionPlate = (scene: SceneNode): SceneNode =>
    stripKind(scene, 'plate', COMPANION_STORY_ID);

  // "no claimed land, no story at all" for the PRIMARY — its whole identity group AND its real
  // ground/coast are stripped (id-scoped to the primary only), so only the companion's own
  // territory/ground/coast remain visible. Grown through the exact same real per-territory
  // pipeline as every other frame, never a separate hand-composed empty world.
  const emptyScene = (): SceneNode => {
    const scene = sceneForStory(demoStory('mapped'));
    const noPrimaryTerritory = stripKind(scene, 'territory', DEMO_STORY_ID);
    const noPrimaryGround = stripKind(noPrimaryTerritory, 'ground', DEMO_STORY_ID);
    const noPrimaryCoast = stripKind(noPrimaryGround, 'coast', DEMO_STORY_ID);
    return withoutCompanionPlate(noPrimaryCoast);
  };

  // "the plot is claimed; no story markers yet" — the real coast/ground/substrate renders through
  // the normal per-territory pipeline (kept visible — this frame's whole point), then the
  // primary's own `territory` identity group is stripped (id-scoped, so the companion's identity
  // survives) and its real ground's identity tag is cleared (content stays, {@link
  // clearGroundIdentity}) so no nameplate/tree/parcel-flora appears for the primary until
  // `proposed`.
  const landScene = (): SceneNode => {
    const scene = sceneForStory(demoStory('mapped'));
    const noPrimaryTerritory = stripKind(scene, 'territory', DEMO_STORY_ID);
    return withoutCompanionPlate(
      preservePrimaryGroundIdentity
        ? noPrimaryTerritory
        : clearGroundIdentity(noPrimaryTerritory, DEMO_STORY_ID),
    );
  };

  // `proposed`/`claimed`/`healthy`: the primary's identity group stays — only its
  // ground's identity tag is cleared (its real substrate/parcels/parcel-flora content untouched)
  // so it never double-counts alongside the primary's own `territory` group.
  const narrativeScene = (story: TreeStory, claims: readonly ClaimActivity[] = []): SceneNode =>
    withoutCompanionPlate(
      preservePrimaryGroundIdentity
        ? sceneForStory(story, claims)
        : clearGroundIdentity(sceneForStory(story, claims), DEMO_STORY_ID),
    );

  // Only once the primary's own identity narrates (`proposed` onward) does its real drawn route
  // reach the shared renderer as a lit lane — `empty`/`land` carry no primary identity yet, so
  // they stay off the real one-hop plan/layout entirely (`neighbours`/`lanes` default null).
  const narrativeModel = (
    story: TreeStory,
    claims: readonly ClaimActivity[] = [],
    reveal: TrailRevealPlan | null = null,
  ): ReturnType<typeof normalizeWorldPresentationModel> =>
    normalizeWorldPresentationModel({
      scene: narrativeScene(story, claims),
      neighbours: neighbourPlan,
      lanes: primaryLanes,
      laneMotion: 'draw',
      reveal,
    });

  return [
    {
      key: 'empty',
      model: normalizeWorldPresentationModel({ scene: emptyScene() }),
    },
    {
      key: 'land',
      model: normalizeWorldPresentationModel({ scene: landScene() }),
    },
    {
      // The ARRIVAL: the primary's island and its road appear together for the first time, so
      // this is the one frame that carries the draw-on plan.
      key: 'proposed',
      model: narrativeModel(demoStory('proposed'), [], arrivalPlan),
    },
    {
      key: 'claimed',
      model: narrativeModel(demoStory('proposed'), [DEMO_CLAIM]),
    },
    {
      key: 'healthy',
      model: narrativeModel(demoStory('healthy')),
    },
  ];
}

let framesCache: readonly SemanticGrowthFrame[] | null = null;
let organicPoseFramesCache: readonly SemanticGrowthFrame[] | null = null;
let organicPoseSocketsCache: {
  readonly tree: { readonly x: number; readonly y: number };
  readonly plant: { readonly x: number; readonly y: number };
  readonly island: {
    readonly storyId: string;
    readonly worldAnchor: { readonly x: number; readonly y: number };
    readonly radius: { readonly x: number; readonly y: number };
  };
} | null = null;

/** The static fixture, computed once on first use and cached — never at this module's own
 *  top level (see {@link buildFrames}), never rebuilt afterward. */
function frames(): readonly SemanticGrowthFrame[] {
  if (!framesCache) framesCache = buildFrames();
  return framesCache;
}

function organicPoseFrames(): readonly SemanticGrowthFrame[] {
  if (!organicPoseFramesCache) organicPoseFramesCache = buildFrames(true);
  return organicPoseFramesCache;
}

function organicPoseSockets(): NonNullable<typeof organicPoseSocketsCache> {
  organicPoseFrames();
  if (!organicPoseSocketsCache) {
    throw new Error('Semantic growth fixture did not register its organic sockets.');
  }
  return organicPoseSocketsCache;
}

const PLANT_TRACK_ID = 'chapter2-plant-sample-pose-track-v1';
const INCUMBENT_HERO_TRACK_ID = 'chapter2-hero-tree-pose-track-v1';

/**
 * The round-3 lab's PROJECTION dial — now a COMPARISON CONTROL ONLY (ADR-0367 D1).
 *
 * It used to be the reconciliation MECHANISM, and its own comment said what that cost: the land was
 * a pure plan view, the tree was rendered at a 20-degree camera, and 0.82 was an owner-picked
 * vertical squash standing in for the low top-down view the generator would not produce — "a
 * comparison stand-in, never a solved camera".
 *
 * The default is DERIVED from {@link spriteUprightReconciliation}, reconciled against the LAB's own
 * witness camera ({@link CHAPTER2_ROUND3_LAB_ELEVATION_DEG}) — deliberately NOT the land's. ADR-0593
 * moved `LAND_CAMERA_ELEVATION_DEG` (20 -> 50), but this lab is a static witness stage comparing
 * candidates against EACH OTHER, never a variant of the working map (see the constant's own doc
 * comment for the measured one-consumer fact this rests on), so its own composition must keep
 * rendering exactly as it always has: every candidate here is either authored at the lab's 20° or
 * hand-authored with no camera at all, so the default stays 1 — no squash — regardless of where the
 * land's camera moves. The four steps stay so the owner can still compare, and a default that stops
 * being 1 would be a live signal that the MOUNTED CANDIDATE needs re-rendering at the lab's own
 * angle, never that the land moved.
 *
 * The dial is STATELESS — the rendered geometry is a pure function of the selected value, so it
 * holds nothing for Replay to clear, and Replay deliberately does NOT snap the owner's chosen
 * comparison setting back to the default mid-comparison.
 */
const R3_LAB_PROJECTIONS = Object.freeze([1, 0.9, 0.82, 0.72] as const);
const r3LabDefaultProjection = (candidate: Chapter2HeroTreeCandidate): number =>
  spriteUprightReconciliation(candidate.renderedCameraElevationDeg, CHAPTER2_ROUND3_LAB_ELEVATION_DEG);
const R3_LAB_DEFAULT_CANDIDATE: Chapter2HeroTreeCandidateId = 'incumbent';

function heroTreeTrack(candidate: Chapter2HeroTreeCandidate): OrganicPoseTrack {
  const track = candidate.registry.tracks.find((t) => t.id === candidate.heroTreeTrackId);
  if (!track) throw new Error(`Round-3 candidate "${candidate.id}" registers no hero-tree track.`);
  return track;
}

/**
 * The mature hero tree's world HEIGHT under the accepted round-1 track — the size every candidate
 * is drawn at, so the owner compares shape and planting rather than accidental scale.
 *
 * exp-16 is authored on a 128px canvas while the other three are 192px, and every candidate's
 * mature footprint differs, so mounting them all at one instance scale would render exp-16 at
 * roughly 65% the apparent height and quietly bias the LOOK verdict. The instance scale is a
 * DISPLAY decision the app owns (never a re-normalisation of the asset), derived here from each
 * track's own registered `matureFootprint`.
 *
 * Resolved LAZILY and cached, never at module scope: this module is imported by every route that
 * imports TreeView, and reaching into the round-3 candidate registry during module evaluation
 * would make the whole Studio bundle's load depend on a table only the lab reads.
 */
let incumbentMatureWorldHeightCache: number | null = null;

function incumbentMatureWorldHeight(): number {
  if (incumbentMatureWorldHeightCache === null) {
    incumbentMatureWorldHeightCache =
      heroTreeTrack(chapter2Round3TreeCandidate('incumbent')).matureFootprint.height *
      ORGANIC_TREE_SCALE;
  }
  return incumbentMatureWorldHeightCache;
}

function heroTreeScale(candidate: Chapter2HeroTreeCandidate): number {
  return incumbentMatureWorldHeight() / heroTreeTrack(candidate).matureFootprint.height;
}

export interface SemanticGrowthDemoProps {
  readonly spriteSheet: SpriteStyleSheet | null;
  readonly artScale: number;
  readonly variant?:
    | 'demo'
    | 'organic-pose-to-pose'
    | 'organic-island-accretion'
    | 'r3-lab';
}

/**
 * The `?semanticGrowth=demo` witness stage (TreeView.tsx gates the mount, never anything else).
 * Reuses TreeView's already-resolved sprite sheet + art scale on every frame — this component
 * owns no manifest request, resolver, asset, or art policy of its own — and mounts the public
 * player unmodified. Supplies exactly one static fixture, nothing else.
 */
export function SemanticGrowthDemo({
  spriteSheet,
  artScale,
  variant = 'demo',
}: SemanticGrowthDemoProps): React.JSX.Element {
  const labVariant = variant === 'r3-lab';
  const poseVariant = variant !== 'demo';
  // The lab presents the owner's recorded island lead, so it carries the accretion layer (and its
  // legend) exactly as the `organic-island-accretion` gate does.
  const accretionVariant = variant === 'organic-island-accretion' || labVariant;
  // The ONLY host state the lab adds: which hero tree is mounted and which projection is shown.
  // Neither is a frame cursor, a timer or a remount key — the public player still owns the
  // semantic cursor, the playback clock and Back/Next/Replay, and it is never re-keyed, so
  // switching a candidate mid-walk leaves the walk exactly where the owner left it.
  const [candidateId, setCandidateId] =
    useState<Chapter2HeroTreeCandidateId>(R3_LAB_DEFAULT_CANDIDATE);
  // Seeded from the SHARED camera, not from a hand-picked squash: the default is what the mounted
  // track needs in order to stand on land drawn at the land's declared camera (ADR-0367 D1).
  const [projection, setProjection] = useState<number>(() =>
    r3LabDefaultProjection(chapter2Round3TreeCandidate(R3_LAB_DEFAULT_CANDIDATE)),
  );
  const sourceFrames = poseVariant ? organicPoseFrames() : frames();
  const sockets = poseVariant ? organicPoseSockets() : null;
  const candidate = labVariant ? chapter2Round3TreeCandidate(candidateId) : null;
  const framesWithArt = useMemo<readonly SemanticGrowthFrame[]>(
    () =>
      sourceFrames.map((f) => ({
        key: f.key,
        model: {
          ...f.model,
          scene: poseVariant ? withoutPrimaryVectorOrganic(f.model.scene) : f.model.scene,
          spriteSheet,
          artScale,
        },
      })),
    [artScale, poseVariant, sourceFrames, spriteSheet],
  );
  // EXACTLY ONE hero-tree track is mounted at a time: the layer carries the selected candidate's
  // registry, whose two tracks are that candidate's hero tree plus the SHARED, frozen plant track
  // — so a candidate swap can never change the plant, the island or the walk.
  const organicPoseGrowth = useMemo<SemanticGrowthOrganicPoseLayer | null>(() => {
    if (!poseVariant || !sockets) return null;
    const draft: OrganicPoseLayerDraft = {
      registry: candidate ? candidate.registry : CHAPTER2_ORGANIC_POSE_TO_POSE_REGISTRY,
      instances: [
        {
          trackId: candidate ? candidate.heroTreeTrackId : INCUMBENT_HERO_TRACK_ID,
          worldAnchor: sockets.tree,
          scale: candidate ? heroTreeScale(candidate) : ORGANIC_TREE_SCALE,
          progressWindow: { start: 0.18, end: 1 },
        },
        {
          trackId: PLANT_TRACK_ID,
          worldAnchor: sockets.plant,
          scale: ORGANIC_PLANT_SCALE,
          progressWindow: { start: 0.52, end: 1 },
        },
      ],
      nativeIsland: {
        ...sockets.island,
        settledAtProgress: 0.18,
      },
    };
    if (labVariant) draft.projection = projection;
    const layer: SemanticGrowthOrganicPoseLayer = draft;
    return layer;
  }, [candidate, labVariant, poseVariant, projection, sockets]);
  const svgIslandAccretion = useMemo<SemanticGrowthSvgIslandAccretion | null>(() => {
    if (!accretionVariant || !sockets) return null;
    return {
      storyId: sockets.island.storyId,
      worldAnchor: sockets.tree,
      growthDurationMs: 1_600,
    };
  }, [accretionVariant, sockets]);
  return (
    <div className="tree-wrap semantic-growth-demo-host">
      <div className="tree-layout">
        <div className="world-frame">
          <div
            className="world-viewport"
            aria-label={
              labVariant
                ? 'Chapter 2 round-3 hero-tree comparison lab (real app fixture)'
                : poseVariant
                  ? accretionVariant
                    ? 'connected SVG island accretion with organic pose-to-pose growth (real app fixture)'
                    : 'organic pose-to-pose growth witness (real app fixture)'
                  : 'semantic growth witness (static fixture)'
            }
          >
            <SemanticGrowthWorldView
              frames={framesWithArt}
              {...(organicPoseGrowth ? { organicPoseGrowth } : {})}
              {...(organicPoseGrowth && svgIslandAccretion ? { svgIslandAccretion } : {})}
            />
          </div>
        </div>
      </div>
      {labVariant && candidate ? (
        <div
          data-r3-lab="true"
          style={{
            boxSizing: 'border-box',
            flex: '0 0 auto',
            width: '100%',
            maxWidth: '72rem',
            margin: '0 auto',
            padding: '0.35rem clamp(0.6rem, 2vw, 1rem)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.5rem 1.25rem',
            alignItems: 'baseline',
          }}
        >
          <div
            role="group"
            aria-label="Hero tree candidate"
            data-r3-lab-candidate-picker="true"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}
          >
            {CHAPTER2_ROUND3_TREE_CANDIDATES.map((entry) => (
              <button
                key={entry.id}
                type="button"
                data-r3-lab-candidate={entry.id}
                aria-pressed={entry.id === candidateId}
                onClick={() => setCandidateId(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          <div
            role="group"
            aria-label="Projection comparison (vertical squash)"
            data-r3-lab-projection-picker="true"
            style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}
          >
            {R3_LAB_PROJECTIONS.map((value) => (
              <button
                key={value.toFixed(2)}
                type="button"
                data-r3-lab-projection={value.toFixed(2)}
                aria-pressed={value === projection}
                onClick={() => setProjection(value)}
              >
                {value.toFixed(2)}&#215;
              </button>
            ))}
          </div>
          {/*
            The prose below is deliberately candidate-INDEPENDENT, and the per-candidate readout
            below it is a single non-wrapping line. Measured in Chromium at 1440x900 before this
            split: exp-18's shorter budget clause cost the legend one wrapped line (97px -> 78px),
            which grew the map SVG from 665px to 685px — switching candidates RESIZED the picture
            the owner is comparing by ~3%. A comparison lab may not move its own subject, so the
            varying text now occupies a fixed one-line row and the block height is constant.
          */}
          <p
            role="note"
            data-r3-lab-legend="true"
            style={{
              margin: 0,
              flex: '1 1 22rem',
              fontSize: 'clamp(0.72rem, 1.7vw, 0.9rem)',
              lineHeight: 1.35,
            }}
          >
            The <strong>hero tree</strong> is the only thing that changes: the connected SVG
            accretion island, the retained plant track and the arrival path-growth beat are fixed
            for every candidate, and every candidate is drawn at the accepted track&rsquo;s mature
            height so scale never biases the comparison. <strong>Projection</strong> is a{' '}
            <strong>comparison control, not a solved camera</strong> — a deterministic vertical
            squash of the organic sprite layer, pinned at the ground socket so the root contact
            never moves, standing in for the low top-down view the generator would not produce.
          </p>
          <p
            data-r3-lab-budget={candidate.id}
            style={{
              margin: 0,
              flex: '1 1 100%',
              minWidth: 0,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              fontSize: 'clamp(0.72rem, 1.7vw, 0.9rem)',
              lineHeight: 1.35,
            }}
          >
            Mounted: <strong>{candidate.label}</strong> at{' '}
            <strong>{projection.toFixed(2)}&#215;</strong> — {candidate.frameCount} frames,{' '}
            {candidate.canvas.width}&#215;{candidate.canvas.height},{' '}
            {String(candidate.budget.encodedBytes)} encoded bytes,{' '}
            {String(candidate.budget.decodedRgbaBytes)} decoded bytes;{' '}
            {candidate.budget.exceedsPriorCeiling.length === 0
              ? 'within the round-1 ceilings'
              : `exceeds the round-1 ceiling on ${candidate.budget.exceedsPriorCeiling.join(
                  ' and ',
                )}`}
            .
          </p>
        </div>
      ) : null}
      {accretionVariant ? (
        <p
          role="note"
          data-island-accretion-legend="true"
          style={{
            boxSizing: 'border-box',
            flex: '0 0 auto',
            width: '100%',
            maxWidth: '72rem',
            margin: '0 auto',
            padding: '0.35rem clamp(0.6rem, 2vw, 1rem)',
            fontSize: 'clamp(0.72rem, 1.7vw, 0.9rem)',
            lineHeight: 1.35,
          }}
        >
          <strong>connected accretion</strong> grows one real SVG cell from a shared edge; the{' '}
          <strong>adjacency wave</strong> moves outward with a{' '}
          <strong>local geometric reveal</strong>, then the real coast finishes in{' '}
          <strong>coastline settlement</strong>.
        </p>
      ) : null}
    </div>
  );
}
