// shipped-land-scene.test.ts — the comparison page's own controls, proved without a GPU.
//
// ⚠⚠ WHY THIS FILE EXISTS AT ALL. The five arms are ONE function called with one input changed,
// which is what makes them a controlled comparison rather than five pictures side by side. Until
// 2026-08-30 that was true of only four of them — the ceiling arm was drawn by the EXPERIMENT's
// material, so "these two differ only in the grain" was a claim, and this file closed it
// arithmetically by proving the two materials build an identical ramp. `land-grain.ts` has since
// crossed, so the ceiling arm is the SHIPPED material with one option changed and that claim is
// now a property. What is left to prove here is what the ladder ASSERTS: that the grain moves
// shading and not the palette, that the arm which ships still writes an authored ramp entry, and
// that the arm which does not is the only one exempted from the closure.

import assert from 'node:assert/strict';
import test from 'node:test';

import { createBandedGroundMaterial, groundRamp } from '../src/banded-ground-material.js';
import { LEGACY_SHADE_LEVELS, SHADE_LEVELS, deliveredForLevel } from '../src/shade-ladder.js';
import {
  flatGroundLevel,
  nearestReference,
  readMargin,
  readerReferences,
  shadowLadderFor,
} from '../src/shadow-rung.js';
import {
  GROUND_ROWS,
  GROUND_TOKENS,
  LAND_ARMS,
  LAND_ARM_SPECS,
  LAND_STEPS,
  LAND_ZOOMS,
  PALETTE_CLOSED_ARMS,
  landLadderHonest,
  litLadderOf,
  groundRowOf,
  shippedCasters,
  shippedMapCasters,
  shippedParcels,
} from './shipped-land-scene.js';
import { groundSanity } from './ground-sanity.js';
import { SHIPPED_GROUND_COLOUR } from './shipped-baseline.js';
import { buildGroundOcclusion } from '../src/contact-shade.js';
import { groundShadowTexture } from '../src/banded-ground-material.js';
import { LAND_RELIEF_AMPLITUDE } from '../src/land-relief.js';
import { groundCasters } from '../src/ground-casters.js';
import { worldTo3D } from '../src/world-to-3d.js';
import { islandScene } from './island-fixture.js';
import { occlusionGrid } from '../src/land-shadow.js';

/** A field small enough that building one is free — and checked, because under a broken
 *  resolution cap it would be four million samples and the mutation rung scores a hang as
 *  UNPROVEN rather than as a failure. */
const TINY_OCCLUSION = {
  bounds: { minX: -10, maxX: 10, minZ: -10, maxZ: 10 },
  relief: LAND_RELIEF_AMPLITUDE,
  casters: [],
};

test('the ladder is a LADDER WITH ONE FORK — every arm adds one thing to a NAMED predecessor', () => {
  groundSanity();
  assert.deepEqual(
    [...LAND_ARMS],
    [
      'flat',
      'relief',
      'banded',
      'grain-normal',
      'shadow',
      'grain-both',
      'dense',
    ],
  );
  // ⚠ EACH ARM NAMES ITS OWN PREDECESSOR, and the shadow arm is what forced that. Two arms now
  // hang off `grain-normal` — the shadow (a candidate) and the grain's colour half (a reference) —
  // so an ORDINAL chain would publish `grain-both → shadow` as a one-thing comparison of two
  // things. Every step must therefore be a spec's own (from, arm), never a neighbouring pair.
  assert.equal(LAND_STEPS.length, LAND_ARM_SPECS.filter((spec) => spec.from !== null).length);
  for (const [from, arm] of LAND_STEPS) {
    const spec = LAND_ARM_SPECS.find((it) => it.arm === arm);
    assert.ok(spec !== undefined, `${arm} is a step target with no spec`);
    assert.equal(spec.from, from, `${arm} must be compared against the arm it extends`);
    assert.ok(LAND_ARMS.includes(from), `${from} is a predecessor but not an arm`);
  }
  // Exactly one baseline, and it is the map as it drew before any of this.
  assert.deepEqual(
    LAND_ARM_SPECS.filter((spec) => spec.from === null).map((spec) => spec.arm),
    ['flat'],
  );
  // THE FORK, named: both of these extend the arm that ships, and neither extends the other.
  assert.equal(LAND_ARM_SPECS.find((it) => it.arm === 'shadow')!.from, 'grain-normal');
  assert.equal(LAND_ARM_SPECS.find((it) => it.arm === 'grain-both')!.from, 'grain-normal');
  // ⚠ AND THE REFINED PAIR HANGS OFF THE ARM THAT SHIPS, NOT OFF THE REFERENCE. `dense` extends
  // `shadow` — the map as it draws today, occlusion field and all — so its picture answers "what
  // does refining the ladder change about the SHIPPED ground". Hanging it off `grain-both` would
  // have compared it against a ground nobody may draw and made the refinement look like a
  // concession rather than a replacement.
  assert.equal(LAND_ARM_SPECS.find((it) => it.arm === 'dense')!.from, 'shadow');
  // ⚠⚠ AND THE STEP SURVIVED THE ADOPTION ONLY BECAUSE THE EARLIER ARMS ARE PINNED. Once
  // `SHADE_LEVELS` became the nine rungs, an unpinned `shadow` would have drawn the SAME ladder as
  // `dense` — a step comparing a thing with itself, which no assertion about arms or specs can
  // see. Its own predecessors are pinned with it, so the whole published chain stays reproducible.
  for (const arm of ['banded', 'grain-normal', 'shadow', 'grain-both'] as const) {
    assert.deepEqual([...litLadderOf(arm)], [...LEGACY_SHADE_LEVELS], `${arm} left its own ladder`);
  }
  assert.deepEqual([...litLadderOf('dense')], [...SHADE_LEVELS]);
  assert.notDeepEqual([...litLadderOf('shadow')], [...litLadderOf('dense')]);
  assert.deepEqual([...LAND_ZOOMS], [2, 8], 'the overview and the zoomed read, as everywhere else');
});

