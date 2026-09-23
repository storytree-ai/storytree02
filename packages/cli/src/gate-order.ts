// The gate's STEP MODEL, its FIXED LEGS and its ORDERING invariant — the pure half (`green-gate`,
// stories/ci-cd; the program that walks it is `gate-ci-parity`'s).
//
// THERE IS NO HAND-KEPT LIST OF CHECKS HERE (ADR-0606 D1/D2, superseding ADR-0486). The plan `pnpm
// gate` walks is DERIVED: every check declares itself at the top of its own file (`/* gate-check`),
// `gate-checks.ts` finds those files by NAME the way a test runner finds tests and orders them by
// what they declare, and the four FIXED legs below — lint, the two `-r` legs, the studio build — are
// placed around them. Registering a check is writing its file. There is no list to add it to, here
// or in CI, which runs the same derived plan through `pnpm gate --ci` (ADR-0606 D3).
//
// THE RUNNER MAY NARROW THE PLAN (ADR-0304 D1). The two `-r` legs are declared in full, and
// `gate-run.ts` rewrites them to the affected scope (`pnpm --filter ...<name> …`) just before running
// them, through CI's own classifier. {@link isExpensiveStep} recognises both forms, because that
// rewrite is the one thing that ever changes a step's text. Scoping changes how much each leg covers;
// it changes nothing about order or whether a red blocks.
//
// TWO AXES, both about WHEN a verdict arrives rather than what it says, and both hold BY
// CONSTRUCTION now that order is derived from declarations:
//
//   AXIS 1 — CHEAP FIRST. Every own-work, seconds-cost CHECK runs before any minutes-cost step.
//   AXIS 2 — THE SESSION'S OWN WORK BEFORE THE SHARED ENVIRONMENT (friction
//     `gate-aborts-early-hiding-thirteen-later-steps`). Every shared-environment step runs after all
//     own work: a red there may be a sibling's, and it must not precede the session's own answer.
//
// {@link evaluateGateOrder} re-judges a plan against both, from what each step DECLARES. The runner
// asks it of the plan it is about to walk, so a defect in the derivation is refused rather than run.
//
// Pure: no I/O. `gate-checks.ts` is where the files are read.

/*
 * WHY `--no-bail` IS PART OF THE DECLARED LEG (ADR-0276 increment 4, the last of its three elements).
 *
 * Without it `pnpm -r` halts at the FIRST failing workspace, so one package's red hides every later
 * package's verdict INSIDE this one step. That is the inner half of the 2026-07-29 evidence recorded
 * in `gate-runner.ts`: an `apps/studio` `waitFor` flake aborted `pnpm -r test`, `packages/cli` never
 * ran, and it held a REAL break the session then pushed. The runner's per-step scoreboard fixed the
 * OUTER half — a red no longer hides later STEPS — and this fixes the same defect one level down,
 * inside the step. Both halves are the same rule: a gate must report what it did not verify.
 *
 * IT CANNOT MAKE THE GATE GREENER. `--no-bail` changes only how far the leg gets before reporting;
 * pnpm still exits non-zero if any workspace failed, so every red that blocked before blocks now. The
 * trade is wall clock — a failing leg runs every workspace instead of stopping at the first — which
 * is the same trade the runner already made at step granularity and the reason `asset:merge-ceremony`
 * step 2 mandates `pnpm gate:bg`.
 */

/**
 * The two minutes-cost `-r` legs, in EITHER form: as {@link BUILT_IN_LEGS} declares them
 * (`pnpm -r --no-bail typecheck`) and as the affected-scope rewrite runs them
 * (`pnpm --filter ...<name> typecheck`, ADR-0304 D1).
 *
 * Recognising the rewritten form is load-bearing, not cosmetic: `gate-scope.ts` narrows exactly the
 * steps this recognises, and `gate-run.ts --scope` prints them.
 *
 * Anchored (`^`/`$`) so it cannot swallow a neighbour: a check is labelled by its NAME
 * (`check:unit-test` ends in `unit-test`, not `test`), and no fixed leg but these two begins with a
 * `-r`, `--filter` or `--no-bail` token AND ends in `typecheck` or `test` — `pnpm -r build` does not.
 *
 * The leading group is an ENUMERATION of the three token forms the gate actually emits — `-r`, one
 * `--filter ...<name>`, and `--no-bail` — rather than a permissive `.+?`. A wildcard here would
 * classify any `pnpm <anything> test` as an expensive leg, and this predicate decides which steps
 * the scope rewrite narrows. Recognising a step the plan never emits is the failure that would be
 * silent.
 *
 * (The mutation rung is minutes-cost too, but it is a check: its cost is DECLARED in its own file, and
 * the ordering axes read the declaration, not this predicate.)
 */
