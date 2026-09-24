import { offlineBuildGuardFactory } from "./real-chain-fixture.js";
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import path from "node:path";

import { InMemoryStore } from "@storytree/storage-protocol";
import { ShellTestExecutor, proveUnit } from "@storytree/orchestrator";
import type { EscalationRecord, ProveResult, ProveSpec, TestRevision, TreeState } from "@storytree/orchestrator";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import { parseAuthoringEscalation } from "@storytree/agent";
import type { AuthoringPhase, AuthorResult, PhaseAuthor } from "@storytree/agent";

import { fixtureRepo, fixtureStories } from "./real-chain-fixture.js";
import { silentBuildProgress } from "./build-progress.js";
import type { EnsureDbResult } from "./db-control.js";

// The module under test, reached only through the namespace (see the header comment below).
import * as NodeBuildModule from "./node-build.js";

/**
 * `node-build-takes-a-revision-and-names-the-record-it-leaves` (ADR-0571 D3): `node build --real`
 * reads the named run's revision record before any spend, refuses a missing or foreign one, passes
 * it to the REAL lifecycle, and names the record a failed build leaves together with the command
 * that revises against it.
 *
 * The module is imported as a NAMESPACE (`import * as`), never by name (ADR-0057 C): the two
 * renderers this node adds (`renderRevisingLine`, `renderRevisionRecord`) do not exist on
 * `node-build.ts` yet, and the `NodeBuildOpts` fields it adds (`reviseTest`, `escalationsDir`) are
 * structural — at HEAD `nodeBuild` silently ignores both, so every assertion below fails on WHAT THE
 * BUILD DID (or on the two new renderers not yet being published, guarded by an explicit
 * `assert.equal(typeof …, "function")` rather than a bare call), never on a missing-export link
 * failure. `nodeBuild`, `readTestRevision`, `writeRevisionRecord` and `revisionRecordPath` already
 * exist and are reached through this same namespace, exactly as `build-node-real-revision.test.ts`
 * and `node-build-revision-record.test.ts` already reach them.
 *
 * REAL SPEND IS NEVER OBSERVED HERE: every `--real` call below is wired so it dies at (or before) an
 * injected DB-preflight refusal — a fixture unit with no `install`/`db`/`addDeps` arm, an injected
 * `corpusStore` so the leaf-prompt render never opens a live connection, and an injected `ensureDb`
 * spy that refuses immediately and counts its own calls. That is what makes "before any spend"
 * checkable at all: a correct revision refusal must never even reach that spy.
 *
 * DECLARED, NOT OBSERVED (per the node's own brief): the REAL arm's pass-through of the revision and
 * `escalationsDir` into `realArgs`, the `revisionWrite` declaration and its assignment from
 * `built.revisionWrite`, and the two renderers' spread call sites in the header/failure body. Those
 * lines carry no mutable expression (identifiers, member access, calls and spreads only) and are
 * unreachable without a live leaf actually authoring, which this file never drives.
 */

const FIXTURE_UNIT_ID = "cap-a";

/** Escapes regex metacharacters so fixture prose can be embedded in a `RegExp` verbatim. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── The two bound-but-not-yet-published renderers (mirrors `node-build-escalation-envelope.test.ts`) ──

type RenderRevisingLine = (revision: TestRevision | undefined) => string[];
type RevisionWriteShape =
  | { written: true; path: string }
  | { written: false; path: string; reason: string };
type RenderRevisionRecord = (
  unitId: string,
  runId: string,
  runtime: "claude" | "codex" | "pi",
  write: RevisionWriteShape | undefined,
) => string[];

const renderRevisingLineRaw = (NodeBuildModule as Record<string, unknown>).renderRevisingLine as
  | RenderRevisingLine
  | undefined;
const renderRevisionRecordRaw = (NodeBuildModule as Record<string, unknown>).renderRevisionRecord as
  | RenderRevisionRecord
  | undefined;

function mustGetRenderRevisingLine(): RenderRevisingLine {
  assert.equal(
    typeof renderRevisingLineRaw,
    "function",
    "node-build.ts must export renderRevisingLine(revision): string[]",
  );
  return renderRevisingLineRaw as RenderRevisingLine;
}
function mustGetRenderRevisionRecord(): RenderRevisionRecord {
  assert.equal(
    typeof renderRevisionRecordRaw,
    "function",
    "node-build.ts must export renderRevisionRecord(unitId, runId, runtime, write): string[]",
  );
  return renderRevisionRecordRaw as RenderRevisionRecord;
}

// ── A genuine returned AUTHOR_TEST escalation, driven for real (never a hand-built ProveResult) ────

interface DriveEscalatingOpts {
  unitId: string;
  runId: string;
  testId: string;
  statement: string;
}

/**
 * Drive ONE real `proveUnit` walk (over a real `ShellTestExecutor`) whose AUTHOR_TEST leaf escalates
 * immediately, producing a genuine RETURNED escalation. Mirrors
 * `build-node-real-revision.test.ts`'s `driveEscalatingProveUnit`, generalized over the id/statement
 * so this file can build more than one fixture from it.
 */
