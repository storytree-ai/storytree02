---
id: "render-core"
tier: capability
story: forest-world
title: "The render core — the deterministic geometry kernel and framework-agnostic scene-graph both surfaces draw from"
outcome: "The pure geometry kernel (mesh, coast, ranking, hex, sizing) and the framework-agnostic scene-graph (buildScene over the core's own SceneInput) turn story data into byte-identical typed drawables, including each coverage-flora item's semantic true-ground anchor and scale — the one deterministic look both the studio and the website render."
status: proposed
proof_mode: integration-test
depends_on: []
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world", "test"]
  scope:
    testGlobs:
      - "packages/forest-world/src/forest-world.test.ts"
      - "packages/forest-world/src/routing.test.ts"
      - "packages/forest-world/src/scene.test.ts"
    sourceGlobs: ["packages/forest-world/src/scene.ts"]
  coverage:
    testGlobs:
      - "packages/forest-world/src/forest-world.test.ts"
      - "packages/forest-world/src/routing.test.ts"
      - "packages/forest-world/src/scene.test.ts"
  real:
    editsExisting: true
    testFile: "packages/forest-world/src/scene.test.ts"
    sourceFile: "packages/forest-world/src/scene.ts"
    scope:
      testGlobs:
        - "packages/forest-world/src/forest-world.test.ts"
        - "packages/forest-world/src/routing.test.ts"
        - "packages/forest-world/src/scene.test.ts"
      sourceGlobs: ["packages/forest-world/src/scene.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world", "typecheck"]
    proofCommand:
      file: bun
      args:
        - "test"
        - "--preload"
        - "./scripts/tsx-cache-off.mjs"
        - "packages/forest-world/src/forest-world.test.ts"
        - "packages/forest-world/src/routing.test.ts"
        - "packages/forest-world/src/scene.test.ts"
---

# The render core — the geometry kernel + the framework-agnostic scene-graph

