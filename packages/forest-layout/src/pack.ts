// pack.ts — WHERE THE ISLANDS SIT.
//
// The dependency-ranked territory seeder, the hex growth floor and its one-hex moat, the
// round-robin grower, the per-island garden ring and coastline, and the trail routing over the
// result: given a set of stories, which island goes where and how much water sits between them.
//
// ⚠ IT LIVED IN `apps/studio/src/components/TreeView.tsx` UNTIL THIS PACKAGE EXISTED, and moving it
// was a DECISION rather than a tidy-up (ADR-0537 D1, owner-directed: *"pay the cost now"*). Two
// forces had kept it surface-side. The first was a TOLL: `packages/forest-world/src` reaches the
// public website through a wholesale sync, so touching it owed an engine sync and a web pin bump —
// which is why the studio held a deliberate local copy of `groundPolarOffset` rather than reaching
// for the shared one. The second was real and is ADR-0093's: this code was tangled with studio
// CHROME — the `render: building` class, the ADR-0102 icon promotion, the bookshelf consumers — and
// dragging that into a package whose whole point is to depend on nothing would have been the wrong
// trade. ADR-0537 ruled the toll may not draw the boundary, and paid the separation exercise the
// chrome entanglement really costs. THE CHROME DID NOT COME WITH IT: it stayed at the seam and is
// INJECTED ({@link PackOptions.carriedIcons}, and the caller's own exclusion of the stories it does
// not want laid out). If a consumer finds it needs chrome in here, the seam is wrong — fix the
// seam, do not widen this package.
//
// ⚠ AND IT LANDS UNDER A BINDING CONSTRAINT: the move changed the map by NOTHING. The proof is
// `apps/studio/src/components/buildWorld.relocation.{test,fixture}.ts` and its golden, captured
// from the packer as it stood inside `TreeView.tsx` and committed BEFORE a line of it moved.
//
// Pure and browser-safe: no React, no DOM, no store, no `node:` imports. Everything random here
// (tile growth, seed jitter, coast thinning) is hashed from ids, so the same stories lay out
// identically every time.

import {
  hash,
  rand01,
  type Pt,
  type Axial,
  HEX_R,
  HEX_W,
  TILE_DEPTH,
  TILE_DEPTH_WORLD,
  groundRadiusToScreenHalfHeight,
  unprojectGround,
  uprightForeshortening,
  PLAN_VIEW_ELEVATION_DEG,
  LAND_CAMERA_ELEVATION_DEG,
  groundPolarOffset,
  axialKey,
  AXIAL_DIRS,
  hexCenter,
  pixelToHex,
  hexDist,
  hexCorners,
  ringsOf,
  estRadius,
  tileQuota,
  tileUnits,
  COAST_OUTSET_ON_TILE,
  crownRadiusWorld,
  storyTreeReach,
  storyEdges,
  rankStories,
  descendantCounts,
  smoothCoast,
  type BoundarySeg,
  type SceneEmptyHex,
  routeTrails,
  projectTrailNetwork,
  type TrailIsland,
  type TrailNetwork,
} from '@storytree/forest-world';
import {
  ISLAND_SPACING_RATIO,
  gapBetween,
  inRowGapWithChrome,
  loneSwing,
  rankGapWithChrome,
  type ChromeClearance,
  type LegacySpacing,
} from './spacing.js';

// ---------- the input contract this package owns ----------
//
// The `@storytree/forest-world` pattern one level up (`RankStory` / `EdgeStory`): the packer
// declares the MINIMUM a story must expose and nothing more, so the studio's `TreeStory` and the
// website's own story type are both structurally assignable and each surface hands its own richer
// object straight in — and gets it back untouched on `Territory.story`. Notably ABSENT: anything
// about how a story is rendered. `building`, `status`, `verdict` and the rest are the surface's
// vocabulary, not the layout's.

