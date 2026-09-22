import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeObservedTests, extractTestNames } from "@storytree/orchestrator";

import {
  TEST_FILE_GLOBS,
  enumerateTestFiles,
  extractRepoTestUnits,
  extractTestUnits,
  foldExtractions,
  renderCoverage,
  type FileExtraction,
} from "./test-slop-extract.js";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..", "..");

/**
 * IS THE TREE THIS SUITE IS RUNNING IN A GIT CHECKOUT? Three of the assertions below make a claim
 * ABOUT THE REPOSITORY — that the enumeration is a census of 900-odd tracked files — and there is no
 * repository to make that claim about when the suite runs from a COPY of the tree.
 *
 * That is not hypothetical: `check:mutation-diff` copies the tree into `.stryker-tmp/sandbox-<id>`
 * without a `.git`, ran this suite there on its first gate run, and `git ls-files` answered with 0 of
 * 977 files at exit 0 — so `coverage.units > 10_000` failed, Stryker's initial dry run aborted, and
 * the rung evaluated no mutant at all. Both halves of the repair are here: the module now REFUSES an
 * empty census rather than reporting a clean zero, and these tests assert the appropriate claim for
 * where they are.
 *
 * ⚠ IT IS DERIVED, NOT DECLARED, AND IT IS FALSIFIABLE IN BOTH DIRECTIONS — which is what keeps it
 * from being an opt-out. A guard that merely tolerated an empty enumeration would swallow a real
 * regression in the enumerator; instead, in a checkout the full census MUST hold, and outside one the
 * refusal MUST fire. Neither branch can pass by doing nothing.
 */
const IS_GIT_CHECKOUT = existsSync(path.join(REPO_ROOT, ".git"));

/**
 * THE FIXTURE IS A REAL FILE ON DISK, NOT AN INLINE TEMPLATE LITERAL — and that is a requirement of
 * this increment rather than a preference. This suite's subject is an extractor whose whole purpose is
 * to tell code from test-source-as-data, so an inline fixture would make this very file the next thing
 * a sweep trips over. Reading the actual file also makes the fixture the REAL artefact that produced
 * the withdrawn 2.8% rate, which no authored approximation of it could be.
 */
const FIXTURE = "packages/orchestrator/src/proof/contract-coverage.test.ts";
const SECOND_FIXTURE = "packages/orchestrator/src/proof/per-test-review.test.ts";

function readRepo(rel: string): string {
  return readFileSync(path.join(REPO_ROOT, rel), "utf8");
}

/**
 * THE INCREMENT'S RED→GREEN, and it is stated as a DIFFERENTIAL against the regex extractor that is
 * still in this repo — deliberately, because the negative on its own cannot fail.
 *
 * "The extractor does not return `c: hollow`" passes trivially against a fixture that never contained
 * `c: hollow`, and passes just as trivially against an extractor that returns nothing at all. That is
 * exactly the `an-assertion-over-pre-arranged-input-cannot-fail` shape this whole arc exists to detect,
 * and writing it here would be the joke telling itself. So the positive control runs FIRST: the regex
 * reader must actually produce the phantom, from this very file, before the negative means anything.
 */
test("test-slop-extract: the AST extractor drops template-literal fixtures the regex reader invents", () => {
  const source = readRepo(FIXTURE);
  // POSITIVE CONTROL — the regex reader really does invent these, so the negatives below are live.
  const regexNames = extractTestNames(source);
  for (const phantom of ["c: hollow", "works", "hollow-contract: bounded"]) {
    assert.ok(
      regexNames.includes(phantom),
      `the fixture no longer yields the phantom ${JSON.stringify(phantom)} to the regex reader — ` +
        "without it the assertion below is vacuous; re-point FIXTURE at a file that still holds one",
    );
  }

  const { units } = extractTestUnits(source, FIXTURE);
  const names = new Set(units.map((u) => u.name));
  // THE ASSERTION: the phantoms are absent because a template literal is not code.
  for (const phantom of ["c: hollow", "works", "hollow-contract: bounded"]) {
    assert.ok(!names.has(phantom), `extracted the template-literal fixture ${JSON.stringify(phantom)} as a real test`);
  }
  // AND THE REAL TESTS SURVIVE — an extractor that returned nothing would satisfy the clause above.
  assert.ok(
    names.has("extractVouchingTestNames: a substantive assertion vouches; assert(true) is hollow"),
    "dropped a real test declared at the top level of the fixture",
  );
  // The phantom count is the measurement: the regex reads far more declarations than exist.
  assert.ok(
    regexNames.length > units.length * 2,
    `expected the regex reader to roughly double-count or worse; got regex=${regexNames.length} ast=${units.length}`,
  );
});

