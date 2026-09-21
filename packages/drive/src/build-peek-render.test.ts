/**
 * The peek's RENDER, pinned whole — one golden per render SHAPE.
 *
 * ## Why goldens and not probes
 *
 * Every prose word, column label and separator in a render is its own mutant under
 * `check:mutation-diff`, which reds on a single survivor. An `assert.match(body, /RUNNING/)` kills
 * the one word it quotes and leaves every other literal standing; pinning the whole body kills the
 * class at once. That is the cheap win, and reaching for probes instead is measured to cost about
 * half a session (`mutation-rung-charges-render-prose`).
 *
 * ## They are deliberately brittle, and that is the point
 *
 * This render is an OBSERVABILITY read whose whole value is that a tired operator believes exactly
 * what it says and no more. ADR-0588 D3 makes naming the blind spots part of the contract rather
 * than a courtesy, so "the wording drifted" is precisely the failure that must not pass silently —
 * a blind spot quietly dropped from this list leaves a reader trusting a completeness the read
 * never had. Changing any line below is meant to fail here and be re-read, not repaired by
 * loosening the assertion.
 *
 * Captured by running the fold, never transcribed by hand.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  attemptPolicyPeekCaveat,
  foldBuildPeek,
  renderBuildPeek,
  type BuildPeekInput,
  type PeekPhaseMark,
} from "./build-peek.js";
import type { ClassifiedSpawn, SpawnState } from "./spawn-registry.js";

const NOW = Date.parse("2026-09-21T12:00:00.000Z");

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

function mark(seq: number, phase?: string, at = "2026-09-21T11:05:00.000Z"): PeekPhaseMark {
  const base: PeekPhaseMark = { seq, at, event: "building", runId: "real-abc123" };
  return phase === undefined ? base : { ...base, phase };
}

const REAL = "storytree node build my-unit --real --store pg --time-budget 30";

/** Every render SHAPE. A shape left unpinned keeps its whole literal set alive. */
const SHAPES = {
  RUNNING_WITH_TRAIL: {
    unitId: "my-unit",
    spawns: [spawn(REAL, "live", { pid: 4242 })],
    marks: [
      mark(1),
      mark(2, "AUTHOR_TEST", "2026-09-21T11:05:00.000Z"),
      mark(3, "CONFIRM_RED", "2026-09-21T11:20:00.000Z"),
      mark(4, "IMPLEMENT", "2026-09-21T11:30:00.000Z"),
      mark(5, "CONFIRM_GREEN", "2026-09-21T11:45:00.000Z"),
      mark(6, "IMPLEMENT", "2026-09-21T11:50:00.000Z"),
    ],
    nowMs: NOW,
  },
  ENDED_LEAKED: {
    unitId: "my-unit",
    spawns: [spawn("storytree node build my-unit --real", "leaked", { pid: 777, ageMs: null })],
    marks: [mark(1, "AUTHOR_TEST")],
    nowMs: NOW,
  },
  UNKNOWN_NO_RECORD_STORE_READ: { unitId: "my-unit", spawns: [], marks: [], nowMs: NOW },
  UNKNOWN_STORE_NOT_READ: { unitId: "my-unit", spawns: [], marks: null, nowMs: NOW },
  BUDGET_EXACTLY_SPENT: {
    unitId: "my-unit",
    spawns: [
      spawn("storytree node build my-unit --real --time-budget 60", "live", {
        pid: 9,
        ageMs: 60 * 60_000,
      }),
    ],
    marks: [mark(1, "IMPLEMENT", "2026-09-21T11:30:00.000Z")],
    nowMs: NOW,
  },
  BUDGET_KNOWN_CLOCK_UNKNOWN: {
    unitId: "my-unit",
    spawns: [spawn("storytree node build my-unit --real", "leaked", { pid: 8, ageMs: null })],
    marks: [],
    nowMs: NOW,
  },
  TWO_REENTERED_PHASES: {
    unitId: "my-unit",
    spawns: [],
    marks: [
      mark(1, "AUTHOR_TEST", "2026-09-21T11:00:00.000Z"),
      mark(2, "CONFIRM_RED", "2026-09-21T11:05:00.000Z"),
      mark(3, "IMPLEMENT", "2026-09-21T11:10:00.000Z"),
      mark(4, "CONFIRM_GREEN", "2026-09-21T11:20:00.000Z"),
      mark(5, "IMPLEMENT", "2026-09-21T11:25:00.000Z"),
      mark(6, "CONFIRM_GREEN", "2026-09-21T11:35:00.000Z"),
      mark(7, "CONFIRM_RED", "2026-09-21T11:40:00.000Z"),
    ],
    nowMs: NOW,
  },
  UNKNOWN_PROBE_RUN_NOT_STAMPED: {
    unitId: "my-unit",
    spawns: [spawn(REAL, "unknown", { pid: 31 })],
    marks: [mark(1)],
    nowMs: NOW,
  },
} satisfies Record<string, BuildPeekInput>;

