import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { loadFixtureCorpus } from "@storytree/library/fixture";
import type { ReliabilityGate } from "@storytree/library";
import { appendInnerLoopEvent } from "@storytree/orchestrator";
import type { EscalationRecord, TestRevision } from "@storytree/orchestrator";
import { InMemoryStore } from "@storytree/storage-protocol";
import {
  innerLoopRefusalEnvelope,
  preflightPaidBuild,
  readTestRevision,
  renderRevisingLine,
  silentBuildProgress,
  writeRevisionRecord,
} from "@storytree/drive";
import type {
  BuildGuardFactory,
  RealBuildArgs,
  RealBuildResult,
  RevisionWrite,
  StoryRealNodeBuilder,
} from "@storytree/drive";

import { makeGateDeps } from "./commands.js";
import type { GateDriverSeams } from "./commands.js";
import { driveBuildTestsGate, renderGateRevisionRecord } from "./gate-build-driver.js";
import type { GateBuildDriverDeps } from "./gate-build-driver.js";

/**
 * `story-and-gate-builds-carry-test-revisions` — a build-tests gate drive carries ADR-0571's test
 * revision. Its record is keyed by the GATE id (the id its verdict and ledger use), so a record
 * `node build` wrote for the referenced build node is never read for the gate; it is read before any
 * spend, reaches the drive's AUTHOR_TEST brief, and a failed drive prints its own record and the
 * exact gate re-run. Every drive here walks an injected recording builder — no leaf, no proof command.
 */

const execFileP = promisify(execFile);
async function git(args: string[], cwd: string): Promise<void> {
  await execFileP("git", args, { cwd });
}

const GATE_ID = "fix-story#gate-1";
const BUILD_NODE = "seed-runner";
const FIXTURE_DIR = "packages/fixture";
const SOURCE_FILE = `${FIXTURE_DIR}/calc.mjs`;
const TEST_FILE = `${FIXTURE_DIR}/double.test.mjs`;

const ESCALATION: EscalationRecord = {
  raised: {
    phase: "IMPLEMENT",
    kind: "unsatisfiable-test",
    statement: "GATE_REVISION_STATEMENT_MARKER",
    assertion: "assert.equal(double(3), 6)",
  },
  testId: "double doubles",
};

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

let fx!: Fixture;

before(async () => {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "gate-revise-test-repo-"));
  await git(["init", "-b", "main"], repoRoot);
  await git(["config", "user.email", "fixture@storytree.invalid"], repoRoot);
  await git(["config", "user.name", "fixture"], repoRoot);
  await mkdir(path.join(repoRoot, FIXTURE_DIR), { recursive: true });
  await writeFile(path.join(repoRoot, SOURCE_FILE), "export function run() {\n  return [2, 4, 6];\n}\n");
  await git(["add", "-A"], repoRoot);
  await git(["-c", "commit.gpgsign=false", "commit", "-m", "fixture: calc"], repoRoot);

  const stories = await mkdtemp(path.join(os.tmpdir(), "gate-revise-test-stories-"));
  await mkdir(path.join(stories, "fix-story"), { recursive: true });
  await writeFile(
    path.join(stories, "fix-story", `${BUILD_NODE}.md`),
    [
      "---",
      `id: "${BUILD_NODE}"`,
      "tier: capability",
      'story: "fix-story"',
      'title: "seed runner seam"',
      'outcome: "the seed orchestration gets a tested seam"',
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

  const escalationsDir = await mkdtemp(path.join(os.tmpdir(), "gate-revise-test-records-"));
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  await corpus.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  await corpus.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
  fx = { repoRoot, stories, escalationsDir, corpus };
});

after(async () => {
  await rm(fx.repoRoot, { recursive: true, force: true });
  await rm(fx.stories, { recursive: true, force: true });
  await rm(fx.escalationsDir, { recursive: true, force: true });
});

// ── fixture builders (never assert — they only build data for a test to assert against) ─────────

const gate: ReliabilityGate = {
  id: GATE_ID,
  title: "Seed orchestration gets a tested seam",
  kind: "build-tests",
  covers: ["seed-corpus-scripts"],
  buildNode: BUILD_NODE,
  retired: false,
};

