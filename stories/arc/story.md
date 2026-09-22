---
id: "arc"
tier: story
title: "The arc — the durable initiative record a long-running effort is read from"
outcome: "A session arriving cold on a long-running initiative reads its whole current state from the arc alone, including whether the work parked there is still safe to act on."
status: proposed
proof_mode: UAT
# Machine-judged, and the judgment is not close. Every success condition in this organism COMPILES —
# what a derived join contains, an envelope field, a commit count against a path set, a refusal
# string. Nothing here is an aesthetic or an owner value call, which is the only thing that earns a
# `human` witness (`human-witness-is-a-judgment-gap-not-cost`; ADR-0348 re-states it as UX ≠ UAT).
# Declared EXPLICITLY rather than left absent, because absent resolves to `human` and would tell a
# reader this organism needs an owner's eye that it does not. It carries none of the blanket-adopt
# risk `stories/cli` warns about when it withholds the same tag: that risk is a story-level `machine`
# standing in as the witness for a LIST of criteria, and this story deliberately authors ZERO — see
# `## UAT Test Criteria`.
uat_witness: machine
# ADR-0183 D3: the story-side provenance stamp. This story exists BECAUSE of `arc-tier-extraction-arc`
# (increment `arc-tier-extraction-arc-inc-01`), and the arc surface derives its story leg by scanning
# for exactly this key — an unstamped story is invisible to the initiative that produced it.
arc: arc-tier-extraction-arc
capabilities: [arc-derived-initiative-view, increment-freshness-check, arc-explicit-id-fidelity]
# Story-level edges. The FOUR outbound edges are `@storytree/arc`'s real runtime package.json
# dependencies (ADR-0074 / ADR-0010 §3), declared consumer-side here; all four are code-backed, so
# none is an `artifact_edges` honesty annotation (ADR-0166). `notice-board` is the newest and is
# backed by `increment-claims.ts`: `arc show` says whether each open increment is HELD, and it decides
# liveness with the notice-board organism's OWN `classifyClaims` / `isReclaimable` rather than a
# second staleness threshold of its own — so the arc surface and the claim ledger cannot disagree
# about which rows are live. The `cli` edge is declared PROVIDER-SIDE
# here, as `consumed_by`, because `stories/cli` is the ADR-0074 §4 de-noised hub and carries
# `depends_on: []` by decision — every spoke owns its own "I am wired into the CLI" edge, exactly as
# `library` / `drive-machinery` / `notice-board` / `storage-protocol` already do. The two consuming
# SURFACES (`studio`, `desktop`) declare their `arc` edge CONSUMER-side in their own specs, which is
# what ADR-0100 requires of a surface and what makes the coupling render on the map.
#
# THERE IS DELIBERATELY NO `arc → cli` EDGE, AND ITS ABSENCE IS THE DECISION (ADR-0369 D2/D3).
# The arrow inverted at the package boundary: `@storytree/cli` runtime-depends on `@storytree/arc`,
# and `@storytree/arc` imports the CLI nowhere. Declaring the reverse would be a cross-story CYCLE
# (`cli → arc → cli`), which `check:boundaries` rule 2 refuses outright (ADR-0058), and it would also
# be code-unbacked, which rule 4 refuses independently. See "Dependency graph" below for the two
# couplings that USED to justify a cli edge and where each of them went.
depends_on: [drive-machinery, library, notice-board, storage-protocol]
consumed_by: [cli]
# Deciding ADRs (ADR-0037 §2): 183 is the arc itself (D3 puts every containment edge on the CHILD,
# which is what makes the upward view a query); 267 D4/D7 gives arcs the map's top drawer and derives
# `waiting` from open questions — its Consequences are why the join had to stop being CLI-only; 305
# collapses the increment lifecycle to one durable typed tier; 314 D5 makes the `open-question`
# artifact mandatory on escalation, which is why `question new` exists; 192 D2 is the packages-forward
# rule that REFUSED this story in 2026-08 and is the reason it could not be minted until the package
# existed; 369 is the deciding ADR for the extraction — the package, the arrow's direction, and the
# three helpers that moved down so this package never imports the CLI.
decisions: [183, 192, 267, 305, 314, 369]
---

