/**
 * `--time-budget`'s whole reading, at the boundary where an operator's typed text becomes the
 * spine's clock (ADR-0581 D2).
 *
 * Every case below is a DIFFERENT ending, not a variation on one: no flag (the spine's own default
 * stands), a flag on a route that wires no budget, a figure that bounds the build, and the shapes
 * that cannot bound anything.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  TIME_BUDGET_REAL_ONLY_REFUSAL,
  chooseTimeBudgetMs,
  timeBudgetRefusal,
} from "./time-budget.js";

const REAL = { real: true };
const NOT_REAL = { real: false };

test("time-budget-absent-defers-to-the-spine: an omitted flag supplies no override, rather than a copied default", () => {
  // The point of the assertion: `undefined`, NOT 120 minutes in milliseconds. The two-hour default
  // lives once, in the orchestrator's DEFAULT_BUILD_BUDGET_MS, and this module must not restate it.
  assert.deepEqual(chooseTimeBudgetMs(undefined, REAL), { ok: true, ms: undefined });
  // And an absent flag is no decision on ANY route — it cannot be refused for being on the wrong one.
  assert.deepEqual(chooseTimeBudgetMs(undefined, NOT_REAL), { ok: true, ms: undefined });
});

test("time-budget-converts-minutes-to-milliseconds: the operator speaks minutes, the spine takes milliseconds", () => {
  assert.deepEqual(chooseTimeBudgetMs("120", REAL), { ok: true, ms: 7_200_000 });
  assert.deepEqual(chooseTimeBudgetMs("1", REAL), { ok: true, ms: 60_000 });
  // Fractional minutes are honoured: the flag bounds a build, and nothing about it requires whole
  // minutes. 30 seconds is a legitimate (if brutal) budget for a smoke run.
  assert.deepEqual(chooseTimeBudgetMs("0.5", REAL), { ok: true, ms: 30_000 });
});

test("time-budget-is-refused-off-the-real-route, before its value is even read", () => {
  assert.deepEqual(chooseTimeBudgetMs("45", NOT_REAL), {
    ok: false,
    reason: TIME_BUDGET_REAL_ONLY_REFUSAL,
  });
  // The ORDER is the assertion here: a malformed figure on the wrong route reports the ROUTE, not
  // the figure. Reporting "not a number" would send the operator to fix a value that would do
  // nothing even once it parsed.
  assert.deepEqual(chooseTimeBudgetMs("abc", NOT_REAL), {
    ok: false,
    reason: TIME_BUDGET_REAL_ONLY_REFUSAL,
  });
  assert.doesNotMatch(TIME_BUDGET_REAL_ONLY_REFUSAL, /positive number of minutes/);
});

test("time-budget-refuses-zero: a zero budget would spend an attempt authoring nothing", () => {
  assert.deepEqual(chooseTimeBudgetMs("0", REAL), { ok: false, reason: timeBudgetRefusal("0") });
});

test("time-budget-refuses-a-negative-figure: below zero is spent before the build starts", () => {
  assert.deepEqual(chooseTimeBudgetMs("-5", REAL), { ok: false, reason: timeBudgetRefusal("-5") });
});

test("time-budget-refuses-a-non-number, and quotes back what was typed rather than NaN", () => {
  const choice = chooseTimeBudgetMs("abc", REAL);
  assert.equal(choice.ok, false);
  const reason = choice.ok === false ? choice.reason : "";
  // The whole reason the raw text travels this far: `Number("abc")` is NaN, and "got NaN" tells an
  // operator nothing about what they typed.
  assert.match(reason, /got "abc"/);
  assert.doesNotMatch(reason, /NaN/);
});

test("time-budget-refuses-an-empty-or-blank-value: `Number(\"\")` is 0, which is not a budget", () => {
  assert.deepEqual(chooseTimeBudgetMs("", REAL), { ok: false, reason: timeBudgetRefusal("") });
  assert.deepEqual(chooseTimeBudgetMs("   ", REAL), { ok: false, reason: timeBudgetRefusal("   ") });
});

test("time-budget-refuses-infinity: an unbounded figure is not a budget", () => {
  const choice = chooseTimeBudgetMs("Infinity", REAL);
  assert.equal(choice.ok, false);
  assert.match(choice.ok === false ? choice.reason : "", /got "Infinity"/);
});

test("time-budget-refusal-names-the-flag-and-the-way-out: the message is what an operator acts on", () => {
  const reason = timeBudgetRefusal("0");
  assert.match(reason, /--time-budget must be a positive number of minutes/);
  // The whole build spends it, not one slice — the misreading that makes an operator set it too low.
  assert.match(reason, /both authoring slices and every in-build repair/);
  assert.match(reason, /Omit the flag for the default of two hours/);
});

test("time-budget-real-only-refusal-names-the-route-and-the-alternative", () => {
  assert.match(TIME_BUDGET_REAL_ONLY_REFUSAL, /bounds a --real build's wall clock/);
  // Without this sentence the refusal leaves a `--live` operator with no way to bound a run at all.
  assert.match(TIME_BUDGET_REAL_ONLY_REFUSAL, /use --max-turns there/);
});
