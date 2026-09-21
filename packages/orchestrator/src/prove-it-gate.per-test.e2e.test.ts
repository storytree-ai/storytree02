import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { AuthorResult, AuthoringPhase, PhaseAuthor } from "@storytree/agent";
import { parseContracts } from "@storytree/library";
import type { ContractDecl } from "@storytree/library";
import { Verdict } from "@storytree/proof-protocol";
import { InMemoryStore } from "@storytree/storage-protocol";

import { allocatePerTestReportPath, nodeTestReporterArgs, perTestReportFile } from "./proof/per-test-report.js";
import type { PerTestChannel } from "./proof/per-test-report.js";
import { EARLY_PASS_ROUTES, perTestPolicy } from "./proof/per-test-review.js";
import { NODE_BINARY } from "./proof/proof-route.js";
import { proveUnit } from "./prove-it-gate.js";
import type { ProveResult, ProveSpec } from "./prove-it-gate.js";
import { ShellTestExecutor } from "./shell-test-executor.js";
import type { ShellCommand, ShellTestResolver } from "./shell-test-executor.js";

/**
 * END STATE 5 of `batched-test-authoring-arc`, on BOTH runners (ADR-0573): a hollow test beside a real
 * red does not advance CONFIRM_RED, a clean cluster does, the probe's G1 guard-rail is refused without a
 * declaration and accepted and recorded with one, and a green forged by one dummy assertion followed by
 * `process.exit(0)` is refused at CONFIRM_GREEN. And for a CLUSTER brief (`batched-test-authoring-arc-inc-04`),
 * a brief naming a contract that no new vouching test names does not advance CONFIRM_RED (C7).
 *
 * Everything that OBSERVES is real: the gate, a real `ShellTestExecutor` spawning `node --test` (through
 * the spine's reporter module) or `bun test` (junit), the per-test report cleared before every trusted
 * observation (ADR-0249's rule), and a real story `## Contracts` block run through `parseContracts`. Only
 * the leaf is doubled: it writes the phase's files and stops. The fixtures are the probe's
 * (`docs/research/batched-red-attribution-probe-2026-09-14.md`, Appendix A.1), for an assertion-red unit
 * whose source already exists as a non-throwing skeleton.
 *
 * Two of the walks run TWICE, once with no per-test policy, as the negative control: today's exit-code
 * gate signs the hollow cluster and the forged green (probe §3). Asserting that here is what makes these
 * tests about the per-test review rather than about some other refusal.
 */

const TEST = "cluster.test.ts";
const SUBJECT = "subject.ts";

/** The source an assertion-red unit edits: every symbol exists and returns nothing (the probe's S1). */
const SKELETON_SUBJECT = `export function add(a: number, b: number): number {
  void a;
  void b;
  return undefined as unknown as number;
}

export function clamp(value: number, lo: number, hi: number): number {
  void value;
  void lo;
  void hi;
  return undefined as unknown as number;
}

export function parsePort(text: string): number {
  void text;
  return undefined as unknown as number;
}
`;

/** The implementation every real test goes green against (the probe's S6). */
const IMPLEMENTED_SUBJECT = `export function add(a: number, b: number): number {
  return a + b;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

export function parsePort(text: string): number {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(\`not a port: \${text}\`);
  }
  return n;
}
`;

/**
 * A forged green, written by IMPLEMENT: one real assertion, then the process exits 0 before a single
 * declared test runs. The exports stay, so the test file still links.
 */
const FORGED_SUBJECT = `import assert from "node:assert/strict";

assert.equal(1, 1);
process.exit(0);

${SKELETON_SUBJECT}`;

const CLUSTER_HEAD = `import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { add, clamp, parsePort } from "./subject.js";

describe("probe-cluster", () => {
  test("add-sums: add returns the sum of its operands", () => {
    assert.equal(add(2, 3), 5);
  });

  test("clamp-bounds: clamp pins a value inside [lo, hi]", () => {
    assert.equal(clamp(15, 0, 10), 10);
    assert.equal(clamp(-5, 0, 10), 0);
  });

  test("parse-port-refuses-garbage: parsePort throws on a non-numeric port", () => {
    assert.throws(() => parsePort("abc"), /not a port/);
  });
`;

/** Three real contract tests, and nothing else. */
const CLEAN_CLUSTER = `${CLUSTER_HEAD}});
`;

const HOLLOW = [
  "hollow-empty: a test with no body",
  "hollow-tautology: asserts a constant",
  "hollow-already-true: asserts something the skeleton already satisfies",
  "hollow-call-no-assert: calls the subject and asserts nothing",
];

