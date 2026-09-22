// shipped-spacing-scene.ts — THE FOREST'S SPACING AS A FRACTION OF ISLAND SIZE (ADR-0521), laddered
// on the REAL forest for the owner (increment `forest-spacing-derived-from-island-size` on
// `land-ground-stack-arc`).
//
//   today          the 2D map's layout AS IT STOOD before this landing — the three absolute gaps
//                  (40 / 60 / 140 units) the packer held, typed as history (CONTROL — every "moved" is vs this)
//   spacing-<r>    the same corpus laid out with every gap = r × the mean radius of the two islands it
//                  separates, and a lone island's swing = its radius + that gap (`apps/studio/src/lib/
//                  islandSpacing.ts`); the ladder descends to 0, which is the hex lattice's own floor
//
// ⚠⚠ THIS PAGE RENDERS THE REAL MAP'S LAYOUT, NOT A SYNTHETIC CROWD — and that is the whole difference
// from `shipped-land-ratio-scene.ts` next door. Every earlier "fitted forest" on this arc stood on
// `crowdLayout`, a grid of copies of one fixture island calibrated to a land share read off a PNG;
// it models density and knows nothing of the map's topology. The spacing IS the topology, so the
// arms here are the studio's own `buildWorld` output for the live corpus at each rung — exported by
// `apps/studio/scripts/export-spacing-scenes.mjs` through the `?sceneExport=1` bridge, pruned to
// what `worldTo3D` reads, and committed beside the evidence as
// `docs/research/chapter2-forest-spacing-2026-09-06/scenes/<arm>.json`. This page fetches them
// through the harness's fenced `/reference/` route and hands each to the SHIPPED 3D pipeline:
// `worldTo3D` at the shipped land ratio, `dressMapWithCover` with the canvas's own options,
// `shippedGroundBuild`, `buildGroundMaterial`. Nothing about the island moves between arms except
// where it stands.
//
// ⚠⚠ THE TWO PICTURES. `forest` fitted is the view the map opens on — the number that matters is the
// land's share of the frame (the "dots in a field" number) and of the forest's own bounding box (the
// number that isolates the spacing from the frame's aspect, since the real DAG is a tall column and
// the frame is a laptop). `one` at 8 px/unit is the read zoom, centred on the SAME island on every
// arm (`READ_ISLAND`, the real counterpart of the harness fixture): it shows the island is
// UNAFFECTED — same capability count, same land per capability, same trees — while its neighbours
// move. Its ring may differ in shape rung to rung: the 2D territory grows its tiles from a seed the
// spacing moved, and the growth jitter hashes the absolute hex key. Its AREA cannot: the mapper
// sizes it to capabilities × the shipped ratio (ADR-0520 D1), which the driver holds exact.
//
// ⚠ THE HEX FLOOR IS THE BOUND, AND THE LADDER SHOWS IT RATHER THAN ARGUING IT. Two 2D islands never
// interpenetrate: seeds closer than their combined ring reach are nudged apart whatever the gap
// says. So rung 0 is "as close as the tiles allow", and the water a 3D island (sized in place to a
// fraction of its tile footprint) can lose is bounded by the footprint, not by the ratio. What C
// removes is the share of the spacing the three constants held; what it cannot remove is the tile.
//
// ⚠ FRAME COST IS TAKEN HERE, AND IT REPORTS — IT DOES NOT GATE (ADR-0517 D4 / ADR-0520 D6). Every
// number moves because the forest's extent moves; it is recorded beside the sheet.
//
// THE PAGE ADOPTS NOTHING OF ITS OWN. `harness/` only: it produces EVIDENCE. The pick — the ratio —
// lands in `apps/studio/src/lib/islandSpacing.ts`, and the manifest records what it was when the
// scenes were exported.

import type { SceneG } from '@storytree/forest-world';
import * as THREE from 'three';

