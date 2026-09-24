import { offlineBuildGuardFactory } from "./real-chain-fixture.js";
import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { Store } from "@storytree/storage-protocol";
import { INNER_LOOP_EVENT_KIND, SIGNING_EVENT_KIND } from "@storytree/proof-protocol";
import { appendInnerLoopEvent } from "@storytree/orchestrator";
import type { AuthoringPhase, AuthorResult, PhaseAuthor } from "@storytree/agent";
import type { NodeSpec } from "@storytree/orchestrator";
import { loadFixtureCorpus } from "@storytree/library/fixture";

import {
  resolveBuildIncrement,
  preflightInnerLoop,
  renderInnerLoopEntryState,
} from "./inner-loop-entry.js";
import { innerLoopRefusalEnvelope, renderIncrementLines } from "./node-build.js";
import { silentBuildProgress } from "./build-progress.js";
import type { BuildProgress } from "./build-progress.js";
import type { EnsureDbResult } from "./db-control.js";
import { fixtureRepo, fixtureStories, scriptedAuthors, scopeFor } from "./real-chain-fixture.js";
// Every --real/--live chain here injects a scripted curator: a green chain's DEFAULT is the live SDK
// librarian-curator enacting on the live store, which a test process is refused (`curate.ts`).
import { ScriptedCuratorRunner } from "./curate.js";

// The module under test, reached only through the namespace (ADR-0057 C): the fields this node adds
// (`StoryBuildOpts.increment`, `.innerLoopReads`, `.store`) are structural — at HEAD `storyBuild`
// silently ignores all three and records nothing on the attempt ledger. Every assertion below fails
// on WHAT THE BUILD DID, never on a missing symbol.
import * as StoryBuildModule from "./story-build.js";

/**
 * story-real-chain-names-its-increment (ADR-0575 D1 / ADR-0576 D7): a REAL story chain names a live
 * increment, preflights every unit it drives (the story AND every driven member) in one ledger read
 * before the database starts, records ONE attempt for the story before its first member's walk, and
 * a signed pass only when the chain passed and its promotion ran unwithheld — never per member.
 */

// ── shared fixtures (never assert — they only build data a test asserts against) ────────────────

/** The corpus the leaf's per-phase prompts render from, PLUS the increment rows the preflight reads. */
async function fixtureCorpus(): Promise<InMemoryStore> {
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  await corpus.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  await corpus.upsertDoc({
    id: "inc-closed",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "closed" },
  });
  await corpus.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
  return corpus;
}

/** A refusing `ensureDb` plus the running count of its calls. */
interface EnsureDbSpy {
  calls: { count: number };
  ensureDb: (log: (message: string) => void) => Promise<EnsureDbResult>;
}

function spyEnsureDb(): EnsureDbSpy {
  const calls = { count: 0 };
  return {
    calls,
    ensureDb: async () => {
      calls.count += 1;
      return { ok: false, reason: "STORY_INCREMENT_TEST_DB_MARKER" };
    },
  };
}

/** A progress reporter plus the stage names it recorded, in order. */
interface RecordingProgress {
  progress: BuildProgress;
  stages: string[];
}

function recordingProgress(): RecordingProgress {
  const stages: string[] = [];
  return {
    stages,
    progress: {
      stage: async (name, work) => {
        stages.push(name);
        return work();
      },
      note: () => {},
    },
  };
}

/** A ledger read handle plus a reader of how many times it was read. */
interface CountingLedger {
  ledger: Pick<Store, "readEvents">;
  count: () => number;
}

/** Wraps a ledger's `readEvents` and counts how many times the whole call reads it. */
function countingLedger(inner: Pick<Store, "readEvents">): CountingLedger {
  let calls = 0;
  return {
    ledger: {
      readEvents: async (filter?: { id?: string }) => {
        calls += 1;
        return inner.readEvents(filter);
      },
    },
    count: () => calls,
  };
}

/** An author override plus the running count of every `.author(...)` call it forwarded. */
interface CountingAuthorOverride {
  authorOverride: (spec: NodeSpec, worktreeRoot: string) => PhaseAuthor | undefined;
  calls: { count: number };
}

