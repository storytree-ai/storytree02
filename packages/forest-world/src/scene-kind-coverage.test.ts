// scene-kind-coverage — THE BIDIRECTIONAL CHECK between the `SceneKind` vocabulary, the builder that
// emits it, the folds that feed the builder, and the painters that draw it (ADR-0527 D4/D5;
// `forest-geometry-rebuild-arc-inc-01`, the standing inventory in
// `docs/research/forest-geometry-inventory-2026-09-06.md`).
//
// WHY THIS IS A TEST AND NOT A DOCUMENT. The inventory's first pass (2026-09-06) found two dormant
// drawable families — `garden-*` and the classic `tile*` ground — because each had a comment
// announcing itself. A family that never advertised would have been missed, and a committed list
// goes stale the month after it is written. The check below is arithmetic over the source and the
// runtime, so it keeps answering: it FAILS when a kind is declared that no builder emits, when a
// kind is emitted that no fixture here can reach, when a kind's reachability CHANGES (a starved
// family becoming live, or a live one becoming starved), and when a painter stops naming a kind it
// used to draw. Each failure message names the kind and which side moved.
//
// THE FOUR QUESTIONS, in order:
//   1. Is every declared `SceneKind` emitted by builder code?            (static, scene.ts)
//   2. Is every declared kind PRODUCIBLE by some `SceneInput`?            (runtime, maximal fixture)
//   3. Which kinds does NO shipped fold ever feed?                        (runtime, shipped fixtures)
//      — the WIRED-BUT-STARVED set, pinned explicitly so a change is a failure, not a drift.
//   4. Does each painter still name the kinds it draws?                   (static, three painters)
//
// ⚠ THE SHIPPED FIXTURES ARE THE LOAD-BEARING PART, and they are MIRRORS of real folds, not of this
// file's own expectations: `studioShippedInput` mirrors `TreeView.territoryToScene` / `worldToScene`
// (apps/studio), `websiteSnapshotInput` mirrors `forest-snapshot-map.ts` (the /forest page) and
// `websiteAct2Input` mirrors `act2-walkthrough.ts` (the index page). Each carries a comment naming
// the fold line it mirrors. A fold that starts sending a new optional field must be mirrored here,
// and question 3 will say so by failing — that is the mechanism, not a defect of it.
//
// ⚠ Comments are stripped before any source scan (`source-text-check-trips-on-its-own-rationale`):
// the `SceneKind` union's own commentary names half the vocabulary, and a scan that read it would
// call every kind "emitted".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, sep } from 'node:path';

import { hexDist, type Axial } from './hex.js';
import { routeTrails, type TrailIsland } from './routing.js';
import { buildRelaxedCells, type DrawTile } from './substrate.js';
import {
  buildScene,
  type SceneGardenHero,
  type SceneGardenInput,
  type SceneInput,
  type SceneKind,
  type SceneNode,
  type SceneTerritoryInput,
} from './scene.js';
import { BASE_TRAILS, isle, shippedInput, shippedTerritory, withoutParcels } from './scene-fixture.js';

const here = fileURLToPath(new URL('.', import.meta.url));

/**
 * THE REPO ROOT, RESOLVED BACK OUT OF `check:mutation-diff`'S SANDBOX.
 *
 * ⚠⚠ EVERY PATH BELOW IS READ AS SOURCE TEXT, AND THAT MAKES THIS FILE UNRUNNABLE INSIDE THE RUNG
 * UNLESS IT UN-SANDBOXES ITSELF. `check:mutation-diff` copies the repo to
 * `<root>/.stryker-tmp/sandbox-XXXX/` and RE-PRINTS every mutated file through babel, wrapping each
 * literal in a `stryMutAct_…` ternary — so `case 'tall-flower-proven':` becomes something no `case`
 * scan matches, every assertion below reads FEWER kinds than the real painter names, and the whole
 * dry run aborts before one mutant is evaluated. The report is the test's TITLE and nothing else.
 *
 * ⚠ IT WAS LATENT FOR AS LONG AS THIS FILE HAS EXISTED, and what woke it was not a change here.
 * The rung only selects a test file as a WITNESS when this branch touched it or its subject, so a
 * parse that has been safe for years becomes unrunnable the first time its subject enters a mutate
 * span — which `world-to-3d.ts` did on 2026-09-23 (ADR-0600).
 *
 * ⚠ AND READING THE ORIGINAL IS THE CORRECT MUTATION SEMANTICS RATHER THAN A DODGE. The subject of
 * these scans is the AUTHORED source; holding a mutated painter against the pristine kind union is
 * exactly the comparison a surviving mutant ought to fail. {@link readPainter} proves the bytes are
 * not instrumented rather than trusting the path arithmetic.
 */
