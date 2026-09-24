import { hashSpan } from "@storytree/orchestrator";
import type { ChangeEvent } from "@storytree/proof-protocol";
import assert from "node:assert/strict";
import test from "node:test";

import { attributeDecayFindings } from "./decay-attribution.js";
import {
  ACCEPTED,
  DECISION_SOURCE_DRIFT,
  findDeclaredUnfrozenSources,
  findRefutedSources,
  findDecisionSourceDrift,
  formatDecisionSourceSweep,
  locateQuoteSpan,
  locateSpanIn,
  locateSymbolSpan,
  measureDecisionSweep,
  projectDecisionFacts,
  sourceKey,
  type DecisionFacts,
  type DecisionRow,
} from "./decision-source-decay.js";
import {
  CHARTERED_INSTRUMENTS,
  evaluateDecayCeiling,
  runDecaySweep,
  type DecayInstrument,
} from "./verification-decay.js";

/**
 * ADR-0424's DRIFT SWEEP — `grounded-decisions-arc` increment 02.
 *
 * ## THE ONE TRAP THIS SUITE IS BUILT AROUND
 *
 * The increment names it and this repo hits it more than any other: **the sweep's expectation must
 * not be derived from its own subject.** A test that computes the expected hash from the same text
 * it then hands the sweep cannot fail — it asserts that `hashSpan` is a function, and it goes green
 * whether the instrument compares anything or nothing at all.
 *
 * So every drift case here supplies a span that GENUINELY MOVED: {@link FROZEN} is the declaration
 * as it stood when the anchor was frozen, {@link MOVED} is the same declaration after a real edit,
 * and the two are different text. The bound hash comes from the FIRST and the tree serves the
 * SECOND. {@link BOGUS_HASH} pins the same thing harder — a literal that was never any span's
 * fingerprint must drift against every span.
 *
 * AND EVERY DRIFT CASE CARRIES ITS CONTROL. "A finding appeared" is equally consistent with an
 * instrument that always reports, so each one is paired with the same fixture over the UNMOVED text
 * asserting that NOTHING is reported. The pair is the proof; either half alone is not.
 *
 * ## RED WAS PROVEN BEFORE GREEN, BY BLINDING THE IMPLEMENTATION — measured 2026-08-24, re-runnable
 *
 * A green suite is equally consistent with a suite that cannot fail, so the claim is not "these
 * pass". Two blinding probes against the real implementation, each reverted:
 *
 * - Delete `findDecisionSourceDrift`'s `status !== ACCEPTED` guard → **1 of 22 fails**, and it is
 *   the ADR-0424 D3 exclusion case. Nothing else notices, which is exactly right: the exclusion is
 *   held by one test and that test is the only thing holding it.
 * - Set the CURRENT hash to the anchor's own `boundHash` — the vacuous shape this suite exists to
 *   fence, an expectation derived from its own subject → **8 of 22 fail**, including both halves of
 *   the moved/unmoved pair, the literal-hash case, and the ceiling-enforcement pin.
 * - Drop the one-entry-per-key guard → **1 of 24 fails**, the duplicate-claim case. That defect was
 *   found by re-reading this file's own subject rather than by a test, and the test was written
 *   after the fix — recorded plainly, because a probe run after the repair proves the test bites and
 *   proves nothing about when it was written.
 */

/** The declaration as it stood when the anchor was frozen. */
const FROZEN = [
  "export function classify(x: number): string {",
  '  return x > 0 ? "up" : "down";',
  "}",
].join("\n");

/** The SAME declaration after a real edit — a different boundary, not a reformat. */
const MOVED = [
  "export function classify(x: number): string {",
  '  return x >= 0 ? "up" : "down";',
  "}",
].join("\n");

/** A hash that was never any span's fingerprint. Nothing may ever compare FRESH against it. */
const BOGUS_HASH = "00000000000000000000000000000000";

const FILE = "packages/example/src/classify.ts";

/** A file whose only content is one of the two declarations above. */
const treeWith = (body: string) => (rel: string) => (rel === FILE ? body : undefined);

