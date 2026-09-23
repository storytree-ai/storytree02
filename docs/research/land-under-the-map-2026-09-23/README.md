# The 3D land under the working map — 2026-09-23

Evidence for `the-land-sits-under-the-working-map` on `mount-the-land-on-a-real-surface-arc`
(ADR-0530 route C). Three arms of ONE build over the SAME live corpus, differing only by the query
flag this increment added.

**Taken on:** the Mint box (RTX 2060), headless Chromium, 2560x1600, against the studio dev server
at HEAD `9cb2bd2a` on `claude/lane-f-the-mount`, live Cloud SQL store (`store: pg, db: ok`, 47
stories). The capture driver proves the server's `code.directory` names THIS worktree, and that its
`code.stale` is false, before it opens a page — this box runs several worktrees at once, and a
sibling's server (or this tree's own server still holding pre-merge code) would otherwise be filed
as this branch's evidence.

⚠ **WHICH MAP THESE PICTURES ARE OF, because it changed twice today.** They are taken AFTER both
sibling lanes landed: PR #2027 (`lane-d`, the map's spacing re-derived so nameplates stop
overlapping) and PR #2026 (`lane-e`, every acceptance criterion drawn, unsigned ones as unopened
buds — ADR-0600). So the islands sit at the new spacing and carry the new buds, and the land is
registered under both. An earlier set of these arms was taken against the pre-merge layout and
discarded; the registration held across the layout change without any change to this branch, which
is the property that matters — `registrationCamera` solves from the studio's own camera, so it is
independent of where the islands happen to sit.

**Instrument:** `apps/studio/scripts/capture-land-mount.mjs`.

## The arms

| file | flag | what it is |
|---|---|---|
| `1-control-map-as-it-ships.png` | — | the working map, untouched |
| `2-land-under-the-map.png` | `?landMount=1` | **the increment**: the 3D ground under the SVG layer |
| `3-land-and-props-under-the-map.png` | `?landMount=1&landMountProps=1` | the staging arm: land + kit props |
| `zoom-one-island-three-arms.png` | — | `drive-machinery` at 1:1 across all three |

`measurements.json` carries the per-arm element counts.

## What the numbers say

Element counts are **identical in all three arms** — 212 parcels, 114 trail fills, 36 nameplates, 2
ground layers (this run; `measurements.json` is the authority, and the absolute values move with the
corpus and the layout — what this evidence claims is that the three arms AGREE). The mount takes nothing from the map: the SVG's ground layers are hidden with
`opacity: 0`, so every element (and every hit target) is still present and still hit-testable.

## What the pictures say

The land is drawn, registered, and underneath. In arm 2 the island has real relief, grain, a true
coastline and a shaded side wall, and the map's own tree, shrubs, grass tufts, flowers and nameplate
sit on top of it in exactly the places arm 1 puts them. Status colour still reads — the yellow
`proposed` islands (`website`, `app-surface`, `cli`) are yellow in the 3D ground too.

Arm 3 is a **finding, not a delivery**: the 3D kit trees and the SVG's own crown draw together, so
the island wears two canopies. That is why the props are off by default and why ADR-0530 D3's
per-prop status-carrying question is still owed before they mount for real.

## ⚠ THE DEFECT THIS CAPTURE CAUGHT, WHICH NOTHING ELSE COULD

The first run of arm 2 came back with **the entire SVG flora layer invisible** — no tree, no shrubs,
no grass, no flowers — while the DOM still held 1,996 flora marks, 8,781 grass blades and 78 flower
markers, and while every element count matched the control exactly.

The cause was a CSS painting-order mistake in this increment's own reasoning. The land layer must be
`position: absolute` to overlay the frame; the map's `<svg>` is `position: static`; and **CSS paints
positioned descendants above non-positioned in-flow content regardless of DOM order** (CSS 2.1
painting order, step 8 against steps 4 and 7). So "the canvas is the first child, therefore the SVG
paints on top" — which is what the increment asserted and what its jsdom test pinned — is false.

It was invisible to everything except a picture: jsdom paints nothing, so the DOM-order test passed;
and the element counts were identical, so the numbers passed too. The fix states the z-order
explicitly (`.land-mount` at `z-index: 0`, the `<svg>` at `position: relative; z-index: 1`, both
scoped to `.has-land-mount` so the flag-off route keeps a static SVG), and the test now asserts that
explicit ordering rather than its absence.

Negative indices were considered and rejected: `z-index: -1` on the land alone works only while
`.world-pan-layer` happens to be a stacking context — true when it carries a drag transform, false
when the transform is `none` — so the land would vanish behind `.world-frame`'s gradient depending
on whether a drag was in flight.

## What is NOT here

- **No Adreno figure.** The ADR-0380 D2 acceptance floor is still unmeasured on this arc; this box
  has an RTX 2060. No number here may be quoted as a floor figure.
- **No frame-cost measurement of the mounted map.** End-state item 6 is untouched by this
  increment.
- **No props delivery.** Arm 3 stages the question; it does not answer it.
