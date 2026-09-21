import { test } from "node:test";
import assert from "node:assert/strict";
import {
  nextPhase,
  advancePhase,
  PathWriteScope,
  globMatch,
  RecordingTestExecutor,
} from "./phase-machine.js";
import type { TestObservation } from "./phase-machine.js";

const RED: TestObservation = { result: "red", kind: "runtime", testId: "t1" };
const GREEN: TestObservation = { result: "green", testId: "t1" };

test("nextPhase: CONFIRM_RED -> IMPLEMENT requires an observed red", () => {
  const ok = nextPhase("CONFIRM_RED", RED);
  assert.deepEqual(ok, { ok: true, next: "IMPLEMENT" });
});

test("nextPhase: CONFIRM_RED rejects a green (a forged/early pass)", () => {
  const bad = nextPhase("CONFIRM_RED", GREEN);
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok && /requires an observed red/.test(bad.reason));
});

test("original-shell-result-is-preserved-without-a-rerun: process detail is inert to phase transitions", () => {
  const red: TestObservation = { result: "red", kind: "compile", testId: "t1" };
  const redWithOriginalResult: TestObservation = {
    ...red,
    originalProcessResult: { stdout: "child stdout", stderr: "child stderr", exitCode: 1 },
  };

  // Adding shell transport detail must not change what an otherwise-identical observation decides.
  assert.deepEqual(nextPhase("CONFIRM_RED", red), { ok: true, next: "IMPLEMENT" });
  assert.deepEqual(nextPhase("CONFIRM_RED", redWithOriginalResult), { ok: true, next: "IMPLEMENT" });
  assert.deepEqual(
    nextPhase("CONFIRM_GREEN", { result: "green", testId: "t1" }),
    nextPhase("CONFIRM_GREEN", {
      result: "green",
      testId: "t1",
      originalProcessResult: { stdout: "child stdout", stderr: "child stderr", exitCode: 0 },
    }),
  );
  const nonShell = new RecordingTestExecutor([{ result: "red", testId: "recorded" }]);
  return nonShell.run("recorded").then((observation) => {
    assert.equal(observation.originalProcessResult, undefined, "non-shell observations invent no process detail");
  });
});

test("nextPhase: CONFIRM_GREEN -> GATE requires an observed green", () => {
  const ok = nextPhase("CONFIRM_GREEN", GREEN);
  assert.deepEqual(ok, { ok: true, next: "GATE" });
});

test("nextPhase: CONFIRM_GREEN rejects a red", () => {
  const bad = nextPhase("CONFIRM_GREEN", RED);
  assert.equal(bad.ok, false);
});

test("nextPhase: AUTHOR_TEST and IMPLEMENT are NOT observation gates (fail-closed)", () => {
  // These advance on an authoring-complete signal, not an obs gate.
  assert.equal(nextPhase("AUTHOR_TEST", RED).ok, false);
  assert.equal(nextPhase("IMPLEMENT", GREEN).ok, false);
});

test("nextPhase: GATE is terminal — no further observation gate", () => {
  assert.equal(nextPhase("GATE", GREEN).ok, false);
});

test("nextPhase rejects a forged transition (claiming green to skip the red gate)", () => {
  // Attempting CONFIRM_RED with a forged green must be refused — the illegal gate is rejected.
  const forged = nextPhase("CONFIRM_RED", { result: "green", testId: "forged" });
  assert.equal(forged.ok, false);
});

test("advancePhase: the two authoring-complete advances are legal", () => {
  assert.deepEqual(advancePhase("AUTHOR_TEST"), { ok: true, next: "CONFIRM_RED" });
  assert.deepEqual(advancePhase("IMPLEMENT"), { ok: true, next: "CONFIRM_GREEN" });
});

test("advancePhase: observation-gate and terminal phases do not authoring-advance", () => {
  assert.equal(advancePhase("CONFIRM_RED").ok, false);
  assert.equal(advancePhase("CONFIRM_GREEN").ok, false);
  assert.equal(advancePhase("GATE").ok, false);
});

test("the full legal path AUTHOR_TEST -> ... -> GATE composes", () => {
  let phase: "AUTHOR_TEST" | "CONFIRM_RED" | "IMPLEMENT" | "CONFIRM_GREEN" | "GATE" =
    "AUTHOR_TEST";

  const a1 = advancePhase(phase);
  assert.ok(a1.ok);
  phase = a1.next;
  assert.equal(phase, "CONFIRM_RED");

  const t1 = nextPhase(phase, RED);
  assert.ok(t1.ok);
  phase = t1.next;
  assert.equal(phase, "IMPLEMENT");

  const a2 = advancePhase(phase);
  assert.ok(a2.ok);
  phase = a2.next;
  assert.equal(phase, "CONFIRM_GREEN");

  const t2 = nextPhase(phase, GREEN);
  assert.ok(t2.ok);
  phase = t2.next;
  assert.equal(phase, "GATE");
});

// ---- write-scope (ADR-0020 §2) ----

const scope = new PathWriteScope({
  testGlobs: ["**/*.test.ts", "src/**/*.test.ts"],
  sourceGlobs: ["src/**/*.ts"],
});

