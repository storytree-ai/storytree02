/* gate-check
runs: both
subject: own-work
cost: minutes
skip:
  when: >-
    this branch changes no mutable TypeScript under a workspace project's `src/`, so there are no
    mutants to generate — the ordinary shape of a corpus, docs or config landing, and the commonest
    outcome of this rung
  inCi: failure
why: >-
  asks whether the tests this branch wrote actually CATCH bugs in the lines this branch changed —
  the red phase proves a test went red, never that it would have gone red for a slightly different
  defect (ADR-0447 D2, ADR-0458). Runs AFTER the test leg deliberately: mutation results over a red
  suite describe the breakage, not the tests
*/
// `pnpm check:mutation-diff` — the diff-scoped mutation rung (ADR-0458 / `diff-scoped-mutation-rung`).
//
// Mutate ONLY the lines this branch changed, and require this branch's OWN new or changed tests to
// kill those mutants. The adjudication is `mutation-diff.ts`, which is pure and unit-tested; this
// file is the I/O shell: resolve the diff, generate a Stryker config, run it, read the report.
//
// EXIT CODES follow the gate's own vocabulary (`gate-order.ts`):
//   0  every mutant in the changed lines was killed by this branch's own tests
//   1  at least one was not — or the run could not be trusted
//   3  SKIP: this branch changes no mutable source, so there is nothing to mutate. A declared,
//      opt-in skip, never inferred — the runner prints it as SKIP and the gate reads GREEN, NARROWED.
//      LOCAL ONLY. CI runs this through `pnpm gate --ci`, which counts exit 3 as a FAILURE
//      (ADR-0606 D3), so in CI that same state prints `NOTHING TO MUTATE` and exits 0 — the fact
//      is stated either way and only the code differs. See `skipDisposition` for why.
//
// WHY THE SCOPE CLASSIFIER IS IMPORTED RATHER THAN RE-DERIVED. `diff-scoped-mutation-rung` makes this
// a ship condition: `ci-affected.ts` already owns "what does this branch affect", it is the SAME
// classifier the local gate and CI both use (ADR-0195 / ADR-0304 D2), and a second one means a local
// pass stops predicting a CI pass. This rung takes its workspace projects from
// `discoverWorkspaceProjects` and nothing else.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { discoverWorkspaceProjects } from "./ci-affected.js";
import { GATE_SKIP_EXIT_CODE } from "./gate-runner.js";
import { MIRRORS } from "./mirror-conformance.js";
import {
  adjudicateMutants,
  auditSuppressionDirectives,
  type ChangedRanges,
  concurrencyFor,
  declaredTestRoots,
  entryPointsFromCheckNames,
  entryPointsFromMirrorRegistry,
  entryPointsFromScripts,
  entryPointsFromShellScripts,
  formatMutationVerdict,
  formatNarrowingLines,
  formatSuppressionAudit,
  isTestFile,
  isSpawnUatTest,
  mergeMutationReports,
  type MutationReport,
  type MutationRunner,
  type MutationTarget,
  type NarrowedFile,
  parseUnifiedDiffRanges,
  changedLinesAreCodeFree,
  noChangedTestOutcome,
  isNarrowedToNothing,
  type ReportPart,
  runnerFor,
  selectMutationTargets,
  siblingTestFor,
  skipDisposition,
} from "./mutation-diff.js";
import {
  type BaseRefChoice,
  chooseBaseRef,
  VacuousOwnershipSweep,
} from "./ownership-totality.js";

const TAG = "[mutation-diff]";
const repoRoot = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));

const CONFIG_FILE = "stryker.mutation-diff.conf.mjs";
const REPORT_FILE = "reports/mutation-diff.json";
/** Written INTO a vitest project, beside its own config, so `./vitest.config.js` resolves. */
const VITEST_CONFIG_FILE = "vitest.mutation-diff.config.ts";

const GIT_MAX_BUFFER = 64 * 1024 * 1024;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8", maxBuffer: GIT_MAX_BUFFER });
}

/**
 * `git` that reports "did not resolve" as `null` instead of throwing — for the probe-shaped calls.
 *
 * ITS STDERR IS DISCARDED, and that is the difference from {@link git} above rather than an
 * oversight. A probe asks a question whose "no" is a NORMAL ANSWER: `merge-base origin/main HEAD`
 * on a CI checkout is EXPECTED to fail, because `fetch-depth: 2` fetches no `origin/main` — that
 * is the whole reason {@link chooseBaseRef} exists. git writes `fatal: Not a valid object name
 * origin/main` to stderr anyway, and with stderr inherited that line lands in the CI log of every
 * PR, on the HEALTHY path, immediately above a PASS. Measured on PR #1668's own run, the first
 * time this rung ran in CI. A red `fatal:` printed by a step that then succeeds is worse than
 * noise: it invites a session to diagnose a break that is not there, and it teaches everyone to
 * read past `fatal:` lines that sometimes DO matter.
 *
 * `check-ownership-totality.ts`'s `git()` silences its probe for exactly this reason and has since
 * it was written; this rung reuses that check's `chooseBaseRef` and simply failed to copy the
 * stdio with it. {@link git} keeps stderr INHERITED on purpose — its callers ask questions whose
 * failure is a genuine fault worth seeing.
 */
