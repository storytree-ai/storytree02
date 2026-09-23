// landViewMount.ts — THE LAND UNDER THE WORKING MAP. The reader that opens the mount, and the one
// place the two elevations the registration question is about are handed over.
//
// WHAT THIS IS, AND HOW IT DIFFERS FROM ITS NEIGHBOUR. `landView.ts` opens a land view BESIDE the
// map (`?landView=1`) — a second panel that steers nothing and asserts nothing. This opens the land
// UNDERNEATH the map (`?landMount=1`): one surface, the 3D ground beneath the existing SVG layer,
// which is ADR-0530 route C and the thing `mount-the-land-on-a-real-surface-arc` exists for. The
// two are deliberately separate flags rather than one with a mode, because they are different
// claims: a view is evidence, a mount is the product.
//
// ⚠⚠ THE MOUNT ADDS LAND AND, behind its separate `landMountProps` arm, 3D dressing. The SVG stays
// above it for interaction and semantic marks: nameplates retain the story-status word, while the
// mounted CSS removes the redundant flat central hero tree. Neither the 3D ground nor its props is
// presented as a complete replacement for every story-state signal.
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

/** The query key that mounts the land under the map. */
export const LAND_MOUNT_PARAM = 'landMount';

/**
 * `?landMount=1` — the exact, default-off gate that puts the 3D land under the working map.
 *
 * ⚠ DEFAULT-OFF FOR THE SAME PAYLOAD REASON `?landView=1` IS (`landView.ts`), and it is a stronger
 * reason here: this flag is on the route everybody works in, so the 3D chunk must stay off the
 * ordinary map's path entirely. The component behind it is `React.lazy`, and this reader is what
 * decides whether it is ever asked for.
 *
 * `on` / `1` / `true` all open it — the same vocabulary `?landView` and `?buildings` read, rather
 * than a third one; anything else, an empty value included, leaves the map byte-for-byte unchanged.
 */
export function readLandMount(search: string): boolean {
  const v = new URLSearchParams(search).get(LAND_MOUNT_PARAM);
  return v === 'on' || v === '1' || v === 'true';
}

/**
 * `?landMountProps=1` — draw the 3D kit props as well as the ground.
 *
 * The arm remains default-off so ground-only and dressed-land captures are independently reachable.
 * Both mounted arms suppress the redundant SVG central hero tree. Nameplates and the remaining
 * semantic SVG marks stay above the canvas, with or without 3D props.
 */
export function readLandMountProps(search: string): boolean {
  const v = new URLSearchParams(search).get('landMountProps');
  return v === 'on' || v === '1' || v === 'true';
}

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
