// @vitest-environment jsdom

import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildScene, type SceneInput, type SceneNode } from '@storytree/forest-world';

import { nativePropTargetRects, type NativePropTargetRenderLayer } from './native-prop-targets.js';
import { normalizeWorldPresentationModel, WorldSceneView } from './WorldSceneView.js';
import type { ForestRegrowRenderLayer } from './SceneView.js';

afterEach(cleanup);

const LAYER: NativePropTargetRenderLayer = {
  origin: { x: 30, y: -10 },
  targets: [
    { storyId: 'story-a', capabilityId: 'cap-far', status: 'healthy', bounds: { minX: 40, maxX: 50, minY: 5, maxY: 25 } },
    { storyId: 'story-b', capabilityId: 'cap-mid', status: 'unhealthy', bounds: { minX: 42, maxX: 48, minY: 12, maxY: 30 } },
    { storyId: 'story-a', capabilityId: 'cap-near', status: 'building', bounds: { minX: 35, maxX: 61, minY: 20, maxY: 44 } },
  ],
};

function input(): SceneInput {
  return {
    offset: { x: 30, y: -10 },
    width: 100,
    height: 100,
    empties: [],
    relaxedCells: [
      { owner: 0, poly: [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 50, y: 80 }], variant: 0, wheat: false },
    ],
    drawTiles: [],
    wheatSets: [new Set()],
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: [
      {
        id: 'story-a',
        status: 'healthy',
        caps: 1,
        centroid: { x: 50, y: 50 },
        groundRadius: 24,
        screenRadius: 24,
        treeSpot: { x: 50, y: 45 },
        labelY: 76,
        coastGroundLoops: [[{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 50, y: 80 }]],
        decor: [],
        plants: [{ id: 'cap-a', status: 'proposed', x: 55, y: 55, title: 'Capability A' }],
        treeTitle: 'Story A — healthy',
        wisps: [],
        plate: { w: 60, h: 30, rx: 7, idY: 13, subY: 25, idText: 'story-a', subText: 'healthy · 1 cap', title: 'Story A' },
      },
    ],
  };
}

const scene = (): SceneNode => buildScene(input());

function regrowHiding(storyIds: readonly string[]): ForestRegrowRenderLayer {
  return {
    hiddenStoryIds: new Set(storyIds),
    hiddenSegmentIds: new Set(),
  };
}

describe('nativePropTargetRects', () => {
  it('shifts each envelope into the world group once and keeps the supplied back-to-front order', () => {
    const rects = nativePropTargetRects(LAYER, { hiddenStoryIds: null, hiddenStatuses: new Set() });

    expect(rects).toEqual([
      { key: 'story-a::cap-far::0', storyId: 'story-a', capabilityId: 'cap-far', className: 'native-prop-target st-healthy', x: 10, y: 15, width: 10, height: 20 },
      { key: 'story-b::cap-mid::1', storyId: 'story-b', capabilityId: 'cap-mid', className: 'native-prop-target st-unhealthy', x: 12, y: 22, width: 6, height: 18 },
      { key: 'story-a::cap-near::2', storyId: 'story-a', capabilityId: 'cap-near', className: 'native-prop-target st-building', x: 5, y: 30, width: 26, height: 24 },
    ]);
  });

  it('draws no target for a story the regrow has not reached', () => {
    const rects = nativePropTargetRects(LAYER, { hiddenStoryIds: new Set(['story-a']), hiddenStatuses: new Set() });
    expect(rects.map((r) => r.capabilityId)).toEqual(['cap-mid']);
  });

  it('marks, and does not remove, a target whose status the legend hides', () => {
    const rects = nativePropTargetRects(LAYER, { hiddenStoryIds: null, hiddenStatuses: new Set(['unhealthy']) });
    expect(rects.map((r) => r.className)).toEqual([
      'native-prop-target st-healthy',
      'native-prop-target st-unhealthy is-filtered',
      'native-prop-target st-building',
    ]);
  });
});

