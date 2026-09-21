/**
 * The harness-end record's proof: it PERSISTS a refusal, and it can never be read as a verdict.
 *
 * The renders are pinned WHOLE (one golden per shape) rather than probed phrase by phrase. That is
 * deliberate and it is not laziness: this module's job is to say, in words, what a row is and what
 * it is NOT, so the wording is the contract — changing it is meant to fail here and be re-read.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  boundHarnessDetail,
  classifyDriveAttempt,
  harnessEndInsert,
  harnessEndPhaseForDriveEnd,
  harnessEndRecord,
  isMissingHarnessEndTable,
  parseHarnessEnds,
  renderHarnessEnd,
  HARNESS_END_DETAIL_CHARS,
  HARNESS_END_PHASE_STATEMENTS,
  HARNESS_END_SELECT,
  UAT_HARNESS_END_EVIDENCE_CLASS,
  UAT_HARNESS_END_PHASES,
  UAT_HARNESS_END_TABLE,
  UatHarnessEndRecord,
  type HarnessEndDraft,
} from "./uat-drive-harness-end.js";
import { classifyDriveEnd, selectWitnessableDrive, UatDriveRecord } from "./uat-drive.js";

// ---------------------------------------------------------------------------
// Fixtures — the MEASURED 2026-08-24 launch refusal, and its two thinner siblings
// ---------------------------------------------------------------------------

/** The exact payload that killed `embedded-terminal` at 0.4m of a 60-min ceiling. */
const INVALID_MODEL_ERROR =
  `ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":\n` +
  `"The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."}}`;

const LAUNCH_FAILURE: HarnessEndDraft = {
  storyId: "embedded-terminal",
  criterionId: "uatc_4a73475c396b1635baf9f5d1",
  revisionId: "rev-91ab",
  runId: "uat-drive:embedded-terminal:9a8b7c6d5e:41236",
  commitSha: "9a8b7c6d5e1f2a3b4c5d6e7f8091a2b3c4d5e6f7",
  phase: "launch-failed",
  host: "MicksMSpro",
  provider: "codex",
  driver: "codex-chatgpt-subscription",
  model: "gpt-5.6-sol",
  process: { exitCode: 1, signal: null, timedOut: false, elapsedMinutes: 0.4 },
  detail: INVALID_MODEL_ERROR,
  at: "2026-08-24T02:14:09.000Z",
};

/** A refusal that happened before ANY runtime was resolved, and produced no output at all. */
const NOTHING_KNOWN: HarnessEndDraft = {
  storyId: "studio",
  criterionId: "uatc_deadbeef",
  revisionId: "rev-0001",
  runId: "uat-drive:studio:1111111111:7",
  commitSha: "1111111111",
  phase: "runtime-refused",
  host: "box-2",
  detail: "",
  at: "2026-09-01T00:00:00.000Z",
};

const CLOSING_PARAGRAPH = [
  "  Nothing about the PRODUCT was observed: no journey was walked to a conclusion, nothing was",
  "  found wrong, and no verdict was reached. This record can never witness a UAT leg — the witness",
  "  gate reads events.uat_drive, and this is not one. Fix the launch and drive the journey again.",
].join("\n");

// ---------------------------------------------------------------------------
// What each phase MEANS — the whole table, pinned at once
// ---------------------------------------------------------------------------

test("every harness-end phase carries its own statement, and the set is exactly these eight", () => {
  assert.deepEqual(HARNESS_END_PHASE_STATEMENTS, {
    "runtime-refused":
      "the provider's subscription runtime refused before any model time was spent — an authentication, model or configuration precondition",
    "isolation-refused":
      "the drive could not be separated from the session that launched it, so it was refused before it could walk anything",
    "prompt-audit-refused":
      "the drive prompt had lost the authored journey, the honesty clause or the report contract, so it was refused before it was sent",
    "launch-failed":
      "the drive session died before it could have walked anything — it never got going, rather than running out of budget",
    "walk-unreported":
      "the drive session ended without a readable report, inside a ceiling it never reached — the session ran out before the walk did",
    "ceiling-cut-off":
      "the harness stopped the walk at its own wall-clock ceiling while the journey was still running",
    "report-timing-refused":
      "the report claimed a deadline the runner's own clock says had not arrived, so it was refused rather than believed",
    "surface-ownership-refused":
      "the walk could not be attributed to this checkout's own surface, so what it observed is not evidence about this commit",
  });
  assert.deepEqual(Object.keys(HARNESS_END_PHASE_STATEMENTS).sort(), [...UAT_HARNESS_END_PHASES].sort());
});

