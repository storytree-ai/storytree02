/**
 * Chapter 2 round-3 hero-tree comparison candidates — the SWITCHABLE half of the lab.
 *
 * The island (Experiment 6 connected SVG accretion), the ADR-0277-retained plant track and the
 * arrival path-growth beat are fixed for every candidate; only the hero tree changes, and
 * EXACTLY ONE tree track is mounted at a time (see CHAPTER2_ROUND3_LAB_BUDGET).
 *
 * Appearance only. Semantic state, normalized progress, deterministic frame selection, timing,
 * easing, holds, Next/Back/Replay, reduced-motion settlement, sockets and painter order all stay
 * app-owned (ADR-0274). PixelLab ran at author time only; nothing here is a runtime seam.
 *
 * ANCHOR RULE. Every candidate is re-measured under ONE rule — round-1's own:
 *   "alpha-weighted x across bottom three occupied rows; bottom-most occupied y", alpha > 8.
 * That implementation reproduces round-1's registered (96,188) on all nine accepted frames, so it
 * is the rule that is applied here rather than each experiment's self-declared rule. Where the two
 * disagree BOTH numbers are recorded — in `anchorRule` below, and per frame in each candidate's
 * `tree-registration.json` and `manifest.json`. The disagreement is not cosmetic: see
 * `contactAnchorSpreadPx` and `bodyCentroidSpreadAfterPx`.
 *
 * The registered anchor is stated as a RESIDUAL BOUND, not as an equality: every frame's
 * alpha-weighted contact x lies within 0.5 px of `groundAnchor.x`, and its bottom-most occupied row
 * IS `groundAnchor.y` exactly. That phrasing is deliberate — exp-15 frames 03 and 08 measure
 * exactly 96.5, dead on the tie, where "round to nearest" is not a total function and Python
 * (half-to-even -> 96) and JavaScript (half-up -> 97) disagree. An equality claim would have been
 * true only of whichever language wrote it; the bound is true of both, so `maxAnchorResidualPx`
 * is the number to read.
 */
// NOTE: this module deliberately does NOT import `LAND_CAMERA_ELEVATION_DEG`. A registration
// records what its committed pixels ARE; it must not be able to restate the land's declared camera,
// because a record that reads the value it is supposed to be checked against can never disagree
// with it. The comparison lives in `land-camera.ts` and is asserted in
// `land-camera-composition.test.ts`. See `renderedCameraElevationDeg` below.
import {
  CHAPTER2_ORGANIC_POSE_TO_POSE_REGISTRY,
  CHAPTER2_PLANT_SAMPLE_TRACK,
} from './organic-pose-to-pose-assets.js';
import {
  type OrganicPoseFrame,
  type OrganicPoseHold,
  type OrganicPosePoint,
  type OrganicPoseTrack,
  type RegisteredOrganicPoseRegistry,
} from './organic-pose-to-pose-track.js';

const EXP15_MODULE_PATHS = Object.freeze([
  './assets/exp-15/tree/frame-00.png',
  './assets/exp-15/tree/frame-01.png',
  './assets/exp-15/tree/frame-02.png',
  './assets/exp-15/tree/frame-03.png',
  './assets/exp-15/tree/frame-04.png',
  './assets/exp-15/tree/frame-05.png',
  './assets/exp-15/tree/frame-06.png',
  './assets/exp-15/tree/frame-07.png',
  './assets/exp-15/tree/frame-08.png',
  './assets/exp-15/tree/frame-09.png',
  './assets/exp-15/tree/frame-10.png',
  './assets/exp-15/tree/frame-11.png',
  './assets/exp-15/tree/frame-12.png',
  './assets/exp-15/tree/frame-13.png',
  './assets/exp-15/tree/frame-14.png',
  './assets/exp-15/tree/frame-15.png',
] as const);

const EXP15_URLS = Object.freeze([
  new URL('./assets/exp-15/tree/frame-00.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-01.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-02.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-03.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-04.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-05.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-06.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-07.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-08.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-09.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-10.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-11.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-12.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-13.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-14.png', import.meta.url).href,
  new URL('./assets/exp-15/tree/frame-15.png', import.meta.url).href,
]);

const EXP15_SOURCE_ANCHORS = Object.freeze([
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
  { x: 96, y: 188 },
] as const);

const EXP15_NORMALIZATION_OFFSETS = Object.freeze([
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
] as const);

const EXP16_MODULE_PATHS = Object.freeze([
  './assets/exp-16/tree/frame-00.png',
  './assets/exp-16/tree/frame-01.png',
  './assets/exp-16/tree/frame-02.png',
  './assets/exp-16/tree/frame-03.png',
  './assets/exp-16/tree/frame-04.png',
  './assets/exp-16/tree/frame-05.png',
  './assets/exp-16/tree/frame-06.png',
  './assets/exp-16/tree/frame-07.png',
  './assets/exp-16/tree/frame-08.png',
  './assets/exp-16/tree/frame-09.png',
  './assets/exp-16/tree/frame-10.png',
  './assets/exp-16/tree/frame-11.png',
  './assets/exp-16/tree/frame-12.png',
  './assets/exp-16/tree/frame-13.png',
  './assets/exp-16/tree/frame-14.png',
  './assets/exp-16/tree/frame-15.png',
  './assets/exp-16/tree/frame-16.png',
  './assets/exp-16/tree/frame-17.png',
  './assets/exp-16/tree/frame-18.png',
] as const);

const EXP16_URLS = Object.freeze([
  new URL('./assets/exp-16/tree/frame-00.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-01.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-02.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-03.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-04.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-05.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-06.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-07.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-08.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-09.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-10.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-11.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-12.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-13.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-14.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-15.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-16.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-17.png', import.meta.url).href,
  new URL('./assets/exp-16/tree/frame-18.png', import.meta.url).href,
]);

