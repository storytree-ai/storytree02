// shipped-crowd-scene.ts — THE SHIPPED GROUND AT FOREST SCALE: the adopted ladder, costed on a
// crowd instead of on one island.
//
// THE INCREMENT: `cost-the-adopted-ladder-on-a-crowd` on `adopt-the-land-into-the-shipped-map-arc`.
//
// ⚠⚠ THE INCREMENT'S OWN PREMISE IS FALSE, AND CORRECTING IT IS THIS PAGE'S FIRST RESULT.
//
// It was parked saying: *"The forest map draws MANY islands, each its own draw call, and the
// shipped renderer is already known to be DRAW-CALL BOUND. A per-draw cost on a draw-call-bound
// renderer is the one shape where a per-island figure understates the whole-map figure."* The
// second sentence is sound. The first is not true of this renderer, and it is refuted at its own
// source rather than argued with:
//
//   `ForestWorldCanvas` renders exactly ONE `<CellGround cells={cells} />` for the WHOLE
//   descriptor stream (`src/ForestWorldCanvas.tsx`), `CellGround` makes ONE `cellGroundGeometry`
//   call and ONE `createBandedGroundMaterial`, and a territory IS an island. So every island's
//   ground in the entire forest is one merged buffer wearing one material — ONE DRAW CALL, and
//   one ramp upload per FRAME however many islands are standing.
//
// `forest-ground-is-one-mesh.test.ts` holds that in `src/`, where the claim lives; the driver
// holds the browser's own `renderer.info.render.calls` to 1 on a 35-island scene, which is the
// same claim measured rather than read.
//
// ⚠ SO THE QUESTION CHANGES SHAPE RATHER THAN GOING AWAY, and the new one is better. The ladder's
// cost cannot multiply by island count — but nobody has ever drawn this ground at forest scale at
// all, and end-state item 2 asks what the treatment costs. Three things genuinely do grow with the
// forest, and this page separates them:
//
//   1. VERTEX WORK. One mesh spanning the whole forest has one bounding sphere, so three
//      frustum-culls it as ONE object: at ANY zoom, every island's triangles are submitted, including
//      the thirty-four off screen. 1,640 triangles becomes 57,400.
//   2. STATUS DIVERSITY. The committed one-island figures were taken on an all-`healthy` island —
//      ONE ramp row, so every fragment took the same branch of the material's `if (idx == n)`
//      selection chain. A real forest holds six statuses, and divergent branches within a warp is
//      the one mechanism by which the ladder could cost more per pixel on a bigger map. The
//      `forest-mono` arm exists ONLY to isolate it: same 35 islands, same triangles, same frame,
//      all one status.
//   3. THE OCCLUSION FIELD'S RESOLUTION. `occlusionGres` is `min(SHADOW_GRES, SHADOW_TEXTURE_MAX /
//      widestSpan)` — a budget written for a forest nobody had drawn (`src/land-shadow.ts:58-66`
//      says so in terms). One island spans 234 units and gets the full 3 samples per unit; this
//      forest spans ~3,500 and gets what the clamp leaves. This page is the first thing to
//      exercise that branch, so it REPORTS the delivered resolution rather than assuming it.
//
// ⚠ THE TWO ARMS ARE `shadow` AND `dense`, IMPORTED — never re-declared. They are the same two
// arms `shipped-land-scene.ts` measures, reached through the same {@link litLadderOf}, so `shadow`
// is `LEGACY_SHADE_LEVELS` (four rungs, what the map wore until 2026-08-31) and `dense` is
// `SHADE_LEVELS` (nine rungs, what it wears now). A local copy of that mapping is the fork this
// package has already paid for three times, and it would let a crowd figure and an island figure
// silently be about two different ladders.
//
// ⚠ THE FRAME IS THE READER'S SCREEN, NOT THE ISLAND'S OWN BOUNDS, and that is the one framing
// difference from `shipped-land-scene.ts`. There the buffer is fitted to the island, so "2 px per
// ground unit" is a property of the picture; a forest fitted that way would need a 27,000 px
// buffer. Here the buffer is {@link CROWD_VIEWPORT} — an ordinary laptop — and the zoom decides how
// much forest lands inside it, which is `crowd-scene.ts`'s argument and is the only way the crowd
// question can be asked honestly. Every timed configuration shares that buffer and that camera, so
// island count is the only thing moving.
//
// ⚠ AND IT ADOPTS NOTHING. `harness/` only. This page produces EVIDENCE about `src/` modules it
// imports; it changes none of them.

import * as THREE from 'three';

import {
  GROUND_STATUS_ATTRIBUTE,
  createBandedGroundMaterial,
  groundShadowTexture,
  type BandedGroundMaterialOptions,
} from '../src/banded-ground-material.js';
import { cellGroundGeometry } from '../src/cell-ground-geometry.js';
import { frameWorld } from '../src/camera-framing.js';
import { buildGroundOcclusion } from '../src/contact-shade.js';
import { groundBounds } from '../src/ground-casters.js';
import { LAND_SCALE } from '../src/land-per-capability.js';
import { LAND_RELIEF_AMPLITUDE, landRelief } from '../src/land-relief.js';
import { occlusionGres, shadowCoverage, type ShadowCaster } from '../src/land-shadow.js';
import type { InstanceDescriptor } from '../src/world-to-3d.js';
import { SHIPPED_COAST, clipToCoast, type CoastPoint } from '../src/coast-clip.js';
import { DOCK_REACH, bearingFrom, islandRims, type IslandRim } from '../src/island-path.js';
import { CROWD_POPULATION, CROWD_VIEWPORT, crowdLayout } from './crowd-layout.js';
import type { CrowdIsland } from './crowd-layout.js';
import { readIdentity, type RendererIdentity } from './frame-cost-scene.js';
import { islandCriteria } from './island-fixture.js';
import { SHIPPED_LIGHTING } from './shipped-baseline.js';
import {
  GROUND_TOKENS,
  groundRowOf,
  linearColourOf,
  litLadderOf,
  drawnParcels,
  drawnTrueParcels,
  shippedCasters,
  shippedParcels,
} from './shipped-land-scene.js';
import type { LandArm } from './shipped-land-scene.js';

