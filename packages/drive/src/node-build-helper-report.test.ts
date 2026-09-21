/**
 * ADR-0589 D3/D4: what the build envelope says about a worker's READ-ONLY HELPERS.
 *
 * Three properties, each one this could quietly lose: a helper's DURATION is reported and not just
 * a count (only the duration explains where a budget went); a helper WRITE REFUSAL never inflates
 * the write-fence line (it carries no path and is not a write-fence firing); and a Codex build says
 * it HAS no helpers rather than rendering the same silence a Claude build with unused helpers would.
 *
 * Every expected line is written as a LITERAL string — this package sits inside the mutation rung.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { liveLeafLines } from "./node-build.js";
import { cannedLiveAuthor } from "./real-chain-fixture.js";

test("helper-report: a Claude leaf that used no helpers renders NO helper line", () => {
  const claude = cannedLiveAuthor([]);

  assert.deepEqual(
    liveLeafLines(claude).filter((line) => line.startsWith("helpers:")),
    [],
  );
});

test("helper-report: one helper renders its phase, type and duration in seconds", () => {
  const claude = cannedLiveAuthor([]);
  claude.helperRuns.push({ phase: "IMPLEMENT", agentType: "explorer", ms: 42_000 });

  assert.deepEqual(liveLeafLines(claude), [
    "leaf:        Claude Agent SDK (no slices ran)",
    "cost:        $0.0000 SDK-reported (subscription-billed)",
    "scope walls: no write refusals",
    "helpers:     1 read-only helper(s), 42s total — IMPLEMENT:explorer=42s " +
      "(exploration only; helpers never write, and the build's own clock bounds them)",
  ]);
});

test("helper-report: several helpers are TOTALLED as well as listed", () => {
  // The count alone is not the fact worth reporting: "three helpers" and "three helpers that took
  // eleven minutes between them" are different facts about the same build, and only the second
  // explains where a budget went (ADR-0589 D3).
  const claude = cannedLiveAuthor([]);
  claude.helperRuns.push(
    { phase: "AUTHOR_TEST", agentType: "explorer", ms: 120_000 },
    { phase: "IMPLEMENT", agentType: "explorer", ms: 300_000 },
    { phase: "IMPLEMENT", agentType: "explorer", ms: 240_000 },
  );

  assert.deepEqual(
    liveLeafLines(claude).filter((line) => line.startsWith("helpers:")),
    [
      "helpers:     3 read-only helper(s), 660s total — AUTHOR_TEST:explorer=120s, " +
        "IMPLEMENT:explorer=300s, IMPLEMENT:explorer=240s " +
        "(exploration only; helpers never write, and the build's own clock bounds them)",
    ],
  );
});

test("helper-report: a sub-second helper is reported as having run, at 0s", () => {
  // Flooring is deliberate, and this is the case it has to get right: the helper RAN, so the line
  // must exist. A reader seeing `0s` learns it cost nothing worth counting; a reader seeing no
  // line at all would conclude no helper was started.
  const claude = cannedLiveAuthor([]);
  claude.helperRuns.push({ phase: "AUTHOR_TEST", agentType: "explorer", ms: 400 });

  assert.deepEqual(
    liveLeafLines(claude).filter((line) => line.startsWith("helpers:")),
    [
      "helpers:     1 read-only helper(s), 0s total — AUTHOR_TEST:explorer=0s " +
        "(exploration only; helpers never write, and the build's own clock bounds them)",
    ],
  );
});

test("helper-report: a helper WRITE refusal does not inflate the write-fence line", () => {
  const claude = cannedLiveAuthor([]);
  claude.violations.push({
    phase: "AUTHOR_TEST",
    tool: "Write",
    path: "(helper)",
    reason: "write refused: 'Write' came from helper agent 'agent-7'",
    kind: "helper",
  });

  const lines = liveLeafLines(claude);
  // The line that reports write-fence firings must still say there were none — a helper refusal
  // resolved no path, so counting it there would report a wall that never fired, and would render
  // the path-shaped entry `AUTHOR_TEST:(helper)` naming no path at all.
  assert.ok(lines.includes("scope walls: no write refusals"));
  assert.deepEqual(
    lines.filter((line) => line.startsWith("helper wall:")),
    [
      "helper wall: 1 write(s) refused from inside a helper — AUTHOR_TEST:Write " +
        "(helpers are declared read-only; the SDK admitted a write tool it was not given)",
    ],
  );
});

test("helper-report: a REAL scope refusal still reaches the write-fence line beside a helper one", () => {
  // The control arm for the test above: a split that dropped every violation from the write line
  // would pass it. This pins that the split is by KIND and not a blanket suppression.
  const claude = cannedLiveAuthor([]);
  claude.violations.push(
    { phase: "AUTHOR_TEST", tool: "Write", path: "(helper)", reason: "helper", kind: "helper" },
    { phase: "AUTHOR_TEST", tool: "Write", path: "impl.cjs", reason: "out of scope", kind: "scope" },
  );

  const lines = liveLeafLines(claude);
  assert.ok(lines.includes("scope walls: AUTHOR_TEST:impl.cjs"));
  assert.equal(lines.filter((line) => line.startsWith("helper wall:")).length, 1);
});

test("helper-report: with no helper refusal there is NO reassuring `helper wall: none` line", () => {
  // Deliberately absent rather than rendered as a zero. This wall firing means the SDK did not
  // honour a declared tool list — a finding about the runtime, not routine accounting — and a
  // "none" line on every build is how a reader learns to stop reading it.
  const claude = cannedLiveAuthor([]);
  claude.violations.push({
    phase: "AUTHOR_TEST",
    tool: "Write",
    path: "impl.cjs",
    reason: "out of scope",
    kind: "scope",
  });

  assert.deepEqual(
    liveLeafLines(claude).filter((line) => line.startsWith("helper wall:")),
    [],
  );
});

test("helper-report: TWO write refusals are listed separately, not run together", () => {
  // The separator is what makes a list readable as a list. With one entry a join is invisible, so
  // this is the only shape that holds it — `check:mutation-diff` emptied it and no test noticed.
  const claude = cannedLiveAuthor([]);
  claude.violations.push(
    { phase: "AUTHOR_TEST", tool: "Write", path: "impl.cjs", reason: "out of scope", kind: "scope" },
    { phase: "IMPLEMENT", tool: "Edit", path: "unit.test.cjs", reason: "out of scope", kind: "scope" },
  );

  assert.ok(
    liveLeafLines(claude).includes("scope walls: AUTHOR_TEST:impl.cjs, IMPLEMENT:unit.test.cjs"),
  );
});

test("helper-report: TWO helper refusals are listed separately too", () => {
  const claude = cannedLiveAuthor([]);
  claude.violations.push(
    { phase: "AUTHOR_TEST", tool: "Write", path: "(helper)", reason: "helper", kind: "helper" },
    { phase: "IMPLEMENT", tool: "Edit", path: "(helper)", reason: "helper", kind: "helper" },
  );

  assert.deepEqual(
    liveLeafLines(claude).filter((line) => line.startsWith("helper wall:")),
    [
      "helper wall: 2 write(s) refused from inside a helper — AUTHOR_TEST:Write, IMPLEMENT:Edit " +
        "(helpers are declared read-only; the SDK admitted a write tool it was not given)",
    ],
  );
});
