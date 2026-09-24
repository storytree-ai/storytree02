// factoryBuildings — the island's side of ADR-0217's building factory.
//
// This is the GLUE increment 5 exists to answer: what happens when a building the factory
// produced has to sit on the island next to everything else. Three things had to be
// decided here, and none of them is geometry — the geometry arrived baked.
//
// 1. WHICH building an island gets. Nothing new is invented: the map already derives a
//    deterministic identity per story (`storyIcon`, ADR-0102) and draws it as a flat glyph.
//    That same identity now indexes the kit, so an island's building is as stable as its
//    icon always was and no island's identity moves.
//
// 2. WHERE it stands. The kit bakes to the same placement contract the glyph used —
//    centred on x = 0, standing on y = 0 — so every existing call site's `translate` is
//    already correct and the swap does not move anything on the map.
//
// 3. HOW MANY copies exist. This is the one that bites. A baked building is ~800 nodes
//    (`bake.test.ts` measures it), so inlining one per island puts a mid-sized map into
//    five figures of DOM and past ADR-0069's ceiling several times over. Every building is
//    therefore DEFINED once in `<defs>` and REFERENCED with `<use>` — the cost becomes the
//    kit's size plus one node per island, instead of the kit's size times the islands.
//
// ADR-0093 §4 keeps colour out of the shared scene-graph, which is why none of this lives
// in `@storytree/forest-world`: a baked facade's fill is its material modulated by N·L, so
// two walls of one building carry different colours and no CSS class can name them. The
// stamps were already studio chrome (ADR-0093 Decision 2), so the buildings ride there too
// and the core stays a colourless, framework-agnostic root. Whether baked art should be
// able to enter the shared scene at all is a live question for the owner — see the
// increment-5 notes — and deliberately NOT decided here.

import type { BakedPaintNode, GardenHeroId, SceneGardenHero } from '@storytree/forest-world';
import { storyIcon } from './buildingLayout.js';

/** One drawable of a baked building — the vector node vocabulary, already resolved. */
export type FactoryNode =
  | { el: 'polygon'; points: string; fill: string; stroke: string; strokeWidth: number; opacity?: number }
  | { el: 'path'; d: string; fill: string; stroke: string; strokeWidth: number; opacity?: number; fillRule?: 'evenodd' }
  | { el: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; opacity?: number };

export interface FactoryBuilding {
  id: string;
  label: string;
  name: string;
  nodes: FactoryNode[];
  minX: number;
  minY: number;
  width: number;
  height: number;
}

interface KitAsset {
  note: string;
  entries: FactoryBuilding[];
}

/** One baked cosy-island HERO in `kit.json`'s `heroes` array (grounded-art inc 10) — the same
 *  resolved-vector node vocabulary as a building, plus its stable id/label. */
interface KitHero extends FactoryBuilding {
  id: GardenHeroId;
}
/** One baked tree colourway in `kit.json`'s `heroTreeVariants` array (ADR-0227) — the `autumn-tree`
 *  hero baked with only its crown recoloured, tagged with the status it paints. Unlike a hero it carries
 *  no `id`/`label` (it is keyed by `status`), so it is its own shape rather than a `FactoryBuilding`. */
interface KitHeroTreeVariant {
  status: string;
  nodes: FactoryNode[];
  width: number;
  height: number;
}
interface KitAssetWithHeroes extends KitAsset {
  heroes: KitHero[];
  heroTreeVariants: KitHeroTreeVariant[];
}

/** Resolved once and reused — the asset is immutable and the parse is not free. */
let kitPromise: Promise<FactoryBuilding[]> | null = null;

/**
 * Load the baked kit.
 *
 * DYNAMIC on purpose. The asset is about a megabyte of geometry, and the feature it serves is
 * off by default — a static import would put all of it in the main chunk and charge every
 * studio load for a flag nobody has turned on. Behind `import()` it becomes its own chunk that
 * is fetched only when the flag is.
 */
export function loadFactoryKit(): Promise<FactoryBuilding[]> {
  kitPromise ??= import('@storytree/procedural-architecture/kit.json').then(
    (m) => ((m as { default: KitAsset }).default ?? (m as KitAsset)).entries,
  );
  return kitPromise;
}

/**
 * Which kit building a story shows.
 *
 * Keyed on the SAME `storyIcon(id).shape` bucket the flat glyph used, so swapping the art
 * never reshuffles which island is which — a reader who learned the map keeps their
 * landmarks. The bucket space (8) and the kit size (6) need not match: the modulo just
 * means two buckets share a building, which is already true of hue and monogram collisions.
 */
