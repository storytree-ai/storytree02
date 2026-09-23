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
# together. ADR-0606 removed the second list: CI's `verify` job now runs `pnpm gate --ci` and names no
# check, so there is no delta left to declare and no comparator to keep (D4: "deleted, not ported").
# What ADR-0486 got right survives as construction rather than as a check: its closed delta classes
# are the values of each step's `runs` placement (`placement-selects-each-run`), and its permanent ref
# delta is the behind-main warning (`stale-branch-surfaced`, D5). The capability ID IS KEPT because the
# signed verdict binds to it; the title, the outcome and every contract changed with the decision.
#
# HOMED IN `cli` — THE GROUND MOVED ON 2026-09-23 AND THE ANSWER DID NOT. It was settled here on
# 2026-08-31 (story-author) on the "judge, not pipeline" ground: the unit was then a pure judge behind
# a `check:*` rung, the fourth of that shape in this story. ADR-0606 D4 deleted that judge. What remains
# is the gate program itself — its CI mode and its local stale-branch warning, in
# `packages/cli/src/gate*.ts` and `ci-affected-merge.ts` — so the capability is now `cli`'s own source
# outright, which makes the home stronger rather than weaker. The line with `ci-cd` is the same one,
# restated: `ci-cd`'s `green-gate` owns the PIPELINE (that `verify` runs `pnpm gate --ci` as a required
# step on the merge ref, with the two identities provided); this unit owns the PROGRAM that step
# invokes — which steps run, over which packages, as whom, and what counts as green.
#
# `depends_on: []`, AND STILL NOT TO DODGE A CROSS-STORY EDGE. Run the `cross-story-dependency` test
# both ways. No contract below consumes anything `green-gate` delivers: each is proven against the real
# `GATE_PLAN` and the pure halves of the two runs, offline, and would pass or fail identically whether
# or not `green-gate` is ever signed. And `green-gate`'s audit reads only `ci.yml`, never this unit. The
# two stand in a RUNTIME reliance — the pipeline runs this program — which each spec names as a
# cross-story pointer, never as a DAG edge. No `consumed_by` is owed on `ci-cd` either.
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
# five modules and five suites that carry the contracts below, plus the `gate-run.ts` shell that wires
# them. It stays a `real:` arm rather than a bare `proof.command` for the reason it always did:
# `readUnitSourceFiles` and the coverage sweep read `buildConfig.real` ONLY, so without it this unit's
# sources would be invisible to `check:boundaries` and its contracts invisible to coverage. Every path
# it names is a live file — a binding left on the deleted pair would read as RENAMED to
# `check:verification-decay`.
#
# ⚠ THIS UNIT IS BUILT AND ALREADY SIGNED — DO NOT SPEND A `--real` RUN ON IT. The signed PASS binds
# to the unit id, and the id survived both the re-home and ADR-0606's rewrite. Its source and tests
# exist and pass, so `CONFIRM_RED` — which is fail-closed — has no red left to observe and a `--real`
# run would HALT after charging for the attempt. `node resolve` reporting "REAL-buildable: yes" is the
# standing pre-flight gap named above, not an invitation.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs:
      - "packages/cli/src/gate-ci.test.ts"
      - "packages/cli/src/gate-order.test.ts"
      - "packages/cli/src/gate-runner.test.ts"
      - "packages/cli/src/gate-scope.test.ts"
      - "packages/cli/src/ci-affected-merge.test.ts"
    sourceGlobs:
      - "packages/cli/src/gate-ci.ts"
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
        - "packages/cli/src/gate-order.test.ts"
        - "packages/cli/src/gate-runner.test.ts"
        - "packages/cli/src/gate-scope.test.ts"
        - "packages/cli/src/ci-affected-merge.test.ts"
      sourceGlobs:
        - "packages/cli/src/gate-ci.ts"
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
plan (`GATE_PLAN` in `packages/cli/src/gate-order.ts`). The local gate walks the steps placed `both`
or `local`; CI's `verify` job runs `pnpm gate --ci` over the steps placed `both` or `ci`; and each
step's `runs` placement is the only record of where it runs. The CI run scopes through the same
affected-scope classifier the local run uses, hands each step only the credential its plan entry
declares, counts a declared skip as a failure, refuses a partial run, and names every failed step on
GitHub. The one difference that stays is the merge ref — the local gate proves HEAD, CI proves the
branch merged onto `main`'s tip — so the local gate warns, before and beside its verdict, whenever the
branch is behind `origin/main`.