/**
 * An explicit OFFLINE run-lease factory (`gate-build-holds-a-run-lease`): every drive here names a
 * valid increment, which now reaches lease admission before the policy fold, and production's default
 * opens the shared claim store — so each drive injects this no-op guard through {@link gateDeps} or
 * the composed seams.
 */
function offlineGuardFactory(): BuildGuardFactory {
  return async ({ runId }) => ({
    ok: true,
    runId,
    guard: { assertHeld: async () => {}, noteActivity: async () => {}, release: async () => {} },
  });
}

// test-updated (refactor): "a gate revision reaches the drive's build and header, every drive gets the records dir, and a failed drive prints its record with the exact gate re-run" — its drive (via gateDeps) injects the explicit offline buildGuardFactory; same claims.
// test-updated (refactor): "a gate drive with no revision builds unrevised, still hands the build the records dir, and prints an unwritten record's reason" — its drive (via gateDeps) injects the explicit offline buildGuardFactory; same claims.
// test-updated (refactor): "a gate revision run pairs with the gate's live grant: refused under a fixed-defect grant, a plain run refused under a revised-test grant, admitted when both agree (ADR-0576 D6)" — its drives (via gateDeps) inject the explicit offline buildGuardFactory; same claims.
// test-updated (refactor): "a gate revision never aliases the build node: a record written under the build node's id is not found for the gate, before any build" — its drive (via gateDeps) carries the explicit offline buildGuardFactory, never reached before the revision refusal; same claims.
function gateDeps(extra: {
  reviseTest?: string | undefined;
  ledger?: InMemoryStore;
  realNodeBuilder: StoryRealNodeBuilder;
}): GateBuildDriverDeps {
  const deps: GateBuildDriverDeps = {
    corpusStore: fx.corpus,
    progress: silentBuildProgress(),
    storiesDir: fx.stories,
    repoRoot: fx.repoRoot,
    store: new InMemoryStore(),
    promote: false,
    increment: "inc-live",
    innerLoopReads: { corpus: fx.corpus, ledger: extra.ledger ?? new InMemoryStore() },
    escalationsDir: fx.escalationsDir,
    realNodeBuilder: extra.realNodeBuilder,
    buildGuardFactory: offlineGuardFactory(),
  };
  deps.reviseTest = extra.reviseTest;
  return deps;
}

function recordingBuilder(calls: BuilderCall[], write: RevisionWrite): StoryRealNodeBuilder {
  return async (args: RealBuildArgs): Promise<RealBuildResult> => {
    calls.push({
      unitId: args.spec.id,
      runId: args.runId,
      testRevision: args.testRevision,
      escalationsDir: args.escalationsDir,
    });
    return {
      result: {
        ok: false,
        failedAt: "CONFIRM_GREEN",
        reason: "the implementer escalated an unsatisfiable test",
        phasesVisited: ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN"],
      },
      revisionWrite: write,
    };
  };
}

async function gateLedgerWithGrant(kind: "fixed-defect" | "revised-test"): Promise<InMemoryStore> {
  const ledger = new InMemoryStore();
  for (const runId of ["r1", "r2", "r3"]) {
    await appendInnerLoopEvent(ledger, { event: "attempt", unitId: GATE_ID, incrementId: "inc-live", runId });
  }
  await appendInnerLoopEvent(ledger, {
    event: "grant",
    unitId: GATE_ID,
    incrementId: "inc-live",
    runId: "r3",
    attempts: 1,
    kind,
    difference: "a fixture difference",
  });
  return ledger;
}

// ── the render ───────────────────────────────────────────────────────────────────────────────────