test("test-slop-extract: the second fixture family behaves the same way", () => {
  const source = readRepo(SECOND_FIXTURE);
  const regexNames = extractTestNames(source);
  assert.ok(regexNames.includes("hollow-empty: a test with no body"), "positive control lost from the second fixture");
  const names = new Set(extractTestUnits(source, SECOND_FIXTURE).units.map((u) => u.name));
  assert.ok(!names.has("hollow-empty: a test with no body"), "extracted a template-literal fixture as a real test");
  assert.ok(!names.has("hollow-tautology: asserts a constant"), "extracted a template-literal fixture as a real test");
});

/**
 * THE FILE-ALTITUDE GUARD, PROVED ON THIS VERY FILE. A guard asked of the extracted FRAGMENT returns
 * ~0.1 and is correct while the measurement is wrong, because the nesting it needed to see was one
 * level up. This suite is itself a test-analysing file, so it is the honest subject: the flag must be
 * TRUE here, and no fixture named inside it may be emitted as a unit.
 */
test("test-slop-extract: a file carrying test source as data is flagged, and its fixtures are not units", () => {
  const self = "packages/cli/src/test-slop-extract.test.ts";
  const extraction = extractTestUnits(readRepo(self), self);
  assert.equal(extraction.analysesTests, true, "this suite quotes test source and must read as test-as-data");
  assert.ok(extraction.testSourceLiterals > 0, "the flag must be backed by a count, not asserted bare");
  // Every unit it DOES emit is one of this file's own tests, so each carries the flag it was read under.
  assert.ok(extraction.units.length > 0, "found none of this suite's own tests");
  assert.ok(
    extraction.units.every((u) => u.fileAnalysesTests),
    "a unit must carry its FILE's test-as-data flag — a unit cannot know this about itself",
  );
});

test("test-slop-extract: an ordinary test file is not flagged as test-as-data", () => {
  // The control for the assertion above: without it, a flag that is always TRUE would pass.
  const ordinary = "packages/cli/src/mutation-diff.test.ts";
  const extraction = extractTestUnits(readRepo(ordinary), ordinary);
  assert.equal(extraction.analysesTests, false, `${ordinary} quotes no test source and must not be flagged`);
  assert.equal(extraction.testSourceLiterals, 0);
});

test("test-slop-extract: a unit carries file, 1-based line, title path and its own source text", () => {
  const source = readRepo(FIXTURE);
  const { units } = extractTestUnits(source, FIXTURE);
  const lines = source.split("\n");
  for (const unit of units) {
    assert.equal(unit.file, FIXTURE);
    assert.ok(unit.line >= 1 && unit.line <= lines.length, `line ${unit.line} outside the file`);
    // The recorded line must actually hold the declaration — the check that a span/line mismatch fails.
    assert.match(
      lines[unit.line - 1] ?? "",
      /\b(?:describe|test|it)\b/,
      `line ${unit.line} of ${unit.file} does not declare a test`,
    );
    assert.ok(unit.source.length > 0, "a unit with no source text would read to a judge as asserting nothing");
    assert.deepEqual(unit.titlePath, [...unit.ancestors, unit.name]);
  }
});

test("test-slop-extract: context quotes the declarations a unit references and omits the ones it does not", () => {
  // Two top-level fixtures, one referenced and one not. Built by joining lines so this case states the
  // arrangement it depends on rather than hiding it in a blob.
  const source = [
    `import assert from "node:assert/strict";`,
    `import test from "node:test";`,
    `const USED_FIXTURE = [1, 2, 3];`,
    `const UNUSED_FIXTURE = [9, 9, 9];`,
    `function helper(n: number): number { return n + 1; }`,
    `test("sums the used fixture", () => {`,
    `  assert.equal(helper(USED_FIXTURE.length), 4);`,
    `});`,
  ].join("\n");
  const { units } = extractTestUnits(source, "packages/x/src/a.test.ts");
  assert.equal(units.length, 1);
  const [unit] = units;
  assert.ok(unit !== undefined);
  assert.match(unit.context, /USED_FIXTURE = \[1, 2, 3\]/, "dropped a fixture the unit references");
  assert.match(unit.context, /function helper/, "dropped a helper the unit calls");
  assert.doesNotMatch(unit.context, /UNUSED_FIXTURE/, "quoted a fixture the unit never references");
  assert.match(unit.context, /node:assert/, "dropped the import that binds the referenced `assert`");
  // The RUNNER import rides along, and that is correct rather than slack: the unit's own text opens
  // with `test(`, so `test` is a genuine reference. Worth knowing — which runner a file uses changes
  // what its assertions mean (`assert.ok(true)` and `expect(x).toBe(y)` are not judged alike), and a
  // `bun:test` import is the tell for the one runtime whose `false` comparator reverses a sort.
  assert.match(unit.context, /node:test/, "the unit's own `test(` call references the runner import");
});

