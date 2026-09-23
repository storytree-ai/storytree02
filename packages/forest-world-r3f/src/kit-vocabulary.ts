// kit-vocabulary.ts — WHAT EACH BOUGHT PROP MEANS, and where on the island it stands.
//
// ⚠ THE VOCABULARY BELOW IS THE OWNER'S, SETTLED 2026-08-29, and it REPLACES the one PR #1693
// proposed under ADR-0463 D4's delegation. The delegation was to propose and be adjusted; this
// is the adjustment. It is recorded as ADR-0475 and the settled answer lives on
// `oq-a-whole-island-is-dressed-from-the-bought-kit-is-this-the`.
//
//   ONE OBJECT PER CAPABILITY. Its SPECIES and its LEAF TINT carry that capability's state. A
//   capability grows one thing however many contracts sit under it — DENSITY IS NOT A DESIGN
//   INPUT any more ("Lets not worry about density for now"). This replaces "one pine per
//   contract proven", which is why nothing here counts anything.
//
//     green pine ............... healthy / proven
//     yellow leaves ............ proposed or building
//     yellowish-brown leaves ... mapped
//     bare dead trunk .......... unhealthy
//     nothing at all ........... unknown
//     flower ................... a UAT criterion the owner signed by eye
//
// ⚠ ROCKS AND LOGS ARE WITHDRAWN — POCKETED, NOT DELETED. See {@link POCKETED_SIGNALS}. Drift and
// retired-contract get no rendered signal for now, deliberately, and re-proposing either as
// SCENERY is what ADR-0414 D1 forbids: they come back when they come back carrying their signal.
//
// ✅ ONE CONSEQUENCE WORTH NAMING. PR #1693 had to SUPPLY two of its six signals, because the
// harness fixture renders with no database and `check:verification-decay`'s drift never reaches
// it — so two props on that island were demonstrated rather than reported, and the file said so
// in a named place. Both of those props are the withdrawn ones. Every prop this vocabulary draws
// is now read off the SCENE, so there is nothing left to supply and no `DEMONSTRATED_SIGNALS`
// constant to keep honest.
//
// ⚠⚠ THIS FILE CROSSED INTO `src/` ON 2026-08-30. The paragraph above used to say it adopts
// nothing and that adoption is "a separate, deliberate event (ADR-0380 D6 / ADR-0406 D2)". That
// event happened: the owner authorised it on 2026-08-29 ("This looks better, stamp it"), and this
// is the sixth component to cross. The vocabulary is what the SHIPPED map now says about each
// capability, so it can no longer live on a surface where "the island represents nothing".
//
// ⚠ IT CROSSED AS A SPLIT, and the line is between what the map SAYS and where the harness's own
// fixture keeps its answers. `capabilityFacts(island)` — the adapter that reads a capability list
// out of `island-fixture.ts` — stayed behind, along with the `dressIslandFromKit(scene, island)`
// call shape its two harness callers use. What is here takes the facts and the cells as ARGUMENTS,
// because the shipped canvas has neither a fixture nor a `SceneG`: it has descriptors, and
// `parcel-cells.ts` is the route from those into this basis.

import { landHeight } from './land-relief.js';
import { cellsByParcel } from './parcel-cells.js';
import type { GPoint, LayoutCell } from './parcel-cells.js';

/**
 * What a bought prop can be on this island — THREE THAT REPORT SOMETHING AND THREE THAT DO NOT.
 *
 * ⚠⚠ THE SECOND KIND IS NEW AND IT IS THE POINT OF THE SPLIT BELOW. Until 2026-09-03 every role
 * here was a claim about the work, and `kit-vocabulary.test.ts` said so as a property of the table
 * ("every entry is a signal"). The approved render is not only claims: `build_land.py`'s
 * `scatter()` (`:1087-1090`) sprinkles 70 undergrowth, 120 grass clumps and 26 flowers over the
 * land beside its thirteen stands, and the research README's own finding is that the approved
 * island's colour content is almost ENTIRELY its props. So ground cover crosses — and it crosses
 * DECLARED, as {@link KIT_ROLE_CLASS} rather than as an undeclared third thing: the table's claim
 * is now "every entry is a signal OR is declared dressing", which is a check a reader can still
 * fail, where an unclassified role would have quietly widened what a prop is allowed to mean.
 */
export type KitRole = 'tree' | 'deadTree' | 'bloom' | 'bud' | 'wilt' | 'bush' | 'tuft' | 'flowerPatch';

export const KIT_ROLES: readonly KitRole[] = [
  'tree',
  'deadTree',
  'bloom',
  'bud',
  'wilt',
  'bush',
  'tuft',
  'flowerPatch',
];

/** What a role IS: a claim about the work, or scenery that asserts nothing. */
export type KitRoleClass = 'scene' | 'dressing';

/**
 * WHICH KIND EACH ROLE IS — declared, never inferred from the name or from the size.
 *
 * ⚠ A `dressing` ROLE IS EXEMPT FROM EXACTLY TWO RULES AND FROM NOTHING ELSE: the object floor
 * ({@link clearsObjectFloor} — ground cover is speckle by construction, and a bush sized to clear
 * the floor would be a bush as wide as a pine's canopy), and the occupancy clearance
 * ({@link clearanceFactor} — a carpet lies under and around what stands on it, exactly as the
 * recipe's own `sprinkle` keeps no distance from a tree). It is exempt from NOTHING about
 * reporting: a dressing role has no `stateForm` route, so no capability's state can ever reach one.
 */
export const KIT_ROLE_CLASS = {
  tree: 'scene',
  deadTree: 'scene',
  bloom: 'scene',
  bud: 'scene',
  wilt: 'scene',
  bush: 'dressing',
  tuft: 'dressing',
  flowerPatch: 'dressing',
} as const satisfies Record<KitRole, KitRoleClass>;

/** Is this role scenery — something the island wears rather than something it claims? */
export function isDressingRole(role: KitRole): boolean {
  return KIT_ROLE_CLASS[role] === 'dressing';
}

/** The roles that REPORT something, in declaration order. */
export const SCENE_ROLES: readonly KitRole[] = KIT_ROLES.filter((r) => !isDressingRole(r));

/** The roles that assert nothing — the ground cover. */
export const DRESSING_ROLES: readonly KitRole[] = KIT_ROLES.filter(isDressingRole);

/**
 * THE ROLES THAT STAND FOR ONE UAT CRITERION — the same flower in its three states (ADR-0600 D1).
 *
 * ⚠ IT EXISTS SO NO READER HAS TO SPELL THE SET, and the reason is measured rather than stylistic:
 * before ADR-0600 a criterion marker was the single role `bloom`, so every consumer that wanted
 * "the capability props" wrote `role !== 'bloom'` — a filter that is silently WRONG the moment a
 * second criterion role exists, and wrong in the flattering direction (a story's unsigned criteria
 * counted as capabilities). Two such filters were in the repo on the day this landed.
 *
 * ⚠ IT IS NOT THE SAME QUESTION AS {@link isDressingRole}. All three criterion roles are `scene`
 * roles — they report something — so a reader asking "does this assert anything" must keep asking
 * that, and a reader asking "is this one of the story's criteria" asks this.
 */
export const CRITERION_ROLES: readonly KitRole[] = ['bloom', 'bud', 'wilt'];

/** Does this role stand for one of the story's UAT criteria, in any of its three states? */
export function isCriterionRole(role: KitRole): boolean {
  return CRITERION_ROLES.includes(role);
}

/**
 * WHAT EACH ROLE ASSERTS. One line each, and each one is a claim about the work rather than a
 * description of the object — which is the whole difference between signal and decoration
 * (ADR-0414 D1).
 *
 * ⚠ EVERY ENTRY OPENS WITH ITS OWN {@link KIT_ROLE_CLASS} IN CAPITALS, and
 * `kit-vocabulary.test.ts` derives the expected word from that table rather than restating it —
 * so the prose and the classification are a genuine two-place agreement, and a role reclassified
 * in one place and not the other is a loud failure rather than a sentence nobody re-read.
 *
 * ⚠⚠ `SCENE` MEANS THE NUMBER IS READ OFF THE SCENE. Under a still earlier vocabulary two of six
 * roles were read from numbers handed in, which was honest but was a standing obligation: a prop
 * drawn from a number nobody supplied is decoration wearing a signal's name. Withdrawing those two
 * discharged it, and nothing here reopens it — a `DRESSING` entry is not a signal read from a
 * number nobody supplied, it is a prop that makes no claim at all and says so.
 */
