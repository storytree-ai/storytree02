import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { mkdir, rm, writeFile, utimes } from "node:fs/promises";
import path from "node:path";
import { PgClaimStore } from "@storytree/notice-board/store";
import { createBuildActivityObserver } from "./build-activity.js";

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
  if (built.result.ok) {
    const verdict = built.result.verdict;
    assert.ok(verdict.boundHash, "the signing continuation must retain the resolved binding");
    assert.ok(verdict.anchors?.some((anchor) => anchor.file === config.sourceFile && anchor.boundCommit === verdict.commitSha));
  }
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
  if (!built.result.ok) {
    assert.match(built.result.reason, /build lease lost for cap-a/);
    assert.equal(built.result.failedAt, "AUTHOR_TEST");
    assert.deepEqual(built.result.phasesVisited, [], "refused entry must not invent proof observations");
  }
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

const COLLISION = {
  ok: false as const,
  refusal: { unitId: "build:cap-a", holderRunId: "real-other-machine", startAgeMs: 1234,
    heartbeatAgeMs: 456, classification: "LIVE" as const },
};

function entryOptions(events: string[]) {
  return {
    dryRun: false, real: true, runtime: "claude", actor: "tester@example.com",
    repoRoot: fx.repoRoot, storiesDir: fx.stories, corpusStore: fx.corpus,
    increment: INCREMENT, verdictStore: "memory", store: new InMemoryStore(),
    promote: false,
    curatorRunner: new ScriptedCuratorRunner(),
    // A mutation can remove the expected refusal. Its fallback must still be entirely offline.
    authorOverride: () => ({ author: async () => { throw new Error("refusal-only offline author tripwire"); } }),
    innerLoopReads: { corpus: fx.corpus, ledger: { readEvents: async () => {
      events.push("policy"); throw new Error("policy-read-marker");
    } } },
    ensureDb: async () => { events.push("db"); return { ok: false as const, reason: "db-marker" }; },
    progress: { stage: async <T>(name: string, work: () => Promise<T>) => {
      events.push(`stage:${name}`);
      // stage() is awaited by entry itself; unlike the advisory phase reporter, this error propagates.
      // nodeBuild has no authorOverride seam, so stop before its paid gate callback can run.
      if (name.startsWith("gate (") || name.startsWith("node ")) {
        throw new Error("refusal-only paid stage tripwire");
      }
      return work();
    }, note: () => {} },
  };
}

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: node collision wins over an unreadable policy and opens no spend path", async () => {
  const events: string[] = [];
  const opts = { ...entryOptions(events), buildGuardFactory: async (input: { runId: string; unitIds: readonly string[] }) => {
    assert.match(input.runId, /^real-[0-9a-f-]{36}$/);
    assert.deepEqual(input.unitIds, [CAPABILITY]);
    events.push("acquire"); return COLLISION;
  } };
  const result = await NodeBuild.nodeBuild(CAPABILITY, opts);
  assert.equal(result.ok, false);
  assert.match(result.body, /real-other-machine/);
  assert.match(result.body, /1234/);
  assert.match(result.body, /456/);
  assert.match(result.body, /LIVE/);
  assert.deepEqual(events.filter((event) => !event.startsWith("stage:")), ["acquire"]);
  assert.equal((await opts.store.readEvents()).length, 0);
});

