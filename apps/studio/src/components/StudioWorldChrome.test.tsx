// @vitest-environment jsdom
//
// Stage-1 red-green of the studio-only world CHROME overlay (ADR-0093 Unit D): with the shared
// scene-graph now the DEFAULT render, the chrome that lived ONLY in the inline `<g>` — the
// distributed-consumer building STAMPS (`Territory.stamps`) and the per-nameplate identity-key
// glyph — is layered ON TOP of `<SceneView>` (ADR-0093 Decision 2: studio chrome layers on top,
// never pushed into the shared core). This pins that the overlay still emits them, so the flip to
// scene-default regresses nothing. The chrome's PLACEMENT inside the one `<svg>` is wiring
// (typecheck + the operator-attested deep-link); its content is pinned here.
//
// The overlay's third piece, the solar spokes, went with ADR-0283 D2: the radial layout that
// populated `world.solar` is retired, the field is off `HexWorld`, and the two cases that used to
// hand-build one to exercise the guarded pass are gone with the branch they covered.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { StudioWorldChrome, type HexWorld } from './TreeView';

afterEach(cleanup);

// The story rows carry the WHOLE `TreeStory` (anti-slop `no-chained-type-assertions`, inc-09): the
// `as unknown as HexWorld` chain hid five missing fields — `outcome`, `proofMode`, `uatWitness`,
// `dependsOn`, `consumedBy` — so the chrome under test was reading a world no server would send.
/** A minimal world with two territories (one carrying stamps). */
function mkWorld(): HexWorld {
  const base = {
    width: 200,
    height: 200,
    offset: { x: 0, y: 0 },
    empties: [],
    drawTiles: [],
    trails: { segments: [], edges: [], caves: [], dropped: [] },
    territories: [
      {
        story: {
          id: 'studio',
          title: 'Studio',
          outcome: '',
          status: 'healthy',
          proofMode: 'red-green',
          uatWitness: 'human',
          dependsOn: [],
          consumedBy: [],
          capabilities: [],
        },
        tiles: [],
        centroid: { x: 50, y: 50 },
        radius: 30,
        groundRadius: 30,
        treeSpot: { x: 50, y: 45 },
        // ADR-0527 D1: these fixtures exercise studio CHROME (pan, panels), which reads the
        // SCREEN anchors above; the ground twins are stated so the literal satisfies
        // `Territory` and are deliberately the same numbers — this chrome never projects.
        groundCentroid: { x: 50, y: 50 },
        groundTreeSpot: { x: 50, y: 45 },
        // The pre-snap ground anchor (`Territory.groundSeed`). Chrome never reads it; it is here
        // because the packer always emits it, and a fixture that omitted it would not be a world.
        groundSeed: { x: 50, y: 45 },
        caps: [],
        decor: [],
        wheatTiles: new Set<string>(),
        coastGroundLoops: [],
        labelY: 80,
        // its GROUND twin (ADR-0545) — the baseline the marker scatter reads; 80 / sin 20 degrees
        groundLabelY: 80 / Math.sin((20 * Math.PI) / 180),
        // studio carries two identity stamps (library + cli).
        stamps: [
          { icon: 'library', spot: { x: 40, y: 50 } },
          { icon: 'cli', spot: { x: 60, y: 50 } },
        ],
        buildingGlyph: false,
      },
      {
        story: {
          id: 'cli',
          title: 'Cli',
          outcome: '',
          status: 'healthy',
          proofMode: 'red-green',
          uatWitness: 'human',
          dependsOn: [],
          consumedBy: [],
          capabilities: [],
        },
        tiles: [],
        centroid: { x: 150, y: 50 },
        radius: 30,
        groundRadius: 30,
        treeSpot: { x: 150, y: 45 },
        // ADR-0527 D1: these fixtures exercise studio CHROME (pan, panels), which reads the
        // SCREEN anchors above; the ground twins are stated so the literal satisfies
        // `Territory` and are deliberately the same numbers — this chrome never projects.
        groundCentroid: { x: 150, y: 50 },
        groundTreeSpot: { x: 150, y: 45 },
        groundSeed: { x: 150, y: 45 },
        caps: [],
        decor: [],
        wheatTiles: new Set<string>(),
        coastGroundLoops: [],
        labelY: 80,
        // its GROUND twin (ADR-0545) — the baseline the marker scatter reads; 80 / sin 20 degrees
        groundLabelY: 80 / Math.sin((20 * Math.PI) / 180),
        stamps: [],
        buildingGlyph: false,
      },
    ],
  } satisfies Partial<HexWorld> as HexWorld;
  return base;
}

function renderChrome(world: HexWorld, onStampClick = vi.fn(), buildings = true): HTMLElement {
  const { container } = render(
    <svg>
      <StudioWorldChrome
        world={world}
        hidden={new Set()}
        onStampClick={onStampClick}
        buildings={buildings}
      />
    </svg>,
  );
  return container;
}

describe('StudioWorldChrome — the on-top studio chrome overlay', () => {
  it('renders the distributed-consumer building stamps each island carries', () => {
    const root = renderChrome(mkWorld());
    // studio carries two stamps; cli carries none → exactly two stamps in the overlay.
    expect(root.querySelectorAll('.story-icon-stamp').length).toBe(2);
  });

  it('renders the per-nameplate identity-key glyph for every island (parity with the legacy render)', () => {
    // ADR-0102: each island shows its OWN identity building beside its name tag — studio chrome the
    // inline/legacy path drew but the shared scene-graph does NOT, so the default flip must restore
    // it or a familiar element regresses. One key glyph per territory (two here).
    const root = renderChrome(mkWorld());
    const keys = root.querySelectorAll('.world-plate-key');
    expect(keys.length).toBe(2);
    // each key wraps a real IconGlyph (the .story-icon-art body), not an empty group.
    expect(keys[0]?.querySelector('.story-icon-art')).toBeTruthy();
  });

  it('omits the identity-key glyph when buildings is off (ADR-0228 default — clean nameplates)', () => {
    // The default map is buildings-off: the hubs are ordinary islands, dependencies ride pathways,
    // and the little house key glyph — the decoder for the (now absent) stamps — is gone.
    const root = renderChrome(mkWorld(), vi.fn(), false);
    expect(root.querySelectorAll('.world-plate-key').length).toBe(0);
  });

  it('a stamp click highlights the shared island it names (onStampClick wired through)', () => {
    const onStampClick = vi.fn();
    const root = renderChrome(mkWorld(), onStampClick);
    const stamp = root.querySelector('.story-icon-stamp.is-link');
    expect(stamp).toBeTruthy();
    fireEvent.click(stamp!);
    expect(onStampClick).toHaveBeenCalledTimes(1);
    // it names one of the carried building ids.
    expect(['library', 'cli']).toContain(onStampClick.mock.calls[0]?.[0]);
  });
});
