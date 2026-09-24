import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { InMemoryStore } from "@storytree/storage-protocol";
import { loadFixtureCorpus } from "@storytree/library/fixture";
import type { Store } from "@storytree/storage-protocol";
import { FileToolExecutor, FILE_WRITE_TOOLS } from "@storytree/agent";
import type { PhaseAuthor } from "@storytree/agent";
import {
  OwnedLoopAuthor,
  PathWriteScope,
  rollupStatus,
  rollupStoryGreen,
  scriptedWriterModel,
} from "@storytree/orchestrator";
import type { DecisionFork, NodeSpec } from "@storytree/orchestrator";
import type { ReliabilityGate } from "@storytree/library";
import { silentBuildProgress } from "@storytree/drive";
import type { BuildGuardFactory } from "@storytree/drive";

import { driveBuildTestsGate, gateRetryCommand } from "./gate-build-driver.js";
import type { GateBuildDriverDeps } from "./gate-build-driver.js";
import { makeGateDeps } from "./commands.js";

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

/**
 * The gate's corpus, plus the increment rows ADR-0576's before-spend preflight resolves against
 * (`gate-real-build-names-its-increment`) — an active `inc-live` and a closed `inc-closed`.
 */
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


/**
 * ADR-0098 (U2) — the gate→loop wiring, proven OFFLINE: a `build-tests` gate carrying a
 * `(build: <node-id>)` reference is driven through the REAL prove-it-gate by a SCRIPTED leaf over a
 * throwaway git fixture (no DB, no API key, no SDK spend). The fixture's existing source is CORRECT
 * but UNTESTABLE-as-is (no `double` seam); the leaf authors a structural-seam red test, then a
 * behaviour-preserving refactor → the WHOLE-suite regression wall goes green → a DRIVEN-tier verdict
 * is signed FOR THE GATE id. The spine's own commit + git-state seams run for real against the
 * worktree; only the leaf's authorship is scripted.
 */

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

const CAP_ID = "seed-corpus-scripts";
function buildTestsGate(over: Partial<ReliabilityGate> = {}): ReliabilityGate {
  return {
    id: "fix-story#gate-1",
    title: "Seed orchestration gets a tested seam",
    kind: "build-tests",
    covers: [CAP_ID],
    buildNode: "seed-runner",
    retired: false,
    ...over,
  };
}

/**
 * An explicit OFFLINE run-lease factory (`gate-build-holds-a-run-lease`). A REAL gate drive that
 * resolves a valid increment now acquires its shared run lease before the policy fold; production
 * omits the seam and opens the shared claim store, so every drive here that reaches admission injects
 * this no-op guard instead — the suite never falls through to a live pool.
 */
function offlineGuardFactory(): BuildGuardFactory {
  return async ({ runId }) => ({
    ok: true,
    runId,
    guard: { assertHeld: async () => {}, noteActivity: async () => {}, release: async () => {} },
  });
}

// ── the load-bearing R2 walk ─────────────────────────────────────────────────

// test-updated (refactor): "drives a build-tests gate's R2 red→green and signs a DRIVEN verdict FOR the gate id; the gate greens its covered cap" — injects the explicit offline buildGuardFactory so the admitted drive holds a hermetic run lease; same claims.

