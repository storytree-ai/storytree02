---
id: "model-judged-uat"
tier: story
title: "An eligible model judge returns structured PASS/FAIL/INCONCLUSIVE — the spine validates, escalates, and signs"
outcome: "An independent fresh read-only model judge returns structured PASS, FAIL, or INCONCLUSIVE for a model-witness criterion; the spine validates shape, eligibility, tier, clean detail-hash anchor, and evidence, then either signs or escalates by the declared ladder — never laundering a FAIL into human green."
# RETIRED 2026-08-20 — ADR-0247 D5 names this story on its retirement worklist by id. The thing it
# exists to build is gone: ADR-0247 D1 retired the independent rubric-bound model JUDGE, its eligibility
# registry and its escalation ladder outright, and ADR-0295 settled the same question the other way —
# the model that DROVE a journey may witness it, yielding a `machine` outcome, "reviving NO ADR-0209
# rubric-judge machinery". Body kept as history (the spawn-visibility / chat-drive-bridge precedent);
# the four capability files flip to `status: retired` with it.
# `packages/model-judged-uat` is NOT deleted here. ADR-0247 D5 lists the package retirement separately
# from the story retirement and calls each "its own provable unit"; that unit is still OPEN. Unlike
# `packages/model-uat`, nothing outside this organism imports it, so it is genuinely dead code rather
# than a live residue — but deleting it is still not this increment's move.
status: retired
proof_mode: UAT
# UAT criteria: NONE (deleted 2026-08-20). A story may declare zero criteria and still green honestly
# through the ADR-0085 own-proof union, so `uat_witness` below is now inert rather than load-bearing —
# it is retained only so a reader of the history sees what the legs were declared as.
uat_witness: machine
# Immutable arc provenance (ADR-0183): the THIRD landable increment of the `model-uat-promotion` arc
# (ADR-0209, owner-directed 2026-07-17). Increment 1 (`model-uat-witness`) landed the tiered-witness
# DATA + eligibility foundation. Increment 2 (`uat-criterion-detail`) landed the seed-canonical
# detail artifact + content-hash anchor. THIS story is the JUDGE + SPINE + ESCALATION foundation
# (ADR-0209 D3/D4): independent fresh read-only model judgment, structured PASS/FAIL/INCONCLUSIVE,
# spine validation and signing, and the capability escalation ladder. Studio row concision and the
# three-story pilot migration are LATER arc increments (see "Where this sits in the arc") — authored
# just-in-time as the orchestrator consumes each (slow growth, ADR-0183), NOT scaffolded here.
arc: model-uat-promotion
# Packages-forward ownership (ADR-0192): this NEW story owns a NEW workspace package/port,
# `@storytree/model-judged-uat` (`packages/model-judged-uat`). Every proof-bound source below lives
# in that building. It consumes `@storytree/model-uat` (witness/tier/eligibility) and
# `@storytree/uat-criterion` (detail pointer + content-hash fresh/stale). Orchestrator/drive
# consumer wiring that *invokes* the live Fable judge or persists signed rows is consumer-side glue
# AFTER these proofs — no proof source squats in foreign buildings (ADR-0192).
depends_on: [model-uat-witness, proof-protocol, uat-criterion-detail]
# Deciding ADRs (ADR-0037 §2): 0209 (D3/D4 — this story's charter); 0020 (spine observes and signs;
# leaves do not self-certify); 0082 (per-test UAT criteria); 0192 (packages-forward ownership);
# 0010 (organism model + splitting-rule).
decisions: [209, 20, 192, 82, 10]
# Capabilities, roots-first (a capability appears after everything it depends on).
capabilities: [judge-result-shape, independent-judge-seam, spine-judge-validation, model-escalation-ladder]
# Node-borne STORY-UAT proof config (ADR-0057 / ADR-0092). NET-NEW package: AUTHOR_TEST writes the
# standing UAT against the public `@storytree/model-judged-uat` barrel; IMPLEMENT exports the
# result-shape / judge-seam / spine-validation / escalation API. The package suite is the explicit
# proof command and regression wall. No DB, SDK, API, or live model for the leaf proofs; the judge
# seam is proven offline against a scripted read-only impl (live Fable is consumer glue + later
# operator/out-of-band attestation when a criterion actually needs a live frontier run).
# PROOF BINDING REMOVED 2026-08-31 — the package it named is gone. `@storytree/model-judged-uat` was DELETED
# by `model-uat-family-consolidation-arc` increment 1 (ADR-0247 D5's first package retirement), so
# the `proof:` block that stood here bound a test file, a source file and a `pnpm --filter` target
# that no longer exist. Leaving it would not have been inert: a dead `--filter` EXITS 0 WITHOUT
# RUNNING, which is a proof command that can only ever report success. `check:verification-decay`'s
# `contract-binding-drift` instrument (ceiling 0) and the `coverage-drain` sweep both red on exactly
# that, and ADR-0252 D3 forbids raising a ceiling to absorb it — of the three sanctioned drains
# (author a test, split/retire, repair the binding), only REPAIR applies here: the code is gone so no
# test can be authored, and this node was already `status: retired`, which by itself cleared nothing
# because no instrument filters on it.
#
# The node is KEPT as a browsable row, per ADR-0247 D2 (a retirement, not a deletion — the tier can
# be brought back). It simply no longer registers a real-build surface. This is the shape
# `stories/studio-build` already holds: retired, body kept as history, binding no file, breaching no
# ceiling. The implementation stays recoverable in git history.
---