test("peek-render-RUNNING: the live process, the clock against the launched budget, the trail and its re-entry", () => {
  // The shape the orchestrator actually reads at expiry. It carries almost every branch at
  // once — a live row, a budget recovered from the argv, an overrun, a re-entered phase — so
  // this is the densest of the eight.
  const peek = foldBuildPeek(SHAPES.RUNNING_WITH_TRAIL);
  assert.equal(renderBuildPeek(peek), `RUNNING — "my-unit"

  pid 4242 is alive on this machine, running \`storytree node build my-unit --real --store pg --time-budget 30\` (session bold-noether-1234).

Wall clock:
  elapsed: 1h 0m (measured from the registered process start — the same clock the budget bounds)
  budget:  30m (as launched, from \`--time-budget\` in the registered argv)
  left:    NONE — the budget is spent by 30m.

Phase trail — run real-abc123, started 2026-09-21T11:05:00.000Z:
  2026-09-21T11:05:00.000Z  AUTHOR_TEST
  2026-09-21T11:20:00.000Z  CONFIRM_RED
  2026-09-21T11:30:00.000Z  IMPLEMENT
  2026-09-21T11:45:00.000Z  CONFIRM_GREEN
  2026-09-21T11:50:00.000Z  IMPLEMENT

  now in: IMPLEMENT, entered 2026-09-21T11:50:00.000Z

  RE-ENTERED: IMPLEMENT x2. The marks append, so the walk went backwards — which since ADR-0582
  is what an in-build repair looks like from outside. The trail records transitions and never
  says why one happened, so this is a re-entry count and not a repair count.

Registered build process(es) on this machine:
  live    pid 4242  started 1h 0m ago  session bold-noether-1234  claude/bold-noether-1234
          storytree node build my-unit --real --store pg --time-budget 30

WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:
  · the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)
  · its feedback runs (\`run_proof\` / \`run_typecheck\` and what \`worker-can-run-the-existing-tests\` adds) — those are never persisted anywhere; only the final build envelope renders them
  · the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree
  · any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census
  · a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all
  · a chain member under \`story build\` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)`);
  assert.deepEqual(attemptPolicyPeekCaveat(peek), ["", "⚠ A `--real` build of \"my-unit\" is RUNNING right now, as pid 4242 (session bold-noether-1234) — its latest phase mark is IMPLEMENT, entered 2026-09-21T11:50:00.000Z.", "", "So the unsigned attempt counted above may be THAT BUILD IN FLIGHT rather than a failure. The", "ledger appends its `attempt` row before the walk starts (ADR-0576 D5) and clears it only on a", "later signed pass, which is why a mid-walk build and a failed one read identically here. The", "attempt policy is not wrong — it has no in-progress state to give — but do not spend a decision", "point on this count until the run ends.", "", "  storytree node peek my-unit --pg"]);
});

