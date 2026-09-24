// act2Intro — the Act 2 introduction's app-owned clock and control state (ADR-0282 D6).
//
// The owner clicks one control and the whole forest regrows from nothing, outward from the base
// nodes, in the story graph's own dependency order. Everything about HOW that plays lives on this
// side of the seam: the clock, the ordering, normalized progress, the holds, Back, Replay and the
// reduced-motion settlement. Nothing is asset-owned and there is no remount key standing in for a
// cursor — the cursor IS the state.
//
// The ORDER itself is not decided here: `deriveForestRegrowPlan` (@storytree/app-surface) derives
// it from the real story graph, so this module never scripts a sequence (ADR-0282 D3/D8).
//
// It runs on the REAL map, not a witness stage: same world, same scene, same trails. What the
// gate adds is a cursor and a control; what it never does is change the clean route.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  deriveForestRegrowPlan,
  forestRegrowAtProgress,
  forestRegrowLayerSignature,
  forestRegrowRenderLayer,
  type ForestRegrowPlan,
  type ForestRegrowRenderLayer,
  type ForestRegrowState,
  type ForestRegrowStory,
  type ForestRegrowTrailEdge,
} from '@storytree/app-surface';

/**
 * `?act2=intro` — the ONE value that mounts the Act 2 regrow's DIAGNOSTIC control on the real map,
 * and forces the regrow to play whatever the session flag below says. Absence, an empty value, and
 * any OTHER value (including near-misses like `?act2=on` or `?act2=intro-x`) leave that control
 * unmounted. An EXACT match, never a truthy/loose gate.
 *
 * It is no longer what makes the regrow REACHABLE (ADR-0286): the regrow now plays on first arrival
 * on the clean route, and its owner-facing transport lives in world settings. What this param still
 * buys is a run every time — a stable URL to hand someone who has to watch it — plus the factual
 * readout (depth, islands landed, pathways growing, percent) that the gear controls do not carry.
 */
export function readAct2Intro(search: string): boolean {
  return new URLSearchParams(search).get('act2') === 'intro';
}

/**
 * The `sessionStorage` key that remembers this browser session has already arrived at the map.
 *
 * Session-scoped on purpose (ADR-0286, owner-directed): the regrow plays on the FIRST visit and the
 * map is static for the rest of the session. `localStorage` would show it once ever — too little
 * for something that is meant to introduce the product — and no flag at all would replay it on
 * every navigation back to the tree, which turns a title sequence into a tax.
 */
export const ACT2_INTRO_SESSION_KEY = 'storytree.act2.arrived';

/** The session store, or `null` when there is none (SSR, or a browser refusing storage). */
export function act2IntroStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Safari in private mode, and any embedding that blocks storage, THROW on access rather than
    // returning null. A regrow is not worth an exception on the way into the map.
    return null;
  }
}

/**
 * Has this browser session already arrived at the map? A pure READ — call {@link markAct2IntroArrived}
 * to record the arrival.
 *
 * Fails toward PLAYING (`false` ⇒ first visit) when there is no storage at all, because a viewer who
 * blocks storage should still get the introduction; the cost of being wrong is one extra regrow.
 */
export function act2IntroAlreadyArrived(storage: Storage | null): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(ACT2_INTRO_SESSION_KEY) !== null;
  } catch {
    return false;
  }
}

/** Record the arrival, so the rest of the session gets the static map. Silently a no-op with no
 *  storage — the read above is the half that matters, and it fails toward playing. */
