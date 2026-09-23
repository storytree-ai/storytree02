---
id: "studio"
tier: story
title: "The studio"
outcome: "An operator reviews the project record through one browsable forum studio."
status: proposed
proof_mode: UAT
arc: story-green-monotonicity-arc
capabilities: [dev-server-persistence-backbone, read-corpus, annotate-topic, browse-library, author-library-artifact, chat-panel, hud-chrome, verified-attribution, coalesced-camera-pan, map-route-retention, map-payload-cache, map-server-memo, map-boot-independence, compositor-pan-transform, camera-rasterisation-probe, act2-regrow-camera-zoom-out, act2-regrow-camera-frame-delivery, arc-orientation-lens, act2-intro-cursor, store-connection-signal, map-live-hierarchy-read]
# ⚠ TWO CAPABILITIES LEFT THIS LIST ON 2026-08-31 (`prove-unproven-capabilities-arc` inc-25, Group 2).
# `seed-library-corpus` and `resolve-comment` are `status: retired` and are removed from the array so
# the tree stops rendering them as live work — the `context-window-meter` precedent next door.
# Their FILES are kept (each opens with a ⚠ RETIRED banner carrying the evidence), because a
# retirement with a reason is recoverable and a deleted file is not:
#   - `seed-library-corpus` — the seeder, BOTH its inputs (`docs/glossary.md`, ADR-0135;
#     `docs/decisions/`, ADR-0403 dec 1) and its output file are all deleted. There is no surface to
#     re-scope onto: artifacts are written straight to the live store, so the build-time derivation
#     STEP is gone rather than moved.
#   - `resolve-comment` — ADR-0425 dec 1 retired studio commenting deliberately, MULTIPLAYER named as
#     the revival trigger. No operator-reachable resolve affordance exists. ⚠ This retires the
#     CAPABILITY, never the code: dec 5 deliberately KEEPS the server-side comment store, its routes,
#     the `api.createComment`/`updateComment`/`deleteComment` client methods and the proven
#     `InlineCommentThread`/`ReviewBlocks` pair as the revival's foundation. A later session must not
#     read this removal as licence to sweep them.
# Nothing else in `stories/**` `depends_on` either id; `browse-library`'s edge onto
# `seed-library-corpus` was dropped in the same pass.
# Story-level edges: the "Cross-story boundary" section below, encoded (consumed seams,
# ADR-0010 §4; code-import-evidenced — see that section for file:line). ADR-0036. As of ADR-0100
# the studio app is a consuming SURFACE in the boundary scan (check:boundaries now walks apps/*),
# so EVERY @storytree/* runtime dep is a declared + forest-rendered edge — not just the first three.
# ADR-0112: the studio server now lazy-imports @storytree/drive (the build/orchestrate drivers carved
# out of cli) for its db-control / build surfaces and DROPPED its @storytree/cli dependency — so the
# `cli` edge is gone. The drive surface is owned by drive-machinery, already in depends_on below, so
# this is a re-pointing of the same code edge to a narrower package, not a graph change.
# ADR-0237 increment 1: Studio is the first consumer of `@storytree/app-surface`; the shared package
# owns the world-scene slice while Studio retains TreeView's controller and surrounding chrome, so
# the consumer-side `app-surface` edge is declared here.
# ADR-0267: the arc surface's read path needs the `Store` SEAM itself, not the rendered asset wire —
# `LibraryBackend.docStore()` hands the live store to the shared arc rollup so the studio and
# `storytree arc show` derive one join. That makes `storage-protocol` a declared edge here. It is a
# TYPE-only import today (the runtime value is the pg store the backend already builds), but
# check:boundaries reads the code graph, not the emit, and a type edge is still a real coupling.
# `traversal-panel-arc` (increment `traversal-panel-read-route`): the studio serves one session's
# replayed context traversal at GET /api/traversal, read from this machine's LOCAL JSONL trace dir.
# BOTH traversal edges are real and neither is a re-export of the other: the STRUCTURED replay (with
# its installed-adapter coverage composition) comes from `context-traversal-spawn`, while the trace
# dir resolution and the session INDEX come from the sink in `context-traversal-capture` — the same
# two packages `packages/cli/src/traversal.ts` imports for the same two jobs. The runtime values are
# pulled lazily inside the handler (the vite config-load trap), but check:boundaries reads the code
# graph rather than the emit, so both are declared here.
# `linked-session-context-arc` (increment `make-the-single-window-meter-useful`, ADR-0452 D1/D2): a
# THIRD traversal edge, onto `context-traversal-transcript`. GET /api/context-windows reads the HOST
# TRANSCRIPTS directly through that story's `readWindowOccupancySeries` / `readContextWindows`, and it
# is not a re-point of either edge above: those two read the INGESTED trace, and occupancy reaches a
# trace only through an explicit `storytree traversal ingest` — measured 2026-08-26, 2 of 697 local
# traces carry it, so a trace-backed reading would be blank for the session looking at it. Reading the
# same files through the same reader (rather than re-deriving the parse rules studio-side) is what
# stops the surface and the ingest describing one transcript differently. Lazy-imported inside the
# handler like the other two, and declared for the same reason.
#   ⚠ THE EDGE SURVIVED THE CONTEXT TAB'S RETIREMENT, and its REASON is what moved (ADR-0456 D1/D2,
#   increments `merge-the-context-meter-into-the-traversal-surface` / `retire-the-standalone-context-tab`).
#   It was declared for the standalone Context tab; that tab and the `context-window-meter`
#   capability are RETIRED, and the same route now serves the TRAVERSAL REPLAY PANEL's own occupancy
#   bar at `?session=<windowId>` — the bar that has been in the owner-signed design since
#   `traversal-panel-spine-render` and had never drawn a real reading here. So this is not an edge to
#   sweep away with the widget: `apps/studio` still imports that package, and the import is now the
#   panel's rather than the meter's.
# `arc-tier-extraction-arc` (ADR-0369): the arc → children JOIN this server's `handleArcs` serves is
# no longer in `@storytree/drive` — ADR-0369 D1 gave the arc domain its own package and D2 fixed the
# arrow at arc → drive, so `drive`'s barrel dropped the `arc-rollup` re-export and this app now
# runtime-depends on `@storytree/arc` directly. It is a RE-POINTING of the same code edge onto a
# narrower package, exactly like the ADR-0112 cli → drive re-point above, not a new coupling: the
# studio still derives the SAME single join `storytree arc show` renders, which is ADR-0267's whole
# guarantee, and it still does not import `@storytree/cli`. The module is pulled lazily inside the
# handler (the vite config-load trap, same as `loadDrive()`), but check:boundaries reads the code
# graph rather than the emit, so the edge is declared here.
# `mount-the-land-on-a-real-surface-arc` (increment `a-land-view-beside-the-working-map`, ADR-0530
# route C staged as its first half): the studio mounts the 3D LAND — `@storytree/forest-world-r3f`,
# owned by `website-experience` — as a SECOND view beside the SVG map. The edge reads oddly at first
# glance (a studio depending on the website's story) and it is the honest one: that package is where
# the 3D mapper and canvas live, and ADR-0530 named this exact coupling as a cost taken knowingly
# ("the two-repo mirror tax starts being paid by studio work"). It is a real runtime edge even though
# the canvas is `React.lazy`-loaded — check:boundaries reads the code graph, not the emit, the same
# reading that makes the three traversal edges above declarable.
depends_on: [library, drive-machinery, notice-board, forest-world, studio-members, proof-protocol, uat-criterion-detail, art-factory, app-surface, storage-protocol, context-traversal-spawn, context-traversal-capture, context-traversal-transcript, arc, website-experience]
# Deciding ADRs (ADR-0037 §2): UI-drives-agents (8), the story world (36, recalibrated by 38),
# the app brought into the boundary scan as a consuming surface (100), the drive-package
# extraction that re-pointed the build/secrets seam off cli onto @storytree/drive (112), the
# garden-composition fold that added the baked-kit import (221), the art-factory split that
# makes that import a declared cross-story edge (222), the shared app-surface extraction (237),
# map route retention before caching or density work (240), and the measurement that re-costs a pan
# frame and moves the camera off the SVG `<g>` for the duration of a gesture (272). ADR-0240's staged
# order was taken one increment at a time: stage 1 is `map-route-retention` (retain the map across SPA
# routes), stage 2 is `map-payload-cache` (persist and paint the two READ-ONLY payloads, stamped and
# paint-then-revalidate), stage 3 is `map-server-memo` (memoize the `stories/` and `docs/` walks
# behind a fingerprint that moves on a content edit, and add `no-cache` + `ETag` validators to the
# two read routes — what makes the always-revalidate stage 2 mandated actually cheap), stage 4 is
# `map-boot-independence` (de-serialise the boot so the map's own fetch starts as soon as membership
# resolves). ADR-0240's stage 5 was to be the density budget; ADR-0272 measured a pan frame as ~99.8%
# RASTERISATION and DE-SEQUENCED density (D3) — ~85% of the map would have to disappear to fix pan
# that way — so stage 5 is `compositor-pan-transform` (D2: the camera stops being a `<g transform>`
# for the duration of a gesture). 272 is therefore a NEW deciding ADR here: it amends 240's decisions
# 1 and 3 and changes which increment this story authors next.
decisions: [8, 36, 38, 100, 112, 221, 222, 237, 240, 272, 313]
---