# The arc — the durable initiative record a long-running effort is read from

**Outcome —** A session arriving cold on a long-running initiative reads its whole current state from
the arc alone, including whether the work parked there is still safe to act on.

## What this organism is

`packages/arc` (`@storytree/arc`) is the **initiative overlay** (ADR-0183):
a named multi-story owner intent, tracked through an increment log, to a closed end-state. It is the
tier a session's closing leg writes its residue to and the tier the next session orients from.

Four modules, one job:

- `arc-rollup.ts` — the derived arc → children **JOIN** as data. ADR-0183 D3 puts every containment
  edge on the CHILD (an increment's arc id, an open question's `arcRef`, an ADR's frontmatter `arc:`
  stamp, a story's frontmatter `arc:` stamp — this file's own is above), so an arc's children are
  always a QUERY and can never drift from the work they describe.
- `arc.ts` — the arc and increment WRITE verbs, plus the ADR-0023 render of that rollup.
- `increment.ts` — `increment check`, the mechanical freshness gate consuming a parked increment
  begins with.
- `question.ts` — `question new`, the arc-stamped `open-question` authoring surface (ADR-0314 D5).

It is **Node-only on purpose**: the rollup's loaders scan a checkout (`stories/`). The decisions are
no longer part of that scan — they are rows read through the same store the deps bag already held
(ADR-0403 dec 1), so the arc's ADR leg is an ordinary query.
The browser's view of an arc is the studio's wire mirror of `ArcRollup` in `apps/studio/src/types.ts`,
never this package.

## Why this is one story

One consumer — a session working a long-running initiative — asks one question in a loop: *what is
the current state of this effort, and is what it parked still safe to act on?* Every module above is
a step of answering it, and finishing any one of them leads the same consumer straight into the next
(`journey-principle`). The precondition is shared (a store holding an arc and its children, plus the
checkout the stamps live in); the observable is shared (what the arc surface reports).

The splitting rule does not fire at story grain. It DOES fire one rung down, and both splits are
already made and already argued: see [`increment-freshness-check`](increment-freshness-check.md)'s
frontmatter for why its precondition (a git checkout plus an `anchor.sha`) and its observable (a
commit count the store cannot produce) are genuinely not the arc view's, and
[`arc-explicit-id-fidelity`](arc-explicit-id-fidelity.md) for the third, which is a refinement of one
step rather than a step of its own — which is why it DEPENDS on the arc view instead of standing
beside it.

## Why this story could not exist until 2026-08-14

The arc domain was a **tenant of two buildings**: the write verbs lodged in `@storytree/cli` because
that is where the dispatcher is, and the join lodged in `@storytree/drive` for REACH — its own header
said so, *"because BOTH readers must share it and they cannot share cli"*, which is a statement about
who can SEE a file, not about whose job it is.

`capability-layer-coverage-arc` increment 6 (2026-08-08) read every `outcome:` line in the work
hierarchy and confirmed mechanically that **no story covered the arc domain**. It homed the organ as
two `cli` capabilities as a stopgap — beside a third, `arc-explicit-id-fidelity`, that had entered
`stories/cli` earlier for the same want of a home — and recorded the compromise, because
ADR-0192
decision 2 — packages-forward — refuses a NEW story whose code would sit inside another story's
package. That refusal is not waived here and no exception was carved:
ADR-0369
satisfies the rule the way it asks to be satisfied — the package first, the story second.

**The stopgap had a live cost, and that cost is what this story pays off.** `arc-derived-initiative-view`
owned a file inside `drive-machinery`'s building, and the only reason the landlord rule stayed silent
is that `readUnitSourceFiles` skips a unit with no `real:` arm — so rules 5 and 6 never looked. The
capability said so itself, in an honesty note that ended *"If this organ ever earns a `real:` arm, its
source file must be the `packages/cli` half or the organ must move to its own package first."* The
organ was **frozen out of a `real:` arm by its address**. It no longer is: every source file all three
capabilities name is now inside this story's own building, so a future `real:` arm trips no rule. That
is the discharge, and the note in the capability records it as paid rather than deleted.

