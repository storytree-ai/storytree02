---
id: "shore-far-field-is-one-lookup"
tier: contract
story: website-experience
capability: forest-land-surface
arc: mount-the-land-on-a-real-surface-arc
title: "Answer a far-field point from a precomputed cell mask instead of re-scanning its neighbourhood"
outcome: "An edge grid carries a precomputed mask of which cells can hold a near answer, so a point beyond the grid's own width is answered by one array read rather than by a nine-cell neighbourhood scan — and the mask agrees with that scan everywhere, including outside the grid's bounds."
status: proposed
proof_mode: contract-test
decisions: [530]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world-r3f", "test"]
  scope:
    testGlobs: ["packages/forest-world-r3f/src/shore-grid.test.ts"]
    sourceGlobs: ["packages/forest-world-r3f/src/shore-grid.ts"]
  real:
    testFile: "packages/forest-world-r3f/src/shore-grid.test.ts"
    sourceFile: "packages/forest-world-r3f/src/shore-grid.ts"
    scope:
      testGlobs: ["packages/forest-world-r3f/src/shore-grid.test.ts"]
      sourceGlobs: ["packages/forest-world-r3f/src/shore-grid.ts"]
    install: true
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/forest-world-r3f", "test"]
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world-r3f", "typecheck"]
    editsExisting: true
---

# Answer a far-field point from a precomputed cell mask instead of re-scanning its neighbourhood

**Outcome —** An edge grid carries a precomputed mask of which cells can hold a near answer, so a
point beyond the grid's own width is answered by ONE array read rather than by a nine-cell
neighbourhood scan — and the mask agrees with that scan everywhere, including outside the grid's
own bounds.

## Why this is worth a contract

`shore-grid.ts` already proves the far field: `nearestOnSegments` returns the capped distance
without touching an edge whenever a point's 3x3 cell neighbourhood holds no edge
(`edgeGridFarField` states the argument). What it does NOT do is reach that answer cheaply. It asks
`candidates(x, z)`, which walks the nine cells, iterates each one's bucket and writes a dedup stamp
per hit — per texel, for every texel in the atlas.

Measured on the real 35-island forest (`harness/shore-cost.mjs`, the committed 2026-09-08 scene
export): **67.1% of the shore atlas's 1,292,661 texels encode to 255** — the exact byte
`buildAtlasShore` already filled the atlas with before packing a tile. Two thirds of the work
writes a value that was already there, and each one pays a full neighbourhood scan to get it.

So the change is WHERE the far-field decision is made: once per CELL when the grid is built,
instead of once per TEXEL when the grid is asked. The grid has at most `MAX_GRID_BUCKETS` cells and
the atlas has millions of texels, so this is a change of shape and not a constant-factor pass on
the walk.

## The contract

`buildSegmentGrid` computes, at build time, a mask over the grid's cells PADDED BY ONE RING, and
`EdgeGrid` gains a `far(x, z): boolean` that reads it.

1. **`EdgeGrid` carries `far(x, z): boolean`.**

2. **`far` agrees with the scan EVERYWHERE.** For every point `p`, `grid.far(p) === (grid.candidates(p).length === 0)`. This must hold for points inside
   the grid's bounds, for points within one cell OUTSIDE them, and for points many cells outside.

   ⚠ **THE ONE-CELL-OUTSIDE CASE IS THE WHOLE DIFFICULTY AND A NAIVE MASK GETS IT WRONG.**
   `candidates` does NOT clamp: a point whose cell index is `-1` still scans cells `-2, -1, 0`, so
   cell `0` is visited and the point can have candidates. A mask sized `nx * nz` has no entry for
   cell `-1`, and an implementation that treats "outside the grid" as "far" declares that point far
   when it is not. That is a MISSED COAST — the atlas would carry 255, "far inland", for water
   texels just beyond an island's own bounding box, and the beach would be missing exactly there.
   Padding the mask by one ring on every side is what makes the answer total; anything outside the
   PADDED grid is genuinely far, because its 3x3 block contains no real cell at all.

3. **The mask is PRECOMPUTED, not re-derived per query.** `far` may not call `candidates`, may not
   iterate buckets, and may not scan a neighbourhood: it resolves the point to one cell and reads
   one entry. The precomputed mask is a `Uint8Array` of length `(nx + 2) * (nz + 2)` exposed on
   `EdgeGrid` so a test can assert its size and its contents directly rather than only through
   behaviour — a `far` that merely wraps `candidates` would satisfy clause 2 and buy nothing, and
   the size assertion is what refuses it.

4. **`nearestOnSegments` takes the short circuit through `far`.** Its returned `NearestSample` is
   UNCHANGED for every point — same `distance`, same `gx`, same `gz`. The field is exact by
   construction (the module header) and this change must not make it approximate in any way.

5. **The empty-edge-set grid still answers.** A grid built over no edges reports every point far
   and `nearestOnSegments` returns the capped distance with a zero gradient, exactly as today —
   `buildSegmentGrid` deliberately carries no empty-edges guard and must not acquire one.

## Proof walkthrough

Given an edge grid built by `buildSegmentGrid` over a small, hand-written edge set whose extent
spans several cells and leaves an interior region more than one cell from any edge:

1. Sweep a dense lattice of points covering the grid's bounds EXPANDED by three cells on every
   side, and assert at every point that `far` returns exactly `candidates(...).length === 0`. The
   expansion is what exercises clause 2's one-cell-outside case and the genuinely-outside case in
   the same sweep.
2. Assert the exposed mask's length is `(nx + 2) * (nz + 2)`, and that the entry for a cell known
   to be adjacent to an edge is set while the entry for a cell known to be three cells away from
   every edge is clear.
3. Sweep the same lattice through `nearestOnSegments` against a brute-force twin that walks EVERY
   edge with no grid at all, and assert the distance and both gradient components agree.
4. Build a grid over an EMPTY edge set and assert it reports far and answers the capped sample.

## Fences

- **EXACTNESS IS THE FENCE, not speed.** This contract asserts agreement, never a timing. The
  win is measured separately by `harness/shore-cost.mjs`, which is not a gate rung and must not
  become one.
- The module's `Stryker disable` annotations and the counter-free loop style they explain are
  deliberate mutation-rung remedies. Keep them; do not convert the existing neighbourhood scan to
  indexed `for` loops as part of this work.
- Do not change `candidates`, the stamp dedup, the coarsening, the bucket cap or the refusal.