test("test-slop-extract: context reaches a fixture declared inside the enclosing describe", () => {
  // The commonest arrangement in this repo: the fixture is describe-scoped, not top-level. A context
  // walk restricted to the top level would silently return nothing here and every judgement over such
  // a test would be made without the input that decides it.
  const source = [
    `import assert from "node:assert/strict";`,
    `describe("suite", () => {`,
    `  const ROWS = [{ n: 1 }, { n: 2 }];`,
    `  it("keeps the rows", () => {`,
    `    assert.equal(ROWS.length, 2);`,
    `  });`,
    `});`,
  ].join("\n");
  const units = extractTestUnits(source, "packages/x/src/b.test.ts").units;
  const leaf = units.find((u) => u.call === "it");
  assert.ok(leaf !== undefined, "did not find the leaf test");
  assert.match(leaf.context, /ROWS = \[\{ n: 1 \}, \{ n: 2 \}\]/, "missed a describe-scoped fixture");
  assert.deepEqual(leaf.ancestors, ["suite"]);
});

test("test-slop-extract: context omits declarations that live INSIDE the unit", () => {
  // They are already in `source`; quoting them again would make a self-contained test read as though
  // it depended on something out of frame.
  const source = [
    `import assert from "node:assert/strict";`,
    `test("self-contained", () => {`,
    `  const INNER = 3;`,
    `  assert.equal(INNER, 3);`,
    `});`,
  ].join("\n");
  const units = extractTestUnits(source, "packages/x/src/c.test.ts").units;
  const [unit] = units;
  assert.ok(unit !== undefined);
  assert.match(unit.source, /const INNER = 3/, "the inner declaration belongs to the unit's own text");
  assert.doesNotMatch(unit.context, /INNER/, "quoted a declaration that is already inside the unit");
});

test("test-slop-extract: a name occurring only inside the unit's own strings pulls in no context", () => {
  // The "a literal is not code" rule, one level down: the reference scan reads TOKENS, so a fixture
  // named in a message string is not a reference. A regex reference scan would fail this.
  const source = [
    `import assert from "node:assert/strict";`,
    `const DECOY = [1];`,
    `test("mentions a decoy", () => {`,
    `  assert.equal(1, 1, "not DECOY");`,
    `});`,
  ].join("\n");
  const units = extractTestUnits(source, "packages/x/src/d.test.ts").units;
  const [unit] = units;
  assert.ok(unit !== undefined);
  assert.doesNotMatch(unit.context, /DECOY = \[1\]/, "a name inside a string is not a reference");
});

test("test-slop-extract: a UAT acceptance leg is INCLUDED and flagged, unlike in check:mutation-diff", () => {
  // That rung excludes these for a runtime reason with no analogue here (its coverage re-run finds the
  // spawned server dead). Nothing in this module executes anything, so the leg is extracted — and
  // flagged, because the JUDGEMENT of a spawn-based leg differs even though the extraction does not.
  const source = [
    `import assert from "node:assert/strict";`,
    `test("serves the door", () => {`,
    `  assert.equal(1, 1);`,
    `});`,
  ].join("\n");
  const leg = extractTestUnits(source, "packages/x/src/thing.uat.test.ts").units;
  assert.equal(leg.length, 1, "a UAT leg must be extracted, not dropped");
  assert.equal(leg[0]?.uatLeg, true);
  const plain = extractTestUnits(source, "packages/x/src/thing.test.ts").units;
  assert.equal(plain[0]?.uatLeg, false, "the flag must discriminate — an always-true flag says nothing");
});