const EXP16_SOURCE_ANCHORS = Object.freeze([
  { x: 62, y: 122 },
  { x: 67, y: 122 },
  { x: 66, y: 122 },
  { x: 63, y: 122 },
  { x: 66, y: 122 },
  { x: 67, y: 122 },
  { x: 68, y: 122 },
  { x: 68, y: 122 },
  { x: 65, y: 122 },
  { x: 65, y: 122 },
  { x: 63, y: 122 },
  { x: 63, y: 122 },
  { x: 61, y: 122 },
  { x: 61, y: 122 },
  { x: 61, y: 122 },
  { x: 59, y: 122 },
  { x: 58, y: 122 },
  { x: 68, y: 122 },
  { x: 60, y: 122 },
] as const);

const EXP16_NORMALIZATION_OFFSETS = Object.freeze([
  { x: 2, y: 0 },
  { x: -3, y: 0 },
  { x: -2, y: 0 },
  { x: 1, y: 0 },
  { x: -2, y: 0 },
  { x: -3, y: 0 },
  { x: -4, y: 0 },
  { x: -4, y: 0 },
  { x: -1, y: 0 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 0 },
  { x: 3, y: 0 },
  { x: 5, y: 0 },
  { x: 6, y: 0 },
  { x: -4, y: 0 },
  { x: 4, y: 0 },
] as const);

const EXP18_MODULE_PATHS = Object.freeze([
  './assets/exp-18/tree/frame-00.png',
  './assets/exp-18/tree/frame-01.png',
  './assets/exp-18/tree/frame-02.png',
  './assets/exp-18/tree/frame-03.png',
  './assets/exp-18/tree/frame-04.png',
  './assets/exp-18/tree/frame-05.png',
  './assets/exp-18/tree/frame-06.png',
  './assets/exp-18/tree/frame-07.png',
  './assets/exp-18/tree/frame-08.png',
] as const);

const EXP18_URLS = Object.freeze([
  new URL('./assets/exp-18/tree/frame-00.png', import.meta.url).href,
  new URL('./assets/exp-18/tree/frame-01.png', import.meta.url).href,
  new URL('./assets/exp-18/tree/frame-02.png', import.meta.url).href,
  new URL('./assets/exp-18/tree/frame-03.png', import.meta.url).href,
  new URL('./assets/exp-18/tree/frame-04.png', import.meta.url).href,
  new URL('./assets/exp-18/tree/frame-05.png', import.meta.url).href,
  new URL('./assets/exp-18/tree/frame-06.png', import.meta.url).href,
  new URL('./assets/exp-18/tree/frame-07.png', import.meta.url).href,
  new URL('./assets/exp-18/tree/frame-08.png', import.meta.url).href,
]);

const EXP18_SOURCE_ANCHORS = Object.freeze([
  { x: 88, y: 188 },
  { x: 92, y: 188 },
  { x: 91, y: 188 },
  { x: 101, y: 188 },
  { x: 99, y: 188 },
  { x: 96, y: 188 },
  { x: 97, y: 188 },
  { x: 93, y: 188 },
  { x: 92, y: 188 },
] as const);

const EXP18_NORMALIZATION_OFFSETS = Object.freeze([
  { x: 8, y: 0 },
  { x: 4, y: 0 },
  { x: 5, y: 0 },
  { x: -5, y: 0 },
  { x: -3, y: 0 },
  { x: 0, y: 0 },
  { x: -1, y: 0 },
  { x: 3, y: 0 },
  { x: 4, y: 0 },
] as const);

const CODE_BLENDER_MODULE_PATHS = Object.freeze([
  './assets/code-blender/tree/frame-00.png',
  './assets/code-blender/tree/frame-01.png',
  './assets/code-blender/tree/frame-02.png',
  './assets/code-blender/tree/frame-03.png',
  './assets/code-blender/tree/frame-04.png',
  './assets/code-blender/tree/frame-05.png',
  './assets/code-blender/tree/frame-06.png',
  './assets/code-blender/tree/frame-07.png',
  './assets/code-blender/tree/frame-08.png',
  './assets/code-blender/tree/frame-09.png',
  './assets/code-blender/tree/frame-10.png',
  './assets/code-blender/tree/frame-11.png',
  './assets/code-blender/tree/frame-12.png',
  './assets/code-blender/tree/frame-13.png',
  './assets/code-blender/tree/frame-14.png',
  './assets/code-blender/tree/frame-15.png',
  './assets/code-blender/tree/frame-16.png',
  './assets/code-blender/tree/frame-17.png',
  './assets/code-blender/tree/frame-18.png',
] as const);

const CODE_BLENDER_URLS = Object.freeze([
  new URL('./assets/code-blender/tree/frame-00.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-01.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-02.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-03.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-04.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-05.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-06.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-07.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-08.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-09.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-10.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-11.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-12.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-13.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-14.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-15.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-16.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-17.png', import.meta.url).href,
  new URL('./assets/code-blender/tree/frame-18.png', import.meta.url).href,
]);

const CODE_BLENDER_SOURCE_ANCHORS = Object.freeze([
  { x: 64, y: 120 },
  { x: 63, y: 120 },
  { x: 63, y: 120 },
  { x: 63, y: 120 },
  { x: 62, y: 120 },
  { x: 62, y: 120 },
  { x: 62, y: 120 },
  { x: 62, y: 120 },
  { x: 62, y: 120 },
  { x: 61, y: 120 },
  { x: 62, y: 120 },
  { x: 62, y: 120 },
  { x: 62, y: 120 },
  { x: 62, y: 120 },
  { x: 61, y: 120 },
  { x: 62, y: 120 },
  { x: 61, y: 120 },
  { x: 61, y: 120 },
  { x: 62, y: 120 },
] as const);

const CODE_BLENDER_NORMALIZATION_OFFSETS = Object.freeze([
  { x: -2, y: 0 },
  { x: -1, y: 0 },
  { x: -1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 0 },
  { x: 0, y: 0 },
] as const);

const CODE_BLENDER_ANCHOR = Object.freeze({ x: 62, y: 120 });