async function driveEscalatingProveUnit(
  opts: DriveEscalatingOpts,
): Promise<Extract<ProveResult, { ok: false }>> {
  const rebuilt = parseAuthoringEscalation("AUTHOR_TEST", { statement: opts.statement });
  assert.equal(rebuilt.ok, true, "ground truth: parseAuthoringEscalation must accept a non-blank statement");
  if (!rebuilt.ok) throw new Error("unreachable");
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
  const tree: TreeState = { commitSha: "node-build-revise-test-fixture-tree", clean: true };
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
  const result = await proveUnit(spec);
  assert.equal(result.ok, false, "ground truth: the fixture attempt must be a returned escalation, not a pass");
  if (result.ok) throw new Error("unreachable");
  assert.notEqual(result.escalation, undefined, "ground truth: the fixture attempt must carry a returned escalation");
  return result;
}

// ── The `--real` fixture: one unit with no install/db/addDeps arm, so nothing beyond the injected ──
// DB preflight is ever reached.

interface RealFixture {
  repoRoot: string;
  storiesDir: string;
  corpusStore: InMemoryStore;
}

async function setupRealFixture(): Promise<RealFixture> {
  const repo = await fixtureRepo(false);
  const storiesDir = await fixtureStories([{ id: FIXTURE_UNIT_ID, dependsOn: [] }]);
  const corpusStore = new InMemoryStore();
  await loadFixtureCorpus(corpusStore);
  // ADR-0576 D1: a REAL build now preflights an --increment before any spend. This fixture's own
  // tests never exercise that preflight (each one dies at an earlier refusal, or at the injected
  // DB-preflight spy), but the one test that DOES fall through to the DB preflight now needs a live
  // increment to resolve against.
  await corpusStore.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  await corpusStore.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
  return { repoRoot: repo.root, storiesDir, corpusStore };
}

async function teardownRealFixture(fx: RealFixture): Promise<void> {
  await fsp.rm(fx.repoRoot, { recursive: true, force: true });
  await fsp.rm(fx.storiesDir, { recursive: true, force: true });
}

/** A spy `ensureDb`: refuses immediately, and counts every call it received. */
function spyingEnsureDb() {
  const calls = { count: 0 };
  return {
    calls,
    ensureDb: async (): Promise<EnsureDbResult> => {
      calls.count += 1;
      return { ok: false, reason: "NODE_BUILD_REVISE_TEST_SPY_ENSURE_DB_MUST_NOT_RUN_BEFORE_THE_REVISION_READ" };
    },
  };
}

let realFixture!: RealFixture;
let tmpRoot!: string;

before(async () => {
  realFixture = await setupRealFixture();
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "node-build-revise-test-"));
});

