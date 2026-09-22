// canvasRegistration.constants.ts — the two elevations the registration question is ABOUT, imported
// from where each is decided rather than written down again.
//
// ⚠ IT IS A RE-EXPORT AND NOT A COPY, on purpose. A second literal `50` here would be a third
// opinion about the camera, and the whole reason `LAND_CAMERA_ELEVATION_DEG` exists is that the
// land and the objects standing on it must read ONE value (ADR-0367 D1). The test that asserts the
// two layers now AGREE has to be reading the SAME numbers the map and the canvas are drawn at, or
// it is asserting something about nothing.
//
// ⚠ THE TWO ARE EQUAL AS OF ADR-0593 D1 (2026-09-22) AND THAT IS THE POINT, NOT A REDUNDANCY.
// `LAND_CAMERA_ELEVATION_DEG` moved 20 -> 50 so that `registrationCamera`'s equal-`sin` condition
// is satisfied and the 3D land can be mounted under the flat map. They remain two SEPARATE
// decisions that happen to agree — ADR-0367 D1 owns the map's, ADR-0517 D2 owns the renderer's —
// so this file must keep importing both. Collapsing them into one export, or deriving one from the
// other, would destroy the only place their agreement is observable and make the registration
// suite unable to notice if either ever moved again.

export { LAND_CAMERA_ELEVATION_DEG } from '@storytree/forest-world';
export { SHIPPED_ELEVATION_DEG } from '@storytree/forest-world-r3f';
