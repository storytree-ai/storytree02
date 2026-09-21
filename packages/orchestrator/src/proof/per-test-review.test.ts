import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ContractDecl } from "@storytree/library";

import type { TestObservation } from "../phase-machine.js";
import type { PerTestChannel, PerTestReport, ReportedTest } from "./per-test-report.js";
import { readVitestJsonReport } from "./per-test-report.js";
import {
  EARLY_PASS_ROUTES,
  STRUCTURAL_RED_NOT_OBSERVED,
  declaredTestsOf,
  describePerTestRefusal,
  greenEvidenceDisclosure,
  perTestPolicy,
  redEvidenceDisclosure,
  reviewConfirmGreen,
  reviewConfirmRed,
} from "./per-test-review.js";
import type { PerTestFinding, PerTestJudgement } from "./per-test-review.js";

/** The file name the source fixtures are read as: they are plain TypeScript, and the name selects the parse. */
const FIXTURE_FILE = "probe-cluster.test.ts";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** The probe's cluster (research doc, Appendix A.1): three real contract tests and four hollow shapes. */
const CLUSTER = `import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { add, clamp, parsePort } from "./subject.js";

describe("probe-cluster", () => {
  test("add-sums: add returns the sum of its operands", () => {
    assert.equal(add(2, 3), 5);
  });
  test("clamp-bounds: clamp pins a value inside [lo, hi]", () => {
    assert.equal(clamp(15, 0, 10), 10);
  });
  test("parse-port-refuses-garbage: parsePort throws on a non-numeric port", () => {
    assert.throws(() => parsePort("abc"), /not a port/);
  });
  test("hollow-empty: a test with no body", () => {});
  test("hollow-tautology: asserts a constant", () => {
    assert.ok(true);
  });
  test("hollow-already-true: asserts something the skeleton already satisfies", () => {
    assert.equal(typeof add, "function");
  });
  test("hollow-call-no-assert: calls the subject and asserts nothing", () => {
    add(2, 3);
  });
});
`;

const REAL = [
  "add-sums: add returns the sum of its operands",
  "clamp-bounds: clamp pins a value inside [lo, hi]",
  "parse-port-refuses-garbage: parsePort throws on a non-numeric port",
];
const HOLLOW = [
  "hollow-empty: a test with no body",
  "hollow-tautology: asserts a constant",
  "hollow-already-true: asserts something the skeleton already satisfies",
  "hollow-call-no-assert: calls the subject and asserts nothing",
];

/** The probe's G1 (research doc §5.5): two real contract tests and one legitimate guard-rail. */
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
  test("parse-port-accepts-a-valid-port: a well-formed port never throws", () => {
    assert.doesNotThrow(() => parsePort("8080"));
  });
});
`;
const G1 = "parse-port-accepts-a-valid-port: a well-formed port never throws";

const suite = (title: string): string[] => ["probe-cluster", title];

const passed = (path: readonly string[]): ReportedTest => ({ path, outcome: "passed", message: "" });
const assertionRed = (path: readonly string[]): ReportedTest => ({
  path,
  outcome: "failed",
  errorName: "AssertionError",
  errorCode: "ERR_ASSERTION",
  message: "Expected values to be strictly equal:",
});

const report = (rows: readonly ReportedTest[], channel: PerTestChannel = "node-test"): PerTestReport => ({
  channel,
  present: true,
  rows,
});

/** A parsed contract, with the obligations a spec would carry. */
const contract = (id: string, ...obligations: [label: string, text: string][]): ContractDecl => ({
  id,
  title: id,
  obligations: [["asserts", `${id} holds`] as [string, string], ...obligations].map(([label, text]) => ({ label, text })),
});

const GUARD_RAIL_TEXT =
  "a `parsePort` that does nothing never throws, so this passes before implementation; one that throws on every input would fail it.";

const CLUSTER_CONTRACTS = [contract("add-sums"), contract("clamp-bounds"), contract("parse-port-refuses-garbage")];

const findingsOf = (judgement: PerTestJudgement): readonly PerTestFinding[] => (judgement.ok ? [] : judgement.findings);
const keyed = (judgement: PerTestJudgement): string[] =>
  findingsOf(judgement).map((f) => `${f.check} ${f.test?.at(-1) ?? "(no test)"}`).sort();

// ── The static half ─────────────────────────────────────────────────────────

test("per-test-red-review-refuses-hollow-tests: the static read declares the cluster's leaf tests, with their substance", () => {
  const declared = declaredTestsOf(CLUSTER, FIXTURE_FILE);
  assert.deepEqual(
    declared.map((t) => `${t.path.join(" > ")} vouches=${String(t.vouches)}`),
    [
      `probe-cluster > ${REAL[0]} vouches=true`,
      `probe-cluster > ${REAL[1]} vouches=true`,
      `probe-cluster > ${REAL[2]} vouches=true`,
      `probe-cluster > ${HOLLOW[0]} vouches=false`,
      `probe-cluster > ${HOLLOW[1]} vouches=false`,
      // H3 VOUCHES statically — only the red observation can see that it asserts what already holds.
      `probe-cluster > ${HOLLOW[2]} vouches=true`,
      `probe-cluster > ${HOLLOW[3]} vouches=false`,
    ],
  );
});

test("per-test-red-review-refuses-hollow-tests: a table-bound `.each` and a runtime-built title are declared unbindable", () => {
  const source = `import { describe, it, test } from "vitest";
