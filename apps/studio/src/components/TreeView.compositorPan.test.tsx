// @vitest-environment jsdom
//
// ADR-0272 decision 2 (owner-picked option (a): commit-on-release — DECIDED, not re-opened here).
// A forest drag moves the ALREADY-RASTERISED map on the compositor: the live per-frame write during
// a gesture targets a new HTML `.world-pan-layer` wrapper's CSS `transform` (a cheap compositor-only
// repaint), never the SVG `<g class="world-camera">` attribute (writing that invalidates paint for
// the whole subtree — the measured 275ms/frame cost ADR-0272 pins). The `<g>` commits the COMPOSED
// camera exactly once — on release, or on a bounded mid-gesture fold-back — and the wrapper folds
// back to identity in the SAME visual frame (a `useLayoutEffect` subtracting the folded offset, per
// the spec — never assigning zero, which would drop in-flight movement).
//
// This file proves the MECHANISM (which element's transform moves, and when) and the ARITHMETIC (the
// composed camera is, at every instant, identical to what today's shipped `<g>`-only path would
// produce for the same pointer sequence) with jsdom + a controllable fake rAF, reusing the real
// `TreeView` + the `AppDataContext` / mocked-tree mount shape from `TreeView.pan.test.tsx`. It does
// NOT and cannot honestly prove FPS, paint time, or a felt improvement — that is the owner's
// ADR-0070 stage-2 attestation, not this gate's concern.
//
// Must-not-regress surfaces this file drives THROUGH (not around) rather than assuming: the stage-1
// coalescer (`dragPastSlop` still crosses `DRAG_SLOP` before a real drag starts, and each burst still
// schedules exactly one rAF), the LAZY pointer capture (taken on the first real move, never on
// pointerdown), and `suppressClickRef`-style click suppression via the same `sceneTapSelect` fallback
// path a real click uses. Keyboard pan, wheel's non-drag semantics, the `StudioWorldChrome` memo
// boundary and `SceneView`'s `React.memo` are unaffected by this capability and stay covered by
// `TreeView.pan.test.tsx` / `TreeView.test.ts` — not re-proven here.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AppDataContext, type AppData } from '../lib/appData';
import type { TreeStory } from '../types';

import { ACT2_INTRO_SESSION_KEY } from './act2Intro.js';
import { HttpDouble, installHttpDouble } from '../test/httpDouble';

// THE SEAMS ARE REAL, NOT MOCKED MODULES (anti-slop-adoption-arc inc-06, `no-module-mocking`).
//
// SIX SUBSTITUTIONS SURVIVE and they are all COMPONENTS — the world renderer (an SVG scene jsdom
// cannot lay out) and five heavy overlays with nothing to do with panning. They arrive through
// `StudioSurfacesContext`, whose defaults are the real components.
//
// FOUR PURE FUNCTIONS STOPPED BEING SUBSTITUTED, and that is the real gain here. Because `vi.mock`
// replaces a WHOLE module, stubbing `WorldSceneView` took `laneLayout`,
// `neighbourHighlightPlan`, `normalizeWorldPresentationModel` and `deriveIslandVegetationPlans`
// down with it — replaced by `null`/`{}`/an empty Map, so the map's presentation model was never
// computed under test at all. They now run for real, on the real world, on every render below.
//
// The THREE lib hooks (`useBuildActivity`, `useClaimActivity`, `useSessionClaimGroups`) also stopped
// being mocked: each is a poll over the api, and the doubled transport answers them honestly —
// `{builds: null}` / `{claims: null}` is the store-absent case they already had to handle.
const TREE = '/api/tree';
const ACTIVITY = '/api/activity';
const CLAIMS = '/api/claims';
let http: HttpDouble;

/** The renderer + overlays this suite stands in for. Everything else stays the real component. */
const SURFACES: Partial<StudioSurfaces> = {
  WorldSceneView: ({ events }) => (
    <g data-testid="scene-story" data-story-id="map" onClick={() => events?.onSelectStory?.('map')} />
  ),
  WorldLegend: () => null,
  LegendDrawerBody: () => null,
  WorldSettingsPanel: () => null,
  LibraryDrawer: () => null,
  BottomDock: () => null,
};
import { TreeView, StudioSurfacesContext, type StudioSurfaces } from './TreeView';

const STORY: TreeStory = {
  id: 'map',
  title: 'Map responsiveness',
  outcome: 'The forest remains responsive while panning.',
  status: 'proposed',
  proofMode: 'test',
  uatWitness: 'machine',
  dependsOn: [],
  consumedBy: [],
  capabilities: [],
};

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

