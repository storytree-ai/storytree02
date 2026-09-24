// The diff-scoped mutation rung's PURE core — ADR-0458, realising ADR-0447 D2 via the
// `diff-scoped-mutation-rung` increment. No I/O: the caller supplies the diff text, the workspace
// projects and the mutation report, and gets back a selection and a verdict.
//
// WHAT THIS RUNG ASKS, and the two words that carry it: do THIS BRANCH's own new or changed tests
// kill the mutants in THIS BRANCH's own changed lines? Not "does the package score well" — ADR-0447
// refused a mutation-score ceiling outright, because a threshold prices the ceremony toward killing
// cheap mutants, which is the mutation-testing analogue of the coverage gaming this arc exists to
// stop. There is no percentage anywhere in this file, and adding one is a decision, not a tweak.
//
// LINE RANGES, NOT WHOLE FILES, AND THAT IS THE SELF-LIMITING PART. `diff-scoped-mutation-rung`'s
// standing promise is that the rung "asks nothing of code you did not touch". Mutating a whole
// changed FILE breaks that promise the first time anyone edits one line of an old file: Stryker
// would mutate the other three hundred lines too, they would be killed by tests written years ago,
// and the rung would red a landing that did its job. So the diff's NEW-side line ranges are carried
// all the way into Stryker's `mutate` globs (`path.ts:12-18`), and a mutant outside them is never
// generated in the first place.
//
// THE FOUR HARD CONSTRAINTS the attribution wire established (PR #1657,
// docs/research/stryker-bun-attribution-2026-08-26.md) are honoured HERE, not by the config alone:
//   1. `coveredBy` is NOT `killedBy` — this file reads `killedBy` and never `coveredBy`. A test that
//      merely EXECUTED the mutated line proves nothing; the wire's fixture has a case covered by two
//      tests and detectable by one.
//   2/3. `coverageAnalysis: "perTest"` and `disableBail: true` live in the generated config, but
//      {@link adjudicateMutants} fails closed when their absence shows up as missing attribution,
//      so a config that quietly loses them cannot read as a pass.
//   4. An empty `killedBy` on a `Killed` mutant means NOT IDENTIFIABLE — never a pass, and never a
//      survivor either. It is {@link MutantOutcome} `"unproven"`, which reds, and says why.
//
// ⚠ AND `Survived` IS NOT SELF-EVIDENTLY A FINDING EITHER — the half of constraint 4 that was
// missing. It was written as though Stryker's own survivor verdict were beyond doubt while only the
// attribution layer could fail; measured 2026-09-12, a runner whose coverage map is built from a
// truncated pairing reports `Survived` for mutants a test demonstrably kills. `Survived` and
// `NoCoverage` are both READINGS OF THE COVERAGE MAP, so both are withdrawn to `"unproven"` when
// {@link unattributedTestFiles} shows the map cannot be read. See that function for the mechanism,
// the discriminator, and why the obvious one is wrong.

import { checkNameFor } from "./gate-checks.js";

/** One inclusive 1-based line span on the NEW side of a diff. */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

/** A repo-root-relative posix path with the new-side spans this branch touched in it. */
export interface ChangedRanges {
  readonly file: string;
  readonly ranges: readonly LineRange[];
}

/** A test runner this rung can drive mutants through. See {@link runnerFor}. */
export type MutationRunner = "bun" | "vitest";

/** One workspace project, in the shape `ci-affected.ts` already discovers them. */
export interface ProjectDir {
  readonly name: string;
  /** e.g. `packages/library` — no trailing slash. */
  readonly dir: string;
}

/** What to mutate in one project, already rendered as Stryker `mutate` globs. */
export interface MutationTarget {
  readonly project: string;
  readonly dir: string;
  /** `packages/cli/src/foo.ts:12-18` — one entry per contiguous span. */
  readonly mutateGlobs: readonly string[];
  /** The distinct source files those globs cover, for the human-facing summary. */
  readonly sourceFiles: readonly string[];
}

/**
 * One changed source file this rung declined to mutate because it sits outside its project's
 * `src/` — and the two of these are NOT the same finding, which is the whole reason the shape
 * carries a discriminator instead of just a path.
 *
 * `untested-root` is the conservative drop {@link selectMutationTargets} was designed around: a
 * `scripts/` or `infra/` file no unit test is written against, whose mutants would all survive and
 * red an honest landing. Nothing is wrong and nothing is owed.
 *
 * `declared-test-root` is a REAL COVERAGE GAP wearing the same clothes: the owning project's own
 * `test` script names that directory as a suite root, so its tests DO run there and the rung could
 * mutate it — the `src/` prefix is simply narrower than the project's own declaration. Measured on
 * `apps/desktop`, whose `test` script is `bun test … src/ electron/`: 2,140 lines across four
 * `electron/` files, 45% of the app's non-test TypeScript and the whole 931-line sidecar route
 * table, sat outside the rung with no line ever printed about it.
 *
 * `unmutated-extension` is the third, and it sits INSIDE `src/`: a production `.tsx` / `.mts` /
 * `.cts` file the rung never mutates because {@link isMutableSource} admits `.ts` alone. Until
 * 2026-09-24 it was dropped with no record at all — a branch changing only
 * `apps/studio/src/components/Act2IntroControl.tsx` skipped with "this branch changes no mutable
 * source", a sentence that read as "nothing here needed proving". Whether to ADMIT those extensions
 * is a separate policy decision; this kind only makes the drop visible.
 */
export interface NarrowedFile {
  /** Repo-root-relative posix path. */
  readonly file: string;
  readonly kind: "untested-root" | "declared-test-root" | "unmutated-extension";
  /** The project that owns it, for the human-facing line. */
  readonly project: string;
}

/** The selection: what to mutate, which tests count as this branch's, or why there is nothing to do. */
export interface TargetSelection {
  readonly targets: readonly MutationTarget[];
  /** Repo-relative posix paths of test files this branch added or changed. */
  readonly changedTestFiles: readonly string[];
  /** Changed source dropped as an executable entry point — REPORTED, never silent. */
  readonly exempted: readonly string[];
  /**
   * Changed source dropped for sitting outside its project's `src/` — REPORTED ON EVERY RUN, which
   * is the repair {@link selectMutationTargets}' own doc comment had been promising and not keeping.
   *
   * THE BUG THIS FIELD EXISTS TO CLOSE, measured 2026-08-29. The drop was only ever surfaced
   * through {@link TargetSelection.skipReason}, which the driver prints in the `targets.length === 0`
   * branch alone. So a branch that changed NOTHING mutable said `1 changed .ts file(s) sit outside
   * any project's src/` and was honest, while a branch that changed one mutable file AND a
   * 149-line Electron HTTP server printed `1 changed source file(s)` and not one word about the
   * second. The narrowing was visible exactly when it cost nothing and invisible exactly when it
   * cost something — the reassuring direction, and this repo's standing fault class (a rung that
   * quietly covers less than you think) one level up from the tests it grades.
   */
  readonly narrowed: readonly NarrowedFile[];
  /** Present only when {@link targets} is empty — the reason, for an honest SKIP. */
  readonly skipReason: string | null;
}

/** How a "nothing to mutate" run must report itself, for the runner that is actually reading it. */
export interface SkipDisposition {
  /** The process exit code. */
  readonly exitCode: number;
  /** The word the skip line leads with. The FACT is printed either way; only this differs. */
  readonly label: string;
}

/**
 * Decide how a SKIP announces itself — and it is a DECISION, because two runners read this same
 * script and disagree about what a non-zero code means.
 *
 * `gate-run.ts` reads {@link SkipDisposition.exitCode} 3 as a DECLARED skip: it prints the step as
 * SKIP, names it in `GATE GREEN, NARROWED`, and does not red the gate. CI runs the very same
 * `pnpm check:mutation-diff` through `pnpm gate --ci` (ADR-0606 D3), which counts exit 3 as a
 * FAILURE — CI supplies every input a skip-capable check needs, so it accepts no skip. Emitting the
 * declared 3 into CI would therefore turn
 * this rung's COMMONEST outcome — a branch that changes no mutable TypeScript, i.e. every corpus,
 * docs and config landing — into a red on a PR that did nothing wrong. That is the same dishonesty
 * the skip protocol exists to remove, with the sign flipped.
 *
 * WITHHOLD THE CODE, NEVER THE FACT. Both dispositions print; a CI reader sees `NOTHING TO MUTATE`
 * and knows this run proved nothing, exactly as a local reader sees `SKIP`. What must not happen is
 * a CI run that is silently indistinguishable from a rung that ran and passed.
 *
 * `gateSkipExitCode` is the CALLER's, not re-declared here: `GATE_SKIP_EXIT_CODE` is owned by
 * `gate-runner.ts`, and a second literal 3 in the pure core is exactly the drift that would let the
 * protocol change on one side only. CI's 0 is not the caller's code and never can be — it is the
 * one branch whose whole point is to not carry it.
 *
 * The shape is `check-web-experience-closure.ts`'s bootstrap branch, which established it; this is
 * the third rung to need it and the first whose skip fires on ordinary everyday landings.
 */
export function skipDisposition(args: {
  /** `process.env.CI === "true"` — measured by the shell, never guessed here. */
  readonly inCi: boolean;
  /** `GATE_SKIP_EXIT_CODE`, passed in so this module owns no copy of it. */
  readonly gateSkipExitCode: number;
}): SkipDisposition {
  if (args.inCi) return { exitCode: 0, label: "NOTHING TO MUTATE" };
  return { exitCode: args.gateSkipExitCode, label: "SKIP" };
}

/** What a branch that changed NO test file should do — see {@link noChangedTestOutcome}. */
export type NoChangedTestOutcome =
  | { readonly kind: "skip"; readonly exitCode: number; readonly label: string }
  | { readonly kind: "fail" };

/**
 * A branch that adds or changes NO test file, but does change selected source: red, or skip?
 *
 * NORMALLY RED, and that is the rung's whole point — it asks whether THIS branch's own tests kill
 * the mutants in its own changed lines, and with no changed test the answer is no by construction.
 *
 * THE ONE EXCEPTION IS A DIFF THAT ADDS NO CODE. A landing that DELETES code and corrects the
 * comment naming it selects its file (the selection is textual, not syntactic) while adding only
 * comment lines — so there is no mutant for any test to kill, and "no changed test" is evidence of
 * nothing. Without this branch the rung could not PASS a whole class of correct landings, which is
 * the "instrument that cannot PASS" failure its sibling comment-only guard already exists to avoid.
 *
 * ONE SIGNAL HERE, WHERE THE `vacuous` GUARD NEEDS TWO. That guard also requires Stryker to have
 * independently counted zero, because it must tell "ran and found nothing" from "silently did not
 * run" — a distinction that only exists because a run was claimed. No run is claimed here, so the
 * sole question is whether the diff contains a code line at all. The caller answers it with
 * {@link changedLinesAreCodeFree}, which fails CLOSED on an empty source map, an unreadable file
 * and any range it cannot account for, so this can only skip when every changed line is provably
 * blank or comment.
 */
export function noChangedTestOutcome(args: {
  /** {@link changedLinesAreCodeFree} over the selected targets — the caller reads the sources. */
  readonly changedLinesCodeFree: boolean;
  /** `process.env.CI === "true"` — measured by the shell, never guessed here. */
  readonly inCi: boolean;
  /** `GATE_SKIP_EXIT_CODE`, passed in so this module owns no copy of it. */
  readonly gateSkipExitCode: number;
}): NoChangedTestOutcome {
  if (!args.changedLinesCodeFree) return { kind: "fail" };
  const skip = skipDisposition({ inCi: args.inCi, gateSkipExitCode: args.gateSkipExitCode });
  return { kind: "skip", exitCode: skip.exitCode, label: skip.label };
}

/**
 * A `*.uat.test.ts` leg — EXCLUDED from the mutation runner's test set, and this is a repair rather
 * than a weakening.
 *
 * MEASURED 2026-08-28, on clean `origin/main` at 785cc021, with a one-line comment added to
 * `terminal-capture.ts` and another to `terminal-capture.uat.test.ts` purely to force this rung to
 * select them: SIX legs of `terminal-capture.uat.test.ts` failed Stryker's INITIAL DRY RUN with
 * `connect ECONNREFUSED 127.0.0.1:<port>`, and the rung exited 1 having evaluated no mutant at all.
 * The evidence is a clean-main reproduction, not an inference from a branch that was also changing
 * those files.
 *
 * WHY IT HAPPENS. These legs spawn the REAL CLI binary against a REAL fixture door server started in
 * a `before` hook and killed in `after`. Stryker's `perTest` coverage analysis re-runs the suite, and
 * a re-run that does not re-enter `before` finds the door already dead — so the child gets a refused
 * connection. A test that spawns a process and a server is an integration proof; it was never a
 * mutation-kill witness, and it cannot be one inside a sandbox that owns the process lifecycle.
 *
 * WHY EXCLUDING IS THE REPAIR. A dry-run failure aborts the WHOLE rung (`ConfigError: There were
 * failed tests in the initial test run`), so today the rung does not merely lose one witness — it
 * evaluates ZERO mutants and reds, for every branch that touches a spawn-based UAT. Excluding these
 * files is what lets it run and judge the mutants it can judge. The cost is stated rather than
 * hidden: a mutant that ONLY a UAT leg would have killed now reports as a survivor, which is red in
 * the safe direction — it asks for a unit test, it never green-lights an unproven line.
 *
 * ⚠ THIS IS NOT AN OPT-OUT MECHANISM, and it must not become one. {@link entryPointsFromScripts}
 * refuses a curated ignore-list on purpose, and that refusal stands: the rule here is DERIVED from a
 * filename convention this repo already uses for spawn-based acceptance legs, it is narrow to
 * `.uat.test.ts`, and it is PRINTED by the rung so an excluded file is never silent. A session cannot
 * exempt an ordinary unit test by editing a list — it would have to rename the file to claim it is an
 * acceptance leg, which is a visible lie rather than a quiet one.
 */
