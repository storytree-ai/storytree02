---
id: "coverage-flora-native-placement"
tier: capability
story: website-experience
title: "Coverage flora becomes native, attributable kit placement"
outcome: "Every typed coverage-flora descriptor becomes exactly one grounded native KitPlacement with its own capability, island, theme, folded status and source-scale; that one placement list reaches the merged kit mesh and the ground caster, with an explicit foliage-material route and content-correct cache invalidation."
status: proposed
proof_mode: integration-test
depends_on: [forest-scene-model, forest-land-dressing, forest-canvas-delivery]
decisions: [562, 608]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world-r3f", "test"]
  scope:
    testGlobs:
      - "packages/forest-world-r3f/src/kit-vocabulary.test.ts"
      - "packages/forest-world-r3f/src/map-dressing.test.ts"
      - "packages/forest-world-r3f/src/kit-mesh.test.ts"
      - "packages/forest-world-r3f/src/ground-casters.test.ts"
      - "packages/forest-world-r3f/src/ground-dependency.test.ts"
      - "packages/forest-world-r3f/src/forest-ground-is-one-mesh.test.ts"
    sourceGlobs:
      - "packages/forest-world-r3f/src/kit-vocabulary.ts"
      - "packages/forest-world-r3f/src/map-dressing.ts"
      - "packages/forest-world-r3f/src/kit-mesh.ts"
      - "packages/forest-world-r3f/src/ground-casters.ts"
      - "packages/forest-world-r3f/src/ground-dependency.ts"
  real:
    editsExisting: true
    testFile: "packages/forest-world-r3f/src/map-dressing.test.ts"
    sourceFile: "packages/forest-world-r3f/src/map-dressing.ts"
    scope:
      testGlobs:
        - "packages/forest-world-r3f/src/kit-vocabulary.test.ts"
        - "packages/forest-world-r3f/src/map-dressing.test.ts"
        - "packages/forest-world-r3f/src/kit-mesh.test.ts"
        - "packages/forest-world-r3f/src/ground-casters.test.ts"
        - "packages/forest-world-r3f/src/ground-dependency.test.ts"
        - "packages/forest-world-r3f/src/forest-ground-is-one-mesh.test.ts"
      sourceGlobs:
        - "packages/forest-world-r3f/src/kit-vocabulary.ts"
        - "packages/forest-world-r3f/src/map-dressing.ts"
        - "packages/forest-world-r3f/src/kit-mesh.ts"
        - "packages/forest-world-r3f/src/ground-casters.ts"
        - "packages/forest-world-r3f/src/ground-dependency.ts"
    proofCommand:
      file: bun
      args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "packages/forest-world-r3f/src/kit-vocabulary.test.ts", "packages/forest-world-r3f/src/map-dressing.test.ts", "packages/forest-world-r3f/src/kit-mesh.test.ts", "packages/forest-world-r3f/src/ground-casters.test.ts", "packages/forest-world-r3f/src/ground-dependency.test.ts", "packages/forest-world-r3f/src/forest-ground-is-one-mesh.test.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world-r3f", "typecheck"]
---

# Coverage flora becomes native, attributable kit placement

**Outcome —** The mapper already transports each core `parcel-flora` wrapper as a `coverage-flora`
descriptor. This capability consumes those descriptors once, into the same `KitPlacement` stream
that the canvas already gives to both `kitMeshes` and `placementCasters`. Each resulting native
plant keeps its capability, island, theme, folded status, exact ground anchor and proportional
source scale. It is grounded with `landHeight` and joins existing material batching. It does not
retire any SVG, change the app clock, add a second canvas/placement path, or claim that a machine
test has approved the picture.

**Why this is a bridge —** ADR-0562 deliberately puts `kit-vocabulary.ts` in
`forest-scene-model`, placement and mesh construction in `forest-land-dressing`, and
`ground-dependency.ts` in `forest-canvas-delivery`. Those ownership boundaries remain unchanged.
This capability owns one forward proof over the existing seams; it must claim all three existing
capabilities while editing their files. It creates no competing source-ownership manifest and no
reverse import.

## Proof walkthrough

1. Start with the existing mapper's real, multi-island descriptor stream. It contains ordinary
   cells/kit vocabulary plus `coverage-flora` descriptors varying `capability`, `island`,
   `material` (folded status), `theme`, anchor and `floraScale`. First make the dressing test red:
   those descriptors currently become no `KitPlacement`.
