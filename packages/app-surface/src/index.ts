export {
  SceneView,
  type ForestRegrowRenderLayer,
  type NativeIslandGrowthRenderLayer,
  type OrganicPoseRenderLayer,
  type SceneCtx,
} from './SceneView.js';
export {
  deriveForestRegrowPlan,
  forestRegrowAtProgress,
  FOREST_REGROW_TUNING,
  type ForestRegrowIslandGrowth,
  type ForestRegrowOptions,
  type ForestRegrowPathway,
  type ForestRegrowPlan,
  type ForestRegrowReach,
  type ForestRegrowSegmentDraw,
  type ForestRegrowSegmentGrowth,
  type ForestRegrowState,
  type ForestRegrowStep,
  type ForestRegrowStory,
  type ForestRegrowTrailEdge,
  type ForestRegrowTuning,
} from './forest-regrow.js';
export {
  EXP16_TREE_GROWTH_TRACK,
  POSE_PLANT_GROWTH_TRACK,
  SHARED_GROWTH_TRACKS,
  growthTrackFrameIndex,
  growthTrackPlacement,
  type GrowthTrackFrame,
  type GrowthTrackPlacement,
  type GrowthTrackPlacementInput,
  type SharedGrowthTrack,
} from './shared-growth-tracks.js';
export {
  PLATE_SETTLE_END,
  PLATE_SETTLE_RISE,
  PLATE_SETTLE_START,
  VEGETATION_GROW_SPAN,
  VEGETATION_STAGGER_SPAN,
  deriveIslandVegetationPlan,
  deriveIslandVegetationPlans,
  islandTreeVariation,
  islandVegetationAtProgress,
  vegetationStaggerDelay,
  type IslandTreeVariation,
  type IslandVegetationInput,
  type IslandVegetationPlan,
  type VegetationAnchor,
  type VegetationArtContext,
  type VegetationObjectPlan,
  type VegetationRender,
  type VegetationRole,
  type VegetationRootMode,
} from './island-vegetation-growth.js';
export {
  vegetationLayerSignature,
  vegetationProgressByStory,
  vegetationRenderLayer,
  type VegetationRenderLayer,
} from './vegetation-render.js';
export {
  deriveForestRegrowAccretionPlans,
  forestRegrowLayerSignature,
  forestRegrowRenderLayer,
  forestRegrowTrailPlan,
  forestRegrowTrailSignature,
  type ForestRegrowAccretionPlans,
} from './forest-regrow-render.js';
export {
  normalizeWorldPresentationModel,
  WorldSceneView,
  type WorldPresentationEvents,
  type WorldPresentationModel,
  type WorldPresentationModelInput,
} from './WorldSceneView.js';
export {
  nativePropTargetRects,
  type NativePropTarget,
  type NativePropTargetRect,
  type NativePropTargetRenderLayer,
} from './native-prop-targets.js';
export {
  parseStyleSheet,
  resolveSprite,
  spriteKeyFor,
  spritePlacement,
  type SpriteDef,
  type SpriteStyleSheet,
} from './sprite-sheet.js';
export {
  bakedDefBounds,
  collectDefBounds,
  fitSpritePlacement,
  parseSimpleTransform,
  pathBounds,
  wrapperContentBounds,
  type Bounds,
} from './sprite-sizing.js';
export {
  neighbourHighlightPlan,
  type NeighbourHighlightPlan,
  type NeighbourRoute,
  type NeighbourRouteStep,
} from './neighbourHighlight.js';
export {
  laneGeometry,
  laneLayout,
  netTurnOf,
  type Lane,
  type LaneHub,
  type LaneLayout,
  type LaneLayoutOptions,
  type LanePoint,
} from './laneLayout.js';
export {
  arrivalGrowPlan,
  REVEAL_STAGGER_MS,
  trailRevealPlan,
  type RevealSegment,
  type TrailDir,
  type TrailRevealPlan,
} from './trailReveal.js';
export {
  SemanticGrowthWorldView,
  type SemanticGrowthAnimationClock,
  type SemanticGrowthFrame,
  type SemanticGrowthFrameKey,
  type SemanticGrowthOrganicPoseInstance,
  type SemanticGrowthOrganicPoseLayer,
  type SemanticGrowthSvgIslandAccretion,
  type SemanticGrowthWorldViewProps,
} from './SemanticGrowthWorldView.js';
export {
  deriveSharedEdgeAdjacency,
  deriveSvgIslandAccretionPlan,
  svgIslandAccretionAtProgress,
  type SvgIslandAccretionCell,
  type SvgIslandAccretionCellReveal,
  type SvgIslandAccretionCoastReveal,
  type SvgIslandAccretionPlan,
  type SvgIslandAccretionPoint,
  type SvgIslandAccretionState,
} from './svg-island-accretion.js';
export {
  ORGANIC_POSE_CUE_TARGETS,
  ORGANIC_POSE_PLAYBACK_POLICY,
  advanceOrganicPosePlayback,
  backOrganicPoseCue,
  clampOrganicPoseProgress,
  initialOrganicPosePlayback,
  nextOrganicPoseCue,
  organicPoseFrameAtProgress,
  replayOrganicPosePlayback,
  selectOrganicPoseCue,
  validateOrganicPoseRegistry,
  validateOrganicPoseTrack,
  type OrganicPoseDepthSlot,
  type OrganicPoseFootprint,
  type OrganicPoseFrame,
  type OrganicPoseHold,
  type OrganicPosePlaybackPhase,
  type OrganicPosePlaybackState,
  type OrganicPosePoint,
  type OrganicPoseProvenance,
  type OrganicPoseRegistryBudget,
  type OrganicPoseTrack,
  type OrganicPoseTrackKind,
  type RegisteredOrganicPoseRegistry,
} from './organic-pose-to-pose-track.js';
export {
  CHAPTER2_ORGANIC_POSE_TO_POSE_REGISTRY,
  CHAPTER2_PLANT_SAMPLE_TRACK,
} from './organic-pose-to-pose-assets.js';
export {
  CHAPTER2_ROUND3_EXP15_REGISTRY,
  CHAPTER2_ROUND3_EXP16_REGISTRY,
  CHAPTER2_ROUND3_EXP18_REGISTRY,
  CHAPTER2_ROUND3_LAB_BUDGET,
  CHAPTER2_ROUND3_LAB_ELEVATION_DEG,
  CHAPTER2_ROUND3_TREE_CANDIDATES,
  chapter2Round3TreeCandidate,
  type Chapter2HeroTreeAnchorRule,
  type Chapter2HeroTreeCandidate,
  type Chapter2HeroTreeCandidateBudget,
  type Chapter2HeroTreeCandidateId,
} from './chapter2-round3-tree-candidates.js';

// The object half of the land's declared camera (ADR-0367 D1).
export {
  organicLayerBox,
  organicLayerGroundContact,
  spriteUprightReconciliation,
  type OrganicLayerBox,
  type OrganicLayerPlacement,
} from './land-camera.js';
