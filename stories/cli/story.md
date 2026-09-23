---
id: "cli"
tier: story
title: "The CLI — one agent-facing command surface that wires every organism together"
outcome: "Every organism is reachable through one agent-facing CLI that hydrates credentials, dispatches by verb to the owning organism, and returns a typed envelope/exit code — the composition root that wires the system into one command."
status: proposed
proof_mode: UAT
arc: story-green-monotonicity-arc
# Per-leg witness (re-adjudicated 2026-07-25, ADR-0209 D8): ALL FOUR legs are machine-witnessed —
# every success condition here compiles (envelope fields, exit codes, an env var, a refusal string).
# The three offline legs bind to cli#gate-1. Leg 4 (live `--pg` hydration + pull) is machine but
# deliberately UNBOUND: no harness runs it yet, and `resolveWitness` fails CLOSED on a machine leg
# with no `(proof-gate:)` → `coverage: "refused"`, so no adopt pass can observe-sign it (that is
# exactly what happened on 2026-07-04 — see the leg's note). "Not yet harnessed" is a harness
# statement, never a judgment gap (`human-witness-is-a-judgment-gap-not-cost`).
# `uat_witness` stays ABSENT on purpose: the roll-up is per-leg, and a story-level `machine` would
# re-open the blanket-adopt path that produced the stranded verdict. The crown derives per-leg.
# THREE capabilities LEFT this story on 2026-08-14 with their code, when ADR-0369 extracted
# `packages/arc` and gave the arc domain its own story, `stories/arc`:
#   - `arc-derived-initiative-view` + `increment-freshness-check` (rows 7/8) — never this hub's
#     connective competence, but a per-domain journey parked here because ADR-0192 D2 forbade minting
#     a story hosted in foreign buildings. That is exactly what open modeling call 5 below said, and
#     what it now records as answered.
#   - `arc-explicit-id-fidelity` — it went for a HARDER reason, and one that was not
#     optional. It is the only one of the three with a `real:` arm, and its `proof.real.sourceFile`
#     is `arc.ts`, which is now `packages/arc/src/arc.ts`. `readUnitSourceFiles` skips a unit with no
#     `real:` arm, which is why the other two could sit here without tripping anything; this one is
#     READ, so keeping it would have made `cli` a story hosted in `arc`'s building — refused by the
#     packages-forward rule REGARDLESS of any declared edge, since `cli` is not in the frozen
#     `hostedStories.register`. It is also a REFINEMENT of `arcNew`, so `stories/arc` is where it
#     belongs on the merits and not merely to satisfy a rule.
# ONE capability ARRIVED on 2026-08-31, and it is the mirror of that departure: `gate-ci-parity`, from
# `stories/ci-cd`, with its code already resident here (then `packages/cli/src/gate-ci-parity.ts`).
# Same rule, same standard, opposite direction — `ci-cd` owns no workspace package, so its first
# `real:` arm created a hosting relationship ADR-0192 refuses on sight. It was NOT moved to satisfy
# that rule. It entered on the `organism-boundary-tooling` GROUND, which is NOT the ground
# `guided-setup-repair` and `verification-decay-instruments` entered on, and the difference matters:
# those two entered because no story owns their subject, whereas `ci-cd` demonstrably DOES own the
# pipeline. The operative line is a SPLIT, not an absence — **`ci-cd` owns the PIPELINE (that a step
# runs, that it blocks, that it sits on the merge ref); `cli` owns the PROGRAM a pipeline step
# invokes** — and `check:boundaries` is that split already instantiated: a check CI runs, whose
# analyser has always been a `cli` capability. On arrival `gate-ci-parity` was a fourth pure judge of
# that shape, whose comparison had to read the `GATE_PLAN` literal out of
# `packages/cli/src/gate-order.ts`. ADR-0606 (2026-09-23) deleted that judge with the second list it
# compared: CI's `verify` now runs `pnpm gate --ci`, and the capability is the gate program's CI mode
# and its local stale-branch warning — `packages/cli/src/gate*.ts` itself, all of it this building's
# own code, which the report-only `sourceOwnership` map (now
# `repo-manifest/source-ownership/gate-ci-parity.json`) had already assigned to it. The split holds
# unchanged; only the side this capability sits on got plainer. It arrived with `depends_on: []` —
# its old `[green-gate]` edge was dropped as FALSE under the `cross-story-dependency` test, not
# converted into a cross-story edge, and the test re-run after ADR-0606 is still false both ways — so
# `cli` stays a pure source and `consumed_by` stays empty. Its sibling `green-gate` did NOT follow it
# and stays in `ci-cd`.
capabilities: [unified-command-dispatch, cli-resident-corpus-tools, organism-boundary-tooling, work-hierarchy-camp-fence, guided-setup-repair, verification-decay-instruments, gate-ci-parity, uat-revision-continuity-gate]
# The CLI is the wiring HUB: it imports every organism to surface it. Those outbound edges
# (cli → drive-machinery / library / notice-board / store / arc) are declared PROVIDER-SIDE on each
# spoke (their `consumed_by: [cli]`, ADR-0074 §4) so the hub stays de-noised and each organism owns
# its "wired into the CLI" edge — hence `depends_on: []` here. `@storytree/arc` is the newest such
# spoke (ADR-0369): `commands.ts` dispatches the arc / increment / question verbs into it, and the
# edge is declared in `stories/arc`'s `consumed_by`, not here. Nothing imports the CLI, so
# `consumed_by` is empty (the invariant the old "nothing may depend on the wiring layer" rule
# encoded).
depends_on: []
consumed_by: []
# ADR-0102 (owner-directed 2026-06-25): the CLI is a SOURCE hub — it depends on nearly every
# organism (declared provider-side on each spoke as `consumed_by: [cli]`) and is depended-on by
# almost nothing. Rendered as a shared island it AGGLOMERATES a dense "city" of its dependencies'
# icons; any consumer carrying cli's rare icon would make the coupling MORE visible, not hidden
# (ADR-0074 §1). (Since ADR-0112 §3 dropped studio's `cli` dependency, cli has no inbound consumer
# edge today — it is a pure source.) The graph is unchanged: only the render flips
# (depends_on / consumed_by above stay as-is). Build behind `?buildings`; appearance owner-attested.
render: building
# Deciding ADRs (ADR-0037 §2): the choose-your-own-adventure CLI (23), the atomic ADR-number
# allocator the CLI hosts (50), CLI-as-a-first-class-hub-organism (74), the shared-island
# per-island-icon-stamp render (102), and the drive-package extraction that moved the build/orchestrate
# drivers out of cli into @storytree/drive (cli now depends on + re-exports them, 112).
decisions: [23, 50, 74, 102, 112]
---

