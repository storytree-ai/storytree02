// ground-dependency.ts — WHAT THE GROUND IS ACTUALLY BUILT FROM, so it stops being rebuilt when
// something else moved.
//
// ⚠⚠ THIS EXISTS BECAUSE THE GROUND WAS KEYED ON AN IDENTITY RATHER THAN ON CONTENT, and the
// measurement that found it is `docs/research/land-view-performance-2026-09-15/`. The studio
// rebuilds its scene whenever its clock tick or its live-activity polls change; `LandView` converts
// that scene to a descriptor stream; and every memo in `ForestWorldCanvas` — the parcels, the
// strips, the kit placements, the casters and `CellGround`'s own build — was keyed on THAT ARRAY'S
// IDENTITY. So a poll that changed nothing a viewer could see still handed the canvas a brand-new
// array, and the whole ground was rebuilt: about 2 s of main-thread time in a production build on
// the RTX 2060 desktop, most of it `shore-grid.ts`, as a frozen frame of ~1.9 s, about every thirty
// seconds at rest and eight times over during a load.
//
// ⚠ THE FIX IS NOT `useMemo(..., [scene])` AND THAT IS THE FIRST THING TO TRY AND THE FIRST THING
// THAT FAILS. The scene OBJECT is what the polls replace; its CONTENT is what the ground depends
// on. So the key here is a content digest, and the stream is re-derived only when that digest moves.
//
// ⚠⚠ THE EXCLUSION IS TWO FAMILIES, STATED AS AN EXCLUSION ON PURPOSE (it fails WIDE). The digest
// covers the WHOLE descriptor stream except {@link GROUND_BLIND_KINDS}. An include-list would have
// been the other way round and would fail SILENTLY: a family added to the stream later, and read by
// the ground, would simply not be in the key, and the ground would go stale with nothing to notice
// it. Written as an exclusion, a new family is in the digest by default, and the worst a mistake can
// do is rebuild a ground that need not have been.
//
// ⚠ AND THE SECOND EXCLUSION IS THE ONE A READER WOULD GET WRONG. `skipped` records look like the
// safe thing to keep — they are audit markers nothing draws, so including them can only cost a
// rebuild, surely? No: a wisp is FOUR scene nodes, and three of them (`wisp-hit` / `wisp-glow` /
// `wisp-dot`, under a `wisps` group) map to `skipped`. So a digest that kept the skips would move
// every time a session claimed or released a capability — the exact live signal the first exclusion
// exists to ignore, arriving through the back door. This was found by the test, not by reading.
//
// `ground-dependency.test.ts` holds BOTH exclusions to one justification — it drives the real
// dressing and caster readers over a stream with and without the live wisps, skips and all, and
// refuses any difference — and holds the digest to TOTALITY over `InstanceDescriptor` through a
// `Record<keyof …>` the compiler checks.

import { groundCasters, placementCasters } from './ground-casters.js';
import type { ShadowCaster } from './land-shadow.js';
import type { KitPlacement, RoleFootprints, RoleHeights } from './kit-vocabulary.js';
import { dressMapWithCoverAttribution } from './map-dressing.js';
import { islandGrowthLayout, type IslandGrowthLayout } from './ForestWorldCanvas.causal.js';
import type { CoverageFloraDescriptor, Descriptor3D, InstanceDescriptor, InstanceKind } from './world-to-3d.js';

/**
 * WHAT THE GROUND CANNOT SEE — the two families no reader in the ground chain consumes, and so the
 * two the content key leaves out. See the header for why this is an exclusion rather than an
 * include-list, and `ground-dependency.test.ts` for the readers being driven with and without them.
 *
 * - `wisp-sprite` is the studio's LIVE-WORK signal (ADR-0200 / ADR-0142). It appears, moves and
 *   leaves as sessions claim and release capabilities, and it is the reason the land may not be
 *   keyed on the stream's identity — a wisp is a claim about a SESSION, never about the ground.
 * `skipped` is the second exclusion and is NOT in this set: it is excluded by its own discriminant
 * in {@link groundDependencyKey}, because that test is also what makes the rest of that loop an
 * `InstanceDescriptor` to the compiler — a set lookup narrows nothing. Its reason is the header's:
 * every ground reader already filters it out by hand (`dressing-ground.ts`'s `isInstance`), and a
 * single wisp DRAGS THREE OF THEM ALONG, so a digest that kept them would move on the live signal.
 */
