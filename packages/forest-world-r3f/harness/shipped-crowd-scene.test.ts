// shipped-crowd-scene.test.ts — the crowd page's own arithmetic, and the controls that make it a
// comparison rather than three unrelated pictures.
//
// ⚠ WHAT THIS FILE IS FOR. Every number the crowd driver publishes is computed in
// `shipped-crowd-scene.ts`; the driver is a `.mjs` shell that starts a browser and decides an exit
// code (`measurement-instrument-must-be-typechecked`). So the claims that make a run READABLE —
// the arms differ in one thing, the scenes differ in one thing, the camera does not move — are
// held here, where they can fail without a GPU.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SHADE_LEVELS, LEGACY_SHADE_LEVELS } from '../src/shade-ladder.js';
import { SHADOW_GRES } from '../src/land-shadow.js';
import { SHIPPED_COAST, clipToCoast } from '../src/coast-clip.js';
import { DOCK_REACH, bearingFrom, islandDocks, islandPaths, islandRims, rimGrid } from '../src/island-path.js';
import { nearestOnSegments } from '../src/shore-grid.js';
import { LAND_SCALE } from '../src/land-per-capability.js';
import {
  CROWD_ARMS,
  CROWD_LANDING_BEARINGS,
  CROWD_SIZES,
  CROWD_STRIP_OFFSHORE,
  CROWD_ZOOMS,
  FIT_ZOOM,
  MONO_STATUS,
  buildCrowdScene,
  coastAt,
  crowdCasters,
  offsetPerIsland,
  crowdCells,
  crowdIslands,
  crowdPxPerUnit,
  crowdSize,
  crowdStrips,
  orientedCamera,
  viewDirAtElevation,
} from './shipped-crowd-scene.js';
import { litLadderOf, shippedCasters, shippedParcels } from './shipped-land-scene.js';
import { RENDER_ELEV_DEG } from '../src/kit-vocabulary.js';
import { viewElevationDeg } from './shipped-spacing-scene.js';

const ONE = crowdSize('one');
const MONO = crowdSize('forest-mono');
const REAL = crowdSize('forest');

// ---------------------------------------------------------------------------
// THE ARMS — the ladder axis, and it is imported rather than restated
// ---------------------------------------------------------------------------

test('the two arms are the shipped ladder and the one it replaced, reached through litLadderOf', () => {
  assert.deepEqual([...CROWD_ARMS], ['shadow', 'dense']);
  // ⚠ THE LOAD-BEARING PAIR. `dense` is the map as it ships; `shadow` is what it wore until
  // 2026-08-31. Read through `litLadderOf` so this page and the one-island page cannot end up
  // measuring two different things under one arm name.
  assert.equal(litLadderOf('dense'), SHADE_LEVELS, 'dense must BE the shipped ladder, not a copy');
  assert.equal(litLadderOf('shadow'), LEGACY_SHADE_LEVELS, 'shadow must BE the legacy ladder');
  assert.ok(
    SHADE_LEVELS.length > LEGACY_SHADE_LEVELS.length,
    'the comparison is only interesting because the adopted ladder is the longer one',
  );
});

test('the arms differ in the ladder and in NOTHING else', () => {
  for (const size of CROWD_SIZES) {
    const a = buildCrowdScene('shadow', size, 2);
    const b = buildCrowdScene('dense', size, 2);
    for (const field of ['triangles', 'parcels', 'islands', 'statusRows', 'casters', 'shadowW', 'shadowH', 'width', 'height', 'pxPerUnit'] as const) {
      assert.equal(
        a[field],
        b[field],
        `at size ${size.id} the arms disagree about ${field} — they must differ in the ladder alone`,
      );
    }
    assert.equal(
      a.occlusionCoverage,
      b.occlusionCoverage,
      `at size ${size.id} the arms carry different occlusion fields`,
    );
  }
});

// ---------------------------------------------------------------------------
// THE SCENES — each differs from its neighbour in exactly one thing
// ---------------------------------------------------------------------------