export const KIT_ROLE_SIGNAL = {
  tree: "SCENE — one tree per capability; its leaf tint is that capability's own state",
  deadTree: 'SCENE — this capability is unhealthy: the work stands, and it is standing dead wood',
  bloom: 'SCENE — a UAT criterion the owner has signed (ADR-0226 D4, one flower per criterion)',
  bud: 'SCENE — a UAT criterion NOBODY HAS SIGNED YET: the same flower, not yet opened (ADR-0600 D1)',
  wilt: 'SCENE — a UAT criterion witnessed FAILING: the same flower, nodding over (ADR-0600 D2)',
  bush: 'DRESSING — undergrowth on a healthy island, asserting nothing (build_land.py:1087, 70 per recipe island)',
  tuft: 'DRESSING — a clump of grass on a healthy island, asserting nothing (build_land.py:1088, 120 per recipe island)',
  flowerPatch:
    'DRESSING — white flowers on a healthy island, asserting nothing; NEVER red and never half the ' +
    'bloom’s width, so the criterion marker stays the only flower of its colour and its size ' +
    '(build_land.py:1089, 26 per recipe island)',
} as const satisfies Record<KitRole, string>;

/**
 * THE TWO PROPS THAT ARE WITHDRAWN — recorded here so the withdrawal is a decision a reader can
 * find rather than an absence they have to infer.
 *
 * Owner, 2026-08-29: *"we keep it in the pocket to show something once we more mature and can
 * decide what that is, same with logs"*. So the shapes are not wrong, the SIGNALS are not
 * settled — and the correct move for an unsettled signal is no mark at all. The kit's `Rock_*`
 * and `Log_*` objects were dropped from the committed `.glb` with them, because an object
 * nothing places is pure wire cost (`kit-vocabulary.test.ts` refuses one); restoring either is
 * one edit to `export-dressing.py`'s KEEP argument and one entry here.
 *
 * ⚠⚠ AND THE ROCK'S ENTRY CORRECTS THE VOCABULARY IT REPLACES, WHICH HAD IT WRONG AGAINST THE
 * DECISION LOG. PR #1693 built the rock as DRIFT, citing ADR-0463 D4's delegation. ADR-0463
 * records that exact proposal being put to the owner on 2026-08-27 and REFUSED, on two grounds
 * that still bind: it duplicated an axis the map already draws (the tall-flower markers carry
 * per-criterion proof state, by FORM), and a rock is a durable thing and must not be an action
 * item — *"i like rocks as durable items, so i dislike the idea that its an action to clear
 * them"*. D6 then decided what a rock DOES carry: the declared shared seams a capability's code
 * actually rests against. So the meaning below is D6's, not the built vocabulary's, and anyone
 * bringing rocks back reads ADR-0463 D6 rather than restoring what was here.
 */
export const POCKETED_SIGNALS = {
  rock: 'foundations — the declared shared seams a capability rests against (ADR-0463 D6, and NOT drift, which that ADR records as refused)',
  log: 'a retired contract, cut and left where it fell (ADR-0438 anchors know what was retired)',
} as const;

/**
 * AN ASSEMBLY IS WHAT STANDS AT A POINT — one or more kit objects placed as a unit.
 *
 * ⚠ A PINE IS TWO OBJECTS, AND THEIR RELATIONSHIP IS THE KIT'S, NOT OURS. The kit models a
 * trunk and its needles as separate objects wearing different materials, CO-LOCATED in the
 * blend file, so the two are recentred and scaled TOGETHER by their joint bounding box.
 * Recentring each on its own base — the obvious reading of "put the object on the ground" —
 * drops the crown 0.70 units into the trunk, about 18% of the tree's height.
 *
 * The pairing is read off the kit's own world-space bounds and NOT off the names: PR #1693's
 * first attempt paired `Pine_Trunk_02` with `Pine_Leaves_04`, objects five units apart in the
 * blend that belong to different trees, and it rendered a perfectly plausible tree. The
 * 2026-08-29 re-export prints every kept object's world bounds beside the asset for exactly
 * this reason — `Pine_Trunk_01`/`Pine_Leaves_01` centres are 0.004 apart and
 * `Pine_Trunk_04`/`Pine_Leaves_04` 0.078, against 5+ for any cross pairing.
 *
 * ⚠ THE GROUND-COVER ASSEMBLIES ARE ONE OBJECT EACH, and the pairing hazard above does not arise
 * for them: the kit models an undergrowth plant, a grass clump and a flower as single meshes.
 * `plant-a`/`plant-b` are the kit's LEAFY PLANTS, not its `Leafy_Bush_*` — which are pale fuzzy
 * mounds on a FOURTH material, where the leafy plants are the round dark-green bushes the approved
 * render reads as, on a material the asset already carries. See {@link COVER_GAP_2026_09_03}.
 */
export const KIT_ASSEMBLIES = {
  'pine-a': ['Pine_Trunk_01', 'Pine_Leaves_01'],
  'pine-b': ['Pine_Trunk_04', 'Pine_Leaves_04'],
  'pine-dead': ['Pine_Trunk_No_Leaves_01'],
  flower: ['Red_Flower_01'],
  'plant-a': ['Leafy_Plant_01'],
  'plant-b': ['Leafy_Plant_02'],
  'tuft-a': ['Grass_Clump_01'],
  'tuft-b': ['Grass_Clump_02'],
  'tuft-c': ['Grass_Clump_03'],
  'flower-white': ['White_Flower_01'],
} as const satisfies Record<string, readonly string[]>;

/**
 * WHAT THE RECIPE'S GROUND COVER ASKS FOR THAT THIS ASSET DOES NOT CARRY — the NAMED GAP the
 * increment's payload rule licenses, recorded here rather than left as an absence to infer.
 *
 * The rule (`ground-cover-from-the-kit-bushes-tufts-and-flowers`): if the full recipe subset costs
 * more than about a third again over the wire, ship the cheapest subset that still READS and name
 * the rest. Measured 2026-09-03, brotli q11 over `src/kit-asset.ts` itself (the module the web
 * sync carries), the full subset — all eight `UNDERGROWTH`, all five `GRASS`, all five white and
 * yellow `FLOWERS` — costs **+165.2%**. What ships costs **+36.7%**, which is about a third again.
 *
 * ⚠ THE THING THAT COSTS, MEASURED RATHER THAN GUESSED, IS TRIANGLES AND A FOURTH MATERIAL. The
 * three `Leafy_Bush_*` alone are 4,296 triangles and pull in `Pine_Foliage_02`, a material the
 * asset does not otherwise carry, for **+82.6%** on their own. The three `Yellow_Flowers_*` are
 * cheap in triangles and pull in the SAME fourth material, which is what makes yellow cost
 * +19 points rather than the +2 its 300 triangles suggest.
 */
export const COVER_GAP_2026_09_03 = {
  'Leafy_Bush_01/02/03': 'the kit’s pale fuzzy mounds — a fourth material and 4,296 triangles, +82.6% on their own',
  'Fern_01/02/03': 'the recipe’s ferns — cheap, but the bush role already reads without them',
  'Grass_01/02': 'the two single grass blades — the three clumps carry the tuft role',
  White_Flower_02: 'a second white flower shape — +11.7 points for a shape variation at 1 ground unit',
  'Yellow_Flowers_01/02/03': 'the recipe’s yellow flowers — cheap in triangles, but each pulls in the fourth material',
} as const;

export type KitAssembly = keyof typeof KIT_ASSEMBLIES;

/**
 * WHICH ASSEMBLIES SERVE EACH ROLE.
 *
 * ⚠ HAND-AUTHORED, UPSTREAM OF THE ASSET. A list derived from whatever the `.glb` happened to
 * contain would shrink silently with it, and a role whose objects all vanished would stop being
 * drawn AND stop being expected in the same instant
 * (`an-expectation-derived-from-its-subject-cannot-fail`). `kit-vocabulary.test.ts` checks these
 * names against the committed asset's own manifest in BOTH directions, so a missing object and a
 * paid-for byte that draws nothing are each a loud two-place mismatch.
 *
 * TWO pine assemblies rather than one, and that matters more than it did: a capability now grows
 * ONE tree, so an island of eleven identical trees would be eleven copies of one silhouette
 * rather than a forest. They alternate deterministically.
 */