after(async () => {
  await teardownRealFixture(realFixture);
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe("node-build-takes-a-revision-and-names-the-record-it-leaves: node build --real reads the named run's revision record before any spend, refuses a missing or foreign one, passes it to the REAL lifecycle, and names the record a failed build leaves together with the command that revises against it", () => {
  // ── The mode check: --revise-test is real-only ──────────────────────────────────────────────────

  test("--revise-test without --real is refused before the signer resolves or the spec loads, naming --revise-test and --real", async () => {
    const unitId = "no-such-node-fixture-for-revise-test";
    const runId = "some-prior-run-id";
    const expected = {
      ok: false,
      body:
        "--revise-test is valid only with --real: it hands a prior attempt's returned escalation to " +
        "the AUTHOR_TEST leaf as this REAL build's revision brief, and neither --dry-run nor --live " +
        "authors at real repo paths (ADR-0571 D3).",
      next: [`storytree node build ${unitId} --real --increment <increment-id> --revise-test ${runId}`],
    };

    const dryRun = await NodeBuildModule.nodeBuild(unitId, {
      dryRun: true,
      actor: "tester@example.com",
      reviseTest: runId,
    });
    assert.deepEqual(dryRun, expected, "--dry-run + --revise-test must be refused, exactly");

    const live = await NodeBuildModule.nodeBuild(unitId, {
      dryRun: false,
      live: true,
      actor: "tester@example.com",
      reviseTest: runId,
    });
    assert.deepEqual(live, expected, "--live + --revise-test must be refused, exactly the same way");

    // Ordering: the refusal fires for a unit id that resolves to NO spec at all, and it never
    // mentions "no node spec" — proving it precedes spec lookup (and, since the existing signer
    // resolution in this function already precedes spec lookup too, an `actor` is supplied above so
    // this case can never be confused with a signer refusal either).
    assert.doesNotMatch(dryRun.body, /no node spec/);
  });

  test("without --revise-test a non-real build is never refused by the mode check — it reaches the spec load", async () => {
    // The mode check's `reviseTest !== undefined` half: every other case here either supplies the
    // flag or runs --real, so without this one a mode check that refused EVERY non-real build would
    // pass the file. An unknown unit id keeps it instant — the spec-load refusal is the next gate.
    const env = await NodeBuildModule.nodeBuild("node-build-revise-test-no-such-unit", {
      dryRun: true,
      actor: "tester@example.com",
      progress: silentBuildProgress(),
    });
    assert.equal(env.ok, false);
    assert.match(env.body, /^no node spec "node-build-revise-test-no-such-unit" under /);
    assert.doesNotMatch(env.body, /--revise-test/);
  });

  test("--revise-test WITH --real is never refused by the mode check — it falls through to the revision read", async () => {
    const { ensureDb } = spyingEnsureDb();
    const built = await NodeBuildModule.nodeBuild(FIXTURE_UNIT_ID, {
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      repoRoot: realFixture.repoRoot,
      storiesDir: realFixture.storiesDir,
      corpusStore: realFixture.corpusStore,
      progress: silentBuildProgress(),
      reviseTest: "a-run-id-with-no-record-yet",
      escalationsDir: path.join(tmpRoot, "mode-check-control"),
      ensureDb,
    });
    assert.doesNotMatch(
      built.body,
      /--revise-test is valid only with --real/,
      "a --real build must never be refused by the real-only mode check",
    );
    // It still does not reach the DB preflight, because the (missing) revision refuses first —
    // pinned precisely by the dedicated test below; here we only rule out the MODE refusal.
  });

  // ── The read, before any spend: refuses a missing revision ──────────────────────────────────────

  test("a missing named revision refuses with readTestRevision's own reason, verbatim, and never reaches the DB preflight", async () => {
    const { ensureDb, calls } = spyingEnsureDb();
    const escalationsDir = path.join(tmpRoot, "missing-revision");
    const runId = "run-id-with-no-record-anywhere";

    const expectedRead = NodeBuildModule.readTestRevision(escalationsDir, FIXTURE_UNIT_ID, runId);
    assert.equal(expectedRead.ok, false, "ground truth: reading a nonexistent record must refuse");
    if (expectedRead.ok) return;

    const built = await NodeBuildModule.nodeBuild(FIXTURE_UNIT_ID, {
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      repoRoot: realFixture.repoRoot,
      storiesDir: realFixture.storiesDir,
      corpusStore: realFixture.corpusStore,
      progress: silentBuildProgress(),
      reviseTest: runId,
      escalationsDir,
      ensureDb,
    });

    assert.deepEqual(
      built,
      { ok: false, body: expectedRead.reason, next: [] },
      "the build's refusal must be exactly readTestRevision's own reason, with no next: suggestions",
    );
    assert.equal(
      calls.count,
      0,
      "the DB preflight (ensureDb) must never run when the named revision fails to read",
    );
  });

  // ── The read, before any spend: refuses a foreign revision (a stored record naming another unit) ──

  test("a foreign named revision (its record names a different unitId) refuses with readTestRevision's own reason, verbatim, and never reaches the DB preflight", async () => {
    const { ensureDb, calls } = spyingEnsureDb();
    const escalationsDir = path.join(tmpRoot, "foreign-revision");
    const runId = "run-id-with-a-foreign-record";
    const filePath = NodeBuildModule.revisionRecordPath(escalationsDir, FIXTURE_UNIT_ID, runId);
    await fsp.mkdir(path.dirname(filePath), { recursive: true });
    await fsp.writeFile(
      filePath,
      JSON.stringify({ unitId: "a-completely-different-unit-than-cap-a", runId }),
      "utf8",
    );

    const expectedRead = NodeBuildModule.readTestRevision(escalationsDir, FIXTURE_UNIT_ID, runId);
    assert.equal(expectedRead.ok, false, "ground truth: a record naming a different unit must refuse");
    if (expectedRead.ok) return;
    assert.match(expectedRead.reason, new RegExp(escapeRegExp("a-completely-different-unit-than-cap-a")));
    assert.match(expectedRead.reason, new RegExp(escapeRegExp(FIXTURE_UNIT_ID)));

    const built = await NodeBuildModule.nodeBuild(FIXTURE_UNIT_ID, {
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      repoRoot: realFixture.repoRoot,
      storiesDir: realFixture.storiesDir,
      corpusStore: realFixture.corpusStore,
      progress: silentBuildProgress(),
      reviseTest: runId,
      escalationsDir,
      ensureDb,
    });

    assert.deepEqual(
      built,
      { ok: false, body: expectedRead.reason, next: [] },
      "the build's refusal must be exactly readTestRevision's own reason for the foreign record",
    );
    assert.equal(
      calls.count,
      0,
      "the DB preflight (ensureDb) must never run when the named revision names a foreign unit",
    );
  });

  // ── The read, before any spend: a VALID revision is never refused for the revision itself ────────

  test("a genuinely written, matching revision is never refused by the revision read — the build proceeds to the DB preflight", async () => {
    const escalationsDir = path.join(tmpRoot, "valid-revision");
    const runId = "run-id-with-a-genuine-record";
    const priorResult = await driveEscalatingProveUnit({
      unitId: FIXTURE_UNIT_ID,
      runId,
      testId: "test-id-for-the-valid-revision",
      statement: "VALID_REVISION_STATEMENT_MARKER",
    });
    const written = await NodeBuildModule.writeRevisionRecord(
      escalationsDir,
      FIXTURE_UNIT_ID,
      runId,
      priorResult,
    );
    assert.notEqual(written, null, "ground truth: writing a returned escalation must not return null");
    if (written === null) return;
    assert.equal(written.written, true, "ground truth: the write must succeed");

    const { ensureDb, calls } = spyingEnsureDb();
    const built = await NodeBuildModule.nodeBuild(FIXTURE_UNIT_ID, {
      dryRun: false,
      real: true,
      actor: "tester@example.com",
      repoRoot: realFixture.repoRoot,
      storiesDir: realFixture.storiesDir,
      corpusStore: realFixture.corpusStore,
      progress: silentBuildProgress(),
      reviseTest: runId,
      escalationsDir,
      increment: "inc-live",
      buildGuardFactory: offlineBuildGuardFactory,
      innerLoopReads: { corpus: realFixture.corpusStore, ledger: new InMemoryStore() },
      ensureDb,
    });

    assert.equal(
      calls.count,
      1,
      "a valid, matching revision must fall through the revision read into the DB preflight",
    );
    assert.equal(
      built.body,
      "--real persists to the live store, but the database could not be brought up:\n" +
        "NODE_BUILD_REVISE_TEST_SPY_ENSURE_DB_MUST_NOT_RUN_BEFORE_THE_REVISION_READ",
      "past the revision read, the build's own DB-preflight refusal is what runs next",
    );
  });

  // ── renderRevisingLine: [] for no revision, one exact line naming run id, phase and test id ──────

  test("renderRevisingLine returns [] for an undefined revision, and is published as a function", () => {
    assert.equal(typeof renderRevisingLineRaw, "function");
    const renderRevisingLine = mustGetRenderRevisingLine();
    assert.deepEqual(renderRevisingLine(undefined), []);
  });

  test("renderRevisingLine names the prior run id, the raising phase and the test id, and says this build is an ADR-0563 D6 test revision — one D4 attempt, `revised-test` — for a genuine AUTHOR_TEST escalation", async () => {
    const runId = "renders-author-test-run-id";
    const testId = "renders-author-test-test-id";
    const priorResult = await driveEscalatingProveUnit({
      unitId: "renders-author-test-unit-fixture",
      runId,
      testId,
      statement: "RENDERS_AUTHOR_TEST_STATEMENT_MARKER",
    });
    const escalation = priorResult.escalation;
    assert.notEqual(escalation, undefined, "ground truth: the fixture must carry a returned escalation");
    if (escalation === undefined) return;
    const revision: TestRevision = { unitId: "renders-author-test-unit-fixture", runId, escalation };

    const renderRevisingLine = mustGetRenderRevisingLine();
    const rendered = renderRevisingLine(revision);

    assert.deepEqual(rendered, [
      `revising:    run ${runId} (AUTHOR_TEST escalation, test ${testId}) — this build is an ADR-0563 D6 test revision: one D4 attempt, \`revised-test\`.`,
    ]);
  });

  test("renderRevisingLine names an IMPLEMENT-kind revision's phase correctly — never hardcoded to AUTHOR_TEST", () => {
    const built = parseAuthoringEscalation("IMPLEMENT", {
      statement: "RENDERS_IMPLEMENT_STATEMENT_MARKER",
      assertion: "assert.ok(true)",
    });
    assert.equal(built.ok, true, "ground truth: parseAuthoringEscalation must accept this input");
    if (!built.ok) return;
    const escalation: EscalationRecord = { raised: built.escalation, testId: "renders-implement-test-id" };
    const revision: TestRevision = {
      unitId: "renders-implement-unit-fixture",
      runId: "renders-implement-run-id",
      escalation,
    };

    const renderRevisingLine = mustGetRenderRevisingLine();
    const rendered = renderRevisingLine(revision);

    assert.deepEqual(rendered, [
      "revising:    run renders-implement-run-id (IMPLEMENT escalation, test renders-implement-test-id) — this build is an ADR-0563 D6 test revision: one D4 attempt, `revised-test`.",
    ]);
  });

  // ── renderRevisionRecord: [] for no write, one line naming the path + the exact re-run command ────

  test("renderRevisionRecord returns [] when there is no write, and is published as a function", () => {
    assert.equal(typeof renderRevisionRecordRaw, "function");
    const renderRevisionRecord = mustGetRenderRevisionRecord();
    assert.deepEqual(renderRevisionRecord("some-unit", "some-run", "codex", undefined), []);
  });

  test("renderRevisionRecord names the path and the exact re-run command — carrying the SAME runtime the build ran, for each runtime", () => {
    const renderRevisionRecord = mustGetRenderRevisionRecord();
    for (const runtime of ["codex", "claude", "pi"] as const) {
      const write = { written: true as const, path: `/tmp/escalations/${runtime}/some-run.json` };
      const rendered = renderRevisionRecord("some-unit", "some-run", runtime, write);
      assert.deepEqual(rendered, [
        `revision:    written to ${write.path} — re-run with: storytree node build some-unit --real --runtime ${runtime} --revise-test some-run`,
      ]);
    }
  });

  test("renderRevisionRecord names the path and the reason, and never a command, when the write failed", () => {
    const renderRevisionRecord = mustGetRenderRevisionRecord();
    const write = {
      written: false as const,
      path: "/tmp/escalations/some-unit/some-run.json",
      reason: "EACCES: permission denied",
    };
    const rendered = renderRevisionRecord("some-unit", "some-run", "codex", write);
    assert.deepEqual(rendered, [
      `revision:    NOT written (${write.path}): ${write.reason} — relay the escalation block above to the owner by hand`,
    ]);
    assert.doesNotMatch(
      rendered.join("\n"),
      /storytree node build/,
      "an unwritten record names no command — there is nothing on disk to revise against",
    );
  });
});
