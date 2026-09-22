// shipped-island-floor-scene.test.ts — the page's ARMS and its READING, held without a browser
// against the COMMITTED real-forest export: the shipped arm IS the shipped mapper's own stream byte
// for byte; the control is the rule as it stood (the zero-capability islands left as drawn, and the
// finding — they outsize islands holding work — reproduced on the real corpus); the floor closes
// every inverted pair and every island draws `max(1, capabilities) × 318`; the table is largest
// first with honest ranks; and the page adopts nothing of its own.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { LAND_AREA_PER_CAPABILITY, LAND_FLOOR_CAPABILITIES, islandLand, sizeIslandsByCapability } from '../src/land-per-capability.js';
import { worldTo3D, type InstanceDescriptor } from '../src/world-to-3d.js';
import { trueGroundFromDrawing } from './frozen-drawing.js';
import { groundSanity } from './ground-sanity.js';
import {
  FLOOR_ARMS,
  FLOOR_CONTROL_ARM,
  FLOOR_PICTURES,
  FLOOR_SHIPPED_ARM,
  PRE_FLOOR,
  READ_ZERO_ISLAND,
  drawnStream,
  floorArmCaption,
  floorArmSpec,
  floorArmStream,
  floorArmsFor,
  floorLandReading,
  floorPicture,
  islandTable,
  readIslandCentre,
} from './shipped-island-floor-scene.js';
import {
  SPACING_EVIDENCE_DIR,
  SPACING_EVIDENCE_ELEVATION_DEG,
  validateManifest,
  type SpacingArm,
  type SpacingSceneFile,
} from './shipped-spacing-scene.js';
import { shippedLayoutArm } from './shipped-wheat-scene.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES = join(HERE, '..', '..', '..', 'docs', 'research', SPACING_EVIDENCE_DIR, 'scenes');

groundSanity();

/** The committed shipped layout — the same file the page fetches, read off disk. */
function shippedLayout(): SpacingArm {
  const manifest = validateManifest(JSON.parse(readFileSync(join(SCENES, 'manifest.json'), 'utf8')));
  const arms: SpacingArm[] = manifest.arms.map((record) => ({
    record,
    file: JSON.parse(readFileSync(join(SCENES, record.file), 'utf8')) as SpacingSceneFile,
  }));
  return shippedLayoutArm(arms, manifest.shippedRatio);
}

const LAYOUT = shippedLayout();

test('the arms: the control is the rule as it stood (floor 0, typed as history), the shipped arm is the source’s floor; both pictures carry both', () => {
  assert.deepEqual(FLOOR_ARMS.map((a) => a.id), [FLOOR_CONTROL_ARM, FLOOR_SHIPPED_ARM]);
  assert.equal(PRE_FLOOR, 0);
  assert.deepEqual(floorArmSpec(FLOOR_CONTROL_ARM), { id: FLOOR_CONTROL_ARM, floor: 0 });
  assert.deepEqual(floorArmSpec(FLOOR_SHIPPED_ARM), { id: FLOOR_SHIPPED_ARM, floor: LAND_FLOOR_CAPABILITIES });
  assert.equal(LAND_FLOOR_CAPABILITIES, 1);
  assert.throws(() => floorArmSpec('nope'), /no arm/);
  assert.ok(floorArmCaption(FLOOR_CONTROL_ARM).endsWith('(CONTROL: the mapper as it shipped after ADR-0520)'));
  assert.ok(floorArmCaption(FLOOR_SHIPPED_ARM).endsWith('(SHIPS)'));
  assert.ok(floorArmCaption(FLOOR_SHIPPED_ARM).includes(`${LAND_AREA_PER_CAPABILITY} units²`));
  assert.deepEqual(FLOOR_PICTURES.map((p) => p.id), ['forest', 'one']);
  for (const p of FLOOR_PICTURES) assert.deepEqual([...floorArmsFor(p.id)], [FLOOR_CONTROL_ARM, FLOOR_SHIPPED_ARM]);
  assert.equal(floorPicture('one').zoom, 8);
  assert.equal(floorPicture('forest').zoom, 'fit');
  assert.throws(() => floorPicture('nope' as never), /no picture/);
});

