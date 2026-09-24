---
id: "act2-intro-cursor"
tier: capability
story: studio
title: "The Act 2 regrow's app-owned cursor — one clock, movable, surviving a re-fetch"
outcome: "The Act 2 forest regrow is driven end to end by one app-owned cursor the operator can move."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: [282, 286, 292, 313, 469]
# A greenfield capability registered retrospectively by capability-layer-coverage-arc increment 4
# (2026-08-07). It resolves TWO story-grain
# `repo-manifest.json` declarations that existed only because no capability covered this organ —
# the regrow CLOCK, as distinct from the CAMERA choreography riding it (already two capabilities)
# and from the world GEOMETRY it plays over (already `@storytree/app-surface`'s).
# The `proof:` block is spec-borne (ADR-0057); there is deliberately NO `real:` arm:
#   1. This classification correction does not add a `real:` arm or manufacture a red/verdict
#      (ADR-0159). A `real:` arm would also move the pinned
#      REAL-buildable snapshot in `packages/cli/src/node-build.test.ts`.
#   2. `readUnitSourceFiles` (packages/cli/src/check-boundaries.ts:210-234) reads ONLY
#      `real.sourceFile` + literal `real.scope.sourceGlobs` and `continue`s on an absent `real`
#      (`:226`), so this unit contributes nothing to `unitSourceFiles` and the ADR-0192 landlord
#      rule does not fire. Both files are in `apps/studio`, this story's OWN building.
# The command is the studio's vitest suite — apps/studio is VITEST + jsdom, not node:test, and the
# clock half is a `.test.tsx` the default `node --test` runner could not execute at all.
proof:
  command:
    file: pnpm
    args: ["--filter", "studio", "test"]
  scope:
    testGlobs:
      - "apps/studio/src/components/act2Intro.test.ts"
      - "apps/studio/src/components/act2Intro.clock.test.tsx"
    sourceGlobs:
      - "apps/studio/src/components/act2Intro.ts"
      - "apps/studio/src/components/Act2IntroControl.tsx"
---

# The Act 2 regrow's app-owned cursor — one clock, movable, surviving a re-fetch

**Outcome —** The Act 2 forest regrow is driven end to end by one app-owned cursor the operator can
move.

**Depends on —** nothing within this story. The regrow's ORDER is not derived here:
`deriveForestRegrowPlan` and the layer/trail projections come from `@storytree/app-surface`, which
is the already-declared cross-story `studio → app-surface` edge (ADR-0237), untouched by this unit.
Its own code reaches no named `studio` capability — neighbouring the camera slices in `TreeView.tsx`
is not an edge, the same same-file-adjacency-is-not-an-edge call four siblings already record in
[`story.md`](story.md). It is a root.

> **Proof status (honest) — `proposed` (greenfield without a current signed pass; NOT `healthy`).**
> The player landed through ordinary sessions across ADR-0282 / ADR-0286 / ADR-0292 and its tests
> were written alongside it. That history is greenfield; neither late registration nor the absence of
> a gate-driven red→green makes it brownfield or Adopt-bound (ADR-0395).
>
> **The outcome half — `apps/studio/src/components/act2Intro.clock.test.tsx`, 9 tests.** A
> `renderHook` of the REAL `useAct2Intro` against a real story graph and trail-edge set, with the
> clock INJECTED (`Act2IntroClock`) so a run is a deterministic sequence of timestamps rather than a
> wait on real `requestAnimationFrame`. The hook calls the real `deriveForestRegrowPlan` from
> `@storytree/app-surface` inside the render, so this drives the player against its real upstream
> collaborator with no stub between them. Three groups: the speed dial, the cursor a fresh plan
> opens on, and the plan's survival across a re-fetch. That is the integration proof.
>
> **The leaf half — `act2Intro.test.ts`, 15 tests** of pure node-env arithmetic: the two query
> gates, the wave transport, the first-arrival session flag and the plan-identity key. These are
> contracts 1–4 below.
>
> **The stated gap that matters most — `Act2IntroControl.tsx` has NO test file at all.** It is in
> this capability's `sourceGlobs` because it is part of the organ (below), but nothing asserts its
> readout (depth, islands landed, pathways growing, percent, the plan's base nodes and unreachable
> islands) or its transport buttons. What IS proven is the arithmetic underneath every one of those
> buttons — `backProgress`, `waveAtProgress`, `waveStartProgress` are contract 3 — so the gap is the
> WIRING from a click to that arithmetic, not the arithmetic itself. This is the same
> pure-core / real-effects-wiring shape
> [`mirrored-route-conformance`](../desktop/mirrored-route-conformance.md) records for its gather
> half. Recorded here, not implied.
>
> **A second gap, named rather than folded in.** Four exported hooks in `act2Intro.ts` —
> `useReducedMotion`, `useStableForestRegrowLayer`, `useStableForestRegrowTrails`,
> `useStableVegetationLayer` (`:126-227`) — are render-stability memoizers with no direct
> assertion. They are exercised transitively on every `useAct2Intro` render in the clock suite, but
> their signature-keyed identity contract (the thing that stops a new object per frame) is asserted
> nowhere. The reduced-motion settlement ADR-0282 D6 names is likewise carried by
> `useReducedMotion`'s `matchMedia` read, which no test drives.
>
> **The mount is out of scope.** `TreeView.tsx:2330-2384` reads the gate, records first arrival and
> constructs the player. That composition is the map's, not this unit's, and `TreeView.tsx` is
> deliberately absent from the globs above.
>
> **No reliability gate `(covers:)` this capability.** The story's `studio#gate-1` is the Playwright
> story UAT, which never opens `?act2=intro` and does not watch a regrow. Extending an
> already-signed gate's `(covers:)` list changes what a signed verdict claims, so it is a
> deliberate, id-aware edit for the owner — a stated gap, not a hidden one.

