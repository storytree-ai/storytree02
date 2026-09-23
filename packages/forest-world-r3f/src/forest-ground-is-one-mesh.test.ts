// forest-ground-is-one-mesh.test.ts — THE WHOLE FOREST'S GROUND IS ONE DRAW CALL, HOWEVER MANY
// ISLANDS ARE STANDING.
//
// THE INCREMENT: `cost-the-adopted-ladder-on-a-crowd` on `adopt-the-land-into-the-shipped-map-arc`,
// whose own premise this refutes. It was parked saying *"The forest map draws MANY islands, each
// its own draw call"*, and concluded from that — soundly, given the premise — that the adopted
// ladder's measured PER-DRAW cost would multiply across a real map and that a per-island figure
// therefore understates the whole-map one.
//
// The premise is not true of this renderer, and the difference is not a detail: if it held, the
// ladder's 0.0534 ms at the overview zoom would be ~1.9 ms across 35 islands — 11% of a 60 Hz
// frame, on the ground alone, and a real reason to reconsider an adoption the owner has already
// signed off. What is actually there is one upload per frame.
//
// FOUR CLAIMS, and together they are the whole chain from a multi-island world to one draw call:
//
//   1. `worldTo3D` emits every island's parcels into ONE descriptor stream — it does not partition
//      by territory, and a territory IS an island.
//   2. `cellGroundGeometry` merges ANY such stream into ONE buffer, whatever it spans.
//   3. The banded material's ramp — the uniform array that doubled when the ladder was refined,
//      and the thing the increment feared was being uploaded per island — is sized by
//      `tokens x levels` and by nothing else. Not by cells, not by islands.
//   4. `ForestWorldCanvas` mounts exactly ONE `<CellGround>` and hands it the whole slice. Since
//      2026-09-15 the SLICING is `ground-dependency.ts`'s and is therefore driven rather than
//      parsed; only the mount count and the one prop it is handed are still read off the source.
//
// ⚠ CLAIM 4 IS A SOURCE PARSE, and it is the weakest of the four on purpose rather than by
// accident. Claims 1-3 are the arithmetic and can be driven directly; what claim 4 asserts is a
// WIRING decision in a React tree this package cannot mount in `node:test`. The precedent is
// `harness/shipped-baseline.test.ts`, which parses this same file's lighting and refuses on drift.
// The measured counterpart is the crowd driver, which holds the browser's own
// `renderer.info.render.calls` to 1 on a 35-island scene — so the claim is read here and measured
// there, and neither stands alone.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildScene,
  routeTrails,
  type Pt,
  type SceneInput,
  type SceneStatus,
  type SceneTerritoryInput,
} from '@storytree/forest-world';

import { createBandedGroundMaterial } from './banded-ground-material.js';
import { cellGroundGeometry } from './cell-ground-geometry.js';
import { SHADE_LEVELS, LEGACY_SHADE_LEVELS } from './shade-ladder.js';
import { groundInput, type GroundInputOptions } from './ground-dependency.js';
import { KIT_FOOTPRINTS_2026_08_29, KIT_HEIGHTS_2026_08_29 } from './kit-vocabulary.js';
import { LAND_RELIEF_AMPLITUDE } from './land-relief.js';
import { worldTo3D, type InstanceDescriptor } from './world-to-3d.js';

/** The shipped derivation's constants — this file asks WHAT was sliced, never how it looks. */
const GROUND_OPTS: GroundInputOptions = {
  relief: LAND_RELIEF_AMPLITUDE,
  footprint: KIT_FOOTPRINTS_2026_08_29,
  height: KIT_HEIGHTS_2026_08_29,
};

// ---------------------------------------------------------------------------
// A TWO-ISLAND WORLD ON THE RELAXED-MESH SUBSTRATE — the substrate the studio ships.
// ---------------------------------------------------------------------------

/** A square parcel of side `size` centred on (cx, cy), in scene space. */
function square(cx: number, cy: number, size: number): Pt[] {
  const h = size / 2;
  return [
    { x: cx - h, y: cy - h },
    { x: cx + h, y: cy - h },
    { x: cx + h, y: cy + h },
    { x: cx - h, y: cy + h },
  ];
}

function territory(id: string, status: SceneStatus, cx: number, cy: number): SceneTerritoryInput {
  return {
    id,
    status,
    caps: 2,
    centroid: { x: cx, y: cy },
    groundRadius: 60,
    screenRadius: 60,
    treeSpot: { x: cx, y: cy - 10 },
    labelY: cy + 60,
    coastGroundLoops: [],
    decor: [],
    plants: [],
    treeTitle: `${id} — ${status}`,
    wisps: [],
    plate: {
      w: 120,
      h: 33,
      rx: 7,
      idY: 14,
      subY: 27,
      idText: id,
      subText: `${status} · 2 caps`,
      title: id,
    },
  };
}