test("story-paid-admission-holds-one-lease-for-story-and-members: member collision wins before the story policy read", async () => {
  const events: string[] = [];
  const opts = { ...entryOptions(events), buildGuardFactory: async (input: { runId: string; unitIds: readonly string[] }) => {
    assert.match(input.runId, /^story-real-[0-9a-f-]{36}$/);
    assert.deepEqual(input.unitIds, [CAPABILITY, "fix-story"]);
    events.push("acquire"); return COLLISION;
  } };
  const result = await StoryBuild.storyBuild("fix-story", opts);
  assert.equal(result.ok, false);
  assert.match(result.body, /real-other-machine/);
  assert.match(result.body, /1234/);
  assert.match(result.body, /456/);
  assert.match(result.body, /LIVE/);
  assert.deepEqual(events.filter((event) => !event.startsWith("stage:")), ["acquire"]);
  assert.equal((await opts.store.readEvents()).length, 0);
});

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: cheap increment refusals acquire nothing and held policy refusals release once", async () => {
  await fx.corpus.upsertDoc({ id: "inc-closed", kind: "increment", doc: { kind: "increment", status: "closed", arcRef: "asset:lease-entry-fixture" } });
  for (const increment of [undefined, "unknown-increment", "inc-closed", INCREMENT]) {
    const events: string[] = [];
    const opts = { ...entryOptions(events), increment, buildGuardFactory: async (input: { runId: string }) => {
      events.push("acquire"); return { ok: true as const, runId: input.runId, guard: recordingGuard(events) };
    } };
    const result = await NodeBuild.nodeBuild(CAPABILITY, opts);
    assert.equal(result.ok, false);
    assert.deepEqual(events.filter((event) => !event.startsWith("stage:")), increment === INCREMENT ? ["acquire", "policy", "release"] : []);
  }
});

test("story-paid-admission-holds-one-lease-for-story-and-members: held story policy refusal releases exactly once", async () => {
  const events: string[] = [];
  const opts = { ...entryOptions(events), buildGuardFactory: async (input: { runId: string }) => {
    events.push("acquire"); return { ok: true as const, runId: input.runId, guard: recordingGuard(events) };
  } };
  const result = await StoryBuild.storyBuild("fix-story", opts);
  assert.equal(result.ok, false);
  assert.deepEqual(events.filter((event) => !event.startsWith("stage:")), ["acquire", "policy", "release"]);
});

test("lost-build-lease-blocks-the-next-controlled-entry-step: loss after AUTHOR_TEST blocks proof before IMPLEMENT or signature", async () => {
  const worktree = await createBuildWorktree(fx.repoRoot, {});
  const phases: string[] = [];
  let authorCalls = 0;
  let lost = false;
  const scripted = scriptedAuthors({ [CAPABILITY]: scopeFor(CAPABILITY) })(fx.spec, worktree.root)!;
  const store = new InMemoryStore();
  try {
    const built = await NodeBuild.buildNodeReal({ spec: fx.spec, worktree, baseSha: worktree.headSha,
      realConfig: resolveBuildConfig(fx.spec)!.config.real!, store, runId: "real-lost-after-author", signer: fx.signer,
      phasePrompts: fx.prompts, repoRoot: fx.repoRoot, promote: false,
      beforePhase: async () => { if (lost) throw new Error("lease-lost-after-author"); },
      onPhase: (phase) => { phases.push(phase); },
      authorOverride: { author: async (...args) => { authorCalls++; const result = await scripted.author(...args); lost = true; return result; } },
    });
    assert.equal(built.result.ok, false);
    if (!built.result.ok) assert.match(built.result.reason, /lease-lost-after-author/);
    assert.equal(authorCalls, 1);
    assert.deepEqual(phases, ["AUTHOR_TEST"]);
    assert.equal((await store.readEvents()).filter((event) => event.kind === "signing").length, 0);
  } finally { await worktree.remove(); }
});

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: shared factory closes refusal and acquisition errors, and a held guard closes only on release", async () => {
  for (const mode of ["held", "refused", "throw"] as const) {
    const events: string[] = [];
    const claim = { unitId: "build:cap-a", sessionId: "build:real-factory", branch: "fixture", intent: "build lease",
      grade: "work" as const, claimedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
    const factory = NodeBuild.sharedBuildGuardFactory(async () => ({
      store: {
        claim: async (request) => {
          events.push(`claim:${request.unitId}:${request.sessionId}`);
          if (mode === "throw") throw new Error("claim-store-down");
          return mode === "held" ? { acquired: true as const, claim, reclaimed: false } : { acquired: false as const, heldBy: { ...claim, sessionId: "build:other-machine" } };
        },
        current: async () => { events.push("current"); return claim; },
        stampActivity: async (stamps) => { events.push(`stamp:${stamps[0]?.observedAt}`); return stamps.length; },
        release: async (unit, session) => { events.push(`release:${unit}:${session}`); return true; },
      },
      close: async () => { events.push("close"); },
    }));
    if (mode === "throw") {
      await assert.rejects(factory({ runId: "real-factory", unitIds: [CAPABILITY] }), /claim-store-down/);
      assert.equal(events.at(-1), "close");
    } else {
      const acquired = await factory({ runId: "real-factory", unitIds: [CAPABILITY] });
      assert.equal(acquired.ok, mode === "held");
      if (acquired.ok) {
        assert.equal(acquired.runId, "real-factory");
        assert.equal(events.includes("close"), false);
        await acquired.guard.assertHeld();
        await acquired.guard.noteActivity(new Date("2026-09-24T00:00:00Z"));
        await acquired.guard.release();
        await acquired.guard.release();
        assert.deepEqual(events, ["claim:build:cap-a:build:real-factory", "current", "stamp:2026-09-24T00:00:00.000Z", "release:build:cap-a:build:real-factory", "close"]);
      } else {
        assert.equal(acquired.refusal.holderRunId, "other-machine");
        assert.deepEqual(events, ["claim:build:cap-a:build:real-factory", "close"]);
      }
    }
  }
});

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: factory closes its pool even when release fails", async () => {
  let closes = 0;
  const claim = { unitId: "build:cap-a", sessionId: "build:real-factory", branch: "fixture", intent: "build lease", grade: "work" as const,
    claimedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString() };
  const factory = NodeBuild.sharedBuildGuardFactory(async () => ({
    store: { claim: async () => ({ acquired: true, claim, reclaimed: false }), current: async () => claim,
      stampActivity: async () => 0, release: async () => { throw new Error("release-down"); } },
    close: async () => { closes++; },
  }));
  const result = await factory({ runId: "real-factory", unitIds: [CAPABILITY] });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  await assert.rejects(result.guard.release(), /release-down/);
  await result.guard.release();
  assert.equal(closes, 1);
});

