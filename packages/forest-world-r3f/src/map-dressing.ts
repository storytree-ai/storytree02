// map-dressing.ts — DRESS THE WHOLE MAP, ONE ISLAND AT A TIME, off the shipped descriptor stream.
//
// ⚠⚠ WHY THIS EXISTS, AND IT IS A MISREPORT GUARD RATHER THAN A FEATURE. `dressIslandFromKit` is
// named for what it dresses: ONE island. Until this module existed, `ForestWorldCanvas` handed it
// every `cell-ground` descriptor on the map in a single call — which is exactly right while the
// map holds one island and quietly wrong the moment it holds two. A capability's tree survives
// that, because it is placed from its own parcel's cells; a story's UAT BLOOM does not, because a
// bloom belongs to the whole ISLAND and is scattered over every cell it is given. One call for the
// whole map therefore scatters one story's signed criteria across every other story's island: the
// map asserting a signature on work nobody signed, which is ADR-0392 D5 / ADR-0398 D7's exact
// failure mode and worse than drawing nothing.
//
// That is why both shipped call sites passed `blooms: 0` with a comment saying so, and why closing
// it needed `InstanceDescriptor.island` first. The count is now real, and it is spent per island.
//
// ⚠ THE ACCEPTANCE QUESTION HERE IS A COUNT, NOT A PICTURE. The defect this module prevents is
// INVISIBLE: a perfectly ordinary-looking island wearing the wrong story's flowers. So the tests
// assert attribution — every bloom on an island belongs to a story that island represents, and the
// map's total equals the number of criteria the scene actually signs — on a fixture with MORE THAN
// ONE story, because a single-story fixture is satisfied by a dressing that ignores attribution
// entirely.
//
// ⚠ AND EACH ISLAND IS DRESSED IN ITS OWN CALL, so its props are placed against its own occupancy
// and nothing else. An island therefore looks the same alone as it does in a crowd of thirty-five
// — a property the whole-map call did not have and could not have had.
//
// ⚠ SINCE ADR-0600 THE VOCABULARY LAYER STANDS ONE FLOWER PER UAT CRITERION rather than one per
// SIGNED criterion — opened where the owner signed it, closed where he has not, nodding where it
// was witnessed failing. The attribution rule this module exists for is unchanged and now matters
// three times over: a story's unsigned criteria are as much a per-story claim as its signed ones,
// and scattering them over a neighbour's island would misreport that neighbour's outstanding work.
//
// ⚠ TWO ENTRY POINTS, AND THE DIFFERENCE IS WHAT STANDS — each one is a LAYER of the map's
// dressing, kept as its own function so a comparison page can render the map as it drew before any
// given landing rather than describing it.
//
//   dressMapFromKit    the vocabulary alone — one object per capability, one flower per criterion.
//                      What every comparison that ASKS about the vocabulary reads.
//   dressMapWithCover  + each healthy island's GROUND COVER — the recipe's bushes, tufts and
//                      flower patches (`cover-dressing.ts`). ⚠ THIS IS WHAT THE CANVAS STANDS.
//
// ⚠⚠ THERE WAS A THIRD, AND ITS ABSENCE IS THE DECISION. `dressMapWithGroves` stood each healthy
// island's grove between the two — thirteen stands of dressing pines per recipe-island of area,
// what the canvas stood from 2026-09-03 — and ADR-0518 retired the role outright on 2026-09-05:
// the owner read the grove as capabilities, and a tree on the map now means exactly one. No layer
// here places a `tree`. The comparison page that shows the map as it shipped until that landing
// composes its control from `harness/grove-history.ts`, outside `src/`, and nothing on the
// shipped path can reach it.
//
// Every layer is placed island by island for the same reason the blooms are — against that
// island's own ground — and the cover is placed AFTER the vocabulary, so a bush is scattered around
// the tree that reports a capability and never the other way about.

import { COVER_DENSITY, COVER_SIZE, dressCover } from './cover-dressing.js';
import { RECIPE_ISLAND_AREA, islandExclusion } from './dressing-ground.js';
import { capabilityFactsFrom, dressIslandFromKit, type KitPlacement, type RoleFootprints } from './kit-vocabulary.js';
import { cellsByIsland, parcelCellsFrom, type LayoutCell } from './parcel-cells.js';
import { type Descriptor3D, type InstanceKind } from './world-to-3d.js';

