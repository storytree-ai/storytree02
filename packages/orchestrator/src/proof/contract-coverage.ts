// THE PARSER, NOT THE COMPILER — and the reason the alias exists (ADR-0400).
//
// `typescript@7` is the Go-native compiler and its package entry point exports only a version
// stub: the AST surface used below (`createSourceFile`, `forEachChild`, `SyntaxKind`, the `is*`
// guards) moved to explicitly UNSTABLE subpaths (`typescript/unstable/ast`). This module does not
// COMPILE anything — it parses our own test sources to read their call titles — so it pins
// TypeScript 5.7's stable compiler API as a parsing library under the `typescript5` alias rather
// than taking a dependency on an API upstream labels unstable. Typechecking is native `tsc@7`.
import ts from "typescript5";

import type { ContractDecl } from "@storytree/library";

import { hashSpan } from "./anchor-compute.js";

/**
 * The CONTRACT-COVERAGE classifier (ADR-0020 coverage-honesty follow-on, owner-ratified 2026-06-27).
 *
 * ADR-0020 made red→green non-forgeable: the spine observes the RED then the GREEN of *the new test*
 * out-of-band and signs the verdict spine-side, so a leaf can never forge the test it authored. But a
 * signed green proves only that ONE authored test went red→green — NOT that every enumerated
 * `## Contracts` behaviour under the unit has a test. The leaf reliably drops the hardest
 * robustness/concurrency contract (documented: `fr-bounded-never-hangs` landed UNDER a signed green),
 * and nothing caught the under-coverage. So "trustworthy" is correctly scoped to "cannot forge the
 * authored test," not "the whole spec is proven."
 *
 * This is the structural, offline check: it maps each declared contract to an OBSERVED test by the
 * naming convention — a contract is covered iff some test names it (the convention
 * `describe("<contract-id>: …")`, proven real by `deploy-health-signal`'s three contracts naming
 * `deploy-health.test.ts`'s three suites). Pure-by-injection (contract ids + test names in, report out),
 * deterministic, order-preserving — it mirrors {@link import("./adoption-proposal.js").classifyAdoption}
 * one tier DOWN (that is capability→gate coverage; this is contract→test coverage). No store / git / clock.
 *
 * HOLLOW-TEST DETECTION (ADR-0126, owner-directed 2026-06-27 — static AST over a runtime signal):
 * the first slice (ADR-0122) counted a test NAMED for a contract even if it was HOLLOW (`assert(true)`
 * under the right name). That is now closed at the EXTRACTION step: {@link extractVouchingTestNames}
 * parses the test source (the TypeScript compiler AST) and feeds the classifier only the names of tests
 * that actually VOUCH — a test that is not skipped (by a `.skip`/`.todo` modifier, or by an options-form
 * `skip`/`todo` whose value is anything but a falsy literal) AND asserts something SUBSTANTIVE (an
 * `assert`/`expect` call with ≥1 argument that is not a trivially-constant literal). A hollow test is
 * simply absent from the observed names, so its contract reads UNCOVERED. Still STATIC and offline —
 * no execution, no `t.assert` plan-counting (this codebase asserts via `node:assert/strict`, which a
 * runtime reporter never counts), aligning with ADR-0020 §4's "no `assert(true)` / skipped-test" guards
 * as a lint-shaped rule.
 *
 * THE AXES AND THEIR FOLDS — they do not all point the same way, and each is honest only when read
 * against its own axis (corrected 2026-08-06; the module previously stated the first two as unscoped
 * global claims, which read as a contradiction and let the second quietly deliver the outcome the first
 * forbids):
 *
 *  - **HOLLOWNESS — folds toward "COVERED" (ADR-0126).** Detection is CONSERVATIVE: it flags only a
 *    clearly-hollow test (no assertion, a constant-only assertion, or a skip), never a real test. The
 *    bias exists to avoid FALSE-HOLLOWS — telling an honest author their real test does not count. A
 *    test that asserts something SUBSTANTIVE but semantically IRRELEVANT to its contract
 *    (`assert.ok(unrelated)` under the right name) still reads covered; that residue is MUTATION
 *    TESTING's follow-on, NOT a semantic reviewer-agent's (ADR-0447 D2, reversing what ADR-0122
 *    anticipated here): a killed mutant is an observation, where a model judging a model's test is
 *    an opinion sharing the failure mode it judges. A semantic reviewer keeps only what mutation
 *    provably cannot reach. Either way it is not a structural check.
 *  - **READABILITY — folds toward "UNCOVERED".** A title this checker cannot read statically vouches
 *    for nothing, because a name it never saw cannot be shown to carry a contract id. That fold is
 *    only legitimate for what is GENUINELY unreadable: whenever the title is statically readable it
 *    MUST be read, or the readability fold silently delivers the false-hollow the hollowness fold
 *    exists to prevent. That is not hypothetical — it was live until 2026-08-06 (see
 *    {@link readTestCallTitle}), when a `+`-concatenated title stamped `coverage 0/6` onto a signed
 *    `--real` verdict whose six tests all existed, named their contracts verbatim, and passed.
 *  - **EXECUTABILITY — folds toward "UNCOVERED" (2026-09-16).** A test skipped by the options form
 *    under a CONDITION (`{ skip: !DB }`) may or may not run, and a static read cannot know where the
 *    file loads, so it vouches for nothing: a run nobody can show happened proves nothing. The cost is
 *    stated rather than hidden. Such a test DOES run where its condition holds (a `--real` build forces
 *    the database a `!DB` gate reads), so a contract proven only there reads uncovered on every surface
 *    that takes the vouching names, the signed verdict's coverage axis included, and unlike an unread
 *    title it is not yet counted apart from an absent test. The per-test review, which also holds the
 *    runner's report, reads the difference ({@link ObservedTest.conditionallySkipped}; ADR-0573 C6).
 *
 * Because the two folds disagree, an UNREAD title and an ABSENT test must never share a bucket: "I
 * could not read six titles" and "six tests are missing" are different claims, and a report that
 * conflates them is not a report. {@link readTestSurface} keeps them apart — the vouching names on
 * one side, the count of titles that could not be read in full on the other.
 *
 * The convention it enforces (a test name carries its contract's id) stays a checkable standard.
 */

// ---------------------------------------------------------------------------
// Name-match: does a test name cover a contract id?
// ---------------------------------------------------------------------------

