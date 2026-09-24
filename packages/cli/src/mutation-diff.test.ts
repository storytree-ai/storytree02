import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { MIRRORS } from "./mirror-conformance.js";

import {
  concurrencyFor,
  isSpawnUatTest,
  type AdjudicatedMutant,
  adjudicateMutants,
  auditSuppressionDirectives,
  formatSuppressionAudit,
  parseSuppressionDirectives,
  changedLinesAreCodeFree,
  noChangedTestOutcome,
  isCodeFreeLine,
  isNarrowedToNothing,
  workspacePackageOf,
  declaredTestRoots,
  formatNarrowingLines,
  entryPointsFromCheckNames,
  entryPointsFromMirrorRegistry,
  entryPointsFromScripts,
  entryPointsFromShellScripts,
  formatMutationVerdict,
  isTestFile,
  isTimeout,
  unattributedTestFiles,
  type MutationReport,
  type MutationTarget,
  parseUnifiedDiffRanges,
  type ReportMutant,
  type ProjectDir,
  mergeMutationReports,
  type ReportPart,
  runnerFor,
  runsUnderBun,
  runsUnderVitest,
  selectMutationTargets,
  siblingTestFor,
  skipDisposition,
  referencesPackage,
  unquoteGitPath,
  unwitnessedTargets,
} from "./mutation-diff.js";

const PROJECTS: ProjectDir[] = [
  { name: "@storytree/cli", dir: "packages/cli" },
  { name: "@storytree/library", dir: "packages/library" },
  { name: "studio", dir: "apps/studio" },
];

// ── parseUnifiedDiffRanges ───────────────────────────────────────────────────

test("mutation-diff: a hunk with an explicit count yields that inclusive span", () => {
  const ranges = parseUnifiedDiffRanges(["+++ b/packages/cli/src/a.ts", "@@ -10,0 +12,3 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "packages/cli/src/a.ts", ranges: [{ start: 12, end: 14 }] }]);
});

test("mutation-diff: a hunk header with no count means exactly one line", () => {
  const ranges = parseUnifiedDiffRanges(["+++ b/packages/cli/src/a.ts", "@@ -10 +12 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "packages/cli/src/a.ts", ranges: [{ start: 12, end: 12 }] }]);
});

test("mutation-diff: a pure deletion (+n,0) contributes no range", () => {
  // There is no new-side line to mutate. Treating `+12,0` as a one-line span would put the line
  // BELOW the deletion in scope, which the branch did not touch.
  const ranges = parseUnifiedDiffRanges(["+++ b/packages/cli/src/a.ts", "@@ -10,4 +12,0 @@"].join("\n"));
  assert.deepEqual(ranges, []);
});

test("mutation-diff: a deleted file (/dev/null on the new side) contributes nothing", () => {
  const ranges = parseUnifiedDiffRanges(
    ["+++ /dev/null", "@@ -1,5 +0,0 @@", "+++ b/packages/cli/src/b.ts", "@@ -1 +1 @@"].join("\n"),
  );
  assert.deepEqual(ranges, [{ file: "packages/cli/src/b.ts", ranges: [{ start: 1, end: 1 }] }]);
});

test("mutation-diff: hunks before any +++ marker are ignored rather than mis-attributed", () => {
  const ranges = parseUnifiedDiffRanges(["@@ -1,2 +1,2 @@", "+++ b/packages/cli/src/a.ts", "@@ -5 +5 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "packages/cli/src/a.ts", ranges: [{ start: 5, end: 5 }] }]);
});

test("mutation-diff: adjacent and overlapping spans are merged into one", () => {
  const ranges = parseUnifiedDiffRanges(
    ["+++ b/packages/cli/src/a.ts", "@@ -1 +10,3 @@", "@@ -1 +13,2 @@", "@@ -1 +11,1 @@"].join("\n"),
  );
  // 10-12 and 13-14 are adjacent (13 === 12 + 1) and 11-11 is inside 10-12 — one span, not three.
  assert.deepEqual(ranges, [{ file: "packages/cli/src/a.ts", ranges: [{ start: 10, end: 14 }] }]);
});

test("mutation-diff: spans separated by a gap stay separate", () => {
  const ranges = parseUnifiedDiffRanges(
    ["+++ b/packages/cli/src/a.ts", "@@ -1 +10,2 @@", "@@ -1 +20,1 @@"].join("\n"),
  );
  assert.deepEqual(ranges, [
    { file: "packages/cli/src/a.ts", ranges: [{ start: 10, end: 11 }, { start: 20, end: 20 }] },
  ]);
});

test("mutation-diff: several files are reported separately and sorted by path", () => {
  const ranges = parseUnifiedDiffRanges(
    ["+++ b/packages/cli/src/z.ts", "@@ -1 +1 @@", "+++ b/packages/cli/src/a.ts", "@@ -1 +2 @@"].join("\n"),
  );
  assert.deepEqual(ranges.map((r) => r.file), ["packages/cli/src/a.ts", "packages/cli/src/z.ts"]);
});

test("mutation-diff: CRLF line endings parse identically to LF", () => {
  const ranges = parseUnifiedDiffRanges(["+++ b/packages/cli/src/a.ts\r", "@@ -10,0 +12,3 @@\r"].join("\n"));
  assert.deepEqual(ranges, [{ file: "packages/cli/src/a.ts", ranges: [{ start: 12, end: 14 }] }]);
});

// ── isTestFile ───────────────────────────────────────────────────────────────

test("mutation-diff: test files are recognised, source files are not", () => {
  assert.equal(isTestFile("packages/cli/src/a.test.ts"), true);
  assert.equal(isTestFile("packages/cli/src/a.e2e.test.ts"), true);
  assert.equal(isTestFile("packages/cli/src/a.ts"), false);
  assert.equal(isTestFile("packages/cli/src/testing.ts"), false);
});

// ── selectMutationTargets ────────────────────────────────────────────────────

const existing = (...files: string[]): ReadonlySet<string> => new Set(files);

test("mutation-diff: a changed source file becomes one glob per span, scoped to its project", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/a.ts", ranges: [{ start: 4, end: 6 }, { start: 20, end: 20 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/a.ts"),
  });
  assert.equal(selection.targets.length, 1);
  const target = selection.targets[0];
  assert.ok(target !== undefined);
  assert.equal(target.project, "@storytree/cli");
  assert.equal(target.dir, "packages/cli");
  assert.deepEqual(target.mutateGlobs, ["packages/cli/src/a.ts:20-20", "packages/cli/src/a.ts:4-6"]);
  assert.deepEqual(target.sourceFiles, ["packages/cli/src/a.ts"]);
  assert.equal(selection.skipReason, null);
});

test("mutation-diff: changed test files are collected, never mutated", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/src/a.test.ts", ranges: [{ start: 1, end: 9 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/a.ts", "packages/cli/src/a.test.ts"),
  });
  assert.deepEqual(selection.changedTestFiles, ["packages/cli/src/a.test.ts"]);
  assert.deepEqual(selection.targets[0]?.sourceFiles, ["packages/cli/src/a.ts"]);
});

test("mutation-diff: a file the branch DELETED is dropped, not handed to Stryker as a glob", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "packages/cli/src/gone.ts", ranges: [{ start: 1, end: 3 }] }],
    projects: PROJECTS,
    existingFiles: existing(),
  });
  assert.equal(selection.targets.length, 0);
  assert.ok(selection.skipReason !== null);
});

test("mutation-diff: a .ts file outside any project's src/ is dropped and the reason says so", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "packages/cli/scripts/tool.ts", ranges: [{ start: 1, end: 2 }] }],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/scripts/tool.ts"),
  });
  assert.equal(selection.targets.length, 0);
  assert.match(String(selection.skipReason), /outside any project's src\//);
  assert.match(String(selection.skipReason), /1 changed \.ts file/);
});

test("mutation-diff: declaration files and non-TypeScript files are never mutated", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/types.d.ts", ranges: [{ start: 1, end: 2 }] },
      { file: "packages/cli/src/data.json", ranges: [{ start: 1, end: 2 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/types.d.ts", "packages/cli/src/data.json"),
  });
  assert.equal(selection.targets.length, 0);
});

test("mutation-diff: a file outside every workspace project is dropped", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "scripts/root-tool.ts", ranges: [{ start: 1, end: 1 }] }],
    projects: PROJECTS,
    existingFiles: existing("scripts/root-tool.ts"),
  });
  assert.equal(selection.targets.length, 0);
});

test("mutation-diff: changes in two projects produce two targets, sorted by project name", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/library/src/b.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/src/a.ts", ranges: [{ start: 2, end: 2 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/library/src/b.ts", "packages/cli/src/a.ts"),
  });
  assert.deepEqual(selection.targets.map((t) => t.project), ["@storytree/cli", "@storytree/library"]);
});

test("mutation-diff: backslash paths are normalised before ownership is decided", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "packages\\cli\\src\\a.ts", ranges: [{ start: 1, end: 1 }] }],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/a.ts"),
  });
  assert.deepEqual(selection.targets[0]?.sourceFiles, ["packages/cli/src/a.ts"]);
});

// ── entryPointsFromScripts / the exemption ───────────────────────────────────

test("mutation-diff: a root script's -C dir is resolved, so the entry point is repo-relative", () => {
  const entries = entryPointsFromScripts({
    "check:thing": "pnpm -C packages/cli exec node --import ../../scripts/tsx-cache-off.mjs --import tsx src/check-thing.ts",
  });
  // Read as repo-relative, this would be `src/check-thing.ts` — a path that does not exist, so the
  // exemption would silently match nothing while appearing to work.
  assert.deepEqual(entries, ["packages/cli/src/check-thing.ts"]);
});

test("mutation-diff: a script with no -C keeps the path as written", () => {
  assert.deepEqual(entryPointsFromScripts({ x: "tsx scripts/tool.ts" }), ["scripts/tool.ts"]);
});

test("mutation-diff: non-.ts tokens and flags are not entry points", () => {
  const entries = entryPointsFromScripts({
    x: "node --import ../../scripts/tsx-cache-off.mjs --import tsx src/a.ts",
  });
  assert.deepEqual(entries, ["src/a.ts"]);
});

test("mutation-diff: several scripts naming the same file yield one entry", () => {
  const entries = entryPointsFromScripts({
    a: "pnpm -C packages/cli exec tsx src/x.ts",
    b: "pnpm -C packages/cli exec tsx src/x.ts",
  });
  assert.deepEqual(entries, ["packages/cli/src/x.ts"]);
});

test("mutation-diff: every file NAMED like a gate check is an entry point — live, retired or harness — and nothing else is (ADR-0606 D1)", () => {
  assert.deepEqual(
    entryPointsFromCheckNames([
      "packages/cli/src/check-process-graph.ts",
      "packages\\cli\\src\\check-boundaries.ts",
      "./packages/forest-world-r3f/harness/land-art-check.ts",
      "check-at-root.ts",
      "packages/cli/src/check-boundaries.test.ts",
      "packages/cli/src/gate-checks.ts",
      "packages/drive/src/uat-drive-witness.check.ts",
      "packages/cli/check-dir/lib.ts",
    ]),
    [
      "packages/cli/src/check-process-graph.ts",
      "packages/cli/src/check-boundaries.ts",
      "packages/forest-world-r3f/harness/land-art-check.ts",
      "check-at-root.ts",
    ],
  );
});

test("mutation-diff: the rung exempts check-named files among the ones it would mutate", () => {
  // The wiring, not the predicate: without it a branch touching a retired check aborts the whole
  // rung at the dry run, because the runner LOADS every target and a retired check runs its `main()`.
  const shell = readFileSync(new URL("./check-mutation-diff.ts", import.meta.url), "utf8");
  assert.match(shell, /exemptFiles: new Set\(\[[\s\S]*\.\.\.entryPointsFromCheckNames\(ranges\.map\(\(r\) => r\.file\)\),\s*\]\)/);
});

test("mutation-diff: the model-driven UAT executable is registered as a root entry point", () => {
  const rootPackage = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
  ) as { scripts?: Record<string, string> };

  assert.ok(rootPackage.scripts !== undefined);
  assert.ok(entryPointsFromScripts(rootPackage.scripts).includes("packages/drive/src/uat-drive.run.ts"));
});

test("mutation-diff: an exempt entry point is dropped from mutation and REPORTED", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/check-thing.ts", ranges: [{ start: 1, end: 40 }] },
      { file: "packages/cli/src/lib.ts", ranges: [{ start: 2, end: 3 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/check-thing.ts", "packages/cli/src/lib.ts"),
    exemptFiles: new Set(["packages/cli/src/check-thing.ts"]),
  });
  assert.deepEqual(selection.exempted, ["packages/cli/src/check-thing.ts"]);
  assert.deepEqual(selection.targets[0]?.sourceFiles, ["packages/cli/src/lib.ts"]);
});

test("mutation-diff: when ONLY entry points changed, the skip reason names them", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "packages/cli/src/check-thing.ts", ranges: [{ start: 1, end: 40 }] }],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/check-thing.ts"),
    exemptFiles: new Set(["packages/cli/src/check-thing.ts"]),
  });
  assert.equal(selection.targets.length, 0);
  assert.match(String(selection.skipReason), /executable entry points/);
  assert.match(String(selection.skipReason), /check-thing\.ts/);
});

test("mutation-diff: with no exemption set supplied, nothing is exempt", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "packages/cli/src/check-thing.ts", ranges: [{ start: 1, end: 4 }] }],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/check-thing.ts"),
  });
  assert.deepEqual(selection.exempted, []);
  assert.equal(selection.targets.length, 1);
});

test("mutation-diff: the sibling test of a source file follows the repo convention", () => {
  assert.equal(siblingTestFor("packages/cli/src/a.ts"), "packages/cli/src/a.test.ts");
  assert.equal(siblingTestFor("packages\\cli\\src\\a.ts"), "packages/cli/src/a.test.ts");
});

// ── adjudicateMutants ────────────────────────────────────────────────────────

/** A report where one mutant in `a.ts` is killed by the tests named. */
function reportWith(args: {
  status: string;
  killedBy?: string[];
  testFiles?: Record<string, string[]>;
}): MutationReport {
  const testFiles: Record<string, { tests: { id: string; name: string }[] }> = {};
  for (const [file, ids] of Object.entries(args.testFiles ?? {})) {
    testFiles[file] = { tests: ids.map((id) => ({ id, name: `${file} > case ${id}` })) };
  }
  return {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [
          {
            id: "m1",
            mutatorName: "ConditionalExpression",
            status: args.status,
            killedBy: args.killedBy ?? [],
            location: { start: { line: 12 } },
          },
        ],
      },
    },
    testFiles,
  };
}

test("mutation-diff: a mutant killed by THIS branch's changed test passes", () => {
  const verdict = adjudicateMutants(
    reportWith({ status: "Killed", killedBy: ["t1"], testFiles: { "packages/cli/src/a.test.ts": ["t1"] } }),
    ["packages/cli/src/a.test.ts"],
  );
  assert.equal(verdict.verdict, "pass");
  assert.equal(verdict.counted, 1);
  assert.equal(verdict.mutants[0]?.outcome, "proven");
  assert.deepEqual(verdict.reasons, []);
});

test("mutation-diff: a mutant killed ONLY by a test this branch did not touch fails", () => {
  const verdict = adjudicateMutants(
    reportWith({ status: "Killed", killedBy: ["t9"], testFiles: { "packages/cli/src/old.test.ts": ["t9"] } }),
    ["packages/cli/src/a.test.ts"],
  );
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.mutants[0]?.outcome, "killed-by-others");
  assert.match(verdict.reasons.join("\n"), /killed only by tests this branch did not touch/);
});

test("mutation-diff: a mutant killed by BOTH a new and an old test passes on the new one", () => {
  const verdict = adjudicateMutants(
    reportWith({
      status: "Killed",
      killedBy: ["t9", "t1"],
      testFiles: { "packages/cli/src/old.test.ts": ["t9"], "packages/cli/src/a.test.ts": ["t1"] },
    }),
    ["packages/cli/src/a.test.ts"],
  );
  assert.equal(verdict.verdict, "pass");
  assert.equal(verdict.mutants[0]?.outcome, "proven");
});

test("mutation-diff: constraint 4 — a Killed mutant with an EMPTY killedBy is unproven, not a pass", () => {
  const verdict = adjudicateMutants(
    reportWith({ status: "Killed", killedBy: [], testFiles: { "packages/cli/src/a.test.ts": ["t1"] } }),
    ["packages/cli/src/a.test.ts"],
  );
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
  assert.match(verdict.reasons.join("\n"), /UNPROVEN/);
});

test("mutation-diff: constraint 4 — a killedBy naming an id the report cannot resolve is unproven", () => {
  const verdict = adjudicateMutants(
    reportWith({ status: "Killed", killedBy: ["ghost"], testFiles: { "packages/cli/src/a.test.ts": ["t1"] } }),
    ["packages/cli/src/a.test.ts"],
  );
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
  assert.equal(verdict.verdict, "fail");
});

test("mutation-diff: a survivor fails", () => {
  const verdict = adjudicateMutants(reportWith({ status: "Survived" }), ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.mutants[0]?.outcome, "survived");
  assert.match(verdict.reasons.join("\n"), /SURVIVED/);
});

test("mutation-diff: an uncovered mutant fails and is reported distinctly from a survivor", () => {
  const verdict = adjudicateMutants(reportWith({ status: "NoCoverage" }), ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.mutants[0]?.outcome, "no-coverage");
  assert.match(verdict.reasons.join("\n"), /NO COVERAGE/);
});

