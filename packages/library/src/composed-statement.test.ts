import assert from "node:assert/strict";
import test from "node:test";

import {
  ComposedStatements,
  decisionsBeneath,
  fingerprintDecision,
  outstandingEffects,
  readComposedStatements,
  renderComposedBanner,
  type ComposedBasisEntry,
  type ComposedStatementFields,
} from "./composed-statement.js";
import { decisionSupportResolver } from "./decision-support-seam.js";
import { Adr } from "./knowledge.js";

// ---------------------------------------------------------------------------
// fingerprintDecision
// ---------------------------------------------------------------------------

test("composed-statement: a fingerprint is deterministic and 64 bits wide", () => {
  const decision = { status: "accepted", body: "# ADR-0139: consolidate\n\n## Decision\n\nX." };
  assert.equal(fingerprintDecision(decision), fingerprintDecision(decision));
  assert.match(fingerprintDecision(decision), /^[0-9a-f]{16}$/);
});

test("composed-statement: a fingerprint moves when the BODY moves", () => {
  const before = fingerprintDecision({ status: "accepted", body: "the position is X" });
  const after = fingerprintDecision({ status: "accepted", body: "the position is Y" });
  assert.notEqual(before, after);
});

test("composed-statement: a fingerprint moves when the STATUS moves and the prose does not", () => {
  // The case a body-only fingerprint would miss: a record flipping to `superseded` changes what the
  // chain adds up to without a byte of its prose moving.
  const body = "# ADR-0086: the load-bearing tag\n\n## Decision\n\nTag the curated set.";
  assert.notEqual(
    fingerprintDecision({ status: "accepted", body }),
    fingerprintDecision({ status: "superseded", body }),
  );
});

test("composed-statement: the two FNV seeds do not produce the same half", () => {
  // A copy-paste of one seed into both would halve the width silently — the output would still look
  // like sixteen hex digits.
  const fingerprint = fingerprintDecision({ status: "accepted", body: "a body" });
  assert.notEqual(fingerprint.slice(0, 8), fingerprint.slice(8));
});

// ---------------------------------------------------------------------------
// decisionsBeneath
// ---------------------------------------------------------------------------

test("composed-statement: the closure walks the support edge and excludes the root", () => {
  const resolver = decisionSupportResolver([
    { number: 400, dependsOn: ["asset:adr-0300", "asset:adr-0200"] },
    { number: 300, dependsOn: ["asset:adr-0100"] },
    { number: 200, dependsOn: [] },
    { number: 100, dependsOn: [] },
  ]);
  assert.deepEqual(decisionsBeneath(400, resolver), [100, 200, 300]);
});

test("composed-statement: a `dependsOn` pointer naming a non-decision is skipped, not rounded", () => {
  const resolver = decisionSupportResolver([
    { number: 400, dependsOn: ["asset:merge-ceremony", "doc:README.md", "asset:adr-0100"] },
    { number: 100, dependsOn: [] },
  ]);
  assert.deepEqual(decisionsBeneath(400, resolver), [100]);
});

test("composed-statement: a target the log does not hold is not walked into", () => {
  const resolver = decisionSupportResolver([{ number: 400, dependsOn: ["asset:adr-0999"] }]);
  assert.deepEqual(decisionsBeneath(400, resolver), []);
});

test("composed-statement: the closure terminates on a cycle rather than looping", () => {
  // A cyclic support graph is a defect `probe:adr-graph` owns; this walk must not HANG on one.
  const resolver = decisionSupportResolver([
    { number: 2, dependsOn: ["asset:adr-0001"] },
    { number: 1, dependsOn: ["asset:adr-0002"] },
  ]);
  assert.deepEqual(decisionsBeneath(2, resolver), [1]);
});

// ---------------------------------------------------------------------------
// outstandingEffects — the marker
// ---------------------------------------------------------------------------

const basis: ComposedBasisEntry[] = [
  { decision: 100, fingerprint: "aaaa" },
  { decision: 200, fingerprint: "bbbb" },
];

test("composed-statement: an unmoved chain reports NO outstanding effects", () => {
  const current = new Map([
    [100, "aaaa"],
    [200, "bbbb"],
  ]);
  assert.deepEqual(outstandingEffects(basis, current), []);
});

test("composed-statement: a record whose content moved reports `changed`", () => {
  const current = new Map([
    [100, "aaaa"],
    [200, "cccc"],
  ]);
  assert.deepEqual(outstandingEffects(basis, current), [{ decision: 200, effect: "changed" }]);
});

test("composed-statement: a record that appeared beneath reports `added`", () => {
  const current = new Map([
    [100, "aaaa"],
    [200, "bbbb"],
    [300, "dddd"],
  ]);
  assert.deepEqual(outstandingEffects(basis, current), [{ decision: 300, effect: "added" }]);
});