describe.each([["a"], ["b"]])("case %s", (name) => {
  it("runs", () => { expect(name).toBeTruthy(); });
});
it.each([[1, 2]])("adds %i", (a, b) => { expect(a + b).toBe(3); });
const label = "dynamic";
describe(\`suite \${label}\`, () => {
  test("inside", () => { expect(label).toBe("dynamic"); });
});
describe("empty", () => {});
test("plain", () => { expect(label).toBe("dynamic"); });
`;
  assert.deepEqual(
    declaredTestsOf(source, FIXTURE_FILE).map((t) => `${t.path.join(" > ")}: ${t.unbindable ?? "bindable"}`),
    [
      "case %s > runs: parameterised",
      "adds %i: parameterised",
      "suite  > inside: unread-title",
      // `describe("empty")` holds no test and no runner reports it, so it is not declared.
      "plain: bindable",
    ],
  );
});

// ── C1–C7 at CONFIRM_RED ────────────────────────────────────────────────────

test("per-test-red-review-refuses-hollow-tests: a hollow test beside real reds refuses, naming each hollow test and its check", () => {
  const judgement = reviewConfirmRed({
    declared: declaredTestsOf(CLUSTER, FIXTURE_FILE),
    before: [],
    report: report([...REAL.map((t) => assertionRed(suite(t))), ...HOLLOW.map((t) => passed(suite(t)))]),
    contracts: CLUSTER_CONTRACTS,
  });
  assert.equal(judgement.ok, false);
  assert.deepEqual(keyed(judgement), [
    `C4 ${HOLLOW[0]}`,
    `C4 ${HOLLOW[3]}`,
    `C4 ${HOLLOW[2]}`,
    `C4 ${HOLLOW[1]}`,
    `C6 ${HOLLOW[0]}`,
    `C6 ${HOLLOW[3]}`,
    `C6 ${HOLLOW[1]}`,
  ].sort());
});

test("per-test-red-review-refuses-hollow-tests: a clean cluster advances, with nothing accepted early", () => {
  const clean = CLUSTER.split("  test(\"hollow-empty")[0] + "});\n";
  const judgement = reviewConfirmRed({
    declared: declaredTestsOf(clean, FIXTURE_FILE),
    before: [],
    report: report(REAL.map((t) => assertionRed(suite(t)))),
    contracts: CLUSTER_CONTRACTS,
  });
  assert.deepEqual(judgement, { ok: true, declaredTests: 3, acceptedGuardRails: [] });
});

test("per-test-red-review-refuses-hollow-tests: C1 refuses an absent report, an unreadable one, and an observation with none", () => {
  const declared = declaredTestsOf(CLUSTER, FIXTURE_FILE);
  const base = { declared, before: [], contracts: CLUSTER_CONTRACTS };
  for (const judged of [
    reviewConfirmRed({ ...base, report: { channel: "bun-junit", present: false, rows: [] } }),
    reviewConfirmRed({ ...base, report: { channel: "node-test", present: true, rows: [], unreadable: "could not parse" } }),
    reviewConfirmRed({ ...base, report: undefined }),
  ]) {
    assert.equal(judged.ok, false);
    assert.deepEqual(findingsOf(judged).map((f) => f.check), ["C1"]);
  }
});

