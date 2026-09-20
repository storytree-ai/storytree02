import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import type { AuthorResult, AuthoringPhase, PhaseAuthor } from "@storytree/agent";
import { parseContracts } from "@storytree/library";
import { InMemoryStore } from "@storytree/storage-protocol";

import { loadNodeSpec } from "./node-spec.js";
import { perTestReporterUrl } from "./proof/per-test-report.js";
import { classifyProofRoute, perTestChannelOf, withPerTestReport } from "./proof/proof-route.js";
import type { RealProofConfig } from "./proof-config.js";
import { proveUnit } from "./prove-it-gate.js";
import type { RepairDecision } from "./repair.js";
import { realPrompts, realProofCommand, resolveProveSpec } from "./resolve-prove-spec.js";

// The arming half of ADR-0573: which real proof routes carry a per-test channel (D2/D3), how the channel
// rides the ONE resolved command, the review the resolver hands the gate, and the brief rule its
// Consequences require.

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const TEST_FILE = "packages/unit/src/unit.test.ts";
const SOURCE_FILE = "packages/unit/src/unit.ts";

type DeclaredCommand = NonNullable<RealProofConfig["proofCommand"]>;

function realConfig(proofCommand?: DeclaredCommand): RealProofConfig {
  const real: RealProofConfig = {
    testFile: TEST_FILE,
    sourceFile: SOURCE_FILE,
    scope: { testGlobs: [TEST_FILE], sourceGlobs: [SOURCE_FILE] },
  };
  if (proofCommand !== undefined) real.proofCommand = proofCommand;
  return real;
}

const channelFor = (proofCommand?: DeclaredCommand): string | undefined => {
  const real = realConfig(proofCommand);
  return perTestChannelOf(real, classifyProofRoute(real));
};

test("real-routes-arm-per-test-observation: only a route running this node's OWN test file through a measured runner carries a channel", () => {
  assert.equal(channelFor(), "node-test", "the default node:test route");
  assert.equal(channelFor({ file: "node", args: ["--import", "tsx", "--test", TEST_FILE] }), "node-test");
  assert.equal(
    channelFor({ file: "pnpm", args: ["--filter", "studio", "exec", "vitest", "run", TEST_FILE] }),
    "vitest-json",
  );
  assert.equal(
    channelFor({ file: "bun", args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "--timeout", "300000", `./${TEST_FILE}`] }),
    "bun-junit",
  );

  // Everything else keeps the exit code alone.
  assert.equal(channelFor({ file: "node", args: ["--import", "tsx", TEST_FILE] }), undefined, "no --test: no test-runner reporters");
  assert.equal(channelFor({ file: "pnpm", args: ["--filter", "studio", "exec", "vitest", "run"] }), undefined, "a vitest suite");
  assert.equal(channelFor({ file: "bun", args: ["test", "packages/unit/src/"] }), undefined, "a bun suite");
  assert.equal(channelFor({ file: "pnpm", args: ["--filter", "@storytree/unit", "test"] }), undefined, "a package script");
  assert.equal(channelFor({ file: "node", args: ["--test", "packages/unit/src/*.test.ts"] }), undefined, "a node:test glob");
});

test("real-routes-arm-per-test-observation: a bun own-file route is single-file, not a package-manager suite, and is spawned as declared", () => {
  const real = realConfig({ file: "bun", args: ["test", "--timeout", "300000", `./${TEST_FILE}`] });
  assert.deepEqual(classifyProofRoute(real), { basis: "bun-test-own-file" });
  const { command } = realProofCommand(real, REPO_ROOT);
  assert.deepEqual(command.args, ["test", "--timeout", "300000", `./${TEST_FILE}`]);

  // A single bun test file that is NOT the one AUTHOR_TEST writes can never observe its red.
  const elsewhere = realConfig({ file: "bun", args: ["test", "./packages/unit/src/other.test.ts"] });
  assert.equal(classifyProofRoute(elsewhere).basis, "observes-another-file");
});

