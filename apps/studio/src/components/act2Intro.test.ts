// act2Intro — the Act 2 intro's query GATE and the app-owned transport arithmetic (ADR-0282 D6).
//
// The gate half matters as much as the feature: this control mounts on the REAL map, so an
// over-eager reader would change the clean Studio route for every visitor. `?act2=intro` is an
// EXACT match; absence, an empty value and every near miss fall through untouched.

import { describe, it, expect } from 'vitest';
import {
  ACT2_INTRO_SESSION_KEY,
  act2IntroAlreadyArrived,
  backProgress,
  forestRegrowGraphKey,
  markAct2IntroArrived,
  readAct2Intro,
  waveAtProgress,
  waveStartProgress,
} from './act2Intro.js';
import {
  deriveForestRegrowPlan,
  type ForestRegrowStory,
  type ForestRegrowTrailEdge,
} from '@storytree/app-surface';

// ADR-0608 retired the ADR-0292 vegetation layer, and with it the `?veg2=off` LOOK kill switch
// (`readVegetationGrowthOff`): there is no flat per-object growth left to switch off.

describe('readAct2Intro', () => {
  it('mounts on the one exact value', () => {
    expect(readAct2Intro('?act2=intro')).toBe(true);
    expect(readAct2Intro('?foo=1&act2=intro&bar=2')).toBe(true);
  });

  it('leaves the clean route alone for absence, empty, and every near miss', () => {
    for (const search of [
      '',
      '?',
      '?act2=',
      '?act2',
      '?act2=on',
      '?act2=1',
      '?act2=true',
      '?act2=intro-x',
      '?act2=Intro',
      '?act2=INTRO',
      '?act2= intro',
      '?act3=intro',
      // a sibling witness gate's value must not turn this one on either. (Deliberately NOT
      // spelling the round-3 lab's value here: TreeViewShell audits that string's every mention
      // to prove that lab has no permanent navigation entry, and a test file is not an entry.)
      '?semanticGrowth=demo',
      '?organicGrowth=organic-island-accretion',
    ]) {
      expect(readAct2Intro(search), `"${search}" must fall through`).toBe(false);
    }
  });
});

const GRAPH: readonly ForestRegrowStory[] = [
  { id: 'a', dependsOn: [] },
  { id: 'b', dependsOn: [] },
  { id: 'c', dependsOn: ['a'] },
  { id: 'd', dependsOn: ['c'] },
];

const plan = deriveForestRegrowPlan(GRAPH);

describe('the wave transport', () => {
  it('reads the cursor back to the wave it is in', () => {
    expect(waveAtProgress(plan, 0)).toBe(0);
    expect(waveAtProgress(plan, waveStartProgress(plan, 1) + 1e-6)).toBe(1);
    expect(waveAtProgress(plan, waveStartProgress(plan, 2) + 1e-6)).toBe(2);
    expect(waveAtProgress(plan, 1)).toBe(plan.waveCount - 1);
  });

  it('takes Back to the top of the current wave before stepping to the previous one', () => {
    const secondWave = waveStartProgress(plan, 1);
    // partway INTO wave 1 ⇒ back to the top of wave 1
    expect(backProgress(plan, secondWave + 0.02)).toBeCloseTo(secondWave, 9);
    // already at the top of wave 1 ⇒ back to the top of wave 0
    expect(backProgress(plan, secondWave)).toBeCloseTo(waveStartProgress(plan, 0), 9);
  });

  it('never steps Back past nothing', () => {
    expect(backProgress(plan, 0)).toBe(0);
    expect(backProgress(plan, waveStartProgress(plan, 0))).toBe(0);
  });

  it('walks the whole forest back to nothing in a bounded number of steps', () => {
    let at = 1;
    for (let step = 0; step < plan.waveCount + 2 && at > 0; step += 1) {
      const next = backProgress(plan, at);
      expect(next, 'Back must make progress').toBeLessThan(at);
      at = next;
    }
    expect(at).toBe(0);
  });
});

// ── ADR-0286: the first-arrival session flag ──
//
// The regrow now plays on the clean route, so what stops it becoming a tax on every navigation
// back to the map is this one flag. Its failure direction is deliberate and worth pinning: no
// storage at all must fail toward PLAYING, because a viewer who blocks storage should still get
// the introduction, and the cost of being wrong is one extra regrow.

/** A `Storage` that behaves, and one that throws on every access (private-mode Safari). */
function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