export const GROUND_BLIND_KINDS: ReadonlySet<InstanceKind> = new Set<InstanceKind>(['wisp-sprite']);

/** Field separator inside one descriptor's digest. */
const FIELD = '\u0001';
/** Record separator between descriptors. */
const RECORD = '\u0002';

/** A value that is absent rather than empty — distinguishable from the empty string, so
 *  `{ material: undefined }` and `{ material: '' }` never digest alike. */
const ABSENT = '\u0003';

/** One optional field's value. ⚠ ONE HELPER FOR ALL THREE VALUE TYPES rather than one each: the
 *  only decision any of them makes is absent-vs-present, so three copies would be three places for
 *  that decision to drift and three mutants to argue about instead of one. */
const val = (v: string | number | boolean | undefined): string => (v === undefined ? ABSENT : String(v));

/** A point list, length-prefixed so `[a]` and `[a, b]` cannot collide with a different split. */
function points(ps: readonly { x: number; y: number; z: number }[] | undefined): string {
  if (ps === undefined) return ABSENT;
  let out = String(ps.length);
  for (const p of ps) out += `,${p.x},${p.y},${p.z}`;
  return out;
}

/** A string list, length-prefixed for the same reason. */
function list(xs: readonly string[] | undefined): string {
  if (xs === undefined) return ABSENT;
  return `${xs.length},${xs.join(',')}`;
}

/**
 * ONE DESCRIPTOR'S CONTENT, AS A STRING — every field of {@link InstanceDescriptor}, none left out.
 *
 * ⚠ TOTALITY IS THE WHOLE POINT AND IT IS HELD BY A TEST, not by care: a field added to the
 * descriptor and forgotten here is a ground that silently stops noticing the thing that field says.
 * `ground-dependency.test.ts` mutates every own field of a fully-populated descriptor through a
 * `Record<keyof InstanceDescriptor, …>` — so adding a field fails the TYPECHECK first, and a field
 * the digest ignores fails the test second.
 */
function instanceDigest(d: InstanceDescriptor | CoverageFloraDescriptor): string {
  const common = [
    d.kind,
    String(d.transform.x),
    String(d.transform.y),
    String(d.transform.z),
    d.group,
    val(d.material),
    points(d.points),
    val(d.width),
    val(d.usage),
    val(d.hidden),
    val(d.segment),
    list(d.edges),
    val(d.bearing),
    val(d.island),
    val(d.criterion),
    val(d.parcel),
  ];
  if (isCoverageFlora(d)) common.push(d.capability, d.theme, val(d.floraScale));
  return common.join(FIELD);
}

function isCoverageFlora(
  descriptor: InstanceDescriptor | CoverageFloraDescriptor,
): descriptor is CoverageFloraDescriptor {
  return descriptor.kind === 'coverage-flora'
    && 'capability' in descriptor
    && 'theme' in descriptor
    && 'floraScale' in descriptor;
}

/** Equal as the key reads them: `String(NaN)` is one spelling, so two NaNs are one ground, and an
 *  absent number is equal only to another absent one (`Number.isNaN(undefined)` is false). */
const sameNumber = (left: number | undefined, right: number | undefined) =>
  left === right || (Number.isNaN(left) && Number.isNaN(right));

function samePoints(
  left: readonly { x: number; y: number; z: number }[] | undefined,
  right: readonly { x: number; y: number; z: number }[] | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftPoint = left[index]!;
    const rightPoint = right[index]!;
    if (!sameNumber(leftPoint.x, rightPoint.x) || !sameNumber(leftPoint.y, rightPoint.y) || !sameNumber(leftPoint.z, rightPoint.z)) return false;
  }
  return true;
}

/** ⚠ PAIRED OFF WITH `every`, NOT WALKED WITH A COUNTER: past either end a string list reads
 *  `undefined` on BOTH sides, so a counter that overran or ran backwards would compare equal forever
 *  rather than fail — an off-by-one no test can see and a reversed step that never ends. */
