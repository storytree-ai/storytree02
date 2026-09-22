// THE RELOCATION PROOF (`the-packing-moves-to-its-own-package`, ADR-0537 D1).
//
// The island packing moved out of `apps/studio/src/components/TreeView.tsx` into this package. The
// increment's binding constraint is that the move changed the layout's OUTPUT by NOTHING: "this is
// a relocation; the map it produces must be provably the same."
//
// ⚠ WHAT MAKES THIS A PROOF RATHER THAN AN ASSERTION. `relocation.golden.json` was captured from
// the packer as it stood inside `TreeView.tsx` and committed in its own commit before a single line
// moved. The relocation commit only RENAMED it, so `git log --follow -p` on the file shows one
// content commit — the capture — and nothing else. A future edit that legitimately changes the map
// re-captures it, in ITS OWN commit, saying what moved and why.
//
// ⚠ AND THIS IS ONLY HALF THE PROOF, deliberately. The golden was captured through the studio's
// `buildWorld`, which computes two things this package cannot see: which stories are
// `render: building` and so are never laid out, and which island carries which icon (the ADR-0102
// promotion). Those are stated as data in `relocation.fixture.ts`; the studio's own
// `buildWorld.relocation.test.ts` proves its chrome computes exactly those values. Neither file is
// the whole claim; together they are `buildWorld` = chrome ∘ packWorld, unchanged end to end.
//
// ⚠ WHAT THIS INSTRUMENT CAN AND CANNOT SEE — calibrated by fault-seeding before the move, so the
// green is read at its true strength. Perturbing a CONTINUOUS quantity by one part in ten thousand
// (`ringR`'s `crownR * 0.9` → `0.9001`) reds all five arms; widening the moat by one hex reds four;
// taking the gap ratio 0.1 → 0.5 reds the three arms that read it (`legacy` and `tightest` declare
// their own gaps and are correctly untouched). But perturbing the gap ratio by 1e-5 reds NOTHING,
// and that is the packer being QUANTISED rather than the instrument being blind: every gap the
// ratio feeds ends up in a seed that `pixelToHex` snaps to the lattice, so a sub-hex change to a
// gap is not a change to the map. Continuous outputs — every garden spot, coast vertex and trail
// point — carry no such floor and are compared exactly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { packWorld } from './pack.js';
import {
  relocationArms,
  projectWorld,
  firstDifference,
  ulpsApart,
  type WorldProjection,
} from './relocation.fixture.test.js';

/**
 * ⚠ THE ONE PIECE OF SLACK IN THIS SUITE, AND IT IS THE RUNTIME'S, NOT THE RELOCATION'S. The golden
 * was captured under V8; this package's suite runs under Bun's JavaScriptCore, whose `Math.hypot`
 * and `Math.sin` disagree with V8's in the last place. Measured over the five arms: under V8 the
 * packer reproduces the golden BIT FOR BIT (0 of 14,057 numbers differ) — which is the claim
 * `apps/studio/src/components/buildWorld.relocation.test.ts` makes, at budget 0, and it is the
 * primary one — while here 53 numbers differ (0.38%) by at most 16 ULP, every one of them a
 * continuous coordinate and none of them a tile, an owner or an ordering. 64 is that measurement
 * with headroom: ~1.4e-14 relative, four hundred times below the 1e-4 perturbation the fault
 * seeding showed this instrument catching. It is a bound on floats ALONE — every id, key set,
 * array length, integer tile coordinate and ordering still compares exactly.
 */
const JSC_ULP_BUDGET = 64;

const golden = JSON.parse(
  readFileSync(new URL('./relocation.golden.json', import.meta.url), 'utf8'),
) as Record<string, WorldProjection>;

const arms = relocationArms();

// A golden that lost an arm would pass every surviving comparison and prove less than it claims.
test('the golden covers every arm, and every arm has a golden', () => {
  assert.deepEqual(Object.keys(golden).sort(), Object.keys(arms).sort());
});

for (const [arm, { stories, opts }] of Object.entries(arms)) {
  test(`packWorld reproduces the pre-move map exactly — ${arm}`, () => {
    const before = golden[arm];
    assert.ok(before, `no golden captured for arm "${arm}"`);
    const after = JSON.parse(JSON.stringify(projectWorld(packWorld(stories, opts)))) as WorldProjection;
    assert.equal(firstDifference(before, after, arm, JSC_ULP_BUDGET), undefined);
  });
}

// The projection is the comparison SURFACE: a derived field it forgets is a field the five
// comparisons above cannot see move. Pin the shape so adding one to `Territory` without adding it
// here reds rather than quietly narrowing the proof.
test('the projection compares every derived territory field', () => {
  const t = golden['shipped']?.territories?.[0] as Record<string, unknown> | undefined;
  assert.deepEqual(Object.keys(t ?? {}).sort(), [
    'buildingGlyph',
    'caps',
    'centroid',
    'coastGroundLoops',
    'decor',
    'groundCentroid',
    'groundRadius',
    'groundSeed',
    'groundTreeSpot',
    'labelY',
    'radius',
    'stamps',
    'story',
    'tiles',
    'treeSpot',
    'wheatTiles',
  ]);
});