**And the sibling case proves the cost was real rather than theoretical.**
[`arc-explicit-id-fidelity`](arc-explicit-id-fidelity.md) DOES have a `real:` arm, so the landlord rule
does look at it — and the moment `arc.ts` moved into `packages/arc`, leaving that spec in `stories/cli`
would have failed the packages-forward rule outright. The silence the other two enjoyed was never a
sanctioned exemption; it was the absence of a `real:` arm, and the first unit here to have one hit the
wall immediately.

Two open modeling calls close with this story, and neither is closed silently:
`stories/cli/story.md`'s **open modeling call 5** (which named option (b), extract `packages/arc`, as
one of three) and [`arc-derived-initiative-view`](arc-derived-initiative-view.md)'s own
**"Open modeling call (for the owner)"**, which predicted this exact end-state. Both are rewritten as
RESOLVED in place, pointing here. A third, smaller deferral closes with them: the long-noted
observation that `arc-explicit-id-fidelity` "arguably" wanted a `depends_on` on
`arc-derived-initiative-view`, left unauthored because the two lived in different stories and a
cross-story capability edge is not a shape the model has. It is authored now.

## Capabilities (3)

| # | capability | outcome | status | depends on |
|---|---|---|---|---|
| 1 | [`arc-derived-initiative-view`](arc-derived-initiative-view.md) | A session arriving cold on a long-running initiative reads its whole current state from the arc alone. | proposed | — |
| 2 | [`increment-freshness-check`](increment-freshness-check.md) | A session about to consume a parked increment is told mechanically whether the repo moved under it since the increment was anchored. | proposed | — |
| 3 | [`arc-explicit-id-fidelity`](arc-explicit-id-fidelity.md) | An agent scaffolding an arc with an explicit id receives a refusal instead of creating an arc under a silently truncated id. | proposed | `arc-derived-initiative-view` |

All three moved here from `stories/cli` with their code, unchanged in substance
(ADR-0369
D1). **Rows 1 and 2** are greenfield `proposed` with **no `real:` arm**: this landing was a MOVE, not
a re-proof, and registration after implementation does not turn them into inherited brownfield
(ADR-0395).

**Row 3 is a different animal, and the difference matters twice.** `arc-explicit-id-fidelity` is the
one unit here the spine genuinely drove red→green: the `--real` run `real-msgbv0z0` was promoted, and
promotion happens only on a SIGNED PASS. So it is REAL-buildable, it carries a `real:` arm, and it is
authored `proposed`; its signed pass derives green while `healthy` remains non-authorable, and
`healthy` is non-authorable (ADR-0020).

That `real:` arm is also why its move here was **not optional**. The ADR-0192 landlord rule reads
`proof.real.sourceFile`, and `readUnitSourceFiles` skips a unit that has none — which is precisely why
rows 1 and 2 could sit in `stories/cli` without tripping anything, and why row 1's honesty note called
that silence "a mechanical fact, not a decided exemption". Row 3 is READ. Once `arc.ts` became
`packages/arc/src/arc.ts`, leaving its spec in `stories/cli` would have made `cli` a story hosted
inside THIS story's building — refused by the packages-forward rule regardless of any declared edge,
because `cli` is not in the frozen `hostedStories.register`. It also belongs here on the merits,
independently of the rule: it refines `arcNew`, which row 1 owns, and row 1's spec has said so in prose
since it was written.

**Rows 1 and 2 are now independent ROOTS, and that is the substantive change the move forced.** Each
previously declared `depends_on: [unified-command-dispatch]` — a `cli` capability — on the ground that
the verbs are reached through the one dispatcher and return that capability's `Envelope`. Neither half
of that justification survives the extraction, and a capability's `depends_on` may only name siblings
inside its own story in any case:

- **Being dispatched by something is not depending on it.** `@storytree/cli` runtime-depends on
  `@storytree/arc`; the reverse import does not exist. That coupling is real and it is now declared
  where it actually points — provider-side, as this story's `consumed_by: [cli]`.
- **The `Envelope` no longer comes from the CLI's package.** It is `packages/drive/src/envelope.ts`,
  which `@storytree/arc` reaches through its declared `@storytree/drive` dependency. So the envelope
  coupling is covered by the story-level `arc → drive-machinery` edge — a real package.json edge —
  rather than by a capability-level edge across a story boundary.

