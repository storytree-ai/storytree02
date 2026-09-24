// TreeView — the story world (#/tree).
//
// A Dorfromantik-style hex-tile world that READS AS A TREE (ADR-0036 d.6):
// islands are dependency-ranked — the most-depended-upon stories sit at the
// bottom centre and dependents fan upward and outward, so the eye traces the
// load-bearing foundation up through the canopy. Every story claims a
// TERRITORY of extruded hexagonal tiles (one tile quota per capability plus a
// margin) and grows ONE central story tree — the story itself, crown sized by
// capability count, GROWTH and foliage carrying the lifecycle (ADR-0038): a
// young amber tree while proposed or claimed-but-empty (building wears proposed
// too — wisps carry live work), a full brownfield tree when mapped, deep green
// when healthy, withered to bare branches when unhealthy. Retired units don't
// render at all (worldStatus.ts). HUE CARRIES
// PROOF (ADR-0040): deep green only ever derives from a signed pass in
// events.verdict — authored status can never paint it — and the crown greens
// only from the story's OWN UAT verdict, never a child roll-up (ADR-0033
// d.4). Each capability owns a parcel whose flora density is a deterministic
// compression of its declared, test-proven contracts; a capability whose last
// signed run failed — or whose status is unhealthy — grows withered marks.
// There are no ✓/✗ badges in the world: the hue IS the verdict (precise facts
// stay in the panel and tooltips). The witness signpost and scenery-only
// conifers/wheat are retired (ADR-0238).
// Story-level `depends_on` (∪ derived cross-story capability deps) renders as
// roads; hovering a territory lights its upstream chain (gold) vs downstream
// dependents (red) — the focus interaction carried from V1's
// visualisations/storytree. Clicking opens the side panel with the story's
// capability sub-DAG (dagre layout, status-strip cards). A legend bar docked
// at the top of the frame maps the visual vocabulary, one entry per model
// with expandable state fans (WorldLegend.tsx); its status fan doubles as the
// status filter.
//
// Data is /api/tree — offline, straight from stories/ frontmatter; verdict
// glyphs and build/claim wisps are advisory layers that appear only when the
// live store answers. All "randomness" (tile growth, crown-blob jitter, road
// bows) is hashed from ids so the world renders identically every time.

import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import dagre from '@dagrejs/dagre';
import { describeClaimRuntime, type ClaimRuntime } from '@storytree/notice-board';
import { api } from '../api';
import { useAppData } from '../lib/appData';
import { unresolvedAssetReason, unresolvedDocReason } from '../lib/docsIndex';
import { usePannable } from '../lib/pannable';
import { readPayloadCache, writeTreeCache } from '../lib/payloadCache';
import { isBuildInFlight } from '../lib/activity.js';
import { useBuildActivity, useClaimActivity } from '../lib/buildActivity';
import { claimColourState } from '../lib/claimColour';
import { formatAge } from '../lib/format';
import {
  claimBand,
  formatLastHeard,
  partitionClaimGroups,
  CLAIM_ABANDONED_DISPLAY_MS,
} from '../lib/claimBands';
import { useNowTick } from '../lib/poll';
import { useSessionClaimGroups } from '../lib/sessionClaims';
import { assetHref, docHref, navigate, treeFocusHref, treeHref } from '../lib/route';
import { presentStories } from '../lib/worldStatus.js';
import { mapChromeClearance, nameplateLayout, type NameplateLayout } from '../lib/nameplate.js';
import {
  packWorld,
  groundHeroTile,
  type CapSpot as LayoutCapSpot,
  type DecorSpot as LayoutDecorSpot,
  type Territory as LayoutTerritory,
  type HexWorld as LayoutHexWorld,
  type PackOptions,
  type SpacingTuning,
} from '@storytree/forest-layout';
import { readLandView } from '../lib/landView.js';
import { readLandMount, readLandMountProps } from '../lib/landViewMount.js';
import { LandView } from './LandView.js';
import { LandViewMount } from './LandViewMount.js';
import { readSceneExport, sceneExportBridge } from '../lib/sceneExport.js';
import {
  WorldLegend,
  LegendDrawerBody,
  legendRowLabel,
  legendModelFor,
  type RowKey,
} from './WorldLegend.js';
import { flyoutReducer, FLYOUT_CLOSED } from '../lib/panelFlyout.js';
import {
  controlByKey,
  readControlValue,
  readRenderScene,
  GROUP_INTRO,
  type ControlSpec,
} from '../lib/worldSettings.js';
// ADR-0283 D2: `../lib/stressLayout.js` is no longer imported here — DAG rows are the one map
// arrangement. The module stays (tested) because `stressSeeds` still serves
// `overviewConstellation.ts`; its radial sibling `solarLayout.ts` had no caller left and is deleted.
import { arrivalGrowPlan } from '../lib/trailReveal.js';
import { fullConnectionSet } from '../lib/connectionSet.js';
import {
  fitWorld,
  restingWorld,
  limitsForResting,
  limitsForFit,
  clampScale,
  centerOn,
  panBy,
  zoomAt,
  act2RegrowCamera,
  type Camera,
  type ScaleLimits,
} from '../lib/worldCamera.js';
import {
  cameraCompositorTransform,
  deliverWorldCameraFrame,
  sameWorldCameraVisualIdentity,
  type WorldCameraFrameDelivery,
} from '../lib/worldCameraFrameDelivery.js';
import {
  countActiveStructuralAnimations,
  motionSettledSnapshot,
  readStructuralAnimations,
  MOTION_SETTLED_BRIDGE_KEY,
  type MotionSettledBridge,
} from '../lib/motionSettled.js';
import {
  promotedStamps,
  stampsByCarrier,
  sharedIslandStories,
  storyIcon,
  ICON_SHAPES,
} from '../lib/buildingLayout.js';
import {
  loadHeroTreeVariants,
  type BakedStoneAsset,
} from '../lib/factoryBuildings.js';
import { ConnectionsSection } from './ConnectionsSection.js';
import { DetailDisclosure } from './DetailDisclosure.js';
import { BottomDock } from './BottomDock.js';
import { WorldSettingsPanel } from './WorldSettingsPanel.js';
import { LibraryDrawer } from './LibraryDrawer.js';
import { ArcSurface } from './ArcSurface.js';
import { useArcRollups } from '../lib/arcRollups.js';
import { floorHealthBand, useFloorHealth } from '../lib/floorHealth.js';
import { FloorHealthLamp } from './FloorHealthLamp.js';
import { storeConnection, type StoreConnectionReading } from '../lib/storeConnection.js';
import { StoreConnectionChip } from './StoreConnectionChip.js';
import type { StorePhase } from './StoreBanner.js';
import { readDrawerLens, DEFAULT_DRAWER_LENS, type DrawerLens } from '../lib/drawerLens.js';
import { LibraryFinder } from './LibraryFinder.js';
import { LibraryFocusGraph } from './LibraryFocusGraph.js';
import { LibraryOpenOverlay } from './LibraryOpenOverlay.js';
import { LibrarySelectionCard } from './LibrarySelectionCard.js';
import { adrStatusOf, type SearchResult } from '../lib/librarySearch.js';
import type { BuildActivity, ClaimActivity, DepartedClaim, DocMeta, GuidanceAsset, SessionClaimGroup, TreeCapability, TreeStory, TreeVerdict, UatTestCriterionRow } from '../types';
import {
  hash,
  rand01,
  type Pt,
  HEX_R,
  TILE_DEPTH,
  projectGround,
  axialKey,
  hexCenter,
  pixelToHex,
  hexPath,
  polyPath,
  tileUnits,
  type ArtRungs,
  TILE_SCALE,
  TREE_SCALE,
  PLATE_SCALE,
  crownRadius,
  smoothLoopPath,
  type SubstrateMode,
  type SubstrateTuning,
  type RelaxedCell,
  MESH_TUNING,
  buildRelaxedCells as buildRelaxedCellsFromTiles,
  buildScene,
  trailFillWidth,
  wispBand,
  type SceneInput,
  type SceneGardenInput,
  type SceneVegHeroTrees,
  type SceneVegetationInput,
  type SceneStatus,
  type ScenePlantInput,
  type SceneTerritoryInput,
  type ClaimGrade,
  type BuildPhase,
} from '@storytree/forest-world';
import {
  neighbourHighlightPlan,
  laneLayout,
  normalizeWorldPresentationModel,
  deriveForestRegrowAccretionPlans,
  deriveIslandVegetationPlans,
  WorldSceneView,
  type WorldPresentationEvents,
  type WorldPresentationModel,
} from '@storytree/app-surface';
import { parseStyleSheet, type SpriteStyleSheet } from '../lib/sprite-sheet.js';
import { SemanticGrowthDemo } from './SemanticGrowthDemo.js';
import {
  readAct2Intro,
  readVegetationGrowthOff,
  act2IntroAlreadyArrived,
  act2IntroStorage,
  markAct2IntroArrived,
  useAct2Intro,
  useStableForestRegrowTrails,
  useReducedMotion,
  useStableForestRegrowLayer,
  useStableVegetationLayer,
} from './act2Intro.js';
import { Act2IntroControl } from './Act2IntroControl.js';
import {
  CAMERA_RASTERISATION_EXPECTED_ISLANDS,
  CAMERA_RASTERISATION_PROTOCOL,
  applyCameraRasterisationTransform,
  readCameraRasterisationRoute,
  type CameraRasterisationProbeSnapshot,
} from './cameraRasterisationProbe.js';

// The current `?…` search string, SSR-guarded ('' when there is no window). The
// panel-exposed readers default to this so non-panel call sites (and SSR) keep
// working unchanged; the panel threads a state-held search string instead so the
// world re-renders live without a reload.
function defaultSearch(): string {
  return typeof window === 'undefined' ? '' : window.location.search;
}

// Resolve the panel-exposed controls ONCE from the worldSettings schema (the single
// source of truth for their defaults + clamps). The readers above consume these so
// the literals live in exactly one place. `controlByKey` is total over these keys —
// they are declared in CONTROLS — so a miss is a programmer error, surfaced loudly.
function requireControl(key: string): ControlSpec {
  const c = controlByKey(key);
  if (!c) throw new Error(`worldSettings: missing control "${key}"`);
  return c;
}
// (the `layout` control retired with ADR-0283 D2 — DAG rows are the one arrangement now)
const ART_STYLE_CTL = requireControl('artStyle');
const ART_SCALE_CTL = requireControl('artScale');
const SELECTION_MOTION_CTL = requireControl('selectionMotion');
const REGROW_SPEED_CTL = requireControl('regrowSpeed');

/** Shared empty id-set (the DAG path passes no hub ids). */
const EMPTY_ID_SET: ReadonlySet<string> = new Set();

// ---------- world building ----------

// `MARGIN` and the one-hex `MOAT_HEXES` moved into `@storytree/forest-layout` with the packer
// (ADR-0537 D1) — they are its own constants and nothing else here read them.
// `resting-view-still-clips-five-islands`: the resting camera fit's own `padding: 16` guarantees only
// 16px of headroom at whichever vertical edge `buildWorld`'s bounds happen to sit snug against — but
// TWO pieces of UI chrome are PERMANENTLY docked over the map at rest, and 16px does not clear either:
// the collapsed `.library-drawer` handle (top-centre, ~27px tall — `.library-drawer-handle-bar`'s
// `padding: 3px 12px` plus its grip) and the folded `.terminal-dock` bar (bottom, full-width, ~35px
// tall — `.terminal-dock-unavailable`). Neither is a `buildWorld` concern (they are chrome, not scene
// content) and neither should ever cause the WORLD ITSELF to reflow when opened/resized (the
// `.tree-layout` design note: "opening, expanding, or resizing any of them never reflows or rescales
// the world") — this only widens the ONE-TIME resting fit computed on mount/resize, not a live
// per-panel recompute, so that invariant is untouched. Sized to the chrome's own COLLAPSED/folded
// height plus a visible buffer (never flush against it): `FIT_PADDING_TOP` clears the drawer handle,
// `FIT_PADDING_BOTTOM` the terminal bar.
/** Every island's on-screen DIAMETER, the quantity the designed resting frame is pinned to
 *  (ADR-0471). `Territory.radius` is already SCREEN-projected, which is the same space
 *  `buildWorld`'s `width`/`height` are in — feeding the ground radius here instead would size the
 *  composition in one space and the bounding box in another, which is the exact mismatch
 *  `scene-territory-radius-states-its-space` split the two fields to make a type error. */
function islandDiametersOf(world: { territories: readonly Territory[] }): number[] {
  return world.territories.map((t) => 2 * t.radius);
}

const FIT_PADDING_TOP = 40;
const FIT_PADDING_BOTTOM = 48;
// ADR-0521 (owner-directed 2026-09-05): the three absolute spacing constants that used to stand
// here — `RANK_GAP` 40, `ISLAND_GAP` 60, `RANK_SWING` 140, halved on the owner's 2026-08-16 look
// (`islands-sit-too-far-apart-and-the-resting-zoom-is-too-far-out`) — are RETIRED. Every gap is now
// a fraction of the islands it separates (`@storytree/forest-layout`'s `spacing.ts`): the same input the island's own
// size comes from, so the layout is derived end to end and the 3D map, which reads these positions
// and lays out nothing of its own, inherits it. What the 2026-08-16 note measured still holds in
// kind: the row gap drives the resting zoom (it sets the world's VERTICAL extent, which `fitWorld`'s
// 'contain' fit is bound by), the in-row gap re-shapes the horizontal spacing, and the hex-lattice
// growth floor below (`floor = ringsOf(...) + ringsOf(...) + 1`) is what protects island integrity,
// not the gaps — which is why rung 0 of the ladder is a legal layout and not a collision.

const RIVER_FAN_STEP = 0.34; // rad (~19°) of shore between adjacent river mouths leaving one source
const RIVER_FAN_MAX = 2.5; // rad (~145°) widest arc a source's outgoing delta fans across
const LANE_GAP = tileUnits(13); // ground units (13 on the radius-27 tile) centre-to-centre between adjacent metro lanes sharing a corridor (a shared sand braid-bar)
const LANE_WINDOW = 0.4; // fraction of each river's length over which it blends from its true dock/mouth into the shared corridor
const MOUTH_FLARE = tileUnits(14); // ground units (14 on the radius-27 tile) offshore the merged trunk fuses before diving head-on into the single coast mouth

// The laid-out world's SHAPE is `@storytree/forest-layout`'s (ADR-0537 D1), specialised here to the
// studio's own story/capability types — the packer carries the caller's objects through untouched,
// so `t.story` is still a full `TreeStory` and `c.cap` a full `TreeCapability`. These aliases exist
// so the several hundred references below, and every importer of this module, read exactly as they
// did when the four interfaces were declared here.
export type CapSpot = LayoutCapSpot<TreeCapability>;
export type DecorSpot = LayoutDecorSpot;
export type Territory = LayoutTerritory<TreeStory>;
export type HexWorld = LayoutHexWorld<TreeStory>;

// `nameplateLayout` + `NameplateLayout` MOVED to `../lib/nameplate.js` (ADR-0598 D2) so the packer's
// chrome clearance can be derived from the same function the plate is drawn from without importing
// this React module. Re-exported here so every existing importer is unchanged.
export { nameplateLayout, type NameplateLayout };

/**
 * The panel bookshelf-landmark anchor (ADR-0088 follow-on, owner 2026-06-22): a shared-island
 * card draws its bookshelf glyph just OUTSIDE the name card, to its RIGHT and bigger — not inside
 * the plate. Pure geometry: the glyph's centre sits `margin` px past the plate's right edge
 * (`centroidX + w/2`); its base aligns to the card's bottom (`labelY + h`) so the enlarged glyph
 * rises beside the card. The caller folds the glyph's half-width into `margin` so its left edge
 * clears the card. Unit-tested (sharedIslandPanel.test.ts) — the look (scale, gap) is owner-attested.
 */
export function bookshelfAnchorRight(
  plate: NameplateLayout,
  centroidX: number,
  labelY: number,
  margin: number,
): Pt {
  return { x: centroidX + plate.w / 2 + margin, y: labelY + plate.h };
}

/** ADR-0033 d.3 vocabulary — the one source for every verdict phrase. */
function verdictPhrase(v: TreeVerdict): string {
  return v.outcome === 'pass' ? '✓ proven' : '✗ last run failed';
}

// `groundHeroTile` moved to `@storytree/forest-layout` with the packer that calls it (ADR-0537 D1).
// Re-exported so the suites and callers that name it here still find it.
export { groundHeroTile };
//
// `groundPolarOffset` DIED here, and its comment died with it. It was a deliberate LOCAL copy of
// arithmetic `packages/forest-world/src/scene.ts` already held, and that comment gave the reason in
// terms: reaching into that package owed an engine sync and a web pin bump for two lines. It was the
// evidence ADR-0537 rests on and was kept until this landing on purpose. The decision ruled the toll
// may not draw the boundary, so there is now ONE definition — exported from
// `@storytree/forest-world`'s `camera.ts`, beside the `projectGround` it is a polar spelling of —
// read by both the scene scatters and the packer's garden ring.

/**
 * A ground-space coast loop, drawn for THIS painter at the declared camera — project, then smooth,
 * the same order `buildCoast` applies in the core (ADR-0527 D1). The legacy inline render and the
 * island panel are painters, so they do their own projecting now that the layout hands out a
 * surface rather than a drawing.
 */
function coastScreenPath(loop: Pt[]): string {
  return smoothLoopPath(loop.map((p) => projectGround(p)));
}

/**
 * The studio's `buildWorld`: the CHROME HALF of the map layout, over `@storytree/forest-layout`'s
 * chrome-free packer (ADR-0537 D1). The packing itself — the ranked seeding, the growth floor and
 * its moat, the grower, the garden ring, the coastline, the trail routing — moved into that package
 * unchanged. What stayed here is the two studio rules it was tangled with, and this is the seam
 * ADR-0537 required rather than a convenience:
 *
 *   • ADR-0076 §2 / ADR-0088 — stories tagged `render: building` (e.g. `library`) are EXCLUDED from
 *     the laid-out territories (they live in the Shared Islands panel now, not the map). The packer
 *     is never told what a building IS; it is simply not handed one. With the building gone from
 *     `stories`, no edge or rank to it exists, so its many inbound roads can never flood the map
 *     (the reason the earlier edgeless-island machinery existed — now unnecessary).
 *   • ADR-0102 (owner-directed, 2026-06-25) — a building PROMOTES every edge incident to it from a
 *     road to a per-island icon STAMP, in BOTH directions: "you carry the icon of what you depend
 *     on". The promotion is computed from the FULL list, so the buildings' own incident edges are
 *     visible, BEFORE the buildings are excluded — then handed over, and the packer only seats each
 *     icon on owned land.
 *
 * `buildings` is the DEFAULT since the owner attested it (the component passes `readBuildings`,
 * default true / escape `?buildings=off`); `false` is the bare-call fallback ⇒ the building is a
 * normal connected island and no stamps. When a single building story is passed with
 * `buildings: false`, it lays out as one plain island — exactly the one-island Territory the Shared
 * Islands panel renders per building.
 */
export function buildWorld(
  allStories: TreeStory[],
  opts?: {
    plantsScatter?: boolean;
    buildings?: boolean;
    /** ADR-0521 — the spacing dial, exactly the `readSubstrateTuning` dial pattern below (mesh
     *  jitter/relax/etc): absent ⇒ the shipped `ISLAND_SPACING_RATIO` (unchanged callers). `legacy`
     *  stands the three pre-ADR-0521 absolute gaps for an instrument's control arm. */
    spacing?: Partial<SpacingTuning>;
    /** ADR-0527 D1 item 1 — WHICH CAMERA the screen half of the layout is projected at; absent ⇒
     *  the shipped `LAND_CAMERA_ELEVATION_DEG`, so every current caller is byte-unchanged. It
     *  re-projects the drawing and re-decides nothing: the packer takes every layout decision at
     *  `PLAN_VIEW_ELEVATION_DEG` and those are camera-independent. It exists so the registration
     *  work can RENDER a second camera's arm; it does not pick one, which is an owner look.
     *
     *  ⚠ IT DOES NOT MOVE THE NAMEPLATE CLEARANCE EITHER (ADR-0598 D2). The clearance is taken at
     *  the DECLARED camera in `mapChromeClearance`, never at this one, which is what keeps an
     *  elevation arm a re-projection of one layout rather than a second layout. */
    elevationDeg?: number;
    /** ADR-0598 D2's scale-back dial (ADR-0503) — `?plateRoom=` on the map. Multiplies the nameplate
     *  clearance the packer is given; absent ⇒ 1 (the full clearance), 0 ⇒ the pre-ADR-0598 map,
     *  which is the control arm a comparison page stands on. */
    chromeScale?: number;
  },
): HexWorld {
  const buildings = opts?.buildings ?? false;
  const buildingIds = new Set(
    buildings ? allStories.filter((s) => s.building === true).map((s) => s.id) : [],
  );
  const carriedIcons: ReadonlyMap<string, readonly string[]> = buildingIds.size
    ? stampsByCarrier(
        promotedStamps(
          allStories.map((s) => ({ id: s.id, dependsOn: s.dependsOn, consumedBy: s.consumedBy })),
          buildingIds,
        ),
      )
    : new Map<string, readonly string[]>();
  const excludedIds: ReadonlySet<string> = buildingIds.size ? buildingIds : EMPTY_ID_SET;
  const stories = excludedIds.size
    ? allStories.filter((s) => !excludedIds.has(s.id))
    : allStories;
  // Built in steps rather than spread-conditionally: under `exactOptionalPropertyTypes` an absent
  // `spacing` and one present-and-undefined are different things, and the packer's default depends
  // on the difference.
  const packOpts: PackOptions = { plantsScatter: opts?.plantsScatter ?? false, carriedIcons };
  // ADR-0598 D2 — tell the packer how much ground THIS surface's nameplates need, so a plate never
  // lands on a neighbouring story's land. Derived from `nameplateLayout` (the same function the
  // plate is drawn from) at the DECLARED camera, over the ids that actually reach the map.
  packOpts.chrome = mapChromeClearance(stories.map((s) => s.id), opts?.chromeScale);
  if (opts?.spacing) packOpts.spacing = opts.spacing;
  // By statement for the reason `spacing` is: under `exactOptionalPropertyTypes` an absent key and
  // one present-and-undefined are different inputs, and only the first leaves the packer on its own
  // default — which is what "every current caller is byte-unchanged" rests on.
  if (opts?.elevationDeg !== undefined) packOpts.elevationDeg = opts.elevationDeg;
  return packWorld(stories, packOpts);
}

// ---------- relaxed substrate (the island ground) — ADR-0093 shared core ----------
//
// The relaxed Townscaper mesh + the organic coastline are the shared render core now
// (@storytree/forest-world): the studio and the public website render the SAME
// substrate from it. This thin adapter is all that stays studio-side — it hands the
// core's pure builder the layout-agnostic (drawTiles, wheatSets) pair it wants, so the
// studio's call sites + tests keep passing a `HexWorld`. The substrate MODE + tuning
// are still read from the URL below (studio chrome). `MESH_TUNING` / `SubstrateMode`
// are re-exported so importers that resolved them from TreeView (sharedIslandPanel.test.ts)
// keep working while the geometry lives in the core.

export function buildRelaxedCells(
  world: HexWorld,
  mode: SubstrateMode,
  override: Partial<SubstrateTuning>,
): RelaxedCell[] {
  const wheatSets = world.territories.map((t) => t.wheatTiles);
  return buildRelaxedCellsFromTiles(world.drawTiles, wheatSets, mode, override);
}

export { MESH_TUNING };
export type { SubstrateMode };

// ---------- the shared scene-graph adapter (ADR-0093, strategy C, Unit 2b) ----------
//
// `worldToScene` is the studio's thin FOLD of its `HexWorld` into the core's neutral
// `SceneInput` contract (the design fork → option b: `buildWorld` stays studio-side
// because it carries studio chrome — building stamps, bookshelf consumers; the core owns the
// LOOK, the surface folds its data into the contract). It folds ONLY presentation
// facts the surface owns — the proof/live-data → status fold is already in the
// (presented) stories, wisps from in-flight builds,
// nameplate text + tooltips are the studio's vocabulary. The core derives every
// hash-seeded variant/jitter from the ids. `buildScene(worldToScene(...))` then yields
// the drawable tree the React mapper (`SceneView`) walks.

function capToScene(spot: CapSpot, now: Date): ScenePlantInput {
  const cap = spot.cap;
  const st = (cap.status ?? 'unknown') as SceneStatus;
  const verdictNote = cap.verdict ? ` · ${verdictPhrase(cap.verdict)}` : '';
  const plant: ScenePlantInput = {
    id: cap.id,
    status: st,
    // ADR-0527 D1 (`anchorSpace: 'ground'`): the GROUND spot, which `buildScene` projects back onto
    // `spot.x`/`spot.y` when it draws at the declared camera.
    x: spot.groundSpot.x,
    y: spot.groundSpot.y,
    title: `${cap.id} — ${cap.error ? 'spec error' : st}${verdictNote}`,
  };
  return plant;
}

// The parcel input shape + its theme tag, DERIVED from the core's exported `SceneTerritoryInput`
// (forest-parcels inc 1) — the element type of its `parcels` field, so the studio fold builds exactly
// the contract's declared shape (and needs no extra barrel export from the read-only core package).
type SceneParcelInput = NonNullable<SceneTerritoryInput['parcels']>[number];
type SurfaceTheme = SceneParcelInput['theme'];

/** The three parcel SURFACE THEMES (forest-parcels inc 1) — the deterministic theme-pick pool. */
const PARCEL_THEMES: SurfaceTheme[] = ['meadow', 'woodland', 'heath'];

/** A DETERMINISTIC theme for a capability parcel (forest-parcels inc 1) — hashed from the capId (the
 *  file's `hash` idiom, NEVER Math.random) so parcels vary within and across islands and a given cap
 *  always surfaces the same country. A Stage-1 default the owner reviews later. */
function parcelTheme(capId: string): SurfaceTheme {
  return PARCEL_THEMES[hash(capId) % PARCEL_THEMES.length]!;
}

/** Fold a laid-out capability into its PARCEL input (forest-parcels inc 1): the capId (the hover /
 *  delegation hook + the deterministic flora seed), the cap's folded status (the per-cell ground tint
 *  — the SAME status the plant/flora render uses, {@link capToScene}), its declared testCount (the
 *  algorithmic flora-density knob, 0 ⇒ bare ground), a deterministic theme, and the cap's buildWorld layout
 *  position as the natural Voronoi seed. */
function capToParcel(spot: CapSpot): SceneParcelInput {
  const cap = spot.cap;
  return {
    capId: cap.id,
    status: (cap.status ?? 'unknown') as SceneStatus,
    testCount: cap.testCount,
    theme: parcelTheme(cap.id),
    // The GROUND seed — `buildScene` projects it into `relaxedCells`' own space under the island's
    // `anchorSpace: 'ground'` tag, so the Voronoi partition lands exactly where it did.
    seed: { x: spot.groundSpot.x, y: spot.groundSpot.y },
  };
}

/**
 * Mirrors `DEPARTURE_WINDOW_MS` from `@storytree/notice-board` (packages/notice-board/src/claim.ts)
 * locally — apps/studio/src is browser-bundled and stays dependency-light at this data-shape layer
 * (the SAME move `apps/studio/server/inFlightActivity.ts` makes for its own `CLAIM_STALE_RECLAIM_MS`
 * mirror): how long (ms) a released claim still renders as a fading DEPARTURE wisp (ADR-0200 D7).
 */
const DEPARTURE_WINDOW_MS = 120_000; // 2 minutes

/** A departure's fade progress (0..1) — how far through {@link DEPARTURE_WINDOW_MS} its release
 *  sits, clamped so a stale/late-arriving row can never overshoot (defense in depth; the server + the
 *  notice-board fold already bound the window server-side, ADR-0200 D7). Pure: ageMs in, ratio out. */
function departureAgeRatio(ageMs: number): number {
  return Math.max(0, Math.min(1, ageMs / DEPARTURE_WINDOW_MS));
}

/**
 * ADR-0200 D7's WAITING ORDER CONTRACT (forest-world's `buildClaimWisps`): a `waiting` claim's queue
 * position is its INDEX in input order, so the surface must hand the core its claims sorted by
 * `claimedAt` ascending — the same order the claim ledger already keeps (oldest waiter first in
 * line). Sorting the WHOLE array ascending by `at` is sufficient and leaves the hover/orbit grades
 * unaffected (their geometry is hash-derived from `key`, never from array position). Pure + stable;
 * exported for the unit test (`orderClaimsForScene.test` / TreeView.test.ts).
 */
