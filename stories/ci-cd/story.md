---
id: "ci-cd"
tier: story
title: "CI/CD — the one enforced pipeline every green unit crosses to reach trunk"
outcome: "Every contributor's green unit reaches trunk — and the surfaces that ride on trunk stay fresh — through one enforced pipeline; nothing reaches main unproven."
status: proposed
proof_mode: UAT
arc: story-green-monotonicity-arc
# ci-cd depends on the two sibling surfaces its post-merge side-effects WRITE TO (ADR-0058 §1, §3):
# deploy-on-merge needs studio-cloud's Cloud Run + IAP service as a deploy target, and
# merge-presence-retire needs notice-board's presence store as a write target — real OUTBOUND
# dependencies, so they roll up to depends_on. ci-cd is NOT a trunk: the "everything's delivery rides
# on this pipeline" reliance is a PROCESS-axis fact (how any unit reaches main), deliberately NOT
# drawn as inbound edges (it would make ci-cd a dependency of everything — noise, not signal), and
# ci-cd has zero inbound edges. Verified acyclic: studio-cloud (depends_on: [studio, library]) and
# notice-board (depends_on: [library, drive-machinery]) never reach back to ci-cd. (library is the
# genuine trunk — a root every story depends on.)
capabilities: [green-gate, repo-surface-manifest, adr-health-gate, auto-merge-on-green, merge-presence-retire, deploy-on-merge, ci-claim-corroborate]
# `gate-ci-parity` LEFT this story on 2026-08-31 for `stories/cli`, with its code — the same shape as
# `arc-explicit-id-fidelity`'s departure from `cli` under ADR-0369, and for a related reason. Its
# artefact was then a pure judge invoked by a `check:*` rung, a capability class `cli` already hosted
# three times (`organism-boundary-tooling`, `work-hierarchy-camp-fence`,
# `verification-decay-instruments`). ADR-0606 (2026-09-23) deleted that judge along with the second
# list it compared: CI's `verify` now runs `pnpm gate --ci` and names no check, and the capability is
# the gate program's CI mode itself — `packages/cli/src/gate*.ts`, so more plainly `cli`'s than ever.
# The line that decided it, and that this story keeps: **ci-cd owns the PIPELINE — that a step runs,
# that it blocks, that it sits on the merge ref, that `automerge` needs it. `cli` owns the PROGRAM a
# pipeline step invokes — which checks run, as whom, and what counts as green.** `check:boundaries`
# is the precedent already in the tree: a check CI runs (through `pnpm gate --ci` since ADR-0606),
# whose ANALYSER has always been a `cli` capability. What did NOT leave with it: UAT leg 3 and
# Reliability Gate 3, which assert the local/CI relationship as repository-owned evidence on this
# story's own journey — a story's UAT never had to mirror its capability list, and both ordinals are
# burned and carry signed history, so neither moves. `green-gate` did NOT follow it; see that file's
# frontmatter for why the same wall got the opposite answer.
depends_on: [studio-cloud, notice-board]
# ADR-0166 artifact edges: the deliberate NON-IMPORT seams among the depends_on above (build-artifact /
# write-target / hosted-seam consumption, narrated per-edge in the comments/body of this spec) — the
# declared-edge honesty gate accepts these without a code import; remove an entry if the seam ever
# becomes a real package import.
artifact_edges: [studio-cloud, notice-board]
# Deciding ADRs (ADR-0037 §2): the green gate + auto-merge (22), the repo-surface manifest gate's retirement (311),
# decision binding + adr-health (37), the ADR-number allocator (50), session presence the retire
# backstop serves (33), the display posture it heals (41), studio CD (46), keyless WIF auth (21),
# the dependency-direction / no-cycle model that fixed this story's edges (58), and the fourth
# harness-native generated agent view covered by check:agents — Gemini CLI (234), and the narrow CI
# corroboration of a live claim, whose broad form is refused on measurement (535).
decisions: [22, 311, 37, 50, 33, 41, 46, 21, 58, 234, 535]
---

# CI/CD — the one enforced pipeline every green unit crosses to reach trunk

**Outcome —** Every contributor's green unit reaches trunk — and the surfaces that ride on trunk
stay fresh — through one enforced pipeline; nothing reaches `main` unproven.

This is storytree's **delivery process**: the approval-gated path from a contributor's local green to
a landed, deployed `main`. It has no standalone deliverable a user opens, and every other story's
*landing* rides on it — but that universal reliance is a PROCESS-axis fact, not a dependency edge
(ADR-0058 §2): on the story DAG ci-cd is an ordinary consumer (it depends on the two sibling surfaces
its post-merge side-effects write to) with zero inbound edges, **not** a "trunk" root. (`library` is
the genuine trunk — a root every story depends on.) It is the work-tracked home for the
machinery that today lives in `.github/workflows/` (the `verify` + `automerge` jobs in
[`ci.yml`](../../.github/workflows/ci.yml), the deploy in
[`deploy-studio.yml`](../../.github/workflows/deploy-studio.yml)), the root-surface and ADR-number
gates in [`scripts/`](../../scripts), and the keyless CD infra in [`infra/`](../../infra). The
deciding ADRs are ADR-0022 (the green gate +
auto-merge-on-green, inside free Actions because GitHub-native auto-merge is paywalled on private
repos) and ADR-0046 (merge→deploy CD).

