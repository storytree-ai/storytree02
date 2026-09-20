/**
 * `a-real-build-runs-on-one-wall-clock` (ADR-0581 D2), the drive half: `node build --time-budget`
 * is read before anything is loaded or spent, and a figure that cannot bound a build is refused
 * rather than carried into the spine.
 *
 * Driven through `nodeBuild` itself rather than through `chooseTimeBudgetMs` — which
 * `time-budget.test.ts` already covers exhaustively — because the two can only disagree HERE: a
 * refusal that the build never consults, or one raised after the spec load and the DB preflight,
 * would leave every assertion in that pure suite passing while a real build spent first and refused
 * afterwards. What this file asserts is the WIRING and its POSITION.
 *
 * Nothing here spends: every call is refused inside the argument checks, before any spec is loaded,
 * any store is opened or any leaf is built. `unitId` is deliberately a name no fixture defines — if
 * a refusal below ever stopped preceding the spec load, the body would say so and the assertion
 * against `/no node spec/` would catch it.
 */

import test from "node:test";
import assert from "node:assert/strict";

import * as NodeBuildModule from "./node-build.js";
import { TIME_BUDGET_REAL_ONLY_REFUSAL, timeBudgetRefusal } from "./time-budget.js";

const unitId = "a-unit-no-fixture-defines";

test("node-build-reads-the-time-budget: a figure that cannot bound a build is refused before the spec load", async () => {
  for (const raw of ["0", "-5", "abc", ""]) {
    const envelope = await NodeBuildModule.nodeBuild(unitId, {
      dryRun: false,
      real: true,
      increment: "inc-x",
      timeBudget: raw,
      actor: "tester@example.com",
    });
    assert.equal(envelope.ok, false, raw);
    assert.equal(envelope.body, timeBudgetRefusal(raw), raw);
    // The position assertion: nothing was loaded on the way to this refusal.
    assert.doesNotMatch(envelope.body, /no node spec/, raw);
  }
});

test("node-build-reads-the-time-budget: the refusal offers a valid command rather than echoing the rejected figure", async () => {
  const envelope = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    timeBudget: "0",
    actor: "tester@example.com",
  });
  assert.deepEqual(envelope.next, [
    `storytree node build ${unitId} --real --increment <increment-id> --time-budget 120`,
  ]);
});

test("node-build-reads-the-time-budget: it is refused off the --real route, which wires no budget", async () => {
  // Both non-real routes, because the narrowing is about which route WIRES a budget (ADR-0584 D5
  // leaves `--live` on its turn cap), not about `--dry-run` being offline.
  for (const opts of [
    { dryRun: true },
    { dryRun: false, live: true },
  ]) {
    const envelope = await NodeBuildModule.nodeBuild(unitId, {
      ...opts,
      timeBudget: "45",
      actor: "tester@example.com",
    });
    assert.equal(envelope.ok, false, JSON.stringify(opts));
    assert.equal(envelope.body, TIME_BUDGET_REAL_ONLY_REFUSAL, JSON.stringify(opts));
    assert.doesNotMatch(envelope.body, /no node spec/, JSON.stringify(opts));
  }
});

test("node-build-reads-the-time-budget: a valid figure is NOT refused — the check passes it through", async () => {
  // The other side of every assertion above. Without this, a `chooseTimeBudgetMs` that refused
  // everything would satisfy the whole file. This build goes on to fail for an unrelated reason
  // (there is no such unit), which is exactly the point: it got PAST the budget check.
  const envelope = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: false,
    real: true,
    increment: "inc-x",
    timeBudget: "45",
    actor: "tester@example.com",
  });
  assert.doesNotMatch(envelope.body, /--time-budget/);
});

test("node-build-reads-the-time-budget: an absent flag is not refused either", async () => {
  const envelope = await NodeBuildModule.nodeBuild(unitId, {
    dryRun: true,
    actor: "tester@example.com",
  });
  assert.doesNotMatch(envelope.body, /--time-budget/);
});
