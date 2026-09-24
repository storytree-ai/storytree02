---
id: "mirrored-route-conformance"
tier: capability
story: desktop
title: "Mirrored route conformance — every `/api/*` payload the desktop re-composes is proven equal to the studio's, or the divergence is named"
outcome: "Every `/api/*` payload the desktop re-composes is proven equal to the studio's reference payload."
status: proposed
proof_mode: integration-test
depends_on: [local-backend-boot, boot-read-routes]
decisions: [251, 176, 100, 252, 249, 57]
# A greenfield capability registered retrospectively by capability-layer-coverage-arc increment 3
# (2026-08-07). Implementation-before-registration and a standing gate do not make it brownfield
# (ADR-0395). The `proof:` block is spec-borne (ADR-0057);
# there is deliberately NO `real:` arm, and here that omission is load-bearing TWICE over:
#   1. This classification correction does not add a `real:` arm or manufacture a red/verdict
#      (ADR-0159); adding one would also move the pinned
#      REAL-buildable snapshot in `packages/cli/src/node-build.test.ts`.
#   2. `readUnitSourceFiles` (packages/cli/src/check-boundaries.ts:210-234) reads ONLY `real.sourceFile`
#      + literal `real.scope.sourceGlobs` and `continue`s on an absent `real` (`:226`). So this unit
#      contributes nothing to `unitSourceFiles`, and neither the ADR-0192 landlord rule nor the
#      packages-forward refusal fires over the two foreign buildings this organ spans. (Belt and
#      braces: `desktop` is ALREADY in repo-manifest/hosted-stories/_domain.json's
#      `hostedStories.register` for
#      `apps/studio`. It is NOT registered for `packages/cli` — which costs nothing while there is no
#      `real:` arm, and is the thing to check first if one is ever added.)
# SINGLE-COMMAND PROOF, and the choice is deliberate — see "The proof command" in Guidance. The
# command runs the root `check:mirror-conformance` script, which invokes
# `packages/cli/src/check-mirror-conformance.ts` in exactly the form the gate builds for that found
# check (`checkInvocation`, `packages/cli/src/gate-checks.ts`), so the capability's proof and the gate
# step run one file the same way. Nothing pins the root script to that form: if the two ever differ,
# the FILE is the check (ADR-0606 D1). (This read "spelled EXACTLY as
# `packages/cli/src/gate-order.ts:176` spells it" until 2026-09-24, when ADR-0606 D1 replaced that
# hand-kept plan with discovery.)
proof:
  command:
    file: pnpm
    args: ["check:mirror-conformance"]
  scope:
    testGlobs:
      - "packages/cli/src/mirror-conformance.test.ts"
    sourceGlobs:
      - "packages/cli/src/mirror-conformance.ts"
      - "packages/cli/src/check-mirror-conformance.ts"
      - "apps/studio/server/*MirrorProbe.ts"
      - "apps/desktop/src/backend/*-mirror-probe.ts"
---

# Mirrored route conformance — every `/api/*` payload the desktop re-composes is proven equal to the studio's

**Outcome —** Every `/api/*` payload the desktop re-composes is proven equal to the studio's reference
payload.

*(Two clauses were demoted out of the outcome to avoid a banned conjunction, and each lives where it is
proven. The FAIL-CLOSED, NEVER-VACUOUS rule — a probe that dies, prints unparseable output, or returns
an empty payload for a non-empty input is a failure rather than a skip, because two silent surfaces
agree perfectly — is the gather half, recorded under **The stated gap** below. And the SELF-PRUNING
ALLOWLIST — the one place a deliberate difference may be declared, which goes red the moment it stops
being true — is contract 5.)*

**Depends on —** [`local-backend-boot`](local-backend-boot.md),
[`boot-read-routes`](boot-read-routes.md). Both edges are real code edges, read off the imports:
`arcs-mirror-probe.ts:45` and `activity-mirror-probe.ts:43` import `createLocalBackend` from
`./local-backend.js`, and `docs-mirror-probe.ts:21` imports `listDocs` from `./boot-read-routes.js`.
The desktop half of this harness cannot produce a payload at all until those two routes exist — which
is the dependency test in both directions: neither of them needs anything from this unit.

