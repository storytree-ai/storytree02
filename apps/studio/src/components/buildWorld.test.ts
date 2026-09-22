// buildWorld — the world-model→render seam (ADR-0069): a deterministic, pure function of
// the story data that lays out territories. These tests pin the STANDALONE single-island
// layout the SHARED ISLANDS PANEL relies on (ADR-0088, the left panel that replaced the
// on-map building islands): handing buildWorld a single building story with `buildings: false`
// (so it is NOT distributed/excluded) yields exactly ONE territory carrying that story's
// capabilities — the one-island Territory the panel renders with TerritoryFlora inside a
// self-contained <svg>. Stage-1 red-green of the geometry (ADR-0070); the panel's APPEARANCE
// is owner-attested.

import { describe, it, expect } from 'vitest';
import { AXIAL_DIRS, LAND_CAMERA_ELEVATION_DEG } from '@storytree/forest-world';

import { buildWorld, parseArtRungs, parseMapElevation, parseSpacingTuning } from './TreeView.js';
import { ISLAND_SPACING_RATIO, ISLAND_SPACING_RUNGS } from '@storytree/forest-layout';
import type { TreeStory } from '../types';

const cap = (id: string) => ({
  id,
  title: id,
  outcome: '',
  status: 'mapped' as const,
  proofMode: 'red-green',
  dependsOn: [],
  testCount: 0,
});

const library = (): TreeStory => ({
  id: 'library',
  title: 'library',
  outcome: '',
  status: 'mapped',
  proofMode: 'UAT',
  uatWitness: 'human',
  dependsOn: [],
  consumedBy: ['cli'],
  building: true,
  capabilities: [cap('library-cli'), cap('seed-corpus'), cap('knowledge-render')],
});

describe('buildWorld — standalone single-island layout (Shared Islands panel)', () => {
  it('lays a single building story as exactly one territory carrying its capabilities', () => {
    // buildings:false ⇒ the building is NOT excluded; it lays out as a normal island (the
    // one-island Territory the panel renders for each shared island).
    const world = buildWorld([library()], { buildings: false });
    expect(world.territories).toHaveLength(1);
    const t = world.territories[0]!;
    expect(t.story.id).toBe('library');
    // every capability gets a garden spot on the island
    expect(t.caps.map((c) => c.cap.id).sort()).toEqual(
      ['knowledge-render', 'library-cli', 'seed-corpus'].sort(),
    );
    // the island carries no icon stamps of its own (buildings:false ⇒ no promotion; ADR-0102)
    expect(t.stamps).toEqual([]);
  });

  it('is deterministic — same input, byte-identical geometry (pure function of the data)', () => {
    const a = buildWorld([library()], { buildings: false });
    const b = buildWorld([library()], { buildings: false });
    expect(a.width).toBe(b.width);
    expect(a.height).toBe(b.height);
    expect(a.offset).toEqual(b.offset);
    expect(a.territories[0]!.treeSpot).toEqual(b.territories[0]!.treeSpot);
    expect(a.territories[0]!.coastGroundLoops).toEqual(b.territories[0]!.coastGroundLoops);
  });

  it('an edgeless world carries an EMPTY trail network (the router is skipped, never fed junk)', () => {
    const world = buildWorld([library()], { buildings: false });
    expect(world.trails).toEqual({ segments: [], edges: [], caves: [], dropped: [] });
  });
});