test("real-routes-arm-per-test-observation: each channel's flags ride the one command where its runner reads them", () => {
  const node = withPerTestReport(
    { file: "node", args: ["--import", "tsx", "--test", "/w/unit.test.ts"], cwd: "/w" },
    "node-test",
    "/tmp/report.jsonl",
  );
  assert.deepEqual(node.args, [
    "--import",
    "tsx",
    "--test",
    "--test-reporter=spec",
    "--test-reporter-destination=stdout",
    `--test-reporter=${perTestReporterUrl()}`,
    "--test-reporter-destination=/tmp/report.jsonl",
    "/w/unit.test.ts",
  ]);
  assert.equal(node.cwd, "/w");

  const bun = withPerTestReport({ file: "bun", args: ["test", "--preload", "guard", "./unit.test.ts"] }, "bun-junit", "/tmp/report.xml");
  assert.deepEqual(bun.args, ["test", "--reporter=junit", "--reporter-outfile=/tmp/report.xml", "--preload", "guard", "./unit.test.ts"]);

  const vitest = withPerTestReport(
    { file: "cmd.exe", args: ["/d", "/s", "/c", "pnpm", "exec", "vitest", "run", "unit.test.ts"], env: { A: "1" } },
    "vitest-json",
    "/tmp/report.json",
  );
  assert.deepEqual(vitest.args.slice(-3), ["--reporter=default", "--reporter=json", "--outputFile=/tmp/report.json"]);
  assert.deepEqual(vitest.env, { A: "1" });
});

// ── The resolver arms a real build end to end ───────────────────────────────

const SKELETON = `export function add(a: number, b: number): number {
  void a;
  void b;
  return undefined as unknown as number;
}
`;

const IMPLEMENTED = `export function add(a: number, b: number): number {
  return a + b;
}
`;

const CLEAN_TEST = `import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { add } from "./unit.js";

describe("add-sums: add returns the sum of its operands", () => {
  test("two and three make five", () => {
    assert.equal(add(2, 3), 5);
  });
});
`;

/** The clean test beside one hollow test that only the red observation can see (it vouches statically). */
const HOLLOW_TEST = `${CLEAN_TEST}
test("add-is-a-function: asserts what the existing source already satisfies", () => {
  assert.equal(typeof add, "function");
});
`;

const SPEC = `---
id: "per-test-armed-unit"
tier: contract
story: drive-machinery
capability: prove-spec-resolution
title: "A unit whose existing source is edited"
outcome: "add returns the sum of its operands."
status: proposed
proof_mode: contract-test
depends_on: []
proof:
  command:
    file: node
    args: ["--test", "${TEST_FILE}"]
  scope:
    testGlobs: ["${TEST_FILE}"]
    sourceGlobs: ["${SOURCE_FILE}"]
  real:
    testFile: "${TEST_FILE}"
    sourceFile: "${SOURCE_FILE}"
    scope:
      testGlobs: ["${TEST_FILE}"]
      sourceGlobs: ["${SOURCE_FILE}"]
    editsExisting: true
---

# A unit whose existing source is edited

## Contracts (1)

1. **\`add-sums\`** — add returns the sum of its operands
   - **asserts —** \`add(2, 3)\` is 5.
   - **covers —** \`${SOURCE_FILE}\`
`;

/** The same unit declaring a second contract, with both briefed as ONE cluster (ADR-0573 D3). */
const CLUSTER_SPEC = `---
id: "per-test-cluster-unit"
tier: contract
story: drive-machinery
capability: prove-spec-resolution
title: "A unit whose existing source is edited, briefed as a cluster"
outcome: "add returns the sum of its operands, negative operands included."
status: proposed
proof_mode: contract-test
depends_on: []
proof:
  command:
    file: node
    args: ["--test", "${TEST_FILE}"]
  scope:
    testGlobs: ["${TEST_FILE}"]
    sourceGlobs: ["${SOURCE_FILE}"]
  real:
    testFile: "${TEST_FILE}"
    sourceFile: "${SOURCE_FILE}"
    scope:
      testGlobs: ["${TEST_FILE}"]
      sourceGlobs: ["${SOURCE_FILE}"]
    editsExisting: true
    cluster: ["add-sums", "add-handles-negatives"]
---

# A unit whose existing source is edited, briefed as a cluster

## Contracts (2)

1. **\`add-sums\`** — add returns the sum of its operands
   - **asserts —** \`add(2, 3)\` is 5.
   - **covers —** \`${SOURCE_FILE}\`
2. **\`add-handles-negatives\`** — add sums negative operands
   - **asserts —** \`add(-2, -3)\` is -5.
   - **covers —** \`${SOURCE_FILE}\`
`;

