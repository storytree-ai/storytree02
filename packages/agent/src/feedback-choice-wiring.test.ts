/**
 * `a-feedback-tool-takes-a-choice-from-a-spine-computed-set` (ADR-0587), the WIRING half: that the
 * widened seam reaches `executeFeedback` — the one place both runtimes share — and that widening it
 * left the zero-argument default exactly where it was.
 *
 * `feedback-choice.test.ts` proves the validation. This file proves the three things that file
 * cannot see: that a declared choice is validated BEFORE anything spawns, that a command declaring
 * none ignores an argument rather than honouring it, and that a refused call spends no run.
 *
 * Plus the run cap stepping aside under a budget (ADR-0587, mirroring ADR-0584 D5's turn ceiling),
 * which is what makes `run_tests` usable at all: five runs is less than one write→run→fix cycle
 * that also checks the existing tests.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { executeFeedback, feedbackToolShape } from "./sdk-author.js";
import type { FeedbackCommand, FeedbackRunOutput, SdkFeedbackRun } from "./sdk-author.js";
import type { FeedbackChoice } from "./feedback-choice.js";

const GREEN: FeedbackRunOutput = { code: 0, stdout: "ok", stderr: "" };

/** A command that records what it was handed, so the test can see what crossed the seam. */
function recordingCommand(overrides: Partial<FeedbackCommand> = {}) {
  const calls: (FeedbackChoice | undefined)[] = [];
  const command: FeedbackCommand = {
    name: "run_tests",
    description: "run the existing tests",
    run: (choice) => {
      calls.push(choice);
      return Promise.resolve(GREEN);
    },
    parameter: {
      name: "files",
      description: "existing test files",
      choices: ["a.test.ts", "b.test.ts"],
    },
    ...overrides,
  };
  return { command, calls };
}

function runner() {
  const runs: SdkFeedbackRun[] = [];
  const record = (r: SdkFeedbackRun): void => {
    runs.push(r);
  };
  return { runs, record };
}

test("feedback-choice-reaches-the-command: a validated selection crosses the seam, not the raw argument", async () => {
  const { command, calls } = recordingCommand();
  const { runs, record } = runner();
  const out = await executeFeedback({
    phase: "AUTHOR_TEST",
    command,
    used: 0,
    max: 5,
    record,
    rawArguments: { files: ["b.test.ts"] },
  });
  assert.equal(out.isError, false);
  // The command receives the VALIDATED choice object, never the caller's raw arguments — a command
  // that had to re-validate would be a second fence to keep in step with the first.
  assert.deepEqual(calls, [{ chosen: ["b.test.ts"] }]);
  assert.deepEqual(runs, [{ phase: "AUTHOR_TEST", tool: "run_tests", code: 0 }]);
});

test("feedback-choice-omitted-crosses-as-the-whole-set-form, distinguishable from naming everything", async () => {
  const { command, calls } = recordingCommand();
  const { record } = runner();
  await executeFeedback({ phase: "IMPLEMENT", command, used: 0, max: 5, record, rawArguments: {} });
  await executeFeedback({ phase: "IMPLEMENT", command, used: 1, max: 5, record });
  // Both arrive as `chosen: undefined` — "no argument" and "an arguments object without the key"
  // are the same call. A command can still tell them from `["a.test.ts", "b.test.ts"]`, which is
  // what lets `run_tests` say "the whole suite" rather than listing every file back.
  assert.deepEqual(calls, [{ chosen: undefined }, { chosen: undefined }]);
});

