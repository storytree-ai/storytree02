// The scene-graph's inner-loop dogfood (ADR-0093 / ADR-0020): the framework-agnostic
// drawable tree is DETERMINISTIC (same input → byte-identical scene), selects the
// right drawables per folded status, and lays out the canonical structure. The
// studio's VISUAL PARITY is operator-attested (ADR-0070), not asserted here — these
// tests pin the geometry + structure the mapper renders FROM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { hash, rand01 } from './rng.js';
import { unprojectGround } from './camera.js';
import { TILE_SCALE, tileUnits } from './hex.js';
import { crownRadius } from './sizing.js';
import { routeTrails, trailFillWidth, type TrailIsland } from './routing.js';
import type { RelaxedCell } from './substrate.js';
import {
  buildScene,
  buildTrails,
  buildTree,
  buildPlant,
  buildConifer,
  landCellId,
  placeGardenHeroes,
  treeKeepOut,
  fittedHeroScale,
  type SceneG,
  type SceneNode,
  type SceneInput,
  type SceneTerritoryInput,
  type ScenePlantInput,
  type SceneParcelInput,
  type SceneGardenInput,
  type SceneGardenHero,
  type SceneVegetationInput,
  type SceneVegHeroTrees,
  type GardenHeroId,
  TRAIL_STROKE_SCALE,
} from './scene.js';
import { BASE_TRAILS, isle, legacyInput, shippedInput, shippedTerritory } from './scene-fixture.js';

// ---------- traversal helpers ----------

function children(n: SceneNode): SceneNode[] {
  return n.el === 'g' ? n.children : [];
}
/** First descendant (incl. self) whose kind matches, DFS. */
function firstByKind(n: SceneNode, kind: string): SceneNode | null {
  if (n.kind === kind) return n;
  for (const c of children(n)) {
    const hit = firstByKind(c, kind);
    if (hit) return hit;
  }
  return null;
}
/** Every descendant (incl. self) whose kind matches. */
function allByKind(n: SceneNode, kind: string): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (m: SceneNode): void => {
    if (m.kind === kind) out.push(m);
    for (const c of children(m)) walk(c);
  };
  walk(n);
  return out;
}
function mustByKind(n: SceneNode, kind: string): SceneNode {
  const hit = firstByKind(n, kind);
  assert.ok(hit, `expected a "${kind}" node`);
  return hit;
}

// ---------- fixtures ----------

// The SHARED default (`scene-fixture.ts`) is shipped-map-shaped: `relaxedCells` non-null AND every
// capability-bearing territory carrying `parcels`, because that is what the studio sends. A test that
// wants the WEBSITE's absence render asks for it BY NAME (`legacyInput` / `withoutParcels`) rather
// than getting it by writing nothing — the inversion is the whole point of the shared fixture.
const mkTerritory = shippedTerritory;
const mkInput = shippedInput;

// two near-parallel edges into one destination — the reuse discount merges a trunk
const MERGE_TRAILS = routeTrails(
  [isle('a', -800, -60, 35), isle('b', -800, 60, 35), isle('c', 0, 0, 45)],
  [
    { from: 'a', to: 'c' },
    { from: 'b', to: 'c' },
  ],
  'scene-merge',
);

// a walled-in edge — forced under the ring, so hidden ghost runs + cave portals exist
const CAVE_ISLANDS: TrailIsland[] = [isle('A', 0, 0, 30), isle('B', 600, 0, 30)];
for (let k = 0; k < 8; k++) {
  const a = (Math.PI / 4) * k;
  CAVE_ISLANDS.push(isle(`ring${k}`, 150 * Math.cos(a), 150 * Math.sin(a), 60));
}
const CAVE_TRAILS = routeTrails(CAVE_ISLANDS, [{ from: 'A', to: 'B' }], 'scene-cave');

// ---------- the shared default IS the shipped map (render-fixtures-default-to-the-shipped-map) ----------
//
// The red→green pin for the fixture inversion. Before the shared default carried `parcels`, this
// assertion could not be written honestly: `mkInput()` rendered the conifer decor + the
// one-plant-per-cap ring and NO `parcel-flora` at all, which is the public website's art — not
// anything the studio map has drawn since forest-parcels inc 1 landed. Its mirror below pins the
// named opt-out still reaching the legacy path, so the lock is preserved, not weakened.

test('the SHARED DEFAULT fixture renders the SHIPPED map: parcel flora, not the retired conifer + plant ring', () => {
  const layer = mustByKind(buildScene(mkInput()), 'flora-layer');
  assert.ok(
    allByKind(layer, 'parcel-flora').length > 0,
    'the default fixture must grow the capability-parcel flora the studio map actually draws',
  );
  assert.equal(firstByKind(layer, 'conifer'), null, 'the decorative conifers are retired on a parcels island');
  assert.equal(firstByKind(layer, 'flora'), null, 'the one-plant-per-cap ring is retired on a parcels island');
});

test('the NAMED opt-out still reaches the website render — omission is no longer how you get there', () => {
  const layer = mustByKind(buildScene(legacyInput()), 'flora-layer');
  assert.equal(firstByKind(layer, 'parcel-flora'), null, 'no parcel flora once the parcels are named away');
  assert.ok(firstByKind(layer, 'conifer'), 'the conifer decor returns on the absence path');
  assert.ok(firstByKind(layer, 'flora'), 'the one-plant-per-cap ring returns on the absence path');
  // and the opt-out is exactly the parcel gate — the substrate gate stays open.
  assert.ok(firstByKind(buildScene(legacyInput()), 'ground-mesh'));
});

// ---------- determinism ----------

test('buildScene is deterministic — same input → byte-identical scene', () => {
  assert.deepEqual(buildScene(mkInput()), buildScene(mkInput()));
});

test('crown jitter is seeded by the story id (same id → same blobs; different id → different)', () => {
  const a = buildTree(mkTerritory({ id: 'alpha' }));
  const a2 = buildTree(mkTerritory({ id: 'alpha' }));
  const b = buildTree(mkTerritory({ id: 'beta' }));
  assert.deepEqual(a, a2);
  const cx = (t: SceneG): number => {
    const lo = mustByKind(t, 'crown-lo');
    const blob = children(lo)[1]; // [0] is the un-jittered central blob
    assert.ok(blob && blob.el === 'circle');
    return blob.cx;
  };
  assert.notEqual(cx(a), cx(b));
});

// ---------- top-level structure ----------

test('buildScene roots an offset world group with the layers in canonical order', () => {
  const scene = buildScene(mkInput());
  assert.equal(scene.kind, 'world');
  assert.match(scene.transform ?? '', /^translate\(300\.0 400\.0\)$/);
  assert.deepEqual(
    scene.children.map((c) => c.kind),
    ['empties-layer', 'coast-layer', 'ground-mesh', 'trails-layer', 'flora-layer', 'hits-layer'],
  );
});

test('mesh ground groups cells by owner; hex ground emits a group per tile', () => {
  const mesh = buildScene(mkInput());
  const ground = mustByKind(mesh, 'ground-mesh');
  // two owners with cells → two territory groups.
  assert.equal(allByKind(ground, 'ground').length, 2);
  // On the SHIPPED default the capability parcels sub-partition owner 0's cells and re-tint them by
  // CAP status, so all three cells are plain `cell`s: the WHEAT vocabulary is a parcels-ABSENT
  // drawable, and this test now says which fixture it is asserting about.
  assert.equal(allByKind(ground, 'cell-wheat').length, 0);
  assert.equal(allByKind(ground, 'cell').length, 3);

  // the website's mesh (parcels named away) — owner 0 has a wheat + a variant cell.
  const websiteGround = mustByKind(buildScene(legacyInput()), 'ground-mesh');
  assert.equal(allByKind(websiteGround, 'ground').length, 2);
  assert.equal(allByKind(websiteGround, 'cell-wheat').length, 1);
  assert.equal(allByKind(websiteGround, 'cell').length, 2);

  const hex = buildScene(mkInput({ relaxedCells: null }));
  const hexGround = mustByKind(hex, 'ground-hex');
  assert.equal(allByKind(hexGround, 'tile').length, 2); // one group per drawTile
  assert.equal(allByKind(hexGround, 'tile-side').length, 2);
  // tile 0,0 is in owner 0's wheat set → a wheat top; tile 1,0 is a plain variant top.
  assert.equal(allByKind(hexGround, 'tile-top-wheat').length, 1);
  assert.equal(allByKind(hexGround, 'tile-top').length, 1);
});

test('empties + hits are one per input', () => {
  const scene = buildScene(mkInput());
  assert.equal(allByKind(mustByKind(scene, 'empties-layer'), 'empty').length, 2);
  assert.equal(allByKind(mustByKind(scene, 'hits-layer'), 'hit').length, 2);
});

// ADR-0286: the coast is derived from the UNION of claimed land, so it carries no owner of its
// own — and while it carried none, the Act 2 regrow's per-story hide could not reach it and the
// moat drew the whole forest's silhouette before any island existed. An ATTRIBUTED coast hex names
// the island it grew out of; an unattributed one stays exactly as it was.
test('an attributed coast hex names its island; an unattributed one carries no id', () => {
  const scene = buildScene(
    mkInput({
      empties: [
        { q: 0, r: 0, owner: 0 },
        { q: 1, r: 0, owner: 1 },
        { q: 2, r: 0 },
      ],
    }),
  );
  const empties = allByKind(mustByKind(scene, 'empties-layer'), 'empty');
  assert.deepEqual(
    empties.map((e) => e.id),
    ['library', 'cli', undefined],
  );
});

// The honesty wall: an owner index no territory answers to must not invent a story id. It falls
// back to unattributed (always drawn), never to some other island's coast.
test('a coast hex whose owner index is out of range stays unattributed', () => {
  const scene = buildScene(mkInput({ empties: [{ q: 0, r: 0, owner: 99 }] }));
  const empties = allByKind(mustByKind(scene, 'empties-layer'), 'empty');
  assert.equal(empties.length, 1);
  assert.equal(empties[0]?.id, undefined);
});

// ---------- the trail network (ADR-0169 §2) ----------

test('the trails layer is FULL passes in order — shadow < casing < fill < ghost — then the edge metadata', () => {
  const layer = buildTrails(mkInput());
  assert.equal(layer.kind, 'trails-layer');
  assert.deepEqual(
    layer.children.map((c) => c.kind),
    ['trail-shadow-pass', 'trail-casing-pass', 'trail-fill-pass', 'trail-ghost-pass', 'trail-edges'],
  );
  // every visible segment appears exactly once per pass, one path each — passes are
  // never interleaved per path (the casing rule: a merge must read as one trail).
  const visible = BASE_TRAILS.segments.filter((s) => !s.hidden);
  assert.ok(visible.length > 0);
  for (const [pass, kind] of [
    ['trail-shadow-pass', 'trail-shadow'],
    ['trail-casing-pass', 'trail-casing'],
    ['trail-fill-pass', 'trail-fill'],
  ] as const) {
    const paths = children(mustByKind(layer, pass));
    assert.equal(paths.length, visible.length, `${pass} draws every visible segment once`);
    assert.ok(paths.every((p) => p.el === 'path' && p.kind === kind));
    assert.deepEqual(paths.map((p) => p.id).sort(), visible.map((s) => s.id).sort());
  }
  // the unobstructed fixture forces nothing under-island → an empty ghost pass.
  assert.equal(children(mustByKind(layer, 'trail-ghost-pass')).length, 0);
  // it renders inside the world above ground, below flora.
  assert.equal(firstByKind(buildScene(mkInput()), 'trails-layer')?.kind, 'trails-layer');
});

test('each segment path carries id / data-usage / data-edges + its pass width from the ONE rule', () => {
  const layer = buildTrails(mkInput());
  const byId = (pass: string, id: string): SceneNode => {
    const hit = children(mustByKind(layer, pass)).find((p) => p.id === id);
    assert.ok(hit, `${pass} carries segment ${id}`);
    return hit;
  };
  for (const seg of BASE_TRAILS.segments.filter((s) => !s.hidden)) {
    const w = trailFillWidth(seg.usage);
    const fill = byId('trail-fill-pass', seg.id);
    assert.ok(fill.el === 'path' && fill.d === seg.d, 'the fill draws the segment d verbatim');
    assert.equal(fill.usage, seg.usage);
    assert.equal(fill.edges, 'library->cli');
    // the ONE width rule, stroked at the 2D drawing's scale (ADR-0528: the 3D mapper reads the rule
    // directly, so the rule itself never moved; the 2D stroke is the rule × TRAIL_STROKE_SCALE).
    assert.equal(fill.strokeWidth, w * TRAIL_STROKE_SCALE);
    assert.equal(byId('trail-casing-pass', seg.id).strokeWidth, w * TRAIL_STROKE_SCALE + tileUnits(2.5));
    assert.equal(byId('trail-shadow-pass', seg.id).strokeWidth, w * TRAIL_STROKE_SCALE + tileUnits(5));
  }
});

test('a spur (usage 1) fill is dash-marked; a trunk (usage ≥ 2) is solid — from usage, never authored', () => {
  const layer = buildTrails(mkInput({ trails: MERGE_TRAILS }));
  const fills = children(mustByKind(layer, 'trail-fill-pass'));
  const spurs = fills.filter((p) => p.spur === true);
  const trunks = fills.filter((p) => p.spur === undefined);
  assert.ok(spurs.length > 0 && trunks.length > 0, 'the merge fixture emerges both spurs and a trunk');
  for (const p of spurs) assert.equal(p.usage, 1);
  for (const p of trunks) assert.ok((p.usage ?? 0) >= 2, 'an unmarked fill is a trunk');
  // the merged trunk carries BOTH edge keys through data-edges.
  assert.ok(trunks.some((p) => (p.edges ?? '').split(',').sort().join(',') === 'a->c,b->c'));
  // the mark is a FILL concern only — shadow + casing stay solid under a dashed spur.
  for (const pass of ['trail-shadow-pass', 'trail-casing-pass'] as const) {
    for (const p of children(mustByKind(layer, pass))) assert.equal(p.spur, undefined);
  }
});

