/**
 * The edges the first round of tests did not reach.
 *
 * Written after `check:mutation-diff` seeded faults across every changed line of `build-peek.ts` and
 * reported which of them no assertion noticed. Each case below is one such fault made observable —
 * not coverage for its own sake, but the specific input that separates this code from a wrong
 * version of itself. Where the rung reported a fault that NO input could distinguish, the answer
 * was to delete the branch rather than to write a test here; those removals are commented at their
 * sites in `build-peek.ts`.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { foldBuildPeek, parseRegisteredBuild, type PeekPhaseMark } from "./build-peek.js";
import type { ClassifiedSpawn, SpawnState } from "./spawn-registry.js";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");
const REAL_BUILD = "storytree node build my-unit --real --store pg --increment inc-1";

function spawn(
  command: string,
  state: SpawnState,
  over: { readonly pid?: number; readonly ageMs?: number | null } = {},
): ClassifiedSpawn {
  return {
    record: {
      sessionId: "bold-noether-1234",
      branch: "claude/bold-noether-1234",
      pid: over.pid ?? 4242,
      command,
      cwd: "C:\\wt\\bold-noether-1234",
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

// ---------------------------------------------------------------------------
// Parsing a registered argv
// ---------------------------------------------------------------------------

test("peek-parse-survives-irregular-whitespace-in-a-registered-argv", () => {
  // A registrar writes `storytree ${argv.join(" ")}`, so single spaces are the norm — but the
  // tokeniser must not be the thing that breaks if that stops being true. The DOUBLE space is what
  // makes the `\s+` split load bearing: split on a single `\s`, it would put an EMPTY token between
  // `node` and `build`, and the verb-pair lookup would miss the build entirely.
  assert.deepEqual(parseRegisteredBuild("  storytree  node   build   my-unit   --real  "), {
    unitId: "my-unit",
    route: "node",
    timeBudgetMs: undefined,
  });
});

test("peek-parse-needs-the-VERB-PAIR, not either word on its own", () => {
  // `node` not followed by `build` is a READ verb; `build` not preceded by node/story is somebody
  // else's command. Either half alone would match invocations that are not builds at all — and the
  // registry is mostly not builds, so a loose match is the common case rather than the rare one.
  assert.equal(parseRegisteredBuild("storytree node peek my-unit --real"), null);
  assert.equal(parseRegisteredBuild("pnpm run build my-unit --real"), null);
  // With no verb pair ANYWHERE, a stray `--real` must not be enough on its own — the failure that
  // would otherwise report an unrelated command as a running build of a unit called "gate".
  assert.equal(parseRegisteredBuild("pnpm gate --real"), null);
});

test("peek-parse-reads-the-budget-that-FOLLOWS-the-flag, not a neighbour of it", () => {
  // Reading the token BEFORE the flag finds another flag, which `Number(...)` turns into the same
  // NaN-shaped "unknown" a missing flag produces — so the peek would report an unrecoverable budget
  // for a build whose budget is recorded perfectly well.
  assert.equal(
    parseRegisteredBuild("storytree node build my-unit --time-budget 45 --real")?.timeBudgetMs,
    45 * 60_000,
  );
  assert.equal(
    parseRegisteredBuild("storytree node build my-unit --real --time-budget 45")?.timeBudgetMs,
    45 * 60_000,
  );
});

// ---------------------------------------------------------------------------
// Matching, and which record answers "how much room is left"
// ---------------------------------------------------------------------------

test("peek-matches-ONLY-parseable-builds, so a non-build record is never folded in as one", () => {
  // Every CLI invocation registers, so most of the registry is not builds at all. A record that
  // parses to nothing is skipped, rather than carried into the fold with an empty build beside it.
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [spawn("pnpm gate", "live", { pid: 1 }), spawn("storytree own --all", "live", { pid: 2 })],
    marks: null,
    nowMs: NOW,
  });
  assert.deepEqual(peek.processes, []);
  assert.equal(peek.liveness, "unknown");
  assert.equal(peek.running, null);
});

test("peek-budget-and-elapsed-follow-the-LIVE-row-even-when-it-is-not-the-newest", () => {
  // THE ORDERING THAT SEPARATES "the live one" FROM "the first one", and it is a real shape: a
  // long-running build with a recently-crashed retry of the same unit beside it puts the LEAKED row
  // first, because the list is newest first. Reading `processes[0]` would then answer with the
  // crashed attempt's four hours while the build actually running has thirty minutes — reporting
  // room that does not exist, which is the precise error ADR-0588 D5 exists to prevent.
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [
      spawn("storytree node build my-unit --real --time-budget 30", "live", { pid: 1, ageMs: 90 * 60_000 }),
      spawn("storytree node build my-unit --real --time-budget 240", "leaked", { pid: 2, ageMs: 60_000 }),
    ],
    marks: null,
    nowMs: NOW,
  });
  assert.equal(peek.processes[0]?.pid, 2, "newest first — the crashed retry heads the list");
  assert.deepEqual(peek.budget, { known: true, ms: 30 * 60_000, source: "flag" });
  assert.deepEqual(peek.elapsed, { known: true, ms: 90 * 60_000, source: "process" });
  assert.equal(peek.running?.pid, 1);
});

test("peek-orders-a-record-with-no-start-time-LAST, since it is the one that can say least", () => {
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [
      spawn(REAL_BUILD, "leaked", { pid: 1, ageMs: null }),
      spawn(REAL_BUILD, "leaked", { pid: 2, ageMs: 5 * 60_000 }),
    ],
    marks: null,
    nowMs: NOW,
  });
  assert.deepEqual(peek.processes.map((p) => p.pid), [2, 1]);
});

test("peek-running-is-carried, and is exactly the row livenessReason names", () => {
  // The invariant the D4 fence rests on: `running !== null` exactly when the state is `running`, and
  // it is THE live row rather than one re-found by a second search that could disagree.
  const running = foldBuildPeek({
    unitId: "my-unit",
    spawns: [
      spawn(REAL_BUILD, "leaked", { pid: 1, ageMs: 60_000 }),
      spawn(REAL_BUILD, "live", { pid: 2, ageMs: 90 * 60_000 }),
    ],
    marks: null,
    nowMs: NOW,
  });
  assert.equal(running.liveness, "running");
  assert.equal(running.running?.pid, 2);
  assert.match(running.livenessReason, /pid 2 /);
  for (const state of ["leaked", "unknown"] as const) {
    const other = foldBuildPeek({
      unitId: "my-unit",
      spawns: [spawn(REAL_BUILD, state)],
      marks: null,
      nowMs: NOW,
    });
    assert.equal(other.running, null, state);
    assert.notEqual(other.liveness, "running", state);
  }
});

// ---------------------------------------------------------------------------
// The trail
// ---------------------------------------------------------------------------

test("peek-elapsed-is-unknown-when-the-only-anchor-is-an-UNPARSEABLE-date", () => {
  // A mark whose `at` is not a date anchors nothing, and the clock must say so rather than measure
  // from NaN — which renders as a wildly wrong duration carrying no hint that it is wrong.
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [],
    marks: [mark({ seq: 1, at: "not-a-date", phase: "IMPLEMENT" })],
    nowMs: NOW,
  });
  assert.equal(peek.elapsed.known, false);
});

test("peek-trail-takes-BUILDING-marks-that-name-a-run, and nothing else", () => {
  // Three rejects, each for its own reason: a lifecycle word that is not `building`; a `building`
  // row naming no run; and — the one that matters — a `retired` row that DOES name a run, which a
  // filter testing only for a run id would fold straight into the trail.
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [],
    marks: [
      mark({ seq: 1, event: "proposed" }),
      { seq: 2, at: "2026-09-21T11:01:00.000Z", event: "building" },
      mark({ seq: 3, event: "retired" }),
    ],
    nowMs: NOW,
  });
  assert.equal(peek.run, null);
  assert.equal(peek.storeRead, true, "the store WAS read — an empty trail is not an unread one");
});

test("peek-trail-orders-by-SEQ-and-not-by-arrival, both when picking the run and within it", () => {
  // The store's own total order is `seq`; the array arrives in whatever order the read returned.
  // Fed backwards, the trail must still name the newest run and read oldest-first inside it.
  const peek = foldBuildPeek({
    unitId: "my-unit",
    spawns: [],
    marks: [
      mark({ seq: 12, runId: "real-newer", phase: "IMPLEMENT", at: "2026-09-21T11:30:00.000Z" }),
      mark({ seq: 10, runId: "real-newer", phase: "AUTHOR_TEST", at: "2026-09-21T11:10:00.000Z" }),
      mark({ seq: 11, runId: "real-newer", phase: "CONFIRM_RED", at: "2026-09-21T11:20:00.000Z" }),
      mark({ seq: 3, runId: "real-older", phase: "GATE", at: "2026-09-21T10:00:00.000Z" }),
    ],
    nowMs: NOW,
  });
  assert.equal(peek.run?.runId, "real-newer");
  assert.deepEqual(peek.run?.marks.map((m) => m.phase), ["AUTHOR_TEST", "CONFIRM_RED", "IMPLEMENT"]);
  // `startedAt` is the run's EARLIEST mark by seq — the anchor elapsed is then measured from, so
  // taking the wrong end of the trail would silently halve or double every reported duration.
  assert.equal(peek.run?.startedAt, "2026-09-21T11:10:00.000Z");
  assert.equal(peek.run?.latest?.phase, "IMPLEMENT");
});
