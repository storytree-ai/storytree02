import { test } from "node:test";
import assert from "node:assert/strict";

import {
  DAG_EXCLUDED_KINDS,
  EDGE_FREE_KINDS,
  KIND_SPECS,
  Knowledge,
  DependsOnRef,
  arrayFieldsForKind,
  knownFieldsForKind,
  type KnowledgeKind,
} from "./knowledge.js";
import { validateLibraryDoc } from "./library-doc.js";
import { KNOWLEDGE_TIERS, TIER_ZERO_KINDS } from "./standson-bootstrap.js";

/**
 * ADR-0223 D1's `dependsOn` admission — the authored dependency edge, distinct from and additive to
 * the `references` citation web.
 *
 * These are SCHEMA assertions only. Whether a given corpus of authored edges is acyclic is
 * `knowledge-dag.ts`'s question and is proven in `knowledge-dag.test.ts`; the two are deliberately
 * separate, because admission must not depend on the corpus and enforcement must not depend on zod.
 */

const KINDS = Object.keys(KIND_SPECS) as KnowledgeKind[];

/** A minimal valid doc for a kind: common fields + every REQUIRED spec field. */
function minimalDoc(kind: KnowledgeKind) {
  // Declared as the accumulator it is — the per-kind key set below comes from `KIND_SPECS`,
  // so there is no statically known shape for the annotation to be discarding.
  const doc: Record<string, unknown> = {};
  doc["kind"] = kind;
  doc["id"] = `standson-${kind}`;
  doc["title"] = `dependsOn ${kind}`;
  doc["description"] = "dependsOn admission fixture";
  doc["createdAt"] = "2026-08-14T00:00:00.000Z";
  doc["updatedAt"] = "2026-08-14T00:00:00.000Z";
  for (const spec of KIND_SPECS[kind]) {
    if (spec.required) {
      doc[spec.field] =
        spec.refList === true ? [`asset:standson-${spec.field}`] : `content for ${spec.field}`;
    }
  }
  if (kind === "increment") {
    doc["arcRef"] = "asset:standson-arc";
    doc["parked"] = "2026-08-14T00:00:00.000Z";
  }
  // ADR-0515: a `resteer` requires its defect/taste `disposition` and whose judgement it was. This
  // fixture is `taste`, so it correctly carries no `mode`.
  if (kind === "resteer") {
    doc["disposition"] = "taste";
    doc["dispositionBy"] = "owner";
  }
  if (kind === "adr") {
    // `status` is the one REQUIRED field outside the adr KIND_SPECS table; `number` and
    // `description` are computed on read and never stored (ADR-0609 D1 / D2).
    delete doc["description"];
    doc["status"] = "accepted";
  }
  return doc satisfies Record<string, unknown>;
}

test("library-standson-admitted-on-dag-kinds: every kind outside the transient signal tier carries the edge", () => {
  const dagKinds = KINDS.filter((kind) => !EDGE_FREE_KINDS.has(kind));
  assert.ok(dagKinds.length > 0, "the fixture would prove nothing if every kind were edge-free");

  for (const kind of dagKinds) {
    const fields = knownFieldsForKind(kind);
    assert.ok(fields?.has("dependsOn"), `${kind} must carry dependsOn`);

    const parsed = Knowledge.parse({
      ...minimalDoc(kind),
      dependsOn: ["asset:red-green", "doc:decisions/0223-the-knowledge-dag.md"],
    });
    assert.deepEqual(
      (parsed as { dependsOn?: readonly string[] }).dependsOn,
      ["asset:red-green", "doc:decisions/0223-the-knowledge-dag.md"],
      `${kind} must round-trip the authored edge`,
    );
  }

  // ADR-0223 D2's coexistence clause is MOOT since ADR-0477 D1: the `references` web it promised not
  // to disturb is retired, and `dependsOn` is the corpus's only edge. What survives to assert is that
  // the authored edge round-trips as authored.
  const both = Knowledge.parse({
    ...minimalDoc("principle"),
    dependsOn: ["asset:red-green"],
  }) as { dependsOn?: readonly string[] };
  assert.deepEqual(both.dependsOn, ["asset:red-green"]);
});

test("library-standson-admitted-on-dag-kinds: the kinds outside the DAG stay edge-free, fail-closed", () => {
  // THE TRANSIENT SIGNAL TIER, AND NOTHING ELSE (ADR-0223 D1, narrowed by ADR-0468 D1). `definition`
  // sat here until ADR-0468: ADR-0363 D1 had excluded it from the DAG for a reason entirely about
  // DEPTH and enforced that at the schema, which made ADR-0464 D4's backfill of the tier impossible.
  // The depth exclusion survives, one assertion down, in `DAG_EXCLUDED_KINDS`.
  // `resteer` joined the tier with ADR-0515: one observed owner intervention is a LOG ROW, the same
  // transient-signal shape as its `friction` sibling, and it authors no `dependsOn`.
  assert.deepEqual([...EDGE_FREE_KINDS].sort(), ["friction", "open-question", "resteer"]);

  for (const kind of KINDS.filter((k) => EDGE_FREE_KINDS.has(k))) {
    assert.equal(
      knownFieldsForKind(kind)?.has("dependsOn"),
      false,
      `${kind} must not carry dependsOn (ADR-0223 D1)`,
    );
    // `.strict()` is what makes the exclusion real rather than advisory: authoring the edge on a
    // signal kind is REFUSED, not silently dropped.
    const result = Knowledge.safeParse({ ...minimalDoc(kind), dependsOn: ["asset:red-green"] });
    assert.equal(result.success, false, `${kind} must refuse an authored dependsOn`);
  }
});