2. Extend the vocabulary atomically with scene role `coverageFlora`. Keep the existing broad
   `scene` / `dressing` class, add `isCoverageRole` for `map-dressing`'s production selector, and
   add `isCapabilityTreeRole` for the one existing reader that actually means a capability tree:
   `map-dressing.test.ts`'s per-capability census. Its old `!isCriterionRole` would count coverage
   as a tree. The `!isDressingRole` readers deliberately remain: they ask for every scene object,
   so coverage belongs in their answer. `ground-casters` also remains table-driven: coverage is a
   scene role and therefore casts/pools through the established path. Extend every exhaustive
   table and typed fixture: roles, class, signal, assemblies, size, tilt, footprints, heights,
   silhouette, loaded-kit measurements and the one-mesh ground fixture. `coverageFlora` is scene
   coverage, never a tree, criterion marker, or decorative carpet.
3. In `map-dressing`, add coverage descriptors to the single returned placement stream, preserving
   descriptor traversal order among coverage plants. A descriptor yields one placement with
   `capId = capability`, its island retained by the existing attribution sidecar, `at` equal to
   descriptor `x/z`, `y = landHeight(x,z,relief)`, and status/theme carried into the native
   placement material selection. Do not scatter, reseed, parse SVG transforms, or create a
   `CoverageFloraPlacement` type. Unknown/unusable theme/status input fails visibly at the typed
   seam rather than becoming a guessed plant.
4. Use the two already-shipped `Leafy_Plant_01`/`Leafy_Plant_02` assemblies. The vocabulary owns a
   total theme-to-assembly policy; it is deterministic and has no asset re-export prerequisite.
   The same meshes already serve decorative bushes, so ADR-0507 D5 needs a size fence rather than
   a role name. The full decorative ladder can deliver
   `1.05 × 1.317 × 4.5 = 6.222825` ground units. Set the initial, deliberately chosen native
   signal target to `COVERAGE_FLORA_WIDTH = 8`. At the serialized shipped source baseline it is
   above the full decorative range, without changing that ladder or the payload. The role scale is
   `floraScale / 0.4`, where `0.4` is the serialized shipped-source baseline, never the raw
   `SHIPPED_TILE_ART.flora` number. Thus source-scale rungs survive without asserting SVG-form or
   footprint equivalence. The target is a staging input, not an appearance verdict.
5. Give `Leafy_Plant` foliage a named theme × folded-status representative route, transcribed
   from the mark each existing surface actually emits for that state in
   `apps/studio/src/index.css` and `scene.ts`. Most entries are the existing
   `.parcel-shrub.v-0` light face; meadow mapped/proposed/unknown use their emitted blade light
   face, and woodland unhealthy uses its emitted twig stem. The route is total over the core's
   themes and folded statuses; default CSS rules are transcribed as defaults, not replaced with
   invented variants. It returns its resolved existing token, so pairs that intentionally share a
   token share the same material clone and merge bucket. `kit-mesh` measures the leafy foliage
   map's own mean, then uses the existing `leafTintGain` arithmetic unchanged to apply that token.
   Reusing the pine-branch route is insufficient because it does not reach the actual leafy-plant
   material.
6. The resulting single list feeds `kitMeshes` and `placementCasters`. The coverage role has its
   declared silhouette and casts through that existing path; it does not get a second pass or a
   renderer-owned clock. `ground-dependency` must invalidate and rebuild whenever any consumed
   coverage descriptor field changes: kind, transform, group, capability, island, material,
   theme or floraScale. Its digest and structural equality must agree on those fields.

### The coverage foliage route

The new table transcribes a representative existing flora mark for each state. It uses the Studio's
shrub light face (`parcel-shrub.v-0`) except where that mark is not emitted: meadow
mapped/proposed/unknown use the emitted blade light face (`parcel-blade.v-0`), and woodland
unhealthy uses the emitted twig (`parcel-stem.v-0`). It belongs beside the kit vocabulary, not in
CSS or a new colour system. A missing CSS override uses that theme's default exactly as the browser
does.

| theme | healthy | mapped | proposed | building | unhealthy | unknown |
|---|---|---|---|---|---|---|
| meadow | `#89b56b` | `#9fa88f` | `#9fa88f` | `#eccb6d` | `#a08355` | `#b0afa2` |
| woodland | `#89b56b` | `#8fa091` | `#bfab5c` | `#c7ac4e` | `#7c5b40` | `#b1b0a7` |
| heath | `#89b56b` | `#b3b7a8` | `#d5cc9c` | `#f2bb4e` | `#a08c62` | `#b6b3a6` |

In particular, healthy meadow, woodland and heath deliberately share `#89b56b`; the proof must
not manufacture separate hues or clones merely to make their themes differ. The test asserts all
18 table entries and both equal-token sharing and unequal-token separation.

### The D5 same-form baseline fence

`Leafy_Plant_01` and `Leafy_Plant_02` are deliberately reused from the shipped payload: they are
also the decorative `bush` assemblies. Naming coverage as a scene role does not make that shared
form readable. The proof derives the maximum decorative draw from the existing tables, over every
`COVER_SIZE_RUNGS` value, rather than looking only at the default dressing draw:

