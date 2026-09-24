import test, { after, before } from "node:test";
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
  buildGuardRefusalBody,
  buildNodeReal,
  innerLoopRefusalEnvelope,
  preflightInnerLoop,
} from "@storytree/drive";
import type {
  BuildGuard,
  BuildGuardResult,
  BuildProgress,
  RealBuildArgs,
  RealBuildResult,
  StoryRealNodeBuilder,
} from "@storytree/drive";

import { driveBuildTestsGate } from "./gate-build-driver.js";
import type { GateBuildDriverDeps } from "./gate-build-driver.js";
import type { Envelope } from "./envelope.js";

/**
 * `gate-build-holds-a-run-lease` — a REAL build-tests gate drive acquires its shared run lease
 * before the authoritative policy read or any spend, carries it through the gate lifecycle, and
 * releases it on every exit.
 *
 * Every drive here is production `driveBuildTestsGate` over a throwaway git fixture, an in-memory
 * ledger/store and an EXPLICIT offline `buildGuardFactory` that records acquisition, checkpoints and
 * release. Every pre-spend refusal case also carries a throwing `authorOverride` and a throwing
 * `realNodeBuilder` named `pre-author fallback`, and a progress reporter that trips on the worktree and
 * gate legs, so a driver that ignores the factory still stays offline. Only the success walks use the
 * canned scripted author. The primitive's shared-Postgres race is `build-guard.test.ts`'s evidence,
 * and the observed-activity proof is drive's — this file proves the gate's public guard seam only.
 *
 * Fixture helpers are COPIED from `gate-build-driver.test.ts` (importing a test file would register
 * its tests in this proof).
 */

const execFileP = promisify(execFile);
async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileP("git", args, { cwd });
  return stdout;
}

const GATE_ID = "fix-story#gate-1";
const BUILD_NODE = "seed-runner";
const FIXTURE_DIR = "packages/fixture";
const SOURCE_FILE = `${FIXTURE_DIR}/calc.mjs`;
const TEST_FILE = `${FIXTURE_DIR}/double.test.mjs`;
const GATE_RUN_ID = /^gate-real-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function fixtureRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "storytree-gate-lease-"));
  await git(["init", "-b", "main"], root);
  await git(["config", "user.email", "fixture@storytree.invalid"], root);
  await git(["config", "user.name", "fixture"], root);
  await mkdir(path.join(root, FIXTURE_DIR), { recursive: true });
  await writeFile(
    path.join(root, SOURCE_FILE),
    "export function run() {\n  const out = [];\n  for (const n of [1, 2, 3]) out.push(n * 2);\n  return out;\n}\n",
  );
  await writeFile(
    path.join(root, `${FIXTURE_DIR}/run.test.mjs`),
    'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
      'import { run } from "./calc.mjs";\ntest("run doubles 1..3", () => assert.deepEqual(run(), [2, 4, 6]));\n',
  );
  await git(["add", "-A"], root);
  await git(["-c", "commit.gpgsign=false", "commit", "-m", "fixture: existing calc (no seam)"], root);
  return root;
}

function nodeSpecLines(id: string, withReal: boolean): string[] {
  return [
    "---",
    `id: "${id}"`,
    "tier: capability",
    'story: "fix-story"',
    `title: "${id}"`,
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
    ...(withReal
      ? [
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
        ]
      : []),
    "---",
    `# ${id}`,
    "",
  ];
}

/** The referenced R2 build node, plus one node with no `real:` arm (the config refusal). */
async function fixtureStories(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "storytree-gate-lease-stories-"));
  const storyDir = path.join(dir, "fix-story");
  await mkdir(storyDir, { recursive: true });
  await writeFile(path.join(storyDir, `${BUILD_NODE}.md`), nodeSpecLines(BUILD_NODE, true).join("\n"));
  await writeFile(path.join(storyDir, "no-real-node.md"), nodeSpecLines("no-real-node", false).join("\n"));
  return dir;
}