# The studio

**Outcome —** An operator reviews the project record through one browsable forum studio.

apps/studio is a hand-built, single-process Vite dev app (run with `pnpm --filter studio dev`) that turns the repo's own docs/ corpus and a synthesised guidance Library into a reviewable forum: read rendered ADRs/glossary, anchor comments onto exact text spans / sections / whole topics and resolve them, and browse-author-seed a categorised Library of injectable guidance artifacts. The backend serves docs read-only from <repo>/docs and persists through the LibraryBackend seam: Cloud SQL in the live posture, or the offline JSON stores (`comments.json` plus the knowledge-derived, gitignored `assets.runtime.json`) used by the scripted UAT. HONESTY: every unit below is a RETROSPECTIVE spec over already-working code: each contract describes the isolated unit test that WOULD prove a leaf (citing real code at file:line), each capability describes the integration test that WOULD prove it against its real in-story collaborators (no stubs within the organism), and the single story-level UAT below describes the acceptance walkthrough that WOULD prove the whole organism against the real running app. The package carries test tooling (a vitest suite in `pnpm -r test` scope and the scripted Playwright story UAT — see § Proof), but no passing proof ceremony is claimed here. Nothing here is authored proven or healthy; proof state derives from signed evidence.

> **Historical note (librarian pass, 2026-07-18; UAT re-tensed 2026-07-25):** the `assets.json` /
> `seed.assets.mjs` machinery retained in the retrospective capability prose is **retired** —
> `seed.assets.mjs` → the `build-corpus.mjs`
> generator at ADR-0018, artifact state to the live Cloud SQL store at ADR-0023, and the last committed
> `assets.json` + `build-corpus.mjs` at ADR-0210. The studio's Library tier is now DB-backed (the offline
> backend derives its view at runtime from the library's committed FIXTURE corpus,
> `@storytree/library/fixture`, plus `@storytree/library` `libraryTemplates()` — ADR-0302 D1 deleted the
> `knowledge.json` that seed used to read, and the fixture is a small sandbox seed, not a copy of the
> Library);
> comments likewise moved to the store in the live posture. The Story UAT below is current: its offline
> proof seam exercises `comments.json` plus derived `assets.runtime.json`, never the retired `assets.json`.

> **Historical note (ADR-0425, 2026-08-23):** two more spans of the retrospective prose above and
> below now describe surfaces the product has moved off. **Commenting**: "anchor comments onto exact
> text spans / sections / whole topics and resolve them" describes what was built, and ADR-0146
> replaced the surface that did it without re-wiring the replacement — so the studio could show a
> comment but never file one. ADR-0425 dec 1 **retires studio commenting deliberately**, naming
> MULTIPLAYER as the revival trigger: the owner never adopted it and grounds his conversations
> against the Library from Claude Code or Codex, so a collaboration surface has, for now, nobody to
> collaborate with. The studio-side half-promise is removed; the SERVER-side comment store, its
> routes, and the proven `InlineCommentThread` component are deliberately KEPT (dec 5) as the
> revival's foundation. *(One clause of this note is corrected in place, 2026-08-31: it went on to
> say "which is why the capabilities describing them are not retired here." `resolve-comment` IS now
> retired — see the note below. The correction is that dec 5 keeps the CODE, which was never the
> same claim as keeping the CAPABILITY; a unit whose outcome is an operator act nobody can perform
> is retired whatever survives beneath it.)*
> **Decisions**: "read rendered ADRs" no longer means reading a file — ADR-0403 dec 1 made decisions
> ordinary Library artifacts and deleted `docs/decisions/`, so a decision is browsed, cited and
> opened exactly like any other artifact. The UAT below is rewritten onto both (dec 3/dec 4); no leg
> is cut, and the step count is unchanged.