test("mutation-diff: a Timeout names no test, so it is unproven rather than credited", () => {
  const verdict = adjudicateMutants(reportWith({ status: "Timeout" }), ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
  assert.equal(verdict.verdict, "fail");
});

// ── a coverage map that cannot be read ───────────────────────────────────────
//
// Measured 2026-09-12 and reproduced end to end: `@hughescr/stryker-bun-runner` pairs coverage
// buckets to tests POSITIONALLY and drops runtime-skipped tests from the test side only, so one
// `t.skip()` shifts every bucket after it and Stryker reports `Survived` for mutants a test kills.
// A false survivor is an unsatisfiable demand — ADR-0563 D1 forbids declining it and no test can
// satisfy it — so the rung must withdraw the verdict rather than assert it.

/** A `node:test`-shaped report: one real test file plus the pseudo-file an unpaired test lands in. */
function reportWithPseudoTestFile(status: string): MutationReport {
  return reportWith({ status, testFiles: { "packages/cli/src/a.test.ts": ["t1"], "node:test": ["t2"] } });
}

test("mutation-diff: a pseudo test file is the tell that the coverage map cannot be read", () => {
  assert.deepEqual(unattributedTestFiles(reportWithPseudoTestFile("Survived")), ["node:test"]);
});

test("mutation-diff: several pseudo files come back SORTED, not in report order", () => {
  // Three, inserted in an order no sort preserves, so neither "already sorted" nor a two-element
  // reversal can satisfy this — the report key order is the instrument's only other candidate and
  // it is not what the reason line should print.
  const report = reportWith({
    status: "Survived",
    testFiles: {
      "node:test": ["t1"],
      "packages/cli/src/a.test.ts": ["t2"],
      "bun:test": ["t3"],
      "file:///ghost": ["t4"],
    },
  });
  assert.deepEqual(unattributedTestFiles(report), ["bun:test", "file:///ghost", "node:test"]);
});

test("mutation-diff: the reason NAMES every pseudo file, quoted and comma-separated", () => {
  const verdict = adjudicateMutants(
    reportWith({
      status: "Survived",
      testFiles: { "node:test": ["t1"], "packages/cli/src/a.test.ts": ["t2"], "bun:test": ["t3"] },
    }),
    ["packages/cli/src/a.test.ts"],
  );
  // Two of them, so the separator is load-bearing: without it the line reads `"bun:test""node:test"`.
  assert.match(verdict.reasons.join("\n"), /attributed a test to "bun:test", "node:test", which is not a test file/);
});

test("mutation-diff: a report whose test files are all real test files is trusted", () => {
  const healthy = reportWith({
    status: "Survived",
    testFiles: { "packages/cli/src/a.test.ts": ["t1"], "packages/cli/src/b.test.tsx": ["t2"] },
  });
  assert.deepEqual(unattributedTestFiles(healthy), []);
});

test("mutation-diff: a Windows-separated sandbox path is a real test file, not a pseudo one", () => {
  const sandboxed = reportWith({
    status: "Survived",
    // Stryker keys `testFiles` by the SANDBOX's own path, and on Windows that arrives with
    // backslashes. Reading it raw would call every test file on this machine a pseudo-file and red
    // every branch — the false-green's mirror image, and just as wrong.
    testFiles: { "C:\\repo\\.stryker-tmp\\sandbox-8471\\packages\\cli\\src\\a.test.ts": ["t1"] },
  });
  assert.deepEqual(unattributedTestFiles(sandboxed), []);
});

test("mutation-diff: SURVIVED is withdrawn to unproven when the coverage map cannot be read", () => {
  const verdict = adjudicateMutants(reportWithPseudoTestFile("Survived"), ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
  // It still BLOCKS — the alternative is a rung that sends sessions to kill mutants it never tested.
  assert.match(verdict.reasons.join("\n"), /UNPROVEN — BROKEN COVERAGE MAP/);
  // The pseudo-file is named, because "the coverage map is broken" is unactionable without it.
  assert.match(verdict.reasons.join("\n"), /"node:test"/);
  // And it must NOT read as this branch's fault: the remedy is the runner, not another test.
  assert.match(verdict.reasons.join("\n"), /Nothing in this branch's tests can clear this/);
});

test("mutation-diff: NO COVERAGE is withdrawn too — it is the same reading of the same map", () => {
  const verdict = adjudicateMutants(reportWithPseudoTestFile("NoCoverage"), ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
  assert.match(verdict.reasons.join("\n"), /BROKEN COVERAGE MAP/);
});

test("mutation-diff: a broken map does NOT withdraw a kill — killedBy is matched by name, not by the map", () => {
  const verdict = adjudicateMutants(
    reportWith({
      status: "Killed",
      killedBy: ["t1"],
      testFiles: { "packages/cli/src/a.test.ts": ["t1"], "node:test": ["t2"] },
    }),
    ["packages/cli/src/a.test.ts"],
  );
  assert.equal(verdict.verdict, "pass");
  assert.equal(verdict.mutants[0]?.outcome, "proven");
});

test("mutation-diff: a withdrawn survivor is tallied apart from an unattributable kill", () => {
  const report: MutationReport = {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [
          { id: "m1", status: "Survived", location: { start: { line: 1 } } },
          { id: "m2", status: "Killed", killedBy: [], location: { start: { line: 2 } } },
        ],
      },
    },
    testFiles: {
      "packages/cli/src/a.test.ts": { tests: [{ id: "t1", name: "a > one" }] },
      "node:test": { tests: [{ id: "t2", name: "node:test > two" }] },
    },
  };
  const verdict = adjudicateMutants(report, ["packages/cli/src/a.test.ts"]);
  const reasons = verdict.reasons.join("\n");
  // Both are unproven and both block, but they want OPPOSITE remedies — one is the runner, the
  // other is attribution — so a single sentence counting 2 would send the reader the wrong way.
  assert.match(reasons, /1 mutant\(s\) are UNPROVEN — BROKEN COVERAGE MAP/);
  assert.match(reasons, /1 mutant\(s\) are UNPROVEN — killed, but the report named no test/);
});

test("mutation-diff: the render says which verdict was withdrawn, not 'no test named'", () => {
  const verdict = adjudicateMutants(reportWithPseudoTestFile("Survived"), ["packages/cli/src/a.test.ts"]);
  const body = formatMutationVerdict("[t]", verdict, [
    { project: "cli", dir: "packages/cli", mutateGlobs: ["packages/cli/src/a.ts:12-12"], sourceFiles: ["packages/cli/src/a.ts"] },
  ]);
  assert.match(body, /UNPROVEN .*recorded Survived, withdrawn/);
  assert.doesNotMatch(body, /— no test named/);
});

test("mutation-diff: a CompileError is excluded from the count, not scored either way", () => {
  const verdict = adjudicateMutants(reportWith({ status: "CompileError" }), ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.mutants[0]?.outcome, "excluded");
  assert.equal(verdict.counted, 0);
  // Every mutant excluded means nothing was actually proved — that is vacuous, never a pass.
  assert.equal(verdict.verdict, "vacuous");
});

test("mutation-diff: an empty report is vacuous, never a pass", () => {
  const verdict = adjudicateMutants({ files: {}, testFiles: {} }, ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.verdict, "vacuous");
  assert.equal(verdict.counted, 0);
  assert.match(verdict.reasons.join("\n"), /proved nothing/);
});

test("mutation-diff: a report missing files/testFiles entirely is vacuous rather than throwing", () => {
  const verdict = adjudicateMutants({}, []);
  assert.equal(verdict.verdict, "vacuous");
});

test("mutation-diff: the sandbox's absolute test path suffix-matches the repo-relative one", () => {
  // The sandbox segment (`.stryker-tmp/sandbox-8471`) changes every run; equality would never match.
  const verdict = adjudicateMutants(
    reportWith({
      status: "Killed",
      killedBy: ["t1"],
      testFiles: { "/repo/.stryker-tmp/sandbox-8471/packages/cli/src/a.test.ts": ["t1"] },
    }),
    ["packages/cli/src/a.test.ts"],
  );
  assert.equal(verdict.verdict, "pass");
  assert.equal(verdict.mutants[0]?.outcome, "proven");
});

test("mutation-diff: an AMBIGUOUS suffix credits nothing rather than guessing a file", () => {
  // Two sandbox paths both end in `a.test.ts`; crediting either would be a coin flip.
  const report: MutationReport = {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [{ id: "m1", mutatorName: "M", status: "Killed", killedBy: ["t1"], location: { start: { line: 1 } } }],
      },
    },
    testFiles: {
      "/sandbox/packages/cli/src/a.test.ts": { tests: [{ id: "t1", name: "x" }] },
      "/sandbox/packages/other/src/a.test.ts": { tests: [{ id: "t2", name: "y" }] },
    },
  };
  const verdict = adjudicateMutants(report, ["a.test.ts"]);
  assert.equal(verdict.mutants[0]?.outcome, "killed-by-others");
  assert.equal(verdict.verdict, "fail");
});

test("mutation-diff: coveredBy is NOT consulted — constraint 1", () => {
  // A mutant that SURVIVED while a changed test merely covered it must still fail. If the rung ever
  // read `coveredBy`, this would flip to a pass and credit a test that discriminates nothing.
  const report: MutationReport = {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [
          {
            id: "m1",
            mutatorName: "M",
            status: "Survived",
            killedBy: [],
            location: { start: { line: 3 } },
          },
        ],
      },
    },
    testFiles: { "packages/cli/src/a.test.ts": { tests: [{ id: "t1", name: "covers it" }] } },
  };
  const verdict = adjudicateMutants(report, ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.mutants[0]?.outcome, "survived");
});

test("mutation-diff: mixed outcomes count every failing class in the reasons", () => {
  const report: MutationReport = {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [
          { id: "1", status: "Killed", killedBy: ["t1"], location: { start: { line: 1 } } },
          { id: "2", status: "Survived", killedBy: [], location: { start: { line: 2 } } },
          { id: "3", status: "Killed", killedBy: [], location: { start: { line: 3 } } },
          { id: "4", status: "NoCoverage", killedBy: [], location: { start: { line: 4 } } },
          { id: "5", status: "CompileError", killedBy: [], location: { start: { line: 5 } } },
        ],
      },
    },
    testFiles: { "packages/cli/src/a.test.ts": { tests: [{ id: "t1", name: "n" }] } },
  };
  const verdict = adjudicateMutants(report, ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.counted, 4);
  assert.equal(verdict.reasons.length, 3);
});

// ── formatMutationVerdict ────────────────────────────────────────────────────

const TARGET: MutationTarget = {
  project: "@storytree/cli",
  dir: "packages/cli",
  mutateGlobs: ["packages/cli/src/a.ts:1-3"],
  sourceFiles: ["packages/cli/src/a.ts"],
};

test("mutation-diff: a pass renders the counts and says what was proved", () => {
  const verdict = adjudicateMutants(
    reportWith({ status: "Killed", killedBy: ["t1"], testFiles: { "packages/cli/src/a.test.ts": ["t1"] } }),
    ["packages/cli/src/a.test.ts"],
  );
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET]);
  assert.match(body, /1 changed source file\(s\), 1 changed line span\(s\), 1 mutant\(s\) counted/);
  assert.match(body, /PASS/);
});

test("mutation-diff: a failure names the offending mutant with its file, line and mutator", () => {
  const verdict = adjudicateMutants(reportWith({ status: "Survived" }), []);
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET]);
  assert.match(body, /SURVIVED packages\/cli\/src\/a\.ts:12 \[ConditionalExpression\]/);
  assert.match(body, /no test named/);
  assert.doesNotMatch(body, /PASS/);
});

test("mutation-diff: a failure caps the listing at 25 and says how many more there are", () => {
  const mutants = Array.from({ length: 31 }, (_, i) => ({
    id: String(i),
    mutatorName: "M",
    status: "Survived",
    killedBy: [] as string[],
    location: { start: { line: i + 1 } },
  }));
  const verdict = adjudicateMutants({ files: { "a.ts": { mutants } }, testFiles: {} }, []);
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET]);
  assert.equal(verdict.counted, 31);
  // 31 failing, 25 listed, so exactly 6 remain — an off-by-one here misreports the backlog.
  assert.match(body, /… and 6 more/);
  // Count the per-mutant LISTING lines only — the summary line names SURVIVED too.
  const listed = body.split("\n").filter((l) => l.startsWith("[mutation]   SURVIVED"));
  assert.equal(listed.length, 25);
});

test("mutation-diff: a failing mutant that WAS credited names the crediting file, not 'no test named'", () => {
  const verdict = adjudicateMutants(
    reportWith({ status: "Killed", killedBy: ["t9"], testFiles: { "packages/cli/src/old.test.ts": ["t9"] } }),
    ["packages/cli/src/a.test.ts"],
  );
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET]);
  assert.match(body, /killed by packages\/cli\/src\/old\.test\.ts/);
  assert.doesNotMatch(body, /no test named/);
});

test("mutation-diff: a mutant with no location renders the file alone, not 'file:null'", () => {
  const verdict = adjudicateMutants(
    { files: { "packages/cli/src/a.ts": { mutants: [{ id: "1", status: "Survived" }] } }, testFiles: {} },
    [],
  );
  assert.equal(verdict.mutants[0]?.line, null);
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET]);
  assert.match(body, /SURVIVED packages\/cli\/src\/a\.ts \[unknown\]/);
  assert.doesNotMatch(body, /null/);
});

test("mutation-diff: a Killed mutant with killedBy ABSENT (not just empty) is unproven", () => {
  const verdict = adjudicateMutants(
    { files: { "a.ts": { mutants: [{ id: "1", status: "Killed" }] } }, testFiles: {} },
    [],
  );
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
});

// ── the edges the first mutation run found unproven ──────────────────────────

test("mutation-diff: a .test.tsx file is a test file too", () => {
  // The `||` in isTestFile: without this case, dropping the second branch changes nothing.
  assert.equal(isTestFile("packages/cli/src/a.test.tsx"), true);
  assert.equal(isTestFile("packages/cli/src/a.tsx"), false);
});

test("mutation-diff: a diff path is normalised — leading ./ stripped and trailing space trimmed", () => {
  const ranges = parseUnifiedDiffRanges(["+++ b/./packages/cli/src/a.ts  ", "@@ -1 +3,2 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "packages/cli/src/a.ts", ranges: [{ start: 3, end: 4 }] }]);
});

test("mutation-diff: a +++ path without the b/ prefix is still read", () => {
  const ranges = parseUnifiedDiffRanges(["+++ packages/cli/src/a.ts", "@@ -1 +5 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "packages/cli/src/a.ts", ranges: [{ start: 5, end: 5 }] }]);
});

test("mutation-diff: only the LEADING b/ is stripped, never one deeper in the path", () => {
  const ranges = parseUnifiedDiffRanges(["+++ b/b/c.ts", "@@ -1 +1 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "b/c.ts", ranges: [{ start: 1, end: 1 }] }]);
});

test("mutation-diff: a malformed hunk header is skipped rather than parsed as line NaN", () => {
  const ranges = parseUnifiedDiffRanges(
    ["+++ b/a.ts", "@@ this is not a hunk @@", "@@ -1 +7 @@"].join("\n"),
  );
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 7, end: 7 }] }]);
});

test("mutation-diff: merging tie-breaks equal starts by end, so the widest span wins", () => {
  const ranges = parseUnifiedDiffRanges(
    ["+++ b/a.ts", "@@ -1 +10,1 @@", "@@ -1 +10,5 @@"].join("\n"),
  );
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 10, end: 14 }] }]);
});

test("mutation-diff: the LONGER project dir wins when one dir prefixes another", () => {
  // `packages/library` and `packages/library-store` both look plausible for a file under the latter.
  const nested: ProjectDir[] = [
    { name: "@storytree/library", dir: "packages/library" },
    { name: "@storytree/library-store", dir: "packages/library-store" },
  ];
  const selection = selectMutationTargets({
    changed: [{ file: "packages/library-store/src/a.ts", ranges: [{ start: 1, end: 1 }] }],
    projects: nested,
    existingFiles: existing("packages/library-store/src/a.ts"),
  });
  assert.equal(selection.targets[0]?.project, "@storytree/library-store");
});

test("mutation-diff: the skip reason reports BOTH drop causes when both occurred", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/scripts/tool.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/src/entry.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/scripts/tool.ts", "packages/cli/src/entry.ts"),
    exemptFiles: new Set(["packages/cli/src/entry.ts"]),
  });
  const reason = String(selection.skipReason);
  assert.match(reason, /outside any project's src\//);
  assert.match(reason, /executable entry points/);
  assert.match(reason, /;/);
});

test("mutation-diff: resolving an entry point collapses .. segments", () => {
  assert.deepEqual(entryPointsFromScripts({ x: "pnpm -C packages/cli exec tsx ../drive/src/a.ts" }), [
    "packages/drive/src/a.ts",
  ]);
});

test("mutation-diff: a -C flag with no following token does not crash or invent a base", () => {
  assert.deepEqual(entryPointsFromScripts({ x: "pnpm -C" }), []);
});

test("mutation-diff: entry points are returned sorted and de-duplicated across scripts", () => {
  const entries = entryPointsFromScripts({
    b: "tsx z.ts",
    a: "tsx a.ts",
    c: "tsx a.ts",
  });
  assert.deepEqual(entries, ["a.ts", "z.ts"]);
});

test("mutation-diff: an empty script set yields no entry points", () => {
  assert.deepEqual(entryPointsFromScripts({}), []);
});

test("mutation-diff: globs are emitted sorted, so the config is stable run to run", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/b.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/src/a.ts", ranges: [{ start: 9, end: 9 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/b.ts", "packages/cli/src/a.ts"),
  });
  assert.deepEqual(selection.targets[0]?.mutateGlobs, [
    "packages/cli/src/a.ts:9-9",
    "packages/cli/src/b.ts:1-1",
  ]);
  assert.deepEqual(selection.targets[0]?.sourceFiles, ["packages/cli/src/a.ts", "packages/cli/src/b.ts"]);
});

test("mutation-diff: one file changed twice contributes its name once", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/src/a.ts", ranges: [{ start: 9, end: 9 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/a.ts"),
  });
  assert.deepEqual(selection.targets[0]?.sourceFiles, ["packages/cli/src/a.ts"]);
  assert.equal(selection.targets[0]?.mutateGlobs.length, 2);
});

test("mutation-diff: changed test files are sorted", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/z.test.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/src/a.test.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/src/s.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing(
      "packages/cli/src/z.test.ts",
      "packages/cli/src/a.test.ts",
      "packages/cli/src/s.ts",
    ),
  });
  assert.deepEqual(selection.changedTestFiles, [
    "packages/cli/src/a.test.ts",
    "packages/cli/src/z.test.ts",
  ]);
});

test("mutation-diff: a test id with a non-string id is ignored rather than indexed as undefined", () => {
  const report: MutationReport = {
    files: {
      "a.ts": { mutants: [{ id: "1", status: "Killed", killedBy: ["t1"], location: { start: { line: 1 } } }] },
    },
    testFiles: { "packages/cli/src/a.test.ts": { tests: [{ name: "no id here" }] } },
  };
  const verdict = adjudicateMutants(report, ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
});

test("mutation-diff: a mutant file entry with no mutants array contributes nothing", () => {
  const verdict = adjudicateMutants({ files: { "a.ts": {} }, testFiles: {} }, []);
  assert.equal(verdict.verdict, "vacuous");
  assert.equal(verdict.mutants.length, 0);
});

// ── exact wording, so a mutated string literal cannot pass a loose regex ──────

test("mutation-diff: the summary counts line reads exactly as specified", () => {
  const verdict = adjudicateMutants(
    reportWith({ status: "Killed", killedBy: ["t1"], testFiles: { "packages/cli/src/a.test.ts": ["t1"] } }),
    ["packages/cli/src/a.test.ts"],
  );
  const lines = formatMutationVerdict("[mutation]", verdict, [TARGET]).split("\n");
  assert.equal(lines[0], "[mutation] 1 changed source file(s), 1 changed line span(s), 1 mutant(s) counted");
  assert.equal(
    lines[1],
    "[mutation] PASS — every mutant in this branch's changed lines was killed by this branch's own tests",
  );
  assert.equal(lines.length, 2);
});

test("mutation-diff: an uncredited failing line reads exactly as specified", () => {
  const verdict = adjudicateMutants(reportWith({ status: "Survived" }), []);
  const lines = formatMutationVerdict("[mutation]", verdict, [TARGET]).split("\n");
  assert.ok(
    lines.includes(
      "[mutation]   SURVIVED packages/cli/src/a.ts:12 [ConditionalExpression] — no test named",
    ),
    lines.join("\n"),
  );
  assert.ok(
    lines.includes(
      "[mutation] The rung asks only about the lines THIS branch changed. Strengthen this branch's own tests until each",
    ),
  );
  assert.ok(
    lines.includes(
      "[mutation] mutant above is caught, or record why the mutant is equivalent and cannot be killed.",
    ),
  );
});

test("mutation-diff: a credited failing line names the file exactly", () => {
  const verdict = adjudicateMutants(
    reportWith({ status: "Killed", killedBy: ["t9"], testFiles: { "packages/cli/src/old.test.ts": ["t9"] } }),
    ["packages/cli/src/a.test.ts"],
  );
  const lines = formatMutationVerdict("[mutation]", verdict, [TARGET]).split("\n");
  assert.ok(
    lines.includes(
      "[mutation]   KILLED-BY-OTHERS packages/cli/src/a.ts:12 [ConditionalExpression] — killed by packages/cli/src/old.test.ts",
    ),
    lines.join("\n"),
  );
});

test("mutation-diff: each failing-class summary line reads exactly as specified", () => {
  const report: MutationReport = {
    files: {
      "a.ts": {
        mutants: [
          { id: "1", status: "Survived", location: { start: { line: 1 } } },
          { id: "2", status: "NoCoverage", location: { start: { line: 2 } } },
          { id: "3", status: "Killed", killedBy: [], location: { start: { line: 3 } } },
          { id: "4", status: "Killed", killedBy: ["t9"], location: { start: { line: 4 } } },
        ],
      },
    },
    testFiles: { "old.test.ts": { tests: [{ id: "t9", name: "n" }] } },
  };
  const verdict = adjudicateMutants(report, ["a.test.ts"]);
  assert.deepEqual(verdict.reasons, [
    "1 mutant(s) SURVIVED — no test noticed the change",
    "1 mutant(s) had NO COVERAGE — no test reaches this line",
    "1 mutant(s) were killed only by tests this branch did not touch — the branch's own tests do not discriminate them",
    "1 mutant(s) are UNPROVEN — killed, but the report named no test (constraint 4: never a pass, never a survivor)",
  ]);
});

// ── UNPROVEN is two conditions, printed apart ─────────────────────────────────
//
// A Timeout (the covering tests ran past Stryker's per-mutant budget) and a Killed mutant nobody
// could be credited with want OPPOSITE remedies — the loop or the fixture for one, the attribution
// layer for the other. PR #1808's session read a 108-timeout wall through the attribution sentence
// and lost an hour; the tally and the per-mutant line now say which it is.

const TIMEOUT_REASON =
  "2 mutant(s) are UNPROVEN — TIMED OUT: the covering tests ran past Stryker's per-mutant budget, so either the mutant makes the suite hang or those tests are too slow for the budget on this machine; no test could be named (constraint 4: never a pass, never a survivor)";

function mixedUnprovenReport(): MutationReport {
  return {
    files: {
      "a.ts": {
        mutants: [
          { id: "1", status: "Timeout", location: { start: { line: 1 } } },
          { id: "2", status: "Killed", killedBy: [], location: { start: { line: 2 } } },
          { id: "3", status: "Timeout", location: { start: { line: 3 } } },
        ],
      },
    },
    testFiles: { "a.test.ts": { tests: [{ id: "t1", name: "n" }] } },
  };
}

test("mutation-diff: timed-out and unattributed UNPROVEN mutants are tallied on two lines, attribution first, each counting only its own", () => {
  const verdict = adjudicateMutants(mixedUnprovenReport(), ["a.test.ts"]);
  assert.deepEqual(verdict.reasons, [
    "1 mutant(s) are UNPROVEN — killed, but the report named no test (constraint 4: never a pass, never a survivor)",
    TIMEOUT_REASON,
  ]);
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.counted, 3);
});

