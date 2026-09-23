---
id: "forest-land-dressing"
tier: capability
story: website-experience
title: "The land dressing — what stands ON the land once the land itself reads right"
outcome: "The surfaced land is dressed: kit assets become kit meshes placed on the ground, leaf tint and prop lighting make them sit in the same light as the ground beneath them, ground cover and map dressing populate the land between the props, and the island path is laid across it — every placement derived from the scene model's cells, never from a hand-placed coordinate."
status: proposed
proof_mode: integration-test
depends_on: [forest-scene-model, forest-land-surface]
decisions: [123, 562]
# ⚠ SPLIT LANE 3 of 4 (2026-09-12). Born of the `forest-rendering-engine` split; it inherited the
# 8 modules below and NOTHING ELSE. ⚠ **No proof came with it** — ADR-0559 D5: "no continuation
# transfers proof to newly split lanes." The pre-split capability's single July 2026 signed verdict
# proved `world-to-3d.ts` and is `forest-scene-model`'s history; it says nothing about any module
# here. This lane starts `proposed` with zero signed credit.
#
# ⚠ `kit-vocabulary` IS NOT IN THIS LANE, and that is the one placement a reader will want to
# correct. It is the prop vocabulary and it looks like dressing, but `camera-framing.ts:73` imports
# `RENDER_ELEV_DEG` from it — so filing it here would make the SCENE MODEL depend on the DRESSING
# lane, a backedge across three boundaries. It lives in `forest-scene-model` as a
# taxonomy-and-constants root. Consume it from there; do not move it.
#
# WHY THIS LANE DEPENDS ON THE SURFACE AS WELL AS THE SCENE MODEL: `prop-lighting` and `leaf-tint`
# have to sit a prop in the SAME light the ground is already wearing, and `dressing-ground` /
# `cover-dressing` populate the land between props against the surfaced ground. Both edges are real
# forward value edges in the measured graph; neither is invented to be safe.
#
# Node-borne proof config (ADR-0057). `command` is the package suite, which really does run every
# test named below — all 8 modules carry a `node:test` suite today.
#
# ⚠ THE `real:` ARM WAS ADDED BY THIS LANE'S FIRST UNIT (2026-09-23, `three-d-pathways-arc-inc-01`),
# exactly as the note it replaces reserved: "the first unit taken in this lane adds the arm with the
# pair it actually authors." That completed `island-path.test.ts` -> `island-path.ts` work remains
# as coverage. This current arm advances the same capability through
# `map-dressing.test.ts` -> `map-dressing.ts`, with the merge seam named in its broad source scope.
# It remains `editsExisting`: the placement and merge algorithms EXIST; the mechanical red is an
# assertion against their current missing provenance output, never a loader failure.
#
# ⚠ IT DECLARES AN EXPLICIT `proofCommand`, AND THE REASON IS THE RUNTIME rather than the scope.
# The default proof is `node --import tsx --test <testFile>` at the WORKTREE ROOT, and `tsx` does
# not resolve from this repo's root — measured 2026-09-23, `ERR_MODULE_NOT_FOUND 'tsx'`, the same
# trap CLAUDE.md records for a bare CLI invocation. This package moved to Bun as a test RUNTIME in
# `bun-runtime-migration-arc` increment 2, so the honest oracle is `bun test`, preloaded the same
# way the package's own `test` script preloads it. This arm declares both dressing and merge test
# files because its source scope crosses that seam. It is ONE oracle serving both the spine's
# red/green observation and the leaf's `run_proof` feedback tool, and it cannot forge a green: the
# spine still spawns it out-of-band and CONFIRM_RED must see a real red first.
#
# The current real arm is the map-dressing attribution sidecar and its one merge seam. It follows
# the completed four shoreline contracts while coverage retains their `island-path.test.ts` proof.
# The sidecar is a semantics-bearing producer output, not canvas glue: it says which island may
# make each prop appear before the canvas decides whether to draw it; the optional merger callback
# keeps that identity available after material/tint batching without a dressing-to-canvas import.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world-r3f", "test"]
  scope:
    testGlobs:
      - "packages/forest-world-r3f/src/kit-asset.test.ts"
      - "packages/forest-world-r3f/src/kit-mesh.test.ts"
      - "packages/forest-world-r3f/src/leaf-tint.test.ts"
      - "packages/forest-world-r3f/src/prop-lighting.test.ts"
      - "packages/forest-world-r3f/src/cover-dressing.test.ts"
      - "packages/forest-world-r3f/src/dressing-ground.test.ts"
      - "packages/forest-world-r3f/src/map-dressing.test.ts"
      - "packages/forest-world-r3f/src/island-path.test.ts"
    sourceGlobs:
      - "packages/forest-world-r3f/src/kit-asset.ts"
      - "packages/forest-world-r3f/src/kit-mesh.ts"
      - "packages/forest-world-r3f/src/leaf-tint.ts"
      - "packages/forest-world-r3f/src/prop-lighting.ts"
      - "packages/forest-world-r3f/src/cover-dressing.ts"
      - "packages/forest-world-r3f/src/dressing-ground.ts"
      - "packages/forest-world-r3f/src/map-dressing.ts"
      - "packages/forest-world-r3f/src/island-path.ts"
  coverage:
    testGlobs: ["packages/forest-world-r3f/src/island-path.test.ts"]
  real:
    testFile: "packages/forest-world-r3f/src/map-dressing.test.ts"
    sourceFile: "packages/forest-world-r3f/src/map-dressing.ts"
    editsExisting: true
    scope:
      testGlobs:
        - "packages/forest-world-r3f/src/map-dressing.test.ts"
        - "packages/forest-world-r3f/src/kit-mesh.test.ts"
      sourceGlobs:
        - "packages/forest-world-r3f/src/map-dressing.ts"
        - "packages/forest-world-r3f/src/kit-mesh.ts"
    proofCommand:
      file: bun
      args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "packages/forest-world-r3f/src/map-dressing.test.ts", "packages/forest-world-r3f/src/kit-mesh.test.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world-r3f", "typecheck"]
