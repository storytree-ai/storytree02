---
id: "forest-capture-asymmetric-padding"
tier: capability
story: studio
arc: frontend-builder-semantic-capture-arc
title: "Semantic forest capture frames targets inside an asymmetric review inset"
outcome: "A frontend builder can reserve explicit asymmetric CSS-pixel padding and receive the applied semantic-target camera for the remaining viewport, or a refusal before the map moves."
status: proposed
proof_mode: integration-test
depends_on: [forest-capture-camera-seam]
decisions: []
proof:
  command:
    file: pnpm
    args: ["--filter", "studio", "test"]
  scope:
    testGlobs: ["apps/studio/src/lib/forestCaptureCamera.test.ts", "apps/studio/src/components/TreeView.captureCamera.test.tsx"]
    sourceGlobs: ["apps/studio/src/lib/forestCaptureCamera.ts", "apps/studio/src/components/TreeView.tsx", "apps/studio/src/lib/worldCamera.ts"]
  real:
    testFile: "apps/studio/src/lib/forestCaptureCamera.test.ts"
    sourceFile: "apps/studio/src/lib/forestCaptureCamera.ts"
    editsExisting: true
    scope:
      testGlobs: ["apps/studio/src/lib/forestCaptureCamera.test.ts", "apps/studio/src/components/TreeView.captureCamera.test.tsx"]
      sourceGlobs: ["apps/studio/src/lib/forestCaptureCamera.ts", "apps/studio/src/components/TreeView.tsx", "apps/studio/src/lib/worldCamera.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "studio", "typecheck"]
    proofCommand:
      file: pnpm
      args: ["--filter", "studio", "exec", "vitest", "run", "src/lib/forestCaptureCamera.test.ts", "src/components/TreeView.captureCamera.test.tsx"]
---

# Semantic forest capture frames targets inside an asymmetric review inset

**Outcome —** A frontend builder can reserve explicit asymmetric CSS-pixel padding and receive the
applied semantic-target camera for the remaining viewport, or a refusal before the map moves.

## Why this is one capability

A capture’s inset is part of its requested frame, not presentation after the camera has been chosen.
The same request must validate padding, derive the remaining rectangle, resolve the named target in
that rectangle, commit the resulting camera and return that applied result. Separating those pieces
would recreate the bad evidence this arc removes: a screenshot may have a safe margin while its
receipt still describes a camera centred in the unpadded viewport.

This capability consumes `forest-capture-camera-seam`’s one target vocabulary and live-controller
command. It does not add another way to name a target, launch a browser, write an image, or decide
visual taste.

## Guidance

**Padding is an explicit four-sided frame input.** The mounted capture command accepts an optional
capture-frame option with `top`, `right`, `bottom` and `left` CSS-pixel values. All four values are
finite and non-negative; omitted padding is the all-zero case. The outer frame remains the real map
viewport. The usable frame is `{ x: left, y: top, width: viewport.width - left - right, height:
viewport.height - top - bottom }` and must have strictly positive width and height. A non-finite,
negative or impossible inset is a typed refusal before target lookup or camera state mutation.

**Resolve against the usable rectangle, not the raw viewport.** `square`, `story-node`, `island`,
`resting`, and `fit` all use that one usable frame. Square and island bounds remain contained in it;
a story node lands at its centre; resting and fit reuse their existing canonical policy with the usable
dimensions rather than an independent padded approximation. With asymmetric padding the target centre
therefore lands at `left + usable.width / 2, top + usable.height / 2`, not at the outer viewport
centre. Limits and the real `worldCamera` math remain authoritative.

**Return what committed.** A successful receipt identifies the outer viewport, the requested padding,
the computed usable frame and the applied `{ tx, ty, scale }` camera. `TreeView` commits that camera
through the same controller state as every other capture and returns the committed transform, not a
pre-clamp proposal. A failed padding request changes neither the controller camera nor the previous
receipt state.

**Keep the boundary narrow.** This slice does not accept percentage, viewport-relative, automatic or
CSS-selector-derived margins; it does not alter ordinary pan/zoom, map chrome, opening camera, target
grammar, browser orchestration, PNG publication or comparative capture. Those would be separate
outcomes rather than a testable inset extension of the existing seam.

## Proof walkthrough

First drive the pure resolver with an outer frame and deliberately unequal top/right/bottom/left values.
For a square and island, project every boundary and assert containment in the computed usable rectangle;
for a story node, assert its projected coordinate equals that rectangle’s asymmetric centre. Assert
resting and fit use the same usable dimensions. Cover zero padding as the exact existing result,
each negative/non-finite side, and width/height exhausted by the sums; each refusal precedes lookup and
has no camera result.

Then mount the real `TreeView`, call its capture command with the same five target kinds and asymmetric
padding, and compare its returned applied transform with the `.world-camera` transform. Save that
transform, issue invalid and impossible insets, and assert it is byte-identical afterwards. The tests
call the app-owned command directly; no drag, wheel or screenshot-coordinate transport stands in for
the capture frame.

## Integration test

**Goal —** Prove that the mounted semantic capture seam applies the camera that frames its target in
the requested asymmetric review rectangle.

1. In `forestCaptureCamera.test.ts`, resolve square, story-node, island, resting and fit with unequal
   finite padding. Assert exact usable-frame geometry, target containment/centering and the resolved
   applied camera; repeat zero padding and assert the legacy result.
2. In the same file, exercise each invalid side and every exhausted dimension. Assert the typed refusal
   arrives before world lookup and no success receipt exists.
3. In `TreeView.captureCamera.test.tsx`, mount the real controller and call the page capture command
   with the same target kinds/inset. Assert the receipt’s applied camera equals the committed SVG camera
   and its content rectangle is asymmetric in the requested direction.
4. Save the mounted camera, submit invalid and impossible padding, then assert the refusal and the
   saved transform are unchanged.

## Contracts (5)

1. **`fccp-validates-four-sided-css-pixel-padding`** — padding is a finite, non-negative explicit input
   - **asserts —** each `top`, `right`, `bottom` and `left` value must be finite and non-negative, and
     their horizontal/vertical sums leave a strictly positive usable width/height; invalid or exhausted
     insets return a typed refusal before target resolution or camera mutation.
   - **covers —** `apps/studio/src/lib/forestCaptureCamera.ts`, `apps/studio/src/components/TreeView.tsx`
2. **`fccp-square-and-island-stay-within-the-usable-rectangle`** — subject fitting honours all four sides
   - **asserts —** every projected square edge and island bound is inside the rectangle remaining after
     asymmetric padding, with scale derived from that rectangle rather than the outer viewport.
   - **covers —** `apps/studio/src/lib/forestCaptureCamera.ts`, `apps/studio/src/lib/worldCamera.ts`
3. **`fccp-named-centres-use-the-asymmetric-usable-centre`** — named views are centred where review space is
   - **asserts —** story-node, resting and fit resolve through canonical camera policy using the usable
     dimensions, and the target centre lands at the asymmetric rectangle centre rather than the raw
     viewport centre.
   - **covers —** `apps/studio/src/lib/forestCaptureCamera.ts`, `apps/studio/src/lib/worldCamera.ts`
4. **`fccp-live-seam-returns-the-padded-applied-camera`** — the receipt is a committed padded result
   - **asserts —** the mounted command returns outer frame, requested padding, usable frame and the
     exact controller-committed camera for every successful target kind.
   - **covers —** `apps/studio/src/components/TreeView.tsx`
5. **`fccp-padding-refusal-preserves-the-current-camera`** — impossible insets cannot create a false frame
   - **asserts —** invalid or impossible padding returns its typed refusal and leaves the mounted
     controller camera byte-identical, including when the target would otherwise resolve.
   - **covers —** `apps/studio/src/lib/forestCaptureCamera.ts`, `apps/studio/src/components/TreeView.tsx`

