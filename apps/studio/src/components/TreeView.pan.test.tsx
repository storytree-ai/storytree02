// @vitest-environment jsdom
//
// The real map wiring is deliberately exercised here: a fake rAF lets the test prove that a burst
// of pointermoves has one camera commit, while pointer-up flushes its trailing movement and cancel /
// unmount discard it. Heavy non-map overlays are mocked so this stays a focused interaction test.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useState } from 'react';
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
import { StudioWorldChrome, TreeView, type HexWorld, StudioSurfacesContext, type StudioSurfaces } from './TreeView';

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
  // Intentionally retain callbacks after cancellation: this lets each test prove a late callback
  // cannot consume a newer delta or set camera state after cancellation.
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

function cameraValues(camera: Element) {
  const transform = camera.getAttribute('transform');
  const match = transform?.match(/^translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)$/);
  if (!match) throw new Error(`unexpected camera transform: ${transform}`);
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) };
}

/** The `.world-pan-layer` wrapper's live CSS translate — {x:0,y:0} for an absent/identity transform. */
function panLayerOffset(panLayer: Element) {
  const transform = (panLayer as HTMLElement).style.transform;
  if (!transform || transform === 'none') return { x: 0, y: 0 };
  const match = transform.match(/translate3d\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px\s*,\s*0(?:px)?\s*\)/);
  if (!match) return { x: NaN, y: NaN };
  return { x: Number(match[1]), y: Number(match[2]) };
}

/**
 * The COMPOSED camera the operator actually sees: the `.world-camera` `<g>` transform composed with
 * the `.world-pan-layer` CSS transform. The SVG carries no viewBox (1 user unit == 1 CSS pixel) and
 * the wrapper translate is applied outside it, so the two translations simply add in screen space.
 *
 * This capability's contracts are stated against this value, not against the `<g>` alone (ADR-0272
 * decision 2 moved the live per-frame write onto the wrapper — see `compositor-pan-transform`). What
 * this file protects is the frame BOUNDARY — one commit per burst carrying the cumulative latest
 * delta, never a replay of stale intermediates — and that is invariant across where the write lands.
 */
function composedCamera(camera: Element, panLayer: Element) {
  const g = cameraValues(camera);
  const layer = panLayerOffset(panLayer);
  return { tx: g.tx + layer.x, ty: g.ty + layer.y, scale: g.scale };
}

async function mountMap(): Promise<{
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
  const panLayer = rendered.container.querySelector('.world-pan-layer');
  expect(panLayer).not.toBeNull();
  return { viewport, camera, panLayer: panLayer!, unmount: rendered.unmount };
}

function dragPastSlop(viewport: HTMLElement): void {
  fireEvent.pointerDown(viewport, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  // Jitter remains a click, and becomes the drag's incremental anchor once it crosses the threshold.
  fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 106, clientY: 104 });
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

// The story rows carry the WHOLE `TreeStory` (anti-slop `no-chained-type-assertions`, inc-09): the
// `as unknown as HexWorld` chain hid five missing fields — `outcome`, `proofMode`, `uatWitness`,
// `dependsOn`, `consumedBy` — so the chrome under test was reading a world no server would send.
function chromeProbeWorld(): HexWorld {
  return {
    width: 200,
    height: 200,
    offset: { x: 0, y: 0 },
    empties: [],
    drawTiles: [],
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: [
      {
        story: {
          id: 'studio',
          title: 'Studio',
          outcome: '',
          status: 'healthy',
          proofMode: 'red-green',
          uatWitness: 'human',
          dependsOn: [],
          consumedBy: [],
          capabilities: [],
        },
        tiles: [],
        centroid: { x: 50, y: 50 },
        radius: 30,
        groundRadius: 30,
        treeSpot: { x: 50, y: 45 },
        // ADR-0527 D1: these fixtures exercise studio CHROME (pan, panels), which reads the
        // SCREEN anchors above; the ground twins are stated so the literal satisfies
        // `Territory` and are deliberately the same numbers — this chrome never projects.
        groundCentroid: { x: 50, y: 50 },
        groundTreeSpot: { x: 50, y: 45 },
        // The pre-snap ground anchor (`Territory.groundSeed`). Chrome never reads it; it is here
        // because the packer always emits it, and a fixture that omitted it would not be a world.
        groundSeed: { x: 50, y: 45 },
        caps: [],
        decor: [],
        wheatTiles: new Set<string>(),
        coastGroundLoops: [],
        labelY: 80,
        // its GROUND twin (ADR-0545) — the baseline the marker scatter reads; 80 / sin 20 degrees
        groundLabelY: 80 / Math.sin((20 * Math.PI) / 180),
        stamps: [{ icon: 'library', spot: { x: 50, y: 50 } }],
        buildingGlyph: false,
      },
    ],
  } satisfies Partial<HexWorld> as HexWorld;
}