/** A character that is part of a contract-id token (ids are kebab: letters, digits, `-`, `_`). */
const ID_TOKEN_CHAR = /[A-Za-z0-9_-]/;

/** A position is a token boundary when it is the string edge or a non-id-token character. */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || !ID_TOKEN_CHAR.test(ch);
}

/**
 * PURE: does `testName` NAME `contractId` — i.e. contain it as a whole token? Boundary-aware on BOTH
 * sides (the chars around the match must not be id-token chars), so `fr-bounded` never matches a test
 * named for `fr-bounded-never-hangs` (the trailing `-` is an id char → not a boundary), and the
 * convention `describe("<id>: …")` matches (the trailing `:` IS a boundary). No regex on the id, so a
 * contract id with regex metacharacters is matched literally and safely.
 */
export function testNameCoversContract(testName: string, contractId: string): boolean {
  if (contractId.length === 0) return false;
  for (let from = 0; ; ) {
    const at = testName.indexOf(contractId, from);
    if (at < 0) return false;
    const before = at > 0 ? testName[at - 1] : undefined;
    const afterIdx = at + contractId.length;
    const after = afterIdx < testName.length ? testName[afterIdx] : undefined;
    if (isBoundary(before) && isBoundary(after)) return true;
    from = at + 1; // a non-boundary hit (a longer id contains this id as a substring) — keep scanning
  }
}

// ---------------------------------------------------------------------------
// Static test-name extraction
// ---------------------------------------------------------------------------

/**
 * The first string-literal argument of a `describe` / `test` / `it` call (with an optional
 * `.skip`/`.only`/`.each` modifier). Handles `'…'`, `"…"`, and `` `…` `` literals, with backslash
 * escapes. `\b` before the call name avoids matching `commit(` / `mytest(`. Static — it reads the
 * SOURCE, never executes it (offline, fail-closed: a file it cannot read contributes no names).
 */
