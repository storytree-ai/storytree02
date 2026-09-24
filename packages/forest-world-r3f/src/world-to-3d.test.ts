// world-to-3d.test.ts — ADR-0123 THIRD forest-world mapper: node:test-provable
// descriptor mapping (scene semantic layer → typed 3D instance descriptors).
//
// The import of `./world-to-3d.js` is the RED anchor: the module does not exist
// yet. All tests fail with a "Cannot find module" error — the RIGHT-kind red
// (missing implementation, not a syntax error in the test).
//
// When the implementation lands, these tests pin:
//   • core kind-family mapping: relaxed-mesh parcel → cell-ground, trail fill/ghost →
//     trail-strip / trail-ghost-strip, cave → cave-arch, in-flight wisp → wisp-sprite
//     (the story tree mapped to `story-tree` until 2026-09-04 and is retired — ADR-0508;
//     a `tree` group now SKIPS, and the test named for it pins that)
//   • total coverage: non-core / structural SceneKinds yield an explicit
//     { kind: 'skipped', sceneKind: string } — never a throw, never a silent drop
//   • material variant flows from the territory's folded SceneStatus
//   • all instance descriptors carry a 3D transform { x, y, z } and an instancing
//     group string
//   • determinism: same scene → byte-identical descriptor array
//   • the RETIRED classic extruded-hex substrate (`tile`) REFUSES rather than mapping
//     or silently skipping (`retire-the-old-land-path`)
//
// The fixtures use a real buildScene over @storytree/forest-world's SceneInput
// contract — trails are real `routeTrails` output on tiny island sets, not
// hand-forged shapes — exercising the mapper end-to-end against the real core
// (ADR-0123 provability firewall). `mkInput` below builds the RELAXED-MESH substrate
// (the one production surface ever emits), so this end-to-end exercise runs the same
// substrate the studio ships; the classic substrate is exercised separately, only by
// the one test that pins its refusal.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LAND_AREA_PER_CAPABILITY, LAND_FLOOR_CAPABILITIES, islandLand, islandSizeInversions } from './land-per-capability.js';
import { islandCentres } from './true-footprint.js';

import {
  PLAN_VIEW_ELEVATION_DEG,
  buildRelaxedCells,
  buildScene,
  routeTrails,
  trailFillWidth,
  type DrawTile,
  type SceneG,
  type SceneInput,
  type SceneKind,
  type SceneNode,
  type SceneStatus,
  type SceneTerritoryInput,
  type TrailIsland,
} from '@storytree/forest-world';

import {
  UAT_CRITERION_KINDS,
  UAT_MARKER_DESCRIPTOR,
  UAT_MARKER_KINDS,
  isUatCriterion,
  worldTo3D,
  type Descriptor3D,
  type InstanceDescriptor,
  type SkippedDescriptor,
} from './world-to-3d.js';

// ---------------------------------------------------------------------------
// fixtures — real SceneInput, not a hand-rolled scene shape
// ---------------------------------------------------------------------------

// Trail fixtures are ROUTED, not hand-forged (the scene.test.ts pattern): real
// `routeTrails` output on tiny island sets, computed once — pure function, safe to share.
const isle = (id: string, x: number, y: number, r: number): TrailIsland => ({ id, x, y, r });

// one unobstructed edge, matching the default territory (library → cli)
const BASE_TRAILS = routeTrails(
  [isle('library', 100, 200, 60), isle('cli', 300, 60, 50)],
  [{ from: 'library', to: 'cli', title: 'cli depends on library' }],
  'r3f-fixture',
);

// a walled-in edge — forced under the ring, so hidden ghost runs + cave portals exist
const CAVE_ISLANDS: TrailIsland[] = [isle('A', 0, 0, 30), isle('B', 600, 0, 30)];
for (let k = 0; k < 8; k++) {
  const a = (Math.PI / 4) * k;
  CAVE_ISLANDS.push(isle(`ring${k}`, 150 * Math.cos(a), 150 * Math.sin(a), 60));
}
const CAVE_TRAILS = routeTrails(CAVE_ISLANDS, [{ from: 'A', to: 'B' }], 'r3f-cave');

/** The fixture territory's id — the STORY every island-level descriptor must name. */
const TERRITORY_ID = 'library';

function mkTerritory(over: Partial<SceneTerritoryInput> = {}): SceneTerritoryInput {
  return {
    id: TERRITORY_ID,
    status: 'healthy',
    caps: 3,
    centroid: { x: 100, y: 200 },
    groundRadius: 60,
    screenRadius: 60,
    treeSpot: { x: 100, y: 190 },
    labelY: 260,
    coastGroundLoops: [],
    decor: [],
    plants: [],
    treeTitle: 'library — healthy',
    wisps: [],
    plate: {
      w: 120,
      h: 33,
      rx: 7,
      idY: 14,
      subY: 27,
      idText: 'library',
      subText: 'healthy · 3 caps',
      title: 'The library',
    },
    ...over,
  };
}

/** The DEFAULT tiles behind the fixture's relaxed-mesh ground — the same two-hex layout this
 *  fixture used before the classic substrate (`relaxedCells: null`) was retired at the mapper
 *  (`retire-the-old-land-path`). Kept as its own constant because `buildRelaxedCells` below needs
 *  it independently of the `SceneInput` it ends up inside. */
const DEFAULT_DRAW_TILES: DrawTile[] = [
  { h: { q: 0, r: 0 }, owner: 0 },
  { h: { q: 1, r: 0 }, owner: 0 },
];

/** The RELAXED-MESH substrate (`mode: 'mesh'`, the shipped studio's own substrate) so the scene
 *  contains `cell` groups under a `ground` group — the ground family the mapper classifies as
 *  cell-ground. Until `retire-the-old-land-path` this built a CLASSIC scene instead
 *  (`relaxedCells: null`, `tile` groups); the classic substrate now REFUSES at the mapper rather
 *  than mapping (see the dedicated refusal test below), so every OTHER test in this file — which
 *  is exercising bloom / trail / cave / wisp mapping, not ground — needs a substrate the
 *  mapper still accepts. */
function mkInput(over: Partial<SceneInput> = {}): SceneInput {
  const drawTiles = over.drawTiles ?? DEFAULT_DRAW_TILES;
  const wheatSets = over.wheatSets ?? [new Set<string>()];
  return {
    offset: { x: 0, y: 0 },
    width: 1200,
    height: 900,
    empties: [],
    relaxedCells: buildRelaxedCells(drawTiles, wheatSets, 'mesh'),
    drawTiles,
    wheatSets,
    trails: BASE_TRAILS,
    territories: [mkTerritory()],
    ...over,
  };
}

// type-guard helpers — TypeScript narrows through the discriminated union
const asInstance = (d: Descriptor3D): d is InstanceDescriptor => d.kind !== 'skipped';
const asSkipped = (d: Descriptor3D): d is SkippedDescriptor => d.kind === 'skipped';

/** Positional tolerance: the core rounds path coords to 0.1 (`toFixed(1)`), so a
 *  vertex-centroid recovery of a baked centre lands within ~0.05 per axis. */
const closeTo = (got: number, want: number, msg: string): void =>
  assert.ok(Math.abs(got - want) < 0.15, `${msg} (got ${got}, want ~${want})`);

// ---------------------------------------------------------------------------
// contract: r3f-mapping-is-deterministic
// ---------------------------------------------------------------------------

test('r3f-mapping-is-deterministic: same scene → deep-equal descriptor arrays, stable ordering', () => {
  const scene = buildScene(mkInput());
  assert.deepEqual(worldTo3D(scene), worldTo3D(scene));
  // A fresh scene from the same input maps identically too — the core's determinism
  // carried through the mapper end-to-end.
  assert.deepEqual(worldTo3D(buildScene(mkInput())), worldTo3D(scene));
});

test('r3f-coverage-flora-preserves-grounded-capability-semantics: every core coverage wrapper becomes one grounded descriptor with its own capability, island, status, theme, and scale', () => {
  // This is deliberately a real true-ground SceneInput, not a forged scene fragment: the core owns
  // the parcel-flora wrapper's grounding semantics. The two islands vary capability, theme, folded
  // status, and test count, so identity cannot be accidentally borrowed from one territory-wide
  // value. `landAreaPerCapability: null` leaves the core's direct coordinates intact.
  const drawTiles: DrawTile[] = [
    { h: { q: 0, r: 0 }, owner: 0 },
    { h: { q: 1, r: 0 }, owner: 0 },
    { h: { q: 6, r: 0 }, owner: 1 },
    { h: { q: 7, r: 0 }, owner: 1 },
  ];
  const scene = buildScene(
    mkInput({
      cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG,
      drawTiles,
      wheatSets: [new Set<string>(), new Set<string>()],
      relaxedCells: buildRelaxedCells(drawTiles, [new Set<string>(), new Set<string>()], 'mesh'),
      territories: [
        mkTerritory({
          id: 'library',
          status: 'healthy',
          caps: 2,
          parcels: [
            { capId: 'library-meadow', status: 'healthy', testCount: 2, theme: 'meadow', seed: { x: 100, y: 200 } },
            { capId: 'library-woodland', status: 'building', testCount: 5, theme: 'woodland', seed: { x: 120, y: 195 } },
          ],
        }),
        mkTerritory({
          id: 'cli',
          status: 'unhealthy',
          caps: 2,
          centroid: { x: 500, y: 200 },
          groundRadius: 60,
          screenRadius: 60,
          treeSpot: { x: 500, y: 190 },
          labelY: 260,
          plate: { w: 120, h: 33, rx: 7, idY: 14, subY: 27, idText: 'cli', subText: 'unhealthy · 2 caps', title: 'The cli' },
          parcels: [
            { capId: 'cli-heath', status: 'unhealthy', testCount: 9, theme: 'heath', seed: { x: 500, y: 200 } },
            { capId: 'cli-meadow', status: 'proposed', testCount: 3, theme: 'meadow', seed: { x: 520, y: 195 } },
          ],
        }),
      ],
    }),
  );

  type CoverageSource = { id: string; island: string; status: string; theme: string; groundAnchor: { x: number; y: number }; floraScale: number };
  const sources: CoverageSource[] = [];
  const collect = (node: SceneNode, island?: string): void => {
    const nextIsland = node.el === 'g' && node.kind === 'territory' && node.id !== undefined ? node.id : island;
    if (
      node.el === 'g' &&
      node.kind === 'parcel-flora' &&
      node.id !== undefined &&
      node.status !== undefined &&
      node.theme !== undefined &&
      node.groundAnchor !== undefined &&
      node.floraScale !== undefined &&
      nextIsland !== undefined
    ) {
      sources.push({
        id: node.id,
        island: nextIsland,
        status: node.status,
        theme: node.theme,
        groundAnchor: node.groundAnchor,
        floraScale: node.floraScale,
      });
    }
    if (node.el === 'g') for (const child of node.children) collect(child, nextIsland);
  };
  collect(scene);
  assert.ok(sources.length > 4, 'the varied real core fixture emits several coverage wrappers across both territories');
  assert.deepEqual(new Set(sources.map((source) => source.island)), new Set(['library', 'cli']));

  type CoverageDescriptor = {
    kind: 'coverage-flora';
    transform: { x: number; y: number; z: number };
    group: string;
    capability: string;
    island: string;
    material: string;
    theme: string;
    floraScale: number;
  };
  const descriptors = worldTo3D(scene, { landAreaPerCapability: null }).filter(
    (descriptor): descriptor is Descriptor3D & CoverageDescriptor => (descriptor as { kind: string }).kind === 'coverage-flora',
  );
  assert.equal(descriptors.length, sources.length, 'one coverage-flora descriptor exists for every core wrapper');
  for (let i = 0; i < sources.length; i++) {
    const source = sources[i]!;
    const descriptor = descriptors[i]!;
    assert.deepEqual(
      descriptor,
      {
        kind: 'coverage-flora',
        transform: { x: source.groundAnchor.x, y: 0, z: source.groundAnchor.y },
        group: 'coverage-flora',
        capability: source.id,
        island: source.island,
        material: source.status,
        theme: source.theme,
        floraScale: source.floraScale,
      },
      `coverage wrapper ${i} is transported without recovering SVG transform data`,
    );
  }

  // A malformed semantic wrapper is not an invitation to parse its SVG transform or invent a
  // capability: it remains a visible skip, making the malformed source observable to callers.
  const malformed: SceneG = { el: 'g', kind: 'parcel-flora', id: 'missing-semantics', transform: 'translate(999 999)', children: [] };
  assert.deepEqual(worldTo3D(malformed), [{ kind: 'skipped', sceneKind: 'parcel-flora' }]);
});