> **No list is transcribed here, deliberately.** Which steps sit on which side is read from
> `GATE_PLAN` and pinned by name in that plan's own test — never copied into this prose, where it
> would go stale unread. That is the failure ADR-0486's Context measured in this very file, and the
> reason ADR-0606 removed the second list altogether rather than checking it harder.

## Guidance

- **Proof-walkthrough first (integration test, against the ONE real plan).** The capability is a
  single plan walked two ways, so the proof reads the real `GATE_PLAN` and drives the pure half of each
  run — it never re-runs CI. Walk it as the local gate, then as `pnpm gate --ci`: which steps each run
  selects (`stepsFor`); which packages each scopes to (`localAffectedScope` / `ciMergeScope`, both over
  the one `classifyChangedFiles`); which credential each CI step sees (`ciIdentityFor` →
  `ciStepEnvironment`); what counts as green in CI (`runGate` with `skipIsFailure`, `gateExitCode`);
  what GitHub shows (`githubGroupStart`, `githubErrorAnnotation`, `renderGithubSummary`, `ciVerdict`);
  and what the local run warns (`parseBehindCount` → `renderBehindMainNotice`). `gate-run.ts`'s
  `main()` is the I/O shell that wires these together. ADR-0606 proves that wiring the only way a
  workflow change can be proven — the switching PR's own CI run — on top of the pure halves' suites.
- **Which suite carries which contract.** A test proves a contract only when its title NAMES the
  contract id (`describe("<contract-id>: …")`, ADR-0126), and the five suites below are this unit's
  declared test scope:
  - `placement-selects-each-run` — `packages/cli/src/gate-order.test.ts`;
  - `both-runs-scope-through-one-classifier` — `packages/cli/src/gate-scope.test.ts` (the local half)
    and `packages/cli/src/ci-affected-merge.test.ts` (the CI half);
  - `ci-step-gets-only-its-declared-identity` — `packages/cli/src/gate-ci.test.ts` (the environment a
    step gets) and `packages/cli/src/gate-order.test.ts` (which identity each plan step gets);
  - `ci-green-means-every-ci-step-passed` — `packages/cli/src/gate-runner.test.ts` (the skip rule),
    plus the partial-run refusal named in the next bullet;
  - `ci-run-reports-each-step-on-github` — `packages/cli/src/gate-ci.test.ts`;
  - `stale-branch-surfaced` — `packages/cli/src/gate-scope.test.ts`, plus the caller named in the
    next bullet.
- **Two clauses live in the shell, and one of them is its contract's crux.** `--ci` refusing `--only`
  / `--rerun-failed`, and the two places a local run prints the behind-main warning, sit inline in
  `gate-run.ts`'s `main()`, where a test of a pure function cannot see them. The second matters most.
  This contract's previous form was satisfied by tests of `diagnoseStaleBranch` while nothing in
  production ever called it (measured 2026-09-23), so a proof that pins only the warning's TEXT
  reproduces exactly that failure. The proof must pin the CALLER — `gate-run.ts` printing the notice
  at the start and beside the verdict, and never under `--ci` — not only the function it calls.
- **There is no second list, so do not grow one.** ADR-0606 D4 deleted the parity comparison — the
  hand-rolled workflow reader, the declared-delta literals, `REF_DELTA`, `diagnoseStaleBranch` —
  rather than porting it. Nothing in this capability reads `ci.yml`, and nothing should: the workflow
  names no check (`green-gate` holds that), so there is nothing to compare the plan against. Adding a
  CI check is one plan entry carrying its `runs` placement; there is no workflow step to add beside it.
