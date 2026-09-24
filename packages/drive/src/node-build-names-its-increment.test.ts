import { offlineBuildGuardFactory } from "./real-chain-fixture.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

import { InMemoryStore, type Store, type StoreEvent } from "@storytree/storage-protocol";
import {
  appendInnerLoopEvent,
  loadNodeSpec,
  proveUnit,
  ShellTestExecutor,
} from "@storytree/orchestrator";
import type { AuthorResult, AuthoringPhase, PhaseAuthor } from "@storytree/agent";
import type { ClaimDocT } from "@storytree/notice-board";
import type { ProveResult, ProveSpec, TreeState } from "@storytree/orchestrator";
import { parseAuthoringEscalation } from "@storytree/agent";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import {
  preflightInnerLoop,
  renderInnerLoopEntryState,
  resolveBuildIncrement,
  type InnerLoopRefusedState,
} from "./inner-loop-entry.js";
import { fixtureRepo, fixtureStories } from "./real-chain-fixture.js";
import type { BuildProgress } from "./build-progress.js";
import type { EnsureDbResult } from "./db-control.js";

// The module under test, reached only through the namespace (ADR-0057 C): this node's new exports
import * as NodeBuildModule from "./node-build.js";

// (`innerLoopRefusalEnvelope`, `renderIncrementLines`, `renderInnerLoopOutcome`,
// `nodeBuildRetryCommand`, `liveInnerLoopReads`, `preflightPaidBuild`) do not exist on
// `node-build.ts` yet, and the `NodeBuildOpts` fields it adds (`increment`, `innerLoopReads`) are
// structural — at HEAD `nodeBuild` silently ignores both. Every assertion below fails on WHAT THE
// BUILD DID, never on a missing-export link failure: a new function is reached only after its own
// `typeof … === "function"` check, written in the test's own body.

const UNIT_ID = "cap-a";

// ── The `--real` fixture: one unit with no install/db/addDeps arm ─────────────────────────────────

interface Fixture {
  repoRoot: string;
  storiesDir: string;
  corpus: InMemoryStore;
}

async function setupFixture(): Promise<Fixture> {
  const repo = await fixtureRepo(false);
  const storiesDir = await fixtureStories([{ id: UNIT_ID, dependsOn: [] }]);
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
  return { repoRoot: repo.root, storiesDir, corpus };
}

async function teardownFixture(fx: Fixture): Promise<void> {
  await fsp.rm(fx.repoRoot, { recursive: true, force: true });
  await fsp.rm(fx.storiesDir, { recursive: true, force: true });
}

const throwingCorpus: Pick<Store, "getDoc"> = {
  getDoc: async () => {
    throw new Error("corpus-down-marker");
  },
};

const throwingLedger: Pick<Store, "readEvents"> = {
  readEvents: async () => {
    throw new Error("ledger-down-marker");
  },
};

let fx!: Fixture;
let escalationsDir!: string;

before(async () => {
  fx = await setupFixture();
  escalationsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "node-build-names-its-increment-"));
});

after(async () => {
  await teardownFixture(fx);
  await fsp.rm(escalationsDir, { recursive: true, force: true });
});

// ── ledger fixture builders (never assert — they only build data for a test to assert against) ────

type DiffKind = "changed-input" | "fixed-defect" | "new-observation" | "revised-test";

const attemptEvt = (unitId: string, incrementId: string, runId: string) =>
  ({ event: "attempt" as const, unitId, incrementId, runId });
const passEvt = (unitId: string, incrementId: string, runId: string) =>
  ({ event: "signed-pass" as const, unitId, incrementId, runId });
const grantEvt = (
  unitId: string,
  incrementId: string,
  runId: string,
  attempts: number,
  kind: DiffKind,
) => ({
  event: "grant" as const,
  unitId,
  incrementId,
  runId,
  attempts,
  kind,
  difference: "a fixture difference",
});
const landEvt = (unitId: string, incrementId: string, runId: string) => ({
  event: "adjudication" as const,
  unitId,
  incrementId,
  runId,
  disposition: "land" as const,
  mayRefuse: false,
  escalates: false,
  reason: "landed",
});

type LedgerDoc =
  | ReturnType<typeof attemptEvt>
  | ReturnType<typeof passEvt>
  | ReturnType<typeof grantEvt>
  | ReturnType<typeof landEvt>;

async function seedLedger(...docs: readonly LedgerDoc[]): Promise<InMemoryStore> {
  const store = new InMemoryStore();
  for (const doc of docs) await appendInnerLoopEvent(store, doc);
  return store;
}

