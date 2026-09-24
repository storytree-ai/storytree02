// ground-casters.ts — WHAT STANDS ON THE SHIPPED MAP, AND HOW MUCH SKY IT HIDES. Pure,
// browser-free, node:test-provable: it maps the descriptor families `ForestWorldCanvas` draws
// onto the cylinder abstraction the occlusion field is built from.
//
// ⚠⚠ THE FINDING THIS MODULE WAS BUILT TO CARRY IS NOW HISTORY, AND IT IS KEPT BECAUSE THE ARC'S
// EVIDENCE PAGES QUOTE IT. Measured 2026-08-30: the semantic scene for one island emits 1,089
// objects that stand on the ground — 693 grass blades, 144 flora, 112 shrubs, 3 stems, 136
// tall-flower parts and ONE story tree — and the shipped mapper had a case for the tree and
// skipped the other 1,088, explicitly, as `{ kind: 'skipped' }` audit records. So the shipped map
// drew ONE object on 8,425 square units of land, and every shadow it could cast was that one
// tree's. `contact-shade.ts`'s ranking inverted here for that reason: contact darkening was ranked
// FIRST of ten mechanisms on the EXPERIMENT island, which stands 155 props, where 155 tight pools
// ARE most of what "placed rather than pasted" means, and one pool is not.
//
// ⚠⚠ THEN THE PROPS GREW (2026-09-03) AND THE TREE WENT (2026-09-04), in that order, and the
// present is the second half. The bought kit crossed on 2026-08-30 standing one object per
// capability plus one bloom per signature, and until 2026-09-03 every one of them cast NOTHING —
// `groundCasters` knew only the story tree and the cave portals, so the pools the field already
// carried were drawn under the placeholder tree alone while eleven pines and ten flowers floated.
// Every placement now contributes a caster ({@link placementCaster}) from the SAME placement list
// `KitProps` draws, computed once in the canvas before the ground is built, so the shadow and the
// object it belongs to cannot be two lists that agree today. The placeholder tree was then retired
// outright (ADR-0508) — each island stood a grove, until ADR-0518 — and its caster went with it in the same
// landing, because a shadow with nothing casting it is the misreport this module exists to
// prevent. The dark pool at every island's CENTRE in every frame on this arc up to that date was
// the placeholder's; there is no longer anything at an island's centre that casts one. (The
// grove that took the tree's place was itself retired on 2026-09-05, ADR-0518 — what casts on an
// island now is exactly its capability trees and its blooms.)
//
// ⚠ WHAT STILL CASTS FROM THE DESCRIPTOR STREAM IS THE CAVE PORTAL, AND {@link groundCasters}
// KEEPING ONE CASE IS NOT A FUNCTION WAITING TO BE INLINED. It is the one place that answers
// "which descriptor families meet the ground", and the two families it answers NO for — wisps and
// trails — are decisions with reasons, held below and by this module's own tests.

import type { Descriptor3D, InstanceDescriptor } from './world-to-3d.js';
import type { GroundBounds, ShadowCaster, SilhouetteProfile } from './land-shadow.js';
import {
  isDressingRole,
  propRadius,
  type KitPlacement,
  type KitRole,
  type RoleFootprints,
  type RoleHeights,
} from './kit-vocabulary.js';

