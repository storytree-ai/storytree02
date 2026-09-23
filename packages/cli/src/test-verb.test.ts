/**
 * `storytree test` (`storytree-test-verb-covers-every-package`) — exactly the named files, every
 * package CI runs, refusing loudly whatever it cannot make exact.
 *
 * Two layers. The PLAN is proved over a fake world (which runner, which arguments, which refusals),
 * pinned as whole values rather than probed with regexes. The load-bearing claim — a named file whose
 * path is a prefix or substring of another test file's does NOT pull that file in — is proved
 * against the REAL runners in a throwaway workspace: vitest's own `list --filesOnly` for the vitest
 * route, and a real `bun test` whose longer-named sibling FAILS if it is ever run.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { AREAS_WITHOUT_CORPUS_READS } from "@storytree/context-traversal-capture";
import { InMemoryStore } from "@storytree/storage-protocol";

import { run } from "./commands.js";
import {
  defaultTestVerbIo,
  isPlainVitestRun,
  operatorCwd,
  parseVitestList,
  planTestRun,
  testCommand,
  testHelp,
  vitestExcludes,
  type TestSpawn,
  type TestVerbIo,
} from "./test-verb.js";

const WS = path.resolve("/ws");
const at = (...p: string[]): string => path.join(WS, ...p);

type FakeIo = TestVerbIo & { readonly runs: TestSpawn[]; readonly captures: TestSpawn[] };

/** A fake workspace: package dir -> { script, files, vitest installed? }. */
function fakeIo(
  packages: Record<string, { script: string; files: string[]; vitest?: boolean }>,
  overrides: Partial<TestVerbIo> = {},
): FakeIo {
  const runs: TestSpawn[] = [];
  const captures: TestSpawn[] = [];
  return {
    workspace: WS,
    cwd: WS,
    readTestScript: (dir) => packages[dir]?.script,
    listTestFiles: (dir) => packages[dir]?.files ?? [],
    vitestEntry: (dir) => (packages[dir]?.vitest === true ? at(dir, "vitest.mjs") : undefined),
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
  "packages/agent": {
    script: "bun test --preload ../../scripts/tsx-cache-off.mjs --timeout 300000 src/",
    files: ["src/a.test.ts", "src/b.test.ts"],
  },
  "packages/orchestrator": { script: 'node --import tsx --test "src/**/*.test.ts"', files: ["src/x.test.ts"] },
  "apps/studio": {
    script: "vitest run src/ server/",
    files: ["server/src/zz.test.ts", "src/other.test.ts", "src/zz.test.ts", "src/zz.test.tsx"],
    vitest: true,
  },
};

const STUDIO_FILTER = [at("apps/studio", "src/zz.test.ts"), "--exclude", "server/src/zz.test.ts", "--exclude", "src/zz.test.tsx"];

test("the plan: each package under its own runner, files absolute, packages and files sorted, duplicates dropped", () => {
  const plan = planTestRun(
    [
      "packages/orchestrator/src/x.test.ts",
      "packages/agent/src/b.test.ts",
      "apps/studio/src/zz.test.ts",
      "packages/agent/src/a.test.ts",
      "packages/agent/src/b.test.ts",
    ],
    fakeIo(WORLD),
  );
  assert.deepEqual(plan, {
    ok: true,
    runs: [
      {
        packageDir: "apps/studio",
        files: ["src/zz.test.ts"],
        command: { file: "node", args: [at("apps/studio", "vitest.mjs"), "run", ...STUDIO_FILTER], cwd: at("apps/studio"), shell: false },
        preflight: {
          file: "node",
          args: [at("apps/studio", "vitest.mjs"), "list", "--filesOnly", ...STUDIO_FILTER],
          cwd: at("apps/studio"),
          shell: false,
        },
      },
      {
        packageDir: "packages/agent",
        files: ["src/a.test.ts", "src/b.test.ts"],
        command: {
          file: "bun",
          args: [
            "test",
            "--preload",
            "../../scripts/tsx-cache-off.mjs",
            "--timeout",
            "300000",
            at("packages/agent", "src/a.test.ts"),
            at("packages/agent", "src/b.test.ts"),
          ],
          cwd: at("packages/agent"),
          shell: false,
        },
      },
      {
        packageDir: "packages/orchestrator",
        files: ["src/x.test.ts"],
        command: {
          file: "node",
          args: ["--import", "tsx", "--test", at("packages/orchestrator", "src/x.test.ts")],
          cwd: at("packages/orchestrator"),
          shell: false,
        },
      },
    ],
  });
});

test("a package directory runs its whole suite through pnpm, sorted, absorbing a named file of its own", () => {
  const plan = planTestRun(["packages/orchestrator", "packages/agent/src/a.test.ts", "packages/agent"], fakeIo(WORLD));
  assert.deepEqual(plan, {
    ok: true,
    runs: [
      { packageDir: "packages/agent", files: [], command: { file: "pnpm", args: ["run", "test"], cwd: at("packages/agent"), shell: true } },
      {
        packageDir: "packages/orchestrator",
        files: [],
        command: { file: "pnpm", args: ["run", "test"], cwd: at("packages/orchestrator"), shell: true },
      },
    ],
  });
});

test("relative arguments resolve from the operator's cwd, which is pnpm's INIT_CWD when set", () => {
  const plan = planTestRun(["src/b.test.ts"], fakeIo(WORLD, { cwd: at("packages/agent") }));
  assert.equal(plan.ok && plan.runs[0]?.files.join(), "src/b.test.ts");
  assert.equal(operatorCwd({ INIT_CWD: "/typed/here" }, "/proc"), "/typed/here");
  assert.equal(operatorCwd({}, "/proc"), "/proc");
});

test("anything it cannot make exact refuses the WHOLE invocation, one line per argument, and runs nothing", () => {
  const io = fakeIo({
    ...WORLD,
    "packages/flagged": { script: "vitest run --config x.ts", files: ["src/f.test.ts"], vitest: true },
    "packages/novitest": { script: "vitest run", files: ["src/n.test.ts"] },
    "packages/globby": { script: "vitest run", files: ["src/a(1).test.ts", "src/b.test.ts"], vitest: true },
  });
  const env = testCommand(
    [
      "packages/agent/src/a.test.ts",
      "../outside.test.ts",
      "docs/x.test.ts",
      "packages",
      "packages/nopkg/src/x.test.ts",
      "packages/agent/src/helper.ts",
      "packages/flagged/src/f.test.ts",
      "packages/novitest/src/n.test.ts",
      "packages/globby/src/a(1).test.ts",
    ],
    io,
  );
  assert.deepEqual(env, {
    ok: false,
    body: [
      "storytree test REFUSED — nothing was run, because running part of what you asked would read as all of it:",
      "  ../outside.test.ts: not inside a workspace package that declares a `test` script",
      "  docs/x.test.ts: not inside a workspace package that declares a `test` script",
      "  packages: not inside a workspace package that declares a `test` script",
      "  packages/nopkg/src/x.test.ts: not inside a workspace package that declares a `test` script",
      "  packages/agent/src/helper.ts: not a test file of packages/agent — name test files, or the package directory for its whole suite",
      '  packages/flagged: its test script "vitest run --config x.ts" names no runner this verb can drive exactly — run the package directory for its whole suite',
      "  packages/globby: cannot write an exact vitest filter for src/a(1).test.ts (glob characters in the path)",
      "  packages/novitest: vitest is not installed for this package (run `pnpm install`)",
    ].join("\n"),
    next: ["storytree test --help"],
  });
  assert.deepEqual([io.runs, io.captures], [[], []]);
});

test("no arguments refuses rather than running every suite", () => {
  const io = fakeIo(WORLD);
  assert.deepEqual(testCommand([], io), {
    ok: false,
    body: "storytree test: name at least one test file or package directory.",
    next: ["storytree test --help"],
  });
  assert.deepEqual(io.runs, []);
});

function preflightRefusal(stdout: string, status: number) {
  const io = fakeIo(WORLD, { capture: () => ({ status, stdout }) });
  const env = testCommand(["packages/agent/src/a.test.ts", "apps/studio/src/zz.test.ts"], io);
  assert.equal(env.ok, false);
  return { io, body: env.body };
}

const PREFLIGHT_HEAD = (status: number): string[] => [
  "storytree test REFUSED — vitest would not run exactly the named files in apps/studio, so nothing was run.",
  `  pre-flight: node ${[at("apps/studio", "vitest.mjs"), "list", "--filesOnly", ...STUDIO_FILTER].join(" ")} (exit ${status})`,
];

test("a vitest pre-flight listing MORE than was named refuses before ANY package runs", () => {
  const { io, body } = preflightRefusal("src/zz.test.ts\r\nsrc/zz.test.tsx\n", 0);
  assert.equal(body, [...PREFLIGHT_HEAD(0), "  would ALSO run: src/zz.test.tsx", "  would NOT run: -"].join("\n"));
  assert.deepEqual(io.runs, [], "the bun package did not run either — pre-flights come first");
});

test("a vitest pre-flight listing FEWER than named refuses, and so does a failed pre-flight", () => {
  assert.equal(preflightRefusal("\n", 0).body, [...PREFLIGHT_HEAD(0), "  would ALSO run: -", "  would NOT run: src/zz.test.ts"].join("\n"));
  assert.equal(preflightRefusal("src/zz.test.ts\n", 1).body, [...PREFLIGHT_HEAD(1), "  would ALSO run: -", "  would NOT run: -"].join("\n"));
});

test("an exact pre-flight lets every run go, and the report names each package's exit", () => {
  const statuses = [0, 1, 0];
  const io = fakeIo(WORLD, { capture: () => ({ status: 0, stdout: "src/zz.test.ts\n" }) });
  const counted = { ...io, run: (s: TestSpawn) => (io.runs.push(s), statuses[io.runs.length - 1] ?? null) };
  const env = testCommand(["apps/studio/src/zz.test.ts", "packages/agent/src/a.test.ts", "packages/orchestrator"], counted);
  assert.deepEqual(env, {
    ok: false,
    body: [
      "storytree test — a run FAILED:",
      "  PASS  packages/orchestrator (whole suite) — exit 0: pnpm run test",
      `  FAIL  apps/studio (src/zz.test.ts) — exit 1: node ${[at("apps/studio", "vitest.mjs"), "run", ...STUDIO_FILTER].join(" ")}`,
      `  PASS  packages/agent (src/a.test.ts) — exit 0: bun test --preload ../../scripts/tsx-cache-off.mjs --timeout 300000 ${at("packages/agent", "src/a.test.ts")}`,
    ].join("\n"),
    next: ["storytree test --help"],
  });
  const allPass = testCommand(["packages/orchestrator"], fakeIo(WORLD));
  assert.deepEqual(allPass.body, ["storytree test — every run passed:", "  PASS  packages/orchestrator (whole suite) — exit 0: pnpm run test"].join("\n"));
  assert.equal(allPass.ok, true);
});

test("the pure helpers: vitest script reading, exclude reach, list parsing", () => {
  assert.equal(isPlainVitestRun("vitest run src/ server/"), true);
  assert.equal(isPlainVitestRun("tsc -b && vitest run"), true, "the vitest segment is found past another");
  assert.equal(isPlainVitestRun("vitest"), false, "watch mode is not a run");
  assert.equal(isPlainVitestRun("vitest run --project a"), false);
  assert.equal(isPlainVitestRun("bun test src/"), false);
  // Named files never exclude each other, even when one is a prefix of the other; a sibling reached
  // by EITHER needle is excluded.
  assert.deepEqual(
    vitestExcludes(["src/A.test.ts", "src/b.test.ts"], ["src/a.test.ts", "src/A.test.ts", "src/a.test.tsx", "x/src/b.test.ts", "src/b.test.ts", "src/c.test.ts"]),
    ["src/a.test.ts", "src/a.test.tsx", "x/src/b.test.ts"],
  );
  assert.deepEqual(parseVitestList(" src\\b.test.ts \r\n\nsrc/a.test.ts\n"), ["src/a.test.ts", "src/b.test.ts"]);
});

test("the verb is dispatched through the injected world, and --help renders its page", async () => {
  const io = fakeIo(WORLD, { capture: () => ({ status: 0, stdout: "" }) });
  const refused = await run(["test", "apps/studio/src/zz.test.ts"], { store: new InMemoryStore(), testVerb: io });
  assert.equal(refused.body, [...PREFLIGHT_HEAD(0), "  would ALSO run: -", "  would NOT run: src/zz.test.ts"].join("\n"));
  const help = await run(["test", "--help"], { store: new InMemoryStore(), testVerb: io });
  assert.deepEqual(help, testHelp());
  assert.deepEqual(testHelp(), {
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
    next: ["storytree test packages/cli/src/test-verb.test.ts"],
  });
  // Another area's help is not this verb's — the dispatch arm is scoped to `test`.
  const other = await run(["dispatch", "--help"], { store: new InMemoryStore(), testVerb: io });
  assert.notEqual(other.body, help.body);
  // The traversal instrument classifies the area as reading no corpus, with its reason.
  assert.equal(AREAS_WITHOUT_CORPUS_READS.test, "runs named test files under their packages' own runners");
});

// ── Against the REAL runners ────────────────────────────────────────────────────────────────────

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function withScratch(body: (ws: string) => void): void {
  const ws = mkdtempSync(path.join(os.tmpdir(), "storytree-test-verb-"));
  try {
    body(ws);
  } finally {
    rmSync(ws, { recursive: true, force: true });
  }
}

function put(root: string, rel: string, content: string): void {
  mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  writeFileSync(path.join(root, rel), content);
}

test("vitest-named-prefix-file-does-not-pull-in-its-longer-sibling: real vitest lists exactly the named file", () => {
  withScratch((ws) => {
    put(ws, "apps/probe/package.json", JSON.stringify({ name: "probe", scripts: { test: "vitest run src/ server/" } }));
    // The named file is a PREFIX of `zz.test.tsx` and a SUBSTRING of `server/src/zz.test.ts` —
    // both of which a bare vitest filter pulls in.
    for (const f of ["src/zz.test.ts", "src/zz.test.tsx", "server/src/zz.test.ts"]) put(ws, `apps/probe/${f}`, "");
    const realEntry = defaultTestVerbIo(REPO, REPO).vitestEntry("apps/studio");
    assert.ok(realEntry !== undefined, "apps/studio's vitest must be installed for this proof (pnpm install)");
    const io = defaultTestVerbIo(ws, ws);
    assert.equal(io.vitestEntry("apps/probe"), undefined, "no vitest is installed in the scratch package");
    const plan = planTestRun(["apps/probe/src/zz.test.ts"], { ...io, vitestEntry: () => realEntry });
    assert.ok(plan.ok);
    const preflight = plan.runs[0]?.preflight;
    assert.ok(preflight !== undefined);
    const exact = io.capture(preflight);
    assert.deepEqual([exact.status, parseVitestList(exact.stdout)], [0, ["src/zz.test.ts"]]);

    // CONTROL: the same filter without the excludes — the over-match is real, so the excludes above
    // are what made the listing exact (not an accident of the scratch layout).
    const bare = io.capture({ ...preflight, args: preflight.args.filter((a, i, all) => a !== "--exclude" && all[i - 1] !== "--exclude") });
    assert.deepEqual(parseVitestList(bare.stdout), ["server/src/zz.test.ts", "src/zz.test.ts", "src/zz.test.tsx"]);
  });
});

test("bun-named-prefix-file-does-not-pull-in-its-longer-sibling: real bun runs the named file, and the package dir runs both", () => {
  withScratch((ws) => {
    put(ws, "packages/probe/package.json", JSON.stringify({ name: "probe", scripts: { test: "bun test --timeout 300000 src/" } }));
    put(ws, "packages/probe/src/zz.test.ts", 'import { test } from "bun:test";\ntest("named", () => {});\n');
    // The longer-named sibling FAILS, so the run's own exit code says whether it was pulled in.
    put(ws, "packages/probe/src/zz.test.tsx", 'import { test } from "bun:test";\ntest("sibling", () => { throw new Error("pulled in"); });\n');
    const io = defaultTestVerbIo(ws, ws);
    assert.equal(testCommand(["packages/probe/src/zz.test.ts"], io).ok, true, "only the named file ran");
    assert.equal(testCommand(["packages/probe/src/zz.test.tsx"], io).ok, false, "a failing named file fails the verb");
    assert.equal(testCommand(["packages/probe"], io).ok, false, "the whole suite (via pnpm) runs the sibling too");
  });
});