function gitOrNull(args: string[]): string | null {
  try {
    const out = execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      maxBuffer: GIT_MAX_BUFFER,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? null : out;
  } catch {
    return null;
  }
}

/**
 * The revision this branch is charged against.
 *
 * REUSED, NOT RE-DERIVED — {@link chooseBaseRef} is `check:ownership-totality`'s already-tested
 * judge, and the reason it is not simply `merge-base origin/main HEAD` is the same here as there:
 * CI checks out the PR MERGE ref at `fetch-depth: 2` and fetches no `origin/main`, so the local
 * answer and the CI answer are different refs for the same question. A second copy of that decision
 * would drift, and this rung would then disagree with the ownership rung about what "this branch
 * changed" even means.
 */
function resolveBaseRef(): BaseRefChoice {
  return chooseBaseRef({
    eventName: process.env["GITHUB_EVENT_NAME"],
    githubRef: process.env["GITHUB_REF"],
    hasSecondParent: gitOrNull(["rev-parse", "--verify", "--quiet", "HEAD^2"]) !== null,
    mergeBase: gitOrNull(["merge-base", "origin/main", "HEAD"]),
  });
}

/**
 * The branch's changed line spans, working tree included.
 *
 * The same three-part answer `gate-run.ts` assembles for scope, for the same reason: a session runs
 * the gate mid-flight, so its changes may be committed, staged, unstaged or untracked. `git diff
 * <merge-base>` with no second revision covers the first three; `ls-files --others` adds the fourth.
 *
 * An untracked file is entirely new, so every line of it is in scope — there is no diff to parse and
 * no earlier version any of it could have been inherited from.
 */
function changedRanges(base: BaseRefChoice): ChangedRanges[] {
  const diff = git(["diff", "--unified=0", "--no-renames", base.ref]);
  const ranges = [...parseUnifiedDiffRanges(diff)];

  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l !== "");
  for (const file of untracked) {
    if (!file.endsWith(".ts") && !file.endsWith(".tsx")) continue;
    const abs = path.join(repoRoot, file);
    if (!existsSync(abs)) continue;
    const lines = readFileSync(abs, "utf8").split("\n").length;
    ranges.push({ file, ranges: [{ start: 1, end: Math.max(lines, 1) }] });
  }

  return ranges;
}

/**
 * ONE Stryker run: which runner drives it, what it mutates, and which tests may witness a kill.
 *
 * A rung run is now one-or-more of these. The BUN projects share a single group, because the bun
 * runner takes repo-root-relative test paths and needs no per-project root. Each VITEST project gets
 * its OWN group, because vitest resolves `include`, `setupFiles` and every alias against a root, and
 * two projects have two roots — there is no single vitest invocation that can run both correctly.
 */
interface RunGroup {
  readonly runner: MutationRunner;
  /**
   * Unique across the groups of one run — `bun`, or `vitest:apps/studio`. It becomes the namespace
   * {@link mergeMutationReports} prefixes onto this group's test ids, which is what stops run A's
   * test `"0"` being resolved against run B's file of the same id.
   */
  readonly key: string;
  readonly targets: readonly MutationTarget[];
  /** Repo-root-relative test paths that may be credited with a kill in this group. */
  readonly testFiles: readonly string[];
  /** The vitest project's dir (`apps/studio`); `null` for the bun group. */
  readonly projectDir: string | null;
}

/** The four hard constraints, written once and shared by both runners' generated configs. */
const SHARED_CONSTRAINTS = `  // Constraint 2: without perTest there is no per-test attribution at all, and the rung's entire
  // question ("did THIS branch's tests kill it?") becomes unanswerable.
  coverageAnalysis: "perTest",
  // Constraint 3: with Stryker's default bail the plugin stops at the first failing test, so
  // killedBy holds only whichever covering test ran first — the branch's own new test can be
  // missing from it even though it also kills, and the rung would red a landing that did its job.
  disableBail: true,`;

/**
 * The CONTENTS of every `scripts/*.sh` in the repo, for {@link entryPointsFromShellScripts}.
 *
 * The IMPURE half, kept here so the derivation itself stays a pure function of text. Fail-soft by
 * design: a missing directory or an unreadable script yields no exemptions rather than throwing, on
 * the same reasoning the rung applies elsewhere — an exemption that cannot be derived leaves a file
 * IN the mutate set, which is the conservative direction (a red the author can see), where throwing
 * would take down a rung over a file-permissions accident.
 */
function readShellScripts(): string[] {
  const dir = path.join(repoRoot, "scripts");
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.endsWith(".sh")) continue;
    try {
      out.push(readFileSync(path.join(dir, entry), "utf8"));
    } catch {
      // unreadable script — no exemption from it, and the rung carries on
    }
  }
  return out;
}

/**
 * The Stryker config for one group, generated rather than committed.
 *
 * Generated because its `mutate` list IS the diff — it is different on every branch, so a committed
 * file could only ever be stale. The four hard constraints the attribution wire established are
 * written here explicitly, each beside the failure it prevents, because a config that silently loses
 * one of them produces a report that still LOOKS fine.
 *
 * The two runners differ in exactly one place — how the test set is narrowed. The bun runner takes
 * `bun.testFiles` directly. Vitest has no equivalent option, so the narrowing is expressed as a
 * generated vitest config whose `include` is this group's test files; see {@link writeVitestConfig}.
 */
