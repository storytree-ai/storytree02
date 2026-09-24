import { offlineBuildGuardFactory } from "./real-chain-fixture.js";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";
import { promisify } from "node:util";

import { loadFixtureCorpus } from "@storytree/library/fixture";
import { promoteRealPass } from "@storytree/orchestrator";
import type { PromotionResult } from "@storytree/orchestrator";
import { InMemoryStore } from "@storytree/storage-protocol";

import { makeBackstopRefusal } from "./backstop-report.js";
import { silentBuildProgress } from "./build-progress.js";
import { buildNodeReal } from "./node-build.js";
import type { RealBuildArgs, RealBuildResult } from "./node-build.js";
import { FIXTURE_DIR, fixtureRepo, fixtureStories } from "./real-chain-fixture.js";
import {
  retainStoryForensicPreservation,
  resolveStoryRealNodeBuilder,
  storyBuild,
  storyNoCommitPromotionReason,
} from "./story-build.js";
import type { StoryRealNodeBuilder } from "./story-build.js";
// A green chain's DEFAULT is the live SDK curator on the live store, refused in a test process.
import { ScriptedCuratorRunner } from "./curate.js";

/**
 * The refusal-recovery contract at the actual `storyBuild` caller.
 *
 * A direct `buildNodeReal({ promote:false })` test cannot see the chain-end ceremony. These cases
 * deliberately reach that ceremony so the failed story node and the proven prefix cannot contend
 * for one ref, and so a first-node failure cannot preserve evidence while telling the operator
 * there was "nothing to park".
 */

const execFileP = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout.trim();
}

async function fixtureCorpus(): Promise<InMemoryStore> {
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  // ADR-0576 D7: a REAL story chain now names a live increment before any spend — these fixtures
  // carry an active one so the backstop/forensics scenarios below reach their gate walk unchanged.
  await corpus.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  await corpus.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
  return corpus;
}

/** Keep dependency-free install residue out of the fixture's authored proof tree. */
async function commitInstallIgnores(repoRoot: string): Promise<void> {
  await writeFile(path.join(repoRoot, ".gitignore"), "node_modules/\npnpm-lock.yaml\n");
  await git(["add", ".gitignore"], repoRoot);
  await git(
    ["-c", "commit.gpgsign=false", "commit", "-m", "fixture: add frozen lockfile"],
    repoRoot,
  );
}

function installBearingSpec(args: {
  id: "cap-a" | "fix-story";
  typecheckExit: 0 | 7;
}): string {
  const testFile = `${FIXTURE_DIR}/${args.id}.test.ts`;
  const sourceFile = `${FIXTURE_DIR}/${args.id}.ts`;
  const isStory = args.id === "fix-story";
  const typecheckScript =
    `process.stdout.write('${args.id.toUpperCase()}-TYPECHECK'); ` +
    `process.exit(${String(args.typecheckExit)})`;
  return [
    "---",
    `id: "${args.id}"`,
    `tier: ${isStory ? "story" : "capability"}`,
    ...(!isStory ? ['story: "fix-story"'] : []),
    `title: "${args.id}"`,
    `outcome: "outcome of ${args.id}"`,
    "status: proposed",
    `proof_mode: ${isStory ? "UAT" : "integration-test"}`,
    ...(isStory ? ["uat_witness: machine", "capabilities: [cap-a]"] : []),
    "depends_on: []",
    "proof:",
    "  command:",
    `    file: ${JSON.stringify(process.execPath)}`,
    '    args: ["--version"]',
    "  scope:",
    `    testGlobs: ["${testFile}"]`,
    `    sourceGlobs: ["${sourceFile}"]`,
    "  real:",
    `    testFile: "${testFile}"`,
    `    sourceFile: "${sourceFile}"`,
    "    install: true",
    "    typecheck:",
    `      file: ${JSON.stringify(process.execPath)}`,
    `      args: ${JSON.stringify(["-e", typecheckScript])}`,
    "    scope:",
    `      testGlobs: ["${testFile}"]`,
    `      sourceGlobs: ["${sourceFile}"]`,
    "---",
    `# ${args.id}`,
    "",
  ].join("\n");
}

