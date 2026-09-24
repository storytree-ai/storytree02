---
id: "public-ground-projection"
tier: capability
story: forest-world
arc: mount-the-land-on-a-real-surface-arc
title: "Public ground projection — one immutable public plan becomes one coherent 50° scene"
outcome: "The public forest can project the immutable plan SceneInput from public-ground-scene-input into one deterministic 50° SceneInput whose frame, terrain, routes and tagged anchors agree, ready for one buildScene call shared by SVG and a later native reader."
status: proposed
proof_mode: integration-test
depends_on: [public-ground-scene-input]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world", "test"]
  scope:
    testGlobs: ["packages/forest-world/src/public-ground-projection.test.ts"]
    sourceGlobs: ["packages/forest-world/src/public-ground-projection.ts"]
  coverage:
    testGlobs: ["packages/forest-world/src/public-ground-projection.test.ts"]
  real:
    editsExisting: false
    testFile: "packages/forest-world/src/public-ground-projection.test.ts"
    sourceFile: "packages/forest-world/src/public-ground-projection.ts"
    scope:
      testGlobs: ["packages/forest-world/src/public-ground-projection.test.ts"]
      sourceGlobs: ["packages/forest-world/src/public-ground-projection.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world", "typecheck"]
    proofCommand:
      file: bun
      args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "packages/forest-world/src/public-ground-projection.test.ts"]
---

# Public ground projection — one immutable public plan becomes one coherent 50° scene

**Outcome —** The public forest can project the immutable plan `SceneInput` from
`public-ground-scene-input` into one deterministic 50° `SceneInput` whose frame, terrain, routes and
tagged anchors agree, ready for one `buildScene` call shared by SVG and a later native reader.

## Boundary

`packages/forest-world/src/public-ground-projection.ts` accepts only the plan SceneInput produced by
`composePublicGroundScene`: its 90° camera, ground-tagged public island anchors, relaxed cells,
ground coast loops, camera-agnostic trails, and supplied plan `offset`, `width`, and `height`. It
returns a fresh SceneInput at `LAND_CAMERA_ELEVATION_DEG`. The plan object remains an immutable input;
the helper is deterministic when given that same plan and does not promise to accept or idempotently
re-project an already-projected scene.

The helper projects each relaxed-cell polygon and the world offset through the canonical
`projectGround`. Its frame is the supplied plan frame rectangle under that same projection: `width`
is retained, `height` is multiplied by `groundFlattening(LAND_CAMERA_ELEVATION_DEG)`, and `offset` is
projected. It does not repack the islands, derive a new pixel bounding box, round a new viewBox, or
choose a host fit. `width` and `height` remain the actual SVG frame/viewBox and background payload
that the public host consumes; `buildScene` itself applies only the scene offset.

Island identity, folded status, parcel facts, omitted-versus-numeric coverage truth, published UAT
presentation keys, ground radii, plate dimensions and title art remain intact. `screenRadius` becomes
`groundRadius * groundFlattening(LAND_CAMERA_ELEVATION_DEG)`. Upright plate width/height/corners and
title art sizing stay upright. Ground `labelY`, tree spots, plant/decor anchors and parcel seeds stay
tagged ground anchors (`anchorSpace: 'ground'`), so `buildScene` is their one normalisation boundary.

Coast loops remain ground loops because `buildScene` projects coasts once. The helper uses the
existing `projectTrailNetwork` over the islands' ground centres for trails, retaining route edges,
dropped-route reporting, usage and identity while regenerating projected paths and cave bearings. It
does not introduce a second layout, route derivation, camera, clock, picker, resizer or native/SVG
comparison.

The downstream consumer calls `buildScene(projectPublicGroundScene(plan))` once, retains that one
`SceneG` for SVG, and later passes the same drawing to `landStreamFromDrawing`. Native sizing,
registration, a browser mount, host framing and removal of the flat picture are separate work; this
core capability imports no R3F, Studio, website, DOM or Three surface.

## Proof walkthrough

The test starts red because the projector module is absent. It creates real multi-island public facts,
calls `composePublicGroundScene`, then calls the real projector and `buildScene` without a DOM or
Three.

1. The plan stays 90° and byte-for-byte unchanged across repeated projection. The projected scene is
   deterministic at 50°, with a non-zero offset and plan frame transformed as the ground rectangle.
2. Relaxed cells, `screenRadius`, offset and ground-tagged anchors agree with direct ground projection.
   Coast loops remain ground for `buildScene`'s one coast projection; upright plate/title dimensions
   remain literal. The fixture includes parcel/coverage/UAT facts to show they survive unchanged.
3. A real routed multi-island trail network includes a cave-bearing case. The projected trail path and
   cave bearing agree with the canonical route projection while its edges, dropped report and usage
   survive.
4. One real `buildScene(projected)` produces drawables whose anchors, substrate and trails agree with
   direct projection of the original plan facts. The test does not create a second projected scene,
   replay sizing, mount a host, or compare a separately-built native scene.

## Contracts (4)

1. **`public-ground-projection-preserves-the-immutable-plan`** — repeated projection makes a fresh,
   deterministic 50° scene without changing its 90° public plan source.
   - **asserts —** real `composePublicGroundScene` output remains byte-identical at 90° after repeated
     projection; each fresh result declares the canonical land elevation and is byte-identical for the
     same plan input.
   - **covers —** `packages/forest-world/src/public-ground-projection.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-projection.test.ts`.
2. **`public-ground-projection-keeps-one-projected-frame-and-ground-basis`** — the public plan frame,
   terrain and tagged anchors share the same 50° coordinate basis.
   - **asserts —** cells and offset use `projectGround`; width is retained and height is flattened from
     the supplied plan rectangle; `screenRadius` follows ground radius flattening; coast loops stay
     ground; and ground-tagged anchors, seeds and label baselines remain for `buildScene` to project
     once while upright plate/title dimensions remain literal.
   - **covers —** `packages/forest-world/src/public-ground-projection.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-projection.test.ts`.
3. **`public-ground-projection-reprojects-the-canonical-route-network`** — public routes gain one
   coherent 50° path without changing their route facts.
   - **asserts —** canonical trail projection regenerates path geometry and cave bearings from the
     ground island centres while preserving edge ids, dropped-route reporting and usage.
   - **covers —** `packages/forest-world/src/public-ground-projection.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-projection.test.ts`.
4. **`public-ground-projection-builds-one-coherent-drawing`** — a real scene fold agrees with the
   projected public plan facts.
   - **asserts —** one `buildScene(projectPublicGroundScene(plan))` yields SVG-space anchors,
     substrate and trails that agree with direct projection, while retaining public identity, status,
     parcel, coverage and UAT presentation facts; it invokes no host, R3F or separate native scene.
   - **covers —** `packages/forest-world/src/public-ground-projection.ts`.
   - **proven by —** `packages/forest-world/src/public-ground-projection.test.ts`.

The asserted implementation and test are the exact two-file real fence. A barrel export, if needed,
is separately scoped unasserted glue after the proof is signed. The later public host consumes the one
resulting `SceneG`; it owns viewBox registration and native presentation rather than widening this
projector.
