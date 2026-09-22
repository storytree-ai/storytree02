// shipped-spacing-scene.test.ts — the spacing page's own arithmetic, without a GPU and without the
// exported scenes.
//
// ⚠ THE PICTURES ON THAT PAGE ARE FOR THE OWNER'S EYE; what a test can hold is that the arms are the
// SHIPPED composition with only the layout moving (every island at the shipped land ratio); that the
// manifest is refused unless it is a descending ladder with a control; that the fit is CENTRED on
// the forest rather than on the origin (the real layout sits wherever the drawing put it); that the
// nearest-pair water is the geometry it claims; and that the read island is found by id.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { groundFlattening } from '@storytree/forest-world';

import { shippedElevationDeg } from '../src/camera-framing.js';
import { COARSEN_FACTOR, MAX_GRID_BUCKETS, buildSegmentGrid, edgeGridFarField, type CoastEdge } from '../src/shore-grid.js';
import { worldTo3D, type InstanceDescriptor } from '../src/world-to-3d.js';
import { LAND_AREA_PER_CAPABILITY } from '../src/land-per-capability.js';
import { islandScene } from './island-fixture.js';
import { orientedCamera } from './shipped-crowd-scene.js';
import { screenExtent } from './shipped-land-ratio-scene.js';
import {
  READ_ISLAND,
  SPACING_CONTROL_ARM,
  SPACING_EVIDENCE_DIR,
  SPACING_EVIDENCE_ELEVATION_DEG,
  SPACING_SHOTS,
  armStream,
  fitCamera,
  forestBounds,
  islandFootprints,
  loadSpacingArms,
  nearestPair,
  neighbourArm,
  tightestPair,
  validateManifest,
  viewElevationDeg,
  type SpacingSceneFile,
  type IslandFootprint,
  type SpacingArm,
  type SpacingManifest,
} from './shipped-spacing-scene.js';

const manifest = (): SpacingManifest => ({
  generatedAt: '2026-09-06T00:00:00.000Z',
  studio: { url: 'http://127.0.0.1:5391', head: 'abc', branch: 'claude/forest-spacing' },
  shippedRatio: 0.1,
  rungs: [0.5, 0.2, 0.1, 0],
  control: SPACING_CONTROL_ARM,
  arms: [
    { id: SPACING_CONTROL_ARM, spacing: { legacy: { rankGap: 40, islandGap: 60, rankSwing: 140 } }, file: 'today.json', islands: 1, world: { width: 1, height: 1 }, trails: { edges: 0, segments: 0, caves: 0, dropped: [] }, bytes: 1 },
    { id: 'spacing-0.5', spacing: { ratio: 0.5 }, file: 'spacing-0.5.json', islands: 1, world: { width: 1, height: 1 }, trails: { edges: 0, segments: 0, caves: 0, dropped: [] }, bytes: 1 },
    { id: 'spacing-0.2', spacing: { ratio: 0.2 }, file: 'spacing-0.2.json', islands: 1, world: { width: 1, height: 1 }, trails: { edges: 0, segments: 0, caves: 0, dropped: [] }, bytes: 1 },
    { id: 'spacing-0', spacing: { ratio: 0 }, file: 'spacing-0.json', islands: 1, world: { width: 1, height: 1 }, trails: { edges: 0, segments: 0, caves: 0, dropped: [] }, bytes: 1 },
  ],
});

/** A fake export: the fixture island's scene under every arm, which is enough to hold the pipeline. */
const fixtureArm = (id: string, ratio: number | null): SpacingArm => ({
  record: manifest().arms.find((a) => a.id === id) ?? { id, spacing: ratio === null ? { legacy: { rankGap: 40, islandGap: 60, rankSwing: 140 } } : { ratio }, file: `${id}.json`, islands: 1, world: { width: 1, height: 1 }, trails: { edges: 0, segments: 0, caves: 0, dropped: [] }, bytes: 1 },
  file: {
    scene: islandScene(),
    spacing: ratio === null ? { legacy: { rankGap: 40, islandGap: 60, rankSwing: 140 } } : { ratio },
    world: { width: 1, height: 1, offset: { x: 0, y: 0 }, islands: [] },
    trails: { edges: 0, segments: 0, caves: 0, dropped: [] },
  },
});

test('validateManifest: accepts a descending ladder with a control; refuses a missing control, a rising ladder, an arm without a ratio', () => {
  assert.equal(validateManifest(manifest()).arms.length, 4);
  const noControl = manifest();
  noControl.control = 'nope';
  assert.throws(() => validateManifest(noControl), /no control arm/);
  const rising = manifest();
  rising.arms = [rising.arms[0]!, rising.arms[3]!, rising.arms[1]!];
  assert.throws(() => validateManifest(rising), /does not descend/);
  const noRatio = manifest();
  noRatio.arms[1] = { ...noRatio.arms[1]!, spacing: {} };
  assert.throws(() => validateManifest(noRatio), /carries no ratio/);
  assert.throws(() => validateManifest(null), /not an object/);
});