/** One decision row, in the shape the store actually holds (see `adr-sources.test.ts`'s seed). */
function row(id: string, status: string, extra: Record<string, unknown> = {}): DecisionRow {
  return {
    id,
    doc: {
      kind: "adr",
      id,
      title: "A decision under test",
      body: "# A decision under test\n\n## Decision\n\nSomething.\n",
      status,
      amends: [],
      supersedes: [],
      loadBearing: false,
      ...extra,
    },
  };
}

/** A BOUND anchor on the symbol `classify`, frozen against {@link FROZEN}. */
const boundAnchor = { claim: "D1", file: FILE, symbol: "classify", boundHash: hashSpan(FROZEN) };

/** The same anchor with nothing frozen onto it — the middle of the field's three states. */
const declaredAnchor = { claim: "D2", file: FILE, symbol: "classify" };

/** Project one row against a tree serving `body` for {@link FILE}. */
const factsFor = (r: DecisionRow, body: string | undefined): DecisionFacts[] =>
  projectDecisionFacts([r], body === undefined ? () => undefined : treeWith(body));

// ---------------------------------------------------------------------------
// Unit 1 — the judge locates a span that genuinely moved, and only then
// ---------------------------------------------------------------------------

test("a bound anchor whose span genuinely MOVED is located — and the same fixture unmoved reports nothing", () => {
  const decision = row("adr-0001", ACCEPTED, { sources: [boundAnchor] });

  // THE CONTROL FIRST, so a reader sees the instrument is capable of silence. Same decision, same
  // anchor, same bound hash — only the tree differs.
  const unmoved = findDecisionSourceDrift(factsFor(decision, FROZEN), []);
  assert.deepEqual(unmoved, [], "an unmoved span is FRESH and must produce no finding at all");

  const moved = findDecisionSourceDrift(factsFor(decision, MOVED), []);
  assert.equal(moved.length, 1, "the moved span is located");
  const [finding] = moved;
  assert.ok(finding !== undefined);
  assert.equal(finding.instrument, DECISION_SOURCE_DRIFT);
  assert.equal(finding.where, FILE, "`where` is the anchored FILE, so attribution can charge it");
  assert.match(finding.detail, /adr-0001/);
  assert.match(finding.detail, /HAS MOVED/);
  assert.match(finding.detail, /\[D1\]/, "the claim label the author wrote is carried verbatim");
  assert.match(finding.detail, /symbol grain/, "and the grain, so the false-positive surface is readable");
});

test("a bound hash that was never any span's fingerprint drifts against every span", () => {
  // The strongest form of the anti-trap rule: this expectation is a LITERAL, so it cannot have been
  // derived from the subject even by accident.
  const decision = row("adr-0002", ACCEPTED, {
    sources: [{ file: FILE, symbol: "classify", boundHash: BOGUS_HASH }],
  });
  const findings = findDecisionSourceDrift(factsFor(decision, FROZEN), []);
  assert.equal(findings.length, 1, "a hash nothing produced can never read FRESH");
});

test("a finding's id is stable across runs, so the ceiling counts one thing and not a moving target", () => {
  const decision = row("adr-0003", ACCEPTED, { sources: [boundAnchor] });
  const first = findDecisionSourceDrift(factsFor(decision, MOVED), []);
  const second = findDecisionSourceDrift(factsFor(decision, MOVED), []);
  assert.equal(first[0]?.id, second[0]?.id);
  assert.equal(first[0]?.id, `${DECISION_SOURCE_DRIFT}:adr-0003:${sourceKey(boundAnchor)}`);
});

// ---------------------------------------------------------------------------
// ADR-0424 D3 — superseded is excluded, and that is the load-bearing half
// ---------------------------------------------------------------------------

