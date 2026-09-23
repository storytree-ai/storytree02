/**
 * `storytree test` (`storytree-test-verb-covers-every-package`) — exactly the named files, every
 * package CI runs, refusing loudly whatever it cannot make exact.
 *
 * Two layers. The PLAN is proved over a fake world (which runner, which arguments, which refusals).
 * The load-bearing claim — a named file whose path is a prefix or substring of another test file's
 * does NOT pull that file in — is proved against the REAL runners in a throwaway workspace: vitest's
 * own `list --filesOnly` for the vitest route, and a real `bun test` for the bun route.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { InMemoryStore } from "@storytree/storage-protocol";

import { run } from "./commands.js";
import {
  defaultTestVerbIo,
  parseVitestList,
  planTestRun,
  testCommand,
  vitestExcludes,
  vitestRunArgs,
  type TestSpawn,
  type TestVerbIo,
} from "./test-verb.js";

const WS = path.resolve("/ws");

/** A fake workspace: package dir -> { script, files }. */
function fakeIo(
  packages: Record<string, { script?: string; files: string[]; vitest?: boolean }>,
  overrides: Partial<TestVerbIo> = {},
): TestVerbIo & { runs: TestSpawn[]; captures: TestSpawn[] } {
  const runs: TestSpawn[] = [];
  const captures: TestSpawn[] = [];
  const kind = (abs: string): "file" | "dir" | undefined => {
    const rel = path.relative(WS, abs).split(path.sep).join("/");
    for (const [dir, pkg] of Object.entries(packages)) {
      if (rel === dir || rel === `${dir}/src`) return "dir";
      if (rel === `${dir}/package.json` || rel === `${dir}/src/helper.ts`) return "file";
      if (pkg.files.some((f) => `${dir}/${f}` === rel)) return "file";
    }
    return undefined;
  };
  return {
    workspace: WS,
    cwd: WS,
    kind,
    readTestScript: (dir) => packages[dir]?.script,
    listTestFiles: (dir) => packages[dir]?.files ?? [],
    vitestEntry: (dir) => (packages[dir]?.vitest === true ? path.join(WS, dir, "node_modules/vitest/vitest.mjs") : undefined),
    run: (s) => {
      runs.push(s);
      return 0;
    },
    capture: (s) => {
      captures.push(s);
      return { status: 0, stdout: "" };
    },
    runs,
    captures,
    ...overrides,
  };
}

const WORLD = {
  "packages/agent": { script: "bun test --preload ../../scripts/tsx-cache-off.mjs --timeout 300000 src/", files: ["src/a.test.ts", "src/b.test.ts"] },
  "packages/orchestrator": { script: 'node --import tsx --test "src/**/*.test.ts"', files: ["src/x.test.ts"] },
  "apps/studio": {
    script: "vitest run src/ server/",
    files: ["server/src/zz.test.ts", "src/zz.test.ts", "src/zz.test.tsx", "src/other.test.ts"],
    vitest: true,
  },
};

test("a bun package's named file runs under its own runner, flags kept, the file absolute", () => {
  const plan = planTestRun(["packages/agent/src/a.test.ts"], fakeIo(WORLD));
  assert.ok(plan.ok);
  assert.deepEqual(plan.runs, [
    {
      packageDir: "packages/agent",
      mode: "files",
      files: ["src/a.test.ts"],
      command: {
        file: "bun",
        args: ["test", "--preload", "../../scripts/tsx-cache-off.mjs", "--timeout", "300000", path.join(WS, "packages/agent/src/a.test.ts")],
        cwd: path.join(WS, "packages/agent"),
      },
    },
  ]);
});

test("the node --test package runs through node with the script's flags and no suite glob", () => {
  const plan = planTestRun(["packages/orchestrator/src/x.test.ts"], fakeIo(WORLD));
  assert.ok(plan.ok);
  assert.deepEqual(plan.runs[0]?.command.args, ["--import", "tsx", "--test", path.join(WS, "packages/orchestrator/src/x.test.ts")]);
  assert.equal(plan.runs[0]?.command.file, "node");
});

test("a vitest file excludes every sibling its filter could reach, and is pre-flighted with the same arguments", () => {
  const plan = planTestRun(["apps/studio/src/zz.test.ts"], fakeIo(WORLD));
  assert.ok(plan.ok);
  const [r] = plan.runs;
  const entry = path.join(WS, "apps/studio/node_modules/vitest/vitest.mjs");
  const filter = [
    path.join(WS, "apps/studio/src/zz.test.ts"),
    "--exclude",
    "server/src/zz.test.ts",
    "--exclude",
    "src/zz.test.tsx",
  ];
  assert.deepEqual(r?.command, { file: "node", args: [entry, "run", ...filter], cwd: path.join(WS, "apps/studio") });
  assert.deepEqual(r?.preflight, { file: "node", args: [entry, "list", "--filesOnly", ...filter], cwd: path.join(WS, "apps/studio") });
});

