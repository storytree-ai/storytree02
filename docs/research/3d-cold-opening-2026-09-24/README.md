# The studio's 3D map opens on its first growth

Increment `the-3d-map-opens-on-its-first-growth` (ADR-0608 D1a). Everything here was captured on a **production build**
(`pnpm --filter studio build` + `pnpm --filter studio serve`), on the real RTX 2060. One live API snapshot
(`a871e2759c…`) was held for every run, before and after. The route was `?landMount=1&landMountProps=1&act2=intro`
and the viewport was 1800 × 1100. Every run held `/tmp/storytree-heavy.lock`.

- [Before/after frame sheet](opening-before-after-frame-sheet.png): 8 matched clip times across the whole opening.
- [First seconds, close up](opening-first-seconds-closeup.png): 3 s, 5 s, 6.5 s and 8 s, at half scale.
- Native recordings: [before](opening-before.webm) and [after](opening-after.webm), 30 s each and unedited.
- Ledgers: [timing-before](timing-before.json) and [timing-after](timing-after.json) (3 fresh contexts each, HTTP cache disabled, no
  recording); [video-before](video-before.json) and [video-after](video-after.json) (the recorded runs, including the cursor samples).
- Instruments: [capture-opening.mjs](capture-opening.mjs) and [compose-sheet.py](compose-sheet.py).

## What changed

1. **The first growth waits for the land it grows on** (`TreeView.tsx`). Under the mount, the arrival regrow used to
   start when the flat scene could accrete, about 1.4 s after navigation. The 3D renderer only existed about 2.7 s later.
   The run now starts at the land's first settled status. That is `ready`, or a terminal can't-draw
   (`unsupported` / `failed`). A can't-draw shows its notice and the flat map grows as it always did, rather than
   being held at nothing. Until then the cursor rests at 0, so nothing half-drawn shows, and the loading notice is up.
   **Only the start anchor moved.** Once running, the cursor is the same wall-clock anchor as before (ADR-0469).
   The new jsdom test proves an unwatched gap after the start still catches up. Without the mount flag nothing changes.
2. **"Ready" means the land has drawn a frame** (`afterFirstDrawnFrame`, `LandViewMount.tsx`). R3F's `onCreated`
   fires before the first frame. Ready is now reported two frame callbacks later. On a hidden page no frames arrive,
   so the land reports ready, and the growth starts, when it is first seen.

## Production load, measured (3 fresh contexts per arm)

| | before | after |
| --- | --- | --- |
| "Loading the 3D forest map…" shown | 1.38–1.51 s → 4.20–4.32 s | 1.41–1.61 s → 4.13–4.90 s |
| 3D land ready (first populated render) | **4.06–4.20 s** | **4.12–4.89 s** |
| growth clock first moved | 1.38–1.51 s | 4.16–4.93 s (at land ready) |
| cursor when the land first drew | 3.6–3.8 %, then **14–19 %** once the next second's freezes cleared | 0 %, then **5 %** once they cleared |
| fully grown | 22.5–22.8 s | 25.4–26.2 s |
| long tasks (count / total / largest) | 29–33 / 8.1–8.6 s / 1.85–2.02 s | 31–44 / 8.3–9.6 s / 1.83–2.27 s |

The earlier **18.6 s** figure was a development-server number. In production, first populated render is about **4.1–4.9 s**.
The after arm's first run is the slow one (4.9 s). The other two match the before arm, so the change does not
slow the load. It moves when the growth starts, which also makes the whole opening end ~3 s later.

### What dominates the wait, in order (identical in both arms)

1. **~1.9–2.0 s blocked** starting ~2.1 s, straight after the 3D canvas element appears and before the renderer
   reports ready. It is the largest single task. Its timing and size are consistent with the shore-distance
   measurement plus scene build. That cost is already settled: the owner said to stop optimising it and to
   explore caching someday (ADR-0599, `oq-where-should-the-land-views-frozen-second-go`, answered). This lane
   measures it and decides nothing about it. It now sits inside the loading notice, before the growth starts.
2. **~1.0 s blocked** as two ~500 ms frames immediately after the land's first drawn frame. This is what still eats the
   first ~5 % of the growth after the change, down from 14–19 %. It is not attributed here.
3. **~1.0–1.1 s blocked** at boot (~0.4 s), before anything but chrome shows.
4. **The tail of the growth runs at ~3–4 frames a second.** From cursor 0.81 to settled, 14–15 consecutive frames take
   250–330 ms each: ~4 s of the growth's last fifth, in every run of both arms. It was not in scope and is not
   attributed. It is the most visible roughness left in the opening.

## What the frames show

- **Before, 3 s:** a few stray flat plant specks over empty cream while the 3D code loads. **After, 3 s:** empty cream,
  with the loading notice up (the ledger's `notice` events), and no specks.
- **Before, 5 s:** the first island (`agent`) is already fully formed, with its road climbing off-screen. The land arrived
  part-grown. **After, 5 s:** still empty (the land became ready at ~4.9 s in this recording).
- **After, 6.5 s:** the first island is forming, with its name fading in. **After, 8 s:** it has its road, and the second
  island is starting. This is the start of the growth the before recording never showed.
- **13–27 s:** the same sequence, about 3 s later in the after arm. Both end on the same settled forest.

The recordings are appearance evidence only. Recording adds overhead, so load time comes from the unrecorded timing
runs. **Whether the opening now looks right is the owner's verdict.**

## Limits

- `ready` is the renderer's own report, observed through the mount's `data-canvas` attribute. The first frame after it
  is the earliest a populated frame can have been presented, not a hardware present timestamp.
- The OS cache, the GPU shader cache and the server's warm process are not reset between runs. Only the browser HTTP
  cache is disabled.
- The navigation, occlusion, hidden-quiet and reduced-motion behaviour proofs of PR #2044/#2049 were not re-run as
  browser captures. Their unit and host tests (the wall-clock cursor, park, reduced motion) pass unchanged, and the
  running cursor code is untouched.