test("composed-statement: a record no longer beneath reports `removed`", () => {
  const current = new Map([[100, "aaaa"]]);
  assert.deepEqual(outstandingEffects(basis, current), [{ decision: 200, effect: "removed" }]);
});

test("composed-statement: effects are reported in a deterministic order", () => {
  const current = new Map([
    [100, "zzzz"],
    [300, "dddd"],
  ]);
  assert.deepEqual(outstandingEffects(basis, current), [
    { decision: 100, effect: "changed" },
    { decision: 200, effect: "removed" },
    { decision: 300, effect: "added" },
  ]);
});

// ---------------------------------------------------------------------------
// readComposedStatements / renderComposedBanner
// ---------------------------------------------------------------------------

const statement: ComposedStatementFields = {
  statement: "The gate narrows to what the branch affects, and fails wide on any doubt.",
  composedAt: "2026-08-23",
  basis,
};

test("composed-statement: a reading carries the basis size as the marker's denominator", () => {
  const [reading] = readComposedStatements([statement], new Map([[100, "aaaa"], [200, "bbbb"]]));
  assert.equal(reading?.basisSize, 2);
  assert.equal(reading?.current, true);
  assert.equal(reading?.scope, undefined);
});

test("composed-statement: a whole-record statement renders WITH a stated currency, never silence", () => {
  // Silence is what a reader cannot tell apart from an instrument that is not running — the failure
  // both precedents warn about, so the current case is marked as loudly as the stale one.
  const lines = renderComposedBanner(
    readComposedStatements([statement], new Map([[100, "aaaa"], [200, "bbbb"]])),
  );
  const text = lines.join("\n");
  assert.match(text, /CURRENT POSITION AT THIS FRONTIER/);
  assert.match(text, /nothing beneath has moved since/);
  assert.doesNotMatch(text, /EFFECTS NOT YET APPLIED/);
});

test("composed-statement: a stale statement renders the banner, names each record, and points at the chain", () => {
  const lines = renderComposedBanner(
    readComposedStatements([statement], new Map([[100, "aaaa"], [200, "cccc"], [300, "dddd"]])),
  );
  const text = lines.join("\n");
  assert.match(text, /EFFECTS NOT YET APPLIED — 2 records beneath moved/);
  assert.match(text, /ADR-0200 {2}changed since this was composed/);
  assert.match(text, /ADR-0300 {2}is beneath this record now and was not composed over/);
  // ADR-0428 D4: the chain stays walkable, and the reader who distrusts the statement is told so.
  assert.match(text, /Walk the chain/);
});

test("composed-statement: a scoped statement renders its scope — the D3 hook is exercised, not merely declared", () => {
  const scoped: ComposedStatementFields = { ...statement, scope: "D4" };
  const lines = renderComposedBanner(readComposedStatements([scoped], new Map([[100, "aaaa"], [200, "bbbb"]])));
  assert.match(lines.join("\n"), /CURRENT POSITION AT D4/);
  const [reading] = readComposedStatements([scoped], new Map());
  assert.equal(reading?.scope, "D4");
});

test("composed-statement: a record carrying no statement renders nothing at all", () => {
  assert.deepEqual(renderComposedBanner([]), []);
});

// ---------------------------------------------------------------------------
// The stored shape
// ---------------------------------------------------------------------------

test("composed-statement: the array refuses two rival whole-record statements", () => {
  const two = [statement, { ...statement, statement: "a different position" }];
  assert.equal(ComposedStatements.safeParse(two).success, false);
  assert.equal(ComposedStatements.safeParse([statement]).success, true);
});

test("composed-statement: a whole-record and a clause-scoped statement coexist (ADR-0428 D3)", () => {
  const both = [statement, { ...statement, scope: "D4" }];
  assert.equal(ComposedStatements.safeParse(both).success, true);
});

test("composed-statement: the `composed` field is OPTIONAL on a decision row, never defaulted", () => {
  // Absent must stay distinguishable from an emptied list (ADR-0223): most of the log has never
  // been composed, and a `[]` default would erase that.
  const row = {
    kind: "adr",
    id: "adr-0428",
    title: "t",
    body: "# ADR-0428: t",
    status: "accepted",
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
  const parsed = Adr.parse(row);
  assert.equal(Object.hasOwn(parsed, "composed"), false);
  const withStatement = Adr.parse({ ...row, composed: [statement] });
  assert.equal(withStatement.composed?.length, 1);
});

test("composed-statement: an unknown key inside a composed entry is REFUSED", () => {
  const bad = [{ ...statement, staleness: "fine" }];
  assert.equal(ComposedStatements.safeParse(bad).success, false);
});