async function fixtureCorpusWithIncrements(): Promise<InMemoryStore> {
  const corpus = new InMemoryStore();
  await loadFixtureCorpus(corpus);
  await corpus.upsertDoc({
    id: "inc-live",
    kind: "increment",
    doc: { kind: "increment", arcRef: "asset:some-arc", status: "active" },
  });
  await corpus.upsertDoc({ id: "some-arc", kind: "arc", doc: { kind: "arc" } });
  return corpus;
}

const SEAM_TEST =
  'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
  'import { double } from "./calc.mjs";\ntest("double doubles", () => assert.equal(double(3), 6));\n';
const REFACTORED =
  "export function double(n) {\n  return n * 2;\n}\n" +
  "export function run() {\n  return [1, 2, 3].map(double);\n}\n";

function scriptedR2Author(_spec: NodeSpec, worktreeRoot: string): PhaseAuthor {
  return new OwnedLoopAuthor({
    model: scriptedWriterModel([
      { path: TEST_FILE, content: SEAM_TEST },
      { path: SOURCE_FILE, content: REFACTORED },
    ]),
    tools: new FileToolExecutor({ rootDir: worktreeRoot }),
    scope: new PathWriteScope({ testGlobs: [TEST_FILE], sourceGlobs: [SOURCE_FILE] }),
    writeTools: FILE_WRITE_TOOLS,
  });
}

function buildTestsGate(over: Partial<ReliabilityGate> = {}): ReliabilityGate {
  return {
    id: GATE_ID,
    title: "Seed orchestration gets a tested seam",
    kind: "build-tests",
    covers: ["seed-corpus-scripts"],
    buildNode: BUILD_NODE,
    retired: false,
    ...over,
  };
}

/** An UNRESOLVED key fork: a sweep that ran first would HALT with it. */
const KEY_FORK: DecisionFork = {
  id: "runseed-seam",
  question: "Should runSeed inject a Pool, or the built Store + a comment-loader fn?",
  changesPublicSeam: true,
  materiallyDifferentStrategies: false,
  crossCuttingOrIrreversible: false,
};

const COLLISION_REFUSAL = {
  unitId: `build:${GATE_ID}`,
  holderRunId: "gate-real-other-holder",
  startAgeMs: 4321,
  heartbeatAgeMs: 765,
  classification: "LIVE" as const,
};
const COLLISION: BuildGuardResult = { ok: false, refusal: COLLISION_REFUSAL };

// ── recorders (never assert — they only record what the drive reached) ──────────────────────────

interface Recorder {
  events: string[];
  acquisitions: Array<{ runId: string; unitIds: readonly string[] }>;
}

function recorder(): Recorder {
  return { events: [], acquisitions: [] };
}

function recordingGuard(rec: Recorder, assertHeld: () => Promise<void> = async () => {}): BuildGuard {
  return {
    noteActivity: async () => {
      rec.events.push("activity");
    },
    assertHeld: async () => {
      rec.events.push("checkpoint");
      await assertHeld();
    },
    release: async () => {
      rec.events.push("release");
    },
  };
}

function grantingFactory(rec: Recorder, guard: BuildGuard): NonNullable<GateBuildDriverDeps["buildGuardFactory"]> {
  return async (input) => {
    rec.acquisitions.push({ runId: input.runId, unitIds: [...input.unitIds] });
    rec.events.push("acquire");
    return { ok: true, runId: input.runId, guard };
  };
}

/** Every method call on the wrapped store is recorded as `<tag>:<method>`. */
function recordingStore(target: Store, tag: string, rec: Recorder): Store {
  return new Proxy(target, {
    get(t, prop, receiver) {
      const value = Reflect.get(t, prop, receiver) as unknown;
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        rec.events.push(`${tag}:${String(prop)}`);
        return (value as (...a: unknown[]) => unknown).apply(t, args);
      };
    },
  });
}