import { GROUND_ATLAS_ATTRIBUTE, GROUND_STATUS_ATTRIBUTE } from '../src/banded-ground-material.js';
import { cellGroundGeometry } from '../src/cell-ground-geometry.js';
import { COVER_DENSITY } from '../src/cover-dressing.js';
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
import { KIT_FOOTPRINTS_2026_08_29, KIT_HEIGHTS_2026_08_29, RENDER_ELEV_DEG, type KitPlacement } from '../src/kit-vocabulary.js';
import { LAND_AREA_PER_CAPABILITY, islandLand, sizeIslandsByCapability, type IslandLand } from '../src/land-per-capability.js';
import { LAND_RELIEF_AMPLITUDE } from '../src/land-relief.js';
import type { ShadowCaster } from '../src/land-shadow.js';
import {
  calibrateLights,
  intensitiesFor,
  type CalibratedIntensities,
  type LightCalibration,
} from '../src/light-calibration.js';
import { dressMapWithCover, type MapDressingOptions } from '../src/map-dressing.js';
import { KIT_PROP_INDIRECT_FRACTION } from '../src/prop-lighting.js';
import { islandCentres } from '../src/true-footprint.js';
import { worldTo3D, type InstanceDescriptor } from '../src/world-to-3d.js';
import { landStreamFromDrawing } from '../src/true-ground.js';
import { CROWD_VIEWPORT } from './crowd-layout.js';
import { GPU_TIMER_EXTENSION } from './frame-cost.js';
import { awaitQuery, readIdentity, type DisjointTimerQuery, type RendererIdentity } from './frame-cost-scene.js';
import { KIT_ASSET_URL, kitMeshes, loadKit, setKitPropLighting, type LoadedKit } from './kit-scene.js';
import { SHIPPED_LIGHTING } from './shipped-baseline.js';
import { FIT_ZOOM, orientedCamera, type CrowdZoom } from './shipped-crowd-scene.js';
import { kitFacts, type KitFacts } from './shipped-detail-scene.js';
import { backgroundBytes, familyCensus } from './shipped-grass-scene.js';
import {
  FIT_MARGIN,
  deliveredPineHeightPx,
  dressingCounts,
  groundDepth,
  landBox,
  screenExtent,
  type DressingCounts,
  type GroundExtent,
  type PixelBox,
  type ScreenExtent,
} from './shipped-land-ratio-scene.js';
import { imageStats, type ImageStats } from './shipped-skirt-scene.js';
import { VISIBLE_DELTA, sensitivityReasons, visibleDeltaDistribution, type VisibleDeltaReading } from './visible-delta.js';

export { VISIBLE_DELTA };

// ---------------------------------------------------------------- the exported layouts

/** Where the export driver writes the scenes, relative to `docs/research/` — served by the harness's
 *  fenced `/reference/` route (`vite.config.ts`), the same route the approved render rides. */
export const SPACING_EVIDENCE_DIR = 'chapter2-forest-spacing-2026-09-06';
export const SPACING_SCENES_ROUTE = `/reference/${SPACING_EVIDENCE_DIR}/scenes`;

/**
 * THE LAND CAMERA THIS EVIDENCE WAS DRAWN AT — a FACT ABOUT THE COMMITTED FILE, frozen the moment
 * `manifest.json` was generated (2026-09-05T22:24:25Z), and independent of whatever
 * `LAND_CAMERA_ELEVATION_DEG` reads today.
 *
 * ⚠⚠ WHY THIS EXISTS AT ALL, AND WHY IT IS A LITERAL RATHER THAN THE LIVE CONSTANT. Every `d` path
 * coordinate in these committed scenes was squashed by `sin` of WHATEVER THE LAND CAMERA WAS THE DAY
 * THIS EXPORT RAN — 20 degrees, the only value `LAND_CAMERA_ELEVATION_DEG` had ever held before
 * ADR-0593 D1 moved it to 50. `landStreamFromDrawing`'s `elevationDeg` parameter defaults to the
 * LIVE constant specifically so a caller building a drawing THIS INSTANT can omit it — but that
 * default is the wrong answer for a file that was written on a DIFFERENT instant. Passing it
 * anyway un-projects a 20-degree-squashed drawing by `1 / sin(50 deg)` instead of `1 / sin(20
 * deg)`, which neither recovers the true footprint nor reproduces the drawing — it lands on a
 * residual squash of `sin(20 deg) / sin(50 deg)` ~= 0.4466 relative to true, which is why every
 * island in this evidence came back a squashed 0.458-aspect ribbon instead of the roughly-square
 * (~1.03) shape the recipe actually drew, the moment `LAND_CAMERA_ELEVATION_DEG` first moved.
 * `armStream` (below) and `shipped-island-floor-scene.ts`'s `drawnStream` both pin to this constant
 * rather than the live one for exactly that reason — a frozen export un-projects at the elevation
 * IT WAS DRAWN AT, never at whatever the caller's camera happens to be today.
 */
export const SPACING_EVIDENCE_ELEVATION_DEG = 20;

/** The island every `one` picture is centred on — the real story the harness fixture is shaped after. */
export const READ_ISLAND = 'context-traversal-capture';

export const SPACING_CONTROL_ARM = 'today';

/** The three pre-ADR-0521 absolute gaps, as the export records them on the control arm. */
export interface LegacySpacing {
  rankGap: number;
  islandGap: number;
  rankSwing: number;
}

/** One arm as the export driver recorded it in `manifest.json`. */
export interface SpacingArmRecord {
  id: string;
  spacing: { ratio?: number; legacy?: LegacySpacing };
  file: string;
  islands: number;
  world: { width: number; height: number };
  trails: { edges: number; segments: number; caves: number; dropped: ReadonlyArray<{ from: string; to: string }> };
  bytes: number;
}

export interface SpacingManifest {
  generatedAt: string;
  studio: { url: string; head: string; branch: string };
  /** `ISLAND_SPACING_RATIO` in `apps/studio/src/lib/islandSpacing.ts` when the scenes were exported. */
  shippedRatio: number;
  rungs: readonly number[];
  control: string;
  arms: SpacingArmRecord[];
}

