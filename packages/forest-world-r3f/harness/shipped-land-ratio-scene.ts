// shipped-land-ratio-scene.ts — THE ISLAND'S SIZE FROM A LAND-PER-CAPABILITY RATIO, laddered for
// the owner (increment `island-size-from-a-land-per-capability-ratio` on `land-ground-stack-arc`).
//
//   today      the map AS IT SHIPPED after PR #1825: the island at the size the hex layout gave it
//              (≈ 2,240 units² of land per capability on the fixture), one tree per capability, the
//              cover at the rung that shipped (CONTROL — every "moved" is vs this)
//   land-318   the island sized to 318 units² per capability — the density of the picture the owner
//              called nicer, which the approved render's own density agrees with in the true basis
//   land-200   200 units² per capability
//   land-108   108 units² per capability — the increment's reading of the recipe through the
//              squashed basis; the boldest rung
//   cover-x…   the SHIPPED rung of land, with the ground cover's count re-laddered on it (e) — the
//              rung that ships is the `land-<shipped>` arm itself
//
// ⚠⚠ THE TWO PICTURES THAT MATTER, AND THE ONE THAT SHOWS THE TRAP. `one` at 8 px/unit is the
// island as it is read; `forest` fitted is the view the map opens on. The forest's layout is the
// DRAWN island's — the real map's spacing is the 2D drawing's, and the mapper sizes each island IN
// PLACE (`land-per-capability.ts`), so shrinking every island 2.6–4.4× edge to edge inside a layout
// that holds still is exactly what this codebase does. `forest-compact` is the OTHER answer to the
// layout question — the frame sized from the shipped island, i.e. the layout compacted with the
// islands — rendered so the owner can see both, and standing on no shipped surface: it is the
// instrument's picture of a decision that is his (increment (c)).
//
// ⚠⚠ ONE TREE PER CAPABILITY ON EVERY ARM (ADR-0518 D1/D4). The tree count is printed on every arm
// and the driver refuses a run where it is not the capability count, or where anything tree-shaped
// that a capability did not put there stands. The remedy for a sparse island is LESS LAND — that
// is this whole page — never more trees.
//
// ⚠⚠ THE CONTROL IS HISTORY AND SAYS SO. `today` cannot be composed from the shipped constants any
// more: the island is sized by the ratio and the recipe island's area followed it. So the control
// passes `landAreaPerCapability: null` (the drawing's own size) and the PREVIOUS recipe area, typed
// as what shipped until 2026-09-05, so it wears the cover count it wore rather than seven times it.
// Every other arm is `worldTo3D` with a rung and `dressMapWithCover` with the canvas's own options
// (`comparison-baseline-moves-under-the-page`).
//
// ⚠ THE BANDS ARE THE SHIPPED RUNG'S ON EVERY ARM. The beach, the path, the noise lattices and the
// relief follow `LAND_SCALE`, which is a module constant derived from the SHIPPED ratio — so a
// non-shipped rung wears bands sized for the shipped island (a 200 or 108 island wears a beach
// that is a slightly larger fraction of it). The ladder judges the SIZE; the bands are re-derived
// for what ships, and this is said on the sheet rather than hidden.
//
// ⚠ FRAME COST IS TAKEN HERE, AND IT REPORTS — IT DOES NOT GATE (ADR-0517 D4). Smaller islands
// improve every number; that is a side effect and not the argument.
//
// THE PAGE ADOPTS NOTHING OF ITS OWN. `harness/` only: it produces EVIDENCE about the `src/` modules
// it imports. The pick — the ratio, and the cover rung — lands in `src/land-per-capability.ts` and
// `src/cover-dressing.ts`.

import * as THREE from 'three';

import { GROUND_ATLAS_ATTRIBUTE, GROUND_STATUS_ATTRIBUTE } from '../src/banded-ground-material.js';
import { SHIPPED_ELEVATION_DEG, shippedElevationDeg } from '../src/camera-framing.js';
import { cellGroundGeometry } from '../src/cell-ground-geometry.js';
import { COVER_DENSITY, COVER_DENSITY_RUNGS, COVER_SIZE } from '../src/cover-dressing.js';
import { RECIPE_ISLAND_AREA, cellsArea, dressingEligible } from '../src/dressing-ground.js';
import { configureExactColour } from '../src/exact-colour.js';
import {
  SHIPPED_GRASS,
  SHIPPED_LAYERS,
  SHIPPED_SAND_MIX,
  buildGroundMaterial,
  shippedGroundBuild,
  type GroundLayerExtras,
  type ShippedGroundBuild,
} from '../src/ForestWorldCanvas.js';
import { groundCasters, placementCasters } from '../src/ground-casters.js';
import {
  KIT_FOOTPRINTS_2026_08_29,
  KIT_HEIGHTS_2026_08_29,
  KIT_ROLE_SIZE,
  RENDER_ELEV_DEG,
  isCoverPlacement,
  isCriterionRole,
  type KitPlacement,
} from '../src/kit-vocabulary.js';
import {
  LAND_AREA_PER_CAPABILITY,
  LAND_AREA_PER_CAPABILITY_RUNGS,
  LAND_SCALE,
  TUNED_LAND_AREA_PER_CAPABILITY,
  islandLand,
  type IslandLand,
} from '../src/land-per-capability.js';
import { LAND_RELIEF_AMPLITUDE } from '../src/land-relief.js';
import type { ShadowCaster } from '../src/land-shadow.js';
import {
  calibrateLights,
  intensitiesFor,
  type CalibratedIntensities,
  type LightCalibration,
} from '../src/light-calibration.js';
import { dressMapWithCover, type MapDressingOptions } from '../src/map-dressing.js';
import { cellsByIsland, parcelCellsFrom } from '../src/parcel-cells.js';
import { KIT_PROP_INDIRECT_FRACTION } from '../src/prop-lighting.js';
import { islandCentres } from '../src/true-footprint.js';
import { worldTo3D, type InstanceDescriptor } from '../src/world-to-3d.js';
import { CROWD_VIEWPORT } from './crowd-layout.js';
import { GPU_TIMER_EXTENSION } from './frame-cost.js';
import { awaitQuery, readIdentity, type DisjointTimerQuery, type RendererIdentity } from './frame-cost-scene.js';
import { islandGroundScene } from './island-fixture.js';
import { KIT_ASSET_URL, kitMeshes, loadKit, setKitPropLighting, type LoadedKit } from './kit-scene.js';
import { SHIPPED_LIGHTING } from './shipped-baseline.js';
import {
  FIT_ZOOM,
  crowdDescriptors,
  crowdSize,
  crowdStrips,
  orientedCamera,
  type CrowdSize,
  type CrowdZoom,
} from './shipped-crowd-scene.js';
import { kitFacts, type KitFacts } from './shipped-detail-scene.js';
import { REFERENCE_IMAGE, backgroundBytes, familyCensus, referenceFamilies } from './shipped-grass-scene.js';
import { imageStats, type ImageStats } from './shipped-skirt-scene.js';
import { VISIBLE_DELTA, sensitivityReasons, visibleDeltaDistribution, type VisibleDeltaReading } from './visible-delta.js';

