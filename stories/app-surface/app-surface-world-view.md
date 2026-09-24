---
id: "app-surface-world-view"
tier: capability
story: app-surface
arc: chapter2-real-app-surface-arc
title: "A deterministic typed world model delegates to the real shared SceneView"
outcome: "A compact `WorldSceneView` accepts a deterministic typed `WorldPresentationModel` plus separate optional `WorldPresentationEvents`, derives the relocated SceneView context without live authority, and delegates the representative semantic scene and event callbacks to the already-green shared renderer."
status: proposed
proof_mode: integration-test
depends_on: []
decisions: [237, 93, 230, 70]
# NET-NEW missing seam only. AUTHOR_TEST writes WorldSceneView.test.tsx against the missing wrapper;
# IMPLEMENT authors WorldSceneView.tsx. SceneView and the trail/lane/neighbour/regrow/native-target
# helpers are ALREADY relocated with their own green package tests. They remain the package
# proofCommand's reliability regression evidence, not behaviours this test must recreate.
# ADR-0608 (2026-09-24): the flat forest PICTURE retired — the sprite manifest/resolver/sizing, the
# painted island and flat vegetation are deleted — and `SceneView` is now the map's SVG INTERACTION
# layer over the mounted 3D land (nameplates, wisps, hit geometry, lanes, shore rings, native plant
# targets, caves). This wrapper's seam is unchanged; only what the delegate draws narrowed.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/app-surface", "test"]
  scope:
    testGlobs: ["packages/app-surface/src/WorldSceneView.test.tsx"]
    sourceGlobs: ["packages/app-surface/src/WorldSceneView.tsx"]
  # ADR-0353 — the READ-ONLY coverage surface: where THIS capability's contract tests actually live.
  # The `real:` arm below is the WRITE fence for the one net-new wrapper leaf (WorldSceneView), which
  # is why contract 4 — the §5 honesty wall on the ALREADY-RELOCATED shared `SceneView` this wrapper
  # delegates to — cannot live inside it. `SceneView.test.tsx` is part of the 103 green package tests
  # the `proofCommand` above already reruns as regression evidence; this block is only what lets the
  # sweep LOOK there. Declaring it widens the aperture; it moves no write fence and adds no leaf.
  coverage:
    testGlobs:
      - "packages/app-surface/src/SceneView.test.tsx"
  real:
    testFile: "packages/app-surface/src/WorldSceneView.test.tsx"
    sourceFile: "packages/app-surface/src/WorldSceneView.tsx"
    scope:
      testGlobs: ["packages/app-surface/src/WorldSceneView.test.tsx"]
      sourceGlobs: ["packages/app-surface/src/WorldSceneView.tsx"]
    install: true
    proofCommand:
      file: pnpm
      args: ["--filter", "@storytree/app-surface", "test"]
    typecheck:
      file: pnpm
      args: ["--filter", "@storytree/app-surface", "typecheck"]
---

# A deterministic typed world model delegates to the real shared SceneView

**Outcome —** A compact `WorldSceneView` accepts a deterministic typed
`WorldPresentationModel` plus separate optional `WorldPresentationEvents`, derives the relocated
`SceneView` context without live authority, and delegates the representative semantic scene and
event callbacks to the already-green shared renderer.

## Proof status and boundary

The first real-build attempts proved the original authored leaf was too broad: Codex reached a
genuine `CONFIRM_GREEN` red, while Claude exhausted 16 turns trying to author one oversized test.
The infrastructure beneath the missing seam is already present and independently green: the
shared `SceneView` interaction layer and its trail/lane/neighbour/regrow helpers carry their own
package tests. (The sprite manifest/resolver/sizing/fallback that stood here until 2026-09-24 was
deleted with the flat forest picture, ADR-0608 D2/D3.)

This leaf therefore authors only the missing typed wrapper. The package proof command reruns those
tests as regression evidence after the new pair greens; `WorldSceneView.test.tsx` does not copy
their fixture matrix or re-prove every lane, trail and arrival contract.

## Guidance

- Define one plain-data `WorldPresentationModel` containing exactly:
  - the `SceneNode` scene;
  - the selected story id and the emphasized story ids;
  - hidden statuses;
  - arrival ids;
  - the neighbour-highlight plan, the lane layout and the lane motion; and
  - the optional forest-regrow and native-plant-target render layers.
  (The resolved sprite sheet and art scale it once carried retired with the flat picture, ADR-0608.)
- Normalize set-like inputs deterministically: stable, duplicate-free ids/statuses and stable
  defaults. Equal plain inputs must yield deeply equal models. Time and randomness are absent.
- Define `WorldPresentationEvents` separately. Its selection callbacks are optional so the same
  wrapper admits Studio's operable controller and a later Chapter 2 read-only controller without a
  fake mutation.
- `WorldSceneView` translates that model/events pair into the existing `SceneCtx`, then renders the
  already-relocated `SceneView`. It does not reproduce `renderNode`, trail/arrival selection or
  any other renderer logic.
- The source imports only public browser-safe seams from this package and
  `@storytree/forest-world`. It imports no `apps/studio` module, API/store client, subscription,
  promise, clock, random source or DOM animation authority.
- Keep the story boundary unchanged: legend, inspector, chat, camera shell/controller, bulk CSS,
  semantic replay and reduced-motion visual proof remain later increments.

## Integration test

One compact `WorldSceneView.test.tsx` proves the missing seam:

