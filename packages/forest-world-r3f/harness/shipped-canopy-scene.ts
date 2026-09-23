// shipped-canopy-scene.ts — THE VOCABULARY ON THE SHIPPED GROUND, built once and shared: what
// stands on the crowd's islands, what that shades, and the shipped ground built from it. Two arms,
// one thing each — and this module is no longer a PAGE. It is the memoised builder the cover, detail
// and shadow pages compose their scenes from, so that "the shipped ground under today's props" is
// one construction rather than four that agree today.
//
//   bare        the shipped ground alone — every layer at what ships, nothing standing and nothing
//               casting (the prop MASK and the denominator on every page that borrows it)
//   capability  + the vocabulary: one pine per capability, one bloom per signature (ADR-0475),
//               casting their shadows (ADR-0507 D3) — everything the canvas stands EXCEPT the ground
//               cover, which casts nothing and so leaves this arm's ground the shipped ground exactly
//
// ⚠⚠ THIS MODULE USED TO CARRY A THIRD ARM AND A LADDER, AND THEIR ABSENCE IS A DECISION. From
// 2026-09-03 the page laddered the healthy island's GROVE — thirteen stands of dressing pines per
// recipe-island of area at x1 / x2 / x3 — and shipped a rung. ADR-0518 (2026-09-05) retired the
// role outright: the owner read the grove as capabilities, and a tree on the map now means exactly
// one. The ladder's question is answered ("none"), so its page, its drivers and its arms are gone
// with `src/grove-dressing.ts`; the evidence directories keep the frames. What survived is the
// half every other page already imported. The page that shows the map WITH the grove beside the
// map without it was `shipped-per-capability-scene.ts` (retired with its question on 2026-09-05,
// once the land-per-capability ratio re-sized the island it compared on; its evidence directory stays).
//
// ⚠⚠ THE ARMS DIFFER IN EXACTLY THE DRESSING, AND NOTHING ELSE IS ARM-SPECIFIC. Every arm is
// `shippedGroundBuild` — the SHIPPED canvas's own builder, imported from `src/` — over the same
// parcels, the same strips and the same framing. What an arm chooses is its PLACEMENT LIST, and
// that list reaches the ground exactly the way it reaches the map: as the casters
// `shippedGroundBuild` is handed, unioned with the crowd's own descriptor-stream casters, through
// the same `placementCasters` the canvas calls. (⚠ that second list was each island's story tree
// and is now EMPTY — ADR-0508 retired it.) So a pixel between two arms is attributable to what
// stands there and the shadow it throws, and to nothing else. `shipped-canopy-scene.test.ts`
// states that as a property of the source.
//
// THE MODULE ADOPTS NOTHING. `harness/` only — it produces EVIDENCE about the `src/` modules it
// imports; the crossing itself is the canvas's (`src/ForestWorldCanvas.tsx`).

import { cellGroundGeometry } from '../src/cell-ground-geometry.js';
import { cellAt } from '../src/dressing-ground.js';
import { shippedGroundBuild, type ShippedGroundBuild } from '../src/ForestWorldCanvas.js';
import { placementCasters } from '../src/ground-casters.js';
import {
  KIT_FOOTPRINTS_2026_08_29,
  KIT_HEIGHTS_2026_08_29,
  isCriterionRole,
  type KitPlacement,
} from '../src/kit-vocabulary.js';
import { LAND_RELIEF_AMPLITUDE } from '../src/land-relief.js';
import type { ShadowCaster } from '../src/land-shadow.js';
import { dressMapFromKit } from '../src/map-dressing.js';
import { parcelCellsFrom, type LayoutCell } from '../src/parcel-cells.js';
import type { InstanceDescriptor } from '../src/world-to-3d.js';
import {
  crowdCasters,
  crowdCells,
  crowdDescriptors,
  crowdStrips,
  type CrowdSize,
  type CrowdSizeId,
} from './shipped-crowd-scene.js';

/** The arms, control first. */
export type CanopyArm = 'bare' | 'capability';
export const CANOPY_ARMS: readonly CanopyArm[] = ['bare', 'capability'];

/** The arm every pixel figure is read against: the shipped ground with nothing bought on it. */
export const CONTROL_ARM: CanopyArm = 'bare';

/**
 * THE ARM WHOSE GROUND IS THE SHIPPED GROUND — everything the canvas stands that CASTS. Ground
 * cover contributes no caster (`placementCasters` drops the dressing roles), so the shipped map's
 * occlusion field is built from exactly this arm's casters, and every page that borrows "the
 * ground under today's map" borrows `canopyGroundBuild(SHIPPED_CANOPY_ARM, size)`.
 *
 * ⚠ IT WAS `SHIPPED_GROVE_ARM = 'groves-x1'` until ADR-0518: the grove cast, so the shipped ground
 * carried its pools. The grove is gone and the capability arm IS what casts now.
 */
export const SHIPPED_CANOPY_ARM: CanopyArm = 'capability';

/** What each arm IS, as the caption under its picture on any page that draws it. */
export const CANOPY_ARM_CAPTION = {
  bare: 'the shipped ground alone — every layer at what ships, nothing bought on it and, since the placeholder story tree was retired, nothing casting on it either (CONTROL)',
  capability:
    'the shipped ground + the vocabulary: one pine per capability, one bloom per signature, casting their shadows — everything the canvas stands except the ground cover, which casts nothing',
} satisfies Record<CanopyArm, string>;