const SCOPED_EXPENSIVE_LEG =
  /^pnpm(?:\s+(?:-r|--no-bail|--filter\s+\S+))+\s+(?:typecheck|test)$/;

/** Is this step one of the two `-r` legs — in its declared form or its affected-scoped one? */
export function isExpensiveStep(command: string): boolean {
  const trimmed = command.trim();
  return SCOPED_EXPENSIVE_LEG.test(trimmed);
}

/**
 * WHO a red is about — the axis-2 classification, and the only judgement a step's declaration makes
 * that is not mechanical.
 *
 * The criterion is deliberately narrow and testable: a step is `own-work` when a red can ONLY be
 * caused by something in this branch's diff. If a red can be caused by state the session did not
 * author, it is `shared-environment` — even when it can ALSO be caused by the diff. The asymmetry is
 * the point: a step that is sometimes not yours must not gate the arrival of a step that is always
 * yours.
 */
export type GateSubject = "own-work" | "shared-environment";

/** Wall-clock class — the axis-1 classification. */
export type GateCost = "seconds" | "minutes";

/**
 * A declared SKIP (ADR-0606 D1/D3): the condition under which a step verifies nothing and exits
 * `GATE_SKIP_EXIT_CODE` (3), and what a CI run makes of it. A step that declares none never skips —
 * an exit 3 from it is a FAILURE, because a skip is an opt-in its own author wrote, never inferred.
 */
export interface StepSkip {
  readonly when: string;
  /** `failure`: CI supplies every input the check needs, so a skip there means one never arrived. */
  readonly inCi: "failure" | "accepted";
}

/** One step of the gate, in plan order. */
export interface GateStep {
  /** Its label: a fixed leg's command (`pnpm lint`), or a check's name (`check:boundaries`). */
  readonly command: string;
  /** The check's name, or `undefined` for a fixed leg. */
  readonly check: string | undefined;
  /**
   * The shell command that RUNS a found check — its own file, from its own workspace
   * (`gate-checks.ts`). Absent for a fixed leg, whose {@link command} is what runs.
   */
  readonly invocation?: string;
  /** The skip it declared — see {@link StepSkip}. Absent: an exit 3 from it is a failure. */
  readonly skip?: StepSkip;
}

/**
 * WHERE a step runs (ADR-0606 D3/D4). `pnpm gate` runs `both` + `local`; `pnpm gate --ci` (the CI
 * `verify` job) runs `both` + `ci`.
 *
 * The values are ADR-0486's two surviving delta classes, now declared on the step instead of
 * asserted between two lists: `local` is SESSION-DISCIPLINE (a rung that measures a session's own
 * drain obligation rather than a merge barrier — ADR-0252 D3's `check:verification-decay`), and `ci`
 * is ENVIRONMENTAL (a step only CI's clean checkout is asked to prove — the studio build). Required,
 * with no default, so a new check has to choose.
 */
export type GatePlacement = "both" | "local" | "ci";

/**
 * The keyless CI identity a store-reading step signs in as (ADR-0560's authority split, ADR-0021's
 * WIF). `ci-presence` is `storytree-ci-presence`, which deliberately cannot read verdict history;
 * `ci-webverdict` is the verdict-history reader.
 */
export type CiIdentity = "ci-presence" | "ci-webverdict";

/** A {@link GateStep} carrying what it declares about itself. */
export interface GatePlanStep extends GateStep {
  readonly subject: GateSubject;
  readonly cost: GateCost;
  /** WHERE it runs — see {@link GatePlacement}. */
  readonly runs: GatePlacement;
  /**
   * The identity it signs in as under `--ci` — DECLARED by a check that reads the live store, and
   * absent on every step that needs no credential (which then runs with none at all).
   */
  readonly ciIdentity?: CiIdentity;
  /** The repo-relative file a found check lives in — absent for a fixed leg. */
  readonly source?: string;
  /** Why it exists, and why it sits where its subject and cost put it. */
  readonly why: string;
}

/**
 * The gate's FIXED legs, in the three slots the derived plan places around the checks (ADR-0606 D1:
 * "the gate's built-ins, not a list anyone extends"):
 *
 *     lead · own-work/seconds checks · WALL · own-work/minutes checks · trail · shared checks
 */