/** Wraps `scriptedAuthors`, counting every `.author(...)` call across every resolved node. */
function countingAuthorOverride(
  scopes: Record<string, { testGlobs: string[]; sourceGlobs: string[] }>,
): CountingAuthorOverride {
  const base = scriptedAuthors(scopes);
  const calls = { count: 0 };
  return {
    calls,
    authorOverride: (spec, worktreeRoot) => {
      const inner = base(spec, worktreeRoot);
      if (inner === undefined) return undefined;
      return {
        author: async (phase: AuthoringPhase, prompt: string): Promise<AuthorResult> => {
          calls.count += 1;
          return inner.author(phase, prompt);
        },
      };
    },
  };
}

/** An `InMemoryStore` whose `appendEvent` throws for ANY inner-loop event, delegating everything else. */
class ThrowingAttemptAppendStore extends InMemoryStore {
  override async appendEvent(
    e: Parameters<InMemoryStore["appendEvent"]>[0],
  ): ReturnType<InMemoryStore["appendEvent"]> {
    if (e.kind === INNER_LOOP_EVENT_KIND) {
      throw new Error("attempt-append-marker");
    }
    return super.appendEvent(e);
  }
}

/** An `InMemoryStore` whose `appendEvent` throws ONLY for a `signed-pass` inner-loop event. */
class ThrowingSignedPassAppendStore extends InMemoryStore {
  override async appendEvent(
    e: Parameters<InMemoryStore["appendEvent"]>[0],
  ): ReturnType<InMemoryStore["appendEvent"]> {
    if (
      e.kind === INNER_LOOP_EVENT_KIND &&
      typeof e.doc === "object" &&
      e.doc !== null &&
      (e.doc as { event?: unknown }).event === "signed-pass"
    ) {
      throw new Error("signed-pass-append-marker");
    }
    return super.appendEvent(e);
  }
}

const PREFLIGHT_STAGE = "inner-loop preflight (the increment and the attempt ledger, before any spend)";
const DB_STAGE = "live-store preflight (probe -> db:up -> wait for connections)";

