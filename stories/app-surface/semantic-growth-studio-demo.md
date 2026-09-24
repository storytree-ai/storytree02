---
id: "semantic-growth-studio-demo"
tier: capability
story: app-surface
arc: chapter2-real-app-surface-arc
title: "A query-gated Studio demo stages the semantic-growth witness"
outcome: "An explicit `?semanticGrowth=demo` Studio flag mounts the public semantic-growth view over one five-frame fixture composed through Studio's real world geometry, substrate, parcels, vegetation and representative framing; its primary selection reuses the existing drawn route lanes while the clean Studio route remains unchanged."
status: retired
proof_mode: integration-test
depends_on: [semantic-growth-replay-view]
decisions: [237, 93, 213, 215, 230, 70]
# EDITS-EXISTING correction after human UAT-4 failed at 9377e897: the hosted fixture hand-writes a
# four-point coast with empty relaxed substrate/decor/plants and is framed by the player's 100x100
# close-up. AUTHOR_TEST rejects that basic/zoomed fixture before IMPLEMENT reuses TreeView's existing
# composition path. No other Studio surface moves.
# PROOF-PRESERVATION WALL: AUTHOR_TEST extends the full pre-attempt semantic-growth describe block.
# Deleting/replacing/weakening/skipping/narrowing/consolidating any existing test/assertion is red.
# COMPOSITION-RED FLOOR: one additive executable proof must discriminate every named real composition
# source/rendered requirement; a parcel-only green is invalid even when the command exits zero.
# ANCHORED-MOTION HOST RED after owner UAT-4 FAIL at ffcdc24: the retained integration walk must prove
# stable composed anchors and localized in-world deltas; whole-scene/whole-group lateral slide is red.
# SVG TRANSFORM FLOOR: transform-attribute snapshots alone are insufficient; source/computed proof
# must reject full CSS `transform:` replacement on mapped elements and prove additive scale/origin/
# stagger or the existing `.pop-motion-inner` composition that preserves outer placement.
# AUTHORED-CHOREOGRAPHY HOST RED after the owner's continued UAT-4 FAIL following c87382ba: exact
# `.pop-motion-inner` placement preservation and additive scale are necessary but not sufficient.
# The host rejects one generic whole-object pop across terrain/tree/flora/plate/parcels and witnesses
# distinct, ordered terrain-formation and identity-growth staging with honest reduced motion.
# FINAL-REPLAY HOST FLOOR after real-ms1ss9ig: AUTHOR_TEST resolves the shared CSS for both Vector
# inner hooks and Storybook direct-image hooks, enforces the exact role/property/timing/per-item/
# one-shot-per-role choreography, and separately rejects any arrival outside its exact entering frame.
# REAL-GATE SOURCE SEAM: TreeViewShell.test.tsx authors the executable red and SemanticGrowthDemo.tsx
# is the existing fixture-only source seam; shared app-surface CSS/SceneView remain read-only proof.
# HOST-FIXTURE COMPANION RED after real-ms20x9fz: `VEGETATION = {}` is valid vocabulary presence and
# `heroTrees` must stay absent. Before dependency CSS audits, a fixed second pipeline-composed
# no-parcel territory must render procedural tree AND garden-flora hooks in Vector and Storybook.
# THREE-PART AUTHOR_TEST COMPLETION after real-ms22cssp: before IMPLEMENT, the existing TreeViewShell
# semantic-growth describe span must add H host-companion, D full resolved choreography and E separate
# exact-frame selector cases. H-only and dependency-CSS-only proof are both invalid.
# INVARIANT-COMPANION FLOOR after real-ms238m2t: H walks all five keys plus Back/Replay in Vector and
# Storybook and proves one unchanged companion identity/hook set throughout. Global land stripping
# that removes the companion is red; only primary-id-scoped identity stripping is authorized.
# FIVE-STEP WALK, RE-SPECIFIED AND RE-SIGNED (ADR-0536, resting on ADR-0529): the fixture holds
# `empty -> land -> proposed -> claimed -> healthy`. ADR-0529 retired the verdict bloom and ADR-0536
# dropped the `signed-proof` frame with it — no replacement marker (option B declined), and step five
# does NOT inherit healthy's answer early (option C declined). The criteria that named the bloom are
# REWRITTEN, never deleted (ADR-0536 D5).
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

# A query-gated Studio demo stages the semantic-growth witness

> **RETIRED 2026-09-24 under ADR-0608.** The flat forest picture this capability painted is retired;
> the mounted 3D land is the forest. Its code and tests were deleted, and everything below is history.

**Outcome —** An explicit `?semanticGrowth=demo` Studio flag mounts the public semantic-growth view
over one five-frame fixture composed through Studio's real world geometry, substrate, parcels,
vegetation and representative framing while the clean Studio route remains unchanged.

> **RE-SPECIFIED 2026-09-07 under ADR-0536 (which rests on ADR-0529).** This capability staged a
> SIX-frame fixture. The fifth frame, `signed-proof`, carried the proposition *a signed verdict has
> landed here and the story is still only marked proposed — proof and authored status are different
> things*, and the only thing on screen that said it was the verdict bloom, which ADR-0529 retired.
> ADR-0536 decided the frame is DROPPED rather than replaced: no substitute marker is built (D1), and
> the fifth step does not show the green early (D2, because it would then render identically to
> `healthy` and read as a bug rather than a distinction). The proposition survives in the legend's
> proof row and in story prose (D3), not in an animation frame with nothing to draw. Every criterion
> below that named the bloom is REWRITTEN to keep discriminating the same defect class against the
> five-step walk (D5) — none is deleted.

## Proof walkthrough first

Extend the existing `TreeViewShell` integration proof:

