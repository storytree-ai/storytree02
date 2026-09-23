---
id: "same-unit-build-lease"
tier: contract
story: drive-machinery
capability: build-drive-cli
arc: verification-integrity-arc
title: "Lease one unit to one running build"
outcome: "A shared-store build lease admits one running build for each unit and refuses a concurrent caller before it can spend."
status: proposed
proof_mode: contract-test
depends_on: [build-entry-refuses-before-spend]
decisions: [200, 535, 576, 602]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/drive", "test"]
  scope:
    testGlobs: ["packages/drive/src/build-guard.test.ts", "packages/drive/src/build-guard.offline.test.ts"]
    sourceGlobs: ["packages/drive/src/build-guard.ts"]
  coverage:
    testGlobs: ["packages/drive/src/build-guard.offline.test.ts"]
  real:
    testFile: "packages/drive/src/build-guard.test.ts"
    sourceFile: "packages/drive/src/build-guard.ts"
    scope:
      testGlobs: ["packages/drive/src/build-guard.test.ts"]
      sourceGlobs: ["packages/drive/src/build-guard.ts"]
    install: true
    db: true
    editsExisting: false
    proofCommand:
      file: node
      args:
        - "--import"
        - "./scripts/tsx-cache-off.mjs"
        - "--import"
        - "./packages/drive/node_modules/tsx/dist/loader.mjs"
        - "--test"
        - "packages/drive/src/build-guard.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/drive", "typecheck"]
---

# Lease one unit to one running build

**Outcome —** A shared-store build lease admits one running build for each unit and refuses a
concurrent caller before it can spend.

## Proof walkthrough

The new `packages/drive/src/build-guard.ts` and its new
`packages/drive/src/build-guard.test.ts` are the whole authored scope. The test creates two separate
`createTestPool()` connections and two `PgClaimStore` instances over the isolated `storytree_test`
database, applies the normal schema, and closes both pools. Separate pools are the cross-machine
model: no assertion may rely on two calls sharing a process, a module singleton, a worktree, or a
local process list.

Runs use caller-created unique ids in the `run:<uuid>` form (represented by stable fixture UUIDs).
They are never derived from `Date.now`, a worktree, a harness, or a process. Every test supplies a recording
callback whose first action represents spend, and a separate attempt-ledger read before and after a
refusal. A real activity reader returns an mtime from authored source/test files, or the caller passes
an observed phase transition; its clock is controlled by the test.

1. **One simultaneous contender wins.** Start two guards together, from the separate pools, for
   `vegetation`. Exactly one acquires `build:vegetation`, enters its callback and records its spend.
   The other returns the typed conflict before its callback is entered. Its rendered reason identifies
   the holder's fixture `run:<uuid>` id, claimed/start age, heartbeat age and `LIVE` classification. The
   attempt ledger is byte-for-byte unchanged by the refusal.
2. **Different units do not serialize.** The same two guards, for `vegetation` and `canopy`, both
   enter their callbacks. The guard is per unit, not a machine-wide build mutex.
3. **A multi-unit attempt has one all-or-nothing admission.** Supplying unsorted duplicate ids sorts
   and de-duplicates them before taking claims. If a later unit collides, every earlier partial lease
   is released with its run-specific session and no callback runs. A second caller can then acquire
   that earlier unit. This proves neither order nor duplicate input can leave a hidden fence.
4. **The existing reclaim clock resolves a corpse.** Backdate `run-a`'s heartbeat beyond
   `CLAIM_STALE_RECLAIM_MS` (two hours), then acquire the same unit from the other pool. `run-b`
   acquires it through the claim store's atomic reclaim path and may spend. A fresh holder instead
   produces the pre-spend conflict in step 1. Store read or write failure is returned as a guard/store
   failure; it is never softened into an available unit.
5. **Only observed activity renews the lease.** Starting the sampling timer with a quiet reader leaves
   `heartbeat_at` unchanged. Advancing the observed source/test worktree mtime and sampling it stamps that
   exact later observation through `PgClaimStore.stampActivity`; a second sample of the same value
   does not renew again. A future observation is refused by the existing store rule. Thus a timer can
   sample evidence but cannot manufacture it, and a wedged build ages into the ordinary reclaim path.
6. **The old holder cannot disturb its successor.** After `run-b` reclaims `run-a`'s stale row, a
   delayed release or activity note from `run-a` leaves `run-b`'s row intact. A fresh observed
   activity stamp for `run-b` keeps its lease non-reclaimable when another contender arrives. An
   ordinary, unnamespaced session claim remains after the build guard releases: normal session/CI
   cleanup cannot delete this run-scoped lease, and guard cleanup cannot delete the ordinary claim.
