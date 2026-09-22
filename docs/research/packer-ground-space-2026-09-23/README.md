# The map before and after the packer stopped asking the camera where to put things

**Captured 2026-09-23 on the REAL forest** — the live store's 36 islands, through the studio's own
map, both arms at the shipped camera and the shipped spacing. Not a fixture, not a ladder: one arm
is `origin/main` as it stood, the other is the same code with one line changed.

This sheet EXISTS TO BE LOOKED AT AND IS NOT A VERDICT. Nothing here judges whether the new map is
better; the numbers below are what the instrument measured, and the pictures are for the owner.

The look it was staged for is
`oq-the-map-moved-when-the-packer-stopped-asking-the-camera-w`, on
`mount-the-land-on-a-real-surface-arc`. The code landed in PR #2020; the increment is
`the-packer-decides-in-ground-space-not-through-the-camera`.

## What changed in the code

One line. `packWorld` works out where each island goes in **ground** units — the row and gap
arithmetic mentions no camera anywhere — and then snapped that point onto the hex grid using a
function that expects **screen** coordinates. That function divides the vertical coordinate by
`sin(camera angle)` to undo the camera's foreshortening, so feeding it a ground point stretched the
whole forest down its long axis before rounding it to a tile: **1.31x at the shipped 50°**. The
camera was choosing which tiles each story grew onto. It is not allowed to (ADR-0527 D1,
ADR-0546 D1: the layout is re-projected, never re-decided).

The fix snaps at plan view, where that factor is exactly 1.

## The two arms

| | `before/` | `after/` |
|---|---|---|
| the packer | `origin/main` — snap through the 50° camera | the fix — snap in ground space |
| islands | 36 | 36 |
| trail edges routed / dropped | 95 / 0 | 95 / 0 |
| world box | 854 x 1330 | 835 x **1038** |
| fitted view: content drawn | 973.9 x **1658.1** px | 950.4 x **1238.7** px |
| fitted view: viewport | 2560 x **1600** px | 2560 x **1600** px |
| fitted view: zoom | 1.3807 | 1.4507 |
| median island on screen | 89.5 px | 90.7 px |

`2d-fit.png` is the whole forest at the fitted framing; `2d-resting.png` is the view the map
actually opens on, which is a crop of it.

## The two things the numbers say

**The forest is 22% shorter and the same width.** Nothing was removed — same 36 islands, same 95
trails, none dropped. The height came out of the 1.31x stretch, which was never meant to be there.
Sideways the map barely moves (−2.2%), which is the expected shape: the camera only ever touched
the depth axis.

**"Fit the whole forest" was not fitting it.** In `before/`, the drawn content is **1658 px tall in
a 1600 px viewport** — it overflows, and the top of the forest falls off the picture. Look at the
top edge of `before/2d-fit.png`: the frame cuts straight through `desktop`'s own tiles, and a trail
runs up out of the frame to islands that are not in the picture at all. Those islands are
`terminal-repo-picker`, `terminal-tabs` and `embedded-terminal`, and in `after/2d-fit.png` all
three sit inside the frame with margin above them. In `after/` the content is 1239 px and fits with
room to spare.

This is a CONSEQUENCE of the fix rather than the thing that was fixed, and it is the most visible
difference between the two pictures. It is also the clearest illustration of why the defect
mattered: the forest was being drawn taller than the box that was measured for it.

## What this sheet does NOT settle

It does not answer the open density question
(`oq-gaps-derived-forest-still-sparse-tile-or-positions`). The forest does get denser here — same
land in a smaller box — but that is a SIDE EFFECT of removing a stretch, not a density dial being
turned, and ADR-0593 D4 is explicit that the forest's density and the camera angle are two separate
knobs that must not be traded against each other in one judgment. Nothing here touches the camera.
If the new density is still too sparse, that is the same question it was, now asked of a map whose
layout is honest.

## How to reproduce

Start the studio from this worktree on a port of your own, against the live store, then from
`apps/studio`:

```
ST_STUDIO_URL=http://127.0.0.1:<port> \
ST_REAL_EVIDENCE_OUT=<dir> ST_REAL_SCENES_OUT=<dir>/scenes \
node --import ../../scripts/tsx-cache-off.mjs --import tsx scripts/export-real-forest.mjs
```

The exporter refuses a studio that is not this worktree's, or not on the live store, or whose map
has not finished streaming — so a picture it produced is of the corpus it says it is. The `before/`
arm was taken by reverting the one line in place and restarting the server; no other difference.
Both arms ran back to back against the same store within one minute, and the checkout did not move
between them (both manifests stamp head `3729273c`).
