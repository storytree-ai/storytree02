---
id: "gate-build-holds-a-run-lease"
tier: contract
story: cli
capability: gate-ci-parity
arc: verification-integrity-arc
title: "Hold a run lease through a REAL build-tests gate drive"
outcome: "A REAL build-tests gate drive acquires its shared run lease before its authoritative policy read or spend, carries it through the gate lifecycle, and releases it on every exit."
status: proposed
proof_mode: contract-test
depends_on: [gate-real-build-names-its-increment, same-unit-build-lease, build-lease-is-disjoint-from-session-claims, paid-build-entry-holds-a-run-lease, codex-replica-observed-activity]
decisions: [200, 535, 576, 607]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs:
      - "packages/cli/src/gate-build-run-lease.test.ts"
      - "packages/cli/src/gate-build-driver.test.ts"
      - "packages/cli/src/gate-real-build-names-its-increment.test.ts"
      - "packages/cli/src/gate-build-driver-revise-test.test.ts"
      - "packages/cli/src/gate-build-driver-hold-grace.test.ts"
    sourceGlobs:
      - "packages/cli/src/gate-build-driver.ts"
      - "packages/cli/src/commands.ts"
  real:
    testFile: "packages/cli/src/gate-build-run-lease.test.ts"
    sourceFile: "packages/cli/src/gate-build-driver.ts"
    scope:
      testGlobs:
        - "packages/cli/src/gate-build-run-lease.test.ts"
        - "packages/cli/src/gate-build-driver.test.ts"
        - "packages/cli/src/gate-real-build-names-its-increment.test.ts"
        - "packages/cli/src/gate-build-driver-revise-test.test.ts"
        - "packages/cli/src/gate-build-driver-hold-grace.test.ts"
      sourceGlobs:
        - "packages/cli/src/gate-build-driver.ts"
        - "packages/cli/src/commands.ts"
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
        - "packages/cli/src/gate-build-run-lease.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/cli", "typecheck"]
---

# Hold a run lease through a REAL build-tests gate drive

**Outcome —** A REAL build-tests gate drive acquires its shared run lease before its authoritative
policy read or spend, carries it through the gate lifecycle, and releases it on every exit.

## Proof walkthrough

The focused Node proof drives production `driveBuildTestsGate` with the existing throwaway-git gate
fixture, an active increment, an in-memory ledger/store, and an explicit offline
`buildGuardFactory`. It records acquisition, policy reads, prompt/decision/store/worktree/builder
effects, `RealBuildArgs`, and release. A successful walk uses the existing scripted author; every
pre-spend refusal case supplies BOTH a throwing `authorOverride` and a throwing `realNodeBuilder`
tripwire named `pre-author fallback`. A guard factory alone is not an offline boundary while the old
driver ignores it. Only the success case may use an explicit canned author. No fixture may fall
through to a production leaf or shared guard factory.

1. **A conflicting gate lease refuses before spend.** Preserve cheap build-reference, config, signer,
   revision, and missing-increment refusals. With a valid increment, a factory refusal names the
   holder and occurs before prompt rendering, decision sweep, authoritative ledger fold, DB/store,
   worktree, author, or attempt append. The attempt ledger and retry position remain unchanged.
2. **The policy is read while the lease is held.** Record a successful acquisition before the
   authoritative policy fold. A policy refusal releases that captured guard exactly once; it does not
   open a worktree or invoke the leaf. This intentionally records the shared-store admission order
   rather than the older prompt/sweep-before-policy order.
3. **The gate owns one gate-id lease through cleanup.** A successful drive requests only `gate.id`,
   never its referenced `buildNode`, with one Git-safe `gate-real-<uuid>` run id. It passes that held
   guard through `RealBuildArgs.buildGuard`, reuses the id in attempt/pass records, header, and
   promotion naming, and releases once after success, a worktree failure, a builder failure, or a
   throw. `buildNodeReal` owns its scope-based activity observer and never releases this borrowed
   guard.
4. **Lease loss stops the next controlled step.** Force the held guard's awaited checkpoint to fail
   and show that the following controlled phase, signing, or promotion action does not run. The
   checkpoint remains outside advisory phase reporting; it does not claim to stop work already under
   way.