test("mutation-diff: a run whose only UNPROVEN mutants timed out prints the timeout line alone — never a zero-count attribution line", () => {
  const report: MutationReport = {
    files: {
      "a.ts": {
        mutants: [
          { id: "1", status: "Timeout", location: { start: { line: 1 } } },
          { id: "2", status: "Timeout", location: { start: { line: 2 } } },
        ],
      },
    },
    testFiles: { "a.test.ts": { tests: [{ id: "t1", name: "n" }] } },
  };
  const verdict = adjudicateMutants(report, ["a.test.ts"]);
  assert.deepEqual(verdict.reasons, [TIMEOUT_REASON]);
});

test("mutation-diff: a run whose only UNPROVEN mutants are unattributed kills prints the attribution line alone", () => {
  const report: MutationReport = {
    files: {
      "a.ts": {
        mutants: [{ id: "1", status: "Killed", killedBy: [], location: { start: { line: 1 } } }],
      },
    },
    testFiles: { "a.test.ts": { tests: [{ id: "t1", name: "n" }] } },
  };
  const verdict = adjudicateMutants(report, ["a.test.ts"]);
  assert.deepEqual(verdict.reasons, [
    "1 mutant(s) are UNPROVEN — killed, but the report named no test (constraint 4: never a pass, never a survivor)",
  ]);
});

test("mutation-diff: a timed-out mutant's own line says it timed out; an unattributed kill still says 'no test named'", () => {
  const verdict = adjudicateMutants(mixedUnprovenReport(), ["a.test.ts"]);
  const lines = formatMutationVerdict("[mutation]", verdict, [{ ...TARGET, sourceFiles: ["a.ts"] }]).split("\n");
  assert.deepEqual(
    lines.filter((l) => l.includes("   UNPROVEN ")),
    [
      "[mutation]   UNPROVEN a.ts:1 [unknown] — timed out — no test could be named",
      "[mutation]   UNPROVEN a.ts:2 [unknown] — no test named",
      "[mutation]   UNPROVEN a.ts:3 [unknown] — timed out — no test could be named",
    ],
  );
});

test("mutation-diff: isTimeout reads the raw Stryker status, and only Timeout is one", () => {
  assert.equal(isTimeout({ status: "Timeout" }), true);
  assert.equal(isTimeout({ status: "Killed" }), false);
  assert.equal(isTimeout({ status: "Survived" }), false);
  assert.equal(isTimeout({ status: "timeout" }), false);
});

test("mutation-diff: the vacuous reason reads exactly as specified", () => {
  const verdict = adjudicateMutants({}, []);
  assert.deepEqual(verdict.reasons, [
    "source was selected for mutation but the report counted no mutants — the run proved nothing, which is not a pass",
  ]);
});

// ── exact skip reasons, one per drop cause ───────────────────────────────────

const SKIP_HEAD = "this branch changes no mutable source under a workspace project's src/";

test("mutation-diff: with no drop cause the skip reason is the bare sentence", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "packages/cli/src/gone.ts", ranges: [{ start: 1, end: 1 }] }],
    projects: PROJECTS,
    existingFiles: existing(),
  });
  assert.equal(selection.skipReason, SKIP_HEAD);
});

test("mutation-diff: the outside-src cause appends exactly one clause", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "packages/cli/scripts/t.ts", ranges: [{ start: 1, end: 1 }] }],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/scripts/t.ts"),
  });
  assert.equal(
    selection.skipReason,
    `${SKIP_HEAD} — 1 changed .ts file(s) sit outside any project's src/`,
  );
});

test("mutation-diff: the entry-point cause appends exactly one clause naming the file", () => {
  const selection = selectMutationTargets({
    changed: [{ file: "packages/cli/src/e.ts", ranges: [{ start: 1, end: 1 }] }],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/e.ts"),
    exemptFiles: new Set(["packages/cli/src/e.ts"]),
  });
  assert.equal(
    selection.skipReason,
    `${SKIP_HEAD} — 1 are executable entry points (packages/cli/src/e.ts)`,
  );
});

test("mutation-diff: two exempt files are listed sorted and comma-joined", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/z.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("packages/cli/src/z.ts", "packages/cli/src/a.ts"),
    exemptFiles: new Set(["packages/cli/src/z.ts", "packages/cli/src/a.ts"]),
  });
  assert.deepEqual(selection.exempted, ["packages/cli/src/a.ts", "packages/cli/src/z.ts"]);
  assert.equal(
    selection.skipReason,
    `${SKIP_HEAD} — 2 are executable entry points (packages/cli/src/a.ts, packages/cli/src/z.ts)`,
  );
});

// ── path resolution and tokenising edges ─────────────────────────────────────

test("mutation-diff: empty and '.' segments collapse when resolving an entry point", () => {
  assert.deepEqual(entryPointsFromScripts({ x: "pnpm -C packages//cli exec tsx ./src/./a.ts" }), [
    "packages/cli/src/a.ts",
  ]);
});

test("mutation-diff: '..' past the base does not escape into an empty prefix", () => {
  assert.deepEqual(entryPointsFromScripts({ x: "pnpm -C a exec tsx ../../b.ts" }), ["b.ts"]);
});

test("mutation-diff: runs of whitespace between tokens are collapsed, not treated as tokens", () => {
  assert.deepEqual(entryPointsFromScripts({ x: "  pnpm   -C   packages/cli   exec  tsx   src/a.ts  " }), [
    "packages/cli/src/a.ts",
  ]);
});

test("mutation-diff: a flag ending in .ts is not mistaken for an entry point", () => {
  assert.deepEqual(entryPointsFromScripts({ x: "tsx --thing=a.ts src/b.ts" }), ["src/b.ts"]);
});

test("mutation-diff: the sibling test path is built exactly, replacing only the final .ts", () => {
  assert.equal(siblingTestFor("packages/cli/src/a.ts.ts"), "packages/cli/src/a.ts.test.ts");
});

test("mutation-diff: a +++ line with extra spacing still yields the bare path", () => {
  const ranges = parseUnifiedDiffRanges(["+++    b/a.ts   ", "@@ -1 +2 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 2, end: 2 }] }]);
});

test("mutation-diff: a line that merely contains @@ but does not start with it is not a hunk", () => {
  const ranges = parseUnifiedDiffRanges(
    ["+++ b/a.ts", " code with @@ -1 +99,9 @@ inside it", "@@ -1 +4 @@"].join("\n"),
  );
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 4, end: 4 }] }]);
});

test("mutation-diff: a hunk header missing the +side is skipped", () => {
  const ranges = parseUnifiedDiffRanges(["+++ b/a.ts", "@@ -1,2 @@", "@@ -1 +6 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 6, end: 6 }] }]);
});

// ── ordering, which only an unsorted input with a tie can pin down ────────────

test("mutation-diff: out-of-order hunks with an equal start still merge correctly", () => {
  // Requires BOTH halves of the comparator: the primary start sort to bring 10,* together, and the
  // secondary end sort so the wider span is not swallowed by the narrower one.
  const ranges = parseUnifiedDiffRanges(
    ["+++ b/a.ts", "@@ -1 +20,1 @@", "@@ -1 +10,6 @@", "@@ -1 +10,3 @@"].join("\n"),
  );
  assert.deepEqual(ranges, [
    { file: "a.ts", ranges: [{ start: 10, end: 15 }, { start: 20, end: 20 }] },
  ]);
});

test("mutation-diff: three files come back in path order, not input order", () => {
  const ranges = parseUnifiedDiffRanges(
    [
      "+++ b/m.ts", "@@ -1 +1 @@",
      "+++ b/z.ts", "@@ -1 +1 @@",
      "+++ b/a.ts", "@@ -1 +1 @@",
    ].join("\n"),
  );
  assert.deepEqual(ranges.map((r) => r.file), ["a.ts", "m.ts", "z.ts"]);
});

test("mutation-diff: three projects come back in project-name order, not input order", () => {
  const many: ProjectDir[] = [
    { name: "@storytree/m", dir: "packages/m" },
    { name: "@storytree/z", dir: "packages/z" },
    { name: "@storytree/a", dir: "packages/a" },
  ];
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/m/src/x.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/z/src/x.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/a/src/x.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: many,
    existingFiles: existing("packages/m/src/x.ts", "packages/z/src/x.ts", "packages/a/src/x.ts"),
  });
  assert.deepEqual(selection.targets.map((t) => t.project), [
    "@storytree/a",
    "@storytree/m",
    "@storytree/z",
  ]);
});

test("mutation-diff: two crediting test files are reported in sorted order", () => {
  const verdict = adjudicateMutants(
    reportWith({
      status: "Killed",
      killedBy: ["t2", "t1"],
      testFiles: { "z.test.ts": ["t2"], "a.test.ts": ["t1"] },
    }),
    ["a.test.ts", "z.test.ts"],
  );
  assert.deepEqual(verdict.mutants[0]?.killedByFiles, ["a.test.ts", "z.test.ts"]);
});

// ── the listing cap boundary ─────────────────────────────────────────────────

function survivors(n: number): MutationReport {
  return {
    files: {
      "a.ts": {
        mutants: Array.from({ length: n }, (_, i) => ({
          id: String(i),
          mutatorName: "M",
          status: "Survived",
          location: { start: { line: i + 1 } },
        })),
      },
    },
    testFiles: {},
  };
}

test("mutation-diff: exactly 25 failing mutants are all listed with no 'and more' line", () => {
  const body = formatMutationVerdict("[m]", adjudicateMutants(survivors(25), []), [TARGET]);
  assert.equal(body.split("\n").filter((l) => l.startsWith("[m]   SURVIVED")).length, 25);
  assert.doesNotMatch(body, /and \d+ more/);
});

test("mutation-diff: 26 failing mutants list 25 and report exactly one more", () => {
  const body = formatMutationVerdict("[m]", adjudicateMutants(survivors(26), []), [TARGET]);
  assert.equal(body.split("\n").filter((l) => l.startsWith("[m]   SURVIVED")).length, 25);
  assert.match(body, /… and 1 more/);
});

test("mutation-diff: neither proven nor excluded mutants appear in the failure listing", () => {
  const report: MutationReport = {
    files: {
      "a.ts": {
        mutants: [
          { id: "p", mutatorName: "PROVEN", status: "Killed", killedBy: ["t1"], location: { start: { line: 1 } } },
          { id: "x", mutatorName: "EXCLUDED", status: "CompileError", location: { start: { line: 2 } } },
          { id: "s", mutatorName: "FAILING", status: "Survived", location: { start: { line: 3 } } },
        ],
      },
    },
    testFiles: { "a.test.ts": { tests: [{ id: "t1", name: "n" }] } },
  };
  const verdict = adjudicateMutants(report, ["a.test.ts"]);
  assert.equal(verdict.counted, 2);
  const body = formatMutationVerdict("[m]", verdict, [TARGET]);
  assert.match(body, /\[FAILING\]/);
  assert.doesNotMatch(body, /\[PROVEN\]/);
  assert.doesNotMatch(body, /\[EXCLUDED\]/);
});

test("mutation-diff: a mutant with no status at all is carried as Unknown and excluded", () => {
  const verdict = adjudicateMutants(
    { files: { "a.ts": { mutants: [{ id: "1", location: { start: { line: 1 } } }] } }, testFiles: {} },
    [],
  );
  assert.equal(verdict.mutants[0]?.status, "Unknown");
  assert.equal(verdict.mutants[0]?.outcome, "excluded");
});

test("mutation-diff: a non-string test id is not indexed, so it credits nothing", () => {
  // A real report is JSON off disk, so a numeric id arrives by PARSING rather than by asserting a
  // literal into the wrong type — which is also what the house rule against assertion chains wants.
  const report = JSON.parse(
    JSON.stringify({
      files: {
        "a.ts": { mutants: [{ id: "1", status: "Killed", killedBy: ["7"], location: { start: { line: 1 } } }] },
      },
      testFiles: { "a.test.ts": { tests: [{ id: 7, name: "numeric id" }] } },
    }),
  ) as MutationReport;
  const verdict = adjudicateMutants(report, ["a.test.ts"]);
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
});

test("mutation-diff: a huge line number that overflows to Infinity is skipped, not recorded", () => {
  const huge = "9".repeat(400);
  const ranges = parseUnifiedDiffRanges(["+++ b/a.ts", `@@ -1 +${huge},2 @@`, "@@ -1 +3 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 3, end: 3 }] }]);
});

// ── the last edges the mutation run left standing ────────────────────────────

test("mutation-diff: a -C at token index 0 is still found", () => {
  // `dirFlag >= 0` vs `> 0`: only a -C in first position separates them.
  assert.deepEqual(entryPointsFromScripts({ x: "-C packages/cli tsx src/a.ts" }), [
    "packages/cli/src/a.ts",
  ]);
});

test("mutation-diff: a trailing -C with no directory leaves the path repo-relative", () => {
  assert.deepEqual(entryPointsFromScripts({ x: "tsx src/a.ts -C" }), ["src/a.ts"]);
});

test("mutation-diff: only the FINAL .ts is replaced when a directory also ends in .ts", () => {
  assert.equal(siblingTestFor("packages/x.ts/a.ts"), "packages/x.ts/a.test.ts");
});

test("mutation-diff: a /dev/null section contributes nothing even when its hunk adds lines", () => {
  // A positive-count hunk under /dev/null is what separates "we skipped the file" from "we skipped
  // the hunk" — with a +n,0 hunk the two are indistinguishable.
  const ranges = parseUnifiedDiffRanges(
    ["+++ /dev/null", "@@ -1,5 +3,4 @@", "+++ b/a.ts", "@@ -1 +9 @@"].join("\n"),
  );
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 9, end: 9 }] }]);
});

test("mutation-diff: a b/ deeper in the path is not stripped — only a LEADING one is", () => {
  const ranges = parseUnifiedDiffRanges(["+++ a/b/c.ts", "@@ -1 +1 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "a/b/c.ts", ranges: [{ start: 1, end: 1 }] }]);
});

test("mutation-diff: a line that ENDS with @@ but does not start with it is not a hunk", () => {
  const ranges = parseUnifiedDiffRanges(
    ["+++ b/a.ts", "some trailing text @@", "@@ -1 +8 @@"].join("\n"),
  );
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 8, end: 8 }] }]);
});