export { REFERENCE_IMAGE, VISIBLE_DELTA };

// ---------------------------------------------------------------- the arms

/**
 * WHAT SHIPPED UNTIL THIS LANDING, typed as history: the island at the size the drawing gave it
 * (`landAreaPerCapability: null`), the cover counted per the recipe island AT THAT SIZE (the
 * recipe's thirteen hexes as drawn — `RECIPE_ISLAND_AREA` before it followed the ratio), at the
 * count rung PR #1825 shipped (x3). None of it can be read off the shipped code any more, which is
 * exactly why it is written here: the control has to be the picture the owner saw this morning.
 */
export const PREVIOUS_RECIPE_ISLAND_AREA = RECIPE_ISLAND_AREA / (LAND_SCALE * LAND_SCALE);
export const PREVIOUS_COVER_DENSITY = 3;

export interface LandRatioArmSpec {
  id: string;
  /** Land per capability this arm sizes each island to, or `null` for the size the drawing gives. */
  areaPerCapability: number | null;
  /** Which count rung the healthy islands' cover is drawn at. */
  coverDensity: number;
  /** The recipe island's area the cover is counted per — the control's previous basis, or the shipped one. */
  recipeIslandArea: number;
  /** Which ladder this arm is a rung of. */
  ladder: 'land' | 'cover';
}

export const CONTROL_ARM = 'today';

export function landArmId(areaPerCapability: number): string {
  return `land-${areaPerCapability}`;
}

export function coverArmId(density: number): string {
  return `cover-x${density}`;
}

/** The land rungs rendered — the declared ladder, by import. */
export const LAND_LADDER: readonly number[] = [...LAND_AREA_PER_CAPABILITY_RUNGS];

/**
 * THE COVER'S COUNT RE-LADDERED ON THE CORRECTLY-SIZED ISLAND (increment (e)). PR #1825 shipped x3
 * to fill an island seven times too large; the declared ladder (`COVER_DENSITY_RUNGS`, by import)
 * brackets it downward on the shipped island — the shipped rung is whichever `COVER_DENSITY`
 * names, and it is rendered as the `land-<shipped>` arm rather than twice.
 */
export const COVER_LADDER: readonly number[] = [...COVER_DENSITY_RUNGS];

/** Every arm: the control first, the land ladder from the most land per capability down, then the
 *  cover rungs at the shipped land (the shipped cover rung being the land arm itself). */
export const LAND_RATIO_ARMS: readonly LandRatioArmSpec[] = [
  {
    id: CONTROL_ARM,
    areaPerCapability: null,
    coverDensity: PREVIOUS_COVER_DENSITY,
    recipeIslandArea: PREVIOUS_RECIPE_ISLAND_AREA,
    ladder: 'land',
  },
  ...LAND_LADDER.map(
    (k): LandRatioArmSpec => ({
      id: landArmId(k),
      areaPerCapability: k,
      coverDensity: COVER_DENSITY,
      recipeIslandArea: RECIPE_ISLAND_AREA,
      ladder: 'land',
    }),
  ),
  ...COVER_LADDER.filter((d) => d !== COVER_DENSITY).map(
    (d): LandRatioArmSpec => ({
      id: coverArmId(d),
      areaPerCapability: LAND_AREA_PER_CAPABILITY,
      coverDensity: d,
      recipeIslandArea: RECIPE_ISLAND_AREA,
      ladder: 'cover',
    }),
  ),
];

/** The land ladder's arms, most land first (the control is not a rung). */
export const LAND_ARMS: readonly string[] = LAND_RATIO_ARMS.filter((a) => a.ladder === 'land' && a.id !== CONTROL_ARM).map((a) => a.id);

/** The cover ladder's arms at the shipped land, leanest first — the shipped rung is the land arm. */
export const COVER_ARMS: readonly string[] = LAND_RATIO_ARMS.filter((a) => a.ladder === 'cover').map((a) => a.id);

