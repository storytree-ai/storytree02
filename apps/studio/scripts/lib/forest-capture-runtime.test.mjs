import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseForestCameraTransform,
  waitForForestMotionAndCamera,
} from './forest-capture-runtime.mjs';

test('camera runtime parses SVG numbers and attests the delivered camera after the app settles', async () => {
  assert.deepEqual(
    parseForestCameraTransform('translate(-1.5e2, .25) scale(2E-1)'),
    { tx: -150, ty: 0.25, scale: 0.2 },
  );

  const priorAnimationFrame = globalThis.requestAnimationFrame;
  const priorWindow = globalThis.window;
  const events = [];
  globalThis.requestAnimationFrame = (callback) => {
    events.push('frame');
    callback();
  };
  globalThis.window = {
    __storytreeMotionSettled: () => ({ settled: true, phase: 'steady', reasons: [] }),
  };
  const page = {
    async evaluate(callback) {
      events.push('evaluate');
      return callback();
    },
    locator(selector) {
      assert.ok(selector === 'g.hex-flora' || selector === 'g.world-camera');
      return {
        first: () => ({
          waitFor: async () => { events.push('forest-attached'); },
        }),
        getAttribute: async () => {
          events.push('camera-read');
          return 'translate(12 34) scale(0.75)';
        },
      };
    },
    async waitForFunction(predicate) {
      events.push('settled-wait');
      assert.equal(predicate(), true);
    },
  };

  try {
    const result = await waitForForestMotionAndCamera(page, {
      expectedCamera: { tx: 12, ty: 34, scale: 0.75 },
    });
    assert.equal(result.settled, true);
    assert.equal(result.cameraMatches, true);
    assert.deepEqual(result.camera, {
      transform: 'translate(12 34) scale(0.75)',
      tx: 12,
      ty: 34,
      scale: 0.75,
    });
    assert.deepEqual(events.slice(0, 3), ['evaluate', 'frame', 'frame']);
    assert.ok(events.indexOf('settled-wait') > events.lastIndexOf('frame'));
    assert.ok(events.indexOf('camera-read') > events.indexOf('settled-wait'));
  } finally {
    globalThis.requestAnimationFrame = priorAnimationFrame;
    globalThis.window = priorWindow;
  }
});