test('trail-edges is non-visual per-edge reveal metadata: data-from/to, title, the ordered F/R chain', () => {
  const meta = mustByKind(buildTrails(mkInput()), 'trail-edges');
  const edges = children(meta);
  assert.equal(edges.length, BASE_TRAILS.edges.length);
  const edge = edges[0]!;
  const src = BASE_TRAILS.edges[0]!;
  assert.ok(edge.el === 'g' && children(edge).length === 0, 'metadata only — no drawables');
  assert.equal(edge.kind, 'trail-edge');
  assert.equal(edge.from, src.from);
  assert.equal(edge.to, src.to);
  assert.equal(edge.title, 'cli depends on library');
  assert.equal(
    edge.segments,
    src.segments.map((r) => `${r.id}:${r.reversed ? 'R' : 'F'}`).join(','),
  );
  assert.ok((edge.segments ?? '').length > 0, 'the chain names at least one segment');
});

test('hidden under-island runs land ONLY in the ghost pass', () => {
  const layer = buildTrails(mkInput({ trails: CAVE_TRAILS }));
  const hidden = CAVE_TRAILS.segments.filter((s) => s.hidden);
  assert.ok(hidden.length > 0, 'the walled-in fixture forces hidden runs');
  const ghosts = children(mustByKind(layer, 'trail-ghost-pass'));
  assert.deepEqual(ghosts.map((p) => p.id).sort(), hidden.map((s) => s.id).sort());
  assert.ok(ghosts.every((p) => p.el === 'path' && p.kind === 'trail-ghost'));
  // the ghost pass never marks a spur — the dashed-footpath read belongs to the FILL pass only.
  assert.ok(hidden.some((s) => s.usage === 1), 'the fixture carries a hidden spur, so the next line is not vacuous');
  assert.ok(ghosts.every((p) => p.spur === undefined), 'a ghost run carries no spur mark');
  const hiddenIds = new Set(hidden.map((s) => s.id));
  for (const pass of ['trail-shadow-pass', 'trail-casing-pass', 'trail-fill-pass'] as const) {
    for (const p of children(mustByKind(layer, pass))) {
      assert.ok(!hiddenIds.has(p.id ?? ''), `${pass} never draws a hidden segment`);
    }
  }
});

test('cave portals are PROPS above the flora: arch + rim + apron at the rim bearing, status-folded', () => {
  const cave0 = CAVE_TRAILS.caves[0]!;
  const scene = buildScene(
    mkInput({
      trails: CAVE_TRAILS,
      territories: [mkTerritory({ id: cave0.islandId, status: 'unhealthy' })],
    }),
  );
  const flora = mustByKind(scene, 'flora-layer');
  const caves = children(flora).filter((c) => c.kind === 'cave');
  assert.equal(caves.length, CAVE_TRAILS.caves.length, 'one prop per portal');
  // appended AFTER the territories, so the arch occludes the trail disappearing under.
  const kinds = children(flora).map((c) => c.kind);
  assert.ok(kinds.lastIndexOf('territory') < kinds.indexOf('cave'));
  const cave = caves[0]!;
  assert.ok(cave.el === 'g');
  assert.equal(cave.island, cave0.islandId);
  assert.equal(cave.edges, cave0.edgeIds.join(','));
  // placed at the portal point, rotated to the outward bearing.
  const deg = (cave0.bearing * 180) / Math.PI;
  assert.equal(
    cave.transform,
    `translate(${cave0.x.toFixed(1)} ${cave0.y.toFixed(1)}) rotate(${deg.toFixed(1)})`,
  );
  // the folded island status keys the mapper's shadow/side-wall hue family; a wall
  // island with no territory wears the neutral fallback.
  for (const c of caves) {
    assert.equal(c.status, c.island === cave0.islandId ? 'unhealthy' : 'unknown');
  }
  // the dark flat-bottomed arch, its lit rim arc, and the trampled apron — sized 1.6×
  // from the portal's trail width.
  assert.ok(firstByKind(cave, 'cave-arch'));
  assert.equal(mustByKind(cave, 'cave-rim').strokeWidth, 1.5);
  const apron = mustByKind(cave, 'cave-apron');
  const hw = (cave0.width * 1.6) / 2;
  assert.ok(apron.el === 'ellipse' && Math.abs(apron.rx - hw * 1.3) < 1e-9);
});

test('buildScene stays deterministic with trails + caves present (same input → byte-identical)', () => {
  assert.deepEqual(
    buildScene(mkInput({ trails: CAVE_TRAILS })),
    buildScene(mkInput({ trails: CAVE_TRAILS })),
  );
});

// ---------- the central tree ----------

test('a healthy tree has a full canopy: trunk + 5 low blobs + 3 highlights, no bare branches', () => {
  const t = buildTree(mkTerritory({ status: 'healthy', caps: 3 }));
  assert.equal(t.kind, 'tree');
  assert.equal(t.status, 'healthy');
  assert.ok(firstByKind(t, 'trunk'));
  assert.equal(children(mustByKind(t, 'crown-lo')).length, 5);
  assert.equal(children(mustByKind(t, 'crown-hi')).length, 3);
  assert.equal(firstByKind(t, 'bare'), null);
  assert.equal(allByKind(t, 'litter').length, 0);
  // the un-jittered central blob: cx 0, r = crownRadius(caps), cy = -1.65·R.
  const central = children(mustByKind(t, 'crown-lo'))[0];
  assert.ok(central && central.el === 'circle');
  const R = crownRadius(3);
  assert.equal(central.cx, 0);
  assert.equal(central.r, R);
  assert.ok(Math.abs(central.cy - -1.65 * R) < 1e-9);
});

test('an unhealthy tree withers: bare branches + leaf litter, a sparse crown, no full canopy', () => {
  const t = buildTree(mkTerritory({ status: 'unhealthy', caps: 3 }));
  assert.equal(children(mustByKind(t, 'crown-lo')).length, 2);
  assert.equal(children(mustByKind(t, 'crown-hi')).length, 1);
  assert.equal(mustByKind(t, 'crown-hi').opacity, 0.7);
  assert.equal(children(mustByKind(t, 'bare')).length, 4);
  assert.equal(allByKind(t, 'litter').length, 4);
});

test('proposed + claimed-but-empty stories render the not-yet-full (young) form', () => {
  const central = (t: SceneTerritoryInput): number => {
    const c = children(mustByKind(buildTree(t), 'crown-lo'))[0];
    assert.ok(c && c.el === 'circle');
    return c.r;
  };
  // proposed scales the crown to 0.62; a 0-cap healthy story wears the same small form.
  assert.ok(Math.abs(central(mkTerritory({ status: 'proposed', caps: 4 })) - crownRadius(4) * 0.62) < 1e-9);
  assert.ok(Math.abs(central(mkTerritory({ status: 'healthy', caps: 0 })) - crownRadius(0) * 0.62) < 1e-9);
  // a normal healthy story keeps the full crown.
  assert.equal(central(mkTerritory({ status: 'healthy', caps: 4 })), crownRadius(4));
});

test('the human-witness signpost appears only when declared; blank vs signed seal', () => {
  assert.equal(firstByKind(buildTree(mkTerritory()), 'sign-blank'), null);
  assert.ok(firstByKind(buildTree(mkTerritory({ signpost: { outcome: null } })), 'sign-blank'));
  assert.ok(firstByKind(buildTree(mkTerritory({ signpost: { outcome: 'pass' } })), 'sign-pass'));
  assert.ok(firstByKind(buildTree(mkTerritory({ signpost: { outcome: 'fail' } })), 'sign-fail'));
});

// ---------- flora ----------

test('a plant picks its variant from its id and is alive by default', () => {
  const p = buildPlant({ id: 'x#cap', status: 'healthy', x: 0, y: 0, title: 't' });
  assert.equal(p.kind, 'flora');
  // carries its capability id — the hook each mapper keys interactivity on.
  assert.equal(p.id, 'x#cap');
  assert.equal(firstByKind(p, 'dead-ground'), null);
  // shadow is the wider living size (rx 8), not the dead size (rx 6).
  const shadow = mustByKind(p, 'shadow');
  assert.ok(shadow.el === 'ellipse' && shadow.rx === 8);
});

test('an unhealthy plant withers: a dead-ground patch, the narrower dead shadow, dead silhouette', () => {
  const p = buildPlant({ id: 'x#cap', status: 'unhealthy', x: 0, y: 0, title: 't' });
  assert.ok(firstByKind(p, 'dead-ground'));
  const shadow = mustByKind(p, 'shadow');
  assert.ok(shadow.el === 'ellipse' && shadow.rx === 6);
  // a withered plant shows a dead silhouette (twig or dead stem), never living foliage.
  assert.equal(firstByKind(p, 'flora-light'), null);
  assert.ok(firstByKind(p, 'flora-dead-twig') || firstByKind(p, 'flora-dead-stem'));
});

// ---------- conifer decor ----------

test('a conifer is a leaning body + snow cap, its colour band from the seed', () => {
  const c = buildConifer(10, 20, 8, 5);
  assert.equal(c.kind, 'conifer');
  const body = mustByKind(c, 'conifer-body');
  assert.equal(body.variant, 5 % 3);
  assert.ok(firstByKind(c, 'conifer-snow'));
});

test('decor seeds expand to 2 + (seed % 2) conifers each', () => {
  const even = buildScene(mkInput({ territories: [mkTerritory({ decor: [{ x: 0, y: 0, seed: 4 }], plants: [] })] }));
  const odd = buildScene(mkInput({ territories: [mkTerritory({ decor: [{ x: 0, y: 0, seed: 5 }], plants: [] })] }));
  assert.equal(allByKind(mustByKind(even, 'flora-layer'), 'conifer').length, 2); // 2 + 0
  assert.equal(allByKind(mustByKind(odd, 'flora-layer'), 'conifer').length, 3); // 2 + 1
});

// ---------- the territory flora group ----------

test('a territory flora group y-sorts its drawables and carries the nameplate', () => {
  const flora = buildScene(mkInput()).children.find((c) => c.kind === 'flora-layer');
  assert.ok(flora && flora.el === 'g');
  const terr = children(flora)[0];
  assert.ok(terr && terr.kind === 'territory' && terr.el === 'g');
  assert.equal(terr.id, 'library');
  // nameplate present with the surface-folded text + box.
  const plate = mustByKind(terr, 'plate');
  const idText = mustByKind(plate, 'plate-id');
  assert.ok(idText.el === 'text' && idText.text === 'library');
  const bg = mustByKind(plate, 'plate-bg');
  assert.ok(bg.el === 'rect' && bg.width === 120 && bg.rx === 7);
});

test('a territory with in-flight builds carries a wisp orbit; none → no wisps', () => {
  const withWisp = buildScene(mkInput({ territories: [mkTerritory({ wisps: [{ runId: 'r1', title: 'building' }] })] }));
  const orbit = mustByKind(withWisp, 'wisps');
  const wisp = mustByKind(orbit, 'wisp');
  assert.equal(typeof wisp.phase, 'number');
  assert.ok(firstByKind(wisp, 'wisp-glow') && firstByKind(wisp, 'wisp-dot') && firstByKind(wisp, 'wisp-hit'));

  const noWisp = buildScene(mkInput()); // mkTerritory default has no wisps
  assert.equal(firstByKind(mustByKind(noWisp, 'flora-layer'), 'wisps'), null);
});

// ---------- the phase-resolved wisp band (ADR-0048 §3 v2) ----------

test('the wisp folds the live gate phase → a red/green band (location ⟂ form: phase is the rotation)', () => {
  const wispFor = (phase?: 'AUTHOR_TEST' | 'CONFIRM_RED' | 'IMPLEMENT' | 'CONFIRM_GREEN' | 'GATE') => {
    // No phase ⇒ the wisp carries NO `phase` key, which is the unbanded case asserted below.
    const wisp: SceneTerritoryInput['wisps'][number] = { runId: 'r1', title: 'building' };
    if (phase) wisp.phase = phase;
    const scene = buildScene(
      mkInput({
        territories: [mkTerritory({ wisps: [wisp] })],
      }),
    );
    return mustByKind(scene, 'wisp');
  };

  // red while authoring the test / confirming the red.
  assert.equal(wispFor('AUTHOR_TEST').phaseBand, 'red');
  assert.equal(wispFor('CONFIRM_RED').phaseBand, 'red');
  // green on the green observation + the gate.
  assert.equal(wispFor('CONFIRM_GREEN').phaseBand, 'green');
  assert.equal(wispFor('GATE').phaseBand, 'green');
  // IMPLEMENT (writing the source) and an absent phase are the neutral teal "building" band.
  assert.equal(wispFor('IMPLEMENT').phaseBand, 'building');
  assert.equal(wispFor(undefined).phaseBand, 'building');

  // location ⟂ form: the orbit ROTATION `phase` (a number, seeded from the runId) is UNCHANGED by
  // the build phase — the band is a separate, additive field.
  assert.equal(wispFor('GATE').phase, wispFor('CONFIRM_RED').phase);
  assert.equal(typeof wispFor('GATE').phase, 'number');
});

// ---------- the story-CLAIM wisp + the §5 honesty wall (ADR-0138) ----------

test('a territory with a claim carries a DISTINCT claim-wisp orbit (key-seeded); none → no claim wisps', () => {
  const withClaim = buildScene(
    mkInput({
      territories: [
        mkTerritory({ claims: [{ key: 's1', title: 'a session is here', colourState: 'authoring' }] }),
      ],
    }),
  );
  const orbit = mustByKind(withClaim, 'claim-wisps');
  const wisp = mustByKind(orbit, 'claim-wisp');
  // the claim wisp carries its subagent colour-state (form) and a key-seeded orbit rotation (geometry).
  assert.equal(wisp.colourState, 'authoring');
  assert.equal(typeof wisp.phase, 'number');
  // its OWN drawable family — distinct circles, never the build-wisp kinds.
  assert.ok(firstByKind(wisp, 'claim-wisp-glow') && firstByKind(wisp, 'claim-wisp-dot') && firstByKind(wisp, 'claim-wisp-hit'));

  const noClaim = buildScene(mkInput()); // mkTerritory default has no claims
  assert.equal(firstByKind(mustByKind(noClaim, 'flora-layer'), 'claim-wisps'), null);
});

