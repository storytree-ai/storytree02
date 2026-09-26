---
id: "arc-derived-initiative-view"
tier: capability
story: arc
title: "The arc's derived initiative view — children stamp the arc, the arc stamps nothing"
outcome: "A session arriving cold on a long-running initiative reads its whole current state from the arc alone."
status: proposed
proof_mode: integration-test
# An independent ROOT within `arc`. It declared `depends_on: [unified-command-dispatch]` under its
# previous `cli` home, on the ground that the verbs are reached through the one dispatcher and return
# that capability's `Envelope`. ADR-0369 retires BOTH halves of that justification, and the body's
# "Depends on" paragraph states them; a capability's `depends_on` may only name siblings inside its
# own story in any case, and `unified-command-dispatch` is not one now.
depends_on: []
# Deciding ADRs (ADR-0037 §2): ADR-0183 D3 puts every containment edge on the CHILD (the derived
# view); ADR-0267 D4/D7 gives arcs the map's top drawer and derives `waiting` from open questions —
# its Consequences are why the JOIN had to stop being CLI-only; ADR-0305 collapses the increment
# lifecycle to one durable typed tier (proposal → ready → active → closed); ADR-0314 D5 makes the
# `open-question` artifact mandatory on escalation, which is why `question new` exists and why its
# `--arc` is required where the schema's `arcRef` is optional; ADR-0369 D1/D2 moves this organ and
# its three source files into `@storytree/arc` and fixes the arrow at arc → drive; ADR-0628 lets an
# increment wait on another increment on ANY arc — the arc gate one tier down (contract 11).
decisions: [183, 267, 305, 314, 369, 628]
# A greenfield capability registered after its implementation and tests (the arc that authored it:
# capability-layer-coverage-arc increment 6, 2026-08-08; the arc that re-homed it:
# arc-tier-extraction-arc increment 1, 2026-08-14). It resolves THREE repo manifest
# `sourceOwnership` declarations, all three now in this story's OWN building:
# `packages/arc/src/arc.ts`, `packages/arc/src/question.ts` and `packages/arc/src/arc-rollup.ts`.
#
# WHY THE JOIN IS OWNED HERE — the question this note used to have to argue, and no longer does.
# Until 2026-08-14 `arc-rollup.ts` lived in `packages/drive`, and this note carried a five-precedent
# line (`envelope.ts`, `secrets.ts`, `adr-*.ts`, `source-ownership-map.ts`, `subtree-match.ts` — all
# `packages/drive` files owned by `cli` capabilities) to justify owning a file in another story's
# building. That argument is SPENT, not merely unused: ADR-0369 D1 moved the join into
# `@storytree/arc` alongside the verbs, so ownership and address now agree and the precedent line is
# not load-bearing on anything. The reason the join sat in `drive` at all is worth keeping, because
# it explains why the move was safe: the file's own header said it lived there "because BOTH readers
# must share it and they cannot share cli" — a REACH statement, never a competence claim. Reach is
# preserved exactly (`@storytree/arc` sits below both the CLI and the studio server, and the studio
# still does not import `@storytree/cli`), so ADR-0267's one-join guarantee is untouched.
#
# THE TWO-SUITE PROOF COMMAND HAS COLLAPSED TO ONE, AND WHY IT EXISTED IS THE POINT.
# It was `pnpm --filter @storytree/drive --filter @storytree/cli test`, and that was not a
# convenience — each half saw something the other could not. `--filter @storytree/cli` reached the
# join only THROUGH `arc.ts`'s static import, so it exercised `arc-rollup.ts` but never ran
# `arc-rollup.test.ts`, whose eight cases hold the join's own purity and defensive branches;
# `--filter @storytree/drive` ran those eight and never saw a single verb. A single-package command
# would have left one half of this outcome unproven. That is now a description of a world that
# stopped existing: all four suites are `@storytree/arc`'s, one filter runs every one of them, and
# the 71 tests below run together for the first time. The note is rewritten rather than deleted
# because a reader who finds a one-filter command here should be able to tell that it is a
# SIMPLIFICATION EARNED by ADR-0369, not an author who forgot half the evidence.
#
# The `proof:` block is spec-borne (ADR-0057); there is deliberately NO `real:` arm:
#   1. This landing was a MOVE, not a re-proof. ADR-0395 classifies this unsigned greenfield unit as
#      `proposed`; registration order does not make it brownfield or Adopt-bound.
#      CORRECTED IN PLACE 2026-08-14 (ADR-0139), because the reason this clause used to give is dead:
#      it said a `real:` arm "would also enter the pinned REAL-buildable snapshot in
#      `packages/cli/src/node-build.test.ts`, where this id sorts BETWEEN `app-surface-world-view` and
#      `arc-explicit-id-fidelity` — exactly the adjacency `:627` pins." THERE IS NO SUCH PIN ANY MORE.
#      ADR-0341 D4 replaced the hardcoded catalogue with a DERIVED assertion (`specDeclaredRealIds` walks
#      `stories/` and is compared against the in-code registry), and the test now says in its own
#      words: "this file keeps no list to append to … adding a node must never mean editing this
#      file." Adding a `real:` arm here would therefore cost no snapshot edit at all. Verified at
#      HEAD: `:627` is an unrelated `--emit-wisp` test. The DECISION is unchanged and rests on
#      ADR-0085/0094 alone; only the second, mechanical reason was stale, and a reader who trusted it
#      would have gone looking for a list that no longer exists.
#   2. `readUnitSourceFiles` (`packages/cli/src/check-boundaries.ts`) `continue`s on an absent `real`,
#      so this unit contributes nothing to `unitSourceFiles` and neither the ADR-0192 landlord rule
#      (rule 5) nor the packages-forward refusal (rule 6) fires over its files.
#      THE DIFFERENCE ADR-0369 MAKES: that silence used to be load-bearing, because a file of this
#      unit sat in `drive-machinery`'s building and the empty `real:` arm was the only thing keeping
#      rule 5 quiet. It no longer is. Every file above is inside `stories/arc`'s own building, so a
#      future `real:` arm trips nothing — the empty arm is now an ADR-0094 statement about how this
#      unit was proven, and nothing else. See the discharged residual in the body.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/arc", "test"]
  scope:
    testGlobs:
      - "packages/arc/src/arc-rollup.test.ts"
      - "packages/arc/src/arc.test.ts"
      - "packages/arc/src/question.test.ts"
    sourceGlobs:
      - "packages/arc/src/arc-rollup.ts"
      - "packages/arc/src/arc.ts"
      - "packages/arc/src/question.ts"