## Guidance

**WHY THIS IS ONE ORGAN AND NOT TWO** (the splitting-rule, ADR-0010). The tempting cut is
module-versus-component: a hooks module and a diagnostic panel, which is exactly how the two
`repo-manifest.json` declarations that preceded this file were shaped. It is the wrong cut:

- **The panel could not state a proof alone, and is not independently viable.** Its own header is
  explicit: *"It renders NOTHING of the world itself — it only moves the cursor that `useAct2Intro`
  holds."* Delete `act2Intro.ts` and the panel has no cursor to move, no plan to read and no state
  to report. Delete the panel and the cursor still runs — but the transport that makes a specific
  beat inspectable, which is the half of the outcome that says *the operator can move it*, goes with
  it.
- **Both triggers of the splitting-rule pass for the fused unit.** Its outcome states in one
  sentence without a conjunction (above), and its proof shares one precondition (a plan derived from
  one story graph) and one observable (the cursor's normalized progress).

**WHY "ONE CURSOR" IS THE OUTCOME AND NOT AN IMPLEMENTATION NOTE.** The single-clock property is
the thing the code is built to hold, and three of the suite's seven groups exist only to hold it.
`act2Intro.ts`'s header states it as the design: *"Everything about HOW that plays lives on this
side of the seam … Nothing is asset-owned and there is no remount key standing in for a cursor —
the cursor IS the state."* The tests then fence it from both sides: the speed dial *"scales the
CLOCK, not the schedule — every island forms at the same fraction of the run"* (a second timeline
would let the schedule drift from the clock), and *"keeps the cursor running when an identical story
array arrives"* (a remount key would have minted a second cursor on every re-fetch of the studio's
cached-then-confirmed tree payload). ADR-0313 then decides the same property at the tier above:
Act 2 camera choreography *stays on the regrow cursor*. An outcome phrased around the visual — "the
forest regrows from nothing" — would be app-surface's, and would leave the property this unit
actually delivers unstated.

**WHY THIS IS A `studio` CAPABILITY, and the three rejected homes, each read rather than assumed.**

1. **Both files are in `apps/studio/src/components`, this story's own building** — no landlord
   question arises, and no `hostedStories` entry is needed.
2. **`app-surface` — the closest call, because the regrow's ORDER, geometry and render layers are
   all that package's.** It is not the home, and the seam is drawn in the source: *"The ORDER itself
   is not decided here: `deriveForestRegrowPlan` (@storytree/app-surface) derives it from the real
   story graph, so this module never scripts a sequence (ADR-0282 D3/D8)."* What is app-surface's is
   WHAT grows and in what order; what is studio's is WHEN, how fast, and where the cursor is now.
   The two `app-surface` capabilities that looked nearest were both read and are a different journey
   (both since RETIRED with the flat forest picture, ADR-0608, 2026-09-24):
   [`semantic-growth-replay-view`](../app-surface/semantic-growth-replay-view.md) presents *six
   supplied world frames* with its own Next/Back/Replay, and
   [`semantic-growth-studio-demo`](../app-surface/semantic-growth-studio-demo.md) mounts that view
   over *one six-frame fixture* behind `?semanticGrowth=demo`. Both are a fixture view; this is the
   real map regrowing its real graph on the clean route.
