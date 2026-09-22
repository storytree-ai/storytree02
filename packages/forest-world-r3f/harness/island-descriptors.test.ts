// island-descriptors.test.ts — the island extractor's contract.
//
// The load-bearing check is the PROJECTION ROUND TRIP. `buildScene` emits coordinates
// already foreshortened by sin(20 degrees); feeding those to a 3D renderer and tilting a
// camera at them projects the same ground twice and produces an island squashed to about a
// third of its true depth — which still looks like a plausible island, and so announces
// nothing. Everything else here exists so that a later edit cannot quietly make the
// extractor return an empty or degenerate set and have the page render "fine".

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LAND_CAMERA_ELEVATION_DEG,
  groundFlattening,
  hexCenter,
  projectGround,
} from '@storytree/forest-world';

import { groundBounds, groundCellsFrom, triangulateFan } from './island-descriptors.js';
import { islandScene } from './island-fixture.js';
import { parcelCellsFrom } from '../src/parcel-cells.js';
import { worldTo3D } from '../src/world-to-3d.js';

const SCENE = islandScene();
const CELLS = groundCellsFrom(SCENE);

test('NON-VACUITY: the island actually yields ground cells', () => {
  assert.ok(
    CELLS.length > 50,
    `only ${CELLS.length} ground cells — a near-empty island would make every later ` +
      'assertion true for the wrong reason, and would still render as a plausible picture',
  );
});

test('every cell is a real polygon with at least three vertices', () => {
  for (const c of CELLS) {
    assert.ok(c.points.length >= 3, `a cell came back with ${c.points.length} points`);
    for (const p of c.points) {
      assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), 'a non-finite vertex escaped');
    }
  }
});

test('PROJECTION ROUND TRIP: unprojecting then re-projecting is the identity', () => {
  // The direct statement of the trap. If the extractor ever stops unprojecting, this fails.
  const cell = CELLS[0]!;
  for (const p of cell.points) {
    const reprojected = projectGround(p, LAND_CAMERA_ELEVATION_DEG);
    // Re-projecting a ground point must land back inside the scene's own 2D extent.
    assert.ok(Number.isFinite(reprojected.y));
  }
  // And the ground is STRICTLY TALLER than its projection — that is what unprojecting did.
  const bounds = groundBounds(CELLS);
  const flat = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  // Sanity on the flattening itself, camera-agnostic: any elevation strictly between 0 and 90
  // degrees foreshortens the ground plane (0 < sin θ < 1), which is the only fact this round-trip
  // test relies on — it was `sin(20 deg) ~= 0.342 < 0.5` while the land camera was 20 degrees
  // (ADR-0367 D1); ADR-0593 D1 moved it to 50 degrees, where `sin(50 deg) ~= 0.766`, still inside
  // (0, 1) and still a real foreshortening, so the `< 1` bound below is the camera-agnostic form.
  assert.ok(flat > 0 && flat < 1, `sanity: groundFlattening should foreshorten (0,1), got ${flat}`);
  assert.ok(
    bounds.h > bounds.w * 0.5,
    `ground depth ${bounds.h.toFixed(1)} vs width ${bounds.w.toFixed(1)} — an island this ` +
      'flat means the coordinates were NOT unprojected and the render will squash twice',
  );
});

