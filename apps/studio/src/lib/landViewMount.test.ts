// landViewMount.test.ts — the mount's reader and its camera seam.
//
// ⚠⚠ THE LOAD-BEARING TEST HERE IS THE THIRD ONE, and it is not the same test
// `canvasRegistration.test.ts` already has. That suite proves `registrationCamera` is CORRECT when
// it is asked about two equal elevations, which it chooses itself. This one proves the MOUNT is
// registered — that the elevations the studio actually hands over are the two live constants, and
// that the camera the mount therefore produces lands the SVG's own `worldToScreen` and the canvas's
// `canvasScreenOf` on the same pixel. A mount could pass every assertion in the other file and
// still be out of register by asking about the wrong pair.
//
// ⚠ AND IT IS NOT A REARRANGEMENT OF ITSELF. The expectation comes from `worldToScreen` — the
// studio's own shipped projection, imported — and the subject from `canvasScreenOf`, which projects
// through whatever camera it is handed. Neither side recomputes the solver.

import { describe, it, expect } from 'vitest';

import { canvasScreenOf, groundOfDrawing, type RegistrationFrame } from './canvasRegistration.js';
import { LAND_CAMERA_ELEVATION_DEG, SHIPPED_ELEVATION_DEG } from './canvasRegistration.constants.js';
import { LAND_MOUNT_PARAM, mountedLandCamera, readLandMount, readLandMountProps } from './landViewMount.js';
import { worldToScreen, type Camera } from './worldCamera.js';

const FRAME: RegistrationFrame = { width: 1600, height: 900 };

/** Drawing-space points spread across a forest the shape of the real one (661 x 3524 projected). */
const DRAWING_POINTS = [
  { x: 63, y: 140 },
  { x: 400, y: 900 },
  { x: 724, y: 2200 },
  { x: 200, y: 3664 },
  { x: -50, y: -20 },
];

describe('the mount reader', () => {
  it('opens on the three affirmative spellings and nothing else', () => {
    for (const on of ['on', '1', 'true']) {
      expect(readLandMount(`?${LAND_MOUNT_PARAM}=${on}`)).toBe(true);
    }
    // ⚠ THE NEAR MISSES MATTER AS MUCH AS THE HITS: each one that opened the mount by accident
    // would pull three.js and the bought kit onto the ordinary map's path.
    for (const off of ['', '?landMount=0', '?landMount=', '?landmount=1', '?landMount=yes', '?landView=1']) {
      expect(readLandMount(off)).toBe(false);
    }
  });

  it('keeps the props arm a SEPARATE flag, so the shipped mount is ground-only', () => {
    // The mount being on must never imply the props arm — that arm draws a second canopy over the
    // SVG's own crowns and exists to be looked at, not to ship (ADR-0530 D3 is still open).
    expect(readLandMountProps('?landMount=1')).toBe(false);
    expect(readLandMountProps('?landMount=1&landMountProps=1')).toBe(true);
  });
});

describe('the mounted land camera', () => {
  // ⚠ THIS IS THE CONDITION THE WHOLE MOUNT RESTS ON, asserted on the live constants rather than
  // remembered. `registrationCamera` refuses unless the two layers foreshorten depth identically;
  // ADR-0593 moved the map's elevation to meet the renderer's so that it would not. If either
  // constant ever moves again, this fails here — naming the cause — rather than delivering a map
  // whose labels have walked off their islands.
  it('is satisfiable at all, because the two layers share one elevation', () => {
    expect(SHIPPED_ELEVATION_DEG).toBe(LAND_CAMERA_ELEVATION_DEG);
    const solved = mountedLandCamera({ tx: -412.5, ty: 133.25, scale: 0.6528 }, FRAME);
    expect(solved.ok).toBe(true);
  });

  it('registers the two layers to the pixel, at the elevations the STUDIO hands over', () => {
    const svg: Camera = { tx: -412.5, ty: 133.25, scale: 0.6528 };
    const solved = mountedLandCamera(svg, FRAME);
    if (!solved.ok) throw new Error(`expected a registration: ${solved.reason}`);
    // The zoom IS the SVG's own scale — one delivered CSS px per world unit for the whole frame,
    // which is the substance of ADR-0380 D6 fence 4.
    expect(solved.camera.zoom).toBe(svg.scale);
    for (const point of DRAWING_POINTS) {
      const svgPx = worldToScreen(svg, point.x, point.y);
      const canvasPx = canvasScreenOf(
        solved.camera,
        FRAME,
        // ⚠ The ground point is derived at the MAP's elevation (that is what the drawing was made
        // at) and projected at the CANVAS's. Using one number for both would hide exactly the
        // disagreement this test exists to catch.
        groundOfDrawing(point, LAND_CAMERA_ELEVATION_DEG),
        SHIPPED_ELEVATION_DEG,
      );
      expect(canvasPx.x).toBeCloseTo(svgPx.x, 9);
      expect(canvasPx.y).toBeCloseTo(svgPx.y, 9);
    }
  });

  it('stays registered across zoom and pan, not only at the camera it was solved for', () => {
    // A mount is used at every camera the viewer reaches, so one camera proves very little. These
    // are a zoomed-in, a zoomed-out and a panned-far camera.
    const cameras: Camera[] = [
      { tx: -412.5, ty: 133.25, scale: 0.6528 },
      { tx: -1840, ty: -5200, scale: 2.4 },
      { tx: 220, ty: 61, scale: 0.11 },
    ];
    for (const svg of cameras) {
      const solved = mountedLandCamera(svg, FRAME);
      if (!solved.ok) throw new Error(`expected a registration: ${solved.reason}`);
      for (const point of DRAWING_POINTS) {
        const svgPx = worldToScreen(svg, point.x, point.y);
        const canvasPx = canvasScreenOf(
          solved.camera,
          FRAME,
          groundOfDrawing(point, LAND_CAMERA_ELEVATION_DEG),
          SHIPPED_ELEVATION_DEG,
        );
        expect(canvasPx.x).toBeCloseTo(svgPx.x, 8);
        expect(canvasPx.y).toBeCloseTo(svgPx.y, 8);
      }
    }
  });

  it('refuses a frame or a camera that projects nothing, rather than mounting a guess', () => {
    expect(mountedLandCamera({ tx: 0, ty: 0, scale: 0 }, FRAME).ok).toBe(false);
    expect(mountedLandCamera({ tx: 0, ty: 0, scale: 1 }, { width: 0, height: 900 }).ok).toBe(false);
  });
});