/**
 * THE LADDER AXIS, AND IT IS THE WHOLE COMPARISON. Two arms of the page next door, differing in
 * the shade ladder and in nothing else — same grain, same occlusion field, same relief, same
 * parcels, same frame.
 */
export type CrowdArm = Extract<LandArm, 'shadow' | 'dense'>;
export const CROWD_ARMS: readonly CrowdArm[] = ['shadow', 'dense'];

/** What each arm is, for the caption under its picture. `satisfies` rather than an annotation, so
 *  a missing arm is still a compile error while the literal keys stay known to a reader. */
export const CROWD_ARM_CAPTION = {
  shadow: 'the four-rung ladder the map wore until 2026-08-31 (LEGACY_SHADE_LEVELS)',
  dense: 'the nine-rung ladder the map wears now (SHADE_LEVELS)',
} satisfies Record<CrowdArm, string>;

/**
 * THE CROWD AXIS — three scenes, and the middle one exists only to split the other two apart.
 *
 * ⚠ `forest-mono` IS NOT A THIRD ART OPTION. It is `forest` with every island's status set to the
 * one the committed single-island figures were taken on. Identical triangle count, identical
 * frame, identical camera — so `one → forest-mono` is PURELY the extra geometry, and
 * `forest-mono → forest` is PURELY the six-row status spread. Without it, a crowd figure that
 * came in high could not be attributed to either, and the ladder would be blamed for whichever
 * the reader expected.
 */
export type CrowdSizeId = 'one' | 'forest-mono' | 'forest';

export interface CrowdSize {
  id: CrowdSizeId;
  islands: number;
  /** `mono` ⇒ every island wears {@link MONO_STATUS}; `real` ⇒ the measured forest's own mix. */
  mix: 'mono' | 'real';
  /** The caption under this scene's pictures. */
  what: string;
  /**
   * HOW THE FRAME IS SIZED — which island `crowdLayout` reproduces the real map's land share
   * from. Omitted is `'drawn'`: the island AS THE 2D DRAWING LAYS IT, because the real map's
   * spacing is the drawing's and the mapper sizes each island in place (ADR-0517 D1, and the
   * land-per-capability ratio after it), so the layout holds still however the island moves.
   * `'compact'` sizes the frame from the island AS SHIPPED instead — the layout compacted with the
   * islands — which is NOT what any shipped surface does: it is the instrument's picture of the
   * OTHER answer to the layout question, rendered for the owner's decision and standing on no
   * `CROWD_SIZES` entry.
   */
  layout?: 'drawn' | 'compact';
}

/** The status the single-island evidence was taken on, and therefore the one the mono crowd wears.
 *  Read off the shipped fixture rather than chosen — `shippedParcels()` delivers 164 cells all in
 *  one state, and a transcription here could disagree with it silently. */
export const MONO_STATUS: string = shippedParcels()[0]?.material ?? 'healthy';

export const CROWD_SIZES: readonly CrowdSize[] = [
  {
    id: 'one',
    islands: 1,
    mix: 'mono',
    what: 'one island — the scene every committed figure on this arc was taken on',
  },
  {
    id: 'forest-mono',
    islands: CROWD_POPULATION.length,
    mix: 'mono',
    what: `${CROWD_POPULATION.length} islands, all ${MONO_STATUS} — the geometry alone`,
  },
  {
    id: 'forest',
    islands: CROWD_POPULATION.length,
    mix: 'real',
    what: `${CROWD_POPULATION.length} islands in the real forest's status mix`,
  },
];

/**
 * THE TIMED ZOOMS — the arc's own two, in delivered device px per ground unit, so a crowd row can
 * be read against the committed one-island rows without a conversion.
 *
 * ⚠ AT NEITHER OF THESE DOES THE WHOLE FOREST FIT, and that is the point rather than a limitation.
 * The buffer is a laptop's screen: at 2 px/unit it holds 1,280 x 800 ground units (a
 * neighbourhood), at 8 it holds 320 x 200 (about one island). The other islands are still
 * SUBMITTED — one mesh, one bounding sphere, no per-island culling — so these two rows are the
 * honest question "what does the rest of the forest cost me when I am not looking at it?".
 * {@link FIT_ZOOM} is the picture of the whole crowd and is never timed.
 */
export const CROWD_ZOOMS: readonly number[] = [2, 8];

/** A zoom that is not a number of pixels but a rule: fit the whole forest into the buffer. Used
 *  for the OVERVIEW PICTURE only — it delivers a different px/unit per scene, so a timing taken at
 *  it would compare three different frames and call the difference the ladder's. */
export const FIT_ZOOM = 'fit';
export type CrowdZoom = number | typeof FIT_ZOOM;

/** Ground units of margin around the forest when fitting it to the buffer. */
const FIT_MARGIN = 40;

export function crowdSize(id: CrowdSizeId): CrowdSize {
  const found = CROWD_SIZES.find((s) => s.id === id);
  if (!found) throw new Error(`shipped-crowd-scene: no crowd size "${id}"`);
  return found;
}

/**
 * WHERE THE ISLANDS STAND, RE-CENTRED ON ONE OF THEM.
 *
 * `crowdLayout` scatters the forest across a frame derived from the real map's measured land
 * share. This then translates the whole forest so that the island NEAREST its centre sits at the
 * origin — which is where the single-island scene's island also sits.
 *
 * ⚠ THE RE-CENTRING IS WHAT MAKES THE THREE SCENES COMPARABLE AT ALL. Every timed frame is
 * centred on the origin, so at 8 px/unit all three scenes show THE SAME ISLAND at the same place
 * and the same size. Without it the crowd frames would land on whatever happened to be near the
 * centroid — possibly open water — and a difference in land coverage would be read as a
 * difference in the ladder's cost.
 */
