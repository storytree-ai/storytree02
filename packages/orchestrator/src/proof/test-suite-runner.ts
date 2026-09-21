/**
 * THE EXISTING TESTS A WORKER MAY RUN (`worker-can-run-the-existing-tests`, ADR-0581 D3 / ADR-0587).
 *
 * `run_proof` runs the unit's OWN proof command and `run_typecheck` runs the package typecheck.
 * Neither can run an EXISTING test, so since ADR-0580 removed the build's whole-suite re-run a
 * worker's breakage of a neighbouring test surfaced only at the landing gate — twice, in
 * `inner-loop-exit-arc`, at the end of a 40–50 minute build.
 *
 * This module computes the two things `run_tests` needs and the spine only half-knew:
 *
 *  1. **WHAT MAY BE RUN** — the test files under the packages the unit's declared scope touches.
 *     They become the tool's ADR-0587 `choices`: a set the SPINE enumerated, published to the model,
 *     and re-validated on every call. The leaf selects from it and never names a path, because a
 *     test file is a program and a tool that ran any path a caller named would be arbitrary code
 *     execution (ADR-0570's own rationale for the zero-argument fence).
 *  2. **HOW TO RUN A NAMED SUBSET** — the package's OWN runner, derived from its own `test` script.
 *
 * WHY THE PACKAGE'S OWN RUNNER, AND NOT ONE RUNNER FOR ALL OF THEM. Every `packages/*` test file
 * here imports `node:test` (593 of them, measured 2026-09-21), so `node --import tsx --test` would
 * *execute* the bun packages' tests too. It is still the wrong command: the landing gate and CI run
 * each package under the runner its own `test` script names, and a feedback run under a DIFFERENT
 * runner could pass where the gate fails, or fail where the gate passes. The whole point of this
 * tool is that a worker can see, before it hands back, what the gate will see — so the feedback run
 * and the gate must be one oracle, exactly as `run_proof` is one oracle with the spine's own CONFIRM
 * observation.
 *
 * WHAT IS DELIBERATELY NOT DRIVABLE. A `vitest run` package contributes no choices. Vitest's
 * positional arguments are FILTERS, not paths: it would run every test file whose path matches, so
 * "run exactly these" is not a request vitest can be given, and a feedback run that quietly ran more
 * than it was asked would misreport what it proved. That is the same narrowing the mutation rung
 * made for the same class of reason (`runnerFor` in `packages/cli/src/mutation-diff.ts` returns null
 * for a vitest project). Two packages are affected, `apps/studio` and `packages/app-surface`; a unit
 * scoped only to those registers no `run_tests` at all, which leaves its worker exactly as well off
 * as it was before this existed.
 */
import { readdirSync, readFileSync } from "node:fs";
import type { Dirent } from "node:fs";
import * as path from "node:path";

import type { FeedbackChoiceParameter } from "@storytree/agent";

import type { ShellCommand } from "../shell-test-executor.js";
import {
  BUN_TEST_FLAGS_TAKING_A_VALUE,
  NODE_BINARY,
  NODE_FLAGS_TAKING_A_VALUE,
  withPerTestReport,
} from "./proof-route.js";
import type { PerTestChannel } from "./per-test-report.js";

/** The workspace roots a package may live under, as `pnpm-workspace.yaml` declares them. */
const WORKSPACE_ROOTS = new Set(["packages", "apps"]);

/**
 * Directories never walked for test files: build output, dependency trees, VCS and tool scratch.
 * `node_modules` is the load-bearing one — a dependency's own `*.test.ts` is not this repo's test
 * and offering it as a choice would let a worker spend the build's clock on a stranger's suite.
 */
const UNWALKED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
  ".stryker-tmp",
  ".vite",
  ".turbo",
]);

/** A test file, by the extensions a runner here actually discovers. */
const TEST_FILE = /\.test\.(m|c)?[jt]sx?$/;

