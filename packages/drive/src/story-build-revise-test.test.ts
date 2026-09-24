import { offlineBuildGuardFactory } from "./real-chain-fixture.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { loadFixtureCorpus } from "@storytree/library/fixture";
import { appendInnerLoopEvent } from "@storytree/orchestrator";
import type { EscalationRecord, TestRevision } from "@storytree/orchestrator";
import { InMemoryStore } from "@storytree/storage-protocol";

import { silentBuildProgress } from "./build-progress.js";
import {
  innerLoopRefusalEnvelope,
  preflightPaidBuild,
  readTestRevision,
  renderRevisingLine,
  writeRevisionRecord,
} from "./node-build.js";
import type { RealBuildArgs, RealBuildResult, RevisionWrite } from "./node-build.js";
import { fixtureRepo, fixtureStories } from "./real-chain-fixture.js";
import { parseStoryRevisionTarget, renderStoryRevisionRecord, storyBuild, storyHelp } from "./story-build.js";
import type { StoryBuildOpts, StoryRealNodeBuilder } from "./story-build.js";
import { ScriptedCuratorRunner } from "./curate.js";

/**
 * `story-and-gate-builds-carry-test-revisions` — a story chain carries ADR-0571's test revision.
 *
 * A chain names ONE member and the prior chain run (`--revise-test <member-id>:<run-id>`), vets it
 * before any spend, threads the record into that member's walk only, hands every member the records
 * directory so its own returned escalation is recorded, and prints a halted member's record path and
 * the exact story re-run. The chain stays ONE unit on the ledger (ADR-0576 D7), so a revision run
 * pairs with the STORY's live grant (ADR-0576 D6).
 *
 * Every chain here walks an injected recording builder over a throwaway fixture repo — no leaf, no
 * proof command, no database.
 */

interface Fixture {
  repoRoot: string;
  stories: string;
  escalationsDir: string;
  corpus: InMemoryStore;
}

interface BuilderCall {
  unitId: string;
  runId: string;
  testRevision: TestRevision | undefined;
  escalationsDir: string | undefined;
}

const DRIVEN = ["cap-a", "cap-b"];

const ESCALATION: EscalationRecord = {
  raised: {
    phase: "IMPLEMENT",
    kind: "unsatisfiable-test",
    statement: "STORY_REVISION_STATEMENT_MARKER",
    assertion: "assert.equal(b(), a() + 1)",
  },
  testId: "b builds on a",
};

let fx!: Fixture;

before(async () => {
  const repo = await fixtureRepo(false);
  const stories = await fixtureStories([
    { id: "cap-a", dependsOn: [] },
    { id: "cap-b", dependsOn: ["cap-a"] },
  ]);
  const escalationsDir = await mkdtemp(path.join(os.tmpdir(), "story-build-revise-test-"));
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  await corpus.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  await corpus.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
  fx = { repoRoot: repo.root, stories, escalationsDir, corpus };
});

after(async () => {
  await rm(fx.repoRoot, { recursive: true, force: true });
  await rm(fx.stories, { recursive: true, force: true });
  await rm(fx.escalationsDir, { recursive: true, force: true });
});

// ── fixture builders (never assert — they only build data for a test to assert against) ─────────

function realChainOpts(extra: {
  reviseTest?: string | undefined;
  ledger?: InMemoryStore;
  realNodeBuilder: StoryRealNodeBuilder;
}): StoryBuildOpts {
  const opts: StoryBuildOpts = {
    // A green chain's DEFAULT is the live SDK curator on the live store, refused in a test process.
    curatorRunner: new ScriptedCuratorRunner(),
    corpusStore: fx.corpus,
    progress: silentBuildProgress(),
    dryRun: false,
    real: true,
    actor: "tester@example.com",
    storiesDir: fx.stories,
    repoRoot: fx.repoRoot,
    verdictStore: "memory",
    increment: "inc-live",
    buildGuardFactory: offlineBuildGuardFactory,
    innerLoopReads: { corpus: fx.corpus, ledger: extra.ledger ?? new InMemoryStore() },
    promote: false,
    escalationsDir: fx.escalationsDir,
    realNodeBuilder: extra.realNodeBuilder,
  };
  opts.reviseTest = extra.reviseTest;
  return opts;
}

