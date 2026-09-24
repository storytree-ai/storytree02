// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { AppDataContext, type AppData } from '../lib/appData';
import type { TreeStory } from '../types';
import type { ForestRegrowRenderLayer } from '@storytree/app-surface';

const act2Harness = {
  now: new Date('2026-08-06T00:00:00.000Z'),
  builds: [] as never[],
  claimActivity: { claims: [] as never[], departures: [] as never[] },
  reducedMotion: false,
  inputs: [] as Array<{ enabled: boolean }>,
  // Typed against what the REAL hooks return — the module stub was never checked against them, so
  // a layer shape drifting out from under this harness used to be invisible here. The assertions
  // only care that the REFERENCE changed, so a minimal empty layer is the honest sentinel.
  regrowLayer: null as ForestRegrowRenderLayer | null,
  player: {
    plan: null,
    state: null,
    progress: 0,
    playing: true,
    regrowing: true,
    wave: 0,
    play: vi.fn(),
    pause: vi.fn(),
    replay: vi.fn(),
    back: vi.fn(),
    settle: vi.fn(),
  },
};

import { ACT2_INTRO_SESSION_KEY } from './act2Intro.js';
import {
  Act2ChoreographyContext,
  StudioSurfacesContext,
  TreeView,
  type Act2Choreography,
  type StudioSurfaces,
} from './TreeView';
import { HttpDouble, installHttpDouble } from '../test/httpDouble';

// THE SEAMS ARE REAL, NOT MOCKED MODULES (anti-slop-adoption-arc inc-06, `no-module-mocking`).
//
// This suite drives the Act 2 regrow choreography DIRECTLY — it scripts a player and asserts what
// the map renders for it, and what the map ASKED the choreography for. That needs the three
// `act2Intro` hooks substituted as a set, which is what `Act2ChoreographyContext` is for: a slot
// whose default is the real module, not a rewritten module. The renderer and the heavy overlays
// come through `StudioSurfacesContext` the same way.
//
// TWO WHOLE-MODULE STUBS WENT AWAY ENTIRELY rather than moving. The three live-layer hooks
// (`useBuildActivity` / `useClaimActivity` / `useSessionClaimGroups`) are polls over the api, so
// the doubled transport answers them honestly. (`loadHeroTreeVariants`, the other stub, is gone with
// the flat hero tree — ADR-0608.)
//
// The four PURE app-surface functions stop being substituted too, for the reason the pan suites
// give: `vi.mock` replaces a whole module, so stubbing `WorldSceneView` took `laneLayout` and its
// neighbours down with it. They run for real here now.
const TREE = '/api/tree';
const ACTIVITY = '/api/activity';
const CLAIMS = '/api/claims';

let http: HttpDouble;

const SURFACES: Partial<StudioSurfaces> = {
  WorldSceneView: () => <g data-testid="world-scene" />,
  // The 3D land is always mounted now (ADR-0608 D1); this suite drives a SCRIPTED player, so the
  // real canvas (and its WebGL probe) has nothing to contribute here.
  LandViewMount: () => <div data-testid="land-mount" />,
  WorldLegend: () => null,
  LegendDrawerBody: () => null,
  WorldSettingsPanel: () => null,
  LibraryDrawer: () => null,
  BottomDock: () => null,
};

/** A fresh, empty regrow layer — a NEW reference each call, which is what the assertions read. */
const emptyRegrowLayer = (): ForestRegrowRenderLayer => ({
  hiddenStoryIds: new Set(),
  hiddenSegmentIds: new Set(),
});

/** The scripted choreography — reads straight off the harness, as the module stub used to. */
const CHOREOGRAPHY: Act2Choreography = {
  useAct2Intro: (input) => {
    act2Harness.inputs.push(input);
    return act2Harness.player;
  },
  useReducedMotion: () => act2Harness.reducedMotion,
  useStableForestRegrowLayer: () => act2Harness.regrowLayer,
};

/** Mount the map under both seams — the shape every render in this file uses. */
const mapUnderSeams = (children: React.ReactNode): React.JSX.Element => (
  <Act2ChoreographyContext.Provider value={CHOREOGRAPHY}>
    <StudioSurfacesContext.Provider value={SURFACES}>
      <AppDataContext.Provider value={APP_DATA}>{children}</AppDataContext.Provider>
    </StudioSurfacesContext.Provider>
  </Act2ChoreographyContext.Provider>
);
import { ACT2_REGROW_OPENING_SCALE } from '../lib/worldCamera.js';

