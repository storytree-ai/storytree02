// shipped-blooms-scene.ts — CAN THE MAP SAY WHOSE SIGNATURE THAT IS? Three arms, one thing each.
//
// ⚠⚠ THE DEFECT THIS PAGE PICTURES IS INVISIBLE IN A FRAME, which is why the page exists. A UAT
// bloom is one SIGNED criterion of one STORY (ADR-0226 D4) — a claim about proof state, bound by
// the same fence as the land's colour: a unit reads as the state it holds and as no other
// (ADR-0392 D5 / ADR-0398 D7). Nothing in a rendered flower says which story signed it, so a map
// that spends one story's signatures over its neighbours draws perfectly ordinary islands and
// asserts something nobody signed.
//
// THE THREE ARMS, each differing from the one before it in exactly one thing:
//
//   none         the map as it drew until 2026-08-31 — `blooms: 0` at both call sites, in terms,
//                because the descriptor stream carried no island attribution and drawing NOTHING
//                was the honest state.
//   scattered    the same map with the signature count finally read — and spent through ONE
//                whole-map dressing call, which is what the zero was protecting against. Stories
//                that have signed nothing wear flowers.
//   attributed   the same count spent per island (`dressMapFromKit`) — what ships now. Every
//                flower stands on the ground of the story that signed it.
//
// ⚠ `scattered` IS NOT A PICTURE OF THE PAST. The map never drew it: the count was pinned at zero
// precisely so this could not happen. It is the picture of the mistake the pin was standing in
// for, and it is here because "we avoided a misreport" is not something a reader can check without
// seeing what the misreport looks like.
//
// ⚠ THE CROWD IS THE `forest` SIZE ON PURPOSE — the real map's own status MIX. A crowd where every
// story is healthy has every story signing all ten, and then a scattered dressing and an
// attributed one draw the same number of flowers in nearly the same places. The defect is only
// visible where some stories have signed nothing, which is what the real mix supplies.
//
// ⚠ THE NUMBERS BESIDE THE PICTURES ARE THE ACCEPTANCE TEST, not the pictures. `bloomCensus`
// attributes every PLACED flower to the island it stands on and compares that against what each
// story actually signed — so `misattributed` is a count a reader can check, and a picture whose
// flowers merely look tidy cannot pass it.

import * as THREE from 'three';

import { LAND_RELIEF_AMPLITUDE } from '../src/land-relief.js';
import { dressMapFromKit } from '../src/map-dressing.js';
import {
  capabilityFactsFrom,
  dressIslandFromKit,
  isCriterionRole,
  type KitPlacement,
  type RoleFootprints,
} from '../src/kit-vocabulary.js';
import { parcelCellsFrom } from '../src/parcel-cells.js';
import type { InstanceDescriptor } from '../src/world-to-3d.js';
import { readIdentity, type RendererIdentity } from './frame-cost-scene.js';
import { kitMeshes, loadKit, roleFootprints, type LoadedKit } from './kit-scene.js';
import {
  CROWD_ZOOMS,
  FIT_ZOOM,
  buildCrowdScene,
  crowdBlooms,
  crowdCells,
  crowdDescriptors,
  crowdIslandId,
  crowdIslands,
  crowdSize,
  orientedCamera,
  type CrowdZoom,
} from './shipped-crowd-scene.js';

/** The crowd this page draws: the real map's island count AND its real status mix. */
const SIZE = crowdSize('forest');

/** The ladder arm the land wears — the one the map wears now. Held fixed on every arm here, so the
 *  only thing that moves between pictures is where the flowers go. */
const LAND_ARM = 'dense' as const;

export type BloomDressing = 'none' | 'scattered' | 'attributed';
export const BLOOM_DRESSINGS: readonly BloomDressing[] = ['none', 'scattered', 'attributed'];

export const BLOOM_CAPTION = {
  none: 'blooms: 0 — the map until 2026-08-31, and the honest state while it could not attribute them',
  scattered: 'the count read and spent over the WHOLE map — the misreport the zero stood in for',
  attributed: 'the count spent per island — every signature on the story that gave it',
} satisfies Record<BloomDressing, string>;

/**
 * THE FRAMES THIS PAGE DRAWS. Nothing here is timed — a bloom is a look question, and the frame
 * cost of the land is the page next door's measurement.
 *
 * ⚠⚠ THE LAST ONE IS THE PICTURE THE OTHERS CANNOT TAKE, and it exists because the first three
 * measurably do not show the defect. Measured 2026-08-31 on an RTX 2060: at the FIT overview the
 * `none` and `scattered` frames come back BYTE-IDENTICAL — a bloom is 4 ground units wide and the
 * whole forest is 3,500, so 210 misplaced flowers are sub-pixel and paint nothing at all. At
 * 2 px/unit they are a few pixels. At 8 px/unit the frame is centred on the crowd's ANCHOR island,
 * which is healthy and has signed all ten in BOTH arms, so both pictures are correct there.
 *
 * `unsigned-8px` frames a story that has signed NOTHING, at the same 8 px/unit. That is the one
 * frame in which the misreport is a thing you can see rather than a number you have to trust.
 */