test('the three banded arms are ONE material with ONE option changed', () => {
  groundSanity();
  // The property that replaced the old arithmetic proof. All three ask
  // `createBandedGroundMaterial` for the same six ramp rows, so their PALETTES are the same object
  // by construction and the only thing that can differ between them is the grain.
  const tokens = [...GROUND_TOKENS];
  const banded = createBandedGroundMaterial({ tokens });
  const normal = createBandedGroundMaterial({ tokens, grain: 'normal' });
  const both = createBandedGroundMaterial({ tokens, grain: 'both' });
  const rampOf = (m: { uniforms: Record<string, { value: unknown }> }): string =>
    JSON.stringify(m.uniforms['uRamp']!.value);
  assert.equal(rampOf(normal), rampOf(banded), 'the grain must not move the ramp');
  assert.equal(rampOf(both), rampOf(banded), 'the grain must not move the ramp');
  // NON-VACUITY: a ramp of one repeated colour would satisfy the equalities above and prove
  // nothing. Six tokens across four rungs have to deliver a real spread.
  const entries = new Set(groundRamp(tokens).map((c) => c.join(',')));
  assert.ok(entries.size >= 18, `the ground ramp delivers only ${entries.size} distinct colours`);
  assert.equal(groundRamp(tokens).length, tokens.length * SHADE_LEVELS.length);
});

