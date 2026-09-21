/**
 * `a-changed-test-outside-the-proof-file-is-held-to-what-it-declared` (ADR-0591): the obligation
 * ADR-0585 D4 puts on a changed test is HELD where the proof command cannot reach, by running exactly
 * the changed files and reading each one's own per-test report.
 *
 * WHY RED AND NOT GREEN. The landing gate and CI run every one of these files, so a green only they
 * observe is not weaker evidence. "This test FAILS against the source the build began from" is the half
 * no later runner can establish, because it needs the implementation set aside — which only the build
 * ever does. So this channel checks red and says so, rather than doing half of each.
 *
 * THE SHAPE THESE ASSERTIONS GUARD. Every branch that CANNOT check a claim must produce a finding, not
 * silence: an absent report, an unreadable one, a test the run never mentioned, and an outcome that is
 * not a real pass or fail. A marker's claim that goes unchecked being recorded as checked is the exact
 * failure this whole channel exists to prevent, and it is the one a lazy implementation falls into.
 *
 * `packages/orchestrator` is OUTSIDE the mutation rung (ADR-0473), so nothing fault-seeds these.
 * Declared rather than papered over (ADR-0563 / ADR-0447).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import type { PerTestReport, ReportedTest } from "./per-test-report.js";
import { markObserved, outsideChangedFiles, reviewOutsideRed } from "./test-baseline.js";
import type { TestChange, TestChangeRecord } from "./test-baseline.js";

const PROOF = "packages/unit/src/unit.test.ts";
const OTHER = "packages/unit/src/sibling.test.ts";
const TITLE = ["clamps a port", "rejects a negative"];

const change = (over: Partial<TestChange> = {}): TestChange => ({
  file: OTHER,
  observed: false,
  test: TITLE,
  kind: "updated",
  reason: "rejects a negative — the port now clamps",
  asserts: "new-behaviour",
  ...over,
});

/** A change whose marker was missing: it states no reason and so declares no obligation. */
const noReason = (file = OTHER): TestChange => ({ file, observed: false, test: TITLE, kind: "updated" });

const record = (...changes: TestChange[]): TestChangeRecord => ({ changes, findings: [] });

const row = (outcome: ReportedTest["outcome"], message = ""): ReportedTest => ({
  path: TITLE,
  outcome,
  message,
});

const report = (over: Partial<PerTestReport> = {}): PerTestReport => ({
  channel: "node-test",
  present: true,
  rows: [row("failed")],
  ...over,
});

test("a new-behaviour change that FAILS against the base source is exactly what it declared", () => {
  const findings = reviewOutsideRed({
    record: record(change()),
    observations: [{ file: OTHER, report: report({ rows: [row("failed", "expected 10, got 15")] }) }],
  });
  assert.deepEqual(findings, [], "it claimed the source does not do this yet, and it does not");
});

test("a new-behaviour change that PASSES against the base source is refused", () => {
  const findings = reviewOutsideRed({
    record: record(change()),
    observations: [{ file: OTHER, report: report({ rows: [row("passed")] }) }],
  });
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.check, "C8");
  assert.equal(findings[0]?.testSide, true, "only a change to the test file can clear this");
  assert.deepEqual(findings[0]?.test, TITLE);
  assert.match(findings[0]?.detail ?? "", /PASSES against the source this build began from/);
  assert.match(findings[0]?.detail ?? "", /packages\/unit\/src\/sibling\.test\.ts/, "it names the file");
  assert.match(findings[0]?.detail ?? "", /test-updated \(refactor\)/, "the remedy is the message");
});

test("a refactor that still PASSES against the base source is exactly what it declared", () => {
  const findings = reviewOutsideRed({
    record: record(change({ asserts: "same-behaviour" })),
    observations: [{ file: OTHER, report: report({ rows: [row("passed")] }) }],
  });
  assert.deepEqual(findings, [], "it claimed the same behaviour in a different shape, and it holds");
});

