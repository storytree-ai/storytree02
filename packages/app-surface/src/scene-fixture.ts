// scene-fixture — the SHARED render-test fixture for the studio mapper, whose DEFAULT is the input
// set the SHIPPED STUDIO MAP actually sends (`render-fixtures-default-to-the-shipped-map`).
//
// This is the app-surface half of the inversion. `packages/forest-world/src/scene-fixture.ts` owns
// the SCENE-INPUT seam (`SceneInput` / `SceneTerritoryInput`); this module owns the RENDER-CTX seam
// (`SceneCtx`) plus the parcel fold a scene input built HERE needs. Deliberately per-package rather
// than one published fixture module: forest-world exports only `.` and a shared test fixture crossing
// that boundary would be a package-contract change, i.e. an ADR question the increment fences off.
//
// Since ADR-0608 the mapper is the map's INTERACTION layer only — the sprite sheet this fixture used
// to default in went with the flat picture it re-skinned, so the ctx default is simply the minimum a
// mapper test needs. The parcel fold stays: the shipped map's per-capability ground groups are the
// capability hit geometry this layer still draws.

import type { ScenePlantInput, SceneParcelInput, SceneTerritoryInput, SurfaceTheme } from '@storytree/forest-world';
import type { SceneCtx } from './SceneView.js';

// ---------- the scene-input seam: the shipped map's parcel fold ----------

const PARCEL_THEMES: readonly SurfaceTheme[] = ['meadow', 'woodland', 'heath'];

/** ONE parcel per capability, seeded at that capability's own layout position and tinted by ITS
 *  status — mirroring the studio's `TreeView.capToParcel`. Derived from `plants` because that is the
 *  same array the studio derives both from, so a capless island stays parcels-ABSENT exactly as it
 *  does on the real map. */
export function shippedParcels(plants: readonly ScenePlantInput[]): SceneParcelInput[] {
  return plants.map((p, i) => ({
    capId: p.id,
    status: p.status,
    testCount: 4,
    theme: PARCEL_THEMES[i % PARCEL_THEMES.length]!,
    seed: { x: p.x, y: p.y },
  }));
}

/** A territory with the `parcels` the shipped map sends. `decor`/`plants` stay populated on purpose —
 *  the core RETIRES both for a parcels-present island, so keeping them proves the retirement instead
 *  of hiding behind empty arrays. */
export function shippedTerritory(t: SceneTerritoryInput): SceneTerritoryInput {
  const parcels = shippedParcels(t.plants);
  return parcels.length ? { ...t, parcels } : t;
}

// ---------- the render-ctx seam ----------

/**
 * A render ctx shaped like the shipped map's: everything else is the minimum a mapper test needs;
 * pass spies through `over` where a test asserts on them.
 */
export function shippedCtx(over: Partial<SceneCtx> = {}): SceneCtx {
  return {
    territoryClassById: (_id, status) => `hex-territory st-${status}`,
    hidden: new Set(),
    onSelectStory: () => {},
    onSelectCap: () => {},
    ...over,
  };
}
