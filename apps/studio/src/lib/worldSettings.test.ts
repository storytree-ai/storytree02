// worldSettings is the SINGLE SOURCE OF TRUTH for the user-facing forest-map dials
// (the gear panel at #/tree) — the control schema AND the param↔URL binding. These
// tests pin the binding contract RED-FIRST so the panel and the TreeView readers can
// never drift: a control written to its DEFAULT must REMOVE its param (so the default
// world's URL stays clean / the world stays byte-identical), unrelated params survive,
// and the shareable URL puts params BEFORE the #hash. Pure string/URL math — no React,
// no DOM — so the suite runs in node env.
//
// ADR-0073 made roads the one world; ADR-0076 retired the river-trail ROUTING system
// (connections are now thin perimeter-docked lines with nothing to tune), so the
// road-routing dials are GONE. Layout (DAG vs solar) and Ground (tiling) outlived them in the
// picker, but ADR-0283 D2 and ADR-0233 have since retired those two as well — the surviving groups
// are Selection + Forest intro (ADR-0608 retired the Art style group with the sprite art sheets),
// which is what the group case below pins.
//
// ADR-0088 (Shared Islands panel, amends ADR-0076 §2): the building islands moved OFF the
// map into a permanent left panel, so the `buildingIsland` GEAR TOGGLE lost its meaning (the
// panel is permanent, not a flag) and was removed from the gear schema. ADR-0283 D2 then retired the
// Layout picker itself, and ADR-0608 the Art style dials, so the gear carries Selection + Forest
// intro and nothing else.

import { describe, it, expect } from 'vitest';
import * as worldSettings from './worldSettings.js';
import {
  CONTROLS,
  controlByKey,
  MANAGED_KEYS,
  setControlValue,
  readControlValue,
  resetControls,
  buildShareUrl,
  type ControlSpec,
  type NumberControl,
} from './worldSettings.js';

/** Pull a control spec by URL key, failing loudly if the schema dropped it. */
function ctl(key: string): ControlSpec {
  const c = controlByKey(key);
  if (!c) throw new Error(`no control for key ${key}`);
  return c;
}