---

# The arc's derived initiative view — children stamp the arc, the arc stamps nothing

**Outcome —** A session arriving cold on a long-running initiative reads its whole current state from
the arc alone.

**Depends on —** nothing. This is an independent root within [`arc`](story.md), and it became one in
the extraction (ADR-0369).
It used to declare `unified-command-dispatch`, on the ground that the verbs are reached through the
one dispatcher and return that capability's `Envelope`. Both halves are now wrong, and they fail
differently, so both are worth stating:

- **Being dispatched by something is not depending on it — and the arrow has since inverted at the
  package boundary.** `@storytree/cli` runtime-depends on `@storytree/arc`; the reverse import does
  not exist. Declaring `arc → cli` would make the merged story graph CYCLIC (`cli → arc → cli`),
  which `check:boundaries` refuses under ADR-0058, and would be a code-unbacked edge besides. The
  real coupling is declared where it points: provider-side, as [`arc`](story.md)'s `consumed_by: [cli]`.
- **The `Envelope` no longer comes from the CLI's package.** It is `packages/drive/src/envelope.ts`
  (ADR-0112's reach-move), reached through `@storytree/arc`'s declared `@storytree/drive` dependency.
  That coupling is covered by the story-level `arc → drive-machinery` edge, which is a real
  package.json edge — not by a capability edge reaching across a story boundary, which is not a shape
  the model has.

No edge to [`increment-freshness-check`](increment-freshness-check.md) either: see its frontmatter for
why the two are siblings rather than a chain.

**And no OUTBOUND edge to [`arc-explicit-id-fidelity`](arc-explicit-id-fidelity.md) — because the
arrow runs the other way, and as of 2026-08-14 it is authored there rather than merely asserted here.**
That capability is a refinement OF this one's `arcNew`, so it depends on this, never the reverse;
declaring the reverse would put a cycle in the story graph. It used to be a `cli` capability, which is
why this paragraph could only describe the direction instead of pointing at a declaration: a
capability's `depends_on` names siblings, and the two were in different stories. ADR-0369 made them
siblings, and `arc-explicit-id-fidelity` now carries `depends_on: [arc-derived-initiative-view]`.

> **Proof status (honest) — `proposed` (a real, standing, passing suite; observational; NOT
> `healthy`).** storytree's own prove-it-gate did not drive any of this red→green, but the code was
> built inside Storytree, so ADR-0395 keeps its unsigned authored baseline at `proposed`.
>
> **The proof — 71 tests across three files**, all now in one package and one command:
> `packages/arc/src/arc.test.ts` (51), `packages/arc/src/question.test.ts` (12),
> `packages/arc/src/arc-rollup.test.ts` (8).
>
> **THE RESIDUAL IS DISCHARGED — recorded as paid, not deleted (ADR-0369).** This note used to state
> a live cost plainly: this capability owned a file inside `drive-machinery`'s building, ADR-0192
> decision 2 pushes genuinely new hosted work toward its own package, and the only reason no rule
> fired was that this retrospective spec leaves `real:` empty — the rules read `proof.real`, not
> the ownership map. It ended: *"If this organ ever earns a `real:` arm, its source file must be the
> `packages/cli` half or the organ must move to its own package first."* **The organ moved.** Every
> source file this unit names is now inside `stories/arc`'s own building, so the condition the note
> set is met and the mechanical silence it flagged is no longer doing any work. The consequence is
> concrete rather than tidy: this capability was **frozen out of a `real:` arm by its address**, unable to earn
> a `real:` arm without tripping the landlord rule. It is no longer frozen. Its `proposed` baseline
> records greenfield provenance without manufacturing proof.

## Guidance

**The invariant this capability exists to hold (ADR-0183 D3).** Every containment edge lives on the
CHILD — a plan's `arcRef`, an open question's `arcRef` (ADR-0267 D4), an ADR's frontmatter `arc:`
stamp, a story's frontmatter `arc:` stamp. The arc row itself is never edited when a child lands
(ADR-0305 D3). So the upward view is a QUERY and can never drift from the work it describes, and
`packages/arc/src/arc-rollup.ts` is the one place that query lives.

**Still exactly ONE join, one building further down.** The join moved out of `@storytree/drive` so the
arc domain could own its own address, not so a second derivation could exist. The CLI render, the
studio server's `handleArcs` and the desktop backend all import `@storytree/arc` directly and share
this file — which is the property ADR-0267 asked for. What the drive placement was protecting was
"both readers share the same derivation", never "the derivation lives in drive": the studio server
still may not import `@storytree/cli`, and `@storytree/arc` sits below both.

**The three files and the one job.** `arc-rollup.ts` derives the join and is PURE at its core
(`deriveArcRollup`); `arc.ts` owns the arc and increment WRITE verbs plus the rendering of that
rollup into an ADR-0023 envelope; `question.ts` owns `question new`, which is an arc-stamped write
whose whole purpose is to put something into the rollup's `waiting` leg. They are import-independent
of one another except for `arc.ts`'s dependency on the join, and they are one capability because they
share one observable: what `arc show` reports.

**`--arc` is required here though `arcRef` is optional on the schema.** A permissive schema and a
fail-closed authoring path are the two halves of keeping old rows readable while refusing to mint new
bad ones. An unhomed question is not a lesser question but an INVISIBLE one — the arc surface derives
its waiting set by querying `arcRef`, so a question without one is authored into a tier nothing reads.

**An increment closes; it is never deleted (ADR-0305 D2/D5).** The lifecycle is
`proposal → ready → active → closed` with no `consumed` and no `superseded` state, because the
difference between those two terminal states was a REASON rather than a state. `--note` is therefore
REQUIRED when there is no `--pr`, so a closure that is not a landing cannot read as one.

**A close with no PR also records what it meant.** ADR-0564 D1's `--disposition landed|failed|withdrawn`
is optional beside a PR, which derives `landed`; with no PR nothing derives it, so an unrecorded close
draws grey for good. `arc increment close` and `arc increment add` therefore both refuse a PR-less close
without it — one refusal naming every missing flag, before any write. `arc close` records its terminal
increment as `landed` itself, because the verb asserts the end state was met. The PARKED / REOPENED /
UN-PARKED rows that `arc park` and `arc reopen` write are exempt: they record a lifecycle decision, not
work, and none of the three readings is true of them. Rows closed before the rule are not backfilled.

**Work waiting on the owner's answer reads as waiting — derived, never stored (ADR-0574).** An
escalating session keeps its residue on the OPEN increment it was driving and links the question it
authored through that increment's `waitsOn` field. `incrementWaitingOn` in `arc-rollup.ts` is the one
rule: open work whose link names an unsettled question — on any arc — reads waiting; closed work never
does, and a link to a question the corpus does not hold holds nothing. The rollup carries the reading
as `waitingOn`; `arc list` counts it apart from open work, and `arc show` takes it out of the
proposal / ready / active counts, names the question on its row and offers no freshness check on it.
Settling the question releases the work with no write to the increment. `question new` ends by
printing that link command, with the new question's id filled in, and the `arc show` that confirms it
took. The link is its own field
rather than a `cites` entry for the reason `gatedBy` is not `dependsOn` (ADR-0523): a hold is a
schedule, not support.

**Work queued behind other work reads as queued — derived, never stored (ADR-0628).** An increment can
wait on another increment on ANY arc through its own `gatedBy` edge: the arc gate one tier down, so
only that increment waits and the rest of its arc stays takeable. `incrementQueuedBehind` in
`arc-rollup.ts` is the one rule. A gate holds while the held increment is open and the blocker has not
LANDED; a blocker that closed any other way, or that cannot be found, keeps holding and says so. The
rollup carries the reading as `queuedBehind` on the held row and the reverse edge as `holdsUp` on the
blocker's. `arc show` and `arc list` count queued work apart from takeable work and never offer it;
`arc increment start` REFUSES while any wait holds, whether the increment's own or its arc's. Both gate
verbs walk ONE wait graph over both gate kinds before writing, because a loop can close through the two
together that neither sees alone.

## Integration test

**Goal —** Seed a store with an arc, stamp each child surface onto it independently — an increment
parked then closed, a question authored through `question new --arc`, an ADR and a story stamped on
disk — then drive `arc show` and witness the view derive every one of them from the children's own
stamps, with no edge ever authored on the arc itself.

Real collaborators, no stubs within the organism: the verb-side suites drive the real `arcCommand` /
`questionCommand` over a real `InMemoryStore` and a real temp checkout for the frontmatter stamps, so
the real `loadArcRollup` runs underneath — and since ADR-0369 it runs from the same package rather
than across a package boundary. `question.test.ts` closes the loop explicitly: it imports `arcCommand`
and asserts a question authored through the write verb is what `arc show` then reports as waiting.

## Contracts (11)

The test-proven leaf behaviours — each **one isolated automated test** with collaborators stubbed
(ADR-0002). Test titles are cited rather than line ranges, which rot.

*(Heading count corrected in place from 8 to 9, 2026-08-14: contract 9 was appended by ADR-0337's
`arc reopen` work without re-stamping the heading. The parser reads the numbered items, never the
heading, so nothing was broken — but a reader counting from the heading would have missed a contract.)*

1. **`child-stamps-derive-the-view`** — the join reads all four child legs off the children and leaks no other arc's children
   - **asserts —** `loadArcRollup` joins increments, plans, ADRs and stories for exactly the requested arc; a child stamped to a different arc never appears.
   - **covers —** `packages/arc/src/arc-rollup.ts` (`deriveArcRollup`, `loadArcRollup`, `arcRefOf`, `storyArcStamps`)
   - **proven by —** `packages/arc/src/arc-rollup.test.ts`, *"loadArcRollup joins all four child legs and leaks no other arc's children"*; and end-to-end through the render in `packages/arc/src/arc.test.ts`, *"arc show derives plans (arcRef), ADRs (frontmatter stamp), and stories (frontmatter stamp)"* (both REAL, passing)
2. **`waiting-is-derived-never-invented`** — `waiting` comes from open questions, and no `blocked` state is manufactured
   - **asserts —** The rollup's `waiting` leg is derived from the arc's open questions (ADR-0267 D7); no `blocked` flag is invented where the children do not carry one.
   - **covers —** `packages/arc/src/arc-rollup.ts` (`deriveArcRollup`, the question leg)
   - **proven by —** `packages/arc/src/arc-rollup.test.ts`, *"ADR-0267 D7: `waiting` is derived from open questions, and `blocked` is NOT invented"* (REAL, passing)
3. **`the-join-is-pure`** — the derivation reaches no store and no filesystem
   - **asserts —** `deriveArcRollup` returns identical output for identical inputs with no store or `fs` in reach, so the surfaces that render it cannot diverge on I/O.
   - **covers —** `packages/arc/src/arc-rollup.ts` (`deriveArcRollup`)
   - **proven by —** `packages/arc/src/arc-rollup.test.ts`, *"deriveArcRollup is PURE — the same inputs join identically with no store or fs in reach"* (REAL, passing)
4. **`writer-and-reader-agree`** — an arc scaffolded by the write verb is immediately readable by the view path
   - **asserts —** `arc new` stamps every mechanical field and the resulting row is read back by the derived view without a migration or a second write.
   - **covers —** `packages/arc/src/arc.ts` (`arcNew`), `packages/arc/src/arc-rollup.ts` (`loadArcRollup`)
   - **proven by —** `packages/arc/src/arc.test.ts`, *"a scaffolded arc is immediately readable by the arc VIEW path (writer + reader agree)"* (REAL, passing)
5. **`an-increment-closes-and-is-never-deleted`** — closure is terminal, write-once, and requires a reason and a recorded reading when it carries no PR
   - **asserts —** `arc increment close` marks one increment terminal rather than removing it; a second closure is refused; `--note` is required when there is no `--pr`. With no `--pr`, `arc increment close` and `arc increment add` also require `--disposition`, naming every missing flag in one refusal before anything is written; beside a PR it stays optional and unstamped. `arc close` records its terminal increment as `landed`; the lifecycle-marker rows `arc park` and `arc reopen` write record no reading.
   - **covers —** `packages/arc/src/arc.ts` (`arcIncrementClose`, `arcIncrementAdd`, `arcClose`, `arcPark`, `arcReopen`)
   - **proven by —** `packages/arc/src/arc.test.ts`, *"arc increment close marks one TERMINAL — it is closed, never deleted (ADR-0305 D5)"*, *"arc increment close REQUIRES a reason when there is no --pr (ADR-0305 D2's collapsed states)"*, *"arc increment close with no --pr REFUSES without --disposition, naming everything missing in ONE message"*, *"arc increment add with no --pr REFUSES without --disposition, and records the reading it is given"*, *"arc close defaults the date to today and works without a PR"* and *"arc park and arc reopen write their LIFECYCLE MARKER with no PR, and record no reading on it"* (REAL, passing)
6. **`a-question-is-homed-or-refused`** — `--arc` is required, must resolve, and must name an arc
   - **asserts —** `question new` refuses a missing `--arc`, a dangling `--arc`, and an `--arc` naming a doc of another kind — before writing anything.
   - **covers —** `packages/arc/src/question.ts` (`questionNew`, the arc fence)
   - **proven by —** `packages/arc/src/question.test.ts`, *"question new refuses a dangling arc — a question no arc surfaces is the measured failure"* and *"question new refuses an --arc that names a doc of some other kind"* (REAL, passing)
7. **`a-homed-question-surfaces-as-waiting`** — the write verb and the derived view meet on one observable
   - **asserts —** A question authored through `question new --arc` is exactly what `arc show` subsequently reports in the arc's waiting leg.
   - **covers —** `packages/arc/src/question.ts` (`questionNew`), `packages/arc/src/arc.ts` (`arcCommand` render), `packages/arc/src/arc-rollup.ts` (the question leg)
   - **proven by —** `packages/arc/src/question.test.ts`, *"a question authored here is what arc show then reports as WAITING"* (REAL, passing)
8. **`live-canonical-writes-refuse-offline`** — arcs and questions are live-only, and the refusal is guidance
   - **asserts —** `arc new` and `question new` refuse without a live store, returning `ok:false` with a `--pg` pointer rather than writing to the offline seed.
   - **covers —** `packages/arc/src/arc.ts` (`arcNew`), `packages/arc/src/question.ts` (`questionNew`)
   - **proven by —** `packages/arc/src/arc.test.ts`, *"arc new refuses offline — arcs are live-canonical"*; `packages/arc/src/question.test.ts`, *"question new refuses offline — questions are live-canonical"* (REAL, passing)
9. **`a-lifecycle-bit-moves-only-with-prose`** — both lifecycle transitions require their reason and each lands its own durable increment
   - **asserts —** `arc close` requires `--outcome` and `arc reopen` requires `--reason`; either refusal writes NOTHING on either side; each success records its increment before flipping the flag, so an interrupt leaves the arc in its prior state carrying a visible extra increment rather than a flipped bit with nothing behind it; and close → reopen → close round-trips, leaving three durable rows rather than one mutated in place. Declared for BOTH directions in one contract because the invariant is one invariant — the flip is a projection of the prose that supports it (ADR-0239 D2, extended to the opening direction by ADR-0337, which withdrew D2's owner-only reservation on the grounds that it was never given a verb and so left the transition reachable by nobody).
   - **covers —** `packages/arc/src/arc.ts` (`arcClose`, `arcReopen`)
   - **proven by —** `packages/arc/src/arc.test.ts`, *"arc close REFUSES without --outcome — no closure without the prose that justifies it"*, *"arc reopen refuses without --reason, and writes NOTHING on that refusal"*, *"arc reopen records the increment, flips to active, and returns the arc to the worklist"* and *"close → reopen → close round-trips, and every transition leaves its own durable increment"* (REAL, passing)
10. **`work-waiting-on-the-owner-is-held-not-offered`** — open work linked to an unanswered question is counted and marked as held until that question is settled (ADR-0574)
   - **asserts —** `incrementWaitingOn` reads an increment as waiting only when the increment is open, its `waitsOn` names the question, and that question is unsettled on any arc; a closed increment, a settled question and a link to no known question each hold nothing; `arc list` counts held work apart from open work, and `arc show` removes it from the proposal / ready / active counts, names the question on its row and offers no freshness check on it; and settling the question releases the work with no write to the increment.
   - **covers —** `packages/arc/src/arc-rollup.ts` (`incrementWaitingOn`, `deriveArcRollup`, `summariseArcRollup`), `packages/arc/src/arc.ts` (the `arc list` row, `renderArcRollup`, `arcShowNext`)
   - **proven by —** `packages/arc/src/arc-rollup.test.ts`, *"incrementWaitingOn (ADR-0574): OPEN work, LINKED to an UNSETTLED question — each of the three is required"*, *"incrementWaitingOn: a link it cannot follow holds NOTHING, and an untyped row never throws"* and *"deriveArcRollup resolves waitingOn against EVERY question, onto OPEN work only, and leaks no question"*; `packages/arc/src/arc.test.ts`, *"arc list counts work WAITING ON THE OWNER apart from open work, and settling releases it (ADR-0574)"* and *"arc show marks work waiting on the owner as HELD — counted apart, named, and never offered (ADR-0574)"* (REAL, passing)
11. **`work-queued-behind-another-increment-is-held-until-it-lands`** — an increment gated on another increment, on any arc, is counted and marked as queued, and cannot be started, until that increment lands (ADR-0628)
   - **asserts —** `incrementQueuedBehind` holds open work while a blocker it names is open, has closed without landing, or cannot be found, and releases it only when the blocker lands; closed work waits on nothing. The rollup carries `queuedBehind` on the held row and `holdsUp` on the blocker's; `arc show` and `arc list` count queued work apart from takeable work, name the blocker and what releases it, and offer no freshness check on it. `arc increment gate` records the edge on the held increment and refuses a self-gate, a missing or wrong-kind increment, closed work on either side and a cycle; both gate verbs walk one wait graph over increment gates and arc gates together; `arc increment start` refuses while the increment's own gate or its arc's holds; and a landing releases the work with no write to it.
   - **covers —** `packages/arc/src/arc-rollup.ts` (`incrementQueuedBehind`, `arcGatesOf`, `deriveArcRollup`), `packages/arc/src/arc.ts` (`waitGraphOf`, `arcGate`, `arcIncrementGate`, `arcIncrementUngate`, `arcIncrementPromote`, `incrementHoldLine`, `renderArcRollup`, `arcShowNext`, the `arc list` row)
   - **proven by —** `packages/arc/src/increment-gate.test.ts`, *"incrementQueuedBehind: an OPEN blocker holds, a LANDED one releases, and one closed any other way KEEPS holding"*, *"deriveArcRollup resolves queuedBehind on the HELD row and holdsUp on the BLOCKER's, across arcs"*, *"waitGraphOf: every implied wait, own gates first — and nothing out of a closed node or through a wrong-kind target"*, *"arc increment gate REFUSES a ring that only closes THROUGH an arc gate — the two kinds walked as one (D4)"*, *"arc gate REFUSES a ring closed through an INCREMENT gate, and names each member's kind (ADR-0628 D4)"*, *"arc increment start REFUSES while the increment is queued, and takes it the moment its blocker LANDS"*, *"arc show marks every QUEUED row with what it waits on and what releases it, and counts it apart"* and *"arc list counts QUEUED work apart from open work, and a landing releases it with no write to the held row"* (REAL, passing)

## The modeling call this capability raised — RESOLVED (2026-08-14)

**This section is kept, rewritten, rather than deleted, because the call it recorded was answered and
a reader deserves the answer beside the question.** It read:

> **This organ has no owning organism story, and homing it under the CLI shim is a compromise, not a
> resolution.** … The honest end-state is its own story backed by its own workspace package, which is
> what ADR-0192 decision 2 (packages-forward) requires of any new story. That is a code move plus an
> owner-reviewed diff, not an ownership declaration, so it was not taken here.

**The code move was taken.** The owner directed it on 2026-08-09, answering the since-retired open
question `oq-where-should-the-arc-tier-live-the-cli-shim-its-own-packa` with its option (b);
`arc-tier-extraction-arc` increment 1 delivered it and
ADR-0369
records the decision. `packages/arc` is the building, [`arc`](story.md) is the story, and this
capability moved into it with `increment-freshness-check` and with every one of its source files.

Three things the call named are now true rather than aspired to: the arc tier has an organism story
(so `studio`'s [`arc-orientation-lens`](../studio/arc-orientation-lens.md) has a real story to draw
its edge to); ADR-0192 D2 is satisfied rather than excepted, because the package was built first; and
`stories/cli`'s open modeling call 1 (the shim-vs-journey split) has one fewer counter-example — this
organ is no longer a deep per-domain journey parked on the shim. That call remains OPEN on its own
terms, and this capability no longer bears on it.
