# The shore walk's far field is now one array read — and that is worth 14.4%, not 67% — 2026-09-23

`the-single-land-view-ground-build-is-cheap-enough` on `mount-the-land-on-a-real-surface-arc`.

The increment's 2026-09-22 re-measurement (`../land-view-one-build-2026-09-22/`) narrowed this row
to one subject — **one ground build costs ~1.2–1.4 s of `shore-grid.ts`, 25.8–29.1% of the
sized-canvas-to-quiet phase** — and recommended that the next move be **structural rather than
another constant-factor pass**, because that module is already the product of exactly that exercise.

This is that structural move, measured. It landed, it is exact, and **it is much smaller than the
obvious census number suggests.** Both halves of that sentence are the result.

## What was changed

`shore-grid.ts` answered the far field by asking `candidates(x, z)` — a walk over the point's nine
surrounding cells, iterating each one's bucket and writing a dedup stamp per hit — and then
observing that the list came back empty. That is per TEXEL, for every texel in the atlas.

The decision now happens once per CELL, when the grid is built:

- `buildSegmentGrid` precomputes a `nearMask` over its cells **padded by one ring**, marking every
  cell whose own 3x3 neighbourhood holds an edge.
- `EdgeGrid.far(x, z)` resolves the point to one cell and reads one byte.
- `nearestOnSegments` consults `far` FIRST and returns the capped sample without asking for
  candidates at all.

⚠ **The padding ring is the whole difficulty, and a naive mask gets it wrong.** `candidates` does
not clamp: a point whose cell index is `-1` still scans cells `-2, -1, 0`, so cell `0` is visited
and the point CAN have candidates. A mask sized `nx * nz` has no entry for cell `-1`, and treating
"outside the grid" as "far" declares that point far when it is not — which is a MISSED COAST, 255
("far inland") written for water texels just beyond an island's own bounding box, with the beach
missing exactly there. A first prototype of this change had that bug, and the no-op census below is
what caught it: the count moved by 17,283 texels while the change was supposed to be exact.

Both halves landed as signed `--real` verdicts through the Codex leaf, each on its first attempt:
`shore-far-field-is-one-lookup` (the mask) and `shore-walk-short-circuits-through-the-mask` (the
wiring). The second contract exists because the first one's last clause was unfalsifiable — it
asked that the returned sample be UNCHANGED, which is satisfied perfectly by changing nothing, and
the leaf correctly built the mask without putting it on the path. The second states the same intent
as the ABSENCE of a call: `nearestOnSegments` takes its grid as a parameter, so a counting stand-in
over a real grid makes "candidates was never asked" the assertion.

## The measurement

`harness/shore-cost.mjs` — a new node-only instrument over the committed 2026-09-08 real-forest
scene export. It is NOT the verdict instrument: `apps/studio/scripts/measure-land-view.mjs` remains
that, and these numbers are Node's JIT rather than Chrome's and must not be quoted as the studio's.
What this one is for is a RATIO between two arms measured back to back.

⚠ **It is an interleaved A/B in one process, and on this box it had to be.** Three sessions ran
concurrently while this was taken. An untouched stage (the coast clip and occlusion pack) moved
**227 → 312 ms** between two runs of this same file with its own code byte-identical, so a figure
taken before a change and one taken after it are two different machines. Both arms therefore run
the shipped `nearestOnSegments` over the same texels, round-robin; the control is the shipped grid
with `far()` forced to false, which is exactly the pre-change path. Both arms take a spread copy of
the grid so the single call site stays monomorphic — hand one arm the raw grid and the other a copy
and V8 deoptimises the property loads for BOTH, which compresses the delta toward "this bought
nothing".

| | |
|---|---|
| machine | RTX 2060 Linux desktop (CPU only — no GPU is involved in this walk) |
| corpus | `docs/research/chapter2-real-forest-2026-09-08/scenes` — 2,606 parcels, 35 islands |
| atlas | 4025 x 532 over 35 tiles, gres 3 — 1,292,661 texels inside tiles |
| one-minute load average | 0.26 |
| repeats | 7 per arm, interleaved |

| arm | median | spread | samples (ms) |
|---|---|---|---|
| `mask` (shipped) | **357 ms** | 50 ms | 357, 367, 366, 369, 330, 319, 319 |
| `scan` (control) | **417 ms** | 55 ms | 425, 419, 417, 418, 370, 370, 370 |

**The short circuit is worth 60 ms of 417 — 14.4% off the walk**, clearing a 55 ms noise floor by
a margin small enough to be worth saying out loud.

## ⚠ THE FINDING: the census is not the headroom, and it overstates it by half

This is the part worth carrying forward, because the obvious number is the wrong one.

- **67.1%** of the shore atlas's texels **encode to 255** — the exact byte `buildAtlasShore` already
  filled the atlas with before packing a tile. Two thirds of the work writes a value that was
  already there. That is the number that motivated this change.
- **42.6%** are actually **proved far by the mask**.

The gap is 24.5 percentage points of texels that pay the full walk in order to arrive at 255
anyway. A texel reaches 255 whenever its distance reaches the cap; the short circuit fires only
where the 3x3 cell neighbourhood is EMPTY, which is strictly stronger — the grid's cell IS the
query width, so the neighbourhood reaches three widths where the cap reaches one. **Reading a
no-op census as the headroom for a skip is a mistake with a name now: the skip's condition is a
proof, and the proof is conservative.**

## What this does and does not settle

**Banked, and free:** ~14% of the shore walk, with the delivered atlas byte-identical and no
appearance change of any kind. On the studio's own attribution (`shore-grid.ts` at ~1,295 ms) that
is of the order of **180 ms** off a land view a viewer currently waits **12.9 s** for.

**Not banked, and this is the honest conclusion:** the remaining cost is the genuine near-field
walk over ~740,000 texels, and there is no exact way to avoid computing a distance field at three
samples per ground unit along the coast. The module's own structural headroom is now largely spent:

- A **finer grid** would raise the far share toward the 67.1% ceiling (a cell of `width/3` with a
  correspondingly larger precomputed neighbourhood keeps the proof), but the ceiling caps the
  remaining prize at roughly another 10% of the walk.
- **Making the field approximate** is fenced: `shore-grid.ts` is exact by construction and feeds a
  measured colour, so any approximation is an owner question with comparative pictures.

So the increment's recommendation was right that micro-tuning is exhausted — and the measurement
now says the same of the exact structural savings INSIDE the module. The three moves it named that
do not reduce the work at all (**off the main thread**, **incremental**, **cached across loads**)
are what remains, and two of the three change what a viewer sees while the page loads. That is an
owner call, not a session's, and it is authored as an open question on this arc.

## How to reproduce

```
flock /tmp/storytree-heavy.lock \
  env ST_SHORE_REPEATS=7 pnpm --filter @storytree/forest-world-r3f measure-shore-cost
```

Seconds, no GPU, no server, no store. ⚠ Take the lock and read the printed load average: the arms
cancel shared contention in the RATIO but the absolute medians are still the busy box's.

## What this does not establish

The owner's own machine and the ADR-0380 D2 acceptance floor (the Adreno X1-85) remain unmeasured,
and this instrument is Node rather than Chrome. The 14.4% is a ratio on a walk, not a promise about
a page; the studio instrument is what would confirm it end to end, and this session did not re-run
it — a ~180 ms change against a 12.9 s wait is below what two of its arms can separate.