The capability graph within this story is therefore **two roots and one edge**:
`arc-explicit-id-fidelity → arc-derived-initiative-view`, and nothing else. It is acyclic.

- Rows 1 and 2 are siblings, not a chain: `increment.ts` imports nothing from `arc.ts` or
  `arc-rollup.ts`, and its suite seeds its own increment rows instead of creating them through the arc
  verbs, so the second splitting trigger separates them cleanly and no edge is honest between them.
- Row 3's edge onto row 1 is the one real intra-story dependency: it refines the explicit-id selection
  inside row 1's `arcNew`. The direction was settled long before it could be declared — row 1's spec
  says the arrow "runs from it to this, never back. Declaring the reverse would put a cycle in the
  story graph" — and 2026-08-14 is simply the first date the two were siblings, which is what a
  capability `depends_on` requires. A previous session noted the edge "arguably" wanted declaring and
  left it alone because a cross-story capability edge is not a shape the model has; that reason is
  gone. Depending on a sibling with **no** `real:` arm is not new for this unit: its previous target,
  `unified-command-dispatch`, has none either.

**The package's fifth source file has no capability, and that is not a gap.** `src/index.ts` is the
barrel — it re-exports the four modules and states the design; it asserts nothing. It is owned at
STORY grain in `repo-manifest/source-ownership/arc.json`, the same shape `packages/cli/src/index.ts`
(→ `cli`) and `packages/drive/src/index.ts` (→ `drive-machinery`) already carry. Checked with
`storytree ownership packages/arc`: **five source files, five owned (100%)** — four by the capabilities
above and the barrel by this story. No unhomed organ, so no capability was invented to cover one.
(`arc.ts` is declared once, to row 1, even though row 3's proof scope also names it: `sourceOwnership`
answers "whose competence is this file", not "which units build against it", and those are different
questions — ADR-0317 D1.)

## Dependency graph (code-derived)

`@storytree/arc`'s real runtime `@storytree/*` imports (ADR-0010 §3), all cross-story, all declared
consumer-side above:

- `arc → drive-machinery` — `@storytree/drive`. Three couplings in one edge: the ADR-frontmatter
  scanner (`loadTitledAdrMetas`) and the work-hierarchy scanner (`loadWorkHierarchyIndex` /
  `resolveCites`) that the join derives its ADR and story legs from, and the `Envelope` every verb
  returns.
- `arc → library` — `@storytree/library`. The kinds themselves (`arc`, `increment`, `open-question`
  live in the knowledge schema), plus the id-minting and citation tokens (`kebabSlug`,
  `ASSET_REF_PREFIX`) that ADR-0369
  D3 moved DOWN here specifically so this package need not import the CLI to derive an id.
- `arc → storage-protocol` — `@storytree/storage-protocol`. The narrow `Store` seam every verb reads
  and writes through; the join is handed a store rather than opening one.

**THE ARROW RUNS arc → drive, NOT drive → arc, and the parked increment's end-state sentence is wrong
about this** (ADR-0369 D2 withdraws it): it read *"cli and drive consume it across a declared
`depends_on` edge"*, which was written before anyone had read the join's imports. Both cannot be true.
`drive`'s barrel drops its `arc-rollup` re-export instead, and the three surfaces that served the
rollup import `@storytree/arc` directly. Nothing about ADR-0267's guarantee changes: there is still
exactly ONE join, it simply moved one building further down, and the studio server still does not
import `@storytree/cli`.

Inbound, three consumers, each declared in the same commit as its `package.json` entry (a split
across commits reds `check:boundaries` in one direction or the other with no green intermediate
state):

- `cli → arc` — declared HERE as `consumed_by: [cli]`, the ADR-0074 §4 hub de-noising `stories/cli`
  requires of every spoke. `commands.ts` dispatches the verbs.
- `studio → arc` — declared consumer-side in [`stories/studio/story.md`](../studio/story.md). The
  studio server's `handleArcs` serves the SAME join `storytree arc show` renders, which is the whole
  point of ADR-0267. This also gives `studio`'s [`arc-orientation-lens`](../studio/arc-orientation-lens.md)
  a real story to draw its edge to for the first time.