7. **A lease check protects the next guard-controlled step.** Force ownership to move after a callback
   has begun, then call `assertHeld()` before its next guard-controlled callback step. It reports loss
   with the successor named and that next step does not run. This is an honest boundary check, not a
   claim that a database lease can fence an external operation that was already under way.

Before this unit the module and test do not exist, so the focused command fails to load the test. After
it, the focused command runs the real Postgres races, reclaim and activity stamps against
`storytree_test`; no production attempt, pass, adjudication or grant row is authored by this module.

## Guidance

This is the shared **primitive**. A following unit wires it into `node build`, `story build`, and any
other paid entry. Do not edit those entries, their registry, the attempt policy, or a barrel export in
this unit. The narrow source fence in frontmatter is deliberate.

`PgClaimStore` is the only liveness model. For every caller-provided `unitId`, the guard claims the
reserved unit name `build:<unitId>` with the caller-created unique `run:<uuid>` identity rendered as
synthetic session `build:<runId>` and branch `build-lease:<runId>`. It takes each claim atomically with
queueing disabled; it never reuses a worktree, harness, host, ordinary session identity, or clock value
as a run identity. The claim
store's existing two-hour `CLAIM_STALE_RECLAIM_MS` and reclaim transaction decide whether a holder is
LIVE or RECLAIMABLE. A process-only check cannot substitute for this shared-store read.

Export a small explicit guard API. `acquireBuildGuard` receives the `PgClaimStore`, a caller-created
`runId`, unit ids, and optional `readActivity(): Date | undefined`; it returns either an acquired guard
or a typed refusal. The acquired guard exposes `noteActivity(observedAt)`, `assertHeld()`, and
`release()`. A convenience callback wrapper may own `try/finally` release, but it must preserve the
same result and never invoke its callback on refusal. The caller, not this module, chooses the run id.

Acquire sorted, de-duplicated unit ids. If any acquire refuses, release only the leases already held by
this run and return one refusal naming the collision: unit, holder run id, start age, heartbeat age,
and its LIVE/RECLAIMABLE reading. No refused path writes to the inner-loop attempt ledger or consumes a
retry. Claims that do acquire release in `finally` on callback success or throw. Every release and
renewal predicates on the synthetic run session, so a delayed old owner cannot delete or refresh a
successor.

The optional sampler may run on a modest interval (about a minute), but it may only call
`noteActivity` when `readActivity` returns an observation newer than the last one. It must serialize
overlapping samples. `noteActivity` uses `PgClaimStore.stampActivity([{ sessionId, observedAt }])`, so
the existing monotonic and future-time refusal rules remain authoritative. Do **not** renew from a
timer tick, elapsed time, a callback heartbeat, worktree existence, or a self-reported process state.
Runtime wiring later supplies source/test worktree modification observations or explicit observed phase
boundaries without importing the CLI's ambient watcher into this module. Progress spinner/log output is
not activity evidence: it can advance while a build is wedged.

`assertHeld()` is a before-continuation ownership check for guard-controlled work. If renewal or an
ownership read fails, report that failure and stop the next guard-controlled step; do not pretend the
lease remains held. It cannot revoke an external spend or callback action that started before the
check, so the API and its wording must not promise perfect partition fencing.

## Contracts (7)

1. **`same-unit-claim-is-an-atomic-pre-spend-refusal`**
   - **asserts —** `acquireBuildGuard` admits exactly one callback when two store instances contend
     for one build unit, and leaves the refused attempt ledger untouched.
2. **`distinct-build-units-may-run-together`**
   - **asserts —** `acquireBuildGuard` admits both callers for independent unit namespaces.
3. **`multi-unit-claim-sorts-deduplicates-and-unwinds-partials`**
   - **asserts —** `acquireBuildGuard` leaves no partial guard lease and invokes no callback on a
     collision.
4. **`a-stale-build-lease-is-reclaimed-by-the-existing-clock`**
   - **asserts —** `BuildGuard` replaces a holder past two hours, while a fresh holder yields a named
     conflict or an explicit store failure.
5. **`observed-activity-alone-renews-a-build-lease`**
   - **asserts —** `BuildGuard.noteActivity` leaves quiet sampling unchanged, stamps an advancing mtime
     once, and refuses a future reading.
6. **`run-scoped-cleanup-cannot-release-a-successor-or-an-ordinary-session-claim`**
   - **asserts —** `BuildGuard` makes delayed old release/renewal harmless and normal claim cleanup
     disjoint.
7. **`assert-held-stops-the-next-guard-controlled-step-after-lease-loss`**
   - **asserts —** `BuildGuard.assertHeld()` stops a holder that lost its lease from continuing through
     the guard API, without claiming to fence work already begun.
