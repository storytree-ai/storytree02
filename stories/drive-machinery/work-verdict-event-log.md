---
id: "work-verdict-event-log"
tier: capability
story: drive-machinery
title: "The work/verdict event log and the durable story-health rollup"
outcome: "Unit lifecycle and story health derive from typed proof events plus a durable story baseline; every green route establishes that baseline, current failure wins unhealthy, and missing later proof cannot silently reset established green."
status: proposed
proof_mode: integration-test
depends_on: []
arc: story-green-monotonicity-arc
decisions: [560, 416, 443]
---

# The work/verdict event log and the durable story-health rollup

**Outcome —** Unit lifecycle and story health derive from typed proof events plus a durable story
baseline. Every route that first proves the whole current story records the scope it proved; readers
preserve that delivered baseline through later proof absence, while current failure or an explicit
unresolved story-health issue resolves `unhealthy` (ADR-0560).

> **Proof status (honest) — `proposed`, with the live-Postgres arm still unsigned.** The projection and
> the event routing are covered by real, passing, offline suites (`packages/orchestrator/src/proof/rollup.test.ts`
> incl. the reusable parity suite, and `packages/orchestrator/src/store/pg-work-store.test.ts` against a
> structural fake client — both suites now resident in `@storytree/orchestrator`
> (the old `@storytree/core` / `@storytree/store` dissolved into it, ADR-0068/0077) — I ran them green
> 2026-06-13). The **live SQL leg** (real `events.work_event`/`events.verdict` tables over the
> IAM connection) is proven only by the live-gated `PgWorkStore rollup parity` run
> (`packages/orchestrator/src/store/pg-work-store.test.ts`, a visible **skip** unless `STORYTREE_DB_LIVE=1`) —
> currently unrun by default — plus PR #30's one attested `--store pg` real-verdict run.

## Guidance