/** The arm the canvas stands after this landing: the shipped ratio, the shipped cover rung. */
export const SHIPPED_ARM: string = landArmId(LAND_AREA_PER_CAPABILITY);

export function armSpec(id: string): LandRatioArmSpec {
  const found = LAND_RATIO_ARMS.find((a) => a.id === id);
  if (!found) throw new Error(`shipped-land-ratio-scene: no arm "${id}"`);
  return found;
}

/**
 * THE ARM ONE STEP UP THE SAME LADDER — for a land rung, the arm with MORE land per capability
 * (the control above the top rung); for a cover rung, the next rung up the cover ladder (the
 * shipped land arm where that rung is the shipped one). `null` for the control.
 */
export function neighbourArm(id: string): string | null {
  const spec = armSpec(id);
  if (id === CONTROL_ARM) return null;
  if (spec.ladder === 'land') {
    const i = LAND_LADDER.indexOf(spec.areaPerCapability as number);
    return i === 0 ? CONTROL_ARM : landArmId(LAND_LADDER[i - 1]!);
  }
  const i = COVER_LADDER.indexOf(spec.coverDensity);
  const up = COVER_LADDER[i + 1];
  if (up === undefined) return SHIPPED_ARM;
  return up === COVER_DENSITY ? SHIPPED_ARM : coverArmId(up);
}

/** What each arm IS, as the caption under its own picture. */
export function armCaption(id: string): string {
  const spec = armSpec(id);
  if (id === CONTROL_ARM) {
    return (
      `the map AS IT SHIPPED after PR #1825 — the island at the size the hex layout gave it (≈ ${TUNED_LAND_AREA_PER_CAPABILITY.toFixed(0)} units² ` +
      `per capability on the fixture), one tree per capability, the ground cover at rung x${PREVIOUS_COVER_DENSITY} — TODAY (CONTROL)`
    );
  }
  const tag = id === SHIPPED_ARM ? ' — THE SHIPPED PICK' : '';
  if (spec.ladder === 'land') {
    const why =
      spec.areaPerCapability === 318
        ? ' (the density of the picture the owner called nicer; the approved render agrees in the true basis)'
        : spec.areaPerCapability === 108
          ? ' (the recipe read through the squashed basis — the boldest rung)'
          : '';
    return `every island sized to ${spec.areaPerCapability} units² of land per capability${why}, one tree per capability, the cover at rung x${spec.coverDensity}${tag}`;
  }
  return `the shipped land (${spec.areaPerCapability} units² per capability), the ground cover at rung x${spec.coverDensity} of the recipe's count on the recipe island as this map now draws it`;
}

// ---------------------------------------------------------------- the pictures

export type LandRatioPictureId = 'one' | 'forest' | 'forest-compact';

export interface LandRatioPicture {
  id: LandRatioPictureId;
  size: CrowdSize;
  what: string;
}

/**
 * The three pictures: one island; the thirty-five-island forest with its layout HELD STILL (what
 * the codebase does); and the same forest with the layout COMPACTED with the islands (the other
 * answer to the layout question, the owner's to make).
 */
export const LAND_RATIO_PICTURES: readonly LandRatioPicture[] = [
  { id: 'one', size: crowdSize('one'), what: 'one island — the fixture, eleven capabilities' },
  {
    id: 'forest',
    size: crowdSize('forest'),
    what: 'the forest, layout HELD STILL — the spacing is the 2D drawing’s, each island resized in place (what ships)',
  },
  {
    id: 'forest-compact',
    size: { ...crowdSize('forest'), layout: 'compact', what: 'the forest with its frame sized from the shipped island' },
    what: 'the forest, layout COMPACTED with the islands — NOT what ships; the other answer to the layout question',
  },
];

export function picture(id: LandRatioPictureId): LandRatioPicture {
  const found = LAND_RATIO_PICTURES.find((p) => p.id === id);
  if (!found) throw new Error(`shipped-land-ratio-scene: no picture "${id}"`);
  return found;
}

export const LAND_RATIO_ZOOMS: readonly number[] = [8];
export const LAND_RATIO_PICTURE_ZOOMS: readonly CrowdZoom[] = [...LAND_RATIO_ZOOMS, FIT_ZOOM];

/** The pictures each arm is rendered in at each zoom: the compact forest is a fitted picture only. */
export function picturesAt(zoom: CrowdZoom): readonly LandRatioPicture[] {
  return zoom === FIT_ZOOM ? LAND_RATIO_PICTURES : LAND_RATIO_PICTURES.filter((p) => p.id !== 'forest-compact');
}

// ---------------------------------------------------------------- what each arm stands

const islandMemo = new Map<string, InstanceDescriptor[]>();

/** The fixture island through the shipped mapper at THIS arm's ratio — the cells the crowd copies. */
export function armIsland(arm: string): InstanceDescriptor[] {
  const spec = armSpec(arm);
  const key = String(spec.areaPerCapability);
  const hit = islandMemo.get(key);
  if (hit !== undefined) return hit;
  const built = worldTo3D(islandGroundScene(), { landAreaPerCapability: spec.areaPerCapability }).filter(
    (d): d is InstanceDescriptor => d.kind === 'cell-ground',
  );
  islandMemo.set(key, built);
  return built;
}

const descriptorMemo = new Map<string, InstanceDescriptor[]>();

/** The whole stream for an arm in a picture — the crowd's cells and blooms plus its strips, built
 *  on this arm's island. Memoised per ratio and picture: two arms at one ratio share a stream. */
