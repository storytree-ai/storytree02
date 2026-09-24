import { PLAN_VIEW_ELEVATION_DEG } from './camera.js';
import { routeTrails } from './routing.js';
import type { SceneInput, SceneStatus, SurfaceTheme } from './scene.js';
import type { RelaxedCell } from './substrate.js';

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

function cellsFor(island: PublicIsland, owner: number): RelaxedCell[] {
  // A small deterministic ground lattice supplies more cells than any capability
  // in the public payload, allowing the core's own Voronoi partition to retain each.
  const count = Math.max(3, island.capabilities.length);
  const side = Math.ceil(Math.sqrt(count));
  const step = (island.groundRadius * 1.4) / side;
  const startX = island.centre.x - (side * step) / 2;
  const startY = island.centre.y - (side * step) / 2;
  const cells: RelaxedCell[] = [];
  for (let y = 0; y < side; y++) {
    for (let x = 0; x < side; x++) {
      const left = startX + x * step;
      const top = startY + y * step;
      cells.push({
        owner,
        poly: [{ x: left, y: top }, { x: left + step, y: top }, { x: left + step, y: top + step }, { x: left, y: top + step }],
        variant: (x + y) % 3,
        wheat: false,
      });
    }
  }
  return cells;
}

function coastFor(island: PublicIsland): { x: number; y: number }[] {
  return Array.from({ length: 8 }, (_, index) => {
    const angle = (index / 8) * Math.PI * 2;
    return { x: island.centre.x + Math.cos(angle) * island.groundRadius, y: island.centre.y + Math.sin(angle) * island.groundRadius };
  });
}

function parcelSeed(island: PublicIsland, index: number): { x: number; y: number } {
  const n = island.capabilities.length;
  const angle = -Math.PI / 2 + ((index + 0.5) / n) * Math.PI * 2;
  const radius = island.groundRadius * 0.38;
  return { x: island.centre.x + Math.cos(angle) * radius, y: island.centre.y + Math.sin(angle) * radius };
}

export function composePublicGroundScene(facts: PublicGroundFacts): SceneInput {
  const knownStories = new Set(facts.islands.map((island) => island.id));
  const capabilityOwners = new Map<string, string>();
  for (const island of facts.islands) for (const capability of island.capabilities) capabilityOwners.set(capability.id, island.id);

  const edgeKeys = new Set<string>();
  const edges: { from: string; to: string }[] = [];
  const addEdge = (from: string, to: string): void => {
    if (from === to || !knownStories.has(from) || !knownStories.has(to)) return;
    const key = `${from}\u0000${to}`;
    if (!edgeKeys.has(key)) {
      edgeKeys.add(key);
      edges.push({ from, to });
    }
  };
  for (const island of facts.islands) {
    for (const dependency of island.dependsOn) addEdge(dependency, island.id);
    for (const capability of island.capabilities) {
      for (const dependency of capability.dependsOn) {
        const owner = capabilityOwners.get(dependency);
        if (owner) addEdge(owner, island.id);
      }
    }
  }

  return {
    offset: { ...facts.offset },
    width: facts.width,
    height: facts.height,
    empties: [],
    relaxedCells: facts.islands.flatMap(cellsFor),
    drawTiles: [],
    wheatSets: [],
    cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG,
    trails: routeTrails(facts.islands.map((island) => ({ id: island.id, x: island.centre.x, y: island.centre.y, r: island.groundRadius })), edges, 'public-ground-scene'),
    territories: facts.islands.map((island) => ({
      id: island.id,
      status: island.status,
      caps: island.capabilities.length,
      centroid: { ...island.centre },
      groundRadius: island.groundRadius,
      screenRadius: island.groundRadius,
      treeSpot: { ...island.treeSpot },
      anchorSpace: 'ground' as const,
      labelY: island.labelY,
      coastGroundLoops: [coastFor(island)],
      decor: [],
      plants: [],
      parcels: island.capabilities.map((capability, index) => ({
        capId: capability.id,
        status: capability.status,
        ...(capability.testCount === undefined ? {} : { testCount: capability.testCount }),
        theme: THEMES[index % THEMES.length]!,
        seed: parcelSeed(island, index),
      })),
      treeTitle: island.treeTitle,
      ...(island.uatLegs?.length ? { uatCriteria: island.uatLegs.map((leg) => ({ id: leg.presentationKey, state: leg.state })) } : {}),
      wisps: [],
      claims: [],
      plate: { ...island.plate },
    })),
  };
}
