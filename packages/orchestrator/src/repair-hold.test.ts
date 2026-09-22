/**
 * THE HOLD AT A SPENT BUDGET (ADR-0592) — `holdingBudget`.
 *
 * Every case here runs on an INJECTED clock and an INJECTED channel, and `sleep` advances that clock
 * rather than waiting: a budget test that named no budget would inherit the production two-hour default
 * and a poll loop that slept for real would hang the gate. Nothing in this file touches disk, a
 * process, a database or the wall clock.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_HOLD_GRACE_MS,
  holdingBudget,
  type HoldDecision,
  type HoldNotice,
} from "./repair.js";

const MIN = 60_000;

/** A controllable clock whose `sleep` advances it, so a poll loop turns without spending real time. */
function fakeClock(startAt = 1_000_000) {
  let t = startAt;
  return {
    now: (): number => t,
    advance: (ms: number): void => {
      t += ms;
    },
    sleep: (ms: number): Promise<void> => {
      t += ms;
      return Promise.resolve();
    },
  };
}

/** A recording channel. `answers` is consumed one poll at a time; `undefined` entries are "not yet". */
function fakeChannel(answers: readonly (HoldDecision | undefined)[] = []) {
  const remaining = [...answers];
  const record = {
    opened: [] as HoldNotice[],
    polls: 0,
    closes: 0,
    openThrows: false,
    pollThrows: false,
    closeThrows: false,
  };
  const channel = {
    open(notice: HoldNotice): Promise<void> {
      if (record.openThrows) return Promise.reject(new Error("no disk"));
      record.opened.push(notice);
      return Promise.resolve();
    },
    poll(): Promise<HoldDecision | undefined> {
      record.polls += 1;
      if (record.pollThrows) return Promise.reject(new Error("unreadable"));
      return Promise.resolve(remaining.shift());
    },
    close(): Promise<void> {
      record.closes += 1;
      if (record.closeThrows) return Promise.reject(new Error("locked"));
      return Promise.resolve();
    },
  };
  return { channel, record };
}

// ---------------------------------------------------------------------------
// Not spent: nothing holds
// ---------------------------------------------------------------------------

test("an unspent budget admits the repair and never announces a hold", async () => {
  const clock = fakeClock();
  const { channel, record } = fakeChannel();
  const budget = holdingBudget({ channel, budgetMs: 10 * MIN, graceMs: 5 * MIN, now: clock.now, sleep: clock.sleep });
  clock.advance(3 * MIN);

  assert.deepEqual(await budget.mayRepair(), { ok: true });
  assert.equal(record.opened.length, 0, "an unspent budget must not open the channel");
  assert.equal(record.polls, 0);
});

test("graceMs of 0 refuses exactly as a non-holding budget does, without opening the channel", async () => {
  // This is what `--hold-grace 0` selects (ADR-0592 D3): the hold is disabled, not merely shortened,
  // so the build ends on the ADR-0581 D2 wording a pre-hold build ended on.
  const clock = fakeClock();
  const { channel, record } = fakeChannel([{ kind: "extend", minutes: 30, reason: "would be ignored" }]);
  const budget = holdingBudget({ channel, budgetMs: 10 * MIN, graceMs: 0, now: clock.now, sleep: clock.sleep });
  clock.advance(10 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /time budget of 10 min is spent \(10 min elapsed\)/);
  assert.match(decision.reason, /so no repair was started \(ADR-0581 D2\)/);
  assert.equal(record.opened.length, 0, "a disabled hold must not announce itself");
  assert.equal(record.polls, 0, "a disabled hold must not wait for a decision it will not read");
});

// ---------------------------------------------------------------------------
// The hold announces what the orchestrator needs
// ---------------------------------------------------------------------------

test("a spent budget announces the hold with the budget, the elapsed clock, the grace and when it began", async () => {
  const clock = fakeClock(5_000_000);
  const { channel, record } = fakeChannel([{ kind: "stop", reason: "wedged" }]);
  const budget = holdingBudget({ channel, budgetMs: 120 * MIN, graceMs: 10 * MIN, now: clock.now, sleep: clock.sleep });
  clock.advance(121 * MIN);

  await budget.mayRepair();

  assert.equal(record.opened.length, 1);
  assert.deepEqual(record.opened[0], {
    budgetMs: 120 * MIN,
    elapsedMs: 121 * MIN,
    graceMs: 10 * MIN,
    heldAt: 5_000_000 + 121 * MIN,
    extensions: [],
  });
});

// ---------------------------------------------------------------------------
// An extension
// ---------------------------------------------------------------------------

