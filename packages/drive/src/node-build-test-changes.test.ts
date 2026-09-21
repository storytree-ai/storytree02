import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { ProveResult } from "@storytree/orchestrator";

import { renderTestChanges } from "./node-build.js";

/**
 * `node-build-envelope-lists-every-existing-test-change` (ADR-0581 D1 / ADR-0585): the build envelope
 * lists every change the test-writer made to a test that was already here, with the reason it stated —
 * so the landing session and the owner read the change and its justification in the same place, and a
 * change that stated none is visible as exactly that.
 */

/** The unit's own proof file — the one file the proof command runs, so the one this build observes. */
const PROOF = "packages/net/src/port.test.ts";
/** A sibling existing test file the write wall admits and the proof command never runs (ADR-0590). */
const SIBLING = "packages/net/src/format.test.ts";

describe("node-build-envelope-lists-every-existing-test-change: the envelope prints the record and its reasons", () => {
  test("a build that changed no existing test prints nothing", () => {
    assert.deepEqual(renderTestChanges({}), []);
    assert.deepEqual(renderTestChanges({ testChanges: [] }), []);
  });

  test("every change is listed under a header naming whose call it was", () => {
    const result: Pick<ProveResult, "testChanges"> = {
      testChanges: [
        {
          file: PROOF,
          observed: true,
          test: ["parses a port", "rejects a negative"],
          kind: "updated",
          asserts: "new-behaviour",
          reason: "rejects a negative — the port now clamps instead of throwing",
        },
        {
          file: PROOF,
          observed: true,
          test: ["parses a port", "tolerates whitespace"],
          kind: "removed",
          reason: "tolerates whitespace — folded into the table",
        },
        { file: PROOF, observed: true, test: ["parses a port", "reads a string"], kind: "updated" },
        // ADR-0590: a change in a test file the wall admits but the proof command never runs. The
        // envelope names the file and says the obligation was recorded rather than held.
        {
          file: SIBLING,
          observed: false,
          test: ["formats a port", "pads to four digits"],
          kind: "updated",
          asserts: "new-behaviour",
          reason: "pads to four digits — the formatter now zero-pads",
        },
      ],
    };

    assert.deepEqual(renderTestChanges(result), [
      "tests changed: 4 test(s) that existed before this build — the test-writer's call to make (ADR-0581 D1), recorded here",
      "  - updated (new behaviour) — `packages/net/src/port.test.ts` `parses a port > rejects a negative`: rejects a negative — the port now clamps instead of throwing",
      "  - removed — `packages/net/src/port.test.ts` `parses a port > tolerates whitespace`: tolerates whitespace — folded into the table",
      "  - updated — `packages/net/src/port.test.ts` `parses a port > reads a string`: NO REASON STATED",
      "  - updated (new behaviour) — `packages/net/src/format.test.ts` `formats a port > pads to four digits`: " +
        "pads to four digits — the formatter now zero-pads" +
        " [recorded only — this build did not re-observe this file]",
    ]);
  });
});
