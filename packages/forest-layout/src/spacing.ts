// spacing.ts — THE FOREST'S SPACING IS A FRACTION OF ISLAND SIZE, NOT THREE NUMBERS BY EYE.
//
// Moved here from `apps/studio/src/lib/islandSpacing.ts` with the packer it feeds
// (`the-packing-moves-to-its-own-package`, ADR-0537 D1). Unchanged apart from that name and the
// two references below that pointed at its old home.
//
// ADR-0521 (owner-directed, 2026-09-05): *"just go straight to C, this really needs to be
// procedurally determined."* The 2D row packer (`packWorld`, `pack.ts`) used to hold three
// absolute constants — `RANK_GAP` 40, `ISLAND_GAP` 60, `RANK_SWING` 140 units, chosen by eye and
// halved on the owner's 2026-08-16 call. ADR-0520 then sized every island from a land-per-capability
// ratio, so half the layout became derived while the gaps stayed hand-picked, and the fitted forest
// read as dots in a field (land 4.9% → 0.8% of the frame). This module is option C: the gaps are
// derived from the same input the island's size already is — its capability count, through
// `estRadius(quota)` — and the 3D map inherits the change because it lays out nothing of its own.
//
// ONE RATIO, THREE READINGS. A gap between two islands is `ISLAND_SPACING_RATIO` times the mean of
// their two estimated radii, on both axes — the row gap between the tallest island of one rank and
// the tallest of the next, the in-row gap between neighbours. A lone island on its rank swings
// sideways by its own radius plus that gap: exactly the offset a same-row neighbour would have
// given it, so its trails still sweep as diagonals rather than stacking into one corridor. Nothing
// here is a second hand-picked number; the swing is what the gap rule says a neighbour would be.
//
// ⚠ THE RATIO ITSELF IS THE OWNER'S PICK FROM A RENDERED LADDER (ADR-0521's one open input, chosen
// under ADR-0503's bold-and-scale-back protocol). `ISLAND_SPACING_RUNGS` is the ladder rendered on
// `packages/forest-world-r3f/harness/shipped-spacing.html`; the pick's provenance is on the constant.
// Changing it is a rendered ladder, never a hand edit.
//
// ⚠ THE HEX LATTICE IS THE FLOOR, NOT THE RATIO. Seeds closer than their combined ring reach are
// nudged apart by `packWorld`'s growth-floor pass whatever the gap says, so two 2D islands never
// interpenetrate and rung 0 is "as close as the tiles allow", not "touching". The 3D island is
// smaller than its tile footprint (ADR-0520 sizes it in place), so the water between two 3D islands
// can never fall below the floor's residue — a bound the ladder shows rather than argues.

/** The three absolute gaps the packer held before ADR-0521, in ground units — TYPED AS HISTORY.
 *  A comparison page's control arm stands on them (`packWorld`'s `spacing.legacy`), because the
 *  picture the owner saw before this landing cannot be composed from the shipped constants any
 *  more. Nothing on the shipped path reads them. */
export interface LegacySpacing {
  rankGap: number;
  islandGap: number;
  rankSwing: number;
}

export const PRE_ADR0521_SPACING: Readonly<LegacySpacing> = Object.freeze({
  rankGap: 40,
  islandGap: 60,
  rankSwing: 140,
});