> **Historical note (`prove-unproven-capabilities-arc` inc-25, 2026-08-31):** the retrospective
> paragraph above still promises three things this studio does not do, and each has a different
> answer. **"seed"** — "browse-author-seed a categorised Library" names a build-time seeder that is
> deleted along with both of its inputs and its output file; `seed-library-corpus` is RETIRED and
> there is nothing to re-scope it onto, because artifacts are now written straight to the live store
> and no derivation step remains. **"resolve them"** — `resolve-comment` is RETIRED for the reason
> the ADR-0425 note above gives; the story UAT already carries the standing proof, criterion 13's
> byte-identical `comments.json`. **"browse"** — the chip-grid Library page and the `#/library` route
> are gone, retired deliberately by `library-tech-tree-overlay`'s own
> [`library-retire-standalone-page`](../library-tech-tree-overlay/library-retire-standalone-page.md)
> on ADR-0185 dec 6 after the owner attested the lens on 2026-07-15. That replacement is a WHOLE
> STORY of seventeen capabilities whose sources live under `apps/studio/src` on a declared
> hosted-story edge (ADR-0192), so this story did NOT keep the browse outcome and must not re-author
> it. What it kept is the artifact DETAIL render (`AssetView` at `#/asset/<id>`, which ADR-0185 dec 6
> explicitly preserved and which `LibraryDiveBody` routes into "never a re-authored renderer"), and
> `browse-library` is narrowed onto exactly that. `read-corpus` is narrowed the same way onto
> `DocView`, its sibling. Neither narrowed unit is given a `proof:` block: real coverage exists
> around them and does not reach their own outcomes, and that absence is the recorded finding rather
> than an omission.

## What this is

This is storytree's **first story** — the seed of the self-building tree, authored by
hand (the bootstrap "midwife" step) by decomposing what was really built in
`apps/studio`. A **story** is a **bounded context** — a self-contained organism, the
unit of independent deployability (the microservice grain, ADR-0010) — composed of
capabilities, and the map grain a newcomer points at (ADR-0002). Under the organism
model the proof ladder shifts up one rung: the **story** carries the integrated **UAT**
(the acceptance walkthrough of the whole organism against real collaborators), each
**capability** is proven by an **integration test** against real *in-story*
collaborators (no stubs within the organism), and each **contract** stays the isolated
unit-test leaf (ADR-0010 §2).

Every dependency below is a within-story code-derived edge, and nothing here runs
against a stubbed upstream interface. This story now **owns one declared cross-story
interface** (ADR-0010 §4): the **comment substrate**
([`interface-comment-substrate.md`](interface-comment-substrate.md), declared 2026-06-11)
— the store-seam comment surface `stories/feedback-graduation` consumes. As a **consuming
surface** (ADR-0100 — `apps/studio` is a sink the boundary scan now walks) it also **declares
every cross-story seam it rides**: the original three (the pg/library backend, the
drive-machinery node-spec + verdict stream, the notice-board presence surface) plus the
render-core, access-control, verdict-shape and build/secrets seams that arrived later (the
build/secrets seam re-pointed off `cli` onto `@storytree/drive` by ADR-0112) — see
§"Cross-story boundary" below.

See [`../README.md`](../README.md) for the representation and how every field maps to
ADR-0002 / `docs/glossary.md`.

## Capabilities (21)

Listed roots-first (a capability appears after everything it depends on). The count and the ordinals
moved on 2026-08-31 (`prove-unproven-capabilities-arc` inc-25): `seed-library-corpus` and
`resolve-comment` are RETIRED and left the list, `map-live-hierarchy-read` was in the frontmatter
array but had never been given a row, and four surviving rows are re-worded onto what their
capabilities now actually deliver.

