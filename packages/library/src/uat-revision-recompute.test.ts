import test from "node:test";
import assert from "node:assert/strict";

import {
  canonicalUatCriterionContent,
  criterionRevisionId,
  parseUatTestCriteria,
  recomputeUatRevisionIds,
} from "./uat-test-criteria.js";

const A = "uatc_0123456789abcdef01234567";
const B = "uatc_89abcdef0123456701234567";

/** Author one criterion item whose `(revision-id:)` correctly binds its own canonical content. */
function bound(ordinal: number, criterionId: string, prose: string, extra = ""): string {
  const unbound = `${ordinal}. ${prose} ${extra}`.trimEnd();
  const revisionId = criterionRevisionId(canonicalUatCriterionContent(unbound));
  return `${ordinal}. ${prose} _(criterion-id: ${criterionId})_ _(revision-id: ${revisionId})_ ${extra}`.trimEnd();
}

function section(...items: string[]): string {
  return `## UAT Test Criteria\n\n${items.join("\n")}\n`;
}

test("a clean story reports no drift and is returned byte-identical", () => {
  const body = section(
    bound(1, A, "**First** _(witness: human)_: one."),
    bound(2, B, "**Second** _(witness: machine)_: two."),
  );
  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.checked, 2);
  assert.deepEqual(result.drifted, []);
  assert.equal(result.body, body);
});

test("an edited criterion is reported as drifted, naming authored and expected", () => {
  const original = bound(1, A, "**Claim** _(witness: human)_: the original prose.");
  const authoredRevisionId = /\(revision-id:\s*([^)]*)\)/.exec(original)![1]!.trim();
  // The edit the ceremony actually makes: prose inside the hashed canonical content changes.
  const edited = original.replace("the original prose.", "the revised prose.");
  const body = section(edited, bound(2, B, "**Untouched** _(witness: machine)_: two."));

  // Pre-condition: the drift is real — the parser refuses the whole story until it is recomputed.
  assert.throws(() => parseUatTestCriteria("demo", body), /does not bind current content/);

  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.checked, 2);
  assert.equal(result.drifted.length, 1);
  const [drift] = result.drifted;
  assert.equal(drift!.criterionId, A);
  assert.equal(drift!.authoredRevisionId, authoredRevisionId);
  assert.notEqual(drift!.expectedRevisionId, authoredRevisionId);
});

test("the rewrite makes the previously-throwing story parse, and records the superseded revision", () => {
  const original = bound(1, A, "**Claim** _(witness: human)_: the original prose.");
  const authoredRevisionId = /\(revision-id:\s*([^)]*)\)/.exec(original)![1]!.trim();
  const body = section(original.replace("the original prose.", "the revised prose."));

  const result = recomputeUatRevisionIds("demo", body);
  const parsed = parseUatTestCriteria("demo", result.body);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]!.criterionId, A, "identity is authored and immutable — never renumbered");
  assert.equal(parsed[0]!.revisionId, result.drifted[0]!.expectedRevisionId);
  assert.equal(
    parsed[0]!.previousRevisionId,
    authoredRevisionId,
    "the superseded value is recorded as (previous-revision-id:), preserving lineage",
  );
});

test("recomputing is idempotent — a rewritten body reports no further drift", () => {
  const body = section(
    bound(1, A, "**Claim** _(witness: human)_: the original prose.").replace(
      "the original prose.",
      "the revised prose.",
    ),
  );
  const once = recomputeUatRevisionIds("demo", body);
  const twice = recomputeUatRevisionIds("demo", once.body);
  assert.deepEqual(twice.drifted, []);
  assert.equal(twice.body, once.body);
});

test("an existing previous-revision-id is advanced, never duplicated", () => {
  const first = bound(1, A, "**Claim** _(witness: human)_: v1.");
  const firstRevisionId = /\(revision-id:\s*([^)]*)\)/.exec(first)![1]!.trim();
  const second = bound(1, A, "**Claim** _(witness: human)_: v2.", `_(previous-revision-id: ${firstRevisionId})_`);
  const secondRevisionId = /\(revision-id:\s*([^)]*)\)/.exec(second)![1]!.trim();

  const body = section(second.replace("v2.", "v3."));
  const result = recomputeUatRevisionIds("demo", body);
  // A second (previous-revision-id:) annotation would make the parser throw on the duplicate.
  const parsed = parseUatTestCriteria("demo", result.body);
  assert.equal(parsed[0]!.previousRevisionId, secondRevisionId);
  assert.equal((result.body.match(/\(previous-revision-id:/g) ?? []).length, 1);
});