const TEST_CALL_NAME = /\b(?:describe|test|it)(?:\.\w+)?\s*\(\s*(['"`])((?:\\.|(?!\1)[^])*?)\1/g;

/**
 * PURE: extract the declared test/suite names from a test file's SOURCE text — every `describe`/
 * `test`/`it` call's first string-literal arg, in source order.
 *
 * LEGACY / CONTRAST ONLY — not the coverage input. Every production loader reads
 * {@link readTestSurface} (via {@link extractVouchingTestNames}); this regex survives as the
 * pre-ADR-0126 name-presence signal the hollow-detection tests contrast against. It reads titles
 * DIFFERENTLY from the AST path and is not maintained to agree with it: it captures only the FIRST
 * literal of a `+`-concatenated title (`"a: x" + "more"` → `"a: x"`), keeps a template's `${…}`
 * verbatim rather than eliding it, and does not see through parentheses. Read the AST path for what
 * coverage actually observes.
 */
export function extractTestNames(testSource: string): string[] {
  const names: string[] = [];
  for (const match of testSource.matchAll(TEST_CALL_NAME)) {
    names.push(match[2] ?? "");
  }
  return names;
}

// ---------------------------------------------------------------------------
// Hollow-test detection (ADR-0126): a test only VOUCHES if it runs and asserts substantively
// ---------------------------------------------------------------------------

/** A test/suite call observed in a test file's AST — the hollow-detection unit (ADR-0126). */
export interface ObservedTest {
  /**
   * The test/suite name as READ from source — what contract ids are matched against. `""` when the
   * title is built entirely at runtime; a PARTIAL read (the static text only) when it is part
   * runtime, which `titleFullyStatic` distinguishes from a clean read.
   */
  name: string;
  /**
   * TRUE iff the whole title was statically readable. FALSE means this checker read some or none of
   * it, so `name` under-states the real title and a contract it would have named can read UNCOVERED
   * for a reason that has nothing to do with the test being absent or hollow. Surfaced as a count by
   * {@link readTestSurface} so a `0/N` report can say WHICH of the two things it means.
   */
  titleFullyStatic: boolean;
  /**
   * Skipped for CERTAIN: a `.skip`/`.todo` modifier, an options-form `skip`/`todo` whose value is a
   * truthy literal (`{ skip: true }`, `{ skip: "reason" }`), or nested under either. It never runs (a
   * `todo` runs but cannot fail the run), so it cannot vouch.
   */
  skipped: boolean;
  /**
   * Skipped UNDER A CONDITION: an options-form `skip`/`todo` whose value is not a literal
   * (`{ skip: !DB }`, a ternary, a shorthand `{ skip }`), on this call or an enclosing one. Whether it
   * runs depends on the environment the file loads in, which a static read cannot know. Never true
   * together with {@link skipped}: a certain skip anywhere above or on the call outranks it.
   */
  conditionallySkipped: boolean;
  /**
   * Its lexical region, nested tests included, holds ≥1 SUBSTANTIVE assertion (an `assert`/`expect`
   * call with ≥1 argument that is not a trivially-constant literal), read whether or not it is skipped.
   * The substance half of {@link vouches}, exposed on its own for a consumer whose policy on a
   * conditional skip is not coverage's (ADR-0573 C6).
   */
  substantive: boolean;
  /**
   * VOUCHES for its name iff it is {@link substantive} AND skipped in NEITHER form. A hollow
   * `assert(true)` (or no assertion at all) does NOT vouch, and neither does a test that may not have
   * run. Only vouching names reach the coverage classifier, so a hollow or gated test's contract reads
   * UNCOVERED.
   */
  vouches: boolean;
  /**
   * The ENCLOSING test/suite titles, outermost first — `[]` at the top level. Read as source, with
   * the same partial/unread semantics as {@link name}.
   *
   * Why the coverage direction never needed this and the INVERSE direction does. Coverage asks "does
   * some observed test name this contract?", and an outer `describe("<contract-id>: …")` answers it
   * on its own — the describe is itself an observed test, vouching whenever anything under it
   * asserts. The inverse question ("which contract claims THIS behaviour?") is asked of the leaf
   * `it`, whose own title routinely carries no id while its enclosing describe does; matching that
   * leaf against contract ids in isolation would report a claimed behaviour as contractless. See
   * {@link classifyBehaviourClaims}, which matches over the ancestry-joined title.
   */
  ancestors: readonly string[];
  /**
   * The call that declares it: `describe` (a suite) or `test` / `it`. OPTIONAL only because a hand-built
   * literal predates it; {@link analyzeObservedTests} always supplies it. The per-test join (ADR-0573)
   * reads it because an empty suite reports no test row on any runner.
   */
  call?: TestCallRoot;
  /**
   * A fingerprint of this declaration s own source span — the call and everything lexically inside it
   * (ADR-0585). Two reads of an UNCHANGED test agree; any rewrite of its body, its assertions or its
   * options moves it, which is what lets a build tell a pre-existing test it left alone from one it
   * updated. OPTIONAL for the same reason {@link call} is: a hand-built literal predates it, and
   * {@link analyzeObservedTests} always supplies it.
   */
  bodyHash?: string;
  /**
   * TRUE for a table-bound declaration — `it.each(table)(title, fn)` — which ONE declaration the runner
   * expands into several rows, so no reported row can be bound to it one-to-one (ADR-0573 D3). OPTIONAL
   * for the same reason as {@link call}.
   */
  parameterised?: boolean;
}

/** A test-runner call root whose first string arg names a test/suite. */
type TestCallRoot = "describe" | "test" | "it";

/** The test-runner call roots whose first string arg names a test/suite (mirrors `extractTestNames`). */
const TEST_CALL_ROOTS: ReadonlySet<string> = new Set<TestCallRoot>(["describe", "test", "it"]);

function isTestCallRoot(root: string): root is TestCallRoot {
  return TEST_CALL_ROOTS.has(root);
}
/** Modifiers that mean "named but never runs" — a `.skip`/`.todo` test asserts nothing at runtime. */
const SKIP_MODIFIERS = new Set(["skip", "todo"]);
/**
 * Modifiers that make a call a table-bound FACTORY rather than a test declaration: `it.each(table)`
 * returns the function that is THEN called with the title. See {@link matchTestCall}.
 */
const EACH_MODIFIERS = new Set(["each"]);
/** The assertion-API roots this codebase uses: `node:assert/strict` (`assert.*`) and vitest (`expect`). */
const ASSERTION_NAMES = new Set(["assert", "expect"]);

/**
 * Walk a call's callee expression to its leftmost root identifier, collecting the member names along
 * the way. `describe.each([...])(name, …)` → root `describe`, members `["each"]`; `assert.ok(x)` →
 * root `assert`, members `["ok"]`; `expect(x).toBe(y)` → root `expect`, members `["toBe"]`;
 * `t.assert.ok(x)` → root `t`, members `["ok", "assert"]`. Unwraps call/paren/non-null wrappers.
 */
function calleeParts(expr: ts.Expression) {
  const members: string[] = [];
  let node: ts.Expression = expr;
  for (;;) {
    if (ts.isPropertyAccessExpression(node)) {
      members.push(node.name.text);
      node = node.expression;
    } else if (ts.isElementAccessExpression(node)) {
      node = node.expression;
    } else if (ts.isCallExpression(node)) {
      node = node.expression; // descend e.g. `describe.each([...])(…)`'s inner call
    } else if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
      node = node.expression;
    } else {
      break;
    }
  }
  return { root: ts.isIdentifier(node) ? node.text : undefined, members };
}

/** A test title as READ from source: the static text, plus whether the WHOLE title was static. */
export interface ReadTitle {
  /** The statically-readable text — `""` when no part of the title is a literal. */
  text: string;
  /** TRUE iff EVERY part was a static string (no `${…}` substitution, no non-literal operand). */
  fullyStatic: boolean;
}

/**
 * PURE: read a `describe`/`test`/`it` call's title from its first argument. ONE rule, applied
 * uniformly to every title shape: **read the static text, elide the runtime parts, and record
 * whether anything was elided.** Nothing is ever EVALUATED — folding stops at literals, so no
 * identifier, call, or property access is resolved.
 *
 *  - a string / no-substitution template → the text, fully static;
 *  - a parenthesised title → read through the parens (`("c-a: x")`);
 *  - `+` concatenation → both operands read RECURSIVELY and joined. A concatenation of literals is
 *    static and trivially foldable, so it is READ — this is the blind spot fixed 2026-08-06, where a
 *    title split across two lines (the ordinary way to keep a long title readable) was dropped
 *    wholesale and its contract stamped UNCOVERED onto a signed verdict;
 *  - a template with `${…}` → the literal spans, which still carry any id prefix — NOT fully static;
 *  - anything else (a bare identifier, a call) → no static text at all — NOT fully static.
 *
 * The elision is deliberately loss-TOLERANT rather than all-or-nothing, matching the template rule
 * that predates it: the house convention puts the contract id at the LEAD of the title, so the
 * literal text is where an id lives and a runtime part is almost always trailing prose. `fullyStatic`
 * is what keeps that honest — a partially-read title is reported as such ({@link readTestSurface})
 * instead of passing as a clean read. Returns null only when the call has no first argument.
 *
 * EXPORTED so every static reader of a test title in this repo can share ONE spelling. It used to be
 * private and `verification-decay.ts` carried a hand-kept copy, whose own comment named the hazard:
 * the `vacuous-proof` instrument JOINS its names against `extractVouchingTestNames`'s output, so the
 * moment the two spellings diverge the join silently misses and the instrument under-reports while
 * still looking healthy. Fixing the concatenation blind spot here would have caused exactly that, so
 * the copy was deleted in favour of this import — the drift can no longer happen.
 */
export function readTestCallTitle(arg: ts.Expression | undefined): ReadTitle | null {
  if (arg === undefined) return null;
  if (ts.isStringLiteralLike(arg)) return { text: arg.text, fullyStatic: true };
  if (ts.isParenthesizedExpression(arg)) return readTestCallTitle(arg.expression);
  if (ts.isTemplateExpression(arg)) {
    return {
      text: arg.head.text + arg.templateSpans.map((s) => s.literal.text).join(""),
      fullyStatic: false,
    };
  }
  if (ts.isBinaryExpression(arg) && arg.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = readTestCallTitle(arg.left);
    const right = readTestCallTitle(arg.right);
    return {
      text: (left?.text ?? "") + (right?.text ?? ""),
      fullyStatic: left?.fullyStatic === true && right?.fullyStatic === true,
    };
  }
  return { text: "", fullyStatic: false }; // built at runtime — readable text: none
}

/** Options keys that mean "this declaration cannot fail the run": the options-form twins of {@link SKIP_MODIFIERS}. */
const SKIP_OPTION_KEYS: ReadonlySet<string> = new Set(["skip", "todo"]);

/** How certainly a declaration is skipped, as far as a static read can tell. */
type SkipCertainty = "none" | "conditional" | "unconditional";

/** Weakest first: a declaration's own skip combines with an enclosing one by taking the stronger. */
const SKIP_STRENGTH = { none: 0, conditional: 1, unconditional: 2 } as const satisfies Record<SkipCertainty, number>;

/** The stronger of two skips: a certain skip is never weakened by a conditional one, above or below it. */
function strongerSkip(a: SkipCertainty, b: SkipCertainty): SkipCertainty {
  return SKIP_STRENGTH[b] > SKIP_STRENGTH[a] ? b : a;
}

/** An options-form skip read off one declaration: how certain it is, and the property as written. */
interface OptionsFormSkip {
  certainty: Exclude<SkipCertainty, "none">;
  /** The property verbatim, whitespace collapsed: what a report quotes back (`skip: !DB`). */
  text: string;
}

/** Is a property name one of {@link SKIP_OPTION_KEYS}, written as an identifier or a string? */
function isSkipOptionKey(name: ts.PropertyName): boolean {
  return (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) && SKIP_OPTION_KEYS.has(name.text);
}

/**
 * The truthiness of a skip value that is a LITERAL, or `undefined` for any other expression. That
 * `undefined` is the whole line between a certain skip and a conditional one: nothing is evaluated, so
 * an identifier, a call, a `!DB` or a ternary all read as "depends on where the file loads".
 */
function literalTruthiness(value: ts.Expression): boolean | undefined {
  let e: ts.Expression = value;
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  if (e.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (e.kind === ts.SyntaxKind.FalseKeyword || e.kind === ts.SyntaxKind.NullKeyword) return false;
  if (ts.isStringLiteralLike(e)) return e.text.length > 0;
  if (ts.isNumericLiteral(e)) return Number(e.text) !== 0;
  if (ts.isIdentifier(e) && e.text === "undefined") return false;
  return undefined;
}

/**
 * THE OPTIONS-FORM SKIP RULE, and the only implementation of it in the repo: {@link analyzeObservedTests}
 * and {@link findOptionsFormSkips} both read a declaration's skip through here, so the classifier and
 * the `vacuous-proof` instrument cannot disagree about one. `node:test` and vitest take a skip as a
 * declaration's SECOND argument (`test(name, { skip: !DB }, fn)`) as well as through a modifier, and
 * the value decides how certain it is:
 *  - a FALSY literal (`false`, `""`, `0`, `null`, `undefined`) skips nothing, so it is no skip at all.
 *    Reading the key's mere presence would withhold credit from a test that always runs;
 *  - a TRUTHY literal (`true`, a reason string) never runs: UNCONDITIONAL;
 *  - anything else (`!DB`, `live ? false : "gated"`, a shorthand `{ skip }`) is CONDITIONAL.
 * Across `skip` and `todo` the stronger wins. Returns null when the argument is not an object literal or
 * carries neither key. An options object built somewhere else (a variable, a spread) is not read.
 */
function readOptionsFormSkip(options: ts.Expression | undefined, sf: ts.SourceFile): OptionsFormSkip | null {
  if (options === undefined || !ts.isObjectLiteralExpression(options)) return null;
  let found: OptionsFormSkip | null = null;
  for (const prop of options.properties) {
    let value: ts.Expression;
    if (ts.isPropertyAssignment(prop) && isSkipOptionKey(prop.name)) {
      value = prop.initializer;
    } else if (ts.isShorthandPropertyAssignment(prop) && SKIP_OPTION_KEYS.has(prop.name.text)) {
      // A shorthand `{ skip }` reads as its own name: an identifier, never a literal, so conditional.
      value = prop.name;
    } else {
      continue;
    }
    const truthy = literalTruthiness(value);
    if (truthy === false) continue; // a falsy literal skips nothing
    const certainty = truthy === true ? "unconditional" : "conditional";
    if (found === null || strongerSkip(found.certainty, certainty) !== found.certainty) {
      found = { certainty, text: prop.getText(sf).replace(/\s+/g, " ") };
    }
  }
  return found;
}

/** A matched test declaration: what {@link analyzeObservedTests} and {@link findOptionsFormSkips} both read. */
interface MatchedTestCall {
  name: string;
  /** Its OWN skip (the modifier, else the options form), before any enclosing skip is combined in. */
  ownSkip: SkipCertainty;
  /** The options-form skip alone, as written. A modifier is not recorded here. */
  optionsSkip: OptionsFormSkip | null;
  titleFullyStatic: boolean;
  call: TestCallRoot;
  parameterised: boolean;
}

/**
 * Is this node a `describe`/`test`/`it` call? Returns its read title and its OWN skip, whether a
 * `.skip`/`.todo` modifier or the options form ({@link readOptionsFormSkip}), or null when it is not a
 * test call at all. A test call whose title could NOT be read is still
 * MATCHED (with empty text and `titleFullyStatic: false`) — dropping it would erase the difference
 * between "this checker could not read the title" and "no such test exists".
 *
 * ONE structural exception, and it is not a title-reading rule: a PARAMETERISED
 * `it.each(table)(title, fn)` is TWO nested calls, and only the OUTER one declares a test. The inner
 * `it.each(table)` is the table-bound FACTORY — its first argument is the DATA TABLE, not a title —
 * yet it reaches the same root `it`, so it used to be observed as an extra test whose "title" read as
 * unreadable. That is a PHANTOM: neither a test nor an unread title, and it inflates
 * {@link TestSurfaceRead.unreadTitles} for a file whose titles were all read perfectly. Measured
 * 2026-08-06 across all 123 real-build test surfaces in the repo, it was the ONLY `unreadTitles` hit
 * — every genuine title read clean — and it would have stamped a false caveat onto
 * `render-claim-as-wisp`'s otherwise-correct 2/3 axis. The tell is exact: the invocation of a factory
 * has a callee that is ITSELF a call, so the outer node is kept and the inner one is not a
 * declaration. Nothing here changes how a title FOLDS (ADR-0126's literals-only rule is untouched);
 * it changes only which nodes are test declarations at all.
 */
function matchTestCall(node: ts.Node, sf: ts.SourceFile): MatchedTestCall | null {
  if (!ts.isCallExpression(node)) return null;
  const { root, members } = calleeParts(node.expression);
  if (root === undefined || !isTestCallRoot(root)) return null;
  if (members.some((m) => EACH_MODIFIERS.has(m)) && !ts.isCallExpression(node.expression)) {
    return null; // the `.each(table)` factory itself — the title lives on the call that invokes it
  }
  const title = readTestCallTitle(node.arguments[0]);
  if (title === null) return null;
  const optionsSkip = readOptionsFormSkip(node.arguments[1], sf);
  return {
    name: title.text,
    ownSkip: members.some((m) => SKIP_MODIFIERS.has(m)) ? "unconditional" : (optionsSkip?.certainty ?? "none"),
    optionsSkip,
    titleFullyStatic: title.fullyStatic,
    call: root,
    // Only the INVOCATION of a `.each` factory reaches here (the factory itself returned null above).
    parameterised: members.some((m) => EACH_MODIFIERS.has(m)),
  };
}

/** A trivially-constant literal: a scalar (or a unary/binary/paren of scalars). NOT an identifier/call/array/object. */
function isTriviallyConstant(expr: ts.Expression): boolean {
  let e: ts.Expression = expr;
  while (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e)) {
    e = e.expression;
  }
  switch (e.kind) {
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
      return true;
  }
  if (ts.isIdentifier(e) && e.text === "undefined") return true;
  if (ts.isPrefixUnaryExpression(e)) return isTriviallyConstant(e.operand); // `!true`, `-1`
  if (ts.isBinaryExpression(e)) return isTriviallyConstant(e.left) && isTriviallyConstant(e.right); // `1 === 1`
  return false; // identifiers, property access, calls, arrays, objects, templates-with-subs → substantive
}

/** Gather every argument across a call/member chain — `expect(x).toBe(y)` yields `[y, x]`; `assert(c)` yields `[c]`. */
function chainArguments(call: ts.CallExpression): ts.Expression[] {
  const args: ts.Expression[] = [];
  let node: ts.Expression = call;
  for (;;) {
    if (ts.isCallExpression(node)) {
      args.push(...node.arguments);
      node = node.expression;
    } else if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      node = node.expression;
    } else if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node)) {
      node = node.expression;
    } else {
      break;
    }
  }
  return args;
}