describe('worldSettings — schema (docked-line roads, ADR-0076)', () => {
  it('exposes exactly the surviving dials, each with a key/label/group/kind/hint', () => {
    const keys = CONTROLS.map((c) => c.key);
    // The sprite-art-sheets `artStyle` select + its `artScale` size dial retired with the flat sprites
    // they re-skinned (ADR-0608: the mounted 3D land is the forest). The `layout` select went with
    // ADR-0283 D2 (owner-directed 2026-08-02): DAG rows are the ONE arrangement now, not the default
    // among three, so there is nothing to pick. The grounded-art `garden` / `cosy` toggles were retired by
    // ADR-0228, the `veg` vegetation-vocabulary toggle by ADR-0231, and the `substrate` "Ground tiling"
    // select by ADR-0233 (mesh is now the one tiling, not a dial). The `buildingIsland` toggle was
    // REMOVED with ADR-0088 (the shared-island panel is permanent, not a gear flag), so the gear carries
    // no Panels switch.
    // `selectionMotion` joins them (owner-directed 2026-07-27): selecting an island lights its
    // one-hop routes as two-lane hued lanes, and this dial is what MOVES when it does — draw +
    // pulse once (default), a looping march, or still. The lanes themselves are not optional.
    // `regrowSpeed` joins them (ADR-0286, owner-directed 2026-08-02): the Act 2 regrow now plays on
    // the first arrival at the map each browser session, and how fast it plays is the one piece of
    // that the URL carries. Its sibling — the "Regrow the forest" replay button — is an ACTION with
    // no URL state, so it is supplied to the panel by TreeView rather than declared here.
    const expected = ['selectionMotion', 'regrowSpeed'];
    expect([...keys].sort()).toEqual([...expected].sort());
    // The retired river/pond dials, road-routing dials, the removed building toggles
    // (building-DRAWER, then building-ISLAND), the retired grounded-art `garden` / `cosy` / `veg`
    // toggles AND the retired `substrate` ground-tiling select must be GONE (genuinely stripped, not
    // shelved — ADR-0073 / ADR-0076 / ADR-0088 / ADR-0228 / ADR-0231 / ADR-0233 / ADR-0283).
    for (const gone of [
      'layout',
      'roads',
      'roadStraighten',
      'bundleFar',
      'deltaPull',
      'riverRepel',
      'world',
      'deltaCone',
      'meanderAmp',
      'pondMouth',
      'weld',
      'buildingDrawer',
      'buildingIsland',
      'garden',
      'cosy',
      'veg',
      'substrate',
      'artStyle',
      'artScale',
    ]) {
      expect(keys, `retired control still present: ${gone}`).not.toContain(gone);
    }
    for (const c of CONTROLS) {
      expect(c.key.length).toBeGreaterThan(0);
      expect(c.label.length).toBeGreaterThan(0);
      expect(c.group.length).toBeGreaterThan(0);
      expect(['number', 'toggle', 'select']).toContain(c.kind);
      // Every control carries a visible plain-English description (a sub-label under the row).
      expect((c.hint ?? '').length, `control ${c.key} needs a hint`).toBeGreaterThan(0);
    }
  });

  it('groups controls under Selection + Forest intro (Layout, Panels, World art, Ground, Art style gone)', () => {
    const groups = new Set(CONTROLS.map((c) => c.group));
    // ADR-0283 D2 retired the `layout` select — the only Layout control — so the section goes too.
    expect(groups.has('Layout')).toBe(false);
    // The building-island toggle (the only Panels control) was removed — no Panels section.
    expect(groups.has('Panels')).toBe(false);
    // The "World art" section held only the `veg` toggle, retired by ADR-0231 (vegetation is now
    // permanent world art, not a dial), so the section is gone.
    expect(groups.has('World art')).toBe(false);
    // The "Ground" section held only the `substrate` tiling select, retired by ADR-0233 (mesh is the one
    // tiling, not a dial), so that section is gone too.
    expect(groups.has('Ground')).toBe(false);
    // The "Art style" section held only the sprite-sheet `artStyle` select + `artScale` dial, retired
    // by ADR-0608 with the flat sprites they re-skinned, so that section is gone too.
    expect(groups.has('Art style')).toBe(false);
    // the two-lane selection highlight's motion dial gets its own section
    expect(groups.has('Selection')).toBe(true);
    // ADR-0286: the Act 2 regrow's own section — the speed dial here, the replay ACTION folded in
    // by TreeView (a button is not URL state, so it is not in this schema).
    expect(groups.has('Forest intro')).toBe(true);
    expect(groups.size).toBe(2);
  });

  it('keys are unique', () => {
    const keys = CONTROLS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('worldSettings — the layout picker is RETIRED (ADR-0283 D2)', () => {
  // Rows were already the DEFAULT (ADR-0229, 2026-07-23, amending ADR-0171); what goes here is the
  // ALTERNATIVES. Every growth, arrival and pathway choreography now has exactly one arrangement to
  // be correct against, which is the point — an edge-driven regrow reads down a row layout as a
  // front, and scatters across the plane under stress-majorization placement.
  it('offers no layout control at all', () => {
    expect(controlByKey('layout')).toBeUndefined();
    expect(MANAGED_KEYS).not.toContain('layout');
  });

  it('leaves every former ?layout= value as an ordinary unmanaged param', () => {
    // Not honoured, not normalized, not stripped by reset — just inert, like `?nonsense=1`.
    for (const value of ['stress', 'solar', 'radial', 'stress-majorization', 'dag', 'whatever']) {
      expect(resetControls(`?layout=${value}`)).toBe(`?layout=${value}`);
    }
  });
});

// ADR-0233 retired the `substrate` "Ground tiling" select: mesh is the one and only tiling, no longer a
// dial. The former "substrate control (select)" suite is gone; the schema test above pins `substrate` as
// a RETIRED key. Select-control binding (default removes the param, unrelated params preserved) stays
// covered by the selectionMotion suite below.

describe('worldSettings — buildShareUrl puts params BEFORE the hash', () => {
  it('orders ?…params before the #/tree hash', () => {
    const url = buildShareUrl('https://x.test/', '?selectionMotion=march', '#/tree');
    expect(url).toBe('https://x.test/?selectionMotion=march#/tree');
  });

  it('omits the ? when there are no params', () => {
    expect(buildShareUrl('https://x.test/', '', '#/tree')).toBe('https://x.test/#/tree');
  });

  it('keeps a focused deep-link hash intact', () => {
    const url = buildShareUrl('https://x.test/', '?selectionMotion=march', '#/tree/some-story');
    expect(url).toBe('https://x.test/?selectionMotion=march#/tree/some-story');
  });
});

describe('worldSettings — resetControls drops every managed param', () => {
  it('returns empty when only managed params were present', () => {
    expect(resetControls('?selectionMotion=march&regrowSpeed=1.5')).toBe('');
  });

  it('preserves unmanaged params', () => {
    const out = resetControls('?selectionMotion=off&debug=1');
    expect(out).not.toContain('selectionMotion');
    expect(out).toContain('debug=1');
  });
});

describe('worldSettings — the ?render escape hatch is RETIRED (ADR-0608)', () => {
  // The `?render=legacy` / `?render=inline` hatch fell back to the flat inline forest picture, which
  // ADR-0608 retired with the flat look: the scene-graph mapper is the map's only interaction layer.
  it('exports no render-mode reader any more', () => {
    expect((worldSettings as Record<string, unknown>).readRenderScene).toBeUndefined();
    expect(MANAGED_KEYS).not.toContain('render');
  });

  it('leaves every former ?render= value as an ordinary unmanaged param', () => {
    for (const value of ['legacy', 'inline', 'scene', 'wat']) {
      expect(resetControls(`?render=${value}`)).toBe(`?render=${value}`);
    }
  });
});

// ADR-0231 retired the `veg` gear toggle and `readVegetationVocab`: the vegetation vocabulary
// (ADR-0226) is now PERMANENT studio world art, always composed — there is no dial to bind, so the
// former "vegetation-vocabulary gear TOGGLE" + "readVegetationVocab" suites are gone. The schema test
// above pins `veg` as a RETIRED key so a re-introduction is caught red.

describe('worldSettings — the sprite art-sheet dials are RETIRED (ADR-0608)', () => {
  // `artStyle` re-skinned the flat forest picture from a sprite sheet and `artScale` sized those
  // sprites; both went with the flat look they dressed.
  it('offers no artStyle or artScale control at all', () => {
    for (const key of ['artStyle', 'artScale']) {
      expect(controlByKey(key)).toBeUndefined();
      expect(MANAGED_KEYS).not.toContain(key);
    }
  });

  it('leaves every former ?artStyle= / ?artScale= value as an ordinary unmanaged param', () => {
    for (const value of ['storybook', 'daylight', 'watercolor', 'vector']) {
      expect(resetControls(`?artStyle=${value}`)).toBe(`?artStyle=${value}`);
    }
    expect(resetControls('?artScale=1.5')).toBe('?artScale=1.5');
  });
});

describe('worldSettings — selectionMotion (the two-lane highlight`s motion)', () => {
  const CTL = controlByKey('selectionMotion')!;

  it('defaults to the one-shot draw + pulse, and writes NO param for it', () => {
    expect(readControlValue('', CTL)).toBe('draw');
    expect(readControlValue('?selectionMotion=draw', CTL)).toBe('draw');
    // the default option is the param's ABSENCE, so an untouched world's URL stays clean
    expect(setControlValue('?selectionMotion=march', CTL, 'draw')).toBe('');
  });

  it('preserves UNRELATED params when setting the default', () => {
    const out = setControlValue('?selectionMotion=march&debug=1', CTL, 'draw');
    expect(out).toContain('debug=1');
    expect(out).not.toContain('selectionMotion');
  });

  it('reads the looping march and the still state, and round-trips them through the URL', () => {
    expect(readControlValue('?selectionMotion=march', CTL)).toBe('march');
    expect(readControlValue('?selectionMotion=off', CTL)).toBe('off');
    expect(setControlValue('', CTL, 'march')).toBe('?selectionMotion=march');
    expect(setControlValue('', CTL, 'off')).toBe('?selectionMotion=off');
  });

  it('folds the still-spellings together and fails SAFE to the default on anything unknown', () => {
    for (const off of ['off', 'none', 'still']) {
      expect(readControlValue(`?selectionMotion=${off}`, CTL)).toBe('off');
    }
    // a stale or hand-typed value can never leave the map in an undefined motion state
    for (const junk of ['', 'sparkle', 'DRAW', '1']) {
      expect(readControlValue(`?selectionMotion=${junk}`, CTL)).toBe('draw');
    }
  });
});

// ── ADR-0286: the Act 2 regrow's speed dial ──
//
// `1` is the plan's OWN duration — the pace that falls out of the routed pathway geometry (measured
// 6.8 s on the current forest since ADR-0285 removed the ordering clamp). The owner watched that and
// called it too fast, so ADR-0286 shipped 0.6x; they then watched THAT and took it to the dial's
// FLOOR (2026-08-03: "I think we down the speed to 0.25, the lowest setting"). So the DEFAULT is
// deliberately not 1, and the clean, param-free URL is the slowest one — which is the point.
describe('worldSettings — regrowSpeed dial (Act 2 regrow pace, ADR-0286)', () => {
  it('defaults to the owner-chosen 0.25x, and writing that default keeps the URL clean', () => {
    expect(readControlValue('', ctl('regrowSpeed'))).toBe(0.25);
    expect(setControlValue('?regrowSpeed=1.5', ctl('regrowSpeed'), 0.25)).toBe('');
  });

  it('sits ON the slider floor — the dial only opens upward', () => {
    // Owner-directed and deliberate (ADR-0286 D4 as amended 2026-08-03): they asked for the slowest
    // the control offers. Pinned so a later "tidy the default off the boundary" edit has to argue
    // with the decision rather than quietly re-centre it.
    const c = ctl('regrowSpeed') as NumberControl;
    expect(c.default).toBe(c.min);
    expect(c.default).toBeLessThan(c.max);
  });

  it('reads a written value back, and falls to the default on nonsense', () => {
    expect(readControlValue('?regrowSpeed=1.5', ctl('regrowSpeed'))).toBe(1.5);
    expect(readControlValue('?regrowSpeed=wat', ctl('regrowSpeed'))).toBe(0.25);
  });

  it('never resolves to a speed that would stall the cursor', () => {
    // A zero or negative rate would freeze the regrow on frame one (or run it backwards), so the
    // parser's clamp — not just the slider's UI bounds — has to hold the floor. `clampMin` is
    // deliberately BELOW `min`: the slider cannot reach 0.05, but a hand-written URL can, and the
    // parser is what stops it being 0.
    expect(readControlValue('?regrowSpeed=0', ctl('regrowSpeed'))).toBe(0.05);
    expect(readControlValue('?regrowSpeed=-4', ctl('regrowSpeed'))).toBe(0.05);
    expect(readControlValue('?regrowSpeed=999', ctl('regrowSpeed'))).toBe(10);
  });

  it('round-trips a non-default value into the URL', () => {
    expect(setControlValue('', ctl('regrowSpeed'), 1.25)).toBe('?regrowSpeed=1.25');
    expect(readControlValue(setControlValue('', ctl('regrowSpeed'), 1.25), ctl('regrowSpeed'))).toBe(1.25);
  });
});