/** Two islands, in two different states, each with `per` parcels of its own. */
function twoIslandWorld(per: number): SceneInput {
  const cells = [];
  for (let i = 0; i < per; i += 1) {
    cells.push({ owner: 0, poly: square(100 + i * 24, 200, 20), variant: 0, wheat: false });
  }
  for (let i = 0; i < per; i += 1) {
    cells.push({ owner: 1, poly: square(600 + i * 24, 500, 20), variant: 0, wheat: false });
  }
  return {
    offset: { x: 0, y: 0 },
    width: 1200,
    height: 900,
    empties: [],
    relaxedCells: cells,
    drawTiles: [],
    wheatSets: [new Set(), new Set()],
    // ROUTED, never hand-forged — the `world-to-3d.test.ts` pattern, so the fixture exercises the
    // real core rather than a shape that happens to typecheck.
    trails: routeTrails(
      [
        { id: 'library', x: 100, y: 200, r: 60 },
        { id: 'cli', x: 600, y: 500, r: 60 },
      ],
      [{ from: 'library', to: 'cli', title: 'cli depends on library' }],
      'one-mesh-fixture',
    ),
    territories: [
      territory('library', 'healthy', 100, 200),
      territory('cli', 'unhealthy', 600, 500),
    ],
  };
}

function groundCellsOf(input: SceneInput): InstanceDescriptor[] {
  return worldTo3D(buildScene(input)).filter(
    (d): d is InstanceDescriptor => d.kind === 'cell-ground',
  );
}

const BLACK = { r: 0, g: 0, b: 0 };

// ---------------------------------------------------------------------------
// 1 — THE MAPPER DOES NOT PARTITION BY ISLAND
// ---------------------------------------------------------------------------

test('every island\'s parcels arrive in ONE descriptor stream, carrying their own island status', () => {
  const cells = groundCellsOf(twoIslandWorld(4));
  assert.equal(cells.length, 8, 'both islands\' parcels should be present, in one array');

  const statuses = new Set(cells.map((c) => c.material));
  assert.deepEqual(
    [...statuses].sort(),
    ['healthy', 'unhealthy'],
    'the stream must span BOTH islands in BOTH states — one status would mean the fixture ' +
      'built one island and this test proves nothing about a forest',
  );
});

// ---------------------------------------------------------------------------
// 2 — THE GEOMETRY MERGE IS TOTAL
// ---------------------------------------------------------------------------

test('cellGroundGeometry merges any number of islands into ONE buffer', () => {
  const one = cellGroundGeometry({ cells: groundCellsOf(oneIslandWorld(4)), resolve: () => BLACK });
  const two = cellGroundGeometry({ cells: groundCellsOf(twoIslandWorld(4)), resolve: () => BLACK });

  assert.equal(two.cells, one.cells * 2, 'a second island should contribute its own parcels');
  assert.equal(
    two.triangles,
    one.triangles * 2,
    'and its own triangles — into the SAME buffer, which is what makes it one draw call',
  );
  // ⚠ THE LOAD-BEARING ASSERTION OF THE WHOLE FILE. `positions` is ONE Float32Array whatever the
  // stream spanned: there is no per-island array, no list of buffers, nothing a caller could
  // iterate to issue a second draw with.
  assert.ok(
    two.positions instanceof Float32Array,
    'the merged ground is a single vertex buffer, not a collection of them',
  );
  assert.equal(
    two.positions.length,
    one.positions.length * 2,
    'both islands stand in the one buffer',
  );
});

/** One island, otherwise identical — the control for the merge claim above. */
function oneIslandWorld(per: number): SceneInput {
  const input = twoIslandWorld(per);
  return {
    ...input,
    relaxedCells: (input.relaxedCells ?? []).filter((c) => c.owner === 0),
    wheatSets: [new Set()],
    territories: [input.territories[0]!],
  };
}

test('the merged buffer carries EVERY island\'s ramp row, so one material can paint them all', () => {
  const cells = groundCellsOf(twoIslandWorld(4));
  // Row 0 / row 1 by island, which is what the shipped canvas's own `groundRowOf` does with the
  // status; the point here is that both survive the merge into one attribute.
  const rowOf = (material: string | undefined): number => (material === 'healthy' ? 0 : 1);
  const geo = cellGroundGeometry({ cells, resolve: () => BLACK, index: rowOf });
  const rows = new Set(geo.statuses);
  assert.deepEqual(
    [...rows].sort(),
    [0, 1],
    'a merged forest buffer must carry each island\'s own row — collapsing them would paint the ' +
      'whole forest one status, which is an ADR-0392 D5 misreport rather than a rendering bug',
  );
});

// ---------------------------------------------------------------------------
// 3 — THE RAMP IS PER MATERIAL, NEVER PER ISLAND
// ---------------------------------------------------------------------------

