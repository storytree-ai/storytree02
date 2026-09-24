import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import {
  createBuildWorktree,
  findNodeSpecFile,
  loadNodeSpec,
  resolveBuildConfig,
  resolveSignerFromEnv,
} from "@storytree/orchestrator";
import type { BuildWorktree, LeafPhasePrompts, NodeSpec } from "@storytree/orchestrator";
import type { PhaseAuthor } from "@storytree/agent";

import type { BuildGuard } from "./build-guard.js";
import { silentBuildProgress } from "./build-progress.js";
import { ScriptedCuratorRunner } from "./curate.js";
import { fixtureRepo, fixtureStories, scriptedAuthors, scopeFor } from "./real-chain-fixture.js";
import * as NodeBuild from "./node-build.js";
import * as StoryBuild from "./story-build.js";

/**
 * The paid-entry lease is deliberately proved at the public REAL seams.  The guard fixture records
 * acquisition, checkpoints, activity and cleanup, but does not model the primitive's Postgres race:
 * `build-guard.test.ts` owns that separate evidence.
 */

const CAPABILITY = "cap-a";
const INCREMENT = "inc-live";

interface Fixture {
  readonly repoRoot: string;
  readonly stories: string;
  readonly corpus: InMemoryStore;
  readonly worktree: BuildWorktree;
  readonly spec: NodeSpec;
  readonly prompts: LeafPhasePrompts;
  readonly signer: string;
}

async function setupFixture(): Promise<Fixture> {
  const repo = await fixtureRepo(false);
  const stories = await fixtureStories([{ id: CAPABILITY, dependsOn: [] }]);
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  await corpus.upsertDoc({
    id: INCREMENT,
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:lease-entry-fixture", status: "active" },
  });
  await corpus.upsertDoc({ id: "lease-entry-fixture", kind: "arc", doc: { kind: "arc" } });
  const worktree = await createBuildWorktree(repo.root, {});
  const specFile = findNodeSpecFile(stories, CAPABILITY);
  assert.ok(specFile !== null, "fixture capability must be discoverable");
  const spec = loadNodeSpec(specFile);
  const signer = resolveSignerFromEnv({ flag: "tester@example.com" });
  assert.equal(signer.ok, true, "fixture signer must resolve");
  const rendered = await NodeBuild.renderLeafPhasePrompts(corpus);
  assert.equal(rendered.ok, true, "fixture Library prompts must render");
  return {
    repoRoot: repo.root,
    stories,
    corpus,
    worktree,
    spec,
    prompts: (rendered as { ok: true; prompts: LeafPhasePrompts }).prompts,
    signer: (signer as { ok: true; signer: string }).signer,
  };
}

async function teardownFixture(fx: Fixture): Promise<void> {
  await fx.worktree.remove();
  await rm(fx.repoRoot, { recursive: true, force: true });
  await rm(fx.stories, { recursive: true, force: true });
}

function recordingGuard(events: string[]): BuildGuard {
  return {
    noteActivity: async () => { events.push("activity"); },
    assertHeld: async () => { events.push("checkpoint"); },
    release: async () => { events.push("release"); },
  };
}

let fx!: Fixture;

before(async () => { fx = await setupFixture(); });
after(async () => { await teardownFixture(fx); });

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: the REAL node seam acquires its exact run lease and releases it after the walk", async () => {
  const events: string[] = [];
  const author = scriptedAuthors({ [CAPABILITY]: scopeFor(CAPABILITY) })(fx.spec, fx.worktree.root);
  assert.ok(author !== undefined, "fixture scripted author must resolve");
  const config = resolveBuildConfig(fx.spec)?.config.real;
  assert.ok(config !== undefined, "fixture capability must have a REAL arm");

  // The intersection is intentional: the production API must grow this explicit hermetic factory;
  // current entry code ignores it, so the assertion below is a behavioural red rather than an import red.
  const args = {
    spec: fx.spec,
    worktree: fx.worktree,
    baseSha: fx.worktree.headSha,
    realConfig: config,
    store: new InMemoryStore(),
    runId: "real-lease-entry-node",
    signer: fx.signer,
    phasePrompts: fx.prompts,
    repoRoot: fx.repoRoot,
    promote: false,
    authorOverride: author as PhaseAuthor,
    buildGuardFactory: async (input: { runId: string; unitIds: readonly string[] }) => {
      events.push(`acquire:${input.runId}:${input.unitIds.join(",")}`);
      return { ok: true as const, runId: input.runId, guard: recordingGuard(events) };
    },
  };
  const built = await NodeBuild.buildNodeReal(args as Parameters<typeof NodeBuild.buildNodeReal>[0]);

  assert.equal(built.result.ok, true, "ground truth: the scripted REAL walk reaches green");
  assert.deepEqual(
    events.slice(0, 2),
    ["acquire:real-lease-entry-node:cap-a", "checkpoint"],
    "the lease must exist before the first controlled build operation",
  );
  assert.equal(events.at(-1), "release", "every acquired paid-entry lease is released after the walk");
});

