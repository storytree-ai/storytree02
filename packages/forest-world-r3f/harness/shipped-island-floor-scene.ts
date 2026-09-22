// shipped-island-floor-scene.ts — ONE HEX IS THE MINIMUM: the zero-capability islands, before and
// after the floor, on the REAL forest (owner feedback 2026-09-06 on `land-ground-stack-arc`).
//
//   today          the mapper AS IT SHIPPED after ADR-0520: an island holding no capability was LEFT
//                  AS DRAWN — three hex tiles of the radius-27 lattice — while every island holding
//                  work shrank to `capabilities × 318` (CONTROL — every "moved" is vs this; the
//                  floor is typed as history, `floor: 0`)
//   shipped        the mapper as it ships now: an island is sized as if it held at least
//                  `LAND_FLOOR_CAPABILITIES` capabilities — one — so a story with no capabilities
//                  draws one capability's worth of land, the floor of the whole map
//
// ⚠⚠ THE OWNER'S DECISION, VERBATIM (2026-09-06): "no capabilities should just be 1 hex which should
// be the minimum." This page is the picture of that decision on the real map, with the reading the
// owner asked for printed per island — capability count and drawn area — so the fix is legible as
// a table and not only as a picture: is the biggest island the one with the most work in it, and
// are the smallest the ones with the least?
//
// ⚠⚠ THIS PAGE RENDERS THE REAL MAP'S LAYOUT: the studio's own `buildWorld` output for the live
// corpus, exported through the `?sceneExport=1` bridge and committed beside the spacing evidence
// (`shipped-spacing-scene.ts`'s loader; the SHIPPED rung of that ladder is the layout the map draws).
// Every arm is the same forest through the SHIPPED pipeline — `worldTo3D` at the drawing's size,
// then `sizeIslandsByCapability` at the shipped ratio with THIS arm's floor, then `dressMapWithCover`
// with the canvas's own options, `shippedGroundBuild`, `buildGroundMaterial`. The shipped arm is
// held to be byte-identical to a bare `worldTo3D(scene)` by `shipped-island-floor-scene.test.ts`.
//
// ⚠ THE FLOOR IS WRITTEN IN THE RATIO'S TERMS, so this page is correct on today's radius-27 drawing
// AND after ADR-0528's derived tile lands: a zero-capability island is sized to exactly
// `1 × LAND_AREA_PER_CAPABILITY` either way. What ADR-0528 changes is the 2D map's own tile — the
// studio's SVG still draws the zero-capability story at three tiles until it lands — and nothing
// on this page reaches the 2D map.
//
// THE PAGE ADOPTS NOTHING OF ITS OWN. `harness/` only: it produces EVIDENCE about the `src/` module
// it imports. The decision lands in `src/land-per-capability.ts` (`LAND_FLOOR_CAPABILITIES`).

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
import {
  LAND_AREA_PER_CAPABILITY,
  LAND_FLOOR_CAPABILITIES,
  islandLand,
  islandSizeInversions,
  sizeIslandsByCapability,
  type IslandLand,
  type IslandSizeInversion,
} from '../src/land-per-capability.js';
import { LAND_RELIEF_AMPLITUDE } from '../src/land-relief.js';
import type { ShadowCaster } from '../src/land-shadow.js';
import { calibrateLights, intensitiesFor, type CalibratedIntensities, type LightCalibration } from '../src/light-calibration.js';
import { dressMapWithCover, type MapDressingOptions } from '../src/map-dressing.js';
import { KIT_PROP_INDIRECT_FRACTION } from '../src/prop-lighting.js';
import { islandCentres } from '../src/true-footprint.js';
import { worldTo3D, type InstanceDescriptor } from '../src/world-to-3d.js';
import { trueGroundFromDrawing } from './frozen-drawing.js';
import { CROWD_VIEWPORT } from './crowd-layout.js';
import { readIdentity, type RendererIdentity } from './frame-cost-scene.js';
import { KIT_ASSET_URL, kitMeshes, loadKit, setKitPropLighting, type LoadedKit } from './kit-scene.js';
import { SHIPPED_LIGHTING } from './shipped-baseline.js';
import { FIT_ZOOM, orientedCamera, type CrowdZoom } from './shipped-crowd-scene.js';
import { kitFacts, type KitFacts } from './shipped-detail-scene.js';
import { backgroundBytes, familyCensus } from './shipped-grass-scene.js';
import { landBox, screenExtent, type PixelBox, type ScreenExtent } from './shipped-land-ratio-scene.js';
import {
  SPACING_EVIDENCE_ELEVATION_DEG,
  fitCamera,
  loadSpacingArms,
  viewElevationDeg,
  type Fit,
  type SpacingArm,
} from './shipped-spacing-scene.js';
import { shippedLayoutArm } from './shipped-wheat-scene.js';
import { VISIBLE_DELTA, sensitivityReasons, visibleDeltaDistribution, type VisibleDeltaReading } from './visible-delta.js';