test('each claim intent → its colour-state on the claim wisp (authoring / proving / supplementing)', () => {
  const claimFor = (colourState: 'authoring' | 'proving' | 'supplementing') => {
    const scene = buildScene(
      mkInput({ territories: [mkTerritory({ claims: [{ key: 'k', title: 't', colourState }] })] }),
    );
    return mustByKind(scene, 'claim-wisp');
  };
  assert.equal(claimFor('authoring').colourState, 'authoring');
  assert.equal(claimFor('proving').colourState, 'proving');
  assert.equal(claimFor('supplementing').colourState, 'supplementing');
});

// ---------- the build phase folded onto the ONE work body (ADR-0212) ----------

test('ADR-0212: a work claim with a live build phase folds it to a phaseBand on the SAME body', () => {
  const claimWith = (phase?: 'CONFIRM_RED' | 'IMPLEMENT' | 'GATE') => {
    // No phase ⇒ the claim carries NO `phase` key, which is the unbanded case asserted below.
    const claim: NonNullable<SceneTerritoryInput['claims']>[number] = {
      key: 's1',
      title: 't',
      colourState: 'proving',
    };
    if (phase) claim.phase = phase;
    return mustByKind(
      buildScene(
        mkInput({
          territories: [mkTerritory({ claims: [claim] })],
        }),
      ),
      'claim-wisp',
    );
  };

  // The build phase rides as the BAND on the one work body — no second orbiting wisp is emitted.
  assert.equal(claimWith('CONFIRM_RED').phaseBand, 'red');
  assert.equal(claimWith('GATE').phaseBand, 'green');
  assert.equal(claimWith('IMPLEMENT').phaseBand, 'building');

  // Back-compat: a claim with no live build carries NO band at all (pre-ADR-0212 surfaces unchanged).
  assert.equal(claimWith().phaseBand, undefined);
});

test('rc-claim-layer-never-folds-proof-vocabulary: ADR-0212: folding a GREEN build band never turns the claim body into a proof (the §5 wall holds)', () => {
  const wisp = mustByKind(
    buildScene(
      mkInput({
        territories: [
          mkTerritory({
            // GATE → the green band, the most at-risk case: green must stay MOTION, never colour.
            claims: [{ key: 's1', title: 't', colourState: 'proving', phase: 'GATE' }],
          }),
        ],
      }),
    ),
    'claim-wisp',
  );
  // Colour stays INTENT-driven — the band must not overwrite it into a proof reading.
  assert.equal(wisp.colourState, 'proving');
  // And the body still carries no proof token. Since ADR-0529/0536 retired the verdict bloom the
  // whole proof vocabulary is the island's `status` hue, so THAT is what a claim must never wear.
  assert.equal(wisp.status, undefined);
});

test('rc-claim-layer-never-folds-proof-vocabulary: §5 honesty wall: a claim wisp NEVER carries the proof signal — no folded `status` anywhere on the claim layer', () => {
  // A claim in EVERY colour-state, including the at-risk "proving" (the in-flight hue that must NOT
  // read as proven). The wall used to be stated against the verdict bloom; ADR-0529/0536 retired
  // that drawable, so the proof vocabulary the scene still carries is the FOLDED `status` — the
  // island's proven-green hue. That is what a coordination drawable must never wear, and it is a
  // live field other builders DO set (tree / flora / cell), so this stays falsifiable rather than
  // becoming a check the type system already guarantees.
  for (const colourState of ['authoring', 'proving', 'supplementing'] as const) {
    const scene = buildScene(
      mkInput({ territories: [mkTerritory({ claims: [{ key: 'k', title: 't', colourState }] })] }),
    );
    const orbit = mustByKind(scene, 'claim-wisps');
    const walk = (n: SceneNode): void => {
      assert.equal(n.status, undefined, 'a claim-layer node must never carry a folded status');
      for (const c of children(n)) walk(c);
    };
    walk(orbit);
  }
});

test('a BUILD wisp can carry the live subagent colourState (ADR-0138 §5) — additive to phaseBand, absent by default', () => {
  // back-compat: no colourState stamped → the wisp has none (the phaseBand look is unchanged).
  const plain = buildScene(mkInput({ territories: [mkTerritory({ wisps: [{ runId: 'r', title: 'b' }] })] }));
  assert.equal(mustByKind(plain, 'wisp').colourState, undefined);
  // stamped → the build wisp carries the role tint ALONGSIDE its red→green band.
  const tinted = buildScene(
    mkInput({ territories: [mkTerritory({ wisps: [{ runId: 'r', title: 'b', phase: 'CONFIRM_RED', colourState: 'proving' }] })] }),
  );
  const wisp = mustByKind(tinted, 'wisp');
  assert.equal(wisp.colourState, 'proving');
  assert.equal(wisp.phaseBand, 'red'); // the band still folds from the gate phase, unchanged
});

test('buildScene stays deterministic with a claim layer present (same input → byte-identical)', () => {
  const withClaims = (): SceneInput =>
    mkInput({ territories: [mkTerritory({ claims: [{ key: 's1', title: 't', colourState: 'proving' }] })] });
  assert.deepEqual(buildScene(withClaims()), buildScene(withClaims()));
});

// ---------- the claim-GRADE wisp geometry + the departure drawable (ADR-0200 D7) ----------
//
// Stage-1 GEOMETRY only: which drawable family a grade emits and its deterministic placement.
// The LOOK (colours / spacing / fade curve) is the mapper's, operator-attested later (ADR-0070).

test('an exploring claim WINDOW-SHOPS: a small local orbit beside the tree, rest spot on a PARENT g', () => {
  const input = (): SceneInput =>
    mkInput({
      territories: [
        mkTerritory({
          claims: [{ key: 's1', title: 'reading the store seam', colourState: 'authoring', grade: 'exploring' }],
        }),
      ],
    });
  const scene = buildScene(input());
  const orbit = mustByKind(scene, 'claim-wisps');
  const wisp = mustByKind(orbit, 'hover-wisp');
  // ADR-0212 REVERSES ADR-0200 D7's stationary rule: window shopping carries its own orbit `phase`,
  // so the mapper spins it. Position (a SMALL local orbit beside the island vs the work stage's
  // whole-island orbit) is what separates the two stages — see ADR-0212 channel 1.
  assert.equal(typeof wisp.phase, 'number');
  // the intent prose rides the title; the colour-state is carried unchanged.
  assert.equal(wisp.title, 'reading the store seam');
  assert.equal(wisp.colourState, 'authoring');
  // its OWN drawable family, mirroring the claim-wisp structure.
  assert.ok(firstByKind(wisp, 'hover-wisp-hit') && firstByKind(wisp, 'hover-wisp-glow') && firstByKind(wisp, 'hover-wisp-dot'));
  // an exploring claim never emits the orbiting work family.
  assert.equal(firstByKind(orbit, 'claim-wisp'), null);
  // deterministic: same input → byte-identical scene; the rest spot is a fixed translate.
  assert.deepEqual(buildScene(input()), buildScene(input()));
  // THE NESTING IS THE CONTRACT (ADR-0212): an `animateTransform` rotate REPLACES the `transform`
  // on the node it animates, so the rest spot may NOT sit on the rotated node — it lives on the
  // PARENT g, and the kind-bearing node holds only the small-orbit child. Collapse these three
  // levels into two and the dot sweeps the island centroid instead of its own rest spot.
  const restSpot = mustByKind(scene, 'claim-wisps');
  const outer = children(restSpot)[0];
  assert.ok(outer && outer.el === 'g' && outer.kind === undefined);
  assert.match(outer.transform ?? '', /^translate\(-?[\d.]+ -?[\d.]+\)$/);
  assert.equal(children(outer)[0], wisp);
  // the rotated node itself carries NO transform of its own for the rotate to clobber.
  assert.equal(wisp.transform, undefined);
  const orbitArm = children(wisp)[0];
  assert.ok(orbitArm && orbitArm.el === 'g');
  assert.match(orbitArm.transform ?? '', /^translate\([\d.]+ 0\) scale\([\d.]+\)$/);
  // per-key jitter: two hoverers on one island never stack exactly.
  const two = buildScene(
    mkInput({
      territories: [
        mkTerritory({
          claims: [
            { key: 's1', title: 't', colourState: 'authoring', grade: 'exploring' },
            { key: 's2', title: 't', colourState: 'authoring', grade: 'exploring' },
          ],
        }),
      ],
    }),
  );
  const hovers = allByKind(two, 'hover-wisp');
  assert.equal(hovers.length, 2);
  // the rest spot now lives on the PARENT g, so read the jitter from there — every hover-wisp's own
  // orbit arm is the same constant radius, which is exactly why it can't carry the rest spot.
  const spots = children(mustByKind(two, 'claim-wisps')).map((n) => n.transform ?? '');
  assert.equal(spots.length, 2);
  assert.notEqual(spots[0], spots[1]);
});

test('waiting claims QUEUE: queue-wisps in INPUT order along a line — index-placed, never hash-random', () => {
  const claimsOf = (keys: string[]) =>
    keys.map((key) => ({ key, title: `waiting ${key}`, colourState: 'proving' as const, grade: 'waiting' as const }));
  const scene = buildScene(mkInput({ territories: [mkTerritory({ claims: claimsOf(['w1', 'w2', 'w3']) })] }));
  const queue = allByKind(mustByKind(scene, 'claim-wisps'), 'queue-wisp');
  assert.equal(queue.length, 3);
  // input order preserved — the surface sends waiters ordered by claimedAt (the queue contract).
  assert.deepEqual(queue.map((q) => q.title), ['waiting w1', 'waiting w2', 'waiting w3']);
  // stationary: no orbit phase anywhere on the queue.
  for (const q of queue) assert.equal(q.phase, undefined);
  // strictly ordered positions along ONE line: x advances per queue index, y fixed.
  const spotOf = (q: SceneNode) => {
    const inner = children(q)[0];
    assert.ok(inner && inner.el === 'g');
    const m = /^translate\((-?[\d.]+) (-?[\d.]+)\) scale\([\d.]+\)$/.exec(inner.transform ?? '');
    assert.ok(m, 'a queue wisp sits at a plain translate (+ the body\'s drawing scale)');
    return { x: Number(m[1]), y: Number(m[2]) };
  };
  const spots = queue.map(spotOf);
  assert.ok(spots[0]!.x < spots[1]!.x && spots[1]!.x < spots[2]!.x, 'the line advances with the index');
  assert.ok(spots.every((s) => s.y === spots[0]!.y), 'one line — a shared y');
  // index-driven, never key-driven: different keys in the same slots land on the SAME spots.
  const other = buildScene(mkInput({ territories: [mkTerritory({ claims: claimsOf(['zz', 'aa', 'mm']) })] }));
  assert.deepEqual(allByKind(mustByKind(other, 'claim-wisps'), 'queue-wisp').map(spotOf), spots);
  // its OWN drawable family, mirroring the claim-wisp structure.
  assert.ok(
    firstByKind(queue[0]!, 'queue-wisp-hit') && firstByKind(queue[0]!, 'queue-wisp-glow') && firstByKind(queue[0]!, 'queue-wisp-dot'),
  );
});

test('a work claim — and a grade-ABSENT claim — keeps today\'s orbit unchanged (ADR-0200 D2 back-compat lock)', () => {
  const orbitFor = (claims: NonNullable<SceneTerritoryInput['claims']>): SceneNode =>
    mustByKind(buildScene(mkInput({ territories: [mkTerritory({ claims })] })), 'claim-wisps');
  const absent = orbitFor([{ key: 's1', title: 't', colourState: 'proving' }]);
  const work = orbitFor([{ key: 's1', title: 't', colourState: 'proving', grade: 'work' }]);
  // an absent grade IS the work claim — byte-identical output (every pre-grade surface unchanged).
  assert.deepEqual(absent, work);
  // the regression lock on today's orbit: kind, key-seeded rotation, radius·0.72 + 22 orbit.
  const wisp = mustByKind(absent, 'claim-wisp');
  assert.equal(wisp.phase, rand01(hash('s1')) * 360);
  assert.equal(wisp.colourState, 'proving');
  const inner = children(wisp)[0];
  assert.ok(inner && inner.el === 'g');
  // radius·0.72 + 22-on-the-old-tile, the body drawn at the tile's scale (ADR-0528)
  assert.equal(inner.transform, `translate(${(60 * 0.72 + tileUnits(22)).toFixed(1)} 0) scale(${TILE_SCALE.toFixed(1)})`);
  assert.ok(firstByKind(wisp, 'claim-wisp-hit') && firstByKind(wisp, 'claim-wisp-glow') && firstByKind(wisp, 'claim-wisp-dot'));
});

test('mixed grades share the ONE claim-wisps layer — each claim renders its own family', () => {
  const scene = buildScene(
    mkInput({
      territories: [
        mkTerritory({
          claims: [
            { key: 'e1', title: 't', colourState: 'authoring', grade: 'exploring' },
            { key: 'q1', title: 't', colourState: 'proving', grade: 'waiting' },
            { key: 'k1', title: 't', colourState: 'supplementing', grade: 'work' },
          ],
        }),
      ],
    }),
  );
  assert.equal(allByKind(scene, 'claim-wisps').length, 1);
  const orbit = mustByKind(scene, 'claim-wisps');
  assert.equal(allByKind(orbit, 'hover-wisp').length, 1);
  assert.equal(allByKind(orbit, 'queue-wisp').length, 1);
  assert.equal(allByKind(orbit, 'claim-wisp').length, 1);
});