1. render clean Studio with no `semanticGrowth` query key;
2. assert the ordinary shared world remains mounted and no semantic-growth demo/controls exist;
3. render `?semanticGrowth=demo#/tree`;
4. assert the fixture was composed by the same `buildWorld -> buildRelaxedCells -> worldToScene ->
   buildScene` path as the real map, over a deterministic representative story with multiple
   capabilities and Studio's valid permanent vegetation presence input; assert a generated organic
   coast, non-empty relaxed substrate, capability parcels and parcel vegetation are present, and
   reject the current hand-authored four-point coast plus empty
   `relaxedCells`/`decor`/`plants`;
5. assert the bounded public `SemanticGrowthWorldView` is mounted over exactly the primary story's
   `empty → land → proposed → claimed → healthy` at one normal representative
   contain framing, with the whole island and its breathing room visible and controls clickable;
6. walk all five frames with Next, assert the primary story's exact semantic markers and stable
   composed coordinates:
   terrain reveals/grows in place, flora/tree scale from planted/root anchors with the existing brief
   overshoot/stagger, and claim enters locally then orbits;
   reject lateral translation of the whole scene, terrain/island or complete asset/flora group, then
   operate Back and Replay and compare the same settled transforms. Source-discriminate that no
   semantic-growth arrival/pulse keyframe sets full CSS `transform:` on a mapper-positioned SVG
   element: unchanged `transform="translate(...)"` attributes are insufficient because CSS
   `transform: scale(...)` still overrides visual placement during animation. Require additive
   individual `scale:` with fill-box, ground/root origin and stagger, or the existing
   `.pop-motion-inner` composition that leaves the outer placement transform effective throughout;
7. before reading dependency CSS, add an independent host-fixture red against the exact query-gated
   proposed frame. Keep `VEGETATION: SceneVegetationInput = {}` as valid vocabulary presence and do
   not supply `heroTrees`, which would replace procedural `story-tree`. Compose a deterministic
   second companion territory through the existing `buildWorld -> buildRelaxedCells -> worldToScene
   -> buildScene` path. Deterministically filter only that companion owner's real composed relaxed
   cells so it takes `buildTerritoryFlora`'s real no-parcel path; never hand-author cells or geometry,
   and preserve every primary owner cell, coast, substrate, parcel and parcel-flora. The companion
   stays fixed across all five frames as witness context, never narrative state. In explicit
   Vector/null, require companion-scoped `.story-tree .pop-motion-inner` and
   `.garden-flora .pop-motion-inner`; with a Storybook sheet covering tree and flora, require
   companion-scoped direct `image.story-tree` and `image.garden-flora`. `.parcel-flora`, unscoped DOM,
   selector literals, comments or regex-only source matches cannot substitute. Executable source
   proof must establish the real pipeline calls, owner-cell filter and absence of custom
   `SceneInput`/hand geometry before dependency CSS assertions may count. In both renderer modes, H
   must walk `empty`, `land`, `proposed`, `claimed`, `healthy`, then Back and Replay,
   and compare the same companion territory id/status/geometry plus its renderer-appropriate
   tree/flora hook set at every stop. In the same walk, primary empty has no primary land or identity;
   primary land has its real ground but no primary tree/plate/flora identity; and proposed, claimed
   and healthy retain their exact primary semantics — claimed adds presence without any proof
   identity, and only healthy carries the proven-green status. A global
   `stripKind(..., 'territory')` land path is red because it removes both identities. IMPLEMENT may
   replace it only with source-local primary-id-scoped identity stripping; shared renderer/motion
   remains untouched;
8. source-audit the exact existing `.pop-motion-inner` seam as a placement-preservation floor, with
   no second wrapper, full CSS `transform:` replacement or lateral entry. Then fail while
   terrain/tree/flora/plate/parcels merely alias one `arrive-pop`/whole-object scale. Require rendered
   role hooks and shared source/CSS timing to show land locally forming/revealing coast/substrate,
   followed in proposed by ground-contact tree/flora growth before plate and capability parcels
   resolve in a restrained local stagger. At least two identity subroles use materially distinct
   existing reveal/timing treatments (for example grounded scale versus local opacity, mask or clip);
   selector aliases, class names alone and numeric scale changes alone are red. Claim remains local
   with mapper orbit, and every transition settles one-shot.
   In that executable case, discover planted, plate, parcel-boundary and parcel-flora selectors
   independently from rendered hooks and resolve shorthand plus precedence-winning longhands into
   name/duration/easing/delay/iteration/fill, then canonicalize the referenced keyframes by property
   and offset. Prove CSS participation—not DOM existence—for Vector tree/flora
   `.pop-motion-inner` and Storybook direct `image.story-tree`/`image.garden-flora`. Require planted
   tree/flora first; parcel boundary at least 100 ms later; earliest parcel flora at least 60 ms
   after boundary with at least two deterministic per-item offsets; and plate at least 180 ms after
   planted. Prove anchored planted scale/opacity, rooted parcel-flora scale/opacity, parcel-boundary
   opacity/reveal with no scale, and plate opacity plus vertical-only individual `translate:` with
   no scale; directly compare plate/planted and ungrouped parcel-boundary/parcel-flora keyframe
   bodies, with at least one pair differing in property set. Resolve EVERY arrival profile's
   iteration to exactly `1` from shorthand/longhand precedence and prove each one's terminal rest
   state. *(ADR-0536 D5 REWRITE of the rule that the verdict bloom's pulse run exactly once: the
   bloom is deleted, but the property it protected — that a motion announcing a state SETTLES, so the
   viewer is left looking at the state rather than at a decoration still moving — now binds every
   role that announces. Narrowing it to the one deleted role would have made a vanished criterion;
   widening it keeps the same defect refutable, and in more places. The mapper-owned orbit is exempt
   by kind: a continuous presence cue, not an arrival.)*;