function recordingLedger(target: Pick<Store, "readEvents">, rec: Recorder): Pick<Store, "readEvents"> {
  return {
    readEvents: async (...args: Parameters<Store["readEvents"]>) => {
      rec.events.push("policy");
      return target.readEvents(...args);
    },
  };
}

/** A progress reporter that records every leg and TRIPS on the worktree and gate legs. */
function trippingProgress(rec: Recorder): BuildProgress {
  return {
    stage: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      rec.events.push(`stage:${name}`);
      if (name.startsWith("worktree") || name.startsWith("gate (")) {
        throw new Error(`refusal-only stage tripwire: ${name}`);
      }
      return work();
    },
    note: (detail: string) => {
      rec.events.push(`note:${detail}`);
    },
  };
}

function recordingProgress(rec: Recorder): BuildProgress {
  return {
    stage: async <T>(name: string, work: () => Promise<T>): Promise<T> => {
      rec.events.push(`stage:${name}`);
      return work();
    },
    note: (detail: string) => {
      rec.events.push(`note:${detail}`);
    },
  };
}

const preAuthorFallback: StoryRealNodeBuilder = async () => {
  throw new Error("pre-author fallback");
};
const throwingAuthor = (): PhaseAuthor => ({
  author: async () => {
    throw new Error("pre-author fallback: the leaf must not author on a refused drive");
  },
});

/** The drive's envelope, or the error it rejected with — a refusal assertion must see either. */
async function settle(run: Promise<Envelope>): Promise<{ env?: Envelope; error?: unknown }> {
  try {
    return { env: await run };
  } catch (error) {
    return { error };
  }
}

/** Events a pre-spend refusal must never reach. */
function spendEvents(events: readonly string[]): string[] {
  return events.filter(
    (e) =>
      e.startsWith("prompts:") ||
      e.startsWith("store:") ||
      e === "db" ||
      e === "builder" ||
      e.startsWith("stage:library agent prompts") ||
      e.startsWith("stage:live-store preflight") ||
      e.startsWith("stage:verdict store") ||
      e.startsWith("stage:worktree") ||
      e.startsWith("stage:gate ("),
  );
}

let repo!: string;
let stories!: string;
let corpus!: InMemoryStore;

before(async () => {
  repo = await fixtureRepo();
  stories = await fixtureStories();
  corpus = await fixtureCorpusWithIncrements();
});

after(async () => {
  await rm(repo, { recursive: true, force: true });
  await rm(stories, { recursive: true, force: true });
});

/** Deps for a refusal-only drive: every spend collaborator records, and every leaf path throws. */
function refusalDeps(rec: Recorder, ledger: Pick<Store, "readEvents">, over: Partial<GateBuildDriverDeps>): GateBuildDriverDeps {
  return {
    corpusStore: recordingStore(corpus, "prompts", rec),
    progress: trippingProgress(rec),
    storiesDir: stories,
    repoRoot: repo,
    store: recordingStore(new InMemoryStore(), "store", rec),
    ensureDb: async () => {
      rec.events.push("db");
      return { ok: false, reason: "refusal-only db tripwire" };
    },
    promote: false,
    increment: "inc-live",
    innerLoopReads: { corpus, ledger: recordingLedger(ledger, rec) },
    decisionForks: [KEY_FORK],
    authorOverride: throwingAuthor,
    realNodeBuilder: async (args) => {
      rec.events.push("builder");
      return preAuthorFallback(args);
    },
    ...over,
  };
}

// ── gate-build-lease-refuses-before-policy-or-spend ─────────────────────────────────────────────