export { VISIBLE_DELTA };

// ---------------------------------------------------------------- the arms

export interface FloorArmSpec {
  id: string;
  /** The fewest capabilities an island is sized as if it held. 0 is the rule as it stood. */
  floor: number;
}

export const FLOOR_CONTROL_ARM = 'today';
export const FLOOR_SHIPPED_ARM = 'shipped';

/** ⚠ THE CONTROL'S FLOOR IS TYPED AS HISTORY: the mapper before 2026-09-06 counted nothing an island
 *  did not hold, so a zero-capability island was left as drawn. It cannot be read off `src/` any more. */
export const PRE_FLOOR = 0;

export const FLOOR_ARMS: readonly FloorArmSpec[] = [
  { id: FLOOR_CONTROL_ARM, floor: PRE_FLOOR },
  { id: FLOOR_SHIPPED_ARM, floor: LAND_FLOOR_CAPABILITIES },
];

export function floorArmSpec(id: string): FloorArmSpec {
  const found = FLOOR_ARMS.find((a) => a.id === id);
  if (found === undefined) throw new Error(`shipped-island-floor-scene: no arm "${id}"`);
  return found;
}

export function floorArmCaption(id: string): string {
  const s = floorArmSpec(id);
  if (s.floor === 0) {
    return 'an island holding no capability LEFT AS DRAWN — three tiles of the radius-27 lattice — while every other island is sized to capabilities × 318 (CONTROL: the mapper as it shipped after ADR-0520)';
  }
  return `every island sized as if it held at least ${s.floor} capabilit${s.floor === 1 ? 'y' : 'ies'} — a story with none draws one capability’s worth of land, ${LAND_AREA_PER_CAPABILITY} units², the floor of the map (SHIPS)`;
}

// ---------------------------------------------------------------- the pictures

export type FloorPictureId = 'forest' | 'one';

export interface FloorPicture {
  id: FloorPictureId;
  what: string;
  zoom: CrowdZoom;
}

/** The zero-capability island the read zoom is centred on — one of the three the owner named
 *  (`proof-protocol`, `storage-protocol`, `website`); its centre does not move between arms. */
export const READ_ZERO_ISLAND = 'website';

export const FLOOR_READ_ZOOM = 8;

export const FLOOR_PICTURES: readonly FloorPicture[] = [
  { id: 'forest', what: 'the whole real forest, fitted — the view the map opens on, the SAME frame on both arms', zoom: FIT_ZOOM },
  { id: 'one', what: `the zero-capability island "${READ_ZERO_ISLAND}" and its neighbours at the read zoom`, zoom: FLOOR_READ_ZOOM },
];

export function floorPicture(id: FloorPictureId): FloorPicture {
  const found = FLOOR_PICTURES.find((p) => p.id === id);
  if (found === undefined) throw new Error(`shipped-island-floor-scene: no picture "${id}"`);
  return found;
}

export function floorArmsFor(_pic: FloorPictureId): readonly string[] {
  return FLOOR_ARMS.map((a) => a.id);
}

// ---------------------------------------------------------------- what each arm stands

/** THE DRAWING'S OWN SIZE — `worldTo3D` with the ratio switched off, the stream every arm's floor is
 *  applied to. Memoised per layout. */
const drawnMemo = new Map<string, InstanceDescriptor[]>();
export function drawnStream(layout: SpacingArm): InstanceDescriptor[] {
  const hit = drawnMemo.get(layout.record.id);
  if (hit !== undefined) return hit;
  // ⚠ THE COMMITTED SCENE IS A 2D DRAWING and the mapper stopped repairing one (ADR-0546 D1) —
  // converted at the reader, before any floor is applied. `frozen-drawing.ts` carries the why.
  //
  // ⚠ PINNED TO `SPACING_EVIDENCE_ELEVATION_DEG`, NEVER THE LIVE DEFAULT (see that constant's own
  // comment in `shipped-spacing-scene.ts`). `layout.file.scene` is this same evidence dir's
  // committed export, drawn at whatever the land camera was the day it was captured — un-projecting
  // it at today's camera instead recovers neither the drawing nor the true footprint.
  const built = trueGroundFromDrawing(
    worldTo3D(layout.file.scene, { landAreaPerCapability: null }),
    SPACING_EVIDENCE_ELEVATION_DEG,
  ).filter((d): d is InstanceDescriptor => d.kind !== 'skipped');
  drawnMemo.set(layout.record.id, built);
  return built;
}