export function armDescriptors(arm: string, pic: LandRatioPicture): InstanceDescriptor[] {
  const key = `${String(armSpec(arm).areaPerCapability)}|${pic.id}`;
  const hit = descriptorMemo.get(key);
  if (hit !== undefined) return hit;
  const base = armIsland(arm);
  const built = [...crowdDescriptors(pic.size, base), ...crowdStrips(pic.size, base)];
  descriptorMemo.set(key, built);
  return built;
}

/** The canvas's own dressing options (`ForestWorldCanvas.tsx`), stated once. */
const CANVAS_OPTIONS = { relief: LAND_RELIEF_AMPLITUDE, footprint: KIT_FOOTPRINTS_2026_08_29 } as const;

const placementMemo = new Map<string, KitPlacement[]>();

/** WHAT STANDS ON AN ARM — `dressMapWithCover` with the SAME options the canvas passes plus this
 *  arm's count rung and recipe basis. Memoised per arm and picture. */
export function armPlacements(arm: string, pic: LandRatioPicture): KitPlacement[] {
  const key = `${arm}|${pic.id}`;
  const hit = placementMemo.get(key);
  if (hit !== undefined) return hit;
  const spec = armSpec(arm);
  const opts: MapDressingOptions = {
    ...CANVAS_OPTIONS,
    coverDensity: spec.coverDensity,
    recipeIslandArea: spec.recipeIslandArea,
  };
  const built = dressMapWithCover(armDescriptors(arm, pic), opts);
  placementMemo.set(key, built);
  return built;
}

/** What darkens an arm's ground — the descriptor stream's casters UNIONED with one per placement,
 *  the same union the canvas hands its ground. Ground cover contributes none HERE (`coverCasts:
 *  false`, stated as history): this page picked the island's SIZE and the cover's COUNT on
 *  2026-09-05, on a field the cover did not darken, and its one-build-per-ratio structure and its
 *  committed numbers rest on that. The cover began casting the next day (`COVER_CASTS`); the page
 *  that shows the map as it now ships is `shipped-cast-shadow-scene.ts`. */
export function armCasters(arm: string, pic: LandRatioPicture): ShadowCaster[] {
  return [
    ...groundCasters(armDescriptors(arm, pic)),
    ...placementCasters(armPlacements(arm, pic), KIT_FOOTPRINTS_2026_08_29, KIT_HEIGHTS_2026_08_29, false),
  ];
}

const groundBuildMemo = new Map<string, ShippedGroundBuild>();

/**
 * THE SHIPPED GROUND, BUILT ONCE PER RATIO AND PICTURE — `shippedGroundBuild`, the function
 * `CellGround` calls. Arms at one ratio share one build: their casters are the vocabulary's (cover
 * casts nothing), so the cover ladder rides the shipped land arm's ground. The driver refuses a run
 * where two arms at one ratio disagree about ground triangles.
 */
export function armGroundBuild(arm: string, pic: LandRatioPicture): ShippedGroundBuild {
  const key = `${String(armSpec(arm).areaPerCapability)}|${pic.id}`;
  const hit = groundBuildMemo.get(key);
  if (hit !== undefined) return hit;
  const stream = armDescriptors(arm, pic);
  const built = shippedGroundBuild(
    stream.filter((d) => d.kind === 'cell-ground'),
    armCasters(arm, pic),
    stream.filter((d) => d.kind === 'trail-strip'),
  );
  groundBuildMemo.set(key, built);
  return built;
}

// ---------------------------------------------------------------- the numbers under the picture

export interface DressingCounts {
  placements: number;
  capabilityTrees: number;
  blooms: number;
  cover: number;
  bushes: number;
  tufts: number;
  flowerPatches: number;
  islands: number;
  healthyIslands: number;
  capabilityTreesPerHealthyIsland: number;
  coverPerHealthyIsland: number;
}

/** A capability tree is every placement that is neither ground cover nor a signature bloom — the
 *  vocabulary's one object per capability. On every arm it must equal the capability count. */
export function dressingCounts(placements: readonly KitPlacement[], stream: readonly InstanceDescriptor[]): DressingCounts {
  let cover = 0;
  let bushes = 0;
  let tufts = 0;
  let flowerPatches = 0;
  let blooms = 0;
  for (const p of placements) {
    if (isCoverPlacement(p)) {
      cover += 1;
      if (p.role === 'bush') bushes += 1;
      else if (p.role === 'tuft') tufts += 1;
      else flowerPatches += 1;
      // ⚠ EVERY CRITERION FORM, not just the signed one (ADR-0600) — `capabilityTrees` below is
      // this count subtracted from the total, so a bud counted here as a capability would inflate
      // the ratio this whole page is about.
    } else if (isCriterionRole(p.role)) blooms += 1;
  }
  const capabilityTrees = placements.length - cover - blooms;
  const byIsland = cellsByIsland(parcelCellsFrom(stream));
  const healthy = [...byIsland.values()].filter((cells) => dressingEligible(cells)).length;
  const land = islandLand(stream);
  let healthyCapabilities = 0;
  for (const [id, cells] of byIsland) if (dressingEligible(cells)) healthyCapabilities += land.get(id)?.capabilities ?? 0;
  return {
    placements: placements.length,
    capabilityTrees,
    blooms,
    cover,
    bushes,
    tufts,
    flowerPatches,
    islands: byIsland.size,
    healthyIslands: healthy,
    capabilityTreesPerHealthyIsland: healthy === 0 ? 0 : healthyCapabilities / healthy,
    coverPerHealthyIsland: healthy === 0 ? 0 : cover / healthy,
  };
}

