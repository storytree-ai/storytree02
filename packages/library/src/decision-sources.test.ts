import { Anchor } from "@storytree/proof-protocol";
import assert from "node:assert/strict";
import test from "node:test";

import {
  DecisionSource,
  DecisionSources,
  hasSourcesKey,
  isBoundSource,
  readDecisionSources,
} from "./decision-sources.js";
import { Adr, arrayFieldsForKind, knownFieldsForKind } from "./knowledge.js";

/** A minimal decision row — every field the `adr` schema requires and nothing else. */
const row = {
  kind: "adr",
  id: "adr-0424",
  title: "t",
  body: "# ADR-0424: t",
  status: "accepted",
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:00:00.000Z",
};

/** A BOUND anchor — an identity plus the hash `adr rebind --pg` froze onto it (ADR-0438 D1). */
const bound = {
  claim: "D7",
  file: "packages/cli/src/adr-round-trip.ts",
  symbol: "adrPush",
  boundHash: "a1b2c3d4",
  boundCommit: "ac3acea6c48e00818c574ae31680801fe04ed988",
};

/** The same anchor before acceptance — an identity with nothing bound to it yet. */
const declared = { claim: "D7", file: "packages/cli/src/adr-round-trip.ts", symbol: "adrPush" };

// ---------------------------------------------------------------------------
// The shape, and its derivation from ADR-0016's published Anchor
// ---------------------------------------------------------------------------

test("decision-sources: a BOUND entry is structurally an ADR-0016 Anchor", () => {
  // The derivation pin. `DecisionSource` EXTENDS `Anchor` so a bound entry can be handed to the
  // drift compute with no adapter — if the two ever drift apart, this is what says so rather than a
  // caller discovering it. The `claim` label is the one addition, and `Anchor` is `.strict()`, so it
  // is stripped before the check rather than smuggled through.
  const { claim: _claim, ...anchorHalf } = bound;
  assert.equal(Anchor.safeParse(anchorHalf).success, true);
});

test("decision-sources: an entry with NO boundHash is valid, and reads as unbound", () => {
  // ADR-0424 D2: a decision that is still `proposed` carries anchor IDENTITIES with nothing bound.
  // That is not a degraded anchor — it is the only honest representation of "an author has said
  // which code this claim rests on, and the truth obligation has not attached yet".
  const parsed = DecisionSource.parse(declared);
  assert.equal(isBoundSource(parsed), false);
  assert.equal(isBoundSource(DecisionSource.parse(bound)), true);
});

test("decision-sources: `claim` is OPTIONAL — absent grounds the WHOLE record", () => {
  // The `ComposedStatementFields.scope` convention, kept identical on purpose (ADR-0428 D3): clause
  // identity does not exist in this system, so absent means whole-record on BOTH fields, and the day
  // it is minted the two move the same way.
  const wholeRecord = DecisionSource.parse({ file: "packages/library/src/knowledge.ts", boundHash: "ff" });
  assert.equal(Object.hasOwn(wholeRecord, "claim"), false);
});

test("decision-sources: `claim` is carried VERBATIM, never resolved", () => {
  const parsed = DecisionSource.parse({ ...declared, claim: "the second paragraph of Context" });
  assert.equal(parsed.claim, "the second paragraph of Context");
});

test("decision-sources: TWO anchors on ONE claim are allowed", () => {
  // Where this parts company with `composed`, which refines uniqueness on `scope`. Two composed
  // statements at one scope are rivals; two anchors on one claim are ordinary — a claim routinely
  // rests on several spans, and the sweep reports each.
  const two = [bound, { ...bound, file: "packages/library/src/knowledge.ts", symbol: "Adr" }];
  assert.equal(DecisionSources.safeParse(two).success, true);
});

test("decision-sources: an unknown key inside an entry is REFUSED", () => {
  // Inherited strictness from `Anchor`. A typo'd key would otherwise persist at `ok: true` and the
  // sweep would compare against a span nobody named.
  assert.equal(DecisionSources.safeParse([{ ...bound, verified: true }]).success, false);
});

test("decision-sources: an empty boundHash is REFUSED, not read as unbound", () => {
  // `""` and absent must not be two spellings of the same state: absent is declared-but-unbound,
  // where an empty hash is a hash that compares equal to nothing and would drift forever.
  assert.equal(DecisionSource.safeParse({ ...bound, boundHash: "" }).success, false);
});

// ---------------------------------------------------------------------------
// Optional-not-defaulted — key presence is the load-bearing distinction
// ---------------------------------------------------------------------------

test("decision-sources: `sources` is OPTIONAL on a decision row, never defaulted", () => {
  // ADR-0223. Absent means nobody has ever grounded this decision; a `[]` default would erase that
  // and a reader counting its own coverage could not tell blindness from a real absence — the exact
  // fault that silently decremented a denominator in the `dependsOn` work.
  const parsed = Adr.parse(row);
  assert.equal(Object.hasOwn(parsed, "sources"), false);
  const grounded = Adr.parse({ ...row, sources: [bound] });
  assert.equal(grounded.sources?.length, 1);
});

test("decision-sources: an EMPTY list survives the round trip as an empty list", () => {
  // "Somebody looked and this decision grounds nothing" is a different fact from "nobody looked",
  // and only key presence carries it.
  const emptied = Adr.parse({ ...row, sources: [] });
  assert.equal(Object.hasOwn(emptied, "sources"), true);
  assert.deepEqual(emptied.sources, []);
});

test("decision-sources: hasSourcesKey separates absent from empty, and never tests length", () => {
  assert.equal(hasSourcesKey(row), false);
  assert.equal(hasSourcesKey({ ...row, sources: [] }), true);
  assert.equal(hasSourcesKey({ ...row, sources: [bound] }), true);
});

// ---------------------------------------------------------------------------
// The defensive read — total over a live corpus this checkout's schema may lag
// ---------------------------------------------------------------------------

test("decision-sources: readDecisionSources is TOTAL over untrusted input", () => {
  // The `readDependsOnPointers` posture: a row written by a branch whose schema this checkout does
  // not carry must project as "no anchors" rather than throw, because a read-side surprise in a
  // fail-closed sweep looks identical to a real finding.
  for (const junk of [null, undefined, 7, "sources", [], { sources: null }, { sources: "x" }]) {
    assert.deepEqual(readDecisionSources(junk), []);
  }
});

test("decision-sources: a malformed entry is DROPPED, and its valid siblings survive", () => {
  // Dropped rather than repaired — a half-read anchor would be compared against a span it may not
  // name, which is a finding invented out of a parse failure.
  const read = readDecisionSources({ sources: [bound, { file: "" }, "not an object", declared] });
  assert.deepEqual(
    read.map((s) => s.file),
    [bound.file, declared.file],
  );
});

// ---------------------------------------------------------------------------
// The authoring route the generic edit surface already gives us
// ---------------------------------------------------------------------------

test("decision-sources: `sources` is schema-visible as an ARRAY field, so `--set` can write it", () => {
  // `arrayFieldsForKind` is read straight from the schema shape, so this needs no wiring — but it is
  // the ONLY route that can author an anchor until the binding verb lands
  // (`grounded-decisions-arc-inc-03`), and a bare `--set` string can never validate against an array
  // field. Asserting it here is what makes "the field is authorable today" a fact rather than a
  // hope.
  assert.equal(arrayFieldsForKind("adr")?.has("sources"), true);
  assert.equal(knownFieldsForKind("adr")?.has("sources"), true);
});