/** Extract the `run:  <runId>` line the envelope's own header always carries. Never asserts. */
function envelopeRunId(body: string): string {
  const m = body.match(/^run:\s+(\S+)$/m);
  if (m === null) throw new Error(`expected a "run:" line in the envelope body:\n${body}`);
  return m[1] as string;
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// story-chain-increment-is-real-only
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("story-chain-increment-is-real-only: --increment is refused before any spend without --real, and never disturbs the existing no-increment dry-run", async () => {
  const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  try {
    const expected = {
      ok: false,
      body:
        "--increment is valid only with --real: it names the increment a paid chain attempt is filed " +
        "under on the attempt ledger, and neither --dry-run nor --live records an attempt (ADR-0575 " +
        "D1, ADR-0576 D1).",
      next: ["storytree story build fix-story --real --increment inc-live"],
    };

    const dryRun = await StoryBuildModule.storyBuild("fix-story", {
      dryRun: true,
      increment: "inc-live",
      actor: "tester@example.com",
      storiesDir: stories,
    });
    assert.deepEqual(dryRun, expected, "a --dry-run with --increment must be refused before spend");

    const live = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      live: true,
      increment: "inc-live",
      actor: "tester@example.com",
      storiesDir: stories,
    });
    assert.deepEqual(
      live,
      expected,
      "a --live with --increment must be refused before spend, exactly the same way",
    );

    // Control (already holds before the change): without --increment, the dry-run's body does not
    // contain the increment-is-real-only wording.
    const control = await StoryBuildModule.storyBuild("fix-story", {
      dryRun: true,
      actor: "tester@example.com",
      storiesDir: stories,
    });
    assert.doesNotMatch(control.body, /--increment is valid only/);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// story-chain-preflights-every-unit-before-spend
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("story-chain-preflights-every-unit-before-spend: a REAL chain refuses a missing or dead increment, or any refusing story or member, in one ledger read before the database starts", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const repo = await fixtureRepo(false);
  const corpus = await fixtureCorpus();
  const unitIds = ["fix-story", "cap-a", "cap-b"];
  const baseOpts = {
    curatorRunner: new ScriptedCuratorRunner(),
    dryRun: false,
    real: true,
    actor: "tester@example.com",
    storiesDir: stories,
    repoRoot: repo.root,
    corpusStore: corpus,
    authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a"), "cap-b": scopeFor("cap-b") }),
  };
  try {
    // A missing, blank, unknown, wrong-kind or closed increment refuses before ensureDb runs.
    for (const increment of [undefined, "   ", "no-such-increment", "some-arc", "inc-closed"]) {
      const { calls, ensureDb } = spyEnsureDb();
      const { progress, stages } = recordingProgress();
      const envelope = await StoryBuildModule.storyBuild("fix-story", {
        ...baseOpts,
        increment,
        buildGuardFactory: offlineBuildGuardFactory,
        innerLoopReads: { corpus, ledger: new InMemoryStore() },
        progress,
        ensureDb,
      });

      const resolved = await resolveBuildIncrement(corpus, increment);
      assert.equal(resolved.ok, false, `ground truth: increment=${String(increment)} must refuse`);
      if (resolved.ok) continue;

      assert.deepEqual(
        envelope,
        innerLoopRefusalEnvelope(resolved.state),
        `increment=${String(increment)}`,
      );
      assert.equal(calls.count, 0, `increment=${String(increment)}: ensureDb must never run`);
      assert.deepEqual(stages, [PREFLIGHT_STAGE], `increment=${String(increment)}`);
    }

    // A ledger holding r1-r3 for the STORY itself refuses the whole chain at the decision point.
    {
      const ledger = new InMemoryStore();
      await appendInnerLoopEvent(ledger, { event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId: "r1" });
      await appendInnerLoopEvent(ledger, { event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId: "r2" });
      await appendInnerLoopEvent(ledger, { event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId: "r3" });
      const { calls, ensureDb } = spyEnsureDb();
      const { progress, stages } = recordingProgress();
      const envelope = await StoryBuildModule.storyBuild("fix-story", {
        ...baseOpts,
        increment: "inc-live",
        buildGuardFactory: offlineBuildGuardFactory,
        innerLoopReads: { corpus, ledger },
        progress,
        ensureDb,
      });

      const resolved = await preflightInnerLoop({ ledger, incrementId: "inc-live", unitIds, revise: false });
      assert.equal(
        resolved.ok,
        false,
        "ground truth: three attempts for the story must refuse at the decision point",
      );
      if (resolved.ok) return;
      assert.deepEqual(envelope, innerLoopRefusalEnvelope(resolved.state));
      assert.equal(calls.count, 0);
      assert.deepEqual(stages, [PREFLIGHT_STAGE]);
    }

    // A ledger holding an unresolved signed pass for MEMBER cap-a refuses the whole chain.
    {
      const ledger = new InMemoryStore();
      await appendInnerLoopEvent(ledger, { event: "attempt", unitId: "cap-a", incrementId: "inc-live", runId: "r1" });
      await appendInnerLoopEvent(ledger, { event: "signed-pass", unitId: "cap-a", incrementId: "inc-live", runId: "r1" });
      const { calls, ensureDb } = spyEnsureDb();
      const { progress, stages } = recordingProgress();
      const envelope = await StoryBuildModule.storyBuild("fix-story", {
        ...baseOpts,
        increment: "inc-live",
        buildGuardFactory: offlineBuildGuardFactory,
        innerLoopReads: { corpus, ledger },
        progress,
        ensureDb,
      });

      const resolved = await preflightInnerLoop({ ledger, incrementId: "inc-live", unitIds, revise: false });
      assert.equal(
        resolved.ok,
        false,
        "ground truth: an unresolved signed pass for cap-a must refuse the chain",
      );
      if (resolved.ok) return;
      assert.deepEqual(envelope, innerLoopRefusalEnvelope(resolved.state));
      assert.equal(calls.count, 0);
      assert.deepEqual(stages, [PREFLIGHT_STAGE]);
    }

    // Both refusals at once: ONE envelope naming both, and the ledger is read exactly once.
    {
      const rawLedger = new InMemoryStore();
      await appendInnerLoopEvent(rawLedger, { event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId: "r1" });
      await appendInnerLoopEvent(rawLedger, { event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId: "r2" });
      await appendInnerLoopEvent(rawLedger, { event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId: "r3" });
      await appendInnerLoopEvent(rawLedger, { event: "attempt", unitId: "cap-a", incrementId: "inc-live", runId: "r1" });
      await appendInnerLoopEvent(rawLedger, { event: "signed-pass", unitId: "cap-a", incrementId: "inc-live", runId: "r1" });
      const counting = countingLedger(rawLedger);
      const { calls, ensureDb } = spyEnsureDb();
      const { progress } = recordingProgress();
      const envelope = await StoryBuildModule.storyBuild("fix-story", {
        ...baseOpts,
        increment: "inc-live",
        buildGuardFactory: offlineBuildGuardFactory,
        innerLoopReads: { corpus, ledger: counting.ledger },
        progress,
        ensureDb,
      });

      const resolved = await preflightInnerLoop({
        ledger: rawLedger,
        incrementId: "inc-live",
        unitIds,
        revise: false,
      });
      assert.equal(resolved.ok, false, "ground truth: both refusals fire together");
      if (resolved.ok) return;
      assert.deepEqual(envelope, innerLoopRefusalEnvelope(resolved.state));
      assert.equal(calls.count, 0);
      assert.equal(counting.count(), 1, "the ledger must be read exactly once for the whole chain");
    }

    // An empty ledger proceeds through the preflight to the DB stage.
    {
      const counting = countingLedger(new InMemoryStore());
      const { calls, ensureDb } = spyEnsureDb();
      const { progress, stages } = recordingProgress();
      const envelope = await StoryBuildModule.storyBuild("fix-story", {
        ...baseOpts,
        increment: "inc-live",
        buildGuardFactory: offlineBuildGuardFactory,
        innerLoopReads: { corpus, ledger: counting.ledger },
        progress,
        ensureDb,
      });

      assert.equal(counting.count(), 1, "the ledger is read exactly once");
      assert.equal(calls.count, 1, "a passing preflight must proceed to the DB preflight exactly once");
      assert.equal(
        envelope.body,
        "this build persists to the live store, but the database could not be brought up:\nSTORY_INCREMENT_TEST_DB_MARKER",
      );
      assert.deepEqual(stages, [PREFLIGHT_STAGE, DB_STAGE]);
    }

    // Control (already holds before the change): the existing cheap refusals keep their precedence.
    {
      const noSuchStory = await StoryBuildModule.storyBuild("no-such-story", {
        ...baseOpts,
        increment: undefined,
      });
      assert.match(noSuchStory.body, /^no story spec "no-such-story"/);
    }
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// story-chain-records-one-attempt-for-the-story
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("story-chain-records-one-attempt-for-the-story: a passing chain records exactly one attempt and one signed pass for the STORY, and no member event, once promotion runs unwithheld", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const repo = await fixtureRepo(false);
  const store = new InMemoryStore();
  const corpus = await fixtureCorpus();
  try {
    const env = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      store,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a"), "cap-b": scopeFor("cap-b") }),
    });

    assert.equal(env.ok, true, env.body);
    const runId = envelopeRunId(env.body);

    const events = await store.readEvents();
    const docs = events.filter((e) => e.kind === INNER_LOOP_EVENT_KIND).map((e) => e.doc);
    assert.deepEqual(docs, [
      { event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId },
      { event: "signed-pass", unitId: "fix-story", incrementId: "inc-live", runId },
    ]);

    assert.ok(env.body.includes("increment:   inc-live"));
    const signed = renderInnerLoopEntryState({ state: "signed", unitId: "fix-story", runId });
    for (const line of signed.lines) assert.ok(env.body.includes(line));
    assert.equal(env.next?.[0], signed.next[0]);
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("a REAL chain on an injected verdict store names that store in its header and says its signed verdicts are gone", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const repo = await fixtureRepo(false);
  const store = new InMemoryStore();
  const corpus = await fixtureCorpus();
  try {
    const env = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      store,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a"), "cap-b": scopeFor("cap-b") }),
    });

    assert.equal(env.ok, true, env.body);
    const bodyLines = env.body.split("\n");
    assert.ok(bodyLines.includes("store:       in-memory (injected — nothing persists past this run)"), env.body);
    assert.ok(
      bodyLines.includes("All 2 member verdicts were signed; they landed in an in-memory store and are gone."),
      env.body,
    );
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("story-chain-records-one-attempt-for-the-story: promote:false records only the story's attempt, because its promotion never ran", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const repo = await fixtureRepo(false);
  const store = new InMemoryStore();
  const corpus = await fixtureCorpus();
  try {
    const env = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      store,
      verdictStore: "memory",
      promote: false,
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a"), "cap-b": scopeFor("cap-b") }),
    });

    assert.equal(env.ok, true, env.body);
    const runId = envelopeRunId(env.body);
    const events = await store.readEvents();
    const docs = events.filter((e) => e.kind === INNER_LOOP_EVENT_KIND).map((e) => e.doc);
    assert.deepEqual(docs, [{ event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId }]);
    assert.match(env.body, /attempt failed: fix-story run \S+ — 1 consecutive failure\(s\)/);
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("story-chain-records-one-attempt-for-the-story: a halted chain records only the story's attempt and reports the un-walked member as not-attempted", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-bad", dependsOn: ["cap-a"] },
    { id: "cap-b", dependsOn: ["cap-bad"] },
  ]);
  const repo = await fixtureRepo(false);
  const store = new InMemoryStore();
  const corpus = await fixtureCorpus();
  try {
    const env = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      store,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({
        "cap-a": scopeFor("cap-a"),
        "cap-bad": scopeFor("cap-bad"),
        "cap-b": scopeFor("cap-b"),
      }),
    });

    assert.equal(env.ok, false, env.body);
    const runId = envelopeRunId(env.body);
    const events = await store.readEvents();
    const docs = events.filter((e) => e.kind === INNER_LOOP_EVENT_KIND).map((e) => e.doc);
    assert.deepEqual(docs, [{ event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId }]);
    assert.match(env.body, /attempt failed: fix-story run \S+ — 1 consecutive failure\(s\)/);

    const notAttempted = renderInnerLoopEntryState({ state: "not-attempted", unitId: "cap-b" });
    for (const line of notAttempted.lines) assert.ok(env.body.includes(line));

    assert.ok(!(env.next ?? []).some((n) => n.includes("gh pr create")));
    const next = env.next ?? [];
    assert.equal(next[next.length - 1], "storytree story build fix-story --real --increment inc-live");
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("story-chain-records-one-attempt-for-the-story: a halted chain reports exactly the members after the halted one as not-attempted", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-bad", dependsOn: ["cap-a"] },
    { id: "cap-b", dependsOn: ["cap-bad"] },
  ]);
  const repo = await fixtureRepo(false);
  const store = new InMemoryStore();
  const corpus = await fixtureCorpus();
  try {
    const env = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      store,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({
        "cap-a": scopeFor("cap-a"),
        "cap-bad": scopeFor("cap-bad"),
        "cap-b": scopeFor("cap-b"),
      }),
    });

    assert.equal(env.ok, false, env.body);
    const bodyLines = env.body.split("\n");
    const reportedNotAttempted = (unitId: string): boolean =>
      renderInnerLoopEntryState({ state: "not-attempted", unitId }).lines.every((line) => bodyLines.includes(line));
    assert.deepEqual(
      ["cap-a", "cap-bad", "cap-b"].map(reportedNotAttempted),
      [false, false, true],
      "only the member after the halted cap-bad is not-attempted — the signed cap-a and the halted cap-bad were attempted",
    );
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("story-chain-records-one-attempt-for-the-story: a second chain over a signed-pass store is refused before ensureDb runs", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const repo = await fixtureRepo(false);
  const store = new InMemoryStore();
  const corpus = await fixtureCorpus();
  try {
    const first = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      store,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a"), "cap-b": scopeFor("cap-b") }),
    });
    assert.equal(first.ok, true, first.body);

    const { calls, ensureDb } = spyEnsureDb();
    const { progress, stages } = recordingProgress();
    const second = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      progress,
      ensureDb,
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a"), "cap-b": scopeFor("cap-b") }),
    });

    const resolved = await preflightInnerLoop({
      ledger: store,
      incrementId: "inc-live",
      unitIds: ["fix-story", "cap-a", "cap-b"],
      revise: false,
    });
    assert.equal(
      resolved.ok,
      false,
      "ground truth: the story already holds an unresolved signed pass from the first chain",
    );
    if (resolved.ok) return;
    assert.deepEqual(second, innerLoopRefusalEnvelope(resolved.state));
    assert.equal(calls.count, 0);
    assert.deepEqual(stages, [PREFLIGHT_STAGE]);
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// story-chain-recording-fails-closed
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("story-chain-recording-fails-closed: an unrecordable story attempt refuses the chain before any member walks", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const repo = await fixtureRepo(false);
  const store = new ThrowingAttemptAppendStore();
  const corpus = await fixtureCorpus();
  const { authorOverride, calls } = countingAuthorOverride({
    "cap-a": scopeFor("cap-a"),
    "cap-b": scopeFor("cap-b"),
  });
  try {
    const env = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      store,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride,
    });

    assert.equal(env.ok, false, env.body);
    assert.deepEqual(env.next, ["pnpm db:probe"]);
    assert.match(
      env.body,
      /^inner-loop attempt for fix-story \(run \S+, increment inc-live\) could not be recorded: attempt-append-marker — the chain is refused before its first member's walk \(ADR-0576 D5, D7\)$/,
    );
    assert.equal(calls.count, 0, "no member's leaf may run once the story attempt failed to record");

    const events = await store.readEvents();
    assert.ok(!events.some((e) => e.kind === SIGNING_EVENT_KIND), "the store must hold no signing event");
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