export interface BuiltInLegs {
  /** Ahead of every check. */
  readonly lead: readonly GatePlanStep[];
  /** The two `-r` legs — the wall both ordering axes are measured against. */
  readonly wall: readonly GatePlanStep[];
  /** After the own-work checks, ahead of the shared environment. */
  readonly trail: readonly GatePlanStep[];
}

/*
 * SURVIVAL AUDIT, the fixed legs (bounded, authoritative; gate-machinery-audit-arc). Every CHECK's
 * evidence lives in its own declaration's `why`, beside the code it describes (ADR-0606 D1); these
 * four have no file of their own to carry it.
 * - pnpm lint — RATCHET MAINTENANCE (anti-slop-adoption-arc inc-07, added 2026-08-24). The rung
 *   the arc's end-state FOUR held to `gate-machinery-audit-arc`'s inverted burden, and it arrives
 *   carrying catches rather than a promise.
 *
 *   WHAT IT CAUGHT, WHEN, AND WHAT SHIPPED WITHOUT IT. Nine rules reached `error` at zero across
 *   inc-03/06/11 and inc-08/09/10. Each was enforced only at the moment it landed, because nothing
 *   ran `pnpm lint` afterwards — not the gate, not CI. The ratchet slipped back every time:
 *     · 2026-08-23, within 24 h of `no-conditional-empty-object-spread` reaching `error` (inc-11),
 *       EIGHT fresh violations landed on `main` and `pnpm lint` was exit 1 on `main` with nobody
 *       aware. That is the finding that motivated this rung and it was found by hand.
 *     · 2026-08-23/24, across ONE session's three merges from `main`, TWELVE more arrived: one
 *       `no-known-value-widening` during inc-10, then six `no-conditional-empty-object-spread`
 *       plus one widening with inc-09's first merge, then two inline anonymous-object return
 *       annotations and an assertion chain with its second (arriving alongside `library search`).
 *   Twenty fresh violations of already-adopted rules, all hours old, all on `main`. "What would
 *   ship without it" is not hypothetical here: it already had, twenty times, in two days.
 *
 *   MEASURED COST, not assumed. 2.7 s on a full run over the whole repo (three runs: 2755 / 2671 /
 *   2682 ms, this box, warm). The arc was explicit that oxlint being written in Rust proves
 *   nothing, because the JS-plugin path these rules run on is Node and not the Rust fast path —
 *   so it was measured. It is the CHEAPEST step in the gate, an order of magnitude under the next
 *   one, and it does not narrow: it lints the whole repo every time, which is what a ratchet needs.
 *
 *   WHY A RUNG AND NOT A LOCAL COMMAND. The arc reserved the right to say no, and the honest test
 *   was whether anything had regressed. Everything had. A rule at `error` in a config nothing runs
 *   is not a standard, it is a comment.
 * - pnpm -r typecheck — PROOF INTEGRITY. CI run 27761462602, fix 34f320dc, PR224 caught a moved,
 *   nonexistent export after other gates and build were green; without it a stale loader ships.
 * - pnpm -r test — PROOF INTEGRITY. CI run 30976384824, fix 327151fb, PR1151 caught
 *   credential-dependent suites after typecheck was green; without it behavior regressions ship.
 *
 * ★ WHERE EACH STEP RUNS IS ITS `runs` DECLARATION, AND NOTHING ELSE (ADR-0606, superseding
 * ADR-0486). `pnpm gate` runs `both` + `local`; `pnpm gate --ci` — the CI `verify` job — runs `both` +
 * `ci`. There is no second list to compare the plan against: a placement is one value on one step.
 *
 * `check:verification-decay` is `local` BY DECISION, and moving it to `both` would REVERSE an
 * accepted, load-bearing decision — ADR-0252 D3 makes the decay ceiling a DRAIN OBLIGATION on the
 * session (the `check:friction-drain` shape, ADR-0168 D4) rather than a barrier on the trunk,
 * because these instruments are heuristics with a measured ~75% false-positive rate and a CI step
 * is a merge barrier. The rung's own module header states this at the source
 * (`check-verification-decay.ts`), together with the cost accepted knowingly: a landing that never
 * runs the local gate can grow the backlog unseen. Note "it could not run in CI" is NOT the reason
 * and never was — it could; it is not asked to. If the trade-off is ever to be revisited, that is a
 * new decision superseding ADR-0252 D3, not a one-word edit to that file's declaration — which is
 * exactly how easy the edit now is, and why it is said here.
 *
 * TOMBSTONE. The 16 rungs ADR-0302 and ADR-0311 retired are no longer inventoried here: each that left
 * source behind says so in its own file (`retired: <decision>`, ADR-0606 D6), and the gate lists those
 * and never runs them. The four deleted outright left nothing to mark; their decisions record them.
 */
