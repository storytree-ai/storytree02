---
id: "app-surface"
tier: story
title: "The shared app surface — the map's interaction layer over the 3D land"
outcome: "The real shared app draws the forest map's SVG interaction layer — nameplates, claim wisps, hit geometry, selection lanes, shore rings, native plant targets and caves — over the mounted 3D land through one deterministic typed world view that Studio's forest shell mounts as its only scene renderer."
status: proposed
proof_mode: UAT
# RE-SCOPED 2026-09-24 under ADR-0608 ("The mounted 3D land becomes the forest, and the flat forest
# look is retired"). This story used to be the flat Chapter-2 SVG island growth: painted island
# fills, hex tiles, hero trees, flat vegetation/PixelLab sprite tracks, flat roads and the
# `?semanticGrowth=demo` / `?organicGrowth=*` lab routes that staged them. D2 retires that PICTURE and
# keeps the SVG INTERACTION layer; D3 deletes the code that only painted it, with its tests, as
# engineering follow-through (ADR-0605). Five capabilities retired with it (listed in the body, KEPT
# as browsable rows with `status: retired` and no proof binding); `capabilities:` below lists only the
# live two, the house pattern for a live story (cf. drive-machinery / oq-hygiene-gate).
arc: chapter2-real-app-surface-arc
capabilities: [app-surface-world-view, studio-app-surface-adapter]
# The framework-bearing package sits immediately above @storytree/forest-world and imports it.
# Studio's consuming-surface edge is declared consumer-side in stories/studio/story.md.
depends_on: [forest-world]
consumed_by: []
decisions: [608, 605, 237, 93, 230, 70]
---

# The shared app surface — the map's interaction layer over the 3D land

**Outcome —** The real shared app draws the forest map's SVG interaction layer — nameplates, claim
wisps, hit geometry, selection lanes, shore rings, native plant targets and caves — over the mounted
3D land through one deterministic typed world view that Studio's forest shell mounts as its only
scene renderer.

> **RE-SCOPED 2026-09-24 under ADR-0608.** The mounted 3D land IS the forest; the flat forest
> PICTURE this story used to grow (painted island fills, hex tiles, hero trees, flat vegetation and
> PixelLab sprite tracks, flat roads, flat-only animation) is retired and its code deleted. What stays
> here is the part of the old surface that was never a picture: the SVG layer a person clicks, reads
> and follows over the land.

## Journey

The consumer is the Studio operator on the forest map. The mounted 3D land draws the forest; over
it, the shared app draws what makes the map operable — each island's nameplate, the live claim
wisps (never painted as proven-green, the ADR-0138 §5 honesty wall), a generous hit region per
island and per capability parcel, the selection's lanes and its one-hop neighbour rings, native plant
targets and cave portals. The operator selects an island or a capability and Studio's existing
controller receives the typed event. One journey, one observable: the interaction layer the operator
acts on is the shared view, delegated to from one mount, with no second private renderer.

## Capabilities

| # | capability | outcome | depends on |
|---|---|---|---|
| 1 | [`app-surface-world-view`](app-surface-world-view.md) | A deterministic typed world model/events seam delegates to the shared `SceneView` interaction layer. | — |
| 2 | [`studio-app-surface-adapter`](studio-app-surface-adapter.md) | `TreeView` folds its existing state/actions into the shared model and mounts the public world view. | `app-surface-world-view` |

Dependency graph: `app-surface-world-view → studio-app-surface-adapter`.

**Retired 2026-09-24 with the flat picture (ADR-0608)** — kept as browsable history, no proof
binding: [`semantic-growth-replay-view`](semantic-growth-replay-view.md),
[`semantic-growth-studio-demo`](semantic-growth-studio-demo.md),
[`svg-island-growth-track`](svg-island-growth-track.md),
[`pixellab-organic-growth-tracks`](pixellab-organic-growth-tracks.md) and
[`organic-growth-app-witness`](organic-growth-app-witness.md).

## Ownership