test("feedback-choice-is-validated-BEFORE-anything-spawns, and a refusal spends no run", async () => {
  const { command, calls } = recordingCommand();
  const { runs, record } = runner();
  const out = await executeFeedback({
    phase: "AUTHOR_TEST",
    command,
    used: 0,
    max: 5,
    record,
    rawArguments: { files: ["../../etc/passwd"] },
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /is not one of the available files/);
  // Nothing ran: the command was never called, and nothing was recorded. A refused call is bounded
  // by the build's clock (ADR-0581 D2) rather than by the run cap, so it must not consume one —
  // otherwise a model that guesses a name three times has spent a cap meant for real runs.
  assert.deepEqual(calls, []);
  assert.deepEqual(runs, []);
});

test("feedback-choice-on-a-zero-argument-command is IGNORED, never honoured", async () => {
  // The fence is per-tool. `run_proof` declares no parameter, so an argument on it — however
  // well-formed — must not reach anything. Widening the seam must not widen the two commands that
  // were deliberately left narrow.
  const { command, calls } = recordingCommand({ parameter: undefined, name: "run_proof" });
  const { runs, record } = runner();
  const out = await executeFeedback({
    phase: "IMPLEMENT",
    command,
    used: 0,
    max: 5,
    record,
    rawArguments: { files: ["anything-at-all"] },
  });
  assert.equal(out.isError, false, "an argument on a zero-argument tool is not an error");
  assert.deepEqual(calls, [undefined], "and it does not reach the command");
  assert.equal(runs.length, 1);
});

test("feedback-tool-shape: a declared choice publishes an optional argument, and nothing else does", () => {
  const { command } = recordingCommand();
  const shape = feedbackToolShape(command);
  assert.deepEqual(Object.keys(shape), ["files"]);
  // Optional, because omitting it is the whole-set form rather than an error.
  assert.equal(shape["files"]?.isOptional(), true);
  // And the pre-existing commands keep the empty shape they had — the zero-argument default is what
  // this widening must not disturb.
  assert.deepEqual(feedbackToolShape({ ...command, parameter: undefined }), {});
});

test("feedback-run-cap-still-binds-without-a-budget, and the refusal says to stop", async () => {
  // The old behaviour, unchanged: a caller that wires no time budget is still bounded.
  const { command, calls } = recordingCommand();
  const { runs, record } = runner();
  const out = await executeFeedback({ phase: "AUTHOR_TEST", command, used: 5, max: 5, record });
  assert.equal(out.isError, true);
  assert.match(out.text, /feedback run budget exhausted \(5 runs this slice\)/);
  assert.deepEqual(calls, [], "nothing spawned past the cap");
  assert.deepEqual(runs, []);
});

test("feedback-run-cap-does-not-bind-when-it-is-infinite — what makes run_tests usable", async () => {
  // The lift itself, at the one place it is observable: with no finite cap, a slice may keep
  // checking its work. `used` here is far past the old five, which is roughly one write→run→fix
  // cycle that also runs the existing tests.
  const { command, calls } = recordingCommand();
  const { runs, record } = runner();
  const out = await executeFeedback({
    phase: "IMPLEMENT",
    command,
    used: 500,
    max: Number.POSITIVE_INFINITY,
    record,
  });
  assert.equal(out.isError, false);
  assert.equal(calls.length, 1);
  assert.deepEqual(runs, [{ phase: "IMPLEMENT", tool: "run_tests", code: 0 }]);
});

test("a command that throws is still reported as an error and recorded, choice or no choice", async () => {
  // The pre-existing contract, re-asserted across the widened path: a spawn failure never throws
  // into the SDK, and it IS recorded, because it consumed the attempt.
  const { record, runs } = runner();
  const command: FeedbackCommand = {
    name: "run_tests",
    description: "d",
    parameter: { name: "files", description: "d", choices: ["a.test.ts"] },
    run: () => Promise.reject(new Error("spawn ENOENT")),
  };
  const out = await executeFeedback({
    phase: "AUTHOR_TEST",
    command,
    used: 0,
    max: 5,
    record,
    rawArguments: { files: ["a.test.ts"] },
  });
  assert.equal(out.isError, true);
  assert.match(out.text, /feedback command failed to run: spawn ENOENT/);
  assert.deepEqual(runs, [{ phase: "AUTHOR_TEST", tool: "run_tests", code: null }]);
});
