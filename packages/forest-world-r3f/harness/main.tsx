// harness/main.tsx — the spike's dev harness (dev-only, never shipped): a REAL
// @storytree/forest-world scene — buildScene over a hand-authored SceneInput,
// the core's own minimal input contract (here the harness IS the surface, so it
// authors the layout the way any surface does) — mapped by the pure worldTo3D
// and drawn by <ForestWorldCanvas> under drei MapControls.
//
// FICTIONAL demo data throughout (the ADR-0056/0066/0093 boundary): three
// territories wearing three folded statuses, two depends_on trail edges routed by
// the real cost-field engine (ADR-0169), one in-flight build wisp — enough world
// for the eye to confirm the whole stack draws.

import { createRoot } from 'react-dom/client';
import {
  PLAN_VIEW_ELEVATION_DEG,
  buildRelaxedCells,
  buildScene,
  hexCenter,
  routeTrails,
  type Axial,
  type DrawTile,
  type SceneInput,
  type SceneTerritoryInput,
  type TrailIsland,
} from '@storytree/forest-world';

import { worldTo3D } from '../src/world-to-3d.js';

/** Plan view, threaded into every lattice/substrate call — the demo stands on TRUE ground since the
 *  mapper stopped un-projecting one (ADR-0546 D1). */
const GROUND = { elevationDeg: PLAN_VIEW_ELEVATION_DEG } as const;
import { ForestWorldCanvas } from '../src/ForestWorldCanvas.js';

// ── the fictional world: three islands, three statuses ──────────────────────

interface DemoIsland {
  id: string;
  status: SceneTerritoryInput['status'];
  tiles: Axial[];
  caps: number;
  wisps: SceneTerritoryInput['wisps'];
}

const ring = (cq: number, cr: number): Axial[] => [
  { q: cq, r: cr },
  { q: cq + 1, r: cr },
  { q: cq - 1, r: cr },
  { q: cq, r: cr + 1 },
  { q: cq, r: cr - 1 },
  { q: cq + 1, r: cr - 1 },
  { q: cq - 1, r: cr + 1 },
];

const ISLANDS: DemoIsland[] = [
  {
    id: 'greenhouse',
    status: 'healthy',
    tiles: ring(0, 0),
    caps: 4,
    wisps: [{ runId: 'run-demo-1', title: 'building watering-loop', phase: 'IMPLEMENT' }],
  },
  { id: 'seed-catalogue', status: 'proposed', tiles: ring(7, -2), caps: 1, wisps: [] },
  { id: 'compost-works', status: 'unhealthy', tiles: ring(3, 5), caps: 2, wisps: [] },
];

function territoryOf(island: DemoIsland): SceneTerritoryInput {
  // NOT `island.tiles.map(hexCenter)`: this harness carried the identical bare `.map(hexCenter)`
  // bug already fixed at the studio's two call sites (`TreeView.tsx`,
  // `land-camera-consumers-reconcile`) — `Array.prototype.map` calls its callback with
  // `(element, index, array)`, and back when `elevationDeg` was a bare optional `number` that
  // silently fed each tile's ARRAY INDEX into it (0deg for the first tile, 1deg for the second,
  // ...) instead of the declared camera. `hexCenter`'s second parameter is now an `ElevationOpts`
  // object (see `hex.ts`), so a bare `.map(hexCenter)` fails to COMPILE rather than misbehaving —
  // this wrap is kept anyway, matching the arrow-wrapped form at every other call site.
  const centres = island.tiles.map((h) => hexCenter(h, GROUND));
  const cx = centres.reduce((s, c) => s + c.x, 0) / centres.length;
  const cy = centres.reduce((s, c) => s + c.y, 0) / centres.length;
  return {
    id: island.id,
    status: island.status,
    caps: island.caps,
    centroid: { x: cx, y: cy },
    groundRadius: 40,
    screenRadius: 40,
    treeSpot: { x: cx, y: cy - 6 },
    labelY: cy + 46,
    coastGroundLoops: [],
    decor: [],
    plants: [],
    treeTitle: `${island.id} — ${island.status}`,
    wisps: island.wisps,
    plate: {
      w: 120,
      h: 33,
      rx: 7,
      idY: 14,
      subY: 27,
      idText: island.id,
      subText: `${island.status} · ${island.caps} caps`,
      title: island.id,
    },
  };
}

