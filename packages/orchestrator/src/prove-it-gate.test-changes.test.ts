import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { AuthoringPhase, PhaseAuthor } from "@storytree/agent";

import { RecordingTestExecutor } from "./phase-machine.js";
import type { TestObservation } from "./phase-machine.js";
import { proveUnit } from "./prove-it-gate.js";
import type { ProveSpec } from "./prove-it-gate.js";
import type { TestChangePolicy } from "./proof/per-test-review.js";
import type { TestChange, TestChangeRecord } from "./proof/test-baseline.js";
import type { RepairPolicy } from "./repair.js";

/**
 * `an-existing-test-change-is-recorded-with-its-reason` at the GATE (ADR-0585): the spine reads the
 * existing-test record at CONFIRM_RED — on every real build, whatever the proof route — carries it out
 * on the result for the envelope to print, and hands a change with NO stated reason back to the
 * test-writer through the repair loop rather than ending the build on it.
 */

const RED: TestObservation = { result: "red", testId: "T", originalProcessResult: { stdout: "red", stderr: "", exitCode: 1 } };
const GREEN: TestObservation = { result: "green", testId: "T", originalProcessResult: { stdout: "green", stderr: "", exitCode: 0 } };

const UNEXPLAINED: TestChange = { test: ["add-sums: two and three make five"], kind: "updated" };
const EXPLAINED: TestChange = {
  test: ["add-sums: two and three make five"],
  kind: "updated",
  reason: "add-sums: two and three make five — the sum now rounds",
  asserts: "new-behaviour",
};

class CountingAuthor implements PhaseAuthor {
  readonly calls: { phase: AuthoringPhase; prompt: string }[] = [];
  async author(phase: AuthoringPhase, prompt: string): Promise<{ ok: true }> {
    this.calls.push({ phase, prompt });
    return { ok: true };
  }
}

/** A record policy that returns the scripted reviews in order; the last repeats. */
function scriptedChanges(records: TestChangeRecord[], reads: { n: number }): TestChangePolicy {
  let taken = 0;
  return {
    beforeAuthorTest(): void {
      reads.n += 1;
    },
    review(): TestChangeRecord {
      const record = records[Math.min(taken, records.length - 1)] ?? { changes: [], findings: [] };
      taken += 1;
      return record;
    },
  };
}

/** A repair policy that always grants, never sets anything aside, and fingerprints nothing. */
const alwaysRepairs: RepairPolicy = {
  budget: { mayRepair: () => Promise.resolve({ ok: true }) },
  setAsideImplementation: () => Promise.resolve(() => Promise.resolve()),
  routeTypecheck: () => undefined,
};

function spec(args: {
  author: PhaseAuthor;
  observations: TestObservation[];
  testChanges?: TestChangePolicy;
  repair?: RepairPolicy;
}) {
  const store = new InMemoryStore();
  const s: ProveSpec = {
    unitId: "unit-1",
    proofMode: "contract",
    testId: "T",
    author: args.author,
    testExecutor: new RecordingTestExecutor(args.observations),
    store,
    signerInputs: { flag: "tester@example.com" },
    treeState: async () => ({ commitSha: "cafe", clean: true }),
    now: () => "2026-09-21T00:00:00.000Z",
    prompts: { authorTest: "author it", implement: "implement it" },
    runId: "run-1",
  };
  if (args.testChanges !== undefined) s.testChanges = args.testChanges;
  if (args.repair !== undefined) s.repair = args.repair;
  return { spec: s, store };
}

describe("an-existing-test-change-is-recorded-with-its-reason: the gate records the change and hands a missing reason back", () => {
  test("a change with no stated reason goes to the test-writer, and the walk signs once the reason is there", async () => {
    const reads = { n: 0 };
    const author = new CountingAuthor();
    const { spec: s, store } = spec({
      author,
      repair: alwaysRepairs,
      testChanges: scriptedChanges(
        [
          { changes: [UNEXPLAINED], findings: [{ check: "C8", test: UNEXPLAINED.test, detail: "no stated reason", testSide: true }] },
          { changes: [EXPLAINED], findings: [] },
        ],
        reads,
      ),
      observations: [RED, RED, GREEN],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true, "a missing reason is repaired, never an end to the build");
    if (!result.ok) return;
    assert.deepEqual(author.calls.map((c) => c.phase), ["AUTHOR_TEST", "AUTHOR_TEST", "IMPLEMENT"]);
    assert.deepEqual(result.repairs?.map((r) => [r.failedAt, r.check, r.to]), [
      ["CONFIRM_RED", "test-changes", "AUTHOR_TEST"],
    ]);
    assert.equal(result.repairs?.[0]?.detail, "1 existing-test change(s) with no stated reason");
    // The repair brief carries the finding, without the orchestrator's early-pass routes.
    assert.match(author.calls[1]?.prompt ?? "", /C8 the existing-test record — `add-sums: two and three make five`: no stated reason/);
    // The record the walk carries out is the LAST one read — the one with its reason.
    assert.deepEqual(result.testChanges, [EXPLAINED]);
    assert.equal(reads.n, 1, "the file the build FOUND is read once, before the first slice");
    assert.equal((await store.readEvents()).filter((e) => e.kind === "signing").length, 1);
  });

  test("a change that states its reason is recorded and never interrupts the walk", async () => {
    const author = new CountingAuthor();
    const { spec: s } = spec({
      author,
      repair: alwaysRepairs,
      testChanges: scriptedChanges([{ changes: [EXPLAINED], findings: [] }], { n: 0 }),
      observations: [RED, GREEN],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.testChanges, [EXPLAINED]);
    assert.equal(result.repairs, undefined);
    assert.deepEqual(author.calls.map((c) => c.phase), ["AUTHOR_TEST", "IMPLEMENT"]);
  });

  test("with no repair policy the unexplained change still ends the walk on the check, carrying the record", async () => {
    const author = new CountingAuthor();
    const { spec: s, store } = spec({
      author,
      testChanges: scriptedChanges(
        [{ changes: [UNEXPLAINED], findings: [{ check: "C8", test: UNEXPLAINED.test, detail: "no stated reason", testSide: true }] }],
        { n: 0 },
      ),
      observations: [RED],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_RED");
    assert.match(result.reason, /CONFIRM_RED refused per test \(ADR-0573 D1\) — 1 finding\(s\)/);
    assert.deepEqual(result.perTestFindings?.map((f) => f.check), ["C8"]);
    assert.deepEqual(result.testChanges, [UNEXPLAINED]);
    assert.equal((await store.readEvents()).filter((e) => e.kind === "signing").length, 0);
  });

  test("a walk with no record policy carries none, and is otherwise exactly what it always was", async () => {
    const author = new CountingAuthor();
    const { spec: s } = spec({ author, observations: [RED, GREEN] });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.testChanges, undefined);
    assert.deepEqual(result.phasesVisited, ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "GATE"]);
  });
});
