---
id: "gate-ci-parity"
tier: capability
story: cli
title: "Gate↔CI parity by construction — the local gate and CI walk one plan, split only by each step's placement"
outcome: "A green local pnpm gate predicts a green CI verify, because both walk the one gate plan — split only by each step's declared placement — and the one difference that remains, the merge ref, is warned about whenever the branch is behind origin/main."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: [606, 304, 195, 560, 252, 192]
# THE DECIDING ADR IS ADR-0606 (accepted 2026-09-23, owner-ratified), and it SUPERSEDES ADR-0486.
# ADR-0486 decided how to relate two hand-kept step lists — the local plan and CI's own copy in
# `ci.yml` — as one declared, checkable two-way delta, and this unit was the comparator holding the two
# together. ADR-0606 removed BOTH lists, in two steps. Step one (D3/D4): CI's `verify` job runs
# `pnpm gate --ci` and names no check, so there is no delta left to declare and no comparator to keep
# ("deleted, not ported"). Step two (D1/D2/D6): the gate's own hand-kept plan went too — every check is
# a file that declares itself, the gate FINDS it by name the way a test runner finds tests, and the
# order is derived from those declarations. What ADR-0486 got right survives as construction rather
# than as a check: its closed delta classes are the values of each step's `runs` placement
# (`placement-selects-each-run`), and its permanent ref delta is the behind-main warning
# (`stale-branch-surfaced`, D5). The capability ID IS KEPT because the signed verdict binds to it; the
# title, the outcome and every contract changed with the decision.
#
# HOMED IN `cli` — THE GROUND MOVED ON 2026-09-23 AND THE ANSWER DID NOT. It was settled here on
# 2026-08-31 (story-author) on the "judge, not pipeline" ground: the unit was then a pure judge behind
# a `check:*` rung, the fourth of that shape in this story. ADR-0606 D4 deleted that judge. What remains
# is the gate program itself — how it finds and orders its checks, its CI mode and its local
# stale-branch warning, in `packages/cli/src/gate*.ts` and `ci-affected-merge.ts` — so the capability
# is now `cli`'s own source outright, which makes the home stronger rather than weaker. The line with
# `ci-cd` is the same one, restated: `ci-cd`'s `green-gate` owns the PIPELINE (that `verify` runs
# `pnpm gate --ci` as a required step on the merge ref, with the two identities provided); this unit
# owns the PROGRAM that step invokes — which steps run, over which packages, as whom, and what counts
# as green.
#
# `depends_on: []`, AND STILL NOT TO DODGE A CROSS-STORY EDGE. Run the `cross-story-dependency` test
# both ways. No contract below consumes anything `green-gate` delivers: each is proven against the
# plan the gate finds in this checkout (or in a throwaway git working tree a test builds) and the pure
# halves of the two runs, offline, and would pass or fail identically whether or not `green-gate` is
# ever signed. And `green-gate`'s audit reads only `ci.yml`, never this unit. The two stand in a
# RUNTIME reliance — the pipeline runs this program — which each spec names as a cross-story pointer,
# never as a DAG edge. No `consumed_by` is owed on `ci-cd` either.
#
# ⚠ WHAT THE PRE-FLIGHT DID NOT CATCH, KEPT BECAUSE IT IS THE COSTLY PART. Driven `--real` under
# `ci-cd` on 2026-08-31, this unit PASSED (3/3 contracts, $2.8028, persisted in `events.verdict`) — and
# only then did `check:boundaries` refuse where the file had landed. `storytree node resolve` had said
# "REAL-buildable: yes": the money is spent BEFORE any boundary rung looks. Anyone adding a
# `real.sourceFile` to a story that owns no package pays the same for an unlandable verdict. (The pair
# that build authored, `gate-ci-parity.{ts,test.ts}`, was deleted by ADR-0606 D4 — deleted, not ported.
# Never re-author it.)
#
# THE `real:` ARM POINTS AT THE CI MODE'S PURE HALF, `gate-ci.{ts,test.ts}`, and its scope names the
# six modules and six suites that carry the contracts below, plus the `gate-run.ts` shell that wires
# them. It stays a `real:` arm rather than a bare `proof.command` for the reason it always did:
# `readUnitSourceFiles` and the coverage sweep read `buildConfig.real` ONLY, so without it this unit's
# sources would be invisible to `check:boundaries` and its contracts invisible to coverage. Every path
# it names is a live file — a binding left on the deleted pair would read as RENAMED to
# `check:verification-decay`.
#
# ⚠ THIS UNIT IS BUILT AND ALREADY SIGNED — DO NOT SPEND A `--real` RUN ON IT. The signed PASS binds
# to the unit id, and the id survived both the re-home and ADR-0606's rewrite. Its source and tests
# exist and pass, so `CONFIRM_RED` — which is fail-closed — has no red left to observe and a `--real`
# run would HALT after charging for the attempt. That holds for the two contracts ADR-0606's second
# step added as well (`checks-are-found-from-their-files`, `order-is-derived-from-declarations`): they
# landed together with `gate-checks.ts` and its suite, so they too have nothing red to observe.
# `node resolve` reporting "REAL-buildable: yes" is the standing pre-flight gap named above, not an
# invitation.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs:
      - "packages/cli/src/gate-ci.test.ts"
      - "packages/cli/src/gate-checks.test.ts"
      - "packages/cli/src/gate-order.test.ts"
      - "packages/cli/src/gate-runner.test.ts"
      - "packages/cli/src/gate-scope.test.ts"
      - "packages/cli/src/ci-affected-merge.test.ts"
    sourceGlobs:
      - "packages/cli/src/gate-ci.ts"
      - "packages/cli/src/gate-checks.ts"
      - "packages/cli/src/gate-order.ts"
      - "packages/cli/src/gate-runner.ts"
      - "packages/cli/src/gate-scope.ts"
      - "packages/cli/src/ci-affected-merge.ts"
      - "packages/cli/src/gate-run.ts"
  real:
    testFile: "packages/cli/src/gate-ci.test.ts"
    sourceFile: "packages/cli/src/gate-ci.ts"
    scope:
      testGlobs:
        - "packages/cli/src/gate-ci.test.ts"
        - "packages/cli/src/gate-checks.test.ts"
        - "packages/cli/src/gate-order.test.ts"
        - "packages/cli/src/gate-runner.test.ts"
        - "packages/cli/src/gate-scope.test.ts"
        - "packages/cli/src/ci-affected-merge.test.ts"
      sourceGlobs:
        - "packages/cli/src/gate-ci.ts"
        - "packages/cli/src/gate-checks.ts"
        - "packages/cli/src/gate-order.ts"
        - "packages/cli/src/gate-runner.ts"
        - "packages/cli/src/gate-scope.ts"
        - "packages/cli/src/ci-affected-merge.ts"
        - "packages/cli/src/gate-run.ts"
    install: false
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/cli", "typecheck"]
    editsExisting: false