test('the arm that SHIPS keeps the closure and the arm that does not is the only exemption', () => {
  groundSanity();
  // ⚠ THIS IS THE FENCE, ASKED OF THE SOURCE. The palette closure is the property a picture can
  // only ever SAMPLE — a capture proves the pixels it photographed were authored entries, never
  // that no reachable pixel is off. The source carries the stronger claim: if the only expression
  // reaching `gl_FragColor` is a `uRamp` element, no lighting term and no noise can produce a
  // colour outside the closure, because none of them is ever added to a colour.
  const tokens = [...GROUND_TOKENS];
  const closed = (src: string): boolean => /gl_FragColor = vec4\(c, 1\.0\);/.test(src);
  assert.ok(closed(createBandedGroundMaterial({ tokens }).fragmentShader));
  assert.ok(occlusionGrid(TINY_OCCLUSION.bounds).w <= 300, 'the resolution cap is not capping');
  assert.ok(
    closed(createBandedGroundMaterial({ tokens, grain: 'normal' }).fragmentShader),
    "the grain's NORMAL half must still write an authored ramp entry — that is why it ships",
  );
  assert.ok(
    !closed(createBandedGroundMaterial({ tokens, grain: 'both' }).fragmentShader),
    "the grain's COLOUR half must NOT be palette-closed, or the arm meant to show the cost of " +
      'holding the closure is showing nothing',
  );
  // And the driver's own exemption list has to agree with that, or the run would either refuse
  // the reference arm for being what it is or wave the shipping arm through.
  // ⚠ THE SHADOW ARM IS HELD TO THE CLOSURE TOO, and that is the whole difference between the
  // two forks off `grain-normal`. Its extra rung is `token x 0.77` — an authored `(token x level)`
  // product — so the palette GROWS BY ONE ENTRY PER ROW rather than opening.
  assert.ok(
    closed(
      createBandedGroundMaterial({
        tokens,
        grain: 'normal',
        shadow: groundShadowTexture(buildGroundOcclusion(TINY_OCCLUSION)),
      }).fragmentShader,
    ),
    'a shadowed fragment must still write an authored ramp entry',
  );
  // ⚠⚠ THE REFINED ARMS ARE INSIDE THE CLOSURE, AND THAT IS THE FINDING THEY EXIST TO CARRY.
  // The texture the approved render gets from a continuous mottle was assumed to need the grain's
  // off-palette COLOUR half, and therefore to need a palette move first
  // (`move-the-yellow-so-the-ground-texture-can-finish`). It does not: refining the LADDER
  // delivers the mottle out of authored `token x level` products alone, so these two arms write
  // ramp entries exactly as `shadow` does.
  assert.deepEqual([...PALETTE_CLOSED_ARMS], ['banded', 'grain-normal', 'shadow', 'dense']);
  // ⚠ THE REFINED LADDER IS NOW THE DEFAULT — `dense` is the arm that passes NO `lit`, and the
  // pinned one is the LEGACY four-rung ladder the earlier arms were measured on. The pair below
  // therefore reads the opposite way round from how it read before the adoption.
  const refinedMat = createBandedGroundMaterial({ tokens, grain: 'normal' });
  assert.ok(
    closed(refinedMat.fragmentShader),
    'the refined ladder must still write an authored ramp entry',
  );
  // NON-VACUITY on the refinement itself: a ladder that changed nothing would satisfy the line
  // above while proving nothing. The shipped shader must actually carry more rungs than the one
  // the published `shadow` figures were taken against.
  const legacyMat = createBandedGroundMaterial({
    tokens,
    grain: 'normal',
    lit: LEGACY_SHADE_LEVELS,
  });
  assert.notEqual(refinedMat.fragmentShader, legacyMat.fragmentShader);
  assert.ok(
    (refinedMat.uniforms['uRamp']!.value as unknown[]).length >
      (legacyMat.uniforms['uRamp']!.value as unknown[]).length,
    'the shipped ladder must upload MORE ramp entries than the legacy one, or nothing was adopted',
  );
  assert.equal(SHADE_LEVELS.length, 9);
  assert.equal(SHADE_LEVELS[0], 0.8);
  assert.equal(SHADE_LEVELS[SHADE_LEVELS.length - 1], 1);
  assert.equal(LEGACY_SHADE_LEVELS.length, 4);
  for (const arm of PALETTE_CLOSED_ARMS) {
    assert.ok(LAND_ARMS.includes(arm), `${arm} is held to the closure but is not an arm`);
  }
  assert.ok(!PALETTE_CLOSED_ARMS.includes('grain-both'));
});

test('the arms draw a MULTI-STATUS material, which is what retired the single-status refusal', () => {
  groundSanity();
  // ⚠ THE OLD LADDER COULD NOT SAY THIS. Its ceiling arm wore `harness/banded-material.ts`, which
  // takes ONE token per material, so the page had to refuse a mixed island rather than paint every
  // parcel the same state — a picture that would lie about the map's whole job (ADR-0392 D5 /
  // ADR-0398 D7). The shipped material takes a ramp ROW per parcel, so every arm now draws
  // whatever statuses the island carries. Asserted rather than assumed, because the fixture
  // happens to be single-status and would satisfy a weaker page just as well.
  const cells = shippedParcels();
  assert.ok(cells.length > 100, `the shipped island fixture should be ~164 parcels, got ${cells.length}`);
  assert.equal(GROUND_TOKENS.length, SHIPPED_GROUND_COLOUR.size, 'every shipped status has a row');
  assert.ok(GROUND_TOKENS.length >= 6, 'six statuses, not the four a folded set would give');
  const ramp = groundRamp([...GROUND_TOKENS]);
  assert.equal(ramp.length, GROUND_TOKENS.length * SHADE_LEVELS.length);
});

