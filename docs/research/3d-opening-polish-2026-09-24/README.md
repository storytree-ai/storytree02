# The studio's 3D map opening reads well throughout

Increment `the-3d-map-opening-reads-well-throughout` (`mount-the-land-on-a-real-surface-arc`, ADR-0608 D1a).
Everything here was captured on a **production build** (`pnpm --filter studio build` + the production
server), on the real RTX 2060, route `?landMount=1&landMountProps=1&act2=intro`, viewport 1800 × 1100.
Every run replayed ONE frozen live API snapshot (sha256 `a871e2759c…`, the same snapshot lane S's
`../3d-cold-opening-2026-09-24/` used), and every run held `/tmp/storytree-heavy.lock`. BEFORE is `main`
at `bd813e0c` (PR #2075); AFTER is this branch. Only the two changed source files differ between arms.

- [Before/after frame sheet](opening-before-after-frame-sheet.png): 3 s → 30 s at the same clip times.
- [Loading notice close-up](loading-notice-closeup.png): the top half of the map at 3 s, full resolution.
- [Slow frames chart](slow-frames-before-after.png): every frame over 150 ms after the land appeared, 3 runs per arm.
- Native recordings, unedited: [before](opening-before.webm), [after](opening-after.webm).
- Ledgers: [timing-before](timing-before.json) / [timing-after](timing-after.json) (3 fresh contexts each, HTTP
  cache off, no recording); [video-before](video-before.json) / [video-after](video-after.json).
- Instruments: [capture-opening.mjs](capture-opening.mjs) (lane S's, plus `profile` / `trace` / `probe` / `hit`
  modes) and [compose-sheet.py](compose-sheet.py).

## Results

| | before | after |
| --- | --- | --- |
| loading notice | top-centre, **drawn over the growth control** | centre of the empty map |
| notice up | 1.6 s → 4.2–4.6 s | 1.6 s → 5.4–5.8 s (until land **and plants** have drawn) |
| frames over 150 ms after the land appears | **15–18 per run** (up to 633 ms) | **0 in every run** |
| long tasks (count / total) | 59–81 / 10.4–11.1 s | 14–24 / 4.5–5.3 s |
| fully grown | 25.4–26.0 s | 26.3–26.7 s |

The native recording of the after arm shows one 167 ms frame at cursor 0.81; recording adds overhead, and
none of the three unrecorded runs has one.

## What the three problems were

1. **The notice collided with the growth control.** Both were placed `top: 10–14px; left: 50%`. The notice
   now sits in the middle of the map. While it is up, the map below is empty by construction (the first
   growth waits for the land), so the middle is the one place with no chrome.
2. **"The notice vanishes before the land arrives" was the plant kit.** The notice did stay up until the
   land's first drawn frame. But the land's first frame is ground at growth 0, which draws nothing, and the
   plant kit loaded straight after it. CPU profile of the 2 s after ready (2 runs): ~450–490 ms colour-sampling
   the kit's leaf textures (`parseKit` → `collectKitLeafMeans` → `texelMeans` / `srgbToLinearUnit`), ~230 ms
   building the plant meshes (`KitProps` → `kitMeshes`), ~105 ms texture upload and ~140 ms shader programs
   on their first draw. So the member saw a blank map at "0%" through ~1 s of frozen frames. The canvas now
   reports `ready` only once the plants it was asked to draw have loaded and been committed, or have failed
   (`ForestWorldCanvas.readiness.ts`). The same second is now spent behind the notice, and the growth starts
   on a responsive screen.
3. **The last fifth played at 3–4 frames a second because of ~2,800 invisible click targets.** A CPU profile
   of the tail showed the main thread mostly outside JavaScript. A Chrome trace of the same span put
   **3.9 s of 5.5 s in Blink's `Layerize`** (compositing the paint result). A/B on the same snapshot: the flat
   map is smooth, and the land without plants is smooth. With plants, the host draws one transparent SVG rect per
   plant as its click target (2,794 on this corpus; 0 at the start, growing as islands appear). A painted
   transparent rect is still a paint chunk, so every repaint of the SVG during growth re-layerised them all.
   They are now `visibility: hidden; pointer-events: all` under an unparked mounted map. That paints nothing
   and stays a hit target. Measured with the same snapshot: `elementFromPoint` over 199 sampled targets
   resolves to the same capability in both arms (16/16 same-capability hits, 8 vs 9 self-hits), and a real
   mouse click on a target selects the same capability.
   ⚠ The rule is scoped to `.tree-route:not([data-parked='true'])`: `pointer-events: all` ignores visibility
   and overrides the parked route's `pointer-events: none`, so without the scope hidden targets on a parked
   map would catch clicks meant for the page on top.

## What stays, and why

- **The ~2 s shore-distance freeze before the land** is the owner's settled call (ADR-0599) and is untouched.
  It is behind the notice.
- **The plant kit's ~1 s load is not made cheaper, only moved.** `texelMeans` could use a 256-entry sRGB
  table (bit-identical values) for ~150 ms. It is behind the notice now and was not worth a second change here.
- **Growth is still wall-clock anchored.** Only the moment `ready` is reported moved; the running cursor
  (ADR-0469) is untouched.
- An experiment that promoted the SVG to its own compositor layer (`will-change: transform`) made the stutter
  **worse** (from 45% of the growth onward). It was reverted and is recorded here so nobody retries it.

## Limits

- `ready` is observed through the mount's `data-canvas` attribute, which is not a hardware present timestamp.
- The OS, GPU shader and server caches are warm across runs; only the browser HTTP cache is disabled.
- Diagnostic CPU profiles and the Chrome trace were taken on an unminified build of the same source, for
  function names. They are not committed (tens of MB); the attribution numbers above are from them.