function CameraChromeProbe({
  world,
  hidden,
  onStampClick,
}: {
  world: HexWorld;
  hidden: ReadonlySet<string>;
  onStampClick: (id: string) => void;
}) {
  const [cameraX, setCameraX] = useState(0);
  return (
    <>
      <button type="button" onClick={() => setCameraX((x) => x + 26)}>
        advance camera
      </button>
      <svg>
        <g data-testid="chrome-camera" transform={`translate(${cameraX} 0)`}>
          <StudioWorldChrome world={world} hidden={hidden} onStampClick={onStampClick} buildings />
        </g>
      </svg>
    </>
  );
}

describe('TreeView drag pan', () => {
  it('pan-frame-coalesces-pointer-bursts: schedules exactly one camera frame for a pre-frame move burst', async () => {
    const frames = installFakeFrames();
    const { viewport, camera } = await mountMap();
    const before = cameraValues(camera);
    expect(window.requestAnimationFrame).toBe(frames.request);

    dragPastSlop(viewport);

    expect(frames.request).toHaveBeenCalledTimes(1);
    expect(cameraValues(camera)).toEqual(before); // no camera state update for each raw pointermove
  });

  it('pan-frame-commits-the-latest-cumulative-delta: lands the total and independently coalesces a later burst', async () => {
    const frames = installFakeFrames();
    const { viewport, camera, panLayer } = await mountMap();
    const before = cameraValues(camera);

    dragPastSlop(viewport);
    frames.run(1);
    // Asserted against the COMPOSED camera (see composedCamera): the flushed frame lands the
    // cumulative delta on what the operator sees, wherever the write physically goes.
    expect(composedCamera(camera, panLayer)).toEqual({
      tx: before.tx + 26,
      ty: before.ty + 22,
      scale: before.scale,
    });

    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 140, clientY: 130 }); // +8, +4
    fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 154, clientY: 143 }); // +14, +13
    expect(frames.request).toHaveBeenCalledTimes(2);
    frames.run(2);

    // One later frame, the later cumulative total — not a replay of the intermediate (+8,+4).
    expect(composedCamera(camera, panLayer)).toEqual({
      tx: before.tx + 48,
      ty: before.ty + 39,
      scale: before.scale,
    });
  });

  it('pan-frame-settles-or-cancels-pending-work-safely: pointer-up flushes, cancel suppresses its synthetic click, and unmount drops work', async () => {
    const frames = installFakeFrames();
    const { viewport, camera, panLayer, unmount } = await mountMap();
    const before = cameraValues(camera);

    dragPastSlop(viewport);
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 132, clientY: 126 });
    expect(frames.cancel).toHaveBeenNthCalledWith(1, 1);
    // Release keeps the final legal position. (Composed, per this file's contract note — here the
    // release has already folded the wrapper back to identity, so composed IS the `<g>` value.)
    expect(composedCamera(camera, panLayer)).toEqual({
      tx: before.tx + 26,
      ty: before.ty + 22,
      scale: before.scale,
    });
    frames.run(1);
    expect(composedCamera(camera, panLayer)).toEqual({
      tx: before.tx + 26,
      ty: before.ty + 22,
      scale: before.scale,
    });

    dragPastSlop(viewport);
    fireEvent.pointerCancel(viewport, { pointerId: 1, clientX: 132, clientY: 126 });
    expect(frames.cancel).toHaveBeenNthCalledWith(2, 2);
    // The queued delta was never painted, so cancellation discards it and the view does not move.
    expect(composedCamera(camera, panLayer)).toEqual({
      tx: before.tx + 26,
      ty: before.ty + 22,
      scale: before.scale,
    });

    // A cancellation's same-gesture click remains swallowed, but the next genuine pointerdown clears
    // that suppression and its story click navigates normally.
    fireEvent.click(screen.getByTestId('scene-story'));
    expect(window.location.hash).toBe('');
    fireEvent.pointerDown(viewport, { button: 0, pointerId: 3, clientX: 100, clientY: 100 });
    fireEvent.click(screen.getByTestId('scene-story'));
    expect(window.location.hash).toBe('#/tree/map');

    // A browser can deliver a cancelled callback late. Start the next drag first: the old frame must
    // not consume the new gesture's delta or clear its live frame handle.
    dragPastSlop(viewport);
    expect(frames.request).toHaveBeenCalledTimes(3);
    frames.run(2);
    // The stale cancelled frame must not consume the NEW gesture's pending delta.
    expect(composedCamera(camera, panLayer)).toEqual({
      tx: before.tx + 26,
      ty: before.ty + 22,
      scale: before.scale,
    });
    frames.run(3);
    // The new gesture's own frame lands its cumulative delta. Mid-gesture that write is on the pan
    // layer rather than the `<g>` — which is precisely why this is asserted composed.
    expect(composedCamera(camera, panLayer)).toEqual({
      tx: before.tx + 52,
      ty: before.ty + 44,
      scale: before.scale,
    });
    fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 132, clientY: 126 });

    fireEvent.pointerDown(viewport, { button: 0, pointerId: 4, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(viewport, { pointerId: 4, clientX: 120, clientY: 100 });
    unmount();
    expect(frames.cancel).toHaveBeenNthCalledWith(3, 4);
    expect(() => frames.run(4)).not.toThrow();
  });

  it('pan-frame-skips-camera-neutral-studio-chrome: a parent camera transform changes without re-running chrome', () => {
    const world = chromeProbeWorld();
    const territories = world.territories;
    const territoryReads = vi.fn(() => territories);
    Object.defineProperty(world, 'territories', { configurable: true, get: territoryReads });
    const hidden = new Set<string>();
    const onStampClick = vi.fn();

    const { container } = render(
      <CameraChromeProbe world={world} hidden={hidden} onStampClick={onStampClick} />,
    );
    const chrome = container.querySelector('.studio-world-chrome');
    const chromeAtFirstPaint = chrome?.innerHTML;
    const readsAtFirstPaint = territoryReads.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'advance camera' }));

    expect(screen.getByTestId('chrome-camera').getAttribute('transform')).toBe('translate(26 0)');
    expect(territoryReads).toHaveBeenCalledTimes(readsAtFirstPaint);
    expect(container.querySelector('.studio-world-chrome')?.innerHTML).toBe(chromeAtFirstPaint);

    // The standalone memo probe above establishes React's runtime boundary. Keep its actual TreeView
    // caller honest too: a fresh inline callback here would defeat that boundary on every camera pan.
    const source = readFileSync(resolve(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), 'src', 'components', 'TreeView.tsx'), 'utf8');
    expect(source).toMatch(/export const StudioWorldChrome = memo\(/);
    expect(source).toMatch(/const onStampClickStable = useCallback/);
    expect(source).toMatch(/<StudioWorldChrome[\s\S]*?onStampClick=\{onStampClickStable\}/);
  });
});