test("an extension admits the repair and returns the record that bought it", async () => {
  const clock = fakeClock();
  const { channel } = fakeChannel([{ kind: "extend", minutes: 45, reason: "the diff shows real progress" }]);
  const budget = holdingBudget({ channel, budgetMs: 120 * MIN, graceMs: 10 * MIN, now: clock.now, sleep: clock.sleep });
  clock.advance(120 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, true);
  assert.deepEqual(decision.extension, {
    heldAfterMs: 120 * MIN,
    fromBudgetMs: 120 * MIN,
    toBudgetMs: 165 * MIN,
    reason: "the diff shows real progress",
  });
});

test("an extension raises the SAME object's budget, so the next worker slice reads the bought clock", async () => {
  // ADR-0592 D2, and the whole reason the hold needs no leaf change: the authors read `budgetMs` and
  // `remainingMs()` off this object (`WorkerTimeBudget`). If an extension did not move them, every
  // extended build's next slice would refuse itself before spending anything.
  const clock = fakeClock();
  const { channel } = fakeChannel([{ kind: "extend", minutes: 30, reason: "nearly green" }]);
  const budget = holdingBudget({ channel, budgetMs: 120 * MIN, graceMs: 10 * MIN, now: clock.now, sleep: clock.sleep });
  clock.advance(120 * MIN);

  assert.equal(budget.budgetMs, 120 * MIN);
  assert.equal(budget.remainingMs(), 0, "spent before the hold");

  await budget.mayRepair();

  assert.equal(budget.budgetMs, 150 * MIN, "the worker's view of the whole budget moved");
  assert.equal(budget.remainingMs(), 30 * MIN, "and so did the time it has left to spend");
});

test("a second expiry holds again, and the notice carries the extension already granted", async () => {
  const clock = fakeClock();
  const { channel, record } = fakeChannel([
    { kind: "extend", minutes: 30, reason: "first grant" },
    { kind: "stop", reason: "enough" },
  ]);
  const budget = holdingBudget({ channel, budgetMs: 60 * MIN, graceMs: 10 * MIN, now: clock.now, sleep: clock.sleep });

  clock.advance(60 * MIN);
  assert.equal((await budget.mayRepair()).ok, true);

  clock.advance(30 * MIN);
  const second = await budget.mayRepair();
  assert.equal(second.ok, false);

  assert.equal(record.opened.length, 2, "each expiry is its own hold");
  assert.equal(record.opened[1]?.budgetMs, 90 * MIN, "the second hold is on the EXTENDED budget");
  assert.deepEqual(
    record.opened[1]?.extensions.map((e) => e.reason),
    ["first grant"],
    "so the orchestrator can see what it has already bought before buying more",
  );
});

// ---------------------------------------------------------------------------
// A stop, and the grace window
// ---------------------------------------------------------------------------

test("a stop ends the build unsigned and names the orchestrator's own reason", async () => {
  const clock = fakeClock();
  const { channel } = fakeChannel([{ kind: "stop", reason: "the worker has rewritten the same file 40 times" }]);
  const budget = holdingBudget({ channel, budgetMs: 120 * MIN, graceMs: 10 * MIN, now: clock.now, sleep: clock.sleep });
  clock.advance(120 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /the orchestrator stopped the build rather than extend it/);
  assert.match(decision.reason, /rewritten the same file 40 times/);
  assert.match(decision.reason, /ADR-0592 D3/);
});

test("an unanswered hold stops itself at the grace window and says so, naming the verb that would have answered", async () => {
  // The owner's rule against states that invite waiting: the hold is admitted only because this bound
  // cannot be waived. A build that waited and got nothing must say it waited — a plain spent-budget
  // reason would hide the ten minutes from whoever reads the failure.
  const clock = fakeClock();
  const { channel, record } = fakeChannel();
  const budget = holdingBudget({
    channel,
    budgetMs: 120 * MIN,
    graceMs: 10 * MIN,
    now: clock.now,
    sleep: clock.sleep,
    pollMs: MIN,
  });
  clock.advance(120 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /HELD 10 min for the orchestrator to extend it or stop it/);
  assert.match(decision.reason, /storytree node extend/);
  assert.match(decision.reason, /stops unsigned rather than wait longer/);
  assert.equal(record.polls, 11, "polled once a minute for ten minutes, plus the first look");
});

test("a decision that arrives mid-grace is honoured on the poll it arrives on", async () => {
  const clock = fakeClock();
  const { channel, record } = fakeChannel([
    undefined,
    undefined,
    { kind: "extend", minutes: 20, reason: "answered on the third look" },
  ]);
  const budget = holdingBudget({
    channel,
    budgetMs: 60 * MIN,
    graceMs: 10 * MIN,
    now: clock.now,
    sleep: clock.sleep,
    pollMs: MIN,
  });
  clock.advance(60 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, true);
  assert.equal(decision.extension?.toBudgetMs, 80 * MIN);
  assert.equal(record.polls, 3);
});

