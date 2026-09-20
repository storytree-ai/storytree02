import { test } from "node:test";
import assert from "node:assert/strict";
import * as fsp from "node:fs/promises";
import { existsSync } from "node:fs";
import * as os from "node:os";
import path from "node:path";

import { InMemoryStore } from "@storytree/storage-protocol";
import { INNER_LOOP_EVENT_KIND } from "@storytree/proof-protocol";
import type { InnerLoopEventDoc } from "@storytree/proof-protocol";
import type { StoreEvent } from "@storytree/storage-protocol";
import { ShellTestExecutor, foldInnerLoopLedger, innerLoopEventId, proveUnit } from "@storytree/orchestrator";
import type { ProveResult, ProveSpec } from "@storytree/orchestrator";
import { parseAuthoringEscalation } from "@storytree/agent";
import type { AuthorResult, AuthoringPhase, PhaseAuthor } from "@storytree/agent";

import {
  attemptRecordPath,
  defaultAttemptsDir,
  readAttemptRecord,
  renderAttemptRecord,
  renderPriorAttemptLine,
  resolveAttemptReport,
  resolveAttemptsDir,
  writeAttemptRecord,
} from "./node-build.js";

/**
 * ADR-0586 D2/D3/D6/D7: a failed REAL build records what the SPINE observed under `~/.storytree/
 * attempts/<unit>/<run>.json`, the next build of the same unit reads exactly the run the LEDGER
 * names, and an escalation's claim never reaches the file at all.
 *
 * Every `ProveResult` below is PRODUCTION output — a real `proveUnit` walk over a real
 * `ShellTestExecutor` whose spawned child decides red/green by its own exit code — never a
 * hand-built literal (the ground rule `node-build-revision-record.test.ts` set for this family).
 */

const UNIT_ID = "node-build-attempt-record-unit-fixture";
const ESCALATION_STATEMENT = "ESCALATION-CLAIM-MARKER-7c1e9b: this contract cannot be tested at all";

/** A leaf double: returns a scripted {@link AuthorResult} per phase (default `{ ok: true }`). */
function scriptedAuthor(results: Partial<Record<AuthoringPhase, AuthorResult>>): PhaseAuthor {
  return {
    async author(phase: AuthoringPhase): Promise<AuthorResult> {
      return results[phase] ?? { ok: true };
    },
  };
}

/**
 * Drive ONE real `proveUnit` walk over a real `ShellTestExecutor`: the spawned child decides its own
 * exit code per invocation (tracked in a counter file, since each call is its own OS process) and
 * writes distinct markers so a captured observation can be attributed.
 */
async function driveWalk(config: {
  runId: string;
  exitCodes: number[];
  author?: PhaseAuthor;
}): Promise<ProveResult> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "node-build-attempt-record-walk-"));
  const counterFile = path.join(dir, "counter.txt");
  await fsp.writeFile(counterFile, "0", "utf8");
  const script = [
    "const fs = require('fs');",
    `const counterFile = ${JSON.stringify(counterFile)};`,
    "let n = 0;",
    "try { n = parseInt(fs.readFileSync(counterFile, 'utf8'), 10) || 0; } catch (e) {}",
    "fs.writeFileSync(counterFile, String(n + 1));",
    "console.log('STDOUT-MARKER-7c1e9b:' + n);",
    "process.stderr.write('STDERR-MARKER-7c1e9b:' + n);",
    `const codes = ${JSON.stringify(config.exitCodes)};`,
    "process.exit(codes[n] === undefined ? 1 : codes[n]);",
  ].join(" ");
  const spec: ProveSpec = {
    unitId: UNIT_ID,
    proofMode: "contract",
    testId: `${UNIT_ID}-test`,
    author: config.author ?? scriptedAuthor({}),
    testExecutor: new ShellTestExecutor({
      command: () => ({ file: process.execPath, args: ["-e", script] }),
    }),
    store: new InMemoryStore(),
    signerInputs: { flag: "tester@example.com" },
    treeState: async () => ({ commitSha: "attempt-record-fixture-tree", clean: true }),
    now: () => "2026-09-21T00:00:00.000Z",
    prompts: { authorTest: "author the failing test", implement: "implement against it" },
    runId: config.runId,
  };
  return proveUnit(spec);
}

