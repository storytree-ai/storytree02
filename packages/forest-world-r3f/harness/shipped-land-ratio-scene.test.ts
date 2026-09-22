// shipped-land-ratio-scene.test.ts — the land-ratio page's own arithmetic, without a GPU.
//
// ⚠ THE PICTURES ON THAT PAGE ARE FOR THE OWNER'S EYE; what a test can hold is that the arms are
// the SHIPPED composition with the ratio (and, on the cover rungs, the count) as the only thing
// moving; that every land arm's centre island holds EXACTLY its rung's units² per capability; that
// one tree per capability stands on every arm and nothing else tree-shaped (ADR-0518 D1/D4); that
// the control is the map as it shipped after #1825 (the drawing's size, the previous recipe basis,
// the count rung that shipped); that the forest's layout holds still between the control and every
// rung while the compact picture's does not; and that every arm is judged from the signed camera.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { SHIPPED_ELEVATION_DEG, shippedElevationDeg } from '../src/camera-framing.js';
import { COVER_DENSITY } from '../src/cover-dressing.js';
import { RECIPE_ISLAND_AREA } from '../src/dressing-ground.js';
import { RENDER_ELEV_DEG, isDressingRole } from '../src/kit-vocabulary.js';
import {
  LAND_AREA_PER_CAPABILITY,
  LAND_AREA_PER_CAPABILITY_RUNGS,
  LAND_SCALE,
  TUNED_LAND_AREA_PER_CAPABILITY,
  islandLand,
} from '../src/land-per-capability.js';
import { islandCentres } from '../src/true-footprint.js';
import { groundSanity } from './ground-sanity.js';
import { orientedCamera } from './shipped-crowd-scene.js';
import {
  CONTROL_ARM,
  COVER_ARMS,
  COVER_LADDER,
  LAND_ARMS,
  LAND_LADDER,
  LAND_RATIO_ARMS,
  LAND_RATIO_PICTURES,
  PREVIOUS_COVER_DENSITY,
  PREVIOUS_RECIPE_ISLAND_AREA,
  SHIPPED_ARM,
  armCaption,
  armCasters,
  armDescriptors,
  armGroundBuild,
  armIsland,
  armPlacements,
  armSpec,
  cameraAgreement,
  cameraElevationDeg,
  centreIslandLand,
  coverArmId,
  countsCaption,
  dressingCounts,
  fitPxPerUnitFor,
  groundDepth,
  islandDepth,
  landArmId,
  neighbourArm,
  picture,
  picturesAt,
  screenExtent,
} from './shipped-land-ratio-scene.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const source = (rel: string): string => readFileSync(join(HERE, rel), 'utf8');

const ONE = picture('one');
const FOREST = picture('forest');
const COMPACT = picture('forest-compact');

test('⚠⚠ every arm is judged from the signed 50° — read off frameWorld through the crowd camera, never typed here', () => {
  groundSanity();
  assert.deepEqual(cameraAgreement(), []);
  assert.equal(SHIPPED_ELEVATION_DEG, RENDER_ELEV_DEG);
  assert.equal(RENDER_ELEV_DEG, 50);
  assert.ok(Math.abs(shippedElevationDeg() - 50) < 1e-9);
  assert.ok(Math.abs(cameraElevationDeg(orientedCamera({ x: 0, z: 0 }, 1)) - 50) < 1e-9);
  const page = source('shipped-land-ratio-scene.ts');
  assert.ok(!/elevationDeg: 50\b/.test(page), 'the shipped elevation is derived, never typed');
  assert.ok(!/grove-history|dressGroves|stretchAboutIslands/.test(page), 'no grove and no re-projection reach this page');
});

test('the arms: the control first, then the declared land ladder descending, then the cover rungs at the shipped land; the shipped arm is the shipped rung', () => {
  assert.deepEqual([...LAND_LADDER], [...LAND_AREA_PER_CAPABILITY_RUNGS]);
  assert.deepEqual(LAND_ARMS, LAND_LADDER.map(landArmId));
  assert.equal(LAND_RATIO_ARMS[0]!.id, CONTROL_ARM);
  assert.deepEqual(
    LAND_RATIO_ARMS.map((a) => a.id),
    [CONTROL_ARM, ...LAND_ARMS, ...COVER_ARMS],
  );
  assert.equal(SHIPPED_ARM, landArmId(LAND_AREA_PER_CAPABILITY));
  assert.ok(LAND_ARMS.includes(SHIPPED_ARM), 'the shipped ratio is a rendered rung');
  // The cover rungs: every declared rung except the shipped one, which the land arm already is.
  assert.deepEqual(COVER_ARMS, COVER_LADDER.filter((d) => d !== COVER_DENSITY).map(coverArmId));
  assert.ok(COVER_LADDER.includes(COVER_DENSITY), 'the shipped cover rung is on the ladder');
  for (const arm of COVER_ARMS) {
    const spec = armSpec(arm);
    assert.equal(spec.areaPerCapability, LAND_AREA_PER_CAPABILITY);
    assert.equal(spec.recipeIslandArea, RECIPE_ISLAND_AREA);
    assert.equal(spec.ladder, 'cover');
  }
  for (const arm of LAND_ARMS) {
    const spec = armSpec(arm);
    assert.equal(spec.coverDensity, COVER_DENSITY, 'a land arm wears the shipped cover rung');
    assert.equal(spec.recipeIslandArea, RECIPE_ISLAND_AREA);
  }
  assert.throws(() => armSpec('land-1'), /no arm/);
  for (const arm of LAND_RATIO_ARMS) assert.ok(armCaption(arm.id).length > 40);
  assert.match(armCaption(SHIPPED_ARM), /SHIPPED PICK/);
  assert.match(armCaption(CONTROL_ARM), /CONTROL/);
});

