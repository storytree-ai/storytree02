// @vitest-environment jsdom
//
// Stage-1 red-green of the studio scene MAPPER (ADR-0093 Unit 2b), as the map's INTERACTION layer
// since ADR-0608: the role → studio-class translation for what this layer still draws (nameplates,
// wisps, hit geometry, caves, the selection lanes and shore rings), the per-node handlers, and the
// SKIPS — the flat picture the 3D land now draws is not rendered here at all. The GEOMETRY is the
// core's (forest-world/scene.test.ts); here we trust it and pin the React translation.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import {
  buildScene,
  trailFillWidth,
  TILE_SCALE,
  type BuildPhase,
  type ClaimColourState,
  type ClaimGrade,
  type SceneInput,
  type SceneNode,
  type SceneTerritoryInput,
  type SceneTrailsInput,
} from '@storytree/forest-world';
import { neighbourHighlightPlan } from './neighbourHighlight.js';
import { laneLayout } from './laneLayout.js';
import { SceneView, litLaneWidth, laneDrawSeconds, type SceneCtx } from './SceneView.js';
import type { NativePropTargetRenderLayer } from './native-prop-targets.js';
import { shippedCtx, shippedTerritory } from './scene-fixture.js';

afterEach(cleanup);

/** A tiny hand-built ADR-0169 trail network: the a→lib edge rides two shared-able
 *  segments (tseg1 a spur, tseg2 the trunk-side approach), the lib→b edge bores a
 *  hidden under-island run (tseg3) through a cave portal on lib's rim. */
function mkTrails(): SceneTrailsInput {
  return {
    segments: [
      {
        id: 'tseg1',
        d: 'M 0 0 C 10 0 20 0 30 0',
        points: [{ x: 0, y: 0 }, { x: 30, y: 0 }],
        usage: 1,
        hidden: false,
      },
      {
        id: 'tseg2',
        d: 'M 30 0 C 40 0 50 0 60 0',
        points: [{ x: 30, y: 0 }, { x: 60, y: 0 }],
        usage: 2,
        hidden: false,
      },
      {
        id: 'tseg3',
        d: 'M 60 0 C 70 0 80 0 90 0',
        points: [{ x: 60, y: 0 }, { x: 90, y: 0 }],
        usage: 1,
        hidden: true,
      },
    ],
    edges: [
      {
        from: 'a',
        to: 'lib',
        title: 'lib depends on a',
        segments: [
          { id: 'tseg1', reversed: false },
          { id: 'tseg2', reversed: false },
        ],
      },
      { from: 'lib', to: 'b', segments: [{ id: 'tseg3', reversed: false }] },
    ],
    caves: [
      { islandId: 'lib', x: 55, y: 5, bearing: Math.PI / 2, width: 4.5, edgeIds: ['lib->b'] },
    ],
    dropped: [],
  };
}

function mkInput(
  wispPhase?: BuildPhase,
  claimState: ClaimColourState = 'authoring',
  claimGrade?: ClaimGrade,
  departures?: { key: string; title: string; ageRatio: number }[],
  /** ADR-0212: a live build folded onto the work claim — the merged band. */
  claimPhase?: BuildPhase,
): SceneInput {
  // The wisp, the claim and the territory each carry OPTIONAL fields this fixture only sometimes
  // supplies. Each is drafted against its own named field type and the optional key is assigned
  // only when the argument is present — an omitted argument leaves the key ABSENT, as before.
  // (`buildScene` reads these by name, so key insertion order here is inert.)
  const wisp: SceneTerritoryInput['wisps'][number] = { runId: 'r1', title: 'building' };
  if (wispPhase) wisp.phase = wispPhase;
  const claim: NonNullable<SceneTerritoryInput['claims']>[number] = {
    key: 's1',
    title: 'a session is working lib',
    colourState: claimState,
  };
  if (claimGrade) claim.grade = claimGrade;
  if (claimPhase) claim.phase = claimPhase;
  const territory: SceneTerritoryInput = {
    id: 'lib',
    status: 'healthy',
    caps: 2,
    centroid: { x: 50, y: 50 },
    groundRadius: 30,
    screenRadius: 30,
    treeSpot: { x: 50, y: 45 },
    labelY: 80,
    coastGroundLoops: [[{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]],
    decor: [{ x: 40, y: 40, seed: 5 }],
    plants: [{ id: 'lib#c', status: 'unhealthy', x: 45, y: 55, title: 'cap c' }],
    treeTitle: 'lib — healthy',
    signpost: { outcome: null },
    wisps: [wisp],
    claims: [claim],
    plate: { w: 60, h: 33, rx: 7, idY: 14, subY: 27, idText: 'lib', subText: 'healthy · 2 caps', title: 'Library' },
  };
  if (departures) territory.departures = departures;
  return {
    offset: { x: 0, y: 0 },
    width: 100,
    height: 100,
    empties: [],
    relaxedCells: [
      { owner: 0, poly: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], variant: 1, wheat: false },
      { owner: 0, poly: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }], variant: 0, wheat: true },
    ],
    drawTiles: [],
    wheatSets: [new Set()],
    trails: mkTrails(),
    // SHIPPED-MAP SHAPED (`render-fixtures-default-to-the-shipped-map`): `relaxedCells` non-null AND
    // the island carrying the `parcels` the studio sends for every capability-bearing story, so the
    // capability's ground parcel — its hit geometry on this layer — is present.
    territories: [shippedTerritory(territory)],
  };
}

/** The shipped map's ctx for this file: `shippedCtx`'s defaults plus this suite's focus class,
 *  legend filter and spies. */
function mkCtx(over: Partial<SceneCtx> = {}): SceneCtx {
  return shippedCtx({
    territoryClassById: (id, status) => `hex-territory st-${status}${id === 'lib' ? ' is-focus' : ''}`,
    hidden: new Set(['unhealthy']),
    onSelectStory: vi.fn(),
    onSelectCap: vi.fn(),
    ...over,
  });
}

function mountScene(input: SceneInput, ctx: SceneCtx) {
  const { container } = render(
    <svg>
      <SceneView scene={buildScene(input)} ctx={ctx} />
    </svg>,
  );
  return { root: container, ctx };
}