const STORIES: TreeStory[] = Array.from({ length: 40 }, (_, index) => ({
  id: `story-${index}`,
  title: `Story ${index}`,
  outcome: `Outcome ${index}`,
  status: 'proposed',
  proofMode: 'test',
  uatWitness: 'machine',
  dependsOn: index === 0 ? [] : [`story-${index - 1}`],
  consumedBy: [],
  capabilities: [],
}));

const APP_DATA: AppData = {
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

const cameraValues = (camera: Element) => {
  const match = camera.getAttribute('transform')?.match(/^translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)$/);
  if (!match) throw new Error(`unexpected camera transform: ${camera.getAttribute('transform')}`);
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) };
};

const compositorValues = (layer: HTMLElement) => {
  if (layer.style.transform === 'none' || layer.style.transform === '') {
    return { tx: 0, ty: 0, scale: 1 };
  }
  const match = layer.style.transform.match(
    /^translate3d\(([^p]+)px, ([^p]+)px, 0(?:px)?\) scale\(([^)]+)\)$/,
  );
  if (!match) throw new Error(`unexpected compositor transform: ${layer.style.transform}`);
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) };
};

const composedCameraValues = (camera: Element, layer: HTMLElement) => {
  const base = cameraValues(camera);
  const compositor = compositorValues(layer);
  return {
    tx: compositor.tx + compositor.scale * base.tx,
    ty: compositor.ty + compositor.scale * base.ty,
    scale: compositor.scale * base.scale,
  };
};

const mountMap = async (props: { focus?: string | null; active?: boolean } = {}) => {
  const activeProps = props.active === undefined ? {} : { active: props.active };
  const view = render(mapUnderSeams(<TreeView focus={props.focus ?? null} {...activeProps} />));
  const viewport = await screen.findByLabelText('story forest map (pan and zoom)');
  const camera = await waitFor(() => {
    const node = view.container.querySelector('.world-camera');
    expect(node?.getAttribute('transform')).toBeTruthy();
    return node!;
  });
  const panLayer = view.container.querySelector('.world-pan-layer') as HTMLElement;
  expect(panLayer).toBeTruthy();
  return { ...view, viewport, camera, panLayer };
};

const rerenderMap = (
  rerender: ReturnType<typeof render>['rerender'],
  props: { focus?: string | null; active?: boolean } = {},
) => {
  const activeProps = props.active === undefined ? {} : { active: props.active };
  rerender(mapUnderSeams(<TreeView focus={props.focus ?? null} {...activeProps} />));
};

let widthDescriptor: PropertyDescriptor | undefined;
let heightDescriptor: PropertyDescriptor | undefined;
let pointerDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1600 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 1000 });
  pointerDescriptor = Object.getOwnPropertyDescriptor(window, 'PointerEvent');
  class PointerEventShim extends window.MouseEvent {
    readonly pointerId: number;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventShim });
  window.sessionStorage.setItem(ACT2_INTRO_SESSION_KEY, '1');
  http = installHttpDouble();
  http.get(TREE, () => ({ stories: STORIES, builds: [], claims: [] }));
  // The advisory live layers answer store-absent — the quiet case this suite wants.
  http.get(ACTIVITY, () => ({ builds: null, claims: null }));
  http.get(CLAIMS, () => ({ sessions: null }));
  // The world's clock. The module stub pinned `useNowTick` to a fixed date; the real hook seeds
  // itself from the system clock, so pin THAT instead and the real hook runs.
  vi.setSystemTime(act2Harness.now);
  act2Harness.reducedMotion = false;
  act2Harness.inputs = [];
  act2Harness.regrowLayer = null;
  Object.assign(act2Harness.player, { progress: 0, playing: true, regrowing: true });
});

afterEach(() => {
  cleanup();
  http.uninstall();
  vi.useRealTimers();
  if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
  if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDescriptor);
  if (pointerDescriptor) Object.defineProperty(window, 'PointerEvent', pointerDescriptor);
  else delete (window as { PointerEvent?: unknown }).PointerEvent;
  vi.clearAllMocks();
});

