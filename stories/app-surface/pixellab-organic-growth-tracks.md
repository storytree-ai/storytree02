---
id: "pixellab-organic-growth-tracks"
tier: capability
story: app-surface
arc: chapter2-pixellab-organic-growth-arc
title: "Registered PixelLab organic tracks grow from stable app-owned sockets"
outcome: "The public app surface composes transparent local PixelLab-authored hero-tree and plant tracks over the retained SVG island by mapping app-owned semantic progress to frames registered at stable root and ground sockets."
status: retired
proof_mode: integration-test
depends_on: [svg-island-growth-track]
decisions: [274, 237, 219, 230, 70]
# PixelLab supplies author-time organic appearance only. The existing app player owns semantics,
# progress, selection, timing, navigation, reduced motion and the retained scene. Visual quality is
# deferred to the story's hosted owner-held LOOK leg.
# RETIRED 2026-09-24 under ADR-0608 ("The mounted 3D land becomes the forest, and the flat forest
# look is retired"). This capability's whole surface was the flat Chapter-2 picture — the painted SVG
# island, its growth/accretion track, the flat vegetation and PixelLab sprite tracks, and the
# query-gated `?semanticGrowth=demo` / `?organicGrowth=*` lab routes that staged them. ADR-0608 D2
# retires that picture and D3 deletes the code that only painted it, with its tests, as engineering
# follow-through (ADR-0605). The `proof:` binding that stood here named files that no longer exist, so
# it is REMOVED (the `status: retired` flip alone clears nothing — `check:verification-decay`'s
# contract-binding-drift instrument filters on the binding, not on status). The node is KEPT as a
# browsable row with its body as history; the implementation is recoverable from git history.
---

# Registered PixelLab organic tracks grow from stable app-owned sockets

> **RETIRED 2026-09-24 under ADR-0608.** The flat forest picture this capability painted is retired;
> the mounted 3D land is the forest. Its code and tests were deleted, and everything below is history.

**Outcome —** The public app surface composes transparent local PixelLab-authored hero-tree and plant
tracks over the retained SVG island by mapping app-owned semantic progress to frames registered at
stable root and ground sockets.

## Proof walkthrough first

Exercise one bounded curated organic asset set over the delivered native island:

1. load and decode every referenced transparent local frame for the rooted hero tree/canopy plus the
   bounded plant/flower details used by the representative scene;
2. verify each manifest records prompt, model, generation identifier, licence/provenance, reference
   plate, fixed canvas, frame dimensions/count/order, source-to-normalized offsets, app/world
   root/ground socket, depth slot and mature footprint;
3. compare the reference plate with the real SVG island's established camera and prove every frame
   keeps its declared root or ground contact invariant after author/import-time normalization;
4. feed boundary and representative cue/progress values through the app-owned selector, proving equal
   input chooses equal track/frame output without a timer, random value, vendor request or asset
   cursor;
5. walk Next, Back and Replay twice under full and reduced motion, proving equivalent settled frames,
   stable sockets and retained mature output;
6. render separate registered tracks through the existing shared scene order, proving native SVG
   land remains visible while trunk, canopy, foliage and ground details respect support and painter
   depth;
7. audit the runtime/build boundary for PixelLab clients, hostnames, credentials, model calls,
   animated asset clocks, movie/GIF playback and a second renderer; and
8. enforce a committed compressed/decode/frame/layer budget plus one finite capability-correspondence
   seam through declared app-owned sockets or a small bounded canopy variant set.

This machine proof establishes registration, determinism and composability. The owner alone decides
whether the organic deformation and SVG/raster seam look convincing in the hosted witness.

## Guidance

- Generate against a fixed reference plate exported from the real SVG island at its established
  camera. Reject or regenerate a wrong projection, drifting root, moving ground contact or
  incompatible mature footprint.
- Commit transparent local PNG/atlas assets plus provenance and normalization metadata. PixelLab is
  author-time tooling only; never commit a credential or runtime client.
- Prefer separate registered hero-tree/canopy/plant tracks when that preserves support and painter
  order. Do not flatten the island into the organic asset.
- Keep semantic state, normalized progress, timing, easing, holds, Next, Back, Replay, reduced-motion
  settlement and retained final state in the public app player.
- Capability-aware foliage is finite and app-owned. Do not generate a bespoke sheet for every story
  or capability count.
- Inspection videos/GIFs may document authoring only; they are not the runtime or acceptance witness.

## Machine contracts

1. **`pogt-assets-are-transparent-local-and-provenanced`**
   - **asserts —** every manifest resolves versioned local transparent frames with prompt, model,
     generation, licence/provenance, fixed dimensions/count/order and normalization metadata; it
     contains no credential, remote PixelLab URL or animation clock.
2. **`pogt-reference-camera-and-sockets-are-invariant`**
   - **asserts —** each track is registered against the real SVG reference plate and declares one
     app/world root or ground socket, depth slot and mature footprint; normalized frames keep those
     anchors invariant without frame-specific runtime compensation.
3. **`pogt-progress-selects-organic-frames-deterministically`**
   - **asserts —** the app-owned mapper clamps normalized progress and returns equal track/frame
     selection for equal semantic input across mounts; timers, randomness, remounts, network calls
     and asset-owned cursors cannot affect output.
4. **`pogt-navigation-and-reduced-motion-settle-equivalently`**
   - **asserts —** repeated forward, Back and Replay traces yield equal cue/progress/frame/socket
     sequences; reduced motion removes interpolation and delay while choosing the same settled
     organic frames.
5. **`pogt-layers-compose-over-retained-svg-in-one-scene-order`**
   - **asserts —** the shared `SceneView` keeps native SVG land visible and composes registered trunk,
     canopy, foliage and plant layers at declared painter slots with no complete-scene composite,
     second renderer or alternate semantic model.
6. **`pogt-runtime-and-capability-seams-stay-bounded`**
   - **asserts —** browser/build source has no PixelLab SDK/client, hostname, credential, model call
     or vendor request; committed metadata records asset/decode/frame/layer budgets; capability
     correspondence uses finite app-owned sockets or a small declared variant bound.