/** The same three, beside the probe's four hollow shapes. */
const HOLLOW_CLUSTER = `${CLUSTER_HEAD}
  test("${HOLLOW[0]}", () => {});

  test("${HOLLOW[1]}", () => {
    assert.ok(true);
  });

  test("${HOLLOW[2]}", () => {
    assert.equal(typeof add, "function");
  });

  test("${HOLLOW[3]}", () => {
    add(2, 3);
  });
});
`;

const G1 = "parse-port-accepts-a-valid-port: a well-formed port never throws";

/** The probe's G1: two real contract tests beside one legitimate guard-rail. */
const GUARD_RAIL_CLUSTER = `import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { add, parsePort } from "./subject.js";

describe("probe-cluster", () => {
  test("add-sums: add returns the sum of its operands", () => {
    assert.equal(add(2, 3), 5);
  });

  test("parse-port-refuses-garbage: parsePort throws on a non-numeric port", () => {
    assert.throws(() => parsePort("abc"), /not a port/);
  });

  test("${G1}", () => {
    assert.doesNotThrow(() => parsePort("8080"));
  });
});
`;

/** The unit's story contracts, spelled as a capability spec spells them — with or without G1's declaration. */
function contracts(guardRail: boolean): ContractDecl[] {
  const declaration = guardRail
    ? "   - **guard-rail —** a `parsePort` that does nothing never throws, so this passes before\n" +
      "     implementation; a `parsePort` that throws on every input would fail it.\n"
    : "";
  return parseContracts(`# The unit

## Contracts (4)

1. **\`add-sums\`** — add returns the sum of its operands
   - **asserts —** \`add(2, 3)\` is 5.
2. **\`clamp-bounds\`** — clamp pins a value inside [lo, hi]
   - **asserts —** \`clamp(15, 0, 10)\` is 10.
3. **\`parse-port-refuses-garbage\`** — parsePort throws on a non-numeric port
   - **asserts —** \`parsePort("abc")\` throws "not a port".
4. **\`parse-port-accepts-a-valid-port\`** — a well-formed port never throws
   - **asserts —** \`parsePort("8080")\` returns without throwing.
${declaration}`);
}

/** A proof runner, and the command that runs the ONE test file with its per-test channel. */
interface Runner {
  readonly name: "node" | "bun";
  readonly channel: PerTestChannel;
  command(workspace: string, reportPath: string): ShellCommand;
}

const RUNNERS: readonly Runner[] = [
  {
    name: "node",
    channel: "node-test",
    command: (workspace, reportPath) => ({
      file: NODE_BINARY,
      args: [
        "--import",
        import.meta.resolve("tsx"),
        "--test",
        ...nodeTestReporterArgs(reportPath),
        path.join(workspace, TEST),
      ],
      cwd: workspace,
    }),
  },
  {
    name: "bun",
    channel: "bun-junit",
    command: (workspace, reportPath) => ({
      file: "bun",
      args: ["test", "--reporter=junit", `--reporter-outfile=${reportPath}`, `./${TEST}`],
      cwd: workspace,
    }),
  },
];

/** The leaf, doubled: it writes its phase's files and stops. Only the spine's observations decide. */
class WritingAuthor implements PhaseAuthor {
  readonly requested: AuthoringPhase[] = [];
  readonly #workspace: string;
  readonly #writes: Readonly<Record<AuthoringPhase, Readonly<Record<string, string>>>>;

  constructor(workspace: string, writes: Readonly<Record<AuthoringPhase, Readonly<Record<string, string>>>>) {
    this.#workspace = workspace;
    this.#writes = writes;
  }

