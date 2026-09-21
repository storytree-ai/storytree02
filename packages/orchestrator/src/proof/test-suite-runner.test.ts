/**
 * `worker-can-run-the-existing-tests` (ADR-0581 D3 / ADR-0587): the spine's own answers to WHICH
 * existing tests a worker may run and HOW to run a named subset of them.
 *
 * The load-bearing test here is `real-repo-scripts`, which drives `namedSubsetRunner` over every
 * workspace package's ACTUAL `test` script rather than over fixtures alone. Fixtures prove the
 * parser does what this file thinks the scripts look like; only the real table proves the scripts
 * still look like that. A package whose script grows a shape this cannot drive precisely would
 * otherwise go silently choice-less — a worker simply never offered its neighbouring tests, with
 * nothing red anywhere to say so, which is the fault class this increment exists to close.
 *
 * `packages/orchestrator` is OUTSIDE the mutation rung (ADR-0473), so nothing fault-seeds these
 * assertions. That gap is declared rather than papered over (ADR-0563 / ADR-0447): the assertions
 * below are written to name exact values rather than shapes, which is the discipline the rung would
 * otherwise enforce.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import {
  listTestFiles,
  namedSubsetRunner,
  readTestScript,
  resolveRunnableSuites,
  runTestsDescription,
  runTestsParameter,
  scopeExistingTestFiles,
  scopePackageDirs,
  splitScriptSegments,
  suiteChoices,
  testSelectionCommands,
} from "./test-suite-runner.js";
import type { RunnableSuite, SuiteResolutionIO } from "./test-suite-runner.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

// ---- splitScriptSegments ----

test("splitScriptSegments: splits on && and keeps quoted operands whole", () => {
  assert.deepEqual(splitScriptSegments('a b && c "d e"'), [
    ["a", "b"],
    ["c", "d e"],
  ]);
});

test("splitScriptSegments: a quoted glob stays ONE token, quotes stripped", () => {
  assert.deepEqual(splitScriptSegments('node --test "src/**/*.test.ts"'), [
    ["node", "--test", "src/**/*.test.ts"],
  ]);
});

test("splitScriptSegments: an EMPTY quoted operand is still a token", () => {
  assert.deepEqual(splitScriptSegments('bun test ""'), [["bun", "test", ""]]);
});

test("splitScriptSegments: a single & is not a separator", () => {
  assert.deepEqual(splitScriptSegments("a & b"), [["a", "&", "b"]]);
});

test("splitScriptSegments: collapses runs of whitespace and yields no empty segment", () => {
  assert.deepEqual(splitScriptSegments("  a\t\tb  &&   "), [["a", "b"]]);
});

// ---- namedSubsetRunner ----

test("namedSubsetRunner: bun keeps its flags and drops the suite root", () => {
  assert.deepEqual(namedSubsetRunner("bun test --timeout 300000 src/"), [
    "bun",
    "test",
    "--timeout",
    "300000",
  ]);
});

test("namedSubsetRunner: a value-taking bun flag keeps its VALUE, which is not a suite root", () => {
  assert.deepEqual(
    namedSubsetRunner("bun test --preload ../../scripts/tsx-cache-off.mjs --timeout 300000 src/"),
    ["bun", "test", "--preload", "../../scripts/tsx-cache-off.mjs", "--timeout", "300000"],
  );
});

test("namedSubsetRunner: EVERY suite root is dropped, not just the last", () => {
  assert.deepEqual(namedSubsetRunner("bun test --timeout 300000 src/ harness/ electron/"), [
    "bun",
    "test",
    "--timeout",
    "300000",
  ]);
});

test("namedSubsetRunner: node keeps its loader flags and --test, and drops the glob", () => {
  assert.deepEqual(
    namedSubsetRunner('node --import ../../scripts/tsx-cache-off.mjs --import tsx --test "src/**/*.test.ts"'),
    ["node", "--import", "../../scripts/tsx-cache-off.mjs", "--import", "tsx", "--test"],
  );
});

test("namedSubsetRunner: an && chain picks the segment that IS a runner, not the first segment", () => {
  assert.deepEqual(
    namedSubsetRunner(
      "node --import ../../scripts/tsx-cache-off.mjs --import tsx scripts/validate-corpus.ts && " +
        "bun test --preload ../../scripts/tsx-cache-off.mjs --timeout 300000 src/",
    ),
    ["bun", "test", "--preload", "../../scripts/tsx-cache-off.mjs", "--timeout", "300000"],
  );
});

test("namedSubsetRunner: a node script WITHOUT --test is not a runner", () => {
  assert.equal(namedSubsetRunner("node --import tsx scripts/validate-corpus.ts"), undefined);
});

