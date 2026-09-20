/**
 * The two clocks a Codex spawn runs under, driven directly (ADR-0584 D4). No child process and no
 * real time: the clock is a list of armings the test fires by hand, so each branch of arming,
 * clearing, suspending, resuming and settling is an ordinary assertion.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { armSpawnBounds } from "./codex-spawn-bounds.js";
import type { SpawnStopReason } from "./codex-spawn-bounds.js";

/** A clock whose timers never fire on their own, recording every arming and clearing. */
/** A real timer handle nothing waits on — the production shape, without a timer that could fire. */
function inertHandle(): ReturnType<typeof setTimeout> {
  const handle = setTimeout(() => undefined, 0);
  clearTimeout(handle);
  return handle;
}

function fakeClock(startAt = 1_000) {
  const armed: Array<{
    ms: number;
    fire: () => void;
    cleared: boolean;
    handle: ReturnType<typeof setTimeout>;
  }> = [];
  let current = startAt;
  /**
   * Every call the bounds make on the clock, in order. A spawn's clock is observable — the leaf's own
   * tests pin "one setTimeout, one clearTimeout" for an unsuspended run — so clearing a timer that is
   * not armed is a call that should not happen, and this log is what says so.
   */
  const calls: string[] = [];
  return {
    armed,
    calls,
    advance: (ms: number) => {
      current += ms;
    },
    /** Fire the most recent LIVE arming (the one a real clock would fire next). */
    fireLatest: () => {
      const live = armed.filter((entry) => !entry.cleared);
      live[live.length - 1]?.fire();
    },
    /**
     * Fire one arming BY INDEX, and only if it is still live — a cleared timer never fires on a real
     * clock, so a fake that fires one would prove something the production clock cannot do.
     */
    fireAt: (index: number) => {
      const entry = armed[index];
      if (entry !== undefined && !entry.cleared) entry.fire();
    },
    live: () => armed.filter((entry) => !entry.cleared).map((entry) => entry.ms),
    clock: {
      setTimeout: (fn: () => void, ms: number) => {
        const handle = inertHandle();
        armed.push({ ms, fire: fn, cleared: false, handle });
        calls.push(`set ${ms}`);
        return handle;
      },
      clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
        const entry = armed.find((candidate) => candidate.handle === handle);
        calls.push(entry === undefined ? "clear UNARMED" : `clear ${entry.ms}`);
        if (entry !== undefined) entry.cleared = true;
      },
      now: () => current,
    },
  };
}

function bounds(clockHolder: ReturnType<typeof fakeClock>, opts: { boundMs: number; silenceMs?: number }) {
  const stops: SpawnStopReason[] = [];
  const args =
    opts.silenceMs === undefined
      ? { clock: clockHolder.clock, boundMs: opts.boundMs, stop: (r: SpawnStopReason) => stops.push(r) }
      : {
          clock: clockHolder.clock,
          boundMs: opts.boundMs,
          silenceMs: opts.silenceMs,
          stop: (r: SpawnStopReason) => stops.push(r),
        };
  return { stops, handle: armSpawnBounds(args) };
}

test("spawn-bounds: arming takes the bound alone when no silence window is asked for", () => {
  const clock = fakeClock();
  bounds(clock, { boundMs: 600_000 });
  assert.deepEqual(
    clock.armed.map((a) => a.ms),
    [600_000],
  );
});

test("spawn-bounds: arming takes the bound FIRST, then the silence window", () => {
  const clock = fakeClock();
  bounds(clock, { boundMs: 3_600_000, silenceMs: 600_000 });
  assert.deepEqual(
    clock.armed.map((a) => a.ms),
    [3_600_000, 600_000],
  );
});

test("spawn-bounds: the bound firing stops with 'bound'; the silence window firing stops with 'silence'", () => {
  const first = fakeClock();
  const a = bounds(first, { boundMs: 3_600_000, silenceMs: 600_000 });
  first.fireAt(0);
  assert.deepEqual(a.stops, ["bound"]);

  const second = fakeClock();
  const b = bounds(second, { boundMs: 3_600_000, silenceMs: 600_000 });
  second.fireAt(1);
  assert.deepEqual(b.stops, ["silence"]);
});

test("spawn-bounds: heard() clears the live silence window and re-arms a fresh one", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 3_600_000, silenceMs: 600_000 });
  b.handle.heard();
  assert.deepEqual(
    clock.armed.map((a) => a.ms),
    [3_600_000, 600_000, 600_000],
    "a third arming — the replacement window",
  );
  assert.equal(clock.armed[1]?.cleared, true, "the window that had been running is cleared");
  // The window heard() replaced can no longer stop anything.
  clock.fireAt(1);
  assert.deepEqual(b.stops, []);
  // The fresh one can.
  clock.fireAt(2);
  assert.deepEqual(b.stops, ["silence"]);
});

test("spawn-bounds: heard() is a no-op when no silence window was asked for — the bound is untouched", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 600_000 });
  b.handle.heard();
  assert.deepEqual(
    clock.armed.map((a) => a.ms),
    [600_000],
    "output does not re-arm a wall-clock bound",
  );
  assert.equal(clock.armed[0]?.cleared, false);
  assert.deepEqual(b.stops, []);
});

test("spawn-bounds: heard() after settle arms nothing, so no timer outlives the child", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 3_600_000, silenceMs: 600_000 });
  b.handle.settle();
  b.handle.heard();
  assert.deepEqual(clock.live(), [], "every timer is released and none is re-armed");
});