3. **`act2-regrow-camera-zoom-out` / `act2-regrow-camera-frame-delivery` — checked, because they
   share the "act2-regrow" prefix and would look like the obvious home.** Neither covers this. Both
   are about the CAMERA, and
   [`act2-regrow-camera-zoom-out`](act2-regrow-camera-zoom-out.md) names its own driver as *"the
   existing normalized regrow cursor"* — it CONSUMES this unit's outcome as a precondition rather
   than delivering it. Run the dependency test both ways: that capability cannot pass its proof
   without a running regrow cursor, and this one landed and proves green with no camera
   choreography present. The edge is one-directional and the graph stays acyclic. **This is a real
   in-story edge that the two camera specs do not yet declare** — recorded here rather than edited
   into them, because changing a `proposed` capability's `depends_on` changes `story build`'s topo
   order, which is the owner's call and not this arc's to make in passing.
4. **`hud-chrome` — checked, because ADR-0286 moved the owner-facing transport into the gear
   panel.** It is not the home: `hud-chrome`'s outcome is the global chrome retirement and the
   single verified-identity avatar, and the gear panel is `worldSettings`' surface, not this one's.
   What crossed into the gear was two CONTROLS; the clock they drive stayed here.

**THE PROOF COMMAND.** `pnpm --filter studio test`. `apps/studio` is VITEST + jsdom
(`apps/studio/vitest.config.ts`), not `node:test` — and here that is load-bearing rather than
stylistic, because the integration half is a `.test.tsx` needing a React renderer and a jsdom
window. The scope globs are each repo-relative, rooted at `apps/`, and name one concrete file, so
they are inside the ADR-0087 structural bound (`scopeGlobBoundIssue`,
`check-boundaries.ts:243-264`).

## Integration test

**Goal —** Prove that one app-owned cursor carries the Act 2 regrow from nothing to the settled
forest, that the operator's dials move that cursor rather than a second timeline beside it, and that
an identical re-fetch of the same story graph does not restart the run underneath them.

The integration-flavoured proof is `apps/studio/src/components/act2Intro.clock.test.tsx`, run by
`pnpm --filter studio test`. Real collaborators, no stub between them: `renderHook` drives the real
`useAct2Intro`, which derives its plan through the real `deriveForestRegrowPlan` from
`@storytree/app-surface` over a real story-graph and trail-edge fixture. The only seam is the
`Act2IntroClock`, injected so a run is a deterministic timestamp sequence rather than a wait on real
`rAF` — the same option the player itself exposes, not a test-only fake of the thing under test.

Three groups. The **speed dial** (ADR-0286): the plan is crossed in its own duration at 1x, the run
stretches below 1x and compresses above it proportionally, a speed that would stall or reverse the
run is refused, and — the single-clock assertion — the dial scales the CLOCK and not the schedule,
so every island still forms at the same fraction of the run. The **opening cursor**: a fresh plan
rests on the settled forest by default, but opens on NOTHING while a start is pending, including for
the first arriving plan, which is the case that actually flashed a frame of the grown forest. The
**plan's survival**: an identical story array arriving from the studio's cached-then-confirmed tree
payload keeps the cursor running, while a graph that really changed still invalidates it — the
two halves of `forestRegrowGraphKey`'s contract observed through the player rather than in isolation.

The authored rung remains `proposed` until current signed proof exists. `Act2IntroControl.tsx`'s readout and
the four render-stability memoizers are exercised but not asserted — the stated gaps recorded above,
not claimed here.

## Contracts (7)

The test-proven leaf behaviours — each **one isolated automated test** with collaborators stubbed
(ADR-0002). Every contract here has a REAL passing test (`proven by`).

1. **`the-query-gates-match-exactly-and-never-truthily`** — the gate half matters as much as the
     feature, because this mounts on the REAL map
   - **asserts —** `?act2=intro` mounts the diagnostic control on the ONE exact value, and absence,
     an empty value and every near miss (`?act2=on`, `?act2=intro-x`) leave the clean Studio route
     untouched. An over-eager reader here would change the clean route for every visitor.
     *(The `?veg2=off` kill switch for ADR-0292's vegetation growth, which this contract also named,
     was deleted on 2026-09-24 with the flat vegetation layer it switched off — ADR-0608 D2/D3. The
     cursor itself is unchanged; only the flat accretion / vegetation / road-mask animation it drove
     was retired.)*
   - **covers —** `apps/studio/src/components/act2Intro.ts:39-49`
   - **proven by —** `apps/studio/src/components/act2Intro.test.ts:28`, `:33` (REAL, passing)
