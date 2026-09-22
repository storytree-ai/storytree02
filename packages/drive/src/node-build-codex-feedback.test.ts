/**
 * `codex-envelope-reports-feedback-runs` (ADR-0570 D5/D6): the Codex leaf's build envelope must
 * report the feedback runs the spine's own record holds for it — or say plainly that it was armed
 * and called none — instead of always printing today's `none` line regardless of what the leaf
 * actually did.
 *
 * This pins `liveLeafLines`'s Codex branch in `node-build.ts`. Today that branch is unconditional:
 *
 *   "feedback:    none — the spine reruns every registered proof command out of band"
 *
 * That is only true for a Codex leaf given NO feedback tools. This file authors the cases the node
 * spec names, each its own test, with every expected line written as a LITERAL string (this package
 * sits inside the mutation rung).
 */
import test from "node:test";
import assert from "node:assert/strict";

import { CodexPhaseAuthor } from "@storytree/agent";

import { liveLeafLines } from "./node-build.js";
import { cannedLiveAuthor } from "./real-chain-fixture.js";

/**
 * The Codex branch's UNCONDITIONAL helper line (ADR-0589 D4), which every array below now ends
 * with. It is unconditional for the same reason `codexFeedbackLine` always emits something: a
 * reader comparing two runtimes' envelopes must not have to infer whether a missing line meant
 * "the worker used none" or "this runtime has none". The Claude branch stays CONDITIONAL, and the
 * last test in this file is what holds that difference.
 */
const CODEX_HELPERS_LINE =
  "helpers:     none — the Codex runtime supplies no read-only helpers (its sandbox is per-process, not per-agent)";

/**
 * A bare Codex leaf instance for the reporting fold — nothing is driven, no endpoint is opened.
 * `feedbackNames` seeds `feedbackToolNames` the same way real feedback commands would (via the
 * constructor's own `feedbackCommands` mapping), so "armed" is read from the leaf's own record
 * exactly as production does, never inferred from anything else about the fixture.
 */
function codexAuthor(feedbackNames: string[] = []): CodexPhaseAuthor {
  return new CodexPhaseAuthor({
    cwd: process.cwd(),
    writeGlobs: { AUTHOR_TEST: [], IMPLEMENT: [] },
    isWriteAllowed: () => false,
    feedbackCommands: feedbackNames.map((name) => ({
      name,
      description: `${name} description`,
      run: async () => {
        throw new Error(`codexAuthor fixture: ${name} must never actually run in this test`);
      },
    })),
  });
}

test("codex-envelope-reports-feedback-runs: non-empty feedbackRuns render exactly like the Claude branch's feedback line", () => {
  const codex = codexAuthor(["run_proof"]);
  codex.feedbackRuns.push(
    { phase: "AUTHOR_TEST", tool: "run_proof", code: 0 },
    { phase: "IMPLEMENT", tool: "run_proof", code: 1 },
  );

  // A genuine ClaudeAgentAuthor given the SAME feedbackRuns, so this test can assert the two
  // branches render BYTE-IDENTICAL text rather than merely each matching the same shape.
  const claude = cannedLiveAuthor([]);
  claude.feedbackRuns.push(
    { phase: "AUTHOR_TEST", tool: "run_proof", code: 0 },
    { phase: "IMPLEMENT", tool: "run_proof", code: 1 },
  );

  const EXPECTED_FEEDBACK_LINE =
    "feedback:    2 bounded run(s) — AUTHOR_TEST:run_proof=green, IMPLEMENT:run_proof=exit 1 " +
    "(feedback only; the spine's own observations decided)";

  const codexLines = liveLeafLines(codex);
  const claudeLines = liveLeafLines(claude);

  // Selected by PREFIX rather than by position: the Codex branch now ends with its helper line
  // (ADR-0589 D4), so `length - 1` would compare the two branches' last lines and find them
  // legitimately different — passing or failing for a reason that has nothing to do with the
  // byte-identical FEEDBACK rendering this test exists to pin.
  const codexFeedback = codexLines.filter((line) => line.startsWith("feedback:"));
  const claudeFeedback = claudeLines.filter((line) => line.startsWith("feedback:"));

  assert.deepEqual(codexFeedback, [EXPECTED_FEEDBACK_LINE]);
  assert.deepEqual(claudeFeedback, [EXPECTED_FEEDBACK_LINE]);
  assert.deepEqual(codexFeedback, claudeFeedback);
});