// ---------------------------------------------------------------------------
// contract: r3f-semantic-layer-maps-faithfully
// ---------------------------------------------------------------------------

test('r3f-semantic-layer-maps-faithfully: kind → mesh family, position → transform, status → variant', () => {
  const scene = buildScene(
    mkInput({
      territories: [mkTerritory({ wisps: [{ runId: 'r1', title: 'building unit-a' }] })],
    }),
  );
  // ⚠ THE WALK'S OWN POSITIONS: since ADR-0546 D1 the mapper un-projects nothing, so every transform
  // below is the World geometry's exactly — the scene's own coordinates, laid straight onto the
  // ground plane. Only the land-per-capability ratio is switched off (`null`): since 2026-09-06 an
  // island holding no capability is sized as one (`LAND_FLOOR_CAPABILITIES`), so the fixture's bare
  // territory no longer sits at the drawing's size by itself. The ratio's own default is held by its
  // tests at the bottom of this file.
  const descs = worldTo3D(scene, { landAreaPerCapability: null });

  // kind family → typed descriptor branch, transforms derived from the World geometry: each
  // cell-ground sits at ITS OWN parcel ring's centroid — the relaxed-mesh ground, the one
  // substrate this mapper accepts since the classic tile prism was retired
  // (`retire-the-old-land-path`). A parcel's position is an emergent property of the mesh
  // relaxation rather than a closed form like a hex centre, so what is pinned here is the
  // faithfulness property itself (real ring-derived geometry, distinct per parcel) rather than
  // a hand-computed coordinate a change to the relaxation algorithm would immediately stale.
  const grounds = descs.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
  assert.ok(grounds.length > 0, 'the mesh substrate draws at least one cell-ground parcel');
  for (const g of grounds) {
    assert.ok((g.points?.length ?? 0) >= 3, 'a parcel carries a ring it is possible to build a face from');
    assert.ok(
      Number.isFinite(g.transform.x) && Number.isFinite(g.transform.z),
      'a parcel transform is real geometry, not a placeholder',
    );
  }
  const positions = new Set(grounds.map((g) => `${g.transform.x.toFixed(3)},${g.transform.z.toFixed(3)}`));
  assert.equal(positions.size, grounds.length, 'no two parcels collapse onto the same position');

  // ⚠ NOTHING STANDS AT THE TERRITORY'S `treeSpot` ANY MORE (ADR-0508). This used to assert one
  // `story-tree` instance at (100, 190) — the placeholder cone the 3D map drew at every island's
  // centre. The tree group is now SKIPPED, so the faithfulness claim here is the negative one, and
  // it is checked at the spot rather than by kind: a family that reappeared under a different name
  // would still fail.
  assert.ok(
    !descs
      .filter(asInstance)
      .some((d) => Math.abs(d.transform.x - 100) < 1 && Math.abs(d.transform.z - 190) < 1),
    'no instance stands at the territory’s treeSpot',
  );

  // each visible trail segment carries its routed polyline on the ground plane
  // (y = 0 throughout), width from the ONE shared rule, and its reveal metadata.
  const visible = BASE_TRAILS.segments.filter((s) => !s.hidden);
  const strips = descs.filter((d): d is InstanceDescriptor => d.kind === 'trail-strip');
  assert.equal(strips.length, visible.length, 'one trail-strip per visible segment');
  const byId = new Map(strips.map((s) => [s.segment, s]));
  for (const seg of visible) {
    const strip = byId.get(seg.id);
    assert.ok(strip, `a strip exists for segment ${seg.id}`);
    assert.ok(strip.points && strip.points.length >= 2, 'trail-strip carries its polyline');
    // the strip's endpoints are the segment's smoothed endpoints (the d's M / final C
    // anchor, r2-rounded by the core)
    const first = seg.points[0]!;
    const last = seg.points[seg.points.length - 1]!;
    closeTo(strip.points[0]!.x, first.x, 'strip start x from the routed segment');
    closeTo(strip.points[0]!.z, first.y, 'strip start z from the routed segment');
    closeTo(strip.points[strip.points.length - 1]!.x, last.x, 'strip end x');
    closeTo(strip.points[strip.points.length - 1]!.z, last.y, 'strip end z');
    for (const p of strip.points) assert.equal(p.y, 0, 'strips lie on the ground plane');
    assert.equal(strip.width, trailFillWidth(seg.usage), 'width = trailFillWidth(usage)');
    assert.equal(strip.usage, seg.usage, 'usage rides the descriptor');
    assert.equal(strip.hidden, false, 'a fill-pass strip is not hidden');
    assert.deepEqual(strip.edges, ['library->cli'], 'the edge keys ride the descriptor');
  }

  // the wisp orbits its territory's centroid.
  const sprites = descs.filter((d): d is InstanceDescriptor => d.kind === 'wisp-sprite');
  assert.equal(sprites.length, 1, 'one wisp-sprite per in-flight wisp');
  closeTo(sprites[0]!.transform.x, 100, 'wisp x = territory centroid.x');
  closeTo(sprites[0]!.transform.z, 200, 'wisp z = territory centroid.y');

  // folded SceneStatus → a distinct material variant per status.
  for (const status of ['healthy', 'unhealthy', 'proposed', 'building'] as const) {
    const ds = worldTo3D(buildScene(mkInput({ territories: [mkTerritory({ status })] })));
    const cellsForStatus = ds.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
    assert.ok(cellsForStatus.length > 0, `${status}: expected at least one cell-ground descriptor`);
    for (const gd of cellsForStatus) {
      assert.equal(gd.material, status, `cell-ground material reflects '${status}'`);
    }
    // The `story-tree` material used to be re-asked here. The family is retired (ADR-0508) and
    // the LAND is where a story's state is read now (ADR-0475 D2) — which the `cell-ground` loop
    // above is exactly the check for, so nothing was lost with the second reading.
  }
});

// ---------------------------------------------------------------------------
// core kind families → typed instance descriptors
// ---------------------------------------------------------------------------

test('worldTo3D maps the relaxed-mesh ground to cell-ground descriptors via the real core', () => {
  // mkInput builds the mesh substrate — the shipped studio's own ground representation, and the
  // only one worldTo3D still accepts.
  const descs = worldTo3D(buildScene(mkInput()));
  const grounds = descs.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
  assert.ok(grounds.length > 0, 'the real core emits at least one parcel for the mesh substrate');
});

test('worldTo3D REFUSES a classic-substrate (tile) scene — the old land path is retired, not silently dropped', () => {
  // ⚠⚠ THE MESSAGE IS PINNED IN FULL, deliberately, rather than pattern-matched. This is the
  // assertion `retire-the-old-land-path` exists for: a `tile` group is a kind this mapper
  // understands and used to draw, so degrading it to a silent
  // `{ kind: 'skipped', sceneKind: 'tile' }` would silently reproduce the exact 2026-08-28
  // defect (a shipped island with no ground at all,
  // `docs/research/chapter2-shipped-baseline-2026-08-28/`) with no record anywhere that
  // anything had gone wrong. The refusal's WORDING is the thing worth protecting — a mutant that
  // softened or genericised the message would slip past a loose `.match(/refused/)` — so the
  // whole string is pinned here rather than a substring.
  const classic: SceneG = {
    el: 'g',
    kind: 'tile',
    status: 'healthy',
    children: [{ el: 'path', kind: 'tile-top', d: 'M 0 0 L 10 0 L 10 10 L 0 10 Z' }],
  };
  assert.throws(
    () => worldTo3D(classic),
    (err: unknown) =>
      err instanceof Error &&
      err.message ===
        'world-to-3d: the 3D map draws the relaxed-mesh land only — the classic extruded-hex ' +
          'ground was retired (adopt-the-land-into-the-shipped-map-arc, retire-the-old-land-path); ' +
          'build the scene with relaxedCells, not drawTiles',
  );
});