test('departures emit a stationary departing-wisp family carrying ageRatio; absent/empty → NO layer', () => {
  const departed = buildScene(
    mkInput({ territories: [mkTerritory({ departures: [{ key: 's9', title: 'left the island', ageRatio: 0.5 }] })] }),
  );
  const layer = mustByKind(departed, 'departing-wisps');
  const wisp = mustByKind(layer, 'departing-wisp');
  // ageRatio rides the node — the mapper turns it into the fade (the curve is the mapper/CSS's job).
  assert.equal(wisp.ageRatio, 0.5);
  assert.equal(wisp.title, 'left the island');
  assert.equal(wisp.phase, undefined); // stationary — never an orbit
  assert.ok(
    firstByKind(wisp, 'departing-wisp-hit') && firstByKind(wisp, 'departing-wisp-glow') && firstByKind(wisp, 'departing-wisp-dot'),
  );
  // the leaving translation is deterministic and drifts with age.
  const spotAt = (ageRatio: number): string => {
    const s = buildScene(mkInput({ territories: [mkTerritory({ departures: [{ key: 's9', title: 't', ageRatio }] })] }));
    const inner = children(mustByKind(s, 'departing-wisp'))[0];
    assert.ok(inner && inner.el === 'g');
    return inner.transform ?? '';
  };
  assert.equal(spotAt(0.5), spotAt(0.5));
  assert.notEqual(spotAt(0.1), spotAt(0.9));
  // absent and empty departures both emit NO layer (no new empty groups for the website).
  assert.equal(firstByKind(buildScene(mkInput()), 'departing-wisps'), null);
  const empty = buildScene(mkInput({ territories: [mkTerritory({ departures: [] })] }));
  assert.equal(firstByKind(empty, 'departing-wisps'), null);
});

test('rc-claim-layer-never-folds-proof-vocabulary: §5 honesty wall holds for EVERY grade + the departure layer: no folded status', () => {
  const scene = buildScene(
    mkInput({
      territories: [
        mkTerritory({
          claims: [
            { key: 'e1', title: 't', colourState: 'authoring', grade: 'exploring' },
            { key: 'q1', title: 't', colourState: 'proving', grade: 'waiting' },
            { key: 'k1', title: 't', colourState: 'supplementing', grade: 'work' },
          ],
          departures: [{ key: 'd1', title: 't', ageRatio: 0.8 }],
        }),
      ],
    }),
  );
  for (const layerKind of ['claim-wisps', 'departing-wisps'] as const) {
    const layer = mustByKind(scene, layerKind);
    const walk = (n: SceneNode): void => {
      assert.equal(n.status, undefined, `a ${layerKind} node must never carry a folded status`);
      for (const c of children(n)) walk(c);
    };
    walk(layer);
  }
});

test('website back-compat: NO claims + NO departures → no wisp layers at all — the plate stays last', () => {
  // the public website omits `claims`/`departures` entirely — build a territory with the keys ABSENT.
  const { claims: _dropped, ...noClaimsTerritory } = mkTerritory();
  const scene = buildScene(mkInput({ territories: [noClaimsTerritory] }));
  const terr = mustByKind(scene, 'territory');
  assert.ok(terr.el === 'g');
  const kinds = children(terr).map((n) => n.kind);
  assert.equal(kinds[kinds.length - 1], 'plate');
  for (const k of ['wisps', 'claim-wisps', 'departing-wisps']) {
    assert.ok(!kinds.includes(k as never), `no empty ${k} group`);
  }
  // absent and [] render identically — the new optional keys add nothing when unused.
  assert.deepEqual(scene, buildScene(mkInput({ territories: [mkTerritory()] })));
});

// ---------- the byte-for-byte parcels-ABSENT regression lock (forest-parcels inc 1) ----------
//
// The website (and every parcels-unaware surface) must render TODAY's ground + conifer decor +
// one-plant-per-cap ring BYTE-FOR-BYTE once capability parcels land. This lock was generated from
// HEAD behaviour BEFORE the parcels branch existed and asserts deep-equality against the committed
// golden scene forever after — the parcels feature may only ADD a branch, never perturb the absence
// path. If this test goes red, the absence path drifted: fix the drift, never re-bake the fixture.
//
// The fixture input deliberately exercises every parcels-absent drawable family: conifer decor,
// the capability plant ring (alive + withered + a plant bloom), scattered wheat, a crown bloom, a
// signpost, an in-flight build wisp, and a story claim — across a healthy and a proposed island.

/** The pinned parcels-ABSENT input. Kept as pure literal data (+ a routed trail) so the golden
 *  generator can reproduce it verbatim; NO `parcels` field anywhere → the absence render path. */
function absenceLockInput(): SceneInput {
  const trails = routeTrails(
    [isle('library', 100, 200, 60), isle('cli', 300, 60, 50)],
    [{ from: 'library', to: 'cli', title: 'cli depends on library' }],
    'absence-lock',
  );
  return {
    offset: { x: 300, y: 400 },
    width: 1200,
    height: 1600,
    empties: [
      { q: 0, r: 0 },
      { q: 1, r: 0 },
    ],
    relaxedCells: [
      { owner: 0, poly: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], variant: 1, wheat: false },
      { owner: 0, poly: [{ x: 5, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 5 }], variant: 2, wheat: true },
      { owner: 0, poly: [{ x: 0, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 10 }], variant: 0, wheat: true },
      { owner: 1, poly: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }], variant: 0, wheat: false },
    ],
    drawTiles: [
      { h: { q: 0, r: 0 }, owner: 0 },
      { h: { q: 1, r: 0 }, owner: 1 },
    ],
    wheatSets: [new Set(['0,0']), new Set()],
    trails,
    territories: [
      {
        id: 'library',
        status: 'healthy',
        caps: 3,
        centroid: { x: 100, y: 200 },
        groundRadius: 60,
        screenRadius: 60,
        treeSpot: { x: 100, y: 190 },
        labelY: 260,
        coastGroundLoops: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]],
        decor: [
          { x: 80, y: 180, seed: 7 },
          { x: 120, y: 210, seed: 4 },
        ],
        plants: [
          { id: 'library#cap-a', status: 'healthy', x: 90, y: 205, title: 'cap a' },
          { id: 'library#cap-b', status: 'unhealthy', x: 110, y: 215, title: 'cap b' },
        ],
        treeTitle: 'library — healthy',
        signpost: { outcome: 'pass' },
        wisps: [{ runId: 'r1', title: 'building', phase: 'CONFIRM_RED', colourState: 'proving' }],
        claims: [{ key: 's1', title: 'a session is here', colourState: 'authoring', grade: 'work' }],
        plate: { w: 120, h: 33, rx: 7, idY: 14, subY: 27, idText: 'library', subText: 'healthy · 3 caps', title: 'The library' },
      },
      {
        id: 'cli',
        status: 'proposed',
        caps: 2,
        centroid: { x: 300, y: 60 },
        groundRadius: 50,
        screenRadius: 50,
        treeSpot: { x: 300, y: 50 },
        labelY: 120,
        coastGroundLoops: [[{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }]],
        decor: [{ x: 290, y: 55, seed: 5 }],
        plants: [{ id: 'cli#cap-x', status: 'proposed', x: 295, y: 65, title: 'cap x' }],
        treeTitle: 'cli — proposed',
        wisps: [],
        claims: [],
        plate: { w: 100, h: 30, rx: 6, idY: 13, subY: 25, idText: 'cli', subText: 'proposed · 2 caps', title: 'The cli' },
      },
    ],
  };
}

const ABSENCE_GOLDEN = fileURLToPath(new URL('./scene-absence-fixture.json', import.meta.url));

/**
 * Regenerate the lock from the current builder:
 *   `STORYTREE_REGEN_ABSENCE_LOCK=1 pnpm --filter @storytree/forest-world test`
 *
 * The lock is a whole-scene byte compare, so any deliberate geometry change (ADR-0367 D1 gave the
 * land a camera, which moves every projected y in here) has to rewrite it wholesale. Before this
 * escape hatch the file claimed to be "generated from HEAD" with no generator in the repo, so the
 * only way to move it was by hand — which is how a lock stops being evidence.
 */
// test-removed: `parcels-ABSENT scene matches the committed byte-for-byte lock (generated from HEAD)` was renamed to bind its declared contract; the unchanged predicate is covered by the title below.
// test-updated (refactor): `parcels-ABSENT scene matches the committed byte-for-byte lock (generated from HEAD)` gained only its declared-contract title prefix; its assertions are unchanged.
test('rc-scene-folds-drawables-and-status: parcels-ABSENT scene matches the committed byte-for-byte lock (generated from HEAD)', () => {
  const built = buildScene(absenceLockInput());
  if (process.env.STORYTREE_REGEN_ABSENCE_LOCK === '1') {
    writeFileSync(ABSENCE_GOLDEN, `${JSON.stringify(built, null, 2)}\n`);
  }
  const golden = JSON.parse(readFileSync(ABSENCE_GOLDEN, 'utf8'));
  assert.deepEqual(built, golden);
});

// ---------- capability PARCELS (forest-parcels inc 1) ----------
//
// Stage-1 GEOMETRY only: the cell → parcel assignment, the per-cell cap-status tint, the flora
// density curve, and the conifer/plant-ring retirement. The LOOK (theme palettes / flora craft) is
// the mapper's, operator-attested later (ADR-0070).

/** A relaxed substrate cell whose centroid is EXACTLY (cx, cy) — a small triangle around it. */
const cellAt = (cx: number, cy: number, owner: number): RelaxedCell => ({
  owner,
  poly: [{ x: cx - 2, y: cy - 2 }, { x: cx + 2, y: cy - 2 }, { x: cx, y: cy + 4 }],
  variant: 0,
  wheat: false,
});

const SEED_A = { x: 0, y: 0 };
const SEED_B = { x: 100, y: 0 };
// four cells hugging seed A, four hugging seed B — a mis-assignment would move the 4/4 split.
const CELLS_AB: RelaxedCell[] = [
  cellAt(0, 0, 0), cellAt(6, 6, 0), cellAt(-4, 4, 0), cellAt(8, -6, 0),
  cellAt(100, 0, 0), cellAt(96, 6, 0), cellAt(104, -4, 0), cellAt(98, 8, 0),
];

type Parcels = NonNullable<SceneTerritoryInput['parcels']>;
const parcelsAB = (testA: number, testB: number, theme: 'meadow' | 'woodland' | 'heath' = 'meadow'): Parcels => [
  { capId: 'capA', status: 'healthy', testCount: testA, theme, seed: SEED_A },
  { capId: 'capB', status: 'unhealthy', testCount: testB, theme, seed: SEED_B },
];

/** A one-island scene whose territory carries `parcels` — AND still has `decor`/`plants` set, so the
 *  retirement of the conifers + plant ring is observable. The territory status is `proposed` so a
 *  per-cell tint that matched it could not be mistaken for the (healthy/unhealthy) cap statuses. */
function parcelScene(parcels: Parcels, cells: RelaxedCell[]): SceneG {
  return buildScene(
    mkInput({
      relaxedCells: cells,
      territories: [
        mkTerritory({
          id: 'library',
          status: 'proposed',
          parcels,
          decor: [{ x: 80, y: 180, seed: 7 }],
          plants: [{ id: 'library#cap-a', status: 'healthy', x: 90, y: 205, title: 'cap a' }],
        }),
      ],
    }),
  );
}

test('parcels sub-partition the island cells by nearest seed (equal-weight Voronoi), deterministically', () => {
  const scene = parcelScene(parcelsAB(3, 3), CELLS_AB);
  const parcels = allByKind(mustByKind(scene, 'ground-mesh'), 'parcel');
  assert.equal(parcels.length, 2);
  const capA = parcels.find((p) => p.id === 'capA')!;
  const capB = parcels.find((p) => p.id === 'capB')!;
  // the 4 cells nearest seed A land under capA, the 4 nearest seed B under capB.
  assert.equal(children(capA).length, 4);
  assert.equal(children(capB).length, 4);
  // deterministic: same parcels input → byte-identical scene.
  assert.deepEqual(scene, parcelScene(parcelsAB(3, 3), CELLS_AB));
});

test('ADR-0528: NO CAPABILITY STARVES — a parcel whose seed shares a hex with another’s keeps the cell nearest it; islands where nobody starves are byte-for-byte the Voronoi', () => {
  // seed B sits EXACTLY on seed A (both capabilities on one hex): the plain Voronoi breaks every
  // tie toward the lowest index, so capB gets nothing.
  const starving: Parcels = [
    { capId: 'capA', status: 'healthy', testCount: 3, theme: 'meadow', seed: { x: 0, y: 0 } },
    { capId: 'capB', status: 'unhealthy', testCount: 3, theme: 'meadow', seed: { x: 0, y: 0 } },
  ];
  const cells = [cellAt(0, 0, 0), cellAt(6, 6, 0), cellAt(-4, 4, 0), cellAt(8, -6, 0)];
  const parcels = allByKind(mustByKind(parcelScene(starving, cells), 'ground-mesh'), 'parcel');
  const capA = parcels.find((p) => p.id === 'capA');
  const capB = parcels.find((p) => p.id === 'capB');
  assert.ok(capA && capB, 'both capabilities own ground');
  assert.equal(children(capB!).length, 1, 'the starving parcel takes exactly one cell');
  assert.equal(children(capA!).length, 3);
  // the cell it takes is the one nearest ITS seed, and it wears capB's status
  assert.equal(children(capB!)[0]!.status, 'unhealthy');
  // CONTROL: the well-separated fixture is untouched by the repair — 4/4, as the Voronoi test pins.
  const fair = allByKind(mustByKind(parcelScene(parcelsAB(3, 3), CELLS_AB), 'ground-mesh'), 'parcel');
  assert.deepEqual(fair.map((p) => children(p).length), [4, 4]);
});

