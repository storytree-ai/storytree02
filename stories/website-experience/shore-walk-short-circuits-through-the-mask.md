---
id: "shore-walk-short-circuits-through-the-mask"
tier: contract
story: website-experience
capability: forest-land-surface
arc: mount-the-land-on-a-real-surface-arc
title: "The nearest-on-segments walk reaches its far-field answer without asking for candidates at all"
outcome: "A point the grid's precomputed mask already proves far is answered by `nearestOnSegments` without one call to `candidates` — so the two thirds of an atlas that cannot change a byte stop paying a nine-cell neighbourhood scan each."
status: proposed
proof_mode: contract-test
depends_on: [shore-far-field-is-one-lookup]
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

# The nearest-on-segments walk reaches its far-field answer without asking for candidates at all

**Outcome —** A point the grid's precomputed mask already proves far is answered by
`nearestOnSegments` WITHOUT one call to `candidates` — so the two thirds of an atlas that cannot
change a byte stop paying a nine-cell neighbourhood scan each.

## Why this is a separate contract, and the hole it closes

`shore-far-field-is-one-lookup` gave `EdgeGrid` a precomputed `nearMask` and a `far(x, z)` that
reads it in one array access, and proved that `far` agrees with the neighbourhood walk at more than
a thousand points including the one-cell-outside case a naive mask gets wrong. All of that is
built and signed.

⚠ **What it did NOT do is USE it, and its own spec could not have caught that.** That contract's
last clause asked that `nearestOnSegments` take its short circuit through `far` and return an
UNCHANGED `NearestSample` — and "unchanged" is satisfied perfectly by changing nothing at all. So
the walk still opens with `grid.candidates(x, z)`, the nine-cell scan still runs for every far
texel, and the mask that was built to remove that work is not on the path. The measured win is
therefore still entirely unbanked.

This contract states the same intent in a form that CAN fail: not "the answer is the same" but
"`candidates` is never asked".

## The contract

1. **`nearestOnSegments` consults `far` FIRST.** When `grid.far(x, z)` is true it returns
   `{ distance: cap, gx: 0, gz: 0 }` immediately, without calling `grid.candidates`.

2. **THE ABSENCE OF THE CALL IS THE ASSERTION.** `nearestOnSegments` takes its grid as a parameter,
   so a test can hand it a grid whose `candidates` is a counting or throwing stand-in over a real
   one. A far point must leave that counter at zero. This is the clause the previous contract
   lacked, and it is the whole reason this one exists — an implementation that computes the right
   answer the expensive way must RED here.

3. **A NEAR POINT IS UNAFFECTED.** For a point the mask does not prove far, `candidates` is still
   asked and the walk runs exactly as before. The short circuit is not permitted to swallow a
   near answer.

4. **THE ANSWER IS UNCHANGED EVERYWHERE, AND THAT IS STILL ASSERTED ALONGSIDE.** Over a dense
   lattice covering the grid's bounds expanded by three cells on every side, the `distance` and
   both gradient components agree with a brute-force twin that walks every edge with no grid. The
   field is exact by construction and this must not make it approximate.

   ⚠ Clause 4 alone is what the previous contract had, and on its own it is vacuous — it passes
   whether or not clause 1 was implemented. It is kept because it is the FENCE (the shore field
   feeds a measured colour and may not become an approximation), not because it is the proof.

5. **THE EXISTING SHORT CIRCUIT STAYS.** The `candidates.length === 0` branch inside the walk is
   not deleted. It carries its own `Stryker disable` note explaining that it is equivalent for the
   answer and is a cost decision, and a grid handed in by a caller that does not populate a mask
   must still behave.

## Proof walkthrough

Given a grid built by `buildSegmentGrid` over a hand-written edge set several cells across, with a
known far interior point and a known near point beside an edge:

1. Wrap the grid so `candidates` increments a counter and delegates. Call `nearestOnSegments` at
   the far point and assert the counter is still zero, and that the returned sample is the capped
   distance with a zero gradient.
2. Reset the counter, call at the near point, and assert the counter advanced and the sample is
   the real nearest distance rather than the cap.
3. Sweep the expanded lattice through `nearestOnSegments` against the brute-force twin and assert
   distance and both gradient components agree at every point.

## Fences

- Do not delete or reorder the `Stryker disable` annotations, the counter-free loop style, the
  stamp dedup, the coarsening, the bucket cap or the refusal.
- No timing assertion. The win is measured by `harness/shore-cost.mjs`, which is not a gate rung.
