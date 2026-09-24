import { offlineBuildGuardFactory } from "./real-chain-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import type { SdkRunInfo } from "@storytree/agent";
import { USAGE_EVENT_KIND } from "@storytree/proof-protocol";
import type { UsageEventDoc } from "@storytree/proof-protocol";
import {
  createBuildWorktree,
  findNodeSpecFile,
  loadNodeSpec,
  resolveBuildConfig,
  resolveSignerFromEnv,
} from "@storytree/orchestrator";
import type { NodeSpec } from "@storytree/orchestrator";

import { silentBuildProgress } from "./build-progress.js";
import { storyBuild } from "./story-build.js";
import { buildNodeReal, renderLeafPhasePrompts } from "./node-build.js";
// Every --real chain here injects a scripted curator: a green chain's DEFAULT is the live SDK
// librarian-curator enacting on the live store, which a test process is refused (`curate.ts`).
import { ScriptedCuratorRunner } from "./curate.js";
import type { LeafSlicesObserver, LiveAuthor } from "./node-build.js";

/** What the drive seam hands an observer — the spy records these verbatim. */
type ObservedSlices = Parameters<LeafSlicesObserver>[0];
import {
  fixtureRepo,
  fixtureStories,
  scriptedAuthors,
  scopeFor,
  cannedLiveAuthor,
  cannedRun,
} from "./real-chain-fixture.js";

/**
 * leaf-slices-observer-activation (capability): a REAL build actually calls its leaf-slices
 * observer with that node's OWN run accounting.
 *
 * This is a REGRESSION test against the CURRENT `story-build.ts` / `node-build.ts` behaviour: at
 * HEAD, `story build --real` and `buildNodeReal` have no `liveAuthorOverride` seam at all — a
 * caller cannot widen a genuinely-authored `--real` node's accounting with a canned
 * {@link SdkRunInfo} array the way `resolveProveSpec`'s `RealResolveOptions.liveAuthorOverride`
 * (ADR-0243 D1, already built in `@storytree/orchestrator`) allows. Every assertion below that
 * depends on `liveAuthorOverride` actually reaching `resolveProveSpec` fails against today's drive
 * — a behaviour assertion (the observer never fires, or the usage event never lands), never a
 * missing-symbol import: `StoryBuildOpts`/`RealBuildArgs` are structural types, so handing them an
 * extra property is not a compile error under `tsx` (the proof command strips types).
 */

/** Type helper: `.doc` off a raw StoreEvent, narrowed for the usage-accounting assertion. */
function asUsageDoc(doc: unknown): UsageEventDoc {
  return doc as UsageEventDoc;
}

/**
 * The corpus the leaf's per-phase system prompts render from, INJECTED rather than opened.
 *
 * A `--real` chain renders `red-builder` / `green-builder` out of the Library (ADR-0051 §4), and
 * since ADR-0302 D1 the default source for that is the live store. ADR-0302 D3 keeps
 * `STORYTREE_DB_USER` out of `pnpm -r test`, so without this these cases would be green on a
 * developer box that happens to hold credentials and red in CI — for a reason that has nothing to
 * do with the leaf-slice accounting they exist to assert.
 */
async function fixtureCorpus(): Promise<InMemoryStore> {
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  // ADR-0576 D7: a REAL story chain now names a live increment before any spend — these fixtures
  // carry an active one so the leaf-slices scenarios below reach their gate walk unchanged.
  await corpus.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  await corpus.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
  return corpus;
}