test("a fused annotation run is recomputed like a standalone one", () => {
  // The second written form: the whole annotation run inside one underscore pair (the shape a grep
  // census misses). The recompute must handle it, since it is what the corpus actually contains.
  const prose = "**Claim**: fused annotations.";
  const unbound = `1. ${prose} _(witness: machine)(detail: demo#uat-1)_`;
  const revisionId = criterionRevisionId(canonicalUatCriterionContent(unbound));
  const item = `1. ${prose} _(criterion-id: ${A})(revision-id: ${revisionId})_ _(witness: machine)(detail: demo#uat-1)_`;
  assert.deepEqual(recomputeUatRevisionIds("demo", section(item)).drifted, []);

  const edited = item.replace("fused annotations.", "fused annotations, edited.");
  const result = recomputeUatRevisionIds("demo", section(edited));
  assert.equal(result.drifted.length, 1);
  const parsed = parseUatTestCriteria("demo", result.body);
  assert.equal(parsed[0]!.criterionId, A);
  assert.equal(parsed[0]!.previousRevisionId, revisionId);
  assert.equal(parsed[0]!.witness, "machine");
});

test("a story with no UAT section is inspected and left alone", () => {
  const body = "## Something Else\n\n1. Not a criterion.\n";
  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.checked, 0);
  assert.deepEqual(result.drifted, []);
  assert.equal(result.body, body);
});

test("prose outside the criterion list survives the rewrite untouched", () => {
  const original = bound(1, A, "**Claim** _(witness: human)_: the original prose.");
  const body = `# Story\n\nIntro prose.\n\n${section(original.replace("original", "revised"))}\n## After\n\nTrailing prose.\n`;
  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.drifted.length, 1);
  assert.match(result.body, /^# Story\n\nIntro prose\./);
  assert.match(result.body, /## After\n\nTrailing prose\.\n$/);
});

// ── line endings ─────────────────────────────────────────────────────────────
//
// A story file written through Python `io.open(p, "w")`, PowerShell `Out-File` or several editors
// gets CRLF by default on the only dev box here, so this input is ORDINARY rather than exotic. The
// splitter used to cut the section on bare "\n", which left every line carrying a trailing "\r",
// no line matching NUMBERED_ITEM, and therefore ZERO items — reported by every reader as a legal
// "this story declares no criteria". `canonicalUatCriterionContent` already normalised, so the
// inconsistency sat inside this one module.

/** The same body as a file written in text mode on Windows produces. */
const asCrlf = (body: string): string => body.replace(/\n/g, "\r\n");

test("a CRLF story parses exactly as its LF twin — line endings are normalised at the parse boundary", () => {
  const lf = section(
    bound(1, A, "**First** _(witness: human)_: one."),
    bound(2, B, "**Second** _(witness: machine)_: two."),
  );
  const parsedLf = parseUatTestCriteria("demo", lf);
  assert.equal(parsedLf.length, 2, "guard: the LF twin is the control and must parse");

  const parsedCrlf = parseUatTestCriteria("demo", asCrlf(lf));
  assert.deepEqual(
    parsedCrlf,
    parsedLf,
    "a CRLF body must not parse to zero criteria — that reads as a LEGAL declaration of none",
  );
});

test("a clean CRLF story reports no drift and is returned BYTE-IDENTICAL — nothing reformats a file it had no reason to touch", () => {
  const body = asCrlf(section(bound(1, A, "**Claim** _(witness: human)_: one.")));
  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.checked, 1, "the item is seen");
  assert.deepEqual(result.drifted, []);
  assert.equal(result.body, body, "no drift means no rewrite, CRLF included");
});