test('worldTo3D SKIPS the story tree — the island keeps its parcels and its blooms, and stands no cone', () => {
  // ⚠⚠ THE RETIREMENT, PROVED AT THE SEAM IT WAS MADE AT (ADR-0508). Until 2026-09-04 this test
  // read "one story-tree descriptor per territory" and the shipped canvas drew a cylinder trunk
  // under a cone crown at every island's centre. The owner retired it — each island stands its
  // kit trees now — and the mapper is where it went, because every downstream reader of what stands on the map
  // (the canvas, `groundCasters`, and through `shippedCasters()` every comparison page) reaches it
  // through this function.
  const uatCriteria = [{ id: 'sig-1', state: 'proven' as const }];
  const descs = worldTo3D(buildScene(mkInput({ territories: [mkTerritory({ uatCriteria })] })));

  // 1. NO DRAWABLE, under any name. Asking for the retired kind alone would pass just as well if
  //    the mapper had renamed the cone; this asks what the island actually stands.
  const instanceKinds = [...new Set(descs.filter(asInstance).map((d) => String(d.kind)))].sort();
  assert.deepEqual(instanceKinds, ['cell-ground', 'trail-strip', 'uat-bloom']);

  // 2. AND THE ISLAND IS OTHERWISE INTACT — this removes ONE object, it does not thin the map.
  //    (`comparison-baseline-moves-under-the-page`: a retirement that quietly took the parcels or
  //    the signatures with it would still satisfy assertion 1.)
  const own = (kind: string) => descs.filter(asInstance).filter((d) => d.kind === kind);
  assert.ok(own('cell-ground').length > 0, 'the island keeps its parcels');
  assert.equal(own('uat-bloom').length, 1, 'and its one signed criterion');
  assert.ok(
    own('cell-ground').every((d) => d.island === TERRITORY_ID),
    'and every parcel still names its story',
  );

  // 3. AND THE MAPPER SAYS SO OUT LOUD. A silent drop and a recorded skip are different audit
  //    trails, and the total-coverage invariant is the one this family now rests on: a `tree`
  //    group is a kind the mapper understands and deliberately draws nothing for, exactly as it
  //    already does for the 1,088 other objects the semantic scene stands on this ground.
  assert.ok(
    descs.filter(asSkipped).some((s) => s.sceneKind === 'tree'),
    'the tree group is recorded as a SKIP, not dropped',
  );
});

test('worldTo3D maps visible trail segments to trail-strip descriptors — one per fill-pass segment', () => {
  const descs = worldTo3D(buildScene(mkInput()));
  const strips = descs.filter((d): d is InstanceDescriptor => d.kind === 'trail-strip');
  assert.equal(
    strips.length,
    BASE_TRAILS.segments.filter((s) => !s.hidden).length,
    'one trail-strip descriptor per visible segment',
  );
  // the shadow/casing passes contribute NO geometry — the ribbon supplies its own
  // look — but their paths still surface as explicit skips (total coverage).
  const skippedKinds = descs.filter(asSkipped).map((s) => s.sceneKind);
  assert.ok(skippedKinds.includes('trail-shadow'), 'shadow-pass paths skip explicitly');
  assert.ok(skippedKinds.includes('trail-casing'), 'casing-pass paths skip explicitly');
});

test('worldTo3D filters under-island runs into trail-ghost-strip — never a trail-strip (ADR-0169 §2)', () => {
  // the walled-in fixture forces the route under the ring: hidden ghost runs + caves
  const hidden = CAVE_TRAILS.segments.filter((s) => s.hidden);
  assert.ok(hidden.length > 0, 'the walled-in fixture forces hidden runs');
  const descs = worldTo3D(buildScene(mkInput({ trails: CAVE_TRAILS })));
  const ghosts = descs.filter((d): d is InstanceDescriptor => d.kind === 'trail-ghost-strip');
  assert.equal(ghosts.length, hidden.length, 'one ghost strip per hidden segment');
  for (const g of ghosts) {
    assert.equal(g.hidden, true, 'ghost strips are marked hidden');
    assert.ok(g.points && g.points.length >= 2, 'ghost strips still carry geometry');
  }
  // a hidden segment NEVER leaks into the visible strip family
  const stripIds = new Set(
    descs
      .filter((d): d is InstanceDescriptor => d.kind === 'trail-strip')
      .map((d) => d.segment),
  );
  for (const seg of hidden) {
    assert.ok(!stripIds.has(seg.id), `hidden segment ${seg.id} is not a visible strip`);
  }
});

test('worldTo3D maps cave portals to cave-arch descriptors — rim placement, bearing, mouth width', () => {
  assert.ok(CAVE_TRAILS.caves.length > 0, 'the walled-in fixture forces cave portals');
  // The walk's own placement — the ratio switched off as above; nothing else is in the way.
  const descs = worldTo3D(buildScene(mkInput({ trails: CAVE_TRAILS })), { landAreaPerCapability: null });
  const arches = descs.filter((d): d is InstanceDescriptor => d.kind === 'cave-arch');
  assert.equal(arches.length, CAVE_TRAILS.caves.length, 'one cave-arch per portal');
  // match by island + edge set (portal order is preserved by buildScene)
  for (const [i, cave] of CAVE_TRAILS.caves.entries()) {
    const arch = arches[i]!;
    assert.equal(arch.island, cave.islandId, 'the portal knows its island');
    closeTo(arch.transform.x, cave.x, 'portal x from the rim translate');
    closeTo(arch.transform.z, cave.y, 'portal z from the rim translate');
    assert.equal(arch.transform.y, 0, 'portals sit on the ground plane');
    // bearing round-trips the core's 0.1°-rounded rotate (≤ ~0.001 rad error)
    assert.ok(
      Math.abs((arch.bearing ?? Infinity) - cave.bearing) < 0.01,
      `portal bearing (got ${arch.bearing}, want ~${cave.bearing})`,
    );
    // mouth width round-trips the baked half-disc (hw is 0.1-rounded → ≤ ~0.07 error)
    assert.ok(
      Math.abs((arch.width ?? Infinity) - cave.width) < 0.15,
      `portal width (got ${arch.width}, want ~${cave.width})`,
    );
    assert.deepEqual(arch.edges, cave.edgeIds, 'the portal carries its edge ids');
    assert.equal(arch.material, 'unknown', 'no territory for the island → unknown status');
  }
});

test('worldTo3D maps in-flight build wisps to wisp-sprite descriptors — one per wisp', () => {
  const scene = buildScene(
    mkInput({
      territories: [
        mkTerritory({
          wisps: [
            { runId: 'run-1', title: 'building unit-a' },
            { runId: 'run-2', title: 'building unit-b' },
          ],
        }),
      ],
    }),
  );
  const sprites = worldTo3D(scene).filter((d): d is InstanceDescriptor => d.kind === 'wisp-sprite');
  assert.equal(sprites.length, 2, 'one wisp-sprite descriptor per in-flight wisp');
});

// ---------------------------------------------------------------------------
// non-core / unknown kinds → explicit skip, never a throw
// ---------------------------------------------------------------------------

test('r3f-unknown-kind-skips-visibly: an unhandled SceneKind yields a named skip, never a throw', () => {
  // The real buildScene output contains many non-core structural kinds:
  // world, ground-hex, tile-side, tile-top, trails-layer, trail-shadow, trail-casing,
  // trail-edges, flora-layer, territory, shadow, trunk, crown-lo, crown-hi, plate,
  // plate-bg, plate-id, plate-sub, hits-layer, hit, …  Each must produce
  // { kind: 'skipped', sceneKind } rather than throwing or silently disappearing.
  const descs = worldTo3D(buildScene(mkInput()));
  const skipped = descs.filter(asSkipped);
  assert.ok(skipped.length > 0, 'structural / non-core nodes must produce skipped descriptors');
  for (const s of skipped) {
    assert.equal(typeof s.sceneKind, 'string', 'each skipped descriptor carries the original SceneKind');
    assert.ok(s.sceneKind.length > 0, 'sceneKind is non-empty');
  }

  // A kind this mapper has never heard of (a FUTURE core addition) degrades to an
  // explicit named skip — the mapper may lag the core, never crash the site's 3D island.
  const novel: SceneG = {
    el: 'g',
    children: [{ el: 'g', children: [], kind: 'lava-flow' as SceneKind }],
  };
  const out = worldTo3D(novel);
  assert.deepEqual(
    out.filter(asSkipped).map((s) => s.sceneKind),
    ['lava-flow'],
    'the unknown kind is skipped BY NAME — visible in output, not silently dropped',
  );
});

/** Every marker WRAPPER the built scene carries, as `criterion id -> wrapper kind` — read off the
 *  scene itself rather than off the fixture, so the test asks what actually reached the map. */
function markersInScene(node: SceneNode, out = new Map<string, string>()): Map<string, string> {
  if (node.el === 'g') {
    const kind = String(node.kind ?? '');
    if ((UAT_MARKER_KINDS as readonly string[]).includes(kind) && node.id !== undefined) {
      out.set(node.id, kind);
    }
    for (const child of node.children) markersInScene(child, out);
  }
  return out;
}

