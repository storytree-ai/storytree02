import { describe, expect, it } from 'vitest';

import {
  LAND_MAP_REQUIREMENT,
  LOADING_MESSAGE,
  UNSUPPORTED_MESSAGE,
  detectWebGL2,
  landMountStatus,
  type LandCanvasPhase,
} from './landViewStatus';

const READY: LandCanvasPhase = { kind: 'ready' };

describe('landMountStatus — never a silent blank (ADR-0608 D5)', () => {
  it('says loading while the mount is still waiting for its world, frame or camera, whatever the canvas says', () => {
    for (const state of ['waiting-for-world', 'waiting-for-frame', 'waiting-for-camera'] as const) {
      expect(landMountStatus({ state }, READY)).toEqual({ kind: 'loading', message: LOADING_MESSAGE });
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

  it('names what is missing in the unsupported message', () => {
    expect(LAND_MAP_REQUIREMENT).toBe('a modern browser with WebGL 2');
    expect(UNSUPPORTED_MESSAGE).toContain('a modern browser with WebGL 2');
    expect(UNSUPPORTED_MESSAGE).toContain("This browser can't draw the forest map");
  });
});

describe('detectWebGL2', () => {
  it('is false without the WebGL 2 API, and never creates a canvas to find out', () => {
    let created = 0;
    expect(detectWebGL2({ hasWebGL2Api: false, createCanvas: () => { created += 1; return { getContext: () => ({}) }; } })).toBe(false);
    expect(created).toBe(0);
  });

  it('is false when the context cannot be created, or the probe throws', () => {
    expect(detectWebGL2({ hasWebGL2Api: true, createCanvas: () => ({ getContext: () => null }) })).toBe(false);
    expect(detectWebGL2({ hasWebGL2Api: true, createCanvas: () => ({ getContext: () => undefined }) })).toBe(false);
    expect(detectWebGL2({ hasWebGL2Api: true, createCanvas: () => { throw new Error('no canvas'); } })).toBe(false);
  });

  it('is true for a real context, and hands the probe context straight back', () => {
    let lost = 0;
    const context = { getExtension: (name: string) => (name === 'WEBGL_lose_context' ? { loseContext: () => { lost += 1; } } : null) };
    expect(detectWebGL2({ hasWebGL2Api: true, createCanvas: () => ({ getContext: () => context }) })).toBe(true);
    expect(lost).toBe(1);
    expect(detectWebGL2({ hasWebGL2Api: true, createCanvas: () => ({ getContext: () => ({}) }) })).toBe(true);
  });

  it('reads a runner with no WebGL 2 API as unsupported', () => {
    expect(detectWebGL2()).toBe(false);
  });
});
