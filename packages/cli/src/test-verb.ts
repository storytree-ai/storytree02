/**
 * `storytree test <files|package-dirs...>` — run EXACTLY the named tests, under each package's own
 * declared runner, for every package CI runs (`verification-integrity-arc`, increment
 * `storytree-test-verb-covers-every-package`; owner: "B, cover everything").
 *
 * WHERE THE RUNNER COMES FROM. The worker's existing-test module (`test-suite-runner.ts` in
 * `@storytree/orchestrator`, PR #1988) already derives a package's runner from its OWN `test` script
 * — no per-package table — and this verb calls it where it lives. It covers the `bun test` and
 * `node --test` packages, where an ABSOLUTE file argument is a path, not a filter (measured for bun
 * 1.4 on this box: `bun test <abs>/x.test.ts` beside `x.test.tsx` runs one file).
 *
 * THE VITEST PACKAGES are the real work, and the reason that module refuses them: vitest's
 * positionals are FILTERS. An absolute `src/a.test.ts` also matches `src/a.test.tsx`
 * (prefix, case-insensitive), and its relative form matches `server/src/a.test.ts` (substring). So
 * this verb names each file as its filter AND `--exclude`s every other test file of the package the
 * filter could reach, then asks vitest ITSELF — `vitest list --filesOnly` with the identical
 * arguments — which files it would run. Only when that set equals the named set does it run; any
 * other answer REFUSES, naming the difference. The oracle is vitest's own matcher, not a copy of it.
 *
 * A PACKAGE DIRECTORY runs that package's whole suite through `pnpm run test` — the exact command CI
 * runs, first `&&` segment included.
 *
 * The worker's allow-list fence is untouched: this is a developer verb run from a shell that could
 * already run anything, and the worker's `run_tests` path still offers no vitest choices.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  listTestFiles,
  namedSubsetRunner,
  readTestScript,
  splitScriptSegments,
  testSelectionCommands,
} from "@storytree/orchestrator";

import type { Envelope } from "./envelope.js";

/** The workspace roots a package lives under (`pnpm-workspace.yaml`). */
const WORKSPACE_ROOTS: ReadonlySet<string | undefined> = new Set(["packages", "apps"]);

/** One spawn: an executable, its argv, its directory; `shell` only for the `pnpm` suite run. */
export interface TestSpawn {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell: boolean;
}

/** One package's share of an invocation. */
export interface PlannedTestRun {
  readonly packageDir: string;
  /** Package-relative, POSIX, sorted — empty for a whole-suite run. */
  readonly files: readonly string[];
  readonly command: TestSpawn;
  /** A vitest run's pre-flight: `vitest list --filesOnly` with the run's own filter arguments. */
  readonly preflight?: TestSpawn;
}

export type TestPlan =
  | { readonly ok: true; readonly runs: readonly PlannedTestRun[] }
  | { readonly ok: false; readonly refusal: string };

/** Everything the verb needs from the world, injected so its decisions are testable. */
export interface TestVerbIo {
  /** The workspace root (the repo checkout). */
  readonly workspace: string;
  /** Where relative arguments resolve from — the directory the operator typed the command in. */
  readonly cwd: string;
  /** The package's `test` script; `undefined` when it has none (or is no package). */
  readonly readTestScript: (packageDir: string) => string | undefined;
  /** The package's test files, package-relative and POSIX (`listTestFiles`). */
  readonly listTestFiles: (packageDir: string) => readonly string[];
  /** Absolute path of the vitest CLI entry this package resolves, or `undefined`. */
  readonly vitestEntry: (packageDir: string) => string | undefined;
  /** Run, streaming to the terminal; returns the exit code (`null` = killed). */
  readonly run: (spawn: TestSpawn) => number | null;
  /** Run and CAPTURE stdout — the vitest pre-flight. */
  readonly capture: (spawn: TestSpawn) => { readonly status: number | null; readonly stdout: string };
}

/** A glob metacharacter makes an exact `--exclude` impossible to write, so its presence refuses. */
const GLOB_META = /[*?[\]{}()!+@]/;

/**
 * Whether a package's `test` script is a plain `vitest run [roots...]`. Any FLAG disqualifies it:
 * which vitest flags consume a value is not something this verb knows, and guessing wrong would turn
 * a flag's value into a filter (or drop a config).
 */
export function isPlainVitestRun(testScript: string): boolean {
  const segment = splitScriptSegments(testScript).find((tokens) => tokens[0] === "vitest");
  return segment?.[1] === "run" && segment.every((token) => !token.startsWith("-"));
}

