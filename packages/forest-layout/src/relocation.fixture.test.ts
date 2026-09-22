// ⚠ THE `.test.ts` SUFFIX IS DELIBERATE AND THIS FILE DECLARES NO TESTS. It is test-support — a
// frozen corpus, the arms, and the comparison surface — and `check:mutation-diff` mutates any `.ts`
// that is not a test file, so a data fixture is otherwise mutated word by word (measured elsewhere
// in this repo: 1,303 of one run's 1,484 mutants were one `StringLiteral` per captured word). The
// rung's own `isMutableSource` docstring names this as today's answer — "put a fixture inside its
// own `.test.ts`, which this function does exclude" — pending the open friction
// `mutation-diff-mutates-frozen-data-fixtures`. The assertions that exercise everything here live
// next door in `relocation.test.ts`, including an adversarial suite over `firstDifference`, which is
// the oracle the whole comparison rests on and so is the one piece that must not go unwitnessed.
//
// THE RELOCATION FIXTURE — the deterministic corpus, the five arms and the comparison surface that
// prove the island packing lays out the SAME map here as it did inside the studio
// (`the-packing-moves-to-its-own-package`, ADR-0537 D1).
//
// ⚠ THIS FILE AND ITS GOLDEN ARE THE INSTRUMENT, NOT THE SUBJECT. `relocation.golden.json` was
// captured from the packer as it stood in `apps/studio/src/components/TreeView.tsx`, and committed
// in its own commit BEFORE a single line moved — so "the move changed nothing" is checkable from
// the history (`git log --follow -p` on the golden shows one commit, the capture, and the
// relocation commit that only renamed it) rather than resting on a test that could have been
// regenerated alongside the change it was meant to police.
//
// ⚠ THE CHROME INPUTS ARE STATED HERE AS LITERALS, ON PURPOSE. The golden was captured through the
// studio's `buildWorld`, which computes two things this package deliberately cannot: which stories
// are `render: building` and therefore not laid out at all, and which island carries which icon
// (the ADR-0102 promotion). Restating them as data is what lets the packer be proved WITHOUT the
// chrome — and the studio's own `buildWorld.relocation.test.ts` proves the other half, that its
// chrome computes exactly these values. Neither half is the whole proof; together they are.

import type { LayoutStory, PackOptions } from './pack.js';
import { PRE_ADR0521_SPACING } from './spacing.js';