test("drives a build-tests gate's R2 red→green and signs a DRIVEN verdict FOR the gate id; the gate greens its covered cap", async () => {
  const stories = await fixtureStories();
  const repo = await fixtureRepo();
  const store: Store = new InMemoryStore();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    const gate = buildTestsGate();
    const env = await driveBuildTestsGate(gate, "builder@example.com", {
      corpusStore: corpus,
      progress: silentBuildProgress(), // the offline driver asserts the ENVELOPE, not the liveness chatter
      storiesDir: stories,
      repoRoot: repo,
      store, // the test OWNS the store, so it can roll up the events below
      promote: false, // no remote to push to
      authorOverride: scriptedR2Author,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: store },
      buildGuardFactory: offlineGuardFactory(),
    });
    assert.equal(env.ok, true, env.body);
    assert.match(env.body, /gate run fix-story#gate-1 — BUILD-TESTS \(REAL\)/);
    assert.match(env.body, /build node:  seed-runner/);
    // A DRIVEN tier (integration-test → capability), NEVER adopted (ADR-0098 d.4).
    assert.match(env.body, /proof mode:  integration-test → capability/);
    assert.match(env.body, /a DRIVEN tier, never adopted/);
    assert.match(env.body, /rollup:      healthy/);

    const events = await store.readEvents();
    // The signed verdict attributes to the GATE id (not the referenced node id).
    assert.equal(rollupStatus(gate.id, events), "healthy");
    assert.equal(rollupStatus("seed-runner", events), null, "the verdict signs FOR the gate, not the build node");
    // ADR-0098 d.4: the verdict carries the referenced node's DRIVEN tier (integration-test →
    // capability), NEVER `adopted` — a build-tests green is strong driven provenance, not observe.
    const verdicts = events
      .map((e) => e.doc as { unitId?: string; proofMode?: string; outcome?: string })
      .filter((d) => d.unitId === gate.id && d.proofMode !== undefined);
    assert.equal(verdicts.length, 1, "exactly one signed verdict for the gate id");
    assert.equal(verdicts[0]!.outcome, "pass");
    assert.equal(verdicts[0]!.proofMode, "capability");
    assert.notEqual(verdicts[0]!.proofMode, "adopted");
    // ADR-0097: the gate's `(covers:)` greens the brownfield capability. The gate is BOTH an own-proof
    // obligation (the second arg) AND the coverage source (the fourth) — exactly how `story build`
    // rolls the crown (`[...uat, ...gates]` as obligations, `reliabilityGates` as coverage).
    // ADR-0443 D1: the capability clause reads each cap's authored status beside its id; this fixture
    // cap has no spec status, which counts as UNDERTAKEN (the conservative default).
    assert.equal(rollupStoryGreen([{ id: CAP_ID }], [gate], events, [gate]), "healthy");
    // Without the gate's coverage the brownfield cap is unproven — the gate is what greens it.
    assert.equal(rollupStoryGreen([{ id: CAP_ID }], [], events, []), null);
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});

// test-updated (refactor): "U3 regression wall: an R2 refactor that REGRESSES the sibling test reds the suite → no verdict signed" — injects the explicit offline buildGuardFactory; same claims.
test("U3 regression wall: an R2 refactor that REGRESSES the sibling test reds the suite → no verdict signed", async () => {
  const stories = await fixtureStories();
  const repo = await fixtureRepo();
  const store: Store = new InMemoryStore();
  try {
    // The refactor introduces `double` (its own test passes) BUT regresses run() (now [3,5,7]) — the
    // pre-existing run.test.mjs goes red, so the WHOLE suite is red at CONFIRM_GREEN: no green signed.
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
    const corpus = await fixtureCorpusWithIncrements();
    const env = await driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus,
      progress: silentBuildProgress(), // the offline driver asserts the ENVELOPE, not the liveness chatter
      storiesDir: stories,
      repoRoot: repo,
      store,
      promote: false,
      authorOverride: regressingAuthor,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: store },
      buildGuardFactory: offlineGuardFactory(),
    });
    assert.equal(env.ok, false, env.body);
    assert.match(env.body, /failed closed at CONFIRM_GREEN/);
    // Halt is never a pass: no signed verdict, so the gate never greens (it stalls at the `building`
    // lifecycle mark — a regression can NEVER turn the gate healthy, the U3 regression-wall guarantee).
    assert.notEqual(rollupStatus("fix-story#gate-1", await store.readEvents()), "healthy");
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});

// ── U4: the pre-build batch decision-sweep (ADR-0098 d.5) ─────────────────────

/** A routine within-pocket fork (trips none of the three d.5 signals — the leaf owns it). */
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