const repoRoot = ((): string => {
  const marker = `${sep}.stryker-tmp${sep}`;
  const index = here.indexOf(marker);
  const base = index === -1 ? here : resolve(here.slice(0, index), 'packages', 'forest-world', 'src');
  return resolve(base, '..', '..', '..');
})();
const SCENE_SRC = resolve(repoRoot, 'packages/forest-world/src/scene.ts');
const STUDIO_PAINTER = resolve(repoRoot, 'packages/app-surface/src/SceneView.tsx');
const R3F_PAINTER = resolve(repoRoot, 'packages/forest-world-r3f/src/world-to-3d.ts');
/** The website's string-SVG painter lives in the `web/` submodule, which is not always checked out
 *  (`check:web-engine` skips on the same condition). Its leg is conditional and SAYS SO. */
const WEB_PAINTER = resolve(repoRoot, 'web/src/lib/worldSvg.ts');

// ---------------------------------------------------------------------------
// source helpers
// ---------------------------------------------------------------------------

/** Strip block and line comments while leaving string contents alone — a `//` inside a
 *  quoted SVG path or a template literal is data, not a comment. */
export function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') {
        out += n ?? '';
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && n === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (c === '/' && n === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? src.length : end;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * The declared `SceneKind` union, read from the comment-stripped source: every quoted member
 * between `export type SceneKind =` and the terminating `;`.
 *
 * ⚠ **IT MATCHES THE LITERALS, NOT THE `|` SEPARATORS, AND THAT IS THE FIX FOR A REAL MISREAD.**
 * This used to match `| 'x'`, which reads the source's own hand-written layout — every member after
 * the first is preceded by a pipe, but the FIRST need not be, and in a re-printed copy none of them
 * is on its own line. Measured 2026-09-07: `check:mutation-diff` put `scene.ts` in its mutate set
 * for the first time since this file landed, and Stryker's instrumenter re-prints the union as one
 * line — `export type SceneKind = 'world' | 'empties-layer' | …` — so the leading-pipe form silently
 * dropped `'world'`, the first member. 108 members became 107, the `> 50` floor was untroubled, and
 * question 2's second half then failed as "emitted at runtime but not declared" against a kind that
 * IS declared. A parser that under-reports by exactly one is the worst shape this file can have:
 * every check here is a set comparison, so one missing member is a wrong answer wearing a
 * plausible-looking failure message.
 */
export function declaredSceneKinds(sceneSrc: string): string[] {
  const src = stripComments(sceneSrc);
  const start = src.indexOf('export type SceneKind =');
  assert.ok(start >= 0, 'scene.ts declares `export type SceneKind =`');
  const end = src.indexOf(';', start);
  const block = src.slice(start, end);
  const kinds = [...block.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!);
  assert.ok(kinds.length > 50, `the SceneKind union parsed to ${kinds.length} members — the parser broke`);
  assert.equal(new Set(kinds).size, kinds.length, 'the SceneKind union declares no member twice');
  return kinds;
}

/** Which of `kinds` a comment-stripped source NAMES: as a quoted literal `'x'`, or as a bare object
 *  key at line start (`  x: …`, the shape the studio's `BASE` table uses for identifier-safe kinds). */
function namedKinds(src: string, kinds: readonly string[]): Set<string> {
  const stripped = stripComments(src);
  const out = new Set<string>();
  for (const k of kinds) {
    const quoted = stripped.includes(`'${k}'`);
    const bareKey = /^[a-z][a-z0-9]*$/.test(k) && new RegExp(`^[ \\t]+${k}:`, 'm').test(stripped);
    if (quoted || bareKey) out.add(k);
  }
  return out;
}

/** The kinds a source declares as `case 'x':` — a painter's explicit branches. */
function caseKinds(src: string): Set<string> {
  return new Set([...stripComments(src).matchAll(/case '([a-z0-9-]+)':/g)].map((m) => m[1]!));
}

// ---------------------------------------------------------------------------
// runtime helpers
// ---------------------------------------------------------------------------

function children(n: SceneNode): readonly SceneNode[] {
  return n.el === 'g' ? n.children : [];
}

/** Every `kind` carried by any node of the scene (the builder's runtime vocabulary). */
export function emittedKinds(scene: SceneNode): Set<string> {
  const out = new Set<string>();
  const walk = (n: SceneNode): void => {
    if (n.kind) out.add(n.kind);
    for (const c of children(n)) walk(c);
  };
  walk(scene);
  return out;
}

const setMinus = (a: Iterable<string>, b: Set<string>): string[] => [...a].filter((k) => !b.has(k)).sort();

// ---------------------------------------------------------------------------
// the fixtures — three SHIPPED shapes (mirrors of real folds) and one MAXIMAL shape
// ---------------------------------------------------------------------------

/** A minimal baked hero — enough for the defs / placement machinery to run. */
const hero = (height: number): SceneGardenHero => ({
  nodes: [{ el: 'polygon', points: '0,0 5,0 0,-5', fill: '#cba', stroke: '#210', strokeWidth: 0.3 }],
  width: 10,
  height,
});

/** The garden composition — reachable ONLY by `SceneInput.garden`, which no fold sets (ADR-0228
 *  retired its `?garden` feeder outright). Used by the MAXIMAL fixture alone. */
const garden = (islandId: string): SceneGardenInput => ({
  islandId,
  heroes: { cottage: hero(21.8), gazebo: hero(15.4), 'autumn-tree': hero(20.6), 'stepping-stone': hero(6.3) },
});

/** A REAL-SIZED mesh substrate — the same `buildRelaxedCells` call the studio and the website make,
 *  over two hex islands (radius 2 and radius 1) — so parcel surfaces have the area the shipped map's
 *  do. `scene-fixture`'s three tiny cells are right for byte-golden tests and too small for a parcel
 *  to scatter a single flower mark on, which is a fixture artefact, not a starved kind. */
function realisticSubstrate(): Pick<SceneInput, 'relaxedCells' | 'drawTiles' | 'wheatSets'> {
  const within = (cq: number, cr: number, radius: number): Axial[] => {
    const out: Axial[] = [];
    for (let q = -radius; q <= radius; q++) {
      for (let r = -radius; r <= radius; r++) {
        if (hexDist({ q: 0, r: 0 }, { q, r }) <= radius) out.push({ q: cq + q, r: cr + r });
      }
    }
    return out;
  };
  const drawTiles: DrawTile[] = [
    ...within(0, 0, 3).map((h) => ({ h, owner: 0 })),
    ...within(9, -3, 1).map((h) => ({ h, owner: 1 })),
    ...within(4, 6, 1).map((h) => ({ h, owner: 2 })),
  ];
  const wheatSets = [new Set<string>(['1,0']), new Set<string>(), new Set<string>()];
  return { drawTiles, wheatSets, relaxedCells: buildRelaxedCells(drawTiles, wheatSets, 'mesh') };
}

/** A routed network whose one edge is WALLED IN, so the router's interior fallback fires and emits
 *  cave portals — the same ring `routing.test.ts` uses to prove "caves only when forced". */
function forcedCaveTrails(): ReturnType<typeof routeTrails> {
  const islands: TrailIsland[] = [isle('library', 0, 0, 30), isle('cli', 600, 0, 30)];
  for (let k = 0; k < 8; k++) {
    const a = (Math.PI / 4) * k;
    islands.push(isle(`ring${k}`, 150 * Math.cos(a), 150 * Math.sin(a), 60));
  }
  return routeTrails(islands, [{ from: 'library', to: 'cli' }], 'scene-kind-coverage');
}

/**
 * THE STUDIO MAP as `TreeView.worldToScene` / `territoryToScene` shape it (apps/studio,
 * `TreeView.tsx` — `worldToScene` passes `null, null` for `bakedStone`/`garden` and always composes
 * `vegetation`; `territoryToScene` sends `parcels` for every island with caps, `uatCriteria` when
 * the story has any, `claims` + `departures` from the ledger, and ALWAYS
 * `wisps: []` — build wisps are folded ONTO claims as their `phase`, never emitted on their own).
 * No `signpost` (retired), no `drawTiles`-only substrate (`SUBSTRATE_MODE`
 * is the constant `'mesh'`, so `relaxedCells` is null only when there is no world at all).
 */
const LIBRARY_CAPS: SceneTerritoryInput['plants'] = [
  { id: 'library#cap-a', status: 'healthy', x: -30, y: 20, title: 'cap a' },
  { id: 'library#cap-b', status: 'unhealthy', x: 30, y: 25, title: 'cap b' },
  { id: 'library#cap-c', status: 'building', x: 0, y: 40, title: 'cap c' },
  { id: 'library#cap-d', status: 'healthy', x: -35, y: -25, title: 'cap d' },
  { id: 'library#cap-e', status: 'proposed', x: 35, y: -20, title: 'cap e' },
  { id: 'library#cap-f', status: 'mapped', x: 5, y: -45, title: 'cap f' },
];

function studioShippedInput(): SceneInput {
  const base = { ...shippedInput(), ...realisticSubstrate() };
  const library: SceneTerritoryInput = {
    // Several capabilities across statuses: the parcel THEME and the flora VARIANT are id-hashed, so
    // a real island's spread of ids is what reaches every parcel mark — one cap would pin one theme.
    ...shippedTerritory({
      caps: 6,
      centroid: { x: 0, y: 0 },
      treeSpot: { x: 0, y: -10 },
      groundRadius: 80,
      screenRadius: 80,
      labelY: 90,
      plants: LIBRARY_CAPS,
      // the studio's `capToParcel`: one parcel per capability, tinted by ITS status, a real test density
      parcels: LIBRARY_CAPS.map((p, i) => ({
        capId: p.id,
        status: p.status,
        testCount: 12,
        theme: (['meadow', 'woodland', 'heath'] as const)[i % 3]!,
        seed: { x: p.x, y: p.y },
      })),
    }),
    uatCriteria: [
      { id: 'c1', state: 'proven' },
      { id: 'c2', state: 'pending' },
      { id: 'c3', state: 'failing' },
    ],
    claims: [
      { key: 's1', title: 'a work claim', colourState: 'authoring', grade: 'work', phase: 'IMPLEMENT' },
      { key: 's2', title: 'an exploring claim', colourState: 'proving', grade: 'exploring' },
      { key: 's3', title: 'a waiting claim', colourState: 'supplementing', grade: 'waiting' },
    ],
    departures: [{ key: 's0', title: 'a released claim', ageRatio: 0.5 }],
  };
  // A capless island keeps its layout `decor` (the conifers) and carries no parcels — the second
  // shipped shape (`t.caps.length` guards the parcels spread).
  const cli = shippedTerritory({
    id: 'cli',
    caps: 0,
    status: 'proposed',
    centroid: { x: 300, y: 60 },
    treeSpot: { x: 300, y: 50 },
    plants: [],
    decor: [{ x: 290, y: 70, seed: 3 }],
  });
  const unhealthy = shippedTerritory({
    id: 'agent',
    caps: 0,
    status: 'unhealthy',
    centroid: { x: 500, y: 300 },
    treeSpot: { x: 500, y: 290 },
    plants: [],
    decor: [],
  });
  return {
    ...base,
    trails: routeTrails(
      [isle('library', 100, 200, 60), isle('cli', 300, 60, 50), isle('agent', 500, 300, 40)],
      [
        { from: 'library', to: 'cli' },
        { from: 'agent', to: 'library' },
      ],
      'studio-shipped',
    ),
    territories: [library, cli, unhealthy],
    vegetation: { heroTrees: { healthy: hero(20.6), proposed: hero(20.6), unhealthy: hero(20.6) } },
  };
}

/** THE PUBLIC /forest PAGE as `forest-snapshot-map.ts` shapes it: `empties: []`, `drawTiles: []`,
 *  mesh cells, `plants: []` (a snapshot draws no capability flora), layout `decor`, `wisps: []`
 *  (a snapshot has no live session), no parcels / criteria / signpost / claims. */
function websiteSnapshotInput(): SceneInput {
  const base = shippedInput();
  return {
    ...base,
    empties: [],
    drawTiles: [],
    trails: BASE_TRAILS,
    // every corpus status reaches the page — an unhealthy island draws the withered `bare` tree
    territories: base.territories.map((t, i) =>
      withoutParcels({
        ...t,
        status: i === 1 ? 'unhealthy' : t.status,
        plants: [],
        decor: [{ x: t.centroid.x - 20, y: t.centroid.y - 20, seed: 5 }],
      }),
    ),
  };
}

/** THE INDEX PAGE'S ACT 2 WALK as `act2-walkthrough.ts` shapes it: the fictional three-story
 *  example — `plants` per limb, layout `decor`, build `wisps` on the island being worked, no
 *  parcels / criteria / signpost / claims. */
function websiteAct2Input(): SceneInput {
  const base = shippedInput();
  return {
    ...base,
    empties: [],
    drawTiles: [],
    trails: BASE_TRAILS,
    territories: base.territories.map((t, i) =>
      withoutParcels({
        ...t,
        // several limbs per status: the one-plant-per-cap flora picks its variant (and its dead
        // form) from the id hash, so a spread of ids is what reaches every flora kind
        plants:
          i === 0
            ? (['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] as const).map((s, j) => ({
                id: `${t.id}#${s}`,
                status: j % 2 === 0 ? ('healthy' as const) : ('unhealthy' as const),
                x: t.centroid.x - 20 + j * 6,
                y: t.centroid.y + 5 + (j % 3) * 4,
                title: s,
              }))
            : [],
        decor: [{ x: t.centroid.x - 20, y: t.centroid.y - 20, seed: 5 }],
        wisps: i === 0 ? [{ runId: 'r1', title: 'a build in flight', phase: 'IMPLEMENT' }] : [],
      }),
    ),
  };
}

