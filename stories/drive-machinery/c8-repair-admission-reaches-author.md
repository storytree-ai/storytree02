---
id: "c8-repair-admission-reaches-author"
tier: contract
story: drive-machinery
capability: prove-it-gate
arc: verification-integrity-arc
title: "Pass a C8 repair admission to its authoring slice"
outcome: "The proof gate passes a machine-derived C8 repair admission only to its pending AUTHOR_TEST slice, then re-observes the repaired existing tests under every existing proof rule."
status: proposed
proof_mode: contract-test
depends_on: [codex-c8-repair-admission]
decisions: [582, 585, 590, 612]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/orchestrator", "test"]
  scope:
    testGlobs: ["packages/orchestrator/src/prove-it-gate.test-changes.test.ts"]
    sourceGlobs: ["packages/orchestrator/src/prove-it-gate.ts"]
  real:
    testFile: "packages/orchestrator/src/prove-it-gate.test-changes.test.ts"
    sourceFile: "packages/orchestrator/src/prove-it-gate.ts"
    scope:
      testGlobs: ["packages/orchestrator/src/prove-it-gate.test-changes.test.ts"]
      sourceGlobs: ["packages/orchestrator/src/prove-it-gate.ts"]
    install: true
    editsExisting: true
    proofCommand:
      file: node
      args:
        - "--import"
        - "./scripts/tsx-cache-off.mjs"
        - "--import"
        - "./packages/drive/node_modules/tsx/dist/loader.mjs"
        - "--test"
        - "packages/orchestrator/src/prove-it-gate.test-changes.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/orchestrator", "typecheck"]
---

# Pass a C8 repair admission to its authoring slice

**Outcome —** The proof gate passes a machine-derived C8 repair admission only to its pending
AUTHOR_TEST slice, then re-observes the repaired existing tests under every existing proof rule.

## Proof walkthrough

Use the existing production `proveUnit` harness in `prove-it-gate.test-changes.test.ts`, extending its
recording `PhaseAuthor` to retain the optional third author argument. The scripted `TestChangePolicy`
first returns one or more unexplained existing-test changes plus their C8 findings; after the repair it
returns records carrying reasons. The deterministic test executor returns red for both AUTHOR_TEST
passes and green after IMPLEMENT, so no real process or paid leaf runs.

1. A repair after a C8 existing-test record containing repeated changes in unsorted file order gets one
   AUTHOR_TEST author call with `{ kind: "c8-existing-test-reason", targets }`, where `targets` are
   sorted, unique, workspace-relative paths from the machine record's unexplained existing-test changes.
   The initial AUTHOR_TEST and the later IMPLEMENT call each receive `undefined`. The outcome stays
   dependent on the second record/re-observation, not the admission alone.
2. An initial AUTHOR_TEST, a test-changes repair whose record has no C8 missing-reason targets, and a
   repair for another check all receive no third argument. A following ordinary author call after a C8
   repair also receives none, proving the context was consumed with that repair rather than retained by
   the gate or author.
3. The existing C8 loop remains intact: without a repair policy it refuses with the C8 record; with one,
   the post-repair record is read again and an unresolved C8 finding still refuses or repairs through the
   existing route. A C8 admission never supplies a reason marker, bypasses red/green, or signs a verdict.

The observable is each `PhaseAuthor.author` call's optional third argument and the production
`proveUnit` result. The focused proof drives only injected authors, test-change records, and test
observations. `packages/orchestrator` is outside the mutation rung, so its signed verdict declares the
`NARROWED:` coverage gap rather than treating a self-audit as evidence.

## Guidance

**Leaf test acceptance (prompt-exposed).** AUTHOR_TEST and IMPLEMENT read this whole file — the
walkthrough and every assertion below — before writing. The identifier in the phase prompt is only an
index to this content.

Author only `packages/orchestrator/src/prove-it-gate.ts` and
`packages/orchestrator/src/prove-it-gate.test-changes.test.ts`. Import `AuthoringRepairAdmission` as a
type from `@storytree/agent`; do not add a wrapper, adapter, or alternate Codex path. `proveUnit` already
holds the production `PhaseAuthor` and is the sole dispatch point, so the resolved production
`CodexPhaseAuthor` receives the third argument directly.

When `testChanges.review()` produces a missing-reason C8 repair, derive the context from the machine
`TestChangeRecord`, not its prose brief or a leaf-reported path. Select only existing-test changes that
have no stated reason and correspond to the C8 missing-reason findings being handed to the test writer;
form their exact workspace-relative `file` values into lexical sorted unique `targets`. Carry that value
only with the pending repair, consume it at the next `AUTHOR_TEST` call, and pass `undefined` on every
other author call. Do not add context to IMPLEMENT.

Do not relax any existing repair budget, scope fingerprint, test-change record, proof-file, C8,
outside-test re-observation, or verdict logic. The agent admission validates the supplied context against
the phase manifest; the spine's responsibility here is to pass only the exact machine-derived C8 repair
paths. Keep any small pending-repair metadata local to `prove-it-gate.ts`; no supporting repair type is
needed in `repair.ts` because `CheckFailure` / `PendingRepair` already retain the specific repair being
dispatched.

## Contracts (3)

1. **`c8-repair-paths-reach-the-pending-author-test-slice`** — only a machine-observed C8
   missing-reason repair carries the sorted, unique, exact affected paths into the next AUTHOR_TEST call.
   - **asserts —** `proveUnit` maps the C8 record's affected existing-test file paths to one
     `{ kind: "c8-existing-test-reason", targets }` third argument on the repair's AUTHOR_TEST call;
     target order is lexical and repetitions collapse. The initial call and IMPLEMENT receive no context.
   - **covers —** `packages/orchestrator/src/prove-it-gate.ts` (`testChanges` review, pending repair,
     and AUTHOR_TEST dispatch).
   - **proven by —** a recording `PhaseAuthor` driven through the production `proveUnit` loop in the
     declared focused Node proof.

2. **`c8-repair-admission-is-not-general-repair-context`** — no other phase or repair cause can receive
   C8 admission, and a consumed repair cannot leak it onward.
   - **asserts —** initial authoring, a repair caused by a non-C8 check, and a later authoring slice after
     the C8 repair each receive no admission; a test-change repair that lacks an affected missing-reason
     C8 path also receives none.
   - **covers —** `packages/orchestrator/src/prove-it-gate.ts` (`PendingRepair` lifetime and author
     dispatch).
   - **proven by —** the same recording-author witness, with only the repair record/cause varied.

3. **`c8-repair-admission-leaves-c8-observation-in-force`** — dispatching the admission does not resolve
   the record or bypass its existing checks.
   - **asserts —** after the C8 repair author call, `proveUnit` re-reads the existing-test record and
     follows the current repair/refusal path while findings remain; it reaches IMPLEMENT and a verdict
     only after the existing C8 record is clear and the ordinary red/green and gate checks pass.
   - **covers —** `packages/orchestrator/src/prove-it-gate.ts` (`CONFIRM_RED` test-change review and
     repair loop).
   - **proven by —** the focused production-loop fixture under the declared Node command and orchestrator
     typecheck.