export function crowdIslands(size: CrowdSize, island: readonly InstanceDescriptor[] = shippedParcels()): readonly CrowdIsland[] {
  if (size.islands === 1) {
    return [{ index: 0, status: MONO_STATUS as CrowdIsland['status'], offset: { x: 0, z: 0 }, needle: false }];
  }
  // ⚠ THE FRAME IS SIZED FROM THE ISLAND AS DRAWN, THE SLACK FROM THE ISLAND AS SHIPPED. Since
  // ADR-0517 D1 the mapper unprojects each island in place and the layout holds still, so the
  // real map's spacing is still the 2D drawing's — the ribbon's — while the island that stands
  // in each slot is 2.9x deeper; and since the land-per-capability ratio the island in each slot
  // is smaller than the drawing's too. `crowd-layout.ts`'s option doc carries the reasoning.
  // `island` is the island that STANDS in each slot (the shipped fixture unless a page passes a
  // ladder rung's); a `'compact'` layout sizes the frame AND the slack from it instead of from the
  // drawing. Held still, the slack is bounded by the drawing unprojected at the drawing's own size
  // (`drawnTrueParcels`) — the largest island a slot ever has to hold — so the scatter is the same
  // forest whichever rung stands in it, and a difference between two rungs is never the jitter's.
  const drawn = size.layout === 'compact' ? islandExtentOf(island) : islandExtentOf(drawnParcels());
  const slack = size.layout === 'compact' ? islandExtentOf(island) : islandExtentOf(drawnTrueParcels());
  const layout = crowdLayout({ islandW: drawn.w, islandScreenH: drawn.screenH, islandTrueScreenH: slack.screenH });
  // The island closest to the forest's own centroid, which becomes the origin for every scene.
  let anchor = layout.islands[0];
  if (!anchor) throw new Error('shipped-crowd-scene: crowdLayout returned no islands');
  const cx = layout.islands.reduce((a, i) => a + i.offset.x, 0) / layout.islands.length;
  const cz = layout.islands.reduce((a, i) => a + i.offset.z, 0) / layout.islands.length;
  let best = Infinity;
  for (const island of layout.islands) {
    const d = (island.offset.x - cx) ** 2 + (island.offset.z - cz) ** 2;
    if (d < best) {
      best = d;
      anchor = island;
    }
  }
  const ax = anchor.offset.x;
  const az = anchor.offset.z;
  return layout.islands.map((island) => ({
    ...island,
    status:
      size.mix === 'mono' ? (MONO_STATUS as CrowdIsland['status']) : island.status,
    offset: { x: island.offset.x - ax, z: island.offset.z - az },
  }));
}

/**
 * ONE ISLAND'S PROJECTED FOOTPRINT, measured through the SHIPPED camera rather than off the ring
 * coordinates — `crowdLayout`'s density arithmetic wants the island as the reader sees it, and
 * under a 45-degree view an island 46 units deep is 37 units tall on screen.
 */
export interface ShippedIslandExtent {
  /** The island's own width in ground units. */
  w: number;
  /** Its on-screen height in ground units — already foreshortened by the camera. */
  screenH: number;
}

/** A cell set's on-screen extent through the shipped camera, in ground units of the screen plane. */
function islandExtentOf(cells: readonly InstanceDescriptor[]): ShippedIslandExtent {
  const geo = cellGroundGeometry({ cells, resolve: linearColourOf, relief: landRelief });
  const camera = orientedCamera({ x: 0, z: 0 }, 1);
  const v = new THREE.Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < geo.positions.length; i += 3) {
    v.set(geo.positions[i]!, geo.positions[i + 1]!, geo.positions[i + 2]!).applyMatrix4(
      camera.matrixWorldInverse,
    );
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  return { w: maxX - minX, screenH: maxY - minY };
}

/**
 * THE SHIPPED VIEW DIRECTION, DERIVED FROM `frameWorld` RATHER THAN TRANSCRIBED.
 *
 * ⚠ ONLY THE DIRECTION IS THE PRODUCT'S HERE, and saying so is the same split `shipped-land-scene`
 * makes: `frameWorld`'s own FRAMING backs off `max(260, spread * 2.6)`, which on a 3,500-unit
 * forest would reserve a frame nine kilometres wide. What has to be the product's is the angle the
 * land is lit and looked at from, and that is what this reads.
 */
const SHIPPED_VIEW_DIR: THREE.Vector3 = (() => {
  const frame = frameWorld(shippedParcels());
  return new THREE.Vector3(
    frame.position[0] - frame.target[0],
    frame.position[1] - frame.target[1],
    frame.position[2] - frame.target[2],
  ).normalize();
})();

/**
 * THE SHIPPED VIEW DIRECTION RE-AIMED TO ANOTHER ELEVATION, KEEPING ITS AZIMUTH.
 *
 * ⚠ ONLY THE ELEVATION MOVES, and that is the whole contract. ADR-0380 D6 fixes the azimuth, and
 * the arm this exists for (`the-two-layers-share-one-elevation`) is about the angle above the
 * ground plane and nothing else — so the horizontal bearing is READ OFF {@link SHIPPED_VIEW_DIR}
 * rather than re-assumed, and only the y/horizontal split is rebuilt. Asked for the shipped
 * elevation it reproduces the shipped direction to float precision.
 *
 * ⚠ IT IS THE INSTRUMENT'S, NOT THE PRODUCT'S. `camera-framing.ts` still looks down at exactly
 * {@link SHIPPED_ELEVATION_DEG} and nothing here changes it; this lets a HARNESS page photograph
 * the same world from another angle so the owner can compare two pictures.
 */
export function viewDirAtElevation(elevationDeg: number): THREE.Vector3 {
  const e = (elevationDeg * Math.PI) / 180;
  const horiz = Math.hypot(SHIPPED_VIEW_DIR.x, SHIPPED_VIEW_DIR.z);
  // A straight-down shipped direction would carry no azimuth to keep; fall back to the +z side the
  // framing is built from (`eyeOffset` backs off along +z), so the result is still a real bearing.
  const ux = horiz === 0 ? 0 : SHIPPED_VIEW_DIR.x / horiz;
  const uz = horiz === 0 ? 1 : SHIPPED_VIEW_DIR.z / horiz;
  return new THREE.Vector3(ux * Math.cos(e), Math.sin(e), uz * Math.cos(e));
}