/** One package whose existing tests the spine can run a named subset of. */
export interface RunnableSuite {
  /** Workspace-relative package directory, POSIX-separated (`packages/agent`). */
  readonly packageDir: string;
  /**
   * The runner invocation MINUS the files — `["bun", "test", "--timeout", "300000"]`. Every flag the
   * package's own `test` script carries is kept (a dropped `--preload` would change what the run
   * loads); every positional suite root is dropped, because the caller names the files instead.
   */
  readonly runner: readonly string[];
  /** This package's test files, workspace-relative and POSIX-separated, sorted. */
  readonly testFiles: readonly string[];
}

/** Split a shell script into `&&`-separated segments of tokens, honouring quoted operands. */
export function splitScriptSegments(script: string): string[][] {
  const segments: string[][] = [];
  let tokens: string[] = [];
  let current = "";
  let quote: string | undefined;
  let hasCurrent = false;
  const endToken = (): void => {
    if (hasCurrent) tokens.push(current);
    current = "";
    hasCurrent = false;
  };
  const endSegment = (): void => {
    endToken();
    if (tokens.length > 0) segments.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < script.length; i += 1) {
    const ch = script[i];
    if (ch === undefined) continue;
    if (quote !== undefined) {
      if (ch === quote) quote = undefined;
      else {
        current += ch;
        hasCurrent = true;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      // An EMPTY quoted operand is still an operand, so the token exists the moment the quote opens.
      quote = ch;
      hasCurrent = true;
      continue;
    }
    if (ch === "&" && script[i + 1] === "&") {
      endSegment();
      i += 1;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      endToken();
      continue;
    }
    current += ch;
    hasCurrent = true;
  }
  endSegment();
  return segments;
}

/** The basename of an executable token, lower-cased and stripped of a Windows launcher suffix. */
function executableName(token: string): string {
  const base = token.split(/[\\/]/).pop() ?? token;
  return base.toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
}

/**
 * Keep every flag (and the value a value-taking flag consumes); drop every positional operand.
 *
 * The positionals are the suite ROOTS the script pointed its runner at (`src/`, `harness/`,
 * `"src/**\/*.test.ts"`), and dropping them is the whole point: the caller supplies the files. The
 * INVERSE of `explicitTestPaths` in `proof-route.ts`, which is why both read the same two flag sets
 * rather than each keeping a copy — a flag added to one and not the other would silently turn that
 * flag's VALUE into a suite root, or a suite root into a kept argument.
 */
function keepFlagsDropPositionals(
  tokens: readonly string[],
  startIndex: number,
  flagsTakingAValue: ReadonlySet<string>,
): string[] {
  const kept: string[] = [];
  for (let i = startIndex; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === undefined || !token.startsWith("-")) continue;
    kept.push(token);
    if (!flagsTakingAValue.has(token) || token.includes("=")) continue;
    const value = tokens[i + 1];
    if (value === undefined) continue;
    kept.push(value);
    i += 1;
  }
  return kept;
}

/**
 * The runner invocation that runs NAMED test files for a package, from its own `test` script — or
 * `undefined` when this module cannot drive that package precisely.
 *
 * Fails CLOSED on everything it does not recognise. A package whose script it cannot read offers no
 * choices, which costs a worker the tool; a package it drove WRONGLY would hand a worker a green it
 * had not earned, which is the failure this whole increment exists to prevent.
 *
 * `bun` names the bun runner; a `node` invocation counts only when `--test` survives as a flag,
 * which is what rejects `packages/cli`'s first `&&` segment (a plain `node … validate-corpus.ts`
 * script run) while admitting its second.
 */
export function namedSubsetRunner(testScript: string | undefined): readonly string[] | undefined {
  if (testScript === undefined) return undefined;
  for (const tokens of splitScriptSegments(testScript)) {
    const head = tokens[0];
    if (head === undefined) continue;
    const name = executableName(head);
    if (name === "bun") {
      if (tokens[1] !== "test") continue;
      return ["bun", "test", ...keepFlagsDropPositionals(tokens, 2, BUN_TEST_FLAGS_TAKING_A_VALUE)];
    }
    if (name === NODE_BINARY) {
      const flags = keepFlagsDropPositionals(tokens, 1, NODE_FLAGS_TAKING_A_VALUE);
      // NODE_BINARY, not the script's own token: a command the spine BUILDS must name node rather
      // than inherit whatever runtime happens to be running the spine (see that constant's note —
      // `process.execPath` under bun is `bun.exe`, and that substitution cost 25 failures once).
      if (flags.includes("--test")) return [NODE_BINARY, ...flags];
    }
  }
  return undefined;
}