test("gate-build-lease-refuses-before-policy-or-spend: a conflicting gate lease refuses with its holder before the prompt render, the sweep, the policy fold, the store, the worktree or the leaf, and leaves the ledger untouched", async () => {
  const ledger = new InMemoryStore();
  await appendInnerLoopEvent(ledger, { event: "attempt", unitId: GATE_ID, incrementId: "inc-live", runId: "gate-real-prior" });
  const ledgerBefore = await ledger.readEvents();

  const rec = recorder();
  const settled = await settle(
    driveBuildTestsGate(
      buildTestsGate(),
      "builder@example.com",
      refusalDeps(rec, ledger, {
        buildGuardFactory: async (input) => {
          rec.acquisitions.push({ runId: input.runId, unitIds: [...input.unitIds] });
          rec.events.push("acquire");
          return COLLISION;
        },
      }),
    ),
  );

  assert.equal(settled.error, undefined, `the refusal must be an envelope, not a throw: ${String(settled.error)}`);
  assert.deepEqual(rec.acquisitions.map((a) => a.unitIds), [[GATE_ID]], "the drive asks for exactly the gate id's lease");
  assert.match(rec.acquisitions[0]!.runId, GATE_RUN_ID);
  const env = settled.env!;
  assert.equal(env.ok, false);
  assert.ok(env.body.includes(buildGuardRefusalBody(COLLISION_REFUSAL)), env.body);
  assert.match(env.body, /gate-real-other-holder/);
  assert.doesNotMatch(env.body, /HALTED/, "the lease is taken before the decision sweep");
  assert.deepEqual(spendEvents(rec.events), [], "no prompt, store, db, worktree, gate leg or builder before the lease");
  assert.equal(rec.events.includes("policy"), false, "the authoritative policy fold never runs without the lease");
  assert.deepEqual(await ledger.readEvents(), ledgerBefore, "the attempt ledger and retry position are unchanged");
});

test("gate-build-lease-refuses-before-policy-or-spend: every cheap refusal keeps its precedence and acquires nothing, and a refused lease is never released", async () => {
  // The part that is red before this unit: a conflicting lease must refuse at all (the old driver
  // never asks the factory, so it would sweep, fold policy and reach the tripwires instead).
  {
    const rec = recorder();
    const settled = await settle(
      driveBuildTestsGate(
        buildTestsGate(),
        "builder@example.com",
        refusalDeps(rec, new InMemoryStore(), {
          decisionForks: [],
          buildGuardFactory: async (input) => {
            rec.acquisitions.push({ runId: input.runId, unitIds: [...input.unitIds] });
            rec.events.push("acquire");
            return COLLISION;
          },
        }),
      ),
    );
    assert.equal(settled.error, undefined, `refused, not thrown: ${String(settled.error)}`);
    assert.deepEqual(rec.events.filter((e) => e === "acquire" || e === "release"), ["acquire"], "a refused lease holds nothing to release");
    assert.match(settled.env!.body, /gate-real-other-holder/);
  }

  const cheap: ReadonlyArray<{ name: string; gate: ReliabilityGate; over: Partial<GateBuildDriverDeps>; body: RegExp }> = [
    { name: "no build reference", gate: buildTestsGate({ buildNode: undefined }), over: {}, body: /names no build to drive/ },
    { name: "missing build spec", gate: buildTestsGate({ buildNode: "ghost-node" }), over: {}, body: /references build node "ghost-node"/ },
    { name: "not real-buildable", gate: buildTestsGate({ buildNode: "no-real-node" }), over: {}, body: /real/i },
    { name: "unreadable revision", gate: buildTestsGate(), over: { reviseTest: "gate-real-never-recorded", escalationsDir: path.join(repo, ".no-records") }, body: /gate-real-never-recorded|revision|record/i },
    { name: "missing increment", gate: buildTestsGate(), over: { increment: undefined }, body: /increment/i },
    { name: "blank increment", gate: buildTestsGate(), over: { increment: "   " }, body: /increment/i },
    { name: "unknown increment", gate: buildTestsGate(), over: { increment: "no-such-increment" }, body: /no-such-increment/ },
  ];
  for (const c of cheap) {
    const rec = recorder();
    const deps = refusalDeps(rec, new InMemoryStore(), {
      decisionForks: [],
      buildGuardFactory: grantingFactory(rec, recordingGuard(rec)),
      ...c.over,
    });
    const settled = await settle(driveBuildTestsGate(c.gate, "builder@example.com", deps));
    assert.equal(settled.error, undefined, `${c.name}: refused, not thrown`);
    assert.equal(settled.env!.ok, false, c.name);
    assert.match(settled.env!.body, c.body, c.name);
    assert.deepEqual(rec.acquisitions, [], `${c.name}: a cheap refusal acquires no lease`);
    assert.deepEqual(spendEvents(rec.events), [], `${c.name}: and reaches no spend`);
  }
});