function writeStrykerConfig(
  group: RunGroup,
  configFile: string,
  reportFile: string,
  concurrency: number,
): void {
  const mutate = JSON.stringify(group.targets.flatMap((t) => t.mutateGlobs));
  const head =
    group.runner === "bun"
      ? `  testRunner: "bun",
  plugins: ["@hughescr/stryker-bun-runner"],
${SHARED_CONSTRAINTS}
  mutate: ${mutate},
  // \`--timeout\` because the plugin spawns \`bun test\` ITSELF, from the sandbox root, inheriting no
  // package script — so the suite met bun's 5 s per-test default instead of the 300 s ceiling every
  // one of this repo's 18 bun-test packages declares in its own \`test\` script. That is not a red,
  // it is WORSE than one: a legitimately slow test (a pi authoring slice against a closed port,
  // where pi auto-retries for ~5 s by design) is killed mid-run, the runner reports "some tests may
  // have been aborted", per-test coverage mapping degrades, and killed mutants come back UNPROVEN —
  // "no test named" — which the rung correctly refuses to score as either a pass or a survivor.
  // Measured on \`packages/agent\`: 6 UNPROVEN with the default, 0 with the ceiling, same tests.
  // A \`bunfig.toml\` \`[test].timeout\` does NOT work — bun 1.4.0 ignores it (probed with
  // \`timeout = 1\`, which changed nothing), despite the plugin's own doc naming it as the knob.
  bun: {
    testFiles: ${JSON.stringify(group.testFiles)},
    bunArgs: ["--timeout", "300000"],
    // The plugin's CHILD-PROCESS budget, which is a different clock from the per-test one above and
    // had to move with it. Its 10 s default was survivable only because the 5 s per-test default was
    // capping the suite by killing slow tests; lifting that let \`packages/agent\`'s dry run take the
    // ~43 s it honestly needs, and the run then died as "Dry run timed out" instead. Neither clock
    // is the runaway guard — Stryker's own \`timeoutMS\` above is, per mutant, and it is unchanged.
    // Moved again 180 s → 600 s on 2026-09-17, for the same reason at a larger covering set: the
    // \`production-builds-enforce-the-inner-loop-exit\` landing's 24 drive + cli witness files
    // include the real-chain tests (\`leaf-slices-activation\` 157 s, \`story-real-build\` 125 s
    // alone), its dry run measured ~316 s on the Windows dev box WITHOUT coverage instrumentation,
    // and 180 s killed it before a single mutant ran. Under the rung's own perTest instrumentation
    // the same dry run then outran 600 s too ("Dry run timed out" at exactly ten minutes), so the
    // budget is 30 minutes. It bounds a child process, never a mutant's verdict.
    timeout: 1800000,
  },`
      : `  testRunner: "vitest",
  plugins: ["@stryker-mutator/vitest-runner"],
${SHARED_CONSTRAINTS}
  mutate: ${mutate},
  // \`related: false\` is REQUIRED, not a preference. With Stryker's default the runner asks vitest
  // \`--related <mutated files>\`, and the mutate paths above are repo-root-relative while this
  // project's vitest root is the project dir — so vitest matches NOTHING and the dry run reports
  // "No tests were found", aborting the rung. The narrowing that replaces it is the generated
  // config's own \`include\`, which is this group's test files and nothing else.
  vitest: { configFile: ${JSON.stringify(`${group.projectDir}/${VITEST_CONFIG_FILE}`)}, related: false },`;

  const body = `// GENERATED by check-mutation-diff.ts for this branch's diff — do not commit, do not edit.
export default {
${head}
  reporters: ["json"],
  jsonReporter: { fileName: ${JSON.stringify(reportFile)} },
  // DERIVED from this machine's logical CPU count by {@link concurrencyFor}, never declared — one
  // worker per physical core, capped at the 4 this rung shipped with. A flat 4 is right on a
  // developer desktop and wrong on GitHub, whose 4-vCPU runner has 2 physical cores; a flat 2 would
  // be the mirror-image mistake, halving the rung on every box that is not GitHub. See ADR-0509 and
  // \`concurrencyFor\`'s own comment for the measurement, and the printed \`concurrency=\` in this
  // rung's runner line for what a given run actually chose.
  concurrency: ${concurrency},
  // THE PER-MUTANT BUDGET IS A FORMULA, NOT A FLAT CEILING, and reading it as a flat 60 s is what
  // sends a session down the wrong path. Stryker computes
  // \`timeoutFactor * netTime + timeoutMS + timeOverheadMS\` (@stryker-mutator/core 10.0.0,
  // \`dist/src/mutants/mutant-test-planner.js:124\`), where \`netTime\` is THIS mutant's covering tests
  // as timed in the dry run and \`timeOverheadMS\` is the dry run's own measured overhead — 35.7 s on
  // the run below. So a mutant that "timed out at 60 s" had in fact already been given >= 96 s.
  //
  // WHY BOTH TERMS WERE RAISED (ADR-0509). PR #1808 returned 115 UNPROVEN of 286 on GitHub with
  // ZERO missed, across two runs whose lists were identical — a property of the machine, not luck.
  // The cause is measured rather than inferred: GitHub's 4-vCPU runner has 2 PHYSICAL cores while
  // \`concurrency\` above runs 4 CPU-bound bun processes, so each covering set runs at roughly half
  // the speed the dry run clocked it at, and \`1.5 x netTime\` (Stryker's default factor) stops
  // covering it. The same branch re-run on a 12-core box at CI's per-test speed produced FIVE
  // timeouts, not 108 — the difference is core contention, nothing else.
  //
  // The two terms answer different halves, which is why raising one alone would not do. \`timeoutFactor\`
  // scales with the check's own covering set — \`disableBail\` in SHARED_CONSTRAINTS means every
  // covering test re-runs, and on that branch a killed mutant re-ran a median of 17 tests and as many
  // as 233 — while \`timeoutMS\` is the flat floor a mutant with a small covering set leans on.
  //
  // ⚠ NEITHER IS A QUALITY BAR. ADR-0447 holds that this rung's verdict is never a percentage and
  // never a threshold; raising a clock changes only how long a check may take to REACH a verdict.
  // UNPROVEN still blocks, and a real survivor is still red.
  //
  // ⚠ CONCURRENCY IS THE OTHER KNOB AND IS DELIBERATELY UNTOUCHED HERE. \`concurrency: 2\` would
  // remove the contention at its cause rather than buying time around it, but it trades wall clock
  // against it and belongs to the open weight question (\`oq-is-the-mutation-rung-paying-its-weight\`
  // on \`mutation-rung-weight-arc\`), not to this stopgap. If a large branch still times out with the
  // budget below, that is the next lever — not a further raise.
  timeoutFactor: 6,
  timeoutMS: 120000,
  // Stryker's INITIAL test run has a clock of its own, \`dryRunTimeoutMinutes\` (default 5), separate
  // from the per-mutant budget above and from the bun plugin's child-process budget. It is not the
  // lever the note above rules out: it bounds the one coverage-gathering run, never a mutant. A
  // covering set that includes the real-chain drive tests needs more than five minutes on the dev
  // box — measured 2026-09-17 on the \`production-builds-enforce-the-inner-loop-exit\` landing, whose
  // run died with "Initial test run timed out!" at exactly 5 minutes, before any mutant ran, and
  // then outran ten minutes under the rung's perTest instrumentation (the child budget below).
  dryRunTimeoutMinutes: 30,
  tempDirName: ".stryker-tmp",
  // typescript@7 exports no compiler API (ADR-0400 D3), so Stryker's tsconfig preprocessor throws if
  // it finds a real one. Pointing at a path that does not exist is the fix increment 1 established.
  tsconfigFile: "stryker-no-tsconfig.json",
};
`;
  writeFileSync(path.join(repoRoot, configFile), body, "utf8");
}

