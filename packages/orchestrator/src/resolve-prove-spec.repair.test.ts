import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { FileToolExecutor, FILE_WRITE_TOOLS } from "@storytree/agent";
import type { AuthorResult, AuthoringPhase, PhaseAuthor } from "@storytree/agent";
import { InMemoryStore } from "@storytree/storage-protocol";

import { createBuildWorktree } from "./build-worktree.js";
import type { BuildWorktree } from "./build-worktree.js";
import { loadNodeSpec } from "./node-spec.js";
import { OwnedLoopAuthor } from "./owned-loop-author.js";
import { PathWriteScope } from "./phase-machine.js";
import { proveUnit } from "./prove-it-gate.js";
import type { ProveSpec } from "./prove-it-gate.js";
import { resolveProveSpec, scriptedWriterModel } from "./resolve-prove-spec.js";
import { lookupNodeBuildConfig } from "./test-command-registry.js";
import type { RealProofConfig } from "./proof-config.js";

/**
 * `real-build-arms-the-repair-loop` (ADR-0582 D1/D4/D9): a REAL build resolves with the in-build repair
 * loop armed — its budget, the set-aside against the walk's base, and the typecheck router over the
 * unit's own write scope — and walks it end to end over a fresh worktree: the real proof command, the
 * real git set-aside, the spine's real scoped commit. And the proved-span binding survives the tree
 * seam being read more than once, which both a second GATE visit and the drive's backstop do.
 */

const run = promisify(execFile);
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const STORIES_DIR = path.join(REPO_ROOT, "stories");
const SIGNER = { flag: "tester@example.com" };

const testSource = (expected: string): string => `import test from "node:test";
import assert from "node:assert/strict";
import { verdictLine } from "./verdict-line.js";

test("verdictLine renders the single specified line", () => {
  const line = verdictLine({
    unitId: "verdict-line",
    proofMode: "contract",
    outcome: "pass",
    commitSha: "abc1234def5678",
    signer: "tester@example.com",
    runId: "r1",
    evidence: [],
    at: "2026-06-10T00:00:00.000Z",
  });
  assert.equal(line, ${JSON.stringify(expected)});
});
`;

const RIGHT_LINE = "PASS verdict-line (contract) — signed by tester@example.com @ abc1234, 2026-06-10T00:00:00.000Z";
const WRONG_LINE = "FAIL verdict-line (contract)";

const implSource = (op: "toUpperCase" | "toLowerCase"): string => `export interface VerdictLike {
  unitId: string;
  proofMode: string;
  outcome: string;
  commitSha: string;
  signer: string;
  at: string;
}

export function verdictLine(v: VerdictLike): string {
  return \`\${v.outcome.${op}()} \${v.unitId} (\${v.proofMode}) — signed by \${v.signer} @ \${v.commitSha.slice(0, 7)}, \${v.at}\`;
}
`;

/**
 * A fresh worktree whose BASE lacks the unit's files: verdict-line has been promoted into HEAD, so the
 * net-new precondition is recreated by COMMITTING their removal — the walk's base must lack them, or the
 * set-aside would put the promoted implementation back for the red.
 */
async function netNewWorktree(real: RealProofConfig): Promise<BuildWorktree> {
  const worktree = await createBuildWorktree(REPO_ROOT);
  await fs.rm(path.join(worktree.root, real.testFile));
  await fs.rm(path.join(worktree.root, real.sourceFile));
  await run("git", ["add", "-A", "--", real.testFile, real.sourceFile], { cwd: worktree.root });
  await run(
    "git",
    ["-c", "user.name=t", "-c", "user.email=t@example.com", "commit", "-q", "-m", "the walk's net-new base"],
    { cwd: worktree.root },
  );
  return worktree;
}

function verdictLineFixture() {
  const spec = loadNodeSpec(path.join(STORIES_DIR, "drive-machinery", "verdict-line.md"));
  const real = lookupNodeBuildConfig("verdict-line")?.real;
  assert.ok(real !== undefined);
  return { spec, real };
}