`@storytree/app-surface` owns the shared `SceneView` interaction layer, the `WorldSceneView`
model/events seam and its helpers (lane layout, neighbour highlight, trail reveal, forest regrow,
native plant targets). `@storytree/forest-world` remains the framework-neutral world/scene
computation root. Studio owns live data, controller state, the mounted 3D land and the surrounding
legend/inspector/chat/camera chrome.

## UAT Test Criteria

**Goal —** Studio's forest map acts through one shared interaction layer over the 3D land.

### Disposition of the eleven original criteria (ADR-0294, ADR-0348 D6, ADR-0608)

**All eleven are deleted — the story carries NO UAT criterion today.** Nine were deleted on 2026-08-08, all as ADR-0294 D2 duplicates; leg 11 on 2026-08-11 (ADR-0348 D6); leg 10 on 2026-09-24 (ADR-0608). The rows below cite test files and capabilities as they stood when each row was written: legs 3–9 name suites and capabilities that ADR-0608 deleted or retired, and they stand as history. This story's UAT section was the
purest instance in the corpus of the shape ADR-0294 D2 measures: legs 1–9 each bound to an
`app-surface#gate-N` that carries an explicit `_(covers: <capability>)_` annotation, so the command
each leg named was *by declaration* the command that greens that leg's own capability. Every
deletion below was checked against the named suite's actual test TITLES, not file existence — which
is what caught that two capability `proof.real.testFile` paths are STALE (`svg-island-growth.test.tsx`
and `organic-growth-track.test.tsx` do not exist; the real suites are `svg-island-accretion.test.tsx`
and `organic-pose-to-pose-{track,assets}.test.ts`). The proof is real; only the recorded path has
drifted. That drift is left for its owner rather than fixed here.

**The surviving numbers are deliberately NOT closed up.** `1`–`9` are burned: never reused, never
backfilled — `11` joined them on 2026-08-11 when ADR-0348 D6 deleted the LOOK leg, and `10` on
2026-09-24 when ADR-0608 deleted the hosted flat-witness leg, so every ordinal 1–11 is burned. The
seven reliability gates are likewise untouched, though none is claimed by a criterion any more — `reliabilityGateId` mints `<story>#gate-<n>` from POSITION, so removing one would
silently re-point already-signed verdicts and the surviving legs' bindings onto different gates
(`asset:edit-story-uat-criteria`). Each retired gate is now unclaimed by any criterion and stays in
place for that reason alone.