test("the-leaf-slices-observer-fires-with-the-canned-run-accounting: a --real chain with a liveAuthorOverride invokes onLeafSlices with that node's EXACT canned runs", async () => {
  const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  const repo = await fixtureRepo(false);
  const runs: SdkRunInfo[] = [cannedRun({ costUsd: 0.25 })];
  const calls: ObservedSlices[] = [];
  try {
    const corpus = await fixtureCorpus();
    const env = await storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      corpusStore: corpus,
      progress: silentBuildProgress(), // offline: assert the ENVELOPE, not the liveness chatter
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      verdictStore: "memory", // internal test seam (ADR-0081): in-memory store, no DB
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: new InMemoryStore() },
      promote: false,
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a") }),
      liveAuthorOverride: () => cannedLiveAuthor(runs),
      onLeafSlices: (args) => calls.push(args),
    });

    assert.equal(env.ok, true, env.body);
    assert.equal(calls.length, 1, "onLeafSlices must fire exactly once for the one real node in the chain");
    assert.equal(calls[0]?.unitId, "cap-a", "the observed unit must be the node that actually built");
    assert.deepEqual(
      calls[0]?.runs,
      runs,
      "the observer must receive that node's OWN canned run accounting, unmodified",
    );
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("no-live-author-override-leaves-the-observer-silent: authorOverride alone (no liveAuthorOverride) never invokes onLeafSlices — no fabricated accounting is claimed", async () => {
  const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  const repo = await fixtureRepo(false);
  const calls: ObservedSlices[] = [];
  try {
    const corpus = await fixtureCorpus();
    const env = await storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      corpusStore: corpus,
      progress: silentBuildProgress(), // offline: assert the ENVELOPE, not the liveness chatter
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      verdictStore: "memory",
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: new InMemoryStore() },
      promote: false,
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a") }),
      onLeafSlices: (args) => calls.push(args),
    });

    assert.equal(env.ok, true, env.body);
    assert.equal(
      calls.length,
      0,
      "with no liveAuthorOverride, the accounting-only widening never fires — the observer stays silent",
    );
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("a-canned-live-author-cannot-move-a-verdict: a canned success-shaped run accounting cannot turn a genuinely FAILING node into a signed pass", async () => {
  const stories = await fixtureStories([{ id: "cap-bad", dependsOn: [] }]);
  const repo = await fixtureRepo(false);
  const calls: ObservedSlices[] = [];
  try {
    const corpus = await fixtureCorpus();
    const env = await storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      corpusStore: corpus,
      progress: silentBuildProgress(), // offline: assert the ENVELOPE, not the liveness chatter
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      verdictStore: "memory",
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: new InMemoryStore() },
      promote: false,
      authorOverride: scriptedAuthors({ "cap-bad": scopeFor("cap-bad") }),
      liveAuthorOverride: () => cannedLiveAuthor([cannedRun({ subtype: "success", costUsd: 99 })]),
      onLeafSlices: (args) => calls.push(args),
    });

    // cap-bad's authored impl does NOT satisfy its own test — the chain must HALT regardless of the
    // canned author's "success" accounting claim.
    assert.equal(env.ok, false, "a genuinely failing node must still HALT the chain");
    assert.match(env.body, /HALT/, `expected a HALT outcome, got:\n${env.body}`);
    // The accounting is still reported (PASS and FAIL alike) — it just never gates the verdict.
    assert.equal(calls.length, 1, "the observer still fires for a failing slice — accounting is not proof");
    // `runs` is the LiveRunInfo union (SDK | Codex); `costUsd` discriminates the SDK arm, so this
    // narrows honestly rather than casting past the very type the seam publishes.
    const observed = calls[0]?.runs[0];
    assert.ok(
      observed !== undefined && "costUsd" in observed,
      "the canned SDK slice must reach the observer",
    );
    assert.equal(observed.subtype, "success", "the canned run still claims success");
    assert.equal(observed.costUsd, 99, "the canned cost still rides through");
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("the-canned-accounting-dies-in-the-injected-store: buildNodeReal appends the canned run's usage into the CALLER's own store, never a shared/real one", async () => {
  const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  const repo = await fixtureRepo(false);
  const store = new InMemoryStore();
  const worktree = await createBuildWorktree(repo.root, {});
  try {
    const specFile = findNodeSpecFile(stories, "cap-a");
    assert.ok(specFile !== null, "the fixture cap-a spec must resolve");
    const spec: NodeSpec = loadNodeSpec(specFile as string);
    const resolved = resolveBuildConfig(spec);
    assert.ok(resolved !== null && resolved.config.real !== undefined, "cap-a must carry a real: arm");
    const buildConfig = resolved!.config;
    const signer = resolveSignerFromEnv({ flag: "tester@example.com" });
    assert.equal(signer.ok, true, "the fixture signer must resolve");
    const prompts = await renderLeafPhasePrompts(await fixtureCorpus());
    assert.equal(prompts.ok, true, "the Library leaf prompts must render");
    const author = scriptedAuthors({ "cap-a": scopeFor("cap-a") })(spec, worktree.root);
    assert.ok(author !== undefined, "the scripted author must resolve for cap-a");
    const runs: SdkRunInfo[] = [cannedRun({ costUsd: 0.42 })];
    const canned: LiveAuthor = cannedLiveAuthor(runs);

    const built = await buildNodeReal({
      spec,
      worktree,
      baseSha: worktree.headSha,
      realConfig: buildConfig.real!,
      store,
      runId: "leaf-slices-store-test",
      signer: (signer as { ok: true; signer: string }).signer,
      phasePrompts: (prompts as { ok: true; prompts: never }).prompts,
      repoRoot: repo.root,
      promote: false,
      authorOverride: author,
      liveAuthorOverride: canned,
    });

    assert.equal(built.result.ok, true, "the real red→green must still pass on its own merits");

    const events = await store.readEvents();
    const usageDocs = events
      .filter((e) => e.kind === USAGE_EVENT_KIND)
      .map((e) => asUsageDoc(e.doc))
      .filter((d) => d.unitId === "cap-a" && d.runId === "leaf-slices-store-test");

    assert.equal(
      usageDocs.length,
      1,
      "the canned run's accounting must be appended into the CALLER-injected store, and only there",
    );
    assert.equal(
      usageDocs[0]?.costUsd,
      0.42,
      "the exact canned cost must ride through into the persisted usage doc",
    );
  } finally {
    await worktree.remove();
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("each-chained-node-reports-its-own-slices: a two-node --real chain reports EACH node's own canned accounting once, never swapped or reused", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const repo = await fixtureRepo(false);
  const perNodeRuns: ReadonlyMap<string, SdkRunInfo[]> = new Map([
    ["cap-a", [cannedRun({ costUsd: 0.11 })]],
    ["cap-b", [cannedRun({ costUsd: 0.22 })]],
  ]);
  const factoryCalls: string[] = [];
  const liveAuthorOverride = (spec: NodeSpec): LiveAuthor | undefined => {
    factoryCalls.push(spec.id);
    const runs = perNodeRuns.get(spec.id);
    return runs === undefined ? undefined : cannedLiveAuthor(runs);
  };
  const calls: ObservedSlices[] = [];
  try {
    const corpus = await fixtureCorpus();
    const env = await storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      corpusStore: corpus,
      progress: silentBuildProgress(), // offline: assert the ENVELOPE, not the liveness chatter
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      verdictStore: "memory",
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: new InMemoryStore() },
      promote: false,
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a"), "cap-b": scopeFor("cap-b") }),
      liveAuthorOverride,
      onLeafSlices: (args) => calls.push(args),
    });

    assert.equal(env.ok, true, env.body);
    assert.equal(calls.length, 2, "the observer must fire exactly once per chained node");
    const byId = new Map(calls.map((c) => [c.unitId, c.runs]));
    assert.deepEqual(byId.get("cap-a"), perNodeRuns.get("cap-a"), "cap-a must report ONLY its own canned run");
    assert.deepEqual(
      byId.get("cap-b"),
      perNodeRuns.get("cap-b"),
      "cap-b must report ITS OWN canned run, never cap-a's",
    );
    assert.deepEqual(
      factoryCalls,
      ["cap-a", "cap-b"],
      "the stateful liveAuthorOverride factory must be resolved exactly ONCE per node, in chain order",
    );
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});
