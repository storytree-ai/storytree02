# The mounted 3D map says when it is loading, unsupported or failed (laneO, 2026-09-24)

ADR-0608 D5 (owner, verbatim): *"If other browsers can't run because they not using a modern stack
then i'm happy just to show an error message."* No fallback map is built; a silent blank is the one
outcome that is not acceptable.

## What was built

- `apps/studio/src/lib/landViewStatus.ts` — one status for every state the mount can be in: loading,
  ready (say nothing), unsupported (names **a modern browser with WebGL 2**), failed (says why).
  `detectWebGL2` asks once, BEFORE the renderer chunk is fetched.
- `LandViewMount` — an error boundary around the canvas slot (a renderer chunk that fails to load, or a
  WebGL context that cannot be created, becomes a failure message), the up-front WebGL 2 check, the
  canvas's new `onRendererState` (`ready`, or `lost` when the browser takes the context away), and an
  `onStatus` report to the host.
- `LandViewNotice` — rendered by `TreeView` in the map frame, OUTSIDE the `aria-hidden` land layer and
  outside the clickable viewport: loading is a polite `status`, unsupported and failed are an `alert`.

## Real Chromium, real studio, live store (`states.mjs`, `receipt.json`)

| Scenario | How it was produced | What the member gets |
| --- | --- | --- |
| ready (control) | ordinary load | the 3D map, no notice |
| loading | the renderer module held back until released | "Loading the 3D forest map…" (`status`), gone once drawn |
| unsupported | Chromium launched with `--disable-webgl2` (WebGL 1 still present — an older stack) | an `alert` naming WebGL 2; the renderer module is **never requested** |
| before, unsupported (control build without this change, same browser) | same flag | **no message at all** — two `Error creating WebGL context` page errors and a blank land layer |
| renderer fails to load | the renderer module request aborted | an `alert`: "the 3D renderer stopped (Failed to fetch dynamically imported module …)" |
| context lost | after the map drew, the page's own context lost via `WEBGL_lose_context` | an `alert`: "the browser took the graphics context away" |

Every notice was read back as not inside any `aria-hidden` ancestor. Pictures: `after-ready.png`,
`after-loading.png`, `after-unsupported.png`, `before-unsupported.png`, `after-chunk-fails.png`,
`after-context-lost.png`. The flat forest picture is still present in all of them — it retires in one
later step (ADR-0608 D1a). The before/after unsupported pair was taken ~11 s apart in the page's own
load, so some flat flower sprites that arrive with the activity data appear only in the later (before)
frame; that difference is load timing, not this change.