/** A camera at the shipped angle, looking at `centre`, with the frustum sized for `pxPerUnit`.
 *
 *  ⚠ THE DEPTH RANGE IS THE INSTRUMENT'S, NOT THE PRODUCT'S. `ForestWorldCanvas` clips at
 *  `near: 1, far: 4000` around ONE world; a forest 3,500 units across seen from 8,000 units away
 *  needs more, and clipping is not what this page measures. Symmetric and generous, so nothing is
 *  ever clipped out of a frame whose cost is being counted.
 *
 *  `elevationDeg` is the OWNER-LOOK arm and is absent on every shipped-angle caller: absent ⇒
 *  {@link SHIPPED_VIEW_DIR}, so every one of this file's ~20 existing callers is byte-unchanged and
 *  the pages asserting the signed 50° still see it. Present ⇒ {@link viewDirAtElevation}. */
export function orientedCamera(
  centre: { x: number; z: number },
  pxPerUnit: number,
  elevationDeg?: number,
): THREE.OrthographicCamera {
  const dir = elevationDeg === undefined ? SHIPPED_VIEW_DIR : viewDirAtElevation(elevationDeg);
  const halfW = CROWD_VIEWPORT.w / pxPerUnit / 2;
  const halfH = CROWD_VIEWPORT.h / pxPerUnit / 2;
  const camera = new THREE.OrthographicCamera(-halfW, halfW, halfH, -halfH, -20000, 20000);
  const dist = 8000;
  camera.position.set(centre.x + dir.x * dist, dir.y * dist, centre.z + dir.z * dist);
  camera.up.set(0, 1, 0);
  camera.lookAt(centre.x, 0, centre.z);
  camera.updateProjectionMatrix();
  // ⚠ WITHOUT THIS EVERY PROJECTION BELOW GOES THROUGH AN IDENTITY VIEW MATRIX. three refreshes
  // `matrixWorldInverse` inside `render()`, and the extent and fit arithmetic both run before
  // anything is drawn. `crowd-scene.ts` paid for this once already.
  camera.updateMatrixWorld(true);
  return camera;
}

/**
 * EVERY ISLAND'S PARCELS, IN FOREST SPACE, AS ONE DESCRIPTOR STREAM — which is exactly what
 * `worldTo3D` hands `ForestWorldCanvas` for a multi-island world.
 *
 * ⚠ THE STATUS IS STAMPED PER ISLAND, NOT PER PARCEL, because that is what the shipped mapper
 * does: a `cell-ground`'s `material` is its owning TERRITORY's folded status and a territory is an
 * island (`src/world-to-3d.ts`). The shipped fixture confirms it — 164 cells across 11 parcels,
 * all one status.
 */
export function crowdCells(size: CrowdSize, base: readonly InstanceDescriptor[] = shippedParcels()): InstanceDescriptor[] {
  const out: InstanceDescriptor[] = [];
  for (const island of crowdIslands(size, base)) {
    for (const cell of base) {
      // ⚠ THE RING IS ATTACHED IN A SEPARATE STATEMENT rather than through a conditional spread.
      // Under `exactOptionalPropertyTypes` an absent `points` and a `points: undefined` are
      // different descriptors, and a spread of `{}` hides which one this is at the call site —
      // which matters here because `groundBounds` and `cellGroundGeometry` both read `points ?? []`
      // and a cell that lost its ring silently bounds nothing.
      const moved: InstanceDescriptor = {
        ...cell,
        material: island.status,
        // ⚠ THE ISLAND ID IS RE-STAMPED PER COPY, and before 2026-08-31 it could not be: the
        // descriptor stream carried no island at all, so thirty-five copies of one island's cells
        // were thirty-five copies of ONE story. Anything reading a per-story quantity off this
        // crowd would have spent one story's signatures over the whole forest — which is exactly
        // the misreport `dressMapFromKit` exists to prevent, arriving through the instrument.
        island: crowdIslandId(island.index),
        transform: {
          ...cell.transform,
          x: cell.transform.x + island.offset.x,
          z: cell.transform.z + island.offset.z,
        },
      };
      // ⚠⚠ AND THE CAPABILITY IDS ARE RE-STAMPED PER ISLAND TOO, which is a CONFOUND REMOVAL
      // rather than a nicety. The crowd is one fixture island copied N times, so without this every
      // island's eleven parcels wear the SAME eleven capIds — and a reader that counts capabilities
      // over the whole map (`capabilityFactsFrom`) sees eleven on a thirty-five-island forest and
      // stands eleven objects on it. In the real map a capability belongs to exactly one story and
      // the ids are distinct, so the shared ids were the INSTRUMENT's artefact; leaving them would
      // have made a page comparing per-island dressing against whole-map dressing differ by 374
      // TREES, and that difference would have been the fixture's rather than the dressing's.
      if (cell.parcel !== undefined) moved.parcel = `${crowdIslandId(island.index)}/${cell.parcel}`;
      if (cell.points !== undefined) {
        moved.points = cell.points.map((p) => ({
          ...p,
          x: p.x + island.offset.x,
          z: p.z + island.offset.z,
        }));
      }
      out.push(moved);
    }
  }
  return out;
}

/**
 * THE STORY ID OF THE nTH ISLAND IN THE CROWD.
 *
 * The crowd is one fixture island copied N times, so its stories are synthetic — but they are
 * DISTINCT, which is the whole property a per-story claim needs. A crowd whose islands shared one
 * id would be a one-story map wearing thirty-five islands, and every per-story reading taken off it
 * would be wrong in the direction that looks fine.
 */
export function crowdIslandId(index: number): string {
  return `crowd-story-${index.toString().padStart(2, '0')}`;
}

/**
 * WHICH STORIES HAVE SIGNED, AND HOW MANY CRITERIA EACH — as `uat-bloom` descriptors, one per
 * signature, exactly as `worldTo3D` emits them from a real scene.
 *
 * ⚠ THE RULE IS THE FIXTURE'S OWN, NOT ONE INVENTED HERE. `islandCriteria` defaults every
 * criterion to `proven` on a HEALTHY island and to `pending` on any other, because a story's status
 * IS its own signed UAT verdict (ADR-0033 d.4). So the `forest` crowd — the real map's status mix
 * — contains stories that have signed everything standing beside stories that have signed nothing,
 * which is the only arrangement in which a misattributed signature is VISIBLE.
 *
 * ⚠ THE POSITION IS THE ISLAND'S OWN CENTRE and is never what places the flower. The kit's
 * dressing chooses where a bloom stands from the island's ground; these descriptors carry the
 * CLAIM (which story signed which criterion), and the transform is here because every descriptor
 * has one.
 */