test("a refactor that FAILS against the base source is refused, and its failure is quoted", () => {
  const findings = reviewOutsideRed({
    record: record(change({ asserts: "same-behaviour" })),
    observations: [{ file: OTHER, report: report({ rows: [row("failed", "expected 10, got 15")] }) }],
  });
  assert.equal(findings.length, 1);
  assert.match(findings[0]?.detail ?? "", /declares it is a REFACTOR/);
  assert.match(findings[0]?.detail ?? "", /what it asserts has changed/);
  assert.match(findings[0]?.detail ?? "", /expected 10, got 15/, "the worker is told HOW it failed");
  assert.match(findings[0]?.detail ?? "", /test-updated \(new behaviour\)/, "and what to record instead");
});

test("SILENCE IS NEVER A PASS — every branch that cannot check the claim says so", () => {
  const cases: ReadonlyArray<readonly [string, PerTestReport, RegExp]> = [
    ["no report was written", report({ present: false, rows: [] }), /could not read what its run reported/],
    [
      "the report could not be read",
      report({ unreadable: "malformed JSON at line 3" }),
      /malformed JSON at line 3/,
    ],
    ["the run never mentioned the test", report({ rows: [] }), /reported no such test/],
    ["the test was skipped", report({ rows: [row("skipped")] }), /reported it as `skipped`/],
    ["the test was a todo", report({ rows: [row("todo")] }), /reported it as `todo`/],
  ];

  for (const [what, r, expected] of cases) {
    const findings = reviewOutsideRed({ record: record(change()), observations: [{ file: OTHER, report: r }] });
    assert.equal(findings.length, 1, `${what}: exactly one finding`);
    assert.equal(findings[0]?.check, "C8", what);
    assert.equal(findings[0]?.testSide, true, what);
    assert.match(findings[0]?.detail ?? "", expected, what);
  }
});

test("a change with NO stated reason is not charged twice — the record already holds its finding", () => {
  const findings = reviewOutsideRed({
    // `asserts` absent is exactly what a change with no marker looks like; it declared no obligation.
    record: record(noReason()),
    observations: [{ file: OTHER, report: report({ rows: [row("passed")] }) }],
  });
  assert.deepEqual(findings, [], "its missing reason is the record's C8 to report, not this channel's");
});

test("a file this build did not run is judged by nothing at all", () => {
  const findings = reviewOutsideRed({ record: record(change()), observations: [] });
  assert.deepEqual(findings, [], "no observation means no claim was checked, and none is refused either");
});

test("one file's report never answers for another file's change", () => {
  // Both files changed a test of the SAME title; only OTHER was run, and it passed. The proof file's
  // own change must not be judged by it — that is the collision the file stamp exists for.
  const findings = reviewOutsideRed({
    record: record(change(), change({ file: PROOF, observed: true })),
    observations: [{ file: OTHER, report: report({ rows: [row("passed")] }) }],
  });
  assert.equal(findings.length, 1, "only the file that was actually run is judged");
  assert.match(findings[0]?.detail ?? "", /packages\/unit\/src\/sibling\.test\.ts/);
});

test("outsideChangedFiles names the files worth running, and no others", () => {
  assert.deepEqual(
    outsideChangedFiles(
      record(
        change(),
        change({ file: OTHER, test: ["clamps a port", "another"] }),
        change({ file: PROOF, observed: true }),
        noReason("packages/unit/src/third.test.ts"),
      ),
    ),
    [OTHER],
    "deduplicated; the already-observed proof file and a change declaring no obligation are both skipped",
  );
  assert.deepEqual(outsideChangedFiles(record()), []);
});

test("markObserved raises the flag only for files that actually ran", () => {
  const before = [change(), change({ file: "packages/unit/src/third.test.ts" }), change({ file: PROOF, observed: true })];
  const after = markObserved(before, [OTHER]);

  assert.deepEqual(
    after.map((c) => [c.file, c.observed]),
    [
      [OTHER, true],
      ["packages/unit/src/third.test.ts", false],
      [PROOF, true],
    ],
    "the file that ran is now observed; the one that could not be run keeps the envelope's qualifier",
  );
  assert.deepEqual(before.map((c) => c.observed), [false, false, true], "the input is not mutated");
});