---

# Gate↔CI parity by construction — the local gate and CI walk one plan, split only by each step's placement

**Outcome —** A green local `pnpm gate` predicts a green CI `verify`, because both walk the ONE gate
plan — and nobody keeps that plan. The gate ASSEMBLES it: its four fixed legs (`BUILT_IN_LEGS` in
`packages/cli/src/gate-order.ts`) plus every check it FINDS by file name, each reading where it runs,
its subject, its cost, its skip policy and its CI identity from the `/* gate-check` declaration its
own file opens with, and ordered from those declarations (`packages/cli/src/gate-checks.ts`,
ADR-0606 D1/D2). With no list anywhere there is nothing for the two runs to disagree about and nothing
to forget to wire: writing a check's file is its whole registration. The local gate walks the steps
placed `both` or `local`; CI's `verify` job runs `pnpm gate --ci` over the steps placed `both` or `ci`;
and each step's `runs` placement is the only record of where it runs. The CI run scopes through the
same affected-scope classifier the local run uses, hands each step only the credential its declaration
names, counts a declared skip as a failure unless that check accepts the skip in CI, refuses a partial
run, and names every failed step on GitHub. The one difference that stays is the merge ref — the local
gate proves HEAD, CI proves the branch merged onto `main`'s tip — so the local gate warns, before and
beside its verdict, whenever the branch is behind `origin/main`.