test('⚠⚠ the control is the map AS IT SHIPPED after #1825: the drawing’s own size, the previous recipe basis, the count rung that shipped', () => {
  const spec = armSpec(CONTROL_ARM);
  assert.equal(spec.areaPerCapability, null);
  assert.equal(spec.coverDensity, PREVIOUS_COVER_DENSITY);
  assert.equal(PREVIOUS_COVER_DENSITY, 3);
  assert.equal(spec.recipeIslandArea, PREVIOUS_RECIPE_ISLAND_AREA);
  assert.ok(Math.abs(PREVIOUS_RECIPE_ISLAND_AREA - 24631.8) / 24631.8 < 0.001, `${PREVIOUS_RECIPE_ISLAND_AREA} — the recipe island as drawn`);
  assert.ok(Math.abs(PREVIOUS_RECIPE_ISLAND_AREA - RECIPE_ISLAND_AREA / (LAND_SCALE * LAND_SCALE)) < 1e-6);
  const land = centreIslandLand(armIsland(CONTROL_ARM));
  assert.equal(land.capabilities, 11);
  assert.ok(Math.abs(land.unitsPerCapability - TUNED_LAND_AREA_PER_CAPABILITY) < 1, `${land.unitsPerCapability} against the tuned ${TUNED_LAND_AREA_PER_CAPABILITY}`);
  const counts = dressingCounts(armPlacements(CONTROL_ARM, ONE), armDescriptors(CONTROL_ARM, ONE));
  assert.equal(counts.capabilityTrees, 11);
  // The cover the map stood: the recipe's 216 × 3 on the fixture island, to rounding.
  assert.ok(counts.cover >= 640 && counts.cover <= 660, `${counts.cover} cover on the control`);
});

test('⚠⚠ THE RATIO IS EXACT: every land arm’s island holds capabilities × its rung, isotropically, about the same centre; the ladder descends', () => {
  const control = armIsland(CONTROL_ARM);
  const c0 = [...islandCentres(control).values()][0]!;
  const d0 = groundDepth(control);
  let last = Infinity;
  for (const arm of LAND_ARMS) {
    const spec = armSpec(arm);
    const island = armIsland(arm);
    const land = centreIslandLand(island);
    assert.equal(land.capabilities, 11);
    assert.ok(Math.abs(land.landArea - 11 * (spec.areaPerCapability as number)) < 1e-6, `${arm}: ${land.landArea}`);
    assert.ok(Math.abs(land.unitsPerCapability - (spec.areaPerCapability as number)) < 1e-9);
    assert.ok(land.unitsPerCapability < last, 'the ladder descends');
    last = land.unitsPerCapability;
    const c = [...islandCentres(island).values()][0]!;
    assert.ok(Math.abs(c.x - c0.x) < 1e-9 && Math.abs(c.z - c0.z) < 1e-9, `${arm} moved the island's centre`);
    const d = groundDepth(island);
    const f = Math.sqrt(land.landArea / centreIslandLand(control).landArea);
    assert.ok(Math.abs(d.w - d0.w * f) < 1e-6 && Math.abs(d.d - d0.d * f) < 1e-6, `${arm} is not the drawn island scaled by ${f}`);
  }
  // Two arms at one ratio are ONE island stream.
  assert.strictEqual(armIsland(SHIPPED_ARM), armIsland(COVER_ARMS[0]!));
  assert.strictEqual(armDescriptors(SHIPPED_ARM, ONE), armDescriptors(COVER_ARMS[0]!, ONE));
});