1. Build the model twice from equal plain inputs, including unordered/duplicated set-like values.
   Assert deeply equal normalized output and stable defaults.
2. Render one representative semantic scene through `WorldSceneView`. Assert one existing semantic
   scene marker survives delegation, then activate one selectable node and assert the optional
   event callback receives its id.
3. Inspect/import the wrapper source boundary and assert it has no Studio-private or live-authority
   import. The package proof command then observes the existing interaction-layer, lane and trail
   tests still green.

## Contracts (4)

1. **`aswv-equal-plain-inputs-normalize-deterministically`**
   - **asserts —** equal scene/model inputs normalize to deeply equal output; selected/emphasized
     ids, hidden statuses and arrival ids are stable and duplicate-free, with deterministic defaults.
2. **`aswv-delegates-one-semantic-scene-and-event`**
   - **asserts —** `WorldSceneView` preserves one representative semantic marker from the relocated
     `SceneView`, and a selectable node reports its id through the separate optional events seam.
3. **`aswv-wrapper-has-no-private-or-live-authority`**
   - **asserts —** `WorldSceneView.tsx` imports no Studio-private module or network/store/
     subscription/clock authority and contains no duplicate scene/sprite/trail renderer.
4. **`aswv-claim-wisp-never-painted-as-proven-green`** — the shared `SceneView` this wrapper delegates
   to never paints a CLAIM as proven: no proof class reaches any claim-family
   wisp, in any grade, on departure, or under a green build band (the ADR-0138 §5 honesty wall, at the
   rendered-DOM tier)
   - **asserts —** rendering through the real `SceneView` and querying the produced DOM, in three
     directions. **(a) Class-level:** a `proving` claim renders `.world-claim-wisp.state-proving` which
     itself carries neither the island's proven-green status class (`st-healthy`) nor `verdict-pass`,
     and whose subtree contains neither — `proving` being the at-risk in-flight hue that must not read
     as proven-green (ADR-0040). **(b) Under a GREEN band (ADR-0212):** a `work` claim folded with
     phase `GATE`
     renders `.world-claim-wisp.band-green` that STILL carries `state-proving` (the intent hue survives;
     green is expressed as motion, never as colour), whose own class attribute matches neither
     `st-healthy` nor `verdict`, and whose subtree holds no `.st-healthy` and no
     `[class*="verdict-"]`. **(c) Across
     the whole claim family (ADR-0200 D7):** the hover (`exploring`), queue (`waiting`) and departing
     wisps each carry neither `st-healthy` nor `verdict-pass`, and the hover and departing subtrees
     hold no proof class either.
   - **note — RE-EXPRESSED 2026-09-07 under ADR-0536, unchanged in FORCE (ADR-0529 is what moved).**
     This contract used to say *"never paints a CLAIM as the proven-green bloom"* and enumerated
     `.world-bloom` / `.bloom-ring` / `.bloom-spark` / `.bloom-crown` / `.bloom-plant`. ADR-0529
     retired the verdict bloom and its drawing code is deleted, so those five classes can no longer
     be emitted by anything — an assertion naming them would be satisfied by the type system and
     would be a check that verified nothing. The wall itself is NOT weakened and is not narrowed: the
     proof vocabulary the map still carries is the island's proven-green STATUS hue (`st-healthy`),
     which is the durable record and was always the thing that mattered, so that is what a
     coordination drawable must never wear. One-directional by design: the CONVERSE (a proof
     drawable reaching for claim styling) is not this contract's claim and remains uncovered here.
   - **covers —** `packages/app-surface/src/SceneView.tsx` (the claim / hover / queue / departing wisp
     renderers) — the already-relocated shared renderer this capability's wrapper delegates to, not the
     wrapper itself.
   - **proven by —** `packages/app-surface/src/SceneView.test.tsx` — three tests, one per direction:
     *"§5 HONESTY WALL: a claim wisp NEVER wears the proven-green status class (class-level)"*,
     *"ADR-0212 honesty wall: a GREEN build band never paints the claim body as a proof"*, and
     *"§5 HONESTY WALL extended: hover / queue / departing wisps never wear the proven-green status
     class (ADR-0200 D7)"*. Each carries this contract's id verbatim in its title. *(The first and
     third titles named the bloom until ADR-0529/ADR-0536; they were re-aimed in the same landing
     that deleted it, not dropped.)* All three sit in the already-green package tests the declared
     `pnpm --filter @storytree/app-surface test` command reruns, and are reached by the ADR-0353 sweep
     via the `proof.coverage.testGlobs` surface declared above, since the `real:` arm's write fence is
     the net-new `WorldSceneView` leaf.
   - **note — declared for CITATION, on the capability that already stands for the shared renderer.**
     This contract exists so a lower-tier citation of the wall (the ADR-0294 D2 deletion of
     `wisp-as-story-claim#uat-7`) can name a contract id instead of a free-form test title. It is
     declared here because this story already treats `app-surface-world-view` as the node standing for
     the relocated shared `SceneView` — the story's own legacy-UAT table routes `SceneView.test.tsx`
     under this capability — and because no other live `app-surface` capability owns the renderer
     (the organic-growth and SVG-land capabilities that once named `SceneView.test.tsx` in their
     globs retired with the flat picture, ADR-0608). It adds no leaf and moves no write fence: the tests are standing, green, and
     older than this declaration. Unlike contracts 1–3 it carries `covers —` / `proven by —` bullets,
     the render-core house shape, because a citation is only resolvable if the binding is written down.