/** EVERYTHING, ACROSS SEVERAL SCENES — the shipped shapes plus every input no fold sends: both
 *  substrates, a forced cave, the signpost in all three states, a build wisp with a
 *  colour state, and the garden. SEVERAL scenes rather than one because some inputs SUPPRESS
 *  others on the same island (a garden retires the island's procedural tree, flora, parcels and
 *  signpost; a vegetation hero replaces the procedural crown), so "everything at once" hides
 *  kinds. A union member no scene here reaches is either dead vocabulary or a fixture gap, and
 *  the assertion names it either way. */
function maximalInputs(): SceneInput[] {
  const studio = studioShippedInput();
  const act2 = websiteAct2Input();
  // procedural trees (no vegetation heroes), signposts in all three states, a
  // coloured build wisp, and a walled-in edge that forces a cave pair
  const procedural: SceneInput = {
    ...act2,
    trails: forcedCaveTrails(),
    territories: [
      {
        ...act2.territories[0]!,
        signpost: { outcome: 'pass' },
        wisps: [{ runId: 'r1', title: 'a build', phase: 'CONFIRM_RED', colourState: 'proving' }],
      },
      { ...act2.territories[1]!, signpost: { outcome: null } },
      { ...studio.territories[2]!, signpost: { outcome: 'fail' } },
    ],
  };
  // the garden composed onto the parcel-bearing studio island
  const gardened: SceneInput = { ...studio, garden: garden('library') };
  // the CLASSIC extruded-hex substrate: `relaxedCells: null` routes `buildGround` to `drawTiles`
  // (the studio shape, which still carries `drawTiles`; the website folds send `drawTiles: []`)
  const classic: SceneInput = { ...studio, relaxedCells: null };
  return [studio, act2, websiteSnapshotInput(), procedural, gardened, classic];
}

