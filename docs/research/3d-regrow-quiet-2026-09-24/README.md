# The 3D regrow settles and stays quiet

The real mounted map and the standalone land view were checked at the same source revision. The [native video](mounted-native-intro.webm) shows the unmodified app clock; the earlier [opening-zoom growth sheet](../3d-regrow-2026-09-24/regrow-frame-sheet.png) and [matched settled controls](../3d-regrow-2026-09-24/regrow-control-comparison.png), landed in PR #2044, show the causal arrival sequence with directly sampled app time.

Both real consumers passed the runtime checks: no WebGL renders during the measured parked, hidden and settled windows; navigation and simulated occlusion return to exactly the same raw canvas, camera and data as a continuously visible control at the corresponding app time. Reduced motion at entry and mid-run matches the settled scene. [Behavior contact sheet](behavior-contact-sheet.png) · [runtime ledger](behavior-measurements.json).

[Play the 23.92-second native recording](mounted-native-intro.webm) or open its [decoded frame sheet](native-video-frame-sheet.png). It includes the real development startup and ordinary camera pullback. The observed app cursor moves from 0.0006 to 0.9795; the excerpt ends just before full settlement, with all 36 islands present. The renderer is first observed ready at 10.886 seconds / cursor 39%, so this clip shows the startup cost as well as growth. Nothing is time-compressed or manually stepped. [Video identity and limits](video-identity.json) · [actual cursor observations](video-cursor-samples.json).

A tiny startup cursor reset, 0.0006 → 0 before the mounted renderer is ready, is preserved in the ledger. Its cause is not inferred here. The film is appearance evidence; recording adds overhead, and its load time is not substituted for the separately measured development load.

## Runtime behavior

The app clock alone is replaced with a directly controlled clock in the browser response; native renderer frames and resize delivery remain live. Both consumers are mounted together for this instrument, so these pictures have a different composition from the ordinary mounted opening view linked above. One fresh live snapshot is held across continuous, navigation, occlusion and reduced-motion cases.

- Navigation returns at 50% and after completion match their continuously visible controls, including exact raw canvas PNG hashes for both consumers.
- Simulated document occlusion returns at the same two times also match. Time advances while the app frame callbacks are withheld; returning catches up to elapsed time.
- Changing content while hidden still produces zero renderer frames; visibility restoration gets the current scene.
- Every parked, hidden, settled and reduced-motion quiet window records zero additional WebGL renderer frames for both consumers over 1.5 seconds.
- Reduced motion at entry and when switched on mid-run immediately produces the same settled canvas, camera and forest data.

This is a behavior proof. Document visibility is an explicit simulated input while Chromium can still paint, so browser frame suspension cannot manufacture a quiet result. It does not measure physical Electron occlusion. The counters cover the two WebGL renderers, not browser-wide painting. Direct clock control proves elapsed-time behavior, not timing or device performance. Complete per-case counters, actual cameras, content hashes and raw canvas hashes remain in the ledger; identical control PNGs are deliberately not duplicated in the committed evidence.

## Actual scene cost

Measured on the real NVIDIA GeForce RTX 2060 through WebGL 2 timer queries. Each row contains seven accepted, non-disjoint batches of ten actual scene renders after warm-up. The batches alternate consumer order. Both consumers retain their ordinary settled opening camera, without fit-view or manual steering; their canvas sizes and product compositions differ, so the rows are descriptive scene costs, not an equal-work A/B.

| Consumer | Canvas pixels | Accepted / attempted | Median GPU ms/render | Full spread ms |
| --- | --- | ---: | ---: | ---: |
| Mounted map | 1800 × 1100 | 7 / 7 | 6.429 | 0.548 |
| Standalone land view | 719 × 1062 | 7 / 7 | 5.483 | 0.445 |