/**
 * Every OTHER test file of the package a vitest filter for `named` could reach — a SUPERSET of
 * vitest's own matcher (it tests `startsWith` on the absolute form and `includes` on the relative
 * form, both lower-cased), so an over-wide exclude is harmless and an under-wide one is caught by the
 * pre-flight.
 */
export function vitestExcludes(named: readonly string[], packageFiles: readonly string[]): string[] {
  const needles = named.map((n) => n.toLowerCase());
  return packageFiles.filter(
    (f) => !named.includes(f) && needles.some((n) => f.toLowerCase().includes(n)),
  );
}

/** Parse `vitest list --filesOnly` output (root-relative paths, one per line), sorted. */
export function parseVitestList(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim().replaceAll("\\", "/"))
    .filter((line) => line !== "")
    .sort();
}

/** Relative arguments resolve from where the operator typed the command: pnpm's `INIT_CWD`, else cwd. */
export function operatorCwd(env: Readonly<Record<string, string | undefined>>, cwd: string): string {
  return env["INIT_CWD"] ?? cwd;
}

/**
 * Resolve the arguments into one run per package — or a refusal naming every argument it could not
 * make exact. All-or-nothing: a partial run of what was asked would read as the whole of it.
 */
export function planTestRun(args: readonly string[], io: TestVerbIo): TestPlan {
  if (args.length === 0) {
    return { ok: false, refusal: "storytree test: name at least one test file or package directory." };
  }
  const problems: string[] = [];
  const suites = new Set<string>();
  const filesByPackage = new Map<string, { readonly script: string; readonly files: string[] }>();
  for (const arg of args) {
    const rel = path.relative(io.workspace, path.resolve(io.cwd, arg)).replaceAll("\\", "/");
    const parts = rel.split("/");
    const packageDir = parts.slice(0, 2).join("/");
    const rest = parts.slice(2);
    const script = WORKSPACE_ROOTS.has(parts[0]) ? io.readTestScript(packageDir) : undefined;
    if (script === undefined) {
      problems.push(`  ${arg}: not inside a workspace package that declares a \`test\` script`);
      continue;
    }
    if (rest.length === 0) {
      suites.add(packageDir);
      continue;
    }
    const file = rest.join("/");
    if (!io.listTestFiles(packageDir).includes(file)) {
      problems.push(`  ${arg}: not a test file of ${packageDir} — name test files, or the package directory for its whole suite`);
      continue;
    }
    filesByPackage.set(packageDir, { script, files: [...(filesByPackage.get(packageDir)?.files ?? []), file] });
  }

  const runs: PlannedTestRun[] = [...suites].sort().map((packageDir) => ({
    packageDir,
    files: [],
    command: { file: "pnpm", args: ["run", "test"], cwd: path.join(io.workspace, packageDir), shell: true },
  }));
  for (const [packageDir, named] of [...filesByPackage].sort(([a], [b]) => a.localeCompare(b))) {
    // A named file in a package also named whole is already covered by that suite run.
    if (suites.has(packageDir)) continue;
    const planned = planPackageFiles(packageDir, named.script, [...new Set(named.files)].sort(), io);
    if (typeof planned === "string") problems.push(planned);
    else runs.push(...planned);
  }

  if (problems.length > 0) {
    return {
      ok: false,
      refusal: [
        "storytree test REFUSED — nothing was run, because running part of what you asked would read as all of it:",
        ...problems,
      ].join("\n"),
    };
  }
  return { ok: true, runs };
}

function planPackageFiles(
  packageDir: string,
  script: string,
  files: readonly string[],
  io: TestVerbIo,
): PlannedTestRun[] | string {
  const cwd = path.join(io.workspace, packageDir);
  const runner = namedSubsetRunner(script);
  if (runner !== undefined) {
    // The worker module's own command builder: absolute file arguments, the package as cwd.
    const testFiles = files.map((f) => `${packageDir}/${f}`);
    return testSelectionCommands({
      suites: [{ packageDir, runner, testFiles }],
      chosen: testFiles,
      workspace: io.workspace,
      timeoutMs: 0,
    }).map(({ command }) => ({ packageDir, files, command: { file: command.file, args: command.args, cwd, shell: false } }));
  }
  if (!isPlainVitestRun(script)) {
    return `  ${packageDir}: its test script ${JSON.stringify(script)} names no runner this verb can drive exactly — run the package directory for its whole suite`;
  }
  const entry = io.vitestEntry(packageDir);
  if (entry === undefined) return `  ${packageDir}: vitest is not installed for this package (run \`pnpm install\`)`;
  const excludes = vitestExcludes(files, io.listTestFiles(packageDir));
  const unsafe = [...files, ...excludes].filter((f) => GLOB_META.test(f));
  if (unsafe.length > 0) {
    return `  ${packageDir}: cannot write an exact vitest filter for ${unsafe.join(", ")} (glob characters in the path)`;
  }
  const filter = [...files.map((f) => path.join(cwd, f)), ...excludes.flatMap((f) => ["--exclude", f])];
  return [
    {
      packageDir,
      files,
      command: { file: "node", args: [entry, "run", ...filter], cwd, shell: false },
      preflight: { file: "node", args: [entry, "list", "--filesOnly", ...filter], cwd, shell: false },
    },
  ];
}