export function orderClaimsForScene(claims: ClaimActivity[]): ClaimActivity[] {
  return [...claims].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** The claim wisp's tooltip title, GRADE-aware (ADR-0200 D7) — same "a claim, not a proof" voice for
 *  every grade, so hovering/queueing read as the SAME coordination signal as the classic orbit, just
 *  at a different geometry. Shared by the scene path ({@link territoryToScene}) and the legacy inline
 *  render (`TerritoryFlora`) so the two tooltips can never drift. */
function claimWispTitle(c: ClaimActivity, now: Date): string {
  const grade = c.grade ?? 'work';
  const verb =
    grade === 'exploring' ? 'is exploring' : grade === 'waiting' ? 'is waiting to work' : 'is working';
  return `${c.unitId} — ${c.branch} ${verb} this story (${c.intent}) · claimed ${formatAge(c.at, now)} — a claim, not a proof`;
}

/** ADR-0212 multi-run collapse. The build wisp was keyed by `runId`, so N concurrent runs on one
 *  story drew N orbiting bodies; merged onto the ONE session body they collapse to one, which forces
 *  a resolution rule: **RED WINS**. A green on one run must never mask a red on another — the map
 *  would then read "proving fine" while a sibling run sits failing. Ranked red < building < green,
 *  lowest wins; ties keep input order. Exported for the unit test. */
const PHASE_BAND_RANK = {
  AUTHOR_TEST: 0,
  CONFIRM_RED: 0,
  IMPLEMENT: 1,
  CONFIRM_GREEN: 2,
  GATE: 2,
} satisfies Record<BuildPhase, number>;

export function resolveBuildPhase(builds: BuildActivity[]): BuildPhase | undefined {
  if (!builds.length) return undefined;
  let best: BuildPhase | undefined;
  for (const b of builds) {
    if (!b.phase) continue;
    if (best === undefined || PHASE_BAND_RANK[b.phase] < PHASE_BAND_RANK[best]) best = b.phase;
  }
  // A LIVE build whose row never stamped a phase (a pre-ADR-0048 mark, or the json read) still has
  // to read as building — otherwise the flip would silently drop "someone is building here" on
  // those rows. `IMPLEMENT` is the phase that folds to `wispBand`'s documented neutral `building`
  // band, i.e. byte-identical to what the old phase-less build wisp already showed. The value never
  // surfaces as prose — only the band is read from it (the tooltip is built from the claim).
  return best ?? 'IMPLEMENT';
}

/**
 * The `now` the SCENE should render against, so the 60s age-ticker doesn't rebuild a byte-identical
 * idle map (the studio-map idle-rebuild, ADR-0069 / memory `studio-map-svg-scaling-wall`). The scene
 * only reads `now` to age content that is actually present — a wisp title ("claimed 2m ago") — so
 * while nothing ages, the scene is identical every tick and the ticker should be frozen OUT of the
 * scene memo.
 *
 * Advance to the live `now` whenever anything ages with it, which since ADR-0529 is exactly one
 * thing: a build / claim / departure wisp. The verdict bloom used to be the other, and it needed a
 * FALLING EDGE too — one final tick after the last bloom aged out, because a bloom crossing its
 * window is a now-driven change no poll reports and freezing one step early left a ghost. Nothing
 * remaining here ages on a window of its own: a wisp's presence is what the poll reports, and its
 * disappearance arrives as new data rather than as the clock crossing an edge. So the falling-edge
 * input went with the bloom rather than being kept "just in case" — a parameter no caller can make
 * true is a parameter no test can hold. Otherwise return the frozen `prevSceneNow` so the scene memo
 * sees an unchanged input and skips the rebuild.
 *
 * Pure so it is unit-testable; the caller holds `prevSceneNow` in a ref.
 */
export function nextSceneNow(now: Date, prevSceneNow: Date, hasWisps: boolean): Date {
  return hasWisps ? now : prevSceneNow;
}

/** ADR-0212's join, surface-side, re-keyed by ADR-0326: fold each live build onto the work body of
 *  the session that CLAIMED THE UNIT IT IS BUILDING.
 *
 *  THE JOIN KEY IS THE CLAIMED UNIT, NOT THE STORY. Both layers reach here already grouped to the
 *  story — `buildsByStory` / `claimsByStory` resolve a member id UP to its owning story — so "same
 *  group" means "same territory", never "same actor". ADR-0212 joined at that group and argued it
 *  was sound from the ADR-0200 D2 mutex, but the mutex is per UNIT ID, so story grain is the one
 *  grain at which it guarantees nothing. Two shapes broke it, and the second predates the story
 *  chain's per-member claim (PR #1220):
 *    - a MEMBER build lands in the group of a story-grain claim it never took — so a `story build
 *      S --real` (which now claims S's members) or a `node build cap-of-S --real` (which never
 *      claimed S at all) painted its phase onto an unrelated session's body;
 *    - TWO work claims on one story are legitimate under ADR-0270 D1 (disjoint capabilities), and
 *      the old `claims.find(work)` handed the band to whichever sorted first, not to the builder.
 *
 *  WHY UNIT GRAIN IS SOUND — the mutex finally doing real work. A build visible in this layer has
 *  necessarily taken the claim on the unit it builds: `nodeBuild` claims `spec.id` (ADR-0121) and
 *  the chain claims every node in its drive order (`packages/drive/src/chain-claims.ts`), and the
 *  per-unit claim store IS the `--store pg` pool's claim store — the same pool the `building` row
 *  had to reach to be readable here. So a build on U + a work claim on U is exactly one actor.
 *
 *  Two outcomes, and the second is the one that keeps the render honest:
 *  - the BUILT UNIT carries a work claim → that build's phase rides that body as the band (channel
 *    3), resolved per unit, so RED-WINS (ADR-0212's multi-run collapse) applies across the runs on
 *    ONE unit and never smears one unit's red onto another session's body.
 *  - the built unit carries NO work claim (an unattended build, CI, the website's demo data, or a
 *    finished run still inside its in-flight TTL) → a claim-LESS body is manufactured, keyed by the
 *    winning run so a single-run story keeps the exact orbit phase its old build wisp had. This is
 *    the fallback ADR-0212 calls for, and it is what lets the `wisps` layer stop being fed at all.
 *    It now also catches an unclaimed build under a CLAIMED story, which used to be absorbed
 *    silently into a stranger's body — one body per actor, and that was two actors.
 *
 *  `claims` must already be in the core's waiting-order (see {@link orderClaimsForScene}); the
 *  manufactured body is appended, which never disturbs a waiter's queue index. */
type SceneClaimInput = NonNullable<SceneInput['territories'][number]['claims']>[number];

export function foldBuildOntoClaims(
  claims: ClaimActivity[],
  builds: BuildActivity[],
  now: Date,
): NonNullable<SceneInput['territories'][number]['claims']> {
  const buildsByUnit = new Map<string, BuildActivity[]>();
  for (const b of builds) {
    const list = buildsByUnit.get(b.unitId);
    if (list) list.push(b);
    else buildsByUnit.set(b.unitId, [b]);
  }
  // Only a WORK claim can be the builder, so only work-claimed units absorb a build — an
  // `exploring`/`waiting` claim on a building unit leaves that build an orphan, exactly as a
  // story with no work claim always did.
  const workUnits = new Set(
    claims.filter((c) => (c.grade ?? 'work') === 'work').map((c) => c.unitId),
  );

  const folded = claims.map((c) => {
    const grade = c.grade ?? 'work';
    // only the WORK stage carries the band — window shopping and queueing are not building — and
    // only from the builds on THIS claim's own unit.
    const phase = grade === 'work' ? resolveBuildPhase(buildsByUnit.get(c.unitId) ?? []) : undefined;
    const body: SceneClaimInput = {
      key: c.sessionId,
      title: claimWispTitle(c, now),
      colourState: claimColourState(c.intent),
      grade,
    };
    if (phase) body.phase = phase;
    return body;
  });

  // The orphans keep ADR-0212's single manufactured body rather than one each: RED-WINS collapses
  // them, which errs toward showing the reddest live work rather than hiding it.
  const orphans = builds.filter((b) => !workUnits.has(b.unitId));
  const phase = resolveBuildPhase(orphans);
  if (!phase) return folded;
  const primary = orphans.find((b) => b.phase === phase) ?? orphans[0]!;
  return [
    ...folded,
    {
      key: primary.runId,
      title: `${primary.unitId} — building (${primary.tier})${primary.phase ? ` · ${primary.phase}` : ''} · ${formatAge(primary.at, now)} · run ${primary.runId} — a build, not a proof`,
      // a build with no claim is a PROOF drive with no declared intent — teal `proving`, never green
      // (the ADR-0138 §5 wall), unless the work-event stamped a real subagent role.
      colourState: primary.colourState ?? 'proving',
      grade: 'work' as const,
      phase,
    },
  ];
}

/** A departure's tooltip title (ADR-0200 D7 wisp-out legibility) — an honest "someone just left" note,
 *  never a proof or a still-claimed read. Shared by the scene path and the legacy inline render. */
function departureWispTitle(d: DepartedClaim, now: Date): string {
  return `${d.unitId} — a session departed ${formatAge(d.at, now)} ago (was ${d.grade}) — no longer claimed`;
}

function territoryToScene(
  t: Territory,
  now: Date,
  builds: BuildActivity[],
  claims: ClaimActivity[],
  departures: DepartedClaim[],
): SceneInput['territories'][number] {
  const story = t.story;
  const st = (story.status ?? 'unknown') as SceneStatus;
  const caps = story.capabilities.length;
  const withered = st === 'unhealthy';
  // buildingGlyph is always false on the map (ADR-0088: building islands live in the panel).
  const plate = nameplateLayout(story.id.length, t.buildingGlyph);
  const verdictNote = story.verdict ? ` · UAT ${verdictPhrase(story.verdict)}` : '';
  const territory: SceneTerritoryInput = {
    id: story.id,
    status: st,
    caps,
    // ADR-0527 D1: the anchors leave here in the GROUND plane and `buildScene` projects them, once,
    // at the camera it is asked for — which is what lets it be asked for a PLAN-VIEW scene and
    // actually return one. Until this landing they were frozen at the declared camera, so a
    // plan-view request came back with an un-flattened lattice under a foreshortened tree.
    anchorSpace: 'ground',
    centroid: t.groundCentroid,
    groundRadius: t.groundRadius,
    screenRadius: t.radius,
    treeSpot: t.groundTreeSpot,
    // The GROUND baseline, under the same tag (ADR-0545). `t.labelY` is its projected twin and is
    // what this file's own React chrome draws at; handing THAT one over while the tag says `ground`
    // is what left the marker scatter's fourth keep-out reading the camera.
    labelY: t.groundLabelY,
    coastGroundLoops: t.coastGroundLoops,
    decor: t.decor.map((d) => ({ x: d.x, y: d.y, seed: d.seed })),
    plants: t.caps.map((spot) => capToScene(spot, now)),
    treeTitle: `${story.id} — ${story.error ? 'story spec error' : st}${verdictNote}`,
    // ADR-0212: the separate build-wisp LAYER is no longer fed. Wisp count encodes SESSIONS, and a
    // session that both HOLDS and BUILDS a story used to draw two orbiting bodies 12px apart — an
    // unreachable state, since the work claim is an exclusive mutex (ADR-0200 D2). The build's only
    // signal the claim body didn't already carry (the red→green band) now rides the claim below.
    // The input itself survives until increment 3 deletes it from the core.
    wisps: [],
    // ADR-0138 §5 / ADR-0200 D7: one claim wisp per claim on this story — "a session is here"
    // (coordination, NOT a proof). Keyed by sessionId (its own stable identity); coloured by the
    // intent → colour-state; GRADED (hover / queue / orbit) by `grade` — an absent grade defaults to
    // `work` (the D2 back-compat orbit). Sorted ascending by `at` FIRST (orderClaimsForScene) so the
    // core's waiting-order contract (queue position = input index) reads oldest-waiter-first.
    //
    // ADR-0212 / ADR-0326: a live build folds its phase onto the WORK-grade body of the session that
    // CLAIMED THE UNIT IT BUILDS. `BuildActivity` still carries no session identity, so the join is
    // inferential — but at unit grain the ADR-0200 D2 mutex actually covers it, because a build only
    // reaches this layer through the same pg pool that took its per-unit claim. Both arrays are
    // grouped by STORY, which is a territory and not an actor: joining at that grain is what
    // ADR-0326 repairs. See {@link foldBuildOntoClaims}.
    claims: foldBuildOntoClaims(orderClaimsForScene(claims), builds, now),
    // ADR-0200 D7: recently-released claims still fading — the departure layer (wisp-out legibility).
    // Keyed by sessionId like a live claim; `ageRatio` folds the server's read-time `ageMs` snapshot
    // against the mirrored DEPARTURE_WINDOW_MS above.
    departures: departures.map((d) => ({
      key: d.sessionId,
      title: departureWispTitle(d, now),
      ageRatio: departureAgeRatio(d.ageMs),
    })),
    plate: {
      w: plate.w,
      h: plate.h,
      rx: plate.rx,
      idY: plate.idY,
      subY: plate.subY,
      idText: story.id,
      subText: story.error ? 'story spec error' : `${st} · ${caps} caps`,
      title: story.error ? `${story.id} — ${story.error}` : story.title,
    },
  };
  // forest-parcels inc 1: ONE parcel per capability (the land IS the capability). Every island WITH
  // caps carries parcels; the core sub-partitions the island's mesh cells among them (Voronoi over
  // each seed), tints each cell by its cap's status, grows themed flora with density ∝ testCount, and
  // RETIRES the decorative conifers + the one-plant-per-cap ring for a parcels-present island. An
  // empty-caps island stays parcels-ABSENT (no field) — the core's own back-compat semantics
  // (absent/empty ⇒ today's ground + conifers + plant ring, byte-for-byte).
  if (t.caps.length) territory.parcels = t.caps.map(capToParcel);
  // forest-parcels inc 2 (the UAT marker walk): a straight `{id, state}` pass-through of the
  // story's declared UAT criteria — the core owns the walk geometry + marker placement entirely;
  // the studio just threads the data through. OPTIONAL and back-compat: absent/empty ⇒ no walk
  // (the core's `buildUatMarkers` absence lock), exactly like `parcels` above.
  if (story.uatCriteria?.length) {
    territory.uatCriteria = story.uatCriteria.map((c) => ({ id: c.id, state: c.state }));
  }
  return territory;
}

/** Fold a studio `HexWorld` into the core's `SceneInput`. The routed trail network
 *  passes through VERBATIM (edge tooltips were folded in at routing time).
 *  `territories` is in owner order, the index `relaxedCells` / `drawTiles` /
 *  `wheatSets` key on. */
export function worldToScene(
  world: HexWorld,
  relaxedCells: RelaxedCell[] | null,
  now: Date,
  buildsByStory: Map<string, BuildActivity[]>,
  claimsByStory: Map<string, ClaimActivity[]> = new Map(),
  departuresByStory: Map<string, DepartedClaim[]> = new Map(),
  bakedStone: BakedStoneAsset | null = null,
  garden: SceneGardenInput | null = null,
  vegetation: SceneVegetationInput | null = null,
  /** ADR-0528 D2: art-rung overrides (an instrument's dial). Absent ⇒ the shipped drawing. */
  artRungs: ArtRungs | null = null,
): SceneInput {
  const scene: SceneInput = {
    offset: world.offset,
    width: world.width,
    height: world.height,
    empties: world.empties,
    relaxedCells,
    drawTiles: world.drawTiles,
    wheatSets: world.territories.map((t) => t.wheatTiles),
    trails: world.trails,
    territories: world.territories.map((t) =>
      territoryToScene(
        t,
        now,
        buildsByStory.get(t.story.id) ?? [],
        claimsByStory.get(t.story.id) ?? [],
        departuresByStory.get(t.story.id) ?? [],
      ),
    ),
  };
  // ADR-0218: the baked standing-stone solid, supplied only when `?factoryart=on` fetched it. The
  // core swaps each UAT marker's flat body for a `<use>` of this one def; absent ⇒ flat stones.
  if (bakedStone) scene.bakedStone = bakedStone;
  // ADR-0221 (grounded-art inc 11): the cosy-island garden, supplied only when `?garden=on` fetched
  // the heroes. The core composes them onto `garden.islandId`; absent ⇒ every island byte-for-byte.
  if (garden) scene.garden = garden;
  // ADR-0226 (grounded-art): the unified vegetation vocabulary, supplied only when `?veg=on`. The
  // core reads its presence to flip the vocabulary on the non-garden islands; absent ⇒ byte-for-byte.
  if (vegetation) scene.vegetation = vegetation;
  // ADR-0528: the shipped map draws on the derived tile, which is the builder's default — the tile
  // is stated only when a dial moves a rung, so a bare `#/tree` is byte-for-byte the default scene.
  if (artRungs && Object.keys(artRungs).length > 0) scene.tile = { hexR: HEX_R, rungs: artRungs };
  return scene;
}

/**
 * The forest map's ground tiling is ALWAYS the irregular Townscaper `mesh` (ADR-0233 retired the
 * `substrate` gear control + the `?substrate=` escapes: mesh won the look-off and is the one tiling,
 * no longer a dial). A module constant, not a URL read — the studio always builds the relaxed mesh
 * cells. The non-mesh `SubstrateMode` members live on in forest-world until the follow-on web-engine
 * unit removes them.
 */
const SUBSTRATE_MODE: SubstrateMode = 'mesh';

/** Live tuning overrides from the URL — let the owner dial the look in directly. */
function readSubstrateTuning(): Partial<SubstrateTuning> {
  if (typeof window === 'undefined') return {};
  const q = new URLSearchParams(window.location.search);
  const out: Partial<SubstrateTuning> = {};
  const num = (key: string): number | null => {
    const raw = q.get(key);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) ? v : null;
  };
  const j = num('jitter');
  const it = num('iters');
  const rx = num('relax');
  const sd = num('subdiv');
  const ws = q.get('wheatScatter');
  if (j !== null) out.jitter = j;
  if (it !== null) out.iters = Math.max(0, Math.round(it));
  if (rx !== null) out.relax = rx;
  if (sd !== null) out.subdiv = Math.max(1, Math.min(2, Math.round(sd)));
  if (ws !== null) out.wheatScatter = ws === '1' || ws === 'true';
  return out;
}

/** Live spacing overrides from the URL — the same "let the owner dial the look in directly"
 *  pattern as `readSubstrateTuning`. `?spacing=<ratio>` sets the ADR-0521 fraction (a ladder rung
 *  for an in-app side-by-side; the scene-export driver walks the ladder through it). All three of
 *  `?rankGap=&islandGap=&rankSwing=` together stand the pre-ADR-0521 ABSOLUTE gaps — the control arm
 *  (`?rankGap=40&islandGap=60&rankSwing=140` is the map as it stood before this landing); one or two
 *  of them is not a layout and is ignored. Absent ⇒ `buildWorld`'s own default, so a bare `#/tree`
 *  is the shipped ratio. */
function readSpacingTuning(): Partial<SpacingTuning> {
  if (typeof window === 'undefined') return {};
  return parseSpacingTuning(new URLSearchParams(window.location.search));
}

/**
 * `?elevation=<deg>` — WHICH CAMERA THE MAP IS DRAWN AT, for the owner look the increment
 * `the-two-layers-share-one-elevation` stages. Absent ⇒ `buildWorld`'s own default, which is the
 * shipped `LAND_CAMERA_ELEVATION_DEG` (20°), so a bare `#/tree` is the map everybody works in.
 *
 * ⚠ IT RENDERS AN ARM; IT DOES NOT PICK ONE. The 3D land canvas views true ground at 50° and this
 * map draws at 20°, and `registrationCamera` can only put the two layers on the same pixel when
 * `sin` of the two agrees (`apps/studio/src/lib/canvasRegistration.ts`). Which elevation they
 * should SHARE is an owner look (ADR-0070 stage 2) — 50° changes the surface everybody works in
 * every day, 20° gives up the depth ADR-0517 deliberately took — so this flag exists to render
 * both arms on the real forest for that look, exactly as `?restingView=fit` and `?spacing=` render
 * theirs. The DEFAULT is unchanged by design.
 *
 * ⚠ It moves the DRAWING and not the LAYOUT: `packWorld` decides tiles, ownership and the coast at
 * `PLAN_VIEW_ELEVATION_DEG` regardless, so the two arms are the same forest seen twice.
 *
 * A non-finite value, or one outside the open interval (0°, 90°], is not an elevation and is
 * ignored: at 0° the ground plane is edge-on and `sin e` is 0, which is a division by zero in the
 * registration arithmetic rather than a picture.
 */
export function parseMapElevation(q: URLSearchParams): number | null {
  const raw = q.get('elevation');
  if (raw === null) return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0 || v > 90) return null;
  return v;
}

function readMapElevation(): number | null {
  if (typeof window === 'undefined') return null;
  return parseMapElevation(new URLSearchParams(window.location.search));
}

/** Live 2D ART-RUNG overrides from the URL (ADR-0528 D2) — `?treeRung=&plateRung=&floraRung=&trailRung=`,
 *  each a factor on the shipped rung, so the art ladder can be captured from the running map
 *  (`scripts/export-tile-art-ladder.mjs`). Absent ⇒ the shipped drawing. */
function readArtRungs(): ArtRungs {
  if (typeof window === 'undefined') return {};
  return parseArtRungs(new URLSearchParams(window.location.search));
}

/** The pure half of `readArtRungs`. A rung must be a finite positive number; anything else is ignored. */
export function parseArtRungs(q: URLSearchParams): ArtRungs {
  const out: ArtRungs = {};
  const num = (key: string): number | null => {
    const raw = q.get(key);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  };
  const tree = num('treeRung');
  const plate = num('plateRung');
  const flora = num('floraRung');
  const trail = num('trailRung');
  if (tree !== null) out.tree = tree;
  if (plate !== null) out.plate = plate;
  if (flora !== null) out.flora = flora;
  if (trail !== null) out.trail = trail;
  return out;
}

/** The pure half of `readSpacingTuning`, so the dial's grammar is testable without a window. */
export function parseSpacingTuning(q: URLSearchParams): Partial<SpacingTuning> {
  const out: Partial<SpacingTuning> = {};
  const num = (key: string): number | null => {
    const raw = q.get(key);
    if (raw === null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v >= 0 ? v : null;
  };
  const ratio = num('spacing');
  if (ratio !== null) out.ratio = ratio;
  const rankGap = num('rankGap');
  const islandGap = num('islandGap');
  const rankSwing = num('rankSwing');
  if (rankGap !== null && islandGap !== null && rankSwing !== null) {
    out.legacy = { rankGap, islandGap, rankSwing };
  }
  return out;
}

/**
 * ADR-0598 D2's scale-back dial — `?plateRoom=<factor>` on the map, the same grammar as `?spacing=`.
 *
 * It multiplies the nameplate clearance `buildWorld` hands the packer, so the owner can look at a
 * ladder rather than at one arm (ADR-0503). **0 is the pre-ADR-0598 map** — the control arm a
 * comparison sheet stands, reachable from the running studio without a second build. Absent ⇒ 1,
 * the full clearance. Negative and non-numeric are ignored, exactly as `?spacing=` ignores them.
 */
export function parseChromeScale(q: URLSearchParams): number | null {
  const raw = q.get('plateRoom');
  if (raw === null) return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

function readChromeScale(): number | null {
  if (typeof window === 'undefined') return null;
  return parseChromeScale(new URLSearchParams(window.location.search));
}

/** `?restingView=fit` restores the PRE-ADR-0471 fitted framing, for an in-app side-by-side against
 *  the designed resting view — the same "let the owner dial the look in directly" pattern
 *  `readSpacingTuning` above established for the previous resting-view owner look.
 *
 *  It exists because the composition is operator-attested (ADR-0070 stage 2) and a verdict on a
 *  composition is only worth as much as the comparison it was made against: two screenshots taken
 *  minutes apart from different builds are a weaker artefact than one running app the owner can
 *  flip. It changes only the CAMERA — same corpus, same layout, same paint — so the flip isolates
 *  the framing and nothing else. Absent ⇒ the designed view. */
function readFittedRestingView(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('restingView') === 'fit';
}

/** `?plants=scatter` disperses the capability garden off its rigid front arc. */
function readPlantsScatter(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('plants') === 'scatter';
}

/**
 * The story-CLAIM layer flag (ADR-0138 §5 / ADR-0200 D7). LIVE BY DEFAULT: the flag RETIRES as the
 * default-off gate (unparking friction-claim-wisps-default-off), not as machinery — absence of
 * `?claims=` (and every legacy "on" spelling: `on`/`live`/`1`/`true`) now renders the real claims off
 * `/api/activity`, BY GRADE (`exploring` hovers, `waiting` queues, `work` orbits, ADR-0200 D7).
 * `'demo'` stays the DB-free preview seam: it injects a synthetic claim per grade PLUS a fading
 * departure across a few visible stories, so the whole vocabulary is previewable + deep-linkable
 * without a live DB (a render seam, like injecting `now` for wisp ages — a demo claim is honest: it
 * never paints green, the §5 wall holds even in demo). `'off'` (and its aliases `0`/`false`) is the
 * one remaining explicit escape hatch — no claim layer, no departure layer at all.
 */
export type ClaimsMode = 'off' | 'live' | 'demo';
export function readClaimsMode(search: string = defaultSearch()): ClaimsMode {
  const v = new URLSearchParams(search).get('claims');
  if (v === 'demo') return 'demo';
  if (v === 'off' || v === '0' || v === 'false') return 'off';
  return 'live'; // absence, and every legacy "on" spelling, both land here (D7 default flip)
}

/**
 * Synthetic DEMO claims (ADR-0138 §5 / ADR-0200 D7) for DB-free preview / deep-link attestation: one
 * claim per the first few visible stories, cycling both the three colour-state INTENTS and the three
 * GRADES, so the owner sees hover + queue + orbit — each in a distinct colour-state — at once. Honest
 * by construction — a demo claim carries `kind: "claim"` and an intent that folds to a coordination
 * state, so it can NEVER paint the proven-green HUE (the §5 wall holds even in demo). Pure: stories
 * in, claim activities out. Sibling to {@link demoDepartures} below (SAME story slice, offset by one).
 */
const DEMO_CLAIM_INTENTS = ['edit', 'real', 'orchestrate'] as const;
const DEMO_CLAIM_GRADES: readonly ClaimGrade[] = ['exploring', 'waiting', 'work'];
export function demoClaims(stories: TreeStory[]): ClaimActivity[] {
  return stories.slice(0, DEMO_CLAIM_GRADES.length).map((s, i) => {
    const intent = DEMO_CLAIM_INTENTS[i % DEMO_CLAIM_INTENTS.length] ?? 'orchestrate';
    const grade = DEMO_CLAIM_GRADES[i % DEMO_CLAIM_GRADES.length] ?? 'work';
    return {
      unitId: s.id,
      kind: 'claim' as const,
      sessionId: `demo-${s.id}`,
      branch: `claude/demo-${intent}`,
      intent,
      grade,
      at: new Date().toISOString(),
    };
  });
}

/**
 * A synthetic DEPARTURE (ADR-0200 D7) for `?claims=demo` — one fading claim on the NEXT visible story
 * after {@link demoClaims}'s three (so all four families render on distinct islands), fixed mid-fade
 * (`ageRatio` ≈ 0.4) so the demo always shows visible motion rather than a just-departed or
 * nearly-gone wisp. Pure: stories in, departed claims out; `[]` when the world has too few stories to
 * spare a fourth.
 */
export function demoDepartures(stories: TreeStory[]): DepartedClaim[] {
  const s = stories[DEMO_CLAIM_GRADES.length];
  if (!s) return [];
  const ageMs = Math.round(DEPARTURE_WINDOW_MS * 0.4);
  return [
    {
      unitId: s.id,
      sessionId: `demo-departed-${s.id}`,
      grade: 'work',
      ageMs,
      at: new Date(Date.now() - ageMs).toISOString(),
    },
  ];
}

/** Stories tagged `render: building` (ADR-0076 §2 / ADR-0088) — the shared-island hubs (`library`,
 *  `cli`, `notice-board`). When ON they are EXCLUDED from the map into the permanent Shared Islands
 *  panel and their edges are promoted to per-island icon STAMPS (ADR-0102); the per-nameplate
 *  identity-key glyph decodes those stamps.
 *
 *  DEFAULT OFF (ADR-0228, owner-directed 2026-07-22): the mature pathways system (ADR-0169) now
 *  carries the hub dependencies on the map, so the hubs render as ordinary connected islands — no
 *  stamps, no source-hub city clusters, no identity-key glyph, and the panel's Shared-Islands drawer
 *  is empty (hidden). The escape `?buildings=on` restores the old off-map panel + stamp world. The
 *  whole model is studio chrome — the public website's forest never rendered it, so flipping the
 *  default is a studio-only change (no web-engine sync). */
function readBuildings(search: string = defaultSearch()): boolean {
  const v = new URLSearchParams(search).get('buildings');
  return v === 'on' || v === '1' || v === 'true';
}

/**
 * `?semanticGrowth=demo` — the ONLY value that mounts the query-gated Studio witness stage
 * (semantic-growth-studio-demo, stories/app-surface/semantic-growth-studio-demo.md). Absence, an
 * empty value, or any OTHER value (including a near-miss like `?semanticGrowth=on`) leaves the
 * clean Studio route byte-for-byte unchanged — an EXACT match, never a truthy/loose gate.
 */
export function readSemanticGrowthDemo(search: string = defaultSearch()): boolean {
  return new URLSearchParams(search).get('semanticGrowth') === 'demo';
}

/**
 * The Chapter 2 comparison route is exact and default-off. A different key/value, including the
 * historical rejected island-growth gate, falls through to the ordinary Studio product.
 */
export function readOrganicPoseToPose(search: string = defaultSearch()): boolean {
  return (
    new URLSearchParams(search).get('organicGrowth') ===
    'organic-pose-to-pose'
  );
}

/** Experiment 6: the exact connected native-SVG island accretion witness gate. */
export function readOrganicIslandAccretion(search: string = defaultSearch()): boolean {
  return (
    new URLSearchParams(search).get('organicGrowth') ===
    'organic-island-accretion'
  );
}

/**
 * The Chapter 2 round-3 COMPARISON LAB — `?organicGrowth=r3-lab`, and that exact value only.
 *
 * One fixed composition (the connected SVG accretion island, the ADR-0277-retained plant track and
 * the arrival path-growth beat) with the HERO TREE switchable between the four registered
 * candidates, so the owner gives ONE comparison LOOK verdict instead of opening four hosted tags.
 * Absence, an empty value, a near miss (`r3-lab-x`, `r3`) and every sibling `organicGrowth` value
 * fall through to the ordinary Studio product unchanged — and the lab has NO permanent navigation
 * entry, so the only way in is typing this query.
 */
export function readChapter2Round3Lab(search: string = defaultSearch()): boolean {
  return new URLSearchParams(search).get('organicGrowth') === 'r3-lab';
}

/* ---------- map layout ----------
 * ADR-0283 D2 (owner-directed 2026-08-02): DAG rows are the ONE map layout. The `readLayoutMode`
 * reader, the `LayoutMode` union and the `?layout=` query values are gone — `?layout=stress` /
 * `?layout=solar` no longer resolve to anything and fall through to rows like any unknown param,
 * and the gear picker that offered them retired with them (worldSettings). This is a product call
 * about what the map IS, not an Act 2 convenience: every growth, arrival and pathway choreography
 * from here on has exactly one arrangement to be correct against. Of the two placement modules,
 * `lib/solarLayout.ts` is DELETED (no caller survived the retirement) and `lib/stressLayout.ts`
 * stays, tested but unreached from the map — `stressSeeds` still serves `overviewConstellation.ts`.
 */

/**
 * Which sprite art STYLE SHEET re-skins the map (sprite-art-sheets arc) — `'storybook'` is the
 * owner-attested default when the parameter is absent; `'vector'` explicitly selects the preserved
 * procedural render; every other recognized value names a sheet folder under
 * `apps/studio/public/art-sheets/<name>/`. Gear-panel managed (worldSettings' `artStyle` control is
 * the single source of truth for the default + the option list), so the panel and this reader never drift.
 */
export function readArtStyle(search: string = defaultSearch()): string {
  return readControlValue(search, ART_STYLE_CTL) as string;
}

/** The sprite size dial (worldSettings' `artScale` number control, default 1 = match the vector
 *  footprint) — multiplies the derived sprite fit; inert while `artStyle` is `vector`. */
export function readArtScale(search: string = defaultSearch()): number {
  return readControlValue(search, ART_SCALE_CTL) as number;
}

/** How fast the Act 2 regrow crosses its plan (worldSettings' `regrowSpeed` number control,
 *  ADR-0286). 1 = the plan's own duration; the 0.25 default — the dial's floor — stretches it to
 *  roughly half a minute on the current forest. Scales the CLOCK only —
 *  the schedule the story graph derives is identical at every speed. */
export function readRegrowSpeed(search: string = defaultSearch()): number {
  return readControlValue(search, REGROW_SPEED_CTL) as number;
}

/** What MOVES when an island is selected (worldSettings' `selectionMotion` select, default
 *  `draw`). `draw` = each route draws on once and the neighbour shores pulse, then still;
 *  `march` = a looping travelling dash; `off` = the lanes paint with nothing moving. The
 *  lanes themselves are not optional — this dial is only about the motion. */
export function readSelectionMotion(search: string = defaultSearch()): 'draw' | 'march' | 'none' {
  const v = readControlValue(search, SELECTION_MOTION_CTL) as string;
  return v === 'march' ? 'march' : v === 'off' ? 'none' : 'draw';
}

/**
 * The central wiring organisms (ADR-0074 §2 — the wiring layer is VISIBLE, not exempt: hiding the
 * most-connected nodes hides the most architecturally important relationships). `cli` / `store`
 * are FIRST-CLASS organisms with real stories + capabilities + lightweight UATs (ADR-0074 §3,
 * landed PR #234), so `/api/tree` returns them like any island.
 *
 * ADR-0283 D2 retired the radial layout these used to be laid out CENTRALLY for, and the synthetic
 * fallback hub story that gave that world a centre when the payload lacked one went with it. What
 * remains is the on-map EMPHASIS — the `is-hub` tag and the presentation model's
 * `emphasizedStoryIds` — which never depended on the arrangement.
 */
const HUB_IDS: ReadonlySet<string> = new Set(['store', 'cli']);

// ---------- focus relations (V1's ancestor/descendant highlighting) ----------

interface Relations {
  ancestors: Set<string>;
  descendants: Set<string>;
}

function relationsFor(nodes: { id: string; dependsOn: string[] }[], focusId: string): Relations {
  const depsOf = new Map<string, string[]>();
  const dependentsOf = new Map<string, string[]>();
  for (const node of nodes) {
    depsOf.set(node.id, node.dependsOn);
    for (const d of node.dependsOn) {
      const list = dependentsOf.get(d);
      if (list) list.push(node.id);
      else dependentsOf.set(d, [node.id]);
    }
  }
  const walk = (start: string, next: Map<string, string[]>): Set<string> => {
    const seen = new Set<string>();
    const stack = [...(next.get(start) ?? [])];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...(next.get(id) ?? []));
    }
    return seen;
  };
  return { ancestors: walk(focusId, depsOf), descendants: walk(focusId, dependentsOf) };
}

// ---------- capability sub-DAG (side panel) ----------

const SUB_W = 134;
const SUB_H = 46;
const SUB_STRIP = 13;
// Keep capability cards at one calm, readable zoom no matter how many nodes the
// selected story owns. Small DAGs centre at this intrinsic size; wide DAGs
// scroll inside the frame instead of scaling every card down.
const SUB_RENDER_SCALE = 0.85;

/** Smooth path through dagre's edge waypoints (quadratic through the bends). */
function pathThrough(points: Pt[]): string {
  const first = points.at(0);
  const last = points.at(-1);
  if (!first || !last) return '';
  let d = `M ${first.x.toFixed(1)} ${first.y.toFixed(1)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    const nx = points[i + 1];
    if (!p || !nx) continue;
    d += ` Q ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${((p.x + nx.x) / 2).toFixed(1)} ${((p.y + nx.y) / 2).toFixed(1)}`;
  }
  if (points.length >= 2) d += ` L ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
  return d;
}

/** Wrap a kebab-case id across up to two lines, breaking at a hyphen. */
function idLines(id: string, max = 19): string[] {
  if (id.length <= max) return [id];
  const head = id.slice(0, max);
  let cut = head.lastIndexOf('-');
  if (cut < Math.floor(max * 0.4)) cut = max;
  const line1 = id.slice(0, cut);
  const rest = id.slice(cut).replace(/^-/, '');
  if (!rest) return [line1];
  return [line1, rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}

interface SubLayout {
  width: number;
  height: number;
  caps: { cap: TreeCapability; x: number; y: number }[];
  edges: { from: string; to: string; d: string }[];
}

function layoutSubdag(story: TreeStory): SubLayout {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: 'BT', ranksep: 30, nodesep: 16, edgesep: 10, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const c of story.capabilities) g.setNode(c.id, { width: SUB_W, height: SUB_H });
  for (const c of story.capabilities) {
    for (const dep of c.dependsOn) {
      if (dep !== c.id && g.hasNode(dep)) g.setEdge(dep, c.id);
    }
  }
  dagre.layout(g);
  const meta = g.graph();
  const caps = story.capabilities.map((cap) => {
    const node = g.node(cap.id);
    return { cap, x: (node?.x ?? 0) - SUB_W / 2, y: (node?.y ?? 0) - SUB_H / 2 };
  });
  const edges: SubLayout['edges'] = [];
  for (const c of story.capabilities) {
    for (const dep of c.dependsOn) {
      if (dep === c.id || !g.hasNode(dep)) continue;
      const e = g.edge(dep, c.id) as { points?: Pt[] } | undefined;
      edges.push({ from: dep, to: c.id, d: pathThrough(e?.points ?? []) });
    }
  }
  return {
    width: Math.max(Math.ceil(meta.width ?? 0), SUB_W + 16),
    height: Math.max(Math.ceil(meta.height ?? 0), SUB_H + 16),
    caps,
    edges,
  };
}

// ---------- view ----------

// Every real browser (and Electron's Chromium) implements `Document#elementFromPoint` — sceneTapSelect
// below relies on it for its click hit-test. This repo's jsdom test environment does not implement it
// at all (not merely a stub returning null — the property is simply absent), so guard it in exactly
// the same defensive spirit as the existing `typeof document === 'undefined'` check: a genuine DOM
// always has the real method and this is a no-op there.
if (typeof document !== 'undefined' && typeof document.elementFromPoint !== 'function') {
  document.elementFromPoint = () => null;
}

// Px the pointer may wander between press and release before the gesture is treated as a PAN (and the
// click suppressed) rather than a node SELECT. The old 4px was below normal click jitter, so ordinary
// mouse/trackpad clicks were being eaten as micro-drags and never opened the detail panel (owner UX
// feedback). 10px comfortably clears click jitter while staying responsive for an intentional drag.
const DRAG_SLOP = 10;

// ADR-0272 decision 2 (compositor-pan-transform): the bounded pixel distance past which a live drag
// folds mid-gesture rather than waiting for release. Deliberately set FAR past any real gesture — it
// is a safety valve against a pathological drag (a stuck pointer, a runaway synthetic burst), NOT a
// routine bound, and the value is a judgement call rather than a measured one.
//
// The trade-off it settles, stated rather than buried. The `<svg>` is viewport-sized
// (`width/height: 100%`) and clips at its own box, so while the wrapper carries a live offset the
// trailing edge shows the frame's background instead of map — a blank band as wide as the offset,
// which fills in the instant the gesture folds. Folding often would keep that band small, but every
// fold costs one full re-raster (~275 ms measured) — reintroducing exactly the choppiness this
// decision removes. Biasing hard toward "do not fold mid-gesture" is right because the band is only
// VISIBLE when zoomed in past the fit: at the `fit:'contain'` camera — the owner's reported symptom
// condition — 18,060 of 18,793 elements are already in view and nothing lies beyond the edges, so
// the band is background either way and the gesture is pixel-identical to the old path.
const PAN_FOLD_THRESHOLD_PX = 4000;

// ── the studio surfaces seam ─────────────────────────────────────────────────────────────────
//
// WHY IT EXISTS (anti-slop-adoption-arc inc-06, `no-module-mocking`). The map's own suites need to
// substitute exactly SIX things: the world RENDERER (an SVG scene jsdom cannot lay out) and five
// heavy overlays that have nothing to do with panning, camera commits or route retention. Doing
// that used to mean `vi.mock`-ing `@storytree/app-surface` wholesale — which took the module's PURE
// functions down with it, so `laneLayout`, `neighbourHighlightPlan`,
// `normalizeWorldPresentationModel` and `deriveIslandVegetationPlans` were replaced by
// `null`/`{}`/an empty Map and never ran under test at all. Substituting the COMPONENTS alone
// leaves every one of those computations real.
//
// A context rather than a prop because two of the six render inside nested panels in this file; the
// same shape `AppDataContext`, `DiagramRendererContext` and `TerminalToolkitContext` already use,
// and with the same REAL DEFAULTS, so no production caller passes anything.
export interface StudioSurfaces {
  WorldSceneView: React.ComponentType<React.ComponentProps<typeof WorldSceneView>>;
  LandViewMount: React.ComponentType<React.ComponentProps<typeof LandViewMount>>;
  WorldSettingsPanel: React.ComponentType<React.ComponentProps<typeof WorldSettingsPanel>>;
  LibraryDrawer: React.ComponentType<React.ComponentProps<typeof LibraryDrawer>>;
  BottomDock: React.ComponentType<React.ComponentProps<typeof BottomDock>>;
  WorldLegend: React.ComponentType<React.ComponentProps<typeof WorldLegend>>;
  LegendDrawerBody: React.ComponentType<React.ComponentProps<typeof LegendDrawerBody>>;
}

const REAL_SURFACES: StudioSurfaces = {
  WorldSceneView,
  LandViewMount,
  WorldSettingsPanel,
  LibraryDrawer,
  BottomDock,
  WorldLegend,
  LegendDrawerBody,
};

/** Override any subset; anything absent stays the real component. */
export const StudioSurfacesContext = createContext<Partial<StudioSurfaces> | null>(null);