> **No list is transcribed here, deliberately.** Which checks exist, and which side each runs on, is
> each check's own declaration — `pnpm gate --list` prints the whole plan, every check with its file
> and its owning story node — never copied into this prose, where it would go stale unread. That is
> the failure ADR-0486's Context measured in this very file, and the reason ADR-0606 removed the
> second list and then the first rather than checking either harder.

## Guidance

- **Proof-walkthrough first (integration test, against the ONE real plan).** The capability is a
  single plan, found once and walked two ways, so the proof finds the real plan exactly as
  `pnpm gate` does (`loadGatePlan` over this checkout) and drives the pure half of each run — plus
  throwaway git working trees for discovery's refusal paths — and never re-runs CI. Walk the finding
  first: which files are checks (`checkNameFor`, `findCheckFiles`, `discoverChecks`), what each
  declares (`readCheckDeclaration`), where the found checks land around the fixed legs
  (`deriveGatePlan`), and what refuses the whole plan (`loadGatePlan`). Then walk it as the local
  gate, then as `pnpm gate --ci`: which steps each run selects (`stepsFor`); which packages each
  scopes to (`localAffectedScope` / `ciMergeScope`, both over the one `classifyChangedFiles`); which
  credential each CI step sees (its declared `ciIdentity` → `ciStepEnvironment`); what counts as green
  in CI (`runGate` with `ci` set, `gateExitCode`); what GitHub shows (`githubGroupStart`,
  `githubErrorAnnotation`, `renderGithubSummary`, `ciVerdict`); and what the local run warns
  (`parseBehindCount` → `renderBehindMainNotice`). `gate-run.ts`'s `main()` is the I/O shell that
  wires these together, `pnpm gate --list` included. ADR-0606 proves that wiring the only way a
  workflow change can be proven — the switching PR's own CI run — on top of the pure halves' suites.
