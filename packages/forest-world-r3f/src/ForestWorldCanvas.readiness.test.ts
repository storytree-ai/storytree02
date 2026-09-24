// ForestWorldCanvas.readiness.test.ts — `ready` waits for everything the canvas was asked to draw.

import assert from 'node:assert/strict';
import test from 'node:test';

import { canvasReady } from './ForestWorldCanvas.readiness.js';

test('nothing is ready before the canvas exists, whatever the kit is doing', () => {
  assert.equal(canvasReady({ created: false, drawsProps: false, propsSettled: false }), false);
  assert.equal(canvasReady({ created: false, drawsProps: true, propsSettled: true }), false);
  assert.equal(canvasReady({ created: false, drawsProps: false, propsSettled: true }), false);
});

test('a ground-only canvas is ready as soon as it exists', () => {
  assert.equal(canvasReady({ created: true, drawsProps: false, propsSettled: false }), true);
});

test('a canvas drawing the plants holds ready until the kit has settled', () => {
  assert.equal(canvasReady({ created: true, drawsProps: true, propsSettled: false }), false);
  assert.equal(canvasReady({ created: true, drawsProps: true, propsSettled: true }), true);
});
