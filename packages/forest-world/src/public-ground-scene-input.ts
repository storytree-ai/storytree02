import { PLAN_VIEW_ELEVATION_DEG } from './camera.js';
import { COAST_OUTSET_ON_TILE, smoothCoast, type BoundarySeg } from './coast.js';
import { AXIAL_DIRS, HEX_R, axialKey, hexCenter, hexCorners, hexDist, type Pt } from './hex.js';
import { storyEdges } from './ranking.js';
import { routeTrails } from './routing.js';
import type { SceneInput, SceneParcelInput, SceneStatus, SceneTerritoryInput, SurfaceTheme } from './scene.js';
import { buildRelaxedCells } from './substrate.js';

type PublicCapability = {
  readonly id: string;
  readonly status: SceneStatus;
  readonly dependsOn: readonly string[];
  readonly testCount?: number;
};

type PublicIsland = {
  readonly id: string;
  readonly status: SceneStatus;
  readonly dependsOn: readonly string[];
  readonly centre: { readonly x: number; readonly y: number };
  readonly rings: number;
  readonly groundRadius: number;
  readonly treeSpot: { readonly x: number; readonly y: number };
  readonly labelY: number;
  readonly plate: {
    readonly w: number;
    readonly h: number;
    readonly rx: number;
    readonly idY: number;
    readonly subY: number;
    readonly idText: string;
    readonly subText: string;
    readonly title: string;
  };
  readonly treeTitle: string;
  readonly capabilities: readonly PublicCapability[];
  readonly uatLegs?: readonly { readonly state: 'proven' | 'pending' | 'failing'; readonly presentationKey: string }[];
};

export type PublicGroundFacts = {
  readonly offset: { readonly x: number; readonly y: number };
  readonly width: number;
  readonly height: number;
  readonly islands: readonly PublicIsland[];
};

const THEMES: readonly SurfaceTheme[] = ['meadow', 'woodland', 'heath'];

function groundFor(island: PublicIsland, owner: number) {
  const axis = Array.from({ length: island.rings * 2 + 1 }, (_, index) => index - island.rings);
  const tiles = axis.flatMap((q) => axis.map((r) => ({ q, r })))
    .filter((h) => hexDist(h, { q: 0, r: 0 }) <= island.rings);

  const ground = { elevationDeg: PLAN_VIEW_ELEVATION_DEG };
  const drawTiles = tiles.map((h) => ({ h, owner }));
  const coarse = buildRelaxedCells(drawTiles, [], 'mesh', undefined, ground);
  if (coarse.length === 0) throw new Error('The canonical public ground mesh has no cells');
  // Subdivide only the interior: the scene's parcel allocation needs at least
  // one cell per capability, while the supplied rings and footprint stay fixed.
  // Each extra canonical quad subdivision multiplies capacity by four. Computing
  // the required depth once avoids a retry loop waiting for geometry to grow.
  const extraPasses = Math.max(0, Math.ceil(Math.log(island.capabilities.length / coarse.length) / Math.log(4)));
  const cells = extraPasses === 0 ? coarse
    : buildRelaxedCells(drawTiles, [], 'mesh', { subdiv: 1 + extraPasses }, ground);

  const mine = new Set(tiles.map(axialKey));
  const boundary: BoundarySeg[] = [];
  for (const tile of tiles) {
    const centre = hexCenter(tile, ground);
    const corners = hexCorners(centre.x, centre.y, HEX_R, PLAN_VIEW_ELEVATION_DEG);
    AXIAL_DIRS.forEach((direction, edge) => {
      if (mine.has(axialKey({ q: tile.q + direction.q, r: tile.r + direction.r }))) return;
      const a = corners[edge]!;
      const b = corners[(edge + 1) % corners.length]!;
      boundary.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    });
  }
  const coast = smoothCoast(boundary, island.id, COAST_OUTSET_ON_TILE).loops;
  // ground-space: the coast is constructed at plan elevation around the ground origin.
  const radius = coast.flat().reduce(
    (extent, point) => Math.max(extent, Math.hypot(point.x, point.y)),
    0,
  );
  // Build at the canonical tile size before fitting to the supplied ground
  // radius, so small positive radii never collapse the core's vertex keys.
  const scale = island.groundRadius / radius;
  const place = (point: Pt): Pt => ({
    x: island.centre.x + point.x * scale,
    y: island.centre.y + point.y * scale,
  });
  return {
    cells: cells.map((cell) => ({ ...cell, poly: cell.poly.map(place) })),
    coastGroundLoops: coast.map((loop) => loop.map(place)),
  };
}

function parcelSeed(poly: readonly Pt[]): Pt {
  // A different existing cell supplies each seed. Its centroid is on that
  // capability's ground, including the crowded single-tile case.
  return {
    x: poly.reduce((sum, point) => sum + point.x, 0) / poly.length,
    y: poly.reduce((sum, point) => sum + point.y, 0) / poly.length,
  };
}

export function composePublicGroundScene(facts: PublicGroundFacts): SceneInput {
  const grounds = facts.islands.map(groundFor);
  const edges = storyEdges(facts.islands);

  return {
    offset: { ...facts.offset },
    width: facts.width,
    height: facts.height,
    empties: [],
    relaxedCells: grounds.flatMap((ground) => ground.cells),
    drawTiles: [],
    wheatSets: [],
    cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG,
    trails: routeTrails(facts.islands.map((island) => ({ id: island.id, x: island.centre.x, y: island.centre.y, r: island.groundRadius })), edges, 'public-ground-scene'),
    territories: facts.islands.map((island, owner) => {
      const territory: SceneTerritoryInput = {
        id: island.id,
        status: island.status,
        caps: island.capabilities.length,
        centroid: { ...island.centre },
        groundRadius: island.groundRadius,
        screenRadius: island.groundRadius,
        treeSpot: { ...island.treeSpot },
        anchorSpace: 'ground',
        labelY: island.labelY,
        coastGroundLoops: grounds[owner]!.coastGroundLoops,
        decor: [],
        plants: [],
        parcels: island.capabilities.map((capability, index) => {
          const parcel: SceneParcelInput = {
            capId: capability.id,
            status: capability.status,
            theme: THEMES[index % THEMES.length]!,
            seed: parcelSeed(grounds[owner]!.cells[index]!.poly),
          };
          if (capability.testCount !== undefined) parcel.testCount = capability.testCount;
          return parcel;
        }),
        treeTitle: island.treeTitle,
        wisps: [],
        claims: [],
        plate: { ...island.plate },
      };
      if (island.uatLegs?.length) {
        territory.uatCriteria = island.uatLegs.map((leg) => ({ id: leg.presentationKey, state: leg.state }));
      }
      return territory;
    }),
  };
}