test("mutation-diff: a multi-digit count on the MINUS side still parses", () => {
  const ranges = parseUnifiedDiffRanges(["+++ b/a.ts", "@@ -1,25 +7,2 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 7, end: 8 }] }]);
});

test("mutation-diff: an undefined testFiles entry is skipped rather than thrown on", () => {
  const report: MutationReport = {
    files: { "a.ts": { mutants: [{ id: "1", status: "Survived", location: { start: { line: 1 } } }] } },
    testFiles: { "gone.test.ts": undefined },
  };
  const verdict = adjudicateMutants(report, ["gone.test.ts"]);
  assert.equal(verdict.verdict, "fail");
  assert.equal(verdict.counted, 1);
});

test("mutation-diff: an undefined files entry is skipped rather than thrown on", () => {
  const verdict = adjudicateMutants({ files: { "a.ts": undefined }, testFiles: {} }, []);
  assert.equal(verdict.verdict, "vacuous");
  assert.equal(verdict.mutants.length, 0);
});

test("mutation-diff: a multi-digit count on the PLUS side still parses", () => {
  // `(?:,(\d+))?` vs `(?:,(\d))?`: only a two-digit added-line count separates them.
  const ranges = parseUnifiedDiffRanges(["+++ b/a.ts", "@@ -1 +7,12 @@"].join("\n"));
  assert.deepEqual(ranges, [{ file: "a.ts", ranges: [{ start: 7, end: 18 }] }]);
});

test("mutation-diff: the header counts every mutated file, not just the first", () => {
  const twoFiles: MutationTarget = {
    project: "@storytree/cli",
    dir: "packages/cli",
    mutateGlobs: ["packages/cli/src/a.ts:1-2", "packages/cli/src/b.ts:1-2"],
    sourceFiles: ["packages/cli/src/a.ts", "packages/cli/src/b.ts"],
  };
  const verdict = adjudicateMutants(reportWith({ status: "Survived" }), []);
  const body = formatMutationVerdict("[m]", verdict, [twoFiles]);
  assert.match(body, /^\[m\] 2 changed source file\(s\), 2 changed line span\(s\), 1 mutant\(s\) counted$/m);
});

test("mutation-diff: every reason is echoed into the rendered body, tagged", () => {
  const verdict = adjudicateMutants(reportWith({ status: "Survived" }), []);
  const body = formatMutationVerdict("[m]", verdict, [TARGET]);
  assert.ok(
    body.split("\n").includes("[m] 1 mutant(s) SURVIVED — no test noticed the change"),
    body,
  );
});

test("mutation-diff: two crediting files are joined with a comma and space in the body", () => {
  const verdict = adjudicateMutants(
    reportWith({
      status: "Killed",
      killedBy: ["t1", "t2"],
      testFiles: { "old-a.test.ts": ["t1"], "old-b.test.ts": ["t2"] },
    }),
    ["mine.test.ts"],
  );
  const body = formatMutationVerdict("[m]", verdict, [TARGET]);
  assert.match(body, /killed by old-a\.test\.ts, old-b\.test\.ts$/m);
});

test("mutation-diff: a location with no start reads as an unknown line, not a crash", () => {
  const verdict = adjudicateMutants(
    { files: { "a.ts": { mutants: [{ id: "1", status: "Survived", location: {} }] } }, testFiles: {} },
    [],
  );
  assert.equal(verdict.mutants[0]?.line, null);
});

// ── skipDisposition ─────────────────────────────────────────────────────────
//
// The rung's SKIP is the commonest outcome it has (a corpus, docs or config landing changes no
// mutable TypeScript), and the two runners that read it disagree about what a non-zero code means.
// `gate-run.ts` reads 3 as a declared SKIP and prints GATE GREEN, NARROWED; its CI mode (`pnpm gate
// --ci`, ADR-0606 D3) counts the same 3 as a hard failure. So the fact is
// stated either way and only the code differs — see `gate-skip-exit-3-is-local-only` in
// `check-web-experience-closure.ts`, whose bootstrap branch established this shape.

test("mutation-diff: locally a skip DECLARES itself with the gate's skip code", () => {
  assert.deepEqual(skipDisposition({ inCi: false, gateSkipExitCode: 3 }), {
    exitCode: 3,
    label: "SKIP",
  });
});

test("mutation-diff: in CI a skip exits 0 — a declared 3 there is read as a hard failure", () => {
  assert.deepEqual(skipDisposition({ inCi: true, gateSkipExitCode: 3 }), {
    exitCode: 0,
    label: "NOTHING TO MUTATE",
  });
});

test("mutation-diff: the skip code is the caller's, never re-declared here", () => {
  assert.equal(skipDisposition({ inCi: false, gateSkipExitCode: 7 }).exitCode, 7);
  // CI's zero is NOT the caller's code — it is the one branch that must not carry it.
  assert.equal(skipDisposition({ inCi: true, gateSkipExitCode: 7 }).exitCode, 0);
});

test("mutation-diff: the two dispositions never share a label — the runners must be told apart", () => {
  const local = skipDisposition({ inCi: false, gateSkipExitCode: 3 });
  const ci = skipDisposition({ inCi: true, gateSkipExitCode: 3 });
  assert.notEqual(local.label, ci.label);
  assert.notEqual(local.exitCode, ci.exitCode);
});

// ── noChangedTestOutcome ─────────────────────────────────────────────────────
//
// "This branch changed no test" is normally a RED, and must stay one — it is the rung's whole
// question. The single exception is a diff that adds no CODE: a landing that deletes a module and
// corrects the comment naming it selects its file (the selection is textual) while adding only
// comment lines, so there is no mutant for a test to kill. Before this fork the rung exited 1 on
// that state before it could ever reach the comment-only guard below, which made it unable to PASS
// a whole class of correct landings.

test("mutation-diff: no changed test with a CODE line changed is a hard fail", () => {
  const outcome = noChangedTestOutcome({
    changedLinesCodeFree: false,
    inCi: false,
    gateSkipExitCode: 3,
  });
  assert.deepEqual(outcome, { kind: "fail" });
});

test("mutation-diff: no changed test but a comment-only diff SKIPS — there is no mutant to kill", () => {
  const outcome = noChangedTestOutcome({
    changedLinesCodeFree: true,
    inCi: false,
    gateSkipExitCode: 3,
  });
  assert.deepEqual(outcome, { kind: "skip", exitCode: 3, label: "SKIP" });
});

test("mutation-diff: that skip obeys the SAME CI fork as every other — 0 and NOTHING TO MUTATE", () => {
  const outcome = noChangedTestOutcome({
    changedLinesCodeFree: true,
    inCi: true,
    gateSkipExitCode: 3,
  });
  assert.deepEqual(outcome, { kind: "skip", exitCode: 0, label: "NOTHING TO MUTATE" });
});

test("mutation-diff: the fail branch ignores CI and the skip code — a red is a red on both runners", () => {
  const local = noChangedTestOutcome({
    changedLinesCodeFree: false,
    inCi: false,
    gateSkipExitCode: 7,
  });
  const ci = noChangedTestOutcome({ changedLinesCodeFree: false, inCi: true, gateSkipExitCode: 7 });
  assert.deepEqual(local, { kind: "fail" });
  assert.deepEqual(ci, { kind: "fail" });
});

test("mutation-diff: the skip code is the caller's here too, never re-declared", () => {
  const outcome = noChangedTestOutcome({
    changedLinesCodeFree: true,
    inCi: false,
    gateSkipExitCode: 7,
  });
  assert.equal(outcome.kind, "skip");
  assert.equal(outcome.kind === "skip" ? outcome.exitCode : null, 7);
});

// ── runsUnderBun ─────────────────────────────────────────────────────────────
//
// The rung runs Stryker's bun test runner. A project whose own suite is `vitest run` needs a DOM
// environment the bun runner does not provide, so handing Stryker one kills the DRY RUN before a
// single mutant is tested — measured on the first branch to touch a `packages/forest-world` source
// file and an `apps/studio` snapshot in the same diff. These pin the discrimination, including the
// two shapes the real repo actually carries.

test("runsUnderBun: a plain bun suite is runnable", () => {
  assert.equal(runsUnderBun("bun test --timeout 300000 src/"), true);
});

test("runsUnderBun: a bun suite behind a chained prelude is still runnable", () => {
  // packages/cli's real script — a tsx guard, then the bun suite.
  assert.equal(
    runsUnderBun(
      "node --import ../../scripts/tsx-cache-off.mjs --import tsx scripts/validate-corpus.ts && bun test --preload ../../scripts/tsx-cache-off.mjs --timeout 300000 src/",
    ),
    true,
  );
});

test("runsUnderBun: a vitest project is not the BUN runner's — it is the vitest runner's", () => {
  // This assertion is unchanged in substance and changed in meaning. It used to be the whole story
  // (a vitest project was out of the rung's reach entirely); now it only says which of two runners
  // owns it. `runnerFor` below is what carries the reach.
  assert.equal(runsUnderBun("vitest run"), false);
});

test("runsUnderBun: a project with no test script is not runnable", () => {
  assert.equal(runsUnderBun(undefined), false);
});

test("runsUnderBun: a script that merely MENTIONS bun does not count as running bun test", () => {
  // The failure this guards is the opposite of the one above and just as quiet: matching too widely
  // would readmit exactly the projects the narrowing exists to exclude.
  assert.equal(runsUnderBun("echo use bun to run these && vitest run"), false);
  assert.equal(runsUnderBun("bunx vitest run"), false);
  assert.equal(runsUnderBun("vitest run --reporter=bun-tests"), false);
});

test("runsUnderBun: the boundary before `bun` is load-bearing, not decoration", () => {
  // A pattern that dropped the leading boundary would match any script whose text merely CONTAINS
  // the letters — and readmit the projects this narrowing exists to exclude.
  assert.equal(runsUnderBun("rebun test src/"), false);
  assert.equal(runsUnderBun("prebun  test"), false);
  assert.equal(runsUnderBun("pnpm exec bun test src/"), true);
  assert.equal(runsUnderBun("build.sh;bun test"), true);
});

test("runsUnderBun: the separator between `bun` and `test` must be whitespace", () => {
  assert.equal(runsUnderBun("bun test"), true);
  assert.equal(runsUnderBun("bun  test src/"), true);
  assert.equal(runsUnderBun("buntest src/"), false);
  assert.equal(runsUnderBun("bun-test src/"), false);
});

test("runsUnderBun: `bun test` must END a word — `bun tests` is a different command", () => {
  assert.equal(runsUnderBun("bun testing-helper.ts"), false);
  assert.equal(runsUnderBun("bun tests/"), false);
});

test("runsUnderBun: an empty script is not runnable", () => {
  assert.equal(runsUnderBun(""), false);
});

// ---------------------------------------------------------------------------
// Spawn-based acceptance legs are excluded from the mutation runner (2026-08-28)
// ---------------------------------------------------------------------------

test("concurrencyFor: one worker per PHYSICAL core, capped at 4, floored at 1", () => {
  // The two anchors the rule exists for, named rather than buried in a table: GitHub's 4-vCPU
  // runner has 2 physical cores and must drop to 2 (ADR-0509), while any 8-or-more-thread
  // developer box keeps the 4 the rung shipped with, so this cannot slow a local run down.
  assert.equal(concurrencyFor(4), 2, "GitHub's 4-vCPU runner: 2 physical cores, so 2 workers");
  assert.equal(concurrencyFor(12), 4, "a 12-thread box keeps the shipped 4 — the cap, not n/2");

  // EVERY region boundary, both sides. A remembered summary of this function said "4-7 -> 2",
  // which is wrong at 6 and 7; the table is the spec and the prose is not.
  assert.equal(concurrencyFor(1), 1, "floor: never 0, which would evaluate no mutants at all");
  assert.equal(concurrencyFor(2), 1);
  assert.equal(concurrencyFor(3), 1, "last input yielding 1");
  assert.equal(concurrencyFor(5), 2, "odd input floors down, not up");
  assert.equal(concurrencyFor(6), 3, "6 is 3, NOT 2 — the middle region is one wide per pair");
  assert.equal(concurrencyFor(7), 3);
  assert.equal(concurrencyFor(8), 4, "first input reaching the cap");
  assert.equal(concurrencyFor(64), 4, "the cap holds however large the machine");

  // The cap and the floor are SEPARATE claims: a mutant that swaps min for max, or drops either
  // clamp, has to change one of these two and not merely a mid-range value.
  assert.ok(concurrencyFor(64) < 64, "an unclamped n/2 would return 32 here");
  assert.ok(concurrencyFor(1) > 0, "an unclamped floor(n/2) would return 0 here");

  // Total by construction — a concurrency of 0 makes Stryker report success having run nothing,
  // so a nonsense reading of the CPU count must still land inside [1, 4].
  assert.equal(concurrencyFor(0), 1);
  assert.equal(concurrencyFor(-8), 1, "a negative reading floors to 1, never to a negative");
  assert.equal(concurrencyFor(Number.NaN), 1, "NaN is not finite: the guard returns 1");
  assert.equal(concurrencyFor(Number.POSITIVE_INFINITY), 1, "infinity is not finite either");
  assert.equal(concurrencyFor(9.9), 4, "a fractional reading still floors into a region");
});

test("isSpawnUatTest: a `.uat.test.ts` leg is excluded, an ordinary unit test is NOT", () => {
  // THE MEASURED REASON, so this is not read as taste. On clean `origin/main` at 785cc021, with a
  // one-line comment added to `terminal-capture.ts` and another to `terminal-capture.uat.test.ts`
  // purely to force this rung to select them, SIX legs of that UAT file failed Stryker's INITIAL DRY
  // RUN with `connect ECONNREFUSED 127.0.0.1:<port>` and the rung exited 1 having evaluated no mutant
  // at all. Those legs spawn the real CLI against a real fixture door started in `before` and killed
  // in `after`; Stryker's `perTest` analysis re-runs the suite and finds the door dead.
  assert.equal(isSpawnUatTest("packages/context-traversal-capture/src/terminal-capture.uat.test.ts"), true);
  assert.equal(isSpawnUatTest("packages/context-traversal-telemetry/src/orientation-runner-adapter.uat.test.ts"), true);

  // ⚠ THE NEGATIVE HALF IS THE POINT — it is what stops this becoming the curated opt-out list that
  // `entryPointsFromScripts` refuses by design. An ordinary unit test must stay IN the runner however
  // much a session might prefer it out; the only way to claim the exemption is to rename a file to
  // assert it is an acceptance leg, which is a visible lie rather than a quiet one.
  assert.equal(isSpawnUatTest("packages/cli/src/cli.test.ts"), false);
  assert.equal(isSpawnUatTest("packages/cli/src/mutation-diff.test.ts"), false);
  assert.equal(isSpawnUatTest("packages/context-traversal-capture/src/query-render.test.ts"), false);

  // Near misses, so the rule cannot be widened by an accident of naming: the suffix is exact, and a
  // file merely mentioning "uat" elsewhere in its path or stem is an ordinary test.
  assert.equal(isSpawnUatTest("packages/cli/src/uat-criteria.test.ts"), false);
  assert.equal(isSpawnUatTest("packages/cli/src/uat.test.ts.bak"), false);
  assert.equal(isSpawnUatTest("packages/uat/src/thing.test.ts"), false);
  assert.equal(isSpawnUatTest("packages/cli/src/thing.uat.ts"), false);
});

// ---------- entryPointsFromMirrorRegistry ----------

/**
 * The registry's probes are executable entry points that nothing imports. Unexempt, one of them in a
 * branch's changed set kills the WHOLE rung at Stryker's dry run — the instrumented module runs,
 * finds no fixture path in `process.argv`, and exits 2 — so the run reports `nothing was proved`
 * rather than a bad score. Measured 2026-08-29 on `traversal-panel-arc`'s desktop landing.
 */
test("entryPointsFromMirrorRegistry: both sides of every pair are exempt", () => {
  assert.deepEqual(
    entryPointsFromMirrorRegistry([
      { reference: { file: "apps/studio/server/xMirrorProbe.ts" }, mirror: { file: "apps/desktop/src/backend/x-mirror-probe.ts" } },
    ]),
    ["apps/desktop/src/backend/x-mirror-probe.ts", "apps/studio/server/xMirrorProbe.ts"],
  );
});

test("entryPointsFromMirrorRegistry: a probe shared by two rows is listed ONCE", () => {
  // Several rows may name one probe pair — `/api/traversal` covers three paths through one pair —
  // and a duplicate would make the printed exemption list read as more files than exist.
  const shared = { reference: { file: "a/ref.ts" }, mirror: { file: "b/mir.ts" } };
  assert.deepEqual(entryPointsFromMirrorRegistry([shared, shared]), ["a/ref.ts", "b/mir.ts"]);
});

test("entryPointsFromMirrorRegistry: paths are normalised, so a Windows-authored row still matches", () => {
  assert.deepEqual(
    entryPointsFromMirrorRegistry([
      { reference: { file: "apps\\studio\\server\\p.ts" }, mirror: { file: "apps/desktop/q.ts" } },
    ]),
    ["apps/desktop/q.ts", "apps/studio/server/p.ts"],
  );
});

test("entryPointsFromMirrorRegistry: an EMPTY registry exempts nothing rather than everything", () => {
  assert.deepEqual(entryPointsFromMirrorRegistry([]), []);
});

test("entryPointsFromMirrorRegistry: the REAL registry names probes, and they are the files it spawns", () => {
  const exempt = entryPointsFromMirrorRegistry(MIRRORS);
  assert.ok(exempt.length > 0, "an empty answer would silently un-exempt every probe");
  assert.equal(exempt.length, new Set(exempt).size);
  for (const file of exempt) {
    assert.match(file, /-mirror-probe\.ts$|MirrorProbe\.ts$/, `${file} is not a probe module`);
  }
});


// ── runsUnderVitest / runnerFor ──────────────────────────────────────────────
//
// The classifier that gave the rung its second runner. Before it, `apps/studio` and
// `packages/app-surface` — the repo's entire browser-facing surface — were reported as out of reach
// on every branch that touched them.

test("runsUnderVitest: a plain vitest suite is runnable", () => {
  assert.equal(runsUnderVitest("vitest run"), true);
});

test("runsUnderVitest: WATCH mode is not runnable — it would never terminate under Stryker", () => {
  assert.equal(runsUnderVitest("vitest"), false);
  assert.equal(runsUnderVitest("vitest --ui"), false);
});

test("runsUnderVitest: a bun suite is not vitest's", () => {
  assert.equal(runsUnderVitest("bun test --timeout 300000 src/"), false);
});

test("runsUnderVitest: a project with no test script is not runnable", () => {
  assert.equal(runsUnderVitest(undefined), false);
});

test("runsUnderVitest: a flag that merely CONTAINS the word does not make it a vitest suite", () => {
  // The word-boundary match is the point: `vitest-runner` is a plugin name, not an invocation.
  assert.equal(runsUnderVitest("node ./scripts/vitest-runner-check.mjs"), false);
});

test("runsUnderVitest: the invocation must START a word — `pnpm-vitest run` is a different binary", () => {
  // Pins the NEGATED half of the leading character class. With `[^\s&|;]` in its place the `-` here
  // would satisfy the boundary and this would read as a vitest project.
  assert.equal(runsUnderVitest("pnpm-vitest run"), false);
});

test("runsUnderVitest: a vitest suite behind a chained prelude is still runnable", () => {
  // Pins that the boundary class accepts WHITESPACE, not only the shell operators. The character
  // immediately before `vitest` is a space, so a class narrowed to `\S` would miss this entirely —
  // and every compound script in the repo has that shape.
  assert.equal(runsUnderVitest("tsc --noEmit && vitest run"), true);
});

test("runsUnderVitest: repeated whitespace between the binary and `run` still matches", () => {
  // Pins the `+`. With a single `\s` this is not a vitest project.
  assert.equal(runsUnderVitest("vitest  run"), true);
});

test("runsUnderVitest: flags after `run` do not stop it matching", () => {
  // Pins the TRAILING boundary as whitespace-or-end. With `\S` in its place, only a script whose
  // very last token is `run` would match, and `vitest run --coverage` would fall out of reach.
  assert.equal(runsUnderVitest("vitest run --coverage"), true);
});

test("runnerFor: the three real workspace shapes classify as bun, vitest, and out of reach", () => {
  assert.equal(runnerFor("bun test --timeout 300000 src/"), "bun");
  assert.equal(runnerFor("vitest run"), "vitest");
  // `packages/orchestrator`. A DECIDED exclusion — see `runnerFor`'s own doc comment.
  assert.equal(runnerFor('node --import tsx --test "src/**/*.test.ts"'), null);
  assert.equal(runnerFor(undefined), null);
});

test("runnerFor: a compound script that reaches bun is BUN, not out of reach", () => {
  // `packages/cli`'s own script. If this returned null the rung would stop covering the package
  // that contains the rung.
  assert.equal(
    runnerFor(
      "node --import ../../scripts/tsx-cache-off.mjs --import tsx scripts/validate-corpus.ts && bun test --preload ../../scripts/tsx-cache-off.mjs --timeout 300000 src/",
    ),
    "bun",
  );
});

// ── mergeMutationReports ─────────────────────────────────────────────────────

const partOf = (key: string, report: MutationReport): ReportPart => ({ key, report });

test("mergeMutationReports: colliding test ids across runs do NOT cross-attribute", () => {
  // THE LOAD-BEARING CASE, and the one a naive merge fails while still looking healthy. Stryker
  // numbers test ids from zero WITHIN each run, so both parts below declare a test `"0"` — in
  // different projects. Merged without namespacing, the second `"0"` overwrites the first, and the
  // bun mutant (killed only by an UNCHANGED cli test) resolves to the CHANGED studio test and is
  // scored `proven`. The rung would then pass a branch whose own tests killed nothing.
  const bun = partOf("bun", {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [{ id: "m1", status: "Killed", killedBy: ["0"], location: { start: { line: 4 } } }],
      },
    },
    testFiles: { "packages/cli/src/a.test.ts": { tests: [{ id: "0", name: "an old cli test" }] } },
  });
  const vitest = partOf("vitest:apps/studio", {
    files: {
      "apps/studio/src/b.ts": {
        mutants: [{ id: "m2", status: "Killed", killedBy: ["0"], location: { start: { line: 9 } } }],
      },
    },
    testFiles: { "apps/studio/src/b.test.ts": { tests: [{ id: "0", name: "a new studio test" }] } },
  });

  const merged = mergeMutationReports([bun, vitest]);

  // Both test files survive the merge, each with its own namespaced id.
  assert.deepEqual(merged.testFiles?.["packages/cli/src/a.test.ts"]?.tests, [
    { id: "bun::0", name: "an old cli test" },
  ]);
  assert.deepEqual(merged.testFiles?.["apps/studio/src/b.test.ts"]?.tests, [
    { id: "vitest:apps/studio::0", name: "a new studio test" },
  ]);

  // And each mutant still points at ITS OWN run's test.
  assert.deepEqual(merged.files?.["packages/cli/src/a.ts"]?.mutants?.[0]?.killedBy, ["bun::0"]);
  assert.deepEqual(merged.files?.["apps/studio/src/b.ts"]?.mutants?.[0]?.killedBy, [
    "vitest:apps/studio::0",
  ]);

  // The whole point, stated as the verdict rather than as the plumbing: only the studio test is
  // this branch's, so only the studio mutant is `proven` — the cli one is `killed-by-others`.
  const verdict = adjudicateMutants(merged, ["apps/studio/src/b.test.ts"]);
  const outcomes = Object.fromEntries(verdict.mutants.map((m) => [m.file, m.outcome]));
  assert.equal(outcomes["apps/studio/src/b.ts"], "proven");
  assert.equal(outcomes["packages/cli/src/a.ts"], "killed-by-others");
});