/** The land the ratio is about, on the island every 8 px/unit frame is centred on. */
export interface CentreIslandLand {
  island: string;
  capabilities: number;
  /** Its drawn land, in ground units² — the parcel rings' area. */
  landArea: number;
  /** Land per capability, in units² — the number every arm prints. */
  unitsPerCapability: number;
}

/** The island nearest the origin, and its land — `islandLand` on the stream, picked by centre. */
export function centreIslandLand(stream: readonly InstanceDescriptor[]): CentreIslandLand {
  const centres = islandCentres(stream);
  let nearest: string | undefined;
  let best = Infinity;
  for (const [id, c] of centres) {
    const d = Math.hypot(c.x, c.z);
    if (d < best) {
      best = d;
      nearest = id;
    }
  }
  if (nearest === undefined) throw new Error('shipped-land-ratio-scene: the stream holds no island');
  const land = islandLand(stream).get(nearest) as IslandLand;
  return {
    island: nearest,
    capabilities: land.capabilities,
    landArea: land.area,
    unitsPerCapability: land.capabilities === 0 ? 0 : land.area / land.capabilities,
  };
}

/** The whole map's land, in ground units² — every island's parcel rings. */
export function totalLand(stream: readonly InstanceDescriptor[]): number {
  return cellsArea(parcelCellsFrom(stream));
}

/** The numbers, as one line under a picture — the land per capability first, because it is the ratio. */
export function countsCaption(c: DressingCounts, land: CentreIslandLand, pic: LandRatioPictureId): string {
  const ratio = `${land.unitsPerCapability.toFixed(0)} units² of land per capability (${land.landArea.toFixed(0)} units² over ${land.capabilities})`;
  const trees = `${c.capabilityTrees} trees (one per capability)`;
  const cover = `${c.cover} ground cover (${c.bushes} bushes, ${c.tufts} tufts, ${c.flowerPatches} flower patches)`;
  if (pic === 'one') return `${ratio} · ${trees} · ${c.blooms} blooms · ${cover}`;
  return (
    `${ratio} on the centre island · ${c.islands} islands, ${c.healthyIslands} green · ${trees} · ${cover} · per green island ` +
    `${c.capabilityTreesPerHealthyIsland.toFixed(1)} trees, ${c.coverPerHealthyIsland.toFixed(0)} cover`
  );
}

// ---------------------------------------------------------------- the camera and the framing

export function viewDirectionOf(camera: THREE.Camera): THREE.Vector3 {
  return camera.position.clone().normalize();
}

