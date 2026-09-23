---
id: "mintbox-protected-driver-transition"
tier: capability
story: mintbox-event-driven-orchestration
title: "Protected rendering-driver transition — observe first, adopt only after green release"
outcome: "The active rendering-engine proof remains untouched until its own green increment boundary releases its claim and terminal event, after which a fresh coordinator may adopt the newly eligible work."
status: proposed
proof_mode: integration-test
depends_on: [mintbox-supervisor-events]
decisions: [604, 505]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/mintbox-event-driven-orchestration", "test"]
  scope:
    testGlobs: ["packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.test.ts"]
    sourceGlobs: ["packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts"]
  real:
    testFile: "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.test.ts"
    sourceFile: "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts"
    scope:
      testGlobs: ["packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.test.ts"]
      sourceGlobs: ["packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts"]
    install: true
    editsExisting: true
    cluster:
      - mintbox-active-proof-is-observe-only
      - mintbox-green-release-is-the-adoption-boundary
    proofCommand:
      file: bun
      args: ["test", "--timeout", "300000", "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.test.ts"]
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/mintbox-event-driven-orchestration", "typecheck"]
---

# Protected rendering-driver transition — observe first, adopt only after green release

**Outcome —** The active rendering-engine proof remains untouched until its own green increment
boundary releases its claim and terminal event, after which a fresh coordinator may adopt the newly
eligible work.

> **Current status —** ADR-0604 supersedes ADR-0561 and drops unattended dispatcher delivery; manual
> lane launch is the current route. This retained legacy component and its walkthrough and contracts
> document existing proof while `mintbox-dispatcher-retirement` awaits the already-decided code and
> story retirement. It authorizes no further paid build and does not claim retirement complete.

## Proof walkthrough first

Start with the protected renderer handle and claim live. Run the supervisor's observation/recovery
pass and verify neither the handle nor claim is changed. Then deliver the proof's terminal green event
and released claim, and verify one fresh coordinator sees the lane as eligible.

## Guidance

Treat claim history as a lifecycle, not the absence of a live row: no matching live claim is not
release evidence. Adoption requires an exact matching released audit event from the public notice-board
history surface for the protected unit and session, also matching `claimedAt` whenever the identity
supplies it. A release for the wrong session or `claimedAt` cannot unlock adoption; whether release
arrives before green or green arrives before release, eligibility begins only after the later required
signal. Reacquisition after release restores the held state until that acquisition is itself released.

## Contracts

1. **`mintbox-active-proof-is-observe-only`** — architecture transition never interrupts proof
   - **asserts —** `packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts` may
     probe the protected renderer handle before a terminal-green event and released claim, but cannot
     stop, restart, re-claim, migrate, or replace it.
2. **`mintbox-green-release-is-the-adoption-boundary`** — eligibility follows the proof's own boundary
   - **asserts —** `packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts` makes
     work eligible only after both a matching terminal-green event and released-claim evidence consumed
     through the public `@storytree/notice-board` boundary; failure remains an event for coordinator
     judgment, not permission to retrofit it.