export interface MapDressingOptions {
  /** The relief amplitude the ground is built at, so props sit ON the land rather than through it. */
  relief: number;
  /** The ground width each role occupies, measured off the LOADED kit (`roleFootprints`). */
  footprint: RoleFootprints;
  /** Which rung of `COVER_DENSITY_RUNGS` a healthy island's ground cover is COUNTED at. Omitted is
   *  the shipped pick (`COVER_DENSITY`); the one-tree-per-capability page's ladder arms are what
   *  pass it, and {@link dressMapFromKit} — which grows no cover at all — ignores it. */
  coverDensity?: number;
  /** Which rung of `COVER_SIZE_RUNGS` a healthy island's ground cover is DRAWN at. Omitted is the
   *  shipped pick (`COVER_SIZE`); the cover comparison page's ladder arms are what pass it.
   *
   *  ⚠ TWO KNOBS ON ONE LAYER, laddered on two different pages and never together: size was
   *  laddered first (2026-09-04) with the count held at the recipe's own, because the literal port
   *  was near-invisible for a SCALE reason — 432 props moving 743 px past 20/255 where the canopy
   *  moved 194,440 — and the count is laddered now (ADR-0518 D2) at the settled size, because with
   *  the grove gone the cover is what carries the island. Each page varies exactly one. */
  coverSize?: number;
  /** The recipe island's area the cover counts are stated per (`cover-dressing.ts`'s
   *  `recipeIslandArea`). Omitted is the shipped `RECIPE_ISLAND_AREA`. An INSTRUMENT'S option, for
   *  a comparison page's control arm standing the map at a PREVIOUS island size (the
   *  land-per-capability page's `today`, 2026-09-05); {@link dressMapFromKit} ignores it. */
  recipeIslandArea?: number;
}

// ⚠ THERE IS NO `seed` HERE, AND ITS ABSENCE IS DELIBERATE. `dressIslandFromKit` carries its own
// default and every island is dressed with it, which is not a clone: the candidate points a
// placement chooses between are sampled from the island's OWN cells, so two islands with the same
// seed and different ground place differently. A pass-through nobody calls would be speculative
// API AND an untestable branch — `check:mutation-diff` reads `opts.seed !== undefined ? {…, seed} :
// {…}` as unkillable, because passing `seed: undefined` and omitting it behave identically.
//
// ⚠ `recipeIslandArea` IS BACK, AND FOR THE SAME REASON IT LEFT. It was threaded through both
// layers for ONE caller — the footprint page's control arm, reproducing the map in the squashed
// basis it shipped in before ADR-0517 — and went with that page, because an option with no caller
// is a default `??` nothing can flip. The land-per-capability ratio (2026-09-05) moved the basis
// again, so the page that ladders it stands its control at the previous basis through this option;
// `map-dressing.test.ts` flips the default, so the `??` is killable.

/**
 * HOW MANY UAT CRITERIA EACH STORY HAS SIGNED, read off the map's own descriptors.
 *
 * One `uat-bloom` descriptor is one signed criterion (the mapper emits them only for
 * `tall-flower-proven` — `UAT_MARKER_DESCRIPTOR`), so this is a count of what the scene ALREADY
 * asserts rather than a second opinion about proof state. The map cannot come to disagree with
 * itself about how many signatures a story holds, because there is only one source.
 *
 * ⚠ IT STILL COUNTS SIGNATURES ALONE, and after ADR-0600 that is a narrower thing than "criteria".
 * An unsigned criterion is a `uat-bud` and a failing one a `uat-wilt`, so neither can reach this
 * count — which is the point of their being separate kinds rather than one kind carrying a state.
 *
 * ⚠ A BLOOM WITH NO ISLAND IS DROPPED, and the direction of that failure is the point. An
 * unattributed signature is one that could be drawn on any island; refusing to count it means such
 * a story grows no flowers, never that every story grows its neighbour's.
 *
 * ⚠ DEDUPED ON THE CRITERION ID, so a scene that emitted a criterion twice counts it once. Blooms
 * carrying no id are counted individually — an unstamped marker is still a distinct marker, and
 * folding them all onto one absent key would under-report a scene the core simply did not stamp.
 */
export function signedCriteriaByIsland(descriptors: readonly Descriptor3D[]): Map<string, number> {
  return criteriaByIsland(descriptors, 'uat-bloom');
}

