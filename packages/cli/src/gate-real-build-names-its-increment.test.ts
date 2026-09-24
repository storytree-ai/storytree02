import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { Store } from "@storytree/storage-protocol";
import { INNER_LOOP_EVENT_KIND } from "@storytree/proof-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import { FileToolExecutor, FILE_WRITE_TOOLS } from "@storytree/agent";
import type { PhaseAuthor } from "@storytree/agent";
import {
  appendInnerLoopEvent,
  OwnedLoopAuthor,
  PathWriteScope,
  scriptedWriterModel,
} from "@storytree/orchestrator";
import type { DecisionFork, NodeSpec } from "@storytree/orchestrator";
import type { ReliabilityGate } from "@storytree/library";
import {
  innerLoopRefusalEnvelope,
  preflightInnerLoop,
  renderInnerLoopEntryState,
  resolveBuildIncrement,
} from "@storytree/drive";
import type { BuildGuardFactory, BuildProgress, EnsureDbResult } from "@storytree/drive";

// The module under test, reached only through the namespace (ADR-0057 C): `gateRetryCommand` and the
// increment/innerLoopReads wiring inside `driveBuildTestsGate` do not exist / are ignored at HEAD.
import * as GateDriver from "./gate-build-driver.js";
import { makeGateDeps, type GateDriverSeams } from "./commands.js";

/**
 * ADR-0576 — a REAL build-tests gate drive names a live increment and passes the gate's attempt
 * policy before spend (`gate-real-build-names-its-increment`). This file drives the production
 * `driveBuildTestsGate` over the offline R2 fixture `gate-build-driver.test.ts` already builds — the
 * same collaborators, copied here rather than imported (importing a test file would register its
 * tests in THIS proof, ADR-0057 C).
 */

// ── fixtures copied from gate-build-driver.test.ts (never import another test file) ────────────────

/**
 * The corpus the leaf's per-phase system prompts render from, INJECTED rather than opened.
 *
 * A `--real` / `--live` build renders `red-builder` / `green-builder` out of the Library
 * (ADR-0051 §4), and since ADR-0302 D1 the default source for that is the LIVE store. ADR-0302 D3
 * keeps `STORYTREE_DB_USER` out of `pnpm -r test`, so without this seam these cases are green on a
 * box that happens to hold credentials and red in CI — for a reason unrelated to what they assert.
 */
async function fixtureCorpus(): Promise<InMemoryStore> {
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  return corpus;
}

/** The gate's corpus, plus the increment rows ADR-0576's preflight resolves against. */
async function fixtureCorpusWithIncrements(): Promise<InMemoryStore> {
  const corpus = await fixtureCorpus();
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

const execFileP = promisify(execFile);
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout;
}

// Fixture source lives under a concrete package dir so the spec-borne write-scope globs satisfy the
// ADR-0087 structural bound (a glob must stay within one `packages/<pkg>/`). `.mjs` is ESM regardless
// of package.json, and the proof command `node --test` (no path) discovers `**/*.test.mjs` recursively
// from the worktree root — the whole-package-suite regression wall (ADR-0098 d.2).
const FIXTURE_DIR = "packages/fixture";
const SOURCE_FILE = `${FIXTURE_DIR}/calc.mjs`;
const TEST_FILE = `${FIXTURE_DIR}/double.test.mjs`;

/** A throwaway git repo: correct-but-unseam'd source + a pre-existing GREEN sibling test (the wall). */
async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "storytree-gate-r2-"));
  await git(["init", "-b", "main"], root);
  await git(["config", "user.email", "fixture@storytree.invalid"], root);
  await git(["config", "user.name", "fixture"], root);
  await mkdir(path.join(root, FIXTURE_DIR), { recursive: true });
  // EXISTING + CORRECT: the doubling is inline in run(); there is no `double` seam to import yet.
  await writeFile(
    path.join(root, SOURCE_FILE),
    "export function run() {\n  const out = [];\n  for (const n of [1, 2, 3]) out.push(n * 2);\n  return out;\n}\n",
  );
  // The pre-existing GREEN sibling — the regression-wall sentinel the whole-suite proof must keep green.
  await writeFile(
    path.join(root, `${FIXTURE_DIR}/run.test.mjs`),
    'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { run } from "./calc.mjs";\ntest("run doubles 1..3", () => assert.deepEqual(run(), [2, 4, 6]));\n',
  );
  await git(["add", "-A"], root);
  await git(["-c", "commit.gpgsign=false", "commit", "-m", "fixture: existing calc (no seam)"], root);
  return root;
}

