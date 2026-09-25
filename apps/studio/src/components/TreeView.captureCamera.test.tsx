// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { AppDataContext, type AppData } from '../lib/appData';
import type { TreeStory } from '../types';
import { worldToScreen } from '../lib/worldCamera.js';
import { HttpDouble, installHttpDouble } from '../test/httpDouble';
import { StudioSurfacesContext, TreeView, type StudioSurfaces } from './TreeView';

type Camera = { tx: number; ty: number; scale: number };
type CaptureTarget =
  | { kind: 'square'; x: number; y: number; size: number }
  | { kind: 'story-node'; id: string }
  | { kind: 'island'; id: string }
  | { kind: 'resting' }
  | { kind: 'fit' };
type CaptureResult =
  | { ok: true; kind: CaptureTarget['kind']; frame: { width: number; height: number }; camera: Camera; resolved?: { id?: string; bounds?: { x: number; y: number; width: number; height: number } } }
  | { ok: false; code: 'invalid-target' | 'target-not-found' | 'invalid-frame' | 'world-unavailable' };

interface ForestCaptureCameraBridge {
  capture(target: CaptureTarget): CaptureResult;
}

declare global {
  interface Window {
    __storytreeForestCaptureCamera?: ForestCaptureCameraBridge;
  }
}

const TREE = '/api/tree';
const ACTIVITY = '/api/activity';
const CLAIMS = '/api/claims';
let http: HttpDouble;
let widthDescriptor: PropertyDescriptor | undefined;
let heightDescriptor: PropertyDescriptor | undefined;

const SURFACES: Partial<StudioSurfaces> = {
  WorldSceneView: () => <g data-testid="world-scene" />,
  LandViewMount: () => <div data-testid="land-mount" />,
  WorldLegend: () => null,
  LegendDrawerBody: () => null,
  WorldSettingsPanel: () => null,
  LibraryDrawer: () => null,
  BottomDock: () => null,
};

const APP_DATA: AppData = {
  docs: [], docIds: new Set(), docTitles: new Map(), docsStatus: 'ready', docsError: '',
  assets: [], assetsStatus: 'ready', assetsError: '',
  me: { email: 'owner@example.com', role: 'admin', status: 'active', member: true },
  refreshAssets: async () => {},
};

const STORIES: TreeStory[] = [
  { id: 'alpha', title: 'Alpha', outcome: 'first', status: 'proposed', proofMode: 'test', uatWitness: 'machine', dependsOn: [], consumedBy: [], capabilities: [] },
  { id: 'bravo', title: 'Bravo', outcome: 'second', status: 'proposed', proofMode: 'test', uatWitness: 'machine', dependsOn: ['alpha'], consumedBy: [], capabilities: [] },
];

function cameraFromMap(container: HTMLElement): Camera {
  const transform = container.querySelector('.world-camera')?.getAttribute('transform');
  const match = transform?.match(/^translate\(([^ ]+) ([^)]+)\) scale\(([^)]+)\)$/);
  if (!match) throw new Error(`expected committed camera transform, received ${transform}`);
  return { tx: Number(match[1]), ty: Number(match[2]), scale: Number(match[3]) };
}

async function mountMap() {
  const view = render(
    <StudioSurfacesContext.Provider value={SURFACES}>
      <AppDataContext.Provider value={APP_DATA}><TreeView focus={null} /></AppDataContext.Provider>
    </StudioSurfacesContext.Provider>,
  );
  await screen.findByLabelText('story forest map (pan and zoom)');
  await waitFor(() => expect(view.container.querySelector('.world-camera')?.getAttribute('transform')).toBeTruthy());
  return view;
}

function requireCapture(): ForestCaptureCameraBridge {
  expect(typeof window.__storytreeForestCaptureCamera?.capture).toBe('function');
  return window.__storytreeForestCaptureCamera!;
}

beforeEach(() => {
  widthDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  heightDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 960 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 640 });
  http = installHttpDouble();
  http.get(TREE, () => ({ stories: STORIES, builds: [], claims: [] }));
  http.get(ACTIVITY, () => ({ builds: null, claims: null }));
  http.get(CLAIMS, () => ({ sessions: null }));
});