// ── gate-build-policy-is-read-under-the-held-lease ──────────────────────────────────────────────

test("gate-build-policy-is-read-under-the-held-lease: the attempt policy folds only after a successful acquisition, and a policy refusal releases that guard exactly once without a prompt, worktree or leaf", async () => {
  const ledger = new InMemoryStore();
  for (const runId of ["r1", "r2", "r3"]) {
    await appendInnerLoopEvent(ledger, { event: "attempt", unitId: GATE_ID, incrementId: "inc-live", runId });
  }
  const expected = await preflightInnerLoop({ ledger, incrementId: "inc-live", unitIds: [GATE_ID], revise: false });
  assert.equal(expected.ok, false, "ground truth: three unresolved attempts stop the attempt policy");
  if (expected.ok) return;

  const rec = recorder();
  const settled = await settle(
    driveBuildTestsGate(
      buildTestsGate(),
      "builder@example.com",
      refusalDeps(rec, ledger, { buildGuardFactory: grantingFactory(rec, recordingGuard(rec)) }),
    ),
  );
  assert.equal(settled.error, undefined, `refused, not thrown: ${String(settled.error)}`);
  assert.deepEqual(settled.env, innerLoopRefusalEnvelope(expected.state), "the policy refusal, not the key-fork HALT");
  const acquire = rec.events.indexOf("acquire");
  const policy = rec.events.indexOf("policy");
  assert.ok(acquire >= 0, "the lease is acquired");
  assert.ok(policy > acquire, `the policy is read while the lease is held: ${rec.events.join(" | ")}`);
  assert.equal(rec.events.filter((e) => e === "release").length, 1, "the held guard is released exactly once");
  assert.ok(rec.events.lastIndexOf("release") > rec.events.lastIndexOf("policy"), "released after the policy fold");
  assert.deepEqual(spendEvents(rec.events), [], "no prompt render, store, worktree or leaf after a policy refusal");
});

test("gate-build-policy-is-read-under-the-held-lease: an admitted drive acquires, then folds the policy, then renders its prompts, then builds, then releases", async () => {
  const rec = recorder();
  const guard = recordingGuard(rec);
  const ledger = new InMemoryStore();
  const settled = await settle(
    driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: recordingStore(corpus, "prompts", rec),
      progress: recordingProgress(rec),
      storiesDir: stories,
      repoRoot: repo,
      store: new InMemoryStore(),
      promote: false,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: recordingLedger(ledger, rec) },
      authorOverride: throwingAuthor,
      buildGuardFactory: grantingFactory(rec, guard),
      realNodeBuilder: async (): Promise<RealBuildResult> => {
        rec.events.push("builder");
        return { result: { ok: false, failedAt: "AUTHOR_TEST", reason: "this walk never authors", phasesVisited: [] } };
      },
    }),
  );
  assert.equal(settled.error, undefined, `a failed build is an envelope: ${String(settled.error)}`);
  const at = (e: string): number => rec.events.findIndex((x) => x === e || x.startsWith(e));
  assert.ok(at("acquire") >= 0, "acquired");
  assert.ok(at("acquire") < at("policy"), `acquire before policy: ${rec.events.join(" | ")}`);
  assert.ok(at("policy") < at("prompts:"), `policy before the prompt render: ${rec.events.join(" | ")}`);
  assert.ok(at("prompts:") < at("builder"), "prompts before the build");
  assert.equal(rec.events.filter((e) => e === "release").length, 1);
  assert.equal(rec.events.at(-1), "release", "released after everything else");
});