/**
 * Is `node` a SUBSTANTIVE assertion — an `assert`/`expect` call with ≥1 argument that references runtime
 * state (not a trivially-constant literal)? `assert(true)` / `expect(true).toBe(true)` / `assert.equal(1, 1)`
 * are NOT substantive (constant-only → hollow); `assert.ok(result.bounded)` / `expect(x).toBe(5)` are.
 */
function isSubstantiveAssertion(node: ts.Node): boolean {
  if (!ts.isCallExpression(node)) return false;
  const { root, members } = calleeParts(node.expression);
  const isAssertion =
    (root !== undefined && ASSERTION_NAMES.has(root)) || members.some((m) => ASSERTION_NAMES.has(m));
  if (!isAssertion) return false;
  return chainArguments(node).some((a) => !isTriviallyConstant(a));
}

/**
 * PURE: parse a test file's SOURCE (the TypeScript compiler AST) into the {@link ObservedTest}s it
 * declares — each `describe`/`test`/`it` call with its read name, whether that name was FULLY static
 * ({@link ObservedTest.titleFullyStatic}), how certainly it is skipped (its own skip or an
 * ancestor's, by a modifier or the options form — {@link readOptionsFormSkip}), whether its region holds
 * a substantive assertion (nested tests included), and whether it VOUCHES: substantive, and skipped in
 * neither form. Source-ordered, deterministic, offline — no execution.
 *
 * THE FILE NAME SELECTS THE PARSE, which is why every caller must pass it. `testFile` is the test
 * file's own path, and the parse follows its extension exactly as TypeScript's own does: a `.tsx` file
 * parses with JSX, a `.ts` file without. Neither parse is safe for the other kind of file:
 *  - read as plain TypeScript, a `.tsx` file's JSX is a run of syntax errors, and the parser's
 *    recovery can close a `describe` early, so the tests after the JSX lose their enclosing suite.
 *    Measured 2026-09-15 on four real test files, where the per-test join (ADR-0573 D1) refused
 *    correct tests because their title paths no longer matched the rows their runner reported
 *    (`docs/research/net-new-skeleton-red-measurement-2026-09-15.md` §7);
 *  - read as TSX, a `.ts` file's generic arrow (`<T>(x: T) => x`) or angle-bracket assertion
 *    (`<number>x`) opens a JSX element instead, and every test after it is lost.
 *
 * Fail-closed on the READABILITY axis, at two different grains — the distinction matters:
 *  - a SOURCE that does not parse contributes no tests at all (there is nothing to observe);
 *  - a TEST whose TITLE does not read is still OBSERVED, with empty/partial `name` and
 *    `titleFullyStatic: false`. It vouches for no contract, but it is on the record — so the report
 *    can say "unread", never silently "absent".
 */
