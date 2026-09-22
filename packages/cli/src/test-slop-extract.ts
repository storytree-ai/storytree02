/**
 * THE AST TEST EXTRACTOR — the unit a judge is allowed to judge (ADR-0594, `jev-test-slop-arc-inc-01`).
 *
 * WHY THIS EXISTS AT ALL, stated first because it is the whole justification. A regex block-extractor
 * was run over this repo's tests on 2026-09-22 and produced a clean-looking 2.8% "verifies nothing"
 * rate. **That number was withdrawn.** Its top-ranked hits were almost all in
 * `packages/orchestrator/src/proof/contract-coverage*.test.ts` and `per-test-review.test.ts` — the
 * DELIBERATELY HOLLOW FIXTURES of this repo's own test-quality tooling, which live inside template
 * literals:
 *
 * ```ts
 * test("analyzeObservedTests: surfaces name/skipped/vouches", () => {
 *   const src = `
 *     it("c: hollow", () => { assert(true); });   // <- the regex pulled THIS out as a test
 *   `;
 * ```
 *
 * The classifier was handed a fragment that genuinely IS a hollow test, stripped of the one enclosing
 * level that made it a fixture. It answered correctly every time and the aggregate was garbage.
 * Measured here, in this repo, by {@link extractTestUnits}'s own suite: the regex reads **133**
 * declarations out of `contract-coverage.test.ts` where **46** exist — 87 phantoms, 66% of its output,
 * and they rank at the TOP of any slop scan precisely because they are hollow on purpose.
 *
 * ⚠ AND THE OBVIOUS GUARD DOES NOT WORK — do not reach for it instead. Asking the EXTRACTED FRAGMENT
 * "is this test source appearing as data?" returns ~0.1 and is ALSO correct: the fragment really does
 * contain no nested test source, because the nesting was one level up in the file the extractor had
 * already discarded. A guard asked at the wrong altitude CONFIRMS the error rather than catching it.
 * The guard belongs in the extractor, over the whole FILE — which is what {@link FileExtraction}'s
 * `analysesTests` flag is, and why it is a property of the file and never of a unit.
 *
 * WHAT THIS MODULE IS AND IS NOT. It is PURE apart from the parser: no filesystem, no store, no
 * clock, no network — {@link extractTestUnits} is handed one file's TEXT and returns units. The disk
 * read and the `git ls-files` enumeration live in {@link extractRepoTestUnits}, the thin IO shell, so
 * the judgement-bearing half stays testable against literals. It contains NO classifier and reaches
 * no verdict: emitting a fair unit is the entire job, and `jev-test-slop-arc-inc-02` is what judges.
 *
 * IT DOES NOT RE-MATCH TEST CALLS, deliberately. `analyzeObservedTests`
 * (`packages/orchestrator/src/proof/contract-coverage.ts`) already walks a real TypeScript AST,
 * parses `.ts` and `.tsx` by the extension the way `tsc` does, reads `describe`/`test`/`it` roots,
 * both skip forms, `.each` table-binding and the enclosing title chain. A second matcher here would
 * be a second opinion about what a test IS, and the two would drift — the same reason
 * `ci-affected.ts` is shared by CI and the gate rather than reimplemented. This module consumes its
 * spans and adds the three things a JUDGE needs and a coverage checker never did: the declaration's
 * TEXT, its enclosing context, and provenance.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript5";

import { analyzeObservedTests } from "@storytree/orchestrator";

/**
 * A test-declaration pattern, applied to the TEXT INSIDE a string or template literal — never to a
 * file's code, which is what {@link analyzeObservedTests} parses. This is the file-altitude guard
 * described in the header: it answers "does this file carry test source as DATA?", the question the
 * withdrawn 2.8% run could not answer because it had already thrown the file away.
 *
 * Deliberately loose. Its output is a REPORTED FLAG, never an exclusion this module performs — a
 * false positive costs a consumer one extra fact, while a false negative is the failure that cost a
 * whole measurement. Which way to act on it is `-inc-02`'s call, not this module's.
 *
 * FOUR PARTS, each of which its suite pins with a case that differs by that part alone:
 *  - `(?:^|[^\w.])` — a word BOUNDARY that also excludes a leading dot, so `latest(` and `mytest(`
 *    are not `test(`, and `suite.it(` is a method call on an object rather than a declaration;
 *  - the three runner roots, in the spellings `node:test` and `bun:test` share;
 *  - `(?:\.\w+)?(?:\([^)]*\))?` — a `.skip`/`.todo`/`.each` modifier AND the CURRIED call the table
 *    form makes, `it.each(table)("title", fn)`. The second group was missing until the suite's
 *    discriminating cases asked for it: without it a `.each` fixture inside a template literal read
 *    as ordinary prose, which is a false negative in exactly the expensive direction;
 *  - `\s*\(\s*['"\`]` — a call whose first argument is a STRING, so `test(fn, 1)` and prose that
 *    merely contains the word are not declarations.
 */
