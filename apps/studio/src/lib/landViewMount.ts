// landViewMount.ts — THE LAND UNDER THE WORKING MAP: the one place the two elevations the
// registration question is about are handed over.
//
// The mounted 3D land IS the forest (ADR-0608 D1): the studio's map always draws it, with its kit
// props, under the SVG interaction layer. The `?landMount` / `?landMountProps` readers that used to
// open it behind a flag retired with the flat forest look. (`landView.ts` still opens a separate
// diagnostic land view BESIDE the map, `?landView=1`.)
//
// ⚠ IT SUPPLIES THE TWO ELEVATIONS AND SOLVES NOTHING. `registrationCamera` owns the arithmetic and
// owns the refusal; this module's only job is to hand it the map's elevation and the canvas's from
// where each is DECIDED (`canvasRegistration.constants.ts` re-exports both rather than copying
// either), so there is exactly one place in the studio that knows which two numbers the question is
// about. They are equal as of ADR-0593 and the refusal is what a reader sees if they ever stop
// being.

import { registrationCamera, type RegistrationFrame, type RegistrationResult } from './canvasRegistration.js';
import { LAND_CAMERA_ELEVATION_DEG, SHIPPED_ELEVATION_DEG } from './canvasRegistration.constants.js';
import type { Camera } from './worldCamera.js';

/**
 * THE CAMERA THE MOUNTED CANVAS MUST BE SET TO, or the refusal naming why the two layers cannot be
 * registered — `registrationCamera` asked with the studio's own two elevations.
 *
 * ⚠ IT PASSES THE CAMERA OBJECT WHOLE, and which camera the caller passes is the caller's own
 * decision with two correct answers. During a drag the studio freezes `<g class="world-camera">`
 * and delivers the difference on `.world-pan-layer`'s CSS transform (ADR-0272 D2); a canvas mounted
 * inside that wrapper inherits the identical transform, so passing the FROZEN BASE keeps both
 * layers registered for the whole gesture with neither re-rendering. That is what the mount does,
 * and it is why the mount costs nothing per drag frame.
 */
export function mountedLandCamera(camera: Camera, frame: RegistrationFrame): RegistrationResult {
  return registrationCamera(camera, frame, {
    mapElevationDeg: LAND_CAMERA_ELEVATION_DEG,
    canvasElevationDeg: SHIPPED_ELEVATION_DEG,
  });
}
