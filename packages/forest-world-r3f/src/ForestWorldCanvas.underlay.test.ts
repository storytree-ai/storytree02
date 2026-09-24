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

test('fcd-canvas-renders-on-demand-only-while-presentable: standalone and registered canvases paint only while active in a visible document', () => {
  const presentable = { active: true, documentVisible: true };
  const parked = { active: false, documentVisible: true };
  const hidden = { active: true, documentVisible: false };

  for (const registered of [undefined, REGISTERED]) {
    const visible = underlayComposition(registered, false, presentable);
    assert.equal(visible.canvasProps.frameloop, 'demand');
    assert.equal(underlayComposition(registered, false, parked).canvasProps.frameloop, 'never');
    assert.equal(underlayComposition(registered, false, hidden).canvasProps.frameloop, 'never');

    const control = underlayComposition(registered, false, presentable);
    assert.deepEqual(
      { ...underlayComposition(registered, false, parked), canvasProps: undefined },
      { ...control, canvasProps: undefined },
    );
    assert.deepEqual(
      { ...underlayComposition(registered, false, hidden), canvasProps: undefined },
      { ...control, canvasProps: undefined },
    );
  }
});

// test-updated (new behaviour): standalone: the canvas keeps everything it draws, and its own camera controls now paints on demand while presentable.
test('standalone: the canvas keeps everything it draws, and its own camera controls', () => {
  const c = underlayComposition(undefined, true, { active: true, documentVisible: true });
  assert.equal(c.backdrop, true);
  assert.equal(c.props, true);
  assert.equal(c.trails, true);
  assert.equal(c.caves, true);
  assert.equal(c.wisps, true);
  assert.equal(c.controls, true);
  // A presentable standalone canvas paints only when its content or controls invalidate it.
  assert.equal(c.canvasProps.frameloop, 'demand');
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

test('standalone: `showTrails` keeps its old meaning — hidden unless a page opts in', () => {
  // ADR-0169 §3. It is the ONLY place this prop is read, which is what makes `compose.trails` the
  // one gate rather than one of two conditions a reader has to find.
  assert.equal(underlayComposition(undefined).trails, false);
  assert.equal(underlayComposition(undefined, false).trails, false);
  assert.equal(underlayComposition(undefined, true).trails, true);
});

test('registered: it draws no mark the host still draws itself', () => {
  // Caves and wisps exist in the host's own layer above, so drawing them here is a SECOND drawing
  // of one mark — a claim about the work made by a surface that decides nothing.
  const c = underlayComposition(REGISTERED);
  assert.equal(c.caves, false);
  assert.equal(c.wisps, false);
});

test('registered: THE 3D LAYER OWNS THE PATHWAYS — a product-state rule, not a debug prop', () => {
  // `pathways-keep-selection-focus-and-accessible-edge-identity`. Under a mount the 3D layer is the
  // one that can draw a pathway ON the ground it runs over, so mounted ⇒ it draws them. Derived
  // from the mount itself: there is no field to pass and nothing for a caller to get wrong.
  assert.equal(underlayComposition(REGISTERED).trails, true);
  // ⚠ AND `showTrails` CANNOT TURN IT OFF. A host's answer is not a debug choice, and a host that
  // could accidentally pass `false` would get its own suppressed strokes AND no 3D paths — a map
  // with no dependency network at all, which is strictly worse than either arm.
  assert.equal(underlayComposition(REGISTERED, false).trails, true);
  assert.equal(underlayComposition(REGISTERED, true).trails, true);
});

test('registered: the props stay OFF unless the host asks, and asks explicitly', () => {
  // ADR-0530 D3's per-prop status-carrying question is open, and the host draws its own crowns. So
  // the default is ground-only, and `props: false` is as refused as an absent flag — a truthiness
  // gate here would open the arm on any value a caller happened to pass.
  assert.equal(underlayComposition(REGISTERED).props, false);
  assert.equal(underlayComposition({ ...REGISTERED, props: false }).props, false);
  assert.equal(underlayComposition({ ...REGISTERED, props: true }).props, true);
});