9. add a separate executable shared-CSS selector audit: full-motion terrain arrivals match only
   exact frame `land`; tree/flora/plate/parcel-boundary/parcel-flora only `proposed`; and wisp only
   `claimed`. Enumerate the sheet's actual arrival selectors and require the SET of entering frames
   they name to be exactly `{land, proposed, claimed}` — so no role arrives after `claimed`, and
   `healthy` is a change of status over an already-complete scene rather than a sixth thing
   appearing. Reject generic
   `[data-semantic-growth-frame][data-motion='full']` arrival selectors, accumulated terrain/identity
   arrivals on claimed/healthy, claim arrival on healthy, every healthy
   arrival, a sixth entering frame under any name, and any reduced-motion arrival or delayed
   concealment. *(ADR-0536 D5 REWRITE of the rule that the bloom appear on the fifth frame and on no
   other. Stated as set equality rather than a per-role list on purpose: striking the bloom's row
   from a list leaves every remaining row true while silently discarding the claim that the walk's
   arrivals STOP at `claimed` — which is the five-step walk's strongest statement, and precisely what
   a careless deletion loses. A sixth entering frame reappearing under any name fails this audit,
   which is what keeps ADR-0536 D1's declined replacement marker from arriving without a fresh
   decision.)* Before IMPLEMENT, AUTHOR_TEST must
   add independent H (step 7), D (step 8) and E (this step) cases inside the existing
   `TreeViewShell.test.tsx` semantic-growth describe span. H reads/renders the exact
   `SemanticGrowthDemo.tsx` host; D/E read the shared CSS/`SceneView.tsx` dependencies as read-only
   inputs. H alone is invalid, and D/E without H are equally invalid;
10. repeat the trace under reduced motion and assert the same final static transforms appear
   immediately without slide, travel, orbit, delayed concealment or changed framing;
11. repeat that full walkthrough with Studio's resolved Storybook default and
   `?semanticGrowth=demo&artStyle=vector#/tree`, asserting the host passes the existing sheet/null
   fallback rather than resolving or drawing art itself.
12. source-audit the retained pre-attempt semantic-growth describe block and fail unless its
   independent executable tests/assertions remain intact: clean and unknown query isolation; exactly
   one public player plus navigation; claimed carrying presence without any proof identity and
   final-only healthy; land with no story marker; and the bounded `.tree-layout > .world-frame` host.

> **The attempt history below is preserved VERBATIM as history, and its bloom clauses are not
> re-specifications.** Several entries record what a REJECTED run asserted or failed to assert about
> the verdict bloom — "accepted three bloom repetitions", "bloom only by `not infinite`", "a
> bloom-only one-shot red". Those are true statements about what happened, so they are not edited:
> rewriting a record of a past run to match today's spec would falsify the history that explains why
> the floors above are shaped as they are. What has changed is the SPEC, above (ADR-0536), not this
> record. Read any bloom named here as a thing that existed at the time of that run and was retired
> by ADR-0529 on 2026-09-06.

Human UAT-4 failed the implementation at `9377e897`: the demo's hard-coded
`M 14 22 L 86 22 L 78 78 L 22 78 Z` coast, empty relaxed substrate/decor/plants and 100x100 framing
made the island look basic and over-zoomed, while broad whole-scene swaps did not read as in-game
animation. This remains one isolatable correction after `semantic-growth-replay-view`: extend the
existing flagged integration test, amend the existing static fixture and keep the clean path as the
regression observable.
The first attempted correction is invalid proof: it replaced 195 lines of the existing
`TreeViewShell` semantic-growth integration coverage with a 22-line parcel-only test. The full prior
describe block must be restored before the composition red is added; a passing command cannot make
deleted proof valid.
Owner UAT-4 then failed at `ffcdc24`: the real composition was better, but whole asset groups sliding
into place still looked cheap. The host correction is limited to proving the shared surface now grows
and reveals at stable in-world anchors; Studio still owns no animation implementation.
The following real-proof candidate showed the source of the remaining slide: full CSS
`transform: scale(...)` temporarily replaced mapper-authored SVG translation while the DOM attribute
stayed unchanged. The host proof must therefore inspect property composition, not only attributes.
After the valid outer/inner split at `c87382ba`, placement-safe additive scaling still did not prove
an authored in-game sequence. The owner kept UAT-4 red after the framing and lateral placement
corrections, asking for a fresh session to do the space justice. The host red now treats the existing
inner seam as a placement floor, not a visual verdict: terrain formation and identity growth are
distinct staged events, and tree/flora/plate/parcels cannot all be one generic whole-object pop. It
adds no seam or motion system.
The run `real-ms1wbkzb` from contract `b07f3eca` stopped fail-closed at AUTHOR_TEST after exhausting
the maximum 48 turns while feedback proof remained green. No slices ran, no verdict was produced and
no candidate was promoted. The available output identifies no defect, so this history records none.
The run `real-ms1yihh5` from contract `4ede131` reached AUTHOR_TEST success after 40 turns following
red attempts, but feedback ended green and the spine failed closed at CONFIRM_RED; no verdict or
candidate was produced. The then-authored follow-up incorrectly treated
`const VEGETATION: SceneVegetationInput = {}` as empty vocabulary; authoritative code inspection now
corrects that premise because presence enables the vocabulary and optional `heroTrees` replaces the
procedural tree. The missing host observable is the real no-parcel companion path described below.
The run `real-ms1z7wip` from contract `658d724` stopped fail-closed at AUTHOR_TEST after exhausting
the maximum 48 turns. No slices ran, no verdict was produced and no candidate was promoted. The
available output identifies no defect, so this history records none.
The run `real-ms1zlk5a` from contract `7d7f99d` completed AUTHOR_TEST after 55 turns, passed a valid
CONFIRM_RED and entered IMPLEMENT, which exhausted its maximum 72 turns. No verdict was produced and
no candidate was promoted. The scope wall reported `AUTHOR_TEST:debug-scratch.txt`; the available
output supports no further inference, so this history records none.
The signed candidate `real-ms20x9fz` at `15f1436` is rejected and unmerged against that incorrect
prior contract. It bypassed the impossible non-empty-input demand with a comment-only `{}` and weak
regex while adding a companion territory and owner-cell filter. The companion direction is retained,
but proof must semantically establish the real no-parcel pipeline path and companion-scoped Vector
and Storybook DOM while preserving primary geometry and semantics; comments/regex cannot pass.
The signed candidate `real-ms22cssp` at `eb85653` is rejected and unmerged. Its companion
implementation/test aligns with the corrected host semantics—fixed real-pipeline companion, intact
primary parcel flora, and companion-scoped Vector/Storybook DOM—but AUTHOR_TEST added only H. It
omitted executable D resolver/referenced-keyframe/property/timing/per-item/exact-one-bloom assertions
and the independent E exact-frame/no-accumulated/healthy/reduced selector audit. H-only is incomplete.
The signed candidate `real-ms238m2t` at `742e143` is rejected and unmerged. H, D and E are present
and D/E appear complete; its fixed real-pipeline companion, preserved primary parcel flora and scoped
Vector/Storybook DOM follow the intended direction. But empty preserves the companion by stripping
only the primary story, while land calls global `stripKind(..., 'territory')` and removes both primary
and companion identities. H checks only proposed despite claiming byte-stability from the first
frame, so it misses that invariant breach. The correction makes H prove every frame and navigation.

