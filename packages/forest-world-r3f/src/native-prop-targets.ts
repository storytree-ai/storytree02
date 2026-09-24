// native-prop-targets.ts — the native plants' click targets, in the host's drawing space, in the
// order the host must paint them.
//
// ⚠ THE CANVAS SUPPLIES DATA, NEVER A PICKER. The mounted canvas is inert (`pointer-events: none`,
// `aria-hidden`); the host keeps the one picking authority — its SVG, its coordinate hit-test and
// its select route. This module only answers "where does each native plant stand on the host's
// drawing, and which one is in front", from the SAME placement list the props are drawn from, so a
// target cannot drift from the plant it stands for.
//
// ⚠ BACK TO FRONT. SVG paints in DOM order, and a coordinate hit-test returns the TOPMOST element,
// so a plant nearer the viewer (a larger projected root y) must come LATER. A crown rising over the
// root of a plant behind it then wins that pixel, exactly as its picture does.

import type { GroundInput } from './ground-dependency.js';
import type { KitPlacement } from './kit-vocabulary.js';
import { deriveNativePropHitRecords } from './native-prop-hit-records.js';
import { projectNativePropHitEnvelope, type NativePropHitEnvelope } from './native-prop-hit-projection.js';

/**
 * Every attributed native plant (capability tree, dead tree, coverage plant) as a projected hit
 * envelope, sorted back to front. A placement with no island or no folded status yields nothing —
 * a target is never guessed.
 */
export function nativePropTargets(
  ground: GroundInput,
  foldedStatusByIslandCapability: ReadonlyMap<string, string>,
  elevationDeg: number,
): readonly NativePropHitEnvelope[] {
  const statusByPlacement = new Map<KitPlacement, string>();
  for (const placement of ground.placements) {
    const island = ground.islandByPlacement.get(placement);
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — an island-less placement is dropped again by `deriveNativePropHitRecords`, which refuses any placement with no island; this guard only keeps an `undefined::<cap>` key from ever being looked up.
    if (island === undefined) continue;
    const status = foldedStatusByIslandCapability.get(`${island}::${placement.capId}`);
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — a status-less placement is dropped again by `deriveNativePropHitRecords`, which refuses an undefined status; this guard keeps the map's value type honest.
    if (status !== undefined) statusByPlacement.set(placement, status);
  }
  const records = deriveNativePropHitRecords(ground, statusByPlacement);
  const envelopes = records.map((record) => projectNativePropHitEnvelope(record, elevationDeg));
  // A stable sort: equal depths keep placement order, so the paint order is deterministic.
  return Object.freeze([...envelopes].sort((a, b) => a.root.y - b.root.y));
}