test('every parcel cell wears its ASSIGNED cap status — not the per-territory status', () => {
  const scene = parcelScene(parcelsAB(3, 3), CELLS_AB);
  const parcels = allByKind(mustByKind(scene, 'ground-mesh'), 'parcel');
  const capA = parcels.find((p) => p.id === 'capA')!;
  const capB = parcels.find((p) => p.id === 'capB')!;
  // reuses the existing `cell` kind (zero new ground CSS) with the CAP's status, not the island's.
  for (const c of children(capA)) {
    assert.equal(c.kind, 'cell');
    assert.equal(c.status, 'healthy');
  }
  for (const c of children(capB)) {
    assert.equal(c.kind, 'cell');
    assert.equal(c.status, 'unhealthy');
  }
  // the territory is `proposed`, so neither cap tint could be the island tint bleeding through.
});

// ---------- the land cell's SHAPE-FREE id (ADR-0367 prerequisite) ----------
//
// The accretion reveal used to be indexed by the cell's literal emitted `d` string, so the key WAS the
// geometry. ADR-0367 moves the land's geometry, and a byte key drops the reveal for every cell that
// moved — silently, since the lookup just misses. The scene therefore mints the identity, and both
// ground branches must do it: the plain relaxed-cell ground, and the parcels-present ground whose
// cells sit one level deeper inside per-capability `parcel` groups.

/** Every land-cell path under `n`, in the depth-first order the scene emits them. */
function landCells(n: SceneNode): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (m: SceneNode): void => {
    if (m.el === 'path' && (m.kind === 'cell' || m.kind === 'cell-wheat')) out.push(m);
    for (const c of children(m)) walk(c);
  };
  walk(n);
  return out;
}

test('every land cell carries a story-scoped shape-free id — on BOTH ground branches', () => {
  // (a) parcels-present: the cells are nested inside two `parcel` groups, and the ordinal runs
  //     across the whole island rather than restarting per parcel.
  const nested = landCells(mustByKind(parcelScene(parcelsAB(3, 3), CELLS_AB), 'ground-mesh'));
  assert.equal(nested.length, 8);
  assert.equal(nested[0]?.cellId, 'library/cell-000', 'the id names the story, then the ordinal');
  assert.deepEqual(
    nested.map((c) => c.cellId),
    nested.map((_c, i) => landCellId('library', i)),
  );

  // (b) the plain no-parcels ground stamps the same way, one level shallower — and every id in the
  //     whole scene is distinct, which is what lets `forestRegrowRenderLayer` flatten every in-flight
  //     island's reveals into ONE map without one island's nth cell shadowing another's.
  for (const input of [legacyInput(), mkInput()]) {
    const scene = buildScene(input);
    const grounds = allByKind(scene, 'ground');
    assert.ok(grounds.length > 0, 'the fixture must draw relaxed-substrate ground');
    for (const ground of grounds) {
      const cells = landCells(ground);
      assert.ok(cells.length > 0);
      assert.deepEqual(
        cells.map((c) => c.cellId),
        cells.map((_c, i) => landCellId(ground.id!, i)),
      );
    }
    const every = landCells(scene).map((c) => c.cellId);
    assert.equal(new Set(every).size, every.length, 'cell ids are unique across the whole scene');
  }
});

// test-removed: `flora density IS the test count — a higher-testCount parcel grows strictly more flora (same island, same theme)` was renamed to bind its declared contract; the unchanged predicate is covered by the title below.
// test-updated (refactor): `flora density IS the test count — a higher-testCount parcel grows strictly more flora (same island, same theme)` gained only its declared-contract title prefix; its assertions are unchanged.
test('rc-flora-density-is-test-count: flora density IS the test count — a higher-testCount parcel grows strictly more flora (same island, same theme)', () => {
  const scene = parcelScene(parcelsAB(1, 12), CELLS_AB); // both meadow
  const flora = allByKind(mustByKind(scene, 'flora-layer'), 'parcel-flora');
  const a = flora.filter((n) => n.id === 'capA').length;
  const b = flora.filter((n) => n.id === 'capB').length;
  assert.ok(a > 0, 'a 1-test parcel still shows a sprig');
  assert.ok(b > a, `the 12-test parcel grows strictly more marks than the 1-test one: ${a} < ${b}`);
});

test('rc-unreported-parcel-coverage-emits-no-flora: an omitted count keeps status ground while zero retains its baseline flora', () => {
  // This is deliberately a naturally typed client fixture, not a cast: callers may report a
  // capability before its coverage count is published.
  const unreported: SceneParcelInput = {
    capId: 'unreported-cap',
    status: 'building',
    theme: 'meadow',
    seed: SEED_A,
  };
  const reportedZero: SceneParcelInput = {
    capId: 'zero-cap',
    status: 'healthy',
    testCount: 0,
    theme: 'meadow',
    seed: SEED_B,
  };

  // Bun strips types, so exercise the package's real strict compiler as part of this regression.
  const compiler = spawnSync('pnpm', ['typecheck'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    encoding: 'utf8',
  });
  assert.equal(
    compiler.status,
    0,
    `the package compiler must accept an unreported parcel:\n${compiler.stdout}\n${compiler.stderr}`,
  );

  const scene = parcelScene([unreported, reportedZero], CELLS_AB);
  const ground = mustByKind(scene, 'ground-mesh');
  const unreportedGround = allByKind(ground, 'parcel').find((node) => node.id === unreported.capId);
  const zeroGround = allByKind(ground, 'parcel').find((node) => node.id === reportedZero.capId);
  assert.ok(unreportedGround, 'unreported coverage retains its capability parcel ground');
  assert.equal(unreportedGround.status, 'building', 'the retained ground wears the folded capability status');
  assert.ok(zeroGround, 'a numeric zero remains a reported parcel');
  assert.equal(zeroGround.status, 'healthy');

  const flora = allByKind(mustByKind(scene, 'flora-layer'), 'parcel-flora');
  assert.equal(flora.filter((node) => node.id === unreported.capId).length, 0, 'unreported coverage invents no flora');
  assert.equal(flora.filter((node) => node.id === reportedZero.capId).length, 2, 'reported zero retains the existing meadow two-tuft baseline');
});

test('rc-coverage-flora-carries-semantic-ground-anchor-and-scale: every coverage item carries its own transform pivot and tile-art scale without changing the drawable', () => {
  const scene = buildScene(
    mkInput({
      cameraElevationDeg: 90,
      relaxedCells: CELLS_AB,
      territories: [
        mkTerritory({
          anchorSpace: 'ground',
          status: 'proposed',
          parcels: [
            { capId: 'meadow-cap', status: 'healthy', testCount: 2, theme: 'meadow', seed: { x: 0, y: 0 } },
            { capId: 'woodland-cap', status: 'building', testCount: 5, theme: 'woodland', seed: { x: 50, y: 0 } },
            { capId: 'heath-cap', status: 'unhealthy', testCount: 9, theme: 'heath', seed: { x: 100, y: 0 } },
          ],
        }),
      ],
    }),
  );
  type CoverageFlora = SceneNode & { groundAnchor?: { x: number; y: number }; floraScale?: number };
  const flora = allByKind(mustByKind(scene, 'flora-layer'), 'parcel-flora') as CoverageFlora[];
  assert.ok(flora.length > 3, 'the varied coverage parcels generate multiple independently placed items');
  assert.deepEqual(new Set(flora.map((item) => item.id)), new Set(['meadow-cap', 'woodland-cap', 'heath-cap']));
  assert.deepEqual(new Set(flora.map((item) => item.theme)), new Set(['meadow', 'woodland', 'heath']));
  assert.deepEqual(new Set(flora.map((item) => item.status)), new Set(['healthy', 'building', 'unhealthy']));

  const transformsBeforeMetadata = flora.map((item) => ({
    id: item.id,
    theme: item.theme,
    status: item.status,
    transform: item.transform,
    children: children(item),
  }));
  for (const item of flora) {
    const match = /^translate\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\) scale\((-?\d+(?:\.\d+)?)\) translate\(-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?\)$/.exec(item.transform ?? '');
    assert.ok(match, `parcel flora keeps its canonical pivot-scale-pivot transform: ${item.transform}`);
    const [, x, y, scale] = match;
    assert.deepEqual(item.groundAnchor, { x: Number(x), y: Number(y) }, `${item.id} exposes its containing-scene-basis pivot; the downstream mapper composes ancestor translation once`);
    assert.equal(item.floraScale, Number(scale), `${item.id} exposes the tile-art scale`);
  }
  assert.deepEqual(
    flora.map((item) => ({
      id: item.id,
      theme: item.theme,
      status: item.status,
      transform: item.transform,
      children: children(item),
    })),
    transformsBeforeMetadata,
    'metadata adds no item, ordering, mark geometry, transform, identity, theme, or folded-status change',
  );
});

test('a parcels-present island RETIRES the conifer decor AND the one-plant-per-cap ring', () => {
  const scene = parcelScene(parcelsAB(3, 3), CELLS_AB); // territory ALSO carries decor + plants
  const layer = mustByKind(scene, 'flora-layer');
  assert.equal(firstByKind(layer, 'conifer'), null, 'no decorative conifers on a parcels island');
  assert.equal(firstByKind(layer, 'flora'), null, 'no one-plant-per-cap ring on a parcels island');
  // the central tree still stands and the parcel flora replaced them.
  assert.ok(firstByKind(layer, 'tree'));
  assert.ok(firstByKind(layer, 'parcel-flora'));
});

test('parcel flora carries theme + status + capId; the generic mark vocabulary is emitted', () => {
  const scene = parcelScene(parcelsAB(4, 4), CELLS_AB);
  const item = mustByKind(scene, 'parcel-flora');
  assert.equal(item.theme, 'meadow');
  assert.ok(item.status === 'healthy' || item.status === 'unhealthy');
  assert.ok(typeof item.id === 'string' && item.id.startsWith('cap'));
  const layer = mustByKind(scene, 'flora-layer');
  // meadow healthy → grass blades; meadow unhealthy → a dead stem: the generic kinds appear.
  assert.ok(allByKind(layer, 'parcel-blade').length > 0);
  assert.ok(allByKind(layer, 'parcel-stem').length > 0);
});

test('each theme routes through its own SurfaceFn — the theme tag rides every flora item', () => {
  for (const theme of ['meadow', 'woodland', 'heath'] as const) {
    const scene = parcelScene([{ capId: 'c', status: 'healthy', testCount: 6, theme, seed: SEED_A }], CELLS_AB);
    for (const item of allByKind(mustByKind(scene, 'flora-layer'), 'parcel-flora')) {
      assert.equal(item.theme, theme);
    }
    // woodland/heath healthy forms carry a shrub blob; meadow carries blades.
    const layer = mustByKind(scene, 'flora-layer');
    if (theme === 'meadow') assert.ok(allByKind(layer, 'parcel-blade').length > 0);
    else assert.ok(allByKind(layer, 'parcel-shrub').length > 0);
  }
});

test('buildScene stays deterministic with parcels present (same input → byte-identical)', () => {
  assert.deepEqual(parcelScene(parcelsAB(2, 9, 'woodland'), CELLS_AB), parcelScene(parcelsAB(2, 9, 'woodland'), CELLS_AB));
});

test('§ back-compat: parcels absent OR no substrate cells → today\'s conifer + plant render (no parcel kinds)', () => {
  // parcels set but the island is hex-ground (no relaxedCells) → the feature no-ops, conifers stay.
  const hex = buildScene(
    mkInput({
      relaxedCells: null,
      territories: [mkTerritory({ id: 'library', parcels: parcelsAB(5, 5) })],
    }),
  );
  const layer = mustByKind(hex, 'flora-layer');
  assert.equal(firstByKind(layer, 'parcel-flora'), null, 'no parcels without the relaxed mesh');
  assert.ok(firstByKind(layer, 'conifer'), 'conifers survive when parcels cannot render');
});

// ---------- the UAT markers (forest-parcels inc 2; tall flowers, grounded-art inc 7) ----------
//
// Stage-1 GEOMETRY only: the scattered-marker STRUCTURE — wrapper kinds, counts, id carriage,
// deterministic id-seeded placement with keep-outs. The marker BODY is the `tallFlowerMarks` painter:
// its exact marks are deliberately NOT pinned here, so the designer's art can change the body without
// touching these tests. The LOOK is operator-attested later (ADR-0070). Placement is a SCATTER around
// the island (owner call 2026-07-18 — no path, no visible bed); each flower is its own y-sorted drawable.

type UatCriteria = NonNullable<SceneTerritoryInput['uatCriteria']>;

/** An owner-0 grid of square substrate cells covering [xMin,xMax)×[yMin,yMax) — a stand-in for
 *  the island's relaxed land mesh (the marker scatter's keep-in). */
function isleCells(box: { xMin: number; xMax: number; yMin: number; yMax: number }): RelaxedCell[] {
  const cells: RelaxedCell[] = [];
  for (let x = box.xMin; x < box.xMax; x += 20) {
    for (let y = box.yMin; y < box.yMax; y += 20) {
      cells.push({
        owner: 0,
        poly: [
          { x, y },
          { x: x + 20, y },
          { x: x + 20, y: y + 20 },
          { x, y: y + 20 },
        ],
        variant: 0,
        wheat: false,
      });
    }
  }
  return cells;
}

/** The default marker-test land: a full grid over the island disc (centroid 100,200 / radius 60). */
const FULL_LAND = isleCells({ xMin: 40, xMax: 160, yMin: 140, yMax: 260 });

