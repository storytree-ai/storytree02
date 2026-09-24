---
id: "forest-capture-camera-seam"
tier: capability
story: studio
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
    # The pure resolver is the mutation-bearing geometry/refusal boundary, so it is the primary
    # red→green test file. The proof command also runs the mounted controller test below: a pure
    # receipt is not sufficient until TreeView commits and returns that receipt.
    testFile: "apps/studio/src/lib/forestCaptureCamera.test.ts"
    sourceFile: "apps/studio/src/lib/forestCaptureCamera.ts"
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
      args: ["--filter", "studio", "exec", "vitest", "run", "src/lib/forestCaptureCamera.test.ts", "src/components/TreeView.captureCamera.test.tsx"]
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
layout output. The focused proof command runs TWO complementary files: the pure
`forestCaptureCamera.test.ts` reaches every resolver branch directly, while
`TreeView.captureCamera.test.tsx` proves the mounted controller commits the same result. The pure file must
assert projected bounds and exact receipt equality, not opaque `setCam` call counts or screenshot pixels.
It must explicitly exercise non-finite/zero frame dimensions, absent world, every malformed square value,
missing lookup, invalid island radius, the square width-vs-height limiting-scale branches, node-scale clamp,
and island diameter/contain-fit geometry. A test may substitute only layout-unavailable rendering components
through the existing `StudioSurfacesContext`; the target resolver, current world, camera math and controller
state run for real. This is geometry/behaviour proof, not a visual-taste verdict.

**Do not smuggle in the later driver.** This increment does not parse command-line flags, launch a
server/browser, take a PNG, wait for animation, compare a baseline, write files or document a shell
workflow. It also does not alter the ordinary opening camera, reader zoom limits, selection, drag/wheel
semantics or forest look. The later driver owns those concerns and calls this seam rather than
reimplementing its target grammar.

## Proof walkthrough

First call the pure resolver with a real, small world fixture whose node positions, territory radii and frame
aspect ratio make every branch distinguishable. Assert invalid frame before world access; null world; every
non-finite and non-positive square field; missing id; invalid island radius; and both width-bound and
height-bound square scales. Assert exact node-scale clamping and island `diameter → contain-fit → centre`
geometry, then prove `resting` and `fit` are returned exactly. Next mount the real `TreeView` controller over
that loaded fixture world, call the mounted capture seam directly — never dispatch pointer or wheel events —
and compare its committed camera with the pure receipt. Finally unmount and prove the stale command is no
longer callable. The mounted integration test drives the real controller and geometry; only rendering that
jsdom cannot lay out is replaced through the established component context.

## Integration test

**Goal —** Prove that the live Studio controller applies exactly the semantic frame it reports, and refuses
unresolvable requests without moving the map.

1. In `forestCaptureCamera.test.ts`, call the pure resolver over a two-subject fixture. Cover invalid frames,
   unavailable world, non-finite and non-positive square fields, absent ids, invalid island radius and both
   square limiting-axis branches. Assert every refusal code and exact receipt.
2. In the same pure test, project all four valid-square corners, verify node-scale clamp and the island's
   diameter/contain-fit framing, then assert `resting` and `fit` are the passed canonical cameras exactly.
3. Mount `TreeView` under its existing focused-test seams with that loaded fixture and a positive frame.
   Obtain the capture command registered by that mounted instance; request every successful target kind and
   compare the committed camera and receipt to the resolver's exact result.
4. Save the mounted camera, then request a missing id, malformed square and invalid frame. Assert the typed
   refusal for each and the saved camera byte-identical. Unmount; assert the old command is unavailable rather
   than steering a replacement map.

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

Strengthen the pure `forestCaptureCamera.test.ts` first: author named cases for the resolver's refusal,
lookup and exact-geometry branches, then run it **together with** `TreeView.captureCamera.test.tsx` through
this capability's one `proofCommand`. The mounted file remains the independent application check: it proves
the resolved camera is the committed/returned camera, not merely a calculation. Do not replace either file
with screenshot or mouse movement evidence; those belong to follow-on CLI/browser orchestration after this
seam is signed.