/** THIS ARM'S STREAM: the drawing sized at the shipped ratio with this arm's floor — exactly what the
 *  shipped mapper delivers when the floor is the shipped one (held by the test). */
const streamMemo = new Map<string, InstanceDescriptor[]>();
export function floorArmStream(arm: string, layout: SpacingArm): InstanceDescriptor[] {
  const key = `${arm}|${layout.record.id}`;
  const hit = streamMemo.get(key);
  if (hit !== undefined) return hit;
  const built = sizeIslandsByCapability(drawnStream(layout), LAND_AREA_PER_CAPABILITY, floorArmSpec(arm).floor);
  streamMemo.set(key, built);
  return built;
}

/** The canvas's own dressing options (`ForestWorldCanvas.tsx`), stated once — the shipped cover rung. */
const CANVAS_OPTIONS: MapDressingOptions = {
  relief: LAND_RELIEF_AMPLITUDE,
  footprint: KIT_FOOTPRINTS_2026_08_29,
  coverDensity: COVER_DENSITY,
};

const placementMemo = new Map<string, KitPlacement[]>();
export function floorArmPlacements(arm: string, layout: SpacingArm): KitPlacement[] {
  const key = `${arm}|${layout.record.id}`;
  const hit = placementMemo.get(key);
  if (hit !== undefined) return hit;
  const built = dressMapWithCover(floorArmStream(arm, layout), CANVAS_OPTIONS);
  placementMemo.set(key, built);
  return built;
}

export function floorArmCasters(arm: string, layout: SpacingArm): ShadowCaster[] {
  return [
    ...groundCasters(floorArmStream(arm, layout)),
    ...placementCasters(floorArmPlacements(arm, layout), KIT_FOOTPRINTS_2026_08_29, KIT_HEIGHTS_2026_08_29),
  ];
}

export interface TimedGroundBuild {
  build: ShippedGroundBuild;
  buildMs: number;
  casters: number;
}

const buildMemo = new Map<string, TimedGroundBuild>();
/** THE SHIPPED GROUND for this arm — `shippedGroundBuild`, the function `CellGround` calls. */
export function floorArmGroundBuild(arm: string, layout: SpacingArm): TimedGroundBuild {
  const key = `${arm}|${layout.record.id}`;
  const hit = buildMemo.get(key);
  if (hit !== undefined) return hit;
  const stream = floorArmStream(arm, layout);
  const casters = floorArmCasters(arm, layout);
  const t0 = performance.now();
  const build = shippedGroundBuild(
    stream.filter((d) => d.kind === 'cell-ground'),
    casters,
    stream.filter((d) => d.kind === 'trail-strip'),
  );
  const timed = { build, buildMs: performance.now() - t0, casters: casters.length };
  buildMemo.set(key, timed);
  return timed;
}

// ---------------------------------------------------------------- the reading the owner asked for

/** One island, as the table prints it: what it holds, what the 2D drawing gave it, what it draws. */
export interface IslandRow {
  id: string;
  capabilities: number;
  /** The 2D export's own tile count for this island — `max(3, capabilities + 2)` on today's lattice. */
  tiles: number | null;
  /** Land at the drawing's size, units². */
  drawn: number;
  /** Land on this arm, units². */
  area: number;
  /** 1 = the largest island on this arm. */
  rank: number;
  /** Land per capability on this arm; `null` for an island holding none. */
  perCapability: number | null;
}

