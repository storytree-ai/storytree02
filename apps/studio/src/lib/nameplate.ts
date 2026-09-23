// nameplate.ts — THE MAP'S OWN CHROME, and the ground it needs (ADR-0598 D2).
//
// `nameplateLayout` lived in `TreeView.tsx` until this landing and is unchanged; it moved here so
// the packer's chrome clearance can be derived from the SAME function the plate is drawn from,
// without a Node-side instrument having to import a React module to do it. `TreeView.tsx`
// re-exports it, so every existing importer reads exactly as it did.
//
// ⚠ THE CLEARANCE BELOW IS WHY THIS FILE IS NOT JUST A MOVE. `@storytree/forest-layout` is
// chrome-free by construction — it knows what a story must expose to be LAID OUT and nothing about
// how one is DRAWN — so the layout cannot work out for itself how much room a nameplate needs. It
// takes the answer as ground distances, and this is where the studio works them out.

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLATE_SCALE,
  TILE_DEPTH,
  tileUnits,
  unprojectGround,
} from '@storytree/forest-world';
import type { ChromeClearance } from '@storytree/forest-layout';

/** A nameplate's resolved box + text/glyph anchors (px, plate-local). */
export interface NameplateLayout {
  /** Plate width. */
  w: number;
  /** Plate height. */
  h: number;
  /** Corner radius. */
  rx: number;
  /** Baseline y of the id (the bigger top line). */
  idY: number;
  /** Baseline y of the sub line. */
  subY: number;
  /** Leading bookshelf-glyph anchor (building plates only; ignored otherwise). */
  glyphX: number;
  glyphY: number;
  glyphScale: number;
}

/**
 * Nameplate geometry (owner ask 2026-06-22 — bigger name cards + bigger leading bookshelf).
 * A pure function of the id length and the building flag, so the box and its anchors are
 * unit-testable (Stage-1 of ADR-0070; the final look is owner-attested). Two sizes:
 *   • NORMAL — a modest global bump over the old 30px plate (height 33, id ~12px), leaving the
 *     positioning geometry (still centred on the centroid, drawn below the island) unchanged.
 *   • BUILDING — a distinctly larger landmark card (taller, wider min, larger id) with a big
 *     leading bookshelf glyph, so the root library reads as a landmark on the foundation row.
 * Building plates reserve a left gutter for the glyph and widen to keep the centred id clear
 * of it.
 */
export function nameplateLayout(idLen: number, building: boolean): NameplateLayout {
  if (building) {
    const glyphGutter = 30; // left band the enlarged bookshelf occupies
    const w = Math.max(132, idLen * 8.6 + 36 + glyphGutter);
    const h = 42;
    return {
      w,
      h,
      rx: 9,
      idY: 18,
      subY: 32,
      glyphX: 16,
      glyphY: h - 6,
      glyphScale: 0.92,
    };
  }
  const w = Math.max(100, idLen * 7.4 + 30);
  const h = 33;
  return { w, h, rx: 7, idY: 14, subY: 27, glyphX: 0, glyphY: 0, glyphScale: 1 };
}

/**
 * THE GROUND A PLATE OCCUPIES BELOW ITS ISLAND, in ground units — the packer's `chrome.rowBand`.
 *
 * The plate is anchored at `Territory.labelY`, which `packWorld` already sets a fixed drop below the
 * island's southern tile edge (`TILE_DEPTH + tileUnits(8)`), and it is drawn in its own frame scaled
 * by {@link PLATE_SCALE}. So the SCREEN band a plate claims below the tiles is that drop plus its
 * scaled height, and the GROUND that band costs is the band un-projected at the camera.
 *
 * ⚠ THE CAMERA HERE IS THE DECLARED ONE AND NEVER THE REQUESTED ONE, and that is the whole
 * invariant. A plate is fixed-size SCREEN chrome, so the ground it needs genuinely does depend on
 * the camera — the one dependency `packWorld` is forbidden to have (ADR-0527 D1 / ADR-0546 D1: the
 * layout is re-projected, never re-decided). Taking it at {@link LAND_CAMERA_ELEVATION_DEG} rather
 * than at whatever `?elevation=` arm is being drawn is what keeps that true: the map rendered at
 * another camera is the SAME layout seen differently, not a different one. If the declared camera
 * ever moves, this clearance re-derives with it — deliberately, and in one place.
 */
export function nameplateRowBand(): number {
  const screenBand = TILE_DEPTH + tileUnits(8) + nameplateLayout(0, false).h * PLATE_SCALE;
  return unprojectGround({ x: 0, y: screenBand }, LAND_CAMERA_ELEVATION_DEG).y;
}

/**
 * THE GROUND HALF-WIDTH OF EACH STORY'S PLATE — the packer's `chrome.plateHalfWidth`.
 *
 * No un-projection here, and that asymmetry is real rather than an oversight: the land camera
 * foreshortens the DEPTH axis only (`unprojectGround` divides y and leaves x alone), so a plate's
 * width costs exactly as much ground as it does screen. It is wider than it is deep by a long way —
 * a 100 px minimum plate is ~41 ground units across where the band above is ~22 deep — which is why
 * the two readings are separate numbers rather than one clearance.
 */
export function nameplateHalfWidths(storyIds: readonly string[]): ReadonlyMap<string, number> {
  return new Map(storyIds.map((id) => [id, (nameplateLayout(id.length, false).w * PLATE_SCALE) / 2]));
}

/** The whole clearance the map hands `packWorld`, at an optional scale-back rung (ADR-0503). */
export function mapChromeClearance(storyIds: readonly string[], scale?: number): ChromeClearance {
  const clearance: { rowBand: number; plateHalfWidth: ReadonlyMap<string, number>; scale?: number } = {
    rowBand: nameplateRowBand(),
    plateHalfWidth: nameplateHalfWidths(storyIds),
  };
  // By statement, not a spread: under `exactOptionalPropertyTypes` an absent key and one
  // present-and-undefined are different inputs, and only the absent one leaves the packer on its
  // own default of 1.
  if (scale !== undefined) clearance.scale = scale;
  return clearance;
}