/**
 * The Act 2 regrow choreography — the four hooks that turn "the map is arriving" into a camera and
 * two animated layers (`act2Intro.ts`).
 *
 * SUBSTITUTED AS A SET, and through a context for the same reason the surfaces are: they share one
 * player state machine, and `act2-camera-choreography-arc`'s suite drives that machine directly —
 * scripting a player, then asserting what the map renders for it and what it ASKED the choreography
 * for. Under `vi.mock('./act2Intro.js', …)` that meant rewriting the module; here it is a slot with
 * a real default, so nothing about a production mount changes.
 *
 * Calling hooks through this object is safe: both the default and any override are module
 * constants, so the four calls below happen in the same order on every render.
 */
export interface Act2Choreography {
  useReducedMotion: typeof useReducedMotion;
  useAct2Intro: typeof useAct2Intro;
  useStableForestRegrowLayer: typeof useStableForestRegrowLayer;
  useStableVegetationLayer: typeof useStableVegetationLayer;
}

const REAL_ACT2_CHOREOGRAPHY: Act2Choreography = {
  useReducedMotion,
  useAct2Intro,
  useStableForestRegrowLayer,
  useStableVegetationLayer,
};

/** `null` means "use the real choreography". */
export const Act2ChoreographyContext = createContext<Act2Choreography | null>(null);

function useStudioSurfaces(): StudioSurfaces {
  const override = useContext(StudioSurfacesContext);
  return useMemo(() => ({ ...REAL_SURFACES, ...(override ?? {}) }), [override]);
}

