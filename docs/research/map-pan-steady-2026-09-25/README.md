# Panning the map: the flicker and the shake, found and fixed (laneY, 2026-09-25)

The owner, on the new default map (ADR-0608): *"looks great, however its buggy, theres flicker as
you pan around the map, feels like the screen is shaking"*.

## What to look at (ADR-0601)

| | before (main at `44c5dfe5`) | after (this branch) |
| --- | --- | --- |
| The same pan, recorded | [pan-before.webm](pan-before.webm) | [pan-after.webm](pan-after.webm) |
| Frames around a drag release | [release-frame-strip.png](release-frame-strip.png), top row | same picture, bottom row |

Both clips are 12 s from the probe's own recording (Playwright's screencast, 25 fps, downscaled to
1200×750): six mouse drags, twelve wheel notches, then eight arrow-key presses. The same gestures,
the same frozen snapshot (47 stories, sha256 `399b3080…`), the same browser. The two arms differ
only in the studio bundle that was served. In the "before" clip, the land jumps away from its names
and back at the end of every drag, and on each wheel notch and key press. In the "after" clip, the
land and the names move as one piece.

## What was wrong

The map is two layers: the 3D land (a WebGL canvas) under the SVG layer that carries the names, the
click targets, the wisps and the selection lanes. While a drag is in flight, both layers ride one
CSS translate on `.world-pan-layer`, so they cannot disagree. When the drag ENDS, the studio folds the
offset into the SVG camera and resets the translate, both in ONE React commit
(`compositor-pan-transform`). The canvas also had to pick up the new camera, and it did so through
R3F's own separate reconciler (a child of `<Canvas>` whose layout effect ran on R3F's schedule),
followed by an `invalidate()` that drew the frame on a LATER animation frame. So the page presented
at least one frame with the SVG on the new camera and the land on the old one, with the translate
already gone. The land therefore jumped back by the whole drag distance, then forward again. Wheel
zoom and arrow keys change the camera directly, and had the same one-frame tear.

## The fix

`packages/forest-world-r3f/src/ForestWorldCanvas.registered-camera.ts`: the host's camera is applied
AND the frame is drawn synchronously, in a layout effect of the HOST's reconciler. That is the same
commit, before the same paint, as the SVG transform the land has to match. The camera authority is
still the host's alone. There is no renderer clock and no second picker, and nothing on the canvas
draws unless the host's camera moved.

## The measurement ([probe-report.json](probe-report.json), [pan-probe.mjs](pan-probe.mjs))

The probe uses a headed Chromium 148 on this box's RTX 2060 (ANGLE/OpenGL), at 60 fps. It samples
every painted frame in a task posted from `requestAnimationFrame`. Each sample reads the SVG
camera's transform plus the pan layer's translate. It also reads the camera the land was last DRAWN
with, taken from outside the app by wrapping the WebGL2 context: the projection and model-view
uniforms current at the ground mesh's draw call. No product code carries a probe.

| per painted frame | before | after |
| --- | --- | --- |
| frames sampled | 620 | 625 |
| frames with land and SVG out of register (> 0.5 px) | **36** | **0** |
| worst disagreement | **323 px** | **0 px** |
| during drags (one at every release) | 6, up to 323 px | 0 |
| during wheel zoom | 14, up to 192 px | 0 |
| during arrow keys | 16, 60 px | 0 |
| blank frames (canvas cleared, nothing drawn) | 0 | 0 |

Traps this measurement fell into first, so the next one does not:
- The monitor on this box was DPMS-off. That throttled headed Chromium to **one frame per second**,
  and the first run was worthless. Run the probe inside `xset -dpms; xset dpms force on` and restore
  `xset +dpms` afterwards, as the usage line in `pan-probe.mjs` shows.
- Screencast video runs at 25 fps, so it catches a single 60 Hz tear only some of the time. The
  per-frame probe is the proof. The video is only the picture.

## What this does NOT fix

About 25 of ~620 frames in BOTH arms take longer than 50 ms. They cluster on wheel zoom and arrow
keys, where the SVG layer's whole subtree is repainted for the new camera. That is a stutter
(a dropped frame), not a tear, and it is unchanged here.