async function commitAuthoredAttempt(args: RealBuildArgs): Promise<string> {
  const testFile = path.join(args.worktree.root, args.realConfig.testFile);
  const sourceFile = path.join(args.worktree.root, args.realConfig.sourceFile);
  await mkdir(path.dirname(testFile), { recursive: true });
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(testFile, `// authored test evidence for ${args.spec.id}\n`);
  await writeFile(sourceFile, `export const authoredFor = ${JSON.stringify(args.spec.id)};\n`);
  await git(["add", "--", args.realConfig.testFile, args.realConfig.sourceFile], args.worktree.root);
  await git(
    [
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      `fixture: author ${args.spec.id}`,
    ],
    args.worktree.root,
  );
  return git(["rev-parse", "HEAD"], args.worktree.root);
}

function passingBuild(args: RealBuildArgs, commitSha: string): RealBuildResult {
  return {
    result: {
      ok: true,
      verdict: {
        unitId: args.spec.id,
        proofMode: "capability",
        outcome: "pass",
        commitSha,
        signer: args.signer,
        runId: args.runId,
        outputVersion: "v1",
        evidence: [],
        at: "2026-09-16T00:00:00.000Z",
      },
      phasesVisited: ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "GATE"],
    },
    commitSha,
  };
}

function forensicStoryNodeBuilder(
  redNodeId: "cap-a" | "fix-story",
  visited: string[],
): StoryRealNodeBuilder {
  let previousCommitSha: string | undefined;
  return async (args) => {
    assert.equal(args.promote, false, "a story chain must defer promotion until its stacked HEAD");
    assert.equal(
      args.baseSha,
      previousCommitSha ?? args.worktree.headSha,
      "each story member must build on the previous signed commit, or the initial worktree cut",
    );
    visited.push(args.spec.id);
    const commitSha = await commitAuthoredAttempt(args);
    previousCommitSha = commitSha;
    if (args.spec.id !== redNodeId) return passingBuild(args, commitSha);

    const refusal = makeBackstopRefusal("typecheck", {
      result: "red",
      originalProcessResult: {
        stdout: `${args.spec.id.toUpperCase()}-TYPECHECK`,
        stderr: "",
        exitCode: 7,
      },
      timeoutMs: 600_000,
    });
    const forensicPreservation = await promoteRealPass({
      repoRoot: args.repoRoot,
      unitId: args.spec.id,
      runId: args.runId,
      commitSha,
      purpose: "unsigned-forensics",
      push: false,
    });
    return {
      result: {
        ok: false,
        failedAt: "GATE",
        reason: `backstop RED: ${refusal.reason}`,
        phasesVisited: ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "GATE"],
      },
      typecheck: "red",
      backstopObservation: refusal.observation,
      forensicPreservation,
    };
  };
}

function assertInjectedStoryNodeBuilder(builder: StoryRealNodeBuilder): void {
  assert.equal(
    resolveStoryRealNodeBuilder(builder),
    builder,
    "an injected story builder must be selected before the REAL lifecycle starts",
  );
}

async function localRefs(repoRoot: string): Promise<string[]> {
  const rendered = await git(
    ["for-each-ref", "--format=%(refname:short)", "refs/heads/claude/"],
    repoRoot,
  );
  return rendered.length === 0 ? [] : rendered.split(/\r?\n/);
}

async function remoteRefs(repoRoot: string): Promise<string[]> {
  const rendered = await git(["ls-remote", "--heads", "origin"], repoRoot);
  return rendered.length === 0 ? [] : rendered.split(/\r?\n/);
}

async function treePaths(repoRoot: string, ref: string): Promise<string[]> {
  const rendered = await git(["ls-tree", "-r", "--name-only", ref], repoRoot);
  return rendered.length === 0 ? [] : rendered.split(/\r?\n/);
}

const FORENSIC_FIXTURE = {
  branch: "claude/real-forensics/cap-a-run-1",
  commitSha: "0123456789abcdef0123456789abcdef01234567",
  pushed: false,
  detail: "push withheld — local branch kept for forensics",
} satisfies PromotionResult;