/** A stories dir holding ONE referenced R2 build node (`seed-runner`) under a story dir. */
async function fixtureStories(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "storytree-gate-r2-stories-"));
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

/** The scripted R2 leaf: a structural-seam red test, then a behaviour-preserving refactor. */
const SEAM_TEST =
  'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
  'import { double } from "./calc.mjs";\ntest("double doubles", () => assert.equal(double(3), 6));\n';
const REFACTORED =
  "export function double(n) {\n  return n * 2;\n}\n" +
  "export function run() {\n  return [1, 2, 3].map(double);\n}\n";

function scriptedR2Author(_spec: NodeSpec, worktreeRoot: string): PhaseAuthor {
  return new OwnedLoopAuthor({
    model: scriptedWriterModel([
      { path: TEST_FILE, content: SEAM_TEST }, // AUTHOR_TEST: the missing-seam (structural) red
      { path: SOURCE_FILE, content: REFACTORED }, // IMPLEMENT: behaviour-preserving refactor
    ]),
    tools: new FileToolExecutor({ rootDir: worktreeRoot }),
    scope: new PathWriteScope({ testGlobs: [TEST_FILE], sourceGlobs: [SOURCE_FILE] }),
    writeTools: FILE_WRITE_TOOLS,
  });
}

const GATE_ID = "fix-story#gate-1";
const CAP_ID = "seed-corpus-scripts";
function buildTestsGate(over: Partial<ReliabilityGate> = {}): ReliabilityGate {
  return {
    id: GATE_ID,
    title: "Seed orchestration gets a tested seam",
    kind: "build-tests",
    covers: [CAP_ID],
    buildNode: "seed-runner",
    retired: false,
    ...over,
  };
}

/** A routine within-pocket fork (trips none of the three d.5 signals — the leaf owns it) by default. */
function routineFork(over: Partial<DecisionFork> = {}): DecisionFork {
  return {
    id: "test-layout",
    question: "Where should the seam test live?",
    changesPublicSeam: false,
    materiallyDifferentStrategies: false,
    crossCuttingOrIrreversible: false,
    ...over,
  };
}

// ── helpers new to this file (never assert — they only build data/spies a test drives) ─────────────

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
      return { ok: false, reason: "GATE_INCREMENT_TEST_DB_MARKER" };
    },
  };
}

/**
 * An explicit OFFLINE run-lease factory (`gate-build-holds-a-run-lease`) plus what it saw. A drive that
 * resolves a valid increment acquires its run lease before the policy fold, and production's default
 * opens the shared claim store — so every drive here that reaches admission injects this guard.
 */
interface GuardSpy {
  events: string[];
  factory: BuildGuardFactory;
}

function offlineGuard(): GuardSpy {
  const events: string[] = [];
  return {
    events,
    factory: async ({ runId }) => {
      events.push("acquire");
      return {
        ok: true,
        runId,
        guard: {
          assertHeld: async () => {},
          noteActivity: async () => {},
          release: async () => {
            events.push("release");
          },
        },
      };
    },
  };
}

const throwingLedger: Pick<Store, "readEvents"> = {
  readEvents: async () => {
    throw new Error("ledger-down-marker");
  },
};

const attemptEvt = (incrementId: string, runId: string) =>
  ({ event: "attempt" as const, unitId: GATE_ID, incrementId, runId });
const passEvt = (incrementId: string, runId: string) =>
  ({ event: "signed-pass" as const, unitId: GATE_ID, incrementId, runId });

async function seedLedger(
  ...docs: ReadonlyArray<ReturnType<typeof attemptEvt> | ReturnType<typeof passEvt>>
): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  for (const doc of docs) await appendInnerLoopEvent(store, doc);
  return store;
}

const PROMPTS_STAGE = "library agent prompts (red-builder + green-builder, from the live store)";
const PREFLIGHT_STAGE = "inner-loop preflight (the increment and the attempt ledger, before any spend)";
const DB_STAGE = "live-store preflight (probe -> db:up -> wait for connections)";
const DB_MARKER_BODY =
  "gate run --real persists to the live store, but the database could not be brought up:\n" +
  "GATE_INCREMENT_TEST_DB_MARKER";