export const KIT_ROLE_ASSEMBLIES = {
  tree: ['pine-a', 'pine-b'],
  deadTree: ['pine-dead'],
  bloom: ['flower'],
  // ⚠⚠ THE THREE CRITERION FORMS ARE ONE ASSEMBLY, and that is a MEASURED CONSTRAINT rather than
  // a preference. The committed kit carries two flowers, `Red_Flower_01` and `White_Flower_01`,
  // and BOTH wear `Pine_Forest_Foliage` — the same atlas as the grass clumps, the leafy plants and
  // the ground cover. So the tint route is closed: `tintedMaterial` rotates a material's MEAN
  // chromaticity, and this material's mean is mostly green foliage rather than the flower's own
  // petals, so a per-state tint would be unpredictable on the petals AND would repaint whatever
  // else shared the bucket. A new bud object is closed too — the repo holds the exported `.glb`
  // and no `.blend` behind it. What is left is SIZE and ATTITUDE, which is what the three forms
  // use ({@link KIT_ROLE_SIZE}, {@link KIT_ROLE_TILT}), and white is NOT among them: the ground
  // cover already owns the white flower, so a white criterion marker would be the one collision
  // the vocabulary has always refused (see {@link clearanceFactor}'s closing note).
  bud: ['flower'],
  wilt: ['flower'],
  // ⚠ TWO SHAPES FOR THE BUSH FOR THE REASON THE PINE HAS TWO, and it binds HARDER here: the
  // recipe stands 70 undergrowth per island against 13 stands, so one silhouette repeated is a
  // defect five times over. The tuft has the recipe's own three clumps. The flower has one shape,
  // which is the cheapest subset that reads (see {@link COVER_GAP_2026_09_03}) — 26 per island,
  // under one ground unit each, where a second shape bought less than the bush's second did.
  bush: ['plant-a', 'plant-b'],
  tuft: ['tuft-a', 'tuft-b', 'tuft-c'],
  flowerPatch: ['flower-white'],
} as const satisfies Record<KitRole, readonly KitAssembly[]>;

/** Every kit object the vocabulary names, deduped — the manifest the asset is checked against. */
export function kitObjectNames(): string[] {
  const out = new Set<string>();
  for (const assemblies of Object.values(KIT_ROLE_ASSEMBLIES)) {
    for (const assembly of assemblies) for (const name of KIT_ASSEMBLIES[assembly]) out.add(name);
  }
  return [...out].sort();
}

/**
 * HOW BIG EACH ROLE IS, in ground units — and WHICH AXIS that number is about.
 *
 * ⚠⚠ SCALING A FLAT PROP BY ITS HEIGHT BLOWS UP ITS FOOTPRINT. `Red_Flower_01` is 0.98 units
 * wide and 0.60 tall in the kit; asking for a 5-unit-TALL bloom multiplied it by 8.3 and
 * delivered a flower 8.2 ground units across — as wide as a whole pine's canopy. A criterion
 * marker the size of a tree is the art asserting an importance the signal does not have. So a
 * TALL prop is sized by its height and a FLAT one by its width, and which is which is declared
 * rather than inferred.
 *
 * ⚠ READ AGAINST THE OBJECT FLOOR, NOT CHOSEN. Below about 10 delivered pixels an isolated mark
 * stops being an object and becomes speckle. Width does not foreshorten at this camera and
 * height does, by cos(50°) = 0.643 — so a height-sized prop needs 7.8 ground units to clear the
 * floor at the overview and a width-sized one needs 5.
 */
export const KIT_ROLE_SIZE = {
  tree: { axis: 'height', units: 18 },
  deadTree: { axis: 'height', units: 15 },
  bloom: { axis: 'width', units: 4 },
  // ⚠⚠ THE BUD IS THE BLOOM, NARROWER — the open/closed read is carried by SIZE, because it is the
  // only axis this kit leaves open (see {@link KIT_ROLE_ASSEMBLIES}'s note). 2.6 is not a taste
  // pick; it is the value inside BOTH bounds below, each of which is a different confusion:
  //
  //   against the BLOOM it must be clearly narrower, or "how many have opened" is unreadable —
  //     {@link BUD_MAX_SHARE_OF_BLOOM} 0.7 x 4 = 2.8, and 2.6 is 65% of the bloom's width, which
  //     is 42% of its delivered area.
  //   against the GROUND COVER's white flowers it must be clearly WIDER, or a criterion nobody has
  //     signed is speckle — the widest delivered cover flower is `KIT_ROLE_SIZE.flowerPatch 0.34 x
  //     COVER_SCALE.flowerPatch.max 1.304 x COVER_SIZE 4.5 = 1.995` units, which SHIPS (4.5 is the
  //     shipped rung, not just the boldest the ladder can reach), so
  //     {@link BUD_MIN_MULTIPLE_OF_COVER_FLOWER} 1.25 x 1.995 = 2.494 is the floor.
  //
  // ⚠ IT DOES NOT INHERIT THE BLOOM'S HALF-WIDTH GUARANTEE, and saying so is the point.
  // {@link FLOWER_PATCH_MAX_SHARE_OF_BLOOM} is anchored on the BLOOM and stays exactly where it
  // was — the bud is held to the weaker, separately-named bound above, and what carries the rest
  // is the ASSET: a bud is `Red_Flower_01` and a cover flower is `White_Flower_01`, never the
  // same object. Widening the half-width rule to cover the bud instead would have forced the bud
  // to the bloom's own width and destroyed the signal it exists to carry — the shape
  // `a-distinctness-bound-belongs-to-what-it-distinguishes-from` warns about.
  bud: { axis: 'width', units: 2.6 },
  // The wilt is the bloom's own width: a criterion witnessed FAILING is not a smaller claim than
  // one witnessed passing, and shrinking it would say it were. What tells them apart is
  // {@link KIT_ROLE_TILT}.
  wilt: { axis: 'width', units: 4 },
  // ⚠⚠ THE BUSH AND THE TUFT ARE THE RECIPE'S OWN DELIVERED WIDTHS — the ROLE size, which
  // `cover-dressing.ts`'s size rung then multiplies. Each is the WIDEST assembly serving the role,
  // at its native kit width, times the MEAN of the scale `build_land.py` sprinkles it at, so rung 1
  // is `build_land.py` transcribed and nothing else. The arithmetic, so a reader can recompute:
  //   bush  Leafy_Plant_01 1.0267 x mean(0.70, 1.35) = 1.025  ->  1.052  -> 1.05
  //   tuft  Grass_Clump_01 0.8105 x mean(0.80, 1.70) = 1.250  ->  1.013  -> 1.01
  //
  // ⚠⚠ THE FLOWER PATCH IS NOT THE RECIPE'S 0.94, AND THE DIFFERENCE IS A RULE RATHER THAN A LOOK.
  // It is derived BACKWARDS from the one thing this row may not break: a ground-cover flower must
  // stay under HALF the criterion marker's width at the BOLDEST rung the ladder can reach, or the
  // map grows a second object at the marker's size. So
  // `units = (bloom 4 x 0.5) / (COVER_SCALE.flowerPatch.max 1.304 x boldest rung 4.5) = 0.3408`,
  // rounded DOWN to 0.34 — the direction that keeps the bound. `kit-vocabulary.test.ts` asserts the
  // bound over every rung rather than at the shipped one, because a scale-back must not be what
  // makes the map honest.
  //
  // ⚠ ALL THREE ARE SIZED BY WIDTH, like the bloom and for the same reason: they are FLAT props,
  // and scaling one by its height multiplies its footprint by the same factor — the 8.2-unit
  // flower of 2026-08-29. All three are FAR below the object floor at the ROLE size, which is what
  // ground cover IS ({@link clearsObjectFloor} scopes its claim to the scene roles for exactly
  // this) — and the boldest rung still leaves the widest bush under two-thirds of a pine's canopy.
  bush: { axis: 'width', units: 1.05 },
  tuft: { axis: 'width', units: 1.01 },
  flowerPatch: { axis: 'width', units: 0.34 },
} as const satisfies Record<KitRole, { axis: 'height' | 'width'; units: number }>;

/**
 * THE PER-PLACEMENT SCALE SPREAD OF A GROUND-COVER ROLE — the recipe's own uniform, renormalised
 * about its mean so that a placement at the middle of the range stands at exactly the role's
 * declared width, before `cover-dressing.ts`'s size rung.
 *
 * ⚠ WHY RENORMALISE RATHER THAN TRANSCRIBE. `build_land.py` multiplies the kit's NATIVE size; this
 * vocabulary declares a role size in GROUND UNITS and multiplies that. Transcribing `uniform(0.7,
 * 1.35)` onto a role already scaled to the recipe's mean would apply the spread twice and deliver
 * bushes up to 1.35x too wide. Renormalised, rung 1's delivered width range is the recipe's
 * exactly: `1.05 x [0.683, 1.317] = [0.717, 1.383]` ground units against the recipe's own
 * `1.0267 x [0.70, 1.35] = [0.719, 1.386]`.
 *
 * ⚠⚠ AND ITS `max` IS WHAT THE CRITERION MARKER'S DISTINCTNESS IS DERIVED AGAINST. The bound the
 * row asks for is on the flower patch's WIDEST delivered prop at the BOLDEST rung, never on its
 * declared size and never at the shipped rung alone — see {@link KIT_ROLE_SIZE}'s flower entry,
 * which is computed backwards from exactly this number.
 */