/** Test-local ray-cast (mirrors the scene core's keep-in predicate). */
function inPoly(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** A one-island scene whose territory carries `uatCriteria` + the human-witness signpost. Land
 *  cells default to the full-disc grid; pass `cells: null` for the no-mesh (classic ground) path. */
function markerScene(
  uatCriteria: UatCriteria,
  over: Partial<SceneTerritoryInput> = {},
  cells: RelaxedCell[] | null = FULL_LAND,
): SceneG {
  return buildScene(
    mkInput({
      territories: [mkTerritory({ signpost: { outcome: null }, uatCriteria, ...over })],
      relaxedCells: cells,
    }),
  );
}

/** The tall flower's wrapper: translate + the 0.6 drawing scale re-based onto the derived tile (ADR-0528). */
const MARKER_SCALE_TEXT = (0.6 * TILE_SCALE).toFixed(1);
const MARKER_TRANSFORM = new RegExp(`^translate\\((-?[\\d.]+) (-?[\\d.]+)\\) scale\\(${MARKER_SCALE_TEXT.replace('.', '\\.')}\\)$`);
/** The small (unified vocabulary) flower's wrapper: the 1.0 drawing scale re-based onto the tile. */
const SMALL_MARKER_SCALE_TEXT = (1.0 * TILE_SCALE).toFixed(1);
const SMALL_MARKER_TRANSFORM = new RegExp(`^translate\\((-?[\\d.]+) (-?[\\d.]+)\\) scale\\(${SMALL_MARKER_SCALE_TEXT.replace('.', '\\.')}\\)$`);

/** The flower wrapper's base point (the translate part of `translate(x y) scale(s)`). */
function markerSpot(m: SceneG) {
  const [, x, y] = MARKER_TRANSFORM.exec(m.transform ?? '') ?? [];
  return { x: Number(x), y: Number(y) };
}

const THREE_CRITERIA: UatCriteria = [
  { id: 'crit-a', state: 'proven' },
  { id: 'crit-b', state: 'pending' },
  { id: 'crit-c', state: 'failing' },
];

const FLOWER_KINDS = ['tall-flower-proven', 'tall-flower-pending', 'tall-flower-failing'] as const;

/** Every tall-flower wrapper in the scene, in document order. */
function flowersOf(scene: SceneG): SceneG[] {
  const out: SceneG[] = [];
  const walk = (n: SceneNode): void => {
    if (n.el === 'g') {
      if (n.kind && (FLOWER_KINDS as readonly string[]).includes(n.kind)) out.push(n);
      for (const c of n.children) walk(c);
    }
  };
  walk(scene);
  return out;
}

test('a uatCriteria-present island scatters one flower marker per criterion, state on the wrapper kind', () => {
  const scene = markerScene(THREE_CRITERIA);
  const flowers = flowersOf(scene);
  assert.equal(flowers.length, THREE_CRITERIA.length);
  assert.deepEqual(new Set(flowers.map((m) => m.kind)), new Set(FLOWER_KINDS));
  assert.deepEqual(new Set(flowers.map((m) => m.id)), new Set(['crit-a', 'crit-b', 'crit-c']));
  for (const m of flowers) {
    assert.ok(m.children.length > 0, 'a marker wrapper carries body marks');
    // translate + the 0.6 wrapper scale (the scatter footprint the placement keep-outs were tuned for).
    assert.match(m.transform ?? '', MARKER_TRANSFORM);
  }
});

test('the flowers respect the keep-outs, and the human-witness signpost seal is RETAINED', () => {
  const scene = markerScene(THREE_CRITERIA, { signpost: { outcome: 'pass' } });
  // the signpost is retained — the markers never replace it.
  assert.ok(firstByKind(scene, 'sign-pass'), 'the signpost seal survives the markers');
  const spots = flowersOf(scene).map(markerSpot);
  assert.ok(spots.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y)));
  // distinct spots, all inside the island's reach, none in the tree well (mkTerritory geometry).
  //
  // BOTH REACHES ARE GROUND DISTANCES (ADR-0367 D1). The scatter's radius band and its tree well are
  // ground quantities, so they are read back on the ground: a flower planted 36 ground units due south
  // of the trunk stands only 36·sin20° ≈ 12 SCREEN pixels below it, and an isotropic screen `hypot`
  // here would call that a violation of a keep-out the placement honoured exactly. `scatter-camera.test.ts`
  // fences the invariant these two bounds are the local case of.
  assert.equal(new Set(spots.map((s) => `${s.x},${s.y}`)).size, spots.length, 'flowers stand apart');
  for (const s of spots) {
    const t = mkTerritory({});
    const onGround = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
      const d = unprojectGround({ x: a.x - b.x, y: a.y - b.y });
      return Math.hypot(d.x, d.y);
    };
    assert.ok(onGround(s, t.centroid) <= t.groundRadius * 0.85 + 1, 'inside the island');
    assert.ok(onGround(s, t.treeSpot) > tileUnits(30), 'clear of the tree well');
  }
});

test('the marker scatter is deterministic (same input → byte-identical) and id-seeded (different story → different spots)', () => {
  assert.deepEqual(markerScene(THREE_CRITERIA), markerScene(THREE_CRITERIA));
  const spotsOf = (id: string): string[] =>
    flowersOf(markerScene(THREE_CRITERIA, { id })).map((m) => m.transform ?? '');
  assert.notDeepEqual(spotsOf('alpha'), spotsOf('beta'));
});

test('many criteria still place: every flower gets its own spot (rejection sampling never drops one)', () => {
  const many: UatCriteria = Array.from({ length: 8 }, (_, i) => ({
    id: `crit-${i}`,
    state: (['proven', 'pending', 'failing'] as const)[i % 3]!,
  }));
  const flowers = flowersOf(markerScene(many));
  assert.equal(flowers.length, 8);
  assert.equal(new Set(flowers.map((m) => m.transform)).size, 8, 'no two flowers stack on one spot');
});

test('the scatter keeps IN the island: on a concave land mass every flower stands on a substrate cell', () => {
  // land = only the WEST half of the island disc — a concave hex-cluster stand-in. The old
  // radius-only scatter drifted markers into the water here (owner feedback 2026-07-18).
  const westLand = isleCells({ xMin: 40, xMax: 100, yMin: 140, yMax: 260 });
  const spots = flowersOf(markerScene(THREE_CRITERIA, {}, westLand)).map(markerSpot);
  assert.equal(spots.length, THREE_CRITERIA.length, 'every criterion still renders');
  for (const s of spots) {
    assert.ok(
      westLand.some((c) => inPoly(s.x, s.y, c.poly)),
      `flower at ${s.x},${s.y} stands on land`,
    );
  }
});

test('no substrate cells (classic ground) still renders every flower — the radius-clamped fallback', () => {
  const flowers = flowersOf(markerScene(THREE_CRITERIA, {}, null));
  assert.equal(flowers.length, THREE_CRITERIA.length);
  for (const m of flowers) assert.match(m.transform ?? '', MARKER_TRANSFORM);
});

test('§ back-compat ABSENCE LOCK: uatCriteria absent OR empty → NO marker kinds; absent and [] byte-identical', () => {
  // absent (mkTerritory carries no uatCriteria) → no flowers anywhere. The committed golden
  // fixture test above ("parcels-ABSENT scene matches …") is the byte-for-byte pre-change lock —
  // it must stay green untouched; this adds the absent ≡ [] equivalence, the inc-1 pattern.
  const absent = buildScene(mkInput());
  for (const k of FLOWER_KINDS) {
    assert.equal(firstByKind(absent, k), null, `no ${k} on a uatCriteria-absent island`);
  }
  const empty = buildScene(mkInput({ territories: [mkTerritory({ uatCriteria: [] })] }));
  assert.deepEqual(empty, buildScene(mkInput({ territories: [mkTerritory()] })));
});

// ---------- the unified vegetation vocabulary (grounded-art, ADR-0226) ----------
//
// PRESENT ⇒ every NON-garden island reads ONE language, studio-side: grass = a capability's tests (the
// decorative wildflower / anemone / heather-bell accents retired), the UAT criteria as SMALL flowers
// folded into the grass (form-reads-verdict), and the human-witness signpost retired. ABSENT ⇒
// byte-for-byte (the committed golden fixture above is the byte lock; every existing test stays green).
// These cover decisions 2–5; the tree-spread (decision 1) is the separate UNIT 2.

const VEG: SceneVegetationInput = {};

/** A one-island scene with `vegetation` set (the flag ON), else the same shape as `markerScene`. */
function vegScene(over: Partial<SceneTerritoryInput> = {}, cells: RelaxedCell[] | null = FULL_LAND): SceneG {
  return buildScene(
    mkInput({
      territories: [mkTerritory({ signpost: { outcome: 'pass' }, uatCriteria: THREE_CRITERIA, ...over })],
      relaxedCells: cells,
      vegetation: VEG,
    }),
  );
}

/** The shadow ellipse rx a `tallFlowerMarks` body emits — 2.3 SMALL (the flag) vs 5.2 tall (default). */
function markerShadowRxs(scene: SceneG): number[] {
  return flowersOf(scene).map((flower) => {
    const sh = mustByKind(flower, 'shadow');
    assert.ok(sh.el === 'ellipse');
    return sh.rx;
  });
}

test('ADR-0226 §5: the vegetation vocabulary RETIRES the human-witness signpost (no sign-* kinds)', () => {
  // a human-witness story carries a signpost; flag OFF it renders, flag ON it is gone.
  assert.ok(firstByKind(markerScene(THREE_CRITERIA, { signpost: { outcome: 'pass' } }), 'sign-pass'), 'signpost renders with the flag off');
  const on = vegScene();
  for (const k of ['sign-blank', 'sign-pass', 'sign-fail', 'sign-post', 'sign-head'] as const) {
    assert.equal(firstByKind(on, k), null, `${k} retired under the vocabulary`);
  }
});

test('ADR-0226 §4: the UAT flowers render SMALL under the flag (still 1:1, state on the wrapper kind)', () => {
  const on = vegScene();
  const flowers = flowersOf(on);
  assert.equal(flowers.length, THREE_CRITERIA.length, 'still one flower per criterion (1:1)');
  assert.deepEqual(new Set(flowers.map((m) => m.kind)), new Set(FLOWER_KINDS), 'form still reads the verdict');
  // the small body: every flower's shadow is the 2.3 SMALL footprint, not the 5.2 tall one.
  assert.ok(markerShadowRxs(on).every((rx) => rx === 2.3), 'flowers are the small footprint');
  assert.ok(markerShadowRxs(markerScene(THREE_CRITERIA)).every((rx) => rx === 5.2), 'flag-off keeps the tall footprint');
  // the vocabulary scatter wears the larger 1.0 wrapper (ADR-0226 promotion — the owner found 0.6 too
  // small); the flag-OFF tall path keeps the historical 0.6.
  for (const m of flowers) assert.match(m.transform ?? '', SMALL_MARKER_TRANSFORM);
  for (const m of flowersOf(markerScene(THREE_CRITERIA))) assert.match(m.transform ?? '', MARKER_TRANSFORM);
});

test('ADR-0226 §4: the honesty wall holds under the flag — only a proven flower blooms; a bud never does', () => {
  const on = vegScene({ uatCriteria: [{ id: 'x', state: 'pending' }] });
  const bud = flowersOf(on)[0]!;
  assert.equal(bud.kind, 'tall-flower-pending');
  assert.ok(firstByKind(bud, 'tall-flower-bud'), 'awaiting UAT is a closed bud');
  assert.equal(firstByKind(bud, 'tall-flower-petal'), null, 'a bud has no open petals (ADR-0045)');
  assert.equal(firstByKind(bud, 'tall-flower-glow'), null, 'a bud never glows');
});

test('ADR-0226 §2: the vocabulary retires the decorative bloom in every biome; the grass bulk stays', () => {
  for (const theme of ['meadow', 'woodland', 'heath'] as const) {
    // a HEALTHY parcel's ONLY `parcel-flower` source is its decorative bloom (wildflower / anemone /
    // heather-bell); grass (blades) + UAT markers (tall-flower-*) are distinct kinds, so parcel-flower ⇒ bloom.
    const parcels: Parcels = [{ capId: 'cap', status: 'healthy', testCount: 10, theme, seed: SEED_A }];
    const mk = (veg: boolean): SceneG => {
      // Flag off ⇒ `vegetation` stays ABSENT, which is what selects the pre-ADR-0226 render.
      const over: Partial<SceneInput> = {
        relaxedCells: CELLS_AB,
        territories: [mkTerritory({ status: 'proposed', parcels, uatCriteria: [] })],
      };
      if (veg) over.vegetation = VEG;
      return buildScene(mkInput(over));
    };
    const off = mustByKind(mk(false), 'flora-layer');
    const on = mustByKind(mk(true), 'flora-layer');
    assert.ok(allByKind(off, 'parcel-flower').length > 0, `${theme}: the decorative bloom appears with the flag off`);
    assert.equal(allByKind(on, 'parcel-flower').length, 0, `${theme}: no decorative bloom under the vocabulary`);
    // the density bulk stays — the biome still reads as grass/vegetation.
    assert.ok(allByKind(on, 'parcel-blade').length > 0, `${theme}: the grass/fern bulk remains`);
  }
});

test('ADR-0226 absence lock: vegetation present is deterministic, and present ≠ absent', () => {
  const withVeg = (): SceneG => vegScene();
  const without = markerScene(THREE_CRITERIA, { signpost: { outcome: 'pass' } });
  assert.deepEqual(withVeg(), withVeg(), 'same input (veg on) → byte-identical');
  assert.notDeepEqual(withVeg(), without, 'the flag changes the render');
});

// ---------- the cosy-island GARDEN (grounded-art inc 11, ADR-0221) ----------
//
// PRESENT ⇒ the named island composes as the concept garden: the four heroes placed through the re-lit
// ADR-0218 baked-art seam, decorative flora suppressed, the autumn-tree hero standing as the central
// tree. ABSENT ⇒ every island byte-for-byte (the committed golden fixture above is the byte lock).