# The CLI — one agent-facing command surface that wires every organism together

**Outcome —** Every organism is reachable through one agent-facing CLI that hydrates credentials,
dispatches by verb to the owning organism, and returns a typed envelope/exit code — the composition
root that wires the system into one command.

This is storytree's **command hub** (ADR-0023
the choose-your-own-adventure surface). `packages/cli` is the thin shim every agent talks to:
`main.ts` parses args, hydrates credentials (`secrets.ts`), dispatches by verb, and maps the result
to a typed `Envelope` + exit code. It imports **every** organism to surface it — library explore/edit,
the node/story build drive (since ADR-0112 the drivers live in `@storytree/drive`, which `cli` depends
on and dispatches from `commands.ts`), the notice board, the tree, db control — which is exactly why it
is the wiring hub. `cli`'s `secrets.ts` / `build.ts` / `envelope.ts` are now thin back-compat shims
re-exporting `@storytree/drive` (so `@storytree/cli/build` and `@storytree/cli/secrets` are unchanged
for any existing importer).

**Why this is its own (hub) story now (ADR-0074 §2).**
The CLI is the single most-connected package in the workspace. The v1 boundary gate classed it a
"composition root" and **exempted** its edges; ADR-0074 §2 rejects that — hiding the most-connected
node hides the most architecturally important relationships. The CLI is a **first-class hub
organism**: visible, its edges enforced, with this lightweight, expandable UAT (§3) and a declared
connection set (§4).