/**
 * How many Stryker test-runner processes this machine should run — DERIVED from its logical CPU
 * count, never declared.
 *
 * WHY THIS EXISTS (ADR-0509, second lever). The rung shipped with a flat `concurrency: 4`, which is
 * right on a developer desktop and wrong on GitHub. Its 4-vCPU runner has **2 physical cores**, so
 * four CPU-bound bun processes each run at roughly half speed — and Stryker's per-mutant budget is
 * `timeoutFactor * netTime + timeoutMS + timeOverheadMS`, where `netTime` was measured during a dry
 * run that was NOT four-ways contended. The budget is therefore systematically too small for exactly
 * the checks with the largest covering sets. Measured on PR #1808: 115 of 286 mutants UNPROVEN, all
 * timeouts; raising both budget terms took it to 23, every one of them in one file; the same branch
 * on a 12-core box at CI's per-test speed timed out 5 times. Contention, not slow tests.
 *
 * ⚠ A FLAT `2` WOULD FIX GITHUB AND BREAK EVERY DEVELOPER BOX. On a 12-core machine four workers are
 * uncontended and correct, and halving them roughly doubles the rung's wall clock (measured
 * elsewhere: ~18.7 min -> ~37, ~28 -> ~56). The number has to come from the machine.
 *
 * THE RULE: one worker per PHYSICAL core, capped at the 4 the rung shipped with, floored at 1.
 * `logicalCpus / 2` is the physical-core estimate — it assumes 2-way SMT, which holds on GitHub's
 * runners and on every x86 box this repo runs on. On a machine without SMT it under-uses by half,
 * which costs wall clock and can never cause the failure this fixes; that direction is deliberate.
 *
 * The regions this produces — pin these, not a remembered summary of them:
 *   1-3 -> 1 · 4-5 -> 2 · 6-7 -> 3 · >=8 -> 4 (the cap)
 * so GitHub's 4 vCPUs give 2 and any 8-or-more-thread box keeps the shipped 4.
 *
 * Pure and total by construction: a non-finite or absurd input still lands inside [1, 4], because a
 * concurrency of 0 would make Stryker evaluate nothing while reporting success.
 */
export function concurrencyFor(logicalCpus: number): number {
  if (!Number.isFinite(logicalCpus)) return 1;
  return Math.min(4, Math.max(1, Math.floor(logicalCpus / 2)));
}

export function isSpawnUatTest(file: string): boolean {
  return file.endsWith(".uat.test.ts");
}

/**
 * The executable ENTRY POINTS a root `package.json` invokes directly — exempt from mutation.
 *
 * WHY THIS EXEMPTION EXISTS, AND WHY IT IS MECHANICAL RATHER THAN A LIST SOMEONE CURATES. This arc
 * already measured the case: increment 1 found `ingest-merge.ts` scoring WORST of everything at
 * 31.11% **with no defect at all**, because half of it is a private `main()` that opens a real Cloud
 * SQL pool — code a hermetic unit test cannot exercise by construction. That finding is ADR-0447's
 * own evidence for refusing a mutation-score ceiling. A rung that reds a landing over mutants in a
 * process shell is measuring the shape of the file, not the strength of the tests.
 *
 * THE RULE IS DERIVED, NOT DECLARED, and that is what stops it becoming a dumping ground: a file is
 * exempt only because a root script INVOKES it, which is a fact about the repo that is visible in
 * `package.json` and changes only when someone adds a script. There is no opt-out comment, no
 * ignore-file, and nothing a session can add to this set without also adding a runnable command.
 * Every exemption is PRINTED by the rung, so it is never silent.
 *
 * The parse resolves `-C <dir>` because that is how every `check:*` script in this repo is written
 * (`pnpm -C packages/cli exec node … src/foo.ts`), so the `.ts` token is relative to that dir and
 * NOT to the repo root. Reading it as repo-relative would exempt a path that does not exist, which
 * fails in the dangerous direction — it would exempt nothing while appearing to work.
 */
export function entryPointsFromScripts(scripts: Readonly<Record<string, string>>): string[] {
  const found = new Set<string>();
  for (const command of Object.values(scripts)) {
    // Stryker disable next-line all: EQUIVALENT — the split pattern and the empty-token filter are
    // mutually redundant. Narrowing the pattern to a single whitespace char yields empty tokens the
    // filter drops; dropping the filter leaves empty tokens no later branch matches. Neither shows.
    const tokens = command.split(/\s+/).filter((t) => t !== "");
    const dirFlag = tokens.indexOf("-C");
    const base = dirFlag >= 0 ? normalise(tokens[dirFlag + 1] ?? "") : "";
    for (const token of tokens) {
      if (!token.endsWith(".ts") || token.startsWith("-")) continue;
      // Stryker disable next-line ConditionalExpression,StringLiteral: EQUIVALENT — when base is empty, resolvePosix("", token) returns exactly normalise(token), so both arms of this ternary agree and no mutation of the test can be observed. The branch exists for clarity, not behaviour.
      found.add(base === "" ? normalise(token) : resolvePosix(base, normalise(token)));
    }
  }
  return [...found].sort();
}

/**
 * The PROBE modules a mirror registry spawns as processes — exempt for exactly the reason
 * {@link entryPointsFromScripts}' subjects are.
 *
 * WHY THIS EXISTS, and why it is not a widening of the exemption's principle. A mirror probe is an
 * executable entry point in every sense that matters here: it is a top-level script that reads
 * `process.argv`, prints JSON to stdout, and `process.exit(2)`s when it is invoked with no fixture
 * path. `check-mirror-conformance.ts` spawns it in its own process; nothing imports it. It differs
 * from a `check:*` script in ONE respect — the thing that invokes it is the `MIRRORS` registry rather
 * than a root `package.json` script — and that is a difference in WHO holds the invocation, not in
 * what the file is.
 *
 * ⚠ IT IS A REPAIR, NOT AN ACCOMMODATION FOR THIS BRANCH. Left unexempt, a probe in the mutation
 * scope does not merely score badly: Stryker's dry run LOADS the instrumented module, the module
 * exits 2 on the spot, and the whole rung dies with `Something went wrong in the initial test run` —
 * evaluating ZERO mutants and reporting `nothing was proved`. That is the same whole-rung abort
 * `isSpawnUatTest` was written to cure, arriving through a different door. It is LATENT on every
 * probe in the registry today: the four existing pairs are simply never in a branch's changed set.
 * Measured 2026-08-29 — with the two new probes present the rung aborted; with them absent it ran
 * and counted 731 mutants over the same branch.
 *
 * THE RULE STAYS DERIVED, which is what {@link entryPointsFromScripts}' own note insists on. A file
 * is exempt only because a registry row NAMES it as one of a pair's two probes, which is a fact
 * visible in `mirror-conformance.ts` and changes only when someone registers a real pair — and a
 * registered pair is itself proven, by `check:mirror-conformance`, over both surfaces' real
 * dispatchers. There is no opt-out comment and no ignore-file. Every exemption is PRINTED by the
 * rung, so it is never silent.
 *
 * Typed structurally rather than by importing `MirrorTarget`: this module is the pure core and must
 * not grow a dependency on the registry it reads a shape from.
 */
/**
 * The executable ENTRY POINTS a repo shell script invokes — the THIRD kind, exempt for the reason
 * the other two are.
 *
 * WHY A THIRD SOURCE WAS NEEDED, measured 2026-08-31. The two derivations beside this one see a file
 * a root `package.json` script names, and a probe the mirror registry spawns. Neither can see
 * `packages/cli/src/ambient-presence-entry.ts`, which is invoked by `scripts/presence-hook.sh` —
 * itself named in `.claude/settings.json`'s `SessionStart` block. It is an entry point by every
 * property that matters here (nothing imports it, and it ends `void main().finally(() =>
 * process.exit(0))`), and it was invisible to the exemption purely because its invoker is a shell
 * script rather than an npm script.
 *
 * ⚠ THE FAILURE IT PRODUCES NAMES NOTHING, which is why this is worth a derivation rather than a
 * note. Adding that file to the mutate set makes the runner LOAD it, its module-scope
 * `process.exit(0)` kills the bun test process before a single test is discovered, and the rung
 * aborts with `No tests were found` — pointing at the test configuration, which is fine. It does not
 * even need a mutant: reproduced with the file instrumented to **0 mutant(s)** and the run still
 * died. That is the same whole-rung abort {@link entryPointsFromMirrorRegistry} exists to prevent,
 * arriving through a door it does not watch.
 *
 * DERIVED, NOT DECLARED, on the same rule as its siblings: a file is exempt only because a script in
 * the repo INVOKES it. There is no opt-out comment and no ignore list — the only way into this set is
 * to add a real invocation to a real script, and every exemption is printed by the rung.
 *
 * Takes the scripts' CONTENTS rather than their paths so it stays pure and testable offline; the
 * caller does the read. The filenames are not passed because nothing here needs them: an exemption is
 * a fact about the file being INVOKED, never about which script invoked it.
 */
export function entryPointsFromShellScripts(scriptContents: readonly string[]): string[] {
  const found = new Set<string>();
  // A path-shaped token ending in `.ts`. The `\b` matters: without it this also matches the `tsx`
  // binary path every hook launcher resolves (`packages/cli/node_modules/.bin/tsx`), exempting a
  // directory rather than an entry point. Quotes and `$`-interpolation are not path characters, so
  // the class ends the match for us and `rel_entry="packages/cli/src/x.ts"` yields the bare path.
  const pathish = /[A-Za-z0-9_./-]+\.ts\b/g;
  for (const contents of scriptContents) {
    for (const [token] of contents.matchAll(pathish)) {
      // A bare `foo.ts` with no directory is not a repo path a script could invoke; requiring the
      // separator keeps a word in a comment from exempting a file that happens to share its name.
      if (!token.includes("/")) continue;
      found.add(normalise(token));
    }
  }
  return [...found].sort();
}

/**
 * The gate's CHECK files — the FOURTH kind of entry point, and the one ADR-0606 D1 makes true by
 * construction: `pnpm gate` finds a check by its FILE NAME (`check-<name>.ts` / `<name>-check.ts`)
 * and runs it as a program, so a file named like a check is invoked whether or not any script names
 * it, and registering a new check is writing that one file.
 *
 * A RETIRED check is the case that forced this, measured 2026-09-24: it keeps its file (ADR-0311 D5)
 * and still runs its `main()` on import, but no script names it any more — so the first branch to
 * touch one (by adding its retired declaration) made it a mutation target, the runner LOADED it, its
 * `main()` dialled the live store from inside the Stryker sandbox, and the whole rung aborted at the
 * dry run with "Something went wrong in the initial test run". The same shape as
 * {@link entryPointsFromShellScripts}' measured case, through a fourth door.
 *
 * DERIVED from the same predicate the gate discovers checks with ({@link checkNameFor}), so the two
 * can never disagree about what a check file is.
 */
export function entryPointsFromCheckNames(files: readonly string[]): string[] {
  return files
    .map(normalise)
    .filter((file) => checkNameFor(file.slice(file.lastIndexOf("/") + 1)) !== undefined);
}

export function entryPointsFromMirrorRegistry(
  targets: readonly { readonly reference: { readonly file: string }; readonly mirror: { readonly file: string } }[],
): string[] {
  const found = new Set<string>();
  for (const target of targets) {
    found.add(normalise(target.reference.file));
    found.add(normalise(target.mirror.file));
  }
  return [...found].sort();
}