/** A minimal baked hero (one polygon) at a given baked height — enough to assert defs/placement/scale. */
const gHero = (height: number): SceneGardenHero => ({
  nodes: [{ el: 'polygon', points: '0,0 5,0 0,-5', fill: '#cba', stroke: '#210', strokeWidth: 0.3 }],
  width: 10,
  height,
});
/** A garden naming `islandId`, carrying all four heroes at their real baked heights. */
const mkGarden = (islandId: string): SceneGardenInput => ({
  islandId,
  heroes: {
    cottage: gHero(21.8),
    gazebo: gHero(15.4),
    'autumn-tree': gHero(20.6),
    'stepping-stone': gHero(6.3),
  },
});
/** Every descendant (incl. self) whose `el` matches. */
const allByEl = (n: SceneNode, el: string): SceneNode[] => {
  const out: SceneNode[] = [];
  const walk = (m: SceneNode): void => {
    if (m.el === el) out.push(m);
    for (const c of children(m)) walk(c);
  };
  walk(n);
  return out;
};
/** The territory group with the given id. */
const territoryById = (scene: SceneNode, id: string): SceneNode => {
  const hit = allByKind(scene, 'territory').find((t) => t.id === id);
  assert.ok(hit, `expected a territory "${id}"`);
  return hit;
};
/** A two-island scene: `library` composes as a garden, `cli` is a normal island. */
const mkGardenTerritories = (over: Partial<SceneTerritoryInput> = {}): SceneTerritoryInput[] => [
  mkTerritory({ id: 'library', ...over }),
  mkTerritory({ id: 'cli', caps: 2, centroid: { x: 300, y: 60 }, treeSpot: { x: 300, y: 50 }, plants: [], decor: [] }),
];

test('garden ABSENT → no baked-defs / baked-art anywhere (the absence lock; golden guards the bytes)', () => {
  const scene = buildScene(mkInput());
  assert.equal(firstByKind(scene, 'baked-defs'), null);
  assert.equal(firstByKind(scene, 'baked-art'), null);
});

test('garden PRESENT → one baked-defs layer, a def per USED hero + the stepping-stone path', () => {
  const scene = buildScene(mkInput({ garden: mkGarden('library') }));
  const defs = allByEl(mustByKind(scene, 'baked-defs'), 'baked-def');
  assert.equal(defs.length, 4, 'four defs — the three garden heroes + the stepping-stone path (unit 2, define-once)');
  const ids = defs.map((d) => (d as { defId: string }).defId).sort();
  assert.deepEqual(ids, [
    'garden-hero-autumn-tree',
    'garden-hero-cottage',
    'garden-hero-gazebo',
    'garden-hero-stepping-stone',
  ]);
});

test('garden PRESENT → three hero placements + a stepping-stone path, all on the NAMED island', () => {
  const scene = buildScene(mkInput({ garden: mkGarden('library') }));
  const uses = allByKind(scene, 'baked-art');
  const heroRefs = uses
    .map((u) => (u as { defId: string }).defId)
    .filter((d) => d !== 'garden-hero-stepping-stone')
    .sort();
  assert.deepEqual(heroRefs, ['garden-hero-autumn-tree', 'garden-hero-cottage', 'garden-hero-gazebo']);
  const stones = uses.filter((u) => (u as { defId: string }).defId === 'garden-hero-stepping-stone');
  assert.ok(stones.length >= 1, 'the stone path lays at least one stepping-stone (define-once, many uses)');
  // everything (heroes + stones) is on the NAMED island; the normal island is untouched.
  assert.equal(allByKind(territoryById(scene, 'library'), 'baked-art').length, uses.length);
  assert.equal(allByKind(territoryById(scene, 'cli'), 'baked-art').length, 0, 'the normal island is untouched');
});

test('garden PRESENT → the autumn-tree hero REPLACES the procedural tree on the garden island only', () => {
  const scene = buildScene(mkInput({ garden: mkGarden('library') }));
  const gardenIsle = territoryById(scene, 'library');
  assert.equal(firstByKind(gardenIsle, 'tree'), null, 'no procedural tree on the garden island');
  const treeUse = allByKind(gardenIsle, 'baked-art').find(
    (u) => (u as { defId: string }).defId === 'garden-hero-autumn-tree',
  );
  assert.ok(treeUse, 'the autumn-tree hero stands as the central tree');
  assert.ok(firstByKind(territoryById(scene, 'cli'), 'tree'), 'the normal island keeps its procedural tree');
});

test('garden PRESENT → procedural flora + tree suppressed; the UAT criteria render as the unified small-flower scatter', () => {
  const scene = buildScene(
    mkInput({
      territories: mkGardenTerritories({
        uatCriteria: [
          { id: 'c1', state: 'proven' },
          { id: 'c2', state: 'pending' },
          { id: 'c3', state: 'failing' },
        ],
      }),
      garden: mkGarden('library'),
    }),
  );
  const gardenIsle = territoryById(scene, 'library');
  // the decorative conifers / capability-plant flora and the PROCEDURAL central tree are replaced by heroes.
  for (const k of ['conifer', 'flora', 'tree']) {
    assert.equal(firstByKind(gardenIsle, k), null, `no ${k} on the garden island`);
  }
  // ADR-0226 promotion (owner look verdict 2026-07-22): the garden node shows the SAME unified UAT scatter
  // every island speaks — one small flower per criterion, each keeping its id + state — not the old,
  // easy-to-miss massed bud-bed.
  const flowers = [
    ...allByKind(gardenIsle, 'tall-flower-proven'),
    ...allByKind(gardenIsle, 'tall-flower-pending'),
    ...allByKind(gardenIsle, 'tall-flower-failing'),
  ];
  assert.equal(flowers.length, 3, 'one flower per criterion (verdict retained, not suppressed)');
  assert.deepEqual(flowers.map((fl) => fl.id).sort(), ['c1', 'c2', 'c3'], 'each flower keeps its criterion id');
  // and they wear the SMALL vocabulary body + wrapper (scale 1.0), not the tall bed daisy.
  assert.ok(
    flowers.every((fl) => SMALL_MARKER_TRANSFORM.test((fl as SceneG).transform ?? '')),
    'garden UAT flowers use the unified small-flower wrapper',
  );
});

test('garden PRESENT → the human-witness signpost is RETIRED on the garden island (ADR-0226 decision 5)', () => {
  const scene = buildScene(
    mkInput({
      territories: mkGardenTerritories({ signpost: { outcome: 'pass' } }),
      garden: mkGarden('library'),
    }),
  );
  const gardenIsle = territoryById(scene, 'library');
  for (const k of ['sign-blank', 'sign-pass', 'sign-fail', 'sign-post', 'sign-head']) {
    assert.equal(firstByKind(gardenIsle, k), null, `${k} retired on the garden island (the unified vocabulary)`);
  }
});

test('garden is deterministic — same input → byte-identical scene', () => {
  assert.deepEqual(
    buildScene(mkInput({ garden: mkGarden('library') })),
    buildScene(mkInput({ garden: mkGarden('library') })),
  );
});

test('garden def carries the hero nodes VERBATIM (BakedPaintNode shape-parity with kit.json heroes)', () => {
  const gdn = mkGarden('library');
  const scene = buildScene(mkInput({ garden: gdn }));
  const def = allByEl(mustByKind(scene, 'baked-defs'), 'baked-def')[0] as { nodes: unknown[] };
  assert.deepEqual(def.nodes, gdn.heroes['autumn-tree'].nodes, 'the def references the folded nodes unchanged');
});

test('garden stone path — deterministic stepping-stones that dock at the downward-shore landfall (unit 2)', () => {
  // The primary front-door WALK runs landfall → cottage (grounded-art inc 12). Assert it lays stones, is
  // deterministic (seeded — no Math.random), and reaches DOWN toward the bottom-shore landfall (a stone
  // sits below the tree spot), so it reads continuous with the island's inter-island trail.
  const yOf = (n: SceneNode): number => Number(/translate\((?:-?[\d.]+) (-?[\d.]+)\)/.exec(n.transform ?? '')?.[1] ?? '0');
  const scene = buildScene(mkInput({ territories: mkGardenTerritories(), garden: mkGarden('library') }));
  const again = buildScene(mkInput({ territories: mkGardenTerritories(), garden: mkGarden('library') }));
  assert.deepEqual(scene, again, 'the stone path is deterministic');
  const isle = territoryById(scene, 'library');
  const stones = allByKind(isle, 'baked-art').filter((u) => (u as { defId: string }).defId === 'garden-hero-stepping-stone');
  assert.ok(stones.length >= 2, 'the path lays several stepping-stones');
  const tree = mkTerritory({ id: 'library' }).treeSpot.y;
  assert.ok(stones.some((s) => yOf(s) > tree), 'a stone sits below the tree — the path docks toward the bottom-shore landfall');
});

test('garden stone-path spacing tracks the GROUND radius, not the SCREEN one (scene-territory-radius-states-its-space)', () => {
  // `scene-territory-radius-states-its-space`: the seam used to carry ONE `radius` field for both
  // spaces — scene.ts read it as ground, TreeView.tsx fed the territory's SCREEN-projected magnitude.
  // Reproduce the mismatch directly: a territory whose GROUND radius (400) is far bigger than its
  // SCREEN radius (100), which is exactly the shape a real, non-disc story island comes out to (a
  // territory's screen radius mixes an un-foreshortened q-extent with a foreshortened r-extent, so it
  // strictly underestimates the true ground radius — measured ~0.65-0.89x for ordinary shapes,
  // approaching sin 20 deg =~ 0.342x in the pure north-south limit).
  const groundR = 400;
  const screenR = 100;
  const territories = mkGardenTerritories({ groundRadius: groundR, screenRadius: screenR });
  const t = territories[0]!;
  const garden = mkGarden('library');
  const scene = buildScene(mkInput({ territories, relaxedCells: null, garden }));
  const isle = territoryById(scene, 'library');
  const xy = (n: SceneNode) => {
    const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(n.transform ?? '');
    return { x: Number(m?.[1] ?? '0'), y: Number(m?.[2] ?? '0') };
  };
  const walkStones = allByKind(isle, 'baked-art').filter(
    (u) => (u as { defId: string }).defId === 'garden-hero-stepping-stone' && (u.id ?? '').startsWith('garden-walk-'),
  );
  assert.ok(walkStones.length >= 3, 'the walk lays several stones to measure spacing from');
  // Ground-plane positions (the screen transform is `projectGround` of the laid-out point) — the
  // nearest-neighbour ground distance per stone is a paint-order-independent stand-in for "stone-
  // centre spacing" (the stones lie close to one line, so nearest-neighbour IS along-path spacing).
  const groundPts = walkStones.map(xy).map((p) => unprojectGround(p));
  const nn = groundPts.map((p, i) =>
    Math.min(...groundPts.filter((_, j) => j !== i).map((q) => Math.hypot(p.x - q.x, p.y - q.y))),
  );
  const medianSpacing = [...nn].sort((a, b) => a - b)[Math.floor(nn.length / 2)]!;
  // buildStonePath's own formula (spacingMul 0.72 for the primary walk): `max(stoneW·1.05,
  // radius·0.06) · spacingMul`. `stoneW` reproduced via the exported `fittedHeroScale` — chosen so
  // `stoneW·1.05` (≈11.5, driven by `crownRadius`/caps, independent of either radius field) sits
  // BELOW the ground floor (`groundR·0.06` = 24) and ABOVE the screen floor (`screenR·0.06` = 6): the
  // two candidate readings of the old single field give measurably different, non-overlapping
  // predictions, so this is a genuine discriminating measurement, not a coincidence of scale.
  const stone = garden.heroes['stepping-stone'];
  const s = fittedHeroScale('stepping-stone', stone, t);
  const stoneW = s * stone.width;
  const groundFloor = Math.max(stoneW * 1.05, groundR * 0.06) * 0.72;
  const screenFloor = Math.max(stoneW * 1.05, screenR * 0.06) * 0.72;
  assert.ok(screenFloor < groundFloor * 0.7, 'fixture sanity: the ground/screen floors must clearly diverge');
  assert.ok(
    Math.abs(medianSpacing - groundFloor) < groundFloor * 0.4,
    `median stone spacing ${medianSpacing.toFixed(1)} should track the GROUND floor ${groundFloor.toFixed(1)}, not the screen one ${screenFloor.toFixed(1)}`,
  );
});

test('garden footpath — no stepping-stone is buried behind the tree crown (grounded-art inc 12 footpath fix)', () => {
  // The refined footpath must not bury a stone under the canopy: a stone NORTH of the tree base and within
  // the fitted crown would be painted over by the tree (the owner's occlusion complaint). Land-free so the
  // heroes settle across a roomy island and the path is laid through a representative layout.
  const xy = (n: SceneNode) => {
    const m = /translate\((-?[\d.]+) (-?[\d.]+)\)/.exec(n.transform ?? '');
    return { x: Number(m?.[1] ?? '0'), y: Number(m?.[2] ?? '0') };
  };
  const territories = [
    mkTerritory({ id: 'library', groundRadius: 120, screenRadius: 120, caps: 9 }),
    mkTerritory({ id: 'cli', caps: 2, centroid: { x: 600, y: 60 }, treeSpot: { x: 600, y: 50 } }),
  ];
  const gdn = mkGarden('library');
  const scene = buildScene(mkInput({ territories, relaxedCells: null, garden: gdn }));
  const isle = territoryById(scene, 'library');
  const t = territories[0]!;
  const treeHalfW = (fittedHeroScale('autumn-tree', gdn.heroes['autumn-tree'], t) * gdn.heroes['autumn-tree'].width) / 2;
  const stones = allByKind(isle, 'baked-art').filter((u) => (u as { defId: string }).defId === 'garden-hero-stepping-stone');
  assert.ok(stones.length >= 3, 'the refined path still lays stones');
  for (const s of stones) {
    const p = xy(s);
    const northUnderCrown = p.y < t.treeSpot.y && Math.hypot(p.x - t.treeSpot.x, p.y - t.treeSpot.y) < treeHalfW;
    assert.ok(!northUnderCrown, `a stepping-stone at (${p.x}, ${p.y}) is buried behind the tree crown (r=${treeHalfW})`);
  }
});

