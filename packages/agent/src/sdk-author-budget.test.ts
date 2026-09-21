/**
 * OFFLINE tests for the Claude worker's side of the build's time budget (ADR-0581 D2): the slice that
 * must not start, the running slice the deadline stops, and what stops enforcing once time is the
 * brake. The query seam and the clock are both injected, so every property here is provable without
 * the SDK and without waiting.
 */

import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";

import { ClaudeAgentAuthor } from "./sdk-author.js";
import type { Options, SdkQueryFn } from "./sdk-author.js";
import type { WorkerBoundClock, WorkerTimeBudget } from "./worker-budget.js";

const CWD = path.resolve("/work/space");

/** A budget with a fixed remaining time. */
function budget(remainingMs: number, budgetMs = 7_200_000): WorkerTimeBudget {
  return { remainingMs: () => remainingMs, budgetMs };
}

/** A clock that records every arming and fires on demand, never on its own. */
function handClock() {
  const armed: number[] = [];
  let callback: (() => void) | undefined;
  let cleared = 0;
  // A real handle nothing waits on, so the clock's shape is the production one without a timer that
  // could fire mid-test.
  const handle = setTimeout(() => undefined, 0);
  clearTimeout(handle);
  return {
    armed,
    get cleared() {
      return cleared;
    },
    fire: () => callback?.(),
    clock: {
      setTimeout: (fn: () => void, ms: number) => {
        armed.push(ms);
        callback = fn;
        return handle;
      },
      clearTimeout: () => {
        cleared += 1;
      },
      // Frozen: these tests are about the DEADLINE, and nothing here reads the instant. The
      // moving clock that drives helper durations is `sdk-author-helpers.test.ts`'s (ADR-0589 D3).
      now: () => 0,
    } satisfies WorkerBoundClock,
  };
}

/** A query seam that records the options it was handed, then yields one successful result. */
function capturingQueryFn() {
  let captured: Options | undefined;
  let calls = 0;
  const fn: SdkQueryFn = async function* ({ options }) {
    calls += 1;
    captured = options;
    yield { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 };
  };
  return { fn, last: () => captured, calls: () => calls };
}

test("budget-stops-a-worker: a spent budget refuses the slice before any spend, as exhaustion", async () => {
  const cap = capturingQueryFn();
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: cap.fn,
    timeBudget: budget(0),
  });

  const r = await author.author("IMPLEMENT", "implement it");
  assert.deepEqual(r, {
    ok: false,
    exhausted: true,
    error: "the build's time budget of 120 min is spent at IMPLEMENT",
  });
  // The point of asking BEFORE the query: a spent budget costs nothing at all.
  assert.equal(cap.calls(), 0, "no SDK session is started once the budget is spent");
  assert.deepEqual(author.runs, []);
});

test("budget-stops-a-worker: the deadline is armed with what is LEFT of the budget, and released when the slice settles", async () => {
  const hand = handClock();
  const cap = capturingQueryFn();
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: cap.fn,
    timeBudget: budget(90_000),
    clock: hand.clock,
  });

  assert.deepEqual(await author.author("AUTHOR_TEST", "author the test"), { ok: true });
  assert.deepEqual(hand.armed, [90_000], "the deadline is the budget's remaining time, not the whole budget");
  assert.equal(hand.cleared, 1, "a settled slice leaves no armed deadline behind");
  const options = cap.last();
  assert.ok(options?.abortController instanceof AbortController);
  assert.equal(options?.abortController?.signal.aborted, false);
});

test("budget-stops-a-worker: a deadline that fires mid-slice aborts the SDK and reports exhaustion, not a crash", async () => {
  const hand = handClock();
  // The SDK aborts by signal and surfaces that as a THROWN error with no result message — the shape
  // this double reproduces. Without the budget's own record of why, this would read as a hard failure.
  // The await is BOUNDED, and that bound is the test's own guard: if no abort ever arrives — because a
  // mutant dropped the controller, the deadline or the abort call — this yields a SUCCESS result
  // instead of hanging, so the assertion below fails fast rather than timing the suite out
  // (`mutation-rung-scores-a-hang-as-unproven` §13).
  const aborting: SdkQueryFn = async function* ({ options }) {
    await new Promise<void>((resolve, reject) => {
      options.abortController?.signal.addEventListener("abort", () => {
        reject(new Error("The operation was aborted"));
      });
      setTimeout(() => resolve(), 50);
      hand.fire();
    });
    yield { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 };
  };
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: aborting,
    timeBudget: budget(60_000, 1_800_000),
    clock: hand.clock,
  });

  assert.deepEqual(await author.author("IMPLEMENT", "implement it"), {
    ok: false,
    exhausted: true,
    error: "the build's time budget of 30 min is spent at IMPLEMENT",
  });
  assert.equal(hand.cleared, 1);
});

