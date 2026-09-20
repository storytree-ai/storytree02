import assert from "node:assert/strict";
import { test } from "node:test";

import {
  budgetIsSpent,
  budgetMinutes,
  budgetSpentError,
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
