// THE RELOCATION PROOF, STUDIO SIDE (`the-packing-moves-to-its-own-package`, ADR-0537 D1).
//
// `buildWorld` used to BE the island packing. It is now `chrome ∘ packWorld`: the packing moved
// into `@storytree/forest-layout` and what stayed here is the two studio rules it was tangled with
// — the `render: building` exclusion (ADR-0076 §2 / ADR-0088) and the ADR-0102 icon promotion.
// The increment's binding constraint is that the composition changed the map by NOTHING.
//
// This file makes the EXACT half of that claim, and it is the primary one. The golden was captured
// under V8, and this suite runs under V8 (vitest), so the comparison here is bit-identical — 0 of
// 14,057 numbers may differ. The package's own `relocation.test.ts` makes the same comparison under
// Bun's JavaScriptCore, where `Math.hypot` and `Math.sin` disagree with V8's in the last place, so
// it carries a measured 64-ULP budget; that budget exists there and must never be needed here.
//
// It also makes the CHROME half, which the packer cannot: that the two values the package's fixture
// states as literals — which stories are excluded, and which island carries which icon — are the
// values this file's chrome actually computes. Neither file is the whole proof; together they are.
//
// ⚠ WHAT MAKES THIS A PROOF RATHER THAN AN ASSERTION. `relocation.golden.json` was captured from
// the packer as it stood in THIS file and committed in its own commit before a single line moved.
// The relocation commit only renamed it into the package, so `git log --follow -p` on it shows one
// content commit — the capture. A future edit that legitimately changes the map re-captures it, in
// its own commit, saying what moved and why.

import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

import {
  CARRIED_ICONS,
  EXCLUDED_BUILDING_IDS,
  firstDifference,
  projectWorld,
  relocationArms,
  relocationCorpus,
  type FixtureStory,
  type WorldProjection,
} from '@storytree/forest-layout/relocation';
import { packWorld } from '@storytree/forest-layout';

import { buildWorld } from './TreeView.js';
import type { TreeCapability, TreeStory } from '../types';

const goldenPath = createRequire(import.meta.url).resolve('@storytree/forest-layout/relocation-golden');
const golden = JSON.parse(readFileSync(goldenPath, 'utf8')) as Record<string, WorldProjection>;

/** The package's corpus, dressed in the studio's own richer types. Every field added here —
 *  title, outcome, status, proofMode, witness, test counts — is one the layout never reads, which
 *  is exactly why the packer could declare its own narrower input contract and take this straight. */
function asTreeStories(fixture: readonly FixtureStory[]): TreeStory[] {
  const cap = (c: { id: string; dependsOn: readonly string[] }): TreeCapability => ({
    id: c.id,
    title: c.id,
    outcome: '',
    status: 'mapped',
    proofMode: 'red-green',
    dependsOn: [...c.dependsOn],
    testCount: 0,
  });
  return fixture.map((s) => ({
    id: s.id,
    title: s.id,
    outcome: '',
    status: 'mapped',
    proofMode: 'UAT',
    uatWitness: 'machine',
    dependsOn: [...s.dependsOn],
    consumedBy: [...s.consumedBy],
    building: s.building,
    capabilities: s.capabilities.map(cap),
  }));
}

const stories = asTreeStories(relocationCorpus());

/** The land camera the relocation golden was CAPTURED at (ADR-0367 D1's original value), restated
 *  here as its own literal rather than imported from the package fixture: the two files prove
 *  opposite halves (chrome vs packer) and must each be able to state their inputs without
 *  depending on the other's constant. Pinned deliberately NOT to `LAND_CAMERA_ELEVATION_DEG`: the
 *  golden is a fixed record of the map before the packing moved, and the relocation claim — that
 *  `buildWorld` reproduces the pre-move map exactly — is camera-independent. ADR-0593 D1 later
 *  moved the live constant to 50; without this pin, every arm below would silently pick up
 *  whatever the constant is TODAY, and the comparison would stop proving "did the move change the
 *  map" and start proving "did the map change since capture" — which it did, on purpose, for a
 *  reason this file has nothing to do with. */
const GOLDEN_CAPTURE_ELEVATION_DEG = 20;

/** The five arms, as the STUDIO enters them — the same five the package compares, but reached
 *  through `buildWorld`'s own options rather than through pre-computed chrome. */
