/**
 * Offline test support for the `--real` chain: a throwaway git repo, a fixture `stories/` dir whose
 * capabilities carry spec-borne `proof:` blocks, per-node scripted authoring leaves, and a CANNED
 * {@link LiveAuthor} for the ADR-0243 accounting seam.
 *
 * GLUE (ADR-0158): un-asserted connective code in `drive-machinery`'s own building. Nothing asserts
 * these helpers directly — they exist so a test spends its assertions on behaviour rather than on
 * ~150 lines of git plumbing. The first three are LIFTED from the equivalent helpers in
 * `packages/cli/src/story-real-build.test.ts`, deliberately COPIED rather than shared: re-pointing
 * another story's green proof at a common helper buys nothing and risks reddening a story this
 * building does not own.
 *
 * Every helper builds its OWN tmpdir git repo and never assumes the ambient checkout — a caller may
 * itself be running inside a spine build worktree, and cutting a nested one must still work.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { ClaudeAgentAuthor, FileToolExecutor, FILE_WRITE_TOOLS } from "@storytree/agent";
import type { PhaseAuthor, SdkRunInfo } from "@storytree/agent";
import { OwnedLoopAuthor, PathWriteScope, scriptedWriterModel } from "@storytree/orchestrator";
import type { NodeSpec } from "@storytree/orchestrator";

const execFileP = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout;
}

/**
 * Fixture nodes live under a concrete package dir so their declared scope satisfies the ADR-0087
 * structural bound (a write-scope glob must stay within one `packages/<pkg>/` or `apps/<app>/`).
 */
export const FIXTURE_DIR = "packages/fixture";

/** A throwaway git repo with one commit; optionally a bare origin so push paths stay local. */
export async function fixtureRepo(
  withOrigin: boolean,
): Promise<{ root: string; origin: string | null; initialSha: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "storytree-real-chain-"));
  await git(["init", "-b", "main"], root);
  await git(["config", "user.email", "fixture@storytree.invalid"], root);
  await git(["config", "user.name", "fixture"], root);
  await writeFile(path.join(root, "README.md"), "fixture\n");
  // "type": "module" so node treats the authored .ts (run via the absolute tsx loader) as ESM
  // unambiguously — no node_modules needed (the leaves import only node: builtins + relative files).
  await writeFile(path.join(root, "package.json"), '{\n  "type": "module"\n}\n');
  await git(["add", "-A"], root);
  await git(["commit", "-m", "fixture: initial"], root);
  const initialSha = (await git(["rev-parse", "HEAD"], root)).trim();
  let origin: string | null = null;
  if (withOrigin) {
    origin = await mkdtemp(path.join(os.tmpdir(), "storytree-real-chain-origin-"));
    await git(["init", "--bare", "-b", "main"], origin);
    await git(["remote", "add", "origin", origin], root);
  }
  return { root, origin, initialSha };
}

/** Frontmatter for a fixture capability with a spec-borne (no-install) real proof config. */
function capSpec(id: string, dependsOn: string[]): string {
  const testFile = `${FIXTURE_DIR}/${id}.test.ts`;
  const src = `${FIXTURE_DIR}/${id}.ts`;
  return [
    "---",
    `id: "${id}"`,
    "tier: capability",
    'story: "fix-story"',
    `title: "${id}"`,
    `outcome: "outcome of ${id}"`,
    "status: proposed",
    "proof_mode: integration-test",
    `depends_on: [${dependsOn.join(", ")}]`,
    "proof:",
    "  command:",
    "    file: node",
    '    args: ["--version"]',
    "  scope:",
    `    testGlobs: ["${testFile}"]`,
    `    sourceGlobs: ["${src}"]`,
    "  real:",
    `    testFile: "${testFile}"`,
    `    sourceFile: "${src}"`,
    "    scope:",
    `      testGlobs: ["${testFile}"]`,
    `      sourceGlobs: ["${src}"]`,
    "---",
    `# ${id}`,
    "",
  ].join("\n");
}

/** A fixture stories/ dir: one story (UAT node withheld by default) over the given capabilities. */
export async function fixtureStories(
  caps: { id: string; dependsOn: string[] }[],
  opts: { uatWitness?: "machine" | "human" } = {},
): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "storytree-real-chain-stories-"));
  const storyDir = path.join(dir, "fix-story");
  await mkdir(storyDir, { recursive: true });
  const witnessLine = opts.uatWitness !== undefined ? `uat_witness: ${opts.uatWitness}\n` : "";
  await writeFile(
    path.join(storyDir, "story.md"),
    [
      "---",
      'id: "fix-story"',
      "tier: story",
      'title: "fix story"',
      'outcome: "the fixture story"',
      "status: proposed",
      "proof_mode: UAT",
      witnessLine + `capabilities: [${caps.map((c) => c.id).join(", ")}]`,
      "depends_on: []",
      "---",
      "# fix story",
      "",
    ].join("\n"),
  );
  for (const c of caps) {
    await writeFile(path.join(storyDir, `${c.id}.md`), capSpec(c.id, c.dependsOn));
  }
  return dir;
}