// ---------------------------------------------------------------------------
// THE PINNED INVENTORY — the answer this check keeps giving. Change these ON PURPOSE, with the
// inventory document, never to make the test pass.
// ---------------------------------------------------------------------------

/** Kinds NO shipped fold feeds (WIRED-BUT-STARVED, ADR-0527 D4). Each family names its evidence. */
const STARVED_KINDS: readonly SceneKind[] = [
  // the classic extruded-hex ground: emitted only when `relaxedCells` is null, and every fold sends
  // mesh cells (`SUBSTRATE_MODE = 'mesh'` in the studio; the website builds them unconditionally).
  // `world-to-3d.ts` REFUSES a `tile` outright. Its only builder in the repo is the r3f harness's
  // classic fixture, which exists to prove that refusal.
  'ground-hex',
  'tile',
  'tile-side',
  'tile-top',
  'tile-top-wheat',
  // the cosy-island garden: `SceneInput.garden` is set by nothing since ADR-0228 retired `?garden`.
  'garden-lavender-stem',
  'garden-lavender-head',
  'garden-grass-blade',
  // the human-witness signpost: `signpost` is set only by the website's `worldToSceneInput`, whose
  // caller `renderWorld` has no caller. The studio retired the signpost (ADR-0226 decision 5).
  'sign-blank',
  'sign-pass',
  'sign-fail',
  'sign-post',
  'sign-head',
  // THE VERDICT BLOOM IS GONE, not starved — ADR-0529 retired it and ADR-0536 settled what its one
  // remaining consumer (the fifth frame of the public semantic-growth walk) does instead. The five
  // `bloom-*` kinds, `buildBloom`, both `bloom` inputs and the `outcome` node field were deleted in
  // that landing, so there is no vocabulary left here to starve. Left as a note rather than silence
  // because the pin's whole job is to say WHY a kind is not drawn, and "it was deleted" is the one
  // answer a reader cannot recover from the list.
];