> **Proof status (honest) — `proposed` (greenfield without a current signed pass; NOT `healthy`).**
> The outcome is proven by a STANDING GATE, not by a package suite, and the distinction is the whole
> reason this capability's `proof.command` is not a `--filter … test` like its two sibling retrospective
> units.
>
> **The outcome half — `pnpm check:mirror-conformance`.** A gate check found from its own file,
> `packages/cli/src/check-mirror-conformance.ts`, whose `/* gate-check` declaration places it `both`
> and in the own-work block and classifies it **PROOF INTEGRITY** rather than factory bookkeeping
> (its survival-audit line, beside the code it describes — ADR-0606 D1). ⚠ This paragraph once
> counted the gate's steps and how many carried each class; those counts are struck rather than
> restated, because the plan is now found rather than listed and grows whenever a check file lands —
> `pnpm gate --list` prints it. It spawns every registered pair's two probes in their own
> processes over one shared fixture set and compares the real decoded payloads. ⚠ The counts in this
> region are DELIBERATELY not spelled out any more: the registry has grown from four rows to nine
> since this was written, and each restated total was stale within an increment. Ask
> `packages/cli/src/mirror-conformance.ts`'s `MIRRORS`, which is the only place the number lives.
> ⚠ Since ADR-0496 D1 this rung has a SIBLING, `check:mirror-conformance-live`, which runs the same
> instrument's `/api/activity` row over a snapshot of the real ledger and therefore holds a live-store
> credential. Since 2026-09-24 that sibling is its OWN FILE,
> `packages/cli/src/check-mirror-conformance-live.ts` — one file is one found check (ADR-0606 D1) —
> and `check-mirror-conformance.ts` REFUSES `--arm live` rather than answering it with the fixtures,
> so the fixtures arm's imports no longer reach the store at all. Everything below describes the
> DB-free arm unless it says otherwise. That is a genuine integration proof
> against real in-story collaborators — the desktop's own `/api/*` dispatcher and route handlers, run
> for real — not a unit test over doubles. It has a recorded catch: its own declaration cites commit
> `3ef84c96`, a studio-only docs change that produced 256+4 divergences.
>
> **The rules half — `packages/cli/src/mirror-conformance.test.ts`, 32 tests.** Part of the
> `@storytree/cli` suite. It covers every divergence kind the judge can report, which is what makes
> the gate's PASS meaningful: a judge that could not detect a drift would pass forever. These are the
> contracts below.
>
> The standing gate is evidence, but neither it nor the absence of a gate-driven red→green establishes
> brownfield provenance (ADR-0395).
>
> **The stated gap that matters most — the proof command runs the gate, NOT the judge's suite, and the
> two are disjoint.** `pnpm check:mirror-conformance` exercises the judge only on a corpus that
> currently CONFORMS, so it walks the pass path and never once constructs a divergence. Every
> divergence-reporting branch — the census formatter, the order rule, the self-pruning allowlist, both
> projections' throw paths — is proven ONLY by `mirror-conformance.test.ts`, which
> `pnpm --filter @storytree/cli test` runs and this capability's `proof.command` does not. A single
> `ShellCommand` (`{file, args}`, `proof-config.ts:205-211`) cannot chain two scripts, and pnpm has no
> multi-script form to match the multi-`--filter` trick
> [`post-build-curation-pass`](../drive-machinery/post-build-curation-pass.md) uses, so this is a real
> gap rather than an authoring preference. It is recorded here, not implied. Note the judge's suite IS
> already observed elsewhere — `cli#gate-1` observes the whole `packages/cli` suite — so the coverage
> exists; what this capability cannot do is name both in one command.
>
> **The other un-asserted pocket, named rather than implied.** The GATHER — `runProbe`'s spawn,
> `decodePayload`, and the fail-closed `ProbeError` paths in
> `packages/cli/src/check-mirror-conformance.ts:529-604` — has no offline assertion. It is exercised
> on every gate run (two spawns per registered row) but only on the success path; no test drives a
> probe that dies, prints garbage, or returns an empty payload for a non-empty input. The
> never-vacuous rule at `:632-642` is therefore DESIGNED and RUN but not ASSERTED. This is the same
> pure-core / real-effects-wiring shape [`pinned-runtime-apply`](pinned-runtime-apply.md) records for
> its four git readers.
>
> **No reliability gate `(covers:)` this capability.** The story's existing gate-1 names
> `credential-broker` only. Extending an already-signed gate's `(covers:)` list changes what a signed
> verdict claims, so it is a deliberate, id-aware edit for the owner — a stated gap, not a hidden one.

