---
id: "native-host-status-presentation"
tier: capability
story: website-experience
title: "Native host-status presentation — filtered semantic props remain present and visibly dim"
outcome: "The host legend's existing hidden-status set changes only the presentation of its native capability trees and coverage flora: each remains in the canonical placement and caster streams, while the delivered merged material is visibly dimmed through its cutout and existing prop-lighting/regrow hooks."
status: proposed
proof_mode: integration-test
depends_on: [coverage-flora-native-placement, forest-canvas-delivery]
decisions: [608]
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/forest-world-r3f", "test"]
  scope:
    testGlobs:
      - "packages/forest-world-r3f/src/kit-status-presentation.test.ts"
    sourceGlobs:
      - "packages/forest-world-r3f/src/kit-status-presentation.ts"
      - "packages/forest-world-r3f/src/kit-mesh.ts"
      - "packages/forest-world-r3f/src/ForestWorldCanvas.growth-material.ts"
  real:
    testFile: "packages/forest-world-r3f/src/kit-status-presentation.test.ts"
    sourceFile: "packages/forest-world-r3f/src/kit-status-presentation.ts"
    scope:
      testGlobs: ["packages/forest-world-r3f/src/kit-status-presentation.test.ts"]
      sourceGlobs:
        - "packages/forest-world-r3f/src/kit-status-presentation.ts"
        - "packages/forest-world-r3f/src/kit-mesh.ts"
        - "packages/forest-world-r3f/src/ForestWorldCanvas.growth-material.ts"
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/forest-world-r3f", "typecheck"]
    proofCommand:
      file: bun
      args: ["test", "--preload", "./scripts/tsx-cache-off.mjs", "packages/forest-world-r3f/src/kit-status-presentation.test.ts"]
---

# Native host-status presentation — filtered semantic props remain present and visibly dim

**Outcome —** The Studio host already retains a legend-filtered SVG target at opacity `0.12` so it
can still receive click, focus and keyboard interaction. This capability gives the native semantic
props the same presentation without changing whether anything exists: only an attributed capability
tree or coverage-flora placement with a status in the host's supplied hidden set is dimmed. The
canonical placement list, its island attribution, the descriptor stream, ground, road and caster
inputs remain unchanged.

**Depends on —** [`coverage-flora-native-placement`](coverage-flora-native-placement.md) delivers
the attributable coverage role in the shared placement/material stream;
[`forest-canvas-delivery`](forest-canvas-delivery.md) delivers the canvas material clone and
app-owned regrow-presentation seam. This capability consumes those outcomes. It adds no second
placement collection, renderer clock, renderer camera, native picking path or shadow authority.

## Proof walkthrough

1. Build literal attributed descriptors and their existing kit placements across two islands. Include
   capability tree placements whose healthy and unhealthy forms both have null tint, a
   `coverageFlora` placement, decorative `bush`/`tuft`/`flowerPatch`, and UAT
   `bloom`/`bud`/`wilt` placements. Supply a hidden-status set containing one capability status.
   The initial test is red because there is no status-presentation module or delivered material path.
2. Derive an immutable presentation sidecar from descriptor island + capability + folded status,
   never by reversing placement tint. Only the matched tree and coverage-flora placement receive
   alpha `0.12`; decorative cover, UAT markers and unmatched/unknown placement identities receive
   `1`. Empty or non-matching hidden sets return the complete full-alpha presentation. The original
   placement list, island attribution, descriptor stream and `placementCasters` input remain equal.
3. Hand the sidecar to the actual `kitMeshes` route. Equal material/tint/presentation parts remain
   merged; a different presentation alpha may create one distinct material bucket, but no prop is
   unbatched into its own mesh. Every transformed part remains represented and the full-alpha route
   keeps the current mesh/material result.
4. Inspect the delivered prepared foliage material. At alpha `0.12`, its effective cutout threshold
   preserves texels that passed the original `alphaTest: 0.5` while rejecting texels below that
   authored cutout. Full alpha retains the existing alpha-test, transparency and depth-write route.
   This proves the actual cutout/material consumer rather than an unused numeric alpha helper.
5. Compile the dimmed material clone through the actual material hooks. Its prop-lighting hook and
   cache identity survive; the app-owned regrow growth uniforms, attributes and zero-growth discard
   remain installed; the source kit material remains unmutated; and any replacement material or
   merged geometry remains owned by the existing `KitProps` disposal path. No test calls a renderer
   frame loop or supplies a clock.

## Contracts (4)

1. **`native-status-presentation-dims-only-attributed-capability-props`** — the host hidden set
   produces alpha `0.12` only for matched capability trees and coverage flora; decorative cover,
   UAT criteria and unmatched sources stay full alpha.
   - **asserts —** given the host hidden-status set and supplied folded island/capability statuses,
     `deriveKitStatusPresentation` assigns alpha `0.12` only to matched capability tree and
     coverage-flora placements, while decorative cover, UAT criteria and unmatched sources retain
     full alpha.
   - **covers —** `kit-status-presentation.ts` — test:
     `kit-status-presentation.test.ts`
2. **`native-status-presentation-does-not-change-ground-or-casters`** — presentation derives a
   sidecar and leaves canonical placements, their attribution, descriptor stream and caster inputs
   unchanged.
   - **asserts —** after `deriveKitStatusPresentation` derives its presentation sidecar, the
     supplied placement list, island attribution, descriptor stream and caster inputs retain their
     original values and identities.
   - **covers —** `kit-status-presentation.ts` — test:
     `kit-status-presentation.test.ts`
3. **`native-status-presentation-batches-delivered-materials-by-alpha`** — actual `kitMeshes`
   keeps merged geometry/material buckets for equal material/tint/presentation while separating only
   different presentation alpha, retaining all transformed geometry.
   - **asserts —** when `kitMeshes` receives equal material/tint/presentation parts, it retains one
     merged geometry/material bucket, and when presentation alpha differs it separates only that
     material bucket while retaining every transformed part.
   - **covers —** `kit-mesh.ts`, `kit-status-presentation.ts` — test:
     `kit-status-presentation.test.ts`
4. **`native-status-presentation-keeps-dimmed-cutouts-and-existing-hooks`** — an actual dimmed
   foliage material remains renderable through its cutout, preserves prop-lighting and regrow shader
   hooks/cache keys/discard, does not mutate the source material, and retains existing replacement
   material/merged-geometry disposal ownership.
   - **asserts —** when `presentationMaterial` prepares a dimmed foliage clone, it preserves the
     authored cutout and existing prop-lighting/regrow hooks, leaves the source material unmutated,
     and retains the existing replacement-material and merged-geometry disposal ownership.
   - **covers —** `kit-mesh.ts`, `ForestWorldCanvas.growth-material.ts` — test:
     `kit-status-presentation.test.ts`

## Delivery boundary

After the signed pure/material proof, scoped unasserted glue in the same coherent green unit wires
the existing host `hidden` set through `TreeView → LandViewMount → ForestWorldCanvas → KitProps`.
The host stays sole authority for focus, keyboard navigation and picking: the canvas remains
`aria-hidden` and pointer-inert, and retained SVG `data-cap-id` / `data-story-id` targets continue
to serve `sceneTapSelect`. The `.tsx` integration witness records the known
`tsx-source-is-invisible-to-diff-mutation-selection` gap; it is not mutation credit.

This capability does not correct the retained SVG `parcel-flora.is-filtered` stylesheet omission,
retire flat-picture machinery, or attest the mounted appearance. Those are separate work on the
same transition and retain the owner's atomic retirement/appearance gate.