> **This story is the first WORK-TRACKED home for the merge-ceremony discipline** (green unit →
> non-draft PR → CI auto-merges; never a manual `gh pr merge`) — the `session-orchestrator` operating
> discipline the capabilities below mechanise.
>
> *(Rewritten 2026-08-31. This paragraph also claimed the **gate↔CI parity** invariant as this story's
> to home, and closed "`gate-ci-parity` may warrant [an ADR] — an owner escalation". Both halves are
> now false. The capability MOVED to [`stories/cli`](../cli/gate-ci-parity.md) with its code (see the
> frontmatter note above), and the escalation was answered: **ADR-0486** (accepted 2026-08-31) settles
> the parity contract, and the question was measured against `owner-fork-bar` and cleared none of its
> three tests. The paragraph also enumerated the delta as "a content floor of eight checks … and the
> local plan adds `check:verification-decay`" — measured false on 2026-08-31: the floor is 21 and the
> local-only set has THREE members. The counts are struck rather than restated, because ADR-0486 D4
> requires both sets be READ from their real definitions at runtime, never transcribed into prose that
> goes stale. The relationship was then `ci.yml` vs the `GATE_PLAN` literal, read by `cli`'s judge.)*
>
> *(Overtaken 2026-09-23 by ADR-0606, which supersedes ADR-0486. There is no second list any more: CI's
> `verify` runs `pnpm gate --ci` over the one gate plan, and where each step runs is its own `runs`
> placement — held by `cli`'s [`gate-ci-parity`](../cli/gate-ci-parity.md), whose comparison judge was
> deleted rather than ported. Since ADR-0606's second step there is no first list either: each check
> declares its placement in its own file, and the gate finds it there.)*

## Design floor

- **One pipeline, one direction.** A unit reaches `main` exactly one way: a non-draft PR whose
  `verify` job goes green, auto-merged by CI. There is no second door — no manual `gh pr merge`, no
  status-only check that a human can wave through. Every gate below sits ON that one path.
- **Prove against the FUTURE main, not the branch.** `verify` runs on the **merge of branch + main**
  (GitHub's PR merge ref), so a unit is proven against the trunk it will actually land on — a clean
  branch can still fail on something that landed on `main` *after* it was cut. This is the load-bearing
  reason a green local `pnpm gate` does not guarantee a green CI.
- **The gate and CI walk ONE plan, and each step's placement is the only difference in what they
  run.** Since ADR-0606 (2026-09-23, superseding ADR-0486's declared two-way delta) CI's `verify` job
  runs `pnpm gate --ci` and names no check. The plan both runs walk is FOUND, not kept: the gate's
  fixed legs plus every check it finds by file name, each declaring its own `runs` placement in the
  `/* gate-check` header its file opens with
  ([`packages/cli/src/gate-checks.ts`](../../packages/cli/src/gate-checks.ts), ADR-0606 D1). The
  local gate walks the steps placed `both` or `local`; CI walks those placed `both` or `ci`; and a
  step's `runs` placement is the only record of where it runs, so no step can be listed on one side
  while placed on the other. Both runs narrow their `-r` legs through the one affected-scope
  classifier (ADR-0304 D2) — the local run from its merge-base with `origin/main`, CI from the PR
  merge commit. What else separates them is pipeline plumbing only CI carries — the PR-only
  merged-branch guard, the pinned web submodule checkout, and the merge ref itself — and the merge ref
  is now DIAGNOSED where the reader is: the local gate warns, before and beside its verdict, whenever
  the branch is behind `origin/main` (ADR-0606 D5). Read the placements from `pnpm gate --list`,
  never from the root `gate` script's text, which is just the runner invocation and names zero steps.
  **The program is [`cli`'s `gate-ci-parity`](../cli/gate-ci-parity.md)**, not this story's: `ci-cd`
  owns that `verify` runs the gate as a required step on the merge ref, `cli` owns what the gate runs
  — the same split `check:boundaries` has always had. This story still walks the relationship at its
  own tier (UAT leg 3, Reliability Gate 3).
  *(Rewritten 2026-09-24 for ADR-0606, ADR-0139. This bullet described a TWO-WAY delta between two
  hand-kept lists — `ci.yml`'s `verify` steps and `GATE_PLAN` — both read at runtime by
  `gate-ci-parity`'s comparison judge, which ADR-0606 D4 deleted along with the second list. Its
  2026-08-31 correction had already struck an enumeration of "EIGHT checks" measured false that day.
  The membership is still deliberately NOT restated here, because a spec that enumerates gate steps
  goes false every time the gate is re-decided — the standing lesson open modeling call 3 below
  records.)* *(Corrected again the same day for ADR-0606's second step, which replaced the hand-kept
  plan with discovery: the rewrite said the local gate walks "the `GATE_PLAN` literal in
  `packages/cli/src/gate-order.ts`" and told the reader to read the placements "from `GATE_PLAN`".
  That literal is gone; each placement is now declared in its check's own file.)*
- **Auto-merge is a consequence of green, never a decision.** A non-draft, non-`hold` PR merges the
  instant `verify` passes. Draft / `hold` is the only opt-out, and it is temporary — flip to ready on
  green. Humans approve by making the PR ready, not by clicking merge.
- **Landing has side effects, and they fail soft.** A merge retires the merged session's presence row
  (the SessionEnd-miss backstop) and — when the merge touched the studio — redeploys the live site.
  Neither side effect can fail the merge: presence is advisory (ADR-0033) and deploy runs only on
  `push:main`, never as a PR check.
- **Keyless throughout.** Every privileged step (presence-retire, deploy) authenticates via Workload
  Identity Federation (ADR-0021) — GitHub OIDC → the `github-actions` WIF pool → a least-privilege
  service account. No JSON key sits in a secret.

## Capabilities (7)

Listed roots-first (a capability appears after everything it depends on). The first three are
independent roots (the three orthogonal content gates `verify` runs); `auto-merge-on-green` builds on
`green-gate`; the two post-merge leaves add side effects and each reaches forward to a sibling story;
`ci-claim-corroborate` is a **fourth independent root** — a CI writer whose trigger is a branch still
working rather than a merge, so it sits on no merge-side edge at all.

*(Was seven until 2026-08-31, when `gate-ci-parity` left for `stories/cli` with its code — see the
frontmatter note — and is seven again from 2026-09-08, when `ci-claim-corroborate` was authored for
ADR-0535 D2's narrow half. Row numbers here are positional and safe to renumber: nothing outside this
file cites a capability by row number, and the prose above names capabilities rather than positions.
This is the opposite of the open modeling calls below, whose numbers ARE cited from other files and
are therefore never reused or shifted.)*

| # | capability | outcome | status | depends on |
|---|---|---|---|---|
| 1 | [`green-gate`](green-gate.md) | A PR's `verify` job proves the merge of branch+main through every required repository and shared-environment check, including exact UAT revision continuity; a red anything blocks the merge. | proposed | — |
| 2 | [`repo-surface-manifest`](repo-surface-manifest.md) | `pnpm check:manifest` refuses any tracked root entry or loose doc not declared in the repo manifest's repo-surface allow-list (`repo-manifest/repo-surface/_domain.json`), so ad-hoc junk can't merge. | proposed | — |
| 3 | [`adr-health-gate`](adr-health-gate.md) | Decision-binding hygiene on the dev-repo path: atomic ADR-number allocation + the full adr-health suite (frontmatter, edges, supersede, story-decisions, green-flip, number-uniqueness) reddens a PR, plus a cross-open-PR collision check. | proposed | — |
| 4 | [`auto-merge-on-green`](auto-merge-on-green.md) | A non-draft, non-`hold` PR auto-merges the instant `verify` is green — never a manual merge. | proposed | `green-gate` |
| 5 | [`merge-presence-retire`](merge-presence-retire.md) | On merge, the merged session's presence row is authoritatively retired (the SessionEnd-miss backstop), keyless and fail-soft. | proposed | `auto-merge-on-green` |
| 6 | [`deploy-on-merge`](deploy-on-merge.md) | A studio-touching merge to `main` redeploys the live studio to Cloud Run — keyless WIF → Cloud Build image → `gcloud run deploy` with the full IAP posture. | proposed | `auto-merge-on-green` |
| 7 | [`ci-claim-corroborate`](ci-claim-corroborate.md) | A branch with a check running right now, or a very recent push, has its ledger claims corroborated live — keyless, monotonic, and never from an open pull request. | proposed | — |

*(Corrected in place 2026-09-15, ADR-0139: the `repo-surface-manifest` row named `repo-manifest.json`
as where root entries and loose docs are declared. That file no longer holds those declarations:
ADR-0556 split the repo manifest into fragment files read through one composer, and the allow-list now
lives in `repo-manifest/repo-surface/_domain.json`. The row still names `check:manifest`, which
ADR-0311 D2 retired from the gate and CI; open modeling call 5 below carries that question.)*

## Dependency graph

**Within-story** edges, read off the real pipeline (the `verify` → `automerge` job ordering in
`ci.yml` and the `push:main` trigger of `deploy-studio.yml`):

- `auto-merge-on-green` → `green-gate` — the `automerge` job declares `needs: verify`; it only runs
  after the gate is green.
- `merge-presence-retire` → `auto-merge-on-green` — the retire steps are part of the SAME `automerge`
  job, after its `gh pr merge` step; the merge IS the "work done" fact it acts on. *(Both bullets cited
  `ci.yml` by line number — `:96` and `:130-183` — until 2026-09-24. Neither number still pointed at
  what it named, so the steps are named instead.)*
- `deploy-on-merge` → `auto-merge-on-green` — the `automerge` job's LAST step DISPATCHES
  `deploy-studio.yml` (`gh workflow run … --ref main`) after a studio-affecting merge. *(Corrected
  2026-08-31: this read "`deploy-studio.yml` triggers on the `push:main` the auto-merge creates
  (subject to the GITHUB_TOKEN no-cascade note)". That inverted the edge — a `GITHUB_TOKEN` push
  never triggers `push:main`, so the cascade it named is precisely the thing that does NOT happen.
  ADR-0061 replaced it with the explicit dispatch, which is what actually makes this edge real.)*
- `ci-claim-corroborate` → **nothing** — and the absence is reasoned rather than unfinished. Both
  tempting edges are FALSE on the `cross-story-dependency` test run literally, both ways. It is not
  `auto-merge-on-green`'s consumer: `merge-presence-retire` depends on that capability because the
  MERGE is the fact it acts on, whereas this one acts on the opposite fact — a branch still working —
  and deliberately REFUSES the default branch, so a merge is the one event it must not read. It is
  not `green-gate`'s consumer either: it needs workflow RUNS TO EXIST as GitHub objects it can query,
  a repository fact, never green-gate's delivered outcome (that a red blocks the merge) consumed
  through green-gate's boundary — it stamps identically for a green run and a red one, because a red
  run is equally evidence someone is at the keyboard. That is the same reasoning that removed the
  `gate-ci-parity` → `green-gate` bullet below. Its relationship to `merge-presence-retire` is
  COORDINATION between two writers of one `heartbeat_at` column, not consumption: the
  `default-branch` fence exists so the two cannot contradict each other over one merge, and neither
  needs the other's outcome to pass its own proof.

*(A fourth bullet, `gate-ci-parity` → `green-gate`, was REMOVED on 2026-08-31 — and it did not merely
relocate to `stories/cli` with the capability, because the edge was FALSE. Run the
`cross-story-dependency` test literally, both ways: that unit needs the `verify` job to EXIST IN
`ci.yml`, a repository fact it reads with `node:fs` — never `green-gate`'s DELIVERED OUTCOME consumed
through `green-gate`'s boundary, which is what an edge asserts. None of its three contracts consumes
anything `green-gate` delivers; each derives its own answer at runtime and would pass or fail
identically whether or not `green-gate` is ever signed. The bullet's own wording gave it away — "parity
is defined relative to the `verify` job's invariant set" is a DEFINITIONAL relationship (shared
subject), which the DAG does not encode. False both ways, so no `consumed_by: [cli]` is owed here
either, and `ci-cd` keeps its zero inbound edges — the reasoning below is unchanged, not merely
still-passing. Re-run 2026-09-24 after ADR-0606, with the same answer on a stronger footing:
`gate-ci-parity` no longer reads `ci.yml` at all — it is now the gate program `verify` RUNS — and none
of its six contracts consumes anything `green-gate` delivers, while `green-gate`'s audit reads
`ci.yml` alone. The runtime reliance between them is named in each spec as a cross-story pointer,
never as an edge.)*

**Cross-story boundary (ADR-0010 §4; direction per ADR-0058 §1, §3) — ci-cd's two OUTBOUND dependencies:**
- `merge-presence-retire` depends on the **`presence-store`** capability of
  [`stories/notice-board`](../notice-board/story.md): the retire writer (`ingest-merge.ts`) marks the
  merged session's `events.session` row done through that story's presence store seam — it needs that
  seam delivered to do its job.
- `deploy-on-merge` depends on the **`cloud-run-iap`** capability of
  [`stories/studio-cloud`](../studio-cloud/story.md): the deploy targets the Cloud Run + IAP service
  that capability stands up — it needs that target delivered to do its job.
- `ci-claim-corroborate` depends on the same **claim-ledger** seam of
  [`stories/notice-board`](../notice-board/story.md) that `merge-presence-retire` writes through: it
  stamps `heartbeat_at` on `events.node_claim` rows via `PgClaimStore.stampBranchActivity` — the
  branch-keyed twin of the session-keyed `stampActivity` — so it needs that ledger delivered to do
  its job. No new story-level edge: `notice-board` is already in `depends_on`. *(This capability is
  the CI half of ADR-0535 D2; the local worktree-activity half is contract 5 of
  [`notice-board/ambient-integration`](../notice-board/ambient-integration.md), and the two are split
  by trigger and authority rather than by package — both write from `packages/notice-board`/
  `packages/drive` while only one of them is a workflow with a credential.)*

By the direction rule (ADR-0058 §1) ci-cd needs both siblings' delivered outcomes to pass its own UAT
(steps 5–6), so it **depends on** them, and §3 rolls those capability-level boundary edges up to the
story's `depends_on: [studio-cloud, notice-board]`. This is **acyclic**: studio-cloud
(`depends_on: [studio, library]`) and notice-board (`depends_on: [library, drive-machinery]`) never
reach back to `ci-cd`, which has **zero inbound** edges. The earlier `depends_on: []` was a modelling
error — it conflated the (correctly-omitted) *inbound* "everything lands through here" reliance, a
process-axis fact, with these two real *outbound* dependencies. Note that **freshness is ci-cd's
outcome, not studio-cloud's**; counting it in both is exactly what produced the false "symbiotic
cycle" ADR-0058 §1 dissolves.

## UAT Test Criteria

The adopted acceptance walkthrough keeps the surviving original positions and their semantic roles, but
binds each one to the exact standing seam that exists today. All are machine-observable:
none asks for an aesthetic or owner-value judgment, so none is labelled `human` merely because the
faithful live run would be expensive or external (ADR-0106 / ADR-0184). The commands below prove the
repository-owned mechanics and workflow posture. They do not pretend to audit GitHub branch-protection
settings or to perform a fresh Cloud Run rollout. *(This paragraph read "the original seven positions"
and "All seven" until 2026-08-21; leg 1 was deleted that day, so six remain and the list below starts
at 2 — a burned ordinal is never reused and no survivor is ever renumbered.)*

> **ADR-0294 D2 pass — 2026-08-21.** Two legs were examined against the discriminator D2 actually
> requires — *read the suite; the binding is not the proof* — and what the reading found was not
> duplication but a DEAD SUBJECT. Both `ci-cd#gate-1` and `ci-cd#gate-7` invoke
> `pnpm --filter @storytree/drive exec node --import tsx --test src/landing-deps.test.ts`, and **that
> file does not exist.** Measured on this tree: the command exits non-zero with
> `Could not find 'src/landing-deps.test.ts'`. It is not missing by accident —
> `apps/desktop/src/backend/landing-surface-retired.test.ts`, test `lsr-modules-deleted`, ASSERTS that
> `packages/drive/src/landing-deps.ts` and `packages/drive/src/landing-deps.test.ts` stay deleted,
> because ADR-0175
> retired the landing surface along with the interactive in-app orchestrator (ADR-0174). The census
> that scoped this pass reported `bound-but-gate-missing: 0`, and that stays true — every binding
> resolves to a DECLARED gate. What it did not check, and what this pass did, is whether the declared
> gate's COMMAND can run.
>
> - **Leg 1 ("Open non-draft") was DELETED, and its claim is WITHDRAWN rather than relocated.** It
>   exercised `runGate` / `openLandingPr` / `pollPrChecks` — the contributor-side landing dependency
>   composition — which ADR-0175 retired and which no longer exists in any package. There is no
>   lower-tier node to name because there is no subject left to prove: a criterion asserting the
>   behaviour of deleted code is satisfied by nothing and falsified by nothing. Its ordinal
>   `ci-cd#uat-1` is BURNED and recorded `superseded` in
>   [`stories/uat-legacy-dispositions.json`](../uat-legacy-dispositions.json). It carried `proven=–`
>   (no signed verdict) and no `(detail:)` pointer, so nothing was destroyed or orphaned. **Reliability
>   gate 1 STAYS** — gate ids are positional and deleting one silently re-points signed verdicts and
>   surviving bindings — and is now both unclaimed AND un-runnable; its entry below says so in place of
>   pretending otherwise.
> - **Leg 7 was NOT deleted — it was NARROWED to the half that is still true.** Its first clause
>   ("contributor-side landing code opens and observes a PR but cannot merge it") died with the same
>   retirement and was vacuous, not merely unproven. Its second clause — that the repository-owned
>   `gh pr merge` occurs EXACTLY ONCE and that occurrence is in `automerge`, downstream of `verify` —
>   is live, is asserted by gate 7's own inline audit, and is proven NOWHERE else: gate 4 checks that
>   the automerge seam CONTAINS `gh pr merge`, never that no SECOND merge door exists. Deleting the leg
>   would have deleted a live claim to reach a number, which ADR-0294 D5 forbids. Gate 7's dead first
>   half (the `landing-deps.test.ts` invocation) was removed from its command so the binding can
>   actually run; its ordinal, its criterion identity and the gate itself are untouched. **Making it
>   runnable immediately exposed a SECOND red the first was hiding** — the live half counted raw
>   substring occurrences of `gh pr merge` in `ci.yml` and found FOUR, three of them in comments
>   ABOUT the command. That is a defect in the assertion, not a finding about the workflow, and it
>   was fixed in the same change by stripping whole-line YAML comments before counting. Recorded
>   here because a short-circuiting `&&` is how a live assertion goes years without ever executing.
>
> **The other five legs were not D2 candidates and were not touched.** Legs 2, 3, 4 and 6 are bespoke
> inline `node --input-type=module -e` audits of `.github/workflows/ci.yml`,
> `.github/workflows/deploy-studio.yml` and the `GATE_PLAN` literal — repository-owned evidence no
> capability test asserts. Leg 5 is a compound command: a focused notice-board suite AND an inline
> workflow-wiring audit, so the capability rung proves only half of it. *(Corrected 2026-09-24: the
> `GATE_PLAN` literal is gone — ADR-0606 D1 replaced it with a plan the gate finds — so the gates
> of legs 2 and 3 now read that plan from the gate's own listing, `pnpm --silent gate --list --json`,
> rather than slicing a source file.)*

**Goal —** A contributor finishes a green, studio-affecting unit and hands it to the repository-owned
landing path; that path proves the merge candidate, lands only after green, clears
the branch's coordination claim, and dispatches the keyless Studio deployment. *(The goal read "…
that path opens a ready PR, proves the merge candidate …" until 2026-08-21. The repository no longer
owns any PR-OPENING code — ADR-0175 retired it — so that clause named a step this story cannot
witness. Opening the PR is now the session's own ceremony, not a repository seam.)*


2. **Prove the merge candidate.** _(witness: machine)_ _(proof-gate: ci-cd#gate-2)_ Audit the real _(criterion-id: uatc_012819fb72fb3003e1873509)_ _(revision-id: uatr1:81694e5a0f3e1e6b)_ _(previous-revision-id: uatr1:102ad02d7c173346)_
   `verify` job definition and the gate plan it runs. **Success —** PRs into `main` use checkout's
   merge candidate; the job keeps its merged-branch guard and runs the gate in CI mode
   (`pnpm gate --ci`) as one step, which publishes its conservative affected-or-full scope; the gate
   plan places the manifest, boundary, generated-view and web checks, the typecheck and test legs,
   and the unconditional Studio build on the CI side; and `automerge` still declares `needs: verify`.
3. **The local/CI delta is explicit.** _(witness: machine)_ _(proof-gate: ci-cd#gate-3)_ Read the gate plan _(criterion-id: uatc_0f5aacd3f9ee77943bbae299)_ _(revision-id: uatr1:4c85ca4ec6a7062a)_ _(previous-revision-id: uatr1:c4fdfe0078bbbad1)_
   that the root `gate` script and the real `verify` definition both run. **Success —** both run the
   one plan, and `verify` names no check of its own; every plan step declares where it runs; the
   shared blocking floor is placed on both sides; CI adds the Studio build and the Studio UAT journey,
   each placed CI-only, plus the workflow plumbing only it carries — the PR-only merged-branch guard,
   merge-candidate checkout, web checkout, and the affected-or-full scope its gate step publishes;
   and the local gate adds its live/advisory health tails and the desktop route-coverage check, each
   placed local-only. This is the honest current relationship, not the obsolete claims that build is
   the only difference or that two separately kept lists must agree.
4. **Auto-merge on green.** _(witness: machine)_ _(proof-gate: ci-cd#gate-4)_ Audit the real _(criterion-id: uatc_68ad91538c34aa3b6d77347d)_ _(revision-id: uatr1:e503bbee33db19bc)_
   `automerge` job. **Success —** it needs `verify`, admits only a pull request that is non-draft and
   lacks `hold`, and its sole merge command uses `--merge --delete-branch`, preserving ancestry.
5. **Merged coordination claims retire.** _(witness: machine)_ _(proof-gate: ci-cd#gate-5)_ Drive _(criterion-id: uatc_97ca2fdf0d8a83081b3f6cbf)_ _(revision-id: uatr1:333f88e67365ba72)_
   the branch-claim release seam and audit its workflow wiring. **Success —** the full merged branch
   name reaches `releaseClaimsByBranch`; zero claims are a clean no-op; store failure is swallowed;
   and the keyless WIF/install/writer steps remain `continue-on-error`. This is the current
   notice-board ledger boundary after `events.session` presence retired under ADR-0200.
6. **The Studio deployment handoff is complete.** _(witness: machine)_ _(criterion-id: uatc_321b38ce5a608bd7f1a19307)_ _(revision-id: uatr1:b2e22376de7cd044)_
   _(proof-gate: ci-cd#gate-6)_ Audit both workflow definitions. **Success —** the automerge job
   loudly dispatches `deploy-studio.yml` on `main` for the declared Studio-affecting path set, and the
   deploy workflow retains keyless WIF, Cloud Build with a short-SHA tag, the full runtime-SA/IAP/env
   posture, serialized rollouts, and the newest-created-equals-newest-ready smoke assertion.
7. **The repository-owned path has no unproven merge door.** _(witness: machine)_ _(criterion-id: uatc_411c12c77343632e71b22770)_ _(revision-id: uatr1:c73722a2587b8c0e)_ _(previous-revision-id: uatr1:a18801a48f50864c)_
   _(proof-gate: ci-cd#gate-7)_ Audit the workflow's only merge command. **Success —** the
   repository-owned `gh pr merge` occurrence count in `.github/workflows/ci.yml` is EXACTLY ONE, that
   one is in `automerge`, and `automerge` still declares `needs: verify` — so no second merge door can
   be added anywhere in the repository-owned path without failing this leg. This proves the in-repo
   rail; GitHub administrator settings remain an external operational control, not a fact this
   repository can honestly attest.

## Reliability Gates

1. **~~The ready-PR landing seam is green~~ — RETIRED IN PLACE, kept only so no later gate is renumbered**
   _(gate: observe)_ _(retired)_
   `pnpm --filter @storytree/drive exec node --import tsx --test src/landing-deps.test.ts`.
   **This gate is RETIRED (ADR-0436) — it holds its ordinal and stands as NO obligation.** Measured
   2026-08-21: the command exits non-zero with `Could not find 'src/landing-deps.test.ts'`, because
   ADR-0175
   retired the contributor-side landing surface with the interactive in-app orchestrator (ADR-0174) and
   `apps/desktop/src/backend/landing-surface-retired.test.ts` (`lsr-modules-deleted`) now ASSERTS that
   `packages/drive/src/landing-deps.ts` and `landing-deps.test.ts` stay deleted. Its criterion (story
   UAT leg 1) was deleted on 2026-08-21 under ADR-0294 D2 as a withdrawn claim. The gate is left in
   place — and its dead command left un-repaired — for one reason only: `reliabilityGateId` mints
   `<story>#gate-<n>` from POSITION, so removing it would renumber gates 2–7 and silently re-point
   every already-signed verdict and every surviving `(proof-gate:)` binding onto a different gate,
   with nothing reporting the change. *(It previously read "DEAD COMMAND" and carried no `(retired)`
   tag — that predated the marker; corrected in place per ADR-0139 when
   `auditGateCommandFileRefs` (ADR-0436 Consequences) landed and reported it as an unrunnable LIVE
   gate. The retention reasoning is unchanged; what was wrong was leaving it counted as a live
   own-proof obligation this story's crown could never satisfy — the same permanent-false-negative
   shape ADR-0436 named and fixed for `desktop#gate-6` and `terminal-tabs#gate-1`/`#gate-3`. The
   `(retired)` tag above is what takes it out of that union while the ordinal stays burned.)*
   *(It previously read "This dedicated integration file proves the independent surfaces: real gate
   exit-code mapping; the PR-opening call's internal commit → push → non-draft PR sequence and
   fail-closed step exits; PR URL parsing; and non-blocking `verify` rollup classification." Every
   one of those surfaces is gone.)* **Do not mint a replacement gate here** (ADR-0097 §2): if the
   repository ever grows a new repository-owned landing seam, that seam earns proof at its own
   capability first.
2. **The verify workflow keeps its hard merge-candidate floor** _(gate: observe)_
   `node --input-type=module -e "import fs from 'node:fs';import {execSync} from 'node:child_process';const plan=JSON.parse(execSync('pnpm --silent gate --list --json',{encoding:'utf8'}));if(!Array.isArray(plan.steps)||plan.steps.length===0)throw new Error('pnpm gate --list --json listed no plan steps');const runs={};for(const s of plan.steps)runs[s.check===null?s.command.split(' ').filter(t=>!t.startsWith('--')).join(' '):s.check]=s.runs;const c=fs.readFileSync('.github/workflows/ci.yml','utf8');for(const s of ['pull_request:','branches: [main]','uses: actions/checkout@v6','Merged-branch guard (a branch dies on merge)','run: pnpm gate --ci','steps.gate.outputs.mode','needs: verify'])if(!c.includes(s))throw new Error('missing verify seam: '+s);for(const s of ['check:manifest-fragments','check:boundaries','check:mirror-conformance','check:web-grounding','check:web-engine','check:guidance','check:agents','pnpm -r typecheck','pnpm -r test','pnpm -r build'])if(runs[s]!=='both'&&runs[s]!=='ci')throw new Error('verify no longer runs '+s+' (placed '+runs[s]+')')"`.
   The command reads the landed workflow AND the gate plan that workflow now runs, and fails on the
   removal of any named standing seam. Since ADR-0606 D3 the `verify` job names no check: it runs
   `pnpm gate --ci`, which walks every step of the gate's plan placed `both` or `ci` — and since
   ADR-0606 D1 that plan is FOUND rather than kept: each check is a file that declares its own
   placement at its top, and the gate finds it by name
   ([`packages/cli/src/gate-checks.ts`](../../packages/cli/src/gate-checks.ts)). So each named check
   is asserted where it now lives — as a plan step placed on the CI side — and the workflow is held
   only to what it still carries itself: the `pull_request` → `main` trigger, the merge-candidate
   checkout, the merged-branch guard, the one gate step, the affected-or-full `mode` that step
   publishes, and `needs: verify`. The plan is read FROM THE GATE, as gate 3 reads it:
   `pnpm --silent gate --list --json` prints the same found-and-ordered plan `pnpm gate` and
   `pnpm gate --ci` walk, and the command keys each check by its name (`check:boundaries`) and each
   fixed leg by its command with its long flags stripped, so `pnpm -r --no-bail test` still matches
   the declared `pnpm -r test`. It fails CLOSED rather than passing on nothing: a plan the gate refuses
   to assemble makes the listing exit non-zero, and an empty or unparseable listing throws. The named
   checks are a FLOOR, not the complete list CI runs — read that from `pnpm gate --list`.
   `check:manifest-fragments` (ADR-0556 D4) is the manifest check the criterion names; it replaces
   the `check:manifest` and `check:web-experience` this list dropped when ADR-0311 D2 retired them,
   because a seam-presence gate that names a retired rung reds on the retirement itself rather than on
   drift.
   *(Repaired in place again 2026-09-24, ADR-0139, for ADR-0606 D1 — the criterion and every
   assertion are unchanged. The command it replaced sliced the `export const GATE_PLAN` literal out of
   `packages/cli/src/gate-order.ts` as text. `gate-checks-found-like-tests-arc` inc-03 deleted that
   literal — every check is now found from its own file — so that command failed CLOSED on
   `GATE_PLAN literal not found`, which is the failure it was built to have. It now asks the gate for
   its plan instead of parsing the file that used to hold it, so a later change to HOW the plan is
   assembled cannot strand it the same way. The listing labels a check by its name, so the named
   floor reads `check:<name>` where the literal read `pnpm check:<name>`.)*
   *(Repaired in place 2026-09-24, ADR-0139, for ADR-0606 — the criterion is unchanged. The previous
   command searched `ci.yml` for `run: pnpm check:boundaries`, `run: pnpm check:mirror-conformance`,
   `run: pnpm check:web-grounding`, `run: pnpm check:web-engine`, `Affected scope (PRs only)`,
   `- name: Typecheck`, `- name: Test`, `run: pnpm -r build`, `run: pnpm check:guidance` and
   `run: pnpm check:agents`. ADR-0606 D3 moved every one of those out of the workflow and into the
   plan, so that command would have gone red having found nothing wrong.)*
   *(Corrected in place 2026-08-23, same rule: `'ADR number collision (open PRs)'` left this list —
   and gate 3's CI-only delta list — because **ADR-0403 dec 1 deleted the step**. Decisions are
   Postgres rows now, so there is no `docs/decisions/**` for two open PRs to collide on; `ci.yml`'s
   own comment records the deletion at the spot the step stood. Both gates were RED on this string
   and NOBODY SAW IT: until ADR-0421 the spine could not execute a `node -e "…"` command at all, so
   the gate had never once been observed either way.)*
3. **The current local/CI relationship is declared** _(gate: observe)_
   `node --input-type=module -e "import fs from 'node:fs';import {execSync} from 'node:child_process';const plan=execSync('pnpm --silent gate --list --json',{encoding:'utf8'});const steps=JSON.parse(plan).steps;if(!Array.isArray(steps)||steps.length===0)throw new Error('pnpm gate --list --json listed no plan steps');const runs={};for(const s of steps){const key=s.check===null?s.command.split(' ').filter(t=>!t.startsWith('--')).join(' '):s.check;if(s.runs!=='both'&&s.runs!=='local'&&s.runs!=='ci')throw new Error('plan step with no valid placement: '+key+' ('+s.runs+')');runs[key]=s.runs}if(!String(JSON.parse(fs.readFileSync('package.json','utf8')).scripts.gate).includes('gate-run.ts'))throw new Error('the root gate script no longer runs gate-run.ts, so pnpm gate no longer walks the plan');const c=fs.readFileSync('.github/workflows/ci.yml','utf8');if(!c.includes('run: pnpm gate --ci'))throw new Error('verify no longer runs pnpm gate --ci, so CI no longer walks the plan');if(c.split(String.fromCharCode(10)).some(l=>!l.trim().startsWith('#')&&l.includes('pnpm check:')))throw new Error('verify names a check of its own again, so the plan is no longer the one list');for(const s of ['check:boundaries','check:mirror-conformance','check:web-grounding','check:web-engine','check:guidance','check:agents','pnpm -r typecheck','pnpm -r test'])if(runs[s]!=='both')throw new Error('shared floor drifted: '+s+' is placed '+runs[s]);if(runs['pnpm -r build']!=='ci')throw new Error('CI-only delta drifted: pnpm -r build is placed '+runs['pnpm -r build']);if(runs['pnpm studio uat']!=='ci')throw new Error('CI-only delta drifted: pnpm --filter studio uat is placed '+runs['pnpm studio uat']);for(const s of ['Merged-branch guard (a branch dies on merge)','uses: actions/checkout@v6','Check out the pinned web submodule','steps.gate.outputs.mode'])if(!c.includes(s)||plan.includes(s))throw new Error('CI-only plumbing drifted: '+s);for(const s of ['check:verification-decay','check:definition-adjudication','check:desktop-route-coverage'])if(runs[s]!=='local')throw new Error('local-only delta drifted: '+s+' is placed '+runs[s])"`.
   Since ADR-0606 the relationship is declared in ONE place per step — its own `runs` placement: a
   fixed leg's in `BUILT_IN_LEGS` (`packages/cli/src/gate-order.ts`), and a check's in the
   `/* gate-check` declaration its own file opens with (ADR-0606 D1) — and this reads every one of
   them where the gate itself assembles them, from `pnpm --silent gate --list --json`. It asserts that
   both runs walk that one plan: the root `gate` script still invokes the runner, and `verify` still
   runs `pnpm gate --ci` and names no check of its own (a comment may mention one; a step may not).
   Then the relationship itself, each direction asserted where it now lives: the shared floor is
   placed `both`; the studio build and the studio UAT journey are each placed `ci`, and the PR-only
   merged-branch guard, the merge-candidate checkout, the pinned web checkout and the
   affected-or-full `mode` the gate step publishes are present in the workflow and absent from the
   plan, because only CI carries them; the live/advisory health tails — `check:verification-decay`
   (`local` by ADR-0252 D3) and `check:definition-adjudication` — are placed `local`, and so is
   `check:desktop-route-coverage`, the desktop route-coverage check, which is not a health tail;
   and every plan step carries one of the three
   placements. It reads the real step list from the gate's own listing — **never** from
   `package.json`'s `gate` script, which since 2026-08-04 is just the runner invocation and names
   zero steps, so a step search against its text passes vacuously; the script is read only to confirm
   it still invokes `gate-run.ts`. The listing reports the retired checks in their own `retired` array,
   apart from the steps, so a retired rung can never be keyed as a live step. Each check is keyed by
   its name and each fixed leg by its command with long flags stripped, so `pnpm -r --no-bail test`
   matches the declared `pnpm -r test` — and the studio journey keys as `pnpm studio uat`, because
   only its `--filter` flag is stripped and the package it names stays. It fails CLOSED: a plan the
   gate refuses to assemble makes the listing exit non-zero, and an empty or unparseable listing
   throws.
   *(Extended 2026-09-24 for `gate-checks-found-like-tests-arc` inc-04 — two added assertions, not a
   repair. PR #2046 made the studio's UAT journey a fixed leg of the plan, placed `ci` beside the
   studio build, and criterion 3 was re-worded in the same pass to name it among CI's additions and
   to name the desktop route-coverage check among the local run's — a `local` step the earlier
   wording and this command both omitted. So the command also asserts that the journey is placed
   `ci` and that check is placed `local`; without them the criterion would claim a delta its bound
   gate never observed. Checked both ways on this tree: the extracted command exits 0, and a copy
   run against a listing with either step placed `both` exits 1 on that step's drift message, where
   the command before this change exited 0 on both listings.)*
   *(Repaired in place again 2026-09-24, ADR-0139, for ADR-0606 D1/D6 — the criterion and every
   assertion are unchanged. The command it replaced sliced the `export const GATE_PLAN` literal out of
   `packages/cli/src/gate-order.ts` as text, and failed CLOSED on `GATE_PLAN literal not found` once
   `gate-checks-found-like-tests-arc` inc-03 replaced that literal with discovery. Slicing was also
   what kept a retired rung — then declared in a central map in the same file — from being read as
   part of the plan; the listing makes that unnecessary, since each retired check now says so in its
   own file (D6) and is reported apart from the steps. The listing labels a check by its name,
   so the floor and the local-only pair read `check:<name>` where the literal read
   `pnpm check:<name>`.)*
   *(Repaired in place 2026-09-24, ADR-0139, for ADR-0606 — the criterion is unchanged — and the gate
   was ALREADY RED. The previous command compared two hand-kept lists: shared checks present in both
   `GATE_PLAN` and `ci.yml`, the CI-only items present in `ci.yml` and absent from the plan, and
   `check:verification-decay` present in the plan and absent from CI. It had been red since PR #2038
   (increment 1 of `gate-checks-found-like-tests-arc`), which added `pnpm -r build` to `GATE_PLAN` as
   a `runs: "ci"` step. `plan.includes('pnpm -r build')` then became true and the command exited 1
   with `CI-only delta drifted: pnpm -r build`. Nothing runs a story's observe gate automatically, so
   nobody saw it — and ADR-0606 D3 was about to empty the other list it compared against.)*
   *(Corrected in place 2026-08-21, ADR-0139. This gate was RED on `main` and had been since
   ADR-0276 increment 4. It asserted the literals `pnpm -r typecheck` / `pnpm -r test` against the
   `GATE_PLAN` literal, which now declares `pnpm -r --no-bail typecheck` / `pnpm -r --no-bail test`,
   so `plan.includes(…)` was false and the command exited 1 with `shared expensive leg missing from
   GATE_PLAN: pnpm -r typecheck` — exactly the drift-on-its-own-flags failure gate 2's prose above
   warns about. The two literals are KEPT as the declared floor; the plan text is now normalised
   through `planN` (long flags stripped) before they are matched, so adding or removing a flag on a
   shared leg no longer reds a gate that is about WHICH legs are shared, not how they are invoked.
   Verified red-then-green by extracting this exact command from the story and running it: exit 1 on
   `origin/main`, exit 0 here.)*
4. **The green-only non-squash automerge rail is present** _(gate: observe)_
   `node --input-type=module -e "import fs from 'node:fs';const c=fs.readFileSync('.github/workflows/ci.yml','utf8');for(const s of ['automerge:','needs: verify','github.event.pull_request.draft == false','!contains(github.event.pull_request.labels.*.name','hold','gh pr merge','--merge','--delete-branch'])if(!c.includes(s))throw new Error('automerge seam drifted: '+s)"`.
   The audit is structural and deterministic; it does not claim to create a live PR.
5. **Merged branch claims release fail-soft** _(gate: observe)_
   `pnpm --filter @storytree/notice-board exec node --import tsx --test src/store/ingest-merge.test.ts && node --input-type=module -e "import fs from 'node:fs';const c=fs.readFileSync('.github/workflows/ci.yml','utf8');for(const s of ['Authenticate to GCP (keyless WIF','continue-on-error: true','STORYTREE_MERGED_HEAD_REF','pnpm --filter @storytree/notice-board exec tsx src/store/ingest-merge.ts'])if(!c.includes(s))throw new Error('claim-retire wiring drifted: '+s)"`.
   The focused suite proves the writer's release/no-op/swallow boundaries; the audit pins the
   repository-owned keyless fail-soft composition around it.
6. **The dispatch and keyless deploy posture are present** _(gate: observe)_
   `node --input-type=module -e "import fs from 'node:fs';const c=fs.readFileSync('.github/workflows/ci.yml','utf8'),d=fs.readFileSync('.github/workflows/deploy-studio.yml','utf8');for(const s of ['actions: write','gh workflow run deploy-studio.yml --ref main','apps/studio/','packages/','docs/','stories/'])if(!c.includes(s))throw new Error('deploy dispatch drifted: '+s);for(const s of ['workflow_dispatch:','cancel-in-progress: false','google-github-actions/auth@v3','storytree-studio-deployer@','gcloud builds submit','git rev-parse --short HEAD','gcloud run deploy','--service-account','--set-env-vars','--no-allow-unauthenticated --iap','latestReadyRevisionName','latestCreatedRevisionName'])if(!d.includes(s))throw new Error('deploy posture drifted: '+s)"`.
   This is a standing workflow/posture proof, not a fabricated fresh deployment.
7. **Only verified CI owns the merge command** _(gate: observe)_
   `node --input-type=module -e "import fs from 'node:fs';const code=fs.readFileSync('.github/workflows/ci.yml','utf8').replace(/^[^\n\S]*#.*$/gm,'');if((code.match(/gh pr merge/g)||[]).length!==1)throw new Error('repository-owned merge-command count drifted');if(!code.includes('needs: verify'))throw new Error('automerge lost verify dependency')"`.
   This deliberately proves only the repository-owned path; external branch-policy configuration is
   a residual live control. **The command was REPAIRED TWICE on 2026-08-21, and the second repair
   uncovered a red that the first was hiding.**
   (1) It opened
   `pnpm --filter @storytree/drive exec node --import tsx --test src/landing-deps.test.ts && …`, and
   that file has not existed since ADR-0175 retired the landing surface, so the whole gate exited
   non-zero on `Could not find 'src/landing-deps.test.ts'` before its live half ever ran.
   (2) With the dead half removed, the live half went RED on its first honest execution: the raw
   substring count of `gh pr merge` in `ci.yml` is **four**, not one — line 316 is the real command,
   and lines 34, 303 and 325 are COMMENTS discussing it. The assertion was counting prose. It now
   strips whole-line YAML comments before counting, the same move
   `apps/desktop/src/backend/landing-surface-retired.test.ts` already makes with its `code()` helper
   for exactly this reason ("a PROSE mention … never counts as live wiring"). Verified on this tree:
   4 raw occurrences, 1 after stripping, and `needs: verify` still present. The CLAIM is unchanged —
   exactly one repository-owned merge command, in `automerge`, downstream of `verify`. Both are
   REPAIRS of a binding that could not honestly run, not a new gate (ADR-0097 §2): the gate's
   ordinal, its kind and its criterion are untouched.

## Open modeling calls (for the owner)

Surfaced rather than guessed — plain files, cheap to revise.

1. **~~`gate-ci-parity` has no deciding ADR (escalation)~~ — CLOSED 2026-08-31, and the capability has
   since LEFT this story.** Struck in place, never deleted or renumbered: this list's numbers are
   cited from other files, so a closed item stands where it is or every later number shifts under its
   citers.

   **What it asked.** Whether the parity invariant — *what the local gate is contractually allowed to
   differ from CI by* — deserved its own ADR, or should stay a capability-level contract. It was
   flagged for the owner because the authoring role could not allocate a number.

   **How it was answered — on BOTH halves.** (i) The ADR exists: **ADR-0486**, accepted 2026-08-31,
   settles the contract (one declared two-way delta; the permitted delta classes closed at three;
   every member asserted both ways; both sides read from their real definitions at runtime; a SKIP is
   not an absence). (ii) It was NOT an owner escalation and should not have been raised as one —
   measured against `owner-fork-bar` the question clears none of its three tests (reversible,
   internal, a pure engineering tradeoff), and ADR-0304 D2 had already settled the direction by
   requiring the gate and CI to share one affected-scope classifier. The escalation is WITHDRAWN, not
   merely answered. (iii) The capability itself moved to [`stories/cli`](../cli/gate-ci-parity.md) on
   2026-08-31 with its code — so this story's `decisions:` does NOT acquire 486; the capability
   carries it. See the frontmatter note for the merits.
   *(Superseded 2026-09-23, and the item stays closed: ADR-0606 replaced ADR-0486 and deleted the
   second list the delta related, so the contract settled here no longer exists. The capability
   now carries ADR-0606 in place of 486.)*
2. **RESOLVED (owner, 2026-06-15 — ADR-0058).**
   The earlier "trunk with two forward leaf edges" framing was a modelling error. By the
   dependency-direction rule (ADR-0058 §1) ci-cd needs both sibling surfaces delivered to pass its own
   UAT, so it **depends on** them — `depends_on` is now `[studio-cloud, notice-board]`, and ci-cd is
   the delivery *process*, not a trunk (its "everything rides on it" universality is a process axis
   the DAG does not encode, §2). The owner kept deploy + retire IN ci-cd (Model A — one cohesive
   pipeline) rather than re-homing them to the targets; the apparent ci-cd↔studio-cloud cycle was an
   artifact of double-counting "stay fresh," which is ci-cd's outcome alone (§1). Verified acyclic
   globally.
3. **`green-gate`'s invariant set moves, and this entry has now been wrong in BOTH directions.** It
   once read "there are now THREE generated-view/surface gates, not the two the scope brief named" —
   counting `check:manifest` + `check:guidance` + `check:agents`. That is stale: ADR-0311 D2 retired
   `check:manifest` outright (it is no longer a root script, a gate step or a `verify` step, and its
   script has since been deleted, so no file is left to carry a `retired:` declaration and the gate's
   retired list does not name it — ADR-0311 D2 is its record), leaving **TWO** generated-view gates —
   `check:guidance`
   (ADRs 0051/0291: the canonical `session-orchestrator` rendered to root CLAUDE.md + AGENTS.md) and
   `check:agents` (ADRs 0052/0178/0234: the same delegatable Library population rendered to
   specialist `.claude/agents`, `.cursor/agents`, `.codex/agents`, Gemini CLI's native
   `.gemini/agents`, and OpenCode's `.opencode/agent`). Since ADR-0606 the `verify` job names no check
   at all: its content set is the gate plan's CI placement (the plan's steps placed `both` or `ci`,
   which `pnpm gate --list` prints), and `green-gate` lists none of it.
   The Gemini view inherits its parent Gemini CLI session's model/tools; this projection makes no
   Antigravity compatibility claim. **The standing lesson, not the count:** a spec that enumerates
   gate steps goes false every time the gate is re-decided, so `green-gate` points at the gate plan
   as the live list and contracts the INVARIANTS — `verify` runs the gate in CI mode as a required
   step, and no step is soft — rather than the membership. *(Corrected in place 2026-09-24 for
   ADR-0606: this said the `verify` job's content set was "the NINE listed in `green-gate`", and that
   `green-gate` pointed at `ci.yml` as the live list. The workflow now names no check, and
   `green-gate` enumerates none. Corrected again the same day for ADR-0606's second step: this item
   located the retired `check:manifest` in the central `RETIRED_CHECKS` map and the CI content set in
   the `GATE_PLAN` literal, both of which that step deleted.)*
4. **Status stays `proposed` (greenfield, like notice-board).** This machinery is live and working,
   but it has never been driven through storytree's own prove-it-gate red→green, and per ADR-0031
   authored status is a projection of signed verdicts, not of "it works in prod." Confirm `proposed`
   for the whole story (the honest call) rather than `mapped` — the CI workflows have no offline
   `node:test` suite the way the library tier does, so even `mapped` would over-claim.
5. **`repo-surface-manifest` describes a capability that no longer exists (escalation).** Verified
   on the bytes: `check:manifest` is retired by ADR-0311 D2 — it is not a step of the gate's plan or
   of `ci.yml`'s `verify` job, it is not a script in the root `package.json`, and, its script deleted
   (see the note below), it has no file left to carry a `retired:` declaration, so even the gate's
   retired list does not name it (ADR-0606 D6). The capability's whole outcome ("`pnpm check:manifest` refuses any tracked root entry or loose doc not
   declared in the repo manifest's repo-surface allow-list") is therefore a claim about a gate that
   does not run. One partial survival complicates the obvious answer, which is why this is surfaced
   rather than guessed: the allow-list itself, which lives in
   [`repo-manifest/repo-surface/_domain.json`](../../repo-manifest/repo-surface/_domain.json). Its
   `root` section has a **second, live** role: `storytree write-authority install --write` reads it
   through the manifest composer in
   [`packages/drive/src/manifest-fragments.ts`](../../packages/drive/src/manifest-fragments.ts) and
   derives from it the write-authority deny block, which makes the primary checkout read-only to
   Claude Code's file-editing tools (ADR-0255, with its scope set by ADR-0284). So the allow-list's
   DATA is load-bearing even though the GATE is not. **Call:** retire the capability, re-scope it to
   the surviving write-authority role (which is arguably a different story's organ), or re-wire the
   gate under ADR-0311 D5's fresh-evidence bar. Re-wiring would now mean writing a new check that
   reads the allow-list through that composer, because there is no script left to re-wire: ADR-0311
   D5 kept re-adding a retired check cheap by keeping its source, and this check's source is gone.
   The call is still open: ADR-0443 (only undertaken capabilities gate a story's green) and ADR-0465
   (long-running unproven capabilities are adopted on the owner's risk acceptance, not proven) both
   list this capability as awaiting it. Retiring or re-scoping a capability is a structural call I do
   not make unilaterally; I left the file untouched, and its 2026-09-15 correction changed only the
   paths it names and added notes marking the sentences that still name the deleted script — not its
   claim, status or contracts.

   *(Corrected in place 2026-09-15, ADR-0139: this item said `scripts/check-manifest.mjs` and
   `repo-manifest.json` both survived on disk, and called `repo-manifest.json` load-bearing as "the
   ownership map" the deny block derives from. On this branch the script is deleted, since nothing had
   run it after ADR-0311 D2 retired `check:manifest` from the gate and CI. Under ADR-0556, which split
   the repo manifest into fragment files read through one composer, every section left
   `repo-manifest.json`, and the file itself left Git in `repo-manifest-aggregate-leaves-git`.
   What the deny block derives from is the allow-list's `root` section, not the ownership map.
   The call itself is unchanged and still not made.)*
6. **RESOLVED (owner-directed, 2026-08-07).** `gate-ci-parity`'s contract 1 —
   `declared-content-delta-is-exactly-build` — asserted that the local gate's content-check set
   equals the CI `verify` set minus `pnpm -r build`, "the single declared constant `{pnpm -r build}`
   — nothing else." Verified false: the delta is **two-way**. CI-only are `pnpm -r build`, the two
   PR-only merged-branch guard, the pinned web-submodule checkout and
   affected-scope selection; local-only is `check:verification-decay`. Established in PR #1204 (main
   `fc4c0246`) and re-verified against the `GATE_PLAN` literal in
   [`packages/cli/src/gate-order.ts`](../../packages/cli/src/gate-order.ts) and the `verify` job in
   [`ci.yml`](../../.github/workflows/ci.yml). **Decided:** re-state it as ONE two-way contract,
   renamed `declared-content-delta-is-two-way` — **not** split one contract per direction. The
   reason worth recording: both directions are read from the SAME two sources in a single pass, so
   one isolated test proves the whole relationship, and Reliability Gate leg 3 above already asserts
   both directions in one command — one contract mirrors the proof shape that exists. The
   capability's title, frontmatter `outcome`, body Outcome paragraph and contract 2's caveat clause
   were brought into line, as was its row in the capabilities table above; the capability stays at
   three contracts.

   *(Two pointers repaired 2026-08-31, the resolution itself unchanged. The capability MOVED to
   [`stories/cli`](../cli/gate-ci-parity.md), so this item is history about a unit another story now
   owns — kept here because the decision was made here and the number is cited. And "row 4 of the
   capabilities table above" was re-worded to name the capability instead: row 4 is now
   `auto-merge-on-green`, so the positional reference had silently re-pointed. Reliability Gate 3 and
   UAT leg 3 are unaffected — both stayed with this story.)*

   *(Overtaken 2026-09-24 by ADR-0606, and the resolution stands as history. The contract it renamed,
   `declared-content-delta-is-two-way`, was retired with the two-list comparison it asserted, and
   Reliability Gate 3 no longer asserts "both directions" of a delta between two lists: it asserts the
   placements of the one plan both runs now walk.)*