- `desktop → arc` — declared consumer-side in [`stories/desktop/story.md`](../desktop/story.md). The
  local backend re-composes the same read.

Both surfaces reach it through a lazy `loadArc()` memo mirroring their existing `loadDrive()`, for
the vite config-load reason documented at those call sites — a real code import either way, so
neither is an `artifact_edges` annotation.

The merged declared graph (`depends_on ∪ consumed_by`) is **acyclic**: this organism is a pure sink
of three roots and a pure source to three consumers, and `drive-machinery` does not point back.

## UAT Test Criteria

**Goal —** Seed a store with an arc; park an increment on it anchored at a sha; author a question
through `question new --arc`; stamp an ADR and a story on disk with `arc:`; run `arc show` and witness
every child leg derive from the children's own stamps with no edge ever authored on the arc itself;
run `increment check` on the parked increment and witness the mechanical freshness verdict the
consuming session acts on; close the increment and witness closure be terminal rather than a delete.

**That walkthrough is authored here as prose and as ZERO numbered criteria, deliberately
(ADR-0294
D2).** Every step of it is already driven end-to-end by `pnpm --filter @storytree/arc test` — the exact
command that observes the two `proposed` capabilities above and the exact command this story's one
reliability gate names. A criterion here would name that same command a third time and would therefore
be the capability rung re-signed at the story rung, which is the 100-leg pattern ADR-0294 D2 deletes
rather than re-points. A story with zero UAT criteria greens honestly: the crown's own-proof clause
takes the union of UAT criteria and reliability gates, so this story's obligation is the single gate
below.

(`arc-explicit-id-fidelity` is absent from the table for a different reason, not an oversight: it
proves a REFUSAL on a malformed id, which is a defensive branch of one step rather than a step of the
walkthrough — and it earns its own signed `--real` verdict rather than riding any story-rung
signature.)

The journey's steps and the node that proves each, for audit:

| journey step | proven at | evidence |
| --- | --- | --- |
| the four child legs derive from the children's own stamps, and no other arc's children leak in | [`arc-derived-initiative-view`](arc-derived-initiative-view.md) (capability) | `packages/arc/src/arc-rollup.test.ts`, *"loadArcRollup joins all four child legs and leaks no other arc's children"* |
| a question authored through the write verb is what `arc show` then reports as waiting | [`arc-derived-initiative-view`](arc-derived-initiative-view.md) (capability) | `packages/arc/src/question.test.ts`, *"a question authored here is what arc show then reports as WAITING"* — the one test that closes the writer→reader loop end-to-end |
| an arc scaffolded by the write verb is immediately readable by the view path | [`arc-derived-initiative-view`](arc-derived-initiative-view.md) (capability) | `packages/arc/src/arc.test.ts`, *"a scaffolded arc is immediately readable by the arc VIEW path (writer + reader agree)"* |
| closure is terminal and never a delete | [`arc-derived-initiative-view`](arc-derived-initiative-view.md) (capability) | `packages/arc/src/arc.test.ts`, *"arc increment close marks one TERMINAL — it is closed, never deleted (ADR-0305 D5)"* |
| the parked increment's freshness is measured, not assumed | [`increment-freshness-check`](increment-freshness-check.md) (capability) | `packages/arc/src/increment.test.ts`, *"increment check is FRESH when no named path moved since the anchor"* and *"increment check is DRIFTED past the threshold → re-plan, not repair"* |

All five run under one command, and the deletion of a story-rung signature removed a second signature,
never the evidence.

## Reliability Gates

The story is **greenfield**: `packages/arc` carries a real, standing, passing OFFLINE suite over code
built inside Storytree. The suite predates this extracted story registration, but registration order
does not create brownfield provenance (ADR-0395). Its honest authored baseline is `proposed`; the
reliability gate below remains an evidence surface and does not establish provenance. Expandable: it
grows a `_(gate: build-tests)_` leg the moment observation proves insufficient
— a real arc/increment defect slipping through, or the live `--pg` write path earning a standing test.