export const BUILT_IN_LEGS: BuiltInLegs = {
  lead: [
    {
      command: "pnpm lint",
      check: undefined,
      runs: "both",
      subject: "own-work",
      cost: "seconds",
      why: "reds on a fresh violation of any anti-slop rule this repo has already driven to ZERO; the rules are enforced at the moment each landed and this is what stops the ratchet slipping back (anti-slop-adoption-arc inc-07)",
    },
  ],
  wall: [
    {
      command: "pnpm -r --no-bail typecheck",
      check: undefined,
      runs: "both",
      subject: "own-work",
      cost: "minutes",
      why: "the session's own diff, and the first of the two answers a session actually came for",
    },
    {
      command: "pnpm -r --no-bail test",
      check: undefined,
      runs: "both",
      subject: "own-work",
      cost: "minutes",
      why: "the session's own diff; independent of typecheck because tests run transpile-only via tsx",
    },
  ],
  trail: [
    {
      command: "pnpm -r build",
      check: undefined,
      runs: "ci",
      subject: "own-work",
      cost: "seconds",
      why: "the only buildable target is `apps/studio` (`vite build`) — every package exports raw TS with no build step — and a Vite build can fail on something `tsx` tolerates, which is exactly what it caught when the studio's dev API pulled the Node-only store substrate into config load. CI-ONLY BY PLACEMENT (ADR-0606 D4, ADR-0486 D2(a)'s environmental class): it is the one step only CI's clean checkout is asked to prove. It stays full-scope — the affected rewrite touches the two `-r` legs only — and sits after the own-work checks and ahead of the shared environment, the slot it held in `ci.yml`",
    },
  ],
};

/**
 * Does this step's verdict read mutable live-store state the working-tree digest cannot observe?
 *
 * WHAT IT IS FOR, AND IT IS ONE THING. `gate-rerun.ts` may call a fail→pass a `flake-signature` only
 * when the working-tree digest is byte-identical across the two runs — and that digest's aperture is
 * `git status` + `git diff HEAD` + the untracked files' content. The shared Postgres store is OUTSIDE
 * that aperture entirely. So for a step that reads it, "the repository did not change" does NOT mean
 * "nothing changed": a sibling session's `--pg` write, or the session's own repair of a live artifact,
 * moves the verdict while the digest is unmoved.
 *
 * DECLARED, ONCE: a check that reads the store names the CI identity it reads it as (`ciIdentity`),
 * and that declaration is the answer here too — one fact, one field. `gate-checks.test.ts` holds
 * every declaration to its file's REAL import closure, so it cannot quietly become prose.
 *
 * ⚠ NOT THE SAME AXIS AS {@link GateSubject}, THOUGH THEY COINCIDE TODAY. `subject` answers WHOSE a red
 * might be — the ordering question. This answers whether SAMENESS is provable — the rerun question.
 */
export function readsLiveStore(step: Pick<GatePlanStep, "ciIdentity">): boolean {
  return step.ciIdentity !== undefined;
}

/**
 * The steps one kind of run executes, in plan order: `local` runs `both` + `local`, `ci` runs
 * `both` + `ci` (ADR-0606 D3). A filter, never a reorder — a subsequence keeps the plan's relative
 * order, which is why `gate-run.ts` judges the ordering invariant over the WHOLE plan first and only
 * then narrows it to one side.
 */
export function stepsFor<T extends Pick<GatePlanStep, "runs">>(
  plan: readonly T[],
  mode: "local" | "ci",
): T[] {
  return plan.filter((step) => step.runs === "both" || step.runs === mode);
}

/**
 * The token whose presence in a command means a child's exit code will NOT survive it — which
 * matters for any step whose code carries a protocol: a declared skip (3), and the root `gate`
 * script's partial-run code (4). MEASURED 2026-08-08, with a positive control:
 *
 *     pnpm --filter <pkg> exec node -e "process.exit(3)"   → exit 1    ← COLLAPSES
 *     pnpm -C <dir>       exec node -e "process.exit(3)"   → exit 3
 *     pnpm --filter <pkg> run  <script>                    → exit 3, and 75 → 75
 *     pnpm -C <dir>       run  <script>                    → exit 75
 *
 * READ THE TABLE, NOT THE FIRST ROW. It is the RECURSIVE `exec` that collapses — `--filter … exec`
 * reports `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL` and normalises any non-zero child code to 1. `--filter …
 * run` does NOT, which is why `pnpm db:up`'s documented exit-75 protocol is intact and must not be
 * "fixed".
 *
 * DELIBERATELY BROADER THAN THE MEASURED CAUSE, and only sound because of the domain it is applied
 * to: every command this is checked against is an `exec` form — a found check's invocation
 * (`pnpm -C <workspace> exec …`, `gate-checks.ts`) and the root `gate` script — so there the token
 * and the cause coincide, and narrowing it to `exec` would WEAKEN the fence.
 */