**Outcome —** The pure geometry kernel (mesh, coast, ranking, hex, sizing) and the framework-agnostic
scene-graph (`buildScene` over the core's own `SceneInput`) turn story data into byte-identical typed
drawables — the one deterministic look both the studio and the website render.

**Current producer unit —** a parcels-present scene may carry capability ground when its public
consumer does not publish the capability's declared contract count. Make `SceneParcelInput.testCount`
optional: absence means **coverage unreported**, not zero. Keep that capability's exact parcel ground,
capability id and folded status, but append no `parcel-flora` for it. Numeric counts, including `0`,
keep the frozen numeric surface behavior. The source is a core semantic producer for the later public
3D adapter; it does not publish a new field, infer a count, alter the current studio rendering, or
choose an appearance.

**Depends on —** nothing in-story; this capability IS the render core, the story's within-story root
(ADR-0010 §3). The three thin mappers (studio React, website string-SVG, R3F) live with their
surfaces/packages, not here.

> **Proof status (honest) — `proposed`, greenfield without a current signed pass.**
> `packages/forest-world` was built inside this initiative and has a real, passing OFFLINE suite (122
> tests across the geometry kernel, trail router and scene-graph). Neither those standing tests nor
> retrospective capability registration makes it brownfield or Adopt-bound (ADR-0395). This is the
> capability FLOOR (ADR-0222 D2, option A): one capability standing for the render core so the island
> grows honest flora, split no finer until an in-core unit earns its own red→green leg. `healthy` is
> DERIVED from signed proof (ADR-0020 / ADR-0040), never authored.

## Guidance

The core holds BOTH pure layers (ADR-0093, strategy C). The **geometry kernel**: the relaxed
Townscaper mesh substrate (`substrate.ts`), the Chaikin-smoothed coastline (`coast.ts`), longest-path
dependency ranking (`ranking.ts`), the hex math (`hex.ts`), the seeded RNG (`rng.ts`), the tree /
territory sizing (`sizing.ts`), and the deterministic cost-grid trail router (`routing.ts`, ADR-0169).
The **scene-graph** (`scene.ts`): `buildScene` folds the core's own minimal `SceneInput` contract into
a tree of typed drawables (kind / variant / already-folded visual status) that every thin mapper walks,
and the per-parcel SURFACES emit a parcel's flora with density ∝ its published numeric `testCount`.
When that count is unreported, the parcel surface still carries ground identity and status without
inventing coverage flora.

Determinism is the load-bearing property, and the suite asserts it directly: same input → byte-identical
mesh, coast, scene, and trail network; no store, no React, no live data, no `node:*` import. Keep the
core browser-bundleable (the studio bundles it) — pure geometry / zod-types-only. The whole suite runs
offline: `pnpm --filter @storytree/forest-world test`.

**Active proof boundary —** the only implementation source is `scene.ts`. The real test fence also
includes the existing geometry, routing and scene suites so their unchanged regression predicates can
name their declared contracts; this is binding follow-through, not an implementation expansion. The
current red→green behavioural test is `rc-unreported-parcel-coverage-emits-no-flora`. It invokes the
actual package compiler over a naturally typed omitted-count client fixture, then proves the runtime
surface: status-tinted capability ground remains, parcel flora is suppressed, and numeric density
(including zero) remains numeric. It does not add public data, infer coverage, change status folding,
or alter a flat/published appearance.

## Integration test

**Goal —** Fold a small story input through the real render core — kernel → ranking → routing → scene —
and assert a byte-identical, correctly-ranked, correctly-folded scene comes out, against the real core
modules (no stubs within the organism).

The integration test exercises render-core against its **real in-story collaborators** — the real
`substrate` / `coast` / `ranking` / `hex` / `sizing` / `routing` / `scene` modules — with no stubs. It
would build a `SceneInput` from a small story graph, assert `buildScene` produces the expected typed
drawables with folded status, ranking places a dependent strictly above every dependency (cycle-safe),
the trail router emits a deterministic shared-segment network, and a second run is byte-identical.

## Current real-arm proof walkthrough

1. In the named Bun test, declare the two omitted-count parcels as ordinary `SceneParcelInput`
   literals — no cast, `@ts-expect-error`, source-text match or separate shadow interface. Invoke the
   actual `pnpm --filter @storytree/forest-world typecheck` command and assert its process exits zero.
   On the old required field, the compiler rejects this real client fixture and makes this test red;
   making the field optional is the green change.
2. Give the same real `buildScene` input plan view / `anchorSpace: 'ground'`, distinct ids, folded
   statuses, themes and true-ground seeds. Keep relaxed cells, `decor` and `plants` present so both
   the parcel surface and the legacy fallback are observable.
3. The result has a non-empty, status-carrying `parcel` ground group for each capability and is
   byte-identical on a second identical build. It has no `parcel-flora` for either unreported parcel.
4. It has no decorative `conifer` or one-plant `flora`: coverage absence keeps the parcel surface;
   it must never mean parcels absent. The same otherwise-identical fixture with `testCount: 0` emits
   its existing numeric baseline `parcel-flora`. This distinguishes zero from unreported. The
   existing positive-count density contract remains unchanged.

The prior anchor-and-scale producer proof remains contract 9 and its named regression test. It is
not reimplemented by this arm.

## Contracts (10)

The test-proven leaf behaviours — each **one isolated automated test** in the
`@storytree/forest-world` suite; the current proof arm keeps the existing predicates as regressions
and earns a fresh red→green verdict on the unreported-count producer boundary.

1. **`rc-mesh-substrate-deterministic`** — the relaxed mesh substrate is deterministic from a seed
   - **asserts —** `substrate.ts` builds the relaxed Townscaper mesh byte-identically for the same seed
     (the seeded RNG `rng.ts` gives no `Math.random`, no clock).
   - **covers —** `packages/forest-world/src/substrate.ts` (with `rng.ts`)
   - **proven by —** `packages/forest-world/src/forest-world.test.ts`.
2. **`rc-coastline-chaikin-smoothed`** — the coastline is a Chaikin-smoothed closed loop
   - **asserts —** `coast.ts` smooths a territory boundary into the expected Chaikin-refined coastline,
     deterministically.
   - **covers —** `packages/forest-world/src/coast.ts`
   - **proven by —** `packages/forest-world/src/forest-world.test.ts`.
3. **`rc-longest-path-ranking-cycle-safe`** — ranking places a dependent strictly above every dependency
   - **asserts —** `ranking.ts` ranks by longest path so a dependent is strictly above all its
     dependencies, and stays cycle-safe (a cycle does not hang or mis-rank).
   - **covers —** `packages/forest-world/src/ranking.ts`
   - **proven by —** `packages/forest-world/src/forest-world.test.ts`.
4. **`rc-hex-and-sizing-geometry`** — the hex math and tree/territory sizing are correct and stable
   - **asserts —** `hex.ts` computes hex coordinates/geometry and `sizing.ts` derives tree / territory
     sizes consistently for the same input.
   - **covers —** `packages/forest-world/src/hex.ts` (with `sizing.ts`)
   - **proven by —** `packages/forest-world/src/forest-world.test.ts`.
5. **`rc-trail-router-deterministic-network`** — the cost-grid router emits a deterministic shared-segment trail network
   - **asserts —** `routing.ts` routes every edge over the shared cost field (islands blocked, reuse
     discount so trunks emerge) and returns a byte-identical shared-segment network for the same
     `(islands, edges, seed)`; an edge that cannot route with islands blocked re-routes hidden with rim
     cave portals.
   - **covers —** `packages/forest-world/src/routing.ts`
   - **proven by —** `packages/forest-world/src/routing.test.ts`.
6. **`rc-scene-folds-drawables-and-status`** — `buildScene` folds `SceneInput` into typed, status-carrying drawables
   - **asserts —** `buildScene` folds the core's `SceneInput` into a tree of typed drawables (kind /
     variant / already-folded visual status), byte-identically for the same input.
   - **covers —** `packages/forest-world/src/scene.ts` (`buildScene`)
   - **proven by —** `packages/forest-world/src/scene.test.ts`.
