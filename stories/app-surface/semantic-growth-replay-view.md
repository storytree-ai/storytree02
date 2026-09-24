---
id: "semantic-growth-replay-view"
tier: capability
story: app-surface
arc: chapter2-real-app-surface-arc
title: "The shared world view plays and replays one honest semantic growth sequence"
outcome: "A public app-surface growth view presents the five supplied world frames at one representative world framing and applies their deltas through the app's existing arrival, growth and claim transforms: land alone emerges slowly and in place from nothing through the shared CSS renderer, while identity arrivals remain separately timed, with deterministic Next, Back, Replay and reduced-motion rendering."
status: retired
proof_mode: integration-test
depends_on: [studio-app-surface-adapter]
decisions: [237, 93, 213, 215, 230, 70]
# EDITS-EXISTING correction after human UAT-4 failed at 9377e897: the player hard-codes a 100x100
# viewBox and semantic-growth.css gives every changed role one generic settle animation. AUTHOR_TEST
# extends the existing focused test to reject that zoomed/slideshow implementation before IMPLEMENT
# reuses the existing app arrival/growth/claim vocabulary. Scope stays on the existing files.
# PROOF-PRESERVATION WALL: AUTHOR_TEST extends the full pre-9377 integration suite in place. Replacing
# it with a narrow framing test, or deleting/weakening/skipping/consolidating any existing assertion,
# is red even when the focused command exits zero.
# TWO-RED FLOOR: before implementation, AUTHOR_TEST adds two independent executable cases: stable
# representative framing AND a semantic-growth.css/source motion discriminator. A framing-only green
# is invalid even when every retained test passes.
# ANCHORED-MOTION RED after owner UAT-4 FAIL at ffcdc24: AUTHOR_TEST adds an independent additive
# CSS/source case rejecting whole-scene/whole-group lateral slides and proving in-place/root-anchored
# growth and localized claim entrance/orbit with stable world anchors.
# SVG TRANSFORM FLOOR: unchanged transform attributes are insufficient. The red rejects CSS
# `transform:` animation on mapper-positioned elements and requires additive `scale:` plus box/origin,
# or the existing `.pop-motion-inner` composition that preserves the outer SVG placement transform.
# AUTHORED-CHOREOGRAPHY RED after the owner's continued UAT-4 FAIL following c87382ba: exact
# `.pop-motion-inner` placement preservation and additive scale are necessary but not sufficient.
# AUTHOR_TEST rejects one generic whole-object pop across terrain/tree/flora/plate/parcels and proves
# distinct, ordered local terrain-formation and identity-growth staging with honest reduced motion.
# COHERENT-BUNDLE FLOOR after real-ms1latuj: a finiteness-only red is invalid. One authored
# choreography case must assert terrain, both art paths, role staging/treatments, claim and
# reduced settlement together before IMPLEMENT may begin.
# VALUE-EQUIVALENCE FLOOR after machine-green/LOOK-red real-ms1m3h10: distinct animation names or
# delays do not prove distinct choreography. AUTHOR_TEST compares keyframed properties/values,
# forbids grouped parcel-boundary/parcel-flora treatment and requires one finite settled
# announcement per arrival role (ADR-0536 D5; was the bloom's one-shot pulse).
# RESOLVED-ANIMATION FLOOR after the stopped post-e6e2be3f run: AUTHOR_TEST resolves shorthand and
# longhands, canonicalizes comment-free keyframe bodies, compares real property/value trajectories,
# and requires iteration-count 1 on every arrival profile plus an honestly settled final state.
# KEYFRAME-RESOLVER FLOOR after the stopped post-a7794537 run: selector declarations are not
# keyframes. Each role is discovered independently, its shorthand/longhands resolve with CSS
# precedence, and its resolved animation name loads the actual canonical @keyframes body.
# ENTERING-DELTA/LOOK FLOOR after real-ms1o35is: machine-green is not owner-presentable while
# accumulated roles reanimate, Storybook snaps, or proposed roles remain near-simultaneous scale
# aliases. Exact frame selectors, both renderer hooks and visibly separated role choreography are red.
# CURRENT-TEST-BYTE-DIFF FLOOR after real-ms1pgtt2 and real-ms1pvz2l: an appended frame-scoping case
# cannot substitute for authored choreography. AUTHOR_TEST must extend the existing `binds the
# studio's real growth vocabulary...` case in place—never replace/delete it—and materially change
# that source span with the whole D resolver/renderer/property/timing bundle before authoring red E.
# D-AND-E COMPLETION FLOOR after real-ms1rkitn: AUTHOR_TEST must contain both the in-place full D case
# and the separate executable exact-frame E case before CONFIRM_RED. D-only and E-only are invalid.
# FIVE-STEP WALK, RE-SPECIFIED AND RE-SIGNED (ADR-0536, resting on ADR-0529): the walk is
# `empty -> land -> proposed -> claimed -> healthy`. ADR-0529 retired the verdict bloom; ADR-0536
# decided the `signed-proof` frame is DROPPED rather than given a replacement marker (option B
# declined) and rather than inheriting healthy's answer early (option C declined). The two criteria
# that named the bloom are REWRITTEN, never deleted (ADR-0536 D5): the one-shot pulse becomes a
# finiteness-and-rest requirement over EVERY surviving arrival profile, and the bloom-only-on-frame-5
# rule becomes exact-frame qualification over the surviving roles with NO arrival after `claimed`.
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

# The shared world view plays and replays one honest semantic growth sequence

> **RETIRED 2026-09-24 under ADR-0608.** The flat forest picture this capability painted is retired;
> the mounted 3D land is the forest. Its code and tests were deleted, and everything below is history.

**Outcome —** A public app-surface growth view presents the five supplied world frames at one
representative world framing and applies their deltas through the app's existing arrival, growth and
claim transforms with deterministic Next, Back, Replay and reduced-motion rendering.

> **RE-SPECIFIED 2026-09-07 under ADR-0536 (which rests on ADR-0529).** This capability described a
> SIX-frame walk whose fifth frame, `signed-proof`, existed to say *a signed verdict has landed here
> and the story is still only marked proposed — proof and authored status are different things*. The
> only thing on screen that said it was the verdict bloom, and ADR-0529 retired the bloom. ADR-0536
> decided the frame is DROPPED, not replaced: no substitute marker is built (option B declined), and
> the fifth step does not show the green early (option C declined, because it would render
> identically to `healthy` and read as a bug rather than a distinction). The proposition itself
> survives and is stated in the legend's proof row and in story prose, not in an animation frame with
> nothing to draw. Every criterion below that named the bloom is REWRITTEN to keep discriminating the
> same defect class against the five-step walk (ADR-0536 D5) — none is deleted.