test('one → forest-mono is PURELY the extra geometry: same status spread, 35x the parcels', () => {
  const one = buildCrowdScene('dense', ONE, 2);
  const mono = buildCrowdScene('dense', MONO, 2);
  assert.equal(one.statusRows, 1);
  assert.equal(mono.statusRows, 1, 'the mono crowd must wear ONE status, or it is not the control');
  assert.equal(mono.parcels, one.parcels * MONO.islands);
  assert.equal(mono.triangles, one.triangles * MONO.islands);
});

test('forest-mono → forest is PURELY the status spread: identical geometry, six rows instead of one', () => {
  const mono = buildCrowdScene('dense', MONO, 2);
  const real = buildCrowdScene('dense', REAL, 2);
  assert.equal(real.triangles, mono.triangles, 'the two crowds must stand on the same geometry');
  assert.equal(real.parcels, mono.parcels);
  assert.equal(real.islands, mono.islands);
  assert.ok(
    real.statusRows > mono.statusRows,
    'the real forest must carry more ramp rows than the mono one — that difference IS the arm',
  );
  // Six statuses is the schema (`packages/forest-world/src/scene.ts`), and the crowd population
  // spans all of them. A crowd that quietly held fewer would under-exercise the material's
  // selection chain, which is the mechanism this scene exists to test.
  assert.equal(real.statusRows, 6, 'the real forest spans every status the map can draw');
});

test('the geometry is byte-for-byte identical between the mono and real crowds', () => {
  // ⚠ NOT AN ASSERTION ABOUT COUNTS — about the BUFFER. `forest-mono` is only a control if the
  // vertices really are in the same places; equal triangle counts would also be satisfied by two
  // different forests of the same size.
  const monoCells = crowdCells(MONO);
  const realCells = crowdCells(REAL);
  assert.equal(monoCells.length, realCells.length);
  for (let i = 0; i < monoCells.length; i += 1) {
    const m = monoCells[i]!;
    const r = realCells[i]!;
    assert.deepEqual(m.points, r.points, `parcel ${i} stands somewhere else in the two crowds`);
  }
});

test('every island wears ONE status, and the mono crowd wears the single-island scene\'s own', () => {
  assert.equal(
    MONO_STATUS,
    shippedParcels()[0]?.material,
    'the mono status must be READ off the shipped fixture, never transcribed',
  );
  const monoStatuses = new Set(crowdCells(MONO).map((c) => c.material));
  assert.deepEqual([...monoStatuses], [MONO_STATUS]);

  const perIsland = new Map<number, Set<string | undefined>>();
  const base = shippedParcels().length;
  crowdCells(REAL).forEach((cell, i) => {
    const island = Math.floor(i / base);
    const seen = perIsland.get(island) ?? new Set();
    seen.add(cell.material);
    perIsland.set(island, seen);
  });
  for (const [island, seen] of perIsland) {
    assert.equal(seen.size, 1, `island ${island} wears ${seen.size} statuses — the shipped mapper folds a territory to one`);
  }
});

// ---------------------------------------------------------------------------
// THE CAMERA — it must not move between scenes, or a cost difference is a framing difference
// ---------------------------------------------------------------------------

test('every scene at a timed zoom shares one camera, so island count is the only thing moving', () => {
  for (const zoom of CROWD_ZOOMS) {
    const ref = buildCrowdScene('dense', ONE, zoom);
    for (const size of CROWD_SIZES) {
      for (const arm of CROWD_ARMS) {
        const s = buildCrowdScene(arm, size, zoom);
        assert.equal(s.width, ref.width, 'the buffer is the reader\'s screen and never changes');
        assert.equal(s.height, ref.height);
        assert.equal(s.pxPerUnit, zoom, 'a timed zoom IS its px/unit — no fitting, no derivation');
        assert.deepEqual(
          s.camera.projectionMatrix.toArray(),
          ref.camera.projectionMatrix.toArray(),
          `${arm}/${size.id} at zoom ${zoom} is framed differently from the control`,
        );
        assert.deepEqual(
          s.camera.matrixWorldInverse.toArray(),
          ref.camera.matrixWorldInverse.toArray(),
          `${arm}/${size.id} at zoom ${zoom} looks from somewhere else`,
        );
      }
    }
  }
});