export function cameraElevationDeg(camera: THREE.Camera): number {
  const d = viewDirectionOf(camera);
  return (Math.atan2(d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI;
}

/** Complaints if the shipped camera is not the signed one. */
export function cameraAgreement(): string[] {
  const out: string[] = [];
  const shipped = cameraElevationDeg(orientedCamera({ x: 0, z: 0 }, 1));
  if (Math.abs(shipped - RENDER_ELEV_DEG) > 1e-9) {
    out.push(`the shipped crowd camera looks down at ${shipped.toFixed(4)}°, not the signed ${RENDER_ELEV_DEG}°`);
  }
  if (Math.abs(shippedElevationDeg() - SHIPPED_ELEVATION_DEG) > 1e-9) {
    out.push(`frameWorld looks down at ${shippedElevationDeg().toFixed(4)}° against SHIPPED_ELEVATION_DEG ${SHIPPED_ELEVATION_DEG}`);
  }
  return out;
}

export interface ScreenExtent {
  w: number;
  h: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function screenExtent(positions: ArrayLike<number>, camera: THREE.Camera): ScreenExtent {
  const v = new THREE.Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    v.set(positions[i]!, positions[i + 1]!, positions[i + 2]!).applyMatrix4(camera.matrixWorldInverse);
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  return { w: maxX - minX, h: maxY - minY, minX, maxX, minY, maxY };
}

/** The crowd page's fit margin, in ground units — the same 40 next door. */
export const FIT_MARGIN = 40;

export function fitPxPerUnitFor(positions: ArrayLike<number>): number {
  const e = screenExtent(positions, orientedCamera({ x: 0, z: 0 }, 1));
  const halfW = Math.max(Math.abs(e.minX), Math.abs(e.maxX)) + FIT_MARGIN;
  const halfH = Math.max(Math.abs(e.minY), Math.abs(e.maxY)) + FIT_MARGIN;
  return Math.min(CROWD_VIEWPORT.w / 2 / halfW, CROWD_VIEWPORT.h / 2 / halfH);
}

/** A pine's delivered height on screen at the shipped elevation — the upright is foreshortened by cos. */
export function deliveredPineHeightPx(pxPerUnit: number): number {
  return KIT_ROLE_SIZE.tree.units * Math.cos((RENDER_ELEV_DEG * Math.PI) / 180) * pxPerUnit;
}

export interface GroundExtent {
  w: number;
  d: number;
}

/** The ground-plane extent of a cell set — the footprint's own number, camera-free. */
export function groundDepth(cells: readonly InstanceDescriptor[]): GroundExtent {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const c of cells) {
    for (const p of c.points ?? []) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  return { w: maxX - minX, d: maxZ - minZ };
}

/** The footprint of the ONE island nearest the origin — the island every 8 px/unit frame is centred on. */
export function islandDepth(cells: readonly InstanceDescriptor[]): GroundExtent {
  const centre = centreIslandLand(cells).island;
  return groundDepth(cells.filter((d) => d.island === centre));
}

// ---------------------------------------------------------------- the scene

export interface LandRatioScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  width: number;
  height: number;
  pxPerUnit: number;
  spec: LandRatioArmSpec;
  groundTriangles: number;
  island: GroundExtent;
  /** The whole picture's ground extent — the forest's, on a forest picture. */
  ground: GroundExtent;
  screen: ScreenExtent;
  counts: DressingCounts;
  land: CentreIslandLand;
  totalLand: number;
  casters: number;
  meshes: number;
}

/** ONE ARM'S SCENE: its ground build and placements, the shipped camera, nothing else free. */
export function buildLandRatioScene(
  kit: LoadedKit,
  lit: CalibratedIntensities,
  arm: string,
  pic: LandRatioPicture,
  zoom: CrowdZoom,
): LandRatioScene {
  const spec = armSpec(arm);
  const build = armGroundBuild(arm, pic);
  const geo = cellGroundGeometry(build.input);
  if (geo.triangles === 0) throw new Error('shipped-land-ratio-scene: the crowd drew no ground');
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(geo.normals, 3));
  geometry.setAttribute(GROUND_STATUS_ATTRIBUTE, new THREE.BufferAttribute(geo.statuses, 1));
  if (geo.atlasOrigins.length > 0) {
    geometry.setAttribute(GROUND_ATLAS_ATTRIBUTE, new THREE.BufferAttribute(geo.atlasOrigins, 2));
  }
  const wearField = build.wear();
  const extras: GroundLayerExtras = { rock: SHIPPED_LAYERS.rock, detail: SHIPPED_LAYERS.detail };
  if (wearField !== null) extras.wear = { field: wearField, mix: SHIPPED_LAYERS.wearMix };
  const { material } = buildGroundMaterial(build.field, SHIPPED_GRASS, build.shore(), SHIPPED_SAND_MIX, extras);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SHIPPED_LIGHTING.background);
  scene.add(new THREE.Mesh(geometry, material));
  const placements = armPlacements(arm, pic);
  let meshes = 0;
  for (const mesh of kitMeshes(kit, placements)) {
    scene.add(mesh);
    meshes += 1;
  }
  scene.add(new THREE.AmbientLight(0xffffff, lit.ambient));
  const sun = new THREE.DirectionalLight(0xffffff, lit.directional);
  const [lx, ly, lz] = SHIPPED_LIGHTING.directionalPosition;
  sun.position.set(lx, ly, lz);
  scene.add(sun);
  const pxPerUnit = zoom === FIT_ZOOM ? fitPxPerUnitFor(geo.positions) : zoom;
  const camera = orientedCamera({ x: 0, z: 0 }, pxPerUnit);
  const stream = armDescriptors(arm, pic);
  const cells = stream.filter((d) => d.kind === 'cell-ground');
  return {
    scene,
    camera,
    width: CROWD_VIEWPORT.w,
    height: CROWD_VIEWPORT.h,
    pxPerUnit,
    spec,
    groundTriangles: geo.triangles,
    island: islandDepth(cells),
    ground: groundDepth(cells),
    screen: screenExtent(geo.positions, camera),
    counts: dressingCounts(placements, stream),
    land: centreIslandLand(cells),
    totalLand: totalLand(cells),
    casters: armCasters(arm, pic).length,
    meshes,
  };
}

// ---------------------------------------------------------------- the readings

export interface PixelBox {
  w: number;
  h: number;
  x0: number;
  y0: number;
  pixels: number;
}

export function landBox(
  rgba: Uint8ClampedArray,
  w: number,
  h: number,
  bg: readonly [number, number, number] | null,
): PixelBox {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let pixels = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const isBg =
        bg === null ? rgba[i + 3]! < 128 : rgba[i]! === bg[0] && rgba[i + 1]! === bg[1] && rgba[i + 2]! === bg[2];
      if (isBg) continue;
      pixels += 1;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (pixels === 0) return { w: 0, h: 0, x0: 0, y0: 0, pixels: 0 };
  return { w: maxX - minX + 1, h: maxY - minY + 1, x0: minX, y0: minY, pixels };
}

export interface LandRatioReading {
  arm: string;
  ladder: 'land' | 'cover';
  areaPerCapability: number | null;
  coverDensity: number;
  elevationDeg: number;
  pxPerUnit: number;
  drawCalls: number;
  triangles: number;
  groundTriangles: number;
  counts: DressingCounts;
  land: CentreIslandLand;
  totalLand: number;
  casters: number;
  meshes: number;
  island: GroundExtent;
  ground: GroundExtent;
  screen: { w: number; h: number; wPx: number; hPx: number; aspect: number };
  box: PixelBox;
  pineHeightPx: number;
  stats: ImageStats;
  landPx: number;
  /** Land pixels as a share of the WHOLE frame — on a fitted forest, the "dots in a field" number. */
  landShare: number;
  /** Land pixels as a share of the land's own bounding box on screen. */
  landShareOfBox: number;
  families: number;
  largestShare: number;
  /** Against the CONTROL at the same picture and zoom. `touched` is context only (ADR-0490 D6). */
  touched: number;
  visible: number;
  delta: VisibleDeltaReading;
  /** Against the neighbour one step up the same ladder (null for the control). */
  touchedVsNeighbour: number | null;
  visibleVsNeighbour: number | null;
}

export interface ReferenceGeometry {
  width: number;
  height: number;
  box: PixelBox;
  aspect: number;
  families: number;
  largestShare: number;
  stats: ImageStats;
}

export interface LandRatioCostSpec {
  arm: string;
  picture: LandRatioPictureId;
  zoom: CrowdZoom;
  batch: number;
}