## Proof walkthrough first

The existing integration test supplies five representative, already-built
`WorldPresentationModel` frames plus one stable representative world framing to the public
semantic-growth view:

1. render `empty`, then advance through `land`, `proposed`, `claimed`, `healthy`;
2. assert the exact fixture semantics: land has ground but no story marker; proposed introduces the
   pale/non-healthy story; claimed adds presence without proof identity; only the final frame is
   healthy, and no pre-final frame carries the proven-green status. There is no sixth frame to
   assert: the walk's proof-versus-status proposition is carried by the legend's proof row and this
   story's prose, not by a frame (ADR-0536 D3);
3. add independent red A: mount inside a bounded host and assert all five frames keep one normal
   contain-style world framing with the representative coast, substrate and standing objects visible
   with breathing room; reject the current literal `viewBox="0 0 100 100"` and any per-frame zoom to
   the newest marker;
4. add independent red B before implementation: read `semantic-growth.css` and, where needed, the
   component source; fail any rule that groups `.hex-territory`, `.world-wisp`/`.world-claim-wisp`
   and `.arrive-island` under one shared settle animation (the retired `semantic-growth-settle`
   shape); then assert `land` is wired to the existing `arrive-ground` profile, `proposed` to
   `arrive-pop` plus its separately named plate/parcel-boundary/parcel-flora profiles, and `claimed`
   to `wisp-in` plus the mapper's built-in orbit. Each surviving role keeps its OWN resolved
   animation name and its own canonical keyframe body; re-grouping any two of them onto one shared
   settle keyframe is red. Named selector/keyframe assertions must discriminate those profiles;
   prose/comments do not count. There is no fifth motion role: `bloom-pulse` and `.world-bloom` were
   deleted with the verdict bloom (ADR-0529 / ADR-0536), so an assertion naming either would name
   nothing and is red rather than vacuously green;
5. add independent anchored-motion red C: inspect executable CSS/source and fail while any transition
   laterally translates the world, scene, complete terrain/island, or complete asset/flora group.
   Assert terrain reveals/grows at its existing world coordinates; flora/tree scale from their
   planted/root anchors with the existing brief eased overshoot/stagger; claim enters locally then
   uses its existing orbit. Compare settled
   static placement transforms before/after, Back and Replay, and source-discriminate the animated
   property itself: a CSS `transform:` in an arrival/pulse selector or keyframe applied to a
   mapper-positioned SVG element is red because it visually replaces `transform="translate(...)"`
   during motion even when the DOM attribute is unchanged. Require additive individual `scale:` with
   `transform-box: fill-box`, the correct ground/root origin and stagger, or the existing
   `.pop-motion-inner` composition whose outer placement remains effective for every animation frame;
6. add one independent authored-choreography red D that asserts the full bundle together: retain
   every pre-9377 case/assertion and extend in place the existing executable case whose
   title begins `binds the studio's real growth vocabulary to the exact already-landed
   .pop-motion-inner seam`; do not replace, delete or leave that case byte-unchanged. Its existing
   source span must materially change to add the full D helper/assertions. In that case, retain
   read-only source proof that `SceneView` emits the exact existing `.pop-motion-inner`
   placement-preservation seam and shared CSS targets it, with no `SceneView` change, second wrapper,
   full CSS `transform:` replacement or lateral entry motion; prove distinct local coast/substrate
   staging; prove both Storybook and Vector renders expose participating tree/flora role hooks; prove
   planted tree/flora resolve before plate/parcels with ordered nonzero offsets; and prove identity
   subrole profiles include at least two visibly, materially non-equivalent treatments. Discover the
   planted, plate, parcel-boundary and parcel-flora selectors independently from rendered role
   hooks—never by first filtering rules animated by `arrive-pop`. For each selector build
   `resolvedProfile(selector)`: parse animation shorthand positional tokens and every animation
   longhand; apply longhand precedence; resolve name, duration, easing, delay, iteration count and
   fill; use that resolved name to load the referenced `@keyframes`; strip comments; and canonicalize
   the actual keyframe body by offsets and property declarations. Selector rule bodies are never a
   substitute. Directly compare canonical keyframe bodies for plate versus planted and parcel
   boundary versus parcel flora; both pairs must be non-equivalent, parcel boundary/flora must also
   not share one grouped selector, and at least one pair must differ in its keyframed property set.
   Names, delays, durations, easing or numeric scale endpoints alone cannot meet that property-set
   discriminator. **Every surviving arrival profile announces itself ONCE and then rests.** For each
   role discovered above — terrain, planted tree/flora, plate, parcel boundary, parcel flora and the
   claim wisp's entrance — resolve iteration from shorthand and longhand with longhand precedence and
   require numeric `=== 1` (default/omitted or literal `1`), rejecting shorthand or longhand `2`, `3`,
   any larger integer and `infinite`; require finite fill plus a terminal keyframe at
   `scale: 1`/`opacity: 1`, or terminal values equal to explicit base-rest values. *(This clause is
   the REWRITE, under ADR-0536 D5, of the requirement that the verdict bloom's `bloom-pulse` run
   exactly once. The bloom is gone, but the property that requirement was really protecting is not:
   a walk whose motion announces a state must SETTLE, so that what the viewer is left looking at is
   the state itself and not a decoration still moving. Narrowing it to the one deleted role would
   have made a vanished criterion; widening it to every surviving role keeps the same defect —
   an unbounded, repeating or never-settling announcement — refutable, and refutable in more places
   than before. The mapper-owned orbit is deliberately EXEMPT: it is a continuous presence cue rather
   than an arrival, and it is separately required to be absent under reduced motion.)* In this same case,
   prove CSS resolves the intended planted profiles for both Vector tree/flora
   `.pop-motion-inner` hooks and Storybook direct `image.story-tree`/`image.garden-flora` hooks from a
   sheet defining both; DOM existence alone is red. Resolve proposed start times and require planted
   tree/flora first, parcel boundary at least 100 ms later, parcel flora at least 60 ms after boundary
   with at least two deterministic per-item `:nth-*` or custom-offset delays, and plate at least
   180 ms after planted. Canonical bodies must preserve anchored tree/flora grow, give parcel flora a
   rooted scale-plus-opacity sprout, give parcel boundary opacity/reveal with no scale, and give plate
   opacity plus vertical-only individual `translate:` settlement with no scale. Full `transform:`,
   lateral translate, a new wrapper or renderer, and any arrival iteration other than exactly one
   remain red. Then prove localized claim, identical reduced-motion semantics and settled placement. Missing
   any operation keeps D invalid regardless of whether the command is red or green;