// ── ensureDb spy + progress recorder (never assert — only return what a test asserts against) ─────

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
      return { ok: false, reason: "INCREMENT_TEST_DB_MARKER" };
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

const PREFLIGHT_STAGE = "inner-loop preflight (the increment and the attempt ledger, before any spend)";
const PROMPTS_STAGE = "library agent prompts (red-builder + green-builder, from the live store)";
const DB_STAGE = "live-store preflight (probe -> db:up -> wait for connections)";
const DB_MARKER_BODY =
  "--real persists to the live store, but the database could not be brought up:\nINCREMENT_TEST_DB_MARKER";

/** The REAL options a paid build runs under — never asserts, only builds the input a test drives. */
function realOpts(args: {
  ledger: Pick<Store, "readEvents">;
  corpus?: Pick<Store, "getDoc">;
  increment: string | undefined;
  reviseTest?: string | undefined;
  ensureDb: (log: (message: string) => void) => Promise<EnsureDbResult>;
  progress: BuildProgress;
}) {
  return {
    dryRun: false,
    real: true,
    runtime: "claude",
    actor: "tester@example.com",
    repoRoot: fx.repoRoot,
    storiesDir: fx.storiesDir,
    corpusStore: fx.corpus,
    buildGuardFactory: offlineBuildGuardFactory,
    innerLoopReads: { corpus: args.corpus ?? fx.corpus, ledger: args.ledger },
    increment: args.increment,
    reviseTest: args.reviseTest,
    ensureDb: args.ensureDb,
    progress: args.progress,
    escalationsDir,
  };
}

// ── a genuine returned AUTHOR_TEST escalation, driven for real (never a hand-built ProveResult) ────
// Never asserts — mirrors `node-build-revise-test.test.ts`'s `driveEscalatingProveUnit`, but returns
// the raw result for the CALLING TEST to assert ground truth against (ADR-0572 per-test review: an
// assertion inside a helper is not credited to the test that calls it).

interface DriveEscalatingOpts {
  unitId: string;
  runId: string;
  testId: string;
  statement: string;
}

async function driveEscalatingResult(opts: DriveEscalatingOpts): Promise<ProveResult> {
  const rebuilt = parseAuthoringEscalation("AUTHOR_TEST", { statement: opts.statement });
  if (!rebuilt.ok) {
    throw new Error(`fixture: parseAuthoringEscalation must accept a non-blank statement: ${rebuilt.reason}`);
  }
  const author: PhaseAuthor = {
    async author(phase: AuthoringPhase): Promise<AuthorResult> {
      if (phase === "AUTHOR_TEST") {
        return {
          ok: false,
          error: "the fixture attempt declares the contract untestable",
          escalation: rebuilt.escalation,
        };
      }
      return { ok: true };
    },
  };
  const executor = new ShellTestExecutor({
    command: () => ({ file: process.execPath, args: ["-e", "process.exit(0)"] }),
  });
  const tree: TreeState = { commitSha: "node-build-names-its-increment-fixture-tree", clean: true };
  const spec: ProveSpec = {
    unitId: opts.unitId,
    proofMode: "contract",
    testId: opts.testId,
    author,
    testExecutor: executor,
    store: new InMemoryStore(),
    signerInputs: { flag: "tester@example.com" },
    treeState: async () => tree,
    now: () => "2024-01-01T00:00:00.000Z",
    prompts: { authorTest: "author the failing test", implement: "implement against the authored test" },
    runId: opts.runId,
  };
  return proveUnit(spec);
}

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// node-build-increment-is-real-only
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("node-build-increment-is-real-only: --increment is refused before any spend without --real, and never disturbs the existing no-increment dry-run", async () => {
  const unitId = "no-such-unit-for-increment";
  const expected = {
    ok: false,
    body:
      "--increment is valid only with --real: it names the increment a paid attempt is filed under " +
      "on the attempt ledger, and neither --dry-run nor --live records an attempt (ADR-0575 D1, " +
      "ADR-0576 D1).",
    next: [`storytree node build ${unitId} --real --increment inc-live`],
  };

  const dryRun = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: true,
    increment: "inc-live",
    actor: "tester@example.com",
  });
  assert.deepEqual(dryRun, expected, "--dry-run + --increment must be refused before spend");

  const live = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: false,
    live: true,
    increment: "inc-live",
    actor: "tester@example.com",
  });
  assert.deepEqual(live, expected, "--live + --increment must be refused before spend, exactly the same way");

  assert.doesNotMatch(dryRun.body, /no node spec/, "the increment check must precede the spec load");

  // Control (already holds before the change): without --increment, the same dry-run reaches the
  // spec load.
  const control = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: true,
    actor: "tester@example.com",
  });
  assert.equal(control.ok, false);
  assert.match(control.body, /^no node spec "no-such-unit-for-increment"/);
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// real-node-build-names-a-live-increment-before-spend
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("real-node-build-names-a-live-increment-before-spend: refuses a missing, unknown, wrong-kind or closed increment before any spend", async () => {
  assert.equal(
    typeof NodeBuildModule.innerLoopRefusalEnvelope,
    "function",
    "node-build.ts must export innerLoopRefusalEnvelope(state): Envelope",
  );

  const cases: ReadonlyArray<string | undefined> = [undefined, "   ", "no-such-increment", "some-arc", "inc-closed"];

  for (const increment of cases) {
    const { calls, ensureDb } = spyEnsureDb();
    const { progress, stages } = recordingProgress();
    const envelope = await NodeBuildModule.nodeBuild(
      UNIT_ID,
      realOpts({ ledger: new InMemoryStore(), increment, ensureDb, progress }),
    );

    const resolved = await resolveBuildIncrement(fx.corpus, increment);
    assert.equal(resolved.ok, false, `ground truth: increment=${String(increment)} must refuse at resolveBuildIncrement`);
    if (resolved.ok) continue;

    assert.deepEqual(
      envelope,
      NodeBuildModule.innerLoopRefusalEnvelope(resolved.state),
      `increment=${String(increment)}`,
    );
    assert.equal(calls.count, 0, `increment=${String(increment)}: ensureDb must never run — the prompt stage never opens`);
    assert.deepEqual(stages, [PREFLIGHT_STAGE], `increment=${String(increment)}`);
  }

  // Control (already holds before the change): the existing cheap refusals (the revision read) keep
  // their precedence over the increment check.
  {
    const runId = "a-run-with-no-record";
    const expectedRead = NodeBuildModule.readTestRevision(escalationsDir, UNIT_ID, runId);
    assert.equal(expectedRead.ok, false, "ground truth: reading a nonexistent record must refuse");
    if (expectedRead.ok) return;

    const { calls, ensureDb } = spyEnsureDb();
    const { progress, stages } = recordingProgress();
    const envelope = await NodeBuildModule.nodeBuild(
      UNIT_ID,
      realOpts({ ledger: new InMemoryStore(), increment: undefined, reviseTest: runId, ensureDb, progress }),
    );

    assert.deepEqual(
      envelope,
      { ok: false, body: expectedRead.reason, next: [] },
      "a missing revision record refuses before the increment check is ever reached",
    );
    assert.equal(calls.count, 0);
    assert.deepEqual(stages, [], "the revision read refuses before any progress stage opens");
  }
});

