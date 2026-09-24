---
id: "paid-build-entry-holds-a-run-lease"
tier: contract
story: drive-machinery
capability: build-drive-cli
arc: verification-integrity-arc
title: "Hold a run lease through paid build entry"
outcome: "A paid node or story build holds its shared run lease from admission through signing or promotion, and renews it only from observed build work."
status: proposed
proof_mode: contract-test
depends_on: [same-unit-build-lease, build-lease-is-disjoint-from-session-claims, codex-replica-observed-activity]
decisions: [200, 535, 576, 607]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/drive", "test"]
  scope:
    testGlobs:
      - "packages/drive/src/build-guard-entry.test.ts"
      - "packages/drive/src/build-activity.test.ts"
      - "packages/drive/src/node-build-names-its-increment.test.ts"
      - "packages/drive/src/node-build-revise-test.test.ts"
      - "packages/drive/src/story-build-revise-test.test.ts"
      - "packages/drive/src/story-real-chain-names-its-increment.test.ts"
      - "packages/drive/src/chain-claims-drive.test.ts"
      - "packages/drive/src/curate.test.ts"
      - "packages/drive/src/story-backstop-forensics.test.ts"
      - "packages/drive/src/leaf-slices-activation.test.ts"
      - "packages/drive/src/real-chain-fixture.ts"
    sourceGlobs:
      - "packages/drive/src/node-build.ts"
      - "packages/drive/src/story-build.ts"
      - "packages/drive/src/build-activity.ts"
      - "packages/drive/src/real-chain-fixture.ts"
  real:
    testFile: "packages/drive/src/build-guard-entry.test.ts"
    sourceFile: "packages/drive/src/node-build.ts"
    scope:
      testGlobs:
        - "packages/drive/src/build-guard-entry.test.ts"
        - "packages/drive/src/build-activity.test.ts"
        - "packages/drive/src/node-build-names-its-increment.test.ts"
        - "packages/drive/src/node-build-revise-test.test.ts"
        - "packages/drive/src/story-build-revise-test.test.ts"
        - "packages/drive/src/story-real-chain-names-its-increment.test.ts"
        - "packages/drive/src/chain-claims-drive.test.ts"
        - "packages/drive/src/curate.test.ts"
        - "packages/drive/src/story-backstop-forensics.test.ts"
        - "packages/drive/src/leaf-slices-activation.test.ts"
        - "packages/drive/src/real-chain-fixture.ts"
      sourceGlobs:
        - "packages/drive/src/node-build.ts"
        - "packages/drive/src/story-build.ts"
        - "packages/drive/src/build-activity.ts"
        - "packages/drive/src/real-chain-fixture.ts"
    install: true
    editsExisting: true
    proofCommand:
      file: bun
      args:
        - "test"
        - "--preload"
        - "./scripts/tsx-cache-off.mjs"
        - "./packages/drive/src/build-guard-entry.test.ts"
        - "./packages/drive/src/build-activity.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/drive", "typecheck"]
---

# Hold a run lease through paid build entry

**Outcome —** A paid node or story build holds its shared run lease from admission through signing or
promotion, and renews it only from observed build work.

## Proof walkthrough

The focused proof drives the existing `nodeBuild` and `storyBuild` REAL entry seams with an injected
`BuildGuardFactory`, recording prompt rendering, worktree creation, attempt writes, phase work,
signature/promotion continuations, release, and pool close. The factory's two guards model separate
callers without opening a live pool. The primitive's dedicated Postgres proof remains the cross-machine
claim-race evidence; this proof establishes that paid entries use it in the right order.

1. **Node admission holds its lease before the authoritative read.** A missing, unknown, or closed
   increment still refuses from cheap increment resolution with no guard factory call. For a live
   increment, the node assigns one Git-safe `real-<uuid>` run id, acquires `build:<node-id>` before
   the authoritative attempt-policy fold, prompts, worktree, leaf, or attempt append, then reads the
   policy while held. A fresh competing holder therefore returns the named guard refusal before any of
   those effects and writes no attempt. A policy refusal after acquisition releases the exact run lease
   and closes its production pool. A policy change that the competing build wrote cannot hide the
   collision, because the collision is checked first.
2. **Story admission has one lease for its whole driven set.** A story resolves its increment cheaply,
   creates one Git-safe `story-real-<uuid>` id, and acquires once over the story id plus every driven
   member id. Its guard receives sorted unique ids and the same run id appears in the story attempt,
   member lifecycle, and promotion naming. The injected per-member `buildNodeReal` sees the already
   held guard rather than acquiring another lease. A conflicting member prevents prompts, worktree,
   member authoring, and every attempt write; distinct story sets remain independently admissible.
3. **Loss stops the next controlled operation.** `RealBuildArgs` receives an awaited guard checkpoint
   whose rejection is outside `withPhaseReport` and runs before attempt append, each AUTHOR_TEST,
   IMPLEMENT, proof and gate continuation, the signing-related continuation, and promotion. A forced
   lost lease lets work already begun finish naturally but rejects the next controlled step, names the
   loss, and releases exactly once. The story invokes the same checkpoint before advancing to its next
   member and before its final signature or promotion. Every return, thrown error, prompt/store/DB
   failure, and worktree failure after acquisition passes through the outer release/factory-close
   cleanup; ordinary borrowed session claims retain their existing lifecycle.