/** Normalise a workspace-relative path to POSIX separators with no leading `./`. */
function posix(p: string): string {
  return p.split(path.win32.sep).join("/").replace(/^\.\//, "");
}

/**
 * The package directories a declared scope touches — `packages/agent` from
 * `packages/agent/src/**\/*.test.ts` — in first-seen order, deduplicated.
 *
 * Reads the first two segments and requires the first to be a declared workspace root, so a scope
 * entry that names something else (a repo-root file, a `docs/` path) contributes no package rather
 * than inventing one. A glob in EITHER segment is rejected for the same reason: `packages/*` names
 * no single package, and guessing which one it meant is how a worker ends up offered a suite its
 * unit never touches.
 */
export function scopePackageDirs(scope: {
  readonly testGlobs: readonly string[];
  readonly sourceGlobs: readonly string[];
}): string[] {
  const dirs: string[] = [];
  for (const glob of [...scope.testGlobs, ...scope.sourceGlobs]) {
    const [root, name] = posix(glob).split("/");
    if (root === undefined || name === undefined) continue;
    if (!WORKSPACE_ROOTS.has(root)) continue;
    if (/[*?[\]{}]/.test(root) || /[*?[\]{}]/.test(name)) continue;
    const dir = `${root}/${name}`;
    if (!dirs.includes(dir)) dirs.push(dir);
  }
  return dirs;
}

/**
 * Every EXISTING test file of the packages this scope touches, workspace-relative, POSIX-separated and
 * sorted — the set ADR-0590 makes the test-writer's write scope, the commit scope, Codex's promotion
 * manifest and the existing-test record all read.
 *
 * A CONCRETE FILE LIST, not a glob, and that choice is load-bearing in two directions. Codex's
 * promotion manifest keeps only literal entries — "pattern-shaped scope remains a hook wall only and
 * never becomes promotion authority" — so a glob would let a Codex test-writer edit a sibling test
 * inside its replica and then silently fail to promote it. And the increment's own words are EXISTING
 * test files: a list resolved from disk admits exactly the files that are there, where a package-wide
 * glob would also admit new files anywhere in the package, which is a wider grant than was decided.
 *
 * Unlike {@link resolveRunnableSuites} this does NOT require the package to have a drivable runner: the
 * record compares two reads of a file and needs none (ADR-0585 D1), so a vitest package's tests are
 * writable and recorded here even though no named subset of them can be run.
 */
export function scopeExistingTestFiles(
  scope: { readonly testGlobs: readonly string[]; readonly sourceGlobs: readonly string[] },
  workspace: string,
  io: Pick<SuiteResolutionIO, "listTestFiles"> = { listTestFiles: (dir) => listTestFiles(path.join(workspace, dir)) },
): string[] {
  const all = new Set<string>();
  for (const packageDir of scopePackageDirs(scope)) {
    for (const file of io.listTestFiles(packageDir)) all.add(`${packageDir}/${posix(file)}`);
  }
  return [...all].sort();
}

/** Every test file under `dir`, recursively, as paths relative to `dir` in POSIX form, sorted. */
export function listTestFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string, prefix: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      // A directory that cannot be read contributes nothing. A build whose workspace is missing a
      // package it declared has a much louder problem than this tool's choice list.
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (UNWALKED_DIRECTORIES.has(entry.name) || entry.name.startsWith(".")) continue;
        walk(path.join(current, entry.name), `${prefix}${entry.name}/`);
        continue;
      }
      if (entry.isFile() && TEST_FILE.test(entry.name)) found.push(`${prefix}${entry.name}`);
    }
  };
  walk(dir, "");
  return found.sort();
}

/** What {@link resolveRunnableSuites} needs from the world, injected so its decision is testable. */
export interface SuiteResolutionIO {
  /** This package's `test` script, or `undefined` when there is none to read. */
  readonly readTestScript: (packageDir: string) => string | undefined;
  /** This package's test files, relative to the package directory, POSIX-separated. */
  readonly listTestFiles: (packageDir: string) => readonly string[];
}