## Guidance

**WHY THIS IS ONE ORGAN AND NOT THREE** (the splitting-rule, ADR-0010 — the fork was live, and it is
the reason this unit was routed to a story-author at all). The tempting cut is per-surface: a `cli`
judge, a `studio` probe set, a `desktop` probe set — which is exactly how the three
`repo-manifest.json` declarations that preceded this file were shaped. It is the wrong cut, on three
independent grounds:

- **The proof is indivisible, so two of the three pieces could not state one.** `pnpm
  check:mirror-conformance` cannot run half. A probe on its own has no assertion, no test file and no
  observable — it prints JSON to stdout and exits. Under the arc's own rule that a capability which
  cannot state its proof must not be authored, a per-surface split does not produce three weak
  capabilities; it produces one capability and two units that are illegal to author.
- **Neither half is independently viable.** Delete the probes and the judge has no input, and
  recovering one would require importing across the ADR-0176 wall — the thing the design exists to
  avoid. Delete the judge and every probe prints into the void. Delete the driver and neither ever
  meets the other. That is the organ test.
- **Both triggers of the splitting-rule pass for the fused unit.** Its outcome states in one sentence
  without a conjunction (above), and its proof shares one precondition (one shared fixture set, built
  once and handed to both sides — `check-mirror-conformance.ts:499-524`) and one observable (the
  divergence list).

**A PROBE IS NOT GLUE, AND THAT IS WHAT SEPARATES THIS FROM `check:boundaries`.** The nearest
structural twin in the corpus is
[`organism-boundary-tooling`](../cli/organism-boundary-tooling.md) — a pure judge (`boundaries.ts`)
plus a check driver (`check-boundaries.ts`), both in `packages/cli/src`, and, like this rung, a gate
check the gate finds from its own file, in the same own-work block. That capability deliberately
EXCLUDES its gatherer: *"the disk I/O is the
gatherer's … that non-leaf I/O glue is NOT this capability's provable surface."* The same exclusion
must not be copied here, and the difference is precise. `check-boundaries.ts` collects facts that
exist anyway — the package graph is there whether or not anything reads it. A mirror probe collects
nothing; it MANUFACTURES an observability that does not otherwise exist, because the only other way
to see the desktop's payload from a third party is to import across a wall ADR-0176 forbids.
`check-mirror-conformance.ts:9-15` says it in its own words: *the harness encodes the boundary rather
than punching through it.* The probes are constitutive of the instrument, so they are in the organ.

**WHY THIS IS A `desktop` CAPABILITY** (placement, story-author call — routed here as a structural
fork, and settled against four candidates rather than two).