/** Both contracts of the cluster, each with its own NEW failing test. */
const CLUSTER_TEST = `${CLEAN_TEST}
describe("add-handles-negatives: add sums negative operands", () => {
  test("minus two and minus three make minus five", () => {
    assert.equal(add(-2, -3), -5);
  });
});
`;

/** Three declared contracts, spelled as a capability spec spells them — a cluster names some of them. */
const THREE_CONTRACTS = parseContracts(`# A unit

## Contracts (3)

1. **\`add-sums\`** — add returns the sum of its operands
   - **asserts —** \`add(2, 3)\` is 5.
2. **\`add-handles-negatives\`** — add sums negative operands
   - **asserts —** \`add(-2, -3)\` is -5.
3. **\`add-is-pure\`** — add leaves its operands untouched
   - **asserts —** calling \`add\` changes nothing it was given.
`);

/** The leaf, doubled: it writes its phase's file and stops. */
class WritingAuthor implements PhaseAuthor {
  readonly #workspace: string;
  readonly #writes: Readonly<Record<AuthoringPhase, readonly [string, string]>>;

  constructor(workspace: string, writes: Readonly<Record<AuthoringPhase, readonly [string, string]>>) {
    this.#workspace = workspace;
    this.#writes = writes;
  }

  async author(phase: AuthoringPhase): Promise<AuthorResult> {
    const [rel, content] = this.#writes[phase];
    await fs.writeFile(path.join(this.#workspace, rel), content);
    return { ok: true };
  }
}

async function armedWalk(testSource: string, implementation: string, specText = SPEC) {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "storytree-armed-walk-"));
  try {
    await fs.mkdir(path.join(workspace, path.dirname(TEST_FILE)), { recursive: true });
    await fs.writeFile(path.join(workspace, "package.json"), JSON.stringify({ name: "armed-walk", private: true, type: "module" }));
    await fs.writeFile(path.join(workspace, SOURCE_FILE), SKELETON);
    const specFile = path.join(workspace, "per-test-armed-unit.md");
    await fs.writeFile(specFile, specText);
    const spec = loadNodeSpec(specFile);

    const resolved = resolveProveSpec(spec, {
      mode: "real",
      workspace,
      store: new InMemoryStore(),
      runId: "armed-walk",
      signerInputs: { flag: "tester@example.com" },
      authorOverride: new WritingAuthor(workspace, {
        AUTHOR_TEST: [TEST_FILE, testSource],
        IMPLEMENT: [SOURCE_FILE, implementation],
      }),
      treeState: async () => ({ commitSha: "armed-walk", clean: true }),
      // This walk exists to observe the REVIEW's own verdict, and its author writes the same bytes
      // every slice — so a repair could only hand back what the spine just refused (ADR-0582 D5/D6).
      // The synthetic workspace is no git repository either, so the wrote-nothing ending cannot see
      // that for itself: granting no repair is what keeps this walk one pass over the review.
      repairBudget: {
        mayRepair: (): Promise<RepairDecision> =>
          Promise.resolve({ ok: false, reason: "this offline review walk grants no in-build repair" }),
      },
    });
    if (!resolved.ok) throw new Error(resolved.reason);
    return { resolved: resolved.spec, result: await proveUnit(resolved.spec) };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
  }
}