/**
 * HOW MANY UAT CRITERIA OF ONE STATE EACH STORY HOLDS, read off the map's own descriptors — the
 * general form of {@link signedCriteriaByIsland}, which is now one call to it.
 *
 * ⚠ THE STATE IS THE DESCRIPTOR KIND, not a field on it, which is why this takes a kind and not a
 * predicate. `uat-bloom` still means exactly "the owner signed this" (ADR-0392 D5 / ADR-0398 D7):
 * a caller asking for signatures cannot be handed buds by an argument it got slightly wrong.
 *
 * Both rules of the original stand unchanged for every state. A marker with no island is DROPPED,
 * so an unattributable criterion makes its story grow nothing rather than making every story grow
 * its neighbour's. And the count is DEDUPED on the criterion id, with unstamped markers counted
 * individually — an unstamped marker is still a distinct marker.
 */
export function criteriaByIsland(
  descriptors: readonly Descriptor3D[],
  kind: InstanceKind,
): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  const unnamed = new Map<string, number>();
  for (const d of descriptors) {
    if (d.kind !== kind) continue;
    const island = d.island;
    if (island === undefined) continue;
    if (d.criterion === undefined) {
      unnamed.set(island, (unnamed.get(island) ?? 0) + 1);
      continue;
    }
    const ids = seen.get(island);
    if (ids) ids.add(d.criterion);
    else seen.set(island, new Set([d.criterion]));
  }
  const out = new Map<string, number>();
  for (const [island, ids] of seen) out.set(island, ids.size);
  for (const [island, n] of unnamed) out.set(island, (out.get(island) ?? 0) + n);
  return out;
}

/**
 * EVERY PROP THE VOCABULARY STANDS, island by island — one tree per capability, one flower per
 * UAT criterion whatever its state (ADR-0600 D1), and nothing else.
 *
 * The order is first-seen island order, then the cells the substrate could not attribute — which
 * are dressed LAST and with NO blooms. Keeping them rather than dropping them is
 * {@link parcelCellsFrom}'s rule carried one level up: a substrate with no island groups at all
 * (the classic extruded-hex island, a hand-built fragment) still names its capabilities, and those
 * capabilities still own trees. What such cells may never grow is a per-STORY claim, because there
 * is no story to attribute it to.
 */
export function dressMapFromKit(
  descriptors: readonly Descriptor3D[],
  opts: MapDressingOptions,
): KitPlacement[] {
  return dressMap(descriptors, opts, false);
}

/**
 * EVERYTHING THE SHIPPED MAP STANDS — {@link dressMapFromKit} and then, on every island whose
 * every cell is healthy, that island's GROUND COVER (`cover-dressing.ts`): the recipe's bushes,
 * grass tufts and flower patches, scattered over the island against the exclusion read off the
 * same descriptor stream (`islandExclusion`: the clipped coast's beach band, the trail docks' worn
 * paths). **This is what the canvas calls**; the function above is what a comparison page's
 * vocabulary arm calls.
 *
 * ⚠ THE ORDER IS PART OF THE PLACEMENT, exactly as it is for the criterion markers: capabilities,
 * then the island's criteria, then its cover — so a bush is scattered around everything that reports
 * something, and never the other way about. Cover keeps no clearance (`clearanceFactor` returns
 * zero for it, which is the recipe's own rule), so the ORDER is what carries the relationship
 * rather than an occupancy: the things that report are placed first and are therefore placed on
 * the ground they would have had with no cover at all. Adding or removing the cover pass cannot
 * move a single tree.
 */
export function dressMapWithCover(
  descriptors: readonly Descriptor3D[],
  opts: MapDressingOptions,
): KitPlacement[] {
  return dressMap(descriptors, opts, true);
}

/**
 * EVERYTHING THE SHIPPED MAP STANDS, together with the island that produced each placement.
 *
 * The map owns this identity while it dresses one island at a time. Keeping it in a side map
 * leaves {@link KitPlacement} as the vocabulary's placement-only value, while delivery can carry
 * the exact placement object through its mesh merge without inventing a second placement stream.
 * Placements from cells with no island deliberately have no entry: they can name a capability,
 * but no story whose growth data they could carry.
 */
export function dressMapWithCoverAttribution(
  descriptors: readonly Descriptor3D[],
  opts: MapDressingOptions,
): { placements: KitPlacement[]; islandByPlacement: ReadonlyMap<KitPlacement, string> } {
  const islandByPlacement = new Map<KitPlacement, string>();
  const placements = dressMap(descriptors, opts, true, islandByPlacement);
  return { placements, islandByPlacement };
}

