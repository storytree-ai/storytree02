import assert from "node:assert/strict";
import test from "node:test";

import {
  adrDescriptionOf,
  decisionCardLineOf,
  decisionStatusOf,
  storedDecisionStatusOf,
  stripDerivedDecisionFields,
  supersededDecisionNumbers,
} from "./decision-derived.js";
import { validateLibraryDoc } from "./library-doc.js";
import { upcast } from "./migrations.js";
import { renderStoredDoc } from "./store/render-doc.js";

// ADR-0609: a decision's number, card line and `superseded` status are computed on read. These pin
// the computation, and the write boundary that makes storing a copy impossible.

const row = (n: number, doc: Record<string, unknown>) => ({ id: `adr-${String(n).padStart(4, "0")}`, doc });

test("superseded-is-derived-from-a-decided-replacer: any non-proposed record's supersedes counts", () => {
  const set = supersededDecisionNumbers([
    row(10, { status: "accepted", supersedes: [1] }),
    // A replacer that was itself replaced still supersedes: the chain 2 <- 20 <- 30 keeps 2 dead.
    row(20, { status: "accepted", supersedes: [2] }),
    row(30, { status: "accepted", supersedes: [20] }),
    // A LEGACY stored `superseded` replacer counts too — it reads as its authored half, accepted.
    row(40, { status: "superseded", supersedes: [4] }),
    // A proposal's `supersedes` is an intention: it replaces nothing until accepted.
    row(50, { status: "proposed", supersedes: [5] }),
    // Not a decision id: ignored, so a whole-corpus read can be handed in.
    { id: "some-principle", doc: { status: "accepted", supersedes: [6] } },
    // Malformed edges are skipped, never thrown.
    row(60, { status: "accepted", supersedes: "7" }),
    row(61, { status: "accepted", supersedes: [8, "9"] }),
  ]);
  assert.deepEqual([...set].sort((a, b) => a - b), [1, 2, 4, 8, 20]);
});

test("decision-status-is-half-stored-half-derived", () => {
  const superseded = new Set([7]);
  assert.equal(decisionStatusOf(7, "accepted", superseded), "superseded");
  assert.equal(decisionStatusOf(8, "accepted", superseded), "accepted");
  assert.equal(decisionStatusOf(8, "proposed", superseded), "proposed");
  assert.equal(storedDecisionStatusOf("superseded"), "accepted", "legacy rows read as their next write stores");
  assert.equal(storedDecisionStatusOf("proposed"), "proposed");
  assert.equal(storedDecisionStatusOf("acepted"), null, "an unreadable status is the caller's parse error");
  assert.equal(storedDecisionStatusOf(undefined), null);
});

test("card-line-is-computed-from-the-id-and-title", () => {
  assert.equal(adrDescriptionOf(609, "Derive on read"), "ADR-0609 — Derive on read");
  assert.equal(adrDescriptionOf(609, ""), "ADR-0609 — adr-0609", "a title-less record names its id");
  assert.equal(decisionCardLineOf("adr-0609", { title: "Derive on read" }), "ADR-0609 — Derive on read");
  // A stale stored description gets no say — the title is the one source.
  assert.equal(
    decisionCardLineOf("adr-0609", { title: "New title", description: "ADR-0609 — Old title" }),
    "ADR-0609 — New title",
  );
  assert.equal(decisionCardLineOf("some-principle", { title: "x" }), null);
});

test("the-write-boundary-strips-every-derived-field: no writer can store a copy (upcast, every version)", () => {
  const echoed = {
    kind: "adr",
    id: "adr-0086",
    number: 86,
    description: "ADR-0086 — Old",
    status: "superseded",
    title: "Old",
  };
  assert.deepEqual(stripDerivedDecisionFields(echoed), {
    kind: "adr",
    id: "adr-0086",
    status: "accepted",
    title: "Old",
  });
  // Other kinds keep their authored description untouched.
  const principle = { kind: "principle", description: "kept", number: 3 };
  assert.equal(stripDerivedDecisionFields(principle), principle);
  // Crucially this runs at the CURRENT version too — a row already migrated, echoed back by a
  // writer that spread what it read, must not store the copy again.
  const current = upcast({ ...echoed, schemaVersion: 999 });
  assert.equal(Object.hasOwn(current, "number"), false);
  assert.equal(Object.hasOwn(current, "description"), false);
  assert.equal(current["status"], "accepted");
});