test('THE ADOPTED LADDER MOVED NOTHING DERIVED — same reference rung, same shadow rung, same margin', () => {
  groundSanity();
  // ⚠⚠ THE NUMBERS THE OWNER'S FORK TURNED ON, pinned so none can drift into prose — and now
  // asked of the ladder the map WEARS rather than of a candidate. The whole reason 0.025 is the
  // spacing is that it leaves flat ground on 0.90, exactly where the four-rung ladder left it;
  // every derived quantity that hangs off the reference is therefore unchanged across the
  // adoption, and the ONLY thing that moved is how much of the island the grain reaches.
  const tokens = [...new Set(GROUND_TOKENS)];
  assert.equal(flatGroundLevel(LEGACY_SHADE_LEVELS), 0.9);
  assert.equal(flatGroundLevel(SHADE_LEVELS), 0.9, 'the reference rung must NOT move');
  assert.equal(shadowLadderFor(tokens, SHADE_LEVELS).rung, 0.77, 'nor the derived shadow rung');
  assert.equal(shadowLadderFor(tokens, LEGACY_SHADE_LEVELS).rung, 0.77);
  assert.equal(shadowLadderFor(tokens).rung, 0.77);

  const tightest = (lit: readonly number[]): number => {
    const refs = readerReferences(tokens, lit);
    let min = Infinity;
    for (const token of tokens) {
      for (const level of shadowLadderFor(tokens, lit).levels) {
        min = Math.min(min, readMargin(deliveredForLevel(token, level), token, refs));
      }
    }
    return min;
  };
  assert.equal(tightest(LEGACY_SHADE_LEVELS).toFixed(2), '0.93');
  assert.equal(tightest(SHADE_LEVELS).toFixed(2), '0.93', 'refining must have cost NO margin');

  // ⚠⚠ AND THE HONESTY IS ASKED AGAINST EACH LADDER'S OWN REFERENCE. This is the check whose
  // absence nearly published a dishonest arm: a 0.02-spaced ladder puts flat ground on 0.92
  // instead of 0.90, and against THAT reference its darkest rungs misreport — while against
  // `SHADE_LEVELS`' references it looks free. Judged correctly, it is refused.
  assert.ok(landLadderHonest(SHADE_LEVELS));
  assert.ok(landLadderHonest(LEGACY_SHADE_LEVELS));
  const twoHundredths = Array.from({ length: 12 }, (_, i) => Math.round((0.78 + i * 0.02) * 100) / 100);
  assert.equal(flatGroundLevel(twoHundredths), 0.92, 'a 0.02 grid moves the reference');
  assert.equal(landLadderHonest(twoHundredths), false, 'and that makes its floor misreport');
  // NON-VACUITY: the same spacing floored above the reference IS honest, so the refusal is about
  // the reference having moved rather than about 0.02 being disallowed.
  assert.ok(landLadderHonest(twoHundredths.filter((l) => l >= 0.86)));

  // EVERY ARM'S LADDER IS HELD TO IT, so a future arm cannot smuggle a misreporting ladder onto
  // the page the owner judges from.
  for (const arm of LAND_ARMS) {
    assert.ok(landLadderHonest(litLadderOf(arm)), `${arm} draws a ladder that misreports`);
  }
});

test('every parcel of the fixture resolves to a token the shipped canvas actually holds', () => {
  groundSanity();
  // The arms are only the product's land while the colours are the product's colours. A parcel
  // whose status fell through to a default nobody authored would be a picture of a map that does
  // not exist.
  for (const cell of shippedParcels()) {
    const status = cell.material ?? 'unknown';
    assert.ok(SHIPPED_GROUND_COLOUR.has(status), `no shipped ground colour for status ${status}`);
  }
});