export function TreeView({
  focus,
  active = true,
  codeHeadRef: codeHeadRefFromApp,
  cacheWriteSuppressedRef: cacheWriteSuppressedRefFromApp,
  storePhase = 'unknown',
}: {
  focus: string | null;
  /** False while App retains this instance off-route. A parked forest settles; it never plays hidden. */
  active?: boolean;
  /**
   * map-payload-cache (ADR-0240 decision 2 stage 2): the server code stamp App lifted from
   * StoreBanner's single `/api/health` poller (`code.head`), so a successful reloadTree can stamp
   * the tree half of the payload cache entry it writes. Handed down as the SAME ref object App's
   * own write callback reads (never a reactive prop snapshot) so a write here always sees the
   * truly-latest value at write time, with no render/commit lag to race against the network
   * response that triggers the write. Optional — every existing caller that doesn't wire the cache
   * (tests, the Semantic Growth demo composition) keeps working unchanged; a write under an
   * unresolved ('') head just means guard 2 evicts it on the next boot instead of matching, never
   * a crash.
   */
  codeHeadRef?: { current: string };
  /**
   * map-payload-cache: true once THIS boot's own health probe has evicted an existing cache entry
   * recorded under a different server head (App tracks it — see `evictIfCodeHeadMismatch`'s doc
   * comment). Suppresses `reloadTree`'s own re-write for the rest of this boot so a same-boot
   * revalidation can't quietly re-establish an entry the boot itself just distrusted — the SAME ref
   * object App's own write guard reads, for the same no-propagation-lag reason as `codeHeadRef`.
   * Optional — every existing caller that doesn't wire the cache keeps working unchanged.
   */
  cacheWriteSuppressedRef?: { current: boolean };
  /**
   * `store-connection-signal`: the live store's health phase, as `StoreBanner`'s single
   * `/api/health` poller resolved it and `App` already lifts for the load screens. The map's
   * database-connection light is a SECOND READER of that one phase, never a second poller.
   * Defaults to `'unknown'`, which renders no chip — so a caller that doesn't wire it (tests, the
   * Semantic Growth demo composition) simply gets no light rather than a false one.
   */
  storePhase?: StorePhase;
}): React.JSX.Element {
  // The renderer + heavy overlays, real unless a caller substituted one (see StudioSurfacesContext).
  const surfaces = useStudioSurfaces();
  // The Act 2 regrow choreography, real unless a caller substituted it.
  const act2 = useContext(Act2ChoreographyContext) ?? REAL_ACT2_CHOREOGRAPHY;
  // map-payload-cache: seed the FIRST paint from a validated cache entry (guards 1 + 3, decided
  // synchronously here, before any network response — see payloadCache.ts) rather than starting
  // blank and showing "Growing the world…" while /api/tree is in flight. Read exactly once, up
  // front, so the two pieces of state below agree on the same snapshot.
  const initialCacheRef = useRef<ReturnType<typeof readPayloadCache> | undefined>(undefined);
  if (initialCacheRef.current === undefined) initialCacheRef.current = readPayloadCache();
  const initialCache = initialCacheRef.current;

  const [stories, setStories] = useState<TreeStory[] | null>(() =>
    initialCache ? presentStories(initialCache.stories) : null,
  );
  // Cached paint is never cached TRUTH (ADR-0240 decision 3): true while the current paint came
  // from the cache and hasn't yet been confirmed by a successful reloadTree — cleared on success,
  // and deliberately left set on a failed revalidation (the cached world stays painted, never
  // silently promoted to confirmed, never replaced by an error screen).
  const [cacheProvisional, setCacheProvisional] = useState<boolean>(() => initialCache !== null);
  // Read without adding a reloadTree dependency (which would re-fire the mount effect on every
  // update) — kept current every render, read inside the fetch's .then/.catch closures.
  const storiesRef = useRef<TreeStory[] | null>(stories);
  storiesRef.current = stories;
  // The shared `now` ticker (lib/poll.ts): ages build/claim wisps between
  // polls with zero fetches. Self-reported session presence is RETIRED (ADR-0200 D7) — the
  // claim ledger is the one coordination + observability layer; the ticker outlived the
  // presence render it was born in.
  const now = useNowTick();
  // In-flight builds (ADR-0048): the harness signal the orbiting wisp is sourced
  // from. Seeded from the tree payload, then polled; aged by the SAME shared
  // `now` ticker above.
  const [seedBuilds, setSeedBuilds] = useState<BuildActivity[] | undefined>(undefined);
  const rawBuilds = useBuildActivity(seedBuilds);
  // In-flight story CLAIMS (ADR-0138 §5) + claim DEPARTURES (ADR-0200 D7): the coordination signal
  // the claim/departure wisps are sourced from — "a session is working this story" / "a session just
  // left". Claims are seeded from the tree payload, then both are polled on the SAME /api/activity
  // wire; LIVE by default (the `?claims=` flag retired as a default-off gate, D7 — `?claims=off`
  // still escapes it).
  const [seedClaims, setSeedClaims] = useState<ClaimActivity[] | undefined>(undefined);
  const { claims: rawClaims, departures: rawDepartures } = useClaimActivity(seedClaims);
  // The session dock — the claim-ledger view (ADR-0200 D7, claims-only since the inc-6 presence
  // retirement): "who's doing what, grouped by session". Opened from a story panel's claim rows;
  // fetched only while open (not the world's always-on poll cadence).
  const [sessionDock, setSessionDock] = useState(false);
  const [loadError, setLoadError] = useState('');
  // Selection lives in the URL (#/tree/<storyId>) so a focused territory is
  // deep-linkable; the route's `focus` IS the selected story — but only when
  // it names a real story, so a stale deep link renders the unfocused world
  // instead of dimming everything.
  const selectedStory = useMemo(
    () => (focus && stories?.some((s) => s.id === focus) ? focus : null),
    [focus, stories],
  );
  const [selectedCap, setSelectedCap] = useState<string | null>(null);
  const [hoverCap, setHoverCap] = useState<string | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  // ADR-0088: a consumer's on-map bookshelf stamp was clicked — highlight the shared island it
  // uses in the left panel (and the panel scrolls it into view). One building today (library),
  // so a stamp highlights it; cleared on the next world click.
  const [highlightShared, setHighlightShared] = useState<string | null>(null);
  // NO terminal seed state here (ADR-0404 D2/D4). The map's only seed PRODUCER was the Build button
  // (map-terminal-build glue, ADR-0158), which is retired along with the rest of the in-app dispatch
  // surface — so nothing on the map can compose a command to drop into the terminal any more. The
  // dock's own seed HANDLING is untouched: `TerminalDock` still accepts a `seed` and opens a fresh
  // tab for it (`terminal-tabs` / `seed-opens-new-tab`, ADR-0186); it simply has no caller here.

  // The one-shot tree load, extracted so a per-test UAT verdict signature (UatTestCriteriaSection) can
  // RE-PULL it — the crown greens from the per-test roll-up server-side (ADR-0082), so after a
  // signature the world must re-fetch to repaint the island.
  const reloadTree = useCallback((): void => {
    api
      .tree()
      .then((p) => {
        setStories(presentStories(p.stories));
        setSeedBuilds(p.builds ?? []);
        setSeedClaims(p.claims ?? []);
        // map-payload-cache: paint, then ALWAYS revalidate (ADR-0240 decision 3) — a resolved
        // fetch always reconciles the painted view and clears the provisional mark. Persist the
        // RAW (pre-presentStories) stories, matching what /api/tree actually served, so a future
        // boot's presentStories() derives from the same input the network would have.
        setCacheProvisional(false);
        if (!cacheWriteSuppressedRefFromApp?.current) {
          writeTreeCache(p.stories, codeHeadRefFromApp?.current ?? '');
        }
      })
      .catch((e: unknown) => {
        // A revalidation failure must never silently promote a cached paint to confirmed, and
        // must never replace it with an error screen (ADR-0240 decision 3) — cacheProvisional (if
        // set) simply stays true. Only a COLD failure (nothing painted yet, cache or otherwise)
        // surfaces the existing error path.
        if (storiesRef.current === null) {
          setLoadError(e instanceof Error ? e.message : String(e));
        }
      });
  }, []);

  useEffect(() => {
    reloadTree();
  }, [reloadTree]);

  // Road routing LAYOUT (`?rivers=`, NOT water vs roads — roads is the only world now,
  // ADR-0073): the default `bundle` vs the `merge`/`confluence`/`strands` alternates.
  // Read once (URL constant), threaded into buildWorld AND its memo deps.
  const plantsScatter = useMemo(() => readPlantsScatter(), []);
  // The REACTIVE seam: the gear panel (WorldSettingsPanel) writes the gear dials into
  // the URL query string (params BEFORE the #hash) and updates this state, so the world
  // re-renders LIVE without a full reload. Seeded from the URL at mount (SSR-guarded).
  // Only the gear-exposed readers (substrate / layout) are keyed on it; plants the panel
  // never touches, so it stays mount-once.
  const [search, setSearch] = useState<string>(() => defaultSearch());
  // The Library drawer's corpus + finder selection (ADR-0185 inc 2). The corpus is the studio's
  // already-loaded AppData context (no new fetch — the drawer rides the wire the map already has);
  // the selection feeds the focus subgraph (increment 3). Held here so the shell stays provider-free
  // and proves in isolation — TreeView is the composition point where AppData is available.
  const { assets, docs } = useAppData();
  const [librarySelection, setLibrarySelection] = useState<SearchResult | null>(null);
  // The artifact OPENED into the separate full-detail document overlay over the map (ADR-0187 dec 2,
  // inc 8) — distinct from `librarySelection` (the finder/subgraph/preview centre). Open is triggered
  // by the lens's bottom "Open" button or a node double-click; dismissing clears it back to the map.
  const [openSelection, setOpenSelection] = useState<SearchResult | null>(null);
  // This composition boundary used to normalise a possibly-absent `references` array before handing
  // the corpus to the focus subgraph. It had been VESTIGIAL since ADR-0223 moved `focusGraph.ts`
  // onto `dependsOn`, and the field it defended is retired outright (ADR-0477 D1) — so the corpus
  // now passes straight through. `dependsOn` needs no such guard: it is optional by design and every
  // reader treats absence as "no authored edge" rather than assuming an iterable.
  // ADR-0283 D2: there is no layout dial any more — the world is DAG rows, full stop. The
  // synthetic hub-island injection that only `solar` needed went with it.
  // ADR-0076 §2 / ADR-0088: building-class stories (e.g. library) are EXCLUDED from the map and
  // their consumers carry a distributed bookshelf STAMP (the "uses the shared library" marker).
  // The buildings themselves live in the permanent Shared Islands panel. Default ON since the
  // owner attested it; `?buildings=off` restores normal connected islands (no panel, no stamps).
  const buildings = useMemo(() => readBuildings(search), [search]);
  // `islands-sit-too-far-apart-and-the-resting-zoom-is-too-far-out`: live row/rank spacing dial
  // (`?rankGap=`/`?islandGap=`/`?rankSwing=`), same shape as `substrateTuning` above. Absent ⇒
  // `buildWorld`'s own (now tighter) defaults.
  const spacingTuning = useMemo(() => readSpacingTuning(), [search]);
  const chromeScale = useMemo(() => readChromeScale(), [search]);
  const artRungs = useMemo(() => readArtRungs(), [search]);
  // `the-two-layers-share-one-elevation`: `?elevation=<deg>` draws the map at another camera for the
  // owner look. Absent ⇒ `buildWorld`'s own default, so the shipped map is untouched.
  const mapElevation = useMemo(() => readMapElevation(), [search]);
  const world = useMemo(() => {
    if (!stories) return null;
    // By statement, not a spread: under `exactOptionalPropertyTypes` a present-and-undefined
    // `elevationDeg` is a different input from an absent key, and only the absent key leaves
    // `packWorld` on its own default — the same reason `buildWorld` guards its own forward below.
    const opts: NonNullable<Parameters<typeof buildWorld>[1]> = { plantsScatter, buildings, spacing: spacingTuning };
    if (mapElevation !== null) opts.elevationDeg = mapElevation;
    // By statement for the same `exactOptionalPropertyTypes` reason as `elevationDeg` above: an
    // absent key leaves the clearance at full, a present-and-undefined one would not.
    if (chromeScale !== null) opts.chromeScale = chromeScale;
    return buildWorld(stories, opts);
  }, [stories, plantsScatter, buildings, spacingTuning, mapElevation, chromeScale]);
  // ADR-0088: the building-class stories that fill the permanent Shared Islands panel. Generic
  // over `story.building === true` (sharedIslandStories). Empty when `?buildings=off` (the
  // buildings render as normal islands then, so the panel has nothing to lift off the map).
  const sharedIslands = useMemo(
    () => (buildings && stories ? sharedIslandStories(stories) : []),
    [stories, buildings],
  );

  // The gear panel commits a new search string here: write it into the URL with the
  // params placed BEFORE the #hash (replaceState — never pushState, so dragging a
  // slider doesn't spam history), then push it into state so the world re-renders
  // live. SSR-guarded (no window ⇒ state-only). The panel itself debounces slider
  // drags before calling this, so buildWorld doesn't rebuild on every pixel.
  const commitSearch = useCallback((nextSearch: string): void => {
    if (typeof window !== 'undefined') {
      const url = `${window.location.pathname}${nextSearch}${window.location.hash}`;
      window.history.replaceState(null, '', url);
    }
    setSearch(nextSearch);
  }, []);

  // The top drawer's URL-write seam (ADR-0191): lens state is URL-derived (an `?overlay=` lens value
  // = expanded, absent = the collapsed top handle), and the drawer's handle fires `onToggle` — this
  // callback is the parent-owned write that actually flips the param, through `commitSearch`
  // (replaceState, no reload — the same reactive seam the gear dials ride). The PR-#715 bottom-corner
  // `.world-library-dock` toggle that used to own this is RETIRED (ADR-0191 dec 4).
  //
  // TWO LENSES SINCE ADR-0267 D1 / ADR-0314 D6. The drawer's PRIMARY slot is arcs, with the Library
  // demoted to an `Arcs | Library` toggle in the same header — so the collapsed handle opens onto
  // `?overlay=arcs` (DEFAULT_DRAWER_LENS), and either lens value collapses back to no param.
  const drawerLens = readDrawerLens(search);
  const toggleLibrary = useCallback(() => {
    const params = new URLSearchParams(search);
    if (readDrawerLens(search) !== null) params.delete('overlay');
    else params.set('overlay', DEFAULT_DRAWER_LENS);
    const qs = params.toString();
    commitSearch(qs ? `?${qs}` : '');
  }, [search, commitSearch]);

  // The lens toggle's URL write (ADR-0314 D6) — the same parent-owned seam as `toggleLibrary`, so
  // the lens stays URL-derived and a deep link opens the drawer where it says it will.
  const selectDrawerLens = useCallback(
    (lens: DrawerLens) => {
      const params = new URLSearchParams(search);
      params.set('overlay', lens);
      commitSearch(`?${params.toString()}`);
    },
    [search, commitSearch],
  );

  // The arc rollups behind the arcs lens (ADR-0267's `GET /api/arcs` — drive's one join). Fetched
  // only while that lens is open, on the shared slow cadence: no new always-on cost class.
  const arcRollups = useArcRollups(drawerLens === 'arcs');

  // The live claim ledger (`GET /api/claims`, ADR-0200 D7) — the session dock's data, now ALSO read
  // by the arc surface to light `claimed` (ADR-0351 D2). Declared HERE, below `drawerLens`, rather
  // than beside `sessionDock`'s state: `search` is bound at the `useState` above, so reading it any
  // earlier is a temporal dead zone that throws on every render (it took the whole TreeView suite
  // down once — the tests are the reason this comment exists). The hook's drawer-scoping discipline
  // is unchanged; this widens WHICH open surface counts, never to "always on".
  const claimGroups = useSessionClaimGroups(sessionDock || drawerLens === 'arcs');

  // The factory-floor health reading (ADR-0316's instrument over `GET /api/floor-health`), now
  // behind the MAP LAMP rather than the arc drawer's band (ADR-0349). Scoped to `active` — the map
  // being on-route — because that is exactly when the lamp is visible; a parked forest polls
  // nothing, the same rule the rest of this view already follows. Its OWN much slower cadence, raised
  // to 30 min with the move: the read scans the whole friction tier and event log for a figure that
  // moves on a daily grain, so the wider window is paid for by a longer one (lib/floorHealth.ts).
  const floorHealth = useFloorHealth(active);
  // `store-connection-signal`: the map's database-connection light. A pure read of the phase the
  // health poller already resolved — no probe of its own, and nothing to decide here.
  const connectionReading = storeConnection(storePhase);

  // The island ground is always the Townscaper mesh (ADR-0233 — the `?substrate=` gear control is
  // retired). Live tuning (`jitter`/`iters`/`relax`/`wheatScatter`) is still read from the URL so the
  // owner can dial the mesh look in without a rebuild.
  const substrateMode = SUBSTRATE_MODE;
  const substrateTuning = useMemo(() => readSubstrateTuning(), []);
  const relaxedCells = useMemo(
    () => (world ? buildRelaxedCells(world, substrateMode, substrateTuning) : null),
    [world, substrateMode, substrateTuning],
  );

  // The map navigates by PAN + ZOOM (owner UX feedback), not a scrollbar: a
  // pixel-space camera (lib/worldCamera) drives a `<g transform>` over the
  // world-unit content. The world reads bottom-up (foundation at the bottom),
  // so mount FITS the world to the frame width and pins its bottom; deep-link /
  // selecting a story centres + zooms on that territory.
  const frameRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const cameraRef = useRef<SVGGElement>(null);
  const [cam, setCam] = useState<Camera | null>(null);
  const fitCameraRef = useRef<Camera | null>(null);
  const cameraFrameRef = useRef({ width: 0, height: 0 });
  // Input handlers are declared before the Act 2 player. The ref lets those stable handlers obey
  // the player without adding a second camera state machine or rebuilding their native bindings.
  const act2RegrowingRef = useRef(false);
  const limitsRef = useRef<ScaleLimits>({ min: 0.01, max: 100 });
  // `animate` is on only for the programmatic mount/select moves (smooth);
  // every interactive handler (wheel/drag/keys) turns it off so dragging and
  // zooming feel crisp rather than lagging behind a transition.
  const [animate, setAnimate] = useState(false);
  // Drag-pan bookkeeping: the down anchor (+ whether it moved past the click
  // threshold), the last pointer pos (for incremental panBy deltas), and a flag
  // that swallows the click a drag would otherwise fire (so a pan never selects).
  const dragRef = useRef<{ x: number; y: number; moved: boolean; lastX: number; lastY: number } | null>(
    null,
  );
  // Pointermoves can arrive substantially faster than the display refreshes. Accumulate their deltas
  // behind one animation-frame commit, then flush the trailing movement at gesture end.
  const panFrameRef = useRef<number | null>(null);
  const pendingPanRef = useRef({ dx: 0, dy: 0 });
  // Guards against a callback that arrives after cancellation, so an old frame cannot consume a newer
  // gesture's pending delta.
  const panFrameGenerationRef = useRef(0);
  // ADR-0272 decision 2 (compositor-pan-transform): the HTML wrapper the live per-frame write
  // targets (a compositor-only CSS transform), never the SVG `<g class="world-camera">`.
  const panLayerRef = useRef<HTMLDivElement>(null);
  // Act 2's cursor can be delivered partly by the existing compositor wrapper. This ref retains only
  // the last pure delivery result; it is not another camera state machine or clock. A visual-picture
  // identity change folds the exact desired camera into SVG synchronously during the same commit.
  const act2CameraDeliveryRef = useRef<WorldCameraFrameDelivery | null>(null);
  // Probe-only observation of the last COMMITTED complete picture. Neither ref participates in
  // camera delivery; the integer lets the collector distinguish truly stable pictures from the
  // weaker `growthNodeCount === 0` proxy without introducing state, a clock or another render.
  const cameraProbePictureIdentityRef = useRef<readonly unknown[] | null>(null);
  const cameraProbePictureRevisionRef = useRef(0);
  // The total pixel offset currently PAINTED on `.world-pan-layer` — accumulated frame-by-frame
  // during a gesture, not yet folded into `cam`.
  const liveOffsetRef = useRef({ x: 0, y: 0 });
  // The offset amount just handed to `setCam` via a fold, awaiting the paired useLayoutEffect
  // (below) to subtract it from `liveOffsetRef` in the SAME visual frame the `<g>` commits — so the
  // wrapper's reset and the camera's commit are never two separate frames.
  const foldPendingRef = useRef({ x: 0, y: 0 });
  const suppressClickRef = useRef(false);
  // True for the instant between a per-node onClick (SceneView) handling a clean tap and that click
  // bubbling to the viewport — so the viewport's coordinate-hit-test FALLBACK never double-handles a
  // clean click. The fallback exists because a tap's `click` event is unreliable in the desktop build:
  // Electron retargets a captured click to the viewport, and a moved click can fire on a non-leaf
  // common ancestor that carries no handler. Reset at the start of every gesture (onPointerDown).
  const handledRef = useRef(false);
  // Camera re-fit on frame RESIZE (owner UX: the map fills the window, so maximizing must re-frame).
  // `worldRef` lets the stable ResizeObserver handler read the current world; `atFitRef` is true while
  // the camera sits at the programmatic fit and flips false on any manual pan/zoom — the observer
  // re-fits ONLY when atFit, so a user who has zoomed into a territory is never yanked on resize.
  const worldRef = useRef(world);
  worldRef.current = world;
  const atFitRef = useRef(true);
  const roRef = useRef<ResizeObserver | null>(null);
  const refitRafRef = useRef<number | null>(null);
  const lastSizeRef = useRef<{ w: number; h: number } | null>(null);

  // Mount / world change: fit to width, pin the foundation; a deep link wins.
  useLayoutEffect(() => {
    if (!world || !frameRef.current) return;
    const fw = frameRef.current.clientWidth;
    const fh = frameRef.current.clientHeight;
    const fit = fitWorld(world.width, world.height, fw, fh, {
      padding: 16,
      paddingTop: FIT_PADDING_TOP,
      paddingBottom: FIT_PADDING_BOTTOM,
      maxScale: 980 / world.width, // the old .world-scene 980px width cap, as a scale ceiling
      align: 'bottom',
      // ⚠ THIS IS NO LONGER THE RESTING VIEW — it is the reference the resting view is measured
      // against, and the floor the operator can zoom back out to. `restingWorld` below decides what
      // the map OPENS on (ADR-0471).
      //
      // The paragraph that used to stand here argued that the landscape frame's side margins were
      // "that shape's designed consequence of 'see it all' under 'contain', not fit residue". That
      // is corrected in place rather than deleted, because it is the exact defence
      // `the-resting-view-is-designed-not-fitted` exists to close: it is TRUE that 'contain'
      // returns this framing for a portrait DAG, and it establishes only that the view is correctly
      // COMPUTED, never that it is the view the surface should open on. Measured on the live corpus
      // at 1600x900, "see it all" delivered a 44px island and left 55% of the frame empty.
      fit: 'contain',
    });
    const resting = restingWorld(world.width, world.height, fw, fh, islandDiametersOf(world), {
      padding: 16,
      paddingTop: FIT_PADDING_TOP,
      paddingBottom: FIT_PADDING_BOTTOM,
      align: 'bottom',
    });
    const opening = readFittedRestingView() ? fit : resting;
    limitsRef.current = limitsForResting(opening.scale, fit.scale);
    fitCameraRef.current = opening;
    cameraFrameRef.current = { width: fw, height: fh };
    setAnimate(false);
    if (selectedStory) {
      const territory = world.territories.find((t) => t.story.id === selectedStory);
      if (territory) {
        const wc = { x: territory.centroid.x + world.offset.x, y: territory.centroid.y + world.offset.y };
        // A deep link frames the story at least as tightly as the RESTING view — never at the fit,
        // which since ADR-0471 is looser than what the map opens on, so a deep link would have
        // arrived further out than an ordinary arrival at the same map.
        const focus = clampScale(
          Math.max(opening.scale, (limitsRef.current.min / 0.4) * 1.6),
          limitsRef.current,
        );
        atFitRef.current = false; // a deep-linked territory view is not the plain fit — resize won't re-fit it
        setCam(centerOn(wc.x, wc.y, fw, fh, focus, limitsRef.current));
        return;
      }
    }
    atFitRef.current = true;
    setCam(opening);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  // NO camera move on select (owner feedback 2026-07-06): clicking an island used to
  // re-centre + zoom on its territory, which fought the user's own pan/zoom and felt
  // annoying. Selection now only reveals the dependency chain + borders the island; the
  // camera stays exactly where the user left it. The mount-time deep-link framing
  // (keyed on [world] above) is kept — arriving at a ?story= URL still frames it once.
  //
  // We DO still mark the camera "not at fit" on select: opening the detail panel resizes
  // the map frame, and the ResizeObserver below would otherwise re-fit the whole world
  // (moving the camera on select — the very thing we're removing). Marking not-at-fit
  // makes that refit a no-op, so the user's view is preserved. No setCam here.
  useEffect(() => {
    if (selectedStory) atFitRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStory]);

  // Re-fit the world to the CURRENT frame size (the plain fit, no deep-link) — shared by the
  // ResizeObserver below so a window resize / maximize re-frames the map to fill. Re-derives the
  // zoom limits from the new fit scale and marks the camera "at fit".
  const refit = useCallback(() => {
    const el = frameRef.current;
    const w = worldRef.current;
    if (!el || !w) return;
    const fw = el.clientWidth;
    const fh = el.clientHeight;
    if (fw <= 0 || fh <= 0) return;
    const fit = fitWorld(w.width, w.height, fw, fh, {
      padding: 16,
      paddingTop: FIT_PADDING_TOP,
      paddingBottom: FIT_PADDING_BOTTOM,
      maxScale: 980 / w.width,
      align: 'bottom',
      // The reference framing and the zoom-out floor, not the resting view — see the mount effect.
      fit: 'contain',
    });
    const resting = restingWorld(w.width, w.height, fw, fh, islandDiametersOf(w), {
      padding: 16,
      paddingTop: FIT_PADDING_TOP,
      paddingBottom: FIT_PADDING_BOTTOM,
      align: 'bottom',
    });
    const opening = readFittedRestingView() ? fit : resting;
    limitsRef.current = limitsForResting(opening.scale, fit.scale);
    fitCameraRef.current = opening;
    cameraFrameRef.current = { width: fw, height: fh };
    atFitRef.current = true;
    setAnimate(false);
    setCam(opening);
  }, []);

  // Drag → pan (ADR-0272 decision 2, compositor-pan-transform: commit-on-release). The live
  // per-frame write lands on `.world-pan-layer`'s CSS transform (compositor-only, cheap) — never
  // on `<g class="world-camera">`, which stays frozen for the whole gesture (writing it invalidates
  // paint for the whole SVG subtree — the measured cost ADR-0272 pins). The `<g>` takes the
  // composed total exactly once: on release, on a bounded mid-gesture fold (a long drag must never
  // expose an unbounded blank band at the trailing edge), or on any other gesture exit.
  const paintPanLayer = useCallback((): void => {
    const layer = panLayerRef.current;
    if (!layer) return;
    const { x, y } = liveOffsetRef.current;
    layer.style.transform = x === 0 && y === 0 ? 'none' : `translate3d(${x}px, ${y}px, 0)`;
  }, []);

  // Folds a pixel delta into the committed camera, once, and disables programmatic easing. The
  // wrapper's return to identity is NOT done here — the paired useLayoutEffect below does it, keyed
  // on `cam`, so the fold and the reset land in the same visual frame.
  const foldLivePan = useCallback((fx: number, fy: number): void => {
    if (fx === 0 && fy === 0) return;
    foldPendingRef.current = { x: foldPendingRef.current.x + fx, y: foldPendingRef.current.y + fy };
    // Do not retire the fitted-view flag until a camera move actually lands: a cancelled queued
    // drag must still let a later resize re-fit the untouched view.
    atFitRef.current = false;
    setAnimate(false);
    setCam((c) => (c ? panBy(c, fx, fy) : c));
  }, []);

  // Same-frame wrapper reset: fires synchronously after any fold's camera commit, before paint.
  // SUBTRACTS the folded amount — never assigns zero — because movement can arrive between the
  // fold's `setCam` call and this effect running; subtracting preserves it, assigning zero would
  // silently drop it. A `cam` change with nothing pending (wheel-zoom, keyboard pan, resize re-fit,
  // mount fit) is a no-op here.
  useLayoutEffect(() => {
    const pending = foldPendingRef.current;
    if (pending.x === 0 && pending.y === 0) return;
    foldPendingRef.current = { x: 0, y: 0 };
    liveOffsetRef.current = {
      x: liveOffsetRef.current.x - pending.x,
      y: liveOffsetRef.current.y - pending.y,
    };
    paintPanLayer();
  }, [cam, paintPanLayer]);

  // Per-frame coalesced paint: lands the frame's accumulated pointer delta on the wrapper, then
  // folds mid-gesture once the live offset has grown past the bounded threshold.
  const commitPendingPan = useCallback((): void => {
    const { dx, dy } = pendingPanRef.current;
    pendingPanRef.current = { dx: 0, dy: 0 };
    if (dx === 0 && dy === 0) return;
    liveOffsetRef.current = { x: liveOffsetRef.current.x + dx, y: liveOffsetRef.current.y + dy };
    paintPanLayer();
    // screen-space: a pan gesture's accumulated offset against a threshold declared in CSS pixels.
    // The land is not involved — this measures how far the viewport has been dragged.
    if (Math.hypot(liveOffsetRef.current.x, liveOffsetRef.current.y) > PAN_FOLD_THRESHOLD_PX) {
      foldLivePan(liveOffsetRef.current.x, liveOffsetRef.current.y);
    }
  }, [paintPanLayer, foldLivePan]);

  const queuePan = useCallback(
    (dx: number, dy: number): void => {
      pendingPanRef.current.dx += dx;
      pendingPanRef.current.dy += dy;
      if (panFrameRef.current !== null) return;
      const generation = ++panFrameGenerationRef.current;
      panFrameRef.current = requestAnimationFrame(() => {
        // A cancelled rAF should not be able to consume a newer gesture's pending movement.
        if (panFrameGenerationRef.current !== generation) return;
        panFrameRef.current = null;
        commitPendingPan();
      });
    },
    [commitPendingPan],
  );

  // Trailing edge of a gesture (pointer-up), or a wheel-zoom settling a live offset first: land any
  // still-queued frame's delta on the wrapper, then fold the WHOLE live offset into the `<g>`
  // exactly once.
  const flushPendingPan = useCallback((): void => {
    if (panFrameRef.current !== null) {
      cancelAnimationFrame(panFrameRef.current);
      panFrameRef.current = null;
      panFrameGenerationRef.current += 1;
    }
    const { dx, dy } = pendingPanRef.current;
    pendingPanRef.current = { dx: 0, dy: 0 };
    if (dx !== 0 || dy !== 0) {
      liveOffsetRef.current = { x: liveOffsetRef.current.x + dx, y: liveOffsetRef.current.y + dy };
      paintPanLayer();
    }
    foldLivePan(liveOffsetRef.current.x, liveOffsetRef.current.y);
  }, [paintPanLayer, foldLivePan]);

  // Pointer CANCEL is not a completed gesture, but it is not a clean discard either: the
  // already-PAINTED live offset was SHOWN to the operator (snapping it back would be a visible
  // jump), so it settles into the camera exactly like a release. Only the un-painted pending delta —
  // queued but never shown — is discarded.
  const cancelPendingPan = useCallback((): void => {
    if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
    panFrameRef.current = null;
    panFrameGenerationRef.current += 1;
    pendingPanRef.current = { dx: 0, dy: 0 };
    foldLivePan(liveOffsetRef.current.x, liveOffsetRef.current.y);
  }, [foldLivePan]);

  // Unmount just cancels the frame — no commit into a dead component (unlike `cancelPendingPan`
  // above, which settles the painted offset for a live pointer-cancel).
  const cancelPanFrame = useCallback((): void => {
    if (panFrameRef.current !== null) cancelAnimationFrame(panFrameRef.current);
    panFrameRef.current = null;
    panFrameGenerationRef.current += 1;
  }, []);

  // Entering the scripted regrow can race a pointer gesture that began one render earlier. Drop
  // every uncommitted/painted manual offset at that boundary so a later pointer-up cannot alter the
  // fitted camera waiting underneath the script.
  const discardPanForAct2 = useCallback((): void => {
    cancelPanFrame();
    pendingPanRef.current = { dx: 0, dy: 0 };
    liveOffsetRef.current = { x: 0, y: 0 };
    foldPendingRef.current = { x: 0, y: 0 };
    dragRef.current = null;
    if (panLayerRef.current) panLayerRef.current.style.willChange = 'auto';
    paintPanLayer();
  }, [cancelPanFrame, paintPanLayer]);

  useEffect(() => cancelPanFrame, [cancelPanFrame]);

  // Wheel → zoom-to-cursor. React's onWheel can be passive (preventDefault
  // no-ops), so bind a NATIVE non-passive listener. State is read via the
  // functional updater + limitsRef so the handler can stay identity-stable.
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (act2RegrowingRef.current) return;
    // ADR-0272 decision 2: settle any live drag offset into the camera BEFORE the anchor rect is
    // read — a translated wrapper moves that rect, so zooming over a live offset would anchor to
    // the wrong point. flushPendingPan lands any still-queued frame delta, then folds the whole
    // live offset into `cam` exactly once (the wrapper resets via the paired useLayoutEffect).
    flushPendingPan();
    const rect = (svgRef.current ?? frameRef.current)?.getBoundingClientRect();
    if (!rect) return;
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1; // scroll up = zoom in
    atFitRef.current = false; // manual zoom — resize must not yank the view back to fit
    setAnimate(false);
    setCam((c) => (c ? zoomAt(c, px, py, factor, limitsRef.current) : c));
  }, [flushPendingPan]);
  // Attach the wheel listener via a callback ref so it binds exactly when the
  // viewport node mounts. (A useEffect keyed on the stable handler would run once
  // on the pre-world "Growing…" placeholder render — when frameRef is still null —
  // and never re-bind after the real viewport appears.) frameRef is still the
  // measurement handle (clientWidth/getBoundingClientRect); the callback keeps it
  // in sync and owns the native non-passive wheel binding.
  const bindViewport = useCallback(
    (el: HTMLDivElement | null) => {
      if (frameRef.current) frameRef.current.removeEventListener('wheel', onWheel);
      // Tear down the prior observer + any pending re-fit when the node detaches/replaces.
      if (roRef.current) {
        roRef.current.disconnect();
        roRef.current = null;
      }
      if (refitRafRef.current != null) {
        cancelAnimationFrame(refitRafRef.current);
        refitRafRef.current = null;
      }
      lastSizeRef.current = null;
      frameRef.current = el;
      if (el) {
        el.addEventListener('wheel', onWheel, { passive: false });
        // Re-fit when the frame changes size — the map now fills the window, so maximizing/resizing
        // (and the post-mount flex settle) must re-frame the world to fill, not strand it at the old
        // size. Only when the camera is still at the fit (atFitRef) — a panned/zoomed view is kept.
        // Coalesced to one re-fit per frame; the camera transform doesn't change layout, so the
        // observer can't feed back (no scrollbar, no flicker). Guarded for non-DOM test envs — jsdom
        // ships no ResizeObserver, and the resize re-fit is a browser-only enhancement.
        if (typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => {
          const node = frameRef.current;
          if (!node) return;
          const w = node.clientWidth;
          const h = node.clientHeight;
          const last = lastSizeRef.current;
          if (last && last.w === w && last.h === h) return; // ignore no-op callbacks
          lastSizeRef.current = { w, h };
          if (!atFitRef.current) return; // user has panned/zoomed — leave their view
          if (refitRafRef.current != null) cancelAnimationFrame(refitRafRef.current);
          refitRafRef.current = requestAnimationFrame(() => {
            refitRafRef.current = null;
            refit();
          });
        });
        ro.observe(el);
        roRef.current = ro;
      }
    },
    [onWheel, refit],
  );

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (act2RegrowingRef.current) return;
    if (e.button !== 0) return;
    // Start each gesture fresh: clear any suppression a prior drag left set when
    // its synthetic click never arrived, so a real click is never wrongly eaten.
    suppressClickRef.current = false;
    handledRef.current = false;
    dragRef.current = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false };
    // NB: pointer capture is taken LAZILY in onPointerMove, once a real drag begins — NOT here on the
    // press. Capturing on press made the eventual CLICK retarget to this viewport (its capture target)
    // in the Electron build, so a node click ran the background clearSelection instead of selecting it
    // and the detail panel never opened (owner: the pan feature broke clicking nodes). A plain click
    // must stay capture-free so it reaches the node.
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (act2RegrowingRef.current) return;
    const d = dragRef.current;
    if (!d) return;
    // Until the pointer wanders past the slop the press is still a CLICK: don't pan and don't mark it
    // moved, so a click that jitters a few px still selects the node (it is NOT suppressed on
    // pointerup). Track lastX/Y meanwhile so the pan tracks smoothly once the slop IS crossed.
    // screen-space: pointer slop — how far the pointer wandered in client pixels before a press
    // stops being a click. A ground distance would be meaningless for an input gesture.
    if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) <= DRAG_SLOP) {
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      return;
    }
    if (!d.moved) {
      // The press just became a real drag — capture the pointer NOW (lazily) so a pan that runs off
      // the frame keeps tracking. Doing it here, not on pointerdown, keeps a plain click capture-free
      // so its click reaches the node (see onPointerDown).
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* capture may be unavailable */
      }
      // ADR-0272: layer promotion is scoped to the GESTURE, not held permanently — a permanently
      // promoted `.world-camera` was measured as a costly half-measure, and promoting the `<svg>`
      // root was measured actively worse. Released in `finishDrag`/`onPointerCancel` below.
      if (panLayerRef.current) panLayerRef.current.style.willChange = 'transform';
    }
    d.moved = true;
    const dx = e.clientX - d.lastX;
    const dy = e.clientY - d.lastY;
    d.lastX = e.clientX;
    d.lastY = e.clientY;
    queuePan(dx, dy);
  }, [queuePan]);
  const finishDrag = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d?.moved) suppressClickRef.current = true; // a drag must not register as a click
    // Pointer-up is the trailing edge of the burst: land its latest accumulated delta now.
    flushPendingPan();
    if (panLayerRef.current) panLayerRef.current.style.willChange = 'auto'; // release — gesture over
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    dragRef.current = null;
  }, [flushPendingPan]);
  const onPointerUp = finishDrag;
  const onPointerCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d?.moved) suppressClickRef.current = true;
    // A cancellation is not a completed gesture, but it is not a clean discard either — the
    // already-painted live offset settles into the camera (see cancelPendingPan); only the queued,
    // never-shown delta is discarded.
    cancelPendingPan();
    if (panLayerRef.current) panLayerRef.current.style.willChange = 'auto'; // release — gesture over
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* capture may already be gone */
    }
    dragRef.current = null;
  }, [cancelPendingPan]);

  // WASD / arrows → pan (the div is tabIndex={0}). Arrow keys preventDefault so
  // the page never scrolls; modifier-held or input-focused keystrokes pass through.
  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (act2RegrowingRef.current) return;
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
    const STEP = 60;
    let dx = 0;
    let dy = 0;
    switch (e.key) {
      case 'ArrowUp':
      case 'w':
        dy = STEP; // move the view up by panning content down
        break;
      case 'ArrowDown':
      case 's':
        dy = -STEP;
        break;
      case 'ArrowLeft':
      case 'a':
        dx = STEP;
        break;
      case 'ArrowRight':
      case 'd':
        dx = -STEP;
        break;
      default:
        return;
    }
    if (e.key.startsWith('Arrow')) e.preventDefault();
    atFitRef.current = false; // manual keyboard pan — preserve this view across a later resize
    setAnimate(false);
    setCam((c) => (c ? panBy(c, dx, dy) : c));
  }, []);

  // NO hover-driven territory highlight (owner feedback 2026-07-06): the old
  // `focusStoryId = hoverStory ?? selectedStory` recoloured EVERY hex (ancestor /
  // descendant / dim tints) on each mousemove — the reported lag. The dependency
  // relationship now reads through the click-revealed trail CHAIN + a cheap shore
  // border on the selected island only (`.is-selected`, index.css), so no per-hex
  // recolour and no hover state churn. `relationsFor` still drives the capability
  // sub-DAG inside the detail panel (a different, click-scoped surface).
  const storyIds = useMemo(() => new Set((stories ?? []).map((s) => s.id)), [stories]);

  /** capability id → owning story id (resolves build/claim unit anchors). */
  const capOwner = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stories ?? []) for (const c of s.capabilities) m.set(c.id, s.id);
    return m;
  }, [stories]);

  // ── The scene's `now`, frozen while the map is idle (studio-map idle-rebuild, ADR-0069) ──
  // The scene reads `now` only to age content that is present (wisp titles). While
  // nothing ages, the 60s ticker would still rebuild a byte-identical scene ~1×/min. `nextSceneNow`
  // freezes the scene's `now` in that idle case (advancing it only when a wisp exists) so the scene
  // memo — and every `…ByStory` fold feeding it — stays identity-stable. The gate predicates use the
  // LIVE `now`; only the SCENE reads `sceneNow`. A ref holds the previous scene-now (the "storing
  // info from previous renders" pattern — a pure derivation, safe to compute during render). Other
  // surfaces (the Shared-Islands panel) keep the live `now`.
  const hasWisps = rawBuilds.length > 0 || rawClaims.length > 0 || rawDepartures.length > 0;
  const sceneNowRef = useRef(now);
  const sceneNow = nextSceneNow(now, sceneNowRef.current, hasWisps);
  sceneNowRef.current = sceneNow;

  /**
   * In-flight builds grouped by the story territory their unit resolves to
   * (ADR-0048). TTL-aged against `sceneNow` (the idle-frozen ticker above) so a build's wisp
   * vanishes the instant it crosses BUILD_IN_FLIGHT_TTL_MS, not at the next poll — while nothing is
   * in flight (`rawBuilds` empty ⇒ `hasWisps` false ⇒ `sceneNow` frozen) this fold keeps a stable
   * identity so the scene doesn't rebuild every tick. A build whose unit no loaded story owns anchors
   * nowhere (no wisp).
   */
  const buildsByStory = useMemo(() => {
    const byStory = new Map<string, BuildActivity[]>();
    for (const b of rawBuilds) {
      if (!isBuildInFlight(b.at, sceneNow)) continue;
      const storyId = storyIds.has(b.unitId) ? b.unitId : capOwner.get(b.unitId);
      if (storyId === undefined) continue;
      const list = byStory.get(storyId);
      if (list) list.push(b);
      else byStory.set(storyId, [b]);
    }
    return byStory;
  }, [rawBuilds, sceneNow, storyIds, capOwner]);

  // The claim layer flag (ADR-0138 §5 / ADR-0200 D7): LIVE by default. `demo` injects synthetic
  // claims + a departure client-side (DB-free preview); `live` uses the polled `/api/activity` rows;
  // `off` (the explicit escape) ⇒ no claim or departure layer at all.
  const claimsMode = useMemo(() => readClaimsMode(search), [search]);

  /**
   * Story CLAIMS grouped by the story territory their unit resolves to (ADR-0138 §5) — sibling to
   * `buildsByStory`. EMPTY only when `?claims=off`. In `demo` mode the claims are synthetic
   * (DB-free); in `live` mode (the default) they're the polled rows. A claim whose unit no loaded
   * story owns anchors nowhere (no wisp). No client-side TTL re-age: the server already drops a
   * stale claim (ADR-0138 §5), so a still-claimed story just keeps orbiting.
   */
  const claimsByStory = useMemo(() => {
    const byStory = new Map<string, ClaimActivity[]>();
    if (claimsMode === 'off' || !stories) return byStory;
    const source = claimsMode === 'demo' ? demoClaims(stories) : rawClaims;
    for (const c of source) {
      const storyId = storyIds.has(c.unitId) ? c.unitId : capOwner.get(c.unitId);
      if (storyId === undefined) continue;
      const list = byStory.get(storyId);
      if (list) list.push(c);
      else byStory.set(storyId, [c]);
    }
    return byStory;
  }, [claimsMode, rawClaims, stories, storyIds, capOwner]);

  /**
   * Claim DEPARTURES grouped by story territory (ADR-0200 D7) — sibling to `claimsByStory`, gated
   * identically (empty when `?claims=off`; synthetic in `demo` mode; the polled rows in `live` mode).
   * A departure whose unit no loaded story owns anchors nowhere (no fading wisp).
   */
  const departuresByStory = useMemo(() => {
    const byStory = new Map<string, DepartedClaim[]>();
    if (claimsMode === 'off' || !stories) return byStory;
    const source = claimsMode === 'demo' ? demoDepartures(stories) : rawDepartures;
    for (const d of source) {
      const storyId = storyIds.has(d.unitId) ? d.unitId : capOwner.get(d.unitId);
      if (storyId === undefined) continue;
      const list = byStory.get(storyId);
      if (list) list.push(d);
      else byStory.set(storyId, [d]);
    }
    return byStory;
  }, [claimsMode, rawDepartures, stories, storyIds, capOwner]);

  // ADR-0093 Unit 2b: the shared scene-graph render — the DEFAULT path now (`readRenderScene`
  // treats anything but an explicit `?render=legacy`/`inline` as scene; the inline render below
  // is the one-release escape hatch, not the canonical one). The scene is
  // focus-AGNOSTIC (focus / hover / selection are applied by the mapper per render),
  // so it only rebuilds on the world / substrate / ticker / build-activity inputs —
  // never on hover. Hooks live above the early returns (the world may still be null).
  const renderScene = useMemo(() => readRenderScene(search), [search]);
  // grounded-art (ADR-0226): the unified vegetation vocabulary — now PERMANENT studio world art
  // (ADR-0231 retired the `?veg` toggle: always composed, no flag). Every island wears the vocabulary
  // (grass = tests, small UAT flowers, dead grass = unhealthy, the witness signpost retired) and, via
  // the tree-spread (decision 1), the per-status `autumn-tree` colourways (ADR-0227) as its central
  // baked-hero tree. (The default-off `?cosy` / `?garden` / `?factoryart` grounded-art flags were retired
  // by ADR-0228; the scene's dormant `bakedStone` / `garden` seams stay in forest-world, fed `null` here.)
  const vegetation = useVegetation();
  // sprite-art-sheets arc: Storybook is the owner-attested default; `?artStyle=vector` is the explicit
  // procedural opt-out and fetches nothing. A chosen sheet only affects `sceneCtx` below (NOT
  // `SceneInput`/`buildScene` — the scene graph itself carries no sprite opinion).
  const artStyle = useMemo(() => readArtStyle(search), [search]);
  const spriteSheet = useArtStyleSheet(artStyle);
  const artScale = useMemo(() => readArtScale(search), [search]);
  // semantic-growth-studio-demo: the exact `?semanticGrowth=demo` flag (read-only above the
  // scene/hooks below never depend on it). Checked once all hooks are declared (React ordering),
  // near the other early returns.
  const semanticGrowthDemo = useMemo(() => readSemanticGrowthDemo(search), [search]);
  const organicPoseToPose = useMemo(() => readOrganicPoseToPose(search), [search]);
  const organicIslandAccretion = useMemo(
    () => readOrganicIslandAccretion(search),
    [search],
  );
  const chapter2Round3Lab = useMemo(() => readChapter2Round3Lab(search), [search]);
  // ── the Act 2 intro (ADR-0282, ADR-0286): the whole forest regrown from its base nodes ──
  // Unlike the witness stages above this is NOT a variant controller — there is no early return, no
  // separate stage and no synthetic world. It runs on the REAL map with the real corpus: the same
  // forest, the same islands and the same roads the settled map draws. All that is ever added is a
  // cursor over them.
  // ADR-0286 moved WHEN it runs. It is no longer gated behind `?act2=intro`: it plays on the first
  // arrival at the map each browser session, and its owner-facing controls (replay + speed) live in
  // the gear panel. `?act2=intro` now means "play whatever the session flag says, and mount the
  // diagnostic readout" — a stable URL for watching it, not the way in.
  const act2Intro = useMemo(() => readAct2Intro(search), [search]);
  // Production diagnostic only. Both query values must match exactly; every near miss leaves the
  // product route untouched. This is a measurement overlay around the real regrow, not choreography.
  const cameraRasterisationRoute = useMemo(
    () => readCameraRasterisationRoute(search),
    [search],
  );
  const act2ReducedMotion = act2.useReducedMotion();
  const act2Speed = useMemo(() => readRegrowSpeed(search), [search]);
  // ADR-0286: the regrow plays on the FIRST arrival at the map in a browser session, and the map is
  // static for the rest of it. Read once at mount (a ref, so React's double-invoked render in dev
  // cannot re-ask a question whose answer this component is about to change), and RECORDED in an
  // effect rather than during render — the read is pure, the write is the side effect.
  // `?act2=intro` overrides the flag entirely: that route always plays.
  const act2FirstVisitRef = useRef<boolean | null>(null);
  if (act2FirstVisitRef.current === null) {
    act2FirstVisitRef.current = !act2IntroAlreadyArrived(act2IntroStorage());
  }
  useEffect(() => {
    markAct2IntroArrived(act2IntroStorage());
  }, []);
  // A START TOKEN rather than a boolean: the gear's "Regrow the forest" bumps it, and the effect
  // below plays whichever token it has not played yet. That makes the first arrival and every later
  // replay the SAME path, so there is no second way to start a regrow that could drift from the first.
  const [act2StartToken, setAct2StartToken] = useState(() =>
    act2FirstVisitRef.current === true || readAct2Intro(defaultSearch()) ? 1 : 0,
  );
  // True until the FIRST arrival's run actually starts. It tells the player to open a fresh plan on
  // NOTHING rather than on the settled forest — otherwise the render that first has a scene commits
  // the whole grown map (the single most expensive paint on this surface) a frame before the effect
  // below rewinds it, and the intro opens with a flash of its own ending. A ref, not state: it is
  // read only where the cursor is seeded, and flipping it must not re-render anything.
  const act2PendingStartRef = useRef(act2StartToken > 0);
  // The machinery is built only once a regrow has actually been asked for. Deriving the plan is
  // cheap; the accretion plans below are a scene walk per island, and a session that has already
  // seen the intro should not pay for one. Once asked for, it STAYS on for the life of the page so
  // Regrow can replay without rebuilding anything.
  const act2Enabled = act2Intro || cameraRasterisationRoute !== null || act2StartToken > 0;
  // The routed geometry the regrow's pathways grow ALONG (ADR-0283 D1): each segment's drawn
  // length in world units, so a long haul takes longer to travel than a short spur instead of
  // every pathway costing the same. Derived once per world — never per frame.
  const trailSegLengths = useMemo(() => {
    const lengths = new Map<string, number>();
    for (const segment of world?.trails.segments ?? []) {
      let total = 0;
      for (let i = 1; i < segment.points.length; i += 1) {
        const a = segment.points[i - 1]!;
        const b = segment.points[i]!;
        // screen-space: the segment's DRAWN length, which is the right quantity — this paces a mark
        // travelling along the pathway as it appears, so a foreshortened leg should take less time
        // in exactly the proportion it looks shorter. `world.trails` is already projected.
        total += Math.hypot(b.x - a.x, b.y - a.y);
      }
      lengths.set(segment.id, total);
    }
    return lengths;
  }, [world]);
  const act2Player = act2.useAct2Intro({
    enabled: active && act2Enabled,
    stories,
    reducedMotion: act2ReducedMotion,
    speed: act2Speed,
    pendingStart: act2PendingStartRef.current,
    // The ORDER comes from the story graph's own `depends_on` (ADR-0282 D3); the routed network
    // supplies only which segments join which islands, so a road the router had to drop can never
    // silently reorder the forest.
    edges: world?.trails.edges ?? null,
    segmentLengths: act2Enabled ? trailSegLengths : null,
  });
  act2RegrowingRef.current = active && act2Player.regrowing;
  const fittedCam = fitCameraRef.current ?? cam;
  const cameraFrame = cameraFrameRef.current;
  const finalProductCam = useMemo(
    () => fittedCam
      ? act2RegrowCamera(fittedCam, cameraFrame, act2Player.progress, act2ReducedMotion)
      : null,
    [fittedCam, cameraFrame.width, cameraFrame.height, act2Player.progress, act2ReducedMotion],
  );
  // Every diagnostic route suppresses the shipped choreography first. `final-product` then applies
  // the shipped hybrid projection below, while `growth-only` performs no camera write at all. The
  // diagnostic SVG/HTML arms continue through the imperative measurement seam.
  const desiredPresentedCam = !active
    ? fittedCam
    : cameraRasterisationRoute
    ? fittedCam
    : act2Player.regrowing
      ? finalProductCam
      : cam;

  // A replay may begin after the operator panned or zoomed. Reset the ordinary camera once, on entry,
  // so settlement already owns the exact fitted value; there is deliberately no camera write on exit
  // or after cursor 1. The visible in-flight values remain the pure projection above.
  const act2WasRegrowingRef = useRef(false);
  useLayoutEffect(() => {
    if (!active) {
      discardPanForAct2();
      if (fittedCam) {
        atFitRef.current = true;
        setAnimate(false);
        setCam(fittedCam);
      }
      act2WasRegrowingRef.current = false;
      return;
    }
    if (act2Player.regrowing && !act2WasRegrowingRef.current) {
      // The first render can precede the mount-fit layout effect. Do not latch the entry until a
      // real fitted camera exists and has actually replaced a deep-link/territory focus camera.
      if (!fittedCam) return;
      discardPanForAct2();
      atFitRef.current = true;
      setAnimate(false);
      setCam(fittedCam);
      act2WasRegrowingRef.current = true;
      return;
    }
    act2WasRegrowingRef.current = act2Player.regrowing;
  }, [active, act2Player.regrowing, fittedCam, discardPanForAct2]);
  // The camera probe has no animation clock of its own. React reaches this layout effect only when
  // the EXISTING Act 2 player publishes a new semantic cursor, and the effect writes that sample to
  // either the real repaint-heavy SVG camera or the real compositor HTML wrapper. Cleanup restores
  // the exact fit transform/style observed before the write on settle, abort and route exit.
  const cameraProbeRestoreRef = useRef<() => void>(() => {});
  const mappedIslandCount = world?.territories.length ?? 0;
  const cameraProbeCorpusAccepted =
    mappedIslandCount === CAMERA_RASTERISATION_EXPECTED_ISLANDS;
  useLayoutEffect(() => {
    cameraProbeRestoreRef.current();
    cameraProbeRestoreRef.current = () => {};
    if (
      !cameraRasterisationRoute ||
      cameraRasterisationRoute.variant === 'final-product' ||
      !cameraProbeCorpusAccepted ||
      !cam ||
      !cameraRef.current ||
      !panLayerRef.current
    ) return;
    const fit = fittedCam ?? cam;
    if (!fit || !finalProductCam) return;
    const fitTransform = `translate(${fit.tx} ${fit.ty}) scale(${fit.scale})`;
    const finalProductTransform = `translate(${finalProductCam.tx} ${finalProductCam.ty}) scale(${finalProductCam.scale})`;
    const restore = applyCameraRasterisationTransform(
      { svgCamera: cameraRef.current, htmlCompositor: panLayerRef.current },
      cameraRasterisationRoute.variant,
      act2Player.progress,
      fitTransform,
      finalProductTransform,
    );
    cameraProbeRestoreRef.current = restore;
    return () => {
      restore();
      if (cameraProbeRestoreRef.current === restore) cameraProbeRestoreRef.current = () => {};
    };
  }, [cameraRasterisationRoute, cameraProbeCorpusAccepted, cam, fittedCam, finalProductCam, act2Player.progress]);
  // Held apart from `scene` on purpose: the per-island `caps` / `radius` / `status` the ADR-0292
  // vegetation variation reads live on the SceneInput, not on the drawable tree the scene walk
  // produces. Deriving them a second time from `world` would be a second definition of the same fold.
  const sceneInput = useMemo(
    () =>
      world
        ? worldToScene(world, relaxedCells, sceneNow, buildsByStory, claimsByStory, departuresByStory, null, null, vegetation, artRungs)
        : null,
    [world, relaxedCells, sceneNow, buildsByStory, claimsByStory, departuresByStory, vegetation, artRungs],
  );
  const scene = useMemo(() => (sceneInput ? buildScene(sceneInput) : null), [sceneInput]);

  // `?landView=1` — THE LAND VIEW, beside the working map and never instead of it
  // (`a-land-view-beside-the-working-map`, ADR-0530 route C staged as its first half; ADR-0550
  // settled that mounting proceeds now). It reads the SAME `scene` the SVG map is drawn from, so
  // there is no second layout, no second camera and no second framing rule — and it takes nothing
  // from the map: without the flag, this whole branch is absent and the route is byte-for-byte the
  // one that shipped. `lib/landView.ts` carries what it is, what it does NOT assert, and why the
  // scene it is handed has to be un-projected first.
  const landView = useMemo(() => readLandView(search), [search]);

  // `?landMount=1` — THE LAND UNDER THE MAP (`the-land-sits-under-the-working-map`), which is the
  // OTHER half of route C and a different claim from the view above: not a second panel beside the
  // map but the 3D ground beneath this very surface, registered to it to the pixel. The canvas is
  // mounted as the first child of `.world-pan-layer` below, BEFORE the `<svg>` — so it inherits the
  // same compositor pan transform and paints underneath every mark the map draws. Without the flag
  // the branch is absent and the route is byte-for-byte the one that shipped.
  // `lib/landViewMount.ts` carries why it is ground-only and what it does not deliver.
  const landMount = useMemo(() => readLandMount(search), [search]);
  const landMountProps = useMemo(() => readLandMountProps(search), [search]);

  // `?sceneExport=1` — the SCENE-EXPORT BRIDGE (ADR-0521's ladder instrument). Behind the flag only,
  // the built scene graph and the layout's own bookkeeping are parked on `window` for a driver to
  // read, so the 3D comparison page renders the REAL forest as this map lays it out rather than a
  // synthetic crowd. Same shape as the camera-rasterisation probe above: nothing is written without
  // the flag, and the bridge is removed when the scene changes or the view unmounts.
  const sceneExport = useMemo(() => readSceneExport(search), [search]);
  useEffect(() => {
    if (!sceneExport || !world || !scene) return;
    const bridge = sceneExportBridge(world, scene, spacingTuning, artRungs);
    window.__storytreeSceneExport = bridge;
    return () => {
      if (window.__storytreeSceneExport === bridge) delete window.__storytreeSceneExport;
    };
  }, [sceneExport, world, scene, spacingTuning, artRungs]);

  // ADR-0169 §3: trails are hidden by default and GROW on island focus. The plan is the
  // pure selector (lib/trailReveal): which segments, in what stagger order, from which
  // end, in which direction tint. Reveal is CLICK/SELECT ONLY — keyed on `selectedStory`,
  // Trails are ALWAYS drawn now (owner 2026-07-07: "see the pathways without clicking
  // everywhere"). Reveal-on-click is retired — the noise the click reveal hid is gone
  // now that the moat merges near-parallels and stress spaces the islands. The growth
  // animation moves to ARRIVAL (a new island being placed); `growPlan` below drives the
  // per-segment draw-on masks off `arrivalIds`, not off selection. Clicking an island
  // still borders it (`.is-selected`, via territoryClassById) — that is the only focus
  // affordance left. (selectedStory still drives the detail panel + the border.)
  const trailSegById = useMemo(
    () => new Map((world?.trails.segments ?? []).map((s) => [s.id, s])),
    [world],
  );

  // One connected-accretion plan per island, derived ONCE from the settled scene. This is the
  // expensive half of the regrow (a scene walk per story), so it is keyed on the scene alone and
  // never touched by the cursor; the per-frame half below only re-selects cell scales.
  const act2AccretionPlans = useMemo(
    () =>
      act2Enabled && scene && world
        ? deriveForestRegrowAccretionPlans(
            scene,
            new Map(world.territories.map((t) => [t.story.id, t.centroid])),
          )
        : null,
    [act2Enabled, scene, world],
  );
  // The per-frame render layer: which islands and roads exist yet, plus the accretion state of
  // every island still growing. Null unless the regrow is actually mid-flight, so a settled forest
  // — including the moment the gated route first loads — carries no layer and renders unchanged.
  // Held STABLE across frames that would paint an identical picture — a forest-map frame's cost is
  // rasterisation (ADR-0272), so an unchanged layer object is what keeps `SceneView`'s memo bail-out
  // intact and those frames free.
  const act2RegrowLayer = act2.useStableForestRegrowLayer(
    act2Player.state,
    act2AccretionPlans,
    act2Player.regrowing,
  );

  // ── ADR-0292: per-object vegetation growth ──────────────────────────────────────────────────────
  //
  // ON by default. The decision is the owner's own (they chose exp-16 in conversation, ADR-0292 D2),
  // and the arc's end state describes them watching the regrow on the CLEAN route at the default
  // speed — which a flag would put behind a URL they have to remember. `?veg2=off` is the kill switch
  // for the LOOK comparison, not a gate on the decision: with it the map renders exactly as it did
  // before this arc, so the two can be held side by side.
  //
  // The APPEARANCE is unattested (ADR-0070 stage 2 is the owner's, and nothing here signs it).
  const vegetationGrowthOff = useMemo(() => readVegetationGrowthOff(search), [search]);
  // The expensive half — one walk of each island's flora, seeding every beat — keyed on the SCENE
  // alone, exactly like the accretion plans above. The cursor never touches it.
  const vegetationPlans = useMemo(
    () =>
      scene && sceneInput && !vegetationGrowthOff
        ? deriveIslandVegetationPlans(
            scene,
            sceneInput.territories.map((t) => ({
              storyId: t.id,
              caps: t.caps,
              // IslandVegetationInput.radius is unread internally (see its own doc comment — deriving
              // tree size from it was tried and measurably wrong); `screenRadius` just preserves the
              // pre-split numeric value here (`scene-territory-radius-states-its-space`).
              radius: t.screenRadius,
              status: t.status,
            })),
            // The active art style, so a growth track inherits the size that is actually on screen.
            // Load-bearing: the shipped default is the owner-attested Storybook sheet, which draws the
            // tree at roughly a quarter of its vector body — sizing from the body alone put a tree 4x
            // too large on every island.
            { spriteSheet, artScale },
          )
        : null,
    [scene, sceneInput, vegetationGrowthOff, spriteSheet, artScale],
  );
  const vegetationStoryIds = useMemo(
    () => (sceneInput ? sceneInput.territories.map((t) => t.id) : []),
    [sceneInput],
  );
  // The per-frame half. `null` state (no run in flight) holds every island at 1, so the settled map
  // gets ONE layer object for the whole session and `SceneView`'s memo bail-out survives every pan.
  const vegetationLayer = act2.useStableVegetationLayer(
    vegetationPlans,
    act2Player.regrowing ? act2Player.state : null,
    vegetationStoryIds,
  );

  // ADR-0286: play the pending token, once the map can actually regrow.
  //
  // WAITING ON `act2AccretionPlans` is the load-bearing part. Starting the cursor before the scene
  // exists would run the schedule against no accretion plans, so islands would blink in whole
  // instead of forming — the run would be over before the growth was possible. The token is only
  // marked played once the run really starts, so an arrival that lands before the tree does still
  // gets its regrow when the tree arrives.
  //
  // Reduced motion never starts one: `useAct2Intro` holds the fully grown forest, which is the
  // settled picture the viewer asked for (ADR-0282 D6).
  const act2PlayedToken = useRef(0);
  const act2Replay = act2Player.replay;
  const act2Settle = act2Player.settle;

  // ── motionSettled: the app's own POSITIVELY-ASSERTED answer to "is this frame still moving?" ──
  // (frontend-visual-judgment-arc, increment frontend-settled-signal-from-the-app). Always published
  // — NOT gated behind a diagnostic query param like the camera-rasterisation probe below — because
  // every capture path needs it, not only that one diagnostic. See lib/motionSettled.ts for the full
  // rationale and for why `lane-motion-${selectionMotion}` (the `.world-scene` className below, in
  // the render) is explicitly NOT this signal: it is a permanent motion-MODE class the fully-settled
  // control render carries identically, not a per-frame state. `svgRef.current` (that same
  // `.world-scene` element) is the animation scope this reads: it contains the camera, every lane,
  // every trail mask and every arrival pop-in.
  //
  // `worldArrived` (settle-bridge-reports-settled-before-the-world-arrives, 2026-08-18): the
  // positive arrival assertion motionSettled.ts's header describes — computed from the SAME state
  // that gates the "Growing the world…" placeholder a few hundred lines down (`if (!stories ||
  // !world) return <p>Growing the world…</p>`), so the bridge and the placeholder can never
  // disagree. `loadError` counts as arrived too: a load that failed outright is a terminal state,
  // not one still in flight, and a reader waiting on this bridge deserves a prompt, honest verdict
  // rather than hanging until its own timeout.
  const motionSettledSnapshotRef = useRef<MotionSettledBridge>(() =>
    motionSettledSnapshot({ worldArrived: false, act2Regrowing: false, activeStructuralAnimations: 0 }),
  );
  motionSettledSnapshotRef.current = () =>
    motionSettledSnapshot({
      worldArrived: Boolean(stories) || Boolean(loadError),
      act2Regrowing: act2Player.regrowing,
      activeStructuralAnimations: countActiveStructuralAnimations(
        readStructuralAnimations(svgRef.current),
      ),
    });
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const bridge: MotionSettledBridge = () => motionSettledSnapshotRef.current();
    window[MOTION_SETTLED_BRIDGE_KEY] = bridge;
    return () => {
      if (window[MOTION_SETTLED_BRIDGE_KEY] === bridge) delete window[MOTION_SETTLED_BRIDGE_KEY];
    };
  }, []);

  // Small production-browser protocol consumed by the committed Playwright collector. It exposes
  // observations and the player's EXISTING replay/settle actions only: sampling never drives motion.
  // A non-40-island corpus stays inspectable but fail-closed, so it can be recorded as incomparable.
  const cameraProbeSnapshotRef = useRef<() => CameraRasterisationProbeSnapshot>(() => {
    throw new Error('camera rasterisation probe is not ready');
  });
  cameraProbeSnapshotRef.current = () => ({
    protocol: CAMERA_RASTERISATION_PROTOCOL,
    ready:
      cameraProbeCorpusAccepted &&
      cam !== null &&
      act2Player.plan !== null &&
      act2AccretionPlans !== null,
    rejectionReason: cameraProbeCorpusAccepted
      ? null
      : `expected-${CAMERA_RASTERISATION_EXPECTED_ISLANDS}-mapped-islands-got-${mappedIslandCount}`,
    variant: cameraRasterisationRoute?.variant ?? 'growth-only',
    corpus: { storyCount: stories?.length ?? 0, mappedIslandCount },
    settings: {
      regrowSpeed: act2Speed,
      reducedMotion: act2ReducedMotion,
      durationMs: act2Player.plan?.durationMs ?? null,
      schedule:
        act2Player.plan?.steps.map((step) => ({
          storyId: step.storyId,
          wave: step.wave,
          order: step.order,
          reach: step.reach,
          startMs: step.startMs,
          endMs: step.endMs,
          start: step.start,
          end: step.end,
        })) ?? [],
    },
    player: {
      cursor: act2Player.progress,
      playing: act2Player.playing,
      regrowing: act2Player.regrowing,
    },
    pictureRevision: cameraProbePictureRevisionRef.current,
    growthNodeCount:
      svgRef.current?.querySelectorAll('[data-island-accretion-cell]').length ?? 0,
    mapNodeCount: cameraRef.current?.querySelectorAll('*').length ?? 0,
    svgTransform: cameraRef.current?.getAttribute('transform') ?? null,
    htmlTransform: panLayerRef.current?.style.transform ?? '',
    fitTransform: fittedCam ? `translate(${fittedCam.tx} ${fittedCam.ty}) scale(${fittedCam.scale})` : null,
  });
  useEffect(() => {
    if (!cameraRasterisationRoute || typeof window === 'undefined') return;
    const bridge = {
      snapshot: () => cameraProbeSnapshotRef.current(),
      start: () => {
        const snapshot = cameraProbeSnapshotRef.current();
        if (!snapshot.ready) {
          return { ok: false, reason: snapshot.rejectionReason ?? 'probe-not-ready' };
        }
        act2Replay();
        return { ok: true };
      },
      settle: (): void => {
        act2Settle();
        cameraProbeRestoreRef.current();
      },
      abort: (): void => {
        act2Settle();
        cameraProbeRestoreRef.current();
      },
    };
    window.__storytreeCameraRasterisationProbe = bridge;
    return () => {
      if (window.__storytreeCameraRasterisationProbe === bridge) {
        delete window.__storytreeCameraRasterisationProbe;
      }
      cameraProbeRestoreRef.current();
    };
  }, [cameraRasterisationRoute, act2Replay, act2Settle]);
  useEffect(() => {
    if (act2StartToken <= act2PlayedToken.current) return;
    if (act2ReducedMotion) {
      // Nothing to play, but the token is spent — otherwise turning reduced motion OFF mid-session
      // would suddenly launch an intro nobody asked for. The cursor must ALSO stop being held at
      // nothing, or a reduced-motion viewer would sit in front of an empty map.
      act2PlayedToken.current = act2StartToken;
      act2PendingStartRef.current = false;
      act2Settle();
      return;
    }
    if (!act2AccretionPlans) return;
    act2PlayedToken.current = act2StartToken;
    act2PendingStartRef.current = false;
    act2Replay();
  }, [act2StartToken, act2ReducedMotion, act2AccretionPlans, act2Replay, act2Settle]);

  // The gear panel's non-URL button (worldSettings holds the speed dial beside it). Memoised as an
  // array so the panel's own `grouped()` memo is not rebuilt on every render of this component.
  const act2GearActions = useMemo(
    () => [
      {
        key: 'regrow',
        group: GROUP_INTRO,
        label: '▶ Regrow the forest',
        hint: act2ReducedMotion
          ? 'Reduced motion is on, so the forest stays settled rather than replaying.'
          : 'Replay the growth from nothing — the same run that plays on your first arrival at the map.',
        disabled: act2ReducedMotion,
        onClick: () => setAct2StartToken((token) => token + 1),
      },
    ],
    [act2ReducedMotion],
  );

  // ISLAND ARRIVAL: when a re-pulled tree payload contains stories absent from the
  // previous one (a story-author spawn finished → ChatDock's onReloadTree, a UAT
  // signature re-pull, …), those islands ARRIVE instead of popping in: their roads draw
  // on end-to-end, then the coast surfaces, the ground assembles, and the flora pops
  // (SceneView's `arrive-*` classes + the index.css keyframes — the animation fires
  // when the class is first applied, so no remount is needed on a live arrival). The
  // very FIRST payload only seeds the baseline: a full board load is not an arrival.
  const [entering, setEntering] = useState<ReadonlySet<string>>(EMPTY_ID_SET);
  const prevStoryIdsRef = useRef<ReadonlySet<string> | null>(null);
  const enteringRunRef = useRef(0);
  useEffect(() => {
    if (!stories) return;
    const ids = new Set(stories.map((s) => s.id));
    const prev = prevStoryIdsRef.current;
    prevStoryIdsRef.current = ids;
    if (!prev) return;
    const fresh = [...ids].filter((id) => !prev.has(id));
    if (!fresh.length) return;
    const run = ++enteringRunRef.current;
    setEntering(new Set(fresh));
    // Drop the classes once the staged animation has finished — they're inert by then,
    // but a later unrelated remount must not replay a stale arrival. Guarded by run so
    // a second arrival inside the window isn't clipped by the first one's timer.
    setTimeout(() => {
      if (enteringRunRef.current === run) setEntering(EMPTY_ID_SET);
    }, 4500);
  }, [stories]);
  // `?arrive=<story-id|auto>` — the DEMO/QA escape: force one island to wear the
  // arrival on load, with a ▶ replay button (remounts the scene subtree via arriveRun)
  // so the motion can be attested on demand. Absent param ⇒ live-diff arrivals only.
  const arriveParam = useMemo(() => new URLSearchParams(search).get('arrive'), [search]);
  const [arriveRun, setArriveRun] = useState(0);
  const demoArrivalId = useMemo(() => {
    if (!arriveParam || !world) return null;
    if (world.territories.some((t) => t.story.id === arriveParam)) return arriveParam;
    const edges = world.trails.edges;
    return (
      edges[edges.length - 1]?.to ??
      world.territories[world.territories.length - 1]?.story.id ??
      null
    );
  }, [arriveParam, world]);
  const arrivalIds = useMemo<ReadonlySet<string> | null>(() => {
    // During an Act 2 regrow the arriving islands ARE the ones the plan is landing right now, so
    // the staged coast/ground/flora arrival classes are reused verbatim rather than a second
    // island animation being written. Their DELAYS are re-timed under `.act2-regrowing`
    // (index.css) to land inside the island's own accretion window: the default staging waits
    // ~1.05 s for a road to arrive first, which under ADR-0283 has already happened.
    if (act2RegrowLayer) {
      return act2Player.state && act2Player.state.arrivalStoryIds.length > 0
        ? new Set(act2Player.state.arrivalStoryIds)
        : null;
    }
    if (!demoArrivalId && entering.size === 0) return null;
    return demoArrivalId ? new Set([...entering, demoArrivalId]) : entering;
  }, [act2RegrowLayer, act2Player.state, demoArrivalId, entering]);
  // Per-segment usage, for the reveal mask's stroke width (the §3 multi-reveal width step-up).
  const trailSegUsage = useMemo(
    () => new Map((world?.trails.segments ?? []).map((s) => [s.id, s.usage])),
    [world],
  );
  // ADR-0283 D1 — the regrow's own pathway fronts: which segments are mid-draw and how far the
  // front has travelled, straight off the app cursor. Held stable across frames where no front
  // has moved. Null (⇒ fall through to the live-arrival plan below) whenever the regrow is not
  // drawing a pathway.
  const act2TrailPlan = useStableForestRegrowTrails(
    act2Player.state,
    trailSegUsage,
    act2Player.regrowing,
  );
  // The trail draw-on plan. Two sources, never both: the Act 2 regrow drives it from the CURSOR
  // (so the schedule knows the instant a pathway arrives — ADR-0283 D1), while a live island
  // ARRIVAL keeps the CSS beat it has always had (an arriving island's DIRECT incident trails
  // grow outward from it, existing trails stay statically drawn). Null ⇒ every trail simply
  // paints, no masks.
  const growPlan = useMemo(
    () =>
      act2Player.regrowing
        ? act2TrailPlan
        : arrivalGrowPlan(world?.trails ?? null, arrivalIds),
    [act2Player.regrowing, act2TrailPlan, world, arrivalIds],
  );
  // ADR-0242 — the selection highlight the reveal-on-click era never had: ONE hop, both
  // directions. `neighbourHighlightPlan` is pure, so this is just which segments sit on the
  // selected story's own edges (the lit lane) and which islands are its immediate upstream /
  // downstream neighbours (the shore rings). Null when nothing is selected ⇒ no lane, no rings.
  // Deliberately NOT the retired transitive closure (`trailRevealPlan`): that repainted the
  // world on hover and was pulled for the lag.
  const neighbourPlan = useMemo(
    () => neighbourHighlightPlan(world?.trails ?? null, selectedStory),
    [world, selectedStory],
  );
  // The two-lane LAYOUT (owner-directed 2026-07-27): the plan's routes turned into one lane
  // path per route, island to island. Pure and memoised on (world, selection) — a pan or a
  // hover never recomputes it, and it is the same shape of cheap the plan above is.
  const selectionMotion = useMemo(() => readSelectionMotion(search), [search]);
  const laneLayoutPlan = useMemo(
    () => laneLayout(world?.trails ?? null, neighbourPlan, { hand: 'auto', roundabouts: true }),
    [world, neighbourPlan],
  );

  // ── A STABLE presentation model so the memoised shared view skips the O(nodes) re-walk on a pan ──
  // `cam` only updates on a fold/release commit now (ADR-0272 decision 2: a live drag writes the
  // compositor-only `.world-pan-layer` wrapper imperatively, never `cam`), and neither the scene nor
  // this model depends on `cam`, so a stable identity still lets the shared SceneView bail out on
  // those commits — only the parent `.world-camera` <g> transform updates. This memo is real,
  // required work — but ADR-0272 measured the O(nodes) walk it skips at only ~3% of a gesture frame;
  // the cost that was actually felt (and that this memo does NOT address) was RASTERISATION: every
  // live-drag `<g>` transform write invalidated paint for the whole SVG subtree. The wrapper above
  // removes that write from the live path entirely — see the compositor-pan block near `onWheel`.
  // These hooks sit ABOVE the early returns so their order is fixed.
  //
  // territoryClassById DOES affect the render (the `.is-selected` shore border, the hub tag), so it is
  // a dep of the legacy inline renderer below. The shared view derives the same selected/hub classes
  // from its typed presentation model.
  const territoryClassById = useCallback(
    (id: string, status: string): string => {
      const cls = ['hex-territory', `st-${status}`];
      if (HUB_IDS.has(id)) cls.push('is-hub'); // on-map emphasis for the cli/store hubs
      // The only focus affordance on the map is a cheap shore border on the SELECTED island
      // (`.is-selected`) — no ancestor/descendant/dim recolour (owner 2026-07-06).
      if (id === selectedStory) cls.push('is-selected');
      return cls.join(' ');
    },
    [selectedStory],
  );
  // The click handlers do NOT affect the render (only what a click DOES), so they get a stable
  // identity via a ref to the latest `selectStory` (assigned just below its definition) and stay OUT
  // of the ctx deps. `handledRef` marks the click handled so the viewport hit-test fallback (below)
  // doesn't re-fire it.
  const selectStoryRef = useRef<(storyId: string, capId: string | null) => void>(() => {});
  const onSelectStoryStable = useCallback((id: string): void => {
    handledRef.current = true;
    selectStoryRef.current(id, null);
  }, []);
  const onSelectCapStable = useCallback((storyId: string, capId: string): void => {
    handledRef.current = true;
    selectStoryRef.current(storyId, capId);
  }, []);
  // This callback stays stable while the camera moves, so the camera-neutral chrome can retain its
  // memoized territory/stamp output across every coalesced pan commit.
  const onStampClickStable = useCallback((id: string): void => {
    setHighlightShared(id);
  }, []);
  const worldPresentationModel = useMemo<WorldPresentationModel | null>(
    () =>
      scene
        ? normalizeWorldPresentationModel({
            scene,
            selectedStoryId: selectedStory,
            emphasizedStoryIds: [...HUB_IDS],
            hiddenStatuses: [...hidden],
            arrivalIds: [...(arrivalIds ?? [])],
            reveal: growPlan,
            neighbours: neighbourPlan,
            lanes: laneLayoutPlan,
            laneMotion: selectionMotion,
            spriteSheet,
            artScale,
            forestRegrowLayer: act2RegrowLayer,
            vegetationLayer,
          })
        : null,
    [
      scene,
      selectedStory,
      hidden,
      arrivalIds,
      growPlan,
      act2RegrowLayer,
      vegetationLayer,
      neighbourPlan,
      laneLayoutPlan,
      selectionMotion,
      spriteSheet,
      artScale,
    ],
  );
  const worldPresentationEvents = useMemo<WorldPresentationEvents>(
    () => ({
      onSelectStory: onSelectStoryStable,
      onSelectCapability: onSelectCapStable,
    }),
    [onSelectStoryStable, onSelectCapStable],
  );

  // Hybrid Act 2 camera delivery: when the rendered picture has not changed, retain the SVG camera
  // and express the exact desired camera as a compositor delta on the existing HTML pan wrapper.
  // When ANY picture-bearing input changes, fold desired into SVG and reset the wrapper in this same
  // React commit. These are stable identities/signatures already owned by the render; notably this
  // never keys product behaviour from growthNodeCount or a newly invented growth frontier.
  //
  // `arrivalIds` is deliberately compared by value. Its Set can be reconstructed from a new semantic
  // player state even when it names the same visible arrivals; treating that allocation as a picture
  // change would throw away the raw-gap frames the stable regrow/vegetation/trail layers expose.
  const arrivalPictureSignature = arrivalIds ? [...arrivalIds].sort().join('\u0000') : '';
  const act2PictureIdentity: readonly unknown[] = [
    scene,
    world,
    renderScene,
    selectedStory,
    hidden,
    arrivalPictureSignature,
    growPlan,
    act2TrailPlan,
    act2RegrowLayer,
    vegetationLayer,
    neighbourPlan,
    laneLayoutPlan,
    selectionMotion,
    spriteSheet,
    artScale,
    arriveRun,
  ];
  // Diagnostic only, and commit-accurate: speculative renders never advance the observed revision.
  // The first committed probe picture is revision 1; after that the integer advances exactly when
  // any complete picture-identity seat changes. Leaving the probe resets the observation.
  useLayoutEffect(() => {
    if (!cameraRasterisationRoute) {
      cameraProbePictureIdentityRef.current = null;
      cameraProbePictureRevisionRef.current = 0;
      return;
    }
    const committed = cameraProbePictureIdentityRef.current;
    if (!committed || !sameWorldCameraVisualIdentity(committed, act2PictureIdentity)) {
      cameraProbePictureIdentityRef.current = act2PictureIdentity;
      cameraProbePictureRevisionRef.current += 1;
    }
  }, [cameraRasterisationRoute, act2PictureIdentity]);
  const hybridAct2Camera =
    active &&
    act2Player.regrowing &&
    (!cameraRasterisationRoute || cameraRasterisationRoute.variant === 'final-product') &&
    finalProductCam
      ? deliverWorldCameraFrame(
          act2CameraDeliveryRef.current,
          finalProductCam,
          act2PictureIdentity,
        )
      : null;
  // Persist only what React actually commits. Advancing this ref during render would let an
  // interrupted/concurrent render become the next base even though its matching SVG/wrapper pair
  // never reached the DOM. Committing `null` through the same path resets retained delivery on every
  // settle, route exit, parked tree and diagnostic-probe leg.
  useLayoutEffect(() => {
    act2CameraDeliveryRef.current = hybridAct2Camera;
  }, [hybridAct2Camera]);
  const presentedCam = hybridAct2Camera?.svgCamera ?? desiredPresentedCam;
  const act2CompositorTransform = hybridAct2Camera
    ? cameraCompositorTransform(hybridAct2Camera)
    : undefined;
  const act2CompositorPromoted =
    act2CompositorTransform !== undefined && act2CompositorTransform !== 'none';

  // semantic-growth-studio-demo: mounted BEFORE any of the clean-route early returns below, so
  // the demo never depends on (or waits on) the live tree load — it is a static witness stage,
  // not a variant of the product controller. Every other value (absent/empty/unknown) falls
  // through unchanged, byte-for-byte, to the clean Studio path.
  if (semanticGrowthDemo || organicPoseToPose || organicIslandAccretion || chapter2Round3Lab) {
    return (
      <SemanticGrowthDemo
        spriteSheet={spriteSheet}
        artScale={artScale}
        variant={
          chapter2Round3Lab
            ? 'r3-lab'
            : organicIslandAccretion
              ? 'organic-island-accretion'
              : organicPoseToPose
                ? 'organic-pose-to-pose'
                : 'demo'
        }
      />
    );
  }
  if (loadError) {
    return (
      <div className="pad">
        <h2>Story forest</h2>
        <p className="muted">Couldn’t load the tree: {loadError}</p>
      </div>
    );
  }
  if (!stories || !world) return <p className="muted pad">Growing the world…</p>;
  if (stories.length === 0) {
    return (
      <div className="pad">
        <h2>Story forest</h2>
        <p className="muted">No stories yet — the world appears once stories/ holds one.</p>
      </div>
    );
  }

  const selected = selectedStory ? stories.find((s) => s.id === selectedStory) : undefined;

  const toggleStatus = (st: string): void => {
    const next = new Set(hidden);
    if (next.has(st)) next.delete(st);
    else next.add(st);
    setHidden(next);
  };

  // The focus-aware island class — by id + folded status, so the scene mapper (SceneView) can compute
  // it from a scene node. `territoryClassById` is the stable useCallback hoisted above the early
  // returns (for the memoised ctx); this thin wrapper adapts a whole story for the legacy inline render.
  const territoryClass = (story: TreeStory): string =>
    territoryClassById(story.id, story.status ?? 'unknown');

  const clearSelection = (): void => {
    // A drag that released over the map fires a synthetic click — swallow it so
    // panning never clears the selection (the flag is set in onPointerUp).
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    setSelectedCap(null);
    navigate(treeHref);
  };
  const selectStory = (storyId: string, capId: string | null): void => {
    // A pan-drag must not register as a select (see clearSelection).
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    // Real cli/store stories (ADR-0074 §3) are selectable like any island and show their
    // capability trees. Only a SYNTHETIC fallback hub (absent from the story payload) has
    // no panel to open, so guard that case alone.
    if (HUB_IDS.has(storyId) && !stories?.some((s) => s.id === storyId)) return;
    if (selectedStory === storyId && capId === null) {
      clearSelection(); // second click on the selected territory toggles it off
      return;
    }
    setSelectedCap(capId);
    navigate(treeFocusHref(storyId));
  };
  // Keep the stable ctx handlers (onSelectStoryStable / onSelectCapStable, above the early returns)
  // pointed at the LATEST closure — so they act with current state without giving the ctx a new identity
  // every render (which would defeat the pan memoisation).
  selectStoryRef.current = selectStory;

  /**
   * Select by HIT-TESTING the pointer position rather than trusting the `click` event's target — the
   * robust fallback for the scene render. The per-node onClick handles a clean click, but in the desktop
   * build a tap's click is unreliable: Electron retargets a captured click to the viewport, and a click
   * whose pointerdown/up straddle two SVG layers (e.g. a crown circle vs the per-story hit rect) fires on
   * a non-leaf common ancestor that carries no handler. Coordinates never lie: resolve the element under
   * the release point and read its `data-cap-id` / `data-story-id` (stamped by SceneView). A pan-drag's
   * synthetic click is swallowed via `suppressClickRef`; an empty-map tap clears.
   */
  const sceneTapSelect = (clientX: number, clientY: number): void => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const el = typeof document === 'undefined' ? null : document.elementFromPoint(clientX, clientY);
    const capEl = el?.closest('[data-cap-id]') ?? null;
    if (capEl) {
      const capId = capEl.getAttribute('data-cap-id');
      const storyId = capEl.getAttribute('data-story-id');
      if (capId && storyId) {
        selectStory(storyId, capId);
        return;
      }
    }
    const storyEl = el?.closest('[data-story-id]') ?? null;
    const storyId = storyEl?.getAttribute('data-story-id');
    if (storyId) {
      selectStory(storyId, null);
      return;
    }
    // empty map (moat / gutter) → clear (suppress already handled above)
    setSelectedCap(null);
    navigate(treeHref);
  };

  return (
    // Full-bleed (owner feedback 2026-07-13): no `pad` ring and no session-counter toolbar — the
    // map is the whole content area. The claim ledger stays reachable through a story panel's
    // claim rows → the session dock (the counter was owner-cited clutter).
    <div className="tree-wrap" data-cache-provisional={cacheProvisional ? 'true' : undefined}>
      {/* ⚠ THE MODIFIER IS WHAT SPLITS THE ROUTE, and it is absent unless the flag is set: the
          working map keeps the whole width, the whole flex chain and every one of its own
          measurements when the land view is closed. */}
      <div className={`tree-layout${landView ? ' has-land-view' : ''}`}>
        <SharedIslandsPanel
          connection={connectionReading}
          islands={sharedIslands}
          stories={stories}
          builds={rawBuilds}
          claimsByStory={claimsByStory}
          departuresByStory={departuresByStory}
          now={now}
          hidden={hidden}
          highlightId={highlightShared}
          substrateMode={substrateMode}
          substrateTuning={substrateTuning}
          spriteSheet={spriteSheet}
          storyStatusFromNameplate={landMount}
          onToggleStatus={toggleStatus}
          onResetHidden={() => setHidden(new Set())}
          onSelectIsland={(id) => selectStory(id, null)}
        />
        <div className="world-frame">
          <div
            className="world-viewport"
            ref={bindViewport}
            data-camera-rasterisation-probe={cameraRasterisationRoute?.variant}
            tabIndex={0}
            aria-label="story forest map (pan and zoom)"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={onKeyDown}
            onClick={(e) => {
              if (!renderScene) {
                if (e.target === e.currentTarget) clearSelection(); // legacy: per-element selects nodes
                return;
              }
              // scene: the per-node onClick handled a clean click (handledRef); otherwise this click
              // didn't reach a node handler (Electron capture-retarget, or a moved click's non-leaf
              // target) — fall back to a coordinate hit-test so the tap still selects.
              if (handledRef.current) {
                handledRef.current = false;
                return;
              }
              sceneTapSelect(e.clientX, e.clientY);
            }}
          >
          {/* ADR-0272 decision 2 (compositor-pan-transform): live drag writes land HERE, never on
              the SVG `<g class="world-camera">`. Act 2 now reuses the same cheap surface only on
              stable-picture cursor frames; picture changes fold the exact desired camera into the
              `<g>` and reset this wrapper in one commit. Ordinary drag folding remains the existing
              useLayoutEffect keyed on `cam`. */}
          <div
            className={`world-pan-layer${landMount ? ' has-land-mount' : ''}`}
            ref={panLayerRef}
            style={{
              transform: act2CompositorTransform,
              transformOrigin: hybridAct2Camera?.transformOrigin,
              willChange: act2CompositorPromoted ? 'transform' : undefined,
            }}
          >
          {/* ⚠ FIRST CHILD, BEFORE THE `<svg>` — that ordering IS the z-order settlement. Nothing in
              this stack sets a `z-index`, so paint order is DOM order and every mark the map draws
              (nameplates, hit targets, trails, crowns, flora, signposts, all five wisp families,
              the selection ring) is above the land unconditionally. Inside `.world-pan-layer` so it
              inherits the drag transform (ADR-0272 D2) and stays registered through a gesture with
              neither layer re-rasterising. */}
          {landMount && (
            <surfaces.LandViewMount
              scene={scene}
              hiddenStatuses={hidden}
              camera={presentedCam}
              drawProps={landMountProps}
              regrowCursor={act2Player.regrowing ? act2Player.state : null}
              active={active}
            />
          )}
          <svg
            ref={svgRef}
            className={`world-scene lane-motion-${selectionMotion}${
              // ADR-0283 D1: while the regrow is in flight the island arrival staging is re-timed
              // to land INSIDE the island's own accretion window (index.css). Its default beat
              // holds the island back ~1.05 s waiting for a road to arrive first — under edge
              // scheduling the road has already arrived, so that wait would make a settled island
              // sprout its outgoing pathways before it was visible.
              act2Player.regrowing ? ' act2-regrowing' : ''
            }`}
            onClick={(e) => {
              // scene selection is handled on the viewport (coordinate hit-test); here only the legacy
              // render clears on a true background click.
              if (!renderScene && e.target === e.currentTarget) clearSelection();
            }}
          >
            <defs>
              <marker
                id="sub-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 1.2 L 8 5 L 0 8.8 z" fill="context-stroke" />
              </marker>
              {/* ADR-0169 draw-on masks — one per segment currently growing: a solid white
                  stroke over the segment's own path, pathLength-normalised so a dash offset of
                  1→0 (or -1→0 for a chain walked against the path's drawn direction) grows it
                  length-agnostically; the visible stroke is masked by it, so the road draws on.
                  userSpaceOnUse + oversized bounds keep a thin diagonal's mask region from
                  clipping the wide stroke. Absent growth ⇒ no masks; every trail just paints.

                  TWO drivers, chosen per segment by whether the plan carries a `drawn` cursor:
                  a live island ARRIVAL keeps the CSS beat (an inline animation-delay per chain
                  position plus the 0.35s keyframe), while the Act 2 regrow writes the offset
                  itself from the app cursor and suppresses the keyframe (`is-cursor-driven`).
                  ADR-0283 D1 needs the moment a pathway ARRIVES to be a number the schedule
                  holds, and a CSS keyframe cannot be sampled. */}
              {renderScene &&
                growPlan?.segments.map((seg) => {
                  const s = trailSegById.get(seg.id);
                  if (!s) return null;
                  const cursorDriven = seg.drawn !== undefined;
                  const style: React.CSSProperties = {
                    strokeWidth: trailFillWidth(seg.revealedUsage) + 8,
                  };
                  if (seg.drawn !== undefined) {
                    const remaining = 1 - Math.max(0, Math.min(1, seg.drawn));
                    style.strokeDashoffset = seg.fromEnd ? -remaining : remaining;
                  } else {
                    style.animationDelay = `${seg.delayMs}ms`;
                  }
                  return (
                    <mask
                      key={seg.id}
                      id={`trail-m-${seg.id}`}
                      maskUnits="userSpaceOnUse"
                      x={-100000}
                      y={-100000}
                      width={200000}
                      height={200000}
                    >
                      <path
                        d={s.d}
                        pathLength={1}
                        className={`trail-reveal-mask${seg.fromEnd ? ' from-end' : ''}${
                          cursorDriven ? ' is-cursor-driven' : ''
                        }`}
                        style={style}
                      />
                    </mask>
                  );
                })}
            </defs>

            {/* Pan/zoom camera (lib/worldCamera): translate+scale the world-unit
                content into the no-viewBox pixel space. defs stay OUTSIDE (they
                are not positional). Hidden until the first frame is computed so
                there's no flash of un-framed content. */}
            <g
              ref={cameraRef}
              className="world-camera"
              transform={presentedCam ? `translate(${presentedCam.tx} ${presentedCam.ty}) scale(${presentedCam.scale})` : undefined}
              style={{
                transition: act2Player.regrowing || cameraRasterisationRoute ? 'none' : animate ? 'transform .35s ease' : 'none',
                visibility: presentedCam ? undefined : 'hidden',
              }}
            >
            {renderScene && worldPresentationModel ? (
              // ADR-0093 Unit D: render FROM the shared scene-graph via the thin React mapper — now
              // the DEFAULT (the `?render=legacy`/`inline` escape hatch falls to the inline `<g>`
              // below). The studio-only chrome that is NOT in the shared core — the
              // distributed-consumer building stamps and the per-nameplate identity-key glyph — is
              // layered ON TOP as a sibling `<g>` (StudioWorldChrome, ADR-0093 Decision 2). The
              // Shared-Islands panel / session dock / settings gear are React `<div>`s outside this
              // `<svg>` and are untouched.
              <>
                <surfaces.WorldSceneView
                  // The key only needs to change for the `?arrive=` DEMO replay (its button bumps
                  // `arriveRun` to remount the subtree so the CSS keyframes run again). In normal
                  // operation (no demo) it stays constant so a re-render NEVER remounts the whole map —
                  // a live arrival stages via classes, not a remount (ADR-0069 / studio-map-svg-scaling-wall).
                  key={demoArrivalId ? `arrive-${arriveRun}` : 'scene'}
                  model={worldPresentationModel}
                  events={worldPresentationEvents}
                />
                <StudioWorldChrome
                  world={world}
                  hidden={hidden}
                  onStampClick={onStampClickStable}
                  buildings={buildings}
                />
              </>
            ) : (
            <g transform={`translate(${world.offset.x} ${world.offset.y})`}>
              {/* the pale coast. This is the `?render=legacy` escape hatch, not the canonical
                  render (ADR-0093 Unit D), so it draws the whole moat at once and carries no
                  ADR-0286 per-island reveal — the Act 2 regrow runs on the scene path. */}
              <g className="hex-coast">
                {world.empties.map((h) => {
                  const c = hexCenter(h);
                  return <path key={axialKey(h)} className="hex-empty" d={hexPath(c.x, c.y, HEX_R - 0.6)} />;
                })}
              </g>

              {/* organic island land: the smoothed coast filled as sand, UNDER the
                  hex tiles, so each island reads as one solid blob with a beach
                  rim instead of loose tiles floating in a hexagonal moat. */}
              <g className="hex-coastland">
                {world.territories.map((t) => (
                  <g key={t.story.id} className={`coast-fill-group ${territoryClass(t.story)}`}>
                    {t.coastGroundLoops.map((loop, i) => (
                      <path key={`cf${i}`} className="coast-fill" d={coastScreenPath(loop)} />
                    ))}
                  </g>
                ))}
              </g>

              {/* claimed land, back-to-front so extrusions layer — the shared IslandGround
                  (the SAME component the Shared Islands panel paints, so map + panel never drift). */}
              <IslandGround
                world={world}
                relaxedCells={relaxedCells}
                classOf={territoryClass}
                interactive={{
                  onSelect: (id) => selectStory(id, null),
                }}
              />

              {/* (No edge layer here: the `depends_on` edges are the ADR-0169 trail network, which
                  only the scene render draws, so this legacy `?render=legacy` escape shows the
                  world WITHOUT trails.) */}

              {/* trees, contract-density flora, nameplates, wisps — per territory */}
              {world.territories.map((t) => (
                <TerritoryFlora
                  key={t.story.id}
                  territory={t}
                  className={territoryClass(t.story)}
                  hidden={hidden}
                  // The world orbits the HARNESS now (ADR-0048 §5): in-flight
                  // builds only. Session presence lives in the dock / panel.
                  builds={buildsByStory.get(t.story.id) ?? []}
                  // ADR-0138 §5 / ADR-0200 D7: the story-claim + departure wisps (live by default).
                  claims={claimsByStory.get(t.story.id) ?? []}
                  departures={departuresByStory.get(t.story.id) ?? []}
                  now={now}
                  onHover={() => {}}
                  onSelect={(capId) => selectStory(t.story.id, capId)}
                  // ADR-0102: clicking an island's icon stamp highlights the SPECIFIC shared island
                  // it names (the carried building's id) in the left panel — so studio's cli-stamp
                  // highlights cli and its library-stamp highlights library.
                  onStampClick={(id) => setHighlightShared(id)}
                />
              ))}
            </g>
            )}
            </g>
          </svg>
          </div>
          </div>
          {sessionDock && (
            <SessionDock
              claimGroups={claimGroups}
              now={now}
              onClose={() => setSessionDock(false)}
            />
          )}
          {/* The Act 2 intro's DIAGNOSTIC readout (ADR-0282, narrowed by ADR-0286): depth, islands
              landed, pathways growing, percent, plus the full transport for stepping to a
              particular beat. The owner-facing replay + speed live in the gear panel now; this is
              what a measurement run and a close look need. Gated on the exact `?act2=intro` value —
              absent ⇒ not mounted, and the map carries no regrow chrome at all. */}
          {act2Intro && <Act2IntroControl player={act2Player} reducedMotion={act2ReducedMotion} />}
          {/* `?arrive=` demo: replay the arrival — remounts the scene subtree so the
              CSS animations run again. Absent flag ⇒ no button (default world untouched). */}
          {renderScene && demoArrivalId && (
            <button
              type="button"
              className="arrive-replay"
              onClick={() => setArriveRun((n) => n + 1)}
            >
              ▶ replay arrival · {demoArrivalId}
            </button>
          )}
          {/* The factory-floor lamp (ADR-0349, amending ADR-0314 D7). It sat inside the arcs lens,
              which renders only under `?overlay=arcs` — so a reading whose whole point was to reach
              the owner "without the owner going looking" was itself behind a drawer. Out here it is
              visible whenever the map is, and the map is the floor it reports on. Bottom-right,
              immediately left of the gear, so the two read as one instrument cluster. */}
          <FloorHealthLamp signal={floorHealthBand(floorHealth)} />
          {/* The world-tuning gear (bottom-right): sliders/toggles/selects bound to
              the URL dials. Closed by default ⇒ no params written ⇒ today's world is
              byte-identical. */}
          <surfaces.WorldSettingsPanel search={search} onCommit={commitSearch} actions={act2GearActions} />
          {/* The Library lens (ADR-0188 inc 9): the two-pane panel remold behind `?overlay=library`
              — an overlay within .world-frame, never a route away. A constant SIDE panel (the
              finder's shelf/scope/search + the pinned selection card) over a single-job CANVAS
              (the focus subgraph when something is selected; a quiet idle otherwise — the inc-5
              overview constellation is RETIRED from the mount per ADR-0188 dec 4, its source and
              signed contracts kept). ADR-0191: the drawer is ALWAYS mounted — collapsed it is the
              persistent top handle (the default entry affordance), expanded (`?overlay=library`)
              the lens; its handle fires `onToggle`, and `toggleLibrary` (above) owns the URL flip.
              Supplement glue after the leaf PASS — the proven lens + signed components stay
              byte-untouched; this mounting + the seed-packet look are the story's operator-attested
              UAT leg (ADR-0070, the shared inc-9+10 sitting). */}
          <surfaces.LibraryDrawer
            search={search}
            onToggle={toggleLibrary}
            onSelectLens={selectDrawerLens}
            /* ADR-0267 D1's PRIMARY slot: the momentum-lanes arc surface (ADR-0314, cut down by
               `arc-queue-and-question-legibility-arc` inc-01/inc-02). Supplement glue — the surface
               itself is proven in isolation (ArcSurface.test.tsx); this mount hands it the polled
               lane rows, the world's clock, the one-arc reader its briefing panel needs (`api.arc` →
               `GET /api/arcs/<id>`, the whole rollup for the selection — the list carries only what
               a LANE draws), and the ALREADY-LOADED Library corpus (`assets`, destructured above for
               the Library lens regardless of whether this drawer is open) — a question's own
               statement/context/options/analogy/diagram/recommendation live on a structured
               Knowledge doc's `fields` there, not on the arc rollup (see the comment on
               `ArcSurfaceProps.assets`), so this costs no new fetch. `api.arc` is a stable module
               function, which is what `readArc` requires. */
            arcsSlot={
              <ArcSurface
                arcs={arcRollups}
                now={now}
                claims={claimGroups}
                onOpen={setOpenSelection}
                readArc={api.arc}
                assets={assets}
              />
            }
            bodySlot={
              <div className="library-lens-panes">
                <aside className="library-side">
                  <LibraryFinder
                    assets={assets}
                    onSelect={setLibrarySelection}
                    {...(librarySelection ? { selectedId: librarySelection.id } : {})}
                  />
                </aside>
                {/* The selection card lives IN the DAG pane (ADR-0193 dec 4) — it takes its space
                    from the canvas, never from the side panel, so search stays usable while a node
                    is selected (the covered-search bug the owner attested). */}
                <div className="library-canvas">
                  {librarySelection ? (
                    <>
                      <LibraryFocusGraph
                        assets={assets}
                        selection={librarySelection}
                        onFocus={setLibrarySelection}
                        onOpen={setOpenSelection}
                      />
                      <LibrarySelectionCard
                        selection={librarySelection}
                        assets={assets}
                        onOpen={setOpenSelection}
                      />
                    </>
                  ) : (
                    <div className="library-canvas-idle" data-testid="library-canvas-idle">
                      Pick a category or search — the tree grows from what you choose.
                    </div>
                  )}
                </div>
              </div>
            }
          />
          {/* The Open document overlay (ADR-0187 dec 2, inc 8): a SEPARATE full-detail artifact view
              mounted OVER the map — "like opening a Word doc" — reusing the byte-locked LibraryDiveBody
              router (AssetView / DocView) inside its own container. Distinct from the retired inline
              dive slot; transient (dismiss returns to the lens/map, clearing openSelection). Supplement
              glue after the leaf PASS — the proven LibraryOpenOverlay stays byte-untouched. */}
          <LibraryOpenOverlay selection={openSelection} onDismiss={() => setOpenSelection(null)} />
          {/* The BOTTOM PANEL overlays the MAP (absolute within .world-frame), not the whole app — the
              same dock slot the chat used, then the terminal (ADR-0174 terminal pivot; ChatDock stays
              dormant in the tree for a future app-guide, ADR-0175). Since ADR-0354 D1 it is a TAB HOST:
              the terminal keeps its tab and the context-traversal replay is its sibling, so the frame
              (fold, drag-resize, tab strip) belongs to `BottomDock` and the dock draws only its body.
              The terminal half is unchanged behind it — still FAIL-CLOSED behind TerminalRepoGate
              (terminal-repo-gate): the dock renders only once a valid repo is selected (else a "select a
              repository" gate), reopening in the new repo when the selection changes; still a thin client
              reaching a real local pty only through the desktop `window.desktopTerminal` bridge, and
              degrading to an honest disabled state in the hosted/dev studio (a plain browser, no bridge);
              and the repo control (terminal-repo-picker, ADR-0174 follow-on) is still INJECTED into the
              gate rather than mounted as a floating sibling over the map (owner UX refinement
              2026-07-12) — the prominent SELECT affordance while no repo is chosen, the compact repo GEAR
              in the dock header once one is ready. The dock still ACCEPTS a `seed` (a pre-filled
              command, ADR-0137/ADR-0186) and its host still brings the terminal tab forward for one —
              but the map no longer produces any: the Build click that composed them is retired
              (ADR-0404), and a build is dispatched by typing the CLI verb in this very terminal. */}
          <surfaces.BottomDock />
        </div>

        {/* THE LAND VIEW — beside the working map, never over it and never instead of it. It is a
            SIBLING of `.world-frame`, so the map above keeps its own frame, its own camera and its
            own hit targets; this panel reads the same `scene` and draws it. */}
        {landView && <LandView scene={scene} regrowCursor={act2Player.regrowing ? act2Player.state : null} active={active} />}

        {selected && (
          <StoryPanel
            story={selected}
            stories={stories}
            storyIds={storyIds}
            claims={claimsByStory.get(selected.id) ?? []}
            now={now}
            selectedCap={selectedCap}
            hoverCap={hoverCap}
            hidden={hidden}
            onSelectCap={setSelectedCap}
            onHoverCap={setHoverCap}
            onShowSessions={() => setSessionDock(true)}
            onCrownRefresh={reloadTree}
            onClose={clearSelection}
          />
        )}
      </div>
    </div>
  );
}