/** Kinds that are LIVE-AS-AN-ALARM (ADR-0527 D4, corrected in place): emitted only when the router
 *  cannot route around an island, zero on every real corpus, and watched by
 *  `apps/studio/src/lib/comparativeCapture.ts`'s "connector-health canary" for a nonzero count. A
 *  shipped fixture never produces them; the maximal fixture forces them. NOT starved: the input IS
 *  produced by the live router on a defect, and that is the point of them. */
const ALARM_KINDS: readonly SceneKind[] = ['cave', 'cave-apron', 'cave-arch', 'cave-rim', 'trail-ghost'];

// ---------------------------------------------------------------------------
// the checks
// ---------------------------------------------------------------------------

/**
 * READ ONE SOURCE FILE, AND PROVE IT IS THE AUTHORED ONE.
 *
 * ⚠ THE ASSERTION IS THE POINT, not the read. `repoRoot`'s arithmetic could be wrong — a future
 * sandbox layout, a different marker — and the failure mode of a wrong path is the QUIET one: the
 * scan finds fewer `case` labels and reports "the painter does not name this kind", which reads as
 * a real finding. A `stryMutAct_` in the bytes is proof the file was re-printed by the rung, so
 * this fails LOUDLY and names the cause instead.
 */
function readPainter(path: string): string {
  const src = readFileSync(path, 'utf8');
  assert.ok(
    !src.includes('stryMutAct_'),
    `${path} is a mutation-instrumented copy rather than the authored source — every kind scan ` +
      'over it would under-report, and under-reporting reads as a finding. Check `repoRoot`.',
  );
  return src;
}