function commandLine(spawn: TestSpawn): string {
  return [spawn.file, ...spawn.args].join(" ");
}

/** Plan, pre-flight every vitest run, then run each package in turn and report per package. */
export function testCommand(args: readonly string[], io: TestVerbIo): Envelope {
  const plan = planTestRun(args, io);
  const next = ["storytree test --help"];
  if (!plan.ok) return { ok: false, body: plan.refusal, next };

  // Every pre-flight before any run, so a refusal never follows a partial run.
  for (const run of plan.runs) {
    if (run.preflight === undefined) continue;
    const listed = io.capture(run.preflight);
    const got = parseVitestList(listed.stdout);
    const extra = got.filter((f) => !run.files.includes(f));
    const missing = run.files.filter((f) => !got.includes(f));
    if (listed.status !== 0 || extra.length + missing.length > 0) {
      return {
        ok: false,
        body: [
          `storytree test REFUSED — vitest would not run exactly the named files in ${run.packageDir}, so nothing was run.`,
          `  pre-flight: ${commandLine(run.preflight)} (exit ${String(listed.status)})`,
          `  would ALSO run: ${extra.join(", ") || "-"}`,
          `  would NOT run: ${missing.join(", ") || "-"}`,
        ].join("\n"),
        next,
      };
    }
  }

  const lines = plan.runs.map((run) => {
    const status = io.run(run.command);
    const what = run.files.length === 0 ? "whole suite" : run.files.join(", ");
    return { status, line: `  ${status === 0 ? "PASS" : "FAIL"}  ${run.packageDir} (${what}) — exit ${String(status)}: ${commandLine(run.command)}` };
  });
  const ok = lines.every((l) => l.status === 0);
  return {
    ok,
    body: [`storytree test — ${ok ? "every run passed" : "a run FAILED"}:`, ...lines.map((l) => l.line)].join("\n"),
    next,
  };
}

/** The real filesystem and process wiring. */
export function defaultTestVerbIo(workspace: string, cwd: string): TestVerbIo {
  return {
    workspace,
    cwd,
    readTestScript: (packageDir) => readTestScript(workspace, packageDir),
    listTestFiles: (packageDir) => listTestFiles(path.join(workspace, packageDir)),
    vitestEntry: (packageDir) => {
      const entry = path.join(workspace, packageDir, "node_modules", "vitest", "vitest.mjs");
      return existsSync(entry) ? entry : undefined;
    },
    // Stryker disable next-line StringLiteral: EQUIVALENT to every assertion a test can make — an
    // empty `stdio` falls back to pipes, which changes only whether the runner's output reaches the
    // operator's terminal, never the exit code the verb reports.
    run: (s) => spawnSync(s.file, [...s.args], { cwd: s.cwd, stdio: "inherit", shell: s.shell }).status,
    capture: (s) => {
      const r = spawnSync(s.file, [...s.args], { cwd: s.cwd, encoding: "utf8" });
      return { status: r.status, stdout: r.stdout };
    },
  };
}

const TEST_HELP_BODY = [
  "storytree test <file|package-dir> [...]",
  "",
  "Run EXACTLY the named test files under each package's own declared runner (derived from its",
  "package.json `test` script), for every package CI runs — bun, node --test and vitest alike.",
  "A package directory (packages/agent) runs that package's whole suite via `pnpm run test`.",
  "",
  "vitest treats file arguments as filters, so each vitest run is pre-flighted with",
  "`vitest list --filesOnly`; if vitest would run more (or fewer) files than named, it REFUSES.",
  "Any argument it cannot make exact refuses the whole invocation — nothing runs partially.",
].join("\n");

export function testHelp(): Envelope {
  return { ok: true, body: TEST_HELP_BODY, next: ["storytree test packages/cli/src/test-verb.test.ts"] };
}