describe('act2-regrow-camera-projects-the-existing-cursor', () => {
  it('act2-camera-gap-frames-deliver-through-the-compositor: holds the SVG camera frozen on stable-picture frames and delivers the exact cursor through the compositor', async () => {
    window.history.replaceState(null, '', '/?act2=intro');
    const view = await mountMap();
    const opening = cameraValues(view.camera);
    expect((view.camera as SVGGElement).style.transition).toBe('none');
    expect(view.panLayer.style.transformOrigin).toBe('0 0');

    let rootTransformWrites = 0;
    let wrapperStyleWrites = 0;
    const observer = new MutationObserver((records) => {
      rootTransformWrites += records.filter(
        (record) => record.attributeName === 'transform' && record.target === view.camera,
      ).length;
      wrapperStyleWrites += records.filter(
        (record) => record.attributeName === 'style' && record.target === view.panLayer,
      ).length;
    });
    observer.observe(view.camera, { attributes: true, attributeFilter: ['transform'] });
    observer.observe(view.panLayer, { attributes: true, attributeFilter: ['style'] });

    act2Harness.player.progress = 0.5;
    rerenderMap(view.rerender);
    await Promise.resolve();
    observer.disconnect();

    expect(cameraValues(view.camera)).toEqual(opening);
    expect(rootTransformWrites).toBe(0);
    expect(wrapperStyleWrites).toBeGreaterThan(0);
    expect(view.panLayer.style.transform).not.toBe('none');
    expect(view.panLayer.style.willChange).toBe('transform');
    const middle = composedCameraValues(view.camera, view.panLayer);
    expect(middle.scale).toBeLessThan(opening.scale);
    expect(middle.scale).toBeGreaterThan(0);

    Object.assign(act2Harness.player, { progress: 1, playing: false, regrowing: false });
    rerenderMap(view.rerender);
    expect(view.panLayer.style.willChange).toBe('');
  });

  it('act2-camera-compositor-folds-exactly-and-cleans-up: folds a changed picture into SVG exactly once and resets the wrapper without a camera jump', async () => {
    window.history.replaceState(null, '', '/?act2=intro');
    const view = await mountMap();
    act2Harness.player.progress = 0.5;
    rerenderMap(view.rerender);
    const beforeFold = composedCameraValues(view.camera, view.panLayer);

    let rootTransformWrites = 0;
    const observer = new MutationObserver((records) => {
      rootTransformWrites += records.filter(
        (record) => record.attributeName === 'transform' && record.target === view.camera,
      ).length;
    });
    observer.observe(view.camera, { attributes: true, attributeFilter: ['transform'] });
    act2Harness.regrowLayer = emptyRegrowLayer();
    rerenderMap(view.rerender);
    await Promise.resolve();
    observer.disconnect();

    expect(rootTransformWrites).toBe(1);
    expect(view.panLayer.style.transform).toBe('none');
    expect(view.panLayer.style.willChange).toBe('');
    // "No camera jump" is a statement about the PICTURE, so the composed values are held to the
    // precision a transform string round-trips at, not to bit equality: the fold multiplies the
    // compositor's scale into the SVG camera and both legs are parsed back out of `transform`
    // strings, so the product can land one ulp off its factors (it did, on 2026-09-06, when the
    // ADR-0521 layout moved the fixture world's extent onto such a rounding edge — 1.7442324778214051
    // against …053). A jump the eye could see is ten orders of magnitude larger than this tolerance.
    const afterFold = composedCameraValues(view.camera, view.panLayer);
    expect(afterFold.tx).toBeCloseTo(beforeFold.tx, 6);
    expect(afterFold.ty).toBeCloseTo(beforeFold.ty, 6);
    expect(afterFold.scale).toBeCloseTo(beforeFold.scale, 9);
  });
});

