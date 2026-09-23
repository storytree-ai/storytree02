// spacing — ADR-0521: the packer's three by-eye gaps are a fraction of island size. These pin
// the RULE (one ratio, three readings) and the ladder's shape; whether a rung LOOKS right is the
// owner's, off the rendered sheet, never a test's.
//
// Moved here with the module it tests (`the-packing-moves-to-its-own-package`, ADR-0537 D1) —
// it was `apps/studio/src/lib/islandSpacing.test.ts`, and its assertions are unchanged. Only the
// runner changed: this package tests through `node:test` like its `@storytree/forest-world`
// neighbour, where the studio's suites run under vitest.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ISLAND_SPACING_RATIO,
  ISLAND_SPACING_RUNGS,
  PRE_ADR0521_SPACING,
  SPACING_CONTROL_ARM,
  gapBetween,
  inRowGapWithChrome,
  loneSwing,
  rankGapWithChrome,
  spacingArmId,
} from './spacing.js';

test('the gap scales linearly with the ratio and with the MEAN of the two radii', () => {
  assert.equal(gapBetween(100, 100, 0.5), 50);
  assert.equal(gapBetween(80, 120, 0.5), 50);
  assert.equal(gapBetween(100, 100, 0.25), 25);
  assert.equal(gapBetween(100, 100, 0), 0);
});

test('a lone island swings by its own radius PLUS the gap a same-size neighbour would get — no second constant', () => {
  assert.equal(loneSwing(100, 0.5), 100 + gapBetween(100, 100, 0.5));
  assert.equal(loneSwing(77, 0), 77);
});

test('the ladder descends to the hex floor (rung 0), carries the shipped pick, and the pick is a rung', () => {
  for (let i = 1; i < ISLAND_SPACING_RUNGS.length; i += 1) {
    assert.ok((ISLAND_SPACING_RUNGS[i] ?? NaN) < (ISLAND_SPACING_RUNGS[i - 1] ?? NaN));
  }
  assert.equal(ISLAND_SPACING_RUNGS.at(-1), 0);
  assert.ok(ISLAND_SPACING_RUNGS.includes(ISLAND_SPACING_RATIO));
  assert.ok(ISLAND_SPACING_RATIO >= 0);
});

test('the pre-ADR-0521 gaps are typed as history and frozen — the control arm stands on exactly these', () => {
  assert.deepEqual({ ...PRE_ADR0521_SPACING }, { rankGap: 40, islandGap: 60, rankSwing: 140 });
  assert.ok(Object.isFrozen(PRE_ADR0521_SPACING));
});

test('arm ids: the control is literally `today` (the harness page reads the same word off the manifest), then one per rung, distinct', () => {
  assert.equal(SPACING_CONTROL_ARM, 'today');
  const ids = [SPACING_CONTROL_ARM, ...ISLAND_SPACING_RUNGS.map((r) => spacingArmId(r))];
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(spacingArmId(0.2), 'spacing-0.2');
});

// ---------------------------------------------------------------------------------------------
// THE CHROME CLEARANCE (ADR-0598 D2) — a fixed-size nameplate needs an absolute floor, because a
// proportional gap shrinks with the island and the plate does not.
// ---------------------------------------------------------------------------------------------

test('the rank gap is a FLOOR, not a target — the ratio wins whenever it already asks for more', () => {
  // Small islands: the ratio's gap is a fraction of a small radius, the band is what stands.
  assert.equal(rankGapWithChrome(20, 20, 0.1, 50), 50);
  // Big islands: the ratio asks for 100, which already clears the band, so the band adds nothing.
  assert.equal(rankGapWithChrome(1000, 1000, 0.1, 50), 100);
  // Exactly at the crossing the two agree, so neither branch can be told from the other there —
  // which is why the two assertions above are on either side of it rather than at it.
  assert.equal(rankGapWithChrome(500, 500, 0.1, 50), 50);
  // No band ⇒ the pre-ADR-0598 rule, unchanged.
  assert.equal(rankGapWithChrome(80, 120, 0.5, 0), gapBetween(80, 120, 0.5));
});

test('the in-row gap is SELF-LIMITING — an island wider than its own plate asks for nothing extra', () => {
  // Two small islands (radius 10) whose plates are 40 wide each: the centres must be 80 apart, of
  // which 20 is island, so the gap carries the other 60.
  assert.equal(inRowGapWithChrome(10, 10, 0, 40, 40), 60);
  // The same two plates between two BIG islands: the islands already span more than the plates do,
  // so the shortfall is negative and the ratio's gap is what stands. This is the clause that stops
  // the clearance inflating a map of large islands it was never about.
  assert.equal(inRowGapWithChrome(100, 100, 0.1, 40, 40), gapBetween(100, 100, 0.1));
  assert.ok(inRowGapWithChrome(100, 100, 0, 40, 40) >= 0, 'never negative');
  // And it is the PAIR's own plates, not a global one — a long id on one side alone widens the gap.
  assert.ok(inRowGapWithChrome(10, 10, 0, 90, 40) > inRowGapWithChrome(10, 10, 0, 40, 40));
});