// test-updated (refactor): "U4 — an UNRESOLVED key design fork HALTS the drive before any spend (no worktree, no verdict signed)" — a valid increment now reaches lease admission before the sweep, so the drive injects the explicit offline buildGuardFactory; same claims.
test("U4 — an UNRESOLVED key design fork HALTS the drive before any spend (no worktree, no verdict signed)", async () => {
  const stories = await fixtureStories();
  const store: Store = new InMemoryStore();
  try {
    // A fork that changes a public seam other code depends on = the owner's call (d.5 bar). Unresolved,
    // so the sweep blocks. The halt is BEFORE store/worktree, so repoRoot is never touched (`.` is fine).
    const corpus = await fixtureCorpusWithIncrements();
    const env = await driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus,
      progress: silentBuildProgress(), // the offline driver asserts the ENVELOPE, not the liveness chatter
      storiesDir: stories,
      repoRoot: ".",
      store,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: store },
      buildGuardFactory: offlineGuardFactory(),
      decisionForks: [
        routineFork({
          id: "runseed-seam",
          question: "Should runSeed inject a Pool, or the built Store + a comment-loader fn?",
          changesPublicSeam: true,
        }),
      ],
    });
    assert.equal(env.ok, false, env.body);
    assert.match(env.body, /HALTED fix-story#gate-1 \(pocket: seed-runner\)/);
    assert.match(env.body, /Should runSeed inject a Pool/);
    assert.match(env.body, /changes a public seam/);
    // Halt is never a pass: nothing was signed (no spend, no verdict for the gate id).
    assert.equal(rollupStatus("fix-story#gate-1", await store.readEvents()), null);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

// test-updated (refactor): "U4 — a ROUTINE choice + a RESOLVED key fork sweep CLEAR; the drive proceeds to a signed green" — injects the explicit offline buildGuardFactory; same claims.
test("U4 — a ROUTINE choice + a RESOLVED key fork sweep CLEAR; the drive proceeds to a signed green", async () => {
  const stories = await fixtureStories();
  const repo = await fixtureRepo();
  const store: Store = new InMemoryStore();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    const env = await driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus,
      progress: silentBuildProgress(), // the offline driver asserts the ENVELOPE, not the liveness chatter
      storiesDir: stories,
      repoRoot: repo,
      store,
      promote: false,
      authorOverride: scriptedR2Author,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: store },
      buildGuardFactory: offlineGuardFactory(),
      decisionForks: [
        routineFork({ id: "helper-name", question: "What to name the extracted helper?" }), // routine — leaf decides
        routineFork({
          id: "extract-strategy",
          question: "Extract a runSeed(deps) core, or inline the orchestration?",
          materiallyDifferentStrategies: true,
          resolution: "Extract a behaviour-preserving runSeed(deps) core (owner-settled).",
        }),
      ],
    });
    assert.equal(env.ok, true, env.body);
    // The sweep summary is surfaced (observability-first): 1 key fork resolved + threaded, 1 routine.
    assert.match(env.body, /decisions:   1 key \(1 resolved → threaded\), 1 routine — swept CLEAR before spend/);
    assert.match(env.body, /rollup:      healthy/);
    // The drive ran for real: a DRIVEN verdict is signed for the gate id (the resolved fork did not block it).
    assert.equal(rollupStatus("fix-story#gate-1", await store.readEvents()), "healthy");
  } finally {
    await rm(stories, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  }
});

// ── fail-closed refusals (no worktree, no spend) ──────────────────────────────

test("refuses a build-tests gate with no (build:) reference", async () => {
  const env = await driveBuildTestsGate(buildTestsGate({ buildNode: undefined }), "builder@example.com", {
    corpusStore: await fixtureCorpus(),
      progress: silentBuildProgress(), // the offline driver asserts the ENVELOPE, not the liveness chatter
    storiesDir: ".",
    repoRoot: ".",
    store: new InMemoryStore(),
  });
  assert.equal(env.ok, false);
  assert.match(env.body, /names no build to drive/);
});