test("lost-build-lease-blocks-the-next-controlled-entry-step: every later phase and the signature are awaited outside advisory reporting", async () => {
  for (const stopAt of ["attempt", "AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "GATE", "signing"] as const) {
    const worktree = await createBuildWorktree(fx.repoRoot, {});
    const store = new InMemoryStore();
    const checked: string[] = [];
    const reported: string[] = [];
    try {
      const result = await NodeBuild.buildNodeReal({ spec: fx.spec, worktree, baseSha: worktree.headSha,
        realConfig: resolveBuildConfig(fx.spec)!.config.real!, store, runId: `real-stop-${stopAt}`, signer: fx.signer,
        phasePrompts: fx.prompts, repoRoot: fx.repoRoot, promote: false, incrementId: INCREMENT,
        authorOverride: scriptedAuthors({ [CAPABILITY]: scopeFor(CAPABILITY) })(fx.spec, worktree.root)!,
        beforePhase: async (step) => { checked.push(step); if (step === stopAt) throw new Error(`lost-at-${step}`); },
        onPhase: (phase) => { reported.push(phase); throw new Error("advisory reporter stays advisory"); },
      });
      assert.equal(result.result.ok, false, stopAt);
      if (!result.result.ok) assert.match(result.result.reason, new RegExp(`lost-at-${stopAt}`));
      assert.equal(checked.at(-1), stopAt);
      assert.equal(reported.includes(stopAt), false);
      const events = await store.readEvents();
      assert.equal(events.filter((event) => event.kind === "signing").length, 0);
      if (stopAt === "attempt") assert.equal(events.filter((event) => (event.doc as { event?: string }).event === "attempt").length, 0);
    } finally { await worktree.remove(); }
  }
});

test("lost-build-lease-blocks-the-next-controlled-entry-step: collision and observer failures preserve cleanup before any author call", async () => {
  const base = { spec: fx.spec, worktree: fx.worktree, baseSha: fx.worktree.headSha,
    realConfig: resolveBuildConfig(fx.spec)!.config.real!, store: new InMemoryStore(), runId: "real-cleanup", signer: fx.signer,
    phasePrompts: fx.prompts, repoRoot: fx.repoRoot, promote: false,
    authorOverride: { author: async () => { throw new Error("author-must-not-run"); } } as PhaseAuthor,
  };
  const collision = await NodeBuild.buildNodeReal({ ...base, buildGuardFactory: async () => COLLISION });
  assert.equal(collision.result.ok, false);
  if (!collision.result.ok) {
    assert.equal(collision.result.failedAt, "AUTHOR_TEST");
    assert.deepEqual(collision.result.phasesVisited, []);
    assert.match(collision.result.reason, /real-other-machine.*1234.*456.*LIVE/);
  }
  const events: string[] = [];
  const refused = await NodeBuild.buildNodeReal({ ...base,
    buildGuardFactory: async () => ({ ok: true, runId: base.runId, guard: recordingGuard(events) }),
    buildActivityObserver: { start: async () => { throw new Error("observer-start-failed"); }, stop: async () => { events.push("stop"); } },
  });
  assert.equal(refused.result.ok, false);
  if (!refused.result.ok) assert.match(refused.result.reason, /observer-start-failed/);
  assert.deepEqual(events, ["stop", "release"]);
  await assert.rejects(NodeBuild.buildNodeReal({ ...base,
    buildGuardFactory: async () => ({ ok: true, runId: base.runId, guard: recordingGuard(events) }),
    beforePhase: async () => { throw new Error("lease-lost"); },
    buildActivityObserver: { start: async () => {}, stop: async () => { throw new Error("observer-stop-failed"); } },
  }), /observer-stop-failed/);
  assert.equal(events.filter((event) => event === "release").length, 2);
});

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: the production adapter owns the injected pool and connector", async () => {
  type PoolHandle = Awaited<ReturnType<typeof import("@storytree/library/store").createPool>>;
  const queries: unknown[] = [];
  const pool = { query: async (...args: unknown[]) => { queries.push(args); return { rows: [] }; } } as PoolHandle["pool"];
  const connector = {} as PoolHandle["connector"];
  const closed: unknown[] = [];
  const handle = await NodeBuild.openPgClaimStore(async () => ({ pool, connector }), async (...args) => { closed.push(args); });
  assert.ok(handle.store instanceof PgClaimStore);
  assert.equal(await handle.store.current("build:cap-a"), null);
  assert.equal(queries.length, 1, "the real claim adapter must query the pool it opened");
  await handle.close();
  assert.deepEqual(closed, [[pool, connector]], "cleanup closes both resources from the same open");
});

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: the real lazy read adapter refuses corpus and ledger access in a test process", async () => {
  // Serialize the actual witness into an isolated Node process so its explicit test environment
  // cannot affect sibling suites. Both handles use the production adapter, with no store mock.
  async function exerciseLiveReads(moduleUrl: string): Promise<void> {
    const { default: childAssert } = await import("node:assert/strict");
    const { liveInnerLoopReads } = await import(moduleUrl) as typeof NodeBuild;
    const unopened = liveInnerLoopReads();
    await unopened.close();
    const reads = liveInnerLoopReads();
    try {
      await childAssert.rejects(reads.corpus.getDoc("fixture-increment"), /live store refused: this is a test process/);
      await childAssert.rejects(reads.ledger.readEvents({ id: "fixture-unit" }), /live store refused: this is a test process/);
    } finally {
      await reads.close();
    }
  }
  await promisify(execFile)("node", [
    "--import", new URL("../../../scripts/tsx-cache-off.mjs", import.meta.url).href,
    "--import", "tsx", "--input-type=module", "--eval",
    `await (${exerciseLiveReads.toString()})(${JSON.stringify(new URL("./node-build.ts", import.meta.url).href)});`,
  ], {
    cwd: fileURLToPath(new URL(".", import.meta.url)),
    timeout: 15_000,
    // No inherited live-store credential or door can change which refusal this proves. Even if the
    // test-process wall regresses, a malformed instance name cannot reach the live Cloud SQL store.
    env: { PATH: process.env["PATH"], NODE_ENV: "test", STORYTREE_DB_LIVE: "0",
      STORYTREE_ALLOW_DATA_PLANE: "1", STORYTREE_STORE_URL: "",
      STORYTREE_SECRETS_FILE: path.join(fx.repoRoot, "absent-secrets.json"),
      STORYTREE_INSTANCE_CONNECTION_NAME: "not-an-instance-connection-name" },
  });
});

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: read-handle ownership and factory errors remain fail closed without live resources", async () => {
  for (const injected of [false, true]) {
    for (const failure of [undefined, new Error("factory-error"), "factory-string-error"] as const) {
      const events: string[] = [];
      const reads = { corpus: fx.corpus, ledger: new InMemoryStore() };
      const result = await NodeBuild.preflightGuardedPaidBuild({ incrementId: INCREMENT, unitIds: [CAPABILITY], revise: false,
        runId: "real-reads", reads: injected ? reads : undefined,
        openReads: () => { events.push("open"); return { ...reads, close: async () => { events.push("close"); } }; },
        factory: async ({ runId }) => {
          events.push("acquire");
          if (failure !== undefined) throw failure;
          return { ok: true, runId, guard: recordingGuard(events) };
        },
        acquired: () => { events.push("held"); },
      });
      assert.deepEqual(events, [...(injected ? [] : ["open"]), "acquire", ...(failure === undefined ? ["held"] : []), ...(injected ? [] : ["close"])]);
      assert.equal(result.ok, failure === undefined);
      if (result.ok) {
        assert.equal(result.preflight.ok, true);
        assert.equal(result.preflight.incrementId, INCREMENT);
        assert.ok(result.preflight.ledgers.has(CAPABILITY));
      } else {
        assert.deepEqual(result.refusal, { ok: false, body: failure instanceof Error ? failure.message : failure, next: [] });
      }
    }
  }
  const events: string[] = [];
  const refused = await NodeBuild.preflightGuardedPaidBuild({ incrementId: INCREMENT, unitIds: [CAPABILITY], revise: false,
    runId: "real-reads", reads: undefined, factory: async () => COLLISION,
    acquired: () => { throw new Error("a conflict acquires nothing"); },
    openReads: () => ({ corpus: fx.corpus, ledger: new InMemoryStore(), close: async () => { events.push("close"); } }),
  });
  assert.equal(refused.ok, false);
  if (!refused.ok) assert.deepEqual(refused.refusal.next, []);
  assert.deepEqual(events, ["close"]);
});