interface FakeFrames {
  request: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  run(frame: number): void;
}

let restorePointerEvent: (() => void) | undefined;

function installFakeFrames(): FakeFrames {
  let nextFrame = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback): number => {
    const frame = nextFrame++;
    callbacks.set(frame, callback);
    return frame;
  });
  // Intentionally retain callbacks after cancellation: this lets a test prove a late callback cannot
  // consume a newer gesture's movement, or resurrect a dead component after unmount.
  const cancel = vi.fn((_frame: number): void => {});
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  // jsdom has no PointerEvent constructor. Testing Library then falls back to a bare Event, which
  // drops `button`/coordinates and correctly leaves TreeView's real left-button drag guard inert.
  // Give this integration test a minimal MouseEvent-backed pointer constructor instead.
  const previous = Object.getOwnPropertyDescriptor(window, 'PointerEvent');
  class PointerEventShim extends window.MouseEvent {
    readonly pointerId: number;

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
    }
  }
  Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventShim });
  restorePointerEvent = () => {
    if (previous) Object.defineProperty(window, 'PointerEvent', previous);
    else delete (window as { PointerEvent?: unknown }).PointerEvent;
  };
  return {
    request,
    cancel,
    run(frame): void {
      const callback = callbacks.get(frame);
      if (!callback) throw new Error(`missing frame ${frame}`);
      act(() => callback(0));
    },
  };
}

/** Parses the SVG `<g class="world-camera">`'s `transform` attribute. */
function cameraValues(camera: Element) {
  const transform = camera.getAttribute('transform');
  const match = transform?.match(/^translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)$/);
  if (!match) throw new Error(`unexpected camera transform: ${transform}`);
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) };
}

/** The `.world-pan-layer` HTML wrapper's live CSS translate offset — {x:0,y:0} for an absent/identity
 *  transform. Never throws on an unexpected format: a mismatch surfaces as an ordinary (NaN)
 *  assertion failure rather than a runtime error. */
function panLayerOffset(panLayer: Element) {
  const transform = (panLayer as HTMLElement).style.transform;
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  const match = transform.match(/translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*,\s*0(?:px)?\s*\)/);
  if (!match) return { x: NaN, y: NaN };
  return { x: Number(match[1]), y: Number(match[2]) };
}

async function mountMap(): Promise<{
  container: HTMLElement;
  viewport: HTMLElement;
  camera: Element;
  panLayer: Element;
  unmount: () => void;
}> {
  const rendered = render(
    <StudioSurfacesContext.Provider value={SURFACES}>
      <AppDataContext.Provider value={APP_DATA}>
        <TreeView focus={null} />
      </AppDataContext.Provider>
    </StudioSurfacesContext.Provider>,
  );
  const viewport = await screen.findByLabelText('story forest map (pan and zoom)');
  const camera = await waitFor(() => {
    const element = rendered.container.querySelector('.world-camera');
    expect(element?.getAttribute('transform')).toBeTruthy();
    return element!;
  });
  // The compositor-pan wrapper (ADR-0272 decision 2): an HTML `<div class="world-pan-layer">` inside
  // `.world-viewport`, wrapping `<svg class="world-scene">`. Asserted up front so every test below
  // fails loudly and structurally if the wrapper is absent, rather than tripping over a null later.
  const panLayer = rendered.container.querySelector('.world-pan-layer');
  expect(panLayer).not.toBeNull();
  return { container: rendered.container, viewport, camera, panLayer: panLayer!, unmount: rendered.unmount };
}

/** Presses, jitters (still a click), then crosses `DRAG_SLOP` into a real drag totalling (+26, +22). */
function dragPastSlop(viewport: HTMLElement): void {
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 106, clientY: 104 }); // jitter, within slop
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 120, clientY: 115 }); // +14, +11
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 132, clientY: 126 }); // +12, +11
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  // ADR-0286: mark this browser session as having already ARRIVED at the map, so no Act 2 regrow
  // plays. These are PAN tests — they need the settled forest to drag, which is exactly what a
  // returning visitor in the same session gets. Without it every test file is a fresh jsdom and
  // therefore a first visit, and the map under the pointer would be mid-regrow.
  window.sessionStorage.setItem(ACT2_INTRO_SESSION_KEY, '1');
  http = installHttpDouble();
  http.get(TREE, () => ({ stories: [STORY], builds: [], claims: [] }));
  // The advisory live layers answer store-absent, which is the quiet case these suites want.
  http.get(ACTIVITY, () => ({ builds: null, claims: null }));
  http.get(CLAIMS, () => ({ sessions: null }));
});