test('loadSpacingArms fetches the manifest then every arm through the one route, and refuses a file with no scene', async () => {
  const fetched: string[] = [];
  const files = new Map<string, unknown>([
    ['/r/manifest.json', manifest()],
    ...manifest().arms.map((a): [string, unknown] => [`/r/${a.file}`, fixtureArm(a.id, a.spacing.ratio ?? null).file]),
  ]);
  const { manifest: m, arms } = await loadSpacingArms(
    async (url) => {
      fetched.push(url);
      return files.get(url);
    },
    '/r',
  );
  assert.equal(m.control, SPACING_CONTROL_ARM);
  assert.deepEqual(
    arms.map((a) => a.record.id),
    [SPACING_CONTROL_ARM, 'spacing-0.5', 'spacing-0.2', 'spacing-0'],
  );
  assert.equal(fetched[0], '/r/manifest.json');
  await assert.rejects(
    loadSpacingArms(async (url) => (url.endsWith('manifest.json') ? manifest() : { nope: true }), '/r'),
    /carries no scene graph/,
  );
});

test('neighbourArm: the control has none; every rung’s neighbour is the arm one step UP the ladder', async () => {
  const arms = manifest().arms.map((a) => fixtureArm(a.id, a.spacing.ratio ?? null));
  assert.equal(neighbourArm(arms, SPACING_CONTROL_ARM), null);
  assert.equal(neighbourArm(arms, 'spacing-0.5'), SPACING_CONTROL_ARM);
  assert.equal(neighbourArm(arms, 'spacing-0'), 'spacing-0.2');
});

test('⚠⚠ every arm is the SHIPPED composition: worldTo3D at the shipped land ratio, so land per capability is exact and identical on every arm', () => {
  for (const id of [SPACING_CONTROL_ARM, 'spacing-0']) {
    const stream = armStream(fixtureArm(id, id === SPACING_CONTROL_ARM ? null : 0));
    const b = forestBounds(stream);
    assert.equal(b.islands, 1);
    assert.ok(Math.abs(b.unitsPerCapability.min - LAND_AREA_PER_CAPABILITY) < 1e-6, `${id}: ${b.unitsPerCapability.min}`);
    assert.ok(Math.abs(b.unitsPerCapability.max - LAND_AREA_PER_CAPABILITY) < 1e-6);
    const fp = islandFootprints(stream);
    assert.equal(fp[0]?.id, READ_ISLAND);
    assert.ok(fp[0]!.halfW > 0 && fp[0]!.halfD > 0);
  }
});

test('nearestPair: centre distance and the open water between the two extents along their own line', () => {
  const fp = (id: string, x: number, z: number, halfW: number, halfD: number): IslandFootprint => ({
    id,
    centre: { x, z },
    halfW,
    halfD,
    land: { island: id, capabilities: 1, area: 1 },
  });
  // three islands on a line: a—b are 100 apart with half-widths 20 and 30 → 50 of water; c is far
  const near = nearestPair([fp('a', 0, 0, 20, 5), fp('b', 100, 0, 30, 5), fp('c', 1000, 0, 10, 10)]);
  assert.deepEqual([near.a, near.b], ['a', 'b']);
  assert.equal(near.distance, 100);
  assert.equal(near.water, 50);
  // along z the DEPTH half-extents bind, not the widths
  const deep = nearestPair([fp('a', 0, 0, 100, 10), fp('b', 0, 60, 100, 20)]);
  assert.equal(deep.distance, 60);
  assert.equal(deep.water, 30);
  assert.throws(() => nearestPair([fp('a', 0, 0, 1, 1)]), /fewer than two/);
});

test('fitCamera is CENTRED on the ground, not the origin — an off-origin forest lands mid-frame at the tighter side’s fit', () => {
  // a 400 × 200 slab of ground, far from the origin
  const corners: ReadonlyArray<readonly [number, number]> = [
    [3000, -5000],
    [3400, -5000],
    [3400, -4800],
    [3000, -4800],
  ];
  const pts: number[] = corners.flatMap(([x, z]) => [x, 0, z]);
  const fit = fitCamera(pts);
  const e = screenExtent(pts, orientedCamera(fit.centre, fit.pxPerUnit));
  assert.ok(Math.abs(e.minX + e.maxX) < 1e-6, `x not centred: ${e.minX} ${e.maxX}`);
  assert.ok(Math.abs(e.minY + e.maxY) < 1e-6, `y not centred: ${e.minY} ${e.maxY}`);
  // 400 wide + 2 × 40 margin = 480 ground units across 2560 px, or the (foreshortened) depth across 1600 px — whichever binds
  const byWidth = 2560 / (e.maxX - e.minX + 80);
  const byHeight = 1600 / (e.maxY - e.minY + 80);
  assert.ok(Math.abs(fit.pxPerUnit - Math.min(byWidth, byHeight)) < 1e-9);
  assert.ok(fit.pxPerUnit > 0 && Number.isFinite(fit.pxPerUnit));
});