export const COVER_SCALE = {
  bush: { min: 0.683, max: 1.317 },
  tuft: { min: 0.64, max: 1.36 },
  flowerPatch: { min: 0.696, max: 1.304 },
} as const satisfies Record<'bush' | 'tuft' | 'flowerPatch', { min: number; max: number }>;

/** How much narrower than the criterion marker a ground-cover flower must be, as a fraction of the
 *  bloom's own width — the row's "under half the bloom's width", stated once so the test reads it
 *  rather than restating a number the tables could drift away from. */
export const FLOWER_PATCH_MAX_SHARE_OF_BLOOM = 0.5;

/** How wide an unopened bud may be as a fraction of the OPENED bloom's width — the bound that
 *  keeps "how many have opened" readable at all (ADR-0600 D1). Stated once so
 *  `kit-vocabulary.test.ts` reads it rather than restating a number the size table could drift
 *  away from. */
export const BUD_MAX_SHARE_OF_BLOOM = 0.7;

/** How many times the WIDEST DELIVERED ground-cover flower a bud must be — the other side of the
 *  bud's size, and a different confusion from the one above: too narrow and a criterion nobody has
 *  signed is indistinguishable from scenery. The cover's own width is measured at the SHIPPED
 *  rung, which is also the boldest the ladder reaches. */
export const BUD_MIN_MULTIPLE_OF_COVER_FLOWER = 1.25;

/**
 * HOW FAR OFF VERTICAL EACH ROLE STANDS, in radians — zero for everything that stands up, and the
 * ONE thing that tells a failing criterion from a signed one.
 *
 * ⚠⚠ ATTITUDE RATHER THAN COLOUR OR SHAPE, and it is not a free choice: the committed kit has one
 * flower mesh on a shared material atlas ({@link KIT_ROLE_ASSEMBLIES}), so colour is closed and a
 * second shape is closed. It is also the 2D map's OWN form for this state, not something invented
 * here — `scene.ts`'s marker painter draws `tall-flower-failing` as *"a wilting, drooping deep-red
 * bloom"* and has since ADR-0226 D4. A nodding flower reads as *went wrong*; a SMALLER one would
 * have read as *less*, which is not what failing means.
 *
 * ⚠ IT IS A PROPERTY OF THE ROLE, NOT OF THE PLACEMENT, deliberately. Every placement in the repo
 * is built by one of two placers, and a per-placement field would have had to be spelled at every
 * literal in both — including the ones that mean nothing by it — so the commonest value would be
 * the one nobody was thinking about when they wrote it. Read off the role, a prop's attitude is
 * whatever its role says and cannot be set wrong at a call site.
 *
 * ⚠ THE FOOTPRINT AND THE CAST SHADOW ARE BOTH READ UPRIGHT, and the size of that approximation is
 * stated rather than waved at: the flower delivers 4 units of width over 2.445 of height, so at
 * 60° off vertical its ground extent is `4 x cos60 + 2.445 x sin60 = 4.12` units against the 4 the
 * tables declare — 3% wide, inside {@link FOOTPRINT_TOLERANCE}'s own neighbourhood and far inside
 * the clearance it feeds. The cast shadow keeps the bloom's upright silhouette
 * (`ROLE_SILHOUETTE` in `ground-casters.ts`), which is a shape approximation on the one role the
 * live corpus currently has no instances of at all.
 */
export const KIT_ROLE_TILT = {
  tree: 0,
  deadTree: 0,
  bloom: 0,
  bud: 0,
  wilt: Math.PI / 3,
  bush: 0,
  tuft: 0,
  flowerPatch: 0,
} as const satisfies Record<KitRole, number>;

/** Ground units a HEIGHT-sized prop needs to clear the ~10px object floor at the overview. */
export const MIN_PROP_HEIGHT = 7.8;
/** Ground units a WIDTH-sized prop needs for the same, since width does not foreshorten. */
export const MIN_PROP_WIDTH = 5;

/** What this role delivers at a given zoom, in device pixels, along the axis it is sized by. */
export function deliveredRolePx(role: KitRole, pxPerUnit: number): number {
  const size = KIT_ROLE_SIZE[role];
  return size.axis === 'height' ? deliveredHeightPx(size.units, pxPerUnit) : size.units * pxPerUnit;
}

/**
 * Does a prop of this declared size clear the object floor at the overview zoom?
 *
 * ⚠⚠ A SIZE RATHER THAN A ROLE, AND THE REASON IS THAT THE ROLES CANNOT SHOW THE FORK. All three
 * declared roles answer the same either way — 18, 15 and 4 units all fall on the same side of both
 * thresholds — so a predicate reading the WRONG axis is invisible through them, and the axis fork
 * is the whole point: width does not foreshorten at this camera and height does.
 */
export function sizeClearsObjectFloor(size: { axis: 'height' | 'width'; units: number }): boolean {
  return size.units >= (size.axis === 'height' ? MIN_PROP_HEIGHT : MIN_PROP_WIDTH);
}

/**
 * Does this role clear the object floor at the overview zoom?
 *
 * ⚠⚠ THE FLOOR IS A CLAIM ABOUT SIGNALS, AND SINCE 2026-09-03 IT IS SCOPED TO THEM. A prop that
 * REPORTS something has to be readable as an object or the map is asserting a state nobody can
 * see; ground cover reports nothing and is speckle ON PURPOSE — it is the texture that makes the
 * island read as a place, and a bush sized to clear the floor would be five units across, as wide
 * as a pine's canopy. So the three `dressing` roles answer `false` here HONESTLY rather than
 * failing a rule that was never about them, and `kit-vocabulary.test.ts` asserts the scoping
 * ({@link SCENE_ROLES}) instead of asserting the floor over every role — which would have been the
 * shape that quietly widens a guarantee to keep a table green.
 */
export function clearsObjectFloor(role: KitRole): boolean {
  return sizeClearsObjectFloor(KIT_ROLE_SIZE[role]);
}

/** The camera elevation every land picture on this arc is taken at. */
export const RENDER_ELEV_DEG = 50;

/** What a prop of this world height delivers, in device pixels, at a given zoom. */
export function deliveredHeightPx(worldHeight: number, pxPerUnit: number): number {
  return worldHeight * Math.cos((RENDER_ELEV_DEG * Math.PI) / 180) * pxPerUnit;
}

// ------------------------------------------------------------------ what a state grows

/**
 * WHAT ONE CAPABILITY'S STATE GROWS: a role, and the leaf tint that role's crown wears.
 *
 * A `null` tint is not "no colour" — it is "this form carries the state without one": a green
 * pine is the kit's own needles and a bare dead trunk has no leaves at all.
 */
export interface StateForm {
  role: KitRole;
  /** The status whose declared leaf tint the crown wears, or `null` for an untinted form. */
  tint: string | null;
}

/**
 * THE VOCABULARY ITSELF — the whole of the owner's 2026-08-29 answer, as a function.
 *
 * `unknown` grows NOTHING, and it is the load-bearing entry: an island that drew a confident
 * tree for a capability whose state nobody has checked would be the art asserting a proof state
 * the work does not hold, which is the one way this arc can do real harm (ADR-0392 D5 /
 * ADR-0398 D7). It returns `null` rather than some quiet default for that reason.
 *
 * ⚠ AN UNRECOGNISED STATUS ALSO GROWS NOTHING. Failing closed here means a state this vocabulary
 * has never heard of is drawn as doubt rather than as whichever arm happened to be first.
 */
export function stateForm(status: string): StateForm | null {
  if (status === 'healthy') return { role: 'tree', tint: null };
  if (status === 'mapped' || status === 'proposed' || status === 'building') {
    return { role: 'tree', tint: status };
  }
  if (status === 'unhealthy') return { role: 'deadTree', tint: null };
  return null;
}

/** Every state the vocabulary draws something for, with the form it draws — the table a report
 *  prints and `kit-vocabulary.test.ts` holds against `LEAF_TINT_TOKEN`. */
export const VOCABULARY_STATES: readonly string[] = [
  'healthy',
  'mapped',
  'proposed',
  'building',
  'unhealthy',
  'unknown',
];

// ------------------------------------------------------------------ the facts a parcel carries

/**
 * THE ONE FACT ABOUT A CAPABILITY THAT DECIDES WHAT STANDS ON ITS PARCEL.
 *
 * ⚠ IT USED TO BE FOUR. `contracts`, `drift` and `retired` are gone because density is no longer
 * a design input and the two signals that read from numbers are withdrawn. Leaving them on the
 * interface would leave three fields nothing consults, which is how a reader concludes the
 * island still reports something it does not.
 */
export interface CapabilityFacts {
  capId: string;
  status: string;
}