test("a drive END maps to a harness phase — except the one end that is a PRODUCT outcome", () => {
  assert.equal(harnessEndPhaseForDriveEnd("reported"), null);
  assert.equal(harnessEndPhaseForDriveEnd("cut-off"), "ceiling-cut-off");
  assert.equal(harnessEndPhaseForDriveEnd("no-report"), "walk-unreported");
  assert.equal(harnessEndPhaseForDriveEnd("no-start"), "launch-failed");
});

// ---------------------------------------------------------------------------
// The render — what a later reader with nothing but this row is told
// ---------------------------------------------------------------------------

test("renderHarnessEnd: the full record states what it is, what refused it, and what it is NOT", () => {
  assert.equal(
    renderHarnessEnd(harnessEndRecord(LAUNCH_FAILURE)),
    [
      "HARNESS END — the machinery stopped. This is NOT a product verdict.",
      "  story/criterion: embedded-terminal / uatc_4a73475c396b1635baf9f5d1 (revision rev-91ab)",
      "  phase:           launch-failed — the drive session died before it could have walked anything — it never got going, rather than running out of budget",
      "  runtime:         codex-chatgpt-subscription, model gpt-5.6-sol on MicksMSpro",
      "  commit:          9a8b7c6d5e1f2a3b4c5d6e7f8091a2b3c4d5e6f7",
      "  run:             uat-drive:embedded-terminal:9a8b7c6d5e:41236",
      "  at:              2026-08-24T02:14:09.000Z",
      "  process:         exit 1, signal none, not timed out, after 0.4m",
      "  cause:",
      `    | ERROR: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":`,
      `    | "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account."}}`,
      CLOSING_PARAGRAPH,
    ].join("\n"),
  );
});

test("renderHarnessEnd: a refusal that resolved NO runtime and produced NO output still says so", () => {
  assert.equal(
    renderHarnessEnd(harnessEndRecord(NOTHING_KNOWN)),
    [
      "HARNESS END — the machinery stopped. This is NOT a product verdict.",
      "  story/criterion: studio / uatc_deadbeef (revision rev-0001)",
      "  phase:           runtime-refused — the provider's subscription runtime refused before any model time was spent — an authentication, model or configuration precondition",
      "  runtime:         (no runtime resolved) on box-2",
      "  commit:          1111111111",
      "  run:             uat-drive:studio:1111111111:7",
      "  at:              2026-09-01T00:00:00.000Z",
      "  cause:",
      "    | (the drive produced no output at all)",
      CLOSING_PARAGRAPH,
    ].join("\n"),
  );
});

test("renderHarnessEnd: a resolved PROVIDER with no verified driver names the provider", () => {
  assert.equal(
    renderHarnessEnd(
      harnessEndRecord({
        ...NOTHING_KNOWN,
        phase: "isolation-refused",
        provider: "claude",
        detail: "no free port in the reserved drive band",
      }),
    ),
    [
      "HARNESS END — the machinery stopped. This is NOT a product verdict.",
      "  story/criterion: studio / uatc_deadbeef (revision rev-0001)",
      "  phase:           isolation-refused — the drive could not be separated from the session that launched it, so it was refused before it could walk anything",
      "  runtime:         claude on box-2",
      "  commit:          1111111111",
      "  run:             uat-drive:studio:1111111111:7",
      "  at:              2026-09-01T00:00:00.000Z",
      "  cause:",
      "    | no free port in the reserved drive band",
      CLOSING_PARAGRAPH,
    ].join("\n"),
  );
});