/** The minimum a capability must expose to be gardened and to derive cross-story edges. */
export interface LayoutCapability {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

/** The minimum a story must expose to be ranked, sized, seeded, grown and routed. */
export interface LayoutStory {
  readonly id: string;
  readonly dependsOn: readonly string[];
  readonly capabilities: readonly LayoutCapability[];
}

/** The spacing dial {@link packWorld} takes (ADR-0521).
 *  `ratio` is the fraction of the mean island radius every gap is (absent ⇒ the shipped
 *  {@link ISLAND_SPACING_RATIO}); `legacy` is an INSTRUMENT'S option — the three pre-ADR-0521
 *  absolute gaps, so a comparison page's control arm can stand the map as it stood before that
 *  landing. When both are given, `legacy` wins, because a control that silently took the ratio
 *  would compare the ladder against one of its own rungs. */
export interface SpacingTuning {
  ratio: number;
  legacy?: LegacySpacing;
}

/** Everything {@link packWorld} takes beyond the stories themselves. */
export interface PackOptions {
  /** `?plants=scatter` (VISUAL SPIKE): widen each garden plant's angle wobble and spread its
   *  radius across a BAND rather than one ring, so the garden reads as an organic orchard. */
  plantsScatter?: boolean;
  /** ADR-0521 — the spacing dial; absent ⇒ the shipped {@link ISLAND_SPACING_RATIO}. */
  spacing?: Partial<SpacingTuning>;
  /** THE CHROME SEAM (ADR-0537 D1). Island id → the icon ids that island CARRIES, decided by the
   *  caller and merely SEATED here. It is the ADR-0102 promotion — "you carry the icon of what you
   *  depend on", computed from a `render: building` class this package deliberately knows nothing
   *  about. Absent ⇒ no island carries anything, which is exactly the bare call. The caller also
   *  owns the other half of that rule: a story it does not want laid out at all is one it does not
   *  pass in. */
  carriedIcons?: ReadonlyMap<string, readonly string[]>;
  /** THE OTHER HALF OF THE CHROME SEAM (ADR-0598 D2) — how much GROUND this surface's own nameplate
   *  needs, so a plate never lands on a neighbouring island's land. Injected for the same reason
   *  `carriedIcons` is: this package is chrome-free and does not know what a nameplate looks like,
   *  and (unlike an icon) the conversion from a fixed pixel plate to ground is CAMERA-DEPENDENT,
   *  which is the one dependency the packer may not have. Absent ⇒ no clearance and the map is
   *  byte-unchanged — the control arm. See {@link ChromeClearance}. */
  chrome?: ChromeClearance;
  /** WHICH CAMERA THE SCREEN HALF OF THIS LAYOUT IS PROJECTED AT (ADR-0527 D1 item 1); absent ⇒
   *  the shipped {@link LAND_CAMERA_ELEVATION_DEG}, so every existing caller is byte-unchanged.
   *
   *  ⚠ IT MOVES THE SCREEN HALF ONLY, AND THAT IS NOW TRUE OF THE WHOLE PACKER rather than a
   *  promise with one exception. Everything this packer DECIDES — which tile a story grows onto,
   *  which capability owns which ground, where the coast runs — is taken at
   *  {@link PLAN_VIEW_ELEVATION_DEG} and is camera-independent, so asking for another elevation
   *  re-projects the drawing without re-deciding the layout (ADR-0527 D1, ADR-0546 D1). Every
   *  ground twin (`groundSeed`, `groundCentroid`, `groundTreeSpot`, `groundSpot`, `groundLabelY`,
   *  the coast loops) is derived that way, and the SEED SNAP — the one site that used to read a
   *  camera, and so let the camera decide the layout — was repaired by
   *  `the-packer-decides-in-ground-space-not-through-the-camera`. See that call's own comment for
   *  why it hid, and `Territory.groundSeed` for the field that makes it checkable.
   *
   *  It exists so `the-two-layers-share-one-elevation` can RENDER both arms. ADR-0593 D1 has since
   *  settled which elevation the two layers share — 50 degrees, both of them. */
  elevationDeg?: number;
}

// ---------- the laid-out world ----------

export interface CapSpot<C = LayoutCapability> {
  cap: C;
  x: number;
  y: number;
  /** The SAME spot before the camera (ADR-0527 D1) — what `buildScene` is handed, and what it
   *  projects back to `x`/`y` when it draws at the declared camera. Derived, never un-projected:
   *  the ground bearing and radius the scatter already reasons in, added to the ground tree spot. */
  groundSpot: Pt;
}

/** A conifer-clump spot (wheat is a tile-top fill, tracked in wheatTiles). */
export interface DecorSpot {
  x: number;
  y: number;
  seed: number;
}

export interface Territory<S extends LayoutStory = LayoutStory> {
  /** The caller's OWN story object, carried through untouched — the packer reads only the
   *  {@link LayoutStory} fields and never narrows what it hands back. */
  story: S;
  tiles: Axial[];
  centroid: Pt;
  /** px from centroid to the farthest tile centre, plus the tile radius — SCREEN-projected (the
   *  declared land camera), NOT a ground distance. Feeds `SceneTerritoryInput.screenRadius`
   *  (`scene-territory-radius-states-its-space`). */
  radius: number;
  /** The same reach, computed from UNPROJECTED (`PLAN_VIEW_ELEVATION_DEG`) tile centres — an
   *  isotropic ground-plane magnitude, camera-independent. Feeds `SceneTerritoryInput.groundRadius`.
   *  Same formula `trailIslands` below already uses for routing; kept here too so every consumer of
   *  the built `Territory` — not just the router — can read a true ground radius. */
  groundRadius: number;
  /** Where the central story tree stands (the tile nearest the centroid). */
  treeSpot: Pt;
  /** `centroid` before the camera — the tile centres at `PLAN_VIEW_ELEVATION_DEG`, the same source
   *  `groundRadius` above is measured from. Feeds `SceneTerritoryInput.centroid` under
   *  `anchorSpace: 'ground'`. Its projected twin STAYS, because this file's own React renderer draws
   *  at the declared camera and wants screen — the two are not a redundancy, they are two consumers
   *  with different needs, exactly like `radius` / `groundRadius`. */
  groundCentroid: Pt;
  /** `treeSpot` before the camera. Derived from the same tile, never by un-projecting the drawing —
   *  which is the move ADR-0527 D2 exists to delete rather than to spread. */
  groundTreeSpot: Pt;
  /** WHERE THE SPACING MATH PUT THIS ISLAND, in GROUND units, BEFORE the hex lattice quantised it
   *  — the raw output of `spacing.ts`'s row/gap arithmetic, which carries no camera term at all.
   *
   *  ⚠ IT IS PUBLISHED TO MAKE AN INVARIANT OBSERVABLE, not because a renderer wants it. The seed
   *  snap let the camera decide which tiles a story grew onto for as long as it did precisely
   *  because nothing outside this function could see the point being snapped: a test could compare
   *  two packs at two cameras, but two packs snapped at the SAME wrong constant agree with each
   *  other, so that comparison cannot separate "camera-independent" from "camera-independent and
   *  wrong". With the pre-snap point in hand the claim is direct — the seed tile's centre at
   *  {@link PLAN_VIEW_ELEVATION_DEG} is this point, to within the lattice's own rounding — and it
   *  fails for EVERY basis but plan view, since `pixelToHex` at elevation θ stretches ground `y` by
   *  `1 / sin θ` before rounding. `pack.test.ts`'s `the seed snap is taken in GROUND space` is the
   *  test; `the-packer-decides-in-ground-space-not-through-the-camera` is why it exists.
   *
   *  ⚠ NOT THE SAME POINT AS `groundTreeSpot`, and the gap is real: this is the pre-quantisation
   *  ANCHOR, while `groundTreeSpot` is a TILE CENTRE the island actually owns, chosen near its
   *  grown centroid. They agree only to within a hex, and on a crowded rank the growth floor nudges
   *  the snapped seed east, which widens the gap further. Read this one for "what did the layout
   *  ask for", that one for "where does the tree stand". */
  groundSeed: Pt;
  caps: CapSpot<S['capabilities'][number]>[];
  decor: DecorSpot[];
  wheatTiles: Set<string>;
  /** Smoothed organic coastline as closed point loops in the GROUND plane — the island's sand
   *  fill AND its water moat (one curve, filled then stroked). ADR-0527 D1: the layout hands out
   *  a SURFACE, and whoever draws it projects for itself. It used to be `coastPaths`, `d` strings
   *  this function had already projected and smoothed, which made the coast the one island input
   *  that reached `buildScene` as a finished drawing.
   *
   *  The screen-space `coastLoops` that stood beside it is DELETED (ADR-0527 D4): its doc said it
   *  was "for docking river mouths to the shore", and the river fan went — `RIVER_FAN_STEP`,
   *  `RIVER_FAN_MAX`, `LANE_GAP`, `LANE_WINDOW` and `MOUTH_FLARE` are all unused constants that
   *  `pnpm lint` reports. Nothing outside this file's own declaration and assignment ever read it. */
  coastGroundLoops: Pt[][];
  /** The nameplate baseline, SCREEN-projected at the declared land camera — what this file's own
   *  React renderer draws the plate at. */
  labelY: number;
  /** The same baseline before the camera: the ground line the nameplate stands on, south of the
   *  island's own southernmost tile. Feeds `SceneTerritoryInput.labelY` under `anchorSpace:
   *  'ground'`, which is what lets the marker scatter and the garden ask "is this spot in front of
   *  the plate?" on the GROUND rather than on the screen (ADR-0545) — the last member of the
   *  screen-vs-ground bug class `scatter-camera.test.ts` fences.
   *
   *  An independently-computed twin of `labelY`, exactly like `groundRadius` / `radius`: derived
   *  from the plan-view tile centres rather than by un-projecting the drawing, which is the move
   *  ADR-0527 D2 exists to delete rather than to spread. `label-baselines-are-twins` in
   *  `pack.test.ts` holds the two to `groundLabelY · sin θ = labelY`. */
  groundLabelY: number;
  /** Per-island ICON STAMPS this island CARRIES (ADR-0102): one entry per promoted edge incident
   *  to a `render: building` island, "you carry the icon of what you depend on". `icon` is the id
   *  whose identity glyph is drawn ({@link storyIcon}); `spot` is its seat on owned land. An island
   *  can carry SEVERAL (studio carries both `library` and `cli`). On the map a carried icon is
   *  always a BUILDING (promotion is building-incident) → each names a shared island. Empty for an
   *  island the caller listed no carried icons for. THE PACKER DOES NOT DECIDE THESE: which island
   *  carries which icon is the ADR-0102 promotion, a studio render-class rule, handed in through
   *  {@link PackOptions.carriedIcons}. The packer only seats them on owned land. */
  stamps: { icon: string; spot: Pt }[];
  /** This island IS a building rendered with a bookshelf glyph WITHIN its nameplate (the
   *  enlarged landmark card, {@link nameplateLayout} building branch). ALWAYS false on the map
   *  (ADR-0088: building-class stories no longer render in the forest); set true only by the
   *  Shared Islands PANEL, which builds a one-island Territory per building story and renders it
   *  with {@link TerritoryFlora}. */
  buildingGlyph: boolean;
}

export interface HexWorld<S extends LayoutStory = LayoutStory> {
  territories: Territory<S>[];
  /** Pale coast tiles (1–2 rings beyond claimed land), each carrying the index of the territory
   *  whose land it grew out of (ADR-0286 — the handle the Act 2 regrow's per-story hide needs;
   *  `SceneEmptyHex.owner`). */
  empties: SceneEmptyHex[];
  /** Claimed tiles in global back-to-front draw order, with territory index. */
  drawTiles: { h: Axial; owner: number }[];
  /** The `depends_on` edges routed as the ADR-0169 trail network (BOTH layouts — the
   *  one road model since the docked lines retired): shared segments (a trunk renders
   *  once), per-edge ordered segment chains, forced cave portals. Hidden by default;
   *  revealed on island focus (§3). Empty (no segments) when there are no edges. */
  trails: TrailNetwork;
  width: number;
  height: number;
  offset: Pt;
}

const MARGIN = tileUnits(60); // authored as 60 on the radius-27 tile (ADR-0528)
/** The water between any two islands' tiles, in hexes (ADR-0528 D5) — see the growth floor in
 *  {@link packWorld}. One is the smallest separation the lattice can express, and it is derived from
 *  what the 3D map does with a tile rather than picked by eye: the island is sized to its ratio about
 *  its centre and wears a coast outset, so touching tiles overlap in 3D and one hex apart does not. */
const MOAT_HEXES = 1;

/** The PEAK-TO-PEAK seed jitter, in ground units — the wobble `packWorld` adds to each seed after
 *  the row/gap arithmetic has placed it, so a rank does not read as a ruled line. Named rather than
 *  inline because the chrome clearance has to RESERVE it (ADR-0598 D2): a gap sized exactly to fit a
 *  nameplate and then handed two islands that each wander half a jitter toward each other is a gap
 *  that does not fit a nameplate. Reserving it is the difference between a clearance that holds and
 *  one that holds on average — and "on average" is what the measured residue looked like: with the
 *  band reserved but the jitter not, the real forest still showed a plate on a neighbour's land, and
 *  WHICH plate moved with the rung rather than with the spacing, which is the signature of a
 *  lottery rather than of a gap that is too small. */
const SEED_JITTER_X = tileUnits(44);
const SEED_JITTER_Y = tileUnits(30);


/**
 * The island's HERO TILE — the tile the story's own tree stands on: the one nearest the island's
 * centroid ON THE GROUND (`studio-island-layout-moves-to-ground-space`, ADR-0367 D1's fault class).
 *
 * It used to be an argmin over PROJECTED centres against the PROJECTED centroid. The declared camera
 * compresses the depth axis by `sin 20° ≈ 0.342`, so a tile displaced along the ground's depth looks
 * NEARER on screen than it is and the argmin systematically preferred it — a hero tree standing
 * where the camera put it rather than where the island's middle is. Measured on the code this
 * replaced: the projected answer differs from this one on 224 of 1,600 synthetic grown islands
 * (14.00%) and on 5 of the shipped corpus's 35 islands (14.29%), each by a whole tile — 46.8 ground
 * px. (The increment cited 26.8% from an earlier sweep; that magnitude did NOT reproduce, though the
 * class and its direction did — see the increment's closure.)
 *
 * A function of the TILE SET ALONE. It reads no camera, so its answer cannot move when the camera
 * does — the invariant is structural here, not merely asserted. `undefined` only for an empty tile
 * set, which `packWorld` never has (it falls back to the island's seed regardless).
 *
 * Ties break toward the earliest tile in input order, exactly as the `Array.prototype.sort` this
 * replaced did (a stable sort keeps the first of an equal pair).
 */
export function groundHeroTile(tiles: readonly Axial[]): Axial | undefined {
  // EQUIVALENT — with the early return gone an empty tile list still yields `undefined`: `centers` is
  // empty, the centroid is NaN, `gaps` is empty, `best` stays 0, and `tiles[0]` IS undefined. Same answer,
  // one guard's work later.
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — see the note above.
  if (!tiles.length) return undefined;
  const centers = tiles.map((h) => hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }));
  const centroid: Pt = {
    x: centers.reduce((s, p) => s + p.x, 0) / centers.length,
    y: centers.reduce((s, p) => s + p.y, 0) / centers.length,
  };
  // ground-space: `centers` are `hexCenter` at PLAN_VIEW_ELEVATION_DEG — the pre-camera tile
  // positions — so this is a true ground separation and the argmin is camera-independent.
  const gaps = centers.map((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y));
  let best = 0;
  // EQUIVALENT / NON-TERMINATING — `k <= gaps.length` reads one slot past the end, where `?? Infinity`
  // loses every comparison, so `best` cannot move; `k--` never advances toward the bound and does not
  // terminate, so no test can observe a result.
  // Stryker disable next-line EqualityOperator,UpdateOperator: EQUIVALENT / NON-TERMINATING — see the note above.
  for (let k = 1; k < gaps.length; k++) {
    if ((gaps[k] ?? Infinity) < (gaps[best] ?? Infinity)) best = k;
  }
  return tiles[best];
}


