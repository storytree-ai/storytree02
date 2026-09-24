---
id: "verification-decay-instruments"
tier: capability
story: cli
title: "The chartered decay instruments — located, charged to their author, held to a per-instrument ceiling"
outcome: "Each of the six chartered instruments reports the decay it locates as a finding charged to the branch that authored it."
status: proposed
proof_mode: integration-test
depends_on: []
# Deciding ADRs (ADR-0037 §2): ADR-0252 D1 charters the instrument roster and D3 is why this is a
# drain obligation on the session rather than a merge barrier; ADR-0278 adds the fifth instrument
# (`unproven-seam-default`); ADR-0424 D5 adds the sixth (`decision-source-drift`) into this family
# rather than behind a rung of its own; ADR-0301 is the attribution half — a breach resting entirely
# on signals this branch did not author is `inherited` and does not block the landing.
decisions: [252, 278, 301, 424]
# ⚠ WIDENED FROM FIVE TO SIX — the roster and this unit's scope agree again as of 2026-08-31
# (`prove-unproven-capabilities-arc` inc-25, FINDING 2). `CHARTERED_INSTRUMENTS`
# (verification-decay.ts:211-226) has SIX members. inc-23 narrowed this unit's title and outcome to
# the five its `scope` bound, and recorded the sixth as an ownership hole it deliberately would not
# close unilaterally: no spec under `stories/**` named `decision-source-decay` or
# `decision-source-drift` at all, so 34.6 KB of source and a 28-test suite were bound by no
# capability's proof block. That hole is what this edit closes — the sixth joins as contract 7 and
# the scope below now binds its source/test pair.
#
# ⚠ AND INC-23's STATED REASON FOR THE BOUNDARY DOES NOT SURVIVE READING THE FILE — recorded plainly,
# because it is the argument a later reader would otherwise re-apply. It held that "a judge over
# injected repo facts and a judge that opens a database connection are not one proof", quoting the
# source's own charter comment that `decision-source-drift` is "the first that dials the store".
# The judge dials nothing. `decision-source-decay.ts`'s header says so in its own words — "Pure and
# browser-safe apart from the parser: no filesystem, no store, no clock. The disk read and the store
# dial live in the thin check-verification-decay.ts entrypoint, which hands this module file TEXT and
# gets findings back" — and the bytes agree: `createPool`/`PgLibraryStore` are imported at
# check-verification-decay.ts:94 and used at :805-807, and neither `decision-source-decay.ts` nor its
# suite contains `node:fs`, `readFileSync`, `createPool`, `PgLibraryStore` or `execFileSync` at all.
# The charter comment was describing what changed for the GATHERER, and it says so in its own next
# clause ("see check-verification-decay.ts's header for what that changed"). The gatherer is glue and
# is excluded from this scope for the five as well, so the sixth judge is SYMMETRIC with them, not a
# second kind of thing. Why that makes it one organ rather than two is argued in `## Guidance`.
#
# THE MANIFEST AND THE PROOF BLOCK NOW AGREE. `repo-manifest.json`'s `packages/cli/src/*decay*.ts`
# key already homed all four decay modules to this unit; the capability-grain gap was that the proof
# block bound only two of the three judges. It binds all three now, and the key stays coarser than
# the scope by exactly one file (`check-verification-decay.ts` — see the note below).
# A greenfield capability registered after its implementation and tests (the arc that authored it:
# capability-layer-coverage-arc increment 5, 2026-08-08). It resolves ONE story-grain
# `repo-manifest.json` declaration (`packages/cli/src/*decay*.ts`).
# THE MANIFEST KEY IS COARSER THAN THIS SCOPE, DELIBERATELY. The key also matches
# `check-verification-decay.ts`, which is NOT in the scope below: under rule (6) fence 2 a gatherer
# joins the organ only when it manufactures observability that does not otherwise exist, and that
# file reads only facts already on disk (source text, package.json, git). It is the
# `check-boundaries.ts` shape — glue — and the precedent for declaring it here anyway is exactly
# `check-boundaries.ts`, which the repo manifest homes to `organism-boundary-tooling` while that
# capability's own spec excludes it. Ownership answers who is RESPONSIBLE; the proof block answers
# what is BOUND. They are allowed to differ, and here they do.
# The `proof:` block is spec-borne (ADR-0057); there is deliberately NO `real:` arm:
#   1. ADR-0395 — registration order does not make greenfield code brownfield or Adopt-bound; without
#      a current signed pass its honest authored baseline is `proposed` (corrected by the pre-merge librarian pass from ADR-0159,
#      which is about frontend-builder's two-stage visual proof and says nothing about manufactured
#      reds). A `real:` arm would also move the pinned REAL-buildable snapshot in
#      `packages/cli/src/node-build.test.ts` (verified: this id appears there zero times).
#   2. `readUnitSourceFiles` (packages/cli/src/check-boundaries.ts:210-234) `continue`s on an absent
#      `real` (`:226`), so this unit contributes nothing to `unitSourceFiles` and the ADR-0192
#      landlord rule does not fire. All three files are in `packages/cli`, this story's OWN building.
# THE COMMAND DOES NOT CHANGE WHEN THE SCOPE WIDENS, and that is the point: the sixth suite
# (`decision-source-decay.test.ts`) was already being RUN by `pnpm --filter @storytree/cli test` — it
# was simply not BOUND by any spec, which is what made it invisible at the capability rung while
# passing on every gate.
proof:
  command:
    file: pnpm
    args: ["--filter", "@storytree/cli", "test"]
  scope:
    testGlobs:
      - "packages/cli/src/verification-decay.test.ts"
      - "packages/cli/src/decay-attribution.test.ts"
      - "packages/cli/src/decision-source-decay.test.ts"
    sourceGlobs:
      - "packages/cli/src/verification-decay.ts"
      - "packages/cli/src/decay-attribution.ts"
      - "packages/cli/src/decision-source-decay.ts"