/**
 * The gap between two islands as a fraction of the mean of their estimated radii — THE PICK.
 *
 * Provenance: laddered 2026-09-06 on the REAL forest — the studio's own layout of the live corpus
 * (35 islands), exported per rung and rendered through the shipped 3D mapper on the RTX 2060 —
 * at rungs {@link ISLAND_SPACING_RUNGS}; evidence `docs/research/chapter2-forest-spacing-2026-09-06/`.
 * The retired constants read as ≈0.41 (rank) / ≈0.61 (in-row) of the median island radius over
 * that corpus, so 0.5 is roughly "today" and the ladder descends from it. 0 is the boldest rung
 * (ADR-0503: ship bold, the owner scales back off the sheet): the derived gap is nothing, and the
 * spacing is entirely the hex lattice's own growth floor — islands sit as close as their tile
 * footprints allow. Measured: land 0.67% → 0.89% of the fitted frame, the layout's area 68% of
 * today's, every trail routed, the 2D map's nameplates and trails still clear. ⚠ What the ladder
 * ALSO shows is the bound: the three constants held about a third of the layout's area and this
 * removes it; the other two thirds is the 2D tile footprint (`HEX_R`, the `+ 2` quota), which no
 * ratio on the gaps can reach — that is option B's lever (ADR-0521), escalated, not decided here.
 *
 * ⚠ RE-LADDERED 2026-09-06 OVER CORRECTLY-SIZED TILES (ADR-0528 D5) — the pick WAS 0.1, and the
 * paragraph that follows is the record of that pick; ADR-0598 D2 re-derived it to 1 and the note
 * under the constant says why. With the tile
 * following the land ratio (one hex per capability, `packages/forest-world/src/hex.ts`) and the
 * packer's one-hex moat, the same five rungs were re-exported and rendered through the shipped 3D
 * mapper (`docs/research/chapter2-tile-footprint-2026-09-06/`): land 0.89% → 2.90 / 3.20 / 3.62 /
 * 3.90 / 4.31% of the fitted frame at 0.5 / 0.35 / 0.2 / 0.1 / 0, every trail routed on every rung.
 * Rung 0 is not the pick: its tightest pair keeps ONE unit of water between two 3D islands (the
 * island outgrows its tile by its coast outset and the mapper's lobing factor), so they read as
 * touching. 0.1 is the boldest rung with water between every pair (10 units at its tightest) and
 * gives up 0.4 points of land share for it. Below 0.35 the moat floor binds and the extent moves
 * only with the seed jitter, which is why the ladder does not tighten monotonically there.
 *
 * ⚠ RE-LADDERED AGAIN 2026-09-23 (ADR-0598 D2), AND THIS TIME THE LADDER RUNS THE OTHER WAY — the
 * pick is 1. Everything above this line is still true and is the reason 0.1 was right when it was
 * picked; what changed is that the picture 0.1 was picked from had a defect in it.
 *
 * `the-packer-decides-in-ground-space-not-through-the-camera` (PR #2020) found `packWorld` snapping
 * its GROUND seeds through a SCREEN-space function, which divides the depth axis by `sin θ` and so
 * stretched the whole forest by 1.31x down its long axis before quantising it. The repair is correct
 * and stays. But the stretch had been doing visual work nobody had accounted for: it was holding the
 * rows apart. With the row pitch inflated 1.31x while the islands themselves were not, the WATER
 * between two ranks was about seven times what this ratio actually asks for — so the gaps 0.1 names
 * had never once been seen. Removing the stretch exposed them, the owner looked at the result and
 * called it squished (ADR-0598), and D2 says in as many words that the authored gaps "are what needs
 * re-deriving, at the corrected projection". This is that re-derivation.
 *
 * Measured 2026-09-23 on the REAL forest — the live store's 36 islands through the studio's own
 * packer, every rung with the chrome clearance below in place, trails 95 routed / 0 dropped on every
 * rung. `plate-on-island` counts the places a nameplate covers ANOTHER story's land or tree:
 *
 * | ratio | world box   | plate-on-island | plate-on-plate |
 * |-------|-------------|-----------------|----------------|
 * | 0.1   |  854 x 1355 | 1               | 2              |
 * | 0.5   |  854 x 1355 | 4               | 1              |
 * | 0.8   |  922 x 1355 | 2               | 0              |
 * | **1** |  950 x 1444 | **0**           | **0**          |
 * | 1.5   | 1123 x 1661 | 0               | 0              |
 * | 2     | 1247 x 1864 | 0               | 0              |
 *
 * ⚠ READ THE LOW RUNGS AS A LOTTERY RATHER THAN AS A TREND — 1, 4, 2 is not noise in the instrument,
 * it is the seed jitter deciding which pair happens to collide, and it is why the pick is the
 * THRESHOLD (the lowest rung that is clean, and clean monotonically above) rather than the boldest.
 * ADR-0503's ship-bold-and-scale-back cannot name a boldest rung here because the direction reversed:
 * bold now means MORE room, and more room has no ceiling. The owner scales back off the sheet in
 * either direction, and 0.1 stays ON the ladder as what shipped before.
 *
 * It is also the rung where the map stops getting narrower relative to itself (aspect 1.88 at 0.1,
 * 1.52 here), which is ADR-0598 D3's "the horizontal axis is where the room is" as far as a GAP can
 * carry it. ⚠ It does not make the forest wide, and no ratio can: the ribbon shape is the dependency
 * graph's — 17 ranks, 9 of them a single island — and the row layout that draws it is ADR-0283 D2's
 * decision, not this module's.
 */
export const ISLAND_SPACING_RATIO = 1;

/** The ladder the owner picks from, boldest (tightest) last. Rung 0 is the hex floor's own spacing.
 *  ADR-0598 extended it UPWARD: the four rungs at and below 0.5 are the 2026-09-06 ladder kept
 *  whole, and 1 / 1.5 / 2 are the room the re-derivation needed. */
export const ISLAND_SPACING_RUNGS: readonly number[] = Object.freeze([2, 1.5, 1, 0.5, 0.35, 0.2, 0.1, 0]);

/** The clearance between two islands of estimated radii `rA` and `rB`, at `ratio`. */
export function gapBetween(rA: number, rB: number, ratio: number): number {
  return ratio * ((rA + rB) / 2);
}

/** How far a lone island on its rank swings sideways: its own radius plus the gap a same-row
 *  neighbour of the same size would get — the offset it would have had beside such a neighbour. */
export function loneSwing(r: number, ratio: number): number {
  return r + gapBetween(r, r, ratio);
}

/** The arm ids the comparison page and the export script share: the control, then one per rung. */
export const SPACING_CONTROL_ARM = 'today';

export function spacingArmId(ratio: number): string {
  return `spacing-${ratio}`;
}