export function packWorld<S extends LayoutStory>(
  stories: readonly S[],
  opts?: PackOptions,
): HexWorld<S> {
  const plantsScatter = opts?.plantsScatter ?? false;
  // THE ONE PLACE THE CAMERA IS RESOLVED, so no site below can quietly read a different one.
  const elevationDeg = opts?.elevationDeg ?? LAND_CAMERA_ELEVATION_DEG;
  // `TILE_DEPTH` (`@storytree/forest-world`) is a MODULE-LEVEL constant, frozen at whatever
  // `LAND_CAMERA_ELEVATION_DEG` reads at import time — it cannot itself take an `elevationDeg`
  // argument. Every SCREEN-space site below that used to read it directly was silently drawing
  // the extrusion at the SHIPPED camera even when this call asked for another one (the same class
  // of gap the seed-snap fix above closes). This re-derives it from its ground input
  // (`TILE_DEPTH_WORLD`) at the camera THIS call actually resolved, so it moves with `elevationDeg`
  // the way `hexHalfHeight` beside it already does. `groundLabelY` below is the one place that
  // must NOT use this — it deliberately stays keyed to the frozen `TILE_DEPTH` (see its own
  // comment): a ground twin is unmoved by this option BY DESIGN.
  const tileDepth = TILE_DEPTH_WORLD * uprightForeshortening(elevationDeg);
  // ⚠ A NAMED WRAPPER RATHER THAN `hexCenter` AT EACH SITE, and it is the fix for the trap the
  // comments below document at length: `.map(hexCenter)` feeds each tile's ARRAY INDEX into the
  // options slot. This closes over the resolved camera and takes exactly one argument, so a
  // point-free `.map(screenCenter)` is now SAFE — the shape that used to be the bug.
  const screenCenter = (h: Axial): Pt => hexCenter(h, { elevationDeg });
  // ADR-0521: every gap is a fraction of the islands it separates — `gapBetween` over the two
  // estimated radii — and a lone island's swing is the offset a same-row neighbour would have had.
  // The `legacy` triple is the pre-ADR-0521 map, for a comparison page's control arm only.
  const spacingRatio = opts?.spacing?.ratio ?? ISLAND_SPACING_RATIO;
  const legacy = opts?.spacing?.legacy;
  // ADR-0598 D2 — the nameplate's own room, in ground units, as the CALLER measured it. Absent ⇒ 0,
  // which is the pre-ADR-0598 map; `scale` is the owner's scale-back dial over the same arm.
  // ⚠ THE LEGACY CONTROL ARM TAKES NO CLEARANCE EITHER — it stands the map as it was before
  // ADR-0521, and a control silently given room that map never had would be comparing the ladder
  // against something that has never shipped. That refusal lives in the two `legacy ?` branches
  // below and NOWHERE ELSE, deliberately: it was written twice at first (here as well, zeroing the
  // scale), and fault-seeding showed the pair made each other unwitnessed — removing either copy
  // left the other enforcing it, so no test could tell a working guard from a broken one.
  const chromeScale = opts?.chrome?.scale ?? 1;
  const rowBand = (opts?.chrome?.rowBand ?? 0) * chromeScale;
  const plateHalfWidth = (id: string): number =>
    (opts?.chrome?.plateHalfWidth.get(id) ?? 0) * chromeScale;
  // The jitter is reserved ON TOP of whatever the caller asked for, and only when it asked for
  // something: a zero clearance stays exactly zero, which is what keeps the control arm byte-exact.
  const reserve = (band: number, jitter: number): number => (band > 0 ? band + jitter : 0);
  const rankGapFor = (below: number, tallest: number): number =>
    legacy
      ? legacy.rankGap
      : rankGapWithChrome(below, tallest, spacingRatio, reserve(rowBand, SEED_JITTER_Y));
  const islandGapFor = (left: number, right: number, idLeft: string, idRight: string): number => {
    if (legacy) return legacy.islandGap;
    const halves = plateHalfWidth(idLeft) + plateHalfWidth(idRight);
    return inRowGapWithChrome(left, right, spacingRatio, reserve(halves, SEED_JITTER_X), 0);
  };
  const rankSwingFor = (lone: number): number => (legacy ? legacy.rankSwing : loneSwing(lone, spacingRatio));

  // Hubs are sized like any other island (owner call 2026-06-19 — "make them like any
  // other island; work out the look later"). Their hub-ness is carried by the LAYOUT
  // (centred, everything orbits + spokes converge), not by a distinct size/skin.
  // ADR-0528 D1: one tile per capability — a drawn island IS `capabilities × 318 units²`, the island
  // the 3D map sizes it to (ADR-0520). The retired `max(3, capabilities + 2)` was the last by-eye
  // number on the layout path; `tileQuota` carries the rule and its floor.
  const quotas = stories.map((s) => tileQuota(s.capabilities.length));

  // One edge set drives BOTH the roads and the ranking (declared ∪ derived).
  const edgeList = storyEdges(stories);
  const depsOf = new Map<string, string[]>(stories.map((s) => [s.id, []]));
  // EQUIVALENT — seeding every entry with the same bogus dependent adds exactly 1 to EVERY story's
  // descendant count, and the only thing that count feeds is the foundation row's descending order, which a
  // uniform shift cannot change.
  // Stryker disable next-line ArrayDeclaration: EQUIVALENT — see the note above.
  const dependentsOf = new Map<string, string[]>(stories.map((s) => [s.id, []]));
  for (const e of edgeList) {
    // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction above
    // makes it unreachable: `depsOf` was built one statement above with an entry per story, and every edge
    // endpoint is a story id.
    // Stryker disable next-line OptionalChaining: EQUIVALENT (type-forced) — see the note above.
    depsOf.get(e.to)?.push(e.from);
    // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction above
    // makes it unreachable: `dependentsOf` likewise.
    // Stryker disable next-line OptionalChaining: EQUIVALENT (type-forced) — see the note above.
    dependentsOf.get(e.from)?.push(e.to);
  }

  // Dependency-ranked seeds (ADR-0036 d.6a): the most-depended-upon stories sit
  // bottom-centre and dependents fan upward and outward. Rank rows stack from
  // the bottom; within a row, stories order by the barycenter of their already-
  // placed dependencies (load-bearing count for the foundation row).
  // ADR-0088: building-class stories are no longer in `stories` (they live in the Shared
  // Islands panel), so there is no edgeless island to pin to the foundation row anymore — the
  // natural dependency ranks drive the layout directly.
  const naturalRanks = rankStories(stories, depsOf);
  const ranks = new Map<string, number>(stories.map((s) => [s.id, naturalRanks.get(s.id) ?? 0]));
  const loadBearing = descendantCounts(stories, dependentsOf);
  const maxRank = Math.max(0, ...ranks.values());
  const byRank: number[][] = Array.from({ length: maxRank + 1 }, () => []);
  // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction above
  // makes it unreachable: `byRank` is built with `maxRank + 1` entries and `ranks` is total over `stories`.
  // Stryker disable next-line OptionalChaining: EQUIVALENT (type-forced) — see the note above.
  stories.forEach((s, i) => byRank[ranks.get(s.id) ?? 0]?.push(i));

  // Row centre-lines, bottom-up: clearance for the tallest territory on each side.
  const rowY: number[] = [];
  let yCursor = 0;
  // NON-TERMINATING — `r--` runs the counter away from `maxRank`.
  // Stryker disable next-line UpdateOperator: NON-TERMINATING — see the note above.
  for (let r = 0; r <= maxRank; r++) {
    // EQUIVALENT — `byRank` has an entry per rank, so the fallback is unreachable.
    // Stryker disable next-line ArrayDeclaration: EQUIVALENT — see the note above.
    const tallest = Math.max(...(byRank[r] ?? []).map((i) => estRadius(quotas[i] ?? 3)), HEX_R);
    if (r === 0) yCursor = -tallest;
    else {
      const below = Math.max(
        // EQUIVALENT — as above.
        // Stryker disable next-line ArrayDeclaration: EQUIVALENT — see the note above.
        ...(byRank[r - 1] ?? []).map((i) => estRadius(quotas[i] ?? 3)),
        HEX_R,
      );
      yCursor -= below + tallest + rankGapFor(below, tallest);
    }
    rowY.push(yCursor);
  }

  const seedPx = new Map<number, Pt>();
  const baryOf = (idx: number): number => {
    const s = stories[idx];
    // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction above
    // makes it unreachable: `idx` came from `byRank`, which was built by iterating `stories`.
    // Stryker disable next-line ConditionalExpression: EQUIVALENT (type-forced) — see the note above.
    if (!s) return 0;
    // EQUIVALENT for the `[]` (`depsOf` has an entry per story). ⚠ THE CHAIN MUTANT IS NOT EQUIVALENT AND
    // IS NOT WITNESSED: dropping the filter/map leaves `baryOf` returning a mean ARRAY INDEX where it
    // should return a mean seed x. No corpus in `pack.test.ts` separates the two, because the packer
    // expresses "a rank sits over its dependencies" as a ROW barycentre followed by a left-to-right pack —
    // every arrangement tried, including a wide foundation row with a deliberately off-centre host, leaves
    // the dependent packed BY ITS ROW rather than seated over its own dependency, where both readings
    // agree. Killing it wants a witness for the barycentre itself, which this function does not expose.
    // Stryker disable next-line ArrayDeclaration,MethodExpression: EQUIVALENT for the `[]`; the chain mutant is UNWITNESSED — see the note above.
    // ⚠ THREE STATEMENTS, NOT ONE CHAIN, AND THE REASON IS THE INSTRUMENT rather than taste. This was
    // `(depsOf.get(...) ?? []).map(...).filter(...).map(...)`, and a `Stryker disable next-line` written
    // INSIDE a member chain does not reach the mutant on the line below it — the whole chain is one
    // statement, so the directive has no line of its own to bind to and four mutants stayed alive
    // through a pass that tried. Splitting it gives each step a statement the directive can name, and
    // the golden in `relocation.test.ts` is what says the split changed nothing.
    const depIndices = (depsOf.get(s.id) ?? []).map((d) => stories.findIndex((o) => o.id === d));
    // EQUIVALENT — both conjuncts are dead by construction. `depsOf` only ever holds ids that are IN
    // `stories` (`storyEdges` filters by `ids.has`), so `findIndex` never returns -1; and `rankStories`
    // gives every dependency a strictly lower rank than its dependent while rows are seeded bottom-up,
    // so a dependency is always already in `seedPx`.
    // …and for the same reason the whole filter is removable without effect, which is the mutant the
    // split above created: with both conjuncts dead, `placed` and `depIndices` are the same array.
    // Stryker disable next-line ConditionalExpression,LogicalOperator,MethodExpression: EQUIVALENT — see above.
    const placed = depIndices.filter((j) => j >= 0 && seedPx.has(j));
    // EQUIVALENT — guarded by the `seedPx.has(j)` filter one statement above.
    // Stryker disable next-line OptionalChaining: EQUIVALENT — see the note above.
    const xs = placed.map((j) => seedPx.get(j)?.x ?? 0);
    return xs.length ? xs.reduce((p, c) => p + c, 0) / xs.length : 0;
  };
  // ADR-0283 D2: DAG ROWS, unconditionally. The `solar` (ADR-0074 §6) and `stress` (ADR-0171)
  // seedings that used to branch here are retired as selectable arrangements — one layout means
  // one thing every growth choreography has to be correct against.
  // NON-TERMINATING — as the row loop above.
  // Stryker disable next-line UpdateOperator: NON-TERMINATING — see the note above.
  for (let r = 0; r <= maxRank; r++) {
    // EQUIVALENT — `byRank` has an entry per rank.
    // Stryker disable next-line ArrayDeclaration: EQUIVALENT — see the note above.
    const row = byRank[r] ?? [];
    const ordered = [...row].sort((a, b) => {
      const sa = stories[a];
      const sb = stories[b];
      // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction above
      // makes it unreachable: both indices came from `byRank`.
      // Stryker disable next-line ConditionalExpression,LogicalOperator: EQUIVALENT (type-forced) — see the note above.
      if (!sa || !sb) return 0;
      if (r === 0) {
        // Foundation row: most load-bearing in the middle, others outward.
        return (loadBearing.get(sb.id) ?? 0) - (loadBearing.get(sa.id) ?? 0);
      }
      return baryOf(a) - baryOf(b) || (hash(sa.id) % 997) - (hash(sb.id) % 997);
    });
    // Pack the row left-to-right around its dependency barycenter. The
    // foundation row interleaves centre-out (most load-bearing in the middle).
    let display = ordered;
    if (r === 0) {
      display = [];
      ordered.forEach((i, k) => {
        if (k % 2 === 0) display.push(i);
        else display.unshift(i);
      });
    }
    const sequence = display.map((idx) => ({ idx, w: estRadius(quotas[idx] ?? 3) }));
    // ADR-0521: the gap between two neighbours is a fraction of THEIR two radii, so a row of big
    // islands breathes more than a row of small ones and the row's total is the sum of its pairs.
    const gapAfter = (k: number): number => {
      const here = sequence[k];
      const next = sequence[k + 1];
      // The two ids are what the clearance is looked up by — a plate's width follows its story's
      // NAME, so the pair's gap is the pair's own, exactly as its water already is.
      return here && next
        ? islandGapFor(here.w, next.w, stories[here.idx]?.id ?? '', stories[next.idx]?.id ?? '')
        : 0;
    };
    const total = sequence.reduce((sum, s, k) => sum + 2 * s.w + gapAfter(k), 0);
    // A lone island would otherwise sit directly on top of its dependencies,
    // stacking every road into one vertical corridor — swing it to an
    // alternating side so roads sweep as separated diagonals (the dbt-DAG read).
    let rowCenter =
      // EQUIVALENT — on the foundation row no dependency is placed yet, so `baryOf` is 0 for every member
      // and the reduce yields exactly the 0 the literal branch returns.
      // Stryker disable next-line ConditionalExpression: EQUIVALENT — see the note above.
      r === 0 ? 0 : display.reduce((sum, i) => sum + baryOf(i), 0) / Math.max(display.length, 1);
    const lone = sequence.length === 1 ? sequence[0] : undefined;
    if (r > 0 && lone) rowCenter += (r % 2 === 1 ? 1 : -1) * rankSwingFor(lone.w);
    let xCursor = rowCenter - total / 2;
    sequence.forEach((s, k) => {
      const story = stories[s.idx];
      // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction above
      // makes it unreachable: `s.idx` indexes `stories`.
      // Stryker disable next-line OptionalChaining: EQUIVALENT (type-forced) — see the note above.
      const seedH = hash(story?.id ?? String(s.idx));
      seedPx.set(s.idx, {
        x: xCursor + s.w + (rand01(seedH) - 0.5) * tileUnits(44),
        y: (rowY[r] ?? 0) + (rand01(seedH + 1) - 0.5) * tileUnits(30),
      });
      xCursor += 2 * s.w + gapAfter(k);
    });
  }

  // Snap seeds to the hex lattice, then enforce a growth floor: two seeds
  // closer than their combined ring reach would strangle each other's quota.
  //
  // ADR-0528 D5: the floor also leaves room for the MOAT — one hex of water between any two
  // islands' tiles, which the growth below keeps (`foreignAdjacent`). The 3D map sizes every
  // island to its land ratio about its own centre and its ground carries a coast outset, so an
  // island outgrows its tiles a little; two islands whose tiles TOUCH therefore overlap in 3D
  // (measured on the real forest at gap ratio 0 and 0.2 before the moat existed). One hex of
  // water is the smallest separation the lattice can express, and it is what makes the tightest
  // rung of the gap ladder a layout with water between every pair rather than a lottery of the
  // seed jitter.
  // EQUIVALENT — `seedPx` was given an entry for every index by the loop above.
  // Stryker disable next-line ObjectLiteral: EQUIVALENT — see the note above.
  //
  // ⚠ THE SNAP IS TAKEN AT PLAN VIEW, AND NOTHING HERE MAY READ A CAMERA — this is the whole point
  // of the line, so read the reason before touching it (`the-packer-decides-in-ground-space-not-
  // through-the-camera`). `seedPx` is built above entirely from `spacing.ts`'s row/gap math
  // (`estRadius`, `rankGapFor`, `islandGapFor`), which carries no camera term at all: it is GROUND
  // space, the same space `hexCenter` recovers at `PLAN_VIEW_ELEVATION_DEG` everywhere else in this
  // file (the coast, the garden ring, the trail islands, every `ground*` twin). `pixelToHex` reads
  // its point as SCREEN and divides `y` by `sin(elevation)` to recover ground, so handing it a
  // ground point at any elevation below 90° STRETCHES the layout vertically by `1 / sin θ` before
  // quantising it — 1.31x at the shipped 50°, 2.92x at 20°. That is the camera deciding which tiles
  // a story grows onto, which ADR-0527 D1 and ADR-0546 D1 both forbid: the layout is re-projected,
  // never re-decided. At `PLAN_VIEW_ELEVATION_DEG` the factor is exactly 1 and `pixelToHex` is the
  // true inverse of the `hexCenter` every ground twin below is measured with.
  //
  // ⚠ WHY IT SURVIVED SO LONG, which is the part worth keeping. This call read `pixelToHex`'s own
  // module default (`LAND_CAMERA_ELEVATION_DEG`) while every shipped caller packed bare, so the two
  // were always the same number and no caller could separate them. The test that covered the
  // invariant — "the GROUND half does NOT move with the camera" — varied the ARGUMENT, which this
  // call ignored, so it passed VACUOUSLY for as long as it existed. ADR-0593 D1 moving the constant
  // to 50 is what pulled the two apart and made the defect visible; threading the local
  // `elevationDeg` here made it observable but not correct, and `pack.test.ts` pinned it as a KNOWN
  // VIOLATION until this landing took the real fix.
  //
  // ⚠ AND IT IS OBSERVABLE NOW, BY CONSTRUCTION. The pre-snap ground point is published as
  // `Territory.groundSeed`, so "the snap is taken in ground space" is a claim a test can make
  // directly instead of inferring it from a cross-camera comparison that CANNOT see a wrong
  // constant (both arms would be wrong the same way). That is the repair for the vacuity, not just
  // for the defect — see `pack.test.ts`'s `the seed snap is taken in GROUND space`.
  //
  // ⚠ IT MOVES THE MAP, AND THAT WAS PAID FOR. Measured on the shipped corpus, islands move by
  // WHOLE TILES (`drawTiles[0].q: 26 vs -3`), so `relocation.golden.json` was re-captured in its
  // own commit — see that file's header for what the re-capture cost.
  const seeds: Axial[] = stories.map((_, i) => pixelToHex(seedPx.get(i) ?? { x: 0, y: 0 }, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }));
  // Each nudge moves one seed one hex EAST, so the passes converge; the bound is a guard against a
  // pathological input, not a budget — at 24 a crowded rank ran out of passes with two seeds still
  // inside each other's floor, and the moat below then had nothing to keep (measured on a 60-island
  // sweep at ratio 0.1: two adjacent tiles).
  // EQUIVALENT — the pass loop is ended by CONVERGENCE (`if (!moved) break`), not by its bound: 400 is a
  // guard against a pathological input, so one extra pass, or a counter running the other way, leaves every
  // seed where it was.
  // Stryker disable next-line EqualityOperator,UpdateOperator: EQUIVALENT — see the note above.
  for (let pass = 0; pass < 400; pass++) {
    // EQUIVALENT — starting each pass at `moved = true` only suppresses the early break, so the loop runs
    // its full bounded course and returns the same converged seeds.
    // Stryker disable next-line BooleanLiteral: EQUIVALENT — see the note above.
    let moved = false;
    // EQUIVALENT / NON-TERMINATING — the extra index yields an `undefined` the `!a || !b` guard below
    // skips; `i--` does not terminate.
    // Stryker disable next-line EqualityOperator,UpdateOperator: EQUIVALENT / NON-TERMINATING — see the note above.
    for (let i = 0; i < seeds.length; i++) {
      // EQUIVALENT / NON-TERMINATING — as above for `j`.
      // Stryker disable next-line EqualityOperator,UpdateOperator: EQUIVALENT / NON-TERMINATING — see the note above.
      for (let j = i + 1; j < seeds.length; j++) {
        const a = seeds[i];
        const b = seeds[j];
        // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction
        // above makes it unreachable: with the bounds above unmutated both seeds are always defined.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: EQUIVALENT (type-forced) — see the note above.
        if (!a || !b) continue;
        const floor = ringsOf(quotas[i] ?? 1) + ringsOf(quotas[j] ?? 1) + 1 + MOAT_HEXES;
        // NON-TERMINATING — nudging every pair east on every pass, forever.
        // Stryker disable next-line ConditionalExpression,EqualityOperator: NON-TERMINATING — see the note above.
        if (hexDist(a, b) < floor) {
          seeds[j] = { q: b.q + 1, r: b.r }; // deterministic eastward nudge
          moved = true;
        }
      }
    }
    // EQUIVALENT — without the early break the bounded pass loop ends on the same converged seeds.
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — see the note above.
    if (!moved) break;
  }

  // Grow territories round-robin: each story claims its cheapest frontier hex
  // (closest to seed, hash-jittered for organic coastlines) until its quota —
  // a tile per capability (ADR-0528) — is met.
  const owner = new Map<string, number>();
  const tilesByStory: Axial[][] = stories.map(() => []);
  seeds.forEach((seed, i) => {
    owner.set(axialKey(seed), i);
    // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction above
    // makes it unreachable: `tilesByStory` has an entry per story.
    // Stryker disable next-line OptionalChaining: EQUIVALENT (type-forced) — see the note above.
    tilesByStory[i]?.push(seed);
  });
  // THE MOAT (ADR-0528 D5): a hex adjacent to another story's tile is never claimed, so two islands'
  // tiles are always at least one hex apart. See the growth-floor note above for why.
  const foreignAdjacent = (h: Axial, mine: number): boolean =>
    AXIAL_DIRS.some((d) => {
      // EQUIVALENT, AND MEASURED — `AXIAL_DIRS` is closed under negation, so subtracting each direction
      // visits the SAME six neighbours in a different order. The five other mutants on this function ARE
      // killed, by the moat test in `pack.test.ts`; that these two are not is exactly that symmetry
      // showing.
      // Stryker disable next-line ArithmeticOperator: EQUIVALENT, AND MEASURED — see the note above.
      const o = owner.get(axialKey({ q: h.q + d.q, r: h.r + d.r }));
      return o !== undefined && o !== mine;
    });
  let progress = true;
  // NON-TERMINATING — the grower's outer loop is driven entirely by `progress`.
  // Stryker disable next-line BlockStatement: NON-TERMINATING — see the note above.
  while (progress) {
    // NON-TERMINATING — as above.
    // Stryker disable next-line BooleanLiteral: NON-TERMINATING — see the note above.
    progress = false;
    // EQUIVALENT / NON-TERMINATING — the extra index yields an `undefined` the guard below skips; `i--`
    // does not terminate.
    // Stryker disable next-line EqualityOperator,UpdateOperator: EQUIVALENT / NON-TERMINATING — see the note above.
    for (let i = 0; i < stories.length; i++) {
      const mine = tilesByStory[i];
      const seed = seeds[i];
      const story = stories[i];
      const quota = quotas[i];
      // EQUIVALENT (type-forced) / NON-TERMINATING — the first four conjuncts guard values this loop's own
      // bookkeeping guarantees, so they are unreachable; the mutants that reach `mine.length >= quota`
      // remove the grower's only stopping condition and do not terminate.
      // Stryker disable next-line ConditionalExpression,EqualityOperator,LogicalOperator: EQUIVALENT (type-forced) / NON-TERMINATING — see the note above.
      if (!mine || !seed || !story || quota === undefined || mine.length >= quota) continue;
      let best: Axial | null = null;
      let bestCost = Infinity;
      for (const t of mine) {
        for (const d of AXIAL_DIRS) {
          const cand = { q: t.q + d.q, r: t.r + d.r };
          const key = axialKey(cand);
          if (owner.has(key) || foreignAdjacent(cand, i)) continue;
          const cost = hexDist(seed, cand) + rand01(hash(`${story.id}:${key}`)) * 1.4;
          // EQUIVALENT — `cost` carries a real-valued hash jitter, so two candidates tie only on an exact
          // float coincidence; which of a tied pair wins is unobservable rather than wrong.
          // Stryker disable next-line EqualityOperator: EQUIVALENT — see the note above.
          if (cost < bestCost) {
            bestCost = cost;
            best = cand;
          }
        }
      }
      // ⚠ UNREACHED, not proven equivalent — `best` is null only when an island's entire frontier is
      // blocked by foreign soil and its moat. No arrangement reaches it, including the SEARCHED crowding
      // corpus in `pack.test.ts`; and with the guard gone the mutant throws rather than differing quietly,
      // so reaching it at all is what a witness would need.
      // Stryker disable next-line ConditionalExpression: UNREACHED, not proven equivalent — see the note above.
      if (best) {
        owner.set(axialKey(best), i);
        mine.push(best);
        progress = true;
      }
    }
  }

  // Per-territory contents.
  const territories: Territory<S>[] = stories.map((story, i) => {
    // EQUIVALENT — `tilesByStory` has an entry per story.
    // Stryker disable next-line ArrayDeclaration: EQUIVALENT — see the note above.
    const tiles = tilesByStory[i] ?? [];
    // EQUIVALENT — `seeds` has an entry per story, so the fallback is unreachable.
    // Stryker disable next-line LogicalOperator,ObjectLiteral: EQUIVALENT — see the note above.
    const seed = seeds[i] ?? { q: 0, r: 0 };
    // The pre-snap ground anchor, published so the snap's BASIS is checkable from outside — see
    // `Territory.groundSeed`. EQUIVALENT fallback — `seedPx` was given an entry for every index.
    // Stryker disable next-line LogicalOperator,ObjectLiteral: EQUIVALENT — see the note above.
    const groundSeed = seedPx.get(i) ?? { x: 0, y: 0 };
    // NOT `tiles.map(hexCenter)`: `hexCenter(h, elevationDeg = LAND_CAMERA_ELEVATION_DEG)` takes an
    // optional second argument, and `Array.prototype.map` calls its callback with `(element, index,
    // array)` — so a bare `.map(hexCenter)` feeds each tile's ARRAY INDEX into `elevationDeg`,
    // silently re-flattening every tile by its own position (0deg for the first tile, 1deg for the
    // second, ...), never the declared camera. This was the classic `['1','2'].map(parseInt)` trap,
    // newly load-bearing the moment `hexCenter` grew a second parameter (ADR-0367 D1) — the single
    // largest driver of `land-camera-consumers-reconcile`'s measured content-extent collapse (a
    // territory's own `centroid`/`radius` were computed from tiles each seen through a DIFFERENT,
    // index-derived camera).
    const centers = tiles.map(screenCenter);
    const centroid: Pt = {
      x: centers.reduce((s, p) => s + p.x, 0) / Math.max(centers.length, 1),
      y: centers.reduce((s, p) => s + p.y, 0) / Math.max(centers.length, 1),
    };
    const radius =
      // Deliberately the SCREEN twin — `scene-territory-radius-states-its-space` split it from
      // `groundRadius` below. Its honest consumers are screen chrome: the wisp orbit radii and the
      // panel offsets. `ringR` below used to read it too, which was the open question that split
      // asked and `studio-island-layout-moves-to-ground-space` has now answered: the ring is a
      // GROUND circle, so it reads `groundRadius`, and every remaining consumer here wants screen.
      // screen-space: a screen magnitude by construction, with its ground twin declared beside it
      Math.max(0, ...centers.map((p) => Math.hypot(p.x - centroid.x, p.y - centroid.y))) +
      HEX_R;
    // A true GROUND-plane radius (scene-territory-radius-states-its-space) — same formula as
    // `radius` above, but over UNPROJECTED tile centres, so it is isotropic and camera-independent.
    // `radius` is a SCREEN magnitude (foreshortened on r, untouched on q); scene.ts's ground-side
    // consumers (garden-hero keep-outs, the UAT/grass scatter, the stone-path spacing floor) need
    // THIS one, not that one — feeding them the screen value silently under-scaled every one of them.
    const groundTileCenters = tiles.map((h) => hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }));
    const groundCentroid: Pt = {
      x: groundTileCenters.reduce((s, p) => s + p.x, 0) / Math.max(groundTileCenters.length, 1),
      y: groundTileCenters.reduce((s, p) => s + p.y, 0) / Math.max(groundTileCenters.length, 1),
    };
    const groundRadius =
      // ground-space: `groundTileCenters` are `hexCenter` at PLAN_VIEW_ELEVATION_DEG, i.e. the
      // pre-camera tile positions, so this radius is isotropic and does not move with the camera.
      Math.max(0, ...groundTileCenters.map((p) => Math.hypot(p.x - groundCentroid.x, p.y - groundCentroid.y))) +
      HEX_R;

    // The story's own tree takes the tile nearest the centroid ON THE GROUND; capabilities garden
    // in a ring around it — a CIRCLE on the land, which the camera projects to an ellipse (walked
    // inward until they sit on owned land). ADR-0238 retires scenery-only conifers and wheat.
    const centerTile = groundHeroTile(tiles) ?? seed;
    const treeSpot = screenCenter(centerTile);
    // The same tile before the camera (ADR-0527 D1) — the anchor `buildScene` is handed. Taken from
    // the tile, not from `treeSpot` by un-projection: `hexCenter` projects by scaling y, so these two
    // are the same point stated in two spaces, and the core projecting this one reproduces that one.
    const groundTreeSpot = hexCenter(centerTile, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
    // The tree's crown radius in GROUND units — its drawing frame scaled onto the tile (ADR-0528).
    const crownR = crownRadiusWorld(story.capabilities.length);
    // A GROUND radius. `crownR` is the tree's screen HALF-WIDTH, and the camera foreshortens only
    // the depth axis, so a horizontal half-width is already a ground magnitude; `HEX_R` is a ground
    // radius by definition. The one screen quantity in this expression was the island `radius`, and
    // it is replaced by its declared ground twin (`studio-island-layout-moves-to-ground-space`).
    const ringR = Math.max(crownR * 0.9, Math.min(crownR + tileUnits(18), groundRadius - HEX_R * 0.55));
    // Front 240° arc only (centred south) — a plant behind the tree would
    // vanish under the canopy.
    const ARC = (Math.PI * 4) / 3;
    const caps: CapSpot<S['capabilities'][number]>[] = story.capabilities.map((cap, j) => {
      const n = story.capabilities.length;
      // `?plants=scatter` (VISUAL SPIKE): keep the rough angular slot (so plants
      // never clump) but widen the angle wobble and spread the radius across a
      // BAND rather than one ring, so the garden reads as an organic orchard
      // instead of a rigid arc — most visible on the high-cap islands. Plants stay
      // in the front arc (else they hide under the canopy) and clear of the trunk.
      const slot = -Math.PI / 6 + ((j + 0.5) / n) * ARC;
      const jitterA =
        (rand01(hash(`${story.id}:${cap.id}:a`)) - 0.5) * (ARC / n) * (plantsScatter ? 1.5 : 0.5);
      const angle = slot + jitterA;
      const rr = plantsScatter
        ? Math.max(
            crownR * 0.95,
            ringR * (0.62 + rand01(hash(`${story.id}:${cap.id}:rb`)) * 0.72),
          )
        : ringR + (rand01(hash(`${story.id}:${cap.id}:r`)) - 0.5) * tileUnits(10);
      // `angle` is a GROUND bearing and `rr` a GROUND radius, so the ring is a circle on the land;
      // `groundPolarOffset` projects it ONCE, through the declared camera, into the screen offset the
      // already-projected `treeSpot` needs. The retired `* 0.66` was a hand-picked top-down squash
      // where the camera says `sin 20° ≈ 0.342` — a 1.93x ground ellipse (measured), so a plant
      // asked for `rr` landed up to 93% further out in ground-y than in ground-x. Each of these is
      // its capability's parcel seed (`capToParcel`), so the ellipse was skewing the partition that
      // decides which ground each capability owns.
      const off = groundPolarOffset(angle, rr, elevationDeg);
      let x = treeSpot.x + off.x;
      let y = treeSpot.y + off.y;
      // The keep-IN walk stays in screen space, correctly: a 25% step toward `treeSpot` is an AFFINE
      // interpolation, so it is the same 25% of the way across the ground — and `pixelToHex` reads
      // the same declared camera these points were projected through.
      let steps = 0;
      // EQUIVALENT — the keep-in walk is ended by its LAND TEST, not by its bound: every garden spot lands
      // on owned soil within a step or two, so 4 is a guard rather than a schedule.
      // Stryker disable next-line ConditionalExpression,EqualityOperator,UpdateOperator: EQUIVALENT — see the note above.
      // ⚠ `pixelToHex` MUST read the camera these points were projected through, or the keep-in
      // walk tests a screen point against the wrong tile and seats plants on a neighbour's ground.
      for (let k = 0; k < 4 && owner.get(axialKey(pixelToHex({ x, y }, { elevationDeg }))) !== i; k++) {
        x += (treeSpot.x - x) * 0.25;
        y += (treeSpot.y - y) * 0.25;
        steps += 1;
      }
      // The SAME spot before the camera (ADR-0527 D1). Each walk step leaves the offset at 75% of
      // itself (`p += (anchor - p) * 0.25` ⇒ `p - anchor` scales by 0.75), so the walked offset is
      // the original one shrunk by `0.75^steps` — and the walk's own TEST is the screen point, which
      // is why the count is taken from the loop above rather than re-run here. `groundPolarOffset` is
      // linear in `r`, so projecting this lands exactly on `x`/`y`: same point, two spaces.
      const reach = rr * 0.75 ** steps;
      const groundSpot: Pt = {
        x: groundTreeSpot.x + Math.cos(angle) * reach,
        y: groundTreeSpot.y + Math.sin(angle) * reach,
      };
      return { cap, x, y, groundSpot };
    });

    const decor: DecorSpot[] = [];
    const wheatTiles = new Set<string>();

    // Territory boundary: every tile edge whose neighbour is foreign soil.
    //
    // ADR-0367's fourth named cost: `coast.ts`'s outset (`COAST_OUTSET`) pushes each boundary
    // vertex along its local edge normal by a FIXED distance — isotropic, only a true "beach
    // width" in the ground plane, exactly like `routeTrails`'s obstacle radius. Build the
    // boundary from GROUND-SPACE hex corners (`PLAN_VIEW_ELEVATION_DEG` recovers the
    // pre-camera, un-flattened positions), so the outset + Chaikin smoothing both run in ground
    // space; the loop is projected to screen once, below, after `smoothCoast` returns it.
    const mineSet = new Set(tiles.map(axialKey));
    const boundary: BoundarySeg[] = [];
    for (const tile of tiles) {
      const c = hexCenter(tile, { elevationDeg: PLAN_VIEW_ELEVATION_DEG });
      const corners = hexCorners(c.x, c.y, HEX_R, PLAN_VIEW_ELEVATION_DEG);
      AXIAL_DIRS.forEach((d, e) => {
        if (mineSet.has(axialKey({ q: tile.q + d.q, r: tile.r + d.r }))) return;
        const a = corners[e];
        const b = corners[(e + 1) % 6];
        // EQUIVALENT (type-forced) — `noUncheckedIndexedAccess` requires the guard and the construction
        // above makes it unreachable: `hexCorners` returns exactly six corners, so both indices are in
        // range for every `e` in 0..5.
        // Stryker disable next-line ConditionalExpression,LogicalOperator: EQUIVALENT (type-forced) — see the note above.
        if (a && b) boundary.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      });
    }

    // ADR-0367's named accepted cost: `HEX_R` is a GROUND radius, so a nameplate baseline that adds
    // it raw sat a cell-radius below the tiles in plan view and ~18 px too low the moment the land
    // got a camera. The projected half-height is what a cell actually occupies on screen; `tileDepth`
    // is already projected (an upright extrusion, so cos θ, re-derived at THIS call's camera above)
    // and stays as it is.
    const labelY =
      Math.max(...centers.map((p) => p.y), centroid.y) +
      groundRadiusToScreenHalfHeight(HEX_R, elevationDeg) +
      tileDepth +
      tileUnits(8);
    // The SAME baseline on the ground (ADR-0545), built the way every other ground twin here is
    // built — from the plan-view tile centres, never by un-projecting `labelY`. The island's own
    // terms are already ground distances (a plan-view southern edge plus a hex radius). The plate's
    // remaining DROP is not: `TILE_DEPTH` is an upright extrusion and `tileUnits(8)` a drawn gap,
    // both screen magnitudes chosen to sit the plate clear of the picture — so the ground line that
    // appears there is what `unprojectGround` recovers, at the camera the drop was authored at.
    // That is the honest translation of "the plate sits this far in front of the island", and it is
    // why the two twins agree by construction rather than by coincidence.
    const groundLabelY =
      Math.max(...groundTileCenters.map((p) => p.y), groundCentroid.y) +
      HEX_R +
      unprojectGround({ x: 0, y: TILE_DEPTH + tileUnits(8) }).y;
    // `smoothCoast` outsets + smooths in GROUND space (see the boundary comment above), and the
    // loops now leave in that space (ADR-0527 D1). `buildScene` projects them at the camera it is
    // asked for and draws the path there, applying the SAME order this function used to —
    // project, then smooth — which is what makes the map byte-identical across the move
    // (`projection-equivariance.test.ts` holds that, and records why the OTHER order is the same
    // curve but not the same bytes).
    const coast = smoothCoast(boundary, story.id, COAST_OUTSET_ON_TILE); // the beach on the shipped tile (ADR-0528)

    // ADR-0102: this island carries the icon of each BUILDING it depends on (promotion is
    // building-incident, "you carry the icon of what you depend on"). Fan the stamps around the
    // tree — alternate sides and step the radius out per index so several never overlap (studio
    // carries two) — then walk each inward until it sits on owned land (the garden-plant land-snap,
    // so it never floats over the sea). Deterministic per (story, icon): a stamp never reshuffles.
    const carried = opts?.carriedIcons?.get(story.id) ?? [];
    const stamps = carried.map((icon, si) => {
      const side = si % 2 === 0 ? -1 : 1;
      const tier = Math.floor(si / 2); // each side-pair steps further out
      let bx = treeSpot.x + side * (crownR + tileUnits(17 + tier * 26));
      let by = treeSpot.y + tileUnits(7 + tier * 6); // a touch in front of the trunk base, lower per tier
      // EQUIVALENT — as the garden walk above: the land test ends it, the bound is a guard.
      // Stryker disable next-line ConditionalExpression,EqualityOperator,UpdateOperator: EQUIVALENT — see the note above.
      //
      // ⚠ `{ elevationDeg }` MUST be threaded, same as the garden walk's own `pixelToHex` a few
      // dozen lines up: `bx`/`by` are built from `treeSpot`, which is SCREEN space at whatever
      // camera this call resolved, not the module's own default. Reading it bare (as this line
      // did until ADR-0593 D1) silently keys the ownership lookup to the SHIPPED camera instead —
      // invisible while every caller took the default, live the moment one asks for another.
      for (let k = 0; k < 5 && owner.get(axialKey(pixelToHex({ x: bx, y: by }, { elevationDeg }))) !== i; k++) {
        bx += (treeSpot.x - bx) * 0.3;
        by += (treeSpot.y - by) * 0.3;
      }
      return { icon, spot: { x: bx, y: by } };
    });
    return {
      story,
      tiles,
      centroid,
      radius,
      groundRadius,
      treeSpot,
      groundCentroid,
      groundTreeSpot,
      groundSeed,
      caps,
      decor,
      wheatTiles,
      coastGroundLoops: coast.loops,
      labelY,
      groundLabelY,
      stamps,
      // ADR-0088 (+ owner 2026-06-22 follow-on): building-class stories never render on the map
      // (they live in the Shared Islands panel) AND the panel's bookshelf landmark now sits
      // OUTSIDE the name card (SharedIslandCard draws it), so NO nameplate ever carries the
      // in-card building glyph — it is always false here.
      buildingGlyph: false,
    };
  });

  // The pale coast: up to two rings of unclaimed hexes around the land.
  //
  // Each coast hex is ATTRIBUTED to the territory whose land it grew out of (ADR-0286). The moat
  // is derived from the UNION of claimed tiles, so it has no owner of its own — but the Act 2
  // regrow hides an island until it forms, and an unowned moat kept drawing the whole forest's
  // silhouette from frame one. Propagating the owner outward through the ring walk is the honest
  // attribution: ring 0 inherits the claimed tile it touched, ring 1 inherits the ring-0 hex it
  // grew from. A hex two islands both reach is claimed by whichever the walk reaches it from
  // first, which is deterministic because `owner` is built in territory order.
  const empties: SceneEmptyHex[] = [];
  const emptySet = new Set<string>();
  let ring: { h: Axial; owner: number }[] = [...owner.entries()].map(([k, idx]) => {
    const parts = k.split(',');
    return { h: { q: Number(parts[0]), r: Number(parts[1]) }, owner: idx };
  });
  // NON-TERMINATING — `depth--` runs the ring walk away from its bound.
  // Stryker disable next-line UpdateOperator: NON-TERMINATING — see the note above.
  for (let depth = 0; depth < 2; depth++) {
    const next: { h: Axial; owner: number }[] = [];
    for (const t of ring) {
      for (const d of AXIAL_DIRS) {
        const cand = { q: t.h.q + d.q, r: t.h.r + d.r };
        const key = axialKey(cand);
        if (owner.has(key) || emptySet.has(key)) continue;
        // Thin the outer ring for an organic coastline.
        // EQUIVALENT — `<=` differs only when a hash lands exactly on 0.45, which `rand01`'s 2^-32 grid
        // makes a measure-zero coincidence.
        // Stryker disable next-line EqualityOperator: EQUIVALENT — see the note above.
        if (depth === 1 && rand01(hash(`coast:${key}`)) < 0.45) continue;
        emptySet.add(key);
        empties.push({ ...cand, owner: t.owner });
        next.push({ h: cand, owner: t.owner });
      }
    }
    ring = next;
  }

  // Global back-to-front tile order so extrusions layer correctly.
  const drawTiles = [...owner.entries()]
    .map(([key, idx]) => {
      const parts = key.split(',');
      return { h: { q: Number(parts[0]), r: Number(parts[1]) }, owner: idx };
    })
    .sort((a, b) => a.h.r - b.h.r || a.h.q - b.h.q);

  // The `depends_on` edges route as the ADR-0169 TRAIL NETWORK for BOTH layouts — one
  // deterministic cost-grid pass over the whole world (`routeTrails`, the shared core):
  // island discs avoided, trunks merged by reuse, caves only when forced. The islands
  // are obstacle discs at each territory's centroid; the disc radius keeps the old
  // dock inset (`radius * 0.82`) so trail endpoints land on the coast, not offshore
  // (the routing docks each end at `centre + bearing * r`). The seed folds the layout
  // mode + the story ids, so the network is stable across renders and re-routes only
  // when the world actually changes. Building-tagged stories (ADR-0076 §2 / ADR-0088)
  // never enter `edgeList`, so no trail to a building can exist — no filter needed.
  // A world with no edges (the Shared-Islands panel's one-island worlds) skips the
  // router entirely.
  //
  // ADR-0367's third named cost: `routeTrails` reasons in ISOTROPIC screen distances (clearance,
  // falloff, the obstacle radius itself), which is only true in the GROUND plane — a ground-plane
  // disc seen through the land's declared camera is an ELLIPSE, and feeding the router the
  // already-PROJECTED (compressed) centroid with an un-projected radius inflates the effective
  // obstacle far past the island's real footprint, forcing edges that could route around an
  // island to give up and tunnel under it instead (`land-camera-consumers-reconcile`'s measured
  // 0 -> 156 `world-cave` delta). So route with GROUND-SPACE islands (`hexCenter` at
  // `PLAN_VIEW_ELEVATION_DEG` recovers the pre-camera, un-flattened tile positions exactly) and
  // project the routed network back to screen space once, at the end, via `projectTrailNetwork`.
  const trailIslands: TrailIsland[] = territories.map((t) => {
    const groundCenters = t.tiles.map((tile) => hexCenter(tile, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }));
    const groundCentroid: Pt = {
      // NON-TERMINATING — multiplying by the count instead of dividing sends the centroid to ~1e5 and the
      // router's cost grid never finishes. Its `y` twin below carries the same mutant for the same reason.
      // Stryker disable next-line ArithmeticOperator: NON-TERMINATING — see the note above.
      x: groundCenters.reduce((s, p) => s + p.x, 0) / Math.max(groundCenters.length, 1),
      // NON-TERMINATING — multiplying by the count instead of dividing sends the centroid to ~1e5 and the
      // router's cost grid never finishes.
      // Stryker disable next-line ArithmeticOperator: NON-TERMINATING — see the note above.
      y: groundCenters.reduce((s, p) => s + p.y, 0) / Math.max(groundCenters.length, 1),
    };
    const groundRadius =
      // The router's obstacle discs are isotropic, so both the centroid and this radius are built
      // from PLAN_VIEW_ELEVATION_DEG centres and the network is projected once at the end
      // (`projectTrailNetwork`). Mixing the two spaces here is the measured 0 -> 156 `world-cave`
      // regression named in the comment above.
      // ground-space: pre-camera tile centres, so the obstacle disc stays isotropic
      Math.max(0, ...groundCenters.map((p) => Math.hypot(p.x - groundCentroid.x, p.y - groundCentroid.y))) +
      HEX_R;
    return { id: t.story.id, x: groundCentroid.x, y: groundCentroid.y, r: groundRadius * 0.82 };
  });
  const trails: TrailNetwork =
    // EQUIVALENT — handed an empty edge list the router returns exactly the empty network this branch
    // builds by hand (witnessed by the no-edges test in `pack.test.ts`, which asserts that shape), so the
    // short-circuit is a cost saving rather than a behaviour.
    // Stryker disable next-line ConditionalExpression,LogicalOperator: EQUIVALENT — see the note above.
    edgeList.length && territories.length
      ? projectTrailNetwork(
          routeTrails(
            trailIslands,
            edgeList.map((e) => ({
              from: e.from,
              to: e.to,
              title: `${e.to} depends on ${e.from}${e.via.length ? ` (via ${e.via.join(', ')})` : ''}`,
            })),
            `trails:dag:${stories.map((s) => s.id).sort().join('|')}`,
          ),
          trailIslands,
          // ⚠ THIRD ARGUMENT, NOT LEFT AT ITS DEFAULT (ADR-0593 D1). `routeTrails` above deliberately
          // reasons in GROUND space (the comment above `trailIslands` explains why), and this is the
          // ONE place that projects the routed network back to screen space. Its own default is the
          // module's `LAND_CAMERA_ELEVATION_DEG`, not this call's resolved camera — left bare, every
          // trail segment and cave would draw at the SHIPPED angle regardless of what `elevationDeg`
          // this `packWorld` call actually asked for, the same class of gap as the seed-snap fix
          // above (and the largest by far: a whole trail network foreshortened at the wrong θ).
          elevationDeg,
        )
      : { segments: [], edges: [], caves: [], dropped: [] };

  // ADR-0283 D2: the radial `solar` assembly that used to build a `world.solar` layer here — the
  // hub centre, the rank orbit rings and the `consumed_by` spoke lines — is gone with the layout
  // it served, and the `HexWorld` field it fed went with it.

  // Scene bounds over every tile (claimed + coast), plus label + tree space.
  //
  // `empties.map(hexCenter)` (not the arrow-wrapped form used just above) is the SAME
  // `Array.prototype.map` arity trap documented on `centers` above: it fed every coast hex's ARRAY
  // INDEX into `hexCenter`'s `elevationDeg`, so a coast ring's outer hexes (dozens to hundreds of
  // them, at increasing indices) were flattened at wildly wrong, ever-growing "degree" values —
  // `Math.sin` swinging through its full range past 90 deg — rather than the declared 20 deg camera.
  // This is what fed `allCenters`, and therefore `minY`/`maxY` below, values orders of magnitude
  // outside the map's true extent: the measured content-extent collapse's dominant cause, not the
  // vertical-squash story this increment's own trap warns against assuming.
  const allCenters = [...drawTiles.map((t) => screenCenter(t.h)), ...empties.map(screenCenter)];
  const minX = Math.min(...allCenters.map((p) => p.x)) - HEX_W / 2 - MARGIN;
  const maxX = Math.max(...allCenters.map((p) => p.x)) + HEX_W / 2 + MARGIN;
  // Same reconciliation as the nameplate baseline above (ADR-0367's second named cost): the vertical
  // bounds must use a cell's PROJECTED half-height, or an angled map is cropped at the top and given
  // a cell-radius of dead space at the bottom. The x bounds keep `HEX_W / 2` — the q axis runs across
  // the screen and does not foreshorten.
  const hexHalfHeight = groundRadiusToScreenHalfHeight(HEX_R, elevationDeg);
  const minY =
    Math.min(
      ...allCenters.map((p) => p.y - hexHalfHeight),
      // ⚠ `elevationDeg` MUST be threaded here (ADR-0593 D1): `storyTreeReach`'s own default is the
      // SHIPPED `LAND_CAMERA_ELEVATION_DEG`, not this call's resolved camera, and a bare call
      // silently mixed cameras within the SAME `Math.min` this `hexHalfHeight` term sits in —
      // the world's top bound was drawn at whatever the module happened to ship while the rest of
      // the map moved with the requested angle. Caught by
      // `an explicit elevation moves the whole scene box, not just the tiles` below, which fails on
      // the un-threaded call.
      ...territories.map((t) => t.treeSpot.y - storyTreeReach(t.story.capabilities.length, elevationDeg)),
    ) - MARGIN;
  const maxY =
    Math.max(...allCenters.map((p) => p.y), ...territories.map((t) => t.labelY + tileUnits(34))) +
    hexHalfHeight +
    tileDepth +
    MARGIN / 2;

  return {
    territories,
    empties,
    drawTiles,
    trails,
    width: Math.ceil(maxX - minX),
    height: Math.ceil(maxY - minY),
    offset: { x: -minX, y: -minY },
  };
}