test("per-test-red-review-refuses-hollow-tests: C2 refuses a test never reported, a row matching nothing, and a FILE-level row", () => {
  const declared = declaredTestsOf(CLUSTER.split("  test(\"hollow-empty")[0] + "});\n", FIXTURE_FILE);
  const judgement = reviewConfirmRed({
    declared,
    before: [],
    report: report([assertionRed(suite(REAL[0] ?? "")), assertionRed(suite("an undeclared test")), passed(["cluster.test.ts"])]),
    contracts: CLUSTER_CONTRACTS,
  });
  assert.deepEqual(keyed(judgement), [`C2 ${REAL[1]}`, `C2 ${REAL[2]}`, "C2 an undeclared test", "C2 cluster.test.ts"].sort());
  const fileRow = findingsOf(judgement).find((f) => f.test?.[0] === "cluster.test.ts");
  assert.match(fileRow?.detail ?? "", /FILE-level row/);
});

test("per-test-red-review-refuses-hollow-tests: C2 refuses two declared tests sharing a title path, once", () => {
  const source = `test("add-sums: one", () => { assert.equal(add(2, 3), 5); });
test("add-sums: one", () => { assert.ok(true); });
`;
  const judgement = reviewConfirmRed({
    declared: declaredTestsOf(source, FIXTURE_FILE),
    before: [],
    report: report([assertionRed(["add-sums: one"]), passed(["add-sums: one"])]),
    contracts: CLUSTER_CONTRACTS,
  });
  const c2 = findingsOf(judgement).filter((f) => f.check === "C2");
  assert.equal(c2.length, 1);
  assert.match(c2[0]?.detail ?? "", /2 declared tests share this title path/);
});

test("per-test-red-review-refuses-hollow-tests: C6 refuses a new test skipped for CERTAIN by the options form, exactly as it refuses the `.skip` modifier", () => {
  // A truthy literal never runs, so the static read can say so: ADR-0126 withholds its vouching, and
  // C6 refuses it beside C3's runtime refusal, the same pair a `.skip` modifier has always drawn.
  const source = `test("add-sums: runs", () => { assert.equal(add(2, 3), 5); });
test("clamp-bounds: skipped by options", { skip: true }, () => { assert.equal(clamp(15, 0, 10), 10); });
test.skip("parse-port-refuses-garbage: skipped by modifier", () => { assert.throws(() => parsePort("abc")); });
`;
  const declared = declaredTestsOf(source, FIXTURE_FILE);
  assert.deepEqual(
    declared.map((t) => t.vouches),
    [true, false, false],
  );
  const skippedRow = (title: string): ReportedTest => ({ path: [title], outcome: "skipped", message: "" });
  const judgement = reviewConfirmRed({
    declared,
    before: [],
    report: report([
      assertionRed(["add-sums: runs"]),
      skippedRow("clamp-bounds: skipped by options"),
      skippedRow("parse-port-refuses-garbage: skipped by modifier"),
    ]),
    contracts: CLUSTER_CONTRACTS,
  });
  assert.deepEqual(keyed(judgement), [
    "C3 clamp-bounds: skipped by options",
    "C3 parse-port-refuses-garbage: skipped by modifier",
    "C6 clamp-bounds: skipped by options",
    "C6 parse-port-refuses-garbage: skipped by modifier",
  ]);
});

