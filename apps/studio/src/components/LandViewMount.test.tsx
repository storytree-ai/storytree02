// @vitest-environment jsdom
//
// LandViewMount.test.tsx — the land layer's own branches: what it draws, what it refuses, and what
// it must never do to the map above it.
//
// ⚠ THE REFUSAL BRANCHES ARE THE POINT, not the happy one. A land layer that draws SOMETHING when
// it could not be registered is worse than one that draws nothing: the map's whole job is to say
// which island you are looking at, and a ground half a screen out of register says the wrong one
// confidently. So every path that cannot produce a registered camera has to reach the same place —
// an empty, inert layer — and each is asserted separately rather than trusted to fall through.
//
// ⚠ THE CANVAS IS A SLOT, so this is provable in jsdom without pulling three.js into a headless
// runner. `vi.mock` is lint-refused here (`anti-slop/no-module-mocking`) and would take the real
// arithmetic with it; `renderCanvas` substitutes the one thing a headless runner cannot execute —
// a WebGL context — and leaves the stream conversion, the registration and every branch real.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

import { LAND_CAMERA_ELEVATION_DEG, groundFlattening, type SceneG } from '@storytree/forest-world';

import { LandViewMount, type LandMountCanvasProps } from './LandViewMount';
import type { Camera } from '../lib/worldCamera';

/** One island's ground group as `buildScene` emits it, in the DRAWING's already-squashed
 *  coordinates — the same shape `landView.test.ts` builds, because it is what the map hands over. */
function drawnIsland(island: string, capability: string, half: number): SceneG {
  const s = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  const ring = [
    [-half, -half * s],
    [half, -half * s],
    [half, half * s],
    [-half, half * s],
  ];
  return {
    el: 'g',
    kind: 'ground',
    id: island,
    status: 'healthy',
    children: [
      {
        el: 'g',
        kind: 'parcel',
        id: capability,
        children: [{ el: 'path', kind: 'cell', d: `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z` }],
      },
    ],
  };
}

const SCENE: SceneG = { el: 'g', children: [drawnIsland('alpha', 'cap-a', 50)] };
const CAMERA: Camera = { tx: -412.5, ty: 133.25, scale: 0.6528 };

/** What the canvas was handed, captured through the seam. */
let handed: LandMountCanvasProps | null = null;
const capture = (props: LandMountCanvasProps) => {
  handed = props;
  return <div data-testid="canvas-slot" />;
};

/** The one global this suite installs, named so the install and the teardown cannot disagree
 *  about which key they are touching. */
function globalWithRO(): { ResizeObserver?: unknown } {
  return globalThis;
}

/** ⚠ jsdom ships no `ResizeObserver` and lays nothing out, and the layer refuses to mount before it
 *  has a real reading — which is correct in a browser and would make every branch below
 *  unreachable. So the frame is supplied the way a browser supplies it: a live observer stub plus a
 *  real box. Nothing else about the layer is substituted. */
function installLayout(width: number, height: number): void {
  class RO {
    constructor(private readonly cb: () => void) {}
    observe() {
      this.cb();
    }
    disconnect() {}
  }
  globalWithRO().ResizeObserver = RO;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
}

const originalRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  handed = null;
  installLayout(1600, 900);
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalRect;
  delete globalWithRO().ResizeObserver;
});

function mount(props: Partial<Parameters<typeof LandViewMount>[0]> = {}) {
  return render(
    <LandViewMount scene={SCENE} camera={CAMERA} renderCanvas={capture} {...props} />,
  );
}

