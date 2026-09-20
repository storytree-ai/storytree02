import { test } from "node:test";
import assert from "node:assert/strict";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { loadNodeSpec } from "./node-spec.js";
import { realPrompts, realProofCommand } from "./resolve-prove-spec.js";
import type { AttemptReport } from "./proof/attempt-report.js";
import type { RealProofConfig } from "./proof-config.js";

/**
 * ADR-0586 D1/D4/D6: a REAL build of a unit whose last recorded attempt FAILED briefs BOTH workers
 * with what the spine observed in it and the difference the orchestrator recorded — and names a
 * returned escalation without ever rendering one.
 *
 * Every assertion below is on the BRIEF'S CONTENT: at HEAD `realPrompts` takes five arguments and
 * silently ignores a sixth, and `AttemptReport` is `import type` only (erased by the tsx loader), so
 * nothing here fails on a missing symbol.
 */

/** repo root: packages/orchestrator/src → four dirs up. */
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");
const STORIES_DIR = path.join(REPO_ROOT, "stories");

/** A REAL node spec this file reuses for every case — contract-tier, so it declares no contracts. */
function verdictLineSpec() {
  return loadNodeSpec(path.join(STORIES_DIR, "drive-machinery", "verdict-line.md"));
}

const ARMS_BASE: RealProofConfig = {
  testFile: "packages/cli/src/tree.test.ts",
  sourceFile: "packages/cli/src/tree.ts",
  scope: {
    testGlobs: ["packages/cli/src/tree.test.ts"],
    sourceGlobs: ["packages/cli/src/tree.ts"],
  },
};
const ARMS_SUITE = { file: "pnpm", args: ["--filter", "@storytree/cli", "test"] };
const ARMS: ReadonlyArray<{ arm: string; real: RealProofConfig }> = [
  { arm: "net-new", real: ARMS_BASE },
  { arm: "editsExisting", real: { ...ARMS_BASE, editsExisting: true, proofCommand: ARMS_SUITE } },
  { arm: "refactorForTests", real: { ...ARMS_BASE, refactorForTests: true, proofCommand: ARMS_SUITE } },
];
const RUNTIMES = ["claude", "codex"] as const;

const REPORT: AttemptReport = {
  runId: "real-priorzzq",
  incrementId: "an-increment-marker-zzq",
  observed: {
    failedAt: "CONFIRM_GREEN",
    escalationReturned: false,
    reason: "reason-marker-zzq: the implementation did not make the test pass",
    observation: {
      stdout: "stdout-marker-zzq\n1 failing",
      stderr: "stderr-marker-zzq",
      exitCode: 1,
    },
  },
  grant: { kind: "fixed-defect", difference: "difference-marker-zzq: the parser keeps its newline" },
};

test("real-brief-carries-the-last-failed-attempt — BOTH briefs gain the report, and each report-free brief stays their exact prefix, in every REAL arm and runtime", () => {
  for (const { arm, real } of ARMS) {
    for (const runtime of RUNTIMES) {
      const display = realProofCommand(real, "/ws").display;
      const spec = verdictLineSpec();
      const baseline = realPrompts(spec, real, display, runtime);
      // Parity: a call carrying no report must stay untouched — today's briefs, unmodified.
      assert.doesNotMatch(baseline.authorTest, /ADR-0586|last recorded attempt/, `${arm}/${runtime}`);
      assert.doesNotMatch(baseline.implement, /ADR-0586|last recorded attempt/, `${arm}/${runtime}`);

      const briefed = realPrompts(spec, real, display, runtime, undefined, REPORT);

      assert.ok(
        briefed.authorTest.startsWith(baseline.authorTest),
        `${arm}/${runtime}: today's whole AUTHOR_TEST brief must be the exact prefix of the briefed one`,
      );
      assert.ok(
        briefed.implement.startsWith(baseline.implement),
        `${arm}/${runtime}: today's whole IMPLEMENT brief must be the exact prefix of the briefed one`,
      );

      // ADR-0586 D4: unlike a test revision, the SAME report reaches both workers — the implementer
      // is the one who most needs to know that CONFIRM_GREEN went red on the last attempt.
      const redSection = briefed.authorTest.slice(baseline.authorTest.length);
      const greenSection = briefed.implement.slice(baseline.implement.length);
      assert.equal(redSection, greenSection, `${arm}/${runtime}: both briefs carry the same report`);

      for (const [phase, section] of [
        ["AUTHOR_TEST", redSection],
        ["IMPLEMENT", greenSection],
      ] as const) {
        const where = `${arm}/${runtime}/${phase}`;
        assert.match(section, /real-priorzzq/, `${where}: names the run it describes`);
        assert.match(section, /an-increment-marker-zzq/, `${where}: names the increment it was filed under`);
        assert.match(section, /CONFIRM_GREEN/, `${where}: names the phase it stopped at`);
        assert.match(section, /reason-marker-zzq/, `${where}: carries the refusal reason`);
        assert.match(section, /stdout-marker-zzq/, `${where}: carries the observed stdout`);
        assert.match(section, /stderr-marker-zzq/, `${where}: carries the observed stderr`);
        assert.match(section, /difference-marker-zzq/, `${where}: carries the recorded difference`);
        assert.match(section, /fixed-defect/, `${where}: names the grant kind`);
        // D1: a REPORT, not a directive — it must say so rather than leaving the worker to infer it.
        assert.match(section, /REPORT/, `${where}: frames itself as a report`);
      }
    }
  }
});