test("peek-render-ENDED: a crashed build, with the clock recovered from the trail instead", () => {
  // A leaked record has no parseable age, so elapsed falls back to the first mark and the
  // budget is the DEFAULT read off an argv carrying no flag — two different recoveries at once.
  const peek = foldBuildPeek(SHAPES.ENDED_LEAKED);
  assert.equal(renderBuildPeek(peek), `ENDED — "my-unit"

  pid 777's record survives but the process is gone, and it never de-registered — so that build was killed or it crashed rather than finishing.

Wall clock:
  elapsed: 55m (measured from the run's FIRST PHASE MARK, so it is a LOWER BOUND: resolution, the worktree and the replica are all before it)
  budget:  2h 0m (the spine's default — the registered argv carries no \`--time-budget\`)
  left:    1h 5m

Phase trail — run real-abc123, started 2026-09-21T11:05:00.000Z:
  2026-09-21T11:05:00.000Z  AUTHOR_TEST

  now in: AUTHOR_TEST, entered 2026-09-21T11:05:00.000Z

Registered build process(es) on this machine:
  leaked  pid 777  age unknown  session bold-noether-1234  claude/bold-noether-1234
          storytree node build my-unit --real

WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:
  · the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)
  · its feedback runs (\`run_proof\` / \`run_typecheck\` and what \`worker-can-run-the-existing-tests\` adds) — those are never persisted anywhere; only the final build envelope renders them
  · the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree
  · any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census
  · a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all
  · a chain member under \`story build\` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)`);
  assert.deepEqual(attemptPolicyPeekCaveat(peek), []);
});

test("peek-render-UNKNOWN: no record and no marks, with both absences named separately", () => {
  // The store WAS read and holds nothing; no registry record names the build. Two different
  // absences, and the whole risk here is that they render alike.
  const peek = foldBuildPeek(SHAPES.UNKNOWN_NO_RECORD_STORE_READ);
  assert.equal(renderBuildPeek(peek), `UNKNOWN — "my-unit"

  no registered \`--real\` build of this unit is on this machine. That is three different things at once and this read cannot separate them: the build FINISHED and removed its own record; it is running on ANOTHER machine, whose registry is not visible from here; or it was launched from the primary checkout, which derives no session identity and so registers nothing at all.

Wall clock:
  elapsed: not known — neither a registry record nor a dated phase mark is available, so nothing anchors the clock.
  budget:  not known — no registry record names this build, so the budget it was launched with is not recoverable. It is NOT assumed to be the two-hour default: a peek reporting room that does not exist is wrong in the direction that matters (ADR-0588 D5).

Phase trail: no \`building\` mark for this unit is in the store.
  A dry run proves nothing and persists nothing (ADR-0060), and a \`--real\` build without
  \`--store pg\` writes no marks either — so this is not evidence the unit was never built.

WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:
  · the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)
  · its feedback runs (\`run_proof\` / \`run_typecheck\` and what \`worker-can-run-the-existing-tests\` adds) — those are never persisted anywhere; only the final build envelope renders them
  · the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree
  · any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census
  · a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all
  · a chain member under \`story build\` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)`);
  assert.deepEqual(attemptPolicyPeekCaveat(peek), []);
});

test("peek-render-NO-STORE: the narrowed answer, which says what it did not read", () => {
  // The registry half with no database at all — the shape that makes this verb worth having
  // when the store is down, and whose trail line must never read as an empty trail.
  const peek = foldBuildPeek(SHAPES.UNKNOWN_STORE_NOT_READ);
  assert.equal(renderBuildPeek(peek), `UNKNOWN — "my-unit"

  no registered \`--real\` build of this unit is on this machine. That is three different things at once and this read cannot separate them: the build FINISHED and removed its own record; it is running on ANOTHER machine, whose registry is not visible from here; or it was launched from the primary checkout, which derives no session identity and so registers nothing at all.

Wall clock:
  elapsed: not known — neither a registry record nor a dated phase mark is available, so nothing anchors the clock.
  budget:  not known — no registry record names this build, so the budget it was launched with is not recoverable. It is NOT assumed to be the two-hour default: a peek reporting room that does not exist is wrong in the direction that matters (ADR-0588 D5).

Phase trail: NOT READ — this ran without the live store, so only the process half above is
  answered. That is deliberate rather than a degradation: a peek that still says something
  useful when the store is unreachable is worth more than one that refuses. Rerun with --pg
  for the phase the worker is actually in.

WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:
  · the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)
  · its feedback runs (\`run_proof\` / \`run_typecheck\` and what \`worker-can-run-the-existing-tests\` adds) — those are never persisted anywhere; only the final build envelope renders them
  · the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree
  · any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census
  · a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all
  · a chain member under \`story build\` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)`);
  assert.deepEqual(attemptPolicyPeekCaveat(peek), []);
});