function frame(
  index: number,
  modulePath: OrganicPoseFrame['modulePath'],
  src: string,
  sourceAnchor: OrganicPosePoint,
  normalizationOffset: OrganicPosePoint,
  normalizedAnchor: OrganicPosePoint,
): OrganicPoseFrame {
  return Object.freeze({
    index,
    modulePath,
    src,
    sourceAnchor: Object.freeze(sourceAnchor),
    normalizationOffset: Object.freeze(normalizationOffset),
    normalizedAnchor,
  });
}

/**
 * Even progress spacing across the delivered frame order.
 *
 * None of the three experiments declared per-frame timing, so the app supplies the mapping rather
 * than inventing pacing on the asset's behalf. `i / n` and `(i + 1) / n` are the SAME expression at
 * each boundary, so the continuous-mapping and settles-at-1 invariants hold exactly, not to within
 * a tolerance.
 */
function evenPoses(frameCount: number): readonly OrganicPoseHold[] {
  return Object.freeze(
    Array.from({ length: frameCount }, (_unused, frameIndex) =>
      Object.freeze({
        frameIndex,
        threshold: frameIndex / frameCount,
        holdUntil: (frameIndex + 1) / frameCount,
      }),
    ),
  );
}

const EXP15_ANCHOR = Object.freeze({ x: 96, y: 188 });

const EXP15_TREE_TRACK: OrganicPoseTrack = Object.freeze({
  id: 'chapter2-round3-exp-15-hero-tree-track-v1',
  kind: 'hero-tree',
  assetOrigin: 'checked-in-module-url',
  transparent: true,
  canvas: Object.freeze({ width: 192, height: 192 }),
  frameDimensions: Object.freeze({ width: 192, height: 192 }),
  frameCount: EXP15_MODULE_PATHS.length,
  frames: Object.freeze(
    EXP15_MODULE_PATHS.map((modulePath, index) =>
      frame(
        index,
        modulePath,
        EXP15_URLS[index]!,
        EXP15_SOURCE_ANCHORS[index]!,
        EXP15_NORMALIZATION_OFFSETS[index]!,
        EXP15_ANCHOR,
      ),
    ),
  ),
  poses: evenPoses(EXP15_MODULE_PATHS.length),
  groundAnchor: EXP15_ANCHOR,
  normalizationMode: 'author-import-time-only',
  depthSlot: 'hero-tree-organic',
  matureFootprint: Object.freeze({ x: 20, y: 2, width: 91, height: 119 }),
  encodedBytes: 143_706,
  decodedRgbaBytes: 2_359_296,
  provenance: Object.freeze({
    prompt:
      "a single mature broadleaf shade tree grown as one continuous plant: one thick tapering trunk that flares into visible surface roots at its base and rises unbroken up into a wide rounded leafy crown, thick branches clearly emerging from the trunk and disappearing into the foliage so the trunk and the crown are obviously the same organism, chunky faceted pixel shading with a soft pale outline, warm brown bark and layered green leaves, no ground, no soil mound, no grass patch, no plant pot, no cast shadow, no border, no frame, one tree only, transparent background",
    modelId:
      "PixelLab create_1_direction_object (view top-down) + create_object_state + animate_object mode v3",
    generationId:
      "object=53188d6e-8219-479e-ac53-6d254167bfa0 promoted-frame=a9c5d071-979c-4935-8623-a2b44afec79b; state seed=31500 clean-base=7d3ad687-337e-449e-aff6-a300af26e8dd; state seed=31501 sapling=1f1466f1-027b-462d-9964-cdd244938711; v3 interpolations d391c8e3-0df1-4a6d-a424-b893cefbb847, 615850e1-060d-48b0-83a8-d9d8f350faa3, a0d79949-5261-4781-a168-bc9aef787131. INCOMPLETE BY THE VENDOR API: create_1_direction_object and animate_object accept no seed parameter, so no seed exists to record for the rig or the three animations.",
    licence: "PixelLab subscription output; use subject to PixelLab Terms of Service",
    notes:
      "Authored at 176x176 and padded losslessly to 192 (no resampling). Frames copied verbatim from the experiment: re-measured under round-1's anchor rule they already sit on (96,188), so this track carries a zero normalization offset on every frame. Registered here for LOOK comparison only; the experiment's own README records a 12.6 px trunk-shaft walk as the number it would lead with against itself.",
    referencePlateId:
      "svg-island-reference-plate.png (155x191), author-time style_images plate only — the experiment records that style_images did NOT transfer the island palette and that the track was never composited against the plate at real scale",
  }),
});

const EXP16_ANCHOR = Object.freeze({ x: 64, y: 122 });