test("a report with no local record still carries the ledger facts, and says what is missing", () => {
  const real = ARMS_BASE;
  const spec = verdictLineSpec();
  const display = realProofCommand(real, "/ws").display;
  const baseline = realPrompts(spec, real, display, "claude");
  const briefed = realPrompts(spec, real, display, "claude", undefined, {
    runId: "real-elsewhere",
    incrementId: "an-increment-marker-zzq",
    grant: { kind: "changed-input", difference: "difference-marker-zzq" },
  });

  const section = briefed.authorTest.slice(baseline.authorTest.length);
  assert.match(section, /real-elsewhere/);
  assert.match(section, /an-increment-marker-zzq/);
  // The per-machine cost stated rather than silently dropped: the attempt is on the shared ledger.
  assert.match(section, /no local record/);
  assert.match(section, /difference-marker-zzq/, "the recorded difference is a LEDGER fact, so it survives");
  assert.equal(briefed.implement.slice(baseline.implement.length), section);
});

test("an-escalations-claim-never-reaches-a-brief: a returned escalation is NAMED and never rendered", () => {
  const real = ARMS_BASE;
  const spec = verdictLineSpec();
  const display = realProofCommand(real, "/ws").display;
  const baseline = realPrompts(spec, real, display, "claude");
  const briefed = realPrompts(spec, real, display, "claude", undefined, {
    runId: "real-escalated",
    incrementId: "an-increment-marker-zzq",
    observed: { failedAt: "AUTHOR_TEST", escalationReturned: true },
  });

  const section = briefed.authorTest.slice(baseline.authorTest.length);
  // D6: it says THAT one was returned and points at the explicit route that carries it...
  assert.match(section, /escalation/i);
  assert.match(section, /--revise-test real-escalated/);
  assert.match(section, new RegExp(`node build ${spec.id} --real`));
  // ...and stops there: no reason line, because the refusal reason quotes the escalation verbatim.
  assert.doesNotMatch(section, /Reason:/);
  assert.equal(briefed.implement.slice(baseline.implement.length), section);
});

test("a recorded failure with no reason and no output says so rather than fabricating either", () => {
  const real = ARMS_BASE;
  const spec = verdictLineSpec();
  const display = realProofCommand(real, "/ws").display;
  const baseline = realPrompts(spec, real, display, "claude");
  const briefed = realPrompts(spec, real, display, "claude", undefined, {
    runId: "real-bare",
    incrementId: "an-increment-marker-zzq",
    observed: { failedAt: "GATE", escalationReturned: false },
  });

  const section = briefed.authorTest.slice(baseline.authorTest.length);
  assert.match(section, /GATE/);
  assert.match(section, /No reason was recorded/);
  assert.match(section, /No output from that run was recorded/);
});

test("a huge observed stream is tail-kept, so one runaway run cannot crowd out the brief", () => {
  const real = ARMS_BASE;
  const spec = verdictLineSpec();
  const display = realProofCommand(real, "/ws").display;
  const baseline = realPrompts(spec, real, display, "claude");
  const head = "H".repeat(20_000);
  const briefed = realPrompts(spec, real, display, "claude", undefined, {
    runId: "real-loud",
    incrementId: "an-increment-marker-zzq",
    observed: {
      failedAt: "CONFIRM_GREEN",
      escalationReturned: false,
      reason: "reason-marker-zzq",
      observation: { stdout: `${head}TAIL-MARKER-ZZQ`, stderr: "", exitCode: 1 },
    },
  });

  const section = briefed.authorTest.slice(baseline.authorTest.length);
  assert.match(section, /TAIL-MARKER-ZZQ/, "the TAIL is what a reader needs");
  assert.doesNotMatch(section, new RegExp(head), "the head is dropped, not carried");
  assert.match(section, /omitted/, "and the brief says how much it dropped");
});