// ── gate-build-carries-one-gate-id-lease-through-every-exit ─────────────────────────────────────

test("gate-build-carries-one-gate-id-lease-through-every-exit: a successful drive holds one gate-id lease under one gate-real-<uuid> run, hands that guard to the builder, records and prints that run, and releases once", async () => {
  const rec = recorder();
  const guard = recordingGuard(rec);
  const store = new InMemoryStore();
  const handed: Array<{ guard: BuildGuard | undefined; runId: string; factory: unknown }> = [];
  const settled = await settle(
    driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus,
      progress: recordingProgress(rec),
      storiesDir: stories,
      repoRoot: repo,
      store,
      promote: false,
      authorOverride: scriptedR2Author,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: store },
      buildGuardFactory: grantingFactory(rec, guard),
      realNodeBuilder: async (args: RealBuildArgs) => {
        handed.push({ guard: args.buildGuard, runId: args.runId, factory: args.buildGuardFactory });
        rec.events.push("builder");
        return buildNodeReal(args);
      },
    }),
  );
  assert.equal(settled.error, undefined, String(settled.error));
  const env = settled.env!;
  assert.equal(env.ok, true, env.body);

  assert.equal(rec.acquisitions.length, 1, "exactly one lease for the whole gate drive");
  assert.deepEqual(rec.acquisitions[0]!.unitIds, [GATE_ID], "the lease is the gate id's, never the referenced build node's");
  const runId = rec.acquisitions[0]!.runId;
  assert.match(runId, GATE_RUN_ID, "one Git-safe gate-real-<uuid> run id");

  assert.equal(handed.length, 1);
  assert.equal(handed[0]!.guard, guard, "the held guard is passed as RealBuildArgs.buildGuard");
  assert.equal(handed[0]!.runId, runId, "the builder walks the lease's run");
  assert.equal(handed[0]!.factory, undefined, "the builder borrows the held guard rather than acquiring its own");

  const docs = (await store.readEvents())
    .filter((e) => e.kind === INNER_LOOP_EVENT_KIND)
    .map((e) => e.doc as { event: string; unitId: string; runId: string });
  assert.deepEqual(
    docs.map((d) => [d.event, d.unitId, d.runId]),
    [
      ["attempt", GATE_ID, runId],
      ["signed-pass", GATE_ID, runId],
    ],
    "the attempt and pass records carry the lease's run id",
  );
  assert.ok(env.body.split("\n").includes(`run:         ${runId}`), env.body);
  assert.ok(rec.events.includes("checkpoint"), "the borrowed guard is checked at the build's controlled steps");
  assert.equal(rec.events.filter((e) => e === "release").length, 1, "released exactly once; buildNodeReal never releases a borrowed guard");
  assert.equal(rec.events.at(-1), "release", "released after the walk");
});