/** What one exported scene file carries: the pruned scene graph and the 2D layout's bookkeeping. */
export interface SpacingSceneFile {
  scene: SceneG;
  spacing: { ratio?: number; legacy?: LegacySpacing };
  world: {
    width: number;
    height: number;
    offset: { x: number; y: number };
    islands: ReadonlyArray<{ id: string; centroid: { x: number; y: number }; groundRadius: number; capabilities: number; tiles: number }>;
  };
  trails: SpacingArmRecord['trails'];
}

export interface SpacingArm {
  record: SpacingArmRecord;
  file: SpacingSceneFile;
}

export type FetchJson = (url: string) => Promise<unknown>;

/** The manifest must name a control and at least one rung, every arm a file — refused otherwise
 *  rather than rendering a ladder with a missing rung and calling it the ladder. */
export function validateManifest(m: unknown): SpacingManifest {
  const bad = (why: string): never => {
    throw new Error(`shipped-spacing-scene: manifest.json is not a spacing ladder — ${why}`);
  };
  if (typeof m !== 'object' || m === null) return bad('not an object');
  const o = m as Partial<SpacingManifest>;
  if (!Array.isArray(o.arms) || o.arms.length < 2) return bad('fewer than two arms');
  if (typeof o.control !== 'string' || !o.arms.some((a) => a.id === o.control)) return bad('no control arm');
  if (typeof o.shippedRatio !== 'number') return bad('no shippedRatio');
  if (!Array.isArray(o.rungs) || o.rungs.length === 0) return bad('no rungs');
  for (const a of o.arms) {
    if (typeof a.id !== 'string' || typeof a.file !== 'string') return bad(`arm ${JSON.stringify(a)} has no id/file`);
    if (a.id !== o.control && typeof a.spacing?.ratio !== 'number') return bad(`arm ${a.id} carries no ratio`);
    if (a.id === o.control && a.spacing?.legacy === undefined) return bad('the control carries no legacy triple');
  }
  const ratios = o.arms.filter((a) => a.id !== o.control).map((a) => a.spacing.ratio as number);
  for (let i = 1; i < ratios.length; i += 1) {
    if (ratios[i]! >= ratios[i - 1]!) return bad(`the ladder does not descend (${ratios.join(' / ')})`);
  }
  return o as SpacingManifest;
}

export async function loadSpacingArms(fetchJson: FetchJson, route: string = SPACING_SCENES_ROUTE): Promise<{ manifest: SpacingManifest; arms: SpacingArm[] }> {
  const manifest = validateManifest(await fetchJson(`${route}/manifest.json`));
  const arms: SpacingArm[] = [];
  for (const record of manifest.arms) {
    const file = (await fetchJson(`${route}/${record.file}`)) as SpacingSceneFile;
    if (typeof file !== 'object' || file === null || file.scene?.el !== 'g') {
      throw new Error(`shipped-spacing-scene: ${record.file} carries no scene graph`);
    }
    arms.push({ record, file });
  }
  return { manifest, arms };
}

/** The arm one step UP the ladder (more spacing) — the control above the top rung; null for the control. */
export function neighbourArm(arms: readonly SpacingArm[], id: string): string | null {
  const i = arms.findIndex((a) => a.record.id === id);
  if (i <= 0) return null;
  return arms[i - 1]!.record.id;
}

export function armCaption(arm: SpacingArm, shippedRatio: number): string {
  const s = arm.record.spacing;
  if (s.legacy !== undefined) {
    return `the 2D map as it stood before this landing — gaps ${s.legacy.rankGap} / ${s.legacy.islandGap} / swing ${s.legacy.rankSwing} units, absolute — TODAY (CONTROL)`;
  }
  const tag = s.ratio === shippedRatio ? ' — THE SHIPPED PICK' : s.ratio === 0 ? ' — the hex lattice’s own floor; the boldest rung' : '';
  return `every gap ${s.ratio} × the mean radius of the two islands it separates; a lone island swings by its radius + that gap${tag}`;
}

// ---------------------------------------------------------------- what each arm stands

const streamMemo = new Map<string, InstanceDescriptor[]>();

/** The whole forest through the shipped mapper at the SHIPPED land ratio — what `ForestWorldCanvas`
 *  would be handed for this layout. Skips are dropped; nothing else is filtered. */
export function armStream(arm: SpacingArm): InstanceDescriptor[] {
  const hit = streamMemo.get(arm.record.id);
  if (hit !== undefined) return hit;
  // ⚠ THE COMMITTED SCENE IS A 2D DRAWING and the mapper stopped repairing one (ADR-0546 D1), so it
  // is converted at the reader — un-projected about the origin, which is what puts the forest in
  // the corridor the owner accepted — and only THEN sized. `true-ground.ts` carries the why and
  // owns the ORDER: this page used to spell the three steps itself, and spells them through the
  // shared function since 2026-09-08 so the studio's land view and this page cannot drift into two
  // pipelines that look alike.
  //
  // ⚠ PINNED TO `SPACING_EVIDENCE_ELEVATION_DEG`, NEVER THE LIVE DEFAULT — see that constant's own
  // comment. This file is read off disk, drawn at whatever the land camera was the day it was
  // exported; un-projecting it at today's camera instead recovers neither the drawing nor the true
  // footprint.
  const built = landStreamFromDrawing(arm.file.scene, SPACING_EVIDENCE_ELEVATION_DEG).filter(
    (d): d is InstanceDescriptor => d.kind !== 'skipped',
  );
  streamMemo.set(arm.record.id, built);
  return built;
}

