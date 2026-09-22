/**
 * THE LAND AND THE OBJECTS ON IT READ ONE CAMERA — ADR-0367 D1.
 *
 * Two assertions, and neither was expressible before this increment because only one side of the
 * composition had a constant at all:
 *
 *   1. The land's projection and the sprite registration derive from the SAME declared value, and
 *      moving that value moves BOTH.
 *   2. An object's ground contact point lands on the land cell it is anchored to, across the range
 *      of that value.
 *
 * The second reads the placement out of `organicLayerBox` — the function `SceneView` itself renders
 * from — rather than restating the arithmetic, so a drift in the renderer fails here.
 *
 * ⚠ ONE CAMERA PER SURFACE, NOT ONE CAMERA FOR THE WHOLE REPO (ADR-0593). "The land and the objects
 * on it read one camera" is a claim about objects that actually STAND on the land. The round-3
 * comparison lab's candidates (`CHAPTER2_ROUND3_TREE_CANDIDATES`) do not — they are a static witness
 * stage comparing hero-tree renders against EACH OTHER — so the tests below that exercise that
 * registry compare its shipped frames against `CHAPTER2_ROUND3_LAB_ELEVATION_DEG`, the lab's own
 * witness camera, never against `LAND_CAMERA_ELEVATION_DEG`. See that constant's doc comment
 * (`chapter2-round3-tree-candidates.ts`) for the measured one-consumer fact this rests on, and the
 * "has TEETH" control near the bottom of this file for the mechanical check that keeps it true.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HEX_R,
  LAND_CAMERA_ELEVATION_DEG,
  PLAN_VIEW_ELEVATION_DEG,
  groundFlattening,
  hexCenter,
  hexCorners,
  spriteUprightScale,
  uprightForeshortening,
  type Axial,
  type Pt,
} from '@storytree/forest-world';
import {
  assertSpriteRenderMatchesLandCamera,
  organicLayerBox,
  organicLayerGroundContact,
  spriteRenderMatchesLandCamera,
  spriteUprightReconciliation,
  type OrganicLayerPlacement,
} from './land-camera.js';
import {
  CHAPTER2_ROUND3_LAB_ELEVATION_DEG,
  CHAPTER2_ROUND3_TREE_CANDIDATES,
  chapter2Round3TreeCandidate,
} from './chapter2-round3-tree-candidates.js';

/** The declared value plus a sweep either side — the range the invariants must hold over. */
const SWEEP = [12, 15, 20, 26.565, 30, 45, 60] as const;

