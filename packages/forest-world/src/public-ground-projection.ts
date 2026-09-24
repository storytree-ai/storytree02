import { LAND_CAMERA_ELEVATION_DEG, groundFlattening, projectGround } from './camera.js';
import type { SceneInput, SceneTerritoryInput } from './scene.js';
import { projectTrailNetwork } from './routing.js';

/**
 * Re-express a public scene plan at the land camera.  Terrain and routes are
 * screen geometry, while territory anchors and coast loops remain ground data
 * for `buildScene` to project exactly once at its normalisation boundary.
 */
export function projectPublicGroundScene(plan: SceneInput): SceneInput {
  const elevationDeg = LAND_CAMERA_ELEVATION_DEG;
  const flattening = groundFlattening(elevationDeg);
  const project = (point: { x: number; y: number }) => projectGround(point, elevationDeg);

  const territories: SceneTerritoryInput[] = plan.territories.map((territory) => ({
    ...territory,
    screenRadius: territory.groundRadius * flattening,
    anchorSpace: 'ground',
  }));

  return {
    ...plan,
    offset: project(plan.offset),
    height: plan.height * flattening,
    relaxedCells: plan.relaxedCells?.map((cell) => ({
      ...cell,
      poly: cell.poly.map(project),
    })) ?? null,
    trails: projectTrailNetwork(
      plan.trails,
      plan.territories.map(({ id, centroid, groundRadius }) => ({
        id,
        x: centroid.x,
        y: centroid.y,
        r: groundRadius,
      })),
      elevationDeg,
    ),
    territories,
    cameraElevationDeg: elevationDeg,
  };
}
