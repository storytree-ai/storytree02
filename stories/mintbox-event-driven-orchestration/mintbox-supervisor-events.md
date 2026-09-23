---
id: "mintbox-supervisor-events"
tier: capability
story: mintbox-event-driven-orchestration
title: "Deterministic Mintbox supervisor events — deduplicated compact Astra wake-ups and reporting"
outcome: "The Mintbox supervisor owns detached handles and turns each meaningful programme event into at most one fresh compact Astra coordinator launch with bounded digest, recovery, and usage reporting."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: [604, 505]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/mintbox-event-driven-orchestration", "test"]
  scope:
    testGlobs:
      - "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.test.ts"
      - "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.test.ts"
    sourceGlobs:
      - "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.ts"
      - "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts"
  real:
    testFile: "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.test.ts"
    sourceFile: "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.ts"
    scope:
      testGlobs:
        - "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.test.ts"
        - "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.test.ts"
      sourceGlobs:
        - "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.ts"
        - "packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts"
    install: true
    editsExisting: true
    cluster:
      - mintbox-meaningful-events-wake-once
      - mintbox-supervisor-owns-handles-not-transcripts
      - mintbox-three-hour-report-carries-delta
    proofCommand:
      file: bun
      args:
        - test
        - --timeout
        - "300000"
        - packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.test.ts
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/mintbox-event-driven-orchestration", "typecheck"]
---

# Deterministic Mintbox supervisor events — deduplicated compact Astra wake-ups and reporting

**Outcome —** The Mintbox supervisor owns detached handles and turns each meaningful programme event
into at most one fresh compact Astra coordinator launch with bounded digest, recovery, and usage reporting.

> **Current status —** ADR-0604 supersedes ADR-0561 and drops unattended dispatcher delivery; manual
> lane launch is the current route. This retained legacy component and its walkthrough and contracts
> document existing proof while `mintbox-dispatcher-retirement` awaits the already-decided code and
> story retirement. It authorizes no further paid build and does not claim retirement complete.

## Proof walkthrough first

Feed completion, failure, dependency-release, empty-ready-worker, and owner/attestation events through
an injected durable state/handle seam, including replay of the same event and a supervisor restart.
Observe one coordinator per dedupe key, recovery from the persisted handle state, a digest without raw
logs, and the next compact three-hour report.

## Guidance

This is the persisted changed-input reproof for the whole declared three-contract cluster. It restores
one coherent proof of the capability's existing acceptance bar; it does not raise that bar.

- In `packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.test.ts`, author exactly THREE
  NEW static tests in one AUTHOR_TEST slice, one for each cluster member. Their literal titles begin
  exactly `mintbox-meaningful-events-wake-once: `,
  `mintbox-supervisor-owns-handles-not-transcripts: `, and
  `mintbox-three-hour-report-carries-delta: `. Keep all three tests, their test-local helpers, and every
  contract title in this one file; do not move or import tests from the sibling adapter test module.
- For `mintbox-meaningful-events-wake-once`, start from a fresh supervisor state and an otherwise valid
  event. Preserve the compiler's evidence for the complete event shape with
  `const runtimeEvent = { ...event } satisfies Parameters<typeof decideMintboxSupervisorEvent>[1]`,
  then use `Reflect.set(runtimeEvent, "kind", "conversation-message")` so only the runtime value crosses
  the typed boundary. Do not use `as any`, an `unknown` double-cast, a widened `MintboxEventKind`, or a
  loosened production signature. Pass that runtime event to `decideMintboxSupervisorEvent`; assert that
  `wake` is `null` AND that the returned state is deep-equal to the untouched initial state.
- For `mintbox-supervisor-owns-handles-not-transcripts`, send an otherwise valid meaningful event through
  `decideMintboxSupervisorEvent` with this concrete raw multiline summary:
  `"User: MINTBOX-PRIVATE-CONVERSATION-DO-NOT-RETAIN\r\nAssistant: acknowledged\nUser: continue"`.
  Require a wake, serialize its digest with `JSON.stringify`, and assert that the serialization contains
  neither the distinctive `MINTBOX-PRIVATE-CONVERSATION-DO-NOT-RETAIN` phrase nor raw `\r` or `\n`
  characters. In that SAME test, send a distinct otherwise valid event with a normal bounded one-line
  summary such as `"terrain proof passed"`; require a wake and assert that this summary remains available
  in the digest. Dropping every summary is not a valid implementation.