test('the ramp uniform is sized by tokens x levels and by NOTHING about the scene', () => {
  const tokens = ['#4f7942', '#b7684e', '#d8c069', '#9ca3af'];
  const material = createBandedGroundMaterial({ tokens });
  const ramp = material.uniforms['uRamp']?.value as unknown[];
  assert.ok(Array.isArray(ramp), 'the material must expose its ramp as a uniform array');

  // The shipped ladder plus the derived shadow rung — one authored entry per (token, level).
  assert.equal(
    ramp.length % tokens.length,
    0,
    'the ramp is row-major over the tokens, so its length is a whole number of rows',
  );
  const levels = ramp.length / tokens.length;
  assert.equal(levels, SHADE_LEVELS.length, 'each row is the shipped lit ladder');

  // ⚠ THE REFUTATION ITSELF. The increment feared this array being uploaded once per island. It
  // cannot be: it is a property of the MATERIAL, and the same material is built for a scene of any
  // size. A four-parcel world and a five-thousand-parcel world compile the same ramp.
  const legacy = createBandedGroundMaterial({ tokens, lit: LEGACY_SHADE_LEVELS });
  const legacyRamp = legacy.uniforms['uRamp']?.value as unknown[];
  assert.equal(
    legacyRamp.length,
    tokens.length * LEGACY_SHADE_LEVELS.length,
    'the legacy ladder\'s ramp is the same arithmetic on four rungs',
  );
  assert.ok(
    ramp.length > legacyRamp.length,
    'the refined ladder really is the bigger upload — which is the cost the increment was right ' +
      'to ask about, and is paid once per FRAME rather than once per island',
  );
});

// ---------------------------------------------------------------------------
// 4 — THE CANVAS MOUNTS ONE GROUND
// ---------------------------------------------------------------------------

const CANVAS_SRC = readFileSync(
  fileURLToPath(new URL('./ForestWorldCanvas.tsx', import.meta.url)),
  'utf8',
);

test('ForestWorldCanvas mounts exactly ONE <CellGround>, over the whole cell slice', () => {
  const mounts = CANVAS_SRC.match(/<CellGround\b/g) ?? [];
  assert.equal(
    mounts.length,
    1,
    `ForestWorldCanvas mounts ${mounts.length} <CellGround> elements. One is what makes the ` +
      'forest\'s ground a single draw call; more than one would give the ramp uniform a second ' +
      'upload per frame and would make this arc\'s per-island frame figures understate the map.',
  );
  assert.match(
    CANVAS_SRC,
    /<CellGround\b[^>]*\bground=\{ground\}[^>]*\/>/,
    'and the one mount must be handed the whole derived ground, not a slice of it',
  );
});

test('the slice <CellGround> is handed is the WHOLE family, across every island', () => {
  // ⚠ THIS USED TO BE TWO REGEXES OVER THE CANVAS SOURCE, and it is a real derivation now because
  // the derivation MOVED: `ground-dependency.ts` is where the cells and the strips are sliced, and
  // it is pure, so the claim can be driven instead of read. Strictly stronger than the parse it
  // replaces — a regex could only see that `byKind` was written, never that it returned everything.
  //
  // A per-island subset is the failure being refused, in both families: it would give the forest a
  // mesh per island (claim 4's whole subject), and it would dock some trails and not others.
  const world = twoIslandWorld(3);
  const map = worldTo3D(buildScene(world));
  const { cells, strips } = groundInput(map, GROUND_OPTS, 0);

  const wanted = (kind: string) => map.filter((d) => d.kind === kind).length;
  assert.ok(wanted('cell-ground') > 0, 'non-vacuity: the two-island world really draws ground');
  assert.equal(cells.length, wanted('cell-ground'), 'the ground was sliced by island, not taken whole');
  assert.equal(strips.length, wanted('trail-strip'), 'the strips were sliced by island, not taken whole');
  assert.equal(
    new Set(cells.map((c) => c.island)).size,
    2,
    'non-vacuity: the cells handed over really span BOTH islands',
  );
});

test('CellGround builds ONE geometry and ONE material for whatever it is handed', () => {
  // The body between `function CellGround(` and the next top-level `function `.
  const body = CANVAS_SRC.slice(CANVAS_SRC.indexOf('function CellGround('));
  const upto = body.slice(0, body.indexOf('\n// ---'));
  assert.equal(
    (upto.match(/cellGroundGeometry\(/g) ?? []).length,
    1,
    'more than one cellGroundGeometry call in CellGround would be more than one buffer',
  );
  assert.equal(
    (upto.match(/<mesh\b/g) ?? []).length,
    1,
    'CellGround must emit a single <mesh> — one mesh is one draw call',
  );
  assert.ok(
    !/\.map\(/.test(upto),
    'CellGround must not map over anything — a map here is a mesh per island, which is the ' +
      'shape this whole file exists to say the renderer does NOT have',
  );
});