test("gate-build-carries-one-gate-id-lease-through-every-exit: a worktree failure, a builder failure and a builder throw each release the held guard exactly once", async () => {
  const notARepo = await mkdtemp(path.join(os.tmpdir(), "storytree-gate-lease-not-a-repo-"));
  try {
    const exits: ReadonlyArray<{ name: string; repoRoot: string; builder: StoryRealNodeBuilder; builderReached: boolean }> = [
      {
        name: "worktree failure",
        repoRoot: notARepo,
        builder: async () => {
          throw new Error("pre-author fallback");
        },
        builderReached: false,
      },
      {
        name: "builder failure",
        repoRoot: repo,
        builder: async () => ({
          result: { ok: false, failedAt: "CONFIRM_RED", reason: "builder-failure-marker", phasesVisited: ["AUTHOR_TEST"] },
        }),
        builderReached: true,
      },
      {
        name: "builder throw",
        repoRoot: repo,
        builder: async () => {
          throw new Error("builder-throw-marker");
        },
        builderReached: true,
      },
    ];
    for (const exit of exits) {
      const rec = recorder();
      const settled = await settle(
        driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
          corpusStore: corpus,
          progress: recordingProgress(rec),
          storiesDir: stories,
          repoRoot: exit.repoRoot,
          store: new InMemoryStore(),
          promote: false,
          increment: "inc-live",
          innerLoopReads: { corpus, ledger: new InMemoryStore() },
          authorOverride: throwingAuthor,
          buildGuardFactory: grantingFactory(rec, recordingGuard(rec)),
          realNodeBuilder: async (args) => {
            rec.events.push("builder");
            return exit.builder(args);
          },
        }),
      );
      assert.equal(settled.env?.ok ?? false, false, `${exit.name}: never a pass`);
      assert.equal(rec.events.includes("builder"), exit.builderReached, `${exit.name}: builder reached`);
      assert.deepEqual(rec.events.filter((e) => e === "acquire" || e === "release"), ["acquire", "release"], `${exit.name}: acquired once, released once`);
      assert.equal(rec.events.at(-1), "release", `${exit.name}: released last`);
    }
  } finally {
    await rm(notARepo, { recursive: true, force: true });
  }
});

// ── gate-build-lease-loss-blocks-the-next-controlled-step ───────────────────────────────────────

test("gate-build-lease-loss-blocks-the-next-controlled-step: a held guard whose checkpoint fails after AUTHOR_TEST stops the drive before IMPLEMENT, signing or a pass, and still releases once", async () => {
  const rec = recorder();
  let lost = false;
  const guard = recordingGuard(rec, async () => {
    if (lost) throw new Error("gate-lease-lost-marker");
  });
  const store = new InMemoryStore();
  let authorCalls = 0;
  const settled = await settle(
    driveBuildTestsGate(buildTestsGate(), "builder@example.com", {
      corpusStore: corpus,
      progress: recordingProgress(rec),
      storiesDir: stories,
      repoRoot: repo,
      store,
      promote: false,
      increment: "inc-live",
      innerLoopReads: { corpus, ledger: store },
      buildGuardFactory: grantingFactory(rec, guard),
      authorOverride: (spec, root) => {
        const scripted = scriptedR2Author(spec, root);
        return {
          author: async (...args: Parameters<PhaseAuthor["author"]>) => {
            authorCalls += 1;
            const result = await scripted.author(...args);
            lost = true;
            return result;
          },
        };
      },
      realNodeBuilder: async (args: RealBuildArgs) => buildNodeReal(args),
    }),
  );
  assert.equal(settled.error, undefined, `a lost lease fails the walk closed, as an envelope: ${String(settled.error)}`);
  const env = settled.env!;
  assert.equal(env.ok, false, env.body);
  assert.match(env.body, /gate-lease-lost-marker/, "the refusal names the lost lease");
  assert.equal(authorCalls, 1, "the leaf authored AUTHOR_TEST and nothing after the loss");
  assert.equal(rec.events.includes("note:IMPLEMENT"), false, "IMPLEMENT never started");
  const events = await store.readEvents();
  assert.equal(events.filter((e) => e.kind === "signing").length, 0, "no signature after the loss");
  assert.equal(
    events.filter((e) => e.kind === INNER_LOOP_EVENT_KIND && (e.doc as { event?: string }).event === "signed-pass").length,
    0,
    "no signed pass after the loss",
  );
  assert.equal(rec.events.filter((e) => e === "release").length, 1, "the lost guard is still released exactly once");
});