7. **`rc-flora-density-is-test-count`** — a parcel's flora density tracks its `testCount`
   - **asserts —** a higher-`testCount` parcel grows strictly more flora on the same island / theme /
     seed (the per-parcel SURFACES density ∝ `testCount`, not parcel area).
   - **covers —** `packages/forest-world/src/scene.ts` (the parcel SURFACES)
   - **proven by —** `packages/forest-world/src/scene.test.ts`.

8. **`rc-claim-layer-never-folds-proof-vocabulary`** — the scene fold's CLAIM layers never wear the
   proof vocabulary: no folded `status`, in any grade, on the
   departure layer, or under a green build band (the ADR-0138 §5 honesty wall, in the scene core)
   - **asserts —** the layers `buildScene` folds for claims and departures carry the wall in three
     directions. **(a) Every colour-state:** for `authoring` / `proving` / `supplementing`, NO node
     in the walked `claim-wisps` subtree carries a folded `status` — `proving`
     is the at-risk hue that must not read as the island's proven-green one. **(b) Every grade plus
     the departure layer:** with `exploring` / `waiting` / `work` claims and a departure present, no
     node under `claim-wisps` OR `departing-wisps` carries a folded `status`. **(c) Under a GREEN
     band (ADR-0212):** folding a claim whose `phase` is `GATE` leaves
     `colourState` still `proving` (green is expressed as MOTION, never overwritten into the claim's
     colour) and leaves `status` unset — so a green band never
     turns the claim body into a proof.
   - **note — RENAMED AND RE-EXPRESSED 2026-09-07 under ADR-0536, unchanged in FORCE (ADR-0529 is
     what moved).** This contract was `rc-claim-layer-never-folds-bloom-vocabulary` and asserted that
     no claim-layer node carried a bloom drawable KIND (`bloom-anchor` / `bloom-crown` /
     `bloom-plant` / `bloom-ring` / `bloom-spark`) or a verdict `outcome`. ADR-0529 retired the
     verdict bloom; the five kinds are deleted from the kind union and `SceneNode.outcome` is
     deleted with them, since `buildBloom` was its only writer. **A "no bloom kind" assertion over a
     union that no longer contains one is guaranteed by the type system and verifies nothing**, which
     is the reason this is a re-expression rather than a deletion (ADR-0536 D5): the surviving,
     refutable form of the same wall is that no claim-layer node carries a folded `status`, because
     `status` is what the island's proven-green hue is folded from and it is a field a careless
     future fold really could reach for. One-directional by design: the CONVERSE (a proof drawable
     reaching for claim styling) is not this contract's claim and remains uncovered here.
   - **covers —** `packages/forest-world/src/scene.ts` (`buildScene`, the `claim-wisps` /
     `departing-wisps` layers) — the same fold contract 6 covers; this is its honesty INVARIANT, the
     one property of the fold that is load-bearing beyond determinism, which is why it is declared
     apart rather than folded into `rc-scene-folds-drawables-and-status`.
   - **proven by —** `packages/forest-world/src/scene.test.ts` — three tests, one per direction:
     *"§5 honesty wall: a claim wisp NEVER carries the proof signal — no folded `status` anywhere on
     the claim layer"*, *"§5 honesty wall holds for EVERY grade + the departure layer: no folded
     status"*, and *"ADR-0212: folding a GREEN build band never turns the claim body into a proof
     (the §5 wall holds)"*. Each carries this contract's id verbatim in its title. Offline, in the
     standing `pnpm --filter @storytree/forest-world test`
     suite that `forest-world#gate-1` observes.
   - **note — cited contract, retained in the active proof surface.** This contract exists so a
     lower-tier citation of the wall (the ADR-0294 D2 deletion of `wisp-as-story-claim#uat-7`) can
     name a contract id instead of a free-form test title. The current `real:` arm is deliberately
     narrower: it can build only the unreported-count producer boundary in `scene.ts` /
     `scene.test.ts`.
     `real.testFile` keeps this named scene test in the active surface, so the new arm does not
     silently erase its existing proof reference.