/** A decorative low-poly conifer (no status meaning). */
function DecorTree({ x, y, h, seed }: { x: number; y: number; h: number; seed: number }): React.JSX.Element {
  const lean = (rand01(seed) - 0.5) * 2;
  const w = h * 0.42;
  return (
    <g className="hex-conifer" transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${TILE_SCALE})`}>
      <ellipse className="flora-shadow" cx={1} cy={1} rx={w * 0.9} ry={2.4} />
      <path
        className={`conifer-body c-${seed % 3}`}
        d={`M ${lean} ${-h} L ${w} 0 L ${-w} 0 Z`}
      />
      <path className="conifer-snow" d={`M ${lean} ${-h} L ${lean + w * 0.45} ${-h * 0.45} L ${lean - w * 0.45} ${-h * 0.45} Z`} />
    </g>
  );
}

/**
 * The central story tree — the story ITSELF (ADR-0036 d.6b, vocabulary
 * recalibrated by ADR-0038). Crown size grows with capability count; GROWTH
 * and foliage carry the lifecycle: `proposed` (which `building` wears in the
 * world) grows a not-yet-full young tree — as does a claimed-but-empty story
 * (zero capabilities), which renders the same small form in its status hue
 * rather than a distinct sapling stage (owner 2026-06-21); `mapped` is the
 * full brownfield canopy, `healthy` the full green one; `unhealthy`
 * withers it to a sparse drooped crown with bare branches and leaf-fall.
 * Retired stories never reach this component (worldStatus.ts prunes them),
 * and the status arrives PROVEN (provenStatus): a green or withered crown is
 * the story's OWN UAT verdict speaking, never a child roll-up. The signpost
 * is the human-witness mark (ADR-0040): only uat_witness-human stories carry
 * one — dashed-blank until their UAT verdict is signed, a filled seal after
 * (the seal echoes the crown's hue; the FILL is the new bit).
 */
// The per-island ICON glyph (ADR-0102 §1): every island has its OWN deterministic identity icon
// — a distinct silhouette SHAPE bucket filled by its HUE, with a 1–2 char MONOGRAM for up-close
// legibility (shape + hue carry identity at a glance; the monogram disambiguates). Centred at the
// origin, base on y=0 growing upward (negative y) like the trees, so y-sorting layers it. The
// IDENTITY is the deterministic, unit-tested `storyIcon` (buildingLayout.ts) — Stage-1 red-green;
// the ART (the shape paths, the palette) is owner-attested (ADR-0070), carried by CSS (`.story-icon*`).
const ICON_GLYPH = {
  W: 22, // marker bounding width (kept == the old bookshelf so panel sizing/anchors are unchanged)
  H: 24, // marker height (base at y=0, top at y=-H)
};

/** The drawable parts of one little BUILDING (ADR-0102 §1 art, owner ask 2026-06-25 — "make it a
 *  real little building, not a flat shape"). A `body` rect-ish wall, a distinct `roof` per shape
 *  bucket (flat / peaked / gabled / stepped / domed / sawtooth / pitched / mansard), and `openings`
 *  (windows / a door) so it reads as architecture rather than a silhouette. All in the unit box
 *  roughly [-r..r] × [-h..0] (base on y=0, growing up). One per shape bucket; the bucket is
 *  `storyIcon(id).shape`. Pure geometry — the hue + stroke styling is CSS (owner-attested). */
interface BuildingParts {
  /** The wall/body outline (filled by the hue). */
  body: string;
  /** The roof outline, a separate fill so it can read a touch darker (the roofline is the variety). */
  roof: string;
  /** Window / door rectangles (and the rare round window as a circle) laid over the body. */
  openings: { x: number; y: number; w: number; h: number; round?: boolean }[];
}

/** A little building per shape bucket. Body height is the lower ~62% of the box; the roof occupies
 *  the top, varying by bucket. Openings (a door + 1–2 windows) sit on the body, deterministic by
 *  bucket so an island's building never reshuffles. Pure. */
function buildingParts(shape: number, r: number, h: number): BuildingParts {
  const s = (((shape % ICON_SHAPES) + ICON_SHAPES) % ICON_SHAPES) as number;
  const base = 0; // base y (ground)
  const eave = -h * 0.6; // top of the wall / bottom of the roof
  const peak = -h; // roof apex
  // A door centred on the base; windows flank it. Reused across buckets (tweaked per roofline).
  const doorW = r * 0.34;
  const doorH = h * 0.26;
  const door = { x: -doorW / 2, y: base - doorH, w: doorW, h: doorH };
  const winW = r * 0.3;
  const winH = h * 0.16;
  const winY = eave + h * 0.08;
  const winL = { x: -r * 0.62, y: winY, w: winW, h: winH };
  const winR = { x: r * 0.62 - winW, y: winY, w: winW, h: winH };
  // Most buildings share a plain rectangular wall; a couple narrow it for a tower read.
  const wallR = s === 1 || s === 4 ? r * 0.66 : r * 0.84; // tower / steeple are slimmer
  const rect = (w: number, top: number, bot: number): string =>
    `M ${-w} ${bot} L ${-w} ${top} L ${w} ${top} L ${w} ${bot} Z`;
  const body = rect(wallR, eave, base);

  switch (s) {
    case 0: {
      // Gabled house — a peaked triangular roof overhanging the wall, door + two windows.
      const o = r * 0.06;
      return {
        body,
        roof: `M ${-wallR - o} ${eave} L 0 ${peak} L ${wallR + o} ${eave} Z`,
        openings: [door, winL, winR],
      };
    }
    case 1: {
      // Domed tower — a slim tall wall capped by a half-dome, a tall door + a round window.
      const tw = wallR;
      return {
        body: rect(tw, eave, base),
        roof: `M ${-tw} ${eave} Q ${-tw} ${peak} 0 ${peak} Q ${tw} ${peak} ${tw} ${eave} Z`,
        openings: [
          { x: -doorW / 2, y: base - doorH * 1.15, w: doorW, h: doorH * 1.15 },
          { x: -r * 0.16, y: eave + h * 0.06, w: r * 0.32, h: r * 0.32, round: true },
        ],
      };
    }
    case 2: {
      // Stepped / ziggurat roof — two receding tiers above the wall (a civic block).
      const t1 = eave;
      const t2 = eave - h * 0.22;
      const top = peak;
      return {
        body,
        roof:
          `M ${-wallR} ${t1} L ${-wallR} ${t2} L ${-wallR * 0.62} ${t2} ` +
          `L ${-wallR * 0.62} ${top} L ${wallR * 0.62} ${top} L ${wallR * 0.62} ${t2} ` +
          `L ${wallR} ${t2} L ${wallR} ${t1} Z`,
        openings: [door, winL, winR],
      };
    }
    case 3: {
      // Flat-roof block with a parapet lip — a modern flat building, two stacked window rows.
      const o = r * 0.08;
      const lip = eave - h * 0.12;
      const winY2 = eave + h * 0.2;
      return {
        body,
        roof: `M ${-wallR - o} ${eave} L ${-wallR - o} ${lip} L ${wallR + o} ${lip} L ${wallR + o} ${eave} Z`,
        openings: [
          door,
          winL,
          winR,
          { x: -r * 0.62, y: winY2, w: winW, h: winH * 0.8 },
          { x: r * 0.62 - winW, y: winY2, w: winW, h: winH * 0.8 },
        ],
      };
    }
    case 4: {
      // Steeple / spire — a slim wall under a tall narrow pitched roof (a chapel), arched door.
      const tw = wallR;
      const o = r * 0.05;
      return {
        body: rect(tw, eave, base),
        roof: `M ${-tw - o} ${eave} L 0 ${peak} L ${tw + o} ${eave} Z`,
        openings: [{ x: -doorW / 2, y: base - doorH * 1.1, w: doorW, h: doorH * 1.1, round: true }],
      };
    }
    case 5: {
      // Sawtooth roof — a row of little peaks (a workshop / factory), a wide door + one window.
      const teeth = 3;
      const span = wallR * 2;
      const tw = span / teeth;
      let d = `M ${-wallR} ${eave}`;
      for (let i = 0; i < teeth; i++) {
        const x0 = -wallR + i * tw;
        d += ` L ${x0} ${peak} L ${x0 + tw} ${eave}`;
      }
      d += ' Z';
      return {
        body,
        roof: d,
        openings: [{ x: -doorW * 0.7, y: base - doorH, w: doorW * 1.4, h: doorH }, winR],
      };
    }
    case 6: {
      // Hip / pitched roof — a trapezoid roof (flat ridge, sloped ends), a warehouse, door + windows.
      const o = r * 0.06;
      const ridge = wallR * 0.42;
      return {
        body,
        roof: `M ${-wallR - o} ${eave} L ${-ridge} ${peak} L ${ridge} ${peak} L ${wallR + o} ${eave} Z`,
        openings: [door, winL, winR],
      };
    }
    default: {
      // 7: Mansard — a double-pitch roof (steep flare to a flatter cap), a townhouse, door + windows.
      const o = r * 0.07;
      const knee = eave - h * 0.24;
      const capW = wallR * 0.58;
      return {
        body,
        roof:
          `M ${-wallR - o} ${eave} L ${-capW - o * 0.4} ${knee} L ${-capW} ${peak} ` +
          `L ${capW} ${peak} L ${capW + o * 0.4} ${knee} L ${wallR + o} ${eave} Z`,
        openings: [door, winL, winR],
      };
    }
  }
}

/**
 * One island's identity icon as a little BUILDING (ADR-0102 §1; owner ask 2026-06-25), a `<g>`
 * centred horizontally at the origin with its base on y=0. A hue-tinted wall + a distinct ROOFLINE
 * per `shape` bucket + window/door detail, with the monogram as a small label beneath so the
 * building stays readable at the small on-map stamp size and richer on the panel card. Shared by
 * the on-map {@link StoryStamp} and the panel card (its own glyph + city), so they never drift.
 * Pure geometry off the deterministic {@link storyIcon}; the palette/stroke is CSS (owner-attested,
 * ADR-0070). `scale` lets a call site (the on-map stamp, the panel) draw it bigger without
 * disturbing the deterministic shape.
 */
function IconGlyph({ id, label = true }: { id: string; label?: boolean }): React.JSX.Element {
  const G = ICON_GLYPH;
  const icon = storyIcon(id);
  const r = G.W / 2;
  const parts = buildingParts(icon.shape, r, G.H);
  // hue drives the fill via a CSS var (a soft body, a deeper roof + same-hue outline) — owner-attested.
  const style = {
    '--icon-hue': String(icon.hue),
  } as React.CSSProperties;
  return (
    <g className="story-icon-art" style={style}>
      <path className="story-icon-body" d={parts.body} />
      <path className="story-icon-roof" d={parts.roof} />
      {parts.openings.map((o, i) =>
        o.round ? (
          <circle
            key={i}
            className="story-icon-window"
            cx={o.x + o.w / 2}
            cy={o.y + o.h / 2}
            r={Math.min(o.w, o.h) / 2}
          />
        ) : (
          <rect key={i} className="story-icon-window" x={o.x} y={o.y} width={o.w} height={o.h} rx={0.6} />
        ),
      )}
      {label && (
        <text className="story-icon-mono" x={0} y={-G.H * 0.04} textAnchor="middle">
          {icon.monogram}
        </text>
      )}
    </g>
  );
}

/* ADR-0228 retired the default-off grounded-art flags `?factoryart` (the baked identity-building
 * kit + baked standing stone) and `?garden` (the cosy-island garden composition) along with the
 * `?buildings` panel/stamp default. Their studio wiring — FactoryNodeEl / FactoryBuildingDefs /
 * FactoryGlyph / readFactoryArt / useFactoryKit / useBakedStone / GARDEN_ISLAND_ID / useGardenIsland —
 * is removed; the forest-world `bakedStone` / `garden` scene seams stay (dormant, fed `null`). The
 * unified vegetation vocabulary (`?veg`, the promoted default) is unaffected. */

/**
 * The unified vegetation vocabulary (grounded-art, ADR-0226) — now PERMANENT studio world art
 * (ADR-0231 retired the `?veg` toggle: always composed, never a flag). Every island wears the
 * vocabulary; the per-status `autumn-tree` colourways — fetched from the dynamic kit chunk (the
 * tree-spread, decision 1, amends ADR-0221; per-status hue restored by ADR-0227) — are added once they
 * resolve, replacing each island's procedural central tree with a `<use>` of the colourway for that
 * island's status. Returns `{}` (vocabulary on, procedural tree) until the colourways arrive, so the
 * tree swap is a late repaint rather than a hole — never `null`, since the vocabulary is always on.
 */
function useVegetation(): SceneVegetationInput {
  const [heroTrees, setHeroTrees] = useState<SceneVegHeroTrees | null>(null);
  useEffect(() => {
    let live = true;
    void loadHeroTreeVariants().then(
      (h) => { if (live) setHeroTrees(h); },
      (err: unknown) => { console.error('vegetation tree colourways failed to load; keeping the procedural tree', err); },
    );
    return () => { live = false; };
  }, []);
  return useMemo<SceneVegetationInput>(
    () => (heroTrees ? { heroTrees } : {}),
    [heroTrees],
  );
}

/**
 * The resolved sprite ART STYLE SHEET for the `artStyle` world setting (sprite-art-sheets arc) —
 * `null` while `artStyle` is the explicit `'vector'` procedural option (no fetch at all) or until a
 * chosen sheet's manifest resolves. The mirror of
 * {@link useBakedStone} / {@link useGardenIsland} for this seam: until it resolves the map keeps its
 * current render (vector, or a previously-loaded sheet), so a style swap is a late repaint rather than
 * a hole in the world.
 *
 * UNLIKE the factory kit / garden heroes / hero-tree colourways (a bundled `kit.json` chunk), a sheet
 * is a studio-served STATIC asset fetched from `/art-sheets/<name>/manifest.json` — the manifest names
 * its own sprite images, so there is nothing to bundle. `parseStyleSheet` (forest-world) validates the
 * fetched JSON and throws on anything malformed; the throw is caught + logged here so a bad manifest
 * degrades to vector, never a crash.
 */
function useArtStyleSheet(artStyle: string): SpriteStyleSheet | null {
  const [sheet, setSheet] = useState<SpriteStyleSheet | null>(null);
  useEffect(() => {
    if (artStyle === 'vector') {
      setSheet(null);
      return;
    }
    let live = true;
    void fetch(`/art-sheets/${artStyle}/manifest.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`art-sheet manifest fetch failed: ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then((json) => {
        const parsed = parseStyleSheet(json);
        if (live) setSheet(parsed);
      })
      .catch((err: unknown) => {
        console.error(`art-style sheet "${artStyle}" failed to load; keeping the current render`, err);
      });
    return () => {
      live = false;
    };
  }, [artStyle]);
  return sheet;
}

/**
 * A promoted ICON STAMP (ADR-0102) on a map island: the identity glyph of a BUILDING this island
 * depends on ("you carry the icon of what you depend on"). NOT a replacement for the island's tree
 * — a low-salience badge beside it (the edge is kept, not dropped: ADR-0074 §1). The named building
 * lives in the left Shared Islands panel; clicking the stamp highlights it there (`onStampClick`).
 * The tooltip names the coupling. Appearance owner-attested (ADR-0070) — geometry only here.
 */
function StoryStamp({
  story,
  icon,
  spot,
  hidden,
  onStampClick,
}: {
  story: TreeStory;
  /** The building id whose identity glyph this stamp carries. */
  icon: string;
  spot: Pt;
  hidden: ReadonlySet<string>;
  /** ADR-0102: clicking the stamp highlights the shared island it names in the left panel
   *  (instead of selecting the carrier island). Absent in the panel's own one-island render. */
  onStampClick?: (sharedId: string) => void;
}): React.JSX.Element {
  const st = story.status ?? 'unknown';
  return (
    <g
      className={`story-icon-stamp${hidden.has(st) ? ' is-filtered' : ''}${onStampClick ? ' is-link' : ''}`}
      transform={`translate(${spot.x.toFixed(1)} ${spot.y.toFixed(1)}) scale(1.0)`}
      {...(onStampClick
        ? {
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation(); // highlight the panel island, don't select the carrier
              onStampClick(icon);
            },
          }
        : {})}
    >
      <title>{`${icon} — used by ${story.id} · click to find it in Shared Islands`}</title>
      <ellipse className="flora-shadow" cx={1} cy={1.6} rx={11} ry={3.0} />
      <IconGlyph id={icon} />
    </g>
  );
}

/**
 * The studio-only world CHROME that is NOT in the shared scene-graph (ADR-0093 Decision 2: studio
 * chrome layers ON TOP of `<SceneView>`, never pushed into the framework-agnostic core). With the
 * scene render now the DEFAULT (ADR-0093 Unit D), this overlay restores the pieces that lived
 * only in the old inline `<g>` and are NOT in the shared core (so the flip regresses nothing).
 * (A third piece, the solar SPOKES, stood here behind a `world.solar &&` guard until ADR-0283 D2
 * retired the radial layout that populated it; the guard could no longer be true, so the pass and
 * its `.solar-spoke-net` markup are gone with the arrangement.) What remains:
 *  - the distributed-consumer building STAMPS each island carries (`Territory.stamps`, ADR-0102) — the
 *    scene draws the trees/flora/plates/wisps, but the stamps are studio chrome, so they ride here; and
 *  - the per-nameplate IDENTITY-KEY glyph (`world-plate-key` + `IconGlyph`, ADR-0102) — each island's
 *    own building beside its name tag, the legend that decodes the stamps + shared-island cities. The
 *    scene draws the plate, but the key glyph is studio chrome — it rides here at the SAME placement
 *    the legacy `TerritoryFlora` used (right of the plate, base-aligned to its bottom).
 *
 * It is a SIBLING `<g>` of `<SceneView>` inside the same `<svg>`, wrapped in the world `offset` so it
 * shares the scene's coordinate space (the scene applies the offset on its own `world` root group).
 * The `depends_on` roads and the static layers are already in the scene; the Shared-Islands panel,
 * session dock and settings gear are React `<div>`s outside the `<svg>` and are untouched.
 */
export const StudioWorldChrome = memo(function StudioWorldChrome({
  world,
  hidden,
  onStampClick,
  buildings = false,
}: {
  world: HexWorld;
  hidden: ReadonlySet<string>;
  /** ADR-0102: clicking an island's stamp highlights the shared island it names in the left panel. */
  onStampClick: (sharedId: string) => void;
  /** ADR-0228: the shared-island / stamp world (default OFF). The distributed stamps ride `t.stamps`
   *  (already empty when the caller has `buildings` off), but the per-nameplate IDENTITY-KEY glyph is
   *  driven off the island id directly — it is gated here so the default map has clean nameplates and
   *  the glyph returns only under the `?buildings=on` escape (where it decodes the stamps). */
  buildings?: boolean;
}): React.JSX.Element {
  return (
    <g className="studio-world-chrome" transform={`translate(${world.offset.x} ${world.offset.y})`}>
      {/* The distributed-consumer building stamps each island carries (ADR-0102) — the `?buildings=on`
          escape only; `t.stamps` is empty in the default (buildings-off) pathways world (ADR-0228). */}
      {world.territories.map((t) =>
        t.stamps.map((stamp) => (
          <StoryStamp
            key={`stamp:${t.story.id}:${stamp.icon}`}
            story={t.story}
            icon={stamp.icon}
            spot={stamp.spot}
            hidden={hidden}
            onStampClick={onStampClick}
          />
        )),
      )}
      {/* The per-nameplate identity-key glyph (ADR-0102) — the scene draws the plate; this restores
          the key beside it at the SAME world placement the legacy TerritoryFlora used: inside the
          plate group (centroid.x - w/2, labelY), then right of the plate base-aligned to its bottom
          (w + NAMEPLATE_KEY_MARGIN, h). The building-glyph stays false on the map (ADR-0088).
          ADR-0228: the identity-key glyph decodes the stamps, so it renders ONLY under the
          `?buildings=on` escape; the default map has clean nameplates (no little house glyph). */}
      {buildings &&
        world.territories.map((t) => {
          const plate = nameplateLayout(t.story.id.length, t.buildingGlyph);
          const x = t.centroid.x - plate.w / 2 + plate.w + NAMEPLATE_KEY_MARGIN;
          const y = t.labelY + plate.h;
          return (
            <g
              key={`key:${t.story.id}`}
              className="world-plate-key"
              transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${NAMEPLATE_KEY_SCALE})`}
            >
              <IconGlyph id={t.story.id} />
            </g>
          );
        })}
    </g>
  );
});