/** The canvas's own dressing options (`ForestWorldCanvas.tsx`), stated once — the shipped cover rung. */
const CANVAS_OPTIONS: MapDressingOptions = {
  relief: LAND_RELIEF_AMPLITUDE,
  footprint: KIT_FOOTPRINTS_2026_08_29,
  coverDensity: COVER_DENSITY,
};

const placementMemo = new Map<string, KitPlacement[]>();

export function armPlacements(arm: SpacingArm): KitPlacement[] {
  const hit = placementMemo.get(arm.record.id);
  if (hit !== undefined) return hit;
  const built = dressMapWithCover(armStream(arm), CANVAS_OPTIONS);
  placementMemo.set(arm.record.id, built);
  return built;
}

export function armCasters(arm: SpacingArm): ShadowCaster[] {
  return [
    ...groundCasters(armStream(arm)),
    ...placementCasters(armPlacements(arm), KIT_FOOTPRINTS_2026_08_29, KIT_HEIGHTS_2026_08_29),
  ];
}

const groundBuildMemo = new Map<string, ShippedGroundBuild>();

/** THE SHIPPED GROUND for this layout — `shippedGroundBuild`, the function `CellGround` calls. */
export function armGroundBuild(arm: SpacingArm): ShippedGroundBuild {
  const hit = groundBuildMemo.get(arm.record.id);
  if (hit !== undefined) return hit;
  const stream = armStream(arm);
  const built = shippedGroundBuild(
    stream.filter((d) => d.kind === 'cell-ground'),
    armCasters(arm),
    stream.filter((d) => d.kind === 'trail-strip'),
  );
  groundBuildMemo.set(arm.record.id, built);
  return built;
}

// ---------------------------------------------------------------- the layout, in numbers

export interface IslandFootprint {
  id: string;
  centre: { x: number; z: number };
  /** Half the island's ground width / depth — its own extent, not the tile footprint. */
  halfW: number;
  halfD: number;
  land: IslandLand;
}

/** Every island's centre and half-extents, read off its `cell-ground` rings. */
export function islandFootprints(stream: readonly InstanceDescriptor[]): IslandFootprint[] {
  const centres = islandCentres(stream);
  const land = islandLand(stream);
  const out: IslandFootprint[] = [];
  for (const [id, c] of centres) {
    const cells = stream.filter((d) => d.kind === 'cell-ground' && d.island === id);
    const e = groundDepth(cells);
    const l = land.get(id);
    if (l === undefined) continue;
    out.push({ id, centre: { x: c.x, z: c.z }, halfW: e.w / 2, halfD: e.d / 2, land: l });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export interface NearestPair {
  a: string;
  b: string;
  /** Centre to centre, in ground units. */
  distance: number;
  /** The open water between the two islands' extents along the line between their centres —
   *  negative would mean the 3D islands overlap, which the driver refuses. */
  water: number;
}

/** The closest two islands, by centre distance — where the forest is tightest. */
export function nearestPair(footprints: readonly IslandFootprint[]): NearestPair {
  let best: NearestPair | null = null;
  for (let i = 0; i < footprints.length; i += 1) {
    for (let j = i + 1; j < footprints.length; j += 1) {
      const p = footprints[i]!;
      const q = footprints[j]!;
      const dx = q.centre.x - p.centre.x;
      const dz = q.centre.z - p.centre.z;
      const distance = Math.hypot(dx, dz);
      if (best !== null && distance >= best.distance) continue;
      // each island's reach along the pair's own direction, from its axis-aligned half-extents
      const ux = distance === 0 ? 1 : dx / distance;
      const uz = distance === 0 ? 0 : dz / distance;
      const reach = (f: IslandFootprint): number => Math.abs(ux) * f.halfW + Math.abs(uz) * f.halfD;
      best = { a: p.id, b: q.id, distance, water: distance - reach(p) - reach(q) };
    }
  }
  if (best === null) throw new Error('shipped-spacing-scene: fewer than two islands');
  return best;
}

/**
 * THE TIGHTEST TWO ISLANDS BY THEIR ACTUAL RINGS — not by bounding boxes. {@link nearestPair}'s
 * water is the gap between two axis-aligned extents along the pair's line, which OVERSTATES how close
 * two lobed islands stand once they are near each other (a box's corner reaches where no land is) and
 * cannot tell touching from overlapping. This reads the rings: `water` is the smallest distance
 * between a vertex of one island's ground and a vertex of the other's, and `overlap` is whether a
 * vertex of either stands INSIDE a ground cell of the other. On the tile ladder (ADR-0528 D5) the
 * lattice floor puts neighbours side by side, and this is the number that says whether a rung's
 * neighbours still keep water between them.
 */
export interface TightestPair {
  a: string;
  b: string;
  /** Centre to centre, in ground units. */
  centres: number;
  /** The smallest vertex-to-vertex gap between the two islands' rings — 0 when they overlap. */
  water: number;
  /** A vertex of one island stands inside a ground cell of the other. */
  overlap: boolean;
}

function pointInRing(x: number, z: number, ring: ReadonlyArray<{ x: number; z: number }>): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

export function tightestPair(stream: readonly InstanceDescriptor[]): TightestPair {
  const rings = new Map<string, Array<ReadonlyArray<{ x: number; z: number }>>>();
  const centres = islandCentres(stream);
  for (const d of stream) {
    if (d.kind !== 'cell-ground' || d.island === undefined || !d.points?.length) continue;
    const list = rings.get(d.island) ?? [];
    list.push(d.points.map((p) => ({ x: p.x, z: p.z })));
    rings.set(d.island, list);
  }
  const ids = [...rings.keys()].sort();
  if (ids.length < 2) throw new Error('shipped-spacing-scene: fewer than two islands');
  const verts = new Map(ids.map((id) => [id, rings.get(id)!.flat()]));
  // each island's reach from its centre — a pair whose centres are further apart than the best
  // water so far plus both reaches cannot beat it, which is what keeps the vertex sweep cheap
  const reach = new Map(
    ids.map((id) => {
      const c = centres.get(id) ?? { x: 0, z: 0 };
      return [id, Math.max(0, ...verts.get(id)!.map((p) => Math.hypot(p.x - c.x, p.z - c.z)))];
    }),
  );
  let best: TightestPair | null = null;
  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const a = ids[i]!;
      const b = ids[j]!;
      const ca = centres.get(a);
      const cb = centres.get(b);
      if (!ca || !cb) continue;
      const dc = Math.hypot(cb.x - ca.x, cb.z - ca.z);
      if (best !== null && dc - reach.get(a)! - reach.get(b)! > best.water) continue;
      let water = Infinity;
      for (const p of verts.get(a)!) {
        for (const q of verts.get(b)!) {
          const dd = Math.hypot(p.x - q.x, p.z - q.z);
          if (dd < water) water = dd;
        }
      }
      if (best !== null && water >= best.water) continue;
      const overlap =
        verts.get(a)!.some((p) => rings.get(b)!.some((r) => pointInRing(p.x, p.z, r))) ||
        verts.get(b)!.some((p) => rings.get(a)!.some((r) => pointInRing(p.x, p.z, r)));
      best = { a, b, centres: dc, water: overlap ? 0 : water, overlap };
    }
  }
  return best!;
}