- For `mintbox-three-hour-report-carries-delta`, import the public `readCodexRateLimitSnapshot` and
  `CodexRateLimitSnapshot` type from `@storytree/agent`, and import the existing
  `FileMintboxSupervisorAdapter` plus its runtime types. Define the minimal filesystem fixture and
  recording runtime locally in `mintbox-supervisor.test.ts`; do not reach into
  `mintbox-supervisor-adapter.test.ts`. Call the real public rate-limit reader against an injected fake
  app-server process that answers only the JSONL `initialize` and `account/rateLimits/read` exchange.
  Record its requests and assert that it starts no thread or turn. Do not hand-construct or cast a
  snapshot: every value fed to Mintbox is the typed `CodexRateLimitSnapshot` returned by that reader.
- Keep the reporting test loadable against current HEAD. Obtain the not-yet-built story-owned reporting
  seam with `Reflect.get(supervisor, "recordProgressReport")`, assert at runtime that it is a function,
  and only then invoke it with `Reflect.apply`. Do not directly call a missing typed method, import a
  not-yet-existing report type, or otherwise turn this assertion red into a compile/load failure.
- Drive two available weekly observations, first 32 and then 37 percent, through that smallest
  story-owned seam on `FileMintboxSupervisorAdapter`. Seed the adapter with the complete programme facts,
  an observed worker, and an observed coordinator whose actual health/model/effort are distinguishable
  from requested launch defaults. After the second observation, reopen/recover the adapter and assert its
  persisted compact report carries weekly percent `37`, delta `5`, and that latest coordinator's actual
  health/model/effort—not constants inferred from requested launch flags. The SAME test asserts every
  existing compact field remains present: timestamp, worker health, ready/blocked lanes, last outcome,
  renderer blocker, parallel-session count, and action. Weekly usage and its account-wide delta stay
  report-level facts; neither a lane nor worker entry receives the delta or any attribution of it.
- Obtain a third reader-produced snapshot whose weekly window is typed `unavailable`. Feed it through
  the same seam and assert the returned and persisted observation remains typed unavailable with its
  reason, does not invent a numeric percentage or delta, and does not advance the last numeric baseline
  from `37`.

All three reds are mechanical at current HEAD and must be observed as runtime assertion failures in the
single Bun test file: (1) `decideMintboxSupervisorEvent` accepts the unrecognised runtime kind, appends its
dedupe key, and returns a coordinator wake; (2) `buildMintboxCoordinatorDigest` copies every defined
`event.summary` through `bounded()` regardless of transcript shape, so the distinctive private phrase
survives; and (3) `FileMintboxSupervisorAdapter` has no reporting seam and consumes no public rate-limit
snapshot, while `MintboxProgressReport` accepts only a numeric percentage, omits the latest coordinator
model/effort, and cannot carry typed unavailable usage.

Do not create or edit the launcher, on-box runtime, or live-UAT surfaces owned by later units. That fence
does not freeze any member of this cluster: all three named tests and the supervisor/adapter source needed
to make them green are in scope.

## Contracts

1. **`mintbox-meaningful-events-wake-once`** — only a deduplicated meaningful event creates a coordinator
   - **asserts —** `packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts`
     persists completion, failure, dependency-release, empty-ready-worker, and
     owner/attestation-gate events as exact wake keys before effects, then calls its injected coordinator
     actuator at most once; repeated delivery and restart recovery never request a second live coordinator.
2. **`mintbox-supervisor-owns-handles-not-transcripts`** — liveness survives without conversation history
   - **asserts —** `packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts`
     persists detached handles while
     `packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.ts` reduces only bounded
     programme facts and supplies the coordinator actuator with that digest, never raw conversation logs.
3. **`mintbox-three-hour-report-carries-delta`** — the backstop reports compact operational state
   - **asserts —** `packages/mintbox-event-driven-orchestration/src/mintbox-supervisor-adapter.ts`
     consumes the public turn-free rate-limit snapshot from `@storytree/agent`, and
     `packages/mintbox-event-driven-orchestration/src/mintbox-supervisor.ts` records each compact report
     with coordinator/worker health, actual model/effort, lanes, last outcome, renderer blocker,
     ready/blocked 3D lanes, parallel-session count, weekly percentage, delta, and action without
     attributing an account-wide delta to one lane.