const TEST_SOURCE_AS_DATA = /(?:^|[^\w.])(?:describe|test|it)(?:\.\w+)?(?:\([^)]*\))?\s*\(\s*['"`]/;

/** One judgeable test declaration: the unit, its context, and where it came from. */
export interface TestUnit {
  /** Repo-relative path with forward slashes — stable across platforms, so a finding is addressable. */
  readonly file: string;
  /** 1-based line of the declaration, so a finding reads as `file:line` and opens in an editor. */
  readonly line: number;
  /** The title as statically read. `""` when built entirely at runtime; partial when part-runtime. */
  readonly name: string;
  /** The enclosing `describe`/`test` titles, outermost first — `[]` at the top level. */
  readonly ancestors: readonly string[];
  /** The call that declares it. A `describe` is included: a suite can be hollow too. */
  readonly call: "describe" | "test" | "it";
  /**
   * The declaration's OWN source text — the call and everything lexically inside it. **This is the
   * unit, and choosing it is the substantive act of this module**: `extracted-unit-decides-the-verdict-not-the-judge`
   * records that the verdict is only ever as good as the state handed over.
   */
  readonly source: string;
  /**
   * The enclosing declarations this unit's text actually REFERENCES — imports, fixtures, helpers,
   * constants — outermost first, joined by blank lines. Empty when the unit references nothing beyond
   * itself.
   *
   * ⚠ WHY THIS IS NOT OPTIONAL POLISH. "Does this test verify anything?" is unanswerable about a body
   * whose fixture is out of frame: an assertion against `EXPECTED` is exact and provable if `EXPECTED`
   * is built by the subject, and vacuous if it is a literal the test also fed in. That distinction —
   * the `an-assertion-over-pre-arranged-input-cannot-fail` shape, this repo's dominant real weakness —
   * lives ENTIRELY in the fixture, so a judge shown the body alone cannot see the very thing the
   * scenario library exists to detect.
   *
   * Filtered by reference rather than dumped whole, so the context stays proportional to the unit. It
   * over-includes before it under-includes (a same-named declaration in a sibling scope can ride
   * along): surplus context costs a judge tokens, missing context costs it the answer.
   */
  readonly context: string;
  /** The whole title whose last element is this unit's own — what a reader sees in a test report. */
  readonly titlePath: readonly string[];
  /** FALSE when the title was built at runtime, so {@link name} under-states the real one. */
  readonly titleFullyStatic: boolean;
  /** Skipped for CERTAIN — a `.skip`/`.todo` modifier, a literal options-form skip, or nested under one. */
  readonly skipped: boolean;
  /** Skipped under a condition a static read cannot evaluate (`{ skip: !DB }`). Never with {@link skipped}. */
  readonly conditionallySkipped: boolean;
  /**
   * Its region holds at least one substantive assertion. **A cheap negative prior, never a verdict**:
   * FALSE is already strong evidence of hollowness and costs nothing to compute, so a consumer can
   * spend its classifier budget where this cannot answer. TRUE means only that an assertion exists —
   * the shape this arc is built around is an assertion that is maximally exact and still cannot fail,
   * which by construction reads TRUE here.
   */
  readonly substantive: boolean;
  /** A table-bound `.each` declaration, which one row-per-case runner expands into several. */
  readonly parameterised: boolean;
  /**
   * The FILE this unit came from carries test source as DATA (a fixture in a string or template
   * literal). Not a property of the unit and unknowable from it — see the header. TRUE means a
   * consumer is in the neighbourhood that produced the withdrawn 2.8%.
   */
  readonly fileAnalysesTests: boolean;
  /**
   * The file is a `*.uat.test.ts` acceptance leg.
   *
   * INCLUDED, unlike in `check:mutation-diff`, and the asymmetry is reasoned rather than inherited.
   * That rung excludes them for a RUNTIME reason with no analogue here: they spawn a real CLI against
   * a real server started in a `before` hook, and Stryker's coverage re-run finds the door dead, so
   * the dry run fails and the whole rung evaluates zero mutants. Nothing in this module executes
   * anything, so a static read of an acceptance leg is exactly as sound as any other file.
   *
   * Flagged rather than silently mixed in, because the JUDGEMENT differs even though the extraction
   * does not: a spawn-based leg legitimately asserts on process exit codes and served bytes, and a
   * battery calibrated on unit tests may over-fire on it. That is a per-scenario call for `-inc-02`,
   * which can only make it if the fact reaches it.
   */
  readonly uatLeg: boolean;
}

/** What reading one file yielded — including the two ways it can yield nothing. */
export interface FileExtraction {
  /** Repo-relative path with forward slashes. */
  readonly file: string;
  /** The units found, in source order. */
  readonly units: readonly TestUnit[];
  /** The file carries test source as data — the file-altitude guard. */
  readonly analysesTests: boolean;
  /** How many string/template literals matched {@link TEST_SOURCE_AS_DATA} — the flag's magnitude. */
  readonly testSourceLiterals: number;
}

/**
 * The coverage report — **the half of this increment that stops a future sweep from quietly measuring
 * a tenth of the suite.**
 *
 * The withdrawn run's glob `packages/<name>/src` with a `.test.ts` tail only matched **83 of 970** test files: all of
 * `packages/cli`'s 223, `forest-world-r3f`'s 137, `drive`'s 94 and every file under `apps/` were
 * silently absent, and nothing in the output said so. A rate over 8.5% of a suite is not a rate. So
 * this is returned BESIDE the units rather than offered as an option, and it reports the denominator
 * it was measured against rather than asserting a number this code cannot know.
 */
export interface ExtractionCoverage {
  /** Files the enumerator offered — the denominator every rate here is over. */
  readonly enumerated: number;
  /** Files read and parsed without throwing. */
  readonly parsed: number;
  /** Files that could not be READ, with the reason — a path offered by git and absent on disk. */
  readonly unreadable: readonly { readonly file: string; readonly reason: string }[];
  /**
   * Files that parsed and declared NO test — **a third state, named because it is neither of the
   * failures above and is not necessarily one at all.** Both instances on `main` at the time of
   * writing are legitimate and instructive: `relocation.fixture.test.ts` says in its own first line
   * that it declares no tests (the `.test.ts` suffix buys it an exclusion from mutation), and
   * `change-event-store.test.ts` declares its tests by CALLING an imported parity suite, so the
   * declarations exist one module away. NAMED rather than counted: the list is short, and eyeballing
   * it is the cheapest audit that separates "correct" from "this extractor is blind to a convention".
   */
  readonly zeroDeclarationFiles: readonly string[];
  /** Total units emitted. */
  readonly units: number;
  /** Units whose title could not be read in full — a statement about this reader, not about the test. */
  readonly unreadTitles: number;
  /** Files carrying test source as data — the neighbourhood the withdrawn rate came from. */
  readonly filesAnalysingTests: readonly string[];
}

/** Units plus the coverage they were measured under. Never one without the other. */
export interface RepoExtraction {
  readonly units: readonly TestUnit[];
  readonly coverage: ExtractionCoverage;
}

/** The glob pair that enumerates this repo's tests. Both extensions, every workspace, `apps/` included. */
export const TEST_FILE_GLOBS: readonly string[] = ["*.test.ts", "*.test.tsx"];

/**
 * The statement kinds that can be a test's fixture or helper — what {@link contextFor} may quote.
 *
 * A SET of kinds rather than a chain of `ts.isX(node) ||` guards, and the reason is measured rather
 * than stylistic: that chain was six disjuncts, every one of them a branch no test can distinguish
 * (flip any single `ts.isX` to `true` and the extra nodes it admits simply bind no names and fall
 * out one step later), so it contributed fifteen surviving mutants on this module's first
 * `check:mutation-diff` run. A `Set.has` is ONE branch and says exactly the same thing. This is the
 * house remedy for a survivor on an unreachable decision — reach for the structure, not for more
 * tests.
 */
const CONTEXT_KINDS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
  ts.SyntaxKind.EnumDeclaration,
]);

