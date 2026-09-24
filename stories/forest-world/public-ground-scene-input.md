---
id: "public-ground-scene-input"
tier: capability
story: forest-world
arc: mount-the-land-on-a-real-surface-arc
title: "Public ground scene input — published forest facts become one plan-view core scene"
outcome: "A public adapter can pass already-laid-out, already-folded published forest facts to one pure core composer and receive a deterministic plan-view SceneInput whose terrain, coasts, anchors, parcels and trails share one ground basis."
status: proposed
proof_mode: integration-test
depends_on: [render-core]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world", "test"]
  scope:
    testGlobs: ["packages/forest-world/src/public-ground-scene-input.test.ts"]
    sourceGlobs: ["packages/forest-world/src/public-ground-scene-input.ts"]
  coverage:
    testGlobs: ["packages/forest-world/src/public-ground-scene-input.test.ts"]
  real:
    editsExisting: false
    testFile: "packages/forest-world/src/public-ground-scene-input.test.ts"
    sourceFile: "packages/forest-world/src/public-ground-scene-input.ts"
    scope:
      testGlobs: ["packages/forest-world/src/public-ground-scene-input.test.ts"]
      sourceGlobs: ["packages/forest-world/src/public-ground-scene-input.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world", "typecheck"]
    proofCommand:
      file: bun
      args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "packages/forest-world/src/public-ground-scene-input.test.ts"]
---

# Public ground scene input — published forest facts become one plan-view core scene

**Outcome —** A public adapter can pass already-laid-out, already-folded published forest facts to
one pure core composer and receive a deterministic plan-view `SceneInput` whose terrain, coasts,
anchors, parcels and trails share one ground basis.

## Boundary

The new `packages/forest-world/src/public-ground-scene-input.ts` accepts the public adapter's
already-decided frame, island centres, rings, ground anchors, folded statuses, published
dependencies, optional coverage counts and published UAT state. It composes the geometry and semantic
fields that the existing `buildScene` consumes. It does not pack islands, choose a frame, fold a
status, fetch a snapshot, read a store, import Studio/web/DOM/Three code, add a clock or wisp, or
mount a browser surface.

Its structural input is deliberately the public adapter's existing layout result, rather than a
second layout request. The outer spec supplies `offset`, `width` and `height`. Each supplied island
has its public story `id`, folded `status` and `dependsOn`; its existing `placeStories`/`frameFor`
result: ground `centre`, integer `rings`, `groundRadius`, `treeSpot`, `labelY`, `plate` and
`treeTitle`; its in-order capabilities (`id`, folded `status`, published `dependsOn`, optional
`testCount`); and optional UAT legs (`state` plus a local `presentationKey`). The adapter makes that
key from the published story id and authored snapshot ordinal. It is enough for a scene marker's
deterministic placement/dedupe and carries no authored-criterion claim.

The valid-input boundary is the existing public layout's: a finite, already-laid-out frame; unique
published story and capability ids; each island's centre/tree spot/label baseline expressed in that
same plan ground basis; a non-negative integer ring count and positive finite ground radius; and dependencies limited to the published
snapshot facts. The composer does not repair an invalid layout or discover missing public facts.

Its output is one `SceneInput` that preserves that frame and, per supplied island, preserves the
centre, ground radius, tree spot, label baseline, plate and title. It declares
`cameraElevationDeg: PLAN_VIEW_ELEVATION_DEG`, `anchorSpace: 'ground'` and `screenRadius` equal to
the supplied ground radius. It supplies relaxed cells and coast loops in that basis, with empty
`drawTiles`, `wheatSets`, `empties`, `decor`, `plants` and `wisps`; it adds no garden, vegetation,
claims, departures or baked art. That absence preserves a published snapshot's actual bounds: no
private data, live activity or substitute flat picture enters through this helper.

The result is plan view (`PLAN_VIEW_ELEVATION_DEG`): relaxed mesh, coast, anchors, parcels and trails
all use one ground coordinate system. It uses or extends the core's canonical geometry and routing
surface; it does not recreate the website's `forest-snapshot-map.ts` / `act2-walkthrough.ts` layout
logic. The exact allocation and helper sequence are implementation choices. The observable boundary
is one coherent plan-view `SceneInput`, not a mirror test of those helpers.

Every supplied capability remains an attributed parcel. A small public island may begin with fewer
coarse cells than capabilities; the existing mesh subdivision option may create sufficient internal
cells without changing the supplied island footprint, anchors or layout. The result must give every
capability its own ground identity and folded status on its island, never silently drop, merge or
move a capability to another island.

