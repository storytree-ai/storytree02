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
import { readFileSync, statSync } from "node:fs";
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
const WORKSPACE_ROOTS = new Set(["packages", "apps"]);

/** A run's ceiling. Generous: this is a developer's terminal, and the runner's own timeouts still bind. */
const RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** One spawn: an executable, its argv, its directory; `shell` only for the `pnpm` suite run. */
export interface TestSpawn {
  readonly file: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly shell?: boolean;
}

/** One package's share of an invocation. */
export interface PlannedTestRun {
  readonly packageDir: string;
  /** `suite` runs the package's own `test` script; `files` runs exactly {@link files}. */
  readonly mode: "suite" | "files";
  /** Package-relative, POSIX, sorted — empty for a suite run. */
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
  readonly kind: (absPath: string) => "file" | "dir" | undefined;
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

function toPosix(p: string): string {
  return p.split(path.sep).join("/").split(path.win32.sep).join("/");
}

/** A glob metacharacter makes an exact `--exclude` impossible to write, so its presence refuses. */
const GLOB_META = /[*?[\]{}()!+@]/;

/**
 * The vitest invocation minus its positionals — `["run"]` — or `undefined` when the script is not a
 * plain `vitest run [roots...]`. Any FLAG refuses: which vitest flags consume a value is not something
 * this verb knows, and guessing wrong would turn a flag's value into a filter (or drop a config).
 */
export function vitestRunArgs(testScript: string | undefined): readonly string[] | undefined {
  if (testScript === undefined) return undefined;
  for (const tokens of splitScriptSegments(testScript)) {
    const head = tokens[0];
    if (head === undefined) continue;
    const name = (head.split(/[\\/]/).pop() ?? head).toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, "");
    if (name !== "vitest") continue;
    if (tokens[1] !== "run") return undefined;
    if (tokens.slice(2).some((t) => t.startsWith("-"))) return undefined;
    return ["run"];
  }
  return undefined;
}

/**
 * Every OTHER test file of the package a vitest filter for `named` could reach — a SUPERSET of
 * vitest's own matcher (it tests `startsWith` on the absolute form and `includes` on the relative
 * form, both lower-cased), so an over-wide exclude is harmless and an under-wide one is caught by the
 * pre-flight.
 */
export function vitestExcludes(named: readonly string[], packageFiles: readonly string[]): string[] {
  const wanted = new Set(named);
  const needles = named.map((n) => n.toLowerCase());
  return packageFiles
    .filter((f) => !wanted.has(f))
    .filter((f) => needles.some((n) => f.toLowerCase().includes(n)))
    .sort();
}

/** Parse `vitest list --filesOnly` output into package-relative POSIX paths. */
export function parseVitestList(stdout: string, packageAbs: string): string[] {
  const out = new Set<string>();
  const base = toPosix(packageAbs).toLowerCase();
  for (const raw of stdout.split(/\r?\n/)) {
    const line = toPosix(raw.trim());
    if (line === "" || !/\.(test|spec)\.(m|c)?[jt]sx?$/.test(line)) continue;
    out.add(line.toLowerCase().startsWith(`${base}/`) ? line.slice(base.length + 1) : line);
  }
  return [...out].sort();
}

function refuse(lines: readonly string[]): TestPlan {
  return { ok: false, refusal: lines.join("\n") };
}

/**
 * Resolve the arguments into one run per package — or a refusal naming every argument it could not
 * make exact. All-or-nothing: a partial run of what was asked would read as the whole of it.
 */