/**
 * The identifier names a declaration BINDS — `helper` from a function, `a` and `b` from a
 * destructuring `const { a, b } = …`, every specifier of an import.
 *
 * READ OFF THE `name` NODES BY WALKING, not by switching on declaration kind. TypeScript records a
 * binding's identifier as `.name` on every declaration form, so one walk covers the import clause,
 * the namespace import, each specifier, each variable declarator, each nested binding element and
 * the plain function/class/type/interface/enum name — where the kind switch needed a separate arm
 * (and a separate unkillable branch) for each.
 *
 * It OVER-collects slightly: a method name inside a class, a property name in an object literal
 * initialiser. That is the safe direction and the same one {@link TestUnit.context} already
 * documents — a surplus name can only make the reference filter more permissive, and the cost of a
 * surplus is tokens while the cost of a miss is the answer.
 */
function boundNames(node: ts.Node): string[] {
  // Stryker disable next-line ArrayDeclaration: EQUIVALENT — a seeded name in this accumulator is
  // never REFERENCED by any unit, so `contextFor`'s `names.some(n => referenced.has(n))` filter
  // drops it one step later and no output moves. Killing it would need the candidate list itself
  // to be observable, which would mean exporting an internal for the sake of a mutant.
  const names: string[] = [];
  const visit = (n: ts.Node): void => {
    const name = (n as ts.Node & { readonly name?: ts.Node }).name;
    if (name !== undefined && ts.isIdentifier(name)) names.push(name.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/** One candidate piece of enclosing context: what it binds, its text, and the span it occupies. */
interface ContextCandidate {
  readonly names: readonly string[];
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Every import and named declaration in the file, at EVERY scope — a fixture declared inside a
 * `describe` is context for the tests under it just as a top-level one is, and restricting this to the
 * top level would lose the commonest arrangement in this repo. Source-ordered.
 */
function contextCandidates(sf: ts.SourceFile): ContextCandidate[] {
  const found: ContextCandidate[] = [];
  const visit = (node: ts.Node): void => {
    if (CONTEXT_KINDS.has(node.kind)) {
      // NO `names.length > 0` GUARD, and its absence is the point. A candidate that binds nothing —
      // `import "./side-effect.js";` is the real instance — can never match the reference filter in
      // `contextFor`, because `[].some(…)` is false. So the guard skipped work that was already
      // inert, and a branch with no observable effect is a branch no test can distinguish: it
      // contributed two permanent survivors on this module's first mutation run. Deleting a dead
      // decision beats testing one (`mutation-survivors-are-usually-unreachable-decisions`).
      found.push({
        names: boundNames(node),
        text: node.getText(sf),
        start: node.getStart(sf),
        end: node.getEnd(),
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return found;
}

/**
 * The identifiers a span's TEXT mentions. Read off the tokens of a throwaway re-parse rather than by
 * regex, so a name occurring inside the unit's own strings or comments does not pull in context the
 * code never touches — the same "a literal is not code" rule this whole module turns on, applied one
 * level down.
 */
function referencedNames(source: string): Set<string> {
  const names = new Set<string>();
  // A span is an expression, not a module: wrap it so the parser has something well-formed to chew.
  // Stryker disable next-line StringLiteral,BooleanLiteral: EQUIVALENT on both counts. The NAME only
  // selects the parse, and TypeScript's parser recovers from a JSX-shaped expression read as TS well
  // enough to still yield its identifiers — which is all this function reads. `setParentNodes` is
  // likewise unobservable: the walk uses `forEachChild` and reads `.text`, never `.parent`.
  const sf = ts.createSourceFile("__span__.tsx", `(${source});`, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — `true` adds `undefined` for every
    // non-identifier node while the walk still reaches every real identifier, so the resulting set is a
    // superset that differs only by a value no declaration can be named.
    if (ts.isIdentifier(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return names;
}

/**
 * The context for one unit: the candidates it REFERENCES and does not CONTAIN.
 *
 * Two filters, and each earns its place. **Referenced** keeps the context proportional — a 900-line
 * test file's every fixture attached to every unit would bury the unit and blow a state budget.
 * **Not contained** drops declarations that live inside this very unit: they are already in
 * {@link TestUnit.source}, and quoting them twice would make a self-contained test read as though it
 * depended on something outside itself.
 */
function contextFor(unit: { start: number; end: number; source: string }, candidates: readonly ContextCandidate[]): string {
  const referenced = referencedNames(unit.source);
  const kept = candidates.filter(
    // Stryker disable next-line EqualityOperator: EQUIVALENT at both bounds — a candidate and a unit
    // can never share a start or an end offset, because CONTEXT_KINDS holds no test-call node and a
    // unit IS one. The strict and non-strict forms therefore agree on every input this can receive.
    (c) => !(c.start >= unit.start && c.end <= unit.end) && c.names.some((n) => referenced.has(n)),
  );
  return kept.map((c) => c.text).join("\n\n");
}

/**
 * The node kinds that CARRY literal text — the only places test source can hide as data.
 *
 * A Set for the same measured reason as {@link CONTEXT_KINDS}: as a chain of `ts.isX(node) ||`
 * guards this was five branches that no test can tell apart, because flipping any one to `true`
 * admits nodes whose `.text` is `undefined` and which therefore fall out at the regex one step
 * later.
 *
 * `TemplateExpression` is deliberately ABSENT and needs no case: it holds no text of its own, and
 * `forEachChild` reaches its head and each span's middle/tail, so a fixture broken up by `${…}` is
 * still read — in pieces, which is what makes the count a magnitude rather than a file count.
 */
const TEXT_BEARING_KINDS: ReadonlySet<ts.SyntaxKind> = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
]);

/** Every string and template literal in the file whose TEXT reads as a test declaration. */
function countTestSourceLiterals(sf: ts.SourceFile): number {
  let count = 0;
  const visit = (node: ts.Node): void => {
    // Stryker disable next-line ConditionalExpression: EQUIVALENT — `true` feeds every node's `.text`
    // to the pattern, and a node that bears no literal text yields `undefined`, which the pattern
    // cannot match. The only other text-bearing node a test file reaches is an identifier, whose text
    // is a single token and cannot contain a call.
    if (TEXT_BEARING_KINDS.has(node.kind)) {
      // `.text` is the literal's CONTENT for every kind in the set — the membership test above is
      // what makes this cast sound.
      if (TEST_SOURCE_AS_DATA.test((node as ts.LiteralLikeNode).text)) count += 1;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sf, visit);
  return count;
}

/**
 * PURE: one file's text in, judgeable units out. No filesystem, no network, no clock — the parser is
 * the only impurity, and `file` selects the parse exactly as it does for `analyzeObservedTests`
 * (a `.tsx` file parses with JSX, a `.ts` file without; neither parse is safe for the other kind).
 *
 * THROWS nothing on unparseable input: TypeScript's parser recovers, and a file whose syntax it cannot
 * follow simply yields fewer units. That is reported as a zero-declaration file rather than as an
 * error, because "this reader saw nothing" and "there is nothing here" are different claims and the
 * coverage report is where they are told apart.
 */
export function extractTestUnits(source: string, file: string): FileExtraction {
  const normalised = file.replaceAll("\\", "/");
  // Stryker disable next-line BooleanLiteral: EQUIVALENT — `setParentNodes` only populates
  // `node.parent`, and nothing reached from this parse reads it: the walks use `forEachChild`, and
  // `getText`/`getStart` are passed the source file explicitly rather than finding it via a parent.
  const sf = ts.createSourceFile(normalised, source, ts.ScriptTarget.Latest, true);
  const testSourceLiterals = countTestSourceLiterals(sf);
  const analysesTests = testSourceLiterals > 0;
  const uatLeg = normalised.endsWith(".uat.test.ts");
  const candidates = contextCandidates(sf);
  const units: TestUnit[] = [];
  for (const observed of analyzeObservedTests(source, normalised)) {
    const span = observed.span;
    // A hand-built `ObservedTest` literal carries no span (the field is optional for that reason), and
    // without one there is no text to judge. Skipping is the only honest option: a unit with an empty
    // `source` would read to a classifier as a test that asserts nothing.
    // Stryker disable next-line ConditionalExpression: EQUIVALENT in this call path and UNREACHABLE by
    // construction — `analyzeObservedTests` supplies a span on every row it builds (asserted directly
    // by "a unit is emitted for every observed test that carries a span"). The field is optional only
    // because a hand-built literal predates it, so this is the optional-undefined guard shape that is
    // an equivalent mutant by construction (`optional-undefined-guard-is-an-unkillable-mutant`); the
    // type demands it and no input can take the other branch.
    if (span === undefined) continue;
    const text = source.slice(span.start, span.end);
    units.push({
      file: normalised,
      line: sf.getLineAndCharacterOfPosition(span.start).line + 1,
      name: observed.name,
      ancestors: observed.ancestors,
      // Stryker disable next-line StringLiteral: UNREACHABLE — `analyzeObservedTests` sets `call` on
      // every row it builds, so this fallback is never taken. The field is optional for the same
      // reason `span` is (a hand-built literal predates it), and the same guard above already drops
      // any row those literals could produce. Replacing the default changes nothing an input can
      // reach; the honest alternative would be to widen the published type, which is not this
      // module's to change.
      call: observed.call ?? "test",
      source: text,
      context: contextFor({ start: span.start, end: span.end, source: text }, candidates),
      titlePath: [...observed.ancestors, observed.name],
      titleFullyStatic: observed.titleFullyStatic,
      skipped: observed.skipped,
      conditionallySkipped: observed.conditionallySkipped,
      substantive: observed.substantive,
      parameterised: observed.parameterised === true,
      fileAnalysesTests: analysesTests,
      uatLeg,
    });
  }
  return { file: normalised, units, analysesTests, testSourceLiterals };
}

/**
 * PURE: fold per-file reads into units plus their coverage. Separated from the IO so the report's
 * arithmetic is provable against literals — the report is the thing a future sweep will trust, and
 * `measurement-instrument-must-be-typechecked` is about instruments whose numbers were never checked.
 */
export function foldExtractions(
  enumerated: readonly string[],
  read: readonly FileExtraction[],
  unreadable: readonly { readonly file: string; readonly reason: string }[],
): RepoExtraction {
  const units = read.flatMap((r) => r.units);
  return {
    units,
    coverage: {
      enumerated: enumerated.length,
      parsed: read.length,
      unreadable,
      zeroDeclarationFiles: read.filter((r) => r.units.length === 0).map((r) => r.file),
      units: units.length,
      unreadTitles: units.filter((u) => !u.titleFullyStatic).length,
      filesAnalysingTests: read.filter((r) => r.analysesTests).map((r) => r.file),
    },
  };
}

/**
 * The enumerator: every test file git TRACKS, which is the only denominator that cannot silently
 * shrink. A hand-written glob is what produced 83-of-970; `git ls-files` answers with the repo's own
 * index, so a new workspace or a new `apps/` directory joins without anyone remembering to widen a
 * pattern.
 */
/**
 * PURE: the census refusal. Returns `files` unchanged, or THROWS naming the cause.

 * Split out from {@link enumerateTestFiles} for the same reason {@link parseLsFiles} is: every test
 * that could reach this branch through the process call is one that must stand down outside a git
 * checkout, and outside a git checkout is precisely where `check:mutation-diff` runs the suite. A
 * refusal nothing can exercise is a refusal nothing is holding to its wording.
 */
export function refuseEmptyCensus(files: readonly string[], repoRoot: string): string[] {
  if (files.length === 0) {
    throw new Error(
      `no git-tracked test files under ${repoRoot} — refusing to report a census over zero files. ` +
        "`git ls-files` returns nothing (exit 0) when run outside a git work tree or inside an " +
        "ignored directory, so a zero here is a statement about this reader's position and never " +
        "about the suite. Point it at a git checkout, or pass an explicit file list.",
    );
  }
  return [...files];
}

/**
 * PURE: `git ls-files` output into a sorted, deduplicated file list.
 *
 * SPLIT OUT FROM THE PROCESS CALL DELIBERATELY. The parsing has real behaviour — git emits a
 * trailing newline, so the last split element is always empty and a missing filter would hand a
 * caller `""` as a filename — and every test that could exercise it THROUGH {@link
 * enumerateTestFiles} is one that must stand down outside a git checkout, which is exactly where
 * `check:mutation-diff` runs the suite. So proving it through the process call proves it nowhere the
 * rung can see. As a pure function it is provable against literals, in the sandbox, for free.
 */
export function parseLsFiles(out: string): string[] {
  return [
    ...new Set(
      out
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  ].sort();
}

export function enumerateTestFiles(repoRoot: string): string[] {
  const out = execFileSync("git", ["ls-files", ...TEST_FILE_GLOBS], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const files = parseLsFiles(out);
  // ⚠ AN EMPTY CENSUS IS REFUSED, and this is the sharpest lesson of the increment rather than
  // defensive padding. `git ls-files` does NOT fail inside a gitignored directory — it succeeds and
  // returns nothing, so a caller gets a clean, confident report over ZERO files. That reads as a
  // healthy `0.00%` and is indistinguishable in a summary from a suite with no slop in it.
  //
  // MEASURED, on this increment's own first gate run: `check:mutation-diff` copies the tree into
  // `.stryker-tmp/sandbox-<id>` WITHOUT a `.git`, and `git ls-files` there returned 0 of 977 files
  // while exiting 0. `measurement-instrument-must-be-typechecked` states the general rule this is an
  // instance of — a zero deserves more suspicion than a wrong-looking number, because a zero is what
  // both a true absence and a broken reader produce. There is no true absence here: this repo tracks
  // 977 test files, so zero can only mean the reader is pointed somewhere it cannot see.
  return refuseEmptyCensus(files, repoRoot);
}

/** The IO shell: enumerate, read, fold. Every judgement-bearing decision is in the pure half above. */
export function extractRepoTestUnits(repoRoot: string, files?: readonly string[]): RepoExtraction {
  const enumerated = files ?? enumerateTestFiles(repoRoot);
  const read: FileExtraction[] = [];
  const unreadable: { file: string; reason: string }[] = [];
  for (const rel of enumerated) {
    let source: string;
    try {
      source = readFileSync(`${repoRoot}/${rel}`, "utf8");
    } catch (error) {
      unreadable.push({ file: rel, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }
    read.push(extractTestUnits(source, rel));
  }
  return foldExtractions(enumerated, read, unreadable);
}

/** The coverage report as the lines a human reads — the cheap repeat the increment asks for. */
export function renderCoverage(coverage: ExtractionCoverage): string {
  const lines = [
    `test files enumerated:  ${coverage.enumerated}`,
    `  parsed:               ${coverage.parsed}`,
    `  unreadable:           ${coverage.unreadable.length}`,
    `  declared no test:     ${coverage.zeroDeclarationFiles.length}`,
    `test units extracted:   ${coverage.units}`,
    `  titles not static:    ${coverage.unreadTitles}`,
    `files with test-as-data: ${coverage.filesAnalysingTests.length}`,
  ];
  for (const { file, reason } of coverage.unreadable) lines.push(`  UNREADABLE  ${file} — ${reason}`);
  for (const file of coverage.zeroDeclarationFiles) lines.push(`  NO TEST     ${file}`);
  for (const file of coverage.filesAnalysingTests) lines.push(`  TEST-AS-DATA ${file}`);
  return lines.join("\n");
}
