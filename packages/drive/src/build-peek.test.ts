/**
 * The peek's whole reading (ADR-0588): every state the join can reach, with BOTH inputs injected —
 * no processes, no disk, no database.
 *
 * Each case below is a DIFFERENT ending rather than a variation on one, because the cost of getting
 * this wrong is asymmetric: a peek that collapses "I cannot tell" into either "running" or "ended"
 * reproduces exactly the defect it was built to fix — a signal that looks like an answer.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_BUILD_BUDGET_MS } from "@storytree/orchestrator";

import {
  BUILD_PEEK_BLIND_SPOTS,
  attemptPolicyPeekCaveat,
  foldBuildPeek,
  formatDurationMs,
  parseRegisteredBuild,
  renderBuildPeek,
  type PeekPhaseMark,
} from "./build-peek.js";
import type { ClassifiedSpawn, SpawnState } from "./spawn-registry.js";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");

function spawn(
  command: string,
  state: SpawnState,
  over: { readonly pid?: number; readonly ageMs?: number | null; readonly sessionId?: string } = {},
): ClassifiedSpawn {
  return {
    record: {
      sessionId: over.sessionId ?? "bold-noether-1234",
      branch: "claude/bold-noether-1234",
      pid: over.pid ?? 4242,
      command,
      cwd: "C:\\code\\storytree\\.claude\\worktrees\\bold-noether-1234",
      startedAt: "2026-09-21T11:00:00.000Z",
    },
    state,
    ageMs: over.ageMs === undefined ? 60 * 60_000 : over.ageMs,
  };
}

function mark(over: Partial<PeekPhaseMark> & { readonly seq: number }): PeekPhaseMark {
  const base: PeekPhaseMark = {
    seq: over.seq,
    at: over.at ?? "2026-09-21T11:05:00.000Z",
    event: over.event ?? "building",
    runId: over.runId ?? "real-abc123",
  };
  return over.phase === undefined ? base : { ...base, phase: over.phase };
}

const REAL_BUILD = "storytree node build my-unit --real --store pg --increment inc-1";

// ---------------------------------------------------------------------------
// Parsing a registered invocation
// ---------------------------------------------------------------------------

test("peek-parse-reads-the-unit-and-the-budget-out-of-the-registered-argv", () => {
  assert.deepEqual(
    parseRegisteredBuild("storytree node build my-unit --real --store pg --time-budget 45"),
    { unitId: "my-unit", route: "node", timeBudgetMs: 45 * 60_000 },
  );
  // No flag is a POSITIVE reading — the build ran on the spine's default — so the parse reports the
  // flag's absence rather than substituting a number here. Which default applies is the fold's call.
  assert.deepEqual(parseRegisteredBuild(REAL_BUILD), {
    unitId: "my-unit",
    route: "node",
    timeBudgetMs: undefined,
  });
  assert.equal(parseRegisteredBuild("storytree story build my-story --real")?.route, "story");
});

test("peek-parse-refuses-everything-that-is-not-a-real-build", () => {
  // `--real` is required: a dry run writes phase marks too, but it runs on no wall clock, so
  // reporting elapsed against a budget it does not have is the wrong-denominator error one level up.
  assert.equal(parseRegisteredBuild("storytree node build my-unit --dry-run"), null);
  assert.equal(parseRegisteredBuild("storytree node build my-unit --live"), null);
  // Other registrars write LABELS rather than argv, and must not be coaxed into a shape they never had.
  assert.equal(parseRegisteredBuild("pnpm gate"), null);
  assert.equal(parseRegisteredBuild("studio dev server (vite) on :5173 — pnpm studio:up"), null);
  // A read verb is not a build — including this unit's own peek, which would otherwise match itself.
  assert.equal(parseRegisteredBuild("storytree node peek my-unit --pg"), null);
  assert.equal(parseRegisteredBuild("storytree node attempts my-unit --pg"), null);
  // A missing id, and a flag where the id should be, are both refusals rather than an empty unit.
  assert.equal(parseRegisteredBuild("storytree node build"), null);
  assert.equal(parseRegisteredBuild("storytree node build --real"), null);
});

test("peek-parse-ignores-a-time-budget-that-cannot-bound-a-build", () => {
  // Tolerant where `chooseTimeBudgetMs` is strict, and the direction is the reason: a figure the
  // LAUNCHER would have refused never became a build, so an unreadable one here means the record is
  // not telling us the budget — never that the budget was zero.
  for (const raw of ["abc", "0", "-5", ""]) {
    assert.equal(
      parseRegisteredBuild(`storytree node build my-unit --real --time-budget ${raw}`)?.timeBudgetMs,
      undefined,
      `--time-budget ${raw}`,
    );
  }
  // A trailing flag with no value must not read the NEXT flag as a number.
  assert.equal(
    parseRegisteredBuild("storytree node build my-unit --real --time-budget")?.timeBudgetMs,
    undefined,
  );
});

// ---------------------------------------------------------------------------
// The three states (D2)
// ---------------------------------------------------------------------------

test("peek-running: a live registered process is the one positive answer the orchestrator needs", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "live", { pid: 999 })],
    marks: [mark({ seq: 1 }), mark({ seq: 2, phase: "IMPLEMENT", at: "2026-09-21T11:40:00.000Z" })],
    nowMs: NOW,
  });
  assert.equal(peek.liveness, "running");
  assert.match(peek.livenessReason, /pid 999 is alive/);
  assert.equal(peek.run?.latest?.phase, "IMPLEMENT");
});

test("peek-ended: a leaked record is a build that was killed or crashed, not one that finished", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "leaked", { pid: 777 })],
    marks: [mark({ seq: 1, phase: "AUTHOR_TEST" })],
    nowMs: NOW,
  });
  assert.equal(peek.liveness, "ended");
  assert.match(peek.livenessReason, /never de-registered/);
});

test("peek-unknown-probe: a probe that could not answer is not one that said no", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "unknown", { pid: 31 })],
    marks: [],
    nowMs: NOW,
  });
  assert.equal(peek.liveness, "unknown");
  assert.match(peek.livenessReason, /could not tell/);
});

test("peek-unknown-no-record: three causes this read cannot separate, and it says all three", () => {
  // THE CASE THAT MUST NOT COLLAPSE. A build that finished and removed its own record is
  // indistinguishable from one running on another machine, and from one launched in the primary
  // checkout (which derives no identity and registers nothing). Answering "ended" would be a guess
  // dressed as a measurement — the exact defect this unit exists to remove.
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn("storytree node build a-different-unit --real", "live")],
    marks: [mark({ seq: 1, phase: "GATE" })],
    nowMs: NOW,
  });
  assert.equal(peek.liveness, "unknown");
  assert.equal(peek.processes.length, 0, "another unit's build must not match this one");
  assert.match(peek.livenessReason, /FINISHED/);
  assert.match(peek.livenessReason, /ANOTHER machine/);
  assert.match(peek.livenessReason, /primary checkout/);
});

test("peek-live-outranks-a-crashed-sibling, and a probe that could not tell outranks a leak", () => {
  // Several records for one unit is the ORDINARY shape: a crashed earlier attempt sits beside the
  // build running now, and the running one is the answer.
  const both = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "leaked", { pid: 1, ageMs: 9_000_000 }), spawn(REAL_BUILD, "live", { pid: 2, ageMs: 60_000 })],
    marks: null,
    nowMs: NOW,
  });
  assert.equal(both.liveness, "running");
  assert.equal(both.processes[0]?.pid, 2, "newest first — the build happening now heads the list");
  // An unsure probe is not evidence of an ending, so it may not be overtaken by a leak.
  const unsure = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "leaked", { pid: 1 }), spawn(REAL_BUILD, "unknown", { pid: 2 })],
    marks: null,
    nowMs: NOW,
  });
  assert.equal(unsure.liveness, "unknown");
});

// ---------------------------------------------------------------------------
// The budget (D5)
// ---------------------------------------------------------------------------

test("peek-budget-comes-from-the-argv-the-build-was-launched-with, never a read-time default", () => {
  const launched = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn("storytree node build my-unit --real --time-budget 30", "live", { ageMs: 20 * 60_000 })],
    marks: null,
    nowMs: NOW,
  });
  // THE POINT: 30 minutes, not two hours. Showing elapsed against a default the build never had
  // would report room that does not exist.
  assert.deepEqual(launched.budget, { known: true, ms: 30 * 60_000, source: "flag" });
  assert.notEqual(launched.budget.known && launched.budget.ms, DEFAULT_BUILD_BUDGET_MS);
});

test("peek-budget-absent-flag-is-a-reading-of-the-default, and NO record is not a reading at all", () => {
  const defaulted = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "live")],
    marks: null,
    nowMs: NOW,
  });
  assert.deepEqual(defaulted.budget, {
    known: true,
    ms: DEFAULT_BUILD_BUDGET_MS,
    source: "default",
  });
  // With no record there is no budget to report, and none is invented.
  const none = foldBuildPeek({ unitId: "my-unit", spawns: [], marks: null, nowMs: NOW });
  assert.equal(none.budget.known, false);
  assert.match(none.budget.known ? "" : none.budget.why, /not assumed to be the two-hour default/i);
});

test("peek-budget-prefers-the-LIVE-record's-flags-over-an-older-crashed-attempt's", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [
      spawn("storytree node build my-unit --real --time-budget 240", "leaked", { pid: 1, ageMs: 9_000_000 }),
      spawn("storytree node build my-unit --real --time-budget 30", "live", { pid: 2, ageMs: 60_000 }),
    ],
    marks: null,
    nowMs: NOW,
  });
  // "How much room is left" is a question about the build that is RUNNING; the crashed attempt's
  // four hours would answer it with a number belonging to a different run.
  assert.deepEqual(peek.budget, { known: true, ms: 30 * 60_000, source: "flag" });
});

// ---------------------------------------------------------------------------
// Elapsed — and what it is measured from
// ---------------------------------------------------------------------------

test("peek-elapsed-carries-its-anchor: a process start, or a first mark that is only a LOWER BOUND", () => {
  const fromProcess = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "live", { ageMs: 42 * 60_000 })],
    marks: null,
    nowMs: NOW,
  });
  assert.deepEqual(fromProcess.elapsed, { known: true, ms: 42 * 60_000, source: "process" });

  // No record, but a dated mark: the clock anchors on the first phase mark, which excludes
  // resolution, the worktree and the replica. The SOURCE is part of the answer so nothing can read
  // the lower bound as the real wall clock.
  const fromMark = foldBuildPeek({
    unitId: "my-unit",
    spawns: [],
    marks: [mark({ seq: 1, at: "2026-09-21T11:30:00.000Z", phase: "AUTHOR_TEST" })],
    nowMs: NOW,
  });
  assert.deepEqual(fromMark.elapsed, { known: true, ms: 30 * 60_000, source: "first-mark" });

  // Neither anchor: not known, and not silently zero.
  const nothing = foldBuildPeek({ unitId: "my-unit", spawns: [], marks: [], nowMs: NOW });
  assert.equal(nothing.elapsed.known, false);
});

test("peek-elapsed-falls-back-to-the-mark-when-a-record-has-no-parseable-start-time", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "live", { ageMs: null })],
    marks: [mark({ seq: 1, at: "2026-09-21T11:15:00.000Z", phase: "IMPLEMENT" })],
    nowMs: NOW,
  });
  assert.deepEqual(peek.elapsed, { known: true, ms: 45 * 60_000, source: "first-mark" });
});

// ---------------------------------------------------------------------------
// The phase trail
// ---------------------------------------------------------------------------

test("peek-trail-reports-the-LATEST-run-by-seq, and drops marks that name no run", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [],
    marks: [
      mark({ seq: 1, runId: "real-older", phase: "GATE" }),
      // A mark naming no run cannot be attributed to one; folding it in would invent an entry.
      { seq: 5, at: "2026-09-21T11:50:00.000Z", event: "building" },
      mark({ seq: 9, runId: "real-newer", phase: "AUTHOR_TEST", at: "2026-09-21T11:10:00.000Z" }),
      mark({ seq: 10, runId: "real-newer", phase: "CONFIRM_RED", at: "2026-09-21T11:20:00.000Z" }),
    ],
    nowMs: NOW,
  });
  assert.equal(peek.run?.runId, "real-newer");
  assert.deepEqual(peek.run?.marks.map((m) => m.phase), ["AUTHOR_TEST", "CONFIRM_RED"]);
  assert.equal(peek.run?.latest?.phase, "CONFIRM_RED");
});

test("peek-trail-counts-a-RE-ENTERED-phase, which is what an in-build repair looks like from outside", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [],
    marks: [
      mark({ seq: 1, phase: "AUTHOR_TEST" }),
      mark({ seq: 2, phase: "CONFIRM_RED" }),
      mark({ seq: 3, phase: "IMPLEMENT" }),
      mark({ seq: 4, phase: "CONFIRM_GREEN" }),
      mark({ seq: 5, phase: "IMPLEMENT" }),
      mark({ seq: 6, phase: "CONFIRM_GREEN" }),
    ],
    nowMs: NOW,
  });
  assert.deepEqual(peek.run?.reentered, [
    { phase: "IMPLEMENT", times: 2 },
    { phase: "CONFIRM_GREEN", times: 2 },
  ]);
  // A straight walk re-enters nothing — the count must not fire on the ordinary shape.
  const straight = foldBuildPeek({
    unitId: "my-unit",
    spawns: [],
    marks: [mark({ seq: 1, phase: "AUTHOR_TEST" }), mark({ seq: 2, phase: "CONFIRM_RED" })],
    nowMs: NOW,
  });
  assert.deepEqual(straight.run?.reentered, []);
});

test("peek-trail-an-unread-store-is-a-different-fact-from-a-unit-with-no-marks", () => {
  // `null` is the store never read; `[]` is the store read and empty. Collapsing them would let a
  // dead database read as "this unit was never built" — the absence-as-a-zero this repo refuses.
  const unread = foldBuildPeek({ unitId: "my-unit", spawns: [], marks: null, nowMs: NOW });
  assert.equal(unread.storeRead, false);
  assert.equal(unread.run, null);
  const empty = foldBuildPeek({ unitId: "my-unit", spawns: [], marks: [], nowMs: NOW });
  assert.equal(empty.storeRead, true);
  assert.equal(empty.run, null);
  assert.match(renderBuildPeek(unread), /Phase trail: NOT READ/);
  assert.match(renderBuildPeek(empty), /no `building` mark for this unit is in the store/);
});

test("peek-trail-a-run-marked-but-not-yet-phase-stamped-says-so", () => {
  // The opening `building` row is written before resolution even runs, so a run with that row and no
  // phase mark has not entered the walk — which is a real state, not an empty trail.
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [],
    marks: [mark({ seq: 1 })],
    nowMs: NOW,
  });
  assert.equal(peek.run?.runId, "real-abc123");
  assert.deepEqual(peek.run?.marks, []);
  assert.match(renderBuildPeek(peek), /has not entered the walk/);
});

// ---------------------------------------------------------------------------
// The blind spots (D3)
// ---------------------------------------------------------------------------

test("peek-render-always-states-what-it-cannot-see", () => {
  // D3 is the whole reason this is not a normal status read: a signal that silently omits what it
  // cannot see teaches its reader to over-trust it. Every blind spot prints on EVERY render,
  // including the happy one — there is no branch that drops them.
  for (const peek of [
    foldBuildPeek({ unitId: "u", spawns: [spawn("storytree node build u --real", "live")], marks: [mark({ seq: 1, phase: "GATE" })], nowMs: NOW }),
    foldBuildPeek({ unitId: "u", spawns: [], marks: null, nowMs: NOW }),
  ]) {
    const body = renderBuildPeek(peek);
    for (const spot of BUILD_PEEK_BLIND_SPOTS) assert.ok(body.includes(spot), spot);
  }
  // And the two things ADR-0581 D2 asked for that D1 refused to buy are named, not quietly dropped.
  const named = BUILD_PEEK_BLIND_SPOTS.join("\n");
  assert.match(named, /tool calls/);
  assert.match(named, /diff so far/);
});

// ---------------------------------------------------------------------------
// The disagreement fence (D4)
// ---------------------------------------------------------------------------

test("peek-fence-fires-on-RUNNING-alone, because a caveat that always prints warns about nothing", () => {
  const running = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "live", { pid: 88, sessionId: "eager-euler-99" })],
    marks: [mark({ seq: 1, phase: "IMPLEMENT", at: "2026-09-21T11:40:00.000Z" })],
    nowMs: NOW,
  });
  const lines = attemptPolicyPeekCaveat(running).join("\n");
  assert.match(lines, /RUNNING right now/);
  assert.match(lines, /pid 88/);
  assert.match(lines, /eager-euler-99/);
  assert.match(lines, /IMPLEMENT/);
  assert.match(lines, /may be THAT BUILD IN FLIGHT rather than a failure/);

  // `unknown` is the ordinary state of every finished build — a caveat there would print on nearly
  // every read. `ended` is the ledger's count being right. Neither gets a line.
  for (const state of ["unknown", "leaked"] as const) {
    const quiet = foldBuildPeek({
      unitId: "my-unit",
      spawns: state === "leaked" ? [spawn(REAL_BUILD, "leaked")] : [],
      marks: [],
      nowMs: NOW,
    });
    assert.deepEqual(attemptPolicyPeekCaveat(quiet), [], state);
  }
});

test("peek-fence-still-speaks-when-the-store-was-not-read", () => {
  // The registry half needs no database, and the fence is the half that matters most when the store
  // is down: it is what stops a mid-walk build reading as a counted failure.
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "live", { pid: 5 })],
    marks: null,
    nowMs: NOW,
  });
  const lines = attemptPolicyPeekCaveat(peek).join("\n");
  assert.match(lines, /RUNNING right now/);
  assert.match(lines, /no phase mark has been read for it/);
});

// ---------------------------------------------------------------------------
// Render mechanics
// ---------------------------------------------------------------------------

test("peek-render-headline-and-clock-read-as-an-operator-reads-them", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn("storytree node build my-unit --real --time-budget 60", "live", { pid: 7, ageMs: 75 * 60_000 })],
    marks: [mark({ seq: 1, phase: "CONFIRM_GREEN", at: "2026-09-21T11:45:00.000Z" })],
    nowMs: NOW,
  });
  const body = renderBuildPeek(peek);
  assert.match(body, /^RUNNING — "my-unit"/);
  assert.match(body, /elapsed: 1h 15m/);
  assert.match(body, /budget: {2}1h 0m/);
  // Over budget reports the OVERRUN rather than a negative remainder, so the hold half's expiry
  // moment reads correctly the first time.
  assert.match(body, /left: {4}NONE — the budget is spent by 15m\./);
  assert.match(body, /live {4}pid 7/);
});

test("peek-render-shows-the-remaining-clock-when-there-is-any", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn(REAL_BUILD, "live", { ageMs: 30 * 60_000 })],
    marks: [],
    nowMs: NOW,
  });
  assert.match(renderBuildPeek(peek), /left: {4}1h 30m/);
});

test("peek-duration-is-coarse-on-purpose: a wall clock, not a stopwatch", () => {
  assert.equal(formatDurationMs(0), "0m");
  assert.equal(formatDurationMs(59_000), "0m");
  assert.equal(formatDurationMs(60_000), "1m");
  assert.equal(formatDurationMs(60 * 60_000), "1h 0m");
  assert.equal(formatDurationMs(2 * 60 * 60_000 + 5 * 60_000), "2h 5m");
});