test('the ramp ROWS and the ramp TOKENS agree, status for status', () => {
  groundSanity();
  // ⚠ THE WORST FAILURE THIS SURFACE CAN HAVE, asked of the comparison page's own copy of the
  // tables. If the row a parcel is given does not index the token that parcel should wear, every
  // arm below `relief` paints each parcel with a DIFFERENT status's colour — wrong, plausible,
  // and undetectable by eye. `shipped-baseline.test.ts` asks the same question of the shipped
  // canvas; this asks it of the instrument, which is a second, independent copy of the ordering.
  for (const [status, token] of SHIPPED_GROUND_COLOUR) {
    const row = GROUND_ROWS.get(status);
    assert.ok(row !== undefined, `no ramp row for status ${status}`);
    assert.equal(GROUND_TOKENS[row], token, `row ${row} is not ${status}'s token`);
    assert.equal(groundRowOf(status), row);
  }
  assert.equal(GROUND_TOKENS.length, GROUND_ROWS.size, 'one row per status, no gaps');
  // An unrecognised status takes `unknown`'s row — the one state that means "no data". Any other
  // fallback would have the picture assert something about work it could not classify.
  assert.equal(groundRowOf('not-a-status'), GROUND_ROWS.get('unknown'));
  assert.equal(groundRowOf(undefined), GROUND_ROWS.get('unknown'));
  // NON-VACUITY: `unknown` is not row 0, so falling back to it is a real choice rather than the
  // default a zero-filled buffer would give.
  assert.notEqual(GROUND_ROWS.get('unknown'), 0);
});

test('THE CENSUS: the shipped map draws ten signatures and skips 1,063 more', () => {
  groundSanity();
  // ⚠ THIS WAS THE INCREMENT'S FINDING, and it bounded what a shadow could do here.
  // `contact-shade.ts` was ranked FIRST of ten mechanisms separating the owner's references from
  // our island — but it was ranked on the EXPERIMENT island, which stands 155 props. This map drew
  // a story tree and nothing else, so one contact pool was not what "placed rather than pasted"
  // meant.
  //
  // ⚠⚠ AND THE TREE HAS NOW GONE THE OTHER WAY (ADR-0508) — it crossed from the DRAWN column to
  // the SKIPPED one, so the census total is unchanged and its split moved by one. The map's own
  // descriptor stream now stands NOTHING: what darkens this island is the kit's trees and blooms,
  // and those are PLACEMENTS that reach the ground through `placementCasters` rather than through
  // this stream. Read the caster assertion at the bottom with that in mind — `[]` here is the whole
  // story only for descriptors, and `ForestWorldCanvas` unions this list with the placements.
  //
  // ⚠ THE CENSUS MOVED BY TEN ON 2026-08-31 and the TOTAL is what holds it honest. The mapper now
  // maps the ten `tall-flower-proven` wrappers — this fixture's ten SIGNED UAT criteria — to
  // `uat-bloom` instances instead of skipping them, so ten drawables crossed from the skipped
  // column into the drawn one and NOTHING left the scene. Asserting the parts separately AND their
  // sum is what makes that readable as a move rather than as a loss: a mapper that simply dropped
  // ten nodes would satisfy the split figure below on its own.
  //
  // ⚠⚠ THE TOTAL ALSO MOVED UNDER ADR-0593 D1 (land camera 20 -> 50 degrees) — genuinely, not a
  // rounding artefact — and this IS a finding worth a callout rather than a quiet re-base. `blooms`
  // and `trees` are unaffected (10 and 1, at every elevation checked: 20, 45, 50, 90 degrees), which
  // matches this file's own documented invariant for the UAT markers and the tree — their keep-outs
  // were migrated to GROUND-space distance (`groundGap`, ADR-0367 D1 / ADR-0545) specifically so
  // "the same island... place[s] the same marks at the same ground spots at any elevation"
  // (`scene.ts`, the section above `buildUatMarkers`). `standing` (the general
  // parcel-blade/flora/shrub/stem density fill) is NOT covered by that migration and DOES move with
  // the camera — measured 952 at 20 degrees, 950 at 45, 936 at 50 (today's declared camera), 955 at
  // 90 (true plan view) — non-monotonically, which is the signature of a bounded rejection sampler
  // whose keep-outs are still measured in ISOTROPIC SCREEN PIXELS against a foreshortened cell (the
  // exact failure mode `scene.ts` describes just above `groundGap`, for the class it fixed
  // everywhere EXCEPT here): a sampler that starves differently at each elevation and relocates
  // marks onto cell centroids, gaining or losing a handful of draws depending on how tightly the
  // rejection loop binds that camera's squash. `flowers` (the `tall-flower-*` status fill) is stable
  // across the same four elevations, so the residual latent screen-space dependency is scoped to
  // `standing` alone. This is a PRE-EXISTING gap this landing did not introduce — raising the camera
  // only made it visible, by moving `standing` enough (952 -> 936) to cross this assertion's exact
  // literal. Recommend: a follow-up to migrate `standing`'s density scatter to `groundGap` the same
  // way the UAT markers were, so this census stops being camera-sensitive at all.
  const descriptors = worldTo3D(islandScene());
  const standing = descriptors.filter(
    (d) =>
      d.kind === 'skipped' &&
      ['parcel-blade', 'parcel-flora', 'parcel-shrub', 'parcel-stem'].includes(d.sceneKind ?? ''),
  );
  const flowers = descriptors.filter(
    (d) => d.kind === 'skipped' && (d.sceneKind ?? '').startsWith('tall-flower-'),
  );
  const blooms = descriptors.filter((d) => d.kind === 'uat-bloom');
  // The retired story tree, now on the skipped side of the ledger — counted BY NAME so that the
  // total below stays legible as a move rather than a loss.
  const trees = descriptors.filter((d) => d.kind === 'skipped' && d.sceneKind === 'tree');
  assert.equal(standing.length + flowers.length, 1062, 'the skipped ground-standing census moved');
  assert.equal(blooms.length, 10, 'the fixture signs ten criteria and the map now draws all ten');
  assert.equal(trees.length, 1, 'the one story tree is still SEEN by the mapper — skipped, not dropped');
  assert.equal(
    standing.length + flowers.length + blooms.length + trees.length,
    1073,
    'eleven drawables have crossed columns over this arc; none may have left the scene besides the ' +
      'camera-sensitive `standing` count documented above (1,089 at the retired 20-degree camera)',
  );
  // ⚠ AND NOW NOTHING IN THE STREAM CASTS. The tree was the one descriptor on this island that
  // did; a bloom is a knee-high flower, not an occluder, and the parcels are the ground itself.
  // The dark pool that stood at this island's centre in every frame on this arc was the
  // placeholder's, and it goes with it.
  assert.deepEqual(groundCasters(descriptors), []);
  // NON-VACUITY: `groundCasters` did not stop working, and this fixture would still show a portal
  // if it had one. An empty result here is a fact about the ISLAND, not about the function.
  assert.deepEqual(
    groundCasters([
      ...descriptors,
      { kind: 'cave-arch', transform: { x: 1, y: 0, z: 2 }, group: 'cave-arch', width: 4 },
    ]),
    [{ x: 1, z: 2, radius: 3.2, height: 3.2 }],
  );
});