test("real-node-build-names-a-live-increment-before-spend: refuses an unreadable increment lookup, quoting the underlying error", async () => {
  assert.equal(
    typeof NodeBuildModule.innerLoopRefusalEnvelope,
    "function",
    "node-build.ts must export innerLoopRefusalEnvelope(state): Envelope",
  );

  const { calls, ensureDb } = spyEnsureDb();
  const { progress, stages } = recordingProgress();
  const envelope = await NodeBuildModule.nodeBuild(
    UNIT_ID,
    realOpts({ ledger: new InMemoryStore(), corpus: throwingCorpus, increment: "inc-live", ensureDb, progress }),
  );

  const resolved = await resolveBuildIncrement(throwingCorpus, "inc-live");
  assert.equal(resolved.ok, false, "ground truth: a throwing corpus must refuse at resolveBuildIncrement");
  if (resolved.ok) return;

  assert.deepEqual(envelope, NodeBuildModule.innerLoopRefusalEnvelope(resolved.state));
  assert.ok(envelope.body.includes("corpus-down-marker"));
  assert.equal(calls.count, 0);
  assert.deepEqual(stages, [PREFLIGHT_STAGE]);
});

test("real-node-build-names-a-live-increment-before-spend: with no injected read handles, a missing increment is refused by the production preflight without a store read", async () => {
  // The production handles open LAZILY, and a missing id is refused before any lookup, so this path
  // is hermetic: nothing opens. The expected state is computed over a corpus that THROWS on a read,
  // so a preflight that had read anything would have refused as unreadable instead.
  for (const incrementId of [undefined, "   "]) {
    const preflight = await NodeBuildModule.preflightPaidBuild({
      incrementId,
      unitIds: [UNIT_ID],
      revise: false,
      reads: undefined,
    });
    const expected = await resolveBuildIncrement(throwingCorpus, incrementId);
    assert.equal(expected.ok, false, `ground truth: increment=${String(incrementId)} must refuse unread`);
    if (expected.ok) continue;
    assert.deepEqual(preflight, { ok: false, state: expected.state }, `increment=${String(incrementId)}`);
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// real-node-build-preflights-its-unit-before-spend
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("real-node-build-preflights-its-unit-before-spend: refuses at the decision point, the owner ceiling, an unresolved signed pass, and a rebuild under a landed increment", async () => {
  assert.equal(
    typeof NodeBuildModule.innerLoopRefusalEnvelope,
    "function",
    "node-build.ts must export innerLoopRefusalEnvelope(state): Envelope",
  );

  const decisionLedger = await seedLedger(
    attemptEvt(UNIT_ID, "inc-live", "r1"),
    attemptEvt(UNIT_ID, "inc-live", "r2"),
    attemptEvt(UNIT_ID, "inc-live", "r3"),
  );
  const ceilingLedger = await seedLedger(
    attemptEvt(UNIT_ID, "inc-live", "r1"),
    attemptEvt(UNIT_ID, "inc-live", "r2"),
    attemptEvt(UNIT_ID, "inc-live", "r3"),
    attemptEvt(UNIT_ID, "inc-live", "r4"),
    attemptEvt(UNIT_ID, "inc-live", "r5"),
    attemptEvt(UNIT_ID, "inc-live", "r6"),
  );
  const unresolvedLedger = await seedLedger(
    attemptEvt(UNIT_ID, "inc-live", "r1"),
    passEvt(UNIT_ID, "inc-live", "r1"),
  );
  const landedLedger = await seedLedger(
    attemptEvt(UNIT_ID, "inc-live", "r1"),
    passEvt(UNIT_ID, "inc-live", "r1"),
    landEvt(UNIT_ID, "inc-live", "r1"),
  );

  for (const ledger of [decisionLedger, ceilingLedger, unresolvedLedger, landedLedger]) {
    const { calls, ensureDb } = spyEnsureDb();
    const { progress, stages } = recordingProgress();
    const envelope = await NodeBuildModule.nodeBuild(
      UNIT_ID,
      realOpts({ ledger, increment: "inc-live", ensureDb, progress }),
    );

    const resolved = await preflightInnerLoop({ ledger, incrementId: "inc-live", unitIds: [UNIT_ID] });
    assert.equal(resolved.ok, false, "ground truth: this ledger fixture must refuse the preflight");
    if (resolved.ok) continue;

    assert.deepEqual(envelope, NodeBuildModule.innerLoopRefusalEnvelope(resolved.state));
    assert.equal(calls.count, 0, "ensureDb must never run before spend");
    assert.deepEqual(stages, [PREFLIGHT_STAGE]);
  }
});

test("real-node-build-preflights-its-unit-before-spend: refuses an unreadable ledger, and proceeds under an empty ledger, a live grant, or a relabelled increment", async () => {
  assert.equal(
    typeof NodeBuildModule.innerLoopRefusalEnvelope,
    "function",
    "node-build.ts must export innerLoopRefusalEnvelope(state): Envelope",
  );

  // The unreadable ledger.
  {
    const { calls, ensureDb } = spyEnsureDb();
    const { progress, stages } = recordingProgress();
    const envelope = await NodeBuildModule.nodeBuild(
      UNIT_ID,
      realOpts({ ledger: throwingLedger, increment: "inc-live", ensureDb, progress }),
    );

    const resolved = await preflightInnerLoop({ ledger: throwingLedger, incrementId: "inc-live", unitIds: [UNIT_ID] });
    assert.equal(resolved.ok, false, "ground truth: a throwing ledger must refuse the preflight");
    if (resolved.ok) return;

    assert.deepEqual(envelope, NodeBuildModule.innerLoopRefusalEnvelope(resolved.state));
    assert.ok(envelope.body.includes("ledger-down-marker"));
    assert.equal(calls.count, 0);
    assert.deepEqual(stages, [PREFLIGHT_STAGE]);
  }

  // The three cases that proceed: empty, a live grant covering the next attempt, and a relabel.
  const emptyLedger = new InMemoryStore();
  const grantedLedger = await seedLedger(
    attemptEvt(UNIT_ID, "inc-live", "r1"),
    attemptEvt(UNIT_ID, "inc-live", "r2"),
    attemptEvt(UNIT_ID, "inc-live", "r3"),
    grantEvt(UNIT_ID, "inc-live", "r3", 2, "fixed-defect"),
  );
  const relabelledLedger = await seedLedger(
    attemptEvt(UNIT_ID, "inc-old", "r1"),
    attemptEvt(UNIT_ID, "inc-old", "r2"),
  );

  for (const ledger of [emptyLedger, grantedLedger, relabelledLedger]) {
    const { calls, ensureDb } = spyEnsureDb();
    const { progress, stages } = recordingProgress();
    const envelope = await NodeBuildModule.nodeBuild(
      UNIT_ID,
      realOpts({ ledger, increment: "inc-live", ensureDb, progress }),
    );

    assert.equal(calls.count, 1, "a passing preflight must proceed to the DB preflight exactly once");
    assert.equal(envelope.body, DB_MARKER_BODY);
    assert.deepEqual(stages, [PREFLIGHT_STAGE, PROMPTS_STAGE, DB_STAGE]);
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// revision-run-pairs-with-its-live-grant
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("revision-run-pairs-with-its-live-grant: a --revise-test run consumes only a revised-test grant, and a plain run is refused by one, symmetrically", async () => {
  assert.equal(
    typeof NodeBuildModule.innerLoopRefusalEnvelope,
    "function",
    "node-build.ts must export innerLoopRefusalEnvelope(state): Envelope",
  );

  const revisionRunId = "real-prior";
  const priorResult = await driveEscalatingResult({
    unitId: UNIT_ID,
    runId: revisionRunId,
    testId: "test-id-for-real-prior",
    statement: "REAL_PRIOR_REVISION_STATEMENT_MARKER",
  });
  assert.equal(priorResult.ok, false, "ground truth: the fixture attempt must be a returned escalation");
  if (priorResult.ok) return;
  assert.notEqual(priorResult.escalation, undefined, "ground truth: the fixture attempt must carry a returned escalation");

  const written = await NodeBuildModule.writeRevisionRecord(escalationsDir, UNIT_ID, revisionRunId, priorResult);
  assert.notEqual(written, null, "ground truth: writing a returned escalation must not return null");
  if (written === null) return;
  assert.equal(written.written, true, "ground truth: the write must succeed");

  const revisedTestLedger = await seedLedger(
    attemptEvt(UNIT_ID, "inc-live", "r1"),
    attemptEvt(UNIT_ID, "inc-live", "r2"),
    attemptEvt(UNIT_ID, "inc-live", "r3"),
    grantEvt(UNIT_ID, "inc-live", "r3", 1, "revised-test"),
  );
  const fixedDefectLedger = await seedLedger(
    attemptEvt(UNIT_ID, "inc-live", "r1"),
    attemptEvt(UNIT_ID, "inc-live", "r2"),
    attemptEvt(UNIT_ID, "inc-live", "r3"),
    grantEvt(UNIT_ID, "inc-live", "r3", 1, "fixed-defect"),
  );

  const cases: ReadonlyArray<{ ledger: InMemoryStore; reviseTest: string | undefined; revise: boolean }> = [
    { ledger: revisedTestLedger, reviseTest: undefined, revise: false },
    { ledger: revisedTestLedger, reviseTest: revisionRunId, revise: true },
    { ledger: fixedDefectLedger, reviseTest: revisionRunId, revise: true },
    { ledger: fixedDefectLedger, reviseTest: undefined, revise: false },
  ];

  for (const c of cases) {
    const { calls, ensureDb } = spyEnsureDb();
    const { progress, stages } = recordingProgress();
    const envelope = await NodeBuildModule.nodeBuild(
      UNIT_ID,
      realOpts({ ledger: c.ledger, increment: "inc-live", reviseTest: c.reviseTest, ensureDb, progress }),
    );

    const resolved = await preflightInnerLoop({
      ledger: c.ledger,
      incrementId: "inc-live",
      unitIds: [UNIT_ID],
      revise: c.revise,
    });

    const label = `ledger=${c.ledger === revisedTestLedger ? "revised-test" : "fixed-defect"} reviseTest=${String(c.reviseTest)}`;
    if (!resolved.ok) {
      assert.deepEqual(envelope, NodeBuildModule.innerLoopRefusalEnvelope(resolved.state), label);
      assert.equal(calls.count, 0, label);
      assert.deepEqual(stages, [PREFLIGHT_STAGE], label);
    } else {
      assert.equal(calls.count, 1, label);
      assert.equal(envelope.body, DB_MARKER_BODY, label);
      assert.deepEqual(stages, [PREFLIGHT_STAGE, PROMPTS_STAGE, DB_STAGE], label);
    }
  }
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// paid-build-envelopes-render-the-entry-state
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("paid-build-envelopes-render-the-entry-state: innerLoopRefusalEnvelope renders a refused state through the one entry-state renderer", () => {
  assert.equal(
    typeof NodeBuildModule.innerLoopRefusalEnvelope,
    "function",
    "node-build.ts must export innerLoopRefusalEnvelope(state): Envelope",
  );

  const s1: InnerLoopRefusedState = { state: "refused", refusals: [{ kind: "increment-closed", reason: "x" }] };
  const s2: InnerLoopRefusedState = {
    state: "refused",
    refusals: [{ kind: "decision-point", unitId: UNIT_ID, reason: "y" }],
  };

  for (const s of [s1, s2]) {
    const rendered = renderInnerLoopEntryState(s);
    assert.deepEqual(NodeBuildModule.innerLoopRefusalEnvelope(s), {
      ok: false,
      body: rendered.lines.join("\n"),
      next: [...rendered.next],
    });
  }
});

test("paid-build-envelopes-render-the-entry-state: renderIncrementLines renders no line, the increment alone, or the increment plus every warning", () => {
  assert.equal(
    typeof NodeBuildModule.renderIncrementLines,
    "function",
    "node-build.ts must export renderIncrementLines(incrementId, warnings): string[]",
  );

  assert.deepEqual(NodeBuildModule.renderIncrementLines(undefined, []), []);
  assert.deepEqual(NodeBuildModule.renderIncrementLines("inc-live", []), ["increment:   inc-live"]);
  assert.deepEqual(NodeBuildModule.renderIncrementLines("inc-live", ["w1", "w2"]), [
    "increment:   inc-live",
    "warning:     w1",
    "warning:     w2",
  ]);
});

test("paid-build-envelopes-render-the-entry-state: renderInnerLoopOutcome renders every recording shape through the one entry-state renderer", async () => {
  assert.equal(
    typeof NodeBuildModule.renderInnerLoopOutcome,
    "function",
    "node-build.ts must export renderInnerLoopOutcome(unitId, runId, innerLoop, events): { lines; next }",
  );

  assert.deepEqual(NodeBuildModule.renderInnerLoopOutcome(UNIT_ID, "r7", undefined, []), { lines: [], next: [] });

  assert.deepEqual(
    NodeBuildModule.renderInnerLoopOutcome(
      UNIT_ID,
      "r7",
      { incrementId: "inc-live", attempt: { recorded: false, reason: "down" } },
      [],
    ),
    { lines: [], next: [] },
  );

  const signedState = renderInnerLoopEntryState({ state: "signed", unitId: UNIT_ID, runId: "r7" });
  assert.deepEqual(
    NodeBuildModule.renderInnerLoopOutcome(
      UNIT_ID,
      "r7",
      { incrementId: "inc-live", attempt: { recorded: true }, signedPass: { recorded: true } },
      [],
    ),
    { lines: [...signedState.lines], next: [...signedState.next] },
  );

  assert.deepEqual(
    NodeBuildModule.renderInnerLoopOutcome(
      UNIT_ID,
      "r7",
      {
        incrementId: "inc-live",
        attempt: { recorded: true },
        signedPass: { recorded: false, reason: "pass-append-marker" },
      },
      [],
    ),
    {
      lines: [
        "inner loop:  signed, but the signed pass could not be recorded: pass-append-marker — the " +
          "ledger holds no landing obligation for run r7 (ADR-0576 D5)",
      ],
      next: [],
    },
  );

  const failingLedgerStore = await seedLedger(
    attemptEvt(UNIT_ID, "inc-live", "r5"),
    attemptEvt(UNIT_ID, "inc-live", "r6"),
    attemptEvt(UNIT_ID, "inc-live", "r7"),
  );
  const failingEvents: StoreEvent[] = await failingLedgerStore.readEvents();
  const attemptFailedState = renderInnerLoopEntryState({
    state: "attempt-failed",
    unitId: UNIT_ID,
    runId: "r7",
    consecutiveFailures: 3,
    remainingGrantCount: 0,
  });
  assert.deepEqual(
    NodeBuildModule.renderInnerLoopOutcome(
      UNIT_ID,
      "r7",
      { incrementId: "inc-live", attempt: { recorded: true } },
      failingEvents,
    ),
    { lines: [...attemptFailedState.lines], next: [...attemptFailedState.next] },
  );

  const orphanStore = new InMemoryStore();
  await appendInnerLoopEvent(orphanStore, grantEvt(UNIT_ID, "inc-live", "r9", 1, "fixed-defect"));
  const orphanEvents: StoreEvent[] = await orphanStore.readEvents();
  assert.deepEqual(
    NodeBuildModule.renderInnerLoopOutcome(
      UNIT_ID,
      "r7",
      { incrementId: "inc-live", attempt: { recorded: true } },
      orphanEvents,
    ),
    {
      lines: [
        "inner loop:  the attempt was recorded, but the ledger could not be folded after the walk: " +
          "grant references no recorded attempt: r9",
      ],
      next: ["pnpm db:probe"],
    },
  );
});

// ═════════════════════════════════════════════════════════════════════════════════════════════════
// printed-real-commands-name-the-increment
// ═════════════════════════════════════════════════════════════════════════════════════════════════

test("printed-real-commands-name-the-increment: renderRevisionRecord's fifth argument names the increment in the re-run command", () => {
  for (const runtime of ["codex", "claude", "pi"] as const) {
    const write = { written: true as const, path: "/tmp/r.json" };
    assert.deepEqual(NodeBuildModule.renderRevisionRecord(UNIT_ID, "run-x", runtime, write, "inc-live"), [
      `revision:    written to /tmp/r.json — re-run with: storytree node build ${UNIT_ID} --real ` +
        `--runtime ${runtime} --increment inc-live --revise-test run-x`,
    ]);
  }

  // Control (already holds before the change): the fifth argument omitted keeps today's command.
  assert.deepEqual(
    NodeBuildModule.renderRevisionRecord(UNIT_ID, "run-x", "codex", { written: true, path: "/tmp/r.json" }),
    [`revision:    written to /tmp/r.json — re-run with: storytree node build ${UNIT_ID} --real --runtime codex --revise-test run-x`],
  );

  // Control (already holds before the change): an unwritten record still names no command.
  assert.deepEqual(
    NodeBuildModule.renderRevisionRecord(
      UNIT_ID,
      "run-x",
      "codex",
      { written: false, path: "/tmp/r.json", reason: "boom" },
      "inc-live",
    ),
    ["revision:    NOT written (/tmp/r.json): boom — relay the escalation block above to the owner by hand"],
  );
});

test("printed-real-commands-name-the-increment: nodeBuildRetryCommand names the increment when known and omits it when not", () => {
  assert.equal(
    typeof NodeBuildModule.nodeBuildRetryCommand,
    "function",
    "node-build.ts must export nodeBuildRetryCommand(unitId, modeFlag, incrementId): string",
  );

  assert.equal(
    NodeBuildModule.nodeBuildRetryCommand(UNIT_ID, "--real", "inc-live"),
    `storytree node build ${UNIT_ID} --real --increment inc-live`,
  );
  assert.equal(
    NodeBuildModule.nodeBuildRetryCommand(UNIT_ID, "--dry-run", undefined),
    `storytree node build ${UNIT_ID} --dry-run`,
  );
});

test("printed-real-commands-name-the-increment: realConfigRefusal names every real-buildable id with the increment placeholder", () => {
  const storySpec = loadNodeSpec(path.join(fx.storiesDir, "fix-story", "story.md"));
  const refusal = NodeBuildModule.realConfigRefusal(storySpec, null, fx.storiesDir);
  assert.notEqual(refusal, null, "ground truth: a null buildConfig must refuse");
  if (refusal === null) return;

  const expectedNext = NodeBuildModule.buildableNodeIds(fx.storiesDir).realBuildable.map(
    (id) => `storytree node build ${id} --real --increment <increment-id>`,
  );
  assert.deepEqual(refusal.next, expectedNext);
  assert.ok(expectedNext.includes(`storytree node build ${UNIT_ID} --real --increment <increment-id>`));
});

test("printed-real-commands-name-the-increment: nodeBuild's --revise-test mode-check next names the increment placeholder", async () => {
  const modeCheck = await NodeBuildModule.nodeBuild(UNIT_ID, {
    dryRun: true,
    reviseTest: "run-x",
    actor: "tester@example.com",
  });
  assert.deepEqual(modeCheck.next, [
    `storytree node build ${UNIT_ID} --real --increment <increment-id> --revise-test run-x`,
  ]);
});

test("printed-real-commands-name-the-increment: a REAL build refused at its claim points at another unit's paid build under the increment it resolved", async () => {
  // Offline: the internal in-memory store seam means no database, and the claim refuses before any
  // worktree or leaf, so the envelope is the whole observable.
  const held: ClaimDocT = {
    unitId: UNIT_ID,
    sessionId: "sibling",
    branch: "claude/sibling",
    intent: "real",
    claimedAt: "2026-09-17T00:00:00.000Z",
    heartbeatAt: "2026-09-17T00:00:00.000Z",
  };
  const { ensureDb, calls } = spyEnsureDb();
  const { progress } = recordingProgress();
  const refused = await NodeBuildModule.nodeBuild(UNIT_ID, {
    ...realOpts({ ledger: new InMemoryStore(), increment: "inc-live", ensureDb, progress }),
    verdictStore: "memory",
    claim: { store: { claim: async () => ({ acquired: false, heldBy: held }), release: async () => false } },
    identity: { sessionId: "mine", branch: "claude/mine" },
  });
  assert.equal(refused.ok, false, refused.body);
  assert.match(refused.body, /is already being built by another live session/);
  assert.deepEqual(refused.next, [
    "storytree noticeboard --pg",
    "storytree node build <other-id> --real --increment inc-live",
  ]);
  assert.equal(calls.count, 0, "the in-memory store seam never starts the database");
});

test("a build refused at its claim names the holder's harness and MACHINE, and says so when they were never recorded", async () => {
  // The holder's session id is a worktree name its author chose, so it can point at a machine the
  // work never ran on; the refusal carries what the claim itself recorded instead.
  const refusedBy = async (held: ClaimDocT) => {
    const { ensureDb } = spyEnsureDb();
    const { progress } = recordingProgress();
    return NodeBuildModule.nodeBuild(UNIT_ID, {
      ...realOpts({ ledger: new InMemoryStore(), increment: "inc-live", ensureDb, progress }),
      verdictStore: "memory",
      claim: { store: { claim: async () => ({ acquired: false, heldBy: held }), release: async () => false } },
      identity: { sessionId: "mine", branch: "claude/mine" },
    });
  };
  const base: ClaimDocT = {
    unitId: UNIT_ID,
    sessionId: "storytree-mintbox-live-proof-final",
    branch: "codex/live-proof",
    intent: "real",
    claimedAt: "2026-09-17T00:00:00.000Z",
    heartbeatAt: "2026-09-17T00:00:00.000Z",
  };

  const recorded = await refusedBy({ ...base, harness: "codex", host: "MicksMSpro" });
  assert.equal(recorded.ok, false, recorded.body);
  assert.match(
    recorded.body,
    /^held by: {5}storytree-mintbox-live-proof-final \(codex on MicksMSpro, branch codex\/live-proof\)$/m,
  );

  const unrecorded = await refusedBy(base);
  assert.match(
    unrecorded.body,
    /^held by: {5}storytree-mintbox-live-proof-final \(harness and host not recorded, branch codex\/live-proof\)$/m,
  );
});

test("printed-real-commands-name-the-increment: a synthetic walk refused the live store points at the paid build that may persist, naming the increment", async () => {
  const { progress } = recordingProgress();
  const refused = await NodeBuildModule.nodeBuild(UNIT_ID, {
    dryRun: false,
    live: true,
    runtime: "claude",
    actor: "tester@example.com",
    repoRoot: fx.repoRoot,
    storiesDir: fx.storiesDir,
    corpusStore: fx.corpus,
    verdictStore: "pg",
    progress,
  });
  assert.equal(refused.ok, false, refused.body);
  assert.match(refused.body, /--store pg is refused for a SYNTHETIC walk/);
  assert.deepEqual(refused.next, [`storytree node build ${UNIT_ID} --real --increment <increment-id> --store pg`]);
});

test("printed-real-commands-name-the-increment: a passing dry-run's any-node suggestion carries no increment, and the resolve report's paid suggestion names the placeholder", async () => {
  const passed = await NodeBuildModule.nodeBuild(UNIT_ID, {
    dryRun: true,
    actor: "tester@example.com",
    repoRoot: fx.repoRoot,
    storiesDir: fx.storiesDir,
  });
  assert.equal(passed.ok, true, passed.body);
  assert.deepEqual(passed.next, [
    "storytree node build <id> --dry-run   (any registered node)",
    `storytree library artifact ${UNIT_ID}   (if it has a Library artifact)`,
  ]);

  const resolved = NodeBuildModule.nodeResolve(UNIT_ID, { storiesDir: fx.storiesDir, repoRoot: fx.repoRoot });
  assert.equal(resolved.ok, true, resolved.body);
  assert.deepEqual(resolved.next, [
    `storytree node build ${UNIT_ID} --dry-run   (free — prove the glue, scripted walk)`,
    `storytree node build ${UNIT_ID} --real --increment <increment-id>   (paid — the live leaf authors the node's real proof)`,
  ]);
});

test("paid-build-envelopes-render-the-entry-state: a refusal naming several units renders one body line per refusal", () => {
  const state: InnerLoopRefusedState = {
    state: "refused",
    refusals: [
      { kind: "increment-closed", reason: "the increment is closed" },
      { kind: "owner-ceiling", unitId: UNIT_ID, reason: "six failures" },
    ],
  };
  assert.deepEqual(NodeBuildModule.innerLoopRefusalEnvelope(state), {
    ok: false,
    body:
      "refused before spend (increment-closed): the increment is closed\n" +
      `refused before spend (owner-ceiling): ${UNIT_ID} — six failures`,
    next: ["storytree arc list --pg"],
  });
});