| original leg | criterion id | disposition |
|---|---|---|
| 1. **World presentation is deterministic** | `uatc_64fcbdd6348c342b802efad7` | **Delete as duplicate.** [`app-surface-world-view`](app-surface-world-view.md), `packages/app-surface/src/WorldSceneView.test.tsx`: **“aswv-equal-plain-inputs-normalize-deterministically”** asserts equal renders from equal inputs, and **“aswv-wrapper-has-no-private-or-live-authority”** asserts the no-fetch/store/clock half; **“aswv-delegates-one-semantic-scene-and-event”** asserts it reports only typed world events. All three success clauses, one-to-one. |
| 2. **TreeView is the real first consumer** | `uatc_039b8b6ddb147d375c932c7e` | **Delete as duplicate.** [`studio-app-surface-adapter`](studio-app-surface-adapter.md), `apps/studio/src/components/TreeViewShell.test.tsx`: **“asa-treeview-mounts-one-shared-world-view”** asserts exactly the mount-with-no-second-private-mapper claim. The leg's own text already conceded that the state-folding / selection-callback half “remains a gap until executable proof closes it” — it was never claimed here, so nothing unproven is lost by the deletion. |
| 3. **Existing art and selector policy survive** | `uatc_fcd45a1512795648a5521f4e` | **Delete as duplicate.** [`app-surface-world-view`](app-surface-world-view.md), same `pnpm --filter @storytree/app-surface test` command: `SceneView.test.tsx` + `SceneView.vegetation.test.tsx` (fallback, ground contact, depth order), `sprite-sizing.test.ts` (sizing), `trailReveal.test.ts` + `semantic-growth-trail-reveal.test.tsx` (trail reveal), `vegetation-render.test.ts` (arrival growth). |
| 4. **The semantic walk exposes six honest states** | `uatc_f5cd373a0b8a0e3f9a1875d4` | **Delete as duplicate.** [`semantic-growth-replay-view`](semantic-growth-replay-view.md), `apps/studio/src/components/TreeViewShell.test.tsx`: **“claimed adds presence without proof identity; healthy appears only last”** asserts both the presence-vs-proof distinction and the healthy-appears-last clause; **“sgsd-companion-witness-territory: … while only the primary narrates the five-frame walk”** asserts the observed keys. **⚠ The walk is FIVE states now, and this row's original leg title is the historical one.** ADR-0529 retired the verdict bloom and ADR-0536 dropped the `signed-proof` frame with it (no replacement marker; the fifth step does not show the green early), so the cited test titles were re-aimed in the same landing — this row is updated so the citation still RESOLVES, and the leg's own name is left as the record of what was deleted on 2026-08-20. The presence-vs-proof distinction this leg named is unchanged and survives: ADR-0536 D3 moved its home to the legend's proof row and to story prose. |
| 5. **Navigation and reduced motion preserve semantics** | `uatc_5b9f6145b996d8c392101b81` | **Delete as duplicate.** [`semantic-growth-replay-view`](semantic-growth-replay-view.md), `packages/app-surface/src/SemanticGrowthWorldView.test.tsx`: **“plays the supplied semantic sequence deterministically, clamps navigation, and renders its real scene immediately without motion when reduced”** and **“settles reduced motion immediately to and retains both final mature poses”** assert equal-actions-equal-snapshots and reduced-motion-changes-no-settled-cue. |
| 6. **The earlier semantic witness stays isolated from clean Studio** | `uatc_4ea0ef71ec37e25732fb26fc` | **Delete as duplicate.** [`semantic-growth-studio-demo`](semantic-growth-studio-demo.md), `apps/studio/src/components/TreeViewShell.test.tsx`: **“the clean route (and any unknown value) never mounts the demo; only the exact flag mounts one public five-frame player, steppable via its own Next control”** is this leg verbatim, and **“sgsd-composed-through-real-studio-world-pipeline”** asserts the real-composition-path half. *(“six-frame” → “five-frame” under ADR-0536, which dropped the `signed-proof` frame with the verdict bloom ADR-0529 retired; the isolation claim this row cites is untouched.)* |
| 7. **Native land grows without changing the island or camera** | `uatc_e92ecfa2a181ca2b109d7a8f` | **Delete as duplicate.** [`svg-island-growth-track`](svg-island-growth-track.md), `packages/app-surface/src/svg-island-accretion.test.tsx` (the capability's recorded `testFile` path is stale — see above): **“locally scales real cell paths without opacity, keeps coast/camera/anchor/painter and interaction geometry fixed”** asserts grows-in-place at the established view box/parcel/painter slot; **“uses the existing app clock for deterministic Back/Replay”** asserts equal-progress-equal-geometry; **“keeps the accretion runtime deterministic, SVG-only, and free of PixelLab/network/opacity animation authority”** asserts the no-raster/no-second-renderer/no-random/no-asset-clock wall. |
| 8. **Small-plant tracks are local, registered, product-driven** | `uatc_deda5e5db5d7520161632855` | **Delete as duplicate.** [`pixellab-organic-growth-tracks`](pixellab-organic-growth-tracks.md), `packages/app-surface/src/organic-pose-to-pose-track.test.ts` + `organic-pose-to-pose-assets.test.ts` (recorded `testFile` path likewise stale): **“registers separate transparent local hero-tree and bounded plant tracks with costs”** (provenance, transparency, bounded families), **“requires registered anchors normalized only by recorded author-time offsets”** (sockets, normalization), **“makes Next, Back, and Replay select equivalent cue, progress, and frames”** (equal cue/progress, Back/Replay settle identically), **“rejects remote/runtime vendor, credential, client, and asset-clock fields”** (no runtime PixelLab dependency). |
| 9. **The corrected real-consumer route is exact** | `uatc_0af87458e18a9d4495d21191` | **Delete as duplicate.** [`organic-growth-app-witness`](organic-growth-app-witness.md), `apps/studio/src/components/TreeViewShell.test.tsx`: **“only the exact organic-pose-to-pose gate grows local registered poses over the retained real SVG island, with stable Back/Replay sockets”** and **“only the exact organic-island-accretion gate reuses the canonical 50-cell pose fixture … without changing any existing behaviour”** assert the exact-query-only mount over the real composition path with native land plus organic tracks; **“only the exact `r3-lab` value mounts the lab; clean, unknown and near-miss routes fall through byte-identically and no sibling gate moves”** asserts the clean/near-miss retention. |
| 10. **Hosted witness within its browser budget** | `uatc_2693bf5955c1b6add7a8162c` | ~~**Keep.** No lower-tier node opens a DEPLOYED build in a real browser and measures request/decode/frame-pacing against a recorded budget; every suite above runs offline under jsdom or node against source. Structurally unwitnessable by the capability tier, so it stays deliberately UNBOUND and fails closed (ADR-0097 §2 — minting a gate with no persisted artifact to witness would be the rubber stamp).~~ **DELETED 2026-09-24 by ADR-0608 — the subject is gone, not proven elsewhere.** The leg measured the deployed exact-query organic-growth witness: the flat planted composition, its PixelLab tracks and its `?organicGrowth=*` / `?semanticGrowth=demo` routes. ADR-0608 D2 retires that flat picture and D3 deletes its code and the acceptance journeys that asserted it, as engineering follow-through (ADR-0605). No lower-tier node is named because naming one would be a false citation (the ADR-0348 D6 / leg 11 precedent for a withdrawn subject). The ordinal is BURNED, not reused. The leg carried no `(detail:)` pointer, so no `uat-criterion` artifact is orphaned. |
| 11. **The composition earns the owner-held LOOK verdict** | `uatc_ea05f4b2c024e6500cd143fd` | ~~**Keep, untouched — not this increment's to move.** This is an ADR-0294 D3 appearance verdict, owned by the D3 increment (chip `task_99f7e0a9`), which relocates such legs to the capability whose look it is. Deleting or relocating it here would pre-empt that adjudication.~~ **DELETED 2026-08-11 by ADR-0348 D6 — the reservation is RETIRED, and that chip's claim on this leg is discharged.** The reservation was right at the time: the adjudication had not happened, so deleting or relocating would have pre-empted it. **ADR-0348 D6 IS that adjudication.** It went the other way — the owner ruled that a user EXPERIENCE property is not a user ACCEPTANCE criterion at all, so the disposition changed from relocate-to-capability to DELETE, and chip `task_99f7e0a9` has nothing left to move here. ADR-0294 D3 still governs where an appearance verdict lives WHEN one is worth carrying; it is the "every one of them must be relocated" reading that is withdrawn. The design intent is carried in "The planted-scene LOOK" below. |

## Reliability Gates

Gates are POSITIONAL (`reliabilityGateId` mints `app-surface#gate-<n>` from position), so gates 3–7,
whose capabilities retired with the flat picture on 2026-09-24 (ADR-0608), stay in place, covering
nothing, rather than being deleted and re-pointing gates 1–2 (`asset:edit-story-uat-criteria`).

1. **The shared world-view suite is green** _(gate: observe)_
   _(covers: app-surface-world-view)_
   `pnpm --filter @storytree/app-surface test`.
2. **The Studio adoption suite is green** _(gate: observe)_
   _(covers: studio-app-surface-adapter)_
   `pnpm --filter studio test`.
3. **Retired — was the semantic-growth replay suite (ADR-0608)** _(gate: observe)_
   `pnpm --filter @storytree/app-surface test`.
4. **Retired — was the semantic-demo host suite (ADR-0608)** _(gate: observe)_
   `pnpm --filter studio test`.
5. **Retired — was the app-native SVG island growth suite (ADR-0608)** _(gate: observe)_
   `pnpm --filter @storytree/app-surface test`.
6. **Retired — was the registered organic-track suite (ADR-0608)** _(gate: observe)_
   `pnpm --filter @storytree/app-surface test`.
7. **Retired — was the corrected real-consumer witness suite (ADR-0608)** _(gate: observe)_
   `pnpm --filter studio test`.

`healthy` remains derived from signed evidence; authored status stays `proposed`.
