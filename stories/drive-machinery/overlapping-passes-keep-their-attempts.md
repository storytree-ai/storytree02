---
id: "overlapping-passes-keep-their-attempts"
tier: contract
story: drive-machinery
capability: work-verdict-event-log
arc: verification-integrity-arc
title: "Credit an overlapping signed pass to its named attempt without losing later failures"
outcome: "The attempt-ledger reader accepts signed passes for overlapping recorded builds by their named run and increment, while its retry count remains the unsigned start-ordered suffix, so a late pass cannot erase a later failure or relax the decision and owner-ceiling boundaries."
status: proposed
proof_mode: contract-test
depends_on: [attempt-count-follows-the-unit]
decisions: [602, 563, 575, 576, 586]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/orchestrator", "test"]
  scope:
    testGlobs: ["packages/orchestrator/src/proof/inner-loop-ledger.test.ts", "packages/orchestrator/src/store/pg-work-store.test.ts"]
    sourceGlobs: ["packages/orchestrator/src/proof/inner-loop-ledger.ts"]
  real:
    testFile: "packages/orchestrator/src/proof/inner-loop-ledger.test.ts"
    sourceFile: "packages/orchestrator/src/proof/inner-loop-ledger.ts"
    scope:
      testGlobs: ["packages/orchestrator/src/proof/inner-loop-ledger.test.ts", "packages/orchestrator/src/store/pg-work-store.test.ts"]
      sourceGlobs: ["packages/orchestrator/src/proof/inner-loop-ledger.ts"]
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
        - "packages/orchestrator/src/proof/inner-loop-ledger.test.ts"
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/orchestrator", "typecheck"]
---

# Credit an overlapping signed pass to its named attempt without losing later failures

**Outcome —** The attempt-ledger reader accepts signed passes for overlapping recorded builds by their
named run and increment, while its retry count remains the unsigned start-ordered suffix, so a late
pass cannot erase a later failure or relax the decision and owner-ceiling boundaries.

## Proof walkthrough

Use the existing `attempt`, `pass`, `grant`, `adjudication` and `stored` helpers in
`packages/orchestrator/src/proof/inner-loop-ledger.test.ts`. Runs `a` and `b` belong to the same unit
and increment unless a case names another increment. The only production file edited is
`packages/orchestrator/src/proof/inner-loop-ledger.ts`; the protocol, event identity, event store and
`inner-loop-exit.ts` are fixed inputs to this repair.

1. **A pass binds the recorded run, not the most recently started run.** Amend the existing test titled
   `pass and adjudication require their own recorded predecessor` without changing that title. Its
   no-predecessor pass and unsigned-adjudication refusals stay. Replace its obsolete latest-started
   refusal with `attempt(a)`, `attempt(b)`, `pass(a)`: the fold succeeds and reports `a` signed and `b`
   unsigned. Append `pass(b)` and it reports both signed. Repeat the two passes as `pass(b)`, then
   `pass(a)`, and it again reports both signed. These are real red cases: the current reader refuses
   the late named pass.
2. **Late completion keeps the later failure.** With `attempt(a)`, `attempt(b)`, `pass(a)`, the ledger
   reports `consecutiveFailures === 1`, `policy.disposition === "proceed"`, and attempts
   `[{ runId: "a", incrementId: "inc", signed: true }, { runId: "b", incrementId: "inc", signed: false }]`.
   The later unsigned `b` is the failed completion in the durable model; there is no failure-event
   family to invent. It must not be followed by a new attempt while `a` is unresolved. Instead append
   `pass(b)` and landing adjudications for both runs, once in `a`-then-`b` order and once in
   `b`-then-`a` order; a fresh `attempt(c)` then succeeds with one consecutive failure. In particular,
   the late adjudication for the older `a` cannot move the fresh policy boundary backward or resurrect
   a pre-landing failure. Repeat the same assertion with `pass(b)`, then late `pass(a)` and its late
   landing adjudication after `b`'s landing adjudication: that latest-`b`, older-`a` completion order
   must likewise leave only fresh `c` in the failure suffix.
