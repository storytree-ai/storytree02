---
id: "forest-scene-model"
tier: capability
story: website-experience
title: "The scene model — a real forest world becomes typed 3D scene geometry"
outcome: "A pure, deterministic layer turns a real @storytree/forest-world World + scene-graph into the typed 3D scene the rest of the renderer draws: kind family → mesh family, position → transform, folded status → material variant, unknown kind → an explicit skip (never a throw), plus the parcel cells, coast clip, relief, ground geometry, skirt, camera frame, texel convention and shade ladder every later lane consumes — and no scene-model module imports a surface, dressing or delivery module."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: [123, 93, 562]
# ⚠ SPLIT LANE 1 of 4 (2026-09-12) — see the provenance block in the body. This capability is the
# ROOT of the four-lane partition the import graph forced: `forest-scene-model` (here) →
# `forest-land-surface` → `forest-land-dressing` → `forest-canvas-delivery`. Its `depends_on` is
# EMPTY because the measurement found no value edge and no type edge from any scene-model module to
# any later lane — it is the layer everything else rests on.
#
# THE TWO NON-OBVIOUS MEMBERS, both forced by the measured graph rather than by their names:
#  - `kit-vocabulary` is HERE, not in dressing, even though it is the prop vocabulary.
#    `camera-framing.ts:73` imports `RENDER_ELEV_DEG` from it, so filing it under dressing would
#    make the scene model depend on the dressing lane and invert the whole partition. It is a
#    taxonomy-and-constants module, and its own two dependencies (`land-relief`, `parcel-cells`) are
#    both scene-model.
#  - `shade-ladder` is HERE. In-degree 11, ZERO dependencies of its own, and `stepped-skirt` (a
#    scene-model module) imports it — so it cannot sit in land-surface without a backedge.
#
# Node-borne proof config (ADR-0057 keystone). CARRIED FORWARD UNCHANGED from the pre-split
# `forest-rendering-engine` in its `real:` arm — same `testFile`, same `sourceFile`, same inner
# scope, same install/typecheck walls — because the arm was always about `world-to-3d.ts`, which is
# this lane's. The OUTER `scope` is NARROWED from the package-wide globs it carried before to this
# lane's own 15 modules and their tests: a package-wide write scope on a lane that owns 15 of the
# package's 46 renderer modules is an over-declaration (ADR-0087's posture), and leaving it wide
# would let this lane's leaf write the surface, dressing and delivery lanes — silently re-merging
# exactly what the split exists to separate. Narrowing a declared scope changes no behaviour and
# arms nothing new.
#
# The current real arm is the explicit per-vertex island-slot transport. It replaces the inherited
# mapper arm without claiming its three historical contracts: coverage keeps the mapper test while
# the new proof changes only `cell-ground-geometry`'s optional input/output pair.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world-r3f", "test"]
  scope:
    testGlobs:
      - "packages/forest-world-r3f/src/world-to-3d.test.ts"
      - "packages/forest-world-r3f/src/true-footprint.test.ts"
      - "packages/forest-world-r3f/src/land-per-capability.test.ts"
      - "packages/forest-world-r3f/src/parcel-cells.test.ts"
      - "packages/forest-world-r3f/src/coast-clip.test.ts"
      - "packages/forest-world-r3f/src/land-relief.test.ts"
      - "packages/forest-world-r3f/src/cell-ground-geometry.test.ts"
      - "packages/forest-world-r3f/src/stepped-skirt.test.ts"
      - "packages/forest-world-r3f/src/camera-framing.test.ts"
      - "packages/forest-world-r3f/src/resting-world-framing.test.ts"
      - "packages/forest-world-r3f/src/map-texels.test.ts"
      - "packages/forest-world-r3f/src/texture-convention.test.ts"
      - "packages/forest-world-r3f/src/true-ground.test.ts"
      - "packages/forest-world-r3f/src/kit-vocabulary.test.ts"
      - "packages/forest-world-r3f/src/shade-ladder.test.ts"
      - "packages/forest-world-r3f/src/detail-normal.test.ts"
    sourceGlobs:
      - "packages/forest-world-r3f/src/world-to-3d.ts"
      - "packages/forest-world-r3f/src/true-footprint.ts"
      - "packages/forest-world-r3f/src/land-per-capability.ts"
      - "packages/forest-world-r3f/src/parcel-cells.ts"
      - "packages/forest-world-r3f/src/coast-clip.ts"
      - "packages/forest-world-r3f/src/land-relief.ts"
      - "packages/forest-world-r3f/src/cell-ground-geometry.ts"
      - "packages/forest-world-r3f/src/stepped-skirt.ts"
      - "packages/forest-world-r3f/src/camera-framing.ts"
      - "packages/forest-world-r3f/src/map-texels.ts"
      - "packages/forest-world-r3f/src/texture-convention.ts"
      - "packages/forest-world-r3f/src/true-ground.ts"
      - "packages/forest-world-r3f/src/kit-vocabulary.ts"
      - "packages/forest-world-r3f/src/shade-ladder.ts"
      - "packages/forest-world-r3f/src/detail-normal.ts"
  coverage:
    testGlobs: ["packages/forest-world-r3f/src/world-to-3d.test.ts"]
  real:
    editsExisting: true
    testFile: "packages/forest-world-r3f/src/cell-ground-geometry.test.ts"
    sourceFile: "packages/forest-world-r3f/src/cell-ground-geometry.ts"
    scope:
      testGlobs: ["packages/forest-world-r3f/src/cell-ground-geometry.test.ts"]
      sourceGlobs: ["packages/forest-world-r3f/src/cell-ground-geometry.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world-r3f", "typecheck"]
    proofCommand:
      file: bun
      args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "packages/forest-world-r3f/src/cell-ground-geometry.test.ts"]