/** The scripted red→green pair each fixture node authors (cap-b imports cap-a's source). */
export const NODE_SOURCES: ReadonlyMap<string, { test: string; impl: string }> = new Map([
  ["cap-a", {
    test:
      'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { a } from "./cap-a.js";\ntest("a", () => assert.equal(a(), 1));\n',
    impl: "export function a(): number {\n  return 1;\n}\n",
  }],
  ["cap-b", {
    // cap-b's TEST imports cap-a's spine-committed source — proving the shared/stacked worktree.
    test:
      'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { a } from "./cap-a.js";\nimport { b } from "./cap-b.js";\n' +
      'test("b builds on a", () => assert.equal(b(), a() + 1));\n',
    impl: 'import { a } from "./cap-a.js";\nexport function b(): number {\n  return a() + 1;\n}\n',
  }],
  // A node that fails closed: its impl does NOT satisfy its test (green is never observed).
  ["cap-bad", {
    test:
      'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { bad } from "./cap-bad.js";\ntest("bad", () => assert.equal(bad(), 42));\n',
    impl: "export function bad(): number {\n  return 0;\n}\n",
  }],
]);

export interface ScopeForResult { testGlobs: string[]; sourceGlobs: string[] }

/** The declared scope for a fixture node id. */
export function scopeFor(id: string): ScopeForResult {
  return { testGlobs: [`${FIXTURE_DIR}/${id}.test.ts`], sourceGlobs: [`${FIXTURE_DIR}/${id}.ts`] };
}

/** A per-node scripted leaf: writes the node's test (AUTHOR_TEST) then impl (IMPLEMENT). */
export function scriptedAuthors(
  scopes: Record<string, { testGlobs: string[]; sourceGlobs: string[] }>,
): (spec: NodeSpec, worktreeRoot: string) => PhaseAuthor | undefined {
  return (spec, worktreeRoot) => {
    const src = NODE_SOURCES.get(spec.id);
    const scope = scopes[spec.id];
    if (src === undefined || scope === undefined) return undefined;
    return new OwnedLoopAuthor({
      model: scriptedWriterModel([
        { path: `${FIXTURE_DIR}/${spec.id}.test.ts`, content: src.test },
        { path: `${FIXTURE_DIR}/${spec.id}.ts`, content: src.impl },
      ]),
      tools: new FileToolExecutor({ rootDir: worktreeRoot }),
      scope: new PathWriteScope(scope),
      writeTools: FILE_WRITE_TOOLS,
    });
  };
}

/**
 * A CANNED {@link ClaudeAgentAuthor} for the ADR-0243 D1 accounting seam: a GENUINE leaf instance
 * (so nothing widens the exported `LiveAuthor` union) carrying caller-supplied {@link SdkRunInfo}
 * entries in its public `runs` array.
 *
 * Its `queryFn` THROWS. Injecting one at all sets the leaf's `#usesRealSdk` false, so no SDK session
 * is ever opened; making it throw turns "this canned author never authors anything" from a claim
 * into an assertion — any path that actually drives it explodes rather than passing quietly.
 *
 * ADR-0243 D5: this is a FIXTURE and fixtures drift. It proves the accounting CALL happens; that a
 * real SDK run still produces this shape is covered by the compile-time `keyof ModelUsage` pin plus
 * any real build the owner runs.
 */
export function cannedLiveAuthor(runs: SdkRunInfo[]): ClaudeAgentAuthor {
  const author = new ClaudeAgentAuthor({
    cwd: os.tmpdir(),
    isWriteAllowed: () => false,
    queryFn: () => {
      throw new Error(
        "cannedLiveAuthor: the canned accounting leaf must never author — ADR-0243's seam is " +
          "accounting-only, and the authoring leaf is the separate authorOverride.",
      );
    },
  });
  author.runs.push(...runs);
  return author;
}

/** One plausible authoring slice's accounting, for a canned live author. */
export function cannedRun(overrides: Partial<SdkRunInfo> = {}): SdkRunInfo {
  return {
    phase: "AUTHOR_TEST",
    source: "sdk-leaf",
    subtype: "success",
    turns: 3,
    costUsd: 0.25,
    usage: {
      inputTokens: 100,
      outputTokens: 200,
      cacheReadInputTokens: 300,
      cacheCreationInputTokens: 400,
    },
    byModel: {
      "claude-sonnet-5": {
        inputTokens: 100,
        outputTokens: 200,
        cacheReadInputTokens: 300,
        cacheCreationInputTokens: 400,
        costUsd: 0.25,
        contextWindow: 200_000,
      },
    },
    ...overrides,
  };
}

/** Explicit offline admission: tests never infer a bypass from another injected dependency. */
export const offlineBuildGuardFactory: import("./node-build.js").BuildGuardFactory = async ({ runId }) => ({
  ok: true,
  runId,
  guard: { assertHeld: async () => {}, noteActivity: async () => {}, release: async () => {} },
});