---

# The chartered decay instruments — located, charged to their author, held to a per-instrument ceiling

**Outcome —** Each of the six chartered instruments reports the decay it locates as a finding charged
to the branch that authored it.

**Six of six —** `CHARTERED_INSTRUMENTS` holds SIX members and this unit now binds all six. Until
2026-08-31 it bound five and said so, with the sixth — `decision-source-drift` (ADR-0424 D5) — named
as an ownership hole: no spec under `stories/**` mentioned `decision-source-decay` or
`decision-source-drift` at all, so 34.6 KB of source and a 28-test suite had no capability owner. The
sixth joins here rather than forking into a unit of its own; the frontmatter records what was checked
and `## Guidance` argues why. It is recorded in the body too because a reader who takes only the
outcome away is the reader the previous wording misled.

**Depends on —** nothing within this story. It is a root: the three modules reach outside themselves
only for shared PARSERS and PURE RULES, never for another in-story unit's delivered outcome.
`verification-decay.ts` takes the TypeScript compiler API and `readTestCallTitle` from
`@storytree/orchestrator` (`:70`) — the same title reader ADR-0126's classifier uses, imported so the
`vacuous-proof` join is spelled identically on both sides rather than re-derived.
`decision-source-decay.ts` takes the same compiler API plus `classifySourceDrift` and `hashSpan` from
`@storytree/orchestrator`, `isBoundSource` / `isRefutedSource` / `readDecisionSources` from
`@storytree/library`, and the `ChangeEvent` / `TextQuote` shapes from `@storytree/proof-protocol` —
and the composition is the point rather than a convenience: both proof-tier rules had ZERO non-test
callers when measured on 2026-08-23, and a second copy of either here would open the very drift seam
ADR-0016 exists to prevent. Shared rules, not consumed outcomes.