export interface ForestBounds {
  /** The bounding box of every island CENTRE, in ground units — the layout's own extent. */
  centres: { w: number; d: number };
  /** The bounding box of every ground vertex — what the fit frames. */
  ground: GroundExtent;
  /** Land per capability on every island — must be the shipped ratio on every arm. */
  unitsPerCapability: { min: number; max: number };
  islands: number;
  totalLand: number;
}

export function forestBounds(stream: readonly InstanceDescriptor[]): ForestBounds {
  const fps = islandFootprints(stream);
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let lo = Infinity;
  let hi = -Infinity;
  let land = 0;
  for (const f of fps) {
    minX = Math.min(minX, f.centre.x);
    maxX = Math.max(maxX, f.centre.x);
    minZ = Math.min(minZ, f.centre.z);
    maxZ = Math.max(maxZ, f.centre.z);
    land += f.land.area;
    if (f.land.capabilities > 0) {
      const per = f.land.area / f.land.capabilities;
      lo = Math.min(lo, per);
      hi = Math.max(hi, per);
    }
  }
  return {
    centres: { w: maxX - minX, d: maxZ - minZ },
    ground: groundDepth(stream.filter((d) => d.kind === 'cell-ground')),
    unitsPerCapability: { min: lo, max: hi },
    islands: fps.length,
    totalLand: land,
  };
}

// ---------------------------------------------------------------- the camera

/**
 * THE ELEVATION THE CAMERA ACTUALLY LOOKS DOWN AT, from its world direction — not from its position.
 *
 * ⚠ The land-ratio page's elevation reader normalises the camera's POSITION, which is the view
 * direction only when the target is the origin — true of every crowd page, whose forest is re-centred
 * there, and FALSE here, where the camera is aimed at wherever the 2D drawing put the forest. Read
 * through that helper an off-origin camera at the signed 50° reported 40.7°, and the driver correctly
 * refused the whole run. This reads the direction the camera looks along, the same 50° at any target.
 */
export function viewElevationDeg(camera: THREE.Camera): number {
  const d = new THREE.Vector3();
  camera.getWorldDirection(d);
  return (Math.atan2(-d.y, Math.hypot(d.x, d.z)) * 180) / Math.PI;
}

export interface Fit {
  centre: { x: number; z: number };
  pxPerUnit: number;
  /** The ground's extent in camera space at the fitted centre — centred to within rounding. */
  extent: ScreenExtent;
}