/**
 * THE SILHOUETTE EACH ROLE CASTS — `[heightFraction, radiusFraction]` profiles of revolution
 * (`land-shadow.ts`'s `SilhouetteProfile`), one per role, so a placement's shadow is the
 * projection of the object's own form rather than of a cylinder its size.
 *
 * ⚠⚠ WHY THIS EXISTS (2026-09-06, `the-trees-cast-the-shadows-the-reference-casts`). Until then
 * every caster was an upright cylinder, so a pine cast the swept disc of its crown's full width
 * from foot to tip — a uniform capsule about as wide as the crown and 0.7× its height long — and
 * a bloom, whose footprint is its leaf rosette, cast a pool wider than its stem. The render the
 * owner stamped (`docs/research/chapter2-land-idiom-2026-08-27/land-combined-1948px.png`) casts
 * the pine's CONE, widest low and tapering to a point away from the trunk; a bush casts a low
 * dome; a flower casts a thread with a head. These are those forms.
 *
 * ⚠ THE NUMBERS ARE EYE-READ OFF THE KIT'S OWN OBJECTS, NOT MEASURED BY A RULE, and the reason a
 * rule was not written is that the profile is judged in the picture: the half-width of a pine's
 * foliage is a cloud of leaf cards, not a curve, and any fit to it is a choice. What holds them is
 * the shape ladder on `shipped-cast-shadow-scene.ts` (`docs/research/chapter2-cast-shadows-
 * 2026-09-06/`) and the owner's look; a re-exported kit whose form moved re-opens the ladder, not
 * a drift check.
 *
 *   tree         a bare trunk (8% of the crown's width) to 12% of the height, then the crown:
 *                widest at a quarter height, tapering to a point at the tip
 *   deadTree     the same trunk, a sparser crown
 *   bloom        the leaf rosette at the foot (the footprint IS the leaves, 4 units), a thread
 *                of a stem, a small head — the over-wide pool goes with the cylinder
 *   bud / wilt   the bloom's own profile — they are the same object (ADR-0600), and the wilt's
 *                LEAN is not in this table: a silhouette is read upright, and the size of that
 *                approximation is computed in `KIT_ROLE_TILT`
 *   bush / tuft / flowerPatch   a low dome: full width at the foot, rounding to the top
 */
const roleSilhouetteTable = {
  tree: [
    [0, 0.08],
    [0.12, 0.08],
    [0.12, 0.85],
    [0.25, 1],
    [1, 0.04],
  ],
  deadTree: [
    [0, 0.08],
    [0.15, 0.08],
    [0.15, 0.7],
    [0.35, 1],
    [1, 0.04],
  ],
  // ⚠ THE THREE CRITERION ROLES SHARE ONE FORM BECAUSE THEY SHARE ONE OBJECT (ADR-0600) — a
  // function call each rather than one array referenced three times, for the reason `DOME_PROFILE`
  // is one below: three roles aliasing one literal is three roles a caller could mutate through
  // any of them.
  bloom: FLOWER_PROFILE(),
  bud: FLOWER_PROFILE(),
  wilt: FLOWER_PROFILE(),
  bush: DOME_PROFILE(),
  tuft: DOME_PROFILE(),
  flowerPatch: DOME_PROFILE(),
  coverageFlora: DOME_PROFILE(),
} as const satisfies RoleSilhouettes;

Object.defineProperty(roleSilhouetteTable, 'coverageFlora', {
  value: roleSilhouetteTable.coverageFlora,
  enumerable: false,
  writable: false,
  configurable: false,
});

export const ROLE_SILHOUETTE = roleSilhouetteTable;

/** The flower's silhouette — the leaf rosette at the foot, a thread of a stem, a small head. The
 *  three criterion roles are one object at three sizes (ADR-0600), so they cast one form. */
export function FLOWER_PROFILE(): SilhouetteProfile {
  return [
    [0, 1],
    [0.12, 1],
    [0.12, 0.06],
    [0.78, 0.06],
    [0.78, 0.28],
    [1, 0.15],
  ];
}

/** A low dome — the quarter-circle `sqrt(1 − t²)`, sampled at five heights. A function rather
 *  than a shared literal so the three cover roles cannot alias one array a caller could mutate. */
export function DOME_PROFILE(): SilhouetteProfile {
  return [0, 0.25, 0.5, 0.75, 1].map((t) => [t, Math.sqrt(1 - t * t)] as const);
}