test("story-chain-recording-fails-closed: an unrecordable signed pass is reported without changing the verdict", async () => {
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const repo = await fixtureRepo(false);
  const store = new ThrowingSignedPassAppendStore();
  const corpus = await fixtureCorpus();
  try {
    const env = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: repo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: store },
      store,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a"), "cap-b": scopeFor("cap-b") }),
    });

    assert.equal(env.ok, true, env.body);
    const runId = envelopeRunId(env.body);
    assert.ok(
      env.body.includes(
        `inner loop:  signed, but the signed pass could not be recorded: signed-pass-append-marker — the ledger holds no landing obligation for run ${runId} (ADR-0576 D5)`,
      ),
    );
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo.root, { recursive: true, force: true });
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// story-chain-envelopes-render-the-entry-state
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("story-chain-envelopes-render-the-entry-state: a REAL chain's header, outcome and member lines all come from the one entry-state renderer", async () => {
  // The header's increment line comes straight from renderIncrementLines.
  const passStories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  const passRepo = await fixtureRepo(false);
  const passStore = new InMemoryStore();
  const corpus = await fixtureCorpus();
  try {
    const passEnv = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: passStories,
      repoRoot: passRepo.root,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: passStore },
      store: passStore,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({ "cap-a": scopeFor("cap-a") }),
    });
    assert.equal(passEnv.ok, true, passEnv.body);
    const runId = envelopeRunId(passEnv.body);

    const expectedIncrementLines = renderIncrementLines("inc-live", []);
    assert.deepEqual(expectedIncrementLines, ["increment:   inc-live"]);
    for (const line of expectedIncrementLines) assert.ok(passEnv.body.includes(line));

    const signed = renderInnerLoopEntryState({ state: "signed", unitId: "fix-story", runId });
    for (const line of signed.lines) assert.ok(passEnv.body.includes(line));
    assert.equal(passEnv.next?.[0], signed.next[0]);
  } finally {
    await rm(passStories, { recursive: true, force: true });
    await rm(passRepo.root, { recursive: true, force: true });
  }

  // A halted chain's un-walked member renders through the SAME not-attempted state.
  const haltStories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-bad", dependsOn: ["cap-a"] },
    { id: "cap-b", dependsOn: ["cap-bad"] },
  ]);
  const haltRepo = await fixtureRepo(false);
  const haltStore = new InMemoryStore();
  const haltCorpus = await fixtureCorpus();
  try {
    const haltEnv = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      storiesDir: haltStories,
      repoRoot: haltRepo.root,
      corpusStore: haltCorpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus: haltCorpus, ledger: haltStore },
      store: haltStore,
      verdictStore: "memory",
      progress: silentBuildProgress(),
      authorOverride: scriptedAuthors({
        "cap-a": scopeFor("cap-a"),
        "cap-bad": scopeFor("cap-bad"),
        "cap-b": scopeFor("cap-b"),
      }),
    });
    assert.equal(haltEnv.ok, false, haltEnv.body);
    const notAttempted = renderInnerLoopEntryState({ state: "not-attempted", unitId: "cap-b" });
    for (const line of notAttempted.lines) assert.ok(haltEnv.body.includes(line));
  } finally {
    await rm(haltStories, { recursive: true, force: true });
    await rm(haltRepo.root, { recursive: true, force: true });
  }
});

