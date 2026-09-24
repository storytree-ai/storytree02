import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryTemplates } from "./templates.js";
import { generateTemplate } from "./knowledge-render.js";
import type { KnowledgeKind } from "./knowledge.js";

// The canonical order, matching the historical assets.json (template-adr between techstack and
// open-question). These 13 were the only `template`-category rows in the retired generated file
// (ADR-0210); the module is now their single source.
const EXPECTED_ORDER = [
  "template-definition",
  "template-principle",
  "template-pattern",
  "template-guardrail",
  "template-techstack",
  "template-adr",
  "template-open-question",
  "template-process",
  "template-agent",
  "template-friction",
  "template-arc",
  "template-increment",
];

test("libraryTemplates returns the 13 canonical templates in order", () => {
  assert.deepEqual(
    libraryTemplates().map((t) => t.id),
    EXPECTED_ORDER,
  );
});

test("every template is a well-formed template asset", () => {
  for (const t of libraryTemplates()) {
    assert.equal(t.category, "template", `${t.id} category`);
    assert.ok(t.title.length > 0, `${t.id} has a title`);
    assert.ok(t.description.length > 0, `${t.id} has a description`);
    assert.ok(t.body.length > 0, `${t.id} has a body`);
    assert.match(t.createdAt, /^\d{4}-\d{2}-\d{2}T/, `${t.id} createdAt is ISO`);
    assert.match(t.updatedAt, /^\d{4}-\d{2}-\d{2}T/, `${t.id} updatedAt is ISO`);
  }
});

test("template ids are unique", () => {
  const ids = libraryTemplates().map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("schema-derived template bodies are generated from KIND_SPECS (never a frozen copy)", () => {
  // The ADR-0017 invariant: each schema-derived template's body IS generateTemplate(kind), so it
  // tracks the field set and can never drift from the schema. If someone froze a body as a literal,
  // this fails.
  for (const t of libraryTemplates()) {
    if (t.id === "template-adr") continue;
    const kind = t.id.slice("template-".length) as KnowledgeKind;
    assert.equal(t.body, generateTemplate(kind), `${t.id} body === generateTemplate(${kind})`);
    assert.equal(t.title, `Template — ${kind}`, `${t.id} title follows the Template — <kind> shape`);
  }
});

test("template-adr is the bespoke doc scaffold, not a schema-derived body", () => {
  const adr = libraryTemplates().find((t) => t.id === "template-adr");
  assert.ok(adr, "template-adr is present");
  // It scaffolds a decision document — a row since ADR-0403 dec 1 — so it carries the canonical ADR
  // section shape rather than a knowledge-unit lead marker.
  for (const marker of [
    "# ADR-NNNN",
    "## Status",
    "## Context",
    "## Decision",
    "## Consequences",
    "## Alternatives considered",
    "## References",
  ]) {
    assert.ok(adr.body.includes(marker), `template-adr body contains "${marker}"`);
  }
});

test("template-adr scaffolds no retired edge — `amends` was removed from the schema (ADR-0431 D1)", () => {
  const adr = libraryTemplates().find((t) => t.id === "template-adr");
  assert.ok(adr, "template-adr is present");
  // A template is the scaffold an author COPIES, so a retired key here is worse than a stale
  // mention elsewhere: `storytree adr new` accepts no `--amends`, and an `amends:` frontmatter line
  // is refused, so following the old body produced a hard CLI error. Assert on the two copyable
  // shapes rather than on the word — the body legitimately NAMES the edge to say it is retired.
  for (const [label, shape] of [
    ["a --amends <n> invocation", /--amends\s+\d/],
    ["an amends: [...] frontmatter key", /\bamends:\s*\[/],
  ] as const) {
    assert.ok(!shape.test(adr.body), `template-adr must not scaffold ${label}`);
  }
  // Both surviving keys must still be offered, or the negatives above would pass on an empty body.
  for (const live of ["depends_on", "supersedes"]) {
    assert.ok(adr.body.includes(live), `template-adr still offers \`${live}\``);
  }
  // The obligation the retired edge used to carry OUTLIVES it (ADR-0139 D4), and with the edge gone
  // the in-place annotation is the only record of an amendment. Dropping the instruction along with
  // the edge would trade one wrong instruction for a missing one.
  assert.match(
    adr.body,
    /ANNOTATE that clause/,
    "template-adr still requires the in-place annotation the retired edge used to oblige",
  );
});

test("template-adr teaches that superseded is DERIVED from the replacer's edge, never written (ADR-0609 D3)", () => {
  const adr = libraryTemplates().find((t) => t.id === "template-adr");
  assert.ok(adr !== undefined);
  assert.match(adr.body, /the target READS as `superseded` from this edge alone — nothing is flipped and no row stores the word \(ADR-0609 D3\)/);
  assert.match(adr.body, /The field stores only `proposed` \/ `accepted`; `superseded` is derived from the replacing decision's `supersedes` edge \(ADR-0609 D3\)/);
});
