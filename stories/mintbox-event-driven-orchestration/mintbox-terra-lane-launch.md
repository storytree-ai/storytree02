---
id: "mintbox-terra-lane-launch"
tier: capability
story: mintbox-event-driven-orchestration
title: "Verified Terra lane launch — role policy, claims, and safe Mintbox capacity"
outcome: "A fresh Astra coordinator dispatches sustained Terra lane drivers only into safely claimed lanes, verifies their model/effort and detached handles, and enforces the three-lane and GPU serialisation fences."
status: proposed
proof_mode: integration-test
depends_on: [mintbox-supervisor-events, mintbox-protected-driver-transition]
decisions: [604, 505]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/mintbox-event-driven-orchestration", "test"]
  scope:
    testGlobs: ["packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.test.ts"]
    sourceGlobs: ["packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.ts"]
  real:
    testFile: "packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.test.ts"
    sourceFile: "packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.ts"
    scope:
      testGlobs: ["packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.test.ts"]
      sourceGlobs: ["packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.ts"]
    install: true
    editsExisting: true
    cluster:
      - mintbox-role-model-effort-is-verified
      - mintbox-launch-binds-handle-and-claim
      - mintbox-3d-capacity-and-gpu-serialization-hold
    proofCommand:
      file: bun
      args: ["test", "--timeout", "300000", "packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.test.ts"]
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/mintbox-event-driven-orchestration", "typecheck"]
---

# Verified Terra lane launch — role policy, claims, and safe Mintbox capacity

**Outcome —** A fresh Astra coordinator dispatches sustained Terra lane drivers only into safely
claimed lanes, verifies their model/effort and detached handles, and enforces the three-lane and GPU
serialisation fences.

> **Current status —** ADR-0604 supersedes ADR-0561 and drops unattended dispatcher delivery; manual
> lane launch is the current route. This retained legacy component and its walkthrough and contracts
> document existing proof while `mintbox-dispatcher-retirement` awaits the already-decided code and
> story retirement. It authorizes no further paid build and does not claim retirement complete.

## Proof walkthrough first

Give a fresh coordinator a bounded digest containing four ready disjoint 3D lanes, one GPU-intensive
lane, live claims, and one released renderer lane. Observe its selected launches and persisted decision:
each driver is Terra with a verified handle/claim, at most three 3D lanes run, and GPU work waits for
serialization. Repeat with an architecture-marked decision to confirm only that coordinator can use
xhigh.

Implementation consumes the public pinned Codex invocation seam from `@storytree/agent`, but the
launcher remains the contract-bearing surface.

## Contracts

1. **`mintbox-role-model-effort-is-verified`** — model identity follows the role
   - **asserts —** `packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.ts` records
     routine coordinators as GPT-6 Astra `high`, permits `xhigh` only for an explicitly recorded
     architecture decision, and accepts a sustained lane only after observing GPT-5.6 Terra and its
     configured effort from the process before work starts.
2. **`mintbox-launch-binds-handle-and-claim`** — a launched driver is observable and owns its lane
   - **asserts —** `packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.ts` durably
     records launch intent before spawning in a fresh registered worktree, then persists and verifies the
     detached process handle plus live claim, failing closed rather than declaring a lane occupied when
     process-reported identity, worktree, branch, handle, or claim evidence is absent.
3. **`mintbox-3d-capacity-and-gpu-serialization-hold`** — safe fan-out does not overrun the box
   - **asserts —** `packages/mintbox-event-driven-orchestration/src/mintbox-lane-launcher.ts` dispatches
     at most three safely disjoint 3D lanes and holds a GPU-intensive lane until conflicting GPU work has
     ended, regardless of otherwise independent claims.
