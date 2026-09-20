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

describe("node-build-envelope-lists-every-existing-test-change: the envelope prints the record and its reasons", () => {
  test("a build that changed no existing test prints nothing", () => {
    assert.deepEqual(renderTestChanges({}), []);
    assert.deepEqual(renderTestChanges({ testChanges: [] }), []);
  });

  test("every change is listed under a header naming whose call it was", () => {
    const result: Pick<ProveResult, "testChanges"> = {
      testChanges: [
        {
          test: ["parses a port", "rejects a negative"],
          kind: "updated",
          asserts: "new-behaviour",
          reason: "rejects a negative — the port now clamps instead of throwing",
        },
        { test: ["parses a port", "tolerates whitespace"], kind: "removed", reason: "tolerates whitespace — folded into the table" },
        { test: ["parses a port", "reads a string"], kind: "updated" },
      ],
    };

    assert.deepEqual(renderTestChanges(result), [
      "tests changed: 3 test(s) that existed before this build — the test-writer's call to make (ADR-0581 D1), recorded here",
      "  - updated (new behaviour) — `parses a port > rejects a negative`: rejects a negative — the port now clamps instead of throwing",
      "  - removed — `parses a port > tolerates whitespace`: tolerates whitespace — folded into the table",
      "  - updated — `parses a port > reads a string`: NO REASON STATED",
    ]);
  });
});