test("two claims resting on ONE span produce ONE finding, not two under the same id", () => {
  // `sourceKey` excludes `claim` deliberately, so two anchors differing only by their label are one
  // key. Admitting both would mint two findings under a single id — double-counting against the
  // ceiling, and making the count depend on how many claims an author happened to label rather than
  // on how much code moved. The span is what moved, once.
  const decision = row("adr-0018", ACCEPTED, {
    sources: [boundAnchor, { ...boundAnchor, claim: "D7" }],
  });
  const findings = findDecisionSourceDrift(factsFor(decision, MOVED), []);
  assert.equal(findings.length, 1);
  assert.equal(new Set(findings.map((f) => f.id)).size, 1, "and the ids are unique by construction");
  // The aperture still counts both — two anchors DO exist and both were bound; what is deduped is
  // the FINDING, never the fact that an author grounded two claims here.
  assert.deepEqual(measureDecisionSweep(factsFor(decision, MOVED)), {
    comparedAnchors: 2,
    groundedDecisions: 1,
  });
});

test("a SUPERSEDED decision is excluded even when its anchor plainly drifted (ADR-0424 D3)", () => {
  // 37 decisions carry prose that is DELIBERATELY false about the current world. Grounding them
  // would build an instrument that goes red on a perfectly healthy system — this repo's
  // most-recorded fault class, running in reverse.
  const sources = [boundAnchor];
  const drifted = (status: string): number =>
    findDecisionSourceDrift(factsFor(row("adr-0004", status, { sources }), MOVED), []).length;

  assert.equal(drifted(ACCEPTED), 1, "the control: the very same anchor IS located when accepted");
  // `superseded` is DERIVED from a replacer's edge (ADR-0609 D3): the row itself stores `accepted`.
  const replaced = projectDecisionFacts(
    [row("adr-0004", ACCEPTED, { sources }), row("adr-0009", ACCEPTED, { supersedes: [4] })],
    treeWith(MOVED),
  );
  assert.equal(findDecisionSourceDrift(replaced, []).length, 0, "…and silent when a decided record superseded it");
  assert.equal(drifted("proposed"), 0, "…and silent when proposed — the obligation has not attached");
});

// ---------------------------------------------------------------------------
// ADR-0424 D4 — an unanchored decision produces NO output, anywhere
// ---------------------------------------------------------------------------

test("a decision carrying NO anchors produces no finding, no note, and no denominator (ADR-0424 D4)", () => {
  // The honest pin for the rule that a low grounded share is NOT a finding: an accepted decision
  // with no `sources` key must be invisible to every one of this instrument's three outputs. If it
  // were counted anywhere, a share would be derivable and authors would attach spans to satisfy it.
  const bare = factsFor(row("adr-0005", ACCEPTED), FROZEN);
  assert.deepEqual(findDecisionSourceDrift(bare, []), []);
  assert.deepEqual(findDeclaredUnfrozenSources(bare), []);
  assert.deepEqual(measureDecisionSweep(bare), { comparedAnchors: 0, groundedDecisions: 0 });

  const rendered = formatDecisionSourceSweep(measureDecisionSweep(bare), findDeclaredUnfrozenSources(bare)).join(
    "\n",
  );
  assert.doesNotMatch(rendered, /adr-0005/, "the unanchored decision is not named anywhere");
  assert.doesNotMatch(rendered, /\bshare\b(?!.*NOT)/, "and no share is reported");
});

// ---------------------------------------------------------------------------
// Unit 3 — DECLARED BUT NEVER FROZEN is its own visible category, and not a finding
// ---------------------------------------------------------------------------

test("an anchor DECLARED but never frozen is not a finding — it is its own visible category", () => {
  // The three-state rule made visible. An unfrozen anchor is comparable by nothing, so the sweep
  // located no moved code; counting it against the drift ceiling would say the repo grew a stale
  // binding when what happened is that a binding was never bound.
  const facts = factsFor(row("adr-0006", ACCEPTED, { sources: [declaredAnchor] }), MOVED);

  assert.deepEqual(findDecisionSourceDrift(facts, []), [], "not a finding, even over a moved span");
  assert.deepEqual(findDeclaredUnfrozenSources(facts), [
    { decisionId: "adr-0006", label: `[D2] ${FILE}#classify` },
  ]);
  assert.deepEqual(
    measureDecisionSweep(facts),
    { comparedAnchors: 0, groundedDecisions: 1 },
    "it is an anchor that EXISTS and was not compared — never a coverage numerator",
  );

  const rendered = formatDecisionSourceSweep(
    measureDecisionSweep(facts),
    findDeclaredUnfrozenSources(facts),
  ).join("\n");
  assert.match(rendered, /DECLARED BUT NEVER FROZEN/);
  assert.match(rendered, /adr-0006 — \[D2\]/);
  assert.match(rendered, /NOT a finding and NOT a coverage metric/);
});

