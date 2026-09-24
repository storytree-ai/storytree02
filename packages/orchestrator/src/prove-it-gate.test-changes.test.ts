import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { AuthorResult, AuthoringPhase, AuthoringRepairAdmission, PhaseAuthor } from "@storytree/agent";

import { RecordingTestExecutor } from "./phase-machine.js";
import type { TestObservation } from "./phase-machine.js";
import { proveUnit } from "./prove-it-gate.js";
import type { OutsideTestPolicy, ProveSpec } from "./prove-it-gate.js";
import type { TestChangePolicy } from "./proof/per-test-review.js";
import type { OutsideObservation, TestChange, TestChangeRecord } from "./proof/test-baseline.js";
import type { RepairPolicy } from "./repair.js";

/**
 * `an-existing-test-change-is-recorded-with-its-reason` at the GATE (ADR-0585): the spine reads the
 * existing-test record at CONFIRM_RED — on every real build, whatever the proof route — carries it out
 * on the result for the envelope to print, and hands a change with NO stated reason back to the
 * test-writer through the repair loop rather than ending the build on it.
 */

const RED: TestObservation = { result: "red", testId: "T", originalProcessResult: { stdout: "red", stderr: "", exitCode: 1 } };
const GREEN: TestObservation = { result: "green", testId: "T", originalProcessResult: { stdout: "green", stderr: "", exitCode: 0 } };

const PROOF_FILE = "packages/unit/src/unit.test.ts";
const UNEXPLAINED: TestChange = {
  file: PROOF_FILE,
  observed: true,
  test: ["add-sums: two and three make five"],
  kind: "updated",
};
const EXPLAINED: TestChange = {
  file: PROOF_FILE,
  observed: true,
  test: ["add-sums: two and three make five"],
  kind: "updated",
  reason: "add-sums: two and three make five — the sum now rounds",
  asserts: "new-behaviour",
};

/** Returns the scripted result for each call in order, defaulting to a plain success. */
class ScriptedAuthor implements PhaseAuthor {
  readonly calls: { phase: AuthoringPhase; prompt: string }[] = [];
  constructor(private readonly results: AuthorResult[] = []) {}
  async author(phase: AuthoringPhase, prompt: string): Promise<AuthorResult> {
    this.calls.push({ phase, prompt });
    return this.results[this.calls.length - 1] ?? { ok: true };
  }
  get phases(): AuthoringPhase[] {
    return this.calls.map((c) => c.phase);
  }
}

class CountingAuthor implements PhaseAuthor {
  readonly calls: { phase: AuthoringPhase; prompt: string }[] = [];
  async author(phase: AuthoringPhase, prompt: string): Promise<{ ok: true }> {
    this.calls.push({ phase, prompt });
    return { ok: true };
  }
}

/** Captures the repair admission passed to production's sole PhaseAuthor dispatch point. */
class AdmissionRecordingAuthor implements PhaseAuthor {
  readonly calls: {
    phase: AuthoringPhase;
    prompt: string;
    admission: AuthoringRepairAdmission | undefined;
  }[] = [];