/** Every island on an arm, largest first, with its rank — read off the `cell-ground` rings. */
export function islandTable(arm: string, layout: SpacingArm): IslandRow[] {
  const drawn = islandLand(drawnStream(layout));
  const sized = islandLand(floorArmStream(arm, layout));
  const tiles = new Map(layout.file.world.islands.map((i) => [i.id, i.tiles]));
  const rows = [...sized.values()]
    .map((l): Omit<IslandRow, 'rank'> => ({
      id: l.island,
      capabilities: l.capabilities,
      tiles: tiles.get(l.island) ?? null,
      drawn: drawn.get(l.island)?.area ?? 0,
      area: l.area,
      perCapability: l.capabilities === 0 ? null : l.area / l.capabilities,
    }))
    .sort((a, b) => b.area - a.area || a.id.localeCompare(b.id));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

export interface FloorLandReading {
  arm: string;
  floor: number;
  islands: IslandRow[];
  /** Every pair drawn the wrong way round — fewer capabilities, more land. Empty is the invariant. */
  inversions: Array<{ smaller: string; smallerCapabilities: number; smallerArea: number; larger: string; largerCapabilities: number; largerArea: number }>;
  largest: IslandRow;
  smallest: IslandRow;
  /** The islands holding no capability, with their rank on this arm. */
  zero: IslandRow[];
  /** Does every island draw exactly `max(floor, capabilities) × ratio`? On the control the
   *  zero-capability islands do not (they are left as drawn), which is the finding. */
  ratioHeld: boolean;
  /** The largest error from that, units². */
  ratioError: number;
  totalLand: number;
  islandsCount: number;
}

export function floorLandReading(arm: string, layout: SpacingArm): FloorLandReading {
  const spec = floorArmSpec(arm);
  const rows = islandTable(arm, layout);
  if (rows.length === 0) throw new Error(`shipped-island-floor-scene: ${arm} stands no island`);
  const lands: IslandLand[] = rows.map((r) => ({ island: r.id, capabilities: r.capabilities, area: r.area }));
  const inversions = islandSizeInversions(lands).map((p: IslandSizeInversion) => ({
    smaller: p.smaller.island,
    smallerCapabilities: p.smaller.capabilities,
    smallerArea: p.smaller.area,
    larger: p.larger.island,
    largerCapabilities: p.larger.capabilities,
    largerArea: p.larger.area,
  }));
  let ratioError = 0;
  for (const r of rows) {
    const want = Math.max(spec.floor, r.capabilities) * LAND_AREA_PER_CAPABILITY;
    // A zero-capability island under a floor of 0 has no target — it is left as drawn by rule.
    if (Math.max(spec.floor, r.capabilities) === 0) continue;
    ratioError = Math.max(ratioError, Math.abs(r.area - want));
  }
  return {
    arm,
    floor: spec.floor,
    islands: rows,
    inversions,
    largest: rows[0]!,
    smallest: rows[rows.length - 1]!,
    zero: rows.filter((r) => r.capabilities === 0),
    ratioHeld: ratioError < 1e-6,
    ratioError,
    totalLand: rows.reduce((s, r) => s + r.area, 0),
    islandsCount: rows.length,
  };
}

// ---------------------------------------------------------------- the scene

export interface FloorScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  width: number;
  height: number;
  pxPerUnit: number;
  arm: string;
  groundTriangles: number;
  screen: ScreenExtent;
  meshes: number;
  buildMs: number;
  casters: number;
  placements: number;
}

function groundMesh(build: ShippedGroundBuild) {
  const geo = cellGroundGeometry(build.input);
  if (geo.triangles === 0) throw new Error('shipped-island-floor-scene: the arm drew no ground');
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
  // ⚠ THE SHIPPED BUILDER, HANDED NOTHING OF THIS PAGE'S OWN: every layer, the shadow and the wheat
  // as the map wears them. The arms differ in the STREAM, never in the material.
  const { material } = buildGroundMaterial(build.field, SHIPPED_GRASS, build.shore(), SHIPPED_SAND_MIX, extras);
  return { mesh: new THREE.Mesh(geometry, material), triangles: geo.triangles, positions: geo.positions };
}

function lightScene(scene: THREE.Scene, lit: CalibratedIntensities): void {
  scene.background = new THREE.Color(SHIPPED_LIGHTING.background);
  scene.add(new THREE.AmbientLight(0xffffff, lit.ambient));
  const sun = new THREE.DirectionalLight(0xffffff, lit.directional);
  const [lx, ly, lz] = SHIPPED_LIGHTING.directionalPosition;
  sun.position.set(lx, ly, lz);
  scene.add(sun);
}

/** THE FRAME BOTH ARMS SHARE: the control's fit, so a pixel between the two arms is the floor's and
 *  never a re-fitted camera's. Memoised per layout. */
const fitMemo = new Map<string, Fit>();
export function controlFit(layout: SpacingArm): Fit {
  const hit = fitMemo.get(layout.record.id);
  if (hit !== undefined) return hit;
  const geo = cellGroundGeometry(floorArmGroundBuild(FLOOR_CONTROL_ARM, layout).build.input);
  const fit = fitCamera(geo.positions);
  fitMemo.set(layout.record.id, fit);
  return fit;
}