test("an unfrozen anchor on a PROPOSED decision is the normal state and is reported by nothing", () => {
  // Nothing binds automatically (ADR-0438 D1, withdrawing ADR-0424 D2's freeze-at-the-green-flip), so
  // ANY decision can carry identities with nothing bound to them and a `proposed` one almost always
  // does. Reporting those would fire on healthy work, and the truth obligation this instrument holds
  // has not attached to a proposed decision at all.
  const facts = factsFor(row("adr-0007", "proposed", { sources: [declaredAnchor] }), MOVED);
  assert.deepEqual(findDeclaredUnfrozenSources(facts), []);
  assert.deepEqual(measureDecisionSweep(facts), { comparedAnchors: 0, groundedDecisions: 0 });
});

/** An anchor closed as REFUTED — the drain's third discharge, with its reason on the record. */
const refutedAnchor = { claim: "D3", file: FILE, symbol: "classify", refuted: "the prose never rested here" };

test("a REFUTED anchor is neither a finding nor outstanding work — it is its own category", () => {
  // The three questions are distinct and a sweep owes all three. Over a MOVED tree a refuted anchor
  // must produce NO drift finding (it is not a binding any more) and must NOT appear under DECLARED
  // BUT NEVER FROZEN either — that category is work nobody has started, and this is work somebody
  // finished. Filing a closed matter there would grow the worklist every time the drain succeeded,
  // which is a worklist nobody reads.
  const facts = factsFor(row("adr-0030", ACCEPTED, { sources: [refutedAnchor] }), MOVED);

  assert.deepEqual(findDecisionSourceDrift(facts, []), [], "not drift");
  assert.deepEqual(findDeclaredUnfrozenSources(facts), [], "and not a worklist item");
  assert.deepEqual(findRefutedSources(facts), [
    { decisionId: "adr-0030", label: `[D3] ${FILE}#classify`, reason: "the prose never rested here" },
  ]);
  assert.deepEqual(
    measureDecisionSweep(facts),
    { comparedAnchors: 0, groundedDecisions: 0 },
    "and it is not part of the aperture — nothing about it was compared",
  );
});

test("a REFUTED anchor carrying a stale hash is STILL never swept — the read side fails closed", () => {
  // `adr rebind --refute` strips the hash as it records the reason, so this pair is unreachable
  // through the verb. It is reachable by hand: `sources` is writable through
  // `--set sources=@file.json`, and a hand-written entry is exactly where the two edits come apart.
  // Reading it fail-OPEN would re-mint a finding somebody has already closed, and the reason sitting
  // right there on the anchor would make that finding read as a bug in the drain.
  const facts = factsFor(
    row("adr-0031", ACCEPTED, { sources: [{ ...refutedAnchor, boundHash: hashSpan(FROZEN) }] }),
    MOVED,
  );
  assert.deepEqual(findDecisionSourceDrift(facts, []), []);
});

test("the REFUTED block prints when NOTHING is unfrozen — the early return does not swallow it", () => {
  // The shape this category would most plausibly have been lost in. `formatDecisionSourceSweep`
  // returns early when the unfrozen list is empty, which is the COMMON case — so a refuted block
  // appended after that return would be invisible in exactly the situation a reader most needs it:
  // a clean sweep whose cleanliness is partly explained by a refutation.
  const rendered = formatDecisionSourceSweep(
    { comparedAnchors: 0, groundedDecisions: 0 },
    [],
    [{ decisionId: "adr-0032", label: `[D3] ${FILE}#classify`, reason: "wrong span" }],
  ).join("\n");
  assert.match(rendered, /REFUTED/);
  assert.match(rendered, /adr-0032/);
  assert.match(rendered, /wrong span/, "the reason is printed, so a reader can disagree with it");
  assert.match(rendered, /NOT a finding and NOT a worklist/);
});

