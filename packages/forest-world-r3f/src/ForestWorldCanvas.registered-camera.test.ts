// ForestWorldCanvas.registered-camera.test.ts — the host's camera is applied AND drawn in one call.
//
// The defect this guards (docs/research/map-pan-steady-2026-09-25/): the camera used to be applied
// in R3F's own reconciler and drawn on a later demand frame, so the studio painted frames with the
// SVG layer on the new camera and the land on the old one. The contract here is the synchronous
// half: by the time `presentRegisteredCamera` returns, a frame has been DRAWN with the new pose — no
// deferred invalidate standing in for it. The browser half (that the host calls this from its own
// commit) is measured by `pan-probe.mjs` on the real studio.

import assert from 'node:assert/strict';
import test from 'node:test';

import { OrthographicCamera, Scene, Vector3 } from 'three';

import { presentRegisteredCamera } from './ForestWorldCanvas.registered-camera.js';

const EYE: readonly [number, number, number] = [0, 766, 643];

function rig() {
  const camera = new OrthographicCamera(-800, 800, 500, -500, -5000, 5000);
  const scene = new Scene();
  const drawn: { zoom: number; position: number[]; centre: [number, number] }[] = [];
  let invalidations = 0;
  const root = {
    camera,
    scene,
    gl: {
      render(s: Scene, c: OrthographicCamera) {
        assert.equal(s, scene);
        c.updateMatrixWorld();
        const target = new Vector3(120, 0, -40).project(c);
        drawn.push({ zoom: c.zoom, position: c.position.toArray(), centre: [target.x, target.y] });
      },
    },
    invalidate: () => {
      invalidations += 1;
    },
  };
  return { root, drawn, invalidations: () => invalidations };
}

test('a presentable canvas DRAWS the new pose before the call returns, and defers nothing', () => {
  const { root, drawn, invalidations } = rig();
  const painted = presentRegisteredCamera(root, { zoom: 2.5, target: { x: 120, z: -40 }, eye: EYE }, true);
  assert.equal(painted, true);
  assert.equal(drawn.length, 1, 'exactly one synchronous draw');
  assert.equal(invalidations(), 0, 'no demand frame standing in for the draw');
  const [frame] = drawn;
  assert.equal(frame?.zoom, 2.5);
  assert.deepEqual(frame?.position, [120 + EYE[0], EYE[1], -40 + EYE[2]]);
  // The host's target lands at the centre of the frame in the drawn picture.
  assert.ok(Math.abs(frame?.centre[0] ?? 1) < 1e-9 && Math.abs(frame?.centre[1] ?? 1) < 1e-9);
});

test('every camera change is drawn with THAT change, in order — never a stale pose', () => {
  const { root, drawn } = rig();
  const poses = [
    { zoom: 1, target: { x: 0, z: 0 } },
    { zoom: 1, target: { x: 300, z: 0 } },
    { zoom: 1.21, target: { x: 300, z: 150 } },
  ];
  for (const p of poses) presentRegisteredCamera(root, { ...p, eye: EYE }, true);
  assert.deepEqual(drawn.map((d) => d.zoom), [1, 1, 1.21]);
  assert.deepEqual(drawn.map((d) => [d.position[0], d.position[2]]), poses.map((p) => [p.target.x + EYE[0], p.target.z + EYE[2]]));
});

test('a parked canvas takes the camera but draws nothing, and asks for a frame for when it resumes', () => {
  const { root, drawn, invalidations } = rig();
  const painted = presentRegisteredCamera(root, { zoom: 3, target: { x: 5, z: 6 }, eye: EYE }, false);
  assert.equal(painted, false);
  assert.equal(drawn.length, 0);
  assert.equal(invalidations(), 1);
  assert.equal(root.camera.zoom, 3);
  assert.deepEqual(root.camera.position.toArray(), [5 + EYE[0], EYE[1], 6 + EYE[2]]);
});