/** A leaf that writes the scripted files for each slice straight into the worktree, and returns a scripted result. */
class FileWritingAuthor implements PhaseAuthor {
  readonly calls: { phase: AuthoringPhase; prompt: string }[] = [];
  constructor(
    private readonly root: string,
    private readonly slices: { writes: Record<string, string>; result?: AuthorResult }[],
  ) {}
  async author(phase: AuthoringPhase, prompt: string): Promise<AuthorResult> {
    const slice = this.slices[this.calls.length];
    this.calls.push({ phase, prompt });
    if (slice === undefined) return { ok: false, error: "no scripted slice left" };
    for (const [rel, content] of Object.entries(slice.writes)) {
      await fs.writeFile(path.join(this.root, rel), content);
    }
    return slice.result ?? { ok: true };
  }
}

function resolveReal(worktree: BuildWorktree, author: PhaseAuthor, runId: string): ProveSpec {
  const { spec } = verdictLineFixture();
  const resolved = resolveProveSpec(spec, {
    mode: "real",
    workspace: worktree.root,
    store: new InMemoryStore(),
    runId,
    signerInputs: SIGNER,
    authorOverride: author,
  });
  if (!resolved.ok) throw new Error(`the fixture must resolve in REAL mode: ${resolved.reason}`);
  return resolved.spec;
}