test("a REFUTED anchor on a SUPERSEDED decision is reported by nothing (ADR-0424 D3)", () => {
  // The same scope every neighbour here keeps: superseded prose is deliberately false about the
  // current world, so nothing about its anchors is a signal.
  const facts = projectDecisionFacts(
    [row("adr-0033", ACCEPTED, { sources: [refutedAnchor] }), row("adr-0040", ACCEPTED, { supersedes: [33] })],
    treeWith(MOVED),
  );
  assert.deepEqual(findRefutedSources(facts), []);
});

test("the aperture line prints even at zero, so a silent sweep is not an absent one", () => {
  const lines = formatDecisionSourceSweep({ comparedAnchors: 0, groundedDecisions: 0 }, []);
  assert.equal(lines.length, 1);
  assert.match(String(lines[0]), /compared 0 bound anchor\(s\) across 0 accepted decision\(s\)/);
});

// ---------------------------------------------------------------------------
// The described-change gate — the thing our classifier has that the industry ones do not
// ---------------------------------------------------------------------------

test("a DESCRIBED change reads `stale`; the same drift with none reads `drifted-undescribed`", () => {
  // Collapsing these two in the render throws away the signal the drain needs — a `stale` span moved
  // for a reason somebody wrote down, and a `drifted-undescribed` one moved with nothing explaining
  // it. Nothing writes a decision-anchor change event yet, so the sweep passes an empty log and
  // every real finding today is the second kind; this proves the FIRST kind is reachable, and that
  // the gate is genuinely composed rather than nominally.
  const decision = row("adr-0008", ACCEPTED, { sources: [boundAnchor] });
  const facts = factsFor(decision, MOVED);

  const undescribed = findDecisionSourceDrift(facts, []);
  assert.match(String(undescribed[0]?.detail), /drifted-undescribed/);
  assert.match(String(undescribed[0]?.detail), /no change event describes why/);

  const change: ChangeEvent = {
    unitId: sourceKey(boundAnchor),
    hashBefore: hashSpan(FROZEN),
    hashAfter: hashSpan(MOVED),
    description: "the boundary moved to include zero",
    author: "someone",
    at: "2026-08-24T00:00:00.000Z",
  };
  const described = findDecisionSourceDrift(facts, [change]);
  assert.match(String(described[0]?.detail), /stale/);
  assert.match(String(described[0]?.detail), /the boundary moved to include zero/);
});

// ---------------------------------------------------------------------------
// Unlocatable is a located region, never silence
// ---------------------------------------------------------------------------

test("an anchor whose FILE is gone is reported, never folded into `nothing changed`", () => {
  // `classifySourceDrift` treats an upstream absent from its hash map as *unknown, not drifted* —
  // its conservative ADR-0016 bias. Passing an unlocatable span through that door would come back
  // FRESH, which is the fail-open this branch exists to refuse.
  const facts = factsFor(row("adr-0009", ACCEPTED, { sources: [boundAnchor] }), undefined);
  const findings = findDecisionSourceDrift(facts, []);
  assert.equal(findings.length, 1);
  assert.match(String(findings[0]?.detail), /CANNOT BE LOCATED/);
  assert.match(String(findings[0]?.detail), /does not exist in this checkout/);
});

test("an anchor whose SYMBOL is gone does not widen to the whole file and answer a different question", () => {
  const facts = factsFor(
    row("adr-0010", ACCEPTED, { sources: [boundAnchor] }),
    "export function somethingElse(): void {}\n",
  );
  const findings = findDecisionSourceDrift(facts, []);
  assert.equal(findings.length, 1);
  assert.match(String(findings[0]?.detail), /no declaration named `classify` remains/);
});

// ---------------------------------------------------------------------------
// The locator itself — where the false positives come from
// ---------------------------------------------------------------------------

test("locateSymbolSpan returns the declaration's CURRENT text, so an edit inside it drifts", () => {
  const before = `const noise = 1;\n${FROZEN}\nconst more = 2;\n`;
  const after = `const noise = 1;\n${MOVED}\nconst more = 2;\n`;
  assert.equal(locateSymbolSpan(before, FILE, "classify"), FROZEN);
  assert.equal(locateSymbolSpan(after, FILE, "classify"), MOVED);
  assert.equal(locateSymbolSpan(before, FILE, "absent"), undefined);
});