test('the crowd is re-centred on one of its own islands, so every frame lands on land', () => {
  // The anchor island sits at the origin — the same place the single-island scene's island sits.
  const islands = crowdIslands(REAL);
  assert.ok(
    islands.some((i) => i.offset.x === 0 && i.offset.z === 0),
    'no island stands at the origin, so the 8 px/unit frame may be centred on open water and the ' +
      'three scenes would not be showing the same thing',
  );
  assert.equal(crowdIslands(ONE)[0]?.offset.x, 0);
  assert.equal(crowdIslands(ONE)[0]?.offset.z, 0);
});

test('the fit zoom is never one of the timed zooms', () => {
  // It delivers a different px/unit per scene by construction, so timing at it would compare three
  // different frames and call the difference the ladder's.
  // Compared as strings rather than through an assertion chain: `CROWD_ZOOMS` is numbers and
  // `FIT_ZOOM` is the literal 'fit', so `includes` cannot be asked directly — and casting to ask it
  // would discard exactly the type evidence that makes the two kinds of zoom distinguishable.
  assert.ok(CROWD_ZOOMS.every((z) => String(z) !== FIT_ZOOM));
  assert.ok(
    crowdPxPerUnit(REAL, FIT_ZOOM) < crowdPxPerUnit(ONE, FIT_ZOOM),
    'fitting a forest must zoom further out than fitting one island',
  );
});

// ---------------------------------------------------------------------------
// THE CASTERS AND THE OCCLUSION CLAMP — the branch nobody had ever drawn
// ---------------------------------------------------------------------------

test('every island brings its own casters, so no island wears the whole forest\'s shadows', () => {
  // ⚠⚠ THIS TEST WENT SILENTLY VACUOUS ON 2026-09-04 AND HAD TO BE REBUILT, NOT RENUMBERED. It
  // asserted `casters.length === shippedCasters().length * REAL.islands` and that no two casters
  // share a place. ADR-0508 retired the placeholder story tree, which was the ONLY thing an
  // island's descriptor stream stood, so `shippedCasters()` became `[]` and both assertions
  // degenerated to `0 === 0` over an empty set — still GREEN, and no longer checking the offsets
  // at all. Nothing failed; the check simply stopped checking, which is the one outcome a suite
  // must never produce quietly.
  //
  // So the per-island offsetting — the property this test exists for, and the one whose absence
  // stacks thirty-five islands' shadows on one — is now proved against a SYNTHETIC base list,
  // because the real one is legitimately empty and no longer a subject.
  assert.deepEqual(shippedCasters(), [], 'the island stands nothing of its own since ADR-0508');
  assert.deepEqual(crowdCasters(REAL), [], 'so the crowd replicates nothing');

  const base = [
    { x: 0, z: 0, radius: 3, height: 5 },
    { x: 7, z: -2, radius: 1, height: 2 },
  ];
  const offset = offsetPerIsland(base, REAL);
  assert.equal(offset.length, base.length * REAL.islands);
  const places = new Set(offset.map((c) => `${c.x},${c.z}`));
  assert.equal(
    places.size,
    offset.length,
    'two casters at one place means the offsets were not applied and 35 islands\' shadows are ' +
      'stacked on one',
  );
});

test('the occlusion field hits the SHADOW_TEXTURE_MAX clamp at forest scale, and not on one island', () => {
  const one = buildCrowdScene('dense', ONE, 2);
  const forest = buildCrowdScene('dense', REAL, 2);
  assert.equal(
    one.shadowGres,
    SHADOW_GRES,
    'one island is small enough for the full sampling rate — if this ever fails, the committed ' +
      'single-island shadow evidence was taken at a resolution nobody recorded',
  );
  // ⚠ THE FINDING THIS PAGE IS THE FIRST TO EXERCISE. `src/land-shadow.ts:58-66` budgets for
  // "a forest of thirty-five islands spread over a thousand units square" and clamps the
  // RESOLUTION rather than refusing. That branch had never run. It runs here, and the page reports
  // what it costs instead of assuming the shadow survived it.
  assert.ok(
    forest.shadowGres < SHADOW_GRES,
    'the forest is supposed to be big enough to hit the texture cap — if it no longer is, this ' +
      'page has stopped testing the case it was built for',
  );
  assert.ok(
    Math.max(forest.shadowW, forest.shadowH) <= 2048,
    'the clamp exists to keep the field inside its budget',
  );
});

