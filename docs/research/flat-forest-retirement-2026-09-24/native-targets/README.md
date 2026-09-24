# Native plant targets reach the host's own click route (laneO, 2026-09-24)

One of the ADR-0608 D1a pieces: the mounted 3D plants become clickable through the studio map's
EXISTING picking — its SVG, its coordinate hit-test (`elementFromPoint(...).closest('[data-cap-id]')`)
and its capability select. No second picker, no renderer clock, no new camera.

## What was built

- `packages/forest-world-r3f/src/native-prop-targets.ts` — from the canvas's OWN placement list and
  status sidecar, every attributed tree / dead tree / coverage plant as a projected hit envelope
  (the signed `projectNativePropHitEnvelope`), sorted back to front.
- `ForestWorldCanvas` reports them through `onNativePropTargets` only while the props arm is drawn
  and the kit has loaded, and withdraws them (empty list) when it stops. The canvas stays inert.
- `packages/app-surface` renders them as transparent, hittable rects (`g.native-prop-targets`) in the
  world walk AFTER the roads and BEFORE the flora layer — so a crown beats the ground and roads behind
  it, while nameplates, signposts and wisps stay on top. Each rect carries `data-story-id` /
  `data-cap-id` and its own click routes to `onSelectCap`. Stories the regrow has not reached get no
  target (`ForestRegrowRenderLayer.hiddenStoryIds`, the existing growth visibility); legend-hidden
  statuses mark the target `is-filtered`, as they mark a flat plant.
- `TreeView` holds the reported list and hands it to the scene model under `?landMount=1` only.

## Browser proof — actual registered camera, real corpus

`probe.mjs`, run under the heavy lock against a studio served from this worktree at the committed
HEAD (health-verified pid / directory / HEAD, live `pg` store), `?landMount=1&landMountProps=1`,
reduced motion, settled, then nine host wheel steps (zoom 4.65). Receipt: `receipt.json`.

| Question | Result |
| --- | --- |
| Do elevated 3D points (heights 0/5/12/25 over a 5x5 screen grid) land where the host SVG's own transform puts the envelope projection? | max error **0.0002 px** over 100 samples, through the actual three.js camera |
| Near the crown of the 40 tallest visible targets (20% down the box): does a ray from the actual camera strike geometry standing above the ground? | **40 / 40** (2.3–15.1 units above the ground under them) |
| At the same pixels, with the flat plant picture made pointer-inert, does the host hit-test return that capability's target? | **38 / 40**. Both misses: a NEARER plant's box (painted later) covers the farther crown's pixel — the envelopes are boxes, not silhouettes. |
| Same pixels with the flat picture left as it is today (baseline) | 22 / 40 — the invisible flat marks (`veg-track` 10, `parcel-blade` 6) still catch the click. This is the state the one-step retirement removes; it is not a target defect. |
| A real mouse click at one agreed crown pixel | URL `#/tree/library`, selected capability card **library-schema-and-write-validation** — the capability the target named |

Pictures (no appearance change: the targets are transparent, so there is nothing new to stage for the
owner — the outline is a diagnostic):
- `zoom-targets-outlined.png` — the diagnostic pink outline of every target over the real 3D plants.
- `zoom-baseline.png` — the same view with no diagnostic (what a member sees).
- `after-crown-click.png` — after the real crown click; the panel shows the selected capability.

Limits: boxes over-cover silhouettes, so overlapping plants resolve to the nearer box; keyboard
navigation is story-level and unchanged; production-browser performance with ~2,750 extra rects is not
measured here.
