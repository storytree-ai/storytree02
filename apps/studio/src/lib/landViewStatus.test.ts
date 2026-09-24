import { describe, expect, it } from 'vitest';

import {
  LAND_MAP_REQUIREMENT,
  LOADING_MESSAGE,
  UNSUPPORTED_MESSAGE,
  browserWebGL2Probe,
  detectWebGL2,
  landMountStatus,
  type LandCanvasPhase,
} from './landViewStatus';

const READY: LandCanvasPhase = { kind: 'ready' };

describe('landMountStatus — never a silent blank (ADR-0608 D5)', () => {
  it('says loading while the mount is still waiting for its world, frame or camera, whatever the canvas says', () => {
    for (const state of ['waiting-for-world', 'waiting-for-frame', 'waiting-for-camera'] as const) {
      for (const phase of [READY, { kind: 'unsupported' } as const, { kind: 'failed', reason: 'x' } as const]) {
        expect(landMountStatus({ state }, phase)).toEqual({ kind: 'loading', message: LOADING_MESSAGE });
      }
    }
  });

  it('reports a refused or unlaid map as a failure carrying its own reason', () => {
    expect(landMountStatus({ state: 'refused', reason: 'the layers are drawn at 50° and 37°' }, READY)).toEqual({
      kind: 'failed',
      message: "The forest map couldn't be drawn: the layers are drawn at 50° and 37°. Reloading the page may help.",
    });
    expect(landMountStatus({ state: 'no-land', reason: 'the mapper refused a classic scene' }, READY).kind).toBe('failed');
    expect(landMountStatus({ state: 'no-land' }, READY)).toEqual({
      kind: 'failed',
      message: "The forest map couldn't be drawn: the land could not be laid out for this map. Reloading the page may help.",
    });
  });

  it('follows the canvas once the mount has drawn', () => {
    expect(landMountStatus({ state: 'drawn' }, { kind: 'loading' })).toEqual({ kind: 'loading', message: LOADING_MESSAGE });
    expect(landMountStatus({ state: 'drawn' }, READY)).toEqual({ kind: 'ready' });
    expect(landMountStatus({ state: 'drawn' }, { kind: 'unsupported' })).toEqual({ kind: 'unsupported', message: UNSUPPORTED_MESSAGE });
    expect(landMountStatus({ state: 'drawn' }, { kind: 'failed', reason: 'the 3D renderer stopped (boom)' })).toEqual({
      kind: 'failed',
      message: "The forest map couldn't be drawn: the 3D renderer stopped (boom). Reloading the page may help.",
    });
  });

  it('says it in words a member can act on', () => {
    expect(LAND_MAP_REQUIREMENT).toBe('a modern browser with WebGL 2');
    expect(LOADING_MESSAGE).toBe('Loading the 3D forest map…');
    expect(UNSUPPORTED_MESSAGE).toBe(
      "This browser can't draw the forest map. It needs a modern browser with WebGL 2 turned on — " +
        'a current version of Chrome, Edge, Firefox or Safari.',
    );
  });
});

describe('detectWebGL2', () => {
  const canvasAnswering = (context: unknown) => {
    const tags: string[] = [];
    return { tags, createElement: (tag: 'canvas') => { tags.push(tag); return { getContext: (kind: 'webgl2') => { tags.push(kind); return context; } }; } };
  };

  it('is false without the WebGL 2 API, even where a canvas would answer — and never asks the canvas', () => {
    const c = canvasAnswering({});
    expect(detectWebGL2({ hasWebGL2Api: false, createElement: c.createElement })).toBe(false);
    expect(c.tags).toEqual([]);
  });

  it('is false when the context cannot be created, or creating it throws', () => {
    expect(detectWebGL2({ hasWebGL2Api: true, createElement: canvasAnswering(null).createElement })).toBe(false);
    expect(detectWebGL2({ hasWebGL2Api: true, createElement: canvasAnswering(undefined).createElement })).toBe(false);
    expect(detectWebGL2({ hasWebGL2Api: true, createElement: () => { throw new Error('no canvas'); } })).toBe(false);
  });

  it('is true for a real context, asks a CANVAS for webgl2, and hands the probe context straight back', () => {
    let lost = 0;
    const c = canvasAnswering({ getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => { lost += 1; } } : null) });
    expect(detectWebGL2({ hasWebGL2Api: true, createElement: c.createElement })).toBe(true);
    expect(c.tags).toEqual(['canvas', 'webgl2']);
    expect(lost).toBe(1);
  });

  it('is true whatever the release extension offers — none, null, or one without loseContext', () => {
    for (const context of [{}, { getExtension: () => null }, { getExtension: () => ({}) }]) {
      expect(detectWebGL2({ hasWebGL2Api: true, createElement: canvasAnswering(context).createElement })).toBe(true);
    }
  });

  it('reads the real browser through the default probe', () => {
    const g = globalThis as { WebGL2RenderingContext?: unknown; document?: unknown };
    const hadApi = 'WebGL2RenderingContext' in g;
    const savedApi = g.WebGL2RenderingContext;
    const savedDoc = g.document;
    const c = canvasAnswering({});
    try {
      g.document = { createElement: c.createElement };
      delete g.WebGL2RenderingContext;
      expect(detectWebGL2()).toBe(false);
      expect(browserWebGL2Probe().hasWebGL2Api).toBe(false);
      g.WebGL2RenderingContext = function WebGL2RenderingContext() {};
      expect(browserWebGL2Probe().hasWebGL2Api).toBe(true);
      expect(detectWebGL2()).toBe(true);
      expect(c.tags).toEqual(['canvas', 'webgl2']);
    } finally {
      if (hadApi) g.WebGL2RenderingContext = savedApi;
      else delete g.WebGL2RenderingContext;
      g.document = savedDoc;
    }
  });
});