test("spawn-bounds: WITH a silence window, suspend pauses the WINDOW and leaves the wall clock running", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 3_600_000, silenceMs: 600_000 });
  b.handle.suspend();
  assert.deepEqual(clock.live(), [3_600_000], "the bound is still live; only the window paused");
  // A feedback run's own silence cannot stop the spawn.
  clock.fireAt(1);
  assert.deepEqual(b.stops, []);
  clock.advance(90_000);
  b.handle.resume();
  assert.deepEqual(
    clock.armed.map((a) => a.ms),
    [3_600_000, 600_000, 600_000],
    "resume gives the window its WHOLE span again, and never re-arms the bound",
  );
});

test("spawn-bounds: WITHOUT a silence window, suspend pauses the bound and resume gives back only what was left", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 600_000 });
  clock.advance(100_000);
  b.handle.suspend();
  assert.deepEqual(clock.live(), [], "the bound is paused");
  clock.advance(5_000_000); // the spine's feedback run: none of it counts
  b.handle.resume();
  assert.deepEqual(
    clock.armed.map((a) => a.ms),
    [600_000, 500_000],
    "only the leaf's own 100s elapsed against the bound",
  );
});

test("spawn-bounds: a paused bound cannot be charged below zero", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 60_000 });
  clock.advance(90_000);
  b.handle.suspend();
  b.handle.resume();
  assert.equal(clock.armed[1]?.ms, 0, "an overrun leaves zero, never a negative span");
});

test("spawn-bounds: a SECOND suspend while already paused must not charge the feedback run's own time", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 600_000 });
  clock.advance(100_000); // the leaf's own time: chargeable
  b.handle.suspend();
  clock.advance(5_000_000); // the spine's feedback run: never chargeable
  b.handle.suspend(); // a second pause (a nested or repeated feedback run)
  b.handle.resume();
  assert.deepEqual(
    clock.armed.map((a) => a.ms),
    [600_000, 500_000],
    "the second suspend charges nothing, so the bound keeps what the first left it",
  );
});

test("spawn-bounds: repeated suspend and repeated resume change nothing", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 600_000, silenceMs: 300_000 });
  b.handle.suspend();
  b.handle.suspend();
  assert.deepEqual(clock.live(), [600_000]);
  b.handle.resume();
  b.handle.resume();
  assert.deepEqual(clock.live(), [600_000, 300_000], "one window, not two");

  const plain = fakeClock();
  const c = bounds(plain, { boundMs: 600_000 });
  c.handle.resume();
  assert.deepEqual(
    plain.armed.map((a) => a.ms),
    [600_000],
    "resume with the bound still live re-arms nothing",
  );
  c.handle.suspend();
  c.handle.suspend();
  assert.deepEqual(plain.live(), []);
});

test("spawn-bounds: suspend and resume after settle do nothing", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 600_000, silenceMs: 300_000 });
  b.handle.settle();
  b.handle.suspend();
  b.handle.resume();
  assert.deepEqual(clock.live(), []);

  const plain = fakeClock();
  const c = bounds(plain, { boundMs: 600_000 });
  c.handle.settle();
  c.handle.resume();
  assert.deepEqual(plain.live(), []);
});

test("spawn-bounds: settle clears exactly what is armed — never a timer that is not", () => {
  // The clock is observable, so an unnecessary clear is a defect, not a harmless no-op.
  const withWindow = fakeClock();
  bounds(withWindow, { boundMs: 3_600_000, silenceMs: 600_000 }).handle.settle();
  assert.deepEqual(withWindow.calls, ["set 3600000", "set 600000", "clear 3600000", "clear 600000"]);

  const plain = fakeClock();
  bounds(plain, { boundMs: 600_000 }).handle.settle();
  assert.deepEqual(plain.calls, ["set 600000", "clear 600000"], "one setTimeout, one clearTimeout");

  // Already settled: nothing is armed, so nothing may be cleared again.
  const twice = fakeClock();
  const b = bounds(twice, { boundMs: 600_000, silenceMs: 300_000 });
  b.handle.settle();
  b.handle.settle();
  assert.deepEqual(twice.calls, ["set 600000", "set 300000", "clear 600000", "clear 300000"]);

  // A suspended bound is already cleared, so settling it clears nothing a second time.
  const suspended = fakeClock();
  const s = bounds(suspended, { boundMs: 600_000 });
  s.handle.suspend();
  s.handle.settle();
  assert.deepEqual(suspended.calls, ["set 600000", "clear 600000"]);
});

test("spawn-bounds: settle releases both clocks, and a released timer stops nothing", () => {
  const clock = fakeClock();
  const b = bounds(clock, { boundMs: 3_600_000, silenceMs: 600_000 });
  b.handle.settle();
  assert.deepEqual(clock.live(), []);
  clock.fireAt(0);
  clock.fireAt(1);
  assert.deepEqual(b.stops, [], "a settled spawn is never stopped by a timer that already fired");
});

test("spawn-bounds: the clock's own `now` is what elapsed time is read from, not the wall clock", () => {
  // A clock that declares no `now()` falls back to Date.now — pinned here so the fallback is not
  // silently dropped: with a frozen fake `now`, no time can pass, and the bound keeps its whole span.
  const armed: number[] = [];
  const handle = armSpawnBounds({
    clock: {
      setTimeout: (_fn: () => void, ms: number) => {
        armed.push(ms);
        return inertHandle();
      },
      clearTimeout: () => undefined,
      now: () => 5_000,
    },
    boundMs: 600_000,
    stop: () => undefined,
  });
  handle.suspend();
  handle.resume();
  assert.deepEqual(armed, [600_000, 600_000], "a frozen clock charges nothing against the bound");
});