test("renderGateRevisionRecord: nothing recorded renders nothing; a written record names its path and the exact gate re-run; an unwritten one names the reason and no command", () => {
  const recordPath = "/records/fix-story#gate-1/gate-real-x.json";
  assert.deepEqual(renderGateRevisionRecord(GATE_ID, "gate-real-x", "claude", undefined, "inc-live"), []);
  assert.deepEqual(
    renderGateRevisionRecord(GATE_ID, "gate-real-x", "claude", { written: true, path: recordPath }, "inc-live"),
    [
      `revision:    written to ${recordPath} — re-run with: storytree gate run fix-story#gate-1 --real --runtime claude --increment inc-live --revise-test gate-real-x --pg`,
    ],
  );
  assert.deepEqual(
    renderGateRevisionRecord(
      GATE_ID,
      "gate-real-x",
      "codex",
      { written: false, path: recordPath, reason: "EACCES: permission denied" },
      "inc-live",
    ),
    [`revision:    NOT written (${recordPath}): EACCES: permission denied — relay the escalation to the owner by hand`],
  );
});

// ── the drive ────────────────────────────────────────────────────────────────────────────────────

test("a gate revision never aliases the build node: a record written under the build node's id is not found for the gate, before any build", async () => {
  const run = "gate-real-aliased";
  await writeRevisionRecord(fx.escalationsDir, BUILD_NODE, run, { ok: false, escalation: ESCALATION });
  const expected = readTestRevision(fx.escalationsDir, GATE_ID, run);
  assert.equal(expected.ok, false, "ground truth: nothing is recorded under the gate id for this run");
  if (expected.ok) return;

  const calls: BuilderCall[] = [];
  const env = await driveBuildTestsGate(
    gate,
    "builder@example.com",
    gateDeps({ reviseTest: run, realNodeBuilder: recordingBuilder(calls, { written: true, path: "/unused" }) }),
  );
  assert.deepEqual(env, { ok: false, body: expected.reason, next: [] });
  assert.deepEqual(calls, []);
});

test("a gate revision reaches the drive's build and header, every drive gets the records dir, and a failed drive prints its record with the exact gate re-run", async () => {
  const priorRun = "gate-real-prior";
  await writeRevisionRecord(fx.escalationsDir, GATE_ID, priorRun, { ok: false, escalation: ESCALATION });
  const revision = readTestRevision(fx.escalationsDir, GATE_ID, priorRun);
  assert.equal(revision.ok, true, "ground truth: the gate's prior record reads back");
  if (!revision.ok || revision.revision === undefined) return;

  const calls: BuilderCall[] = [];
  const env = await driveBuildTestsGate(
    gate,
    "builder@example.com",
    gateDeps({
      reviseTest: priorRun,
      realNodeBuilder: recordingBuilder(calls, { written: true, path: "/records/gate/gate-real-next.json" }),
    }),
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.unitId, GATE_ID, "the drive builds FOR the gate id");
  assert.deepEqual(calls[0]?.testRevision, revision.revision);
  assert.equal(calls[0]?.escalationsDir, fx.escalationsDir);
  assert.equal(env.ok, false, env.body);
  const lines = env.body.split("\n");
  assert.ok(lines.includes(renderRevisingLine(revision.revision).join("")), env.body);
  assert.ok(
    lines.includes(
      `revision:    written to /records/gate/gate-real-next.json — re-run with: storytree gate run fix-story#gate-1 --real --runtime codex --increment inc-live --revise-test ${String(calls[0]?.runId)} --pg`,
    ),
    env.body,
  );
});

