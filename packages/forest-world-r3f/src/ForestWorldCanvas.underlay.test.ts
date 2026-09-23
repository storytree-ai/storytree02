// ForestWorldCanvas.underlay.test.ts — the canvas's delivery decisions when it is a HOST'S UNDERLAY
// rather than a surface of its own.
//
// ⚠ THIS IS THE PART OF `ForestWorldCanvas` A HEADLESS RUNNER CAN REACH, and it is deliberately the
// part that matters. The JSX needs a WebGL context; the DECISION about what that JSX renders does
// not, which is the whole reason `underlayComposition` is a named function rather than five
// ternaries inline. Each assertion below is a fence that would fail SILENTLY and only in a browser
// if it regressed — a second set of camera controls, a doubled canopy, an overpainted backdrop.

import { describe, expect, it } from 'bun:test';

import { underlayComposition } from './ForestWorldCanvas.js';

describe('standalone — the canvas is its own surface', () => {
  it('keeps everything it has always drawn, and its own camera controls', () => {
    const c = underlayComposition(undefined);
    expect(c.backdrop).toBe(true);
    expect(c.props).toBe(true);
    expect(c.trails).toBe(true);
    expect(c.caves).toBe(true);
    expect(c.wisps).toBe(true);
    expect(c.controls).toBe(true);
    // No extra `<Canvas>` props: R3F's default render loop, and an opaque drawing buffer.
    expect(c.canvasProps.frameloop).toBeUndefined();
    expect(c.canvasProps.gl).toBeUndefined();
  });
});

describe('registered — the canvas is the land under a host', () => {
  const registered = { zoom: 0.6528, target: { x: 120, z: -400 } };

  it('gives up its camera controls entirely, so the host owns pan and zoom', () => {
    // ⚠ THE SINGLE MOST IMPORTANT FENCE HERE (ADR-0380 D6 fence 3). `MapControls` binds its own
    // pointer and wheel listeners to the canvas element, so leaving it mounted under a host would
    // give the map two cameras fighting over one gesture — and it would look fine at rest.
    expect(underlayComposition(registered).controls).toBe(false);
  });

  it('runs no render loop — which is what makes it honest about reduced motion', () => {
    // Nothing on this canvas animates, so under a host it redraws only when its camera or content
    // moved. A surface with no motion has none to reduce (ADR-0380 D6 fence 5's spirit): the
    // implementation of that is a loop that does not run, not a media query that turns one off.
    expect(underlayComposition(registered).canvasProps.frameloop).toBe('demand');
  });

  it('draws a TRANSPARENT backdrop, so the host keeps its own', () => {
    // The host has already painted its board; overpainting it would turn a delivery change into a
    // look change (the studio's sea would go near-black).
    const c = underlayComposition(registered);
    expect(c.backdrop).toBe(false);
    expect(c.canvasProps.gl?.alpha).toBe(true);
  });

  it('draws no mark the host already draws — the land, and nothing that means anything', () => {
    // Trails, caves and wisps all exist in the host's own layer above. Drawing them here is a
    // SECOND drawing of one mark, and each would be a claim about the work made by a surface that
    // decides nothing.
    const c = underlayComposition(registered);
    expect(c.trails).toBe(false);
    expect(c.caves).toBe(false);
    expect(c.wisps).toBe(false);
  });

  it('holds the props OFF unless the host asks, and asks explicitly', () => {
    // ADR-0530 D3's per-prop status-carrying question is open, and the host draws its own crowns.
    // So the default is ground-only, and `props: false` is as refused as an absent flag — a
    // truthiness gate here would open the arm on any value a caller passed.
    expect(underlayComposition(registered).props).toBe(false);
    expect(underlayComposition({ ...registered, props: false }).props).toBe(false);
    expect(underlayComposition({ ...registered, props: true }).props).toBe(true);
  });
});