interface FixtureCapability {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

/** A fixture story. It is a {@link LayoutStory} plus the two STUDIO facts the golden's chrome arm
 *  was computed from — kept here so the exclusion and the promotion are readable at the fixture
 *  rather than encoded twice, and so the studio's half of the proof can build the same corpus. */
export interface FixtureStory extends LayoutStory {
  readonly capabilities: readonly FixtureCapability[];
  /** `render: building` — the studio render class. The packer never sees this field. */
  readonly building: boolean;
  /** Provider-side inbound edges; read by the ADR-0102 promotion, never by the packer. */
  readonly consumedBy: readonly string[];
}

const story = (
  id: string,
  capIds: readonly (readonly [string, readonly string[]])[],
  dependsOn: readonly string[],
  extra: { building?: boolean; consumedBy?: readonly string[] } = {},
): FixtureStory => ({
  id,
  dependsOn,
  consumedBy: extra.consumedBy ?? [],
  // Always stated, never omitted: a declared `false` and an absent key are the same input to the
  // promotion, and stating it keeps the fixture readable about which stories are buildings.
  building: extra.building ?? false,
  capabilities: capIds.map(([cid, deps]) => ({ id: cid, dependsOn: deps })),
});

/**
 * Fourteen stories over four dependency ranks, chosen to exercise every branch the packer has:
 * a wide foundation row (load-bearing ordering + centre-out interleave), a LONE island on rank 2
 * (`loneSwing`, and the alternating side that depends on rank parity), quotas from 1 to 9
 * capabilities (so `gapBetween` sees pairs of unequal radii and the growth floor has both tight and
 * roomy neighbours), two `render: building` stories — the exclusion AND the ADR-0102 promotion,
 * with `mid-c` carrying BOTH so the two-sided stamp fan and its per-tier radius step run — and a
 * derived cross-story capability edge that no `depends_on` declares (`deep-b1` → `mid-a2`), so
 * `storyEdges`' union is exercised rather than just its declared half.
 */
export function relocationCorpus(): FixtureStory[] {
  return [
    story('root-a', [['root-a1', []], ['root-a2', []], ['root-a3', []]], []),
    story('root-b', [['root-b1', []]], []),
    story('root-c', [['root-c1', []], ['root-c2', []]], []),
    story('root-d', [
      ['root-d1', []], ['root-d2', []], ['root-d3', []], ['root-d4', []],
      ['root-d5', []], ['root-d6', []], ['root-d7', []], ['root-d8', []], ['root-d9', []],
    ], []),
    story('lib', [['lib-1', []], ['lib-2', []], ['lib-3', []]], [], {
      building: true,
      consumedBy: ['mid-a', 'mid-b'],
    }),
    story('toolbelt', [['toolbelt-1', []], ['toolbelt-2', []]], ['root-a'], { building: true }),
    story('mid-a', [['mid-a1', []], ['mid-a2', []]], ['root-a', 'root-b', 'lib']),
    story('mid-b', [['mid-b1', []], ['mid-b2', []], ['mid-b3', []], ['mid-b4', []]], ['root-c', 'lib']),
    story('mid-c', [['mid-c1', []]], ['root-d', 'toolbelt', 'lib']),
    story('mid-d', [['mid-d1', []], ['mid-d2', []], ['mid-d3', []]], ['root-d']),
    story('solo', [['solo-1', []], ['solo-2', []], ['solo-3', []], ['solo-4', []], ['solo-5', []]], [
      'mid-a', 'mid-b', 'mid-c',
    ]),
    story('deep-a', [['deep-a1', []], ['deep-a2', []]], ['solo']),
    story('deep-b', [['deep-b1', ['mid-a2']], ['deep-b2', []]], ['solo']),
    story('deep-c', [['deep-c1', []], ['deep-c2', []], ['deep-c3', []], ['deep-c4', []]], ['solo', 'deep-a']),
  ];
}

/** The two `render: building` ids the studio excludes from the map when `buildings` is on. */
export const EXCLUDED_BUILDING_IDS: readonly string[] = ['lib', 'toolbelt'];

/** The ADR-0102 promotion over this corpus — "you carry the icon of what you depend on", computed
 *  by the studio from the FULL list before the buildings are excluded. Restated as data so the
 *  packer can be proved without it. */
export const CARRIED_ICONS: ReadonlyMap<string, readonly string[]> = new Map([
  ['mid-a', ['lib']],
  ['mid-b', ['lib']],
  ['mid-c', ['lib', 'toolbelt']],
]);

/** The corpus as the studio hands it over with `buildings: true` — the buildings dropped, order
 *  preserved, which is itself load-bearing: the packer's row ordering breaks ties on input order. */
export function laidOutCorpus(): FixtureStory[] {
  return relocationCorpus().filter((s) => !EXCLUDED_BUILDING_IDS.includes(s.id));
}

/** One arm of the comparison: the stories actually laid out, and the options they go in with. */
export interface RelocationArm {
  readonly stories: FixtureStory[];
  readonly opts: PackOptions;
}

/** The land camera the relocation golden was CAPTURED at (ADR-0367 D1's original value).
 *  Pinned as a literal, deliberately NOT `LAND_CAMERA_ELEVATION_DEG`: the golden is a fixed
 *  record of the map before the packing moved, and the relocation claim — that `packWorld`
 *  reproduces the old `buildWorld` exactly — is camera-independent. ADR-0593 D1 later moved the
 *  live constant to 50; re-capturing the golden at 50 would compare today's code with itself
 *  and prove nothing. */
const GOLDEN_CAPTURE_ELEVATION_DEG = 20;

/**
 * The five arms, so no branch of the packer is unwitnessed: the SHIPPED map; the `plantsScatter`
 * garden branch; the BARE call the studio's Shared Islands panel makes (no exclusion, no stamps);
 * the `legacy` control arm a comparison page stands (the three retired absolute gaps); and the
 * TIGHTEST rung, ratio 0, where the hex growth floor and the one-hex moat are the only thing
 * holding two islands apart.
 *
 * ⚠ EVERY ARM PINS `elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG` (ADR-0593 D1). The golden was
 * captured while the shared camera was 20°; without the pin, every arm would silently pick up
 * whatever `LAND_CAMERA_ELEVATION_DEG` is TODAY, and the relocation proof would stop comparing
 * "did the move change the map" and start comparing "did the map change since capture" — which it
 * did, on purpose, for a reason this fixture has nothing to do with.
 */
export function relocationArms() {
  return {
    shipped: {
      stories: laidOutCorpus(),
      opts: { carriedIcons: CARRIED_ICONS, elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG },
    },
    scatter: {
      stories: laidOutCorpus(),
      opts: { plantsScatter: true, carriedIcons: CARRIED_ICONS, elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG },
    },
    bare: { stories: relocationCorpus(), opts: { elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG } },
    legacy: {
      stories: laidOutCorpus(),
      opts: {
        carriedIcons: CARRIED_ICONS,
        spacing: { legacy: PRE_ADR0521_SPACING },
        elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG,
      },
    },
    tightest: {
      stories: laidOutCorpus(),
      opts: {
        carriedIcons: CARRIED_ICONS,
        spacing: { ratio: 0 },
        elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG,
      },
    },
  } satisfies Record<string, RelocationArm>;
}

/** The layout-derived shape of one world, with the caller's echoed inputs reduced to ids. */
export interface WorldProjection {
  width: number;
  height: number;
  offset: { x: number; y: number };
  empties: unknown[];
  drawTiles: unknown[];
  trails: unknown;
  territories: unknown[];
}

/** The world a packer laid out, in the shape {@link projectWorld} compares — structural, so both
 *  the packer's own `HexWorld` and the studio's specialisation of it satisfy it. */
export interface ProjectableWorld {
  readonly width: number;
  readonly height: number;
  readonly offset: { x: number; y: number };
  readonly empties: readonly { q: number; r: number; owner?: number | undefined }[];
  readonly drawTiles: readonly { h: { q: number; r: number }; owner: number }[];
  readonly trails: unknown;
  readonly territories: readonly {
    readonly story: { readonly id: string };
    readonly tiles: readonly { q: number; r: number }[];
    readonly centroid: { x: number; y: number };
    readonly radius: number;
    readonly groundRadius: number;
    readonly treeSpot: { x: number; y: number };
    readonly groundCentroid: { x: number; y: number };
    readonly groundTreeSpot: { x: number; y: number };
    readonly caps: readonly {
      readonly cap: { readonly id: string };
      readonly x: number;
      readonly y: number;
      readonly groundSpot: { x: number; y: number };
    }[];
    readonly decor: readonly unknown[];
    readonly wheatTiles: ReadonlySet<string>;
    readonly coastGroundLoops: readonly (readonly { x: number; y: number }[])[];
    readonly labelY: number;
    readonly stamps: readonly { icon: string; spot: { x: number; y: number } }[];
    readonly buildingGlyph: boolean;
  }[];
}

/**
 * Everything the packer DERIVED, in a stable order — the comparison surface of the relocation.
 *
 * It keeps EVERY layout-derived number and drops only the caller's own inputs echoed back
 * (`Territory.story`, `CapSpot.cap`, reduced to their ids). Dropping a derived field here would be
 * a green check that verified nothing, so the reduction is deliberately shallow and names each
 * field it keeps — a new derived field on `Territory` is one this projection does not see until
 * someone adds it, which `relocation.test.ts` fences.
 */
export function projectWorld(world: ProjectableWorld): WorldProjection {
  return {
    width: world.width,
    height: world.height,
    offset: world.offset,
    empties: world.empties.map((e) => ({ q: e.q, r: e.r, owner: e.owner })),
    drawTiles: world.drawTiles.map((t) => ({ q: t.h.q, r: t.h.r, owner: t.owner })),
    trails: world.trails,
    territories: world.territories.map((t) => ({
      story: t.story.id,
      tiles: t.tiles.map((h) => ({ q: h.q, r: h.r })),
      centroid: t.centroid,
      radius: t.radius,
      groundRadius: t.groundRadius,
      treeSpot: t.treeSpot,
      groundCentroid: t.groundCentroid,
      groundTreeSpot: t.groundTreeSpot,
      caps: t.caps.map((c) => ({ cap: c.cap.id, x: c.x, y: c.y, groundSpot: c.groundSpot })),
      decor: t.decor,
      wheatTiles: [...t.wheatTiles].sort(),
      coastGroundLoops: t.coastGroundLoops,
      labelY: t.labelY,
      stamps: t.stamps,
      buildingGlyph: t.buildingGlyph,
    })),
  };
}

/**
 * How far apart two doubles may be and still count as the same number: the count of representable
 * doubles between them (ULPs). `0` means bit-identical.
 *
 * ⚠ IT IS NOT ZERO EVERYWHERE, AND THE REASON IS THE RUNTIME, NOT THE RELOCATION — measured, not
 * assumed. The golden was captured under V8, and this package's own suite runs under Bun's
 * JavaScriptCore, whose `Math.hypot` and `Math.sin` disagree with V8's in the last place. Over the
 * five arms: under V8 the packer reproduces the golden BIT FOR BIT — 0 of 14,057 numbers differ —
 * while under JSC 53 differ (0.38%), by at most 16 ULP, all of them on continuous coordinates
 * (`x`, `y`, `radius`, `groundRadius`) and none on a tile, an owner or an ordering. So the exact
 * claim is made where it can honestly be made, by `apps/studio/src/components/
 * buildWorld.relocation.test.ts` running under V8 at budget 0; here the budget is a headroomed 64,
 * which is ~1.4e-14 relative — four hundred times below the 1e-4 perturbation the fault-seeding
 * showed this instrument catching.
 */
export type UlpBudget = number;

const ULP_VIEW = new DataView(new ArrayBuffer(8));

/** The two doubles' distance in representable steps — the honest "same number" test across two
 *  engines' libm, where a relative epsilon is either too loose near zero or too tight far from it. */
export function ulpsApart(a: number, b: number): number {
  if (Object.is(a, b)) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  const ordered = (x: number): bigint => {
    ULP_VIEW.setFloat64(0, x);
    const raw = ULP_VIEW.getBigUint64(0);
    return raw & (1n << 63n) ? (1n << 64n) - raw : raw | (1n << 63n);
  };
  const d = ordered(a) - ordered(b);
  return Number(d < 0n ? -d : d);
}

/**
 * The first path at which two JSON-serialisable values differ, or `undefined` when they agree — so
 * a broken relocation names the field and the island it broke on instead of dumping two
 * 70,000-line objects at the reader. Depth-first; arrays compared by length then by index.
 *
 * Numbers agree when they are within `ulpBudget` (default 0 = bit-identical). NOTHING ELSE is
 * given any slack: a key set, an array length, an id, an integer tile coordinate and an ordering
 * all compare exactly, because a relocation that moved an island would show there first.
 */
export function firstDifference(
  a: unknown,
  b: unknown,
  path = '',
  ulpBudget: UlpBudget = 0,
): string | undefined {
  if (Object.is(a, b)) return undefined;
  if (typeof a === 'number' && typeof b === 'number') {
    const u = ulpsApart(a, b);
    return u <= ulpBudget ? undefined : `${path}: ${a} vs ${b} (${u} ulp)`;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return `${path}: array vs non-array`;
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`, ulpBudget);
      if (d) return d;
    }
    return undefined;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    if (ka.join(',') !== kb.join(',')) return `${path}: keys ${ka.join(',')} vs ${kb.join(',')}`;
    for (const k of ka) {
      const d = firstDifference(
        (a as Record<string, unknown>)[k],
        (b as Record<string, unknown>)[k],
        `${path}.${k}`,
        ulpBudget,
      );
      if (d) return d;
    }
    return undefined;
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}