test("renderHarnessEnd: a walk KILLED at the ceiling reports no exit code and the signal that killed it", () => {
  assert.equal(
    renderHarnessEnd(
      harnessEndRecord({
        ...NOTHING_KNOWN,
        phase: "ceiling-cut-off",
        driver: "codex-chatgpt-subscription",
        process: { exitCode: null, signal: "SIGTERM", timedOut: true, elapsedMinutes: 30 },
        detail: "the HARNESS stopped the walk at its 30-min ceiling",
      }),
    ),
    [
      "HARNESS END — the machinery stopped. This is NOT a product verdict.",
      "  story/criterion: studio / uatc_deadbeef (revision rev-0001)",
      "  phase:           ceiling-cut-off — the harness stopped the walk at its own wall-clock ceiling while the journey was still running",
      "  runtime:         codex-chatgpt-subscription on box-2",
      "  commit:          1111111111",
      "  run:             uat-drive:studio:1111111111:7",
      "  at:              2026-09-01T00:00:00.000Z",
      "  process:         exit none, signal SIGTERM, killed at the ceiling, after 30.0m",
      "  cause:",
      "    | the HARNESS stopped the walk at its 30-min ceiling",
      CLOSING_PARAGRAPH,
    ].join("\n"),
  );
});

// ---------------------------------------------------------------------------
// THE FENCES — why a harness end can never be mistaken for a product verdict
// ---------------------------------------------------------------------------

test("FENCE 1: the harness stream is not events.uat_drive, so the witness selector cannot see it", () => {
  assert.equal(UAT_HARNESS_END_TABLE, "events.uat_harness_end");
  assert.ok(!HARNESS_END_SELECT.includes("events.uat_drive"));
  assert.ok(!harnessEndInsert(harnessEndRecord(LAUNCH_FAILURE)).text.includes("events.uat_drive"));
});

test("FENCE 2: the record has NOWHERE to put an outcome — an outcome-bearing doc is refused", () => {
  const withOutcome = { ...harnessEndRecord(LAUNCH_FAILURE), outcome: "pass" };
  assert.equal(UatHarnessEndRecord.safeParse(withOutcome).success, false);
  const withAnythingElse = { ...harnessEndRecord(LAUNCH_FAILURE), verdict: "signed" };
  assert.equal(UatHarnessEndRecord.safeParse(withAnythingElse).success, false);
});

test("FENCE 3: the class discriminant travels with the row, and no other value parses", () => {
  const record = harnessEndRecord(LAUNCH_FAILURE);
  assert.equal(record.evidenceClass, UAT_HARNESS_END_EVIDENCE_CLASS);
  assert.equal(record.evidenceClass, "harness-end");
  assert.equal(
    UatHarnessEndRecord.safeParse({ ...record, evidenceClass: "drive-record" }).success,
    false,
  );
});

test("FENCE 4: the two record shapes refuse each other, in BOTH directions", () => {
  const harness = harnessEndRecord(LAUNCH_FAILURE);
  assert.equal(UatDriveRecord.safeParse(harness).success, false);

  const drive = UatDriveRecord.parse({
    storyId: "embedded-terminal",
    criterionId: "uatc_4a73475c396b1635baf9f5d1",
    revisionId: "rev-91ab",
    outcome: "pass",
    commitSha: "9a8b7c6d5e",
    runId: "uat-drive:embedded-terminal:9a8b7c6d5e:41236",
    driver: "codex-chatgpt-subscription",
    summary: "walked the journey end to end",
    at: "2026-08-24T02:14:09.000Z",
  });
  assert.equal(UatHarnessEndRecord.safeParse(drive).success, false);
});

test("FENCE 5: selectWitnessableDrive takes no harness input at all — a refusal witnesses nothing", () => {
  const result = selectWitnessableDrive(
    [],
    { criterionId: "uatc_4a73475c396b1635baf9f5d1", revisionId: "rev-91ab", freshnessDays: 90 },
    { ancestorOfHead: () => true, now: () => new Date("2026-08-24T03:00:00.000Z") },
  );
  assert.equal(result.ok, false);
});

// ---------------------------------------------------------------------------
// Minting and persisting
// ---------------------------------------------------------------------------

test("harnessEndRecord leaves an unknown field ABSENT rather than present-and-undefined", () => {
  const record = harnessEndRecord(NOTHING_KNOWN);
  assert.ok(!("provider" in record));
  assert.ok(!("driver" in record));
  assert.ok(!("model" in record));
  assert.ok(!("process" in record));
  assert.deepEqual(Object.keys(record), [
    "evidenceClass",
    "storyId",
    "criterionId",
    "revisionId",
    "runId",
    "commitSha",
    "phase",
    "host",
    "detail",
    "at",
  ]);
});