test("per-test-red-review-refuses-hollow-tests: a CONDITIONAL options-form skip that RAN is judged like any new test — C6 and C7 leave it to C3", () => {
  // Under `--real` the spine forces the environment a `{ skip: !DB }` gate reads (ADR-0064), so the test
  // runs and asserts. Coverage withholds its credit, because a static read cannot know where the file
  // loads (ADR-0126); refusing it HERE would refuse a proof the runner's own report watched run.
  const title = "add-sums: the live round-trip";
  const source = `test("${title}", { skip: !DB }, async () => { assert.equal(await add(2, 3), 5); });\n`;
  const declared = declaredTestsOf(source, FIXTURE_FILE);
  // The read also carries each test's own fingerprint (ADR-0585), which is content-derived, so this
  // asserts the shape around it rather than pinning a hash any reformat of the fixture would move.
  assert.deepEqual(
    declared.map((t) => ({ path: t.path, vouches: t.vouches })),
    [{ path: [title], vouches: true }],
  );
  assert.equal(typeof declared[0]?.bodyHash, "string");
  const ran = { declared, before: [], report: report([assertionRed([title])]), contracts: CLUSTER_CONTRACTS };
  assert.deepEqual(reviewConfirmRed(ran), { ok: true, declaredTests: 1, acceptedGuardRails: [] });
  // C7 reads the same substance: a cluster brief's contract is named by this new test.
  assert.equal(reviewConfirmRed({ ...ran, briefContracts: ["add-sums"] }).ok, true);
});

test("per-test-red-review-refuses-hollow-tests: C3 refuses a skipped or todo test, even one the static read vouches for", () => {
  // A CONDITIONAL options-form skip still vouches for C6 (its body asserts, and whether it ran is not the
  // static read's to say), so only the runtime report sees that this one did not run.
  const source = `test("add-sums: runs", () => { assert.equal(add(2, 3), 5); });
test("clamp-bounds: skipped by options", { skip: !DB }, () => { assert.equal(clamp(15, 0, 10), 10); });
`;
  const declared = declaredTestsOf(source, FIXTURE_FILE);
  assert.equal(declared[1]?.vouches, true);
  const judgement = reviewConfirmRed({
    declared,
    before: [],
    report: report([assertionRed(["add-sums: runs"]), { path: ["clamp-bounds: skipped by options"], outcome: "skipped", message: "" }]),
    contracts: CLUSTER_CONTRACTS,
  });
  assert.deepEqual(keyed(judgement), ["C3 clamp-bounds: skipped by options"]);
});

test("per-test-red-review-refuses-hollow-tests: vitest's skip and todo rows refuse at C3, and its `.fails` test at C4", () => {
  // The demonstration ADR-0573 D2 owed before any vitest cluster is briefed: vitest's skip, todo and
  // `.fails` shapes, read from its json exactly as a proof run writes it, each refuse.
  const source = `import { describe, expect, test } from "vitest";
import { add } from "./subject.js";
test("add-sums: fails its assertion", () => { expect(add(1, 1)).toBe(2); });
test.skip("skip-modifier", () => { expect(add(1, 1)).toBe(2); });
test("skip-options", { skip: true }, () => { expect(add(1, 1)).toBe(2); });
test("skip-runtime", (ctx) => { ctx.skip(); expect(add(1, 1)).toBe(2); });
test.todo("todo-modifier");
test.fails("fails-modifier", () => { expect(add(1, 1)).toBe(3); });
`;
  const vitestJson = JSON.stringify({
    testResults: [
      {
        name: "cluster.test.ts",
        status: "failed",
        assertionResults: [
          { ancestorTitles: [], title: "add-sums: fails its assertion", status: "failed", failureMessages: ["AssertionError: expected undefined to be 2"] },
          { ancestorTitles: [], title: "skip-modifier", status: "skipped", failureMessages: [] },
          { ancestorTitles: [], title: "skip-options", status: "skipped", failureMessages: [] },
          { ancestorTitles: [], title: "skip-runtime", status: "skipped", failureMessages: [] },
          { ancestorTitles: [], title: "todo-modifier", status: "todo", failureMessages: [] },
          { ancestorTitles: [], title: "fails-modifier", status: "passed", failureMessages: [] },
        ],
      },
    ],
  });
  const judgement = reviewConfirmRed({
    declared: declaredTestsOf(source, FIXTURE_FILE),
    before: [],
    report: { channel: "vitest-json", present: true, rows: readVitestJsonReport(vitestJson) },
    contracts: [contract("add-sums")],
  });
  assert.deepEqual(keyed(judgement), [
    "C3 skip-modifier",
    "C3 skip-options",
    "C3 skip-runtime",
    "C3 todo-modifier",
    "C4 fails-modifier",
    "C6 skip-modifier",
    "C6 skip-options",
    "C6 todo-modifier",
  ].sort());
});

