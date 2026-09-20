import assert from "node:assert/strict";
import test from "node:test";

import {
  INNER_LOOP_EVENT_KIND,
  type InnerLoopEventDoc,
} from "@storytree/proof-protocol";
import type { StoreEvent } from "@storytree/storage-protocol";

import { attemptReportFromLedger, parseAttemptRecord } from "./attempt-report.js";
import { foldInnerLoopLedger, innerLoopEventId } from "./inner-loop-ledger.js";

const unitId = "unit";
const INC = "increment";

const stored = (doc: InnerLoopEventDoc, seq: number): StoreEvent => ({
  seq,
  id: innerLoopEventId(doc),
  kind: INNER_LOOP_EVENT_KIND,
  type: "created",
  doc,
  actor: "test",
  at: `2026-09-21T00:00:${String(seq).padStart(2, "0")}.000Z`,
});
const attempt = (runId: string, incrementId = INC): InnerLoopEventDoc => ({
  event: "attempt",
  unitId,
  incrementId,
  runId,
});
const pass = (runId: string): InnerLoopEventDoc => ({
  event: "signed-pass",
  unitId,
  incrementId: INC,
  runId,
});
const grant = (runId: string, attempts = 2): InnerLoopEventDoc => ({
  event: "grant",
  unitId,
  incrementId: INC,
  runId,
  attempts,
  kind: "fixed-defect",
  difference: "the parser now keeps its trailing newline",
});

const ledgerOf = (...docs: InnerLoopEventDoc[]) =>
  foldInnerLoopLedger(
    docs.map((doc, i) => stored(doc, i + 1)),
    unitId,
  );

// ── attemptReportFromLedger (ADR-0586 D5) ───────────────────────────────────────────────────────

test("a-retry-reads-its-predecessor: the ledger's latest FAILED attempt is what a report names", () => {
  const report = attemptReportFromLedger(ledgerOf(attempt("r1"), attempt("r2")));

  assert.deepEqual(report, { runId: "r2", incrementId: INC });
});

test("the reported attempt keeps the increment it was FILED under, not the one a retry names", () => {
  const report = attemptReportFromLedger(ledgerOf(attempt("r1", "older-increment")));

  assert.equal(report?.incrementId, "older-increment");
});

test("nothing is reported for an absent ledger, an empty one, or a SIGNED latest attempt", () => {
  assert.equal(attemptReportFromLedger(undefined), undefined);
  assert.equal(attemptReportFromLedger(ledgerOf()), undefined);
  assert.equal(attemptReportFromLedger(ledgerOf(attempt("r1"), pass("r1"))), undefined);
});

test("a live grant rides the report; a spent one does not", () => {
  const granted = attemptReportFromLedger(
    ledgerOf(attempt("r1"), attempt("r2"), attempt("r3"), grant("r3")),
  );
  assert.deepEqual(granted?.grant, {
    kind: "fixed-defect",
    difference: "the parser now keeps its trailing newline",
  });

  // The grant allowed ONE attempt and r4 consumed it: the difference was written about an attempt
  // already made, so the build after r4 must not read it as its own.
  const spent = attemptReportFromLedger(
    ledgerOf(attempt("r1"), attempt("r2"), attempt("r3"), grant("r3", 1), attempt("r4")),
  );
  assert.equal(spent?.runId, "r4");
  assert.equal(spent?.grant, undefined);
});

test("the ledger half of a report never carries an observation — that half is the file's", () => {
  const report = attemptReportFromLedger(ledgerOf(attempt("r1")));

  assert.equal(report?.observed, undefined);
});

// ── parseAttemptRecord (ADR-0586 D7) ────────────────────────────────────────────────────────────

const validRecord = {
  unitId,
  runId: "r1",
  failedAt: "CONFIRM_GREEN",
  escalationReturned: false,
  reason: "the implementation did not make the test pass",
  observation: { stdout: "1 failing", stderr: "", exitCode: 1 },
};