test("a chain refused an unknown verdict store prints its paid --real retry naming the increment, and its --live retry without one", async () => {
  // Offline: both refusals land at the verdict-store resolution, after the (injected) preflight and
  // prompt render and before any pool, claim, worktree or leaf.
  const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  const corpus = await fixtureCorpus();
  const realProgress = recordingProgress();
  try {
    const real = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      runtime: "claude",
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: stories,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger: new InMemoryStore() },
      verdictStore: "surreal",
      progress: realProgress.progress,
    });
    assert.equal(real.ok, false, real.body);
    assert.match(real.body, /^unknown --store "surreal"/);
    assert.deepEqual(real.next, ["storytree story build fix-story --real --increment <increment-id> --store pg"]);
    assert.deepEqual(realProgress.stages, [
      PREFLIGHT_STAGE,
      "library agent prompts (red-builder + green-builder, from the live store)",
      "verdict store (open the pool, apply the schema)",
    ]);

    const live = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      live: true,
      runtime: "claude",
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: stories,
      corpusStore: corpus,
      verdictStore: "surreal",
      progress: silentBuildProgress(),
    });
    assert.equal(live.ok, false, live.body);
    assert.match(live.body, /^unknown --store "surreal"/);
    assert.deepEqual(live.next, ["storytree story build fix-story --live --store pg"]);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