const sceneSrc = readPainter(SCENE_SRC);
const UNION = declaredSceneKinds(sceneSrc);

test('0. the union parser reads a RE-PRINTED layout identically — the layout is not the vocabulary', () => {
  // The regression this file could not previously see (see `declaredSceneKinds`): a tool that
  // re-prints `scene.ts` — Stryker's instrumenter does, when `check:mutation-diff` mutates this
  // file — collapses the union onto one line and leaves the first member with no leading `|`. The
  // parser must read the same vocabulary from both layouts, or every set comparison below is
  // answering about a union one member short.
  const hand = "export type SceneKind =\n  // structural\n  | 'alpha'\n  | 'beta-two'\n  | 'gamma';\n";
  const printed = "export type SceneKind = 'alpha' | 'beta-two' | 'gamma';\n";
  // the >50 floor is the real parser's; assert the two agree, on the shape the floor cannot see.
  const parse = (src: string): string[] => {
    const stripped = stripComments(src);
    const start = stripped.indexOf('export type SceneKind =');
    return [...stripped.slice(start, stripped.indexOf(';', start)).matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]!);
  };
  assert.deepEqual(parse(hand), ['alpha', 'beta-two', 'gamma']);
  assert.deepEqual(parse(printed), parse(hand), 'the re-printed layout must yield the same members');
});