1. **The obligation is the desktop's.** All four registry rows are `reference: "studio", mirror:
   "desktop"` (`mirror-conformance.ts:125-277`). The studio is the fixed point; the hand-written copy
   that must track it is this surface's. The outcome above is a claim about the MIRROR conforming,
   and this story owns the mirror.
2. **ADR-0251's Context is this story's defect.** Commit `71f68d2b` folded `parseAdrWireSignals` into
   the studio's `listDocs` and left the desktop copy alone; over the real `docs/` tree that silently
   dropped `loadBearing` from 88 ADRs and `references` from 168.
3. **It is a real precondition of THIS story's journey, not a factory concern parked here.** The
   desktop serves the SAME compiled studio bundle (ADR-0090 d.4) over a route table it re-composes.
   A drifted `/api/docs` therefore renders the member a silently degraded forest — and
   [`boot-read-routes`](boot-read-routes.md)'s outcome, *"so the frontend boots and renders the forest
   instead of an access/error screen"*, is honest only while the copy conforms. This is the same move
   [`pinned-runtime-apply`](pinned-runtime-apply.md) records for `--ff-only`: a rail that was
   aspirational until something enforced it.
4. **This story already CARRIES the commitment; the proof of a commitment belongs with it.** The
   *"Local-backend boundary call"* section of [`story.md`](story.md) is where re-compose-don't-import
   was decided. Nothing else in the corpus asserts that the re-composition stayed faithful.

   **And the four rejected homes, with the reason each fails:**

   - **`cli` — the closest call, and the one the routing brief leaned away from for a reason I want to
     correct in passing.** The brief's precedent list (a `packages/cli` gate instrument homes to the
     story owning the CHECKED THING) is genuinely MIXED, not uniform: `check-process-graph.ts` →
     `library-health-gate` (`library`) and `check-web-grounding.ts` → `website` point that way, but
     `*boundaries*.ts` → `organism-boundary-tooling` is a **`cli`** capability and points the other
     way. So "gate instruments never home to `cli`" is not a rule that can carry the decision.
     What decides it is that precedent's OWN stated criterion — `organism-boundary-tooling` is homed
     to `cli` because *"it rides the CLI's test surface, `boundaries.test.ts`"*. This organ fails that
     criterion at the only point that matters: `pnpm --filter @storytree/cli test` runs the judge's
     rules but never spawns a probe, and so **cannot go red when the desktop drifts**. Binding this
     outcome to the CLI suite would be the rubber-stamp ADR-0097 §2 forbids — the same objection
     [`cli`'s own story.md](../cli/story.md) raises when it refuses to bind its UAT leg 4 to
     `cli#gate-1` (*"that gate's command … does not exercise the live `--pg` path at all"*). `cli`'s
     design floor also holds it to *"thin shim, business logic upstream"*, and this judge is domain
     logic about two other surfaces, reached by no verb.
   - **`ci-cd` — checked, because the routing brief did not list it, and it is the obvious home for a
     gate step.** It is not the home. Nothing there already covers this:
     [`green-gate`](../ci-cd/green-gate.md) contracts that every step `verify` runs is BLOCKING
     (`every-step-is-required`) and that the job proves the merge ref — properties of the JOB, held
     over whatever steps it runs. `verify` does in fact run this check and `check:boundaries`, but
     being run by the job is not being OWNED by it: `green-gate` deliberately contracts no
     membership and asserts nothing about what any individual check judges. More decisively, ci-cd's
     capabilities own the PIPELINE (the workflow jobs,
     the automerge rail, the deploy dispatch) plus the repo-hygiene gates that have no other owner
     (`adr*` → `adr-health-gate`). "It is a gate step" is
     true of every gate step, so it discriminates nothing — homing this there makes ci-cd a bucket,
     which is precisely what a capability-is-an-organ rule refuses. ci-cd is also deliberately
     zero-inbound and owns no `apps/` building.
   - **`studio`** — the reference, not the obligated party; its outcome (an operator reviews the
     project record through one browsable forum studio) is untouched by whether the desktop's copy
     conforms. The studio probes' import of `./apiRouter.js` is a call site into studio code, which is
     hosting rather than ownership — exactly the distinction ADR-0192's landlord rule draws, and
     `desktop` is already grandfather-registered for `apps/studio`.
   - **`proof-binding-integrity`** — the only other story on `verification-integrity-arc`, and a
     different journey (whether a machine UAT leg exposes its observe-gate chain). Confirmed by
     reading it, not assumed.

**THE PROOF COMMAND — why a bare check script rather than a package-test filter, and why that is a
GRANTED form rather than an unforbidden one.** ADR-0057 Decision 3 stage B names the sanctioned
proof-command vocabulary outright: a node declares its proof command — *"`pnpm --filter x test`,
vitest, **a `check:*` gate**, a shell test"* — plus scope. A `check:*` gate is therefore an
EXPLICITLY GRANTED form, and this command rests on that grant rather than on an argument from
silence. The schema then agrees rather than deciding: `proof.command` is a `ShellCommandSchema` —
`{file, args, cwd?}`, `.strict()` (`packages/orchestrator/src/proof-config.ts:205-211`) — carrying no
constraint that narrows the granted vocabulary back down to a test runner.

It is nonetheless novel IN PRACTICE, which is a claim about this corpus and not about the decision: of
the 190 spec-borne `proof.command` blocks, 189 are `pnpm --filter <pkg> test` and this is the only
`check:*` — the two sibling retrospectively registered units in this story among them.
Novel in practice is not novel in decision. The form was sanctioned when ADR-0057 staged the
proof-mode vocabulary beyond `node:test`; it had simply not yet been reached for, because until this
unit no outcome needed a standing gate to prove it.

The scope globs were checked against the ADR-0087 structural bound (`scopeGlobBoundIssue`,
`:243-264`): each is repo-relative, rooted at `packages/` or `apps/`, and names ONE concrete unit in
its second segment, so a three-unit scope is in bounds because the bound is per-glob, not per-spec.
The command is the honest one because it is the only one that runs the outcome; the cost of choosing
it is the disjointness recorded under **The stated gap** above.