test("story REAL node-builder dependency defaults to buildNodeReal and selects an injection", () => {
  assert.equal(resolveStoryRealNodeBuilder(undefined), buildNodeReal);
  const injected: StoryRealNodeBuilder = async () => {
    throw new Error("identity-only fixture must not run");
  };
  assert.equal(resolveStoryRealNodeBuilder(injected), injected);
});

test("story forensic accounting ignores an absent preservation and retains a concrete one", () => {
  const retained = new Set<PromotionResult>();

  retainStoryForensicPreservation(retained, undefined);
  assert.deepEqual(Array.from(retained), []);

  retainStoryForensicPreservation(retained, FORENSIC_FIXTURE);
  assert.deepEqual(Array.from(retained), [FORENSIC_FIXTURE]);
});

test("a no-commit story report distinguishes pass, unsigned evidence, and no evidence", () => {
  assert.equal(
    storyNoCommitPromotionReason(true, 0),
    "nothing authored across the chain — every verdict attests the unchanged HEAD",
  );
  assert.equal(
    storyNoCommitPromotionReason(false, 1),
    "the chain halted before any node signed a commit — no proven prefix to park; the unsigned failing attempt is retained separately",
  );
  assert.equal(
    storyNoCommitPromotionReason(false, 0),
    "the chain halted before any node signed a commit — nothing to park",
  );
});

test(
  "a first-node backstop red reports its diagnostics and retains only the unsigned local attempt",
  { timeout: 180_000 },
  async () => {
    // No signed prefix exists, but the committed unsigned attempt must remain named.
    const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
    const repo = await fixtureRepo(true);
    try {
      await commitInstallIgnores(repo.root);
      await writeFile(
        path.join(stories, "fix-story", "cap-a.md"),
        installBearingSpec({ id: "cap-a", typecheckExit: 7 }),
      );
      const visited: string[] = [];
      const realNodeBuilder = forensicStoryNodeBuilder("cap-a", visited);
      assertInjectedStoryNodeBuilder(realNodeBuilder);

      const corpus = await fixtureCorpus();
      const result = await storyBuild("fix-story", {
        curatorRunner: new ScriptedCuratorRunner(),
        corpusStore: corpus,
        progress: silentBuildProgress(),
        dryRun: false,
        real: true,
        actor: "tester@example.com",
        storiesDir: stories,
        repoRoot: repo.root,
        verdictStore: "memory",
        increment: "inc-live",
        buildGuardFactory: offlineBuildGuardFactory,
        innerLoopReads: { corpus, ledger: new InMemoryStore() },
        realNodeBuilder,
      });

      assert.equal(result.ok, false, "the red package backstop must halt the chain");
      assert.deepEqual(visited, ["cap-a"], "storyBuild must select the injected node builder");
      assert.match(result.body, /nodes:\s+0\/1 signed passes/);
      assert.match(result.body, /forensics:\s+UNSIGNED/);
      assert.match(result.body, /claude\/real-forensics\/cap-a-story-real-/);
      assert.match(result.body, /no proven prefix to park/);
      assert.doesNotMatch(result.body, /nothing to park/);
      assert.match(result.body, /backstop observation \(typecheck\): exit 7;/);
      assert.match(result.body, /stdout:\nCAP-A-TYPECHECK\nstderr:\n\(empty\)/);

      const refs = await localRefs(repo.root);
      assert.equal(refs.length, 1, `expected one forensic ref, got ${refs.join(", ")}`);
      const forensicRef = refs[0];
      assert.ok(forensicRef !== undefined);
      assert.match(forensicRef, /^claude\/real-forensics\/cap-a-story-real-/);
      assert.deepEqual(await remoteRefs(repo.root), [], "unsigned evidence must remain local");
      const worktreeList = await git(["worktree", "list", "--porcelain"], repo.root);
      assert.equal(
        worktreeList.split(/\r?\n/).filter((line) => line.startsWith("worktree ")).length,
        1,
        "storyBuild must remove its disposable worktree before returning",
      );
      const forensicPaths = await treePaths(repo.root, forensicRef);
      assert.ok(forensicPaths.includes(`${FIXTURE_DIR}/cap-a.test.ts`));
      assert.ok(forensicPaths.includes(`${FIXTURE_DIR}/cap-a.ts`));
    } finally {
      await rm(stories, { recursive: true, force: true });
      await rm(repo.root, { recursive: true, force: true });
      if (repo.origin !== null) await rm(repo.origin, { recursive: true, force: true });
    }
  },
);