/** Read one package's `test` script off disk; `undefined` when absent or unreadable. */
export function readTestScript(workspace: string, packageDir: string): string | undefined {
  let raw: string;
  try {
    raw = readFileSync(path.join(workspace, packageDir, "package.json"), "utf8");
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const scripts = (parsed as { scripts?: unknown } | null)?.scripts;
  const script = (scripts as Record<string, unknown> | undefined)?.["test"];
  return typeof script === "string" ? script : undefined;
}

/** The real filesystem wiring of {@link SuiteResolutionIO} for a build's workspace. */
export function suiteResolutionIO(workspace: string): SuiteResolutionIO {
  return {
    readTestScript: (packageDir) => readTestScript(workspace, packageDir),
    listTestFiles: (packageDir) => listTestFiles(path.join(workspace, packageDir)),
  };
}

/**
 * The runnable suites for one unit's declared scope: every package the scope touches that has both a
 * drivable runner and at least one test file, in scope order.
 *
 * A package with a runner and NO test files is dropped, because a choice set it contributes nothing
 * to cannot be selected from anyway, and keeping it would let the whole-set form spawn a runner over
 * an empty argument list — which most runners read as "discover everything", i.e. the one answer
 * that would run far more than the worker asked for.
 */
export function resolveRunnableSuites(
  scope: { readonly testGlobs: readonly string[]; readonly sourceGlobs: readonly string[] },
  io: SuiteResolutionIO,
): RunnableSuite[] {
  const suites: RunnableSuite[] = [];
  for (const packageDir of scopePackageDirs(scope)) {
    const runner = namedSubsetRunner(io.readTestScript(packageDir));
    if (runner === undefined) continue;
    const testFiles = io.listTestFiles(packageDir).map((f) => `${packageDir}/${posix(f)}`);
    if (testFiles.length === 0) continue;
    suites.push({ packageDir, runner, testFiles: [...testFiles].sort() });
  }
  return suites;
}

/** Every workspace-relative test file the given suites offer, sorted and deduplicated. */
export function suiteChoices(suites: readonly RunnableSuite[]): string[] {
  const all = new Set<string>();
  for (const suite of suites) for (const file of suite.testFiles) all.add(file);
  return [...all].sort();
}

/** One package's share of a selection: the files chosen from it, and the command that runs them. */
export interface TestSelectionRun {
  /** The package these files belong to, for labelling a multi-package run's output. */
  readonly packageDir: string;
  /** The spawn: this package's own runner, its own directory, and the chosen files. */
  readonly command: ShellCommand;
}

/**
 * The spawns one validated selection asks for: at most one per package, in suite order, each over
 * the chosen files that belong to it.
 *
 * ABSOLUTE file arguments and an absolute `cwd`, both inside the workspace, because that is exactly
 * what `retargetShellCommand` moves into the Codex replica — a package-relative argument would be
 * left alone and the replica's run would read the real worktree's unedited file. `cwd` is the
 * PACKAGE directory rather than the workspace root, because a script's own relative flag values
 * (`--preload ../../scripts/tsx-cache-off.mjs`) are written against the directory pnpm runs it in.
 *
 * A package contributing no chosen file yields no spawn — never a spawn with no file arguments,
 * which most runners read as "discover everything".
 */
export function testSelectionCommands(args: {
  readonly suites: readonly RunnableSuite[];
  readonly chosen: readonly string[];
  readonly workspace: string;
  readonly timeoutMs: number;
}): TestSelectionRun[] {
  const wanted = new Set(args.chosen);
  const runs: TestSelectionRun[] = [];
  for (const suite of args.suites) {
    const files = suite.testFiles.filter((f) => wanted.has(f));
    if (files.length === 0) continue;
    const [file, ...flags] = suite.runner;
    if (file === undefined) continue;
    runs.push({
      packageDir: suite.packageDir,
      command: {
        file,
        args: [...flags, ...files.map((f) => path.join(args.workspace, f))],
        cwd: path.join(args.workspace, suite.packageDir),
        timeoutMs: args.timeoutMs,
      },
    });
  }
  return runs;
}

/** The ADR-0587 choice this tool declares: which existing test files to run. */
/**
 * The per-test report channel a suite's own runner writes (ADR-0591), or `undefined` when it writes
 * none — read from the runner tokens {@link namedSubsetRunner} already derived, so it agrees with the
 * command that will actually be spawned rather than with a second guess about the package.
 *
 * `vitest-json` is deliberately unreachable here: `namedSubsetRunner` refuses a vitest script outright
 * (its positionals are filters, not paths), so no vitest suite ever reaches this function. That is why a
 * changed test in `apps/studio` or `packages/app-surface` stays recorded-only.
 */
export function suiteReportChannel(runner: readonly string[]): PerTestChannel | undefined {
  const [file, ...flags] = runner;
  if (file === undefined) return undefined;
  if (executableName(file) === "bun" && flags.includes("test")) return "bun-junit";
  if (flags.includes("--test")) return "node-test";
  return undefined;
}

/**
 * The ONE spawn that runs a single existing test file and writes a per-test report (ADR-0591), or
 * `undefined` when no suite here offers that file or its runner writes no report.
 *
 * ONE FILE PER SPAWN, not one per package as {@link testSelectionCommands} does, and that is the whole
 * reason this is a separate function: a report's rows carry TITLE PATHS and no file, so a run covering
 * two files could not say which file a row came from — and two files in one package declaring the same
 * title is exactly the case the record's file stamp exists to tell apart.
 */
export function singleFileRun(args: {
  readonly suites: readonly RunnableSuite[];
  readonly file: string;
  readonly workspace: string;
  readonly timeoutMs: number;
  readonly reportPath: string;
}): { readonly channel: PerTestChannel; readonly command: ShellCommand } | undefined {
  const suite = args.suites.find((s) => s.testFiles.includes(args.file));
  if (suite === undefined) return undefined;
  const channel = suiteReportChannel(suite.runner);
  if (channel === undefined) return undefined;
  const [runs] = testSelectionCommands({
    suites: [suite],
    chosen: [args.file],
    workspace: args.workspace,
    timeoutMs: args.timeoutMs,
  });
  if (runs === undefined) return undefined;
  return { channel, command: withPerTestReport(runs.command, channel, args.reportPath) };
}

export function runTestsParameter(choices: readonly string[]): FeedbackChoiceParameter {
  return {
    name: "files",
    description:
      "Repo-relative paths of the existing test files to run, from the set this build offers. " +
      "Omit to run every one of them (the whole suite of the packages this unit touches), which " +
      "is correct but costs minutes of the build's own clock — name the files near your change " +
      "first.",
    choices,
  };
}

/** `packages/agent (41 files)`, `packages/agent (41) and packages/drive (89)` — a run's own scale. */
function describeSuites(suites: readonly RunnableSuite[]): string {
  return suites.map((s) => `${s.packageDir} (${s.testFiles.length} files)`).join(", ");
}

/**
 * What the model is told `run_tests` does.
 *
 * It states the RULE and the SCALE rather than listing the set: the Claude leaf's tool shape is
 * deliberately not an enum (ADR-0587 — the SDK re-serialises every tool definition every slice, and
 * these sets run to hundreds of entries), so a listed set would be paid for on every slice. The set
 * itself reaches the model two other ways: Codex reads it as a published enum in `tools/list`, and
 * on either runtime a refusal names what was available.
 */
export function runTestsDescription(suites: readonly RunnableSuite[], where: string): string {
  return (
    `Run EXISTING test files from the packages this unit touches — ${describeSuites(suites)} — ` +
    `${where}, with each package's own test runner, and return the exit code and output. Name the ` +
    "files in `files`; omit it to run them all. Use it to see how a test behaves before you change " +
    "anything, and to check that your change has not broken a neighbouring test — since the build " +
    "no longer re-runs whole suites, a break you do not find here surfaces only at the landing " +
    "gate. FEEDBACK ONLY: nothing here is an observation, and only the spine's own out-of-band runs " +
    "decide red and green."
  );
}
