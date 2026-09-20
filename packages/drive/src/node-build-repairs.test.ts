import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { FileToolExecutor, FILE_WRITE_TOOLS } from "@storytree/agent";
import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import {
  OwnedLoopAuthor,
  PathWriteScope,
  createBuildWorktree,
  findNodeSpecFile,
  loadNodeSpec,
  resolveBuildConfig,
  scriptedWriterModel,
} from "@storytree/orchestrator";
import type { NodeSpec, ProveResult, RealProofConfig, ShellCommand } from "@storytree/orchestrator";

import { buildNodeReal, renderLeafPhasePrompts, renderRepairs } from "./node-build.js";
import type { RealBuildResult } from "./node-build.js";
import { FIXTURE_DIR, fixtureRepo, fixtureStories, scopeFor } from "./real-chain-fixture.js";

/**
 * `node-build-envelope-lists-every-repair` (ADR-0582 D3/D5/D8), through `buildNodeReal` over a real
 * fixture worktree: the package typecheck's raw output reaches the gate, so a red it names in a source
 * file goes back to the code-writer inside the same build; the build reports the typecheck and keeps a
 * refused commit only when the walk ENDED on it; and the envelope lists every repair the walk made.
 */

const TEST_FILE = `${FIXTURE_DIR}/cap-a.test.ts`;
const SOURCE_FILE = `${FIXTURE_DIR}/cap-a.ts`;
const CAP_A_TEST =
  'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
  'import { a } from "./cap-a.js";\ntest("a", () => assert.equal(a(), 1));\n';
const impl = (body: string): string => `export function a(): number {\n  ${body}\n}\n`;

/** A tsc-shaped diagnostic naming the source file, printed whenever it carries the marker (or always). */
function typecheckCommand(opts: { always: boolean }): ShellCommand {
  const script =
    `const s = require("fs").readFileSync(${JSON.stringify(SOURCE_FILE)}, "utf8");` +
    `if (${opts.always ? "true" : 's.includes("TYPE_ERROR")'}) {` +
    `console.log(${JSON.stringify(`${SOURCE_FILE}(2,3): error TS2322: Type 'string' is not assignable to type 'number'.`)});` +
    "process.exit(2); }";
  return { file: "node", args: ["-e", script] };
}

interface Drive {
  built: RealBuildResult;
  phases: string[];
  signingRows: number;
}

