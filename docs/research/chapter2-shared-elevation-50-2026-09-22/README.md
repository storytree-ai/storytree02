# The honest 50° map, on the real forest — ADR-0593 D5's owed evidence

**What this is.** ADR-0593 D1 moved `LAND_CAMERA_ELEVATION_DEG` from 20° to 50° so the flat SVG map
and the 3D land share one elevation. D5 says the honest 50° render is owed as a **report** — it
informs the separate density question and gives the owner a cheap veto, and it does **not** gate the
change. This is that report. The change is landed; nothing here asks for a decision.

**Why it was owed.** The comparison sheet the held question was meant to rest on
(`../chapter2-shared-elevation-2026-09-15/`) drew its two "50° map" rows through the `?elevation=`
flag, and that flag never reached the whole drawing. ADR-0593's Context records the defect and marks
those island figures **UNVERIFIED**. So this is the first 50° map anyone has actually looked at.

## Where it was taken

| | |
|---|---|
| machine | Mint desktop, NVIDIA GeForce RTX 2060 |
| commit | `e36f2ac5` on `claude/shared-elevation-50` |
| corpus | the LIVE store, read through this worktree's own studio — 36 islands, 95 trail edges routed, 0 dropped |
| exported | 2026-09-22T14:12:37Z |
| buffer | 2560 × 1600, device pixel ratio 1 |
| elevation | **the shipped default** — `ST_REAL_ELEVATION` deliberately UNSET |

**The flag is not used here, and that is the point.** The only honest way to see a 50° map is to move
the constant, which this branch does. Asking for `?elevation=50` produces a map that is 50° in some
places and 20° in others — see "the flag" below.

## The pictures

| file | what |
|---|---|
| [`2d-resting.png`](2d-resting.png) | the map at the framing the studio actually opens on (ADR-0471) |
| [`2d-fit.png`](2d-fit.png) | the map with the whole forest fitted into one screen |
| `scenes/` | the exported scene graph, and the manifest every number below is read from |

Compare against `../chapter2-shared-elevation-2026-09-15/2d-resting-at-20.png` and
`2d-fit-at-20.png`. **Those two ARE honest 20° maps** — they were the shipped-default arm on the day,
when the constant was 20. It is only that sheet's *50°* rows that were not what they claimed.

## ⚠ THE FINDING: the cost ADR-0593 D2 accepted is not being paid

D2 accepted, knowingly, that the world box would deepen **2.24×** (826 × 1310 → 826 × 2819) and that
"roughly half as many rows of forest fit the opening screen". **Measured on the real forest, that did
not happen.** Both columns below are the shipped default arm — 20° then, 50° now.

| | 20° (2026-09-15) | 50° (2026-09-22) | change |
|---|---|---|---|
| map world box | 826 × 1310 | **854 × 1330** | +3.4% wide, **+1.5% deep** |
| fitted — median island width | 86.2 px | **91.0 px** | **+5.5%** |
| fitted — content extent | 927 × 1618 | 990 × 1685 | +6.8% / +4.1% |
| fitted — zoom | 1.400 | 1.381 | −1.4% |
| resting — median island width | 206.4 px | **200.7 px** | −2.8% |
| resting — content extent | 2220 × 3874 | 2184 × 3717 | −1.6% / −4.1% |

D2's predicted **2819** came from the flag arm, which snapped its island seeds at one camera and drew
them at another — so that arm's depth was an artefact of the mismatch, not a property of 50°.

**Why the real map barely deepens.** The row positions the packer lays islands on are expressed in
SCREEN units and then snapped to the hex lattice. At a coherent 50° the snap un-maps them at the same
camera they were written in, so the rows land where they were meant to and the forest's overall
footprint is preserved. At 20° they were un-mapped through a 2.92× stretch instead of a 1.31× one.

**What the owner asked for IS delivered.** Elevation does not touch *x*, so each island's on-screen
DEPTH — and therefore its drawable area — multiplies by `sin 50° / sin 20°` = **2.24**. That is
arithmetic, and the pictures show it plainly: at 20° the islands read as flattened ribbons, at 50° as
full landmasses with the hex grid legible across them. His stated purpose was *"the birds eye view
will allow us to fit more on the island … so this birds eye view will give us more room to play
with"*, and that is what the resting picture shows.

**The two together mean the forest got DENSER, not sparser**: the islands grew into a footprint that
stayed put. That bears directly on the open question
`oq-gaps-derived-forest-still-sparse-tile-or-positions`, which asks whether the forest is too sparse
now that gaps derive from island size. ⚠ It does **not** settle it, and per ADR-0593 D4 nothing here
may be used to trade the camera against the density knob.

## Two caveats, so the numbers are not over-read

1. **The corpus moved.** Both runs show 36 islands, but the live store changed in the seven days
   between them (`drive-machinery` reads 27 capabilities on 09-15 and 26 tonight). Small, and it does
   not move a world box by a factor of two, but this is not a frozen A/B.
2. **This landing also fixed the seed snap.** `packWorld` had two calls taking their own module
   default instead of the resolved elevation. Fixing them is what makes a 50° map coherent at all, so
   the 50° column is "50° as it now ships", not "50° with everything else held identical". There is no
   honest way to separate the two: the unfixed version's 50° is the mismatch the flag produced.

## The flag, recorded because it misled once already

`?elevation=<deg>` reaches the projection but did **not** reach the island packing. Measured
2026-09-22: at the shipped constant the same-row island separation is identical for every value of
the argument, and only moving the constant itself moves it. Both defects are fixed on this branch and
both are now pinned by tests, but **a `?elevation=` picture taken before this landing is not an honest
arm of the map** — which is exactly how the held question's rows came to be today's map, reviewed for
six days as something else.

## What is still owed, and by whom

Nothing, from this report. The mount itself (`the-land-sits-under-the-working-map`) is the next unit
on `mount-the-land-on-a-real-surface-arc`; the registration seam now has its equal-`sin` condition and
a test that asserts the two shipped layers resolve the same world point to the same pixel.