/**
 * Read each capability's state off the SHIPPED map's own ground cells.
 *
 * ⚠ THIS IS WHY `worldTo3D` HAD TO LEARN THE PARCEL IDENTITY. A `cell-ground` descriptor carries
 * the FOLDED status and the ring; until 2026-08-30 it carried nothing saying WHOSE parcel it was,
 * so eleven `healthy` capabilities were eleven copies of one value and ADR-0475's ONE OBJECT PER
 * CAPABILITY could not be expressed on this surface at all. The harness reaches the same facts
 * through its fixture (`capabilityFacts` in `harness/kit-vocabulary.ts`); the product reads them
 * off the map it is drawing.
 *
 * ⚠ A CAPABILITY IS COUNTED ONCE, in first-seen cell order, and its status is its FIRST cell's.
 * A parcel whose cells disagreed about their status would be a scene defect rather than a case to
 * average over, and averaging would draw one confident tree for a contradiction.
 */
export function capabilityFactsFrom(cells: readonly LayoutCell[]): CapabilityFacts[] {
  const out: CapabilityFacts[] = [];
  for (const [capId, group] of cellsByParcel(cells)) {
    out.push({ capId, status: group[0]!.status });
  }
  return out;
}

// ------------------------------------------------------------------ where each prop stands

export interface KitPlacement {
  role: KitRole;
  /** Which assembly stands here — one or more kit objects, placed as a unit. */
  assembly: KitAssembly;
  /** The capability whose state put it here, `story` for a whole-island signal, or
   *  {@link COVER_CAP_ID} for ground cover, which belongs to no unit of work (`cover-dressing.ts`). */
  capId: string;
  /** The status whose leaf tint this placement's crown wears, or `null` for an untinted form. */
  tint: string | null;
  at: GPoint;
  /** Ground height under the point, from the same relief field the land is built on. */
  y: number;
  /** Rotation about the vertical axis, radians. */
  yaw: number;
  /**
   * A UNIFORM scale on top of the role's own size — 1 for every object the vocabulary stands for a
   * capability or a signature; the ground cover's size rung times its per-prop spread for a
   * dressing prop (`cover-dressing.ts`).
   *
   * ⚠⚠ NO `tree` PLACEMENT STANDS BELOW 1 ANY MORE. The grove pines that did (0.55–0.80 of the
   * role, so the capability's own tree stayed tallest on its parcel) were retired outright by
   * ADR-0518: the owner read them as capabilities, and a tree on the map now means exactly one
   * capability. `kit-vocabulary.test.ts` holds that no dressing role shares the tree role's form.
   *
   * ⚠ IT REACHES THREE PLACES AND MUST REACH ALL OF THEM: the drawn geometry (`placementScale` in
   * `kit-mesh.ts`), the delivered extent the object floor is read against (`placementExtent`), and
   * the shadow the placement casts (`placementCaster` in `ground-casters.ts` — radius and height
   * both scale). A scale applied to the mesh and not to the caster would draw a small tree with a
   * full-size shadow, which reads as a lighting bug rather than as a scale that missed a reader.
   * The OCCUPANCY it keeps is deliberately NOT scaled — see {@link pairClearance}.
   */
  scale: number;
}

/**
 * A deterministic stream. `Math.random` is forbidden on this surface (ADR-0380 D6 fence 2), and
 * a scatter that moved between runs would present that movement as the direction.
 */
export function propStream(seed: number): () => number {
  let s = (seed | 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 8) & 0xffffff) / 0x1000000;
  };
}

/**
 * Candidate points inside a set of cells, sampled from THE CELLS THEMSELVES rather than from a
 * parcel outline.
 *
 * ⚠ WHY NOT `parcelLoop`. It throws for any parcel that is not one simple loop, and two of this
 * island's eleven are not. A capability silently missing its tree would be the island
 * under-reporting the work, which is worse here than a slightly less tidy point: this dressing's
 * whole claim is that every capability the map knows about is on it.
 *
 * A cell is a quadrilateral, so a point inside it is a bilinear sample, pulled toward the
 * centroid so nothing sits on an edge two parcels share — a tree straddling a boundary reads as
 * belonging to neither.
 */
export function candidatePoints(
  cells: readonly LayoutCell[],
  count: number,
  seed: number,
): GPoint[] {
  // ⚠ NO `count <= 0` CLAUSE — `Math.max(0, count)` below already answers one, and a second
  // early-out changes no output, which is a mutant nothing can kill.
  if (cells.length === 0) return [];
  const rand = propStream(seed);
  const out: GPoint[] = [];
  // ⚠ A MATERIALISED RANGE RATHER THAN A COUNTER. `for (let i = 0; i < count; i++)` carries
  // mutants flipping `++` to `--` and `<` to `>`; neither fails an assertion, both run forever,
  // and `check:mutation-diff` scores a hang as UNPROVEN — credited to nobody, redding the rung.
  for (const _ of Array.from({ length: Math.max(0, count) })) {
    void _;
    const p = samplePoint(cells, rand);
    if (p === null) continue;
    out.push(p);
  }
  return out;
}

/**
 * ONE POINT INSIDE ONE OF THESE CELLS, off a caller's own stream — the arithmetic {@link
 * candidatePoints} runs, extracted so the GROUND COVER can draw from a single island-long stream
 * rather than re-seeding per prop (`cover-dressing.ts`).
 *
 * ⚠⚠ IT CONSUMES ITS FOUR DRAWS BEFORE IT CAN REFUSE, and that ordering is the whole reason this
 * is one function rather than two implementations that agree. A degenerate cell makes the point
 * unusable, not the draws unmade — pulling the refusal ahead of the sampling would leave one
 * caller's stream a different length from the other's, and every placement downstream of the
 * refusal would move on a map that had drawn a two-point cell somewhere. `null` is the refusal.
 */
