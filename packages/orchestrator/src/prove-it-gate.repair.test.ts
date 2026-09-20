import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { InMemoryStore } from "@storytree/storage-protocol";
import type { AuthorResult, AuthoringEscalation, AuthoringPhase, PhaseAuthor } from "@storytree/agent";

import { RecordingTestExecutor } from "./phase-machine.js";
import type { TestObservation } from "./phase-machine.js";
import { proveUnit } from "./prove-it-gate.js";
import type { BackstopOutcome, ProveSpec } from "./prove-it-gate.js";
import type { PerTestFinding, PerTestJudgement, PerTestPolicy } from "./proof/per-test-review.js";
import type { ProcessOutput, RepairDecision, RepairPolicy } from "./repair.js";

/**
 * The in-build repair loop (ADR-0581 D4; the mechanism is ADR-0582), driven through `proveUnit` with a
 * scripted author, scripted observations and a fake {@link RepairPolicy} — so every assertion reads the
 * walk itself: which worker each failed check went to, what that worker was told, what the spine
 * observed again, and how a walk ends when it cannot repair.
 */

// ── Fixtures ────────────────────────────────────────────────────────────────

const FIXED_NOW = "2026-09-20T00:00:00.000Z";
const AUTHOR_BRIEF = "author the failing test";
const IMPLEMENT_BRIEF = "implement it";

const out = (stdout: string, exitCode: number | null = 1, stderr = ""): ProcessOutput => ({ stdout, stderr, exitCode });
const red = (stdout = "red run"): TestObservation => ({
  result: "red",
  testId: "T",
  originalProcessResult: out(stdout, 1),
});
const green = (stdout = "green run"): TestObservation => ({
  result: "green",
  testId: "T",
  originalProcessResult: out(stdout, 0),
});

const UNSATISFIABLE: AuthoringEscalation = {
  phase: "IMPLEMENT",
  kind: "unsatisfiable-test",
  statement: "the test expects 4 for add(2, 3)",
  assertion: "assert.equal(add(2, 3), 4)",
};

/** A {@link PhaseAuthor} that returns a scripted result per call (default `{ ok: true }`) and records each. */
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

/** A policy that records every call the loop makes on it, in one shared event log. */
function recordingPolicy(opts: {
  events: string[];
  decisions?: RepairDecision[];
  route?: (output: ProcessOutput) => "test" | "code" | undefined;
  /** What each `scopeFingerprint()` call returns, in order; the last value repeats. Absent = no seam. */
  fingerprints?: string[];
}): RepairPolicy {
  let asked = 0;
  let taken = 0;
  const fingerprint =
    opts.fingerprints === undefined
      ? {}
      : {
          scopeFingerprint: (): Promise<string> => {
            opts.events.push("fingerprint");
            const values = opts.fingerprints ?? [];
            const value = values[Math.min(taken, values.length - 1)] ?? "";
            taken += 1;
            return Promise.resolve(value);
          },
        };
  return {
    ...fingerprint,
    budget: {
      mayRepair(): Promise<RepairDecision> {
        opts.events.push("budget");
        const decision = opts.decisions?.[asked] ?? { ok: true };
        asked += 1;
        return Promise.resolve(decision);
      },
    },
    setAsideImplementation(): Promise<() => Promise<void>> {
      opts.events.push("set-aside");
      return Promise.resolve(() => {
        opts.events.push("restore");
        return Promise.resolve();
      });
    },
    routeTypecheck(output: ProcessOutput): "test" | "code" | undefined {
      opts.events.push("route-typecheck");
      return opts.route?.(output);
    },
  };
}

/** A test executor that logs each observation into the same event log, so ordering can be asserted. */
class LoggingExecutor extends RecordingTestExecutor {
  constructor(script: TestObservation[], private readonly events: string[]) {
    super(script);
  }
  override async run(testId: string): Promise<TestObservation> {
    const obs = await super.run(testId);
    this.events.push(`observe:${obs.result}`);
    return obs;
  }
}