test("per-test-red-review-refuses-hollow-tests: C5 refuses a new test red for the wrong reason, read per channel", () => {
  const source = `test("add-sums: typo", () => { assert.equal(add(2, 3), 5); });\n`;
  const declared = declaredTestsOf(source, FIXTURE_FILE);
  const typeError: ReportedTest = { path: ["add-sums: typo"], outcome: "failed", errorName: "TypeError", message: "o.x is not a function" };
  assert.deepEqual(keyed(reviewConfirmRed({ declared, before: [], report: report([typeError]), contracts: CLUSTER_CONTRACTS })), ["C5 add-sums: typo"]);
  // node's channel reads the error CODE: a name alone is not an assertion red there.
  const nameOnly: ReportedTest = { path: ["add-sums: typo"], outcome: "failed", errorName: "AssertionError", message: "" };
  assert.deepEqual(keyed(reviewConfirmRed({ declared, before: [], report: report([nameOnly]), contracts: CLUSTER_CONTRACTS })), ["C5 add-sums: typo"]);
  // bun and vitest carry no code: their channels read the name.
  for (const channel of ["bun-junit", "vitest-json"] as const) {
    assert.equal(reviewConfirmRed({ declared, before: [], report: report([nameOnly], channel), contracts: CLUSTER_CONTRACTS }).ok, true, channel);
  }
});

test("per-test-red-review-refuses-hollow-tests: a pre-existing test carries no outcome rule at red, and no substance rule", () => {
  const beforeSource = `test("clamp-bounds: existing baseline", () => { assert.ok(true); });\n`;
  const afterSource = `${beforeSource}test("add-sums: the new red", () => { assert.equal(add(2, 3), 5); });\n`;
  const before = declaredTestsOf(beforeSource, FIXTURE_FILE);
  const declared = declaredTestsOf(afterSource, FIXTURE_FILE);
  for (const existing of [passed(["clamp-bounds: existing baseline"]), assertionRed(["clamp-bounds: existing baseline"])]) {
    const judgement = reviewConfirmRed({
      declared,
      before,
      report: report([existing, assertionRed(["add-sums: the new red"])]),
      contracts: CLUSTER_CONTRACTS,
    });
    assert.deepEqual(judgement, { ok: true, declaredTests: 2, acceptedGuardRails: [] }, existing.outcome);
  }
});

test("per-test-red-review-refuses-hollow-tests: C7 refuses a cluster brief's contract that no new vouching test names", () => {
  const source = `test("add-sums: real", () => { assert.equal(add(2, 3), 5); });
test("clamp-bounds: hollow", () => {});
`;
  const judgement = reviewConfirmRed({
    declared: declaredTestsOf(source, FIXTURE_FILE),
    before: [],
    report: report([assertionRed(["add-sums: real"]), assertionRed(["clamp-bounds: hollow"])]),
    contracts: CLUSTER_CONTRACTS,
    briefContracts: ["add-sums", "clamp-bounds", "parse-port-refuses-garbage"],
  });
  assert.deepEqual(
    findingsOf(judgement).filter((f) => f.check === "C7").map((f) => f.detail),
    [
      "the brief named contract `clamp-bounds`, and no new test that vouches names it",
      "the brief named contract `parse-port-refuses-garbage`, and no new test that vouches names it",
    ],
  );
});

test("per-test-red-review-refuses-hollow-tests: a test file with no test in it refuses at both phases", () => {
  const empty = { declared: [], report: report([]) };
  assert.deepEqual(findingsOf(reviewConfirmRed({ ...empty, before: [], contracts: [] })).map((f) => f.check), ["C2"]);
  assert.deepEqual(findingsOf(reviewConfirmGreen(empty)).map((f) => f.check), ["C2"]);
});

// ── The early-pass rule (ADR-0572) ──────────────────────────────────────────