/** Drive the fixture `cap-a` through `buildNodeReal` with the given IMPLEMENT slices and typecheck. */
async function drive(args: { implSlices: string[]; typecheck: ShellCommand }): Promise<Drive> {
  const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  const repo = await fixtureRepo(false);
  const store = new InMemoryStore();
  const worktree = await createBuildWorktree(repo.root, {});
  try {
    const specFile = findNodeSpecFile(stories, "cap-a");
    assert.ok(specFile !== null);
    const spec: NodeSpec = loadNodeSpec(specFile as string);
    const resolved = resolveBuildConfig(spec);
    assert.ok(resolved !== null && resolved.config.real !== undefined);
    const realConfig: RealProofConfig = {
      ...(resolved!.config.real as RealProofConfig),
      install: true,
      typecheck: args.typecheck,
    };
    const corpus = new InMemoryStore();
    await loadFixtureCorpus(corpus);
    const prompts = await renderLeafPhasePrompts(corpus);
    assert.equal(prompts.ok, true);
    const author = new OwnedLoopAuthor({
      model: scriptedWriterModel([
        { path: TEST_FILE, content: CAP_A_TEST },
        ...args.implSlices.map((content) => ({ path: SOURCE_FILE, content })),
      ]),
      tools: new FileToolExecutor({ rootDir: worktree.root }),
      scope: new PathWriteScope(scopeFor("cap-a")),
      writeTools: FILE_WRITE_TOOLS,
    });
    const phases: string[] = [];
    const built = await buildNodeReal({
      spec,
      worktree,
      baseSha: worktree.headSha,
      realConfig,
      store,
      runId: "repair-envelope-test",
      signer: "tester@example.com",
      phasePrompts: (prompts as { ok: true; prompts: never }).prompts,
      repoRoot: repo.root,
      promote: false,
      authorOverride: author,
      onPhase: (phase) => phases.push(phase),
    });
    const signingRows = (await store.readEvents()).filter((e) => e.kind === "signing").length;
    return { built, phases, signingRows };
  } finally {
    await worktree.remove();
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
}

describe("node-build-envelope-lists-every-repair: a real build repairs a red typecheck, reports honestly, and lists every repair", () => {
  test("a red typecheck naming a source file goes back to the code-writer, and the repaired build signs", async () => {
    const { built, phases, signingRows } = await drive({
      implSlices: [impl("return 1; // TYPE_ERROR"), impl("return 1;")],
      typecheck: typecheckCommand({ always: false }),
    });

    assert.equal(built.result.ok, true, built.result.ok ? "" : `${built.result.failedAt}: ${built.result.reason}`);
    assert.deepEqual(
      built.result.repairs?.map((r) => [r.failedAt, r.check, r.to]),
      [["GATE", "typecheck", "IMPLEMENT"]],
    );
    assert.deepEqual(phases, [
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "IMPLEMENT",
      "CONFIRM_GREEN",
      "GATE",
      "IMPLEMENT",
      "CONFIRM_GREEN",
      "GATE",
    ]);
    assert.equal(built.typecheck, "green", "the typecheck reported is the last GATE's");
    assert.equal(built.forensicPreservation, undefined, "a red the build repaired past keeps no refused commit");
    assert.equal(built.backstopObservation, undefined);
    assert.equal(signingRows, 1);
  });

  test("a red typecheck whose repair is refused ends the walk on it: reported red, and the refused commit is kept", async () => {
    // One IMPLEMENT slice only: the code-writer's repair slice finds its script spent and fails to author.
    const { built, signingRows } = await drive({
      implSlices: [impl("return 1;")],
      typecheck: typecheckCommand({ always: true }),
    });

    assert.equal(built.result.ok, false);
    if (built.result.ok) return;
    assert.equal(built.result.failedAt, "GATE", "the walk ends on the check the repair was answering");
    assert.match(built.result.reason, /^backstop RED: /);
    assert.match(built.result.reason, / — in-build repair refused: the code-writer's repair slice failed/);
    assert.equal(built.typecheck, "red");
    assert.equal(built.backstopObservation?.originalProcessResult.exitCode, 2);
    assert.ok(built.forensicPreservation !== undefined, "the commit the typecheck refused is kept for diagnosis");
    assert.equal(signingRows, 0);
  });

  test("a walk repaired past a red typecheck that then ends elsewhere reports no typecheck and keeps no commit", async () => {
    // The repair clears the type error but breaks the test; the second repair finds the script spent.
    const { built } = await drive({
      implSlices: [impl("return 1; // TYPE_ERROR"), impl("return 2;")],
      typecheck: typecheckCommand({ always: false }),
    });

    assert.equal(built.result.ok, false);
    if (built.result.ok) return;
    assert.equal(built.result.failedAt, "CONFIRM_GREEN");
    assert.deepEqual(
      built.result.repairs?.map((r) => [r.failedAt, r.check]),
      [
        ["GATE", "typecheck"],
        ["CONFIRM_GREEN", "no-green"],
      ],
    );
    assert.equal(built.typecheck, undefined, "the earlier red is not why this walk ended");
    assert.equal(built.forensicPreservation, undefined);
    assert.equal(built.backstopObservation, undefined);
  });

  test("the envelope lists every repair, naming the worker each went back to, and nothing when there was none", () => {
    assert.deepEqual(renderRepairs({}), []);
    assert.deepEqual(renderRepairs({ repairs: [] }), []);
    const result: Pick<ProveResult, "repairs"> = {
      repairs: [
        { failedAt: "CONFIRM_RED", check: "red-per-test", to: "AUTHOR_TEST", detail: "1 per-test finding(s): C4" },
        { failedAt: "GATE", check: "typecheck", to: "IMPLEMENT", detail: "the package typecheck is red" },
      ],
    };
    assert.deepEqual(renderRepairs(result), [
      "repairs:     2 in-build repair(s) — each failed check went back to the worker who could fix it; a repair is not an attempt (ADR-0581 D4)",
      "  1. CONFIRM_RED red-per-test → test-writer: 1 per-test finding(s): C4",
      "  2. GATE typecheck → code-writer: the package typecheck is red",
    ]);
  });
});