export function crowdBlooms(size: CrowdSize, base: readonly InstanceDescriptor[] = shippedParcels()): InstanceDescriptor[] {
  const out: InstanceDescriptor[] = [];
  for (const island of crowdIslands(size, base)) {
    for (const criterion of islandCriteria({ status: island.status })) {
      if (criterion.state !== 'proven') continue;
      out.push({
        kind: 'uat-bloom',
        transform: { x: island.offset.x, y: 0, z: island.offset.z },
        group: 'uat-bloom',
        material: island.status,
        island: crowdIslandId(island.index),
        criterion: `${crowdIslandId(island.index)}/${criterion.id}`,
      });
    }
  }
  return out;
}

/** The crowd as ONE descriptor stream — its ground and its signatures together, which is the shape
 *  `worldTo3D` hands `ForestWorldCanvas` for a multi-island world. */
export function crowdDescriptors(size: CrowdSize, base: readonly InstanceDescriptor[] = shippedParcels()): InstanceDescriptor[] {
  return [...crowdCells(size, base), ...crowdBlooms(size, base)];
}

/**
 * One island's caster list, replicated onto every island of a crowd at that island's own offset.
 *
 * ⚠ SPLIT OUT OF {@link crowdCasters} ON 2026-09-04 SO THE RULE STAYS PROVABLE WHEN THE LIST IS
 * EMPTY. The rule is the one thing here that can go wrong invisibly — a crowd whose casters stayed
 * at the origin puts thirty-four islands' shadows on one island — and its only test fed it
 * `crowdCasters(REAL)`, which ADR-0508 turned into `[]`. The assertions kept passing over an empty
 * set and stopped saying anything. A base list the caller supplies is what lets the offsetting be
 * checked on its own terms rather than on whether the island currently stands anything.
 */
export function offsetPerIsland(base: readonly ShadowCaster[], size: CrowdSize): ShadowCaster[] {
  const out: ShadowCaster[] = [];
  for (const island of crowdIslands(size)) {
    for (const caster of base) {
      out.push({ ...caster, x: caster.x + island.offset.x, z: caster.z + island.offset.z });
    }
  }
  return out;
}

/**
 * What the forest's own DESCRIPTOR STREAM stands that darkens it, once per island.
 *
 * ⚠⚠ IT IS EMPTY SINCE ADR-0508 AND THAT IS NOT A DEFECT — read {@link shippedCasters}, which it
 * replicates. The placeholder story tree was the one thing an island's descriptors stood; each
 * island stands a GROVE now, and a grove is a kit PLACEMENT that reaches the ground through
 * `placementCasters`. A page that wants the shadow the MAP draws unions the two, exactly as
 * `ForestWorldCanvas` does — `shipped-canopy-scene.ts`'s `armCasters` is the worked example, and
 * `shipped-shadow-scene.ts` uses it for that reason. This function is kept, rather than deleted
 * with its one caster, because it is still the honest answer to "what does the descriptor stream
 * stand" — a `cave-arch` on a rim would come through it.
 */
export function crowdCasters(size: CrowdSize): ShadowCaster[] {
  return offsetPerIsland(shippedCasters(), size);
}

/**
 * THE RECIPE'S TWO LANDINGS, in degrees of bearing from the island's centre —
 * `build_land.py:419-420`: `coast_at(radians(-160.0))` and `coast_at(radians(25.0))`. The recipe
 * divides the x offset by `XSTRETCH` before taking the angle; this crowd does not, because the
 * bearings here select a dock on a coast the connector then joins, and the landings only need to
 * sit roughly opposite each other for the crossing to run through the island's middle.
 */
export const CROWD_LANDING_BEARINGS: readonly number[] = [-160, 25];

/**
 * How far offshore each synthetic strip starts, in ground units — well outside {@link DOCK_REACH},
 * so only the landward end docks and the seaward end is a trail's ordinary far end.
 *
 * ⚠ DERIVED FROM THE REACH SINCE 2026-09-23 (ADR-0596), because it was a literal that quietly
 * stopped meaning what its own sentence claimed. It read `40 * LAND_SCALE` = 15.08 while the reach
 * was 5.09, which was indeed "well outside". When ADR-0596 widened the reach to 13.57 the seaward
 * ends — which sit 12.74 to 14.70 from the NEAREST rim point, not the 15.08 they sit from their own
 * landing, because the coast curves away — fell inside it: 16 of 70 started docking, every crowd
 * island grew a third dock, and the connector drew a path out to sea. Twice the reach restores the
 * margin and, more to the point, keeps it: the fixture can no longer disagree with the constant it
 * is defined against.
 */
export const CROWD_STRIP_OFFSHORE = 2 * DOCK_REACH;

/**
 * THE RIM VERTEX NEAREST A BEARING from the island's centroid — the recipe's `coast_at`, in the
 * (x, z) basis: the point whose bearing differs from `angle` by the least, wrapped.
 */
export function coastAt(rim: IslandRim, angle: number): CoastPoint {
  let best: CoastPoint | undefined;
  let bestOff = Infinity;
  for (const loop of rim.loops) {
    for (const p of loop) {
      const d = bearingFrom(rim.centroid, p) - angle;
      const off = Math.abs(Math.atan2(Math.sin(d), Math.cos(d)));
      if (off >= bestOff) continue;
      bestOff = off;
      best = p;
    }
  }
  if (best === undefined) throw new Error(`shipped-crowd-scene: island "${rim.island}" has no rim to land on`);
  return best;
}

/**
 * TWO SYNTHETIC TRAIL STRIPS PER CROWD ISLAND, arriving from offshore and ENDING ON the island's
 * CLIPPED rim at the recipe's two landing bearings — so layer 3's connector (`islandPaths`) finds
 * two docks per island and joins them across it, exactly the coast -> interior -> coast crossing
 * `build_land.py`'s `path_polyline` draws.
 *
 * ⚠ THE RIM IS THE CLIPPED ONE, read through the same `clipToCoast(…, SHIPPED_COAST)` the shipped
 * builder runs, so each strip's landward end sits EXACTLY on the coast the ground ends on and the
 * dock snap moves it by nothing. Built from the pre-clip parcels the ends would sit on the hex
 * silhouette, up to a beach's width off the water — still within reach, but a worse fixture.
 *
 * ⚠ THE SHAPE IS THE MAPPER'S OWN: kind `trail-strip`, a three-point `points` polyline, a width,
 * a usage, `hidden: false`, an `edges` list and a `segment` id, so anything reading a strip the
 * way `worldTo3D` emits one reads these the same way.
 */