/**
 * The claimed-land GROUND layer for every territory in `world`, back-to-front so extrusions
 * layer — the relaxed mesh substrate (the default) or the extruded hex tiles. Shared by the MAP
 * (interactive: per-territory hover/select) and the Shared Islands panel CARD (non-interactive),
 * so an island's ground reads identically in both and the two can never drift (ADR-0088 follow-on,
 * owner 2026-06-22 — the panel islands were missing this layer and looked flat). Pure geometry off
 * the world model; the handlers are the only difference between the two call sites.
 */
function IslandGround({
  world,
  relaxedCells,
  classOf,
  interactive,
}: {
  world: HexWorld;
  relaxedCells: RelaxedCell[] | null;
  /** The per-territory ground class. The map passes its focus/hover-aware `territoryClass`; the
   *  panel card passes a static `hex-territory st-<status>` (no map focus context). */
  classOf: (story: TreeStory) => string;
  interactive?: { onHover?: (id: string | null) => void; onSelect: (id: string) => void };
}): React.JSX.Element {
  const hov = interactive?.onHover;
  const sel = interactive?.onSelect;
  if (relaxedCells) {
    // VISUAL SPIKE substrate: irregular relaxed cells, grouped by territory for hover/focus.
    return (
      <g className="relaxed-land">
        {world.territories.map((territory, owner) => {
          const cells = relaxedCells.filter((c) => c.owner === owner);
          if (cells.length === 0) return null;
          return (
            <g
              key={territory.story.id}
              className={`relaxed-tile ${classOf(territory.story)}`}
              {...(hov
                ? { onMouseEnter: () => hov(territory.story.id), onMouseLeave: () => hov(null) }
                : {})}
              {...(sel ? { onClick: () => sel(territory.story.id) } : {})}
            >
              {cells.map((cell, i) => (
                <path
                  key={i}
                  className={`relaxed-cell ${cell.wheat ? 'is-wheat' : `v-${cell.variant}`}`}
                  d={polyPath(cell.poly)}
                />
              ))}
            </g>
          );
        })}
      </g>
    );
  }
  return (
    <g className="hex-land">
      {world.drawTiles.map(({ h, owner }) => {
        const territory = world.territories[owner];
        if (!territory) return null;
        const c = hexCenter(h);
        const key = axialKey(h);
        const variant = hash(`tile:${key}`) % 3;
        const wheat = territory.wheatTiles.has(key);
        return (
          <g
            key={key}
            className={`hex-tile ${classOf(territory.story)}`}
            {...(hov
              ? { onMouseEnter: () => hov(territory.story.id), onMouseLeave: () => hov(null) }
              : {})}
            {...(sel ? { onClick: () => sel(territory.story.id) } : {})}
          >
            <path className="hex-side" d={hexPath(c.x, c.y + TILE_DEPTH, HEX_R)} />
            <path
              className={`hex-top ${wheat ? 'is-wheat' : `v-${variant}`}`}
              d={hexPath(c.x, c.y, HEX_R)}
            />
          </g>
        );
      })}
    </g>
  );
}

/** The panel identity-glyph "key": the island's OWN building, drawn as a small labelled landmark
 *  to the RIGHT of the name card so the viewer learns which building IS this island (the one
 *  stamped on its dependers). The glyph is centred at its origin, so its half-width is folded into
 *  the margin → its LEFT edge clears the card's right edge by ~6px. Owner-attested look (ADR-0102). */
const PANEL_KEY_SCALE = 1.25;
const PANEL_KEY_MARGIN = 8 + (ICON_GLYPH.W / 2) * PANEL_KEY_SCALE;
/** The on-map identity "key": every map island draws its OWN building just to the RIGHT of its name
 *  tag (ADR-0102, owner ask 2026-06-25), base-aligned to the plate bottom — the same right-of-the-name
 *  pattern as the panel card's key, so the map becomes the legend that lets you decode a hub's city
 *  ("this nameplate building = drive-machinery" → recognise it inside cli's city). The glyph is
 *  centred at its origin, so its half-width is folded into the margin → its LEFT edge clears the
 *  plate's right edge by ~6px. Owner-attested look. */
const NAMEPLATE_KEY_SCALE = 1.0;
const NAMEPLATE_KEY_MARGIN = 6 + (ICON_GLYPH.W / 2) * NAMEPLATE_KEY_SCALE;
/** The dependency-city geometry on a panel card (ADR-0102 §3, owner ask 2026-06-25 — the city sits
 *  ON the island land, mirroring the on-map stamp seating, NOT in a grid beside the card). Each city
 *  building is fanned around the central tree in concentric tiers and snapped onto owned land. */
const CITY_SCALE = 0.78; // a touch smaller than the island's own "key" building, so the city reads as a cluster

/**
 * Seat a source hub's dependency CITY (its `icons`) ON the island's land (ADR-0102 §3, owner ask
 * 2026-06-25), mirroring the on-map `Territory.stamps` seating in {@link buildWorld}: fan the
 * buildings around the central tree — alternating sides, stepping the radius out per tier so a
 * dense city never collapses to one point — then walk each candidate INWARD until it sits on owned
 * land (`ownedKeys`, the hex keys this territory claims), so a building never floats over the sea.
 * Pure + deterministic per (treeSpot, crownR, icons, ownedKeys): a city never reshuffles between
 * renders (ADR-0069). The look (density, spread) is owner-attested; this fixes only WHERE each
 * building lands. Mirrors the on-map fan but DENSER (a city, not a 1–2 badge garden).
 */
export function cityStampSpots(
  treeSpot: Pt,
  crownR: number,
  icons: readonly string[],
  ownedKeys: ReadonlySet<string>,
): { icon: string; spot: Pt }[] {
  const onLand = (p: Pt): boolean => ownedKeys.has(axialKey(pixelToHex(p)));
  // Lay the city in concentric rings around the tree base. Ring 0 is a tight inner cluster; each
  // further ring holds more buildings at a wider radius, so a 6-building city (cli) fills the land
  // while a 2-building one (library) sits close in. Counts grow per ring (3, 5, 7, …).
  const ringCount = (ring: number): number => 3 + ring * 2;
  return icons.map((icon, i) => {
    // Which ring this index falls in, and its slot within the ring.
    let ring = 0;
    let consumed = 0;
    while (i >= consumed + ringCount(ring)) {
      consumed += ringCount(ring);
      ring += 1;
    }
    const slot = i - consumed;
    const inRing = ringCount(ring);
    const radius = crownR * 0.62 + ring * (crownR * 0.66);
    // Spread the ring across the front + sides (avoid directly behind the trunk, where the canopy
    // would hide a building): an arc centred south (downward), ~300° wide, offset per ring so rings
    // interleave rather than stack radially.
    const ARC = (Math.PI * 5) / 3; // ~300°
    const a0 = Math.PI / 2 - ARC / 2; // start just west of due-south
    const angle = a0 + ((slot + 0.5) / inRing) * ARC + ring * 0.4;
    let x = treeSpot.x + Math.cos(angle) * radius;
    // ⚠ A THIRD SITE OF ADR-0367's SQUASH CLASS, LEFT OPEN DELIBERATELY, and this note plus the
    // increment's closure are the only record: `pnpm check:ground-space` guards point-to-point
    // DISTANCES, and a bare y-multiply is not one, so nothing mechanical will raise it (the same
    // blind spot `driftSpot`'s own `* 0.6` sits in, recorded on `ground-space-truth-arc`'s
    // driftspot closure). `0.66` is a hand-picked
    // top-down squash where the declared camera says `sin 20° ≈ 0.342` — the identical constant
    // `studio-island-layout-moves-to-ground-space` retired from the capability ring. It is NOT
    // folded in there because this fan seats BUILDINGS in the Shared Islands panel and its density
    // and spread are owner-attested (see this function's own doc above), so correcting it changes an
    // attested picture and needs an owner look, exactly as `driftSpot`'s does.
    let y = treeSpot.y + Math.sin(angle) * radius * 0.66 + 4; // top-down squash, a touch in front
    for (let k = 0; k < 6 && !onLand({ x, y }); k++) {
      x += (treeSpot.x - x) * 0.28;
      y += (treeSpot.y - y) * 0.28;
    }
    return { icon, spot: { x, y } };
  });
}

/**
 * One shared island rendered inside the left panel (ADR-0088 + ADR-0102). Reuses the
 * world-model→render seam: `buildWorld([story], { buildings:false })` lays the building out as
 * exactly one Territory (its own sand coastline, the SAME ground substrate the map paints, central
 * health tree, capability garden, nameplate) — visually identical to a map island — painted inside
 * a self-contained `<svg viewBox>`. The ADR-0102 vocabulary (owner ask 2026-06-25):
 *   • the island's CITY — the buildings of everything it depends on (its promoted dependency
 *     stamps, §3) — sits ON the island's LAND, mirroring the on-map stamp seating ({@link
 *     cityStampSpots}): a SOURCE hub (cli) covers its land with a dense city of ~6 buildings; a
 *     SINK hub (library) shows its 2 on the land. This is the "city of buildings" the ADR rests on.
 *   • the island's OWN building is kept as a small labelled "key" to the RIGHT of the name card, so
 *     the viewer learns which building IS this island — the one stamped on its dependers.
 * The city is computed from the FULL `stories` list (so a hub's provider-side edges resolve). No
 * on-map context (no roads, no neighbours): the panel island stands alone. The card is the click
 * target into the side panel; clicking it selects the story like clicking its map island.
 * Appearance owner-attested (ADR-0070).
 */
function SharedIslandCard({
  story,
  stories,
  hidden,
  builds,
  claims = [],
  departures = [],
  now,
  highlighted,
  substrateMode,
  substrateTuning,
  onSelect,
}: {
  story: TreeStory;
  /** The FULL story list — to resolve this island's city (its dependency icons, ADR-0102 §3). */
  stories: TreeStory[];
  hidden: ReadonlySet<string>;
  builds: BuildActivity[];
  /** ADR-0138 §5: this story's claim wisps (default `[]`). */
  claims?: ClaimActivity[];
  /** ADR-0200 D7: this story's fading claim departures (default `[]`). */
  departures?: DepartedClaim[];
  now: Date;
  highlighted: boolean;
  /** The map's ground substrate (the default mesh, or null for plain hex tiles), so the panel
   *  island paints the same ground texture — reactive to the gear like the map. */
  substrateMode: SubstrateMode | null;
  substrateTuning: Partial<SubstrateTuning>;
  onSelect: () => void;
}): React.JSX.Element {
  // Pure, deterministic per the story data + substrate (ADR-0069) → memoise so scrolling / the
  // now-ticker never re-lays the island or its ground.
  const world = useMemo(() => buildWorld([story], { buildings: false }), [story]);
  const relaxedCells = useMemo(
    () => (substrateMode ? buildRelaxedCells(world, substrateMode, substrateTuning) : null),
    [world, substrateMode, substrateTuning],
  );
  const t = world.territories[0];
  const st = story.status ?? 'unknown';
  const cls = `shared-island-card st-${st}${highlighted ? ' is-highlighted' : ''}`;
  const ariaLabel = `shared island ${story.id} — ${story.title}`;
  if (!t) {
    return <button type="button" className={cls} onClick={onSelect} aria-label={ariaLabel} />;
  }
  const plate = nameplateLayout(story.id.length, false);
  // The island's OWN building, kept as a small labelled "key" to the right of the name card.
  const anchor = bookshelfAnchorRight(plate, t.centroid.x, t.labelY, PANEL_KEY_MARGIN);
  // This island's CITY (ADR-0102 §3): the icons of everything it depends on. Resolve over the FULL
  // list with THIS story forced building (so its incident edges promote regardless of the flag).
  const city = useMemo(() => {
    const wired = stories.map((s) => ({ id: s.id, dependsOn: s.dependsOn, consumedBy: s.consumedBy }));
    return stampsByCarrier(promotedStamps(wired, new Set([story.id]))).get(story.id) ?? [];
  }, [stories, story.id]);
  // Seat the city ON the land (owner ask 2026-06-25), mirroring the on-map stamp seating: fan the
  // dependency buildings around the central tree and snap each onto an owned tile (cityStampSpots).
  const cityStamps = useMemo(
    () => cityStampSpots(t.treeSpot, crownRadius(story.capabilities.length), city, new Set(t.tiles.map(axialKey))),
    [t.treeSpot, t.tiles, story.capabilities.length, city],
  );
  // Widen the viewBox so the right-side "key" building isn't clipped — buildWorld's bounds don't know about it.
  const keyHalf = (ICON_GLYPH.W / 2 + 2) * PANEL_KEY_SCALE;
  const vbW = Math.max(world.width, world.offset.x + anchor.x + keyHalf + 6);
  const vbH = Math.max(world.height, world.offset.y + anchor.y + 6);
  return (
    <button type="button" className={cls} onClick={onSelect} aria-label={ariaLabel}>
      <svg className="shared-island-svg" viewBox={`0 0 ${vbW} ${vbH}`} aria-hidden="true">
        <g transform={`translate(${world.offset.x} ${world.offset.y})`}>
          {/* the island's sand silhouette (the same smoothed coast the map fills) */}
          <g className="hex-coastland">
            <g className={`coast-fill-group hex-territory st-${st}`}>
              {t.coastGroundLoops.map((loop, i) => (
                <path key={`cf${i}`} className="coast-fill" d={coastScreenPath(loop)} />
              ))}
            </g>
          </g>
          {/* the SAME ground substrate the map paints (mesh by default) — so a panel island reads
              identically to a map island instead of a flat silhouette (owner 2026-06-22). */}
          <IslandGround
            world={world}
            relaxedCells={relaxedCells}
            classOf={(s) => `hex-territory st-${s.status ?? 'unknown'}`}
          />
          <TerritoryFlora
            territory={t}
            className={`hex-territory st-${st}`}
            hidden={hidden}
            builds={builds}
            claims={claims}
            departures={departures}
            now={now}
            onHover={() => {}}
            onSelect={() => onSelect()}
            identityKey={false}
          />
          {/* ADR-0102 (owner ask 2026-06-25): this island's dependency CITY sits ON the land —
              the buildings of everything it depends on, fanned around the tree and seated on owned
              soil (cityStampSpots), just like the on-map stamps. A source hub (cli) reads as a
              dense city; a sink hub (library) as a couple of buildings. Sorted by y so they layer
              with the flora; a touch smaller than the own-building "key" beside the card. */}
          {cityStamps.length > 0 && (
            <g className="shared-island-city" aria-hidden="true">
              <title>{`${story.id} depends on ${cityStamps.length} shared ${cityStamps.length === 1 ? 'island' : 'islands'}`}</title>
              {[...cityStamps]
                .sort((a, b) => a.spot.y - b.spot.y)
                .map((s) => (
                  <g
                    key={s.icon}
                    className="city-icon"
                    transform={`translate(${s.spot.x.toFixed(1)} ${s.spot.y.toFixed(1)}) scale(${CITY_SCALE})`}
                  >
                    <ellipse className="flora-shadow" cx={1} cy={1.4} rx={9} ry={2.6} />
                    <IconGlyph id={s.icon} label={false} />
                  </g>
                ))}
            </g>
          )}
          {/* The island's OWN building, kept as a small labelled "key" OUTSIDE the name card, to its
              RIGHT — so the viewer learns which building IS this island (the one stamped on its
              dependers). The dependency city above goes ON the land; this key names the island. */}
          <g
            className="shared-island-glyph"
            transform={`translate(${anchor.x.toFixed(1)} ${anchor.y.toFixed(1)}) scale(${PANEL_KEY_SCALE})`}
            aria-hidden="true"
          >
            <IconGlyph id={story.id} />
          </g>
        </g>
      </svg>
    </button>
  );
}