describe("real-build-arms-the-repair-loop: a real build repairs a failed check inside the build", () => {
  test("a real build resolves with the repair policy armed; a dry run carries none", () => {
    const { spec, real } = verdictLineFixture();
    const realSpec = resolveProveSpec(spec, {
      mode: "real",
      workspace: REPO_ROOT,
      store: new InMemoryStore(),
      runId: "arm-1",
      signerInputs: SIGNER,
      authorOverride: new FileWritingAuthor(REPO_ROOT, []),
      treeState: async () => ({ commitSha: "x", clean: true }),
    });
    assert.equal(realSpec.ok, true);
    if (!realSpec.ok) return;
    assert.ok(realSpec.spec.repair !== undefined, "every real build repairs in-build");
    // The router reads the unit's OWN write scope: its test file is the test-writer's, its source the code's.
    const tsc = (file: string) => ({ stdout: `${file}(1,1): error TS2322: bad`, stderr: "", exitCode: 2 });
    assert.equal(realSpec.spec.repair.routeTypecheck(tsc(real.testFile)), "test");
    assert.equal(realSpec.spec.repair.routeTypecheck(tsc(real.sourceFile)), "code");

    const dry = resolveProveSpec(spec, {
      mode: "dry-run",
      workspace: REPO_ROOT,
      store: new InMemoryStore(),
      runId: "dry-1",
      signerInputs: SIGNER,
    });
    assert.equal(dry.ok, true);
    if (dry.ok) assert.equal(dry.spec.repair, undefined, "a dry run walks the straight ladder");
  });

  test("the IMPLEMENT briefs direct an objection to the escalate tool, never to prose", () => {
    const { spec } = verdictLineFixture();
    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace: REPO_ROOT,
      store: new InMemoryStore(),
      runId: "brief-1",
      signerInputs: SIGNER,
      authorOverride: new FileWritingAuthor(REPO_ROOT, []),
      treeState: async () => ({ commitSha: "x", clean: true }),
    });
    assert.equal(resolved.ok, true);
    if (!resolved.ok) return;
    assert.match(resolved.spec.prompts.implement, /raise it with the `escalate` tool, quoting the assertion/);
    assert.match(resolved.spec.prompts.implement, /needs an EXISTING test updated/);
    assert.doesNotMatch(resolved.spec.prompts.implement, /say so plainly/);
  });

  test("a failed green goes back to the code-writer over a real worktree, and the verdict binds the whole build", async () => {
    const { real } = verdictLineFixture();
    const worktree = await netNewWorktree(real);
    try {
      const author = new OwnedLoopAuthor({
        model: scriptedWriterModel([
          { path: real.testFile, content: testSource(RIGHT_LINE) },
          { path: real.sourceFile, content: implSource("toLowerCase") },
          { path: real.sourceFile, content: implSource("toUpperCase") },
        ]),
        tools: new FileToolExecutor({ rootDir: worktree.root }),
        scope: new PathWriteScope(real.scope),
        writeTools: FILE_WRITE_TOOLS,
      });
      const briefs: string[] = [];
      const s = resolveReal(
        worktree,
        {
          author: (phase, prompt) => {
            briefs.push(prompt);
            return author.author(phase, prompt);
          },
        },
        "real-repair-green",
      );
      // The drive's backstop reads the tree seam a SECOND time (to capture the authored HEAD). That read
      // commits nothing, and it must not narrow the binding to an empty range.
      let secondReads = 0;
      s.backstop = async () => {
        await s.treeState();
        secondReads += 1;
        return { ok: true };
      };

      const result = await proveUnit(s);

      assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.reason}`);
      if (!result.ok) return;
      assert.equal(secondReads, 1);
      assert.deepEqual(result.repairs?.map((r) => [r.failedAt, r.check, r.to]), [["CONFIRM_GREEN", "no-green", "IMPLEMENT"]]);
      // Both code-writer briefs carry the REAL red observation: the missing module the test imports.
      assert.equal(briefs.length, 3);
      for (const brief of briefs.slice(1)) assert.match(brief, /CONFIRM_RED observation[\s\S]*verdict-line/);
      assert.match(briefs[2] ?? "", /IN-BUILD REPAIR 1[\s\S]*expected[\s\S]*pass verdict-line/i);
      assert.ok(result.verdict.anchors !== undefined, "the binding survived the backstop's second read");
      assert.deepEqual(
        result.verdict.anchors.map((a) => [a.file, a.symbol]),
        [
          [real.sourceFile, "VerdictLike"],
          [real.sourceFile, "verdictLine"],
        ],
      );
    } finally {
      await worktree.remove();
    }
  });

  test("an escalation goes to a test revision re-observed red against the real base, then green against the restored implementation", async () => {
    const { real } = verdictLineFixture();
    const worktree = await netNewWorktree(real);
    try {
      const author = new FileWritingAuthor(worktree.root, [
        { writes: { [real.testFile]: testSource(WRONG_LINE) } },
        {
          writes: { [real.sourceFile]: implSource("toUpperCase") },
          result: {
            ok: false,
            error: "IMPLEMENT escalated",
            escalation: {
              phase: "IMPLEMENT",
              kind: "unsatisfiable-test",
              statement: "the test expects a line no verdict renders",
              assertion: `assert.equal(line, ${JSON.stringify(WRONG_LINE)})`,
            },
          },
        },
        { writes: { [real.testFile]: testSource(RIGHT_LINE) } },
      ]);
      const s = resolveReal(worktree, author, "real-repair-revision");

      const result = await proveUnit(s);

      assert.equal(result.ok, true, result.ok ? "" : `${result.failedAt}: ${result.reason}`);
      if (!result.ok) return;
      assert.deepEqual(author.calls.map((c) => c.phase), ["AUTHOR_TEST", "IMPLEMENT", "AUTHOR_TEST"]);
      assert.deepEqual(result.phasesVisited, [
        "AUTHOR_TEST",
        "CONFIRM_RED",
        "IMPLEMENT",
        "CONFIRM_GREEN",
        "AUTHOR_TEST",
        "CONFIRM_RED",
        "CONFIRM_GREEN",
        "GATE",
      ]);
      assert.deepEqual(result.repairs?.map((r) => [r.check, r.to]), [["escalation", "AUTHOR_TEST"]]);
      assert.match(author.calls[2]?.prompt ?? "", /Statement, verbatim:\nthe test expects a line no verdict renders/);
      // The red that advanced was observed with the implementation SET ASIDE — a missing-module red —
      // and the implementation was restored for the green: the signed commit carries both files.
      assert.match(result.verdict.evidence[0]?.note ?? "", /observed red/);
      const { stdout: committed } = await run("git", ["show", "--name-only", "--format=", result.verdict.commitSha], {
        cwd: worktree.root,
      });
      assert.deepEqual(committed.trim().split("\n").sort(), [real.sourceFile, real.testFile].sort());
      assert.equal(await fs.readFile(path.join(worktree.root, real.sourceFile), "utf8"), implSource("toUpperCase"));
    } finally {
      await worktree.remove();
    }
  });
});