/** The read island's centre — read off the DRAWING, which the floor scales about, so it is the
 *  same point on both arms. */
export function readIslandCentre(layout: SpacingArm) {
  const c = islandCentres(drawnStream(layout)).get(READ_ZERO_ISLAND);
  if (c === undefined) throw new Error(`shipped-island-floor-scene: the layout has no island "${READ_ZERO_ISLAND}" to centre the read zoom on`);
  return { x: c.x, z: c.z };
}

export function buildFloorScene(kit: LoadedKit, lit: CalibratedIntensities, arm: string, layout: SpacingArm, pic: FloorPicture): FloorScene {
  const timed = floorArmGroundBuild(arm, layout);
  const ground = groundMesh(timed.build);
  const scene = new THREE.Scene();
  scene.add(ground.mesh);
  const placements = floorArmPlacements(arm, layout);
  let meshes = 0;
  for (const mesh of kitMeshes(kit, placements)) {
    scene.add(mesh);
    meshes += 1;
  }
  lightScene(scene, lit);
  let camera: THREE.OrthographicCamera;
  let pxPerUnit: number;
  if (pic.id === 'forest') {
    const fit = controlFit(layout);
    pxPerUnit = fit.pxPerUnit;
    camera = orientedCamera(fit.centre, pxPerUnit);
  } else {
    pxPerUnit = pic.zoom === FIT_ZOOM ? controlFit(layout).pxPerUnit : pic.zoom;
    camera = orientedCamera(readIslandCentre(layout), pxPerUnit);
  }
  return {
    scene,
    camera,
    width: CROWD_VIEWPORT.w,
    height: CROWD_VIEWPORT.h,
    pxPerUnit,
    arm,
    groundTriangles: ground.triangles,
    screen: screenExtent(ground.positions, camera),
    meshes,
    buildMs: timed.buildMs,
    casters: timed.casters,
    placements: placements.length,
  };
}

// ---------------------------------------------------------------- the readings

export interface FloorReading {
  arm: string;
  floor: number;
  picture: FloorPictureId;
  elevationDeg: number;
  pxPerUnit: number;
  drawCalls: number;
  triangles: number;
  groundTriangles: number;
  meshes: number;
  placements: number;
  casters: number;
  buildMs: number;
  box: PixelBox;
  landPx: number;
  /** Land pixels as a share of the frame. */
  landShare: number;
  families: number;
  touched: number;
  visible: number;
  delta: VisibleDeltaReading;
  touchedVsShipped: number;
}

export interface FloorRunner {
  identity(): RendererIdentity;
  calibration(): LightCalibration;
  kits(): KitFacts[];
  layout(): { id: string; islands: number; head: string; generatedAt: string };
  warm(): void;
  read(arm: string, picture: FloorPictureId): FloorReading;
  land(arm: string): FloorLandReading;
  sensitivity(picture: FloorPictureId): string[];
  snapshot(arm: string, picture: FloorPictureId): string;
}

async function fetchJsonFromPage(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`shipped-island-floor-scene: ${url} answered ${res.status} — serve the harness from THIS worktree`);
  return res.json();
}