afterEach(() => {
  cleanup();
  http.uninstall();
  delete window.__storytreeForestCaptureCamera;
  if (widthDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDescriptor);
  else delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
  if (heightDescriptor) Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDescriptor);
  else delete (HTMLElement.prototype as { clientHeight?: number }).clientHeight;
});

describe('fccs-square-is-contained-and-centred: named square capture', () => {
  it('returns an applied camera that contains and centres the whole square', async () => {
    const view = await mountMap();
    const receipt = requireCapture().capture({ kind: 'square', x: 40, y: 70, size: 20 });
    expect(receipt.ok).toBe(true);
    if (!receipt.ok) return;
    expect(receipt.kind).toBe('square');
    expect(receipt.frame.width).toBeGreaterThan(0);
    expect(receipt.frame.height).toBeGreaterThan(0);
    expect(receipt.camera).toEqual(cameraFromMap(view.container));
    const topLeft = worldToScreen(receipt.camera, 40, 70);
    const bottomRight = worldToScreen(receipt.camera, 60, 90);
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(receipt.frame.width);
    expect(bottomRight.y).toBeLessThanOrEqual(receipt.frame.height);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(receipt.frame.width / 2);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(receipt.frame.height / 2);
  });
});

describe('fccs-story-node-and-island-resolve-separately: real world targets', () => {
  it('resolves story nodes and islands by their own identifiers', async () => {
    await mountMap();
    const capture = requireCapture();
    const story = capture.capture({ kind: 'story-node', id: 'alpha' });
    const island = capture.capture({ kind: 'island', id: 'bravo' });
    expect(story).toMatchObject({ ok: true, kind: 'story-node', resolved: { id: 'alpha' } });
    expect(island).toMatchObject({ ok: true, kind: 'island', resolved: { id: 'bravo' } });
  });
});

describe('fccs-named-views-reuse-canonical-camera-policy: resting and fit', () => {
  it('returns distinct canonical named view receipts committed to the map', async () => {
    const view = await mountMap();
    const capture = requireCapture();
    const resting = capture.capture({ kind: 'resting' });
    const fit = capture.capture({ kind: 'fit' });
    expect(resting).toMatchObject({ ok: true, kind: 'resting' });
    expect(fit).toMatchObject({ ok: true, kind: 'fit' });
    if (!fit.ok) return;
    expect(fit.camera).toEqual(cameraFromMap(view.container));
  });
});

describe('fccs-refusal-preserves-the-current-camera: invalid requests', () => {
  it('refuses invalid targets without changing the committed camera', async () => {
    const view = await mountMap();
    const capture = requireCapture();
    const before = cameraFromMap(view.container);
    expect(capture.capture({ kind: 'story-node', id: 'missing' })).toEqual({ ok: false, code: 'target-not-found' });
    expect(capture.capture({ kind: 'square', x: Number.NaN, y: 0, size: 0 })).toEqual({ ok: false, code: 'invalid-target' });
    expect(cameraFromMap(view.container)).toEqual(before);
  });
});

describe('fccs-live-seam-returns-the-applied-camera-and-cleans-up: mounted lifecycle', () => {
  it('exposes the live command only while its map instance remains mounted', async () => {
    const view = await mountMap();
    const receipt = requireCapture().capture({ kind: 'square', x: 30, y: 30, size: 10 });
    expect(receipt).toMatchObject({ ok: true, kind: 'square' });
    if (receipt.ok) expect(receipt.camera).toEqual(cameraFromMap(view.container));
    view.unmount();
    expect(window.__storytreeForestCaptureCamera).toBeUndefined();
  });

  it('revokes a previously captured command when its map unmounts', async () => {
    const view = await mountMap();
    const staleCapture = requireCapture();

    view.unmount();

    expect(() => staleCapture.capture({ kind: 'square', x: 30, y: 30, size: 10 })).toThrow('unmounted');
  });
});
