---
id: "green-gate"
tier: capability
story: ci-cd
title: "The green gate — verify proves a PR against the merge of branch and main"
outcome: "A PR's verify job proves the merge of branch+main through every required repository and shared-environment check, including exact UAT revision continuity; a red anything blocks the merge."
status: proposed
proof_mode: integration-test
depends_on: []
arc: story-green-monotonicity-arc
decisions: [560, 606]
# ⚠ THE PROOF IS DELIBERATELY SPLIT, NOT STRETCHED — this unit's own proof-scoping call, recorded
# 2026-08-31. (It used to cite ADR-0486, which never decided it and is now superseded by ADR-0606.)
# Contracts 2 to 5 are static text audits over the real `.github/workflows/ci.yml` and are fully
# assertable offline. Contract 1 is MIXED: its repo-owned half — that the `verify` checkout does not
# OVERRIDE actions/checkout's pull_request merge-ref default — is assertable and is what can actually
# regress in this repo; its platform half — that GitHub genuinely produces a correct merge commit — is
# PLATFORM TRUST and is EXCLUDED from this unit's verdict rather than folded into it. Stretching one
# proof to cover the platform half is how a sliver of unverifiable behaviour ends up inside a signed
# green.
#
# SINCE ADR-0606 (accepted 2026-09-23) `verify` NAMES NO CHECK. It prepares the environment, signs in
# to the two keyless identities, and runs ONE step, `pnpm gate --ci`, which walks every check the gate
# plan places on the CI side. So the proof is split a second way, along the line this story has always
# drawn: this unit asserts the PIPELINE — that `verify` runs the gate in CI mode as its one required
# content step, names no check itself, and hands the verdict-history identity to that step alone —
# while WHICH checks run, in what order and as whom is the PROGRAM the step invokes, `cli`'s
# `gate-ci-parity`. That is a cross-story POINTER, never a `depends_on`: run the
# `cross-story-dependency` test both ways and neither unit needs the other's delivered outcome to pass
# its own proof — this audit passes or fails on `ci.yml` alone, and `gate-ci-parity`'s on the real
# plan alone. It also keeps this unit's two standing fences: `packages/ci-cd` imports nothing from
# `@storytree/cli`, and it takes no YAML dependency, so its readers stay text-level.
#
# STAYS IN `ci-cd`, AND ITS SOURCE NEEDS A BUILDING THIS STORY OWNS — SETTLED 2026-08-31
# (story-author). Its sibling `gate-ci-parity` hit the SAME ADR-0192 wall on the same day and got the
# OPPOSITE answer — it moved to `cli` (see `stories/cli/gate-ci-parity.md`). The two were decided
# separately, and the split is the point, not an inconsistency.
#
# WHY THIS ONE DOES NOT MOVE. `green-gate` is `ci-cd`'s ROOT capability — `depends_on: []`, with
# `auto-merge-on-green` and, transitively, `merge-presence-retire` and `deploy-on-merge` resting on it
# — and its outcome IS the story's outcome ("nothing reaches `main` unproven"). Contracts 1, 2 and 4
# are pure PIPELINE facts: the checkout takes the merge ref, no step is soft, `automerge` needs
# `verify`. That is precisely what `ci-cd` owns and what no other story does. Re-homing it would leave
# `ci-cd` a story about the side-effects of a pipeline it did not own, and would fail `cold-rebuild`.
#
# AND ITS JUDGE IS COUPLED TO NO BUILDING. Unlike `gate-ci-parity` — which since ADR-0606 IS the gate
# program in `packages/cli`, the plan it finds from each check's own file and its CI mode — this one
# reads ONLY
# `.github/workflows/ci.yml`, with no `@storytree/*` import. Nothing
# draws it toward `packages/cli` except the accident of where the first draft was written, and this
# story's body already claims `.github/workflows/` as its work-tracked home.
#
# THE ROOT CAUSE, STATED PRECISELY. `ci-cd` owns no workspace package. `readUnitSourceFiles`
# (`packages/cli/src/check-boundaries.ts`) gathers `buildConfig.real` ONLY — so this story's TWO
# existing Class-B `proof:` blocks (`adr-health-gate`, `merge-presence-retire`) are invisible to rules
# 5/6 today even though between them they point into THREE foreign buildings (`packages/cli`,
# `packages/library`, `packages/notice-board`). The first `real:` arm is what creates hosting
# evidence. ⚠ A Class-B block would therefore "work" here, and must NOT be chosen for that reason:
# the invisibility is a limit of the evidence gatherer, not a licence, and picking it to stay under
# the rule is the route-around the rule exists to stop.
#
# THE OTHER TWO REMEDIES, AND WHY NOT. Re-homing the capability (the answer the sibling got) is
# refused above on the merits. Adding `ci-cd` to the `hostedStories` register would be false to the
# register's own definition — the FROZEN set of stories whose proof-bound sources ALREADY lived in a
# foreign building at the 2026-07-13 adoption, which `ci-cd`'s never did — and reverses the direction
# ADR-0192 D3 exists to drive. A path outside `packages/`/`apps/` (for which `buildingDirOf` returns
# null, tripping neither rule) is unprecedented — all 139 `real.sourceFile` values in the corpus sit
# under one or the other — and would live in no workspace project, so `pnpm -r test` would never run it.
#
# ✅ THE BUILDING EXISTS NOW, AND THE `proof:` BLOCK IS RESTORED — 2026-08-31
# (`prove-unproven-capabilities-arc` inc-28). `packages/ci-cd` was created for this unit and
# `repo-manifest/package-ownership/_domain.json` maps `"@storytree/ci-cd": "ci-cd"` in
# `packageOwnership.organisms`, so
# `readDirOwners` now answers `dirOwners["packages/ci-cd"] === "ci-cd"` and the `real.sourceFile`
# below sits in this story's OWN building — rules 5 and 6 both skip it (`host === story`) rather than
# being satisfied by an edge or a register entry. That was PROVED with the real `check:boundaries`
# BEFORE any money was spent, which is the discipline the previous note's incident bought: the
# sibling was driven to a signed PASS for $2.8028 and only then refused, because
# `storytree node resolve` answers "REAL-buildable: yes" without ever consulting the landlord rule.
# Teaching the pre-flight that rule is a real gap and is owned by the boundary tooling, not here.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/ci-cd", "test"]
  scope:
    testGlobs: ["packages/ci-cd/src/green-gate-audit.test.ts"]
    sourceGlobs: ["packages/ci-cd/src/green-gate-audit.ts"]
  real:
    testFile: "packages/ci-cd/src/green-gate-audit.test.ts"
    sourceFile: "packages/ci-cd/src/green-gate-audit.ts"
    scope:
      testGlobs: ["packages/ci-cd/src/green-gate-audit.test.ts"]
      sourceGlobs: ["packages/ci-cd/src/green-gate-audit.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/ci-cd", "typecheck"]
    # ⚠ THE PACKAGE'S OWN RUNNER, DECLARED — never the default. `packages/ci-cd`'s `test` script is
    # `bun test src/`, and the REAL arm's DEFAULT proof is `node --import tsx --test <testFile>`,
    # which in a bun-only package dies at LOAD (`Cannot find package 'tsx'`) and prints a tail
    # byte-indistinguishable from an assertion failure — a CONFIRM_GREEN that could never be reached
    # and a CONFIRM_RED observed for the wrong reason. Declaring the pnpm command forces
    # `install: true` (the schema refuses pnpm on a bare worktree), which is the right trade here:
    # the spine then proves the unit under the SAME runner `pnpm -r test` will run it under, and the
    # install-bearing backstop also holds the package typecheck green before the verdict is signed.
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/ci-cd", "test"]
    editsExisting: false