  async author(
    phase: AuthoringPhase,
    prompt: string,
    admission?: AuthoringRepairAdmission,
  ): Promise<{ ok: true }> {
    this.calls.push({ phase, prompt, admission });
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
  outsideTests?: OutsideTestPolicy;
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
  if (args.outsideTests !== undefined) s.outsideTests = args.outsideTests;
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

describe("c8-repair-paths-reach-the-pending-author-test-slice: only machine-derived C8 paths reach the repair author", () => {
  test("passes sorted unique workspace-relative C8 targets only to the pending AUTHOR_TEST repair", async () => {
    const author = new AdmissionRecordingAuthor();
    const zebra: TestChange = { ...UNEXPLAINED, file: "packages/unit/src/zebra.test.ts", test: ["zebra"] };
    const ant: TestChange = { ...UNEXPLAINED, file: "packages/unit/src/ant.test.ts", test: ["ant"] };
    const hyena: TestChange = { ...UNEXPLAINED, file: "packages/unit/src/hyena.test.ts", test: ["hyena"] };
    const explained: TestChange = { ...EXPLAINED, file: "packages/unit/src/explained.test.ts", test: ["explained"] };
    const { spec: s } = spec({
      author,
      repair: alwaysRepairs,
      testChanges: scriptedChanges(
        [
          {
            changes: [zebra, explained, hyena, ant, zebra],
            findings: [
              { check: "C8", test: zebra.test, detail: "no stated reason", testSide: true },
              { check: "C8", test: ant.test, detail: "no stated reason", testSide: true },
              { check: "C7", test: hyena.test, detail: "another repair", testSide: true },
            ],
          },
          { changes: [EXPLAINED], findings: [] },
        ],
        { n: 0 },
      ),
      observations: [RED, RED, GREEN],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true, "the second machine review, not the admission, clears C8");
    assert.deepEqual(author.calls.map((call) => [call.phase, call.admission]), [
      ["AUTHOR_TEST", undefined],
      [
        "AUTHOR_TEST",
        {
          kind: "c8-existing-test-reason",
          targets: ["packages/unit/src/ant.test.ts", "packages/unit/src/zebra.test.ts"],
        },
      ],
      ["IMPLEMENT", undefined],
    ]);
  });
});

describe("c8-repair-admission-is-not-general-repair-context: repair admissions do not escape their C8 slice", () => {
  test("does not pass an admission to initial, non-C8, later repair, or IMPLEMENT author calls", async () => {
    const author = new AdmissionRecordingAuthor();
    const c8: TestChange = { ...UNEXPLAINED, file: "packages/unit/src/c8.test.ts", test: ["C8 test"] };
    const other: TestChange = { ...UNEXPLAINED, file: "packages/unit/src/other.test.ts", test: ["other test"] };
    const { spec: s } = spec({
      author,
      repair: alwaysRepairs,
      testChanges: scriptedChanges(
        [
          { changes: [c8], findings: [{ check: "C8", test: c8.test, detail: "no stated reason", testSide: true }] },
          { changes: [other], findings: [{ check: "C7", test: other.test, detail: "other repair", testSide: true }] },
          { changes: [EXPLAINED], findings: [] },
        ],
        { n: 0 },
      ),
      observations: [RED, RED, RED, GREEN],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    assert.deepEqual(author.calls.map((call) => call.admission), [
      undefined,
      { kind: "c8-existing-test-reason", targets: ["packages/unit/src/c8.test.ts"] },
      undefined,
      undefined,
    ]);
  });
});

describe("c8-repair-admission-leaves-c8-observation-in-force: an admission never resolves the C8 record itself", () => {
  test("refuses an unresolved C8 finding after dispatching its author admission", async () => {
    const author = new AdmissionRecordingAuthor();
    const unresolved: TestChange = { ...UNEXPLAINED, file: "packages/unit/src/unresolved.test.ts", test: ["unresolved"] };
    const { spec: s, store } = spec({
      author,
      repair: alwaysRepairs,
      testChanges: scriptedChanges(
        [
          { changes: [unresolved], findings: [{ check: "C8", test: unresolved.test, detail: "no stated reason", testSide: true }] },
          { changes: [unresolved], findings: [{ check: "C8", test: unresolved.test, detail: "still no reason", testSide: true }] },
        ],
        { n: 0 },
      ),
      observations: [RED, RED],
    });
    let repairAttempts = 0;
    const refusingRepair: RepairPolicy = {
      ...alwaysRepairs,
      budget: {
        mayRepair: () => {
          repairAttempts += 1;
          return Promise.resolve(
            repairAttempts === 1
              ? { ok: true }
              : { ok: false, reason: "repair budget spent" },
          );
        },
      },
    };
    s.repair = refusingRepair;

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_RED");
    assert.deepEqual(author.calls.map((call) => call.admission), [
      undefined,
      { kind: "c8-existing-test-reason", targets: ["packages/unit/src/unresolved.test.ts"] },
    ]);
    assert.equal((await store.readEvents()).filter((event) => event.kind === "signing").length, 0);
  });
});

/**
 * `a-changed-test-outside-the-proof-file-is-held-to-what-it-declared` at the GATE (ADR-0591): the spine
 * RE-OBSERVES the changed files the proof command never runs, inside its own set-aside so the claim is
 * checked against the source the build began from, and routes a broken claim to the test-writer.
 */

const SIBLING = "packages/unit/src/sibling.test.ts";
const SIBLING_TITLE = ["clamps a port: rejects a negative"];

const sibling = (over: Partial<TestChange> = {}): TestChange => ({
  file: SIBLING,
  observed: false,
  test: SIBLING_TITLE,
  kind: "updated",
  reason: "clamps a port: rejects a negative — the port now clamps",
  asserts: "new-behaviour",
  ...over,
});

/** A policy that runs whatever it is given and reports the scripted outcome, recording the calls. */
function scriptedOutside(
  outcome: "passed" | "failed",
  calls: { runnable: string[][]; observed: string[][] },
  runnableFilter: (files: readonly string[]) => readonly string[] = (f) => f,
): OutsideTestPolicy {
  return {
    runnable(files) {
      calls.runnable.push([...files]);
      return runnableFilter(files);
    },
    observe(files): Promise<readonly OutsideObservation[]> {
      calls.observed.push([...files]);
      return Promise.resolve(
        files.map((file) => ({
          file,
          report: { channel: "node-test" as const, present: true, rows: [{ path: SIBLING_TITLE, outcome, message: "" }] },
        })),
      );
    },
  };
}

describe("a-changed-test-outside-the-proof-file-is-held-to-what-it-declared: the gate re-observes it", () => {
  test("a change that holds what it declared lets the walk sign, and the envelope stops saying recorded-only", async () => {
    const calls = { runnable: [] as string[][], observed: [] as string[][] };
    const reads = { n: 0 };
    const { spec: s } = spec({
      author: new CountingAuthor(),
      repair: alwaysRepairs,
      testChanges: scriptedChanges([{ changes: [sibling()], findings: [] }], reads),
      // It declared NEW behaviour, and it fails against the source the build began from.
      outsideTests: scriptedOutside("failed", calls),
      observations: [RED, GREEN],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(calls.runnable, [[SIBLING]], "the gate asks WHICH changed files it can run");
    assert.deepEqual(calls.observed, [[SIBLING]], "and runs exactly those");
    assert.deepEqual(
      result.testChanges?.map((c) => [c.file, c.observed]),
      [[SIBLING, true]],
      "a file that was actually re-observed no longer carries the envelope's recorded-only qualifier",
    );
    assert.deepEqual(result.repairs ?? [], [], "a claim that holds interrupts nothing");
  });

  test("a change that does NOT hold goes back to the test-writer, and the walk signs once it does", async () => {
    const calls = { runnable: [] as string[][], observed: [] as string[][] };
    const reads = { n: 0 };
    const author = new CountingAuthor();
    const passes = scriptedOutside("passed", calls);
    const fails = scriptedOutside("failed", calls);
    let round = 0;
    const { spec: s } = spec({
      author,
      repair: alwaysRepairs,
      testChanges: scriptedChanges([{ changes: [sibling()], findings: [] }], reads),
      outsideTests: {
        runnable: (f) => (round === 0 ? passes.runnable(f) : fails.runnable(f)),
        observe: (f) => {
          // First time it PASSES against the base source — a new-behaviour claim that is not true.
          const answer = round === 0 ? passes.observe(f) : fails.observe(f);
          round += 1;
          return answer;
        },
      },
      observations: [RED, RED, GREEN],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true, "a broken claim is repaired inside the build, never an end to it");
    if (!result.ok) return;
    assert.deepEqual(author.calls.map((c) => c.phase), ["AUTHOR_TEST", "AUTHOR_TEST", "IMPLEMENT"]);
    assert.deepEqual(
      result.repairs?.map((r) => [r.failedAt, r.check, r.to]),
      [["CONFIRM_RED", "test-changes", "AUTHOR_TEST"]],
      "the test-writer is the only worker that can clear it",
    );
    assert.match(
      result.repairs?.[0]?.detail ?? "",
      /outside the proof file that did not hold what they declared/,
    );
  });

  test("a file the build cannot RUN is never claimed to have been checked", async () => {
    const calls = { runnable: [] as string[][], observed: [] as string[][] };
    const reads = { n: 0 };
    const { spec: s } = spec({
      author: new CountingAuthor(),
      repair: alwaysRepairs,
      testChanges: scriptedChanges([{ changes: [sibling()], findings: [] }], reads),
      // A vitest package offers no named-subset runner, so `runnable` returns nothing (ADR-0587).
      outsideTests: scriptedOutside("passed", calls, () => []),
      observations: [RED, GREEN],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(calls.observed, [], "nothing is spawned when nothing is runnable");
    assert.deepEqual(
      result.testChanges?.map((c) => [c.file, c.observed]),
      [[SIBLING, false]],
      "it stays recorded-only, which is the honest answer for a file nothing ran",
    );
    assert.deepEqual(result.repairs ?? [], [], "and it refuses nothing on the strength of a run that never happened");
  });

  test("a walk with no outside policy is exactly the walk it was before ADR-0591", async () => {
    const reads = { n: 0 };
    const { spec: s } = spec({
      author: new CountingAuthor(),
      repair: alwaysRepairs,
      testChanges: scriptedChanges([{ changes: [sibling()], findings: [] }], reads),
      observations: [RED, GREEN],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.testChanges?.map((c) => [c.file, c.observed]),
      [[SIBLING, false]],
      "the record is carried unchanged, and claims nothing about having been checked",
    );
    assert.deepEqual(result.phasesVisited, ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "GATE"]);
  });

  test("once IMPLEMENT has run, the re-observation is BRACKETED by its own set-aside", async () => {
    // THE POINT OF THIS TEST. A marker's claim is about the source the build BEGAN from. After
    // IMPLEMENT the worktree no longer holds that source, so a re-observation taken there would judge
    // the claim against the implementation — and a `new behaviour` test would then correctly fail for
    // the wrong reason, or a refactor pass for one. An escalation at IMPLEMENT is what drives the walk
    // back through CONFIRM_RED with an implementation on disk, which is the only way to reach this.
    const order: string[] = [];
    const calls = { runnable: [] as string[][], observed: [] as string[][] };
    const reads = { n: 0 };
    const repair: RepairPolicy = {
      budget: { mayRepair: () => Promise.resolve({ ok: true }) },
      setAsideImplementation: () => {
        order.push("set-aside");
        return Promise.resolve(() => {
          order.push("restore");
          return Promise.resolve();
        });
      },
      routeTypecheck: () => undefined,
    };
    const author = new ScriptedAuthor([
      { ok: true },
      {
        ok: false,
        error: "IMPLEMENT escalated",
        escalation: {
          phase: "IMPLEMENT",
          kind: "unsatisfiable-test",
          statement: "the test expects 4 for add(2, 3)",
          assertion: "assert.equal(add(2, 3), 4)",
        },
      },
    ]);
    const { spec: s } = spec({
      author,
      repair,
      testChanges: scriptedChanges([{ changes: [sibling()], findings: [] }], reads),
      outsideTests: {
        runnable: (f) => f,
        observe: (f) => {
          order.push("observe-outside");
          return scriptedOutside("failed", calls).observe(f);
        },
      },
      // red at CONFIRM_RED, red at CONFIRM_GREEN (which is what the escalation answers), then the
      // revised test red again against the set-aside source, and finally green.
      observations: [RED, RED, RED, GREEN],
    });

    const result = await proveUnit(s);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT", "AUTHOR_TEST"], "the escalation drove a revision");

    // FIRST CONFIRM_RED: no implementation exists yet, so there is nothing to set aside.
    // SECOND CONFIRM_RED (post-escalation): the proof observation takes the existing bracket, and the
    // outside re-observation takes its OWN — each restored before the next thing runs.
    assert.deepEqual(
      order,
      ["observe-outside", "set-aside", "restore", "set-aside", "observe-outside", "restore"],
      "the outside run is wrapped by a set-aside/restore pair of its own, after the proof observation's",
    );
    assert.deepEqual(calls.observed, [[SIBLING], [SIBLING]], "re-observed at each CONFIRM_RED it reached");
  });
});