// ---------------------------------------------------------------------------
// THE STRIPS — two landings per island, so layer 3's connector has a crossing to draw
// ---------------------------------------------------------------------------

test('the landings are the recipe`s two bearings, and every island gets exactly two strips', () => {
  assert.deepEqual([...CROWD_LANDING_BEARINGS], [-160, 25]);
  assert.equal(CROWD_STRIP_OFFSHORE, 2 * DOCK_REACH);
  // ⚠ THE REAL INVARIANT, NOT THE PROXY IT REPLACES (ADR-0596). This asserted
  // `CROWD_STRIP_OFFSHORE > DOCK_REACH` — the distance from the seaward end to its OWN LANDING
  // against the reach — and that comparison stayed true while 16 of 70 seaward ends started
  // docking anyway, because the coast curves away from the landing and the reach is measured to
  // the NEAREST RIM POINT. Asserted where it actually bites, below, over every rim.
  assert.equal(crowdStrips(ONE).length, 2);
  assert.equal(crowdStrips(REAL).length, REAL.islands * 2);
  for (const s of crowdStrips(ONE)) {
    assert.equal(s.kind, 'trail-strip');
    assert.equal(s.hidden, false);
    assert.equal(s.points?.length, 3);
    assert.ok(typeof s.segment === 'string' && s.segment.length > 0);
  }
});

test('each strip ENDS ON its island`s clipped rim and STARTS two dock-reaches offshore of it', () => {
  const clipped = clipToCoast(crowdCells(REAL), SHIPPED_COAST);
  const strips = crowdStrips(REAL);
  const docks = islandDocks(clipped, strips);
  const rims = new Map(islandRims(clipped).map((r) => [r.island, r]));
  for (const rim of rims.values()) {
    const own = docks.get(rim.island)!;
    assert.equal(own.length, 2, `${rim.island} has ${own.length} docks, not two`);
  }
  for (const s of strips) {
    const pts = s.points!;
    const end = pts[pts.length - 1]!;
    const start = pts[0]!;
    assert.ok(
      Math.abs(Math.hypot(start.x - end.x, start.z - end.z) - CROWD_STRIP_OFFSHORE) < 1e-9,
      'the seaward end is not CROWD_STRIP_OFFSHORE (2 × DOCK_REACH) units from the landing',
    );
    // The landing IS a rim vertex, so the dock snap moves it by nothing: it appears verbatim.
    const island = s.segment!.split('/')[0]!;
    assert.ok(
      docks.get(island)!.some((d) => Math.abs(d.x - end.x) < 1e-9 && Math.abs(d.z - end.z) < 1e-9),
      `${s.segment}: the landing (${end.x}, ${end.z}) is not one of ${island}'s docks`,
    );
    // ⚠ AND THE SEAWARD END REACHES NO RIM AT ALL — the invariant `CROWD_STRIP_OFFSHORE`'s own
    // sentence claims, asserted against EVERY island rather than against the landing it came from.
    // Measured where it bites: the offshore point sits further from its landing than from the
    // coast a little way around, so the distance to the nearest rim is the number that decides
    // whether it docks, and it is the one that silently crossed the reach when ADR-0596 widened it.
    for (const other of rims.values()) {
      const g = rimGrid(other);
      assert.ok(
        nearestOnSegments(g, start.x, start.z, DOCK_REACH).distance >= DOCK_REACH,
        `${s.segment}: the seaward end is within dock reach of ${other.island}`,
      );
    }
    // And it lands near its bearing — within a rim vertex's spacing of it.
    const rim = rims.get(island)!;
    const degrees = Number(s.segment!.split('landing-')[1]);
    const d = bearingFrom(rim.centroid, { x: end.x, z: end.z }) - (degrees * Math.PI) / 180;
    assert.ok(Math.abs(Math.atan2(Math.sin(d), Math.cos(d))) < 0.2, `${s.segment} landed ${d} rad off`);
  }
});