const EXP16_TREE_TRACK: OrganicPoseTrack = Object.freeze({
  id: 'chapter2-round3-exp-16-hero-tree-track-v1',
  kind: 'hero-tree',
  assetOrigin: 'checked-in-module-url',
  transparent: true,
  canvas: Object.freeze({ width: 128, height: 128 }),
  frameDimensions: Object.freeze({ width: 128, height: 128 }),
  frameCount: EXP16_MODULE_PATHS.length,
  frames: Object.freeze(
    EXP16_MODULE_PATHS.map((modulePath, index) =>
      frame(
        index,
        modulePath,
        EXP16_URLS[index]!,
        EXP16_SOURCE_ANCHORS[index]!,
        EXP16_NORMALIZATION_OFFSETS[index]!,
        EXP16_ANCHOR,
      ),
    ),
  ),
  poses: evenPoses(EXP16_MODULE_PATHS.length),
  groundAnchor: EXP16_ANCHOR,
  normalizationMode: 'author-import-time-only',
  depthSlot: 'hero-tree-organic',
  matureFootprint: Object.freeze({ x: 20, y: 2, width: 91, height: 119 }),
  encodedBytes: 74_895,
  decodedRgbaBytes: 1_245_184,
  provenance: Object.freeze({
    prompt:
      "Restyle the colours only. Keep the exact same silhouette, the same pose, the same branch layout and every leaf and root exactly where it is. Take the palette, the soft cream-and-brown outline, the flat facet shading and the gentle low contrast from the reference plate: turn the near-black outline into a warm mid brown, mute the greens toward a soft sage olive, warm and desaturate the bark, and flatten the glossy highlights into flat blocks of colour. It must still read as a green leafy tree on a fully transparent background.",
    modelId:
      "PixelLab edit_image (text mode + reference mode) + animate_image",
    generationId:
      "de-ground seed=31601 job=1dc106d7-9f2d-439c-9693-12abf740f3b1; restyle seeds=31602/31603/31604 jobs=d5f65b0d-820f-4de5-a369-4ac28b17cef4, f50eb313-e932-42fa-b839-4f1f184a56fb, fc584f37-8caa-4d29-9c5f-8e66a6230bfb; interpolations seeds=31610/31614/31615/31617 jobs=23057fac-14fa-4474-8036-04b57449a153, 0f5f762b-43b4-4201-8df0-8985023ab32a, 0ff660b2-d1ac-4666-ba4e-3efee86dc49d, 4a64a8fa-3318-4195-8961-6a2035bd5f31; seedling seed=31619 job=1796a097-0949-4fdc-81c0-75cdcef853df; seedling growth seed=31620 job=ae91862b-c154-40e1-80cc-daf21e55da22",
    licence: "PixelLab subscription output; use subject to PixelLab Terms of Service",
    notes:
      "128x128 because edit_image reference mode caps multi-frame batches at 128 px, and batching is the mechanism that gives all nine source poses the SAME edit. Descends from round-1's accepted poses. Re-measured under round-1's anchor rule every one of the 19 frames needed an integer shift (-4..+6 px): the experiment anchored on a band 32-22 px ABOVE the contact, which is stable but is not the ground contact.",
    referencePlateId:
      "two-panel style plate derived deterministically from the real Studio island render (evidence/style-reference-plate-3x.png); no generated art in the reference",
  }),
});

const EXP18_ANCHOR = Object.freeze({ x: 96, y: 188 });

const EXP18_TREE_TRACK: OrganicPoseTrack = Object.freeze({
  id: 'chapter2-round3-exp-18-hero-tree-track-v1',
  kind: 'hero-tree',
  assetOrigin: 'checked-in-module-url',
  transparent: true,
  canvas: Object.freeze({ width: 192, height: 192 }),
  frameDimensions: Object.freeze({ width: 192, height: 192 }),
  frameCount: EXP18_MODULE_PATHS.length,
  frames: Object.freeze(
    EXP18_MODULE_PATHS.map((modulePath, index) =>
      frame(
        index,
        modulePath,
        EXP18_URLS[index]!,
        EXP18_SOURCE_ANCHORS[index]!,
        EXP18_NORMALIZATION_OFFSETS[index]!,
        EXP18_ANCHOR,
      ),
    ),
  ),
  poses: evenPoses(EXP18_MODULE_PATHS.length),
  groundAnchor: EXP18_ANCHOR,
  normalizationMode: 'author-import-time-only',
  depthSlot: 'hero-tree-organic',
  matureFootprint: Object.freeze({ x: 20, y: 2, width: 91, height: 119 }),
  encodedBytes: 38_871,
  decodedRgbaBytes: 1_327_104,
  provenance: Object.freeze({
    prompt:
      "the same tree at an earlier age, redrawn as a complete healthy young tree, same root, same palette: keep this exact trunk, branch fork and root contact, and turn the flat green mass into a real leafy canopy of layered round moss-green and olive leaf clusters growing directly out of these branches, rounded soft branch tips, one continuously connected organism with no gap or seam between trunk and leaves, storybook pixel art, transparent background, no ground, no soil, no grass, no shadow, no frame, no border, exactly one tree",
    modelId:
      "PixelLab PixFlux create_image_pixflux (img2img: init_image prior + color_image palette lock)",
    generationId:
      "mature source plate seed=31801 job=efcd8090-da5f-4625-8204-6080d90974e0; nine redraws all seed=31850, jobs f62aa447-abec-440f-9ed8-c77181e34207, cb78d704-5c2c-441b-9f83-3f69693ce9bd, 742032b4-9af0-490e-abe1-95bd975aae02, 9211e5ec-5f41-4474-9115-063a9f1a1bd4, 2a558db1-0ad4-4416-bc3d-fe1eb373efe8, 42c7d421-2155-4859-967f-07f5f011179e, 29787cad-e401-4bdf-921d-3b20cc89cc86, 02caaf48-02f3-485a-b015-6b215b621e1b, b9445bcd-e648-4b34-8987-aff211a4122a",
    licence: "PixelLab subscription output; use subject to PixelLab Terms of Service",
    notes:
      "Every frame is one 8-connected alpha component and alpha area is strictly monotonic. Re-measured under round-1's anchor rule 8 of 9 frames needed an integer shift (-5..+8 px): the experiment anchored on a 10-row contact band at alpha threshold 32, which averages the whole four-footed root arch, while round-1's bottom-three-rows band samples whichever single foot reaches lowest (2 px wide on frame 00).",
    referencePlateId:
      "NONE — the track was generated in isolation against its own mature plate (raw/mature-b-efcd8090-00.png). The experiment records that create_map_object was never pulled, so this tree has never been drawn at the real island camera or palette.",
  }),
});

/**
 * exp-15 — object rig + v3 interpolation. Ceilings are the MEASURED actuals — zero headroom by design, so a byte, a frame or a
 * layer added to this candidate fails validation rather than sliding through.
 */
export const CHAPTER2_ROUND3_EXP15_REGISTRY: RegisteredOrganicPoseRegistry = Object.freeze({
  id: 'chapter2-round3-exp-15-v1',
  tracks: Object.freeze([EXP15_TREE_TRACK, CHAPTER2_PLANT_SAMPLE_TRACK]),
  budget: Object.freeze({
    maxEncodedBytes: 168_241,
    maxDecodedRgbaBytes: 2_543_616,
    maxFrameCount: 21,
    maxLayerCount: 2,
  }),
});

/**
 * exp-16 — leader repair. Ceilings are the MEASURED actuals — zero headroom by design, so a byte, a frame or a
 * layer added to this candidate fails validation rather than sliding through.
 */