test("codex-envelope-reports-feedback-runs: armed with feedback tools but no calls names the armed tools instead of the none line", () => {
  const codex = codexAuthor(["run_proof", "run_typecheck"]);
  // feedbackRuns stays empty: the leaf was armed and called none.

  assert.deepEqual(liveLeafLines(codex), [
    "leaf:        Codex CLI / ChatGPT subscription (no slices ran)",
    "cost:        not metered — ChatGPT subscription quota (no API/list-price USD asserted)",
    "scope walls: no write refusals",
    "feedback:    0 bounded runs — armed with run_proof, run_typecheck; the leaf called none " +
      "(the spine's own observations decided)",
    CODEX_HELPERS_LINE,
  ]);
});

test("codex-envelope-reports-feedback-runs: a Codex leaf given no feedback tools keeps today's none line", () => {
  const codex = codexAuthor();

  assert.deepEqual(liveLeafLines(codex), [
    "leaf:        Codex CLI / ChatGPT subscription (no slices ran)",
    "cost:        not metered — ChatGPT subscription quota (no API/list-price USD asserted)",
    "scope walls: no write refusals",
    "feedback:    none — the spine reruns every registered proof command out of band",
    CODEX_HELPERS_LINE,
  ]);
});

test("codex-envelope-reports-feedback-runs: a feedback run whose exit code is null renders exit none, in record order", () => {
  const codex = codexAuthor(["run_proof", "run_typecheck"]);
  codex.feedbackRuns.push(
    { phase: "AUTHOR_TEST", tool: "run_proof", code: 1 },
    { phase: "IMPLEMENT", tool: "run_proof", code: 0 },
    { phase: "IMPLEMENT", tool: "run_typecheck", code: null },
  );

  assert.deepEqual(liveLeafLines(codex), [
    "leaf:        Codex CLI / ChatGPT subscription (no slices ran)",
    "cost:        not metered — ChatGPT subscription quota (no API/list-price USD asserted)",
    "scope walls: no write refusals",
    "feedback:    3 bounded run(s) — AUTHOR_TEST:run_proof=exit 1, IMPLEMENT:run_proof=green, IMPLEMENT:run_typecheck=exit none (feedback only; the spine's own observations decided)",
    CODEX_HELPERS_LINE,
  ]);
});

test("codex-envelope-reports-feedback-runs: armed with run_proof alone, the armed line names that one tool", () => {
  const codex = codexAuthor(["run_proof"]);

  assert.deepEqual(liveLeafLines(codex), [
    "leaf:        Codex CLI / ChatGPT subscription (no slices ran)",
    "cost:        not metered — ChatGPT subscription quota (no API/list-price USD asserted)",
    "scope walls: no write refusals",
    "feedback:    0 bounded runs — armed with run_proof; the leaf called none (the spine's own observations decided)",
    CODEX_HELPERS_LINE,
  ]);
});

test("codex-envelope-reports-feedback-runs: a Claude leaf with no feedback runs renders no feedback line, and one recorded run adds exactly the shared line", () => {
  const claude = cannedLiveAuthor([]);

  const lines = liveLeafLines(claude);
  assert.deepEqual(lines, [
    "leaf:        Claude Agent SDK (no slices ran)",
    "cost:        $0.0000 SDK-reported (subscription-billed)",
    "scope walls: no write refusals",
  ]);
  assert.deepEqual(
    lines.filter((line) => line.startsWith("feedback:")),
    [],
  );

  claude.feedbackRuns.push({ phase: "IMPLEMENT", tool: "run_proof", code: 0 });
  assert.deepEqual(liveLeafLines(claude), [
    "leaf:        Claude Agent SDK (no slices ran)",
    "cost:        $0.0000 SDK-reported (subscription-billed)",
    "scope walls: no write refusals",
    "feedback:    1 bounded run(s) — IMPLEMENT:run_proof=green (feedback only; the spine's own observations decided)",
  ]);
});
