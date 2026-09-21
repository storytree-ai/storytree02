---
id: "model-uat-pilot"
tier: story
title: "Three pilot stories migrate to explicit witnesses and addressable UAT detail"
outcome: "Every UAT criterion on drive-machinery, library-review, and library-tech-tree-overlay is explicitly classified as machine, tiered model, or human with a resolvable live-canonical detail pointer — zero legacy-unresolved either remains on those three — and a machine harness reports the migration counts that inform corpus-wide rollout."
# RETIRED 2026-08-20 — ADR-0247 D5 names this story on its retirement worklist by id. It exists to
# migrate three pilot stories onto the explicit `machine` | `model` | `human` witness contract WITH a
# declared model tier, and ADR-0247 D1 retired that vocabulary and that tier outright — so the target
# state this story measures progress toward no longer exists. Body kept as history (the
# spawn-visibility / chat-drive-bridge precedent); the four capability files flip to `status: retired`.
# NOT retired by this, and deliberately so: the three PILOT stories themselves (`drive-machinery`,
# `library-review`, `library-tech-tree-overlay`) are live and untouched — this retires the harness that
# measured their migration, not the stories it measured. Nor is the DETAIL-artifact contract retired:
# `uat-criterion-detail` and `uat-detail-studio` are the two stories ADR-0247 D5 explicitly KEEPS, and
# the `uat-criterion` kind stays registered in the Library kind tables.
# `packages/model-uat-pilot` is NOT deleted here — ADR-0247 D5 makes each package retirement its own
# provable unit and that unit is still OPEN.
status: retired
proof_mode: UAT
# UAT criteria: NONE (deleted 2026-08-20). A story may declare zero criteria and still green honestly
# through the ADR-0085 own-proof union, so `uat_witness` below is now inert rather than load-bearing —
# it is retained only so a reader of the history sees what the legs were declared as.
uat_witness: machine
# Immutable arc provenance (ADR-0183): the FIFTH landable increment of the `model-uat-promotion`
# arc (ADR-0209, owner-directed 2026-07-17). Increments 1–4 landed witness/tier, detail/pointer/hash,
# the model judge, and Studio row concision. THIS story is the three-story pilot migration
# (ADR-0209 D8). Corpus-wide migration is a LATER increment informed by this pilot — not scaffolded
# here.
arc: model-uat-promotion
# Packages-forward (ADR-0192): the machine harness lives in a NEW port
# `@storytree/model-uat-pilot` (`packages/model-uat-pilot`). Classification edits touch the three
# pilot stories under `stories/**`; detail BODIES are live Library artifacts (ADR-0307 D5), written
# with `library artifact new|edit <id> --pg` rather than committed anywhere;
# Library KIND registration is hosted glue in `@storytree/library` (loudly owned here — deferred
# from uat-criterion-detail). Ownership option A: this story owns those corpus edits as its leaf
# work (one classify→detail→observe journey), not a follow-on story-author pass.
depends_on:
  [
    model-uat-witness,
    uat-criterion-detail,
    library,
    drive-machinery,
    library-review,
    library-tech-tree-overlay,
  ]
# Write-target / corpus-migration edges (ADR-0166): this story edits the three pilot stories'
# UAT sections + their detail seeds. Not package-import edges — annotate so the boundary gate
# keeps them as honest forest roads. Arc foundation stories model-judged-uat + uat-detail-studio
# are consumed conceptually (landed before this increment) but not as runtime package deps here.
artifact_edges: [drive-machinery, library-review, library-tech-tree-overlay]
# Deciding ADRs: 0209 (D8 — charter); 0192 (packages-forward / hosted honesty); 0082 (per-test
# UAT); 0106 (Adopt resolves witness); 0307 (D5 — withdrew the seed-canonical posture for this
# detail class, so the pointers resolve to LIVE artifacts; supersedes the ADR-0055 once cited here);
# 0184 (drive-machinery machine
# conversion precedent); 0070 (LOOK stays human); 0010 (organism + splitting-rule).
decisions: [209, 192, 82, 106, 307, 184, 70, 10]
capabilities:
  [
    uat-criterion-library-surface,
    pilot-criteria-classified,
    pilot-detail-seed,
    pilot-migration-harness,
  ]