test('the shots: the forest fitted and the read island at 8 px/unit — the two pictures the increment owes', () => {
  assert.deepEqual(
    SPACING_SHOTS.map((s) => `${s.picture}@${String(s.zoom)}`),
    ['forest@fit', 'one@8'],
  );
});

test('⚠⚠ viewElevationDeg reads the signed elevation at ANY target — the position-normalising reader next door does not, off the origin', () => {
  const origin = orientedCamera({ x: 0, z: 0 }, 1);
  const away = orientedCamera({ x: 3000, z: -5000 }, 1);
  assert.ok(Math.abs(viewElevationDeg(origin) - shippedElevationDeg()) < 1e-6, `origin ${viewElevationDeg(origin)}`);
  assert.ok(Math.abs(viewElevationDeg(away) - viewElevationDeg(origin)) < 1e-6, `away ${viewElevationDeg(away)} vs origin ${viewElevationDeg(origin)}`);
});

test('tightestPair reads the RINGS: two lobed islands whose boxes overlap but whose land does not keep their water; a vertex inside the other’s cell is an overlap', () => {
  const cell = (island: string, ring: Array<[number, number]>): InstanceDescriptor => ({
    kind: 'cell-ground',
    island,
    transform: { x: 0, y: 0, z: 0 },
    group: 'cell-ground',
    points: ring.map(([x, z]) => ({ x, y: 0, z })),
  });
  // a: a unit square at the origin; b: a square 3 to the right → water 2 between their facing edges
  const apart = [cell('a', [[0, 0], [1, 0], [1, 1], [0, 1]]), cell('b', [[3, 0], [4, 0], [4, 1], [3, 1]])];
  const t = tightestPair(apart);
  assert.deepEqual([t.a, t.b], ['a', 'b']);
  assert.equal(t.overlap, false);
  assert.ok(Math.abs(t.water - 2) < 1e-9, `${t.water}`);
  // an L-shaped island and a square nestled in its notch: the boxes overlap, the land does not
  const nestled = [
    cell('l', [[0, 0], [3, 0], [3, 1], [1, 1], [1, 3], [0, 3]]),
    cell('s', [[2, 2], [3, 2], [3, 3], [2, 3]]),
  ];
  const n = tightestPair(nestled);
  assert.equal(n.overlap, false);
  assert.ok(Math.abs(n.water - 1) < 1e-9, `${n.water}`);
  // a square whose corner stands inside the other's cell
  const over = [cell('p', [[0, 0], [2, 0], [2, 2], [0, 2]]), cell('q', [[1, 1], [3, 1], [3, 3], [1, 3]])];
  const o = tightestPair(over);
  assert.equal(o.overlap, true);
  assert.equal(o.water, 0);
  assert.throws(() => tightestPair([cell('only', [[0, 0], [1, 0], [1, 1]])]), /fewer than two/);
});


// ---------------------------------------------------------------------------
// THE LANDED CORRIDOR, ON THE REAL COMMITTED FOREST (ADR-0546 D1 / D6)
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES = join(HERE, '..', '..', '..', 'docs', 'research', SPACING_EVIDENCE_DIR, 'scenes');

/** An island's depth over its width, at the median island — a shape reading the land-per-capability
 *  resize cannot move, unlike an area or an extent. */
function medianAspect(fps: readonly IslandFootprint[]): number {
  const a = fps.map((f) => f.halfD / f.halfW).sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)]!;
}

/** The committed SHIPPED-PICK arm — the real 35-island forest the 2D map laid out on 2026-09-06 at
 *  the gap ratio that ships, read off disk.
 *
 *  ⚠ THE SHIPPED PICK RATHER THAN THE CONTROL, AND FOR A MECHANICAL REASON: `armStream` memoises by
 *  `record.id`, and the synthetic `fixtureArm` above builds a ONE-ISLAND arm under the control's own
 *  id, so asking for the control here returns whichever of the two ran first. */