test("harnessEndInsert: the writer's columns and values, pinned so the reader cannot drift from them", () => {
  const insert = harnessEndInsert(harnessEndRecord(NOTHING_KNOWN));
  assert.equal(
    insert.text,
    "INSERT INTO events.uat_harness_end " +
      "(story_id, criterion_id, revision_id, run_id, phase, host, driver, commit_sha, doc) " +
      "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)",
  );
  assert.deepEqual(insert.values.slice(0, 8), [
    "studio",
    "uatc_deadbeef",
    "rev-0001",
    "uat-drive:studio:1111111111:7",
    "runtime-refused",
    "box-2",
    // NULL, not "": the commonest refusal happens before a runtime is verified, and an empty string
    // would read as a driver whose name nobody wrote down.
    null,
    "1111111111",
  ]);
  assert.deepEqual(JSON.parse(String(insert.values[8])), harnessEndRecord(NOTHING_KNOWN));
});

test("harnessEndInsert carries the verified driver when there was one", () => {
  const insert = harnessEndInsert(harnessEndRecord(LAUNCH_FAILURE));
  assert.equal(insert.values[6], "codex-chatgpt-subscription");
});

test("HARNESS_END_SELECT reads the doc back in insertion order", () => {
  assert.equal(
    HARNESS_END_SELECT,
    "SELECT doc FROM events.uat_harness_end WHERE criterion_id = $1 ORDER BY seq",
  );
});

test("a written record round-trips through the doc column unchanged", () => {
  const record = harnessEndRecord(LAUNCH_FAILURE);
  const readback = parseHarnessEnds([JSON.parse(String(harnessEndInsert(record).values[8]))]);
  assert.equal(readback.unreadable, 0);
  assert.deepEqual(readback.records, [record]);
});

// ---------------------------------------------------------------------------
// The bounded diagnostic
// ---------------------------------------------------------------------------

test("boundHarnessDetail keeps a short cause verbatim and strips terminal colour", () => {
  assert.equal(boundHarnessDetail("  plain cause  "), "plain cause");
  assert.equal(boundHarnessDetail("[31mred cause[39m"), "red cause");
  assert.equal(boundHarnessDetail("a\r\nb"), "a\nb");
});

test("boundHarnessDetail says so when there was no output, rather than storing an empty field", () => {
  assert.equal(boundHarnessDetail(""), "(the drive produced no output at all)");
  assert.equal(boundHarnessDetail("   \n  "), "(the drive produced no output at all)");
});

test("boundHarnessDetail: a cause EXACTLY at the bound is kept whole, one character over is not", () => {
  const exact = "z".repeat(HARNESS_END_DETAIL_CHARS);
  assert.equal(boundHarnessDetail(exact), exact);
  const oneOver = "z".repeat(HARNESS_END_DETAIL_CHARS + 1);
  assert.equal(
    boundHarnessDetail(oneOver),
    `…[1 earlier character(s) dropped — this is the TAIL of the output]…\n${exact}`,
  );
});

test("boundHarnessDetail keeps the TAIL and ANNOUNCES the truncation", () => {
  const bounded = boundHarnessDetail(`${"x".repeat(HARNESS_END_DETAIL_CHARS + 14)}TAIL-IS-THE-CAUSE`);
  assert.ok(bounded.startsWith("…[31 earlier character(s) dropped — this is the TAIL of the output]…\n"));
  assert.ok(bounded.endsWith("TAIL-IS-THE-CAUSE"));
  assert.equal(bounded.split("\n")[1]?.length, HARNESS_END_DETAIL_CHARS);
});

test("a long cause is bounded by the time it reaches the record, not by the caller remembering", () => {
  const record = harnessEndRecord({ ...NOTHING_KNOWN, detail: "y".repeat(HARNESS_END_DETAIL_CHARS * 3) });
  assert.ok(record.detail.includes("earlier character(s) dropped"));
  assert.ok(record.detail.length < HARNESS_END_DETAIL_CHARS * 3);
});

// ---------------------------------------------------------------------------
// Readback, fail-loud on the count
// ---------------------------------------------------------------------------

test("parseHarnessEnds counts a doc it cannot read instead of dropping it silently", () => {
  const readback = parseHarnessEnds([harnessEndRecord(LAUNCH_FAILURE), { nope: 1 }, null]);
  assert.equal(readback.records.length, 1);
  assert.equal(readback.unreadable, 2);
});