function spec(args: {
  author: PhaseAuthor;
  observations: TestObservation[];
  events?: string[];
  repair?: RepairPolicy;
  perTest?: PerTestPolicy;
  backstops?: BackstopOutcome[];
}) {
  const store = new InMemoryStore();
  const executor = new LoggingExecutor(args.observations, args.events ?? []);
  const s: ProveSpec = {
    unitId: "unit-1",
    proofMode: "contract",
    testId: "T",
    author: args.author,
    testExecutor: executor,
    store,
    signerInputs: { flag: "tester@example.com" },
    treeState: async () => ({ commitSha: "cafe", clean: true }),
    now: () => FIXED_NOW,
    prompts: { authorTest: AUTHOR_BRIEF, implement: IMPLEMENT_BRIEF },
    runId: "run-1",
  };
  if (args.repair !== undefined) s.repair = args.repair;
  if (args.perTest !== undefined) s.perTest = args.perTest;
  if (args.backstops !== undefined) {
    const queue = [...args.backstops];
    s.backstop = async () => queue.shift() ?? { ok: true };
  }
  return { spec: s, store, executor };
}

async function signingRows(store: InMemoryStore): Promise<number> {
  return (await store.readEvents()).filter((e) => e.kind === "signing").length;
}

/** A per-test policy whose reviews return the scripted judgements in order (default: accept). */
function scriptedPerTest(opts: { red?: PerTestJudgement[]; green?: PerTestJudgement[]; baselineReads: { n: number } }): PerTestPolicy {
  const reds = [...(opts.red ?? [])];
  const greens = [...(opts.green ?? [])];
  const accept: PerTestJudgement = { ok: true, declaredTests: 1, acceptedGuardRails: [] };
  return {
    beforeAuthorTest(): void {
      opts.baselineReads.n += 1;
    },
    confirmRed: () => reds.shift() ?? accept,
    confirmGreen: () => greens.shift() ?? accept,
  };
}

const finding = (f: Partial<PerTestFinding> & Pick<PerTestFinding, "check" | "detail">): PerTestFinding => f;

// ── The routes ──────────────────────────────────────────────────────────────

