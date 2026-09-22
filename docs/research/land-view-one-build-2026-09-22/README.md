# Lane 2 re-measured, and one of its two subjects has largely dissolved — 2026-09-22

`the-single-land-view-ground-build-is-cheap-enough` on `mount-the-land-on-a-real-surface-arc`.
That increment's own rule is **measure before you cure**, and this is the measurement. **No cure is
attempted here and none is chosen.**

**Why re-measure at all.** The increment's two figures come from the 2026-09-15 after-arm
(`../land-view-cure-2026-09-15/`). Main has moved since — including, this same night, ADR-0593 D1
raising the land camera from 20° to 50°, which makes every island's ground deeper and so gives
`shore-grid.ts` more coast to grid. A lane that started from the September figures would have been
tuning against a number that had already moved, in a direction this landing caused.

## Where it was taken

Same instrument and same conditions as the 2026-09-15 arm, so the columns are comparable.

| | |
|---|---|
| machine | RTX 2060 Linux desktop — `ANGLE (NVIDIA GeForce RTX 2060/PCIe/SSE2, OpenGL 4.5.0)`, `software=false` (the driver refuses a software rasteriser) |
| build | production, `vite build --sourcemap`, attributed through its own source maps |
| commit | `e6b7ef9c` (main, after #2017 and #2018) |
| corpus | the live store |
| runs | two, each holding `/tmp/storytree-heavy.lock`; one-minute load averages 0.34 and 0.16 |

## The answer

| | 09-15 after | 09-15 after (repeat) | **tonight run 1** | **tonight run 2** |
| --- | --- | --- | --- | --- |
| **`shore-grid.ts`, load (phase B)** | 1,196 ms | 1,107 ms | **1,372 ms** | **1,218 ms** |
| **`shore-grid.ts`, 65 s at rest** | none | none | **none** | **none** |
| land-stream CPU, load (phase B) | 2,538 ms | 2,513 ms | 2,725 ms | 2,420 ms |
| **`ground-dependency.ts`, at rest** | 413 ms | 456 ms | **252 ms** | **250 ms** |
| **worst frame in 65 s at rest, land** | 200 ms | 183 ms | **50.1 ms** | **33.4 ms** |
| a viewer waits, land view | 13.3 s | 13.5 s | 12.9 s | 13.6 s |
| a viewer waits, map alone (control) | 9.7 s | 9.7 s | 9.3 s | 9.1 s |

### ⚠ Subject (2) has largely dissolved, and should not be taken as written

The increment names two subjects and warns that a session folding them together "will measure
neither". Measured separately, they have gone opposite ways.

Subject (2) was: *"the content key is now the largest land-stream cost at rest — `ground-dependency.ts`
at 413 ms and 456 ms … it shows as a 183–200 ms frozen frame about every thirty seconds."*

**Both halves of that are now false.** The digest costs **250 ms** across 65 s (−42%), and the land
view's worst at-rest frame is **33–50 ms** against 183–200 ms — with **5 late frames out of ~3,895**,
none of them a stall a viewer would notice. The thirty-second freeze is gone. Nothing in this session
targeted it; it has come out in other work since 09-15.

⚠ **The 183 ms worst frame has not vanished from the page — it has moved to the MAP-ALONE control**
(183.3 / 183.4 ms, ~195 late frames of ~3,470). Read *when* they came: every one lands at **+0.0 s**,
the window's own first paint, so it is a start-up cost and not a recurring stall. It is the map's,
not the land view's, and it is outside this increment.

### Subject (1) is still live, and it got slightly worse — because of the camera

`shore-grid.ts` remains the single largest module in the load, at **25.8–29.1% of phase B**. It is
**~1,295 ms** on average against ~1,152 ms on 09-15, i.e. **about 12% more**.

That direction is expected and is this same night's doing: ADR-0593 D1 raised the land camera to 50°,
each island's ground is correspondingly deeper, and `shore-grid.ts` grids the coast of that ground.
The increment's "~1.1–1.2 s" should be read as **~1.2–1.4 s** from here.

## What lane 2 should actually be

A recommendation, not a decision — the increment is still the owner's to shape.

1. **Narrow it to subject (1).** Subject (2)'s figures no longer support a unit. If the at-rest digest
   is picked up again it should be re-justified from these numbers, not from September's.
2. **Do not start by micro-optimising `shore-grid.ts`.** It is already the product of exactly that
   exercise — its own header records that the packed shore field cost **49.7 s** before the grid
   existed, over 5.4 M texels. The remaining 1.3 s is what that optimisation left, so the next honest
   move is structural (build it off the main thread, build it incrementally, or cache it across loads),
   not another constant-factor pass.
3. **Mind the fence.** Lane 1's fences are unchanged: preserve the signed appearance and the working
   SVG map. `shore-grid.ts` is exact by construction — its header is explicit that it only decides
   which edges *cannot* be nearest — so any change that makes it approximate trades appearance for
   speed and needs an owner question with comparative pictures, not a judgment call.

## How to reproduce

```
pnpm --filter studio exec vite build --sourcemap
STORYTREE_DB_USER=<iam-email> STORYTREE_STUDIO_DEV_IDENTITY=<your-email> pnpm --filter studio serve
flock /tmp/storytree-heavy.lock \
  env DISPLAY=:0 pnpm --filter studio measure:land-view \
    --url http://127.0.0.1:8080 --output <dir> --arm "<what, where>" --sourcemaps 1
```

⚠ **`DISPLAY=:0` is required on this box** or the driver gets SwiftShader and refuses — correctly,
since a GPU figure off a software rasteriser is worthless. ⚠ **Read the 65-second at-rest window, not
the two six-second ones**: those are anchored to when the page goes quiet, so any change that shortens
the settle moves them to a different page age and they read as a regression that is not one
(`measure-land-view-short-windows-are-anchored-to-settle-not-to-page-age`).

## What this does not establish

The owner's own machine and the ADR-0380 D2 acceptance floor (the Adreno X1-85) are both still
unmeasured. A figure from the RTX box is a floor on the problem, not a description of it.