test('⚠⚠ THE SHIPPED ARM IS THE SHIPPED MAPPER, BYTE FOR BYTE — and the committed export is a DRAWING, so the conversion is part of what "shipped" means here', () => {
  const shipped = floorArmStream(FLOOR_SHIPPED_ARM, LAYOUT);
  // ⚠ NOT A BARE `worldTo3D(scene)` ANY MORE, AND THE CHANGE IS ADR-0546 D1's. The mapper stopped
  // un-projecting: it lays down whatever ground the scene carries, and this scene was exported from
  // the 2D map on 2026-09-06, so it carries the drawing's foreshortened ground. What the canvas
  // would be handed for THIS layout is therefore the export un-projected and then sized —
  // `frozen-drawing.ts` carries why that conversion is an input adapter and not the deleted repair.
  //
  // ⚠ PINNED TO `SPACING_EVIDENCE_ELEVATION_DEG`, NEVER THE LIVE DEFAULT — restated here rather
  // than read off `drawnStream` so this test independently re-derives what "shipped" means, per
  // its own title. See that constant's own comment in `shipped-spacing-scene.ts` for why a frozen
  // export un-projects at the elevation it was drawn at rather than at today's camera.
  const bare = sizeIslandsByCapability(
    trueGroundFromDrawing(worldTo3D(LAYOUT.file.scene, { landAreaPerCapability: null }), SPACING_EVIDENCE_ELEVATION_DEG),
    LAND_AREA_PER_CAPABILITY,
  ).filter((d): d is InstanceDescriptor => d.kind !== 'skipped');
  assert.deepEqual(shipped, bare);
  // ⚠ NON-VACUITY: feeding the export straight through is a DIFFERENT, squashed stream — which is
  // exactly what the conversion exists to prevent, and what a page would silently draw without it.
  const unconverted = worldTo3D(LAYOUT.file.scene).filter((d): d is InstanceDescriptor => d.kind !== 'skipped');
  assert.equal(unconverted.length, bare.length);
  assert.notDeepEqual(unconverted, bare);
  // The control differs from it exactly on the zero-capability islands, and nowhere else.
  const control = floorArmStream(FLOOR_CONTROL_ARM, LAYOUT);
  assert.equal(control.length, shipped.length);
  const zero = new Set(islandTable(FLOOR_CONTROL_ARM, LAYOUT).filter((r) => r.capabilities === 0).map((r) => r.id));
  assert.ok(zero.size > 0);
  for (const [i, d] of control.entries()) {
    const s = shipped[i]!;
    if (d.island !== undefined && zero.has(d.island)) assert.notDeepEqual(d, s, `${d.island} did not move under the floor`);
    else if (d.island !== undefined) assert.deepEqual(d, s, `${d.island} moved under the floor`);
  }
  // The drawing is memoised and shared: the same array on every call.
  assert.equal(drawnStream(LAYOUT), drawnStream(LAYOUT));
  assert.equal(floorArmStream(FLOOR_SHIPPED_ARM, LAYOUT), floorArmStream(FLOOR_SHIPPED_ARM, LAYOUT));
});

test('⚠⚠ THE FINDING, ON THE REAL CORPUS: on the control the zero-capability islands are left at the drawing’s three tiles and outsize islands holding work; with the floor every island draws max(1, capabilities) × 318 and no pair is inverted', () => {
  const today = floorLandReading(FLOOR_CONTROL_ARM, LAYOUT);
  const shipped = floorLandReading(FLOOR_SHIPPED_ARM, LAYOUT);
  assert.equal(today.islandsCount, LAYOUT.record.islands);
  assert.equal(shipped.islandsCount, today.islandsCount);
  // The three the owner named are on the map and hold nothing.
  for (const id of ['proof-protocol', 'storage-protocol', 'website']) {
    assert.ok(today.zero.some((z) => z.id === id), `${id} is not a zero-capability island on this layout`);
  }
  assert.ok(today.zero.some((z) => z.id === READ_ZERO_ISLAND));
  // THE CONTROL: left as drawn (three tiles), NOT at the ratio, and larger than islands holding work.
  for (const z of today.zero) {
    assert.equal(z.tiles, 3);
    assert.ok(Math.abs(z.area - z.drawn) < 1e-9, `${z.id} was not left as drawn`);
    assert.ok(z.area > 5000, `${z.id} draws ${z.area}`);
    assert.equal(z.perCapability, null);
  }
  assert.equal(today.ratioHeld, true, 'every island HOLDING work is at the ratio on the control too — the floor is the only difference');
  assert.ok(today.inversions.length > 0);
  assert.ok(today.inversions.every((p) => p.smallerCapabilities === 0), 'every inverted pair on the control is a zero-capability island — the ratio itself never inverts');
  const outsized = new Set(today.inversions.map((p) => p.largerCapabilities));
  assert.ok(Math.max(...outsized) >= 16, `the zero-capability islands outsize an island holding ${Math.max(...outsized)} capabilities`);
  // The biggest island on the control is ALREADY the one with the most work — what is wrong is the
  // bottom of the ranking, not the top.
  const most = [...today.islands].sort((a, b) => b.capabilities - a.capabilities)[0]!;
  assert.equal(today.largest.id, most.id);
  assert.ok(today.zero.every((z) => z.rank <= 6 && z.rank >= 3), `the zero-capability islands rank ${today.zero.map((z) => z.rank)} on the control`);

  // THE FLOOR: every island at max(1, caps) × 318, the zero-capability islands at exactly one
  // capability's worth — tied with the one-capability island — and no inverted pair left.
  assert.equal(shipped.ratioHeld, true, `max error ${shipped.ratioError}`);
  assert.deepEqual(shipped.inversions, []);
  for (const z of shipped.zero) {
    assert.ok(Math.abs(z.area - LAND_AREA_PER_CAPABILITY) < 1e-6, `${z.id} draws ${z.area}`);
    assert.ok(z.rank >= shipped.islandsCount - shipped.zero.length, `${z.id} ranks ${z.rank} of ${shipped.islandsCount}`);
  }
  const one = shipped.islands.filter((r) => r.capabilities === 1);
  assert.ok(one.length > 0, 'the corpus has a one-capability island to tie with');
  for (const o of one) assert.ok(Math.abs(o.area - LAND_AREA_PER_CAPABILITY) < 1e-6);
  assert.equal(shipped.largest.id, most.id);
  assert.ok(shipped.smallest.capabilities <= 1);
  // The islands holding work did not move at all: ADR-0520's ratio is settled.
  const todayById = new Map(today.islands.map((r) => [r.id, r]));
  for (const r of shipped.islands) {
    if (r.capabilities === 0) continue;
    assert.ok(Math.abs(r.area - todayById.get(r.id)!.area) < 1e-9, `${r.id} (${r.capabilities} capabilities) moved`);
  }
  assert.ok(shipped.totalLand < today.totalLand);
});