export function crowdStrips(size: CrowdSize, base: readonly InstanceDescriptor[] = shippedParcels()): InstanceDescriptor[] {
  const out: InstanceDescriptor[] = [];
  for (const rim of islandRims(clipToCoast(crowdCells(size, base), SHIPPED_COAST))) {
    for (const degrees of CROWD_LANDING_BEARINGS) {
      const landing = coastAt(rim, (degrees * Math.PI) / 180);
      const dx = landing.x - rim.centroid.x;
      const dz = landing.z - rim.centroid.z;
      const len = Math.hypot(dx, dz);
      const offshore: CoastPoint = {
        x: landing.x + (dx / len) * CROWD_STRIP_OFFSHORE,
        z: landing.z + (dz / len) * CROWD_STRIP_OFFSHORE,
      };
      const mid: CoastPoint = { x: (offshore.x + landing.x) / 2, z: (offshore.z + landing.z) / 2 };
      out.push({
        kind: 'trail-strip',
        transform: { x: mid.x, y: 0, z: mid.z },
        group: 'trail-strip',
        points: [
          { x: offshore.x, y: 0, z: offshore.z },
          { x: mid.x, y: 0, z: mid.z },
          { x: landing.x, y: 0, z: landing.z },
        ],
        width: 3 * LAND_SCALE,
        usage: 1,
        hidden: false,
        edges: [],
        segment: `${rim.island}/landing-${degrees}`,
      });
    }
  }
  return out;
}

export interface CrowdLandScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  width: number;
  height: number;
  pxPerUnit: number;
  triangles: number;
  parcels: number;
  islands: number;
  /** How many distinct ramp ROWS the buffer carries — 1 on a mono scene, 6 on the real forest.
   *  The thing `forest-mono` exists to hold still. */
  statusRows: number;
  /** Samples per ground unit the occlusion field was actually built at, after the
   *  `SHADOW_TEXTURE_MAX` clamp. `SHADOW_GRES` on one island; less on a forest. */
  shadowGres: number;
  /** The occlusion field's own texel dimensions — what the clamp is spending. */
  shadowW: number;
  shadowH: number;
  occlusionCoverage: number;
  casters: number;
}

/** Fit rule: the px/unit at which this scene's whole ground lands inside the buffer. */
export function fitPxPerUnit(size: CrowdSize): number {
  const cells = crowdCells(size);
  const geo = cellGroundGeometry({ cells, resolve: linearColourOf, relief: landRelief });
  const camera = orientedCamera({ x: 0, z: 0 }, 1);
  const v = new THREE.Vector3();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < geo.positions.length; i += 3) {
    v.set(geo.positions[i]!, geo.positions[i + 1]!, geo.positions[i + 2]!).applyMatrix4(
      camera.matrixWorldInverse,
    );
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  // Centred on the origin, so the half-extent that has to fit is the larger side of the origin.
  const halfW = Math.max(Math.abs(minX), Math.abs(maxX)) + FIT_MARGIN;
  const halfH = Math.max(Math.abs(minY), Math.abs(maxY)) + FIT_MARGIN;
  return Math.min(CROWD_VIEWPORT.w / 2 / halfW, CROWD_VIEWPORT.h / 2 / halfH);
}

/** The delivered px/unit for a zoom — the one place the `fit` rule is resolved, so a picture and a
 *  reading taken at the "same" zoom cannot be taken at two different ones. */
export function crowdPxPerUnit(size: CrowdSize, zoom: CrowdZoom): number {
  return zoom === FIT_ZOOM ? fitPxPerUnit(size) : zoom;
}

/**
 * Build one arm of one crowd at one zoom.
 *
 * ⚠ IT IS THE SHIPPED COMPOSITION, NOT A MODEL OF IT: one `cellGroundGeometry` call over every
 * island's cells, one `createBandedGroundMaterial`, one mesh — the three lines `CellGround` runs.
 * A page that built one mesh per island would answer the question the increment asked and not the
 * one the renderer poses.
 */
