// shipped-baseline.test.ts — hold the AUTHORED baseline to the two things that can make it lie.
//
// 1. THE FORMULAS ARE CHECKED AGAINST THREE ITSELF. Geometry generation is pure JavaScript and
//    needs no WebGL, so the counts this module claims for `cylinderGeometry(9, 9, 3, 6)` and
//    friends are asserted against the real `CylinderGeometry` here rather than against memory.
//    A formula derived from the docs and never run is how an authored count acquires the calm
//    authority of a measurement while being wrong.
// 2. THE PALETTE TRANSCRIPTIONS ARE PARSED OUT OF THE SHIPPED FILE, using the SAME parser the
//    `pnpm check:palette-transcription` rung uses rather than a second regex — a copy of a parser
//    is one more thing that can quietly stop matching. The repo carried THREE disagreeing copies
//    of the status palette until 2026-08-28; a fourth that nobody checks would be strictly worse
//    than none. What the rung does NOT ask, and this file does, is whether the two transcriptions
//    here still describe the file — and whether the retired spike palette is provably in the past.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CircleGeometry, ConeGeometry, CylinderGeometry, SphereGeometry } from 'three';
import { buildScene, hexCenter as hexCentre, type SceneG } from '@storytree/forest-world';

import { worldTo3D, type Descriptor3D, type InstanceDescriptor } from '../src/world-to-3d.js';
import { cellGroundTriangles } from '../src/cell-ground-geometry.js';
import { islandScene } from './island-fixture.js';
import { parseCanvasPalette } from './palette-transcription.js';
import type { BufferGeometry } from 'three';

import {
  SHIPPED_LIGHTING,
  SHIPPED_PRIMITIVES,
  SHIPPED_STATUSES,
  SHIPPED_GROUND_COLOUR,
  SHIPPED_CROWN_COLOUR,
  SPIKE_STATUS_COLOUR,
  SHIPPED_UNDRAWN,
  BEFORE_THE_CELL_CASE,
  authoredTriangles,
  cellGroundTrianglesFor,
  circleTriangles,
  classicHexScene,
  cylinderTriangles,
  sphereTriangles,
} from './shipped-baseline.js';
import { LIGHT_DIRECTION, SHADE_LEVELS } from '../src/shade-ladder.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SHIPPED = join(HERE, '..', 'src', 'ForestWorldCanvas.tsx');
/** Where the ground's four input lists are DERIVED (2026-09-15) — the canvas mounts them, this
 *  module makes them, and several claims below are read here rather than in the canvas. */

/**
 * The `[start, end)` span of the shipped source between two anchors — REFUSING when either anchor
 * is missing.
 *
 * ⚠⚠ THE FAILURE THIS EXISTS TO MAKE IMPOSSIBLE, and it very nearly landed. The two structural
 * assertions below used to slice with a bare `src.indexOf('function StoryTree')` as their END
 * anchor. `StoryTree` was retired on 2026-09-04 (ADR-0508), `indexOf` returned `-1`, and
 * `String.prototype.slice` reads a negative end as an offset FROM THE END — so the region silently
 * became the whole rest of the file, or empty, and both tests went on passing while asserting
 * about the wrong text. Nothing would have failed; the checks would simply have stopped checking.
 * That is `moving-a-write-target-makes-old-readers-vacuously-green` on a source-text reader, and
 * the remedy is not "pick a better anchor" — it is to make a missing anchor LOUD, because the next
 * component to be retired will move somebody's anchor again.
 */
function regionOf(src: string, from: string, to: string): [number, number] {
  const start = src.indexOf(from);
  const end = src.indexOf(to);
  assert.ok(start >= 0, `the shipped canvas no longer contains '${from}' — re-anchor this slice`);
  assert.ok(end > start, `'${to}' is missing or precedes '${from}' in the shipped canvas — re-anchor this slice`);
  return [start, end];
}

/**
 * The shipped source with its comments removed — what the canvas DOES, without what it says.
 *
 * ⚠ NEEDED BY THE "X IS GONE" ASSERTIONS, and the reason is worth stating because it is a trap
 * that fires on the very landing that retires something. This file's habit — a good one — is to
 * leave a note where a retired component stood, naming the symbols that went. A negative regex over
 * the RAW source then matches the tombstone and reports the thing as still present, so the choice
 * is between a check that fires on its own documentation and a codebase that may not describe what
 * it removed. Stripping comments is the third option, and it is the honest one: the claim these
 * assertions make is that nothing MOUNTS a `StoryTree`, never that the file may not mention it.
 */