Three joined halves, one capability (the projection in `packages/orchestrator/src/proof/` and the pg event store
in `packages/orchestrator/src/store/` — once split across the since-dissolved `packages/core` /
`packages/store` by package locality, ADR-0068/0077 — the same shape as the library's store seam):

- **The vocabulary + projection** (`packages/orchestrator/src/proof/rollup.ts`): `WorkEventDoc` /
  `workEvent` (`rollup.ts:34-52`) shape the lifecycle marks (`proposed`/`building`/`retired`);
  `rollupStatus` (`rollup.ts:66-89`) walks an event stream in `seq` order, last relevant event
  wins. CONSERVATIVE BY CONSTRUCTION: `healthy` is reachable ONLY through a signed pass `Verdict`
  (ADR-0020 — proof is non-authorable); a malformed signing doc grants nothing; a fail verdict
  never grants progress (it only demotes a prior healthy); NO events means the projection ABSTAINS
  (`null`) so the authored frontmatter status stands (ADR-0006: derived state augments, never
  invents). `rollupParitySuite` (`rollup.ts:97-148`) is exported so any `Store` impl is held to the
  same projection bar — the library's trait-parity discipline reused.
- **The Postgres event store** (`packages/orchestrator/src/store/pg-work-store.ts`): `PgWorkStore` routes
  `kind:"work"` → `events.work_event` and `kind:"signing"` → `events.verdict`
  (`pg-work-store.ts:66-133`), EVENT-ONLY and fail-closed — a signing doc that is not a full signed
  `Verdict` throws (nothing forgeable lands), an unknown kind throws, and the whole doc surface
  throws (library artifacts live in `PgLibraryStore`, never here). `readEvents`
  (`pg-work-store.ts:135-186`) merges both tables ordered by `at` (work before signing on a tie)
  and REASSIGNS `seq` monotonically — the two tables have independent BIGSERIALs, so raw values
  cannot order the union. The client is structural (`WorkStoreClient`, `pg-work-store.ts:29-31`) so
  offline tests inject a fake — which is exactly why the live-SQL leg stays a `proposed` pocket.
- **The story-health projection** (`packages/orchestrator/src/proof/story-baseline.ts` and the shared
  story-health resolver): a valid whole-story green records the exact non-retired capability ids and
  own-proof obligation ids it covered. The resolver reads that durable scope together with today's
  declaration and proof. Current failure or an explicit unresolved story-health issue wins
  `unhealthy`; current all-pass may establish or advance the baseline; current absence after a
  baseline remains `healthy` with the outstanding obligation separately visible; only an explicit
  auditable ground-up reset clears the established baseline back to pre-green `proposed`.

- **The inner-loop attempt ledger** (`packages/orchestrator/src/proof/inner-loop-ledger.ts`, routed by
  `PgWorkStore` to `events.inner_loop_event`): ADR-0563's attempts, grants, signed passes and landing
  adjudications, one idempotent row per event, unit, increment and run. `foldInnerLoopLedger(events,
  unitId)` reads a unit's WHOLE history across every increment it was filed under (ADR-0575 D2), so a
  retry filed under a new increment neither resets the consecutive-failure count nor hides a pending
  landing obligation; each attempt keeps its own increment id, which is what lets `decideAttempt`
  report a relabelled retry. A landing adjudication closes the loop, and later work on the unit starts
  a fresh count. A valid pass is credited to its named recorded run even when another run started in
  between; the reader counts the later unsigned start-ordered suffix, so late completion cannot relax
  the decision point or owner ceiling (ADR-0602). Contracts:
  [`attempt-count-follows-the-unit`](attempt-count-follows-the-unit.md) and
  [`overlapping-passes-keep-their-attempts`](overlapping-passes-keep-their-attempts.md).
  **Paid builds now write and read it (ADR-0576).** Every paid REAL entry reads the ledger through
  `preflightPaidBuild` (`packages/drive/src/node-build.ts`) before any spend and refuses on its policy.
  A REAL build appends the attempt immediately before its gate walk and the signed pass after a signed
  result (`buildNodeReal`, under the unit id; a story chain under the story id, a gate drive under the
  gate id), and `storytree node grant|adjudicate` append the orchestrator's calls.

Every writer that can make a story green consumes this same transition. Whole-story build already
stamps its story verdict; completing the final current UAT criterion or reliability gate must also
establish the identical baseline rather than leaving green as a reader-only coincidence. A bounded
backfill uses signed historical/current proof to establish missing baselines for stories whose
then-current roll-up is demonstrably green; authored `status:` never qualifies.

Consumed by [`prove-it-gate`](prove-it-gate.md) (the signing append rides the narrow `Store` seam)
and [`build-drive-cli`](build-drive-cli.md) (`workEvent` building marks, `rollupStatus` report
lines, `PgWorkStore` under `--store pg`).

## Proof walkthrough first

Start with a story whose current capabilities and own-proof obligations all hold exact signed passes.
Drive each green-producing route and observe one baseline over the same canonical scope. Add an
unproved capability or change an existing criterion revision and observe the story remain healthy
while the new/current obligation is named pending. Add a signed failure or explicit unresolved health
issue and observe unhealthy. Run the explicit reset and observe the baseline clear and the story
return to its authored pre-proof state. Finally feed the backfill a mix of fully proven, authored-only,
partially proven and failed stories and observe that only evidence-complete stories receive baselines.

## Integration test

**Goal —** Events appended through the real `Store` seam read back as one stream the rollup
derives honestly from: the exported `rollupParitySuite` runs against a REAL `InMemoryStore`
(`packages/orchestrator/src/proof/rollup.test.ts:136` — no events → abstain; building → building; building +
signed pass → healthy; another unit's events grant nothing), and `PgWorkStore.readEvents` merges
both tables into the rollup's input shape (`packages/orchestrator/src/store/pg-work-store.test.ts:126`).

## Contracts (12)

1. **`rollup-abstains-without-events`** — no event speaks for the unit → `null`; the authored status stands
   - **asserts —** `rollupStatus("ghost", []) === null`.
   - **covers —** `packages/orchestrator/src/proof/rollup.ts:66-89`
   - **proven by —** `packages/orchestrator/src/proof/rollup.test.ts:48` (REAL, passing)
2. **`pass-grants-healthy-rebuild-supersedes`** — building → healthy only via a signed pass; a NEW building event after a pass supersedes it
   - **asserts —** building → `building`; + signed pass → `healthy`; + later building → `building`.
   - **covers —** `rollup.ts:72-88`
   - **proven by —** `rollup.test.ts:52`, `:57`, `:65` (REAL, passing)
3. **`fail-never-grants-progress`** — a fail verdict demotes a prior healthy to unhealthy and otherwise changes nothing
   - **asserts —** fail-before-pass leaves status untouched; fail-after-pass → `unhealthy`.
   - **covers —** `rollup.ts:81-86`
   - **proven by —** `rollup.test.ts:73` and `:86` (REAL, passing)
4. **`conservative-parsing-never-overclaims`** — a malformed signing doc, another unit's events, and out-of-order seq all stay honest
   - **asserts —** malformed grants nothing; other-unit grants nothing; events are seq-sorted before walking.
   - **covers —** `rollup.ts:71-80`
   - **proven by —** `rollup.test.ts:102`, `:112`, `:116` (REAL, passing)
5. **`work-event-shape-validates`** — `workEvent` validates and shapes the append payload (`runId:unitId` id rule)
   - **asserts —** a valid doc shapes; the id embeds runId when present.
   - **covers —** `rollup.ts:45-52`
   - **proven by —** `rollup.test.ts:123` (REAL, passing)
6. **`pg-routes-kinds-to-their-tables`** — signing → `events.verdict` with the Verdict's scalar spine; work → `events.work_event` with the LIFECYCLE word in the type column
   - **asserts —** the INSERT targets and column values per kind; a missing tier lands as `'unknown'`.
   - **covers —** `packages/orchestrator/src/store/pg-work-store.ts:66-133`
   - **proven by —** `packages/orchestrator/src/store/pg-work-store.test.ts:51`, `:93`, `:109` (REAL, passing — fake client; the live SQL leg is the `proposed` pocket)
7. **`pg-fails-closed-on-forgeable-input`** — a non-Verdict signing doc and an unknown kind are refused; the doc surface fails loud
   - **asserts —** each throws; nothing lands somewhere silent.
   - **covers —** `pg-work-store.ts:73-76`, `:129-133`, `:189-201`
   - **proven by —** `pg-work-store.test.ts:78`, `:116`, `:169` (REAL, passing)
8. **`pg-read-merges-and-reorders`** — `readEvents` merges both tables by `at` (work before signing on a tie), reassigns `seq`, honours the id filter
   - **asserts —** merged order + monotonic reassigned seq + filter.
   - **covers —** `pg-work-store.ts:135-186`
   - **proven by —** `pg-work-store.test.ts:126` and `:156` (REAL, passing)
9. **`every-story-green-transition-establishes-its-baseline`** — green is never transient reader state.
   - **asserts —** whole-story build, final-current-UAT completion and final-current-reliability-gate
     completion each persist a passing story record carrying the same canonical set of non-retired
     capability ids and current own-proof obligation ids; a partial or failing roll-up writes none.
   - **covers —** `packages/orchestrator/src/proof/story-baseline.ts` and every drive-side writer that
     can complete the story-health roll-up.
10. **`established-green-survives-proof-absence-but-not-failure`** — missing is expansion, failure is health.
    - **asserts —** after a baseline exists, a new capability or changed criterion revision with no
      current witness leaves story health `healthy` and names the pending delta; an exact current fail
      or explicit unresolved story-health issue resolves `unhealthy`.
11. **`only-explicit-reset-clears-established-story-green`** — proposed is a pre-baseline/reset state.
   - **asserts —** ordinary work events, revision changes, age and missing current proof cannot clear
     a baseline; the named auditable ground-up reset does clear it, after which the resolver abstains
     and authored pre-proof status may render proposed.
   - **covers —** `packages/orchestrator/src/proof/story-baseline.ts`.
12. **`baseline-backfill-is-evidence-only-and-auditable`** — migration cannot paint stories green.
    - **asserts —** the backfill records a baseline only when signed history proves the story's
      then-current complete roll-up, reports every accepted and declined story with its evidence, and
      refuses authored status, partial proof, current failure or unreadable evidence as a basis.
   - **covers —** `packages/orchestrator/src/proof/story-baseline.ts` and its bounded backfill caller.
