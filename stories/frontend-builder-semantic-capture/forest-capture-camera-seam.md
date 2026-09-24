---
id: "forest-capture-camera-seam"
tier: capability
story: frontend-builder-semantic-capture
arc: frontend-builder-semantic-capture-arc
title: "A named forest capture target resolves to one exact camera receipt"
outcome: "A frontend builder's named forest capture target resolves through Studio to one exact applied camera receipt or a typed refusal."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: []
proof:
  command:
    file: pnpm
    args: ["--filter", "studio", "test"]
  scope:
    testGlobs: ["apps/studio/src/components/TreeView.captureCamera.test.tsx", "apps/studio/src/lib/forestCaptureCamera.test.ts"]
    sourceGlobs: ["apps/studio/src/components/TreeView.tsx", "apps/studio/src/lib/forestCaptureCamera.ts", "apps/studio/src/lib/worldCamera.ts"]
  real:
    testFile: "apps/studio/src/components/TreeView.captureCamera.test.tsx"
    sourceFile: "apps/studio/src/components/TreeView.tsx"
    editsExisting: true
    scope:
      testGlobs: ["apps/studio/src/components/TreeView.captureCamera.test.tsx", "apps/studio/src/lib/forestCaptureCamera.test.ts"]
      sourceGlobs: ["apps/studio/src/components/TreeView.tsx", "apps/studio/src/lib/forestCaptureCamera.ts", "apps/studio/src/lib/worldCamera.ts"]
    install: true
    typecheck:
      file: pnpm
      args: ["--filter", "studio", "typecheck"]
    proofCommand:
      file: pnpm
      args: ["--filter", "studio", "exec", "vitest", "run", "src/components/TreeView.captureCamera.test.tsx"]
---

# A named forest capture target resolves to one exact camera receipt

**Outcome —** A frontend builder's named forest capture target resolves through Studio to one exact
applied camera receipt or a typed refusal.

## Why this is one capability

The builder has one outcome: name a review target and know precisely which camera the live map used,
without synthesising pointer input. Parsing the target, resolving it against the real world, deriving
the frame, applying that frame through the map controller and returning its receipt share one request,
precondition and observable. Separating them would recreate the current failure mode: a utility can
calculate a camera that the running map never applies, or a browser script can move a map without knowing
what it actually framed.

## Guidance

**One public target vocabulary.** The seam accepts exactly one discriminated target input:

- `square` — a finite world-space `{ x, y, size }` square with a strictly positive `size`. Its whole
  square must be contained by the capture frame; the deterministic scale is the smaller frame-axis fit
  and the square centre lands at the frame centre. A rectangular browser viewport may show extra world
  on one axis, but it never crops the named square.
- `story-node` — a story id resolved from the real loaded story-node position, centred at the configured
  story-node review scale.
- `island` — an island id resolved from the real loaded island bounds, fitted as a subject rather than
  guessed from a story id. An island can outlive or differ from a node, so the names stay distinct even
  where today's data maps them one-to-one.
- `resting` and `fit` — canonical named views that reuse the existing `restingWorld` and contain-fit
  calculations, including their live chrome reservation and camera limits. They are not re-created as a
  second approximation of opening-camera policy.

The success result is a typed receipt carrying the canonical target kind and any resolved id/bounds, the
positive frame dimensions used, and the **applied** `{ tx, ty, scale }` camera. It is the input to a later
CLI screenshot manifest, not an unverified requested value. Failure is a typed refusal (`invalid-target`,
`target-not-found`, `invalid-frame`, or `world-unavailable`); it carries enough machine-readable detail to
fix the request and never changes the existing camera.

**The page seam, not a test-only back door.** `TreeView` owns one deliberately named capture-camera command
seam that the later browser driver can call after the real map reports its settled world. The seam delegates
target resolution to a pure `forestCaptureCamera` module, commits exactly the returned camera through the
same controller state used by the map, then returns the committed receipt. It is registered only while that
map instance is mounted and removed on cleanup, so stale browser handles cannot steer a later map. Keep
wheel, drag and keyboard behaviour unchanged; they remain interaction coverage, not required transport for
deterministic framing.

**Make geometry the oracle.** Reuse `worldToScreen`, `centerOn`, `fitWorld`, `restingWorld` and the real
layout output. The focused tests assert projected bounds and exact receipt equality, not opaque `setCam`
call counts or screenshot pixels. A test may substitute only layout-unavailable rendering components through
the existing `StudioSurfacesContext`; the target resolver, current world, camera math and controller state
run for real. This is geometry/behaviour proof, not a visual-taste verdict.