test("test-slop-extract: skip, substance and .each flags are carried through from the static read", () => {
  const source = [
    `import assert from "node:assert/strict";`,
    `test.skip("certainly skipped", () => { assert.equal(1, 2); });`,
    `test("hollow", () => { assert.ok(true); });`,
    `test("substantive", () => { assert.equal(String(1), "1"); });`,
    `test.each([1, 2])("table %i", (n: number) => { assert.equal(typeof n, "number"); });`,
  ].join("\n");
  const byName = new Map(extractTestUnits(source, "packages/x/src/e.test.ts").units.map((u) => [u.name, u]));
  assert.equal(byName.get("certainly skipped")?.skipped, true);
  assert.equal(byName.get("substantive")?.skipped, false, "the skip flag must discriminate");
  assert.equal(byName.get("hollow")?.substantive, false, "a constant-only assertion is not substantive");
  assert.equal(byName.get("substantive")?.substantive, true);
  assert.equal(byName.get("table %i")?.parameterised, true);
  assert.equal(byName.get("substantive")?.parameterised, false, "the .each flag must discriminate");
});

test("test-slop-extract: a unit is emitted for every observed test that carries a span", () => {
  // The seam between this module and the shared matcher: if `analyzeObservedTests` stops supplying
  // spans, units vanish silently. This is the assertion that would red instead.
  const source = readRepo(FIXTURE);
  const observed = analyzeObservedTests(source, FIXTURE);
  assert.ok(observed.length > 0);
  assert.ok(
    observed.every((o) => o.span !== undefined),
    "the shared matcher stopped supplying spans — every unit would be dropped and the scan would read empty",
  );
  assert.equal(extractTestUnits(source, FIXTURE).units.length, observed.length);
});

test("test-slop-extract: foldExtractions reports the four coverage states and reconciles", () => {
  const withTests: FileExtraction = {
    file: "a.test.ts",
    units: [
      {
        file: "a.test.ts",
        line: 1,
        name: "x",
        ancestors: [],
        call: "test",
        source: "test('x', () => {})",
        context: "",
        titlePath: ["x"],
        titleFullyStatic: true,
        skipped: false,
        conditionallySkipped: false,
        substantive: true,
        parameterised: false,
        fileAnalysesTests: false,
        uatLeg: false,
      },
      {
        file: "a.test.ts",
        line: 5,
        name: "",
        ancestors: [],
        call: "test",
        source: "test(name, () => {})",
        context: "",
        titlePath: [""],
        titleFullyStatic: false,
        skipped: false,
        conditionallySkipped: false,
        substantive: true,
        parameterised: false,
        fileAnalysesTests: false,
        uatLeg: false,
      },
    ],
    analysesTests: false,
    testSourceLiterals: 0,
  };
  const empty: FileExtraction = { file: "b.test.ts", units: [], analysesTests: false, testSourceLiterals: 0 };
  const quoting: FileExtraction = { file: "c.test.ts", units: [], analysesTests: true, testSourceLiterals: 3 };
  const { coverage } = foldExtractions(
    ["a.test.ts", "b.test.ts", "c.test.ts", "gone.test.ts"],
    [withTests, empty, quoting],
    [{ file: "gone.test.ts", reason: "ENOENT" }],
  );
  assert.equal(coverage.enumerated, 4);
  assert.equal(coverage.parsed, 3);
  assert.deepEqual(coverage.unreadable, [{ file: "gone.test.ts", reason: "ENOENT" }]);
  assert.deepEqual(coverage.zeroDeclarationFiles, ["b.test.ts", "c.test.ts"]);
  assert.deepEqual(coverage.filesAnalysingTests, ["c.test.ts"]);
  assert.equal(coverage.units, 2);
  assert.equal(coverage.unreadTitles, 1);
  // THE RECONCILIATION: every enumerated file lands in exactly one of parsed / unreadable.
  assert.equal(coverage.parsed + coverage.unreadable.length, coverage.enumerated);
});

test("test-slop-extract: renderCoverage names the files it could not account for", () => {
  const rendered = renderCoverage({
    enumerated: 2,
    parsed: 1,
    unreadable: [{ file: "gone.test.ts", reason: "ENOENT" }],
    zeroDeclarationFiles: ["quiet.test.ts"],
    units: 0,
    unreadTitles: 0,
    filesAnalysingTests: ["meta.test.ts"],
  });
  // Named, not counted: a count cannot be eyeballed, and eyeballing is the audit that works.
  assert.match(rendered, /UNREADABLE {2}gone\.test\.ts — ENOENT/);
  assert.match(rendered, /NO TEST {5}quiet\.test\.ts/);
  assert.match(rendered, /TEST-AS-DATA meta\.test\.ts/);
  assert.match(rendered, /test files enumerated: {2}2/);
});