describe('buildWorld — the ADR-0169 trail network (roads route as trails, both layouts)', () => {
  const story = (id: string, dependsOn: string[] = []): TreeStory => ({
    id,
    title: id,
    outcome: '',
    status: 'mapped',
    proofMode: 'UAT',
    uatWitness: 'machine',
    dependsOn,
    consumedBy: [],
    capabilities: [cap(`${id}-a`)],
  });
  const fixture = (): TreeStory[] => [
    story('foundation'),
    story('mid', ['foundation']),
    story('top', ['mid']),
  ];

  it('routes every depends_on edge through ONE TrailNetwork with per-edge segment chains', () => {
    const world = buildWorld(fixture());
    const keys = world.trails.edges.map((e) => `${e.from}->${e.to}`);
    expect(keys).toContain('foundation->mid');
    expect(keys).toContain('mid->top');
    // every routed edge carries a non-empty ordered chain of real segment refs
    const segIds = new Set(world.trails.segments.map((s) => s.id));
    for (const e of world.trails.edges) {
      expect(e.segments.length).toBeGreaterThan(0);
      for (const ref of e.segments) expect(segIds.has(ref.id)).toBe(true);
    }
    // the tooltip vocabulary rides the edge (folded at routing time)
    expect(world.trails.edges[0]!.title).toMatch(/depends on/);
  });

  // ADR-0283 D2 (owner-directed 2026-08-02): DAG rows are the ONLY layout. `?layout=stress` /
  // `?layout=solar` are retired, so there is no second arrangement to hold the one-TrailNetwork
  // model against. (The companion `world.solar` assertion retired with the FIELD — the radial
  // layer is off `HexWorld` entirely now, so typecheck pins its absence, not a runtime expect.)
  it('lays out DAG rows whatever the URL said', () => {
    const world = buildWorld(fixture());
    const keys = world.trails.edges.map((e) => `${e.from}->${e.to}`);
    expect(keys).toContain('foundation->mid');
  });

  it('is deterministic — same stories, byte-identical network', () => {
    expect(buildWorld(fixture()).trails).toEqual(buildWorld(fixture()).trails);
  });
});

// ── ADR-0286: the pale coast is ATTRIBUTED, island by island ──
//
// The moat is derived from the UNION of claimed land, so it had no owner — and while it had none,
// the Act 2 regrow's per-story hide could not reach it: the map drew the whole forest's hexagonal
// silhouette from frame one, announcing every island before it existed. Naming the island each
// coast hex grew out of is what gives the hide a handle.
describe('buildWorld — the coast belongs to an island (ADR-0286)', () => {
  const story = (id: string, dependsOn: string[] = []): TreeStory => ({
    id,
    title: id,
    outcome: '',
    status: 'mapped',
    proofMode: 'UAT',
    uatWitness: 'machine',
    dependsOn,
    consumedBy: [],
    capabilities: [cap(`${id}-a`)],
  });
  const fixture = (): TreeStory[] => [
    story('foundation'),
    story('mid', ['foundation']),
    story('top', ['mid']),
  ];

  it('gives every coast hex an owning territory index', () => {
    const world = buildWorld(fixture());
    expect(world.empties.length).toBeGreaterThan(0);
    for (const hex of world.empties) {
      expect(typeof hex.owner, `coast hex ${hex.q},${hex.r} needs an owner`).toBe('number');
      expect(hex.owner).toBeGreaterThanOrEqual(0);
      expect(hex.owner).toBeLessThan(world.territories.length);
    }
  });

  it('spreads the coast across EVERY island, never parks it all on one', () => {
    const world = buildWorld(fixture());
    const owners = new Set(world.empties.map((h) => h.owner));
    // The point of attribution is that hiding one island hides only ITS moat. If every hex named
    // the same territory the hide would be all-or-nothing again, just spelled differently.
    expect(owners.size).toBe(world.territories.length);
  });

  it('is deterministic — the same stories attribute the same hexes to the same islands', () => {
    expect(buildWorld(fixture()).empties).toEqual(buildWorld(fixture()).empties);
  });

  it('leaves the coast geometry itself untouched (attribution adds, it does not move)', () => {
    const world = buildWorld(fixture());
    const bare = world.empties.map((h) => ({ q: h.q, r: h.r }));
    // A hex is still a hex at the same axial coordinate; `owner` rides alongside.
    expect(new Set(bare.map((h) => `${h.q},${h.r}`)).size).toBe(bare.length);
  });
});