// ── gate-build-refuses-a-missing-increment-first ────────────────────────────────────────────────

test("gate-build-refuses-a-missing-increment-first: a REAL gate drive with no increment refuses as argument validation, before its prompts render or its decision sweep runs", async () => {
  const stories = await fixtureStories();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    const gate = buildTestsGate();

    for (const increment of [undefined, "   "] as const) {
      for (const forks of [
        [],
        [routineFork({ id: "k", question: "q", changesPublicSeam: true })],
      ] as const) {
        const { progress, stages } = recordingProgress();
        const { ensureDb, calls } = spyEnsureDb();
        const env = await GateDriver.driveBuildTestsGate(gate, "builder@example.com", {
          corpusStore: corpus,
          progress,
          storiesDir: stories,
          repoRoot: ".",
          ensureDb,
          increment,
          innerLoopReads: { corpus, ledger: new InMemoryStore() },
          decisionForks: forks,
        });

        const resolved = await resolveBuildIncrement(corpus, increment);
        assert.equal(
          resolved.ok,
          false,
          `ground truth: increment=${String(increment)} must refuse at resolveBuildIncrement`,
        );
        if (resolved.ok) continue;

        assert.deepEqual(
          env,
          innerLoopRefusalEnvelope(resolved.state),
          `increment=${String(increment)} forks=${forks.length}`,
        );
        assert.deepEqual(stages, [], `increment=${String(increment)} forks=${forks.length}`);
        assert.equal(
          calls.count,
          0,
          `increment=${String(increment)} forks=${forks.length}: ensureDb must never run`,
        );
      }
    }

    // Control (already holds before the change): the existing `(build:)` refusal keeps its
    // precedence over the missing-increment check.
    const noBuildEnv = await GateDriver.driveBuildTestsGate(
      buildTestsGate({ buildNode: undefined }),
      "builder@example.com",
      {
        corpusStore: corpus,
        progress: recordingProgress().progress,
        storiesDir: stories,
        repoRoot: ".",
      },
    );
    assert.equal(noBuildEnv.ok, false);
    assert.match(noBuildEnv.body, /names no build to drive/);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

// ── gate-build-preflights-the-gate-after-the-sweep ──────────────────────────────────────────────

// test-updated (new behaviour): "gate-build-preflights-the-gate-after-the-sweep: an unknown or closed increment, or a gate the attempt policy stops, is refused after the decision sweep and before the database starts" — gate-build-holds-a-run-lease moves the increment resolution and the attempt-policy fold ahead of the prompt render and the decision sweep, under a held run lease (the shared-store admission order); each refusal is now asserted to precede the prompt render, a policy stop to release its lease once, and a key-fork HALT to come after an admitted lease. Every drive injects the explicit offline buildGuardFactory. The database is still never started.
test("gate-build-preflights-the-gate-after-the-sweep: an unknown or closed increment, or a gate the attempt policy stops, is refused after the decision sweep and before the database starts", async () => {
  const stories = await fixtureStories();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    const gate = buildTestsGate();

    // An unresolved key fork still HALTS before the database — but now after the lease is admitted
    // and the policy has passed, and the lease is released once.
    {
      const { progress, stages } = recordingProgress();
      const { ensureDb, calls } = spyEnsureDb();
      const lease = offlineGuard();
      const env = await GateDriver.driveBuildTestsGate(gate, "builder@example.com", {
        corpusStore: corpus,
        progress,
        storiesDir: stories,
        repoRoot: ".",
        ensureDb,
        increment: "inc-live",
        innerLoopReads: { corpus, ledger: new InMemoryStore() },
        buildGuardFactory: lease.factory,
        decisionForks: [
          routineFork({
            id: "runseed-seam",
            question: "Should runSeed inject a Pool, or the built Store + a comment-loader fn?",
            changesPublicSeam: true,
          }),
        ],
      });
      assert.equal(env.ok, false, env.body);
      assert.match(env.body, /HALTED fix-story#gate-1/);
      assert.equal(stages.at(-1), PROMPTS_STAGE, "the sweep follows the prompt render");
      assert.equal(stages.includes(DB_STAGE), false);
      assert.equal(calls.count, 0);
      assert.deepEqual(lease.events, ["acquire", "release"]);
    }

    // An unknown / closed increment, and every attempt-policy stop, refuse AFTER the sweep — never
    // touching ensureDb.
    const decisionLedger = await seedLedger(
      attemptEvt("inc-live", "r1"),
      attemptEvt("inc-live", "r2"),
      attemptEvt("inc-live", "r3"),
    );
    const unresolvedLedger = await seedLedger(attemptEvt("inc-live", "r1"), passEvt("inc-live", "r1"));

    const cases: ReadonlyArray<{ increment: string; ledger: Pick<Store, "readEvents"> }> = [
      { increment: "no-such-increment", ledger: new InMemoryStore() },
      { increment: "inc-closed", ledger: new InMemoryStore() },
      { increment: "inc-live", ledger: decisionLedger },
      { increment: "inc-live", ledger: unresolvedLedger },
      { increment: "inc-live", ledger: throwingLedger },
    ];

    for (const c of cases) {
      const { progress, stages } = recordingProgress();
      const { ensureDb, calls } = spyEnsureDb();
      const lease = offlineGuard();
      const env = await GateDriver.driveBuildTestsGate(gate, "builder@example.com", {
        corpusStore: corpus,
        progress,
        storiesDir: stories,
        repoRoot: ".",
        ensureDb,
        increment: c.increment,
        innerLoopReads: { corpus, ledger: c.ledger },
        buildGuardFactory: lease.factory,
      });

      const resolvedIncrement = await resolveBuildIncrement(corpus, c.increment);
      let expectedState;
      if (!resolvedIncrement.ok) {
        expectedState = resolvedIncrement.state;
        assert.deepEqual(lease.events, [], `increment=${c.increment}: an unresolved increment acquires no lease`);
      } else {
        assert.deepEqual(lease.events, ["acquire", "release"], `increment=${c.increment}: a policy stop releases its lease once`);
        const preflight = await preflightInnerLoop({
          ledger: c.ledger,
          incrementId: resolvedIncrement.incrementId,
          unitIds: [GATE_ID],
          revise: false,
        });
        assert.equal(
          preflight.ok,
          false,
          `ground truth: increment=${c.increment} must refuse the preflight`,
        );
        if (preflight.ok) continue;
        expectedState = preflight.state;
      }

      assert.deepEqual(env, innerLoopRefusalEnvelope(expectedState), `increment=${c.increment}`);
      assert.equal(calls.count, 0, `increment=${c.increment}: ensureDb must never run`);
      assert.equal(stages.includes(PROMPTS_STAGE), false, `increment=${c.increment}: refused before the prompt render`);
      assert.equal(stages.includes(DB_STAGE), false, `increment=${c.increment}`);
    }

    // An empty ledger proceeds to the database preflight, which the injected ensureDb refuses.
    {
      const { progress, stages } = recordingProgress();
      const { ensureDb, calls } = spyEnsureDb();
      const lease = offlineGuard();
      const env = await GateDriver.driveBuildTestsGate(gate, "builder@example.com", {
        corpusStore: corpus,
        progress,
        storiesDir: stories,
        repoRoot: ".",
        ensureDb,
        increment: "inc-live",
        innerLoopReads: { corpus, ledger: new InMemoryStore() },
        buildGuardFactory: lease.factory,
      });
      assert.equal(calls.count, 1);
      assert.equal(env.body, DB_MARKER_BODY);
      assert.ok(stages.includes(PROMPTS_STAGE));
      assert.equal(stages.at(-1), DB_STAGE);
      assert.deepEqual(lease.events, ["acquire", "release"], "a database refusal releases the held lease once");
    }
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

// ── gate-build-records-under-the-gate-id ────────────────────────────────────────────────────────

// test-updated (refactor): "gate-build-records-under-the-gate-id: the walk records its attempt and any signed pass under the gate id, and the envelopes render the entry state that leaves" — each drive injects the explicit offline buildGuardFactory, so the admitted walks hold a hermetic run lease; same claims.
test("gate-build-records-under-the-gate-id: the walk records its attempt and any signed pass under the gate id, and the envelopes render the entry state that leaves", async () => {
  const stories1 = await fixtureStories();
  const repo1 = await fixtureRepo();
  const store1 = new InMemoryStore();
  try {
    const corpus1 = await fixtureCorpusWithIncrements();
    const { progress } = recordingProgress();
    const env = await GateDriver.driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus1,
      progress,
      storiesDir: stories1,
      repoRoot: repo1,
      store: store1,
      promote: false,
      authorOverride: scriptedR2Author,
      increment: "inc-live",
      innerLoopReads: { corpus: corpus1, ledger: store1 },
      buildGuardFactory: offlineGuard().factory,
    });
    assert.equal(env.ok, true, env.body);

    const innerLoopDocs = (await store1.readEvents())
      .filter((e) => e.kind === INNER_LOOP_EVENT_KIND)
      .map((e) => e.doc);
    assert.equal(innerLoopDocs.length, 2, "exactly an attempt then a signed-pass");
    const attemptDoc = innerLoopDocs[0] as {
      event: string;
      unitId: string;
      incrementId: string;
      runId: string;
    };
    assert.equal(attemptDoc.event, "attempt");
    const runId = attemptDoc.runId;
    assert.deepEqual(innerLoopDocs, [
      { event: "attempt", unitId: GATE_ID, incrementId: "inc-live", runId },
      { event: "signed-pass", unitId: GATE_ID, incrementId: "inc-live", runId },
    ]);

    const signedRendered = renderInnerLoopEntryState({ state: "signed", unitId: GATE_ID, runId });
    assert.ok(env.body.includes("increment:   inc-live"));
    assert.ok(env.body.includes(signedRendered.lines[0]!));
    assert.equal(env.next?.[0], `storytree node adjudicate ${GATE_ID} --run ${runId} --pg`);

    // A second drive over the SAME store is refused as an unresolved signed pass — no new doc lands.
    const secondEnv = await GateDriver.driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus1,
      progress,
      storiesDir: stories1,
      repoRoot: repo1,
      store: store1,
      promote: false,
      authorOverride: scriptedR2Author,
      increment: "inc-live",
      innerLoopReads: { corpus: corpus1, ledger: store1 },
      buildGuardFactory: offlineGuard().factory,
    });
    const resolvedSecond = await preflightInnerLoop({
      ledger: store1,
      incrementId: "inc-live",
      unitIds: [GATE_ID],
      revise: false,
    });
    assert.equal(resolvedSecond.ok, false, "ground truth: an unresolved signed pass must refuse");
    if (resolvedSecond.ok) return;
    assert.deepEqual(secondEnv, innerLoopRefusalEnvelope(resolvedSecond.state));
    const docsAfterSecond = (await store1.readEvents()).filter((e) => e.kind === INNER_LOOP_EVENT_KIND);
    assert.equal(docsAfterSecond.length, 2, "the refused second drive must append no new inner-loop doc");
  } finally {
    await rm(stories1, { recursive: true, force: true });
    await rm(repo1, { recursive: true, force: true });
  }

  // A failing walk: the refactor regresses the sibling test, so the whole suite reds → no verdict.
  const stories2 = await fixtureStories();
  const repo2 = await fixtureRepo();
  const store2 = new InMemoryStore();
  try {
    const corpus2 = await fixtureCorpusWithIncrements();
    const { progress } = recordingProgress();
    const REGRESSED =
      "export function double(n) {\n  return n * 2;\n}\n" +
      "export function run() {\n  return [1, 2, 3].map((n) => double(n) + 1);\n}\n";
    const regressingAuthor = (_spec: NodeSpec, worktreeRoot: string): PhaseAuthor =>
      new OwnedLoopAuthor({
        model: scriptedWriterModel([
          { path: TEST_FILE, content: SEAM_TEST },
          { path: SOURCE_FILE, content: REGRESSED },
        ]),
        tools: new FileToolExecutor({ rootDir: worktreeRoot }),
        scope: new PathWriteScope({ testGlobs: [TEST_FILE], sourceGlobs: [SOURCE_FILE] }),
        writeTools: FILE_WRITE_TOOLS,
      });
    const env = await GateDriver.driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus2,
      progress,
      storiesDir: stories2,
      repoRoot: repo2,
      store: store2,
      promote: false,
      authorOverride: regressingAuthor,
      increment: "inc-live",
      innerLoopReads: { corpus: corpus2, ledger: store2 },
      buildGuardFactory: offlineGuard().factory,
    });
    assert.equal(env.ok, false, env.body);

    const innerLoopDocs = (await store2.readEvents())
      .filter((e) => e.kind === INNER_LOOP_EVENT_KIND)
      .map((e) => e.doc);
    assert.equal(innerLoopDocs.length, 1, "only the attempt — the walk never signs");
    const attemptDoc = innerLoopDocs[0] as {
      event: string;
      unitId: string;
      incrementId: string;
      runId: string;
    };
    assert.equal(attemptDoc.event, "attempt");
    const runId = attemptDoc.runId;

    const attemptFailedState = renderInnerLoopEntryState({
      state: "attempt-failed",
      unitId: GATE_ID,
      runId,
      consecutiveFailures: 1,
      remainingGrantCount: 0,
    });
    assert.ok(env.body.includes(attemptFailedState.lines[0]!));
    assert.equal(env.next?.at(-1), `storytree gate run ${GATE_ID} --real --increment inc-live --pg`);
  } finally {
    await rm(stories2, { recursive: true, force: true });
    await rm(repo2, { recursive: true, force: true });
  }
});