test("paid-build-activity-stamps-only-observed-source-test-or-phase-progress: REAL entry filters declared paths and cancels the actual observer before releasing", async () => {
  for (const edited of ["cap-a.ts", "cap-a.test.ts", "unrelated.ts"]) {
    const worktree = await createBuildWorktree(fx.repoRoot, {});
    const events: string[] = [];
    const observations: Date[] = [];
    const baseline = new Date("2026-01-01T00:00:00Z");
    const advanced = new Date("2026-01-02T00:00:00Z");
    const token = { unref() {} } as ReturnType<typeof setInterval>;
    let cleared = 0;
    try {
      await mkdir(path.join(worktree.root, "packages/fixture"), { recursive: true });
      for (const file of ["cap-a.ts", "cap-a.test.ts", "unrelated.ts"]) {
        const target = path.join(worktree.root, "packages/fixture", file);
        await writeFile(target, "export {};\n");
        await utimes(target, baseline, baseline);
      }
      const result = await NodeBuild.buildNodeReal({ spec: fx.spec, worktree, baseSha: worktree.headSha,
        realConfig: resolveBuildConfig(fx.spec)!.config.real!, store: new InMemoryStore(), runId: "real-mtime", signer: fx.signer,
        phasePrompts: fx.prompts, repoRoot: fx.repoRoot, promote: false,
        authorOverride: { author: async () => { throw new Error("offline author must not run past entry tripwire"); } },
        buildGuardFactory: async ({ runId }) => ({ ok: true, runId, guard: {
          assertHeld: async () => {}, noteActivity: async (at) => { observations.push(at); }, release: async () => { events.push("release"); },
        } }),
        buildActivityFactory: (input) => createBuildActivityObserver({ ...input, timers: {
          setInterval: (() => token) as typeof setInterval,
          clearInterval: ((actual) => { assert.equal(actual, token); cleared++; events.push("cancel"); }) as typeof clearInterval,
        } }),
        buildActivityObserver: {
          start: async () => { const target = path.join(worktree.root, "packages/fixture", edited); await utimes(target, advanced, advanced); },
          stop: async () => { events.push("observer-stop"); },
        },
        beforePhase: async (step) => { if (step === "entry") throw new Error("entry-tripwire"); },
      });
      assert.equal(result.result.ok, false);
      if (!result.result.ok) assert.match(result.result.reason, /entry-tripwire/);
      assert.deepEqual(observations, edited === "unrelated.ts" ? [] : [advanced]);
      assert.equal(cleared, 1, "the observer's actual timer must be cancelled before lease release");
      assert.deepEqual(events, ["cancel", "observer-stop", "release"]);
    } finally { await worktree.remove(); }
  }
});

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: admitted public node entry carries the exact held guard and run into an offline REAL builder", async () => {
  let acquiredRun = "";
  let builderEntered = false;
  const events: string[] = [];
  const guard: BuildGuard = {
    assertHeld: async () => { if (!builderEntered) throw new Error("offline builder was not selected"); events.push("held"); },
    noteActivity: async () => {}, release: async () => { events.push("release"); },
  };
  const result = await NodeBuild.nodeBuild(CAPABILITY, { dryRun: false, real: true, actor: "tester@example.com",
    repoRoot: fx.repoRoot, storiesDir: fx.stories, corpusStore: fx.corpus, increment: INCREMENT, verdictStore: "memory",
    attemptsDir: path.join(fx.repoRoot, ".fixture-attempts"), escalationsDir: path.join(fx.repoRoot, ".fixture-escalations"), holdsDir: path.join(fx.repoRoot, ".fixture-holds"),
    innerLoopReads: { corpus: fx.corpus, ledger: new InMemoryStore() }, progress: silentBuildProgress(),
    buildGuardFactory: async ({ runId, unitIds }) => { assert.deepEqual(unitIds, [CAPABILITY]); acquiredRun = runId; return { ok: true, runId, guard }; },
    realNodeBuilder: async (args) => {
      assert.equal(args.buildGuard, guard);
      assert.equal(args.runId, acquiredRun);
      builderEntered = true;
      return NodeBuild.buildNodeReal({ ...args, promote: false,
        authorOverride: scriptedAuthors({ [CAPABILITY]: scopeFor(CAPABILITY) })(args.spec, args.worktree.root)!,
      });
    },
  });
  assert.equal(result.ok, true, result.body);
  assert.match(acquiredRun, /^real-[0-9a-f-]{36}$/);
  assert.ok(builderEntered);
  assert.ok(events.includes("held"));
  assert.equal(events.filter((event) => event === "release").length, 1);
  assert.equal(events.at(-1), "release");
  assert.match(result.body, new RegExp(acquiredRun));
});

