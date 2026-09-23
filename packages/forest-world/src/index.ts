// @storytree/forest-world — the shared forest-world render core (ADR-0093,
// strategy C). Pure, browser-safe, deterministic GEOMETRY: data-in → geometry-out.
// Both the studio (React mapper) and the public website (string-SVG mapper) render
// FROM this. No store, no React, no live data, no node: imports. Two pure layers:
// the geometry KERNEL below (rng / hex / sizing / ranking / coast / substrate) and
// the framework-agnostic SCENE-GRAPH (`scene.ts`) — the drawable tree the two
// mappers walk.

export { hash, rand01 } from './rng.js';

// The land's ONE declared camera (ADR-0367 D1) — read by the land's coordinate mapping below and,
// across the package boundary, by the object sprites that stand on it.
export {
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  uprightForeshortening,
  projectGround,
  groundPolarOffset,
  unprojectGround,
  groundRadiusToScreenHalfHeight,
  spriteUprightScale,
} from './camera.js';

// The ONE place that decides how much forest a surface opens on (ADR-0471). Every shipped map
// used to answer that with a fit of its own; they now all convert from the single `scale` this
// returns.
export {
  RESTING_ISLAND_SPANS,
  MAX_EXTENT_SHOWN,
  type RestingBound,
  type RestingFrameInput,
  type RestingFrame,
  restingFrame,
} from './resting-view.js';

export {
  type Pt,
  type Axial,
  HEX_R,
  HEX_W,
  HEX_AREA,
  HEX_UNIT_AREA,
  HEX_TILES_PER_CAPABILITY,
  LAND_AREA_PER_CAPABILITY,
  PRE_ADR0528_TILE,
  TILE_QUOTA_RULE,
  TILE_SCALE,
  tileUnits,
  TILE_DEPTH,
  TILE_DEPTH_WORLD,
  axialKey,
  AXIAL_DIRS,
  hexCenter,
  pixelToHex,
  hexDist,
  hexCorners,
  hexPath,
  polyPath,
} from './hex.js';

export {
  ringsOf,
  estRadius,
  tileQuota,
  TREE_ART_RUNG,
  PLATE_ART_RUNG,
  FLORA_ART_RUNG,
  TRAIL_ART_RUNG,
  TREE_SCALE,
  crownRadius,
  crownRadiusWorld,
  storyTreeReach,
} from './sizing.js';

export {
  type RankStory,
  type EdgeCapability,
  type EdgeStory,
  type StoryEdge,
  storyEdges,
  rankStories,
  descendantCounts,
} from './ranking.js';

export {
  type BoundarySeg,
  COAST_OUTSET,
  COAST_OUTSET_ON_TILE,
  COAST_SMOOTH_ITERS,
  boundaryRingLoops,
  jitteredOutset,
  loopSignedArea,
  outsetLoop,
  chaikinClosed,
  smoothLoopPath,
  smoothCoast,
} from './coast.js';

export {
  type SubstrateMode,
  type SubstrateTuning,
  type RelaxedCell,
  type DrawTile,
  MESH_TUNING,
  buildRelaxedCells,
} from './substrate.js';

export {
  type TrailIsland,
  type TrailEdgeIn,
  type TrailTuning,
  type TrailSegment,
  type TrailCave,
  type TrailEdgeOut,
  type TrailNetwork,
  routeTrails,
  projectTrailNetwork,
  trailFillWidth,
} from './routing.js';

export {
  type SceneStatus,
  type SceneKind,
  // The three states a UAT criterion's marker can be in. Exported because the 3D mapper
  // (`@storytree/forest-world-r3f`'s `world-to-3d.ts`) derives its marker-kind table from it, so
  // a fourth state added here reds that package's typecheck instead of silently reaching the map
  // undrawn (ADR-0600 D2).
  type MarkerState,
  type BuildPhase,
  type WispPhaseBand,
  type ClaimColourState,
  type ClaimGrade,
  type SurfaceTheme,
  type SurfaceFn,
  type ParcelCell,
  type ParcelFloraMark,
  type SceneParcelInput,
  type SceneGardenInput,
  type SceneGardenHero,
  type SceneVegetationInput,
  type SceneVegHeroTrees,
  type GardenHeroId,
  SURFACES,
  wispBand,
  type SceneNodeBase,
  type SceneG,
  type ScenePath,
  type SceneCircle,
  type SceneEllipse,
  type ScenePolygon,
  type SceneRect,
  type SceneText,
  type BakedPaintNode,
  type SceneBakedDef,
  type SceneBakedUse,
  type SceneNode,
  type SceneTrailsInput,
  type ScenePlantInput,
  type SceneTerritoryInput,
  type SceneInput,
  type SceneEmptyHex,
  BAKED_STONE_DEF,
  buildScene,
  type TileArt,
  type ArtRungs,
  tileArt,
  SHIPPED_TILE_ART,
  PLATE_SCALE,
  FLORA_SCALE,
  TRAIL_STROKE_SCALE,
  landCellId,
  buildTrails,
  buildTree,
  buildPlant,
  buildConifer,
  buildTerritoryFlora,
} from './scene.js';