afterEach(() => {
  cleanup();
  http.uninstall();
  restorePointerEvent?.();
  restorePointerEvent = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('compositor-pan-freezes-the-world-camera-during-a-gesture', () => {
  it('compositor-pan-freezes-the-world-camera-during-a-gesture: the live per-frame write lands on the wrapper, never on the <g>', async () => {
    const frames = installFakeFrames();
    const { viewport, camera, panLayer } = await mountMap();
    const before = cameraValues(camera);
    expect(panLayerOffset(panLayer)).toEqual({ x: 0, y: 0 });

    dragPastSlop(viewport);
    frames.run(1);

    // The <g class="world-camera"> transform is FROZEN for the whole gesture — a live pan must
    // never write it (that invalidates paint for the whole SVG subtree, ADR-0272's measured cost).
    expect(cameraValues(camera)).toEqual(before);
    // The coalesced delta lands on the HTML wrapper instead — the cheap compositor-only repaint.
    expect(panLayerOffset(panLayer)).toEqual({ x: 26, y: 22 });
  });
});

describe('compositor-pan-commits-the-composed-camera-on-release', () => {
  it('compositor-pan-commits-the-composed-camera-on-release: the <g> takes the full gesture total exactly once, and the wrapper folds back to identity in the same frame', async () => {
    const frames = installFakeFrames();
    const { viewport, camera, panLayer } = await mountMap();
    const before = cameraValues(camera);

    dragPastSlop(viewport);
    frames.run(1);
    expect(cameraValues(camera)).toEqual(before); // still frozen mid-gesture
    expect(panLayerOffset(panLayer)).toEqual({ x: 26, y: 22 });

    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 140, clientY: 130 }); // +8, +4
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 154, clientY: 143 }); // +14, +13
    frames.run(2);
    expect(cameraValues(camera)).toEqual(before); // the 2nd frame painted only the wrapper too
    expect(panLayerOffset(panLayer)).toEqual({ x: 48, y: 39 });

    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 154, clientY: 143 });

    // Release commits the COMPOSED total (48, 39) into the <g> — the exact numbers a `<g>`-only
    // path would have produced for this pointer sequence — and the wrapper resets to identity. Both
    // reads happen synchronously right after the pointerup handler returns, proving there is no
    // in-between frame where the pan is visually doubled (still on the wrapper AND now on the <g>)
    // or lost (on neither).
    expect(cameraValues(camera)).toEqual({ tx: before.tx + 48, ty: before.ty + 39, scale: before.scale });
    expect(panLayerOffset(panLayer)).toEqual({ x: 0, y: 0 });
  });
});