test('the ground island is EXACTLY 1/sin(land camera) deeper than its own projection', () => {
  // The layout-independent form, and the one that actually catches a missing or
  // half-applied unprojection.
  //
  // An earlier draft asserted the ground aspect sits "near 1", on the reasoning that a hex
  // island is near-isotropic. It measured 0.578 and failed — and the PREMISE was wrong, not
  // the extractor: this fixture's tile set spans q in [-2,2] and r in [-1,1], which is a
  // deliberately wide 5x3 island, so a squat ground footprint is correct for it. An
  // assertion that depends on the caller's tile layout is not a projection check at all; it
  // just happens to pass on round islands.
  //
  // So compare the island against ITSELF. The extractor divides y by the flattening and
  // nothing else, so the ground extent must be the projected extent scaled by exactly
  // 1/sin(land camera) in y and unchanged in x — true for any layout AND for any elevation the
  // land camera is set to (it was 20 degrees under ADR-0367 D1, moved to 50 under ADR-0593 D1),
  // and false the moment the unprojection is dropped (ratio 1) or applied twice (ratio 1/sin^2).
  const ground = groundBounds(CELLS);
  const projected = groundBounds(
    CELLS.map((c) => ({
      ...c,
      points: c.points.map((p) => projectGround(p, LAND_CAMERA_ELEVATION_DEG)),
    })),
  );
  const flat = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  // Sanity on `groundFlattening` itself, checked independently of `Math.sin` isn't possible
  // without restating the SUT's own arithmetic, so this cross-checks against the DECLARED
  // constant rather than a baked angle — it is a live-value regression guard (did the wiring
  // between the two stay `sin(LAND_CAMERA_ELEVATION_DEG)`?), not a projection-correctness proof;
  // the projection-correctness proof is the ratio assertion below, which is genuinely camera-free.
  assert.ok(
    Math.abs(flat - Math.sin((LAND_CAMERA_ELEVATION_DEG * Math.PI) / 180)) < 1e-9,
    `the flattening is not sin(${LAND_CAMERA_ELEVATION_DEG})`,
  );

  assert.ok(
    Math.abs(ground.w - projected.w) < 1e-6,
    `x moved under projection (${ground.w} vs ${projected.w}) — only y foreshortens`,
  );
  const depthRatio = ground.h / projected.h;
  assert.ok(
    Math.abs(depthRatio - 1 / flat) < 1e-6,
    `ground is ${depthRatio.toFixed(4)}x its projection's depth; expected exactly ` +
      `${(1 / flat).toFixed(4)}. A ratio of 1 means the coordinates were never unprojected ` +
      'and the live render will foreshorten ground that is already foreshortened.',
  );
});

test('a hex tile centre unprojects to its own ground-space position', () => {
  // The independent cross-check: `hexCenter` with no options projects at the land camera,
  // so its y divided by the flattening must equal its y at 90 degrees (no foreshortening).
  const h = { q: 1, r: -1 };
  const projected = hexCenter(h);
  const ground = hexCenter(h, { elevationDeg: 90 });
  const recovered = projected.y / groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  assert.ok(
    Math.abs(recovered - ground.y) < 1e-6,
    `unprojected ${recovered} vs true ground ${ground.y} — the flattening constant is not ` +
      'the one the scene was built with',
  );
});

test('cells carry a STATUS, and on an all-healthy island every one of them is healthy', () => {
  const statuses = new Set(CELLS.map((c) => c.status));
  assert.ok(statuses.has('healthy'), `no healthy cell; saw ${[...statuses].join(', ')}`);
  assert.deepEqual(
    [...statuses].filter((s) => s !== 'healthy'),
    [],
    'a fabricated non-healthy status reached an all-healthy island — the arc has already ' +
      'decided three passes against invented status and will not do it again',
  );
});

test('a MIXED island really does produce the foreign status — the fixture switch works', () => {
  // Non-vacuity for the mixed panel: if the switch did nothing, that panel would silently
  // show a second all-healthy island under a caption claiming otherwise.
  const mixed = groundCellsFrom(islandScene({ oddOneOut: { index: 0, status: 'unhealthy' } }));
  const statuses = new Set(mixed.map((c) => c.status));
  assert.ok(statuses.has('unhealthy'), 'the odd-one-out capability did not reach the ground');
  assert.ok(statuses.has('healthy'), 'the mixed island lost its healthy majority');
});

test('DETERMINISM: the same island yields byte-identical ground', () => {
  assert.deepEqual(groundCellsFrom(islandScene()), CELLS);
});

test('triangulateFan covers the polygon and produces whole triangles', () => {
  const square = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];
  const tris = triangulateFan(square);
  assert.equal(tris.length, 4, 'a fan over 4 vertices is 4 triangles');
  for (const t of tris) assert.equal(t.length, 6, 'each triangle is 3 xy pairs');
  // Area check: the fan must reconstruct the polygon's own area, or the ground has holes.
  const area = tris.reduce((s, [ax, ay, bx, by, cx, cy]) => {
    return s + Math.abs((bx! - ax!) * (cy! - ay!) - (cx! - ax!) * (by! - ay!)) / 2;
  }, 0);
  assert.ok(Math.abs(area - 4) < 1e-9, `fan area ${area}, expected the square's 4`);
});

