import assert from "node:assert/strict";
import test from "node:test";

import {
  adrDocId,
  adrNumberOfArtifactId,
  parseDecisionPointer,
} from "./decision-pointer.js";
import {
  adrDocumentFieldsOf,
  extractAdrTitle,
  parseAdrDocument,
  renderAdrDocument,
  type AdrDocumentFields,
} from "./adr-doc.js";

/**
 * The canonical five-section decision — 311 of the 403 committed records carry exactly this shape.
 * Kept as a LITERAL rather than read off disk: `docs/decisions/**` is mapped by the affected-scope
 * classifier to cli + drive + app-surface (ADR-0394/0399, a MEASURED reader map), and a library test
 * that read the tree would make that map wrong — a decision edit would stop running the suite that
 * had just become one of its readers.
 */
const CANONICAL = `---
status: accepted
decided: 2026-08-21
arc: decision-log-home-arc
supersedes: [139, 223]
---
# ADR-0403: The decision log becomes ordinary artifacts in Postgres

## Status

accepted (2026-08-21)

## Context

Some context.

## Decision

**1. It moves.**

## Consequences

Things follow.

## References

- [ADR-0302](0302-online-or-nothing.md)
`;

test("adr-doc-parses-the-canonical-record: frontmatter becomes typed fields and the body survives whole", () => {
  const fields = parseAdrDocument(403, CANONICAL);

  assert.equal(fields.number, 403);
  assert.equal(fields.status, "accepted");
  assert.equal(fields.decided, "2026-08-21");
  assert.equal(fields.arc, "decision-log-home-arc");
  assert.deepEqual(fields.supersedes, [139, 223]);
  assert.equal(fields.loadBearing, false);
  assert.equal(fields.title, "The decision log becomes ordinary artifacts in Postgres");
  // The body is EVERYTHING after the closing fence, including the H1 — a decision record is one
  // document, and the whole reason it is carried as a single field is that 92 of 403 records carry
  // headings a fixed section table has no name for.
  assert.ok(fields.body.startsWith("# ADR-0403: "));
  assert.ok(fields.body.includes("## References"));
  assert.equal(fields.body, CANONICAL.slice(CANONICAL.indexOf("\n---\n") + "\n---\n".length));
});

test("adr-doc-round-trip-is-byte-identical: ADR-0403 dec 9's authorability property", () => {
  // The property the round-trip edit verb rests on: pull a decision to a file, change nothing, write
  // it back, and the stored document is the same bytes. A single drifting byte per pass would make
  // every no-op edit show up as a diff and the tier's history unreadable.
  const once = renderAdrDocument(parseAdrDocument(403, CANONICAL));
  const twice = renderAdrDocument(parseAdrDocument(403, once));
  assert.equal(twice, once);
  assert.deepEqual(parseAdrDocument(403, once), parseAdrDocument(403, twice));
});

test("adr-doc-round-trip-preserves-unknown-sections: a record with its own headings loses nothing", () => {
  // 92 of 403 committed records carry headings outside the canonical five — `## What this does NOT
  // decide`, `## Options weighed and rejected`, a dated `## Reaffirmation`. This is the measurement
  // that decided the kind's shape, so it is the case a regression would break first.
  const odd = `---
status: accepted
---
# ADR-0201: A record with its own shape

## Status

accepted

## Owner decisions (2026-06-14)

The owner said so.

## What this does NOT decide

Nothing else.
`;
  const fields = parseAdrDocument(201, odd);
  assert.ok(fields.body.includes("## Owner decisions (2026-06-14)"));
  assert.ok(fields.body.includes("## What this does NOT decide"));
  assert.equal(renderAdrDocument(fields), odd);
});

test("adr-doc-omits-defaulted-frontmatter-keys: an absent edge list is not written back as empty", () => {
  // 107 of 403 records carried no edge key at all. Emitting `supersedes: []` for them would make every
  // one differ from its own source for no information gained — and would then differ AGAIN from a
  // hand-edited round trip that dropped it, which is how a "byte-identical" claim quietly stops
  // being true.
  const minimal = `---
status: proposed
---
# ADR-0001: A bare record
`;
  const rendered = renderAdrDocument(parseAdrDocument(1, minimal));
  assert.equal(rendered, minimal);
  assert.ok(!rendered.includes("amends"));
  assert.ok(!rendered.includes("supersedes"));
  assert.ok(!rendered.includes("load_bearing"));
});