test("mergeMutationReports: the same file in two parts keeps BOTH sets of mutants", () => {
  // The driver partitions projects across runs, so this should not arise — but a merge that dropped
  // one side would lose evaluated mutants while still producing a well-formed report, which is the
  // silent direction. Duplication is visible; disappearance is not.
  const merged = mergeMutationReports([
    partOf("a", { files: { "x/src/f.ts": { mutants: [{ id: "1", status: "Survived" }] } } }),
    partOf("b", { files: { "x/src/f.ts": { mutants: [{ id: "2", status: "Killed", killedBy: ["0"] }] } } }),
  ]);
  assert.equal(merged.files?.["x/src/f.ts"]?.mutants?.length, 2);
});

test("mergeMutationReports: an unresolvable killedBy stays unresolvable — the merge repairs nothing", () => {
  // Constraint 4's arm. A `Killed` mutant naming an id no test file declares is NOT IDENTIFIABLE,
  // and namespacing must not accidentally launder it into a pass.
  const merged = mergeMutationReports([
    partOf("bun", {
      files: { "packages/cli/src/a.ts": { mutants: [{ id: "m", status: "Killed", killedBy: ["7"] }] } },
      testFiles: { "packages/cli/src/a.test.ts": { tests: [{ id: "0", name: "t" }] } },
    }),
  ]);
  const verdict = adjudicateMutants(merged, ["packages/cli/src/a.test.ts"]);
  assert.equal(verdict.mutants[0]?.outcome, "unproven");
});

test("mergeMutationReports: the same TEST FILE in two parts keeps both parts' tests", () => {
  // The `files` mirror of this is above. Both halves need it: if the testFiles branch OVERWROTE
  // instead of appending, one part's test ids would vanish from the id registry, and every mutant
  // those tests killed would resolve to nothing and be scored `unproven` — a red the branch cannot
  // act on, because the test it is being told to write already exists.
  const merged = mergeMutationReports([
    partOf("a", { testFiles: { "x/src/f.test.ts": { tests: [{ id: "0", name: "first" }] } } }),
    partOf("b", { testFiles: { "x/src/f.test.ts": { tests: [{ id: "0", name: "second" }] } } }),
  ]);
  assert.deepEqual(merged.testFiles?.["x/src/f.test.ts"]?.tests, [
    { id: "a::0", name: "first" },
    { id: "b::0", name: "second" },
  ]);
});

test("mergeMutationReports: a test entry with no id is carried through WITHOUT a branded id", () => {
  // `undefined` must not be branded into the string "a::undefined", which would enter the id
  // registry as a real-looking key and could be matched by a mutant's killedBy.
  const merged = mergeMutationReports([
    partOf("a", { testFiles: { "x/src/f.test.ts": { tests: [{ name: "no id" }] } } }),
  ]);
  assert.deepEqual(merged.testFiles?.["x/src/f.test.ts"]?.tests, [{ name: "no id" }]);
});

test("mergeMutationReports: an absent or empty entry is tolerated rather than throwing", () => {
  // Stryker emits `files`/`testFiles` keys whose value can be absent, and a report is read from
  // disk — so these shapes are input, not hypotheticals. A throw here would abort the rung with a
  // stack trace instead of a verdict.
  const merged = mergeMutationReports([
    partOf("a", {
      files: { "x/src/absent.ts": undefined, "x/src/empty.ts": {} },
      testFiles: { "x/src/absent.test.ts": undefined, "x/src/empty.test.ts": {} },
    }),
  ]);
  assert.deepEqual(merged.files?.["x/src/absent.ts"]?.mutants, []);
  assert.deepEqual(merged.files?.["x/src/empty.ts"]?.mutants, []);
  assert.deepEqual(merged.testFiles?.["x/src/absent.test.ts"]?.tests, []);
  assert.deepEqual(merged.testFiles?.["x/src/empty.test.ts"]?.tests, []);
});

test("mergeMutationReports: no parts yields an empty report, which adjudicates as VACUOUS not pass", () => {
  const merged = mergeMutationReports([]);
  assert.deepEqual(merged.files, {});
  assert.notEqual(adjudicateMutants(merged, []).verdict, "pass");
});

// ---------------------------------------------------------------------------------------------
// A COMMENT-ONLY CHANGE IS "NOTHING TO MUTATE", NOT A VACUOUS RUN.
//
// The classifier is crude on purpose and must fail toward CODE, so these assert BOTH directions on
// every branch: what it recognises as code-free, and — for each recogniser — a neighbouring line it
// must still call code. A recogniser mutated to match everything is caught by the code lines; one
// mutated to match nothing is caught by its own positive case.
// ---------------------------------------------------------------------------------------------

test("a blank, commented or JSDoc line carries no mutant", () => {
  assert.equal(isCodeFreeLine(""), true);
  // Whitespace-only: it must TRIM before comparing, or an indented comment reads as code.
  assert.equal(isCodeFreeLine("      "), true);
  assert.equal(isCodeFreeLine("// a line comment"), true);
  assert.equal(isCodeFreeLine("      // an INDENTED line comment"), true);
  assert.equal(isCodeFreeLine("/* a block opener"), true);
  assert.equal(isCodeFreeLine(" * a JSDoc continuation"), true);
  assert.equal(isCodeFreeLine(" */"), true);
});

test("and anything else is CODE — including a line that merely ENDS in a comment", () => {
  assert.equal(isCodeFreeLine("const x = 1;"), false);
  // ⚠ THE LOAD-BEARING ONE. If any prefix were mutated to the empty string, `startsWith` would
  // match every line and the whole rung would become skippable. A trailing comment is the line most
  // likely to be waved through by a classifier that looked for `//` anywhere rather than at the front.
  assert.equal(isCodeFreeLine("const x = 1; // and a trailing comment"), false);
  assert.equal(isCodeFreeLine("x /* inline */ = 2;"), false);
  assert.equal(isCodeFreeLine("void 0;"), false);
});

const SRC = ["// header", "const x = 1;", " * continuation", ""].join("\n");

test("a branch whose every changed line is comment or blank has nothing to mutate", () => {
  const ok = changedLinesAreCodeFree(
    [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] }],
    new Map([["packages/cli/src/a.ts", SRC]]),
  );
  assert.equal(ok, true);
  // A range that starts past the code line: proves the walk honours `start`, not line 1.
  assert.equal(
    changedLinesAreCodeFree(
      [{ file: "packages/cli/src/a.ts", ranges: [{ start: 3, end: 4 }] }],
      new Map([["packages/cli/src/a.ts", SRC]]),
    ),
    true,
  );
});

test("one changed line of code anywhere in the span is enough to refuse", () => {
  // Line 2 is the code, and it is the LAST line of the span — so a walk that stopped one short
  // would wrongly report "nothing to mutate".
  assert.equal(
    changedLinesAreCodeFree(
      [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 2 }] }],
      new Map([["packages/cli/src/a.ts", SRC]]),
    ),
    false,
  );
  // And line 2 alone, addressed exactly — a one-off in the index would read line 1 or line 3, both
  // of which are comments, and turn a real code change into a skip.
  assert.equal(
    changedLinesAreCodeFree(
      [{ file: "packages/cli/src/a.ts", ranges: [{ start: 2, end: 2 }] }],
      new Map([["packages/cli/src/a.ts", SRC]]),
    ),
    false,
  );
});

test("a file the caller could not read is never claimed as code-free", () => {
  // No sources at all: "I could not read them" is not "there was nothing in them", and the vacuous
  // verdict exists precisely so a run that proved nothing is not a pass.
  assert.equal(
    changedLinesAreCodeFree([{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] }], new Map()),
    false,
  );
  // A changed file that was not selected for mutation is not evidence either way — it is skipped,
  // and the selected file still decides.
  assert.equal(
    changedLinesAreCodeFree(
      [
        { file: "packages/cli/src/unselected.ts", ranges: [{ start: 1, end: 99 }] },
        { file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] },
      ],
      new Map([["packages/cli/src/a.ts", SRC]]),
    ),
    true,
  );
});

test("a span reaching past end-of-file is unaccounted-for, not blank", () => {
  // ⚠ THE SOURCE HERE IS ENTIRELY COMMENT, DELIBERATELY. Run against `SRC` this assertion passes
  // for the wrong reason — line 2 is code, so it refuses long before the span runs off the end and
  // the end-of-file guard is never reached at all. (Caught by the mutation rung: deleting the
  // guard left this green.) With nothing but comment ahead of it, the ONLY thing that can refuse
  // is the missing line, so the assertion is about the guard it names.
  const allComment = ["// one", "  // two", ""].join("\n");
  const sources = new Map([["packages/cli/src/a.ts", allComment]]);
  assert.equal(
    changedLinesAreCodeFree([{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 40 }] }], sources),
    false,
  );
  // ...and the same file, addressed within its own length, is code-free — so the refusal above is
  // the span overrunning and not the file's contents.
  assert.equal(
    changedLinesAreCodeFree([{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 3 }] }], sources),
    true,
  );
});

// ── declaredTestRoots + the narrowing report ─────────────────────────────────
//
// The rung's mutable root is a project's `src/`. Every file it drops for sitting outside one used
// to reach the reader through `skipReason` ALONE, which the driver prints only when NOTHING
// survived the narrowing — so the rung named its blind spot exactly when the blind spot had cost
// nothing, and went quiet the moment it cost something. Measured 2026-08-29 against the real check:
// a branch touching `apps/desktop/src/backend/reachDemo.ts` AND `apps/desktop/electron/
// static-server.ts` printed `1 changed source file(s)` and not one word about the second.

const DESKTOP_TEST_SCRIPT = "bun test --timeout 300000 src/ electron/";

test("declaredTestRoots: a project's own test script names its suite roots", () => {
  const roots = declaredTestRoots({
    testScript: DESKTOP_TEST_SCRIPT,
    isDirectory: (rel) => rel === "src" || rel === "electron",
  });
  assert.deepEqual(roots, ["electron/", "src/"]);
});

test("declaredTestRoots: a flag's VALUE is not a suite root — existence is the filter", () => {
  // `--timeout 300000` is the trap a "tokens that don't start with -" parse walks into, and any
  // denylist of runner words (`bun`, `test`, `vitest`, `run`, …) is a list that must be extended
  // every time a script changes shape. Nothing here is a directory, so nothing here is a root.
  const roots = declaredTestRoots({
    testScript: DESKTOP_TEST_SCRIPT,
    isDirectory: (rel) => rel === "electron",
  });
  assert.deepEqual(roots, ["electron/"]);
});

test("declaredTestRoots: `.`, `..` and escapes are refused even though they ARE directories", () => {
  // `bun test .` would otherwise declare the whole project one big suite root, which would make the
  // GAP report fire on every drop — reporting everything is the same as reporting nothing. The
  // `../` and `/` forms are refused for the neighbouring reason: a root outside the project is not
  // the project's declaration about itself.
  // isDirectory answers YES for exactly the refused token in each case, so nothing but the refusal
  // itself can account for the empty result.
  const yesTo = (want: string) => (rel: string) => rel === want;
  for (const token of [".", "..", "../x", "/etc"]) {
    assert.deepEqual(
      declaredTestRoots({ testScript: `bun test ${token}`, isDirectory: yesTo(token) }),
      [],
      `${token} must not become a suite root`,
    );
  }
});

test("declaredTestRoots: a trailing slash in the script names the same root", () => {
  // `bun test src/ electron/` is how the desktop app actually writes it, so the trailing slash is
  // the COMMON form rather than an edge case, and the roots it yields must be identical to the
  // bare form's — otherwise the classifier answers differently depending on typing style.
  const isDirectory = (rel: string) => rel === "src" || rel === "electron";
  assert.deepEqual(
    declaredTestRoots({ testScript: "bun test src/ electron/", isDirectory }),
    ["electron/", "src/"],
  );
  assert.deepEqual(
    declaredTestRoots({ testScript: "bun test src electron", isDirectory }),
    ["electron/", "src/"],
  );
});

test("declaredTestRoots: a NESTED root keeps its inner slashes — only the trailing ones go", () => {
  // The strip is anchored at the END on purpose. Un-anchor it and `src/backend/` collapses to
  // `srcbackend`, which names no directory, so the project's declaration silently vanishes — the
  // failure mode this whole change exists to stop, arriving through a typo in a regex.
  assert.deepEqual(
    declaredTestRoots({
      testScript: "bun test src/backend/ electron//",
      isDirectory: (rel) => rel === "src/backend" || rel === "electron",
    }),
    ["electron/", "src/backend/"],
  );
});

test("declaredTestRoots: tabs and runs of spaces separate tokens just as one space does", () => {
  assert.deepEqual(
    declaredTestRoots({
      testScript: "bun test\t--timeout   300000\n  src/",
      isDirectory: (rel) => rel === "src",
    }),
    ["src/"],
  );
});

test("declaredTestRoots: a project declaring no test script declares no roots", () => {
  assert.deepEqual(declaredTestRoots({ testScript: undefined, isDirectory: () => true }), []);
});

const DESKTOP_PROJECTS: ProjectDir[] = [
  ...PROJECTS,
  { name: "desktop", dir: "apps/desktop" },
];

test("mutation-diff: an outside-src/ drop is REPORTED even when other files ARE mutated", () => {
  // THE REGRESSION THIS PINS. With the report living only in `skipReason`, this selection returns
  // targets — so the reason is null, the driver never prints it, and the dropped file vanishes.
  const selection = selectMutationTargets({
    changed: [
      { file: "apps/desktop/src/backend/a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "apps/desktop/electron/static-server.ts", ranges: [{ start: 133, end: 133 }] },
    ],
    projects: DESKTOP_PROJECTS,
    existingFiles: existing(
      "apps/desktop/src/backend/a.ts",
      "apps/desktop/electron/static-server.ts",
    ),
  });
  assert.equal(selection.targets.length, 1, "the src/ file is still mutated");
  assert.equal(selection.skipReason, null, "and there is nothing to skip");
  assert.deepEqual(
    selection.narrowed.map((n) => n.file),
    ["apps/desktop/electron/static-server.ts"],
    "the dropped file is reported anyway — this is the whole repair",
  );
});

test("mutation-diff: a drop from a directory the project's OWN tests run is a declared-test-root GAP", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "apps/desktop/src/backend/a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "apps/desktop/electron/static-server.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: DESKTOP_PROJECTS,
    existingFiles: existing(
      "apps/desktop/src/backend/a.ts",
      "apps/desktop/electron/static-server.ts",
    ),
    testRootsByProject: new Map([["desktop", ["electron/", "src/"]]]),
  });
  const gap = selection.narrowed[0];
  assert.ok(gap !== undefined);
  assert.equal(gap.kind, "declared-test-root");
  assert.equal(gap.project, "desktop");
});