export const CHAPTER2_ROUND3_EXP16_REGISTRY: RegisteredOrganicPoseRegistry = Object.freeze({
  id: 'chapter2-round3-exp-16-v1',
  tracks: Object.freeze([EXP16_TREE_TRACK, CHAPTER2_PLANT_SAMPLE_TRACK]),
  budget: Object.freeze({
    maxEncodedBytes: 99_430,
    maxDecodedRgbaBytes: 1_429_504,
    maxFrameCount: 24,
    maxLayerCount: 2,
  }),
});

/**
 * exp-18 — topology-eroded prior. Ceilings are the MEASURED actuals — zero headroom by design, so a byte, a frame or a
 * layer added to this candidate fails validation rather than sliding through.
 */
export const CHAPTER2_ROUND3_EXP18_REGISTRY: RegisteredOrganicPoseRegistry = Object.freeze({
  id: 'chapter2-round3-exp-18-v1',
  tracks: Object.freeze([EXP18_TREE_TRACK, CHAPTER2_PLANT_SAMPLE_TRACK]),
  budget: Object.freeze({
    maxEncodedBytes: 63_406,
    maxDecodedRgbaBytes: 1_511_424,
    maxFrameCount: 14,
    maxLayerCount: 2,
  }),
});

const CODE_BLENDER_TREE_TRACK: OrganicPoseTrack = Object.freeze({
  id: 'chapter2-round3-code-blender-hero-tree-track-v1',
  kind: 'hero-tree',
  assetOrigin: 'checked-in-module-url',
  transparent: true,
  canvas: Object.freeze({ width: 128, height: 128 }),
  frameDimensions: Object.freeze({ width: 128, height: 128 }),
  frameCount: CODE_BLENDER_MODULE_PATHS.length,
  frames: Object.freeze(
    CODE_BLENDER_MODULE_PATHS.map((modulePath, index) =>
      frame(
        index,
        modulePath,
        CODE_BLENDER_URLS[index]!,
        CODE_BLENDER_SOURCE_ANCHORS[index]!,
        CODE_BLENDER_NORMALIZATION_OFFSETS[index]!,
        CODE_BLENDER_ANCHOR,
      ),
    ),
  ),
  poses: evenPoses(CODE_BLENDER_MODULE_PATHS.length),
  groundAnchor: CODE_BLENDER_ANCHOR,
  normalizationMode: 'author-import-time-only',
  depthSlot: 'hero-tree-organic',
  matureFootprint: Object.freeze({ x: 22, y: 3, width: 88, height: 119 }),
  encodedBytes: 32_959,
  decodedRgbaBytes: 1_245_184,
  provenance: Object.freeze({
    prompt:
      "none. No generative model produced any pixel in this track: there is no prompt, no vendor request, no credential and no model id anywhere in its authoring path. The generator imports json, math, os, sys, numpy, bpy and mathutils and nothing else.",
    modelId:
      "n/a — the renderer is headless Blender 5.2.0 LTS on CPU Cycles, driven by our own script (ADR-0280 D2a). Blender occupies the FINISH slot the pixel rasteriser sits in; it is never an authority and no .blend is a source of truth.",
    generationId:
      "seed=20260801, CPU Cycles, 72 samples (32 for the contact-shadow pass), supersampled at 384 and box-downsampled to 128. Re-runs from the seed on the pinned build; ADR-0219's committed-frame-is-truth rule governs where exact byte reproducibility across machines cannot be shown.",
    licence: "GPL renderer used at author time only; the committed frames are ours",
    notes:
      "Code owns skeleton, camera and growth (ADR-0280 D1). Topology is a strict PREFIX — the skeleton is grown once, each node records its birth iteration, and the frontier eases out of ZERO length, so nothing is frozen to buy per-frame connectedness. Randomness is identity-keyed, never a draw counter. Girth is secondary growth (pipe model over an age-dependent tip radius), so a young stem is a young stem. The 19 frames are placed at equal SILHOUETTE-CHANGE arc length, measured author-time from an analytic projection of the skeleton. Under ADR-0289 D1 the track animates a tree FORMING rather than a sapling maturing, so the seedling apparatus — leaf blades, the blade-to-cloud handoff, the cotyledon organ — is gone and ONE canopy mechanism carries the whole track: clouds on the outer orders of live shoot, above a canopy floor set as a fraction of the live tree's own height. Under ADR-0293 that mechanism runs in TWO PHASES: the wood extends and branches alone, and the leaves flush onto a tree that is already a tree, so the trunk, the buttress and the branching each have frames in which they are the subject. Output passes the same raster back half as every other candidate; a raw Blender frame shipped as-is is the ADR-0145 failure reproduced.",
    referencePlateId:
      "none. The camera is calibrated to forest-world's own shadow ellipse as a NUMBER (scene.ts rx=0.78R, ry=0.20R => 0.256, against sin 20deg = 0.342), not to an image plate. The one thing borrowed is exp-16's committed 32-colour palette, declared in both scripts.",
  }),
});

/**
 * code-blender — the code-generated candidate. Ceilings are the MEASURED actuals — zero headroom by design, so a byte, a frame or a
 * layer added to this candidate fails validation rather than sliding through.
 */
export const CHAPTER2_ROUND3_CODE_BLENDER_REGISTRY: RegisteredOrganicPoseRegistry = Object.freeze({
  id: 'chapter2-round3-code-blender-v1',
  tracks: Object.freeze([CODE_BLENDER_TREE_TRACK, CHAPTER2_PLANT_SAMPLE_TRACK]),
  budget: Object.freeze({
    maxEncodedBytes: 57_494,
    maxDecodedRgbaBytes: 1_429_504,
    maxFrameCount: 24,
    maxLayerCount: 2,
  }),
});

export type Chapter2HeroTreeCandidateId =
  | 'incumbent'
  | 'exp-15'
  | 'exp-16'
  | 'exp-18'
  | 'code-blender';

/** What one candidate costs, and which of the prior ceilings that cost breaks. */
export interface Chapter2HeroTreeCandidateBudget {
  readonly encodedBytes: number;
  readonly decodedRgbaBytes: number;
  readonly frameCount: number;
  readonly layerCount: number;
  /** Prior-ceiling axes this candidate exceeds. Empty means it fits the round-1 envelope. */
  readonly exceedsPriorCeiling: readonly string[];
}