test('garden heroes are FITTED to the island — a small island shrinks them within its shore, a large one does not (unit 2)', () => {
  // The owner's "buildings dont fully land within the island" fix: `crownRadius` saturates, so on a
  // small island the crown-scaled footprint overflows. Every test hero is gHero(width 10), so a
  // `baked-use`'s base HALF-WIDTH is scale·10/2. On a SMALL island the fit cap holds each footprint
  // inside the island; on a LARGE island the cap is slack and the SAME hero grows (concept proportions).
  const scaleOf = (n: SceneNode): number => Number(/scale\(([\d.]+)\)/.exec(n.transform ?? '')?.[1] ?? '0');
  const HERO_W = 10;
  const heroesOf = (radius: number): SceneNode[] => {
    const scene = buildScene(
      mkInput({
        territories: [
          mkTerritory({ id: 'library', groundRadius: radius, screenRadius: radius, caps: 9 }),
          mkTerritory({ id: 'cli', caps: 2, centroid: { x: 800, y: 60 }, treeSpot: { x: 800, y: 50 } }),
        ],
        garden: mkGarden('library'),
      }),
    );
    return allByKind(territoryById(scene, 'library'), 'baked-art').filter(
      (u) => (u as { defId: string }).defId !== 'garden-hero-stepping-stone',
    );
  };
  // "small" is small relative to the crown-scaled hero, which draws at the tile's scale since
  // ADR-0528 — so the fixture's radius re-bases with it (20 on the radius-27 tile).
  const SMALL_R = tileUnits(20);
  const small = heroesOf(SMALL_R);
  assert.equal(small.length, 3);
  for (const u of small) {
    const halfW = (scaleOf(u) * HERO_W) / 2;
    assert.ok(halfW <= 0.5 * SMALL_R, `${(u as { defId: string }).defId} half-width ${halfW} overflows the small island`);
  }
  // the SAME heroes on a much larger island are bigger — the fit is island-relative, not fixed.
  const large = heroesOf(400);
  const smallById = new Map(small.map((u) => [(u as { defId: string }).defId, scaleOf(u)]));
  for (const u of large) {
    const id = (u as { defId: string }).defId;
    assert.ok(scaleOf(u) > smallById.get(id)!, `${id} did not grow on the larger island — the fit isn't island-relative`);
  }
});

// ---------- the free-hero tree keep-out (grounded-art inc 12 — the small-island collision fix) ----------

test('treeKeepOut clears the fitted tree canopy plus a lawn gap, scaling with the fitted footprint', () => {
  // The canopy keep-out is the tree's fitted footprint half-width + a 15% lawn gap — radius-independent, so
  // it scales with how big the tree is FITTED on this island (a small island fits a proportionally big tree).
  assert.equal(treeKeepOut(40), 46, 'canopy keep-out is the fitted half-width + a 15% lawn gap (40·1.15)');
  assert.equal(treeKeepOut(20), 23, 'a smaller fitted tree needs a proportionally smaller keep-out');
  // Invariant: always OUTSIDE the fitted canopy (a hero honouring it never sits inside the tree footprint).
  for (const hw of [10, 28.95, 41.36, 45]) {
    assert.ok(treeKeepOut(hw) > hw, `keep-out ${treeKeepOut(hw)} sits inside the fitted canopy ${hw}`);
  }
});

test('placeGardenHeroes fallback honours the tree keep-out — a building never snaps onto the trunk (grounded-art inc 12)', () => {
  // The bug the owner saw on a small island: the exhausted-draws fallback (when no sampled point fits the
  // shore) snapped a hero to a land-cell centroid WITHOUT the tree keep-out, landing the gazebo on the
  // trunk. This fixture forces that fallback and asserts the fix routes the hero to a tree-clearing cell.
  const t = mkTerritory({ id: 'library', groundRadius: 60, screenRadius: 60, caps: 9 }); // centroid (100,200), treeSpot (100,190)
  const TREE_HALF_W = 40; // the fitted autumn-tree footprint half-width → canopy keep-out 40·1.15 = 46
  const keepOut = treeKeepOut(TREE_HALF_W);
  // Two land cells force the fallback: a BIG cell hugging the TRUNK (its centroid is the treeSpot and a
  // hero footprint fits on it — the old code's trap) and a SMALL cell clear of the tree (the escape the
  // fixed fallback must reach). No sampled point clears the tree AND fits, so the sampler exhausts.
  const trunkCell: RelaxedCell = {
    owner: 0, variant: 1, wheat: false,
    poly: [{ x: 78, y: 180 }, { x: 122, y: 180 }, { x: 122, y: 200 }, { x: 78, y: 200 }], // centroid (100,190) = treeSpot
  };
  const escapeCell: RelaxedCell = {
    owner: 0, variant: 1, wheat: false,
    poly: [{ x: 98, y: 248 }, { x: 102, y: 248 }, { x: 100, y: 254 }], // centroid (100,250), 60 from the trunk
  };
  const ids: GardenHeroId[] = ['gazebo'];
  const halfW = new Map<GardenHeroId, number>([['gazebo', 18]]);
  const spots = placeGardenHeroes(t, ids, halfW, [trunkCell, escapeCell], TREE_HALF_W);
  const gazebo = spots.get('gazebo')!;
  const dist = Math.hypot(gazebo.x - t.treeSpot.x, gazebo.y - t.treeSpot.y);
  // RED before the fix: the fallback took the trunk cell (dist 0). GREEN after: it clears the fitted tree.
  assert.ok(dist >= TREE_HALF_W, `the gazebo (dist ${dist}) sits inside the fitted tree footprint ${TREE_HALF_W} — it merged into the trunk`);
  assert.ok(dist > keepOut, `the gazebo (dist ${dist}) is inside the tree keep-out ${keepOut}`);
});

test('placeGardenHeroes keeps every settled hero outside the fitted tree footprint (land-free sampler path)', () => {
  // With no land constraint the rejection sampler settles freely; every hero it places must still clear the
  // tree keep-out (the invariant the fallback test guards on the exhausted path). A roomy island so the
  // sampler can settle deterministically.
  const t = mkTerritory({ id: 'library', groundRadius: 140, screenRadius: 140, caps: 9 });
  const TREE_HALF_W = 45;
  const canopyKeepOut = treeKeepOut(TREE_HALF_W);
  const ids: GardenHeroId[] = ['cottage', 'gazebo'];
  const halfW = new Map<GardenHeroId, number>([['cottage', 22], ['gazebo', 18]]);
  const spots = placeGardenHeroes(t, ids, halfW, null, TREE_HALF_W);
  for (const [id, p] of spots) {
    const dist = Math.hypot(p.x - t.treeSpot.x, p.y - t.treeSpot.y);
    // every settled hero clears the canopy (and, being sampler-placed, also the radius·0.5 spread).
    assert.ok(dist > canopyKeepOut, `${id} (dist ${dist}) sits inside the tree canopy keep-out ${canopyKeepOut}`);
  }
});

// ---------- the tree-spread (ADR-0226 §1, amends ADR-0221; per-status colourways, ADR-0227) ----------
//
// When `vegetation.heroTrees` is supplied (studio-only, `?veg=on` fetching the per-status autumn-tree
// colourways), EVERY non-garden island's procedural central tree becomes a `<use>` of the colourway for
// THAT island's status — define-once/reference-many (one def per status present), so the whole map reads
// as one authored world AND each tree keeps its status hue (the loss the owner flagged as "all the trees
// are brown"). ABSENT ⇒ the procedural tree stays byte-for-byte. The garden island keeps its own
// composition (the tree-spread doesn't double-apply). The colourways ride kind `baked-art`, which the
// studio/website mappers already render and R3F already skips — zero new mapper/R3F code.

/** A minimal baked hero with a distinguishable crown fill, so a test can assert WHICH colourway an island
 *  referenced (all real colourways share one silhouette; here the fill stands in for the crown hue). */
const vHero = (fill: string): SceneGardenHero => ({
  nodes: [{ el: 'polygon', points: '0,0 5,0 0,-5', fill, stroke: '#210', strokeWidth: 0.3 }],
  width: 10,
  height: 20.6, // the autumn-tree hero's baked height
});
const VEG_HEROES: SceneVegHeroTrees = {
  healthy: vHero('#0a0'),
  building: vHero('#d91'),
  proposed: vHero('#e95'),
  mapped: vHero('#963'),
  unhealthy: vHero('#c33'),
  unknown: vHero('#9a9'),
};
const VEG_TREE: SceneVegetationInput = { heroTrees: VEG_HEROES };
const vegDefId = (status: string): string => `veg-hero-autumn-tree-${status}`;

test('ADR-0227: the tree-spread replaces the procedural tree with a per-status baked-use on every island', () => {
  const scene = buildScene(mkInput({ vegetation: VEG_TREE }));
  assert.equal(firstByKind(scene, 'tree'), null, 'the procedural tree is gone');
  // mkInput's two islands are both `healthy` ⇒ both reference the healthy colourway.
  const trees = allByKind(scene, 'baked-art').filter((u) => (u as { defId: string }).defId === vegDefId('healthy'));
  assert.equal(trees.length, mkInput().territories.length, 'one hero-tree use per island');
  for (const t of trees) assert.match((t as { transform?: string }).transform ?? '', /^translate\(.*\) scale\(.*\)$/);
});

test('ADR-0227: each island uses the colourway for ITS status (colour-is-class restored)', () => {
  const scene = buildScene(
    mkInput({
      territories: [mkTerritory({ status: 'healthy' }), mkTerritory({ id: 'cli', status: 'unhealthy', centroid: { x: 300, y: 60 }, treeSpot: { x: 300, y: 50 }, plants: [], decor: [] })],
      vegetation: VEG_TREE,
    }),
  );
  const useDefId = (islandId: string): string =>
    (allByKind(territoryById(scene, islandId), 'baked-art').find((u) => String((u as { defId?: string }).defId).startsWith('veg-hero-autumn-tree')) as { defId: string }).defId;
  assert.equal(useDefId('library'), vegDefId('healthy'), 'the healthy island wears the green colourway');
  assert.equal(useDefId('cli'), vegDefId('unhealthy'), 'the unhealthy island wears the red colourway');
  // exactly the two used colourways are defined (define-once, node-budget: never a def for an absent status).
  const defs = allByEl(mustByKind(scene, 'baked-defs'), 'baked-def');
  const defIds = defs.map((d) => (d as { defId: string }).defId).sort();
  assert.deepEqual(defIds, [vegDefId('healthy'), vegDefId('unhealthy')].sort(), 'one def per status present, no more');
  const healthyDef = defs.find((d) => (d as { defId: string }).defId === vegDefId('healthy'));
  assert.deepEqual((healthyDef as { nodes: unknown }).nodes, VEG_HEROES.healthy!.nodes, 'the def carries the healthy colourway nodes verbatim');
});

test('ADR-0227: an unrecognised status falls back to the unknown colourway (never a missing def)', () => {
  // supply a heroTrees map WITHOUT a `proposed` variant; a proposed island falls back to `unknown`.
  const partial: SceneVegetationInput = { heroTrees: { healthy: vHero('#0a0'), unknown: vHero('#9a9') } };
  const scene = buildScene(mkInput({ territories: [mkTerritory({ id: 'cli', status: 'proposed', centroid: { x: 300, y: 60 }, treeSpot: { x: 300, y: 50 }, plants: [], decor: [] })], vegetation: partial }));
  const use = allByKind(territoryById(scene, 'cli'), 'baked-art').find((u) => String((u as { defId?: string }).defId).startsWith('veg-hero-autumn-tree'));
  assert.equal((use as { defId: string }).defId, vegDefId('unknown'), 'the proposed island falls back to unknown');
  const defs = allByEl(mustByKind(scene, 'baked-defs'), 'baked-def');
  assert.deepEqual(defs.map((d) => (d as { defId: string }).defId), [vegDefId('unknown')], 'only the referenced def is emitted');
});

test('ADR-0227: absent heroTrees keeps the procedural tree (the UNIT-1 vocabulary still applies)', () => {
  const scene = buildScene(mkInput({ vegetation: {} }));
  assert.ok(firstByKind(scene, 'tree'), 'the procedural tree stays without heroTrees');
  assert.equal(firstByKind(scene, 'baked-art'), null, 'no hero-tree use');
  assert.equal(firstByKind(scene, 'baked-defs'), null, 'no hero-tree def');
});

test('ADR-0227: the island keeps its UAT markers — ONLY the tree becomes the hero', () => {
  const scene = buildScene(
    mkInput({
      relaxedCells: FULL_LAND,
      territories: [mkTerritory({ uatCriteria: THREE_CRITERIA })],
      vegetation: VEG_TREE,
    }),
  );
  const isle = territoryById(scene, 'library');
  assert.ok(
    allByKind(isle, 'baked-art').some((u) => (u as { defId: string }).defId === vegDefId('healthy')),
    'the hero tree stands',
  );
  assert.equal(flowersOf(scene).length, THREE_CRITERIA.length, 'the UAT flowers still render (1:1)');
});

test('ADR-0227: garden takes precedence on its island; the tree-spread governs the others', () => {
  const scene = buildScene(mkInput({ territories: mkGardenTerritories(), garden: mkGarden('library'), vegetation: VEG_TREE }));
  const gardenTree = allByKind(territoryById(scene, 'library'), 'baked-art').find(
    (u) => (u as { defId: string }).defId === 'garden-hero-autumn-tree',
  );
  assert.ok(gardenTree, 'the garden island keeps its own autumn-tree composition');
  const normalTree = allByKind(territoryById(scene, 'cli'), 'baked-art').find(
    (u) => String((u as { defId?: string }).defId).startsWith('veg-hero-autumn-tree'),
  );
  assert.ok(normalTree, 'the normal island gets the tree-spread colourway');
  assert.equal(firstByKind(territoryById(scene, 'cli'), 'tree'), null, 'no procedural tree on the normal island');
});

test('ADR-0227: the tree-spread is deterministic (same input → byte-identical)', () => {
  assert.deepEqual(buildScene(mkInput({ vegetation: VEG_TREE })), buildScene(mkInput({ vegetation: VEG_TREE })));
});