// test-updated (refactor): "gate run's dispatch threads --revise-test from argv into the gate drive (makeGateDeps)" — the composed seams carry the explicit offline buildGuardFactory (GateDriverSeams), so the admitted drive never opens the shared claim store; same claims.
test("gate run's dispatch threads --revise-test from argv into the gate drive (makeGateDeps)", async () => {
  const priorRun = "gate-real-dispatched";
  await writeRevisionRecord(fx.escalationsDir, GATE_ID, priorRun, { ok: false, escalation: ESCALATION });
  const revision = readTestRevision(fx.escalationsDir, GATE_ID, priorRun);
  assert.equal(revision.ok, true, "ground truth: the gate's prior record reads back");
  if (!revision.ok) return;

  const calls: BuilderCall[] = [];
  const seams: GateDriverSeams = {
    corpusStore: fx.corpus,
    innerLoopReads: { corpus: fx.corpus, ledger: new InMemoryStore() },
    progress: silentBuildProgress(),
    store: new InMemoryStore(),
    repoRoot: fx.repoRoot,
    promote: false,
    escalationsDir: fx.escalationsDir,
    realNodeBuilder: recordingBuilder(calls, { written: true, path: "/records/gate/gate-real-next.json" }),
    buildGuardFactory: offlineGuardFactory(),
  };
  const gateDeps = makeGateDeps(
    { store: new InMemoryStore() },
    { real: true, increment: "inc-live", "revise-test": priorRun },
    fx.stories,
    seams,
  );
  const drive = gateDeps.driveBuildTestsGate;
  assert.equal(typeof drive, "function", "makeGateDeps must wire a driveBuildTestsGate");
  if (typeof drive !== "function") return;
  await drive(gate, "builder@example.com");

  assert.deepEqual(
    calls.map((c) => c.testRevision),
    [revision.revision],
  );
});

test("a gate drive with no revision builds unrevised, still hands the build the records dir, and prints an unwritten record's reason", async () => {
  const calls: BuilderCall[] = [];
  const env = await driveBuildTestsGate(
    gate,
    "builder@example.com",
    gateDeps({
      realNodeBuilder: recordingBuilder(calls, {
        written: false,
        path: "/records/gate/gate-real-next.json",
        reason: "ENOSPC: disk full",
      }),
    }),
  );
  assert.deepEqual(
    calls.map((c) => [c.unitId, c.testRevision, c.escalationsDir]),
    [[GATE_ID, undefined, fx.escalationsDir]],
  );
  const lines = env.body.split("\n");
  assert.ok(!lines.some((line) => line.startsWith("revising:")), env.body);
  assert.ok(
    lines.includes(
      "revision:    NOT written (/records/gate/gate-real-next.json): ENOSPC: disk full — relay the escalation to the owner by hand",
    ),
    env.body,
  );
});

test("a gate revision run pairs with the gate's live grant: refused under a fixed-defect grant, a plain run refused under a revised-test grant, admitted when both agree (ADR-0576 D6)", async () => {
  const priorRun = "gate-real-granted";
  await writeRevisionRecord(fx.escalationsDir, GATE_ID, priorRun, { ok: false, escalation: ESCALATION });

  const fixedDefect = await gateLedgerWithGrant("fixed-defect");
  const revisedTest = await gateLedgerWithGrant("revised-test");
  const refusals: ReadonlyArray<{ ledger: InMemoryStore; reviseTest: string | undefined; revise: boolean }> = [
    { ledger: fixedDefect, reviseTest: priorRun, revise: true },
    { ledger: revisedTest, reviseTest: undefined, revise: false },
  ];
  for (const c of refusals) {
    const expected = await preflightPaidBuild({
      incrementId: "inc-live",
      unitIds: [GATE_ID],
      revise: c.revise,
      reads: { corpus: fx.corpus, ledger: c.ledger },
    });
    assert.equal(expected.ok, false, `ground truth: the preflight refuses revise=${String(c.revise)}`);
    if (expected.ok) return;
    const calls: BuilderCall[] = [];
    const env = await driveBuildTestsGate(
      gate,
      "builder@example.com",
      gateDeps({
        reviseTest: c.reviseTest,
        ledger: c.ledger,
        realNodeBuilder: recordingBuilder(calls, { written: true, path: "/unused" }),
      }),
    );
    assert.deepEqual(env, innerLoopRefusalEnvelope(expected.state), `revise=${String(c.revise)}`);
    assert.deepEqual(calls, [], `revise=${String(c.revise)}`);
  }

  const admittedCalls: BuilderCall[] = [];
  await driveBuildTestsGate(
    gate,
    "builder@example.com",
    gateDeps({
      reviseTest: priorRun,
      ledger: revisedTest,
      realNodeBuilder: recordingBuilder(admittedCalls, { written: true, path: "/records/gate/gate-real-next.json" }),
    }),
  );
  assert.deepEqual(
    admittedCalls.map((c) => c.unitId),
    [GATE_ID],
  );
});