function demoInput(): SceneInput {
  const territories = ISLANDS.map(territoryOf);
  // Route the depends_on edges with the real cost-field engine (ADR-0169 §1) — the
  // harness IS the surface, so it routes the way any surface does: islands from the
  // territory discs, a fixed seed for a byte-stable demo world.
  const trailIslands: TrailIsland[] = territories.map((t) => ({
    id: t.id,
    x: t.centroid.x,
    y: t.centroid.y,
    r: t.groundRadius,
  }));
  const edge = (a: number, b: number) => ({
    from: ISLANDS[a]!.id,
    to: ISLANDS[b]!.id,
    title: `${ISLANDS[b]!.id} depends on ${ISLANDS[a]!.id}`,
  });
  // ⚠ THE MESH SUBSTRATE, NOT THE CLASSIC ONE (`retire-the-old-land-path`). This demo built a
  // classic scene (`relaxedCells: null`) until the classic substrate was retired at the mapper —
  // `worldTo3D` now REFUSES a `tile` group outright — so a harness that kept building one would
  // throw the moment this module loaded, before the canvas ever mounted. `buildRelaxedCells` is
  // the same call `apps/studio` and the public site make; this demo now exercises the one
  // substrate the mapper still accepts.
  const drawTiles: DrawTile[] = ISLANDS.flatMap((island, owner) => island.tiles.map((h) => ({ h, owner })));
  const wheatSets = ISLANDS.map(() => new Set<string>());
  return {
    // ⚠ THE DEMO IS BUILT ON TRUE GROUND (ADR-0546 D1). `worldTo3D` un-projects nothing, so a scene
    // built at the declared land camera is a drawing and the spike would render the squashed ribbon
    // the 2D page carries. `GROUND` threads plan view through the lattice, the substrate and the
    // scene's own placements, exactly as `island-fixture.ts` does — the `- 6` tree nudge and the
    // `+ 46` nameplate offset above are still hand-picked SCREEN constants, which is a demo's
    // licence and not the shipped fixture's (`islandGroundScene`).
    cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG,
    offset: { x: 0, y: 0 },
    width: 1400,
    height: 1000,
    empties: [],
    relaxedCells: buildRelaxedCells(drawTiles, wheatSets, 'mesh', {}, GROUND),
    drawTiles,
    wheatSets,
    trails: routeTrails(trailIslands, [edge(0, 1), edge(0, 2)], 'r3f-harness-demo'),
    territories,
  };
}

// ── real core → pure mapping → canvas ────────────────────────────────────────

const descriptors = worldTo3D(buildScene(demoInput()));
const count = (k: string): number => descriptors.filter((d) => d.kind === k).length;
// ⚠ `story-tree` IS NOT A ROW HERE ANY MORE (ADR-0508). `count` takes a plain string, so a row for
// a retired family would compile and print a permanent `story-tree 0` — a census reporting on a
// family the mapper cannot emit, which reads as "the trees failed to load" rather than as "there
// are no trees". Every row below is a family `world-to-3d.ts` can still produce.
const summary =
  `cell-ground ${count('cell-ground')} · uat-bloom ${count('uat-bloom')} · ` +
  `uat-bud ${count('uat-bud')} · uat-wilt ${count('uat-wilt')} · ` +
  `trail-strip ${count('trail-strip')} · trail-ghost-strip ${count('trail-ghost-strip')} · ` +
  `cave-arch ${count('cave-arch')} · wisp-sprite ${count('wisp-sprite')} · ` +
  `skipped ${count('skipped')}`;
// The machine-checkable render signal (the harness look itself is witnessed by eyes).
console.log(`[forest-world-r3f harness] descriptors: ${summary}`);

function App() {
  return (
    <>
      <div id="hud">
        <strong>forest-world-r3f spike</strong> — real buildScene → worldTo3D →
        R3F/MapControls
        <br />
        {summary}
        <br />
        drag = pan · wheel = zoom · right-drag = rotate
      </div>
      {/* the harness opts the trail network visible (default-hidden, ADR-0169 §3) —
          the spike's eye needs to see the routed ribbons draw */}
      <ForestWorldCanvas descriptors={descriptors} showTrails />
    </>
  );
}

createRoot(document.getElementById('root')!).render(<App />);
