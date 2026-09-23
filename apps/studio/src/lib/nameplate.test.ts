// nameplate — the map's own chrome, and the GROUND it needs (ADR-0598 D2).
//
// ⚠ THIS FILE EXISTS BECAUSE THE MUTATION RUNG ASKED FOR IT. `nameplateLayout` moved here out of
// `TreeView.tsx` and kept the coverage it had there through the re-export — but `check:mutation-diff`
// reported nine of its lines with NO COVERAGE, because the rung witnesses a source file by the tests
// written against IT, and there were none. A function whose only tests reach it through another
// module's re-export is one the rung cannot score, and that is not the same as an untested one — it
// is worse, because it reads as covered everywhere else.

import { describe, expect, it } from 'vitest';

import {
  LAND_CAMERA_ELEVATION_DEG,
  PLATE_SCALE,
  TILE_DEPTH,
  tileUnits,
  unprojectGround,
} from '@storytree/forest-world';

import { mapChromeClearance, nameplateHalfWidths, nameplateLayout, nameplateRowBand } from './nameplate.js';

describe('nameplateLayout — the plate box the map draws', () => {
  it('has TWO sizes and the building one is the larger landmark card', () => {
    const normal = nameplateLayout(7, false);
    const building = nameplateLayout(7, true);
    expect(building.h).toBeGreaterThan(normal.h);
    expect(building.w).toBeGreaterThan(normal.w);
    // The building card reserves a left gutter for the bookshelf; the normal one draws no glyph.
    expect(building.glyphScale).toBeLessThan(1);
    expect(normal.glyphX).toBe(0);
    expect(normal.glyphY).toBe(0);
    expect(normal.glyphScale).toBe(1);
  });

  it('widens with the id, from a MINIMUM — both halves, since only a long id leaves the floor', () => {
    // Short ids sit on the floor, so every assertion about growth must use an id long enough to
    // leave it — measured: the normal plate's floor of 100 holds until about ten characters.
    expect(nameplateLayout(1, false).w).toBe(nameplateLayout(9, false).w);
    expect(nameplateLayout(40, false).w).toBeGreaterThan(nameplateLayout(20, false).w);
    expect(nameplateLayout(1, true).w).toBe(nameplateLayout(7, true).w);
    expect(nameplateLayout(40, true).w).toBeGreaterThan(nameplateLayout(20, true).w);
    // …and the growth is per character and POSITIVE, which is what separates `+ 30` from `- 30`.
    const step = nameplateLayout(41, false).w - nameplateLayout(40, false).w;
    expect(step).toBeCloseTo(7.4, 10);
    expect(nameplateLayout(40, false).w).toBeCloseTo(40 * 7.4 + 30, 10);
    expect(nameplateLayout(40, true).w).toBeCloseTo(40 * 8.6 + 36 + 30, 10);
  });

  it('seats its text inside the box it declares', () => {
    for (const building of [false, true]) {
      const p = nameplateLayout(12, building);
      expect(p.idY).toBeGreaterThan(0);
      expect(p.subY).toBeGreaterThan(p.idY);
      expect(p.subY).toBeLessThanOrEqual(p.h);
      expect(p.rx).toBeGreaterThan(0);
    }
    // The building glyph sits just above the card's bottom, never below it.
    const b = nameplateLayout(12, true);
    expect(b.glyphY).toBeLessThan(b.h);
    expect(b.glyphY).toBeGreaterThan(0);
  });
});

describe('the clearance the packer is handed', () => {
  it('the row band is the drawn plate un-projected at the DECLARED camera', () => {
    // Derived here from the same three pieces the packer's own `labelY` is built from, so the two
    // cannot drift: the tile extrusion, the authored drop, and the plate at its drawing scale.
    const screenBand = TILE_DEPTH + tileUnits(8) + nameplateLayout(0, false).h * PLATE_SCALE;
    expect(nameplateRowBand()).toBeCloseTo(
      unprojectGround({ x: 0, y: screenBand }, LAND_CAMERA_ELEVATION_DEG).y,
      12,
    );
    // ⚠ AND IT IS BIGGER THAN THE SCREEN BAND, not equal to it. The land camera foreshortens the
    // depth axis, so a plate that is N pixels deep costs MORE than N units of ground — which is the
    // whole reason this conversion exists rather than the pixel number being handed over raw.
    expect(nameplateRowBand()).toBeGreaterThan(screenBand);
  });

  it('half-widths are NOT un-projected — the camera only ever touches depth', () => {
    const ids = ['a', 'a-much-longer-story-id-than-that'];
    const widths = nameplateHalfWidths(ids);
    expect(widths.size).toBe(2);
    for (const id of ids) {
      expect(widths.get(id)).toBeCloseTo((nameplateLayout(id.length, false).w * PLATE_SCALE) / 2, 12);
    }
    // The long id's plate is wider, and a plate is wider than it is deep by a long way — which is
    // why the two readings are separate numbers rather than one clearance.
    expect(widths.get(ids[1]!)!).toBeGreaterThan(widths.get(ids[0]!)!);
    expect(widths.get(ids[0]!)!).toBeGreaterThan(nameplateRowBand() / 2);
  });

  it('the scale-back dial is ABSENT by default and passed through when given', () => {
    // Under `exactOptionalPropertyTypes` an absent key and a present-and-undefined one are different
    // inputs, and only the absent one leaves the packer on its own default of 1.
    expect('scale' in mapChromeClearance(['a'])).toBe(false);
    expect(mapChromeClearance(['a'], 0).scale).toBe(0);
    expect(mapChromeClearance(['a'], 1.5).scale).toBe(1.5);
  });

  it('covers exactly the ids it was given, and no others', () => {
    const c = mapChromeClearance(['one', 'two']);
    expect([...c.plateHalfWidth.keys()].sort()).toEqual(['one', 'two']);
    expect(c.plateHalfWidth.get('three')).toBeUndefined();
    expect(mapChromeClearance([]).plateHalfWidth.size).toBe(0);
    // An empty corpus still declares a row band: the band is a property of the plate, not of who is
    // on the map.
    expect(mapChromeClearance([]).rowBand).toBe(nameplateRowBand());
  });
});