---

# The green gate — `verify` proves a PR against the merge of branch and main

**Outcome —** A PR's `verify` job ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml))
proves it against the **merge of branch + main** by running the gate in CI mode — ONE required
`pnpm gate --ci` step that runs every check the gate plan places on the CI side, the studio build and
the authenticated shared-environment checks among them, UAT revision continuity included — and a red
anything blocks the merge (ADRs 0022, 0560 and 0606).

**The gate plan is the live list, and neither this paragraph nor the workflow names it.** Since
ADR-0606 D3 `verify` names no check: which checks CI runs is each check's own `runs` placement,
declared in the `/* gate-check` header its file opens with and found there by the gate
([`packages/cli/src/gate-checks.ts`](../../packages/cli/src/gate-checks.ts), ADR-0606 D1), and holding
that is `cli`'s [`gate-ci-parity`](../cli/gate-ci-parity.md). The set has moved often — ADR-0302 D4
deleted the three seed-sync rungs, ADR-0311 D2 retired thirteen more (`check:manifest` and
`check:web-experience` among them), and ADR-0606 took the whole list out of the workflow and then out
of the gate itself — which is why this capability never owned an enumeration. What it owns is the JOB: that it runs on the merge
ref, that it runs the gate in CI mode as a required step and names no check itself, that the
verdict-history identity reaches that step alone, and that `automerge` cannot outrun it.

## Guidance