// ---------- the chrome clearance (ADR-0598 D2) ----------
//
// ⚠ A PROPORTIONAL GAP CANNOT CLEAR FIXED-SIZE CHROME, AND THAT IS THE WHOLE REASON THIS EXISTS.
// Every gap above is a FRACTION of the islands it separates, so it shrinks with them — which is
// right for water and wrong for a nameplate, because the plate does NOT shrink with its island. On
// the real forest the smallest island is ~23 ground units across and its plate band is ~50 ground
// units deep and ~100..190 wide, so the plate is several times its own island and the gap the ratio
// hands it is a twentieth of what the plate needs. Measured 2026-09-23 on the live corpus: at the
// shipped ratio 0.1 there are 39 places where a plate covers a NEIGHBOURING island's tiles, and
// sweeping the ratio alone does not reach zero until 3.0 — thirty times the shipped value, a map
// 1525 x 2309 instead of 835 x 1038, and still 7 plates covering each other. The ratio is not the
// instrument for this; an absolute, chrome-derived FLOOR is.
//
// ⚠ IT IS INJECTED, NEVER AUTHORED HERE (`index.ts`: this package is chrome-free by construction —
// it declares what a story must expose to be LAID OUT and nothing about how one is RENDERED). The
// surface owns its own plate: the studio's is `nameplateLayout` in `TreeView.tsx`, and the studio is
// what converts it into the GROUND distances below. So a surface with a different plate gets a
// layout that fits ITS plate, and this module never learns what a nameplate looks like.
//
// ⚠ AND THE CONVERSION IS THE CALLER'S FOR A SECOND, LOAD-BEARING REASON (ADR-0527 D1 / ADR-0546 D1
// / `the-packer-decides-in-ground-space-not-through-the-camera`). A plate is drawn in SCREEN space
// at a fixed pixel size, so the amount of GROUND it needs depends on the camera — that dependency is
// real and irreducible, and it is exactly the dependency the packer is forbidden to have. Keeping
// the conversion outside means the packer still decides the layout from ground distances alone, and
// the caller is the one that must decide — and say — which camera it converted at. The studio
// converts at the DECLARED land camera, never at a `?elevation=` arm's, so rendering the map at
// another camera still re-projects the layout rather than re-deciding it.

/**
 * The room a surface's own chrome needs, in GROUND units — {@link packWorld}'s `chrome` option.
 *
 * Absent ⇒ no clearance at all, which is the map exactly as it stood before ADR-0598. That is not a
 * back-compat courtesy: it is the CONTROL ARM a comparison page stands on, the same role
 * {@link PRE_ADR0521_SPACING} plays for the gaps, and it is what {@link ChromeClearance.scale} 0
 * reproduces from inside a single run.
 */
export interface ChromeClearance {
  /** The GROUND depth of the band below an island's southern edge that its nameplate occupies —
   *  the FLOOR on the gap between one rank and the next. A surface computes it from its own plate
   *  height plus whatever drop it sets the plate at, converted to ground at the camera it declares. */
  readonly rowBand: number;
  /** Story id → the GROUND half-width of that story's nameplate. Two neighbours in a row are kept
   *  far enough apart that their plates clear, which is a different quantity from `rowBand` because
   *  a plate is much wider than it is deep and the x axis carries no foreshortening. A story absent
   *  from the map gets no clearance, exactly as a story absent from `carriedIcons` carries nothing. */
  readonly plateHalfWidth: ReadonlyMap<string, number>;
  /** ADR-0503's scale-back dial, so the owner can look at a ladder rather than one arm. Multiplies
   *  BOTH readings; absent ⇒ 1 (the full clearance). **0 reproduces the pre-ADR-0598 map exactly**,
   *  which is what makes a control arm composable from the shipped constants. */
  readonly scale?: number;
}

/** The gap between one rank and the next: the ratio's water, or the nameplate band, whichever is
 *  larger. The band is a FLOOR and never a target — a row of big islands whose proportional gap
 *  already exceeds it is untouched, so this widens exactly the rows that were too tight to hold a
 *  plate and nothing else. */
export function rankGapWithChrome(below: number, tallest: number, ratio: number, rowBand: number): number {
  return Math.max(gapBetween(below, tallest, ratio), rowBand);
}

/** The gap between two neighbours in a row: the ratio's water, or enough that their two plates do
 *  not overlap, whichever is larger. A plate is centred on its island, so two plates clear when the
 *  centres are at least `halfA + halfB` apart — of which `rA + rB` is already spent on the islands
 *  themselves, leaving the shortfall as the gap. The subtraction is what makes this SELF-LIMITING:
 *  an island wider than its own plate asks for nothing, which is why the big islands do not move. */
export function inRowGapWithChrome(
  rLeft: number,
  rRight: number,
  ratio: number,
  halfWidthLeft: number,
  halfWidthRight: number,
): number {
  return Math.max(gapBetween(rLeft, rRight, ratio), halfWidthLeft + halfWidthRight - (rLeft + rRight));
}
