// The shared render core's inner-loop dogfood (ADR-0093 / ADR-0020 / ADR-0057):
// determinism, ranking correctness, and mesh/coast invariants on the PURE geometry
// kernel both surfaces render from. node:test (the package convention); the studio
// keeps its own buildWorld determinism tests as the faithfulness anchor for the
// extraction.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hash, rand01 } from './rng.js';
import { PLAN_VIEW_ELEVATION_DEG, groundFlattening } from './camera.js';
import { HEX_R, hexCenter, pixelToHex, hexDist, hexCorners, axialKey, type Axial } from './hex.js';
import { crownRadius, estRadius, ringsOf, storyTreeReach } from './sizing.js';
import { storyEdges, rankStories, descendantCounts } from './ranking.js';
import { smoothCoast, chaikinClosed, boundaryRingLoops, type BoundarySeg } from './coast.js';
import { buildRelaxedCells, MESH_TUNING, type DrawTile } from './substrate.js';

// ---------- rng ----------

test('hash is deterministic and a uint32', () => {
  assert.equal(hash('library'), hash('library'));
  assert.notEqual(hash('library'), hash('cli'));
  const h = hash('library');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

test('rand01 is deterministic and in [0, 1)', () => {
  for (const s of [0, 1, 42, hash('x'), hash('story:42')]) {
    const a = rand01(s);
    assert.equal(a, rand01(s));
    assert.ok(a >= 0 && a < 1, `rand01(${s}) = ${a} out of range`);
  }
});

// ---------- hex math ----------

// test-removed: `pixelToHex(hexCenter(h)) round-trips for a patch of the lattice` was renamed to bind its declared contract; the unchanged predicate is covered by the title below.
// test-updated (refactor): `pixelToHex(hexCenter(h)) round-trips for a patch of the lattice` gained only its declared-contract title prefix; its assertions are unchanged.
test('rc-hex-and-sizing-geometry: pixelToHex(hexCenter(h)) round-trips for a patch of the lattice', () => {
  for (let q = -4; q <= 4; q++) {
    for (let r = -4; r <= 4; r++) {
      const h: Axial = { q, r };
      const back = pixelToHex(hexCenter(h));
      assert.deepEqual(back, h, `round-trip failed at ${axialKey(h)} → ${axialKey(back)}`);
    }
  }
});

test('hexDist matches axial cube distance; 6 unit neighbours are distance 1', () => {
  assert.equal(hexDist({ q: 0, r: 0 }, { q: 0, r: 0 }), 0);
  assert.equal(hexDist({ q: 0, r: 0 }, { q: 3, r: -1 }), 3);
  const neigh: Axial[] = [
    { q: 1, r: -1 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
  ];
  for (const n of neigh) assert.equal(hexDist({ q: 0, r: 0 }, n), 1);
});

test('hexCorners returns 6 points on the camera ground ellipse of radius R', () => {
  // `R` is a GROUND radius, and since ADR-0367 D1 the land is seen through a declared camera, so
  // the corners sit on an ellipse of semi-axes (R, R·sin θ) rather than on a circle. The circle was
  // the plan-view special case, and `PLAN_VIEW_ELEVATION_DEG` still recovers it exactly.
  const corners = hexCorners(10, 20, HEX_R);
  assert.equal(corners.length, 6);
  const f = groundFlattening();
  for (const c of corners) {
    assert.ok(Math.abs(Math.hypot((c.x - 10) / HEX_R, (c.y - 20) / (HEX_R * f)) - 1) < 1e-9);
  }
  for (const c of hexCorners(10, 20, HEX_R, PLAN_VIEW_ELEVATION_DEG)) {
    assert.ok(Math.abs(Math.hypot(c.x - 10, c.y - 20) - HEX_R) < 1e-9);
  }
});

// ---------- sizing ----------

// test-removed: `crownRadius grows with capability count and is clamped to 32` was renamed to bind its declared contract; the unchanged predicate is covered by the title below.
// test-updated (refactor): `crownRadius grows with capability count and is clamped to 32` gained only its declared-contract title prefix; its assertions are unchanged.
test('rc-hex-and-sizing-geometry: crownRadius grows with capability count and is clamped to 32', () => {
  assert.ok(crownRadius(0) < crownRadius(3));
  assert.ok(crownRadius(3) < crownRadius(6));
  assert.equal(crownRadius(100), 32); // clamp
  for (let n = 0; n <= 20; n++) assert.ok(crownRadius(n) <= 32 && crownRadius(n) >= 18);
});

test('estRadius / ringsOf / storyTreeReach are monotonic and positive', () => {
  assert.ok(estRadius(3) > 0 && estRadius(13) > estRadius(3));
  assert.ok(ringsOf(1) === 0 && ringsOf(7) === 1 && ringsOf(19) === 2 && ringsOf(37) === 3);
  assert.ok(storyTreeReach(5) > storyTreeReach(0));
});

// ---------- ranking ----------

const RANK_FIXTURE = [
  { id: 'base', dependsOn: [] as string[], capabilities: [] as { id: string; dependsOn: string[] }[] },
  { id: 'mid', dependsOn: ['base'], capabilities: [] },
  { id: 'top', dependsOn: ['mid'], capabilities: [] },
  // a derived cross-story capability edge: alpha's cap depends on a cap owned by base
  {
    id: 'alpha',
    dependsOn: [] as string[],
    capabilities: [{ id: 'alpha-x', dependsOn: ['base-y'] }],
  },
  { id: 'base2', dependsOn: [], capabilities: [{ id: 'base-y', dependsOn: [] as string[] }] },
];

test('storyEdges unions declared depends_on with derived cross-story capability deps', () => {
  const edges = storyEdges(RANK_FIXTURE);
  const keys = edges.map((e) => `${e.from}->${e.to}`).sort();
  assert.deepEqual(keys, ['base->mid', 'base2->alpha', 'mid->top'].sort());
  const derived = edges.find((e) => e.from === 'base2' && e.to === 'alpha');
  assert.ok(derived && derived.via.length === 1, 'derived edge carries its capability trace');
});

// test-removed: `rankStories: a dependent ranks strictly above every dependency` was renamed to bind its declared contract; the unchanged predicate is covered by the title below.
// test-updated (refactor): `rankStories: a dependent ranks strictly above every dependency` gained only its declared-contract title prefix; its assertions are unchanged.
test('rc-longest-path-ranking-cycle-safe: rankStories: a dependent ranks strictly above every dependency', () => {
  const edges = storyEdges(RANK_FIXTURE);
  const depsOf = new Map<string, string[]>(RANK_FIXTURE.map((s) => [s.id, []]));
  for (const e of edges) depsOf.get(e.to)?.push(e.from);
  const ranks = rankStories(RANK_FIXTURE, depsOf);
  for (const e of edges) {
    assert.ok((ranks.get(e.to) ?? 0) > (ranks.get(e.from) ?? 0), `${e.from} → ${e.to} not upward`);
  }
  assert.equal(ranks.get('base'), 0);
});

// test-removed: `rankStories is cycle-safe (a bad-frontmatter cycle stays finite)` was renamed to bind its declared contract; the unchanged predicate is covered by the title below.
// test-updated (refactor): `rankStories is cycle-safe (a bad-frontmatter cycle stays finite)` gained only its declared-contract title prefix; its assertions are unchanged.
test('rc-longest-path-ranking-cycle-safe: rankStories is cycle-safe (a bad-frontmatter cycle stays finite)', () => {
  const cyclic = [
    { id: 'a' },
    { id: 'b' },
  ];
  const depsOf = new Map<string, string[]>([
    ['a', ['b']],
    ['b', ['a']],
  ]);
  const ranks = rankStories(cyclic, depsOf);
  assert.ok(Number.isFinite(ranks.get('a')) && Number.isFinite(ranks.get('b')));
});

test('descendantCounts counts transitive dependents (load-bearing)', () => {
  const edges = storyEdges(RANK_FIXTURE);
  const dependentsOf = new Map<string, string[]>(RANK_FIXTURE.map((s) => [s.id, []]));
  for (const e of edges) dependentsOf.get(e.from)?.push(e.to);
  const counts = descendantCounts(RANK_FIXTURE, dependentsOf);
  assert.equal(counts.get('base'), 2); // mid, top
  assert.equal(counts.get('top'), 0);
});

// ---------- coast ----------

/** A square boundary (4 corners) as per-edge segments. */
const SQUARE: BoundarySeg[] = [
  { x1: 0, y1: 0, x2: 10, y2: 0 },
  { x1: 10, y1: 0, x2: 10, y2: 10 },
  { x1: 10, y1: 10, x2: 0, y2: 10 },
  { x1: 0, y1: 10, x2: 0, y2: 0 },
];

test('boundaryRingLoops chains segments into one closed loop', () => {
  const loops = boundaryRingLoops(SQUARE);
  assert.equal(loops.length, 1);
  assert.equal(loops[0]!.length, 4); // trailing duplicate dropped
});

// test-removed: `chaikinClosed roughly doubles the vertex count per pass and stays closed` was renamed to bind its declared contract; the unchanged predicate is covered by the title below.
// test-updated (refactor): `chaikinClosed roughly doubles the vertex count per pass and stays closed` gained only its declared-contract title prefix; its assertions are unchanged.
test('rc-coastline-chaikin-smoothed: chaikinClosed roughly doubles the vertex count per pass and stays closed', () => {
  const loop = boundaryRingLoops(SQUARE)[0]!;
  const once = chaikinClosed(loop, 1);
  assert.equal(once.length, loop.length * 2);
  assert.ok(chaikinClosed(loop, 2).length > once.length);
});

test('smoothCoast is deterministic and seed-dependent (same id → byte-identical paths)', () => {
  const a = smoothCoast(SQUARE, 'island-1');
  const b = smoothCoast(SQUARE, 'island-1');
  assert.deepEqual(a.paths, b.paths);
  const other = smoothCoast(SQUARE, 'island-2');
  assert.notDeepEqual(a.paths, other.paths); // the coast wave is seeded by the id
  assert.ok(a.paths[0]!.startsWith('M') && a.paths[0]!.endsWith('Z'));
});

// ---------- substrate (the relaxed Townscaper mesh) ----------

/** A small contiguous blob of 7 hexes (centre + ring) owned by territory 0. */
function blobTiles(): DrawTile[] {
  const centre: Axial = { q: 0, r: 0 };
  const ring: Axial[] = [
    { q: 1, r: -1 },
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
  ];
  return [centre, ...ring].map((h) => ({ h, owner: 0 }));
}

// test-removed: `buildRelaxedCells (mesh) is deterministic — same input → byte-identical cells` was renamed to bind its declared contract; the unchanged predicate is covered by the title below.
// test-updated (refactor): `buildRelaxedCells (mesh) is deterministic — same input → byte-identical cells` gained only its declared-contract title prefix; its assertions are unchanged.
test('rc-mesh-substrate-deterministic: buildRelaxedCells (mesh) is deterministic — same input → byte-identical cells', () => {
  const tiles = blobTiles();
  const wheat: ReadonlySet<string>[] = [new Set<string>()];
  const a = buildRelaxedCells(tiles, wheat, 'mesh');
  const b = buildRelaxedCells(tiles, wheat, 'mesh');
  assert.deepEqual(a, b);
  assert.ok(a.length > tiles.length, 'mesh subdivides each hex into several cells');
});

test('mesh cells are all owned by a real territory and carry a 3-way variant', () => {
  const cells = buildRelaxedCells(blobTiles(), [new Set<string>()], 'mesh');
  for (const c of cells) {
    assert.equal(c.owner, 0);
    assert.ok(c.variant === 0 || c.variant === 1 || c.variant === 2);
    assert.ok(c.poly.length >= 3, 'a cell is a polygon');
  }
});

test('wheat tinting honours the per-territory wheat set', () => {
  const tiles = blobTiles();
  const dry = buildRelaxedCells(tiles, [new Set<string>()], 'mesh');
  const allWheat = buildRelaxedCells(tiles, [new Set(tiles.map((t) => axialKey(t.h)))], 'mesh');
  assert.equal(
    dry.filter((c) => c.wheat).length,
    0,
    'no wheat cells when the wheat set is empty',
  );
  assert.ok(
    allWheat.filter((c) => c.wheat).length > 0,
    'wheat cells appear when tiles are in the wheat set',
  );
});

test('the three substrate modes all produce cells for the same land', () => {
  const tiles = blobTiles();
  const wheat: ReadonlySet<string>[] = [new Set<string>()];
  for (const mode of ['mesh', 'relaxed-quad', 'relaxed-hex'] as const) {
    assert.ok(buildRelaxedCells(tiles, wheat, mode).length > 0, `${mode} produced no cells`);
  }
  // MESH_TUNING is the canonical default the mesh path uses.
  assert.equal(MESH_TUNING.subdiv, 1);
});