test("a package directory runs its whole suite through pnpm run test, and absorbs a named file of its own", () => {
  const plan = planTestRun(["packages/agent", "packages/agent/src/a.test.ts"], fakeIo(WORLD));
  assert.ok(plan.ok);
  assert.deepEqual(plan.runs, [
    {
      packageDir: "packages/agent",
      mode: "suite",
      files: [],
      command: { file: "pnpm", args: ["run", "test"], cwd: path.join(WS, "packages/agent"), shell: true },
    },
  ]);
});

test("relative arguments resolve from the operator's cwd, not the workspace root", () => {
  const plan = planTestRun(["src/b.test.ts"], fakeIo(WORLD, { cwd: path.join(WS, "packages/agent") }));
  assert.ok(plan.ok);
  assert.deepEqual(plan.runs[0]?.files, ["src/b.test.ts"]);
});

test("anything it cannot make exact refuses the WHOLE invocation, naming each argument", () => {
  const io = fakeIo({
    ...WORLD,
    "packages/flagged": { script: "vitest run --config x.ts", files: ["src/f.test.ts"], vitest: true },
    "packages/novitest": { script: "vitest run", files: ["src/n.test.ts"] },
  });
  const plan = planTestRun(
    [
      "packages/agent/src/a.test.ts",
      "../outside.test.ts",
      "docs/x.test.ts",
      "packages/agent/src/helper.ts",
      "packages/agent/src",
      "packages/agent/src/missing.test.ts",
      "packages/flagged/src/f.test.ts",
      "packages/novitest/src/n.test.ts",
    ],
    io,
  );
  assert.equal(plan.ok, false);
  assert.ok(!plan.ok);
  const lines = plan.refusal.split("\n");
  assert.match(lines[0] ?? "", /REFUSED — nothing was run/);
  for (const [arg, why] of [
    ["../outside.test.ts", /outside the workspace/],
    ["docs/x.test.ts", /not inside a workspace package/],
    ["packages/agent/src/helper.ts", /not a test file of packages\/agent/],
    ["packages/agent/src", /a directory inside a package/],
    ["packages/agent/src/missing.test.ts", /no such file/],
    ["packages/flagged", /names no runner this verb can drive exactly/],
    ["packages/novitest", /vitest is not installed/],
  ] as const) {
    assert.ok(lines.some((l) => l.includes(arg) && why.test(l)), `expected a refusal line for ${arg}`);
  }
  assert.equal(testCommand(["docs/x.test.ts"], io).ok, false);
  assert.deepEqual(io.runs, [], "a refusal runs nothing");
});

test("no arguments refuses rather than running every suite", () => {
  const io = fakeIo(WORLD);
  const env = testCommand([], io);
  assert.equal(env.ok, false);
  assert.match(env.body, /name at least one test file/);
  assert.deepEqual(io.runs, []);
});

test("a vitest pre-flight that lists MORE than was named refuses before anything runs", () => {
  const io = fakeIo(WORLD, {
    capture: () => ({ status: 0, stdout: "src/zz.test.ts\nsrc/zz.test.tsx\n" }),
  });
  const env = testCommand(["packages/agent/src/a.test.ts", "apps/studio/src/zz.test.ts"], io);
  assert.equal(env.ok, false);
  assert.match(env.body, /would not run exactly the named files in apps\/studio/);
  assert.match(env.body, /would ALSO run: src\/zz\.test\.tsx/);
  assert.deepEqual(io.runs, [], "the bun package did not run either — pre-flights come first");
});

test("an exact pre-flight lets every run go, and the report names each package's exit", () => {
  let n = 0;
  const io = fakeIo(WORLD, {
    capture: () => ({ status: 0, stdout: `${path.join(WS, "apps/studio")}/src/zz.test.ts\n` }),
  });
  const counted = { ...io, run: (s: TestSpawn) => (io.runs.push(s), n++ === 0 ? 0 : 1) };
  const env = testCommand(["packages/agent/src/a.test.ts", "apps/studio/src/zz.test.ts"], counted);
  assert.equal(env.ok, false);
  assert.equal(io.runs.length, 2);
  assert.match(env.body, /PASS {2}apps\/studio \(1 file\(s\)\) — exit 0/);
  assert.match(env.body, /FAIL {2}packages\/agent \(1 file\(s\)\) — exit 1/);
});

