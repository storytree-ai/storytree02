/**
 * The two clocks a Codex leaf spawn runs under, as one PURE unit over an injected clock and an
 * injected kill (ADR-0584 D4).
 *
 * It lives outside `runPinnedCodexCli` for a measured reason: inside that function's promise executor
 * the same logic was reachable only by spawning a real child, so every branch of arming, clearing,
 * suspending and resuming was either untested or tested through a process whose timing the test did
 * not control — the mutation rung named 29 surviving mutants across it. Here each branch is an
 * ordinary function call.
 *
 * - **The BOUND** is the hard wall-clock limit: the build's remaining budget when one is wired, else
 *   the leaf's own per-spawn default. Firing it means the time is gone.
 * - **The SILENCE detector** is optional and catches a child that has stopped saying anything at all,
 *   which is the one thing a wall-clock budget cannot see until the whole budget is spent. Every
 *   chunk of output re-arms it, so SLOW progress is never killed by it (ADR-0581 D2).
 *
 * Exactly one of them is paused while the spine runs a feedback command, and which one is the whole
 * subtlety: with a silence detector armed it is the detector (a proof run produces no child output by
 * design, and the build's wall clock must keep running because a feedback run spends the build's time
 * too); with no detector it is the bound, which is the pre-budget behaviour ADR-0570 D4 built.
 */

/** The clock the bounds run on. `now` is optional so a test clock may declare only the timers. */
export interface SpawnBoundsClock {
  setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimeout(handle: ReturnType<typeof setTimeout>): void;
  now?(): number;
}

/** Which bound killed the child. */
export type SpawnStopReason = "bound" | "silence";

export interface SpawnBoundsArgs {
  clock: SpawnBoundsClock;
  /** The hard wall-clock limit in milliseconds. */
  boundMs: number;
  /** The silence window in milliseconds; omitted, no detector is armed. */
  silenceMs?: number;
  /** Called once, with the reason, when a bound fires. */
  stop: (reason: SpawnStopReason) => void;
}

export interface SpawnBounds {
  /** Output arrived: re-arm the silence detector (a no-op when none is armed). */
  heard(): void;
  /** A feedback run is starting: pause the clock that must not count its time. */
  suspend(): void;
  /** A feedback run has settled: resume what `suspend` paused, from where it left off. */
  resume(): void;
  /** The spawn has settled: release every timer, so none outlives the child it bounded. */
  settle(): void;
}

/**
 * Arm both clocks and return the handle the spawn drives. Arming happens HERE, synchronously, so a
 * caller can never forget it and a test can read both armings immediately.
 */
export function armSpawnBounds(args: SpawnBoundsArgs): SpawnBounds {
  const { clock, silenceMs, stop } = args;
  const now = (): number => clock.now?.() ?? Date.now();

  let boundTimer: ReturnType<typeof setTimeout> | undefined;
  let boundArmedAt = 0;
  let boundRemainingMs = args.boundMs;
  let silenceTimer: ReturnType<typeof setTimeout> | undefined;
  let settled = false;

  const armBound = (ms: number): void => {
    boundArmedAt = now();
    boundRemainingMs = ms;
    boundTimer = clock.setTimeout(() => stop("bound"), ms);
  };
  const clearBound = (): void => {
    if (boundTimer === undefined) return;
    clock.clearTimeout(boundTimer);
    boundTimer = undefined;
  };
  const armSilence = (): void => {
    if (silenceMs === undefined || settled) return;
    silenceTimer = clock.setTimeout(() => stop("silence"), silenceMs);
  };
  const clearSilence = (): void => {
    if (silenceTimer === undefined) return;
    clock.clearTimeout(silenceTimer);
    silenceTimer = undefined;
  };

  armBound(boundRemainingMs);
  armSilence();

  return {
    heard: () => {
      if (settled) return;
      clearSilence();
      armSilence();
    },
    suspend: () => {
      if (settled) return;
      if (silenceMs !== undefined) {
        clearSilence();
        return;
      }
      if (boundTimer === undefined) return;
      // Only the leaf's own elapsed time is charged: what is left is remembered for `resume`.
      boundRemainingMs = Math.max(0, boundRemainingMs - (now() - boundArmedAt));
      clearBound();
    },
    resume: () => {
      if (settled) return;
      if (silenceMs !== undefined) {
        if (silenceTimer !== undefined) return;
        armSilence();
        return;
      }
      if (boundTimer !== undefined) return;
      armBound(boundRemainingMs);
    },
    settle: () => {
      settled = true;
      clearBound();
      clearSilence();
    },
  };
}
