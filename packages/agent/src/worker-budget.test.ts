import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_FEEDBACK_RUNS_WITHOUT_A_BUDGET,
  budgetIsSpent,
  budgetMinutes,
  budgetSpentError,
  feedbackRunCap,
} from "./worker-budget.js";
import type { WorkerTimeBudget } from "./worker-budget.js";

/** A budget with a fixed remaining time — the shape both leaves read. */
function budget(remainingMs: number, budgetMs = 7_200_000): WorkerTimeBudget {
  return { remainingMs: () => remainingMs, budgetMs };
}

test("budgetMinutes floors, so an unspent minute never reads as spent", () => {
  assert.equal(budgetMinutes(7_200_000), "120 min");
  assert.equal(budgetMinutes(119_999), "1 min");
  assert.equal(budgetMinutes(59_999), "0 min");
  assert.equal(budgetMinutes(0), "0 min");
});

test("budgetSpentError names the budget and the phase that ran out of it", () => {
  assert.equal(
    budgetSpentError("IMPLEMENT", 7_200_000),
    "the build's time budget of 120 min is spent at IMPLEMENT",
  );
  assert.equal(
    budgetSpentError("AUTHOR_TEST", 1_800_000),
    "the build's time budget of 30 min is spent at AUTHOR_TEST",
  );
});

test("budgetIsSpent: only a budget with time left is unspent — zero and negative are spent", () => {
  assert.equal(budgetIsSpent(budget(1)), false);
  assert.equal(budgetIsSpent(budget(60_000)), false);
  assert.equal(budgetIsSpent(budget(0)), true);
  assert.equal(budgetIsSpent(budget(-1)), true);
  assert.equal(budgetIsSpent(budget(-90_000)), true);
});

test("budgetIsSpent asks the budget EVERY time, so a budget that drains is seen to drain", () => {
  let remaining = 2;
  const draining: WorkerTimeBudget = {
    remainingMs: () => {
      remaining -= 1;
      return remaining;
    },
    budgetMs: 1_000,
  };
  assert.equal(budgetIsSpent(draining), false);
  assert.equal(budgetIsSpent(draining), true);
});

test("feedback-run-cap-steps-aside-under-a-budget, and holds without one (ADR-0587)", () => {
  // The lift: a budgeted build is UNCAPPED, because the build's clock is what bounds a runaway now.
  assert.equal(feedbackRunCap(undefined, budget(60_000)), Number.POSITIVE_INFINITY);
  // And the old bound stands for a caller that wires no budget, so no path is left unbounded — the
  // same shape the turn ceiling takes (ADR-0584 D5).
  assert.equal(feedbackRunCap(undefined, undefined), DEFAULT_FEEDBACK_RUNS_WITHOUT_A_BUDGET);
  assert.equal(DEFAULT_FEEDBACK_RUNS_WITHOUT_A_BUDGET, 5, "the pre-ADR-0587 figure, unchanged");

  // An explicit value always wins, with a budget or without: an operator who set a cap meant it.
  assert.equal(feedbackRunCap(12, budget(60_000)), 12);
  assert.equal(feedbackRunCap(12, undefined), 12);
  // Including zero, which is a real request (no feedback at all) rather than an absent value — the
  // one case a `??` on the explicit argument would silently get wrong.
  assert.equal(feedbackRunCap(0, budget(60_000)), 0);
  assert.equal(feedbackRunCap(0, undefined), 0);

  // A SPENT budget is still a budget here. The cap asks whether the build has a clock at all, never
  // how much is left: a slice whose budget ran out is stopped by the budget itself (ADR-0584 D2/D3),
  // and re-capping its feedback would be a second answer to a settled question.
  assert.equal(feedbackRunCap(undefined, budget(0)), Number.POSITIVE_INFINITY);
});