7. add independent entering-delta frame-scoping red E: parse executable CSS selectors and require
   terrain arrivals only under exact `[data-semantic-growth-frame='land'][data-motion='full']`;
   tree/flora/plate/parcel-boundary/parcel-flora only under exact frame `proposed`; and wisp only
   under exact frame `claimed`. A generic `[data-semantic-growth-frame][data-motion='full']` arrival
   selector is red. Assert no accumulated terrain or identity arrival selector matches `claimed` or
   `healthy`, no claim arrival matches `healthy`, and — the five-step walk's own strongest statement —
   **NO ROLE ARRIVES AFTER `claimed` AT ALL**: `claimed` is the last frame that introduces anything,
   and `healthy` is reached by the story's status changing under an already-complete scene, never by
   a new drawable entering. Enumerate the arrival selectors the sheet actually contains and require
   the set of entering frames they name to be exactly `{land, proposed, claimed}` — a role scoped to
   any other frame value, present or invented, is red. *(This clause is the REWRITE, under ADR-0536
   D5, of the requirement that the verdict bloom appear on the fifth frame and on no other. The
   frame it named is gone, but the property it protected — that each role enters at exactly one
   named frame and never re-animates as the walk continues — is what the five-step walk turns on,
   and the set-equality form is what a careless deletion would have silently lost: dropping the
   bloom's row from a per-role list leaves the remaining rows true and stops anyone noticing that the
   walk now ENDS with `claimed`'s arrival.)* Reduced motion exposes
   every frame's final semantics immediately with no arrival selector or delayed concealment. Do not
   author this separate E case until the named D case's source span has been extended in place with
   its complete resolver, renderer-participation, property, timing, per-item-offset and
   exactly-one-announcement-per-role bundle; then require both D and E to exist before CONFIRM_RED;
8. click visible Back/Next/Replay controls through all five frames, Back to empty, replay the same
   action trace twice and compare every semantic snapshot and transition-family trace;
9. repeat under `prefers-reduced-motion: reduce`, compare the same semantic snapshots, assert
   animation/orbit instructions are absent, and assert every existing static SVG placement transform
   remains unchanged;
10. prove the public view itself loads its co-located app-owned stylesheet and that removing that load
   makes the motion proof fail; and
11. inspect the package boundary and normal-motion hooks, then let the package proof command rerun the
   existing renderer, sprite, sizing, trail and arrival regression suite.
12. source-audit `SemanticGrowthWorldView.test.tsx` against its pre-9377 suite and fail unless every
   existing test and assertion remains independently present: semantic-sequence/navigation,
   co-located stylesheet loading, reduced-motion static-transform preservation, bounded SVG,
   definite root-height chain, package-root export, and Storybook sprite-swap semantic parity. The
   new framing and per-delta motion assertions extend that suite; they never replace or consolidate
   it. *(That last retained case asserted, before ADR-0529, that replacing the `tree` visual with a
   Storybook sprite preserved the `signed-proof` `.world-bloom` overlay. Its SUBJECT was deleted with
   the bloom, so under ADR-0536 D6 it is re-pointed rather than dropped: what a sprite swap must not
   erase is the island's proven-green STATUS hue and the persistent human-witness signpost, neither
   of which lives on the swapped node — see the guidance bullet and contract 5 below.)*

> **The attempt history below is preserved VERBATIM as history, and its bloom clauses are not
> re-specifications.** Several entries record what a REJECTED run asserted or failed to assert about
> the verdict bloom — "accepted three bloom repetitions", "bloom only by `not infinite`", "a
> bloom-only one-shot red". Those are true statements about what happened, so they are not edited:
> rewriting a record of a past run to match today's spec would falsify the history that explains why
> the floors above are shaped as they are. What has changed is the SPEC, above (ADR-0536), not this
> record. Read any bloom named here as a thing that existed at the time of that run and was retired
> by ADR-0529 on 2026-09-06.

Human UAT-4 failed the implementation at `9377e897`: its literal `0 0 100 100` viewBox crops a normal
Studio-composed island into an over-zoomed close-up, and one 320 ms fade/scale over territory, wisp,
bloom and arrival hooks reads as static scene swaps rather than in-game growth. The writable red
extends the existing test/source pair and must fail both defects before greening. The test does not
build a Chapter 2 controller, duplicate `SceneView`, synthesize art or reach into Studio/web.
The first promoted correction at `fcd6cf5` is not valid proof: it replaced the 309-line integration
suite with a 36-line framing-only test and thereby made green mean less. This correction must restore
the full pre-9377 proof surface before adding the new red.
The second promoted correction at `e7b55c0` is also invalid proof: it preserved the old suite but
added only stable framing, leaving the generic `semantic-growth-settle` slideshow untested and
unchanged. Both independent additive reds must exist before implementation begins.
Owner UAT-4 failed again at `ffcdc24`: the composition looked better, but whole asset groups sliding
laterally into place read like a PowerPoint transition. This correction changes motion only. The
world and every settled art anchor stay fixed; entering meaning grows/reveals at that anchor.
The next real-proof candidate exposed why attribute snapshots alone under-claim that failure: CSS
`transform: scale(...)` overrides an SVG element's mapper-authored `transform="translate(...)"` while
the animation runs, then the element appears to slide back when the CSS transform releases. The
proof must discriminate computed/source property composition, not merely unchanged DOM attributes.
The valid outer/inner separation landed at `c87382ba`, but placement-safe additive scaling still does
not prove an authored in-game sequence. The owner kept UAT-4 red after the framing and lateral
placement corrections, asking for a fresh session to do the space justice. The next red therefore
treats the existing inner seam as a placement floor, not a visual verdict: terrain formation and
identity growth must read as distinct staged events, and tree/flora/plate/parcels cannot all be one
generic whole-object pop. It does not authorize another wrapper or new motion system.
The failed-closed run `real-ms1latuj` is invalid proof: AUTHOR_TEST asserted only that bloom was
finite, omitting the coherent terrain, Storybook/Vector participation, identity ordering/treatment,
claim and reduced-settlement bundle. A bloom-only one-shot red cannot satisfy authored-choreography
red D. IMPLEMENT then correctly stopped because `proof.real.sourceFile` named
`SemanticGrowthWorldView.tsx` while `semantic-growth.css` owns this motion correction. The real
source seam is now that existing CSS file; `SceneView` remains a read-only proof input and neither a
`SceneView` implementation change nor another wrapper is authorized.
The gate run `real-ms1m3h10` signed machine PASS at `82591f2`, but remains insufficient
machine-green/LOOK-red evidence. Its AUTHOR_TEST accepted renamed animation profiles even though
`arrive-parcel` was value-equivalent to `arrive-pop` in opacity, `scale: 0.55 -> 1`, duration and
easing, grouped parcel boundary with parcel flora, allowed plate to reuse the same whole-object pop
with only a later delay, and accepted three bloom repetitions. Those are the
generic-scale/slideshow loopholes the owner rejected. The executable red must compare actual
keyframed properties and trajectories/values, not names or delays.
The stopped run after `e6e2be3f` is also invalid AUTHOR_TEST. It checked plate only by unequal
`animationName`, parcel boundary versus parcel flora only by selector separation, and bloom only by
`not infinite`; those assertions still allow equal keyframe bodies, delay-only copies and
`3 forwards`. No run id was present in the repository ledger/log surfaces available to this author,
so this correction names the anchored stopped run rather than inventing one.
The stopped post-`a7794537` attempt is invalid AUTHOR_TEST too. Its `canonicalize` normalized selector
rule declarations rather than the referenced `@keyframes`; it discovered roles only inside
`rulesAnimatedBy('arrive-pop')`; it never compared parcel boundary directly with parcel flora; it
read only the iteration-count longhand, allowing shorthand `3 forwards`; and it omitted
Storybook/Vector role participation from the indivisible case. This correction names the anchored
stopped attempt and invents no run id.
The signed run `real-ms1o35is` at `6f25eed` is valid machine proof but remains unmerged,
machine-green and not owner-presentable LOOK evidence. Its CSS targets every
`[data-semantic-growth-frame][data-motion='full']`, so accumulated terrain/identity reanimate on later
Next actions; proposed starts cluster at 90/140/180 ms as mostly whole-object scale variants;
Storybook tree/flora images exist but only Vector `.pop-motion-inner` hooks receive animation; and
Storybook therefore snaps. The correction must scope each arrival to its exact entering frame,
resolve CSS participation for both renderers and create visible, role-specific proposed staging.
The signed run `real-ms1pgtt2` at `9163674` is rejected machine proof and remains unmerged. It added
only the separate entering-frame selector case and exact frame qualifiers, while treating the
unchanged retained `binds the studio's real growth vocabulary...` case as authored-choreography D.
That retained case resolves no shorthand/longhands or referenced keyframes, proves no Storybook
direct-image CSS participation, and still permits shared `arrive-pop` at 90 ms, a 90 ms plate,
grouped parcels without per-item offsets and infinite bloom. An E-only AUTHOR_TEST delta in that
shape is invalid even when the focused command signs PASS.
The signed run `real-ms1pvz2l` at `99ebfcd` is likewise rejected and unmerged. Its test diff appended
only exact-frame red E while the named D case stayed byte-unchanged; its CSS merely added frame
qualifiers and retained the same 90 ms shared `arrive-pop`, 90 ms plate, grouped parcels with no
per-item offsets, absent Storybook direct-image rules and infinite bloom. Legacy assertions that
look D-like elsewhere do not validate an appended-E-only diff.
The run `real-ms1q6ouu` from contract `a415ecc` stopped fail-closed: AUTHOR_TEST reported success
after 45 turns and IMPLEMENT reported success after 22 turns, but the spine failed at CONFIRM_GREEN
because proof remained red. It produced no verdict and promoted no candidate. Its disposable
worktree was removed and the available output identifies no defect, so this history records none.
The signed candidate `real-ms1rkitn` at `bf101a0` is rejected and unmerged. It materially extended
the named D case in place with the required resolver, both renderer hooks, property/timing/per-item
assertions and exactly-one bloom, and implemented distinct CSS, but omitted separate red E entirely.
Its selectors remain generic `[data-semantic-growth-frame][data-motion='full']`, so accumulated roles
reanimate and no executable case proves exact entering-frame scoping. D-only proof is incomplete.

## Guidance

- Accept exactly five ordered entries keyed `empty`, `land`, `proposed`, `claimed`, `healthy`, each
  carrying an already-normalized `WorldPresentationModel`. Fail closed on missing, duplicate or
  reordered keys; do not silently invent a frame — and in particular do not re-admit a sixth key,
  under any name, without a fresh decision (ADR-0536 D1 declined a replacement marker on the merits
  available today and named the route back: a new decision owing a rendered ladder and a picture
  BEFORE it is signed, never a thing slipped in under this one).
- Prove the representative fixtures exactly: `land` contains the target ground but no tree, plate or
  other story marker; `proposed` introduces a proposed/non-healthy story; `claimed` adds the real
  claim/presence family without any proof identity — the island's proven-green status hue is what a
  claim must not reach, and it is reached only at `healthy`; `healthy` is the only healthy frame.
- Treat the pre-9377 `SemanticGrowthWorldView.test.tsx` suite as a preservation floor, not disposable
  scaffolding. AUTHOR_TEST must extend it in place and retain every existing test and assertion.
  Deleting, replacing, weakening, skipping, narrowing or consolidating those assertions is red,
  including when a shorter test covers the new framing defect and the command exits zero. The
  machine proof must source-audit retention of the semantic sequence/navigation, stylesheet-load,
  reduced-motion static-transform, bounded-host, definite-root-height, package-root-export and
  Storybook sprite-swap semantic-parity cases by their independent test bodies and discriminating
  assertions (the parity case's subject moved off the deleted bloom onto the persistent
  human-witness signpost — ADR-0536 D6).
- Meet a fail-closed two-red floor before implementation: add one independent test for stable
  representative framing and a second independent test for semantic delta motion. A framing-only
  test/green, including the shape promoted at `e7b55c0`, is invalid. The motion test must execute a
  source/CSS read of `semantic-growth.css` and, if needed, `SemanticGrowthWorldView.tsx`; it must
  reject a `semantic-growth-settle`-shaped selector grouping and positively discriminate the named
  `arrive-ground`, `arrive-pop` (with its separately named plate, parcel-boundary and parcel-flora
  siblings) and `wisp-in` plus built-in SVG orbit profiles on their respective entering deltas. Each
  stays independently named with its own canonical keyframe body and is non-equivalent to the others;
  folding any two back onto one shared settle keyframe is the defect this bullet exists to catch.
  Matching comments or restated prose is never evidence.
- Add an independent anchored-motion red for the `ffcdc24` owner failure. It reads executable
  CSS/source and rejects `translate`, `translateX` or `translateY` used as entry motion on the whole
  semantic-growth scene, terrain/island group, or complete flora/asset group. Static SVG
  translations used for world placement, ground anchors and nesting remain untouched and are not
  animation. Terrain reveals/grows in place; flora/tree scale from planted/root anchors with the
  already-established brief ease/overshoot and layer stagger; the claim uses a localized entrance
  followed by its mapper-owned orbit. The test compares settled placement transforms across forward,
  Back and Replay and proves reduced motion renders those same final transforms immediately.
- For mapper-positioned SVG elements, forbid semantic-growth arrival/pulse rules and keyframes from
  animating the full CSS `transform` property. A source assertion must fail `transform: scale(...)`
  as well as `transform: translate(...)`: either replaces the element's SVG placement transform
  during animation even though `getAttribute('transform')` still reports the original translate.
  Use the additive individual `scale:` property with `transform-box: fill-box` and an appropriate
  ground/root `transform-origin`, preserving the existing ease/overshoot and layer stagger; or animate
  the existing `.pop-motion-inner` while the outer mapper-authored placement wrapper remains static.
  Apply the same preservation rule to the localized claim entrance. Attribute equality
  alone is not proof; the machine test must inspect real CSS/source and verify the individual
  scale/origin/stagger on the existing `.pop-motion-inner` composition.
  *(This bullet named the bloom pulse alongside the claim entrance until ADR-0529 retired the bloom;
  the rule is unchanged in force and now binds the roles that remain.)*
- Preserve the already-landed `.pop-motion-inner` as the placement-safe visual seam beneath the
  static mapper wrapper; `SceneView` emits that exact class and CSS targets it, with no renamed class,
  second wrapper or comments-only evidence; this is read-only proof and does not authorize a
  `SceneView` change. That seam and additive individual `scale:` are a floor, not the choreography.
  One executable authored-choreography case must prove the coherent bundle together: land locally
  forms/reveals coast/substrate and identity roles use materially authored existing CSS/SVG
  treatments. Discover each role selector independently from rendered hooks, without
  assuming any animation name. `resolvedProfile(selector)` parses shorthand positional tokens and
  longhands, applies longhand precedence, resolves name/duration/easing/delay/iteration/fill, then
  loads the resolved name's actual `@keyframes`, strips comments and canonicalizes declarations by
  offset. Never compare selector declarations as if they were keyframes. Plate/planted and parcel
  boundary/parcel flora canonical bodies must each be non-equivalent; compare parcel boundary
  directly with parcel flora and also reject a grouped selector. At least one pair must differ in
  keyframed property set; names, delays, durations, easing and numeric scale endpoints alone are
  insufficient. EVERY surviving arrival profile — terrain, planted tree/flora, plate, parcel
  boundary, parcel flora and the claim wisp's entrance — resolves from shorthand plus longhand
  precedence to iteration numeric exactly `1`; reject shorthand/longhand counts above `1` and
  `infinite`. Each has finite fill and a terminal body settling at `scale: 1`/`opacity: 1` or
  explicit equivalent base-rest values. *(Rewritten from the retired one-shot `bloom-pulse` rule
  under ADR-0536 D5: the property is that an announcement settles, and it now binds every role that
  announces rather than the one that was deleted. The mapper-owned orbit is exempt as a continuous
  presence cue, not an arrival.)* The same case resolves
  CSS profiles—not DOM existence—for Vector tree/flora `.pop-motion-inner` and Storybook direct
  `image.story-tree`/`image.garden-flora` hooks from a sheet defining both. Start-time assertions use
  resolved delays: planted tree/flora first; parcel boundary at least 100 ms later; earliest parcel
  flora at least 60 ms after boundary with at least two deterministic per-item `:nth-*` or
  custom-offset delays; plate at least 180 ms after planted. Tree/flora retain anchored grow; parcel
  flora uses rooted scale plus opacity sprout; parcel boundary uses opacity/reveal with no scale;
  plate uses opacity plus vertical-only individual `translate:` settle with no scale on its existing
  `.pop-motion-inner` or direct image role hook. No full `transform:`, lateral translate, new wrapper
  or renderer is allowed. The case also proves local
  claim/orbit and immediate honest reduced semantics. Omitting any exact operation is invalid
  AUTHOR_TEST even when the command is red or green.
- Add a separate executable entering-delta selector audit. Full-motion arrival selectors must be
  qualified by exactly one entering frame: terrain=`land`; tree/flora/plate/parcel-boundary/
  parcel-flora=`proposed`; wisp=`claimed`. Generic
  `[data-semantic-growth-frame][data-motion='full']` arrival targeting is red. Terrain/identity
  arrivals must not match claimed or healthy; the claim arrival must not match healthy; and the SET
  of entering frames the sheet's arrival selectors name is exactly `{land, proposed, claimed}` — no
  role arrives after `claimed`, which is what makes `healthy` a change of status over a complete
  scene rather than a sixth thing appearing. Reduced mode renders each accumulated final role
  immediately without an arrival selector or delayed concealment. *(Rewritten from the rule that the
  bloom appear on frame five and nowhere else, under ADR-0536 D5. Stated as set equality rather than
  as a per-role list on purpose: deleting the bloom's row from a list would leave every remaining row
  true while quietly losing the claim that the walk's arrivals END at `claimed`.)*
- Keep the cursor and transition selection pure. Next clamps at healthy, Back clamps at empty,
  restart selects empty, and Replay reapplies the same ordered keys. Time controls interpolation
  only; no timeout advances the cursor and no random value influences output.
- Accept one deterministic representative world framing alongside the five frames and hold it stable
  through the whole walk. It is the host's normal contain-style view of the composed world bounds,
  with ordinary breathing room around coast, substrate and standing objects; it is not a magic
  `0 0 100 100`, a crop around the current tree, or a frame-by-frame camera jump. The shared view
  remains authority-free: it consumes the framing and does not import Studio camera/controller code.
- Stay bounded by the supplied host. The root/SVG must not escape through viewport sizing or cover
  the controls; Back, Next and Replay remain visible, enabled click targets in normal layout at every
  frame and host size. The public root must itself participate in a definite host-height/min-height
  chain and reserve a separate control row (or an equivalent bounded composition), so the SVG sizes
  into the remaining space. A percentage `max-height` on the SVG against an auto-height root is not
  a bound: the proof must fail that combination because it can still push the controls outside the
  supplied host.
- Delegate every frame to the existing `WorldSceneView`. Reuse the scene's real territory, tree,
  claim-wisp and status identities. Do not fork `SceneView`, sprite resolution, scene construction or
  `@storytree/forest-world`.
- Sprite replacement must preserve semantic descendants owned by the replaced scene node, and it must
  not reach the proof vocabulary at all. **Under ADR-0536 D6 this guarantee is RE-POINTED, not
  dropped.** It used to read "replacing the `tree` visual with Storybook must retain the
  `signed-proof` `.world-bloom` overlay identity that Vector exposes; renderer choice may change
  artwork, never erase proof-bloom semantics" — and its subject went with the bloom. The standing
  proof semantics an artwork swap must never erase are now the island's proven-green STATUS hue and
  the legend's proof row, and NEITHER of them is a descendant of the swapped node, so the guarantee
  holds by construction rather than by a per-swap assertion. What the swap must still preserve, and
  what the retained case asserts, is the PERSISTENT human-witness signpost (`sign-blank` /
  `sign-pass` / `sign-fail`), which is a real descendant, is unchanged by ADR-0529, and would be a
  genuine loss. Say that here rather than deleting the line unremarked.
- Own the semantic transition vocabulary in `@storytree/app-surface`, reusing the renderer's existing
  arrival/growth, claim-orbit, SVG/code-native geometry and animation primitives. Apply motion
  only to the entering semantic delta and stage it by meaning: terrain formation is distinct from
  identity growth, planted flora/tree is distinct from plate/parcels, claim is distinct from proof.
  Exact legacy scale values or one shared pop keyframe are not the contract. Do not group the roles
  under one settle/pop treatment, remount the whole scene to fake motion, add an animation
  framework/game engine/raster sequence, or create a parallel transform vocabulary.
- The `land` delta alone makes the primary island emerge from nothing, slowly and at its existing
  world anchors, through the shared `semantic-growth.css` renderer: its resolved arrival duration is
  bounded from **700 ms through 1000 ms** and is longer than every proposed identity arrival. Coast
  and substrate may form together only as that one land delta; tree/flora, plate and parcels remain
  absent until `proposed` and keep their separately authored timings. This is not a new asset or
  renderer seam. Reduced motion performs no timed emergence and instead exposes the same settled
  land immediately.
- Never translate the whole world, island/terrain group, or complete sprite/flora group laterally to
  announce a state. Keep every composed world coordinate and settled ground-contact transform stable.
  Reveal terrain where it lies; grow flora/tree from planted/root anchors; introduce the claim only
  around its local tree/island anchor before its existing orbit. Reuse current Storybook/Vector art
  and transform vocabulary only. Do not generate
  frame/sprite assets, add a Nanobanana or sprite-frame/frame-sequence pipeline, introduce production
  art, fork product art, create a second renderer, or move animation into website/Studio code.
- Resolve the browser's `prefers-reduced-motion` signal inside the shared surface (an explicit test
  override is allowed). Reduced mode suppresses animation, interpolated travel, scale sweeps, delayed
  hidden content and the real wisp's SVG orbit while rendering the same markers immediately. It must
  preserve the scene mapper's existing static SVG `transform` attributes used for placement, anchors
  and nesting; never apply a blanket `transform: none` to scene descendants. The preference never
  changes the cursor or supplied model.
- Keep product authority out. Inputs are plain frames plus optional navigation callbacks; there is no
  fetch, store, subscription, claim mutation, proof mutation, clock-selected semantic state, website
  selector or Chapter 2 pacing/script.
- Export the public seam from the package root. The public view itself imports/loads its co-located
  motion stylesheet, so a consumer cannot mount an inert semantic player by forgetting a separate
  CSS side effect. Motion rules live in the package, not in website or Studio CSS.
- Preserve current art and consumers through the full suite: Storybook remains clean/default; Vector
  remains the explicit, unknown-value and uncovered-kind fallback; existing Studio behaviour is
  observed by the dependent demo-host capability's clean-path regression gate.

## Machine contracts

**Proof-preservation wall — applies before any numbered contract may pass.** The machine proof
source-audits `packages/app-surface/src/SemanticGrowthWorldView.test.tsx` against the pre-9377 suite.
It fails if any existing test/assertion is absent, skipped, weakened, narrowed, folded into a less
discriminating replacement, or consolidated away. At minimum it must find independent executable
cases for: the five-state semantic/navigation trace; component-owned stylesheet load; reduced-motion
preservation of static SVG transforms; bounded SVG/visible controls; a definite root-height chain;
the package-root export; and Storybook tree replacement preserving the swapped node's semantic
descendants — the persistent human-witness signpost, since ADR-0529 deleted the `signed-proof`
`.world-bloom` overlay this case originally named (ADR-0536 D6). The framing and per-delta motion
reds are additional assertions in that retained suite. **The preservation wall itself is not
weakened by the re-pointing:** a case may be RE-AIMED at the surviving subject when a decision
deletes what it watched, and that re-aim must be recorded here; it may never be quietly dropped,
narrowed to something cheaper, or left asserting a selector that can no longer match.

**Two-red floor — applies before IMPLEMENT.** AUTHOR_TEST must introduce two separate executable
test cases in the retained suite: **A**, stable representative framing; and **B**, semantic-delta
motion. Case B reads `semantic-growth.css` and/or component source and asserts over actual selectors,
keyframe names and wiring. It fails while any `semantic-growth-settle`-shaped rule groups territory,
wisp/claim-wisp and arrival hooks, and passes only when `arrive-ground`, `arrive-pop` (with its
separately named plate / parcel-boundary / parcel-flora siblings) and `wisp-in` plus the mapper-owned
orbit are applied to land, proposed and claimed respectively — each independently named,
non-equivalent and never re-grouped. A source audit that matches comments/prose, or a framing-only
green such as `e7b55c0`, fails this floor.

**Anchored-motion red — applies before the correction at `ffcdc24` may implement.** An additional
independent executable case reads real CSS/source and fails any whole-scene, whole-terrain/island or
whole-flora/asset entry keyframe containing lateral translation. It positively discriminates
in-place terrain reveal/growth, root-anchored flora/tree scale with the existing overshoot/stagger,
and localized claim entrance plus built-in orbit. It also compares
settled static placement transforms through forward, Back, Replay and reduced motion. Comment/prose
matches do not satisfy this red.

**SVG transform-composition floor — part of anchored-motion red C.** The executable source/CSS
assertion fails any semantic-growth arrival or pulse selector/keyframe that sets the full
`transform:` property on mapper-positioned terrain, flora/tree or claim elements, including
`transform: scale(...)`. Passing requires either additive individual `scale:` with
`transform-box: fill-box`, the correct ground/root `transform-origin` and the existing stagger, or
the existing `.pop-motion-inner` composition whose outer SVG `transform="translate(...)"` remains
the effective placement throughout animation. Merely comparing `getAttribute('transform')`
before/after is red.

**Authored semantic-choreography red D — indivisible, additive, no new scope. CURRENT-TEST-BYTE-DIFF
floor:** AUTHOR_TEST must extend in place the existing case whose title begins `binds the studio's
real growth vocabulary to the exact already-landed .pop-motion-inner seam`; it may not replace or
delete it, every pre-9377 case/assertion remains mandatory, and the named case's source span must
materially differ from the gate input before any independent E case is authored. The additions
inside that named test must build `resolvedProfile` with shorthand plus precedence-winning
longhands, canonicalize the referenced keyframes, resolve CSS participation for Vector
`.pop-motion-inner` and Storybook direct-image selectors, compare the required role pairs'
keyframed property sets, enforce all exact timing gaps and per-item offsets, and resolve EVERY
surviving arrival profile's iteration to exactly `1`. The extended case reads real
`semantic-growth.css` and read-only
`SceneView.tsx`, preserves
exact existing `.pop-motion-inner` emission/targeting, and rejects a second wrapper, `SceneView`
implementation change, full CSS `transform:`, lateral entry, mismatched names or comments-only
matches. That same case must prove every bundle member together: distinct local coast/substrate
formation; CSS-resolved tree/flora profiles under both Storybook and Vector hooks; planted
tree/flora before plate/parcels
with visible minimum gaps; at least two materially non-equivalent identity profiles; ungrouped,
body-non-equivalent parcel-boundary and parcel-flora treatments; plate body-non-equivalent to planted
tree/flora; localized claim plus mapper orbit; every arrival profile announcing exactly once and
settling at rest; and reduced motion immediately exposing identical final semantics while preserving
placement.
The test discovers every role selector independently from rendered hooks, never from
`rulesAnimatedBy('arrive-pop')`, and builds `resolvedProfile(selector)` by parsing shorthand
positional tokens plus longhands with longhand precedence into name, duration, easing, delay,
iteration and fill. The resolved name—not the selector rule body—loads the referenced `@keyframes`;
comments are stripped and actual declarations canonicalized by offset. Plate/planted and directly
compared parcel-boundary/parcel-flora canonical bodies must each be non-equivalent, parcels must be
ungrouped, and at least one pair must differ in keyframed property set; names, delays, durations,
easing or numeric scale endpoints alone cannot pass. **The one-shot-announcement rule now binds every
surviving role rather than the retired bloom (ADR-0536 D5):** terrain, planted tree/flora, plate,
parcel boundary, parcel flora and the claim wisp's entrance each resolve iteration from shorthand and
longhand to numeric exactly `1`, rejecting any integer above `1` and `infinite`, with finite fill and
a terminal keyframe settling to `scale: 1`/`opacity: 1` or explicit equivalent base-rest values. The
mapper-owned orbit is exempt by kind — it is a continuous presence cue, not an arrival, and its
absence under reduced motion is separately required below.
CSS profile resolution must succeed for Vector tree/flora `.pop-motion-inner` and Storybook direct
`image.story-tree`/`image.garden-flora` hooks from a sheet defining both; rendered DOM alone cannot
pass. Let `t_planted` be the earliest resolved planted tree/flora start. Parcel boundary starts at
least `t_planted + 100ms`; earliest parcel flora starts at least boundary `+ 60ms`, with at least two
distinct deterministic per-item `:nth-*` or custom offsets; plate starts at least
`t_planted + 180ms`. Canonical keyframes prove: anchored scale/opacity grow for planted tree/flora;
rooted scale/opacity sprout for parcel flora; opacity/reveal and no scale for parcel boundary; and
opacity plus vertical-only individual `translate:` settlement and no scale for plate. Any full
`transform:`, lateral translate, second wrapper or renderer is red. The same case proves local
claim/orbit, one finite settled announcement per arrival role, reduced semantics and stable
placement. Any
AUTHOR_TEST missing an operation is invalid whether red or green, and no separate E case can cure or
substitute for that omission. The under-claimed shapes from
`real-ms1latuj`, `real-ms1m3h10`, stopped post-`e6e2be3f` and stopped post-`a7794537` cannot satisfy D.

**Entering-delta frame-scoping red E — independent, additive, no new scope.** Executable CSS selector
parsing requires full-motion terrain arrival rules to include exact frame equality `land`; planted
tree/flora, plate, parcel-boundary and parcel-flora arrival rules exact `proposed`; and wisp entrance
exact `claimed`. A mere `[data-semantic-growth-frame][data-motion='full']` qualifier fails. Selector
matching assertions prove terrain/identity arrivals cannot match claimed or healthy; the claim
entrance cannot match healthy; and no arrival runs on healthy. **The audit is expressed as SET
EQUALITY over the sheet's actual arrival selectors: the entering frames they name are exactly
`{land, proposed, claimed}` — no more and no fewer.** So `claimed` is the last frame that introduces
anything, and `healthy` is a change of status over an already-complete scene rather than a sixth
thing appearing. *(This is the ADR-0536 D5 REWRITE of the rule that the verdict bloom appear on frame
five and on no other. Set equality rather than a per-role list is the point: striking the bloom's row
from a list would leave every remaining row true while silently discarding the claim that the walk's
arrivals STOP at `claimed`, which is the five-step walk's strongest statement and precisely what a
careless deletion loses. A sixth entering frame reappearing under any name fails this red, which is
what keeps ADR-0536 D1's declined replacement marker from being slipped in without a fresh
decision.)* Reduced motion has no matching arrival/orbit/delay and immediately renders the same
accumulated final semantics.
E is additive and ordered after D: it cannot count unless AUTHOR_TEST first contains the materially
extended-in-place named vocabulary case and that one case executes every D operation. Appending only
E while leaving that named source span byte-unchanged—even when D-looking legacy assertions remain—
is rejected machine proof, as shown by `real-ms1pgtt2` at `9163674` and `real-ms1pvz2l` at `99ebfcd`.
Completion is conjunctive before CONFIRM_RED: AUTHOR_TEST must also add this separate executable E
case after D. A complete D with no E is equally invalid, as `real-ms1rkitn` at `bf101a0` demonstrates.

1. **`sgrv-five-ordered-frames-preserve-semantic-honesty`**
   - **asserts —** only the exact ordered key set `empty` / `land` / `proposed` / `claimed` /
     `healthy` is accepted, and a sixth key under any name is refused; `land` has target ground but
     no story marker; `proposed` adds a proposed/non-healthy story; `claimed` adds real presence
     without any proof identity — no claim-family drawable reaches the island's proven-green status
     hue; and healthy status appears only in the final frame, reached by the story's status changing
     under an already-complete scene rather than by a new drawable entering.
   - **note —** renamed from `sgrv-six-ordered-frames-preserve-semantic-honesty` under ADR-0536,
     which dropped the `signed-proof` frame with the verdict bloom ADR-0529 retired. The clause this
     contract lost — *"`signed-proof` remains proposed/non-healthy while carrying the proof bloom"* —
     was the walk's statement that proof and authored status are different things. That proposition
     is TRUE and survives; ADR-0536 D3 moved its home to the legend's proof row and to story prose,
     because the only thing on screen that said it was the bloom. It is not restated as a criterion
     here, since a criterion whose subject was deleted can only be met vacuously.
2. **`sgrv-back-restart-replay-are-deterministic`**
   - **asserts —** in a bounded host, visible/clickable Next walks all five frames, visible/clickable
     Back walks toward empty and visible/clickable Replay returns to empty; equal inputs plus equal
     traces yield equal frame-key sequences, semantic DOM snapshots and transition-family traces;
     controls remain reachable and no timer/random/remount history changes the result. One supplied
     representative framing is unchanged across all five frames, contains the full representative
     world with breathing room, and the source contains no literal `viewBox="0 0 100 100"` or
     per-frame newest-marker crop. The root establishes a definite bounded layout and reserves the
     controls' row; an auto-height root plus percentage-only SVG cap is red.
3. **`sgrv-reduced-motion-keeps-identical-semantics-without-travel`**
   - **asserts —** a stubbed `prefers-reduced-motion: reduce` run yields the same five semantic
     snapshots as normal motion, emits no animation/orbit/interpolated-travel instruction, never hides
     settled state behind a delay, and preserves every static SVG placement `transform` from the
     normal semantic render.
4. **`sgrv-motion-and-authority-stay-in-the-shared-package`**
   - **asserts —** the public view loads `semantic-growth.css` itself; the test fails when that load
     is absent; normal motion uses the existing per-delta arrival-ground, arrival-pop (with its
     separately named plate / parcel-boundary / parcel-flora siblings) and wisp entrance/orbit
     hooks/profiles, each independently named, non-equivalent, and never re-grouped onto one shared
     settle keyframe. An independent executable motion test reads the real CSS/source, rejects a
     `semantic-growth-settle`-shaped grouping over `.hex-territory`,
     `.world-wisp`/`.world-claim-wisp` and `.arrive-island`, and positively asserts
     the named per-delta selector/keyframe wiring. The `land` selector alone resolves to a bounded
     700--1000 ms in-place emergence, longer than every proposed identity arrival; the test rejects
     a land profile outside that range, identity entering on land, or a land-duration alias of an
     identity arrival, and proves reduced mode exposes settled land without timed concealment. A
     separate source/CSS case rejects whole-group
     lateral translation and proves stable world anchors, in-place terrain growth, root-anchored
     flora/tree scale and localized claim entrance/orbit. It also rejects the
     full CSS `transform:` property on mapper-positioned animated elements and positively requires
     additive `scale:` plus fill-box/root origin/stagger on the existing `.pop-motion-inner`;
     the authored-choreography case additionally preserves exact `.pop-motion-inner`
     emission/targeting while rejecting a generic whole-object pop. One indivisible executable case
     proves distinct local coast/substrate staging, CSS-resolved Vector and Storybook role
     participation, visibly spaced tree/flora-before-parcels-before-plate choreography, actual
     referenced-keyframe body/property distinctions for plate/planted and directly compared ungrouped
     parcel-boundary/parcel-flora, local claim/orbit, one finite settled announcement per arrival
     role, and immediate reduced semantics. The assertion builds resolved
     profiles from shorthand plus precedence-winning longhands, requires one compared pair's
     keyframed property set to differ, catches shorthand counts above `1`/`infinite` on EVERY
     arrival profile, verifies terminal
     rest, CSS profiles for Vector `.pop-motion-inner` tree/flora and Storybook direct image hooks,
     minimum start gaps of planted→boundary `100ms`, boundary→flora `60ms` with two deterministic
     per-item offsets, and planted→plate `180ms`. It proves anchored grow, rooted parcel-flora sprout,
     no-scale parcel reveal and no-scale opacity/vertical-individual-translate plate settlement.
     Selector-body canonicalization, animation-name assumptions, names/delays/duration/easing or
     numeric scale endpoints alone, grouped parcels, DOM-only renderer participation, full
     `transform:`, lateral translate, class mismatches and comments/prose cannot satisfy the case.
     A separate selector audit proves the set of entering frames the sheet's arrival selectors name
     is exactly `{land, proposed, claimed}` — terrain on `land`, the identity roles on `proposed`,
     the wisp on `claimed`, and NO role arriving after `claimed` — and rejects generic full-motion
     frame presence, accumulated-role reanimation, any healthy arrival, a sixth entering frame under
     any name, or delayed reduced motion.
     *(Both halves of this bullet are ADR-0536 D5 REWRITES, not new scope. The iteration clause was
     the requirement that the bloom's `bloom-pulse` run exactly once; the selector clause was the
     requirement that the bloom appear on the fifth frame and on no other. Their subject was deleted
     by ADR-0529, so each is re-aimed at the property it was protecting — an announcement that
     settles, and a role that enters at exactly one named frame — over the roles that remain. The
     selector clause is stated as set equality rather than as a per-role list because striking the
     bloom's row from a list leaves every remaining row true while silently losing the claim that
     the walk's arrivals STOP at `claimed`.)*
     Transition rules and reduced-motion handling live under
     `packages/app-surface`; the view delegates to `WorldSceneView`; and its source imports no
     Studio/web module, live data/store authority, generated frame/sprite asset, Nanobanana or
     frame-sequence pipeline, production/product-art fork, Chapter 2 controller or duplicate
     renderer.
5. **`sgrv-existing-art-and-scene-contracts-do-not-regress`**
   - **asserts —** the full package command retains existing Storybook/Vector resolution and fallback,
     sprite sizing/anchors/depth order, semantic mapper, trail/arrival and event tests; the retained
     integration case plus focused `SceneView` regression prove Storybook replacement of `tree`
     preserves the swapped node's semantic descendants — specifically the persistent human-witness
     signpost (`sign-blank` / `sign-pass` / `sign-fail`) that Vector exposes. A green
     command after replacing the retained integration suite with a smaller framing-only test is red.
   - **note — the renderer guarantee is RE-POINTED here, not deleted (ADR-0536 D6).** This clause
     read *"preserves the same signed-proof `.world-bloom` overlay identity exposed by Vector"*, and
     that subject went with the verdict bloom (ADR-0529). It is not simply struck, because the rule
     it encoded — *renderer choice may change artwork, never erase proof semantics* — is still true
     and still worth a test. What changed is that the standing proof semantics are now the island's
     proven-green STATUS hue and the legend's proof row, and NEITHER is a descendant of the node a
     sprite swap replaces, so that half of the guarantee holds by construction rather than by
     assertion. The half that still needs asserting is the persistent signpost, which IS such a
     descendant and would be a real loss — so that is what the retained case now watches.

The fifth contract is a regression wall observed by the package command after the new integration
test greens; it does not ask the new test to duplicate the existing fixture matrices. Visible timing,
easing and legibility remain the story's operator-held UAT leg.
