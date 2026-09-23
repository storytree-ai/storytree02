// ForestWorldCanvas.underlay.test.ts — the canvas's delivery decisions when it is a HOST'S UNDERLAY
// rather than a surface of its own.
//
// ⚠ THIS IS THE PART OF `ForestWorldCanvas` A HEADLESS RUNNER CAN REACH, and it is deliberately the
// part that matters. The JSX needs a WebGL context; the DECISION about what that JSX renders does
// not, which is the whole reason `underlayComposition` is a named function rather than five
// ternaries inline. Each assertion below is a fence that would fail SILENTLY and only in a browser
// if it regressed — a second set of camera controls, a doubled canopy, an overpainted backdrop.

import assert from 'node:assert/strict';
import test from 'node:test';

import { underlayComposition } from './ForestWorldCanvas.js';

/** The camera a host hands over once it has solved the registration. */
const REGISTERED = { zoom: 0.6528, target: { x: 120, z: -400 } };

test('standalone: the canvas keeps everything it draws, and its own camera controls', () => {
  const c = underlayComposition(undefined);
  assert.equal(c.backdrop, true);
  assert.equal(c.props, true);
  assert.equal(c.trails, true);
  assert.equal(c.caves, true);
  assert.equal(c.wisps, true);
  assert.equal(c.controls, true);
  // No extra `<Canvas>` props: R3F's default render loop, and an opaque drawing buffer.
  assert.equal(c.canvasProps.frameloop, undefined);
  assert.equal(c.canvasProps.gl, undefined);
});

test('registered: it gives up its camera controls, so the host owns pan and zoom', () => {
  // ⚠ THE SINGLE MOST IMPORTANT FENCE HERE (ADR-0380 D6 fence 3). `MapControls` binds its own
  // pointer and wheel listeners to the canvas element, so leaving it mounted under a host would
  // give the map two cameras fighting over one gesture — and it would look fine at rest.
  assert.equal(underlayComposition(REGISTERED).controls, false);
});

test('registered: it runs no render loop, which is what makes it honest about reduced motion', () => {
  // Nothing on this canvas animates, so under a host it redraws only when its camera or content
  // moved. A surface with no motion has none to reduce (ADR-0380 D6 fence 5's spirit): the honest
  // implementation of that is a loop that does not run, not a media query that turns one off.
  assert.equal(underlayComposition(REGISTERED).canvasProps.frameloop, 'demand');
});

test('registered: it draws a TRANSPARENT backdrop, so the host keeps its own', () => {
  // The host has already painted its board; overpainting it would turn a delivery change into a
  // look change (the studio's sea would go near-black).
  const c = underlayComposition(REGISTERED);
  assert.equal(c.backdrop, false);
  assert.equal(c.canvasProps.gl?.alpha, true);
});

test('registered: it draws no mark the host already draws', () => {
  // Trails, caves and wisps all exist in the host's own layer above. Drawing them here is a SECOND
  // drawing of one mark, and each would be a claim about the work made by a surface that decides
  // nothing. What is left is the land.
  const c = underlayComposition(REGISTERED);
  assert.equal(c.trails, false);
  assert.equal(c.caves, false);
  assert.equal(c.wisps, false);
});

test('registered: the props stay OFF unless the host asks, and asks explicitly', () => {
  // ADR-0530 D3's per-prop status-carrying question is open, and the host draws its own crowns. So
  // the default is ground-only, and `props: false` is as refused as an absent flag — a truthiness
  // gate here would open the arm on any value a caller happened to pass.
  assert.equal(underlayComposition(REGISTERED).props, false);
  assert.equal(underlayComposition({ ...REGISTERED, props: false }).props, false);
  assert.equal(underlayComposition({ ...REGISTERED, props: true }).props, true);
});
