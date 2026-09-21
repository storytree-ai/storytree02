/**
 * THE PEEK REPORTS THE HOLD (ADR-0592 D6) — the fold's hold states, and the two render blocks.
 *
 * ## Why the HOLD BLOCK and not the whole body
 *
 * `build-peek-render.test.ts` pins the whole render, and it explains why: every prose word is its own
 * mutant, and a whole-body golden kills the class at once. That golden already covers everything below
 * the hold, so pinning the whole body a second time here would mean every blind-spot edit breaks two
 * files and neither says which one cares. So these goldens pin the HOLD BLOCK exactly — the prose this
 * decision adds — and nothing else.
 *
 * They are deliberately brittle for the same reason the sibling's are: this block asks an operator to
 * spend money inside a window that expires, and a word quietly dropped from it leaves a reader trusting
 * a completeness the read never had.
 *
 * Captured by running the fold, never transcribed by hand.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  foldBuildPeek,
  renderBuildPeek,
  type BuildPeek,
  type ClassifiedSpawn,
  type PeekHold,
  type PeekPhaseMark,
} from "./index.js";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const MIN = 60_000;

function spawn(): ClassifiedSpawn {
  return {
    record: {
      sessionId: "bold-noether-1234",
      branch: "claude/bold-noether-1234",
      pid: 4242,
      command: "storytree node build a-unit --real --increment inc-1 --time-budget 120",
      cwd: "C:/wt/bold-noether-1234",
      startedAt: "2026-09-21T09:55:00.000Z",
    },
    state: "live",
    ageMs: 125 * MIN,
  };
}

const MARKS: readonly PeekPhaseMark[] = [
  { seq: 1, at: "2026-09-21T09:56:00.000Z", event: "building", runId: "real-abc123", phase: "AUTHOR_TEST" },
  { seq: 2, at: "2026-09-21T10:45:00.000Z", event: "building", runId: "real-abc123", phase: "IMPLEMENT" },
];

function hold(over: Partial<PeekHold> = {}): PeekHold {
  return {
    runId: "real-abc123",
    pid: 4242,
    budgetMs: 120 * MIN,
    elapsedMs: 121 * MIN,
    graceMs: 10 * MIN,
    heldAt: NOW - 3 * MIN,
    extensions: [],
    ...over,
  };
}

function peekOf(held?: PeekHold): BuildPeek {
  const withHold = held === undefined ? {} : { hold: held };
  return foldBuildPeek({ unitId: "a-unit", spawns: [spawn()], marks: MARKS, nowMs: NOW, ...withHold });
}

// ---------------------------------------------------------------------------
// The fold
// ---------------------------------------------------------------------------

test("no hold input means not held, and the render says nothing about holds at all", () => {
  const peek = peekOf();
  assert.deepEqual(peek.hold, { held: false });
  const body = renderBuildPeek(peek);
  assert.equal(/HELD —/.test(body), false, "a peek of a healthy build must read exactly as it did before");
  assert.equal(/node extend/.test(body), false);
});

test("a hold inside its grace is held, answerable, and reports the time left", () => {
  const peek = peekOf(hold());
  assert.equal(peek.hold.held, true);
  assert.equal(peek.hold.held && peek.hold.answerable, true);
  assert.equal(peek.hold.held && peek.hold.leftMs, 7 * MIN);
});

test("a hold at exactly its expiry is held but NOT answerable, with zero left", () => {
  // The same `>=` boundary the budget itself stops on. Reported as unanswerable rather than as "no
  // hold", because the two are different facts: one says nothing is waiting, the other says something
  // was and you are too late — and only the second tells an operator to re-run with a longer budget.
  const peek = peekOf(hold({ heldAt: NOW - 10 * MIN }));
  assert.equal(peek.hold.held, true);
  assert.equal(peek.hold.held && peek.hold.answerable, false);
  assert.equal(peek.hold.held && peek.hold.leftMs, 0, "never negative — 'minus four minutes left' is not a reading");
});

test("a hold one millisecond before expiry is still answerable", () => {
  const peek = peekOf(hold({ heldAt: NOW - 10 * MIN + 1 }));
  assert.equal(peek.hold.held && peek.hold.answerable, true);
  assert.equal(peek.hold.held && peek.hold.leftMs, 1);
});

// ---------------------------------------------------------------------------
// The render, pinned
// ---------------------------------------------------------------------------

const ANSWERABLE_BLOCK = [
  "HELD — this build's time budget is SPENT and it is waiting for you (ADR-0592):",
  "  budget:  2h 0m spent (2h 1m elapsed)   run real-abc123, pid 4242",
  "  left:    7m of its grace window, then the build STOPS unsigned",
  '  answer:  storytree node extend a-unit --minutes <n> --reason "<why>"',
  '           storytree node extend a-unit --stop --reason "<why>"',
].join("\n");

const EXPIRED_BLOCK = [
  "HELD — this build's time budget is SPENT and it is waiting for you (ADR-0592):",
  "  budget:  2h 30m spent (2h 31m elapsed)   run real-abc123, pid 4242",
  "  granted: 1 extension(s) already — now 2h 30m in total",
  "  left:    NONE — the grace window has passed, so the build has already stopped unsigned (or died",
  "           while held and left this notice behind). An answer now would be read by nothing.",
].join("\n");

test("the answerable hold block is pinned whole, and carries both answers", () => {
  const body = renderBuildPeek(peekOf(hold()));
  assert.equal(body.includes(ANSWERABLE_BLOCK), true, `hold block drifted:\n${body}`);
});

test("the expired hold block is pinned whole, names the extensions already bought, and offers no answer", () => {
  const body = renderBuildPeek(
    peekOf(
      hold({
        heldAt: NOW - 20 * MIN,
        budgetMs: 150 * MIN,
        elapsedMs: 151 * MIN,
        extensions: [{ reason: "the diff shows real progress", toBudgetMs: 150 * MIN }],
      }),
    ),
  );
  assert.equal(body.includes(EXPIRED_BLOCK), true, `expired hold block drifted:\n${body}`);
  assert.equal(
    /answer: {2}storytree node extend/.test(body),
    false,
    "an expired hold must not offer a command whose effect would be read by nothing",
  );
});

test("the hold block comes ABOVE the wall clock, because it is the part that expires", () => {
  const body = renderBuildPeek(peekOf(hold()));
  assert.equal(body.indexOf("HELD —") < body.indexOf("Wall clock:"), true);
});

test("an extended budget is reconciled with the argv budget rather than left to contradict it", () => {
  // ADR-0588 D5 recovers the budget from the registered argv, which an extension never rewrites. So a
  // held-and-extended build has TWO budgets available to this render, and printing both without a word
  // is worse than printing either: a reader resolves it by trusting whichever they read first.
  const body = renderBuildPeek(peekOf(hold({ budgetMs: 150 * MIN, elapsedMs: 151 * MIN })));
  assert.match(body, /budget: {2}2h 0m \(as launched, from `--time-budget` in the registered argv\)/);
  assert.match(body, /extended: now 2h 30m — the figure above is what the build was/);
  assert.match(body, /LAUNCHED with, which is all the argv can say\. See the HELD block above for the live one\./);
});

test("an UNextended hold adds no reconciliation line, so the common case is unchanged", () => {
  const body = renderBuildPeek(peekOf(hold()));
  assert.equal(/extended: now/.test(body), false);
});

test("the render names the between-holds under-report as a blind spot rather than hiding it", () => {
  // Once a build resumes, its notice is gone and only the build knows its real clock. ADR-0588 D3 makes
  // stating that part of the contract: an observability read that silently omits what it cannot see
  // teaches its reader to over-trust it.
  const body = renderBuildPeek(peekOf());
  assert.match(body, /an EXTENSION granted at a hold, once the build has resumed \(ADR-0592\)/);
  assert.match(body, /between holds this read UNDER-reports the clock a build is actually running on/);
});