- **Proof-walkthrough first (integration test, against the real workflow file + the real scripts).**
  The unit under test is the assembled `verify` job: drive a clean PR branch and assert every step
  the job runs passes and the job is green; then drive a branch that breaks ONE invariant *only on
  the merge with main* (a clean branch whose merge-ref is red — e.g. `main` removed an export the
  branch's new call site uses, so the merge fails `-r typecheck` while either side alone is clean)
  and assert `verify` goes RED even though the branch in isolation is clean.
  That second leg is the whole point of the capability and can't be proven at the contract tier — it
  needs the merge-ref behaviour of the real job, which is why this is an integration test, not a unit.
- **The job holds no stored secret.** Its two sign-ins are keyless WIF (ADR-0021; `id-token: write`
  mints each OIDC token), and the gate hands each step only the identity its plan entry declares, so
  the test leg and every step that reads no store run with no credential at all — by construction
  now, rather than by where they sat in the job (`gate-ci-parity`). *(This bullet said "no secrets
  and needs none … tests are offline (no DB) … a forked-PR run is identical to an owner run" until
  2026-09-24. The store-reading checks have held a keyless credential since ADR-0302 D3, so the
  offline half was already false, and the fork claim was never measured here — struck rather than
  restated.)*
- The merge-ref is GitHub's, not ours: `actions/checkout@v6` on a `pull_request` event checks out the
  merge commit of branch+main by default. The capability's job is to RELY on that — which is why
  contract 1 asserts the ABSENCE of a `ref:` override rather than anything about the step list.
- **Ordering is the gate plan's, and it reaches `verify` unchanged.** `verify` walks the plan's CI
  placement in plan order (ADR-0606 D3): cheap own-work checks first, then the minutes-cost legs,
  then the shared-environment checks — the two generated-view checks and UAT revision continuity
  among them — so a sibling moving the live source can never precede this branch's own answer.
  Holding that order is the gate program's job — it derives the order from each check's declared
  subject and cost (`gate-ci-parity`, `order-is-derived-from-declarations`) — not this workflow's. But
  ordering is about WHEN a verdict arrives, never about whether it binds: the gate step is required, a
  red step inside it reds that step — and so does a skip, unless the skipping check's own declaration
  accepts that skip in CI — and `automerge` (`needs: verify`) never runs.
- **Proof continuity is authenticated and late.** The pure candidate-revision judge belongs to
  [`cli`'s `uat-revision-continuity-gate`](../cli/uat-revision-continuity-gate.md), and the check's
  placement and identity declaration belong to `gate-ci-parity`. This capability owns the pipeline
  fact: `verify` signs in as the verdict-history reader WITHOUT exporting it, and hands that
  credential to its gate step alone, so the check runs with the live verdict credential available
  after branch-local proof, and its non-zero exit reds the gate step like any other. A store outage
  is red, never an optional skip — and the continuity check declares no skip at all, so under
  `pnpm gate --ci` an exit 3 from it is a failure too.

## Contracts (5)

1. **`proves-against-merge-ref`** — `verify` runs on the merge of branch+main, not the branch alone
   - **asserts —** the `verify` job's checkout step does NOT override actions/checkout's
     `pull_request` merge-ref default: it declares no `ref:` input pinning the head sha. That
     ABSENCE is what carries the behaviour, so the absence is what is asserted — pinning the head sha
     is the one edit that would silently convert the job from merge-of-branch-and-main to
     branch-alone and reintroduce the whole "local green, CI red" class.
   - **⚠ SPLIT — the platform half is EXCLUDED from this unit's verdict** (this unit's own
     proof-scoping call; see the frontmatter). That a branch
     green in isolation but broken when MERGED with current `main` actually goes RED depends on
     GitHub and actions/checkout producing a correct merge commit. That is platform trust, not a unit
     a worktree red→green can drive, and no test here claims it. The behaviour is REAL and is what
     the capability is for; it is simply not something this proof can honestly sign. Recorded as
     trust rather than stretched into the signed green.
2. **`every-step-is-required`** — every step the job runs is load-bearing; none is optional
   - **asserts —** breaking exactly one of the content checks `verify` runs makes the whole job go
     RED, and a green job therefore means every one of them passed. No step is advisory,
     `continue-on-error`, or otherwise soft in the `verify` job, and `automerge` (`needs: verify`)
     never runs against a non-green one. Since ADR-0606 every content check runs inside `verify`'s one
     `pnpm gate --ci` step, so "no soft step" now holds at two layers: the workflow declares no soft
     step (this audit), and inside the gate step a CI run exits non-zero on any red, on an exit 3 its
     check never declared, and on a declared skip unless that check's own declaration accepts the skip
     in CI — `cli`'s `gate-ci-parity` (`ci-green-means-every-ci-step-passed`), a cross-story pointer
     rather than a claim this audit proves.
     ⚠ **SCOPE THE ASSERTION TO THE `verify` JOB — a whole-file read of `ci.yml` FAILS on correct
     code.** Measured 2026-08-31, and again 2026-09-24 after ADR-0606 emptied `verify`: every real
     `continue-on-error: true` in the workflow — seven then, eight now — is in the `automerge` job,
     never in `verify`. They are deliberate, documented,
     post-merge fail-soft steps (the claim-release writer, the GCP auth, the hierarchy-mirror
     regeneration, the ADR-0195 full-CI backstop dispatch), each carrying a comment saying why it must
     not block a merge it cannot undo. The file also states its own exception: the studio-deploy
     dispatch is LOUD (no `continue-on-error`) and must stay LAST, so a dispatch failure cannot skip
     the fail-soft claim-release steps above it. **The check list is NOT part of what this contract
     guarantees** — and since ADR-0606 it is not in the workflow at all: it is the gate plan's CI
     placement (the fixed legs and found checks placed `both` or `ci`, which `pnpm gate --list`
     prints).
     ADR-0302 D4, ADR-0311 D2 and ADR-0606 have each changed it, and a contract that froze an
     enumeration would have gone false on each of those days while the invariant it exists to pin
     stayed true.
3. **`generated-views-in-sync`** — the two generated-view gates catch drift
   - **asserts —** `check:guidance` fails when either root main-session view — CLAUDE.md or Codex
     AGENTS.md — drifts from the canonical
     `session-orchestrator` artifact (ADRs 0051/0291; `check:claude` remains a compatibility alias);
     `check:agents` separately fails when any specialist Claude, Cursor, Codex, Gemini CLI, or
     OpenCode native
     view is stale, missing, orphaned, dangling, or differs from the same delegatable Library agent
     population
     (`.claude/agents/*.md`, `.cursor/agents/*.md`, `.codex/agents/*.toml`, `.gemini/agents/*.md`,
     `.opencode/agent/*.md`; ADRs 0052/0178/0234). Gemini files emit no model or tool grant, so the
     native Gemini CLI subagent inherits its parent session's model/tools; this contract makes no
     claim that Antigravity consumes the Gemini CLI surface. Neither sync check is a `verify` step of
     its own any more (ADR-0606 D3): `verify` runs both through its ONE `run: pnpm gate --ci` step
     and names no `pnpm check:*` step itself, and that step is required, not advisory (contract 2).
     That the gate's CI placement includes both — each declares `runs: both` in its own file — is
     `cli`'s [`gate-ci-parity`](../cli/gate-ci-parity.md) (`placement-selects-each-run`), a
     cross-story pointer rather than a claim this audit proves.
   - **and each names WHICH SIDE MOVED —** because both check a COMMITTED projection against the
     SHARED live store, a red here is as often another session's landed regeneration this branch has
     not merged as it is this branch's own omission, and the two remedies are opposite. Each failure
     therefore classifies every drifted file against `origin/main` and this branch's merge-base and
     prints the remedy in the order that does not sweep a sibling's in-flight live-store edit into
     this commit: *behind main* → merge and re-check FIRST, regenerate only if it still reds;
     *main equally stale* → merging cannot help, regenerate and commit separately with attribution;
     *this branch touched it* → regenerate, and no merge is offered because git would decline to
     apply one over a local edit. An unreadable `origin/main` fails WIDE to the unconditional
     remedy with the reason named — a side is never guessed (diagnosis-honesty-arc).
4. **`red-blocks-the-merge`** — a red `verify` stops the pipeline
   - **asserts —** `automerge` declares `needs: verify`, so a non-green `verify` means the merge step
     never runs; there is no path to `main` that skips a green `verify`.
5. **`changed-uat-revision-proof-is-a-blocking-shared-environment-step`** — continuity is enforced where its evidence exists.
   - **asserts —** `verify` runs the UAT revision continuity check through its one required
     `run: pnpm gate --ci` step, and hands that step — and no other — the verdict-history identity:
     the `id: webverdict` sign-in (`google-github-actions/auth@v3`, as
     `storytree-ci-webverdict@storytree-498613.iam.gserviceaccount.com`) sets
     `export_environment_variables: false`, so it becomes no step's ambient credential, and it reaches
     the gate step only as `STORYTREE_CI_IDENTITY_CI_WEBVERDICT_CREDENTIALS` (read from
     `steps.webverdict.outputs`) and `STORYTREE_CI_IDENTITY_CI_WEBVERDICT_DB_USER`; the job's other
     sign-in, `id: presence`, stays the narrower `storytree-ci-presence@…` identity; no other `verify`
     step names the verdict identity outside a comment; both sign-ins precede the gate step, and the
     gate step is `verify`'s last. Removing the gate step, making it advisory, exporting the verdict
     identity, or handing it to any other step fails the pipeline audit. That the gate plan places
     the continuity check on BOTH sides, as a shared-environment step after both expensive legs,
     declaring `ci-webverdict` (ADR-0560's split), is `cli`'s
     [`gate-ci-parity`](../cli/gate-ci-parity.md) (`placement-selects-each-run`,
     `ci-step-gets-only-its-declared-identity`) — a cross-story pointer rather than a claim this audit
     proves.