/**
 * Both anchor readings for one candidate, and what choosing round-1's rule costs it.
 *
 * `contactAnchorSpreadPx` is the ground-contact travel under the APPLIED rule on the frames as the
 * experiment delivered them; `experimentDeclaredDriftPx` is what the experiment reported under its
 * OWN rule. Where those disagree the experiment's rule was measuring a different band, not a
 * different tree. `bodyCentroidSpread{Before,After}Px` is the honest price: re-pinning to the
 * contact moves the tree body by that much.
 */
export interface Chapter2HeroTreeAnchorRule {
  readonly applied: string;
  readonly experimentDeclared: string;
  /**
   * Worst per-frame distance between the measured alpha-weighted contact x and the registered
   * integer `groundAnchor.x`, AFTER normalisation. Bounded by 0.5 px by construction. This is the
   * claim the test checks against the shipped pixels; an equality claim would not be total,
   * because a frame can measure exactly on the 0.5 tie (exp-15 frames 03 and 08 do).
   */
  readonly maxAnchorResidualPx: number;
  /**
   * How far the bottom-most occupied row travels across the track, in px.
   *
   * ZERO for every hand-authored candidate: they are 2D art with a deliberately flat base, so the
   * contact row is a constant and the suite pins it exactly. It is NOT zero for a code-generated
   * candidate rendered through one fixed camera — the trunk base is pinned at world z=0, but
   * secondary growth thickens the trunk, so the near edge of its own footprint descends by
   * `r * sin(cameraElevation)` as it fattens. Buying a constant row would mean shifting the frame
   * upward as the tree matures, i.e. the tree rising out of the ground, which is exactly the base
   * drift ADR-0280 D1 forbids. The band is stated instead, and the suite asserts against it.
   */
  readonly groundRowSpreadPx: number;
  readonly contactAnchorSpreadPx: number;
  readonly experimentDeclaredDriftPx: number;
  readonly framesShifted: number;
  readonly maxAbsShiftPx: number;
  readonly bodyCentroidSpreadBeforePx: number;
  readonly bodyCentroidSpreadAfterPx: number;
  readonly bodyCentroidMaxStepBeforePx: number;
  readonly bodyCentroidMaxStepAfterPx: number;
}

export interface Chapter2HeroTreeCandidate {
  readonly id: Chapter2HeroTreeCandidateId;
  readonly label: string;
  readonly technique: string;
  readonly registry: RegisteredOrganicPoseRegistry;
  /** The hero-tree track inside `registry` the lab mounts. The plant track is shared and fixed. */
  readonly heroTreeTrackId: string;
  readonly frameCount: number;
  readonly canvas: { readonly width: number; readonly height: number };
  readonly groundAnchor: OrganicPosePoint;
  /**
   * The camera elevation, in degrees above the ground plane, this track's committed frames were
   * actually RENDERED at — or `null` for a hand-authored 2D track that was never rendered through a
   * camera at all (ADR-0367 D1).
   *
   * ⚠ THIS IS A RECORD OF THE PIXELS, AND IT MUST BE A LITERAL. It is deliberately NOT
   * `LAND_CAMERA_ELEVATION_DEG` — which this module does not import — and writing the constant here
   * again would re-open the exact hole this field was renamed to close: while the value WAS the
   * land's binding, the two sides
   * could not be observed to disagree. Bumping the constant silently moved this registration with
   * it, so the app claimed the sprite had been rendered at the new angle while the committed PNGs
   * were still the old one — a lie that every assertion passed, because both sides read one binding
   * and nothing compared the binding to the pixels.
   *
   * Transcribe it from the generator's own metadata (`camera_elevation_deg` in the render's
   * `render-meta.json`, emitted by `blender_tree.py`), and change it only when the frames beside it
   * are re-rendered. `spriteRenderMatchesLandCamera` compares it against the land's constant, and
   * `land-camera-composition.test.ts` asserts that over the real registry — so a constant bump
   * without a re-render is a RED.
   */
  readonly renderedCameraElevationDeg: number | null;
  readonly budget: Chapter2HeroTreeCandidateBudget;
  readonly anchorRule: Chapter2HeroTreeAnchorRule;
}

const APPLIED_RULE =
  'alpha-weighted x across bottom three occupied rows; bottom-most occupied y (alpha > 8)';

/**
 * THE ROUND-3 LAB'S OWN WITNESS CAMERA — deliberately NOT `LAND_CAMERA_ELEVATION_DEG` (ADR-0593).
 *
 * `?organicGrowth=r3-lab` / `?semanticGrowth=demo` is a static witness stage for comparing
 * hero-tree candidates against each other, not a variant of the product's working map: measured at
 * ADR-0593 landing time, `chapter2Round3TreeCandidate` and `CHAPTER2_ROUND3_TREE_CANDIDATES` have
 * exactly ONE non-test consumer in the whole repo — `SemanticGrowthDemo.tsx`'s lab/demo witness
 * stage — and `land-camera-composition.test.ts` carries a mechanical control that fails the moment
 * a second consumer shows up, so this fact stays checked rather than merely asserted here.
 *
 * The lab therefore draws and compares its own composition — the accretion island, the shared
 * plant track, the hero tree — at the angle its committed frames actually carry: 20°, the
 * `code-blender` candidate's `renderedCameraElevationDeg`. `LAND_CAMERA_ELEVATION_DEG` moved from
 * 20 to 50 under ADR-0593 D1, but the lab's own pictures were never rendered at the land's camera in
 * the first place (they are compared against EACH OTHER, not planted on land) and must not move
 * just because the land's declared angle did.
 *
 * ⚠ THIS IS A LITERAL, never derived from `LAND_CAMERA_ELEVATION_DEG` — for exactly the reason
 * `renderedCameraElevationDeg` is a literal on each candidate below: a value that reads the land's
 * own binding can never be observed to disagree with it, which is the tautology ADR-0367 D1 exists
 * to end. If a hero-tree track from this registry is ever mounted on the WORKING map instead of the
 * lab, it must be reconciled against `LAND_CAMERA_ELEVATION_DEG`, not this constant — and the
 * mechanical control named above is what forces that decision to be made explicitly rather than
 * inherited by accident.
 */