describe("failed-check-returns-to-the-worker-who-can-fix-it: each failed check goes back to its owner, and the spine observes again", () => {
  test("no red at CONFIRM_RED goes to the test-writer, and the repaired test is observed red again", async () => {
    const events: string[] = [];
    const author = new ScriptedAuthor();
    const { spec: s, store } = spec({
      author,
      events,
      repair: recordingPolicy({ events }),
      observations: [green("passed before any code"), red("now red"), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true, "the repaired walk signs");
    if (!result.ok) return;
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "AUTHOR_TEST", "IMPLEMENT"]);
    assert.deepEqual(result.phasesVisited, [
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "IMPLEMENT",
      "CONFIRM_GREEN",
      "GATE",
    ]);
    assert.deepEqual(result.repairs, [
      {
        failedAt: "CONFIRM_RED",
        check: "no-red",
        to: "AUTHOR_TEST",
        detail: "no red observed — the test passed before its implementation exists",
      },
    ]);
    // The repair brief is the original brief plus what failed, with the observation behind it.
    const repairBrief = author.calls[1]?.prompt ?? "";
    assert.ok(repairBrief.startsWith(AUTHOR_BRIEF), "the repair brief keeps the whole original brief");
    assert.match(repairBrief, /IN-BUILD REPAIR 1 \(ADR-0581 D4\)/);
    assert.match(repairBrief, /CONFIRM_RED requires an observed red \(got 'green' for test T\)/);
    assert.match(repairBrief, /passed before any code/);
    assert.doesNotMatch(repairBrief, /sets it aside/, "no implementation exists yet, so none is set aside");
    // No implementation existed at the first repair, so nothing was set aside; the budget was asked once.
    assert.deepEqual(events, ["observe:green", "budget", "observe:red", "observe:green"]);
    // The verdict's evidence is the red that ADVANCED, not the refused green.
    assert.deepEqual(
      result.verdict.evidence.map((e) => e.kind),
      ["observation:red", "observation:green"],
    );
    assert.equal(await signingRows(store), 1);
  });

  test("a per-test refusal at CONFIRM_RED goes to the test-writer with the findings, never the orchestrator's routes", async () => {
    const baselineReads = { n: 0 };
    const author = new ScriptedAuthor();
    const refusal: PerTestJudgement = {
      ok: false,
      findings: [
        finding({
          check: "C4",
          test: ["c-1: adds"],
          namedContracts: ["c-1"],
          detail: "passed before its implementation exists",
          testSide: true,
        }),
      ],
    };
    const { spec: s } = spec({
      author,
      repair: recordingPolicy({ events: [] }),
      perTest: scriptedPerTest({ red: [refusal], baselineReads }),
      observations: [red(), red(), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "AUTHOR_TEST", "IMPLEMENT"]);
    const repairBrief = author.calls[1]?.prompt ?? "";
    assert.match(repairBrief, /C4 individually red — `c-1: adds`: passed before its implementation exists/);
    assert.doesNotMatch(repairBrief, /routing decision/, "ADR-0572's routes are the orchestrator's, not the worker's");
    assert.match(repairBrief, /guard-rail, which only the story's contract can declare/);
    assert.equal(baselineReads.n, 1, "the NEW-test baseline is read before the FIRST slice only");
  });

  test("no green at CONFIRM_GREEN goes to the code-writer, with the output and the red it implements against", async () => {
    const author = new ScriptedAuthor();
    const { spec: s } = spec({
      author,
      repair: recordingPolicy({ events: [] }),
      observations: [red("the red: add is not a function"), red("the green run: expected 5, got 6"), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT", "IMPLEMENT"]);
    assert.deepEqual(result.repairs, [
      { failedAt: "CONFIRM_GREEN", check: "no-green", to: "IMPLEMENT", detail: "no green observed" },
    ]);
    const [first, second] = [author.calls[1]?.prompt ?? "", author.calls[2]?.prompt ?? ""];
    // Every code-writer brief carries the red it implements against (ADR-0582 D7).
    for (const brief of [first, second]) {
      assert.ok(brief.startsWith(IMPLEMENT_BRIEF));
      assert.match(brief, /CONFIRM_RED observation of the test you implement against/);
      assert.match(brief, /the red: add is not a function/);
    }
    assert.doesNotMatch(first, /IN-BUILD REPAIR/, "the first slice is not a repair");
    assert.match(second, /IN-BUILD REPAIR 1/);
    assert.match(second, /the green run: expected 5, got 6/);
    assert.match(second, /raise it with the `escalate` tool/);
  });

  test("a standing escalation goes to an in-build test revision, re-observed red with the implementation set aside", async () => {
    const events: string[] = [];
    const author = new ScriptedAuthor([
      { ok: true },
      { ok: false, error: "IMPLEMENT escalated", escalation: UNSATISFIABLE },
    ]);
    const { spec: s } = spec({
      author,
      events,
      repair: recordingPolicy({ events }),
      observations: [red(), red("still red at green"), red("revised test, red on the base"), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    // The revision answered the escalation: nothing standing, nothing overruled, nothing returned.
    assert.equal(result.overruledEscalation, undefined);
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT", "AUTHOR_TEST"]);
    assert.deepEqual(result.phasesVisited, [
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "IMPLEMENT",
      "CONFIRM_GREEN",
      "AUTHOR_TEST",
      "CONFIRM_RED",
      "CONFIRM_GREEN",
      "GATE",
    ]);
    assert.deepEqual(result.repairs, [
      {
        failedAt: "CONFIRM_GREEN",
        check: "escalation",
        to: "AUTHOR_TEST",
        detail: `the code-writer escalated: ${UNSATISFIABLE.statement}`,
      },
    ]);
    const revisionBrief = author.calls[2]?.prompt ?? "";
    assert.match(revisionBrief, /Statement, verbatim:\nthe test expects 4 for add\(2, 3\)/);
    assert.match(revisionBrief, /Assertion, verbatim:\nassert\.equal\(add\(2, 3\), 4\)/);
    assert.match(revisionBrief, /still red at green/);
    assert.match(revisionBrief, /sets it aside/);
    // The set-aside brackets exactly the red re-observation, and the green is observed after the restore.
    assert.deepEqual(events, [
      "observe:red",
      "observe:red",
      "budget",
      "set-aside",
      "observe:red",
      "restore",
      "observe:green",
    ]);
  });

  test("after a revision the code-writer is handed a slice only when the restored implementation is not green, and is told why the test changed", async () => {
    const author = new ScriptedAuthor([
      { ok: true },
      { ok: false, error: "IMPLEMENT escalated", escalation: UNSATISFIABLE },
    ]);
    const { spec: s } = spec({
      author,
      repair: recordingPolicy({ events: [] }),
      observations: [red(), red(), red("revised: red on the base"), red("restored impl fails the revised test"), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT", "AUTHOR_TEST", "IMPLEMENT"]);
    assert.deepEqual(
      result.repairs?.map((r) => [r.failedAt, r.check, r.to]),
      [
        ["CONFIRM_GREEN", "escalation", "AUTHOR_TEST"],
        ["CONFIRM_GREEN", "no-green", "IMPLEMENT"],
      ],
    );
    const resumed = author.calls[3]?.prompt ?? "";
    assert.match(resumed, /IN-BUILD REPAIR 2/);
    assert.match(resumed, /The test-writer revised the test in this build/);
    assert.match(resumed, /Statement, verbatim:\nthe test expects 4/);
    assert.match(resumed, /revised: red on the base/, "the red it implements against is the REVISED test's");
    assert.match(resumed, /restored impl fails the revised test/);
  });

  test("at CONFIRM_GREEN, a finding only the test file can clear goes to the test-writer; any other goes to the code-writer", async () => {
    for (const [testSide, expectTo] of [
      [true, "AUTHOR_TEST"],
      [false, "IMPLEMENT"],
    ] as const) {
      const author = new ScriptedAuthor();
      const refusal: PerTestJudgement = {
        ok: false,
        findings: [
          testSide
            ? finding({ check: "C2", test: ["t"], detail: "declared through a table", testSide: true })
            : finding({ check: "green", test: ["t"], detail: "failed: AssertionError" }),
        ],
      };
      const observations = testSide ? [red(), green(), red(), green()] : [red(), green(), green()];
      const { spec: s } = spec({
        author,
        repair: recordingPolicy({ events: [] }),
        perTest: scriptedPerTest({ green: [refusal], baselineReads: { n: 0 } }),
        observations,
      });

      const result = await proveUnit(s);

      assert.equal(result.ok, true, `testSide=${String(testSide)}`);
      if (!result.ok) return;
      assert.deepEqual(
        result.repairs?.map((r) => [r.check, r.to]),
        [["green-per-test", expectTo]],
        `testSide=${String(testSide)}`,
      );
    }
  });

  test("a red typecheck goes to whoever owns the files it names, and a test repair then walks red, green, GATE again", async () => {
    const typecheckOutput = out("src/unit.test.ts(3,7): error TS2322: Type 'string' is not assignable", 2);
    for (const [owner, expectedPhases] of [
      ["test", ["AUTHOR_TEST", "IMPLEMENT", "AUTHOR_TEST"]],
      ["code", ["AUTHOR_TEST", "IMPLEMENT", "IMPLEMENT"]],
    ] as const) {
      const events: string[] = [];
      const author = new ScriptedAuthor();
      const observations = owner === "test" ? [red(), green(), red(), green()] : [red(), green(), green()];
      const { spec: s, store } = spec({
        author,
        events,
        repair: recordingPolicy({ events, route: () => owner }),
        backstops: [{ ok: false, reason: "tsc red", output: typecheckOutput }, { ok: true }],
        observations,
      });

      const result = await proveUnit(s);

      assert.equal(result.ok, true, owner);
      if (!result.ok) return;
      assert.deepEqual(author.phases, expectedPhases, owner);
      assert.deepEqual(result.repairs?.map((r) => [r.failedAt, r.check, r.to]), [
        ["GATE", "typecheck", owner === "test" ? "AUTHOR_TEST" : "IMPLEMENT"],
      ]);
      const repairBrief = author.calls[2]?.prompt ?? "";
      assert.match(repairBrief, /package typecheck \(tsc --noEmit, full strict flags\) is RED/);
      assert.match(repairBrief, /error TS2322/, "the typecheck output rides into the brief");
      assert.equal(await signingRows(store), 1, `${owner}: one signature, after the second GATE`);
      if (owner === "test") {
        assert.ok(events.includes("set-aside"), "a test revised after IMPLEMENT is re-observed against the base");
      } else {
        assert.ok(!events.includes("set-aside"), "a code repair sets nothing aside");
      }
    }
  });
});

// ── How a walk ends ─────────────────────────────────────────────────────────

describe("repair-loop-ends-only-on-a-spent-budget-or-a-refused-repair: a walk that cannot repair ends on the check that failed", () => {
  test("with no policy the walk ends at the first failed check exactly as it always has", async () => {
    const author = new ScriptedAuthor();
    const { spec: s } = spec({ author, observations: [red(), red("never green")] });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN");
    assert.equal(result.reason, "CONFIRM_GREEN requires an observed green (got 'red' for test T)");
    assert.equal(result.repairs, undefined);
    assert.deepEqual(result.failedObservation, out("never green", 1));
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT"]);
    assert.equal(author.calls[1]?.prompt, IMPLEMENT_BRIEF, "no policy, so the brief carries nothing new");
  });

  test("the budget is asked before EVERY repair, and a spent budget ends the walk on the original failure", async () => {
    const events: string[] = [];
    const author = new ScriptedAuthor();
    const { spec: s, store } = spec({
      author,
      events,
      repair: recordingPolicy({
        events,
        decisions: [{ ok: true }, { ok: false, reason: "the build's time budget of 120 min is spent" }],
      }),
      observations: [red(), red("first green run"), red("second green run")],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN");
    assert.equal(
      result.reason,
      "CONFIRM_GREEN requires an observed green (got 'red' for test T) — not repaired in-build: " +
        "the build's time budget of 120 min is spent",
    );
    assert.deepEqual(result.failedObservation, out("second green run", 1), "the failure is the LAST check's");
    assert.deepEqual(result.repairs?.map((r) => r.check), ["no-green"], "only the admitted repair is listed");
    assert.equal(events.filter((e) => e === "budget").length, 2, "one ask per repair, the refused one included");
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT", "IMPLEMENT"]);
    assert.equal(await signingRows(store), 0);
  });

  test("a standing escalation the budget cannot repair is still RETURNED, so the cross-build revision record is written", async () => {
    const author = new ScriptedAuthor([
      { ok: true },
      { ok: false, error: "IMPLEMENT escalated", escalation: UNSATISFIABLE },
    ]);
    const { spec: s } = spec({
      author,
      repair: recordingPolicy({ events: [], decisions: [{ ok: false, reason: "spent" }] }),
      observations: [red(), red("red at green")],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN");
    assert.deepEqual(result.escalation, { raised: UNSATISFIABLE, testId: "T" });
    assert.ok(result.reason.endsWith(" — not repaired in-build: spent"));
    assert.match(result.reason, /escalation \(unsatisfiable-test\)/, "the standing escalation still names itself");
  });

  test("a repair slice that fails to author is a refused repair: the walk ends on the check it was answering", async () => {
    const author = new ScriptedAuthor([{ ok: true }, { ok: true }, { ok: false, error: "SDK session crashed" }]);
    const { spec: s } = spec({
      author,
      repair: recordingPolicy({ events: [] }),
      observations: [red(), red("green run is red")],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN", "the failure is the check's, not the refused slice's");
    assert.equal(
      result.reason,
      "CONFIRM_GREEN requires an observed green (got 'red' for test T) — in-build repair refused: " +
        "the code-writer's repair slice failed (SDK session crashed)",
    );
    assert.deepEqual(result.failedObservation, out("green run is red", 1));
    assert.deepEqual(result.phasesVisited, ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "IMPLEMENT"]);
    assert.deepEqual(result.repairs?.map((r) => r.to), ["IMPLEMENT"]);
  });

  test("a repair slice that WROTE NOTHING is a refused repair: the walk ends on the check it was handed", async () => {
    const events: string[] = [];
    // The shape that burned two hours of budget per stuck build before this ending existed: a worker
    // that reports success every slice while leaving the workspace byte-identical.
    const author = new ScriptedAuthor();
    const { spec: s, store } = spec({
      author,
      events,
      repair: recordingPolicy({ events, fingerprints: ["same", "same"] }),
      observations: [red(), red("still red at green")],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_GREEN");
    assert.equal(
      result.reason,
      "CONFIRM_GREEN requires an observed green (got 'red' for test T) — in-build repair refused: " +
        "the code-writer wrote nothing: everything authored in this build is byte-identical to what " +
        "the repair was handed",
    );
    // The repair was handed out and its slice ran; what it produced is what refused it, and the spine
    // never paid for another observation.
    assert.deepEqual(result.repairs?.map((r) => r.check), ["no-green"]);
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT", "IMPLEMENT"]);
    assert.deepEqual(
      events.filter((e) => e.startsWith("observe")),
      ["observe:red", "observe:red"],
      "no third observation was spent on a repair that wrote nothing",
    );
    assert.equal(await signingRows(store), 0);
  });

  test("a repair slice that ESCALATED instead of writing is not a slice that wrote nothing", async () => {
    const events: string[] = [];
    const author = new ScriptedAuthor([
      { ok: true },
      { ok: true },
      { ok: false, error: "IMPLEMENT escalated", escalation: UNSATISFIABLE },
    ]);
    const { spec: s } = spec({
      author,
      events,
      // A frozen fingerprint: were the escalating slice judged on what it wrote, the walk would end here.
      repair: recordingPolicy({ events, fingerprints: ["frozen"] }),
      observations: [red(), red("still red at green"), red("red with the escalation standing")],
    });

    const result = await proveUnit(s);

    // The escalating slice was NOT refused for writing nothing: the spine observed CONFIRM_GREEN again
    // (ADR-0569 D3), the escalation stood, and it routed a test revision. That revision's own slice
    // wrote nothing, which is where this walk ends — one repair later than the escalation.
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual(author.phases, ["AUTHOR_TEST", "IMPLEMENT", "IMPLEMENT", "AUTHOR_TEST"]);
    assert.deepEqual(
      result.repairs?.map((r) => [r.check, r.to]),
      [
        ["no-green", "IMPLEMENT"],
        ["escalation", "AUTHOR_TEST"],
      ],
    );
    assert.ok(
      result.reason.endsWith(
        "in-build repair refused: the test-writer wrote nothing: everything authored in this build is " +
          "byte-identical to what the repair was handed",
      ),
      result.reason,
    );
    assert.match(result.reason, /escalation \(unsatisfiable-test\)/, "the standing escalation still names itself");
  });

  test("a repair slice that WROTE something keeps the walk going, however little it helped", async () => {
    const events: string[] = [];
    const author = new ScriptedAuthor();
    const { spec: s } = spec({
      author,
      events,
      repair: recordingPolicy({ events, fingerprints: ["before", "after", "after", "later"] }),
      observations: [red(), red("first green run"), red("second green run"), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true, "a walk whose workers keep writing keeps repairing");
    if (!result.ok) return;
    assert.deepEqual(result.repairs?.map((r) => r.check), ["no-green", "no-green"]);
  });

  test("the first slice of each phase is never a repair, so nothing it writes (or does not) is judged that way", async () => {
    const events: string[] = [];
    // A frozen fingerprint: were the FIRST slices judged, this walk would end instead of signing.
    const { spec: s } = spec({
      author: new ScriptedAuthor(),
      events,
      repair: recordingPolicy({ events, fingerprints: ["frozen"] }),
      observations: [red(), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    assert.ok(!events.includes("fingerprint"), "the fingerprint is not even taken outside a repair");
  });

  test("a repair slice's AUTHOR_TEST escalation ends the walk as ADR-0569 D4 decides, with the repairs listed", async () => {
    const author = new ScriptedAuthor([
      { ok: true },
      {
        ok: false,
        error: "AUTHOR_TEST escalated",
        escalation: { phase: "AUTHOR_TEST", kind: "untestable-contract", statement: "only a guard-rail can pin it" },
      },
    ]);
    const { spec: s } = spec({
      author,
      repair: recordingPolicy({ events: [] }),
      observations: [green("early pass"), green("the one observation D4 takes")],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "AUTHOR_TEST");
    assert.equal(result.escalation?.raised.kind, "untestable-contract");
    assert.deepEqual(result.escalation?.observation, out("the one observation D4 takes", 0));
    assert.deepEqual(result.repairs?.map((r) => r.check), ["no-red"]);
  });

  test("a red typecheck that names no file has no worker to go to, and says so", async () => {
    const author = new ScriptedAuthor();
    const events: string[] = [];
    const { spec: s } = spec({
      author,
      events,
      repair: recordingPolicy({ events, route: () => undefined }),
      backstops: [{ ok: false, reason: "tsc timed out", output: out("", null) }],
      observations: [red(), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "GATE");
    assert.match(result.reason, /^backstop RED: tsc timed out; /);
    assert.match(result.reason, / — not repaired in-build: the package typecheck names no file a worker can edit/);
    assert.ok(!events.includes("budget"), "an unowned failure never asks the budget");
  });

  test("a red backstop that carries no output is not routed at all", async () => {
    const events: string[] = [];
    const { spec: s } = spec({
      author: new ScriptedAuthor(),
      events,
      repair: recordingPolicy({ events, route: () => "code" }),
      backstops: [{ ok: false, reason: "red, no output" }],
      observations: [red(), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    assert.ok(!events.includes("route-typecheck"), "nothing to route by");
  });
});

// ── The re-observation against the base ─────────────────────────────────────

describe("revised-test-is-re-observed-red-against-the-build-base: a test revised after IMPLEMENT is observed red with the implementation set aside", () => {
  test("the implementation is restored even when the observation throws", async () => {
    const events: string[] = [];
    const author = new ScriptedAuthor([
      { ok: true },
      { ok: false, error: "IMPLEMENT escalated", escalation: UNSATISFIABLE },
    ]);
    // Two observations only: the third run (the red re-observation) over-runs the recording and throws.
    const { spec: s } = spec({ author, events, repair: recordingPolicy({ events }), observations: [red(), red()] });

    await assert.rejects(() => proveUnit(s), /RecordingTestExecutor exhausted/);
    assert.deepEqual(events.slice(-2), ["set-aside", "restore"], "restored although the run threw");
  });

  test("a set-aside that cannot be taken fails closed with its reason, and never observes against the implementation", async () => {
    const events: string[] = [];
    const author = new ScriptedAuthor([
      { ok: true },
      { ok: false, error: "IMPLEMENT escalated", escalation: UNSATISFIABLE },
    ]);
    const policy = recordingPolicy({ events });
    const broken: RepairPolicy = {
      ...policy,
      setAsideImplementation: () => Promise.reject(new Error("git diff HEAD failed: not a repository")),
    };
    const { spec: s, store } = spec({ author, events, repair: broken, observations: [red(), red()] });

    const result = await proveUnit(s);

    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.failedAt, "CONFIRM_RED");
    assert.match(result.reason, /^the implementation could not be set aside for the red re-observation/);
    assert.match(result.reason, /git diff HEAD failed: not a repository/);
    assert.deepEqual(
      events.filter((e) => e.startsWith("observe")),
      ["observe:red", "observe:red"],
      "the re-observation never ran against the implementation",
    );
    assert.equal(await signingRows(store), 0);
  });

  test("a test repaired before any IMPLEMENT sets nothing aside", async () => {
    const events: string[] = [];
    const { spec: s } = spec({
      author: new ScriptedAuthor(),
      events,
      repair: recordingPolicy({ events }),
      observations: [green(), red(), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    assert.ok(!events.includes("set-aside"));
  });

  test("a repaired test that is still not red goes back to the test-writer again, set aside each time", async () => {
    const events: string[] = [];
    const author = new ScriptedAuthor([
      { ok: true },
      { ok: false, error: "IMPLEMENT escalated", escalation: UNSATISFIABLE },
    ]);
    const { spec: s } = spec({
      author,
      events,
      repair: recordingPolicy({ events }),
      observations: [red(), red(), green("revision passes on the base"), red("second revision is red"), green()],
    });

    const result = await proveUnit(s);

    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
      result.repairs?.map((r) => [r.failedAt, r.check, r.to]),
      [
        ["CONFIRM_GREEN", "escalation", "AUTHOR_TEST"],
        ["CONFIRM_RED", "no-red", "AUTHOR_TEST"],
      ],
    );
    assert.equal(events.filter((e) => e === "set-aside").length, 2);
    assert.equal(events.filter((e) => e === "restore").length, 2);
    // The second revision's brief still says the implementation is set aside for its red.
    assert.match(author.calls[3]?.prompt ?? "", /sets it aside/);
  });
});