# An eligible model judge returns structured PASS/FAIL/INCONCLUSIVE — the spine validates, escalates, and signs

**Outcome —** An independent fresh read-only model judge returns structured PASS, FAIL, or
INCONCLUSIVE for a model-witness criterion; the spine validates shape, eligibility, tier, clean
detail-hash anchor, and evidence, then either signs or escalates by the declared ladder — never
laundering a FAIL into human green.

This is the **JUDGE + SPINE + ESCALATION foundation** of the `model-uat-promotion` arc (ADR-0209
increment 3): it makes model judgment an independent, fresh, read-only run that returns structured
`PASS | FAIL | INCONCLUSIVE` with criterion evidence and rationale (ADR-0209 D3); has the
deterministic spine validate output shape, model eligibility, criterion tier, clean detail-hash
anchor, and evidence bindings before recording a signed verdict (ADR-0209 D3); and escalates by
declared capability without laundering failure — advanced INCONCLUSIVE → frontier, frontier
INCONCLUSIVE → exceptional human, FAIL → build (ADR-0209 D4). The model never writes or signs its
own green.

It stands on increment 1 (`model-uat-witness`: who may judge) and increment 2
(`uat-criterion-detail`: what contract/hash is judged). It deliberately does **not** render Studio
rows or migrate pilot stories — each of those is a later arc increment (see "Where this sits in the
arc").

## The journey (why this is ONE story — the journey-principle)

The consumer is the deterministic spine (and the author who trusts its signed model-UAT rows): its
goal is *"an eligible model judged this criterion honestly, and the spine either signed that
judgment or escalated without laundering failure."* Finishing "I've got a structured judge result"
leads straight to needing "and the spine validated eligibility/tier/hash/evidence" and "and
INCONCLUSIVE/FAIL routed by the ladder rather than a human override" — one continuous
judge→validate→escalate/sign journey (journey-principle). Its proof shares one precondition (a
model-witness criterion with a fresh detail-hash anchor plus an eligible judge) and one observable
(a spine-admitted signable outcome or an honest escalation/hold), so the splitting-rule keeps it
whole.

**Studio row concision (ADR-0209 D7) stays OUT.** Different consumer, different observable.
**Pilot migration (ADR-0209 D8) stays OUT.** Different journey (classify + detail real stories).

## Design floor (from ADR-0209 D3/D4 — do not re-litigate)

- **Independent fresh read-only judge.** The judge runs separately from the builder, with fresh
  context and no write tools. It returns structured `PASS | FAIL | INCONCLUSIVE` with
  criterion-by-criterion evidence references and rationale (ADR-0209 D3).
- **Spine validates and signs; the model never self-greens.** The deterministic spine validates
  output shape, model eligibility, criterion tier, clean anchor, and evidence bindings, then records
  the signed verdict. The model never writes or signs its own green (ADR-0209 D3 / ADR-0020).
- **Escalate without laundering failure.** An `advanced` INCONCLUSIVE escalates to an available
  frontier judge. A frontier INCONCLUSIVE may exceptionally escalate to a human. A FAIL at any
  eligible model tier remains red and returns to implementation or rubric repair; a human cannot
  override it into green (ADR-0209 D4).
- **One eligible judge per tier is enough.** Fable and any future peer frontier model do not both
  have to agree unless a later criterion introduces a stronger risk policy (ADR-0209 D4).
- **Fable is the live frontier today; GPT-5.6 Sol is future-only.** Eligibility is already decided
  by `@storytree/model-uat`'s registry (increment 1). This story consumes that resolution; it does
  not reopen the allowlist. Live Fable invocation is consumer glue after the offline port is green.
- **Verdicts anchor to detail hash.** The signable model-UAT payload records the detail content
  hash from `@storytree/uat-criterion`; a stale hash is refused, not signed (ADR-0209 D6).

## Scope boundary — what this story does NOT do (later arc increments)

Held out deliberately (each is its own journey — splitting-rule trigger 1 — authored just-in-time,
not scaffolded here):

- **`uat-detail-studio`** — Studio one-liner row concision + open-Library-detail (ADR-0209 D7).
- **`model-uat-pilot`** — classifying and detailing the three pilot stories (ADR-0209 D8).
- **Reopening `model-uat-witness` / `uat-criterion-detail`** — witness/tier/registry and
  detail/pointer/hash stay as landed; this story consumes them through their public ports.
- **Foreign-building squats** — wiring the live Claude Agent SDK Fable judge into drive/orchestrator,
  persisting signed model-UAT rows into the work/verdict store, extending `proof-protocol`'s binary
  `Outcome` / `UatWitness` enums, and the deferred inc-2 Library KIND_SPECS / CLI sync / agent fence
  injection are **consumer-side glue** after this port's proofs land. Flagged in Ownership below;
  not proof-bound sourceFiles here.

## Capabilities (4)

Listed roots-first (a capability appears after everything it depends on). Each is a **LEAF** — an
isolatable backend red→green in TypeScript under the story-owned `packages/model-judged-uat`, armed
for `node build --real` (the orchestrator drives it through the prove-it gate). Result shape,
validation, and escalation are pure offline; the judge seam is offline against a scripted read-only
impl (no live SDK in leaf proofs).

| # | capability | class | outcome | depends on |
|---|---|---|---|---|
| 1 | [`judge-result-shape`](judge-result-shape.md) | LEAF | A model-judge result validates as structured PASS, FAIL, or INCONCLUSIVE with per-criterion evidence refs and rationale — and refuses a malformed or self-signing payload. | — |
| 2 | [`independent-judge-seam`](independent-judge-seam.md) | LEAF | A judge port runs separately from the builder as a fresh read-only call that returns only a structured result; a scripted impl proves the seam offline with no write surface. | `judge-result-shape` |
| 3 | [`spine-judge-validation`](spine-judge-validation.md) | LEAF | The spine admits a result only when shape, registered eligibility, criterion tier, fresh detail-hash anchor, and evidence bindings all hold — and builds a signable model-UAT payload the model itself cannot sign. | `judge-result-shape` |
| 4 | [`model-escalation-ladder`](model-escalation-ladder.md) | LEAF | Structured outcomes route by the locked ladder: FAIL → build; advanced INCONCLUSIVE → frontier; frontier INCONCLUSIVE → human exception; PASS → signable — never laundering FAIL into human green. | `judge-result-shape` |

## Within-story dependency graph

Authored from the intended data-flow (re-derive from the real imports/calls when built, ADR-0010 §3).
The graph is acyclic; `judge-result-shape` is the root.

- `independent-judge-seam` → `judge-result-shape` — the seam's only return type is the structured
  result schema.
- `spine-judge-validation` → `judge-result-shape` — validation and the signable payload are built
  from a parsed structured result plus eligibility/tier/hash inputs from upstream ports.
- `model-escalation-ladder` → `judge-result-shape` — escalation classifies a structured outcome
  (and the criterion's required tier) into the next honest action.

## Ownership and future consumption (ADR-0192 packages-forward)

This NEW story owns the NEW `@storytree/model-judged-uat` port at `packages/model-judged-uat`; every
`proof.real.sourceFile` and literal `sourceGlobs` entry is under that one building. Package scaffold
+ `packageOwnership` registration in `repo-manifest/package-ownership/_domain.json` must land before
the leaf chain (same bootstrap as `model-uat-witness` / `uat-criterion-detail`).

Runtime dependencies (honest `depends_on`):

- **`model-uat-witness`** (`@storytree/model-uat`) — classified witness, required tier, and
  eligibility registry resolution already proven; spine validation and escalation consume
  `resolveJudge` / HOLD without reopening the allowlist.
- **`uat-criterion-detail`** (`@storytree/uat-criterion`) — detail pointer + content-hash
  fresh/stale classifier already proven; spine validation refuses a stale anchor.

**Deferred consumer glue (NOT this story's proof sources):**

- `@storytree/orchestrator` / `@storytree/drive` invoke the live Fable judge behind the judge seam
  and persist spine-signed model-UAT verdicts.
- `@storytree/proof-protocol` may later widen published verdict vocabulary if signed model-UAT rows
  need a first-class `inconclusive` / `model` witness on the wire — a separate, additive protocol
  change, not a squat in this port's leaf proofs.
- Deferred increment-2 glue (Library `KIND_SPECS`, CLI sync, `runSpawnStoryAuthor` fence injection)
  remains scheduled when landing honesty needs those surfaces — still not this story.

## UAT Test Criteria

**None — this story is retired (ADR-0247 D5).** Its six criteria were deleted on 2026-08-20 and each is
recorded `superseded`, with its rationale, in `stories/uat-legacy-dispositions.json`. Nothing is silently
dropped: the ledger still carries all 282 keys reviewed at the ADR-0253 cutover.

A story may declare zero UAT criteria (ADR-0294 D4) and still green honestly through the ADR-0085
own-proof union, so an empty section here is a statement rather than a gap.

**Why these six were deleted rather than adjudicated.** ADR-0294 D2's honesty wall asks the deleting
author to name the lower-tier node that already proves each claim. There is none to name here, and the
reason is that **the claim is gone, not the proof**. All six asserted properties of the independent
rubric-bound model JUDGE — the structured PASS/FAIL/INCONCLUSIVE result shape, the read-only judge seam,
the spine's eligibility/tier/hash admission, and the advanced→frontier→human escalation ladder — and
**ADR-0247 D1 retired that machinery outright**. ADR-0295 then answered the same question a different
way: the model that DROVE a journey may witness it, producing a `machine` outcome, and it *"revives NO
ADR-0209 rubric-judge machinery"* — no independent judge, no eligibility registry, no ladder. So there
is no surviving claim to re-home, which is the second of the two honest accountings
`packages/library/src/corpus-criterion-migration.test.ts` allows: the claim itself was withdrawn.

They were also, independently, the exact shape ADR-0294 D1 says a story criterion is not — six legs all
bound to one `pnpm --filter @storytree/model-judged-uat test` gate, i.e. a single package's own suite
signing the story rung.

## Reliability Gates

The story's six UAT criteria are deterministic package behaviour and bind explicitly to ONE real,
command-bearing observe gate (ADR-0082/0085/0106). The gate does not forge per-test rows: during
Adopt, the spine runs the declared command at a clean committed HEAD, validates every exact
`proof-gate` binding first (no fallback / no partial signing), and then mints one `adopted` verdict per
criterion only when the command is green.

1. **The public model-judged-uat port suite is green** _(gate: observe)_ _(covers: judge-result-shape, independent-judge-seam, spine-judge-validation, model-escalation-ladder)_ `pnpm --filter @storytree/model-judged-uat test`.
   The spine observes the real package suite: result-shape schema, independent read-only judge seam,
   spine validation + signable payload, escalation ladder, FAIL-laundering refusal, and offline
   scripted end-to-end. The suite genuinely exercises each covered capability's contracts (ADR-0085 /
   ADR-0097 — not a rubber-stamp smoke import). It then signs `model-judged-uat#gate-1`; all six
   machine criteria above bind to this exact command-bearing gate, and the adopted pass greens the
   four capabilities via `(covers:)`.

Run from a clean committed rebuilt HEAD:
`pnpm storytree adopt model-judged-uat --signer <email> --pg`. Because the story is `proposed`,
Adopt may be rerun (ADR-0097); it observes the package command once, signs the gate, then signs
`model-judged-uat#uat-1` through `#uat-6` against their exact binding. No criterion is switched
human, and no signed row is authored by hand.

## Proof

The story carries the UAT above (ADR-0010 §2). Package scaffold + ownership registration land first;
then the four leaf capabilities chain roots-first through `node build --real`; then the story UAT +
Adopt observe the public barrel. Per ADR-0020, `healthy` is only ever DERIVED from signed verdicts;
the authored status stays `proposed`. The whole-story UAT remains explicitly `uat_witness: machine`.

## Where this sits in the arc — the dependency order for the planner

The `model-uat-promotion` arc (ADR-0209) is a multi-increment epic; this story is increment 3. Honest
build order:

1. **`model-uat-witness`** (landed) — tiered-witness DATA + eligibility foundation.
2. **`uat-criterion-detail`** (landed) — seed-canonical detail kind, pointer, hash anchor,
   story-author authority.
3. **`model-judged-uat`** (THIS story) — independent model judge + spine validation/signing +
   escalation ladder. Offline LEAF proofs in `packages/model-judged-uat`; then consumer glue into
   orchestrator/drive for live Fable.
4. **`uat-detail-studio`** (later) — Studio row concision (ADR-0209 D7); depends on 2.
5. **`model-uat-pilot`** (later) — three-story pilot migration (ADR-0209 D8); depends on 1 + 2 + 3
   (+ 4).