test("real-routes-arm-per-test-observation: a real build on the default route refuses a hollow test per test, and signs a clean one", async () => {
  const hollow = await armedWalk(HOLLOW_TEST, IMPLEMENTED);
  assert.ok(hollow.resolved.perTest?.confirmRed !== undefined, "an editsExisting unit is reviewed per test at red");
  assert.equal(hollow.result.ok, false);
  if (hollow.result.ok) return;
  assert.equal(hollow.result.failedAt, "CONFIRM_RED", hollow.result.reason);
  assert.deepEqual(
    (hollow.result.perTestFindings ?? []).map((f) => `${f.check} ${f.test?.join(" > ") ?? ""}`),
    ["C4 add-is-a-function: asserts what the existing source already satisfies"],
  );

  const clean = await armedWalk(CLEAN_TEST, IMPLEMENTED);
  assert.equal(clean.result.ok, true, clean.result.ok ? "" : `${clean.result.failedAt}: ${clean.result.reason}`);
  if (!clean.result.ok) return;
  assert.deepEqual(clean.result.verdict.acceptedGuardRails, []);
  assert.match(clean.result.verdict.evidence[0]?.note ?? "", /per-test: 1 declared test\(s\) reviewed individually at CONFIRM_RED/);
  assert.match(clean.result.verdict.evidence[1]?.note ?? "", /per-test: 1 declared test\(s\) each reported green at CONFIRM_GREEN/);
});

test("real-routes-arm-per-test-observation: a net-new unit is reviewed per test at green only, and a suite route not at all", () => {
  const spec = loadNodeSpec(path.join(REPO_ROOT, "stories", "drive-machinery", "verdict-line.md"));
  const base = { mode: "real" as const, store: new InMemoryStore(), runId: "r", signerInputs: { flag: "t@example.com" } };
  const author: PhaseAuthor = { author: async () => ({ ok: true }) };
  const treeState = async () => ({ commitSha: "x", clean: true });

  const netNew = { ...spec, buildConfig: { command: { file: "node", args: [] }, scope: realConfig().scope, real: realConfig() } };
  const resolvedNetNew = resolveProveSpec(netNew, { ...base, workspace: REPO_ROOT, authorOverride: author, treeState });
  assert.equal(resolvedNetNew.ok, true);
  if (!resolvedNetNew.ok) return;
  assert.equal(resolvedNetNew.spec.perTest?.confirmRed, undefined, "a structural red loads no file, so it is not reviewed per test");
  assert.match(resolvedNetNew.spec.perTest?.redNotObserved ?? "", /exit code alone/);

  const suiteReal = realConfig({ file: "pnpm", args: ["--filter", "@storytree/unit", "test"] });
  const suite = { ...spec, buildConfig: { command: { file: "node", args: [] }, scope: suiteReal.scope, real: suiteReal } };
  const resolvedSuite = resolveProveSpec(suite, { ...base, workspace: REPO_ROOT, authorOverride: author, treeState });
  assert.equal(resolvedSuite.ok, true);
  if (!resolvedSuite.ok) return;
  assert.equal(resolvedSuite.spec.perTest, undefined);
});

test("real-author-test-brief-states-the-per-test-rules: an armed route briefs the rules, and an unarmed route's brief says nothing of them", () => {
  const spec = loadNodeSpec(path.join(REPO_ROOT, "stories", "drive-machinery", "verdict-line.md"));
  const editsExisting: RealProofConfig = { ...realConfig(), editsExisting: true };

  const assertionBrief = realPrompts(spec, editsExisting, "node --import tsx --test unit.test.ts").authorTest;
  assert.match(assertionBrief, /The spine observes this proof PER TEST/);
  assert.match(assertionBrief, /a `\.each` table or a title built at runtime is refused/);
  assert.match(assertionBrief, /Every NEW test you add must FAIL now, on its own, with an assertion/);
  assert.match(assertionBrief, /declares a guard-rail in its story \(ADR-0572\)/);

  const netNewBrief = realPrompts(spec, realConfig(), "node --import tsx --test unit.test.ts").authorTest;
  assert.match(netNewBrief, /The spine observes this proof PER TEST/);
  assert.equal(netNewBrief.includes("Every NEW test you add must FAIL now"), false, "a structural red is not reviewed per test");

  const suiteBrief = realPrompts(spec, realConfig({ file: "pnpm", args: ["--filter", "@storytree/unit", "test"] }), "pnpm test").authorTest;
  assert.equal(suiteBrief.includes("PER TEST"), false);
  assert.equal(suiteBrief.includes("guard-rail"), false);
});