9. **`rc-coverage-flora-carries-semantic-ground-anchor-and-scale`** — every generated capability
   coverage item reports the pivot and scale needed to stand its existing semantic mark on 3D ground
   - **asserts —** every `parcel-flora` item from a real `buildScene` has an absolute
     `groundAnchor` and `floraScale` copied from the same pivot-scale transform the current SVG
     renderer uses. The fields preserve the item's exact generated count, painter order, child SVG
     geometry, transform, capability id, theme and folded status. A multi-parcel fixture varies ids,
     themes, statuses and test counts so copied or omitted metadata cannot pass.
   - **covers —** `packages/forest-world/src/scene.ts` (`parcelFloraItem` and its typed scene-node
     fields) — test: `packages/forest-world/src/scene.test.ts` (new named test).
10. **`rc-unreported-parcel-coverage-emits-no-flora`** — an absent capability count is unreported
    coverage, not zero or the legacy no-parcels path
    - **asserts —** the actual package compiler accepts ordinary typed `SceneParcelInput` client
      literals whose `testCount` property is omitted (no cast or expected-error); on that same
      true-ground, parcels-present input, `buildScene` retains every capability's non-empty parcel
      ground, cap id and folded status deterministically, but emits no `parcel-flora`; it also emits
      neither legacy decorative conifers nor the one-plant ring. An otherwise identical explicit
      `testCount: 0` control keeps its current numeric baseline flora, proving zero differs from
      absent.
    - **covers —** `packages/forest-world/src/scene.ts` (`SceneParcelInput` and
      `buildTerritorySurface`).
    - **proven by —** `packages/forest-world/src/scene.test.ts` in the one named test carrying this
      contract id, which invokes the declared package `typecheck` command and checks its exit code
      before exercising the real runtime scene.