export async function createFloorRunner(): Promise<FloorRunner> {
  const { manifest, arms: layouts } = await loadSpacingArms(fetchJsonFromPage);
  const layout = shippedLayoutArm(layouts, manifest.shippedRatio);
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
  const bg = backgroundBytes();
  const cache = new Map<string, FloorScene>();
  const sceneFor = (arm: string, pic: FloorPictureId): FloorScene => {
    const k = `${arm}|${pic}`;
    const hit = cache.get(k);
    if (hit !== undefined) return hit;
    const built = buildFloorScene(kit, lit, arm, layout, floorPicture(pic));
    cache.set(k, built);
    return built;
  };
  const render = (arm: string, pic: FloorPictureId): FloorScene => {
    const s = sceneFor(arm, pic);
    renderer.setSize(s.width, s.height, false);
    renderer.render(s.scene, s.camera);
    return s;
  };
  const pixelMemo = new Map<string, Uint8ClampedArray>();
  const pixels = (arm: string, pic: FloorPictureId): Uint8ClampedArray => {
    const k = `${arm}|${pic}`;
    const hit = pixelMemo.get(k);
    if (hit !== undefined) return hit;
    const s = render(arm, pic);
    const buf = new Uint8Array(s.width * s.height * 4);
    gl.readPixels(0, 0, s.width, s.height, gl.RGBA, gl.UNSIGNED_BYTE, buf);
    const out = new Uint8ClampedArray(buf.buffer);
    pixelMemo.set(k, out);
    return out;
  };
  return {
    identity: () => readIdentity(gl),
    calibration: () => cal,
    kits: () => facts,
    layout: () => ({ id: layout.record.id, islands: layout.record.islands, head: manifest.studio.head, generatedAt: manifest.generatedAt }),
    warm() {
      for (const arm of floorArmsFor('forest')) render(arm, 'forest');
    },
    read(arm, pic) {
      const s = render(arm, pic);
      const info = renderer.info.render;
      const drawCalls = info.calls;
      const triangles = info.triangles;
      const buf = pixels(arm, pic);
      const census = familyCensus(buf, bg);
      const delta = visibleDeltaDistribution(buf, pixels(FLOOR_CONTROL_ARM, pic));
      const vsShipped = visibleDeltaDistribution(buf, pixels(FLOOR_SHIPPED_ARM, pic));
      return {
        arm,
        floor: floorArmSpec(arm).floor,
        picture: pic,
        elevationDeg: viewElevationDeg(s.camera),
        pxPerUnit: s.pxPerUnit,
        drawCalls,
        triangles,
        groundTriangles: s.groundTriangles,
        meshes: s.meshes,
        placements: s.placements,
        casters: s.casters,
        buildMs: s.buildMs,
        box: landBox(buf, s.width, s.height, bg),
        landPx: census.land,
        landShare: census.land / (s.width * s.height),
        families: census.families,
        touched: delta.touched,
        visible: delta.visible,
        delta,
        touchedVsShipped: vsShipped.touched,
      };
    },
    land: (arm) => floorLandReading(arm, layout),
    sensitivity(pic) {
      return sensitivityReasons(pixels(FLOOR_CONTROL_ARM, pic));
    },
    snapshot(arm, pic) {
      render(arm, pic);
      return canvas.toDataURL('image/png');
    },
  };
}

// ---------------------------------------------------------------- the page

export async function mountShippedIslandFloor(root: HTMLElement): Promise<void> {
  const runner = await createFloorRunner();
  window.islandFloorRunner = runner;
  runner.warm();
  const id = runner.identity();
  const cal = runner.calibration();
  const layout = runner.layout();
  const head = document.createElement('p');
  head.className = 'numbers';
  head.textContent =
    `${id.vendor} — ${id.renderer} · software=${id.software} · light probe ${cal.probe.toFixed(3)} → scale ${cal.scale.toFixed(3)} onto the ladder’s ${cal.target} · ` +
    `signed ${RENDER_ELEV_DEG}° · layout ${layout.id} (${layout.islands} islands, studio ${layout.head.slice(0, 8)}) · ` +
    `${LAND_AREA_PER_CAPABILITY} units² per capability · floor: ${LAND_FLOOR_CAPABILITIES} capability (control: ${PRE_FLOOR})`;
  root.appendChild(head);
  for (const pic of FLOOR_PICTURES) {
    const h = document.createElement('h2');
    h.textContent = `${pic.id} — ${pic.what} — ${pic.zoom === FIT_ZOOM ? 'fitted' : `${pic.zoom} px/unit`}`;
    root.appendChild(h);
    const row = document.createElement('div');
    row.className = 'row';
    for (const arm of floorArmsFor(pic.id)) {
      const r = runner.read(arm, pic.id);
      const land = runner.land(arm);
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = runner.snapshot(arm, pic.id);
      img.width = 900;
      fig.appendChild(img);
      const cap = document.createElement('figcaption');
      cap.textContent =
        `${arm} — ${floorArmCaption(arm)} · largest: ${land.largest.id} (${land.largest.capabilities} capabilities, ${land.largest.area.toFixed(0)} units²) · ` +
        `zero-capability islands rank ${land.zero.map((z) => `#${z.rank}`).join(', ')} of ${land.islandsCount} · ${land.inversions.length} inverted pairs · ` +
        `land ${(r.landShare * 100).toFixed(2)}% of the frame · moved>${VISIBLE_DELTA} vs today ${r.visible.toLocaleString()}`;
      fig.appendChild(cap);
      row.appendChild(fig);
    }
    root.appendChild(row);
  }
}

declare global {
  interface Window {
    islandFloorRunner?: FloorRunner;
  }
}