/** The frozen tables the canvas places and casts from — the same two, by import. */
export const CANOPY_FOOTPRINT = KIT_FOOTPRINTS_2026_08_29;
export const CANOPY_HEIGHTS = KIT_HEIGHTS_2026_08_29;

// ---------------------------------------------------------------- what stands, per arm

const descriptorMemo = new Map<CrowdSizeId, InstanceDescriptor[]>();

/** THE CROWD AS ONE DESCRIPTOR STREAM — ground, signatures AND the trail strips, which is what
 *  `worldTo3D` hands the canvas: the cover keeps off the worn path the strips' docks imply, so a
 *  stream without them would grow cover across a path the ground draws. */
export function armDescriptors(size: CrowdSize): InstanceDescriptor[] {
  const hit = descriptorMemo.get(size.id);
  if (hit !== undefined) return hit;
  const built = [...crowdDescriptors(size), ...crowdStrips(size)];
  descriptorMemo.set(size.id, built);
  return built;
}

const placementMemo = new Map<string, KitPlacement[]>();

/**
 * WHAT EACH ARM STANDS. `bare` stands nothing; `capability` is the vocabulary (`dressMapFromKit`)
 * — the same function, off the same stream, at the same frozen footprints the canvas places from.
 *
 * ⚠ MEMOISED PER ARM AND SIZE, and it is a `check:mutation-diff` requirement as much as a cost
 * one: the forest's dressing is 35 islands' worth of placement, and a suite that rebuilt it per
 * assertion reports Timeouts on a loaded runner, which the rung scores UNPROVEN.
 */
export function armPlacements(arm: CanopyArm, size: CrowdSize): KitPlacement[] {
  const key = `${arm}|${size.id}`;
  const hit = placementMemo.get(key);
  if (hit !== undefined) return hit;
  const built =
    arm === 'bare' ? [] : dressMapFromKit(armDescriptors(size), { relief: LAND_RELIEF_AMPLITUDE, footprint: CANOPY_FOOTPRINT });
  placementMemo.set(key, built);
  return built;
}

/**
 * WHAT DARKENS THE GROUND, PER ARM: the crowd's own descriptor-stream casters UNIONED with one
 * caster per placement — the same union, through the same `placementCasters`, that the canvas
 * hands its ground.
 *
 * ⚠ THE FIRST HALF IS NOW EMPTY, AND THE UNION IS KEPT ANYWAY. `crowdCasters` was each island's
 * story tree; ADR-0508 retired the family, so it returns `[]` and `bare` is an island with nothing
 * standing on it and no pool at its centre — which is what a control for "what does the kit add"
 * should have been all along. The union stays because it is the CANVAS's own shape (a `cave-arch`
 * on a rim would come through it), and collapsing it to the placements would make this builder stop
 * being the same scene as the map the moment a portal appeared on one.
 */
export function armCasters(arm: CanopyArm, size: CrowdSize): ShadowCaster[] {
  return [...crowdCasters(size), ...placementCasters(armPlacements(arm, size), CANOPY_FOOTPRINT, CANOPY_HEIGHTS)];
}

const groundBuildMemo = new Map<string, ShippedGroundBuild>();

/**
 * THE SHIPPED GROUND, BUILT ONCE PER ARM AND SIZE — `shippedGroundBuild`, the function `CellGround`
 * calls, handed this arm's casters. Per ARM rather than per size (unlike the skirt and status
 * pages) because the casters ARE what the arms vary, and the occlusion field is built from them.
 * The shore and wear thunks are memoised inside the build, so each arm pays those once.
 */
export function canopyGroundBuild(arm: CanopyArm, size: CrowdSize): ShippedGroundBuild {
  const key = `${arm}|${size.id}`;
  const hit = groundBuildMemo.get(key);
  if (hit !== undefined) return hit;
  const built = shippedGroundBuild(crowdCells(size), armCasters(arm, size), crowdStrips(size));
  groundBuildMemo.set(key, built);
  return built;
}

/** Placements standing on NO cell of the crowd — the count a driver refuses on. A capability's
 *  tree is sampled inside its parcel, so the honest answer is zero; a non-zero is a placement basis
 *  that has come apart from the ground's. */
export function offIslandCount(placements: readonly KitPlacement[], cells: readonly LayoutCell[]): number {
  let off = 0;
  for (const p of placements) if (cellAt(cells, p.at) === null) off += 1;
  return off;
}

/** What one arm costs and stands, in numbers a picture cannot carry. */
export interface CanopyPlan {
  /** The GROUND's triangles — identical on every arm, because a caster changes the field and never
   *  the mesh. */
  groundTriangles: number;
  /** Objects standing: everything bought, by kind. `placements` is their sum. */
  placements: number;
  capabilityTrees: number;
  blooms: number;
  /** Casters the field was built from, and how many of them are the kit's. */
  casters: number;
  kitCasters: number;
  offIsland: number;
}

export function canopyPlan(arm: CanopyArm, size: CrowdSize): CanopyPlan {
  const placements = armPlacements(arm, size);
  // ⚠ EVERY CRITERION FORM (ADR-0600): `capabilityTrees` is the remainder, so a bud left out
  // here is a bud counted as a capability.
  const blooms = placements.filter((p) => isCriterionRole(p.role)).length;
  const build = canopyGroundBuild(arm, size);
  return {
    groundTriangles: cellGroundGeometry(build.input).triangles,
    placements: placements.length,
    capabilityTrees: placements.length - blooms,
    blooms,
    casters: armCasters(arm, size).length,
    kitCasters: placements.length,
    offIsland: offIslandCount(placements, parcelCellsFrom(crowdCells(size))),
  };
}