export const EXIT_CODE_COLLAPSING_INVOCATION = "--filter";

/**
 * What a surviving retired source's `.test.ts` companion still does — the only classification here
 * that decides whether DELETING a file is free.
 *
 * - `load-bearing` — it asserts an invariant over the REAL tree that nothing else asserts. Deleting
 *   it drops that invariant, silently and repo-wide. These carry {@link LOAD_BEARING_MARKER}.
 * - `repo-coupled` — it reads the real tree, so it CAN red on a change the session did not expect,
 *   but every assertion is about the retired module's own coherence. Deleting it drops nothing.
 * - `unit-only` — pure; it exercises the retired module's logic and touches no disk.
 *
 * The middle class exists because collapsing it into either neighbour would be a false statement of
 * exactly the kind this inventory was written to correct: calling it `unit-only` denies a real red
 * it can produce, and calling it `load-bearing` would protect a file whose loss costs nothing.
 */
export type CompanionRole = "load-bearing" | "repo-coupled" | "unit-only";

/** One surviving `.test.ts` companion of a retired check's source. */
export interface RetiredCompanion {
  /** The {@link RetiredCheck} source it tests, e.g. `"coverage-gate.ts"`. */
  readonly of: string;
  readonly role: CompanionRole;
  /**
   * WHAT DELETING THIS FILE WOULD COST, in one line — the whole point of the entry. For a
   * `load-bearing` companion this names the invariant that would silently lapse; for the others it
   * records why nothing would.
   */
  readonly cost: string;
}

/**
 * THE COMPANION HALF OF THE TOMBSTONE — every `.test.ts` beside a retired check's surviving source (its entry file, or a helper its `retired` declaration names), and
 * what deleting it would cost.
 *
 * WHY THIS EXISTS SEPARATELY FROM THE RETIRED DECLARATIONS. Those track the PRODUCTION files
 * and `gate-order.test.ts` bannered exactly those, so sixteen companions sat untracked and
 * unbannered beside them — and three of those sixteen are not leftovers at all. They run inside
 * `pnpm -r test` (the test leg, which the local gate and CI both run) and assert invariants over the real repo:
 * `test-timing-drain.test.ts` sweeps every gate-tier workspace's test files for wall-clock calls,
 * and the two `coverage-*` companions sweep the real `stories/` tree. A tidy-up deleting "the
 * unwired ADR-0311 leftovers" would have taken them with it and dropped those invariants in
 * silence, because nothing on disk said otherwise.
 *
 * SO THE ENTRY IS THE MECHANISM, NOT THE DOCUMENTATION. `gate-order.test.ts` holds the repo to it
 * three ways: a companion that exists on disk must be declared here (so one cannot appear
 * untracked), a companion declared here must still exist (so deleting the FILE reds immediately,
 * naming the cost below), and the `load-bearing` set is additionally pinned BY NAME in that test.
 * Dropping one is therefore three deliberate edits — the file, this entry, and that literal — and
 * the middle one puts the sentence describing what is being abandoned into the diff. That is the
 * whole ask: not that deletion is impossible, but that it cannot be silent.
 *
 * A `load-bearing` companion is NOT a gate rung and re-reading it as one would be the original
 * defect wearing new clothes. It is an ordinary test that happens to assert something repo-wide;
 * ADR-0311 D2 retired the RUNG, and ADR-0311 D5 still governs re-wiring one.
 */
export const RETIRED_TEST_COMPANIONS: ReadonlyMap<string, RetiredCompanion> = new Map<
  string,
  RetiredCompanion
