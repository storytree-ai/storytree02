/**
 * `a-real-build-runs-on-one-wall-clock` (ADR-0581 D2), the `story build` half — plus the help both
 * build commands print, which is the only place an operator learns the flag exists.
 *
 * `story build` reads the flag through the same `chooseTimeBudgetMs` that `node build` does, so this
 * file does NOT re-prove the reading. What it proves is the wiring and its POSITION: that the chain
 * command actually consults the flag, refuses before loading a story or spending anything, and does
 * not quietly accept a figure on a route that wires no budget.
 *
 * ⚠ Nothing here drives an author. A hermetic test that drives one WITHOUT naming a budget inherits
 * `DEFAULT_BUILD_BUDGET_MS` — two hours — and does not fail: it runs for two hours and presents as a
 * hung gate. (Measured 2026-09-20 on this arc's sibling increment, two tests at 7,201,445 ms each.)
 */

import test from "node:test";
import assert from "node:assert/strict";

import { nodeHelp } from "./node-build.js";
import { storyBuild, storyHelp } from "./story-build.js";
import { TIME_BUDGET_REAL_ONLY_REFUSAL, timeBudgetRefusal } from "./time-budget.js";

const storyId = "a-story-no-fixture-defines";

test("story-build-reads-the-time-budget: a figure that cannot bound a member build is refused before the story loads", async () => {
  for (const raw of ["0", "-5", "abc", ""]) {
    const env = await storyBuild(storyId, {
      dryRun: false,
      real: true,
      increment: "inc-x",
      timeBudget: raw,
      actor: "tester@example.com",
    });
    assert.equal(env.ok, false, raw);
    assert.equal(env.body, timeBudgetRefusal(raw), raw);
    // The position assertion: no story spec was searched for on the way to this refusal.
    assert.doesNotMatch(env.body, /no story spec/, raw);
  }
});

test("story-build-reads-the-time-budget: the refusal offers a valid story-build command", async () => {
  const env = await storyBuild(storyId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    timeBudget: "0",
    actor: "tester@example.com",
  });
  assert.deepEqual(env.next, [
    `storytree story build ${storyId} --real --increment <increment-id> --time-budget 120`,
  ]);
});

test("story-build-reads-the-time-budget: it is refused off the --real route, which wires no budget", async () => {
  for (const opts of [{ dryRun: true }, { dryRun: false, live: true }]) {
    const env = await storyBuild(storyId, {
      ...opts,
      timeBudget: "45",
      actor: "tester@example.com",
    });
    assert.equal(env.ok, false, JSON.stringify(opts));
    assert.equal(env.body, TIME_BUDGET_REAL_ONLY_REFUSAL, JSON.stringify(opts));
  }
});

test("story-build-reads-the-time-budget: a valid figure is NOT refused — the check passes it through", async () => {
  // Without this, a check that refused everything would satisfy every assertion above. This chain
  // goes on to fail for its own unrelated reason (no such story), which is the point: it got past.
  const env = await storyBuild(storyId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    timeBudget: "45",
    actor: "tester@example.com",
  });
  assert.doesNotMatch(env.body, /--time-budget/);
});

test("both build commands' help names --time-budget on the --real line, and nowhere else", () => {
  // The flag is wired on `--real` only, so help that advertised it on the `--live` line would send
  // an operator straight into the refusal. Asserted per LINE rather than over the whole help text,
  // which is what makes "nowhere else" checkable at all.
  for (const [label, help] of [["node", nodeHelp()], ["story", storyHelp()]] as const) {
    const lines = help.body.split("\n").filter((line) => line.includes("--time-budget"));
    assert.equal(lines.length, 1, `${label}: exactly one help line should mention --time-budget`);
    const line = lines[0] ?? "";
    assert.match(line, /--real/, `${label}: the line naming --time-budget is the --real one`);
    assert.match(line, /--time-budget <minutes>/, `${label}: the flag takes minutes, and says so`);
  }
});