/**
 * FIT THE WHOLE FOREST INTO THE BUFFER, CENTRED ON IT — not on the origin. The crowd pages fit about
 * the origin because their forest is re-centred there; the real layout is wherever the 2D drawing
 * put it, so the camera is aimed at the ground's own screen-space midpoint (two passes: measure the
 * extent from the ground's centre, then move the target by the midpoint — along camera-right on x,
 * and along ground depth by the vertical midpoint undone through the elevation's sine, since a
 * point further away sits higher on screen). The margin is the crowd page's own 40 ground units.
 */
export function fitCamera(positions: ArrayLike<number>): Fit {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    minX = Math.min(minX, positions[i]!);
    maxX = Math.max(maxX, positions[i]!);
    minZ = Math.min(minZ, positions[i + 2]!);
    maxZ = Math.max(maxZ, positions[i + 2]!);
  }
  const c0 = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 };
  const probe = orientedCamera(c0, 1);
  const e0 = screenExtent(positions, probe);
  const sinElev = Math.sin((viewElevationDeg(probe) * Math.PI) / 180);
  const centre = { x: c0.x + (e0.minX + e0.maxX) / 2, z: c0.z - (e0.minY + e0.maxY) / 2 / sinElev };
  const cam = orientedCamera(centre, 1);
  const extent = screenExtent(positions, cam);
  const halfW = (extent.maxX - extent.minX) / 2 + FIT_MARGIN;
  const halfH = (extent.maxY - extent.minY) / 2 + FIT_MARGIN;
  const pxPerUnit = Math.min(CROWD_VIEWPORT.w / 2 / halfW, CROWD_VIEWPORT.h / 2 / halfH);
  return { centre, pxPerUnit, extent };
}

// ---------------------------------------------------------------- the scene

export type SpacingPictureId = 'forest' | 'one';

export interface SpacingPicture {
  id: SpacingPictureId;
  what: string;
}

export const SPACING_PICTURES: readonly SpacingPicture[] = [
  { id: 'forest', what: 'the whole real forest, fitted — the view the map opens on' },
  { id: 'one', what: `one island (${READ_ISLAND}) at the read zoom — the same island on every arm` },
];

export function picture(id: SpacingPictureId): SpacingPicture {
  const found = SPACING_PICTURES.find((p) => p.id === id);
  if (!found) throw new Error(`shipped-spacing-scene: no picture "${id}"`);
  return found;
}

export const SPACING_READ_ZOOM = 8;

/** The (picture, zoom) pairs rendered: the forest fitted, the read island at 8 px/unit. */
export const SPACING_SHOTS: ReadonlyArray<{ picture: SpacingPictureId; zoom: CrowdZoom }> = [
  { picture: 'forest', zoom: FIT_ZOOM },
  { picture: 'one', zoom: SPACING_READ_ZOOM },
];

export interface SpacingScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  width: number;
  height: number;
  pxPerUnit: number;
  arm: SpacingArm;
  groundTriangles: number;
  bounds: ForestBounds;
  nearest: NearestPair;
  tightest: TightestPair;
  read: IslandFootprint;
  screen: ScreenExtent;
  counts: DressingCounts;
  casters: number;
  meshes: number;
}

/** ONE ARM'S SCENE in one picture: its ground build and placements, the shipped camera, nothing else free. */
export function buildSpacingScene(kit: LoadedKit, lit: CalibratedIntensities, arm: SpacingArm, pic: SpacingPicture, zoom: CrowdZoom): SpacingScene {
  const build = armGroundBuild(arm);
  const geo = cellGroundGeometry(build.input);
  if (geo.triangles === 0) throw new Error(`shipped-spacing-scene: ${arm.record.id} drew no ground`);
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
  const placements = armPlacements(arm);
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

  const stream = armStream(arm);
  const footprints = islandFootprints(stream);
  const read = footprints.find((f) => f.id === READ_ISLAND);
  if (read === undefined) throw new Error(`shipped-spacing-scene: ${arm.record.id} has no island "${READ_ISLAND}" to centre the read zoom on`);
  let camera: THREE.OrthographicCamera;
  let pxPerUnit: number;
  if (pic.id === 'forest') {
    const fit = fitCamera(geo.positions);
    pxPerUnit = zoom === FIT_ZOOM ? fit.pxPerUnit : zoom;
    camera = orientedCamera(fit.centre, pxPerUnit);
  } else {
    pxPerUnit = zoom === FIT_ZOOM ? fitCamera(geo.positions).pxPerUnit : zoom;
    camera = orientedCamera(read.centre, pxPerUnit);
  }
  return {
    scene,
    camera,
    width: CROWD_VIEWPORT.w,
    height: CROWD_VIEWPORT.h,
    pxPerUnit,
    arm,
    groundTriangles: geo.triangles,
    bounds: forestBounds(stream),
    nearest: nearestPair(footprints),
    tightest: tightestPair(stream),
    read,
    screen: screenExtent(geo.positions, camera),
    counts: dressingCounts(placements, stream),
    casters: armCasters(arm).length,
    meshes,
  };
}

// ---------------------------------------------------------------- the readings