test('⚠⚠ ONE TREE PER CAPABILITY ON EVERY ARM, and nothing else tree-shaped (ADR-0518 D1/D4) — one island and the forest', () => {
  groundSanity();
  for (const arm of LAND_RATIO_ARMS) {
    for (const pic of [ONE, FOREST]) {
      const placements = armPlacements(arm.id, pic);
      const stream = armDescriptors(arm.id, pic);
      const counts = dressingCounts(placements, stream);
      // `unknown` grows nothing (`kit-vocabulary.ts`): a capability whose island's state the map
      // does not know stands no tree, so the count is the capabilities on every OTHER island.
      const unknown = new Set(stream.filter((d) => d.kind === 'cell-ground' && d.material === 'unknown').map((d) => d.island));
      let capabilities = 0;
      for (const l of islandLand(stream).values()) if (!unknown.has(l.island)) capabilities += l.capabilities;
      assert.equal(counts.capabilityTrees, capabilities, `${arm.id} at ${pic.id}: ${counts.capabilityTrees} trees on ${capabilities} capabilities`);
      assert.equal(counts.placements, counts.capabilityTrees + counts.blooms + counts.cover);
      for (const p of placements) {
        if (isDressingRole(p.role)) assert.notEqual(p.role, 'tree', 'a dressing role served by a tree');
      }
      assert.ok(counts.cover > 0, `${arm.id} at ${pic.id} wears no cover`);
    }
  }
});

test('the cover ladder RISES at the shipped land, every rung the recipe’s count times its rung to rounding, and the land arms wear the shipped rung', () => {
  const at = (arm: string) => dressingCounts(armPlacements(arm, ONE), armDescriptors(arm, ONE)).cover;
  const rungs = [...COVER_ARMS, SHIPPED_ARM].map((arm) => ({ arm, density: armSpec(arm).coverDensity, cover: at(arm) })).sort((a, b) => a.density - b.density);
  for (let i = 1; i < rungs.length; i += 1) assert.ok(rungs[i]!.cover > rungs[i - 1]!.cover, `${rungs[i]!.arm} does not rise over ${rungs[i - 1]!.arm}`);
  for (const r of rungs) {
    // The recipe's 216 per recipe island; the shipped island IS the recipe island as this map draws it.
    const expected = 216 * r.density;
    assert.ok(Math.abs(r.cover - expected) <= 3, `${r.arm}: ${r.cover} against ${expected}`);
  }
  assert.equal(neighbourArm(CONTROL_ARM), null);
  assert.equal(neighbourArm(LAND_ARMS[0]!), CONTROL_ARM);
  assert.equal(neighbourArm(LAND_ARMS[1]!), LAND_ARMS[0]);
  const top = COVER_LADDER[COVER_LADDER.length - 1]!;
  const topArm = top === COVER_DENSITY ? SHIPPED_ARM : coverArmId(top);
  assert.equal(neighbourArm(topArm === SHIPPED_ARM ? coverArmId(COVER_LADDER[COVER_LADDER.length - 2]!) : topArm), topArm === SHIPPED_ARM ? SHIPPED_ARM : SHIPPED_ARM);
});