> **Proof status (honest) — `proposed` (a real, standing, passing suite; observational; NOT
> `healthy`).** Storytree's prove-it-gate did not drive this red→green, but the code was built inside
> Storytree, so ADR-0395 keeps its unsigned authored baseline at `proposed`.
>
> **The proof — 151 tests.** `verification-decay.test.ts` (110 `it()` across 25 `describe` blocks),
> `decay-attribution.test.ts` (13) and `decision-source-decay.test.ts` (28 flat `test()` calls, no
> `describe` blocks). Each of the six instruments is held on BOTH sides — what it locates AND its
> false-positive guards — and the ceiling, the attribution, the report and the escalation backstop
> each have their own.
>
> *(Counts re-measured 2026-08-31 by `grep -cE "^\s*(it|test)\(" ` and `grep -cE "^\s*describe\("`
> over the three files. The 123 they replace was the same measurement over two of them, taken on the
> same day by inc-23 while the sixth suite was still unbound.)*
>
> **THE HONEST LIMIT, STATED FIRST BECAUSE IT IS THE THING A READER WILL ASSUME OTHERWISE.** This
> suite is **fixture-only**: zero of the 151 cases read the real repo tree, and widening to the sixth
> instrument did not change that — `decision-source-decay.test.ts` contains no `node:fs`,
> `readFileSync`, `createPool`, `PgLibraryStore` or `execFileSync` either. Every case builds its
> inputs from literal factories (`workspace()` `:39-46`, `binding()` `:48-50`, `surface()`
> `:161-164`, `finding()` / `measured()` in `decay-attribution.test.ts:15-33`, and `FROZEN` /
> `MOVED` / `BOGUS_HASH` in `decision-source-decay.test.ts:64-`). So **`pnpm --filter
> @storytree/cli test` reds when the JUDGE breaks, and never when the repo decays.** The command that
> reds on real decay is `pnpm check:verification-decay` — the gate check
> `packages/cli/src/check-verification-decay.ts`, found from its own file and declared `runs: local`
> there (ADR-0606 D1; ADR-0252 D3 keeps it out of CI) — whose gatherer walks `stories/`, every
> workspace `package.json`, every test file, the studio and desktop route tables and
> `git merge-base`. *(It read "`GATE_PLAN` step 9 (`gate-order.ts:228-233`)" until 2026-09-24;
> ADR-0606 D1 replaced that hand-kept plan with discovery.)*
>
> **THAT SPLIT IS WHY THE OUTCOME ABOVE IS A JUDGING OUTCOME, AND THE WORDING IS DELIBERATE.** This
> unit does NOT claim "the repo's verification apparatus is free of decay"; nothing here could red on
> that, and binding such an outcome to this suite would be the rubber stamp ADR-0085 / ADR-0097 §2
> forbid. It claims that each of the six instruments LOCATES and CHARGES correctly — which is a fact
> about this code, and which 151 tests observe directly. Both modules say the same of themselves
> (`verification-decay.ts:59-62`, *"Pure and injectable — every instrument judges FACTS handed to it,
> never disk"*; `decision-source-decay.ts`'s header, *"Pure and browser-safe apart from the parser: no
> filesystem, no store, no clock"*), and every instrument's own contract below is a locating claim,
> never an adjudicating one.
>
> **AND FIXTURE-ONLY IS NOT VACUOUS HERE — the sixth suite is the one that proves it.** Its own header
> records the trap it is built around, the shape this repo hits most: an expectation derived from its
> own subject. Every drift case supplies a span that GENUINELY MOVED (a `FROZEN` declaration, a
> `MOVED` edit of it, and a `BOGUS_HASH` that was never any span's fingerprint) and pairs it with the
> same fixture UNMOVED asserting nothing is reported — the pair is the proof, either half alone is
> not. It also records two reverted blinding probes against the real implementation: deleting the
> `status !== ACCEPTED` guard fails 1 case, and setting the current hash to the anchor's own
> `boundHash` fails 8. That is a measured red, not an assertion that the suite passes.
>
> **AND `pnpm check:verification-decay` COULD NOT SERVE AS THE `proof.command` EVEN THOUGH IT IS THE
> ADR-0057 D3 stage B form increment 3 used for `mirrored-route-conformance`.** Its exit code is
> BRANCH-DEPENDENT by design: `check-verification-decay.ts:1165` sets exit 1 only when a breached
> instrument carries at least one finding THIS BRANCH authored, and exits 0 on an `inherited` breach
> (ADR-0301, `verification-decay.ts:1191`). A proof command whose red depends on who is running it is
> not a stable proof of anything, so the suite is not merely the convenient choice here — it is the
> only honest one.
>
> **No reliability gate `(covers:)` this capability.** [`story.md`](story.md)'s `cli#gate-1` names
> three capabilities and not this one. Its command runs this suite, so the evidence sits inside that
> gate's observation, but the gate does not CLAIM it — and extending an already-signed gate's
> `(covers:)` changes what a signed verdict asserts, which is a deliberate owner edit. Stated gap,
> not a hidden one.

## Guidance

**WHY THIS IS ONE ORGAN AND NOT TWO.** The judge and the attributor could be cut apart, and they are
not, because a finding without its charge is not actionable and the code says so structurally: the
two are MUTUALLY type-dependent (`verification-decay.ts:75` imports `DecayAttribution`/`DecayOwner`;
`decay-attribution.ts:71` imports `DecayFinding`), and `evaluateDecayCeiling` (`:1160-1208`) cannot
reach a verdict without the attribution, because `red` versus `inherited` IS the attribution. Split
them and the attributor is a pure function with one consumer and no outcome of its own. Both
splitting-rule triggers pass for the fused unit: the outcome states in one sentence without a
conjunction (the charge is a property of the finding, not a second job), and the proof shares one
precondition (the instrument's injected facts) and one observable (the finding set and its verdict
level).

**WHY THE SIXTH INSTRUMENT JOINS RATHER THAN FORKING — the call made on 2026-08-31, and the evidence
that decided it.** `decision-source-drift` could have been a capability of its own. The splitting
rule says it is not, because NEITHER of its two triggers fires:

- **The outcome still states in one sentence, with no conjunction.** "Each of the six chartered
  instruments reports the decay it locates as a finding charged to the branch that authored it" is
  the same sentence the five carried, with a different numeral. Nothing about the sixth adds a second
  job to it; the roster's SIZE is not an outcome.
- **The proof shares one precondition and one observable with the other five.** The precondition is
  injected facts — `decision-source-decay.ts` is pure (`no filesystem, no store, no clock`, its own
  header) and its suite hands it `DecisionRow` payloads and file TEXT exactly as
  `verification-decay.test.ts` hands its instruments workspaces and bindings. The observable is the
  same finding set and verdict level, and the sixth's suite does not merely resemble the others' —
  it DRIVES THE SAME MACHINERY, importing `runDecaySweep`, `evaluateDecayCeiling` and
  `CHARTERED_INSTRUMENTS` from `verification-decay.js` and `attributeDecayFindings` from
  `decay-attribution.js`, and asserting its own membership on the chartered roster
  (`decision-source-decay.test.ts:461`, `:469`, `:485`, `:506`). A `DecayFinding` is a `DecayFinding`
  whichever instrument emitted it, and the ceiling that counts it is one object.

**THE ARGUMENT FOR FORKING RESTED ON A FACT THAT TURNED OUT NOT TO HOLD.** inc-23's reason for
excluding the sixth was that it "dials the store" while the five read the repo, so a fixture-only
suite and a store-dialing judge could not be one proof. Read at the file, the judge dials nothing:
`createPool`/`PgLibraryStore` are imported and used only in `check-verification-decay.ts` (`:94`,
`:805-807`), the shared GATHERER, which is excluded from this scope for the five as well under the
rule (6) fence-2 reading below. What genuinely distinguishes the sixth is its SUBJECT — an accepted
decision's anchored code rather than a repo artefact — and a subject is not a proof boundary. Had the
distinction been where inc-23 placed it, the fork would have been right; it is not, so it is not.

**WHAT WOULD REOPEN THE CALL.** If `decision-source-decay.ts` ever acquires its own I/O — a store
connection, a disk read, a clock — it stops sharing this unit's precondition and the second
splitting-rule trigger fires. That is a real and reachable state, not a hedge, which is why the fence
is written down rather than left to be re-derived.

**WHY THIS IS A `cli` CAPABILITY — and the reading of rule (6) that decides it.** This case looks
exactly like the one rule (6) was written for, and applied at face value the rule would REFUSE it.
That is worth setting out, because the resolution turns on a fact about the anchor precedent that had
not been checked before.

Rule (6)'s headline is *"a gate instrument homes to the story whose test surface goes red when THE
THING DRIFTS"*, and increment 3 used it to eliminate `cli` for the mirror-conformance harness on the
ground that the CLI suite *"runs the judge's rules but NEVER SPAWNS A PROBE"*. This suite likewise
never walks the tree. So on the face of it, `cli` is eliminated here too.

**It is not, and the reason is that the anchor precedent does not satisfy that reading either.**
[`organism-boundary-tooling`](organism-boundary-tooling.md) — a pure judge plus a disk-reading check
gatherer in `packages/cli/src`, wired as a gate check the same way (`check:boundaries`), homed to `cli`
precisely because `boundaries.test.ts` reds — was checked on the bytes for this increment:
`boundaries.test.ts` builds *"a miniature world"* of literal fixtures and reads no repo file at all.
Its single `node:fs` occurrence (`:715`) is inside a synthetic module source being fed to
`extractImports`. So if "the thing that drifts" meant the SUBJECT MATTER, rule (6) would retroactively
refuse its own anchor, and `library-health-gate` — four checks over a frozen fixture corpus — with it.

The reading that makes all three precedents true at once is the one ADR-0085 / ADR-0097 §2 actually
state: **the proof must be able to red on WHAT THE OUTCOME ASSERTS.** Increment 3's sentence carries
that already, in a clause easy to skim past — *"it cannot go red when the route table drifts, WHICH IS
THE ENTIRE OUTCOME"*. `mirrored-route-conformance` asserts a fact about the world (two surfaces
agree), so it needed a command that walks the world. `organism-boundary-tooling` and
`library-health-gate` assert facts about a JUDGE, and a fixture suite reds on those. This unit is the
second kind, and its outcome is written to say so rather than to borrow the first kind's authority.

On that reading the placement is unremarkable: three files, all in `packages/cli/src`, no importer
anywhere outside `packages/cli` (checked repo-wide, both import forms), not on the package's public
surface, and riding the CLI's test surface — the criterion `organism-boundary-tooling` was admitted
on.

**WHAT THE OBLIGATION DOES *NOT* DO HERE, recorded because rule (6) fence 3 says it is the selector.**
Fence 3 holds that the observing command eliminates a wrong home while the OBLIGATION picks the right
one — as all three `MIRRORS` rows pointing at the desktop picked `desktop`. That selector **does not
fire here, and it does not point anywhere else either.** The five instruments' repairs land on five
different surfaces owned by five different parties: `contract-binding-drift` on a story spec's proof
block under `stories/**`; `mirror-pair-drift` on a studio probe plus a desktop probe plus a `MIRRORS`
row; `vacuous-proof` on whichever package's test file carries the hidden skip; `warn-list-hygiene` on
a `packages/cli/src/*-drain.ts`; `unproven-seam-default` on a new test for an arbitrary package's
source. No single story is under obligation, so the fence-3 selector is silent — which is not a
refusal, because fence 1 only bars an instrument whose drift NO command observes, and
`pnpm check:verification-decay` observes it. Where the obligation is silent, what remains is rule
(1)'s ordinary reading plus residency, and both point at `cli`.

**THE TWO HOMES THAT WERE CHECKED AND REFUTED.**

1. **`proof-binding-integrity` (arc `verification-integrity-arc`) — the obvious candidate, since this
   organ was built on that arc.** Its outcome is *"A reader inspecting any real machine UAT leg
   receives its exact runnable observe-gate chain, or an explicit refusal"*, and its three
   capabilities are all the evidence-or-refusal contract for machine UAT legs. That does not name or
   plainly cover a chartered decay sweep. Only `contract-binding-drift` is even adjacent, and
   it judges whether a `pnpm --filter` names a live package — not whether a leg has an observe-gate
   chain. Rule (1)'s test fails; sharing an arc is not sharing an outcome.
2. **A new story for verification integrity — not authored, and not this unit's call.** No such story
   exists, and creating one is a structural fork for the owner rather than something an increment
   resolving an ownership declaration should take. Recorded so the option is visibly declined rather
   than overlooked.

**WHAT THIS DOES NOT RE-DERIVE.** [`story.md`](story.md)'s design floor fences the hub against
re-deriving per-domain command surfaces owned by another organism. Nothing is re-derived: no
organism owns "verification decay", and the surfaces the findings land on are the instruments'
SUBJECTS, not their home — the same relationship `check:boundaries` has with the 24 packages it
judges, and the reason the sixth's LIBRARY-tier subject does not re-home it either.
Open modeling call 1 in `story.md` remains the live question about whether CLI-resident judges belong
to the hub at all; this unit enters on the footing `organism-boundary-tooling` already holds under
that unresolved call and does not widen it.

## Integration test

**Goal —** Prove that each of the six chartered instruments returns exactly the findings its charter
describes and no others — the located set AND the false-positive guards — that a finding is charged
to the branch that authored it, that each instrument is held to its OWN ceiling with no fungibility
between them, and that an instrument which sweeps nothing escalates instead of reporting a clean run.

The ceiling, attribution, report and escalation contracts below are written over the sweep as a
whole, so they hold for any registered instrument; the six per-instrument locating contracts (2-7)
are the ones that bound this unit's scope, one per member of `CHARTERED_INSTRUMENTS`.

The integration-flavoured proof is `packages/cli/src/verification-decay.test.ts`,
`packages/cli/src/decay-attribution.test.ts` and `packages/cli/src/decision-source-decay.test.ts`,
all run by the one command `pnpm --filter @storytree/cli test`. Real collaborators where they exist:
the sweep runner drives the real instruments through the real ceiling and the real attributor end to
end (`verification-decay.test.ts:708-766`, `:1290-1406`); the `vacuous-proof` join is asserted against
the REAL `extractVouchingTestNames` from `@storytree/orchestrator` (`:322`, `:336`) rather than a
re-spelling of it — the one place that judge could silently disagree with the classifier it joins
against; and the sixth instrument is driven through the same real `runDecaySweep`,
`evaluateDecayCeiling` and `attributeDecayFindings` (`decision-source-decay.test.ts:461-530`) against
the real `classifySourceDrift`/`hashSpan`, which is the equivalent join for the proof tier.

Facts are injected rather than read, which is the design (`verification-decay.ts:59-62` and
`decision-source-decay.ts`'s header) and the stated limit above; nothing in this scope walks the repo
or opens a connection.

`proposed` (greenfield, observationally tested, without a current signed pass).

## Contracts (10)

The test-proven leaf behaviours — each **one isolated automated test** with collaborators stubbed
(ADR-0002). Every contract here has a REAL passing test (`proven by`).

1. **`every-instrument-locates-and-none-adjudicates`** — the two-phase discipline, asserted per
   instrument rather than left to the module header
   - **asserts —** a located region is reported as a region to LOOK at, never as an established
     defect: `mirror-pair-drift` must not assert the two payloads are REQUIRED to agree;
     `vacuous-proof`'s detail claims no contract is falsely covered; `warn-list-hygiene` states only
     what is mechanical and never that a list is too long or needs a ceiling;
     `unproven-seam-default` never escalates, because locating a default is an obligation to look
     rather than a defect; and the WARN report says all of this in the text the reader gets.
   - **covers —** `packages/cli/src/verification-decay.ts:86-126`, `:128-183`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:190`, `:422`, `:436`, `:567`,
     `:586`, `:743`, `:1052` (REAL, passing)
2. **`contract-binding-drift-flags-a-dead-target-and-nothing-that-merely-looks-dead`** — the
   instrument plus its three guards
   - **asserts —** a `pnpm --filter` naming a package no workspace provides is flagged (it exits 0
     without running, which is a proof that proves nothing), as is a bound path that is missing AND
     outside every workspace package; one finding per unit however many dead targets it names. And
     the guards: a not-yet-authored test file inside a package that EXISTS is silent (a net-new unit
     reads identically to rot, so it must not be flagged), an EXISTING path outside every workspace
     is silent, a live name with a live path is silent, and an empty binding set returns nothing —
     which the caller, not the rule, must treat as vacuous.
   - **covers —** `packages/cli/src/verification-decay.ts:260-304`, `:306-333`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:70`, `:82`, `:91`, `:114`, `:128`,
     `:142`, `:155` (REAL, passing)
3. **`mirror-pair-drift-flags-only-an-unregistered-pair-both-surfaces-serve`** — and never
   re-derives the registry
   - **asserts —** a route BOTH surfaces dispatch that no `MIRRORS` row compares is flagged, naming
     both files so the reader knows where each implementation lives, one finding per route in a
     stable sorted order the ceiling can count. The guards: a route only the REFERENCE serves is
     silent (one implementation cannot drift from itself), a route only the MIRROR serves is silent,
     every REGISTERED pair is silent — the boundary guard, so the instrument never second-guesses
     `MIRRORS` — and two empty route tables return nothing rather than a false clean sweep.
   - **covers —** `packages/cli/src/verification-decay.ts:393-426`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:177`, `:184`, `:201`, `:218`,
     `:227`, `:236`, `:250` (REAL, passing)
4. **`vacuous-proof-reads-the-skip-form-the-repo-s-own-classifier-cannot-see`** — the join is the
   whole instrument
   - **asserts —** the OPTIONS form (`test(name, {skip: cond}, fn)`) is read on `test`/`it`/`describe`
     and the title spelled EXACTLY as ADR-0126's classifier spells it, so the join holds; a test
     skipped that way whose name the classifier calls vouching is located; one finding per FILE
     listing every test, ordered by path. The guards: a literal `skip: false` skips nothing, the
     `.skip` MODIFIER is already VISIBLE to the classifier and is not flagged, an options object on a
     non-test call is ignored, the visible placeholder idiom is not flagged, a vouching test with no
     options skip is not flagged, and an options skip the classifier does not call vouching is not
     flagged.
   - **covers —** `packages/cli/src/verification-decay.ts:508-590`, `:592-616`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:279`, `:293`, `:304`, `:314`,
     `:322`, `:346`, `:360`, `:375`, `:388`, `:401`, `:408`, `:418` (REAL, passing)
5. **`warn-list-hygiene-is-a-three-fact-conjunction-read-from-the-ast`** — an advisory check whose
   warning can never fail
   - **asserts —** the level, the bound and the witnesses are separated as three facts, and a check
     is flagged only when all three coincide: it carries a WARN, its output tracks a collection
     (either a stated count or a line emitted PER ITEM), and no source sets a non-zero exit. It reads
     the RENDERER as well as the entry, because this repo splits advisory checks entrypoint/judge.
     The guards: a check that CAN fail is not flagged (a bounded worklist is the repair), one failing
     via `process.exit(1)` is not flagged, one whose only exit is `process.exit(0)` still IS (that
     bounds nothing), a SINGLE-FACT warn is not flagged (nothing there accumulates), a check with no
     WARN level is not flagged, WARN inside a COMMENT does not set the level, and a loop over
     non-output literals is not a per-item witness.
   - **covers —** `packages/cli/src/verification-decay.ts:693-809`, `:811-838`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:479`, `:491`, `:497`, `:504`,
     `:517`, `:523`, `:528`, `:533`, `:540`, `:545`, `:556`, `:595`, `:602` (REAL, passing)
6. **`unproven-seam-default-needs-a-real-code-reference-not-a-mention`** — the aperture and the
   coverage oracle, which is where this instrument's false positives would come from
   - **asserts —** the aperture matches the nullish-fallback and parameter-default forms, IGNORES a
     scalar default (a number has no unproven behaviour) and a fallback whose symbol is not declared
     in the file, and reads an object seam's members past a fixed window as arms. The oracle is the
     regression surface: a symbol named only in a COMMENT does not count as covered, nor one
     appearing only inside a STRING, while one a test really imports and calls does; and a prose
     apostrophe does not swallow the code that follows it. One finding per SYMBOL, arms that ARE
     tested omitted so a partial drain is visible, ordered by path then symbol.
   - **covers —** `packages/cli/src/verification-decay.ts:982-991`, `:993-1025`, `:1027-1053`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:980`, `:992`, `:1003`, `:1013`,
     `:1025`, `:1034`, `:1062`, `:1081`, `:1088`, `:1095`, `:1104`, `:1114`, `:1126`, `:1144`,
     `:1149` (REAL, passing)
7. **`decision-source-drift-locates-a-moved-anchor-and-never-adjudicates-the-claim`** — the sixth
   member (ADR-0424 D5), whose subject is the decision log rather than the repo's own source
   - **asserts —** for every `accepted` decision carrying a bound anchor,
     `findDecisionSourceDrift` emits one finding per anchor identity whose current span no longer
     matches its frozen `boundHash` — composing the existing `classifySourceDrift` and `hashSpan`
     rather than re-deriving either — with a `DecayFinding.id` stable run to run so the shared
     ceiling counts one thing and not a moving target, and two claims resting on ONE span collapse
     to ONE finding rather than two. Each finding says the anchored code MOVED and never that the
     decision is now false. The guards are the whole aperture: a `superseded` or `proposed` decision
     is excluded (ADR-0424 D3/D8); a decision carrying NO anchors yields no finding, no note and no
     denominator (ADR-0424 D4); an anchor DECLARED but never frozen (`findDeclaredUnfrozenSources`)
     and a REFUTED anchor (`findRefutedSources`) are each their own visible category rather than a
     finding, and a refuted anchor carrying a stale hash is still never swept; an ambiguous quote is
     refused rather than guessed; a missing FILE is reported rather than folded into "nothing
     changed"; a missing SYMBOL does not widen to the whole file and answer a different question; a
     malformed row does not take the sweep down; and `measureDecisionSweep` reports the APERTURE at
     zero as well as above it, with no grounded-share denominator derivable from its output. An
     unreachable decision log ESCALATES through the shared backstop rather than banking a clean sweep.
   - **covers —** `packages/cli/src/decision-source-decay.ts:424-517`, `:542-558`, `:581-599`,
     `:609-637`
   - **proven by —** `packages/cli/src/decision-source-decay.test.ts:121`, `:141`, `:151`, `:163`,
     `:182`, `:199`, `:219`, `:257`, `:277`, `:290`, `:306`, `:313`, `:353`, `:364`, `:408`, `:418`,
     `:428`, `:461`, `:469`, `:506` (REAL, passing)
8. **`the-ceiling-is-per-instrument-and-backlogs-are-not-fungible`** — the property that stops one
   easy drain from buying budget for a hard one
   - **asserts —** each instrument is held to its OWN ceiling and only the one that GREW reds;
     repairing one instrument's signal buys NO budget for another; a clean instrument still reports
     its tally, so 0/n is visible rather than absent; the baseline is OK at exactly the ceiling and
     reds the moment the backlog grows past it; a finding from an UNDECLARED instrument is held to
     zero, so unattributed backlog fails closed; a NEW instrument's honest baseline does not red the
     gate; and the RED report names the breached instrument and says another's repair cannot clear
     it.
   - **covers —** `packages/cli/src/verification-decay.ts:1160-1208`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:615`, `:619`, `:625`, `:630`,
     `:642`, `:655`, `:672`, `:688`, `:694` (REAL, passing)
9. **`an-inherited-breach-does-not-block-the-landing-and-a-failed-attribution-is-never-silent`** —
   ADR-0301, and the fail-closed behaviour around it
   - **asserts —** a breach resting entirely on files identical to the merge base is `inherited`, not
     red; ONE authored signal in an over-ceiling backlog REDS; below the ceiling stays OK however the
     signals are attributed; with NO attribution supplied the pre-ADR-0301 behaviour is reproduced
     exactly (charged, red); a finding the attributor never classified is CHARGED rather than
     defaulted to inherited; each instrument's authorship is scored SEPARATELY so an inherited breach
     cannot absorb an authored one; and an attributor that THROWS degrades to charging everything
     rather than taking the sweep down. The report half is part of the contract: it names a
     pre-existing breach as its own outcome and says the landing is not blocked, prints every NOT
     YOURS signal IN FULL rather than a count, splits YOURS from NOT YOURS on a mixed breach, and
     says so LOUDLY when attribution could not be measured — so a charge is never mistaken for a
     verdict.
   - **covers —** `packages/cli/src/decay-attribution.ts:135-144`, `:146-181`,
     `packages/cli/src/verification-decay.ts:1223-1358`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:1197`, `:1215`, `:1229`, `:1245`,
     `:1253`, `:1269`, `:1312`, `:1328`, `:1339`, `:1359`, `:1379` (REAL, passing);
     `packages/cli/src/decay-attribution.test.ts` (13 tests, REAL, passing)
10. **`an-instrument-that-swept-nothing-escalates-instead-of-reporting-clean`** — the backstop that
   stops the whole mechanism from failing silently open
   - **asserts —** a loader that enumerated NOTHING is a BLIND instrument and escalates rather than
     banking a clean sweep, carrying the empty enumeration's own message so the report says WHAT went
     blind; a THROWING instrument is fenced to itself as a finding, because a sweep that stops
     sweeping proves nothing; an escalation fails the gate that a green backlog would otherwise pass,
     CANNOT be cleared by raising the ceiling, is not merely the ceiling renamed (a ceiling RED
     carries no escalation), and still fails even when every signal is inherited. The guards: observing
     facts and finding nothing wrong stays green, any non-zero enumeration however small does not
     throw, and an ordinary located signal NEVER escalates. Chartered coverage is machine-checked —
     an unswept chartered instrument is named on a clean run rather than left as a source comment.
   - **covers —** `packages/cli/src/verification-decay.ts:185-201`, `:1360-1407`
   - **proven by —** `packages/cli/src/verification-decay.test.ts:716`, `:790`, `:807`, `:816`,
     `:827`, `:837`, `:847`, `:856`, `:872`, `:894`, `:906`, `:921`, `:931`, `:944`, `:951`
     (REAL, passing)