// ── ADR-0521: the spacing is a FRACTION OF ISLAND SIZE, not three constants ──
//
// The three absolute gaps (40 / 60 / 140) are retired; every gap is `gapBetween` over the two
// islands' estimated radii and a lone island's swing is the offset a same-row neighbour would have
// had. These pin the RULE at the packer — that the layout MOVES with the ratio, that the legacy
// triple stands the old map and ignores the ratio, and that the dial's grammar reads what a URL
// says — never a rung's look, which is the owner's off the rendered ladder.
describe('buildWorld — ADR-0521: the gaps derive from island size', () => {
  const caps = (id: string, n: number) => Array.from({ length: n }, (_, i) => cap(`${id}-${i}`));
  const story = (id: string, n: number, dependsOn: string[] = []): TreeStory => ({
    id,
    title: id,
    outcome: '',
    status: 'mapped',
    proofMode: 'UAT',
    uatWitness: 'machine',
    dependsOn,
    consumedBy: [],
    capabilities: caps(id, n),
  });
  /** Two independent big islands on the foundation row, and one lone island above them. */
  const fixture = (): TreeStory[] => [story('left', 11), story('right', 11), story('lone', 11, ['left', 'right'])];
  const centroid = (stories: TreeStory[], id: string, ratio: number) => {
    const w = buildWorld(stories, { spacing: { ratio } });
    const t = w.territories.find((x) => x.story.id === id);
    if (!t) throw new Error(`no territory ${id}`);
    return t.centroid;
  };

  it('same-row neighbours sit FURTHER apart at a larger ratio — the in-row gap is a fraction of their radii', () => {
    const near = Math.abs(centroid(fixture(), 'left', 0).x - centroid(fixture(), 'right', 0).x);
    const far = Math.abs(centroid(fixture(), 'left', 0.6).x - centroid(fixture(), 'right', 0.6).x);
    expect(far).toBeGreaterThan(near);
    // ⚠ THE FLOOR MOVED WITH ADR-0593 D1, AND THE REASON IS WORTH READING BEFORE TOUCHING IT.
    //
    // This used to require a move of at least one hex step (≈ 47), justified as "0.6 × the mean
    // radius of two 13-tile islands is ≈ 79 ground units before the lattice snaps the seeds".
    // Measured on this fixture either side of the camera move, with nothing else changed:
    //
    //     land camera 20°   near 100.17   far 146.33   moved 46.16   (≈ 0.92 of a ground radius)
    //     land camera 50°   near 110.62   far 131.52   moved 20.90   (≈ 0.42 of a ground radius)
    //
    // The nominal ask is 0.6 of a radius at both. The lattice snap overshoots it at 20° and
    // undershoots it at 50°, so raising the camera costs this dial rather more than half its
    // in-row authority. That is a LAYOUT observation and it belongs to the open density question
    // (`oq-gaps-derived-forest-still-sparse-tile-or-positions`), NOT to the camera: ADR-0593 D4 is
    // explicit that the angle and the density are two knobs and a session that trades one against
    // the other has confused them. So this floor is re-based and the spacing rule is untouched.
    //
    // 15 is a materiality floor, not the measurement: it sits comfortably above the sub-pixel
    // regime a rounding artefact would live in and comfortably below the response at either
    // camera, so it still fails a dial that has stopped biting without re-passing on a snap.
    expect(far - near).toBeGreaterThan(15);
  });

  it('the elevation argument moves the DRAWING and never the LAYOUT — and the ambient constant never leaks in', () => {
    // ⚠ TWO OF THIS TEST'S THREE CLAUSES WERE INVERTED ON 2026-09-23, AND THE INVERSION IS THE
    // POINT — read this before "fixing" it back. As written at ADR-0593 D1 this asserted that the
    // elevation argument moved the island SEPARATION and the TILE SET, on the reasoning that those
    // move "ONLY if the argument reached the seed snap". The argument did reach the seed snap, and
    // that was the DEFECT: `packWorld` places each seed in GROUND units and the snap ran it through
    // `pixelToHex`, a screen-space function, so the camera decided which tiles each story grew
    // onto. ADR-0527 D1 and ADR-0546 D1 both forbid exactly that — the layout is re-projected,
    // never re-decided — and `the-packer-decides-in-ground-space-not-through-the-camera` repaired
    // it by snapping at plan view. So a test demanding that the tiles follow the camera is now a
    // test demanding the defect back.
    //
    // ⚠ THE ORIGINAL FINDING IS UNDAMAGED AND STILL PINNED, which is why this is a correction and
    // not a deletion. There were TWO sites silently reading `LAND_CAMERA_ELEVATION_DEG`'s default
    // instead of the caller's argument, and only one of them was the seed snap. The other is the
    // world's top bound (`storyTreeReach`), a genuinely SCREEN quantity that must follow the
    // camera — and it is the `height` clause below, unchanged. That is what kept a "50° map" from
    // being a 50° map, and it is still asserted.
    //
    // ⚠ WHY NOTHING COULD SEE ANY OF IT BEFORE, which is the durable part. Every shipped caller
    // packs BARE, so the module default and the local variable were always the same number and a
    // site reading the wrong one was indistinguishable from a site reading the right one. The gap
    // only opens when a caller actually exercises the override — which is what the staging run for
    // the held question did, and why its "50°" rows came back as today's map (ADR-0593, Context).
    //
    // So the claim is a SPLIT dependence claim: across two explicit cameras the drawing must move
    // and the layout must NOT, and at the shipped camera an explicit call must equal a bare one.
    // A site that ignored its argument fails the height clause; a site that read a camera where it
    // should read the ground fails the separation and tiles clauses; a site that ignored the
    // constant fails the default clause.
    const layout = (elevationDeg?: number) => {
      const opts = elevationDeg === undefined ? {} : { elevationDeg };
      const w = buildWorld(fixture(), { spacing: { ratio: 0.6 }, ...opts });
      const t = (id: string) => w.territories.find((x) => x.story.id === id)!;
      return {
        // ACROSS-screen separation. `x` is untouched by the projection itself, so once the seed
        // snap is camera-free this cannot move with the camera at all — it is the `pixelToHex` half
        // and it is now a NEGATIVE control.
        separationX: Math.abs(t('left').centroid.x - t('right').centroid.x),
        // the world's own box, which is the `storyTreeReach` half — a screen quantity that MUST move
        height: w.height,
        // and the tiles each island actually claimed — decided on the ground, so also unmoved
        tiles: t('left').tiles.map((h) => `${h.q},${h.r}`).join(' '),
      };
    };

    const at20 = layout(20);
    const at50 = layout(50);
    const bare = layout();

    // the DRAWING follows the argument…
    expect(at20.height).not.toBe(at50.height);
    // …and the LAYOUT does not, at either grain
    expect(at20.separationX).toBe(at50.separationX);
    expect(at20.tiles).toBe(at50.tiles);

    // …and the DEFAULT is the declared constant and nothing else
    expect(bare).toEqual(layout(LAND_CAMERA_ELEVATION_DEG));
  });

  it('adjacent ranks sit FURTHER apart at a larger ratio — the row gap is the same fraction', () => {
    const rows = (ratio: number) =>
      Math.abs(centroid(fixture(), 'lone', ratio).y - (centroid(fixture(), 'left', ratio).y + centroid(fixture(), 'right', ratio).y) / 2);
    expect(rows(0.6)).toBeGreaterThan(rows(0));
  });

  it('the legacy triple stands the pre-ADR-0521 map and IGNORES the ratio — a control arm cannot be one of its own rungs', () => {
    const legacy = { rankGap: 40, islandGap: 60, rankSwing: 140 };
    const a = buildWorld(fixture(), { spacing: { ratio: 0, legacy } });
    const b = buildWorld(fixture(), { spacing: { ratio: 0.6, legacy } });
    expect(a.territories.map((t) => t.centroid)).toEqual(b.territories.map((t) => t.centroid));
    expect(a.width).toBe(b.width);
    // and it is a different layout from the ratio path at a ratio that is not it
    const c = buildWorld(fixture(), { spacing: { ratio: 0 } });
    expect(c.territories.map((t) => t.centroid)).not.toEqual(a.territories.map((t) => t.centroid));
  });

  it('a bare call lays out at the shipped ratio, not at the retired constants', () => {
    const bare = buildWorld(fixture());
    const shipped = buildWorld(fixture(), { spacing: { ratio: ISLAND_SPACING_RATIO } });
    expect(bare.territories.map((t) => t.centroid)).toEqual(shipped.territories.map((t) => t.centroid));
  });

  it('every trail still routes when the whole forest moves — no edge is dropped at any rung', () => {
    for (const ratio of ISLAND_SPACING_RUNGS) {
      const w = buildWorld(fixture(), { spacing: { ratio } });
      expect(w.trails.dropped).toEqual([]);
      expect(w.trails.edges.map((e) => `${e.from}->${e.to}`).sort()).toEqual(['left->lone', 'right->lone']);
    }
  });

  it('THE MOAT (ADR-0528 D5): no two islands’ tiles are ever adjacent, and every island still draws its whole quota', () => {
    // a wide sweep of capability counts, including many one-hex islands packed on one rank
    const stories = Array.from({ length: 60 }, (_, i) => story(`moat-${i}`, [1, 1, 2, 3, 4, 7, 12, 26][i % 8]!, i > 0 && i % 5 === 0 ? [`moat-${i - 1}`] : []));
    const world = buildWorld(stories, { buildings: false });
    const ownerOf = new Map<string, number>();
    world.territories.forEach((t, i) => t.tiles.forEach((h) => ownerOf.set(`${h.q},${h.r}`, i)));
    let adjacent = 0;
    world.territories.forEach((t, i) => {
      expect(t.tiles.length).toBe(Math.max(1, t.story.capabilities.length));
      for (const h of t.tiles) {
        for (const d of AXIAL_DIRS) {
          const o = ownerOf.get(`${h.q + d.q},${h.r + d.r}`);
          if (o !== undefined && o !== i) adjacent += 1;
        }
      }
    });
    expect(adjacent).toBe(0);
  });

  it('parseArtRungs (ADR-0528 D2): each ?<family>Rung= is a positive finite factor on the shipped rung; anything else is ignored, and a bare URL states no tile', () => {
    expect(parseArtRungs(new URLSearchParams(''))).toEqual({});
    expect(parseArtRungs(new URLSearchParams('?treeRung=0.8'))).toEqual({ tree: 0.8 });
    expect(parseArtRungs(new URLSearchParams('?plateRung=1.25&trailRung=2.44&floraRung=1.5'))).toEqual({ plate: 1.25, trail: 2.44, flora: 1.5 });
    expect(parseArtRungs(new URLSearchParams('?treeRung=0&plateRung=-1&trailRung=nope'))).toEqual({});
  });

  it('parseSpacingTuning: ?spacing= is the ratio; all three legacy keys together are the control, one or two are nothing', () => {
    expect(parseSpacingTuning(new URLSearchParams('?spacing=0.2'))).toEqual({ ratio: 0.2 });
    expect(parseSpacingTuning(new URLSearchParams('?rankGap=40&islandGap=60&rankSwing=140'))).toEqual({
      legacy: { rankGap: 40, islandGap: 60, rankSwing: 140 },
    });
    expect(parseSpacingTuning(new URLSearchParams('?rankGap=40&islandGap=60'))).toEqual({});
    expect(parseSpacingTuning(new URLSearchParams('?spacing=-1'))).toEqual({});
    expect(parseSpacingTuning(new URLSearchParams('?spacing=abc'))).toEqual({});
    expect(parseSpacingTuning(new URLSearchParams(''))).toEqual({});
  });
});

