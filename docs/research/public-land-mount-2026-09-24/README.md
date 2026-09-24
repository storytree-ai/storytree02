# The public forests draw the 3D land — staged 24 September 2026

ADR-0608 D4: the public website moves to the mounted 3D land with the studio. This stages the
website change (storytree-web `2325978d`, branch `claude/laneP-public-land`) against its control
(web `main` `1f318f17`, as published), per ADR-0601.

**Held identical across both arms:** the published snapshot `src/data/forest-snapshot.json`
(sha256 `7e5519b7…`, dated 1 September 2026 — 35 islands, 25 proven), the viewport (1600×1000),
the browser (Chromium 148, headless, this box's RTX 2060 through ANGLE/GL, WebGL 2 reported by
both pages), and the capture path (`capture.mjs`). The ONLY difference is the website source.
`receipt.json` carries each picture's sha256 and the measured frame pacing.

| Surface | Before (published) | After (this change) |
|---|---|---|
| `/forest/` poster, settled | `forest-poster-before.png` | `forest-poster-after.png` (land state `drawn`) |
| `/` entry forest, settled (~14 s after the skip) | `entry-settled-before.png` | `entry-settled-after.png` (land state `drawn`) |
| `/` entry forest, ~1 s into growth | — | `entry-growing-after.png` |

## What changed, in plain terms

Both maps now draw ONE drawing, at the declared 50° land camera, and that same drawing is the 3D
land underneath — no second layout, sizing, camera or clock. The flat board, painted ground,
hero trees and flat roads are hidden once the land is drawn; the nameplates, click targets, the
key, the stamp and the prose all stay on top. Because the map is now seen at 50° instead of from
straight above, it is about a quarter shorter, so the entry forest's designed crop now shows more
rows (the resting-view rule itself is unchanged).

## What I make of it — appearance is the owner's verdict, not mine

- **Registration holds.** Every nameplate sits under its own island on both surfaces; the land
  and the labels agree without any hand-fitted offset.
- **Growth is causal on the land too.** Roads draw out first and islands form where they arrive,
  on the website's own growth plan read at wall-clock time (`data-growth` on the land layer read
  35→17→2→0 absent islands over the first ~2 s, then `settled`). The website's growth is short
  (under 3 s), so the growing picture catches it early.
- **It runs well in a current Chrome here.** Frame pacing while growing: 120 frames in 2 s,
  median and p95 16.7 ms (60 fps), worst 33 ms; no console errors on either arm. That is this
  box's GPU, not a claim about every machine — but it is no evidence of the D4 exception.
- **Weight.** The land data is 1.86 MB (≈250 KB gzipped); the canvas chunk is the studio's own
  (3.5 MB, ≈2.1 MB gzipped, most of it the embedded plant kit). Both load only once a forest mounts.
- **Roads read heavier** than the flat hairlines they replace — that is the approved studio road
  look, not a website choice.
- **Known and deferred (ADR-0608 D6):** a few plants float beside islands mid-growth.

## Not shown, honestly

A ROAM selection picture was attempted and dropped: the capture's click and keyboard routes
opened no panel on EITHER arm (the published site included), so it measures the harness, not this
change. Structurally the land layer is `pointer-events: none` under the SVG and the hit targets
are untouched; a selected island now shows a ring on its coast instead of a drop-shadow on flat
ground. The owner walking it is the real check.

Unsupported-stack and failure messages are unit-tested (`forest-land-layer.test.ts`) and visible
in code review; they were not forced in a browser here.