export const CHAPTER2_ROUND3_LAB_ELEVATION_DEG = 20;

/** The lab's four hero-tree candidates, in comparison order. */
export const CHAPTER2_ROUND3_TREE_CANDIDATES: readonly Chapter2HeroTreeCandidate[] = Object.freeze([
  Object.freeze({
    id: 'incumbent',
    label: "incumbent — round-1 pose-to-pose",
    technique:
      "traditional pose-to-pose sprite animation (the accepted round-1 track, reused unchanged)",
    registry: CHAPTER2_ORGANIC_POSE_TO_POSE_REGISTRY,
    heroTreeTrackId: 'chapter2-hero-tree-pose-track-v1',
    frameCount: 9,
    canvas: Object.freeze({ width: 192, height: 192 }),
    groundAnchor: Object.freeze({ x: 96, y: 188 }),
    renderedCameraElevationDeg: null, // hand-authored 2D; never rendered through a camera
    budget: Object.freeze({
      encodedBytes: 168_541,
      decodedRgbaBytes: 1_511_424,
      frameCount: 14,
      layerCount: 2,
      exceedsPriorCeiling: Object.freeze([]),
    }),
    anchorRule: Object.freeze({
      applied: APPLIED_RULE,
      experimentDeclared:
        "alpha-weighted x across bottom three occupied rows; bottom-most occupied y",
      maxAnchorResidualPx: 0.4478,
      groundRowSpreadPx: 0,
      contactAnchorSpreadPx: 0.9,
      experimentDeclaredDriftPx: 0.9,
      framesShifted: 0,
      maxAbsShiftPx: 0,
      bodyCentroidSpreadBeforePx: 7.7,
      bodyCentroidSpreadAfterPx: 7.7,
      bodyCentroidMaxStepBeforePx: 5.49,
      bodyCentroidMaxStepAfterPx: 5.49,
    }),
  }),
  Object.freeze({
    id: 'exp-15',
    label: "exp-15 — object rig + v3 interpolation",
    technique:
      "one PixelLab object, two states of it, three v3 interpolations spliced by a measured min-max-step selection",
    registry: CHAPTER2_ROUND3_EXP15_REGISTRY,
    heroTreeTrackId: 'chapter2-round3-exp-15-hero-tree-track-v1',
    frameCount: 16,
    canvas: Object.freeze({ width: 192, height: 192 }),
    groundAnchor: Object.freeze({ x: 96, y: 188 }),
    renderedCameraElevationDeg: null, // generated 2D plates; the track declares no camera
    budget: Object.freeze({
      encodedBytes: 168_241,
      decodedRgbaBytes: 2_543_616,
      frameCount: 21,
      layerCount: 2,
      exceedsPriorCeiling: Object.freeze(['decodedRgbaBytes', 'frameCount']),
    }),
    anchorRule: Object.freeze({
      applied: APPLIED_RULE,
      experimentDeclared:
        "alpha-weighted x across bottom three occupied rows; bottom-most occupied y",
      maxAnchorResidualPx: 0.5,
      groundRowSpreadPx: 0,
      contactAnchorSpreadPx: 0.62,
      experimentDeclaredDriftPx: 0.0,
      framesShifted: 0,
      maxAbsShiftPx: 0,
      bodyCentroidSpreadBeforePx: 10.67,
      bodyCentroidSpreadAfterPx: 10.67,
      bodyCentroidMaxStepBeforePx: 4.04,
      bodyCentroidMaxStepAfterPx: 4.04,
    }),
  }),
  Object.freeze({
    id: 'exp-16',
    label: "exp-16 — leader repair",
    technique:
      "round-1's nine accepted poses restyled in batched reference-mode edits onto one shared 32-colour palette, then densified with pinned interpolations",
    registry: CHAPTER2_ROUND3_EXP16_REGISTRY,
    heroTreeTrackId: 'chapter2-round3-exp-16-hero-tree-track-v1',
    frameCount: 19,
    canvas: Object.freeze({ width: 128, height: 128 }),
    groundAnchor: Object.freeze({ x: 64, y: 122 }),
    renderedCameraElevationDeg: null, // generated 2D plates; the track declares no camera
    budget: Object.freeze({
      encodedBytes: 99_430,
      decodedRgbaBytes: 1_429_504,
      frameCount: 24,
      layerCount: 2,
      exceedsPriorCeiling: Object.freeze(['frameCount']),
    }),
    anchorRule: Object.freeze({
      applied: APPLIED_RULE,
      experimentDeclared:
        "alpha-weighted x over the 10-row band 32..22 px above the bottom-most opaque row (the trunk axis above the root flare); groundY = bottom-most opaque row",
      maxAnchorResidualPx: 0.4865,
      groundRowSpreadPx: 0,
      contactAnchorSpreadPx: 10.61,
      experimentDeclaredDriftPx: 0.49,
      framesShifted: 19,
      maxAbsShiftPx: 6,
      bodyCentroidSpreadBeforePx: 5.84,
      bodyCentroidSpreadAfterPx: 11.95,
      bodyCentroidMaxStepBeforePx: 4.72,
      bodyCentroidMaxStepAfterPx: 9.92,
    }),
  }),
  Object.freeze({
    id: 'exp-18',
    label: "exp-18 — topology-eroded prior",
    technique:
      "a model-free anisotropic chamfer geodesic erodes one mature plate into nine growth priors, each redrawn by img2img so the silhouette sets topology and the model supplies the younger-tree detail",
    registry: CHAPTER2_ROUND3_EXP18_REGISTRY,
    heroTreeTrackId: 'chapter2-round3-exp-18-hero-tree-track-v1',
    frameCount: 9,
    canvas: Object.freeze({ width: 192, height: 192 }),
    groundAnchor: Object.freeze({ x: 96, y: 188 }),
    renderedCameraElevationDeg: null, // generated 2D plates; the track declares no camera
    budget: Object.freeze({
      encodedBytes: 63_406,
      decodedRgbaBytes: 1_511_424,
      frameCount: 14,
      layerCount: 2,
      exceedsPriorCeiling: Object.freeze([]),
    }),
    anchorRule: Object.freeze({
      applied: APPLIED_RULE,
      experimentDeclared:
        "alpha-weighted x-centroid over the bottom 10 contact rows, alpha threshold 32",
      maxAnchorResidualPx: 0.4706,
      groundRowSpreadPx: 0,
      contactAnchorSpreadPx: 13.73,
      experimentDeclaredDriftPx: 0.5,
      framesShifted: 8,
      maxAbsShiftPx: 8,
      bodyCentroidSpreadBeforePx: 7.33,
      bodyCentroidSpreadAfterPx: 14.92,
      bodyCentroidMaxStepBeforePx: 4.17,
      bodyCentroidMaxStepAfterPx: 13.67,
    }),
  }),
  Object.freeze({
    id: 'code-blender',
    label: "code-blender — code-generated, Blender finish",
    technique:
      "space-colonisation skeleton, pipe-model secondary growth and a 20° calibrated orthographic camera all computed by our own script; headless Blender 5.2.0 LTS on CPU Cycles supplies the finish, then the same raster back half every other candidate is held to (ADR-0280 D1/D2a). No generative model produced any pixel",
    registry: CHAPTER2_ROUND3_CODE_BLENDER_REGISTRY,
    heroTreeTrackId: 'chapter2-round3-code-blender-hero-tree-track-v1',
    frameCount: 19,
    canvas: Object.freeze({ width: 128, height: 128 }),
    groundAnchor: Object.freeze({ x: 62, y: 120 }),
    // THE ANGLE THE COMMITTED PIXELS BESIDE THIS ENTRY WERE RENDERED AT — a literal, transcribed
    // from the generator's own `camera_elevation_deg` metadata (`blender_tree.py`, whose `--elev`
    // defaults to 20.0). It is deliberately NOT `LAND_CAMERA_ELEVATION_DEG`: see the field's doc
    // comment. While it WAS the constant, a bump moved this record with it and the app claimed a
    // re-render that had not happened. The two being EQUAL is now a checked fact
    // (`spriteRenderMatchesLandCamera`) instead of a tautology, which is what makes ADR-0367 D1's
    // "there is ONE value and both sides read it" observable rather than merely asserted.
    //
    // Change this ONLY together with the frames in `./assets/code-blender/tree/`.
    renderedCameraElevationDeg: 20,
    budget: Object.freeze({
      encodedBytes: 57_494,
      decodedRgbaBytes: 1_429_504,
      frameCount: 24,
      layerCount: 2,
      exceedsPriorCeiling: Object.freeze(['frameCount']),
    }),
    anchorRule: Object.freeze({
      applied: APPLIED_RULE,
      experimentDeclared:
        "none — the generator declares no anchor rule at all. It pins the planting point in WORLD space (trunk base at the origin, camera framed once to the mature extent and byte-identical every frame), so its own lateral drift is 0 by construction; the measured contact spread below is what the PIXEL rule reads off a root flare and crown that are not left-right symmetric",
      maxAnchorResidualPx: 0.5,
      groundRowSpreadPx: 4,
      contactAnchorSpreadPx: 2.4169,
      experimentDeclaredDriftPx: 0,
      framesShifted: 8,
      maxAbsShiftPx: 2,
      bodyCentroidSpreadBeforePx: 3.4635,
      bodyCentroidSpreadAfterPx: 5.8901,
      bodyCentroidMaxStepBeforePx: 1.7204,
      bodyCentroidMaxStepAfterPx: 2.7204,
    }),
  }),
]);