**WHY THE ALLOWLIST IS EMPTY ON ALL FOUR ROWS, AND WHY THAT IS NOT A MISSING FEATURE.** Every
`referenceOnlyFields` is `[]` by design, and each row says why in its own comment: every payload here
is served to the SAME compiled renderer from either surface, so a difference is a defect rather than
a deliberate narrowing. The allowlist is the escape hatch, and it is self-pruning (contract 5) — an
entry the mirror actually emits, or one the reference never emits, is itself a divergence — so it can
only ever describe a difference that is still real. An allowlist nobody prunes decays into a blanket
exemption.

**WHAT THE HARNESS DOES NOT COVER, per row, because a fence whose reach is assumed is worse than one
whose reach is written down.** The registry's own comments state these and they are not restated in
full here, but the shape matters for anyone extending it: `/api/activity` proves the two FOLDS agree
over raw `events.node_claim` rows, and cannot see a column leaving a SELECT upstream of the fold
(that half is fenced inside the desktop instead, by deriving `IN_FLIGHT_CLAIMS_SQL` from
`CLAIM_ROW_COLUMNS`); its `builds` layer rides the fixture already folded because the desktop's fold
is inline in a `pg` closure that would require THAT SURFACE to open a connection, which ADR-0117
d.1/d.5 forbids. ⚠ That reason used to read "this DB-free gate cannot reach", and the gate's
DB-freedom was never the binding constraint — it was placement, not necessity (ADR-0495 /
ADR-0496 D1). `check:mirror-conformance-live` now folds this row over the REAL `events.node_claim`
ledger, snapshotted by the HARNESS and handed to both probes as one fixture, so `builds` is still
uncovered while the claim fold is exercised against rows nobody chose. `/api/arcs` proves the ENVELOPE — the
method guard, the two no-store answers, the unknown-id answer, the id decode, the `{ arcs }` key —
because the join itself is shared `@storytree/drive` code with no drift class.