```
widest decorative leafy plant = KIT_ROLE_SIZE.bush.units × COVER_SCALE.bush.max × max(COVER_SIZE_RUNGS)
                               = 1.05 × 1.317 × 4.5
                               = 6.222825
coverage signal target at serialized sourceScale 0.4 = 8
                                                     > 6.222825
```

This numeric non-overlap is only a shipped-baseline engineering check. Source flora scale remains
proportional, and arbitrary caller art scales are neither a second native size policy nor proved by
this comparison. It neither enlarges the decorative cover nor claims that the target settles the
mounted composition; real-corpus staging gives the owner the D5 appearance verdict.

## Contracts (4)

1. **`cfn-every-coverage-descriptor-becomes-one-grounded-native-placement`** — a real mapper
   stream becomes one native placement per coverage descriptor
   - **asserts —** a multi-island stream with repeated capabilities, themes, statuses, anchors and
     scales yields exactly one `coverageFlora` placement per `coverage-flora` descriptor, in
     source order. Every placement retains descriptor capability and island attribution, uses the
     exact `x/z`, has `y` from the supplied relief, and has scale `floraScale / 0.4`. Ordinary kit
     placements keep their order and values. No source transform is parsed and no second placement
     collection exists.
   - **covers —** `map-dressing.ts`, `kit-vocabulary.ts`
2. **`cfn-coverage-is-an-explicit-scene-class-not-a-capability-tree-or-cover`** — the role tables
   classify one new meaning without changing the old ones
   - **asserts —** every exhaustive vocabulary table has exactly one `coverageFlora` entry; it is
   scene coverage, is neither capability-tree nor criterion nor dressing, and all existing roles
   retain their former classification. `map-dressing.test.ts`'s capability census uses the
   capability-tree predicate; the existing scene/cover predicates remain correct for their own
   broader questions. The declared plant assemblies, 8-unit staging target,
   tilt, footprint, height and silhouette are total and the loaded kit supplies the named objects.
   At serialized sourceScale `0.4`, the target exceeds the largest same-form leafy bush across
   every decorative cover-size rung; a changed cover scale, cover rung or coverage target fails
   that baseline table proof. It does not claim arbitrary caller scales or owner-readable appearance.
   - **covers —** `kit-vocabulary.ts`, `kit-vocabulary.test.ts`, `map-dressing.test.ts`,
     `ground-casters.test.ts`, `forest-ground-is-one-mesh.test.ts`
3. **`cfn-coverage-foliage-carries-theme-and-status-without-unbatching`** — native foliage gets a
   complete, bounded material key
   - **asserts —** every theme × status route resolves to the Studio-transcribed token; equal
     tokens reuse one foliage clone, while unequal tokens reach distinct declared routes. The
     leafy foliage map mean reaches the existing token arithmetic, and merge count stays one per
     actual `(material, resolved-token)` bucket rather than one per plant. The no-coverage and
     ordinary-pine material results stay unchanged.
   - **covers —** `kit-mesh.ts`, `kit-mesh.test.ts`, `kit-vocabulary.ts`
4. **`cfn-coverage-semantic-changes-rebuild-the-shared-ground-input`** — cache equality matches
   what the native placement consumer reads
   - **asserts —** changing each of capability, island, material/status, theme, floraScale,
     transform, group or kind on an otherwise equal coverage descriptor creates a new ground input
     and changed/appropriately re-attributed placements/casters. An unchanged deep-equal stream
     returns the same cached input. Existing wisp and skipped exclusions still do not rebuild it.
   - **covers —** `ground-dependency.ts`, `ground-dependency.test.ts`, `map-dressing.ts`,
     `ground-casters.ts`

## Boundaries and later work

This is one coherent red→green unit because the observable is one list entering both mesh and
caster consumers; splitting vocabulary, mesh, and cache would prove lists that merely agree today.
`cover-dressing.ts` and its tests need no edit: their exact `DRESSING_ROLES` subject does not gain
coverage. Harness comparison pages consume `dressMapWithCover`; they are not in this leaf scope,
but a full package gate must update any changed expected count or material-bucket census against
the new native placements rather than preserve a stale baseline. The only extension to the existing
cover tables is the vocabulary proof that derives the D5 separation; it does not modify the cover's
roles, size ladder, scatter or payload.
It deliberately stops before the separate observable of the final mounted picture. The existing
`coverage-plants-sit-on-the-ground-and-clear-the-trees` arc row remains the home for real-corpus
preview, measured visual/clearance follow-through, native-prop hit overlay, and the owner's
appearance attestation. Deferred collision/floating concerns remain engineering residue there;
they do not remove the requirement that native plants exist before the one-step retirement.

The next consumer may enable the existing `drawProps` preview only to stage real corpus evidence.
It must use the host's app-owned wall clock and existing demand/hidden/quiet lifecycle untouched.
No contract here says that a native plant count proves option-A emphasis, or that the SVG forest
picture may be removed.