test('THE LADDER ARMS SHADE THE MAP’S OWN CASTERS — the kit’s, now that the story tree’s are gone', () => {
  groundSanity();
  // ⚠⚠ THE FAILURE THIS FORBIDS, and it was live for about an hour on 2026-09-04. This page built
  // its occlusion field from `shippedCasters()` alone. That was already an under-report — the kit
  // began casting on 2026-09-03 and this page never unioned the placements in — and when ADR-0508
  // retired the story tree it became an EMPTY field: every shadow figure on the page would have
  // been a figure about nothing, and the `shadow`/`dense` arms would have been pixel-identical to
  // their unshadowed siblings while still being reported as a shadow ladder.
  //
  // `shipped-land-measure.mjs` catches it at run time ("the shadow arm was built from ZERO
  // casters"), which is how it was found — but that guard needs a GPU and a browser. This is the
  // same claim where `pnpm -r test` can hold it.
  const stream = shippedCasters();
  const map = shippedMapCasters();
  assert.deepEqual(stream, [], 'the descriptor stream stands nothing since ADR-0508');
  assert.ok(map.length > 0, 'but the ISLAND stands its capability trees, and the ladder arms must shade them');

  // ⚠ AND IT IS THE UNION, not a replacement: `shippedMapCasters` opens with the stream's own
  // casters, so a `cave-arch` on this island would still darken the ground under it. With the
  // stream empty that is unobservable from the outside, which is exactly why it is asserted on the
  // SHAPE — the first `stream.length` entries are the stream's, in order.
  assert.deepEqual(map.slice(0, stream.length), stream);

  // Every caster is a real cylinder standing somewhere, not a placeholder: a zero-radius or
  // zero-height entry would darken nothing and would pass `map.length > 0` just as well.
  for (const c of map) {
    assert.ok(c.radius > 0 && c.height > 0, `a caster at ${c.x},${c.z} occludes nothing`);
    assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z), 'a caster stands nowhere');
  }
});
