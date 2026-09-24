// @vitest-environment jsdom
//
// act2Intro — the CLOCK half of the Act 2 player: the speed dial (ADR-0286) and the plan hold that
// lets a run survive the studio's cached-then-confirmed tree payload.
//
// Split from `act2Intro.test.ts` because these need a React renderer and a jsdom window; that file
// stays pure node-env arithmetic. The clock is driven by an INJECTED `Act2IntroClock`, so a run is
// a deterministic sequence of timestamps rather than a wait on real rAF — the same seam the
// player's own `clock` option exists for.

import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useAct2Intro, useStableForestRegrowLayer, type Act2IntroClock } from './act2Intro.js';
import type { ForestRegrowState, ForestRegrowStory, ForestRegrowTrailEdge } from '@storytree/app-surface';

afterEach(cleanup);

const GRAPH: readonly ForestRegrowStory[] = [
  { id: 'a', dependsOn: [] },
  { id: 'b', dependsOn: ['a'] },
  { id: 'c', dependsOn: ['b'] },
];

const EDGES: readonly ForestRegrowTrailEdge[] = [
  { from: 'a', to: 'b', segments: [{ id: 's1' }] },
  { from: 'b', to: 'c', segments: [{ id: 's2' }] },
];

/**
 * A hand-cranked rAF over a hand-cranked wall clock. `advance(ms)` moves time on and delivers ONE
 * frame there; `elapse(ms)` delivers as many frames as it takes to cover that span; `idle(ms)`
 * moves time on and delivers NO frame at all.
 *
 * `idle` is what an unwatched run looks like: a hidden or occluded window keeps accruing wall-clock
 * time while the browser delivers no frames to it, and so does a map route that has been parked.
 * Both are the ADR-0469 case, and neither is reproducible with `advance` — a test that only ever
 * moves time by delivering frames can never observe a cursor that stopped because the frames did.
 */
const MAX_FRAME_MS = 250;

interface ManualClockResult {
  clock: Act2IntroClock;
  advance: (ms: number) => void;
  elapse: (ms: number) => void;
  idle: (ms: number) => void;
}

function manualClock(): ManualClockResult {
  let next: ((t: number) => void) | null = null;
  let now = 0;
  const advance = (ms: number): void => {
    now += ms;
    const cb = next;
    next = null;
    if (cb) act(() => cb(now));
  };
  return {
    clock: {
      requestFrame: (callback) => {
        next = callback;
        return 1;
      },
      cancelFrame: () => {
        next = null;
      },
      now: () => now,
    },
    advance,
    elapse: (ms: number) => {
      let left = ms;
      while (left > 1e-9) {
        const step = Math.min(left, MAX_FRAME_MS);
        advance(step);
        left -= step;
      }
    },
    idle: (ms: number) => {
      now += ms;
    },
  };
}

/** Play at `speed` for `elapsedMs` of wall clock and report where the cursor landed. */
function runFor(speed: number | undefined, elapsedMs: number): number {
  const { clock, advance, elapse } = manualClock();
  // `speed` is a READONLY optional on the hook's options, so it cannot be assigned after the fact —
  // base-plus-ternary on the whole object keeps it omitted (never `undefined`) when unset.
  const options: Parameters<typeof useAct2Intro>[0] =
    speed === undefined
      ? { enabled: true, stories: GRAPH, edges: EDGES, clock }
      : { enabled: true, stories: GRAPH, edges: EDGES, speed, clock };
  const { result } = renderHook(() => useAct2Intro(options));
  act(() => result.current.replay());
  // The first frame seeds `previous` (it cannot know an elapsed time yet), so it advances by the
  // 1/60 s the player assumes; every frame after it is real elapsed time.
  advance(0);
  elapse(elapsedMs);
  return result.current.progress;
}

