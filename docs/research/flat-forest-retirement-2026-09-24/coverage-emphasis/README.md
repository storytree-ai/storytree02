# Coverage plants at the approved emphasis

The owner kept the coverage plants at their current emphasis (ADR-0608, option A — the flat marks as
he saw them on the mounted map). The 3D plants landed at a staging width of 8 world units and
carpeted the islands. This landing sets them to **3.75**, chosen by measurement, not taste.
**Appearance is the owner's verdict; nothing here claims it.**

## The pictures

One live-corpus snapshot (47 stories, frozen 2026-09-24T10:06Z) replayed byte for byte into three
builds that differ ONLY in the coverage plant; the mounted 3D camera is identical across all three at
both framings (`capture-manifest.json`: `sameMountedCamera-rest/zoom: true`). Opening view is the
studio's ordinary mounted map (`?landMount=1&landMountProps=1`); zoomed is eight real wheel steps.

| | opening view | zoomed |
| --- | --- | --- |
| 1 · flat marks, no 3D plants (what he approved) | `1-flat-marks-opening.png` | `1-flat-marks-zoomed.png` |
| 2 · 3D plants at width 8 (what landed), flat marks hidden | `2-3d-width8-opening.png` | `2-3d-width8-zoomed.png` |
| 3 · 3D plants at width 3.75 (this change), flat marks hidden | `3-3d-width3.75-opening.png` | `3-3d-width3.75-zoomed.png` |
| 4 · legend "fade healthy", flat marks hidden | `4-dimmed-width8-zoomed.png` | `4-dimmed-width3.75-zoomed.png` |

Arms: `flat` = `c5b16fa1` plus a one-line scratch patch that skips placing the 3D coverage plants
(recorded verbatim in the manifest); `w8` = `c5b16fa1` unchanged; `corrected` = this branch.

## The measurement (`measurement.json`, `measure.mjs`)

Share of island ground covered (pixels changed by the marks, plants AND their shadows for 3D):

| | opening | zoomed | mean |
| --- | --- | --- | --- |
| flat marks | 7.2% | 5.6% | 6.4% |
| 3D, width 8 | 15.4% | 16.4% | 15.9% |
| 3D, width 3.75 | 6.8% | 6.9% | 6.8% |

There is one 3D plant per flat mark (2,576 each), so the count rungs — more tests, more plants —
are untouched and only the width was free. A trial at width 4 measured 7.25% / 7.44%; share goes
as width squared, so `4 × √(6.4 / 7.35) ≈ 3.73`, rounded to 3.75. Contrast ("ink", mean colour
change per ground pixel) is still 1.1–1.5× the flat marks' at 3.75, because the leafy plants are
darker than the pale flat tufts; area was the declared target, so the width was not driven lower.

## What is NOT fixed here, and why

- **Faded plants' shadows do not fade.** Every shadow is baked into the island ground's texture from
  one caster list, built with the ground; the legend changes only prop materials. Fading a shadow with
  its plant means rebuilding the ground on each legend click (the ground rebuild is the ~1.9 s frame
  freeze this canvas already caches against) or a separate per-status shadow layer — a renderer
  design change, not a size correction. The same holds for the pines, whose triangular shadows are
  the large dark shapes left in picture 4. At 3.75 the plants' own residual shadows are far smaller.
- **Coverage vs decorative cover is no longer told apart by bulk.** Both use the same leafy-plant
  objects; decorative bushes (all-healthy islands only) are delivered 3.23–6.22 wide, so a 3.75
  coverage plant sits inside that range. They now differ by status tint and placement only. A FORM
  difference needs a kit object the shipped asset does not carry.
- Floating and tree collisions stay deferred (ADR-0608 D6).