test('⚠ arms at one ratio share ONE ground build and one caster set; the control’s ground is its own', () => {
  const shipped = armGroundBuild(SHIPPED_ARM, ONE);
  for (const arm of COVER_ARMS) {
    assert.strictEqual(armGroundBuild(arm, ONE), shipped, `${arm} built its own ground`);
    assert.deepEqual(armCasters(arm, ONE), armCasters(SHIPPED_ARM, ONE), `${arm}'s casters differ — cover has started casting`);
  }
  assert.notStrictEqual(armGroundBuild(CONTROL_ARM, ONE), shipped);
  assert.notStrictEqual(armGroundBuild(LAND_ARMS[1]!, ONE), shipped);
  const page = source('shipped-land-ratio-scene.ts');
  assert.match(page, /shippedGroundBuild\(/, 'the ground is the shipped builder’s');
  assert.match(page, /dressMapWithCover\(/, 'the dressing is the canvas’s own entry point');
  assert.ok(!/new THREE\.PlaneGeometry|cellGroundGeometry\(\{ cells/.test(page), 'no scene of its own');
});

test('⚠⚠ THE LAYOUT HOLDS STILL between the control and every rung on the forest — and the compact picture’s does not', () => {
  const still = (arm: string) => [...islandCentres(armDescriptors(arm, FOREST)).values()];
  const control = still(CONTROL_ARM);
  assert.equal(control.length, 35);
  for (const arm of LAND_ARMS) {
    const centres = still(arm);
    for (let i = 0; i < control.length; i += 1) {
      assert.ok(Math.abs(centres[i]!.x - control[i]!.x) < 1e-6 && Math.abs(centres[i]!.z - control[i]!.z) < 1e-6, `${arm} moved island ${i}`);
    }
    // The forest's extent is (almost) the control's: only each island's own size moved.
    const e = groundDepth(armDescriptors(arm, FOREST).filter((d) => d.kind === 'cell-ground'));
    const e0 = groundDepth(armDescriptors(CONTROL_ARM, FOREST).filter((d) => d.kind === 'cell-ground'));
    assert.ok(e.w > e0.w * 0.85 && e.w <= e0.w, `${arm}: forest width ${e.w} against the control's ${e0.w}`);
  }
  // The compact picture sizes its frame from the shipped island: the forest is much smaller.
  const compact = groundDepth(armDescriptors(SHIPPED_ARM, COMPACT).filter((d) => d.kind === 'cell-ground'));
  const held = groundDepth(armDescriptors(SHIPPED_ARM, FOREST).filter((d) => d.kind === 'cell-ground'));
  // Not LAND_SCALE of it: the held-still frame is sized from the DRAWN ribbon's own spacing (the
  // 2D layout's island pitch), the compact one from the shipped island's own footprint, and
  // NEITHER is the compact side's business — `compact.w` is unaffected by the land camera at all.
  // Under ADR-0593 D1 (land camera 20 -> 50 degrees) the ribbon's own depth un-squashes from 46.2
  // to 103.4 (see `true-surface-equivalence.test.ts`), so the held-still forest's inter-island
  // pitch opens up and its packed WIDTH grows with it (a taller per-island footprint reflows how
  // many islands a row holds) — which SHRINKS the compact/held-still width ratio: it was ~0.65
  // edge-to-edge at 20 degrees ((88 × 51) against (233.8 × 46.2), ≈0.42 by area), and re-measured
  // here at 50 degrees it is ~0.455 edge-to-edge (compact 1465.4, held-still 3219.3).
  assert.ok(compact.w < held.w * 0.55 && compact.w > held.w * 0.35, `compact ${compact.w} against held-still ${held.w}`);
  assert.equal(COMPACT.size.layout, 'compact');
  assert.equal(FOREST.size.layout, undefined);
  assert.deepEqual(picturesAt(8).map((p) => p.id), ['one', 'forest']);
  assert.deepEqual(picturesAt('fit').map((p) => p.id), ['one', 'forest', 'forest-compact']);
  assert.equal(LAND_RATIO_PICTURES.length, 3);
});

test('the numbers under the picture count what they claim: the ratio first, the trees, the cover; the island’s extent is the centre island’s', () => {
  const stream = armDescriptors(SHIPPED_ARM, FOREST);
  const cells = stream.filter((d) => d.kind === 'cell-ground');
  const land = centreIslandLand(cells);
  assert.ok(Math.abs(land.unitsPerCapability - LAND_AREA_PER_CAPABILITY) < 1e-9);
  const counts = dressingCounts(armPlacements(SHIPPED_ARM, FOREST), stream);
  assert.equal(counts.islands, 35);
  assert.equal(counts.healthyIslands, 21);
  assert.equal(counts.capabilityTrees, 34 * 11, 'one island is `unknown` and grows nothing');
  assert.ok(Math.abs(counts.capabilityTreesPerHealthyIsland - 11) < 1e-9);
  const caption = countsCaption(counts, land, 'forest');
  assert.match(caption, new RegExp(`^${LAND_AREA_PER_CAPABILITY} units² of land per capability`));
  assert.match(caption, /374 trees \(one per capability\)/);
  assert.match(countsCaption(counts, land, 'one'), /blooms/);
  const island = islandDepth(cells);
  const whole = groundDepth(cells);
  assert.ok(island.w < whole.w / 5, 'the centre island is one island, not the forest');
  const one = islandDepth(armIsland(SHIPPED_ARM));
  assert.ok(Math.abs(one.w - island.w) < 1e-6 && Math.abs(one.d - island.d) < 1e-6, 'the centre island IS the fixture at the shipped ratio');
  assert.ok(Math.abs(one.w - 233.8 * Math.sqrt(11 * LAND_AREA_PER_CAPABILITY / centreIslandLand(armIsland(CONTROL_ARM)).landArea)) < 0.5, `${one.w}`);
});

test('screenExtent foreshortens ground depth by sin(elevation) and leaves width alone; the fit binds on the tighter side', () => {
  const camera = orientedCamera({ x: 0, z: 0 }, 1);
  const square = new Float32Array([-10, 0, -10, 10, 0, -10, 10, 0, 10, -10, 0, 10]);
  const e = screenExtent(square, camera);
  assert.ok(Math.abs(e.w - 20) < 1e-9);
  assert.ok(Math.abs(e.h - 20 * Math.sin((50 * Math.PI) / 180)) < 1e-9);
  const px = fitPxPerUnitFor(square);
  assert.ok(Math.abs(px - Math.min(2560 / 2 / (10 + 40), 1600 / 2 / (10 * Math.sin((50 * Math.PI) / 180) + 40))) < 1e-9);
});