test('the table is largest first with contiguous ranks, ties broken by id, and its lands are the stream’s own', () => {
  for (const arm of [FLOOR_CONTROL_ARM, FLOOR_SHIPPED_ARM]) {
    const rows = islandTable(arm, LAYOUT);
    assert.deepEqual(rows.map((r) => r.rank), rows.map((_, i) => i + 1));
    for (let i = 1; i < rows.length; i += 1) {
      const a = rows[i - 1]!;
      const b = rows[i]!;
      assert.ok(a.area > b.area || (a.area === b.area && a.id < b.id), `${a.id} / ${b.id} out of order`);
    }
    const land = islandLand(floorArmStream(arm, LAYOUT));
    for (const r of rows) {
      assert.equal(r.area, land.get(r.id)!.area);
      assert.equal(r.capabilities, land.get(r.id)!.capabilities);
      assert.equal(r.tiles, LAYOUT.file.world.islands.find((i) => i.id === r.id)!.tiles);
      assert.equal(r.tiles, Math.max(3, r.capabilities + 2), 'today’s 2D quota, read off the export');
    }
  }
});

test('the read island’s centre is read off the DRAWING, so it is the same point on both arms', () => {
  const c = readIslandCentre(LAYOUT);
  assert.ok(Number.isFinite(c.x) && Number.isFinite(c.z));
  // Its cells scale ABOUT that centre on the shipped arm: the mean of the ring vertices is invariant.
  const shipped = floorArmStream(FLOOR_SHIPPED_ARM, LAYOUT).filter((d) => d.kind === 'cell-ground' && d.island === READ_ZERO_ISLAND);
  let sx = 0;
  let sz = 0;
  let n = 0;
  for (const d of shipped) for (const p of d.points ?? []) {
    sx += p.x;
    sz += p.z;
    n += 1;
  }
  assert.ok(n > 0);
  assert.ok(Math.abs(sx / n - c.x) < 1e-6 && Math.abs(sz / n - c.z) < 1e-6);
});

test('the page adopts nothing of its own: the shipped builder and material, no scene of its own, the floor read off the source', () => {
  const page = readFileSync(join(HERE, 'shipped-island-floor-scene.ts'), 'utf8');
  assert.ok(page.includes('shippedGroundBuild('), 'the ground is the shipped builder');
  assert.ok(page.includes('buildGroundMaterial('), 'the material is the shipped builder');
  assert.ok(!page.includes('CellGroundGeometryInput'), 'no geometry input of its own');
  assert.ok(page.includes('LAND_FLOOR_CAPABILITIES'), 'the shipped floor is read, not restated');
  assert.ok(!/floor:\s*1\b/.test(page), 'the shipped floor is never typed as a literal');
  assert.ok(page.includes("landAreaPerCapability: null"), 'the drawing is asked for as the drawing');
});