---

# The scene model — a real forest world becomes typed 3D scene geometry

**PROVENANCE — this capability's line of descent, and where its one signed verdict lives.**
It was `r3f-world-spike` until 2026-09-12, then `forest-rendering-engine` (both renames recorded by
ADR-0562). On **2026-09-12** `forest-rendering-engine` was SPLIT into four lanes —
`forest-scene-model` (this one), [`forest-land-surface`](forest-land-surface.md),
[`forest-land-dressing`](forest-land-dressing.md) and
[`forest-canvas-delivery`](forest-canvas-delivery.md) — and this lane is the one that kept the
`world-to-3d` proof configuration and the three contracts below, because all three were always
assertions about `world-to-3d.ts`. Its July 2026 signed verdict (`events.verdict` seq 106, run
`real-mr2pftl5`, commit `a4993f979696baf3165fd4e91b28df9c650832b2`) is recorded against the
ORIGINAL id `r3f-world-spike` and stays discoverable there — `events.verdict` is append-only, so no
rename or split can reach it. ⚠ **That verdict is history, not current credit, and it transfers to
NOTHING:** ADR-0559 D2's lifecycle rule already reset it (six later `building` marks, no later
signature), and ADR-0559 D5 is explicit that *"no continuation transfers proof to newly split
lanes."* The three sibling lanes inherited no proof whatever, and this lane's status is `proposed`
and stays `proposed` — `healthy` is earned from a signed verdict, never authored (ADR-0020).

**Outcome —** A pure, deterministic layer turns a real `@storytree/forest-world` `World` +
scene-graph into the typed 3D scene the rest of the renderer draws: the
ADR-0123 third-mapper mapping (kind family → mesh family, position → transform, folded
`SceneStatus` → material variant, unknown kind → an explicit skip and never a throw), plus the
parcel cells, coast clip, relief, ground geometry, stepped skirt, camera frame, texel/texture
convention and shade ladder every later lane consumes.