describe('compositor-pan-folds-back-mid-gesture-and-settles-every-exit', () => {
  it('compositor-pan-folds-back-mid-gesture-and-settles-every-exit: a bounded distance threshold folds back mid-gesture, before release, so a long drag can never expose an unbounded blank band', async () => {
    const frames = installFakeFrames();
    const { viewport, camera, panLayer } = await mountMap();
    const before = cameraValues(camera);

    dragPastSlop(viewport);
    frames.run(1);
    expect(panLayerOffset(panLayer)).toEqual({ x: 26, y: 22 });

    // One further, deliberately huge move — comfortably past any sane bounded-distance threshold —
    // while the pointer is STILL DOWN (no pointerup/cancel yet).
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 100132, clientY: 50126 }); // +100000, +50000
    frames.run(2);

    // The fold happened mid-gesture, before any release: the <g> already carries the WHOLE
    // accumulated total, and the wrapper is back to identity — never left holding an unbounded
    // offset that would expose blank map at the trailing edge.
    expect(cameraValues(camera)).toEqual({
      tx: before.tx + 26 + 100000,
      ty: before.ty + 22 + 50000,
      scale: before.scale,
    });
    expect(panLayerOffset(panLayer)).toEqual({ x: 0, y: 0 });
  });

  it('compositor-pan-folds-back-mid-gesture-and-settles-every-exit: pointer-cancel settles the already-painted offset and discards only the unpainted pending delta', async () => {
    const frames = installFakeFrames();
    const { viewport, camera, panLayer } = await mountMap();
    const before = cameraValues(camera);

    dragPastSlop(viewport);
    frames.run(1); // paints (26, 22) — these pixels were shown to the operator
    expect(panLayerOffset(panLayer)).toEqual({ x: 26, y: 22 });

    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 142, clientY: 131 }); // +10, +5 — queued, never painted
    fireEvent.pointerCancel(viewport, { pointerId: 1, clientX: 142, clientY: 131 });

    // Only the already-PAINTED (26, 22) settles into the <g> — snapping shown pixels back would be a
    // visible jump. The un-painted (+10, +5) is discarded, never having been shown.
    expect(cameraValues(camera)).toEqual({ tx: before.tx + 26, ty: before.ty + 22, scale: before.scale });
    expect(panLayerOffset(panLayer)).toEqual({ x: 0, y: 0 });
  });

  it('compositor-pan-folds-back-mid-gesture-and-settles-every-exit: unmount cancels the pending frame and commits nothing into the dead component', async () => {
    const frames = installFakeFrames();
    const { viewport, panLayer, unmount } = await mountMap();

    dragPastSlop(viewport);
    frames.run(1); // paints (26, 22)
    expect(panLayerOffset(panLayer)).toEqual({ x: 26, y: 22 });
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 142, clientY: 131 }); // queues a further frame

    expect(() => unmount()).not.toThrow();
    expect(frames.cancel).toHaveBeenCalled();
    // A browser can deliver a cancelled callback late, after the component is gone. It must not
    // throw and must not attempt to commit into the dead component.
    expect(() => frames.run(2)).not.toThrow();
  });

  it('compositor-pan-folds-back-mid-gesture-and-settles-every-exit: a wheel-zoom settles the live offset before anchoring, composing correctly with the fold', async () => {
    const frames = installFakeFrames();
    const { viewport, camera, panLayer } = await mountMap();
    const before = cameraValues(camera);

    dragPastSlop(viewport);
    frames.run(1);
    expect(panLayerOffset(panLayer)).toEqual({ x: 26, y: 22 });

    fireEvent.wheel(viewport, { deltaY: -100, clientX: 140, clientY: 130 });

    // The live offset settles into the <g> BEFORE the zoom is computed — the wrapper must not still
    // be carrying it afterwards (else a later commit would double it, or a later anchor would read
    // the wrong rect, ADR-0272's stated risk: "a translated wrapper moves that rect").
    expect(panLayerOffset(panLayer)).toEqual({ x: 0, y: 0 });
    const after = cameraValues(camera);
    expect(after.scale).not.toBe(before.scale); // the zoom itself still applied

    // zoom-to-cursor anchors on the POST-fold camera (tx0+26, ty0+22) — the invariant `zoomAt`
    // encodes (`next.tx = px - (px - cam.tx) * (next.scale / cam.scale)`), evaluated with the
    // FOLDED tx/ty, never the pre-fold camera (which would anchor to the wrong point and leave the
    // pan to be re-added afterward, producing different numbers since the scale changed in between —
    // this formula is not order-independent).
    const k = after.scale / before.scale;
    const px = 140;
    const py = 130;
    expect(after.tx).toBeCloseTo(px - (px - (before.tx + 26)) * k, 6);
    expect(after.ty).toBeCloseTo(py - (py - (before.ty + 22)) * k, 6);
  });
});

describe('compositor-pan-preserves-click-selection-under-a-live-offset', () => {
  it('compositor-pan-preserves-click-selection-under-a-live-offset: a coordinate-hit-test click still selects while the wrapper carries a live pan offset', async () => {
    const frames = installFakeFrames();
    const { viewport, panLayer } = await mountMap();

    dragPastSlop(viewport);
    frames.run(1);
    // The wrapper genuinely carries a live offset at the moment of the click below — proving the
    // click path is exercised "under a live offset", not merely at rest.
    expect(panLayerOffset(panLayer)).toEqual({ x: 26, y: 22 });

    const target = document.createElement('div');
    target.setAttribute('data-story-id', 'map');
    document.body.appendChild(target);
    const elementFromPoint = vi.spyOn(document, 'elementFromPoint').mockReturnValue(target);

    // A click that does NOT land on a node's own onClick (the mocked WorldSceneView's <g> above
    // never fires) falls back to the viewport's coordinate hit-test (sceneTapSelect).
    fireEvent.click(viewport, { clientX: 140, clientY: 130 });

    // The client coordinates handed to elementFromPoint must be the RAW ones the click carried —
    // never manually adjusted for the wrapper's live pan offset. A real browser's elementFromPoint
    // already resolves in client/viewport space and already accounts for any CSS transform; a
    // hand-rolled compensation here would double-count the offset and break the hit-test.
    expect(elementFromPoint).toHaveBeenCalledWith(140, 130);
    // ...and the hit-test still resolves to, and selects, the right story.
    expect(window.location.hash).toBe('#/tree/map');

    elementFromPoint.mockRestore();
    target.remove();
  });
});
