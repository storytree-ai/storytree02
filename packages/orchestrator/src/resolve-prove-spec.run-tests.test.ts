/**
 * `worker-can-run-the-existing-tests`: `run_tests` as each runtime actually registers it.
 *
 * These drive REAL spawns against a real temporary workspace rather than an injected runner,
 * because the two things most worth proving are exactly the two a fake cannot see: that the command
 * the spine composes really runs the named file under the package's own runner, and that the Codex
 * registration reads the REPLICA rather than the worktree. The replica case is proved by making the
 * two copies of one file DISAGREE — the worktree's fails, the replica's passes — so a retargeting
 * that silently did nothing would return the worktree's red and fail this test.
 *
 * `node --test` over plain `.test.js` files is used for the fixture package on purpose: it needs no
 * loader, so the fixture depends on nothing that could make it flaky, and it exercises the node
 * branch of `namedSubsetRunner` end to end.
 *
 * `packages/orchestrator` is outside the mutation rung (ADR-0473), so nothing fault-seeds these
 * assertions; the gap is declared rather than self-audited (ADR-0563 / ADR-0447).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";

import { codexFeedbackCommandsFor, feedbackCommandsFor } from "./resolve-prove-spec.js";
import { resolveRunnableSuites, suiteResolutionIO } from "./proof/test-suite-runner.js";
import type { FeedbackTestSuites } from "./resolve-prove-spec.js";
import type { ShellCommand } from "./shell-test-executor.js";

const PROOF: ShellCommand = { file: "node", args: ["--version"] };

const PASSING = 'const { test } = require("node:test");\ntest("ok", () => {});\n';
const FAILING =
  'const { test } = require("node:test");\n' +
  'const assert = require("node:assert/strict");\n' +
  'test("broken", () => { assert.equal(1, 2); });\n';

const SCOPE = {
  testGlobs: ["packages/widget/src/widget.test.js"],
  sourceGlobs: ["packages/widget/src/widget.js"],
};

/** A workspace holding one `node --test` package with a passing and a failing test file. */
function withWorkspace(run: (root: string) => Promise<void> | void): Promise<void> | void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "run-tests-"));
  const src = path.join(root, "packages", "widget", "src");
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(root, "packages", "widget", "package.json"),
    JSON.stringify({ name: "widget", scripts: { test: "node --test src/" } }),
  );
  fs.writeFileSync(path.join(src, "widget.test.js"), PASSING);
  fs.writeFileSync(path.join(src, "neighbour.test.js"), FAILING);
  const done = (): void => fs.rmSync(root, { recursive: true, force: true });
  let result: Promise<void> | void;
  try {
    result = run(root);
  } catch (e) {
    done();
    throw e;
  }
  return result instanceof Promise ? result.finally(done) : done();
}

function suitesFor(root: string): FeedbackTestSuites {
  return {
    suites: resolveRunnableSuites(SCOPE, suiteResolutionIO(root)),
    workspace: root,
    timeoutMs: 120_000,
  };
}

test("run_tests is NOT registered when no tests wiring is supplied at all", () => {
  const commands = feedbackCommandsFor(PROOF, "node --version");
  assert.deepEqual(
    commands.map((c) => c.name),
    ["run_proof"],
  );
});

test("run_tests is NOT registered when the unit's scope reaches no drivable suite", () => {
  const commands = feedbackCommandsFor(PROOF, "node --version", undefined, {
    suites: [],
    workspace: "/nowhere",
    timeoutMs: 1,
  });
  assert.deepEqual(
    commands.map((c) => c.name),
    ["run_proof"],
  );
});

test("run_tests declares `files` over the scope's own test files, and the other two declare nothing", () => {
  withWorkspace((root) => {
    const commands = feedbackCommandsFor(PROOF, "node --version", PROOF, suitesFor(root));
    assert.deepEqual(
      commands.map((c) => c.name),
      ["run_proof", "run_typecheck", "run_tests"],
    );
    assert.equal(commands[0]?.parameter, undefined);
    assert.equal(commands[1]?.parameter, undefined);
    const parameter = commands[2]?.parameter;
    assert.equal(parameter?.name, "files");
    assert.deepEqual(parameter?.choices, [
      "packages/widget/src/neighbour.test.js",
      "packages/widget/src/widget.test.js",
    ]);
    assert.match(commands[2]?.description ?? "", /packages\/widget \(2 files\)/);
    assert.match(commands[2]?.description ?? "", /in the workspace/);
  });
});