---

# The land dressing — what stands ON the land once the land itself reads right

**PROVENANCE — born of a split, carrying no proof.** This capability did not exist before
2026-09-12. On that day `forest-rendering-engine` (itself `r3f-world-spike` until earlier the same
day — ADR-0562) was split into four lanes on a measured import graph:
[`forest-scene-model`](forest-scene-model.md) →
[`forest-land-surface`](forest-land-surface.md) → `forest-land-dressing` (this one) →
[`forest-canvas-delivery`](forest-canvas-delivery.md). ⚠ **Nothing was inherited but the modules.**
ADR-0559 D5: *"no continuation transfers proof to newly split lanes."* The pre-split capability's
one signed verdict proved `world-to-3d.ts` and belongs to the scene-model lane's history. This lane
starts `proposed` with zero signed credit.

**Outcome —** The surfaced land is dressed: kit assets become kit meshes placed on the ground; leaf
tint and prop lighting sit them in the same light the ground is already wearing; ground cover and
map dressing populate the land between them; and the island path is laid across it — every
placement DERIVED from the scene model's cells, never from a hand-placed coordinate.

**Depends on —** [`forest-scene-model`](forest-scene-model.md) (the cells, footprint and vocabulary
every placement is derived from) and [`forest-land-surface`](forest-land-surface.md) (a prop that
is not lit like the ground it stands on reads as a sticker, so the dressing cannot be tuned against
an unlit ground). **Nothing upstream imports a dressing module**, in value or in type — the
one-way property that makes this lane claimable alongside the other two.

> **Proof status (honest) — PARTIALLY PROVEN as a capability.** The four signed shoreline contracts
> cover the shore-selection connector and the visible ribbon reaching its snapped shore, not all
> eight modules in this lane. The placement-attribution contract below is newly armed and has no
> inherited verdict. Read the current contract coverage and signing state through
> `storytree coverage forest-land-dressing` rather than this historical note.

## The lane — 8 modules

| group | modules |
|---|---|
| the props themselves | `kit-asset`, `kit-mesh` |
| making a prop belong to its ground | `leaf-tint`, `prop-lighting` |
| what fills the space between props | `cover-dressing`, `dressing-ground`, `map-dressing` |
| the way across the island | `island-path` |