- **Which suite carries which contract.** A test proves a contract only when its title NAMES the
  contract id (`describe("<contract-id>: …")`, ADR-0126), and the six suites below are this unit's
  declared test scope:
  - `placement-selects-each-run` — `packages/cli/src/gate-order.test.ts`, against the REAL found
    plan;
  - `both-runs-scope-through-one-classifier` — `packages/cli/src/gate-scope.test.ts` (the local half)
    and `packages/cli/src/ci-affected-merge.test.ts` (the CI half);
  - `ci-step-gets-only-its-declared-identity` — `packages/cli/src/gate-ci.test.ts` (the environment a
    step gets) and `packages/cli/src/gate-order.test.ts` (which identity a real plan step declares,
    and `readsLiveStore`);
  - `ci-green-means-every-ci-step-passed` — `packages/cli/src/gate-runner.test.ts` (the skip rule:
    declared, refused in CI, accepted in CI, undeclared) and `packages/cli/src/gate-ci.test.ts`
    (`ciSelectionRefusal`, the partial-run refusal's pure half), plus the call site named in the next
    bullet;
  - `ci-run-reports-each-step-on-github` — `packages/cli/src/gate-ci.test.ts`;
  - `stale-branch-surfaced` — `packages/cli/src/gate-scope.test.ts`, plus the caller named in the
    next bullet;
  - `checks-are-found-from-their-files` and `order-is-derived-from-declarations` —
    `packages/cli/src/gate-checks.test.ts`, whose every test is titled with one of the two.

  One fence sits OUTSIDE that scope and is worth knowing about: a test in
  `packages/cli/src/gate-rerun.test.ts` holds every check's declared `ciIdentity` to its own file's
  real import closure, so a declaration cannot claim a store read the code never makes, or hide one
  it does. It is the re-run surface's test, titled for no contract here.
- **Two clauses live in the shell, and one of them is its contract's crux.** `--ci` refusing `--only`
  / `--rerun-failed` is DECIDED by the pure `ciSelectionRefusal` (`gate-ci.ts`) but CALLED inline in
  `gate-run.ts`'s `main()`, and the two places a local run prints the behind-main warning sit inline
  there too, where a test of a pure function cannot see them. The second matters most. This
  contract's previous form was satisfied by tests of `diagnoseStaleBranch` while nothing in production
  ever called it (measured 2026-09-23), so a proof that pins only the warning's TEXT reproduces
  exactly that failure. The proof must pin the CALLER — `gate-run.ts` printing the notice at the start
  and beside the verdict, and never under `--ci` — not only the function it calls.
- **There is no list, so do not grow one.** ADR-0606 deleted both of them rather than porting either.
  Step one (D4) deleted the parity comparison — the hand-rolled workflow reader, the declared-delta
  literals, `REF_DELTA`, `diagnoseStaleBranch`. Step two (D1, D2, D6) deleted the gate's own hand-kept
  plan, the two ordering sets that policed it, the central retired-check map and the store-reading set
  a CI identity was defaulted from. Nothing in this capability reads `ci.yml`, and nothing should: the
  workflow names no check (`green-gate` holds that). Adding a check — to either run — is writing ONE
  file whose `/* gate-check` declaration says where it runs; there is no plan entry, no workflow step
  and no expected-membership literal to add beside it. A test that pins a check BY NAME must be
  pinning a DECISION about that check — a decided placement or identity, a real `runsBefore`
  dependency — never serving as an inventory of which checks exist.
- **Where a step runs is decided, not tuned.** `check:verification-decay` is `local` BY DECISION:
  ADR-0252 D3 makes the decay ceiling a session drain obligation, never a merge barrier, so placing it
  in CI would reverse an accepted decision (ADR-0606 D8) rather than tidy a field. The studio build
  (`pnpm -r build`) is `ci` because only CI's clean checkout is asked to prove it — every package
  exports raw TypeScript with no build step, and the one buildable target, `apps/studio`'s
  `vite build`, can fail on something `tsx` tolerates (ADR-0606 D4's environmental class). Those two
  placements are pinned by name in `gate-order.test.ts` because each is a single word that nothing
  else would stop changing. Every other step keeps the side it had on 2026-09-23 (ADR-0606 D8);
  moving one is an ordinary engineering edit to one word in that check's own declaration, visible in
  review in that file's diff.
- **The ref delta is permanent, and it is diagnosed rather than removed** (ADR-0606 D5). The local
  gate proves HEAD; CI proves the branch merged onto `main`'s tip, so even an identical walk can pass
  here and fail there. The warning counts against the LAST FETCHED `origin/main`, so a stale fetch
  undercounts — which is why its remedy begins with the fetch.
- **Discovery rests on a naming convention, and that is the accepted cost** (ADR-0606 Consequences).
  A check file renamed AWAY from `check-<name>.ts` / `<name>-check.ts` drops out of the plan silently —
  the same risk a test file renamed away from `*.test.ts` has always carried. The opposite direction is
  closed: a file named like a check whose declaration is missing or malformed refuses the whole run.
- **The sizing test.** This capability owns the PLAN and the WALK — how the gate finds its checks and
  orders them, which steps each run executes, over what, as whom, and what counts as green — never a
  check's own verdict, and never which side an ordinary check runs on. What `check:guidance` or
  `check:uat-revision-continuity` catches, and the declaration each is authored with, belong to the
  capability behind that check. A proposed contract here that could only be proven by running a
  check's own logic belongs there, not here.
- **The REAL build-tests gate drive names its increment** (proposed, ADR-0576; contract
  [`gate-real-build-names-its-increment`](gate-real-build-names-its-increment.md)). This capability
  owns `packages/cli/src/gate*.ts`, so the third paid REAL entry, `driveBuildTestsGate`, sits here even
  though it bears on the gate BUILD rather than on gate↔CI parity. `gate run <story>#gate-<n> --real`
  and `build gate` require `--increment <id>`. A missing one refuses as argument validation before the
  prompt render and the decision sweep; an unknown or closed increment, or a gate the attempt policy
  stops, refuses after the sweep and before the database starts. The gate id is the ledger unit
  (ADR-0098 U2), the walk records its attempt and any signed pass under it, and `makeGateDeps`
  (`commands.ts`) threads `--increment` from argv.
- **The REAL build-tests gate drive carries a test revision** (ADR-0571, amended for gates; increment
  `story-and-gate-builds-carry-test-revisions`). `gate run <story>#gate-<n> --real --revise-test
  <run-id>` reads the record keyed by the GATE id — so a record `node build` wrote for the referenced
  build node is never read for the gate — before any spend, threads it into the drive's AUTHOR_TEST
  brief, and a failed drive prints its own record path and the exact gate re-run. A revision run pairs
  with the gate's live grant (ADR-0576 D6). `driveBuildTestsGate` takes the same injectable REAL node
  builder the story chain does, and `makeGateDeps` threads `--revise-test` from argv.

## Contracts (8)

*Two contract ids were retired on 2026-09-24 with ADR-0606, and neither should be reused.*
`declared-content-delta-is-two-way` went by decision (D4): with one plan there is no second list to
relate, so there is no delta to declare or to assert both ways — its closed classes live on as the
`runs` values that `placement-selects-each-run` pins. `ref-delta-is-declared` was FOLDED INTO
`stale-branch-surfaced`: its `REF_DELTA` constant never had a production caller and is deleted (D5),
and the ref delta now reaches the reader as the warning's own explanation, at the moment it applies.
`stale-branch-surfaced` keeps its id because its promise did not change — what changed is that
something now keeps it.

*Two contract ids were ADDED on 2026-09-24 with ADR-0606's second step (D1, D2, D6).* Contracts 7
and 8 say how the one plan comes to exist — found from each check's own file, and ordered from what
each declares — which is what the other six walk. They are appended rather than inserted so that no
existing contract renumbers.

1. **`placement-selects-each-run`** — one plan, walked two ways: each step's `runs` placement decides which run executes it
   - **asserts —** `stepsFor(plan, "local")` — what `pnpm gate` walks — returns exactly the steps of
     the real found plan placed `runs: both` or `runs: local`, and `stepsFor(plan, "ci")` — what
     `pnpm gate --ci` walks — exactly the steps placed `both` or `ci`, each in plan order and never
     reordered; every step of the real plan carries one of the three placements, with no default to
     fall back on — a fixed leg's in `BUILT_IN_LEGS`, a check's in its own declaration; the two
     DECIDED placements are pinned by name, so moving either is a
     visible edit — the studio build (`pnpm -r build`) runs only in CI and `check:verification-decay`
     only locally (ADR-0252 D3); and the ordering invariant (`evaluateGateOrder`) holds over the whole
     plan AND over each side's run, which is what makes judging the whole plan before the placement
     filter sound.
   - **covers —** `GatePlanStep.runs`, `GatePlacement` and `stepsFor`
     (`packages/cli/src/gate-order.ts`); the placement filter `gate-run.ts` applies after judging the
     order over the whole scoped plan.
2. **`both-runs-scope-through-one-classifier`** — the local and CI runs narrow their `-r` legs through the one affected-scope classifier, and both fail wide
   - **asserts —** the local gate's `localAffectedScope` (its changed files: the merge-base with
     `origin/main` against the working tree, untracked files included) and the CI run's
     `ciMergeScope` (a `pull_request` merge commit's `HEAD^1..HEAD`, listed `--no-renames`) each hand
     their file list to the one `classifyChangedFiles` (ADR-0304 D2), so a root file widens both runs
     to `full` and a mapped reader path narrows both alike; each widens to `full` rather than narrow on
     an input it cannot trust — an unreadable local diff, an empty change set, a run that is not a
     `pull_request` event, a checkout with no `HEAD^2`, a failed `git diff`; and the CI run's
     `githubScopeOutput` carries `pnpm_args` and `mode`, one per line, as the `automerge` job's
     ADR-0195 §5 backstop reads them from `$GITHUB_OUTPUT`.
   - **covers —** `localAffectedScope` (`packages/cli/src/gate-scope.ts`); `ciMergeScope`,
     `githubScopeOutput` and `githubScopeSummary` (`packages/cli/src/ci-affected-merge.ts`); both
     halves delegate to `classifyChangedFiles` (`packages/cli/src/ci-affected.ts`).
3. **`ci-step-gets-only-its-declared-identity`** — each CI step runs with exactly the credential its own declaration names, and a step that declares none gets none
   - **asserts —** a step's CI identity is exactly the `ciIdentity` its own declaration names, with
     no default to fall back on — `check:uat-revision-continuity` declares `ci-webverdict`, the
     verdict-history reader ADR-0560 keeps out of the presence identity's reach, and no fixed leg
     declares one; `readsLiveStore(step)` is true exactly when a step declares an identity, so that
     one declaration answers both "which credential in CI" and "can a re-run acquit this step";
     `ciStepEnvironment` then strips every `CREDENTIAL_ENV_VARS` name and every
     `STORYTREE_CI_IDENTITY_*` variable from the job's environment and restores only that identity's
     trimmed `STORYTREE_CI_IDENTITY_<ID>_CREDENTIALS` / `_DB_USER` values, as
     `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE` and
     `STORYTREE_DB_USER`, so the test leg and every step that reads no store run credential-free; and
     it refuses a step whose identity the run does not provide, naming each missing variable, which
     `pnpm gate --ci` records as that step's FAIL without spawning it.
   - **covers —** `GatePlanStep.ciIdentity`, `CiIdentity` and `readsLiveStore`
     (`packages/cli/src/gate-order.ts`); `ciStepEnvironment`, `ciIdentityEnvNames` and
     `CREDENTIAL_ENV_VARS` (`packages/cli/src/gate-ci.ts`); the per-step environment `gate-run.ts`
     builds for each child under `--ci`.
4. **`ci-green-means-every-ci-step-passed`** — a CI run is green only when every step of its placement passed, or skipped where its own declaration accepts a skip in CI — never on a subset
   - **asserts —** a step exiting the reserved `GATE_SKIP_EXIT_CODE` (3) is a SKIP only when its own
     declaration declares a skip (`StepSkip`: `when`, `inCi`); under `pnpm gate --ci` — `runGate`
     with `ci` set — such a declared skip is a FAIL carrying `REFUSED_SKIP_NOTE` after the step's own
     note, and `gateExitCode` is non-zero, unless the declaration accepts that skip in CI
     (`inCi: accepted`), which stays a SKIP; an exit 3 from a step that declares NO skip is a FAIL
     carrying `UNDECLARED_SKIP_NOTE` in both runs, because a skip is an opt-in its author wrote and
     never inferred from an exit code; an ordinary red carries no refusal note, a pass still passes,
     and a killed step stays NOT RUN; without `ci` — the local gate — a declared skip stays a SKIP
     with no note; and `--ci` combined with `--only` or `--rerun-failed` is refused before any step
     runs (`ciSelectionRefusal`), so the partial exit code `GATE_PARTIAL_EXIT_CODE` (4) can never
     reach a workflow.
   - **covers —** `RunGateInput.ci`, `REFUSED_SKIP_NOTE`, `UNDECLARED_SKIP_NOTE` and `gateExitCode`
     (`packages/cli/src/gate-runner.ts`); `GateStep.skip` and `StepSkip`
     (`packages/cli/src/gate-order.ts`); `ciSelectionRefusal` (`packages/cli/src/gate-ci.ts`); the
     `--ci` flag in `gate-run.ts`, which sets `ci` and refuses a partial selection.
5. **`ci-run-reports-each-step-on-github`** — a CI run shows each step as its own log section, names every failed step, and summarises the run in plan order
   - **asserts —** under `pnpm gate --ci`, each step's log opens with `githubGroupStart`
     (`::group::`, with `%`, `\r` and `\n` in its title escaped as GitHub's own workflow-command
     escaping does, so no title can end or corrupt the command) and closes with `GITHUB_GROUP_END`
     before its result line; each failed step raises `githubErrorAnnotation` — an
     `::error` titled `gate step failed: <command>`, carrying its exit code and note, with the title's
     `:` and `,` escaped; and `renderGithubSummary` writes the per-step table — number, command,
     result, time, note — to `$GITHUB_STEP_SUMMARY` in plan order under `ciVerdict`, which applies
     `gateExitCode`'s rule, so the summary page can never call green what the exit code calls red.
   - **covers —** `githubGroupStart`, `GITHUB_GROUP_END`, `githubErrorAnnotation`, `ciVerdict` and
     `renderGithubSummary` (`packages/cli/src/gate-ci.ts`); their call sites in `gate-run.ts`.
6. **`stale-branch-surfaced`** — a branch behind main is warned about before and beside the local verdict, never left as a silent CI surprise
   - **asserts —** `renderBehindMainNotice(n)` for any `n > 0` returns the warning that the branch is
     `n` commit(s) behind `origin/main` as last fetched, that CI proves the branch MERGED onto
     `main`'s tip so a green here does not predict a green CI, and the remedy
     `git fetch origin && git merge origin/main`, then re-gate; it returns nothing at `0`, and nothing
     for an unknown count (`null`) — which `behindMainCount` reports when
     `git rev-list --count HEAD..origin/main` fails, and `parseBehindCount` when its output is not a
     plain count; and a local `pnpm gate` prints it at the start of the run and again beside its
     verdict, while `pnpm gate --ci`, which proves the merge ref itself, never does.
   - **covers —** `parseBehindCount` and `renderBehindMainNotice` (`packages/cli/src/gate-scope.ts`);
     `behindMainCount` and the two print sites in `gate-run.ts`.
7. **`checks-are-found-from-their-files`** — a gate check is a file the gate finds by its name and reads the declaration of without importing it, so writing that file is its whole registration
   - **asserts —** every file named `check-<name>.ts` or `<name>-check.ts` in a workspace project —
     never a `.test.ts` — is the gate check `check:<name>` (`checkNameFor`, `findCheckFiles`), found by
     `git ls-files` over the working tree, so a committed or untracked check counts and an ignored or
     deleted one does not (`discoverChecks`); the gate reads the `/* gate-check` YAML declaration the
     file OPENS with as text, never by importing the check (`readCheckDeclaration`), so writing that
     one file puts the check in the plan `loadGatePlan` assembles for the next run with no other edit;
     the declaration is strict — the opener must be the file's first line and the closer stand alone
     on its line, the YAML must parse with no error and no warning, every key must be a known one
     holding a value from its closed set (`runs`, `subject`, `cost`, `ciIdentity`, `skip.inCi`), and
     `why` and any `skip.when` must say something; each found check runs its own file from its own
     workspace (`checkInvocation`), in the `pnpm -C <workspace> exec` form that keeps a declared
     skip's exit 3 intact; `findCheckFiles` refuses a check-shaped file that is misnamed, sits outside
     every workspace or shares its name with another, and `loadGatePlan` REFUSES the whole plan —
     every reason reported, no step run — when git cannot list the tree, when the listing is empty,
     when any check-shaped file was refused or has a missing or malformed declaration, or when no live
     check is found at all; a file declaring
     `retired: <decision>` is listed and never run (ADR-0606 D6); and `pnpm gate --list` prints every
     step with its placement, subject, cost, identity and skip, each check with its file and owning
     story node — `(none declared)` where the ownership map names none — then the retired checks,
     while `--list --json` prints the same as JSON (`listGatePlan`, `renderGatePlanListing`).
   - **covers —** `readCheckDeclaration`, `checkNameFor`, `findCheckFiles`, `sortDeclaredChecks`,
     `discoverChecks`, `checkInvocation`, `loadGatePlan`, `listGatePlan` and `renderGatePlanListing`
     (`packages/cli/src/gate-checks.ts`); the refusal `gate-run.ts` prints before any step runs, and
     its `--list` / `--list --json` output, each owner read from the source-ownership map.
8. **`order-is-derived-from-declarations`** — the gate's order is derived from each check's declared subject and cost around its fixed legs, never arranged by hand
   - **asserts —** `deriveGatePlan` places `pnpm lint` first, then every own-work, seconds-cost check,
     then the two `-r` legs, then every own-work, minutes-cost check, then the studio build, then the
     shared-environment checks, seconds-cost before minutes-cost — the fixed legs coming from
     `BUILT_IN_LEGS` — so both ordering axes hold by construction; within a block the order is the
     discovery order (by name) and is moved only by a check's `runsBefore` declaration, which is how
     the real plan runs `check:manifest-fragments` ahead of the three rungs that read the composed
     manifest; it REFUSES the plan, reporting every reason together, for a `runsBefore` cycle (naming
     each check caught in it), a `runsBefore` naming no live check, and a `runsBefore` pointing at a
     check whose own subject and cost place it in an EARLIER block, while one pointing into a later
     block is already satisfied and refuses nothing; and `checkStep` labels each check by its name,
     runs its own file, and carries only what it declared.
   - **covers —** `deriveGatePlan` and `checkStep` (`packages/cli/src/gate-checks.ts`);
     `BUILT_IN_LEGS` and `BuiltInLegs` (`packages/cli/src/gate-order.ts`), the fixed slots the found
     checks are placed around.