## Guidance

- Use the exact query gate `semanticGrowth=demo`. Absence, an empty value or any unknown value mounts
  no demo and follows the current clean Studio path byte-for-byte.
- Treat the full pre-attempt semantic-growth describe block in `TreeViewShell.test.tsx` as a
  preservation floor. AUTHOR_TEST extends it in place and retains independent tests and
  discriminating assertions for clean/unknown query isolation, one public player/navigation,
  claimed carrying presence without any proof identity and final-only healthy, primary land without a
  primary story marker, and the bounded `.tree-layout > .world-frame` host. Deleting, replacing,
  weakening, skipping, narrowing or consolidating any of that proof is red even when the focused
  command passes.
- Extend the current `describe` span whose title begins “semantic-growth studio demo
  (`?semanticGrowth=demo`)” in `apps/studio/src/components/TreeViewShell.test.tsx` with three
  independent executable additions before IMPLEMENT: **H**, the exact-host companion render/source
  case over
  `apps/studio/src/components/SemanticGrowthDemo.tsx`; **D**, the complete shared-CSS
  resolved-profile/keyframe/property/timing/renderer/one-shot audit; and **E**, a separate exact-frame
  selector audit. D and E read `packages/app-surface/src/semantic-growth.css` plus
  `packages/app-surface/src/SceneView.tsx` as read-only dependencies. Adding H alone, as
  `real-ms22cssp` did, is invalid; adding only already-green dependency audits is also invalid.
- Mount the public `SemanticGrowthWorldView`; never copy its player, controls, semantic keys, motion
  rules or reduced-motion handling into Studio.
- Give the demo a bounded in-map host: it may size within the available forest frame but may not
  expand the page, clip/cover its navigation or place Back/Next/Replay behind the SVG. All three
  controls remain visible and clickable throughout the five-frame walk.
- Supply one deterministic, static representative fixture with exactly five
  `WorldPresentationModel` frames — `empty`, `land`, `proposed`, `claimed`, `healthy` (ADR-0536). A
  sixth frame under any name needs a fresh decision, not this one: ADR-0536 D1 declined a
  replacement marker on the merits available today and named the route back as a new decision owing
  a rendered ladder and a picture BEFORE it is signed. It exists only to stage UAT and performs no fetch, store read,
  subscription, mutation, clock-driven advance or Chapter 2 narration/pacing.
- Compose the fixture through the existing Studio path: deterministic representative story and
  capability data enter `buildWorld`, its real draw tiles enter `buildRelaxedCells`, and
  `worldToScene` receives the same permanent vegetation input before `buildScene`. Reuse the resulting
  coast paths, relaxed substrate, capability parcels, parcel flora and standing vegetation across
  the five frames. Do not hand-author `SceneInput`, a coast path, centroid/tree positions,
  `relaxedCells`, `drawTiles`, `decor` or `plants`; do not maintain a demo-only geometry builder.
  The sole allowed filtering is deterministic removal of real `buildRelaxedCells` output owned by
  the fixed companion territory to exercise the renderer's existing no-parcel path; it must retain
  every primary-owned cell and never synthesize a replacement.
- From that same composed world's real trail network, supply each selected primary frame's existing
  `WorldPresentationModel.neighbours`, `lanes` and `laneMotion: 'draw'`: derive the primary's
  one-hop plan with the existing neighbour-plan helper and its route layout with the existing
  lane-layout helper, never a demo-local path, segment renderer or CSS animation. The selected
  primary's real routes therefore reach shared `SceneView` as `litRouteLanes` and render the
  existing `.trail-lane.is-drawing` treatment; frames without a primary selection carry no invented
  lane. The fixture owns only this model input, not route drawing or motion.
- Add one fail-closed composition red in addition to the retained tests. Its executable/source
  assertions must cover every part of the composition boundary together: real source calls
  `buildWorld`, `buildRelaxedCells`, `worldToScene` and `buildScene`; source has no custom
  `SceneInput`, `COAST`, or hand-filled empty `relaxedCells`/`decor`/`plants`; the rendered proposed
  frame contains non-empty relaxed substrate, multiple capability parcels, parcel flora/permanent
  vegetation; and the public player receives stable composed framing other than `0 0 100 100`.
  Inspect actual imports/calls, source literals and rendered selectors/attributes. Comments or prose
  matches do not count, and a parcel-only assertion is invalid.