**Depends on —** (root — no within-story upstream. Its one cross-story seam is
`@storytree/forest-world`, rolled up into the story's `depends_on`.) **Nothing in this lane imports
a surface, dressing or delivery module**, and that is the measured property the whole partition
rests on, not an aspiration.

> **Proof status (honest) — the mapping heart is BUILT and was leaf-proven ONCE, in July 2026,
> against a ground obligation that has since changed; the authored status is `proposed`.** The
> gated SDK leaf authored `world-to-3d.test.ts` red → `world-to-3d.ts` green through the real
> prove-it-gate (run `real-mr2pftl5`, signed PASS @ `a4993f9` 2026-07-02, persisted to
> `events.verdict`), and the three contracts below are cited at real `file:line`. **That pass is
> not current credit.** Six later `building` marks reset it under ADR-0559 D2, and the witnessed
> ground obligation itself moved on 2026-09-02 (hex `tile` ground → relaxed-mesh `cell-ground`;
> see the corrected note in Guidance), so ADR-0559 D4 would withhold credit from it independently.
> Every reader agrees and agreed before the split: `storytree tree website-experience` reports this
> lane `status=proposed`. The other 14 modules in the lane carry real `node:test` suites but no
> contract id leads one of them; the explicit-slot proof below adds one current geometry contract
> while coverage keeps the three historical mapper contracts visible.

## The lane — 15 modules

Ordered roughly by depth, roots first. Every one of them has a `node:test` suite in the package.

| module | role |
|---|---|
| `shade-ladder` | the shading ladder's tokens and levels. Zero dependencies, in-degree 11 — the deepest root in the package. |
| `texture-convention` | the shared convention for how a texture's channels are read. |
| `map-texels` | world units ↔ texels, the resolution seam every atlas is sized against. |
| `parcel-cells` | a parcel's layout cells and points (`GPoint` / `LayoutCell`). |
| `true-footprint` | the world footprint an island actually occupies. |
| `land-relief` | the land's height field (`landHeight`). |
| `land-per-capability` | the per-capability land partition — in-degree 17, the second-deepest shared root. |
| `coast-clip` | the clip that decides where land stops and water begins. |
| `kit-vocabulary` | the prop taxonomy and its render constants (incl. `RENDER_ELEV_DEG`). **Scene model, not dressing** — see below. |
| `cell-ground-geometry` | the merged ground buffer the whole forest draws from. |
| `stepped-skirt` | the island's stepped edge; type-cycled with `cell-ground-geometry`. |
| `detail-normal` | the detail-normal convention (the TEXTURE that rides it is `forest-land-surface`'s). |
| `true-ground` | the ground surface the scene is measured against. |
| `camera-framing` | the camera frame — elevation, flattening, the resting frame (ADR-0471). |
| `world-to-3d` | the mapper itself: `World` + scene-graph → typed 3D instance descriptors. |

**WHY `kit-vocabulary` IS HERE AND NOT IN DRESSING — the discriminating fact.** Its name says
"props", and the tempting move is to file it with `kit-asset` / `kit-mesh` in
[`forest-land-dressing`](forest-land-dressing.md). The import graph refuses it:
`camera-framing.ts:73` does `import { RENDER_ELEV_DEG } from './kit-vocabulary.js'`, so a
`kit-vocabulary` in dressing would make the SCENE MODEL depend on the DRESSING lane — a backedge
across three lane boundaries, and the exact failure mode ("the lanes silently re-merge") that this
split exists to end. It is a taxonomy-and-constants module, not a prop builder; its own two
dependencies (`land-relief`, `parcel-cells`) are both scene-model, so it sits here cleanly.

**WHY `shade-ladder` IS HERE AND NOT IN LAND SURFACE.** Shading reads as surface work. But
`shade-ladder` has in-degree 11 and ZERO dependencies of its own, and one of its importers is
`stepped-skirt` — a scene-model module. Putting the ladder in land-surface would make scene-model
depend on land-surface, inverting the lane order. A shared root belongs in the deepest lane that
needs it.

## Integration test

**Goal —** Prove the world-to-3D mapping over the REAL core: a genuine `buildScene` scene-graph
input maps deterministically to typed 3D descriptors that carry the semantic layer faithfully.

1. Build a real scene from a small `SceneInput` via `@storytree/forest-world`'s `buildScene` (the
   core's OWN minimal structural input contract both existing mappers ride — `buildWorld` is studio
   chrome, deliberately surface-side per ADR-0093). Run `worldTo3d` twice → assert the outputs
   are deep-equal (determinism — the core's discipline carried into 3D).
2. Assert the core kind families each produced their descriptor branch: ≥1 instanced `cell-ground`
   descriptor per relaxed-mesh parcel, carrying that parcel's real (non-collapsing) ring of points
   and its folded status; a tree descriptor for a story node; a road descriptor for a dependency
   edge; a wisp-family descriptor when the scene carries one. And assert the RETIRED substrate's
   refusal: a scene the core built the classic way (`relaxedCells: null`, so it emits `tile`
   groups) makes `worldTo3D` throw `world-to-3d: the 3D map draws the relaxed-mesh land only — the
   classic extruded-hex ground was retired (adopt-the-land-into-the-shipped-map-arc,
   retire-the-old-land-path); build the scene with relaxedCells, not drawTiles` — the message
   pinned in FULL, because a mutant that softened or genericised the wording slips past a loose
   match.
3. Feed a scene node wearing each folded `SceneStatus` (`healthy` / `building` / `unhealthy` /
   `proposed`) → assert the descriptor's material/mesh variant differs by status (a proof-state
   change is VISIBLE in 3D — the observability thesis survives the mapper).
4. Feed a drawable with an unhandled/unknown `kind` → assert an explicit `skipped` descriptor (with
   the kind named) and no throw — the mapping is total and fail-visible.

## Explicit island-slot proof walkthrough

The canvas needs direct vertex provenance for its growth texture; an atlas UV offset is a sample
address and may be shared by different islands, so it is not identity. Extend only
`cellGroundGeometry`:

1. Add optional `CellGroundGeometryInput.islandSlot`, a resolver from the source cell's `island` id
   to one numeric slot, and `CellGroundGeometry.islandSlots`, one float per emitted vertex. Before
   the implementation, cast the result in the existing test to an optional `islandSlots` field and
   assert a two-island resolver produces the expected per-vertex slot run. At the recorded
   baseline, the result lacked that buffer, making this an assertion red against existing code.
2. With the resolver present, every top face and skirt vertex emitted from an island receives that
   island's resolver value. With it omitted, `islandSlots` is zero-length exactly like the existing
   optional atlas/status buffers, preserving the old geometry shape rather than silently declaring
   slot zero for every island. The mutation rung observed a surviving conditional at
   `cell-ground-geometry.ts:527` that makes `input.islandSlot === undefined` false. Repair that
   observed gap with the omitted-resolver case: `islandSlots` must be zero-length and
   `positions`, `normals`, `colors`, `statuses`, and `atlasOrigins` must remain byte-identical to
   the baseline geometry. This strengthens the existing optional-input contract only.
3. The resolver is passed the cell's direct `island` id. No reverse lookup from `atlasOrigins`, no
   import from delivery, and no geometry or triangulation change is allowed.

## Contracts (4)

Each one isolated automated test (`node:test`, the package suite), cited at real `file:line`. Per
ADR-0122 each contract id leads a distinctly-named test; `storytree coverage forest-scene-model`
reports 4/4, including the signed explicit-slot proof (`5e06fd51`).

⚠ **The three ids below are BYTE-IDENTICAL to the ones the pre-split `forest-rendering-engine`
carried, deliberately.** A contract id is proof-bearing identity and ADR-0253 makes criterion
identity immutable — the `r3f-` prefix is a fossil of the capability's first name, and renaming it
would break the join between the July signed verdict's coverage record and the tests that still
carry those names. The capability was renamed; its contract ids were not, and must not be.

1. **`r3f-mapping-is-deterministic`** — same World in, same descriptors out
   - **asserts —** two `worldTo3d` runs over the same real `buildScene` output are deep-equal, and
     descriptor ordering is stable — the 3D layer inherits the core's determinism, so the synced
     artifact can be drift-gated byte-stably.
   - **covers —** `packages/forest-world-r3f/src/world-to-3d.ts` — test:
     `packages/forest-world-r3f/src/world-to-3d.test.ts:155`
2. **`r3f-semantic-layer-maps-faithfully`** — kind → mesh family, position → transform, status → variant
   - **asserts —** the core kind families (relaxed-mesh parcel ground → `cell-ground`, story tree,
     road, wisp) each yield their typed descriptor branch with transforms derived from the World
     geometry, and each folded `SceneStatus` selects a distinct material/mesh variant; a scene
     carrying the RETIRED classic `tile` ground is refused outright rather than mapped or skipped.
   - **covers —** `packages/forest-world-r3f/src/world-to-3d.ts` — test:
     `packages/forest-world-r3f/src/world-to-3d.test.ts:167`
3. **`r3f-unknown-kind-skips-visibly`** — the mapping is total over kinds it has never heard of
   - **asserts —** an unhandled `SceneKind` maps to an explicit `skipped` descriptor naming the
     kind; nothing is silently dropped and nothing throws — a core addition can never crash the
     site's 3D island, only degrade visibly. (The retired classic `tile` ground is NOT an unhandled
     kind and is outside this contract: it is one the mapper understood and drew, so it refuses
     loudly instead — see the corrected ground-family note in Guidance.)
   - **covers —** `packages/forest-world-r3f/src/world-to-3d.ts` — test:
     `packages/forest-world-r3f/src/world-to-3d.test.ts:375`