function recordingBuilder(
  calls: BuilderCall[],
  outcome: (args: RealBuildArgs) => RealBuildResult,
): StoryRealNodeBuilder {
  return async (args) => {
    calls.push({
      unitId: args.spec.id,
      runId: args.runId,
      testRevision: args.testRevision,
      escalationsDir: args.escalationsDir,
    });
    return outcome(args);
  };
}

function passed(args: RealBuildArgs): RealBuildResult {
  return {
    result: {
      ok: true,
      verdict: {
        unitId: args.spec.id,
        proofMode: "capability",
        outcome: "pass",
        commitSha: args.baseSha,
        signer: args.signer,
        runId: args.runId,
        outputVersion: "v1",
        evidence: [],
        at: "2026-09-17T00:00:00.000Z",
      },
      phasesVisited: ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "GATE"],
    },
    commitSha: args.baseSha,
  };
}

function escalated(write: RevisionWrite): RealBuildResult {
  return {
    result: {
      ok: false,
      failedAt: "CONFIRM_GREEN",
      reason: "the implementer escalated an unsatisfiable test",
      phasesVisited: ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN"],
    },
    revisionWrite: write,
  };
}

/** cap-a passes; cap-b returns `write` as a halting escalation. */
function capBEscalates(write: RevisionWrite): (args: RealBuildArgs) => RealBuildResult {
  return (args) => (args.spec.id === "cap-b" ? escalated(write) : passed(args));
}

async function storyLedgerWithGrant(kind: "fixed-defect" | "revised-test"): Promise<InMemoryStore> {
  const ledger = new InMemoryStore();
  for (const runId of ["r1", "r2", "r3"]) {
    await appendInnerLoopEvent(ledger, { event: "attempt", unitId: "fix-story", incrementId: "inc-live", runId });
  }
  await appendInnerLoopEvent(ledger, {
    event: "grant",
    unitId: "fix-story",
    incrementId: "inc-live",
    runId: "r3",
    attempts: 1,
    kind,
    difference: "a fixture difference",
  });
  return ledger;
}

// ── the handle ───────────────────────────────────────────────────────────────────────────────────

test("parseStoryRevisionTarget: no flag names no target, and member:run names one driven member and its run", () => {
  assert.deepEqual(parseStoryRevisionTarget(undefined, DRIVEN), { ok: true, target: undefined });
  assert.deepEqual(parseStoryRevisionTarget("cap-b:story-real-prior", DRIVEN), {
    ok: true,
    target: { memberId: "cap-b", runId: "story-real-prior" },
  });
});

test("parseStoryRevisionTarget refuses a malformed handle: no colon, a blank member, a blank run, or a second colon", () => {
  for (const value of ["cap-b", ":story-real-prior", "cap-b:", "cap-b:story:real"]) {
    assert.deepEqual(
      parseStoryRevisionTarget(value, DRIVEN),
      {
        ok: false,
        reason:
          "--revise-test on a story chain takes <member-id>:<run-id> — exactly one member the chain " +
          `drives and the prior chain run whose escalation it revises against — not "${value}".`,
      },
      value,
    );
  }
});

test("parseStoryRevisionTarget refuses a member the chain does not drive, naming every member it does drive", () => {
  assert.deepEqual(parseStoryRevisionTarget("cap-z:story-real-prior", DRIVEN), {
    ok: false,
    reason:
      '--revise-test names "cap-z", which this chain does not drive (it drives: cap-a, cap-b) — ' +
      "a story revision revises exactly one of its own members.",
  });
});

test("renderStoryRevisionRecord: nothing recorded renders nothing; a written record names the member, the path and the exact story re-run; an unwritten one names the reason and no command", () => {
  const recordPath = "/records/cap-b/story-real-x.json";
  assert.deepEqual(
    renderStoryRevisionRecord("fix-story", "cap-b", "story-real-x", "claude", undefined, "inc-live"),
    [],
  );
  assert.deepEqual(
    renderStoryRevisionRecord("fix-story", "cap-b", "story-real-x", "claude", { written: true, path: recordPath }, "inc-live"),
    [
      `revision:    cap-b written to ${recordPath} — re-run with: storytree story build fix-story --real --runtime claude --increment inc-live --revise-test cap-b:story-real-x`,
    ],
  );
  assert.deepEqual(
    renderStoryRevisionRecord("fix-story", "cap-b", "story-real-x", "codex", { written: true, path: recordPath }),
    [
      `revision:    cap-b written to ${recordPath} — re-run with: storytree story build fix-story --real --runtime codex --revise-test cap-b:story-real-x`,
    ],
  );
  assert.deepEqual(
    renderStoryRevisionRecord(
      "fix-story",
      "cap-b",
      "story-real-x",
      "claude",
      { written: false, path: recordPath, reason: "EACCES: permission denied" },
      "inc-live",
    ),
    [
      `revision:    cap-b NOT written (${recordPath}): EACCES: permission denied — relay that member's escalation to the owner by hand`,
    ],
  );
});

