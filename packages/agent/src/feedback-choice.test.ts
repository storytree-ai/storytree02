/**
 * `a-feedback-tool-takes-a-choice-from-a-spine-computed-set` (ADR-0587): the validation that makes
 * the widened seam safe, and the schema that makes it usable.
 *
 * The rule being proved is not "arguments are allowed" — it is that the leaf can only ever name
 * something the SPINE put on the list. Every refusal below is a different way of getting that wrong,
 * and each is a distinct sentence because a model has to act on it.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  feedbackChoiceJsonSchema,
  readFeedbackChoice,
  resolveFeedbackChoice,
} from "./feedback-choice.js";
import type { FeedbackChoiceParameter } from "./feedback-choice.js";

const FILES: FeedbackChoiceParameter = {
  name: "files",
  description: "existing test files to run",
  choices: ["packages/drive/src/a.test.ts", "packages/drive/src/b.test.ts"],
};

const NOTHING: FeedbackChoiceParameter = { name: "files", description: "none", choices: [] };

function reasonOf(result: ReturnType<typeof readFeedbackChoice>): string {
  return result.ok ? "" : result.reason;
}

test("feedback-choice-omitted-is-the-whole-set: an absent argument selects everything, and is never a refusal", () => {
  for (const raw of [undefined, null]) {
    const result = readFeedbackChoice(raw, FILES);
    assert.equal(result.ok, true, String(raw));
    // `chosen` stays undefined rather than being filled in here: "named nothing" and "named all of
    // them" are different calls, and only `resolveFeedbackChoice` collapses them.
    assert.equal(result.ok === true ? result.choice.chosen : "refused", undefined, String(raw));
  }
  assert.deepEqual(resolveFeedbackChoice({ chosen: undefined }, FILES), FILES.choices);
});

test("feedback-choice-admits-a-declared-name, and only in the order it was named", () => {
  const result = readFeedbackChoice(["packages/drive/src/b.test.ts"], FILES);
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok === true ? result.choice.chosen : null, ["packages/drive/src/b.test.ts"]);
  assert.deepEqual(
    resolveFeedbackChoice({ chosen: ["packages/drive/src/b.test.ts"] }, FILES),
    ["packages/drive/src/b.test.ts"],
    "resolving a named choice returns it, never the whole set",
  );
});

test("feedback-choice-collapses-duplicates rather than refusing or running twice", () => {
  const result = readFeedbackChoice(
    ["packages/drive/src/a.test.ts", "packages/drive/src/a.test.ts"],
    FILES,
  );
  assert.equal(result.ok, true);
  assert.deepEqual(result.ok === true ? result.choice.chosen : null, ["packages/drive/src/a.test.ts"]);
});

test("feedback-choice-refuses-an-undeclared-name — the whole point of the fence", () => {
  // The case ADR-0570's rationale exists for: a path the spine never offered must not run, however
  // plausible it looks. `../` and an absolute path are the same refusal for the same reason.
  for (const bad of [
    "packages/drive/src/secret.test.ts",
    "../../etc/passwd",
    "C:/Windows/System32/x.test.ts",
    "packages/drive/src/a.test.ts ",
    "PACKAGES/drive/src/a.test.ts",
  ]) {
    const result = readFeedbackChoice([bad], FILES);
    assert.equal(result.ok, false, bad);
    assert.match(reasonOf(result), /is not one of the available files/, bad);
  }
});

test("feedback-choice-refusal-lists-what-IS-available, bounded, and says how many it did not print", () => {
  const many: FeedbackChoiceParameter = {
    name: "files",
    description: "lots",
    choices: Array.from({ length: 23 }, (_, i) => `t${i}.test.ts`),
  };
  const reason = reasonOf(readFeedbackChoice(["nope.test.ts"], many));
  // The whole rendered list, exactly: a pair of substring probes would pass with the separator
  // gone, and `t0.test.tst1.test.ts...` is unreadable in the one place a model has to read it.
  const expected = Array.from({ length: 20 }, (_, i) => `\`t${i}.test.ts\``).join(", ");
  assert.ok(reason.includes(`${expected} and 3 more.`), reason);
  assert.doesNotMatch(reason, /`t20\.test\.ts`/, "the sample stops at the cap");
  // A short list is printed whole, with no misleading tail.
  assert.doesNotMatch(reasonOf(readFeedbackChoice(["nope"], FILES)), /more/);
});

test("feedback-choice-refuses-a-non-list and a non-string member, in different words", () => {
  assert.match(reasonOf(readFeedbackChoice("a.test.ts", FILES)), /must be a list of names/);
  assert.match(reasonOf(readFeedbackChoice({ files: [] }, FILES)), /must be a list of names/);
  assert.match(reasonOf(readFeedbackChoice([7], FILES)), /must contain only names; got a number/);
  assert.match(reasonOf(readFeedbackChoice([null], FILES)), /got a object/);
  // The two failures must not share a sentence: "you sent the wrong shape" and "one item is wrong"
  // send a model to different fixes.
  assert.notEqual(
    reasonOf(readFeedbackChoice("a.test.ts", FILES)),
    reasonOf(readFeedbackChoice([7], FILES)),
  );
});

test("feedback-choice-refuses-an-empty-list, which would otherwise report success having run nothing", () => {
  const reason = reasonOf(readFeedbackChoice([], FILES));
  assert.match(reason, /empty list, which selects nothing/);
  assert.match(reason, /Omit it to take all of them/, "and says what to do instead");
});

test("feedback-choice-with-nothing-on-offer: the whole-set form still works, any name is refused", () => {
  assert.equal(readFeedbackChoice(undefined, NOTHING).ok, true);
  assert.deepEqual(resolveFeedbackChoice({ chosen: undefined }, NOTHING), []);
  const refused = readFeedbackChoice(["anything.test.ts"], NOTHING);
  assert.equal(refused.ok, false);
  // A different sentence from the ordinary refusal: listing "available: " and then nothing would
  // read as a formatting bug rather than as "this build has none".
  assert.match(reasonOf(refused), /this build offers nothing for `files`/);
  assert.doesNotMatch(reasonOf(refused), /Available: \./);
});

test("feedback-choice-json-schema publishes the choices as an enum the model can read", () => {
  const schema = feedbackChoiceJsonSchema(FILES);
  assert.deepEqual(schema, {
    type: "object",
    properties: {
      files: {
        type: "array",
        description: "existing test files to run",
        items: { type: "string", enum: [...FILES.choices] },
      },
    },
    additionalProperties: false,
  });
  // `additionalProperties: false` is what keeps a widened tool from quietly accepting a SECOND
  // argument nobody declared — the fence is per-tool, not per-call.
  assert.equal(schema.additionalProperties, false);
});

test("feedback-choice-json-schema copies the choices rather than aliasing the parameter's own array", () => {
  // A published schema is handed to another process and may outlive the call that built it; sharing
  // the array would let a later mutation of the parameter rewrite what a served schema said.
  const choices = ["a.test.ts"];
  const schema = feedbackChoiceJsonSchema({ name: "files", description: "d", choices });
  choices.push("b.test.ts");
  const items = (schema.properties["files"] as { items: { enum: string[] } }).items;
  assert.deepEqual(items.enum, ["a.test.ts"]);
});