test("the-schema-no-longer-declares-the-derived-fields: a raw write carrying one is refused", () => {
  const base = {
    kind: "adr",
    id: "adr-0086",
    title: "Old",
    body: "# ADR-0086: Old\n",
    status: "accepted",
    schemaVersion: 9,
    createdAt: "2026-09-24T00:00:00Z",
    updatedAt: "2026-09-24T00:00:00Z",
  };
  assert.doesNotThrow(() => validateLibraryDoc(base));
  assert.throws(() => validateLibraryDoc({ ...base, number: 86 }));
  assert.throws(() => validateLibraryDoc({ ...base, description: "ADR-0086 — Old" }));
  assert.throws(() => validateLibraryDoc({ ...base, status: "superseded" }));
});

test("render-computes-a-decisions-card-line-and-status: stored copies are ignored", () => {
  const stored = {
    id: "adr-0086",
    kind: "adr",
    doc: {
      kind: "adr",
      id: "adr-0086",
      title: "Old",
      description: "ADR-0086 — a stale copy",
      body: "# ADR-0086: Old\n",
      status: "superseded",
      schemaVersion: 9,
      createdAt: "2026-09-24T00:00:00Z",
      updatedAt: "2026-09-24T00:00:00Z",
    },
    createdAt: "2026-09-24T00:00:00Z",
    updatedAt: "2026-09-24T00:00:00Z",
  };
  const bare = renderStoredDoc(stored);
  assert.equal(bare.description, "ADR-0086 — Old");
  assert.equal(bare.status, "accepted", "one row cannot know it is superseded; it renders its stored half");
  assert.equal(renderStoredDoc(stored, { supersededDecisions: new Set([86]) }).status, "superseded");
  assert.equal(renderStoredDoc(stored, { supersededDecisions: new Set() }).status, "accepted");
});

test("derived helpers are TOTAL over malformed rows: a missing or non-object doc is skipped, never thrown", () => {
  assert.equal(storedDecisionStatusOf("accepted"), "accepted");
  // A replacer with no `supersedes` key, and rows whose doc is not an object at all.
  const set = supersededDecisionNumbers([
    row(70, { status: "accepted" }),
    { id: "adr-0071", doc: null },
    { id: "adr-0072", doc: "accepted" },
    { id: "adr-0073", doc: undefined },
    row(74, { status: "accepted", supersedes: [70] }),
  ]);
  assert.deepEqual([...set], [70]);
  // A card line survives a doc that is not an object, or a title that is not a string.
  assert.equal(decisionCardLineOf("adr-0070", null), "ADR-0070 — adr-0070");
  assert.equal(decisionCardLineOf("adr-0070", undefined), "ADR-0070 — adr-0070");
  assert.equal(decisionCardLineOf("adr-0070", "a string doc"), "ADR-0070 — adr-0070");
  assert.equal(decisionCardLineOf("adr-0070", { title: 42 }), "ADR-0070 — adr-0070");
});

test("the write-boundary strip keeps a proposal proposed: only a stored `superseded` is rewritten", () => {
  assert.equal(stripDerivedDecisionFields({ kind: "adr", status: "proposed", number: 1 })["status"], "proposed");
  assert.equal(stripDerivedDecisionFields({ kind: "adr", status: "accepted" })["status"], "accepted");
});

test("render derives by the ID alone, and leaves every non-decision row's own fields standing", () => {
  const base = { createdAt: "2026-09-24T00:00:00Z", updatedAt: "2026-09-24T00:00:00Z" };
  const doc = (extra: Record<string, unknown>) => ({ schemaVersion: 9, title: "T", ...base, ...extra });
  const context = { supersededDecisions: new Set([1, 86]) };
  // A non-decision keeps its authored card line and its status, context or not — even a status word
  // a decision could carry.
  const inc = renderStoredDoc(
    { id: "inc-1", kind: "increment", doc: doc({ kind: "increment", id: "inc-1", description: "authored", status: "superseded" }), ...base },
    context,
  );
  assert.equal(inc.description, "authored");
  assert.equal(inc.status, "superseded");
  // A decision whose stored status is unreadable is passed through as stored, never replaced by a
  // derived value built on nothing.
  const bogus = renderStoredDoc(
    { id: "adr-0086", kind: "adr", doc: doc({ kind: "adr", id: "adr-0086", body: "b", status: "bogus" }), ...base },
    context,
  );
  assert.equal(bogus.status, "bogus");
  // A row filed as `adr` whose id is no decision id is not a decision: its own description stands.
  const odd = renderStoredDoc(
    { id: "adr-x", kind: "adr", doc: doc({ kind: "adr", id: "adr-x", body: "b", description: "own line", status: "accepted" }), ...base },
    context,
  );
  assert.equal(odd.description, "own line");
  assert.equal(odd.status, "accepted");
});