**ONE OBJECT PER CAPABILITY (ADR-0475) is the vocabulary rule this lane serves**, and the taxonomy
that decides WHICH object is `kit-vocabulary`'s — which lives one lane up, in
[`forest-scene-model`](forest-scene-model.md). This lane builds and places what that vocabulary
names; it does not get to extend the vocabulary on its own. Extending it is a scene-model unit.

## Integration test

**Goal —** Prove that dressing is derived from the land rather than placed on top of it, and that a
dressed prop belongs to the ground it stands on.

1. Build a real scene, surface it, then dress it twice → assert the placement set is deep-equal.
   Placement is derived from the scene model's cells, so it must be as deterministic as they are; a
   dressing pass that varies run to run cannot be drift-gated and cannot be compared across an art
   change.
2. Assert every placed prop's footprint lies inside the island's true footprint and on a real cell —
   no prop hanging over the coast clip, none floating between cells. Feed a deliberately oblong
   island so a placement that silently assumes a square footprint is separable.
3. Assert a prop's delivered lighting tracks the ground's: change the light calibration the SURFACE
   lane owns and assert the prop's tint/lighting moves with it in the same direction. This is the
   leg that catches a prop lit by a constant — the "sticker" failure — and it is the reason this
   lane depends on the surface rather than only on the scene model.
4. Assert the island path is continuous across the cells it crosses, and that it reads onto the
   ground through the surface lane's wear rather than by overwriting the ground material.
5. Assert ground cover thins where the path and props already occupy the cell — dressing composes
   with itself and does not double-populate.

## Proof walkthrough

`map-dressing` already knows the owning island while it makes that island's placements. Expose that
fact as `dressMapWithCoverAttribution(descriptors, options)`, returning
`{ placements, islandByPlacement }`, where `islandByPlacement` is read-only and its keys are the
exact returned `KitPlacement` objects. Keep `dressMapWithCover` as the placements-only wrapper: its
array stays deep-equal in order, count, and transforms to this companion result's `placements`.
`KitPlacement` stays unchanged, and a placement made from cells with no island stays absent from the
attribution map.

The canvas must be able to carry that identity through the existing material/tint merge without
creating per-island draw buckets or rebuilding meshes per frame. Add the optional third argument to
`kitMeshes(kit, placements, onTransformedPart?)`: for every transformed cloned part, before it enters
its existing merge bucket, it calls `onTransformedPart(placement, geometry)`. The callback is owned
by the delivery consumer; it may look up the exact placement in `islandByPlacement` and stamp the
growth-slot and growth-anchor vertex attributes. `kit-mesh` imports neither map dressing nor canvas
delivery, and an omitted callback preserves the current merged geometry, material/tint buckets,
draw-call count, and kit-art hooks.

1. In the existing test, namespace-import the module and assert that the companion export is a
   function. That gives the real arm a mechanical assertion red against the current module instead
   of a missing named import that stops the test loader before an assertion can run.
2. Drive a two-island fixture containing capability trees, criterion flowers in bloom, bud, and wilt
   states, and healthy ground cover. Assert that every placement from an attributed island maps to
   exactly its producing island; no map key is a different placement object or an object outside the
   returned array; and all unattributed placements have no entry.
3. Compare the companion's placements with the existing wrapper in the same fixture. Counts, order,
   and every placement transform remain exactly equal. This is attribution only: it freezes the
   placement algorithms and art.
4. In the kit-mesh test, pass a callback over placements that share a material/tint bucket. Assert it
   receives each placement's already-transformed cloned part before merge, can stamp attributes that
   survive the merged mesh, and does not create a per-island bucket. With no callback, retain the
   current geometry, material/tint buckets, draw-call count, and kit geometry/material hooks. The
   declared proof command runs this regression together with the dressing test.

## Contracts (5)

The first four are assertions about `island-path.ts`, the canvas-side connector that decides where a
dependency trail comes ashore. They are this lane's first contracts — the lane was born of a split
carrying no proof at all. The placement-attribution contract is the current `real:` arm.