function sameStrings(left: readonly string[] | undefined, right: readonly string[] | undefined): boolean {
  if (left === undefined || right === undefined) return left === right;
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function sameInstanceDependency(
  left: InstanceDescriptor | CoverageFloraDescriptor,
  right: InstanceDescriptor | CoverageFloraDescriptor,
): boolean {
  if (left.kind !== right.kind) return false;
  if (sameNumber(left.transform.x, right.transform.x)
    && sameNumber(left.transform.y, right.transform.y)
    && sameNumber(left.transform.z, right.transform.z)
    && left.group === right.group
    && left.material === right.material
    && samePoints(left.points, right.points)
    && sameNumber(left.width, right.width)
    && sameNumber(left.usage, right.usage)
    && left.hidden === right.hidden
    && left.segment === right.segment
    && sameStrings(left.edges, right.edges)
    && sameNumber(left.bearing, right.bearing)
    && left.island === right.island
    && left.criterion === right.criterion
    && left.parcel === right.parcel) {
    return !isCoverageFlora(left)
      || (isCoverageFlora(right)
        && left.capability === right.capability
        && left.theme === right.theme
        && sameNumber(left.floraScale, right.floraScale));
  }
  return false;
}

type GroundVisibleDescriptor = InstanceDescriptor | CoverageFloraDescriptor;

const isGroundVisible = (descriptor: Descriptor3D): descriptor is GroundVisibleDescriptor =>
  descriptor.kind !== 'skipped' && !GROUND_BLIND_KINDS.has(descriptor.kind);

/** The descriptors the ground reads, in stream order, produced one at a time so a caller that stops
 *  early never looks at the rest. ⚠ A GENERATOR RATHER THAN TWO INDEX CURSORS: a cursor walk whose
 *  skip loop is broken spins forever, which no test can score, while a broken generator ends. */
function* groundVisible(stream: readonly Descriptor3D[]): Generator<GroundVisibleDescriptor, void, undefined> {
  for (const descriptor of stream) if (isGroundVisible(descriptor)) yield descriptor;
}

/**
 * Compare the exact dependency stream without serializing it. This is also the cache's equality
 * seam: it reads in order, so a visible mismatch stops before any trailing descriptor is touched.
 * It must agree with {@link groundDependencyKey} on every pair of streams, and the test holds it to
 * that over every case the key's own tests distinguish.
 */
export function sameGroundDependencies(left: readonly Descriptor3D[], right: readonly Descriptor3D[]): boolean {
  const rightVisible = groundVisible(right);
  for (const leftDescriptor of groundVisible(left)) {
    const next = rightVisible.next();
    if (next.done === true || !sameInstanceDependency(leftDescriptor, next.value)) return false;
  }
  return rightVisible.next().done === true;
}

/**
 * THE CONTENT KEY THE GROUND IS REBUILT ON — everything in the stream except
 * {@link GROUND_BLIND_KINDS}, in stream order, as one string.
 *
 * ⚠ ORDER IS PART OF THE KEY, deliberately. The readers downstream group by island in FIRST-SEEN
 * order (`cellsByIsland`, `dressMap`), so a stream that carries the same descriptors in a different
 * order can dress differently — an order-insensitive digest would call two genuinely different
 * grounds equal.
 */
export function groundDependencyKey(descriptors: readonly Descriptor3D[]): string {
  const parts: string[] = [];
  for (const d of descriptors) {
    // Two exclusions, one line: the skip by its own discriminant (which is also what narrows the
    // rest of this loop to an instance), the live families by the set. Both are justified in
    // {@link GROUND_BLIND_KINDS} and both are held by `ground-dependency.test.ts` — drop either
    // and a wisp arriving rebuilds the whole ground again.
    if (d.kind === 'skipped' || GROUND_BLIND_KINDS.has(d.kind)) continue;
    parts.push(instanceDigest(d));
  }
  return parts.join(RECORD);
}

/** What the ground build and the props are derived from — one object, so every consumer downstream
 *  keys on ONE identity and a partial rebuild is not expressible. */
export interface GroundInput {
  /** How many times these inputs have actually been re-derived, from zero. THE REBUILD COUNT, and
   *  the seam the cure is measured through: it moves when and only when the ground's own content
   *  moved, so a test (and a profile) can count builds without reaching inside React. */
  readonly revision: number;
  /** The relaxed-mesh parcels — the ground substrate itself. */
  readonly cells: InstanceDescriptor[];
  /** The visible trail strips, whose ends dock on the islands (layer 3's connector). */
  readonly strips: InstanceDescriptor[];
  /** The kit's placement, made once: the SAME list reaches the casters and the props. */
  readonly placements: KitPlacement[];
  /** The island that owns each placement. Cover has no capability id, so this provenance is
   * carried from the one dressing pass rather than guessed from geometry downstream. */
  readonly islandByPlacement: ReadonlyMap<KitPlacement, string>;
  /** Stable atlas-like slots and common growth anchors for the immutable ground buffers. */
  readonly growthLayout: ReadonlyMap<string, IslandGrowthLayout>;
  /** Everything that stands on the land and therefore darkens it. */
  readonly casters: ShadowCaster[];
}

/** The shipped constants the derivation is made against, passed in rather than reached for — the
 *  vocabulary tables and the relief amplitude are the canvas's own shipped decisions and stay
 *  stated there. */
export interface GroundInputOptions {
  readonly relief: number;
  readonly footprint: RoleFootprints;
  readonly height: RoleHeights;
}

const byKind = (descriptors: readonly Descriptor3D[], kind: InstanceDescriptor['kind']) =>
  descriptors.filter((d): d is InstanceDescriptor => d.kind === kind);

/** Derive the ground's inputs from a stream, unconditionally. Exported for the tests that hold the
 *  cache honest — a cached answer has to be the one this would have produced. */
export function groundInput(
  descriptors: readonly Descriptor3D[],
  opts: GroundInputOptions,
  revision: number,
): GroundInput {
  const cells = byKind(descriptors, 'cell-ground');
  const dressed = dressMapWithCoverAttribution(descriptors, { relief: opts.relief, footprint: opts.footprint });
  return {
    revision,
    cells,
    strips: byKind(descriptors, 'trail-strip'),
    placements: dressed.placements,
    islandByPlacement: dressed.islandByPlacement,
    growthLayout: islandGrowthLayout(cells),
    casters: [...groundCasters(descriptors), ...placementCasters(dressed.placements, opts.footprint, opts.height)],
  };
}

/**
 * THE CACHE THE CANVAS HOLDS — hand it a stream, get the ground's inputs, and get the SAME OBJECT
 * back whenever the ground's own content has not moved.
 *
 * ⚠ A PLAIN CLOSURE RATHER THAN A HOOK, so it is provable under `bun test` with no renderer: the
 * canvas keeps one of these in a `useRef` and calls it in its render body. Everything React needs
 * is identity, and identity is what this returns.
 *
 * ⚠ IT REMEMBERS EXACTLY ONE ANSWER. A map keyed by digest would hold every ground the session ever
 * saw — each carrying a 107 KB occlusion field's worth of downstream GPU state — to serve a
 * back-and-forth nobody has evidenced. One slot is what a poll that changes nothing needs.
 */
export function createGroundInputCache(
  opts: GroundInputOptions,
): (descriptors: readonly Descriptor3D[]) => GroundInput {
  // ⚠ ONE SLOT HOLDING BOTH, not two variables holding one each. A key and an answer that can be
  // assigned separately are a cache that can be asked whether an answer it does not have matches a
  // key it does — and the guard against that is then a line no input can exercise.
  let cached: { readonly dependencies: readonly Descriptor3D[]; readonly input: GroundInput } | null = null;
  let revision = 0;
  return (descriptors) => {
    if (cached !== null && sameGroundDependencies(descriptors, cached.dependencies)) return cached.input;
    const input = groundInput(descriptors, opts, revision);
    revision += 1;
    // A deep copy of the WHOLE stream, so a caller mutating a descriptor it already handed over
    // still reads as a change — and total by construction, with no field list to fall behind.
    cached = { dependencies: structuredClone(descriptors), input };
    return input;
  };
}