test("an ABSENT harness-end table is a complete answer, and anything else is a read failure", () => {
  // 42P01 = undefined_table. A drive applies the schema before it writes, so no table means nothing
  // has ever been recorded here — which is what makes "never attempted" true rather than guessed.
  assert.equal(isMissingHarnessEndTable({ code: "42P01" }), true);
  assert.equal(isMissingHarnessEndTable({ code: "42501" }), false);
  assert.equal(isMissingHarnessEndTable({ code: 42_101 }), false);
  assert.equal(isMissingHarnessEndTable(new Error("relation does not exist")), false);
  assert.equal(isMissingHarnessEndTable(null), false);
  assert.equal(isMissingHarnessEndTable(undefined), false);
  assert.equal(isMissingHarnessEndTable("42P01"), false);
});

// ---------------------------------------------------------------------------
// THE DISCRIMINATOR — the question an absent record used to answer twice
// ---------------------------------------------------------------------------

test("classifyDriveAttempt: NEVER ATTEMPTED, when no drive and no refusal was ever recorded", () => {
  const history = classifyDriveAttempt({
    criterionId: "uatc_deadbeef",
    driveRecordCount: 0,
    harnessEnds: { records: [], unreadable: 0 },
  });
  assert.equal(history.kind, "never-attempted");
  assert.deepEqual(history.lines, [
    "ATTEMPT HISTORY: NEVER ATTEMPTED — no drive record and no harness end has ever been recorded",
    "for uatc_deadbeef on any box. This leg is unproven because nobody has driven it yet, not",
    "because something refused them.",
  ]);
});

test("classifyDriveAttempt: ATTEMPTED AND REFUSED, with the most recent cause attached", () => {
  const history = classifyDriveAttempt({
    criterionId: "uatc_4a73475c396b1635baf9f5d1",
    driveRecordCount: 0,
    harnessEnds: { records: [harnessEndRecord(LAUNCH_FAILURE)], unreadable: 0 },
  });
  assert.equal(history.kind, "harness-refused");
  assert.deepEqual(history.lines.slice(0, 4), [
    "ATTEMPT HISTORY: ATTEMPTED AND REFUSED — 1 harness end(s) recorded for uatc_4a73475c396b1635baf9f5d1,",
    "and no product report at all. The machinery stopped before any journey could be observed, so",
    "this leg's redness is a BROKEN BOX, not a finding about the product.",
    "The most recent end:",
  ]);
  assert.equal(
    history.lines.slice(4).join("\n"),
    renderHarnessEnd(harnessEndRecord(LAUNCH_FAILURE))
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n"),
  );
});

test("classifyDriveAttempt: the MOST RECENT end is attached wherever it sits in the list", () => {
  // The newest is deliberately NEITHER first NOR last: a fold that simply keeps whichever row it
  // saw last would pick `middle` here, and a fold that never advances would pick `newest` by luck.
  const at = (day: string, host: string) =>
    harnessEndRecord({ ...LAUNCH_FAILURE, at: `2026-08-${day}T00:00:00.000Z`, host });
  const history = classifyDriveAttempt({
    criterionId: LAUNCH_FAILURE.criterionId,
    driveRecordCount: 0,
    harnessEnds: { records: [at("20", "oldest-box"), at("24", "newest-box"), at("22", "middle-box")], unreadable: 0 },
  });
  const rendered = history.lines.join("\n");
  assert.ok(rendered.includes("on newest-box"));
  assert.ok(!rendered.includes("on middle-box"));
  assert.ok(!rendered.includes("on oldest-box"));
});

test("classifyDriveAttempt: two ends stamped at the SAME instant fall back to insertion order", () => {
  // HARNESS_END_SELECT reads `ORDER BY seq`, so a later row IS later even when the clock did not
  // move. Deciding a tie by the fold's direction instead would be an accident, not an answer.
  const same = (host: string) =>
    harnessEndRecord({ ...LAUNCH_FAILURE, at: "2026-08-24T02:14:09.000Z", host });
  const history = classifyDriveAttempt({
    criterionId: LAUNCH_FAILURE.criterionId,
    driveRecordCount: 0,
    harnessEnds: { records: [same("written-first"), same("written-second")], unreadable: 0 },
  });
  const rendered = history.lines.join("\n");
  assert.ok(rendered.includes("on written-second"));
  assert.ok(!rendered.includes("on written-first"));
});