// `firstDifference` is the ORACLE the five comparisons above rest on: a version that returned
// `undefined` for everything would turn all of them into vacuous greens, and nothing else here
// would notice. So it is tested on its own terms, agreement AND disagreement.
test('firstDifference agrees only when the values agree', () => {
  assert.equal(firstDifference({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }), undefined);
  assert.equal(firstDifference(0, 0), undefined);
  assert.equal(firstDifference('x', 'x'), undefined);

  assert.equal(firstDifference({ a: 1 }, { a: 2 }, 'w'), 'w.a: 1 vs 2 (4503599627370496 ulp)');
  assert.equal(firstDifference([1, 2], [1, 2, 3], 'w'), 'w: length 2 vs 3');
  assert.equal(firstDifference([1, 2], { 0: 1, 1: 2 }, 'w'), 'w: array vs non-array');
  assert.equal(firstDifference({ a: 1 }, { b: 1 }, 'w'), 'w: keys a vs b');
  assert.equal(firstDifference([{ a: 'p' }], [{ a: 'q' }], 'w'), 'w[0].a: "p" vs "q"');

  // At the DEFAULT budget a float that differs in the last place is a difference — the exact
  // comparison the studio's V8-side twin makes.
  assert.equal(firstDifference(0.1 + 0.2, 0.3, 'w'), 'w: 0.30000000000000004 vs 0.3 (1 ulp)');
  // …and the budget is a budget: it forgives that one step and nothing beyond it.
  assert.equal(firstDifference(0.1 + 0.2, 0.3, 'w', 1), undefined);
  assert.equal(firstDifference(1, 1 + 2 ** -52, 'w', 1), undefined);
  assert.equal(firstDifference(1, 1 + 3 * 2 ** -52, 'w', 2), 'w: 1 vs 1.0000000000000007 (3 ulp)');
  // Slack is for floats ALONE — no budget forgives a key, a length or a string.
  assert.equal(firstDifference({ a: 1 }, { b: 1 }, 'w', 1_000_000), 'w: keys a vs b');
  assert.equal(firstDifference([1], [1, 1], 'w', 1_000_000), 'w: length 1 vs 2');
  assert.equal(firstDifference('p', 'q', 'w', 1_000_000), 'w: "p" vs "q"');
  // A non-finite value is never "close" to anything, however large the budget.
  assert.equal(ulpsApart(Number.NaN, 0), Infinity);
  assert.equal(ulpsApart(Infinity, Number.MAX_VALUE), Infinity);
  // Signed zero is the same number here, as JSON round-tripping already makes it.
  assert.equal(ulpsApart(0, -0), 0);
  assert.equal(ulpsApart(1.5, 1.5), 0);
  // The ordering is symmetric and monotone in the gap.
  assert.equal(ulpsApart(1, 1 + 2 ** -52), ulpsApart(1 + 2 ** -52, 1));
  assert.ok(ulpsApart(1, 1 + 4 * 2 ** -52) > ulpsApart(1, 1 + 2 ** -52));
  // …and it crosses zero without wrapping, which the raw bit pattern would.
  assert.equal(ulpsApart(-Number.MIN_VALUE, Number.MIN_VALUE), 2);
});

// The ULP budget above is only honest if it is a MEASUREMENT rather than a number large enough to
// hide a defect. Pin what it actually costs on this runtime: the count of numbers that are not
// bit-identical, and the worst gap among them, both far inside the budget. If a future engine (or
// a real regression) moves either, this reds — which is the difference between a bound and a
// blanket.
test('the runtime slack is a measurement: few numbers, tiny gaps, never a discrete one', () => {
  let compared = 0;
  let differing = 0;
  let worstUlp = 0;
  const fields = new Set<string>();

  const walk = (a: unknown, b: unknown, key: string): void => {
    if (typeof a === 'number' && typeof b === 'number') {
      compared += 1;
      const u = ulpsApart(a, b);
      if (u !== 0) {
        differing += 1;
        worstUlp = Math.max(worstUlp, u);
        fields.add(key);
      }
      return;
    }
    if (Array.isArray(a) && Array.isArray(b)) {
      for (let i = 0; i < a.length; i++) walk(a[i], b[i], key);
      return;
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
      for (const k of Object.keys(a as object)) {
        walk((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], k);
      }
    }
  };

  for (const [arm, { stories, opts }] of Object.entries(arms)) {
    walk(golden[arm], JSON.parse(JSON.stringify(projectWorld(packWorld(stories, opts)))), arm);
  }

  assert.ok(compared > 10_000, `expected the whole map to be compared, saw ${compared} numbers`);
  assert.ok(worstUlp <= JSC_ULP_BUDGET, `worst gap ${worstUlp} ulp exceeds the budget`);
  assert.ok(
    differing * 100 <= compared, // under 1% — measured at 0.38% on JSC, 0% on V8
    `${differing} of ${compared} numbers are not bit-identical`,
  );
  // The discrete skeleton of the map — which tile, whose, in what order, how big the frame is —
  // must be bit-identical on EVERY runtime. Only continuous coordinates may drift in the last place.
  for (const f of ['q', 'r', 'owner', 'width', 'height', 'labelY']) {
    assert.ok(!fields.has(f), `a discrete field drifted: ${f}`);
  }
});