test("write-scope: a TEST path is writable ONLY in AUTHOR_TEST", () => {
  const testPath = "src/feature/thing.test.ts";
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", testPath), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", testPath), false);
  assert.equal(scope.isWriteAllowed("CONFIRM_RED", testPath), false);
  assert.equal(scope.isWriteAllowed("CONFIRM_GREEN", testPath), false);
  assert.equal(scope.isWriteAllowed("GATE", testPath), false);
});

test("write-scope: a SOURCE path is writable ONLY in IMPLEMENT", () => {
  const srcPath = "src/feature/thing.ts";
  assert.equal(scope.isWriteAllowed("IMPLEMENT", srcPath), true);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", srcPath), false);
  assert.equal(scope.isWriteAllowed("CONFIRM_RED", srcPath), false);
  assert.equal(scope.isWriteAllowed("GATE", srcPath), false);
});

test("write-scope: a test path is NOT writable as source in IMPLEMENT (test author != code author)", () => {
  // The .test.ts matches both globs; it stays test-owned and is denied in IMPLEMENT.
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "src/x.test.ts"), false);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "src/x.test.ts"), true);
});

test("write-scope: an unmatched path is denied in every phase (fail-closed)", () => {
  const stray = "docs/readme.md";
  for (const p of ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT", "CONFIRM_GREEN", "GATE"] as const) {
    assert.equal(scope.isWriteAllowed(p, stray), false);
  }
});

test("write-scope: matches Windows backslash paths too", () => {
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "src\\feature\\thing.test.ts"), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "src\\feature\\thing.ts"), true);
});

test("globMatch: ** spans segments, * stays within a segment", () => {
  assert.equal(globMatch("src/**/*.ts", "src/a/b/c.ts"), true);
  assert.equal(globMatch("src/**/*.ts", "src/c.ts"), true);
  assert.equal(globMatch("src/*.ts", "src/a/b.ts"), false); // single * does not cross /
  assert.equal(globMatch("**/*.test.ts", "deep/nested/x.test.ts"), true);
  assert.equal(globMatch("src/**/*.ts", "other/c.ts"), false);
});

// ---- RecordingTestExecutor (the spine OBSERVES, the model never claims) ----

test("RecordingTestExecutor replays scripted observations and records each testId", async () => {
  const exec = new RecordingTestExecutor([RED, GREEN]);
  const o1 = await exec.run("alpha");
  const o2 = await exec.run("beta");

  assert.deepEqual(o1, RED);
  assert.deepEqual(o2, GREEN);
  assert.deepEqual(exec.observed, ["alpha", "beta"]);
});

test("RecordingTestExecutor rejects on over-run (never a silent green)", async () => {
  const exec = new RecordingTestExecutor([RED]);
  await exec.run("alpha");
  await assert.rejects(() => exec.run("beta"), /exhausted/);
});

/**
 * ADR-0590 D1: the test-writer's wall also admits the EXISTING test files the unit's scope named, as
 * concrete paths matched exactly rather than as globs.
 */
test("an existing test file the scope named is the test-writer's to write, and never the code-writer's", () => {
  const sibling = "packages/unit/src/sibling.test.ts";
  const scope = new PathWriteScope({
    testGlobs: ["packages/unit/src/unit.test.ts"],
    sourceGlobs: ["packages/unit/src/unit.ts"],
    existingTestFiles: [sibling],
  });

  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", sibling), true, "the test-writer may update it");
  assert.equal(
    scope.isWriteAllowed("IMPLEMENT", sibling),
    false,
    "the code-writer never writes a test — the widened set is a TEST path, so IMPLEMENT's !isTest term excludes it",
  );
  for (const phase of ["CONFIRM_RED", "CONFIRM_GREEN", "GATE"] as const) {
    assert.equal(scope.isWriteAllowed(phase, sibling), false, `${phase} is observe-only`);
  }

  // The unit's own declared globs are untouched by the widening.
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/unit/src/unit.test.ts"), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/unit/src/unit.ts"), true);
});

test("the widened set is EXACT — it admits the files it names and nothing shaped like them", () => {
  const scope = new PathWriteScope({
    testGlobs: [],
    sourceGlobs: [],
    existingTestFiles: ["packages/unit/src/sibling.test.ts"],
  });

  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/unit/src/sibling.test.ts"), true);
  // A list, not a glob: a file that did not exist when the scope was derived is NOT admitted, which is
  // what keeps the grant to EXISTING test files rather than to the whole package.
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/unit/src/brand-new.test.ts"), false);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/unit/src/nested/sibling.test.ts"), false);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/other/src/sibling.test.ts"), false);
  // Windows separators reach this predicate from the leaves; they must not miss the set.
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages\\unit\\src\\sibling.test.ts"), true);
});

test("a scope declaring no existing test files behaves exactly as it did before ADR-0590", () => {
  const scope = new PathWriteScope({
    testGlobs: ["packages/unit/src/**/*.test.ts"],
    sourceGlobs: ["packages/unit/src/unit.ts"],
  });

  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/unit/src/unit.test.ts"), true);
  assert.equal(scope.isWriteAllowed("AUTHOR_TEST", "packages/other/src/x.test.ts"), false);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/unit/src/unit.ts"), true);
  assert.equal(scope.isWriteAllowed("IMPLEMENT", "packages/unit/src/unit.test.ts"), false);
});
