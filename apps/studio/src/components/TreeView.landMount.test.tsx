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
import { existsSync, readFileSync } from 'node:fs';
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

/**
 * THE STUDIO STYLESHEET, wherever the runner rooted itself.
 *
 * ⚠ TWO CANDIDATES, AND IT THROWS RATHER THAN SKIPS. `vitest` runs with this project as cwd;
 * Stryker's mutation sandbox runs the same suite with the REPO ROOT as cwd, and a single
 * `resolve(cwd, 'src/index.css')` therefore ENOENTs the whole dry run inside the sandbox (measured
 * — it redded `check:mutation-diff` while every other suite passed). Falling back to a silent skip
 * would be worse than the crash: the assertions below would pass by not running, which is this
 * repo's most-repeated fault class. So an absent stylesheet is a loud failure naming where it
 * looked.
 */
function readStudioCss(): string {
  const candidates = ['src/index.css', 'apps/studio/src/index.css'];
  for (const c of candidates) {
    const p = resolve(process.cwd(), c);
    if (existsSync(p)) return readFileSync(p, 'utf8');
  }
  throw new Error(
    `the studio stylesheet is the SUBJECT of these assertions and was not found from ` +
      `${process.cwd()} — tried ${candidates.join(', ')}`,
  );
}

/**
 * THE GROUND-SUPPRESSION RULE, matched precisely.
 *
 * ⚠ A LOOSE `\.world-pan-layer\.has-land-mount[^{]*\{` PATTERN IS WRONG AND WAS MEASURED WRONG:
 * three rules now share that prefix (this one, and the two that order the z-stack), so the loose
 * form matched whichever came first in the file and asserted the wrong block's properties. It is
 * anchored on the two ground-layer classes it is ABOUT.
 */
interface CssRule {
  /** Everything before the `{` — the selector list. */
  readonly selector: string;
  /** Everything between the braces — the declarations. */
  readonly body: string;
}

function groundSuppressionRule(css: string): CssRule {
  const m = /(\.world-pan-layer\.has-land-mount\s+\.hex-coastland[\s\S]*?)\{([^}]*)\}/.exec(css);
  if (m === null) throw new Error('the ground-suppression rule was not found in the studio stylesheet');
  return { selector: m[1]!, body: m[2]! };
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
    const { selector } = groundSuppressionRule(readStudioCss());
    const named = [...selector.matchAll(/\.has-land-mount\s+\.([a-z-]+)/g)].map((m) => m[1]!);
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
    const { selector, body } = groundSuppressionRule(readStudioCss());
    expect(body).toMatch(/opacity:\s*0/);
    expect(body).not.toMatch(/display\s*:/);
    expect(body).not.toMatch(/visibility\s*:/);
    // And the selector must not reach the territory group, which CONTAINS the marks above.
    expect(selector).not.toMatch(/\.hex-flora/);
  });

  it('leaves the SVG scene graph BYTE-IDENTICAL — the determinism fence', async () => {
    // ⚠⚠ THE STRONGEST FENCE IN THIS FILE, and the cheapest. ADR-0380 D6 fence 2 puts determinism
    // on the scene graph rather than on a live raster, so the honest test of "the mount changed
    // nothing about the map" is that the map's own markup is the SAME STRING with the flag on and
    // off. It holds only because the mount touches no scene node: the land is a sibling of the
    // `<svg>`, and the ground is hidden by a class on the pan layer OUTSIDE it. The moment anyone
    // suppresses the ground by stamping a class on a scene node instead, this fails — which is the
    // correct outcome, because that is a change to the thing the byte-locks in
    // `@storytree/forest-world` pin.
    const off = (await renderTreeAt('')).querySelector('svg.world-scene')!.outerHTML;
    cleanup();
    const on = (await renderTreeAt('?landMount=1')).querySelector('svg.world-scene')!.outerHTML;
    expect(on.length).toBeGreaterThan(1000); // not two empty strings agreeing
    expect(on).toBe(off);
  });

  it('keeps the keyboard camera working, with the land mounted', async () => {
    // ADR-0380 D6 fence 1. The arrow/WASD camera lives on `.world-viewport`, which is the land
    // layer's grandparent — but the land layer is `position: absolute` over the whole frame, so
    // "the handler is still attached" is not the same claim as "the key still moves the camera".
    // This drives the real handler and reads the real camera transform.
    const container = await renderTreeAt('?landMount=1');
    const vp = container.querySelector('.world-viewport') as HTMLElement;
    const cameraTransform = () => container.querySelector('g.world-camera')!.getAttribute('transform');
    const before = cameraTransform();
    // ⚠ A null-to-something change would pass `not.toBe` without the key doing anything, so the
    // starting camera is asserted present first.
    expect(before).toBeTruthy();
    await act(async () => {
      vp.focus();
      vp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(cameraTransform()).not.toBe(before);
  });

  it('states the z-order EXPLICITLY — because DOM order is NOT paint order here', () => {
    // ⚠⚠ THIS TEST REPLACES ITS OWN OPPOSITE, and the correction is the finding. It first asserted
    // that NOTHING in this stack sets a `z-index`, on the reasoning that the land layer is the
    // first child so the `<svg>` after it must paint on top. CSS says otherwise: the land layer is
    // `position: absolute` (it has to overlay the frame), the `<svg>` is `position: static`, and
    // positioned descendants paint ABOVE non-positioned in-flow content whatever the DOM order.
    // Measured on the real forest: the canvas covered the entire SVG flora layer — 1,996 flora
    // marks, 8,781 grass blades, every tree — with every element still present in the DOM and every
    // element count identical between the arms. Only the staged picture could catch it, which is
    // why the assertion now pins the EXPLICIT ordering rather than its absence.
    const css = readStudioCss();
    const land = /\.world-pan-layer\.has-land-mount\s*>\s*\.land-mount\s*\{([^}]*)\}/.exec(css);
    const svg = /\.world-pan-layer\.has-land-mount\s*>\s*\.world-scene\s*\{([^}]*)\}/.exec(css);
    expect(land, 'the land layer must carry an explicit z-index under the mount').toBeTruthy();
    expect(svg, 'the SVG layer must carry an explicit z-index under the mount').toBeTruthy();
    const zOf = (block: string) => Number(/z-index:\s*(-?\d+)/.exec(block)?.[1] ?? NaN);
    const landZ = zOf(land![1]!);
    const svgZ = zOf(svg![1]!);
    expect(Number.isFinite(landZ)).toBe(true);
    expect(Number.isFinite(svgZ)).toBe(true);
    // The map is ABOVE the land. That is the whole settlement, in one comparison.
    expect(svgZ).toBeGreaterThan(landZ);
    // ⚠ AND THE SVG MUST BE POSITIONED, or its z-index is ignored and we are back to the defect.
    expect(svg![1]!).toMatch(/position:\s*(relative|absolute)/);
    // ⚠ NEITHER MAY BE NEGATIVE. A negative index only stays inside `.world-pan-layer` while that
    // element happens to be a stacking context — true when it carries a transform, false when the
    // transform is `none` — and an index that escapes lands behind `.world-frame`'s gradient, so
    // the land would vanish depending on whether a drag was in flight.
    expect(landZ).toBeGreaterThanOrEqual(0);
    expect(svgZ).toBeGreaterThanOrEqual(0);
  });

  it('leaves the flag-off route with a static SVG and no new stacking context', () => {
    // The ordering above is scoped to `.has-land-mount` precisely so the ordinary map is untouched.
    const css = readStudioCss();
    expect(/\n\.world-scene\s*\{([^}]*)\}/.exec(css)![1]!).not.toMatch(/z-index|position/);
  });
});