test('1. every declared SceneKind is emitted by builder code (static; no declared-but-never-built kind)', () => {
  // The union block itself is excluded — a kind must appear as a literal OUTSIDE its own declaration.
  const stripped = stripComments(sceneSrc);
  const start = stripped.indexOf('export type SceneKind =');
  const end = stripped.indexOf(';', start);
  const builders = stripped.slice(0, start) + stripped.slice(end);
  const named = namedKinds(builders, UNION);
  assert.deepEqual(setMinus(UNION, named), [], 'declared in SceneKind but no builder in scene.ts names it');
});

test('2. every declared SceneKind is PRODUCIBLE — the maximal fixture reaches all of it (runtime)', () => {
  const reached = new Set<string>();
  for (const input of maximalInputs()) for (const k of emittedKinds(buildScene(input))) reached.add(k);
  assert.deepEqual(
    setMinus(UNION, reached),
    [],
    'declared and named by a builder, but NO SceneInput this fixture can express produces it — dead ' +
      'vocabulary, or widen `maximalInputs()` and say which input reaches it',
  );
  // and nothing the builder emits is outside the vocabulary (a kind typed as SceneKind cannot be, but
  // the walk reads the runtime value — this is the seam a `as SceneKind` cast would leak through)
  assert.deepEqual(setMinus(reached, new Set(UNION)), [], 'emitted at runtime but not declared');
});

test('3. the WIRED-BUT-STARVED set is exactly the pinned one — no shipped fold feeds these, and every other kind is fed by one (runtime)', () => {
  const shipped = new Set<string>();
  for (const input of [studioShippedInput(), websiteSnapshotInput(), websiteAct2Input()]) {
    for (const k of emittedKinds(buildScene(input))) shipped.add(k);
  }
  const notShipped = setMinus(UNION, shipped);
  const expected = [...STARVED_KINDS, ...ALARM_KINDS].sort();
  assert.deepEqual(
    notShipped,
    expected,
    'the set of kinds no shipped fold produces MOVED. A kind newly on the left is now starved (a fold ' +
      'stopped sending its input, or a fold changed and this mirror was not updated); a kind newly on ' +
      'the right is now fed by a shipped surface. Either way, update the inventory and the pin together.',
  );
  // the alarm family is producible by the LIVE router (the forced-cave fixture), so it is not starved
  const forced = emittedKinds(buildScene({ ...studioShippedInput(), trails: forcedCaveTrails() }));
  for (const k of ALARM_KINDS) assert.ok(forced.has(k), `the forced route emits the alarm kind ${k}`);
});

test('3b. the shipped fixtures are not stale mirrors: each optional input the studio fold sends is present', () => {
  // Guard against this file's own drift: the studio mirror must carry every optional field the
  // real fold can set, or question 3 measures a fixture rather than the studio.
  const t = studioShippedInput().territories[0]!;
  for (const field of ['parcels', 'uatCriteria', 'claims', 'departures'] as const) {
    assert.ok(t[field] !== undefined && (t[field] as unknown[]).length !== 0, `studio mirror sends ${field}`);
  }
  assert.ok(studioShippedInput().vegetation?.heroTrees, 'studio mirror composes vegetation.heroTrees');
  assert.equal(studioShippedInput().garden, undefined, 'studio mirror sends no garden (ADR-0228)');
  assert.equal(studioShippedInput().bakedStone, undefined, 'studio mirror sends no bakedStone (no caller of loadBakedStone)');
});