test("the story help documents --revise-test as a --real-only member:run re-run of one member", () => {
  const lines = storyHelp().body.split("\n");
  const at = lines.indexOf(
    "  --revise-test <member-id>:<run-id>   (--real only) re-run the chain with ONE member's AUTHOR_TEST",
  );
  assert.deepEqual(lines.slice(at, at + 4), [
    "  --revise-test <member-id>:<run-id>   (--real only) re-run the chain with ONE member's AUTHOR_TEST",
    "      leaf briefed from that member's escalation record in the named prior run; every other member",
    "      walks unrevised (ADR-0571). A halted member's record path and this exact re-run are printed.",
    "",
  ]);
});

// ── the chain ────────────────────────────────────────────────────────────────────────────────────

test("a build naming no revision is never stopped by the revision check: a dry run reaches the story's own lookup", async () => {
  const env = await storyBuild("no-such-story", {
    dryRun: true,
    actor: "tester@example.com",
    storiesDir: fx.stories,
    repoRoot: fx.repoRoot,
  });
  assert.deepEqual(env, {
    ok: false,
    body: `no story spec "no-such-story" under ${fx.stories} (looked for no-such-story/story.md).`,
    next: ["storytree story build library --dry-run"],
  });
});

test("story build refuses --revise-test outside --real, pointing at the paid re-run", async () => {
  const env = await storyBuild("fix-story", { dryRun: true, reviseTest: "cap-b:story-real-prior" });
  assert.deepEqual(env, {
    ok: false,
    body:
      "--revise-test is valid only with --real: it re-runs one member of a paid chain as a test " +
      "revision against that member's prior returned escalation (ADR-0571).",
    next: ["storytree story build fix-story --real --increment <increment-id> --revise-test cap-b:story-real-prior"],
  });
});

test("a REAL chain refuses a revision naming a member it does not drive, before any member is built", async () => {
  const calls: BuilderCall[] = [];
  const env = await storyBuild(
    "fix-story",
    realChainOpts({ reviseTest: "cap-z:story-real-prior", realNodeBuilder: recordingBuilder(calls, passed) }),
  );
  assert.deepEqual(env, {
    ok: false,
    body:
      '--revise-test names "cap-z", which this chain does not drive (it drives: cap-a, cap-b) — ' +
      "a story revision revises exactly one of its own members.",
    next: [],
  });
  assert.deepEqual(calls, []);
});

test("a REAL chain refuses a revision whose record is missing, with the record reader's own reason, before any member is built", async () => {
  const expected = readTestRevision(fx.escalationsDir, "cap-b", "story-real-missing");
  assert.equal(expected.ok, false, "ground truth: no record was ever written for this run");
  if (expected.ok) return;

  const calls: BuilderCall[] = [];
  const env = await storyBuild(
    "fix-story",
    realChainOpts({ reviseTest: "cap-b:story-real-missing", realNodeBuilder: recordingBuilder(calls, passed) }),
  );
  assert.deepEqual(env, { ok: false, body: expected.reason, next: [] });
  assert.deepEqual(calls, []);
});