test("library-standson-every-kind-is-placed: the tier order and the two exclusion sets partition the kinds", () => {
  // WHAT THIS REPLACES, AND WHY IT IS STRONGER. ADR-0365 D1 repaired `uat-criterion` — a kind that
  // arrived and was placed NOWHERE, so it was outside the graph for the seed and inside it for the
  // schema, with nothing on record saying which was meant — by making tier-map absence and
  // `EDGE_FREE_KINDS` membership AGREE. That invariant could only be stated while every out-of-DAG
  // kind happened to be edge-free, and it said nothing at all about a kind left out of BOTH, which
  // is the shape that actually bit. ADR-0468 D2 separates the two questions (does the schema admit
  // the field / does the kind rank in the DAG), so the agreement is gone and this partition stands
  // in its place: every kind is accounted for EXACTLY ONCE, and a new kind nobody places reds here.
  const unplaced: string[] = [];
  const doubled: string[] = [];
  for (const kind of KINDS) {
    const homes = [
      KNOWLEDGE_TIERS.has(kind) ? "tier" : null,
      TIER_ZERO_KINDS.has(kind) ? "tier-0" : null,
      EDGE_FREE_KINDS.has(kind) ? "edge-free" : null,
      DAG_EXCLUDED_KINDS.has(kind) ? "dag-excluded" : null,
    ].filter((h): h is string => h !== null);
    if (homes.length === 0) unplaced.push(kind);
    if (homes.length > 1) doubled.push(`${kind} (${homes.join(" + ")})`);
  }
  assert.deepEqual(
    unplaced,
    [],
    "every kind must be placed: give it a KNOWLEDGE_TIERS tier, or name it in TIER_ZERO_KINDS (the " +
      "bedrock nothing sits beneath), EDGE_FREE_KINDS (the schema refuses the field) or " +
      "DAG_EXCLUDED_KINDS (it carries the field but does not rank)",
  );
  assert.deepEqual(doubled, [], "a kind must sit in exactly one of the four, never two");

  // The two single-member sets, spelled out — so removing either member is a visible edit rather
  // than something a refactor does by accident. `adr` earned its entry by failing this very test:
  // ADR-0403 dec 1 made the decision log a kind and placed it nowhere, and nothing said so until the
  // partition was asserted.
  assert.deepEqual([...TIER_ZERO_KINDS].sort(), ["adr"]);

  // The one member, spelled out — so removing `definition` from the DAG exclusion is a visible edit
  // and not something a refactor can do by accident.
  assert.deepEqual([...DAG_EXCLUDED_KINDS].sort(), ["definition"]);

  // And the half ADR-0468 D1 actually changed: a definition now takes the edge the schema used to
  // refuse it, which is what makes ADR-0464 D4's backfill possible at all.
  assert.equal(knownFieldsForKind("definition")?.has("dependsOn"), true);
  assert.equal(arrayFieldsForKind("definition")?.has("dependsOn"), true);
  const parsed = Knowledge.parse({
    ...minimalDoc("definition"),
    dependsOn: ["asset:adr-0010"],
  }) as { dependsOn?: readonly string[] };
  assert.deepEqual(parsed.dependsOn, ["asset:adr-0010"]);
});

test("library-standson-refs-are-asset-or-adr: the edge admits Library and ADR targets and refuses the rest", () => {
  for (const ok of [
    "asset:red-green",
    "asset:merge-ceremony",
    "asset:ADR_0223-x",
    "doc:decisions/0223-the-knowledge-dag-is-an-authored-standson-edge.md",
    "doc:research/agentic-foundation-survey.md",
  ]) {
    assert.equal(DependsOnRef.safeParse(ok).success, true, `${ok} must be admitted`);
  }

  // `node:` / `story:` / `capability:` name the WORK tree, not knowledge; a bare id names nothing
  // resolvable; an empty target is not a pointer at all.
  for (const bad of [
    "red-green",
    "node:library",
    "story:library",
    "capability:library-cli",
    "asset:",
    "doc:",
    "asset:has spaces",
    "",
  ]) {
    assert.equal(DependsOnRef.safeParse(bad).success, false, `${bad} must be refused`);
  }

  // A malformed entry inside the array reaches the write boundary as a REFUSAL, so a typo cannot
  // persist as a dangling edge the DAG would then walk past in silence.
  assert.throws(() =>
    validateLibraryDoc({ ...minimalDoc("principle"), dependsOn: ["not-a-pointer"] }),
  );
});

test("library-standson-absence-is-preserved: an existing doc without the edge needs no migration", () => {
  for (const kind of KINDS) {
    const before = minimalDoc(kind);
    const parsed = Knowledge.parse(before) as Record<string, unknown>;
    // OPTIONAL, not `.default([])`: absent stays absent, so a doc authored before ADR-0223 both
    // validates and re-serialises byte-identically. A default would stamp `dependsOn: []` across the
    // whole corpus on next write.
    assert.equal(
      "dependsOn" in parsed,
      false,
      `${kind}: an absent dependsOn must not be defaulted into the doc`,
    );
  }
});

test("library-standson-absence-is-preserved: the edit surface can write the edge as an array field", () => {
  // `artifact edit --set` refuses an array field it cannot see as one (it would persist the literal
  // JSON string). The set is derived from the live schema, so this is the assertion that the new
  // field is writable at all through the CLI.
  for (const kind of KINDS.filter((k) => !EDGE_FREE_KINDS.has(k))) {
    assert.ok(
      arrayFieldsForKind(kind)?.has("dependsOn"),
      `${kind}: dependsOn must be visible to the edit surface as an array field`,
    );
  }
});