  async author(phase: AuthoringPhase): Promise<AuthorResult> {
    this.requested.push(phase);
    for (const [rel, content] of Object.entries(this.#writes[phase])) {
      await fs.writeFile(path.join(this.#workspace, rel), content);
    }
    return { ok: true };
  }
}

interface Walk {
  readonly result: ProveResult;
  readonly requested: readonly AuthoringPhase[];
  readonly signingRows: number;
}

/** Walk one assertion-red unit through the real gate on `runner`, with or without the per-test review. */
async function walk(args: {
  runner: Runner;
  testSource: string;
  implement: string;
  contracts: readonly ContractDecl[];
  perTest: boolean;
  /** C7's input: the contracts a cluster brief named. */
  briefContracts?: readonly string[];
}): Promise<Walk> {
  const workspace = await fs.mkdtemp(path.join(os.tmpdir(), `storytree-per-test-e2e-${args.runner.name}-`));
  const reportPath = allocatePerTestReportPath("per-test-e2e", args.runner.name, args.runner.channel);
  try {
    await fs.writeFile(
      path.join(workspace, "package.json"),
      JSON.stringify({ name: "per-test-e2e", private: true, type: "module" }),
    );
    await fs.writeFile(path.join(workspace, SUBJECT), SKELETON_SUBJECT);

    const command: ShellCommand = args.runner.command(workspace, reportPath);
    const resolver: ShellTestResolver = { command: () => command };
    if (args.perTest) resolver.perTestReport = perTestReportFile(args.runner.channel, reportPath);

    const author = new WritingAuthor(workspace, {
      AUTHOR_TEST: { [TEST]: args.testSource },
      IMPLEMENT: { [SUBJECT]: args.implement },
    });
    const store = new InMemoryStore();
    const spec: ProveSpec = {
      unitId: "per-test-unit",
      proofMode: "contract",
      testId: "per-test-unit",
      author,
      testExecutor: new ShellTestExecutor(resolver),
      store,
      signerInputs: { flag: "tester@example.com" },
      treeState: async () => ({ commitSha: "per-test-e2e", clean: true }),
      now: () => "2026-09-15T00:00:00.000Z",
      prompts: { authorTest: "write the cluster", implement: "implement it" },
      runId: "per-test-e2e",
    };
    if (args.perTest) {
      const policy = { testFile: path.join(workspace, TEST), recordFile: TEST, contracts: args.contracts, observeRed: true };
      spec.perTest = perTestPolicy(
        args.briefContracts === undefined ? policy : { ...policy, briefContracts: args.briefContracts },
      );
    }

    const result = await proveUnit(spec);
    const events = await store.readEvents();
    return {
      result,
      requested: author.requested,
      signingRows: events.filter((e) => e.kind === "signing").length,
    };
  } finally {
    await fs.rm(workspace, { recursive: true, force: true });
    await fs.rm(reportPath, { force: true });
  }
}

const refusal = (result: ProveResult): string => (result.ok ? "(signed)" : result.reason);

for (const runner of RUNNERS) {
  test(`per-test-red-review-refuses-hollow-tests: on ${runner.name}, a hollow test beside real reds does not advance CONFIRM_RED, where today's gate signs it`, async () => {
    const today = await walk({ runner, testSource: HOLLOW_CLUSTER, implement: IMPLEMENTED_SUBJECT, contracts: contracts(false), perTest: false });
    assert.equal(today.result.ok, true, `the negative control — exit codes alone sign this cluster: ${refusal(today.result)}`);
    assert.equal(today.signingRows, 1);

    const { result, requested, signingRows } = await walk({
      runner,
      testSource: HOLLOW_CLUSTER,
      implement: IMPLEMENTED_SUBJECT,
      contracts: contracts(false),
      perTest: true,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_RED", result.reason);
    assert.deepEqual(requested, ["AUTHOR_TEST"], "IMPLEMENT is never handed out over a hollow red");
    assert.equal(signingRows, 0);
    assert.deepEqual(
      (result.perTestFindings ?? []).map((f) => `${f.check} ${f.test?.at(-1) ?? ""}`).sort(),
      [...HOLLOW.map((t) => `C4 ${t}`), `C6 ${HOLLOW[0]}`, `C6 ${HOLLOW[1]}`, `C6 ${HOLLOW[3]}`].sort(),
    );
    assert.ok(result.reason.endsWith(EARLY_PASS_ROUTES), result.reason);
    assert.ok(result.failedObservation !== undefined, "the refused observation's own output rides beside the findings");
  });

  test(`per-test-red-review-refuses-hollow-tests: on ${runner.name}, a clean cluster advances CONFIRM_RED and signs, recording that nothing was accepted early`, async () => {
    const { result, requested, signingRows } = await walk({
      runner,
      testSource: CLEAN_CLUSTER,
      implement: IMPLEMENTED_SUBJECT,
      contracts: contracts(false),
      perTest: true,
    });
    assert.equal(result.ok, true, refusal(result));
    if (!result.ok) return;
    assert.deepEqual(requested, ["AUTHOR_TEST", "IMPLEMENT"]);
    assert.equal(signingRows, 1);
    assert.deepEqual(result.verdict.acceptedGuardRails, []);
    assert.match(result.verdict.evidence[0]?.note ?? "", /per-test: 3 declared test\(s\) reviewed individually at CONFIRM_RED/);
    assert.match(result.verdict.evidence[1]?.note ?? "", /per-test: 3 declared test\(s\) each reported green at CONFIRM_GREEN/);
    assert.equal(Verdict.safeParse(result.verdict).success, true);
  });

  test(`early-pass-refused-unless-its-contract-declares-a-guard-rail: on ${runner.name}, G1 is refused without a declaration, and accepted and recorded with one`, async () => {
    const undeclared = await walk({
      runner,
      testSource: GUARD_RAIL_CLUSTER,
      implement: IMPLEMENTED_SUBJECT,
      contracts: contracts(false),
      perTest: true,
    });
    assert.equal(undeclared.result.ok, false);
    if (undeclared.result.ok) return;
    assert.equal(undeclared.result.failedAt, "CONFIRM_RED", undeclared.result.reason);
    assert.deepEqual(
      (undeclared.result.perTestFindings ?? []).map((f) => ({ check: f.check, test: f.test, namedContracts: f.namedContracts })),
      [{ check: "C4", test: ["probe-cluster", G1], namedContracts: ["parse-port-accepts-a-valid-port"] }],
    );
    assert.equal(undeclared.signingRows, 0);

    const declared = await walk({
      runner,
      testSource: GUARD_RAIL_CLUSTER,
      implement: IMPLEMENTED_SUBJECT,
      contracts: contracts(true),
      perTest: true,
    });
    assert.equal(declared.result.ok, true, refusal(declared.result));
    if (!declared.result.ok) return;
    assert.deepEqual(declared.result.verdict.acceptedGuardRails, [
      { test: ["probe-cluster", G1], contracts: ["parse-port-accepts-a-valid-port"] },
    ]);
    assert.match(declared.result.verdict.evidence[0]?.note ?? "", /1 accepted as a declared guard-rail, never observed failing/);
    assert.equal(Verdict.safeParse(declared.result.verdict).success, true);
  });

  test(`per-test-green-requires-every-declared-test: on ${runner.name}, a dummy assertion then process.exit(0) is refused at CONFIRM_GREEN, where today's gate signs it`, async () => {
    const today = await walk({ runner, testSource: CLEAN_CLUSTER, implement: FORGED_SUBJECT, contracts: contracts(false), perTest: false });
    assert.equal(
      today.result.ok,
      true,
      `the negative control — the exit code alone signs this green: ${refusal(today.result)}`,
    );

    const { result, signingRows } = await walk({
      runner,
      testSource: CLEAN_CLUSTER,
      implement: FORGED_SUBJECT,
      contracts: contracts(false),
      perTest: true,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN", result.reason);
    assert.equal(signingRows, 0);
    const checks = new Set((result.perTestFindings ?? []).map((f) => f.check));
    // node's runner relays a synthetic FILE row and never the declared tests; bun writes no report at all.
    assert.ok(runner.channel === "bun-junit" ? checks.has("C1") : checks.has("C2"), result.reason);
  });

  test(`cluster-brief-names-every-contract-with-a-new-test: on ${runner.name}, a cluster brief naming a contract no new test names does not advance CONFIRM_RED, and the same tests briefed as the cluster they cover sign`, async () => {
    const covered = ["add-sums", "clamp-bounds", "parse-port-refuses-garbage"];

    const dropped = await walk({
      runner,
      testSource: CLEAN_CLUSTER,
      implement: IMPLEMENTED_SUBJECT,
      contracts: contracts(false),
      perTest: true,
      briefContracts: [...covered, "parse-port-accepts-a-valid-port"],
    });
    assert.equal(dropped.result.ok, false);
    if (dropped.result.ok) return;
    assert.equal(dropped.result.failedAt, "CONFIRM_RED", dropped.result.reason);
    assert.deepEqual(dropped.requested, ["AUTHOR_TEST"], "IMPLEMENT is never handed out over an incomplete cluster");
    assert.equal(dropped.signingRows, 0);
    assert.deepEqual(
      (dropped.result.perTestFindings ?? []).map((f) => `${f.check} ${f.detail}`),
      ["C7 the brief named contract `parse-port-accepts-a-valid-port`, and no new test that vouches names it"],
    );

    // The discriminating twin: the same test file, briefed as exactly the cluster it covers.
    const whole = await walk({
      runner,
      testSource: CLEAN_CLUSTER,
      implement: IMPLEMENTED_SUBJECT,
      contracts: contracts(false),
      perTest: true,
      briefContracts: covered,
    });
    assert.equal(whole.result.ok, true, refusal(whole.result));
    if (!whole.result.ok) return;
    assert.equal(whole.signingRows, 1);
    assert.match(
      whole.result.verdict.evidence[0]?.note ?? "",
      /a cluster brief of 3 contract\(s\) \(add-sums, clamp-bounds, parse-port-refuses-garbage\), each named by a new vouching test/,
    );
    assert.equal(Verdict.safeParse(whole.result.verdict).success, true);
  });
}