/**
 * The permanent left "Shared Islands" panel (ADR-0088, amends ADR-0076 §2). ALWAYS visible (not
 * a toggle): it relocates the world legend (top section) and hosts the building-class islands
 * (the `library`, generic over `story.building === true`) lifted OFF the map. Every expansion —
 * a legend chip's state fan, or a shared island's detail — opens as a single self-contained box
 * popping to the RIGHT of the panel (the {@link flyoutReducer} keeps at most one open), so it
 * never reflows the panel's vertical content. Escape / click-outside dismiss the flyout.
 */
function SharedIslandsPanel({
  connection,
  islands,
  stories,
  builds,
  claimsByStory,
  departuresByStory,
  now,
  hidden,
  highlightId,
  substrateMode,
  substrateTuning,
  spriteSheet,
  storyStatusFromNameplate = false,
  onToggleStatus,
  onResetHidden,
  onSelectIsland,
}: {
  /**
   * `store-connection-signal`: the live store's connection reading, or null when there is none to
   * give. Rendered at the TOP of this panel, above the Legend drawer — the owner's placement, and
   * the reason it lives here rather than in its own dock: this column is already where the map puts
   * the things you read rather than click, and hosting it costs no second positioned overlay.
   * Sits OUTSIDE the scrolling body, so a long island list can never scroll the light out of view.
   */
  connection: StoreConnectionReading | null;
  islands: TreeStory[];
  stories: TreeStory[];
  builds: BuildActivity[];
  /** ADR-0138 §5: claims grouped by story (live by default), so each shared-island card can orbit
   *  its OWN story's claim wisps in the preview. */
  claimsByStory: Map<string, ClaimActivity[]>;
  /** ADR-0200 D7: fading claim departures grouped by story, sibling to `claimsByStory`. */
  departuresByStory: Map<string, DepartedClaim[]>;
  now: Date;
  hidden: ReadonlySet<string>;
  highlightId: string | null;
  substrateMode: SubstrateMode | null;
  substrateTuning: Partial<SubstrateTuning>;
  /** ADR-0230: the active sprite art sheet (or null in vector mode), threaded to the panel's legend
   *  (both the chip bar and the right-flyout drawer) so its icons sprite in sync with the map. */
  spriteSheet: SpriteStyleSheet | null;
  /** Under `?landMount=1`, the SVG hero tree is suppressed in favour of 3D props; nameplate text
   *  remains the explicit story-status reading for both legend surfaces. */
  storyStatusFromNameplate?: boolean;
  onToggleStatus: (st: string) => void;
  onResetHidden: () => void;
  onSelectIsland: (id: string) => void;
}): React.JSX.Element {
  // The legend surfaces, real unless a caller substituted one (see StudioSurfacesContext).
  const surfaces = useStudioSurfaces();
  const [flyout, dispatch] = useReducer(flyoutReducer, FLYOUT_CLOSED);
  const panelRef = useRef<HTMLDivElement>(null);
  const islandRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // Legend + Shared Islands are TWO independent drawers, each collapsed to a bar by default (owner
  // UX: a laptop screen was crowded + scrolled). Only the Shared-Islands one is controlled — so a map
  // stamp-click can pop it open to reveal the island it highlights; the Legend drawer is a plain
  // uncontrolled <details>.
  const [islandsOpen, setIslandsOpen] = useState(false);

  // Escape / click-outside dismiss the right-flyout (the contained-loop close).
  useEffect(() => {
    if (!flyout.open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') dispatch({ type: 'close' });
    };
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && !panelRef.current?.contains(e.target)) {
        dispatch({ type: 'close' });
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [flyout.open]);

  // A stamp click on the map highlights its shared island — pop the Shared-Islands drawer open (it is
  // collapsed by default) so the highlight is visible.
  useEffect(() => {
    if (highlightId) setIslandsOpen(true);
  }, [highlightId]);
  // …then scroll the card into view once the drawer is open and its slot is in the DOM.
  useEffect(() => {
    if (!highlightId || !islandsOpen) return;
    islandRefs.current.get(highlightId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [highlightId, islandsOpen]);

  const legendKey = (row: RowKey): string => `legend:${row}`;
  const legendOpen: RowKey | null = flyout.open?.startsWith('legend:')
    ? (flyout.open.slice('legend:'.length) as RowKey)
    : null;
  const openIslandId = flyout.open?.startsWith('island:')
    ? flyout.open.slice('island:'.length)
    : null;

  // ADR-0138 §5: the flat claim list for the legend's "sessions working" row (flag-gated → empty
  // unless `?claims=` is set, so the legend stays unchanged on `main`).
  const panelClaims = useMemo(() => [...claimsByStory.values()].flat(), [claimsByStory]);
  const model = legendModelFor(stories, builds, now, panelClaims);
  const openIsland = openIslandId ? islands.find((s) => s.id === openIslandId) : undefined;

  return (
    <div className="shared-islands-panel" ref={panelRef}>
      <StoreConnectionChip reading={connection} />
      <div className="shared-islands-panel-body">
        {/* Two independent drawers, each a clickable bar collapsed by default (owner UX) — mirror the
            right panel's "Architectural Decision Records" <details>. First the Legend chip-bar, then the
            Shared-Island cards (controlled, so a map stamp-click pops it open). The legend's own row
            flyout still renders to the RIGHT, so expanding a chip never shoves the panel content down. */}
        <details className="panel-drawer panel-legend">
          <summary className="panel-drawer-head">Legend</summary>
          <surfaces.WorldLegend
            stories={stories}
            builds={builds}
            claims={panelClaims}
            now={now}
            hidden={hidden}
            onToggleStatus={onToggleStatus}
            onResetHidden={onResetHidden}
            open={legendOpen}
            onToggle={(key) =>
              key ? dispatch({ type: 'toggle', key: legendKey(key) }) : dispatch({ type: 'close' })
            }
            renderDrawer={false}
            barClassName="legend-bar-panel"
            spriteSheet={spriteSheet}
            storyStatusFromNameplate={storyStatusFromNameplate}
          />
        </details>

        {/* ADR-0228: the Shared-Islands drawer renders only when there ARE shared islands to house —
            i.e. under the `?buildings=on` escape. The default is buildings-off, so this drawer is
            absent and the panel carries just the Legend. */}
        {islands.length > 0 && (
          <details
            className="panel-drawer panel-islands"
            open={islandsOpen}
            onToggle={(e) => setIslandsOpen((e.currentTarget as HTMLDetailsElement).open)}
          >
            <summary className="panel-drawer-head">Shared Islands</summary>
            <div className="shared-islands-list">
              {islands.map((s) => (
                <div
                  key={s.id}
                  className="shared-island-slot"
                  ref={(el) => {
                    if (el) islandRefs.current.set(s.id, el);
                    else islandRefs.current.delete(s.id);
                  }}
                >
                  <SharedIslandCard
                    story={s}
                    stories={stories}
                    hidden={hidden}
                    builds={builds}
                    claims={claimsByStory.get(s.id) ?? []}
                    departures={departuresByStory.get(s.id) ?? []}
                    now={now}
                    highlighted={s.id === highlightId}
                    substrateMode={substrateMode}
                    substrateTuning={substrateTuning}
                    onSelect={() => onSelectIsland(s.id)}
                  />
                  <button
                    type="button"
                    className={`shared-island-detail-toggle${openIslandId === s.id ? ' on' : ''}`}
                    aria-expanded={openIslandId === s.id}
                    onClick={() => dispatch({ type: 'toggle', key: `island:${s.id}` })}
                  >
                    {s.id} · details
                  </button>
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* The ONE right-flyout (a self-contained box anchored to the panel's right edge): either
          the open legend row's drawer body, or the open shared island's detail. */}
      {flyout.open && (legendOpen || openIsland) && (
        <div className="panel-flyout" role="dialog" aria-label="panel detail">
          {legendOpen ? (
            <>
              <div className="panel-flyout-head">{legendRowLabel(legendOpen, storyStatusFromNameplate)}</div>
              <surfaces.LegendDrawerBody
                rowKey={legendOpen}
                model={model}
                hidden={hidden}
                onToggleStatus={onToggleStatus}
                spriteSheet={spriteSheet}
                storyStatusFromNameplate={storyStatusFromNameplate}
              />
            </>
          ) : openIsland ? (
            <div className="panel-flyout-island">
              <div className="panel-flyout-head">{openIsland.id}</div>
              <p className="panel-flyout-title">{openIsland.title}</p>
              <p className="panel-flyout-meta">
                {openIsland.status ?? 'unknown'} · {openIsland.capabilities.length} capabilities
              </p>
              {openIsland.outcome && <p className="panel-flyout-outcome">{openIsland.outcome}</p>}
              <button
                type="button"
                className="panel-flyout-open"
                onClick={() => onSelectIsland(openIsland.id)}
              >
                Open in side panel →
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function StoryTree({
  territory: t,
  hidden,
  now,
}: {
  territory: Territory;
  hidden: ReadonlySet<string>;
  now: Date;
}): React.JSX.Element {
  const story = t.story;
  const st = story.status ?? 'unknown';
  const caps = story.capabilities.length;
  const withered = st === 'unhealthy';
  // The not-yet-full form: a small tree in the status hue. `proposed` hasn't earned
  // full growth, and a claimed-but-empty story (zero capabilities) renders the SAME
  // small form rather than a distinct sapling stage (owner 2026-06-21 — the sapling
  // state was visually identical to a zero-cap proposed tree, so it was folded in).
  const young = !withered && (st === 'proposed' || caps === 0);
  const R = crownRadius(caps) * (young ? 0.62 : 1);
  const cy = -1.65 * R;
  const verdictNote = story.verdict ? ` · UAT ${verdictPhrase(story.verdict)}` : '';

  // Deterministic per-blob jitter so the five islands' trees aren't clones.
  const jb = (
    i: number,
    bcx: number,
    bcy: number,
    br: number,
  ) => {
    const k = hash(`${story.id}:crown:${i}`);
    return {
      cx: bcx + (rand01(k) - 0.5) * 0.12 * R,
      cy: bcy + (rand01(k + 1) - 0.5) * 0.1 * R,
      r: br * (0.94 + rand01(k + 2) * 0.12),
    };
  };
  const base = [
    { cx: 0, cy, r: R }, // the central blob is never jittered
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
  const trunkD = `M -3.6 0 C -3.2 ${(0.3 * cy).toFixed(1)}, -2.4 ${(0.65 * cy).toFixed(1)}, -2.2 ${cy.toFixed(1)} L 2.2 ${cy.toFixed(1)} C 2.4 ${(0.65 * cy).toFixed(1)}, 3.2 ${(0.3 * cy).toFixed(1)}, 3.6 0 Q 0 2.4 -3.6 0 Z`;
  const bareBranches = [
    `M 0 ${(-1.65 * R).toFixed(1)} C 2 ${(-2.07 * R).toFixed(1)}, 1 ${(-2.36 * R).toFixed(1)}, ${(0.21 * R).toFixed(1)} ${(-2.64 * R).toFixed(1)}`,
    `M ${(0.12 * R).toFixed(1)} ${(-2.29 * R).toFixed(1)} L ${(0.32 * R).toFixed(1)} ${(-2.43 * R).toFixed(1)}`,
    `M -4 ${(-1.79 * R).toFixed(1)} C -9 ${(-2.07 * R).toFixed(1)}, -8 ${(-2.25 * R).toFixed(1)}, ${(-0.46 * R).toFixed(1)} ${(-2.43 * R).toFixed(1)}`,
    `M ${(-0.31 * R).toFixed(1)} ${(-2.14 * R).toFixed(1)} L ${(-0.5 * R).toFixed(1)} ${(-2.18 * R).toFixed(1)}`,
  ];

  return (
    <g
      className={`story-tree st-${st}${hidden.has(st) ? ' is-filtered' : ''}`}
      transform={`translate(${t.treeSpot.x.toFixed(1)} ${t.treeSpot.y.toFixed(1)}) scale(${TREE_SCALE})`}
    >
      <title>{`${story.id} — ${story.error ? 'story spec error' : st}${verdictNote}`}</title>
      <ellipse
        className="flora-shadow"
        cx={2}
        cy={2}
        rx={(R * 0.78).toFixed(1)}
        ry={(R * 0.2).toFixed(1)}
      />
      {withered ? (
        <>
          <path className="story-trunk" d={trunkD} />
          <g className="crown-lo">
            <circle cx={0} cy={cy + 0.15 * R} r={0.78 * R} />
            <circle cx={-0.62 * R} cy={cy + 0.36 * R} r={0.49 * R} />
          </g>
          <g className="crown-hi" opacity={0.7}>
            <circle cx={-0.21 * R} cy={cy - 0.14 * R} r={0.32 * R} />
          </g>
          <g className="story-bare">
            {bareBranches.map((d, i) => (
              <path key={i} d={d} />
            ))}
          </g>
          {[-14, -6, 8, 16].map((lx, i) => (
            <circle key={i} className="leaf-litter" cx={lx} cy={[-2, 1, -1, -4][i]} r={1.3} />
          ))}
        </>
      ) : (
        <>
          <path className="story-trunk" d={trunkD} />
          <g className="crown-lo">
            {base.map((b, i) => (
              <circle key={i} cx={b.cx.toFixed(1)} cy={b.cy.toFixed(1)} r={b.r.toFixed(1)} />
            ))}
          </g>
          <g className="crown-hi">
            {highlights.map((b, i) => (
              <circle key={i} cx={b.cx.toFixed(1)} cy={b.cy.toFixed(1)} r={b.r.toFixed(1)} />
            ))}
          </g>
        </>
      )}
    </g>
  );
}

/**
 * A capability as garden flora (ADR-0036 d.6b/d): a flower bed, berry bush or
 * sapling (hash-picked), tinted by the PROVEN status (worldStatus.ts): deep
 * green means the last signed run passed — the hue IS the verdict (ADR-0040),
 * so there is no ✓/✗ badge. A failed last run or authored `unhealthy` arrives
 * here as `unhealthy` and withers it to the matching dead silhouette; absence
 * of a verdict stays silent (the authored ladder under-claims).
 */
function GardenPlant({
  spot,
  hidden,
  now,
  onSelect,
}: {
  spot: CapSpot;
  hidden: ReadonlySet<string>;
  now: Date;
  onSelect: () => void;
}): React.JSX.Element {
  const { cap, x, y } = spot;
  const st = cap.status ?? 'unknown';
  const variant = hash(`${cap.id}:variant`) % 3;
  // The presented status already folds the verdict in (provenStatus) — the
  // flora only ever reads the world it was handed.
  const dead = st === 'unhealthy';
  const verdictNote = cap.verdict ? ` · ${verdictPhrase(cap.verdict)}` : '';

  let body: React.JSX.Element;
  if (dead && variant === 0) {
    // dead flower bed — shepherd's-crook stems, hanging dried heads, fallen petals
    body = (
      <g>
        <ellipse className="flora-bed" cx={0} cy={0.4} rx={8.5} ry={3} opacity={0.7} />
        <path
          className="flora-dead-stem"
          strokeWidth={1.2}
          d="M 0.5 0 C 0.6 -6 0.4 -10 2.6 -11.4 C 4.4 -12.4 5.8 -10.8 5.6 -9.2"
        />
        <circle className="flora-dead-head flora-dead-accent" cx={5.6} cy={-8.2} r={1.7} />
        <path
          className="flora-dead-stem"
          strokeWidth={1.1}
          d="M -3.5 0 C -4 -5 -4.5 -8.5 -2.5 -10 C -1 -11 0.5 -10 0.8 -8.4"
        />
        <circle className="flora-dead-head" cx={0.8} cy={-7.6} r={1.4} />
        <path className="flora-dead-stem" strokeWidth={1.1} d="M 4.2 0 L 4.8 -5.2 L 7.6 -7.4" />
        <circle className="leaf-litter" cx={-7} cy={-0.5} r={1} />
        <circle className="leaf-litter" cx={2.5} cy={1.2} r={1} />
        <circle className="leaf-litter" cx={6.5} cy={0.2} r={1} />
      </g>
    );
  } else if (dead && variant === 1) {
    // dead bush — bare twig skeleton, clinging dead leaves
    body = (
      <g>
        <path
          className="flora-dead-twig"
          strokeWidth={1.1}
          d="M 0 0 L -1 -4.5 M -1 -4.5 L -5 -8.5 M -1 -4.5 L 1.5 -9.5 M 1.5 -9.5 L 4.5 -11.5 M 1.5 -9.5 L 0.5 -12.5 M 0 -2.5 L 4 -6"
        />
        <circle className="leaf-litter flora-dead-accent" cx={-4.5} cy={-8} r={1.1} />
        <circle className="leaf-litter" cx={4} cy={-11} r={1.1} />
        <circle className="leaf-litter" cx={-2.5} cy={0.8} r={1} />
      </g>
    );
  } else if (dead) {
    // dead sapling — leaning bare whip, leaf-fall at the base
    body = (
      <g>
        <path
          className="flora-dead-twig"
          strokeWidth={1.4}
          d="M 0 0 C 0.4 -5 1.5 -9 3.5 -13 M 2 -8.5 L -1.5 -12 M 3 -11 L 6 -13.5"
        />
        <circle className="leaf-litter" cx={-3} cy={0.8} r={1} />
        <circle className="leaf-litter" cx={1.5} cy={1.4} r={1} />
        <circle className="leaf-litter flora-dead-accent" cx={5} cy={0.4} r={1} />
      </g>
    );
  } else if (variant === 0) {
    // flower bed — leaf blades, three stems, rosette centre bloom
    body = (
      <g>
        <ellipse className="flora-bed" cx={0} cy={0.4} rx={8.5} ry={3} />
        <path className="flora-dark" d="M -1 0 Q -7 -3 -9 -7 Q -4.5 -5.5 -1 0 Z" />
        <path className="flora-dark" d="M 1.5 0 Q 7.5 -2.5 9 -6 Q 5 -5 1.5 0 Z" />
        <path className="flora-stem" d="M -4 0 C -4.4 -4 -4.8 -7 -5.2 -10" />
        <path className="flora-stem" d="M 0 0 C 0.2 -5 0.3 -9 0.2 -13" />
        <path className="flora-stem" d="M 4 0 C 4.5 -4 5 -6.5 5.6 -9" />
        <circle className="flora-light" cx={-5.2} cy={-10} r={2.6} />
        <circle className="flora-light" cx={5.6} cy={-9} r={2.3} />
        {[0, 1, 2, 3, 4].map((k) => {
          const a = -Math.PI / 2 + (k * 2 * Math.PI) / 5;
          return (
            <circle
              key={k}
              className="flora-light"
              cx={(0.2 + Math.cos(a) * 2.3).toFixed(1)}
              cy={(-13 + Math.sin(a) * 2.3).toFixed(1)}
              r={1.5}
            />
          );
        })}
        <circle className="flora-core" cx={0.2} cy={-13} r={1.3} />
      </g>
    );
  } else if (variant === 1) {
    // berry bush
    body = (
      <g>
        <polygon
          className="flora-dark"
          points="0,-12.5 5.5,-10.5 8.5,-5.5 7,-1 0,0.8 -7,-1 -8.5,-5.5 -5.5,-10.5"
        />
        <polygon
          className="flora-light"
          points="-1,-12.5 4.5,-10.8 6,-7 0.5,-5.6 -4.8,-7.4 -4.6,-10.6"
        />
        <circle className="flora-core" cx={-3.5} cy={-4.5} r={1.5} />
        <circle className="flora-core" cx={2} cy={-7.5} r={1.5} />
        <circle className="flora-core" cx={4.5} cy={-3.5} r={1.4} />
      </g>
    );
  } else {
    // sapling — echoes the central tree
    body = (
      <g>
        <path
          className="sapling-trunk"
          d="M -1.2 0 C -1 -4 -0.8 -7 -0.6 -9.5 L 0.9 -9.5 C 1 -7 1.2 -4 1.4 0 Z"
        />
        <polygon
          className="flora-dark"
          points="0,-18.5 5.4,-15.4 6.6,-10.2 3.4,-7.2 -3.4,-7.2 -6.6,-10.2 -5.4,-15.4"
        />
        <polygon className="flora-light" points="-0.6,-18.3 3.8,-15.8 3.4,-12 -1.6,-11.4 -4.4,-14.2" />
      </g>
    );
  }

  return (
    <g
      className={`garden-flora st-${st}${hidden.has(st) ? ' is-filtered' : ''}`}
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${TILE_SCALE})`}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <title>{`${cap.id} — ${cap.error ? 'spec error' : st}${verdictNote}`}</title>
      <circle className="flora-hit" r={9.5} fill="transparent" />
      {dead && <ellipse className="dead-ground" cx={0} cy={0.5} rx={8} ry={3.2} />}
      <ellipse className="flora-shadow" cx={1} cy={1} rx={dead ? 6 : 8} ry={dead ? 2.2 : 2.6} />
      {body}
    </g>
  );
}

function TerritoryFlora({
  territory: t,
  className,
  hidden,
  builds,
  claims = [],
  departures = [],
  now,
  onHover,
  onSelect,
  onStampClick,
  identityKey = true,
}: {
  territory: Territory;
  className: string;
  hidden: ReadonlySet<string>;
  builds: BuildActivity[];
  /** ADR-0138 §5 / ADR-0200 D7: the story-CLAIM wisps around this island ("a session is here"),
   *  GRADED — `exploring` hovers, `waiting` queues, `work` orbits. Live by default (default `[]` only
   *  when `?claims=off`). */
  claims?: ClaimActivity[];
  /** ADR-0200 D7: this island's fading claim departures ("a session just left"). Default `[]`. */
  departures?: DepartedClaim[];
  now: Date;
  onHover: (on: boolean) => void;
  onSelect: (capId: string | null) => void;
  /** ADR-0102: clicking one of this island's ICON STAMPS highlights the shared island it names
   *  (the carried building's id) in the left panel. Absent in the panel's own one-island render. */
  onStampClick?: (sharedId: string) => void;
  /** ADR-0102 (owner ask 2026-06-25): draw this island's OWN identity building beside its name tag
   *  — the legend that makes the promoted stamps + the shared-island cities decodable. On by default
   *  (the map); the Shared Islands panel card passes `false` because it draws its own tuned "key". */
  identityKey?: boolean;
}): React.JSX.Element {
  const story = t.story;
  const statusKey = story.status ?? 'unknown';
  // Nameplate box + anchors (owner ask 2026-06-22: bigger cards; building cards are landmarks).
  const plate = nameplateLayout(story.id.length, t.buildingGlyph);

  // Forest clumps: 2–3 small conifers per forest tile — deliberately small so
  // the central story tree is the only thing over ~25px on an island.
  // Draw flora top-down by y so taller southern trees overlap correctly.
  const drawables: { y: number; el: React.JSX.Element }[] = [];
  t.decor.forEach((f) => {
    const count = 2 + (f.seed % 2);
    for (let i = 0; i < count; i++) {
      const a = rand01(f.seed + i * 7) * Math.PI * 2;
      const rr = rand01(f.seed + i * 13) * HEX_R * 0.55;
      const x = f.x + Math.cos(a) * rr;
      const y = f.y + Math.sin(a) * rr * 0.8 + tileUnits(4);
      drawables.push({
        y,
        el: (
          <DecorTree key={`f:${f.seed}:${i}`} x={x} y={y} h={7 + rand01(f.seed + i) * 4} seed={f.seed + i} />
        ),
      });
    }
  });
  t.caps.forEach((spot) => {
    drawables.push({
      y: spot.y,
      el: (
        <GardenPlant
          key={`c:${spot.cap.id}`}
          spot={spot}
          hidden={hidden}
          now={now}
          onSelect={() => onSelect(spot.cap.id)}
        />
      ),
    });
  });
  drawables.push({
    y: t.treeSpot.y,
    el: <StoryTree key="story-tree" territory={t} hidden={hidden} now={now} />,
  });
  // ADR-0102: this island carries the identity icon of each BUILDING it depends on, beside its
  // tree — a low-salience badge per promoted edge ("you carry the icon of what you depend on"; the
  // edge is kept, not dropped). The building lives in the left Shared Islands panel; clicking a
  // stamp highlights the one it names there. studio carries two (library + cli).
  for (const stamp of t.stamps) {
    drawables.push({
      y: stamp.spot.y,
      el: (
        <StoryStamp
          key={`stamp:${stamp.icon}`}
          story={story}
          icon={stamp.icon}
          spot={stamp.spot}
          hidden={hidden}
          {...(onStampClick ? { onStampClick } : {})}
        />
      ),
    });
  }
  drawables.sort((a, b) => a.y - b.y);

  return (
    <g
      className={`hex-flora ${className}`}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      onClick={() => onSelect(null)}
    >
      {drawables.map((d) => d.el)}

      <g
        className="world-plate"
        transform={`translate(${t.centroid.x - (plate.w * PLATE_SCALE) / 2} ${t.labelY}) scale(${PLATE_SCALE})`}
      >
        <title>{story.error ? `${story.id} — ${story.error}` : story.title}</title>
        <rect className="world-plate-bg" width={plate.w} height={plate.h} rx={plate.rx} />
        <text className="world-plate-id" x={plate.w / 2} y={plate.idY} textAnchor="middle">
          {story.id}
        </text>
        <text className="world-plate-sub" x={plate.w / 2} y={plate.subY} textAnchor="middle">
          {story.error
            ? 'story spec error'
            : // No ✓/✗ here — the crown's hue and the signpost carry proof (ADR-0040);
              // precise verdict facts live in the tooltip and the panel.
              `${statusKey} · ${story.capabilities.length} caps`}
        </text>
        {/* ADR-0102 (owner ask 2026-06-25): every map island shows its OWN identity building beside
            its name tag — the legend that makes the promoted stamps and the shared-island cities
            decodable (learn "this island = this building" here, then recognise it in a hub's city).
            Right of the plate, base-aligned to its bottom; same pattern as the panel card's key.
            The panel card passes identityKey={false} (it draws its own tuned key). */}
        {identityKey && (
          <g
            className="world-plate-key"
            transform={`translate(${(plate.w + NAMEPLATE_KEY_MARGIN).toFixed(1)} ${plate.h}) scale(${NAMEPLATE_KEY_SCALE})`}
          >
            <IconGlyph id={story.id} />
          </g>
        )}
      </g>

      {/* The orbiting layer is the HARNESS (ADR-0048 §5): a wisp orbits a story
          only while a leaf agent is mechanically building one of its units.
          Self-reported session presence is RETIRED outright (ADR-0200 D7) — the
          claim wisps below are the one "a session is here" signal. This
          is what makes the layer self-cleaning: no SessionEnd dependency, no 4 h
          zombie window, no nodes:[] dead-ends. */}
      <g transform={`translate(${t.centroid.x} ${t.centroid.y})`}>
        {/* In-flight BUILD wisps: a leaf agent is mechanically building this unit
            right now. Teal pulse, faster orbit, keyed by runId (its own identity).
            Informational — the tooltip carries the unit + run; clicking falls
            through to selecting the story. */}
        {builds.map((b) => {
          const phase = rand01(hash(b.runId)) * 360;
          // ADR-0048 §3 v2: the live gate phase → the wisp's red→green band (the SAME wispBand fold
          // the shared scene-graph uses, so the legacy inline path can't drift from the scene path).
          const band = wispBand(b.phase);
          return (
            <g key={`build:${b.runId}`} className={`world-wisp band-${band}`}>
              <title>{`${b.unitId} — building (${b.tier})${b.phase ? ` · ${b.phase}` : ''} · ${formatAge(b.at, now)} · run ${b.runId}`}</title>
              <animateTransform
                attributeName="transform"
                type="rotate"
                from={`${phase} 0 0`}
                to={`${phase + 360} 0 0`}
                dur="6s"
                repeatCount="indefinite"
              />
              <g transform={`translate(${t.radius * 0.72 + tileUnits(10)} 0) scale(${TILE_SCALE})`}>
                <circle className="world-wisp-hit" r={12} fill="transparent" />
                <circle className="world-wisp-glow" r={6.5} />
                <circle className="world-wisp-dot" r={2.8} />
              </g>
            </g>
          );
        })}
      </g>

      {/* In-flight story-CLAIM wisps (ADR-0138 §5 / ADR-0200 D7): a session is working this story
          (coordination, NOT a proof — §5 honesty wall). A DISTINCT class family from the build wisp,
          GRADED by geometry (`exploring` hovers stationary, `waiting` queues in a line, `work` orbits
          — a touch wider + slower than the build wisp), coloured by what the orchestrator is doing.
          Mirrors the shared scene path's buildClaimWisps EXACTLY (same orbitR / hash-jitter / queue-
          index math) so the legacy inline render can't drift from the scene render. Never proven-green. */}
      <g transform={`translate(${t.centroid.x} ${t.centroid.y})`}>
        {(() => {
          const orbitR = t.radius * 0.72 + tileUnits(22);
          const treeDx = t.treeSpot.x - t.centroid.x;
          const treeDy = t.treeSpot.y - t.centroid.y;
          let queueIndex = 0;
          return orderClaimsForScene(claims).map((c) => {
            const grade = c.grade ?? 'work';
            const state = claimColourState(c.intent);
            const title = claimWispTitle(c, now);
            if (grade === 'exploring') {
              // HOVERING: at rest beside/above the tree, per-key jitter, NO orbit animation.
              const k = hash(c.sessionId);
              const hx = treeDx + (rand01(k + 1) - 0.5) * tileUnits(18);
              const hy = treeDy - (orbitR + tileUnits(12)) + (rand01(k + 2) - 0.5) * tileUnits(10);
              return (
                <g key={`claim:${c.sessionId}`} className={`world-hover-wisp state-${state}`}>
                  <title>{title}</title>
                  <g transform={`translate(${hx.toFixed(1)} ${hy.toFixed(1)}) scale(${TILE_SCALE})`}>
                    <circle className="world-hover-wisp-hit" r={12} fill="transparent" />
                    <circle className="world-hover-wisp-glow" r={6.5} />
                    <circle className="world-hover-wisp-dot" r={2.8} />
                  </g>
                </g>
              );
            }
            if (grade === 'waiting') {
              // QUEUED: a visible ordered line just outside the orbit ring, index-placed in the
              // SAME claimedAt-ascending order the scene path sorts to (orderClaimsForScene above).
              const qx = orbitR + tileUnits(14) + queueIndex * tileUnits(16);
              queueIndex += 1;
              return (
                <g key={`claim:${c.sessionId}`} className={`world-queue-wisp state-${state}`}>
                  <title>{title}</title>
                  <g transform={`translate(${qx.toFixed(1)} 0) scale(${TILE_SCALE})`}>
                    <circle className="world-queue-wisp-hit" r={12} fill="transparent" />
                    <circle className="world-queue-wisp-glow" r={6.5} />
                    <circle className="world-queue-wisp-dot" r={2.8} />
                  </g>
                </g>
              );
            }
            // WORK — today's orbiting claim wisp, unchanged (the ADR-0200 D2 regression lock).
            const phase = rand01(hash(c.sessionId)) * 360;
            return (
              <g key={`claim:${c.sessionId}`} className={`world-claim-wisp state-${state}`}>
                <title>{title}</title>
                <animateTransform
                  attributeName="transform"
                  type="rotate"
                  from={`${phase} 0 0`}
                  to={`${phase + 360} 0 0`}
                  dur="9s"
                  repeatCount="indefinite"
                />
                <g transform={`translate(${orbitR} 0) scale(${TILE_SCALE})`}>
                  <circle className="world-claim-wisp-hit" r={12} fill="transparent" />
                  <circle className="world-claim-wisp-glow" r={6.5} />
                  <circle className="world-claim-wisp-dot" r={2.8} />
                </g>
              </g>
            );
          });
        })()}
      </g>

      {/* Claim DEPARTURES (ADR-0200 D7 wisp-out legibility): a recently-released claim still fading
          out, resting where the hover family rests and drifting upward with age. Mirrors the shared
          scene path's buildDepartingWisps EXACTLY (same orbitR / hash-jitter math) so the legacy
          inline render can't drift. Never proven-green, never an orbit — stationary by construction. */}
      <g transform={`translate(${t.centroid.x} ${t.centroid.y})`}>
        {(() => {
          const orbitR = t.radius * 0.72 + tileUnits(22);
          const treeDx = t.treeSpot.x - t.centroid.x;
          const treeDy = t.treeSpot.y - t.centroid.y;
          return departures.map((d) => {
            const ageRatio = departureAgeRatio(d.ageMs);
            const k = hash(d.sessionId);
            const x = treeDx + (rand01(k + 1) - 0.5) * tileUnits(18);
            const y = treeDy - (orbitR + tileUnits(12)) - ageRatio * tileUnits(24);
            return (
              <g
                key={`departure:${d.sessionId}`}
                className="world-departing-wisp"
                opacity={Number((1 - ageRatio).toFixed(2))}
              >
                <title>{departureWispTitle(d, now)}</title>
                <g transform={`translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${TILE_SCALE})`}>
                  <circle className="world-departing-wisp-hit" r={12} fill="transparent" />
                  <circle className="world-departing-wisp-glow" r={6.5} />
                  <circle className="world-departing-wisp-dot" r={2.8} />
                </g>
              </g>
            );
          });
        })()}
      </g>
    </g>
  );
}

/**
 * The session dock — a small overlay in the world frame: the CLAIM LEDGER's dock view
 * (ADR-0200 D7), claims-only since the inc-6 presence retirement (self-reported session
 * presence is gone; a claim row in `events.node_claim` is the one "a session is here"
 * signal). Renders every live claim grouped by session (ClaimGroupList below). Advisory
 * like the wisps: `null` (down DB / json store) is silent absence — an honest note, never
 * an error surface (the StoreBanner owns the explanatory UX).
 */
export function SessionDock({
  claimGroups,
  now,
  onClose,
}: {
  /** The claim-ledger dock view (ADR-0200 D7) — `null` before the first fetch answers or when the
   *  live store is silent (down DB / json store). */
  claimGroups: SessionClaimGroup[] | null;
  now: Date;
  onClose: () => void;
}): React.JSX.Element {
  // ADR-0535 D1 — the wire carries every standing row now, so the dock is the surface that has to
  // sort them: what is worth reading (live AND held-but-dark, each saying which it is) above, and
  // the plainly-abandoned rows behind a fold. Filtering them out entirely would put us straight back
  // to hiding ghosts; listing them inline would open the dock with three dozen corpses over a
  // handful of live rows, and a reader who learns to skip the panel is the failure that killed the
  // previous presence layer. A fold is the only answer that is both honest and readable.
  const { board, tidyUp } = partitionClaimGroups(claimGroups);
  const tidyCount = (tidyUp ?? []).reduce((n, g) => n + g.claims.length, 0);
  return (
    <div className="session-dock" role="dialog" aria-label="session claims">
      <header>
        <h4>session claims{board ? ` (${board.length})` : ''}</h4>
        <button type="button" className="btn" onClick={onClose} aria-label="close sessions">
          ✕
        </button>
      </header>
      {board === null ? (
        <p className="muted small">
          Claim ledger unavailable — the live store didn&apos;t answer.
        </p>
      ) : board.length === 0 ? (
        <p className="muted small">No claims on the ledger right now.</p>
      ) : (
        <ClaimGroupList groups={board} now={now} />
      )}
      {tidyUp !== null && tidyUp.length > 0 && (
        <details className="claim-tidy-up">
          <summary>
            tidy up — {tidyCount} claim{tidyCount === 1 ? '' : 's'} nobody has released
          </summary>
          <p className="muted small">
            Held, and nothing has been heard from the holder in over{' '}
            {formatLastHeard(CLAIM_ABANDONED_DISPLAY_MS)}. These rows still sit in the ledger and are
            still reclaimable by anyone on exactly the same terms — they are off the arcs because
            saying &ldquo;we don&apos;t know&rdquo; about them stopped being informative, not because
            anything about them changed.
          </p>
          <ClaimGroupList groups={tidyUp} now={now} />
        </details>
      )}
    </div>
  );
}

/**
 * The claim-ledger dock view (ADR-0200 D7): one group per session (sessionId + branch), each
 * listing its live claims — unit id, grade chip (exploring|waiting|work), free-prose intent, and
 * age (the existing `formatAge`). Data-only: the LOOK is attested later at the arc's UAT (ADR-0070
 * stage 2) — this renders whatever `groupClaimsBySession` (packages/notice-board) hands it, no
 * invented styling decisions beyond a plain grouped list.
 */
function ClaimGroupList({
  groups,
  now,
}: {
  groups: SessionClaimGroup[];
  now: Date;
}): React.JSX.Element {
  return (
    <div className="claim-groups" aria-label="claims by session">
      {groups.map((g) => (
        <div className="claim-session-group" key={g.sessionId}>
          <p className="claim-session-header">
            <code>{g.sessionId}</code>
            <span className="muted small">
              {' '}
              · <code>{g.branch}</code> · <ClaimSessionRuntime runtimes={g.runtimes} />
            </span>
          </p>
          <ul className="claim-list">
            {g.claims.map((c) => (
              <li key={c.unitId} className="claim-row" data-claim-band={claimBand(c)}>
                <span className={`claim-grade-chip claim-grade-${c.grade}`}>{c.grade}</span>
                <code>{c.unitId}</code>
                {c.intent && <span className="muted small"> — {c.intent}</span>}
                <span className="muted small"> · {formatAge(c.claimedAt, now)}</span>
                {/* ADR-0535 D1 — a row we have not heard from SAYS SO, and says for how long. The
                    measured defect this replaces is a 554-hour claim rendered indistinguishably
                    from a live one; the fix is not to drop it (that is the studio's old bug in the
                    other direction) but to hand the reader the one fact that separates them. */}
                {c.stale && (
                  <span className="claim-unheard small"> · last heard {formatLastHeard(c.heartbeatAgeMs)} ago</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/**
 * WHICH HARNESS took a session's claims, ON WHICH MACHINE (ADR-0579) — printed beside the session's
 * branch, because the session id before it is a worktree's NAME, chosen by its author, and an audit
 * once read ~40 hours of Codex work on the owner's laptop as another machine's on the strength of one.
 *
 * WORDED BY THE LEDGER'S ONE RENDERER, `describeClaimRuntime`, never re-worded here: the CLI board,
 * the refusal and this dock all print through it, so an unrecorded half cannot read two ways on two
 * surfaces. Several pairs are joined with `; `, the CLI board's own join, and never merged — a session
 * id under two machines is the collision a reader must be shown. An empty or absent list renders as
 * the UNRECORDED pair, not as nothing: a blank reads as "nothing to say" where the truth is "nothing
 * known", and nothing may be inferred to fill it (D5).
 */
function ClaimSessionRuntime({
  runtimes,
}: {
  runtimes: readonly ClaimRuntime[] | undefined;
}): React.JSX.Element {
  const pairs: readonly ClaimRuntime[] = runtimes !== undefined && runtimes.length > 0 ? runtimes : [{}];
  const halves = pairs.map((pair) => Number(pair.harness !== undefined) + Number(pair.host !== undefined));
  const state = halves.every((n) => n === 2) ? 'recorded' : halves.every((n) => n === 0) ? 'unrecorded' : 'partial';
  // Two DIFFERENT things make a session carry several pairs, and the hover must not blur them. Two
  // RECORDED pairs is the collision — one id, two harnesses or machines. A recorded pair beside the
  // EMPTY one is only a session some of whose claims predate detection (measured on the live ledger
  // the day this landed), and calling that a collision would send a reader hunting for a second box.
  const recordedPairs = halves.filter((n) => n > 0).length;
  const sentences: string[] = [];
  if (recordedPairs > 1) {
    sentences.push(
      `These claims came from ${recordedPairs} different harness/machine pairs under one session id. A session id is a worktree's name — unique within one clone, not unique across machines — so this is a finding to look at, not noise.`,
    );
  }
  if (recordedPairs === 0) {
    sentences.push(
      'These claims record neither the harness nor the machine that took them. Claims taken before detection existed carry neither, and nothing infers them — not the session id, the branch, or the machine you are reading this on.',
    );
  } else {
    if (recordedPairs < pairs.length) {
      sentences.push('Some of these claims were taken before detection existed and record neither; nothing infers them.');
    }
    sentences.push(
      'Recorded values are detected from the process that took the claim, never declared; a missing harness is a process no recognised agent harness ran — never read as a human at a keyboard.',
    );
  }
  const title = `${sentences.join(' ')} (ADR-0579)`;
  return (
    <span
      className="claim-session-runtime"
      data-runtime={state}
      data-runtime-count={runtimes?.length ?? 0}
      title={title}
    >
      {/* One unbreakable span per pair, the `;` glued to the pair it closes: the text is exactly the
          CLI board's `; `-join, but a line can only break BETWEEN pairs. Measured in the staged dock,
          a plain run wrapped mid-name at the hyphen ("claude-" / "code") — the one word the line
          exists to be read for. */}
      {pairs.map((pair, i) => (
        <Fragment key={i}>
          {i > 0 && ' '}
          <span className="claim-session-runtime-pair">
            {describeClaimRuntime(pair)}
            {i < pairs.length - 1 ? ';' : ''}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

/**
 * One verdict, ADR-0033 d.3 vocabulary: ✓ proven / ✗ last run failed / – never built.
 * "Never built" is also what an OFFLINE session sees — glyphs are advisory and the
 * payload omits them when no live store answered.
 */
function VerdictLine({ verdict }: { verdict: TreeVerdict | undefined }): React.JSX.Element {
  if (!verdict) return <span className="muted">– never built</span>;
  const when = new Date(verdict.at).toLocaleString();
  return (
    <span className={verdict.outcome === 'pass' ? 'verdict-pass' : 'verdict-fail'}>
      {verdictPhrase(verdict)} · {when}
    </span>
  );
}

// The detail panel OVERLAYS the world from the right edge (the world never
// reflows or rescales when it opens or resizes) and is drag-resizable from its
// left edge — wide enough by default to fit a capability sub-DAG.
const PANEL_MIN = 360;
const PANEL_MAX = 960;
const PANEL_DEFAULT = 520;
const PANEL_W_KEY = 'st-tree-panel-w';

function savedPanelWidth(): number {
  const saved = Number(localStorage.getItem(PANEL_W_KEY));
  return Number.isFinite(saved) && saved >= PANEL_MIN ? Math.min(saved, PANEL_MAX) : PANEL_DEFAULT;
}

/**
 * The two witness glyphs for a UAT row (ADR-0102 inline-SVG convention): a ROBOT (machine-witnessed)
 * and a PERSON (human-witnessed). Pure geometry filled with `currentColor`, so the row's state class
 * drives the hue (proven green / failed red / unproven muted). The art is owner-attested (ADR-0070);
 * what the unit tests pin is the SHAPE↔witness + COLOUR↔proven mapping, not the exact path data.
 */
function RobotIcon(): React.JSX.Element {
  return (
    <svg className="uat-witness-icon icon-robot" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      {/* antenna */}
      <rect x="7.4" y="2.1" width="1.2" height="2.9" rx="0.4" fill="currentColor" />
      <circle cx="8" cy="1.6" r="1.25" fill="currentColor" />
      {/* head with two knocked-out eyes (evenodd holes read against the panel behind) */}
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M5 5 H11 A2 2 0 0 1 13 7 V11 A2 2 0 0 1 11 13 H5 A2 2 0 0 1 3 11 V7 A2 2 0 0 1 5 5 Z M5.7 8 H7.1 V9.7 H5.7 Z M8.9 8 H10.3 V9.7 H8.9 Z"
      />
    </svg>
  );
}

function PersonIcon(): React.JSX.Element {
  return (
    <svg className="uat-witness-icon icon-person" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <circle cx="8" cy="5" r="3" fill="currentColor" />
      <path fill="currentColor" d="M2.6 14 C2.6 10.6 5 8.7 8 8.7 C11 8.7 13.4 10.6 13.4 14 Z" />
    </svg>
  );
}

/**
 * The story detail's "UAT test criteria" table (ADR-0082 attestation-surface): each addressable UAT test
 * (parsed from the story's `## UAT Test Criteria` prose) as a row carrying ONE glyph at its RIGHT edge — a
 * witness icon whose SHAPE is the witness (a robot = machine-witnessed, a person = human-witnessed)
 * and whose COLOUR is the SIGNED verdict in `events.verdict` (the REAL gate state that greens the
 * story crown via the per-test AND-roll-up, ADR-0082 d.3): green proven, red a signed fail, muted
 * not-yet-proven. For a `human` test a permitted operator has not yet proven, the muted person icon is itself the
 * clickable **"I saw it work"** button that signs an `operator-attested` verdict (ADR-0044 §4's in-UI
 * signature, a real green path) — the server stamps the signer from the verified identity and REFUSES
 * a machine-witness test (a click is not a machine proof), so a robot icon is never clickable.
 * (Owner UX call: the lower-rigor ⚑/⚐ `events.attestation` vouch was REMOVED from this row — two
 * look-alike actions confused the sign affordance; the server's /api/attestations path stays, just
 * unsurfaced here.) Signing re-pulls this panel (the icon) AND the world tree (the crown). Fetched
 * per-story on open; silently absent when the live store is down.
 */
export function UatTestCriteriaSection({
  storyId,
  onCrownRefresh,
}: {
  storyId: string;
  onCrownRefresh: () => void;
}): React.JSX.Element | null {
  const { me } = useAppData();
  const isAdmin = me.role === 'admin';
  const canAttestUat = isAdmin || me.canAttestUat === true;
  const [tests, setTests] = useState<UatTestCriterionRow[] | null>(null);
  const [storyUat, setStoryUat] = useState<'healthy' | 'unhealthy' | null | undefined>(undefined);
  // ADR-0106 d.1: ids of legs still `either` on this adopted story — the "no `either` at rest" guard.
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const payload = await api.attestations(storyId);
      setTests(payload.tests);
      setStoryUat(payload.storyUat);
      setUnresolved(payload.unresolvedWitnesses ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [storyId]);

  useEffect(() => {
    setTests(null);
    void load();
  }, [load]);

  // The "I saw it work" operator-attested VERDICT (events.verdict) — the higher-rigor signature that
  // greens the story crown (ADR-0082). Refreshes the per-test proven glyph AND re-pulls the world.
  const signVerdict = async (criterionId: string): Promise<void> => {
    setBusy(`sign:${criterionId}`);
    try {
      await api.signUat({ storyId, criterionId, outcome: 'pass' });
      await load();
      onCrownRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  if (error) return <p className="muted small">UAT test criteria unavailable: {error}</p>;
  if (tests === null || tests.length === 0) return null; // loading, or a story with no parsed UAT test criteria

  return (
    <DetailDisclosure
      label="UAT test criteria"
      count={tests.length}
      defaultOpen
      className="uat-test-criteria"
    >
      {/* ADR-0106 d.1 — the "no `either` at rest" guard: this adopted story still carries undecided
          legs, which silently land on the operator. Nudge the author to record each leg's witness. */}
      {unresolved.length > 0 && (
        <p className="uat-unresolved-warning small">
          ⚠ {unresolved.length} UAT leg{unresolved.length > 1 ? 's' : ''} on this adopted story{' '}
          {unresolved.length > 1 ? 'are' : 'is'} still undecided — re-author{' '}
          {unresolved.length > 1 ? 'their' : 'its'} witness so each leg is clearly yours to confirm or
          the machine&apos;s to prove (ADR-0106).
        </p>
      )}
      <table className="uat-table">
        <tbody>
          {tests.map((t) => {
            // PROVEN — the SIGNED verdict (events.verdict): the real gate state that greens the crown.
            const proven = t.proven; // 'pass' | 'fail' | undefined
            // ADR-0106 d.5: the owner surface is BINARY — a permitted operator confirms a `human` leg not yet
            // proven ("I saw it work"); a `machine` leg shows NO affordance (adopt/build signs it).
            const canSign = canAttestUat && proven !== 'pass' && t.witness === 'human';
            const signBusy = busy === `sign:${t.criterionId}`;

            // ONE right-edge glyph (owner redesign): the icon SHAPE is the witness (robot=machine,
            // person=human), its COLOUR (CSS) the proven state. The single actionable case is a `human`
            // leg an admin may still sign — there the icon IS the "I saw it work" button. The text
            // labels are gone, so the title + aria-label carry witness + state (+ the click hint).
            const witnessNoun = t.witness === 'machine' ? 'machine' : 'human';
            // ADR-0357 D3: a human leg's tooltip carries its OWN authored basis (the story's
            // `(witness-basis: …)` tag). The owner decides what to attest HERE, at the glyph — not
            // in story.md — so "why does this need me?" has to be answerable at the hover; before
            // this, every human leg produced the identical generic string, telling the owner THAT
            // they were needed and never WHY. It rides every human state, not just the signable
            // one: the basis is why the leg is human at all, which stays true once it is proven.
            // A machine leg justifies nothing (ADR-0357 D2) and appends nothing.
            const basis = t.witness === 'human' ? (t.witnessBasis ?? '') : '';
            const basisLine = basis.length > 0 ? `\n\nWhy this needs a person: ${basis}` : '';
            const witnessTitle =
              (proven === 'pass'
                ? `${witnessNoun}-witnessed · PROVEN — a signed verdict (greens the story crown once every test passes, ADR-0082)`
                : proven === 'fail'
                  ? `${witnessNoun}-witnessed · a signed FAIL verdict for this test`
                  : canSign
                    ? 'human-witnessed · not yet proven — click to sign "I saw it work" (a REAL gate verdict, ADR-0082)'
                    : t.witness === 'machine'
                      ? 'machine-witnessed · not yet proven — the gate/adopt signs a machine leg, not a click'
                      : 'human-witnessed · not yet proven') + basisLine;
            // The basis rides the aria-label too: a screen-reader user meets the leg at this same
            // control and has no other route to the story's prose.
            const witnessAria =
              (proven
                ? `${t.title}: ${witnessNoun}-witnessed, ${proven === 'pass' ? 'proven' : 'failed'}`
                : canSign
                  ? `${t.title}: human-witnessed, not yet proven — click to sign "I saw it work"`
                  : `${t.title}: ${witnessNoun}-witnessed, not yet proven`) +
              (basis.length > 0 ? `. Why this needs a person: ${basis}` : '');

            // ADR-0209 D7: story-owned one-liner is display-canonical; optional Library detail
            // pointer opens via assetHref — never dumps procedure prose into the cell, and never
            // steals the witness-glyph "I saw it work" click (separate right-edge control).
            const detailId = t.detailArtifactId;
            const titleNode =
              detailId !== undefined && detailId.length > 0 ? (
                <a
                  className="uat-test-criterion-title uat-test-criterion-detail-link"
                  href={assetHref(detailId)}
                  title={`Open Library detail: ${detailId}`}
                  aria-label={`${t.title}: open Library detail`}
                >
                  {t.title}
                </a>
              ) : (
                <span className="uat-test-criterion-title">{t.title}</span>
              );

            return (
              <tr key={t.criterionId} className="uat-row">
                <td className="uat-test-criterion-cell">{titleNode}</td>
                {/* The single witness/state glyph at the RIGHT edge (owner redesign) — where the eye
                    lands for a per-row action. A muted person icon here is the "I saw it work" button;
                    a robot, or an already-proven/failed icon, is a non-interactive status indicator. */}
                <td className="uat-witness-cell">
                  <button
                    type="button"
                    className={`uat-witness witness-${t.witness} proven-${proven ?? 'none'}${canSign ? ' is-signable' : ''}`}
                    disabled={!canSign || signBusy}
                    onClick={canSign ? () => void signVerdict(t.criterionId) : undefined}
                    title={witnessTitle}
                    aria-label={witnessAria}
                  >
                    {signBusy ? (
                      <span className="uat-witness-busy" aria-hidden="true">
                        …
                      </span>
                    ) : t.witness === 'machine' ? (
                      <RobotIcon />
                    ) : (
                      <PersonIcon />
                    )}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted attest-note">
        A <strong>robot</strong> marks a machine-witnessed leg, a <strong>person</strong> a
        human-witnessed one; its colour is the SIGNED verdict (<code>events.verdict</code>) that greens
        the crown — green proven, red a signed fail, muted not-yet-proven. A muted person is clickable:
        sign “I saw it work” (ADR-0082).
        {storyUat !== undefined && (
          <>
            {' '}
            <span className={`uat-story-rollup rollup-${storyUat ?? 'none'}`}>
              Story UAT:{' '}
              {storyUat === 'healthy'
                ? 'GREEN — every criterion proven'
                : storyUat === 'unhealthy'
                  ? 'WITHERED — a proven criterion failed'
                  : 'unproven — not every criterion has a signed pass'}
            </span>
          </>
        )}
      </p>
    </DetailDisclosure>
  );
}

/** Extract the 1-based decision number from an `adr` artifact id (`adr-0017` → 17), or null. */
export function adrNumberOf(assetId: string): number | null {
  const m = /^adr-(\d{4})$/.exec(assetId);
  return m ? Number(m[1]) : null;
}

/**
 * The story's "Architectural Decision Records" (ADR-0037 §2 / ADR-0097 Layer 2): its `decisions:` ADR
 * numbers resolved against the loaded LIBRARY CORPUS and linked to the `adr` artifacts. Tolerant — a
 * number with no matching artifact renders as a plain `ADR-NNNN` label (never blanks the section).
 * Renders nothing when the story declares no decisions. A `<details>` disclosure COLLAPSED by default
 * (owner steer 2026-06-24): governance reference that sits quietly at the foot, opened on demand.
 * Exported for the jsdom render test.
 *
 * ★ IT RESOLVES AGAINST `assets`, NOT `docs` (ADR-0403 dec 1). It used to key its lookup off
 * `group === 'Decisions'` docs from the file-walker; PR #1546 rewrote that walker to stamp every doc
 * `'Reference'`, so the lookup became permanently EMPTY and every deciding decision on every story
 * panel rendered as "(no decision found)" — an index that had resolved perfectly well, asserting
 * that 409 decisions which exist do not. Decisions are ordinary artifacts keyed `adr-NNNN`
 * (ADR-0403 dec 1), so the number is parsed straight off the artifact id.
 *
 * The unresolved branch is `assetsStatus`-aware (lib/docsIndex.ts' `unresolvedAssetReason`). "(no
 * decision found)" is an assertion that the decision does not exist, and it is only true once the
 * corpus has RESOLVED — said over an index that is still loading or that failed outright, it is the
 * most confidently wrong thing on this surface, since a genuine decision reads as a missing one.
 * That distinction is the whole point of this branch: it must stay pointed at whichever index
 * actually backs the lookup, which is why it moved with it.
 */
export function RelevantAdrs({ decisions }: { decisions: number[] }): React.JSX.Element | null {
  const { assets, assetsStatus, assetsError } = useAppData();
  const unresolvedReason = unresolvedAssetReason(assetsStatus);
  if (decisions.length === 0) return null;
  const byNum = new Map<number, GuidanceAsset>();
  for (const a of assets) {
    if (a.category !== 'adr') continue;
    const n = adrNumberOf(a.id);
    if (n !== null) byNum.set(n, a);
  }
  return (
    <DetailDisclosure
      label="Architectural Decision Records"
      count={decisions.length}
      className="tree-relevant-adrs"
    >
      <ul className="relevant-adrs small">
        {decisions.map((n) => {
          const decision = byNum.get(n);
          const status = decision ? adrStatusOf(decision) : undefined;
          const label = `ADR-${String(n).padStart(4, '0')}`;
          return (
            <li key={n} className="relevant-adr">
              {decision ? (
                <a href={assetHref(decision.id)}>
                  <code>{label}</code> {decision.title}
                  {status && <span className={`adr-status-chip adr-${status}`}> {status}</span>}
                </a>
              ) : unresolvedReason ? (
                <span
                  className="muted doc-unresolved"
                  data-docs-status={assetsStatus}
                  {...(assetsError ? { title: assetsError } : {})}
                >
                  <code>{label}</code> (unresolved — {unresolvedReason})
                </span>
              ) : (
                <span className="muted">
                  <code>{label}</code> (no decision found)
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </DetailDisclosure>
  );
}

function StoryPanel({
  story,
  stories,
  storyIds,
  claims,
  now,
  selectedCap,
  hoverCap,
  hidden,
  onSelectCap,
  onHoverCap,
  onShowSessions,
  onCrownRefresh,
  onClose,
}: {
  story: TreeStory;
  stories: TreeStory[];
  storyIds: ReadonlySet<string>;
  /** This story's live claims (ADR-0200 D7 — the one "a session is here" signal since the inc-6
   *  presence retirement): the same rows the claim wisps orbit with (claimsByStory). */
  claims: ClaimActivity[];
  now: Date;
  selectedCap: string | null;
  hoverCap: string | null;
  hidden: ReadonlySet<string>;
  onSelectCap: (id: string | null) => void;
  onHoverCap: (id: string | null) => void;
  /** Opens the session dock (the claim ledger's claims-grouped-by-session view). */
  onShowSessions: () => void;
  /** Re-pull the world tree after a per-test UAT verdict is signed, so the crown repaints. */
  onCrownRefresh: () => void;
  onClose: () => void;
}): React.JSX.Element {
  const layout = useMemo(() => layoutSubdag(story), [story]);
  // ⚠ THE SUB-DAG PANS RATHER THAN SCROLLS (ADR-0502). The owner, seeing this exact panel: *"also be
  // nice if we could get rid of the ugly scroll bars and instead have it a pannable surface."* The
  // map's own viewport was given that treatment on the same feedback long ago and it was never
  // generalised, which is why the graph beside it still had bars. The four CSS properties are on
  // `.tree-subdag-frame`; this is the half that keeps removing the bar SAFE, because
  // `overflow: hidden` with no gesture behind it would strand every node past the frame's edge.
  const { frameRef: subdagFrameRef, surfaceRef: subdagSurfaceRef } = usePannable<
    HTMLDivElement,
    SVGSVGElement
  >(story.id);
  // The node's FULL declared connection set (ADR-0074 §4): outbound depends_on AND
  // the unioned/derived inbound — own consumed_by ∪ every story whose depends_on
  // names it. Resolved from the whole story list so the inverse is recovered (the
  // de-noised cli hub declares none of its own spokes). See lib/connectionSet.ts.
  const connections = useMemo(() => fullConnectionSet(stories, story.id), [stories, story.id]);
  // The panel's "sessions here" rows are the story's live CLAIMS (ADR-0200 D7 — presence
  // retired): the same coordination signal the claim wisps orbit with, each row opening the
  // session dock's claim ledger. A claim is never a proof (§5 honesty wall).
  const claimLine = (c: ClaimActivity): React.JSX.Element => (
    <p key={c.sessionId} className="tree-session small">
      <button type="button" className="tree-link" onClick={onShowSessions}>
        <code>{c.sessionId}</code>
      </button>
      <span className="muted">
        {' '}
        {c.grade ?? 'work'} · {formatAge(c.at, now)} ·{' '}
      </span>
      {c.intent}
    </p>
  );
  const [panelW, setPanelW] = useState(savedPanelWidth);
  const [resizing, setResizing] = useState(false);
  // Minimise to a single header bar (owner UX 2026-07-06): the full detail overlay can
  // hide the part of the map you want to see, so it collapses like the Legend /
  // Shared-Islands drawers — a one-row header you can restore. Resets per story so a
  // fresh selection always opens expanded.
  const [minimized, setMinimized] = useState(false);
  useEffect(() => setMinimized(false), [story.id]);
  const dragFrom = useRef<{ x: number; w: number } | null>(null);
  // The latest dragged width, read at pointerup — state can lag a render behind.
  const liveW = useRef(panelW);
  const clampW = (w: number): number =>
    Math.min(PANEL_MAX, Math.max(PANEL_MIN, Math.min(w, window.innerWidth - 220)));
  // A selectedCap can survive cross-story navigation (depends-on buttons) —
  // ignore ids that aren't in this story instead of dimming the whole sub-DAG.
  const rawFocus = hoverCap ?? selectedCap;
  const focusCap =
    rawFocus && story.capabilities.some((c) => c.id === rawFocus) ? rawFocus : null;
  const relations = useMemo(
    () => (focusCap ? relationsFor(story.capabilities, focusCap) : null),
    [story, focusCap],
  );
  const cap = selectedCap ? story.capabilities.find((c) => c.id === selectedCap) : undefined;
  const dependents = cap
    ? story.capabilities.filter((c) => c.dependsOn.includes(cap.id)).map((c) => c.id)
    : [];

  const capClass = (c: TreeCapability): string => {
    const cls = ['tree-card', 'sub-card', `st-${c.status ?? 'unknown'}`];
    if (hidden.has(c.status ?? 'unknown')) cls.push('is-filtered');
    if (focusCap && relations) {
      if (c.id === focusCap) cls.push('is-focus');
      else if (relations.ancestors.has(c.id)) cls.push('is-ancestor');
      else if (relations.descendants.has(c.id)) cls.push('is-descendant');
      else cls.push('is-dim');
    }
    if (c.id === selectedCap) cls.push('is-selected');
    return cls.join(' ');
  };

  const edgeClass = (e: { from: string; to: string }): string => {
    const cls = ['tree-edge'];
    if (focusCap && relations) {
      const anc = (id: string): boolean => id === focusCap || relations.ancestors.has(id);
      const desc = (id: string): boolean => id === focusCap || relations.descendants.has(id);
      if (relations.ancestors.has(e.from) && anc(e.to)) cls.push('is-ancestor');
      else if (relations.descendants.has(e.to) && desc(e.from)) cls.push('is-descendant');
      else cls.push('is-dim');
    }
    return cls.join(' ');
  };

  return (
    <aside
      className={`tree-detail${resizing ? ' is-resizing' : ''}${minimized ? ' is-minimized' : ''}`}
      style={minimized ? undefined : { width: panelW }}
    >
      <div
        className="tree-detail-grip"
        role="separator"
        aria-orientation="vertical"
        aria-label="resize detail panel (drag left to widen)"
        onPointerDown={(e) => {
          dragFrom.current = { x: e.clientX, w: panelW };
          setResizing(true);
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            // synthetic pointers (tests) have no active pointer to capture
          }
        }}
        onPointerMove={(e) => {
          const from = dragFrom.current;
          if (!from) return;
          liveW.current = clampW(from.w + (from.x - e.clientX));
          setPanelW(liveW.current);
        }}
        onPointerUp={() => {
          dragFrom.current = null;
          setResizing(false);
          localStorage.setItem(PANEL_W_KEY, String(liveW.current));
        }}
        onPointerCancel={() => {
          dragFrom.current = null;
          setResizing(false);
        }}
      />
      <header className="tree-detail-header">
        {minimized ? (
          <>
            <span className={`tree-badge st-${story.status ?? 'unknown'}`}>
              {story.status ?? 'unknown'}
            </span>
            <code className="tree-detail-mini-id" title={story.title}>
              {story.id}
            </code>
          </>
        ) : (
          <div className="tree-detail-heading">
            <span className={`tree-badge st-${story.status ?? 'unknown'}`}>
              {story.status ?? 'unknown'}
            </span>
            <h3 className="tree-detail-heading-title">{story.title}</h3>
            <code className="tree-detail-id">{story.id}</code>
          </div>
        )}
        <span className="tree-detail-controls">
          <button
            type="button"
            className="btn tree-detail-min"
            onClick={() => setMinimized((m) => !m)}
            aria-label={minimized ? 'expand detail' : 'minimize detail'}
            title={minimized ? 'Expand' : 'Minimize'}
          >
            {minimized ? '▢' : '–'}
          </button>
          <button type="button" className="btn" onClick={onClose} aria-label="close detail">
            ✕
          </button>
        </span>
      </header>
      {story.error && <p className="tree-detail-error">{story.error}</p>}
      {story.outcome && <p className="muted small tree-detail-outcome">{story.outcome}</p>}
      <p className="small tree-detail-verdict">
        <span className="muted">UAT verdict </span>
        <VerdictLine verdict={story.verdict} />
        <span className="muted"> · witness: {story.uatWitness}</span>
      </p>
      {/* The node's full two-way wiring (ADR-0074 §4): depends_on (outbound) AND
          consumed_by ∪ derived-inverse (inbound) — so a reader sees how the organism
          is wired without leaving the panel. */}
      <ConnectionsSection
        connections={connections}
        storyIds={storyIds}
        onNavigate={(d) => navigate(treeFocusHref(d))}
      />

      {claims.length > 0 && (
        <DetailDisclosure
          label="Sessions here"
          count={claims.length}
          defaultOpen
          className="tree-sessions"
        >
          {/* The panel is a detail surface like the dock: one row per live CLAIM on this story
              (ADR-0200 D7 — self-reported presence retired; the claim ledger is the one
              coordination signal). Clicking a row opens the session dock's grouped ledger. */}
          {claims.map(claimLine)}
        </DetailDisclosure>
      )}

      {/* The context-traversal replay used to enter HERE, as a claim-joined picker in this panel.
          ADR-0354 moved it: it is a tab in the bottom panel (`BottomDock`), listed by this machine's
          whole local trace index rather than by who claims this story. Staging the old placement is
          what falsified it — 339 local traces, exactly ONE reachable through the claim-gated picker,
          and only because the staging session took a claim to manufacture a row. A claim is a LIVE
          signal and a replay is RETROSPECTIVE; joining them offered only the sessions an operator
          happened to catch mid-flight. Nothing replaces it in this panel by design — the question
          "who is here" is answered by "Sessions here" above, and "what did they do" is now a tab. */}

      <DetailDisclosure
        label="Capabilities"
        count={story.capabilities.length}
        defaultOpen
        className="tree-capabilities"
      >
      <div className="tree-subdag-frame" ref={subdagFrameRef}>
        <svg
          className="tree-subdag"
          ref={subdagSurfaceRef}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          style={{
            width: Math.ceil(layout.width * SUB_RENDER_SCALE),
            height: Math.ceil(layout.height * SUB_RENDER_SCALE),
          }}
        >
          {layout.edges.map((e) => (
            <path
              key={`${e.from}->${e.to}`}
              className={edgeClass(e)}
              d={e.d}
              markerEnd="url(#sub-arrow)"
            />
          ))}
          {layout.caps.map(({ cap: c, x, y }) => {
            const lines = idLines(c.id);
            return (
              <g
                key={c.id}
                className={capClass(c)}
                transform={`translate(${x} ${y})`}
                onMouseEnter={() => onHoverCap(c.id)}
                onMouseLeave={() => onHoverCap(null)}
                onClick={() => onSelectCap(selectedCap === c.id ? null : c.id)}
              >
                <title>{c.error ? `${c.id} — ${c.error}` : c.title}</title>
                <rect className="tree-card-bg" width={SUB_W} height={SUB_H} rx={7} />
                <path
                  className="tree-card-strip"
                  d={`M 0 ${SUB_STRIP} L 0 7 Q 0 0 7 0 L ${SUB_W - 7} 0 Q ${SUB_W} 0 ${SUB_W} 7 L ${SUB_W} ${SUB_STRIP} Z`}
                />
                <text className="tree-card-status" x={7} y={10}>
                  {c.error ? 'spec error' : (c.status ?? 'unknown')}
                </text>
                {c.verdict && (
                  <text className="tree-card-verdict" x={SUB_W - 6} y={10} textAnchor="end">
                    {c.verdict.outcome === 'pass' ? '✓' : '✗'}
                  </text>
                )}
                {lines.map((line, i) => (
                  <text
                    key={i}
                    className="tree-card-id"
                    x={SUB_W / 2}
                    y={SUB_STRIP + 13 + i * 12}
                    textAnchor="middle"
                  >
                    {line}
                  </text>
                ))}
              </g>
            );
          })}
        </svg>
      </div>

      {cap && (
        <div className="tree-cap-detail">
          <header>
            <span className={`tree-badge st-${cap.status ?? 'unknown'}`}>
              {cap.status ?? 'unknown'}
            </span>
          </header>
          <h3>{cap.id}</h3>
          <p className="tree-detail-title">{cap.title}</p>
          {cap.error && <p className="tree-detail-error">{cap.error}</p>}
          {cap.outcome && <p className="muted small">{cap.outcome}</p>}
          <dl>
            <dt>verdict</dt>
            <dd>
              <VerdictLine verdict={cap.verdict} />
            </dd>
            {cap.proofMode && (
              <>
                <dt>proof mode</dt>
                <dd>{cap.proofMode}</dd>
              </>
            )}
            <dt>test contracts</dt>
            <dd>{cap.testCount}</dd>
            {cap.dependsOn.length > 0 && (
              <>
                <dt>depends on</dt>
                <dd>
                  {cap.dependsOn.map((d) => (
                    <button key={d} type="button" className="tree-link" onClick={() => onSelectCap(d)}>
                      {d}
                    </button>
                  ))}
                </dd>
              </>
            )}
            {dependents.length > 0 && (
              <>
                <dt>depended on by</dt>
                <dd>
                  {dependents.map((d) => (
                    <button key={d} type="button" className="tree-link" onClick={() => onSelectCap(d)}>
                      {d}
                    </button>
                  ))}
                </dd>
              </>
            )}
            <dt>spec</dt>
            <dd>
              <code>{`stories/${story.id}/${cap.id}.md`}</code>
            </dd>
          </dl>
        </div>
      )}
      </DetailDisclosure>

      {/* The per-UAT-test attestation table sits near the FOOT of the drill-down (the last thing
          you read once you've taken in the story + its capability DAG) — a vouch surface, never
          the gate-green hue (ADR-0044). */}
      <UatTestCriteriaSection storyId={story.id} onCrownRefresh={onCrownRefresh} />
      <RelevantAdrs decisions={story.decisions ?? []} />

      {/* NO go-green control here (ADR-0404 D2/D3/D4). The panel's last ACTION used to be a
          status-aware Build/Adopt affordance (ADR-0090 Phase 1 / ADR-0094 / ADR-0097 Layer 1); the
          whole of it — button, Claude/Codex runtime picker, poll hook, transcript, AdoptPanel — is
          retired, because dispatching a build or an adoption is a CLI verb: `storytree node build`,
          `storytree story build`, `storytree adopt`. The panel is a READ surface now; the tree
          payload still carries buildable/storyBuildable/goGreen/adoptGates/adoption with no consumer
          until inc-03 removes them. */}
    </aside>
  );
}