/** Join two posix fragments, collapsing `.` and `..` — no `node:path`, so this stays pure. */
function resolvePosix(base: string, rel: string): string {
  const segments: string[] = [];
  for (const segment of `${base}/${rel}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

/**
 * The test file that sits beside a source file, by this repo's convention (`foo.ts` → `foo.test.ts`).
 *
 * Used to widen the test set beyond the branch's own CHANGED tests, so a mutant killed by the
 * file's existing sibling suite is reported as `killed-by-others` — an accurate, actionable message
 * — rather than as a survivor, which would tell the author nothing caught it when something did.
 */
export function siblingTestFor(sourceFile: string): string {
  return `${normalise(sourceFile).replace(/\.ts$/, "")}.test.ts`;
}

/**
 * Does this test source import the named workspace package — `"<pkg>"` or a `"<pkg>/…"` subpath, in
 * either quote style?
 *
 * Textual, and anchored on the MODULE-LOADING forms — `from`, `import` (static, bare or dynamic) and
 * `require(` — so a re-export or a dynamic `import()` counts, while a quoted string that merely
 * EQUALS the name does not. That anchor was earned: the first version accepted any quoted literal,
 * and the end-to-end probe of this very fix went green because a test fixture carried the untested
 * package's name as a `project:` field. The question it answers is "could a test in this run have
 * MEANT to exercise that package?", which keeps PR #1727's case — a consumer's test reaching a
 * sibling through its package name — on the ADR-0483 BLIND path rather than redding it.
 */
export function referencesPackage(testSource: string, pkg: string): boolean {
  const escaped = pkg.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
  return new RegExp(`(?:\\bfrom|\\bimport|\\brequire)\\s*\\(?\\s*(['"\`])${escaped}(?:/[^'"\`]*)?\\1`).test(testSource);
}

/**
 * The targets in one SHARED run group that nothing in the run could have been meant to witness.
 *
 * WHY PER TARGET, NOT PER GROUP. Every bun project shares one Stryker run, and the group's witness
 * check asked only whether the GROUP had a test. So an untested package's new code went red alone —
 * `NO WITNESS` — and GREEN the moment an unrelated package's change brought its own test into the
 * same group: ADR-0483's BLIND narrowing then excused the untested package's mutants and the run
 * printed PASS. Measured by the 2026-09-24 adversarial pass: seven `NoCoverage` mutants in
 * `packages/studio-members`, a PASS verdict, and nothing in the branch had changed about them. An
 * unrelated change elsewhere must never flip a package's verdict.
 *
 * THE DISCRIMINATOR, and why it is not the obvious one. A target is unwitnessed when it has no OWN
 * witness — no changed test under its dir, no sibling suite beside a changed file — AND no test in
 * the run references its package. The second half is what keeps PR #1727's case where ADR-0483 put
 * it: a consumer's changed test that imports the package IS a witness the author wrote, and the
 * sandbox's blindness to it is the instrument's limit, which ADR-0483 D1/D3 name rather than charge.
 * "Does the package have any test file anywhere on disk?" was the other candidate and it fails the
 * measured probe outright — `studio-members` has plenty of tests, none of which this run ran or
 * which reference the new file.
 */
export function unwitnessedTargets(input: {
  readonly targets: readonly MutationTarget[];
  /** The target's OWN witnesses — changed tests under its dir, plus changed files' sibling suites. */
  readonly ownWitnesses: (target: MutationTarget) => readonly string[];
  /** Every test file the group will run, keyed to its source text. */
  readonly groupTestSources: ReadonlyMap<string, string>;
}): MutationTarget[] {
  const sources = [...input.groupTestSources.values()];
  return input.targets.filter(
    (target) =>
      input.ownWitnesses(target).length === 0 && !sources.some((text) => referencesPackage(text, target.project)),
  );
}

/** git's single-character escapes inside a quoted path. */
const GIT_ESCAPES: Readonly<Record<string, string>> = {
  a: "\x07",
  b: "\b",
  t: "\t",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  '"': '"',
  "\\": "\\",
};

/**
 * Undo git's C-style path quoting: `"b/caf\303\251.ts"` → `b/café.ts`.
 *
 * git quotes a path holding a non-ASCII byte (unless `core.quotePath=false`), a double quote, a
 * backslash or a control character — and a quoted path is NOT a path. The diff parser read it as
 * one, so a changed file with a non-ASCII name was dropped with no word: it ended in `"` rather than
 * `.ts`, matched no project and was never mutated. The shell now asks git not to quote, and this
 * stays as the backstop for the characters git quotes regardless. An unquoted path is returned as is.
 */
export function unquoteGitPath(raw: string): string {
  if (!(raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"'))) return raw;
  const chars = Array.from(raw.slice(1, -1));
  const bytes: number[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i] ?? "";
    const octal = ch === "\\" ? /^[0-7]{3}/.exec(chars.slice(i + 1, i + 4).join("")) : null;
    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      i += 4;
    } else if (ch === "\\") {
      bytes.push(...new TextEncoder().encode(GIT_ESCAPES[chars[i + 1] ?? ""] ?? "\\"));
      i += 2;
    } else {
      bytes.push(...new TextEncoder().encode(ch));
      i += 1;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/**
 * Normalise a path for comparison: backslashes to forward slashes, no leading `./`.
 *
 * Windows is not incidental here. The attribution wire's first patch exists because the plugin wrote
 * a raw `path.join()` result into a generated ES-module specifier, and every path this rung compares
 * arrives from one of three places (git, the workspace scan, Stryker's report) that disagree about
 * separators.
 */
function normalise(p: string): string {
  // Stryker disable next-line MethodExpression: EQUIVALENT — every caller trims its input before calling this (the diff parser slices and trims; the workspace scan reads git output line by line), so the trailing .trim() has nothing left to remove.
  return p.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

/**
 * A `.ts` source file worth mutating: not a declaration, not a test.
 *
 * ⚠ FIXTURES ARE NOT EXCLUDED, and this comment used to say they were — a docstring naming three
 * conditions over a body that implements two. A frozen data module is therefore mutated word by
 * word (measured 2026-08-28: 1,303 of one run's 1,484 mutants, 88%, one `StringLiteral` per
 * captured word). Whether to exclude them, and on what predicate, is friction
 * `mutation-diff-mutates-frozen-data-fixtures` and is not decided here; today's answer is to put a
 * fixture inside its own `.test.ts`, which this function does exclude.
 */
function isMutableSource(file: string): boolean {
  if (!file.endsWith(".ts")) return false;
  if (file.endsWith(".d.ts")) return false;
  return !isTestFile(file);
}

/**
 * A production TypeScript file this rung does NOT mutate purely because of its extension: `.tsx`,
 * `.mts` or `.cts`, not a declaration (`.d.mts` / `.d.cts`) and not a test. Such a file is reported
 * as an `unmutated-extension` narrowing rather than dropped in silence — see {@link NarrowedFile}.
 */
function isUnmutatedExtensionSource(file: string): boolean {
  if (!/\.(tsx|mts|cts)$/.test(file)) return false;
  if (/\.d\.(mts|cts)$/.test(file)) return false;
  return !/\.test\.(tsx|mts|cts)$/.test(file);
}

/** A test file, by this repo's convention (`*.test.ts`, including `*.e2e.test.ts`). */
/**
 * Can this rung's test runner actually EXECUTE a project's suite?
 *
 * The rung runs Stryker's `bun` test runner, which is the only runner that gives per-test
 * attribution here. A project whose own `test` script is `vitest run` is therefore OUT OF ITS
 * REACH — not because its tests are worse, but because they are written against a DOM environment
 * (`window`, jsdom) and a cwd-relative fixture root that the bun runner does not provide. Handing
 * one to Stryker anyway kills the DRY RUN, before a single mutant is tested, with a
 * `ReferenceError: window is not defined` naming a test file the author may not even have written.
 *
 * MEASURED, on the first branch to hit it: a change to `packages/forest-world/src/substrate.ts`
 * that also updated a downstream snapshot in `apps/studio/src/components/TreeViewShell.test.tsx`.
 * The mutation target was correct (one file, one project, both bun-runnable); the STUDIO test came
 * along because the rung collects "this branch's own changed tests" without asking whether it can
 * run them. The rung red on a diff whose own code was fine.
 *
 * The narrowing is reported, never silent — a project this rung cannot reach is a real coverage
 * gap, and a gap nobody can see is worse than one that is named on every run.
 */
export function runsUnderBun(testScript: string | undefined): boolean {
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — this guard is a TYPE narrowing,
  // not a behavioural branch. With it removed, `undefined` reaches `RegExp.test`, which coerces its
  // argument to the string "undefined" — which contains no `bun test` and yields the same `false`.
  // The guard earns its place by keeping the function honest to its own signature, and no input can
  // distinguish the two, so no test can kill this mutant.
  if (testScript === undefined) return false;
  return /(^|[\s&|;])bun\s+test(\s|$)/.test(testScript);
}

/**
 * A test runner Stryker can actually drive here, or `null` for a project out of this rung's reach.
 *
 * TWO, AND THE SECOND IS WHY THIS FUNCTION EXISTS. Until 2026-08-29 the rung asked only
 * {@link runsUnderBun}, so the three workspace projects that do NOT run under Bun were dropped —
 * and the two of them that run `vitest run` are `apps/studio` and `packages/app-surface`, i.e. the
 * repo's entire browser-facing surface. The drop was REPORTED (the driver prints `NARROWED:` for a
 * touched project it cannot reach), so it was never a silent hole; it was an honest hole, and this
 * closes it rather than merely re-describing it.
 *
 * `packages/orchestrator` remains `null` and that exclusion is a DECISION rather than a gap. It runs
 * `node --test`, for which no Stryker runner with per-test attribution exists, and it stays on Node
 * deliberately: `docs/research/bun-runtime-probe-2026-08-22.md` records two measured reasons (Bun
 * makes it slower, 29 s → 57 s, and its `shell-test-executor` suite asserts `NODE_TEST_CONTEXT` as a
 * precondition, which Bun does not set by design). Converting it to reach this rung would be the tail
 * wagging the dog. The driver names it whenever a branch touches it, so the exclusion is visible at
 * the moment it costs something.
 *
 * ORDER MATTERS AND IS NOT ALPHABETICAL. `packages/cli`'s test script is
 * `node … validate-corpus.ts && bun test …` — a compound command. Bun is asked first because a
 * project whose script chains BOTH runners must be driven by the one that owns its `src/` suites,
 * and every compound script in this repo puts the real suite on the Bun leg.
 */
export function runnerFor(testScript: string | undefined): MutationRunner | null {
  if (runsUnderBun(testScript)) return "bun";
  if (runsUnderVitest(testScript)) return "vitest";
  return null;
}

/**
 * Does this project's `test` script run `vitest run`?
 *
 * Deliberately the same SHAPE as {@link runsUnderBun} — a word-boundaried match on the invocation
 * rather than a substring — so `vitest-runner` in some unrelated flag cannot be mistaken for the
 * runner itself. `run` is required: `vitest` alone is watch mode, which would never terminate under
 * Stryker, and a project declaring that is not one this rung can drive.
 */
export function runsUnderVitest(testScript: string | undefined): boolean {
  // Stryker disable next-line ConditionalExpression: EQUIVALENT — this guard is a TYPE narrowing,
  // not a behavioural branch, exactly as in `runsUnderBun` above: with it removed, `undefined`
  // reaches `RegExp.test`, which coerces to the string "undefined", contains no `vitest run`, and
  // yields the same `false`. No input can distinguish the two.
  if (testScript === undefined) return false;
  return /(^|[\s&|;])vitest\s+run(\s|$)/.test(testScript);
}

export function isTestFile(file: string): boolean {
  return file.endsWith(".test.ts") || file.endsWith(".test.tsx");
}

/**
 * Parse `git diff --unified=0`'s NEW-side line spans, per file.
 *
 * ONLY THE NEW SIDE IS MEANINGFUL. A hunk that deletes lines and adds none (`+n,0`) leaves nothing
 * to mutate at that point, so it contributes no range — mutating the survivor of a deletion would
 * be asking about code the branch removed. A hunk header without a count means exactly one line,
 * which is unified-diff's own shorthand and not an edge case to guess at.
 *
 * The parser is deliberately strict about the `+++ b/` marker rather than tracking `diff --git`
 * lines: a rename or a mode change can carry a `diff --git` header with no content hunks at all, and
 * a file with no hunks must produce no ranges rather than an empty-range entry a caller could read
 * as "the whole file".
 */
export function parseUnifiedDiffRanges(diffText: string): ChangedRanges[] {
  const byFile = new Map<string, LineRange[]>();
  let current: string | null = null;

  for (const rawLine of diffText.split("\n")) {
    // Stryker disable next-line Regex: EQUIVALENT — git emits CR only immediately before LF, so an anchored and an unanchored match strip the same character. An interior CR cannot occur in the diff text this reads.
    const line = rawLine.replace(/\r$/, "");

    if (line.startsWith("+++ ")) {
      const target = line.slice(4).trim();
      // `/dev/null` is a deletion: there is no new side, so nothing in it can be mutated.
      // Unquoted FIRST: a quoted path carries its `b/` prefix inside the quotes.
      const unquoted = unquoteGitPath(target);
      current = unquoted === "/dev/null" ? null : normalise(unquoted.replace(/^b\//, ""));
      continue;
    }

    // No `startsWith("@@")` fast path here, deliberately. It would be pure redundancy against the
    // anchored regex below — and redundancy is what makes a mutant unkillable: with both present,
    // removing either leaves behaviour identical, so neither can ever be proven. One anchored check
    // is simpler AND provable.
    if (current === null) continue;

    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (header === null) continue;
    const start = Number(header[1]);
    const count = header[2] === undefined ? 1 : Number(header[2]);
    if (!Number.isFinite(start) || !Number.isFinite(count) || count <= 0) continue;

    const ranges = byFile.get(current) ?? [];
    ranges.push({ start, end: start + count - 1 });
    byFile.set(current, ranges);
  }

  return [...byFile.entries()]
    .map(([file, ranges]) => ({ file, ranges: mergeRanges(ranges) }))
    .sort((a, b) => byUniqueKey(a.file, b.file));
}

/**
 * Order two keys that are unique by construction.
 *
 * Shared by the two places that sort Map-derived collections, which is what makes the equivalence
 * below true ONCE rather than repeated at each call site.
 */
function byUniqueKey(a: string, b: string): number {
  // Stryker disable next-line EqualityOperator: EQUIVALENT — every caller sorts Map keys, which are
  // unique by construction, so `<` and `<=` can never disagree on any input reachable here.
  return a < b ? -1 : 1;
}

/**
 * Coalesce overlapping or adjacent spans.
 *
 * Adjacent spans are merged too (`10-12` + `13-15` → `10-15`): Stryker is handed one glob per span,
 * and two globs describing one contiguous region is the same instruction written twice — it makes
 * the summary lie about how much of the file is in scope.
 */
function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
  // Stryker disable next-line ArithmeticOperator: EQUIVALENT on the secondary key — merging takes Math.max of the ends, so two spans sharing a start produce the same merged span in either order. The PRIMARY key is load-bearing and stays proven.
  const sorted = [...ranges].sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && range.start <= last.end + 1) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, range.end) };
      continue;
    }
    merged.push({ start: range.start, end: range.end });
  }
  return merged;
}

/**
 * Render every narrowed file as one human line — the two kinds worded differently, because they are
 * not the same news.
 *
 * PURE, AND THAT IS THE POINT rather than tidiness. This text is the ONLY thing that makes the
 * rung's blind spot visible to a reader, so a version of it living in the I/O shell would be a
 * report that nothing can test — the precise failure this whole change exists to repair, one level
 * further out. `formatMutationVerdict` is already here for the same reason.
 *
 * `untested-root` is a NOTE: a `scripts/` or `infra/` file no unit test is written against, dropped
 * on purpose so its inevitably-surviving mutants cannot red an honest landing.
 *
 * `declared-test-root` is a GAP: the owning project's own `test` script runs that directory, so its
 * tests execute there and the rung could mutate it — `src/` is simply narrower than the project's
 * own declaration. Widening the boundary to close it is a separate decision with a real cost and is
 * NOT made by this line. Measured on `apps/desktop/electron/` (2026-08-29): mutants are cheap, ~5 s
 * for the 149-line static server, and no Stryker dry-run abort — but 26 of 26 mutants in the
 * 931-line sidecar route table are NO-COVERAGE, no test reaching them at all, so widening today
 * would red the desktop app's most-edited file until that coverage is written.
 */
export function formatNarrowingLines(narrowed: readonly NarrowedFile[]): readonly string[] {
  return narrowed.map((entry) => {
    if (entry.kind === "unmutated-extension") {
      return (
        `NARROWED: ${entry.file} was NOT mutated — it is production code under \`${entry.project}\`'s ` +
        "src/, but its extension is outside this rung's reach (only .ts is mutated). Nothing on " +
        "this branch proves those lines."
      );
    }
    return entry.kind === "declared-test-root"
      ? `NARROWED (GAP): ${entry.file} was NOT mutated — this rung only mutates a project's src/, ` +
        `but \`${entry.project}\`'s own test script runs that directory, so its tests do execute ` +
        "there. Nothing on this branch proves those lines."
      : `NARROWED: ${entry.file} was NOT mutated — it sits outside \`${entry.project}\`'s src/, ` +
        "which no unit test is written against. Dropped on purpose.";
  });
}

/**
 * The directories a project's own `test` script names as suite roots — `["electron/", "src/"]` for
 * `apps/desktop`'s `bun test --timeout 300000 src/ electron/`.
 *
 * WHY THIS IS DERIVED FROM THE SCRIPT AND NOT A LIST. The rung's mutable root is the hardcoded
 * `src/`, and for most projects that IS the project's own answer. Where it is not, the disagreement
 * is a coverage gap, and the only party that can state it without drifting is the project itself:
 * the `test` script is what CI and the gate actually run, so a directory named there is a directory
 * whose tests demonstrably execute. A hand-kept table of exceptions in this file would be a second
 * source of truth for a fact `package.json` already holds, and it would go stale silently and in
 * the reassuring direction — which is the exact failure this whole change is repairing.
 *
 * ⚠ EXISTENCE IS THE FILTER, NOT A DENYLIST OF RUNNER WORDS. The naive parse — "tokens after
 * `bun test` that do not start with `-`" — keeps `300000` out of `--timeout 300000`, and any
 * denylist of runner names (`bun`, `test`, `vitest`, `run`, `pnpm`, `node`, `npx`, …) is a list
 * that must be extended every time a script changes shape, with a silent wrong answer as the cost
 * of forgetting. Asking {@link isDirectory} instead cannot be fooled by a flag value, a runner
 * name, a `&&`, or a file path: none of them are directories. The predicate is the caller's, so
 * this function stays pure and its unit tests need no filesystem.
 *
 * `.` and `..` are refused explicitly. Both ARE directories, and `bun test .` would otherwise
 * declare the whole project a test root — turning a widening this function only ever REPORTS into
 * one that reports everything, which is the same as reporting nothing.
 */
export function declaredTestRoots(args: {
  readonly testScript: string | undefined;
  /** Does this project-relative posix path name a directory? Supplied by the caller — keeps this pure. */
  readonly isDirectory: (relDir: string) => boolean;
}): readonly string[] {
  if (args.testScript === undefined) return [];
  const roots = new Set<string>();
  // Stryker disable next-line Regex: EQUIVALENT — any weakening of `\s+` (to `\s`, say) splits the
  // same script into the same tokens PLUS empty strings between adjacent separators, and the empty
  // guard on the next line drops those. No script can distinguish the two.
  for (const raw of args.testScript.split(/\s+/)) {
    // Stryker disable next-line all: EQUIVALENT — redundant with the {@link isDirectory} filter
    // below, which is the whole design. The empty string is not a directory, so a run that reaches
    // the predicate with it gets the same `continue` by a longer route. The guard is here so the
    // loop reads honestly rather than relying on a predicate three lines away.
    if (raw === "") continue;
    // Stryker disable next-line all: EQUIVALENT — same reason. `--timeout` is not a directory
    // either, so removing this cannot change any result; it exists to say out loud that flags are
    // not suite roots, which is the misreading this function was written to prevent.
    if (raw.startsWith("-")) continue;
    const token = normalise(raw).replace(/\/+$/, "");
    // Stryker disable next-line ConditionalExpression,StringLiteral: EQUIVALENT for the `token === ""`
    // arm alone — it is reachable (a bare `/` strips to nothing) but redundant with `isDirectory`,
    // which answers false for the empty path. The `.` and `..` arms are NOT equivalent and are
    // covered by their own test; Stryker groups them on one line because they share it.
    if (token === "" || token === "." || token === "..") continue;
    if (token.startsWith("../") || token.startsWith("/")) continue;
    if (!args.isDirectory(token)) continue;
    roots.add(`${token}/`);
  }
  return [...roots].sort();
}

/**
 * Decide what this branch's diff puts in scope.
 *
 * `existingFiles` is the caller's answer to "does this path still exist in the working tree?" — a
 * file the branch DELETED still appears in the diff, and handing Stryker a glob for a path that is
 * gone makes it fail on a landing that did nothing wrong.
 *
 * A source file outside every workspace project's `src/` is DROPPED rather than escalated. That is
 * not the fail-wide rule `ci-affected.ts` applies to test SELECTION, and the asymmetry is deliberate:
 * there, failing wide runs more tests, which is safe; here, failing wide would mutate scripts and
 * config that no unit test is written against, and every one of those mutants would survive and red
 * an honest landing. The conservative direction for a mutation rung is to ask LESS, and to say so.
 *
 * ⚠ "AND TO SAY SO" IS THE HALF THAT WAS NOT TRUE, and {@link TargetSelection.narrowed} is the
 * repair. Until 2026-08-29 every drop was surfaced through {@link TargetSelection.skipReason}
 * ALONE, which the driver prints only when there is nothing left to mutate — so the rung announced
 * its narrowing precisely on the branches where it had narrowed away everything and cost nothing,
 * and stayed silent on the branches where it had narrowed away something real. Each dropped file is
 * now returned and printed on EVERY run.
 *
 * `testRootsByProject` is what lets the report distinguish the two kinds. Pass a project's own
 * declared suite roots ({@link declaredTestRoots}) and a file dropped from a directory the project
 * itself says it tests is reported as `declared-test-root` — a genuine gap — rather than as the
 * ordinary conservative drop it is otherwise indistinguishable from. Omitting the map costs only
 * that distinction; every drop is still reported.
 */
export function selectMutationTargets(args: {
  readonly changed: readonly ChangedRanges[];
  readonly projects: readonly ProjectDir[];
  readonly existingFiles: ReadonlySet<string>;
  /** Executable entry points — see {@link entryPointsFromScripts}. Absent means exempt nothing. */
  readonly exemptFiles?: ReadonlySet<string>;
  /**
   * Project NAME → the suite roots that project's own `test` script declares
   * ({@link declaredTestRoots}), project-relative and trailing-slashed. Absent means every drop is
   * reported as `untested-root` — the report stays complete, it just cannot name the worse kind.
   */
  readonly testRootsByProject?: ReadonlyMap<string, readonly string[]>;
}): TargetSelection {
  const { changed, projects, existingFiles } = args;
  const exemptFiles = args.exemptFiles ?? new Set<string>();
  const testRootsByProject = args.testRootsByProject ?? new Map<string, readonly string[]>();
  const narrowed: NarrowedFile[] = [];
  const byProject = new Map<string, { dir: string; globs: string[]; files: string[] }>();
  const changedTestFiles: string[] = [];
  const exempted: string[] = [];
  let droppedOutsideSrc = 0;
  let unmutatedExtension = 0;

  // Longest dir first, so `packages/library` never claims a file inside a hypothetical
  // `packages/library-store`. `startsWith(dir + "/")` already prevents that, but ordering keeps the
  // answer stable if the dir set ever gains a genuine nesting.
  // Stryker disable next-line all: EQUIVALENT — ownership is decided by the exact
  // `startsWith(dir + "/")` test below. This sort only fixes the ORDER in which equally-valid
  // candidates are considered, so no comparator mutation can change which project claims a file.
  const ordered = [...projects].sort((a, b) => b.dir.length - a.dir.length);

  for (const entry of changed) {
    const file = normalise(entry.file);
    if (!existingFiles.has(file)) continue;

    const owner = ordered.find((p) => file.startsWith(`${p.dir}/`));
    if (owner === undefined) continue;

    if (isTestFile(file)) {
      changedTestFiles.push(file);
      continue;
    }
    if (!isMutableSource(file)) {
      // Production code under src/ that this rung cannot mutate only because of its extension. It
      // is NOT admitted (that is a separate policy call) — it is reported, so the skip reason and
      // the NARROWED lines stop implying the branch changed nothing that needed proving.
      if (isUnmutatedExtensionSource(file) && file.startsWith(`${owner.dir}/src/`)) {
        unmutatedExtension += 1;
        narrowed.push({ file, kind: "unmutated-extension", project: owner.name });
      }
      continue;
    }
    if (!file.startsWith(`${owner.dir}/src/`)) {
      droppedOutsideSrc += 1;
      // Stryker disable next-line ArrayDeclaration: EQUIVALENT — the fallback stands for "this
      // project declared no roots", and the ONLY use of the value is `relative.startsWith(root)`.
      // Stryker's replacement is a fixed nonsense string, which prefixes no real path, so the empty
      // array and the replacement agree on every input a test could supply.
      const declared = testRootsByProject.get(owner.name) ?? [];
      // Project-relative, so the declared roots (`src/`, `electron/`) can be matched as prefixes.
      // A project's own `src/` is in `declared` too and needs no special case: reaching this branch
      // MEANS the file is not under `${owner.dir}/src/`, so `relative` cannot start with `src/`. An
      // explicit `root !== "src/"` guard here reads as load-bearing and is unreachable — it survived
      // deletion against the whole suite, which is how it was caught.
      const relative = file.slice(owner.dir.length + 1);
      const inDeclaredRoot = declared.some((root) => relative.startsWith(root));
      narrowed.push({
        file,
        kind: inDeclaredRoot ? "declared-test-root" : "untested-root",
        project: owner.name,
      });
      continue;
    }
    if (exemptFiles.has(file)) {
      exempted.push(file);
      continue;
    }

    const bucket = byProject.get(owner.name) ?? { dir: owner.dir, globs: [], files: [] };
    for (const range of entry.ranges) bucket.globs.push(`${file}:${range.start}-${range.end}`);
    bucket.files.push(file);
    byProject.set(owner.name, bucket);
  }

  const targets: MutationTarget[] = [...byProject.entries()]
    .map(([project, bucket]) => ({
      project,
      dir: bucket.dir,
      mutateGlobs: bucket.globs.sort(),
      sourceFiles: [...new Set(bucket.files)].sort(),
    }))
    .sort((a, b) => byUniqueKey(a.project, b.project));

  const sortedTests = changedTestFiles.sort();
  const sortedExempt = exempted.sort();
  const sortedNarrowed = [...narrowed].sort((a, b) => byUniqueKey(a.file, b.file));
  if (targets.length > 0) {
    return {
      targets,
      changedTestFiles: sortedTests,
      exempted: sortedExempt,
      narrowed: sortedNarrowed,
      skipReason: null,
    };
  }

  const detail: string[] = [];
  if (droppedOutsideSrc > 0) {
    detail.push(`${droppedOutsideSrc} changed .ts file(s) sit outside any project's src/`);
  }
  if (unmutatedExtension > 0) {
    detail.push(
      `${unmutatedExtension} changed production .tsx/.mts/.cts file(s) under a project's src/ ` +
        "were NOT mutated — their extension is outside this rung's reach (only .ts is mutated)",
    );
  }
  if (sortedExempt.length > 0) {
    detail.push(`${sortedExempt.length} are executable entry points (${sortedExempt.join(", ")})`);
  }
  return {
    targets: [],
    changedTestFiles: sortedTests,
    exempted: sortedExempt,
    narrowed: sortedNarrowed,
    skipReason:
      `this branch changes no mutable source under a workspace project's src/` +
      (detail.length > 0 ? ` — ${detail.join("; ")}` : ""),
  };
}

/**
 * Can this ONE line carry a mutant on its own? Blank lines, `//` comments, a block-comment opener
 * and a `*` / `*&#47;` continuation cannot.
 *
 * ⚠ IT FAILS TOWARD "CODE", ALWAYS. Anything this does not recognise is treated as code, so the
 * only mistake it can make on its own is to claim a comment-only change contains code — which
 * makes the rung ask MORE, never less. That direction is not a nicety here: the one caller uses
 * this to decide whether a zero-mutant run may be reported as a SKIP, and a classifier that failed
 * the other way would be a licence to skip a real change.
 *
 * It is deliberately NOT a lexer. A block comment whose interior lines do not begin with `*` reads
 * as code and reds the rung — accepted, because it is the safe direction and because every block
 * comment in this repo is written with `*` continuations. It also does not track string state, and
 * does not need to: see {@link changedLinesAreCodeFree} for why the caller is safe regardless.
 */
export function isCodeFreeLine(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

/**
 * Is EVERY line this branch changed, in every file selected for mutation, incapable of carrying a
 * mutant?
 *
 * ⚠ THIS IS THE SECOND OF TWO SIGNALS, AND IT NEVER SPEAKS ALONE. Its only caller reaches it after
 * Stryker has already run over these exact spans and counted ZERO mutants, and both signals must
 * say "nothing here" before a zero-mutant run may be reported as a skip rather than as the vacuous
 * failure {@link adjudicateMutants} returns. That pairing is what makes the crude classifier above
 * safe: Stryker's own count is the authority on what is mutable (it mutates string and template
 * literals too, so a changed line hiding inside one produces a mutant and never reaches here), and
 * this answers the different question of whether the run can be TRUSTED to have found nothing —
 * a run that silently did not happen still leaves visible code in the diff, and that reds.
 *
 * An empty `sources` map returns false. "I could not read the files" is not "there was nothing in
 * them", and the whole point of the vacuous verdict is that a run which proved nothing is not a
 * pass.
 */
export function changedLinesAreCodeFree(
  changed: readonly ChangedRanges[],
  sources: ReadonlyMap<string, string>,
): boolean {
  if (sources.size === 0) return false;
  for (const entry of changed) {
    const source = sources.get(normalise(entry.file));
    if (source === undefined) continue;
    const lines = source.split("\n");
    for (const range of entry.ranges) {
      for (let line = range.start; line <= range.end; line += 1) {
        // A range past end-of-file is not a blank line, it is a range this rung cannot account for.
        const text = lines[line - 1];
        if (text === undefined || !isCodeFreeLine(text)) return false;
      }
    }
  }
  return true;
}

/**
 * How one mutant was accounted for. Only `"proven"` passes; `"excluded"` and `"unwitnessable"` are
 * not counted at all — and they are not the same absence. `"excluded"` is a status this rung has no
 * opinion about (a compile error, an ignored mutant); `"unwitnessable"` is a mutant this rung was
 * STRUCTURALLY UNABLE to test, which is a gap in the instrument and is named on every run.
 */
export type MutantOutcome =
  | "proven"
  | "killed-by-others"
  | "unproven"
  | "survived"
  | "no-coverage"
  | "unwitnessable"
  | "excluded";

/** The mutation-testing-report-schema v1.0 subset this rung reads. */
export interface MutationReport {
  readonly files?: Readonly<
    Record<string, { readonly mutants?: readonly ReportMutant[] } | undefined>
  >;
  readonly testFiles?: Readonly<
    Record<string, { readonly tests?: readonly ReportTest[] } | undefined>
  >;
}

export interface ReportMutant {
  readonly id?: string;
  readonly mutatorName?: string;
  readonly status?: string;
  readonly killedBy?: readonly string[];
  /**
   * The exact text Stryker substituted. Carried because `file:line [Mutator]` does NOT identify a
   * mutant: one line commonly holds several mutants of the SAME mutator on different spans, and a
   * reader handed only the line applies the replacement to the wrong one. Measured 2026-08-30 on
   * `packages/cli/src/friction.ts:605` — eight mutants, three of them `ConditionalExpression`, on
   * the left operand, the whole condition and the right operand; the survivor was the left operand
   * and the whole condition is killed, so the obvious hand-check disproves the rung and is wrong.
   */
  readonly replacement?: string;
  readonly location?: {
    readonly start?: { readonly line?: number; readonly column?: number };
    readonly end?: { readonly line?: number; readonly column?: number };
  };
}

export interface ReportTest {
  readonly id?: string;
  readonly name?: string;
}

/** One Stryker run's report, with the namespace its test ids are rewritten into. */
export interface ReportPart {
  /**
   * A key unique across the parts of one rung run — e.g. `bun` or `vitest:apps/studio`. It is
   * PREFIXED onto every test id, so it only has to be unique, never meaningful.
   */
  readonly key: string;
  readonly report: MutationReport;
}

/**
 * Fold several Stryker runs into one report the adjudicator can read as if it were a single run.
 *
 * WHY THIS IS NOT `Object.assign`, AND WHY GETTING IT WRONG WOULD READ AS A PASS. Stryker numbers
 * test ids from zero WITHIN EACH RUN. Two runs therefore both contain a test with id `"0"`, and they
 * are different tests in different files. {@link resolveTestFiles} builds ONE `id -> file` map from
 * the merged `testFiles`, so a naive merge silently overwrites the first run's `"0"` with the
 * second's — and every mutant the first run recorded as `killedBy: ["0"]` is then attributed to a
 * file in the OTHER project. The failure is not a crash: the mutant still resolves to *a* test file,
 * so it is scored `proven` or `killed-by-others` against the wrong branch-ownership question. A
 * mutant killed only by an unchanged test in project A could be credited to a changed test in
 * project B and pass. That is this repo's standing fault class — a green check that verified
 * something other than what it claimed — so the ids are NAMESPACED here rather than trusted.
 *
 * Every id is rewritten to `<key>::<id>`, in `testFiles[].tests[].id` and in each mutant's
 * `killedBy`, so an id from one part can never collide with, or be resolved against, another's.
 *
 * FILE ENTRIES ARE CONCATENATED, NEVER REPLACED. The driver partitions projects across runs, so the
 * same source file should not appear twice — but "should not" is an assumption, and a merge that
 * dropped the earlier entry would lose real mutants while still producing a well-formed report.
 * Concatenating keeps every mutant that was actually evaluated; if the partition ever breaks, the
 * result is a duplicated mutant (visible, and red in the safe direction) rather than a vanished one.
 *
 * A part whose `killedBy` names an id its own `testFiles` does not declare stays unresolvable after
 * the rewrite, exactly as it was before it — constraint 4 still calls that `unproven`, and this
 * function deliberately does not repair it.
 */
export function mergeMutationReports(parts: readonly ReportPart[]): MutationReport {
  const files: Record<string, { mutants: ReportMutant[] }> = {};
  const testFiles: Record<string, { tests: ReportTest[] }> = {};

  for (const part of parts) {
    const brand = (id: string) => `${part.key}::${id}`;

    for (const [path, entry] of Object.entries(part.report.files ?? {})) {
      const mutants = (entry?.mutants ?? []).map((m) => {
        // A mutant with no `killedBy` is carried through untouched rather than given an empty one:
        // `undefined` and `[]` are the same to `classify`, but only the first is what the runner said.
        if (m.killedBy === undefined) return m;
        return { ...m, killedBy: m.killedBy.map(brand) };
      });
      const existing = files[path];
      if (existing === undefined) files[path] = { mutants };
      else existing.mutants.push(...mutants);
    }

    for (const [path, entry] of Object.entries(part.report.testFiles ?? {})) {
      const tests = (entry?.tests ?? []).map((t) => {
        // An id-less test cannot be branded — `brand(undefined)` would enter the registry as the
        // real-looking key "<group>::undefined", which a mutant's killedBy could then match.
        if (t.id === undefined) return t;
        return { ...t, id: brand(t.id) };
      });
      const existing = testFiles[path];
      if (existing === undefined) testFiles[path] = { tests };
      else existing.tests.push(...tests);
    }
  }

  return { files, testFiles };
}

/** One adjudicated mutant, carrying enough to explain the verdict without re-reading the report. */
export interface AdjudicatedMutant {
  readonly file: string;
  readonly line: number | null;
  /** 1-based start column of the mutated span; `null` when the report omitted it. */
  readonly column: number | null;
  /** 1-based end column, exclusive — the same convention Stryker's report uses. */
  readonly endColumn: number | null;
  readonly mutator: string;
  readonly status: string;
  readonly outcome: MutantOutcome;
  /** The text Stryker substituted for the span, when the report carried it. */
  readonly replacement: string | null;
  /** Repo-relative test files credited with the kill, when they could be resolved. */
  readonly killedByFiles: readonly string[];
}

export interface MutationVerdict {
  readonly verdict: "pass" | "fail" | "vacuous";
  readonly counted: number;
  readonly mutants: readonly AdjudicatedMutant[];
  readonly reasons: readonly string[];
  /**
   * What this run could NOT ask, in the {@link runsUnderBun} tradition: printed on a pass as well as
   * a failure, because a gap nobody can see is worse than one named on every run. Narrowings never
   * red the gate — they are not the author's doing and there is nothing in the branch to fix.
   */
  readonly narrowings: readonly string[];
}

/**
 * Resolve a test id to the repo-relative test file it lives in.
 *
 * SUFFIX MATCHING IS MANDATORY AND IS NOT A CONVENIENCE. Stryker copies the project into a sandbox
 * whose directory name CHANGES EVERY RUN, and the report's `testFiles` keys are that sandbox's
 * absolute paths. Comparing them to a repo-relative path by equality yields zero matches on every
 * run — which is the exact failure the wire's second patch was written to fix, one layer down. An
 * ambiguous suffix (two files ending the same way) resolves to nothing rather than to a guess.
 */
function resolveTestFiles(report: MutationReport, changedTestFiles: readonly string[]) {
  const idToFile = new Map<string, string>();
  const reportPaths = new Set<string>();

  for (const [rawPath, entry] of Object.entries(report.testFiles ?? {})) {
    const reportPath = normalise(rawPath);
    reportPaths.add(reportPath);
    // Stryker disable next-line ArrayDeclaration: EQUIVALENT — a placeholder element substituted for the empty array carries no string `id`, so the loop body skips it and the registry is unchanged.
    for (const test of entry?.tests ?? []) {
      // Stryker disable next-line ConditionalExpression: EQUIVALENT — forcing this true indexes non-string ids, but `killedBy` holds strings and Map lookup is strict, so a non-string key can never be hit and no attribution changes.
      if (typeof test.id === "string") idToFile.set(test.id, reportPath);
    }
  }

  // THE DIRECTION OF THIS COUNT IS THE WHOLE POINT, and getting it backwards reads as a pass.
  // The question is "how many REPORT paths does this one changed test file match?" — not "how many
  // changed files does this report path match?", which is 1 even when the suffix is hopelessly
  // ambiguous, and would credit every candidate.
  const changedReportPaths = new Set<string>();
  for (const wanted of changedTestFiles.map(normalise)) {
    const hits = [...reportPaths].filter((rp) => rp === wanted || rp.endsWith(`/${wanted}`));
    const only = hits.length === 1 ? hits[0] : undefined;
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — forcing this true adds `undefined` to the set, and every later membership test is against a real normalised path, which `undefined` never equals.
    if (only !== undefined) changedReportPaths.add(only);
  }

  return { idToFile, changedReportPaths };
}

/**
 * The workspace package a repo-relative path belongs to (`packages/cli`, `apps/studio`), or `null`
 * for a repo-root path that belongs to none.
 *
 * The LAST match wins, not the first. Stryker's report keys are the SANDBOX's absolute paths, and a
 * checkout can sit under a directory that happens to be called `packages` — taking the first match
 * would then read the enclosing filesystem as a workspace package on some machines and not others.
 */
export function workspacePackageOf(file: string): string | null {
  // `previous` starts as null rather than "" so the walk carries no sentinel STRING: an initial ""
  // is compared only against "packages" and "apps", so no input could ever distinguish it from any
  // other string, and it would sit here as a permanently unkillable mutant.
  let found: string | null = null;
  let previous: string | null = null;
  for (const segment of normalise(file).split("/")) {
    if ((previous === "packages" || previous === "apps") && segment !== "") found = `${previous}/${segment}`;
    previous = segment;
  }
  return found;
}

/**
 * THE BLIND SPOT THIS RUNG MUST NAME RATHER THAN SCORE. Measured 2026-08-30, end to end.
 *
 * Stryker copies the project into a sandbox and mutates the copy. It also SYMLINKS every
 * `node_modules` it finds, so `<sandbox>/packages/cli/node_modules` points at the REAL
 * `packages/cli/node_modules`, whose `@storytree/library` entry is in turn an ABSOLUTE symlink to
 * the real `packages/library/`. A sandboxed test that imports a workspace sibling BY PACKAGE NAME —
 * which is this repo's stated convention for every cross-package import — therefore loads the
 * UNMUTATED original. Stryker runs the suite against a mutant nothing imported, observes correctly
 * that no test noticed, and records `Survived`.
 *
 * `Survived` is this rung's most severe verdict and reds a merge-blocking PR. Emitting it for a
 * mutant no test in the run COULD have witnessed is a false red with no honest remedy: the author
 * can only write a test that cannot help, or suppress a mutant that was never alive. Both happened
 * on PR #1727, which is where this was found.
 *
 * The predicate is deliberately coarse and derived FROM THE REPORT, never from the config: a mutant
 * in package P is witnessable only if the run actually executed a test file in P. It cannot drift
 * from the run it describes, and it does not need to know how the groups were formed. A mutated
 * file in no workspace package (a repo-root script) is left alone — nothing reaches it through a
 * package symlink.
 *
 * THIS NAMES THE GAP; IT DOES NOT CLOSE IT. Closing it means either `symlinkNodeModules: false`
 * (which copies a pnpm store into every sandbox) or `inPlace: true` (which mutates the real working
 * tree on a shared box). Both are decisions with a cost worth stating before anyone pays it.
 *
 * ⚠ AN EMPTY ANSWER MEANS "CANNOT TELL", AND IT MUST NOT NARROW ANYTHING. A report that enumerates
 * no test file in any workspace package cannot answer the reachability question at all, and reading
 * that silence as "no package ran tests" would excuse EVERY mutant in the run — turning a rung that
 * reds on a real survivor into one that quietly excuses it, which is a far worse failure than the
 * false red this rule exists to remove. Narrowing therefore requires POSITIVE evidence: the run
 * enumerated tests in at least one package, and this file's package is not among them. `null` is
 * returned for the unanswerable case so a caller cannot mistake it for an empty result.
 */
function packagesWithTestsInRun(report: MutationReport): ReadonlySet<string> | null {
  const packages = new Set<string>();
  for (const rawPath of Object.keys(report.testFiles ?? {})) {
    const pkg = workspacePackageOf(rawPath);
    if (pkg !== null) packages.add(pkg);
  }
  return packages.size === 0 ? null : packages;
}

/**
 * The report's "test files" that are not test files — the fingerprint of a runner that could not say
 * which file a test it ran belongs to, and therefore of a per-test coverage map that cannot be read.
 *
 * WHY A SURVIVOR CAN BE FALSE, WHICH THIS RUNG ONCE HELD TO BE IMPOSSIBLE. Measured 2026-09-12 and
 * reproduced end to end. `@hughescr/stryker-bun-runner` attributes coverage POSITIONALLY: its
 * preload numbers each test file's tests in execution order (`<file>@@test-N`) and its mapper
 * resolves bucket N to the Nth inspector test OF THAT FILE, after dropping tests the inspector
 * marked `skip`. A test that skips at RUNTIME — `node:test`'s `t.skip()`, this repo's ordinary way
 * to write a host-conditional test, and live in four test files — has ALREADY had its `beforeEach`
 * run, so it owns a bucket while being dropped from the test side. Buckets then outnumber tests,
 * the pairing silently truncates, and EVERY bucket after the skipped test is attributed to the next
 * test along. Under `coverageAnalysis: "perTest"` Stryker runs, for each mutant, exactly the tests
 * that mis-attributed map names — so the test that actually kills it is never run, and Stryker
 * honestly records `Survived`. On a 34-test file one runtime skip took a suite from 33 genuine
 * survivors to 134.
 *
 * ⚠ A FALSE SURVIVOR IS AN UNSATISFIABLE DEMAND. ADR-0447 made this rung the mechanical instrument
 * for test strength and ADR-0563 D1 routes every test-quality suspicion to it, so a session handed
 * one cannot decline it and cannot satisfy it — you cannot kill a mutant whose covering test was
 * never run. That is the unbounded loop ADR-0563 exists to end, arriving through the instrument
 * that replaced the opinion veto it removed.
 *
 * THE DISCRIMINATOR IS THE PSEUDO-FILE, NOT ZERO COVERAGE, and the obvious alternative is wrong.
 * "A test that covers no mutants means the map is broken" was the first candidate and it does not
 * hold: this rung narrows mutants to the branch's CHANGED lines, so most of a suite legitimately
 * covers none of them, and that signal would fire on nearly every branch and downgrade every
 * genuine survivor — trading a false blocker for a false green, the exact trade ADR-0447 refused.
 * What is NOT normal is a test attributed to something that is not a test file at all. The unpaired
 * test loses its project file, so Stryker falls back to the raw url the inspector gave it, which for
 * a `node:test`-registered suite under bun is the literal string `"node:test"`. Stryker prints its
 * own `not found in input files … This shouldn't happen` warning about it, one layer up.
 *
 * DERIVED FROM THE REPORT, NEVER FROM THE CONFIG, on the same reasoning as `packagesWithTestsInRun`
 * above: it cannot drift from the run it describes. The rung builds its test set with
 * {@link isTestFile} in the first place, so "not a test file by this repo's convention" and "not a
 * file this run asked for" are the same set, and the report-only form needs no plumbing to stay true.
 *
 * ⚠ SUFFICIENT, NOT NECESSARY — the honest limit. This catches a mis-attributed test only when the
 * runner names a non-file. A runner that mis-attributed a test to some OTHER real test file would
 * corrupt the map just as thoroughly and leave no trace here. The primary remedy is therefore the
 * runner itself (`patches/@hughescr__stryker-bun-runner@1.3.8.patch`, third hunk, which pairs
 * against the population the bucket count actually matches); this is the backstop that keeps the
 * rung from ASSERTING a survivor it did not establish.
 */
export function unattributedTestFiles(report: MutationReport): readonly string[] {
  return Object.keys(report.testFiles ?? {})
    .filter((rawPath) => !isTestFile(normalise(rawPath)))
    .sort();
}

/**
 * Adjudicate the report against this branch's own changed tests.
 *
 * A VACUOUS RUN IS ITS OWN VERDICT, distinct from a pass. If the selection said there was source to
 * mutate and the report then contains no counted mutant, something upstream went wrong — a bad glob,
 * a sandbox that failed to build, a plugin that produced an empty report — and reporting that as a
 * pass is precisely the green-check-that-verified-nothing failure this repo keeps re-finding. The
 * caller decides what a vacuous run costs; this function refuses to call it a pass.
 */
export function adjudicateMutants(
  report: MutationReport,
  changedTestFiles: readonly string[],
): MutationVerdict {
  const { idToFile, changedReportPaths } = resolveTestFiles(report, changedTestFiles);
  const ranPackages = packagesWithTestsInRun(report);
  // Asked ONCE for the whole run, because it is a property of the run and not of any one mutant:
  // the positional pairing that produced these pseudo-files shifts attribution for every bucket
  // after the first unpaired test, so no mutant in this report has a coverage set worth reading.
  const pseudoTestFiles = unattributedTestFiles(report);
  const coverageTrusted = pseudoTestFiles.length === 0;
  const mutants: AdjudicatedMutant[] = [];
  const unwitnessablePackages = new Set<string>();

  for (const [rawFile, entry] of Object.entries(report.files ?? {})) {
    const file = normalise(rawFile);
    // The reachability question is asked ONCE PER FILE and BEFORE the status is read, because it is
    // about the run and not about the mutant: when no test in this file's package ran, every status
    // the report carries for it was decided against a copy nothing imported.
    const pkg = workspacePackageOf(file);
    let witnessable = true;
    if (pkg !== null && ranPackages !== null && !ranPackages.has(pkg)) {
      witnessable = false;
      unwitnessablePackages.add(pkg);
    }
    for (const mutant of entry?.mutants ?? []) {
      const status = mutant.status ?? "Unknown";
      const killedByFiles = [
        // Stryker disable next-line ArrayDeclaration: EQUIVALENT — a placeholder element
        // substituted for this empty fallback is not a real test id, so `idToFile.get` returns
        // undefined for it and the filter on the same line removes it again. Nothing downstream
        // can observe the difference.
        ...new Set((mutant.killedBy ?? []).map((id) => idToFile.get(id)).filter((f): f is string => f !== undefined)),
      ];
      mutants.push({
        file,
        line: mutant.location?.start?.line ?? null,
        column: mutant.location?.start?.column ?? null,
        endColumn: mutant.location?.end?.column ?? null,
        mutator: mutant.mutatorName ?? "unknown",
        status,
        replacement: mutant.replacement ?? null,
        outcome: witnessable
          ? classify(status, killedByFiles, changedReportPaths, coverageTrusted)
          : "unwitnessable",
        killedByFiles: killedByFiles.sort(),
      });
    }
  }

  // Worded as `formatNarrowingLines`'s siblings are, because a reader meets them in the same output
  // and they are the same news: something this rung could not ask. That one narrows at SELECTION
  // (a file never mutated); this narrows at ADJUDICATION (a file mutated against a copy no test
  // imported), so it carries its own marker rather than being folded into the other.
  const narrowings = [...unwitnessablePackages].sort().map(
    (pkg) =>
      `NARROWED (BLIND): ${pkg} was mutated but this run executed no test inside it — a test in ` +
      `another package cannot witness a mutant here, because Stryker's sandbox resolves workspace ` +
      `imports back out to the unmutated original. Those mutants are NOT scored.`,
  );

  const counted = mutants.filter((m) => m.outcome !== "excluded" && m.outcome !== "unwitnessable");
  const reasons: string[] = [];
  const tally = (outcome: MutantOutcome): number => counted.filter((m) => m.outcome === outcome).length;

  if (counted.length === 0) {
    return {
      verdict: "vacuous",
      counted: 0,
      mutants,
      reasons: [
        "source was selected for mutation but the report counted no mutants — the run proved nothing, which is not a pass",
      ],
      narrowings,
    };
  }

  const survived = tally("survived");
  const noCoverage = tally("no-coverage");
  const others = tally("killed-by-others");
  // UNPROVEN is TWO conditions, and they want OPPOSITE remedies, so they are tallied and printed
  // apart. A Timeout means the covering tests ran past Stryker's per-mutant budget — the mutant
  // made the suite hang, or the tests it covers are too slow for the budget on this machine — and
  // no attribution work can clear it. A Killed mutant with no resolvable killer is the attribution
  // layer failing. One sentence for both sent PR #1808's session down the attribution path for an
  // hour on a 108-timeout wall (friction `timeout-killed-and-unattributable-mutants-report-identically`,
  // `friction-unproven-message-names-one-of-two-conditions`).
  // `counted` holds no excluded or unwitnessable mutant, and `classify` maps EVERY Timeout to
  // `unproven`, so a Timeout in this set IS an unproven mutant — an `outcome === "unproven"` guard
  // beside `isTimeout` would be a clause no input can make load-bearing (the rung reported exactly
  // that survivor on this line's first run, and the answer is to delete the clause, not to test it).
  const timedOut = counted.filter(isTimeout).length;
  // The third UNPROVEN condition, subtracted for the same reason the second one is: its remedy is
  // neither a better test nor a faster one, but a repair to the runner — so it must not be printed
  // in a sentence that tells the author to write tests.
  const untrusted = counted.filter(isUntrustedCoverage).length;
  const unattributed = tally("unproven") - timedOut - untrusted;

  if (survived > 0) reasons.push(`${survived} mutant(s) SURVIVED — no test noticed the change`);
  if (noCoverage > 0) reasons.push(`${noCoverage} mutant(s) had NO COVERAGE — no test reaches this line`);
  if (others > 0) {
    reasons.push(
      `${others} mutant(s) were killed only by tests this branch did not touch — the branch's own tests do not discriminate them`,
    );
  }
  if (unattributed > 0) {
    reasons.push(
      `${unattributed} mutant(s) are UNPROVEN — killed, but the report named no test (constraint 4: never a pass, never a survivor)`,
    );
  }
  if (timedOut > 0) {
    reasons.push(
      `${timedOut} mutant(s) are UNPROVEN — TIMED OUT: the covering tests ran past Stryker's per-mutant budget, so either the mutant makes the suite hang or those tests are too slow for the budget on this machine; no test could be named (constraint 4: never a pass, never a survivor)`,
    );
  }
  if (untrusted > 0) {
    // ONE template literal rather than seven concatenated lines, and that is a mutation-rung
    // consequence rather than a formatting preference: Stryker mutates each string literal
    // separately, so a sentence built from seven pieces is seven mutants and a test asserting one
    // phrase leaves six survivors no assertion can reach without quoting the whole paragraph back.
    // Its siblings above are written the same way for the same reason.
    reasons.push(
      `${untrusted} mutant(s) are UNPROVEN — BROKEN COVERAGE MAP: the runner attributed a test to ${pseudoTestFiles.map((f) => `"${f}"`).join(", ")}, which is not a test file, so it could not say which file that test ran in. Its per-test coverage map is therefore built from a truncated pairing that shifts every bucket after the unpaired test, and the SURVIVED / NO COVERAGE verdicts that rest on it are not findings — the covering test may never have been run. Nothing in this branch's tests can clear this; the fix is in the runner (constraint 4: never a pass, never a survivor)`,
    );
  }

  return {
    verdict: reasons.length === 0 ? "pass" : "fail",
    counted: counted.length,
    mutants,
    reasons,
    narrowings,
  };
}

/**
 * Did this run count nothing BECAUSE everything it found was structurally unwitnessable?
 *
 * The shell needs this fork because the two ways to count nothing want opposite treatment. A report
 * that carried no mutant at all is the `vacuous` failure the rung already refuses to call a pass —
 * a bad glob, a sandbox that failed to build. A report full of mutants in a package whose tests
 * never ran is a NARROWED run: it proved nothing, it says exactly why, and there is nothing the
 * branch could change to make it prove more. Redding a PR for that is the false red this whole
 * change exists to remove.
 *
 * ONE SIGNAL IS ENOUGH HERE, unlike the comment-only skip alongside it, and the difference is
 * where the evidence comes from. That one infers a fact about the DIFF from a report that never saw
 * the diff, so it needs a second, independent reading of the source. This one is derived entirely
 * from the report — the packages it mutated, and the packages whose tests it ran — so the report is
 * already the primary witness to its own blindness.
 */
export function isNarrowedToNothing(verdict: MutationVerdict): boolean {
  // Two clauses, not three: an unwitnessable mutant ALWAYS produces a narrowing, so also testing
  // `narrowings.length > 0` would be a clause no input can make false while the second is true —
  // dead, and therefore an unkillable mutant, which is the shape this rung exists to refuse.
  return verdict.verdict === "vacuous" && verdict.mutants.some((m) => m.outcome === "unwitnessable");
}

/**
 * Did Stryker record this mutant as a Timeout — the suite ran past its per-mutant budget?
 *
 * The one UNPROVEN sub-condition the report can name. Read off the raw `status`, never off the
 * outcome, because `classify` folds Timeout and an unattributed Killed into the same outcome on
 * purpose (neither is a pass, neither is a survivor) and only the status still tells them apart.
 */
export function isTimeout(mutant: Pick<AdjudicatedMutant, "status">): boolean {
  return mutant.status === "Timeout";
}

/**
 * Was this mutant downgraded to UNPROVEN because the run's coverage map could not be read?
 *
 * The sibling of {@link isTimeout}, and read the same way: off the RAW status, because `classify`
 * folds every un-scoreable state into `unproven` on purpose and only the status still says which
 * one. `Survived` and `NoCoverage` are the two verdicts derived from the coverage map, so an
 * `unproven` mutant still carrying one of them was downgraded by {@link unattributedTestFiles} —
 * that pairing exists nowhere else, which is why no extra field has to be carried to detect it.
 */
export function isUntrustedCoverage(
  mutant: Pick<AdjudicatedMutant, "status" | "outcome">,
): boolean {
  return (
    mutant.outcome === "unproven" && (mutant.status === "Survived" || mutant.status === "NoCoverage")
  );
}

/** The per-mutant rule. Kept separate so the table of statuses is readable in one screen. */
function classify(
  status: string,
  killedByFiles: readonly string[],
  changedReportPaths: ReadonlySet<string>,
  coverageTrusted: boolean,
): MutantOutcome {
  switch (status) {
    // THE TWO VERDICTS THAT READ THE COVERAGE MAP. `Survived` means every test the map named ran
    // and none noticed; `NoCoverage` means the map named none at all. Both are statements ABOUT the
    // map, so when `unattributedTestFiles` shows the map was built from a truncated pairing, neither
    // is a finding — the covering test may simply never have been run. `unproven` is already the
    // verdict for "the instrument could not tell": never a pass, never a survivor. No new outcome is
    // needed and none is added.
    //
    // `Killed` is deliberately NOT downgraded. Its `killedBy` is resolved from the test that
    // actually failed in the mutant run and matched back by NAME, not through the positional
    // coverage map — a real kill by a real named test survives a broken map, and calling it unproven
    // would throw away the one thing the run did establish.
    case "Survived":
      return coverageTrusted ? "survived" : "unproven";
    case "NoCoverage":
      return coverageTrusted ? "no-coverage" : "unproven";
    case "Killed": {
      // Constraint 4. An unresolvable `killedBy` is NOT IDENTIFIABLE, and the two failure shapes it
      // can hide point opposite ways — so it is neither a pass nor a survivor.
      //
      // Testing only the RESOLVED set is deliberate and complete: `killedByFiles` is derived from
      // `killedByIds`, so an empty id list always yields an empty file list. An extra
      // `killedByIds.length === 0` clause would be dead — and a dead clause is an unkillable mutant,
      // because removing it changes nothing.
      if (killedByFiles.length === 0) return "unproven";
      return killedByFiles.some((f) => changedReportPaths.has(f)) ? "proven" : "killed-by-others";
    }
    case "Timeout":
      // The suite hung rather than asserting. Something died under the mutant, but nothing named a
      // test, so this cannot be credited to the branch's own tests.
      return "unproven";
    default:
      // CompileError, Ignored, RuntimeError and anything a future schema adds: not a signal about
      // this branch's tests. Excluded from the count rather than silently scored either way.
      return "excluded";
  }
}

/**
 * Name one mutant so a reader can act on it, which means naming the SPAN and not just the line.
 *
 * `file:line [Mutator]` does not identify a mutant. Measured 2026-08-30: `packages/cli/src/friction.ts:605`
 * carries eight mutants, three of them `ConditionalExpression`, on the left operand, the whole
 * condition and the right operand. Only the left operand survived, and the whole-condition mutant —
 * the one a reader naturally reaches for — is killed. The session that hand-checked it therefore
 * disproved a mutant the rung never reported, and filed the rung itself as broken.
 *
 * `sources` is optional so the pure core stays pure: with it the line quotes the ORIGINAL text, and
 * without it the columns still pin the span exactly.
 */
function describeMutant(mutant: AdjudicatedMutant, sources?: ReadonlyMap<string, string>): string {
  const span = completeSpan(mutant);
  const where =
    span === null
      ? mutant.line === null
        ? mutant.file
        : `${mutant.file}:${mutant.line}`
      : `${mutant.file}:${span.line}:${span.column}-${span.endColumn}`;
  const head = `${where} [${mutant.mutator}]`;
  if (mutant.replacement === null) return head;
  const text = sources === undefined ? undefined : sources.get(mutant.file);
  const original = span === null ? null : originalSpan(text, span);
  if (original === null) return `${head} -> ${quote(mutant.replacement)}`;
  return `${head} ${quote(original)} -> ${quote(mutant.replacement)}`;
}

/** Wrap a fragment of source in backticks so a reader can see its exact extent, whitespace included. */
function quote(text: string): string {
  return `\`${text}\``;
}

/** A one-line span the report carried in full. */
interface MutantSpan {
  readonly line: number;
  readonly column: number;
  readonly endColumn: number;
}

/**
 * The mutant's span, or `null` when the report left any part of it out.
 *
 * ONE completeness test, shared by the label and the quote, rather than one in each: a second copy
 * is a branch no input can reach independently, and an unreachable branch is an unkillable mutant.
 */
function completeSpan(mutant: AdjudicatedMutant): MutantSpan | null {
  const { line, column, endColumn } = mutant;
  if (line === null || column === null || endColumn === null) return null;
  return { line, column, endColumn };
}

/**
 * The source text the mutant replaced, when the caller supplied the file.
 *
 * A MULTI-LINE SPAN IS DELIBERATELY NOT RECONSTRUCTED. Stryker mutates whole block statements and
 * arrow bodies, so a span can run for pages: quoting it would bury the verdict, and quoting a
 * TRUNCATION of it would hand the reader something that is not the mutated text — the exact class of
 * near-miss this function exists to remove. A span whose end runs past the line it starts on is one
 * of those, and is declined rather than clipped; the columns still name it unambiguously.
 */
function originalSpan(text: string | undefined, span: MutantSpan): string | null {
  if (text === undefined) return null;
  const line = text.split(/\r?\n/)[span.line - 1];
  if (line === undefined) return null;
  if (span.endColumn <= span.column) return null;
  if (span.endColumn - 1 > line.length) return null;
  return line.slice(span.column - 1, span.endColumn - 1);
}

/**
 * Render the verdict for a terminal. Pure — the caller owns the exit code.
 *
 * `sources` maps a repo-relative changed source file to its text, and is optional: supplying it
 * quotes each mutant's original span beside its replacement, and omitting it falls back to columns.
 */
export function formatMutationVerdict(
  tag: string,
  verdict: MutationVerdict,
  targets: readonly MutationTarget[],
  sources?: ReadonlyMap<string, string>,
): string {
  const lines: string[] = [];
  const files = targets.flatMap((t) => t.sourceFiles);
  const spans = targets.reduce((n, t) => n + t.mutateGlobs.length, 0);

  lines.push(`${tag} ${files.length} changed source file(s), ${spans} changed line span(s), ${verdict.counted} mutant(s) counted`);

  // NARROWINGS PRINT ON A PASS TOO. A run that could not reach a package is a real gap in this rung,
  // and a green line with the gap omitted is exactly the reassuring silence the rung exists to deny.
  for (const narrowing of verdict.narrowings) lines.push(`${tag} ${narrowing}`);

  if (verdict.verdict === "pass") {
    // The unqualified sentence is true only when nothing was narrowed. Under a BLIND narrowing it
    // contradicted the lines just above it — "every mutant … was killed" beneath "those mutants are
    // NOT scored" — and a reader who stops at the verdict line takes the false one.
    lines.push(
      verdict.narrowings.length === 0
        ? `${tag} PASS — every mutant in this branch's changed lines was killed by this branch's own tests`
        : `${tag} PASS — every SCORED mutant in this branch's changed lines was killed by this branch's own tests; the NARROWED package(s) above were mutated but NOT scored, so nothing here proves their tests`,
    );
    return lines.join("\n");
  }

  for (const reason of verdict.reasons) lines.push(`${tag} ${reason}`);

  const failing = verdict.mutants.filter((m) => m.outcome !== "proven" && m.outcome !== "excluded");
  for (const mutant of failing.slice(0, 25)) {
    // A timed-out mutant says so on its own line: "no test named" is true of it too, but it is the
    // WRONG cue — it reads as an attribution gap, and the remedy for a timeout is the loop or the
    // fixture, never the report.
    const credit =
      mutant.killedByFiles.length === 0
        ? isTimeout(mutant)
          ? "timed out — no test could be named"
          : // Same reasoning as the timeout line above, one condition further: "no test named" is
            // true of a map-downgraded mutant too and is the WRONG cue, because it reads as a gap in
            // THIS branch's tests when the gap is in the runner. It also has to say what Stryker
            // originally recorded, or the reader cannot tell which verdict was withdrawn.
            isUntrustedCoverage(mutant)
            ? `recorded ${mutant.status}, withdrawn — the run's coverage map is not readable`
            : "no test named"
        : `killed by ${mutant.killedByFiles.join(", ")}`;
    lines.push(`${tag}   ${mutant.outcome.toUpperCase()} ${describeMutant(mutant, sources)} — ${credit}`);
  }
  if (failing.length > 25) lines.push(`${tag}   … and ${failing.length - 25} more`);

  lines.push(
    `${tag} The rung asks only about the lines THIS branch changed. Strengthen this branch's own tests until each`,
  );
  lines.push(`${tag} mutant above is caught, or record why the mutant is equivalent and cannot be killed.`);
  lines.push(
    `${tag} To hand-check one, replace EXACTLY the quoted span at those columns: a line often carries several`,
  );
  lines.push(`${tag} mutants of one mutator, and replacing the wrong one disproves a mutant nobody reported.`);
  return lines.join("\n");
}

/**
 * The `Ignored` status, as `mutation-testing-report-schema` spells it.
 *
 * Named because this is the one place the rung READS it as a signal rather than folding it away.
 * {@link classify} maps it to `"excluded"` along with every other status the rung has no opinion
 * about, which is right for scoring and throws away exactly the fact the audit below needs.
 */
const IGNORED_STATUS = "Ignored";

/**
 * A `Stryker disable next-line <MutatorA,MutatorB>` directive, anchored to a comment OPENER.
 *
 * The anchoring is load bearing, not tidiness — see {@link parseSuppressionDirectives}.
 */
const SUPPRESSION_PATTERN =
  /(?:\/\/|\/\*)\s*Stryker\s+disable\s+next-line\s+([A-Za-z][A-Za-z0-9]*(?:\s*,\s*[A-Za-z][A-Za-z0-9]*)*)/;

/**
 * One `// Stryker disable next-line <mutators>` directive, as WRITTEN in the source.
 *
 * The `next-line` form ONLY, and that is a scope decision rather than an oversight. It is what the
 * measured failure wears (a comment between two links of a chained expression), it is ~88% of this
 * repo's directives, and it is the only form with ONE unambiguous target line. The block form
 * (`disable X` … `restore X`) spans a range whose end may sit outside the changed spans entirely, so
 * "it suppressed nothing HERE" would not be evidence of anything about it.
 */
export interface SuppressionDirective {
  /** Repo-relative, as the `sources` map keys it. */
  readonly file: string;
  /** 1-based line the COMMENT itself sits on. */
  readonly line: number;
  /**
   * 1-based line it actually suppresses: the next line carrying CODE, not `line + 1`.
   *
   * ⚠ `next-line` does NOT mean the next line of the file, and assuming it does makes this whole
   * audit a false-positive machine. Stryker attaches a directive to the NODE its comment block
   * leads, so the rest of a multi-line justification is skipped — and a multi-line justification is
   * the house style here, because ADR-0478 asks for an adversarial one. MEASURED on this module's
   * own directives: comments on lines 1672 and 1727 produced `Ignored` mutants on 1675 and 1730,
   * three lines down in both cases. An earlier draft of this function used `line + 1` and reported
   * both of them as suppressing nothing.
   */
  readonly targetLine: number;
  /** The mutator names it names; the single entry `"all"` is Stryker's own wildcard. */
  readonly mutators: readonly string[];
}

/**
 * A directive that named a mutator and did NOT suppress it.
 *
 * `"inert"` is the friction's own shape: the target line still carries a live mutant of the named
 * mutator, so the directive generated no `Ignored` and the reader is looking at a survivor they
 * believe is suppressed. `"unmatched"` is the weaker sibling — the line carries no mutant of that
 * mutator at all, which is a directive left behind by a refactor or a mis-spelled mutator name.
 */
export type SuppressionFindingKind = "inert" | "unmatched";

export interface SuppressionFinding {
  readonly file: string;
  readonly line: number;
  readonly targetLine: number;
  readonly mutator: string;
  readonly kind: SuppressionFindingKind;
  /** The statuses Stryker actually recorded on the target line for this mutator, sorted. */
  readonly statuses: readonly string[];
}

export interface SuppressionAudit {
  /** Directives whose target line this run actually instrumented — the only ones it can judge. */
  readonly audited: number;
  /** Directive x mutator pairs judged; a `disable next-line A,B` is two claims, not one. */
  readonly claims: number;
  /** Claims for which the target line carries at least one `Ignored` mutant of that mutator. */
  readonly attached: number;
  readonly findings: readonly SuppressionFinding[];
}

/**
 * Extract the `Stryker disable next-line` directives from one file's source.
 *
 * ⚠ `Stryker` MUST BE THE FIRST THING IN THE COMMENT, and that is what keeps PROSE out. This repo
 * discusses its own directives constantly — six files mention `Stryker disable next-line` inside a
 * docstring or an explanatory comment, and this module is one of them — so a pattern that merely
 * searched for the phrase would invent a finding for every paragraph about the mechanism, and teach
 * the reader to stop reading this rung's output. Anchoring to the OPENER rather than to the start of
 * the line is what lets it still see the two live directives written after a ternary arm.
 *
 * The one shape it cannot judge is prose that OPENS a line comment with the phrase itself, as in
 * "Stryker disable next-line binds to the NEXT line" written directly after the slashes — which is
 * indistinguishable from a directive by anything but meaning. It is pinned as a known limit, and it
 * costs one advisory line. (This paragraph deliberately does not quote the slashes: an earlier draft
 * did, and the audit correctly reported this very docstring as an unmatched directive on the run
 * that introduced it.)
 */
export function parseSuppressionDirectives(
  file: string,
  source: string,
): readonly SuppressionDirective[] {
  const found: SuppressionDirective[] = [];
  const lines = source.split("\n");
  for (const [index, text] of lines.entries()) {
    const match = SUPPRESSION_PATTERN.exec(text);
    if (match === null) continue;
    // No empty-string filter and no length guard, and their absence is load bearing rather than an
    // omission: the capture group is `[A-Za-z]…(?:\s*,\s*[A-Za-z]…)*`, so every comma it matched has
    // an identifier on BOTH sides and no split can yield an empty element. Both guards were written,
    // both proved unkillable by any input, and deleting them is the honest fix — a branch nothing can
    // reach is not protection, it is a claim about this regex that the regex already makes.
    // Stryker disable next-line StringLiteral: EQUIVALENT — group 1 always participates when this
    // pattern matches (it is not inside an alternation and not optional), so the `??` right side is
    // unreachable and no input can observe what it holds. It exists only for `noUncheckedIndexedAccess`.
    const mutators = (match[1] ?? "").split(",").map((m) => m.trim());
    // Walk past the REST of the comment block to the line Stryker will really bind to. Reusing
    // `isCodeFreeLine` rather than writing a second comment predicate is deliberate: it already
    // answers "can this line carry a mutant", and two answers to that question drifting apart is
    // how the audit would start accusing directives that are fine.
    //
    // `findIndex`, never a counting loop — a `while` with its own cursor carries an increment whose
    // decrement mutant walks backwards forever (negative indices read as blank, which is code-free,
    // so the guard never stops it) and the rung can only score that as a timeout no test can clear.
    const at = lines.findIndex((text, i) => i > index && !isCodeFreeLine(text));
    // A directive with nothing but comment and blank lines after it binds to no node at all; aiming
    // past the last line is how that becomes an honest "suppressed nothing" instead of line 0.
    const targetLine = at === -1 ? lines.length + 1 : at + 1;
    found.push({ file, line: index + 1, targetLine, mutators });
  }
  return found;
}

/**
 * Did each suppression directive in this branch's changed spans actually suppress anything?
 *
 * WHY THIS CANNOT BE A COUNT, which is how the increment that asked for it first sketched the job.
 * One directive suppresses every mutant of its mutator on the target line, and a line routinely
 * carries several — the founding measurement saw the run's mutant total fall by 13 for 8 directives
 * that took. So "N directives should yield N ignored mutants" is false on healthy input, and the
 * only sound comparison is per directive: does the line it names still carry a LIVE mutant of the
 * mutator it names?
 *
 * SILENT IS THE WHOLE PROBLEM. Stryker emits no diagnostic for a directive that bound to nothing,
 * and the comment that works is textually identical to the one that does not, so the reader's
 * visible evidence — a survivor with a disable comment directly above it — points at their own
 * equivalence argument rather than at the tooling.
 *
 * ⚠ IT JUDGES ONLY WHAT THIS RUN INSTRUMENTED, and stays silent otherwise. A directive whose target
 * line is outside the changed spans has no mutants in this report BECAUSE THE RUNG NEVER ASKED, and
 * a file that contributed no mutant at all was narrowed away or is not mutable — reporting either
 * as "suppressed nothing" would be an accusation built from the instrument's own blind spot, which
 * is the failure class this rung exists to close rather than to commit.
 */
export function auditSuppressionDirectives(args: {
  readonly sources: ReadonlyMap<string, string>;
  readonly changed: readonly ChangedRanges[];
  readonly mutants: readonly AdjudicatedMutant[];
}): SuppressionAudit {
  // THE RANGES ARE KEPT AS RANGES, never expanded into a set of every line number. Expanding them
  // reads more simply and costs a counting loop, whose decrement mutant runs forever — so the rung
  // scores it as a TIMEOUT that no test can ever clear. Asking a range whether it contains a line
  // is the same answer with no loop at all, and it does not walk a 4,000-line span to find out.
  // Asked straight off `changed`, with no index built first. An index needs an empty-list fallback
  // for the first entry of each file AND for a lookup miss, and BOTH are unreachable here — an
  // unreachable fallback is a branch no input can distinguish, which is the shape that shows up as
  // an equivalent mutant and cannot be tested away. A diff names a file once per hunk, so `some`
  // over the entries is also the natural way to merge those hunks rather than a thing to remember.
  const wasInstrumented = (file: string, line: number): boolean =>
    args.changed.some(
      (entry) =>
        normalise(entry.file) === file && entry.ranges.some((r) => line >= r.start && line <= r.end),
    );

  const findings: SuppressionFinding[] = [];
  let audited = 0;
  let claims = 0;
  let attached = 0;

  // Stryker disable next-line EqualityOperator: EQUIVALENT — these are Map KEYS, so `a === b` cannot
  // occur and `<` and `<=` agree on every pair this comparator can ever be handed. A test feeding
  // duplicate keys would assert behaviour the input type cannot represent.
  for (const [file, source] of [...args.sources].sort(([a], [b]) => (a < b ? -1 : 1))) {
    // Suffix matching, for the reason `resolveTestFiles` documents one layer down: Stryker's report
    // paths come from a sandbox whose directory name changes every run, so equality alone can find
    // nothing on some runs and everything on others.
    const mine = args.mutants.filter((m) => m.file === file || m.file.endsWith(`/${file}`));
    if (mine.length === 0) continue;

    for (const directive of parseSuppressionDirectives(file, source)) {
      if (!wasInstrumented(file, directive.targetLine)) continue;
      audited += 1;
      const onTarget = mine.filter((m) => m.line === directive.targetLine);
      for (const mutator of directive.mutators) {
        claims += 1;
        const scoped = mutator === "all" ? onTarget : onTarget.filter((m) => m.mutator === mutator);
        const statuses = [...new Set(scoped.map((m) => m.status))].sort();
        // Built FIELD BY FIELD rather than spread from the directive: a spread would also carry
        // `mutators`, which the finding type does not declare, so every reader would meet a field
        // TypeScript says is not there — and the whole point of a per-claim finding is that it
        // names ONE mutator.
        const at = { file: directive.file, line: directive.line, targetLine: directive.targetLine, mutator, statuses };
        if (scoped.length === 0) {
          findings.push({ ...at, kind: "unmatched" });
        } else if (scoped.some((m) => m.status === IGNORED_STATUS)) {
          attached += 1;
        } else {
          findings.push({ ...at, kind: "inert" });
        }
      }
    }
  }

  return { audited, claims, attached, findings };
}

/**
 * Report the suppression audit — ADVISORY, and deliberately not a failure.
 *
 * WARN RATHER THAN RED, settled on landing. A directive that attached correctly is the common case
 * (this repo carries ~440 of them), the reader who wrote one is the same reader this line is FOR,
 * and a false red would charge the honest case for a signal whose whole value is that it removes a
 * manual ritual. The rung's own verdict is unchanged either way: an inert directive already shows
 * up as the survivor it always was, and this only says WHY it is still there.
 */
export function formatSuppressionAudit(tag: string, audit: SuppressionAudit): readonly string[] {
  if (audit.audited === 0) return [];
  const lines = [
    `${tag} suppression directives in the changed spans: ${audit.audited} directive(s), ` +
      `${audit.claims} mutator claim(s), ${audit.attached} attached`,
  ];
  for (const finding of audit.findings) {
    lines.push(
      finding.kind === "inert"
        ? `${tag}   INERT DIRECTIVE ${finding.file}:${finding.line} disable next-line ${finding.mutator} — ` +
          `line ${finding.targetLine} still carries a LIVE ${finding.mutator} mutant ` +
          `(${finding.statuses.join(", ")}), so the directive bound to nothing. A comment between the ` +
          "links of a chained expression attaches to no statement: extract the expression into a " +
          "named function and put the directive above its return."
        : `${tag}   UNMATCHED DIRECTIVE ${finding.file}:${finding.line} disable next-line ${finding.mutator} — ` +
          `line ${finding.targetLine} carries no ${finding.mutator} mutant at all, so this suppresses ` +
          "nothing. Either the code moved out from under it, or the mutator name is not one Stryker " +
          "emits here.",
    );
  }
  return lines;
}