export interface SpacingReading {
  arm: string;
  ratio: number | null;
  elevationDeg: number;
  pxPerUnit: number;
  drawCalls: number;
  triangles: number;
  groundTriangles: number;
  counts: DressingCounts;
  bounds: ForestBounds;
  nearest: NearestPair;
  /** The tightest two islands by their actual rings — the honest water at a rung (see {@link TightestPair}). */
  tightest: TightestPair;
  /** The read island: its land, capabilities and extent — the same on every arm, to the driver's tolerance. */
  read: { id: string; capabilities: number; landArea: number; unitsPerCapability: number; w: number; d: number };
  casters: number;
  meshes: number;
  screen: { w: number; h: number; wPx: number; hPx: number };
  box: PixelBox;
  pineHeightPx: number;
  stats: ImageStats;
  landPx: number;
  /** Land pixels as a share of the WHOLE frame — on the fitted forest, the "dots in a field" number. */
  landShare: number;
  /** Land pixels as a share of the land's own bounding box on screen — the spacing, with the frame's aspect taken out. */
  landShareOfBox: number;
  families: number;
  /** Against the CONTROL at the same picture and zoom. `touched` is context only (ADR-0490 D6). */
  touched: number;
  visible: number;
  delta: VisibleDeltaReading;
  /** Against the arm one step up the ladder (null for the control). */
  visibleVsNeighbour: number | null;
  /** The 2D layout's own bookkeeping, from the export: trails routed and dropped at this rung. */
  trails: SpacingArmRecord['trails'];
}

export interface SpacingCostSpec {
  arm: string;
  picture: SpacingPictureId;
  zoom: CrowdZoom;
  batch: number;
}

export interface SpacingCostReading extends SpacingCostSpec {
  gpuMsPerFrame: number | null;
  gpuBatchNs: number | null;
  disjoint: boolean;
  drawCalls: number;
  triangles: number;
  timerQueryAvailable: boolean;
  hidden: boolean;
}

export interface SpacingRunner {
  manifest(): SpacingManifest;
  arms(): string[];
  identity(): RendererIdentity;
  calibration(): LightCalibration;
  kits(): KitFacts[];
  warm(): void;
  read(arm: string, picture: SpacingPictureId, zoom: CrowdZoom): SpacingReading;
  sensitivity(picture: SpacingPictureId, zoom: CrowdZoom): string[];
  /** The frame cost of one arm on the GPU's own clock — a REPORT (ADR-0517 D4). */
  cost(spec: SpacingCostSpec): Promise<SpacingCostReading>;
  snapshot(arm: string, picture: SpacingPictureId, zoom: CrowdZoom): string;
}

export async function fetchJsonFromPage(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`shipped-spacing-scene: ${url} answered ${res.status} — run the export driver first, and serve the harness from THIS worktree`);
  return res.json();
}

/** How a runner finds its arms — the spacing ladder by default; the tile page (`shipped-tile-scene.ts`)
 *  passes its own loader, because its manifest carries a tile per arm and a control that is NOT the
 *  legacy triple. Everything downstream of the load — the shipped pipeline, the readings, the cost
 *  clock — is the same instrument, which is the point: two ladders, one ruler. */
export type ArmLoader = (fetchJson: FetchJson) => Promise<{ manifest: SpacingManifest; arms: SpacingArm[] }>;