1. **The arc organism's own suite is green** _(gate: observe)_ _(covers: arc-derived-initiative-view, increment-freshness-check)_
   `pnpm --filter @storytree/arc test`. The spine runs it at a clean committed HEAD and OBSERVES it
   green — the derived join and its purity (`arc-rollup.test.ts`), the arc and increment write verbs
   with their lifecycle refusals (`arc.test.ts`), the `open-question` authoring fence
   (`question.test.ts`), and the mechanical freshness verdict surface (`increment.test.ts`) — all
   offline, no DB and no API key — then signs an `adopted` verdict (`storytree gate run arc#gate-1 --pg`).

   > **`(covers:)` names TWO of the three capabilities, and the omission is the load-bearing part.**
   > `arc-derived-initiative-view` and `increment-freshness-check` green through this gate (ADR-0097
   > §5), which is the correct shape only because neither earns a `--real` verdict.
   > **`arc-explicit-id-fidelity` is deliberately absent.** The spine genuinely drove it red→green and
   > promoted the resulting signed pass, so it earns its own verdict through the prove-it-gate; listing
   > it here would let an adopt pass green a capability that HAS a real red behind it, which is the
   > inverse theatre ADR-0085 / ADR-0097 ban. Its proof command also is not this one — it spans
   > `@storytree/cli` too, because its regression drives the real binary — so this gate could not
   > observe it even if the rule allowed it.

   > **This command is new, and its newness is the ADR-0369 dividend worth naming.** Before the
   > extraction the same evidence needed `pnpm --filter @storytree/drive --filter @storytree/cli test`,
   > because the join and the verbs lived in different packages and each half saw something the other
   > could not. All four suites are now one package's, so the 71 tests
   > `arc-derived-initiative-view` cites run together for the first time.

## Proof

**Honest status — `proposed` (greenfield without a current story-level signed pass; NOT `healthy`).** The
STORY's own status describes the story's own proof state, and nothing here is signed. `packages/arc`
has a real, passing, offline automated suite that storytree's prove-it-gate never drove red→green,
but that proof fact does not change greenfield provenance (ADR-0395). `healthy` stays non-authorable (ADR-0020) — the authored
`status:` is never `healthy`; the world's crown DERIVES green from signed verdicts (ADR-0040) and only
when every capability is `healthy` AND every own-proof obligation is signed (ADR-0082 / ADR-0083
Fork A + ADR-0085). This story's obligations are exactly one: `arc#gate-1` above.

**Read that alongside one member that IS gate-proven.** `arc-explicit-id-fidelity` carries a promoted
`--real` signed pass (run `real-msgbv0z0`) and is authored `proposed`; the signed pass, not a different
authored provenance rung, is what derives green. A story is not the
minimum of its members' statuses; it is a claim about its OWN obligations, which here are unsigned.

**No `arc#` verdict or attestation exists.** The story was created on 2026-08-14 by
`arc-tier-extraction-arc-inc-01`, so there is nothing yet to sign or to have gone stale. The three
capabilities' own verdicts are keyed by CAPABILITY id, not by story, so the move re-pointed none of
them: `arc-explicit-id-fidelity`'s promoted pass is unaffected by changing which directory its spec
lives in. What the move DID change for it is its proof command and its `sourceFile` — a source-drift
question its next `--real` run answers, not an authoring one.

**THE UNHARNESSED POCKET, NAMED RATHER THAN AUTHORED AS A CRITERION.** Arcs and questions are
live-canonical: `arc new` and `question new` refuse without `--pg`, and the suites drive a real
`InMemoryStore`. That the live `--pg` path works end-to-end against Cloud SQL is exercised by nobody
in `pnpm gate`, and the freshness check's git side is injected as a `CountCommitsSince` seam, so a
real `git log` being wired correctly at the call site is likewise unproven. Both are HARNESS
statements, not judgment gaps (`human-witness-is-a-judgment-gap-not-cost`) — a machine could witness
either, given a harness. They are recorded here instead of authored as unbound criteria on purpose:
`stories/cli`'s UAT leg 4 is the cautionary case, an unbound machine leg that collected a stranded
`adopted` verdict in 2026-07 citing evidence that was never true of it. An obligation nothing can
sign is worse than a gap something can read.
