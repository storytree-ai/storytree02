---
id: "build-drive-cli"
tier: capability
story: drive-machinery
title: "The build drive CLI (node build / story build)"
outcome: "An operator drives any registered node or whole story through the gate from one CLI command and gets an honest envelope back."
status: proposed
proof_mode: integration-test
depends_on: [prove-spec-resolution, prove-it-gate, real-build-worktree, story-topo-build, work-verdict-event-log]
# `oq-hygiene-gate` was DROPPED from this list on 2026-08-30. The edge was code-import-evidenced —
# `story-build.ts` imported `oqHygieneGate` and called it live-only before any spend — and that
# import, its call site and the module were deleted when the capability retired (ADR-0477 removed the
# library `references` field the gate's input lived in). `story build` no longer runs an OQ-hygiene
# check on a live build; see oq-hygiene-gate.md for the retirement record.
---

# The build drive CLI (node build / story build)

**Outcome —** An operator drives any registered node or whole story through the gate from one CLI command and gets an honest envelope back.

**Depends on —** [`prove-spec-resolution`](prove-spec-resolution.md), [`prove-it-gate`](prove-it-gate.md), [`real-build-worktree`](real-build-worktree.md), [`story-topo-build`](story-topo-build.md), [`work-verdict-event-log`](work-verdict-event-log.md)

> **Proof status (honest) — `proposed`, with the live arms and the newly specified backstop-recovery arm still unsigned.** The dry-run
> walks (single node AND whole story), the pre-existing mode/refusal branches, and the forged-healthy store
> wall are covered by real, passing, offline suites (`packages/cli/src/node-build.test.ts` +
> `packages/cli/src/story-build.test.ts`, part of `@storytree/cli` 110/110 — I ran them
> 2026-06-13). The pockets, all live-attested but not standing tests: the `--live` SDK smoke
> (Phase D, first signed live pass $0.06), the `--real` worktree build + promotion (Phase F,
> verdict-line run `real-mq7ky4ck`, landed via non-squash PR), the live `story build --live`
> chain (Phase E, library 8/8 signed passes $0.48), and the `--store pg` live persistence leg
> (verified once against the real `events.verdict`). Contract 17 is the repair for a measured REAL
> package-backstop refusal that discarded both the authored ref and its process diagnostics. Its
> unsigned proof is split between fast rendering/preservation helpers, the actual `storyBuild`
> caller regression, and whole-framing tests, named at the contract rather than absorbed into those
> earlier counts.

## Guidance

The operator surface over the whole machinery — two commands, one honest-envelope discipline
(every body ends in an explicit "honest framing" naming exactly what was and was not proven):