// ── The cluster brief (batched-test-authoring-arc-inc-04, ADR-0573 D3) ──────

test("real-cluster-is-admitted-only-where-red-is-observed-per-test: the resolver refuses a cluster it could not review per test, or one naming contracts the unit does not declare, and arms C7 with an admitted one", () => {
  const spec = { ...loadNodeSpec(path.join(REPO_ROOT, "stories", "drive-machinery", "verdict-line.md")), contracts: THREE_CONTRACTS };
  const [first, second] = spec.contracts.map((c) => c.id);
  assert.ok(first !== undefined && second !== undefined, "the fixture declares at least two contracts");
  const cluster = [first, second];
  const base = { mode: "real" as const, store: new InMemoryStore(), runId: "r", signerInputs: { flag: "t@example.com" } };
  const author: PhaseAuthor = { author: async () => ({ ok: true }) };
  const treeState = async () => ({ commitSha: "x", clean: true });
  const resolveWith = (real: RealProofConfig) =>
    resolveProveSpec(
      { ...spec, buildConfig: { command: { file: "node", args: [] }, scope: real.scope, real } },
      { ...base, workspace: REPO_ROOT, authorOverride: author, treeState },
    );
  const reasonOf = (real: RealProofConfig): string => {
    const resolved = resolveWith(real);
    return resolved.ok ? "(resolved)" : resolved.reason;
  };

  const admitted = resolveWith({ ...realConfig(), editsExisting: true, cluster });
  assert.equal(admitted.ok, true, admitted.ok ? "" : admitted.reason);
  if (!admitted.ok) return;
  assert.ok(admitted.spec.perTest?.confirmRed !== undefined, "a cluster's red is reviewed per test");
  assert.deepEqual(admitted.spec.perTest?.briefContracts, cluster, "C7 is armed with the cluster");

  const suite = realConfig({ file: "pnpm", args: ["--filter", "@storytree/unit", "test"] });
  assert.match(reasonOf({ ...realConfig(), cluster }), /declared on a structural red/, "a net-new unit");
  assert.match(reasonOf({ ...suite, editsExisting: true, cluster }), /could not be observed per test/, "a suite route");
  assert.match(
    reasonOf({ ...realConfig(), editsExisting: true, cluster: [first, "no-such-contract"] }),
    /`no-such-contract`, which this unit does not declare/,
  );
  assert.match(reasonOf({ ...realConfig(), editsExisting: true, cluster: [first] }), /at least two distinct contracts/);
  assert.match(reasonOf({ ...realConfig(), editsExisting: true, cluster: [first, first] }), /at least two distinct contracts/);

  // No cluster, no C7: a one-test build is armed exactly as before.
  const oneTest = resolveWith({ ...realConfig(), editsExisting: true });
  assert.equal(oneTest.ok, true, oneTest.ok ? "" : oneTest.reason);
  if (!oneTest.ok) return;
  assert.equal(oneTest.spec.perTest?.briefContracts, undefined);
});

test("real-cluster-is-admitted-only-where-red-is-observed-per-test: a real cluster build whose new tests leave a named contract without one is refused at CONFIRM_RED, and the whole cluster signs", async () => {
  const partial = await armedWalk(CLEAN_TEST, IMPLEMENTED, CLUSTER_SPEC);
  assert.equal(partial.result.ok, false);
  if (partial.result.ok) return;
  assert.equal(partial.result.failedAt, "CONFIRM_RED", partial.result.reason);
  assert.deepEqual(
    (partial.result.perTestFindings ?? []).map((f) => `${f.check} ${f.detail}`),
    ["C7 the brief named contract `add-handles-negatives`, and no new test that vouches names it"],
  );

  // The same one test with the cluster undeclared signs, so the refusal above is the cluster's own.
  const unclustered = CLUSTER_SPEC.replace('    cluster: ["add-sums", "add-handles-negatives"]\n', "");
  assert.notEqual(unclustered, CLUSTER_SPEC, "the fixture really dropped its cluster");
  const oneTest = await armedWalk(CLEAN_TEST, IMPLEMENTED, unclustered);
  assert.equal(oneTest.result.ok, true, oneTest.result.ok ? "" : `${oneTest.result.failedAt}: ${oneTest.result.reason}`);

  const whole = await armedWalk(CLUSTER_TEST, IMPLEMENTED, CLUSTER_SPEC);
  assert.equal(whole.result.ok, true, whole.result.ok ? "" : `${whole.result.failedAt}: ${whole.result.reason}`);
  if (!whole.result.ok) return;
  assert.match(
    whole.result.verdict.evidence[0]?.note ?? "",
    /per-test: 2 declared test\(s\) reviewed individually at CONFIRM_RED \(ADR-0573 C1–C7\); a cluster brief of 2 contract\(s\) \(add-sums, add-handles-negatives\), each named by a new vouching test/,
  );
  assert.match(whole.result.verdict.evidence[1]?.note ?? "", /per-test: 2 declared test\(s\) each reported green at CONFIRM_GREEN/);
});