test('coastAt picks the rim vertex nearest the bearing, wrapping at +-pi', () => {
  const rim = islandRims(clipToCoast(crowdCells(ONE), SHIPPED_COAST))[0]!;
  const east = coastAt(rim, 0);
  assert.ok(east.x > rim.centroid.x, 'bearing 0 is east of the centroid');
  const west = coastAt(rim, Math.PI);
  assert.ok(west.x < rim.centroid.x, 'bearing pi is west of it');
  // The wrap: -pi and +pi are the same direction.
  assert.deepEqual(coastAt(rim, -Math.PI), west);
});

test('islandPaths joins the two landings across every island — ONE crossing per island', () => {
  const clipped = clipToCoast(crowdCells(REAL), SHIPPED_COAST);
  const paths = islandPaths(clipped, crowdStrips(REAL));
  assert.equal(paths.size, REAL.islands);
  for (const [island, own] of paths) {
    assert.equal(own.length, 1, `${island} has ${own.length} paths, not one crossing`);
    assert.equal(own[0]!.length, 80, 'five control points, four Chaikin passes');
  }
  // Deterministic: the same crowd wears the same paths twice.
  assert.deepEqual(paths, islandPaths(clipped, crowdStrips(REAL)));
});

// ---------------------------------------------------------------------------------------------
// THE OWNER-LOOK ARM: `orientedCamera` can be aimed at another elevation, and absent is the shipped
// angle. `the-two-layers-share-one-elevation` needs the same forest photographed at 20° and 50°;
// what a test can hold is that asking moves EXACTLY the elevation, and that not asking moves nothing.

test('orientedCamera without an elevation is the SHIPPED angle — every existing caller is unmoved', () => {
  // Read off the camera's own world direction, never transcribed. `viewElevationDeg` rather than the
  // land-ratio page's position-normalising reader, so an off-origin centre reports the truth too.
  assert.ok(Math.abs(viewElevationDeg(orientedCamera({ x: 0, z: 0 }, 1)) - RENDER_ELEV_DEG) < 1e-9);
  assert.ok(Math.abs(viewElevationDeg(orientedCamera({ x: 1700, z: -2400 }, 3.5)) - RENDER_ELEV_DEG) < 1e-9);
});

test('orientedCamera aimed at an elevation looks down at exactly that, from any centre and any zoom', () => {
  for (const deg of [20, 35, 50, 65]) {
    for (const centre of [{ x: 0, z: 0 }, { x: 1700, z: -2400 }]) {
      const got = viewElevationDeg(orientedCamera(centre, 2, deg));
      assert.ok(Math.abs(got - deg) < 1e-6, `asked ${deg}°, camera looks down at ${got.toFixed(6)}° from (${centre.x}, ${centre.z})`);
    }
  }
});

test('asking for the shipped elevation reproduces the shipped direction — the arm has no seam at 50°', () => {
  const shipped = orientedCamera({ x: 0, z: 0 }, 1);
  const asked = orientedCamera({ x: 0, z: 0 }, 1, RENDER_ELEV_DEG);
  for (const k of ['x', 'y', 'z'] as const) {
    assert.ok(Math.abs(shipped.position[k] - asked.position[k]) < 1e-6, `${k}: ${shipped.position[k]} vs ${asked.position[k]}`);
  }
});

test('ONLY the elevation moves — the azimuth is kept, so the arm compares one thing', () => {
  // ⚠ THE ASSERTION THAT CATCHES A RE-AIMED BEARING. ADR-0380 D6 fixes the azimuth; an arm that
  // swung it too would put two different views side by side and call the difference elevation.
  const bearing = (v: { x: number; z: number }) => Math.atan2(v.x, v.z);
  const shipped = viewDirAtElevation(RENDER_ELEV_DEG);
  for (const deg of [20, 35, 65]) {
    const d = viewDirAtElevation(deg);
    assert.ok(Math.abs(bearing(d) - bearing(shipped)) < 1e-9, `${deg}° swung the azimuth`);
    // and the direction is still a unit vector, so `dist` still means what the camera thinks it does
    assert.ok(Math.abs(Math.hypot(d.x, d.y, d.z) - 1) < 1e-12);
  }
});