export interface LandRatioCostReading extends LandRatioCostSpec {
  gpuMsPerFrame: number | null;
  gpuBatchNs: number | null;
  disjoint: boolean;
  drawCalls: number;
  triangles: number;
  timerQueryAvailable: boolean;
  hidden: boolean;
}

export interface LandRatioRunner {
  identity(): RendererIdentity;
  calibration(): LightCalibration;
  kits(): KitFacts[];
  agreement(): string[];
  warm(): void;
  read(arm: string, picture: LandRatioPictureId, zoom: CrowdZoom): LandRatioReading;
  sensitivity(picture: LandRatioPictureId, zoom: CrowdZoom): string[];
  /** The frame cost of one arm on the GPU's own clock — a REPORT (ADR-0517 D4). */
  cost(spec: LandRatioCostSpec): Promise<LandRatioCostReading>;
  snapshot(arm: string, picture: LandRatioPictureId, zoom: CrowdZoom): string;
  reference(url: string): Promise<ReferenceGeometry>;
}

export async function createLandRatioRunner(): Promise<LandRatioRunner> {
  const t0 = performance.now();
  const kit = await loadKit(KIT_ASSET_URL);
  const loadMs = performance.now() - t0;
  setKitPropLighting(kit, KIT_PROP_INDIRECT_FRACTION);
  const facts = [kitFacts(kit, KIT_ASSET_URL, loadMs)];
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  configureExactColour(renderer);
  const cal = calibrateLights(renderer);
  const lit = intensitiesFor(cal);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension(GPU_TIMER_EXTENSION) as DisjointTimerQuery | null;
  const bg = backgroundBytes();
  const cache = new Map<string, LandRatioScene>();
  const sceneFor = (arm: string, pic: LandRatioPictureId, zoom: CrowdZoom): LandRatioScene => {
    const k = `${arm}|${pic}|${String(zoom)}`;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const built = buildLandRatioScene(kit, lit, arm, picture(pic), zoom);
    cache.set(k, built);
    return built;
  };
  const render = (arm: string, pic: LandRatioPictureId, zoom: CrowdZoom): LandRatioScene => {
    const s = sceneFor(arm, pic, zoom);
    renderer.setSize(s.width, s.height, false);
    renderer.render(s.scene, s.camera);
    return s;
  };
  const pixels = (arm: string, pic: LandRatioPictureId, zoom: CrowdZoom): Uint8ClampedArray => {
    const s = render(arm, pic, zoom);
    const buf = new Uint8Array(s.width * s.height * 4);
    gl.readPixels(0, 0, s.width, s.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    return new Uint8ClampedArray(buf.buffer);
  };
  return {
    identity: () => readIdentity(gl),
    calibration: () => cal,
    kits: () => facts,
    agreement: () => cameraAgreement(),
    warm() {
      for (const arm of LAND_RATIO_ARMS) render(arm.id, 'one', LAND_RATIO_ZOOMS[0]!);
    },
    read(arm, pic, zoom) {
      const s = render(arm, pic, zoom);
      const info = renderer.info.render;
      const drawCalls = info.calls;
      const triangles = info.triangles;
      const buf = pixels(arm, pic, zoom);
      const census = familyCensus(buf, bg);
      const delta = visibleDeltaDistribution(buf, pixels(CONTROL_ARM, pic, zoom));
      const neighbour = neighbourArm(arm);
      const vsNeighbour = neighbour === null ? null : visibleDeltaDistribution(buf, pixels(neighbour, pic, zoom));
      const box = landBox(buf, s.width, s.height, bg);
      return {
        arm,
        ladder: s.spec.ladder,
        areaPerCapability: s.spec.areaPerCapability,
        coverDensity: s.spec.coverDensity,
        elevationDeg: cameraElevationDeg(s.camera),
        pxPerUnit: s.pxPerUnit,
        drawCalls,
        triangles,
        groundTriangles: s.groundTriangles,
        counts: s.counts,
        land: s.land,
        totalLand: s.totalLand,
        casters: s.casters,
        meshes: s.meshes,
        island: s.island,
        ground: s.ground,
        screen: {
          w: s.screen.w,
          h: s.screen.h,
          wPx: s.screen.w * s.pxPerUnit,
          hPx: s.screen.h * s.pxPerUnit,
          aspect: s.screen.w / s.screen.h,
        },
        box,
        pineHeightPx: deliveredPineHeightPx(s.pxPerUnit),
        stats: imageStats(buf, s.width, s.height, bg),
        landPx: census.land,
        landShare: census.land / (s.width * s.height),
        landShareOfBox: box.pixels === 0 ? 0 : census.land / (box.w * box.h),
        families: census.families,
        largestShare: census.largestShare,
        touched: delta.touched,
        visible: delta.visible,
        delta,
        touchedVsNeighbour: vsNeighbour === null ? null : vsNeighbour.touched,
        visibleVsNeighbour: vsNeighbour === null ? null : vsNeighbour.visible,
      };
    },
    sensitivity(pic, zoom) {
      return sensitivityReasons(pixels(CONTROL_ARM, pic, zoom));
    },
    async cost(spec) {
      const s = sceneFor(spec.arm, spec.picture, spec.zoom);
      renderer.setSize(s.width, s.height, false);
      for (const _ of Array.from({ length: 5 })) {
        void _;
        renderer.render(s.scene, s.camera);
      }
      gl.finish();
      const drawCalls = renderer.info.render.calls;
      const triangles = renderer.info.render.triangles;
      let gpuBatchNs: number | null = null;
      let disjoint = false;
      if (timer) {
        gl.getParameter(timer.GPU_DISJOINT_EXT);
        const query = gl.createQuery();
        if (query) {
          gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
          for (const _ of Array.from({ length: spec.batch })) {
            void _;
            renderer.render(s.scene, s.camera);
          }
          gl.endQuery(timer.TIME_ELAPSED_EXT);
          gl.flush();
          gpuBatchNs = await awaitQuery(gl, query, 20_000);
          disjoint = gl.getParameter(timer.GPU_DISJOINT_EXT) === true;
          gl.deleteQuery(query);
        }
      }
      const usable = gpuBatchNs !== null && !disjoint ? gpuBatchNs : null;
      return {
        ...spec,
        gpuMsPerFrame: usable === null ? null : usable / 1e6 / spec.batch,
        gpuBatchNs,
        disjoint,
        drawCalls,
        triangles,
        timerQueryAvailable: timer !== null,
        hidden: document.hidden,
      };
    },
    snapshot(arm, pic, zoom) {
      render(arm, pic, zoom);
      return canvas.toDataURL('image/png');
    },
    async reference(url) {
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error(`shipped-land-ratio-scene: the reference ${url} did not load`));
        img.src = url;
      });
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d');
      if (ctx === null) throw new Error('shipped-land-ratio-scene: no 2d context for the reference');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, c.width, c.height).data;
      const buf = new Uint8ClampedArray(data.buffer.slice(0));
      const census = referenceFamilies(buf);
      const box = landBox(buf, c.width, c.height, null);
      return {
        width: c.width,
        height: c.height,
        box,
        aspect: box.h === 0 ? 0 : box.w / box.h,
        families: census.families,
        largestShare: census.largestShare,
        stats: imageStats(buf, c.width, c.height, REFERENCE_TRANSPARENT),
      };
    },
  };
}