function renderScene(
  over: Partial<SceneCtx> = {},
  wispPhase?: BuildPhase,
  claimState?: ClaimColourState,
  claimGrade?: ClaimGrade,
  departures?: { key: string; title: string; ageRatio: number }[],
  claimPhase?: BuildPhase,
): {
  root: HTMLElement;
  ctx: SceneCtx;
} {
  return mountScene(mkInput(wispPhase, claimState, claimGrade, departures, claimPhase), mkCtx(over));
}

// ---------- a realistic three-island forest (ADR-0608's retirement fixture) ----------

const tri = (x: number, y: number): { x: number; y: number }[] => [
  { x, y },
  { x: x + 10, y },
  { x: x + 5, y: y + 10 },
];

/** One island of the realistic forest. `a` carries decor + plants and NO parcels (so the core emits
 *  its conifers and its one-plant-per-cap flora), `lib` carries parcels (so it emits parcel flora) and
 *  UAT criteria (so it emits the tall flowers), `b` is a plain parcels island. */
function forestIsland(id: string, dx: number, over: Partial<SceneTerritoryInput> = {}): SceneTerritoryInput {
  return {
    id,
    status: 'healthy',
    caps: 1,
    centroid: { x: dx + 15, y: 15 },
    groundRadius: 18,
    screenRadius: 18,
    treeSpot: { x: dx + 15, y: 12 },
    labelY: 35,
    coastGroundLoops: [[{ x: dx, y: 0 }, { x: dx + 30, y: 0 }, { x: dx + 30, y: 30 }, { x: dx, y: 30 }]],
    decor: [{ x: dx + 5, y: 5, seed: 5 }],
    plants: [{ id: `${id}#c`, status: 'unhealthy', x: dx + 10, y: 20, title: `${id} cap` }],
    treeTitle: `${id} — healthy`,
    wisps: [],
    claims: [],
    plate: { w: 30, h: 14, rx: 3, idY: 6, subY: 11, idText: id, subText: 'healthy', title: id },
    ...over,
  };
}

/** A forest carrying EVERY picture kind ADR-0608 retired from this layer: the empty board, hero trees
 *  (procedural, or — with `vegetation` — the baked `<use>` hero and its defs), conifers, plant flora,
 *  parcel flora, the three UAT flower states, and the four road passes. */
function realisticForestInput(withVegetation: boolean): SceneInput {
  const input: SceneInput = {
    offset: { x: 0, y: 0 },
    width: 200,
    height: 60,
    empties: [
      { q: 0, r: 0, owner: 0 },
      { q: 4, r: 4 },
    ],
    relaxedCells: [
      { owner: 0, poly: tri(0, 0), variant: 0, wheat: false },
      { owner: 0, poly: tri(10, 10), variant: 1, wheat: true },
      { owner: 1, poly: tri(50, 0), variant: 0, wheat: false },
      { owner: 1, poly: tri(60, 10), variant: 2, wheat: false },
      { owner: 2, poly: tri(90, 0), variant: 1, wheat: false },
    ],
    drawTiles: [],
    wheatSets: [new Set(), new Set(), new Set()],
    trails: mkTrails(),
    territories: [
      forestIsland('a', 0),
      shippedTerritory(
        forestIsland('lib', 50, {
          uatCriteria: [
            { id: 'lib:c1', state: 'proven' },
            { id: 'lib:c2', state: 'pending' },
            { id: 'lib:c3', state: 'failing' },
          ],
        }),
      ),
      shippedTerritory(forestIsland('b', 90)),
    ],
  };
  if (withVegetation) {
    input.vegetation = {
      heroTrees: {
        healthy: {
          nodes: [{ el: 'polygon', points: '-12,2 12,2 0,-40', fill: '#85583a', stroke: '#6a563c', strokeWidth: 1 }],
          width: 24,
          height: 42,
        },
      },
    };
  }
  return input;
}

/** Every `d` drawn by a node inside a subtree of the given kinds — the geometry a retired kind would
 *  leak into the DOM if the skip were lost. */
function dsUnder(node: SceneNode, kinds: ReadonlySet<string>, inside = false): string[] {
  const here = inside || (node.kind !== undefined && kinds.has(node.kind));
  const own = here && 'd' in node && typeof node.d === 'string' ? [node.d] : [];
  const kids = node.el === 'g' ? node.children.flatMap((c) => dsUnder(c, kinds, here)) : [];
  return [...own, ...kids];
}

/** Every kind anywhere in the scene tree. */
function kindsIn(node: SceneNode): Set<string> {
  const out = new Set<string>(node.kind ? [node.kind] : []);
  if (node.el === 'g') for (const c of node.children) for (const k of kindsIn(c)) out.add(k);
  return out;
}