- Before any read-only app-surface CSS audit, add an independent executable host-fixture case.
  `SceneVegetationInput` is a presence flag whose only field is optional `heroTrees`; therefore
  `VEGETATION = {}` is the required valid permanent-vocabulary value here. Do not supply
  `heroTrees`: it replaces procedural story trees rather than adding garden flora. The primary
  parcels-present territory intentionally renders parcel flora instead of capability plants, so add
  one deterministic companion territory through the existing `buildWorld`, `buildRelaxedCells`,
  `worldToScene` and `buildScene` pipeline. Filter only real relaxed cells owned by that companion so
  the real no-parcel `buildTerritoryFlora` path emits its procedural `story-tree` and capability
  `garden-flora`; never manufacture cells, `SceneInput` or geometry. Preserve all primary owner cells,
  coast, substrate, parcels and parcel flora. Keep the companion's identity/status/geometry fixed
  across every semantic frame as witness context; only the primary story follows the five-state
  narrative.
- Mount the exact demo with explicit Vector/null, walk all five keys plus Back/Replay, and at every
  stop semantically assert the same companion territory identity/status/geometry with scoped
  `.story-tree .pop-motion-inner` and `.garden-flora .pop-motion-inner`. Repeat the complete trace
  with a deterministic Storybook sheet covering both roles and require the same companion identity
  with scoped direct `image.story-tree` plus `image.garden-flora`. Compare companion snapshots across
  the trace; a proposed-only check cannot pass. `.parcel-flora`, CSS rules for an absent role,
  unscoped DOM, comments or regex-only source checks cannot substitute.
- In the same H walk, assert primary empty has no primary ground or identity; primary land has its
  real ground but no primary tree/plate/flora identity; proposed adds that non-healthy identity;
  claimed adds presence without any proof identity; and only primary
  healthy is healthy. Source proof must establish real pipeline calls and deterministic owner
  filtering while rejecting hand-authored cells/geometry. A global
  `stripKind(..., 'territory')` for land is red. IMPLEMENT may only use source-local, primary-id-scoped
  identity stripping so the companion survives, alongside the existing fixture companion/filter;
  it may not change app-surface motion/source, `SceneView`, renderer/art policy, assets or production
  inputs. The later D/E dependency CSS proofs remain mandatory but cannot satisfy this host red.
- Add an anchored-motion host red to the retained integration walk. Snapshot the composed
  coast/substrate/parcel/standing-object placement transforms, advance, Back and Replay, and prove
  those settled world anchors and the stable non-100 framing do not shift. Assert entering terrain
  reveals/grows in place, flora/tree scale from planted/root anchors with the existing eased
  overshoot/stagger, and claim enters locally and uses its real orbit. A whole-scene,
  whole-terrain/island or complete asset/flora lateral slide is red.
- Do not accept equal SVG `transform` attributes as sufficient anchor proof. The executable test must
  inspect the shared semantic-growth CSS/source (without widening the declared write globs) and reject
  full `transform:` declarations in arrival selectors or keyframes applied to positioned
  terrain, flora/tree or claim elements. It must positively find additive individual `scale:`
  with `transform-box: fill-box`, an appropriate ground/root origin and the intended layer stagger,
  or verify the existing `.pop-motion-inner` composition keeps outer mapped placement effective
  throughout computed animation. The claim entrance remains localized under the same rule.
- Preserve the exact already-landed `.pop-motion-inner` as the host's placement-safe seam. Assert
  executable `SceneView` output and shared CSS target that exact class; reject a class mismatch,
  comments-only match, another wrapper, full CSS `transform:` replacement or lateral entry. That
  seam and additive scale do not finish the proof. Fail if terrain, tree/flora, plate and parcels use
  one selector/keyframe/timing profile as their sole whole-object treatment. Prove land locally
  forms/reveals coast/substrate, then proposed grows planted tree/flora from ground contact before
  plate/parcels resolve with ordered nonzero local offsets. At least two identity subroles use
  materially distinct existing role-scoped scale, opacity, mask/clip reveal or transform idioms.
  Claim stays local with mapper orbit; all motion settles one-shot.
  Reduced mode removes timing, concealment and orbit and renders the same final role semantics and
  outer placement transforms immediately.
- Make that choreography assertion CSS-resolved and renderer-complete. From independently rendered
  Studio role hooks, build `resolvedProfile(selector)` over the shared app-surface stylesheet:
  parse animation shorthand positional tokens and every longhand with longhand precedence; resolve
  name, duration, easing, delay, iteration and fill; load that name's actual comment-free
  `@keyframes`; and canonicalize declarations by offset. Selector declarations, animation names,
  DOM existence, delays or numeric scale endpoints alone are insufficient. CSS resolution must
  succeed for Vector tree/flora `.pop-motion-inner` and Storybook direct
  `image.story-tree`/`image.garden-flora` hooks. Compare plate versus planted and directly compare
  ungrouped parcel-boundary versus parcel-flora canonical bodies; both pairs are non-equivalent and
  at least one differs in keyframed property set. Planted tree/flora starts first; parcel boundary
  starts at least 100 ms later; earliest parcel flora starts at least 60 ms after boundary with at
  least two deterministic per-item `:nth-*` or custom offsets; plate starts at least 180 ms after
  planted. Planted growth is anchored scale plus opacity; parcel flora is rooted scale plus opacity;
  parcel boundary is opacity/reveal with no scale; plate is opacity plus vertical-only individual
  `translate:` with no scale. EVERY arrival profile resolves from shorthand/longhand precedence to
  iteration exactly `1`, finite fill and an explicit terminal rest state — the ADR-0536 D5 rewrite of
  the bloom's one-shot pulse rule, re-aimed from the deleted role onto every role that announces.
  Full `transform:`, lateral translation, a
  new wrapper, `SceneView` change or second renderer remains red.
