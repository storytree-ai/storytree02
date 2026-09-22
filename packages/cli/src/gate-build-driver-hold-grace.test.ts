/**
 * `driveBuildTestsGate` reads `--hold-grace` (ADR-0592 D3) exactly where it reads `--time-budget`
 * (`gate-build-driver.test.ts`'s own budget tests, read-only reference here) — `{ real: true }`
 * unconditionally, since a gate drive is ALWAYS a real build and has no `--live` route to narrow to.
 *
 * Fixture helpers below are deliberately COPIED from `gate-build-driver.test.ts` rather than shared —
 * that file's own header states the same choice for its `real-chain-fixture.ts` siblings: re-pointing
 * this story's proof at another file's non-exported test glue risks reddening a story this file does
 * not own, and neither `fixtureStories` nor `buildTestsGate` is exported.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { Store } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import { HOLD_GRACE_REAL_ONLY_REFUSAL, holdGraceRefusal, silentBuildProgress } from "@storytree/drive";
import type { ReliabilityGate } from "@storytree/library";

import { driveBuildTestsGate, gateRetryCommand } from "./gate-build-driver.js";
import type { GateBuildDriverDeps } from "./gate-build-driver.js";

const FIXTURE_DIR = "packages/fixture";
const SOURCE_FILE = `${FIXTURE_DIR}/calc.mjs`;
const TEST_FILE = `${FIXTURE_DIR}/double.test.mjs`;

/** A stories dir holding ONE referenced R2 build node (`seed-runner`) under a story dir. */
async function fixtureStories(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "storytree-gate-hold-grace-stories-"));
  const storyDir = path.join(dir, "fix-story");
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(storyDir, "seed-runner.md"),
    [
      "---",
      'id: "seed-runner"',
      "tier: capability",
      'story: "fix-story"',
      'title: "seed runner seam"',
      'outcome: "the seed orchestration gets a behaviour-preserving tested seam"',
      "status: proposed",
      "proof_mode: integration-test",
      "depends_on: []",
      "proof:",
      "  command:",
      "    file: node",
      '    args: ["--version"]',
      "  scope:",
      `    testGlobs: ["${TEST_FILE}"]`,
      `    sourceGlobs: ["${SOURCE_FILE}"]`,
      "  real:",
      `    testFile: "${TEST_FILE}"`,
      `    sourceFile: "${SOURCE_FILE}"`,
      "    scope:",
      `      testGlobs: ["${TEST_FILE}"]`,
      `      sourceGlobs: ["${SOURCE_FILE}"]`,
      "    refactorForTests: true",
      "    proofCommand:",
      "      file: node",
      '      args: ["--test"]',
      "---",
      "# seed runner",
      "",
    ].join("\n"),
  );
  return dir;
}

function buildTestsGate(over: Partial<ReliabilityGate> = {}): ReliabilityGate {
  return {
    id: "fix-story#gate-1",
    title: "Seed orchestration gets a tested seam",
    kind: "build-tests",
    covers: ["seed-corpus-scripts"],
    buildNode: "seed-runner",
    retired: false,
    ...over,
  };
}

/**
 * A node builder that returns immediately without cutting a worktree or authoring anything — the
 * same seam `gate-build-driver.test.ts`'s own budget tests use, and for the same reason (its
 * docstring): a mutated guard that stops refusing does not fail, it proceeds into a real build and
 * hangs. With this seam that path finishes in milliseconds instead.
 */
function refusingBuilder(): GateBuildDriverDeps["realNodeBuilder"] {
  return async () => ({
    result: {
      ok: false as const,
      failedAt: "AUTHOR_TEST" as const,
      reason: "this suite never authors",
      phasesVisited: [],
    },
  });
}

async function fixtureCorpusWithIncrements(): Promise<InMemoryStore> {
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  await corpus.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  await corpus.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
  return corpus;
}

test("a gate drive reads --hold-grace and refuses a figure that cannot bound a hold, before any spend (ADR-0592 D3)", async () => {
  // A gate drive is ALWAYS a real build, so `{ real: true }` is passed unconditionally — this proves
  // that literal, never a route the drive read off its own arguments.
  const stories = await fixtureStories();
  const store: Store = new InMemoryStore();
  try {
    for (const raw of ["-5", "abc", ""]) {
      const env = await driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
        progress: silentBuildProgress(),
        storiesDir: stories,
        repoRoot: ".", // never touched: the refusal precedes the worktree cut
        store,
        realNodeBuilder: refusingBuilder(),
        holdGrace: raw,
      });
      assert.equal(env.ok, false, raw);
      assert.equal(env.body, holdGraceRefusal(raw), raw);
      assert.deepEqual(env.next, [gateRetryCommand(buildTestsGate().id, undefined)], raw);
    }
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

test("a gate drive with a VALID --hold-grace is not refused by the hold check", async () => {
  // The other side of the first test: without this, a check that refused every value would satisfy
  // it. It also proves the route object passed to `chooseHoldGraceMs` genuinely carries `real: true`
  // rather than an empty or falsy stand-in — which would make even a VALID value refuse as off-route,
  // quoting HOLD_GRACE_REAL_ONLY_REFUSAL. This drive goes on to fail (or succeed) for its own
  // unrelated reasons; what matters is that the failure is never the hold-grace check's.
  const stories = await fixtureStories();
  const store: Store = new InMemoryStore();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    const env = await driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus,
      progress: silentBuildProgress(),
      storiesDir: stories,
      repoRoot: ".",
      store,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: store },
      realNodeBuilder: refusingBuilder(),
      holdGrace: "20",
    });
    assert.notEqual(env.body, HOLD_GRACE_REAL_ONLY_REFUSAL);
    assert.doesNotMatch(env.body, /--hold-grace/);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

test("--hold-grace 0 is HONOURED on a gate drive, unlike --time-budget 0 which is refused", async () => {
  const stories = await fixtureStories();
  const store: Store = new InMemoryStore();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    const env = await driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus,
      progress: silentBuildProgress(),
      storiesDir: stories,
      repoRoot: ".",
      store,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: store },
      realNodeBuilder: refusingBuilder(),
      holdGrace: "0",
    });
    assert.doesNotMatch(env.body, /--hold-grace/);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});