test("locateSymbolSpan reads the AST, so a name in a comment or a string is not a declaration", () => {
  const text = '// classify is described here\nconst s = "classify";\nexport const classify = 1;\n';
  assert.equal(locateSymbolSpan(text, FILE, "classify"), "export const classify = 1;");
});

test("a VARIABLE anchor yields its whole statement, modifiers included", () => {
  // `export` and `const` are part of what the decision anchored; the declarator alone omits both.
  const text = "export const LIMIT = 5;\n";
  assert.equal(locateSymbolSpan(text, FILE, "LIMIT"), "export const LIMIT = 5;");
});

test("a quote with BOTH context fields is a real content comparison, not a presence check", () => {
  const before = 'const a = 1;\nconst mid = "one";\nconst b = 2;\n';
  const after = 'const a = 1;\nconst mid = "two";\nconst b = 2;\n';
  const quote = { exact: 'const mid = "one";', prefix: "const a = 1;\n", suffix: "\nconst b = 2;" };
  const first = locateQuoteSpan(before, quote);
  const second = locateQuoteSpan(after, quote);
  assert.equal(first.kind === "located" ? first.span : undefined, 'const mid = "one";');
  assert.equal(second.kind === "located" ? second.span : undefined, 'const mid = "two";');
  assert.equal(second.kind === "located" ? second.grain : undefined, "quote");
});

test("an AMBIGUOUS quote is refused rather than guessed — the first match is a span nobody anchored", () => {
  const text = "same();\nsame();\n";
  const ambiguous = locateQuoteSpan(text, { exact: "same();" });
  assert.equal(ambiguous.kind, "unlocatable");
  assert.match(ambiguous.kind === "unlocatable" ? ambiguous.why : "", /more than once/);

  const gonePrefix = locateQuoteSpan(text, { exact: "x", prefix: "absent", suffix: "y" });
  assert.equal(gonePrefix.kind, "unlocatable");
});

test("an anchor naming neither symbol nor quote is whole-FILE grain, and says so", () => {
  const located = locateSpanIn("whatever\n", FILE, { file: FILE, boundHash: BOGUS_HASH });
  assert.equal(located.kind === "located" ? located.grain : undefined, "file");
  assert.equal(located.kind === "located" ? located.span : undefined, "whatever\n");
});

// ---------------------------------------------------------------------------
// The projection — the composition a unit test would otherwise never reach
// ---------------------------------------------------------------------------

test("projectDecisionFacts survives a row whose payload is malformed, rather than taking the sweep down", () => {
  // TOTAL over untrusted input: a row written by a branch whose schema this checkout does not carry
  // must project as "no anchors". A read-side throw here would look identical to a real finding.
  const rows: DecisionRow[] = [
    { id: "adr-0011", doc: null },
    { id: "adr-0012", doc: { status: ACCEPTED, sources: "not-a-list" } },
    { id: "adr-0013", doc: { status: ACCEPTED, sources: [{ nonsense: true }, boundAnchor] } },
  ];
  const facts = projectDecisionFacts(rows, treeWith(MOVED));
  assert.deepEqual(
    facts.map((f) => f.sources.length),
    [0, 0, 1],
    "the malformed entry is DROPPED and its healthy sibling survives",
  );
  assert.equal(findDecisionSourceDrift(facts, []).length, 1);
});

test("projectDecisionFacts reads each anchored file, so several decisions over one module agree", () => {
  const rows = [
    row("adr-0014", ACCEPTED, { sources: [boundAnchor] }),
    row("adr-0015", ACCEPTED, { sources: [{ ...boundAnchor, claim: "D9" }] }),
  ];
  const findings = findDecisionSourceDrift(projectDecisionFacts(rows, treeWith(MOVED)), []);
  assert.deepEqual(
    findings.map((f) => f.detail.slice(0, 8)),
    ["adr-0014", "adr-0015"],
  );
});

// ---------------------------------------------------------------------------
// Unit 2 — the registration actually enforces
// ---------------------------------------------------------------------------