test("peek-render-BUDGET-EXACTLY-SPENT: zero remaining is NONE, never a remainder of zero", () => {
  // The boundary the HOLD half of this increment will fire on, so it is pinned before that
  // work rather than after: `left <= 0`, not `< 0`. A budget spent to the second has no room
  // left, and rendering it as `left: 0m` would read as room.
  const peek = foldBuildPeek(SHAPES.BUDGET_EXACTLY_SPENT);
  assert.equal(renderBuildPeek(peek), `RUNNING — "my-unit"

  pid 9 is alive on this machine, running \`storytree node build my-unit --real --time-budget 60\` (session bold-noether-1234).

Wall clock:
  elapsed: 1h 0m (measured from the registered process start — the same clock the budget bounds)
  budget:  1h 0m (as launched, from \`--time-budget\` in the registered argv)
  left:    NONE — the budget is spent by 0m.

Phase trail — run real-abc123, started 2026-09-21T11:30:00.000Z:
  2026-09-21T11:30:00.000Z  IMPLEMENT

  now in: IMPLEMENT, entered 2026-09-21T11:30:00.000Z

Registered build process(es) on this machine:
  live    pid 9  started 1h 0m ago  session bold-noether-1234  claude/bold-noether-1234
          storytree node build my-unit --real --time-budget 60

WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:
  · the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)
  · its feedback runs (\`run_proof\` / \`run_typecheck\` and what \`worker-can-run-the-existing-tests\` adds) — those are never persisted anywhere; only the final build envelope renders them
  · the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree
  · any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census
  · a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all
  · a chain member under \`story build\` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)`);
  assert.deepEqual(attemptPolicyPeekCaveat(peek), ["", "⚠ A `--real` build of \"my-unit\" is RUNNING right now, as pid 9 (session bold-noether-1234) — its latest phase mark is IMPLEMENT, entered 2026-09-21T11:30:00.000Z.", "", "So the unsigned attempt counted above may be THAT BUILD IN FLIGHT rather than a failure. The", "ledger appends its `attempt` row before the walk starts (ADR-0576 D5) and clears it only on a", "later signed pass, which is why a mid-walk build and a failed one read identically here. The", "attempt policy is not wrong — it has no in-progress state to give — but do not spend a decision", "point on this count until the run ends.", "", "  storytree node peek my-unit --pg"]);
});

test("peek-render-BUDGET-WITHOUT-A-CLOCK: a budget is reported, a remainder is not", () => {
  // A crashed record with no parseable start time and no marks. The argv still says what the
  // build was launched with, but nothing anchors elapsed — so there is no remainder to
  // compute, and computing one anyway would subtract from `undefined` and render NaN.
  const peek = foldBuildPeek(SHAPES.BUDGET_KNOWN_CLOCK_UNKNOWN);
  assert.equal(renderBuildPeek(peek), `ENDED — "my-unit"

  pid 8's record survives but the process is gone, and it never de-registered — so that build was killed or it crashed rather than finishing.

Wall clock:
  elapsed: not known — neither a registry record nor a dated phase mark is available, so nothing anchors the clock.
  budget:  2h 0m (the spine's default — the registered argv carries no \`--time-budget\`)

Phase trail: no \`building\` mark for this unit is in the store.
  A dry run proves nothing and persists nothing (ADR-0060), and a \`--real\` build without
  \`--store pg\` writes no marks either — so this is not evidence the unit was never built.

Registered build process(es) on this machine:
  leaked  pid 8  age unknown  session bold-noether-1234  claude/bold-noether-1234
          storytree node build my-unit --real

WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:
  · the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)
  · its feedback runs (\`run_proof\` / \`run_typecheck\` and what \`worker-can-run-the-existing-tests\` adds) — those are never persisted anywhere; only the final build envelope renders them
  · the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree
  · any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census
  · a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all
  · a chain member under \`story build\` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)`);
  assert.deepEqual(attemptPolicyPeekCaveat(peek), []);
});