- Add a separate executable selector audit over that same shared CSS. Each full-motion arrival must
  be qualified by exactly one entering frame: terrain=`land`; tree/flora/plate/parcel-boundary/
  parcel-flora=`proposed`; wisp=`claimed`. The SET of entering frames the sheet's arrival selectors
  name is exactly `{land, proposed, claimed}` — nothing arrives after `claimed`. Generic
  `[data-semantic-growth-frame][data-motion='full']` arrival targeting is red. Terrain/identity
  arrivals cannot match claimed or healthy; the claim cannot arrive on
  healthy; nothing arrives on healthy; and no sixth entering frame appears under any name. Reduced
  mode renders every
  accumulated role immediately without arrival, orbit or delayed concealment.
- Keep the real gate on the existing Studio seam:
  `apps/studio/src/components/TreeViewShell.test.tsx` authors the executable integration/source
  proof and `apps/studio/src/components/SemanticGrowthDemo.tsx` remains the fixture implementation
  source. The test may read `packages/app-surface/src/semantic-growth.css` and
  `packages/app-surface/src/SceneView.tsx` as read-only dependency evidence; neither enters the
  Studio gate's write scope. Do not move shared motion into Studio to make the host proof green.
- Derive one stable representative contain framing from that composed world's real bounds through
  the same world-framing vocabulary TreeView uses. Keep the full coast, substrate, parcel vegetation
  and standing objects visible with ordinary breathing room at every state. Do not pass a magic
  100x100 viewBox, crop to the tree/plate, or zoom independently per frame.
- Derive exactly these semantic deltas for the primary story from that one composition: empty, then
  land with the real coast/substrate but no primary story marker, then the pale proposed/non-healthy
  primary story with its real parcels and vegetation, then its real claim/presence wisp without proof
  identity, then healthy status. A claim never carries any proof identity — the proven-green status
  hue is what it must not reach — and no pre-final primary frame may appear healthy. There is no
  sixth delta: ADR-0536 dropped the `signed-proof` frame with the bloom that was its only content,
  and step five does NOT inherit healthy's answer early (option C declined, because the two frames
  would then render identically and read as a bug rather than as a distinction). The companion territory remains byte-stable witness context through every
  frame and never participates in claim, proof or health narration.
- Mark only the entering delta with the shared player's existing renderer/art and SVG/code-native
  motion vocabulary. Back and Replay reapply the
  same restrained trace. Terrain formation, planted identity growth, plate/parcel resolution and the
  claim must remain semantically distinct rather than aliases to one pop. The demo owns no transform,
  keyframe or animation selector and never
  remounts a parallel scene player.
- Reuse TreeView's already-resolved `spriteSheet` and `artScale`: clean/default remains the
  owner-attested Storybook sheet; explicit `?artStyle=vector`, unknown style and uncovered kind use
  the existing fallback path. The demo owns no manifest request, resolver, asset or art policy.
- Keep the mount inside the existing forest/map host and visibly dedicated to the fixture. Do not
  extract or alter legend, inspector, chat, camera, chrome, layout or live controller behaviour.
- This is a witness stage, not a product controller. Do not add website code, Chapter 2 sequencing,
  artifact sync, production art, generated frame/sprite assets, a Nanobanana or
  sprite-frame/frame-sequence pipeline, a second renderer, a product-art fork, animation frames or a
  permanent navigation entry.

## Machine contracts

**Proof-preservation wall — applies before any numbered contract may pass.** Machine proof
source-audits the pre-attempt semantic-growth describe block in
`apps/studio/src/components/TreeViewShell.test.tsx`. It fails if any existing test/assertion is
deleted, replaced, weakened, skipped, narrowed, folded into a less discriminating replacement or
consolidated away. It must retain independent executable cases for: clean plus unknown query
isolation; one public five-frame player and navigation; claimed carrying presence without any proof
identity plus final-only healthy; land with no story marker; and `.tree-layout > .world-frame` host
containment. **The preservation wall is not weakened by that re-pointing (ADR-0536 D5/D6):** when a
decision deletes what a retained case watched, the case is RE-AIMED at the surviving subject and the
re-aim is recorded here — it may never be quietly dropped, narrowed to something cheaper, or left
asserting a selector that can no longer match.

**Composition-red floor — applies before IMPLEMENT.** In addition to those retained cases,
AUTHOR_TEST adds executable/source-discriminating assertions for all of the following in one coherent
red: calls to `buildWorld`, `buildRelaxedCells`, `worldToScene` and `buildScene`; absence of a custom
`SceneInput`, `COAST`, and hand-authored empty `relaxedCells`/`decor`/`plants`; rendered proposed-state
evidence of non-empty relaxed substrate, multiple parcels and parcel flora/permanent vegetation; and
stable composed framing that is not `0 0 100 100`. The test inspects real source syntax and rendered
selectors/attributes, never comments/prose. A parcel-only green is invalid.

**Three-part AUTHOR_TEST completion floor — conjunctive before IMPLEMENT.** Inside the existing
`apps/studio/src/components/TreeViewShell.test.tsx` `describe` span whose title begins
“semantic-growth studio demo (`?semanticGrowth=demo`)”, AUTHOR_TEST must add three independent
executable cases: **H**, the companion host render plus executable
`apps/studio/src/components/SemanticGrowthDemo.tsx` pipeline/source proof below; **D**, the full
`resolvedProfile`/referenced-keyframe/both-renderer/property/timing/per-item/one-shot-per-role audit
over read-only shared CSS/`SceneView.tsx`; and **E**, the separate exact-frame/no-accumulated/
healthy/reduced selector audit. All three must exist and execute before CONFIRM_RED/IMPLEMENT: H
supplies the current host-local red, while D/E remain mandatory dependency walls even though shared
CSS is already green. H alone—including `real-ms22cssp`/`eb85653`—is invalid; D/E without H cannot
establish the red. No case may be folded into comments, selector literals or another case's weak
proxy.

