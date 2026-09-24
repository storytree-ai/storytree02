---
id: "duplicate-test-title-change-record-keeps-occurrences"
tier: contract
story: drive-machinery
capability: prove-it-gate
arc: verification-integrity-arc
title: "Record repeated test titles by occurrence"
outcome: "The existing-test change record pairs repeated title paths by their source-order occurrence, so unchanged conditional duplicates do not produce a false C8 finding while real duplicate edits and removals still require a reason."
status: proposed
proof_mode: contract-test
depends_on: []
decisions: [581, 585]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/orchestrator", "test"]
  scope:
    testGlobs: ["packages/orchestrator/src/proof/test-baseline.test.ts"]
    sourceGlobs: ["packages/orchestrator/src/proof/test-baseline.ts"]
  real:
    testFile: "packages/orchestrator/src/proof/test-baseline.test.ts"
    sourceFile: "packages/orchestrator/src/proof/test-baseline.ts"
    scope:
      testGlobs: ["packages/orchestrator/src/proof/test-baseline.test.ts"]
      sourceGlobs: ["packages/orchestrator/src/proof/test-baseline.ts"]
    install: true
    editsExisting: true
    proofCommand:
      file: node
      args:
        - "--import"
        - "./scripts/tsx-cache-off.mjs"
        - "--import"
        - "./packages/orchestrator/node_modules/tsx/dist/loader.mjs"
        - "--test"
        - "packages/orchestrator/src/proof/test-baseline.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/orchestrator", "typecheck"]
---

# Record repeated test titles by occurrence

**Outcome —** The existing-test change record pairs repeated title paths by their source-order
occurrence, so unchanged conditional duplicates do not produce a false C8 finding while real duplicate
edits and removals still require a reason.

## Proof walkthrough

Extend `packages/orchestrator/src/proof/test-baseline.test.ts`'s real-source `declaredTestsOf` helper.
Its input contains two mutually exclusive conditional declarations with the same title path: one
`test(...)`, one `test.skip(...)`, and deliberately distinct source/body hashes. Use that same source
as both before and after.

1. An unchanged pair produces no changes and no C8 findings. This is the exact shape that previously
   collapsed the two paths into one `Map` value and reported the first occurrence as an unexplained
   update.
2. Change only one occurrence's body with no new marker. The record reports exactly that occurrence
   as `updated` with no reason and returns one C8 finding; a same-title sibling remains matched.
3. Remove one occurrence. The record reports exactly one `removed` change with no reason and returns
   one C8 finding; it does not treat the surviving duplicate as proof that both baseline occurrences
   remain.

Before this repair, a pair read from identical source can yield an `updated` C8 because a title-keyed
one-value map keeps only its final occurrence. Afterwards the comparison pairs each baseline occurrence
with the next same-title occurrence in source order. The existing marker tests remain the proof that a
real update/removal with a newly-added, matching reason keeps its established semantics.

## Guidance

Edit only `packages/orchestrator/src/proof/test-baseline.ts` and its existing test file. Preserve the
per-file boundary, source-order output, marker matching, `bodyHash` comparison, and all existing
new-behaviour/refactor/removal semantics. Replace the one-value title map with occurrence-aware pairing
(an ordinal or per-title queue); do not globally deduplicate declarations, skip unchanged files, or
let one duplicate hide an actual sibling edit or removal.

The focused Node proof and orchestrator typecheck are the evidence. `packages/orchestrator` remains
outside the mutation rung's reach, so its expected `NARROWED` result is declared with the signed verdict
rather than replaced by a self-audit.

## Contracts (1)

1. **`duplicate-test-title-change-record-is-occurrence-aware`**
   - **asserts —** `reviewTestChanges` pairs same-title declarations in source-order occurrence, so an
     unchanged conditional `test`/`test.skip` pair yields no change or C8 finding, while changing or
     removing one occurrence still yields exactly that unexplained update/removal and one C8 finding
     until its own valid new marker states the reason.
   - **covers —** `packages/orchestrator/src/proof/test-baseline.ts`.
   - **proven by —** additions to `packages/orchestrator/src/proof/test-baseline.test.ts` through the
     declared focused Node proof and package typecheck.

next:
  - pnpm storytree tree drive-machinery
  - pnpm storytree tree spec prove-it-gate
