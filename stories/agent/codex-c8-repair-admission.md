---
id: "codex-c8-repair-admission"
tier: contract
story: agent
capability: live-codex-leaf
arc: verification-integrity-arc
title: "Admit a recorded C8 repair through its named test path"
outcome: "A Codex AUTHOR_TEST slice can promote an observed edit to a named affected allowed test path for one recorded C8 repair, while every ordinary target and promotion wall remains intact."
status: proposed
proof_mode: contract-test
depends_on: []
decisions: [356, 595, 612]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/agent", "test"]
  scope:
    testGlobs: ["packages/agent/src/codex-c8-repair-admission.test.ts"]
    sourceGlobs:
      - "packages/agent/src/phase-author.ts"
      - "packages/agent/src/index.ts"
      - "packages/agent/src/codex-author.ts"
  real:
    testFile: "packages/agent/src/codex-c8-repair-admission.test.ts"
    sourceFile: "packages/agent/src/codex-author.ts"
    scope:
      testGlobs: ["packages/agent/src/codex-c8-repair-admission.test.ts"]
      sourceGlobs:
        - "packages/agent/src/phase-author.ts"
        - "packages/agent/src/index.ts"
        - "packages/agent/src/codex-author.ts"
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
        - "packages/agent/src/codex-c8-repair-admission.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/agent", "typecheck"]
---

# Admit a recorded C8 repair through its named test path

**Outcome —** A Codex AUTHOR_TEST slice can promote an observed edit to a named affected allowed test
path for one recorded C8 repair, while every ordinary target and promotion wall remains intact.

## Proof walkthrough

The focused Node test creates a real temporary workspace whose AUTHOR_TEST manifest has a regular
required proof test and two allowed existing test paths. An injected `CodexRunner` performs the login
protocol, writes only in Codex's disposable replica, and returns a completed JSONL turn; the author then
observes and attempts the real promotion. No paid Codex process runs.

1. With no admission, an `AUTHOR_TEST` edit only to the named affected existing test is refused because
   the required proof target did not change. The same is true for IMPLEMENT, which cannot use this
   exception. A normal AUTHOR_TEST edit to its required proof target still promotes.
2. Call `author("AUTHOR_TEST", prompt, { kind: "c8-existing-test-reason", targets: [affected] })`.
   When `affected` is an exact allowed existing test path and the runner changes that path, the author
   promotes that observed regular-file edit even though the required proof test is unchanged and remains
   a regular file. The real workspace receives only that admitted replica change.
3. The author refuses an empty, non-test, outside-manifest, or wrong-phase supplied admission; it also
   refuses a completed turn that changes nothing or only another allowed path. In each refusal, the real
   workspace remains unchanged. A later call without admission is again strict, proving the context was
   neither retained nor inferred.

The observable is the `AuthorResult` together with the real workspace files after each call. The
`@storytree/agent` typecheck proves the public seam's third argument and barrel export; runtime witnesses
exercise `CodexPhaseAuthor` through its injected runner and its normal replica promotion path.

## Guidance

**Leaf test acceptance (prompt-exposed).** AUTHOR_TEST and IMPLEMENT read this whole file — the
walkthrough and every assertion below — before writing. The identifier in the phase prompt is only an
index to this content.

Author only the three declared source files and the new focused test. `phase-author.ts` publishes a
closed optional repair-context type, named `AuthoringRepairAdmission`, and makes it the optional third
argument of `PhaseAuthor.author`. `index.ts` exports that type beside the existing phase-author types.
The only admitted value is:

```ts
{ kind: "c8-existing-test-reason", targets: readonly string[] }
```

`CodexPhaseAuthor.author` accepts the same optional argument. It is per-call data: do not save it on the
instance, derive it from a prompt, broaden it into a glob, or offer another exception kind. Other
`PhaseAuthor` implementations retain their current behaviour when callers omit the optional argument.

For an AUTHOR_TEST call carrying that exact kind, the named paths may substitute for an observed change
to a required target only after the author validates the complete admission. Every target must be an
exact finite member of the current phase's allowed-test manifest; it must be a test path and be permitted
by the current AUTHOR_TEST write predicate. Invalid input fails closed before promotion. The exception
still requires an observed change to at least one named target. It never makes a no-op, an unrelated
allowed change, a missing/non-regular required proof file, an unlisted or disallowed path, a source or
production-file edit, or an IMPLEMENT call admissible.

Keep the existing replica snapshot, manifest validation, phase predicate, regular-file, staging,
verification, rollback, and promotion rules unchanged. This admission decides only whether the specific
observed C8-repair test change satisfies AUTHOR_TEST's required-change check. It does not observe C8,
write a reason marker, decide a proof outcome, or sign a verdict; the later dependent unit passes the
spine's already-observed C8 record into this typed argument.

## Contracts (3)

1. **`c8-repair-admission-is-structured-and-per-call`** — the public author seam accepts only the
   closed, optional C8 repair admission and does not carry it into another slice.
   - **asserts —** `AuthoringRepairAdmission` is exported through `@storytree/agent`, and a
     `PhaseAuthor.author` call may receive it as its third argument. `CodexPhaseAuthor` accepts it only
     for that invocation: a following call with no admission applies the normal required-target rule,
     while an empty, non-test, outside-manifest, or wrong-phase supplied admission refuses
     without promotion.
   - **covers —** `packages/agent/src/phase-author.ts`, `packages/agent/src/index.ts`, and
     `packages/agent/src/codex-author.ts` (`PhaseAuthor.author` and `CodexPhaseAuthor.author`).
   - **proven by —** the focused temporary-workspace Node proof and the declared agent typecheck.

2. **`recorded-c8-target-can-satisfy-author-test-change`** — one named affected existing test path can
   satisfy AUTHOR_TEST's change admission for the recorded C8 repair.
   - **asserts —** given an exact AUTHOR_TEST manifest containing a regular required proof test and a
     separately allowed affected test, an AUTHOR_TEST call with
     `{ kind: "c8-existing-test-reason", targets: [affected] }` promotes an observed edit to `affected`
     while the unchanged required proof remains a regular file. The same observed edit without that
     admission refuses as a missing required-target change, and an IMPLEMENT call cannot use it.
   - **covers —** `packages/agent/src/codex-author.ts` (`CodexPhaseAuthor`'s manifest-change admission
     and replica promotion).
   - **proven by —** an injected-runner, real-replica witness in
     `packages/agent/src/codex-c8-repair-admission.test.ts` through the declared Node command.

3. **`c8-repair-admission-preserves-promotion-walls`** — the exception cannot turn an arbitrary or
   empty leaf result into a promoted author-test repair.
   - **asserts —** a C8 admission refuses a completed no-op and a change only to an allowed path omitted
     from `targets`; it also refuses a target outside the exact allowed test manifest. Each case leaves
     the real workspace unchanged. The original required proof file must still exist as a regular file,
     and all existing path, phase, staging, verification, rollback, and promotion checks still decide
     every admitted replica change.
   - **covers —** `packages/agent/src/codex-author.ts` (`CodexPhaseAuthor` and
     `promoteReplicaChanges`).
   - **proven by —** the same focused temporary-workspace Node proof, whose controls differ only in the
     admission or the observed replica path.
