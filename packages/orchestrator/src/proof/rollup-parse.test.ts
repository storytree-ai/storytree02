import test from "node:test";
import assert from "node:assert/strict";

import { CriterionVerdict, SIGNING_EVENT_KIND, Verdict, WorkEventDoc } from "@storytree/proof-protocol";
import type { StoreEvent } from "@storytree/storage-protocol";

import { parseVerdictDoc } from "./rollup-parse.js";
import { resolveStoryHealth } from "./story-baseline.js";

/**
 * The map read folds ONE event stream through the roll-ups once per capability, per criterion and
 * per story. On 2026-09-24 each fold re-validated every doc with zod, so one studio `/api/tree`
 * request spent ~6 s of CPU on it; the stalled event loop made a concurrent request's 4 s verdict
 * reads time out after their rows had arrived, and the map painted every island `proposed`.
 */

function verdictDoc(unitId: string, outcome: "pass" | "fail" = "pass") {
  return {
    unitId,
    proofMode: "capability",
    outcome,
    commitSha: "cafebabe",
    signer: "owner@example.com",
    runId: `run-${unitId}`,
    outputVersion: "v1",
    evidence: [],
    at: "2026-09-24T00:00:00.000Z",
  };
}

/** A schema seen only through the one method the memo calls — so the three can share one counter. */
interface Parser {
  safeParse(doc: unknown): unknown;
}

/** Count every `safeParse` a schema answers while `run` executes. */
function countingParses<T>(run: () => T) {
  const schemas: Parser[] = [Verdict, CriterionVerdict, WorkEventDoc];
  const originals = schemas.map((schema) => schema.safeParse);
  let parses = 0;
  schemas.forEach((schema, i) => {
    const original = originals[i]!;
    schema.safeParse = (doc: unknown) => {
      parses += 1;
      return original.call(schema, doc);
    };
  });
  try {
    return { result: run(), parses };
  } finally {
    schemas.forEach((schema, i) => {
      schema.safeParse = originals[i]!;
    });
  }
}

test("a whole map's story-health fold validates each event doc at most once per schema", () => {
  const stories = Array.from({ length: 12 }, (_, s) => ({
    id: `story-${s}`,
    capabilities: Array.from({ length: 8 }, (_, c) => ({ id: `story-${s}-cap-${c}` })),
  }));
  const events: StoreEvent[] = stories
    .flatMap((story) => story.capabilities.map((cap) => verdictDoc(cap.id)))
    .map((doc, i) => ({
      seq: i + 1,
      id: `e${i + 1}`,
      kind: SIGNING_EVENT_KIND,
      type: "created",
      doc,
      actor: "t",
      at: doc.at,
    }));

  const { result, parses } = countingParses(() =>
    stories.map(
      (story) =>
        resolveStoryHealth({
          storyId: story.id,
          declaration: { capabilities: story.capabilities, obligations: [] },
          events,
        }).pendingCapabilityIds,
    ),
  );

  // The fold still answers: every capability carries a signed pass, so none is left pending.
  assert.deepEqual(result, stories.map(() => []));
  // Three schemas can each see each doc once. Re-validating per capability per story was ~100x this.
  assert.ok(
    parses <= events.length * 3,
    `the fold ran ${parses} zod parses over ${events.length} events — it is re-validating the stream`,
  );
});

test("the memo answers exactly what the schema answers", () => {
  const valid = verdictDoc("unit-a");
  const invalid = { unitId: "unit-b" };
  for (const doc of [valid, invalid, null, "not-a-doc", 7]) {
    const direct = Verdict.safeParse(doc);
    for (const memoised of [parseVerdictDoc(doc), parseVerdictDoc(doc)]) {
      assert.equal(memoised.success, direct.success);
      if (memoised.success && direct.success) assert.deepEqual(memoised.data, direct.data);
    }
  }
});