/**
 * The narrowed vitest config for one vitest group — the analogue of the bun runner's `testFiles`.
 *
 * IT EXTENDS THE PROJECT'S OWN CONFIG RATHER THAN RESTATING IT, and that is the load-bearing choice.
 * `apps/studio`'s config carries the React plugin, a `self`→globalThis setup file the node-env suites
 * need at load, and a 60 s timeout that exists because these suites are starved under `pnpm -r`. A
 * hand-written copy would work on the day it was written and then drift silently — the studio would
 * add an alias, the rung's runs would fail to resolve it, and the rung would report a survivor that
 * is really a broken import. Spreading the real config means there is nothing to keep in sync.
 *
 * `root` is pinned to the project directory, and pinning it is what makes the whole thing work.
 * Vitest resolves `root` from the CWD, which under Stryker is the SANDBOX root (a copy of the repo
 * root) — not the config file's directory. Without this the project's own `include` globs
 * (`src/**` and friends) resolve against the repo root and match nothing.
 *
 * A FUNCTION-FORM CONFIG IS REFUSED LOUDLY. Vite permits `defineConfig(() => ({…}))`, which cannot be
 * spread. Both vitest projects here export an object today; if one changes, this throws a message
 * naming the fix rather than silently producing a config with no `include` — which vitest would run
 * as "every test in the project", turning a narrow rung into the whole suite without saying so.
 */
function writeVitestConfig(group: RunGroup): string {
  const dir = group.projectDir;
  if (dir === null) throw new Error(`${TAG} internal: vitest group ${group.key} has no project dir`);
  const rel = group.testFiles.map((f) => f.slice(`${dir}/`.length));

  const body = `// GENERATED by check-mutation-diff.ts for this branch's diff — do not commit, do not edit.
import { fileURLToPath } from 'node:url';

import base from './vitest.config.js';

const root = fileURLToPath(new URL('.', import.meta.url));

if (typeof base === 'function') {
  throw new Error(
    'check:mutation-diff cannot narrow a function-form vitest config. Export a plain object from ' +
      '${dir}/vitest.config.ts, or teach writeVitestConfig in packages/cli/src/check-mutation-diff.ts ' +
      'to resolve it.',
  );
}

export default {
  ...base,
  root,
  test: { ...(base.test ?? {}), root, include: ${JSON.stringify(rel)} },
};
`;
  const rel_path = `${dir}/${VITEST_CONFIG_FILE}`;
  writeFileSync(path.join(repoRoot, rel_path), body, "utf8");
  return rel_path;
}