>([
  // ── load-bearing: deleting these drops a repo-wide invariant ────────────────
  [
    "test-timing-drain.test.ts",
    {
      of: "test-timing-drain.ts",
      role: "load-bearing",
      cost: "its BASELINE test is the only surviving enforcement of ADR-0276's no-wall-clock-in-tests rule — it sweeps every gate-tier workspace's test files for `performance.now` / `process.hrtime` behind an anti-vacuity floor (>=20 workspaces, >=300 files) and asserts the unsanctioned list is empty, so a new timing call anywhere in the repo reds `pnpm -r test` through this file",
    },
  ],
  [
    "coverage-gate.test.ts",
    {
      of: "coverage-gate.ts",
      role: "load-bearing",
      cost: "its end-to-end test walks the real `stories/` tree and pins live proof bindings — that `deploy-health-signal` and `act2-regrow-camera-zoom-out` are scanned and fully covered, and act2's two literal `apps/studio/` proof paths — so moving or renaming one of those files reds here and nowhere else",
    },
  ],
  [
    "coverage-drain.test.ts",
    {
      of: "coverage-drain.ts",
      role: "load-bearing",
      cost: "its live-corpus test is the only surviving enforcement of the contract-coverage ceiling (ADR-0252 D3) — it sweeps the real `stories/` tree and asserts the drain verdict is not red, so the uncovered/unbound backlog cannot grow past its ceiling unnoticed",
    },
  ],

  // ── repo-coupled: reads the real tree, but asserts only its own module ──────
  [
    "check-surface-coverage.test.ts",
    {
      of: "check-surface-coverage.ts",
      role: "repo-coupled",
      cost: "little, but no longer nothing — most of it joins a FIXTURE process tier to the real root `package.json`, so removing a script it names (`pnpm db:up`, `pnpm --filter desktop start`) reds it. Since the prescriptive-command axis landed, one test also derives the MOUNTED COMMAND REGISTER from the real `packages/cli/src` and asserts both directions over it: that today's verbs resolve, and that the three Library verbs PR #1148 deleted do not. That is the non-vacuity control for the derivation — delete it and the axis can silently stop recognising anything while its fixture tests stay green",
    },
  ],
  [
    "surface-coverage-drain.test.ts",
    {
      of: "surface-coverage-drain.ts",
      role: "repo-coupled",
      cost: "nothing — its own BASELINE comment concedes it no longer pins the real repo (ADR-0302 D1 deleted the seed it read), and its verdict assertion accepts `ok` or `red`; what it still pins is the retired module's 0/0 ceiling pair",
    },
  ],
  [
    "check-dist-drift.test.ts",
    {
      of: "check-dist-drift.ts",
      role: "repo-coupled",
      cost: "nothing — it reads the real `infra/install.ps1` and reds if the advertised URL stops matching the retired module's `PUBLISHED_URL`, which is a coherence check on dead code: no gate rung verifies that URL either way",
    },
  ],

  // ── unit-only: pure, no disk ────────────────────────────────────────────────
  [
    "check-process-graph.test.ts",
    { of: "check-process-graph.ts", role: "unit-only", cost: "nothing — pure, over injected fixtures" },
  ],
  [
    "test-timing-gate.test.ts",
    { of: "test-timing-gate.ts", role: "unit-only", cost: "nothing — pure; the repo sweep it powers is asserted by `test-timing-drain.test.ts`" },
  ],
  [
    "web-experience-check.test.ts",
    { of: "web-experience-check.ts", role: "unit-only", cost: "nothing — pure, over injected fixtures" },
  ],
  [
    "check-declared.test.ts",
    { of: "check-declared.ts", role: "unit-only", cost: "nothing — pure, over injected fixtures" },
  ],
  [
    "friction-drain.test.ts",
    { of: "friction-drain.ts", role: "unit-only", cost: "nothing — pure; the ceiling it exercises reaches no disk" },
  ],
  [
    "db-required.test.ts",
    { of: "db-required.ts", role: "unit-only", cost: "nothing — pure, over injected env" },
  ],
  [
    "arc-proposal-drain.test.ts",
    { of: "arc-proposal-drain.ts", role: "unit-only", cost: "nothing — pure; the ceiling it exercises reaches no disk" },
  ],
  [
    "graduation-drain.test.ts",
    { of: "graduation-drain.ts", role: "unit-only", cost: "nothing — pure; the ceiling it exercises reaches no disk" },
  ],
  [
    "check-node-version.test.ts",
    { of: "check-node-version.ts", role: "unit-only", cost: "nothing — pure, over injected version strings" },
  ],
  [
    "deploy-health.test.ts",
    { of: "deploy-health.ts", role: "unit-only", cost: "nothing — pure, over injected run records" },
  ],
]);