function hostileStorage(): Storage {
  const boom = (): never => {
    throw new Error('storage blocked');
  };
  // One assertion, not a chain: `satisfies Partial<Storage>` checks every member's signature
  // against the real interface first (anti-slop `no-chained-type-assertions`, inc-09).
  return {
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
    key: boom,
    length: 0,
  } satisfies Partial<Storage> as Storage;
}

describe('the first-arrival session flag', () => {
  it('is unset on arrival and set once recorded', () => {
    const storage = fakeStorage();
    expect(act2IntroAlreadyArrived(storage)).toBe(false);
    markAct2IntroArrived(storage);
    expect(act2IntroAlreadyArrived(storage)).toBe(true);
    expect(storage.getItem(ACT2_INTRO_SESSION_KEY)).not.toBeNull();
  });

  it('is idempotent — recording twice still reads as one arrival', () => {
    const storage = fakeStorage();
    markAct2IntroArrived(storage);
    markAct2IntroArrived(storage);
    expect(act2IntroAlreadyArrived(storage)).toBe(true);
  });

  it('fails toward playing with no storage, and never throws on a hostile one', () => {
    expect(act2IntroAlreadyArrived(null)).toBe(false);
    expect(() => markAct2IntroArrived(null)).not.toThrow();
    const hostile = hostileStorage();
    expect(act2IntroAlreadyArrived(hostile)).toBe(false);
    expect(() => markAct2IntroArrived(hostile)).not.toThrow();
  });
});

// ── ADR-0286: the plan's graph key ──
//
// The studio paints from a cached tree payload and then confirms it against `/api/tree`, so the
// SAME graph arrives twice as two different arrays seconds apart. A plan keyed on array identity
// resets the cursor when the confirm lands — which, now that the regrow plays automatically on
// arrival, would have killed the intro mid-run every single time.

const EDGES: readonly ForestRegrowTrailEdge[] = [
  { from: 'a', to: 'c', segments: [{ id: 's1' }, { id: 's2', reversed: true }] },
  { from: 'c', to: 'd', segments: [{ id: 's3' }] },
];
const LENGTHS = new Map([
  ['s1', 120],
  ['s2', 340],
  ['s3', 90],
]);

describe('forestRegrowGraphKey', () => {
  it('is identical for a re-fetched copy of the same graph', () => {
    const copy = GRAPH.map((s) => ({ id: s.id, dependsOn: [...s.dependsOn] }));
    const edgeCopy = EDGES.map((e) => ({ ...e, segments: e.segments.map((s) => ({ ...s })) }));
    expect(forestRegrowGraphKey(copy, edgeCopy, new Map(LENGTHS))).toBe(
      forestRegrowGraphKey(GRAPH, EDGES, LENGTHS),
    );
  });

  it('is independent of the order stories and edges arrive in', () => {
    expect(forestRegrowGraphKey([...GRAPH].reverse(), [...EDGES].reverse(), LENGTHS)).toBe(
      forestRegrowGraphKey(GRAPH, EDGES, LENGTHS),
    );
  });

  it('changes when anything the PLAN reads changes', () => {
    const base = forestRegrowGraphKey(GRAPH, EDGES, LENGTHS);
    // a new story
    expect(forestRegrowGraphKey([...GRAPH, { id: 'e', dependsOn: ['d'] }], EDGES, LENGTHS)).not.toBe(base);
    // a changed dependency
    expect(
      forestRegrowGraphKey(
        GRAPH.map((s) => (s.id === 'd' ? { id: 'd', dependsOn: ['a'] } : s)),
        EDGES,
        LENGTHS,
      ),
    ).not.toBe(base);
    // a re-routed edge (different segments)
    expect(
      forestRegrowGraphKey(GRAPH, [{ from: 'a', to: 'c', segments: [{ id: 's9' }] }, EDGES[1]!], LENGTHS),
    ).not.toBe(base);
    // a segment drawn the other way round — it changes which end the growth starts from
    expect(
      forestRegrowGraphKey(
        GRAPH,
        [{ from: 'a', to: 'c', segments: [{ id: 's1' }, { id: 's2' }] }, EDGES[1]!],
        LENGTHS,
      ),
    ).not.toBe(base);
    // a different geometry, which paces the pathway differently
    expect(forestRegrowGraphKey(GRAPH, EDGES, new Map([...LENGTHS, ['s1', 4000]]))).not.toBe(base);
  });

  it('shrugs off a sub-unit float wobble in the routed geometry', () => {
    expect(forestRegrowGraphKey(GRAPH, EDGES, new Map([...LENGTHS, ['s1', 120.0004]]))).toBe(
      forestRegrowGraphKey(GRAPH, EDGES, LENGTHS),
    );
  });
});