function dressMap(
  descriptors: readonly Descriptor3D[],
  opts: MapDressingOptions,
  cover: boolean,
  islandByPlacement?: Map<KitPlacement, string>,
): KitPlacement[] {
  const cells = parcelCellsFrom(descriptors);
  // ⚠⚠ ALL THREE STATES, COUNTED SEPARATELY AND SPENT SEPARATELY (ADR-0600 D1). An island's flower
  // count is its CRITERION count now, not its signature count — which is the whole correction:
  // counted over the live corpus on 2026-09-23, signatures alone left 35 of 104 criteria with
  // nothing drawn, nine islands reading as carrying no acceptance work at all and three reading as
  // fully proven while holding criteria nobody had signed.
  const signed = criteriaByIsland(descriptors, 'uat-bloom');
  const unsigned = criteriaByIsland(descriptors, 'uat-bud');
  const failing = criteriaByIsland(descriptors, 'uat-wilt');
  const out: KitPlacement[] = [];

  // ⚠ THE COUNTS ARE PASSED IN RATHER THAN LOOKED UP HERE, and the unattributed call below states
  // its own three zeros. Reading them off a nullable island id instead would put three
  // `island === null ? 0 : …` branches on a path no fixture can take — an unattributed cell set
  // names no capability and places nothing whatever it is handed, so the branches are unkillable
  // by construction (measured, on this landing).
  const dress = (
    group: readonly LayoutCell[],
    criteria: { blooms: number; buds: number; wilts: number },
  ): KitPlacement[] =>
    dressIslandFromKit({
      cells: group,
      facts: capabilityFactsFrom(group),
      ...criteria,
      relief: opts.relief,
      footprint: opts.footprint,
    });

  for (const [island, group] of cellsByIsland(cells)) {
    const vocabulary = dress(group, {
        blooms: signed.get(island) ?? 0,
        buds: unsigned.get(island) ?? 0,
        wilts: failing.get(island) ?? 0,
      });
    out.push(...vocabulary);
    for (const placement of vocabulary) islandByPlacement?.set(placement, island);
    if (!cover) continue;
    const covered = dressCover({
        island,
        cells: group,
        relief: opts.relief,
        // ⚠ ONE EXCLUSION PER ISLAND, read off the same stream the ground is built from. It
        // carries a `shoreField` and a `wearField` over the island's whole ground — the expensive
        // part of dressing a map — and it is built here rather than inside `dressCover` so the
        // layer stays provable with an INJECTED exclusion (`cover-dressing.test.ts`).
        exclusion: islandExclusion(descriptors, island),
        density: opts.coverDensity ?? COVER_DENSITY,
        size: opts.coverSize ?? COVER_SIZE,
        recipeIslandArea: opts.recipeIslandArea ?? RECIPE_ISLAND_AREA,
      });
    out.push(...covered);
    for (const placement of covered) islandByPlacement?.set(placement, island);
  }

  // ⚠ CALLED UNCONDITIONALLY, EVEN WHEN THERE IS NOTHING TO DRESS. An `if (unattributed.length)`
  // guard reads as thrift and is a branch no test can kill: dressing an empty cell set names no
  // capability and places no bloom, so it appends nothing and the two paths are indistinguishable.
  // ⚠ AND NO COVER, AND NO CRITERION OF ANY STATE: a cell the substrate could not attribute belongs
  // to no STORY, so there is no story status for it to be healthy IN and no story whose acceptance
  // work it could report — the same fail-closed rule the signed criteria alone already followed.
  out.push(
    ...dress(
      cells.filter((c) => c.island === undefined),
      // Stryker disable next-line ObjectLiteral: EQUIVALENT, and stated precisely rather than
      // claimed in general. Stryker rewrites this to `{}`, so all three counts arrive `undefined`;
      // `dressIslandFromKit` clamps each with `Math.max(0, n)`, which is `NaN`, and
      // `Array.from({ length: NaN })` is EMPTY — so the mutant stands exactly the nothing these
      // three zeros stand. The literal is kept rather than dropped because it is the only place a
      // reader learns that an unattributed cell set draws no criterion OF ANY STATE, which is a
      // different statement from "it happens to draw none".
      { blooms: 0, buds: 0, wilts: 0 },
    ),
  );

  return out;
}