const arms = {
  shipped: () => buildWorld(stories, { buildings: true, elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG }),
  scatter: () =>
    buildWorld(stories, {
      buildings: true,
      plantsScatter: true,
      elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG,
    }),
  bare: () => buildWorld(stories, { buildings: false, elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG }),
  legacy: () =>
    buildWorld(stories, {
      buildings: true,
      spacing: { legacy: { rankGap: 40, islandGap: 60, rankSwing: 140 } },
      elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG,
    }),
  tightest: () =>
    buildWorld(stories, {
      buildings: true,
      spacing: { ratio: 0 },
      elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG,
    }),
} satisfies Record<string, () => ReturnType<typeof buildWorld>>;

describe('buildWorld lays out the same map after the packing moved into its own package', () => {
  // A golden that lost an arm would pass every surviving comparison and prove less than it claims.
  it('covers every captured arm, and the package compares the same five', () => {
    expect(Object.keys(golden).sort()).toEqual(Object.keys(arms).sort());
    expect(Object.keys(relocationArms()).sort()).toEqual(Object.keys(arms).sort());
  });

  for (const [arm, build] of Object.entries(arms)) {
    it(`reproduces the pre-move map BIT FOR BIT — ${arm}`, () => {
      const before = golden[arm];
      expect(before, `no golden captured for arm "${arm}"`).toBeDefined();
      const after = JSON.parse(JSON.stringify(projectWorld(build()))) as WorldProjection;
      // Budget 0: this is the runtime the golden was captured on, so nothing may drift at all.
      expect(firstDifference(before, after, arm, 0)).toBeUndefined();
    });
  }
});

describe('the chrome half — what the packer is handed, and can never work out for itself', () => {
  it('excludes exactly the `render: building` stories, and only when `buildings` is on', () => {
    const shipped = buildWorld(stories, { buildings: true }).territories.map((t) => t.story.id);
    const bare = buildWorld(stories, { buildings: false }).territories.map((t) => t.story.id);

    expect(bare).toEqual(stories.map((s) => s.id));
    expect(shipped).toEqual(stories.map((s) => s.id).filter((id) => !EXCLUDED_BUILDING_IDS.includes(id)));
    // …which is the corpus's own building tags, not a hand-kept list that could drift from them.
    expect([...EXCLUDED_BUILDING_IDS].sort()).toEqual(
      stories.filter((s) => s.building === true).map((s) => s.id).sort(),
    );
    // ORDER is load-bearing, not incidental: the packer breaks row-ordering ties on input order,
    // so a filter that reordered the survivors would move islands without dropping any.
    expect(shipped).toEqual(['root-a', 'root-b', 'root-c', 'root-d', 'mid-a', 'mid-b', 'mid-c', 'mid-d', 'solo', 'deep-a', 'deep-b', 'deep-c']);
  });

  it('computes exactly the carried-icon map the package fixture states as data', () => {
    const seated = new Map<string, string[]>();
    for (const t of buildWorld(stories, { buildings: true }).territories) {
      if (t.stamps.length) seated.set(t.story.id, t.stamps.map((s) => s.icon));
    }
    expect([...seated.entries()].sort()).toEqual(
      [...CARRIED_ICONS.entries()].map(([k, v]) => [k, [...v]]).sort(),
    );
    // Promotion is computed from the FULL list, before the buildings are excluded — an island can
    // carry the icon of a story that is itself no longer on the map, which is the whole point.
    expect(seated.get('mid-c')).toEqual(['lib', 'toolbelt']);
    expect(seated.has('lib')).toBe(false);
  });

  it('carries no stamps at all when `buildings` is off', () => {
    expect(buildWorld(stories, { buildings: false }).territories.every((t) => t.stamps.length === 0)).toBe(true);
  });

  it('hands the packer the same thing the package fixture hands it', () => {
    // The two halves meet HERE: `buildWorld`'s chrome, and `packWorld` called directly on the
    // fixture's stated inputs, must produce the identical map. If the fixture's literals ever stop
    // describing what the chrome computes, this is what says so — not a silent pair of greens.
    // Pinned to the same GOLDEN_CAPTURE_ELEVATION_DEG as every arm above: this comparison is
    // numeric (budget 0), and `shippedArm.opts` below carries the package fixture's own pinned
    // 20° — without matching it here, the two sides would disagree on camera alone.
    const viaChrome = projectWorld(
      buildWorld(stories, { buildings: true, elevationDeg: GOLDEN_CAPTURE_ELEVATION_DEG }),
    );
    const shippedArm = relocationArms()['shipped'];
    expect(shippedArm).toBeDefined();
    const direct = projectWorld(packWorld(shippedArm!.stories, shippedArm!.opts));
    expect(firstDifference(viaChrome, direct, 'shipped', 0)).toBeUndefined();
  });
});