test("lost-build-lease-blocks-the-next-controlled-entry-step: a story member receives the same guard and mandatory callback", async () => {
  let lost = false;
  let callbackChecked = false;
  let releases = 0;
  const guard: BuildGuard = {
    assertHeld: async () => { if (lost) throw new Error("member-lease-lost"); }, noteActivity: async () => {}, release: async () => { releases++; },
  };
  const result = await StoryBuild.storyBuild("fix-story", { dryRun: false, real: true, actor: "tester@example.com",
    repoRoot: fx.repoRoot, storiesDir: fx.stories, corpusStore: fx.corpus, increment: INCREMENT, verdictStore: "memory",
    innerLoopReads: { corpus: fx.corpus, ledger: new InMemoryStore() }, progress: silentBuildProgress(),
    buildGuardFactory: async ({ runId }) => ({ ok: true, runId, guard }),
    authorOverride: () => ({ author: async () => { throw new Error("offline member author must not run"); } }),
    realNodeBuilder: async (args) => {
      assert.equal(args.buildGuard, guard);
      assert.ok(args.beforePhase);
      lost = true;
      await assert.rejects(args.beforePhase("IMPLEMENT"), /member-lease-lost/);
      callbackChecked = true;
      return { result: { ok: false, failedAt: "IMPLEMENT", phasesVisited: [], reason: "member-lease-lost" } };
    },
  });
  assert.equal(result.ok, false);
  assert.match(result.body, /member-lease-lost/);
  assert.equal(callbackChecked, true);
  assert.equal(releases, 1);
});