/**
 * The tests to run: this branch's own changed tests, plus each mutated file's existing sibling suite.
 *
 * DELIBERATELY NARROW, and the first attempt proved why. Handing Stryker the whole project's test
 * set ran `packages/cli`'s entire suite — integration tests that spawn child processes included —
 * inside a sandbox that also contains this rung's own generated config, and the dry run died before
 * a single mutant was tested. It was also the wrong shape on cost: the rung asks about a handful of
 * changed lines, so running hundreds of unrelated test files to answer it is work with no bearing
 * on the question.
 *
 * The sibling suite is included even when the branch did not touch it, and that is not slack: it is
 * what lets a mutant killed by the file's EXISTING tests be reported as `killed-by-others` rather
 * than as a survivor. Both are red, but only one tells the author the truth about what happened.
 */
function testFilesFor(
  targets: readonly MutationTarget[],
  changedTestFiles: readonly string[],
): string[] {
  // SCOPED TO THIS GROUP'S OWN PROJECTS. A changed test file only counts as a witness for the group
  // that can actually execute it: handing `apps/studio`'s vitest suite to the bun runner aborts its
  // dry run, and handing `packages/cli`'s bun suite to a vitest root that does not contain it
  // narrows that group to nothing. Before the rung had more than one runner every changed test could
  // safely go to the single group, so this filter had nothing to do and did not exist.
  const dirs = [...new Set(targets.map((t) => t.dir))];
  const mine = (file: string) => dirs.some((dir) => file.startsWith(`${dir}/`));

  const files = new Set<string>(
    changedTestFiles.filter(isTestFile).filter((f) => !isSpawnUatTest(f)).filter(mine),
  );
  for (const target of targets) {
    for (const source of target.sourceFiles) {
      const sibling = siblingTestFor(source);
      if (isSpawnUatTest(sibling)) continue;
      if (existsSync(path.join(repoRoot, sibling))) files.add(sibling);
    }
  }
  return [...files].sort();
}

/**
 * Split the selection into one run per runner root — see {@link RunGroup} for why vitest cannot share.
 *
 * A group with no test file at all is DROPPED here rather than run: it has no witness, so Stryker
 * would either abort on an empty test set or evaluate mutants nothing could ever kill. The caller
 * reports the drop; it is never silent.
 */
function planRunGroups(
  targets: readonly MutationTarget[],
  changedTestFiles: readonly string[],
  runnerOf: (project: string) => MutationRunner,
): RunGroup[] {
  const bun = targets.filter((t) => runnerOf(t.project) === "bun");
  const groups: RunGroup[] = [];

  if (bun.length > 0) {
    groups.push({
      runner: "bun",
      key: "bun",
      targets: bun,
      testFiles: testFilesFor(bun, changedTestFiles),
      projectDir: null,
    });
  }

  for (const target of targets.filter((t) => runnerOf(t.project) === "vitest")) {
    groups.push({
      runner: "vitest",
      key: `vitest:${target.dir}`,
      targets: [target],
      testFiles: testFilesFor([target], changedTestFiles),
      projectDir: target.dir,
    });
  }

  return groups;
}


/** A workspace project's own `test` script, or `undefined` when it declares none. */
function testScriptOf(dir: string): string | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(path.join(repoRoot, dir, "package.json"), "utf8"),
    ) as { scripts?: Record<string, string> };
    return manifest.scripts?.test;
  } catch {
    return undefined;
  }
}

/**
 * The on-disk text of every source file the selection will mutate, keyed by repo-relative path.
 *
 * Shared by the two skip paths that corroborate the diff against the source — the no-changed-test
 * branch and the `vacuous` branch — so both ask {@link changedLinesAreCodeFree} about the same
 * bytes. A file that has vanished is simply absent, which makes the code-free check fail closed on
 * it rather than treat an unreadable range as blank.
 */
function sourcesFor(targets: readonly { sourceFiles: readonly string[] }[]): Map<string, string> {
  const sources = new Map<string, string>();
  for (const file of targets.flatMap((t) => t.sourceFiles)) {
    const abs = path.join(repoRoot, file);
    if (existsSync(abs)) sources.set(file, readFileSync(abs, "utf8"));
  }
  return sources;
}