# Node-borne STORY-UAT proof config. NET-NEW package: AUTHOR_TEST writes the standing UAT against
# the public `@storytree/model-uat-pilot` barrel; IMPLEMENT exports the harness that parses the
# three pilot stories + seed details and asserts complete migration. Offline; no live model run.
# PROOF BINDING REMOVED 2026-08-31 — the package it named is gone. `@storytree/model-uat-pilot` was DELETED
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

# Three pilot stories migrate to explicit witnesses and addressable UAT detail

**Outcome —** Every UAT criterion on `drive-machinery`, `library-review`, and
`library-tech-tree-overlay` is explicitly classified as `machine`, tiered `model`, or `human` with
a resolvable live-canonical detail pointer — zero legacy-unresolved `either` remains on those three —
and a machine harness reports the migration counts that inform corpus-wide rollout.

This is the **three-story pilot migration** of the `model-uat-promotion` arc (ADR-0209 D8 /
increment 5). It stands on the landed foundation (witness/tier, detail/pointer/hash, judge, Studio
concision) and applies that contract to three deliberately different stories: `drive-machinery` as
the deterministic control, `library-review` as the mixed knowledge workflow, and
`library-tech-tree-overlay` as the visual frontend. Corpus-wide migration waits on this pilot's
measurement signal (ADR-0209 Consequences) and is a later increment.

## The journey (why this is ONE story — the journey-principle)

The consumer is the corpus author (and the later planner of corpus-wide migration): its goal is
*"these three stories are fully on the new witness+detail contract, and I can see the counts."*
Finishing "every leg is explicitly classified" leads straight to needing "and each has an
addressable detail artifact" and "and a harness proves both with no silent model default" — one
continuous classify→detail→observe journey (journey-principle). Its proof shares one precondition
(the three story bodies + the detail seed surface) and one observable (zero `either`, every
pointer resolves, migration counts), so the splitting-rule keeps it whole.

**Ownership option A.** This story owns the classification edits to the three pilot stories and the
detail-seed authoring as its leaf work. A separate "harness only, then follow-on story-author pass"
split (option B) would conjunction the outcome across two journeys.

## Design floor (from ADR-0209 D8 — do not re-litigate)

- **No silent model default.** Untagged criteria must not inherit `model`. Until a criterion is
  explicitly migrated it may retain legacy-unresolved `either` on the conservative path; `either` is
  not a fourth classified witness, carries no tier, and cannot enter model judgment (ADR-0209 D8).
  After this pilot, the three named stories have **zero** `either`.
- **Three honest kinds.** Each pilot leg is `machine`, tiered `model` (`advanced`|`frontier`), or
  `human`. Human is for irreducible judgment gaps (LOOK / live interaction / spend) — never cost
  (`human-witness-is-a-judgment-gap-not-cost`, ADR-0070).
- **Pilot cast (locked).** `drive-machinery` = deterministic control; `library-review` = mixed
  knowledge workflow; `library-tech-tree-overlay` = visual frontend (ADR-0209 D8).
- **Classification policy for the first cut.** Keep an already-honest machine leg machine; keep
  irreducible UI/LOOK legs human; introduce `model` + tier only where a rubric-bound semantic
  judgment with capturable evidence honestly fits — never force model onto a judgment gap to
  "exercise" the tier. A pilot that measures mostly machine+human with detail cost is still a
  valid D8 signal.