Before this unit the gate driver can read policy and begin REAL setup without a run lease, so a second
gate build can reach spend. Afterwards the focused proof exercises the public drive guard seam only;
the primitive's shared-Postgres contention/reclaim proof and drive's observed-activity proof remain
their own evidence.

## Guidance

Edit only `packages/cli/src/gate-build-driver.ts`, and the narrow `GateDriverSeams` test injection in
`packages/cli/src/commands.ts`. The latter requires the `unified-command-dispatch` claim alongside
`gate-ci-parity`; it carries no new command behaviour. Add the explicit optional
`buildGuardFactory` seam to `GateBuildDriverDeps`/`GateDriverSeams`. Production omits it and uses
the public `sharedBuildGuardFactory`; hermetic callers always inject it.

For a REAL gate, create `gate-real-<uuid>` and call public `preflightGuardedPaidBuild` with the named
increment, `[gate.id]`, revision state, reads, factory, and captured-guard callback. Cheap refusal
precedence stays intact. After a successful cheap increment resolution, the helper acquires before
the authoritative policy fold. Hold the captured guard in an outer `try`/`finally`, including policy,
prompt, decision, store, worktree, and builder paths. Pass it as `RealBuildArgs.buildGuard` and use
the existing awaited `beforePhase` boundary; neither CLI code nor its fixtures creates an activity
observer, timer, or private replica reader.

Author `packages/cli/src/gate-build-run-lease.test.ts`, then give the four existing direct lifecycle
suites named in this contract's scope an explicit offline guard factory. `gate.test.ts` only stubs the
driver, `node-extend-dispatch.test.ts` reaches only malformed `--hold-grace` refusal, and
`story-baseline.test.ts` only inspects composed dependencies, so none takes this fixture. A missing
`authorOverride` is not an offline escape for the scoped suites: valid-increment policy,
decision-sweep, and injected-DB-refusal cases can reach admission before they stop.

Existing-test edits are limited to `gate-build-driver.test.ts`,
`gate-real-build-names-its-increment.test.ts`, `gate-build-driver-revise-test.test.ts`, and
`gate-build-driver-hold-grace.test.ts`. Each changed fixture carries the new-behaviour/refactor marker
that explains its guard injection. This brief restricts the edits; the resolver otherwise grants the
whole CLI test surface. Do not edit `codex-leaf-prompt.test.ts` or any other unrelated CLI test.

### Attempt record

The increment `prevent-overlapping-builds-of-one-unit` is the authoritative durable record of this
unit's attempt and retry history. The concrete offline-fixture instructions above remain this
contract's source of truth.

## Contracts (4)

1. **`gate-build-lease-refuses-before-policy-or-spend`**
   - **asserts —** a REAL gate preserves its cheap entry refusals, then uses a factory refusal for
     `gate.id` to refuse before prompts, decision sweep, authoritative ledger read, store/worktree,
     author, or attempt append; it names the current holder and leaves retry/attempt state unchanged.
2. **`gate-build-policy-is-read-under-the-held-lease`**
   - **asserts —** after cheap increment resolution, `preflightGuardedPaidBuild` acquires one
     `gate-real-<uuid>` lease before the authoritative policy fold, and a policy refusal releases the
     exact captured guard without continuing to the worktree or leaf.
3. **`gate-build-carries-one-gate-id-lease-through-every-exit`**
   - **asserts —** a successful gate drive requests only its gate id, passes its one held guard through
     `RealBuildArgs.buildGuard`, reuses the run id in lifecycle/ledger/promotion evidence, and releases
     exactly once after success or every later failure; `buildNodeReal` owns activity observation but
     never releases the borrowed guard.
4. **`gate-build-lease-loss-blocks-the-next-controlled-step`**
   - **asserts —** `RealBuildArgs.beforePhase` runs its awaited guard checkpoint outside advisory
     reporting before the next controlled phase, signing, or promotion action, so a forced loss
     prevents that next action while making no false claim about already-started work.

next:
  - pnpm storytree tree cli
  - pnpm storytree tree spec gate-ci-parity