const REFERENCE_TRANSPARENT: readonly [number, number, number] = [-1, -1, -1];

// ---------------------------------------------------------------- the page

export async function mountShippedLandRatio(root: HTMLElement): Promise<void> {
  const runner = await createLandRatioRunner();
  window.landRatioRunner = runner;
  runner.warm();
  const id = runner.identity();
  const cal = runner.calibration();
  const head = document.createElement('p');
  head.className = 'numbers';
  head.textContent =
    `${id.vendor} — ${id.renderer} · software=${id.software} · light probe ${cal.probe.toFixed(3)} → ` +
    `scale ${cal.scale.toFixed(3)} onto the ladder’s ${cal.target} · shipped elevation ${shippedElevationDeg().toFixed(2)}° (signed ${RENDER_ELEV_DEG}°) · ` +
    `shipped ratio ${LAND_AREA_PER_CAPABILITY} units² per capability (LAND_SCALE ${LAND_SCALE.toFixed(4)} against the tuned ${TUNED_LAND_AREA_PER_CAPABILITY.toFixed(0)}) · ` +
    `cover rung x${COVER_DENSITY} at size ${COVER_SIZE} · camera agreement: ${runner.agreement().length === 0 ? 'the shipped camera is the signed one' : runner.agreement().join('; ')}`;
  root.appendChild(head);
  const refHead = document.createElement('h2');
  refHead.textContent =
    'THE REFERENCE — the render the owner stamped (Blender/Cycles, orthographic, 50°, the true footprint, 13 stands of pines)';
  root.appendChild(refHead);
  const refRow = document.createElement('div');
  refRow.className = 'row';
  const refFig = document.createElement('figure');
  const refImg = document.createElement('img');
  refImg.src = REFERENCE_IMAGE;
  refImg.width = 900;
  refFig.appendChild(refImg);
  const refCap = document.createElement('figcaption');
  refCap.textContent = 'land-combined-1948px.png — the look-fence, ADR-0489 D3 (its pines are the recipe’s stands; the map stands one per capability)';
  refFig.appendChild(refCap);
  refRow.appendChild(refFig);
  root.appendChild(refRow);
  for (const zoom of LAND_RATIO_PICTURE_ZOOMS) {
    for (const pic of picturesAt(zoom)) {
      const h = document.createElement('h2');
      h.textContent = `${pic.id} — ${pic.what} — ${zoom === FIT_ZOOM ? 'fitted (each arm at its own fit)' : `${zoom} px/unit`}`;
      root.appendChild(h);
      const row = document.createElement('div');
      row.className = 'row';
      for (const arm of LAND_RATIO_ARMS) {
        const r = runner.read(arm.id, pic.id, zoom);
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = runner.snapshot(arm.id, pic.id, zoom);
        img.width = 900;
        fig.appendChild(img);
        const cap = document.createElement('figcaption');
        cap.textContent =
          `${arm.id} — ${armCaption(arm.id)} · ${countsCaption(r.counts, r.land, pic.id)} · ${r.pxPerUnit.toFixed(3)} px/unit · ` +
          `island ${r.island.w.toFixed(0)}×${r.island.d.toFixed(0)} units, on screen ${r.screen.wPx.toFixed(0)}×${r.screen.hPx.toFixed(0)} px · pine ${r.pineHeightPx.toFixed(0)} px tall · ` +
          `land ${(r.landShare * 100).toFixed(2)}% of the frame · ${r.families} families · MICRO ${r.stats.micro.toFixed(2)} · moved>${VISIBLE_DELTA} vs today ${r.visible.toLocaleString()}`;
        fig.appendChild(cap);
        row.appendChild(fig);
      }
      root.appendChild(row);
    }
  }
}

declare global {
  interface Window {
    landRatioRunner?: LandRatioRunner;
  }
}