test("namedSubsetRunner: `bun` not followed by `test` is not the bun test runner", () => {
  assert.equal(namedSubsetRunner("bun run build"), undefined);
});

test("namedSubsetRunner: vitest is refused — its positionals are filters, not paths", () => {
  assert.equal(namedSubsetRunner("vitest run"), undefined);
  assert.equal(namedSubsetRunner("vitest run src/ server/"), undefined);
});

test("namedSubsetRunner: an absent or unrecognised script is refused, never guessed", () => {
  assert.equal(namedSubsetRunner(undefined), undefined);
  assert.equal(namedSubsetRunner(""), undefined);
  assert.equal(namedSubsetRunner("echo no tests here"), undefined);
});

test("namedSubsetRunner: a `--flag=value` form consumes no following token", () => {
  assert.deepEqual(namedSubsetRunner("bun test --timeout=300000 src/"), [
    "bun",
    "test",
    "--timeout=300000",
  ]);
});

test("namedSubsetRunner: the node token is normalised to `node`, never the spine's own runtime", () => {
  // `process.execPath` under bun is `bun.exe`; a command the spine BUILDS must name node itself.
  assert.deepEqual(namedSubsetRunner("/usr/local/bin/node.exe --test src/"), ["node", "--test"]);
});

test(
  "real-repo-scripts: every workspace package either resolves to a named-subset runner or is a " +
    "vitest package, and the two bun/node shapes resolve to exactly what their script declares",
  () => {
    const roots = ["packages", "apps"];
    const seen: { dir: string; script: string; runner: readonly string[] | undefined }[] = [];
    for (const root of roots) {
      for (const name of fs.readdirSync(path.join(REPO_ROOT, root))) {
        const dir = `${root}/${name}`;
        const script = readTestScript(REPO_ROOT, dir);
        if (script === undefined) continue;
        seen.push({ dir, script, runner: namedSubsetRunner(script) });
      }
    }
    assert.ok(seen.length >= 20, `expected the workspace's packages, found ${seen.length}`);
    for (const { dir, script, runner } of seen) {
      const isVitest = /(^|[\s&|;])vitest(\s|$)/.test(script);
      if (isVitest) {
        assert.equal(runner, undefined, `${dir}: a vitest script must not resolve to a runner`);
        continue;
      }
      assert.notEqual(runner, undefined, `${dir}: no named-subset runner for \`${script}\``);
      // The resolved runner must be a genuine invocation — a head plus at least the flag that
      // makes it a test run — and must carry NO positional operand, or a selection would run the
      // package's whole suite ON TOP of the files it was asked for.
      const resolved = runner ?? [];
      assert.ok(
        resolved[0] === "bun" || resolved[0] === "node",
        `${dir}: unexpected runner head ${String(resolved[0])}`,
      );
      if (resolved[0] === "bun") assert.equal(resolved[1], "test", `${dir}: bun without \`test\``);
      if (resolved[0] === "node") assert.ok(resolved.includes("--test"), `${dir}: node without --test`);
      for (const token of resolved.slice(resolved[0] === "bun" ? 2 : 1)) {
        assert.ok(
          token.startsWith("-") || resolved[resolved.indexOf(token) - 1]?.startsWith("-") === true,
          `${dir}: \`${token}\` survived as a positional operand`,
        );
      }
    }
    // The two shapes this repo actually runs, named exactly, so a silent change to either is red.
    const agent = seen.find((s) => s.dir === "packages/agent");
    assert.deepEqual(agent?.runner, ["bun", "test", "--timeout", "300000"]);
    const orchestrator = seen.find((s) => s.dir === "packages/orchestrator");
    assert.deepEqual(orchestrator?.runner, [
      "node",
      "--import",
      "../../scripts/tsx-cache-off.mjs",
      "--import",
      "tsx",
      "--test",
    ]);
  },
);

// ---- scopePackageDirs ----

test("scopePackageDirs: one package from a literal test/source pair, deduplicated", () => {
  assert.deepEqual(
    scopePackageDirs({
      testGlobs: ["packages/agent/src/a.test.ts"],
      sourceGlobs: ["packages/agent/src/a.ts"],
    }),
    ["packages/agent"],
  );
});

test("scopePackageDirs: several packages, in first-seen order with tests first", () => {
  assert.deepEqual(
    scopePackageDirs({
      testGlobs: ["packages/drive/src/a.test.ts"],
      sourceGlobs: ["packages/agent/src/b.ts", "apps/studio/src/c.ts"],
    }),
    ["packages/drive", "packages/agent", "apps/studio"],
  );
});