| # | capability | outcome | depends on |
|---|---|---|---|
| 1 | [`dev-server-persistence-backbone`](dev-server-persistence-backbone.md) | Every studio surface reaches its data through one `/api/*` route table that claims the namespace before the SPA fallback, answers a failure as a typed JSON envelope rather than an HTML shell, and persists through a store seam whose writes survive the process that made them. | — |
| 2 | [`read-corpus`](read-corpus.md) | An operator opens a reference document by deep link or in-corpus cross-link and reads it as rendered markdown, and a link the doc index cannot resolve says why instead of reading as absent. | `dev-server-persistence-backbone` |
| 3 | [`annotate-topic`](annotate-topic.md) | An operator anchors a comment onto a precise place in a rendered topic. *(`status: retired` — superseded by `library-review`'s block-anchored surface; kept in this list, unlike the two retired above, because nothing in this pass adjudicated it.)* | `dev-server-persistence-backbone`, `read-corpus` |
| 4 | [`browse-library`](browse-library.md) | An operator opens a single Library artifact and reads its rendered detail, and a corpus that has not loaded is never presented as an artifact that does not exist. *(Narrowed: the BROWSE half moved to the `library-tech-tree-overlay` story, ADR-0185 dec 6.)* | `dev-server-persistence-backbone` |
| 5 | [`author-library-artifact`](author-library-artifact.md) | An admin durably changes the Library's contents through the structured editor form, and the store — not the form — is what refuses invalid or unauthorised writes. ⚠ EDIT and DELETE have no automated coverage of any era. | `dev-server-persistence-backbone`, `browse-library` |
| 6 | [`chat-panel`](chat-panel.md) | The studio frontend renders a chat panel — a thin client that POSTs the operator's intent to `/api/chat`, streams the SSE response, and renders the `done` proposal / `error` / `refused` outcomes (and an honest disabled state where the route is absent), importing no agent/drive/model code. | — |
| 7 | [`hud-chrome`](hud-chrome.md) | The forest map becomes the landing surface and the top banner + Overview page retire: the only global chrome is a single verified-identity avatar (top-right) — no brand chip and no navigation outside it — whose menu shows the read-only identity + role and ONLY the role-/posture-gated Members, Credentials, and Sign out account items, with no Library/Documents navigation (ADR-0204, re-tensed by ADR-0205). | `dev-server-persistence-backbone` |
| 8 | [`verified-attribution`](verified-attribution.md) | Comment attribution derives from the verified `/api/me` identity everywhere: the composer presents the verified identity read-only (`operator` fallback in the open dev posture) and the post relies on the server stamp, and the localStorage operator store (`lib/operator.ts`) retires (ADR-0204 D4). | `dev-server-persistence-backbone` |
| 9 | [`coalesced-camera-pan`](coalesced-camera-pan.md) | An operator's forest drag commits the latest camera position at most once per display frame. | — |
| 10 | [`map-route-retention`](map-route-retention.md) | An operator returns to the same live forest map after a SPA hash-route transition. | — |
| 11 | [`map-payload-cache`](map-payload-cache.md) | An operator who reloads the studio sees the forest paint from the last visit's persisted payloads instead of waiting on a cold server walk. | — |
| 12 | [`map-server-memo`](map-server-memo.md) | An operator's repeated studio load is answered without re-reading a corpus that has not changed on disk. | — |
| 13 | [`map-boot-independence`](map-boot-independence.md) | An operator's forest map begins fetching its own data as soon as membership resolves, instead of waiting on Library-corpus payloads the map never reads. | — |
| 14 | [`compositor-pan-transform`](compositor-pan-transform.md) | A forest drag moves the already-rasterised map on the compositor, so the `.world-camera` `<g>` transform is written once at the end of a gesture rather than once per frame. | `coalesced-camera-pan` |
| 15 | [`camera-rasterisation-probe`](camera-rasterisation-probe.md) | A repeatable Studio diagnostic reports the rasterisation-cost delta between the real 40-island regrow growth-only baseline and cursor-driven camera-transform variants under ADR-0286's bracketed idle-floor protocol. | — |
| 16 | [`act2-regrow-camera-zoom-out`](act2-regrow-camera-zoom-out.md) | The existing Act 2 regrow carries the Studio camera from a close opening view to the ordinary fitted whole-forest view on its own cursor. | `camera-rasterisation-probe` |
| 17 | [`act2-regrow-camera-frame-delivery`](act2-regrow-camera-frame-delivery.md) | The approved Act 2 bottom-anchored zoom-out preserves its exact choreography while its stable-picture frames reach the display within one refresh interval of the growth-only control. | `act2-regrow-camera-zoom-out`, `camera-rasterisation-probe` |
| 18 | [`arc-orientation-lens`](arc-orientation-lens.md) | An owner arriving cold is oriented by the map's arc lens alone, without asking an agent to reconstruct the context. | — |
| 19 | [`act2-intro-cursor`](act2-intro-cursor.md) | The Act 2 forest regrow is driven end to end by one app-owned cursor the operator can move. | — |
| 20 | [`store-connection-signal`](store-connection-signal.md) | An operator reading the forest map can see at a glance whether the live store is connected, without opening anything. | — |
| 21 | [`map-live-hierarchy-read`](map-live-hierarchy-read.md) | The forest map reads the live hierarchy through the shared durable story-health fold, preserving established green through proof absence and rendering story failure or explicit health issues unhealthy. | — |

Rows 18–19 (`arc-orientation-lens`, `act2-intro-cursor` — rows 20–21 before the 2026-08-31 renumber) are **greenfield `proposed` units registered retrospectively** by
`capability-layer-coverage-arc` increment 4 (2026-08-07). Their implementation and tests were built
inside this initiative; registration order does not make them brownfield (ADR-0395).
They close ADR-0317's grain residue: six `repo-manifest.json` subtrees whose declared owner was this
STORY only because no capability existed for that code. Both carry a spec-borne `proof:` and no
`real:` arm (ADR-0094) — see each file's frontmatter comment for why that omission is load-bearing.

## Dependency graph (code-derived)

These are **within-story** edges, **read off the real source** (static analysis of the
imports / data-flow between capabilities), never hand-drawn from UAT need (ADR-0010 §3):
A → B means A's code actually couples to B's code inside the one organism. The graph is
acyclic; `dev-server-persistence-backbone`, `chat-panel`,
`coalesced-camera-pan`, `map-route-retention`, `map-payload-cache`, `map-server-memo`,
`map-boot-independence`, `camera-rasterisation-probe`, `arc-orientation-lens`,
`act2-intro-cursor`, `store-connection-signal` and `map-live-hierarchy-read` are the roots.
(`seed-library-corpus` was a twelfth root until 2026-08-31; it is retired and its one outbound edge,
onto `browse-library`, is dropped with it.) (Cross-story edges are NOT in this graph — they are boundary
interfaces, declared in §"Cross-story boundary" below and encoded as frontmatter `depends_on` —
ADR-0010 §4.)

- `read-corpus` → `dev-server-persistence-backbone`
  - read-corpus owns its doc handlers (`listDocs`, `safeDocPath`, `handleDocs` — in `server/apiRouter.ts` since the route table moved there under studio-cloud's `serve-mode`) but **rides** the backbone's `/api/*` dispatch: `handleDocs` is reached only because the middleware registered directly in `storytreeDataApi.configureServer` claims the namespace before Vite's SPA fallback, and because `handleApiRequest`'s table routes to it. The coupling is that shared dispatch seam, read straight off the code — unchanged in substance by the move, and re-cited 2026-08-31 (every `devApi.ts:NNN` in this bullet's previous wording pointed at code no longer in that file).
- `annotate-topic` → `dev-server-persistence-backbone` *(both annotate bullets describe a RETIRED
  capability — `annotate-topic` is `status: retired`, superseded by `library-review`'s block-anchored
  surface. Kept as the record of what the edges WERE; noted 2026-08-31 that the code they cite is
  deleted, so read no path in them as current.)*
  - The annotate UI called api.createComment → POST /api/comments, whose handler runs readAnchor + the store write, and re-found highlights from the GET round-trip — annotate's data path was literally the backbone's comment persistence handlers. (The handler survives in `server/apiRouter.ts`; the caller does not.)
- `annotate-topic` → `read-corpus`
  - annotate-topic mutated the DOM read-corpus renders: useAnnotations injected `<mark>`s into the memoized markdown subtree and read slugged heading ids produced by read-corpus's slugify/parseHeadings — its anchors were computed against read-corpus's rendered output, a direct render-layer coupling. (`src/lib/useAnnotations.tsx` and `src/lib/annotate.ts` are both DELETED; `DocView`'s memo survives, and `slugify` survives with a different second consumer — see `read-corpus.md`.)
- ~~`resolve-comment` → `dev-server-persistence-backbone`~~ — **edge withdrawn 2026-08-31**, with the capability. `resolve-comment` is retired (ADR-0425 dec 1): `CommentPanel.tsx` is deleted, so `toggleResolved` and the `api.updateComment` call it made no longer exist. The PATCH ROUTE it rode is deliberately kept (dec 5) and is now the backbone's own business — `dev-server-persistence-backbone` carries the `resolvedAt` stamp/clear contract, which is what keeps that retention honest rather than dead.
- `browse-library` → `dev-server-persistence-backbone`
  - `AssetView` renders from the `AppData` corpus populated by `GET /api/assets`, served by the backbone's route table over whichever store `selectedStore()` picked; the component itself never fetches — it looks the id up in the already-loaded array — so its entire data path is backbone code. Re-cited 2026-08-31: the previous wording named `Library.tsx` (deleted) and the on-disk JSON store (no longer the default), and paired the asset read with the doc index, which is `read-corpus`'s payload and not this unit's.
- ~~`browse-library` → `seed-library-corpus`~~ — **edge withdrawn 2026-08-31**, with the upstream. The
  data-provenance coupling was onto `apps/studio/data/assets.json`, which the seeder wrote; the
  seeder, its inputs and that file are all deleted, and the corpus now arrives over
  `GET /api/assets` from the live store (or, offline, from the JSON backend's derive-on-first-read
  seed) — which is the backbone edge already declared above, not a second one.
- ~~`browse-library` → `read-corpus`~~ — **edge withdrawn 2026-08-31**, and the reason is a deleted
  FIELD rather than a deleted file. The edge was `RefLink`: an artifact's `doc:` citation rendered as
  an in-app link into `read-corpus`'s `DocView`. ADR-0477 D1 retired the library's `references` field
  entirely, `AssetView` renders no `Sources` block, and `RefLink` is gone — so this unit's code calls
  nothing of `read-corpus`'s. Tested the other way it is equally absent. The two are now SIBLING
  renderers that `library-tech-tree-overlay`'s `LibraryDiveBody` routes BETWEEN (`plan.kind ===
  'asset'` vs `'doc'`); neither consumes the other, and a router above two leaves is not an edge
  between them.
- `author-library-artifact` → `dev-server-persistence-backbone`
  - `AssetEditor.save()` and `AssetView.remove()` call `api.createAsset` / `updateAsset` /
    `deleteAsset` → `POST` / `PATCH` / `DELETE /api/assets`, whose handler runs `readAssetInput`, the
    query-string id re-lock, and the store write whose failures `assetWriteError` maps to 400/409 —
    author's durable mutations are the backbone's asset handlers. Re-cited 2026-08-31: the handler is
    in `server/apiRouter.ts` now, and the `createdAt`/`updatedAt` stamping and the duplicate-id
    conflict moved down into the STORE, so the previous wording's `devApi.ts:291-321` named neither
    the right file nor the right layer.
- `author-library-artifact` → `browse-library`
  - After every save/delete, `AssetEditor`/`AssetView` call `refreshAssets()` and then navigate into
    the surface `browse-library` owns: create and edit land on `AssetView` at `#/asset/<id>`, and
    delete routes to `libraryHref()`. Author's post-mutation render path is that component. The edge
    SURVIVES `browse-library`'s 2026-08-31 narrowing and is tighter for it — the detail render is
    now the whole of what that capability is, and it is also where the delete confirm gate lives.
- `chat-panel` → (no within-story edge — a THIRD root)
  - chat-panel is a self-contained behavioural component (the `BuildSection` precedent): its ONLY
    backend seam is the studio `api` streaming client (the chat method it adds to api.ts / a lib helper),
    not another capability's code. It does NOT couple to `dev-server-persistence-backbone` — the chat
    route is not a persistence-backbone handler; it is the desktop's `chat-sse-mount` dispatcher (the
    studio-dev-server mount of `/api/chat` is a separate follow-on, see chat-panel.md "Where /api/chat
    lives"). The chat WIRE SHAPE it consumes (`chat-sse-mount`'s `done`/`error`/`refused` SSE frames) is a
    CROSS-BOUNDARY contract (plain JSON over HTTP against a locally-declared type), NOT a within-story
     code edge and NOT a package import — so it adds no frontmatter `depends_on` (within- or cross-story).
     See chat-panel.md "No new cross-story edge".
- `coalesced-camera-pan` → (no within-story edge — a FOURTH root)
  - The camera controller and the Studio-only chrome are neighbouring slices in `TreeView.tsx`, not
    imports from any named `studio` capability. Its shared `WorldSceneView`/`SceneView` seam is already
    the declared **cross-story** `studio → app-surface` edge; this increment neither imports a new
    package nor changes the world's model, so it adds no in-story or cross-story dependency.
- `map-route-retention` → (no within-story edge — a FIFTH root)
  - This is the App-owned route-lifetime composition around the existing `TreeView`, not an import from
    `coalesced-camera-pan`, `hud-chrome`, or any other named capability. It retains the existing Studio
    map instance without changing its controller, route parser, terminal owner, or `@storytree/app-surface`
    seam, so it adds no in-story or cross-story dependency.
- `map-payload-cache` → (no within-story edge — a SIXTH root)
  - Its own new module (`src/lib/payloadCache.ts`) plus the boot/tree-load call sites it wires are
    NEIGHBOURING slices in `App.tsx` / `TreeView.tsx` / `StoreBanner.tsx`, not imports from
    `map-route-retention`, `coalesced-camera-pan`, or `dev-server-persistence-backbone` — the same
    same-file-adjacency-is-not-an-edge call `coalesced-camera-pan` makes. Nor is it a UAT-need edge: a
    full browser RELOAD keeps nothing in memory, so route retention's delivered outcome is not a
    precondition of this capability's proof, and retention passes with no cache present. It reads
    `/api/health`'s existing `code.head` through the banner's existing poll and adds no package import,
    so it adds no in-story or cross-story dependency.
- `map-server-memo` → (no within-story edge — a SEVENTH root)
  - Its own new module (`server/corpusMemo.ts`) imports neither `readTree` nor `listDocs`; the two read
    routes call both, as they already do. The one edge a reader would reasonably question is
    `read-corpus`, which owns the doc handlers (`listDocs` / `handleDocs`) this increment wires a memo
    and a validator INTO — the honest call is that this is the same same-file-adjacency-is-not-an-edge
    reading `coalesced-camera-pan` and `map-payload-cache` already make, and it holds here for a
    stronger reason: the increment is required to leave `listDocs`'s exported signature and its returned
    VALUE unchanged (the `docsMirrorProbe` / `check:mirror-conformance` diff depends on that), so it
    consumes nothing read-corpus produces and changes nothing read-corpus renders. Nor is it a UAT-need
    edge: the proof drives a temp-dir corpus through the routes and asserts freshness and validators, so
    read-corpus's delivered outcome is not a precondition of it. It adds no package import, so no
    cross-story edge either.
- `map-boot-independence` → (no within-story edge — an EIGHTH root)
  - It removes one boot gate (`status`) and one dead boot fetch from `App.tsx`'s existing composition
    and teaches the assets consumers a not-yet-loaded state. `treeMounted` — stage 1's route-retention
    rule, owned by `map-route-retention` — is deliberately LEFT as the mount gate and is neither
    consumed nor changed, so neighbouring it in `App.tsx` is the same same-file-adjacency-is-not-an-edge
    call the three siblings above make. Nor is it a UAT-need edge: the proof holds `listAssets` pending
    and asserts `/api/tree` is nonetheless requested, which needs no sibling's delivered outcome as a
    precondition. It changes no server code and adds no package import, so no cross-story edge either.
- `compositor-pan-transform` → `coalesced-camera-pan` (a REAL edge — and the one place on this arc
  where the same-file-adjacency call does NOT apply)
  - Its four arc siblings above each recorded that neighbouring another capability's code in
    `TreeView.tsx` / `App.tsx` is not an edge, because they consume nothing those capabilities produce.
    That reasoning fails here, and the discriminator is consumption, not proximity: this capability's
    per-frame write EXECUTES INSIDE the machinery `coalesced-camera-pan` delivered — the
    `requestAnimationFrame` callback `queuePan` schedules, guarded by its generation counter, drained by
    `commitPendingPan`, force-landed by `flushPendingPan` on pointer-up — and it edits those exact
    functions to re-target that write onto the new compositor-only wrapper. Stage 1's frame boundary IS
    this unit's scheduling contract: with no coalescer there is no once-per-frame boundary to paint on
    and no trailing-edge flush to commit from, so the code coupling is a data-flow dependency read off
    the real source (ADR-0010 §3), not a UAT-need edge drawn from the ADR. Tested the other way, the
    edge is one-directional and the graph stays acyclic: `coalesced-camera-pan` needs nothing this unit
    delivers — it landed and proves green with no wrapper present. It adds no package import (the
    shared `WorldSceneView`/`SceneView` seam it paints through is the already-declared `studio →
    app-surface` cross-story edge, untouched), so it adds no cross-story edge.
- `camera-rasterisation-probe` → (no within-story edge — a NINTH root)
  - This is a Studio-owned production diagnostic around the already-shipped regrow and camera
    controller. It consumes their current public behaviour without requiring another named Studio
    capability's delivered outcome, changes no product choreography, and adds no package import. The
    existing `studio → app-surface` boundary already covers the rendered world it measures.
- `act2-regrow-camera-zoom-out` → `camera-rasterisation-probe`
  - The product zoom consumes the probe's delivered production-comparison boundary to measure the
    final shipped curve against interleaved growth-only controls under the same 40-island idle-floor
    protocol. The reverse does not hold: the probe already reports declarative camera variants without
    this product choreography, so the graph remains acyclic. The camera implementation stays
    Studio-owned and adds no package import; the existing `studio → app-surface` edge still covers the
    rendered world.
- `arc-orientation-lens` → (no within-story edge — a TENTH root)
  - The four modules this organ owns reach only `src/api.ts`, `src/lib/poll.ts`, `src/types.ts` and
    `src/lib/route.ts`'s `assetHref` — three story-grain infrastructure files no capability owns,
    plus one deep-link helper. Its mount sits beside the camera and drawer slices in `TreeView.tsx`,
    which is the same same-file-adjacency-is-not-an-edge call the four map-stage siblings above
    already make: it consumes nothing any named `studio` capability produces, and its proof takes
    rollups as PROPS, so no sibling's delivered outcome is a precondition of it. Its `ArcRollup[]`
    arrives over `GET /api/arcs` from `@storytree/drive`'s shared join — the already-declared
    `drive-machinery` and `storage-protocol` cross-story seams, untouched — so it adds no in-story
    or cross-story dependency.
- `act2-intro-cursor` → (no within-story edge — an ELEVENTH root)
  - The regrow's ORDER, geometry and render layers are `@storytree/app-surface`'s
    (`deriveForestRegrowPlan`), which is the already-declared `studio → app-surface` edge; this unit
    owns only the clock, the cursor and the transport over them. It adds no package import.
    **The one edge a reader would reasonably question runs the OTHER way:**
    `act2-regrow-camera-zoom-out` names its driver as *"the existing normalized regrow cursor"* —
    this unit's — so the camera capabilities consume it, not the reverse. Tested both ways the edge
    is one-directional and the graph stays acyclic: this unit landed and proves green with no camera
    choreography present. That inbound edge is NOT yet declared on the two camera specs; increment 4
    recorded it in [`act2-intro-cursor.md`](act2-intro-cursor.md) rather than editing them, because
    changing a `proposed` capability's `depends_on` moves `story build`'s topo order.

## Cross-story boundary (ADR-0010 §4)

Declared 2026-06-12 (ADR-0036) — these arrived with the live-store backend and the story-world
view, **after** this retro-spec's first authoring; all three are read off real imports, the
within-story standard applied across the boundary. Encoded as frontmatter `depends_on`.

- **`library`** — the **store connection seam** (`event-sourced-store-seam`): PgBackend builds
  `createPool()` → `PgLibraryStore` and renders stored docs via `renderStoredDoc`
  (`server/libraryBackend.ts:318-330`); browser code imports the schema surface
  (`@storytree/core/knowledge` / `knowledge-render` / `sources` — `src/lib/knowledgeFields.ts`,
  `src/components/AssetView.tsx`). Consumed, not absorbed. (`PgCommentStore` is NOT an edge —
  the comment substrate is this story's own declared interface.)
- **`drive-machinery`** — the **node-spec surface**: `/api/tree` loads `stories/` frontmatter
  via the orchestrator's `loadNodeSpec` (lazy-imported, `server/devApi.ts`), and the world's
  proof hues (plus the panel's verdict facts) read the gate's `events.verdict` stream
  (`server/libraryBackend.ts` latestVerdicts; hue-from-verdict per ADR-0040).
- **`notice-board`** — the **presence surface**: the world's session wisps read
  `PgPresenceStore.listActive()` and classify bands with `classifyPresence`
  (`server/libraryBackend.ts` activeSessions; ADR-0033 — advisory, silently absent offline).

Brought into the fold 2026-06-24 (ADR-0100) — the studio is a consuming **surface** the boundary scan
now walks (`check:boundaries` reads `apps/*` package.json deps), so these four seams it had ridden are
now declared + forest-rendered edges too, each read off real imports:

- **`forest-world`** — the **shared render core**: the `#/tree` world is `buildScene()`'d from the pure
  geometry kernel (`src/components/TreeView.tsx:110`, `src/components/SceneView.tsx:13`) — the studio and
  the public site draw the same look from one deterministic core (ADR-0093). Consumed as a package; the
  website consumes the synced artifact.
- **`art-factory`** — the **baked-art kit**: `src/lib/factoryBuildings.ts` imports the factory's
  build-time assets (`@storytree/procedural-architecture/kit.json` + `/stone.json`) and folds the baked
  buildings / hero garden set / stones onto the island (ADR-0221). This is a real package import
  (`apps/studio/package.json` `@storytree/procedural-architecture`), made a declared + forest-rendered
  cross-story edge by the ADR-0222 split that moved the package's ownership from `forest-world` to its
  own `art-factory` story.
- **`studio-members`** — the **access-control compute**: the server resolves member access with
  `resolveAccess` / `mergeUser` (`server/libraryBackend.ts:25`, `server/guestPolicy.ts:17`) — the
  member/user schema the Members panel renders from (ADR-0043).
- **`proof-protocol`** — the **verdict-shape port**: the server `.safeParse`s the published verdict DATA
  shapes across the seam (`server/libraryBackend.ts:26`, `server/apiRouter.ts:28`) — the browser-safe
  message format, never the proof machinery (ADR-0068 / ADR-0078).
- **`drive-machinery`** (the **build + secrets seam**, re-pointed off `cli` by ADR-0112) — the
  db-control / build surfaces lazy-import `@storytree/drive/build` and `@storytree/drive/secrets`
  (`server/devApi.ts`) — the build/orchestrate runtime the studio rides for orchestration plumbing.
  This is a SECOND seam onto `drive-machinery` (the node-spec + verdict-stream bullet above is the
  first), not a new story edge: before ADR-0112 the drivers lived in `packages/cli` and the studio
  declared a `cli` edge to reach them; the move carved them into `@storytree/drive` (owned by
  `drive-machinery`), so the studio now imports the narrower package and dropped its `@storytree/cli`
  dependency. The `cli` edge is gone from `depends_on`.

**The `chat-panel` capability adds NO new cross-story edge (recorded — the wire-shape-only call).** The
new [`chat-panel`](chat-panel.md) capability (the renderer chat panel) CONSUMES the `/api/chat` SSE wire
shape (`chat-sse-mount`'s `done`/`error`/`refused` `data:` frames), but consuming a wire shape over HTTP
is neither a package import nor a `depends_on` edge: the frames are plain JSON the panel parses against a
LOCALLY-declared discriminated union, and `@storytree/drive` (where the `ChatStreamEvent` type lives) is
on the `apps/studio/src` model-path FORBIDDEN list (`modelPathBoundary.test.ts`, ADR-0004 / ADR-0090 d.2)
— so the panel must NOT import it. The panel's single backend seam is the studio's own `api` client (the
`BuildSection` precedent), and it adds no `@storytree/*` runtime import the boundary scan (ADR-0100) would
require a declared edge for. The cross-boundary CONTRACT is the wire shape itself, owned by `desktop`'s
[`chat-sse-mount`](../desktop/chat-sse-mount.md); the panel is its consumer across the HTTP seam, enforced
by both sides authoring to the same frame, not by a code edge. So `studio`'s `depends_on` is unchanged by
this capability. (Full reasoning: chat-panel.md "No new cross-story edge".)

## UAT Test Criteria

The integrated **acceptance walkthrough** proves the whole `studio` organism end-to-end against the
real running app in Chromium (ADR-0010 §2). It is one coherent deterministic journey over the current
product: forest → Library lens → decision → grounding round trip → Library artifact →
author/edit/delete → cold restart → byte-identical cleanup. `pnpm --filter studio uat` owns the
server/browser lifecycle and pins the cross-story live-store seam to the permitted offline JSON
backend; every in-story collaborator is real. Under ADR-0106 every criterion below is therefore
`witness: machine`, bound to the exact command-bearing `studio#gate-1`.

**Goal —** One scripted operator grounds a question against the project record through the current
studio: opens the Library from the forest, reads a decision, moves to a sibling decision through the
finder, finds the artifact that grounds the question, reaches the decision behind it through the
Library and comes back, authors a structured artifact, proves durability across a cold process, and leaves both
offline stores byte-for-byte as found.

**ADR-0294 disposition (2026-08-08): all thirteen criteria KEPT, unchanged.** ADR-0294 D1 names this
story as the corpus's REFERENCE SHAPE, and re-reading it under the surgery confirms why: the thirteen
legs are consecutive steps of ONE operator walkthrough against a real Chromium and a real dev server,
not thirteen properties of a module. D2 does not reach them either — `studio#gate-1` names
`pnpm --filter studio uat`, a dedicated whole-journey Playwright run, which is a DIFFERENT command
from the `pnpm --filter studio test` suite that greens the capabilities; so no leg here is the
capability tier re-signed at the story tier. Recorded so a later reader can see this story was
adjudicated rather than skipped, and so the ~60 corpus target (D5) is not mistaken for a quota that
this story should be cut to meet — D5 says explicitly that it is not.

**ADR-0425 rewrite (2026-08-23): eight criteria RE-POINTED, still thirteen, none cut.** The
walkthrough had come to describe a studio we no longer have, and it described it in two places.
Criteria 2, 3 and 9 read a decision record as a FILE on disk, which ADR-0403 dec 1 ended by making
decisions rows in the store and deleting `docs/decisions/`; they are rewritten onto decisions as
they now are — artifacts surfaced through the Library — following that decision rather than working
around it (ADR-0425 dec 4). Criteria 4, 5, 6, 12 and 13 posted, recovered, resolved and deleted a
COMMENT; ADR-0425 dec 1 retires studio commenting deliberately, with MULTIPLAYER named as the
revival trigger, because the owner never adopted it and grounds his conversations against the
Library from elsewhere. Those five are re-pointed at the journey he actually performs — open the
Library, find the artifact that grounds a question, follow its source into the decision behind it,
read it, come back — at equal weight (dec 3). The step COUNT does not move and no ordinal is
reused: ADR-0294 D1's reference shape is what dec 3 exists to protect, so a leg whose subject
retired is REWRITTEN onto something real, never deleted to reach a greener number. Criterion 13 now
carries the retirement's own proof: `comments.json` must come back byte-identical, which is the
assertion that no studio surface wrote a comment anywhere.

**ADR-0605 move (2026-09-24): six criteria RE-POINTED, still thirteen, none retired.** The citation
tier this walkthrough leaned on is gone end to end — `3ea9c3cc` retired the artifact page's
"Sources" block and `fa4f96a5` deleted the `references` field itself, fixture pointers included —
so criteria 3, 4, 5, 6, 9 and 12 asserted a link the product no longer has anywhere. ADR-0605 moves
a leg with the feature it proves, the way a unit test goes with removed code, and forbids building
product surface just to keep a leg alive. Each was re-pointed at navigation the studio still offers
— the Library finder's Decisions scope, the full-detail overlay and its Close control, the artifact
page's `library` crumb, and route history — so the journey keeps its shape: ground a question,
reach the decision behind it, come back. Criterion ids are unchanged and revision ids advanced
(ADR-0253).

1. **Boot the current offline studio on the forest.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Let the UAT-managed Vite process start with `STORYTREE_STUDIO_STORE=json`, then open `/`. **Success —** the `/api/*` backbone answers, the app lands on the forest map, and the offline-store status is visible; no retired Overview page or pre-fold sidebar is required. _(criterion-id: uatc_b5d90e0780e17d4a53e11260)_ _(revision-id: uatr1:c160d418fa617c2d)_
2. **Open a decision through the forest's Library chrome.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ From the forest, expand the persistent Library drawer, pick the Library lens, scope it to Decisions, and open ADR-0002 in the full-detail overlay. **Success —** the decision renders from its store row — its own `# ADR-0002` heading and `## Status` prose, carrying the decision-record chip — and it is filed under the `active` lifecycle because the row says `accepted`, while the only global HUD chrome remains the verified-identity account avatar; no retired brand chip, avatar-menu Documents shortcut, or `docs/decisions/` file read is involved (ADR-0403 dec 1 deleted that subtree; ADR-0425 dec 4 re-points this leg rather than reviving it). _(criterion-id: uatc_eeaf4e098276044a6cc7e0c8)_ _(revision-id: uatr1:119efa54d11d4786)_ _(previous-revision-id: uatr1:97f0d87c97b486db)_
3. **Move between decisions through the Library.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Close ADR-0002's overlay and, with the finder still scoped to Decisions, search for ADR-0013 and open it. **Success —** the finder keeps its Decisions scope across the dismissal, and the overlay swaps cleanly: ADR-0013's own body renders and none of ADR-0002's remains — the decision tier is walkable decision to decision through the Library, with no citation link required (ADR-0605: the citation tier this leg once hopped was deleted, and the leg moved with it). _(criterion-id: uatc_7b1437b0d3e80ded20966d08)_ _(revision-id: uatr1:fa9bde30452cffd7)_ _(previous-revision-id: uatr1:06eeb2f58d06ad9c)_
4. **Find the artifact that grounds the question.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Arrive with a question from a conversation held elsewhere, open the artifact that grounds it, and enter the review affordance the way an operator reading closely would. **Success —** the artifact's own title and derived body render, and the surface offers nothing it cannot honour: no editable operator-identity input (attribution is server-stamped, ADR-0204 D4) and no comment box, thread or peer-comment list, because ADR-0425 dec 1 retires studio commenting rather than leaving a control that accepts a remark and files it nowhere. _(criterion-id: uatc_7c6ecbc6de6af9f9a059e508)_ _(revision-id: uatr1:1c5340c1d3647538)_ _(previous-revision-id: uatr1:30f998640a497ce5)_
5. **Reload and recover the same grounding.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Reload and reopen the same artifact through the Library lens. **Success —** the artifact and its derived body are re-fetched and rendered identically — on the reloaded route and again in the Library's full-detail overlay — proving the grounding was reconstructed from the real offline-store read-back rather than surviving in the first render's memory. _(criterion-id: uatc_30ad1e76fb65b01061a00868)_ _(revision-id: uatr1:877b04c8ffe0d979)_ _(previous-revision-id: uatr1:206d335dcc1ed284)_
6. **Read the decision behind it, then come back.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ From the grounding artifact's page, take its `library` crumb into the Library, open ADR-0002 through the Decisions scope, read it, and go Back to where the question started. **Success —** the decision opens without a manual reload and its substance renders from the store row — its `## Status` and `## Decision` sections, not a stub or a title alone — and Back lands on the grounding artifact with its body intact, closing the round trip the owner actually performs when grounding a conversation held in Claude Code or Codex. _(criterion-id: uatc_a0ac6978b43fc0eae856fcb1)_ _(revision-id: uatr1:0436c39a8aba4002)_ _(previous-revision-id: uatr1:f1938c1e88ff4901)_
7. **Browse the knowledge-derived Library.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Return to the forest Library lens and inspect its lifecycle/category surface. **Success —** categories are non-empty and their live counts equal what the offline derivation seam yields — `deriveOfflineAssets(loadFixtureSeedUnits())`: the library's committed FIXTURE corpus (`@storytree/library/fixture`) rendered, plus `@storytree/library` templates — as served through the seeded `assets.runtime.json`. The expected counts are read from that seam and never pinned, because the fixture is a small offline sandbox seed that drifts from the live Library by design (ADR-0302 D1); this proves the derivation is wired, not that the offline Library mirrors the corpus, and no retired hard-coded 88-record `assets.json` corpus is assumed. _(criterion-id: uatc_bc8b96d7284d1fb608628c07)_ _(revision-id: uatr1:13e190a12c573291)_ _(previous-revision-id: uatr1:155c01cbc82e6de9)_
8. **Narrow the Library deterministically.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Choose the declared lifecycle/category scope and search for `deep`. **Success —** the Library finder narrows to the matching current-corpus items using its real searchable fields, while the forest remains the underlying surface. _(criterion-id: uatc_087ce84cb1d97ca9a44d1449)_ _(revision-id: uatr1:35b81f8288075971)_
9. **Read an artifact through the full-detail overlay, then dismiss it.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Open `deep-modules` through the Library's selection card into the full-detail overlay, read it, and close the overlay. **Success —** the artifact's kind chip and derived body render through the OVERLAY mount specifically, and its Close control dismisses the overlay back onto the Library lens with the operator's narrowed finder result still in place — reading an artifact costs him no place in the Library. _(criterion-id: uatc_7400d218244cc813266ec95d)_ _(revision-id: uatr1:394a108502dc32a6)_ _(previous-revision-id: uatr1:894379e065695225)_
10. **Author a structured Library artifact.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Open the new-artifact editor, let the title slug the id, keep the `pattern` kind, fill its required structured fields, verify the derived live preview, and create it. **Success —** `POST /api/assets` returns 201, the detail renders with `createdAt === updatedAt`, and the probe record exists in `assets.runtime.json` with its structured fields. _(criterion-id: uatc_b79eb0edf3c8bcde0184737c)_ _(revision-id: uatr1:2067be7645c2fec6)_
11. **Edit, relock, and delete the artifact.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Edit the probe through its structured fields, save, then delete it through the UI. **Success —** the id stays locked, `createdAt` is preserved, `updatedAt` advances, the edited field persists, and deletion removes the probe from `assets.runtime.json` before returning to the forest Library. _(criterion-id: uatc_de3fbde6018e06eaf8898b2f)_ _(revision-id: uatr1:f5a06e3375a73207)_
12. **Survive a cold process restart.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Start a second fresh Vite process over the same offline stores, open the grounding artifact and the decision behind it again on that process, and inspect the deleted artifact id. **Success —** the deleted artifact remains absent and the grounding is reconstructed from storage — the artifact's derived body and the decision's own `## Status` and `## Decision` sections both render on a process that has never served them before — proving durability without relying on the first process's memory. _(criterion-id: uatc_2fbd323c9f6adfe167fdcbe5)_ _(revision-id: uatr1:3f1d9767c7a7ea5a)_ _(previous-revision-id: uatr1:1b870b18b28d55e0)_
13. **Leave both offline stores byte-for-byte as found.** _(witness: machine)_ _(proof-gate: studio#gate-1)_ Return to the forest where the journey began and compare the stores with their snapshots from before it. **Success —** both `comments.json` and the knowledge-derived `assets.runtime.json` are byte-identical to their baselines: the authored probe artifact was created, edited and deleted back out, everything else was READ, and `comments.json` in particular is untouched — which is the standing proof that no studio surface writes a comment anywhere since ADR-0425 dec 1 retired the affordance. The walkthrough leaves no persistent residue. _(criterion-id: uatc_cfeb76b5de7e939b62a81dca)_ _(revision-id: uatr1:b1d5af0054373097)_ _(previous-revision-id: uatr1:9dc90d354cedb62c)_

## Reliability Gates

1. **The current Studio story UAT passes** _(gate: observe)_ `pnpm --filter studio uat`. This exact
   command is the machine proof obligation for `studio#uat-1` through `studio#uat-13`. It boots the real
   dev server against the offline JSON seam, drives the real browser journey, and owns snapshot/restore
   cleanup. No capability-coverage annotation is claimed. If the command is stale or red, observe-and-sign
   produces no green verdict: the uncovered machine work defers to Build under ADR-0106/ADR-0098.

## Proof

The integrated acceptance walkthrough lives at the story tier (ADR-0010 §2). All 13 real criteria are
machine-witnessed through the same exact `studio#gate-1` command, so no human attestation is required
and no leg may be signed from prose or from the separate vitest suite. The story proves only when
`pnpm --filter studio uat` passes at a clean HEAD and the spine signs the gate-backed UAT verdicts,
with the capabilities' own integration-test/contract obligations healthy underneath.

**Honest status — `proposed`.** The Playwright file exists, but existence is not green. Its current run
may expose stale selectors or product/storage drift; any failing command is the red evidence that routes
the machine legs to Build, not a warning to ignore and never a signed pass. A passing local run likewise
does not self-author `healthy`: the prove-it ceremony must observe and sign it. The command uses the
offline JSON seam allowed by ADR-0010 §5, real in-story collaborators, a second cold server for restart
durability, and snapshot/restore cleanup; Chromium may require the one-time
`pnpm --filter studio exec playwright install chromium`.