export function buildCrowdScene(arm: CrowdArm, size: CrowdSize, zoom: CrowdZoom): CrowdLandScene {
  const cells = crowdCells(size);
  const geo = cellGroundGeometry({
    cells,
    resolve: linearColourOf,
    index: groundRowOf,
    relief: landRelief,
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(geo.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(geo.normals, 3));
  geometry.setAttribute(GROUND_STATUS_ATTRIBUTE, new THREE.BufferAttribute(geo.statuses, 1));

  const bounds = groundBounds(cells);
  if (bounds === null) throw new Error('shipped-crowd-scene: the crowd bounds nothing');
  const casters = crowdCasters(size);
  const field = buildGroundOcclusion({ bounds, relief: LAND_RELIEF_AMPLITUDE, casters });

  // ⚠ THE GRAIN IS `'normal'` ON BOTH ARMS AND IS NOT A CHOICE — it is what `shadow` and `dense`
  // both wear next door. Dropping it here would compare a refined ladder against a grained one and
  // call the difference the ladder's.
  const opts: BandedGroundMaterialOptions = {
    tokens: GROUND_TOKENS,
    grain: 'normal',
    shadow: groundShadowTexture(field),
  };
  // ⚠ BY STATEMENT, never `lit: litLadderOf(arm)`. `dense` passes NOTHING — an absent `lit` leaves
  // the generated shader byte-identical to the one the adopted map compiles, and an explicit
  // `lit: SHADE_LEVELS` is a different call from an absent one. That byte identity is the whole
  // reason a figure taken here is a figure about the product.
  const lit = litLadderOf(arm);
  if (lit !== litLadderOf('dense')) opts.lit = lit;
  const material = createBandedGroundMaterial(opts);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SHIPPED_LIGHTING.background);
  scene.add(new THREE.Mesh(geometry, material));
  // The banded material is unlit — it computes its own lambert against the authored
  // LIGHT_DIRECTION — so these reach nothing on this page. They are here because the scene the
  // product builds has them, and a scene that dropped them would differ from it in two things.
  scene.add(new THREE.AmbientLight(0xffffff, SHIPPED_LIGHTING.ambientIntensity));
  const sun = new THREE.DirectionalLight(0xffffff, SHIPPED_LIGHTING.directionalIntensity);
  const [lx, ly, lz] = SHIPPED_LIGHTING.directionalPosition;
  sun.position.set(lx, ly, lz);
  scene.add(sun);

  const pxPerUnit = crowdPxPerUnit(size, zoom);
  const rows = new Set<number>();
  for (const s of geo.statuses) rows.add(s);

  return {
    scene,
    camera: orientedCamera({ x: 0, z: 0 }, pxPerUnit),
    width: CROWD_VIEWPORT.w,
    height: CROWD_VIEWPORT.h,
    pxPerUnit,
    triangles: geo.triangles,
    parcels: geo.cells,
    islands: size.islands,
    statusRows: rows.size,
    shadowGres: occlusionGres(bounds),
    shadowW: field.w,
    shadowH: field.h,
    occlusionCoverage: shadowCoverage(field),
    casters: casters.length,
  };
}

export interface CrowdReading {
  arm: CrowdArm;
  size: CrowdSizeId;
  pxPerUnit: number;
  width: number;
  height: number;
  triangles: number;
  parcels: number;
  islands: number;
  statusRows: number;
  shadowGres: number;
  shadowW: number;
  shadowH: number;
  occlusionCoverage: number;
  casters: number;
  /** Draw calls the renderer actually submitted for this frame. The measured half of this page's
   *  first result: it is 1 on one island and 1 on thirty-five. */
  drawCalls: number;
  /** Median GPU nanoseconds for one render, or null if the timer never resolved. */
  gpuNs: number | null;
  batch: number;
}

export interface CrowdColourReading {
  arm: CrowdArm;
  size: CrowdSizeId;
  pxPerUnit: number;
  distinct: number;
  /** Non-background pixels — how much of the reader's screen is actually land. */
  landPixels: number;
  landFraction: number;
}

export interface CrowdRunner {
  identity(): RendererIdentity;
  warm(): void;
  geometry(arm: CrowdArm, size: CrowdSizeId, zoom: CrowdZoom): Omit<CrowdReading, 'gpuNs' | 'batch'>;
  colours(arm: CrowdArm, size: CrowdSizeId, zoom: CrowdZoom): CrowdColourReading;
  changedPct(a: CrowdArm, b: CrowdArm, size: CrowdSizeId, zoom: CrowdZoom): number;
  /**
   * The same arm and zoom, on two different crowds — how much of the frame the SCALE moved.
   *
   * ⚠ THIS IS HOW THE OCCLUSION CLAMP BECOMES A NUMBER RATHER THAN AN IMPRESSION. At 8 px/unit
   * every scene is framed on the SAME island, so `one` against `forest` holds the ladder, the
   * relief, the grain, the parcels and the camera fixed and moves only what the rest of the forest
   * did to this island's picture — which, since the geometry off screen changes no pixel here, is
   * the shadow field's resolution and nothing else.
   */
  changedBySize(arm: CrowdArm, a: CrowdSizeId, b: CrowdSizeId, zoom: CrowdZoom): number;
  snapshot(arm: CrowdArm, size: CrowdSizeId, zoom: CrowdZoom): string;
  time(arm: CrowdArm, size: CrowdSizeId, zoom: CrowdZoom, batch: number): Promise<CrowdReading>;
  dispose(): void;
}

const GPU_TIMER = 'EXT_disjoint_timer_query_webgl2';

/** Wait for one timer query's result, or give up. Same eleven lines as the page next door, and a
 *  copy for the same reason it gives: the shared helper sits beside fixtures this page does not
 *  use. */
async function elapsedNs(gl: WebGL2RenderingContext, query: WebGLQuery): Promise<number | null> {
  for (let i = 0; i < 600; i += 1) {
    if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) === true) {
      return Number(gl.getQueryParameter(query, gl.QUERY_RESULT));
    }
    await new Promise((r) => requestAnimationFrame(() => r(null)));
  }
  return null;
}

/** The background packed the way {@link CrowdRunner.colours} keys pixels, so "not the forest" is a
 *  comparison against the colour the shipped canvas clears to rather than against black. */
const BACKGROUND_KEY = (() => {
  const c = new THREE.Color(SHIPPED_LIGHTING.background);
  const to8 = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 255);
  const s = c.clone().convertLinearToSRGB();
  return (to8(s.r) << 16) | (to8(s.g) << 8) | to8(s.b);
})();