test("scopePackageDirs: a path outside a workspace root contributes no package", () => {
  assert.deepEqual(
    scopePackageDirs({ testGlobs: ["docs/x.md", "README.md"], sourceGlobs: ["scripts/y.mjs"] }),
    [],
  );
});

test("scopePackageDirs: a GLOB in the package segment names no single package, so it is refused", () => {
  assert.deepEqual(
    scopePackageDirs({ testGlobs: ["packages/*/src/**/*.test.ts"], sourceGlobs: [] }),
    [],
  );
});

test("scopePackageDirs: a windows-separated or ./-prefixed scope entry still resolves", () => {
  assert.deepEqual(
    scopePackageDirs({
      testGlobs: [`packages${path.win32.sep}agent${path.win32.sep}src${path.win32.sep}a.test.ts`],
      sourceGlobs: ["./packages/agent/src/a.ts"],
    }),
    ["packages/agent"],
  );
});

// ---- listTestFiles ----

test("listTestFiles: walks nested sources, skips node_modules and dot directories, sorts", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "suite-list-"));
  try {
    fs.mkdirSync(path.join(root, "src", "nested"), { recursive: true });
    fs.mkdirSync(path.join(root, "node_modules", "dep"), { recursive: true });
    fs.mkdirSync(path.join(root, ".cache"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "b.test.ts"), "");
    fs.writeFileSync(path.join(root, "src", "a.test.tsx"), "");
    fs.writeFileSync(path.join(root, "src", "nested", "c.test.ts"), "");
    fs.writeFileSync(path.join(root, "src", "plain.ts"), "");
    fs.writeFileSync(path.join(root, "node_modules", "dep", "d.test.ts"), "");
    fs.writeFileSync(path.join(root, ".cache", "e.test.ts"), "");
    assert.deepEqual(listTestFiles(root), [
      "src/a.test.tsx",
      "src/b.test.ts",
      "src/nested/c.test.ts",
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("listTestFiles: an unreadable directory contributes nothing rather than throwing", () => {
  assert.deepEqual(listTestFiles(path.join(os.tmpdir(), "no-such-package-dir-99182")), []);
});

// ---- readTestScript ----

test("readTestScript: reads the script, and answers undefined for absent/broken/non-string", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "suite-script-"));
  try {
    const write = (dir: string, body: string): string => {
      fs.mkdirSync(path.join(root, dir), { recursive: true });
      fs.writeFileSync(path.join(root, dir, "package.json"), body);
      return dir;
    };
    assert.equal(readTestScript(root, write("ok", '{"scripts":{"test":"bun test src/"}}')), "bun test src/");
    assert.equal(readTestScript(root, write("noscripts", "{}")), undefined);
    assert.equal(readTestScript(root, write("notest", '{"scripts":{"build":"tsc"}}')), undefined);
    assert.equal(readTestScript(root, write("notstring", '{"scripts":{"test":7}}')), undefined);
    assert.equal(readTestScript(root, write("broken", "{not json")), undefined);
    assert.equal(readTestScript(root, write("nullpkg", "null")), undefined);
    assert.equal(readTestScript(root, "absent"), undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ---- resolveRunnableSuites ----

function io(
  scripts: Record<string, string>,
  files: Record<string, readonly string[]>,
): SuiteResolutionIO {
  return {
    readTestScript: (dir) => scripts[dir],
    listTestFiles: (dir) => files[dir] ?? [],
  };
}

test("resolveRunnableSuites: a drivable package with test files becomes a suite, files prefixed", () => {
  const suites = resolveRunnableSuites(
    { testGlobs: ["packages/agent/src/a.test.ts"], sourceGlobs: [] },
    io({ "packages/agent": "bun test --timeout 300000 src/" }, { "packages/agent": ["src/b.test.ts", "src/a.test.ts"] }),
  );
  assert.deepEqual(suites, [
    {
      packageDir: "packages/agent",
      runner: ["bun", "test", "--timeout", "300000"],
      testFiles: ["packages/agent/src/a.test.ts", "packages/agent/src/b.test.ts"],
    },
  ]);
});

test("resolveRunnableSuites: an UNDRIVABLE runner is dropped, so it offers no choices", () => {
  assert.deepEqual(
    resolveRunnableSuites(
      { testGlobs: ["apps/studio/src/a.test.ts"], sourceGlobs: [] },
      io({ "apps/studio": "vitest run src/ server/" }, { "apps/studio": ["src/a.test.ts"] }),
    ),
    [],
  );
});

test("resolveRunnableSuites: a drivable package with NO test files is dropped, never spawned empty", () => {
  assert.deepEqual(
    resolveRunnableSuites(
      { testGlobs: ["packages/new/src/a.test.ts"], sourceGlobs: [] },
      io({ "packages/new": "bun test src/" }, { "packages/new": [] }),
    ),
    [],
  );
});

test("resolveRunnableSuites: a mixed scope keeps only the drivable package", () => {
  const suites = resolveRunnableSuites(
    {
      testGlobs: ["packages/agent/src/a.test.ts"],
      sourceGlobs: ["packages/app-surface/src/b.ts"],
    },
    io(
      { "packages/agent": "bun test src/", "packages/app-surface": "vitest run" },
      { "packages/agent": ["src/a.test.ts"], "packages/app-surface": ["src/b.test.ts"] },
    ),
  );
  assert.deepEqual(
    suites.map((s) => s.packageDir),
    ["packages/agent"],
  );
});

// ---- suiteChoices ----

test("suiteChoices: every suite's files, sorted and deduplicated across suites", () => {
  const suites: RunnableSuite[] = [
    { packageDir: "packages/b", runner: ["bun", "test"], testFiles: ["packages/b/y.test.ts"] },
    {
      packageDir: "packages/a",
      runner: ["bun", "test"],
      testFiles: ["packages/a/z.test.ts", "packages/a/x.test.ts", "packages/a/z.test.ts"],
    },
  ];
  assert.deepEqual(suiteChoices(suites), [
    "packages/a/x.test.ts",
    "packages/a/z.test.ts",
    "packages/b/y.test.ts",
  ]);
});

// ---- testSelectionCommands ----

const WORKSPACE = path.join(os.tmpdir(), "ws");

const AGENT: RunnableSuite = {
  packageDir: "packages/agent",
  runner: ["bun", "test", "--timeout", "300000"],
  testFiles: ["packages/agent/src/a.test.ts", "packages/agent/src/b.test.ts"],
};
const DRIVE: RunnableSuite = {
  packageDir: "packages/drive",
  runner: ["node", "--import", "tsx", "--test"],
  testFiles: ["packages/drive/src/c.test.ts"],
};

test("testSelectionCommands: the package's own runner, its own cwd, and ABSOLUTE file arguments", () => {
  const runs = testSelectionCommands({
    suites: [AGENT],
    chosen: ["packages/agent/src/b.test.ts"],
    workspace: WORKSPACE,
    timeoutMs: 600_000,
  });
  assert.deepEqual(runs, [
    {
      packageDir: "packages/agent",
      command: {
        file: "bun",
        args: [
          "test",
          "--timeout",
          "300000",
          path.join(WORKSPACE, "packages/agent/src/b.test.ts"),
        ],
        cwd: path.join(WORKSPACE, "packages/agent"),
        timeoutMs: 600_000,
      },
    },
  ]);
});

test("testSelectionCommands: a selection spanning packages yields ONE spawn each, in suite order", () => {
  const runs = testSelectionCommands({
    suites: [AGENT, DRIVE],
    chosen: ["packages/drive/src/c.test.ts", "packages/agent/src/a.test.ts"],
    workspace: WORKSPACE,
    timeoutMs: 1_000,
  });
  assert.deepEqual(
    runs.map((r) => r.packageDir),
    ["packages/agent", "packages/drive"],
  );
  assert.equal(runs[0]?.command.file, "bun");
  assert.equal(runs[1]?.command.file, "node");
  assert.deepEqual(runs[1]?.command.args, [
    "--import",
    "tsx",
    "--test",
    path.join(WORKSPACE, "packages/drive/src/c.test.ts"),
  ]);
});

test("testSelectionCommands: a package contributing no chosen file yields NO spawn", () => {
  const runs = testSelectionCommands({
    suites: [AGENT, DRIVE],
    chosen: ["packages/drive/src/c.test.ts"],
    workspace: WORKSPACE,
    timeoutMs: 1_000,
  });
  assert.deepEqual(
    runs.map((r) => r.packageDir),
    ["packages/drive"],
  );
});

test("testSelectionCommands: a name no suite offers is ignored, never passed to a runner", () => {
  const runs = testSelectionCommands({
    suites: [AGENT],
    chosen: ["packages/agent/src/a.test.ts", "packages/elsewhere/src/x.test.ts"],
    workspace: WORKSPACE,
    timeoutMs: 1_000,
  });
  assert.deepEqual(runs[0]?.command.args, [
    "test",
    "--timeout",
    "300000",
    path.join(WORKSPACE, "packages/agent/src/a.test.ts"),
  ]);
});

test("testSelectionCommands: the whole-set form runs every file of every suite", () => {
  const runs = testSelectionCommands({
    suites: [AGENT, DRIVE],
    chosen: suiteChoices([AGENT, DRIVE]),
    workspace: WORKSPACE,
    timeoutMs: 1_000,
  });
  assert.equal(runs.length, 2);
  assert.deepEqual(runs[0]?.command.args.slice(3), [
    path.join(WORKSPACE, "packages/agent/src/a.test.ts"),
    path.join(WORKSPACE, "packages/agent/src/b.test.ts"),
  ]);
});

test("testSelectionCommands: an empty selection yields no spawn at all", () => {
  assert.deepEqual(
    testSelectionCommands({ suites: [AGENT], chosen: [], workspace: WORKSPACE, timeoutMs: 1 }),
    [],
  );
});

// ---- the tool's declared shape ----

test("runTestsParameter: declares `files` over exactly the choices it was given", () => {
  const parameter = runTestsParameter(["packages/agent/src/a.test.ts"]);
  assert.equal(parameter.name, "files");
  assert.deepEqual(parameter.choices, ["packages/agent/src/a.test.ts"]);
  assert.match(parameter.description, /Omit to run every one of them/);
});

test("runTestsDescription: names each package with its file count, where it runs, and FEEDBACK ONLY", () => {
  const description = runTestsDescription([AGENT, DRIVE], "against the leaf's disposable replica");
  assert.match(description, /packages\/agent \(2 files\), packages\/drive \(1 files\)/);
  assert.match(description, /against the leaf's disposable replica/);
  assert.match(description, /FEEDBACK ONLY/);
  assert.match(description, /omit it to run them all/);
});

/**
 * ADR-0590 D1/D2: the one derivation every wall reads — the EXISTING test files of the packages a
 * unit's scope touches, as a concrete list rather than a glob.
 */
test("scopeExistingTestFiles: every existing test file of every package the scope touches, deduplicated and sorted", () => {
  const listed: Record<string, string[]> = {
    "packages/agent": ["src/b.test.ts", "src/a.test.ts", "src/nested/c.test.ts"],
    "packages/drive": ["src/d.test.ts"],
  };
  const files = scopeExistingTestFiles(
    { testGlobs: ["packages/agent/src/a.test.ts"], sourceGlobs: ["packages/drive/src/d.ts"] },
    "/ws",
    { listTestFiles: (dir) => listed[dir] ?? [] },
  );

  assert.deepEqual(files, [
    "packages/agent/src/a.test.ts",
    "packages/agent/src/b.test.ts",
    "packages/agent/src/nested/c.test.ts",
    "packages/drive/src/d.test.ts",
  ]);
});

test("scopeExistingTestFiles: a package with NO drivable runner still contributes its files", () => {
  // The divergence from `resolveRunnableSuites`, and the reason this is its own derivation: a vitest
  // package contributes no RUN choices (its positionals are filters, not paths), but the record is two
  // reads of a file and needs no runner — so its tests are writable and recorded all the same.
  const files = scopeExistingTestFiles(
    { testGlobs: ["apps/studio/src/x.test.ts"], sourceGlobs: [] },
    "/ws",
    { listTestFiles: (dir) => (dir === "apps/studio" ? ["src/x.test.ts", "src/y.test.ts"] : []) },
  );

  assert.deepEqual(files, ["apps/studio/src/x.test.ts", "apps/studio/src/y.test.ts"]);
  assert.deepEqual(
    resolveRunnableSuites(
      { testGlobs: ["apps/studio/src/x.test.ts"], sourceGlobs: [] },
      { readTestScript: () => "vitest run", listTestFiles: () => ["src/x.test.ts"] },
    ),
    [],
    "the same scope offers NO runnable suite — writable and recorded is not the same as runnable",
  );
});

test("scopeExistingTestFiles: a glob naming no single package contributes nothing, rather than inventing one", () => {
  assert.deepEqual(
    scopeExistingTestFiles(
      { testGlobs: ["packages/*/src/**/*.test.ts"], sourceGlobs: ["docs/notes.md", "tsconfig.base.json"] },
      "/ws",
      { listTestFiles: () => ["src/a.test.ts"] },
    ),
    [],
    "a wildcard package segment, a docs path and a repo-root file all resolve to no package",
  );
});

test("scopeExistingTestFiles: Windows separators from the walk are normalised to the record's form", () => {
  assert.deepEqual(
    scopeExistingTestFiles(
      { testGlobs: ["packages/agent/src/a.test.ts"], sourceGlobs: [] },
      "/ws",
      { listTestFiles: () => ["src\\nested\\a.test.ts"] },
    ),
    ["packages/agent/src/nested/a.test.ts"],
  );
});