// ── gate-build-prints-the-increment ─────────────────────────────────────────────────────────────

test("gate-build-prints-the-increment: every REAL command the gate driver prints names the increment, as its id when known and as a placeholder when not", async () => {
  assert.equal(
    typeof GateDriver.gateRetryCommand,
    "function",
    "gate-build-driver.ts must export gateRetryCommand(gateId, incrementId): string",
  );

  assert.equal(
    GateDriver.gateRetryCommand(GATE_ID, "inc-live"),
    `storytree gate run ${GATE_ID} --real --increment inc-live --pg`,
  );
  assert.equal(
    GateDriver.gateRetryCommand(GATE_ID, undefined),
    `storytree gate run ${GATE_ID} --real --increment <increment-id> --pg`,
  );
  assert.equal(
    GateDriver.gateRetryCommand(GATE_ID, "   "),
    `storytree gate run ${GATE_ID} --real --increment <increment-id> --pg`,
  );

  const env = await GateDriver.driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
    storiesDir: ".",
    repoRoot: ".",
    increment: "inc-live",
    runtime: "other",
  });
  assert.equal(env.ok, false);
  assert.deepEqual(env.next, [`storytree gate run ${GATE_ID} --real --increment inc-live --pg`]);
});

// ── gate-deps-reach-the-increment-check ─────────────────────────────────────────────────────────