function main(): void {
  const base = resolveBaseRef();
  console.log(`${TAG} base: ${base.because}`);

  const ranges = changedRanges(base);
  const existingFiles = new Set(
    ranges.map((r) => r.file).filter((f) => existsSync(path.join(repoRoot, f))),
  );
  const rootScripts = (
    JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    }
  ).scripts;
  // NARROW TO WHAT A STRYKER RUNNER CAN ACTUALLY EXECUTE, and say what that leaves out.
  // Two runners are wired — see {@link runnerFor}, which also records why `packages/orchestrator`
  // (`node --test`) is a decided exclusion rather than an unfinished one.
  const allProjects = discoverWorkspaceProjects(repoRoot);
  const runnerByProject = new Map<string, MutationRunner>();
  for (const p of allProjects) {
    const runner = runnerFor(testScriptOf(p.dir));
    if (runner !== null) runnerByProject.set(p.name, runner);
  }
  const projects = allProjects.filter((p) => runnerByProject.has(p.name));
  const outOfReach = allProjects.filter((p) => !runnerByProject.has(p.name));
  const touchedOutOfReach = outOfReach.filter((p) =>
    ranges.some((r) => r.file.split("\\").join("/").startsWith(`${p.dir}/`)),
  );
  for (const p of touchedOutOfReach) {
    console.log(
      `${TAG} NARROWED: ${p.dir} is out of this rung's reach — its own test script is ` +
        `\`${(testScriptOf(p.dir) ?? "(none)").trim()}\`, and Stryker's bun runner cannot execute it. ` +
        "This branch's changes there are neither mutated nor used as covering tests.",
    );
  }

  const selection = selectMutationTargets({
    changed: ranges,
    projects,
    existingFiles,
    // Both kinds of executable entry point: the files a root script INVOKES, and the probe modules
    // the mirror registry SPAWNS. Neither is imported by anything, both exit non-zero when run
    // without their arguments, and an unexempt probe kills the WHOLE rung at Stryker's dry run
    // rather than merely scoring badly — see entryPointsFromMirrorRegistry.
    exemptFiles: new Set([
      ...entryPointsFromScripts(rootScripts ?? {}),
      ...entryPointsFromMirrorRegistry(MIRRORS),
      // The THIRD kind: an entry a repo SHELL script invokes. `ambient-presence-entry.ts` is the
      // measured case — `scripts/presence-hook.sh` execs it from the SessionStart hook, so no
      // package.json script names it, and mutating it aborted the whole rung with `No tests were
      // found` (it ends in `process.exit(0)` at module scope, so merely LOADING it kills the test
      // process — reproduced at 0 mutants).
      ...entryPointsFromShellScripts(readShellScripts()),
      // The FOURTH kind: a gate CHECK file, which the gate finds by its name and runs as a program
      // (ADR-0606 D1) — including a RETIRED one, which no script names and which still runs its
      // `main()` on import, so merely loading it aborted this rung's dry run.
      ...entryPointsFromCheckNames(ranges.map((r) => r.file)),
    ]),
    // Each project's OWN answer to "which directories do my tests live in", so a file dropped from
    // a directory the project itself declares it tests can be named as the real gap it is rather
    // than as the ordinary conservative drop it otherwise looks exactly like.
    testRootsByProject: new Map(
      projects.map((p) => [
        p.name,
        declaredTestRoots({
          testScript: testScriptOf(p.dir),
          isDirectory: (rel) => {
            try {
              return statSync(path.join(repoRoot, p.dir, rel)).isDirectory();
            } catch {
              return false;
            }
          },
        }),
      ]),
    ),
  });

  for (const file of selection.exempted) {
    // Loud, never silent: an exemption a reader cannot see is indistinguishable from a file the
    // rung simply failed to notice.
    console.log(`${TAG} EXEMPT (executable entry point — a script invokes it, the mirror registry spawns it, or it is a gate check the gate runs by its file name): ${file}`);
  }

  // EVERY RUN, not just the one where nothing survived the narrowing. This used to reach the reader
  // only through `skipReason`, printed in the `targets.length === 0` branch below — so the rung
  // named its blind spot exactly when the blind spot had cost nothing, and went quiet the moment it
  // cost something. See TargetSelection.narrowed for the measurement.
  for (const line of formatNarrowingLines(selection.narrowed)) console.log(`${TAG} ${line}`);

  if (selection.targets.length === 0) {
    // The commonest outcome this rung has, and the one CI cannot inherit the code for — a corpus,
    // docs or config landing changes no mutable TypeScript. `skipDisposition` owns the fork.
    const skip = skipDisposition({
      inCi: process.env["CI"] === "true",
      gateSkipExitCode: GATE_SKIP_EXIT_CODE,
    });
    console.log(`${TAG} ${skip.label} — ${selection.skipReason ?? "nothing to mutate"}`);
    if (skip.exitCode !== 0) process.exit(skip.exitCode);
    return;
  }

  if (selection.changedTestFiles.length === 0) {
    // A DELETION-ONLY LANDING REACHES HERE WITH NOTHING TO PROVE, AND MUST NOT BE FAILED FOR IT.
    //
    // The `vacuous` branch far below already refuses to red a comment-only change — but it needs a
    // Stryker report to get there, and this branch exits first, so a landing that DELETES code and
    // corrects the comment naming it could never reach that disposition. Its only added lines are
    // comment lines; there is no mutant for any test to kill, so "no changed test" is not evidence
    // of anything. That made this rung unable to PASS a whole class of correct landings — the very
    // "instrument that cannot PASS" failure the comment-only guard was written to avoid.
    //
    // ONE SIGNAL IS ENOUGH *HERE*, WHERE THE VACUOUS BRANCH NEEDS TWO. There the second signal
    // (Stryker independently counting zero) disambiguates "ran and found nothing" from "silently
    // did not run" — a distinction that exists only because a run was claimed. No run is claimed
    // here, so the sole question is whether the diff contains a code line at all, and
    // `changedLinesAreCodeFree` answers exactly that: it fails CLOSED on an unreadable source, an
    // empty source map, and any range it cannot account for, so it can only skip when every changed
    // line is provably blank or comment.
    const sources = sourcesFor(selection.targets);
    const outcome = noChangedTestOutcome({
      changedLinesCodeFree: changedLinesAreCodeFree(ranges, sources),
      inCi: process.env["CI"] === "true",
      gateSkipExitCode: GATE_SKIP_EXIT_CODE,
    });
    if (outcome.kind === "skip") {
      console.log(
        `${TAG} ${outcome.label} — this branch changes no test, but every line it changed in ` +
          `${[...sources.keys()].join(", ")} is blank or comment (the rest of the diff is deletion). ` +
          `There is no mutant here for a test to kill.`,
      );
      if (outcome.exitCode !== 0) process.exit(outcome.exitCode);
      return;
    }
    console.error(`${TAG} this branch changes source under src/ but adds or changes NO test file:`);
    for (const target of selection.targets) {
      for (const file of target.sourceFiles) console.error(`${TAG}   ${file}`);
    }
    console.error(`${TAG} the rung asks whether THIS branch's own tests kill the mutants in its own`);
    console.error(`${TAG} changed lines. With no changed test, the answer is no by construction.`);
    process.exit(1);
  }

  const testFiles = testFilesFor(selection.targets, selection.changedTestFiles);
  const spans = selection.targets.reduce((n, t) => n + t.mutateGlobs.length, 0);
  console.log(
    `${TAG} mutating ${spans} changed line span(s) across ${selection.targets.flatMap((t) => t.sourceFiles).length} file(s) in ${selection.targets.length} project(s)`,
  );

  // NEVER SILENT: an excluded acceptance leg is named, on the same rule every other exemption here
  // follows. See {@link isSpawnUatTest} for the measured reason and the cost being accepted.
  const excludedUat = selection.changedTestFiles.filter(isSpawnUatTest);
  if (excludedUat.length > 0) {
    console.log(
      `${TAG} excluding ${excludedUat.length} spawn-based acceptance leg(s) from the mutation ` +
        `runner — they spawn a real binary and a real fixture server, which cannot survive Stryker's ` +
        `re-runs and abort the whole rung: ${excludedUat.join(", ")}`,
    );
  }

  // Every changed test was an acceptance leg and no sibling unit suite exists — there is no witness
  // to attribute a kill to, so running Stryker would prove nothing about this branch. Reported as a
  // SKIP through the same disposition every other "nothing to mutate" branch uses, so CI (which must
  // never see the reserved skip code) gets a plain 0 and a named reason.
  if (testFiles.length === 0) {
    const disposition = skipDisposition({
      inCi: process.env["CI"] === "true",
      gateSkipExitCode: GATE_SKIP_EXIT_CODE,
    });
    console.log(
      `${TAG} ${disposition.label} — this branch's only changed tests are spawn-based acceptance ` +
        `legs, which are excluded above, and no sibling unit suite covers the changed source. ` +
        `Nothing would be proved by mutating.`,
    );
    process.exit(disposition.exitCode);
  }

  const groups = planRunGroups(selection.targets, selection.changedTestFiles, (project) => {
    const runner = runnerByProject.get(project);
    // Unreachable by construction — `selection` was built from `projects`, every one of which is a
    // key of this map. Throwing beats a silent default: a default would quietly drive a vitest
    // project through the bun runner and report its aborted dry run as a rung failure.
    if (runner === undefined) throw new Error(`${TAG} internal: no runner for project ${project}`);
    return runner;
  });

  // NEVER SILENT. A group with no witness cannot prove anything, so it does not run — and a mutant
  // that was never evaluated must not be quietly absent from the count.
  const witnessless = groups.filter((g) => g.testFiles.length === 0);
  for (const g of witnessless) {
    console.error(
      `${TAG} NO WITNESS: ${g.targets.flatMap((t) => t.sourceFiles).join(", ")} changed, but this ` +
        `branch adds or changes no test under ${g.projectDir ?? "any bun project"} and no sibling ` +
        `suite exists. Nothing could kill these mutants.`,
    );
  }
  if (witnessless.length > 0) process.exit(1);

  mkdirSync(path.join(repoRoot, "reports"), { recursive: true });

  // One Stryker run per group, merged into a single report for adjudication. The MERGE is where the
  // per-run test-id collision is disarmed — see `mergeMutationReports`.
  const written: string[] = [];
  try {
    const parts: ReportPart[] = [];

    for (const [index, group] of groups.entries()) {
      const configFile = groups.length === 1 ? CONFIG_FILE : `stryker.mutation-diff.${index}.conf.mjs`;
      const reportFile = groups.length === 1 ? REPORT_FILE : `reports/mutation-diff.${index}.json`;
      const reportPath = path.join(repoRoot, reportFile);
      rmSync(reportPath, { force: true });

      if (group.runner === "vitest") written.push(writeVitestConfig(group));
      // Read the machine ONCE per group and PRINT it. A run that times out is read from its log
      // months later, and "how many workers was it fighting itself with?" is the first question —
      // an unprinted derived value makes that unanswerable (ADR-0509).
      const cpus = availableParallelism();
      const concurrency = concurrencyFor(cpus);
      writeStrykerConfig(group, configFile, reportFile, concurrency);
      written.push(configFile);

      console.log(
        `${TAG} [${index + 1}/${groups.length}] ${group.runner} runner over ` +
          `${group.targets.flatMap((t) => t.sourceFiles).length} file(s) in ` +
          `${group.targets.map((t) => t.dir).join(", ")}, witnessed by ${group.testFiles.length} test file(s)` +
          `, concurrency=${concurrency} (${cpus} logical CPU(s))`,
      );

      const run = spawnSync("pnpm", ["exec", "stryker", "run", configFile], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "inherit",
        shell: process.platform === "win32",
      });

      if (!existsSync(reportPath)) {
        console.error(
          `${TAG} Stryker produced no report for the ${group.runner} run over ` +
            `${group.targets.map((t) => t.dir).join(", ")} (exit ${run.status ?? "unknown"}) — nothing was proved`,
        );
        process.exit(1);
      }

      parts.push({ key: group.key, report: JSON.parse(readFileSync(reportPath, "utf8")) as MutationReport });
    }

    const report = mergeMutationReports(parts);
    const verdict = adjudicateMutants(report, selection.changedTestFiles);

    // Read once, used twice: the comment-only skip needs the source to corroborate the diff, and the
    // verdict render needs it to quote each mutant's original span beside its replacement.
    const sources = sourcesFor(selection.targets);

    // A RUN NARROWED TO NOTHING IS A SKIP, NOT A VACUOUS FAILURE.
    //
    // Every mutant this run found sits in a package whose tests it never ran, so Stryker decided
    // each one against a copy nothing imported (see `packagesWithTestsInRun`). The run proved
    // nothing — but it says exactly why, and there is nothing the branch could change to make it
    // prove more, so redding the PR would charge the author for a limit of the instrument.
    if (isNarrowedToNothing(verdict)) {
      const disposition = skipDisposition({
        inCi: process.env["CI"] === "true",
        gateSkipExitCode: GATE_SKIP_EXIT_CODE,
      });
      console.log(`${TAG} ${disposition.label} — nothing this run mutated could be witnessed by it.`);
      for (const narrowing of verdict.narrowings) console.log(`${TAG} ${narrowing}`);
      process.exit(disposition.exitCode);
    }

    // A COMMENT-ONLY CHANGE TO A SOURCE FILE IS "NOTHING TO MUTATE", NOT A VACUOUS RUN.
    //
    // The selection is textual — `parseUnifiedDiffRanges` reads a diff, not a syntax tree — so a
    // branch that only rewrites a header comment still selects the file, Stryker still instruments
    // it, and it honestly reports zero mutation points. `adjudicateMutants` calls that `vacuous`,
    // which is right for its input (it sees a report, never the diff) and wrong here: there was
    // never anything this run could have proved. Left unhandled it reds every landing that
    // documents a decision where the decision lives, which is this repo's dominant house style —
    // an instrument that cannot PASS, the mirror of the ones it exists to catch.
    //
    // ⚠ TWO INDEPENDENT SIGNALS, AND NEITHER ALONE LICENSES THE SKIP. Stryker counted zero over
    // these exact spans, AND every changed line reads as blank-or-comment. A run that silently did
    // not happen fails the second test, because the diff still holds visible code; a changed line
    // hiding inside a string literal fails the first, because Stryker mutates those. The remaining
    // case both signals agree on is the one that is actually true.
    if (verdict.verdict === "vacuous") {
      if (changedLinesAreCodeFree(ranges, sources)) {
        const disposition = skipDisposition({
          inCi: process.env["CI"] === "true",
          gateSkipExitCode: GATE_SKIP_EXIT_CODE,
        });
        console.log(
          `${TAG} ${disposition.label} — every line this branch changed in ` +
            `${[...sources.keys()].join(", ")} is blank or comment, and Stryker independently found ` +
            `no mutation point in those spans. There was nothing here to prove.`,
        );
        process.exit(disposition.exitCode);
      }
    }

    // DID THE BRANCH'S OWN SUPPRESSION DIRECTIVES ACTUALLY SUPPRESS ANYTHING?
    //
    // Printed on a PASS as well as a failure, for the reason the narrowings above are: a directive
    // that bound to nothing is invisible in the diff — the comment that works and the comment that
    // does not are textually identical — so the only place a reader can meet the fact is here.
    // It never changes the verdict; see `formatSuppressionAudit` for why warn, not red.
    //
    // Printed OUTSIDE `formatMutationVerdict` on purpose: everything that function emits is part of
    // the verdict, and this is not. Keeping it on its own stream is what stops an advisory line
    // being read as a reason the rung failed.
    const suppressions = auditSuppressionDirectives({
      sources,
      changed: ranges,
      mutants: verdict.mutants,
    });
    for (const line of formatSuppressionAudit(TAG, suppressions)) console.log(line);

    const body = formatMutationVerdict(TAG, verdict, selection.targets, sources);

    if (verdict.verdict === "pass") {
      console.log(body);
      return;
    }
    console.error(body);
    process.exit(1);
  } finally {
    for (const file of written) rmSync(path.join(repoRoot, file), { force: true });
  }
}

try {
  main();
} catch (err) {
  if (err instanceof VacuousOwnershipSweep) {
    // No base revision means the rung cannot tell which lines are this branch's — so it has proved
    // NOTHING, which is a loud failure and never a skip. A skip here would be indistinguishable
    // from "your branch touched no source", the one answer this state cannot support.
    console.error(`${TAG} BLIND RUNG — ${err.message}`);
    console.error(`${TAG} run \`git fetch origin\` so \`origin/main\` resolves, then re-run`);
    process.exit(1);
  }
  throw err;
}