**Do not smuggle in the later driver.** This increment does not parse command-line flags, launch a
server/browser, take a PNG, wait for animation, compare a baseline, write files or document a shell
workflow. It also does not alter the ordinary opening camera, reader zoom limits, selection, drag/wheel
semantics or forest look. The later driver owns those concerns and calls this seam rather than
reimplementing its target grammar.

## Proof walkthrough

Mount the real `TreeView` controller over a deterministic, loaded fixture world with two distinguishable
story-node positions and island bounds, a positive measured viewport, and ordinary camera limits. Call the
mounted capture seam directly — never dispatch pointer or wheel events. For every target kind, read the
returned receipt and project the subject back through its reported camera. Then send a missing id,
non-finite/zero square and zero-sized frame; compare camera state before and after. Unmount and prove the
stale command is no longer callable. The integration test drives the real controller and geometry; only
rendering that jsdom cannot lay out is replaced through the established component context.

## Integration test

**Goal —** Prove that the live Studio controller applies exactly the semantic frame it reports, and refuses
unresolvable requests without moving the map.

1. Mount `TreeView` under its existing focused-test seams with a loaded two-subject fixture and a positive
   frame. Obtain the capture command registered by that mounted instance.
2. Request a `square`; assert success, project all four square corners through the receipt camera, and
   prove they remain inside the frame while the square centre is frame-centred.
3. Request a `story-node` and an `island` whose fixture locations/bounds differ. Assert each receipt
   identifies the resolved subject and projects its centre/bounds according to that target's framing rule,
   proving neither path aliases the other or falls back to a mouse-derived camera.
4. Request `resting` and `fit`; assert their receipts equal the current canonical camera calculations for
   this world/frame, including existing limit and chrome-reserve inputs.
5. Save the current camera, then request a missing id, invalid square and invalid frame. Assert the exact
   typed refusal for each and that the saved camera remains byte-identical. Unmount; assert the old command
   is unavailable rather than steering a replacement map.

## Contracts (5)

1. **`fccs-square-is-contained-and-centred`** — a finite positive world square receives a contained, centred camera
   - **asserts —** resolving a `square` returns a success receipt whose camera projects every square edge
     inside the positive frame and its centre to the frame centre, using the limiting frame axis rather than
     a wheel-step approximation.
   - **covers —** `apps/studio/src/lib/forestCaptureCamera.ts` (square validation and exact frame math)
2. **`fccs-story-node-and-island-resolve-separately`** — story-node and island targets use their own real geometry
   - **asserts —** a `story-node` target centres its resolved node position, while an `island` target
     resolves and frames that island's real bounds; distinguishable fixture geometry yields distinguishable
     receipts, and an absent id is `target-not-found`.
   - **covers —** `apps/studio/src/lib/forestCaptureCamera.ts` (typed target resolution)
3. **`fccs-named-views-reuse-canonical-camera-policy`** — resting and fit are the existing canonical views
   - **asserts —** `resting` and `fit` receipts equal the existing `restingWorld` and contained `fitWorld`
     calculations over the same world, frame, padding and limits, not a duplicate opening-camera approximation.
   - **covers —** `apps/studio/src/lib/forestCaptureCamera.ts`, `apps/studio/src/lib/worldCamera.ts`
4. **`fccs-refusal-preserves-the-current-camera`** — invalid input does not move the map
   - **asserts —** non-finite or non-positive square values, an unusable frame, unavailable world and missing
     target produce their declared typed refusal and leave the pre-request camera exactly unchanged.
   - **covers —** `apps/studio/src/lib/forestCaptureCamera.ts`, `apps/studio/src/components/TreeView.tsx`
5. **`fccs-live-seam-returns-the-applied-camera-and-cleans-up`** — the mounted map reports its committed camera
   - **asserts —** the live `TreeView` capture command commits the resolved camera through the real controller
     and returns that applied camera in its receipt; unmount removes the command so a stale caller cannot
     affect a later map instance.
   - **covers —** `apps/studio/src/components/TreeView.tsx`

## Guidance — the net-new slice that earns the signed verdict

Build the focused `TreeView.captureCamera.test.tsx` red first: mount the real map controller, issue a semantic
command and assert the five contract ids above. At HEAD no such command or receipt exists, so the test fails
for the intended missing seam rather than relying on a visual diff. Add the pure target resolver and wire it
once through `TreeView`'s existing camera-state boundary. Run the focused Vitest command and Studio typecheck.
Do not make screenshots or mouse movement part of this unit's proof: those belong to follow-on CLI/browser
orchestration after this seam is signed.