test('⚠⚠ EVERY UAT CRITERION IS DRAWN — the absence of a flower means NO CRITERION and nothing else', () => {
  // ⚠⚠ THE PROPERTY THIS TEST EXISTS FOR (ADR-0600 D2), AND IT IS DELIBERATELY NOT "BUDS RENDER".
  // A test that only checked buds appear would pass on a map that still silently dropped some
  // OTHER state, which is the exact shape of the defect it replaces. So it asserts a TOTAL: every
  // marker wrapper the scene actually built has its own instance descriptor, matched by criterion
  // id, and the two sets are equal in both directions.
  //
  // ⚠ WHAT IT REPLACES, AND WHY THAT TEST WAS RIGHT UNTIL IT WAS WRONG. From 2026-08-31 to
  // 2026-09-23 this slot held the opposite assertion — only `proven` maps, `pending` and `failing`
  // skip BY NAME — fencing the map against asserting a signature nobody gave (ADR-0392 D5 /
  // ADR-0398 D7). That fence was right about the CRITERION and wrong about the ISLAND: measured
  // across the live corpus, 35 of 104 criteria were drawn as nothing, nine islands read as holding
  // no acceptance work at all, and three read as fully proven while holding unsigned criteria
  // (`docs/research/chapter2-uat-silence-2026-09-23/`). The fence is not dropped, it MOVED: an
  // unsigned criterion has its own descriptor kind, so nothing that filters on `uat-bloom` can see
  // one — which the next test pins.
  const uatCriteria = [
    { id: 'a', state: 'proven' as const },
    { id: 'b', state: 'pending' as const },
    { id: 'c', state: 'failing' as const },
    { id: 'd', state: 'pending' as const },
  ];
  const bare = worldTo3D(buildScene(mkInput({ territories: [mkTerritory({})] })));
  const scene = buildScene(mkInput({ territories: [mkTerritory({ uatCriteria })] }));
  const withFlowers = worldTo3D(scene);

  const markers = markersInScene(scene);
  assert.equal(markers.size, uatCriteria.length, 'the fixture did not reach the scene as four markers');

  const drawn = withFlowers.filter(asInstance).filter(isUatCriterion);
  // ⚠ MATCHED BY ID IN BOTH DIRECTIONS. A count alone would pass on a mapper that drew one
  // criterion twice and another not at all — which is a misreport of exactly the kind this
  // decision is about, wearing a correct total.
  assert.deepEqual(
    [...drawn].map((d) => d.criterion).sort(),
    [...markers.keys()].sort(),
    'a criterion reached the map with no descriptor, or a descriptor stands for no criterion',
  );
  for (const d of drawn) {
    assert.equal(
      d.kind,
      UAT_MARKER_DESCRIPTOR[markers.get(d.criterion!) as keyof typeof UAT_MARKER_DESCRIPTOR],
      `criterion ${d.criterion} was drawn in the wrong state`,
    );
    assert.equal(d.island, TERRITORY_ID, 'every criterion names the story whose island it is on');
  }

  // NO wrapper degrades to a skip any more — the half of total coverage that changed.
  const skips = withFlowers.filter(asSkipped).map((s) => s.sceneKind);
  for (const wrapper of UAT_MARKER_KINDS) {
    assert.ok(!skips.includes(wrapper), `${wrapper} is drawn now, not skipped`);
  }
  // The flower BODY marks still do, which is the half that did not.
  assert.ok(skips.includes('tall-flower-petal'), 'a flower body mark still skips by name');

  // And the island is otherwise untouched: the markers add criterion descriptors and nothing else
  // — no stray ground, no second tree. Comparing the non-criterion instances against the
  // flowerless island is a sharper claim than counting criteria alone.
  assert.deepEqual(
    withFlowers.filter(asInstance).filter((d) => !isUatCriterion(d)),
    bare.filter(asInstance),
  );
});

test('⚠ A BUD IS NOT A SIGNATURE — the three states are three kinds, so no `uat-bloom` filter can see one', () => {
  // ⚠⚠ THE FENCE, RESTATED WHERE IT NOW LIVES. `uat-bloom` means "the owner SIGNED this" and
  // nothing else (ADR-0392 D5 / ADR-0398 D7). The reason ADR-0600 D1 is carried by three KINDS
  // rather than by one kind with a `state` field is that every consumer already written —
  // `signedCriteriaByIsland`, the harness counts — filters on the kind, so the safe reading is the
  // one you get by doing nothing. A state field would have made the safe reading the one you have
  // to remember.
  const uatCriteria = [
    { id: 'a', state: 'proven' as const },
    { id: 'b', state: 'pending' as const },
    { id: 'c', state: 'pending' as const },
    { id: 'd', state: 'failing' as const },
  ];
  const out = worldTo3D(buildScene(mkInput({ territories: [mkTerritory({ uatCriteria })] })));
  const of = (kind: string): InstanceDescriptor[] => out.filter(asInstance).filter((d) => d.kind === kind);

  assert.deepEqual(of('uat-bloom').map((d) => d.criterion), ['a'], 'only the signed one is a bloom');
  assert.deepEqual(of('uat-bud').map((d) => d.criterion).sort(), ['b', 'c'], 'the unsigned two are buds');
  assert.deepEqual(of('uat-wilt').map((d) => d.criterion), ['d'], 'the failing one is a wilt');

  // ⚠ AND THE THREE KINDS ARE DISTINCT VALUES, asserted rather than assumed. A table that mapped
  // two states onto one kind would satisfy every count above on a fixture with one of each, and
  // would silently merge them on the real map.
  assert.equal(new Set(Object.values(UAT_MARKER_DESCRIPTOR)).size, UAT_MARKER_KINDS.length);
  assert.deepEqual([...UAT_CRITERION_KINDS].sort(), ['uat-bloom', 'uat-bud', 'uat-wilt']);

  // ⚠ THE INSTANCING GROUP IS THE KIND, per state. Merging the three into one group would draw
  // every criterion with one prop and undo the whole decision at the canvas rather than here.
  for (const d of out.filter(asInstance).filter(isUatCriterion)) assert.equal(d.group, d.kind);
});

test('⚠ A NEW MARKER STATE CANNOT REACH THE MAP UNDRAWN — the table is exhaustive over the core\'s own MarkerState', () => {
  // ⚠⚠ THE GUARD IS THE TYPECHECK, NOT THIS TEST, and this test is here to say so where a reader
  // will look. `UAT_MARKER_DESCRIPTOR` is declared `satisfies Record<\`tall-flower-${MarkerState}\`,
  // InstanceKind>` over the type `@storytree/forest-world` exports, so a fourth marker state added
  // there reds `pnpm typecheck` in THIS package with a missing-key error. No runtime assertion can
  // do that job: the failure it guards against is a criterion arriving in a state nobody wrote a
  // case for, which by construction no fixture written today can contain.
  //
  // What IS checkable at runtime is that the table's keys really are the scene's wrapper kinds —
  // the two-place agreement that would otherwise be a comment.
  assert.deepEqual(
    [...UAT_MARKER_KINDS].sort(),
    ['tall-flower-failing', 'tall-flower-pending', 'tall-flower-proven'],
  );
  const scene = buildScene(
    mkInput({
      territories: [
        mkTerritory({
          uatCriteria: [
            { id: 'a', state: 'proven' },
            { id: 'b', state: 'pending' },
            { id: 'c', state: 'failing' },
          ],
        }),
      ],
    }),
  );
  assert.deepEqual([...new Set(markersInScene(scene).values())].sort(), [...UAT_MARKER_KINDS].sort());
});

test('r3f garden composition (grounded-art inc 11, ADR-0221): baked heroes + flat accents add ZERO 3D instances and skip by name', () => {
  // The cosy-island garden is studio-only + flag-only; the website never sends `garden`, so R3F never
  // sees it in production. This test asserts that IF it did, every garden node is a NAMED skip (never a
  // stray 3D instance): the heroes ride the ADR-0218 baked-art family R3F already skips, and the new flat
  // accent kinds (lavender/grass) auto-skip via the mapper's default — the coverage the plan's Unit 5 asks.
  const gHero = (height: number) => ({
    nodes: [{ el: 'polygon' as const, points: '0,0 5,0 0,-5', fill: '#cba', stroke: '#210', strokeWidth: 0.3 }],
    width: 10,
    height,
  });
  const garden = {
    islandId: 'library',
    heroes: { cottage: gHero(21.8), gazebo: gHero(15.4), 'autumn-tree': gHero(20.6), 'stepping-stone': gHero(6.3) },
  };
  const uatCriteria = [{ id: 'a', state: 'proven' as const }];
  const bare = worldTo3D(buildScene(mkInput({ territories: [mkTerritory({ uatCriteria })] })));
  const withGarden = worldTo3D(buildScene(mkInput({ territories: [mkTerritory({ uatCriteria })], garden })));

  const skips = withGarden.filter(asSkipped).map((s) => s.sceneKind);
  assert.ok(skips.includes('baked-art'), 'the baked hero + stone placements skip by name');
  assert.ok(skips.includes('baked-defs'), 'the baked-defs layer skips by name');
  assert.ok(skips.includes('garden-lavender-stem'), 'the lavender accent skips by name');
  assert.ok(skips.includes('garden-grass-blade'), 'the grass accent skips by name');
  // The garden's own island suppresses the UAT scatter; this fixture's garden names a DIFFERENT
  // island, so the territory keeps its markers — and since 2026-08-31 a signed one is a `uat-bloom`
  // instance rather than a skip. What the assertion is here for is unchanged: the garden adds no
  // drawable of its own, and the flowers it does not suppress are the map's, not the garden's.
  assert.equal(
    withGarden.filter(asInstance).filter((d) => d.kind === 'uat-bloom').length,
    1,
    'the one signed criterion still becomes exactly one bloom beside the garden',
  );

  // no garden node became a real instance.
  for (const d of withGarden.filter(asInstance)) {
    const kind = String(d.kind);
    assert.ok(!kind.startsWith('garden-') && kind !== 'baked-art', `${kind} must not be a 3D instance`);
  }
  // ⚠ THE GARDEN/BARE ASYMMETRY THIS TEST USED TO CLOSE ON IS GONE, and it went by the general
  // case rather than by the exception. The garden island's baked hero tree REPLACED the procedural
  // `story-tree`, so the pair of assertions here read "the garden island has none, the default
  // island keeps one". Since ADR-0508 NEITHER island has one — the mapper skips every `tree` group
  // — so the two arms agree, and what the garden suppresses is now only its own accents (asserted
  // by name above).
  for (const arm of [withGarden, bare]) {
    assert.ok(
      !arm.filter(asInstance).some((d) => String(d.kind).includes('tree')),
      'neither the garden island nor the default one stands a tree drawable',
    );
  }
});

// ---------------------------------------------------------------------------
// folded status flows to the material variant
// ---------------------------------------------------------------------------

test('worldTo3D folds the territory status into the material on cell-ground descriptors', () => {
  for (const status of ['healthy', 'unhealthy', 'proposed'] as const) {
    const descs = worldTo3D(
      buildScene(mkInput({ territories: [mkTerritory({ status })] })),
    );
    const grounds = descs.filter((d): d is InstanceDescriptor => d.kind === 'cell-ground');
    assert.ok(grounds.length > 0, `${status}: expected at least one cell-ground descriptor`);
    for (const g of grounds) {
      assert.equal(g.material, status, `cell-ground material must reflect '${status}' territory`);
    }
  }
});

// ⚠ 'worldTo3D folds the territory status into the material on the story-tree descriptor' IS
// DELETED HERE (ADR-0508), not weakened. There is no `story-tree` descriptor to carry a material,
// and the fact it stood for — a story's state reaching the 3D map — is asserted by its
// `cell-ground` sibling directly above. That is not a downgrade: ADR-0475 D2 already made the LAND
// the place the state is read, uniformly across the island, and the retired cone was a second copy
// of that one signal rather than a second signal.

// ---------------------------------------------------------------------------
// instance descriptor shape: 3D transform + instancing group
// ---------------------------------------------------------------------------