/** A fresh empty directory this test owns. */
function tmpDir(): Promise<string> {
  return fsp.mkdtemp(path.join(os.tmpdir(), "node-build-attempt-record-"));
}

// ── where the records live ──────────────────────────────────────────────────────────────────────

test("the records live in the house per-user directory, one file per unit and run", () => {
  assert.equal(defaultAttemptsDir(), path.join(os.homedir(), ".storytree", "attempts"));
  // A SIBLING of the escalation family, never the same directory: the two are different objects.
  assert.notEqual(defaultAttemptsDir(), path.join(os.homedir(), ".storytree", "escalations"));
  assert.equal(resolveAttemptsDir("/somewhere"), "/somewhere");
  assert.equal(resolveAttemptsDir(undefined), defaultAttemptsDir());
  assert.equal(attemptRecordPath("/d", "unit", "run"), path.join("/d", "unit", "run.json"));
});

// ── what a failed walk leaves behind (D3) ───────────────────────────────────────────────────────

test("an-ordinary-failure-is-recorded: a red CONFIRM_GREEN records its phase, reason and output", async () => {
  const dir = await tmpDir();
  // red at CONFIRM_RED (exit 1), still red at CONFIRM_GREEN (exit 1) — the ORDINARY failure, and the
  // one ADR-0571 D2's escalation record never covers.
  const result = await driveWalk({ runId: "run-ordinary", exitCodes: [1, 1] });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.failedAt, "CONFIRM_GREEN");

  const write = await writeAttemptRecord(dir, UNIT_ID, "run-ordinary", result);

  assert.deepEqual(write, { written: true, path: attemptRecordPath(dir, UNIT_ID, "run-ordinary") });
  const read = readAttemptRecord(dir, UNIT_ID, "run-ordinary");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.record.unitId, UNIT_ID);
  assert.equal(read.record.runId, "run-ordinary");
  assert.equal(read.record.failedAt, "CONFIRM_GREEN");
  assert.equal(read.record.escalationReturned, false);
  assert.equal(read.record.reason, !result.ok ? result.reason : undefined);
  assert.match(read.record.observation?.stdout ?? "", /STDOUT-MARKER-7c1e9b/);
  assert.match(read.record.observation?.stderr ?? "", /STDERR-MARKER-7c1e9b/);
  assert.equal(read.record.observation?.exitCode, 1);
});

test("a SIGNED walk records nothing and creates no directory — a pass is not the state this exists for", async () => {
  const dir = await tmpDir();
  const nested = path.join(dir, "never-made");
  const result = await driveWalk({ runId: "run-signed", exitCodes: [1, 0] });
  assert.equal(result.ok, true);

  assert.equal(await writeAttemptRecord(nested, UNIT_ID, "run-signed", result), null);
  assert.equal(existsSync(nested), false);
});

test("no directory means no record and no filesystem touch at all", async () => {
  const result = await driveWalk({ runId: "run-nodir", exitCodes: [1, 1] });

  assert.equal(await writeAttemptRecord(undefined, UNIT_ID, "run-nodir", result), null);
});

test("a write that cannot land is reported, never thrown — the build is not this record's business", async () => {
  const dir = await tmpDir();
  // The unit directory's own path is occupied by a FILE, so mkdir fails.
  await fsp.writeFile(path.join(dir, UNIT_ID), "in the way", "utf8");
  const result = await driveWalk({ runId: "run-blocked", exitCodes: [1, 1] });

  const write = await writeAttemptRecord(dir, UNIT_ID, "run-blocked", result);

  assert.equal(write?.written, false);
  assert.equal(write?.path, attemptRecordPath(dir, UNIT_ID, "run-blocked"));
  assert.equal(typeof (write !== null && !write.written ? write.reason : undefined), "string");
});

// ── the D6 fence, at the only place it can be proven: the bytes ─────────────────────────────────

