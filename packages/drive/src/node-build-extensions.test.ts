/**
 * THE ENVELOPE LISTS EVERY EXTENSION THE ORCHESTRATOR BOUGHT (ADR-0592 D5).
 *
 * `renderExtensions` is a pure reader of `ProveResult.extensions`, exactly as `renderRepairs` is of
 * `.repairs`, and the header is the load-bearing part: an extension is NOT an attempt. Without it, a
 * build that ran four hours on a two-hour budget and then failed reads like an accounting error rather
 * than one honest failed attempt.
 */

import assert from "node:assert/strict";
import test from "node:test";

import type { ExtensionRecord } from "@storytree/orchestrator";

import { renderExtensions } from "./node-build.js";

const MIN = 60_000;

function extension(over: Partial<ExtensionRecord> = {}): ExtensionRecord {
  return {
    heldAfterMs: 120 * MIN,
    fromBudgetMs: 120 * MIN,
    toBudgetMs: 150 * MIN,
    reason: "the diff shows real progress",
    ...over,
  };
}

test("a walk that was never held renders nothing, so every existing envelope is unchanged", () => {
  // The same contract `renderRepairs` keeps. A build nobody extended must read exactly as it did
  // before this decision landed — an empty section is worse than no section.
  assert.deepEqual(renderExtensions({}), []);
  assert.deepEqual(renderExtensions({ extensions: [] }), []);
});

test("one extension renders the header, the clock it moved, and the orchestrator's own reason", () => {
  assert.deepEqual(renderExtensions({ extensions: [extension()] }), [
    "extensions:  1 granted by the orchestrator at a hold — the clock now 150 min; an extension is NOT an attempt (ADR-0592 D5)",
    "  1. held at 120 min, 120 min -> 150 min: the diff shows real progress",
  ]);
});

test("the header's total is the LATEST grant's, never a sum of the grants", () => {
  // Each record carries the absolute budget after it, so the total is a read rather than arithmetic.
  // Summing `toBudgetMs` would report 480 min here, which is not a figure any clock ever held.
  const lines = renderExtensions({
    extensions: [
      extension({ heldAfterMs: 120 * MIN, fromBudgetMs: 120 * MIN, toBudgetMs: 150 * MIN, reason: "first" }),
      extension({ heldAfterMs: 150 * MIN, fromBudgetMs: 150 * MIN, toBudgetMs: 180 * MIN, reason: "second" }),
    ],
  });
  assert.match(lines[0] ?? "", /the clock now 180 min/);
  assert.equal(lines.length, 3);
  assert.equal(lines[1], "  1. held at 120 min, 120 min -> 150 min: first");
  assert.equal(lines[2], "  2. held at 150 min, 150 min -> 180 min: second");
});

test("the header says an extension is NOT an attempt, which is the whole reason the section exists", () => {
  const lines = renderExtensions({ extensions: [extension()] });
  assert.match(lines[0] ?? "", /an extension is NOT an attempt \(ADR-0592 D5\)/);
});

test("minutes are floored, so an unspent minute never reads as spent", () => {
  // The unit every budget reason in the system reports in. A build held at 119 min 59 s of a 120 min
  // budget is at 119, not 120 — rounding up would show a clock that had not yet run out as spent.
  const lines = renderExtensions({
    extensions: [extension({ heldAfterMs: 120 * MIN - 1_000, fromBudgetMs: 120 * MIN, toBudgetMs: 150 * MIN })],
  });
  assert.match(lines[1] ?? "", /held at 119 min/);
});