test("a well-formed record round-trips, rebuilt field by field rather than trusted verbatim", () => {
  const parsed = parseAttemptRecord({ ...validRecord, smuggled: "extra" }, unitId, "r1");

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && parsed.record, validRecord);
  assert.equal(parsed.ok && "smuggled" in parsed.record, false);
});

test("an optional field left out stays out rather than coming back undefined", () => {
  const parsed = parseAttemptRecord(
    { unitId, runId: "r1", failedAt: "GATE", escalationReturned: false },
    unitId,
    "r1",
  );

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.ok && Object.keys(parsed.record).toSorted(), [
    "escalationReturned",
    "failedAt",
    "runId",
    "unitId",
  ]);
});

test("a record for another unit or another run is refused by name", () => {
  const wrongUnit = parseAttemptRecord(validRecord, "other-unit", "r1");
  assert.equal(wrongUnit.ok, false);
  assert.match(!wrongUnit.ok ? wrongUnit.reason : "", /does not match the expected unitId/);

  const wrongRun = parseAttemptRecord(validRecord, unitId, "r9");
  assert.equal(wrongRun.ok, false);
  assert.match(!wrongRun.ok ? wrongRun.reason : "", /does not match the expected runId/);
});

test("every malformed shape a failed build never writes is refused", () => {
  const cases: ReadonlyArray<[unknown, RegExp]> = [
    ["not an object", /must be an object/],
    [null, /must be an object/],
    [[validRecord], /must be an object/],
    [{ ...validRecord, failedAt: "   " }, /failedAt must be a non-blank string/],
    [{ ...validRecord, failedAt: 7 }, /failedAt must be a non-blank string/],
    [{ ...validRecord, escalationReturned: "yes" }, /escalationReturned must be a boolean/],
    [{ ...validRecord, reason: "" }, /reason, when present, must be a non-blank string/],
    [{ ...validRecord, observation: { stdout: "a", stderr: "b" } }, /observation must be/],
    [{ ...validRecord, observation: { stdout: "a", stderr: "b", exitCode: "1" } }, /observation must be/],
  ];

  for (const [input, expected] of cases) {
    const parsed = parseAttemptRecord(input, unitId, "r1");
    assert.equal(parsed.ok, false, `expected a refusal for ${JSON.stringify(input)}`);
    assert.match(!parsed.ok ? parsed.reason : "", expected);
  }
});

test("an-escalations-claim-never-rides-a-report: an escalating record carrying a reason is refused", () => {
  // The gate appends the escalation's kind and statement verbatim to the refusal reason (ADR-0569
  // D4), so a record that claims both would carry a worker's CLAIM into the next build's briefs —
  // the automatic escalation thread ADR-0571 D1 refused.
  const parsed = parseAttemptRecord(
    {
      unitId,
      runId: "r1",
      failedAt: "AUTHOR_TEST",
      escalationReturned: true,
      reason: 'escalation (unsatisfiable-test): "the contract cannot be tested"',
    },
    unitId,
    "r1",
  );

  assert.equal(parsed.ok, false);
  assert.match(!parsed.ok ? parsed.reason : "", /must carry no reason/);
  assert.match(!parsed.ok ? parsed.reason : "", /ADR-0586 D6/);
});

test("an escalating record with no reason is admitted, carrying only the fact", () => {
  const parsed = parseAttemptRecord(
    {
      unitId,
      runId: "r1",
      failedAt: "AUTHOR_TEST",
      escalationReturned: true,
      observation: { stdout: "", stderr: "boom", exitCode: null },
    },
    unitId,
    "r1",
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.record.escalationReturned, true);
  assert.equal(parsed.ok && parsed.record.reason, undefined);
  assert.deepEqual(parsed.ok && parsed.record.observation, {
    stdout: "",
    stderr: "boom",
    exitCode: null,
  });
});