test("early-pass-refused-unless-its-contract-declares-a-guard-rail: G1 refuses without a declaration, and is accepted and recorded with one", () => {
  const declared = declaredTestsOf(GUARD_RAIL_CLUSTER, FIXTURE_FILE);
  const rows = [assertionRed(suite(REAL[0] ?? "")), assertionRed(suite(REAL[2] ?? "")), passed(suite(G1))];

  const undeclared = reviewConfirmRed({
    declared,
    before: [],
    report: report(rows),
    contracts: [contract("add-sums"), contract("parse-port-refuses-garbage"), contract("parse-port-accepts-a-valid-port")],
  });
  assert.equal(undeclared.ok, false);
  const [finding] = findingsOf(undeclared);
  assert.equal(findingsOf(undeclared).length, 1);
  assert.equal(finding?.check, "C4");
  assert.deepEqual(finding?.test, suite(G1));
  assert.deepEqual(finding?.namedContracts, ["parse-port-accepts-a-valid-port"]);

  const declaredGuardRail = reviewConfirmRed({
    declared,
    before: [],
    report: report(rows),
    contracts: [
      contract("add-sums"),
      contract("parse-port-refuses-garbage"),
      contract("parse-port-accepts-a-valid-port", ["guard-rail", GUARD_RAIL_TEXT]),
    ],
  });
  assert.deepEqual(declaredGuardRail, {
    ok: true,
    declaredTests: 3,
    acceptedGuardRails: [{ test: suite(G1), contracts: ["parse-port-accepts-a-valid-port"] }],
  });
});

test("early-pass-refused-unless-its-contract-declares-a-guard-rail: EVERY contract a passing test's path names must declare one", () => {
  const source = `describe("add-sums: the suite names one contract", () => {
  test("clamp-bounds: and the test names another", () => { assert.equal(clamp(15, 0, 10), 10); });
});
`;
  const judgement = reviewConfirmRed({
    declared: declaredTestsOf(source, FIXTURE_FILE),
    before: [],
    report: report([passed(["add-sums: the suite names one contract", "clamp-bounds: and the test names another"])]),
    contracts: [contract("add-sums", ["guard-rail", GUARD_RAIL_TEXT]), contract("clamp-bounds")],
  });
  const [finding] = findingsOf(judgement);
  assert.equal(finding?.check, "C4");
  assert.deepEqual(finding?.namedContracts, ["add-sums", "clamp-bounds"]);
  assert.match(finding?.detail ?? "", /`clamp-bounds` does not declare a guard-rail/);
});

test("early-pass-refused-unless-its-contract-declares-a-guard-rail: a passing test naming no contract refuses", () => {
  const source = `test("never throws", () => { assert.doesNotThrow(() => parsePort("8080")); });\n`;
  const [finding] = findingsOf(
    reviewConfirmRed({ declared: declaredTestsOf(source, FIXTURE_FILE), before: [], report: report([passed(["never throws"])]), contracts: CLUSTER_CONTRACTS }),
  );
  assert.equal(finding?.check, "C4");
  assert.deepEqual(finding?.namedContracts, []);
  assert.match(finding?.detail ?? "", /names no declared contract/);
});

test("early-pass-refused-unless-its-contract-declares-a-guard-rail: an empty guard-rail bullet and a near-miss label declare nothing, and say so", () => {
  const source = `test("parse-port-accepts-a-valid-port: never throws", () => { assert.doesNotThrow(() => parsePort("8080")); });\n`;
  const declared = declaredTestsOf(source, FIXTURE_FILE);
  const rows = [passed(["parse-port-accepts-a-valid-port: never throws"])];
  const empty = reviewConfirmRed({
    declared,
    before: [],
    report: report(rows),
    contracts: [contract("parse-port-accepts-a-valid-port", ["guard-rail", "  "])],
  });
  assert.match(findingsOf(empty)[0]?.detail ?? "", /carries a `guard-rail` bullet with no text, which declares nothing/);
  const nearMiss = reviewConfirmRed({
    declared,
    before: [],
    report: report(rows),
    contracts: [contract("parse-port-accepts-a-valid-port", ["guardrail", GUARD_RAIL_TEXT])],
  });
  assert.match(findingsOf(nearMiss)[0]?.detail ?? "", /carries a `guardrail` bullet, which is not the `guard-rail` spelling/);
});