export function chapter2Round3TreeCandidate(
  id: Chapter2HeroTreeCandidateId,
): Chapter2HeroTreeCandidate {
  const found = CHAPTER2_ROUND3_TREE_CANDIDATES.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`Unknown Chapter 2 round-3 hero-tree candidate "${id}".`);
  return found;
}

/**
 * The restated budget. ADR-0274 constraint 6: the round-1 ceilings WILL be exceeded by four
 * candidates and must be restated, never silently blown.
 *
 * `mountedWorstCase` is what the browser actually pays, because the lab mounts EXACTLY ONE hero
 * tree at a time over the fixed plant layer — two organic layers, always, whichever candidate is
 * selected. `shippedTotal` is what the repository and the bundle carry with all five checked in;
 * its decoded figure is a bound that is never reached at runtime, since four of the five tracks
 * are never decoded in a given session.
 */
export const CHAPTER2_ROUND3_LAB_BUDGET = Object.freeze({
  mountedHeroTreeTracksAtOnce: 1,
  mountedOrganicLayersAtOnce: 2,
  priorCeilings: Object.freeze({
    encodedBytes: 200_000,
    decodedRgbaBytes: 1_600_000,
    frameCount: 14,
    layerCount: 2,
    source: 'assets/chapter2-organic-pose-to-pose/manifest.json (the round-1 envelope)',
  }),
  mountedWorstCase: Object.freeze({
    encodedBytes: 168_541,
    encodedBytesCandidate: 'incumbent',
    decodedRgbaBytes: 2_543_616,
    decodedRgbaBytesCandidate: 'exp-15',
    frameCount: 24,
    frameCountCandidate: 'exp-16',
    layerCount: 2,
    exceedsPriorCeiling: Object.freeze(['decodedRgbaBytes', 'frameCount']),
  }),
  shippedTotal: Object.freeze({
    encodedBytes: 458_972,
    decodedRgbaBytesIfEveryTrackDecoded: 7_688_192,
    frameCount: 77,
    heroTreeTracks: 5,
    sharedPlantTracks: 1,
    exceedsPriorCeiling: Object.freeze(['encodedBytes', 'decodedRgbaBytes', 'frameCount']),
  }),
});
