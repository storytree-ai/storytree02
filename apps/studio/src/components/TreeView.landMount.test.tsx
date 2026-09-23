// @vitest-environment jsdom
//
// TreeView.landMount.test.tsx — `?landMount=1` puts the 3D land UNDER the working map, and the map
// keeps everything it had.
//
// ⚠⚠ THIS SUITE IS THE Z-ORDER SETTLEMENT, IN ASSERTIONS. "On the land" was undefined above a
// canvas, and the answer this increment takes is structural rather than configured: the land layer
// is the FIRST child of `.world-pan-layer` and the `<svg>` follows it, nothing in that stack sets a
// `z-index`, so paint order is DOM order and every mark the map draws is above the land
// unconditionally. That is only true while the ORDERING is true, so the ordering is what is
// asserted — not a z-index, which would be a second rule able to disagree with the first.
//
// ⚠ AND THE SECOND HALF IS THAT THE MAP IS NOT TOUCHED. A mount that quietly cost the map its
// keyboard camera, its accessible name or its hit targets would satisfy "the land is mounted" and
// fail the increment. Each is asserted against the SAME assertion in the flag-off arm, so a
// regression shows up as a difference between the two arms rather than as a number someone has to
// recognise.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, cleanup } from '@testing-library/react';

import { AppDataContext, type AppData } from '../lib/appData';
import { HttpDouble, installHttpDouble } from '../test/httpDouble';
import { TreeView } from './TreeView';

const TREE_PAYLOAD = {
  stories: [
    {
      id: 'studio',
      title: 'Studio',
      outcome: 'the studio serves',
      status: 'healthy',
      proofMode: 'UAT',
      uatWitness: 'machine',
      dependsOn: [],
      consumedBy: [],
      capabilities: [
        {
          id: 'studio-map',
          title: 'The map',
          outcome: 'the map draws',
          status: 'healthy',
          proofMode: 'integration-test',
          dependsOn: [],
          contracts: [],
        },
      ],
    },
  ],
};

let http: HttpDouble;

beforeEach(() => {
  http = installHttpDouble();
  http.get('/api/tree', () => TREE_PAYLOAD);
  http.get('/api/activity', () => ({ builds: null, claims: null }));
});

afterEach(() => {
  cleanup();
  http.uninstall();
  window.history.replaceState(null, '', '/');
});

const appData: AppData = {
  docs: [],
  docIds: new Set(),
  docTitles: new Map(),
  docsStatus: 'ready',
  docsError: '',
  assets: [],
  assetsStatus: 'ready',
  assetsError: '',
  me: { email: 'owner@example.com', role: 'admin', status: 'active', member: true },
  refreshAssets: async () => {},
};

async function renderTreeAt(search: string): Promise<HTMLElement> {
  window.history.replaceState(null, '', `/${search}`);
  const { container } = render(
    <AppDataContext.Provider value={appData}>
      <TreeView focus={null} />
    </AppDataContext.Provider>,
  );
  await act(async () => {});
  return container;
}