describe('the regrow speed dial (ADR-0286)', () => {
  it('crosses the plan in its own duration at 1x', () => {
    const { clock, advance, elapse } = manualClock();
    const { result } = renderHook(() =>
      useAct2Intro({ enabled: true, stories: GRAPH, edges: EDGES, speed: 1, clock }),
    );
    const durationMs = result.current.plan!.durationMs;
    act(() => result.current.replay());
    advance(0);
    elapse(durationMs / 2);
    // Half the plan's duration ⇒ half way, give or take the seed frame.
    expect(result.current.progress).toBeGreaterThan(0.49);
    expect(result.current.progress).toBeLessThan(0.53);

    elapse(durationMs / 2);
    expect(result.current.progress).toBe(1);
    expect(result.current.playing, 'a finished run stops itself').toBe(false);
  });

  it('stretches the run below 1x and compresses it above — proportionally', () => {
    const span = 900;
    const half = runFor(0.5, span);
    const one = runFor(1, span);
    const two = runFor(2, span);
    // Same elapsed time, so the cursor travels in proportion to the dial. Compared as RATIOS so
    // the assertion says "0.5x is half as far", not "0.5x reached some magic number".
    expect(half / one).toBeCloseTo(0.5, 2);
    expect(two / one).toBeCloseTo(2, 2);
  });

  it('defaults to the plan’s own pace, and refuses a speed that would stall or reverse it', () => {
    const baseline = runFor(1, 900);
    expect(runFor(undefined, 900)).toBeCloseTo(baseline, 6);
    // A URL can carry anything. None of these may leave the cursor stuck or running backwards.
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(runFor(bad, 900), `speed ${bad}`).toBeCloseTo(baseline, 6);
    }
  });

  it('scales the CLOCK, not the schedule — every island forms at the same fraction of the run', () => {
    const planAt = (speed: number): readonly (readonly [string, number])[] => {
      const { result } = renderHook(() =>
        useAct2Intro({ enabled: true, stories: GRAPH, edges: EDGES, speed }),
      );
      const steps = result.current.plan!.steps.map((s) => [s.storyId, s.start] as const);
      cleanup();
      return steps;
    };
    // ADR-0285's causal invariant is about WHERE in the run an island forms. A speed that
    // re-derived the plan could move that; a speed that scales elapsed time cannot.
    expect(planAt(0.25)).toEqual(planAt(2));
  });
});

// ── ADR-0286: a pending first arrival opens on NOTHING ──
//
// The caller cannot start a run until the scene exists to regrow it, so without this the render
// that first has a scene COMMITS the whole settled forest — the most expensive paint on the surface
// — one frame before the effect rewinds it. The intro would open with a flash of its own ending.
describe('the cursor a fresh plan opens on', () => {
  it('rests on the settled forest by default', () => {
    const { result } = renderHook(() => useAct2Intro({ enabled: true, stories: GRAPH, edges: EDGES }));
    expect(result.current.progress).toBe(1);
    expect(result.current.regrowing).toBe(false);
    expect(result.current.state!.presentStoryIds.size, 'the whole forest is on the map').toBe(GRAPH.length);
  });

  it('opens on nothing while a start is pending — no frame of the grown forest', () => {
    const { result } = renderHook(() =>
      useAct2Intro({ enabled: true, stories: GRAPH, edges: EDGES, pendingStart: true }),
    );
    expect(result.current.progress).toBe(0);
    expect(result.current.regrowing).toBe(true);
    expect(result.current.state!.presentStoryIds.size, 'nothing is on the map yet').toBe(0);
    expect(result.current.state!.absentStoryIds.size).toBe(GRAPH.length);
  });

  it('opens the FIRST arriving plan on nothing too — the case that actually flashed', () => {
    // The real sequence: the component mounts before the tree does, so the plan is null for a
    // render or two and only then appears. That is the plan whose opening cursor matters.
    const { result, rerender } = renderHook(
      ({ stories }: { stories: readonly ForestRegrowStory[] | null }) =>
        useAct2Intro({ enabled: true, stories, edges: EDGES, pendingStart: true }),
      { initialProps: { stories: null as readonly ForestRegrowStory[] | null } },
    );
    expect(result.current.plan).toBeNull();
    rerender({ stories: GRAPH });
    expect(result.current.plan).not.toBeNull();
    expect(result.current.progress).toBe(0);
    expect(result.current.state!.presentStoryIds.size).toBe(0);
  });
});

