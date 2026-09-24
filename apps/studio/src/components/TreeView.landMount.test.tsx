// @vitest-environment jsdom
//
// TreeView.landMount.test.tsx — the 3D land sits UNDER the working map, always (ADR-0608 D1: the
// mounted land IS the forest; the `?landMount` / `?landMountProps` flag retired with the flat look),
// and the map keeps every interaction it had.
//
// ⚠⚠ THIS SUITE IS THE Z-ORDER SETTLEMENT, IN ASSERTIONS. The land layer is the FIRST child of
// `.world-pan-layer` and the `<svg>` follows it, and the stylesheet states the paint order
// explicitly (DOM order alone is NOT paint order here — see the z-order case below).
//
// ⚠ AND THE SECOND HALF IS THAT THE MAP IS NOT TOUCHED. A mount that quietly cost the map its
// keyboard camera, its accessible name or its hit targets would satisfy "the land is mounted" and
// fail the map. There is no flag-off arm to compare against any more, so each is asserted directly.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, cleanup, fireEvent, within } from '@testing-library/react';

import { AppDataContext, type AppData } from '../lib/appData';
import { HttpDouble, installHttpDouble } from '../test/httpDouble';
import { TreeView, StudioSurfacesContext, Act2ChoreographyContext, type Act2Choreography, type StudioSurfaces } from './TreeView';
import { LandViewMount, type LandMountCanvasProps, type LandViewMountProps } from './LandViewMount';
import {
  ACT2_INTRO_SESSION_KEY,
  markAct2IntroArrived,
  useAct2Intro,
  useStableForestRegrowLayer,
  type Act2IntroPlayer,
} from './act2Intro';
import type { LandCanvasPhase, LandMountStatus } from '../lib/landViewStatus';