test("adr-doc-carries-the-load-bearing-tag-and-supersedes-edge: both survive a round trip", () => {
  const tagged = `---
status: accepted
decided: 2026-06-01
supersedes: [86]
load_bearing: true
---
# ADR-0139: Correct in place
`;
  const fields = parseAdrDocument(139, tagged);
  assert.equal(fields.loadBearing, true);
  assert.deepEqual(fields.supersedes, [86]);
  assert.equal(renderAdrDocument(fields), tagged);
});

test("adr-doc-refuses-a-retired-frontmatter-key: `supersedes_in_part` fails loudly rather than dropping", () => {
  // ADR-0139 retired the key. Silently dropping it on the way into a row would ERASE the edge the
  // retirement exists to force someone to re-express as `amends`, and the row would then read as a
  // decision with no lineage at all.
  const stale = `---
status: accepted
supersedes_in_part: [12]
---
# ADR-0099: A record with a retired key
`;
  assert.throws(() => parseAdrDocument(99, stale), /unknown frontmatter key/);
});

test("adr-doc-refuses-a-missing-or-unterminated-frontmatter-block: no silent default state", () => {
  assert.throws(() => parseAdrDocument(1, "# ADR-0001: No frontmatter\n"), /no frontmatter block/);
  assert.throws(() => parseAdrDocument(1, "---\nstatus: accepted\n"), /unterminated frontmatter block/);
});

test("adr-doc-refuses-a-bad-status-or-edge-list: a mistyped value never becomes a default", () => {
  assert.throws(() => parseAdrDocument(1, "---\nstatus: acepted\n---\nbody\n"));
  assert.throws(
    () => parseAdrDocument(1, "---\nstatus: accepted\nsupersedes: 139\n---\nbody\n"),
    /must be a list of numbers/,
  );
  assert.throws(
    () => parseAdrDocument(1, '---\nstatus: accepted\nsupersedes: ["139"]\n---\nbody\n'),
    /must contain positive integers/,
  );
  // And the RETIRED key is refused as unknown rather than parsed — `FRONTMATTER_ORDER` is the
  // known-key set, so removing `amends` from it is what makes a stale document fail loudly instead
  // of having its edge silently dropped on the way into the row (ADR-0431 D1, `-inc-19`).
  assert.throws(
    () => parseAdrDocument(1, "---\nstatus: accepted\namends: [139]\n---\nbody\n"),
    /unknown frontmatter key `amends`/,
  );
});

test("adr-doc-takes-the-number-from-the-caller-not-the-heading: a heading is prose, a filename is an allocation", () => {
  // The filename is what the ADR-0050 allocator RESERVED; the H1 is prose anyone can edit. Keying a
  // row off the heading would let a typo re-key the row or collide with another decision's — and
  // both look like a successful write. All 403 committed records agree with their filenames today,
  // so this pins a guard rather than repairing a known rot.
  const mismatched = `---
status: accepted
---
# ADR-0122: A capability declares where its contract tests live
`;
  const fields = parseAdrDocument(353, mismatched);
  assert.equal(fields.number, 353);
  assert.equal(fields.title, "A capability declares where its contract tests live");
  assert.equal(adrDocId(fields.number), "adr-0353");
});

test("adr-doc-id-round-trips-and-refuses-a-near-miss: `adr-` alone is not a decision", () => {
  assert.equal(adrDocId(403), "adr-0403");
  assert.equal(adrDocId(1), "adr-0001");
  assert.equal(adrNumberOfArtifactId("adr-0403"), 403);
  // The collision the four-digit shape guards: a legal artifact id that merely begins `adr-` must
  // read as "not a decision", never resolve to NaN and render as `ADR-NaN`.
  assert.equal(adrNumberOfArtifactId("adr-health-notes"), null);
  assert.equal(adrNumberOfArtifactId("adr-403"), null);
  assert.equal(adrNumberOfArtifactId("merge-ceremony"), null);
});

