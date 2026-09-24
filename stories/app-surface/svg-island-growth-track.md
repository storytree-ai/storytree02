---
id: "svg-island-growth-track"
tier: capability
story: app-surface
arc: chapter2-pixellab-organic-growth-arc
title: "The existing SVG island grows in place through the public product player"
outcome: "The public app surface maps normalized semantic progress onto app-native growth of the existing SVG island, coast and ground geometry while preserving the established camera, coordinates, painter order and retained final land under navigation and reduced motion."
status: retired
proof_mode: integration-test
depends_on: [semantic-growth-replay-view]
decisions: [274, 237, 230, 70]
# This capability owns only native-land behaviour through the existing player/renderer. PixelLab
# organic assets are a dependent capability; generated land, a complete-scene composite and a second
# renderer are explicit non-goals.
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

# The existing SVG island grows in place through the public product player

> **RETIRED 2026-09-24 under ADR-0608.** The flat forest picture this capability painted is retired;
> the mounted 3D land is the forest. Its code and tests were deleted, and everything below is history.

**Outcome —** The public app surface maps normalized semantic progress onto app-native growth of the
existing SVG island, coast and ground geometry while preserving the established camera, coordinates,
painter order and retained final land under navigation and reduced motion.

## Proof walkthrough first

Exercise the existing island through the public `SemanticGrowthWorldView` / `SceneView` path:

1. capture the mature island's current SVG coast, ground/substrate, world parcel, view box,
   interaction geometry and painter slot as the authoritative retained scene;
2. feed zero, boundary, representative and settled normalized progress through the app-owned land
   mapper, proving it reveals or grows those same SVG elements in place without substituting raster
   land frames or changing the camera;
3. render equal progress twice and compare geometry identity, coordinates, anchor, view box, painter
   order and settled output;
4. walk Next, Back and Replay twice, proving the same semantic trace selects the same land state
   without randomness, remount keys, timers or asset-owned cursors;
5. repeat under reduced motion, proving interpolation and holds disappear while each cue reaches the
   same settled native geometry; and
6. retain the mature island as the ordinary final shared scene, with no complete-scene overlay,
   generated coastline, alternate renderer or displaced interaction geometry.

This capability proves the substrate consumed by later organic tracks. It makes no visual-quality
claim about those tracks.

## Guidance

- Reuse the established app-owned SVG island/coast/ground geometry and isometric framing.
- Land growth may use an app-native mask, clip, path reveal or bounded geometry interpolation only
  when the underlying geometry, camera, parcel, interaction seam and final scene stay authoritative.
- Keep normalized progress, timing, easing, holds, navigation and reduced-motion settlement in the
  existing public player.
- Do not add PixelLab land frames, a full-island raster, generated coastline, movie/GIF, snapshot
  swap, second renderer or host-owned animation cursor.
- Preserve existing water, shadow, label, effect and interaction geometry unless this land reveal
  needs a narrowly inseparable native mask/clip.

## Machine contracts

1. **`sigt-existing-svg-land-is-the-only-substrate`**
   - **asserts —** every growth state references the established SVG island/coast/ground geometry;
     no generated land image, complete-scene raster, video/GIF or replacement coastline participates.
2. **`sigt-camera-coordinates-and-painter-slot-stay-invariant`**
   - **asserts —** progress cannot change the established view box, world parcel, coast coordinates,
     interaction geometry, ground anchor or painter-order role.
3. **`sigt-progress-selects-native-land-deterministically`**
   - **asserts —** the pure app-owned mapper clamps normalized progress and returns equal native-land
     state for equal input across mounts; no timer, random value, remount or asset cursor influences
     output.
4. **`sigt-navigation-and-reduced-motion-settle-equivalently`**
   - **asserts —** repeated Next, Back and Replay traces produce equal semantic/progress/land states;
     reduced motion removes interpolation and delay while selecting the same settled geometry.
5. **`sigt-mature-land-is-the-retained-real-scene`**
   - **asserts —** the final state is the ordinary existing SVG island rendered through
     `SceneView`, not an overlay hiding the product scene or a second renderer.