test("a REAL chain whose member holds a live grant of another kind proceeds, because a chain is never a revision run", async () => {
  const stories = await fixtureStories([{ id: "cap-a", dependsOn: [] }]);
  const corpus = await fixtureCorpus();
  const ledger = new InMemoryStore();
  for (const runId of ["r1", "r2", "r3"]) {
    await appendInnerLoopEvent(ledger, { event: "attempt", unitId: "cap-a", incrementId: "inc-live", runId });
  }
  await appendInnerLoopEvent(ledger, {
    event: "grant",
    unitId: "cap-a",
    incrementId: "inc-live",
    runId: "r3",
    attempts: 2,
    kind: "fixed-defect",
    difference: "the fixture's defect is fixed",
  });
  const { calls, ensureDb } = spyEnsureDb();
  try {
    const envelope = await StoryBuildModule.storyBuild("fix-story", {
      curatorRunner: new ScriptedCuratorRunner(),
      dryRun: false,
      real: true,
      runtime: "claude",
      actor: "tester@example.com",
      storiesDir: stories,
      repoRoot: stories,
      corpusStore: corpus,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus, ledger },
      ensureDb,
      progress: silentBuildProgress(),
    });
    assert.equal(
      envelope.body,
      "this build persists to the live store, but the database could not be brought up:\nSTORY_INCREMENT_TEST_DB_MARKER",
    );
    assert.equal(calls.count, 1, "the preflight admitted the chain, so it went on to the database");
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});