/**
 * HOW WIDE A TREE'S CAST SHADOW IS, as a fraction of the silhouette {@link ROLE_SILHOUETTE} reads
 * off the crown's footprint — the multiplier every radius in the `tree` and `deadTree` profiles is
 * scaled by before it is stamped. One is the shadow as it shipped after PR #1841: the cone as
 * wide as the crown's footprint at a quarter of its height.
 *
 * ⚠⚠ THE REASON (2026-09-06, the owner on the shipped map): *"a triangle for what the tree casts
 * … too large depending on the land color."* The footprint the silhouette was read off is the
 * crown's FULL extent — the outermost leaf cards — and a cone that wide casts a triangle 10 units
 * across at its base on an island 88 units wide. The mass that actually blocks the sun is the
 * crown's dense core, narrower than its outermost cards; the ladder {@link TREE_SHADOW_WIDTH_RUNGS}
 * narrows the cast silhouette toward that core, rendered on the RTX 2060 on a green island, an
 * in-progress wheat island and the sand band (`docs/research/chapter2-shadow-scale-back-2026-09-06/`).
 * The pick is this constant; a scale-back is one edit to a rung already on the sheet. The
 * caster's `radius` — what sizes its contact pool — is untouched: the two marks the owner named
 * are two levers.
 */
export const TREE_SHADOW_WIDTH = 0.65;

/** The width ladder the owner was shown, descending: 1 is the shadow as it shipped after PR #1841. */
export const TREE_SHADOW_WIDTH_RUNGS: readonly number[] = [1, 0.8, 0.65, 0.5];

/** A profile with every radius scaled by `width` — the same form, narrower. */
export function narrowedSilhouette(profile: SilhouetteProfile, width: number): SilhouetteProfile {
  return profile.map(([h, r]) => [h, r * width] as const);
}

export type RoleSilhouettes = Readonly<Record<KitRole, SilhouetteProfile>>;

/** THE SILHOUETTES THE CASTERS WEAR: {@link ROLE_SILHOUETTE} with the two tree roles narrowed to
 *  `treeWidth` ({@link TREE_SHADOW_WIDTH} unless the ladder that rendered the rungs passes one).
 *  The bloom and the cover keep their read forms: the owner named the tree's triangle. */