test("the pure helpers: vitest script reading, exclude reach, list parsing", () => {
  assert.deepEqual(vitestRunArgs("vitest run src/ server/"), ["run"]);
  assert.equal(vitestRunArgs("vitest"), undefined, "watch mode is not a run");
  assert.equal(vitestRunArgs("vitest run --project a"), undefined);
  assert.equal(vitestRunArgs("bun test src/"), undefined);
  assert.deepEqual(vitestExcludes(["src/A.test.ts"], ["src/a.test.ts", "src/a.test.tsx", "x/src/a.test.ts", "src/b.test.ts"]), [
    "src/a.test.ts",
    "src/a.test.tsx",
    "x/src/a.test.ts",
  ]);
  assert.deepEqual(parseVitestList("noise\n src\\a.test.ts \r\nC:/p/pkg/b.spec.tsx\n", "C:/p/pkg"), ["b.spec.tsx", "src/a.test.ts"]);
});

test("the verb is dispatched: `storytree test` reaches the planner, and --help renders", async () => {
  const io = fakeIo(WORLD);
  const refused = await run(["test", "docs/nope.test.ts"], { store: new InMemoryStore(), testVerb: io });
  assert.equal(refused.ok, false);
  assert.match(refused.body, /docs\/nope\.test\.ts: not inside a workspace package/);
  const help = await run(["test", "--help"], { store: new InMemoryStore(), testVerb: io });
  assert.equal(help.ok, true);
  assert.match(help.body, /^storytree test <file\|package-dir>/);
});

// ── Against the REAL runners ────────────────────────────────────────────────────────────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function scratchWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "storytree-test-verb-"));
}

function put(root: string, rel: string, body: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), body);
}

test("vitest-named-prefix-file-does-not-pull-in-its-longer-sibling: real vitest lists exactly the named file", () => {
  const ws = scratchWorkspace();
  try {
    put(ws, "apps/probe/package.json", JSON.stringify({ name: "probe", scripts: { test: "vitest run src/ server/" } }));
    // The named file is a PREFIX of `zz.test.tsx` and a SUBSTRING of `server/src/zz.test.ts` —
    // both of which a bare vitest filter pulls in.
    for (const f of ["src/zz.test.ts", "src/zz.test.tsx", "server/src/zz.test.ts"]) put(ws, `apps/probe/${f}`, "");
    const realEntry = defaultTestVerbIo(REPO, REPO).vitestEntry("apps/studio");
    assert.ok(realEntry !== undefined, "apps/studio's vitest must be installed for this proof (pnpm install)");
    const io = { ...defaultTestVerbIo(ws, ws), vitestEntry: () => realEntry };
    const plan = planTestRun(["apps/probe/src/zz.test.ts"], io);
    assert.ok(plan.ok);
    const preflight = plan.runs[0]?.preflight;
    assert.ok(preflight !== undefined);
    const exact = io.capture(preflight);
    assert.equal(exact.status, 0);
    assert.deepEqual(parseVitestList(exact.stdout, path.join(ws, "apps/probe")), ["src/zz.test.ts"]);

    // CONTROL: the same filter without the excludes — the over-match is real, so the excludes above
    // are what made the listing exact (not an accident of the scratch layout).
    const bare = io.capture({ ...preflight, args: preflight.args.filter((a, i, all) => a !== "--exclude" && all[i - 1] !== "--exclude") });
    assert.deepEqual(parseVitestList(bare.stdout, path.join(ws, "apps/probe")), [
      "server/src/zz.test.ts",
      "src/zz.test.ts",
      "src/zz.test.tsx",
    ]);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});

test("bun-named-prefix-file-does-not-pull-in-its-longer-sibling: real bun test runs exactly one file", () => {
  const ws = scratchWorkspace();
  try {
    put(ws, "packages/probe/package.json", JSON.stringify({ name: "probe", scripts: { test: "bun test --timeout 300000 src/" } }));
    put(ws, "packages/probe/src/zz.test.ts", 'import { test } from "bun:test";\ntest("named-one", () => {});\n');
    put(ws, "packages/probe/src/zz.test.tsx", 'import { test } from "bun:test";\ntest("sibling-one", () => {});\n');
    const plan = planTestRun(["packages/probe/src/zz.test.ts"], defaultTestVerbIo(ws, ws));
    assert.ok(plan.ok);
    const cmd = plan.runs[0]?.command;
    assert.ok(cmd !== undefined);
    const r = spawnSync(cmd.file, [...cmd.args], { cwd: cmd.cwd, encoding: "utf8" });
    const out = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, out);
    assert.match(out, /Ran 1 test across 1 file/);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
});