1. **`fld-a-routed-junction-is-never-a-dock`** — an end position two or more visible strips share is
   a junction, and a junction is never a landing
   - **asserts —** given visible `trail-strip` descriptors whose endpoints coincide (the shape a
     routed trunk makes where several edges funnel together in open water), `islandDocks` forms NO
     dock at that position however close it lies to a rim — including well inside `DOCK_REACH`. A
     terminal end at the same distance still docks, so the test separates the RULE from the
     distance rather than restating the reach.
   - **covers —** `packages/forest-world-r3f/src/island-path.ts`
2. **`fld-every-terminal-trail-end-docks-on-the-real-map`** — on storytree's own forest, every place
   the routed network actually stops is a landing
   - **asserts —** the committed real-forest export driven through the shipped 3D stream yields 103
     visible trail segments over 103 distinct end positions, of which 52 are terminal; every one of
     those 52 becomes a dock, no junction does, and all 35 islands carry at least one dock. It is
     the fence ADR-0596 D5 asks for: a later change that drops a segment, loses an edge key or
     re-loses a landing reds here instead of quietly redrawing the map.
   - **covers —** `packages/forest-world-r3f/src/island-path.ts`
3. **`fld-a-dock-lands-on-an-island-the-trail-names`** — proximity chooses among the islands a
   trail connects, never the set
   - **asserts —** when a visible `trail-strip` carries `edges`, its terminal end docks on the
     nearest rim among the islands those `from->to` keys name — even when a NEARER rim belongs to an
     island the keys do not name. A strip carrying no edge keys keeps the nearest-rim rule (the
     harness fixtures are in that class), and a named island beyond `DOCK_REACH` still forms no
     dock. On the real map this makes the 35-island assertion unconditional: no island a dependency
     trail terminates at is left without a dock.
   - **covers —** `packages/forest-world-r3f/src/island-path.ts`
4. **`fld-a-visible-trail-strip-ends-on-the-dock-it-wears`** — a rendered trail reaches the same
   shore as its worn path
   - **asserts —** `dockedTrailStrips(cells: readonly InstanceDescriptor[], strips: readonly
     InstanceDescriptor[]): readonly InstanceDescriptor[]` returns new descriptors only for visible
     terminal `trail-strip` ends that `islandDocks` accepts. For each accepted end it replaces only
     that endpoint with the exact snapped dock, retaining every original interior point and every
     semantic descriptor field (`kind`, `edges`, `segment`, `width`, `usage`, `hidden`, and the
     remaining descriptor data); the inputs remain unchanged and repeated calls are deep-equal.
     Hidden and ghost strips, shared junction ends, missing polylines, and ends beyond reach remain
     byte-for-byte as supplied. The test proves the adjusted visible endpoints equal the docks that
     `islandDocks` supplies and the shore endpoints used by `islandPaths`, rather than merely
     comparing counts. It exercises a named-island channel where the nearest unrelated rim must not
     win, a shared named junction that must not move, and the committed real-forest fixture: its
     103 visible strips and 52 terminal positions are conserved while every accepted terminal end
     visibly terminates at its corresponding dock.
   - **covers —** `packages/forest-world-r3f/src/island-path.ts`
5. **`fld-every-dressed-placement-keeps-its-island`** — a canvas can carry every island-made kit
   placement's identity through the existing merged mesh
   - **asserts —** `dressMapWithCoverAttribution` returns the existing ordered placement result and
     a sidecar map whose keys are those exact placement objects. In a two-island stream that yields
     capability trees, bloom/bud/wilt criterion flowers, and cover, every attributed placement maps
     to its producing island; no map key belongs to another result array; and an unattributed
     placement has no map entry. `dressMapWithCover` remains deep-equal in count, order, and
     transforms, so attribution cannot alter placement generation or art. The optional third
     `kitMeshes` callback then receives each placement with its transformed cloned part before the
     existing material/tint merge, allowing a delivery consumer to stamp growth-slot and
     growth-anchor attributes from that sidecar. The callback preserves batching, existing kit
     geometry/material hooks, and the no-callback result; it introduces neither per-island draw
     buckets nor per-frame rebuilding.
   - **covers —** `packages/forest-world-r3f/src/map-dressing.ts`,
     `packages/forest-world-r3f/src/kit-mesh.ts`