/**
 * THE COVERAGE PROOF over the real repository — the clause that makes it impossible to repeat the
 * 83-of-970 measurement quietly. It asserts the enumeration is a CENSUS rather than a slice, against
 * the repo's own index, and it names the concrete slice that was measured last time so the comparison
 * is in the assertion rather than in a memory.
 */
test("test-slop-extract: an enumeration that finds nothing REFUSES rather than reporting a clean zero", () => {
  // The defect the mutation sandbox exposed, asserted directly. `git ls-files` succeeds and returns
  // nothing inside an ignored directory, so this is the one failure mode that arrives looking healthy.
  // `.gate-logs` is gitignored and always present in a worktree that has run the gate, so it is a real
  // instance rather than a contrived one; `os.tmpdir()` covers the no-work-tree case.
  for (const outside of [path.join(REPO_ROOT, ".gate-logs"), tmpdir()]) {
    if (!existsSync(outside)) continue;
    assert.throws(
      () => enumerateTestFiles(outside),
      /refusing to report a census over zero files|not a git repository|does not exist/i,
      `enumerating ${outside} returned a zero census instead of refusing — a rate over it would read as clean`,
    );
  }
});

test("test-slop-extract: the enumeration is a census of git-tracked test files, not a slice", (t) => {
  if (!IS_GIT_CHECKOUT) {
    // Not a checkout, so there is no census to assert. Verify the REFUSAL fires instead — the branch
    // still proves something, and it cannot be satisfied by an enumerator that quietly returns [].
    assert.throws(() => enumerateTestFiles(REPO_ROOT), /refusing to report a census over zero files/);
    t.diagnostic(`SKIPPED the census: ${REPO_ROOT} is not a git checkout — the refusal was asserted instead`);
    return;
  }
  const files = enumerateTestFiles(REPO_ROOT);
  assert.ok(files.length > 900, `expected the whole suite; enumerated only ${files.length}`);
  // Every workspace the withdrawn run silently missed must be present. `apps/` above all: the old glob
  // was `packages/<name>/src` with a `.test.ts` tail only, so no app could ever appear in it.
  for (const prefix of ["packages/cli/src/", "packages/forest-world-r3f/", "packages/drive/src/", "apps/studio/"]) {
    assert.ok(
      files.some((f) => f.startsWith(prefix)),
      `${prefix} is absent — the enumeration is a slice, exactly the defect this asserts against`,
    );
  }
  // Both extensions are enumerated; a `.tsx`-blind glob would lose 65 files here.
  assert.ok(files.some((f) => f.endsWith(".test.tsx")), "no .test.tsx file enumerated");
  assert.ok(files.some((f) => f.endsWith(".uat.test.ts")), "no .uat.test.ts leg enumerated");
  assert.deepEqual(TEST_FILE_GLOBS, ["*.test.ts", "*.test.tsx"]);
});

test("test-slop-extract: the whole repo extracts with every file accounted for", (t) => {
  if (!IS_GIT_CHECKOUT) {
    assert.throws(() => extractRepoTestUnits(REPO_ROOT), /refusing to report a census over zero files/);
    t.diagnostic(`SKIPPED the whole-repo extraction: ${REPO_ROOT} is not a git checkout`);
    return;
  }
  const { units, coverage } = extractRepoTestUnits(REPO_ROOT);
  // Nothing may be lost between enumeration and the report.
  assert.equal(coverage.parsed + coverage.unreadable.length, coverage.enumerated);
  assert.deepEqual(coverage.unreadable, [], "git tracks a test file this extractor could not read");
  assert.equal(coverage.units, units.length);
  assert.ok(coverage.units > 10_000, `expected the full suite's declarations; got ${coverage.units}`);
  // Zero-declaration files are permitted but must stay RARE — a jump here means a convention this
  // reader is blind to, which is the failure that reads as a clean number.
  assert.ok(
    coverage.zeroDeclarationFiles.length < 10,
    `${coverage.zeroDeclarationFiles.length} test files declared nothing — investigate before trusting any rate: ` +
      coverage.zeroDeclarationFiles.join(", "),
  );
  // And the test-tooling neighbourhood that produced the withdrawn rate must be FOUND, not silently
  // mixed in. It is a property of the file, so the flag is what carries it to a consumer.
  assert.ok(
    coverage.filesAnalysingTests.includes("packages/orchestrator/src/proof/contract-coverage.test.ts"),
    "the file whose fixtures produced the withdrawn 2.8% is not flagged as test-as-data",
  );
});