4. **`r3f-ground-vertices-carry-explicit-island-slots`** — the merged ground retains the island
   identity each vertex came from
   - **asserts —** a two-island cell input and direct resolver produces one slot per emitted vertex,
     including skirt vertices, with each island's value intact; omitting the resolver leaves the
     optional slot buffer empty.
   - **covers —** `packages/forest-world-r3f/src/cell-ground-geometry.ts`

## Guidance

WHY THIS IS A CAPABILITY, NOT A CONTRACT: it is one module family — the descriptor mapping and the
geometry, framing and convention roots it rests on — proven end-to-end against the REAL core (a
real `buildScene` output over the core's own `SceneInput` contract, not a hand-rolled scene shape)
— not a single isolated assertion.

THE MAPPER CONSUMES THE SEMANTIC LAYER, NOT THE 2D PRIMITIVES (ADR-0123 §1 — hold this line
precisely). Input: the `World` geometry + the scene-graph's `kind` / position / `variant` / folded
`SceneStatus`. The mapper SUPPLIES its own 3D geometry where the SVG primitive geometry would
otherwise be consumed: the ground family becomes the merged relaxed-mesh ground; the story
tree family (`trunk`/`crown-*`/`bare`) becomes a 3D tree; a `road` becomes a path strip on the
ground; a `wisp` becomes a GPU sprite/point. The deterministic world-computation is REUSED, never
re-derived — we draw the EXISTING world in 3D.

WHICH GROUND FAMILY — CORRECTED 2026-09-02 (`adopt-the-land-into-the-shipped-map-arc`,
`retire-the-old-land-path`). This capability was authored when the ground family the mapper drew was
the CLASSIC extruded-hex one (`tile` groups, which the core emits when `relaxedCells` is null), and
every "hex ground" reading below said so. That substrate is RETIRED: the 3D map draws the
RELAXED-MESH land ONLY — the core's `cell` / `cell-wheat` paths, one per parcel, folded into
`cell-ground` descriptors carrying the parcel's closed ring of points and its folded `SceneStatus`.
A `tile` group is no longer mapped, and it is not skipped either: `worldTo3D` REFUSES it at the
first `tile` node it walks, with the message
`world-to-3d: the 3D map draws the relaxed-mesh land only — the classic extruded-hex ground was
retired (adopt-the-land-into-the-shipped-map-arc, retire-the-old-land-path); build the scene with
relaxedCells, not drawTiles`. A silent skip was the wrong shape for the retirement: `tile` is a kind
this mapper understood and used to draw, so degrading it to a skip would have reproduced the
2026-08-28 defect (a shipped island with no ground at all) with no record that anything had gone
wrong. `packages/forest-world`'s own two-substrate contract is untouched — the studio's 2D SVG map
still owns classic mode; what changed is which of the two the 3D mapper accepts.

DESCRIPTORS FIRST, JSX SECOND (the provability firewall). The heart is `world-to-3d.ts`: a pure
`.ts` function from the semantic layer to an array/graph of typed **instance descriptors** (mesh
kind, transform, instancing group, material variant from status). No React, no three.js import
needed for the mapping itself — so it is node:test-provable, headless, deterministic. The `.tsx`
canvas layer is [`forest-canvas-delivery`](forest-canvas-delivery.md)'s, deliberately in a
different lane: keep every browser-only import out of the pure modules here.

TOTALITY. The mapper must be TOTAL over kinds it has never heard of: an unhandled `SceneKind` yields
an explicit `skipped` descriptor — visible in output, never a throw, never a silent drop. The
retired `tile` substrate above is the ONE deliberate exception, and it refuses rather than skips
precisely because it is not one of them.

NO ART DIRECTION HERE — that is [`forest-land-surface`](forest-land-surface.md)'s and
[`forest-land-dressing`](forest-land-dressing.md)'s. This lane decides WHERE geometry is and WHAT
family it belongs to; those lanes decide what it looks like. An art retune that reaches into a
scene-model module is a sign the change belongs here instead, and is worth stopping over.

## Guidance — the slice that earns a signed verdict

The bootstrap rung toward `healthy` (ADR-0057 §3, NET-NEW), retained from the pre-split spec because
the `real:` arm is unchanged:

- **The test —** `packages/forest-world-r3f/src/world-to-3d.test.ts` (`node:test` +
  `node:assert/strict`, the workspace convention). Import `{ worldTo3d }` from `"./world-to-3d.js"`
  and the real core from `@storytree/forest-world`. Name each test for its contract id (`r3f-…`).
- **The GREEN —** the pure semantic-layer → descriptor mapping above (no React/three imports in
  this module); after the leaf, the package suite + typecheck are green.
- ⚠ **The July signature does not discharge a fresh run.** The witnessed ground obligation changed
  on 2026-09-02, so a re-arm here is a genuine red→green against the CURRENT `cell-ground`
  obligation, not a re-issue of the old one.

Rules:

- **Consume the semantic layer only** — never re-derive geometry, never import the 2D SVG shapes.
- **Pure module / component split is the firewall** — every module in this lane must stay importable
  under bare `node:test`; browser-only code lives in `forest-canvas-delivery`.
- **Total mapping** — unknown kinds skip visibly; the mapper may lag the core, never crash on it.
  The one exception is a kind it USED to draw: the retired classic `tile` ground refuses loudly
  (corrected 2026-09-02, above), because a skip there means an island with no ground at all.
- **No downstream imports.** A scene-model module that imports from `forest-land-surface`,
  `forest-land-dressing` or `forest-canvas-delivery` is a lane backedge — including an
  `import type`, because a type cycle pins the two modules into one lane at compile time just as
  firmly as a value cycle does.