export function roleSilhouettes(treeWidth: number = TREE_SHADOW_WIDTH) {
  const silhouettes = {
    ...ROLE_SILHOUETTE,
    tree: narrowedSilhouette(ROLE_SILHOUETTE.tree, treeWidth),
    deadTree: narrowedSilhouette(ROLE_SILHOUETTE.deadTree, treeWidth),
    coverageFlora: ROLE_SILHOUETTE.coverageFlora,
  } satisfies RoleSilhouettes;
  Object.defineProperty(silhouettes, 'coverageFlora', {
    value: ROLE_SILHOUETTE.coverageFlora,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return silhouettes;
}

/**
 * DOES THE GROUND COVER CAST? YES, since 2026-09-06 — a decision reversed, with both halves of the
 * reason it was refused re-measured.
 *
 * The refusal (`cover-dressing.ts`'s header, 2026-09-04) rested on two things: (a) COST — the cover
 * outnumbered every other caster many times over on a 234-unit island carrying a grove; (b) THE
 * LADDER — with ONE occlusion rung the material thresholds the field, so a prop a ground unit wide
 * arrived as a hard dot at full rung strength. Both moved. ADR-0518 retired the grove and ADR-0520
 * shrank the island, so the cover is ~100 low domes per island rather than ~650 beside sixty pines,
 * and the whole map's stamp is measured on the RTX 2060 in
 * `docs/research/chapter2-cast-shadows-2026-09-06/report.txt` (the mount-time figure is there, not
 * here — a number typed here would be inherited by the next reader). And the material now renders
 * the field through a soft rung as well as a full one (`SHADOW_EDGE`), so a bush's dome arrives
 * as the small soft-edged pool the approved render puts under every bush.
 *
 * ⚠ A BOOLEAN RATHER THAN A DELETED BRANCH so the refusal stays one edit away and every comparison
 * page can render the control it needs (`placementCasters(…, false)`).
 */
export const COVER_CASTS = true;

/**
 * DOES THE GROUND COVER POOL — darken the ground it meets, beyond the shadow it casts? NO, and
 * that is a picture decision made on the RTX 2060 the same day the cover began casting. With the
 * pool on, every bush sat in a dim halo three quarters of a unit wide at the soft rung
 * (`contactReach` on a 2.4-unit-radius, 2.7-unit-high dome is 3.1 — the sky-occlusion model
 * doubles its product so a tall prop's foot reads fully dark, and a knee-high dome inherits that
 * doubling). The approved render's bushes cast a tight shadow on the down-light side and nothing
 * else. So a cover placement's caster carries `pool: false`: its dome still casts, its foot disc
 * is still under it, and the halo goes. Trees and blooms keep their pools — a pine's foot IS dark
 * in the reference, on every side.
 */
export const COVER_POOLS = false;

/** The cave portal's mouth half-width — `CaveArch`'s own `hw`, which is the 2D prop's rule. */
export function caveMouthHalfWidth(cave: InstanceDescriptor): number {
  return ((cave.width ?? 4) * 1.6) / 2;
}

/**
 * The cave portal, as an occluder.
 *
 * ⚠ IT IS A FLAT VERTICAL DISC, so a cylinder over-states it across its own face — by at most the
 * mouth's half-width, which is 3.2 units at the authored default. It is included anyway because
 * it is an OBJECT THAT MEETS THE GROUND, which is exactly what the reference board says every
 * darkened contact in those images is; and because a portal that cast nothing while a tree cast
 * something would read as the portal floating.
 */
export function caveArchCaster(cave: InstanceDescriptor): ShadowCaster {
  const hw = caveMouthHalfWidth(cave);
  return { x: cave.transform.x, z: cave.transform.z, radius: hw, height: hw };
}

/**
 * Every caster in a descriptor set.
 *
 * ⚠ THE `story-tree` CASE IS GONE BECAUSE THE FAMILY IS (ADR-0508), not because the tree stopped
 * casting. `world-to-3d.ts` no longer emits a `story-tree` descriptor at all — a `tree` group
 * skips — so a branch for it here would be unreachable code standing in for an object that is not
 * on the map, and a test exercising it would be green over nothing.
 *
 * ⚠ WISPS ARE DELIBERATELY EXCLUDED, and not because they are small. A wisp is drawn 20 units
 * ABOVE the ground — it does not meet the land at all, so it has no contact to darken — and it is
 * the LIVE-WORK signal (ADR-0200 / ADR-0142): it appears when a session claims a capability and
 * vanishes when the session releases it. A shadow that came and went with a claim would be the
 * LAND appearing to change under work that never touched it, which is the one direction this
 * surface may not be wrong in.
 *
 * Trails are excluded for the plainer reason that the shipped trail is a `<Line>` floating 0.2
 * units above the ground and touches no geometry.
 */
export function groundCasters(descriptors: readonly Descriptor3D[]): ShadowCaster[] {
  const out: ShadowCaster[] = [];
  for (const d of descriptors) {
    if (d.kind === 'cave-arch') out.push(caveArchCaster(d));
  }
  return out;
}

/**
 * A KIT PLACEMENT, AS AN OCCLUDER: a cylinder of its role's half-footprint and its role's height,
 * both multiplied by the placement's own scale.
 *
 * ⚠ THE FROZEN TABLES, NOT THE LOADED KIT. The canvas builds its ground synchronously, before the
 * asset is parsed, so the radius is `KIT_FOOTPRINTS_2026_08_29`'s and the height
 * `KIT_HEIGHTS_2026_08_29`'s — the same numbers the placement was made against, held to the loaded
 * kit by `footprintDriftOf` / `heightDriftOf` where the kit is loaded. A caster read off the asset
 * would arrive after the field was already stamped.
 *
 * ⚠ THE SCALE REACHES BOTH DIMENSIONS. A placement at 0.6 of the role's height is 0.6 of its
 * width too — the kit scales uniformly — so a caster that shrank the height and kept the footprint
 * would throw a shadow wider than the crown that casts it, which is the mismatch that reads as a
 * rendering bug rather than as art.
 */
export function placementCaster(
  placement: KitPlacement,
  footprint: RoleFootprints,
  heights: RoleHeights,
  /** The silhouettes the roles cast — the shipped ones ({@link roleSilhouettes}) unless the
   *  ladder that rendered the width rungs passes a narrower table. */
  silhouettes: RoleSilhouettes = roleSilhouettes(),
): ShadowCaster {
  return {
    x: placement.at.x,
    z: placement.at.z,
    radius: propRadius(footprint, placement.role) * placement.scale,
    height: heights[placement.role] * placement.scale,
    // THE FORM, from the role — so the shadow is the object's own silhouette rather than a
    // cylinder its size ({@link ROLE_SILHOUETTE}, the trees narrowed to {@link TREE_SHADOW_WIDTH}).
    profile: silhouettes[placement.role],
    // THE POOL, from the role class — the cover casts and does not pool ({@link COVER_POOLS}).
    pool: isDressingRole(placement.role) ? COVER_POOLS : true,
  };
}

/**
 * Every placement's caster, in placement order — the list `ForestWorldCanvas` unions with
 * {@link groundCasters} and hands to the ground. One caster per placement that STANDS: a placement
 * without a caster is an object that floats, which is the defect this function was written to fix.
 *
 * ⚠⚠ GROUND COVER CASTS TOO, SINCE 2026-09-06 — {@link COVER_CASTS} carries the reversal and its
 * reasons; `coverCasts: false` is the field as it stood before, which every comparison page's
 * control arm needs and which this parameter exists to make one edit away.
 *
 * ⚠ IT IS A ROLE-CLASS TEST, NEVER A SIZE ONE. A threshold on the footprint would silently drop the
 * bloom's caster the day someone narrowed the criterion marker, and would silently start or stop
 * casting from ground cover the day someone resized it. What the flag governs is `dressing`, which
 * is a declared property of the vocabulary.
 */
export function placementCasters(
  placements: readonly KitPlacement[],
  footprint: RoleFootprints,
  heights: RoleHeights,
  coverCasts: boolean = COVER_CASTS,
  /** The silhouettes the roles cast — built ONCE here and handed to every placement, rather than
   *  once per placement: the forest stands ~2,850 casters. */
  silhouettes: RoleSilhouettes = roleSilhouettes(),
): ShadowCaster[] {
  const out: ShadowCaster[] = [];
  for (const placement of placements) {
    if (!coverCasts && isDressingRole(placement.role)) continue;
    out.push(placementCaster(placement, footprint, heights, silhouettes));
  }
  return out;
}

/**
 * The ground-space rect a parcel set covers — what the occlusion field is allocated over.
 *
 * Returns `null` for a set that bounds nothing, because a field over an empty rect is a texture
 * of zero or one texel that every fragment then samples: the caller has to decide not to build
 * one, and a silently degenerate rect is the shape that reads as "the shadow just is not
 * showing".
 */
export function groundBounds(cells: readonly InstanceDescriptor[]): GroundBounds | null {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const cell of cells) {
    for (const p of cell.points ?? []) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
  }
  // ONE test rather than two joined by `||`. A parcel ring carries x and z together, so minX and
  // minZ are finite or infinite as a pair and the second clause could never fire on its own —
  // an unkillable mutant standing in for a case that cannot arise.
  if (!Number.isFinite(minX)) return null;
  return { minX, maxX, minZ, maxZ };
}