describe('act2-regrow-camera-owns-input-only-until-settle', () => {
  it('holds wheel, pointer and keyboard inert, then resumes all ordinary controls from fit', async () => {
    window.history.replaceState(null, '', '/?act2=intro');
    const view = await mountMap();
    const scripted = cameraValues(view.camera);

    fireEvent.wheel(view.viewport, { deltaY: -100, clientX: 400, clientY: 300 });
    fireEvent.pointerDown(view.viewport, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(view.viewport, { pointerId: 1, clientX: 150, clientY: 140 });
    fireEvent.pointerUp(view.viewport, { pointerId: 1, clientX: 150, clientY: 140 });
    fireEvent.keyDown(view.viewport, { key: 'ArrowRight' });
    expect(cameraValues(view.camera)).toEqual(scripted);

    act2Harness.player.progress = 1;
    act2Harness.player.playing = false;
    act2Harness.player.regrowing = false;
    rerenderMap(view.rerender);
    const fitted = cameraValues(view.camera);
    expect(fitted.scale).toBeLessThan(scripted.scale);

    fireEvent.wheel(view.viewport, { deltaY: -100, clientX: 400, clientY: 300 });
    expect(cameraValues(view.camera).scale).toBeGreaterThan(fitted.scale);
    fireEvent.keyDown(view.viewport, { key: 'ArrowRight' });
    const keyed = cameraValues(view.camera);
    expect(keyed.tx).not.toBe(fitted.tx);
    fireEvent.pointerDown(view.viewport, { button: 0, pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(view.viewport, { pointerId: 2, clientX: 140, clientY: 130 });
    fireEvent.pointerUp(view.viewport, { pointerId: 2, clientX: 140, clientY: 130 });
    expect(cameraValues(view.camera).tx).not.toBe(keyed.tx);
  });
});

describe('act2-regrow-camera-reduces-motion-and-settles-exactly', () => {
  it('keeps reduced motion fitted and performs zero later transform writes after settle', async () => {
    window.history.replaceState(null, '', '/?act2=intro');
    act2Harness.reducedMotion = true;
    const reduced = await mountMap();
    const fitted = cameraValues(reduced.camera);
    act2Harness.player.progress = 0.6;
    rerenderMap(reduced.rerender);
    expect(cameraValues(reduced.camera)).toEqual(fitted);
    reduced.unmount();

    act2Harness.reducedMotion = false;
    Object.assign(act2Harness.player, { progress: 1, playing: false, regrowing: false });
    const settled = await mountMap();
    const settledTransform = settled.camera.getAttribute('transform');
    let transformWrites = 0;
    const observer = new MutationObserver((records) => {
      transformWrites += records.filter((record) => record.attributeName === 'transform').length;
    });
    observer.observe(settled.camera, { attributes: true, attributeFilter: ['transform'] });
    rerenderMap(settled.rerender);
    await Promise.resolve();
    observer.disconnect();
    expect(settled.camera.getAttribute('transform')).toBe(settledTransform);
    expect(transformWrites).toBe(0);
  });

  it('replaces an initial deep-link focus with exact fit before latching regrow entry', async () => {
    window.history.replaceState(null, '', '/?act2=intro');
    const view = await mountMap({ focus: 'story-20' });
    const opening = cameraValues(view.camera);

    Object.assign(act2Harness.player, { progress: 1, playing: false, regrowing: false });
    rerenderMap(view.rerender, { focus: 'story-20' });
    const fitted = cameraValues(view.camera);
    expect(fitted.scale).toBeCloseTo(opening.scale / ACT2_REGROW_OPENING_SCALE, 12);

    fireEvent.keyDown(view.viewport, { key: 'ArrowRight' });
    expect(cameraValues(view.camera).tx).not.toBe(fitted.tx);
  });

  it('settles a parked retained tree, stays write-free, and returns with controls instead of resuming', async () => {
    window.history.replaceState(null, '', '/?act2=intro');
    Object.assign(act2Harness.player, { progress: 0.4, playing: true, regrowing: true });
    const view = await mountMap({ active: true });
    const scripted = cameraValues(view.camera);

    rerenderMap(view.rerender, { active: false });
    const fitted = cameraValues(view.camera);
    expect(fitted.scale).toBeLessThan(scripted.scale);
    expect(act2Harness.inputs.at(-1)?.enabled).toBe(false);

    let laterWrites = 0;
    const observer = new MutationObserver((records) => {
      laterWrites += records.filter((record) => record.attributeName === 'transform').length;
    });
    observer.observe(view.camera, { attributes: true, attributeFilter: ['transform'] });
    rerenderMap(view.rerender, { active: false });
    await Promise.resolve();
    observer.disconnect();
    expect(cameraValues(view.camera)).toEqual(fitted);
    expect(laterWrites).toBe(0);

    Object.assign(act2Harness.player, { progress: 1, playing: false, regrowing: false });
    rerenderMap(view.rerender, { active: true });
    expect(cameraValues(view.camera)).toEqual(fitted);
    fireEvent.wheel(view.viewport, { deltaY: -100, clientX: 400, clientY: 300 });
    expect(cameraValues(view.camera).scale).toBeGreaterThan(fitted.scale);
  });

  it('disabling the real player cancels its requested frame, and holds the run it was mid-way through', async () => {
    const actual = await vi.importActual<typeof import('./act2Intro.js')>('./act2Intro.js');
    let pending: FrameRequestCallback | null = null;
    let now = 0;
    const cancelFrame = vi.fn(() => {
      pending = null;
    });
    const clock = {
      requestFrame: (callback: FrameRequestCallback) => {
        pending = callback;
        return 1;
      },
      cancelFrame,
      now: () => now,
    };
    const deliverFrame = (): void => {
      const callback = pending;
      pending = null;
      if (callback) act(() => callback(now));
    };
    const graph = [
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
    ];
    const hook = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        actual.useAct2Intro({ enabled, stories: graph, edges: [], clock }),
      { initialProps: { enabled: true } },
    );
    act(() => hook.result.current.replay());
    expect(pending).not.toBeNull();
    const durationMs = hook.result.current.plan!.durationMs;

    now += durationMs / 4;
    deliverFrame();
    const midRun = hook.result.current.progress;
    expect(midRun).toBeGreaterThan(0.2);

    // Parking the map route cancels the frame in flight and asks for no other. That is the whole
    // frame-cost claim (ADR-0272): a map nobody can see must not be repainting, which is exactly
    // why the run has to continue in TIME rather than in paints.
    hook.rerender({ enabled: false });
    expect(cancelFrame).toHaveBeenCalled();
    expect(pending, 'nothing is scheduled against a parked map').toBeNull();

    // The owner spends a while on the other surface. The forest grew through it (ADR-0469): before,
    // this returned a cursor of exactly 1 — a run that jumped to its own ending unseen.
    now += durationMs / 4;
    hook.rerender({ enabled: true });
    expect(hook.result.current.progress).toBeGreaterThan(midRun);
    expect(hook.result.current.progress).toBeLessThan(1);
    expect(hook.result.current.playing).toBe(true);
  });
});

describe('act2-regrow-camera-preserves-the-run-and-reports-its-cost', () => {
  it('makes growth-only write-free and runs the shipped hybrid unchanged in the 40-island final-product probe', async () => {
    window.history.replaceState(null, '', '/?act2=intro&cameraRasterisation=probe&cameraVariant=growth-only');
    const control = await mountMap();
    const fitted = cameraValues(control.camera);
    const controlRevision = window.__storytreeCameraRasterisationProbe?.snapshot().pictureRevision;
    expect(controlRevision).toBeGreaterThan(0);
    act2Harness.player.progress = 0.5;
    rerenderMap(control.rerender);
    expect(cameraValues(control.camera)).toEqual(fitted);
    expect(window.__storytreeCameraRasterisationProbe?.snapshot().pictureRevision).toBe(controlRevision);
    act2Harness.regrowLayer = emptyRegrowLayer();
    rerenderMap(control.rerender);
    expect(window.__storytreeCameraRasterisationProbe?.snapshot().pictureRevision).toBe(
      (controlRevision ?? 0) + 1,
    );
    control.unmount();

    act2Harness.regrowLayer = null;
    Object.assign(act2Harness.player, { progress: 0, playing: true, regrowing: true });
    window.history.replaceState(null, '', '/?act2=intro&cameraRasterisation=probe&cameraVariant=final-product');
    const product = await mountMap();
    const opening = cameraValues(product.camera);
    expect(opening.scale).toBeGreaterThan(fitted.scale);
    const productRevision = window.__storytreeCameraRasterisationProbe?.snapshot().pictureRevision;
    expect(productRevision).toBeGreaterThan(0);

    let rootTransformWrites = 0;
    let wrapperStyleWrites = 0;
    const observer = new MutationObserver((records) => {
      rootTransformWrites += records.filter(
        (record) => record.attributeName === 'transform' && record.target === product.camera,
      ).length;
      wrapperStyleWrites += records.filter(
        (record) => record.attributeName === 'style' && record.target === product.panLayer,
      ).length;
    });
    observer.observe(product.camera, { attributes: true, attributeFilter: ['transform'] });
    observer.observe(product.panLayer, { attributes: true, attributeFilter: ['style'] });
    act2Harness.player.progress = 0.5;
    rerenderMap(product.rerender);
    await Promise.resolve();
    observer.disconnect();

    expect(cameraValues(product.camera)).toEqual(opening);
    expect(rootTransformWrites).toBe(0);
    expect(wrapperStyleWrites).toBeGreaterThan(0);
    expect(product.panLayer.style.willChange).toBe('transform');
    const middle = composedCameraValues(product.camera, product.panLayer);
    expect(middle.scale).toBeLessThan(opening.scale);
    expect(middle.scale).toBeGreaterThan(0);
    expect(window.__storytreeCameraRasterisationProbe?.snapshot().pictureRevision).toBe(productRevision);
    act2Harness.regrowLayer = emptyRegrowLayer();
    rerenderMap(product.rerender);
    const changedSnapshot = window.__storytreeCameraRasterisationProbe?.snapshot();
    expect(changedSnapshot?.pictureRevision).toBe((productRevision ?? 0) + 1);
    expect(product.panLayer.style.transform).toBe('none');
    expect(product.panLayer.style.willChange).toBe('');
    expect(changedSnapshot?.corpus.mappedIslandCount).toBe(40);
  });
});
