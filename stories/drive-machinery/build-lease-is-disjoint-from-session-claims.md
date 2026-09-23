---
id: "build-lease-is-disjoint-from-session-claims"
tier: contract
story: drive-machinery
capability: build-drive-cli
arc: verification-integrity-arc
title: "Keep a build lease separate from an ordinary session claim"
outcome: "A run-scoped build lease uses a reserved claim key and does not collide with an ordinary session claim for the same logical unit."
status: proposed
proof_mode: contract-test
depends_on: [same-unit-build-lease]
decisions: [607, 200, 535]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/drive", "test"]
  scope:
    testGlobs:
      - "packages/drive/src/build-guard.offline.test.ts"
      - "packages/drive/src/build-guard.test.ts"
    sourceGlobs: ["packages/drive/src/build-guard.ts"]
  real:
    testFile: "packages/drive/src/build-guard.offline.test.ts"
    sourceFile: "packages/drive/src/build-guard.ts"
    scope:
      testGlobs:
        - "packages/drive/src/build-guard.offline.test.ts"
        - "packages/drive/src/build-guard.test.ts"
      sourceGlobs: ["packages/drive/src/build-guard.ts"]
    install: true
    editsExisting: true
    proofCommand:
      file: bun
      args:
        - "test"
        - "--preload"
        - "./scripts/tsx-cache-off.mjs"
        - "./packages/drive/src/build-guard.offline.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/drive", "typecheck"]
---

# Keep a build lease separate from an ordinary session claim

**Outcome —** A run-scoped build lease uses a reserved claim key and does not collide with an
ordinary session claim for the same logical unit.

## Proof walkthrough

The original primitive was signed and promoted at `b178021e`, then a disposable-DB probe exposed a concrete
namespace defect: an ordinary session claim on `vegetation` made
`acquireBuildGuard({ unitIds: ["vegetation"] })` refuse and report the ordinary session as a build
holder. The guard passed the raw logical id to `PgClaimStore`; it did not take ADR-0607 D1's required
reserved `build:vegetation` key. This is a corrective contract over measured production behaviour,
not a new retry increment or an audit of the signed live proof.

Author `packages/drive/src/build-guard.offline.test.ts` as a focused hermetic witness. It uses a small
typed fake limited to the guard's real I/O port — `Pick<PgClaimStore, "claim" | "release" | "current" |
"stampActivity">` — rather than unsafe casts or a live database. The test records the keys and
sessions supplied by the guard.

1. Take an ordinary session claim on the logical unit `vegetation` under a normal session id. Then
   acquire a build guard for `vegetation` under a caller-created `run:<uuid>` id. The build guard
   succeeds, its acquire/current/release operations address `build:vegetation`, its activity stamp
   uses the run session, and the original ordinary `vegetation` row remains present after release.
2. Acquire two run guards for `vegetation`. The first takes `build:vegetation`; the second is refused
   before its callback/spend and identifies the first run. This is the same contention behaviour the
   signed primitive already specified, now observed at the reserved key rather than the raw logical
   id.
3. Keep the original seven behaviours as OFFLINE witnesses in this new file, each test title naming
   its original `same-unit-build-lease` contract id: atomic same-unit refusal, independent units,
   sorted/de-duplicated rollback, stale reclaim, observed-only activity, successor-safe cleanup, and
   `assertHeld` after loss. They exercise the guard's callbacks and error paths without a database so
   the mutation rung executes them. Put each witness's assertions directly in its own test callback;
   fixtures may be helpers, but helper-contained assertions do not bind to the test title in static
   coverage. The original live `build-guard.test.ts` still proves the real Postgres races and remains
   the Node/tsx disposable-DB proof; do not change it to Bun.

Before the source correction the first step collides with the ordinary `vegetation` claim, yielding a
typed conflict whose holder is the normal session. After it, only `build:vegetation` is contended by
run leases. The focused Bun command runs only the hermetic witness and uses no `db:true` arm.

## Guidance

Edit only `packages/drive/src/build-guard.ts`, the new offline witness, and the existing live test
where its fixtures assert the actual key names. The module may narrow its store input to the explicit
`Pick<PgClaimStore, "claim" | "release" | "current" | "stampActivity">` port; that is the honest
surface the guard uses and lets the offline test supply a typed fixture. Do not alter `PgClaimStore`,
the ordinary-session claim protocol, the attempt ledger, entry wiring, or any of the original seven
contract assertions.

Every logical input `unitId` maps to `build:<unitId>` before every unit-keyed claim-store operation:
acquire, holder lookup/`assertHeld`, rollback, and release. `stampActivity` has no unit key; it stays
scoped by the synthetic `build:<runId>` session plus its observed timestamp. The mapping is an
isolation boundary: normal session claims continue to use their raw unit ids, and only run leases
collide with one another. Do not change the two-hour reclaim clock, queue-disabled acquire,
observed-activity rule, or refusal vocabulary.

The prior live test's two known harness corrections are required when its expected reserved keys are
updated: retain the optional database skip on all seven tests, and retain explicit typed input
assignment instead of a conditional empty-object spread. This corrective child is cut from
`b178021e`, so those uncommitted root fixes are not inherited automatically. Reapply them without
changing any live-test assertion except the reserved-key addresses. Rerun that Node/tsx live proof as
validation after the focused offline build; it is not this contract's Bun proof command.

The original contract owns its seven acceptance bars. This contract owns only the namespace regression
and restores the offline observability that lets the existing wrappers reach mutation. The original
contract's `proof.coverage.testGlobs` includes this offline witness for binding; its DB-backed `real`
arm remains unchanged.

## Contracts (1)

1. **`build-lease-key-is-disjoint-from-the-ordinary-session-key`**
   - **asserts —** `acquireBuildGuard` maps `vegetation` to `build:vegetation`, so an ordinary
     `vegetation` session claim remains present while the run lease acquires, contends and releases
     independently.