- **Story title stays display-canonical.** Detail artifacts hold action / successConditions /
  evidenceExpectations (+ optional `asset:` refs); they never carry a competing title (ADR-0209
  D5/D6). Criterion annotations use `(detail: <story>#uat-<n>)` (or the story's stable detail id).
- **Live-canonical details (ADR-0307 D5, re-pointed 2026-08-05).** A detail body is a LIVE Library
  artifact, authored with `storytree library artifact new|edit <id> --pg` and validating as
  `@storytree/uat-criterion`'s `uat-criterion` kind. It is NOT committed JSON: this floor once read
  "detail JSON lives under `apps/studio/data/seed-kinds/uat-criterion/`", and that directory has
  been deleted along with the seed-canonical posture it rested on. Library `KIND_SPECS` registration
  (deferred from increment 2) still lands here — with the store canonical it is now the ONLY thing
  making the pointers resolvable for Studio/Library, so it carries more weight, not less.
- **Hash-anchor stands.** Substantive detail edits invalidate prior green via the landed
  content-hash classifier; this story does not reopen that port.

## Scope boundary — what this story does NOT do

- **Corpus-wide migration** — every other story's UAT legs stay as they are; only the completed
  corpus-wide increment may retire legacy-only `either` parsing (ADR-0209 D8).
- **Live model judge runs** against pilot legs — the judge port is landed; wiring a live Fable run
  for a newly `model`-classified leg is consumer glue / out-of-band attestation when that leg is
  actually judged, not this story's proof.
- **Reopening increments 1–4 proof sources** — consume `@storytree/model-uat`,
  `@storytree/uat-criterion`, `@storytree/model-judged-uat`, and the Studio one-liner surface as
  public contracts.
- **Retiring `either` from the parser** — compatibility parse stays until corpus-wide completion.

## Capabilities (4)

Listed roots-first. Cap 1 is library-hosted glue (ADR-0192 honesty). Caps 2–3 are corpus edits
(stories + seed). Cap 4 is the story-owned harness package.

| # | capability | class | outcome | depends on |
|---|---|---|---|---|
| 1 | [`uat-criterion-library-surface`](uat-criterion-library-surface.md) | LEAF | Library recognizes `uat-criterion` as a first-class kind (`KnowledgeKind` + `KIND_SPECS`) so a detail artifact resolves through the Library kind tables like every other live-canonical kind. | — |
| 2 | [`pilot-criteria-classified`](pilot-criteria-classified.md) | LEAF | Every UAT criterion on the three pilot stories carries an explicit `machine` / `model`(+tier) / `human` tag — zero `either` on those three. | — |
| 3 | [`pilot-detail-seed`](pilot-detail-seed.md) | LEAF | Every pilot criterion carries a `(detail: …)` pointer that resolves to a validating `uat-criterion` detail artifact in the live Library. | `uat-criterion-library-surface`, `pilot-criteria-classified` |
| 4 | [`pilot-migration-harness`](pilot-migration-harness.md) | LEAF | A public `@storytree/model-uat-pilot` harness parses the three stories + seed, refuses incomplete migration / silent model default, and reports classified counts. | `pilot-criteria-classified`, `pilot-detail-seed` |

## Within-story dependency graph

- `pilot-detail-seed` → `uat-criterion-library-surface` — a detail body is only addressable once
  the kind is a real Library kind; with no seed directory left, registration is the whole surface.
- `pilot-detail-seed` → `pilot-criteria-classified` — pointers attach to already-classified
  criteria (`<story>#uat-<n>`).
- `pilot-migration-harness` → `pilot-criteria-classified` + `pilot-detail-seed` — the harness
  observes the migrated corpus; it does not author it.

## Ownership (ADR-0192)

- **NEW port:** `@storytree/model-uat-pilot` (`packages/model-uat-pilot`) — harness + story UAT.
  Register `packageOwnership` in `repo-manifest/package-ownership/_domain.json` at bootstrap.
- **Hosted glue:** `uat-criterion-library-surface` edits `@storytree/library` kind tables (and
  any minimal sync recognition). Loud, owner-visible foreign-building work — the deferred
  increment-2 consumer glue this pilot cannot complete without.
- **Corpus edits (option A):** `pilot-criteria-classified` sourceGlobs include the three pilot
  `stories/*/story.md` UAT sections; `pilot-detail-seed` edits those same story files to add the
  `(detail: …)` tags, and authors the detail BODIES as live Library artifacts (`--pg`) rather than
  as files (ADR-0307 D5). story-author runtime fence injection (`isStoryAuthorWriteAllowed` into
  `runSpawnStoryAuthor`) remains consumer glue, but it no longer WIDENS anything: every file this
  story writes is already under `stories/**`, and the detail bodies are out of any file fence's
  reach.

Runtime depends_on (already declared): foundation stories 1–4 plus the three pilot stories being
migrated.

## UAT Test Criteria

**None — this story is retired (ADR-0247 D5).** Its six criteria were deleted on 2026-08-20 and each is
recorded `superseded`, with its rationale, in `stories/uat-legacy-dispositions.json`. Nothing is silently
dropped: the ledger still carries all 282 keys reviewed at the ADR-0253 cutover.

A story may declare zero UAT criteria (ADR-0294 D4) and still green honestly through the ADR-0085
own-proof union, so an empty section here is a statement rather than a gap.

**Why these six were deleted — and note that they did NOT all go for the same reason.** This story's
legs split into two groups, and collapsing them would have quietly lost a live claim.

- **Legs 2, 4, 5 and 6 — the claim is WITHDRAWN.** They asserted that the pilot stories carry an
  explicit `machine` | `model` | `human` witness with a declared model tier, that an untagged criterion
  stays outside the migrated set rather than defaulting into model judgment, and that the harness reports
  per-story counts *by witness kind and model tier*. **ADR-0247 D1 retired the three-kind vocabulary and
  the tier**, so a criterion cannot declare `model` and there is no tier to count. There is no lower-tier
  node to name because there is no surviving claim.
- **Legs 1 and 3 — the claim SURVIVES, one rung down, and the proof was checked rather than assumed.**
  Leg 1 (the `uat-criterion` detail kind is admitted by the Library kind tables) is proven by the
  `library` capability: the kind is registered in `KIND_SPECS` and `KNOWLEDGE_TIERS`
  (`packages/library/src/knowledge.ts`), asserted directly in
  `packages/library/src/standson-bootstrap.test.ts` (it resolves at tier 6 and its refs seed), and
  `buildKindSchema("uat-criterion")` would throw at module load if the entry were absent. Leg 3 (a
  criterion points at a detail without ceding its one-line title — `displayTitle` stays the story's) is
  proven by the capability `criterion-detail-pointer` at
  `packages/uat-criterion/src/criterion-pointer.test.ts`, and re-asserted at the story rung by the LIVE
  story `uat-criterion-detail`, whose own leg 3 makes the display-canonical claim directly.

Every leg was also bound to one `pnpm --filter @storytree/model-uat-pilot test` gate — a single package's
own suite signing the story rung, the exact shape ADR-0294 D1 says a story criterion is not.

**What this retirement does NOT decide.** The three pilot stories themselves — `drive-machinery`,
`library-review` and `library-tech-tree-overlay` — are live and unaffected; retiring the harness that
measured their migration says nothing about their own criteria, which the `uat-journey-surgery-arc`
adjudicates on their own merits.

## Reliability Gates

1. **The public model-uat-pilot suite is green** _(gate: observe)_ `pnpm --filter @storytree/model-uat-pilot test`.
   The spine observes the real package suite (library-surface recognition as exercised by the
   harness, zero-either, detail coverage, refuse silent model default, migration counts, public
   barrel). It then signs `model-uat-pilot#gate-1`; all six machine criteria bind to this gate.

Run from a clean committed rebuilt HEAD:
`pnpm storytree adopt model-uat-pilot --signer <email> --pg`.

## Proof

Package scaffold + `packageOwnership` registration land first; then the four capabilities chain
roots-first (`node build --real`); then story UAT + Adopt observe the public barrel against the
migrated corpus. Per ADR-0020, `healthy` is only ever DERIVED from signed verdicts; authored status
stays `proposed`. Whole-story UAT is `uat_witness: machine`.

## Where this sits in the arc

1. **`model-uat-witness`** (landed) — tiered-witness DATA + eligibility.
2. **`uat-criterion-detail`** (landed) — the detail kind, pointer, hash, author scope.
3. **`model-judged-uat`** (landed) — judge + spine validation + escalation.
4. **`uat-detail-studio`** (landed) — Studio one-liner + open-Library-detail.
5. **`model-uat-pilot`** (THIS story) — three-story pilot migration (ADR-0209 D8).
6. **Corpus-wide migration** (later) — informed by this pilot; only its completion retires
   legacy-only `either` parsing.