test("mutation-diff: a drop from a directory NOTHING tests stays the ordinary conservative drop", () => {
  // `packages/cli/scripts/` is the shape the src/ rule was designed around: no unit test is written
  // against it, its mutants would all survive, and redding an honest landing over them would be the
  // rung asking MORE than it can answer. This must NOT be reported as a gap, or the worse kind of
  // finding drowns in the ordinary kind.
  const selection = selectMutationTargets({
    changed: [
      { file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "packages/cli/scripts/tool.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: DESKTOP_PROJECTS,
    existingFiles: existing("packages/cli/src/a.ts", "packages/cli/scripts/tool.ts"),
    testRootsByProject: new Map([["@storytree/cli", ["src/"]]]),
  });
  const drop = selection.narrowed[0];
  assert.ok(drop !== undefined);
  assert.equal(drop.file, "packages/cli/scripts/tool.ts");
  assert.equal(drop.kind, "untested-root");
});

test("mutation-diff: with no test-root map every drop is still reported, just not classified", () => {
  const selection = selectMutationTargets({
    changed: [
      { file: "apps/desktop/src/backend/a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "apps/desktop/electron/static-server.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: DESKTOP_PROJECTS,
    existingFiles: existing(
      "apps/desktop/src/backend/a.ts",
      "apps/desktop/electron/static-server.ts",
    ),
  });
  assert.equal(selection.narrowed.length, 1, "completeness never depends on the optional map");
  assert.equal(selection.narrowed[0]?.kind, "untested-root");
});

test("formatNarrowingLines: a declared-test-root drop reads as a GAP, naming the file and project", () => {
  const [line] = formatNarrowingLines([
    { file: "apps/desktop/electron/static-server.ts", kind: "declared-test-root", project: "desktop" },
  ]);
  assert.ok(line !== undefined);
  assert.match(line, /NARROWED \(GAP\)/);
  assert.match(line, /apps\/desktop\/electron\/static-server\.ts/);
  assert.match(line, /desktop/);
  assert.match(line, /own test script runs that directory/);
});

test("formatNarrowingLines: an untested-root drop does NOT read as a gap", () => {
  // The two must stay distinguishable in the OUTPUT, not merely in the data. A `scripts/` drop
  // worded as a gap is a false alarm on every landing that touches one, and a rung that cries wolf
  // is read past — which returns the real gap to invisibility by a different route.
  const [line] = formatNarrowingLines([
    { file: "packages/cli/scripts/tool.ts", kind: "untested-root", project: "@storytree/cli" },
  ]);
  assert.ok(line !== undefined);
  assert.doesNotMatch(line, /GAP/);
  assert.match(line, /Dropped on purpose/);
  assert.match(line, /packages\/cli\/scripts\/tool\.ts/);
});

test("formatNarrowingLines: nothing narrowed prints nothing", () => {
  assert.deepEqual(formatNarrowingLines([]), []);
});

test("mutation-diff: several narrowed files are reported in a stable order", () => {
  // Order is not cosmetic here. This list is what a reader scans to find the file the rung did not
  // prove, and an order that shifts between runs makes two logs of the same branch look different.
  const selection = selectMutationTargets({
    changed: [
      { file: "apps/desktop/src/backend/a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "apps/desktop/electron/z-server.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "apps/desktop/electron/a-server.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: DESKTOP_PROJECTS,
    existingFiles: existing(
      "apps/desktop/src/backend/a.ts",
      "apps/desktop/electron/z-server.ts",
      "apps/desktop/electron/a-server.ts",
    ),
  });
  assert.deepEqual(
    selection.narrowed.map((n) => n.file),
    ["apps/desktop/electron/a-server.ts", "apps/desktop/electron/z-server.ts"],
  );
});

test("formatNarrowingLines: the GAP line says what the reader is being told, not just that it happened", () => {
  // The last sentence is the one that turns a fact into a consequence. Asserting only the `NARROWED
  // (GAP)` prefix would leave the sentence that explains the cost unpinned.
  const [line] = formatNarrowingLines([
    { file: "apps/desktop/electron/static-server.ts", kind: "declared-test-root", project: "desktop" },
  ]);
  assert.ok(line !== undefined);
  assert.match(line, /only mutates a project's src\//);
  assert.match(line, /Nothing on this branch proves those lines\./);
});

test("formatNarrowingLines: the ordinary line says the drop was deliberate, and why", () => {
  const [line] = formatNarrowingLines([
    { file: "packages/cli/scripts/tool.ts", kind: "untested-root", project: "@storytree/cli" },
  ]);
  assert.ok(line !== undefined);
  assert.match(line, /sits outside/);
  assert.match(line, /which no unit test is written against/);
  assert.match(line, /Dropped on purpose\./);
});

// ── production code the rung cannot mutate because of its EXTENSION ──────────
//
// Measured 2026-09-24: a branch changing only `apps/studio/src/components/Act2IntroControl.tsx`
// returned zero targets, NO narrowing, and the bare "changes no mutable source" skip — so the
// production file went unmutated with nothing printed to say so.

test("mutation-diff: a production .tsx under src/ is reported as an unmutated-extension narrowing", () => {
  const file = "apps/studio/src/components/Act2IntroControl.tsx";
  const selection = selectMutationTargets({
    changed: [{ file, ranges: [{ start: 1, end: 3 }] }],
    projects: PROJECTS,
    existingFiles: existing(file),
  });
  assert.deepEqual(selection.targets, [], "not admitted into mutation — that is a separate decision");
  assert.deepEqual(selection.narrowed, [{ file, kind: "unmutated-extension", project: "studio" }]);
  assert.equal(
    selection.skipReason,
    `${SKIP_HEAD} — 1 changed production .tsx/.mts/.cts file(s) under a project's src/ were NOT ` +
      "mutated — their extension is outside this rung's reach (only .ts is mutated)",
  );
});

test("mutation-diff: .mts and .cts under src/ narrow too; declarations and tests do not", () => {
  const files = [
    "packages/cli/src/a.mts",
    "packages/cli/src/b.cts",
    "packages/cli/src/c.d.mts",
    "packages/cli/src/d.d.cts",
    "packages/cli/src/e.test.mts",
    "packages/cli/src/f.test.cts",
  ];
  const selection = selectMutationTargets({
    changed: files.map((file) => ({ file, ranges: [{ start: 1, end: 1 }] })),
    projects: PROJECTS,
    existingFiles: existing(...files),
  });
  assert.deepEqual(
    selection.narrowed.map((n) => [n.file, n.kind]),
    [
      ["packages/cli/src/a.mts", "unmutated-extension"],
      ["packages/cli/src/b.cts", "unmutated-extension"],
    ],
  );
  assert.match(String(selection.skipReason), /2 changed production \.tsx\/\.mts\/\.cts file\(s\)/);
});

test("mutation-diff: a .test.tsx-only change produces no narrowing and the bare skip reason", () => {
  const file = "apps/studio/src/components/Act2IntroControl.test.tsx";
  const selection = selectMutationTargets({
    changed: [{ file, ranges: [{ start: 1, end: 1 }] }],
    projects: PROJECTS,
    existingFiles: existing(file),
  });
  assert.deepEqual(selection.narrowed, []);
  assert.deepEqual(selection.changedTestFiles, [file]);
  assert.equal(selection.skipReason, SKIP_HEAD);
});

test("mutation-diff: the unmutated-extension test reads the FINAL extension only — mid-name matches and non-code files do not narrow", () => {
  const files = [
    // Not code at all: no narrowing (pins the first guard and its `return false`).
    "packages/cli/src/notes.md",
    // `.tsx` mid-name but a different final extension: not a .tsx file (pins the first `$`).
    "packages/cli/src/view.tsx.snap",
    // Ends `.tsx`, merely CONTAINS `.d.cts` / `.test.mts` earlier: a production .tsx, so it narrows
    // (pins the `$` of the declaration and test exclusions).
    "packages/cli/src/x.d.cts.tsx",
    "packages/cli/src/y.test.mts.tsx",
  ];
  const selection = selectMutationTargets({
    changed: files.map((file) => ({ file, ranges: [{ start: 1, end: 1 }] })),
    projects: PROJECTS,
    existingFiles: existing(...files),
  });
  assert.deepEqual(
    selection.narrowed.map((n) => n.file),
    ["packages/cli/src/x.d.cts.tsx", "packages/cli/src/y.test.mts.tsx"],
  );
});

test("mutation-diff: a .tsx OUTSIDE src/ is not an unmutated-extension narrowing", () => {
  const file = "apps/studio/scripts/tool.tsx";
  const selection = selectMutationTargets({
    changed: [{ file, ranges: [{ start: 1, end: 1 }] }],
    projects: PROJECTS,
    existingFiles: existing(file),
  });
  assert.deepEqual(selection.narrowed, []);
  assert.equal(selection.skipReason, SKIP_HEAD);
});

test("mutation-diff: an unmutated-extension narrowing is reported alongside real targets", () => {
  // The narrowing must be visible on EVERY run, not only when nothing else was mutated.
  const selection = selectMutationTargets({
    changed: [
      { file: "apps/studio/src/a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "apps/studio/src/b.tsx", ranges: [{ start: 1, end: 1 }] },
    ],
    projects: PROJECTS,
    existingFiles: existing("apps/studio/src/a.ts", "apps/studio/src/b.tsx"),
  });
  assert.equal(selection.targets.length, 1);
  assert.equal(selection.skipReason, null);
  assert.deepEqual(selection.narrowed, [
    { file: "apps/studio/src/b.tsx", kind: "unmutated-extension", project: "studio" },
  ]);
});

test("formatNarrowingLines: an unmutated-extension line names the file, project and the extension reason", () => {
  const [line] = formatNarrowingLines([
    { file: "apps/studio/src/components/Act2IntroControl.tsx", kind: "unmutated-extension", project: "studio" },
  ]);
  assert.equal(
    line,
    "NARROWED: apps/studio/src/components/Act2IntroControl.tsx was NOT mutated — it is production " +
      "code under `studio`'s src/, but its extension is outside this rung's reach (only .ts is " +
      "mutated). Nothing on this branch proves those lines.",
  );
});


// ── the cross-package blind spot: a mutant no test in the run could witness ──
//
// Measured 2026-08-30 and proven end to end: Stryker's sandbox symlinks every `node_modules` it
// finds, so `<sandbox>/packages/cli/node_modules/@storytree/library` resolves to the REAL
// `packages/library/`. A sandboxed test importing a workspace sibling by package name loads the
// UNMUTATED original, and Stryker correctly reports that no test noticed — as `Survived`, this
// rung's most severe verdict, on a rung that blocks merges.

/** A report with mutants in `mutantFile` and one enumerated test file per entry of `testFiles`. */
function crossPackageReport(mutantFile: string, testFiles: readonly string[], status = "Survived"): MutationReport {
  const enumerated: Record<string, { tests: { id: string; name: string }[] }> = {};
  testFiles.forEach((file, i) => {
    enumerated[file] = { tests: [{ id: String(i), name: `${file} > case` }] };
  });
  return {
    files: {
      [mutantFile]: {
        mutants: [
          { id: "m1", mutatorName: "StringLiteral", status, killedBy: [], location: { start: { line: 166 } } },
        ],
      },
    },
    testFiles: enumerated,
  };
}

test("workspacePackageOf: a file under packages/ or apps/ names its package", () => {
  assert.equal(workspacePackageOf("packages/cli/src/a.ts"), "packages/cli");
  assert.equal(workspacePackageOf("apps/studio/src/lib/b.ts"), "apps/studio");
});

test("workspacePackageOf: a repo-root path belongs to no package", () => {
  assert.equal(workspacePackageOf("scripts/tool.ts"), null);
  assert.equal(workspacePackageOf("oxlint.config.ts"), null);
});

test("workspacePackageOf: the LAST match wins, so an enclosing directory cannot masquerade", () => {
  // Stryker's report keys are the sandbox's ABSOLUTE paths. Taking the first match would read a
  // checkout that happens to live under a directory called `packages` as a workspace package on
  // some machines and not others.
  assert.equal(
    workspacePackageOf("C:/dev/packages/checkout/.stryker-tmp/sandbox-Ab12/packages/library/src/x.ts"),
    "packages/library",
  );
});

test("workspacePackageOf: backslashes normalise, because git, the scan and Stryker disagree", () => {
  assert.equal(workspacePackageOf("packages\\cli\\src\\a.ts"), "packages/cli");
});

test("mutation-diff: a mutant whose package ran no test is UNWITNESSABLE, never SURVIVED", () => {
  const verdict = adjudicateMutants(
    crossPackageReport("packages/library/src/fixture/corpus.ts", ["packages/cli/src/cli.test.ts"]),
    ["packages/cli/src/cli.test.ts"],
  );
  assert.equal(verdict.mutants[0]?.outcome, "unwitnessable");
  assert.equal(verdict.counted, 0, "an unwitnessable mutant is not scored either way");
});

test("mutation-diff: the blind package is NAMED, with the reason, not silently dropped", () => {
  const verdict = adjudicateMutants(
    crossPackageReport("packages/library/src/fixture/corpus.ts", ["packages/cli/src/cli.test.ts"]),
    ["packages/cli/src/cli.test.ts"],
  );
  assert.equal(verdict.narrowings.length, 1);
  assert.match(verdict.narrowings[0] ?? "", /NARROWED \(BLIND\): packages\/library/);
  assert.match(verdict.narrowings[0] ?? "", /resolves workspace imports back out to the unmutated original/);
});

test("mutation-diff: a mutant whose own package DID run tests is scored as before", () => {
  // THE DISCRIMINATOR. Without this, the rule reads as "stop scoring survivors", which would turn a
  // rung that reds on a real gap into one that excuses it.
  const verdict = adjudicateMutants(
    crossPackageReport("packages/cli/src/friction.ts", ["packages/cli/src/friction.test.ts"]),
    ["packages/cli/src/friction.test.ts"],
  );
  assert.equal(verdict.mutants[0]?.outcome, "survived");
  assert.equal(verdict.verdict, "fail");
  assert.deepEqual(verdict.narrowings, []);
});

test("mutation-diff: one blind package does not excuse a survivor in a package that DID run", () => {
  const blind: MutationReport = {
    files: {
      "packages/cli/src/friction.ts": {
        mutants: [
          { id: "m1", mutatorName: "StringLiteral", status: "Survived", killedBy: [], location: { start: { line: 5 } } },
        ],
      },
      "packages/library/src/fixture/corpus.ts": {
        mutants: [
          { id: "m2", mutatorName: "StringLiteral", status: "Survived", killedBy: [], location: { start: { line: 166 } } },
        ],
      },
    },
    testFiles: { "packages/cli/src/friction.test.ts": { tests: [{ id: "0", name: "friction > case" }] } },
  };
  const verdict = adjudicateMutants(blind, ["packages/cli/src/friction.test.ts"]);
  assert.equal(verdict.verdict, "fail", "the cli survivor still reds");
  assert.equal(verdict.counted, 1, "and only the witnessable mutant is counted");
  assert.equal(verdict.narrowings.length, 1);
  assert.equal(
    isNarrowedToNothing(verdict),
    false,
    "a run that still counted something is not a run narrowed to nothing",
  );
});

test("mutation-diff: a report naming NO test file narrows nothing — cannot-tell is not no-tests", () => {
  // FAIL-SAFE, and the direction matters. Reading an empty enumeration as "no package ran tests"
  // would excuse EVERY mutant in the run — a rung that quietly stops redding, which is worse than
  // the false red this rule removes.
  const verdict = adjudicateMutants(crossPackageReport("packages/library/src/x.ts", []), []);
  assert.equal(verdict.mutants[0]?.outcome, "survived");
  assert.deepEqual(verdict.narrowings, []);
});

test("mutation-diff: a repo-root file is never called unwitnessable — nothing symlinks to it", () => {
  const verdict = adjudicateMutants(
    crossPackageReport("scripts/tool.ts", ["packages/cli/src/cli.test.ts"]),
    ["packages/cli/src/cli.test.ts"],
  );
  assert.equal(verdict.mutants[0]?.outcome, "survived");
  assert.deepEqual(verdict.narrowings, []);
});

test("isNarrowedToNothing: a run that counted nothing BECAUSE it was blind is a skip", () => {
  const verdict = adjudicateMutants(
    crossPackageReport("packages/library/src/fixture/corpus.ts", ["packages/cli/src/cli.test.ts"]),
    ["packages/cli/src/cli.test.ts"],
  );
  assert.equal(verdict.verdict, "vacuous");
  assert.equal(isNarrowedToNothing(verdict), true);
});

test("isNarrowedToNothing: an empty report is still the vacuous FAILURE, not a skip", () => {
  // The two ways to count nothing want opposite treatment: a bad glob or a sandbox that failed to
  // build must stay loud.
  const verdict = adjudicateMutants({ files: {}, testFiles: {} }, []);
  assert.equal(verdict.verdict, "vacuous");
  assert.equal(isNarrowedToNothing(verdict), false);
});

test("mutation-diff: a narrowing is printed on a PASS, where silence would read as full coverage", () => {
  const killed: MutationReport = {
    files: {
      "packages/cli/src/friction.ts": {
        mutants: [
          { id: "m1", mutatorName: "StringLiteral", status: "Killed", killedBy: ["0"], location: { start: { line: 5 } } },
        ],
      },
      "packages/library/src/fixture/corpus.ts": {
        mutants: [
          { id: "m2", mutatorName: "StringLiteral", status: "Survived", killedBy: [], location: { start: { line: 166 } } },
        ],
      },
    },
    testFiles: { "packages/cli/src/friction.test.ts": { tests: [{ id: "0", name: "friction > case" }] } },
  };
  const verdict = adjudicateMutants(killed, ["packages/cli/src/friction.test.ts"]);
  assert.equal(verdict.verdict, "pass");
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET]);
  assert.match(body, /NARROWED \(BLIND\): packages\/library/);
  assert.match(body, /PASS —/);
});

// ── a survivor names its SPAN, because file:line does not identify a mutant ──

/** One mutant with a full span and a replacement — the shape a real Stryker report carries. */
function spannedReport(args: {
  line: number;
  column: number;
  endColumn: number;
  replacement: string;
}): MutationReport {
  return {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [
          {
            id: "m1",
            mutatorName: "ConditionalExpression",
            status: "Survived",
            killedBy: [],
            replacement: args.replacement,
            location: {
              start: { line: args.line, column: args.column },
              end: { line: args.line, column: args.endColumn },
            },
          },
        ],
      },
      "packages/cli/src/x.test.ts": { mutants: [] },
    },
    testFiles: { "packages/cli/src/a.test.ts": { tests: [{ id: "0", name: "a > case" }] } },
  };
}

test("mutation-diff: a survivor carries its columns and its replacement through adjudication", () => {
  const verdict = adjudicateMutants(
    spannedReport({ line: 605, column: 7, endColumn: 32, replacement: "false" }),
    [],
  );
  const mutant = verdict.mutants[0];
  assert.equal(mutant?.column, 7);
  assert.equal(mutant?.endColumn, 32);
  assert.equal(mutant?.replacement, "false");
});

test("mutation-diff: a survivor line names the exact span, not just the line", () => {
  // THE FAULT THIS CLOSES. `packages/cli/src/friction.ts:605` carries three ConditionalExpression
  // mutants on three different spans; only the left operand survives, and the whole condition — the
  // one a reader reaches for — is killed. Printed without columns, all three read identically.
  const verdict = adjudicateMutants(
    spannedReport({ line: 605, column: 7, endColumn: 32, replacement: "false" }),
    [],
  );
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET]);
  assert.match(body, /SURVIVED packages\/cli\/src\/a\.ts:605:7-32 \[ConditionalExpression\] -> `false`/);
});

test("mutation-diff: given the source, the line quotes the ORIGINAL text beside the replacement", () => {
  const verdict = adjudicateMutants(
    spannedReport({ line: 1, column: 7, endColumn: 32, replacement: "false" }),
    [],
  );
  const sources = new Map([["packages/cli/src/a.ts", '  if (typeof d.doc !== "object" || d.doc === null) return {};']]);
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET], sources);
  assert.match(body, /`typeof d\.doc !== "object"` -> `false`/);
});

test("mutation-diff: the hand-check instruction is printed, because the wrong span disproves nothing", () => {
  const verdict = adjudicateMutants(
    spannedReport({ line: 1, column: 7, endColumn: 32, replacement: "false" }),
    [],
  );
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET]);
  assert.match(body, /replace EXACTLY the quoted span at those columns/);
});