test("early-pass-refused-unless-its-contract-declares-a-guard-rail: the refusal names each test and check, and carries the three routes only for an early pass", () => {
  const judgement = reviewConfirmRed({
    declared: declaredTestsOf(CLUSTER, FIXTURE_FILE),
    before: [],
    report: report([...REAL.map((t) => assertionRed(suite(t))), ...HOLLOW.map((t) => passed(suite(t)))]),
    contracts: CLUSTER_CONTRACTS,
  });
  const reason = describePerTestRefusal("CONFIRM_RED", findingsOf(judgement));
  assert.match(reason, /^CONFIRM_RED refused per test \(ADR-0573 D1\) — 7 finding\(s\):/);
  assert.ok(reason.includes(`  - C4 individually red — \`probe-cluster > ${HOLLOW[0]}\`: passed before its implementation exists`));
  assert.ok(reason.includes(`  - C6 substance — \`probe-cluster > ${HOLLOW[1]}\``));
  assert.ok(reason.endsWith(EARLY_PASS_ROUTES));
  assert.match(EARLY_PASS_ROUTES, /\(a\) have the story-author declare the contract a guard-rail, then re-run — a `changed-input` attempt/);
  assert.match(EARLY_PASS_ROUTES, /\(b\) re-delegate a test revision .* a `revised-test` attempt/);
  assert.match(EARLY_PASS_ROUTES, /\(c\) escalate to the owner/);

  const noEarlyPass = describePerTestRefusal("CONFIRM_GREEN", [{ check: "green", test: ["t"], detail: "failed" }]);
  assert.equal(noEarlyPass.includes(EARLY_PASS_ROUTES), false);
});

// ── Completeness at CONFIRM_GREEN ───────────────────────────────────────────

test("per-test-green-requires-every-declared-test: every declared test, new and pre-existing, must report individually green", () => {
  const declared = declaredTestsOf(GUARD_RAIL_CLUSTER, FIXTURE_FILE);
  const allGreen = [passed(suite(REAL[0] ?? "")), passed(suite(REAL[2] ?? "")), passed(suite(G1))];
  assert.deepEqual(reviewConfirmGreen({ declared, report: report(allGreen) }), { ok: true, declaredTests: 3, acceptedGuardRails: [] });

  const oneRed = [...allGreen.slice(0, 2), assertionRed(suite(G1))];
  const refused = reviewConfirmGreen({ declared, report: report(oneRed) });
  assert.deepEqual(keyed(refused), [`green ${G1}`]);
  assert.match(findingsOf(refused)[0]?.detail ?? "", /^failed: AssertionError \(ERR_ASSERTION\)/);
});

test("per-test-green-requires-every-declared-test: an early exit's single passing FILE row does not make a green", () => {
  const declared = declaredTestsOf(GUARD_RAIL_CLUSTER, FIXTURE_FILE);
  const judgement = reviewConfirmGreen({ declared, report: report([passed(["guardrail.test.ts"])]) });
  assert.deepEqual(keyed(judgement), [`C2 ${REAL[0]}`, `C2 ${REAL[2]}`, `C2 ${G1}`, "C2 guardrail.test.ts"].sort());
  // bun writes no report at all after an early exit.
  assert.deepEqual(findingsOf(reviewConfirmGreen({ declared, report: { channel: "bun-junit", present: false, rows: [] } })).map((f) => f.check), ["C1"]);
});

// ── Disclosure and the file-backed policy ───────────────────────────────────

test("per-test-review-only-refuses: the verdict evidence discloses whether each observation was per test", () => {
  const redOk: PerTestJudgement = { ok: true, declaredTests: 3, acceptedGuardRails: [] };
  const withAccepted: PerTestJudgement = { ok: true, declaredTests: 3, acceptedGuardRails: [{ test: ["t"], contracts: ["c"] }] };
  const policy = perTestPolicy({ testFile: "/nowhere.test.ts", recordFile: "nowhere.test.ts", contracts: [], observeRed: true });
  const structural = perTestPolicy({ testFile: "/nowhere.test.ts", recordFile: "nowhere.test.ts", contracts: [], observeRed: false });

  assert.equal(redEvidenceDisclosure(undefined, undefined), undefined, "no policy: the evidence reads exactly as before");
  assert.equal(
    redEvidenceDisclosure(policy, redOk),
    "per-test: 3 declared test(s) reviewed individually at CONFIRM_RED (ADR-0573 C1–C7); none accepted before its implementation existed",
  );
  assert.match(redEvidenceDisclosure(policy, withAccepted) ?? "", /1 accepted as a declared guard-rail, never observed failing/);
  assert.equal(redEvidenceDisclosure(structural, undefined), `per-test: not observed at CONFIRM_RED — ${STRUCTURAL_RED_NOT_OBSERVED}`);
  assert.equal(
    greenEvidenceDisclosure(redOk),
    "per-test: 3 declared test(s) each reported green at CONFIRM_GREEN (ADR-0573 D1)",
  );
  assert.equal(greenEvidenceDisclosure(undefined), undefined);
});

