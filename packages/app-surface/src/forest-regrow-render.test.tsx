// @vitest-environment jsdom
//
// forest-regrow-render — Stage-1 red-green (ADR-0070) of the Act 2 regrow's RENDER seam as the SVG
// interaction layer sees it since ADR-0608 (the 3D land draws the growth itself): the layer carries
// exactly the cursor state's two absence sets, its signature moves exactly when they do, a story the
// regrow has not reached has no nameplate / hit region / ground in the DOM, a selection lane on a road
// that has not arrived is withheld — and, the absence lock, a settled or absent layer renders
// byte-for-byte as no layer at all.

import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildScene,
  type SceneInput,
  type SceneNode,
  type SceneTrailsInput,
} from '@storytree/forest-world';
import { SceneView, type SceneCtx } from './SceneView.js';
import {
  deriveForestRegrowPlan,
  forestRegrowAtProgress,
  type ForestRegrowState,
  type ForestRegrowStory,
} from './forest-regrow.js';
import { forestRegrowLayerSignature, forestRegrowRenderLayer } from './forest-regrow-render.js';
import { neighbourHighlightPlan } from './neighbourHighlight.js';

afterEach(cleanup);

const ROOT = 'root-island';
const LEAF = 'leaf-island';

const square = (x: number, y: number): readonly { x: number; y: number }[] => [
  { x, y },
  { x: x + 10, y },
  { x: x + 10, y: y + 10 },
  { x, y: y + 10 },
];

/** A two-island world joined by one two-segment road — the smallest thing that can be a forest. */
const TRAILS: SceneTrailsInput = {
  segments: [
    { id: 'seg-a', d: 'M 30 15 L 60 15', points: [{ x: 30, y: 15 }, { x: 60, y: 15 }], usage: 1, hidden: false },
    { id: 'seg-b', d: 'M 60 15 L 90 15', points: [{ x: 60, y: 15 }, { x: 90, y: 15 }], usage: 1, hidden: false },
  ],
  edges: [
    {
      from: ROOT,
      to: LEAF,
      segments: [
        { id: 'seg-a', reversed: false },
        { id: 'seg-b', reversed: false },
      ],
    },
  ],
  caves: [],
  dropped: [],
};

function island(id: string, dx: number): SceneInput['territories'][number] {
  return {
    id,
    status: 'mapped',
    caps: 0,
    centroid: { x: dx + 15, y: 15 },
    groundRadius: 18,
    screenRadius: 18,
    treeSpot: { x: dx + 15, y: 12 },
    labelY: 35,
    coastGroundLoops: [
      [
        { x: dx - 3, y: -2 },
        { x: dx + 33, y: -2 },
        { x: dx + 34, y: 31 },
        { x: dx - 2, y: 33 },
      ],
    ],
    decor: [],
    plants: [],
    treeTitle: id,
    wisps: [],
    plate: { w: 30, h: 14, rx: 3, idY: 6, subY: 11, idText: id, subText: 'mapped', title: id },
  };
}

function forestScene(): SceneNode {
  const cellsFor = (owner: number, dx: number): NonNullable<SceneInput['relaxedCells']> =>
    [0, 10, 20].flatMap((y) =>
      [0, 10, 20].map((x) => ({
        owner,
        poly: [...square(dx + x, y)],
        variant: (x + y) % 3,
        wheat: false,
      })),
    );
  const input: SceneInput = {
    offset: { x: 7, y: 11 },
    width: 140,
    height: 60,
    empties: [],
    relaxedCells: [...cellsFor(0, 0), ...cellsFor(1, 90)],
    drawTiles: [],
    wheatSets: [new Set(), new Set()],
    trails: TRAILS,
    territories: [island(ROOT, 0), island(LEAF, 90)],
  };
  return buildScene(input);
}

const GRAPH: readonly ForestRegrowStory[] = [
  { id: ROOT, dependsOn: [] },
  { id: LEAF, dependsOn: [ROOT] },
];

const PLAN = deriveForestRegrowPlan(GRAPH, TRAILS.edges);
const stateAt = (progress: number): ForestRegrowState => forestRegrowAtProgress(PLAN, progress);

function ctxFor(layer?: SceneCtx['forestRegrowLayer'], over: Partial<SceneCtx> = {}): SceneCtx {
  const ctx: SceneCtx = {
    territoryClassById: (_id, status) => `hex-territory st-${status}`,
    hidden: new Set(),
    onSelectStory: vi.fn(),
    onSelectCap: vi.fn(),
    ...over,
  };
  if (layer) ctx.forestRegrowLayer = layer;
  return ctx;
}

function draw(layer?: SceneCtx['forestRegrowLayer'], over: Partial<SceneCtx> = {}): HTMLElement {
  return render(
    <svg>
      <SceneView scene={forestScene()} ctx={ctxFor(layer, over)} />
    </svg>,
  ).container;
}

/** The regrow layer at a given cursor. */
const layerAt = (progress: number): NonNullable<SceneCtx['forestRegrowLayer']> =>
  forestRegrowRenderLayer(stateAt(progress));