test("budget-stops-a-worker: an abort that ends the stream WITHOUT throwing is the same stop", async () => {
  const hand = handClock();
  // Belt and braces on the SDK's shape: if a future version ends the iteration instead of throwing,
  // the slice must still report the budget rather than "ended without a result message".
  const silentAbort: SdkQueryFn = async function* ({ options }) {
    hand.fire();
    if (options.abortController?.signal.aborted === true) return;
    yield { type: "result", subtype: "success", is_error: false, num_turns: 1, total_cost_usd: 0 };
  };
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: silentAbort,
    timeBudget: budget(60_000),
    clock: hand.clock,
  });

  assert.deepEqual(await author.author("IMPLEMENT", "implement it"), {
    ok: false,
    exhausted: true,
    error: "the build's time budget of 120 min is spent at IMPLEMENT",
  });
});

test("budget-stops-a-worker: a slice that ends with no result and was NOT stopped keeps the fail-closed answer", async () => {
  const hand = handClock();
  // The deadline never fires, so a missing result message is the SDK's own silence, not the budget's.
  const noResult: SdkQueryFn = async function* () {
    await Promise.resolve();
  };
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: noResult,
    timeBudget: budget(60_000),
    clock: hand.clock,
  });

  const r = await author.author("IMPLEMENT", "implement it");
  assert.equal(r.ok, false);
  assert.equal(r.ok ? undefined : r.exhausted, undefined, "silence with time left is not exhaustion");
  assert.match(r.ok ? "" : r.error, /ended without a result message \(fail-closed\)/);
});

test("budget-stops-a-worker: with no clock injected the author arms its deadline on the real one", async () => {
  // The production default. A budget with an hour left arms a real timer that never fires inside this
  // test, and the slice's own `finally` releases it — so a leaked timer would hold the suite open.
  const cap = capturingQueryFn();
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: cap.fn,
    timeBudget: budget(3_600_000),
  });

  assert.deepEqual(await author.author("IMPLEMENT", "implement it"), { ok: true });
  assert.ok(cap.last()?.abortController instanceof AbortController);
});

test("budget-stops-a-worker: a genuine crash is still a crash, not a budget stop", async () => {
  const hand = handClock();
  // A seam that throws instead of iterating: the SDK's own failure shape, and not a generator, so
  // there is no unreachable `yield` to satisfy a linter with.
  const crashing: SdkQueryFn = () => {
    throw new Error("socket hang up");
  };
  const author = new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: crashing,
    timeBudget: budget(60_000),
    clock: hand.clock,
  });

  const r = await author.author("IMPLEMENT", "implement it");
  assert.equal(r.ok, false);
  assert.equal(r.ok ? undefined : r.exhausted, undefined, "a crash carries no exhaustion");
  assert.match(r.ok ? "" : r.error, /SDK session failed: socket hang up/);
});

test("the-turn-cap-stops-enforcing: a budget means no SDK turn ceiling, and no budget keeps the old default of 16", async () => {
  const withBudget = capturingQueryFn();
  await new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: withBudget.fn,
    timeBudget: budget(60_000),
    clock: handClock().clock,
  }).author("IMPLEMENT", "implement it");
  assert.equal(
    "maxTurns" in (withBudget.last() ?? {}),
    false,
    "with time as the brake the SDK is given no turn ceiling at all",
  );

  const noBudgetClock = handClock();
  const withoutBudget = capturingQueryFn();
  await new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: withoutBudget.fn,
    clock: noBudgetClock.clock,
  }).author("IMPLEMENT", "implement it");
  assert.equal(withoutBudget.last()?.maxTurns, 16, "a caller that wired no budget still has a brake");
  assert.deepEqual(noBudgetClock.armed, [], "and no deadline is armed on the clock at all");
  assert.equal(noBudgetClock.cleared, 1, "the release runs either way — it is a no-op when nothing was armed");
  assert.equal(
    withoutBudget.last()?.abortController,
    undefined,
    "and no deadline is armed without a budget",
  );
});

test("the-turn-cap-stops-enforcing: an operator's explicit --max-turns is still honoured alongside a budget", async () => {
  const cap = capturingQueryFn();
  await new ClaudeAgentAuthor({
    cwd: CWD,
    isWriteAllowed: () => true,
    queryFn: cap.fn,
    maxTurns: 45,
    timeBudget: budget(60_000),
    clock: handClock().clock,
  }).author("IMPLEMENT", "implement it");
  assert.equal(cap.last()?.maxTurns, 45);
});