test("a decision already waiting when the grace runs out is still honoured", async () => {
  // The poll comes BEFORE the deadline check on purpose. The orchestrator answered inside its window;
  // losing that to a race would punish it for the build's own polling interval.
  const clock = fakeClock();
  const { channel } = fakeChannel([undefined, { kind: "extend", minutes: 15, reason: "just in time" }]);
  const budget = holdingBudget({
    channel,
    budgetMs: 60 * MIN,
    graceMs: 5 * MIN,
    now: clock.now,
    sleep: clock.sleep,
    pollMs: 5 * MIN,
  });
  clock.advance(60 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, true, "the grace had exactly run out, and the answer was already there");
  assert.equal(decision.extension?.reason, "just in time");
});

// ---------------------------------------------------------------------------
// A broken channel must never hang or crash the build
// ---------------------------------------------------------------------------

test("a channel that cannot announce the hold still waits out the grace and still stops", async () => {
  const clock = fakeClock();
  const { channel, record } = fakeChannel();
  record.openThrows = true;
  const budget = holdingBudget({
    channel,
    budgetMs: 60 * MIN,
    graceMs: 4 * MIN,
    now: clock.now,
    sleep: clock.sleep,
    pollMs: 2 * MIN,
  });
  clock.advance(60 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, false, "an unannounced hold is still a bounded hold, never a crash");
  assert.match(decision.reason, /HELD 4 min/);
  assert.equal(record.polls > 0, true, "it still looked for a decision someone might have written anyway");
});

test("a poll that throws for the whole grace ends the build exactly as an absent orchestrator does", async () => {
  const clock = fakeClock();
  const { channel, record } = fakeChannel();
  record.pollThrows = true;
  const budget = holdingBudget({
    channel,
    budgetMs: 60 * MIN,
    graceMs: 4 * MIN,
    now: clock.now,
    sleep: clock.sleep,
    pollMs: 2 * MIN,
  });
  clock.advance(60 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /No decision arrived/);
});

test("a close that throws does not escape the budget", async () => {
  const clock = fakeClock();
  const { channel, record } = fakeChannel([{ kind: "extend", minutes: 5, reason: "fine" }]);
  record.closeThrows = true;
  const budget = holdingBudget({ channel, budgetMs: 60 * MIN, graceMs: 4 * MIN, now: clock.now, sleep: clock.sleep });
  clock.advance(60 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, true, "the extension was granted; tidying up failing must not undo it");
});

test("the hold is closed on every ending: extended, stopped, and timed out", async () => {
  for (const [label, answers, graceMs] of [
    ["extended", [{ kind: "extend", minutes: 5, reason: "r" }] as HoldDecision[], 4 * MIN],
    ["stopped", [{ kind: "stop", reason: "r" }] as HoldDecision[], 4 * MIN],
    ["timed out", [] as HoldDecision[], 4 * MIN],
  ] as const) {
    const clock = fakeClock();
    const { channel, record } = fakeChannel(answers);
    const budget = holdingBudget({
      channel,
      budgetMs: 60 * MIN,
      graceMs,
      now: clock.now,
      sleep: clock.sleep,
      pollMs: 2 * MIN,
    });
    clock.advance(60 * MIN);

    await budget.mayRepair();
    assert.equal(record.closes, 1, `a ${label} hold must take its announcement down`);
  }
});

// ---------------------------------------------------------------------------
// The default
// ---------------------------------------------------------------------------

test("the default grace window is ten minutes, and it is what an unconfigured hold waits", async () => {
  // Pinned rather than trusted: this number is the whole cost of the feature on an unanswered build
  // (ADR-0592's Consequences), so a silent change to it is a silent change to that cost.
  assert.equal(DEFAULT_HOLD_GRACE_MS, 10 * MIN);

  const clock = fakeClock();
  const { channel, record } = fakeChannel();
  const budget = holdingBudget({
    channel,
    budgetMs: 60 * MIN,
    now: clock.now,
    sleep: clock.sleep,
    pollMs: 5 * MIN,
  });
  clock.advance(60 * MIN);

  const decision = await budget.mayRepair();
  assert.equal(decision.ok, false);
  assert.match(decision.reason, /HELD 10 min/);
  assert.equal(record.polls, 3, "10 minutes of grace at a 5-minute poll: look, sleep, look, sleep, look");
});