3. **The boundaries count the start-ordered unsigned suffix.** Start `a`, then `b` through `g`, and
   only then append the late `pass(a)`. The ledger reports `a` signed, `b` through `g` unsigned,
   `consecutiveFailures === 6`, and the owner-ceiling policy. An ordinary grant on `g` throws the
   existing ceiling error. This is the exact stale-count case: crediting the late named pass may not
   reset the six later failures to zero or make a grant usable. At three such later unsigned attempts,
   the unchanged policy remains `stop-and-decide`; the existing exact-three grant test remains the
   policy's proof rather than a new semantic surface.
4. **A named event still has to exist and belong to its run's increment.** A pass for an unstarted run
   throws `no recorded attempt`; a pass, grant or adjudication whose increment differs from the named
   attempt keeps throwing `filed under increment`. Preserve the existing assertions where they already
   cover these cases; add only the overlap rows needed for a red-to-green assertion.
5. **The fold is a reader.** Deep-clone the canonical overlap records before folding and deep-equal the
   input after each successful fold. Append the same overlap records through `appendInnerLoopEvent` to
   an `InMemoryStore`, read them back, and show `readInnerLoopLedger` deep-equals the direct fold while
   the stored canonical docs and ids remain byte-for-byte the same. Replaying an identical append stays
   the existing idempotent record, with no append, migration, or event kind added.

Before the source change, steps 1–3 refuse at `pass(a)` because `b` was started later. After it, all
five walks pass while steps 2–3 still expose the later unsigned suffix to `decideAttempt`.

## Guidance

**ADR-0602 records the delegated choice.** The owner explicitly declined to adjudicate the reader
repair and directed the team to proceed. Of the three possible moves, this contract takes the narrow
one: credit a signed pass to the validated `runId` and `incrementId` it records. It does not rewrite
history, invent a result event, or prevent future same-unit concurrency; that guard can be a later
increment but cannot repair canonical overlapping records already stored.

`foldInnerLoopLedger` must reconstruct each attempt's signed state from its own named events, then let
the unchanged `decideAttempt` ruler count backward from the latest started attempt until the most
recent signed attempt in that order. A pass for `a` after `b` started changes only `a`; `b` remains in
the unsigned suffix. This preserves both ADR-0563's three-failure recorded decision and the six-failure
owner limit (as carried into paid preflight by ADR-0576), rather than treating event arrival order as a
permission to discard a later build's failure.

**Out of scope.** Do not change canonical event documents or their identity, `InnerLoopEventDoc`, store
or SQL routing, `adjudicateLanding`, `decideAttempt`, or paid-build entry. No same-unit concurrency
guard is part of this repair. The fixed reader must read the existing vegetation history through both
recorded passes; proving that live record is the landing session's post-merge check, not a fixture
substitute.

## Contracts (1)

1. **`overlapping-passes-keep-their-attempts`** — a valid signed pass is credited to its own recorded
   attempt, and late completion cannot erase a later unsigned failure or weaken the retry policy.
   - **asserts —** the existing test titled `pass and adjudication require their own recorded predecessor`
     keeps its predecessor refusals and accepts `a-start, b-start, a-pass`, followed by both pass orders,
     reporting each named run signed. Tests titled `overlapping-passes-keep-their-attempts: ` assert that
     `a-start, b-start, a-pass` leaves `b` unsigned with one consecutive failure; both signed runs can
     be landing-adjudicated in either order before fresh `c` starts a one-failure loop; and a late pass
     for `a` after starts `b` through `g` leaves a six-failure suffix and refuses an ordinary grant.
     They retain unknown-run and wrong-increment refusals, and deep-equal canonical event input and
     replayed `InMemoryStore` records before and after the fold.
   - **guard-rail —** the preserved predecessor, wrong-increment, canonical-identity and idempotent
     replay assertions can pass before the source change because they pin established reader and writer
     boundaries; they use their existing test titles. The added overlap assertion fails at red on the
     current `signed pass must bind the latest attempt` refusal, so it is not an early passing test.
   - **covers —** `foldInnerLoopLedger` and its local reader state in
     `packages/orchestrator/src/proof/inner-loop-ledger.ts`.
   - **proven by —** authored overlap assertions in
     `packages/orchestrator/src/proof/inner-loop-ledger.test.ts`, with any needed existing
     `packages/orchestrator/src/store/pg-work-store.test.ts` replay assertion, through the declared
     focused REAL proof and package typecheck.