export async function createSpacingRunner(fetchJson: FetchJson = fetchJsonFromPage, load: ArmLoader = loadSpacingArms): Promise<SpacingRunner> {
  const { manifest, arms } = await load(fetchJson);
  const armOf = (id: string): SpacingArm => {
    const found = arms.find((a) => a.record.id === id);
    if (!found) throw new Error(`shipped-spacing-scene: no arm "${id}"`);
    return found;
  };
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
  const cache = new Map<string, SpacingScene>();
  const sceneFor = (arm: string, pic: SpacingPictureId, zoom: CrowdZoom): SpacingScene => {
    const k = `${arm}|${pic}|${String(zoom)}`;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const built = buildSpacingScene(kit, lit, armOf(arm), picture(pic), zoom);
    cache.set(k, built);
    return built;
  };
  const render = (arm: string, pic: SpacingPictureId, zoom: CrowdZoom): SpacingScene => {
    const s = sceneFor(arm, pic, zoom);
    renderer.setSize(s.width, s.height, false);
    renderer.render(s.scene, s.camera);
    return s;
  };
  const pixelMemo = new Map<string, Uint8ClampedArray>();
  const pixels = (arm: string, pic: SpacingPictureId, zoom: CrowdZoom): Uint8ClampedArray => {
    const k = `${arm}|${pic}|${String(zoom)}`;
    const hit = pixelMemo.get(k);
    if (hit !== undefined) return hit;
    const s = render(arm, pic, zoom);
    const buf = new Uint8Array(s.width * s.height * 4);
    gl.readPixels(0, 0, s.width, s.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const out = new Uint8ClampedArray(buf.buffer);
    pixelMemo.set(k, out);
    return out;
  };
  return {
    manifest: () => manifest,
    arms: () => arms.map((a) => a.record.id),
    identity: () => readIdentity(gl),
    calibration: () => cal,
    kits: () => facts,
    warm() {
      for (const arm of arms) render(arm.record.id, 'one', SPACING_READ_ZOOM);
    },
    read(arm, pic, zoom) {
      const s = render(arm, pic, zoom);
      const info = renderer.info.render;
      const drawCalls = info.calls;
      const triangles = info.triangles;
      const buf = pixels(arm, pic, zoom);
      const census = familyCensus(buf, bg);
      const delta = visibleDeltaDistribution(buf, pixels(manifest.control, pic, zoom));
      const neighbour = neighbourArm(arms, arm);
      const vsNeighbour = neighbour === null ? null : visibleDeltaDistribution(buf, pixels(neighbour, pic, zoom));
      const box = landBox(buf, s.width, s.height, bg);
      return {
        arm,
        ratio: s.arm.record.spacing.ratio ?? null,
        elevationDeg: viewElevationDeg(s.camera),
        pxPerUnit: s.pxPerUnit,
        drawCalls,
        triangles,
        groundTriangles: s.groundTriangles,
        counts: s.counts,
        bounds: s.bounds,
        nearest: s.nearest,
        tightest: s.tightest,
        read: {
          id: s.read.id,
          capabilities: s.read.land.capabilities,
          landArea: s.read.land.area,
          unitsPerCapability: s.read.land.capabilities === 0 ? 0 : s.read.land.area / s.read.land.capabilities,
          w: s.read.halfW * 2,
          d: s.read.halfD * 2,
        },
        casters: s.casters,
        meshes: s.meshes,
        screen: { w: s.screen.w, h: s.screen.h, wPx: s.screen.w * s.pxPerUnit, hPx: s.screen.h * s.pxPerUnit },
        box,
        pineHeightPx: deliveredPineHeightPx(s.pxPerUnit),
        stats: imageStats(buf, s.width, s.height, bg),
        landPx: census.land,
        landShare: census.land / (s.width * s.height),
        landShareOfBox: box.pixels === 0 ? 0 : census.land / (box.w * box.h),
        families: census.families,
        touched: delta.touched,
        visible: delta.visible,
        delta,
        visibleVsNeighbour: vsNeighbour === null ? null : vsNeighbour.visible,
        trails: s.arm.record.trails,
      };
    },
    sensitivity(pic, zoom) {
      return sensitivityReasons(pixels(manifest.control, pic, zoom));
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
  };
}

// ---------------------------------------------------------------- the page

export async function mountShippedSpacing(root: HTMLElement): Promise<void> {
  const runner = await createSpacingRunner();
  window.spacingRunner = runner;
  runner.warm();
  const id = runner.identity();
  const cal = runner.calibration();
  const m = runner.manifest();
  const head = document.createElement('p');
  head.className = 'numbers';
  head.textContent =
    `${id.vendor} — ${id.renderer} · software=${id.software} · light probe ${cal.probe.toFixed(3)} → scale ${cal.scale.toFixed(3)} · ` +
    `scenes exported ${m.generatedAt} from the studio at ${m.studio.head.slice(0, 8)} (${m.studio.branch}) · ` +
    `shipped spacing ratio ${m.shippedRatio} · land ${LAND_AREA_PER_CAPABILITY} units² per capability on every arm · ` +
    `signed elevation ${RENDER_ELEV_DEG}°`;
  root.appendChild(head);
  const { arms } = await loadSpacingArms(fetchJsonFromPage);
  for (const shot of SPACING_SHOTS) {
    const pic = picture(shot.picture);
    const h = document.createElement('h2');
    h.textContent = `${pic.id} — ${pic.what} — ${shot.zoom === FIT_ZOOM ? 'fitted (each arm at its own fit)' : `${shot.zoom} px/unit`}`;
    root.appendChild(h);
    const row = document.createElement('div');
    row.className = 'row';
    for (const arm of arms) {
      const r = runner.read(arm.record.id, pic.id, shot.zoom);
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = runner.snapshot(arm.record.id, pic.id, shot.zoom);
      img.width = 900;
      fig.appendChild(img);
      const cap = document.createElement('figcaption');
      cap.textContent =
        `${arm.record.id} — ${armCaption(arm, m.shippedRatio)} · ${r.bounds.islands} islands · centres span ${r.bounds.centres.w.toFixed(0)}×${r.bounds.centres.d.toFixed(0)} units · ` +
        `nearest pair ${r.nearest.a}↔${r.nearest.b} ${r.nearest.distance.toFixed(0)} units apart, ${r.nearest.water.toFixed(0)} of water · ` +
        `${r.pxPerUnit.toFixed(3)} px/unit · land ${(r.landShare * 100).toFixed(2)}% of the frame, ${(r.landShareOfBox * 100).toFixed(1)}% of its box · ` +
        `${r.counts.capabilityTrees} trees · pine ${r.pineHeightPx.toFixed(1)} px · trails ${r.trails.edges} routed / ${r.trails.dropped.length} dropped · moved>${VISIBLE_DELTA} vs today ${r.visible.toLocaleString()}`;
      fig.appendChild(cap);
      row.appendChild(fig);
    }
    root.appendChild(row);
  }
}

declare global {
  interface Window {
    spacingRunner?: SpacingRunner;
  }
}