test("refuses when the referenced build node spec does not exist", async () => {
  const stories = await fixtureStories();
  try {
    const env = await driveBuildTestsGate(buildTestsGate({ buildNode: "ghost-node" }), "builder@example.com", {
      corpusStore: await fixtureCorpus(),
      progress: silentBuildProgress(), // the offline driver asserts the ENVELOPE, not the liveness chatter
      storiesDir: stories,
      repoRoot: ".",
      store: new InMemoryStore(),
    });
    assert.equal(env.ok, false);
    assert.match(env.body, /references build node "ghost-node"/);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

/**
 * A node builder that returns immediately without cutting a worktree or authoring anything.
 *
 * It exists for the mutation rung, not for the assertions: when a budget guard below is mutated
 * away, the drive does not fail — it PROCEEDS into a real build and runs until Stryker's per-mutant
 * budget expires, which is scored UNPROVEN rather than killed (playbook §1: "a mutated guard does
 * not fail, it hangs"). With this seam the mutated path finishes in milliseconds and the assertion
 * that the refusal never came does the killing.
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

test("a gate drive reads --time-budget and refuses a figure that cannot bound a build, before any spend (ADR-0581 D2)", async () => {
  // A gate drive is ALWAYS a real build, so unlike `node build` there is no non-real route to narrow
  // to here — `{ real: true }` is passed unconditionally, and that is what this asserts: a gate drive
  // must never be exempted from the clock by reading itself as some other route.
  const stories = await fixtureStories();
  const store: Store = new InMemoryStore();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    for (const raw of ["0", "-5", "abc"]) {
      const env = await driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
        corpusStore: corpus,
        progress: silentBuildProgress(),
        storiesDir: stories,
        repoRoot: ".", // never touched: the refusal precedes the worktree cut
        store,
        increment: "inc-live",
        innerLoopReads: { corpus, ledger: store },
        realNodeBuilder: refusingBuilder(),
        timeBudget: raw,
      });
      assert.equal(env.ok, false, raw);
      assert.match(env.body, /--time-budget must be a positive number of minutes/, raw);
      assert.match(env.body, new RegExp(`got "${raw}"`), raw);
      // The retry command, which is what an operator acts on — an empty `next` leaves the refusal
      // with no way forward.
      assert.deepEqual(env.next, [gateRetryCommand(buildTestsGate().id, "inc-live")], raw);
      // Refused is not signed: a rejected flag must leave no verdict behind.
      assert.equal(rollupStatus("fix-story#gate-1", await store.readEvents()), null, raw);
    }
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

// test-updated (refactor): "a gate drive with a VALID --time-budget is not refused by the budget check" — its valid increment reaches lease admission, so it injects the explicit offline buildGuardFactory; same claims.
test("a gate drive with a VALID --time-budget is not refused by the budget check", async () => {
  // The other side: without this, a check that refused every value would satisfy the test above.
  // This drive goes on to fail for its own unrelated reasons; what matters is that the failure is
  // not the budget's.
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
      buildGuardFactory: offlineGuardFactory(),
      timeBudget: "45",
      decisionForks: [
        routineFork({
          id: "runseed-seam",
          question: "Should runSeed inject a Pool, or the built Store + a comment-loader fn?",
          changesPublicSeam: true,
        }),
      ],
    });
    assert.equal(env.ok, false);
    assert.doesNotMatch(env.body, /--time-budget/);
    assert.match(env.body, /HALTED/, "it got past the budget check to the fork sweep");
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});

test("gate run's dispatch threads --time-budget from argv into the gate drive (makeGateDeps)", async () => {
  // The one failure no unit test of the driver can see: a flag the DISPATCH never delivers. The
  // driver's own budget tests above pass a `timeBudget` directly, so they stay green whatever argv
  // key `makeGateDeps` reads — including none at all. This drives the composition instead, and
  // observes the refusal that only a delivered flag can produce.
  const stories = await fixtureStories();
  const store: Store = new InMemoryStore();
  try {
    const corpus = await fixtureCorpusWithIncrements();
    const gateDeps = makeGateDeps(
      { store: new InMemoryStore() },
      { real: true, increment: "inc-live", "time-budget": "0" },
      stories,
      {
        corpusStore: corpus,
        innerLoopReads: { corpus, ledger: store },
        progress: silentBuildProgress(),
        store,
        repoRoot: ".", // never touched: the refusal precedes the worktree cut
        promote: false,
        realNodeBuilder: refusingBuilder(),
      },
    );
    const drive = gateDeps.driveBuildTestsGate;
    assert.equal(typeof drive, "function", "makeGateDeps must wire a driveBuildTestsGate");
    if (typeof drive !== "function") return;
    const env = await drive(buildTestsGate(), "builder@example.com");
    assert.equal(env.ok, false);
    assert.match(env.body, /--time-budget must be a positive number of minutes/);
    assert.match(env.body, /got "0"/);
  } finally {
    await rm(stories, { recursive: true, force: true });
  }
});