test('all instance descriptors carry a 3D transform with numeric x, y, z coordinates', () => {
  // Use a scene that exercises the core families (ground, tree, trail, wisp)
  const scene = buildScene(
    mkInput({
      territories: [mkTerritory({ wisps: [{ runId: 'r1', title: 'building' }] })],
    }),
  );
  const instances = worldTo3D(scene).filter(asInstance);
  assert.ok(instances.length > 0, 'at least one instance descriptor in a full scene');
  for (const inst of instances) {
    const { transform } = inst;
    assert.ok(transform != null, 'transform is present');
    assert.equal(typeof transform.x, 'number', 'transform.x is a number');
    assert.equal(typeof transform.y, 'number', 'transform.y is a number');
    assert.equal(typeof transform.z, 'number', 'transform.z is a number');
    assert.ok(
      Number.isFinite(transform.x) && Number.isFinite(transform.y) && Number.isFinite(transform.z),
      'transform coordinates are finite',
    );
  }
});

test('all instance descriptors carry a non-empty instancing group string', () => {
  const descs = worldTo3D(buildScene(mkInput()));
  const instances = descs.filter(asInstance);
  assert.ok(instances.length > 0, 'at least one instance descriptor');
  for (const inst of instances) {
    assert.equal(typeof inst.group, 'string', 'group is a string');
    assert.ok(inst.group.length > 0, 'group is non-empty');
  }
});

// ---------------------------------------------------------------------------
// The RELAXED-MESH ground — the substrate the studio actually ships
// ---------------------------------------------------------------------------
//
// ⚠ Between ADR-0123 and 2026-08-28 the mapper had a case for the classic `tile` hex only, so an
// island of the shape the product draws produced NO GROUND AT ALL — every parcel fell through to
// the default skip (`docs/research/chapter2-shipped-baseline-2026-08-28/`). These tests hold the
// `cell` case that closed it. They are hand-built scene fragments rather than a `buildScene`
// round trip on purpose: what has to be pinned is the mapper's reading of a SHAPE — a status
// stamped one level above its cells — and a fixture that happens to carry that shape today would
// stop testing it the day the core changed, silently.

/** A relaxed-mesh ground fragment: a `ground` group carrying the status, with plain `cell` paths
 *  under it carrying NONE — exactly what `scene.ts:3252` emits. */