test("adr-doc-artifact-pointer-resolves-through-the-one-parser: the third spelling joins the other two", () => {
  // ADR-0403 dec 7's whole mechanism: every reader already routes through `parseDecisionPointer`, so
  // the post-migration spelling arrives for free and a corpus mid-rewrite reads the same as one
  // either side of it.
  assert.deepEqual(parseDecisionPointer("asset:adr-0403"), { number: 403, spelling: "asset" });
  assert.equal(
    parseDecisionPointer("asset:adr-0403")?.number,
    parseDecisionPointer("doc:decisions/0403-a-title.md")?.number,
  );
  // A `asset:` pointer at an ordinary artifact is emphatically NOT a decision.
  assert.equal(parseDecisionPointer("asset:merge-ceremony"), null);
});

test("adr-doc-extracts-a-title-or-honestly-reports-none: a bodiless record does not invent one", () => {
  assert.equal(extractAdrTitle("# ADR-0403: A title\n\ntext"), "A title");
  assert.equal(extractAdrTitle("no heading here"), "");
  assert.equal(extractAdrTitle("## ADR-0403: not an H1"), "");
});

test("adr-doc-normalises-crlf: a windows-authored record parses to the same fields", () => {
  const crlf = CANONICAL.replace(/\n/g, "\r\n");
  const fields: AdrDocumentFields = parseAdrDocument(403, crlf);
  assert.deepEqual(fields, parseAdrDocument(403, CANONICAL));
});

test("adr-doc-refuses-a-mistyped-decided-date: a dropped dash must never delete the field", () => {
  // `decided` used to fall through a ternary to `undefined`, where its two siblings (`arc`,
  // `load_bearing`) throw — and the round-trip push turns an absent `decided` into a field DELETION.
  // So the whole failure was silent: the parse succeeded, the push reported success, and the decision
  // lost the date it was decided on.
  //
  // The realistic input is the one below: an ISO date with the dashes dropped is a valid YAML NUMBER.
  const mistyped = CANONICAL.replace("decided: 2026-08-21", "decided: 20260821");
  assert.throws(() => parseAdrDocument(403, mistyped), /`decided` must be a non-empty string/);

  // The other degrade-to-nothing shapes fail the same way.
  assert.throws(() => parseAdrDocument(403, CANONICAL.replace("decided: 2026-08-21", "decided: true")), /`decided`/);
  assert.throws(() => parseAdrDocument(403, CANONICAL.replace("decided: 2026-08-21", 'decided: ""')), /`decided`/);

  // And a QUOTED date still parses — the guard is a guard, not a wall.
  const quoted = CANONICAL.replace("decided: 2026-08-21", 'decided: "2026-08-21"');
  assert.equal(parseAdrDocument(403, quoted).decided, "2026-08-21");
});

test("adr-doc-resolves-a-bare-date-to-a-string: the `Date` branch this parser cannot reach", () => {
  // A `decidedRaw instanceof Date` branch stood in the parser under the comment "yaml resolves a bare
  // ISO date to a Date". It never ran: under YAML 1.2 core — what the `yaml` package implements — a
  // bare date resolves to a STRING. Asserted rather than deleted silently, so the dead branch cannot
  // come back on the strength of the comment that justified it.
  assert.equal(parseAdrDocument(403, CANONICAL).decided, "2026-08-21");
  const stamped = CANONICAL.replace("decided: 2026-08-21", "decided: 2026-08-21T00:00:00Z");
  assert.equal(parseAdrDocument(403, stamped).decided, "2026-08-21T00:00:00Z");
});

test("adr-doc-strips-a-utf8-bom: an invisible byte is normalised, not refused with an unusable remedy", () => {
  // A BOM pushes the `---` off byte 0, so the document was refused as having "no frontmatter block" —
  // whose diagnosis offers the `>`-redirect remedy (ADR-0361), the one remedy that cannot help,
  // because re-capturing with `adr pull --out` reproduces nothing about a BOM an editor added. Same
  // class of normalisation as the CRLF fold beside it, and most likely on this repo's dev platform.
  const withBom = `﻿${CANONICAL}`;
  assert.deepEqual(parseAdrDocument(403, withBom), parseAdrDocument(403, CANONICAL));

  // A BOM on a CRLF file — the likeliest Windows shape of all — parses too.
  assert.deepEqual(parseAdrDocument(403, `﻿${CANONICAL.replace(/\n/g, "\r\n")}`), parseAdrDocument(403, CANONICAL));
});

