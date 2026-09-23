# The dependency pathways move to the 3D layer — 2026-09-23

Evidence for `pathways-keep-selection-focus-and-accessible-edge-identity` on
`three-d-pathways-arc`. Three arms of ONE build over the live corpus, plus one diagnostic.

**Taken on:** the Mint box (RTX 2060), headless Chromium, 2560x1600, against the studio dev server
at `05f1af88` on `claude/lane-f-pathways-on-the-mount`, live Cloud SQL store. The driver
(`apps/studio/scripts/capture-land-mount.mjs`, `pnpm --filter studio capture:land-mount`) proves the
served tree is this worktree and is not stale before it opens a page.

## What changed

Under `?landMount=1` the **3D layer now draws the dependency pathways** and the SVG's two path
passes are suppressed. It is one decision with two halves, landed together:

- `underlayComposition` returns `trails: true` in registered mode — derived from the mount itself,
  not passed in. `showTrails` keeps its old meaning as the standalone harness's opt-in (ADR-0169 §3)
  and is ignored under a host, because a host's answer is not a debug choice. That is the
  "product-state rule rather than a debug prop" the increment asks for.
- `.world-pan-layer.has-land-mount .trail-net, … .trail-edges { opacity: 0 }` — **both** passes: the
  network and the click-revealed one-hop lit lane. Suppressing only the network would leave the lit
  lane floating over the 3D paths on every selection.

Landing either half alone is a defect — the composition alone double-draws the network, the
stylesheet alone leaves a map with no pathways at all — so a test on each side names the other.

## Edge identity survives, and it is counted where it is real

| count | control | mounted | mounted + props |
|---|---|---|---|
| `[data-edges]` | 342 | 342 | 342 |
| `.trail-net *` | 537 | 537 | 537 |
| parcels | 212 | 212 | 212 |
| nameplates | 36 | 36 | 36 |

The driver now **asserts** this rather than printing it for a human to compare by eye; a count that
moved fails the run. `opacity: 0` is what makes it possible — the elements carrying `data-id`,
`data-edges`, `data-usage` and `data-spur` are still present and still hit-testable, which is
ADR-0380 D6 fence 1 (the pathway may move to the canvas, its identity may not).

⚠ The gate-side suite can only assert PLACEMENT, not counts: jsdom lays nothing out, so nothing is
routed and `[data-edges]` is 0 in both arms there however many edges the payload declares. A
count-equality test in jsdom would have compared 0 to 0 and read as proof. What holds it gate-side
is the byte-identity test — the `<svg>`'s markup is the same string with the flag on and off, so
every attribute survives by construction.

## ⚠ THE PICTURE BARELY MOVES, AND THAT IS THE RESULT RATHER THAN A FAILED CAPTURE

`zoom-paths-control-vs-3d.png` — the `library` island, control beside mounted. The roads look almost
identical, because the 3D ribbon is routed from the same centreline at a near-identical width and
tan. **So the swap is not a visual regression, and it is also not visually obvious.** Do not read
the mounted arm's roads as the SVG's having leaked through; that was checked directly rather than
inferred:

- `.trail-net` computed opacity **0**, `.trail-edges` **0**, and a `.trail-fill`'s effective opacity
  accumulated up its whole ancestor chain **0.000** (`trail-fill@0.62 → trail-fill-pass@1 →
  trail-net@0`). Nothing in the SVG path layer is painting.
- `diagnostic-canvas-hidden-no-paths-remain.png` — the mount with the CANVAS hidden and the CSS
  suppression still in place: **no roads remain anywhere**. ⚠ Its framing differs from the arms
  above (it is a separate page load, so the map re-fit and the corpus poll moved — `[data-edges]`
  read 312 there against 342 in the arms). It is a diagnostic, NOT an aligned third panel, and it is
  kept as its own file for exactly that reason.

## What is NOT here

- **No owner verdict.** Whether the mounted pathways READ well at fit and working zoom is
  `the-mounted-3d-pathways-read-at-working-zooms` on the same arc — that row is the formal look, and
  it becomes stageable now that this one has landed.
- **No keyboard or screen-reader affordance added.** ADR-0380 D6 fence 1 forbids making
  accessibility worse and does not oblige this row to improve it. Edge identity and the hit surface
  are PRESERVED, unchanged; edges had no keyboard selection before this row and have none after.
- **No frame-cost figure** for the 3D path layer, and no Adreno acceptance-floor figure.
- **No art retuning.** The 3D ribbon's colour, width and its `+0.2` lift off the ground plane are
  untouched; if the look needs work on real relief that is a surface-lane successor, not a change
  made during a delivery landing.