function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (!a || !b) continue;
    const straddles = a.y > p.y !== b.y > p.y;
    if (straddles && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** The projected polygon of one land cell, at a given camera. */
function cellPolygon(h: Axial, elevationDeg: number): Pt[] {
  const c = hexCenter(h, { elevationDeg });
  return hexCorners(c.x, c.y, HEX_R, elevationDeg);
}

/**
 * The hero-tree sprite planted on one cell at a given camera. `scale` puts the sprite's registered
 * footprint at roughly a cell's width, which is how it is mounted; the assertion below does not
 * depend on the exact value, only on the anchor landing where the renderer puts it.
 */
function plantedHeroTree(h: Axial, elevationDeg: number): OrganicLayerPlacement {
  const candidate = chapter2Round3TreeCandidate('code-blender');
  return {
    canvas: candidate.canvas,
    assetAnchor: candidate.groundAnchor,
    worldAnchor: hexCenter(h, { elevationDeg }),
    scale: (HEX_R * 2) / candidate.canvas.width,
    projection: spriteUprightReconciliation(candidate.renderedCameraElevationDeg, elevationDeg),
  };
}

describe('the land and its objects read ONE declared camera', () => {
  it('the shipped sprite frames are still rendered at the round-3 lab’s own witness camera', () => {
    // WHAT THIS REPLACED, AND WHY. This assertion used to read
    //     expect(codeBlender.authoredCameraElevationDeg).toBe(LAND_CAMERA_ELEVATION_DEG)
    // while the registration's value WAS `LAND_CAMERA_ELEVATION_DEG` — so it compared the constant
    // to itself and could not fail for any value of it. Bumping the land's camera moved the
    // registration with it, the app went on claiming the sprite had been rendered at the new angle,
    // and the committed PNG frames were still 20 degrees. PR #1344's proof — that the land
    // projection and the sprite registration derive from the SAME constant — kept passing through
    // exactly that mismatch, because nothing compared the constant to the PIXELS.
    //
    // The registration now records the angle its frames were actually rendered at, as a literal, so
    // this is a real comparison of two independent facts.
    //
    // AND WHY THE THIRD ARGUMENT CHANGED (ADR-0593). This candidate ships frames rendered at 20°
    // and does not stand on the land at all — it is mounted only by the round-3 comparison lab, a
    // static witness stage — so the surface it is checked against is the LAB's own witness camera
    // (`CHAPTER2_ROUND3_LAB_ELEVATION_DEG`, also 20°), not `LAND_CAMERA_ELEVATION_DEG` (now 50°
    // under ADR-0593 D1). Comparing against the land here would demand a re-render this sprite does
    // not owe: nothing mounts it on land drawn at the land's camera.
    const codeBlender = chapter2Round3TreeCandidate('code-blender');
    expect(codeBlender.renderedCameraElevationDeg).toBe(20);
    assertSpriteRenderMatchesLandCamera(
      codeBlender.heroTreeTrackId,
      codeBlender.renderedCameraElevationDeg,
      CHAPTER2_ROUND3_LAB_ELEVATION_DEG,
    );
  });

  it('EVERY track’s shipped frames are current against the round-3 lab’s own witness camera', () => {
    // See the test above for why the comparison surface is the LAB's camera and not the land's:
    // every candidate in this registry is mounted only by the round-3 comparison lab.
    for (const c of CHAPTER2_ROUND3_TREE_CANDIDATES) {
      expect(
        () =>
          assertSpriteRenderMatchesLandCamera(
            c.heroTreeTrackId,
            c.renderedCameraElevationDeg,
            CHAPTER2_ROUND3_LAB_ELEVATION_DEG,
          ),
        `${c.id} ships frames rendered at a camera the round-3 lab no longer declares`,
      ).not.toThrow();
    }
  });

  it('has TEETH: the round-3 lab registry is mounted ONLY by the lab — the moment a second consumer appears, its camera choice must be re-decided rather than inherited', () => {
    // The two tests above compare every candidate's shipped frames against the LAB's own witness
    // camera rather than the land's, which is correct ONLY because nothing in this registry stands
    // on the working map today. That is a fact about the current import graph, not a law — and if it
    // ever stops being true, comparing against the lab's fixed 20° instead of
    // `LAND_CAMERA_ELEVATION_DEG` would silently mis-plant whatever got mounted on the real land.
    //
    // So this scans every non-test TypeScript source file this repo ships (its own package, the one
    // known consumer's app, and the public website — the three places this repo has ever shipped
    // land art from) for a reference to the registry's exports, and fails the instant a second
    // consumer shows up. It does not guess what the right comparison would be for that new consumer
    // — it only refuses to let the "compare against the lab" decision above survive unexamined.
    const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
    const REGISTRY_FILE = fileURLToPath(new URL('./chapter2-round3-tree-candidates.ts', import.meta.url));
    const BARREL_FILE = fileURLToPath(new URL('./index.ts', import.meta.url));
    const REGISTRY_IDENTIFIERS = ['chapter2Round3TreeCandidate', 'CHAPTER2_ROUND3_TREE_CANDIDATES'];
    const scanTrees: ReadonlyArray<{ label: string; dir: string }> = [
      { label: 'packages/app-surface/src', dir: resolve(repoRoot, 'packages/app-surface/src') },
      { label: 'apps/studio/src', dir: resolve(repoRoot, 'apps/studio/src') },
      { label: 'web/src', dir: resolve(repoRoot, 'web/src') },
    ];
    const consumers: string[] = [];
    for (const { label, dir } of scanTrees) {
      if (!existsSync(dir)) continue; // web/ is a submodule; skip precisely as check:web-engine does
      const entries = (readdirSync(dir, { recursive: true, encoding: 'utf8' }) as string[])
        .map((entry) => entry.replace(/\\/g, '/'))
        .filter((entry) => /\.(?:ts|tsx)$/.test(entry))
        .filter((entry) => !entry.includes('.test.'));
      for (const entry of entries) {
        const full = resolve(dir, entry);
        if (full === REGISTRY_FILE || full === BARREL_FILE) continue; // definition and re-export, not a mount
        const source = readFileSync(full, 'utf8');
        if (REGISTRY_IDENTIFIERS.some((id) => source.includes(id))) consumers.push(`${label}/${entry}`);
      }
    }
    expect(
      consumers.sort(),
      'a new consumer of the round-3 lab registry must decide, in this file, whether its mounted ' +
        'track stands on the lab (compare against CHAPTER2_ROUND3_LAB_ELEVATION_DEG, as above) or ' +
        'the working map (compare against LAND_CAMERA_ELEVATION_DEG) — never inherit either choice',
    ).toEqual(['apps/studio/src/components/SemanticGrowthDemo.tsx']);
  });

  it('a stale render is REFUSED — recording 20 deg against a land declared at 35 is not current', () => {
    // The red half, and the whole point of the field being a record. This is what a constant bump
    // without a re-render looks like from the app's side, and it must be a failure rather than a
    // silently wrong picture.
    expect(spriteRenderMatchesLandCamera(20, 35)).toBe(false);
    expect(() =>
      assertSpriteRenderMatchesLandCamera('chapter2-round3-code-blender-hero-tree-track-v1', 20, 35),
    ).toThrow(/STALE SPRITE RENDER/);
    // and the refusal has to say what clears it, not merely that something is wrong
    expect(() => assertSpriteRenderMatchesLandCamera('t', 20, 35)).toThrow(/re-render/i);
  });

  it('has TEETH: the check compares the RECORDED value, so it cannot pass by self-comparison', () => {
    // Without this control the suite above could be satisfied by a check that read the land's
    // constant on both sides — which is precisely the defect being fixed, and which no behavioural
    // assertion about the CURRENT (agreeing) state can distinguish from a correct one.
    //
    // 1. It is genuinely two-argument: the same recorded value is current at one land camera and
    //    stale at another, and a different recorded value is current at the angle it matches.
    expect(spriteRenderMatchesLandCamera(20, 20)).toBe(true);
    expect(spriteRenderMatchesLandCamera(20, 35)).toBe(false);
    expect(spriteRenderMatchesLandCamera(35, 35)).toBe(true);
    expect(spriteRenderMatchesLandCamera(35, 20)).toBe(false);
    // A track with no camera at all has no render to have gone stale.
    expect(spriteRenderMatchesLandCamera(null, 35)).toBe(true);

    // 2. And the RECORD is a literal in the source, not the constant wearing a new field name. This
    //    is the control that actually prevents regression: re-introducing
    //    `renderedCameraElevationDeg: LAND_CAMERA_ELEVATION_DEG` would restore the tautology while
    //    leaving every assertion above green.
    const source = readFileSync(
      new URL('./chapter2-round3-tree-candidates.ts', import.meta.url),
      'utf8',
    );
    expect(
      /renderedCameraElevationDeg:\s*LAND_CAMERA_ELEVATION_DEG/.test(source),
      'the registration must RECORD its render angle, never restate the land constant',
    ).toBe(false);
    expect(
      /^\s*import\s*\{[^}]*\bLAND_CAMERA_ELEVATION_DEG\b/m.test(source),
      'the registration module must not import the land camera constant at all',
    ).toBe(false);
    expect(
      (source.match(/renderedCameraElevationDeg:\s*-?\d+(?:\.\d+)?\s*,/g) ?? []).length,
    ).toBeGreaterThan(0);
  });

  it('every candidate states a camera or states that it has none', () => {
    for (const c of CHAPTER2_ROUND3_TREE_CANDIDATES) {
      const declared = c.renderedCameraElevationDeg;
      expect(declared === null || (declared > 0 && declared < PLAN_VIEW_ELEVATION_DEG)).toBe(true);
    }
    // Exactly one track is code-generated at a declared camera today; the rest are 2D plates.
    const withCamera = CHAPTER2_ROUND3_TREE_CANDIDATES.filter(
      (c) => c.renderedCameraElevationDeg !== null,
    );
    expect(withCamera.map((c) => c.id)).toEqual(['code-blender']);
  });

  it('moving the declared camera moves BOTH the land projection and the sprite reconciliation', () => {
    // The load-bearing half of assertion 1. Before this increment the land had no constant to move,
    // so this could not be written: the land was fixed in plan view and only the sprite had a dial.
    const landSeen = new Set<number>();
    const spriteSeen = new Set<number>();
    for (const deg of SWEEP) {
      landSeen.add(groundFlattening(deg));
      spriteSeen.add(spriteUprightReconciliation(LAND_CAMERA_ELEVATION_DEG, deg));
    }
    expect(landSeen.size).toBe(SWEEP.length);
    expect(spriteSeen.size).toBe(SWEEP.length);

    // ...and they move as ONE camera, not as two independent knobs: each side is sin/cos of the
    // same angle, so the land's flattening determines the sprite's correction exactly.
    for (const deg of SWEEP) {
      const land = groundFlattening(deg);
      const implied = Math.sqrt(1 - land * land); // cos, from the land's own sin
      expect(spriteUprightReconciliation(LAND_CAMERA_ELEVATION_DEG, deg)).toBeCloseTo(
        implied / uprightForeshortening(LAND_CAMERA_ELEVATION_DEG),
        12,
      );
    }
  });

  it('a sprite authored at the land camera needs NO reconciliation — the dial stops being the mechanism', () => {
    expect(spriteUprightReconciliation(LAND_CAMERA_ELEVATION_DEG)).toBe(1);
    expect(spriteUprightReconciliation(null)).toBe(1);
    // And it is still a live function of the land camera: re-declare the land and the shipped
    // sprites need re-rendering, which this number is the warning for.
    expect(spriteUprightReconciliation(LAND_CAMERA_ELEVATION_DEG, 30)).not.toBe(1);
    expect(spriteUprightReconciliation(LAND_CAMERA_ELEVATION_DEG, 30)).toBeCloseTo(
      spriteUprightScale(LAND_CAMERA_ELEVATION_DEG, 30),
      12,
    );
  });
});

describe('an object’s ground contact lands on the cell it is anchored to', () => {
  it('holds for a patch of cells across the range of the declared camera', () => {
    // Proof assertion 2. The contact point is read back out of the box `SceneView` renders, so this
    // fails if the renderer's placement and the land's mapping ever stop agreeing.
    for (const deg of SWEEP) {
      for (let q = -3; q <= 3; q++) {
        for (let r = -3; r <= 3; r++) {
          const h: Axial = { q, r };
          const contact = organicLayerGroundContact(plantedHeroTree(h, deg));
          expect(
            pointInPolygon(contact, cellPolygon(h, deg)),
            `${deg} deg: the hero tree on cell ${q},${r} is not standing on it`,
          ).toBe(true);
        }
      }
    }
  });

  it('the contact is a FIXED POINT of the reconciliation — the dial never lifts the tree', () => {
    const h: Axial = { q: 1, r: -2 };
    const base = plantedHeroTree(h, LAND_CAMERA_ELEVATION_DEG);
    const anchored = organicLayerGroundContact(base);
    for (const projection of [1, 0.9, 0.82, 0.72]) {
      const contact = organicLayerGroundContact({ ...base, projection });
      expect(contact.x).toBeCloseTo(anchored.x, 12);
      expect(contact.y).toBeCloseTo(anchored.y, 12);
      expect(pointInPolygon(contact, cellPolygon(h, LAND_CAMERA_ELEVATION_DEG))).toBe(true);
    }
  });

  it('has TEETH: an anchor placed by the pre-camera mapping falls OFF the angled cell', () => {
    // Without this control the suite above would pass for any mapping at all. A cell drawn at the
    // declared camera whose object is still anchored in plan view is exactly the state ADR-0367 D1
    // was written to end, and it must be caught rather than absorbed.
    const h: Axial = { q: 0, r: 3 };
    const stale = organicLayerGroundContact({
      ...plantedHeroTree(h, LAND_CAMERA_ELEVATION_DEG),
      worldAnchor: hexCenter(h, { elevationDeg: PLAN_VIEW_ELEVATION_DEG }),
    });
    expect(pointInPolygon(stale, cellPolygon(h, LAND_CAMERA_ELEVATION_DEG))).toBe(false);
  });

  it('the rendered box still spans the sprite canvas at the reconciled scale', () => {
    const h: Axial = { q: 2, r: 0 };
    const layer = plantedHeroTree(h, LAND_CAMERA_ELEVATION_DEG);
    const box = organicLayerBox(layer);
    expect(box.width).toBeCloseTo(layer.canvas.width * layer.scale, 12);
    expect(box.height).toBeCloseTo(layer.canvas.height * layer.scale * (layer.projection ?? 1), 12);
  });
});