The query is `EXT_disjoint_timer_query_webgl2` / `TIME_ELAPSED_EXT`, with disjoint state checked before, during and after availability polling. Disjoint or unavailable results are rejected; at least three accepted samples and a majority of attempts are required. No CPU submission-time or software-renderer fallback is used. These driver-invoked renders measure GPU work; they are separate from the quiet-frame proof and do not measure app FPS, CPU/compositor work or the Adreno acceptance floor. Recording runs separately.

## Development load observations

| Fresh browser context | First populated renderer observed, then native repaint | App settled observed | API source |
| --- | ---: | ---: | --- |
| Mounted map | 18.596 s | 31.608 s | Acquire live snapshot |
| Standalone land view | 11.860 s | 24.042 s | Replay frozen snapshot |

Both contexts disable the browser HTTP cache. The development server, OS/filesystem caches and GPU driver/shader cache are not reset. The first-populated number is an observation bound followed by native repaint, not an exact hardware first-present timestamp. Settlement includes the actual app intro. These are single development loads, not production promises or a controlled load comparison. Native browser paint and long-task entries are retained in [cost-measurements.json](cost-measurements.json).

The long tasks matter to how this feels: the mounted load/intro recorded 47 long tasks totalling 18.085 s (largest 3.170 s); the standalone recorded 48 totalling 17.817 s (largest 3.066 s). The GPU median therefore cannot stand in for smooth animation. No CPU bottleneck attribution is made from these observations alone.

## Validation scope

The signed rendering-policy leaf, 14 host integration tests and the mounted/standalone runtime proof provide the behavior evidence. The targeted mutation rung exited with declared `SKIP` (exit 3): its source selector in `packages/cli/src/mutation-diff.ts` selects `.ts`, while this increment changes `.tsx` source. That is missing mutation coverage for this change, not a passing mutation result. The parent landing report records the full gate separately.

## Identity and reproduction

All captures use the live PostgreSQL-backed corpus via a single fresh API snapshot per experiment, held for every comparison in that experiment. Raw API snapshots remain private under `/tmp` and are not committed. Native video, runtime proof and GPU measurements are separate experiments; their ledgers record their own snapshot hashes rather than implying one snapshot spans all three.

- Source HEAD: `05a1f22d99ea1d8de9de18ae2ec42c538c4ab17c`.
- Studio / forest source SHA-256 during cost capture: `9a88ed806e2f0e77987d14b6264560aebf3b86b0c3bdbaaf38095a5293d1e786`, unchanged before/after.
- Behavior snapshot SHA-256: `b26fac0f57b5b029f044c3350d72dd2c451b6e3cf26d01db1bab198385d66605`.
- Video snapshot SHA-256: `d35855443af67c8a43313f83f848c93aebaf166ba559c1a491e2fea5b43ab29c`.
- Cost snapshot SHA-256: `94ce467784e3130befe67bac46a836c87b4443be4a53acb954c36bd9a20ff1f1`.
- Browser viewport: 1800 × 1100, device pixel ratio 1; Chromium reported visible throughout accepted samples.
- Actual R3F store/camera, GPU identity, canvas dimensions, sample rejection results, errors and source hashes are retained in the ledgers.

Run the capture scripts from the intended repository root using installed Playwright/Chromium, with `LANEK_URL` pointing to its freshly restarted development server. The scripts reject a wrong worktree, stale source, unavailable database, software renderer or source/HEAD drift. Every browser render and timing run must acquire `/tmp/storytree-heavy.lock`; video and GPU cost must remain separate. `capture-behavior.mjs`, `capture-cost.mjs` and `capture-native-video.mjs` write scratch evidence under `/tmp` by default. `compose-behavior.py` makes the two labelled sheets from accepted screenshots and decoded frames of the unedited video; intermediate video stills stay under `/tmp`.

## Appearance

The owner retains the appearance verdict. The earlier stage shows the arrival sequence clearly; the settled scene retains the same islands and connected roads. Tiny offshore plants in partially grown frames were identified as the existing flat SVG flora, not the 3D meshes. The owner already deferred the known plant collision/floating issues and decided to retire those flat sprites in the mounted-map work; this evidence does not create a new blocker or follow-up.