test("mutation-diff: a span that runs past the line is not quoted — a truncation is not the mutant", () => {
  const verdict = adjudicateMutants(
    spannedReport({ line: 1, column: 7, endColumn: 400, replacement: "false" }),
    [],
  );
  const sources = new Map([["packages/cli/src/a.ts", "  if (a) return;"]]);
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET], sources);
  assert.match(body, /a\.ts:1:7-400 \[ConditionalExpression\] -> `false`/);
  assert.doesNotMatch(body, /`  if/);
});

test("mutation-diff: a source the caller did not supply degrades to columns, never to a guess", () => {
  const verdict = adjudicateMutants(
    spannedReport({ line: 1, column: 7, endColumn: 12, replacement: "false" }),
    [],
  );
  const body = formatMutationVerdict("[mutation]", verdict, [TARGET], new Map());
  assert.match(body, /a\.ts:1:7-12 \[ConditionalExpression\] -> `false`/);
});

test("workspacePackageOf: a trailing `packages/` names no package — an empty segment is not a name", () => {
  assert.equal(workspacePackageOf("packages/"), null);
  assert.equal(workspacePackageOf("apps/"), null);
});

test("mutation-diff: only WORKSPACE test paths count as a package having run", () => {
  // The set is built from `workspacePackageOf`, so a report enumerating only repo-root test paths
  // has answered nothing about any package — and must narrow nothing rather than narrow everything.
  const verdict = adjudicateMutants(crossPackageReport("packages/library/src/x.ts", ["scripts/root.test.ts"]), []);
  assert.equal(verdict.mutants[0]?.outcome, "survived");
  assert.deepEqual(verdict.narrowings, []);
});

test("mutation-diff: blind packages are named in a stable order, not report order", () => {
  const report: MutationReport = {
    files: {
      "packages/zeta/src/z.ts": {
        mutants: [{ id: "m1", mutatorName: "M", status: "Survived", killedBy: [], location: { start: { line: 1 } } }],
      },
      "packages/alpha/src/a.ts": {
        mutants: [{ id: "m2", mutatorName: "M", status: "Survived", killedBy: [], location: { start: { line: 1 } } }],
      },
    },
    testFiles: { "packages/cli/src/cli.test.ts": { tests: [{ id: "0", name: "cli > case" }] } },
  };
  const verdict = adjudicateMutants(report, []);
  assert.equal(verdict.narrowings.length, 2);
  assert.match(verdict.narrowings[0] ?? "", /packages\/alpha/);
  assert.match(verdict.narrowings[1] ?? "", /packages\/zeta/);
});

test("isNarrowedToNothing: SOME unwitnessable is not enough — the run must have counted nothing", () => {
  // A vacuous run mixing an EXCLUDED mutant with an UNWITNESSABLE one: `some` is true and `every` is
  // false, which is the pair that separates "nothing was counted" from "nothing was witnessable".
  const report: MutationReport = {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [
          { id: "m1", mutatorName: "M", status: "CompileError", killedBy: [], location: { start: { line: 1 } } },
        ],
      },
      "packages/library/src/b.ts": {
        mutants: [{ id: "m2", mutatorName: "M", status: "Survived", killedBy: [], location: { start: { line: 1 } } }],
      },
    },
    testFiles: { "packages/cli/src/a.test.ts": { tests: [{ id: "0", name: "a > case" }] } },
  };
  const verdict = adjudicateMutants(report, []);
  assert.equal(verdict.verdict, "vacuous");
  assert.equal(isNarrowedToNothing(verdict), true);
});

test("isNarrowedToNothing: a vacuous run with mutants but NO blind package stays a failure", () => {
  const report: MutationReport = {
    files: {
      "packages/cli/src/a.ts": {
        mutants: [
          { id: "m1", mutatorName: "M", status: "CompileError", killedBy: [], location: { start: { line: 1 } } },
        ],
      },
    },
    testFiles: { "packages/cli/src/a.test.ts": { tests: [{ id: "0", name: "a > case" }] } },
  };
  const verdict = adjudicateMutants(report, []);
  assert.equal(verdict.verdict, "vacuous");
  assert.equal(isNarrowedToNothing(verdict), false);
});

// ── the span render degrades honestly rather than guessing ──

/**
 * A MUTABLE {@link ReportMutant} the partial-span fixtures assemble field by field.
 *
 * Named rather than written inline, because an anonymous object type on a binding discards the
 * inference the house standard wants kept (`no-known-value-widening`), and mutable rather than
 * `ReportMutant` because these fixtures exist to build a report with a field left OUT.
 */
interface DraftMutant {
  id: string;
  mutatorName: string;
  status: string;
  killedBy: string[];
  replacement?: string;
  // NonNullable, not `ReportMutant["location"]`. Indexing an optional property yields the union WITH
  // `undefined`, and under `exactOptionalPropertyTypes` an optional property whose type includes
  // undefined is not assignable to one whose type does not — so the indexed form makes this draft
  // unassignable to the very interface it is a draft of.
  location?: MutantLocation;
}

/** A {@link ReportMutant} location with the optional-property `undefined` stripped off. */
type MutantLocation = NonNullable<ReportMutant["location"]>;

/**
 * One mutant with whatever parts of a span and a replacement the caller wants to supply.
 *
 * The two optional parts are ASSIGNED rather than conditionally spread: the whole point of these
 * cases is a report that OMITS a field, and `never-hide-omission-in-an-empty-spread` exists because
 * an empty-object spread makes the omission unreadable at the site that performs it.
 */
function partialSpanReport(location: MutantLocation | undefined, replacement?: string): MutationReport {
  const mutant: DraftMutant = {
    id: "m1",
    mutatorName: "ConditionalExpression",
    status: "Survived",
    killedBy: [],
  };
  if (replacement !== undefined) mutant.replacement = replacement;
  if (location !== undefined) mutant.location = location;
  return {
    files: { "packages/cli/src/a.ts": { mutants: [mutant] } },
    testFiles: { "packages/cli/src/a.test.ts": { tests: [{ id: "0", name: "a > case" }] } },
  };
}

/** The one failing line of a rendered verdict — the line a reader acts on. */
function failingLine(report: MutationReport, sources?: ReadonlyMap<string, string>): string {
  const verdict = adjudicateMutants(report, []);
  const rendered =
    sources === undefined
      ? formatMutationVerdict("[m]", verdict, [TARGET])
      : formatMutationVerdict("[m]", verdict, [TARGET], sources);
  // The per-mutant line, not the tally line above it — both carry the word SURVIVED.
  const line = rendered.split("\n").find((l) => l.startsWith("[m]   SURVIVED"));
  assert.ok(line !== undefined, rendered);
  return line;
}

test("mutation-diff: a mutant with no columns renders file:line, never file:line:null-null", () => {
  const line = failingLine(partialSpanReport({ start: { line: 12 } }, "false"));
  assert.match(line, /a\.ts:12 \[ConditionalExpression\] -> `false`/);
  assert.doesNotMatch(line, /null/);
});

test("mutation-diff: a start column without an end column is not half a span", () => {
  // Stryker emits both columns today, but `ReportMutant` declares every part optional because this
  // rung does not own that schema — so the degradation is a contract, and a contract is testable.
  const line = failingLine(partialSpanReport({ start: { line: 12, column: 7 } }, "false"));
  assert.match(line, /a\.ts:12 \[ConditionalExpression\]/);
  assert.doesNotMatch(line, /12:7/);
});

test("mutation-diff: an end column without a start column is not half a span either", () => {
  const line = failingLine(partialSpanReport({ start: { line: 12 }, end: { line: 12, column: 20 } }, "false"));
  assert.match(line, /a\.ts:12 \[ConditionalExpression\]/);
  assert.doesNotMatch(line, /null/);
});

test("mutation-diff: an incomplete span quotes nothing even when the source IS to hand", () => {
  // The pairing that matters: with no source there is nothing to quote either way, so only a run
  // that HAS the file can show that an incomplete span is declined rather than read at a guess.
  const line = failingLine(
    partialSpanReport({ start: { line: 1 } }, "false"),
    new Map([["packages/cli/src/a.ts", "const a = b;"]]),
  );
  assert.match(line, /a\.ts:1 \[ConditionalExpression\] -> `false`/);
  assert.doesNotMatch(line, /const/);
});

test("mutation-diff: an end column without a line is not a span either", () => {
  const line = failingLine(partialSpanReport({ start: { column: 7 }, end: { column: 20 } }, "false"));
  assert.match(line, /^\[m\]   SURVIVED packages\/cli\/src\/a\.ts \[ConditionalExpression\]/);
});

test("mutation-diff: a mutant the report gave no replacement for says so by omission", () => {
  const line = failingLine(partialSpanReport({ start: { line: 12, column: 7 }, end: { line: 12, column: 20 } }));
  assert.match(line, /a\.ts:12:7-20 \[ConditionalExpression\] — no test named/);
  assert.doesNotMatch(line, /->/);
});

test("mutation-diff: a span ending exactly at the end of its line is still quoted", () => {
  // The boundary the length guard is written against. `endColumn - 1 === line.length` is the LAST
  // legal span, so a guard that rejected it would silently stop quoting every end-of-line mutant.
  const source = "const a = b;";
  const line = failingLine(
    partialSpanReport({ start: { line: 1, column: 11 }, end: { line: 1, column: 13 } }, "c"),
    new Map([["packages/cli/src/a.ts", source]]),
  );
  assert.match(line, /`b;` -> `c`/);
});

test("mutation-diff: an empty span quotes nothing rather than an empty pair of backticks", () => {
  const line = failingLine(
    partialSpanReport({ start: { line: 1, column: 5 }, end: { line: 1, column: 5 } }, "c"),
    new Map([["packages/cli/src/a.ts", "const a = b;"]]),
  );
  assert.match(line, /a\.ts:1:5-5 \[ConditionalExpression\] -> `c`/);
  assert.doesNotMatch(line, /``/);
});

test("mutation-diff: a line number past the end of the supplied source quotes nothing", () => {
  const line = failingLine(
    partialSpanReport({ start: { line: 9, column: 1 }, end: { line: 9, column: 3 } }, "c"),
    new Map([["packages/cli/src/a.ts", "one line only"]]),
  );
  assert.match(line, /a\.ts:9:1-3 \[ConditionalExpression\] -> `c`/);
});

test("mutation-diff: a plain LF source splits into lines, not just a CRLF one", () => {
  // Sources arrive from `readFileSync` on whatever the checkout wrote. Splitting on CRLF alone
  // would collapse an LF file to one line, and every mutant past line 1 would stop being quoted.
  const line = failingLine(
    partialSpanReport({ start: { line: 2, column: 1 }, end: { line: 2, column: 4 } }, "zzz"),
    new Map([["packages/cli/src/a.ts", "first\nabc"]]),
  );
  assert.match(line, /`abc` -> `zzz`/);
});

test("mutation-diff: the hand-check instruction says WHY the wrong span proves nothing", () => {
  // Two sentences, and the second is the one that carries the reason. Pinning only the first would
  // leave the sentence that explains the fault free to be deleted.
  const lines = formatMutationVerdict(
    "[m]",
    adjudicateMutants(partialSpanReport({ start: { line: 1, column: 1 }, end: { line: 1, column: 2 } }, "x"), []),
    [TARGET],
  ).split("\n");
  assert.ok(
    lines.includes(
      "[m] To hand-check one, replace EXACTLY the quoted span at those columns: a line often carries several",
    ),
    lines.join("\n"),
  );
  assert.ok(
    lines.includes(
      "[m] mutants of one mutator, and replacing the wrong one disproves a mutant nobody reported.",
    ),
    lines.join("\n"),
  );
});

// ── entryPointsFromShellScripts — the third exemption source ─────────────────

test("entryPointsFromShellScripts: finds the .ts entry a shell script invokes, however it is quoted", () => {
  // The REAL shape, from `scripts/presence-hook.sh`: the path is a quoted assignment, later
  // interpolated. No package.json script names it, which is exactly why the other two derivations
  // cannot see it — and mutating it aborts the whole rung rather than merely scoring badly.
  const entries = entryPointsFromShellScripts([
    [
      'rel_tsx="packages/cli/node_modules/.bin/tsx"',
      'rel_entry="packages/cli/src/ambient-presence-entry.ts"',
      'exec "${rel_tsx}" "${rel_entry}" "$@"',
    ].join("\n"),
  ]);

  assert.deepEqual(entries, ["packages/cli/src/ambient-presence-entry.ts"]);
});

test("entryPointsFromShellScripts: the `tsx` BINARY is not mistaken for a .ts file", () => {
  // Without the word boundary this matches `.bin/tsx` and exempts a node_modules directory — a
  // silent widening of the exemption, which is the one direction this derivation must never fail in.
  assert.deepEqual(entryPointsFromShellScripts(['x="node_modules/.bin/tsx"']), []);
  assert.deepEqual(entryPointsFromShellScripts(["run tsx src/thing.tsx"]), []);
});

test("entryPointsFromShellScripts: a bare name with no directory is not a repo path", () => {
  // A word in a comment must not exempt a file that happens to share its name.
  assert.deepEqual(entryPointsFromShellScripts(["# see notes.ts for why"]), []);
  assert.deepEqual(entryPointsFromShellScripts(["# see ./src/notes.ts"]), ["src/notes.ts"]);
});

test("entryPointsFromShellScripts: dedupes and sorts across scripts, and an empty set is empty", () => {
  assert.deepEqual(entryPointsFromShellScripts([]), []);
  assert.deepEqual(
    entryPointsFromShellScripts([
      "node packages/cli/src/z.ts",
      "node packages/cli/src/z.ts\nnode packages/cli/src/a.ts",
    ]),
    ["packages/cli/src/a.ts", "packages/cli/src/z.ts"],
  );
});

// ── SUPPRESSION DIRECTIVES (`mutation-suppression-directive-announces-itself`) ────────────────────
//
// An inert `Stryker disable next-line` is invisible: Stryker emits no unused-directive diagnostic,
// and the comment that binds is textually identical to the one that does not. These pin the three
// answers the audit can give and, for the render, the WHOLE line rather than a phrase of it.

/** An adjudicated mutant, with only the fields the suppression audit reads set meaningfully. */
function mutantAt(args: {
  file: string;
  line: number;
  mutator: string;
  status: string;
}): AdjudicatedMutant {
  return {
    file: args.file,
    line: args.line,
    column: 1,
    endColumn: 2,
    mutator: args.mutator,
    status: args.status,
    outcome: args.status === "Ignored" ? "excluded" : "survived",
    replacement: null,
    killedByFiles: [],
  };
}

const SUPPRESSED_SOURCE = [
  "const a = 1;",
  "// Stryker disable next-line ConditionalExpression: EQUIVALENT — both arms agree.",
  "const b = a > 0 ? 1 : 1;",
].join("\n");

test("parseSuppressionDirectives reads the mutator list, the comment line and its target", () => {
  assert.deepEqual(parseSuppressionDirectives("packages/cli/src/a.ts", SUPPRESSED_SOURCE), [
    {
      file: "packages/cli/src/a.ts",
      line: 2,
      targetLine: 3,
      mutators: ["ConditionalExpression"],
    },
  ]);
});

test("parseSuppressionDirectives splits a comma list and keeps Stryker's `all` wildcard", () => {
  const source = [
    "// Stryker disable next-line ConditionalExpression,StringLiteral: EQUIVALENT",
    "x();",
    "// Stryker disable next-line all: EQUIVALENT — redundant with the filter below.",
    "y();",
    "/* Stryker disable next-line Regex: EQUIVALENT */",
    "z();",
  ].join("\n");
  assert.deepEqual(
    parseSuppressionDirectives("f.ts", source).map((d) => [d.line, d.targetLine, d.mutators]),
    [
      [1, 2, ["ConditionalExpression", "StringLiteral"]],
      [3, 4, ["all"]],
      [5, 6, ["Regex"]],
    ],
  );
});

test("parseSuppressionDirectives finds a directive written after a ternary arm", () => {
  // Two of this repo's live directives sit here, because that is where the expression they justify
  // begins. Anchoring the pattern at the start of the LINE rather than at the comment opener would
  // silently drop both, and dropping a directive means never auditing it.
  const source = ["const s = flag", "  ? // Stryker disable next-line StringLiteral: EQUIVALENT", '    "a"', '  : "b";'].join(
    "\n",
  );
  // The TARGET matters as much as the find, and this shape is the only one that can prove it. The
  // search for the bound node must start strictly BELOW the directive: here the directive's own
  // line carries code (the `?` arm), so a search that included it would bind the directive to
  // ITSELF — line 2 instead of line 3. On an ordinary whole-line `//` directive the two readings
  // agree, because that line is comment and gets skipped either way.
  assert.deepEqual(parseSuppressionDirectives("f.ts", source), [
    { file: "f.ts", line: 2, targetLine: 3, mutators: ["StringLiteral"] },
  ]);
});

test("parseSuppressionDirectives ignores PROSE that merely mentions a directive", () => {
  // Every one of these shapes is live in this repo — six files discuss their own directives, and
  // this module is one of them. A pattern that matched them would invent an `unmatched` finding for
  // every paragraph about the mechanism, which is worse than no audit: it teaches the reader to
  // stop reading the output.
  //
  // All four are rejected by the SAME clause, and it is the anchoring rather than the backticks:
  // `Stryker` has to be the first thing in the comment. The docstring lines never open a comment on
  // their own line at all, and the two `//` lines put other words first.
  const source = [
    " * Hoisted out of the chain below, because a `Stryker disable next-line` written inline",
    " * binds to nothing.",
    "// the comment `Stryker disable next-line ConditionalExpression` would not attach here",
    "// ⚠ ONE LINE ON PURPOSE: Stryker disable next-line binds to the NEXT LINE, so wrapping",
    "const real = 1;",
  ].join("\n");
  assert.deepEqual(parseSuppressionDirectives("f.ts", source), []);
});

test("parseSuppressionDirectives cannot tell a directive from prose that opens a comment with it", () => {
  // THE RESIDUAL FALSE POSITIVE, pinned so it is a known limit rather than a surprise. Nothing
  // distinguishes this from a real directive except meaning, and the mutator it captures is an
  // English word — so the audit reports one UNMATCHED line. It costs an advisory line and no more,
  // which is a large part of why this audit warns rather than reds.
  assert.deepEqual(
    parseSuppressionDirectives("f.ts", "// Stryker disable next-line binds to the NEXT line\nx();").map((d) => [
      d.line,
      d.mutators,
    ]),
    [[1, ["binds"]]],
  );
});

test("auditSuppressionDirectives counts a directive that really suppressed its mutant", () => {
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 3 }] }],
    mutants: [mutantAt({ file: "packages/cli/src/a.ts", line: 3, mutator: "ConditionalExpression", status: "Ignored" })],
  });
  assert.deepEqual(audit, { audited: 1, claims: 1, attached: 1, findings: [] });
});

test("auditSuppressionDirectives names an INERT directive — the friction's own shape", () => {
  // The measured failure: the directive is right there above the line, and the mutant is Survived.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 3 }] }],
    mutants: [
      mutantAt({ file: "packages/cli/src/a.ts", line: 3, mutator: "ConditionalExpression", status: "Survived" }),
    ],
  });
  assert.deepEqual(audit, {
    audited: 1,
    claims: 1,
    attached: 0,
    findings: [
      {
        file: "packages/cli/src/a.ts",
        line: 2,
        targetLine: 3,
        mutator: "ConditionalExpression",
        kind: "inert",
        statuses: ["Survived"],
      },
    ],
  });
});

test("auditSuppressionDirectives names an UNMATCHED directive separately from an inert one", () => {
  // A different mutator entirely on the target line: the directive suppresses nothing, but nothing
  // of ITS mutator is gating either. Conflating the two would send the reader to the wrong remedy.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 3 }] }],
    mutants: [mutantAt({ file: "packages/cli/src/a.ts", line: 3, mutator: "StringLiteral", status: "Survived" })],
  });
  assert.deepEqual(audit.findings.map((f) => [f.kind, f.mutator, f.statuses]), [
    ["unmatched", "ConditionalExpression", []],
  ]);
});

test("auditSuppressionDirectives judges `all` against every mutant on the target line", () => {
  const source = ["// Stryker disable next-line all: EQUIVALENT", "const b = x ?? y;"].join("\n");
  const changed = [{ file: "a.ts", ranges: [{ start: 1, end: 2 }] }];
  const attached = auditSuppressionDirectives({
    sources: new Map([["a.ts", source]]),
    changed,
    mutants: [
      mutantAt({ file: "a.ts", line: 2, mutator: "LogicalOperator", status: "Ignored" }),
      mutantAt({ file: "a.ts", line: 2, mutator: "ConditionalExpression", status: "Ignored" }),
    ],
  });
  assert.deepEqual([attached.claims, attached.attached, attached.findings.length], [1, 1, 0]);

  // One survivor is enough to make the wildcard inert: `all` claims the whole line.
  const partial = auditSuppressionDirectives({
    sources: new Map([["a.ts", source]]),
    changed,
    mutants: [
      mutantAt({ file: "a.ts", line: 2, mutator: "LogicalOperator", status: "Survived" }),
      mutantAt({ file: "a.ts", line: 2, mutator: "ConditionalExpression", status: "Survived" }),
    ],
  });
  assert.deepEqual(partial.findings.map((f) => [f.kind, f.mutator, f.statuses]), [["inert", "all", ["Survived"]]]);
});

test("auditSuppressionDirectives counts a comma list as one claim PER mutator", () => {
  const source = ["// Stryker disable next-line ConditionalExpression,StringLiteral: EQUIVALENT", "const b = 1;"].join(
    "\n",
  );
  const audit = auditSuppressionDirectives({
    sources: new Map([["a.ts", source]]),
    changed: [{ file: "a.ts", ranges: [{ start: 1, end: 2 }] }],
    mutants: [
      mutantAt({ file: "a.ts", line: 2, mutator: "ConditionalExpression", status: "Ignored" }),
      mutantAt({ file: "a.ts", line: 2, mutator: "StringLiteral", status: "Survived" }),
    ],
  });
  // ONE directive, TWO claims: half of it took and half did not, which a per-directive count could
  // not express at all.
  assert.deepEqual([audit.audited, audit.claims, audit.attached], [1, 2, 1]);
  assert.deepEqual(audit.findings.map((f) => [f.kind, f.mutator]), [["inert", "StringLiteral"]]);
});

test("auditSuppressionDirectives stays silent about lines this run never instrumented", () => {
  // The blind-spot rule. The directive is real and may well be inert, but its target line is
  // outside the changed spans, so the report holds no mutant for it BECAUSE THE RUNG NEVER ASKED.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] }],
    mutants: [mutantAt({ file: "packages/cli/src/a.ts", line: 1, mutator: "StringLiteral", status: "Killed" })],
  });
  assert.deepEqual(audit, { audited: 0, claims: 0, attached: 0, findings: [] });
});

test("auditSuppressionDirectives reads each file's OWN changed ranges, not the run's", () => {
  // Two files, two different hunks. `b.ts` has its line 3 changed and `a.ts` does not, so `a.ts`'s
  // directive is outside what this run instrumented and only `b.ts` may be judged. A lookup that
  // ignored WHICH file a hunk belongs to would audit both and accuse `a.ts` of a directive the run
  // never asked about.
  const mutantsOn = (file: string) => [
    mutantAt({ file, line: 3, mutator: "ConditionalExpression", status: "Survived" }),
  ];
  const audit = auditSuppressionDirectives({
    sources: new Map([
      ["a.ts", SUPPRESSED_SOURCE],
      ["b.ts", SUPPRESSED_SOURCE],
    ]),
    changed: [
      { file: "a.ts", ranges: [{ start: 1, end: 1 }] },
      { file: "b.ts", ranges: [{ start: 3, end: 3 }] },
    ],
    mutants: [...mutantsOn("a.ts"), ...mutantsOn("b.ts")],
  });
  assert.deepEqual([audit.audited, audit.findings.map((f) => f.file)], [1, ["b.ts"]]);
});