## Historical shoreline proof record

The four shoreline contracts above are completed history. This record preserves the acceptance
setup that proved them; it is not the current `real:` arm and must not be supplied to a new
placement-attribution build.

**THE SUBJECT IS A MEASURED DEFECT, NOT A MISSING FEATURE.** `islandDocks` already exists and
already works on the harness crowd fixture, whose synthetic strips end exactly on the clipped rim by
construction. Run against the REAL map it loses landings, and ADR-0596 is the measurement. Today's
rule is "any visible strip endpoint within `DOCK_REACH` of a rim is a dock". Two things are wrong
with it, both measured on the committed export:

- **`DOCK_REACH` is 5.09 ground units and the real terminal ends reach 9.56.** 40 of 52 dock; 12 are
  refused; 7 of 35 islands form no dock and wear no path. The constant is written as a multiple of
  the beach width and drifted down when the beach was rescaled by `LAND_SCALE` — ADR-0504 recorded
  it as 13.5.
- **No pure distance separates a landing from a junction.** The furthest terminal end is 9.56; the
  nearest junction is 7.60. Simply widening the reach to catch all 52 also admits phantom docks in
  open water, which ADR-0504 D2 forbids ("the connector invents no dock").

**THE FIX IS A RULE, NOT A NUMBER (ADR-0596 D1/D2).** Only a TERMINAL end — a position exactly one
visible strip uses — may dock; a position two or more share is a routed junction and is excluded at
any distance. Coincidence is judged at the same tenth-of-a-unit quantisation `vertexKey` already
uses to deduplicate docks, so one rule of coincidence serves both. With the discriminator out of the
distance test, the reach widens to 4x the shipped beach width and becomes a sanity bound.

**THE ACCEPTANCE SETUP, and the doubles it rules out.**

- Contract 1 is a UNIT setup and must stay one: hand-built `trail-strip` descriptors over a small
  synthetic rim, with two strips deliberately sharing an endpoint placed WELL INSIDE the reach, and
  a third terminal end at a comparable distance that must still dock. A test that only places the
  shared endpoint outside the reach proves nothing — it would pass against today's code.
- Contract 2 must read the REAL committed export and nothing else:
  `docs/research/chapter2-real-forest-2026-09-08/scenes/shipped.json` (repo-relative; from the
  package the path is `../../docs/research/...`). Drive it through the SHIPPED stream —
  `landStreamFromDrawing` from `./true-ground.js` — then `clipToCoast(…, SHIPPED_COAST)` over the
  descriptors `coastalIsland` accepts, exactly as `dressing-ground.ts` does. **The clipped
  descriptors are mandatory**: after the clip the boundary of the mesh IS the coast, and handed the
  pre-clip parcels every dock lands a beach's width inland of the sea. A synthetic or fixture map is
  explicitly ruled out for this contract — the whole point is that the crowd fixture could not have
  caught this.
- Both contracts run under `bun test` over this one file (the `real:` arm's declared
  `proofCommand`), and the file's existing 23 tests must stay green: several of them assert
  `DOCK_REACH`'s own value and its derivation, so widening it means updating those assertions in the
  same test file rather than leaving them red.

**UNIT 2 — CONTRACT 3, AND IT IS THE DEFECT CONTRACT 2's FENCE THEN CAUGHT (ADR-0597).** Unit 1
landed and its real-map assertion failed by exactly one island. `uat-detail-studio` is reached by 18
routed segments; exactly one of them TERMINATES there rather than at a junction, and that landing
sits **5.29 ground units** from `uat-detail-studio`'s own clipped rim and **4.43** from
`studio-cloud`'s. Both are inside the reach, so the nearest-island rule inside `islandDocks` awards
the dock to `studio-cloud` — an island neither of the segment's edge keys
(`uat-criterion-detail->uat-detail-studio`, `studio->uat-detail-studio`) mentions. The consequence is
not a missing path but a FALSE one: `studio-cloud` wears a worn path asserting a dependency it does
not have, in the same visual vocabulary the true ones use.