export function analyzeObservedTests(testSource: string, testFile: string): ObservedTest[] {
  // No explicit script kind: `createSourceFile` derives it from the name, as the repo's other static
  // readers of a source file already let it — `findOptionsFormSkips` among them, which reads the same
  // declarations through the same matcher, so the two parse any test file the same way.
  const sf = ts.createSourceFile(testFile, testSource, ts.ScriptTarget.Latest, true);
  const collected: { test: ObservedTest; pos: number }[] = [];
  /** Post-order: returns whether `node`'s subtree holds a substantive assertion. Skip flows top-down. */
  function visit(node: ts.Node, ancestorSkip: SkipCertainty, ancestorTitles: readonly string[]): boolean {
    const test = matchTestCall(node, sf);
    const skipHere = test === null ? ancestorSkip : strongerSkip(ancestorSkip, test.ownSkip);
    // The ancestry every DESCENDANT sees — this node's own title appended once it is a test call.
    const childTitles = test !== null ? [...ancestorTitles, test.name] : ancestorTitles;
    // A test-call node is not itself an assertion; otherwise check this node directly.
    let subtreeSubstantive = test === null && isSubstantiveAssertion(node);
    ts.forEachChild(node, (child) => {
      // NB: forEachChild short-circuits on a TRUTHY return — keep this callback returning void.
      if (visit(child, skipHere, childTitles)) subtreeSubstantive = true;
    });
    if (test !== null) {
      collected.push({
        test: {
          name: test.name,
          titleFullyStatic: test.titleFullyStatic,
          skipped: skipHere === "unconditional",
          conditionallySkipped: skipHere === "conditional",
          substantive: subtreeSubstantive,
          vouches: subtreeSubstantive && skipHere === "none",
          ancestors: ancestorTitles,
          call: test.call,
          parameterised: test.parameterised,
          bodyHash: hashSpan(testSource.slice(node.getStart(sf), node.getEnd())),
        },
        pos: node.getStart(sf),
      });
    }
    return subtreeSubstantive;
  }
  ts.forEachChild(sf, (child) => {
    visit(child, "none", []);
  });
  collected.sort((a, b) => a.pos - b.pos);
  return collected.map((c) => c.test);
}