export interface BloomView {
  id: string;
  zoom: CrowdZoom;
  /** Where the camera looks, in forest space. Absent ⇒ the crowd's own origin (its anchor island). */
  centre?: { x: number; z: number };
  what: string;
}

/**
 * THE PLACEMENTS EACH ARM STANDS.
 *
 * ⚠ `scattered` IS THE REAL PRE-FIX CALL, not a caricature of it: one `dressIslandFromKit` over
 * every cell on the map, given the map's TOTAL signature count. That function is named for what it
 * dresses — one island — and handing it a whole forest is precisely the mistake. The blooms it
 * places are scattered over every cell it was given, so they land wherever the sampler finds room.
 */
const PLACEMENTS = new Map<string, KitPlacement[]>();

export function bloomPlacements(footprint: RoleFootprints, dressing: BloomDressing): KitPlacement[] {
  // ⚠ MEMOISED PER ARM, and it is a `check:mutation-diff` requirement rather than an optimisation:
  // the rung runs the covering tests once per mutant against a per-mutant timeout, so a suite that
  // rebuilds a 35-island forest ten times reports Timeouts — which score UNPROVEN — on a loaded
  // runner while passing on a quiet one. The verdict then MOVES on a tree that does not.
  // ⚠ The footprint is part of the key because it is what a caller could vary; the kit's measured
  // values and the frozen literal agree to within `FOOTPRINT_TOLERANCE`, so they are two keys.
  const key = `${dressing}|${JSON.stringify(footprint)}`;
  const cached = PLACEMENTS.get(key);
  if (cached) return cached;
  const built =
    dressing === 'attributed'
      ? dressMapFromKit(crowdDescriptors(SIZE), { relief: LAND_RELIEF_AMPLITUDE, footprint })
      : (() => {
          const cells = parcelCellsFrom(crowdCells(SIZE));
          return dressIslandFromKit({
            cells,
            facts: capabilityFactsFrom(cells),
            blooms: dressing === 'none' ? 0 : crowdBlooms(SIZE).length,
            // ⚠ THIS PAGE IS ABOUT SIGNATURE ATTRIBUTION AND STANDS NOTHING ELSE. Its crowd fixture
            // signs every criterion it carries, so there are no unsigned or failing ones to draw
            // — stated out loud because `KitDressingOptions` requires it to be (ADR-0600).
            buds: 0,
            wilts: 0,
            relief: LAND_RELIEF_AMPLITUDE,
            footprint,
          });
        })();
  PLACEMENTS.set(key, built);
  return built;
}

/** One island's ground centre, in forest space — what a placed prop is attributed to. */
interface IslandAnchor {
  id: string;
  x: number;
  z: number;
}

function anchors(): IslandAnchor[] {
  return crowdIslands(SIZE).map((island) => ({
    id: crowdIslandId(island.index),
    x: island.offset.x,
    z: island.offset.z,
  }));
}

/**
 * WHICH ISLAND A PLACED PROP STANDS ON — the NEAREST island centre.
 *
 * ⚠ NEAREST-CENTRE RATHER THAN A BOUNDING BOX, because the crowd's islands are scattered and their
 * boxes can overlap even where their land does not: a box test would leave some props attributed
 * to two islands and some to none, and the honest answer to "whose ground is this?" would then
 * depend on iteration order. Every island in the crowd is the same fixture island, so the nearest
 * centre IS the island whose cells the point was sampled from.
 */
function nearestIsland(at: { x: number; z: number }, list: readonly IslandAnchor[]): string {
  let best = list[0];
  if (!best) throw new Error('shipped-blooms-scene: the crowd has no islands');
  let bestD = Infinity;
  for (const island of list) {
    const d = (island.x - at.x) ** 2 + (island.z - at.z) ** 2;
    if (d < bestD) {
      bestD = d;
      best = island;
    }
  }
  return best.id;
}

export interface BloomCensus {
  dressing: BloomDressing;
  /** Flowers actually placed on the map. */
  drawn: number;
  /** Signatures the scene actually holds — what a truthful map would draw. */
  signed: number;
  /** Flowers standing on an island whose story did not sign that many — the misreport, as a count.
   *  Summed per island as `max(0, drawn - signed)`, so a story wearing four flowers for two
   *  signatures contributes two whatever the rest of the map does. */
  misattributed: number;
  /** Stories that signed NOTHING and are nevertheless wearing at least one flower. The sharpest
   *  form of the defect: the map asserting a signature on work nobody has checked. */
  unsignedIslandsWearingFlowers: number;
  /** Signatures a story holds that the map does not draw — the opposite error, and the one the
   *  `none` arm is made entirely of. */
  undrawn: number;
}