- **The identity is already on the descriptor.** Every `trail-strip` carries `edges`, the `from->to`
  keys of the routed `depends_on` edges through that segment. Measured on the export: 35 distinct
  edge-key endpoints, and all 35 are island ids, none unresolved. Restrict each terminal end's
  candidate rims to the islands its own keys name, and let proximity choose among THOSE.
- **The change must stay surgical, and that is checkable.** Re-run across the export: 51 of the 52
  terminal ends dock exactly where they already do, exactly 1 moves, 0 fail to dock, and all 35
  islands gain a dock. A rule change that rewrote the map would be a different proposal.
- **The two fallbacks are deliberate, and both must be asserted rather than assumed.** A strip with
  no edge keys keeps the nearest-rim rule — the harness crowd fixtures build exactly that shape, and
  a synthetic landing whose island nobody stated is still a landing. And a NAMED island beyond
  `DOCK_REACH` still forms no dock: this narrows the candidate set and never relaxes the bound.
- **Order matters and is one-directional.** The junction exclusion runs FIRST. A shared end is not a
  landing whatever its edge keys say, so naming an island can never rescue a junction into a dock.
- **The existing real-map test currently PINS the shortfall** as `['uat-detail-studio']`. Closing
  contract 3 makes that list empty, so the pin is updated in the same test file — the fence becoming
  unconditional is part of the deliverable, not a separate tidy-up.

**UNIT 3 — CONTRACT 4: THE VISIBLE RIBBON AND THE WORN PATH SHARE ONE SHORE.** The mounted canvas
currently gives `TrailStrip` the original routed descriptors while `islandDocks` snaps only the
ground wear to the coast. That leaves a sea ribbon visibly ending offshore beside the path it is
meant to continue. The new helper is a pure dressing-side projection over the current
`InstanceDescriptor` stream — `MeshDescriptor` is not a type in this package and must not be
invented at the caller boundary. It derives each accepted replacement from the same `islandDocks`
result the wear consumes; it does not re-run nearest-rim, named-island, terminal, or reach logic.
The later canvas supplement passes this returned strip list to `TrailStrip`; it owns that one-line
consumer wiring and no new routing rule.

## Guidance

**WHY THIS IS A CAPABILITY AND NOT PART OF THE SURFACE.** The surface answers *what is the land
made of*; the dressing answers *what stands on it*. They share a precondition (a surfaced ground)
but not an observable: a surface defect shows up in a composited ground sample, a dressing defect
shows up in a placement set. The measured graph agrees — dressing imports the surface and the
surface never imports dressing, in either edge kind. Two disjoint sessions can therefore hold the
two claims at once, which is the entire point of the split.

**THE LANE FENCE, in both directions.**

- **Never import downstream.** A dressing module may import from `forest-scene-model` and
  `forest-land-surface`. It may NOT import from `forest-canvas-delivery` — including an
  `import type`, because a type-only cycle pins two modules into one lane at compile time exactly
  as firmly as a value cycle does.
- **Never reach up to add what you need.** If a dressing change wants a new constant in
  `kit-vocabulary` or a new light knob in `light-calibration`, land that upstream as its own unit
  and consume it here. Editing an upstream module from this lane is how the boundary quietly dies,
  and it is what the ownership fence in `repo-manifest/source-ownership/` exists to make visible.
- **Prop art is retunable here; prop TAXONOMY is not.** Adding a new kind of object to the
  vocabulary is a scene-model change (ADR-0475's one-object-per-capability rule is a vocabulary
  rule).

**THE LOOK IS NOT THIS SUITE'S TO JUDGE.** Whether the dressed island is beautiful, or whether a
prop reads as the thing it is meant to be, is a taste judgment with no compiler — it is the owner's,
taken on the live site or a staged comparison page, and an agent never self-signs it (ADR-0070).
What this suite proves is everything mechanical underneath that: derivation, containment, lighting
agreement, continuity, and composition.