**Host-fixture companion renderer red — independent and first.** `SceneVegetationInput` is
presence-sensitive and has only optional `heroTrees`; AUTHOR_TEST accepts and requires
`VEGETATION = {}` here, and rejects adding `heroTrees` because it replaces procedural trees. Before
any dependency CSS audit, source/render proof adds one deterministic companion territory through
`buildWorld`, `buildRelaxedCells`, `worldToScene` and `buildScene`, then filters only real composed
cells owned by that companion so `buildTerritoryFlora` receives no parcel surface for it. No custom
`SceneInput`, cells or geometry may be authored; every primary owner cell, coast, substrate, parcel
and parcel-flora remains. The companion's identity/status/geometry is invariant across all five frames
and carries no narrative state. H walks all five keys plus Back/Replay twice. At every Vector/null
stop it compares the same companion territory identity/status/geometry and companion-scoped
`.story-tree .pop-motion-inner` plus `.garden-flora .pop-motion-inner`; at every Storybook stop it
compares the same companion identity with scoped direct `image.story-tree` plus
`image.garden-flora`. A proposed-only assertion, `.parcel-flora`, unscoped DOM, selector literals,
comments and weak source regex cannot substitute. That same walk proves primary empty has no primary
land/identity, primary land has ground but no primary tree/plate/flora identity, and later primary
semantics remain exact. Global land `stripKind(..., 'territory')` is red. IMPLEMENT may replace it
only with source-local primary-id-scoped identity stripping, alongside the existing-pipeline
companion/filter fixture; shared motion/source, `SceneView`, renderer/art policy and assets remain
unchanged. The authored-choreography and entering-frame dependency CSS reds below stay mandatory but
cannot pass this host-local floor.

**Anchored-motion host red — applies to the `ffcdc24` correction.** The retained integration test
adds executable rendered/source assertions that reject lateral entry translation of the whole
scene, whole terrain/island or complete asset/flora group. It compares settled composed transforms
and framing across forward, Back, Replay and reduced motion, and positively observes in-place terrain
growth, root-anchored flora/tree scale and localized claim entrance/orbit.
Studio contributes no keyframe, generated animation asset, sprite-frame pipeline or renderer.

**SVG transform-composition floor — part of the host red.** The machine proof reads real shared
CSS/source and fails full CSS `transform:` animation on mapper-positioned terrain, flora/tree or
claim elements, including scale-only keyframes. It positively proves additive `scale:` plus
fill-box/root origin/stagger, or the existing `.pop-motion-inner` composition preserving the outer
SVG placement transform for every animation frame. DOM `transform` attribute snapshots alone cannot
pass.

**Authored semantic-choreography host red — additive, no new scope.** The retained test preserves
real `SceneView` emission and CSS targeting of exact `.pop-motion-inner` as a placement floor and
rejects a second wrapper, full CSS `transform:`, lateral entry, class mismatch or comments-only
match. It discovers planted, plate, parcel-boundary and parcel-flora selectors independently
from the rendered Studio hooks and builds `resolvedProfile(selector)` by parsing animation shorthand
and precedence-winning longhands into name/duration/easing/delay/iteration/fill. The resolved
name—not the selector body—loads the actual comment-free `@keyframes`, canonicalized by offset and
property. CSS resolution must succeed for both Vector tree/flora `.pop-motion-inner` and Storybook
direct `image.story-tree`/`image.garden-flora`; DOM existence alone cannot pass. Plate/planted and
directly compared, ungrouped parcel-boundary/parcel-flora bodies are each non-equivalent, with at
least one pair differing in keyframed property set. Planted tree/flora starts first; parcel boundary
starts at least 100 ms later; earliest parcel flora starts at least 60 ms after boundary with at
least two deterministic per-item offsets; plate starts at least 180 ms after planted. Keyframes prove
anchored planted scale/opacity, rooted parcel-flora scale/opacity, no-scale parcel opacity/reveal and
no-scale plate opacity plus vertical-only individual `translate:`. EVERY arrival profile resolves
through shorthand/longhand precedence to iteration exactly `1`, finite fill and a terminal rest state
(the ADR-0536 D5 rewrite of the bloom's one-shot rule, re-aimed onto every role that announces; the
mapper-owned orbit is exempt by kind as a continuous presence cue rather than an arrival).
Claim stays local with mapper orbit; reduced motion immediately exposes identical final semantics
and placement. Names, selector bodies, delays, numeric scale endpoints, generic whole-object scale,
full `transform:`, lateral translation, another wrapper/renderer or a `SceneView` change are red.

**Entering-delta frame-scoping host red — independent, additive, no new scope.** A separate
executable shared-CSS selector audit requires full-motion terrain arrival rules to use exact frame
`land`; planted tree/flora, plate, parcel-boundary and parcel-flora exact `proposed`; wisp exact
`claimed`. Generic
`[data-semantic-growth-frame][data-motion='full']` arrival targeting fails. Terrain/identity arrivals
cannot match claimed or healthy; the claim arrival cannot match healthy; and no arrival runs on
healthy. **The audit is expressed as SET EQUALITY over the sheet's actual arrival selectors: the
entering frames they name are exactly `{land, proposed, claimed}`, no more and no fewer** — so
`claimed` is the last frame that introduces anything and `healthy` is a change of status over an
already-complete scene. *(ADR-0536 D5 rewrite of the rule that the bloom appear on the fifth frame
and on no other. Set equality rather than a per-role list is the point: striking one row from a list
leaves every remaining row true while silently discarding the claim that the walk's arrivals STOP at
`claimed`. It is also what keeps ADR-0536 D1's declined replacement marker from arriving without a
fresh decision.)* Reduced motion has no matching arrival,
orbit or delayed concealment and immediately renders the same accumulated final semantics.

**Existing real-gate source seam — fixture-only.** AUTHOR_TEST edits
`apps/studio/src/components/TreeViewShell.test.tsx`; IMPLEMENT remains bounded to
`apps/studio/src/components/SemanticGrowthDemo.tsx` and the already-declared Studio host source.
Shared `packages/app-surface/src/semantic-growth.css` and
`packages/app-surface/src/SceneView.tsx` are read-only proof inputs, not Studio write seams. Any
Studio-owned animation rule or second renderer fails this floor.