test("adr-doc-ignores-a-heading-quoted-in-fenced-code: a cited decision does not rename this one", () => {
  // Decisions cite decisions, so a fenced block holding another decision's `# ADR-NNNN:` heading is
  // ordinary content. The title regex is line-anchored and a fenced line sits at column 0, so the
  // quoted heading matched exactly like a real H1 — and the round-trip push writes `title` from this
  // function, so the wrong name landed on the row. `adr-completeness.ts` strips fences for the same
  // reason.
  const quotingFirst = ["```", "# ADR-0050: Some other decision", "```", "", "# ADR-0403: The real one", ""].join("\n");
  assert.equal(extractAdrTitle(quotingFirst), "The real one");

  // ...and when the fence comes AFTER the real heading, the real one still wins.
  const quotingSecond = ["# ADR-0403: The real one", "", "```", "# ADR-0050: Some other decision", "```", ""].join("\n");
  assert.equal(extractAdrTitle(quotingSecond), "The real one");

  // A body with ONLY a quoted heading reports none, rather than borrowing the citation's name.
  assert.equal(extractAdrTitle(["```", "# ADR-0050: Some other decision", "```"].join("\n")), "");

  // Removing a fence never eats the newline in front of a following heading.
  assert.equal(extractAdrTitle("```\nx\n```\n# ADR-0403: Still found\n"), "Still found");
});

// ---- `depends_on`: the plain support edge at the document surface (ADR-0419 D1/D2) -----------

test("adr-doc-round-trips-depends-on: the plain support edge survives parse -> render byte-for-byte", () => {
  // The whole-document round trip is how a decision's prose is edited (ADR-0403 dec 9), so an edge
  // the document cannot carry is an edge nobody can author. `depends_on` is the one support edge
  // since ADR-0431 D1, and it must survive a no-op round trip byte-for-byte.
  const text = CANONICAL.replace("supersedes: [139, 223]", 'depends_on: ["asset:adr-0403"]\nsupersedes: [139]');
  const fields = parseAdrDocument(419, text);
  assert.deepEqual(fields.dependsOn, ["asset:adr-0403"]);
  assert.deepEqual(fields.supersedes, [139], "support and archaeology are read apart, never summed");
  assert.equal(renderAdrDocument(fields), text, "a no-op round trip is byte-identical (ADR-0403 dec 9)");
});

test("adr-doc-keeps-depends-on-absence-distinct-from-empty: presence is what the migration counts", () => {
  // NOT the same collapse a defaulted list gets. `dependsOn` is optional-not-defaulted (ADR-0223), and
  // `DecisionSupportResolver.decisionsCarryingDependsOn` counts KEY PRESENCE precisely because zero
  // resolvable edges has two causes — a reader blind to the field, and a log that genuinely carries
  // none. A round trip that folded `[]` into absent would silently decrement that denominator.
  const absent = parseAdrDocument(419, CANONICAL);
  assert.equal(absent.dependsOn, undefined, "no key means this document does not carry the edge");
  assert.doesNotMatch(renderAdrDocument(absent), /depends_on/);

  const emptyText = CANONICAL.replace("supersedes: [139, 223]", "depends_on: []\nsupersedes: [139, 223]");
  const empty = parseAdrDocument(419, emptyText);
  assert.deepEqual(empty.dependsOn, [], "an authored empty list is a different fact from no key");
  assert.equal(renderAdrDocument(empty), emptyText, "and it is emitted, not omitted as a default");
});

test("adr-doc-refuses-a-malformed-depends-on: a bad entry fails loudly, never degrades to absent", () => {
  // The parser's stated posture: a mistyped value never becomes a default. Degrading here would make
  // the push DELETE the row's edge while reporting success.
  assert.throws(
    () => parseAdrDocument(419, CANONICAL.replace("supersedes: [139, 223]", "depends_on: 403")),
    /`depends_on` must be a list of strings/,
  );
  assert.throws(
    () => parseAdrDocument(419, CANONICAL.replace("supersedes: [139, 223]", "depends_on: [403]")),
    /`depends_on` must contain non-empty strings/,
  );
  // An explicit null is a malformed list, NOT an absent key — `Object.hasOwn` is what keeps the two
  // apart, so this must throw rather than read as "carries no edge".
  assert.throws(
    () => parseAdrDocument(419, CANONICAL.replace("supersedes: [139, 223]", "depends_on:")),
    /`depends_on` must be a list of strings/,
  );
});

