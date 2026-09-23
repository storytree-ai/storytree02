// @vitest-environment jsdom
// LandView.test.tsx — the panel's four states and, above all, that it never takes the map with it.
//
// ⚠ THE CANVAS IS SUBSTITUTED AT ITS SLOT, not mocked. `vi.mock` is lint-refused in this app
// (`anti-slop/no-module-mocking`) and would replace the whole module — here that would take the
// conversion, the failure path and the measurement with it, leaving a suite that proves the stub.
// `renderCanvas` swaps the ONE thing jsdom cannot execute (a WebGL context) and everything else
// runs for real.

import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { LAND_CAMERA_ELEVATION_DEG, groundFlattening, type SceneG } from '@storytree/forest-world';

import { LandView, type LandCanvasProps } from './LandView.js';

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

const SCENE: SceneG = { el: 'g', children: [drawnIsland('alpha', 'cap-a', 40)] };

/** A canvas double that RECORDS what it was handed — the panel's whole contract with the renderer. */
function recordingCanvas(seen: LandCanvasProps[]) {
  return (props: LandCanvasProps) => {
    seen.push(props);
    return <div data-testid="land-canvas">{props.descriptors.length} descriptors</div>;
  };
}

/** jsdom lays nothing out, so `getBoundingClientRect` answers zeroes and `ResizeObserver` is absent.
 *  Supplying both is what lets the panel reach its drawing state under test — and the ABSENT case
 *  is a state this suite also asserts, because it is the same branch a first paint takes. */
function withMeasuredLayout(width: number, height: number): () => void {
  const rect = { width, height, top: 0, left: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) };
  const originalRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function () { return rect as DOMRect; };
  const originalRO = globalThis.ResizeObserver;
  // A no-op observer: the panel reads the rect on mount, so an observer that never fires is enough
  // to reach the drawing state, and one that DID fire would only report the same rect again.
  class StubResizeObserver implements ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = StubResizeObserver;
  return () => {
    Element.prototype.getBoundingClientRect = originalRect;
    globalThis.ResizeObserver = originalRO;
  };
}

afterEach(() => { cleanup(); });

describe('LandView', () => {
  it('waits for the forest rather than drawing an empty world', () => {
    render(<LandView scene={null} renderCanvas={recordingCanvas([])} />);
    expect(screen.getByText(/waiting for the forest/i)).toBeTruthy();
    expect(screen.queryByTestId('land-canvas')).toBeNull();
  });

  it('does not mount the canvas before it has a real frame to measure the composition in', () => {
    // No `ResizeObserver` in this environment, which is exactly a first paint: the resting frame is
    // stated in CSS px, and framing the world against a frame that does not exist yet would show
    // the viewer a composition and then move it.
    const seen: LandCanvasProps[] = [];
    render(<LandView scene={SCENE} renderCanvas={recordingCanvas(seen)} />);
    expect(screen.getByText(/measuring the frame/i)).toBeTruthy();
    expect(seen).toHaveLength(0);
  });

  it('hands the canvas the land AND the frame it is delivered into', () => {
    const restore = withMeasuredLayout(640, 900);
    try {
      const seen: LandCanvasProps[] = [];
      render(<LandView scene={SCENE} renderCanvas={recordingCanvas(seen)} />);
      expect(screen.getByTestId('land-canvas')).toBeTruthy();
      expect(seen.length).toBeGreaterThan(0);
      const last = seen[seen.length - 1]!;
      expect(last.viewport).toEqual({ width: 640, height: 900 });
      expect(last.descriptors.some((d) => d.kind === 'cell-ground')).toBe(true);
    } finally {
      restore();
    }
  });

  it('forwards activity while retaining the same app-owned regrow presentation', () => {
    const restore = withMeasuredLayout(640, 900);
    try {
      const seen: LandCanvasProps[] = [];
      const cursor = {
        progress: 0.5,
        settled: false,
        absentStoryIds: new Set<string>(),
        growing: [],
        hiddenSegmentIds: new Set<string>(),
        drawingSegments: [],
      };
      const { rerender } = render(<LandView scene={SCENE} active={false} regrowCursor={cursor} renderCanvas={recordingCanvas(seen)} />);
      const parked = seen.at(-1)!;
      rerender(<LandView scene={SCENE} active regrowCursor={cursor} renderCanvas={recordingCanvas(seen)} />);
      const resumed = seen.at(-1)!;
      expect(parked.active).toBe(false);
      expect(resumed.active).toBe(true);
      expect(resumed.regrow).toBe(parked.regrow);
    } finally {
      restore();
    }
  });

  it('shows the REASON when the land cannot be built, and still renders — the map must survive it', () => {
    const restore = withMeasuredLayout(640, 900);
    try {
      const classic: SceneG = { el: 'g', children: [{ el: 'g', kind: 'tile', id: 'alpha', children: [] }] };
      const seen: LandCanvasProps[] = [];
      render(<LandView scene={classic} renderCanvas={recordingCanvas(seen)} />);
      expect(screen.getByTestId('land-view')).toBeTruthy();
      expect(screen.getByText(/could not be drawn/i)).toBeTruthy();
      expect(seen).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('says out loud that it is a view rather than the map', () => {
    // ⚠ NOT DECORATION. ADR-0418 D5's texture fence binds a surface that makes a claim about proof
    // state; this panel makes none, and the moment it reads AS the map that argument is gone. The
    // disclaimer is the thing a member sees, so it is asserted rather than left to a comment.
    render(<LandView scene={null} renderCanvas={recordingCanvas([])} />);
    expect(screen.getByText(/a view, not the map/i)).toBeTruthy();
  });
});