/** The `.test.ts` companion filename a retired source would have, e.g. `coverage-gate.ts` → `coverage-gate.test.ts`. */
export function companionFileFor(source: string): string {
  return source.replace(/\.ts$/, ".test.ts");
}

/**
 * The banner every surviving retired source must carry, and the token the test greps for.
 *
 * Deliberately a bare ASCII word rather than a decorated string: it has to survive reformatting and
 * be greppable by a session that does not know this module exists.
 */
export const UNWIRED_MARKER = "UNWIRED";

/**
 * The banner a `load-bearing` {@link RetiredCompanion} must carry, and the one an inert companion
 * must NOT — the second direction is the anti-rot half, so a file that stops enforcing cannot keep
 * the claim that it does.
 *
 * A distinct token from {@link UNWIRED_MARKER} on purpose: a session sweeping the leftovers greps
 * one word to find what is safe to delete and hits the other word on what is not.
 */
export const LOAD_BEARING_MARKER = "LOAD-BEARING";

/**
 * THE GATE'S VOICE — phrasings that assert MERGE-BLOCKING authority over the reader.
 *
 * A `retired` declaration guards a check-shaped FILE that enforces nothing. This guards the other
 * half of the same defect, which that inventory cannot see: a command that TELLS THE READER
 * something must be fixed before merging, while no gate step runs it. A grep for the
 * rule finds an authoritative sentence and concludes it is enforced — the identical failure
 * the retired declarations exist to refuse, arriving through prose instead of through a source file.
 *
 * MEASURED 2026-08-08, the instance that motivated this: `storytree library --check` printed
 * `GATE BROKEN: … — fix before merge` on a live-corpus report that NO root script and NO CI job has
 * ever run. ADR-0026 §5 had decided that surface was deliberately not a gate — "only an occasional
 * operator `storytree library --check --pg` does — by design, not every push" — so the sentence was
 * wrong at birth, and a session settling an unrelated question read it as a real merge gate.
 *
 * DELIBERATELY NARROW. These are claims of BLOCKING authority, not every mention of merging.
 * `adr.ts`'s "catch a collision before merge (it will fail the PR…)" is TRUE and wired, and
 * `graduate.ts`'s "await a librarian pass before merge" describes operating discipline rather than a
 * machine that refuses — neither is listed, and widening this set to catch them would price the
 * check into noise and then into an allowlist nobody reads.
 */
export const GATE_AUTHORITY_PHRASES: readonly string[] = [
  "GATE BROKEN",
  "fix before merge",
  "blocks the merge",
  "blocks a merge",
];

/** One assertion of merge-blocking authority found in a source file. */
export interface GateVoiceHit {
  /** 1-indexed line number. */
  readonly line: number;
  /** The {@link GATE_AUTHORITY_PHRASES} member that matched. */
  readonly phrase: string;
  /** The matching source line, trimmed — so a failure names the sentence, not just a location. */
  readonly text: string;
}

/**
 * Every {@link GATE_AUTHORITY_PHRASES} occurrence in one source file. Pure: the caller supplies the
 * text, as with every other judgement in this module.
 *
 * COMMENTS ARE SCANNED TOO, and that is the fail-closed choice rather than an oversight. Restricting
 * to string literals would need a parser here (this module has none, by design) and would miss the
 * maintainer-facing half of the same lie — a docstring claiming a function "blocks the merge" sends
 * the next session down the same road as a printed banner. The price is that a NEGATION
 * ("a deploy failure never blocks a merge") also matches; it is paid once, in an exemption whose
 * reason records that someone checked. Over-reporting costs an entry; under-reporting costs the
 * whole point.
 */
export function findGateVoice(source: string): GateVoiceHit[] {
  const hits: GateVoiceHit[] = [];
  source.split(/\r?\n/).forEach((text, i) => {
    for (const phrase of GATE_AUTHORITY_PHRASES) {
      if (text.includes(phrase)) hits.push({ line: i + 1, phrase, text: text.trim() });
    }
  });
  return hits;
}

/**
 * The key {@link GATE_VOICE_EXEMPTIONS} is written in: `<file>::<phrase>`, where `<file>` is the
 * path relative to the repo root. Built here so the map and the sweep cannot disagree about the
 * shape.
 */
export function gateVoiceKey(file: string, phrase: string): string {
  return `${file}::${phrase}`;
}