test(
  "a later story-node backstop red keeps distinct signed-prefix and unsigned forensic refs",
  { timeout: 180_000 },
  async () => {
    // This is the exact former collision: both calls use story id + run id.
    const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }], {
      uatWitness: "machine",
    });
    const repo = await fixtureRepo(true);
    try {
      await commitInstallIgnores(repo.root);
      await writeFile(
        path.join(stories, "fix-story", "cap-a.md"),
        installBearingSpec({ id: "cap-a", typecheckExit: 0 }),
      );
      await writeFile(
        path.join(stories, "fix-story", "story.md"),
        installBearingSpec({ id: "fix-story", typecheckExit: 7 }),
      );
      const visited: string[] = [];
      const realNodeBuilder = forensicStoryNodeBuilder("fix-story", visited);
      assertInjectedStoryNodeBuilder(realNodeBuilder);

      const corpus = await fixtureCorpus();
      const result = await storyBuild("fix-story", {
        curatorRunner: new ScriptedCuratorRunner(),
        corpusStore: corpus,
        progress: silentBuildProgress(),
        dryRun: false,
        real: true,
        actor: "tester@example.com",
        storiesDir: stories,
        repoRoot: repo.root,
        verdictStore: "memory",
        increment: "inc-live",
        buildGuardFactory: offlineBuildGuardFactory,
        innerLoopReads: { corpus, ledger: new InMemoryStore() },
        realNodeBuilder,
      });

      assert.equal(
        result.ok,
        false,
        "the story-node package red must return an honest halt, not throw",
      );
      assert.deepEqual(
        visited,
        ["cap-a", "fix-story"],
        "the injected builder must drive both members in dependency order",
      );
      assert.match(result.body, /nodes:\s+1\/2 signed passes/);
      assert.match(result.body, /promoted:\s+claude\/real\/fix-story-story-real-/);
      assert.match(result.body, /forensics:\s+UNSIGNED/);
      assert.match(result.body, /claude\/real-forensics\/fix-story-story-real-/);

      const refs = await localRefs(repo.root);
      assert.equal(refs.length, 2, `expected prefix + forensic refs, got ${refs.join(", ")}`);
      const prefixRef = refs.find((ref) => ref.startsWith("claude/real/fix-story-story-real-"));
      const forensicRef = refs.find((ref) =>
        ref.startsWith("claude/real-forensics/fix-story-story-real-"),
      );
      assert.ok(
        prefixRef !== undefined,
        `the signed capability prefix must survive: ${refs.join(", ")}`,
      );
      assert.ok(
        forensicRef !== undefined,
        `the unsigned story attempt must survive: ${refs.join(", ")}`,
      );
      assert.notEqual(
        await git(["rev-parse", prefixRef], repo.root),
        await git(["rev-parse", forensicRef], repo.root),
      );

      const prefixPaths = await treePaths(repo.root, prefixRef);
      assert.ok(prefixPaths.includes(`${FIXTURE_DIR}/cap-a.ts`));
      assert.equal(prefixPaths.includes(`${FIXTURE_DIR}/fix-story.ts`), false);
      const forensicPaths = await treePaths(repo.root, forensicRef);
      assert.ok(forensicPaths.includes(`${FIXTURE_DIR}/cap-a.ts`));
      assert.ok(forensicPaths.includes(`${FIXTURE_DIR}/fix-story.ts`));
      assert.deepEqual(
        await remoteRefs(repo.root),
        [],
        "neither halted-chain ref may reach origin",
      );
    } finally {
      await rm(stories, { recursive: true, force: true });
      await rm(repo.root, { recursive: true, force: true });
      if (repo.origin !== null) await rm(repo.origin, { recursive: true, force: true });
    }
  },
);