export function factoryBuildingFor(kit: readonly FactoryBuilding[], storyId: string): FactoryBuilding {
  const bucket = storyIcon(storyId).shape;
  const entry = kit[bucket % kit.length];
  if (!entry) throw new Error('the baked kit is empty — run `pnpm --filter @storytree/procedural-architecture bake`');
  return entry;
}

/** The `<defs>` id a building is defined under, and referenced by. */
export const factoryDefId = (kitId: string): string => `factory-building-${kitId}`;

// ---------------------------------------------------------------------------
// the cosy-island GARDEN heroes (grounded-art inc 11) — the fold into SceneInput.garden
// ---------------------------------------------------------------------------
//
// The studio side of ADR-0221's garden composition: it fetches the four inc-10 heroes from the SAME
// dynamic `kit.json` chunk (off the main bundle) and hands the core their resolved-paint nodes + baked
// box, keyed by id. The core (`@storytree/forest-world`) places them through the re-lit ADR-0218 seam;
// paint stays inside the baked family, so ADR-0093 §4's colour-is-class invariant holds everywhere else.

/** Resolved once and reused — the asset is immutable and the parse is not free. */
let heroesPromise: Promise<Record<GardenHeroId, SceneGardenHero>> | null = null;

/**
 * Load the cosy-island heroes, keyed by their `kit.json` id.
 *
 * DYNAMIC for the same reason as the kit and the stone: the geometry (the autumn-tree hero alone is
 * ~480 nodes) rides in its own chunk fetched only when `?garden=on` asks for it, so a studio load with
 * the flag off pays nothing for it (the megabyte-chunk precedent, inc 5/10).
 */
export function loadGardenHeroes(): Promise<Record<GardenHeroId, SceneGardenHero>> {
  heroesPromise ??= import('@storytree/procedural-architecture/kit.json').then((m) => {
    const kit = (m as { default?: KitAssetWithHeroes }).default ?? (m as KitAssetWithHeroes);
    const byId = {} as Record<GardenHeroId, SceneGardenHero>;
    for (const h of kit.heroes) byId[h.id] = { nodes: h.nodes, width: h.width, height: h.height };
    return byId;
  });
  return heroesPromise;
}

/**
 * The kit entries a given set of stories actually needs, in kit order.
 *
 * Defining the whole kit when a map shows three buildings would pay for four unused ones,
 * and `<defs>` content is still DOM. Filtering to what is referenced keeps the floor cost
 * proportional to what is on screen.
 */
export function usedFactoryBuildings(
  kit: readonly FactoryBuilding[],
  storyIds: readonly string[],
): FactoryBuilding[] {
  if (kit.length === 0) return [];
  const needed = new Set(storyIds.map((id) => factoryBuildingFor(kit, id).id));
  return kit.filter((e) => needed.has(e.id));
}

/**
 * The scale that draws a baked building at `targetHeight` map units.
 *
 * Height rather than width, because the glyph this replaces was specified by height
 * (`ICON_GLYPH.H`) and because a windmill and a mushroom differ far more in width than in
 * height — matching on width would make the windmill tower over its neighbours.
 */
export function factoryScale(b: FactoryBuilding, targetHeight: number): number {
  return b.height > 0 ? targetHeight / b.height : 1;
}

// ---------------------------------------------------------------------------
// the baked standing stone (ADR-0218) — the first landscape type in the shared scene
// ---------------------------------------------------------------------------
//
// Unlike a building (studio chrome, hidden from the shared scene-graph), the stone is a semantic UAT
// marker that lives IN the scene-graph and reaches the public website. The factory bakes ONE solid
// (the body is state-independent — the verdict rides the glow/rune overlays); the studio fold threads
// it into `SceneInput.bakedStone` behind `?factoryart=on`, and the core swaps each marker's flat body
// for a `<use>` of it. The `nodes` are the fenced paint-carrying scene vocabulary (`BakedPaintNode`).

/** The baked stone the scene composes: its resolved drawables + the box the core scales against. */
export interface BakedStoneAsset {
  nodes: BakedPaintNode[];
  width: number;
  height: number;
}

/** Resolved once and reused — the asset is immutable and the parse is not free. */
let stonePromise: Promise<BakedStoneAsset> | null = null;

/**
 * Load the baked standing stone.
 *
 * DYNAMIC for the same reason as the kit: the geometry rides in its own chunk fetched only when
 * `?factoryart=on` asks for it, so a studio load with the flag off pays nothing for it.
 */
export function loadBakedStone(): Promise<BakedStoneAsset> {
  stonePromise ??= import('@storytree/procedural-architecture/stone.json').then((m) => {
    const asset = (m as { default?: { stone: BakedStoneAsset } }).default ?? (m as { stone: BakedStoneAsset });
    const s = asset.stone;
    return { nodes: s.nodes, width: s.width, height: s.height };
  });
  return stonePromise;
}