`/api/floor-health` proves the ENVELOPE for the same reason and with one extra arm. The READING
carries no re-composition risk at all: `loadFloorHealthReading`
(`packages/drive/src/factory-health-read.ts`) is shared `@storytree/drive` code that BOTH surfaces
call and that `storytree factory health` also prints, so drive's own suites own the figure. What is
hand-copied — and therefore what this row watches — is the method guard AND ITS STATED REASON
(ADR-0316 D4's 405), the "no document store" answer, and the `{ reading }` key itself. It carries
THREE arms rather than two because `quiet` (a real store whose reinforcements are all PRE-route, so
the reading arrives with no `loudest`) and `no-store` (`{ reading: null }`) are the advisory-absence
PAIR: they are the only thing that catches a mirror answering a quiet reading where its reference
answers `null`, and `apps/studio/src/lib/floorHealth.ts` renders "no instrument here" and "all clear"
differently on purpose. Its LIMITATION is worth stating in the same register: the fixture's docs and
events are served VERBATIM by each probe's own store rather than recorded through one, because the
`Store` seam's `appendEvent` accepts no `at`. That is what makes the comparison deterministic across
two processes — but it also means this row, like the `/api/activity` row, cannot see a defect
UPSTREAM of the reads (a mirror whose own store wiring returned the wrong rows), only one in how each
surface wraps them. One thing it explicitly does NOT assert, and that is not a gap: the loud/quiet
threshold (`LOUD_AT_RECURRENCES` in `apps/studio/src/components/FloorHealthLamp.tsx`). That is
frontend, one compiled bundle served by both surfaces, so it has no drift class and no place in a
server-payload comparison.

## Integration test

**Goal —** Prove that the desktop's hand-written copy of each mirrored `/api/*` payload still serves
what the studio serves — the same entries, in the same order, with the same field values — over inputs
neither surface chose, without either surface importing the other.

The integration-flavoured proof is the STANDING GATE, and it is real: `pnpm check:mirror-conformance`
runs on every `pnpm gate` and in CI's `verify` job as a ROOT step, deliberately outside the ADR-0195
affected-only narrowing (`check-mirror-conformance.ts:1-8` — drift here is introduced by editing
EITHER surface, so a filter that ran only the edited one's suite would fence half the class).

Real collaborators, no stub between them. For each of the four registry rows it spawns the
reference probe and the mirror probe in their own processes (`runProbe`, `:569-604`), each in its own
app dir so bare specifiers resolve through that app, and each driving its OWN surface's real route
code — `listDocs` for docs, the real `/api/activity` handler over each surface's own re-composed fold
for activity, and the real `handleApiRequest` / `createLocalBackend` dispatcher including its central
error mapping for arcs and for floor-health, so status codes are inside the assertion rather than
re-implemented beside it. The two decoded payloads are then compared by a third party that imported
neither (`compareMirrors`). Nine inputs across four sets: a synthetic docs fixture exercising branches
the real corpus may not contain, the repo's REAL `docs/` tree, two activity fixtures carrying raw claim
rows and a fixed `now` (a populated arm and an advisory-absence arm), two arc fixture directories
(a populated arm and a no-store arm), and three floor-health fixture files — a populated arm, a QUIET
arm (a real store whose reinforcements are all pre-route, so the reading arrives with no `loudest`)
and a no-store arm, the last two being the advisory-absence PAIR. The comparison is equality between
two implementations over one input rather than against a recorded value, so corpus content cannot
destabilise it.

Underneath, the judge's 32 tests cover every divergence kind it can report — which is what makes the
gate's PASS mean something. The authored rung remains `proposed` until current signed proof exists.
The gather
half and the never-vacuous rule are exercised on every run but not asserted offline — the stated gap
recorded above, not claimed here.

## Contracts (11)

The test-proven leaf behaviours — each **one isolated automated test** with collaborators stubbed
(ADR-0002). Every contract here has a REAL passing test (`proven by`). All are in the judge's suite,
`packages/cli/src/mirror-conformance.test.ts`, which the `proof.command` above does NOT run — see
**The stated gap**.

1. **`identical-payloads-are-conformant`** — the baseline that keeps a green from being an artifact of the comparison
   - **asserts —** two identical payloads yield NO divergences; two EMPTY payloads are likewise conformant, and an empty allowlist adds no rule of its own.
   - **covers —** `packages/cli/src/mirror-conformance.ts:543-614`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:38` and `:138` (REAL, passing)
2. **`a-dropped-or-differing-field-is-a-divergence`** — the `71f68d2b` class, reported per field BY NAME
   - **asserts —** a field the mirror silently drops is a divergence naming the entry and the field; a value the mirror computes differently is a divergence; and an ABSENT key is distinguished from an explicit undefined-ish value, so `(absent)` and `null` can never be conflated into a false agreement.
   - **covers —** `packages/cli/src/mirror-conformance.ts:576-587,524-526`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:43`, `:62`, `:74` (REAL, passing)
3. **`a-missing-or-extra-entry-is-reported`** — an entry-set difference is structural and is reported first
   - **asserts —** an entry the reference emits that the mirror does not is a `missing-entry`, and one the mirror emits that the reference does not is an `extra-entry`; each names its key.
   - **covers —** `packages/cli/src/mirror-conformance.ts:552-560`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:85` (REAL, passing)
4. **`order-is-payload-and-is-judged-only-on-an-agreed-entry-set`** — the array is ordered payload, and a shift is reported once
   - **asserts —** a differing sort order over the same entries IS a divergence (a client rendering the array in order would show a different list); but order is NOT compared while the entry sets disagree, so a single missing entry cannot report a spurious shift at every position after it.
   - **covers —** `packages/cli/src/mirror-conformance.ts:565-574`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:96` and `:106` (REAL, passing)
5. **`the-allowlist-is-self-pruning`** — the one place a deliberate difference may be declared, and it cannot rot into a blanket exemption
   - **asserts —** an allowlisted reference-only field is exempted from the field comparison; but an entry the MIRROR in fact emits is reported stale (*the difference is no longer reference-only*), and an entry the REFERENCE never emits is reported stale (*nothing left to exempt*). Either half going false is a loud failure rather than a silently widening exemption.
   - **covers —** `packages/cli/src/mirror-conformance.ts:593-611`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:112`, `:118`, `:129` (REAL, passing)
6. **`the-registry-exposes-its-routes-as-data`** — the second reader never scrapes a route out of prose
   - **asserts —** `registeredMirrorRoutes` derives the covered route set from the registry itself, so `check:verification-decay`'s `mirror-pair-drift` instrument reads what is registered rather than keeping a second list in step. Two hand-kept lists of one fact drifting apart is the exact class this file exists to fence, and a prose-scraping heuristic would be that class arriving inside its own instrument.
   - **covers —** `packages/cli/src/mirror-conformance.ts:283-287`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:142` (REAL, passing)
7. **`the-activity-projection-keeps-an-omitted-layer-apart-from-an-empty-one`** — the `departures` class and the ADR-0200 `grade` class
   - **asserts —** the projection emits one `layer:<name>` marker per key PLUS one entry per row; a layer the mirror omits ENTIRELY diverges even at zero rows (rows alone cannot catch it — an omitted layer and an empty layer both contribute zero rows and would agree); a field a row drops is reported per row by name, which names the `grade` defect exactly; `null` and `[]` are distinguished, so the advisory-absence promise cannot be swapped for an empty array; and a row carrying its own `_key` cannot displace the synthetic one and collapse two entries into one.
   - **covers —** `packages/cli/src/mirror-conformance.ts:344-370`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:177`, `:194`, `:207`, `:222`, `:233` (REAL, passing)
8. **`the-arcs-projection-compares-status-alongside-body`** — most of this envelope is expressed as a code, not as a field
   - **asserts —** the projection emits a `response:<label>` marker per replayed request carrying the STATUS, the body's shape and its top-level key set, plus one entry per arc; a status that diverges is a divergence (a projection over bodies alone would compare three error objects and never notice one surface returning them under different codes); `{ arcs: null }` and `{ arcs: [] }` are distinguished, because *no store* is not *no arcs* and the compiled arc lens renders those differently; an envelope key the mirror drops is a divergence even when every shared field agrees; and an arc the mirror drops is reported BY ID rather than as an order shift.
   - **covers —** `packages/cli/src/mirror-conformance.ts:396-443`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:258`, `:283`, `:295`, `:308`, `:323` (REAL, passing)
9. **`an-undecodable-payload-throws-rather-than-projecting-empty`** — fail-closed at the projection, because an empty projection would agree with anything
   - **asserts —** a payload that is not a JSON object is a THROW from ALL THREE projections, never a silently empty entry list. The caller converts it to a `ProbeError` and thus a conformance FAILURE, so a probe that returned garbage can never read as a pass.
   - **covers —** `packages/cli/src/mirror-conformance.ts:345-347,397-399,473-477`
   - **proven by —** `packages/cli/src/mirror-conformance.test.ts:238`, `:331`, `:474` (REAL, passing)
10. **`the-failure-report-censuses-by-field-and-elides`** — a 168-instance drift reads as ONE fact, not 168 lines
    - **asserts —** the report leads with a per-field census ordered by count, then lists at most `REPORT_LIMIT` lines and states how many more were elided — so an operator facing the `71f68d2b`-shaped failure is shown *which field* drifted rather than a wall of per-entry lines.
    - **covers —** `packages/cli/src/mirror-conformance.ts:639-663`
    - **proven by —** `packages/cli/src/mirror-conformance.test.ts:482` (REAL, passing)
11. **`the-floor-health-projection-keeps-a-quiet-floor-apart-from-no-instrument`** — the advisory-absence pair, and the reason this row carries three arms rather than two
    - **asserts —** the projection emits a `response:<label>` marker per replayed request carrying the STATUS, the body's shape and its top-level key set, a `<label>:reading` marker carrying the reading's own shape and key set, plus the reading's fields compared BY NAME; a QUIET reading (present, but with no `loudest`) and `{ reading: null }` (*this backend has no document store*) are DISTINGUISHED — the load-bearing one, because `apps/studio/src/lib/floorHealth.ts` renders "no instrument here" and "all clear" differently on purpose, so a mirror that collapsed one into the other would drive the SAME compiled band into reporting all-clear for a floor it never measured; a status that diverges is a divergence, so ADR-0316 D4's 405 cannot silently become a generic 404; a reading key the mirror drops is a divergence even when every shared field agrees; and a reading carrying its own `_key` cannot displace the synthetic one.
    - **covers —** `packages/cli/src/mirror-conformance.ts:472-521`
    - **proven by —** `packages/cli/src/mirror-conformance.test.ts:362`, `:388`, `:410`, `:429`, `:445`, `:463` (REAL, passing)