test("gate-deps-reach-the-increment-check: the CLI's composed gate driver refuses a REAL gate drive that names no increment", async () => {
  const stories = await fixtureStories();
  try {
    // HERMETIC BY CONSTRUCTION. Every collaborator the composed driver can reach once its argument
    // checks pass is a RECORDING tripwire: it records what was reached and fails the test on the spot.
    // A regression or a mutant that lets a REAL drive past a missing increment therefore fails HERE,
    // by assertion, and never reaches what the production defaults open — the live prompt render, the
    // live increment and ledger reads, the database preflight, the pg verdict store, a worktree of
    // this repository or a live leaf. Before these existed, a red run of this test wrote
    // `fix-story#gate-1` events to the shared work log.
    const reached: string[] = [];
    const trip = (what: string): never => {
      reached.push(what);
      assert.fail(`the composed gate driver reached ${what} for a REAL drive naming no increment`);
    };
    const tripwireStore = (name: string): Store => ({
      upsertDoc: async () => trip(`${name} (upsertDoc)`),
      patchDoc: async () => trip(`${name} (patchDoc)`),
      getDoc: async () => trip(`${name} (getDoc)`),
      queryDocs: async () => trip(`${name} (queryDocs)`),
      deleteDoc: async () => trip(`${name} (deleteDoc)`),
      appendEvent: async () => trip(`${name} (appendEvent)`),
      readEvents: async () => trip(`${name} (readEvents)`),
    });
    const seams: GateDriverSeams = {
      corpusStore: tripwireStore("the leaf-prompt corpus"),
      innerLoopReads: {
        corpus: { getDoc: async () => trip("the before-spend increment lookup") },
        ledger: { readEvents: async () => trip("the before-spend attempt-ledger read") },
      },
      progress: {
        stage: async (name: string) => trip(`the stage "${name}"`),
        note: (detail: string) => trip(`the leaf phase note "${detail}"`),
      },
      ensureDb: async () => trip("the live-store preflight"),
      store: tripwireStore("the verdict store"),
      // A path that does not exist, so even a cut that got this far fails before touching any repository.
      repoRoot: path.join(stories, "no-repository-here"),
      authorOverride: () => trip("the leaf author"),
      promote: false,
    };

    const gateDeps = makeGateDeps({ store: new InMemoryStore() }, { real: true }, stories, seams);
    const drive = gateDeps.driveBuildTestsGate;
    assert.equal(typeof drive, "function", "makeGateDeps must wire a driveBuildTestsGate");
    if (typeof drive !== "function") return;

    const env = await drive(buildTestsGate(), "builder@example.com");

    assert.deepEqual(reached, [], "a REAL drive naming no increment must refuse before any collaborator");
    const resolved = await resolveBuildIncrement(new InMemoryStore(), undefined);
    assert.equal(resolved.ok, false, "ground truth: an absent increment must refuse at resolveBuildIncrement");
    if (resolved.ok) return;
    assert.deepEqual(env, innerLoopRefusalEnvelope(resolved.state));
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

// ── strengthening: the branches the mutation rung found unwitnessed ─────────────────────────────

test("gate-build-prints-the-increment: a drive with no resolvable signer retries with the increment and asks for one", async () => {
  const stories = await fixtureStories();
  const scratch = await mkdtemp(path.join(os.tmpdir(), "storytree-gate-no-signer-"));
  const emptyGitConfig = path.join(scratch, "empty.gitconfig");
  await writeFile(emptyGitConfig, "");
  const keys = ["STORYTREE_SIGNER", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM", "GIT_CEILING_DIRECTORIES"] as const;
  const saved = new Map(keys.map((k) => [k, process.env[k]]));
  const cwd = process.cwd();
  try {
    // No flag, no STORYTREE_SIGNER, and a git with no config naming an email, run from a directory
    // git may not search above: the signer chain has nothing to resolve (ADR-0020 §2: fail closed).
    delete process.env["STORYTREE_SIGNER"];
    process.env["GIT_CONFIG_GLOBAL"] = emptyGitConfig;
    process.env["GIT_CONFIG_NOSYSTEM"] = "1";
    process.env["GIT_CEILING_DIRECTORIES"] = os.tmpdir();
    process.chdir(scratch);
    const env = await GateDriver.driveBuildTestsGate(buildTestsGate(), undefined, {
      storiesDir: stories,
      repoRoot: scratch,
      increment: "inc-live",
    });
    assert.equal(env.ok, false);
    assert.match(env.body, /^no signer resolved — a verdict must be attributable\./);
    assert.deepEqual(env.next, [`storytree gate run ${GATE_ID} --real --increment inc-live --pg --signer <email>`]);
  } finally {
    process.chdir(cwd);
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(scratch, { recursive: true, force: true });
    await rm(stories, { recursive: true, force: true });
  }
});

// test-updated (refactor): "gate-build-preflights-the-gate-after-the-sweep: a gate under a live grant of another kind proceeds, because a gate drive is never a revision run" — injects the explicit offline buildGuardFactory, and asserts the legs it reached (the preflight and the prompt render, ending at the database) without pinning their relative order, which the held-lease admission changes; same claims.
test("gate-build-preflights-the-gate-after-the-sweep: a gate under a live grant of another kind proceeds, because a gate drive is never a revision run", async () => {
  const stories = await fixtureStories();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    const ledger = new InMemoryStore();
    for (const runId of ["r1", "r2", "r3"]) await appendInnerLoopEvent(ledger, attemptEvt("inc-live", runId));
    await appendInnerLoopEvent(ledger, {
      event: "grant",
      unitId: GATE_ID,
      incrementId: "inc-live",
      runId: "r3",
      attempts: 2,
      kind: "fixed-defect",
      difference: "the fixture's defect is fixed",
    });
    const { progress, stages } = recordingProgress();
    const { ensureDb, calls } = spyEnsureDb();
    const env = await GateDriver.driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus,
      progress,
      storiesDir: stories,
      repoRoot: ".",
      ensureDb,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger },
      buildGuardFactory: offlineGuard().factory,
    });
    assert.equal(env.body, DB_MARKER_BODY);
    assert.equal(calls.count, 1);
    assert.ok(stages.includes(PROMPTS_STAGE), stages.join(" | "));
    assert.ok(stages.includes(PREFLIGHT_STAGE), stages.join(" | "));
    assert.equal(stages.at(-1), DB_STAGE);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});
