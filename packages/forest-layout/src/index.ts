// @storytree/forest-layout — WHERE THE ISLANDS SIT (ADR-0537 D1).
//
// `@storytree/forest-world` owns each island's OWN geometry — the hex lattice, sizing, ranking, the
// smoothed coast, the relaxed substrate, trail routing, the camera, the scene graph. This package
// owns the other half of the map: WHICH ISLAND GOES WHERE and how much water sits between them.
// It lived inside `apps/studio/src/components/TreeView.tsx` until ADR-0537, which ruled that the
// engine's publishing toll may not decide where shared layout code lives, and ruled AGAINST folding
// it into `forest-world` — that package earns its keep by depending on nothing, while layout has
// different consumers and a far higher change rate, so aiming the heaviest publishing cost at the
// most frequently changed code on the map is the one direction the decision forbids.
//
// Chrome-free by construction: it declares its own minimal input contract (`LayoutStory`) carrying
// nothing about how a story is RENDERED, and the studio's building class and icon promotion reach
// it only as injected data. No React, no DOM, no store, no `node:` imports.

export {
  packWorld,
  groundHeroTile,
  type LayoutCapability,
  type LayoutStory,
  type PackOptions,
  type SpacingTuning,
  type CapSpot,
  type DecorSpot,
  type Territory,
  type HexWorld,
} from './pack.js';

export {
  ISLAND_SPACING_RATIO,
  ISLAND_SPACING_RUNGS,
  PRE_ADR0521_SPACING,
  SPACING_CONTROL_ARM,
  gapBetween,
  inRowGapWithChrome,
  loneSwing,
  rankGapWithChrome,
  spacingArmId,
  type ChromeClearance,
  type LegacySpacing,
} from './spacing.js';