export function bloomCensus(footprint: RoleFootprints, dressing: BloomDressing): BloomCensus {
  const list = anchors();
  const signed = new Map<string, number>();
  for (const island of list) signed.set(island.id, 0);
  for (const bloom of crowdBlooms(SIZE)) {
    const id = bloom.island;
    if (id !== undefined) signed.set(id, (signed.get(id) ?? 0) + 1);
  }
  const drawn = new Map<string, number>();
  for (const island of list) drawn.set(island.id, 0);
  let total = 0;
  for (const placement of bloomPlacements(footprint, dressing)) {
    // This page is about SIGNATURE attribution and its fixture stands signed criteria only, but
    // the filter asks the general question so it stays true if that ever changes (ADR-0600).
    if (!isCriterionRole(placement.role)) continue;
    total += 1;
    const id = nearestIsland(placement.at, list);
    drawn.set(id, (drawn.get(id) ?? 0) + 1);
  }
  let misattributed = 0;
  let undrawn = 0;
  let unsignedWearing = 0;
  for (const island of list) {
    const s = signed.get(island.id) ?? 0;
    const d = drawn.get(island.id) ?? 0;
    misattributed += Math.max(0, d - s);
    undrawn += Math.max(0, s - d);
    if (s === 0 && d > 0) unsignedWearing += 1;
  }
  return {
    dressing,
    drawn: total,
    signed: crowdBlooms(SIZE).length,
    misattributed,
    unsignedIslandsWearingFlowers: unsignedWearing,
    undrawn,
  };
}

/**
 * THE ISLAND THIS PAGE ZOOMS IN ON TO SHOW THE DEFECT — the FIRST story in the crowd that has
 * signed nothing at all.
 *
 * ⚠ CHOSEN BY THE FIXTURE'S OWN RULE rather than by index. A criterion defaults to `proven` on a
 * HEALTHY island and `pending` on any other (ADR-0033 d.4: a story's status IS its own signed UAT
 * verdict), so "signed nothing" means "not healthy" — and if the crowd's status mix ever changed
 * so that every story signed something, this THROWS rather than quietly framing a story that did
 * sign and picturing nothing.
 */
function unsignedIslandCentre() {
  const signing = new Set(crowdBlooms(SIZE).map((b) => b.island));
  for (const island of crowdIslands(SIZE)) {
    if (!signing.has(crowdIslandId(island.index))) return { x: island.offset.x, z: island.offset.z };
  }
  throw new Error(
    'shipped-blooms-scene: every story in this crowd has signed something, so there is no island ' +
      'on which a misattributed flower could be seen. The comparison would picture nothing.',
  );
}

export const BLOOM_VIEWS: readonly BloomView[] = [
  { id: 'fit', zoom: FIT_ZOOM, what: 'the whole forest, fitted to a laptop screen' },
  ...CROWD_ZOOMS.map((zoom) => ({
    id: `${zoom}px`,
    zoom,
    what: `${zoom} delivered px per ground unit — centred on the crowd's anchor island, which has signed all ten`,
  })),
  {
    id: 'unsigned-8px',
    zoom: 8,
    centre: unsignedIslandCentre(),
    what: '8 px per ground unit, centred on a story that has signed NOTHING — the frame where the misreport is visible',
  },
];

export interface BloomScene {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  width: number;
  height: number;
  pxPerUnit: number;
  /** MERGED meshes standing on the frame — the kit merges every placement of a part into one, so
   *  this is a handful whatever the map holds. It is here for ONE reason: a kit that failed to
   *  parse draws NONE, and a picture with no props in it is otherwise indistinguishable from a
   *  picture of bare land. Read {@link placements} for how many objects actually stand. */
  meshes: number;
  /** Objects placed on the map — trees, dead trees and flowers together. */
  placements: number;
  /** Of those, the flowers: one per signed UAT criterion this arm chose to draw. */
  blooms: number;
}

/**
 * THE CROWD'S LAND, PLUS THIS ARM'S PROPS.
 *
 * ⚠ THE LAND IS BUILT BY `buildCrowdScene` RATHER THAN REBUILT HERE, so every arm on this page
 * stands on exactly the ground the page next door measures — same ladder, same grain, same
 * occlusion field, same camera. An instrument that built its own land would be picturing flowers
 * on a map the product does not draw.
 */