describe('the plan survives a re-fetch of the same graph', () => {
  it('keeps the cursor running when an identical story array arrives', () => {
    const { clock, advance, elapse } = manualClock();
    const { result, rerender } = renderHook(
      ({ stories }: { stories: readonly ForestRegrowStory[] }) =>
        useAct2Intro({ enabled: true, stories, edges: EDGES, speed: 1, clock }),
      { initialProps: { stories: GRAPH } },
    );
    const first = result.current.plan;
    act(() => result.current.replay());
    advance(0);
    elapse(result.current.plan!.durationMs / 4);
    const midRun = result.current.progress;
    expect(midRun).toBeGreaterThan(0.2);

    // The `/api/tree` confirm landing: same graph, brand new arrays (ADR-0240's cached-then-
    // confirmed paint). Before ADR-0286 this reset the cursor to 1 and the intro simply stopped.
    rerender({ stories: GRAPH.map((s) => ({ id: s.id, dependsOn: [...s.dependsOn] })) });
    expect(result.current.plan, 'the same plan object, not a rebuild').toBe(first);
    expect(result.current.progress).toBe(midRun);
    expect(result.current.playing).toBe(true);

    elapse(result.current.plan!.durationMs / 4);
    expect(result.current.progress).toBeGreaterThan(midRun);
  });

  it('still invalidates the cursor when the graph really changes', () => {
    const { clock, advance, elapse } = manualClock();
    const { result, rerender } = renderHook(
      ({ stories }: { stories: readonly ForestRegrowStory[] }) =>
        useAct2Intro({ enabled: true, stories, edges: EDGES, speed: 1, clock }),
      { initialProps: { stories: GRAPH } },
    );
    act(() => result.current.replay());
    advance(0);
    elapse(result.current.plan!.durationMs / 4);
    expect(result.current.progress).toBeGreaterThan(0.2);

    // A story really did appear. The cursor now points into a schedule that no longer exists, so
    // it settles rather than carrying on against the wrong plan.
    rerender({ stories: [...GRAPH, { id: 'd', dependsOn: ['c'] }] });
    expect(result.current.progress).toBe(1);
    expect(result.current.playing).toBe(false);
  });
});

// ── ADR-0469: a run survives being unwatched ──
//
// The cursor is a function of elapsed wall-clock time since the run's anchor, not a sum of the
// deltas between frames that happened to be delivered. Everything below is one claim seen from
// four sides: a gap in frame delivery is not a gap in the run.
//
// Both defects this replaces were measured at this hook. An occluded window used to `setPlaying`
// false on `visibilitychange` and nothing ever set it back — a run at 25.4% read 25.4% forever.
// A parked map route used to drop the plan, which reset the cursor to the settled forest — the
// same run came back at 1.0, having never been seen to finish.