describe('the-two-layers-share-one-elevation — ?elevation= renders an arm, and changes nothing by default', () => {
  it('parseMapElevation: a finite angle in (0, 90] is the arm; anything else is not an elevation', () => {
    expect(parseMapElevation(new URLSearchParams('?elevation=50'))).toBe(50);
    expect(parseMapElevation(new URLSearchParams('?elevation=20'))).toBe(20);
    expect(parseMapElevation(new URLSearchParams('?elevation=90'))).toBe(90);
    // absent is the SHIPPED map — the whole point of the flag is that it defaults to nothing
    expect(parseMapElevation(new URLSearchParams(''))).toBeNull();
    // 0° is the ground edge-on: `sin e` is 0, which is a division by zero in the registration
    // arithmetic (`registrationCamera`'s Tz) rather than a picture. Refused, not clamped.
    expect(parseMapElevation(new URLSearchParams('?elevation=0'))).toBeNull();
    expect(parseMapElevation(new URLSearchParams('?elevation=-20'))).toBeNull();
    expect(parseMapElevation(new URLSearchParams('?elevation=91'))).toBeNull();
    expect(parseMapElevation(new URLSearchParams('?elevation=abc'))).toBeNull();
    expect(parseMapElevation(new URLSearchParams('?elevation='))).toBeNull();
  });

  it('the flag reaches the drawing: 50° flattens x nothing and lifts the drawn depth over 20°', () => {
    const stories = [library()];
    const at20 = buildWorld(stories, { buildings: false, elevationDeg: 20 });
    const at50 = buildWorld(stories, { buildings: false, elevationDeg: 50 });
    const bare = buildWorld(stories, { buildings: false });
    // ⚠ THE DEFAULT IS NOW 50° — ADR-0593 D1 moved `LAND_CAMERA_ELEVATION_DEG` from 20 to 50 so the
    // flat map and the 3D land share one elevation and `registrationCamera` stops refusing. A bare
    // call is therefore the 50° arm; it was the 20° arm until 2026-09-22.
    expect(at50.width).toBeCloseTo(bare.width, 9);
    expect(at50.height).toBeCloseTo(bare.height, 9);
    // neither projection touches x, so the drawn width is the same at both elevations...
    expect(at50.width).toBeCloseTo(at20.width, 9);
    // ...and the drawn DEPTH is what moves: sin(50°)/sin(20°) = 2.24x more screen height.
    expect(at50.height).toBeGreaterThan(at20.height);
  });

  it('the elevation reaches the ISLAND ITSELF, not merely the world box around it', () => {
    // ⚠ WHY THIS EXISTS, AND IT IS NOT A DUPLICATE OF THE TEST ABOVE. Width and height are the
    // only things that test checks, and a world box is the LAST thing to move: it is derived from
    // the packing, which the `?elevation=` flag already reached. The island's own drawn geometry
    // comes from a different path, and for six days nobody noticed the two had come apart — the
    // held question's "50° map" rows were drawn at 20° and reviewed as 50° renders, because the
    // pictures' outer dimensions had moved and nothing asked whether their CONTENTS had
    // (ADR-0593, Context).
    //
    // So assert the projection itself, on the island. The packer hands back each territory's
    // centroid twice — once on the ground (`groundCentroid`, camera-independent) and once as
    // DRAWN (`centroid`, projected at the declared camera). Orthographic elevation scales depth by
    // `sin θ` and leaves `x` alone, so the two must stand in exactly that relation, at whichever
    // angle the caller asked for. A drawing that quietly fell back to some other elevation fails
    // here however plausible its bounding box looks.
    const sin = (deg: number) => Math.sin((deg * Math.PI) / 180);
    for (const [elevationDeg, world] of [
      [20, buildWorld([library()], { buildings: false, elevationDeg: 20 })],
      [50, buildWorld([library()], { buildings: false, elevationDeg: 50 })],
      // …and the BARE call, which is the one a member actually opens.
      [LAND_CAMERA_ELEVATION_DEG, buildWorld([library()], { buildings: false })],
    ] as const) {
      const t = world.territories[0]!;
      expect(t.centroid.x).toBeCloseTo(t.groundCentroid.x, 9);
      expect(t.centroid.y).toBeCloseTo(t.groundCentroid.y * sin(elevationDeg), 9);
      // the tree stands on the same ground it is drawn on, by the same rule
      expect(t.treeSpot.x).toBeCloseTo(t.groundTreeSpot.x, 9);
      expect(t.treeSpot.y).toBeCloseTo(t.groundTreeSpot.y * sin(elevationDeg), 9);
    }
  });
});