export function buildBloomScene(
  kit: LoadedKit | null,
  dressing: BloomDressing,
  view: BloomView,
): BloomScene {
  const land = buildCrowdScene(LAND_ARM, SIZE, view.zoom);
  let meshes = 0;
  let blooms = 0;
  let placed = 0;
  if (kit !== null) {
    const placements = bloomPlacements(roleFootprints(kit), dressing);
    placed = placements.length;
    for (const placement of placements) if (isCriterionRole(placement.role)) blooms += 1;
    for (const mesh of kitMeshes(kit, placements)) {
      land.scene.add(mesh);
      meshes += 1;
    }
  }
  // ⚠ THE CAMERA IS RE-AIMED RATHER THAN REBUILT, and only when the view asks for it.
  // `buildCrowdScene` always looks at the forest's origin — correct for the page next door, whose
  // whole point is that every timed frame shows the SAME island. Here one view has to look
  // somewhere else, and it looks at the crowd's OWN pxPerUnit so the two frames stay one scale.
  const camera =
    view.centre === undefined ? land.camera : orientedCamera(view.centre, land.pxPerUnit);
  return {
    scene: land.scene,
    camera,
    width: land.width,
    height: land.height,
    pxPerUnit: land.pxPerUnit,
    meshes,
    placements: placed,
    blooms,
  };
}

export interface BloomRunner {
  identity(): RendererIdentity;
  snapshot(
    dressing: BloomDressing,
    view: string,
  ): { png: string; meshes: number; placements: number; blooms: number };
  census(dressing: BloomDressing): BloomCensus;
  /** The frames this page can take, so a driver walks the page's own list rather than a copy. */
  views(): readonly { id: string; what: string }[];
  dispose(): void;
}

export async function createBloomRunner(): Promise<BloomRunner> {
  const kit = await loadKit();
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const identity = readIdentity(gl);

  // ⚠ CACHED PER (dressing, zoom). `buildCrowdScene` MUTATES the scene it hands back when this page
  // adds props to it, so a rebuild per snapshot would stack one arm's flowers on the next one's.
  const built = new Map<string, BloomScene>();

  return {
    identity: () => identity,
    snapshot(dressing, view) {
      const found = BLOOM_VIEWS.find((v) => v.id === view);
      if (!found) throw new Error(`shipped-blooms-scene: no view "${view}"`);
      const key = `${dressing}|${found.id}`;
      let s = built.get(key);
      if (!s) {
        s = buildBloomScene(kit, dressing, found);
        built.set(key, s);
      }
      renderer.setSize(s.width, s.height, false);
      renderer.render(s.scene, s.camera);
      return {
        png: canvas.toDataURL('image/png'),
        meshes: s.meshes,
        placements: s.placements,
        blooms: s.blooms,
      };
    },
    census: (dressing) => bloomCensus(roleFootprints(kit), dressing),
    views: () => BLOOM_VIEWS.map((v) => ({ id: v.id, what: v.what })),
    dispose() {
      renderer.dispose();
    },
  };
}

/** Mount the page: every arm at every zoom, with its census printed beside it. */
export async function mountShippedBlooms(root: HTMLElement): Promise<void> {
  const runner = await createBloomRunner();
  const id = runner.identity();
  const head = document.createElement('p');
  head.className = 'numbers';
  head.textContent = `${id.vendor} — ${id.renderer} · software=${id.software}`;
  root.appendChild(head);

  const table = document.createElement('p');
  table.className = 'numbers';
  table.innerHTML = BLOOM_DRESSINGS.map((d) => {
    const c = runner.census(d);
    return (
      `${d.padEnd(11)} drawn ${String(c.drawn).padStart(3)} of ${c.signed} signed · ` +
      `MISATTRIBUTED ${c.misattributed} · undrawn ${c.undrawn} · ` +
      `stories wearing an unsigned flower: ${c.unsignedIslandsWearingFlowers}`
    );
  }).join('<br />');
  root.appendChild(table);

  for (const view of BLOOM_VIEWS) {
    const h2 = document.createElement('h2');
    h2.textContent = view.what;
    root.appendChild(h2);
    const row = document.createElement('div');
    row.className = 'row';
    for (const dressing of BLOOM_DRESSINGS) {
      const shot = runner.snapshot(dressing, view.id);
      const fig = document.createElement('figure');
      const img = document.createElement('img');
      img.src = shot.png;
      img.width = 620;
      const cap = document.createElement('figcaption');
      cap.textContent = `${dressing} — ${BLOOM_CAPTION[dressing]} · ${shot.placements} objects, ${shot.blooms} of them flowers`;
      fig.append(img, cap);
      row.appendChild(fig);
    }
    root.appendChild(row);
  }

  window.bloomRunner = runner;
}

declare global {
  // eslint-disable-next-line no-var
  var bloomRunner: BloomRunner;
}