test("story-paid-admission-holds-one-lease-for-story-and-members: a REAL story takes one shared sorted lease instead of per-member leases", async () => {
  const events: string[] = [];
  const opts = {
    dryRun: false,
    real: true,
    runtime: "claude",
    actor: "tester@example.com",
    repoRoot: fx.repoRoot,
    storiesDir: fx.stories,
    corpusStore: fx.corpus,
    innerLoopReads: { corpus: fx.corpus, ledger: new InMemoryStore() },
    increment: INCREMENT,
    store: new InMemoryStore(),
    // The injected verdict store below is the hermetic seam.  The current paid-entry preflight still
    // asks its DB readiness question before consulting that seam, so answer it locally rather than
    // letting this focused lease test reach a live pool.
    ensureDb: async () => ({ ok: true as const, started: false }),
    promote: false,
    progress: silentBuildProgress(),
    curatorRunner: new ScriptedCuratorRunner(),
    authorOverride: scriptedAuthors({ [CAPABILITY]: scopeFor(CAPABILITY) }),
    buildGuardFactory: async (input: { runId: string; unitIds: readonly string[] }) => {
      events.push(`acquire:${input.unitIds.join(",")}`);
      return { ok: true as const, runId: input.runId, guard: recordingGuard(events) };
    },
  };
  const result = await StoryBuild.storyBuild("fix-story", opts as Parameters<typeof StoryBuild.storyBuild>[1]);

  assert.equal(result.ok, true, result.body);
  assert.deepEqual(events.filter((event) => event.startsWith("acquire:")), ["acquire:cap-a,fix-story"]);
  assert.equal(events.filter((event) => event === "release").length, 1, "the chain releases one shared lease");
});

test("lost-build-lease-blocks-the-next-controlled-entry-step: a rejected checkpoint refuses the REAL walk before the leaf can author", async () => {
  let authorCalls = 0;
  const rejectingAuthor: PhaseAuthor = {
    author: async () => {
      authorCalls += 1;
      return { ok: true };
    },
  };
  const config = resolveBuildConfig(fx.spec)?.config.real;
  assert.ok(config !== undefined, "fixture capability must have a REAL arm");
  const args = {
    spec: fx.spec,
    worktree: fx.worktree,
    baseSha: fx.worktree.headSha,
    realConfig: config,
    store: new InMemoryStore(),
    runId: "real-lost-lease-node",
    signer: fx.signer,
    phasePrompts: fx.prompts,
    repoRoot: fx.repoRoot,
    promote: false,
    authorOverride: rejectingAuthor,
    beforePhase: async () => { throw new Error("build lease lost for cap-a"); },
  };
  const built = await NodeBuild.buildNodeReal(args as Parameters<typeof NodeBuild.buildNodeReal>[0]);

  assert.equal(built.result.ok, false, "a lost lease must refuse the next controlled operation");
  assert.equal(authorCalls, 0, "the rejected checkpoint must run outside advisory phase reporting");
  if (!built.result.ok) assert.match(built.result.reason, /build lease lost for cap-a/);
});

test("paid-build-activity-stamps-only-observed-source-test-or-phase-progress: quiet entry setup does not manufacture an activity stamp", async () => {
  const stamps: string[] = [];
  const config = resolveBuildConfig(fx.spec)?.config.real;
  assert.ok(config !== undefined, "fixture capability must have a REAL arm");
  const args = {
    spec: fx.spec,
    worktree: fx.worktree,
    baseSha: fx.worktree.headSha,
    realConfig: config,
    store: new InMemoryStore(),
    runId: "real-quiet-activity-node",
    signer: fx.signer,
    phasePrompts: fx.prompts,
    repoRoot: fx.repoRoot,
    promote: false,
    authorOverride: { author: async () => ({ ok: false, error: "stop before authoring" }) } as PhaseAuthor,
    buildActivityObserver: {
      start: async () => { stamps.push("start"); },
      stop: async () => { stamps.push("stop"); },
    },
  };
  const built = await NodeBuild.buildNodeReal(args as Parameters<typeof NodeBuild.buildNodeReal>[0]);

  assert.equal(built.result.ok, false, "ground truth: the scripted leaf refuses before it writes");
  assert.deepEqual(stamps, ["start", "stop"], "observer lifecycle is cleaned up without inventing a heartbeat");
});