test("per-test-review-only-refuses: the policy reads the test file before AUTHOR_TEST, so a test present then is pre-existing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "storytree-per-test-policy-"));
  try {
    const testFile = join(dir, "unit.test.ts");
    const existing = `test("clamp-bounds: an existing test that already passes", () => { assert.equal(clamp(15, 0, 10), 10); });\n`;
    await writeFile(testFile, existing);
    const policy = perTestPolicy({ testFile, recordFile: "unit.test.ts", contracts: CLUSTER_CONTRACTS, observeRed: true });
    const confirmRed = policy.confirmRed;
    assert.ok(confirmRed !== undefined, "an assertion red is observed per test");

    const obs: TestObservation = {
      result: "red",
      testId: "unit",
      perTest: report([
        passed(["clamp-bounds: an existing test that already passes"]),
        assertionRed(["add-sums: appended by AUTHOR_TEST"]),
      ]),
    };

    // Read too late — after the author already appended — every test would read NEW.
    assert.deepEqual(findingsOf(confirmRed(obs)).map((f) => f.check), ["C2"]);

    policy.beforeAuthorTest();
    await writeFile(testFile, `${existing}test("add-sums: appended by AUTHOR_TEST", () => { assert.equal(add(2, 3), 5); });\n`);
    assert.deepEqual(confirmRed(obs), { ok: true, declaredTests: 2, acceptedGuardRails: [] });

    assert.equal(policy.confirmGreen({ ...obs, result: "green" }).ok, false, "a declared test still red refuses the green");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("per-test-green-requires-every-declared-test: the policy reads a `.tsx` test file as TSX, so a correct test after JSX binds to its row", async () => {
  // MEASURED 2026-09-15 on four real `.tsx` files (`docs/research/net-new-skeleton-red-measurement-2026-09-15.md`
  // §7): read as plain TypeScript, the suite around a test that follows JSX is lost, so the runner's row
  // `Dock > c-follows-jsx: …` matches no declaration and the declaration is never reported, and C2
  // refused CORRECT tests. The file's own name is what selects the parse.
  const dir = await mkdtemp(join(tmpdir(), "storytree-per-test-tsx-"));
  try {
    const testFile = join(dir, "Dock.test.tsx");
    await writeFile(
      testFile,
      `describe("Dock", () => {
  it("c-seeds: a seed opens a tab", () => {
    render(<Dock seed={{ command: "ls", token: 1 }} />);
    expect(screen.getByRole("tab")).toBeTruthy();
  });
  it("c-follows-jsx: a test after the JSX keeps its describe", () => {
    expect(bridge.write).not.toHaveBeenCalled();
  });
});
`,
    );
    const policy = perTestPolicy({ testFile, recordFile: "unit.test.ts", contracts: [], observeRed: false });
    const rows = readVitestJsonReport(
      JSON.stringify({
        testResults: [
          {
            name: testFile,
            status: "passed",
            assertionResults: [
              { ancestorTitles: ["Dock"], title: "c-seeds: a seed opens a tab", status: "passed", failureMessages: [] },
              {
                ancestorTitles: ["Dock"],
                title: "c-follows-jsx: a test after the JSX keeps its describe",
                status: "passed",
                failureMessages: [],
              },
            ],
          },
        ],
      }),
    );
    const obs: TestObservation = { result: "green", testId: "dock", perTest: report(rows, "vitest-json") };
    assert.deepEqual(policy.confirmGreen(obs), { ok: true, declaredTests: 2, acceptedGuardRails: [] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("per-test-review-only-refuses: a structural red is not observed per test, and the policy says why", () => {
  const policy = perTestPolicy({ testFile: "/nowhere.test.ts", recordFile: "nowhere.test.ts", contracts: [], observeRed: false });
  assert.equal(policy.confirmRed, undefined);
  assert.equal(policy.redNotObserved, STRUCTURAL_RED_NOT_OBSERVED);
});