/** Flip `document.hidden` and fire the event a browser fires with it. */
function occlude(hidden: boolean): void {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (hidden ? 'hidden' : 'visible'),
  });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('a run survives being unwatched (ADR-0469)', () => {
  afterEach(() => occlude(false));

  it('keeps growing behind an occluded window — the first frame back reports where it really is', () => {
    const { clock, advance, elapse, idle } = manualClock();
    const { result } = renderHook(() =>
      useAct2Intro({ enabled: true, stories: GRAPH, edges: EDGES, speed: 1, clock }),
    );
    const duration = result.current.plan!.durationMs;
    act(() => result.current.replay());
    advance(0);
    elapse(duration / 4);
    const midRun = result.current.progress;
    expect(midRun).toBeGreaterThan(0.2);

    // Another window covers the desktop app. Chrome stops delivering frames to it — and on Windows
    // native occlusion is enough, so this is a click away, not a minimise. Time does not stop.
    occlude(true);
    idle(duration / 2);
    occlude(false);

    advance(0);
    expect(result.current.progress, 'half a run of real time passed').toBeGreaterThan(midRun + 0.4);
    expect(result.current.playing, 'nothing paused it, so nothing has to resume it').toBe(true);
  });

  it('keeps growing behind a parked map route — and coming back never rewinds it', () => {
    const { clock, advance, elapse, idle } = manualClock();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAct2Intro({ enabled, stories: GRAPH, edges: EDGES, speed: 1, clock }),
      { initialProps: { enabled: true } },
    );
    const plan = result.current.plan!;
    const duration = plan.durationMs;
    act(() => result.current.replay());
    advance(0);
    elapse(duration / 4);
    const midRun = result.current.progress;
    expect(midRun).toBeGreaterThan(0.2);

    // The owner opens a Library artifact, a doc, or Members: `App` parks the forest and `TreeView`
    // passes `active: false`, so the player is handed `enabled: false`.
    rerender({ enabled: false });
    idle(duration / 2);
    rerender({ enabled: true });

    expect(result.current.plan, 'parking is not a new graph, so it is not a new plan').toBe(plan);
    expect(result.current.progress, 'half a run of real time passed').toBeGreaterThan(midRun + 0.4);
    expect(result.current.progress, 'and it has not finished').toBeLessThan(1);
    expect(result.current.playing).toBe(true);

    // Still running, not merely correct once.
    const onReturn = result.current.progress;
    elapse(duration / 8);
    expect(result.current.progress).toBeGreaterThan(onReturn);
  });

  it('is simply settled when the run finished while nobody was watching', () => {
    const { clock, advance, elapse, idle } = manualClock();
    const { result, rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAct2Intro({ enabled, stories: GRAPH, edges: EDGES, speed: 1, clock }),
      { initialProps: { enabled: true } },
    );
    const duration = result.current.plan!.durationMs;
    act(() => result.current.replay());
    advance(0);
    elapse(duration / 4);

    // THE CONTROL, READ IN THIS SAME RUN. `progress === 1` on its own cannot tell the two worlds
    // apart: the defect this test exists for ALSO produced 1, because parking the route dropped the
    // plan and the cursor-reset effect settled the forest on the spot. Both worlds answer "settled",
    // so the settle alone proves nothing — asserted by itself this test passes against the very code
    // it was written to refuse.
    //
    // What separates them is WHEN. An absence too short to cover the rest of the run must come back
    // still growing; only the elapsed time can settle it. The short absence below is that control,
    // and it is what makes the long one downstream mean anything.
    rerender({ enabled: false });
    idle(duration / 4);
    rerender({ enabled: true });
    expect(
      result.current.progress,
      'the control: too little time passed for this run to be over',
    ).toBeLessThan(1);
    expect(result.current.regrowing, 'so it is still growing, not settled').toBe(true);

    // And now an absence that genuinely outlasts the run.
    rerender({ enabled: false });
    idle(duration * 2);
    rerender({ enabled: true });

    // The honest answer: it grew while you were away, and it finished. Not a frozen half-forest,
    // and not a run that starts over because someone came back.
    expect(result.current.progress).toBe(1);
    expect(result.current.regrowing).toBe(false);
    expect(result.current.playing).toBe(false);
  });

  it('a deliberate pause is not an absence — time spent paused does not bank', () => {
    const { clock, advance, elapse, idle } = manualClock();
    const { result } = renderHook(() =>
      useAct2Intro({ enabled: true, stories: GRAPH, edges: EDGES, speed: 1, clock }),
    );
    const duration = result.current.plan!.durationMs;
    act(() => result.current.replay());
    advance(0);
    elapse(duration / 4);
    const midRun = result.current.progress;

    act(() => result.current.pause());
    idle(duration / 2);
    act(() => result.current.play());
    advance(0);

    // Pause is the one case where the owner asked for the cursor to stop, so it resumes from where
    // it stopped. Only an absence catches up.
    expect(result.current.progress).toBeCloseTo(midRun, 6);
    expect(result.current.playing).toBe(true);
  });

  it('moving the speed dial mid-run changes the pace, never the position', () => {
    const { clock, advance, elapse } = manualClock();
    const { result, rerender } = renderHook(
      ({ speed }: { speed: number }) =>
        useAct2Intro({ enabled: true, stories: GRAPH, edges: EDGES, speed, clock }),
      { initialProps: { speed: 1 } },
    );
    const duration = result.current.plan!.durationMs;
    act(() => result.current.replay());
    advance(0);
    elapse(duration / 4);
    const midRun = result.current.progress;

    // A cursor derived from elapsed-since-anchor would re-scale the whole elapsed span if the dial
    // moved without re-anchoring, and the forest would jump. It re-anchors.
    rerender({ speed: 2 });
    expect(result.current.progress).toBeCloseTo(midRun, 6);
    elapse(duration / 4);
    expect(result.current.progress - midRun, 'twice the pace from here on').toBeCloseTo(0.5, 2);
  });
});

describe('useStableForestRegrowLayer', () => {
  const state = (absent: string[], hidden: string[]): ForestRegrowState => ({
    progress: 0.5,
    settled: false,
    landedStoryIds: new Set<string>(),
    growing: [],
    presentStoryIds: new Set<string>(),
    absentStoryIds: new Set(absent),
    hiddenSegmentIds: new Set(hidden),
    drawingSegments: [],
    arrivalStoryIds: [],
  });

  it('hands back NO layer unless a run is active AND has a state — a settled map carries none', () => {
    const s = state(['a'], ['s1']);
    expect(renderHook(() => useStableForestRegrowLayer(s, false)).result.current).toBeNull();
    expect(renderHook(() => useStableForestRegrowLayer(null, true)).result.current).toBeNull();
    const live = renderHook(() => useStableForestRegrowLayer(s, true)).result.current;
    expect(live?.hiddenStoryIds).toBe(s.absentStoryIds);
    expect(live?.hiddenSegmentIds).toBe(s.hiddenSegmentIds);
  });

  it('holds ONE layer object while the absence sets are unchanged, and a new one when they shrink', () => {
    let current = state(['a', 'b'], ['s1']);
    const hook = renderHook(() => useStableForestRegrowLayer(current, true));
    const first = hook.result.current;
    current = state(['a', 'b'], ['s1']);
    hook.rerender();
    expect(hook.result.current).toBe(first);
    current = state(['a'], ['s1']);
    hook.rerender();
    expect(hook.result.current).not.toBe(first);
    expect(hook.result.current?.hiddenStoryIds.has('b')).toBe(false);
  });
});