**The shim owns the wiring, not the journeys.** The deep per-domain journeys the CLI surfaces are
owned by their organism stories — the library CYOA is `library`'s [`library-cli`](../library/library-cli.md);
the board is `notice-board`'s [`noticeboard-cli`](../notice-board/noticeboard-cli.md) + tree-view;
the build drive is `drive-machinery`'s [`build-drive-cli`](../drive-machinery/build-drive-cli.md)
(since ADR-0112 a separate package, `@storytree/drive`, that `cli` depends on and re-exports — the
journey is `drive-machinery`'s either way, now behind a package boundary too).
This story owns the **connective tissue** that makes them one tool, plus the genuinely CLI-resident
authoring primitives (the corpus guard, the ADR frontmatter parser).

## Design floor

- **Thin shim, business logic upstream.** `main.ts` parses, dispatches, and maps to an exit code; it
  holds no domain logic — that lives in the organisms it imports (the V1 `standalone-resilient-library`
  thin-shim pattern). The CLI never runs inference.
- **Typed envelope everywhere.** Every command returns an `Envelope` (`ok` + payload + `next:`
  guidance, ADR-0023); failures are `ok:false` with guidance, mapped to a non-zero exit code.
- **Credentials auto-hydrate.** `secrets.ts` fills `CLAUDE_CODE_OAUTH_TOKEN` (the SDK leaf) and
  `STORYTREE_DB_USER` (the live `--pg` store) from `~/.storytree/secrets.json` when unset — env
  always wins. One rotation point; no env-var prefixes on `pnpm storytree …`.
- **Offline-safe by default; writes are `--pg`-gated.** Read/explore commands run offline against the
  in-memory seed; live writes refuse without `--pg` and a reachable DB (degrade with guidance, never
  a silent no-op).

## Capabilities (8)

Lightweight and **expandable** (ADR-0074 §3): the hub's own connective competence, NOT a re-derivation
of every per-domain command (those belong to the organism that owns the journey). The list grows one
case per real defect (`uat-proves-the-goal-not-the-surface`).

`guided-setup-repair` and `verification-decay-instruments` were authored 2026-08-08 by
`capability-layer-coverage-arc` increment 5 over already-implemented, already-tested code. Both are
**CLI-resident competences that are neither wiring nor authoring** — the third kind
`organism-boundary-tooling` already OCCUPIES as a live capability in the tree, entered on that same
footing and not widening it. Read "occupies", not "admitted": open modeling call 1 below NAMES that
capability but ends "Confirm this shim-vs-journey split", so the call is still OPEN and these two
neither resolve it nor lean on it being resolved. Neither re-derives a per-domain command surface,
because neither has an owning organism: one diagnoses the DEV'S OWN MACHINE, the other judges the
repo's verification apparatus — since 2026-08-31 that includes the decision log's grounded claims,
the subject of its sixth chartered instrument — and no story in the tree owns either subject.

**`gate-ci-parity` arrived on 2026-08-31 on a DIFFERENT ground, and conflating the two would be the
easy mistake.** The no-owning-organism ground above cannot carry it: `ci-cd` exists, owns the delivery
pipeline, and had authored this capability itself. What moved it here is a SPLIT rather than an
absence — **`ci-cd` owns the PIPELINE (that a step runs, that it blocks, that it sits on the merge
ref, that `automerge` needs it); `cli` owns the PROGRAM a pipeline step invokes** — and that split is
not new prose, it is `organism-boundary-tooling` restated. `check:boundaries` is a check CI runs; its
ANALYSER has always been a capability of this story, and nobody has ever thought otherwise.
`work-hierarchy-camp-fence` (`check:hierarchy-camps`) sits on the same footing. On arrival
`gate-ci-parity` was the fourth pure judge of that shape, whose comparison had to read the
`GATE_PLAN` literal out of `packages/cli/src/gate-order.ts`. ADR-0606 (2026-09-23) deleted that judge
along with the second list it compared, and made the capability the gate program itself: CI's
`verify` runs `pnpm gate --ci` and names no check, so what `gate-ci-parity` now contracts is how that
one program walks the one plan in each run — which steps, over which packages, as whom, and what
counts as green. That sits on the same side of the split as before, and more squarely: all of its
subject is this package's own code. The story it LEFT keeps the pipeline half — `ci-cd`'s
[`green-gate`](../ci-cd/green-gate.md) asserts that `verify` runs the gate as a required step on the
merge ref, and its UAT leg 3 and Reliability Gate 3 still assert the local/CI relationship as
repository-owned evidence on that story's own journey.

So the tree now shows THREE distinct admission grounds here, and only the first is the original
shim-vs-journey rule: wiring/authoring competence (rows 1–2), no-owning-organism (rows 5–6), and
program-not-pipeline (rows 3, 4, 7) — the program a pipeline step invokes, which for rows 3 and 4 is a
judge. *(It read "judge-not-pipeline" until 2026-09-24; ADR-0606 turned row 7 from a judge into the
gate program itself, and the wider name covers both without moving any row.)* **None of this
resolves open modeling call 1 below, and `gate-ci-parity` does not lean on it being resolved** — that
call asks whether the no-owning-organism ground is right, and this capability does not stand on it.
If anything the arrival WIDENS what the call has to weigh, from one alternative ground to two.

| # | capability | outcome | status | depends on |
|---|---|---|---|---|
| 1 | [`unified-command-dispatch`](unified-command-dispatch.md) | `storytree <verb>` parses args, hydrates credentials, dispatches to the owning organism, and returns a typed `Envelope`/exit code; offline commands run with no DB. | proposed | — |
| 2 | [`cli-resident-corpus-tools`](cli-resident-corpus-tools.md) | The CLI-resident authoring primitives the gates build on: the `stories/` YAML corpus guard and the ADR frontmatter parser. | proposed | — |
| 3 | [`organism-boundary-tooling`](organism-boundary-tooling.md) | The pure organism-boundary analyser behind `check:boundaries`: the blocking subgraph judge (ADR-0074) + the non-blocking declared-edge drift report (ADR-0115) that derives a virtual story's real edges from its units' `sourceFile` imports. | proposed | — |
| 4 | [`work-hierarchy-camp-fence`](work-hierarchy-camp-fence.md) | A pure judge computes, from each module's own code, whether it reads the work hierarchy off the checkout or out of the live store, and a gate rung holds that against a declared camp in `repo-manifest/hierarchy-camps/_domain.json`. | proposed | — |
| 5 | [`guided-setup-repair`](guided-setup-repair.md) | A dev's failing setup probe is driven to a re-verified repair, or to a secrets-redacted owner escalation naming why no installer step can fix it. | proposed | — |
| 6 | [`verification-decay-instruments`](verification-decay-instruments.md) | Every chartered verification instrument reports the decay it locates as a finding charged to the branch that authored it. | proposed | — |
| 7 | [`gate-ci-parity`](gate-ci-parity.md) | A green local `pnpm gate` predicts a green CI `verify`, because both walk the one gate plan — split only by each step's declared placement — and the one difference that remains, the merge ref, is warned about whenever the branch is behind `origin/main`. | proposed | — |
| 8 | [`uat-revision-continuity-gate`](uat-revision-continuity-gate.md) | A changed existing UAT criterion revision blocks until its candidate binding has an exact signed pass; a new criterion remains additive expansion. | proposed | — |

*(Renumbered 1–5 on 2026-08-14 when three rows left. Safe, and different from the open modeling calls
below, whose numbers are cited from OTHER files and are therefore never reused or shifted: nothing
outside this file cites a capability by row number, and the prose here now names capabilities rather
than positions, so a future departure cannot silently re-point a sentence.)*

*(Grown to seven on 2026-08-31 by TWO separate corrections, worth separating. **`gate-ci-parity`
arrived** from `stories/ci-cd` — the frontmatter note records the merits and the ground it enters on.
**`work-hierarchy-camp-fence` was already a live capability of this story and had simply never been
added to this table** — it has been in the frontmatter `capabilities:` list and has rendered in
`storytree tree cli` all along, so the table, not the tree, was the thing that was wrong. That is the
failure mode this heading's count invites: the frontmatter is what the tooling reads, the table is
prose beside it, and only the frontmatter is checked. Read the tree, not this count.)*

*(`uat-revision-continuity-gate` joined under ADR-0560 after PR #1892 changed an already-proven
criterion revision without replacement proof and the Agent story silently rendered proposed. It is
another CLI-resident pure judge, and not part of `gate-ci-parity`: it decides whether a candidate
proof binding is admissible, while `gate-ci-parity` is the gate program that RUNS it — one of the
checks the plan places on both sides, declaring the verdict-history identity it signs in with in CI.
Until 2026-09-24 this said `gate-ci-parity` "decides whether the local and CI step sets
correspond"; ADR-0606 deleted that comparison, since both runs now walk one plan.)*

*(`gate-ci-parity` also carries one contract-grain unit,
[`gate-real-build-names-its-increment`](gate-real-build-names-its-increment.md) — spec-borne,
edit-existing proof over `driveBuildTestsGate` and `makeGateDeps`, proposed (ADR-0576). A REAL
build-tests gate drive names a live increment and passes the gate's attempt policy before spend. It
sits under that capability because the capability owns `packages/cli/src/gate*.ts`, not because it
bears on gate↔CI parity.)*

**Three capabilities left this table on 2026-08-14, and where they went is the point
(ADR-0369).**

`arc-derived-initiative-view` and `increment-freshness-check` were added here on 2026-08-08 by
`capability-layer-coverage-arc` increment 6, over already-implemented code, and they were always a
DIFFERENT admission from `guided-setup-repair` / `verification-decay-instruments`. Those two entered
on the ground that no organism owns a dev's own machine or the repo's verification apparatus (nor,
since the sixth instrument joined on 2026-08-31, the grounding of the decision log). The arc
pair covered the ARC TIER — a deep per-domain journey of exactly the kind the shim-vs-journey rule
above says belongs to an organism story, with its own library kinds, its own ADR family
(0183 / 0267 / 0305 / 0314), a studio lens and a desktop mirror. Its organism story was simply
UNMODELLED, and ADR-0192 decision 2 (packages-forward) made minting one a code move rather than an
ownership declaration, so the pair parked the organ here and SHARPENED open modeling call 5 below
instead of resolving it.

`arc-explicit-id-fidelity` left for a related but sharper reason, and it is worth separating because
it shows what the parking actually cost. It is a REFINEMENT of `arcNew` — a capability owned by
`arc-derived-initiative-view` — so on the merits it always belonged wherever that one did. What made
its departure NON-OPTIONAL rather than merely tidy is that it is the only one of the three carrying a
`real:` arm. The landlord rule reads `proof.real.sourceFile`, so the other two were invisible to it;
this one is not. Once `arc.ts` became `packages/arc/src/arc.ts`, keeping the spec here would have made
`cli` a story hosted inside `arc`'s building — refused outright by the packages-forward rule, whatever
edges were declared, because `cli` is not in the frozen `hostedStories.register`. Its long-noted
"arguably wants a `depends_on` on `arc-derived-initiative-view`" is now authored, which only became
expressible once the two were siblings.

None of this changed what this hub DOES: `commands.ts` still dispatches `arc` / `arc increment` /
`question` / `increment check`, and the three `arc-explicit-id-refuses-lossy-cap` regressions still
live in `packages/cli/src/cli.test.ts`, because they drive the real binary end-to-end. What changed is
that the coupling is now a declared cross-story edge (`stories/arc`'s `consumed_by: [cli]`) instead of
an ownership claim.

**One detail worth following, because it is easy to misread as a simplification.** This story used to
own the corpus's only two-suite `proof.command`: `arc-derived-initiative-view` ran
`--filter @storytree/drive --filter @storytree/cli`, because the join and the verbs were in different
packages and each half saw something the other could not. That command DID collapse to one filter —
the extraction removed its reason. But the two-suite NEED did not disappear from the corpus; it MOVED,
to `arc-explicit-id-fidelity`, whose source is now `packages/arc/src/arc.ts` while its regression stays
in `packages/cli/src/cli.test.ts`. Before the extraction, one `@storytree/cli` filter ran BOTH that
regression and `arc.test.ts`; afterwards it runs only the regression, so leaving that unit on one
filter would have quietly stopped observing most of the file its own IMPLEMENT phase writes. It now
names both suites. See open modeling call 5 for the closing.

## Dependency graph (code-derived)

The CLI's real `@storytree/*` runtime imports (ADR-0010 §3) — all **cross-story** (it is the hub):

- `cli → drive-machinery` — since ADR-0112 the build/orchestrate drivers (`node-build.ts` /
  `story-build.ts` etc.) live in `@storytree/drive` (owned by `drive-machinery`); `cli` `depends_on`
  `@storytree/drive`, dispatches the drivers from `commands.ts`, and re-exports the build seam through
  its own `./build` (and `./secrets`) subpath for back-compat. The drivers drive `node build`/`story
  build` through the spine (`@storytree/orchestrator`) and the leaf (`@storytree/agent`).
- `cli → library` — `commands.ts` validates/upcasts library docs on every write.
- `cli → notice-board` — `noticeboard.ts` classifies presence staleness for the board surface.
- `cli → store` — `main.ts`'s `buildStore` swaps `PgLibraryStore` in under `--pg`.
- `cli → arc` — since ADR-0369 the arc / increment / question verbs and the derived arc → children
  join live in `@storytree/arc` (owned by [`arc`](../arc/story.md)); `commands.ts` imports them
  directly and `worktree-create.ts` reads `storyArcStamps`. A NEW package dependency, not a
  re-pointing of an existing one: these verbs used to be this package's own files. The arrow only ever
  runs this way — `@storytree/arc` imports nothing from `@storytree/cli`, which is what keeps the
  merged story graph acyclic.

These five outbound edges are declared **provider-side** on each spoke (`consumed_by: [cli]`,
ADR-0074 §4), so the hub is de-noised and `depends_on` here is `[]`. Substrate edges (always
allowed, §5): `cli → base`, `cli → proof-protocol`. The merged declared graph (depends_on ∪
consumed_by) is **acyclic** (ADR-0058): the CLI is a pure source — nothing imports it.

> **UI note (sequencing).** Because these edges are declared on the spokes' `consumed_by`, the CLI
> renders as an edgeless node in the forest (which reads `depends_on` only). The radial /
> solar-system world that was to draw them de-noised (ADR-0074 §6) is **retired** — ADR-0283 D2
> made DAG rows the one map layout, so nothing on the map draws `consumed_by` wiring today. The
> edges stay declared and gate-enforced; how they are eventually shown is an open UI question.

## UAT Test Criteria

The integrated acceptance walkthrough that proves the whole `cli` organism end-to-end — *an agent runs
a core command against the real thing* (ADR-0074 §3), the minimum that proves the goal.

**Goal —** One agent reaches the live library through the one binary, with no environment prefix: the
shim hydrates its credentials and wires the live store in, and the read comes back as a typed envelope.

One leg. The three offline legs that used to precede it (`library` dashboard, `tree <id>`, the
without-`--pg` write refusal) were each bound to `pnpm --filter @storytree/cli test` — the same command
that greens [`unified-command-dispatch`](unified-command-dispatch.md), whose own suite asserts all three
directly. Under ADR-0294 D2 that is the capability rung re-signed at the story rung, so they were deleted
on 2026-08-03 with the proving node named per criterion (table below;
`stories/uat-legacy-dispositions.json` records them `superseded`).

The three deleted criteria and the node that already proves each, for audit:

| deleted criterion | claim | proven at |
| --- | --- | --- |
| `uatc_fc00d80d290a86727a30e2eb` | *dispatch + envelope, offline* — `storytree library` seeds an in-memory store and returns `ok:true` with the dashboard banner + a `next:` block, no DB | [`unified-command-dispatch`](unified-command-dispatch.md) (capability) — `packages/cli/src/cli.test.ts`, *"library dashboard reports a total + categories and maps artifacts by id"* and the doctrine-pointer/`next:` tests; observed by gate-1 |
| `uatc_6488d065398e1216c9ae3d07` | *reach another organism* — the same binary dispatches to the tree surface and renders the hierarchy offline | [`unified-command-dispatch`](unified-command-dispatch.md) (capability) — `cli.test.ts`, *"tree focus `<id>` renders the node's outbound source refs"* and *"a node: ref renders as a Story node through the REAL binary, on both artifact surfaces"*; also `tree-dispatch.test.ts`; observed by gate-1 |
| `uatc_0230af87290a0b4ac797495a` | *write gate* — `artifact new` without `--pg` returns `ok:false` with "writes go to the shared store … run with --pg" and a non-zero exit | [`cli-resident-corpus-tools`](cli-resident-corpus-tools.md) (capability) — `cli.test.ts`, *"a write without --pg is refused with guidance (not an ephemeral write)"*; observed by gate-1 |

Every assertion above still runs under `pnpm --filter @storytree/cli test` and both capabilities still
green on it — the deletion removed a second signature at the story rung, not the evidence.


4. **Credential hydration + live pull:** _(witness: machine)_ with `pnpm db:up`, run `pnpm storytree _(criterion-id: uatc_dba01a60e8f19040a6732eea)_ _(revision-id: uatr1:b9554fd833374c8c)_ _(previous-revision-id: uatr1:a6be2db1ea9b6a79)_
   library artifact <id> --pg` (no env prefix). **Success —** `secrets.ts` hydrated
   `STORYTREE_DB_USER`, the live read returned `ok:true` — the shim wired the live store in.
   > **Witness re-adjudicated `human` → `machine` 2026-07-25 (ADR-0209 D8), deliberately UNBOUND.**
   > Both halves of the success condition compile: a populated `STORYTREE_DB_USER` is an assertion on
   > the environment, and `ok:true` is an envelope field. Nothing here is a judgment gap — the leg is
   > merely LIVE and unharnessed, which `human-witness-is-a-judgment-gap-not-cost` puts on the machine
   > rung. The prior `human` tag (set 2026-07-11, `9ae39cb6`) rested entirely on a harness statement —
   > "no standing suite that runs it … **until real machine proof exists**" — which concedes machine
   > proof is possible, and so disqualifies its own conclusion.
   > **No `(proof-gate:)` is asserted, and none may be added until a harness truly runs this.** Binding
   > it to `cli#gate-1` would be a rubber-stamp (ADR-0097 §2): that gate's command is `pnpm --filter
   > @storytree/cli test`, which does not exercise the live `--pg` path at all. Unbound, `resolveWitness`
   > fails CLOSED (`coverage: "refused"`) and no adopt can sign it. Under ADR-0295 D1 the honest witness
   > for it is a model driving this exact command against a live DB, not a new unit test.
   > **Known stranded verdict —** a `studio-adopt` run on 2026-07-04 observe-signed `cli#uat-4` as
   > `adopted`/pass at `c79fe948` (on main), citing evidence "observed green at a clean HEAD: `pnpm
   > --filter @storytree/cli test`". That evidence was never true for this leg: the CLI suite reports
   > **0 skipped** and contains no live-`--pg` test, skipped or otherwise. The row is a false green and
   > should be superseded when a real harness lands — it is recorded here, not silently reused.
   > **Half already covered, elsewhere —** the hydration half IS machine-proven today, by
   > `packages/drive/src/secrets.test.ts` (env-wins, exact key list) in the **`@storytree/drive`** suite,
   > not this story's gate. Only the live-read half is genuinely unharnessed — and that is exactly why
   > this leg is the one that survived ADR-0294: it has no lower-tier node that already proves it.

End state — the live store reached through one binary, credentials hydrated without an env prefix, and
the envelope contract held.
## Reliability Gates

The CLI hub is **greenfield**: `packages/cli` has a real, passing, OFFLINE
automated suite that observationally verifies the dominant dispatch / envelope / write-gate / corpus-
guard behaviour (no live-`--pg` test exists), but storytree's own prove-
it-gate never DROVE those proofs red→green. The later hierarchy registration does not make the code
inherited brownfield, and a missing signed pass leaves greenfield work at `proposed` (ADR-0395). The
author-declared **reliability gates** below remain evidence surfaces; they do not establish provenance.
Distinct from `## UAT Test Criteria` above
(the integrated, expandable acceptance journey): the gates are the author's **expandable reliability
floor**, starting by recording the existing green suite and GROWING a `_(gate: build-tests)_` gate (a
genuine red→green regression leg) the moment observation proves insufficient — a real dispatch/envelope
defect slips through, or the live `--pg` credential-hydration leg earns a standing offline test.

1. **The CLI hub's own suite is green** _(gate: observe)_ _(covers: unified-command-dispatch, cli-resident-corpus-tools, organism-boundary-tooling)_ `pnpm --filter @storytree/cli test`. The
   spine runs it at a clean committed HEAD and OBSERVES it green — the `run` verb dispatch + typed
   `Envelope` contract (**unified-command-dispatch**: `cli.test.ts` / `cli-aliases.test.ts` /
   `tree-dispatch.test.ts`), the offline-safe `--pg` write gate (a write refused offline with guidance,
   not a silent no-op), the genuinely CLI-resident authoring
   primitives this story owns (**cli-resident-corpus-tools**: the `stories/` YAML corpus guard
   `scripts/validate-corpus.ts`, and the `adr-health` checks over parsed ADR frontmatter,
   `adr-health.ts` / `adr-health.test.ts`), and the
   organism-boundary analyser (**organism-boundary-tooling**: `boundaries.ts` / `boundaries.test.ts`,
   the pure judge behind `check:boundaries`) all pass offline (no DB, no API key) — then signs an
   `adopted` verdict (`storytree gate run cli#gate-1 --pg`). This observes the whole `packages/cli`
   suite, which is the connective-tissue behaviour this hub owns; the three caps above green via this
   gate's `(covers:)` (ADR-0097 §5); the deep per-domain journeys it
   surfaces are adopted by their own organisms' gates (`library`'s `library-cli`, `drive-machinery`'s
   `build-drive-cli`). The live `--pg` credential-hydration + pull (UAT leg 4) is **not exercised by
   this gate at all** — it becomes a `build-tests` gate here if it ever earns a standing test.
   > **Scope correction 2026-07-25 (ADR-0209 D8).** Two citations above were stale and are fixed in
   > place. (i) *Credential hydration (`secrets.ts`)* was struck: since ADR-0112 `packages/cli/src/secrets.ts`
   > is a three-line re-export shim, and the real assertions live in `packages/drive/src/secrets.test.ts`
   > — the **`@storytree/drive`** suite, which this gate's command never runs. (ii) *The ADR frontmatter
   > parser `adr-frontmatter.ts`* was likewise never in this suite: ADR-0112 moved it to
   > `packages/drive/src/adr-frontmatter.ts`, tested by `packages/drive/src/adr-frontmatter.test.ts`.
   > What `packages/cli` genuinely owns is `adr-health.ts`, which judges already-parsed frontmatter from
   > injected fixtures — cited above in its place. (iii) The phrase *"DB-gated and skipped by default"*
   > was retired throughout: it implies a test exists that skips, and none does — this suite reports
   > **0 skipped** over 875 passing tests. The honest statement is that no live-`--pg` test exists.
   > `cli-resident-corpus-tools`' own capability text still names the ADR frontmatter parser; correcting
   > a capability's outcome is a story-shape call and is escalated, not taken here.

The historical Adopt run signed this gate — **this already happened** (`studio-adopt`, 2026-07-04
at `c79fe948`; the status edit landed in `98dc73e6`). ADR-0395 now makes the frontmatter's
`status: proposed` the correct greenfield baseline independent of that ceremony. `healthy` stays non-authorable
(ADR-0020) — the authored
frontmatter `status:` is never `healthy`; the world's crown DERIVES green from the signed verdicts
(ADR-0040) and only
when every capability is `healthy` AND every own-proof obligation (the three machine UAT legs bound to
`cli#gate-1`, the fourth machine leg once a real harness binds it, and this reliability gate) is signed
(ADR-0082 /
ADR-0083 Fork A + ADR-0085). No single gate greens the story.

## Proof

**Honest status — `proposed` (greenfield without a complete current signed pass), NOT `healthy`.** `packages/cli` has a real, passing,
offline automated suite (the dominant dispatch/envelope/guard behaviour is observationally verified;
no live-`--pg` test exists). storytree's prove-it-gate never drove these red→green, so nothing here is
`healthy`. The live-DB credential-hydration + pull (leg 4) is the unharnessed pocket — machine-witnessed
since the 2026-07-25 re-adjudication, but deliberately unbound.

**Signed state on record (probed live 2026-07-25).** Five `adopted`/pass verdicts exist for this story
— `cli#gate-1` and `cli#uat-1..4` — all from run `studio-adopt:2026-07-04T01:18:08.072Z` at
`c79fe948` (an ancestor of `main`), signer `spine@storytree`, approved by `hua.mick@gmail.com`. There
are **no** `operator-attested` verdicts and **no** `events.attestation` rows for any `cli#` id. Two
honesty notes: (i) the `cli#uat-4` row is the stranded false green documented on leg 4 — it was signed
while that leg still read `witness: machine`, before the 2026-07-11 flip to `human` that this
re-adjudication reverses; (ii) `apps/studio/data/unit-status.json` currently contains **no** `cli#`
entries despite these five verdicts, so the generated offline status view is stale for this story
(regenerate with `pnpm build:status`). Neither is repaired here — recorded, not reused.

## Open modeling calls (for the owner)

1. **Capability granularity.** The hub keeps a small set of lightweight capabilities (dispatch shim +
   CLI-resident corpus tools + the organism-boundary analyser), deliberately NOT re-owning the per-domain
   command surfaces — those are their organisms' capabilities (`library-cli`, `noticeboard-cli`,
   `build-drive-cli`). The `organism-boundary-tooling` capability (ADR-0115) homes the previously-unbounded
   pure boundary judge (`boundaries.ts`) the CLI's `check:boundaries` builds on — genuinely CLI-resident
   (it rides the CLI's test surface), distinct from the corpus tools. Confirm this shim-vs-journey split.
   *(Corrected in place 2026-08-08 by the pre-merge librarian pass, ADR-0139; the call itself is
   unchanged and still OPEN. This read "**three** lightweight capabilities", which the table above had
   already outgrown at four and this increment takes to six. The count was never the call — the
   shim-vs-journey SPLIT is — and re-stamping a number here every time a row lands is the churn
   ADR-0317's "read it live" instruction exists to prevent. The table above is the count.)*
   *(Reconciled 2026-08-14, ADR-0369: the split's sharpest COUNTER-EXAMPLE has left. The arc trio was
   a deep per-domain journey sitting on the shim — the case call 5 below raised and has now closed by
   extracting `packages/arc`. What remains here is the three original lightweight capabilities
   (`unified-command-dispatch`, `cli-resident-corpus-tools`, `organism-boundary-tooling`) plus
   `guided-setup-repair` and `verification-decay-instruments`, which entered on the different "no
   organism owns this subject" ground — a dev's own machine, the repo's verification apparatus — and
   are unaffected. So the call is NARROWER than it was, not answered: with the journey case gone it
   asks exactly one thing, whether that second ground is the right one. Nothing about the arc
   extraction settles that.)*
2. **The connection-declaration shape (ADR-0074 §4) — settled in this increment.** The CLI's outbound
   edges are declared provider-side on the spokes (`consumed_by: [cli]`) to de-noise the hub; the gate
   covers a code edge when EITHER endpoint declares it. The trade is the UI-sequencing note above
   (the CLI's edges render in the radial world, not today's tree). See the PR for the rationale and
   the alternative (consumer-side `depends_on` on the CLI, visible-now but tree-tangling).
3. **`cli-resident-corpus-tools` no longer owns the ADR frontmatter parser (raised 2026-07-25).**
   That capability's outcome still reads "the `stories/` YAML corpus guard **and the ADR frontmatter
   parser**", but ADR-0112 moved the parser to `packages/drive/src/adr-frontmatter.ts` (tested in
   `@storytree/drive`'s suite). What remains CLI-resident is the corpus guard plus `adr-health.ts`,
   which judges already-parsed frontmatter. The gate leg's citation is corrected above; **restating a
   capability's outcome is a story-shape call, so it is escalated rather than taken.** Options, not
   chosen here: (a) narrow the capability's outcome to the corpus guard + `adr-health`; (b) keep the
   wording and let the capability formally span the drive-hosted parser, which would re-open a landlord
   question (ADR-0192). Owner or a scoped story-author pass should pick.
4. **The stranded `cli#uat-4` verdict needs an owner call (raised 2026-07-25).** A machine-observation
   `adopted` verdict sits on leg 4 citing evidence that was never true of it (see the leg's note). The
   re-adjudication makes the leg's *tag* honest again, but cannot unsign a row. Options, not chosen
   here: (a) leave it and let a future real harness supersede it; (b) record a superseding `fail`/void
   verdict now. Signing and voiding are both operator-granted — no agent may self-exempt.
5. **~~The arc tier has no organism story~~ — CLOSED 2026-08-14, option (b) taken (raised
   2026-08-08).** PLACED LAST DELIBERATELY, and KEPT IN PLACE now that it is closed: this list's
   numbers are cited by number elsewhere in the corpus (e.g. `stories/cli/guided-setup-repair.md:171`
   cites this list's own "open modeling call 1" verbatim), so a new call is APPENDED and no existing
   item is ever renumbered — which means a closed one is struck through where it stands rather than
   deleted, or every later number would shift under its citers.

   **What it asked.** `arc-derived-initiative-view` + `increment-freshness-check` cover a genuine
   per-domain journey — the durable initiative record every session's closing leg writes to. By this
   story's own shim-vs-journey rule that journey belongs to an organism story, and there was none:
   the kinds live in `packages/library`'s schema, the join lived in `packages/drive` for reach, the
   verbs lived in `packages/cli`, the lens is a `studio` capability, and a desktop backend mirrors it.
   ADR-0192 decision 2 forbids minting a new story hosted in those foreign buildings — a new story's
   code lives in its own workspace package — so the end-state was a `packages/arc` extraction plus an
   owner-reviewed diff, which is a code move and was NOT taken then. Three options were named:
   (a) leave the organ here indefinitely and accept that the shim owns one journey; (b) extract
   `packages/arc` and migrate the organ into its own story, which also gives `studio`'s
   `arc-orientation-lens` a real story to draw an edge to; (c) decide the arc tier is `library`'s,
   since `arc` / `increment` / `open-question` are all library kinds.

   **How it was answered.** The owner directed **(b)** on 2026-08-09, answering the since-retired open
   question `oq-where-should-the-arc-tier-live-the-cli-shim-its-own-packa`;
   ADR-0369
   records the decision and `arc-tier-extraction-arc` increment 1 delivered it. `packages/arc` is the
   building, [`arc`](../arc/story.md) is the story, both capabilities moved with all of their code,
   and ADR-0192 D2 is satisfied rather than excepted. Option (b)'s stated bonus landed too:
   [`arc-orientation-lens`](../studio/arc-orientation-lens.md) has a real story to draw its edge to.

   **One thread the closure does NOT settle, deliberately.** Option (c) also observed that
   `interface-oq-proposal-authoring`'s text still names only the generic `library artifact new --file`
   path that `question new` replaced. That is a stale-text problem in another story and it is
   untouched by where the arc tier lives — it needs the same correction whether the verbs sit in
   `packages/cli` or `packages/arc`. It is recorded here rather than carried forward as if the
   extraction had handled it.