export function samplePoint(cells: readonly LayoutCell[], rand: () => number): GPoint | null {
  const cell = cells[Math.floor(rand() * cells.length) % cells.length]!;
  const u = rand();
  const v = rand();
  const jitter = rand();
  const pts = cell.points;
  if (pts.length < 3) return null;
  const a = pts[0]!;
  const b = pts[1]!;
  const c = pts[2]!;
  const d = pts[3] ?? pts[0]!;
  const top = { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
  const bot = { x: d.x + (c.x - d.x) * u, z: d.z + (c.z - d.z) * u };
  const raw = { x: top.x + (bot.x - top.x) * v, z: top.z + (bot.z - top.z) * v };
  let cx = 0;
  let cz = 0;
  for (const p of pts) {
    cx += p.x;
    cz += p.z;
  }
  cx /= pts.length;
  cz /= pts.length;
  const pull = 0.18 + jitter * 0.12;
  return { x: raw.x + (cx - raw.x) * pull, z: raw.z + (cz - raw.z) * pull };
}

/** One prop's ground footprint — the circle it occupies, which is what a neighbour is kept out of. */
export interface Occupancy {
  x: number;
  z: number;
  radius: number;
}

/** ONE NUMBER PER ROLE — the shape every frozen table and every measured table here shares, named
 *  once so the four of them are one contract rather than four spellings of a dictionary. */
export type RoleTable = Readonly<Record<KitRole, number>>;

/** The ground WIDTH each role occupies, in ground units, keyed by role. */
export type RoleFootprints = RoleTable;

/**
 * THE FOOTPRINTS THE COMMITTED ASSET DELIVERS, frozen at the 2026-08-29 re-export.
 *
 * ⚠ IT IS A CHECK ON A MEASUREMENT, NOT THE MEASUREMENT. `roleFootprints` in `kit-scene.ts`
 * reads these off the loaded kit and is what the dressing actually uses; this literal is derived
 * from the export's own world-space bounds report (`export-dressing.py` prints them beside the
 * asset) and exists so the number can be checked WITHOUT a GPU — the pure tests dress with it,
 * and `kit-island-measure.mjs` refuses a run where the loaded kit disagrees with it. A re-export
 * that changed a tree's proportions would otherwise move every placement on every island with
 * nothing anywhere saying so.
 *
 * The arithmetic, so a reader can recompute rather than trust: a role sized by HEIGHT scales by
 * `units / assembly.height` and the footprint is `assembly.width * scale`; a role sized by WIDTH
 * scales by `units / assembly.width`, so its footprint is its declared width exactly. `tree`
 * takes the WIDER of its two pines, because a role's clearance has to be enough for any arm.
 */
export const KIT_FOOTPRINTS_2026_08_29 = {
  tree: 10.13,
  deadTree: 7.33,
  bloom: 4,
  // The bud and the wilt are the same assembly at their own declared widths — a width-sized role's
  // footprint IS its declared width (see the next note). The wilt's is read UPRIGHT; what that
  // costs is computed in {@link KIT_ROLE_TILT}.
  bud: 2.6,
  wilt: 4,
  // ⚠ A WIDTH-SIZED ROLE'S FOOTPRINT IS ITS DECLARED WIDTH EXACTLY, by construction — every
  // assembly serving it is scaled TO that width, so the widest is that width. These three restate
  // `KIT_ROLE_SIZE` for the same reason the two pines' heights do, and the test holds them to it.
  // The measurement that says the asset really delivers them is `roleFootprints` off the loaded
  // kit; this literal is what the placement is computed against before the asset has parsed.
  bush: 1.05,
  tuft: 1.01,
  flowerPatch: 0.34,
} as const satisfies RoleFootprints;

/** How far the loaded kit's own footprints may sit from the frozen literal, as a fraction. */
export const FOOTPRINT_TOLERANCE = 0.01;

/** The ground HEIGHT each role reaches, in ground units, keyed by role — what a placement's shadow
 *  is cast from (`placementCaster` in `ground-casters.ts`). */
export type RoleHeights = RoleTable;

/**
 * THE HEIGHTS THE COMMITTED ASSET DELIVERS AT EACH ROLE'S SIZE, frozen at the 2026-08-29 re-export
 * — the second frozen table beside {@link KIT_FOOTPRINTS_2026_08_29}, and it exists for the same
 * reason: since 2026-09-03 every kit placement casts a shadow, the shadow is stamped from a
 * cylinder of the placement's own radius AND height, and the placement is computed BEFORE the
 * kit is parsed (the canvas builds its ground synchronously off these literals and never waits on
 * the asset). A height read off the loaded kit would arrive after the ground was already shaded.
 *
 * The arithmetic, so a reader can recompute rather than trust: a role sized by HEIGHT delivers its
 * declared height EXACTLY, by construction — both pines scale to 18 and the dead trunk to 15 — so
 * those two entries are `KIT_ROLE_SIZE` restated, and `kit-vocabulary.test.ts` holds them to it. The
 * bloom is sized by WIDTH, so its height falls out of the export's own bounds: `Red_Flower_01` is
 * 0.980 wide (x, its widest horizontal extent) and 0.599 tall in the kit, so at 4 units wide it is
 * `4 * 0.599 / 0.980 = 2.445` tall. `roleHeights` in `kit-mesh.ts` reads the same numbers off the
 * loaded kit and {@link heightDriftOf} is what holds the two together.
 */
export const KIT_HEIGHTS_2026_08_29 = {
  tree: 18,
  deadTree: 15,
  bloom: 2.445,
  // The bud and the wilt are `Red_Flower_01` at their own widths, so their heights fall out of the
  // same proportion the bloom's does: `width x 0.599 / 0.980`.
  //   bud   2.6 x 0.599 / 0.980 = 1.589
  //   wilt  4   x 0.599 / 0.980 = 2.445, the bloom's own — they are the same size upright
  bud: 1.589,
  wilt: 2.445,
  // ⚠ THE THREE GROUND-COVER HEIGHTS FALL OUT OF THEIR PROPORTIONS, exactly as the bloom's does —
  // `declared width x (assembly height / assembly width)`, the TALLEST assembly winning, off the
  // 2026-09-03 re-export's own world bounds:
  //   bush        max(1.05 x 0.4754/1.0267, 1.05 x 0.5406/0.9537)                     = 0.595
  //   tuft        max(1.01 x 0.6810/0.8105, 1.01 x 0.5763/0.6303, 1.01 x 0.4810/0.6759) = 0.924
  //   flowerPatch 0.34 x 0.5042/0.8163                                                = 0.210
  // ⚠⚠ AND NOTHING CASTS FROM THEM — see `cover-dressing.ts`'s header. They are frozen anyway
  // because `roleHeights` measures EVERY role off the loaded kit and {@link heightDriftOf} compares
  // every role: a table with three holes in it would be a drift check that stopped checking three
  // roles the moment they existed.
  bush: 0.595,
  tuft: 0.924,
  flowerPatch: 0.21,
} as const satisfies RoleHeights;

/**
 * WHERE A MEASURED TABLE DISAGREES WITH ITS FROZEN LITERAL, beyond {@link FOOTPRINT_TOLERANCE} —
 * one line per role, naming both numbers, empty when the asset still delivers what was frozen.
 *
 * ⚠ PURE AND SHARED BY THE TWO CALLERS THAT LOAD THE KIT — `harness/kit-island-scene.ts`, which
 * REFUSES a run over any line, and the shipped canvas, which reports every line loudly and keeps
 * drawing (a re-exported tree at the wrong clearance is a visible defect; a map with no props on
 * it is every capability unreported, which ADR-0392 D5 / ADR-0398 D7 rank worse). Pure so the
 * comparison itself is proved without a GPU, which is the whole point of freezing a literal: the
 * placement tests dress against these numbers, and this is the leg that ties them to the asset.
 */
export function roleDrift(measured: RoleTable, declared: RoleTable, what: string): string[] {
  const out: string[] = [];
  for (const role of KIT_ROLES) {
    const want = declared[role];
    const got = measured[role];
    // Stryker disable next-line EqualityOperator: EQUIVALENT (measure zero) — a drift of EXACTLY
    // the tolerance, to the last bit of a double, is one input in a continuum and the fixtures
    // sit either side of it.
    if (Math.abs(got - want) / want > FOOTPRINT_TOLERANCE) {
      out.push(
        `${role}: the loaded kit delivers a ${what} of ${got.toFixed(3)} ground units, the frozen ` +
          `literal declares ${want} — every placement was computed against the frozen number, so ` +
          're-measure and update the literal',
      );
    }
  }
  return out;
}

/** {@link roleDrift} against {@link KIT_FOOTPRINTS_2026_08_29}. */
export function footprintDriftOf(measured: RoleFootprints): string[] {
  return roleDrift(measured, KIT_FOOTPRINTS_2026_08_29, 'footprint');
}

/** {@link roleDrift} against {@link KIT_HEIGHTS_2026_08_29}. */
export function heightDriftOf(measured: RoleHeights): string[] {
  return roleDrift(measured, KIT_HEIGHTS_2026_08_29, 'height');
}

/**
 * THE CIRCLE ONE PROP OCCUPIES — a declared footprint is a WIDTH, so the radius is half of it.
 *
 * ⚠⚠ IT IS A NAMED VALUE BECAUSE THE PLACEMENT CANNOT SHOW IT. `bestCandidate` scores
 * `distance − (own radius + theirs)`, so scaling every radius by a constant subtracts the same
 * amount from every candidate and the search's argmax does not move — a radius twice too big
 * places identically, and "nothing overlaps" is satisfied by any radius at least as large as the
 * true one. What the two callers CAN be held to is that they agree: the clearance the placement
 * keeps is the clearance {@link dressingOverlaps} measures against, and `kit-vocabulary.test.ts`
 * asserts the detector's own arithmetic against exact gaps.
 */
export function propRadius(footprint: RoleFootprints, role: KitRole): number {
  return footprint[role] / 2;
}

/**
 * THE `capId` A GROUND-COVER PROP WEARS (`cover-dressing.ts`) — the one `capId` on the map that
 * names no unit of work.
 *
 * ⚠ IT IS NOT WHAT TELLS COVER APART — {@link isDressingRole} over the placement's ROLE is, and
 * that is a property of the vocabulary rather than of a string. This exists so that a reader of a
 * placement list, a census row or a debug dump sees a named owner instead of an empty field, and
 * so that no ground-cover prop can ever collide with a real capability's id.
 *
 * ⚠ THERE IS NO `grove` `capId` ANY MORE. Until 2026-09-05 a healthy island's grove pines wore
 * `'grove'` on the `tree` role, and every reader told them from a capability's own pine by that
 * string alone. ADR-0518 retired the role: a `tree` placement IS a capability's now, with nothing
 * a reader has to check.
 */
export const COVER_CAP_ID = 'cover';

/** Is this placement ground cover — scenery that asserts nothing? Read off the ROLE. */
export function isCoverPlacement(p: KitPlacement): boolean {
  return isDressingRole(p.role);
}

/**
 * The factor the full clearance is multiplied by for a pair: ZERO when either is ground cover, 1
 * for every other pair. A named function rather than a ternary at each call site, because copies
 * of one rule are rules that agree today.
 *
 * ⚠ THERE USED TO BE A THIRD ANSWER — 0.45 between two grove members, the one declared relaxation
 * that let a stand's crowns touch — and it went with the grove (ADR-0518). Every pair of objects
 * that REPORT something keeps the full sum, which is what keeps each capability's object readable:
 * an object standing inside another's clearance is the defect the owner reported once already
 * ("the rocks are appearing where the trees are").
 *
 * ⚠⚠ ZERO FOR A `dressing` ROLE, AND THAT IS THE RECIPE'S OWN RULE RATHER THAN A RELAXATION WE
 * INVENTED. `build_land.py`'s `sprinkle` (`:1082-1090`) tests a ground-cover point for `inside` and
 * `wear` and for NOTHING ELSE — no tree clearance, no clearance from other cover. Undergrowth
 * grows under and around what stands on the land; that is what makes it ground COVER rather than a
 * fourth kind of object competing for floor. So a bush at a pine's foot is not an overlap, and
 * {@link dressingOverlaps} does not report one.
 *
 * ⚠ WHAT KEEPS THE CRITERION MARKER SAFE IS THEREFORE NOT DISTANCE — it never was. It is the ASSET
 * (a flower patch is `White_Flower_01`, never `Red_Flower_*`) and the SIZE ({@link COVER_SCALE}'s
 * widest delivered patch is under a third of the bloom's width). Both are properties of the tables
 * above, which is where `kit-vocabulary.test.ts` holds them, and neither can be undone by moving a
 * prop.
 */
export function clearanceFactor(a: KitPlacement, b: KitPlacement): number {
  return isDressingRole(a.role) || isDressingRole(b.role) ? 0 : 1;
}

/**
 * THE CENTRE-TO-CENTRE DISTANCE TWO PLACEMENTS MUST KEEP — the sum of their role radii, relaxed
 * by {@link clearanceFactor}.
 *
 * ⚠ THE ROLE'S FULL FOOTPRINT, NEVER THE SCALED ONE. A placement drawn below the role's size is
 * narrower than the footprint says, and using its delivered width would let it stand closer to a
 * capability's pine than a full-size neighbour may — which is exactly the clearance that keeps
 * the capability's object readable. The scale reaches the geometry and the shadow
 * (`KitPlacement.scale`); the occupancy is the role's.
 */
export function pairClearance(a: KitPlacement, b: KitPlacement, footprint: RoleFootprints): number {
  return (propRadius(footprint, a.role) + propRadius(footprint, b.role)) * clearanceFactor(a, b);
}

/** How many candidates a placement is chosen from. Fixed rather than tuned: it is the resolution
 *  of the search, and moving it moves every island's dressing, so it belongs beside the
 *  algorithm rather than in a caller's options. */
const CANDIDATES_PER_PLACEMENT = 96;

/**
 * PICK THE POINT FURTHEST FROM EVERYTHING ALREADY STANDING.
 *
 * ⚠⚠ THIS IS THE DEFECT THE OWNER REPORTED, AND ITS SHAPE IS WORTH KEEPING WRITTEN DOWN.
 * The previous dressing scattered ONE ROLE AT A TIME, and its minimum-gap rejection lived inside
 * that one call — so a rock was never tested against a tree, only against other rocks. Measured
 * on the fixture island on 2026-08-29, before this changed: **26 of the 2,926 prop pairs
 * overlapped**, seven of them rock-on-tree, and the worst put a rock 8.57 ground units inside a
 * pine. The owner saw exactly that and reported it as *"the rocks are appearing where the trees
 * are"*.
 *
 * ✅ AND WITHDRAWING THE ROCKS WOULD NOT HAVE FIXED IT — the same measurement says so, which is
 * why this is a separate fix rather than a side effect of the vocabulary change: six of the 26
 * were TREE ON TREE and two were a dead tree inside a live one. Removing rocks removes the
 * symptom the owner happened to see.
 *
 * The remedy is one occupancy set for the WHOLE island, every role in it, scored by the worst
 * clearance a candidate has against anything already placed. It is a best-candidate search
 * rather than rejection sampling because rejection has to decide what to do when it runs out of
 * attempts, and every answer to that is either "drop the prop" (the island under-reports) or
 * "place it anyway" (the defect, silently).
 */
export function bestCandidate<O extends Occupancy>(
  candidates: readonly GPoint[],
  radius: number,
  occupied: readonly O[],
  /** What a candidate of `radius` must keep from one occupant — the sum of the two radii unless
   *  the caller declares otherwise. Every caller in `src/` takes the default: the one declared
   *  relaxation (the grove's `groveNeed`, between two grove members and nowhere else) went with
   *  the grove under ADR-0518, and survives only in `harness/grove-history.ts`, a comparison
   *  page's control arm; see {@link pairClearance}. */
  need: (radius: number, o: O) => number = sumOfRadii,
): GPoint | null {
  let best: GPoint | null = null;
  let bestClearance = -Infinity;
  for (const p of candidates) {
    const clearance = worstClearance(p, radius, occupied, need);
    if (clearance > bestClearance) {
      bestClearance = clearance;
      best = p;
    }
  }
  return best;
}

/** The clearance a candidate must keep from an occupant when nothing is declared: their two radii,
 *  summed — the rule every capability tree and every bloom is placed by. */
export function sumOfRadii(radius: number, o: Occupancy): number {
  return radius + o.radius;
}

/**
 * THE WORST CLEARANCE A POINT HAS AGAINST EVERYTHING STANDING — `distance − need`, minimised over
 * the occupants; `Infinity` when nothing stands yet. Negative means the point is inside something's
 * clearance. The search above maximises it; a caller placing by rejection (the retired grove pass,
 * now `harness/grove-history.ts`) reads it directly to accept or reject one sample, so the two
 * keep props apart by ONE arithmetic rather than two that agree today.
 */
export function worstClearance<O extends Occupancy>(
  p: GPoint,
  radius: number,
  occupied: readonly O[],
  need: (radius: number, o: O) => number = sumOfRadii,
): number {
  let clearance = Infinity;
  for (const o of occupied) {
    const gap = Math.hypot(p.x - o.x, p.z - o.z) - need(radius, o);
    // Stryker disable next-line EqualityOperator: EQUIVALENT — on a tie the assignment stores
    // the value already in `clearance`, so `<` and `<=` differ only in whether a no-op runs.
    if (gap < clearance) clearance = gap;
  }
  return clearance;
}

export interface KitDressingOptions {
  /** The island's ground cells in the placement basis — `parcelCellsFrom(descriptors)` on the
   *  shipped path, `layoutCells(groundCellsFrom(scene))` on the harness's. */
  cells: readonly LayoutCell[];
  /** Each capability and the state it holds, in the order their trees are placed.
   *
   *  ⚠ AN ARGUMENT RATHER THAN SOMETHING DERIVED HERE, because the two surfaces reach it by
   *  different routes and only one of them has a fixture. `capabilityFactsFrom(cells)` is the
   *  shipped route; the harness passes its own `capabilityFacts(island)`. */
  facts: readonly CapabilityFacts[];
  /** How many UAT criteria the owner has signed — one OPEN bloom each, scattered over the whole
   *  island rather than over any one parcel (ADR-0226 D4). Zero draws none. */
  blooms: number;
  /** How many of the island's UAT criteria NOBODY HAS SIGNED YET — one unopened bud each, placed
   *  exactly as the blooms are (ADR-0600 D1: every criterion is drawn, and signing changes the
   *  flower's state rather than its existence).
   *
   *  ⚠ REQUIRED RATHER THAN DEFAULTING TO ZERO, and the direction is the point. The whole defect
   *  ADR-0600 corrects is an island quietly drawing fewer criteria than it holds; an optional
   *  field would have let any caller reproduce it by saying nothing, which is precisely how the
   *  first thirty-five went missing. A caller that genuinely draws none says `0` out loud. */
  buds: number;
  /** How many of the island's UAT criteria were witnessed FAILING — one nodding flower each. Same
   *  placement, same requiredness, same reason.
   *
   *  ⚠ ALL THREE ARE CLAMPED AT ZERO rather than refused, and that is this module's standing call
   *  rather than a new one: a nonsense count is a caller's arithmetic error, and an island that
   *  threw over one would take the WHOLE MAP down — every capability unreported, which ADR-0392 D5
   *  / ADR-0398 D7 rank worse than a degraded island. Same reasoning as `roleDrift`'s two callers. */
  wilts: number;
  /** The relief amplitude the ground is built at, so props sit ON the land rather than through it. */
  relief: number;
  /**
   * The ground width each role occupies, measured off the LOADED kit rather than declared here.
   *
   * ⚠ IT IS AN ARGUMENT ON PURPOSE. A footprint is a fact about the asset — a pine's canopy is
   * as wide as its own geometry says once scaled to its role's height — and a number restated
   * here would be a second copy that drifts the first time the asset is re-exported. The caller
   * that has the kit open computes it (`roleFootprints` in `kit-scene.ts`); the pure tests pass
   * the kit's own measured values.
   */
  footprint: RoleFootprints;
  seed?: number;
}

/**
 * DRESS THE WHOLE ISLAND. One object per capability, plus ONE FLOWER PER UAT CRITERION — opened
 * where the owner signed it, closed where he has not, nodding where it was witnessed failing
 * (ADR-0600 D1).
 *
 * The order is deliberate and is part of the placement: capabilities first, in the fixture's own
 * order, then the criterion markers — so a flower is placed around the trees rather than a tree
 * around the flowers. A criterion marker moved a few units is a smaller loss than a capability's own tree
 * moved off the middle of its parcel.
 */
export function dressIslandFromKit(opts: KitDressingOptions): KitPlacement[] {
  const cells = opts.cells;
  const facts = opts.facts;
  const heightAt = (x: number, z: number): number => landHeight(x, z, opts.relief);
  const seed0 = opts.seed ?? 11;
  const out: KitPlacement[] = [];
  // Stryker disable next-line ArrayDeclaration: EQUIVALENT, and provably rather than by
  // inspection. A fabricated entry carries no `x`, `z` or `radius`, so its gap is `NaN`;
  // `bestCandidate` compares with `NaN < clearance`, which is false, so the entry is skipped
  // exactly as an absent one is and no candidate's score can move.
  const occupied: Occupancy[] = [];

  const byParcel = cellsByParcel(cells);

  const place = (
    role: KitRole,
    assembly: KitAssembly,
    capId: string,
    tint: string | null,
    from: readonly LayoutCell[],
    seed: number,
    yaw: number,
  ): void => {
    const radius = propRadius(opts.footprint, role);
    const at = bestCandidate(candidatePoints(from, CANDIDATES_PER_PLACEMENT, seed), radius, occupied);
    if (!at) return;
    occupied.push({ x: at.x, z: at.z, radius });
    // ⚠ `scale: 1` BY STATEMENT. Everything this function stands REPORTS something — a
    // capability's state, one of a story's UAT criteria — and stands at its role's full size; the only
    // placements not at 1 are the ground cover's (`cover-dressing.ts`), which report nothing and
    // are placed after this.
    out.push({ role, assembly, capId, tint, at, y: heightAt(at.x, at.z), yaw, scale: 1 });
  };

  facts.forEach((fact, fi) => {
    // ⚠ AN EMPTY CELL SET NEEDS NO GUARD HERE — `place` samples no candidate from one and returns
    // without pushing anything. A second early-out would change no output, which is exactly the
    // dead clause `check:mutation-diff` cannot kill and therefore cannot pass.
    const parcelCells = byParcel.get(fact.capId) ?? [];
    const form = stateForm(fact.status);
    // `unknown` — and any state this vocabulary has never heard of — grows nothing.
    if (!form) return;
    const choices = KIT_ROLE_ASSEMBLIES[form.role];
    place(
      form.role,
      choices[fi % choices.length]!,
      fact.capId,
      form.tint,
      parcelCells,
      seed0 + fi * 97,
      (fi * 2.399963) % (Math.PI * 2),
    );
  });

  // The criterion markers belong to the STORY's UAT criteria, not to any one capability, so they
  // are scattered over the whole island — the same claim the procedural flower markers make
  // (ADR-0226 D4, one flower per criterion), wearing the kit's vocabulary instead.
  //
  // ⚠⚠ ALL THREE STATES ARE PLACED, AND THE ISLAND'S FLOWER COUNT IS ITS CRITERION COUNT
  // (ADR-0600 D1). Until 2026-09-23 only the signed ones were, so an island with five unsigned
  // criteria stood no flower and read as a story with no acceptance criteria at all.
  //
  // ⚠ THE THREE RUNS SHARE ONE SEED STREAM rather than restarting it per state, so the island's
  // criteria are ONE scatter of N markers and not three overlaid scatters of the same shape.
  // Restarting per state would hand the k-th bloom and the k-th bud the same candidate points;
  // `bestCandidate` would still separate them, because the first is already `occupied` by the time
  // the second is placed, but the second would be choosing from a set it has already lost most of
  // — so the more evenly an island's criteria were split across states, the more of its markers
  // would be placed from picked-over ground. Nothing about that is visible in a count, which is
  // why it is stated here rather than left to the test.
  //
  // ⚠ ONE FLAT LIST OF ROLES, THEN `forEach`, exactly as the capabilities above are placed. Two
  // shapes are avoided here on purpose: a `for (let i = 0; i < n; i += 1)` carries mutants that
  // flip `+=` to `-=` and `<` to `>` — neither fails an assertion, both run forever, and
  // `check:mutation-diff` scores a hang as UNPROVEN rather than as a survivor — and an
  // `Array.from({length}, (_, k) => k)` whose value nobody reads carries a mapper mutant no test
  // can kill, because the mapped value is discarded either way (measured, on this landing).
  const all = cells.filter((c) => c.parcel !== undefined);
  const criteria: KitRole[] = [
    ...Array.from<unknown, KitRole>({ length: Math.max(0, opts.blooms) }, () => 'bloom'),
    ...Array.from<unknown, KitRole>({ length: Math.max(0, opts.buds) }, () => 'bud'),
    ...Array.from<unknown, KitRole>({ length: Math.max(0, opts.wilts) }, () => 'wilt'),
  ];
  criteria.forEach((role, i) => {
    place(role, 'flower', 'story', null, all, seed0 + 7717 + i * 131, (i * 2.399963) % (Math.PI * 2));
  });

  return out;
}

// ------------------------------------------------------------------ the placement's own verdict

/** Two props standing closer than their own footprints allow. */
export interface PropOverlap {
  a: string;
  b: string;
  /** Distance minus the sum of the two radii — negative, and by how much. */
  gap: number;
}

/**
 * EVERY PAIR OF PROPS THAT OVERLAP, worst first — the detector, not a hope.
 *
 * ⚠ IT IS SEPARATE FROM THE PLACEMENT ON PURPOSE. `dressIslandFromKit` chooses the best point it
 * can find; whether that was good enough is a different question, and a placement that graded
 * its own output would be the shape `an-expectation-derived-from-its-subject-cannot-fail`
 * warns about. This reads the finished placements and the kit's own footprints, and
 * `kit-vocabulary.test.ts` runs it over a deliberately naive placement too, so a detector that
 * could never fire would be caught.
 *
 * ⚠ IT MEASURES AGAINST {@link pairClearance}, WHICH IS THE PLACEMENT'S OWN RULE. Every pair of
 * objects that report something keeps the full sum, and ground cover keeps none
 * ({@link clearanceFactor}), so the cover's exemption is something this detector APPLIES and names
 * rather than a case it is blind to — a bush at a pine's foot is not a defect, and two capability
 * pines inside each other's footprint still are.
 */
export function dressingOverlaps(
  placements: readonly KitPlacement[],
  footprint: RoleFootprints,
): PropOverlap[] {
  const out: PropOverlap[] = [];
  // ⚠ PAIRS OFF THE ARRAY, NOT TWO COUNTERS. An index loop running one past the end leaves the
  // inner loop empty, so nothing ever reads the element that is not there — no assertion can see
  // it, and `check:mutation-diff` scores that as unproven rather than as harmless.
  for (const [i, a] of placements.entries()) {
    for (const b of placements.slice(i + 1)) {
      const need = pairClearance(a, b, footprint);
      const gap = Math.hypot(a.at.x - b.at.x, a.at.z - b.at.z) - need;
      if (gap < 0) {
        out.push({ a: `${a.role}:${a.capId}`, b: `${b.role}:${b.capId}`, gap });
      }
    }
  }
  return out.sort((x, y) => x.gap - y.gap);
}

/**
 * How many props of each (role, tint) a dressing put on the island — the census a report prints.
 *
 * A named contract rather than an open dictionary because the KEY is a composite the vocabulary
 * builds (`tree`, `tree:mapped`), so the shape has an owner and saying so is what stops it being
 * read as an arbitrary bag (`anti-slop(no-known-value-widening)`).
 */
export interface DressingCensus {
  [roleAndTint: string]: number;
}

export function dressingCensus(placements: readonly KitPlacement[]): DressingCensus {
  const out: DressingCensus = {};
  for (const p of placements) {
    // ⚠ `tree` COUNTS CAPABILITIES, and since ADR-0518 that needs no qualifier: nothing else on the
    // map wears the role. (The grove's members used to be counted under their own key so a
    // forested island did not read as an island of sixty capabilities; that key went with them.)
    const key = p.tint ? `${p.role}:${p.tint}` : p.role;
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** Every state whose FORM asks for a leaf tint — the list a report prints, and the left-hand side
 *  of the two-place check `kit-vocabulary.test.ts` runs against `LEAF_TINT_TOKEN`. */
export function tintedStates(): string[] {
  // ⚠ WHAT THE VOCABULARY ASKS FOR, not what `LEAF_TINT_TOKEN` happens to declare. The two-place
  // agreement between them is a CHECK and lives in `kit-vocabulary.test.ts`; asserting it here as
  // a second filter made the first one redundant, and a redundant clause is a mutant nothing can
  // kill — the shape that reads as a check while proving nothing.
  return VOCABULARY_STATES.filter((s) => {
    const form = stateForm(s);
    return form !== null && form.tint !== null;
  });
}
