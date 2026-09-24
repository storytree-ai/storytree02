// @vitest-environment jsdom
//
// LandViewMount.status.test.tsx — what the mounted 3D map TELLS the host (ADR-0608 D5): loading,
// ready, unsupported, failed — and never a silent blank. The failure paths are exercised for real:
// the DEFAULT canvas in a runner with no WebGL 2 (the genuine unsupported stack), a canvas that
// throws (a renderer that cannot start), and a canvas that reports its context lost.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { act, render, cleanup } from '@testing-library/react';

import { LAND_CAMERA_ELEVATION_DEG, groundFlattening, type SceneG } from '@storytree/forest-world';

import { LandViewMount, type LandMountCanvasProps } from './LandViewMount';
import type { LandMountStatus } from '../lib/landViewStatus';
import { LOADING_MESSAGE, UNSUPPORTED_MESSAGE } from '../lib/landViewStatus';
import type { Camera } from '../lib/worldCamera';

function drawnIsland(island: string, capability: string, half: number): SceneG {
  const s = groundFlattening(LAND_CAMERA_ELEVATION_DEG);
  const ring = [[-half, -half * s], [half, -half * s], [half, half * s], [-half, half * s]];
  return {
    el: 'g', kind: 'ground', id: island, status: 'healthy',
    children: [{ el: 'g', kind: 'parcel', id: capability, children: [{ el: 'path', kind: 'cell', d: `M ${ring.map(([x, y]) => `${x} ${y}`).join(' L ')} Z` }] }],
  };
}

const SCENE: SceneG = { el: 'g', children: [drawnIsland('alpha', 'cap-a', 50)] };
const CAMERA: Camera = { tx: -412.5, ty: 133.25, scale: 0.6528 };
const originalRect = Element.prototype.getBoundingClientRect;
const g = globalThis as { ResizeObserver?: unknown };

beforeEach(() => {
  class RO {
    constructor(private readonly cb: () => void) {}
    observe() { this.cb(); }
    disconnect() {}
  }
  g.ResizeObserver = RO;
  Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    return { width: 1600, height: 900, top: 0, left: 0, right: 1600, bottom: 900, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  cleanup();
  Element.prototype.getBoundingClientRect = originalRect;
  delete g.ResizeObserver;
});

function statuses() {
  const seen: LandMountStatus[] = [];
  return { seen, onStatus: (s: LandMountStatus) => { seen.push(s); } };
}

describe('the land layer reports what a member must be told', () => {
  it('on a stack with no WebGL 2, the REAL default canvas says so by name and fetches no renderer', async () => {
    const { seen, onStatus } = statuses();
    const { container } = render(<LandViewMount scene={SCENE} camera={CAMERA} onStatus={onStatus} />);
    await act(async () => {});
    const layer = container.querySelector('[data-testid="land-mount"]')!;
    expect(layer.getAttribute('data-state')).toBe('drawn');
    expect(layer.getAttribute('data-canvas')).toBe('unsupported');
    expect(layer.querySelector('canvas')).toBeNull();
    expect(seen.at(-1)).toEqual({ kind: 'unsupported', message: UNSUPPORTED_MESSAGE });
    expect(UNSUPPORTED_MESSAGE).toContain('WebGL 2');
  });

  it('says loading until the canvas reports ready, then goes quiet', async () => {
    const { seen, onStatus } = statuses();
    let handed: LandMountCanvasProps | null = null;
    const { container } = render(
      <LandViewMount scene={SCENE} camera={CAMERA} onStatus={onStatus} renderCanvas={(p) => { handed = p; return <div />; }} />,
    );
    await act(async () => {});
    expect(seen.at(-1)).toEqual({ kind: 'loading', message: LOADING_MESSAGE });
    await act(async () => { handed!.onPhase({ kind: 'ready' }); });
    expect(seen.at(-1)).toEqual({ kind: 'ready' });
    expect(container.querySelector('[data-testid="land-mount"]')!.getAttribute('data-canvas')).toBe('ready');
    // A re-render that changes nothing reports nothing new.
    const count = seen.length;
    await act(async () => { handed!.onPhase({ kind: 'ready' }); });
    expect(seen.length).toBe(count);
  });

  it('turns a canvas that throws into a failure message, and leaves the layer inert', async () => {
    const { seen, onStatus } = statuses();
    const quiet = console.error;
    console.error = () => {};
    try {
      const Boom = () => { throw new Error('Error creating WebGL context.'); };
      const { container } = render(<LandViewMount scene={SCENE} camera={CAMERA} onStatus={onStatus} renderCanvas={() => <Boom />} />);
      await act(async () => {});
      expect(seen.at(-1)).toEqual({
        kind: 'failed',
        message: "The forest map couldn't be drawn: the 3D renderer stopped (Error creating WebGL context.). Reloading the page may help.",
      });
      const layer = container.querySelector('[data-testid="land-mount"]')!;
      expect(layer.getAttribute('data-canvas')).toBe('failed');
      expect(layer.children.length).toBe(0);
    } finally {
      console.error = quiet;
    }
  });

  it('reports a lost context as a failure', async () => {
    const { seen, onStatus } = statuses();
    let handed: LandMountCanvasProps | null = null;
    render(<LandViewMount scene={SCENE} camera={CAMERA} onStatus={onStatus} renderCanvas={(p) => { handed = p; return <div />; }} />);
    await act(async () => { handed!.onPhase({ kind: 'ready' }); });
    await act(async () => { handed!.onPhase({ kind: 'failed', reason: 'the browser took the graphics context away' }); });
    expect(seen.at(-1)?.kind).toBe('failed');
    expect(seen.at(-1)).toHaveProperty('message', expect.stringContaining('graphics context away'));
  });

  it('reports a refused registration as a failure rather than a blank', async () => {
    const { seen, onStatus } = statuses();
    const { container } = render(
      <LandViewMount scene={SCENE} camera={{ ...CAMERA, scale: 0 }} onStatus={onStatus} renderCanvas={() => <div />} />,
    );
    await act(async () => {});
    expect(container.querySelector('[data-testid="land-mount"]')!.getAttribute('data-state')).toBe('refused');
    expect(seen.at(-1)?.kind).toBe('failed');
  });
});