/**
 * Sentences that MAY claim merge-blocking authority, each keyed to why the claim is honest.
 *
 * An entry is a statement that someone traced the claim to a step the gate actually runs, or
 * established that it is not a claim at all. `gate-order.test.ts` refuses any unlisted hit, so a new
 * one cannot be introduced silently — and the reason is the durable half: without it the next
 * session re-verifies the same sentence from scratch.
 *
 * The DECLARING module and its test are not scanned; they hold the phrase list itself as data, and a
 * scanner that flagged its own inventory could only ever be answered by exempting itself.
 */
export const GATE_VOICE_EXEMPTIONS: ReadonlyMap<string, string> = new Map([
  [
    gateVoiceKey("packages/cli/src/check-deploy-health.ts", "blocks a merge"),
    "states the OPPOSITE — it records that a deploy failure never blocked one, which is why ADR-0311 D2 retired the rung; the file carries the UNWIRED banner",
  ],
  [
    gateVoiceKey("packages/cli/src/friction.ts", "blocks the merge"),
    "TRUE and wired: `friction-inbox.test.ts` runs `validateInboxDir` over the committed `docs/friction-inbox/` inside `pnpm -r test`, which is the gate's test leg (verified 2026-08-08)",
  ],
]);

/**
 * The packages the gate-voice sweep reads — where this repo's CLI output and its shared drivers
 * live, and therefore where a printed claim of merge authority can originate.
 *
 * NAMING THE APERTURE IS PART OF THE CHECK (`asset:an-observable-is-evidence-only-for-what-it-observes`).
 * A clean sweep says nothing about `apps/**` or `stories/**`: the same false claim can and has lived
 * in a Library artifact and in a story spec, where no mechanical reader reaches it. Widen this list
 * rather than reading its silence as coverage.
 */
export const GATE_VOICE_SCAN_ROOTS: readonly string[] = ["packages/cli/src", "packages/drive/src"];

export interface GateOrderVerdict {
  readonly verdict: "ok" | "fail";
  readonly message: string;
  /** Own-work, seconds-cost CHECKS that run after a minutes-cost step (axis 1). */
  readonly misordered: readonly string[];
  /** Shared-environment steps with own work still to run after them (axis 2). */
  readonly premature: readonly string[];
}

/**
 * Judge one gate plan against both ordering axes, from what each step DECLARES — its subject and
 * its cost — rather than from a second list naming which steps belong where.
 *
 * A derived plan passes by construction (`gate-checks.ts`), so a failure here is a defect in the
 * DERIVATION, never in one check's declaration; the runner asks anyway, of the exact plan it is
 * about to walk, so such a defect is refused rather than run.
 *
 * FAIL-CLOSED on a plan with NO minutes-cost step: "nothing cheap runs after the wall" is vacuously
 * true of a plan whose wall is missing, and a missing wall means the two `-r` legs did not arrive.
 */
export function evaluateGateOrder(steps: readonly GatePlanStep[]): GateOrderVerdict {
  if (!steps.some((step) => step.cost === "minutes")) {
    return {
      verdict: "fail",
      message:
        "the gate plan runs no minutes-cost step — the ordering invariant cannot be judged against a " +
        "plan whose `-r` legs never arrived.",
      misordered: [],
      premature: [],
    };
  }
  const misordered = steps
    .filter(
      (step, i) =>
        step.check !== undefined &&
        step.subject === "own-work" &&
        step.cost === "seconds" &&
        steps.slice(0, i).some((earlier) => earlier.cost === "minutes"),
    )
    .map((step) => step.command);
  const premature = steps
    .filter(
      (step, i) =>
        step.subject === "shared-environment" &&
        steps.slice(i + 1).some((later) => later.subject === "own-work"),
    )
    .map((step) => step.command);

  if (misordered.length === 0 && premature.length === 0) {
    return { verdict: "ok", message: "both ordering axes hold.", misordered, premature };
  }
  const lines: string[] = [];
  if (misordered.length > 0) {
    lines.push(
      `${misordered.length} own-work, seconds-cost check(s) run AFTER a minutes-cost step: ` +
        `${misordered.join(", ")}. A session waits the whole run to read a verdict that was available in seconds.`,
    );
  }
  if (premature.length > 0) {
    lines.push(
      `${premature.length} shared-environment step(s) run BEFORE the session's own work is done: ` +
        `${premature.join(", ")}. A red there may be a sibling session's, and it must not precede the session's own answer.`,
    );
  }
  lines.push(
    "The plan is derived from each check's declaration (packages/cli/src/gate-checks.ts), so this is a " +
      "defect in the derivation, not in any one check.",
  );
  return { verdict: "fail", message: lines.join("\n"), misordered, premature };
}