test("lost-build-lease-blocks-the-next-controlled-entry-step: signed-pass and both promotion paths stop at the awaited checkpoint", async () => {
  for (const stage of ["signed-pass", "promotion", "forensics"] as const) {
    const worktree = await createBuildWorktree(fx.repoRoot, {});
    const store = new InMemoryStore();
    const steps: string[] = [];
    const config = resolveBuildConfig(fx.spec)!.config.real!;
    const realConfig = stage === "forensics" ? { ...config, install: true, typecheck: { file: process.execPath, args: ["-e", "process.exit(7)"] } } : config;
    try {
      const result = await NodeBuild.buildNodeReal({ spec: fx.spec, worktree, baseSha: worktree.headSha, realConfig,
        store, runId: `real-stop-${stage}`, signer: fx.signer, phasePrompts: fx.prompts, repoRoot: fx.repoRoot,
        promote: stage !== "signed-pass", incrementId: INCREMENT,
        authorOverride: scriptedAuthors({ [CAPABILITY]: scopeFor(CAPABILITY) })(fx.spec, worktree.root)!,
        beforePhase: async (step) => { steps.push(step); if (step === (stage === "signed-pass" ? "signed-pass" : "promotion")) throw new Error(`lost-before-${stage}`); },
      });
      assert.equal(result.result.ok, false);
      if (!result.result.ok) assert.match(result.result.reason, new RegExp(`lost-before-${stage}`));
      assert.equal(steps.at(-1), stage === "signed-pass" ? "signed-pass" : "promotion");
      assert.equal(result.promotion, undefined);
      assert.equal(result.forensicPreservation, undefined);
      if (stage === "signed-pass") assert.equal((await store.readEvents()).filter((event) => (event.doc as { event?: string }).event === "signed-pass").length, 0);
    } finally { await worktree.remove(); }
  }
});

test("node-paid-admission-holds-a-run-lease-before-policy-or-spend: synthetic node and story controls retain their named run and acquire no paid lease", async () => {
  const opts = { dryRun: true, actor: "tester@example.com", repoRoot: fx.repoRoot, storiesDir: fx.stories,
    progress: silentBuildProgress(), buildGuardFactory: async () => { throw new Error("synthetic walk cannot open a paid lease"); } };
  const node = await NodeBuild.nodeBuild(CAPABILITY, opts);
  const story = await StoryBuild.storyBuild("fix-story", { ...opts, curatorRunner: new ScriptedCuratorRunner() });
  assert.equal(node.ok, true, node.body);
  assert.equal(story.ok, true, story.body);
  assert.match(node.body, /run:\s+dry-run-[a-z0-9]+/);
  assert.match(story.body, /run:\s+story-dry-run-[a-z0-9]+/);
});