test("classifyDriveAttempt: an UNREADABLE row is still an attempt, and never reads as never-attempted", () => {
  const history = classifyDriveAttempt({
    criterionId: "uatc_deadbeef",
    driveRecordCount: 0,
    harnessEnds: parseHarnessEnds([{ nope: 1 }]),
  });
  assert.equal(history.kind, "harness-refused");
  assert.deepEqual(history.lines, [
    "ATTEMPT HISTORY: ATTEMPTED AND REFUSED — 1 harness end(s) recorded for uatc_deadbeef,",
    "and no product report at all. The machinery stopped before any journey could be observed, so",
    "this leg's redness is a BROKEN BOX, not a finding about the product.",
    "  ⚠ 1 harness-end row(s) for this criterion could NOT be read by this schema. They are attempts" +
      ' all the same — do not read this as "never attempted".',
  ]);
});

test("classifyDriveAttempt: a PRODUCT REPORT outranks a harness end — the journey WAS walked", () => {
  const history = classifyDriveAttempt({
    criterionId: "uatc_deadbeef",
    driveRecordCount: 3,
    harnessEnds: { records: [harnessEndRecord(LAUNCH_FAILURE)], unreadable: 0 },
  });
  assert.equal(history.kind, "reported");
  assert.deepEqual(history.lines, [
    "ATTEMPT HISTORY: 3 drive record(s) exist for uatc_deadbeef — the journey WAS",
    "walked and reported on. The reasons above say why none of them witnesses the leg right now.",
  ]);
});

test("classifyDriveAttempt: a product report still names unreadable harness rows beside it", () => {
  const history = classifyDriveAttempt({
    criterionId: "uatc_deadbeef",
    driveRecordCount: 1,
    harnessEnds: parseHarnessEnds([{ nope: 1 }, { nope: 2 }]),
  });
  assert.equal(history.kind, "reported");
  assert.equal(history.lines.length, 3);
  assert.ok(history.lines[2]?.includes("2 harness-end row(s)"));
});

// ---------------------------------------------------------------------------
// THE REGRESSION THIS INCREMENT EXISTS FOR — the 2026-08-24 invalid-model launch
// ---------------------------------------------------------------------------

test("REGRESSION: an invalid-model launch is recorded, and the next box is told it was ATTEMPTED", () => {
  // 1. The runner classifies the end exactly as it did on the day: 0.4m, no readable report, not
  //    timed out — a session that never got going.
  const end = classifyDriveEnd({
    timedOut: false,
    reportReadable: false,
    ceilingMinutes: 60,
    elapsedMinutes: 0.4,
  });
  assert.equal(end.kind, "no-start");
  assert.equal(end.harness, true);

  // 2. That end now MINTS a record instead of dying in the session's scrollback.
  const phase = harnessEndPhaseForDriveEnd(end.kind);
  assert.equal(phase, "launch-failed");
  const record = harnessEndRecord({
    ...LAUNCH_FAILURE,
    phase: phase ?? "launch-failed",
    detail: `${end.reason}\n\n${INVALID_MODEL_ERROR}`,
  });

  // 3. The cause — the thing fifteen minutes of source reading recovered last time — is IN the row.
  assert.ok(record.detail.includes("not supported when using Codex with a ChatGPT account"));
  assert.ok(record.detail.includes("SHORTENING THE JOURNEY WOULD NOT HELP"));
  assert.equal(record.model, "gpt-5.6-sol");
  assert.equal(record.host, "MicksMSpro");

  // 4. And the witness surface no longer answers "never attempted" — which is the whole unit.
  const history = classifyDriveAttempt({
    criterionId: record.criterionId,
    driveRecordCount: 0,
    harnessEnds: { records: [record], unreadable: 0 },
  });
  assert.equal(history.kind, "harness-refused");
  assert.notEqual(history.kind, "never-attempted");
  assert.ok(history.lines.join("\n").includes("not a finding about the product"));

  // 5. And it is STILL not a verdict: nothing about it parses as a product record.
  assert.equal(UatDriveRecord.safeParse(record).success, false);
});