test("a REAL chain threads the named revision into that member ONLY, hands every member the records dir, and prints the halted member's record with the exact re-run", async () => {
  const priorRun = "story-real-prior";
  const written = await writeRevisionRecord(fx.escalationsDir, "cap-b", priorRun, {
    ok: false,
    escalation: ESCALATION,
  });
  assert.deepEqual(written, { written: true, path: path.join(fx.escalationsDir, "cap-b", `${priorRun}.json`) });
  const revision = readTestRevision(fx.escalationsDir, "cap-b", priorRun);
  assert.equal(revision.ok, true, "ground truth: the prior record reads back");
  if (!revision.ok || revision.revision === undefined) return;

  const calls: BuilderCall[] = [];
  const env = await storyBuild(
    "fix-story",
    realChainOpts({
      reviseTest: `cap-b:${priorRun}`,
      realNodeBuilder: recordingBuilder(
        calls,
        capBEscalates({ written: true, path: "/records/cap-b/story-real-next.json" }),
      ),
    }),
  );

  assert.deepEqual(
    calls.map((c) => c.unitId),
    ["cap-a", "cap-b"],
  );
  assert.equal(calls[0]?.testRevision, undefined, "an untargeted member walks unrevised");
  assert.deepEqual(calls[1]?.testRevision, revision.revision, "the named member receives its record");
  assert.deepEqual(
    calls.map((c) => c.escalationsDir),
    [fx.escalationsDir, fx.escalationsDir],
  );
  const runId = calls[1]?.runId;
  assert.equal(env.ok, false, env.body);
  const lines = env.body.split("\n");
  assert.ok(lines.includes(renderRevisingLine(revision.revision).join("")), env.body);
  assert.ok(
    lines.includes(
      `revision:    cap-b written to /records/cap-b/story-real-next.json — re-run with: storytree story build fix-story --real --runtime codex --increment inc-live --revise-test cap-b:${String(runId)}`,
    ),
    env.body,
  );
});

test("a REAL chain with no revision walks every member unrevised, hands each the records dir, and prints an unwritten record's reason", async () => {
  const calls: BuilderCall[] = [];
  const env = await storyBuild(
    "fix-story",
    realChainOpts({
      realNodeBuilder: recordingBuilder(
        calls,
        capBEscalates({ written: false, path: "/records/cap-b/story-real-next.json", reason: "ENOSPC: disk full" }),
      ),
    }),
  );
  assert.deepEqual(
    calls.map((c) => [c.unitId, c.testRevision, c.escalationsDir]),
    [
      ["cap-a", undefined, fx.escalationsDir],
      ["cap-b", undefined, fx.escalationsDir],
    ],
  );
  const lines = env.body.split("\n");
  assert.ok(!lines.some((line) => line.startsWith("revising:")), env.body);
  assert.ok(
    lines.includes(
      "revision:    cap-b NOT written (/records/cap-b/story-real-next.json): ENOSPC: disk full — relay that member's escalation to the owner by hand",
    ),
    env.body,
  );
});

test("a REAL chain's revision run pairs with the STORY's live grant: refused under a fixed-defect grant, a plain run refused under a revised-test grant, admitted when both agree (ADR-0576 D6)", async () => {
  const priorRun = "story-real-granted";
  await writeRevisionRecord(fx.escalationsDir, "cap-b", priorRun, { ok: false, escalation: ESCALATION });
  const unitIds = ["fix-story", "cap-a", "cap-b"];

  const fixedDefect = await storyLedgerWithGrant("fixed-defect");
  const revisedTest = await storyLedgerWithGrant("revised-test");
  const refusals: ReadonlyArray<{ ledger: InMemoryStore; reviseTest: string | undefined; revise: boolean }> = [
    { ledger: fixedDefect, reviseTest: `cap-b:${priorRun}`, revise: true },
    { ledger: revisedTest, reviseTest: undefined, revise: false },
  ];
  for (const c of refusals) {
    const expected = await preflightPaidBuild({
      incrementId: "inc-live",
      unitIds,
      revise: c.revise,
      reads: { corpus: fx.corpus, ledger: c.ledger },
    });
    assert.equal(expected.ok, false, `ground truth: the preflight refuses revise=${String(c.revise)}`);
    if (expected.ok) return;
    const calls: BuilderCall[] = [];
    const env = await storyBuild(
      "fix-story",
      realChainOpts({ reviseTest: c.reviseTest, ledger: c.ledger, realNodeBuilder: recordingBuilder(calls, passed) }),
    );
    assert.deepEqual(env, innerLoopRefusalEnvelope(expected.state), `revise=${String(c.revise)}`);
    assert.deepEqual(calls, [], `revise=${String(c.revise)}`);
  }

  const admittedCalls: BuilderCall[] = [];
  await storyBuild(
    "fix-story",
    realChainOpts({
      reviseTest: `cap-b:${priorRun}`,
      ledger: revisedTest,
      realNodeBuilder: recordingBuilder(
        admittedCalls,
        capBEscalates({ written: true, path: "/records/cap-b/story-real-next.json" }),
      ),
    }),
  );
  assert.deepEqual(
    admittedCalls.map((c) => c.unitId),
    ["cap-a", "cap-b"],
  );
});