export function planTestRun(args: readonly string[], io: TestVerbIo): TestPlan {
  if (args.length === 0) {
    return refuse(["storytree test: name at least one test file or package directory."]);
  }
  const problems: string[] = [];
  const suites = new Set<string>();
  const filesByPackage = new Map<string, Set<string>>();
  for (const arg of args) {
    const abs = path.resolve(io.cwd, arg);
    const rel = toPosix(path.relative(io.workspace, abs));
    if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
      problems.push(`  ${arg}: outside the workspace (${io.workspace})`);
      continue;
    }
    const parts = rel.split("/");
    const [root, name] = parts;
    if (root === undefined || name === undefined || !WORKSPACE_ROOTS.has(root)) {
      problems.push(`  ${arg}: not inside a workspace package (packages/* or apps/*)`);
      continue;
    }
    const packageDir = `${root}/${name}`;
    if (io.kind(path.join(io.workspace, packageDir, "package.json")) !== "file") {
      problems.push(`  ${arg}: ${packageDir} is not a workspace package (no package.json)`);
      continue;
    }
    const kind = io.kind(abs);
    if (parts.length === 2) {
      if (kind === "dir") suites.add(packageDir);
      else problems.push(`  ${arg}: no such package directory`);
      continue;
    }
    if (kind === undefined) {
      problems.push(`  ${arg}: no such file`);
      continue;
    }
    if (kind === "dir") {
      problems.push(`  ${arg}: a directory inside a package — name its test files, or the package directory for the whole suite`);
      continue;
    }
    const packageRel = parts.slice(2).join("/");
    if (!io.listTestFiles(packageDir).includes(packageRel)) {
      problems.push(`  ${arg}: not a test file of ${packageDir} (expected *.test.{ts,tsx,js,...} outside node_modules)`);
      continue;
    }
    const set = filesByPackage.get(packageDir) ?? new Set<string>();
    set.add(packageRel);
    filesByPackage.set(packageDir, set);
  }

  const runs: PlannedTestRun[] = [];
  for (const packageDir of [...suites].sort()) {
    if (io.readTestScript(packageDir) === undefined) {
      problems.push(`  ${packageDir}: has no \`test\` script, so CI runs nothing there`);
      continue;
    }
    runs.push({
      packageDir,
      mode: "suite",
      files: [],
      command: { file: "pnpm", args: ["run", "test"], cwd: path.join(io.workspace, packageDir), shell: true },
    });
  }
  for (const packageDir of [...filesByPackage.keys()].sort()) {
    // A named file in a package also named whole is already covered by that suite run.
    if (suites.has(packageDir)) continue;
    const files = [...(filesByPackage.get(packageDir) ?? [])].sort();
    const planned = planPackageFiles(packageDir, files, io);
    if ("problem" in planned) problems.push(planned.problem);
    else runs.push(planned.run);
  }

  if (problems.length > 0) {
    return refuse([
      "storytree test REFUSED — nothing was run, because running part of what you asked would read as all of it:",
      ...problems,
    ]);
  }
  return { ok: true, runs };
}

function planPackageFiles(
  packageDir: string,
  files: readonly string[],
  io: TestVerbIo,
): { readonly run: PlannedTestRun } | { readonly problem: string } {
  const script = io.readTestScript(packageDir);
  const packageAbs = path.join(io.workspace, packageDir);
  const runner = namedSubsetRunner(script);
  if (runner !== undefined) {
    // The worker module's own command builder: absolute file arguments, the package as cwd.
    const [selection] = testSelectionCommands({
      suites: [{ packageDir, runner, testFiles: files.map((f) => `${packageDir}/${f}`) }],
      chosen: files.map((f) => `${packageDir}/${f}`),
      workspace: io.workspace,
      timeoutMs: RUN_TIMEOUT_MS,
    });
    if (selection === undefined) return { problem: `  ${packageDir}: no command could be built for ${files.join(", ")}` };
    const { file, args, cwd } = selection.command;
    return { run: { packageDir, mode: "files", files, command: { file, args, cwd: cwd ?? packageAbs } } };
  }
  const vitestArgs = vitestRunArgs(script);
  if (vitestArgs === undefined) {
    return {
      problem: `  ${packageDir}: its test script (${JSON.stringify(script ?? "")}) names no runner this verb can drive exactly — run the package directory for its whole suite`,
    };
  }
  const entry = io.vitestEntry(packageDir);
  if (entry === undefined) {
    return { problem: `  ${packageDir}: vitest is not installed for this package (run \`pnpm install\`)` };
  }
  const excludes = vitestExcludes(files, io.listTestFiles(packageDir));
  const unsafe = [...files, ...excludes].filter((f) => GLOB_META.test(f));
  if (unsafe.length > 0) {
    return { problem: `  ${packageDir}: cannot write an exact vitest filter for ${unsafe.join(", ")} (glob characters in the path)` };
  }
  const filterArgs = [
    ...files.map((f) => path.join(packageAbs, f)),
    ...excludes.flatMap((f) => ["--exclude", f]),
  ];
  return {
    run: {
      packageDir,
      mode: "files",
      files,
      command: { file: "node", args: [entry, ...vitestArgs, ...filterArgs], cwd: packageAbs },
      preflight: { file: "node", args: [entry, "list", "--filesOnly", ...filterArgs], cwd: packageAbs },
    },
  };
}