const storyNodes = (container: HTMLElement, id: string): number =>
  container.querySelectorAll(`[data-story-id="${id}"]`).length;

/** ROOT selected: its one-hop edge to LEAF lights both road segments. */
const SELECT_ROOT: Partial<SceneCtx> = { neighbours: neighbourHighlightPlan(TRAILS, ROOT) };
const litLanes = (container: HTMLElement): (string | null)[] =>
  [...container.querySelectorAll('.trail-lit')].map((l) => l.getAttribute('data-id'));

describe('forestRegrowRenderLayer', () => {
  it('carries exactly the state`s absent stories and hidden segments — the same sets, not copies', () => {
    for (const p of [0, 0.3, 0.6, 1]) {
      const state = stateAt(p);
      const layer = forestRegrowRenderLayer(state);
      expect(layer.hiddenStoryIds).toBe(state.absentStoryIds);
      expect(layer.hiddenSegmentIds).toBe(state.hiddenSegmentIds);
      expect(Object.keys(layer).sort()).toEqual(['hiddenSegmentIds', 'hiddenStoryIds']);
    }
  });

  it('withholds both islands and both roads at the start, and nothing once settled', () => {
    expect([...layerAt(0).hiddenStoryIds].sort()).toEqual([LEAF, ROOT].sort());
    expect([...layerAt(0).hiddenSegmentIds].sort()).toEqual(['seg-a', 'seg-b']);
    expect(layerAt(1).hiddenStoryIds.size).toBe(0);
    expect(layerAt(1).hiddenSegmentIds.size).toBe(0);
  });
});

describe('forestRegrowLayerSignature', () => {
  it('summarises the two absence sets by size', () => {
    const state = stateAt(0);
    expect(forestRegrowLayerSignature(state)).toBe(
      `${state.absentStoryIds.size}|${state.hiddenSegmentIds.size}`,
    );
    expect(forestRegrowLayerSignature(stateAt(0))).toBe('2|2');
    expect(forestRegrowLayerSignature(stateAt(1))).toBe('0|0');
  });

  it('moves exactly when the layer`s sets move, and holds across frames that would draw the same', () => {
    // Sweep the cursor: whenever two consecutive frames share a signature their sets are equal (the
    // caller may keep one layer object), and whenever the sets differ so does the signature.
    const setKey = (s: ForestRegrowState): string =>
      `${[...s.absentStoryIds].sort().join(',')}|${[...s.hiddenSegmentIds].sort().join(',')}`;
    let prev = stateAt(0);
    let changes = 0;
    for (let i = 1; i <= 200; i++) {
      const next = stateAt(i / 200);
      const sameSig = forestRegrowLayerSignature(next) === forestRegrowLayerSignature(prev);
      expect(sameSig, `frame ${i}`).toBe(setKey(next) === setKey(prev));
      if (!sameSig) changes++;
      prev = next;
    }
    // ROOT appears, LEAF's road arrives segment by segment, LEAF appears: the signature did move.
    expect(changes).toBeGreaterThan(1);
  });
});

describe('the forest regrow in the scene walk', () => {
  it('renders byte-for-byte unchanged when no layer is supplied (the absence lock)', () => {
    const before = draw().innerHTML;
    cleanup();
    const after = draw().innerHTML;
    expect(after).toBe(before);
  });

  it('renders byte-for-byte unchanged on the SETTLED forest, layer or not — selection included', () => {
    const plain = draw(undefined, SELECT_ROOT).innerHTML;
    cleanup();
    const settled = draw(layerAt(1), SELECT_ROOT).innerHTML;
    expect(settled).toBe(plain);
  });

  it('draws nothing at all for a story the regrow has not reached', () => {
    const plain = draw();
    expect(storyNodes(plain, ROOT)).toBeGreaterThan(0);
    expect(plain.querySelector('.world-plate')).toBeTruthy();
    cleanup();
    const container = draw(layerAt(0));
    expect(storyNodes(container, ROOT)).toBe(0);
    expect(storyNodes(container, LEAF)).toBe(0);
    expect(container.querySelector('.relaxed-tile')).toBeNull();
    expect(container.querySelector('.world-story-hit')).toBeNull();
    expect(container.querySelector('.world-plate')).toBeNull();
  });

  it('lights no lane on a road whose far island has not landed', () => {
    const root = PLAN.stepByStory.get(ROOT)!;
    // Mid-way through the ROOT island's own accretion: root exists, leaf does not, so the road
    // between them is still a road to nowhere — even with ROOT selected.
    const container = draw(layerAt((root.start + root.end) / 2), SELECT_ROOT);
    expect(storyNodes(container, ROOT)).toBeGreaterThan(0);
    expect(storyNodes(container, LEAF)).toBe(0);
    expect(litLanes(container)).toEqual([]);
  });

  it('lights the lane once both its islands are present', () => {
    const leaf = PLAN.stepByStory.get(LEAF)!;
    const container = draw(layerAt(leaf.start + 1e-4), SELECT_ROOT);
    expect(storyNodes(container, LEAF)).toBeGreaterThan(0);
    expect(litLanes(container)).toEqual(['seg-a', 'seg-b']);
  });
});