test("peek-render-TWO-RE-ENTRIES: both named, separated, in trail order", () => {
  // One re-entry cannot show whether the list joins correctly; two can. The order follows
  // first appearance in the trail, which is what lets a reader line the summary up against
  // the rows above it.
  const peek = foldBuildPeek(SHAPES.TWO_REENTERED_PHASES);
  assert.equal(renderBuildPeek(peek), `UNKNOWN — "my-unit"

  no registered \`--real\` build of this unit is on this machine. That is three different things at once and this read cannot separate them: the build FINISHED and removed its own record; it is running on ANOTHER machine, whose registry is not visible from here; or it was launched from the primary checkout, which derives no session identity and so registers nothing at all.

Wall clock:
  elapsed: 1h 0m (measured from the run's FIRST PHASE MARK, so it is a LOWER BOUND: resolution, the worktree and the replica are all before it)
  budget:  not known — no registry record names this build, so the budget it was launched with is not recoverable. It is NOT assumed to be the two-hour default: a peek reporting room that does not exist is wrong in the direction that matters (ADR-0588 D5).

Phase trail — run real-abc123, started 2026-09-21T11:00:00.000Z:
  2026-09-21T11:00:00.000Z  AUTHOR_TEST
  2026-09-21T11:05:00.000Z  CONFIRM_RED
  2026-09-21T11:10:00.000Z  IMPLEMENT
  2026-09-21T11:20:00.000Z  CONFIRM_GREEN
  2026-09-21T11:25:00.000Z  IMPLEMENT
  2026-09-21T11:35:00.000Z  CONFIRM_GREEN
  2026-09-21T11:40:00.000Z  CONFIRM_RED

  now in: CONFIRM_RED, entered 2026-09-21T11:40:00.000Z

  RE-ENTERED: CONFIRM_RED x2, IMPLEMENT x2, CONFIRM_GREEN x2. The marks append, so the walk went backwards — which since ADR-0582
  is what an in-build repair looks like from outside. The trail records transitions and never
  says why one happened, so this is a re-entry count and not a repair count.

WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:
  · the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)
  · its feedback runs (\`run_proof\` / \`run_typecheck\` and what \`worker-can-run-the-existing-tests\` adds) — those are never persisted anywhere; only the final build envelope renders them
  · the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree
  · any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census
  · a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all
  · a chain member under \`story build\` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)`);
  assert.deepEqual(attemptPolicyPeekCaveat(peek), []);
});

test("peek-render-UNSURE-PROBE: a run marked but not phase-stamped, under a probe that could not tell", () => {
  // Two states no happy-path fixture reaches: a liveness probe that answered neither yes nor
  // no, and a run whose opening mark is written but which has not entered the walk.
  const peek = foldBuildPeek(SHAPES.UNKNOWN_PROBE_RUN_NOT_STAMPED);
  assert.equal(renderBuildPeek(peek), `UNKNOWN — "my-unit"

  a record for pid 31 exists, but the liveness probe could not tell whether that process is running. A probe that could not answer is not one that said no.

Wall clock:
  elapsed: 1h 0m (measured from the registered process start — the same clock the budget bounds)
  budget:  30m (as launched, from \`--time-budget\` in the registered argv)
  left:    NONE — the budget is spent by 30m.

Phase trail — run real-abc123, started 2026-09-21T11:05:00.000Z:
  the run is marked but no phase has been stamped yet — it has not entered the walk.

Registered build process(es) on this machine:
  unknown pid 31  started 1h 0m ago  session bold-noether-1234  claude/bold-noether-1234
          storytree node build my-unit --real --store pg --time-budget 30

WHAT THIS READ CANNOT SEE — stated so it is not mistaken for completeness:
  · the worker's tool calls and the files it has touched — they live in the authoring process's own memory and are flushed ONCE, after the walk, so nothing about the slice in flight is readable from outside it (ADR-0588 D1)
  · its feedback runs (\`run_proof\` / \`run_typecheck\` and what \`worker-can-run-the-existing-tests\` adds) — those are never persisted anywhere; only the final build envelope renders them
  · the diff so far — the build's worktree is an OS-random temp path and no event records it, so there is no join from a run id to a working tree
  · any build on ANOTHER machine — the spawn registry is per-user and per-machine (the same cost ADR-0571 D2 accepted), so this is a floor on what is running, never a census
  · a build launched from the PRIMARY CHECKOUT — it derives no session identity and so registers nothing at all
  · a chain member under \`story build\` — the registered argv names the STORY, so a member reads as unmatched even while it is being built (the story-versus-member keying of ADR-0576 D7)`);
  assert.deepEqual(attemptPolicyPeekCaveat(peek), []);
});