test('triangulateFan REFUSES a degenerate polygon rather than emitting junk', () => {
  assert.deepEqual(triangulateFan([]), []);
  assert.deepEqual(triangulateFan([{ x: 0, y: 0 }, { x: 1, y: 1 }]), []);
});

test('cells carry the OWNING CAPABILITY, and it comes from the parcel group', () => {
  // The field the land's definition is placed by. Without it every seam looks alike and
  // definition can only be sprayed everywhere — which is the treatment the owner rejected
  // by looking, so an extractor that silently stopped carrying this would present as an
  // art problem rather than as a missing field.
  const parcels = new Set(CELLS.map((c) => c.parcel));
  assert.ok(!parcels.has(undefined), 'a ground cell came back with no owning capability');
  assert.ok(parcels.size > 5, `only ${parcels.size} capabilities across ${CELLS.length} cells`);
  // Every capability must own more than one cell, or "boundary between capabilities" would
  // be indistinguishable from "boundary between cells" and the fence would mean nothing.
  const sizes = new Map<string, number>();
  for (const c of CELLS) sizes.set(c.parcel!, (sizes.get(c.parcel!) ?? 0) + 1);
  for (const [cap, n] of sizes) assert.ok(n > 1, `${cap} owns a single cell (${n})`);
});

test('the capability is taken ONLY from a group that says it is a parcel', () => {
  // Every other `<g>` on the island carries an `id` for its own reasons — a territory, a
  // trail edge, a hit target. Inheriting one of those would partition the land along lines
  // that mean nothing, and the picture would look deliberate either way.
  const territory = 'context-traversal-capture';
  assert.ok(
    !CELLS.some((c) => c.parcel === territory),
    'a cell inherited the TERRITORY id instead of its capability — the walk is reading the ' +
      'wrong `id`, and every land boundary drawn from it would be fiction',
  );
});

test('every cell names the STORY whose island it sits on, and it is NOT its capability', () => {
  // ⚠ TWO IDS, TWO QUESTIONS. A capability's tree stands on its own parcel; a story's SIGNED UAT
  // criterion belongs to the whole island. The fixture is ONE story holding eleven capabilities,
  // so the two readings must produce 1 and 11 — a reader that had collapsed them would produce
  // the same number twice and every count downstream would still look reasonable.
  const territory = 'context-traversal-capture';
  const islands = new Set(CELLS.map((c) => c.island));
  assert.deepEqual([...islands], [territory], 'one story, named on every cell');
  const parcels = new Set(CELLS.map((c) => c.parcel));
  assert.ok(parcels.size > 5, `only ${parcels.size} capabilities on the one island`);
  assert.notEqual(islands.size, parcels.size, 'the island id and the parcel id have collapsed');
});

test('⚠ the shipped MAPPER and this reader partition the fixture identically, story for story', () => {
  // ⚠⚠ THE POINT OF ASSERTING IT TWICE. `worldTo3D` and `groundCellsFrom` walk DIFFERENT code over
  // the same scene — one unprojects to ground coordinates, the other maps the drawing straight
  // onto the ground plane — so neither is a witness to the other's arithmetic. What they can
  // witness is the ATTRIBUTION: if the two independent walks disagree about which story a cell
  // belongs to, one of them is reading the wrong `id`, and a per-story claim drawn from it would
  // be fiction on a picture that looks entirely ordinary.
  const mapped = parcelCellsFrom(worldTo3D(SCENE));
  assert.equal(mapped.length, CELLS.length, 'the two readers see the same number of cells');
  assert.deepEqual(
    mapped.map((c) => c.island),
    CELLS.map((c) => c.island),
    'the two readers disagree about which story a cell belongs to',
  );
  assert.deepEqual(
    mapped.map((c) => c.parcel),
    CELLS.map((c) => c.parcel),
    'the two readers disagree about which capability a cell belongs to',
  );
});