test("adr-doc-refuses-sources-in-frontmatter: a content hash is not hand-editable (ADR-0424 D6)", () => {
  // ADR-0424 D6 keeps the grounded-claim anchors OFF the document. A hash inside a file a human
  // hand-edits is not evidence of anything — it is editable to whatever value makes the drift flag
  // go away, which is the *halted is never a pass* shape wearing a different hat.
  //
  // The refusal is the enforcement. `FRONTMATTER_ORDER` is also the known-key set, so a `sources:`
  // key in a pulled document fails loudly here rather than being silently dropped on the way into a
  // row — the same posture that retired `supersedes_in_part` gets, and for the same reason: a key
  // quietly discarded erases the very fact somebody was trying to record.
  assert.throws(
    () => parseAdrDocument(424, CANONICAL.replace("supersedes: [139, 223]", 'sources: ["packages/cli/src/adr.ts"]')),
    /unknown frontmatter key `sources`/,
  );
});

test("adr-doc-never-emits-sources: the row's anchors stay off the document it renders", () => {
  // The other direction of the same rule. `AdrDocumentFields` carries no `sources`, so a row that
  // has been grounded renders EXACTLY the document an ungrounded one does — which is what lets
  // `adrPush`'s `{...row, <named fields>}` spread carry the anchors across a round trip untouched
  // (ADR-0424 D7). If this ever emitted the key, the very next push would parse it back and a
  // corrected document would become evidence that somebody re-checked the code. It is not.
  const fields = parseAdrDocument(424, CANONICAL);
  const rendered = renderAdrDocument(fields);
  assert.doesNotMatch(rendered, /sources/);
  assert.equal(Object.hasOwn(fields, "sources"), false);
});

test("adr-doc-renders-a-grounded-row-identically: anchors change no byte of the document", () => {
  // The row -> document direction, which is the one `adr pull` runs. A decision that HAS been
  // grounded must pull as exactly the document an ungrounded one pulls, or the anchors would
  // round-trip through a file and become hand-editable after all.
  const base = {
    title: "Grounded claims",
    body: "# ADR-0424: Grounded claims\n\n## Decision\n\nBind at the flip.\n",
    status: "accepted",
  };
  const ungrounded = renderAdrDocument(adrDocumentFieldsOf("adr-0424", base));
  const grounded = renderAdrDocument(
    adrDocumentFieldsOf("adr-0424", { ...base, sources: [{ claim: "D7", file: "packages/cli/src/adr.ts", boundHash: "a1b2" }] }),
  );
  assert.equal(grounded, ungrounded);
});

test("adr-doc-refuses-a-written-superseded-status: supersession is the replacer's edge (ADR-0609 D3)", () => {
  // `superseded` is derived from the REPLACING record's `supersedes`. A document that still says it
  // about itself would record nothing, so it is refused with the move that does the job — never
  // silently mapped, which would let an author believe a decision was superseded when it was not.
  assert.throws(
    () => parseAdrDocument(86, "---\nstatus: superseded\n---\n# ADR-0086: Replaced\n"),
    /no longer written[\s\S]*ADR-0609 D3[\s\S]*record the edge on the replacing decision/,
  );
});

test("adr-doc-fields-of-a-row-take-the-number-from-the-id: nothing stores it (ADR-0609 D1)", () => {
  const fields = adrDocumentFieldsOf("adr-0086", { title: "Old", body: "", status: "accepted" });
  assert.equal(fields.number, 86);
  // A row a stale writer left carrying `number` does not get a say — the id is the allocation.
  assert.equal(adrDocumentFieldsOf("adr-0086", { number: 99, body: "", status: "accepted" }).number, 86);
  // A legacy stored `superseded` reads as its authored half, exactly what its next write stores, so
  // a pull renders a document the push will accept.
  assert.equal(adrDocumentFieldsOf("adr-0086", { body: "", status: "superseded" }).status, "accepted");
});
