import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_BUILD_BUDGET_MS,
  REPAIR_STREAM_CHARS,
  clipTail,
  codeRepairSection,
  diagnosticFiles,
  redObservationSection,
  renderObservation,
  routeTypecheckByFile,
  testRepairSection,
  wallClockBudget,
} from "./repair.js";
import type { ProcessOutput, RepairCause } from "./repair.js";
import { PathWriteScope } from "./phase-machine.js";

/**
 * `repair-support-routes-and-briefs-the-repairing-worker` (ADR-0582 D3/D6/D7): the pure pieces the
 * in-build repair loop consults — the budget that bounds it, the brief each repairing worker receives,
 * and the router that sends a red package typecheck to whoever owns the files it names.
 */

const out = (stdout: string, stderr = "", exitCode: number | null = 1): ProcessOutput => ({ stdout, stderr, exitCode });

const CAUSE: RepairCause = {
  failedAt: "CONFIRM_GREEN",
  check: "no-green",
  reason: "CONFIRM_GREEN requires an observed green (got 'red' for test T)",
  observation: out("expected 5, got 6", "stack trace"),
};

describe("repair-support-routes-and-briefs-the-repairing-worker: the budget, the briefs and the typecheck router", () => {
  test("the wall-clock budget admits a repair until its budget has elapsed, then refuses with the plain reason", async () => {
    let clock = 1_000;
    const budget = wallClockBudget({ budgetMs: 10 * 60_000, now: () => clock });
    clock += 10 * 60_000 - 1;
    assert.deepEqual(await budget.mayRepair(), { ok: true }, "one millisecond short of the budget still repairs");
    clock += 1;
    assert.deepEqual(await budget.mayRepair(), {
      ok: false,
      reason: "the build's time budget of 10 min is spent (10 min elapsed), so no repair was started (ADR-0581 D2)",
    });
  });

  test("the default budget is the owner's two hours, measured from the budget's construction", async () => {
    assert.equal(DEFAULT_BUILD_BUDGET_MS, 7_200_000);
    let clock = 5_000_000;
    const budget = wallClockBudget({ now: () => clock });
    clock += DEFAULT_BUILD_BUDGET_MS - 1;
    assert.equal((await budget.mayRepair()).ok, true);
    clock += 1;
    const spent = await budget.mayRepair();
    assert.equal(spent.ok, false);
    assert.ok(!spent.ok && spent.reason.startsWith("the build's time budget of 120 min is spent (120 min elapsed)"));
  });

  test("clipTail keeps a stream at the cap exactly, and keeps the TAIL of a longer one with the cut named", () => {
    const atCap = "x".repeat(REPAIR_STREAM_CHARS);
    assert.equal(clipTail(atCap), atCap);
    const long = `${"H".repeat(10)}${"t".repeat(REPAIR_STREAM_CHARS)}`;
    const clipped = clipTail(long);
    assert.equal(clipped, `(kept the last ${REPAIR_STREAM_CHARS} characters; 10 omitted)\n${"t".repeat(REPAIR_STREAM_CHARS)}`);
    assert.ok(!clipped.includes("H"), "the omitted head never leaks");
    assert.equal(clipTail("abcdef", 3), "(kept the last 3 characters; 3 omitted)\ndef");
  });

  test("an observation renders its exit code and both streams, and says so when a stream is empty or killed", () => {
    assert.equal(
      renderObservation("The run", out("so", "se", 2)),
      "The run, exit 2:\n--- stdout ---\nso\n--- stderr ---\nse",
    );
    assert.equal(
      renderObservation("The run", out("", "", null)),
      "The run, exit none (killed or timed out):\n--- stdout ---\n(empty)\n--- stderr ---\n(empty)",
    );
  });

  test("the code-writer's red section carries the CONFIRM_RED observation, and nothing when there was none", () => {
    assert.equal(redObservationSection(undefined), "");
    const section = redObservationSection(out("TypeError: add is not a function"));
    assert.ok(section.startsWith("\n\nThe spine's CONFIRM_RED observation of the test you implement against"));
    assert.match(section, /TypeError: add is not a function/);
  });

  test("a test-writer repair section says what failed, carries the observation, and names the escalate tool", () => {
    const section = testRepairSection(2, { ...CAUSE, failedAt: "CONFIRM_RED", check: "no-red" }, false);
    assert.ok(section.startsWith("\n\n---\n\nIN-BUILD REPAIR 2 (ADR-0581 D4)."), "numbered and set off");
    assert.match(section, /handing the TEST back to you in the SAME build/);
    assert.match(section, /What failed, at CONFIRM_RED:\nCONFIRM_GREEN requires an observed green/);
    assert.match(section, /The spine's CONFIRM_RED observation behind that refusal, exit 1:\n--- stdout ---\nexpected 5, got 6/);
    assert.match(section, /must FAIL against the source this build began from/);
    assert.match(section, /guard-rail, which only the story's contract can declare \(ADR-0572\)/);
    assert.match(section, /`escalate` tool/);
    assert.doesNotMatch(section, /sets it aside/, "no implementation, nothing set aside");
    assert.match(testRepairSection(1, CAUSE, true), /the spine sets it aside/);
  });

  test("a test-writer revision carries the code-writer's escalation verbatim", () => {
    const section = testRepairSection(
      1,
      { ...CAUSE, check: "escalation", escalation: { statement: "S says so", assertion: "assert.equal(a, b)" } },
      true,
    );
    assert.match(section, /escalated that this test cannot be satisfied as written \(`unsatisfiable-test`\)/);
    assert.match(section, /Statement, verbatim:\nS says so\n\nAssertion, verbatim:\nassert\.equal\(a, b\)/);
  });

  test("a code-writer repair section keeps the test frozen, carries the output, and directs objections to the tool", () => {
    const section = codeRepairSection(3, CAUSE);
    assert.ok(section.startsWith("\n\n---\n\nIN-BUILD REPAIR 3 (ADR-0581 D4)."));
    assert.match(section, /the test is frozen — writes to it are refused/);
    assert.match(section, /expected 5, got 6/);
    assert.match(section, /stack trace/);
    assert.match(section, /EXISTING test your change legitimately needs updated/);
    assert.match(section, /An objection written only in prose is not recorded/);
    assert.doesNotMatch(section, /revised the test/, "no revision, so none is described");
  });

  test("a code-writer repair right after a revision says why the test changed", () => {
    const revision: RepairCause = {
      failedAt: "GATE",
      check: "typecheck",
      reason: "the package typecheck is RED",
      escalation: { statement: "old test asserts the old default", assertion: "assert.equal(x, 1)" },
    };
    const section = codeRepairSection(2, CAUSE, revision);
    assert.match(section, /The test-writer revised the test in this build, because of what failed at GATE:\nthe package typecheck is RED/);
    assert.match(section, /Statement, verbatim:\nold test asserts the old default/);
    assert.match(section, /re-observed the revised test RED against the source this build began from/);
    // The revision's own observation is not repeated: the red section above the repair section carries the new red.
    assert.ok(section.indexOf("revised the test") < section.indexOf("What failed, at CONFIRM_GREEN"));
  });

  test("the typecheck output's diagnostics are read in both of tsc's formats, a wrapper's prefix skipped", () => {
    const files = diagnosticFiles(
      out(
        [
          "packages/cli typecheck: src/a.test.ts(3,7): error TS2322: Type 'string' is not assignable",
          "src/b.ts:10:2 - error TS2304: Cannot find name 'x'.",
          "src/a.test.ts(9,1): error TS1005: ';' expected.",
          "error TS5083: Cannot read file 'tsconfig.json'.",
          "Found 3 errors.",
        ].join("\n"),
        "C:\\w\\packages\\x\\src\\c.tsx(1,1): error TS1109: Expression expected.",
      ),
    );
    assert.deepEqual(files, ["src/a.test.ts", "src/b.ts", "C:\\w\\packages\\x\\src\\c.tsx"]);
  });

  test("a red typecheck goes to the test-writer only when EVERY file it names is a test file, and to nobody when it names none", () => {
    const scope = new PathWriteScope({
      testGlobs: ["packages/orchestrator/src/**/*.test.ts"],
      sourceGlobs: ["packages/orchestrator/src/**/*.ts"],
    });
    const routing = {
      isTestPath: (p: string): boolean => scope.isWriteAllowed("AUTHOR_TEST", p),
      anchors: ["packages/orchestrator/src/unit.test.ts", "packages/orchestrator/src/unit.ts"],
      worktreeRoot: "/work",
    };
    const tsc = (...paths: string[]): ProcessOutput =>
      out(paths.map((p) => `${p}(1,1): error TS2322: bad`).join("\n"));
    // Package-relative (tsc runs in the package) and repo-relative paths both resolve against the scope.
    assert.equal(routeTypecheckByFile(tsc("src/unit.test.ts"), routing), "test");
    assert.equal(routeTypecheckByFile(tsc("packages/orchestrator/src/unit.test.ts"), routing), "test");
    assert.equal(routeTypecheckByFile(tsc("./src/other.test.ts"), routing), "test", "any test file in the scope");
    assert.equal(routeTypecheckByFile(tsc("/work/packages/orchestrator/src/unit.test.ts"), routing), "test");
    assert.equal(routeTypecheckByFile(tsc("src/unit.ts"), routing), "code");
    assert.equal(routeTypecheckByFile(tsc("src/unit.test.ts", "src/unit.ts"), routing), "code", "mixed goes to code");
    assert.equal(routeTypecheckByFile(tsc("../cli/src/caller.ts"), routing), "code", "outside the scope is code's");
    assert.equal(routeTypecheckByFile(out("ELIFECYCLE Command failed", "", null), routing), undefined);
    assert.equal(routeTypecheckByFile(out("error TS5083: Cannot read file 'tsconfig.json'."), routing), undefined);
  });
});
