// kit-vocabulary.ts — the harness's route into the prop vocabulary, which CROSSED into
// `src/kit-vocabulary.ts` on 2026-08-30 with the bought kit.
//
// ⚠⚠ WHAT MOVED AND WHY. The vocabulary is what the map SAYS about each capability — one object
// per capability, its species and leaf tint carrying that capability's state (ADR-0475, settled by
// the owner 2026-08-29). The shipped canvas draws it now, so it cannot live on a surface where
// "the island represents nothing" (ADR-0406 D1). Everything the vocabulary declares, and the
// placement search that stopped a rock standing inside a pine, is re-exported below — so the
// experiment and the product are dressing islands by ONE implementation rather than two.
//
// ⚠ WHAT STAYED IS THE FIXTURE ADAPTER, and only that. The crossed `dressIslandFromKit` takes its
// cells and its capability facts as ARGUMENTS, because the shipped canvas has no `SceneG` and no
// fixture — it has descriptors. This file supplies the harness's own route to the same two
// arguments, and keeps the `{ scene, island, relief, footprint }` call shape its callers already
// use (`kit-island-scene.ts`, `crowd-scene.ts`), so nothing here had to change for the crossing.

import type { SceneG } from '@storytree/forest-world';

import {
  dressIslandFromKit as dressCells,
  type CapabilityFacts,
  type KitDressingOptions as CellDressingOptions,
  type KitPlacement,
  type RoleFootprints,
} from '../src/kit-vocabulary.js';
import { groundCellsFrom } from './island-descriptors.js';
import { islandCapabilities, islandCriteria } from './island-fixture.js';
import type { IslandOptions } from './island-fixture.js';
import { layoutCells } from './prop-layout.js';

export {
  FOOTPRINT_TOLERANCE,
  KIT_ASSEMBLIES,
  KIT_FOOTPRINTS_2026_08_29,
  KIT_HEIGHTS_2026_08_29,
  KIT_ROLES,
  KIT_ROLE_ASSEMBLIES,
  KIT_ROLE_CLASS,
  KIT_ROLE_SIGNAL,
  KIT_ROLE_SIZE,
  MIN_PROP_HEIGHT,
  MIN_PROP_WIDTH,
  POCKETED_SIGNALS,
  RENDER_ELEV_DEG,
  VOCABULARY_STATES,
  capabilityFactsFrom,
  clearsObjectFloor,
  deliveredHeightPx,
  deliveredRolePx,
  dressingCensus,
  dressingOverlaps,
  footprintDriftOf,
  heightDriftOf,
  kitObjectNames,
  pairClearance,
  stateForm,
  tintedStates,
} from '../src/kit-vocabulary.js';
export type {
  CapabilityFacts,
  DressingCensus,
  KitAssembly,
  KitPlacement,
  KitRole,
  Occupancy,
  PropOverlap,
  RoleFootprints,
  RoleHeights,
  StateForm,
} from '../src/kit-vocabulary.js';

/** Read each capability's state off the fixture's own capability list.
 *
 *  ⚠ THE FIXTURE IS THE REASON THIS STAYED. `buildScene`'s output is a DRAWING — groups, paths
 *  and transforms — and the harness island's capability list is authored beside it rather than
 *  recoverable from it. The shipped path does not have that problem and does not have this
 *  function: it reads the same facts off the map's own parcels
 *  (`capabilityFactsFrom` in `src/kit-vocabulary.ts`). */
export function capabilityFacts(island: IslandOptions): CapabilityFacts[] {
  return islandCapabilities(island).map((cap) => ({ capId: cap.capId, status: String(cap.status) }));
}

/** The harness's dressing options — a scene and the fixture options it was built from, which is
 *  the shape both harness callers already pass. */
export interface KitDressingOptions {
  scene: SceneG;
  island: IslandOptions;
  relief: number;
  footprint: RoleFootprints;
  seed?: number;
}

/**
 * DRESS THE HARNESS ISLAND. A thin adapter over the crossed placement: it converts the scene's
 * ground cells into the placement basis and counts the fixture's signed criteria, then delegates.
 *
 * ⚠ IT UNPROJECTS, AND SINCE 2026-09-05 SO DOES THE SHIPPED PATH (ADR-0517 D1). `groundCellsFrom`
 * takes the scene's isometric drawing back to ground coordinates about the drawing's origin;
 * `worldTo3D` now restores the same true footprint about each island's own centre. Both are
 * internally consistent — a prop is placed in the same space its island's ground is built in on
 * each surface — and `src/parcel-cells.ts`'s header carries the full note.
 */
export function dressIslandFromKit(opts: KitDressingOptions): KitPlacement[] {
  // ⚠ ALL THREE CRITERION STATES, derived from the fixture's own criteria (ADR-0600 D1: every
  // criterion is drawn and signing changes the flower's STATE rather than its existence). The
  // `flowers === false` arm is the fixture's own "this island has no markers at all" switch, so it
  // silences every state — an island with no criteria, not an island whose criteria are hidden.
  const criteria = opts.island.flowers === false ? [] : islandCriteria(opts.island);
  const countOf = (state: string): number => criteria.filter((c) => c.state === state).length;
  // ANNOTATED local, then one guarded assignment — `anti-slop/no-conditional-empty-object-spread`.
  const delegated: CellDressingOptions = {
    cells: layoutCells(groundCellsFrom(opts.scene)),
    facts: capabilityFacts(opts.island),
    blooms: countOf('proven'),
    buds: countOf('pending'),
    wilts: countOf('failing'),
    relief: opts.relief,
    footprint: opts.footprint,
  };
  if (opts.seed !== undefined) delegated.seed = opts.seed;
  return dressCells(delegated);
}