describe('the land under the working map', () => {
  it('is ABSENT by default — the map route is the one that shipped', async () => {
    const container = await renderTreeAt('');
    expect(container.querySelector('[data-testid="land-mount"]')).toBeNull();
    const pan = container.querySelector('.world-pan-layer')!;
    expect(pan.classList.contains('has-land-mount')).toBe(false);
    // ⚠ The SVG is still the pan layer's FIRST child when the flag is off — so the closed state is
    // pinned as hard as the open one, and "the land layer went in" is a visible difference.
    expect(pan.firstElementChild!.tagName.toLowerCase()).toBe('svg');
  });

  it('does not open on a near miss, so the renderer chunk is never fetched by accident', async () => {
    for (const miss of ['?landMount=0', '?landmount=1', '?landMount=', '?landView=1']) {
      const container = await renderTreeAt(miss);
      expect(container.querySelector('[data-testid="land-mount"]')).toBeNull();
      cleanup();
    }
  });

  it('mounts INSIDE the pan layer and BEFORE the SVG — which is the whole z-order settlement', async () => {
    const container = await renderTreeAt('?landMount=1');
    const pan = container.querySelector('.world-pan-layer')!;
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    const svg = container.querySelector('svg.world-scene')!;

    // INSIDE the pan layer: that is what makes it inherit the drag transform (ADR-0272 D2) and move
    // with the labels through a gesture with neither layer re-rasterising. A canvas mounted as a
    // sibling of the pan layer would look identical at rest and drift on every drag.
    expect(layer.parentElement).toBe(pan);
    expect(svg.parentElement).toBe(pan);

    // BEFORE the SVG: the land paints under every mark the map draws.
    expect(pan.firstElementChild).toBe(layer);
    expect(layer.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(pan.classList.contains('has-land-mount')).toBe(true);
  });

  it('suppresses the ground LAYERS the stylesheet names, and nothing above them', async () => {
    // ⚠⚠ THIS TEST EXISTS BECAUSE THE FIRST CUT OF THE RULE MATCHED NOTHING. It named
    // `.coast-fill-group` / `.relaxed-tile` — real classes, wrong grain (they are the per-island
    // groups inside these layers). So the tie between the STYLESHEET and the DOM is asserted
    // directly: every class the suppression rule names must be a class this map actually renders.
    const container = await renderTreeAt('?landMount=1');
    const svg = container.querySelector('svg.world-scene')!;
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const rule = /\.world-pan-layer\.has-land-mount[^{]*\{[^}]*\}/.exec(css)![0];
    const named = [...rule.matchAll(/\.has-land-mount\s+\.([a-z-]+)/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    for (const cls of named) {
      expect(svg.querySelector(`.${cls}`), `the rule names .${cls}; the map must draw it`).toBeTruthy();
    }
    // And it must not reach the flora layer, which carries every mark the legend describes — the
    // crowns, the flora beds, the nameplates, the signposts and all five wisp families.
    expect(named).not.toContain('flora-layer');
    for (const above of ['hex-flora', 'garden-flora', 'story-tree', 'trail-net', 'world-wisp']) {
      expect(named).not.toContain(above);
    }
  });

  it('holds no map mark itself — it cannot, because it holds no SVG', async () => {
    // ⚠ STATED AS AN ABSENCE OF THE WHOLE MEDIUM rather than as a list of marks. A list would be
    // vacuously satisfied by any payload that happens not to draw them (this one draws no wisps),
    // which is precisely the green check that verifies nothing. The land layer contains the canvas
    // and nothing else, so no mark the map draws CAN be in it.
    const container = await renderTreeAt('?landMount=1');
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    expect(layer.querySelector('svg')).toBeNull();
    expect(layer.querySelector('[data-story-id]')).toBeNull();
    expect(layer.querySelector('[data-cap-id]')).toBeNull();
    // The map's own marks are in the SVG, which follows this layer — so they paint above it.
    const svg = container.querySelector('svg.world-scene')!;
    expect(svg.querySelector('.trail-net')).toBeTruthy();
    expect(layer.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the map keyboard-drivable and named, identically to the flag-off arm', async () => {
    // ADR-0380 D6 fence 1 forbids making accessibility WORSE. The map's affordances all live on
    // `.world-viewport`, which is the land layer's PARENT's parent — so the mount must not move,
    // shadow or re-label any of them.
    const read = (root: HTMLElement) => {
      const vp = root.querySelector('.world-viewport')!;
      return {
        tabIndex: vp.getAttribute('tabindex'),
        label: vp.getAttribute('aria-label'),
        hidden: vp.getAttribute('aria-hidden'),
      };
    };
    const off = read(await renderTreeAt(''));
    cleanup();
    const on = read(await renderTreeAt('?landMount=1'));
    expect(on).toEqual(off);
    expect(on.tabIndex).toBe('0');
    expect(on.label).toBeTruthy();
    // The land layer itself is out of the accessibility tree — a decorative raster must not be
    // announced, and it must not become the map's accessible name by sitting first.
    expect(document.querySelector('[data-testid="land-mount"]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('hides the SVG ground with `opacity`, which is what keeps the islands CLICKABLE', async () => {
    // ⚠⚠ THIS READS THE STYLESHEET ON PURPOSE, because the choice it pins is invisible in jsdom and
    // is exactly the kind a later tidy-up would "simplify". `.relaxed-tile` and `.hex-tile` are
    // click targets — they carry `cursor: pointer`, and the coordinate fallback walks up from
    // `document.elementFromPoint`. `display: none` or `visibility: hidden` would take them out of
    // hit-testing and cost the map its picking, silently and only in a browser. `opacity: 0` leaves
    // an element fully hit-testable.
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    const rule = /\.world-pan-layer\.has-land-mount[^{]*\{([^}]*)\}/.exec(css);
    expect(rule, 'the ground-suppression rule must exist').toBeTruthy();
    expect(rule![1]).toMatch(/opacity:\s*0/);
    expect(rule![1]).not.toMatch(/display\s*:/);
    expect(rule![1]).not.toMatch(/visibility\s*:/);
    // And the selector must not reach the territory group, which CONTAINS the marks above.
    expect(rule![0]).not.toMatch(/\.hex-flora/);
  });

  it('adds no z-index to the map stack, so DOM order stays the only rule', async () => {
    // ⚠ The settlement is "paint order is DOM order". A `z-index` anywhere in this stack would be a
    // second rule, and two rules about one stacking order is how a wisp ends up under the land.
    const css = readFileSync(resolve(process.cwd(), 'src/index.css'), 'utf8');
    for (const sel of ['.land-mount', '.world-pan-layer', '.world-scene', '.world-viewport']) {
      const block = new RegExp(`\\n\\${sel}\\s*\\{([^}]*)\\}`).exec(css);
      if (block) expect(block[1], `${sel} must set no z-index`).not.toMatch(/z-index/);
    }
  });
});