function codeOf(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Triangles three actually generated. Non-indexed geometry has no index buffer, so both
 *  cases are handled rather than assumed. */
function realTriangles(g: BufferGeometry): number {
  const positions = g.getAttribute('position');
  return (g.index ? g.index.count : positions.count) / 3;
}

test('the closed-cylinder formula matches three — both ends capped, the retired hex prism’s own shape', () => {
  // ⚠ `hex-ground` (the classic prism this shape was authored for) is retired
  // (`retire-the-old-land-path`), and so, since 2026-09-04, is the story-tree trunk/crown that
  // took over as `cylinderTriangles`'s last shipped caller (ADR-0508). The FORMULA is neither:
  // it is general-purpose arithmetic about what three.js generates, and a closed cylinder (both
  // radii non-zero, one non-degenerate torso row) is a real case of it worth holding to three's
  // own count regardless of which shipped primitive once wore these numbers. Deleting it with its
  // last caller would throw away a checked claim about a library this repo does not own.
  const g = new CylinderGeometry(9, 9, 3, 6);
  assert.equal(cylinderTriangles(6, 1, 9, 9), realTriangles(g));
  assert.equal(cylinderTriangles(6, 1, 9, 9), 24, 'a 6-segment closed cylinder is 24 triangles');
});

test('the retired trunk/crown formulas still match three — the arithmetic outlived its primitive', () => {
  // ⚠ THESE TWO CASES NO LONGER DESCRIBE ANYTHING THE CANVAS DRAWS (ADR-0508 retired `StoryTree`,
  // and `SHIPPED_PRIMITIVES` dropped both its rows), and they are kept deliberately rather than
  // deleted with it. `cylinderTriangles` is a claim about three.js — that a CONE is not a
  // zero-radius cylinder by count, because the degenerate tip row emits one triangle per radial
  // segment instead of two — and that claim is what the whole authored-count discipline rests on.
  // It was worth checking before this map drew a cone and it is worth checking after.
  const trunk = new CylinderGeometry(1.2, 1.6, 8);
  assert.equal(cylinderTriangles(32, 1, 1.2, 1.6), realTriangles(trunk));
  const crown = new ConeGeometry(7, 14, 8);
  assert.equal(cylinderTriangles(8, 1, 0, 7), realTriangles(crown));
  // NON-VACUITY on the degenerate-row rule: treating the tip as a full row would over-count.
  assert.notEqual(cylinderTriangles(8, 1, 0, 7), 8 * 2 + 8);
  // And the two together were the map's whole authored cost before the `cell` case existed.
  assert.equal(
    cylinderTriangles(32, 1, 1.2, 1.6) + cylinderTriangles(8, 1, 0, 7),
    BEFORE_THE_CELL_CASE.triangles,
  );
});

test('the cave-arch and wisp formulas match three', () => {
  assert.equal(circleTriangles(24), realTriangles(new CircleGeometry(5, 24)));
  assert.equal(sphereTriangles(12, 12), realTriangles(new SphereGeometry(2.2, 12, 12)));
});

test('authoredTriangles sums a census, and reports a family the canvas draws none of', () => {
  // `hex-ground` used to be the multi-instance family exercised here; it is retired
  // (`retire-the-old-land-path`) and no longer a row in `SHIPPED_PRIMITIVES` at all, so
  // `cave-arch` takes its place as the still-live family with a drawable count above one.
  // `story-tree` was the third family in this census and went the same way (ADR-0508).
  const census = { 'cave-arch': 2, 'wisp-sprite': 0 };
  const got = authoredTriangles(census);
  // 2 x 24 arch + 0 wisp
  assert.equal(got.triangles, 2 * 24);
  const wisp = got.byKind.find((k) => k.kind === 'wisp-sprite');
  assert.ok(wisp, 'a kind with zero drawables is REPORTED, not dropped');
  assert.equal(wisp.triangles, 0);
  // ⚠ AND A RETIRED FAMILY CONTRIBUTES NOTHING EVEN WHEN A CENSUS STILL NAMES IT. A census is
  // `Record<string, number>`, so nothing stops a stale caller passing `story-tree`; what must not
  // happen is a row reappearing to charge for it.
  assert.equal(authoredTriangles({ ...census, 'story-tree': 1 }).triangles, got.triangles);
  assert.ok(!got.byKind.some((k) => k.kind.startsWith('story-tree')));
});

test('an empty census is zero, and every primitive still appears in the breakdown', () => {
  const got = authoredTriangles({});
  assert.equal(got.triangles, 0);
  assert.equal(got.byKind.length, SHIPPED_PRIMITIVES.length);
});

test('the transcribed GROUND palette is what the shipped canvas actually holds', () => {
  const parsed = parseCanvasPalette(readFileSync(SHIPPED, 'utf8'), 'GROUND_COLOUR');
  assert.equal(parsed.size, 6, 'the shipped canvas should carry six ground entries');
  assert.deepEqual(
    [...parsed.entries()].sort(),
    [...SHIPPED_GROUND_COLOUR.entries()].sort(),
    'SHIPPED_GROUND_COLOUR has drifted from src/ForestWorldCanvas.tsx — re-transcribe it',
  );
});

test('the transcribed CROWN palette is what the shipped canvas actually holds', () => {
  const parsed = parseCanvasPalette(readFileSync(SHIPPED, 'utf8'), 'CROWN_COLOUR');
  assert.equal(parsed.size, 6, 'the shipped canvas should carry six crown entries');
  assert.deepEqual(
    [...parsed.entries()].sort(),
    [...SHIPPED_CROWN_COLOUR.entries()].sort(),
    'SHIPPED_CROWN_COLOUR has drifted from src/ForestWorldCanvas.tsx — re-transcribe it',
  );
});

test('the two tables are TWO tables — ground and crown really do differ', () => {
  // NON-VACUITY on the whole point of the split. If these ever became equal, one lookup would do
  // and the pair of tests above would be checking one belief twice. `building` is the sharpest
  // case (slate crown over yellow ground) but it is not the only one, so the assertion is about
  // the tables rather than about that entry.
  const differ = SHIPPED_STATUSES.filter((s) => SHIPPED_GROUND_COLOUR.get(s) !== SHIPPED_CROWN_COLOUR.get(s));
  assert.deepEqual(differ.slice().sort(), [...SHIPPED_STATUSES].sort(), 'every status draws a crown unlike its ground');
});

test('FIVE COLOURS OVER SIX STATES survives on the shipped canvas (ADR-0462)', () => {
  // The merge is a decision, and a decision that only lives in a comment is one an edit can undo
  // without anything noticing. `proposed` and `building` share the yellow; the crowns do NOT
  // merge, because the app authors no `--crown-building-*` pair and this canvas transcribes what
  // the app delivers rather than harmonising the two.
  assert.equal(SHIPPED_GROUND_COLOUR.get('proposed'), SHIPPED_GROUND_COLOUR.get('building'));
  assert.equal(new Set(SHIPPED_GROUND_COLOUR.values()).size, 5, 'six states, five ground colours');
  assert.notEqual(SHIPPED_CROWN_COLOUR.get('proposed'), SHIPPED_CROWN_COLOUR.get('building'));
});

test('the RETIRED spike palette is no longer what the shipped canvas holds', () => {
  // The freeze is only evidence while it is PROVABLY the past. A `SPIKE_STATUS_COLOUR` that still
  // matched the live source would mean the correction never landed, and every proof built on it
  // (`palette-transcription.test.ts` runs the guard against this table and asserts a refusal)
  // would be describing the present while claiming to describe history.
  const src = readFileSync(SHIPPED, 'utf8').replace(/GROUND_COLOUR|CROWN_COLOUR/g, '');
  assert.ok(!/\bSTATUS_COLOUR\b/.test(src), 'the single STATUS_COLOUR map is gone from the shipped canvas');
  for (const [status, spike] of SPIKE_STATUS_COLOUR) {
    assert.notEqual(SHIPPED_GROUND_COLOUR.get(status), spike, `${status} still draws its spike colour`);
  }
});

// ⚠ 'the shipped size constants are what the shipped canvas holds' RETIRED HERE
// (`retire-the-old-land-path`). It pinned `HEX_RADIUS` / `TILE_HEIGHT`, the classic hex prism's
// own size constants — both were deleted from `src/ForestWorldCanvas.tsx` along with `HexGround`
// itself, so there is nothing left in the shipped file for this regex to hold to. The one
// remaining size fact worth pinning — the ground's DEPTH — is `CELL_GROUND_DEPTH` in
// `src/cell-ground-geometry.ts`, which carries its own `pnpm -r test` coverage and cites this
// file's history rather than duplicating it here.

test('the LIGHT is the light the shipped canvas actually hangs — and it is DERIVED, not transcribed', () => {
  // ⚠ THE ONE TRANSCRIPTION RELIEF DEPENDS ON. Relief moves no colour and adds no mark — the
  // whole visible difference between the flat map and the relieved one is `dot(n, L)` against
  // this direction, so a comparison lit from anywhere else is a picture of a land the product
  // does not draw. Every unpinned transcription in this package has drifted from its source at
  // least once; this one is read off the file rather than remembered.
  //
  // ⚠⚠ AND SINCE 2026-08-30 THE STRONGER PROPERTY HOLDS: there is no transcription left to
  // drift. The canvas used to hang the key light at the literal `[120, 300, 80]` — (+0.36, +0.90,
  // +0.24) normalised, the OPPOSITE SIDE IN X from the land's own authored sun — so every lit
  // object was lit from the east while the ground beside it was banded, and cast its shadows,
  // from the west. Both now read `LIGHT_DIRECTION`. So the assertion is that the canvas DERIVES
  // it, plus that the numbers still agree; a canvas that went back to a literal would satisfy the
  // second and fail the first, which is the direction that matters.
  const src = readFileSync(SHIPPED, 'utf8');
  // ⚠ THE INTENSITIES ARE DERIVED TOO, and asserting the DERIVATION rather than the number is the
  // same rule as the direction below: a literal `0.78` in the JSX would agree with this table
  // today and drift the moment the ladder's floor moved, which is the drift every unpinned
  // transcription in this package has made at least once.
  // ⚠⚠ SINCE 2026-08-31 THE PAIR IS MEASURED, so the derivation moved one step further out and
  // the assertion follows it. The canvas hangs `<CalibratedLights />`, which reads
  // `intensitiesFor(calibrateLights(gl))` — the ladder's floor and top are still what "unlit" and
  // "lit" mean, but they are now scaled by a probe of the renderer that will draw the map. The
  // canvas therefore no longer mentions `SHADE_LEVELS` at all, and asserting that it does would
  // fail for the correct file. What the drift-guard has to hold instead is that the numbers are
  // still COMPUTED rather than written down: a literal pair in `<ambientLight intensity={0.8} />`
  // is the exact regression this test has existed to refuse since the day the ladder moved.
  assert.ok(
    src.includes('<CalibratedLights />'),
    'the canvas must hang the calibrated lights, not two hand-written intensities',
  );
  assert.match(
    src,
    /intensitiesFor\(calibrateLights\(gl\)\)/,
    'the intensities must be a probe of THIS renderer scaled onto the ladder',
  );
  assert.ok(
    !/<ambientLight intensity=\{[\d.]/.test(src) && !/<directionalLight[\s\S]{0,200}intensity=\{[\d.]/.test(src),
    'neither light may carry a literal intensity',
  );
  // ⚠ AND THE TRANSFER FUNCTION THE PROBE IS TAKEN THROUGH IS ASSERTED TOO, because the probe is
  // only valid inside it. `<Canvas>` carried @react-three/fiber's DEFAULTS until 2026-08-31 — ACES
  // filmic tone mapping and an sRGB output encode — while the approved reference render and this
  // package's whole palette-closure proof are taken in exact-colour mode. `calibrateLights`
  // refuses outside it at runtime; this refuses at build time, where a reviewer can see it.
  assert.ok(
    src.includes('{...EXACT_COLOUR_CANVAS_PROPS}'),
    'the canvas must be in exact-colour mode, spread from the one value that defines it',
  );
  assert.ok(
    !/<Canvas[^>]*\blegacy\b[^>]*>/.test(src.replace('{...EXACT_COLOUR_CANVAS_PROPS}', '')),
    'the three flags must come from the shared value, not be re-spelled on the element',
  );
  assert.match(
    src,
    /position=\{\[\s*LIGHT_DIRECTION\.x \* (\d+),\s*LIGHT_DIRECTION\.y \* \1,\s*LIGHT_DIRECTION\.z \* \1,?\s*\]\}/,
    'the key light must be aimed along LIGHT_DIRECTION, on all three axes at ONE distance',
  );
  // The floor-to-top span is now `intensitiesFor`'s own arithmetic, held by
  // `src/light-calibration.test.ts` against the ladder rather than by a string match here.
  // The two derivations agree: a fully lit white face lands on the ladder's TOP rung and an unlit
  // one on its FLOOR — the range the ground beside it is quantised into.
  assert.equal(SHIPPED_LIGHTING.ambientIntensity, SHADE_LEVELS[0]);
  assert.equal(
    SHIPPED_LIGHTING.ambientIntensity + SHIPPED_LIGHTING.directionalIntensity,
    SHADE_LEVELS[SHADE_LEVELS.length - 1],
  );
  // ⚠ NON-VACUITY. The pair the canvas hung until 2026-08-30 summed to 1.8, which saturates
  // anything with a texture on it — the first dressed frame delivered pale grey needles on PINK
  // trunks. A test that only checked "the two agree" would pass for two copies of that.
  assert.ok(
    SHIPPED_LIGHTING.ambientIntensity + SHIPPED_LIGHTING.directionalIntensity <= 1,
    'the lights overexpose anything carrying a texture',
  );
  // And the two derivations agree numerically — the baseline scales by the same distance the
  // canvas does, so a comparison scene lights its arms exactly as the product lights its map.
  const [dx, dy, dz] = SHIPPED_LIGHTING.directionalPosition;
  const scale = Math.hypot(dx, dy, dz);
  assert.ok(Math.abs(dx / scale - LIGHT_DIRECTION.x) < 1e-12, 'x');
  assert.ok(Math.abs(dy / scale - LIGHT_DIRECTION.y) < 1e-12, 'y');
  assert.ok(Math.abs(dz / scale - LIGHT_DIRECTION.z) < 1e-12, 'z');
  // ⚠ NON-VACUITY, and this is the assertion the old literal would have failed. The authored sun
  // comes from the WEST (negative x); the light the canvas hung until 2026-08-30 came from the
  // east. A test that only checked "the two agree" would pass for two copies of the wrong one.
  assert.ok(dx < 0, 'the key light is on the same side as the shadows the ground casts');
  assert.ok(src.includes(`args={['${SHIPPED_LIGHTING.background}']}`), 'the background colour');
});

test('the product and the APPROVED REFERENCE RENDER are configured by the same two modules', () => {
  // ⚠⚠ THIS IS THE INCREMENT'S CENTRAL CLAIM AND IT IS A CODE-LEVEL ONE, deliberately, because the
  // pixel-level version is not available: `island-kit-8px.png` is a picture of the HARNESS island
  // and the product draws the studio's, so no two frames are comparable pixel for pixel. What IS
  // comparable is the configuration. The approved reference came out of `kit-island-scene.ts`,
  // which puts its renderer into exact-colour mode and then calibrates its lights against it. The
  // shipped canvas now does both, through the SAME two modules rather than through a second
  // transcription of them — which is the only form of "the same pipeline" that cannot drift.
  //
  // Until 2026-08-31 it did neither: a default `<Canvas>` is ACES filmic tone mapping over an sRGB
  // output encode, and no probe ran. A white fully-lit face delivered 0.66 there against the
  // ladder's top rung of 1.00 — the crowns read lighter than the reference, which is what the
  // increment was parked on, by a mechanism nobody had named.
  const reference = readFileSync(join(HERE, 'kit-island-scene.ts'), 'utf8');
  assert.match(reference, /configureExactColour\(/, 'the reference render is in exact-colour mode');
  assert.match(reference, /calibrateLights\(/, 'the reference render calibrates its lights');

  const src = readFileSync(SHIPPED, 'utf8');
  assert.match(src, /EXACT_COLOUR_CANVAS_PROPS/, 'the product is in exact-colour mode');
  assert.match(src, /calibrateLights\(/, 'the product calibrates its lights');

  // ⚠ NON-VACUITY, AND IT IS THE HALF THAT ACTUALLY BINDS. Both files could satisfy the four
  // matches above while importing two different `configureExactColour`s — which is exactly the
  // fork that gave this package three disagreeing status palettes. So: the reference's own
  // configuration must reach the SAME module the product's does. `banded-material.ts` re-exports
  // `src/exact-colour.ts` and `pine-scene.ts` re-exports `src/light-calibration.ts`; the
  // ADOPTED ledger in `scope-fence.test.ts` is what holds those two re-exports in place.
  const banded = readFileSync(join(HERE, 'banded-material.ts'), 'utf8');
  const pine = readFileSync(join(HERE, 'pine-scene.ts'), 'utf8');
  assert.match(banded, /configureExactColour[\s\S]{0,200}from '\.\.\/src\/exact-colour\.js'/);
  assert.match(pine, /calibrateLights[\s\S]{0,200}from '\.\.\/src\/light-calibration\.js'/);
});

test('the shipped ground STANDS ON the relief field — the adoption, read off the file', () => {
  // ⚠ END-STATE ITEM 6: "the old path goes, it is not left beside the new one. A flag nobody
  // flips is not adoption." So the assertion is that the shipped canvas passes the relief
  // UNCONDITIONALLY — no prop, no default-off, nothing a caller has to opt into. A later session
  // that reintroduces a flag here has re-opened a decision the owner closed on 2026-08-29.
  const src = readFileSync(SHIPPED, 'utf8');
  // ⚠ THE FIELD IT STANDS ON GAINED A SHORE ON 2026-09-01, AND THIS TEST FOLLOWED IT RATHER THAN
  // BEING DELETED. `shoreRelief` is a STRICT EXTENSION of `landRelief` — inland of the shore band
  // it returns `landHeight` to the last bit, which `src/shore-fall.test.ts` asserts with
  // `assert.equal` — so the claim this test makes is the same claim: the shipped ground stands on
  // the relief field, unconditionally. What changed is only that the field now falls to the coast.
  //
  // ⚠⚠ AND IT MUST BE THE CLIPPED PARCELS IT IS BUILT FROM, which is why the argument is matched
  // rather than just the call. The shore is measured to the mesh's own rim, and after
  // `clipToCoast` that rim IS the coast; built from `cells` instead it would measure to the hex
  // silhouette and put the waterline a beach's width inland of the water — a picture that still
  // looks like an island, which is precisely why a source-text match earns its keep here.
  assert.match(
    src,
    /relief:\s*shoreRelief\(clipped,\s*SHIPPED_SHORE\)/,
    'CellGround must build its geometry on the shore-fall field, over the CLIPPED parcels',
  );
  assert.ok(
    !/relief\??\s*[:=][^,;)]*\?\?/.test(src),
    'the relief must not be behind a caller-supplied fallback — that is the flag item 6 forbids',
  );
  // The arm is a CONSTANT, not a prop: `SHIPPED_SHORE` names which band ships and is the whole
  // change if the owner prefers another. A canvas that took it as an argument would be item 6's
  // flag wearing a different name.
  assert.ok(
    !/SHIPPED_SHORE\s*[?:]?=/.test(src),
    'the shore arm must not become a caller-supplied prop',
  );
});

test('the shipped ground WEARS THE BANDED LADDER — also unconditionally, also item 6', () => {
  // The second component of the approved treatment to cross (2026-08-30). Relief alone reaches a
  // `meshStandardMaterial` as a SMOOTH gradient; the ladder is what turns it into the authored
  // zones the research renders show. Same fence as the relief above: no prop, no default-off.
  const src = readFileSync(SHIPPED, 'utf8');
  assert.match(src, /index:\s*groundRowOf/, 'CellGround must hand the builder its parcel rows');
  // ⚠ THE MATERIAL IS BUILT PER SCENE RATHER THAN ONCE FOR THE MODULE since the shadow crossed
  // (2026-08-30) — the occlusion field is built over THIS island's bounds from THIS island's
  // casters, so a shared instance would hand every canvas the first one's shadow. What this test
  // is about is unchanged: the cell ground draws the banded material and nothing else.
  assert.match(src, /<mesh material=\{built\.material\}>/, 'and draw them with the banded material');
  // ⚠ THE MATERIAL NOW TAKES THE FIELD RATHER THAN THE CELLS (2026-08-31), because the packed
  // occlusion atlas has to be built ONCE and read by both the geometry and the material — two
  // calls happening to pack the same way would be an agreement rather than a construction, and
  // when it broke every island would read another island's corner of the atlas while drawing a
  // perfectly ordinary set of shadows. What this test is about is unchanged: the field is still
  // derived from THIS scene's own casters, with no flag between it and the mesh.
  // ⚠ AND IT NOW CARRIES LAYERS 1 THROUGH 6 (2026-09-02). The grass is passed as a second
  // argument rather than defaulted inside the builder, the sand's strength as the fourth, and the
  // layers above the sand as the SHIPPED extras — so the CANVAS states what the shipped ground
  // wears and the builder stays the thing a comparison arm can drive with any rung.
  assert.match(
    src,
    /buildGroundMaterial\(field, SHIPPED_GRASS, shore\(\), SHIPPED_SAND_MIX, extras\)/,
    'the material is built from the built field, wearing layers 1, 2, 3, 4 and 6',
  );
  // The extras are the shipped constants, not literals: the rock and the detail read
  // SHIPPED_LAYERS, and the wear field comes from the builder's own thunk.
  assert.match(src, /extras: GroundLayerExtras = \{ rock: SHIPPED_LAYERS\.rock, detail: SHIPPED_LAYERS\.detail \}/);
  assert.match(src, /extras\.wear = \{ field: wearField, mix: SHIPPED_LAYERS\.wearMix \}/);
  // ⚠ IT READS `clipped` RATHER THAN `cells` SINCE THE COAST CROSSED (2026-09-01), and the
  // ORDER is the claim rather than the name. The atlas is packed over the ground's own bounds, so a
  // field built from the PRE-clip parcels would leave the new shore outside every island's tile and
  // the beach would wear whatever shadow sat on the atlas's edge texel. What this test is about is
  // unchanged: the field is derived from THIS scene's own ground, with no flag between it and the
  // mesh — and it is now derived from the ground the mesh actually draws.
  assert.match(
    src,
    /const clipped = clipToCoast\(cells, SHIPPED_COAST\);/,
    'the coast is clipped before anything downstream reads the parcels',
  );
  assert.match(
    src,
    /buildGroundOcclusionField\(clipped, casters, penumbra, contactBand, contactSpread\)/,
    'and that field is built from this scene’s own CLIPPED cells and casters (the spread rides the same call since 2026-09-06)',
  );
  // ⚠ AND THE SMOOTH MATERIAL IS GONE FROM THE CELL GROUND RATHER THAN LEFT BESIDE IT. Two land
  // materials is the outcome item 6 calls worse than either — and here it would be worse still,
  // because the two disagree about what a status colour looks like.
  const cellGround = src.slice(...regionOf(src, 'function CellGround', 'function KitProps('));
  assert.ok(!/meshStandardMaterial/.test(cellGround), 'the cell ground keeps ONE material');
  assert.ok(!/attributes-color/.test(cellGround), 'and uploads no attribute its material cannot read');
  assert.match(cellGround, /attributes-\$\{GROUND_STATUS_ATTRIBUTE\}/, 'the row attribute is uploaded');
  // ⚠ THE CLASSIC HEX PRISM IS RETIRED FROM THIS FILE ENTIRELY (`retire-the-old-land-path`),
  // WHICH IS A STRONGER PROPERTY THAN "NOT BANDED". Until then a `HexGround` component stood
  // beside `CellGround`, deliberately un-banded — a scene carried one substrate or the other
  // (`scene.ts:658`), the relaxed mesh is what the studio ships, and rewriting the legacy path
  // would have been a second untested crossing. Retiring it removed the asymmetry rather than
  // merely documenting it: there is now ONE ground component in the shipped file, and this locks
  // that in — a later edit that re-introduces the classic prism (with or without banding) fails
  // here rather than being discovered by a reader.
  assert.ok(!/function HexGround/.test(src), 'the classic HexGround component must not return');
  assert.ok(!/hex-ground/.test(src), 'the retired hex-ground descriptor kind must not return');
});

test('the shipped ground WEARS THE GRAIN OCTAVE — normal half only, unconditionally, item 6', () => {
  // The third component of the approved treatment to cross (2026-08-30). Same fence as the two
  // before it: no prop, no default-off, no flag nobody flips.
  const src = readFileSync(SHIPPED, 'utf8');
  assert.match(
    src,
    /BandedGroundMaterialOptions = \{ tokens: GROUND_TOKENS, grain: 'normal' \};/,
    'the shipped ground material must ask for the grain, and must ask for it unconditionally',
  );
  // ⚠⚠ AND IT MUST NOT ASK FOR `both`. That is not style: the colour half is off-palette by
  // construction, and `harness/grain-status-reading.ts` measured that at its authored fac of 0.13
  // the `proposed`/`building` yellow at the two darkest rungs reads as `healthy`. A ground that
  // misreports a capability's proof state is the one way this arc can do real harm
  // (ADR-0392 D5 / ADR-0398 D7), so the fork is the owner's and this is the assertion that keeps
  // a later session from taking it by accident.
  assert.ok(
    !/grain:\s*'both'/.test(src),
    "the shipped canvas must not wear the grain's COLOUR half — it is measured inadmissible on " +
      'this palette, and adopting it is an owner decision rather than a shader edit',
  );
});

test('the shipped ground WEARS LAYER 1 — gated per token, unconditionally, item 6 again', () => {
  // The approved ground's BASE layer, crossed 2026-09-02 (ADR-0490 D2 row 1, adopted under
  // ADR-0492 D1). Same fence as the four components before it: no prop, no default-off, no flag
  // nobody flips — the layer sat built, green and SWITCHED OFF for a day on exactly that shape.
  const src = readFileSync(SHIPPED, 'utf8');
  assert.match(
    src,
    /export const SHIPPED_GRASS: GroundGrassLayer = \{/,
    'the shipped canvas must name what the ground wears as a CONSTANT, not take it as a prop',
  );
  assert.ok(
    !/SHIPPED_GRASS\s*[?:]?=\s*props|grass\??:\s*GroundGrassLayer[^=]*=>/.test(src),
    'layer 1 must not become a caller-supplied prop — that is item 6’s flag under another name',
  );
  // ⚠⚠ THE GATE IS DERIVED FROM THE ROW RESOLVER, NEVER WRITTEN OUT. `GROUND_ROWS` is built from
  // `GROUND_COLOUR`'s insertion order, so a literal `rows: [0]` here would be a SECOND ordering
  // that agrees today — and when it stopped agreeing the layer would dress a different status's
  // parcels and look entirely correct. This file warns about that failure twice already.
  assert.match(
    src,
    /GRASS_GATE_ROWS: readonly number\[\] = GRASS_STATUS_GATE\.map\(groundRowOf\)/,
    'the gated rows must be resolved through the same groundRowOf the geometry indexes with',
  );
  assert.ok(
    !/rows:\s*\[\s*\d/.test(src),
    'no literal row list — the gate is derived from GRASS_STATUS_GATE or it is a second ordering',
  );
  // ⚠⚠ THE FACTOR IS A RUNG OF A RENDERED LADDER, JUDGED BY THE LOOK (ADR-0506, 2026-09-03). This
  // test used to hold it under the reader model's 0.4065 ceiling, and that fence is what kept the
  // ground from matching the render the owner stamped — the same per-pixel proxy ADR-0503 had
  // already demoted for every layer above this one. What the constant still owes: it is NAMED, it
  // is above the provably invisible floor, and it never REPLACES the status colour.
  const mix = /export const SHIPPED_GRASS_MIX = ([0-9.]+);/.exec(src);
  assert.ok(mix !== null, 'the shipped mix factor must be a named constant');
  const fac = Number(mix[1]);
  // ⚠ ABOVE THE FLOOR. At the recipe's authored 0.13 the maximum channel shift on green is
  // 11/255, so by ADR-0490 D6's own rule nothing moves: a factor there is an adoption that
  // changes nothing visible while reading as a clean landing.
  assert.ok(fac > 0.13, `the shipped factor ${fac} is at or below the provably invisible 0.13`);
  // ⚠ AND NEVER 1.0 — ADR-0490 D5's seam (modulate, never replace) is kept literally, as it is on
  // the sand: some of the status token stays in every green fragment.
  assert.ok(fac < 1, `the shipped factor ${fac} would REPLACE the status colour`);
  // ⚠ AND THE LADDER IT WAS PICKED FROM IS NAMED BESIDE IT, so a scale-back is one edit against
  // frames already rendered (ADR-0503 D3) rather than a re-measurement.
  assert.match(src, /chapter2-ground-parity-2026-09-03/, 'the constant must cite the ladder it was chosen from');
});

test('the shipped ground WEARS THE OCCLUSION FIELD — unconditionally, item 6 again', () => {
  // The fourth component of the approved treatment to cross (2026-08-30), and the one the owner
  // asked for by name: "i'm still hoping for future iterations to ... add shadows". Same fence as
  // the three before it — no prop, no default-off, no flag nobody flips (end-state item 6).
  const src = readFileSync(SHIPPED, 'utf8');
  // ⚠⚠ AND IT IS PACKED OVER THE ISLANDS RATHER THAN OVER THE GROUND'S RECT since 2026-08-31.
  // The rect form clamped a real thirty-five-island forest from the authored 3.000 samples per
  // ground unit to 0.585, so the contact pool under a story tree lost 5.5% of its area and 15.3%
  // of its pixels moved — precisely when the map became the real map. Same fence as before: no
  // prop, no default-off. Costing of all three remedies:
  // `docs/research/chapter2-shipped-shadow-2026-08-31/`.
  assert.match(src, /buildAtlasOcclusion\(\{ cells, relief: LAND_RELIEF_AMPLITUDE, casters, penumbra, contactBand, contactSpread \}\)/);
  assert.match(src, /groundAtlasTexture\(/, 'the field must be uploaded, not merely computed');
  assert.match(src, /if \(shadow !== null\) opts\.shadowAtlas = shadow;/);
  // ⚠⚠ AND THE MESH MUST CARRY THE TILE CORNER, or every island reads the atlas's top-left tile
  // and wears some other island's shadow while looking entirely ordinary. It is the one failure
  // mode of the packed form that looks like art rather than like a bug.
  assert.match(src, /input\.atlasOrigin = atlasOriginResolver\(field\)/);
  assert.match(src, /attributes-\$\{GROUND_ATLAS_ATTRIBUTE\}/, 'the corner must reach the GPU');
  // ⚠ THE ONLY THING THAT MAY WITHHOLD IT IS AN ISLAND THAT BOUNDS NOTHING. Any other guard —
  // a prop, an env read, a `showShadows` default — would be the flag nobody flips.
  assert.match(src, /if \(groundBounds\(cells\) === null\) return null;/);
  assert.ok(
    !/showShadows|shadows\s*=\s*false|shadow\?:\s*boolean/.test(src),
    'a shadow behind a prop is not adoption',
  );
  // And the casters are derived from the WHOLE descriptor set, so a cave portal casts too. ⚠ THAT
  // HALF MOVED on 2026-09-15 and is now DRIVEN rather than parsed, in
  // `src/ground-dependency.test.ts` ('ONE PLACEMENT, TWO READERS'): the four lists the ground is
  // built from are made in `ground-dependency.ts`, and a source parse over that file cannot live
  // here — `check:mutation-diff` instruments it, so the parse would read Stryker's rewritten text
  // and fail every run. A claim about a file the rung mutates has to be a behaviour.
});

test('THE KIT CASTS: one placement, made before the ground, read by the casters AND by KitProps', () => {
  // ⚠⚠ THE HAZARD THIS PINS. Until 2026-09-03 `KitProps` computed its own placement from the
  // LOADED kit — asynchronously, after the ground had been built — so no kit object could reach
  // the occlusion field and every pine and bloom floated over a ground shaded by the story tree
  // alone. The remedy is structural: ONE `placements` value, made synchronously off the frozen
  // footprints in the canvas, spread into the casters AND handed to `KitProps`. A canvas that
  // computed it twice would have a tree and its shadow as two lists that agree today.
  const src = readFileSync(SHIPPED, 'utf8');
  // ⚠ THE DERIVATION MOVED ON 2026-09-15 AND THE INVARIANT DID NOT. `ground-dependency.ts` now
  // makes these four lists together, so that the ground is re-derived on its own CONTENT rather
  // than on the descriptor array's identity — which is what stopped the studio rebuilding the whole
  // ground on every poll. The two halves of the rule that live THERE are driven in
  // `src/ground-dependency.test.ts` ('ONE PLACEMENT, TWO READERS') rather than parsed here, because
  // `check:mutation-diff` instruments that file and a parse would read Stryker's text. What is
  // still this file's to read is the CANVAS side: the frozen tables it derives against, and the one
  // list reaching `KitProps`.
  assert.match(
    src,
    /const SHIPPED_GROUND_INPUT: GroundInputOptions = \{\s*relief: LAND_RELIEF_AMPLITUDE,\s*footprint: KIT_FOOTPRINTS_2026_08_29,\s*height: KIT_HEIGHTS_2026_08_29,\s*\}/,
    'and the frozen tables it is derived against are still the canvas’s own shipped pick',
  );
  assert.match(src, /<KitProps\b[^>]*\bplacements=\{ground\.placements\}[^>]*\/>/, 'and KitProps draws that same list');
  assert.ok(
    !/useMemo\(\(\) => groundCasters\(descriptors\), \[descriptors\]\)/.test(src),
    'groundCasters(descriptors) alone is no longer the whole caster list',
  );
  assert.ok(
    !/dressMapWithCover\(|placementCasters\(/.test(src),
    'the canvas must not make a SECOND placement or caster list beside the derived one',
  );
  // ⚠ THE CANVAS STANDS THE TOP LAYER, and the other entry point is a strictly smaller map.
  // `dressMapFromKit` is the vocabulary alone; on this line it would be the shipped map quietly
  // reverting the ground cover while every other assertion here still passed. (A third entry
  // point, `dressMapWithGroves`, sat between them until ADR-0518 retired the grove; the canvas
  // must not reach a grove by any name.)
  assert.ok(!/dressMapFromKit\(/.test(src), 'the canvas must stand the covered dressing');
  assert.ok(!/dressMapWithGroves\(|dressGroves|grove-history|grove-dressing/.test(src), 'the canvas must stand no grove (ADR-0518)');
  // KitProps computes NO placement of its own — it draws what it is handed.
  const kitProps = src.slice(...regionOf(src, 'function KitProps(', 'function TrailStrip('));
  assert.ok(!/dressMap|dressIsland/.test(kitProps), 'KitProps must not dress the map a second time');
  assert.ok(!/footprint: roleFootprints/.test(src), 'no placement may be made from the LOADED kit’s footprints');
  // And the loaded kit is still held to the frozen tables, loudly, where it is loaded.
  assert.match(kitProps, /footprintDriftOf\(roleFootprints\(loaded\)\)/);
  assert.match(kitProps, /heightDriftOf\(roleHeights\(loaded\)\)/);
  assert.match(kitProps, /kitMeshes\(loaded, placements(?:,|\))/);
});

test('⚠⚠ THE PLACEHOLDER STORY TREE IS GONE FROM THE SHIPPED CANVAS — the mesh AND its caster', () => {
  // ADR-0508, the owner: "under this new look the center tree will no longer be a thing, each
  // island will be a small grove or forest". The mesh and the caster go together — a shadow with
  // nothing casting it is the misreport `ground-casters.ts` exists to prevent — so both halves are
  // asserted here, against the shipped file itself.
  const src = readFileSync(SHIPPED, 'utf8');
  const code = codeOf(src);
  assert.ok(!/function StoryTree/.test(code), 'the StoryTree component must not return');
  assert.ok(!/<StoryTree/.test(code), 'nothing mounts a StoryTree');
  assert.ok(!/STORY_TREE_(TRUNK|CROWN)/.test(code), 'the trunk/crown constants must not come back');
  assert.ok(!/crownColourOf/.test(code), 'and nothing resolves a crown colour for a cone that is gone');
  // The caster half, at the source of the caster list rather than by reading a rendered frame:
  // whatever `shippedGroundBuild` is handed, no term of it may be derived from a story tree.
  assert.ok(!/storyTreeCaster|storyTreeTop/.test(code), 'no story-tree caster may enter the ground build');
  // ⚠ BUT `CROWN_COLOUR` ITSELF MUST SURVIVE, and it is asserted here beside its resolver's absence
  // so the pair is read as one decision. The table is the canvas's transcription of the app's
  // authored `--crown-<status>-lo` tokens; `check:palette-transcription` parses it OUT OF THIS FILE
  // and `src/leaf-tint.test.ts` pins the kit's `mapped` leaf tint to it. Deleting it as dead code —
  // which it now looks like, since nothing in the file references it — reds a gate rung in every
  // scope. The 2D maps still draw a crown; only the 3D cone is gone.
  //
  // ⚠ THE IDENTIFIER, NOT THE LITERAL, for the instrumentation reason given below — and this is
  // deliberately the WEAKER of the two guards on the table. The strong one is `src/leaf-tint.
  // test.ts`, which PARSES the map out of this file, floors it at six entries and proves the
  // parse can fail; that is what would red if the table were emptied rather than deleted. This
  // assertion's job is only to sit beside `crownColourOf`'s absence, so the pair reads as one
  // decision: the resolver went, the vocabulary stayed.
  assert.ok(/\bCROWN_COLOUR\b/.test(code), 'the crown vocabulary must survive its resolver');

  // ⚠ AND THE FAMILY IS RETIRED AT THE MAPPER, WHICH IS THE STRONGER PROPERTY. A canvas that
  // simply stopped DRAWING an emitted descriptor would still let `groundCasters` darken the ground
  // under an object nobody can see — the exact shape this assertion pair exists to forbid.
  //
  // ⚠⚠ ASSERTED AS BEHAVIOUR RATHER THAN AS SOURCE TEXT, and the reason is a trap worth knowing:
  // this was `assert.match(mapperSource, /case 'tree':\s*out\.push\(\{ kind: 'skipped' … \}\)/)`,
  // which passed under `bun test` and FAILED the mutation rung's dry run. `check:mutation-diff`
  // copies the tree into a Stryker sandbox and INSTRUMENTS the changed line spans — wrapping the
  // very statements a diff-scoped rung selects — so a source-text regex that matches a span this
  // branch touched cannot survive it. The negatives above are unaffected (instrumentation never
  // ADDS a `StoryTree`); a verbatim positive over changed code is the shape that breaks.
  const ds = worldTo3D(islandScene());
  assert.ok(!ds.some((d) => String(d.kind) === 'story-tree'), 'the mapper emits no story-tree');
  assert.ok(
    ds.some((d) => d.kind === 'skipped' && d.sceneKind === 'tree'),
    'and it records the tree group as a SKIP rather than dropping it',
  );

  // ⚠⚠ NON-VACUITY, AND IT IS LOAD-BEARING HERE RATHER THAN DECORATIVE: five of the six assertions
  // above are NEGATIVE, and a negative regex over a file passes just as well when the file failed
  // to load, when the path moved, when the pattern was mistyped — or when `codeOf` ate the whole
  // file. Each of the three below closes one of those.
  assert.match(code, /function CellGround/, 'the shipped canvas was read, and codeOf left its code');
  assert.ok(/function StoryTree/.test(codeOf('function StoryTree({ tree }) {')), 'the pattern still matches code');
  assert.ok(!/function StoryTree/.test(codeOf('// function StoryTree stood here')), 'and codeOf really strips');
  assert.throws(
    () => regionOf(src, 'function CellGround', 'function StoryTree'),
    /re-anchor this slice/,
    'a missing anchor must REFUSE rather than silently slice the rest of the file',
  );
});

test('a WISP casts nothing on the shipped map, and the canvas does not decide that for itself', () => {
  // The rule lives in `src/ground-casters.ts` (and its own test), not in a filter written here: a
  // wisp is the live-work signal, so a shadow that appeared and vanished with a session's claim
  // would be the LAND appearing to change under work that never touched it.
  const src = readFileSync(SHIPPED, 'utf8');
  assert.ok(!/wisp[^\n]*caster/i.test(src), 'the canvas must not build casters from wisps');
  // ⚠ AND THE DERIVATION MUST NOT EITHER, since 2026-09-15 — the canvas mounts the caster list, it
  // no longer makes it. That half is DRIVEN in `src/ground-dependency.test.ts` ('THE EXCLUSION IS
  // JUSTIFIED'), which hands the real reader a map with and without wisps and refuses any
  // difference — strictly stronger than this parse, and the only form available over a file
  // `check:mutation-diff` instruments.
});

test('the ramp ROWS and the ramp TOKENS come off ONE map, in one order', () => {
  // ⚠ THE FAILURE THIS FORBIDS IS THE WORST ONE THIS SURFACE HAS. A geometry indexing one order
  // and a material uploading another paints every parcel with a DIFFERENT status's colour —
  // wrong, plausible, and undetectable by eye. Both are derived from `GROUND_COLOUR` here, so
  // the two orders are the same object rather than two lists that agree today.
  const src = readFileSync(SHIPPED, 'utf8');
  // ⚠⚠ THE RAMP MAY NOW CARRY MORE ROWS THAN THERE ARE STATUSES, and this assertion was widened
  // for it rather than around it (2026-09-01, the stepped skirt). The rock the cliff wears is a
  // family-less token — it reports nothing, which is what the owner settled — so it is a seventh
  // ROW without being a seventh STATE. What must not move is where the statuses sit, so the pin is
  // now on the PREFIX: `GROUND_COLOUR.values()` must open the list, and anything else must follow
  // it. That is strictly stronger than the old exact-match, because the old one had nothing to say
  // about a token added in the wrong place — it simply forbade adding one at all, which is a
  // different and now-false claim.
  assert.match(src, /GROUND_TOKENS[^=]*=\s*\[\s*\.\.\.GROUND_COLOUR\.values\(\)(,[^\]]*)?\]/);
  assert.ok(
    !/GROUND_TOKENS[^=]*=\s*\[[^\]]+,\s*\.\.\.GROUND_COLOUR\.values\(\)/.test(src),
    'a token PREPENDED to the ramp renumbers every status: row 0 stops being `healthy` and every ' +
      'parcel on the map is painted a different status’s colour',
  );
  // And an appended row's own index is DERIVED from the list rather than written down. A literal
  // `6` here would be a second place the ordering lives, free to disagree with the first the next
  // time a status is added — and the disagreement draws as rock-coloured ground.
  //
  // ⚠⚠ TWO ROCK ROWS SINCE 2026-09-01, AND THE PIN MOVED WITH THEM RATHER THAN BEING
  // DROPPED. This read `SKIRT_ROCK_ROW = GROUND_TOKENS.length - 1` and went red when the second
  // token landed, which is the check doing its job: a source-text assertion that survives a rename
  // by being loosened until it matches anything has stopped asking its question. Both rows are
  // pinned, both relative to the END, and a literal is refused outright below — so this is
  // strictly stronger than the single-row form it replaces.
  assert.match(src, /SKIRT_ROCK_LIT_ROW\s*=\s*GROUND_TOKENS\.length - 2/);
  assert.match(src, /SKIRT_ROCK_SHADED_ROW\s*=\s*GROUND_TOKENS\.length - 1/);
  for (const row of ['SKIRT_ROCK_LIT_ROW', 'SKIRT_ROCK_SHADED_ROW']) {
    assert.ok(
      !new RegExp(`${row}\\s*=\\s*\\d`).test(src),
      `${row} is written as a literal. The ramp's order would then live in two places, free to ` +
        'disagree the next time a status is added — and the disagreement draws as ground painted ' +
        'the cliff’s colour.',
    );
    assert.ok(src.includes(`row: ${row}`), `${row} is derived but never handed to the geometry`);
  }
  assert.match(src, /GROUND_ROWS[^=]*=[\s\S]{0,120}\[\.\.\.GROUND_COLOUR\.keys\(\)\]/);
  assert.match(src, /BandedGroundMaterialOptions = \{ tokens: GROUND_TOKENS[,}]/);
  assert.match(src, /createBandedGroundMaterial\(opts\)/);
  // An unrecognised material falls back to `unknown`'s ROW exactly as it falls back to
  // `unknown`'s COLOUR — the one state that means "no data". Any other fallback would have the
  // map assert something about work it could not classify, in the form hardest to notice.
  assert.match(src, /GROUND_ROWS\.get\(material \?\? UNKNOWN_STATUS\) \?\? GROUND_ROWS\.get\(UNKNOWN_STATUS\)!/);
});

test('trails are UNDRAWN by default, and the shipped file says so', () => {
  const src = readFileSync(SHIPPED, 'utf8');
  assert.match(src, /showTrails\s*=\s*false/, 'the default that makes trail-strip undrawn');
  assert.ok(SHIPPED_UNDRAWN.some((u) => u.kind === 'trail-strip'));
  assert.ok(SHIPPED_UNDRAWN.some((u) => u.kind === 'trail-ghost-strip'));
});

test('every primitive names the shipped file it was read off', () => {
  for (const p of SHIPPED_PRIMITIVES) {
    assert.match(p.source, /^ForestWorldCanvas\.tsx:\d+$/, `${p.kind} must cite its source line`);
    assert.ok(p.triangles > 0, `${p.kind} must carry a real count`);
  }
});

/* ── ⚠⚠ THE FINDING THIS BASELINE EXISTED FOR — AND ITS FIX ─────────────────────────────────
   ⚠ READ THE HISTORY BEFORE CHANGING THESE. As of PR #1679 (2026-08-28) the shipped canvas's
   ground case keyed on a scene node of kind `tile` (the CLASSIC extruded-hex ground) only. The
   substrate the studio actually ships is the RELAXED MESH (`scene.ts:658`), whose ground arrives
   as `cell` nodes — and the mapper had no case for those, so they fell to the default skip.
   Measured on an RTX 2060 that day: for an island of the shape the studio ships,
   `<ForestWorldCanvas>` drew NO GROUND AT ALL. One story tree, 144 triangles, two draw calls.

   `the-shipped-map-draws-its-ground-again` closed that gap by teaching the mapper the `cell` /
   `cell-wheat` representation. The tests below now pin the FIX, and the ORIGINAL numbers are
   kept in `BEFORE_THE_CELL_CASE` so the size of the change stays checkable rather than
   remembered — a before/after that only lives in a report is one nobody can re-run.

   THREE tests, and none is sufficient alone. The first says the ground arrives. The second WAS
   the non-vacuity control — the SAME mapper on the classic substrate still drew its hexes, so the
   fix ADDED a representation rather than swapping one for another — until `retire-the-old-land-
   path` retired the classic substrate itself; it is now the refusal test below, proving the same
   non-swap property the OTHER direction: the classic call still reaches real mapper code (through
   the real core, not a hand-built `SceneG`), and what that code now does is refuse loudly rather
   than emit nothing. The third says nothing falls through to a skip any more, which is what the
   original finding actually was.
   ────────────────────────────────────────────────────────────────────────────────────────── */


test('the shipped mapper NOW draws the mesh substrate the studio ships', () => {
  const ds = worldTo3D(islandScene());
  const cells = ds.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
  assert.equal(
    cells.length,
    BEFORE_THE_CELL_CASE.skippedCells,
    'every parcel that used to be skipped should now be a drawable',
  );
  // Each one carries a ring it is possible to build a face from, and a status to colour it by.
  for (const c of cells) {
    assert.ok((c.points?.length ?? 0) >= 3, 'a parcel needs a ring');
    assert.equal(typeof c.material, 'string', 'a parcel needs a status');
  }
});

test('NON-VACUITY, RETIRED DIRECTION: the classic substrate REFUSES through the REAL core, not merely a hand-built scene', () => {
  // ⚠⚠ THE MESSAGE IS PINNED IN FULL — same reason as `world-to-3d.test.ts`'s dedicated refusal
  // test: a `tile` group is a kind this mapper understands and used to draw, so a mutant that
  // softened the refusal back into a silent skip would reproduce the exact 2026-08-28 defect
  // (`BEFORE_THE_CELL_CASE`, above) with nothing anywhere to say so.
  //
  // What THIS test adds beyond that one is the real core: `classicHexScene` round-trips
  // `buildScene` exactly the way `islandScene()` above does for the mesh substrate, so the
  // refusal is proven against a scene graph the real `@storytree/forest-world` package produced —
  // not only against a hand-built `SceneG` literal a reader might suspect the mapper special-cases.
  const scene = classicHexScene(buildScene as never, hexCentre) as SceneG;
  assert.throws(
    () => worldTo3D(scene),
    (err: unknown) =>
      err instanceof Error &&
      err.message ===
        'world-to-3d: the 3D map draws the relaxed-mesh land only — the classic extruded-hex ' +
          'ground was retired (adopt-the-land-into-the-shipped-map-arc, retire-the-old-land-path); ' +
          'build the scene with relaxedCells, not drawTiles',
  );
});

test('no ground cell falls through to a skip any more — the original finding, inverted', () => {
  const ds = worldTo3D(islandScene());
  const skippedCells = ds.filter((d) => d.kind === 'skipped' && (d.sceneKind === 'cell' || d.sceneKind === 'cell-wheat'));
  assert.equal(skippedCells.length, 0, `${skippedCells.length} ground cells are still being skipped`);
});

test('a parcel wears its territory status, which the cell itself does not carry', () => {
  // ⚠ THE INHERITANCE IS THE LOAD-BEARING PART. On the relaxed mesh a plain `cell` has no status
  // of its own — the core puts it on the `<g kind="ground" status=…>` above it (`scene.ts:3252`
  // vs `:3254`). Read the cell alone and every parcel draws `unknown`, which is a map that has
  // stopped REPORTING (ADR-0392 D5 / ADR-0398 D7) rather than one that merely looks wrong. So a
  // test that only counted parcels would pass on exactly the version that lies.
  const ds = worldTo3D(islandScene());
  const materials = new Set(
    ds.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground').map((d) => d.material),
  );
  assert.ok(materials.size > 0, 'no parcels at all');
  assert.ok(!materials.has('unknown'), 'a parcel fell back to `unknown` — the status did not reach it');
});

test('the shipped canvas costs what the authored count says — parcels included', () => {
  // ⚠ THE PARCEL TOTAL MUST BE PASSED IN, and this test is where that is enforced. Calling
  // `authoredTriangles(census)` alone still returns a number, and before the `cell` case existed
  // that number was RIGHT — 144, the story tree alone. It is now an undercount by the entire
  // ground, and it would go on being reported with the same calm authority. So the assertion is
  // that the two forms DISAGREE, which is the only way a defaulted argument can be held to
  // being supplied.
  //
  // ⚠⚠ AND THE UNDERCOUNT IS NOW TOTAL RATHER THAN PARTIAL, which makes the trap WORSE and not
  // better. Until 2026-09-04 the census-only form at least returned the tree's 144 — a wrong
  // number, but an obviously non-zero one. `StoryTree` is retired (ADR-0508) and this fixture
  // stands no portal and no wisp, so every remaining `SHIPPED_PRIMITIVES` row scores zero on it
  // and the census-only form now returns a confident, plausible-looking ZERO for an island of 164
  // parcels. That is why the assertion below is `whole > withoutTheGround` rather than a literal.
  const ds = worldTo3D(islandScene());
  const c: Record<string, number> = {};
  for (const d of ds) c[d.kind] = (c[d.kind] ?? 0) + 1;

  const parcelTriangles = cellGroundTrianglesFor(ds);
  assert.ok(parcelTriangles > 0, 'the fixture draws no parcels — the fixture, not the count, is wrong');

  const withoutTheGround = authoredTriangles(c).triangles;
  assert.equal(withoutTheGround, 0, 'this fixture stands no hand-built primitive at all any more');
  assert.notEqual(
    withoutTheGround,
    BEFORE_THE_CELL_CASE.triangles,
    'the retired story tree is still being charged for',
  );

  const whole = authoredTriangles(c, parcelTriangles).triangles;
  assert.equal(whole, withoutTheGround + parcelTriangles);
  assert.ok(whole > withoutTheGround, 'the ground contributed nothing — the parcel total was dropped');

  // And the per-kind breakdown names the parcels rather than folding them into a total.
  const row = authoredTriangles(c, parcelTriangles).byKind.find((k) => k.kind === 'cell-ground');
  assert.ok(row, 'cell-ground must appear in the breakdown');
  assert.equal(row.drawables, BEFORE_THE_CELL_CASE.skippedCells);
  assert.equal(row.triangles, parcelTriangles);
});

test('EVERY parcel of the shipped substrate is a QUADRILATERAL — recorded, not assumed', () => {
  // ⚠ Worth knowing before sizing anything on this geometry: `buildRelaxedCells` produces
  // four-vertex parcels uniformly — 164 of them, all rings of 4. It is the same figure the
  // harness records from the other side ("164 cells x 4-pt fan"), reached independently here.
  // It is a property of TODAY'S generator, not a guarantee, which is why the triangle total is
  // still summed per ring rather than shortcut to `164 * 10`.
  const ds = worldTo3D(islandScene());
  const rings = ds
    .filter((d): d is InstanceDescriptor => d.kind === 'cell-ground')
    .map((d) => d.points?.length ?? 0);
  assert.deepEqual([...new Set(rings)], [4]);
  assert.equal(rings.length, BEFORE_THE_CELL_CASE.skippedCells);
  assert.equal(cellGroundTrianglesFor(ds), rings.length * cellGroundTriangles(4));
});

test('the parcel total reads each ring’s OWN length, not the quad the fixture happens to be', () => {
  // ⚠ A CLAIM THIS TEST WAS FIRST WRITTEN TO MAKE IS FALSE, and it is recorded rather than
  // quietly dropped. `cellGroundTriangles` is AFFINE in the ring length (3n - 2), so a
  // count-times-MEAN estimate is not an approximation at all — it is exactly equal, and an
  // implementation that averaged would pass every check here. The real hazard is narrower and
  // this is what the test now pins: a ring length ASSUMED to be 4, which is what today's
  // generator uniformly produces (above) and what a reader sizing this geometry would most
  // naturally hardcode. `baseline-measure.mjs` refuses a run in which the authored and GL counts
  // differ by ANY amount, so on a future non-quad island that assumption is a refused run.
  const ring = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      x: Math.cos((i / n) * Math.PI * 2) * 10,
      y: 0,
      z: Math.sin((i / n) * Math.PI * 2) * 10,
    }));
  const mixed: Descriptor3D[] = [3, 4, 9].map((n) => ({
    kind: 'cell-ground' as const,
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    material: 'healthy',
    points: ring(n),
  }));
  const summed = cellGroundTriangles(3) + cellGroundTriangles(4) + cellGroundTriangles(9);
  assert.equal(cellGroundTrianglesFor(mixed), summed);
  // What an implementation that assumed the fixture's quad would report, shown to differ.
  assert.notEqual(summed, mixed.length * cellGroundTriangles(4));
});

/* ── ⚠⚠ FENCE 4 — THE PROJECTION, GUARDED AT SOURCE ──────────────────────────────────────────
   ADR-0380 D6 fence 4: the game stays 2.5D isometric — no free camera, no orbit control, no
   perspective view. The shipped canvas violated all three from the day the spike authored it
   until 2026-08-28, and the violation survived for one reason: nothing ever asked.

   ⚠ THIS IS THE CHEAP HALF, AND IT IS NOT THE ONE THAT MATTERS. `baseline-measure.mjs` asks the
   real question — it classifies the projection matrix the driver was actually GIVEN, and refuses
   a run where any shipped mount uploaded something that is not orthographic. What these three
   tests add is that the refusal cannot be reached by accident on a machine with no GPU: they run
   under `pnpm -r test`, credential-free and headless, and they fail on the exact edit that would
   quietly restore the old projection.

   ⚠ `fov` IS TESTED FOR ABSENCE ON PURPOSE. R3F reads the PRESENCE of a `fov` prop as a request
   for a PerspectiveCamera, so `<Canvas orthographic camera={{ fov: 45, … }}>` is a canvas that
   LOOKS compliant, reads compliant in review, and is not. Asserting `orthographic` alone would
   pass on it. */
test('FENCE 4: the shipped canvas declares an ORTHOGRAPHIC projection', () => {
  const src = readFileSync(SHIPPED, 'utf8');
  assert.match(src, /<Canvas\s+orthographic\b/, 'the Canvas must be declared orthographic');
});

test('FENCE 4: no `fov` survives anywhere in the shipped file', () => {
  const src = readFileSync(SHIPPED, 'utf8');
  // Comments are allowed to discuss the retired camera — the file explains why the framing
  // constant exists — so only a PROP assignment is refused.
  assert.doesNotMatch(
    src,
    /(^|[^\w])fov\s*:/,
    'a `fov` prop makes R3F build a PerspectiveCamera regardless of the `orthographic` flag',
  );
});

test('FENCE 4: the orbit control cannot rotate', () => {
  const src = readFileSync(SHIPPED, 'utf8');
  assert.match(
    src,
    /<MapControls[^>]*enableRotate=\{false\}/s,
    'an orthographic camera the viewer can still swing around is still a free camera',
  );
});

/* ⚠ AND THE ZOOM, WHICH THE FENCE DOES NOT TOUCH AND A REMEDY COULD EASILY HAVE TAKEN. The owner
   affirmed zoom explicitly (2026-08-22) and ADR-0415 D1 made it a standing constraint; the fence
   names the PROJECTION and the free ROTATION, never the ability to get closer. Two ways a later
   edit could remove it by accident, so both are refused: turning the control's zoom off, and
   turning off `MapControls` panning while at it. */
test('ZOOM AND PAN SURVIVE THE FENCE — neither is disabled', () => {
  const src = readFileSync(SHIPPED, 'utf8');
  assert.doesNotMatch(src, /enableZoom=\{false\}/, 'zoom is not what fence 4 forbids');
  assert.doesNotMatch(src, /enablePan=\{false\}/, 'panning is not what fence 4 forbids');
});