describe('the land layer under the map', () => {
  it('draws the land, and hands the canvas the camera the SVG layer is presenting', () => {
    const { container } = mount();
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    expect(layer.getAttribute('data-state')).toBe('drawn');
    expect(container.querySelector('[data-testid="canvas-slot"]')).toBeTruthy();
    // ⚠ THE ZOOM IS THE SVG CAMERA'S OWN SCALE. If this layer ever computed its own, the two
    // layers would be two opinions about where an island is — which is the one thing the sandwich
    // cannot survive.
    expect(handed!.registered.zoom).toBe(CAMERA.scale);
    expect(handed!.registered.target.x).toBeCloseTo((1600 / 2 - CAMERA.tx) / CAMERA.scale, 9);
  });

  it('forwards activity without replacing the app-owned regrow presentation', () => {
    const cursor = {
      progress: 0.5,
      settled: false,
      absentStoryIds: new Set<string>(),
      growing: [],
      hiddenSegmentIds: new Set<string>(),
      drawingSegments: [],
    };
    const { rerender } = mount({ active: false, regrowCursor: cursor });
    const parked = handed!;
    rerender(<LandViewMount scene={SCENE} camera={CAMERA} active regrowCursor={cursor} renderCanvas={capture} />);
    expect(parked.active).toBe(false);
    expect(handed!.active).toBe(true);
    expect(handed!.regrow).toBe(parked.regrow);
  });

  it('forwards the exact legend set without changing descriptors, camera, activity or regrow', () => {
    const cursor = {
      progress: 0.5,
      settled: false,
      absentStoryIds: new Set<string>(),
      growing: [],
      hiddenSegmentIds: new Set<string>(),
      drawingSegments: [],
    };
    const hidden = new Set(['healthy']);
    const { rerender } = mount({ hiddenStatuses: hidden, active: false, regrowCursor: cursor });
    const dimmed = handed!;
    expect(dimmed.hiddenStatuses).toBe(hidden);
    expect(dimmed.descriptors.some((descriptor) => descriptor.kind === 'cell-ground')).toBe(true);

    const shown = new Set<string>();
    rerender(<LandViewMount scene={SCENE} camera={CAMERA} hiddenStatuses={shown} active={false} regrowCursor={cursor} renderCanvas={capture} />);
    expect(handed!.hiddenStatuses).toBe(shown);
    expect(handed!.descriptors).toBe(dimmed.descriptors);
    expect(handed!.registered).toEqual(dimmed.registered);
    expect(handed!.registered.props).toBe(true);
    expect(handed!.regrow).toBe(dimmed.regrow);
    expect(handed!.active).toBe(false);
  });

  it('is INERT — out of the accessibility tree and out of the way of every gesture', () => {
    // ADR-0380 D6 fence 3: the app owns picking, focus, the keyboard camera and the accessible
    // name. A decorative raster that announced itself, or that caught a pointer, would take one of
    // those away. (`pointer-events: none` is the CSS half; the class is what carries it.)
    const { container } = mount();
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    expect(layer.getAttribute('aria-hidden')).toBe('true');
    expect(layer.classList.contains('land-mount')).toBe(true);
    expect(layer.getAttribute('tabindex')).toBeNull();
  });

  it('always draws the kit props — the mounted land IS the forest (ADR-0608 D1)', () => {
    // The flat SVG canopy and flora beds retired with the flat look, so the 3D trees, coverage
    // plants and UAT flowers are the only picture of them: there is no ground-only arm left to ask for.
    mount();
    expect(handed!.registered.props).toBe(true);
    expect(handed!.hiddenStatuses.size).toBe(0);
  });

  it('draws NOTHING while the world is still resolving', () => {
    const { container } = mount({ scene: null });
    expect(container.querySelector('[data-testid="land-mount"]')!.getAttribute('data-state')).toBe(
      'waiting-for-world',
    );
    expect(handed).toBeNull();
  });

  it('draws NOTHING before the SVG layer has a camera to register against', () => {
    const { container } = mount({ camera: null });
    expect(container.querySelector('[data-testid="land-mount"]')!.getAttribute('data-state')).toBe(
      'waiting-for-camera',
    );
    expect(handed).toBeNull();
  });

  it('draws NOTHING, and says why, when the camera projects nothing', () => {
    // A zero scale is the shape a camera takes before the first frame is computed. The layer must
    // report it rather than divide by it.
    const { container } = mount({ camera: { tx: 0, ty: 0, scale: 0 } });
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    expect(layer.getAttribute('data-state')).toBe('refused');
    expect(layer.getAttribute('data-reason')).toBeTruthy();
    expect(handed).toBeNull();
  });

  it('draws NOTHING, and says why, when the scene carries no land — and never throws', () => {
    // An uncaught throw in a layer INSIDE the map's own wrapper would unmount the working map with
    // it, which is a strictly worse outcome than a map with no land under it.
    const noLand: SceneG = { el: 'g', children: [{ el: 'g', kind: 'tree', id: 'alpha', children: [] }] };
    const { container } = mount({ scene: noLand });
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    expect(layer.getAttribute('data-state')).toBe('no-land');
    expect(layer.getAttribute('data-reason')).toBeTruthy();
    expect(handed).toBeNull();
  });
});