test("real-cluster-brief-names-the-cluster-in-both-phases: a cluster unit's AUTHOR_TEST brief asks for a new failing test per contract in one slice, its IMPLEMENT brief for the whole cluster green, and every other brief is unchanged", () => {
  const spec = { ...loadNodeSpec(path.join(REPO_ROOT, "stories", "drive-machinery", "verdict-line.md")), contracts: THREE_CONTRACTS };
  const [first, second, third] = spec.contracts;
  assert.ok(first !== undefined && second !== undefined && third !== undefined, "the fixture declares three contracts");
  // Two of the three, declared out of order: the brief names exactly the cluster, in its declared order.
  const cluster = [second.id, first.id];
  const display = "node --import tsx --test unit.test.ts";
  const oneTest: RealProofConfig = { ...realConfig(), editsExisting: true };

  const brief = realPrompts(spec, { ...oneTest, cluster }, display);
  const listed = [second, first].map((c) => `- \`${c.id}\` — ${c.title}`).join("\n");
  assert.ok(
    brief.authorTest.includes(
      `author a CLUSTER of regression tests in this ONE slice — at least one NEW test for EVERY contract in this build's cluster:\n${listed}\nEach is a NEW failing assertion`,
    ),
    "AUTHOR_TEST names exactly the cluster, in its declared order",
  );
  assert.ok(
    brief.implement.includes(`so that EVERY test of this build's cluster passes:\n${listed}\nImplement against the whole cluster together`),
    "IMPLEMENT names the same cluster",
  );
  assert.match(brief.authorTest, /rewriting the body of an existing test does not count/);
  assert.match(brief.authorTest, /left without a new test that asserts something substantive \(ADR-0573 C7\)/);
  assert.ok(brief.authorTest.includes("The spine observes this proof PER TEST"), "the per-test rules still ride the brief");
  assert.match(brief.implement, /so that EVERY test of this build's cluster passes/);
  assert.match(brief.implement, /Implement against the whole cluster together, not one test at a time/);
  assert.match(brief.implement, /Iterate: edit, `run_proof`, fix — until every test in the cluster is green/);

  // Without a cluster, the one-test brief; and where a cluster could not be held, byte for byte the same.
  const plain = realPrompts(spec, oneTest, display);
  assert.equal(plain.authorTest.includes("author a CLUSTER"), false);
  assert.equal(plain.implement.includes("this build's cluster"), false);
  assert.match(plain.authorTest, /author a REGRESSION test that FAILS against their CURRENT behaviour/);
  assert.match(plain.implement, /so that test passes \(you may write more than one of the named source files/);
  assert.deepEqual(realPrompts(spec, { ...realConfig(), cluster }, display), realPrompts(spec, realConfig(), display), "a structural red");
  const suite: RealProofConfig = { ...realConfig({ file: "pnpm", args: ["--filter", "@storytree/unit", "test"] }), editsExisting: true };
  assert.deepEqual(realPrompts(spec, { ...suite, cluster }, "pnpm test"), realPrompts(spec, suite, "pnpm test"), "an unarmed route");
});