- **Where a step runs is decided, not tuned.** `check:verification-decay` is `local` BY DECISION:
  ADR-0252 D3 makes the decay ceiling a session drain obligation, never a merge barrier, so placing it
  in CI would reverse an accepted decision (ADR-0606 D8) rather than tidy a field. The studio build
  (`pnpm -r build`) is `ci` because only CI's clean checkout is asked to prove it — every package
  exports raw TypeScript with no build step, and the one buildable target, `apps/studio`'s
  `vite build`, can fail on something `tsx` tolerates (ADR-0606 D4's environmental class). Every other
  step keeps the side it had on 2026-09-23 (ADR-0606 D8); moving one is an ordinary engineering edit
  to one field, visible in review because the placements are pinned by name.
- **The ref delta is permanent, and it is diagnosed rather than removed** (ADR-0606 D5). The local
  gate proves HEAD; CI proves the branch merged onto `main`'s tip, so even an identical walk can pass
  here and fail there. The warning counts against the LAST FETCHED `origin/main`, so a stale fetch
  undercounts — which is why its remedy begins with the fetch.
- **The sizing test.** This capability owns the WALK — which steps run, over what, as whom, and what
  counts as green — never a check's own verdict. What `check:guidance` or
  `check:uat-revision-continuity` catches belongs to the capability behind that check. A proposed
  contract here that could only be proven by running a check's own logic belongs there, not here.
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

## Contracts (6)

*Two contract ids were retired on 2026-09-24 with ADR-0606, and neither should be reused.*
`declared-content-delta-is-two-way` went by decision (D4): with one plan there is no second list to
relate, so there is no delta to declare or to assert both ways — its closed classes live on as the
`runs` values that `placement-selects-each-run` pins. `ref-delta-is-declared` was FOLDED INTO
`stale-branch-surfaced`: its `REF_DELTA` constant never had a production caller and is deleted (D5),
and the ref delta now reaches the reader as the warning's own explanation, at the moment it applies.
`stale-branch-surfaced` keeps its id because its promise did not change — what changed is that
something now keeps it.

1. **`placement-selects-each-run`** — one plan, walked two ways: each step's `runs` placement decides which run executes it
   - **asserts —** `stepsFor(GATE_PLAN, "local")` — what `pnpm gate` walks — returns exactly the
     steps placed `runs: "both"` or `runs: "local"`, and `stepsFor(GATE_PLAN, "ci")` — what
     `pnpm gate --ci` walks — exactly the steps placed `both` or `ci`, each in plan order and never
     reordered; every `GATE_PLAN` step declares a `runs` placement, with no default to fall back on;
     the local-only and CI-only steps are pinned by name, so moving a step between sides is a visible
     edit; and the ordering invariant (`evaluateGateOrder`) holds over the whole plan AND over each
     side's run, which is what makes judging the whole plan before the placement filter sound.
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
3. **`ci-step-gets-only-its-declared-identity`** — each CI step runs with exactly the credential its plan entry declares, and a step that needs none gets none
   - **asserts —** `ciIdentityFor` gives a step the `ciIdentity` it declares — today only
     `check:uat-revision-continuity`, which declares `ci-webverdict`, the verdict-history reader
     ADR-0560 keeps out of the presence identity's reach — else `ci-presence` when the step reads the
     live store (`LIVE_STORE_READING_CHECKS`), else none, and `GATE_PLAN` declares an identity only to
     override that default, only on a store-reading step; `ciStepEnvironment` then strips every
     `CREDENTIAL_ENV_VARS` name and every `STORYTREE_CI_IDENTITY_*` variable from the job's
     environment and restores only that identity's trimmed `STORYTREE_CI_IDENTITY_<ID>_CREDENTIALS` /
     `_DB_USER` values, as `GOOGLE_APPLICATION_CREDENTIALS`, `CLOUDSDK_AUTH_CREDENTIAL_FILE_OVERRIDE`
     and `STORYTREE_DB_USER`, so the test leg and every step that reads no store run credential-free;
     and it refuses a step whose identity the run does not provide, naming each missing variable,
     which `pnpm gate --ci` records as that step's FAIL without spawning it.
   - **covers —** `ciIdentityFor`, `GatePlanStep.ciIdentity` and `LIVE_STORE_READING_CHECKS`
     (`packages/cli/src/gate-order.ts`); `ciStepEnvironment`, `ciIdentityEnvNames` and
     `CREDENTIAL_ENV_VARS` (`packages/cli/src/gate-ci.ts`); the per-step environment `gate-run.ts`
     builds for each child under `--ci`.
4. **`ci-green-means-every-ci-step-passed`** — a CI run is green only when every step of its placement ran and passed: no skip, no subset
   - **asserts —** under `pnpm gate --ci`, `runGate` runs with `skipIsFailure`, so a step exiting the
     reserved `GATE_SKIP_EXIT_CODE` (3) is a FAIL carrying `REFUSED_SKIP_NOTE` after the step's own
     note, and `gateExitCode` is non-zero; an ordinary red carries no refusal note, a pass still
     passes, and a killed step stays NOT RUN; without `skipIsFailure` — the local gate — the same exit
     stays a SKIP; and `--ci` combined with `--only` or `--rerun-failed` is refused before any step
     runs, so the partial exit code `GATE_PARTIAL_EXIT_CODE` (4) can never reach a workflow.
   - **covers —** `RunGateInput.skipIsFailure`, `REFUSED_SKIP_NOTE` and `gateExitCode`
     (`packages/cli/src/gate-runner.ts`); the `--ci` flag in `gate-run.ts`, which sets
     `skipIsFailure` and refuses a partial selection.
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