test("a drifted CRLF story splices the right span — the rewrite is made against the text it is returned in", () => {
  // The span trap: RawUatItem.start/end are ABSOLUTE indices, and normalising SHORTENS the body by
  // one byte per line. Splicing normalised spans into the un-normalised body would cut mid-item and
  // silently corrupt the rewrite, which is worse than the bug being fixed.
  const original = bound(1, A, "**Claim** _(witness: human)_: the original prose.");
  const authoredRevisionId = /\(revision-id:\s*([^)]*)\)/.exec(original)![1]!.trim();
  const drifted = original.replace("the original prose.", "the revised prose.");
  const body = asCrlf(
    `# Story\n\nIntro prose.\n\n${section(drifted, bound(2, B, "**Second** _(witness: machine)_: two."))}\n## After\n\nTrailing prose.\n`,
  );

  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.checked, 2);
  assert.equal(result.drifted.length, 1);
  assert.equal(result.drifted[0]!.criterionId, A);

  // The returned body is what the caller writes, so it must parse — a corrupted splice would not.
  const parsed = parseUatTestCriteria("demo", result.body);
  assert.equal(parsed.length, 2, "both items survive the rewrite");
  assert.equal(parsed[0]!.criterionId, A);
  assert.equal(parsed[0]!.previousRevisionId, authoredRevisionId);
  assert.equal(parsed[1]!.criterionId, B, "the untouched sibling is not cut into");
  assert.match(result.body, /^# Story\n\nIntro prose\./, "prose before the section survives");
  assert.match(result.body, /## After\n\nTrailing prose\.\n$/, "prose after the section survives");
  assert.ok(!result.body.includes("\r"), "a rewritten body is returned normalised");
});

// ── an unreadable section is distinguishable from an empty one ────────────────
//
// Fixing the splitter stops THIS cause, but "zero criteria" stays a LEGAL declaration (ADR-0294 D4)
// and the next cause that yields a silent empty parse lands in the same blind spot. The
// discriminator is measured, not chosen: across all 42 heading-bearing stories on 2026-09-22, the
// 15 that parse to zero items carry ZERO `(criterion-id:)` annotations in their section, and all 27
// that parse to one or more carry them. So a section declaring identities while yielding no items is
// a CONTRADICTION — it cannot be read — whereas a section with neither is a story saying "none".
// Refusing merely on a PRESENT heading would have redded those 15 honest stories.

test("a section declaring criterion-ids while yielding no items is UNREADABLE, not empty", () => {
  // A future cause, standing in for the CRLF one now fixed: the items are not numbered, so the
  // splitter finds none — while the identities are plainly authored in the section.
  const body = `## UAT Test Criteria\n\n- **Claim** _(criterion-id: ${A})_ _(revision-id: uatc_0000000000000000deadbeef)_: one.\n`;
  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.checked, 0);
  assert.equal(
    result.unreadableSection,
    true,
    "identities are declared and nothing parsed — the verb must not certify this as 'nothing to do'",
  );
});

test("a story deliberately declaring NO criteria is empty, not unreadable — 15 real stories are in this state", () => {
  const body =
    "## UAT Test Criteria\n\n**None — this story is retired.** A story may declare zero UAT criteria\n(ADR-0294 D4), so an empty section here is a statement rather than a gap.\n";
  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.checked, 0);
  assert.equal(result.unreadableSection, false, "an honest 'declares none' must never be refused");
});

test("a story with no UAT heading at all is not unreadable either", () => {
  const result = recomputeUatRevisionIds("demo", "## Something Else\n\n1. Not a criterion.\n");
  assert.equal(result.checked, 0);
  assert.equal(result.unreadableSection, false);
});

test("a HEALTHY section is never flagged unreadable — the discriminator needs BOTH halves", () => {
  // The guard that matters: `unreadableSection` must require zero items AND declared identities.
  // Dropping the zero-items half flags every healthy story instead, because all 27 that parse carry
  // `(criterion-id:)` — turning a narrow signal into a refusal of the whole corpus.
  const body = section(
    bound(1, A, "**First** _(witness: human)_: one."),
    bound(2, B, "**Second** _(witness: machine)_: two."),
  );
  const result = recomputeUatRevisionIds("demo", body);
  assert.equal(result.checked, 2, "guard: the section really did parse");
  assert.equal(result.unreadableSection, false, "items parsed, so nothing is unread");
});

test("a bare CR is normalised too — `\\r` alone is a line ending, not only `\\r\\n`", () => {
  // `/\r\n?/g` collapses BOTH endings. A bare-CR file is rarer than CRLF but breaks identically,
  // and the optional `\n` is the only thing covering it.
  const lf = section(
    bound(1, A, "**First** _(witness: human)_: one."),
    bound(2, B, "**Second** _(witness: machine)_: two."),
  );
  const cr = lf.replace(/\n/g, "\r");
  assert.equal(parseUatTestCriteria("demo", cr).length, 2);
  assert.equal(recomputeUatRevisionIds("demo", cr).checked, 2);
});