function committedForest(): SpacingArm {
  const m = validateManifest(JSON.parse(readFileSync(join(SCENES, 'manifest.json'), 'utf8')));
  const record = m.arms.find((a) => a.spacing.ratio === m.shippedRatio);
  if (record === undefined) throw new Error('the committed manifest carries no arm at the shipped ratio');
  // ⚠ RE-IDENTIFIED, ON PURPOSE. `armStream` memoises by `record.id` and the synthetic `fixtureArm`
  // above builds ONE-ISLAND arms under the real ladder's own ids, so a shared id hands this test
  // whichever of the two ran first — which is how it first read "1 islands" on a 35-island file.
  return {
    record: { ...record, id: `committed-${record.id}` },
    file: JSON.parse(readFileSync(join(SCENES, record.file), 'utf8')) as SpacingSceneFile,
  };
}

test('⚠⚠ THE CORRIDOR IS LANDED, MEASURED ON THE REAL COMMITTED FOREST — and the un-projected extent is an ORDINARY one for the shore grid, which is ADR-0546 D6’s answer', () => {
  const arm = committedForest();
  const converted = armStream(arm);
  const b = forestBounds(converted);
  assert.ok(b.islands > 30, `the committed arm is the whole forest (${b.islands} islands)`);

  // ⚠ THE ISLANDS ARE TRUE, NOT SQUASHED — the thing the deleted repair used to supply and the
  // conversion at the reader now does. Read as an ASPECT RATIO rather than a size, because the
  // land-per-capability ratio has already resized every island by its own factor.
  const median = medianAspect(islandFootprints(converted));
  assert.ok(median > 0.9 && median < 1.2, `a true island is roughly as deep as it is wide (median ${median})`);

  // ⚠ AND THE FOREST IS A CORRIDOR: deeper than it is wide, which is the shape the owner accepted
  // sight-unseen (ADR-0546 D3) and exactly what the per-island repair existed to avoid.
  assert.ok(b.ground.d > b.ground.w * 3, `the forest is a corridor (${b.ground.w.toFixed(0)} x ${b.ground.d.toFixed(0)})`);

  // ⚠⚠ ADR-0546 D6 — THE SPACING REMAINDER, ANSWERED ON THE LANDED GEOMETRY RATHER THAN NAMED. The
  // corridor is what once blew `shore-grid`'s 262,144-bucket cap (478,401 buckets on a 10,235-unit
  // extent), which is why the forest's spacing was made a precondition of this deletion.
  // `buildSegmentGrid` has coarsened since ADR-0520, so an extent the query width cannot tile is
  // tiled COARSER rather than refused — `src/shore-grid.test.ts` pins that on a typed extent; this
  // pins it on the extent the landing actually produces.
  const SAND_CELL = 2.6384359697243656;
  const edges: CoastEdge[] = [{ ax: 0, az: 0, bx: b.ground.w, bz: b.ground.d }];
  const grid = buildSegmentGrid(edges, SAND_CELL);
  assert.ok(grid.nx * grid.nz <= MAX_GRID_BUCKETS, `${grid.nx} x ${grid.nz} = ${grid.nx * grid.nz}`);
  assert.ok(grid.cell >= SAND_CELL, 'coarsened, never refined — the far-field proof needs cell >= width');
  assert.ok(edgeGridFarField(grid.cell, SAND_CELL));
  const steps = Math.round(Math.log(grid.cell / SAND_CELL) / Math.log(COARSEN_FACTOR));
  assert.ok(steps <= 12, `the landed corridor settles in ${steps} quarter-steps, not near the 64 bound`);
});

test('⚠ NON-VACUITY: the same committed export fed straight through the mapper is the SQUASH — which is what the reader’s conversion exists to prevent', () => {
  const arm = committedForest();
  const converted = medianAspect(islandFootprints(armStream(arm)));
  const raw = medianAspect(
    islandFootprints(worldTo3D(arm.file.scene).filter((d): d is InstanceDescriptor => d.kind !== 'skipped')),
  );
  // Not merely "smaller": the two differ by EXACTLY the projection the export was written through,
  // `1 / sin(SPACING_EVIDENCE_ELEVATION_DEG)` = 1 / sin 20° = 2.9238 — which is what says the
  // conversion undoes that projection and nothing else.
  //
  // ⚠ AGAINST THE EVIDENCE'S OWN PINNED ELEVATION, NOT THE LIVE `groundFlattening()` — and the
  // distinction is the whole point of this test now. Before ADR-0593 D1 the two were the same
  // number, so comparing against the live default and against the pinned constant could not be
  // told apart; they diverge the moment the live camera ever differs from the day this evidence
  // was captured, which is exactly today. `armStream` converts this frozen export at
  // `SPACING_EVIDENCE_ELEVATION_DEG` (see its own comment for why), so this ratio must be judged
  // against that SAME pinned value or it would be asserting the wrong thing about the wrong axis.
  assert.ok(
    Math.abs(converted / raw - 1 / groundFlattening(SPACING_EVIDENCE_ELEVATION_DEG)) < 1e-3,
    `unconverted ${raw} against converted ${converted} — ratio ${converted / raw}`,
  );
});