test("auditSuppressionDirectives stays silent about a file the run produced no mutant for", () => {
  // Narrowed away, or not mutable. Either way the absence is the instrument's, not the author's.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 3 }] }],
    mutants: [mutantAt({ file: "packages/cli/src/other.ts", line: 3, mutator: "ConditionalExpression", status: "Survived" })],
  });
  assert.deepEqual(audit, { audited: 0, claims: 0, attached: 0, findings: [] });
});

test("auditSuppressionDirectives matches Stryker's per-run sandbox path by suffix", () => {
  // The report's paths are absolute inside a sandbox directory whose name changes every run, so
  // equality alone finds nothing — the same trap `resolveTestFiles` carries one layer down.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 3 }] }],
    mutants: [
      mutantAt({
        file: "C:/code/storytree/.stryker-tmp/sandbox-91f2/packages/cli/src/a.ts",
        line: 3,
        mutator: "ConditionalExpression",
        status: "Ignored",
      }),
    ],
  });
  assert.deepEqual([audit.audited, audit.claims, audit.attached, audit.findings.length], [1, 1, 1, 0]);
});

test("auditSuppressionDirectives reports findings in a stable file order", () => {
  // THREE files, fed MIDDLE-OUT rather than reversed. A two-item case cannot distinguish a sort
  // from its own inverse under bun/JSC — a comparator forced to a constant reverses a two-element
  // input, which for reversed input IS the sorted answer. Three, with the middle one first, has no
  // such coincidence: input order, reversed input order and swapped order are all distinguishable
  // from `a, m, z`.
  const source = ["// Stryker disable next-line ConditionalExpression: EQUIVALENT", "const b = x ? 1 : 1;"].join("\n");
  const audit = auditSuppressionDirectives({
    sources: new Map([
      ["m.ts", source],
      ["a.ts", source],
      ["z.ts", source],
    ]),
    changed: ["m.ts", "a.ts", "z.ts"].map((file) => ({ file, ranges: [{ start: 1, end: 2 }] })),
    mutants: ["m.ts", "a.ts", "z.ts"].map((file) =>
      mutantAt({ file, line: 2, mutator: "ConditionalExpression", status: "Survived" }),
    ),
  });
  assert.deepEqual(audit.findings.map((f) => f.file), ["a.ts", "m.ts", "z.ts"]);
});

test("formatSuppressionAudit renders nothing when the run judged no directive", () => {
  assert.deepEqual(formatSuppressionAudit("[mutation-diff]", { audited: 0, claims: 0, attached: 0, findings: [] }), []);
});

test("formatSuppressionAudit renders the all-attached summary", () => {
  assert.deepEqual(
    formatSuppressionAudit("[mutation-diff]", { audited: 3, claims: 4, attached: 4, findings: [] }),
    ["[mutation-diff] suppression directives in the changed spans: 3 directive(s), 4 mutator claim(s), 4 attached"],
  );
});

test("formatSuppressionAudit renders an inert finding with the remedy", () => {
  assert.deepEqual(
    formatSuppressionAudit("[mutation-diff]", {
      audited: 1,
      claims: 1,
      attached: 0,
      findings: [
        {
          file: "packages/cli/src/a.ts",
          line: 40,
          targetLine: 41,
          mutator: "ConditionalExpression",
          kind: "inert",
          // TWO statuses, because one cannot prove the separator: `join(", ")` and `join("")` are
          // the same function on a single-element list, so a one-status fixture leaves the reader
          // with `NoCoverageSurvived` and nothing to fail.
          statuses: ["NoCoverage", "Survived"],
        },
      ],
    }),
    [
      "[mutation-diff] suppression directives in the changed spans: 1 directive(s), 1 mutator claim(s), 0 attached",
      "[mutation-diff]   INERT DIRECTIVE packages/cli/src/a.ts:40 disable next-line ConditionalExpression — " +
        "line 41 still carries a LIVE ConditionalExpression mutant (NoCoverage, Survived), so the directive bound to nothing. " +
        "A comment between the links of a chained expression attaches to no statement: extract the expression " +
        "into a named function and put the directive above its return.",
    ],
  );
});

test("formatSuppressionAudit renders an unmatched finding with its own remedy", () => {
  assert.deepEqual(
    formatSuppressionAudit("[mutation-diff]", {
      audited: 1,
      claims: 1,
      attached: 0,
      findings: [
        {
          file: "packages/cli/src/a.ts",
          line: 7,
          targetLine: 8,
          mutator: "Regex",
          kind: "unmatched",
          statuses: [],
        },
      ],
    }),
    [
      "[mutation-diff] suppression directives in the changed spans: 1 directive(s), 1 mutator claim(s), 0 attached",
      "[mutation-diff]   UNMATCHED DIRECTIVE packages/cli/src/a.ts:7 disable next-line Regex — line 8 carries " +
        "no Regex mutant at all, so this suppresses nothing. Either the code moved out from under it, or the " +
        "mutator name is not one Stryker emits here.",
    ],
  );
});

test("parseSuppressionDirectives accepts the irregular whitespace its pattern allows", () => {
  // EVERY whitespace class in the pattern is load bearing, and a fixture written with tidy single
  // spaces proves none of them: each `\s+` weakened to `\s` still matches tidy input, and so does
  // each `\s*` weakened to `\S*` when there is nothing there to match. So this fixture is
  // deliberately untidy — no space after the opener, doubled spaces between the words, and spaces
  // on BOTH sides of the comma — which is exactly the input each weakening stops accepting.
  assert.deepEqual(
    parseSuppressionDirectives("f.ts", "//Stryker  disable   next-line   ConditionalExpression , StringLiteral: why\nx();"),
    [{ file: "f.ts", line: 1, targetLine: 2, mutators: ["ConditionalExpression", "StringLiteral"] }],
  );
});

test("auditSuppressionDirectives looks only at the line the directive names", () => {
  // A directive on line 2 claims line 3 and nothing else. Line 5 carries a live mutant of the SAME
  // mutator; if the line filter went, that one would be found and the directive would read as
  // INERT when the honest answer is UNMATCHED — an accusation about a line nobody wrote it for.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 6 }] }],
    mutants: [
      mutantAt({ file: "packages/cli/src/a.ts", line: 5, mutator: "ConditionalExpression", status: "Survived" }),
    ],
  });
  assert.deepEqual(audit.findings.map((f) => [f.kind, f.mutator, f.statuses]), [
    ["unmatched", "ConditionalExpression", []],
  ]);
});

test("auditSuppressionDirectives reports the target line's statuses in a stable order", () => {
  // Fed in the order a report would NOT already be sorted in, so the sort is the thing under test
  // rather than the input's own tidiness: `Set` keeps insertion order, so without the sort this
  // comes back `Survived, NoCoverage`.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 3 }] }],
    mutants: [
      mutantAt({ file: "packages/cli/src/a.ts", line: 3, mutator: "ConditionalExpression", status: "Survived" }),
      mutantAt({ file: "packages/cli/src/a.ts", line: 3, mutator: "ConditionalExpression", status: "NoCoverage" }),
    ],
  });
  assert.deepEqual(audit.findings.map((f) => f.statuses), [["NoCoverage", "Survived"]]);
});

test("auditSuppressionDirectives calls a directive attached when it suppressed SOME of the line", () => {
  // ONE Ignored is attachment. A line commonly carries several mutants of one mutator on different
  // spans, and Stryker's directive takes the ones it binds to — requiring EVERY mutant on the line
  // to be Ignored would report a working directive as inert on that ordinary shape.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 3 }] }],
    mutants: [
      mutantAt({ file: "packages/cli/src/a.ts", line: 3, mutator: "ConditionalExpression", status: "Ignored" }),
      mutantAt({ file: "packages/cli/src/a.ts", line: 3, mutator: "ConditionalExpression", status: "Survived" }),
    ],
  });
  assert.deepEqual([audit.claims, audit.attached, audit.findings.length], [1, 1, 0]);
});

test("auditSuppressionDirectives merges the ranges of a file the diff reports twice", () => {
  // A unified diff emits one hunk per changed region, so one file arrives as several entries — and
  // the directive's target line may sit in the SECOND of them. Keeping only the last would silently
  // stop auditing everything in the first.
  const audit = auditSuppressionDirectives({
    sources: new Map([["packages/cli/src/a.ts", SUPPRESSED_SOURCE]]),
    changed: [
      { file: "packages/cli/src/a.ts", ranges: [{ start: 3, end: 3 }] },
      { file: "packages/cli/src/a.ts", ranges: [{ start: 1, end: 1 }] },
    ],
    mutants: [
      mutantAt({ file: "packages/cli/src/a.ts", line: 3, mutator: "ConditionalExpression", status: "Survived" }),
    ],
  });
  assert.deepEqual([audit.audited, audit.findings.length], [1, 1]);
});

test("parseSuppressionDirectives binds past the REST of a multi-line justification", () => {
  // ⚠ THE BUG THIS PINS WAS REAL, AND IT WAS IN THIS MODULE. `next-line` does not mean the next
  // line of the FILE — Stryker attaches the directive to the node its whole comment block leads.
  // A multi-line justification is the house style here (ADR-0478 asks for an adversarial one), so
  // `line + 1` would report almost every honest directive in this repo as suppressing nothing.
  //
  // Measured on this very file: comments on lines 1672 and 1727 produced `Ignored` mutants on 1675
  // and 1730. Blank lines inside the block are skipped for the same reason — they carry no node.
  const source = [
    "const a = 1;", //                                          1
    "// Stryker disable next-line ConditionalExpression: EQUIV", // 2  <- the directive
    "// both arms agree, because the ternary is only here for", //  3  <- still the block
    "//   readability and every input reaches the same value.", //  4  <- still the block
    "", //                                                         5  <- and a blank carries no node
    "const b = a > 0 ? 1 : 1;", //                                  6  <- what it really binds to
  ].join("\n");
  assert.deepEqual(parseSuppressionDirectives("f.ts", source), [
    { file: "f.ts", line: 2, targetLine: 6, mutators: ["ConditionalExpression"] },
  ]);
});

test("parseSuppressionDirectives aims past EOF when a directive leads no code at all", () => {
  // Left behind by a deletion. There is no node to bind to, so the honest answer is a target line
  // the report can hold no mutant for — which the audit then names as UNMATCHED. Aiming at line 0
  // (the other thing an absent index can mean) would instead read as the file's first line.
  assert.deepEqual(
    parseSuppressionDirectives("f.ts", ["x();", "// Stryker disable next-line Regex: stale", "// nothing below"].join("\n")),
    [{ file: "f.ts", line: 2, targetLine: 4, mutators: ["Regex"] }],
  );
});

test("auditSuppressionDirectives will not audit a line BELOW every changed range", () => {
  // The directive binds to line 3; this run instrumented lines 5-9 only. Without the lower bound,
  // line 3 reads as instrumented and the rung accuses a directive it never asked about.
  const audit = auditSuppressionDirectives({
    sources: new Map([["a.ts", SUPPRESSED_SOURCE]]),
    changed: [{ file: "a.ts", ranges: [{ start: 5, end: 9 }] }],
    mutants: [mutantAt({ file: "a.ts", line: 3, mutator: "ConditionalExpression", status: "Survived" })],
  });
  assert.deepEqual(audit, { audited: 0, claims: 0, attached: 0, findings: [] });
});

test("auditSuppressionDirectives accepts a line in ANY of one hunk's ranges", () => {
  // ONE entry carrying TWO ranges, with the target in the second. `some` is the whole claim here —
  // `every` would require line 3 to sit in the 1-1 range too, and silently stop auditing the file.
  const audit = auditSuppressionDirectives({
    sources: new Map([["a.ts", SUPPRESSED_SOURCE]]),
    changed: [
      {
        file: "a.ts",
        ranges: [
          { start: 1, end: 1 },
          { start: 3, end: 3 },
        ],
      },
    ],
    mutants: [mutantAt({ file: "a.ts", line: 3, mutator: "ConditionalExpression", status: "Survived" })],
  });
  assert.deepEqual([audit.audited, audit.findings.map((f) => f.kind)], [1, ["inert"]]);
});

// ── instrument-escape-repair-arc: the per-project witness (escape 11) and quoted paths (escape 12) ──

/** The adversarial pass's own two targets: an untested package and one that brought a test. */
const PROBE_UNTESTED: MutationTarget = {
  project: "@storytree/studio-members",
  dir: "packages/studio-members",
  mutateGlobs: ["packages/studio-members/src/zprobe.ts:1-3"],
  sourceFiles: ["packages/studio-members/src/zprobe.ts"],
};
const PROBE_TESTED: MutationTarget = {
  project: "@storytree/notice-board",
  dir: "packages/notice-board",
  mutateGlobs: ["packages/notice-board/src/xprobe.ts:1-3"],
  sourceFiles: ["packages/notice-board/src/xprobe.ts"],
};
const XPROBE_TEST = 'import { xprobe } from "./xprobe.js";';

test("mutation-diff: an untested package is NOT witnessed by another package's test in the same run (the seeded fault)", () => {
  // Run 2 of the probe: studio-members' new code has no test, notice-board's has one. The group check
  // passed on notice-board's test and the run printed PASS over seven NoCoverage mutants.
  const own = new Map<MutationTarget, string[]>([
    [PROBE_UNTESTED, []],
    [PROBE_TESTED, ["packages/notice-board/src/xprobe.test.ts"]],
  ]);
  const unwitnessed = unwitnessedTargets({
    targets: [PROBE_UNTESTED, PROBE_TESTED],
    ownWitnesses: (t) => own.get(t) ?? [],
    groupTestSources: new Map([["packages/notice-board/src/xprobe.test.ts", XPROBE_TEST]]),
  });
  assert.deepEqual(unwitnessed, [PROBE_UNTESTED]);
});

test("mutation-diff: ONE referencing test in the run is enough — the others need not import the package", () => {
  assert.deepEqual(
    unwitnessedTargets({
      targets: [PROBE_UNTESTED, PROBE_TESTED],
      ownWitnesses: (t) => (t === PROBE_TESTED ? ["packages/notice-board/src/xprobe.test.ts"] : []),
      groupTestSources: new Map([
        ["packages/notice-board/src/xprobe.test.ts", XPROBE_TEST],
        ["packages/notice-board/src/other.test.ts", 'import { zprobe } from "@storytree/studio-members";'],
      ]),
    }),
    [],
  );
});

test("mutation-diff: PR #1727's cross-package case stays on the ADR-0483 BLIND path — a test that IMPORTS the package witnesses it", () => {
  const library: MutationTarget = {
    project: "@storytree/library",
    dir: "packages/library",
    mutateGlobs: ["packages/library/src/fixture/corpus.ts:166-166"],
    sourceFiles: ["packages/library/src/fixture/corpus.ts"],
  };
  const cli: MutationTarget = { ...PROBE_TESTED, project: "@storytree/cli", dir: "packages/cli" };
  for (const spelling of [
    'import { loadFixtureCorpus } from "@storytree/library/fixture";',
    "import { x } from '@storytree/library';",
    "const m = await import(`@storytree/library`);",
  ]) {
    assert.deepEqual(
      unwitnessedTargets({
        targets: [library, cli],
        ownWitnesses: (t) => (t === cli ? ["packages/cli/src/cli.test.ts"] : []),
        groupTestSources: new Map([["packages/cli/src/cli.test.ts", spelling]]),
      }),
      [],
      spelling,
    );
  }
});

test("mutation-diff: a target with its OWN witness is never charged, referenced or not", () => {
  assert.deepEqual(
    unwitnessedTargets({
      targets: [PROBE_UNTESTED],
      ownWitnesses: () => ["packages/studio-members/src/zprobe.test.ts"],
      groupTestSources: new Map(),
    }),
    [],
  );
});

test("mutation-diff: referencesPackage matches the package or a subpath, never a longer name or an unquoted mention", () => {
  assert.equal(referencesPackage('from "@storytree/library"', "@storytree/library"), true);
  assert.equal(referencesPackage('from "@storytree/library/store"', "@storytree/library"), true);
  assert.equal(referencesPackage('from "@storytree/library-extra"', "@storytree/library"), false);
  assert.equal(referencesPackage('from "@storytree/libraryx/store"', "@storytree/library"), false);
  assert.equal(referencesPackage("// see @storytree/library for the parser", "@storytree/library"), false);
  // A quoted literal that merely EQUALS the name is not an import — the end-to-end probe of this fix
  // went green on exactly that, a fixture's `project: "<pkg>"` field.
  assert.equal(referencesPackage('const t = { project: "@storytree/library" };', "@storytree/library"), false);
  assert.equal(referencesPackage('import "@storytree/library";', "@storytree/library"), true);
  assert.equal(referencesPackage('const m = require( "@storytree/library" );', "@storytree/library"), true);
  assert.equal(referencesPackage('export * from"@storytree/library";', "@storytree/library"), true);
  assert.equal(referencesPackage('const t = reimport("@storytree/library");', "@storytree/library"), false);
  assert.equal(referencesPackage(`from "@storytree/library'`, "@storytree/library"), false, "mismatched quotes are not a specifier");
  assert.equal(referencesPackage('from "x@storytree/library"', "@storytree/library"), false);
  // Regex metacharacters in a name are literal.
  assert.equal(referencesPackage('from "a.b"', "a.b"), true);
  assert.equal(referencesPackage('from "axb"', "a.b"), false);
});

test("mutation-diff: a narrowed PASS never claims EVERY mutant was killed", () => {
  const lines = formatMutationVerdict(
    "[mutation]",
    { verdict: "pass", counted: 1, mutants: [], reasons: [], narrowings: ["NARROWED (BLIND): packages/x was mutated"] },
    [TARGET],
  ).split("\n");
  assert.deepEqual(lines.slice(1), [
    "[mutation] NARROWED (BLIND): packages/x was mutated",
    "[mutation] PASS — every SCORED mutant in this branch's changed lines was killed by this branch's own tests; the NARROWED package(s) above were mutated but NOT scored, so nothing here proves their tests",
  ]);
});

test("mutation-diff: a git-QUOTED non-ASCII path is read as its real path, not dropped (the seeded fault)", () => {
  const diff = [
    'diff --git "a/packages/cli/src/caf\\303\\251.ts" "b/packages/cli/src/caf\\303\\251.ts"',
    '--- "a/packages/cli/src/caf\\303\\251.ts"',
    '+++ "b/packages/cli/src/caf\\303\\251.ts"',
    "@@ -1,0 +2,3 @@",
    "+x",
  ].join("\n");
  assert.deepEqual(parseUnifiedDiffRanges(diff), [{ file: "packages/cli/src/café.ts", ranges: [{ start: 2, end: 4 }] }]);
});

test("mutation-diff: unquoteGitPath undoes git's C quoting, and leaves an unquoted path alone", () => {
  assert.equal(unquoteGitPath("packages/cli/src/a.ts"), "packages/cli/src/a.ts");
  assert.equal(unquoteGitPath('"b/caf\\303\\251.ts"'), "b/café.ts");
  assert.equal(unquoteGitPath('"a\\tb\\"c\\\\d\\ne"'), 'a\tb"c\\d\ne');
  assert.equal(unquoteGitPath('"\\a\\b\\v\\f\\r"'), "\x07\b\v\f\r");
  // Raw non-ASCII inside quotes (core.quotePath=false quoting a path for another reason) survives.
  assert.equal(unquoteGitPath('"é\\".ts"'), 'é".ts');
  // A lone quote is not a quoted path.
  assert.equal(unquoteGitPath('"'), '"');
  assert.equal(unquoteGitPath('"abc'), '"abc');
  assert.equal(unquoteGitPath('abc"'), 'abc"');
  assert.equal(unquoteGitPath('""'), "");
  // Whitespace is a character like any other — plain, or after a backslash git never emits but a
  // reader must not drop.
  assert.equal(unquoteGitPath('"my \\"odd\\" file.ts"'), 'my "odd" file.ts');
  assert.equal(unquoteGitPath('"a\\ b"'), "a b");
});