describe('the native plant target layer in the world walk', () => {
  it('paints after the trails layer and before the nameplate layer, so a crown beats the ground but not the nameplates', () => {
    const { container } = render(
      <svg>
        <WorldSceneView model={normalizeWorldPresentationModel({ scene: scene(), nativePropTargetLayer: LAYER })} />
      </svg>,
    );
    const world = container.querySelector('svg > g')!;
    const order = [...world.children].map((el) => el.getAttribute('class') ?? '');
    const targets = order.indexOf('native-prop-targets');
    const trails = order.findIndex((c) => c.split(' ').includes('trail-net'));

    expect(targets).toBeGreaterThan(-1);
    expect(trails).toBeGreaterThan(-1);
    expect(targets).toBe(trails + 1);
    // Everything after the targets is the nameplate layer (nameplates, wisps, caves).
    expect(world.children[targets + 1]?.querySelector('.hex-flora[data-story-id="story-a"] .world-plate')).not.toBeNull();
    expect(targets + 1).toBe(world.children.length - 1);

    const rects = [...container.querySelectorAll('g.native-prop-targets > rect')];
    expect(rects.map((r) => r.getAttribute('data-cap-id'))).toEqual(['cap-far', 'cap-mid', 'cap-near']);
    expect(rects.map((r) => r.getAttribute('data-story-id'))).toEqual(['story-a', 'story-b', 'story-a']);
    expect(rects[2]!.getAttribute('fill')).toBe('transparent');
    expect([rects[2]!.getAttribute('x'), rects[2]!.getAttribute('y'), rects[2]!.getAttribute('width'), rects[2]!.getAttribute('height')]).toEqual(['5.0', '30.0', '26.0', '24.0']);
    expect(container.querySelector('g.native-prop-targets')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('selects the capability through the host route on click, without the event reaching the island', () => {
    const onSelectCapability = vi.fn();
    const onSelectStory = vi.fn();
    const outer = vi.fn();
    const { container } = render(
      <svg onClick={outer}>
        <WorldSceneView
          model={normalizeWorldPresentationModel({ scene: scene(), nativePropTargetLayer: LAYER })}
          events={{ onSelectCapability, onSelectStory }}
        />
      </svg>,
    );
    fireEvent.click(container.querySelector('rect[data-cap-id="cap-mid"]')!);

    expect(onSelectCapability).toHaveBeenCalledTimes(1);
    expect(onSelectCapability).toHaveBeenCalledWith('story-b', 'cap-mid');
    expect(onSelectStory).not.toHaveBeenCalled();
    expect(outer).not.toHaveBeenCalled();
  });

  it('follows the regrow: an island not yet on the map has no native targets', () => {
    const { container } = render(
      <svg>
        <WorldSceneView
          model={normalizeWorldPresentationModel({
            scene: scene(),
            nativePropTargetLayer: LAYER,
            forestRegrowLayer: regrowHiding(['story-a']),
          })}
        />
      </svg>,
    );
    expect([...container.querySelectorAll('g.native-prop-targets > rect')].map((r) => r.getAttribute('data-cap-id'))).toEqual(['cap-mid']);
  });

  it('marks legend-hidden statuses and draws nothing without a layer', () => {
    const filtered = render(
      <svg>
        <WorldSceneView model={normalizeWorldPresentationModel({ scene: scene(), nativePropTargetLayer: LAYER, hiddenStatuses: ['healthy'] })} />
      </svg>,
    );
    expect(filtered.container.querySelector('rect[data-cap-id="cap-far"]')!.getAttribute('class')).toBe('native-prop-target st-healthy is-filtered');
    filtered.unmount();

    const none = render(
      <svg>
        <WorldSceneView model={normalizeWorldPresentationModel({ scene: scene() })} />
      </svg>,
    );
    expect(none.container.querySelector('g.native-prop-targets')).toBeNull();
  });
});
