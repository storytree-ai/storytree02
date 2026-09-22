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
  HOLD_GRACE_REAL_ONLY_REFUSAL,
  TIME_BUDGET_REAL_ONLY_REFUSAL,
  chooseHoldGraceMs,
  chooseTimeBudgetMs,
  holdGraceRefusal,
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

// ---------------------------------------------------------------------------
// `--hold-grace` (ADR-0592 D3) — the sibling, whose ZERO rule is the opposite
// ---------------------------------------------------------------------------

test("hold-grace-absent-is-no-override-so-the-ten-minute-default-stands", () => {
  // Same as its sibling and for the same reason: the default lives in ONE place
  // (`DEFAULT_HOLD_GRACE_MS`), so an omitted flag must arrive as "no decision" and never as a number
  // copied down to this boundary.
  assert.deepEqual(chooseHoldGraceMs(undefined, REAL), { ok: true, ms: undefined });
  assert.deepEqual(chooseHoldGraceMs(undefined, NOT_REAL), { ok: true, ms: undefined });
});

test("hold-grace-converts-minutes-to-milliseconds-on-the-real-route", () => {
  assert.deepEqual(chooseHoldGraceMs("10", REAL), { ok: true, ms: 600_000 });
  assert.deepEqual(chooseHoldGraceMs("0.5", REAL), { ok: true, ms: 30_000 });
});

test("hold-grace-HONOURS-zero-where-time-budget-refuses-it", () => {
  // ⚠ THE ASYMMETRY, asserted rather than left to be inferred from two files. A zero `--time-budget`
  // is a build that authors nothing and still spends an attempt, which nobody ever means to type. A
  // zero `--hold-grace` is a real request — end the build the instant its clock is spent, which is
  // ADR-0584's behaviour before the hold existed — so the two flags MUST disagree here, and a later
  // change that "tidied" them into agreement would silently remove the only way to opt out of holding.
  assert.deepEqual(chooseHoldGraceMs("0", REAL), { ok: true, ms: 0 });
  assert.equal(chooseTimeBudgetMs("0", REAL).ok, false);
});

test("hold-grace-refuses-a-negative-because-that-is-a-typo-not-a-shorter-hold", () => {
  const refused = chooseHoldGraceMs("-5", REAL);
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.reason, holdGraceRefusal("-5"));
});

test("hold-grace-refuses-what-cannot-bound-a-hold-at-all", () => {
  for (const raw of ["abc", "", "   ", "NaN", "Infinity"]) {
    const refused = chooseHoldGraceMs(raw, REAL);
    assert.equal(refused.ok, false, `"${raw}" cannot bound a hold`);
  }
  // `Number("")` and `Number("  ")` are both 0, which the ZERO rule above would otherwise honour — so
  // these two are the cases that prove the guard is not merely `< 0`.
  assert.equal(chooseHoldGraceMs("", REAL).ok, false, "an empty flag is not a request to disable the hold");
  assert.equal(chooseHoldGraceMs("   ", REAL).ok, false);
});

test("hold-grace-is-refused-on-a-route-that-wires-no-budget-BEFORE-its-value-is-read", () => {
  // Order matters for the same reason it does for `--time-budget`: telling someone their number is
  // malformed, when the real problem is that the flag does nothing on this route, sends them to fix
  // the wrong thing.
  const refused = chooseHoldGraceMs("nonsense", NOT_REAL);
  assert.equal(refused.ok, false);
  assert.equal(refused.ok === false && refused.reason, HOLD_GRACE_REAL_ONLY_REFUSAL);
});

test("hold-grace-refusal-explains-both-the-default-and-the-opt-out", () => {
  const reason = holdGraceRefusal("soon");
  assert.match(reason, /--hold-grace must be a number of minutes, zero or more; got "soon"/);
  assert.match(reason, /extend it or stop it/);
  assert.match(reason, /Omit the flag for the default of ten minutes/);
  // Without this clause an operator who wants the old stop-at-expiry behaviour has no way to find it.
  assert.match(reason, /pass 0 to disable the hold/);
});

test("hold-grace-real-only-refusal-says-WHY-a-live-smoke-cannot-hold", () => {
  assert.match(HOLD_GRACE_REAL_ONLY_REFUSAL, /is wired on that route only/);
  // The reason is structural, not a policy: with no budget there is no expiry to be held at.
  assert.match(HOLD_GRACE_REAL_ONLY_REFUSAL, /wires no budget at all, so it has no expiry to be held at/);
});