test("an-escalations-claim-never-reaches-the-record: an escalating failure stores the FACT, not the text", async () => {
  const dir = await tmpDir();
  const rebuilt = parseAuthoringEscalation("AUTHOR_TEST", { statement: ESCALATION_STATEMENT });
  assert.equal(rebuilt.ok, true, "ground truth: a non-blank statement is an admissible escalation");
  if (!rebuilt.ok) return;
  const result = await driveWalk({
    runId: "run-escalated",
    exitCodes: [1, 1],
    author: scriptedAuthor({
      AUTHOR_TEST: { ok: false, error: "escalating", escalation: rebuilt.escalation },
    }),
  });
  assert.equal(result.ok, false);
  assert.notEqual(!result.ok ? result.escalation : undefined, undefined, "the walk returned one");
  // Ground truth for the fence: the gate DOES quote the claim verbatim in the refusal reason
  // (ADR-0569 D4), which is exactly why the reason may not be stored.
  assert.match(!result.ok ? result.reason : "", new RegExp(ESCALATION_STATEMENT));

  await writeAttemptRecord(dir, UNIT_ID, "run-escalated", result);

  const raw = await fsp.readFile(attemptRecordPath(dir, UNIT_ID, "run-escalated"), "utf8");
  assert.equal(
    raw.includes("ESCALATION-CLAIM-MARKER-7c1e9b"),
    false,
    "not one byte of the escalation's claim may reach a file the next build reads automatically",
  );
  const read = readAttemptRecord(dir, UNIT_ID, "run-escalated");
  assert.equal(read.ok, true);
  assert.equal(read.ok && read.record.escalationReturned, true);
  assert.equal(read.ok && read.record.reason, undefined);
});

// ── reading one back (D7) ───────────────────────────────────────────────────────────────────────

test("every unreadable record is refused by name, and none of them throws", async () => {
  const dir = await tmpDir();
  const missing = readAttemptRecord(dir, UNIT_ID, "never-written");
  assert.equal(missing.ok, false);
  assert.match(!missing.ok ? missing.reason : "", /no attempt record found at/);

  // A runId is one path segment, checked BEFORE the filesystem is touched — which is what keeps this
  // from ever naming an arbitrary file.
  for (const bad of ["..", ".", "", "a/b", "a\\b"]) {
    const refused = readAttemptRecord(dir, UNIT_ID, bad);
    assert.equal(refused.ok, false, `expected a refusal for runId ${JSON.stringify(bad)}`);
    assert.match(!refused.ok ? refused.reason : "", /single path segment/);
  }

  await fsp.mkdir(path.join(dir, UNIT_ID), { recursive: true });
  await fsp.writeFile(attemptRecordPath(dir, UNIT_ID, "bad-json"), "{not json", "utf8");
  const broken = readAttemptRecord(dir, UNIT_ID, "bad-json");
  assert.equal(broken.ok, false);
  assert.match(!broken.ok ? broken.reason : "", /is not valid JSON/);

  await fsp.writeFile(
    attemptRecordPath(dir, UNIT_ID, "wrong-unit"),
    JSON.stringify({ unitId: "someone-else", runId: "wrong-unit", failedAt: "GATE", escalationReturned: false }),
    "utf8",
  );
  const mismatched = readAttemptRecord(dir, UNIT_ID, "wrong-unit");
  assert.equal(mismatched.ok, false);
  assert.match(!mismatched.ok ? mismatched.reason : "", /does not match the expected unitId/);
});

// ── choosing which attempt to report on (D5) ────────────────────────────────────────────────────

const stored = (doc: InnerLoopEventDoc, seq: number): StoreEvent => ({
  seq,
  id: innerLoopEventId(doc),
  kind: INNER_LOOP_EVENT_KIND,
  type: "created",
  doc,
  actor: "test",
  at: `2026-09-21T00:00:${String(seq).padStart(2, "0")}.000Z`,
});
const ledgerOf = (...docs: InnerLoopEventDoc[]) =>
  foldInnerLoopLedger(docs.map((doc, i) => stored(doc, i + 1)), UNIT_ID);
