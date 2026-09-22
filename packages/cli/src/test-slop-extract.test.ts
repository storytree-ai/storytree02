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
  parseLsFiles,
  refuseEmptyCensus,
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

test("test-slop-extract: the test-as-data pattern discriminates a declaration from a mention of one", () => {
  // The flag is a REGEX over literal text, so every one of its parts is a mutable span that the two
  // whole-file tests above cannot distinguish — both of those would still pass against a pattern
  // that matched far too much. These are the cases that pin each part, stated as what the pattern
  // must and must not accept.
  const flagged = (literal: string): boolean =>
    // The literal is the whole file's only statement, so the only thing that can flag it is its text.
    extractTestUnits(`const src = ${JSON.stringify(literal)};\n`, "packages/x/src/probe.ts").analysesTests;

  // MUST FLAG — a real declaration inside the literal, in each runner spelling and each quote style.
  for (const yes of [
    `test("a", () => {});`,
    `it('b', () => {});`,
    "describe(`c`, () => {});",
    `test.skip("d", () => {});`,
    `  it.each(cases)("e", () => {});`, // a MULTI-character table name — `[^)]*`, not `[^)]`
    `test ("spaced before the paren", () => {});`, //   whitespace BEFORE `(` — `\s*`, not `\S*`
    `test( "spaced after the paren", () => {});`, //    whitespace AFTER `(` — the second `\s*`
    `foo();\n  test("nested on a later line", () => {});`,
  ]) {
    assert.equal(flagged(yes), true, `should read as test source: ${yes}`);
  }

  // MUST NOT FLAG — each of these differs from a real declaration by exactly one of the pattern's
  // parts, so each one alone would go unnoticed if that part were dropped.
  for (const no of [
    `latest("a", 1)`, //            a longer word ENDING in a runner name — the `[^\w.]` boundary
    `mytest("a", 1)`, //            same, no separator
    `suite.it("a", () => {})`, //   a method call on an object — the `.` exclusion
    `runner.test("a", 1)`, //       same, `test` as a member
    `test(fn, 1)`, //               a call with no string title — the quote requirement
    `describe the behaviour here`, //  the bare word with no call at all
  ]) {
    assert.equal(flagged(no), false, `should NOT read as test source: ${no}`);
  }

  // ACCEPTED OVER-MATCHES — recorded rather than quietly tolerated, because a suite that asserted
  // these DIDN'T flag would be asserting something false about the pattern. Prose containing a
  // runner word applied to a quoted string is not distinguishable from a declaration by any regex,
  // and the pattern is deliberately loose in this direction: the flag is REPORTED and never acted
  // on here, so an over-match costs a consumer one extra fact while an under-match costs a whole
  // measurement. If this ever needs to be tight, the answer is a parse, not a longer pattern.
  for (const over of [`the test("quoted phrase")`, `see it("the docs") for more`]) {
    assert.equal(flagged(over), true, `documented over-match no longer fires — the pattern changed: ${over}`);
  }
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

test("test-slop-extract: context reaches a helper declared AFTER the test, and joins with a blank line", () => {
  // TWO things at once, both of which a before-only fixture cannot see. A function declaration is
  // HOISTED, so a test may legitimately call a helper written below it — and a containment check
  // that asked only "does this start after the unit starts?" would wrongly exclude it, which is
  // indistinguishable from the correct rule on any fixture where everything is declared first.
  const source = [
    `import assert from "node:assert/strict";`,
    `test("uses a helper declared below", () => {`,
    `  assert.equal(later(2), 4);`,
    `});`,
    `function later(n: number): number { return n * 2; }`,
  ].join("\n");
  const units = extractTestUnits(source, "packages/x/src/after.test.ts").units;
  const [unit] = units;
  assert.ok(unit !== undefined);
  assert.match(unit.context, /function later/, "excluded a helper the unit calls because it is declared below it");
  // And the exact join: two candidates, separated by ONE blank line. A fragment match would not see
  // the separator at all, so the separator would be free to change without any test noticing.
  assert.equal(
    unit.context,
    `import assert from "node:assert/strict";\n\nfunction later(n: number): number { return n * 2; }`,
  );
});

test("test-slop-extract: an import that binds nothing is never offered as context", () => {
  // `import "./side-effect.js";` is a CONTEXT_KIND node that binds no name, which is the one case
  // that exercises the empty-names guard. Without it the candidate would be kept with an empty name
  // list — inert, but the guard would then be a branch nothing distinguishes.
  const source = [
    `import "./side-effect.js";`,
    `import assert from "node:assert/strict";`,
    `test("t", () => { assert.equal(1, 1); });`,
  ].join("\n");
  const units = extractTestUnits(source, "packages/x/src/side.test.ts").units;
  const [unit] = units;
  assert.ok(unit !== undefined);
  assert.doesNotMatch(unit.context, /side-effect/, "a side-effect import binds nothing and can be context for nothing");
  assert.match(unit.context, /node:assert/, "the binding import is still offered");
});

test("test-slop-extract: a .tsx unit's references are read with JSX in play", () => {
  // The unit's own text is re-parsed to read its identifiers, and that re-parse must admit JSX or a
  // `.tsx` test's references vanish — silently, as an empty context rather than an error.
  const source = [
    `import assert from "node:assert/strict";`,
    `const Widget = () => null;`,
    `test("renders", () => {`,
    `  const el = <Widget />;`,
    `  assert.ok(el);`,
    `});`,
  ].join("\n");
  const units = extractTestUnits(source, "packages/x/src/w.test.tsx").units;
  const [unit] = units;
  assert.ok(unit !== undefined);
  assert.match(unit.context, /const Widget/, "a JSX-only reference was lost — the span re-parse is not reading JSX");
});

test("test-slop-extract: a backslash path is normalised, and the UAT flag reads the normalised form", () => {
  // Windows hands paths with backslashes. Both the reported `file` and the `.uat.test.ts` suffix
  // check must see the normalised form, or a finding is unaddressable on one platform only —
  // the class of defect that is CI-red and locally green.
  const source = `test("t", () => {});`;
  const win = extractTestUnits(source, "packages\\x\\src\\thing.uat.test.ts");
  assert.equal(win.file, "packages/x/src/thing.uat.test.ts");
  assert.equal(win.units[0]?.file, "packages/x/src/thing.uat.test.ts");
  assert.equal(win.units[0]?.uatLeg, true, "the UAT flag must read the normalised path, not the raw one");
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
      // ⚠ A THIRD unit, and it is here because the mutation rung caught this very suite committing
      // the failure this whole arc exists to detect. With two units, one of them unread, the
      // `unreadTitles` fold and its exact INVERSE both answer 1 — so `!u.titleFullyStatic` could be
      // flipped and no assertion would move (`an-assertion-over-pre-arranged-input-cannot-fail`).
      // Three units with TWO static titles make the fold's answer 1 and the inverse's 2.
      {
        file: "a.test.ts",
        line: 9,
        name: "third",
        ancestors: [],
        call: "test",
        source: "test('third', () => {})",
        context: "",
        titlePath: ["third"],
        titleFullyStatic: true,
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
  assert.equal(coverage.units, 3);
  assert.equal(coverage.unreadTitles, 1);
  // THE RECONCILIATION: every enumerated file lands in exactly one of parsed / unreadable.
  assert.equal(coverage.parsed + coverage.unreadable.length, coverage.enumerated);
});

test("test-slop-extract: renderCoverage names the files it could not account for", () => {
  const rendered = renderCoverage({
    enumerated: 4,
    parsed: 3,
    unreadable: [{ file: "gone.test.ts", reason: "ENOENT" }],
    zeroDeclarationFiles: ["quiet.test.ts"],
    units: 7,
    unreadTitles: 2,
    filesAnalysingTests: ["meta.test.ts"],
  });
  // ⚠ THE WHOLE OUTPUT, not a handful of `assert.match` probes over it — and that is a deliberate
  // choice this arc's own subject argues for. A report is prose, every literal in it is a mutable
  // span, and a fragment assertion leaves each unvisited word free to change without any test
  // noticing (`mutation-rung-charges-render-prose`). Every distinct count is a DIFFERENT number
  // here, so a line that reads the wrong field cannot coincide with the right answer — which is the
  // `an-assertion-over-pre-arranged-input-cannot-fail` discipline applied to a renderer.
  assert.equal(
    rendered,
    [
      "test files enumerated:  4",
      "  parsed:               3",
      "  unreadable:           1",
      "  declared no test:     1",
      "test units extracted:   7",
      "  titles not static:    2",
      "files with test-as-data: 1",
      "  UNREADABLE  gone.test.ts — ENOENT",
      "  NO TEST     quiet.test.ts",
      "  TEST-AS-DATA meta.test.ts",
    ].join("\n"),
  );
  // Named, not counted: a count cannot be eyeballed, and eyeballing is the audit that works. With
  // nothing to name, the three list sections vanish entirely rather than printing empty headings.
  const clean = renderCoverage({
    enumerated: 1,
    parsed: 1,
    unreadable: [],
    zeroDeclarationFiles: [],
    units: 9,
    unreadTitles: 0,
    filesAnalysingTests: [],
  });
  assert.equal(clean.split("\n").length, 7, `expected only the seven summary lines, got:\n${clean}`);
  for (const marker of ["UNREADABLE", "NO TEST", "TEST-AS-DATA"]) assert.ok(!clean.includes(marker));
});

/**
 * THE COVERAGE PROOF over the real repository — the clause that makes it impossible to repeat the
 * 83-of-970 measurement quietly. It asserts the enumeration is a CENSUS rather than a slice, against
 * the repo's own index, and it names the concrete slice that was measured last time so the comparison
 * is in the assertion rather than in a memory.
 */
test("test-slop-extract: parseLsFiles handles git's real output shape", () => {
  // Proved here rather than through `enumerateTestFiles`, because every test that could reach it
  // that way must stand down outside a git checkout — which is exactly where `check:mutation-diff`
  // runs this suite. The trailing newline is not hypothetical: git always emits one, so the last
  // split element is always empty and a missing filter hands a caller `""` as a filename.
  assert.deepEqual(parseLsFiles("b.test.ts\na.test.ts\n"), ["a.test.ts", "b.test.ts"], "sorted, trailing newline dropped");
  assert.deepEqual(parseLsFiles(""), [], "empty output is an empty list, not [\"\"]");
  assert.deepEqual(parseLsFiles("\n\n\n"), [], "blank lines contribute nothing");
  assert.deepEqual(parseLsFiles("  x.test.ts  \n"), ["x.test.ts"], "surrounding whitespace is trimmed");
  assert.deepEqual(parseLsFiles("a.test.ts\na.test.ts\n"), ["a.test.ts"], "a repeated path is counted once");
  // The order is the FUNCTION's, not the input's — asserted against an input that is already in the
  // wrong order AND whose reverse differs from the answer, so neither a pass-through nor a reversal
  // can coincide with it (`an-assertion-over-pre-arranged-input-cannot-fail`).
  assert.deepEqual(parseLsFiles("m.test.ts\nz.test.ts\na.test.ts\n"), ["a.test.ts", "m.test.ts", "z.test.ts"]);
});

test("test-slop-extract: refuseEmptyCensus passes a real list through and refuses an empty one", () => {
  assert.deepEqual(refuseEmptyCensus(["a.test.ts", "b.test.ts"], "/repo"), ["a.test.ts", "b.test.ts"]);
  // The WORDING is the deliverable here, not just the throw: whoever meets this is standing in the
  // wrong directory and the message is the only thing that will tell them so. Asserting it whole
  // keeps every clause of it held, where a `/refusing/` probe would leave the diagnosis free to rot.
  assert.throws(
    () => refuseEmptyCensus([], "/repo"),
    (error: unknown) =>
      error instanceof Error &&
      error.message ===
        "no git-tracked test files under /repo — refusing to report a census over zero files. " +
          "`git ls-files` returns nothing (exit 0) when run outside a git work tree or inside an " +
          "ignored directory, so a zero here is a statement about this reader's position and never " +
          "about the suite. Point it at a git checkout, or pass an explicit file list.",
  );
});

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
});

test("test-slop-extract: the enumerating globs cover both extensions", () => {
  // Its own test, NOT a line inside the census above: that one stands down outside a git checkout,
  // which is where the mutation rung runs this suite — so an assertion parked there is unheld
  // exactly where the tooling looks. An empty or single-extension glob would lose 65 `.test.tsx`
  // files silently, which is the 83-of-970 defect in miniature.
  assert.deepEqual(TEST_FILE_GLOBS, ["*.test.ts", "*.test.tsx"]);
});

test("test-slop-extract: extractRepoTestUnits reads an EXPLICIT file list, git or no git", () => {
  // The IO shell, driven without the enumerator — which is the only way to exercise it where
  // `check:mutation-diff` runs this suite, since the census tests stand down outside a git checkout
  // and left this whole function unreached. The explicit-list parameter exists for callers that
  // already know their files (a diff-scoped run, `-inc-05`); it doubles as the seam that makes the
  // reader provable anywhere.
  const present = "packages/cli/src/test-slop-extract.ts";
  const missing = "packages/cli/src/this-file-does-not-exist.test.ts";
  const { units, coverage } = extractRepoTestUnits(REPO_ROOT, [FIXTURE, present, missing]);

  assert.equal(coverage.enumerated, 3, "the denominator is the list it was GIVEN, not what it could read");
  assert.equal(coverage.parsed, 2);
  assert.equal(coverage.unreadable.length, 1, "a path that is not on disk must be reported, never dropped");
  assert.equal(coverage.unreadable[0]?.file, missing);
  assert.match(coverage.unreadable[0]?.reason ?? "", /ENOENT|no such file/i, "the reason must say WHY it could not be read");
  // The reconciliation, on a list where the three totals are all DIFFERENT numbers — so a fold that
  // read the wrong one cannot coincide with the right answer.
  assert.equal(coverage.parsed + coverage.unreadable.length, coverage.enumerated);

  // The real fixture's units come back with their text, from a read this test performed.
  assert.ok(units.length > 40, `expected the fixture's declarations; got ${units.length}`);
  assert.ok(units.every((u) => u.source.length > 0));
  assert.ok(units.every((u) => u.file === FIXTURE), "only the file that declares tests contributes units");
  // And the source file, which declares none, is the zero-declaration case — named, not lost.
  assert.deepEqual(coverage.zeroDeclarationFiles, [present]);
  // Only the FIXTURE is flagged, and the exclusion is the more interesting half: this module's own
  // source quotes a test declaration too, but in a JSDoc COMMENT rather than a string literal — and
  // a comment is not a literal, so the walk never reaches it. The guard is about test source held
  // as DATA, which is the only form that can be mistaken for a test; prose about tests is not.
  assert.deepEqual(coverage.filesAnalysingTests, [FIXTURE], "a JSDoc example is not test source as data");
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