test('4a. the studio painter (SceneView.tsx) names every kind it draws; the kinds it leaves unclassed are the pinned structural set', () => {
  const src = readPainter(STUDIO_PAINTER);
  const named = namedKinds(src, UNION);
  // Kinds the studio painter deliberately never names: a `<g>` the studio styles through its parent,
  // or a leaf whose class comes from the group. An addition here is a conscious decision.
  const UNCLASSED_ON_STUDIO: readonly SceneKind[] = ['coast-shore'].filter((k) => !named.has(k)) as SceneKind[];
  const unnamed = setMinus(UNION, named);
  assert.deepEqual(
    unnamed,
    [...UNCLASSED_ON_STUDIO].sort(),
    'a SceneKind the studio painter does not name at all — it renders unclassed. Name it in BASE / ' +
      'composeClass, or pin it here as deliberately unclassed.',
  );
  for (const k of caseKinds(src)) {
    if (/^[a-z0-9-]+$/.test(k) && UNION.includes(k)) continue;
    // `case` labels on other switches (el kinds, veg kinds) are fine; only SceneKind-shaped strays matter
  }
});

test('4b. the 3D mapper (world-to-3d.ts) maps exactly the pinned kinds and skips the rest explicitly', () => {
  const src = readPainter(R3F_PAINTER);
  const cases = [...caseKinds(src)].filter((k) => UNION.includes(k)).sort();
  // `tile` REFUSES, `tree` SKIPS on purpose, the rest map to descriptors; `cell`/`cell-wheat`/
  // `trail-fill`/`trail-ghost` are matched as leaf `kind ===` tests rather than `case` labels.
  //
  // ⚠ ALL THREE MARKER WRAPPERS ARE HERE SINCE ADR-0600. Until 2026-09-23 only `tall-flower-proven`
  // was, and the other two fell to the explicit skip — which counted across the live corpus as one
  // acceptance criterion in three drawn as nothing. This pin is what would catch the mapper losing
  // one of them again, so it names them individually rather than matching a prefix.
  assert.deepEqual(cases, [
    'cave',
    'tall-flower-failing',
    'tall-flower-pending',
    'tall-flower-proven',
    'tile',
    'tree',
    'wisp',
  ]);
  const leafMapped = ['cell', 'cell-wheat', 'trail-fill', 'trail-ghost'];
  const stripped = stripComments(src);
  for (const k of leafMapped) assert.ok(stripped.includes(`kind === '${k}'`), `world-to-3d maps the leaf kind ${k}`);
  assert.ok(stripped.includes("kind: 'skipped', sceneKind: kind"), 'every other kind is an explicit skip');
});

test('4c. the website painter (web/src/lib/worldSvg.ts) names every kind it draws — when the submodule is checked out', () => {
  if (!existsSync(WEB_PAINTER)) {
    // eslint-disable-next-line no-console
    console.log('  scene-kind-coverage: web/ is not checked out — the website painter was NOT checked (git submodule update --init web)');
    return;
  }
  const src = readPainter(WEB_PAINTER);
  const named = namedKinds(src, UNION);
  const unnamed = setMinus(UNION, named);
  // The website never receives these (the studio-only coordination / parcel / marker / garden / baked
  // families and the classic ground), and its painter renders an unnamed kind as an unclassed
  // element — so this list is the website's OWN starved set, pinned. It is wider than the studio's
  // because the website's folds send fewer inputs (no parcels, criteria, claims, garden, vegetation).
  const UNNAMED_ON_WEB: readonly string[] = [
    'baked-art', 'baked-defs',
    'claim-wisp', 'claim-wisp-dot', 'claim-wisp-glow', 'claim-wisp-hit', 'claim-wisps',
    'departing-wisp', 'departing-wisp-dot', 'departing-wisp-glow', 'departing-wisp-hit', 'departing-wisps',
    'empty',
    'hover-wisp', 'hover-wisp-dot', 'hover-wisp-glow', 'hover-wisp-hit',
    'queue-wisp', 'queue-wisp-dot', 'queue-wisp-glow', 'queue-wisp-hit',
    'garden-grass-blade', 'garden-lavender-head', 'garden-lavender-stem',
    'parcel', 'parcel-blade', 'parcel-flora', 'parcel-flower', 'parcel-shrub', 'parcel-stem',
    'tall-flower-bud', 'tall-flower-center', 'tall-flower-failing', 'tall-flower-glow', 'tall-flower-leaf',
    'tall-flower-pending', 'tall-flower-petal', 'tall-flower-proven', 'tall-flower-stem',
    'tile-side', 'tile-top', 'tile-top-wheat',
  ];
  assert.deepEqual(unnamed, [...UNNAMED_ON_WEB].sort(), 'the set of kinds the website painter never names moved');
});