// Two stories with a declared edge between them — a slightly more honest forest than one story, and
// more markup for the byte-identity test to compare. ⚠ It does NOT make trails appear in this
// suite: jsdom lays nothing out, so nothing is routed and `[data-edges]` is 0 regardless
// (measured). Edge counts are asserted in the browser capture, not here.
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
    {
      id: 'forest-world',
      title: 'Forest world',
      outcome: 'the forest lays out',
      status: 'healthy',
      proofMode: 'integration-test',
      uatWitness: 'machine',
      dependsOn: [],
      consumedBy: ['studio'],
      capabilities: [
        {
          id: 'forest-layout',
          title: 'The layout',
          outcome: 'the islands sit somewhere',
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

async function renderTreeAt(search: string, surfaces: Partial<StudioSurfaces> | null = null): Promise<HTMLElement> {
  window.history.replaceState(null, '', `/${search}`);
  const { container } = render(
    <StudioSurfacesContext.Provider value={surfaces}>
      <AppDataContext.Provider value={appData}>
        <TreeView focus={null} />
      </AppDataContext.Provider>
    </StudioSurfacesContext.Provider>,
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

/** A stand-in mount that reports one settled status, so a test can hold the land's state fixed. */
function reportingMount(status: LandMountStatus): Partial<StudioSurfaces> {
  return {
    LandViewMount: ({ onStatus }) => {
      useEffect(() => {
        onStatus?.(status);
      }, [onStatus]);
      return <div data-testid="land-mount" aria-hidden="true" />;
    },
  };
}

describe('the land under the working map', () => {
  it('is mounted on the clean route, drawing its props — no query opens or closes it', async () => {
    // ADR-0608 D1: the mounted land is the forest, so it is unconditional. The retired flag's own
    // values — including the old OFF spelling — neither gate nor configure it any more.
    for (const search of ['', '?landMount=0', '?landMountProps=0']) {
      const mountInputs: LandViewMountProps[] = [];
      const surfaces: Partial<StudioSurfaces> = {
        LandViewMount: (props) => {
          mountInputs.push(props);
          return <LandViewMount {...props} />;
        },
      };
      const container = await renderTreeAt(search, surfaces);
      expect(container.querySelector('[data-testid="land-mount"]'), `mounted at ${search || '(clean)'}`).toBeTruthy();
      expect(mountInputs.length).toBeGreaterThan(0);
      expect(mountInputs.at(-1)!.drawProps, `props drawn at ${search || '(clean)'}`).toBe(true);
      const pan = container.querySelector('.world-pan-layer')!;
      // The retired flag's scoping class is gone: the pan layer carries no mode.
      expect(pan.className).toBe('world-pan-layer');
      cleanup();
    }
  });

  it('mounts INSIDE the pan layer and BEFORE the SVG — which is the whole z-order settlement', async () => {
    const container = await renderTreeAt('');
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
  });

  it('holds no map mark itself — it cannot, because it holds no SVG', async () => {
    // ⚠ STATED AS AN ABSENCE OF THE WHOLE MEDIUM rather than as a list of marks. A list would be
    // vacuously satisfied by any payload that happens not to draw them (this one draws no wisps),
    // which is precisely the green check that verifies nothing. The land layer contains the canvas
    // and nothing else, so no mark the map draws CAN be in it.
    const container = await renderTreeAt('');
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    expect(layer.querySelector('svg')).toBeNull();
    expect(layer.querySelector('[data-story-id]')).toBeNull();
    expect(layer.querySelector('[data-cap-id]')).toBeNull();
    // The map's own marks are in the SVG, which follows this layer — so they paint above it.
    const svg = container.querySelector('svg.world-scene')!;
    expect(svg.querySelector('[data-story-id]')).toBeTruthy();
    expect(layer.compareDocumentPosition(svg) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the map keyboard-drivable and named, with the land mounted', async () => {
    // ADR-0380 D6 fence 1 forbids making accessibility WORSE. The map's affordances all live on
    // `.world-viewport`, which is the land layer's PARENT's parent — so the mount must not move,
    // shadow or re-label any of them.
    const container = await renderTreeAt('');
    const vp = container.querySelector('.world-viewport')!;
    expect(vp.getAttribute('tabindex')).toBe('0');
    expect(vp.getAttribute('aria-label')).toBe('story forest map (pan and zoom)');
    expect(vp.getAttribute('aria-hidden')).toBeNull();
    // The land layer itself is out of the accessibility tree — a decorative raster must not be
    // announced, and it must not become the map's accessible name by sitting first.
    expect(document.querySelector('[data-testid="land-mount"]')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves the SVG scene graph BYTE-IDENTICAL whatever the land reports — the determinism fence', async () => {
    // ⚠⚠ ADR-0380 D6 fence 2 puts determinism on the scene graph rather than on a live raster. With
    // no flag-off arm left, the honest form is that the land's OWN state cannot reach the map's
    // markup: a land that drew and a land that failed leave the `<svg>` the SAME STRING. It holds
    // only because the mount touches no scene node — its message lives outside the viewport. (A
    // settled returning visit, so no regrow is running in either arm.)
    const previousArrival = window.sessionStorage.getItem(ACT2_INTRO_SESSION_KEY);
    markAct2IntroArrived(window.sessionStorage);
    try {
      const ready = (await renderTreeAt('', reportingMount({ kind: 'ready' }))).querySelector('svg.world-scene')!.outerHTML;
      cleanup();
      const failedContainer = await renderTreeAt('', reportingMount({ kind: 'failed', message: 'no land' }));
      // The failure is really in effect in this arm — it is announced, outside the SVG.
      expect(within(failedContainer).getByRole('alert').textContent).toBe('no land');
      const failed = failedContainer.querySelector('svg.world-scene')!.outerHTML;
      expect(ready.length).toBeGreaterThan(1000); // not two empty strings agreeing
      expect(failed).toBe(ready);
    } finally {
      cleanup();
      if (previousArrival === null) window.sessionStorage.removeItem(ACT2_INTRO_SESSION_KEY);
      else window.sessionStorage.setItem(ACT2_INTRO_SESSION_KEY, previousArrival);
    }
  });

  it('keeps the keyboard camera working, with the land mounted', async () => {
    // ADR-0380 D6 fence 1. The arrow/WASD camera lives on `.world-viewport`, which is the land
    // layer's grandparent — but the land layer is `position: absolute` over the whole frame, so
    // "the handler is still attached" is not the same claim as "the key still moves the camera".
    // This drives the real handler and reads the real camera transform.
    const container = await renderTreeAt('');
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

  it('sends a real legend toggle to the native mount while retained SVG story selection works', async () => {
    const previousArrival = window.sessionStorage.getItem(ACT2_INTRO_SESSION_KEY);
    // This is a settled-map interaction witness, using the real returning-visit state.
    markAct2IntroArrived(window.sessionStorage);
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalRO = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    class RO {
      constructor(private readonly callback: () => void) {}
      observe() { this.callback(); }
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: RO });
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON: () => ({}) } as DOMRect;
    };
    const mountInputs: LandViewMountProps[] = [];
    const canvasInputs: LandMountCanvasProps[] = [];
    const captureCanvas = (props: LandMountCanvasProps) => {
      canvasInputs.push(props);
      return <div data-testid="native-canvas-slot" />;
    };
    const surfaces: Partial<StudioSurfaces> = {
      LandViewMount: (props) => {
        mountInputs.push(props);
        return <LandViewMount {...props} renderCanvas={captureCanvas} />;
      },
    };
    try {
      const container = await renderTreeAt('', surfaces);
      const viewport = container.querySelector('.world-viewport') as HTMLElement;
      const layer = container.querySelector('[data-testid="land-mount"]')!;
      expect(layer.getAttribute('data-state')).toBe('drawn');
      expect(layer.getAttribute('aria-hidden')).toBe('true');
      expect(layer.getAttribute('tabindex')).toBeNull();
      expect(viewport.getAttribute('tabindex')).toBe('0');
      expect(viewport.getAttribute('aria-label')).toBe('story forest map (pan and zoom)');
      expect(/\.land-mount\s*\{([^}]*)\}/.exec(readStudioCss())![1]!).toMatch(/pointer-events:\s*none/);
      const before = canvasInputs.at(-1)!;
      expect(before.hiddenStatuses.size).toBe(0);
      expect(before.registered.props).toBe(true);
      const retainedTargets = () => [...container.querySelectorAll('svg.world-scene [data-story-id]')]
        .map((node) => [node.getAttribute('data-story-id'), node.getAttribute('data-cap-id')]);
      const beforeTargets = retainedTargets();
      expect(beforeTargets.length).toBeGreaterThan(0);

      fireEvent.click(within(container).getByRole('button', { name: 'story status', hidden: true }));
      // presentStories folds the fixture's authored healthy to proposed: it has no signed verdict.
      fireEvent.click(within(container).getByTitle('fade proposed'));
      const dimmed = canvasInputs.at(-1)!;
      expect(dimmed.hiddenStatuses).toBe(mountInputs.at(-1)!.hiddenStatuses);
      expect([...dimmed.hiddenStatuses]).toEqual(['proposed']);
      expect(dimmed.registered).toEqual(before.registered);
      expect(dimmed.active).toBe(before.active);
      expect(dimmed.regrow).toBe(before.regrow);
      expect(retainedTargets()).toEqual(beforeTargets);

      // The actual capability ground tile carries the story identity for coordinate selection.
      // This fixture does not stamp a data-cap-id, so do not fabricate a capability hit target.
      const targetSelector = 'svg.world-scene .relaxed-tile[data-story-id="forest-world"]';
      const target = container.querySelector(targetSelector);
      expect(target).toBeTruthy();
      expect(target!.querySelector('title')!.textContent).toBe('forest-layout');
      expect(target!.getAttribute('data-cap-id')).toBeNull();
      const hitPoints: number[][] = [];
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: (x: number, y: number) => {
          hitPoints.push([x, y]);
          return target;
        },
      });
      viewport.focus();
      expect(document.activeElement).toBe(viewport);
      fireEvent.click(viewport, { clientX: 140, clientY: 130 });
      expect(hitPoints).toEqual([[140, 130]]);
      expect(window.location.hash).toBe('#/tree/forest-world');
      expect(container.querySelector(targetSelector)).toBe(target);

      fireEvent.click(within(container).getByTitle('show proposed'));
      expect(canvasInputs.at(-1)!.hiddenStatuses.size).toBe(0);
      expect(canvasInputs.at(-1)!.hiddenStatuses).toBe(mountInputs.at(-1)!.hiddenStatuses);
      expect(retainedTargets()).toEqual(beforeTargets);
    } finally {
      cleanup();
      if (previousArrival === null) window.sessionStorage.removeItem(ACT2_INTRO_SESSION_KEY);
      else window.sessionStorage.setItem(ACT2_INTRO_SESSION_KEY, previousArrival);
      Element.prototype.getBoundingClientRect = originalRect;
      if (originalRO) Object.defineProperty(globalThis, 'ResizeObserver', originalRO);
      else Reflect.deleteProperty(globalThis, 'ResizeObserver');
      if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it('renders the native plants\' targets into the map\'s OWN hit layer and selects through the host route', async () => {
    const previousArrival = window.sessionStorage.getItem(ACT2_INTRO_SESSION_KEY);
    markAct2IntroArrived(window.sessionStorage);
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalRO = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    const originalHitTest = Object.getOwnPropertyDescriptor(document, 'elementFromPoint');
    class RO {
      constructor(private readonly callback: () => void) {}
      observe() { this.callback(); }
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: RO });
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON: () => ({}) } as DOMRect;
    };
    const canvasInputs: LandMountCanvasProps[] = [];
    const surfaces: Partial<StudioSurfaces> = {
      LandViewMount: (props) => (
        <LandViewMount
          {...props}
          renderCanvas={(canvas) => {
            canvasInputs.push(canvas);
            return <div data-testid="native-canvas-slot" />;
          }}
        />
      ),
    };
    try {
      window.history.replaceState(null, '', '/');
      const tree = (focus: string | null) => (
        <StudioSurfacesContext.Provider value={surfaces}>
          <AppDataContext.Provider value={appData}>
            <TreeView focus={focus} />
          </AppDataContext.Provider>
        </StudioSurfacesContext.Provider>
      );
      const { container, rerender } = render(tree(null));
      await act(async () => {});
      const report = canvasInputs.at(-1)!.onNativePropTargets;
      expect(typeof report).toBe('function');
      // Nothing is drawn until the canvas reports plants.
      expect(container.querySelector('svg.world-scene g.native-prop-targets')).toBeNull();

      const world = container.querySelector('svg.world-scene g.world-camera > g')!;
      const offset = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(world.getAttribute('transform') ?? '')!;
      const [ox, oy] = [Number(offset[1]), Number(offset[2])];
      const envelope = (capabilityId: string, storyId: string, minX: number, minY: number) => ({
        storyId,
        capabilityId,
        status: 'healthy',
        root: { x: minX + 5, y: minY + 20 },
        crown: { x: minX + 5, y: minY },
        bounds: { minX, maxX: minX + 10, minY, maxY: minY + 24 },
      });
      await act(async () => {
        report!([envelope('studio-map', 'studio', 300, 400), envelope('forest-layout', 'forest-world', 310, 420)]);
      });

      const layer = world.querySelector(':scope > g.native-prop-targets')!;
      expect(layer).not.toBeNull();
      const rects = [...layer.querySelectorAll('rect')];
      expect(rects.map((r) => [r.getAttribute('data-story-id'), r.getAttribute('data-cap-id')])).toEqual([
        ['studio', 'studio-map'],
        ['forest-world', 'forest-layout'],
      ]);
      // Scene-root envelopes, drawn inside the offset world group: shifted back by the offset once.
      expect(rects[1]!.getAttribute('x')).toBe((310 - ox).toFixed(1));
      expect(rects[1]!.getAttribute('y')).toBe((420 - oy).toFixed(1));

      // The host's coordinate hit-test is the one picking authority: a native target under the
      // pointer selects its capability exactly as a flat mark does.
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => rects[1] });
      const viewport = container.querySelector('.world-viewport') as HTMLElement;
      fireEvent.click(viewport, { clientX: 140, clientY: 130 });
      expect(window.location.hash).toBe('#/tree/forest-world');
      // The router hands the focused story back; the CAPABILITY the target named is the one selected.
      rerender(tree('forest-world'));
      await act(async () => {});
      expect(container.querySelector('.tree-card.is-selected > title')?.textContent).toBe('The layout');

      // Withdrawn plants withdraw their targets.
      await act(async () => {
        report!([]);
      });
      expect(container.querySelector('svg.world-scene g.native-prop-targets')).toBeNull();
    } finally {
      cleanup();
      if (previousArrival === null) window.sessionStorage.removeItem(ACT2_INTRO_SESSION_KEY);
      else window.sessionStorage.setItem(ACT2_INTRO_SESSION_KEY, previousArrival);
      Element.prototype.getBoundingClientRect = originalRect;
      if (originalRO) Object.defineProperty(globalThis, 'ResizeObserver', originalRO);
      else Reflect.deleteProperty(globalThis, 'ResizeObserver');
      if (originalHitTest) Object.defineProperty(document, 'elementFromPoint', originalHitTest);
      else Reflect.deleteProperty(document, 'elementFromPoint');
    }
  });

  it('tells the member, in the ACCESSIBLE host layer, when this browser cannot draw the 3D map (ADR-0608 D5)', async () => {
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalRO = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    class RO {
      constructor(private readonly callback: () => void) {}
      observe() { this.callback(); }
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: RO });
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON: () => ({}) } as DOMRect;
    };
    try {
      // No surface override: the REAL mount and its REAL default canvas, on a runner with no WebGL 2.
      const container = await renderTreeAt('');
      await act(async () => {});
      const notice = within(container).getByRole('alert');
      expect(notice.textContent).toContain('WebGL 2');
      expect(notice.textContent).toContain("This browser can't draw the forest map");
      // Reachable: not inside the aria-hidden land layer, and not inside the clickable viewport.
      expect(notice.closest('[aria-hidden="true"]')).toBeNull();
      expect(notice.closest('.world-viewport')).toBeNull();
      expect(notice.closest('.world-frame')).not.toBeNull();
      expect(container.querySelector('[data-testid="land-mount"] canvas')).toBeNull();
      // No fallback map is invented: the working map is exactly the one that was there.
      expect(container.querySelector('svg.world-scene')).not.toBeNull();
    } finally {
      cleanup();
      Element.prototype.getBoundingClientRect = originalRect;
      if (originalRO) Object.defineProperty(globalThis, 'ResizeObserver', originalRO);
      else Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  });

  it('shows no notice once the land reports it is drawn', async () => {
    const container = await renderTreeAt('', reportingMount({ kind: 'ready' }));
    expect(container.querySelector('[data-testid="land-mount"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="land-view-notice"]')).toBeNull();
  });

  it('keeps edge identity in the SVG layer, never on the canvas', async () => {
    // ⚠ THE COUNT-EQUALITY VERSION OF THIS TEST WAS DELETED AS VACUOUS, and saying why matters more
    // than the assertion that replaced it. jsdom lays nothing out, so `buildWorld` positions no
    // islands and `buildScene` routes NO trails — `[data-edges]` is 0 here however
    // many edges the payload declares (measured: a two-story forest with a real `consumedBy` edge
    // still yields 0). A test comparing 0 to 0 would have read as proof.
    //
    // The browser-side count is asserted where the edges are real, in
    // `apps/studio/scripts/capture-land-mount.mjs`.
    //
    // What IS worth asserting here is the placement: identity must live in the layer that paints
    // above the land, never in the decorative one (ADR-0380 D6 fence 1).
    const container = await renderTreeAt('');
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    expect(layer.querySelector('[data-edges]')).toBeNull();
    expect(layer.querySelector('[data-id]')).toBeNull();
    expect(container.querySelector('svg.world-scene')).toBeTruthy();
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
    const land = /\.world-pan-layer\s*>\s*\.land-mount\s*\{([^}]*)\}/.exec(css);
    const svg = /\.world-pan-layer\s*>\s*\.world-scene\s*\{([^}]*)\}/.exec(css);
    expect(land, 'the land layer must carry an explicit z-index').toBeTruthy();
    expect(svg, 'the SVG layer must carry an explicit z-index').toBeTruthy();
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
});