`testCount: undefined` remains unreported coverage; it does not become zero. Explicit zero and
positive counts retain the render core's existing numeric surface behaviour. Public UAT state becomes
one marker per published leg. Its scene key is local (`story id` plus snapshot ordinal) for
deterministic placement and descriptor dedupe only: it is neither the authored opaque `uatc_` id nor
an evidence, attestation or interaction identity. No public schema or allow-list change belongs here.

The canonical edge set is `storyEdges` over published facts. Unknown story references and capability
references with no published owner are filtered before routing and are never guessed by a second
derivation. `routeTrails.dropped` continues to report only failures to route an otherwise canonical
edge.

## Proof walkthrough

The new test starts red because the composer module is absent. It creates only literal public-facing
facts and calls the real composer and real `buildScene`.

1. A three-island fixture with different centres, rings, dependencies and folded statuses composes
   byte-identically twice. Its mesh cells, coast loops, tree anchors, parcel seeds and trails share
   plan-view ground coordinates; each territory declares ground anchors and the input camera is 90°.
2. The fixture includes several capabilities per island. Every capability arrives in original order
   as a parcel carrying its exact id and folded status. A capacity case has more capabilities than
   its coarse cells: the composed mesh still gives every cap a non-empty attributed parcel ground on
   that island, with no drop or merge.
3. One real `buildScene(composePublicGroundScene(...))` control distinguishes all three count
   states. Explicit `0` retains baseline `parcel-flora`; a positive count retains normal coverage;
   omitted count stays omitted, has status-carrying parcel ground, and emits no `parcel-flora`.
4. Published UAT legs with proven, pending and failing state become one state-matched marker each.
   Their scene-local keys are deterministic within the same snapshot and do not require or resemble
   an authored `uatc_` value. An island with no legs has no marker field or markers.
5. Trails represent exactly the canonical published dependencies. Unknown story references and
   unowned capability dependencies produce no fabricated connection; a deliberately unrouteable
   canonical edge is visible through the existing routing drop signal.

The proof is pure and machine-observable. It does not mount a website or Studio host, stage a
picture, prove browser interaction, change the app-owned presentation clock, or assert retirement of
the flat forest picture.

## Contracts (5)

1. **`public-ground-scene-is-coherent-and-deterministic`** — published layout facts compose into one repeatable plan-view core scene.
   - **asserts —** the same multi-island structural input returns byte-identical `SceneInput`; mesh,
     coast, anchors, parcel seeds and trails are expressed in one plan-view ground basis, territories
     declare `anchorSpace: 'ground'`, and the scene requests the plan-view camera.
   - **covers —** `packages/forest-world/src/public-ground-scene-input.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-scene-input.test.ts`.
2. **`public-ground-scene-preserves-published-capability-ground`** — each published capability retains separate, attributed ground.
   - **asserts —** each input capability yields one in-order parcel with the exact `capId` and folded
     status, wholly on its owning island. When capability count exceeds coarse-cell count, every cap
     still owns non-empty parcel ground; none is silently omitted, merged or assigned across islands.
   - **covers —** `packages/forest-world/src/public-ground-scene-input.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-scene-input.test.ts`.
3. **`public-ground-scene-keeps-public-coverage-truth`** — explicit zero, positive and unreported coverage remain distinct in a real scene.
   - **asserts —** the composer preserves explicit zero and positive counts, preserves omission, and
     real `buildScene` keeps parcel ground while suppressing `parcel-flora` only for omission.
   - **covers —** `packages/forest-world/src/public-ground-scene-input.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-scene-input.test.ts`.
4. **`public-ground-scene-preserves-public-uat-state`** — public UAT state yields deterministic local scene markers without exporting authored proof identity.
   - **asserts —** each published UAT leg yields one marker of its supplied state with a deterministic
     snapshot-local key, no legs yield none, and the helper neither requires nor manufactures an
     authored opaque criterion identity.
   - **covers —** `packages/forest-world/src/public-ground-scene-input.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-scene-input.test.ts`.
5. **`public-ground-scene-routes-only-canonical-public-edges`** — public roads use the shared edge and routing rules.
   - **asserts —** the helper routes only canonical `storyEdges`; it filters unknown story and
     unowned-capability references before routing, never fabricates a route, and preserves the
     router's drop signal for a canonical edge that cannot route.
   - **covers —** `packages/forest-world/src/public-ground-scene-input.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-scene-input.test.ts`.

The asserted module and test are the two-file real fence. A separately scoped unasserted barrel
export may join the same green unit after its proof is signed. The later website adapter, real browser
mount and cross-package mapper proof are downstream consumers and do not widen this capability.