/**
 * PURE: every OPTIONS-FORM skip declared in one test file's SOURCE (`test(name, { skip: <expr> }, fn)`),
 * as declared name → the skip property verbatim, so a report can quote back what gates the test. It is
 * the input of the `vacuous-proof` instrument (`packages/cli/src/verification-decay.ts`), and it lives
 * HERE for the reason {@link readTestCallTitle} does: that instrument joins these names against
 * {@link extractVouchingTestNames}'s, so both sides must recognise the same declarations, spell the same
 * titles and apply the same skip rule. They share the matcher and {@link readOptionsFormSkip} outright,
 * so the agreement is structural instead of remembered.
 *
 * Only the options form is recorded; a `.skip`/`.todo` modifier is not this function's subject. A
 * falsy literal (`skip: false`) is no skip and never appears. A title with no readable static text
 * cannot join against anything, so it contributes no entry, and where a name repeats, the first
 * declaration's property is kept. Static: it reads the source, never executes it.
 */
export function findOptionsFormSkips(testSource: string, testFile: string): Map<string, string> {
  const found = new Map<string, string>();
  const sf = ts.createSourceFile(testFile, testSource, ts.ScriptTarget.Latest, true);
  const visit = (node: ts.Node): void => {
    const test = matchTestCall(node, sf);
    if (test !== null && test.optionsSkip !== null && test.name.length > 0 && !found.has(test.name)) {
      found.set(test.name, test.optionsSkip.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** What one read of a test source yields: the classifier's input, plus what could NOT be read. */
export interface TestSurfaceRead {
  /**
   * The observed test names that VOUCH for their contract — the coverage classifier's input
   * (ADR-0126). A test that is skipped, has no substantive assertion in its region, or has no
   * readable title is OMITTED, so a contract named only by such a test reads UNCOVERED.
   */
  vouching: string[];
  /**
   * How many observed titles this checker could NOT read in full. **The number that tells a `0/N`
   * apart from a `0/N`:** with `unreadTitles: 0` an uncovered contract is genuinely un-named by any
   * substantive test; above 0, some of the surface was never legible to a static reader, and the
   * uncovered list is at least partly a statement about THIS CHECKER rather than about the tests.
   * Both are honest outcomes; conflating them is not.
   */
  unreadTitles: number;
  /**
   * The observed test names that would VOUCH but for an options-form skip whose value is an expression
   * (`{ skip: !DB }`) — substantive, readable, and skipped for CERTAIN in neither form. **The names
   * that tell a GATED contract apart from an ABSENT one:** with `gatedNames: []` an uncovered contract
   * is genuinely un-named by any substantive test; a name here means a test DOES name it and whether
   * it ran depends on the environment the file loaded in, which a static read cannot know.
   *
   * NAMES rather than a count, unlike {@link unreadTitles}, and the asymmetry is structural rather
   * than a style choice: an unread title is unattributable BY CONSTRUCTION — not reading it is what
   * makes it unread — so a count is all there is to report. A gated test's title read perfectly, so a
   * consumer can join it against contract ids with the very matcher coverage already uses and say
   * WHICH uncovered contract is only gated, which is the question `storytree coverage`'s per-contract
   * line asks. Reporting a bare count here would copy the precedent's SHAPE while discarding the
   * information that made the precedent a count.
   *
   * It never credits: a name here is separation, not coverage — see {@link ContractCoverageReport.gated}.
   */
  gatedNames: string[];
}

/**
 * PURE: read a test file's source ONCE into both facts the coverage surfaces need — the vouching
 * names to classify, and the count of titles that could not be read in full. Keeping them on one
 * return is the point: they come from the same parse and are only meaningful together (ADR-0126's
 * hollowness fold and the readability fold point in opposite directions, so an uncovered contract is
 * ambiguous until you know which fold produced it). `testFile` selects the parse, as it does for
 * {@link analyzeObservedTests}.
 */
export function readTestSurface(testSource: string, testFile: string): TestSurfaceRead {
  const observed = analyzeObservedTests(testSource, testFile);
  return {
    // An empty name vouches for nothing (`testNameCoversContract` never matches it) — drop it rather
    // than feed a meaningless "" to the classifier; `unreadTitles` is where that test is accounted.
    vouching: observed.filter((t) => t.vouches && t.name.length > 0).map((t) => t.name),
    unreadTitles: observed.filter((t) => !t.titleFullyStatic).length,
    // WOULD vouch but for its condition — substantive, named, and conditionally skipped. Both other
    // conjuncts carry weight: a HOLLOW gated test proves nothing wherever it runs, so it is uncovered
    // for hollowness and nothing is being withheld; and a test skipped for CERTAIN is not waiting on an
    // environment at all (`conditionallySkipped` is never true beside `skipped` — a certain skip above
    // or on the call outranks it, so that case is excluded by this flag rather than by a second test).
    gatedNames: observed
      .filter((t) => t.conditionallySkipped && t.substantive && t.name.length > 0)
      .map((t) => t.name),
  };
}

/**
 * PURE: the observed test names that VOUCH for their contract — the hollow-aware replacement for
 * {@link extractTestNames} as the coverage check's input (ADR-0126). It replaced `extractTestNames`
 * in the coverage loaders; {@link readTestSurface} when the caller also wants to report WHY a contract
 * is uncovered. `testFile` selects the parse, as it does for {@link analyzeObservedTests}.
 */
export function extractVouchingTestNames(testSource: string, testFile: string): string[] {
  return readTestSurface(testSource, testFile).vouching;
}

// ---------------------------------------------------------------------------
// The classifier
// ---------------------------------------------------------------------------

/** Per-contract coverage: is it named by ≥1 observed test, and by which test name(s)? */
export interface ContractCoverage {
  /** The declared contract id (a member of the unit's `## Contracts`). */
  contractId: string;
  /** Covered iff ≥1 observed test names it (the naming convention). */
  covered: boolean;
  /** The observed test name(s) that name this contract (empty when uncovered). */
  coveredBy: string[];
  /**
   * The CONDITIONALLY SKIPPED test name(s) that name this contract — substantive tests that would have
   * covered it but for a `{ skip: <expr> }` a static read cannot evaluate. Non-empty on an UNCOVERED
   * contract means a test exists and may well have run; non-empty beside a non-empty {@link coveredBy}
   * means nothing is being withheld (something else already covers it), which is why
   * {@link ContractCoverageReport.gated} reports only the uncovered ones.
   */
  gatedBy: string[];
}

/**
 * A unit's contract-coverage report: the per-contract classification plus the covered/uncovered
 * projections. Live-derivable (re-compute each run) — no timestamps, no verdict state, just the
 * structural diff of declared contracts against observed test names.
 */
export interface ContractCoverageReport {
  /** The unit (capability) this report is for. */
  unitId: string;
  /** Every declared contract, classified — in declared order (stable, never re-sorted). */
  contracts: ContractCoverage[];
  /** The covered contract ids (the convenience projection). */
  covered: string[];
  /**
   * The UNCOVERED contract ids — declared but named by no observed test. These are the contracts a
   * signed green would over-claim: the gap ADR-0020 §3 leaves open (it observes only the new test).
   */
  uncovered: string[];
  /**
   * The GATED contract ids — a SUBSET of {@link uncovered}: declared, named by no vouching test, but
   * named by a substantive test that carries a conditional skip. **Separation, never credit.** These
   * stay in `uncovered` and every downstream ceiling keys off that list unchanged; what this adds is
   * that a report can stop telling an author a test is missing when one is sitting in front of them.
   *
   * It is deliberately NOT credit even where the spine forces the environment (a `real.db: true` unit's
   * `--real` build does force the database its `{ skip: !DB }` tests read). A static read sees an
   * EXPRESSION, not which condition it tests: `!DB` and `!RUN_LIVE_TRELLIS` are the same shape, and the
   * spine forces the first and nothing forces the second. Crediting on shape would over-claim for the
   * second, which is the direction ADR-0127's PR #1172 incident went wrong in.
   *
   * Three states, the {@link TestSurfaceRead.unreadTitles} rule on a list: an ABSENT field (a consumer
   * that never measured), `[]` (measured, nothing gated), and non-empty (measured, these are gated).
   */
  gated: string[];
}

/** Everything {@link classifyContractCoverage} reads, injected for determinism (pure — no I/O). */
export interface ContractCoverageSpec {
  /** The unit id (carried onto the report). */
  unitId: string;
  /** The unit's declared contract ids (from `parseContracts`), in declared order. */
  contractIds: readonly string[];
  /** The observed test names across the unit's test surface (from `extractTestNames`). */
  testNames: readonly string[];
  /**
   * The substantive-but-CONDITIONALLY-SKIPPED test names across the same surface
   * ({@link TestSurfaceRead.gatedNames}). OPTIONAL and default-empty, so a caller that does not measure
   * executability reads exactly as it did before — omitted means "nothing measured", which yields an
   * empty {@link ContractCoverageReport.gated} rather than an unknown. These names NEVER cover: they are
   * matched with the same {@link testNameCoversContract} the covering names use, purely to say which
   * uncovered contract is gated.
   */
  gatedTestNames?: readonly string[] | undefined;
}

/**
 * PURE: classify a unit's declared contracts by name-presence (the first slice). For each declared
 * contract, COVERED iff some observed test names it ({@link testNameCoversContract}); UNCOVERED
 * otherwise. Deterministic and order-preserving — `contracts` follows declared order; `covered` /
 * `uncovered` are stable. A duplicate contract id collapses to its first occurrence (a copy-paste slip
 * never double-counts). A unit with no declared contracts yields empty lists (vacuously covered —
 * nothing to check).
 */
export function classifyContractCoverage(spec: ContractCoverageSpec): ContractCoverageReport {
  const contracts: ContractCoverage[] = [];
  const covered: string[] = [];
  const uncovered: string[] = [];
  const gated: string[] = [];
  const seen = new Set<string>();
  for (const contractId of spec.contractIds) {
    if (seen.has(contractId)) continue; // collapse a duplicate contract id to its first occurrence
    seen.add(contractId);
    const coveredBy = spec.testNames.filter((name) => testNameCoversContract(name, contractId));
    const gatedBy = (spec.gatedTestNames ?? []).filter((name) =>
      testNameCoversContract(name, contractId),
    );
    const isCovered = coveredBy.length > 0;
    contracts.push({ contractId, covered: isCovered, coveredBy, gatedBy });
    (isCovered ? covered : uncovered).push(contractId);
    // GATED qualifies UNCOVERED and is a subset of it by construction. A gated test beside a covering
    // one withholds nothing, so it is not reported — the question this answers is only ever "is this
    // gap a missing test, or a test that may not have run?".
    if (!isCovered && gatedBy.length > 0) gated.push(contractId);
  }
  return { unitId: spec.unitId, contracts, covered, uncovered, gated };
}

/**
 * Convenience: classify straight from parsed {@link ContractDecl}s (maps to their ids). `gatedTestNames`
 * is optional and default-empty for the same reason it is on {@link ContractCoverageSpec} — a caller
 * that does not measure executability reads exactly as before.
 */
export function classifyDeclaredCoverage(
  unitId: string,
  declared: readonly ContractDecl[],
  testNames: readonly string[],
  gatedTestNames: readonly string[] = [],
): ContractCoverageReport {
  return classifyContractCoverage({
    unitId,
    contractIds: declared.map((c) => c.id),
    testNames,
    gatedTestNames,
  });
}

// ---------------------------------------------------------------------------
// The INVERSE classifier: which contract claims this asserted behaviour?
// ---------------------------------------------------------------------------

/**
 * The INVERSE of {@link classifyContractCoverage}, and the question that had no instrument.
 *
 * Coverage walks DECLARED CONTRACT then TEST: "does some observed test name this contract?" That
 * answers whether a spec is under-covered. It cannot answer the other direction, which is the one an
 * ADR-0294 D2 deletion has to answer: a story-UAT criterion is deleted only when its author NAMES the
 * lower-tier node that already proves it, so the author starts from a RUNNING ASSERTION and needs the
 * node. When no contract claims that assertion the honest citation collapses to a test TITLE, and a
 * rationale citing a capability whose contracts do not actually claim the behaviour is
 * indistinguishable from one that does (the phrasing check in
 * `packages/library/src/corpus-criterion-migration.test.ts` matches on words, never on truth).
 *
 * This walks TEST then DECLARED CONTRACT over the same surface the coverage sweep reads, and splits a
 * capability's asserted behaviours into the ones a contract claims and the ones nothing claims.
 * Read-only and advisory: a contractless behaviour is NOT a defect — most unit tests are steps inside
 * a contract rather than contracts of their own. What it establishes is whether a CITATION is
 * available, which is the only thing ADR-0294 D2's honesty wall needs to know.
 */

/** One asserted behaviour observed in a proof surface — the unit the inverse question is asked of. */
export interface AssertedBehaviour {
  /** The test's own title, as read from source. */
  title: string;
  /**
   * The ancestry-joined title — enclosing suite titles then the test's own, `" / "`-separated. This
   * is what contract ids are matched against, because the convention `describe("<id>: …")` puts the
   * id on the SUITE while the behaviour is asserted by the leaf `it` beneath it.
   */
  effectiveTitle: string;
}

/** An asserted behaviour together with the declared contract that claims it. */
export interface ClaimedBehaviour extends AssertedBehaviour {
  /** The first declared contract id named by {@link AssertedBehaviour.effectiveTitle}. */
  contractId: string;
}

/**
 * A unit's behaviour-claim report — the inverse projection of {@link ContractCoverageReport}.
 * Live-derivable, deterministic, source-ordered.
 */
export interface BehaviourClaimReport {
  /** The unit (capability) this report is for. */
  unitId: string;
  /** Asserted behaviours a declared contract claims. */
  claimed: ClaimedBehaviour[];
  /** Asserted behaviours NO declared contract claims — the citation gap. */
  contractless: AssertedBehaviour[];
  /**
   * Behaviours whose title this checker could not read in full AND whose ancestry named no contract.
   * Kept OUT of {@link contractless} deliberately: "no contract claims this" and "I could not read
   * the title" are different claims, and this module's two folds point in opposite directions (see
   * the header). A report that merged them would over-state the gap by the size of its own blind
   * spot.
   */
  unreadable: AssertedBehaviour[];
}

/** Everything {@link classifyBehaviourClaims} reads, injected for determinism (pure — no I/O). */
export interface BehaviourClaimSpec {
  /** The unit id (carried onto the report). */
  unitId: string;
  /** The unit's declared contract ids (from `parseContracts`), in declared order. */
  contractIds: readonly string[];
  /** Every observed test across the unit's proof surface (from {@link analyzeObservedTests}). */
  observed: readonly ObservedTest[];
}

/** The `" / "`-joined ancestry-plus-own title a contract id is matched against. */
function effectiveTitleOf(test: ObservedTest): string {
  return [...test.ancestors, test.name].filter((part) => part.length > 0).join(" / ");
}

/**
 * A test's own path key (its ancestry plus itself), used to spot the suites that only GROUP.
 *
 * Length-prefixed per segment rather than joined on a separator, so the key is INJECTIVE: no title
 * can forge another path's key by containing the separator. A control character would buy the same
 * property and cost more than it is worth — a NUL in a `.ts` source makes git and grep treat the
 * whole file as binary, which hides every later diff of it behind a tool that will not print text.
 */
function pathKeyOf(test: ObservedTest): string {
  return encodePath([...test.ancestors, test.name]);
}

/** The injective encoding both path keys are built from: each segment as `<length>:<text>`. */
function encodePath(segments: readonly string[]): string {
  return segments.map((segment) => `${String(segment.length)}:${segment}`).join("|");
}

/**
 * PURE: split a unit's asserted behaviours into claimed / contractless / unreadable.
 *
 * Only LEAF tests count as behaviours. A `describe` that merely groups other observed tests is not
 * itself an asserted behaviour, and counting it would inflate the gap with grouping titles
 * (`"SceneView — the studio scene mapper"` claims nothing and is not meant to). Leafness is read off
 * the ancestry: a test is a container iff some other observed test's ancestry is exactly its own
 * path. Two sibling suites sharing a title collapse to one container — conservative, so the gap is
 * never over-stated.
 *
 * Only VOUCHING tests count (ADR-0126): a skipped or hollow test asserts nothing, so it is not a
 * behaviour any citation could rest on. A duplicate contract id collapses to its first occurrence,
 * and a behaviour matched by several contracts is attributed to the FIRST in declared order.
 */
export function classifyBehaviourClaims(spec: BehaviourClaimSpec): BehaviourClaimReport {
  const contractIds: string[] = [];
  const seen = new Set<string>();
  for (const id of spec.contractIds) {
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    contractIds.push(id);
  }
  const containers = new Set(spec.observed.map((t) => encodePath(t.ancestors)));
  const claimed: ClaimedBehaviour[] = [];
  const contractless: AssertedBehaviour[] = [];
  const unreadable: AssertedBehaviour[] = [];
  for (const test of spec.observed) {
    if (!test.vouches) continue;
    if (containers.has(pathKeyOf(test))) continue; // a grouping suite, not an asserted behaviour
    const effectiveTitle = effectiveTitleOf(test);
    const behaviour: AssertedBehaviour = { title: test.name, effectiveTitle };
    const contractId = contractIds.find((id) => testNameCoversContract(effectiveTitle, id));
    if (contractId !== undefined) claimed.push({ ...behaviour, contractId });
    else if (!test.titleFullyStatic) unreadable.push(behaviour);
    else contractless.push(behaviour);
  }
  return { unitId: spec.unitId, claimed, contractless, unreadable };
}