const attemptDoc = (runId: string): InnerLoopEventDoc => ({
  event: "attempt",
  unitId: UNIT_ID,
  incrementId: "the-increment",
  runId,
});

test("a-retry-reads-the-run-the-ledger-names: the report pairs the fold's latest failed attempt with this machine's record", async () => {
  const dir = await tmpDir();
  const result = await driveWalk({ runId: "run-second", exitCodes: [1, 1] });
  await writeAttemptRecord(dir, UNIT_ID, "run-second", result);
  // A record for an OLDER run is on disk too, and must not be the one chosen: the ledger decides.
  const older = await driveWalk({ runId: "run-first", exitCodes: [1, 1] });
  await writeAttemptRecord(dir, UNIT_ID, "run-first", older);

  const report = resolveAttemptReport(
    dir,
    UNIT_ID,
    ledgerOf(attemptDoc("run-first"), attemptDoc("run-second")),
  );

  assert.equal(report?.runId, "run-second");
  assert.equal(report?.incrementId, "the-increment");
  assert.equal(report?.observed?.failedAt, "CONFIRM_GREEN");
  assert.match(report?.observed?.observation?.stdout ?? "", /STDOUT-MARKER-7c1e9b/);
});

test("a missing record drops the observed half and NOTHING else — the ledger facts still travel", async () => {
  const dir = await tmpDir();

  const report = resolveAttemptReport(
    dir,
    UNIT_ID,
    ledgerOf(
      attemptDoc("r1"),
      attemptDoc("r2"),
      attemptDoc("r3"),
      {
        event: "grant",
        unitId: UNIT_ID,
        incrementId: "the-increment",
        runId: "r3",
        attempts: 2,
        kind: "fixed-defect",
        difference: "DIFFERENCE-MARKER-7c1e9b",
      },
    ),
  );

  assert.equal(report?.runId, "r3");
  assert.equal(report?.observed, undefined);
  // The orchestrator's recorded difference is a LEDGER fact, so it reaches a machine that holds no
  // record — which is the whole reason it is not copied into the file.
  assert.deepEqual(report?.grant, { kind: "fixed-defect", difference: "DIFFERENCE-MARKER-7c1e9b" });
});

test("nothing is reported when the last attempt signed, or when there is no ledger at all", async () => {
  const dir = await tmpDir();

  assert.equal(resolveAttemptReport(dir, UNIT_ID, undefined), undefined);
  assert.equal(
    resolveAttemptReport(
      dir,
      UNIT_ID,
      ledgerOf(attemptDoc("r1"), {
        event: "signed-pass",
        unitId: UNIT_ID,
        incrementId: "the-increment",
        runId: "r1",
      }),
    ),
    undefined,
  );
});

// ── what the operator is told ───────────────────────────────────────────────────────────────────

test("the envelope names what was recorded, and what the workers were told", () => {
  assert.deepEqual(renderAttemptRecord(undefined), []);
  assert.match(
    renderAttemptRecord({ written: true, path: "/d/u/r.json" })[0] ?? "",
    /recorded to \/d\/u\/r\.json/,
  );
  assert.match(
    renderAttemptRecord({ written: false, path: "/d/u/r.json", reason: "disk full" })[0] ?? "",
    /NOT recorded .* disk full/,
  );

  assert.deepEqual(renderPriorAttemptLine(undefined), []);
  const full = renderPriorAttemptLine({
    runId: "run-x",
    incrementId: "inc-y",
    observed: { failedAt: "GATE", escalationReturned: false },
    grant: { kind: "new-observation", difference: "d" },
  })[0];
  assert.match(full ?? "", /run-x/);
  assert.match(full ?? "", /inc-y/);
  assert.match(full ?? "", /stopped at GATE/);
  assert.match(full ?? "", /new-observation/);
  assert.match(
    renderPriorAttemptLine({ runId: "run-x", incrementId: "inc-y" })[0] ?? "",
    /no local record/,
  );
});