2. **`first-arrival-is-recorded-once-and-fails-toward-playing`** — ADR-0286's play-on-first-arrival,
     and the hostile-storage path
   - **asserts —** the session flag is unset on arrival and set once recorded; recording twice still
     reads as ONE arrival (idempotent, so a double-mount cannot suppress the run); and with no
     storage available it fails TOWARD playing and never throws on a hostile storage object. Failing
     toward playing is the deliberate direction: a missing `sessionStorage` should cost a repeated
     intro, never a silently dead one.
   - **covers —** `apps/studio/src/components/act2Intro.ts:51-96`
   - **proven by —** `apps/studio/src/components/act2Intro.test.ts:138`, `:146`, `:153` (REAL,
     passing)
3. **`back-steps-to-the-top-of-the-current-wave-before-the-previous-one`** — the transport
     arithmetic every control button sits on
   - **asserts —** the cursor reads back to the wave it is in (`waveAtProgress`); Back goes to the
     TOP of the current wave before stepping to the previous one, so a half-played wave replays
     rather than being skipped past; Back never steps past nothing; and repeated Back walks the
     whole forest back to nothing in a BOUNDED number of steps, so no input can leave the transport
     spinning.
   - **covers —** `apps/studio/src/components/act2Intro.ts:280-305`
   - **proven by —** `apps/studio/src/components/act2Intro.test.ts:68`, `:75`, `:83`, `:88` (REAL,
     passing)
4. **`the-plan-key-tracks-what-the-plan-reads-and-nothing-else`** — what makes a re-fetch invisible
     and a real change loud
   - **asserts —** the key is identical for a re-fetched copy of the same graph and independent of
     the order stories and edges arrive in (the payload is not order-stable, and an order-sensitive
     key would restart the run on every poll); it CHANGES when anything the plan reads changes; and
     it shrugs off a sub-unit float wobble in the routed geometry, so a rounding difference in a
     coordinate cannot masquerade as a new graph.
   - **covers —** `apps/studio/src/components/act2Intro.ts:207-226`
   - **proven by —** `apps/studio/src/components/act2Intro.test.ts:180`, `:188`, `:194`, `:222`
     (REAL, passing)
5. **`the-speed-dial-scales-the-clock-not-the-schedule`** — the single-cursor property, fenced from
     the dial side
   - **asserts —** the plan is crossed in its own duration at 1x; the run stretches below 1x and
     compresses above it PROPORTIONALLY; a speed that would stall or reverse the run is refused and
     falls back to the plan's own pace; and every island forms at the same FRACTION of the run
     regardless of speed. That last one is the discriminator: a second timeline beside the cursor
     would let the schedule drift from the clock, and only a fraction-of-run assertion catches it —
     a wall-clock assertion would pass either way.
   - **covers —** `apps/studio/src/components/act2Intro.ts:306+` (the `useAct2Intro` clock loop)
   - **proven by —** `apps/studio/src/components/act2Intro.clock.test.tsx:94`, `:112`, `:123`,
     `:132` (REAL, passing)
6. **`a-fresh-plan-never-opens-on-a-frame-of-the-grown-forest`** — the flash that actually shipped
   - **asserts —** a fresh plan rests on the settled forest by default (the ordinary map is not an
     animation); but while a start is PENDING the cursor opens on nothing, and the FIRST arriving
     plan opens on nothing too. The first-plan case is called out separately because it is the one
     that actually flashed: the general pending rule held while the very first plan still painted a
     grown frame before the run began.
   - **covers —** `apps/studio/src/components/act2Intro.ts:306+` (the opening cursor inside `useAct2Intro`)
   - **proven by —** `apps/studio/src/components/act2Intro.clock.test.tsx:153`, `:160`, `:170`
     (REAL, passing)
7. **`an-identical-re-fetch-does-not-restart-the-run`** — the single-cursor property, fenced from
     the data side
   - **asserts —** an identical story array arriving mid-run keeps the cursor running rather than
     resetting it, and a graph that really changed still invalidates the cursor. The studio's tree
     payload is cached-then-confirmed (`map-payload-cache`), so a run is routinely handed a second,
     structurally identical copy of its own graph part-way through; without this the regrow would
     visibly restart on every confirm. Both halves are required — keeping the cursor across a REAL
     change would leave the map animating a graph it no longer has.
   - **covers —** `apps/studio/src/components/act2Intro.ts:207-226,306+`
   - **proven by —** `apps/studio/src/components/act2Intro.clock.test.tsx:187`, `:212` (REAL,
     passing)
