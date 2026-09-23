---
id: "uat-machine-proof-binding"
tier: capability
story: library
title: "Per-UAT-leg proof-gate parsing"
outcome: "The Story UAT parser carries each explicit proof-gate annotation into the strict per-leg model without dropping or inventing a binding."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: [106, 180]
# Commit 7f19272 authored this parser pair before the original six-file declaration was audited.
# It is merged before this node is rerun/landed, so this is honestly an edit-existing increment.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/library", "test"]
  scope:
    testGlobs:
      - "packages/library/src/uat-test-criteria.test.ts"
    sourceGlobs:
      - "packages/library/src/uat-test-criteria.ts"
  real:
    testFile: "packages/library/src/uat-test-criteria.test.ts"
    sourceFile: "packages/library/src/uat-test-criteria.ts"
    scope:
      testGlobs:
        - "packages/library/src/uat-test-criteria.test.ts"
      sourceGlobs:
        - "packages/library/src/uat-test-criteria.ts"
    install: true
    editsExisting: true
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/library", "test"]
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/library", "typecheck"]
---

# Per-UAT-leg proof-gate parsing

**Outcome —** The Story UAT parser carries each explicit proof-gate annotation into the strict
per-leg model without dropping or inventing a binding.

**Depends on —** nothing within this story. This is the data boundary consumed by
[`uat-machine-gate-resolution`](uat-machine-gate-resolution.md).

> **Proof status (honest) — authored `proposed`, REAL-proven.** The parser pair was driven through
> the inner loop in runs `real-mrf0hkoh` and `real-mrf0tr8s`; the completed proof commit is
> `c49e179`. The signed verdict, not authored frontmatter, derives proof health (ADR-0020). This node
> still claims only `packages/library/src/uat-test-criteria.{ts,test.ts}`; resolver, command observation,
> signing, and witness-label migration remain separate units. Advisory `check:coverage` still reports
> this contract `0/1` because no test title carries `parses-explicit-uat-proof-gate`; the substantive
> parser assertions pass, but that static contract-name link remains unresolved.

## Proof walkthrough (written first)

Given Story UAT prose containing machine, human, and either legs:

1. parse a leg carrying `_(proof-gate: drive-machinery#gate-2)_`;
2. observe the exact full id on that parsed `UatTestCriterion`;
3. parse a leg with no annotation and observe that the optional field is absent; and
4. present malformed or duplicate proof-gate annotations and observe a parse refusal.

The single observable is the strict parsed UAT model or its explicit parse failure.

## Guidance

Add one optional field to the parsed `UatTestCriterion` model:

```ts
proofGateId?: string;
```

The prose syntax is `_(proof-gate: story-id#gate-n)_`. The parser preserves that full id exactly;
it does not infer a gate from ordering, title, package, or `(covers:)`. Absence remains absence.
Malformed or duplicate annotations fail at this parsing boundary rather than being dropped.
Whether a parsed id names an eligible gate is deliberately outside this increment and belongs to
[`uat-machine-gate-resolution`](uat-machine-gate-resolution.md).

## Integration test

**Goal —** The real Story UAT parser preserves one explicit full proof-gate id in the strict model
and refuses malformed authoring without involving gate resolution or the drive.

## Contracts (1)

1. **`parses-explicit-uat-proof-gate`** — the Story UAT parser carries a full per-leg gate id into the strict UAT model.
   - **asserts —** `_(proof-gate: drive-machinery#gate-2)_` parses as
     `proofGateId: "drive-machinery#gate-2"`; absent stays absent; malformed/duplicate annotations
     are refused rather than dropped or guessed.
   - **covers —** `packages/library/src/uat-test-criteria.ts`.
   - **proven by —** `packages/library/src/uat-test-criteria.test.ts`, the literal REAL pair.

## Follow-up machine-witness authoring

The downstream resolver and adoption units are now REAL-proven, and the separate story-author
migration has added explicit bindings to existing machine legs across six stories. Human legs whose
full live success condition still lacks a standing command remain human; parser success alone never
justifies changing their witness.
