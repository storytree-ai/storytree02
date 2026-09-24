# The public website's roads were bent off their routes (lane AA, 2026-09-25)

The owner, on the live site: *"pathways that are broken - seems to have hidden pathways that dont
show up unless you click on them."*

## What was actually wrong (measured)

- The 3D land **carried every road**: all 117 road segments of the published drawing arrive in
  `/forest-land.json`, and every dependency (90 of the snapshot's 91; the 91st names a story not in
  the snapshot) rides one. Nothing was dropped, and the growth animation was not stuck.
- But the step that sizes each island to its component count **bent the roads**. Every public island
  is shrunk to 0.55–0.83 of its drawn size, and the rule moved every road point toward its nearest
  island by `(p − centre)·(s − 1)` — a pull that GROWS with distance from the island. The public map's
  roads are bundled junction to junction far out in open ground, so all 117 segments left their
  drawn route: median 24 units, worst 48.
- A click lights the island's **drawn** route (the SVG selection lane), which the 3D road had left —
  so a road appeared where none was drawn. That is the owner's "hidden pathway".
- The studio's land uses the same step (`landStreamFromDrawing`), so the same bend is in the studio's
  3D map; the fix is in the shared engine and covers both.

## The fix

`packages/forest-world-r3f/src/true-footprint.ts`: a road now moves with an island only NEAR that
island — exactly the ground's move inside the island's reach, tapering to nothing across a band one
reach wide, and not at all beyond. It is a function of position alone, so junctions stay joined.
On the real snapshot: every open-ground road point is exactly on its drawn route; the largest move
left is 11.7 units, all within a shore band (a road meeting its shrunken island).

## Pictures — one snapshot (1 September 2026), three builds, this box's RTX 2060

| arm | website build | what it is |
| --- | --- | --- |
| `flat` | `9016b43` | the control: the flat map before the 3D land |
| `now` | `1552148` | what is deployed: 3D land, roads bent |
| `fixed` | this branch | 3D land, roads on their routes |

- `entry-settled-{flat,now,fixed}.png` — the entry forest after TELL hands the map back.
- `entry-drawn-routes-{flat,now,fixed}.png` — the same, with every road's DRAWN route (what a click
  lights) outlined in red. In `now` the 3D roads run beside, across and away from the red; in
  `fixed` they sit under it.
- `forest-poster-{flat,now,fixed}.png` — the `/forest/` poster.
- `probe-live-forest-routes-vs-land.png` — the live site, land only, with each drawn route sampled:
  blue = the 3D land has road there, red = it does not.
- `probe-fixed-entry-routes-vs-land.png` — the same probe on the fix (entry forest).

## Counts (`measure.mjs`, road pieces on screen whose drawn route has no 3D road under it)

| surface | live / now | fixed |
| --- | --- | --- |
| `/forest/` poster | 45 of 79 | 1 of 79 |
| entry forest | 54 of 75 | 13 of 75 |

The fixed entry forest's 13 are the probe reading under the page's own text (top left), plus two
spans of the main trunk where it passes the largest island (drive-machinery) and is nudged a few
pixels toward that island's shrunken shore — drawn, and inside the shore band by design.

Held by `web/src/scripts/public-roads.test.ts` (reds on the old rule: 1,736 open-ground points off
route) and the engine's `true-footprint.test.ts`.