test("the instrument is on the CHARTERED roster, so the coverage denominator counts it", () => {
  assert.ok(
    CHARTERED_INSTRUMENTS.includes(DECISION_SOURCE_DRIFT),
    "a swept instrument missing from the roster would report a coverage fraction that is wrong in " +
      "the reassuring direction",
  );
});

test("registered at ceiling 0, one located drift reds the sweep — and zero drift does not", () => {
  // Unit 2 proved rather than asserted: the ceiling is the enforcement, so the pin is that the
  // instrument's findings reach it. Both directions, because only the pair shows it can go either
  // way.
  const decision = row("adr-0016", ACCEPTED, { sources: [boundAnchor] });
  const instrumentOver = (body: string): DecayInstrument => ({
    name: DECISION_SOURCE_DRIFT,
    ceiling: 0,
    locates: "test fixture",
    run: () => findDecisionSourceDrift(factsFor(decision, body), []),
  });

  assert.equal(runDecaySweep([instrumentOver(FROZEN)]).level, "ok");
  assert.equal(runDecaySweep([instrumentOver(MOVED)]).level, "red");
});

test("a finding names its HOLDER — the anchored file is what attribution charges", () => {
  // Unit 3 asks the reader to surface the holder, the decision, which span moved, and whether the
  // movement was described. Three of those are the detail line, proved above. The HOLDER is
  // ADR-0301's attribution, and it works only because `where` is the anchored FILE: main's drift
  // reads as inherited and this branch's own edit as yours.
  const findings = findDecisionSourceDrift(
    factsFor(row("adr-0017", ACCEPTED, { sources: [boundAnchor] }), MOVED),
    [],
  );
  const charged = (touched: readonly string[]): string | undefined =>
    attributeDecayFindings(findings, {
      branch: "claude/example",
      touchedFiles: new Set(touched),
      crossInput: new Map(),
      alsoAuthored: new Map(),
    }).byId.get(String(findings[0]?.id))?.owner;

  assert.equal(charged([FILE]), "authored", "this branch moved the span under the claim");
  assert.equal(charged(["packages/other/src/unrelated.ts"]), "inherited", "main's drift is not yours");
});

test("an unreachable decision log ESCALATES rather than reporting a clean sweep", () => {
  // The blind-instrument condition, which is what an unopenable pool becomes. It must NOT read as
  // backlog: an instrument that swept nothing located nothing, and no ceiling can clear it.
  const dead: DecayInstrument = {
    name: DECISION_SOURCE_DRIFT,
    ceiling: 0,
    locates: "test fixture",
    run: () => {
      throw new Error("the decision log has been in the store since ADR-0403 and it could not be read");
    },
  };
  const verdict = runDecaySweep([dead]);
  assert.equal(verdict.escalations.length, 1);
  assert.equal(verdict.count, 0, "an escalation is never counted as backlog");
  assert.match(String(verdict.escalations[0]?.detail), /could not be read/);
  assert.equal(
    evaluateDecayCeiling(verdict.findings, [{ name: DECISION_SOURCE_DRIFT, ceiling: 99 }]).escalations.length,
    1,
    "and raising the ceiling cannot clear it",
  );
});

test("a decision's judged status is its stored half, derived superseded, or empty when unreadable (ADR-0609)", () => {
  const statusOf = (rows: DecisionRow[], id: string): string | undefined =>
    projectDecisionFacts(rows, () => undefined).find((f) => f.id === id)?.status;
  assert.equal(statusOf([row("adr-0001", ACCEPTED)], "adr-0001"), ACCEPTED);
  assert.equal(statusOf([row("adr-0001", ACCEPTED, { status: 42 })], "adr-0001"), "", "an unreadable status is never judged");
  assert.equal(statusOf([row("adr-0001", "superseded")], "adr-0001"), ACCEPTED, "a legacy stored word with no replacer");
  assert.equal(statusOf([row("adr-0001", ACCEPTED), row("adr-0002", ACCEPTED, { supersedes: [1] })], "adr-0001"), "superseded");
  assert.equal(statusOf([row("not-a-decision", ACCEPTED)], "not-a-decision"), ACCEPTED);
});