- **`node build <id>`** (`packages/drive/src/node-build.ts:754-1096`): pick EXACTLY one of
  `--dry-run` (offline scripted glue walk), `--live` (ADR-0030 SDK smoke over the synthetic pair),
  `--real` (Phase F — fresh worktree, the node's REAL files and proof command, spine commit,
  ADR-0031 promotion behind the pre-signature package typecheck; the package's test suite is the
  landing gate's and CI's, never the build's, ADR-0580 D2). Live/real
  author selection is explicit: the ChatGPT-funded Codex leaf is the omitted-runtime default
  (`gpt-5.6-terra`), while `--runtime claude` selects Claude explicitly (ADR-0555). Before
  any work: a resolvable signer (a verdict must be attributable), the spec file, and — for
  `--real` — the registry's real-proof config and the install⇒typecheck invariant, each a cheap
  fail-closed refusal. `driveNode` (`node-build.ts:461-516`) is the shared single-node walk:
  building mark → resolve → `proveUnit` → cleanup, with the store/runId/signer owned by the
  CALLER — exactly what lets `story build` chain nodes over one event log.
- **`story build <story-id>`** (`packages/drive/src/story-build.ts:320-920`): loads the story + its
  listed capabilities, topo-orders them ([`story-topo-build`](story-topo-build.md)), prechecks
  EVERY node's registry entry before any node runs (and before any spend), then chains `driveNode`
  per node over ONE store and runId. (It ALSO ran the ADR-0037 §5
  [`oq-hygiene-gate`](oq-hygiene-gate.md) live-only at this point, until that capability retired on
  2026-08-30 — ADR-0477 removed the library `references` field the gate's input lived in — and the
  call went with the module. A live `story build` no longer refuses on open-question hygiene.)
  `--runtime` threads through the whole chain; Codex is the omitted-runtime default and refuses
  `--budget` rather than presenting subscription quota as API spend, while explicit Claude may opt
  into a caller-supplied USD ceiling (ADR-0555). The report derives per-node rollups off the one
  shared event log.
- **The verdict store seam** (`resolveVerdictStore`, `node-build.ts:264-328`): in-memory by
  default; `--store pg` swaps in [`work-verdict-event-log`](work-verdict-event-log.md)'s
  `PgWorkStore` over the live tables — and is REFUSED for scripted dry-runs, because persisting a
  synthetic PASS would plant a forged `healthy` in the shared event log (exactly what ADR-0020
  exists to prevent).

- **Original refusal rendering** (`node-build.ts`): when the gate returns a final CONFIRM refusal
  with its spine-owned original observation, the failure envelope renders an `observation:` section
  (`renderFailedConfirmObservation`) directly under the `verdict: NONE — failed closed at <phase>`
  line, which names the phase. The section carries the unit id, run id, exit code, stdout, and stderr;
  it names no test id, a declared gap of its signed build (PR #1910). Rendering consumes the result
  already returned by the gate: it runs no command and does
  not alter the refusal, evidence, signing, promotion, cleanup, leaf feedback, or stored work
  history. Passes and failures without an eligible command observation retain their current envelope;
  the REAL typecheck backstop remains a separately shaped diagnostic path described
  below rather than masquerading as a CONFIRM observation.

- **Pre-signature backstop recovery** (`backstop-report.ts`, `backstop-preservation.ts`,
  `buildNodeReal` / `nodeBuild`): after the spine commits the
  authored scope, a RED package typecheck still refuses at GATE and writes no
  signing row. (Since ADR-0582 that red is first handed back to whoever owns the files its diagnostics
  name, so this arm is reached only when the walk ENDED at GATE on it — the repair bullet below owns
  that condition.) Before the detached worktree is removed, that already-committed authored HEAD is
  parked with `purpose: "unsigned-forensics"` at
  `claude/real-forensics/<unit-id>-<run-id>` with push withheld. The signed promotion/proven-prefix
  namespace remains `claude/real/*`, so both refs may coexist for the same run without one replacing
  the other. The returned result and CLI envelope call the forensic ref **unsigned preservation**,
  never promotion: it is local-only, is not a landing candidate, and proves nothing. The same refusal envelope names which backstop command was
  red and renders its exit code plus stdout/stderr capped at 4,000 characters per stream, retaining
  both head and tail with a visible truncation marker instead of an unbounded package log. A `null`
  exit is rendered as no numeric exit (killed or timed out) beside
  the command's effective timeout, rather than being flattened into the same diagnosis as an
  assertion failure. This arm requires the backstop observation and a committed authored head that
  differs from the cut; signer, tree-state, other GATE, and pre-commit refusals create no forensic
  ref. Rendering consumes the observation already taken by the backstop, executes no diagnostic
  re-run, and does not change ADR-0104's timeout scope.

- **Escalation rendering** (contract
  [`node-build-escalation-envelope`](node-build-escalation-envelope.md), signed PASS run
  `real-mu1ms77f`; ADR-0569 D5): when the gate returns an authoring escalation (contract
  `gate-routes-authoring-escalation`), `nodeBuild` renders it through the same-file
  `renderEscalation` directly under the `verdict:` line, ahead of the
  observation section. The block names the raising phase and what it claims, with the unit, run and
  test id; the statement, and IMPLEMENT's assertion, verbatim; for an AUTHOR_TEST escalation, the
  single observation the spine took for it, labelled as not a CONFIRM run; and the orchestrator's two
  options under ADR-0563: re-delegate a test revision (one D4 attempt, a `revised-test` difference) or
  escalate to the owner. An overruled escalation renders one line on the envelope it rode through, and
  a result with no escalation renders nothing. Rendering runs no command. Only `node build` renders
  the block: `story build` and the gate build driver print the refusal reason alone.

- **In-build repair rendering** (contract 18,
  `node-build-envelope-lists-every-repair`; ADR-0581 D4 / ADR-0582; `renderRepairs` and
  `buildNodeReal` in `packages/drive/src/node-build.ts`): a REAL build repairs a failed check inside the
  build ([`prove-it-gate`](prove-it-gate.md)), so the drive carries three consequences and nothing more.
  The typecheck backstop returns its RAW output beside the bounded rendered reason, because the gate
  routes the red by the files its diagnostics name. What the build REPORTS about that typecheck, and the
  refused commit it keeps, are the LAST GATE's: both are cleared as each GATE begins and discarded when
  the walk ended anywhere but GATE, so a red the build was repaired past is never reported as why it
  ended and preserves nothing. And `renderRepairs` prints a `repairs:` block on both the pass and the
  failure envelope — one line per repair naming where the check failed, which check, which worker it went
  back to and what failed, under a header saying a repair is not an attempt — and `[]` when the walk made
  none, so an envelope without repairs reads exactly as it always has. A pure reader of
  `ProveResult.repairs`: it runs no command and changes no verdict.

- **Test revision** (proposed, ADR-0571; contracts
  [`revision-record-round-trip`](revision-record-round-trip.md),
  [`build-node-real-threads-revision`](build-node-real-threads-revision.md) and
  [`node-build-revise-test`](node-build-revise-test.md)).
  - **The record.** When a REAL node build fails with an escalation the gate returned, `buildNodeReal`
    writes a per-user record, `~/.storytree/escalations/<unit-id>/<run-id>.json`, holding the unit and
    run ids, the escalation record, and any `failedObservation`. It writes only when its caller
    supplies a directory: `node build` does, and `story build` and the gate build driver do not. A
    write failure never fails the build.
  - **The envelope.** The failure envelope names the record, together with the re-run command
    `storytree node build <id> --real --runtime <runtime> --increment <increment-id> --revise-test <run-id>`.
    If the record was not written, it says so and why.
  - **The re-run.** `node build --real --revise-test <run-id>` reads that record before the leaf
    prompts, the DB preflight, the claim or the worktree. It refuses the flag without `--real`, a
    run id that is not a single path segment, a missing record, and a record that does not describe
    a returned escalation for this unit and this run. It then
    hands the revision to `buildNodeReal`, which briefs only the AUTHOR_TEST leaf with it (contract
    [`real-brief-carries-test-revision`](real-brief-carries-test-revision.md)). The header names the
    run being revised.
  - **What it does not do.** It records no grant: that stays the orchestrator's call (ADR-0571 D5).
    Since ADR-0576 D6 a revision run IS a paid entry like any other, so it takes `--increment`,
    passes the attempt preflight and records an attempt (below).

- **The paid REAL entry: an increment and the attempt ledger before spend** (proposed, ADR-0575 D1
  and ADR-0576; contracts [`build-entry-refuses-before-spend`](build-entry-refuses-before-spend.md),
  [`real-lifecycle-records-its-attempt`](real-lifecycle-records-its-attempt.md),
  [`node-build-names-its-increment`](node-build-names-its-increment.md),
  [`orchestrator-records-its-calls`](orchestrator-records-its-calls.md) and
  [`node-verbs-dispatch`](node-verbs-dispatch.md)). ADR-0577 triggers, and ADR-0578 defines, the
  explicitly deferred above-ceiling mechanism in
  [`owner-grant-carries-settled-authority`](owner-grant-carries-settled-authority.md): a distinct
  owner-grant event carries its settled question and deciding ADR, is spendable once across the
  ledger, and admits only its recorded allowance while ordinary grants keep the ceiling unchanged.
  - **The refusal.** `node build --real` requires `--increment <id>`, and `--dry-run` and `--live`
    refuse the flag. After every existing cheap refusal and before the leaf prompts, the database,
    the claim and the worktree, `preflightPaidBuild` (`node-build.ts`, over `inner-loop-entry.ts`)
    refuses a missing, unknown, wrong-kind or closed increment, and a unit the attempt ledger stops:
    at the decision point with no live grant, at the ceiling, holding an unresolved signed pass,
    rebuilt under an increment that already landed it, or run against a live grant of the other kind
    (`--revise-test` pairs only with a `revised-test` grant). An unreadable corpus or ledger refuses,
    quoting the error.
  - **The record.** `buildNodeReal` appends one attempt immediately before the gate walk, and a failed
    append refuses the walk; it appends one signed pass after a signed result, and a failed append is
    reported rather than swallowed. With no increment id it records nothing.
  - **The envelopes.** Every refusal and outcome renders through the one entry state
    (`renderInnerLoopEntryState`), and every `--real` command the CLI prints carries `--increment`.
  - **The orchestrator's calls.** `storytree node attempts|grant|adjudicate <id> --pg`
    (`packages/cli/src/inner-loop-verbs.ts`, dispatched from `commands.ts`) read the unit's fold and
    record a grant or a landing adjudication. A build never records either.
  - **The owner's exceptional call.** `storytree node owner-grant <id> --authority <question-id>
    --attempts <n> --kind <kind> --difference <text|@file> --pg` records a distinct owner grant only
    when the question is settled by an accepted owner-backed ADR and the question, decision, and
    failed attempt's increment share one arc. Its exact allowance is consumed by the same preflight;
    the question cannot be replayed for this or another unit, and the ordinary `node grant` ceiling
    is unchanged.

- **The LIVENESS channel** (`packages/drive/src/build-progress.ts`, wired at every leg of
  `nodeBuild`, `storyBuild` AND `packages/cli/src/gate-build-driver.ts` — all THREE `--real` entry
  points, deliberately, because wiring two would leave the class open at the next one, which is the
  pattern that chartered the arc): a `--live`/`--real` run names the leg holding its clock on STDERR
  (`[build] <leg> - started` / `- still running, Ns elapsed` / `- done in Ns`), and feeds the gate's
  red-green phase walk in as a sub-label so the longest leg reports the PHASE it is in. A chain adds
  `node i/N: <id>`, which is what distinguishes a chain on its seventh node from one wedged on its
  first. The envelope keeps STDOUT; only chatter goes to STDERR, so `> log 2>&1` interleaves both
  while a piped report stays parseable. `--dry-run` is silent (seconds, offline).

  Why it is a capability concern and not a nicety: measured 2026-08-04, a backgrounded `--real`
  build emitted exactly 4 lines (the pnpm banner) for several minutes and then the whole 50-line
  report — and a wedged, then-unbounded DB preflight looked IDENTICAL from that log, while the
  correct responses to the two are opposite (wait out a cold start, intervene on a wedge). The
  friction is `a-real-build-emits-no-progress-until-it-finishes`; the arc is
  `diagnosis-honesty-arc`, whose charter is that a command names its real blocker rather than a
  downstream symptom. The preflight's own half of the same fix — bounding every external wait, and
  naming each of ITS legs — is [`live-build-db-preflight`](live-build-db-preflight.md) contracts
  14-16. Both observers are ADVISORY and composed by `withPhaseReport`
  (`packages/drive/src/phase-activity.ts`), with the liveness REPORT ahead of the wisp WRITE: a slow
  or dead store must not be able to delay or swallow the one signal saying where the build is.

Code edges for the `depends_on`: `node-build.ts:11-25` (the resolver/gate/worktree surface:
`resolveProveSpec`, `proveUnit`, `createBuildWorktree`, `promoteRealPass`,
`runWorktreeTypecheck`, `loadNodeSpec`, `findNodeSpecFile`, registry lookups);
`story-build.ts:20-22` (`runStoryBuild`, `topoOrderStoryNodes`); `node-build.ts:23-27`
(`workEvent`, `rollupStatus`, `verdictLine`) and `:49`
(`PgWorkStore`). **Cross-story (the story-level `library` edge):** `node-build.ts:44-49` also pulls
`createPool`/`closePool`/`applySchema` — the library story's store-connection seam. The
live-author imports are type-only — the consumed executor seam's reporting surface. When selected,
Claude reports advisory API-list-price accounting; Codex reports turns/tokens without pretending
that list price is real subscription spend. In both cases the leaf's feedback is untrusted and the
spine's out-of-band proof commands remain the sole red/green/verdict authority.

## Integration test

**Goal —** The full drive offline, both grains, against real in-story collaborators: `node build
verdict-line --dry-run` walks the REAL registered-buildable spec through the gate and reports
trail + verdict + rollup (`packages/cli/src/node-build.test.ts:17`, `:74`), and `story build
library --dry-run` chains every real library node topo-ordered, story last, all signed, over one
event log (`packages/cli/src/story-build.test.ts:17`).

## Contracts (18)

1. **`dry-run-walks-and-reports-honestly`** — the envelope carries the phase trail, the verdict line, the derived rollup, and the honest framing
   - **asserts —** trail `AUTHOR_TEST → … → GATE`, a signed verdict, rollup derived from the event log, the dry-run framing.
   - **covers —** `packages/drive/src/node-build.ts:1003-1092`
   - **proven by —** `packages/cli/src/node-build.test.ts:17` (REAL, passing)
2. **`exactly-one-mode`** — no mode, both modes, and `--dry-run`+`--real` are all refused with the mode menu
   - **asserts —** the xor wall across all three flags.
   - **covers —** `node-build.ts:767-787`
   - **proven by —** `node-build.test.ts:39`, `:48`, `:54` (REAL, passing)
3. **`real-prechecks-are-cheap`** — `--real` without a real-proof config fails closed BEFORE any worktree is cut
   - **asserts —** the refusal names the REAL-buildable ids; no worktree side effects.
   - **covers —** `node-build.ts:541-571`
   - **proven by —** `node-build.test.ts:63` (REAL, passing)
4. **`registered-buildable-specs-drive`** — the verdict-line spec (the REAL target) and the library story spec (UAT proof-mode mapping) both dry-run
   - **asserts —** contract and story tiers walk the same glue.
   - **covers —** `node-build.ts:980-1001`, `:1007-1008`
   - **proven by —** `node-build.test.ts:74` and `:118` (REAL, passing)
5. **`misses-are-guidance`** — an unknown id, an unregistered spec, and a bare `node` are guidance envelopes, never throws
   - **asserts —** each lists the buildable ids / help.
   - **covers —** `node-build.ts:758-764`, `:803-809`, `:992-998`
   - **proven by —** `node-build.test.ts:85`, `:92`, `:102` (REAL, passing)
6. **`story-chain-dry-runs-end-to-end`** — `story build library --dry-run` drives every node topo-ordered, story last, all signed
   - **asserts —** the order line, per-node PASS rows with rollups, the chain outcome.
   - **covers —** `packages/drive/src/story-build.ts:320-920`
   - **proven by —** `packages/cli/src/story-build.test.ts:17` (REAL, passing)
7. **`story-prechecks-fail-closed`** — unregistered nodes refuse BEFORE any node runs; an unknown story and a capability id refuse with guidance
   - **asserts —** the three story-grain refusals.
   - **covers —** `story-build.ts:371-377`, `:447-459`
   - **proven by —** `story-build.test.ts:64`, `:76`, `:82` (REAL, passing)
8. **`forged-healthy-store-wall`** — `--store pg` is refused for dry-runs at BOTH grains; an unknown `--store` value is refused
   - **asserts —** a scripted PASS can never persist to the shared event log.
   - **covers —** `node-build.ts:281-304`
   - **proven by —** `story-build.test.ts:90`, `:100`, `:124` (REAL, passing)
9. **`store-label-is-honest`** — the envelope header names the verdict store (in-memory vs persisted)
   - **asserts —** the dry-run header reports the in-memory store.
   - **covers —** `node-build.ts:272-279`, `:308-315`
   - **proven by —** `story-build.test.ts:133` (REAL, passing)
10. **`a-long-build-names-the-leg-holding-its-clock`** — the driver opens a NAMED progress stage around every leg that can sit for minutes, and feeds the gate's phase walk in
    - **asserts —** a `node build` reports a named stage for the store leg AND the gate leg (a leg without a stage is a leg that can go silent again); the phases it reports ARE the phases the envelope's own `phase trail:` says were visited, in order — a liveness signal that disagreed with the trail would be a second, unverified account of the same run; a `story build` names each node as `node i/N: <id>` in the DRIVEN order, which is the chain-advancement signal a single "still running" cannot give; and the report is ADVISORY — a progress sink that THROWS on every phase still leaves a passing build with a signed verdict.
    - **covers —** `packages/drive/src/build-progress.ts`, `packages/drive/src/phase-activity.ts` (`withPhaseReport`)
    - **proven by —** `packages/cli/src/node-build.test.ts:1002`, `:1024`, `:1049` and `packages/cli/src/story-build.test.ts:42` (REAL, passing); the module's own cadence / elapsed / cancellation behaviour is `packages/drive/src/build-progress.test.ts` (12 tests, REAL, passing)
11. **`confirm-refusal-envelope-renders-the-original-observation`** — the outer caller can read the spine's original failed CONFIRM observation in the ordinary node-build envelope
    - **asserts —** for both a CONFIRM_RED refusal and a CONFIRM_GREEN refusal after an advancing red, the returned/rendered envelope labels the original observation and preserves run id, unit id, phase, test id, exit code, stdout, and stderr. The registered proof command executes only once for the CONFIRM_RED refusal and twice for the red-then-CONFIRM_GREEN refusal; rendering executes it zero additional times. Passing results and GATE/backstop/non-observation failures have no failed-observation section.
    - **covers —** failed-result propagation and rendering in `packages/drive/src/node-build.ts`
    - **proven by —** a new `packages/drive/src/node-build-refusal-observation.test.ts` through contract [`node-build-refusal-observation-envelope`](node-build-refusal-observation-envelope.md), signed PASS (run `real-mu0ascrz`, per `inner-loop-exit-arc`'s increment log); existing CLI tests stay at `packages/cli/src/node-build.test.ts`. Declared gap at landing (PR #1910): the test calls the renderer directly, covers no CONFIRM_RED refusal and no spawn counts, and the rendered section names no test id; the phase appears only on the `verdict:` line above it.
12. **`node-build-renders-the-returned-escalation-with-its-test-id`** — node build renders the escalation the gate returned, with its unit, run and test id, and names an overruled one, without executing a command
    - **asserts —** a same-file renderer called by `nodeBuild` directly under the `verdict:` line (ahead of the observation section on a failure) renders an AUTHOR_TEST escalation as a labelled header with phase, claim, unit, run and test id, the statement verbatim, the spine's single observation labelled as not a CONFIRM run, and one options line (re-delegate a test revision as one ADR-0563 D4 `revised-test` attempt, or escalate to the owner); an IMPLEMENT escalation as the same header with its claim, statement and assertion, and the options line; an overruled escalation, on a pass or on a GATE refusal after the overrule, as exactly one labelled line with the statement; and a result with neither key as nothing. Rendering adds no spawn to the one (AUTHOR_TEST) or two (CONFIRM_GREEN reached) the walks made.
    - **covers —** `renderEscalation` and its failure- and pass-envelope call sites in `nodeBuild` (`packages/drive/src/node-build.ts`)
    - **proven by —** `packages/drive/src/node-build-escalation-envelope.test.ts` through contract [`node-build-escalation-envelope`](node-build-escalation-envelope.md), signed PASS (run `real-mu1ms77f`)
13. **`a-returned-escalation-round-trips-through-its-revision-record`** — a failed build's returned escalation is written to a per-user record keyed by unit and run, and reading that record back yields its test revision or a refusal that says why
    - **asserts —** `writeRevisionRecord` writes `{ unitId, runId, escalation }` for a returned AUTHOR_TEST escalation, and adds `failedObservation` for an IMPLEMENT one, at `revisionRecordPath(dir, unitId, runId)`. `readTestRevision` reads each record back deep-equal. An overruled escalation, a result with no escalation and an undefined directory write nothing. A run id that is not a single path segment (blank, containing `/` or `\`, or `.` or `..`) is refused before the filesystem is touched, with a reason naming it. A missing run, a record for another unit, a record stored under another run's filename (its reason naming both run ids), invalid JSON and every shape the gate never produces are refused with a reason, not thrown. A write that cannot land returns `{ written: false, path, reason }`. The default directory is `~/.storytree/escalations`.
    - **covers —** `defaultEscalationsDir`, `resolveEscalationsDir`, `revisionRecordPath`, `writeRevisionRecord`, `parseTestRevision` and `readTestRevision` (`packages/drive/src/node-build.ts`)
    - **proven by —** `packages/drive/src/node-build-revision-record.test.ts` through contract [`revision-record-round-trip`](revision-record-round-trip.md), signed PASS (run `real-mu1y606w`). It was strengthened to 53 tests on this branch (`74fc53b3`), and `check:mutation-diff` passes with no survivors. Not exercised: an AUTHOR_TEST record written and then read back through `readTestRevision`.
14. **`build-node-real-threads-the-revision-and-records-the-escalation`** — the single-node REAL lifecycle hands a supplied revision to the AUTHOR_TEST brief and records a returned escalation where its caller asked
    - **asserts —** given `testRevision`, `buildNodeReal` hands the AUTHOR_TEST leaf a prompt carrying the revision's run id, statement and assertion. Given `escalationsDir`, a walk whose escalation the gate returned yields `revisionWrite` deep-equal to `{ written: true, path }`, and the record reads back with the result's escalation. With no directory, or a failure carrying no escalation, the result has no `revisionWrite` key and nothing is written. `story build` and the gate build driver pass neither field.
    - **covers —** `buildNodeReal`, `RealBuildArgs.testRevision`, `RealBuildArgs.escalationsDir` and `RealBuildResult.revisionWrite` (`packages/drive/src/node-build.ts`)
    - **proven by —** `packages/drive/src/build-node-real-revision.test.ts` through contract [`build-node-real-threads-revision`](build-node-real-threads-revision.md), signed PASS on attempt 2 (run `real-mu1zy9xy`), as an ADR-0563 D6 test revision after attempt 1 (run `real-mu1zabhu`) escalated. Not exercised by that proof: the walk without `testRevision`, the assertion clause, and a failure carrying no escalation with a directory set.
15. **`node-build-takes-a-revision-and-names-the-record-it-leaves`** — node build reads a named revision record before any spend, refuses a bad one, and names the record a failed build leaves with the command that revises against it
    - **asserts —** `nodeBuild` refuses `reviseTest` without `real`. With `real`, it reads the named record after the REAL prechecks and before the leaf prompts, the DB preflight, the claim and the worktree. It refuses a missing record, naming its path, and a foreign one, naming both ids, and hands a valid record to the REAL lifecycle. The header names the run being revised. The failure envelope names the record a failed build left, with `storytree node build <id> --real --runtime <runtime> --revise-test <run-id>`, or says it was not written and why.
    - **covers —** `nodeBuild`'s `reviseTest` handling, `NodeBuildOpts.reviseTest` and `NodeBuildOpts.escalationsDir`, `renderRevisingLine` and `renderRevisionRecord` (`packages/drive/src/node-build.ts`)
    - **proven by —** `packages/drive/src/node-build-revise-test.test.ts` through contract [`node-build-revise-test`](node-build-revise-test.md), signed PASS (run `real-mu20lsxo`). Not exercised by that proof: any progress stage, so "before any stage" and the prompt-render-then-preflight order are unobserved; and the REAL worktree arm's pass-through, which is confirmed by reading.
16. **`codex-envelope-reports-feedback-runs`** — the build envelope reports a Codex leaf's feedback runs from the spine's own record
    - **asserts —** `liveLeafLines` renders a Codex author that recorded feedback runs with exactly the Claude branch's feedback line, each run as `<phase>:<tool>=green` or `=exit <code>` with a null code as `none`. It renders an armed Codex author with no runs as `0 bounded runs — armed with` its tool names without the `mcp__spine__` prefix, and a Codex author given no feedback commands with today's `none` line. The Claude branch's feedback line is byte-identical to today's, a Claude author with no runs still renders no feedback line, and pi's `none` line is unchanged.
    - **covers —** `liveLeafLines` (`packages/drive/src/node-build.ts`)
    - **proven by —** `packages/drive/src/node-build-codex-feedback.test.ts` through contract [`node-build-renders-codex-feedback-runs`](node-build-renders-codex-feedback-runs.md), signed PASS on the first attempt (run `real-mu25wogv`), with the `@storytree/drive` suite and typecheck as pre-signature backstops. `packages/drive` is inside the mutation rung, which scores this test at the landing's gate.
17. **`a-red-backstop-preserves-and-diagnoses-the-unsigned-attempt`** — a pre-signature package red leaves an inspectable local authored head and a bounded diagnostic envelope without presenting either as a verdict or promotion
    - **asserts —** for an install-bearing package-typecheck red (the only package observation a build makes since ADR-0580 D2; the regression-suite arm left with it), on both the single-node and the chain (`promote: false`) path, when the spine already committed an authored HEAD distinct from the worktree cut, `buildNodeReal` returns a GATE refusal with zero signing rows, leaves ordinary `promotion` undefined, records `forensicPreservation`, and requests `purpose: "unsigned-forensics"`, which parks that HEAD at the run-unique `claude/real-forensics/<unit>-<run>` branch in the driving repo and never pushes it. Signed promotion and a halted chain's proven prefix stay under `claude/real/<unit>-<run>`, so an unsigned story-node attempt and the same run's signed prefix coexist at distinct refs and SHAs. At the actual `storyBuild` caller, a first-node red exposes the forensic ref while saying there is no proven prefix to park, and a later story-node red renders both the signed prefix and the unsigned forensic ref; neither halted-chain ref reaches origin. The same result does not promise forensic preservation for signer, dirty-tree, other GATE, pre-commit, or unchanged-HEAD failures. `nodeBuild` labels a preserved head `forensics: UNSIGNED` rather than `promoted`, names the red backstop, and renders its captured exit code plus stdout and stderr capped at 4,000 characters each, retaining both ends and inserting an explicit truncation marker when a stream exceeds the cap. A `null` exit renders as `none (killed or timed out after <effective timeout>ms)`, distinguishable from a numeric failing exit; reporting the effective timeout changes no timeout policy. For a typecheck red, honest framing says the package typecheck was observed RED before the gate ruled, says no build runs the package's own test suite, and says no verdict was signed. Rendering consumes the observations already taken and spawns no retry; a signed green run keeps the ordinary promotion envelope and carries no forensic-preservation line.
    - **covers —** `buildNodeReal`'s failed-result path, `honestFramingReal` and the failure-envelope call site in `packages/drive/src/node-build.ts`; forensic propagation, signed-prefix parking and envelope rendering in `packages/drive/src/story-build.ts`; bounded diagnostic and unsigned-ref rendering in `packages/drive/src/backstop-report.ts`; refusal-to-preservation planning and optional result evidence in `packages/drive/src/backstop-preservation.ts`; and purpose-aware local branch parking plus `WorktreeCommandObservation` in `packages/orchestrator/src/build-worktree.ts`.
    - **proven by —** `packages/drive/src/backstop-report.test.ts` proves the exact 4,000-character head/tail bound, truncation marker, numeric and `null` exit rendering, timeout text, refusal binding, and unsigned forensic label; `packages/drive/src/backstop-preservation.test.ts` proves no-refusal, unchanged-HEAD, distinct-authored-HEAD and optional-evidence shapes; `packages/orchestrator/src/build-worktree.test.ts` proves exact stdout/stderr, exit code and effective-timeout propagation plus the categorical `claude/real-forensics/*` versus `claude/real/*` namespace and its no-push/no-PR guard; `packages/drive/src/story-backstop-forensics.test.ts` drives the public `storyBuild` caller through first-node and later-story-node red lifecycles against real git, proving the honest envelope, collision-free refs, distinct trees, teardown and no remote spread; `packages/drive/src/backstop-forensic-integration.test.ts` proves the exact typecheck observation and the retained local ref through `buildNodeReal` itself on both the single-node and chain paths; and `packages/drive/src/node-build-framing.test.ts` pins the typecheck refusal framing whole. The earlier `packages/drive/src/backstop-before-signature.test.ts` remains the independent ordering baseline rather than carrying this recovery proof.
18. **`node-build-envelope-lists-every-repair`** — the drive hands the gate the typecheck's raw output, reports that typecheck only when the walk ended on it, and lists every in-build repair on the envelope
    - **asserts —** over a real fixture worktree, `buildNodeReal`'s backstop returns the typecheck's raw process output beside its bounded rendered reason, so a red naming a SOURCE file goes back to the code-writer inside the same build: the walk visits IMPLEMENT, CONFIRM_GREEN and GATE a second time, signs one row, records one `GATE typecheck → IMPLEMENT` repair, reports `typecheck: "green"` (the last GATE's) and keeps no refused commit. When that repair is refused because the code-writer's slice fails to author, the walk ends at GATE on the original backstop red — a reason beginning `backstop RED:` and carrying ` — in-build repair refused: the code-writer's repair slice failed` — with `typecheck: "red"`, the backstop observation's exit code, the refused commit preserved, and no signing row. When a walk repaired past a red typecheck then ends ELSEWHERE, it reports no typecheck, preserves nothing, and still lists both repairs. `renderRepairs` renders `[]` for a result with no repairs and for an empty list, and otherwise the exact header line naming the count and that a repair is not an attempt, then one numbered line per repair naming the phase, the check, the worker (`test-writer` / `code-writer`) and the detail.
    - **covers —** `renderRepairs` and `buildNodeReal`'s backstop `output` plus its per-GATE typecheck / preservation state, rendered at both envelope call sites in `nodeBuild` (`packages/drive/src/node-build.ts`)
    - **proven by —** `packages/drive/src/node-build-repairs.test.ts` (session-authored; no signed verdict). `packages/drive` is inside the mutation rung, which scores this test at the landing's gate.
