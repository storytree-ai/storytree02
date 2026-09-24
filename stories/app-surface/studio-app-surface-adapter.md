---
id: "studio-app-surface-adapter"
tier: capability
story: app-surface
arc: chapter2-real-app-surface-arc
title: "TreeView adapts Studio world state into the shared scene view"
outcome: "Studio's TreeView folds its existing world/scene state and selection intent into `WorldPresentationModel` plus `WorldPresentationEvents`, mounts the public `@storytree/app-surface` world view, and preserves current scene behaviour while legend, inspector, chat, camera shell and bulk CSS remain Studio-owned."
status: proposed
proof_mode: integration-test
depends_on: [app-surface-world-view]
decisions: [237, 93, 230, 70]
# EDITS-EXISTING hosted Studio leaf. AUTHOR_TEST extends TreeViewShell.test.tsx; IMPLEMENT replaces
# the private SceneView mount with WorldSceneView while keeping the surrounding Studio controller
# and UI. The full Studio suite guards untouched siblings against regression.
proof:
  command:
    file: pnpm
    args: ["--filter", "studio", "test"]
  scope:
    testGlobs: ["apps/studio/src/components/**/*.test.ts", "apps/studio/src/components/**/*.test.tsx"]
    sourceGlobs: ["apps/studio/src/**/*.ts", "apps/studio/src/**/*.tsx", "apps/studio/src/**/*.css"]
  real:
    testFile: "apps/studio/src/components/TreeViewShell.test.tsx"
    sourceFile: "apps/studio/src/components/TreeView.tsx"
    editsExisting: true
    scope:
      testGlobs: ["apps/studio/src/components/TreeViewShell.test.tsx"]
      sourceGlobs: ["apps/studio/src/**/*.ts", "apps/studio/src/**/*.tsx", "apps/studio/src/**/*.css"]
    install: true
    proofCommand:
      file: pnpm
      args: ["--filter", "studio", "test"]
    typecheck:
      file: pnpm
      args: ["--filter", "studio", "typecheck"]
---

# TreeView adapts Studio world state into the shared scene view

**Outcome —** Studio's `TreeView` folds its existing world/scene state and selection intent into
`WorldPresentationModel` plus `WorldPresentationEvents`, mounts the public
`@storytree/app-surface` world view, and preserves current scene behaviour while legend,
inspector, chat, camera shell and bulk CSS remain Studio-owned.

## Guidance

- Split only at the current `TreeView` → `SceneView` seam. Studio retains live API calls,
  subscriptions, world construction, loading/error handling, camera/controller state and actions.
- Mount `WorldSceneView` in the real forest shell. Remove the private scene renderer or leave only a
  delegating compatibility re-export; never retain a second renderer/sprite resolver.
- Preserve scene selection/focus behaviour. *(The clean/default Storybook art, the explicit
  `?artStyle=vector` sheet and their sprite fallbacks retired with the flat forest picture on
  2026-09-24, ADR-0608 D2 — the map's picture is the mounted 3D land, and this seam carries only the
  SVG interaction layer over it.)*
- Leave `WorldLegend`, inspector/detail UI, `ChatPanel`, camera shell/controller, bulk TreeView
  chrome/layout and bulk CSS in Studio. Their later migration is not hidden in this leaf.
- Keep current selector behaviour. Do not add Chapter 2 data, replay, new
  motion, reduced-motion visual design or artifact sync.

## Integration test

1. Render real `TreeView` with loaded world, selection, claimed/proven, arrival and reveal-plan state.
2. Assert the scene mount is public `WorldSceneView` receiving the deterministic world model; no
   private sibling scene renderer mounts.
3. Exercise scene selection/focus; assert it reaches the existing Studio controller and folds back
   into the world model.
4. Run the full Studio suite: TreeView/scene/trail parity stays green, and untouched
   legend/inspector/chat/camera siblings do not regress.

## Contracts

1. **`asa-treeview-folds-world-state-into-shared-model`**
   - **asserts —** representative world state becomes the public model; Studio effect handles never
     cross into the view.
2. **`asa-treeview-mounts-one-shared-world-view`**
   - **asserts —** the forest shell mounts `WorldSceneView`; the private SceneView retires or delegates.
3. **`asa-world-events-reach-existing-studio-controller`**
   - **asserts —** selection/focus events invoke the current controller and return through the model.
4. **`asa-studio-scene-regressions-stay-green`**
   - **asserts —** the studio's `SceneView` adapter keeps its scene/trail/arrival tests green; unchanged
     legend/inspector/chat/camera tests remain a regression wall, not moved scope.
