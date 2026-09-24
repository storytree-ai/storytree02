---
id: "forest-world"
tier: story
title: "The forest-world render core — the shared deterministic geometry both surfaces draw from"
outcome: "The studio and the public website draw the same forest-world look from ONE pure, browser-safe, deterministic geometry core — data-in → geometry-out — so the metaphor can never visually drift and a studio look change flows to the site instead of being hand-ported. A foundational root the whole render rests on, depending on nothing."
status: proposed
proof_mode: UAT
# Machine-judged: a pure GEOMETRY core has no UAT journey. Its author-declared observe reliability
# gate runs the offline determinism/invariant suite through the deterministic spine; the suite alone
# is not a current signed pass
# (ADR-0395). No DB, no API key, no browser — the geometry is exercised headless.
uat_witness: machine
# The capability FLOOR (ADR-0222 D2, option A — the owner's stated preference, executing the live
# `forest-world-capability-floor` proposal): `render-core` stands for the geometry KERNEL (mesh /
# coast / ranking / hex / sizing), deterministic trail router, and framework-agnostic SCENE-GRAPH
# (`scene.ts`, `buildScene` over its own SceneInput contract). `public-ground-scene-input` earns the
# one finer leg the floor permits: a new pure adapter layer that composes already-published,
# already-laid-out public facts into one plan-view SceneInput. The three thin mappers (studio React;
# website string-SVG, synced; R3F, packages/forest-world-r3f) still live with their
# surfaces/packages, proven there — outside this list. The thin-port empty-capabilities exemption
# (proof-protocol / storage-protocol) is explicitly NOT reopened (ADR-0222 D2).
capabilities: [render-core, public-ground-scene-input]
# Foundational root organism (ADR-0093 §1, standing on ADR-0068 / ADR-0075): forest-world owns its OWN
# minimal input contract (a story is just an id + deps + its capabilities' deps), so it depends on
# NOTHING — `depends_on: []`, alongside proof-protocol and storage-protocol at the bottom of the order.
depends_on: []
# Consumed by `apps/studio` (a SURFACE, ADR-0100 — its edge is declared in the studio story), by the
# public website (a separate repo that takes the core's synced built output, never a package edge),
# AND — since the website-experience story's R3F mapper landed — by `packages/forest-world-r3f`, the
# first workspace PACKAGE organism to import this core. That real code edge is declared on both sides
# (consumer-side in website-experience's `depends_on`; here provider-side) so `check:boundaries`
# covers it either way.
consumed_by: [website-experience]
# Deciding ADRs (ADR-0037 §2): the shared render-core decision / this package's identity as a
# foundational root (93); the organism model it stands on (68); ports/shared cores as root organisms,
# the foundational-minimality rule (75); author-defined story green (83); the historical observe-gate
# mechanism (85), narrowed to genuine brownfield by ADR-0395; and the capability-floor
# split that gives this story its one render-core capability (222).
decisions: [68, 75, 83, 85, 93, 222]
---

# The forest-world render core — the shared deterministic geometry both surfaces draw from

**Outcome —** The studio and the public website draw the same forest-world look from ONE pure,
browser-safe, deterministic geometry core — *data-in → geometry-out* — so the metaphor can never
visually drift and a studio look change flows to the site instead of being hand-ported. A foundational
root the whole render rests on, depending on nothing.

## What this core is

`packages/forest-world` is the shared forest-world render core decided by
ADR-0093
(accepted, strategy C — share the geometry *plus* a framework-agnostic scene-graph with thin
per-surface mappers). It holds BOTH pure layers: the **geometry kernel** — the relaxed Townscaper
mesh substrate (`substrate.ts`), the Chaikin-smoothed coastline (`coast.ts`), longest-path
dependency ranking (`ranking.ts`), the hex math (`hex.ts`), the seeded RNG (`rng.ts`), and the
tree / territory sizing (`sizing.ts`) — and the **scene-graph** (`scene.ts`): `buildScene` folds the
core's own minimal `SceneInput` contract into a tree of typed drawables (kind / variant /
already-folded visual status) that every thin mapper walks — the studio's React mapper, the
website's string-SVG mapper, and the R3F 3D mapper
(ADR-0123).
Same input → byte-identical geometry; no store, no React, no live data, no `node:` imports.

## This story owns a SECOND package since 2026-09-07 — `packages/forest-layout`

ADR-0537 D1 (owner-directed: *"pay the cost now"*) extracted **where the islands SIT** —
`buildWorld`, the derived inter-island gaps, the growth floor and its moat — out of
`apps/studio/src/components/TreeView.tsx` into `packages/forest-layout`, a second package this story
owns. The same shape `art-factory` already carries with `procedural-architecture` +
`art-authoring`: one story, two packages, split by dependency weight rather than by competence.

**It is deliberately NOT folded into `packages/forest-world`, and that was the fork.** This package
earns its keep by depending on nothing and by being cheap for the website to take; layout has
different consumers and a far higher change rate, so folding the most frequently changed code on the
map into the package carrying the heaviest publishing cost is the one direction ADR-0537 rules out.
`forest-layout` is therefore **not foundational** — it depends on this package — and it is outside
the `sync:web-engine` mirror, which only carries `forest-world/src` and `forest-world-r3f/src`. That
toll is what had kept the packing surface-side, and killing its influence is half of what the
decision bought; the other half is that the studio CHROME it was tangled with (the `render: building`
class, the ADR-0102 icon promotion) stayed behind the seam and is injected, never imported there.

It owns its **own minimal input contract** — a story is just an id + its `depends_on` + its
capabilities' deps — so it depends on **nothing**. Each surface adapts its own data (the studio's live
store; the website's fictional Cohoot demo data) to that contract; the core never reaches for either.
It defines the *look* and only the look — never the live data, the store, the corpus, or a surface's
interactive chrome (ADR-0093
§4, the precise line that keeps the public ↔ private decoupling intact).