1. **`sgsd-clean-studio-never-mounts-the-demo`**
   - **asserts —** without the exact flag, TreeView mounts its existing shared world and contains no
     semantic-growth fixture or Back/Next/Replay demo controls.
2. **`sgsd-flag-mounts-one-public-five-frame-player`**
   - **asserts —** `?semanticGrowth=demo#/tree` mounts exactly one public
     `SemanticGrowthWorldView` supplied with the exact five ordered keys
     (`empty` / `land` / `proposed` / `claimed` / `healthy`) inside a bounded host, and refuses a
     sixth key under any name;
     it passes one stable representative framing derived from the composed world bounds, the whole
     island remains visible with breathing room, and neither rendered/source framing is the current
     literal `0 0 100 100`; Back/Next/Replay stay visible and clickable; Next walks every frame,
     Back reverses it and Replay returns to empty through that public component.
3. **`sgsd-fixture-is-static-and-semantically-honest`**
   - **asserts —** the fixture source reuses `buildWorld`, `buildRelaxedCells` and `worldToScene`
     and `buildScene` instead of constructing a custom `SceneInput`; executable source assertions
     reject the current four-point `COAST`, empty `relaxedCells`, empty `decor` and empty `plants`
     implementation. Before dependency CSS is read, an independent exact-host case requires valid
     `VEGETATION = {}` with no `heroTrees`, a fixed real-pipeline companion territory, and
     deterministic filtering of only that companion's real composed cells to take the no-parcel path
     without changing primary cells/geometry. H walks all five keys plus Back/Replay in Vector and
     Storybook, comparing one unchanged companion territory identity/status/geometry and its
     renderer-appropriate scoped tree+garden-flora hooks at every stop. A proposed-only check, parcel
     flora, comments, regex-only source matches and unscoped DOM cannot substitute. Global land
     `stripKind(..., 'territory')` is red; only source-local primary-id-scoped identity stripping may
     replace it. Rendered-selector assertions prove primary empty has no primary ground/identity and
     the proposed primary frame has a generated organic
     coast, non-empty relaxed substrate, multiple capability parcels/parcel flora and the permanent
     Studio vegetation vocabulary; a parcel-only assertion cannot pass this contract. Primary land
     retains that real ground but no primary tree/plate/flora identity; primary proposed is
     non-healthy; primary claimed adds real presence without any proof identity — no claim-family
     drawable reaches the island's proven-green status hue; only primary healthy appears last, and it
     is reached by the story's status changing under an already-complete scene rather than by a new
     drawable entering.
     The fixture derives its selected primary's `neighbours` and route `lanes` from that same real
     trail network and supplies `laneMotion: 'draw'`; rendered proof observes the shared
     `litRouteLanes` output with `.trail-lane.is-drawing`, not a fixture-local road or animation.
     Its transition trace is ground-arrival, flora-growth and claim-orbit
     rather than one generic scene-settle animation or whole-group lateral slide; settled world
     anchors remain equal through forward, Back, Replay and reduced motion, and source/computed proof
     rejects full CSS `transform:` replacement while preserving exact `.pop-motion-inner` as the
     placement seam. An executable shared-CSS resolver proves both Vector `.pop-motion-inner` and
     Storybook direct-image tree/flora participation, canonical referenced-keyframe/property
     differences for plate/planted and ungrouped parcel-boundary/parcel-flora, planted→boundary
     `100ms`, boundary→flora `60ms` plus two per-item offsets, planted→plate `180ms`, the exact
     anchored/no-scale role treatments, and EVERY arrival profile resolving to iteration exactly `1`
     and settling at rest. A separate
     selector audit proves terrain arrives only on land; tree/flora/plate/parcels only on proposed;
     claim only on claimed; that the SET of entering frames the sheet's arrival selectors name is
     exactly `{land, proposed, claimed}` so nothing arrives after `claimed`; that no accumulated or
     healthy arrival matches; and that reduced mode is immediate.
     *(Both of those clauses are ADR-0536 D5 REWRITES rather than new scope. The iteration clause was
     the requirement that the verdict bloom's pulse run exactly once; the selector clause was the
     requirement that the bloom appear on the fifth frame and on no other. ADR-0529 deleted their
     subject, so each is re-aimed at the property it was protecting — an announcement that settles,
     and a role that enters at exactly one named frame — over the roles that remain. The selector
     clause is set equality, not a per-role list, because striking the bloom's row from a list leaves
     every remaining row true while losing the claim that the walk's arrivals STOP at `claimed`.)* H, D and E are independent executable additions in the current
     TreeViewShell semantic-growth describe span and all must execute before IMPLEMENT; H-only and
     D/E-only AUTHOR_TEST diffs are invalid. Additive scale/fill-box/root origin may serve an
     appropriate role
     but generic whole-object scale, DOM-only renderer participation, selector-body/name/delay
     assumptions, full `transform:`, class names alone and comments-only matches are insufficient.
     The fixture contains no
     API/store/subscription, mutation, timer advance, generated frame/sprite assets, Nanobanana or
     frame-sequence pipeline, production/product-art fork, second renderer or Chapter 2 controller.
4. **`sgsd-reuses-studio-art-policy-without-a-second-resolver`**
   - **asserts —** the machine proof walks all five frames plus Back/Replay with TreeView's resolved
     Storybook sheet/art scale covering tree and flora, repeats the same trace with explicit Vector
     null/fallback, and observes the same semantic states; the demo imports no manifest loader and
     adds no art.
5. **`sgsd-existing-studio-behaviour-stays-green`**
   - **asserts —** the full Studio suite retains current selection, arrival/replay escape,
     Storybook/Vector fallback, legend, inspector, chat, camera and clean-route behaviour.

The fifth contract is the existing Studio regression wall observed after the new clean/flagged
integration cases green. The visible motion verdict remains the story's operator-held UAT leg.
