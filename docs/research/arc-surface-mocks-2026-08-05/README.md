# Arc surface — the 08-02 mock options, re-rendered at 2026-08-05 density

**This is not a new mock round.** The four layout options are byte-for-byte the ones increment 2
delivered in [PR #1087](https://github.com/storytree-ai/storytree02/pull/1087)
(`../arc-surface-mocks-2026-08-02/`). Only the **data** was swapped, plus the prose facts that the
swap would otherwise falsify. Increment 2 is done; re-mocking is explicitly not what this is.

Open [`index.html`](index.html) in a browser — self-contained, no build step, no server, no network.

## Why re-render at all

The 08-02 round validated all four layouts against **17 active / 15 closed** arcs and said outright
that density was a judging criterion: *"a layout that reads beautifully with three invented arcs and
collapses at seventeen real ones would mislead the pick."* Three days later the population had moved
enough that the owner would have been picking against numbers that no longer hold.

| | 2026-08-02 | 2026-08-05 |
| --- | --- | --- |
| Active arcs | 17 | **20** |
| Closed arcs | 15 | **27** |
| Total | 32 | **47** |
| Max increments on one arc | 42 (`grounded-art-machinery-arc`) | **34** (`verification-integrity-arc`) |
| Arcs that never landed anything | 3 | **6** |
| Title length range | 19–72 chars | **18–84 chars** |
| Live open questions | 1 (unhomed) | **0** |

The headline is not the +3 active arcs — it is the **churn**: 10 of today's 20 active arcs did not
exist on 08-02, and 7 of that round's 17 have since closed. Half the board turned over in three days.

## What the swap changed in the page

Data comes from **`GET /api/arcs`** — the increment-1 endpoint against the live Cloud SQL store, so
this doubles as a live check that increment 1's join still serves. Everything else is unchanged
except facts the new data falsifies: the header stats, the two distribution bullets, the drawer
chrome counts, the `blocked` narrative, and the lane-axis label.

Three sections were rewritten on measurement rather than edited for numbers:

1. **The `waiting` state.** The 08-02 finding was that the open-question tier was *unhomed* (one
   question, no `arcRef`). It is now **empty** — `library artifact list open-question --pg` returns
   0 and all 20 arcs come back `waiting: false`. The trajectory is 1 → 0, which makes question 3
   decisive rather than academic.
2. **Parked work is invisible in all four layouts.** ADR-0298 D1's parked entries did not exist in
   the 08-02 extract. Today there are **40 across 12 of the 20 active arcs**. Every layout renders
   "next" as *ready plan / proposed ADR / nothing queued* and so answers "nothing queued" for arcs
   carrying a dozen parked items.
3. **The factory-floor health signal** (`factory-floor-health-signal`, owner-directed 2026-08-04) is
   stated as a requirement on the chosen layout rather than mocked separately.

## The `blocked` candidates at today's data

Recomputed; the page's own predicate and an independent extract agree exactly.

| Candidate | 2026-08-02 | 2026-08-05 |
| --- | --- | --- |
| B1 undecided (a `proposed` ADR on the arc) | 1 | **1** |
| B2 never started (zero increments) | 3 | **6** |
| B3 gone quiet (nothing in >7 days) | 5 | **8** |
| B4 waiting on you | ~5, not derivable | still **not derivable** — needs new authored state |

**B3 now nearly eliminates the `quiet` bucket.** With B3 selected the states go blocked 8 / running 8
/ waiting 3 / quiet **1** — `blocked` and `quiet` become near-synonyms, which they were not at 17
arcs. That is an argument against B3 that only appears at today's density, and it is exactly the kind
of thing the re-render exists to catch.

## Verified, not asserted

Driven in headless Chrome (the preview pane was occluded and will not composite frames):

- All **20** arc titles render in **all four** layouts; no console errors.
- The `blocked` switch re-sorts, and the counts it produces via the page's own `BLOCKED[k].fn`
  match an independently computed extract — B1 = 1, B2 = 6, B3 = 8, same arc ids.
- No stale count strings survive the swap (checked for `17 active`, `15 closed`, `0–42`, `42:0`,
  `seventeen`, and the old open-question claim).
- The page renders identically served over HTTP and opened straight off disk via `file://`.

## Regenerating

`GET http://localhost:5173/api/arcs` with the studio running against the live store
(`pnpm db:up`, then the `studio` launch config), transformed to the mock's `DATA` shape — the
transform keeps the 08-02 extract's prose trim budgets so text length behaves as it did.