describe('SceneView — the studio scene mapper', () => {
  it('the SHARED default ctx classes every island by its folded status — the nameplate and ground hooks', () => {
    // `shippedCtx()` with NO override is what a mapper test gets by default; its island class must
    // carry the status the scene folded, or the status-keyed nameplate rules read nothing.
    const input = realisticForestInput(true);
    const { root } = mountScene(input, shippedCtx());
    const islands = [...root.querySelectorAll('g.hex-flora[data-story-id]')];
    expect(islands.length).toBe(input.territories.length);
    for (const t of input.territories) {
      const g = root.querySelector(`g.hex-flora[data-story-id="${t.id}"]`);
      expect(g?.getAttribute('class')).toContain(`hex-territory st-${t.status}`);
    }
  });

  it('is React.memo-wrapped so a pan (identical scene + ctx) skips the O(nodes) re-walk (ADR-0069)', () => {
    // Pan perf rests on this: a pointermove pans by moving the parent camera <g>, re-rendering
    // TreeView; because TreeView hands stable `scene` + `ctx` identities, memo bails out here and the
    // whole scene subtree is NOT re-walked — this pins the wrapper in place. The memo stays required
    // (ADR-0272 keeps it explicitly), but it is NOT the pan lag the owner feels: measured, the walk is
    // ~3% of a gesture frame and the rest is rasterisation, which ADR-0272 decision 2 addresses.
    expect((SceneView as { $$typeof?: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('applies the focus-aware island class to the island nameplate group', () => {
    const { root } = renderScene();
    // the island group folds in territoryClassById (focus)
    const terr = root.querySelector('.hex-flora');
    expect(terr?.classList.contains('is-focus')).toBe(true);
    expect(terr?.getAttribute('data-story-id')).toBe('lib');
  });

  it('renders the generous per-story hit rect at the BACK — transparent, behind the flora', () => {
    const { root } = renderScene();
    // the hit rect's tell is its corner: 14 on the tuned tile, re-based onto the derived one (ADR-0528).
    // It IS rendered now (the studio uses it for forgiving node-click at the zoomed-out contain fit),
    // and transparent so it never paints over the world.
    const hit = [...root.querySelectorAll('rect')].find((r) => r.getAttribute('rx') === (14 * TILE_SCALE).toFixed(1));
    expect(hit).toBeTruthy();
    expect(hit?.getAttribute('fill')).toBe('transparent');
    expect(hit?.classList.contains('world-story-hit')).toBe(true);
    // it sits BEHIND the flora in document/paint order, so island tiles + plants still win their own
    // clicks: the nameplate (a flora descendant) must FOLLOW the hit rect in the document.
    const plate = root.querySelector('.world-plate-bg')!;
    expect(hit!.compareDocumentPosition(plate) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('slots the hit layer directly before the island ground, so the ground and parcels win their own clicks', () => {
    const { root } = renderScene();
    const world = root.querySelector('svg > g')!;
    const order = [...world.children].map((el) => el.getAttribute('class') ?? '');
    const hits = [...world.children].findIndex((el) => el.querySelector(':scope > .world-story-hit'));
    // `buildScene` appends the hit layer LAST; the mapper moves it to sit right before the ground.
    expect(hits).toBeGreaterThan(-1);
    expect(order[hits + 1]).toBe('relaxed-land');
    expect(hits).toBeLessThan(order.length - 1);
  });

  it('selects the story when its generous hit rect is clicked (forgiving node-click)', () => {
    const onSelectStory = vi.fn();
    const { root } = renderScene({ onSelectStory });
    const hit = [...root.querySelectorAll('rect')].find((r) => r.getAttribute('rx') === (14 * TILE_SCALE).toFixed(1))!;
    fireEvent.click(hit);
    expect(onSelectStory).toHaveBeenCalledWith('lib');
  });

  it('drives an animated wisp orbit + an aria-hidden-free render of the static look', () => {
    const { root } = renderScene();
    const wisp = root.querySelector('.world-wisp.band-building');
    expect(wisp).toBeTruthy();
    expect(wisp?.querySelector('animateTransform')).toBeTruthy();
  });

  it('colours the wisp band by the live gate phase (ADR-0048 §3 v2)', () => {
    // a CONFIRM_RED build → a red-band wisp (and never a stale building band).
    const red = renderScene({}, 'CONFIRM_RED').root;
    expect(red.querySelector('.world-wisp.band-red')).toBeTruthy();
    expect(red.querySelector('.world-wisp.band-building')).toBeNull();
    // a GATE build → a green-band wisp.
    const green = renderScene({}, 'GATE').root;
    expect(green.querySelector('.world-wisp.band-green')).toBeTruthy();
    // an absent phase keeps the neutral teal building band (back-compat).
    const none = renderScene().root;
    expect(none.querySelector('.world-wisp.band-building')).toBeTruthy();
    expect(none.querySelector('.world-wisp.band-red')).toBeNull();
    // the orbit still animates regardless of band.
    expect(red.querySelector('.world-wisp.band-red animateTransform')).toBeTruthy();
  });

  it('maps a story-claim wisp to a DISTINCT class + an animated orbit (ADR-0138 §5)', () => {
    const { root } = renderScene({}, undefined, 'authoring');
    const claim = root.querySelector('.world-claim-wisp.state-authoring');
    expect(claim).toBeTruthy();
    // it carries its own glow/dot parts and a transparent hit — its OWN family, not the build wisp's.
    expect(claim?.querySelector('.world-claim-wisp-glow')).toBeTruthy();
    expect(claim?.querySelector('.world-claim-wisp-dot')).toBeTruthy();
    expect(root.querySelector('.world-claim-wisp-hit')?.getAttribute('fill')).toBe('transparent');
    // it orbits (the rotation is geometry, seeded from the claim key).
    expect(claim?.querySelector('animateTransform')).toBeTruthy();
  });

  it('colours the claim wisp by the subagent colour-state (authoring / proving / supplementing)', () => {
    expect(renderScene({}, undefined, 'authoring').root.querySelector('.world-claim-wisp.state-authoring')).toBeTruthy();
    expect(renderScene({}, undefined, 'proving').root.querySelector('.world-claim-wisp.state-proving')).toBeTruthy();
    expect(
      renderScene({}, undefined, 'supplementing').root.querySelector('.world-claim-wisp.state-supplementing'),
    ).toBeTruthy();
  });

  it('aswv-claim-wisp-never-painted-as-proven-green: §5 HONESTY WALL: a claim wisp NEVER wears the proven-green status class (class-level)', () => {
    // The at-risk state is "proving" (the in-flight hue that must NOT read as proven). The wall used
    // to be stated against the verdict bloom's `world-bloom`/`verdict-pass` classes; ADR-0529/0536
    // deleted those class strings from the mapper outright, so asserting their absence would now
    // assert something the code cannot produce — a check that verifies nothing. The proof
    // vocabulary the map still carries is the island's folded STATUS hue (`st-healthy`, composed by
    // `withFilter`/`territoryClassById`), and THAT is what a coordination drawable must never wear.
    const { root } = renderScene({}, undefined, 'proving');
    const claim = root.querySelector('.world-claim-wisp.state-proving')!;
    expect(claim).toBeTruthy();
    // the claim wisp itself carries no folded status at all …
    expect(claim.getAttribute('class') ?? '').not.toMatch(/\bst-/);
    // … and no descendant under the claim orbit carries one either.
    expect(claim.querySelector('[class*="st-"]')).toBeNull();
  });

  it('maps a hovering (exploring-grade) claim to a DISTINCT class family on a SMALL LOCAL orbit (ADR-0212)', () => {
    const { root } = renderScene({}, undefined, 'proving', 'exploring');
    const hover = root.querySelector('.world-hover-wisp.state-proving');
    expect(hover).toBeTruthy();
    // its own glow/dot parts and a transparent hit — its OWN family, not claim-wisp's / wisp's.
    expect(hover?.querySelector('.world-hover-wisp-glow')).toBeTruthy();
    expect(hover?.querySelector('.world-hover-wisp-dot')).toBeTruthy();
    expect(root.querySelector('.world-hover-wisp-hit')?.getAttribute('fill')).toBe('transparent');
    // ADR-0212 REVERSES ADR-0200 D7's stationary rule: window shopping now spins. What keeps it
    // distinct from the work stage is POSITION (a small orbit beside the island) and SPEED.
    const spin = hover?.querySelector('animateTransform');
    expect(spin).toBeTruthy();
    expect(spin?.getAttribute('dur')).toBe('14s');
    // ⚠ THE NESTING IS THE CONTRACT: the rotate REPLACES `transform` on the node it animates, so the
    // rest spot must live on the PARENT g and the orbit radius on a CHILD g. If a future refactor
    // flattens these, the rest-spot translate is silently clobbered and the dot sweeps the island
    // centroid instead of hovering beside the tree — a bug that looks like "the map went wrong".
    expect(hover?.getAttribute('transform')).toBeNull();
    expect(hover?.parentElement?.getAttribute('transform')).toMatch(/^translate\(/);
    const arm = [...(hover?.children ?? [])].find((c) => c.tagName === 'g');
    // the arm's body wears the tile's drawing scale (ADR-0528); the orbit radius is still a plain translate
    expect(arm?.getAttribute('transform')).toMatch(/^translate\([\d.]+ 0\) scale\([\d.]+\)$/);
    expect(root.querySelector('.world-claim-wisp')).toBeNull();
  });

  it('maps a queued (waiting-grade) claim to a DISTINCT, STATIONARY class family (ADR-0200 D7)', () => {
    const { root } = renderScene({}, undefined, 'supplementing', 'waiting');
    const queue = root.querySelector('.world-queue-wisp.state-supplementing');
    expect(queue).toBeTruthy();
    expect(queue?.querySelector('.world-queue-wisp-glow')).toBeTruthy();
    expect(queue?.querySelector('.world-queue-wisp-dot')).toBeTruthy();
    expect(root.querySelector('.world-queue-wisp-hit')?.getAttribute('fill')).toBe('transparent');
    expect(queue?.querySelector('animateTransform')).toBeNull();
    expect(root.querySelector('.world-claim-wisp')).toBeNull();
  });

  it('ADR-0212: a live build rides the work claim as a band class on the SAME body — one wisp, not two', () => {
    const { root } = renderScene({}, undefined, 'proving', 'work', undefined, 'IMPLEMENT');
    const claim = root.querySelector('.world-claim-wisp.state-proving.band-building');
    expect(claim).toBeTruthy();
    // ONE orbiting claim body — the whole point. The build contributes a class, never a sibling.
    expect(root.querySelectorAll('.world-claim-wisp').length).toBe(1);
    // and it quickens: a banded body orbits at the retired build wisp's 6s, not the idle 9s.
    expect(claim?.querySelector('animateTransform')?.getAttribute('dur')).toBe('6s');
    // no band when nothing builds — back-compat, and the idle orbit stays calm.
    const { root: idle } = renderScene({}, undefined, 'proving', 'work');
    const idleClaim = idle.querySelector('.world-claim-wisp');
    expect(idleClaim?.getAttribute('class') ?? '').not.toMatch(/band-/);
    expect(idleClaim?.querySelector('animateTransform')?.getAttribute('dur')).toBe('9s');
  });

  it('aswv-claim-wisp-never-painted-as-proven-green: ADR-0212 honesty wall: a GREEN build band never paints the claim body as a proof', () => {
    // GATE → the green band, the case ADR-0138 §5 is most at risk from under the merge.
    const { root } = renderScene({}, undefined, 'proving', 'work', undefined, 'GATE');
    const claim = root.querySelector('.world-claim-wisp.band-green');
    expect(claim).toBeTruthy();
    // The INTENT hue survives untouched — green is expressed as motion, never as colour.
    expect(claim?.classList.contains('state-proving')).toBe(true);
    // and NOTHING proof-shaped is anywhere on the claim layer: no folded status class, on the body
    // or under it. (This asserted the absence of the verdict bloom's classes until ADR-0529/0536
    // deleted them from the mapper; the surviving proof signal is the `st-healthy` island hue.)
    const cls = claim?.getAttribute('class') ?? '';
    expect(cls).not.toMatch(/\bst-/);
    expect(claim?.querySelector('[class*="st-"]')).toBeNull();
  });

  it('an absent grade still orbits (the ADR-0200 D2 back-compat default, regression lock)', () => {
    const { root } = renderScene({}, undefined, 'authoring', undefined);
    const claim = root.querySelector('.world-claim-wisp.state-authoring');
    expect(claim).toBeTruthy();
    expect(claim?.querySelector('animateTransform')).toBeTruthy();
    expect(root.querySelector('.world-hover-wisp')).toBeNull();
    expect(root.querySelector('.world-queue-wisp')).toBeNull();
  });

  it('maps a departing claim to a fading, STATIONARY, colourless class — opacity derived from ageRatio (ADR-0200 D7)', () => {
    const { root } = renderScene({}, undefined, undefined, undefined, [
      { key: 'd1', title: 'lib — a session departed 1m ago (was work) — no longer claimed', ageRatio: 0.25 },
    ]);
    const departing = root.querySelector('.world-departing-wisp');
    expect(departing).toBeTruthy();
    // 1 - ageRatio, deterministic (SceneView folds ageRatio → opacity, not a CSS-only illusion).
    expect(departing?.getAttribute('opacity')).toBe('0.75');
    expect(departing?.querySelector('animateTransform')).toBeNull();
    expect(departing?.querySelector('.world-departing-wisp-glow')).toBeTruthy();
    expect(root.querySelector('.world-departing-wisp-hit')?.getAttribute('fill')).toBe('transparent');
  });

  it('aswv-claim-wisp-never-painted-as-proven-green: §5 HONESTY WALL extended: hover / queue / departing wisps never wear the proven-green status class (ADR-0200 D7)', () => {
    // Same re-expression as the two walls above: the verdict bloom's classes are gone from the
    // mapper (ADR-0529/0536), so the falsifiable statement is that no claim-GRADE family carries the
    // island's folded `st-*` hue — on the body or under it.
    const noStatus = (el: Element, label: string): void => {
      expect(el.getAttribute('class') ?? '', label).not.toMatch(/\bst-/);
      expect(el.querySelector('[class*="st-"]'), label).toBeNull();
    };

    noStatus(renderScene({}, undefined, 'proving', 'exploring').root.querySelector('.world-hover-wisp')!, 'hover');
    noStatus(renderScene({}, undefined, 'proving', 'waiting').root.querySelector('.world-queue-wisp')!, 'queue');
    noStatus(
      renderScene({}, undefined, undefined, undefined, [{ key: 'd1', title: 'departed', ageRatio: 0.5 }]).root.querySelector(
        '.world-departing-wisp',
      )!,
      'departing',
    );
  });

  it('selects the story on an island click', () => {
    const onSelectStory = vi.fn();
    const { root } = renderScene({ onSelectStory });
    fireEvent.click(root.querySelector('.hex-flora')!);
    expect(onSelectStory).toHaveBeenCalledWith('lib');
  });

  it('selects the capability on a parcel click (stopping propagation) — the SHIPPED map parcel route', () => {
    // `shipped-map-render-path-drops-three-delivered-behaviours` defect 3: `handlersFor` wired
    // `onSelectCap` on the `flora` kind ONLY, but the shipped map's `parcel` groups (which carry the
    // capId) had no handler at all — the mapper's only capability-select route was attached to a
    // drawable the map no longer draws.
    const onSelectStory = vi.fn();
    const onSelectCap = vi.fn();
    const { root } = renderScene({ onSelectStory, onSelectCap });
    fireEvent.click(root.querySelector('.parcel.st-unhealthy')!);
    expect(onSelectCap).toHaveBeenCalledWith('lib', 'lib#c');
    expect(onSelectStory).not.toHaveBeenCalled(); // stopPropagation
  });

  it('marks an arriving island on its nameplate group, and only there (arrival staging)', () => {
    // 'lib' is the arriving island (the 3D layer stages the land; this layer stages the nameplate).
    const { root } = renderScene({ arrivalIds: new Set(['lib', 'b']) });
    const arriving = [...root.querySelectorAll('[class*="arrive"]')];
    expect(arriving).toHaveLength(1);
    expect(arriving[0]!.classList.contains('hex-flora')).toBe(true);
    expect(arriving[0]!.classList.contains('arrive-island')).toBe(true);
    expect(arriving[0]!.getAttribute('data-story-id')).toBe('lib');
  });

  it('renders zero arrival artifacts when no story is entering (the steady-state board)', () => {
    const { root } = renderScene();
    expect(root.querySelector('[class*="arrive"]')).toBeNull();
    // an arrival set that names no rendered story is equally inert.
    const other = renderScene({ arrivalIds: new Set(['not-here']) }).root;
    expect(other.querySelector('[class*="arrive"]')).toBeNull();
  });

  it('selects the story from its island hit group, and does NOT wire hover (owner 2026-07-06)', () => {
    const onSelectStory = vi.fn();
    const { root } = renderScene({ onSelectStory });
    // hover-driven highlight was removed (the mousemove recolour was the lag): mousing
    // over an island fires no handler, but a CLICK still selects it.
    const hit = root.querySelector('.world-story-hit') ?? root.querySelector('.hex-flora')!;
    fireEvent.mouseEnter(hit);
    fireEvent.mouseLeave(hit);
    fireEvent.click(root.querySelector('.world-story-hit')!);
    expect(onSelectStory).toHaveBeenCalledWith('lib');
  });
});

// ADR-0608 D2/D3: the flat picture is the 3D land's now. Its kinds are SKIPPED — not hidden — so none
// of their DOM exists, while the scene they come from is unchanged (the precondition in each case).
describe('SceneView — the retired flat picture (ADR-0608)', () => {
  const RETIRED = new Set([
    'empties-layer',
    'baked-defs',
    'trail-shadow-pass',
    'trail-casing-pass',
    'trail-ghost-pass',
    'tree',
    'baked-art',
    'flora',
    'parcel-flora',
    'conifer',
    'tall-flower-proven',
    'tall-flower-pending',
    'tall-flower-failing',
  ]);

  for (const withVegetation of [false, true]) {
    it(`renders none of the retired picture kinds on a realistic forest (${withVegetation ? 'baked hero trees' : 'procedural trees'})`, () => {
      const input = realisticForestInput(withVegetation);
      const scene = buildScene(input);
      // precondition: the scene really does carry the picture — otherwise every absence is vacuous.
      const kinds = kindsIn(scene);
      const expected = withVegetation
        ? ['empties-layer', 'baked-defs', 'baked-art', 'conifer', 'flora', 'parcel-flora', 'tall-flower-proven', 'tall-flower-pending', 'tall-flower-failing', 'trail-shadow-pass', 'trail-casing-pass', 'trail-ghost-pass']
        : ['empties-layer', 'tree', 'conifer', 'flora', 'parcel-flora', 'tall-flower-proven', 'tall-flower-pending', 'tall-flower-failing', 'trail-shadow-pass', 'trail-casing-pass', 'trail-ghost-pass'];
      for (const k of expected) expect(kinds.has(k), k).toBe(true);

      const { root } = mountScene(input, mkCtx());
      for (const sel of [
        '.hex-empty',
        '.story-tree',
        '.conifer',
        '.garden-flora',
        '.parcel-flora',
        '.tall-flower-marker',
        '.trail-shadow-pass',
        '.trail-casing-pass',
        '.trail-ghost-pass',
        'path.trail-fill',
        'image',
        'use',
        'defs',
      ]) {
        expect(root.querySelector(sel), sel).toBeNull();
      }
      // no retired geometry reaches the DOM under ANY class — a lost skip would leak its paths even
      // if it lost its class vocabulary too.
      const drawn = new Set([...root.querySelectorAll('path')].map((p) => p.getAttribute('d')));
      const retiredDs = dsUnder(scene, RETIRED);
      expect(retiredDs.length).toBeGreaterThan(0);
      for (const d of retiredDs) expect(drawn.has(d), d).toBe(false);
      // the road fills ride the fill pass the lanes use, and are not drawn either.
      const fillDs = dsUnder(scene, new Set(['trail-fill']));
      expect(fillDs.length).toBeGreaterThan(0);
      for (const d of fillDs) expect(drawn.has(d), d).toBe(false);
    });
  }

  it('the world group holds exactly the interaction layers — no empty picture group is left behind', () => {
    const { root } = mountScene(realisticForestInput(true), mkCtx());
    const world = root.querySelector('svg > g')!;
    // coast rings, the hit layer, the ground hit geometry, the trail net, the nameplate/wisp layer.
    // A retired LAYER that lost its skip would add a classless group here even with nothing inside.
    expect([...world.children].map((el) => el.getAttribute('class') ?? '')).toEqual([
      'hex-coastland',
      '',
      'relaxed-land',
      'trail-net',
      '',
    ]);
    const trailNet = root.querySelector('.trail-net')!;
    expect([...trailNet.children].map((el) => el.getAttribute('class'))).toEqual(['trail-fill-pass', 'trail-edges']);
  });

  it('draws the island ground as UNPAINTED hit geometry: transparent, classless leaves under classed groups', () => {
    const onSelectStory = vi.fn();
    const onSelectCap = vi.fn();
    const { root } = mountScene(realisticForestInput(false), mkCtx({ onSelectStory, onSelectCap }));
    const land = root.querySelector('.relaxed-land')!;
    const leaves = [...land.querySelectorAll('path')];
    expect(leaves.length).toBe(5); // every relaxed cell, parcel or not
    for (const leaf of leaves) {
      expect(leaf.getAttribute('fill')).toBe('transparent');
      expect(leaf.getAttribute('class')).toBeNull();
    }
    // the per-island ground groups keep their class and story id …
    const grounds = [...land.querySelectorAll(':scope > g')];
    expect(grounds.map((g) => g.getAttribute('data-story-id'))).toEqual(['a', 'lib', 'b']);
    for (const g of grounds) expect(g.classList.contains('relaxed-tile')).toBe(true);
    // … and so do the capability parcels, with the cap's own folded status.
    const parcel = land.querySelector('.parcel[data-cap-id="lib#c"]')!;
    expect(parcel.getAttribute('data-story-id')).toBe('lib');
    expect(parcel.classList.contains('st-unhealthy')).toBe(true);
    // a click on an island's bare ground selects the story; on a parcel leaf, the capability only.
    fireEvent.click(grounds[0]!.querySelector('path')!);
    expect(onSelectStory).toHaveBeenCalledWith('a');
    onSelectStory.mockClear();
    fireEvent.click(parcel.querySelector('path')!);
    expect(onSelectCap).toHaveBeenCalledWith('lib', 'lib#c');
    expect(onSelectStory).not.toHaveBeenCalled();
  });

  it('draws no coast at rest, and a shore RING for the selection and its one-hop neighbours only', () => {
    const rest = mountScene(realisticForestInput(false), mkCtx()).root;
    expect(rest.querySelector('.hex-coastland')!.children).toHaveLength(0);
    cleanup();

    const ringed = (id: string, status: string): string =>
      `hex-territory st-${status}${id === 'lib' ? ' is-selected' : id === 'a' ? ' is-upstream' : ''}`;
    const { root } = mountScene(realisticForestInput(false), mkCtx({ territoryClassById: ringed }));
    const coasts = [...root.querySelectorAll('.hex-coastland > g')];
    expect(coasts).toHaveLength(2);
    expect(coasts.map((c) => c.classList.contains('coast-fill-group'))).toEqual([true, true]);
    expect(root.querySelector('.coast-fill-group.is-upstream')).toBeTruthy();
    expect(root.querySelector('.coast-fill-group.is-selected')).toBeTruthy();
    // the ring is the shore's STROKE: the leaf keeps its class and never fills.
    for (const shore of root.querySelectorAll('.coast-fill-group > path')) {
      expect(shore.classList.contains('coast-fill')).toBe(true);
      expect((shore as SVGElement).style.fill).toBe('none');
      expect(shore.getAttribute('fill')).toBeNull();
    }
    cleanup();

    const downstream = mountScene(
      realisticForestInput(false),
      mkCtx({ territoryClassById: (id, s) => `hex-territory st-${s}${id === 'b' ? ' is-downstream' : ''}` }),
    ).root;
    expect(downstream.querySelectorAll('.hex-coastland > g')).toHaveLength(1);
    expect(downstream.querySelector('.coast-fill-group.is-downstream')).toBeTruthy();
  });

  it('a regrow layer withholds a hidden story`s nameplate, hit region and ground — and nothing else', () => {
    const layer = { hiddenStoryIds: new Set(['lib']), hiddenSegmentIds: new Set<string>() };
    const ringAll = (id: string, s: string): string => `hex-territory st-${s} is-selected`;
    const { root } = mountScene(realisticForestInput(false), mkCtx({ forestRegrowLayer: layer, territoryClassById: ringAll }));
    expect(root.querySelector('[data-story-id="lib"]')).toBeNull();
    expect(root.querySelector('[data-cap-id="lib#c"]')).toBeNull();
    expect(root.querySelector('.world-plate-id')?.textContent).not.toBe('lib');
    // the other islands are untouched: ground, hit rect and nameplate each
    for (const id of ['a', 'b']) {
      expect(root.querySelector(`.relaxed-tile[data-story-id="${id}"]`), id).toBeTruthy();
      expect(root.querySelector(`.world-story-hit[data-story-id="${id}"]`), id).toBeTruthy();
      expect(root.querySelector(`.hex-flora[data-story-id="${id}"]`), id).toBeTruthy();
    }
    // and the hidden island's shore ring is withheld with it (two rings, not three)
    expect(root.querySelectorAll('.coast-fill-group')).toHaveLength(2);
  });

  it('a regrow layer withholds the lit lane on a segment that has not arrived', () => {
    const plan = neighbourHighlightPlan(mkTrails(), 'lib');
    const layer = { hiddenStoryIds: new Set<string>(), hiddenSegmentIds: new Set(['tseg1']) };
    const { root } = renderScene({ neighbours: plan, forestRegrowLayer: layer });
    expect([...root.querySelectorAll('.trail-lit')].map((l) => l.getAttribute('data-id'))).toEqual(['tseg2']);
  });

  it('paints the native plant targets after the trails layer and before the nameplate layer', () => {
    const targets: NativePropTargetRenderLayer = {
      origin: { x: 0, y: 0 },
      targets: [{ storyId: 'lib', capabilityId: 'lib#c', status: 'unhealthy', bounds: { minX: 55, maxX: 65, minY: 5, maxY: 25 } }],
    };
    const { root } = mountScene(realisticForestInput(false), mkCtx({ nativePropTargetLayer: targets }));
    const world = root.querySelector('svg > g')!;
    const order = [...world.children].map((el) => el.getAttribute('class') ?? '');
    const at = order.indexOf('native-prop-targets');
    expect(at).toBe(order.indexOf('trail-net') + 1);
    // the very next layer is the nameplate / wisp layer, which stays on top of the targets
    expect(world.children[at + 1]!.querySelector('.hex-flora .world-plate')).toBeTruthy();
    expect(at + 1).toBe(order.length - 1);
    const rect = world.children[at]!.querySelector('rect')!;
    expect(rect.getAttribute('data-cap-id')).toBe('lib#c');
    expect(rect.getAttribute('class')).toBe('native-prop-target st-unhealthy is-filtered');
  });
});

describe('SceneView — the ADR-0169 trail network mapping', () => {
  it('emits the per-edge reveal metadata (from/to/ordered chain) for every edge', () => {
    const { root } = renderScene();
    const edge = root.querySelector('.trail-edge[data-from="a"][data-to="lib"]')!;
    expect(edge).toBeTruthy();
    expect(edge.getAttribute('data-segments')).toBe('tseg1:F,tseg2:F');
  });

  it('renders the cave portal as an island prop wearing the folded island status', () => {
    const { root } = renderScene();
    const cave = root.querySelector('.world-cave.st-healthy')!;
    expect(cave).toBeTruthy();
    expect(cave.getAttribute('data-island')).toBe('lib');
    expect(cave.getAttribute('data-edges')).toBe('lib->b');
    expect(cave.getAttribute('transform')).toMatch(/translate\(55\.0 5\.0\) rotate\(90\.0\)/);
    // the three parts: trampled apron, dark arch, lit rim.
    expect(cave.querySelector('.cave-apron')).toBeTruthy();
    expect(cave.querySelector('.cave-arch')).toBeTruthy();
    expect(cave.querySelector('.cave-rim')).toBeTruthy();
  });
});

// ADR-0242: selecting a story lights the trail segments on its OWN one-hop edges with a lane. The
// selector itself is pinned in neighbourHighlight.test.ts; here we pin the RENDER half — that a lane
// exists, that it is narrower than the road it rides (the merge honesty), and that absent a selection
// there is no lane. The road itself is the 3D layer's (ADR-0608). The look of the lane is
// owner-attested (ADR-0070), never asserted.
describe('SceneView — the ADR-0242 lit lane', () => {
  it('emits no lane at all when nothing is selected', () => {
    const { root } = renderScene(); // neighbours: absent
    expect(root.querySelectorAll('.trail-lit')).toHaveLength(0);
  });

  it('lights the selected story`s own segments — one lane each, alone on the fill pass', () => {
    // `lib` stands on `a` (segments tseg1 + tseg2) and is stood on by `b` (the hidden tseg3).
    const plan = neighbourHighlightPlan(mkTrails(), 'lib');
    const { root } = renderScene({ neighbours: plan });
    const lanes = [...root.querySelectorAll('.trail-fill-pass .trail-lit')];
    expect(lanes.map((l) => l.getAttribute('data-id'))).toEqual(['tseg1', 'tseg2']);
    // the pass carries the lanes and NOTHING else — the road fills are the 3D layer's
    const pass = root.querySelector('.trail-fill-pass')!;
    expect([...pass.children].map((c) => c.getAttribute('class'))).toEqual(['trail-lit', 'trail-lit']);
    // each lane follows its road's own geometry
    expect(lanes[0]!.getAttribute('d')).toBe(mkTrails().segments[0]!.d);
  });

  it('draws ONE lane per ROUTE when a layout is present, superseding the per-segment pass', () => {
    // The per-segment pass shows its seams at junctions (a lane that steps sideways, a
    // draw-on that restarts). A layout replaces it wholesale rather than layering over it,
    // so the two can never both paint.
    const trails = mkTrails();
    const plan = neighbourHighlightPlan(trails, 'lib')!;
    const lanes = laneLayout(trails, plan);
    const { root } = renderScene({ neighbours: plan, lanes, laneMotion: 'draw' });
    expect(root.querySelectorAll('.trail-lit')).toHaveLength(0);
    const drawn = [...root.querySelectorAll('.trail-fill-pass .trail-lane')];
    expect(drawn).toHaveLength(lanes!.lanes.length);
    // hued by relation, and each carries its own draw duration so all lanes travel at one speed
    for (const el of drawn) {
      expect(el.getAttribute('class') ?? '').toMatch(/dir-(up|down)/);
      expect(el.getAttribute('pathLength')).toBe('1');
      expect(el.getAttribute('style') ?? '').toMatch(/--lane-draw:\s*[\d.]+s/);
    }
  });

  it('carries the selection motion the world setting asks for, and nothing when it is off', () => {
    const trails = mkTrails();
    const plan = neighbourHighlightPlan(trails, 'lib')!;
    const lanes = laneLayout(trails, plan);
    const cls = (motion: 'draw' | 'march' | 'none') =>
      [...renderScene({ neighbours: plan, lanes, laneMotion: motion }).root.querySelectorAll('.trail-lane')]
        .map((e) => e.getAttribute('class') ?? '')
        .join(' ');
    expect(cls('draw')).toContain('is-drawing');
    expect(cls('draw')).not.toContain('is-marching');
    expect(cls('march')).toContain('is-marching');
    expect(cls('march')).not.toContain('is-drawing');
    expect(cls('none')).not.toMatch(/is-drawing|is-marching/);
    // a still lane also carries no pathLength — nothing normalises a run nothing animates
    const still = renderScene({ neighbours: plan, lanes, laneMotion: 'none' }).root;
    expect(still.querySelector('.trail-lane')!.getAttribute('pathLength')).toBeNull();
  });

  it('scales each lane`s draw-on by its own length, so lanes travel at one speed', () => {
    // Strictly increasing across the range the LIVE forest actually produces — a one-hop
    // route there runs ~200-3700 units. This is the regression that matters: a speed tuned
    // for a small map pins every real route to the ceiling, so they all take the same time
    // and the one-speed property is silently lost.
    expect(laneDrawSeconds(200)).toBeLessThan(laneDrawSeconds(1200));
    expect(laneDrawSeconds(1200)).toBeLessThan(laneDrawSeconds(2500));
    expect(laneDrawSeconds(2500)).toBeLessThan(laneDrawSeconds(3500));
    // and clamped at both ends: a stub still registers, the longest haul stays brisk
    expect(laneDrawSeconds(0)).toBe(0.28);
    expect(laneDrawSeconds(1e6)).toBe(1.2);
  });

  it('draws the lane NARROWER than the road it rides — so a shared trunk still reads shared', () => {
    const plan = neighbourHighlightPlan(mkTrails(), 'lib');
    const scene = buildScene(mkInput());
    const { root } = renderScene({ neighbours: plan });
    const lane = root.querySelector('.trail-lit[data-id="tseg2"]')!; // usage 2 — a trunk
    // the road is no longer in this layer's DOM (ADR-0608), so read its width off the scene it comes from
    const findRoad = (n: SceneNode): SceneNode | undefined =>
      n.kind === 'trail-fill' && n.id === 'tseg2' ? n : n.el === 'g' ? n.children.map(findRoad).find(Boolean) : undefined;
    const road = findRoad(scene)!;
    const laneW = Number(lane.getAttribute('stroke-width'));
    const roadW = road.strokeWidth!;
    // the lane wears the road's own stroke factor (the drawing strokes the ONE width rule ×
    // TRAIL_STROKE_SCALE on the derived tile, ADR-0528), so it stays narrower than the road it rides
    expect(laneW).toBeCloseTo(litLaneWidth(2) * (roadW / trailFillWidth(2)), 3);
    expect(laneW).toBeLessThan(roadW);
  });

  it('caps the lane at ONE EDGE wide, so a heavy trunk keeps a wide rim of shared road', () => {
    // The real forest routes trunks up to ~30 edges deep. Without the cap the lane tracks the
    // road and the affordance degrades into a recolour — the merge stops being visible.
    const heavy = litLaneWidth(30);
    expect(heavy).toBeCloseTo(trailFillWidth(1), 3);
    expect(heavy).toBeLessThan(trailFillWidth(30) / 2);
    // …while a usage-1 spur, which really IS the selection's alone, is lit nearly edge to edge.
    const spur = litLaneWidth(1);
    expect(spur).toBeLessThan(trailFillWidth(1));
    expect(spur).toBeGreaterThan(trailFillWidth(1) * 0.7);
    // monotone: a lane never shrinks as its road grows
    expect(litLaneWidth(2)).toBeGreaterThanOrEqual(litLaneWidth(1));
  });

  it('leaves a hidden under-island run to the ghost pass — a cave gets no lane', () => {
    // `b` stands on `lib` through tseg3 ONLY, which is a hidden cave run.
    const plan = neighbourHighlightPlan(mkTrails(), 'b');
    expect(plan?.litSegments.has('tseg3')).toBe(true);
    const { root } = renderScene({ neighbours: plan });
    expect(root.querySelectorAll('.trail-lit')).toHaveLength(0);
  });
});

// forest-parcels inc 1: the per-capability ground group is the capability's hit geometry on the map.
// GEOMETRY is the core's; here we pin the group's class, status fold and its capId title.
describe('SceneView — capability parcels (forest-parcels inc 1)', () => {
  function mkParcelInput(): SceneInput {
    return {
      offset: { x: 0, y: 0 },
      width: 200,
      height: 200,
      empties: [],
      relaxedCells: [
        { owner: 0, poly: [{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 5 }, { x: -5, y: 5 }], variant: 1, wheat: false },
        { owner: 0, poly: [{ x: 95, y: -5 }, { x: 105, y: -5 }, { x: 105, y: 5 }, { x: 95, y: 5 }], variant: 0, wheat: false },
        { owner: 0, poly: [{ x: 45, y: 95 }, { x: 55, y: 95 }, { x: 55, y: 105 }, { x: 45, y: 105 }], variant: 2, wheat: false },
      ],
      drawTiles: [],
      wheatSets: [new Set()],
      trails: { segments: [], edges: [], caves: [], dropped: [] },
      territories: [
        {
          id: 'lib',
          status: 'healthy',
          caps: 3,
          centroid: { x: 50, y: 40 },
          groundRadius: 60,
          screenRadius: 60,
          treeSpot: { x: 50, y: 40 },
          labelY: 120,
          coastGroundLoops: [],
          decor: [],
          plants: [],
          parcels: [
            { capId: 'lib#a', status: 'healthy', testCount: 3, theme: 'meadow', seed: { x: 0, y: 0 } },
            { capId: 'lib#b', status: 'unhealthy', testCount: 1, theme: 'woodland', seed: { x: 100, y: 0 } },
            { capId: 'lib#c', status: 'healthy', testCount: 1, theme: 'heath', seed: { x: 50, y: 100 } },
          ],
          treeTitle: 'lib — healthy',
          wisps: [],
          claims: [],
          plate: { w: 60, h: 33, rx: 7, idY: 14, subY: 27, idText: 'lib', subText: 'healthy · 3 caps', title: 'Library' },
        },
      ],
    };
  }
  function renderParcels(): HTMLElement {
    const ctx: SceneCtx = {
      territoryClassById: (id, status) => `hex-territory st-${status}`,
      hidden: new Set(),
      onSelectStory: vi.fn(),
      onSelectCap: vi.fn(),
    };
    const { container } = render(
      <svg>
        <SceneView scene={buildScene(mkParcelInput())} ctx={ctx} />
      </svg>,
    );
    return container;
  }

  it('maps the transparent per-cap parcel ground group, folding the cap status + carrying the capId title', () => {
    const root = renderParcels();
    // one parcel group per cap, wearing st-<status> (the visible tint is on the cells inside).
    expect(root.querySelectorAll('.parcel.st-healthy').length).toBe(2); // lib#a + lib#c
    expect(root.querySelector('.parcel.st-unhealthy')).toBeTruthy(); // lib#b
    // the group carries the capId as a <title> (the hover hook the frozen vocabulary specifies).
    const titles = [...root.querySelectorAll('.parcel > title')].map((t) => t.textContent);
    expect(titles).toContain('lib#a');
  });
});