## Consumers

Three consumers, three different edge kinds. The studio app (`apps/studio`) renders from this core —
a consuming SURFACE (ADR-0100), its edge declared in the studio story's own `depends_on`. The public
website (a separate repo, the `web/` submodule) renders from the core's **synced artifact**
(ADR-0093
§2–§3) — a built-output edge held by the `check:web-engine` drift gate, never a package import. And
`packages/forest-world-r3f` — the R3F mapper the `website-experience` story owns
(ADR-0123)
— imports `@storytree/forest-world` directly: the first workspace **package** organism consumer, so
the core now draws a real inbound package-graph edge. That edge is declared consumer-side
(website-experience `depends_on: [forest-world]`) and provider-side (`consumed_by:
[website-experience]` above), and `pnpm check:boundaries` covers it. `depends_on: []` still draws no
outbound edge — the core remains a foundational root.

## Why it is a foundational root organism

forest-world is a **foundational root organism**
(ADR-0093
§1, standing on ADR-0068's
organism model and ADR-0075's
ports-as-root-organisms) — exactly like `proof-protocol` and `storage-protocol`: `depends_on: []`, the
bottom of the dependency order, depending on nothing. It is shared *studio + web*, not web-only, which
is why ADR-0093 named it `packages/forest-world` over the web-only-sounding `packages/web-engine`
(ADR-0066
Decision 2) — role-not-position (ADR-0078).
It is registered in `repo-manifest/package-ownership/_domain.json` `packageOwnership.organisms`
(→ `forest-world`) and in the `foundational` subset that carries the minimality rule.

## Design floor — foundational minimality

forest-world MUST stay browser-bundleable (the studio bundles it; the website emits string SVG from
its synced output), so it stays pure-geometry, zod/types-only, and **node-free** — no store, no React,
no live data, no `node:*` import. ADR-0075's
**foundational-minimality rule** the gate enforces — a foundational organism may only depend on other
foundational organisms — holds by construction here: forest-world depends on nothing. (Belt-and-
suspenders over two backstops: it is a bottom root, so any back-edge to a real organism would close a
cycle the gate already rejects (ADR-0058); and the studio browser build catches a node-only import the
gate cannot see.)

## Reliability Gates

A pure render core is deterministic GEOMETRY — there is no integrated user JOURNEY to walk; a
geometry kernel is a machine's job, not a human attestation. This core was designed and built inside
the Storytree initiative, so its passing suite and later capability registration do not make it
brownfield or Adopt-bound
(ADR-0395).
The author-declared observe gate below is the core's machine own-proof: the suite is the evidence
surface, while only the deterministic spine observing it green at a clean committed HEAD and
persisting an `adopted` verdict signs `forest-world#gate-1`. Its explicit `(covers:)` greens only the
`render-core` capability when that verdict is current. (The scene-graph
(ADR-0093
§1) has since LANDED inside this core — `scene.ts`, covered by the same observed suite — and the
three mappers (§2–§3, ADR-0123)
live with their surfaces/packages, proven there; none of that growth has needed a new gate here yet.)

1. **The core's own geometry suite is green** _(gate: observe)_ _(covers: render-core)_
   `pnpm --filter @storytree/forest-world test`. The offline suite exercises determinism (same input →
   byte-identical mesh, coast, trail network, and scene), longest-path ranking (a dependent ranks
   strictly above every dependency, cycle-safe), the mesh / coast invariants, and the scene-graph's
   drawable / status-folding correctness all pass offline (no DB, no API key, no browser). This is the
   ADR-0093
   / ADR-0020 /
   ADR-0057
   current coverage command, but it does not by itself sign or adopt this greenfield story/capability.
   From a clean committed HEAD, `storytree gate run forest-world#gate-1 --pg` makes the spine observe
   this exact command and sign only when it exits green.

## Proof

**Green remains earned, not authored.** `packages/forest-world` has a real, passing offline suite and
now declares that suite as `forest-world#gate-1`; neither the command nor its authored gate is itself
a pass. The authored rung remains `proposed` until the deterministic spine observes the command green
at a clean committed HEAD and persists the signed gate verdict. The world crown derives green only
from that signed proof (ADR-0020 / ADR-0040 / ADR-0085 / ADR-0395). The one-capability floor remains
expandable: a real defect or separable new layer can still earn a finer proof unit.

## Open modeling calls (for the owner)

1. **Capability granularity — TAKEN (ADR-0222 D2, 2026-07-20).** This was the open call "when a
   capability should exist"; the owner took it as the capability-floor decision, option A: ONE
   capability, [`render-core`](render-core.md), standing for the whole core (the geometry kernel + the
   deterministic trail router + the framework-agnostic scene-graph, `scene.ts` — `buildScene` over the
   core's own `SceneInput` contract → typed drawables), with a separately observed offline suite,
   while its eight declared leaf contracts drive the algorithmically compressed flora density. The
   three thin mappers still live OUTSIDE it,
   proven with their surfaces/packages: the **studio** React mapper (`worldToScene`,
   `apps/studio/src/components/TreeView.tsx`), the **website** string-SVG mapper (over the synced
   engine, ADR-0093
   §3), and the **R3F** 3D mapper (`packages/forest-world-r3f`,
   ADR-0123
   — proven in its own package under the `website-experience` story). Split finer than this floor only
   when an in-core unit earns its own red→green leg (a real defect, a new layer), not merely to mirror
   what landed; the thin-port empty-capabilities exemption is not reopened (ADR-0222 D2).