// ── THE OPENING (the-3d-map-opens-on-its-first-growth, ADR-0608 D1a) ──
//
// The first arrival's regrow used to start the moment the flat scene could accrete — seconds before
// the 3D land could draw — so a member watched blank cream, then stray flat specks and a lone island
// name, and the land popped in a third grown. The START anchor now waits for the mounted land to
// settle its first status (ready, or a terminal can't-draw). Only the START moves: once running,
// the cursor is the same wall-clock anchor it always was (ADR-0469), so an unwatched gap AFTER the
// start still catches up.
describe('the opening waits for the land it grows on', () => {
  /** The injected app clock: the wall time it reports, and the one frame callback it is holding. */
  interface OpeningClock {
    now: number;
    next: ((t: number) => void) | null;
  }

  interface OpeningHarness {
    readonly players: Act2IntroPlayer[];
    readonly phases: ((phase: LandCanvasPhase) => void)[];
    readonly clock: OpeningClock;
    readonly frame: (ms: number) => void;
    readonly idle: (ms: number) => void;
    readonly restore: () => void;
  }

  function openingHarness(): OpeningHarness {
    window.sessionStorage.removeItem(ACT2_INTRO_SESSION_KEY);
    const originalRect = Element.prototype.getBoundingClientRect;
    const originalRO = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
    class RO {
      constructor(private readonly callback: () => void) {}
      observe() { this.callback(); }
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, writable: true, value: RO });
    Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
      return { x: 0, y: 0, left: 0, top: 0, right: 1600, bottom: 900, width: 1600, height: 900, toJSON: () => ({}) } as DOMRect;
    };
    const clock: OpeningClock = { now: 0, next: null };
    const players: Act2IntroPlayer[] = [];
    const phases: ((phase: LandCanvasPhase) => void)[] = [];
    return {
      players,
      phases,
      clock,
      frame: (ms) => {
        clock.now += ms;
        const cb = clock.next;
        clock.next = null;
        if (cb) act(() => cb(clock.now));
      },
      idle: (ms) => {
        clock.now += ms;
      },
      restore: () => {
        cleanup();
        window.sessionStorage.removeItem(ACT2_INTRO_SESSION_KEY);
        Element.prototype.getBoundingClientRect = originalRect;
        if (originalRO) Object.defineProperty(globalThis, 'ResizeObserver', originalRO);
        else Reflect.deleteProperty(globalThis, 'ResizeObserver');
      },
    };
  }

  async function renderOpening(search: string, h: OpeningHarness): Promise<void> {
    const choreography: Act2Choreography = {
      useReducedMotion: () => false,
      useAct2Intro: (input) => {
        const player = useAct2Intro({
          ...input,
          clock: {
            requestFrame: (callback) => {
              h.clock.next = callback;
              return 1;
            },
            cancelFrame: () => {
              h.clock.next = null;
            },
            now: () => h.clock.now,
          },
        });
        h.players.push(player);
        return player;
      },
      useStableForestRegrowLayer,
    };
    const surfaces: Partial<StudioSurfaces> = {
      LandViewMount: (props) => (
        <LandViewMount
          {...props}
          renderCanvas={(canvas) => {
            h.phases.push(canvas.onPhase);
            return <div data-testid="native-canvas-slot" />;
          }}
        />
      ),
    };
    window.history.replaceState(null, '', `/${search}`);
    render(
      <Act2ChoreographyContext.Provider value={choreography}>
        <StudioSurfacesContext.Provider value={surfaces}>
          <AppDataContext.Provider value={appData}>
            <TreeView focus={null} />
          </AppDataContext.Provider>
        </StudioSurfacesContext.Provider>
      </Act2ChoreographyContext.Provider>,
    );
    await act(async () => {});
  }

  it('holds the first growth at NOTHING until the 3D land is ready, then starts it from its first moment', async () => {
    const h = openingHarness();
    try {
      await renderOpening('', h);
      // The scene exists and the plan is derived — this is exactly the moment the old start fired.
      expect(h.phases.length).toBeGreaterThan(0);
      const waiting = h.players.at(-1)!;
      expect(waiting.plan).not.toBeNull();
      expect(waiting.playing).toBe(false);
      expect(waiting.progress).toBe(0);
      // Time passes while the renderer downloads and warms up. None of it is growth.
      h.idle(8000);
      await act(async () => {});
      expect(h.players.at(-1)!.playing).toBe(false);
      expect(h.players.at(-1)!.progress).toBe(0);
      // …and the member is TOLD it is loading, in the host's accessible layer (ADR-0608 D5).
      expect(document.querySelector('[data-testid="land-view-notice"]')?.getAttribute('role')).toBe('status');

      act(() => h.phases.at(-1)!({ kind: 'ready' }));
      await act(async () => {});
      expect(document.querySelector('[data-testid="land-view-notice"]')).toBeNull();
      const started = h.players.at(-1)!;
      expect(started.playing).toBe(true);
      // The START anchor is the ready moment: the 8 s of loading are not in the cursor.
      expect(started.progress).toBe(0);
      const duration = started.plan!.durationMs;
      // …and from there it is the SAME wall-clock anchor (ADR-0469): an unwatched gap after the
      // start is time that passed, caught up on the next frame, never paused.
      // The default dial is 0.25× (ADR-0286), so one plan-duration of wall time is a quarter of the run.
      // Anchored at page start instead, the 8 s of loading would be in this number too.
      h.idle(duration - 16);
      h.frame(16);
      expect(h.players.at(-1)!.progress).toBeCloseTo(0.25, 6);
    } finally {
      h.restore();
    }
  });

  it('starts anyway when this browser cannot draw the land — a notice, never a forest held at nothing', async () => {
    const h = openingHarness();
    try {
      await renderOpening('', h);
      expect(h.players.at(-1)!.playing).toBe(false);
      act(() => h.phases.at(-1)!({ kind: 'unsupported' }));
      await act(async () => {});
      expect(h.players.at(-1)!.playing).toBe(true);
    } finally {
      h.restore();
    }
  });

  it('starts anyway when the land FAILS to load', async () => {
    const h = openingHarness();
    try {
      await renderOpening('', h);
      act(() => h.phases.at(-1)!({ kind: 'failed', reason: 'the 3D code did not download' }));
      await act(async () => {});
      expect(h.players.at(-1)!.playing).toBe(true);
    } finally {
      h.restore();
    }
  });
});