export function markAct2IntroArrived(storage: Storage | null): void {
  if (!storage) return;
  try {
    storage.setItem(ACT2_INTRO_SESSION_KEY, '1');
  } catch {
    /* a full or blocked quota is not a reason to fail the map */
  }
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * The live reduced-motion preference. Subscribed rather than sampled once: a viewer who turns the
 * system setting on mid-regrow should land on the grown forest, not finish the animation they just
 * asked to stop. SSR-safe (no window ⇒ full motion, matching the browser default).
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (): void => setReduced(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Hold the regrow's render layer STABLE while the picture is not moving.
 *
 * A forest-map frame's cost is rasterisation (ADR-0272), and any write inside the SVG invalidates
 * paint for the whole subtree — so a new layer object on a frame that would paint the identical
 * picture costs a full repaint for nothing. Measured on the real corpus: those frames were ~300 ms
 * each. Reusing the previous object keeps `SceneView`'s `React.memo` bail-out intact and makes them
 * free. It changes WHEN the map repaints, never WHAT it paints — two layers with the same
 * signature draw the same frame by construction.
 */
export function useStableForestRegrowLayer(
  state: ForestRegrowState | null,
  active: boolean,
): ForestRegrowRenderLayer | null {
  const held = useRef<{ signature: string; layer: ForestRegrowRenderLayer } | null>(null);
  if (!active || !state) {
    held.current = null;
    return null;
  }
  const signature = forestRegrowLayerSignature(state);
  if (held.current?.signature === signature) return held.current.layer;
  const layer = forestRegrowRenderLayer(state);
  held.current = { signature, layer };
  return layer;
}

export interface Act2IntroClock {
  requestFrame(callback: (timestamp: number) => void): number;
  cancelFrame(requestId: number): void;
  /**
   * Wall-clock milliseconds, on the SAME timeline as the timestamps `requestFrame` delivers.
   *
   * The cursor is a function of elapsed time since a run's anchor rather than a sum of per-frame
   * deltas (ADR-0469), so the player has to be able to ask what time it is at a moment no frame is
   * being delivered — the frame after an occlusion, and the first frame after the map route comes
   * back. `performance.now()` in the browser; the test harness supplies its own, which is what keeps
   * a run across an occlusion a deterministic sequence of injected timestamps.
   */
  now(): number;
}

const BROWSER_CLOCK: Act2IntroClock = {
  requestFrame: (callback) => window.requestAnimationFrame(callback),
  cancelFrame: (requestId) => window.cancelAnimationFrame(requestId),
  // The same timeline rAF stamps its callbacks with, which is the whole reason this is not `Date.now()`.
  now: () => performance.now(),
};

export interface Act2IntroInput {
  readonly enabled: boolean;
  readonly stories: readonly ForestRegrowStory[] | null;
  readonly edges: readonly ForestRegrowTrailEdge[] | null;
  /** Segment id → drawn length in world units, so a pathway's pace follows the real routed
   *  geometry rather than a per-segment guess (ADR-0283 D1: growth runs along the real trail). */
  readonly segmentLengths?: ReadonlyMap<string, number> | null;
  readonly reducedMotion?: boolean;
  /**
   * How fast the cursor crosses the plan (ADR-0286). `1` is the plan's OWN duration — the pace the
   * graph's pathway geometry derives. Below 1 stretches it, above 1 compresses it.
   *
   * It scales the CLOCK, never the schedule: every island still forms exactly where its incoming
   * pathway arrives, in the same proportion of the run. Re-deriving the plan per speed would move
   * the arrivals themselves, which is the one thing ADR-0285's causal invariant is about.
   */
  readonly speed?: number;
  /**
   * A regrow is ABOUT to be started (ADR-0286) — so a fresh plan opens on NOTHING rather than on
   * the settled forest.
   *
   * Without it the first arrival flashes the finished forest. The cursor's resting value is 1, the
   * caller cannot call `replay` until the scene exists to regrow, and the render that first has a
   * scene therefore COMMITS the whole settled map — one full-forest paint — before the effect
   * rewinds it. That is the opposite of "grows from nothing", and it is the most expensive frame on
   * the surface.
   *
   * Only meaningful for the FIRST run: a replay asked for later starts from a forest that is
   * already on screen, so there is nothing to avoid showing.
   */
  readonly pendingStart?: boolean;
  readonly clock?: Act2IntroClock;
}

/**
 * A content signature of everything `deriveForestRegrowPlan` reads.
 *
 * The plan has to survive a re-fetch that changes nothing. The studio paints from a cached tree
 * payload and then confirms it against `/api/tree` (ADR-0240), so `stories` arrives as a NEW array
 * holding the SAME graph seconds later — and a new plan resets the cursor, which would have killed
 * an auto-playing intro mid-run every single time the confirm landed. Keying the plan on what it is
 * DERIVED from rather than on array identity is what makes the run survive that.
 *
 * Lengths are rounded to whole world units: the routed network is deterministic given the same
 * story ids, so re-routing reproduces them, and a float wobble is not a different forest.
 */
export function forestRegrowGraphKey(
  stories: readonly ForestRegrowStory[],
  edges: readonly ForestRegrowTrailEdge[],
  segmentLengths?: ReadonlyMap<string, number> | null,
): string {
  const storyPart = stories
    .map((story) => `${story.id}>${[...story.dependsOn].sort().join(',')}`)
    .sort()
    .join(';');
  const edgePart = edges
    .map(
      (edge) =>
        `${edge.from}>${edge.to}>${edge.segments
          .map((ref) => `${ref.id}${ref.reversed === true ? '~' : ''}:${Math.round(segmentLengths?.get(ref.id) ?? -1)}`)
          .join(',')}`,
    )
    .sort()
    .join(';');
  return `${storyPart}|${edgePart}`;
}

/**
 * A run in flight, as an ANCHOR rather than as a boolean (ADR-0469).
 *
 * `fromProgress` is where the cursor was at `anchorMs` on the clock's timeline, and everything
 * downstream is arithmetic over those two numbers. That is what lets a run be unwatched: nothing
 * about it is stored in the frames that were delivered, so no frames need to be delivered for it to
 * keep being true. `null` is a cursor at rest — paused, stepped back, settled, or finished.
 */
interface RegrowRun {
  /** The plan this run is a cursor OVER. A run never outlives its own schedule. */
  readonly plan: ForestRegrowPlan;
  readonly anchorMs: number;
  readonly fromProgress: number;
}

export interface Act2IntroPlayer {
  /** The plan, or null when the gate is off or the graph is not loaded yet. */
  readonly plan: ForestRegrowPlan | null;
  /** The selected regrow state, or null when there is nothing to regrow. */
  readonly state: ForestRegrowState | null;
  readonly progress: number;
  readonly playing: boolean;
  /** True while the cursor is anywhere before the settled forest. */
  readonly regrowing: boolean;
  /** Which wave the cursor is in — for the control's own readout, not for the render. */
  readonly wave: number;
  /** Start (or resume) the regrow from wherever the cursor is; from 0 if it is already settled. */
  readonly play: () => void;
  readonly pause: () => void;
  /** Restart from nothing and play. */
  readonly replay: () => void;
  /** Step the cursor back to the start of the previous wave and hold there. */
  readonly back: () => void;
  /** Jump to the fully grown forest — also where reduced motion settles. */
  readonly settle: () => void;
}

const IDLE: Act2IntroPlayer = {
  plan: null,
  state: null,
  progress: 1,
  playing: false,
  regrowing: false,
  wave: 0,
  play: () => {},
  pause: () => {},
  replay: () => {},
  back: () => {},
  settle: () => {},
};

/** The normalized cursor at which a wave's FIRST island begins to accrete. */
export function waveStartProgress(plan: ForestRegrowPlan, wave: number): number {
  const starts = plan.steps.filter((step) => step.wave === wave).map((step) => step.start);
  return starts.length === 0 ? 0 : Math.min(...starts);
}

/** The wave a cursor sits in — the latest wave that has begun. */
export function waveAtProgress(plan: ForestRegrowPlan, progress: number): number {
  let wave = 0;
  for (const step of plan.steps) {
    if (step.start <= progress && step.wave > wave) wave = step.wave;
  }
  return wave;
}

/**
 * The cursor Back should land on: the start of the wave BEFORE the one currently in flight, so a
 * repeated Back walks the forest backwards a layer at a time rather than nudging by a frame.
 */
export function backProgress(plan: ForestRegrowPlan, progress: number): number {
  const current = waveAtProgress(plan, progress);
  // Already a little way into a wave ⇒ Back returns to the top of THIS wave first.
  const top = waveStartProgress(plan, current);
  if (progress > top + 1e-6) return top;
  return current === 0 ? 0 : waveStartProgress(plan, current - 1);
}

export function useAct2Intro({
  enabled,
  stories,
  edges,
  segmentLengths,
  reducedMotion,
  speed,
  pendingStart,
  clock,
}: Act2IntroInput): Act2IntroPlayer {
  const graphKey = useMemo(
    () =>
      enabled && stories && stories.length > 0
        ? forestRegrowGraphKey(stories, edges ?? [], segmentLengths)
        : null,
    [enabled, stories, edges, segmentLengths],
  );
  // Hold the plan by its GRAPH, not by the identity of the arrays it came from — see
  // `forestRegrowGraphKey`. The ref write during render mirrors `useStableForestRegrowLayer`
  // above: it is a memo whose key is content, and it never reads back a value it did not just
  // compute from the current inputs.
  //
  // The cache deliberately SURVIVES `enabled` going false (ADR-0469). Parking the map route — the
  // owner opening a Library artifact — is not a different forest, so re-enabling must hand back the
  // SAME plan object; discarding it here is what used to make an unpark look like a brand-new graph
  // and rewind the run to the settled forest.
  const held = useRef<{ key: string; plan: ForestRegrowPlan } | null>(null);
  const plan = useMemo(() => {
    if (graphKey === null || !stories) return null;
    if (held.current?.key === graphKey) return held.current.plan;
    const next = deriveForestRegrowPlan(stories, edges ?? [], segmentLengths ? { segmentLengths } : {});
    held.current = { key: graphKey, plan: next };
    return next;
    // `stories` / `edges` / `segmentLengths` are read here but deliberately not deps: `graphKey`
    // IS their content, so re-running on their identity is exactly what this hold exists to stop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphKey]);
  // Where the cursor RESTS when there is no run: the settled forest. A map that is not regrowing
  // shows the product, not an animation nobody asked for. The exception is a run already on its
  // way (`pendingStart`) — see the field's own note: opening on 1 there means committing one full
  // settled paint before the rewind, which is the flash the intro exists to avoid.
  const restingProgress = pendingStart === true ? 0 : 1;
  // Read at the two moments the cursor is (re)seeded, never as a dependency — flipping this must
  // not itself rewind a run in flight.
  const restingRef = useRef(restingProgress);
  restingRef.current = restingProgress;

  const [progress, setProgress] = useState(restingProgress);
  const [run, setRun] = useState<RegrowRun | null>(null);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const tick = clock ?? BROWSER_CLOCK;
  // Read wherever a run is anchored, which is in callbacks and effects that must not re-fire merely
  // because a caller passed a new clock object.
  const tickRef = useRef(tick);
  tickRef.current = tick;

  // A new plan (a re-pulled tree, a different graph) invalidates the cursor rather than leaving it
  // pointing into a schedule that no longer exists. A plan that is merely the SAME graph re-fetched
  // never reaches here — see `forestRegrowGraphKey`.
  //
  // The guard is what makes a PARK survive (ADR-0469). While `enabled` is false the plan reads null
  // and this holds the cursor; on the way back the cache above returns the plan this effect has
  // already seeded, so re-arriving at a plan it has seen is not a reason to rewind anything.
  const seeded = useRef<ForestRegrowPlan | null>(null);
  useEffect(() => {
    if (!plan || seeded.current === plan) return;
    seeded.current = plan;
    setProgress(restingRef.current);
    setRun(null);
  }, [plan]);

  // ADR-0282 D6: reduced motion settles on the FULLY GROWN forest — not a frozen half-forest and
  // not a shorter animation. The app owns that settlement rather than leaning on a stylesheet.
  useEffect(() => {
    if (!reducedMotion) return;
    setRun(null);
    setProgress(1);
  }, [reducedMotion]);

  // The speed dial, sanitised once. A non-finite or non-positive value would stall the cursor
  // forever (or run it backwards), so it falls back to the plan's own pace rather than trusting
  // whatever arrived from the URL.
  const rate = Number.isFinite(speed) && (speed as number) > 0 ? (speed as number) : 1;

  // The dial can move mid-run. The cursor is elapsed-time-since-the-anchor, so changing the
  // multiplier without re-anchoring would retroactively re-scale the WHOLE elapsed span and jump
  // the forest. Re-anchoring at the cursor's present position keeps a dial change a change of pace
  // rather than of position — which is exactly what ADR-0286 D4 says a speed is allowed to do.
  useEffect(() => {
    setRun((current) =>
      current === null
        ? null
        : { ...current, anchorMs: tickRef.current.now(), fromProgress: progressRef.current },
    );
  }, [rate]);

  useEffect(() => {
    // A run belongs to the plan it was started over. When the GRAPH really changes the seeding
    // effect above rewinds the cursor, and this guard is what stops the sample below from reading the
    // old run against the new schedule and overwriting that rewind in the same commit.
    if (!plan || !run || run.plan !== plan || reducedMotion) return;
    const frames = tickRef.current;
    let requestId = 0;
    let cancelled = false;
    const step = (timestamp: number): void => {
      if (cancelled) return;
      // WHERE THE CURSOR IS, not how far it moved since the last frame (ADR-0469). A run is anchored
      // to a wall-clock instant, so a gap in frame delivery — an occluded desktop window, a parked
      // map route, one slow paint — is simply time that passed, and the next frame to arrive reports
      // the truth rather than resuming from a stale sum. There is no rAF debt to bank, which is why
      // the old 500 ms per-frame clamp and the `visibilitychange` pause are both gone: each existed
      // only to protect an accumulator that no longer exists.
      //
      // Global time is LINEAR on purpose: the plan's own wave pacing is the easing, and the
      // per-island accretion smoothsteps inside its own window. A second global ease on top would
      // distort the dependency schedule the order is supposed to make legible.
      //
      // `rate` (ADR-0286) is a plain multiplier on elapsed time, which is why it can only stretch
      // or compress the run: every island's `start`/`end` is a FRACTION of the plan, so scaling how
      // fast the cursor crosses it leaves the whole schedule proportionally identical.
      const elapsedMs = Math.max(0, timestamp - run.anchorMs);
      const next = Math.min(1, run.fromProgress + (elapsedMs * rate) / plan.durationMs);
      progressRef.current = next;
      setProgress(next);
      if (next >= 1) {
        setRun(null);
        return;
      }
      requestId = frames.requestFrame(step);
    };
    // Sample once on entry as well as on every frame. The effect re-enters when a parked route comes
    // back, and the run may have finished — or moved a long way — while it was gone; waiting for the
    // browser's next frame to notice would publish one render of a cursor that is already wrong.
    step(frames.now());
    return () => {
      cancelled = true;
      frames.cancelFrame(requestId);
    };
  }, [plan, run, reducedMotion, rate]);

  const state = useMemo(
    () => (plan ? forestRegrowAtProgress(plan, progress) : null),
    [plan, progress],
  );

  const play = useCallback(() => {
    if (reducedMotion) {
      setProgress(1);
      return;
    }
    const from = progressRef.current >= 1 ? 0 : progressRef.current;
    progressRef.current = from;
    setProgress(from);
    // A FRESH anchor, so time spent paused is not banked. Pause is the one absence the owner asked
    // for, and it is the only one that does not catch up.
    if (plan) setRun({ plan, anchorMs: tickRef.current.now(), fromProgress: from });
  }, [reducedMotion, plan]);

  const pause = useCallback(() => setRun(null), []);

  const replay = useCallback(() => {
    if (reducedMotion) {
      setProgress(1);
      return;
    }
    progressRef.current = 0;
    setProgress(0);
    if (plan) setRun({ plan, anchorMs: tickRef.current.now(), fromProgress: 0 });
  }, [reducedMotion, plan]);

  const back = useCallback(() => {
    if (!plan) return;
    const next = backProgress(plan, progressRef.current);
    progressRef.current = next;
    setProgress(next);
    setRun(null);
  }, [plan]);

  const settle = useCallback(() => {
    progressRef.current = 1;
    setProgress(1);
    setRun(null);
  }, []);

  if (!plan || !state) return IDLE;
  return {
    plan,
    state,
    progress,
    // A run IS its anchor: holding one is what "playing" means, and the loop clears it at cursor 1.
    playing: run !== null,
    regrowing: progress < 1,
    wave: waveAtProgress(plan, progress),
    play,
    pause,
    replay,
    back,
    settle,
  };
}