function meshGround(
  rings: readonly (readonly (readonly [number, number])[])[],
  over: { status?: SceneStatus; kind?: SceneKind; transform?: string } = {},
): SceneG {
  const d = (r: readonly (readonly [number, number])[]) =>
    r.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`).join(' ') + ' Z';
  const cells: SceneNode[] = rings.map((r) => ({ el: 'path', kind: over.kind ?? 'cell', d: d(r) }));
  // ANNOTATED local, then guarded assignments — the shape `anti-slop`'s
  // no-conditional-empty-object-spread and no-known-value-widening both want, and it keeps the
  // fixture a real `SceneG` rather than something asserted into one.
  const group: SceneG = { el: 'g', kind: 'ground', children: cells };
  if (over.status !== undefined) group.status = over.status;
  if (over.transform !== undefined) group.transform = over.transform;
  return group;
}

const UNIT_SQUARE = [
  [0, 0],
  [0, 10],
  [10, 10],
  [10, 0],
] as const;

test('worldTo3D maps relaxed-mesh cells to cell-ground descriptors — one per parcel', () => {
  const ds = worldTo3D(meshGround([UNIT_SQUARE, UNIT_SQUARE, UNIT_SQUARE], { status: 'healthy' }));
  const cells = ds.filter(asInstance).filter((d) => d.kind === 'cell-ground');
  assert.equal(cells.length, 3);
  for (const c of cells) {
    assert.equal(c.group, 'cell-ground', 'the instancing group names the family');
    assert.equal(c.material, 'healthy');
    assert.equal(c.points?.length, 4, 'the ring, each vertex once — polyPath closes with Z');
  }
  // No parcel is left as a skip.
  assert.equal(ds.filter(asSkipped).filter((s) => s.sceneKind === 'cell').length, 0);
});

test('a cell-wheat parcel is the SAME ground, not a third drawable', () => {
  // The retired classic case used to fold its own `tile-top-wheat` into one `hex-ground` the same
  // way; folding here keeps the wheat look as the SAME drawable rather than inventing a family
  // this surface has no idea what to do with.
  const ds = worldTo3D(meshGround([UNIT_SQUARE], { status: 'mapped', kind: 'cell-wheat' }));
  const cells = ds.filter(asInstance).filter((d) => d.kind === 'cell-ground');
  assert.equal(cells.length, 1);
  assert.equal(cells[0]!.material, 'mapped');
  assert.equal(ds.filter(asSkipped).filter((s) => s.sceneKind === 'cell-wheat').length, 0);
});

test('⚠ a parcel INHERITS its territory status — reading the cell alone draws every parcel unknown', () => {
  // ⚠ THE LOAD-BEARING ONE. A plain relaxed `cell` carries NO status of its own; the core puts it
  // on the `<g kind="ground" status=…>` one level up. A mapper that read the cell would draw the
  // whole shipped map `unknown` — a map that has STOPPED REPORTING (ADR-0392 D5 / ADR-0398 D7),
  // not one that merely looks wrong.
  for (const status of ['healthy', 'unhealthy', 'proposed', 'mapped'] as const) {
    const cells = worldTo3D(meshGround([UNIT_SQUARE], { status }))
      .filter(asInstance)
      .filter((d) => d.kind === 'cell-ground');
    assert.equal(cells[0]!.material, status, `a parcel under a ${status} ground did not inherit it`);
  }
});

test('a cell’s OWN status wins over the inherited one — the parcels-present shape', () => {
  // `scene.ts:1718` stamps per-CAPABILITY status on each cell when parcels are present, which is
  // finer than the territory's and must not be overwritten by it.
  const scene: SceneG = {
    el: 'g',
    kind: 'ground',
    status: 'healthy',
    children: [
      { el: 'path', kind: 'cell', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 L 10.0 0.0 Z' },
      { el: 'path', kind: 'cell', status: 'unhealthy', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 L 10.0 0.0 Z' },
    ],
  };
  const materials = worldTo3D(scene)
    .filter(asInstance)
    .filter((d) => d.kind === 'cell-ground')
    .map((d) => d.material);
  assert.deepEqual(materials, ['healthy', 'unhealthy']);
});

// ---------------------------------------------------------------------------
// WHICH CAPABILITY A CELL BELONGS TO — the identity the shipped stream used to drop
// ---------------------------------------------------------------------------
//
// ⚠ Until 2026-08-30 a `cell-ground` descriptor carried the FOLDED status and the ring and
// nothing else, so a consumer could draw the ground and could NOT say which capability any part
// of it reported on. That makes ADR-0475's ONE OBJECT PER CAPABILITY inexpressible on the shipped
// path — and anything else that has to be counted per capability with it. `groundCellsFrom`
// (`harness/island-descriptors.ts`) had read the identity off the scene since PR #1693; these
// tests hold the same reading here, and a probe against the real fixture agrees with it exactly
// (164 cells, 11 parcels, identical id sets).

/** A relaxed-mesh ground fragment with real `parcel` groups between the ground and its cells —
 *  the shape `scene.ts` emits when parcels are present (`kind: 'parcel'`, `id` = the capability). */
function parcelledGround(
  parcels: readonly { id?: string; kind?: SceneKind; cells: number }[],
  groundStatus?: SceneStatus,
): SceneG {
  const cell: SceneNode = {
    el: 'path',
    kind: 'cell',
    d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 L 10.0 0.0 Z',
  };
  const groups: SceneNode[] = parcels.map((p) => {
    // ANNOTATED local, then a guarded assignment — `anti-slop/no-conditional-empty-object-spread`.
    const g: SceneNode = {
      el: 'g',
      kind: p.kind ?? 'parcel',
      children: Array.from({ length: p.cells }, () => cell),
    };
    if (p.id !== undefined) g.id = p.id;
    return g;
  });
  const ground: SceneG = { el: 'g', kind: 'ground', children: groups };
  if (groundStatus !== undefined) ground.status = groundStatus;
  return ground;
}

const parcelsOf = (scene: SceneG): (string | undefined)[] =>
  worldTo3D(scene)
    .filter(asInstance)
    .filter((d) => d.kind === 'cell-ground')
    .map((d) => d.parcel);

test('every cell carries the id of the parcel group it sits under', () => {
  assert.deepEqual(
    parcelsOf(parcelledGround([{ id: 'cap-a', cells: 2 }, { id: 'cap-b', cells: 1 }], 'healthy')),
    ['cap-a', 'cap-a', 'cap-b'],
    'the land is partitioned along the capability boundaries the scene declares',
  );
});

test('⚠ an id on a group that is NOT a parcel is IGNORED — the plausible-wrong-partition trap', () => {
  // ⚠ THE LOAD-BEARING ONE, and it is the reason this reads `kind` before it reads `id`. Every
  // `<g>` on an island carries an `id` for its own reasons — a territory, a trail edge, a hit
  // target — and a mapper that took `node.id` generally would partition the land along lines that
  // are not capability boundaries. It would do it INVISIBLY: the resulting picture is an ordinary
  // island, and every prop on it would assert about the wrong capability.
  for (const kind of ['ground', 'territory', 'trail-edge'] as const) {
    assert.deepEqual(
      parcelsOf(parcelledGround([{ id: 'not-a-capability', kind, cells: 2 }], 'healthy')),
      [undefined, undefined],
      `a <g kind="${kind}" id=…> was mistaken for a parcel`,
    );
  }
});

test('a substrate with no parcel groups says so — absent, never a placeholder', () => {
  // Absent is a real answer: a consumer must be able to tell "this cell belongs to capability X"
  // from "this substrate does not say". A `''` or an `'unknown'` here would read as an identity.
  const cells = worldTo3D(meshGround([UNIT_SQUARE, UNIT_SQUARE], { status: 'healthy' }))
    .filter(asInstance)
    .filter((d) => d.kind === 'cell-ground');
  for (const c of cells) {
    assert.equal(c.parcel, undefined);
    assert.ok(!('parcel' in c), 'the key must be absent, not present-and-undefined');
  }
});

test('a parcel group with no id of its own does not invent one', () => {
  assert.deepEqual(parcelsOf(parcelledGround([{ cells: 2 }], 'healthy')), [undefined, undefined]);
});

test('a parcel id reaches a cell nested deeper than one level', () => {
  // The core is free to put a wrapper between a parcel and its cells; the identity has to survive
  // it, exactly as the status does.
  const scene: SceneG = {
    el: 'g',
    kind: 'ground',
    status: 'healthy',
    children: [
      {
        el: 'g',
        kind: 'parcel',
        id: 'cap-deep',
        children: [
          {
            el: 'g',
            children: [
              { el: 'path', kind: 'cell', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 L 10.0 0.0 Z' },
            ],
          },
        ],
      },
    ],
  };
  assert.deepEqual(parcelsOf(scene), ['cap-deep']);
});

test('an inner parcel group wins over the outer one it sits in', () => {
  // Nesting is not expected from the core today, and "the nearest declaration wins" is the same
  // rule status already follows — so the two cannot drift into disagreeing about which ancestor
  // an inherited value comes from.
  const scene: SceneG = {
    el: 'g',
    kind: 'ground',
    status: 'healthy',
    children: [
      {
        el: 'g',
        kind: 'parcel',
        id: 'outer',
        children: [
          {
            el: 'g',
            kind: 'parcel',
            id: 'inner',
            children: [
              { el: 'path', kind: 'cell', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 L 10.0 0.0 Z' },
            ],
          },
          { el: 'path', kind: 'cell', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 L 10.0 0.0 Z' },
        ],
      },
    ],
  };
  assert.deepEqual(parcelsOf(scene), ['inner', 'outer']);
});

test('the parcel identity is independent of the status — two capabilities in one state stay distinct', () => {
  // ⚠ `material` is the FOLDED status, so it cannot stand in for identity: eleven `healthy`
  // capabilities are eleven copies of one value. That is exactly the real fixture's shape.
  const ds = worldTo3D(
    parcelledGround([{ id: 'cap-a', cells: 1 }, { id: 'cap-b', cells: 1 }], 'healthy'),
  )
    .filter(asInstance)
    .filter((d) => d.kind === 'cell-ground');
  assert.deepEqual(ds.map((d) => d.material), ['healthy', 'healthy']);
  assert.deepEqual(ds.map((d) => d.parcel), ['cap-a', 'cap-b']);
});

test('a cell-wheat parcel carries its identity too — the same ground wearing a wheat look', () => {
  assert.deepEqual(
    parcelsOf(
      ({
        el: 'g',
        kind: 'ground',
        status: 'mapped',
        children: [
          {
            el: 'g',
            kind: 'parcel',
            id: 'cap-wheat',
            children: [
              {
                el: 'path',
                kind: 'cell-wheat',
                d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 L 10.0 0.0 Z',
              },
            ],
          },
        ],
      }) satisfies SceneG,
    ),
    ['cap-wheat'],
  );
});

test('no other family carries a parcel — it is a cell-ground field', () => {
  // A `tile` IS a territory on the classic substrate, so a parcel id there would be an identity
  // the scene never declared. The whole descriptor stream is swept rather than one family, so a
  // future family that started carrying one would have to say so here.
  for (const d of worldTo3D(buildScene(mkInput({ trails: CAVE_TRAILS }))).filter(asInstance)) {
    if (d.kind === 'cell-ground') continue;
    assert.ok(!('parcel' in d), `${d.kind} carries a parcel id`);
  }
});

// ---------------------------------------------------------------------------
// THE ISLAND IDENTITY — which STORY a descriptor belongs to
// ---------------------------------------------------------------------------
//
// ⚠⚠ A CAPABILITY'S PARCEL AND A STORY'S ISLAND ARE DIFFERENT QUESTIONS, and the map needs both.
// A capability's tree stands on its own parcel; a story's SIGNED UAT criterion belongs to the
// whole island and to no capability on it. Until 2026-08-31 the descriptor stream answered only
// the first, so both shipped call sites had to pass `blooms: 0` — a per-story count read off a
// parcel-only stream scatters one story's signatures across every other story's island.

/** The island ids the mapper stamps on one family, in emission order. */
const islandsOf = (scene: SceneG, kind: string): (string | undefined)[] =>
  worldTo3D(scene)
    .filter(asInstance)
    .filter((d) => d.kind === kind)
    .map((d) => d.island);

test('a cell inherits the ISLAND id from its ground group, one level above its parcel', () => {
  const scene: SceneG = {
    el: 'g',
    kind: 'ground-mesh',
    children: [
      {
        el: 'g',
        kind: 'ground',
        id: 'atlas',
        status: 'healthy',
        children: [
          {
            el: 'g',
            kind: 'parcel',
            id: 'cap-a',
            children: [{ el: 'path', kind: 'cell', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 Z' }],
          },
        ],
      },
      {
        el: 'g',
        kind: 'ground',
        id: 'beacon',
        status: 'mapped',
        children: [
          {
            el: 'g',
            kind: 'parcel',
            id: 'cap-b',
            children: [{ el: 'path', kind: 'cell', d: 'M 50.0 0.0 L 50.0 10.0 L 60.0 10.0 Z' }],
          },
        ],
      },
    ],
  };
  assert.deepEqual(islandsOf(scene, 'cell-ground'), ['atlas', 'beacon']);
  // ⚠ AND THE TWO IDENTITIES DO NOT COLLAPSE INTO EACH OTHER. A mapper that read `node.id`
  // generally would give each cell its PARCEL's id as its island and draw a perfectly ordinary
  // island — so the assertion is that they differ, not merely that both are set.
  const cells = worldTo3D(scene)
    .filter(asInstance)
    .filter((d) => d.kind === 'cell-ground');
  assert.deepEqual(cells.map((c) => c.parcel), ['cap-a', 'cap-b']);
});

test('⚠ the island id is taken ONLY from a group that says it IS an island', () => {
  // Every `<g>` on the map carries an `id` for its own reasons. A parcel group's id is a
  // CAPABILITY, and inheriting it as the island would attribute a story's signatures to one of
  // its own capabilities — invisibly, because the island still draws correctly.
  const parcelOnly: SceneG = {
    el: 'g',
    kind: 'parcel',
    id: 'cap-a',
    status: 'healthy',
    children: [{ el: 'path', kind: 'cell', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 Z' }],
  };
  assert.deepEqual(islandsOf(parcelOnly, 'cell-ground'), [undefined], 'a parcel is not an island');
  for (const d of worldTo3D(parcelOnly).filter(asInstance)) {
    assert.ok(!('island' in d), 'a parcel id leaked in as an island');
  }

  // An anonymous wrapper carrying an id is not an island either.
  const wrapper: SceneG = {
    el: 'g',
    kind: 'hits-layer',
    id: 'not-a-story',
    status: 'healthy',
    children: [{ el: 'path', kind: 'cell', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 Z' }],
  };
  assert.deepEqual(islandsOf(wrapper, 'cell-ground'), [undefined], 'a layer is not an island');
});

test('the tree, the parcels and the blooms all name their island — the whole per-story family', () => {
  // The mesh substrate's `ground` group holds the cells and the `territory` group holds the tree
  // and the UAT markers: two groups, one `t.id`. (The classic substrate's `tile` used to be a
  // third such group — a tile IS a territory — until it was retired at the mapper along with the
  // rest of that substrate; see `ISLAND_GROUP_KINDS` in `world-to-3d.ts`.)
  const uatCriteria = [
    { id: 'sig-1', state: 'proven' as const },
    { id: 'sig-2', state: 'proven' as const },
  ];
  const scene = buildScene(mkInput({ territories: [mkTerritory({ uatCriteria })] }));
  const cellIslands = islandsOf(scene, 'cell-ground');
  assert.ok(cellIslands.length > 0, 'the mesh substrate draws at least one parcel');
  assert.ok(
    cellIslands.every((id) => id === TERRITORY_ID),
    'every parcel names the same story as its island',
  );
  // (`story-tree` was the third family read here; it is retired — ADR-0508 — so the island id it
  // carried has nothing left to attach to.)
  assert.deepEqual(islandsOf(scene, 'uat-bloom'), [TERRITORY_ID, TERRITORY_ID]);
  // ⚠ SORTED, NOT INSERTION ORDER. The core interleaves every territory drawable — tree, flora,
  // UAT markers — by its own Y coordinate for depth (`scene.ts`'s painter's-algorithm sort), and
  // on the mesh substrate a marker's Y is constrained to land ON a real parcel — a keep-in the
  // classic substrate's unconstrained scatter never applied. So which criterion's marker ends up
  // ABOVE the other in the scene tree is a substrate-dependent accident of that sort, never a
  // contract; what this test can honestly claim is that each bloom names ITS OWN criterion,
  // order aside.
  assert.deepEqual(
    worldTo3D(scene)
      .filter(asInstance)
      .filter((d) => d.kind === 'uat-bloom')
      .map((d) => d.criterion)
      .sort(),
    ['sig-1', 'sig-2'],
    'each bloom names the criterion it stands for',
  );
});

test('⚠ NO island group ⇒ the field is ABSENT, on every family that could carry one', () => {
  // ⚠⚠ ABSENT AND `undefined` ARE DIFFERENT DESCRIPTORS, and the difference is the whole reason the
  // assignment is guarded. Under `exactOptionalPropertyTypes` a consumer distinguishes "this
  // substrate does not say which story this is" from "this story is undefined" by asking `'island'
  // in d` — so a mapper that always assigned would hand every unattributed instance a key whose
  // value is undefined, and `cellsByIsland` would still drop it while every `in` check flipped.
  const marks: SceneNode[] = [
    { el: 'path', kind: 'tall-flower-petal', d: 'M 0 0 L 1 1' },
  ];
  const orphans: SceneG = {
    el: 'g',
    kind: 'hits-layer',
    status: 'healthy',
    children: [
      { el: 'g', kind: 'parcel', id: 'cap-a', children: [{ el: 'path', kind: 'cell', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 Z' }] },
      { el: 'g', kind: 'tree', children: [] },
      { el: 'g', kind: 'tall-flower-proven', id: 'sig-orphan', children: marks },
    ],
  };
  const got = worldTo3D(orphans).filter(asInstance);
  // ⚠ TWO FAMILIES, NOT THREE, SINCE ADR-0508: the `tree` group in this fixture is still walked
  // and still recorded, but as a SKIP rather than a `story-tree` instance, so it is no longer one
  // of the families that could invent an island.
  assert.deepEqual(got.map((d) => d.kind).sort(), ['cell-ground', 'uat-bloom']);
  for (const d of got) assert.ok(!('island' in d), `${d.kind} invented an island`);

  // ⚠ THE CLASSIC SUBSTRATE'S `tile` USED TO BE THE FOURTH FAMILY THIS TEST CHECKED — a `tile`
  // group was an island only when it said which. It is retired rather than merely renamed: a
  // `tile` group now REFUSES outright (see the dedicated refusal test), so there is no
  // `hex-ground` descriptor left to ask "did this one invent an island?" of. The fence this test
  // exists for — no family invents an island it was not told — is unaffected: the classic
  // substrate no longer reaches this code path at all.
});

test('a uat-bloom stands where the scene put its marker, in the family and status of its island', () => {
  // ⚠ The kit places its own flowers, so nothing downstream reads this transform today. It is
  // asserted because the descriptor is the map's RECORD of a signature: a bloom that reported the
  // origin, or an empty group string, would be a claim about a story with no place and no family.
  const scene: SceneG = {
    el: 'g',
    kind: 'territory',
    id: 'atlas',
    status: 'unhealthy',
    transform: 'translate(100 200)',
    children: [
      {
        el: 'g',
        kind: 'tall-flower-proven',
        id: 'sig-7',
        transform: 'translate(30 40) scale(1.4)',
        children: [{ el: 'path', kind: 'tall-flower-stem', d: 'M 0 0 L 1 1' }],
      },
    ],
  };
  const bloom = worldTo3D(scene)
    .filter(asInstance)
    .find((d) => d.kind === 'uat-bloom');
  assert.ok(bloom);
  assert.deepEqual(bloom.transform, { x: 130, y: 0, z: 240 }, 'the marker carries its ancestor translate');
  assert.equal(bloom.group, 'uat-bloom', 'the instancing group names the family');
  assert.equal(bloom.material, 'unhealthy', 'the bloom wears its ISLAND’s folded status');
  assert.equal(bloom.island, 'atlas');
  assert.equal(bloom.criterion, 'sig-7');
});

test('a uat-bloom with no status anywhere falls back to unknown, never to undefined or empty', () => {
  // The same rule every status-bearing family follows. `unknown` is the one state that means "no
  // data"; an empty string would be a status nothing in the palette can resolve.
  const bare: SceneG = {
    el: 'g',
    kind: 'tall-flower-proven',
    children: [{ el: 'path', kind: 'tall-flower-stem', d: 'M 0 0 L 1 1' }],
  };
  const bloom = worldTo3D(bare)
    .filter(asInstance)
    .find((d) => d.kind === 'uat-bloom');
  assert.equal(bloom?.material, 'unknown');
  assert.ok(!('criterion' in (bloom ?? {})), 'an unstamped marker names no criterion');
});

test('a family that spans islands carries NO island — a trail belongs to neither end', () => {
  // Absent is a real answer here. A trail strip runs between two islands, so any single id on it
  // would be a claim about ownership the scene never made.
  for (const d of worldTo3D(buildScene(mkInput())).filter(asInstance)) {
    if (d.kind === 'trail-strip' || d.kind === 'trail-ghost-strip') {
      assert.ok(!('island' in d), 'a trail strip claimed an island');
    }
  }
});

test('a cave portal keeps its OWN island id — the trails layer is outside every territory', () => {
  // ⚠ The portal is reached through the trails layer rather than through a territory group, so it
  // inherits nothing and carries `node.island` instead. A change that made inheritance win would
  // silently blank every portal's island.
  const arches = worldTo3D(buildScene(mkInput({ trails: CAVE_TRAILS })))
    .filter(asInstance)
    .filter((d) => d.kind === 'cave-arch');
  assert.ok(arches.length > 0, 'the cave fixture routes at least one portal');
  for (const arch of arches) {
    assert.equal(typeof arch.island, 'string', 'a portal with no island id');
  }
});

test('a parcel with no status anywhere falls back to unknown, never to undefined', () => {
  const cells = worldTo3D(meshGround([UNIT_SQUARE]))
    .filter(asInstance)
    .filter((d) => d.kind === 'cell-ground');
  assert.equal(cells[0]!.material, 'unknown');
});

test('a parcel’s ring and centre carry the ancestor translate', () => {
  // ⚠ The ring is in the scene's own coordinates; an ancestor `<g translate(...)>` has to reach
  // it or the island draws in the wrong place — off-by-a-translate is invisible on a single
  // island and obvious the moment there are two.
  const ds = worldTo3D(meshGround([UNIT_SQUARE], { status: 'healthy', transform: 'translate(100 200)' }));
  const cell = ds.filter(asInstance).find((d) => d.kind === 'cell-ground')!;
  assert.deepEqual(
    cell.points?.map((p) => [p.x, p.y, p.z]),
    [
      [100, 0, 200],
      [100, 0, 210],
      [110, 0, 210],
      [110, 0, 200],
    ],
  );
  // The transform is the ring's centroid, on the ground plane.
  closeTo(cell.transform.x, 105, 'parcel centre x');
  closeTo(cell.transform.y, 0, 'a parcel sits on the ground plane');
  closeTo(cell.transform.z, 205, 'parcel centre z');
});

test('a ring bounding no area is SKIPPED, not emitted as a degenerate parcel', () => {
  // ⚠ Two vertices bound no area. Emitting one would put a parcel in the drawable set that no
  // consumer can build a face from; skipping it keeps `cell-ground` a family whose members are
  // always drawable, and the skip is still an audit record rather than a silent drop.
  const ds = worldTo3D(
    meshGround(
      [
        [
          [0, 0],
          [10, 10],
        ],
        UNIT_SQUARE,
      ],
      { status: 'healthy' },
    ),
  );
  assert.equal(ds.filter(asInstance).filter((d) => d.kind === 'cell-ground').length, 1);
  const skips = ds.filter(asSkipped).filter((s) => s.sceneKind === 'cell');
  assert.equal(skips.length, 1, 'the degenerate parcel must still be recorded as a skip');
});

// ⚠ THIS NON-VACUITY CONTROL IS RETIRED, ITS PREMISE GONE RATHER THAN MERELY OLD. It used to prove
// that the `cell` case ADDED a representation rather than re-pointing the mapper from `tile` to
// `cell` — the same defect facing the other way — by asserting the classic substrate still drew
// `hex-ground` beside the new `cell-ground`. `retire-the-old-land-path` removed the thing the
// control was a non-vacuity check FOR: the classic substrate no longer draws ground at all, it
// REFUSES, so "does it still draw its hexes?" is no longer an available question. The property
// this control protected — a mapper that adds rather than swaps — is now covered the other
// direction by the dedicated refusal test above, which pins that a classic scene fails LOUDLY
// rather than silently losing its ground the way the pre-fix mapper did.

test('a TRIANGULAR parcel is drawn — three vertices bound an area', () => {
  // ⚠ The degeneracy guard is `< 3`, and `<= 3` would throw away every triangular parcel while
  // still passing every test built on quads. The relaxed mesh gives quads today, but a parcel
  // clipped against an island boundary is not obliged to keep four corners.
  const ds = worldTo3D(
    meshGround(
      [
        [
          [0, 0],
          [10, 0],
          [5, 8],
        ],
      ],
      { status: 'healthy' },
    ),
  );
  const cells = ds.filter(asInstance).filter((d) => d.kind === 'cell-ground');
  assert.equal(cells.length, 1, 'a triangular parcel was dropped');
  assert.equal(cells[0]!.points?.length, 3);
});

test('a non-cell leaf NEVER becomes a parcel — the guard is on the kind, not on being a path', () => {
  // ⚠ Widen that guard and every kinded leaf in the scene turns into ground: the classic tile's
  // own `tile-top` and `tile-side` paths are the ones immediately in reach, so a whole hex island
  // would draw twice, once as prisms and once as flat parcels.
  const scene: SceneG = {
    el: 'g',
    kind: 'ground',
    status: 'healthy',
    children: [
      { el: 'path', kind: 'tile-side', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 L 10.0 0.0 Z' },
      { el: 'path', kind: 'parcel-blade', d: 'M 0.0 0.0 L 0.0 10.0 L 10.0 10.0 Z' },
      // ⚠ A `cell` KIND on a non-path element — the guard is on both, and this is the arm that
      // says so.
      { el: 'circle', kind: 'cell', cx: 0, cy: 0, r: 5 },
    ],
  };
  const ds = worldTo3D(scene);
  assert.equal(ds.filter(asInstance).filter((d) => d.kind === 'cell-ground').length, 0);
  // They are still recorded as skips — total coverage, never a silent drop. (The enclosing
  // `ground` group is kinded too, so it contributes a fourth skip of its own.)
  const skipped = ds.filter(asSkipped).map((s) => s.sceneKind).sort();
  assert.deepEqual(skipped, ['cell', 'ground', 'parcel-blade', 'tile-side']);
});

test('every status-bearing family falls back to `unknown` when nothing above it carries a status', () => {
  // ⚠ Each family writes its own `status ?? 'unknown'`, so each is its own chance to fall back to
  // the empty string — a material no palette has an entry for, which draws as whatever the
  // canvas's own default happens to be rather than as an honest "this asserts nothing".
  const noStatus: SceneTerritoryInput = mkTerritory();
  delete (noStatus as Partial<SceneTerritoryInput>).status;
  const statusless = buildScene(mkInput({ territories: [noStatus] }));
  for (const d of worldTo3D(statusless).filter(asInstance)) {
    if (d.material === undefined) continue;
    assert.notEqual(d.material, '', `${d.kind} fell back to the empty string`);
    assert.equal(typeof d.material, 'string');
  }
  const parcels = worldTo3D(meshGround([UNIT_SQUARE])).filter(asInstance);
  assert.equal(parcels[0]!.material, 'unknown');
});

test('a status-bearing family reports ITS OWN status, never a constant', () => {
  // ⚠ `status ?? 'unknown'` mutated to `status && 'unknown'` reads identically until a status IS
  // present — and then every family on the map reports `unknown` while the code still looks like
  // it consults the status. That is the map lying, which ADR-0392 D5 / ADR-0398 D7 put beyond an
  // art call, so it is asserted per family rather than once.
  for (const status of ['healthy', 'unhealthy', 'mapped'] as const) {
    const ds = worldTo3D(buildScene(mkInput({ territories: [mkTerritory({ status })] })));
    const bearing = ds.filter(asInstance).filter((d) => d.material !== undefined);
    assert.ok(bearing.length > 0, 'no status-bearing family in the scene');
    for (const d of bearing) {
      assert.equal(d.material, status, `${d.kind} did not report the territory's own status`);
    }
    const parcel = worldTo3D(meshGround([UNIT_SQUARE], { status })).filter(asInstance)[0]!;
    assert.equal(parcel.material, status, 'a parcel did not report its own status');
  }
});

test('a CAVE PORTAL reports its island’s status too, and falls back to unknown without one', () => {
  // ⚠ The cave arch writes its own `status ?? 'unknown'`, and the existing portal test only ever
  // exercises the fallback (its fixture has no territory for the island). So the ?? has never had
  // a status to prefer, and `status && 'unknown'` — which makes every portal report `unknown`
  // whatever the island holds — reads identically on that fixture.
  const walled = mkInput({ trails: CAVE_TRAILS });
  assert.ok(CAVE_TRAILS.caves.length > 0, 'the walled-in fixture forces cave portals');
  for (const status of ['healthy', 'unhealthy'] as const) {
    const withTerritory = mkInput({
      ...walled,
      territories: [mkTerritory({ id: CAVE_TRAILS.caves[0]!.islandId, status })],
    });
    const arches = worldTo3D(buildScene(withTerritory)).filter(asInstance).filter((d) => d.kind === 'cave-arch');
    assert.ok(arches.length > 0, 'no portal in the scene');
    const own = arches.filter((a) => a.island === CAVE_TRAILS.caves[0]!.islandId);
    assert.ok(own.length > 0, 'the portal on the territory we gave a status is missing');
    for (const a of own) assert.equal(a.material, status, 'a portal did not report its island status');
  }
});

test('a cave portal with NO status ANYWHERE above it falls back to `unknown`', () => {
  // ⚠ THE EXISTING PORTAL TEST NO LONGER REACHES THIS, and the mutation sweep is what said so.
  // Its fixture has no territory for the island, so the portal used to see `undefined` — but
  // since parcels made the walk inherit an ancestor's status, the portal now inherits `unknown`
  // from a group above it and the `?? 'unknown'` literal is never evaluated. It still asserts
  // `unknown` and still passes, while testing a different thing than it used to. The fallback
  // needs a scene with no status anywhere in the ancestry to be exercised at all.
  const scene: SceneG = {
    el: 'g',
    children: [
      {
        el: 'g',
        kind: 'cave',
        transform: 'translate(10 20) rotate(0)',
        children: [{ el: 'path', kind: 'cave-arch', d: 'M 0 -8 A 8 8 0 0 1 0 8' }],
      },
    ],
  };
  const arches = worldTo3D(scene).filter(asInstance).filter((d) => d.kind === 'cave-arch');
  assert.equal(arches.length, 1);
  assert.equal(arches[0]!.material, 'unknown', 'the portal fell back to something other than unknown');
});

/* ── ⚠⚠ THE MAPPER ADDS NO GEOMETRY OF ITS OWN (ADR-0546 D1) ─────────────────────────────────
   Every test above that pins a position reads the scene's own coordinates back off the descriptors,
   and that is only legitimate because this is true. Between 2026-09-05 and 2026-09-08 it was NOT:
   the mapper un-projected the drawing per island (`restoreTrueFootprint`, ADR-0517 D1) and those
   tests had to ask for a plan-view scene to switch the repair off. The owner chose to build the 3D
   forest on TRUE GROUND instead, so the repair is deleted and the scene is expected to arrive true.
   This is the block that holds the mapper transparent. */

test('⚠⚠ the mapper lays the scene down as written: an authored ring comes back at the numbers it was authored with, not stretched about its island', () => {
  // The cell `parcelledGround` authors is the literal square (0, 0) → (10, 10), so its island's
  // centre is (5, 5) and the numbers below are the scene's own, read straight off the page.
  const scene: SceneG = {
    el: 'g',
    kind: 'ground',
    children: [{ ...parcelledGround([{ id: 'cap-a', cells: 1 }], 'healthy'), id: 'isle-a' }],
  };
  // The ratio is switched off: it scales an island about its own centre by a factor read off its
  // area, which would move these numbers for a reason that is not the mapper's walk. Its own
  // default is the next test's.
  const cells = worldTo3D(scene, { landAreaPerCapability: null }).filter(asInstance).filter((d) => d.kind === 'cell-ground');
  assert.equal(cells.length, 1);
  const ring = cells[0]!.points ?? [];
  assert.equal(ring.length, 4, 'the authored square');
  assert.deepEqual(
    [...new Set(ring.map((p) => p.z))].sort((a, b) => a - b),
    [0, 10],
    'the ring’s depths are the scene’s own numbers',
  );
  assert.deepEqual([...new Set(ring.map((p) => p.x))].sort((a, b) => a - b), [0, 10], 'and so are its widths');
  for (const p of ring) assert.equal(p.y, 0, 'a ground ring lies on the ground plane');
  // ⚠ THE DELETION'S OWN RED→GREEN. Until 2026-09-08 the mapper un-projected every ground z about
  // its island's centre (`restoreTrueFootprint`, ADR-0517 D1), so this ring came back at
  // 5 ± 5 / sin 20° = -9.62 and 19.62 — the numbers the assertion above now refuses.
  const stretched = 5 + 5 / Math.sin((20 * Math.PI) / 180);
  assert.ok(stretched > 19 && stretched < 20, `the repaired depth would have been ${stretched}`);
  assert.ok(!ring.some((p) => Math.abs(p.z - stretched) < 0.5), 'nothing was un-projected');
});

/* ---------------------------------------------------------------------------
   THE LAND-PER-CAPABILITY RATIO — the mapper's SECOND in-place resize (`land-per-capability.ts`).
   By default every island is sized to `capabilities × LAND_AREA_PER_CAPABILITY`; a number is a
   ladder rung; `null` is the instrument's "as the drawing gave it". The arithmetic itself is
   `land-per-capability.test.ts`'s — what is pinned here is the mapper's default and its option. */

test('⚠⚠ by default the mapper sizes each island to capabilities × LAND_AREA_PER_CAPABILITY; a rung is honoured; `null` leaves the drawing’s size; an island with no parcels is sized as ONE capability; the centre holds still', () => {
  // Two islands: one partitioned into three capability parcels, one with bare cells and no parcel.
  const twoIslands: SceneG = {
    el: 'g',
    kind: 'ground',
    children: [
      { ...parcelledGround([{ id: 'cap-a', cells: 2 }, { id: 'cap-b', cells: 1 }, { id: 'cap-c', cells: 1 }], 'healthy'), id: 'isle-a' },
      { ...parcelledGround([{ kind: 'cell', cells: 2 }], 'healthy'), id: 'isle-b' },
    ],
  };
  const asDrawn = worldTo3D(twoIslands, { landAreaPerCapability: null }).filter(asInstance);
  const shipped = worldTo3D(twoIslands).filter(asInstance);
  const explicit = worldTo3D(twoIslands, { landAreaPerCapability: LAND_AREA_PER_CAPABILITY }).filter(asInstance);
  const rung = worldTo3D(twoIslands, { landAreaPerCapability: 100 }).filter(asInstance);
  assert.deepEqual(shipped, explicit, 'the default IS the shipped constant');
  assert.equal(asDrawn.length, shipped.length);
  const drawnLand = islandLand(asDrawn);
  const a = drawnLand.get('isle-a')!;
  assert.equal(a.capabilities, 3);
  assert.ok(a.area > 0 && Math.abs(a.area - 3 * LAND_AREA_PER_CAPABILITY) > 1, 'the drawing is NOT already at the ratio — the option is not a no-op');
  assert.ok(Math.abs(islandLand(shipped).get('isle-a')!.area - 3 * LAND_AREA_PER_CAPABILITY) < 1e-6);
  assert.ok(Math.abs(islandLand(rung).get('isle-a')!.area - 3 * 100) < 1e-6);
  // ⚠ THE BARE ISLAND IS SIZED AS ONE CAPABILITY (the owner, 2026-09-06: "no capabilities should
  // just be 1 hex which should be the minimum" — `LAND_FLOOR_CAPABILITIES`). Until then it was left
  // at the drawing's size, and on the real forest that made the islands holding NO work the
  // third- to sixth-largest things on the map.
  const bDrawn = asDrawn.filter((d) => d.island === 'isle-b');
  const bShipped = shipped.filter((d) => d.island === 'isle-b');
  assert.ok(bDrawn.length > 0);
  assert.equal(islandLand(asDrawn).get('isle-b')!.capabilities, 0);
  assert.ok(Math.abs(islandLand(shipped).get('isle-b')!.area - LAND_FLOOR_CAPABILITIES * LAND_AREA_PER_CAPABILITY) < 1e-6, 'one capability’s worth of land');
  assert.ok(Math.abs(islandLand(rung).get('isle-b')!.area - LAND_FLOOR_CAPABILITIES * 100) < 1e-6, 'and one rung’s worth on a rung');
  assert.notDeepEqual(bShipped, bDrawn, 'it is no longer left as drawn');
  // So the bare island is exactly as large as a one-capability island would be, and smaller than
  // isle-a's three: no island with fewer capabilities is drawn larger than one with more.
  assert.deepEqual(islandSizeInversions(islandLand(shipped).values()), []);
  assert.ok(islandLand(shipped).get('isle-b')!.area < islandLand(shipped).get('isle-a')!.area);
  assert.ok(islandLand(asDrawn).get('isle-b')!.area > 0);
  // The centres hold still: the layout is the drawing's.
  const cDrawn = islandCentres(asDrawn);
  const cShipped = islandCentres(shipped);
  for (const [id, c] of cDrawn) {
    assert.ok(Math.abs(c.x - cShipped.get(id)!.x) < 1e-9 && Math.abs(c.z - cShipped.get(id)!.z) < 1e-9, `${id}'s centre moved`);
  }
  // And the ratio is the ONLY thing the mapper applies now: the sized stream is the drawing scaled
  // per island about its own centre, so the default and `null` differ by exactly that and nothing
  // else (the composition the footprint restoration used to sit inside — ADR-0546 D1).
  for (const [id, land] of islandLand(shipped)) {
    const drawnArea = islandLand(asDrawn).get(id)!.area;
    const factor = land.area / drawnArea;
    assert.ok(factor > 0 && Number.isFinite(factor), `${id} scaled by ${factor}`);
  }
});