4. **Only build evidence renews a run.** `build-activity.ts` starts from a baseline snapshot of declared
   source/test paths in the actual build worktree plus the actual private Codex replica observations
   supplied by a suitable public agent API. It ignores build logs and dependency links. A later
   source/test mtime or an actual phase boundary produces one newer observation; repeated or quiet
   snapshots do not stamp. Creation or deletion of the private replica during a sample is retried safely
   rather than treated as activity. Samples serialize, stop and are awaited during cleanup. Sampling,
   observer, or store failure reaches the next awaited checkpoint and refuses further controlled work.
   The sampler never writes a heartbeat merely because time passed; the two-hour shared claim clock
   remains the only reclaim rule.

Before this unit a paid entry can evaluate the attempt policy and begin its REAL setup without the
run lease, and its phase reporting is advisory. Afterwards the focused Bun command proves the entry
ordering, loss boundary, cleanup, and observation rules through injected seams. It uses fixture
worktrees and no real paid leaf, shared production pool, or attempt ledger.

## Guidance

This unit wires the already-proven `BuildGuard` into **paid REAL** node and story admission. It does
not change the claim-store protocol, the attempt-policy decision function, ordinary session claims,
CLI/gate-driver preflight, the two-hour stale-reclaim bound, or the primitive's live Postgres races.
The agent package owns private Codex replica layout and provides the actual replica observations through
a suitable public API. Consume that API once its prerequisite has merged; do not expose or reproduce its
private path logic in `packages/drive`.

Split paid preflight in two. First resolve only the cheap increment shape, preserving missing, unknown,
wrong-kind, and closed refusals before a shared lease is attempted. Then create an explicit guard
factory, acquire it, and reread the authoritative attempt ledger while held. An injected factory is
the entire hermetic seam: injected readers, a memory verdict store, or a scripted node builder must
never silently disable or substitute the production guard. Without an injected factory, failure to
open or use the shared claim store is a fail-closed refusal. The factory closes a production pool on
pre-acquire failure; an acquired guard owns release and close, including refusal and exception paths.

Generate a collision-resistant branch-safe run id at the paid entry: `real-<uuid>` for a node and
`story-real-<uuid>` for a story. Reuse exactly that id for the guard's `build:<runId>` session, every
attempt event, and the promotion branch name. A story takes its full sorted, deduplicated logical set
once — its own id and all driven member ids — and passes that one held guard into each member lifecycle.
It must not re-acquire a member guard or replace ordinary session claim/borrow cleanup.

Add an awaited `beforePhase` (or equivalently named) callback to `RealBuildArgs`, used only when
supplied. Run it before advisory `withPhaseReport` work so its failure cannot be swallowed. It checks
the guard before each controlled phase, attempt append, signing continuation, and promotion; story
code checks before each next member and final story signature/promotion. The boundary is honest: it
stops a later controlled operation after a detected lease loss but cannot cancel an external phase
already running.

The activity observer supplies `BuildGuard.noteActivity` only with actual evidence: a phase transition
the caller observed or a strictly advancing mtime among declared authored source/test files. It watches
the real build worktree and consumes actual private-Codex-replica observations from the agent API, so
private Codex editing can keep a valid lease before promotion. Establish an initial baseline; ignore
logs and dependency links; never use process state, worktree existence, spinner output, timer ticks, or
the passage of time as evidence. Serialize sampling; stop and await it during cleanup; surface its
failure at the next guard checkpoint. The observer does not create a second liveness model and does
not reduce the existing two-hour reclaim threshold.

Keep the focused entry proof hermetic. Extend `real-chain-fixture.ts` with an explicit offline guard
fixture for the existing injected-REAL suites listed in this contract's scope, preserving their existing
assertions and updating exact progress-stage arrays only where a newly named legitimate stage changes
them. The new entry test owns ordering, collision, release, and checkpoint assertions; the new activity
test owns only snapshots, evidence monotonicity, replica races, serialization, and cleanup. Do not copy
the primitive's database race tests into this suite.

## Contracts (4)

1. **`node-paid-admission-holds-a-run-lease-before-policy-or-spend`**
   - **asserts —** `nodeBuild` preserves cheap increment refusals, then acquires one `real-<uuid>`
     guard before its authoritative policy read, prompt/worktree/leaf setup, and attempt append; a
     guard conflict invokes none of those effects, records no attempt, and reports the holder, while
     every acquired path releases and closes exactly once.
2. **`story-paid-admission-holds-one-lease-for-story-and-members`**
   - **asserts —** `storyBuild` takes one sorted, de-duplicated `story-real-<uuid>` guard across the
     story and all driven members before its authoritative policy read, reuses it through member builds
     and final promotion, and rejects a member collision before prompts, worktree, authoring, or any
     attempt write.
3. **`lost-build-lease-blocks-the-next-controlled-entry-step`**
   - **asserts —** `RealBuildArgs` invokes its awaited checkpoint before attempt append, every
     controlled phase, signing continuation, and promotion, and `storyBuild` invokes it before member
     continuation and final signature/promotion; a forced loss rejects that next step without claiming
     to stop work already under way.
4. **`paid-build-activity-stamps-only-observed-source-test-or-phase-progress`**
   - **asserts —** `build-activity.ts` baselines and serializes declared real-worktree and
     agent-supplied private-replica source/test observations, stamps only a newer mtime or actual phase
     boundary, ignores quiet/log/dependency observations, handles replica races, awaits cleanup, and
     surfaces observer failure through the next checkpoint.

next:
  - pnpm storytree tree drive-machinery
  - pnpm storytree tree spec same-unit-build-lease