function describe(spawn: TestSpawn): string {
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
    const got = parseVitestList(listed.stdout, path.join(io.workspace, run.packageDir));
    const wanted = [...run.files].sort();
    if (listed.status !== 0 || got.join("\n") !== wanted.join("\n")) {
      const extra = got.filter((f) => !wanted.includes(f));
      const missing = wanted.filter((f) => !got.includes(f));
      return {
        ok: false,
        body: [
          `storytree test REFUSED — vitest would not run exactly the named files in ${run.packageDir}, so nothing was run.`,
          `  pre-flight: ${describe(run.preflight)} (exit ${String(listed.status)})`,
          ...(extra.length > 0 ? [`  would ALSO run: ${extra.join(", ")}`] : []),
          ...(missing.length > 0 ? [`  would NOT run: ${missing.join(", ")} (outside this package's vitest include?)`] : []),
        ].join("\n"),
        next,
      };
    }
  }

  const lines: string[] = [];
  let ok = true;
  for (const run of plan.runs) {
    const status = io.run(run.command);
    if (status !== 0) ok = false;
    const what = run.mode === "suite" ? "whole suite" : `${run.files.length} file(s)`;
    lines.push(`  ${status === 0 ? "PASS" : "FAIL"}  ${run.packageDir} (${what}) — exit ${String(status)}: ${describe(run.command)}`);
  }
  return {
    ok,
    body: [`storytree test — ${ok ? "every run passed" : "a run FAILED"}:`, ...lines].join("\n"),
    next,
  };
}

/** The real filesystem and process wiring. */
export function defaultTestVerbIo(workspace: string, cwd: string): TestVerbIo {
  return {
    workspace,
    cwd,
    kind: (abs) => {
      try {
        const st = statSync(abs);
        return st.isDirectory() ? "dir" : st.isFile() ? "file" : undefined;
      } catch {
        return undefined;
      }
    },
    readTestScript: (packageDir) => readTestScript(workspace, packageDir),
    listTestFiles: (packageDir) => listTestFiles(path.join(workspace, packageDir)),
    vitestEntry: (packageDir) => {
      const dir = path.join(workspace, packageDir, "node_modules", "vitest");
      try {
        const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as { bin?: unknown };
        const bin = typeof pkg.bin === "string" ? pkg.bin : (pkg.bin as Record<string, unknown> | undefined)?.["vitest"];
        return typeof bin === "string" ? path.join(dir, bin) : undefined;
      } catch {
        return undefined;
      }
    },
    run: (s) =>
      spawnSync(s.file, [...s.args], { cwd: s.cwd, stdio: "inherit", shell: s.shell ?? false, timeout: RUN_TIMEOUT_MS })
        .status,
    capture: (s) => {
      const r = spawnSync(s.file, [...s.args], { cwd: s.cwd, encoding: "utf8", shell: s.shell ?? false, timeout: RUN_TIMEOUT_MS });
      return { status: r.status, stdout: r.stdout ?? "" };
    },
  };
}

export function testHelp(): Envelope {
  return {
    ok: true,
    body: [
      "storytree test <file|package-dir> [...]",
      "",
      "Run EXACTLY the named test files under each package's own declared runner (derived from its",
      "package.json `test` script), for every package CI runs — bun, node --test and vitest alike.",
      "A package directory (packages/agent) runs that package's whole suite via `pnpm run test`.",
      "",
      "vitest treats file arguments as filters, so each vitest run is pre-flighted with",
      "`vitest list --filesOnly`; if vitest would run more (or fewer) files than named, it REFUSES.",
      "Any argument it cannot make exact refuses the whole invocation — nothing runs partially.",
    ].join("\n"),
    next: ["storytree test packages/cli/src/cli-areas.test.ts"],
  };
}