export function createCrowdRunner(): CrowdRunner {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(1);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const timer = gl.getExtension(GPU_TIMER) as { TIME_ELAPSED_EXT: number } | null;
  const identity = readIdentity(gl);

  // ⚠ CACHED PER (arm, size, zoom). A 35-island buffer is 172,200 vertices to triangulate;
  // rebuilding it inside the sweep would time the CPU's triangulation along with the GPU's frame,
  // which is not the number being asked for and is where the crowd would look expensive for no
  // rendering reason at all.
  const built = new Map<string, CrowdLandScene>();
  const sceneFor = (arm: CrowdArm, size: CrowdSizeId, zoom: CrowdZoom): CrowdLandScene => {
    const key = `${arm}|${size}|${String(zoom)}`;
    const found = built.get(key);
    if (found) return found;
    const made = buildCrowdScene(arm, crowdSize(size), zoom);
    built.set(key, made);
    return made;
  };

  const render = (arm: CrowdArm, size: CrowdSizeId, zoom: CrowdZoom): CrowdLandScene => {
    const s = sceneFor(arm, size, zoom);
    renderer.setSize(s.width, s.height, false);
    renderer.render(s.scene, s.camera);
    return s;
  };

  const readFrame = (s: CrowdLandScene): Uint8Array => {
    const px = new Uint8Array(s.width * s.height * 4);
    gl.readPixels(0, 0, s.width, s.height, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  };

  /** Percentage of pixels that differ between two frames of the same size. */
  const diff = (first: Uint8Array, second: Uint8Array): number => {
    let differing = 0;
    for (let i = 0; i < first.length; i += 4) {
      if (
        first[i] !== second[i] ||
        first[i + 1] !== second[i + 1] ||
        first[i + 2] !== second[i + 2]
      ) {
        differing += 1;
      }
    }
    return (differing / (first.length / 4)) * 100;
  };

  const shape = (s: CrowdLandScene, arm: CrowdArm, size: CrowdSizeId): Omit<CrowdReading, 'gpuNs' | 'batch'> => ({
    arm,
    size,
    pxPerUnit: s.pxPerUnit,
    width: s.width,
    height: s.height,
    triangles: s.triangles,
    parcels: s.parcels,
    islands: s.islands,
    statusRows: s.statusRows,
    shadowGres: s.shadowGres,
    shadowW: s.shadowW,
    shadowH: s.shadowH,
    occlusionCoverage: s.occlusionCoverage,
    casters: s.casters,
    drawCalls: renderer.info.render.calls,
  });

  return {
    identity: () => identity,
    // THE COLD START IS PAID ONCE, OUTSIDE THE SWEEP. The first render of any configuration
    // compiles shaders and uploads buffers, and leaving that inside the timing is what made an
    // earlier instrument on this arc report a heavier scene as faster than a lighter one.
    warm() {
      for (const size of CROWD_SIZES) {
        for (const zoom of CROWD_ZOOMS) for (const arm of CROWD_ARMS) render(arm, size.id, zoom);
      }
      gl.finish();
    },

    geometry(arm, size, zoom) {
      return shape(render(arm, size, zoom), arm, size);
    },

    colours(arm, size, zoom) {
      const s = render(arm, size, zoom);
      const px = readFrame(s);
      const seen = new Set<number>();
      let landPixels = 0;
      for (let i = 0; i < px.length; i += 4) {
        const key = (px[i]! << 16) | (px[i + 1]! << 8) | px[i + 2]!;
        seen.add(key);
        if (key !== BACKGROUND_KEY) landPixels += 1;
      }
      return {
        arm,
        size,
        pxPerUnit: s.pxPerUnit,
        distinct: seen.size,
        landPixels,
        landFraction: landPixels / (s.width * s.height),
      };
    },

    changedPct(a, b, size, zoom) {
      // Read in one pass each, and only because the frames are identical by construction: both
      // arms share the buffer, the camera and the parcels, so a pixel index means the same place.
      return diff(readFrame(render(a, size, zoom)), readFrame(render(b, size, zoom)));
    },

    changedBySize(arm, a, b, zoom) {
      return diff(readFrame(render(arm, a, zoom)), readFrame(render(arm, b, zoom)));
    },

    snapshot(arm, size, zoom) {
      render(arm, size, zoom);
      return canvas.toDataURL('image/png');
    },

    async time(arm, size, zoom, batch) {
      const s = render(arm, size, zoom);
      const base = shape(s, arm, size);
      if (!timer) return { ...base, gpuNs: null, batch };
      const query = gl.createQuery();
      if (!query) return { ...base, gpuNs: null, batch };
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      for (let i = 0; i < batch; i += 1) renderer.render(s.scene, s.camera);
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      const ns = await elapsedNs(gl, query);
      gl.deleteQuery(query);
      return { ...base, gpuNs: ns === null ? null : ns / batch, batch };
    },

    dispose() {
      renderer.dispose();
    },
  };
}

/** Mount the page: the crowd overview, then every arm at both timed zooms, with the runner on
 *  `window` for the driver to reach. */
export function mountShippedCrowd(root: HTMLElement): void {
  const runner = createCrowdRunner();
  runner.warm();
  const id = runner.identity();
  const head = document.createElement('p');
  head.className = 'numbers';
  head.textContent = `${id.vendor} — ${id.renderer} · software=${id.software} · timerQuery=${id.timerQuery}`;
  root.appendChild(head);

  // THE PICTURE OF THE CROWD — never timed, because `fit` delivers a different px/unit per scene.
  const overview = document.createElement('h2');
  overview.textContent = 'the whole forest, fitted to a laptop screen — for looking at, not timed';
  root.appendChild(overview);
  const overviewRow = document.createElement('div');
  overviewRow.className = 'row';
  for (const arm of CROWD_ARMS) {
    const s = buildCrowdScene(arm, crowdSize('forest'), FIT_ZOOM);
    const fig = document.createElement('figure');
    const img = document.createElement('img');
    img.src = runner.snapshot(arm, 'forest', FIT_ZOOM);
    img.width = 900;
    const cap = document.createElement('figcaption');
    cap.textContent = `${arm} — ${CROWD_ARM_CAPTION[arm]} · ${s.pxPerUnit.toFixed(2)} px/unit · ${s.triangles} triangles`;
    fig.append(img, cap);
    overviewRow.appendChild(fig);
  }
  root.appendChild(overviewRow);

  for (const zoom of CROWD_ZOOMS) {
    for (const size of CROWD_SIZES) {
      const h2 = document.createElement('h2');
      h2.textContent = `${zoom} delivered px per ground unit — ${size.what}`;
      root.appendChild(h2);
      const row = document.createElement('div');
      row.className = 'row';
      for (const arm of CROWD_ARMS) {
        const s = buildCrowdScene(arm, size, zoom);
        const fig = document.createElement('figure');
        const img = document.createElement('img');
        img.src = runner.snapshot(arm, size.id, zoom);
        img.width = 900;
        const cap = document.createElement('figcaption');
        cap.textContent = `${arm} — ${CROWD_ARM_CAPTION[arm]} · ${s.triangles} triangles · ${s.statusRows} status row(s) · shadow field ${s.shadowW}x${s.shadowH} at ${s.shadowGres.toFixed(2)} samples/unit`;
        fig.append(img, cap);
        row.appendChild(fig);
      }
      root.appendChild(row);
    }
  }

  window.crowdRunner = runner;
}

/** The runner the driver reaches for. A DECLARED GLOBAL rather than a cast at the assignment: an
 *  `as unknown as { … }` chain is the discarded-evidence shape the house TypeScript standard
 *  refuses, and it would let the property's type drift from the interface above. */
declare global {
  // eslint-disable-next-line no-var
  var crowdRunner: CrowdRunner;
}