test("run_tests runs exactly the NAMED file: the passing one is green, the neighbour is red", async () => {
  await withWorkspace(async (root) => {
    const runTests = feedbackCommandsFor(PROOF, "node --version", undefined, suitesFor(root))[1];
    assert.equal(runTests?.name, "run_tests");
    const green = await runTests?.run({ chosen: ["packages/widget/src/widget.test.js"] });
    assert.equal(green?.code, 0, `expected green, got ${green?.code}: ${green?.stderr}`);
    assert.doesNotMatch(`${green?.stdout}${green?.stderr}`, /broken/);

    const red = await runTests?.run({ chosen: ["packages/widget/src/neighbour.test.js"] });
    assert.notEqual(red?.code, 0, "a failing neighbour must come back red");
    assert.match(`${red?.stdout}${red?.stderr}`, /broken/);
  });
});

test("run_tests with NO chosen files runs the whole offered set, so a broken neighbour is seen", async () => {
  await withWorkspace(async (root) => {
    const runTests = feedbackCommandsFor(PROOF, "node --version", undefined, suitesFor(root))[1];
    const all = await runTests?.run();
    assert.notEqual(all?.code, 0);
    const output = `${all?.stdout}${all?.stderr}`;
    assert.match(output, /broken/);
    assert.match(output, /ok/);
  });
});

test("run_tests refuses an empty selection with a non-zero code rather than an empty success", async () => {
  await withWorkspace(async (root) => {
    const runTests = feedbackCommandsFor(PROOF, "node --version", undefined, suitesFor(root))[1];
    const none = await runTests?.run({ chosen: [] });
    assert.notEqual(none?.code, 0, "nothing ran, so this must not read as a pass");
    assert.match(none?.stderr ?? "", /no existing test files were selected/);
  });
});

test("codex run_tests reads the REPLICA, not the worktree: the same file disagrees across the two", async () => {
  await withWorkspace(async (root) => {
    // The replica is a copy in which the FAILING neighbour has been repaired — as a leaf that fixed
    // it in its own replica would leave it. A retarget that did nothing would run the worktree's
    // still-broken copy and come back red.
    const replica = fs.mkdtempSync(path.join(os.tmpdir(), "run-tests-replica-"));
    try {
      fs.cpSync(root, replica, { recursive: true });
      fs.writeFileSync(
        path.join(replica, "packages", "widget", "src", "neighbour.test.js"),
        PASSING,
      );
      const commands = codexFeedbackCommandsFor(
        PROOF,
        "node --version",
        root,
        undefined,
        suitesFor(root),
      );
      const runTests = commands[1];
      assert.equal(runTests?.name, "run_tests");
      // The wall-clock bound travels, because `CodexPhaseAuthor` sizes its MCP tool-call timeout
      // off it — a `run_tests` with none would be cut off at the shortest registered bound.
      assert.equal(runTests?.timeoutMs, 120_000);

      const fromReplica = await runTests?.run(replica, {
        chosen: ["packages/widget/src/neighbour.test.js"],
      });
      assert.equal(
        fromReplica?.code,
        0,
        `the replica's repaired copy must be green; got ${fromReplica?.code}: ${fromReplica?.stderr}`,
      );

      const fromWorktree = await feedbackCommandsFor(
        PROOF,
        "node --version",
        undefined,
        suitesFor(root),
      )[1]?.run({ chosen: ["packages/widget/src/neighbour.test.js"] });
      assert.notEqual(
        fromWorktree?.code,
        0,
        "the worktree's copy is still broken — otherwise the replica assertion proves nothing",
      );
    } finally {
      fs.rmSync(replica, { recursive: true, force: true });
    }
  });
});

test("codex run_tests is omitted alongside the others when nothing drivable is in scope", () => {
  const commands = codexFeedbackCommandsFor(PROOF, "node --version", "/ws", undefined, {
    suites: [],
    workspace: "/ws",
    timeoutMs: 1,
  });
  assert.deepEqual(
    commands.map((c) => c.name),
    ["run_proof"],
  );
});
